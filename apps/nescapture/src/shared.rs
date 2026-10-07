// ─────────────────────────────────────────────────────────────────────────────
//  shared.rs — encoding on the game's own VkDevice
//
//  The encoder used to run on a device of its own, which meant every frame
//  crossed between two devices as exported memory, with a CPU wait in between
//  because two devices share no timeline. Here the game's device is created
//  with what the encoder needs, and the encoder is handed that device instead.
//
//  Two encoders can live there: pixelforge's Vulkan Video encoder and
//  nespyro's PyroWave. Each is checked on its own, and the device gets the
//  additions of whichever it can host — one, both, or, if neither, none.
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
use ash::vk::TaggedStructure;
use pixelforge::vulkan::{DeviceFeatures, DeviceQueue, DeviceRequirements};
use std::collections::BTreeMap;

// ── Queues ────────────────────────────────────────────────────────────────────

/// Which queue the encoder uses for each of its roles, and what that means for
/// the device's queue create infos.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuePlan {
    /// Vulkan Video encode, when pixelforge is hosted.
    pub encode: Option<DeviceQueue>,
    /// pixelforge's converter and all of nespyro. Both encoders submit from the
    /// one encoder thread, so they share it freely.
    pub compute: DeviceQueue,
    /// pixelforge's copies, when pixelforge is hosted.
    pub transfer: Option<DeviceQueue>,
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

/// Which roles a plan has to fill.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Wants {
    /// An encode queue, and the family the encoder would like it from.
    pub encode: Option<Option<u32>>,
    /// A transfer queue.
    pub transfer: bool,
}

impl Wants {
    /// What pixelforge needs: encode, compute and transfer.
    pub fn video(preferred_encode: Option<u32>) -> Self {
        Self {
            encode: Some(preferred_encode),
            transfer: true,
        }
    }

    /// What nespyro alone needs: compute, which every plan has.
    pub const PYRO_ONLY: Self = Self {
        encode: None,
        transfer: false,
    };
}

/// Pick a queue for every role `wants` names, and a compute queue always.
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
    wants: Wants,
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

    let encode = match wants.encode {
        Some(preferred) => Some(pick(
            vk::QueueFlags::VIDEO_ENCODE_KHR,
            preferred,
            &mut counts,
            &mut ours,
            &mut shared,
        )?),
        None => None,
    };
    let compute = pick(
        vk::QueueFlags::COMPUTE,
        None,
        &mut counts,
        &mut ours,
        &mut shared,
    )?;
    let transfer = if wants.transfer {
        Some(pick(
            vk::QueueFlags::TRANSFER,
            Some(compute.family),
            &mut counts,
            &mut ours,
            &mut shared,
        )?)
    } else {
        None
    };

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
    // nespyro's. The first two are Vulkan 1.0 core features, which live in
    // `VkPhysicalDeviceFeatures` rather than in a struct of their own.
    ShaderInt16,
    ShaderStorageImageWriteWithoutFormat,
    StorageBuffer16BitAccess,
    StorageBuffer8BitAccess,
    ShaderInt8,
    ShaderFloat16,
    BufferDeviceAddress,
    SubgroupSizeControl,
    ComputeFullSubgroups,
}

impl Feature {
    /// Whether this is a Vulkan 1.0 feature, set in `VkPhysicalDeviceFeatures`
    /// rather than in a pNext struct of its own.
    fn is_core(self) -> bool {
        matches!(
            self,
            Self::ShaderInt16 | Self::ShaderStorageImageWriteWithoutFormat
        )
    }
}

