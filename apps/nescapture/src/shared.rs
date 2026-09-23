// ─────────────────────────────────────────────────────────────────────────────
//  shared.rs — encoding on the game's own VkDevice
//
//  The encoder used to run on a device of its own, which meant every frame
//  crossed between two devices as exported memory, with a CPU wait in between
//  because two devices share no timeline. Here the game's device is created
//  with what the encoder needs, and the encoder is handed that device instead.
//
//  Three things are added to the game's vkCreateDevice, and none of them
//  changes what the game gets:
//
//  - Extensions the encoder needs and the game did not ask for.
//  - Feature bits, set in whichever feature structs the game already chains,
//    and in structs of our own only where it chains none that hold them.
//    Vulkan forbids chaining VkPhysicalDeviceVulkan13Features alongside the
//    per-feature structs it contains, so appending blindly would make a valid
//    game's device creation invalid.
//  - Queues. A VkQueue may not be submitted to from two threads at once, and
//    the encoder submits from its own thread while the game submits from its.
//    So the encoder gets queues the game did not ask for where a family has
//    one to spare. Where none does, the game's queue is created internally
//    synchronized instead, which makes sharing it safe.
// ─────────────────────────────────────────────────────────────────────────────

use ash::vk;
use pixelforge::vulkan::{DeviceFeatures, DeviceQueue, DeviceRequirements};
use std::collections::BTreeMap;

// ── Queues ────────────────────────────────────────────────────────────────────

/// Which queue the encoder uses for each of its roles, and what that means for
/// the device's queue create infos.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuePlan {
    pub encode: DeviceQueue,
    pub compute: DeviceQueue,
    pub transfer: DeviceQueue,
    /// How many queues to create in each family, where that is more than the
    /// game asked for.
    pub counts: BTreeMap<u32, u32>,
    /// Families whose queues are created internally synchronized, because the
    /// encoder shares the game's queue there.
    pub internally_synchronized: Vec<u32>,
}

/// What a role needs from a family.
fn can(flags: vk::QueueFlags, needs: vk::QueueFlags) -> bool {
    let mut effective = flags;
    // Graphics and compute families support transfer whether or not they say so.
    if flags.intersects(vk::QueueFlags::GRAPHICS | vk::QueueFlags::COMPUTE) {
        effective |= vk::QueueFlags::TRANSFER;
    }
    effective.contains(needs)
}

/// Lower is better. The game renders on the graphics family, so it is the
/// last choice for anything, and a family that also does video is a poor one
/// for compute or copies because it contends with the encode itself.
fn rank(flags: vk::QueueFlags) -> u32 {
    let mut r = 0;
    if flags.contains(vk::QueueFlags::GRAPHICS) {
        r += 4;
    }
    if flags.intersects(vk::QueueFlags::VIDEO_ENCODE_KHR | vk::QueueFlags::VIDEO_DECODE_KHR) {
        r += 2;
    }
    if flags.contains(vk::QueueFlags::COMPUTE) {
        r += 1;
    }
    r
}

/// Pick a queue for every role.
///
/// `families` is the device's queue families, `game` how many queues the game
/// asked for in each (and with which flags). The encoder takes at most one
/// queue per family: all its submissions come from one thread, so its roles
/// can share a queue with each other freely, just not with the game.
///
/// `None` when some role has neither a spare queue nor a way to share the
/// game's safely, in which case the device is created as the game asked.
pub fn plan_queues(
    families: &[vk::QueueFamilyProperties],
    game: &BTreeMap<u32, (u32, vk::DeviceQueueCreateFlags)>,
    preferred_encode: Option<u32>,
    internally_synchronized_queues: bool,
) -> Option<QueuePlan> {
    let mut counts: BTreeMap<u32, u32> = BTreeMap::new();
    let mut ours: BTreeMap<u32, u32> = BTreeMap::new();
    let mut shared: Vec<u32> = Vec::new();

    let requested = |f: u32| game.get(&f).map_or(0, |&(n, _)| n);

    let pick = |needs: vk::QueueFlags,
                prefer: Option<u32>,
                counts: &mut BTreeMap<u32, u32>,
                ours: &mut BTreeMap<u32, u32>,
                shared: &mut Vec<u32>|
     -> Option<DeviceQueue> {
        let mut candidates: Vec<u32> = (0..families.len() as u32)
            .filter(|&f| can(families[f as usize].queue_flags, needs))
            .collect();
        candidates.sort_by_key(|&f| {
            (
                Some(f) != prefer,
                // A family already holding one of ours comes first: roles
                // sharing a queue costs nothing, a second queue costs one.
                !ours.contains_key(&f) && !shared.contains(&f),
                rank(families[f as usize].queue_flags),
                f,
            )
        });

        for &f in &candidates {
            if let Some(&index) = ours.get(&f) {
                return Some(DeviceQueue::new(f, index));
            }
            if shared.contains(&f) {
                return Some(DeviceQueue::new(f, 0));
            }
            let have = requested(f);
            if have < families[f as usize].queue_count {
                counts.insert(f, have + 1);
                ours.insert(f, have);
                return Some(DeviceQueue::new(f, have));
            }
        }

        // No spare anywhere. Share the game's queue, if it can be made safe to.
        if !internally_synchronized_queues {
            return None;
        }
        for &f in &candidates {
            // A family the game did not ask for would have had a spare above.
            // A non-zero flags value is a protected queue, which is not ours to
            // touch.
            if let Some(&(n, flags)) = game.get(&f)
                && n > 0
                && flags.is_empty()
            {
                shared.push(f);
                return Some(DeviceQueue::new(f, 0));
            }
        }
        None
    };

    let encode = pick(
        vk::QueueFlags::VIDEO_ENCODE_KHR,
        preferred_encode,
        &mut counts,
        &mut ours,
        &mut shared,
    )?;
    let compute = pick(
        vk::QueueFlags::COMPUTE,
        None,
        &mut counts,
        &mut ours,
        &mut shared,
    )?;
    let transfer = pick(
        vk::QueueFlags::TRANSFER,
        Some(compute.family),
        &mut counts,
        &mut ours,
        &mut shared,
    )?;

    Some(QueuePlan {
        encode,
        compute,
        transfer,
        counts,
        internally_synchronized: shared,
    })
}

