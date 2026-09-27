//! What nespyro needs from a device, and the handle to one it runs on.
//!
//! nespyro never creates a device. Both of its callers already have one: the
//! capture layer runs on the game's, the client on its renderer's. So the
//! flow is pixelforge's adopted-device one: ask [`DeviceRequirements::query`]
//! what to enable, merge that into the device being created, then wrap the
//! finished device with [`Context::from_existing`].

use std::ffi::CStr;
use std::sync::Arc;

use ash::vk;
use ash::vk::TaggedStructure as _;

use crate::error::{Error, Result};
use crate::sync::QueueLock;

/// Which halves of the codec a device is being set up for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Roles {
    pub encode: bool,
    pub decode: bool,
}

impl Roles {
    pub const ENCODE: Self = Self {
        encode: true,
        decode: false,
    };
    pub const DECODE: Self = Self {
        encode: false,
        decode: true,
    };
    pub const BOTH: Self = Self {
        encode: true,
        decode: true,
    };
}

/// Device features nespyro needs, as booleans rather than a `pNext` chain.
///
/// A caller merging these into its own device creation may already chain
/// `VkPhysicalDeviceVulkan12Features` and friends, and Vulkan forbids chaining
/// those alongside the structs they contain, so nespyro names the bits and the
/// caller sets them wherever it keeps them. Field names match Vulkan's.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DeviceFeatures {
    /// Vulkan 1.0.
    pub shader_int16: bool,
    pub shader_storage_image_write_without_format: bool,
    /// Vulkan 1.1.
    pub storage_buffer_16bit_access: bool,
    /// Vulkan 1.2.
    pub storage_buffer_8bit_access: bool,
    pub shader_int8: bool,
    /// Required by the encoder, whose quantizer and rate control compute in
    /// FP16. Asked of a decode-only device only when it has it: the inverse
    /// transform then keeps its tile in native half2 rather than packing it.
    pub shader_float16: bool,
    pub timeline_semaphore: bool,
    pub buffer_device_address: bool,
    /// Vulkan 1.3.
    pub synchronization2: bool,
    pub subgroup_size_control: bool,
    pub compute_full_subgroups: bool,
}

impl DeviceFeatures {
    fn for_roles(roles: Roles, available: &Self) -> Self {
        Self {
            shader_int16: true,
            shader_storage_image_write_without_format: true,
            storage_buffer_16bit_access: true,
            storage_buffer_8bit_access: true,
            shader_int8: true,
            shader_float16: roles.encode || available.shader_float16,
            timeline_semaphore: true,
            buffer_device_address: true,
            synchronization2: true,
            subgroup_size_control: true,
            compute_full_subgroups: true,
        }
    }

    fn query(instance: &ash::Instance, physical_device: vk::PhysicalDevice) -> Self {
        let mut v11 = vk::PhysicalDeviceVulkan11Features::default();
        let mut v12 = vk::PhysicalDeviceVulkan12Features::default();
        let mut v13 = vk::PhysicalDeviceVulkan13Features::default();
        let mut f2 = vk::PhysicalDeviceFeatures2::default()
            .push(&mut v11)
            .push(&mut v12)
            .push(&mut v13);
        unsafe { instance.get_physical_device_features2(physical_device, &mut f2) };
        let f = f2.features;
        Self {
            shader_int16: f.shader_int16 != 0,
            shader_storage_image_write_without_format: f.shader_storage_image_write_without_format
                != 0,
            storage_buffer_16bit_access: v11.storage_buffer16_bit_access != 0,
            storage_buffer_8bit_access: v12.storage_buffer8_bit_access != 0,
            shader_int8: v12.shader_int8 != 0,
            shader_float16: v12.shader_float16 != 0,
            timeline_semaphore: v12.timeline_semaphore != 0,
            buffer_device_address: v12.buffer_device_address != 0,
            synchronization2: v13.synchronization2 != 0,
            subgroup_size_control: v13.subgroup_size_control != 0,
            compute_full_subgroups: v13.compute_full_subgroups != 0,
        }
    }