/// The features nespyro asks for.
pub fn pyro_features(f: &nespyro::DeviceFeatures) -> Vec<Feature> {
    use Feature as F;
    [
        (f.shader_int16, F::ShaderInt16),
        (
            f.shader_storage_image_write_without_format,
            F::ShaderStorageImageWriteWithoutFormat,
        ),
        (f.storage_buffer_16bit_access, F::StorageBuffer16BitAccess),
        (f.storage_buffer_8bit_access, F::StorageBuffer8BitAccess),
        (f.shader_int8, F::ShaderInt8),
        (f.shader_float16, F::ShaderFloat16),
        (f.timeline_semaphore, F::TimelineSemaphore),
        (f.buffer_device_address, F::BufferDeviceAddress),
        (f.synchronization2, F::Synchronization2),
        (f.subgroup_size_control, F::SubgroupSizeControl),
        (f.compute_full_subgroups, F::ComputeFullSubgroups),
    ]
    .into_iter()
    .filter_map(|(on, feature)| on.then_some(feature))
    .collect()
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
        (S::PHYSICAL_DEVICE_FEATURES_2, F::ShaderInt16) => Some(unsafe {
            &raw mut (*(p as *mut vk::PhysicalDeviceFeatures2))
                .features
                .shader_int16
        }),
        (S::PHYSICAL_DEVICE_FEATURES_2, F::ShaderStorageImageWriteWithoutFormat) => Some(unsafe {
            &raw mut (*(p as *mut vk::PhysicalDeviceFeatures2))
                .features
                .shader_storage_image_write_without_format
        }),
        (S::PHYSICAL_DEVICE_VULKAN_1_1_FEATURES, F::StorageBuffer16BitAccess) => {
            at!(
                vk::PhysicalDeviceVulkan11Features,
                storage_buffer16_bit_access
            )
        }
        (S::PHYSICAL_DEVICE_16BIT_STORAGE_FEATURES, F::StorageBuffer16BitAccess) => {
            at!(
                vk::PhysicalDevice16BitStorageFeatures,
                storage_buffer16_bit_access
            )
        }
        (S::PHYSICAL_DEVICE_VULKAN_1_2_FEATURES, F::StorageBuffer8BitAccess) => {
            at!(
                vk::PhysicalDeviceVulkan12Features,
                storage_buffer8_bit_access
            )
        }
        (S::PHYSICAL_DEVICE_8BIT_STORAGE_FEATURES, F::StorageBuffer8BitAccess) => {
            at!(
                vk::PhysicalDevice8BitStorageFeatures,
                storage_buffer8_bit_access
            )
        }
        (S::PHYSICAL_DEVICE_VULKAN_1_2_FEATURES, F::ShaderInt8) => {
            at!(vk::PhysicalDeviceVulkan12Features, shader_int8)
        }
        (S::PHYSICAL_DEVICE_SHADER_FLOAT16_INT8_FEATURES, F::ShaderInt8) => {
            at!(vk::PhysicalDeviceShaderFloat16Int8Features, shader_int8)
        }
        (S::PHYSICAL_DEVICE_VULKAN_1_2_FEATURES, F::ShaderFloat16) => {
            at!(vk::PhysicalDeviceVulkan12Features, shader_float16)
        }
        (S::PHYSICAL_DEVICE_SHADER_FLOAT16_INT8_FEATURES, F::ShaderFloat16) => {
            at!(vk::PhysicalDeviceShaderFloat16Int8Features, shader_float16)
        }
        (S::PHYSICAL_DEVICE_VULKAN_1_2_FEATURES, F::BufferDeviceAddress) => {
            at!(vk::PhysicalDeviceVulkan12Features, buffer_device_address)
        }
        (S::PHYSICAL_DEVICE_BUFFER_DEVICE_ADDRESS_FEATURES, F::BufferDeviceAddress) => {
            at!(
                vk::PhysicalDeviceBufferDeviceAddressFeatures,
                buffer_device_address
            )
        }
        (S::PHYSICAL_DEVICE_VULKAN_1_3_FEATURES, F::SubgroupSizeControl) => {
            at!(vk::PhysicalDeviceVulkan13Features, subgroup_size_control)
        }
        (S::PHYSICAL_DEVICE_SUBGROUP_SIZE_CONTROL_FEATURES, F::SubgroupSizeControl) => {
            at!(
                vk::PhysicalDeviceSubgroupSizeControlFeatures,
                subgroup_size_control
            )
        }
        (S::PHYSICAL_DEVICE_VULKAN_1_3_FEATURES, F::ComputeFullSubgroups) => {
            at!(vk::PhysicalDeviceVulkan13Features, compute_full_subgroups)
        }
        (S::PHYSICAL_DEVICE_SUBGROUP_SIZE_CONTROL_FEATURES, F::ComputeFullSubgroups) => {
            at!(
                vk::PhysicalDeviceSubgroupSizeControlFeatures,
                compute_full_subgroups
            )
        }
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
    Storage16(vk::PhysicalDevice16BitStorageFeatures<'static>),
    Storage8(vk::PhysicalDevice8BitStorageFeatures<'static>),
    Float16Int8(vk::PhysicalDeviceShaderFloat16Int8Features<'static>),
    Bda(vk::PhysicalDeviceBufferDeviceAddressFeatures<'static>),
    SubgroupSize(vk::PhysicalDeviceSubgroupSizeControlFeatures<'static>),
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
            F::StorageBuffer16BitAccess => Self::Storage16(
                vk::PhysicalDevice16BitStorageFeatures::default().storage_buffer16_bit_access(true),
            ),
            F::StorageBuffer8BitAccess => Self::Storage8(
                vk::PhysicalDevice8BitStorageFeatures::default().storage_buffer8_bit_access(true),
            ),
            F::ShaderInt8 => Self::Float16Int8(
                vk::PhysicalDeviceShaderFloat16Int8Features::default().shader_int8(true),
            ),
            F::ShaderFloat16 => Self::Float16Int8(
                vk::PhysicalDeviceShaderFloat16Int8Features::default().shader_float16(true),
            ),
            F::BufferDeviceAddress => Self::Bda(
                vk::PhysicalDeviceBufferDeviceAddressFeatures::default()
                    .buffer_device_address(true),
            ),
            F::SubgroupSizeControl => Self::SubgroupSize(
                vk::PhysicalDeviceSubgroupSizeControlFeatures::default()
                    .subgroup_size_control(true),
            ),
            F::ComputeFullSubgroups => Self::SubgroupSize(
                vk::PhysicalDeviceSubgroupSizeControlFeatures::default()
                    .compute_full_subgroups(true),
            ),
            F::ShaderInt16 | F::ShaderStorageImageWriteWithoutFormat => {
                unreachable!("core features have no struct of their own")
            }
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
            Self::Storage16(s) => std::ptr::from_mut(s).cast(),
            Self::Storage8(s) => std::ptr::from_mut(s).cast(),
            Self::Float16Int8(s) => std::ptr::from_mut(s).cast(),
            Self::Bda(s) => std::ptr::from_mut(s).cast(),
            Self::SubgroupSize(s) => std::ptr::from_mut(s).cast(),
        };
        p.cast()
    }
}

impl FeaturePatch {
    /// Turn on every feature in `wanted` for a device whose create info has
    /// `chain` as its pNext. Returns the patch, the pNext the create info
    /// should carry instead, and the Vulkan 1.0 features the chain had no
    /// `VkPhysicalDeviceFeatures2` to hold — those belong in
    /// `pEnabledFeatures`, see [`core_features`].
    ///
    /// Structs of ours are searched like the game's, so two features sharing
    /// one struct type land in one struct: a chain may hold each type once.
    ///
    /// # Safety
    ///
    /// `chain` must be a valid pNext chain, and must stay alive and untouched
    /// by anyone else until [`Self::restore`] is called.
    pub unsafe fn apply(
        chain: *const std::ffi::c_void,
        wanted: &[Feature],
    ) -> (Self, *const std::ffi::c_void, Vec<Feature>) {
        let mut patch = Self {
            restores: Vec::new(),
            owned: Vec::new(),
        };
        let mut core_missing: Vec<Feature> = Vec::new();
        // Ours sit in front of the game's chain, in the order they were added.
        let mut head = chain;

        for &feature in wanted {
            let mut found = false;
            let mut p = head as *mut vk::BaseOutStructure<'_>;
            while !p.is_null() {
                let s_type = unsafe { (*p).s_type };
                if let Some(bit) = unsafe { field(s_type, p, feature) } {
                    patch.restores.push((bit, unsafe { *bit }));
                    unsafe { *bit = vk::TRUE };
                    found = true;
                }
                p = unsafe { (*p).p_next };
            }
            if found {
                continue;
            }
            if feature.is_core() {
                core_missing.push(feature);
                continue;
            }
            let mut owned = Box::new(OwnedFeature::new(feature));
            let base = owned.base();
            unsafe { (*base).p_next = chain as *mut _ };
            match patch.owned.last_mut() {
                Some(last) => unsafe { (*last.base()).p_next = base },
                None => head = base as *const _,
            }
            patch.owned.push(owned);
        }
        (patch, head, core_missing)
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

/// `pEnabledFeatures` with `missing` turned on: the game's own, copied, or a
/// fresh set when it gave none.
///
/// Only used when the chain holds no `VkPhysicalDeviceFeatures2`, since the
/// two may not be given together, and with one the bits went there instead.
pub fn core_features(
    game: Option<&vk::PhysicalDeviceFeatures>,
    missing: &[Feature],
) -> vk::PhysicalDeviceFeatures {
    let mut out = game.copied().unwrap_or_default();
    for feature in missing {
        match feature {
            Feature::ShaderInt16 => out.shader_int16 = vk::TRUE,
            Feature::ShaderStorageImageWriteWithoutFormat => {
                out.shader_storage_image_write_without_format = vk::TRUE
            }
            other => debug_assert!(!other.is_core(), "{other:?} has no place here"),
        }
    }
    out
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

/// Everything the device needs beyond what the game asked for: each hosted
/// encoder's requirements, and the queue plan that satisfies them.
pub struct Additions {
    /// pixelforge's, when the device can encode Vulkan Video.
    pub video: Option<DeviceRequirements>,
    /// nespyro's, when the device can run PyroWave.
    pub pyro: Option<nespyro::DeviceRequirements>,
    pub queues: QueuePlan,
}

impl Additions {
    /// The extensions to add, including the one queue sharing needs. Each
    /// named once, however many encoders want it.
    pub fn extensions(&self) -> Vec<&'static std::ffi::CStr> {
        let mut names: Vec<&'static std::ffi::CStr> = Vec::new();
        let mut add = |name: &'static std::ffi::CStr| {
            if !names.contains(&name) {
                names.push(name);
            }
        };
        for name in self.video.iter().flat_map(|r| r.extensions.iter()) {
            add(name);
        }
        for name in self.pyro.iter().flat_map(|r| r.extensions.iter()) {
            add(name);
        }
        if !self.queues.internally_synchronized.is_empty() {
            add(ash::khr::internally_synchronized_queues::NAME);
        }
        names
    }

    /// Each named once, however many encoders want it.
    pub fn features(&self) -> Vec<Feature> {
        let share = !self.queues.internally_synchronized.is_empty();
        let mut out = match &self.video {
            Some(r) => wanted_features(&r.features, share),
            None => wanted_features(&DeviceFeatures::default(), share),
        };
        for f in self.pyro.iter().flat_map(|r| pyro_features(&r.features)) {
            if !out.contains(&f) {
                out.push(f);
            }
        }
        out
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

/// The chain [`instance_view`]'s `ash::Entry` resolves its commands through.
///
/// `ash::Entry` loads the instance-global commands — `vkCreateInstance`,
/// `vkEnumerateInstanceExtensionProperties` and the rest — by calling
/// `vkGetInstanceProcAddr` with a **null instance**. That is how the loader's
/// own entry point is meant to be called, and the loader answers such calls
/// itself. What we hold inside a layer is not the loader's pointer but the
/// next layer's, and in a well-formed chain a layer's `vkGetInstanceProcAddr`
/// is never called with a null instance — so a layer is under no obligation to
/// survive one, and they do not all survive one. Mesa's
/// `VK_LAYER_MESA_device_select` dereferences the handle to find its own
/// per-instance state and takes the process down with it, which is a segfault
/// in `vkCreateDevice` on any machine that has it installed — every Mesa
/// desktop, so nearly every AMD and Intel one.
///
/// So the instance we already have is substituted for the null.
/// `vkGetInstanceProcAddr(instance, name)` is valid for a global command and
/// returns the same pointer, and the layer below sees a handle it knows.
static ENTRY_CHAIN: std::sync::Mutex<Option<EntryChain>> = std::sync::Mutex::new(None);

#[derive(Clone, Copy)]
struct EntryChain {
    gipa: crate::dispatch::PFN_vkGetInstanceProcAddr,
    instance: vk::Instance,
}

// The handle is an opaque `u64` and the pointer is to code, so the pair is
// shareable; `vk::Instance` is simply not marked so.
unsafe impl Send for EntryChain {}

fn set_entry_chain(gipa: crate::dispatch::PFN_vkGetInstanceProcAddr, instance: vk::Instance) {
    // Last writer wins. A process with two instances resolves the global
    // commands through whichever chain prepared a device most recently, which
    // is harmless: the four of them are global, so every chain gives the same
    // answer. It matters only that the handle passed down belongs to a live
    // instance, and the one recorded here is live for as long as the device
    // being created on it.
    if let Ok(mut chain) = ENTRY_CHAIN.lock() {
        *chain = Some(EntryChain { gipa, instance });
    }
}

/// `vkGetInstanceProcAddr` with the null instance replaced. See [`ENTRY_CHAIN`].
unsafe extern "system" fn entry_gipa(
    instance: vk::Instance,
    name: *const std::ffi::c_char,
) -> vk::PFN_vkVoidFunction {
    let Some(chain) = ENTRY_CHAIN.lock().ok().and_then(|c| *c) else {
        // Nothing has prepared a device, so there is no chain to ask. Reporting
        // the command as absent is the honest answer and ash treats it as one.
        return None;
    };
    let handle = if instance == vk::Instance::null() {
        chain.instance
    } else {
        instance
    };
    unsafe { (chain.gipa)(handle, name) }
}

/// The layer's view of the instance, as the encoder needs it: `ash` objects
/// whose calls go to the next layer down, never back into this one.
///
/// `vkGetDeviceProcAddr` is the one entry point taken from the device chain
/// rather than asked of the instance one. `ash` resolves every extension's
/// device functions through the instance's copy of it, and inside a layer the
/// instance chain has no usable answer for that name: the result was a null
/// pointer, called the first time anything loaded an extension.
fn instance_view(
    istate: &crate::dispatch::NextInstanceFn,
    next_gdpa: crate::dispatch::PFN_vkGetDeviceProcAddr,
) -> (ash::Entry, ash::Instance) {
    let gipa = istate.get_instance_proc_addr;
    // Not `istate.get_instance_proc_addr` directly: see `entry_gipa`.
    set_entry_chain(gipa, istate.instance);
    let static_fn = ash::StaticFn {
        get_instance_proc_addr: entry_gipa,
    };
    let entry = unsafe { ash::Entry::from_static_fn(static_fn) };
    let handle = istate.instance;
    let instance = unsafe {
        ash::Instance::load_with(
            |name| {
                if name == c"vkGetDeviceProcAddr" {
                    next_gdpa as *const std::ffi::c_void
                } else {
                    gipa(handle, name.as_ptr())
                        .map_or(std::ptr::null(), |f| f as *const std::ffi::c_void)
                }
            },
            handle,
        )
    };
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
    /// The 1.0 features, when they had to go in `pEnabledFeatures`.
    enabled_features: Option<Box<vk::PhysicalDeviceFeatures>>,
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
    next_gdpa: crate::dispatch::PFN_vkGetDeviceProcAddr,
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
    let (entry, instance) = instance_view(istate, next_gdpa);
    let video = match pixelforge::VideoContextBuilder::new().encode_device_requirements(
        &entry,
        &instance,
        physical_device,
    ) {
        Ok(r) => Some(r),
        Err(e) => {
            log::info!("the game's device cannot host Vulkan Video encode ({e})");
            None
        }
    };
    // nespyro uses Vulkan 1.3 commands, which a device only has when its
    // instance asked for 1.3 as well as the GPU having it.
    let pyro = if istate.api_version < vk::API_VERSION_1_3 {
        log::info!("instance is below Vulkan 1.3; no PyroWave on the game's device");
        None
    } else {
        match nespyro::DeviceRequirements::query(&instance, physical_device, nespyro::Roles::ENCODE)
        {
            Ok(r) => Some(r),
            Err(e) => {
                log::info!("the game's device cannot host PyroWave ({e})");
                None
            }
        }
    };
    if video.is_none() && pyro.is_none() {
        log::info!("neither encoder fits the game's device; encoding on a device of its own");
        return None;
    }
    let internally_synchronized_queues = match &video {
        Some(r) => r.internally_synchronized_queues,
        None => supports_internally_synchronized_queues(&instance, physical_device),
    };
    let wants = match &video {
        Some(r) => Wants::video(r.queues.encode),
        None => Wants::PYRO_ONLY,
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

    let Some(queues) = plan_queues(&families, &game, wants, internally_synchronized_queues) else {
        log::info!(
            "no queue for the encoder that the game does not submit to; \
             encoding on a device of its own"
        );
        return None;
    };
    log::info!(
        "encoders on the game's device ({}): encode queue {:?}, compute queue {:?}, transfer queue {:?}{}",
        match (video.is_some(), pyro.is_some()) {
            (true, true) => "Vulkan Video and PyroWave",
            (true, false) => "Vulkan Video",
            _ => "PyroWave",
        },
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
        video,
        pyro,
        queues,
    };
    let extensions = merged_extensions(extensions, &additions.extensions());
    let (patch, p_next, core_missing) =
        unsafe { FeaturePatch::apply(ci.p_next, &additions.features()) };
    let enabled_features = (!core_missing.is_empty()).then(|| {
        let game = unsafe { ci.p_enabled_features.as_ref() };
        Box::new(core_features(game, &core_missing))
    });

    Some(PreparedDevice {
        additions,
        entry,
        instance,
        queue_infos,
        _priorities: priorities,
        extensions,
        patch,
        p_next,
        enabled_features,
    })
}

/// Whether `physical_device` supports `VK_KHR_internally_synchronized_queues`,
/// extension and feature both. pixelforge answers this when it is hosted; this
/// is the same question for a device hosting only nespyro.
fn supports_internally_synchronized_queues(
    instance: &ash::Instance,
    physical_device: vk::PhysicalDevice,
) -> bool {
    let Ok(exts) = (unsafe { instance.enumerate_device_extension_properties(physical_device) })
    else {
        return false;
    };
    if !exts.iter().any(|e| {
        e.extension_name_as_c_str()
            .is_ok_and(|n| n == ash::khr::internally_synchronized_queues::NAME)
    }) {
        return false;
    }
    let mut features = vk::PhysicalDeviceInternallySynchronizedQueuesFeaturesKHR::default();
    let mut query = vk::PhysicalDeviceFeatures2::default().push(&mut features);
    unsafe { instance.get_physical_device_features2(physical_device, &mut query) };
    features.internally_synchronized_queues != 0
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
        if let Some(features) = &self.enabled_features {
            out.p_enabled_features = &raw const **features;
        }
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
    /// Timeline semaphore queries through their KHR names, which a device
    /// created below Vulkan 1.2 still has: the encoder enabled the extension.
    timeline: ash::khr::timeline_semaphore::Device,
    pub queues: QueuePlan,
    /// Which encoders the device was created for.
    video: bool,
    pyro: bool,
}

impl SharedDevice {
    /// Wrap the game's freshly created device for the encoder.
    ///
    /// The device's calls go to the next layer down, with two exceptions that
    /// come back to this layer. `vkGetDeviceQueue`, because a queue created
    /// internally synchronized can only be fetched with vkGetDeviceQueue2, and
    /// the hook is what translates, for the encoder exactly as for the game.
    /// And `vkAllocateCommandBuffers`, because the encoder's command buffers
    /// never pass through the loader and have to be given its dispatch data by
    /// hand; see [`crate::device::stamp`]. The hooked `vkGetDeviceQueue` does
    /// the same for the encoder's queues.
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
                    } else if name == c"vkAllocateCommandBuffers" {
                        crate::device::encoder_allocate_command_buffers as *const std::ffi::c_void
                    } else {
                        next_gdpa(device, name.as_ptr())
                            .map_or(std::ptr::null(), |f| f as *const std::ffi::c_void)
                    }
                },
                device,
            )
        };
        let timeline = ash::khr::timeline_semaphore::Device::load(&instance, &device);
        Self {
            entry,
            instance,
            physical_device,
            device,
            timeline,
            queues: additions.queues,
            video: additions.video.is_some(),
            pyro: additions.pyro.is_some(),
        }
    }

    /// A new timeline semaphore at zero.
    pub fn create_timeline(&self) -> Option<vk::Semaphore> {
        let mut kind = vk::SemaphoreTypeCreateInfo::default()
            .semaphore_type(vk::SemaphoreType::TIMELINE)
            .initial_value(0);
        let info = vk::SemaphoreCreateInfo::default().push(&mut kind);
        unsafe { self.device.create_semaphore(&info, None) }.ok()
    }

    pub fn destroy_timeline(&self, semaphore: vk::Semaphore) {
        unsafe { self.device.destroy_semaphore(semaphore, None) };
    }

    /// The value `semaphore` has reached, without waiting.
    pub fn counter(&self, semaphore: vk::Semaphore) -> Option<u64> {
        unsafe { self.timeline.get_semaphore_counter_value(semaphore) }.ok()
    }

    /// Whether `point` has been reached, without waiting.
    pub fn reached(&self, point: pixelforge::TimelinePoint) -> bool {
        unsafe { self.timeline.get_semaphore_counter_value(point.semaphore) }
            .is_ok_and(|v| v >= point.value)
    }

    /// Wait up to `timeout` for `point`. Whether it was reached.
    pub fn wait(&self, point: pixelforge::TimelinePoint, timeout: std::time::Duration) -> bool {
        let semaphores = [point.semaphore];
        let values = [point.value];
        let info = vk::SemaphoreWaitInfo::default()
            .semaphores(&semaphores)
            .values(&values);
        unsafe {
            self.timeline
                .wait_semaphores(&info, timeout.as_nanos() as u64)
        }
        .is_ok()
    }

    /// A pixelforge context on the game's device, submitting to the queues
    /// the plan set aside. `None` when the device was not created for it.
    pub fn video_context(
        &self,
    ) -> Option<Result<pixelforge::VideoContext, pixelforge::PixelForgeError>> {
        if !self.video {
            return None;
        }
        let (Some(encode), Some(transfer)) = (self.queues.encode, self.queues.transfer) else {
            return None;
        };
        Some(
            pixelforge::VideoContextBuilder::new()
                .app_name("nescapture")
                .with_encode_queue(encode)
                .with_compute_queue(self.queues.compute)
                .with_transfer_queue(transfer)
                .build_from_existing_encode(
                    self.entry.clone(),
                    self.instance.clone(),
                    self.physical_device,
                    self.device.clone(),
                ),
        )
    }

    /// A nespyro context on the game's device, on the plan's compute queue.
    /// `None` when the device was not created for it.
    ///
    /// No queue lock: the encoder thread is the only submitter to that queue
    /// apart from a game sharing it, and a queue shared with the game was
    /// created internally synchronized.
    pub fn pyro_context(&self) -> Option<Result<nespyro::Context, nespyro::Error>> {
        self.pyro.then(|| {
            nespyro::Context::from_existing(
                self.instance.clone(),
                self.physical_device,
                self.device.clone(),
                nespyro::DeviceQueue::new(self.queues.compute.family, self.queues.compute.index),
                nespyro::QueueLock::none(),
                nespyro::Roles::ENCODE,
            )
        })
    }

    /// The queue families that touch a capture image: the one the game
    /// presents on, where the blit runs, and the encoder's.
    pub fn image_families(&self, present_family: u32) -> Vec<u32> {
        let mut out = vec![present_family];
        let transfer = self.queues.transfer.map(|q| q.family);
        for f in std::iter::once(self.queues.compute.family).chain(transfer) {
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
        let plan = plan_queues(&amd(), &game(&[(0, 1)]), Wants::video(Some(2)), false).unwrap();
        assert_eq!(plan.encode, Some(DeviceQueue::new(2, 0)));
        // Compute on the compute family, not on the game's graphics queue.
        assert_eq!(plan.compute, DeviceQueue::new(1, 0));
        // And copies share it: one thread submits both.
        assert_eq!(plan.transfer, Some(plan.compute));
        assert!(plan.internally_synchronized.is_empty());
    }

    #[test]
    fn a_family_the_game_already_uses_gets_one_more_queue() {
        // The game took two of the four compute queues for itself.
        let plan = plan_queues(
            &amd(),
            &game(&[(0, 1), (1, 2)]),
            Wants::video(Some(2)),
            false,
        )
        .unwrap();
        assert_eq!(plan.compute, DeviceQueue::new(1, 2));
        assert_eq!(plan.counts.get(&1), Some(&3));
    }

    #[test]
    fn with_every_capable_family_full_nothing_is_planned_unless_sharing_is_safe() {
        // The game took all four compute queues and its one graphics queue.
        let full = game(&[(0, 1), (1, 4)]);
        assert_eq!(
            plan_queues(&amd(), &full, Wants::video(Some(2)), false),
            None
        );

        // Sharing picks the compute family over the graphics one, since the
        // game renders on the latter.
        let plan = plan_queues(&amd(), &full, Wants::video(Some(2)), true).unwrap();
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
        let plan = plan_queues(&intel(), &game(&[(0, 1)]), Wants::video(Some(1)), true).unwrap();
        assert_eq!(plan.encode, Some(DeviceQueue::new(1, 0)));
        assert_eq!(plan.compute, DeviceQueue::new(0, 0));
        assert_eq!(plan.transfer, Some(DeviceQueue::new(0, 0)));
        assert_eq!(plan.internally_synchronized, vec![0]);
    }

    #[test]
    fn without_a_spare_or_a_safe_share_there_is_no_plan() {
        assert_eq!(
            plan_queues(&intel(), &game(&[(0, 1)]), Wants::video(Some(1)), false),
            None
        );
    }

    #[test]
    fn a_protected_queue_is_never_shared() {
        let mut g = game(&[(0, 1)]);
        g.insert(0, (1, vk::DeviceQueueCreateFlags::PROTECTED));
        assert_eq!(plan_queues(&intel(), &g, Wants::video(Some(1)), true), None);
    }

    #[test]
    fn a_game_that_already_encodes_keeps_its_encode_queue() {
        let mut families = amd();
        families[2].queue_count = 2;
        let plan = plan_queues(
            &families,
            &game(&[(0, 1), (2, 1)]),
            Wants::video(Some(2)),
            false,
        )
        .unwrap();
        assert_eq!(plan.encode, Some(DeviceQueue::new(2, 1)));
    }

    #[test]
    fn features_are_set_where_the_game_already_chains_them() {
        let mut v13 = vk::PhysicalDeviceVulkan13Features::default();
        let mut v12 = vk::PhysicalDeviceVulkan12Features::default();
        v13.p_next = (&raw mut v12).cast();
        let chain = (&raw const v13).cast();

        let (patch, head, _) = unsafe {
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
        let (patch, head, _) = unsafe { FeaturePatch::apply(chain, &[Feature::Synchronization2]) };
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
        let (patch, head, _) = unsafe { FeaturePatch::apply(std::ptr::null(), &wanted) };
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

    // ── PyroWave beside, or instead of, Vulkan Video ─────────────────────────

    /// A GPU with no video encode family still gets a compute queue of its
    /// own for nespyro, and no encode or transfer queue it would not use.
    #[test]
    fn pyrowave_alone_plans_only_compute() {
        let families = vec![family(GFX, 1), family(COMPUTE, 2)];
        let plan = plan_queues(&families, &game(&[(0, 1)]), Wants::PYRO_ONLY, false).unwrap();
        assert_eq!(plan.compute, DeviceQueue::new(1, 0));
        assert_eq!(plan.encode, None);
        assert_eq!(plan.transfer, None);
        assert!(plan.internally_synchronized.is_empty());
    }

    /// Without the video family there is nothing to plan an encode queue on,
    /// and asking for one must fail rather than quietly skip it.
    #[test]
    fn vulkan_video_without_an_encode_family_has_no_plan() {
        let families = vec![family(GFX, 1), family(COMPUTE, 2)];
        assert_eq!(
            plan_queues(&families, &game(&[(0, 1)]), Wants::video(None), true),
            None
        );
    }

    /// Two features of one struct type must land in one struct: a pNext chain
    /// may hold each type once, and int8 and float16 share
    /// `VkPhysicalDeviceShaderFloat16Int8Features`.
    #[test]
    fn features_sharing_a_struct_share_one_of_ours() {
        let wanted = [
            Feature::ShaderInt8,
            Feature::ShaderFloat16,
            Feature::SubgroupSizeControl,
            Feature::ComputeFullSubgroups,
        ];
        let (patch, head, core) = unsafe { FeaturePatch::apply(std::ptr::null(), &wanted) };
        assert!(core.is_empty());
        let mut seen = Vec::new();
        let mut p = head as *const vk::BaseInStructure<'_>;
        while !p.is_null() {
            seen.push(unsafe { (*p).s_type });
            p = unsafe { (*p).p_next };
        }
        assert_eq!(
            seen,
            vec![
                vk::StructureType::PHYSICAL_DEVICE_SHADER_FLOAT16_INT8_FEATURES,
                vk::StructureType::PHYSICAL_DEVICE_SUBGROUP_SIZE_CONTROL_FEATURES,
            ]
        );
        let f = unsafe { &*(head as *const vk::PhysicalDeviceShaderFloat16Int8Features<'_>) };
        assert_eq!((f.shader_int8, f.shader_float16), (vk::TRUE, vk::TRUE));
        unsafe { patch.restore() };
    }

    /// Ours go in front of the game's chain, which is then still reachable
    /// from the head and left as it was.
    #[test]
    fn our_structs_lead_into_the_games_chain() {
        let v11 = vk::PhysicalDeviceVulkan11Features::default();
        let chain = (&raw const v11).cast();
        let (patch, head, _) = unsafe {
            FeaturePatch::apply(
                chain,
                &[
                    Feature::BufferDeviceAddress,
                    Feature::StorageBuffer16BitAccess,
                ],
            )
        };
        let first = head as *const vk::BaseInStructure<'_>;
        unsafe {
            assert_eq!(
                (*first).s_type,
                vk::StructureType::PHYSICAL_DEVICE_BUFFER_DEVICE_ADDRESS_FEATURES
            );
            assert_eq!((*first).p_next.cast(), chain, "the game's chain was lost");
        }
        // 16-bit storage had a home in the game's Vulkan 1.1 struct.
        assert_eq!(v11.storage_buffer16_bit_access, vk::TRUE);
        unsafe { patch.restore() };
        assert_eq!(v11.storage_buffer16_bit_access, vk::FALSE);
    }

    /// The 1.0 features live in `VkPhysicalDeviceFeatures`. Inside a chained
    /// `VkPhysicalDeviceFeatures2` they are set there and put back after.
    #[test]
    fn core_features_go_in_a_chained_features2() {
        let mut f2 = vk::PhysicalDeviceFeatures2::default();
        f2.features.shader_int16 = vk::FALSE;
        let chain = (&raw const f2).cast();
        let (patch, head, core) = unsafe {
            FeaturePatch::apply(
                chain,
                &[
                    Feature::ShaderInt16,
                    Feature::ShaderStorageImageWriteWithoutFormat,
                ],
            )
        };
        assert!(core.is_empty(), "Features2 was there to hold them");
        assert_eq!(head, chain);
        assert_eq!(f2.features.shader_int16, vk::TRUE);
        assert_eq!(
            f2.features.shader_storage_image_write_without_format,
            vk::TRUE
        );
        unsafe { patch.restore() };
        assert_eq!(f2.features.shader_int16, vk::FALSE);
    }

    /// Without one they are reported, never chained as a struct of their own:
    /// a Features2 of ours beside the game's `pEnabledFeatures` is invalid.
    #[test]
    fn core_features_without_features2_are_handed_back() {
        let (patch, head, core) = unsafe {
            FeaturePatch::apply(
                std::ptr::null(),
                &[Feature::ShaderInt16, Feature::ShaderInt8],
            )
        };
        assert_eq!(core, vec![Feature::ShaderInt16]);
        let first = head as *const vk::BaseInStructure<'_>;
        unsafe {
            assert_eq!(
                (*first).s_type,
                vk::StructureType::PHYSICAL_DEVICE_SHADER_FLOAT16_INT8_FEATURES
            );
            assert!((*first).p_next.is_null());
        }
        unsafe { patch.restore() };
    }

    /// The game's own `pEnabledFeatures` is copied, never written: it is the
    /// game's memory, and the copy keeps every bit it asked for.
    #[test]
    fn enabled_features_are_a_copy_with_ours_added() {
        let game = vk::PhysicalDeviceFeatures {
            geometry_shader: vk::TRUE,
            ..Default::default()
        };
        let ours = core_features(
            Some(&game),
            &[
                Feature::ShaderInt16,
                Feature::ShaderStorageImageWriteWithoutFormat,
            ],
        );
        assert_eq!(ours.geometry_shader, vk::TRUE);
        assert_eq!(ours.shader_int16, vk::TRUE);
        assert_eq!(ours.shader_storage_image_write_without_format, vk::TRUE);
        assert_eq!(game.shader_int16, vk::FALSE);

        let fresh = core_features(None, &[Feature::ShaderInt16]);
        assert_eq!(fresh.shader_int16, vk::TRUE);
        assert_eq!(fresh.geometry_shader, vk::FALSE);
    }

    #[test]
    fn nespyro_features_map_to_ours() {
        let f = nespyro::DeviceFeatures {
            shader_int16: true,
            shader_float16: true,
            subgroup_size_control: true,
            ..Default::default()
        };
        assert_eq!(
            pyro_features(&f),
            vec![
                Feature::ShaderInt16,
                Feature::ShaderFloat16,
                Feature::SubgroupSizeControl
            ]
        );
    }

    // ── The null instance a layer below need not survive ─────────────────────

    /// On construction `ash::Entry` asks for the instance-global commands with
    /// no instance. The layer below must never see that null: Mesa's
    /// device_select layer dereferences it. A real instance goes down instead,
    /// and an instance the caller did name is left alone.
    ///
    /// One test rather than two because the chain is process-wide, and two
    /// would race each other for it.
    #[test]
    fn the_null_instance_never_reaches_the_layer_below() {
        use ash::vk::Handle;
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEEN: AtomicU64 = AtomicU64::new(u64::MAX);

        unsafe extern "system" fn record(
            instance: vk::Instance,
            _name: *const std::ffi::c_char,
        ) -> vk::PFN_vkVoidFunction {
            SEEN.store(instance.as_raw(), Ordering::SeqCst);
            None
        }

        set_entry_chain(record, vk::Instance::from_raw(0xfeed_beef));

        unsafe {
            entry_gipa(
                vk::Instance::null(),
                c"vkEnumerateInstanceExtensionProperties".as_ptr(),
            )
        };
        assert_eq!(
            SEEN.load(Ordering::SeqCst),
            0xfeed_beef,
            "the null was passed down instead of the instance we hold"
        );

        unsafe { entry_gipa(vk::Instance::from_raw(0x2222), c"vkCreateDevice".as_ptr()) };
        assert_eq!(
            SEEN.load(Ordering::SeqCst),
            0x2222,
            "an instance the caller named was substituted"
        );
    }
}