// ── Features ──────────────────────────────────────────────────────────────────

/// One feature bit the encoder needs, and where it may live in a pNext chain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Feature {
    Synchronization2,
    TimelineSemaphore,
    SamplerYcbcrConversion,
    Ycbcr2Plane444Formats,
    VideoEncodeAv1,
    VideoEncodeRgbConversion,
    VideoEncodeIntraRefresh,
    VideoEncodeQuantizationMap,
    InternallySynchronizedQueues,
}

/// The features `f` asks for, plus the one queue sharing needs.
pub fn wanted_features(f: &DeviceFeatures, share_queues: bool) -> Vec<Feature> {
    let mut out = Vec::new();
    let mut want = |on: bool, feature| {
        if on {
            out.push(feature);
        }
    };
    want(f.synchronization2, Feature::Synchronization2);
    want(f.timeline_semaphore, Feature::TimelineSemaphore);
    want(f.sampler_ycbcr_conversion, Feature::SamplerYcbcrConversion);
    want(f.ycbcr_2plane_444_formats, Feature::Ycbcr2Plane444Formats);
    want(f.video_encode_av1, Feature::VideoEncodeAv1);
    want(
        f.video_encode_rgb_conversion,
        Feature::VideoEncodeRgbConversion,
    );
    want(
        f.video_encode_intra_refresh,
        Feature::VideoEncodeIntraRefresh,
    );
    want(
        f.video_encode_quantization_map,
        Feature::VideoEncodeQuantizationMap,
    );
    want(share_queues, Feature::InternallySynchronizedQueues);
    out
}