    /// The names of the features `self` needs that `available` lacks.
    fn missing_from(&self, available: &Self) -> Vec<&'static str> {
        let pairs = [
            (self.shader_int16, available.shader_int16, "shaderInt16"),
            (
                self.shader_storage_image_write_without_format,
                available.shader_storage_image_write_without_format,
                "shaderStorageImageWriteWithoutFormat",
            ),
            (
                self.storage_buffer_16bit_access,
                available.storage_buffer_16bit_access,
                "storageBuffer16BitAccess",
            ),
            (
                self.storage_buffer_8bit_access,
                available.storage_buffer_8bit_access,
                "storageBuffer8BitAccess",
            ),
            (self.shader_int8, available.shader_int8, "shaderInt8"),
            (
                self.shader_float16,
                available.shader_float16,
                "shaderFloat16",
            ),
            (
                self.timeline_semaphore,
                available.timeline_semaphore,
                "timelineSemaphore",
            ),
            (
                self.buffer_device_address,
                available.buffer_device_address,
                "bufferDeviceAddress",
            ),
            (
                self.synchronization2,
                available.synchronization2,
                "synchronization2",
            ),
            (
                self.subgroup_size_control,
                available.subgroup_size_control,
                "subgroupSizeControl",
            ),
            (
                self.compute_full_subgroups,
                available.compute_full_subgroups,
                "computeFullSubgroups",
            ),
        ];
        pairs
            .into_iter()
            .filter(|(need, have, _)| *need && !*have)
            .map(|(_, _, name)| name)
            .collect()
    }
}

/// Everything a device must be created with for nespyro to run on it.
#[derive(Debug, Clone)]
pub struct DeviceRequirements {
    /// A compute-capable family nespyro would like a queue from: one without
    /// graphics where the device has it, so the codec runs beside rendering
    /// rather than behind it. Any compute-capable family works.
    pub queue_family: u32,
    /// Device extensions to enable. Merge with your own.
    pub extensions: Vec<&'static CStr>,
    /// Device features to enable. Merge with your own.
    pub features: DeviceFeatures,
}

/// Subgroup operations each half needs, from upstream's own checks.
fn required_subgroup_ops(roles: Roles) -> vk::SubgroupFeatureFlags {
    let mut ops = vk::SubgroupFeatureFlags::BASIC
        | vk::SubgroupFeatureFlags::VOTE
        | vk::SubgroupFeatureFlags::ARITHMETIC
        | vk::SubgroupFeatureFlags::BALLOT
        | vk::SubgroupFeatureFlags::SHUFFLE
        | vk::SubgroupFeatureFlags::SHUFFLE_RELATIVE;
    if roles.encode {
        ops |= vk::SubgroupFeatureFlags::CLUSTERED;
    }
    ops
}

/// A device's subgroup properties, as far as nespyro cares.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Subgroups {
    pub min: u32,
    pub max: u32,
    pub ops: vk::SubgroupFeatureFlags,
    pub stages: vk::ShaderStageFlags,
    pub required_size_stages: vk::ShaderStageFlags,
}

impl Subgroups {
    fn query(instance: &ash::Instance, physical_device: vk::PhysicalDevice) -> Self {
        let mut v11 = vk::PhysicalDeviceVulkan11Properties::default();
        let mut v13 = vk::PhysicalDeviceVulkan13Properties::default();
        let mut p2 = vk::PhysicalDeviceProperties2::default()
            .push(&mut v11)
            .push(&mut v13);
        unsafe { instance.get_physical_device_properties2(physical_device, &mut p2) };
        Self {
            min: v13.min_subgroup_size,
            max: v13.max_subgroup_size,
            ops: v11.subgroup_supported_operations,
            stages: v11.subgroup_supported_stages,
            required_size_stages: v13.required_subgroup_size_stages,
        }
    }

    /// The subgroup size a pipeline asking for `lo..=hi` runs at: the largest
    /// the device offers in that range. Upstream's shaders are written to be
    /// correct at any size in their range.
    pub fn pick(&self, lo: u32, hi: u32) -> Option<u32> {
        let size = hi.min(self.max);
        (size >= lo.max(self.min)).then_some(size)
    }

    /// The first of `sizes` the device can run at exactly.
    pub fn pick_exact(&self, sizes: &[u32]) -> Option<u32> {
        sizes
            .iter()
            .copied()
            .find(|&s| (self.min..=self.max).contains(&s))
    }
}