/// Where in a struct of type `s_type` the bit for `feature` is, if that struct
/// holds it. Covers the per-feature structs and the core aggregates.
///
/// # Safety
///
/// `p` must point to a live struct whose type is `s_type`.
unsafe fn field(
    s_type: vk::StructureType,
    p: *mut vk::BaseOutStructure<'_>,
    feature: Feature,
) -> Option<*mut vk::Bool32> {
    use Feature as F;
    use vk::StructureType as S;
    macro_rules! at {
        ($ty:ty, $field:ident) => {
            Some(unsafe { &raw mut (*(p as *mut $ty)).$field })
        };
    }
    match (s_type, feature) {
        (S::PHYSICAL_DEVICE_VULKAN_1_3_FEATURES, F::Synchronization2) => {
            at!(vk::PhysicalDeviceVulkan13Features, synchronization2)
        }
        (S::PHYSICAL_DEVICE_SYNCHRONIZATION_2_FEATURES, F::Synchronization2) => {
            at!(vk::PhysicalDeviceSynchronization2Features, synchronization2)
        }
        (S::PHYSICAL_DEVICE_VULKAN_1_2_FEATURES, F::TimelineSemaphore) => {
            at!(vk::PhysicalDeviceVulkan12Features, timeline_semaphore)
        }
        (S::PHYSICAL_DEVICE_TIMELINE_SEMAPHORE_FEATURES, F::TimelineSemaphore) => {
            at!(
                vk::PhysicalDeviceTimelineSemaphoreFeatures,
                timeline_semaphore
            )
        }
        (S::PHYSICAL_DEVICE_VULKAN_1_1_FEATURES, F::SamplerYcbcrConversion) => {
            at!(vk::PhysicalDeviceVulkan11Features, sampler_ycbcr_conversion)
        }
        (S::PHYSICAL_DEVICE_SAMPLER_YCBCR_CONVERSION_FEATURES, F::SamplerYcbcrConversion) => {
            at!(
                vk::PhysicalDeviceSamplerYcbcrConversionFeatures,
                sampler_ycbcr_conversion
            )
        }
        (S::PHYSICAL_DEVICE_YCBCR_2_PLANE_444_FORMATS_FEATURES_EXT, F::Ycbcr2Plane444Formats) => {
            at!(
                vk::PhysicalDeviceYcbcr2Plane444FormatsFeaturesEXT,
                ycbcr2plane444_formats
            )
        }
        (S::PHYSICAL_DEVICE_VIDEO_ENCODE_AV1_FEATURES_KHR, F::VideoEncodeAv1) => {
            at!(
                vk::PhysicalDeviceVideoEncodeAV1FeaturesKHR,
                video_encode_av1
            )
        }
        (
            S::PHYSICAL_DEVICE_VIDEO_ENCODE_RGB_CONVERSION_FEATURES_VALVE,
            F::VideoEncodeRgbConversion,
        ) => at!(
            vk::PhysicalDeviceVideoEncodeRgbConversionFeaturesVALVE,
            video_encode_rgb_conversion
        ),
        (
            S::PHYSICAL_DEVICE_VIDEO_ENCODE_INTRA_REFRESH_FEATURES_KHR,
            F::VideoEncodeIntraRefresh,
        ) => {
            at!(
                vk::PhysicalDeviceVideoEncodeIntraRefreshFeaturesKHR,
                video_encode_intra_refresh
            )
        }
        (
            S::PHYSICAL_DEVICE_VIDEO_ENCODE_QUANTIZATION_MAP_FEATURES_KHR,
            F::VideoEncodeQuantizationMap,
        ) => at!(
            vk::PhysicalDeviceVideoEncodeQuantizationMapFeaturesKHR,
            video_encode_quantization_map
        ),
        (
            S::PHYSICAL_DEVICE_INTERNALLY_SYNCHRONIZED_QUEUES_FEATURES_KHR,
            F::InternallySynchronizedQueues,
        ) => at!(
            vk::PhysicalDeviceInternallySynchronizedQueuesFeaturesKHR,
            internally_synchronized_queues
        ),
        _ => None,
    }
}

/// The encoder's feature bits merged into a device create info's pNext chain.
///
/// A bit the chain already has a place for is set there, in place, and put
/// back by [`Self::restore`] once vkCreateDevice has returned: the chain is
/// the application's memory and only borrowed. A bit it has no place for goes
/// in a struct of ours, placed in front of the application's chain so that
/// nothing of theirs has to be relinked.
pub struct FeaturePatch {
    restores: Vec<(*mut vk::Bool32, vk::Bool32)>,
    /// Our own structs, boxed so their addresses hold while the chain points
    /// at them: the Vec moves its elements when it grows, a box does not.
    #[allow(clippy::vec_box)]
    owned: Vec<Box<OwnedFeature>>,
}

/// A per-feature struct of ours. One variant per [`Feature`], since each is a
/// distinct Vulkan type.
enum OwnedFeature {
    Sync2(vk::PhysicalDeviceSynchronization2Features<'static>),
    Timeline(vk::PhysicalDeviceTimelineSemaphoreFeatures<'static>),
    Ycbcr(vk::PhysicalDeviceSamplerYcbcrConversionFeatures<'static>),
    Ycbcr444(vk::PhysicalDeviceYcbcr2Plane444FormatsFeaturesEXT<'static>),
    Av1(vk::PhysicalDeviceVideoEncodeAV1FeaturesKHR<'static>),
    Rgb(vk::PhysicalDeviceVideoEncodeRgbConversionFeaturesVALVE<'static>),
    IntraRefresh(vk::PhysicalDeviceVideoEncodeIntraRefreshFeaturesKHR<'static>),
    QpMap(vk::PhysicalDeviceVideoEncodeQuantizationMapFeaturesKHR<'static>),
    SharedQueues(vk::PhysicalDeviceInternallySynchronizedQueuesFeaturesKHR<'static>),
}

impl OwnedFeature {
    fn new(feature: Feature) -> Self {
        use Feature as F;
        match feature {
            F::Synchronization2 => Self::Sync2(
                vk::PhysicalDeviceSynchronization2Features::default().synchronization2(true),
            ),
            F::TimelineSemaphore => Self::Timeline(
                vk::PhysicalDeviceTimelineSemaphoreFeatures::default().timeline_semaphore(true),
            ),
            F::SamplerYcbcrConversion => Self::Ycbcr(
                vk::PhysicalDeviceSamplerYcbcrConversionFeatures::default()
                    .sampler_ycbcr_conversion(true),
            ),
            F::Ycbcr2Plane444Formats => Self::Ycbcr444(
                vk::PhysicalDeviceYcbcr2Plane444FormatsFeaturesEXT::default()
                    .ycbcr2plane444_formats(true),
            ),
            F::VideoEncodeAv1 => Self::Av1(
                vk::PhysicalDeviceVideoEncodeAV1FeaturesKHR::default().video_encode_av1(true),
            ),
            F::VideoEncodeRgbConversion => Self::Rgb(
                vk::PhysicalDeviceVideoEncodeRgbConversionFeaturesVALVE::default()
                    .video_encode_rgb_conversion(true),
            ),
            F::VideoEncodeIntraRefresh => Self::IntraRefresh(
                vk::PhysicalDeviceVideoEncodeIntraRefreshFeaturesKHR::default()
                    .video_encode_intra_refresh(true),
            ),
            F::VideoEncodeQuantizationMap => Self::QpMap(
                vk::PhysicalDeviceVideoEncodeQuantizationMapFeaturesKHR::default()
                    .video_encode_quantization_map(true),
            ),
            F::InternallySynchronizedQueues => Self::SharedQueues(
                vk::PhysicalDeviceInternallySynchronizedQueuesFeaturesKHR::default()
                    .internally_synchronized_queues(true),
            ),
        }
    }

    fn base(&mut self) -> *mut vk::BaseOutStructure<'static> {
        let p: *mut std::ffi::c_void = match self {
            Self::Sync2(s) => std::ptr::from_mut(s).cast(),
            Self::Timeline(s) => std::ptr::from_mut(s).cast(),
            Self::Ycbcr(s) => std::ptr::from_mut(s).cast(),
            Self::Ycbcr444(s) => std::ptr::from_mut(s).cast(),
            Self::Av1(s) => std::ptr::from_mut(s).cast(),
            Self::Rgb(s) => std::ptr::from_mut(s).cast(),
            Self::IntraRefresh(s) => std::ptr::from_mut(s).cast(),
            Self::QpMap(s) => std::ptr::from_mut(s).cast(),
            Self::SharedQueues(s) => std::ptr::from_mut(s).cast(),
        };
        p.cast()
    }
}

impl FeaturePatch {
    /// Turn on every feature in `wanted` for a device whose create info has
    /// `chain` as its pNext. Returns the patch and the pNext the create info
    /// should carry instead.
    ///
    /// # Safety
    ///
    /// `chain` must be a valid pNext chain, and must stay alive and untouched
    /// by anyone else until [`Self::restore`] is called.
    pub unsafe fn apply(
        chain: *const std::ffi::c_void,
        wanted: &[Feature],
    ) -> (Self, *const std::ffi::c_void) {
        let mut patch = Self {
            restores: Vec::new(),
            owned: Vec::new(),
        };
        let mut missing: Vec<Feature> = Vec::new();

        for &feature in wanted {
            let mut found = false;
            let mut p = chain as *mut vk::BaseOutStructure<'_>;
            while !p.is_null() {
                let s_type = unsafe { (*p).s_type };
                if let Some(bit) = unsafe { field(s_type, p, feature) } {
                    patch.restores.push((bit, unsafe { *bit }));
                    unsafe { *bit = vk::TRUE };
                    found = true;
                }
                p = unsafe { (*p).p_next };
            }
            if !found {
                missing.push(feature);
            }
        }

        let mut head = chain;
        for feature in missing.into_iter().rev() {
            let mut owned = Box::new(OwnedFeature::new(feature));
            let base = owned.base();
            unsafe { (*base).p_next = head as *mut _ };
            head = base as *const _;
            patch.owned.push(owned);
        }
        (patch, head)
    }

    /// Put the application's chain back as it was.
    ///
    /// # Safety
    ///
    /// The chain given to [`Self::apply`] must still be alive.
    pub unsafe fn restore(self) {
        for (bit, value) in self.restores.into_iter().rev() {
            unsafe { *bit = value };
        }
    }
}

// ── Extensions ────────────────────────────────────────────────────────────────

/// `game` with every name in `add` it does not already have, as pointers
/// valid for as long as `add`'s strings are (they are `'static`).
pub fn merged_extensions(
    game: &[*const std::ffi::c_char],
    add: &[&'static std::ffi::CStr],
) -> Vec<*const std::ffi::c_char> {
    let mut out = game.to_vec();
    for name in add {
        let present = out
            .iter()
            .any(|&p| unsafe { std::ffi::CStr::from_ptr(p) } == *name);
        if !present {
            out.push(name.as_ptr());
        }
    }
    out
}

/// Everything the device needs beyond what the game asked for: the pixelforge
/// requirements, and the queue plan that satisfies them.
pub struct Additions {
    pub requirements: DeviceRequirements,
    pub queues: QueuePlan,
}

impl Additions {
    /// The extensions to add, including the one queue sharing needs.
    pub fn extensions(&self) -> Vec<&'static std::ffi::CStr> {
        let mut names = self.requirements.extensions.clone();
        if !self.queues.internally_synchronized.is_empty() {
            names.push(ash::khr::internally_synchronized_queues::NAME);
        }
        names
    }

    pub fn features(&self) -> Vec<Feature> {
        wanted_features(
            &self.requirements.features,
            !self.queues.internally_synchronized.is_empty(),
        )
    }
}

// ── Device creation ───────────────────────────────────────────────────────────

thread_local! {
    /// Set while this layer creates a device of its own, through the loader
    /// and so through this very layer. Such a device is the encoder's own and
    /// gets nothing added: there is no game on it to share with.
    static OWN_DEVICE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Run `f`, which creates a device for the encoder's own use.
pub fn creating_own_device<T>(f: impl FnOnce() -> T) -> T {
    OWN_DEVICE.with(|own| own.set(true));
    let out = f();
    OWN_DEVICE.with(|own| own.set(false));
    out
}

/// Whether the device being created is one this layer asked for itself.
pub fn is_own_device() -> bool {
    OWN_DEVICE.with(|own| own.get())
}

/// The layer's view of the instance, as the encoder needs it: `ash` objects
/// whose calls go to the next layer down, never back into this one.
fn instance_view(istate: &crate::dispatch::NextInstanceFn) -> (ash::Entry, ash::Instance) {
    let static_fn = ash::StaticFn {
        get_instance_proc_addr: istate.get_instance_proc_addr,
    };
    let entry = unsafe { ash::Entry::from_static_fn(static_fn.clone()) };
    let instance = unsafe { ash::Instance::load(&static_fn, istate.instance) };
    (entry, instance)
}

/// The game's device create info with the encoder's additions, and the
/// storage the modified create info points into.
pub struct PreparedDevice {
    additions: Additions,
    entry: ash::Entry,
    instance: ash::Instance,
    queue_infos: Vec<vk::DeviceQueueCreateInfo<'static>>,
    /// Owns the priority arrays `queue_infos` points into.
    _priorities: Vec<Vec<f32>>,
    extensions: Vec<*const std::ffi::c_char>,
    patch: FeaturePatch,
    p_next: *const std::ffi::c_void,
}

/// Work out what to add to the game's device so the encoder can run on it.
///
/// `None`, with the reason logged, when the encoder cannot share this device:
/// the instance is older than Vulkan 1.1, the device cannot encode, or no queue
/// arrangement keeps the encoder's submissions from racing the game's.
///
/// # Safety
///
/// `ci` must be the create info the game passed to vkCreateDevice, and its
/// pNext chain must stay alive until [`PreparedDevice::finish`].
pub unsafe fn prepare(
    istate: &crate::dispatch::NextInstanceFn,
    physical_device: vk::PhysicalDevice,
    ci: &vk::DeviceCreateInfo<'_>,
    extensions: &[*const std::ffi::c_char],
) -> Option<PreparedDevice> {
    if is_own_device() {
        return None;
    }
    // The off switch. Changing how a game's device is created is the one
    // thing here a title could object to, so it can be turned off per title
    // without turning capture off.
    if std::env::var("NESCAPTURE_SHARED_DEVICE").as_deref() == Ok("0") {
        log::info!("NESCAPTURE_SHARED_DEVICE=0; encoding on a device of its own");
        return None;
    }
    if istate.api_version < vk::API_VERSION_1_1 {
        log::info!("instance asked for Vulkan 1.0; encoding on a device of its own");
        return None;
    }
    let (entry, instance) = instance_view(istate);
    let requirements = match pixelforge::VideoContextBuilder::new().encode_device_requirements(
        &entry,
        &instance,
        physical_device,
    ) {
        Ok(r) => r,
        Err(e) => {
            log::info!("the game's device cannot host the encoder ({e})");
            return None;
        }
    };

    let families = unsafe { instance.get_physical_device_queue_family_properties(physical_device) };
    let game_infos: &[vk::DeviceQueueCreateInfo<'_>] = if ci.queue_create_info_count == 0
        || ci.p_queue_create_infos.is_null()
    {
        &[]
    } else {
        unsafe {
            std::slice::from_raw_parts(ci.p_queue_create_infos, ci.queue_create_info_count as usize)
        }
    };
    let game: BTreeMap<u32, (u32, vk::DeviceQueueCreateFlags)> = game_infos
        .iter()
        .map(|q| (q.queue_family_index, (q.queue_count, q.flags)))
        .collect();

    let Some(queues) = plan_queues(
        &families,
        &game,
        requirements.queues.encode,
        requirements.internally_synchronized_queues,
    ) else {
        log::info!(
            "no queue for the encoder that the game does not submit to; \
             encoding on a device of its own"
        );
        return None;
    };
    log::info!(
        "encoder on the game's device: encode queue {:?}, compute queue {:?}, transfer queue {:?}{}",
        queues.encode,
        queues.compute,
        queues.transfer,
        if queues.internally_synchronized.is_empty() {
            String::new()
        } else {
            format!(
                ", sharing the game's queues in families {:?}",
                queues.internally_synchronized
            )
        }
    );

    // The game's queue create infos, copied, with counts raised and flags added
    // where the plan says. Families it did not ask for get an entry of ours.
    let mut priorities: Vec<Vec<f32>> = Vec::new();
    let mut queue_infos: Vec<vk::DeviceQueueCreateInfo<'static>> = Vec::new();
    for q in game_infos {
        let mut info: vk::DeviceQueueCreateInfo<'static> = unsafe { std::mem::transmute(*q) };
        if let Some(&count) = queues.counts.get(&q.queue_family_index) {
            let theirs =
                unsafe { std::slice::from_raw_parts(q.p_queue_priorities, q.queue_count as usize) };
            // The encoder's queue at the game's own priority, so neither side
            // gets to starve the other.
            let extra = theirs.first().copied().unwrap_or(1.0);
            let mut all = theirs.to_vec();
            all.resize(count as usize, extra);
            info.queue_count = count;
            info.p_queue_priorities = all.as_ptr();
            priorities.push(all);
        }
        if queues
            .internally_synchronized
            .contains(&q.queue_family_index)
        {
            info.flags |= vk::DeviceQueueCreateFlags::INTERNALLY_SYNCHRONIZED_KHR;
        }
        queue_infos.push(info);
    }
    for (&family, &count) in &queues.counts {
        if game.contains_key(&family) {
            continue;
        }
        let all = vec![1.0f32; count as usize];
        queue_infos.push(vk::DeviceQueueCreateInfo {
            queue_family_index: family,
            queue_count: count,
            p_queue_priorities: all.as_ptr(),
            ..Default::default()
        });
        priorities.push(all);
    }

    let additions = Additions {
        requirements,
        queues,
    };
    let extensions = merged_extensions(extensions, &additions.extensions());
    let (patch, p_next) = unsafe { FeaturePatch::apply(ci.p_next, &additions.features()) };

    Some(PreparedDevice {
        additions,
        entry,
        instance,
        queue_infos,
        _priorities: priorities,
        extensions,
        patch,
        p_next,
    })
}

impl PreparedDevice {
    /// `ci` with the additions in. Valid while `self` is.
    pub fn create_info<'a>(&'a self, ci: &vk::DeviceCreateInfo<'a>) -> vk::DeviceCreateInfo<'a> {
        let mut out = *ci;
        out.p_next = self.p_next;
        out.queue_create_info_count = self.queue_infos.len() as u32;
        out.p_queue_create_infos = self.queue_infos.as_ptr().cast();
        out.enabled_extension_count = self.extensions.len() as u32;
        out.pp_enabled_extension_names = self.extensions.as_ptr();
        out
    }

    /// Put the game's pNext chain back as it was, and return what is needed
    /// to hand the device to the encoder once it exists.
    ///
    /// # Safety
    ///
    /// The game's pNext chain must still be alive.
    pub unsafe fn finish(self) -> (Additions, ash::Entry, ash::Instance) {
        unsafe { self.patch.restore() };
        (self.additions, self.entry, self.instance)
    }
}

/// The game's device, as the encoder sees it.
pub struct SharedDevice {
    entry: ash::Entry,
    instance: ash::Instance,
    physical_device: vk::PhysicalDevice,
    device: ash::Device,
    pub queues: QueuePlan,
}

impl SharedDevice {
    /// Wrap the game's freshly created device for the encoder.
    ///
    /// The device's calls go to the next layer down, except `vkGetDeviceQueue`,
    /// which comes back to this layer's own hook: a queue created internally
    /// synchronized can only be fetched with vkGetDeviceQueue2, and the hook is
    /// what translates, for the encoder exactly as for the game.
    ///
    /// # Safety
    ///
    /// `device` must have been created from a [`PreparedDevice`] for the same
    /// instance, and `next_gdpa` must be the next layer's vkGetDeviceProcAddr.
    pub unsafe fn adopt(
        additions: Additions,
        entry: ash::Entry,
        instance: ash::Instance,
        physical_device: vk::PhysicalDevice,
        device: vk::Device,
        next_gdpa: crate::dispatch::PFN_vkGetDeviceProcAddr,
    ) -> Self {
        let device = unsafe {
            ash::Device::load_with(
                |name| {
                    if name == c"vkGetDeviceQueue" {
                        crate::device::vkGetDeviceQueue as *const std::ffi::c_void
                    } else {
                        next_gdpa(device, name.as_ptr())
                            .map_or(std::ptr::null(), |f| f as *const std::ffi::c_void)
                    }
                },
                device,
            )
        };
        Self {
            entry,
            instance,
            physical_device,
            device,
            queues: additions.queues,
        }
    }

    /// A pixelforge context on the game's device, submitting to the queues
    /// the plan set aside.
    pub fn video_context(&self) -> Result<pixelforge::VideoContext, pixelforge::PixelForgeError> {
        pixelforge::VideoContextBuilder::new()
            .app_name("nescapture")
            .with_encode_queue(self.queues.encode)
            .with_compute_queue(self.queues.compute)
            .with_transfer_queue(self.queues.transfer)
            .build_from_existing_encode(
                self.entry.clone(),
                self.instance.clone(),
                self.physical_device,
                self.device.clone(),
            )
    }

    /// The queue families that touch a capture image: the one the game
    /// presents on, where the blit runs, and the encoder's.
    pub fn image_families(&self, present_family: u32) -> Vec<u32> {
        let mut out = vec![present_family];
        for f in [self.queues.compute.family, self.queues.transfer.family] {
            if !out.contains(&f) {
                out.push(f);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn family(flags: vk::QueueFlags, count: u32) -> vk::QueueFamilyProperties {
        vk::QueueFamilyProperties {
            queue_flags: flags,
            queue_count: count,
            ..Default::default()
        }
    }

    const GFX: vk::QueueFlags = vk::QueueFlags::from_raw(
        vk::QueueFlags::GRAPHICS.as_raw()
            | vk::QueueFlags::COMPUTE.as_raw()
            | vk::QueueFlags::TRANSFER.as_raw(),
    );
    const COMPUTE: vk::QueueFlags = vk::QueueFlags::from_raw(
        vk::QueueFlags::COMPUTE.as_raw() | vk::QueueFlags::TRANSFER.as_raw(),
    );
    const ENCODE: vk::QueueFlags = vk::QueueFlags::VIDEO_ENCODE_KHR;

    fn game(entries: &[(u32, u32)]) -> BTreeMap<u32, (u32, vk::DeviceQueueCreateFlags)> {
        entries
            .iter()
            .map(|&(f, n)| (f, (n, vk::DeviceQueueCreateFlags::empty())))
            .collect()
    }

    /// An AMD card: one graphics queue, four compute, one encode.
    fn amd() -> Vec<vk::QueueFamilyProperties> {
        vec![family(GFX, 1), family(COMPUTE, 4), family(ENCODE, 1)]
    }

    #[test]
    fn spare_queues_keep_the_encoder_off_the_games_queue() {
        let plan = plan_queues(&amd(), &game(&[(0, 1)]), Some(2), false).unwrap();
        assert_eq!(plan.encode, DeviceQueue::new(2, 0));
        // Compute on the compute family, not on the game's graphics queue.
        assert_eq!(plan.compute, DeviceQueue::new(1, 0));
        // And copies share it: one thread submits both.
        assert_eq!(plan.transfer, plan.compute);
        assert!(plan.internally_synchronized.is_empty());
    }

    #[test]
    fn a_family_the_game_already_uses_gets_one_more_queue() {
        // The game took two of the four compute queues for itself.
        let plan = plan_queues(&amd(), &game(&[(0, 1), (1, 2)]), Some(2), false).unwrap();
        assert_eq!(plan.compute, DeviceQueue::new(1, 2));
        assert_eq!(plan.counts.get(&1), Some(&3));
    }

    #[test]
    fn with_every_capable_family_full_nothing_is_planned_unless_sharing_is_safe() {
        // The game took all four compute queues and its one graphics queue.
        let full = game(&[(0, 1), (1, 4)]);
        assert_eq!(plan_queues(&amd(), &full, Some(2), false), None);

        // Sharing picks the compute family over the graphics one, since the
        // game renders on the latter.
        let plan = plan_queues(&amd(), &full, Some(2), true).unwrap();
        assert_eq!(plan.compute, DeviceQueue::new(1, 0));
        assert_eq!(plan.internally_synchronized, vec![1]);
    }

    /// An Intel card: one queue that does everything, and a video family.
    fn intel() -> Vec<vk::QueueFamilyProperties> {
        vec![
            family(GFX, 1),
            family(
                vk::QueueFlags::VIDEO_ENCODE_KHR | vk::QueueFlags::VIDEO_DECODE_KHR,
                2,
            ),
        ]
    }

    #[test]
    fn without_a_spare_the_games_queue_is_shared_where_that_is_safe() {
        let plan = plan_queues(&intel(), &game(&[(0, 1)]), Some(1), true).unwrap();
        assert_eq!(plan.encode, DeviceQueue::new(1, 0));
        assert_eq!(plan.compute, DeviceQueue::new(0, 0));
        assert_eq!(plan.transfer, DeviceQueue::new(0, 0));
        assert_eq!(plan.internally_synchronized, vec![0]);
    }

    #[test]
    fn without_a_spare_or_a_safe_share_there_is_no_plan() {
        assert_eq!(
            plan_queues(&intel(), &game(&[(0, 1)]), Some(1), false),
            None
        );
    }

    #[test]
    fn a_protected_queue_is_never_shared() {
        let mut g = game(&[(0, 1)]);
        g.insert(0, (1, vk::DeviceQueueCreateFlags::PROTECTED));
        assert_eq!(plan_queues(&intel(), &g, Some(1), true), None);
    }

    #[test]
    fn a_game_that_already_encodes_keeps_its_encode_queue() {
        let mut families = amd();
        families[2].queue_count = 2;
        let plan = plan_queues(&families, &game(&[(0, 1), (2, 1)]), Some(2), false).unwrap();
        assert_eq!(plan.encode, DeviceQueue::new(2, 1));
    }

    #[test]
    fn features_are_set_where_the_game_already_chains_them() {
        let mut v13 = vk::PhysicalDeviceVulkan13Features::default();
        let mut v12 = vk::PhysicalDeviceVulkan12Features::default();
        v13.p_next = (&raw mut v12).cast();
        let chain = (&raw const v13).cast();

        let (patch, head) = unsafe {
            FeaturePatch::apply(
                chain,
                &[Feature::Synchronization2, Feature::TimelineSemaphore],
            )
        };
        // Nothing appended: both have a home in the game's structs, and a
        // per-feature struct next to its aggregate is invalid.
        assert_eq!(head, chain);
        assert_eq!(v13.synchronization2, vk::TRUE);
        assert_eq!(v12.timeline_semaphore, vk::TRUE);

        unsafe { patch.restore() };
        assert_eq!(v13.synchronization2, vk::FALSE);
        assert_eq!(v12.timeline_semaphore, vk::FALSE);
    }

    #[test]
    fn a_feature_with_no_home_gets_a_struct_in_front_of_the_chain() {
        let v12 = vk::PhysicalDeviceVulkan12Features::default();
        let chain = (&raw const v12).cast();
        let (patch, head) = unsafe { FeaturePatch::apply(chain, &[Feature::Synchronization2]) };
        assert_ne!(head, chain);
        let first = head as *const vk::BaseInStructure<'_>;
        unsafe {
            assert_eq!(
                (*first).s_type,
                vk::StructureType::PHYSICAL_DEVICE_SYNCHRONIZATION_2_FEATURES
            );
            assert_eq!((*first).p_next.cast(), chain);
        }
        unsafe { patch.restore() };
    }

    #[test]
    fn an_empty_chain_gets_every_struct() {
        let wanted = [
            Feature::Synchronization2,
            Feature::TimelineSemaphore,
            Feature::VideoEncodeAv1,
        ];
        let (patch, head) = unsafe { FeaturePatch::apply(std::ptr::null(), &wanted) };
        let mut seen = Vec::new();
        let mut p = head as *const vk::BaseInStructure<'_>;
        while !p.is_null() {
            seen.push(unsafe { (*p).s_type });
            p = unsafe { (*p).p_next };
        }
        assert_eq!(
            seen,
            vec![
                vk::StructureType::PHYSICAL_DEVICE_SYNCHRONIZATION_2_FEATURES,
                vk::StructureType::PHYSICAL_DEVICE_TIMELINE_SEMAPHORE_FEATURES,
                vk::StructureType::PHYSICAL_DEVICE_VIDEO_ENCODE_AV1_FEATURES_KHR,
            ]
        );
        unsafe { patch.restore() };
    }

    #[test]
    fn an_extension_the_game_already_enables_is_not_repeated() {
        let game = [ash::khr::synchronization2::NAME.as_ptr()];
        let merged = merged_extensions(
            &game,
            &[
                ash::khr::synchronization2::NAME,
                ash::khr::video_queue::NAME,
            ],
        );
        assert_eq!(merged.len(), 2);
    }
}