/// Every subgroup-size range the passes of `roles` ask for, from upstream.
fn check_subgroup_sizes(roles: Roles, s: &Subgroups, missing: &mut Vec<String>) {
    let mut need = |what: &str, ok: bool| {
        if !ok {
            missing.push(format!(
                "a subgroup size for {what} (device offers {}..={})",
                s.min, s.max
            ));
        }
    };
    if roles.encode {
        need("the forward transform (4..=128)", s.pick(4, 128).is_some());
        need("the quantizer (8..=128)", s.pick(8, 128).is_some());
        need("rate control analysis (16..=64)", s.pick(16, 64).is_some());
        need(
            "rate control resolve (exactly 64, 16 or 32)",
            s.pick_exact(&[64, 16, 32]).is_some(),
        );
        need("block packing (16..=64)", s.pick(16, 64).is_some());
    }
    if roles.decode {
        need("the dequantizer (4..=128)", s.pick(4, 128).is_some());
    }
}

impl DeviceRequirements {
    /// What a device on `physical_device` must be created with to run the
    /// halves of the codec in `roles`, or why it cannot.
    ///
    /// Checks the device's real features and properties, never its name.
    pub fn query(
        instance: &ash::Instance,
        physical_device: vk::PhysicalDevice,
        roles: Roles,
    ) -> Result<Self> {
        let props = unsafe { instance.get_physical_device_properties(physical_device) };
        let mut missing: Vec<String> = Vec::new();

        if props.api_version < vk::API_VERSION_1_3 {
            missing.push(format!(
                "Vulkan 1.3 (device is {}.{})",
                vk::api_version_major(props.api_version),
                vk::api_version_minor(props.api_version)
            ));
        }

        let available = DeviceFeatures::query(instance, physical_device);
        let features = DeviceFeatures::for_roles(roles, &available);
        missing.extend(
            features
                .missing_from(&available)
                .into_iter()
                .map(String::from),
        );

        let extensions = [ash::khr::push_descriptor::NAME];
        let present = unsafe { instance.enumerate_device_extension_properties(physical_device) }
            .map_err(Error::Vulkan)?;
        for ext in extensions {
            if !present
                .iter()
                .any(|p| p.extension_name_as_c_str().is_ok_and(|n| n == ext))
            {
                missing.push(ext.to_string_lossy().into_owned());
            }
        }

        let subgroups = Subgroups::query(instance, physical_device);
        let ops = required_subgroup_ops(roles);
        if !subgroups.ops.contains(ops) {
            missing.push(format!(
                "subgroup operations {:?} (device has {:?})",
                ops & !subgroups.ops,
                subgroups.ops
            ));
        }
        if !subgroups.stages.contains(vk::ShaderStageFlags::COMPUTE) {
            missing.push("subgroup operations in compute shaders".into());
        }
        if !subgroups
            .required_size_stages
            .contains(vk::ShaderStageFlags::COMPUTE)
        {
            missing.push("required subgroup sizes in compute shaders".into());
        }
        check_subgroup_sizes(roles, &subgroups, &mut missing);

        // Formats the codec writes as storage images without a declared format,
        // and samples. Only R32_SFLOAT storage is guaranteed by core Vulkan.
        use vk::FormatFeatureFlags2 as F;
        let needed = F::STORAGE_IMAGE | F::STORAGE_WRITE_WITHOUT_FORMAT | F::SAMPLED_IMAGE;
        for format in [
            vk::Format::R8_UNORM,
            vk::Format::R16_UNORM,
            vk::Format::R16_SFLOAT,
            vk::Format::R32_SFLOAT,
        ] {
            let mut props3 = vk::FormatProperties3::default();
            let mut props = vk::FormatProperties2::default().push(&mut props3);
            unsafe {
                instance.get_physical_device_format_properties2(physical_device, format, &mut props)
            };
            if !props3.optimal_tiling_features.contains(needed) {
                missing.push(format!(
                    "{format:?} as a sampled and format-less storage image (has {:?})",
                    props3.optimal_tiling_features & needed
                ));
            }
        }

        let families =
            unsafe { instance.get_physical_device_queue_family_properties(physical_device) };
        let compute = |f: &vk::QueueFamilyProperties| {
            f.queue_flags.contains(vk::QueueFlags::COMPUTE) && f.queue_count > 0
        };
        let queue_family = families
            .iter()
            .position(|f| compute(f) && !f.queue_flags.contains(vk::QueueFlags::GRAPHICS))
            .or_else(|| families.iter().position(compute));
        let Some(queue_family) = queue_family else {
            missing.push("a compute queue".into());
            return Err(Error::Unsupported(missing));
        };

        if !missing.is_empty() {
            return Err(Error::Unsupported(missing));
        }
        Ok(Self {
            queue_family: queue_family as u32,
            extensions: extensions.to_vec(),
            features,
        })
    }
}

/// One queue on a device: a family and an index within it, as passed to
/// `vkGetDeviceQueue`. The same as pixelforge's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct DeviceQueue {
    pub family: u32,
    pub index: u32,
}

impl DeviceQueue {
    pub fn new(family: u32, index: u32) -> Self {
        Self { family, index }
    }
}

/// A caller's device, set up for nespyro. Cheap to clone.
#[derive(Clone)]
pub struct Context(pub(crate) Arc<ContextInner>);

pub(crate) struct ContextInner {
    pub device: ash::Device,
    pub queue: vk::Queue,
    pub queue_family: u32,
    pub queue_lock: QueueLock,
    pub push_descriptor: ash::khr::push_descriptor::Device,
    pub memory: vk::PhysicalDeviceMemoryProperties,
    pub subgroups: Subgroups,
    /// What the device was created with, as the caller said.
    pub roles: Roles,
    pub enabled: DeviceFeatures,
    pub timestamp_period: f32,
    pub timestamps: bool,
}

impl Context {
    /// Wraps a device the caller created and still owns.
    ///
    /// The device must have been created with everything
    /// [`DeviceRequirements::query`] returned for `roles`, and a queue at
    /// `queue`. Vulkan offers no way to ask a device which features it was
    /// created with, so this trusts the caller for those; it does check that
    /// the physical device supports them, and an encoder on a context not
    /// created for encoding is refused.
    ///
    /// The context never destroys the device. Everything nespyro creates on
    /// it must be dropped before the caller destroys it.
    pub fn from_existing(
        instance: ash::Instance,
        physical_device: vk::PhysicalDevice,
        device: ash::Device,
        queue: DeviceQueue,
        queue_lock: QueueLock,
        roles: Roles,
    ) -> Result<Self> {
        let requirements = DeviceRequirements::query(&instance, physical_device, roles)?;

        let families =
            unsafe { instance.get_physical_device_queue_family_properties(physical_device) };
        let family = families.get(queue.family as usize).ok_or_else(|| {
            Error::Config(format!("queue family {} does not exist", queue.family))
        })?;
        if !family.queue_flags.contains(vk::QueueFlags::COMPUTE) {
            return Err(Error::Config(format!(
                "queue family {} cannot run compute",
                queue.family
            )));
        }
        if queue.index >= family.queue_count {
            return Err(Error::Config(format!(
                "queue family {} has {} queues, index {} asked for",
                queue.family, family.queue_count, queue.index
            )));
        }
        let timestamps = family.timestamp_valid_bits > 0;

        let vk_queue = unsafe { device.get_device_queue(queue.family, queue.index) };
        let push_descriptor = ash::khr::push_descriptor::Device::load(&instance, &device);
        let memory = unsafe { instance.get_physical_device_memory_properties(physical_device) };
        let props = unsafe { instance.get_physical_device_properties(physical_device) };

        Ok(Self(Arc::new(ContextInner {
            subgroups: Subgroups::query(&instance, physical_device),
            roles,
            enabled: requirements.features,
            device,
            queue: vk_queue,
            queue_family: queue.family,
            queue_lock,
            push_descriptor,
            memory,
            timestamp_period: props.limits.timestamp_period,
            timestamps,
        })))
    }

    /// Whether an encoder can be made on this context.
    pub fn supports_encode(&self) -> bool {
        self.0.roles.encode
    }

    /// Whether a decoder can be made on this context.
    pub fn supports_decode(&self) -> bool {
        self.0.roles.decode
    }

    /// The queue family nespyro submits on.
    pub fn queue_family(&self) -> u32 {
        self.0.queue_family
    }

    pub fn device(&self) -> &ash::Device {
        &self.0.device
    }

    pub(crate) fn inner(&self) -> &ContextInner {
        &self.0
    }
}
