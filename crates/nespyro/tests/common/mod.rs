//! A device for the GPU tests, created the way a real caller would: from
//! `DeviceRequirements`, with Khronos validation on and every validation
//! error recorded, so a test that ran "successfully" with errors fails.
//!
//! `NESPYRO_TEST_DEVICE` picks a device by name substring; otherwise the
//! first discrete GPU, then anything that is not a CPU implementation. A
//! machine without one fails the test rather than skipping it.

#![allow(dead_code)]

use std::ffi::c_void;
use std::sync::{Arc, Mutex};

use ash::vk;
use ash::vk::TaggedStructure as _;
use nespyro::{Context, DeviceQueue, DeviceRequirements, QueueLock, Roles};

pub struct Gpu {
    pub entry: ash::Entry,
    pub instance: ash::Instance,
    pub physical_device: vk::PhysicalDevice,
    pub device: ash::Device,
    pub queue: vk::Queue,
    pub family: u32,
    pub lock: QueueLock,
    pub ctx: Option<Context>,
    pub name: String,
    errors: Arc<Mutex<Vec<String>>>,
    debug: Option<(ash::ext::debug_utils::Instance, vk::DebugUtilsMessengerEXT)>,
    pool: vk::CommandPool,
}

unsafe extern "system" fn on_message(
    severity: vk::DebugUtilsMessageSeverityFlagsEXT,
    _kind: vk::DebugUtilsMessageTypeFlagsEXT,
    data: *const vk::DebugUtilsMessengerCallbackDataEXT<'_>,
    user: *mut c_void,
) -> vk::Bool32 {
    if severity.contains(vk::DebugUtilsMessageSeverityFlagsEXT::ERROR) {
        let errors = unsafe { &*(user as *const Mutex<Vec<String>>) };
        let message = unsafe { (*data).message_as_c_str() }
            .map(|m| m.to_string_lossy().into_owned())
            .unwrap_or_default();
        eprintln!("validation: {message}");
        errors.lock().unwrap().push(message);
    }
    vk::FALSE
}

impl Gpu {
    pub fn new() -> Self {
        let entry = unsafe { ash::Entry::load() }.expect("no Vulkan loader");
        let errors = Arc::new(Mutex::new(Vec::new()));

        let validation = c"VK_LAYER_KHRONOS_validation";
        let have_validation = unsafe { entry.enumerate_instance_layer_properties() }
            .unwrap()
            .iter()
            .any(|l| l.layer_name_as_c_str().is_ok_and(|n| n == validation));
        assert!(
            have_validation || std::env::var_os("NESPYRO_NO_VALIDATION").is_some(),
            "the GPU tests run under Khronos validation; install it, or set \
             NESPYRO_NO_VALIDATION=1 to run without"
        );
        let layers: Vec<*const i8> = if have_validation {
            vec![validation.as_ptr()]
        } else {
            vec![]
        };
        let extensions = [ash::ext::debug_utils::NAME.as_ptr()];
        let app = vk::ApplicationInfo::default().api_version(vk::API_VERSION_1_3);
        let instance = unsafe {
            entry
                .create_instance(
                    &vk::InstanceCreateInfo::default()
                        .application_info(&app)
                        .enabled_layer_names(&layers)
                        .enabled_extension_names(&extensions),
                    None,
                )
                .unwrap()
        };

        let debug = {
            let loader = ash::ext::debug_utils::Instance::load(&entry, &instance);
            let info = vk::DebugUtilsMessengerCreateInfoEXT::default()
                .message_severity(vk::DebugUtilsMessageSeverityFlagsEXT::ERROR)
                .message_type(
                    vk::DebugUtilsMessageTypeFlagsEXT::VALIDATION
                        | vk::DebugUtilsMessageTypeFlagsEXT::GENERAL,
                )
                .pfn_user_callback(Some(on_message))
                .user_data(Arc::as_ptr(&errors) as *mut c_void);
            let messenger = unsafe { loader.create_debug_utils_messenger(&info, None).unwrap() };
            Some((loader, messenger))
        };

        let wanted = std::env::var("NESPYRO_TEST_DEVICE").ok();
        let devices = unsafe { instance.enumerate_physical_devices().unwrap() };
        let describe = |d: &vk::PhysicalDevice| {
            let p = unsafe { instance.get_physical_device_properties(*d) };
            let name = p
                .device_name_as_c_str()
                .unwrap()
                .to_string_lossy()
                .into_owned();
            (name, p.device_type)
        };
        let pick = devices
            .iter()
            .find(|d| {
                let (name, kind) = describe(d);
                match &wanted {
                    Some(w) => name.contains(w.as_str()),
                    None => kind == vk::PhysicalDeviceType::DISCRETE_GPU,
                }
            })
            .or_else(|| {
                wanted.is_none().then(|| {
                    devices
                        .iter()
                        .find(|d| describe(d).1 != vk::PhysicalDeviceType::CPU)
                })?
            })
            .copied()
            .unwrap_or_else(|| {
                let names: Vec<_> = devices.iter().map(|d| describe(d).0).collect();
                panic!("no GPU to test on (wanted {wanted:?}, have {names:?})")
            });
        let physical_device = pick;
        let name = describe(&pick).0;

        let req = DeviceRequirements::query(&instance, physical_device, Roles::BOTH)
            .unwrap_or_else(|e| panic!("{name} cannot run nespyro: {e}"));
        let family = req.queue_family;

        let f = req.features;
        let mut v11 = vk::PhysicalDeviceVulkan11Features::default()
            .storage_buffer16_bit_access(f.storage_buffer_16bit_access);
        let mut v12 = vk::PhysicalDeviceVulkan12Features::default()
            .storage_buffer8_bit_access(f.storage_buffer_8bit_access)
            .shader_int8(f.shader_int8)
            .shader_float16(f.shader_float16)
            .timeline_semaphore(f.timeline_semaphore)
            .buffer_device_address(f.buffer_device_address);
        let mut v13 = vk::PhysicalDeviceVulkan13Features::default()
            .synchronization2(f.synchronization2)
            .subgroup_size_control(f.subgroup_size_control)
            .compute_full_subgroups(f.compute_full_subgroups);
        let base = vk::PhysicalDeviceFeatures::default()
            .shader_int16(f.shader_int16)
            .shader_storage_image_write_without_format(f.shader_storage_image_write_without_format);
        let mut features = vk::PhysicalDeviceFeatures2::default().features(base);
        let priorities = [1.0];
        let queues = [vk::DeviceQueueCreateInfo::default()
            .queue_family_index(family)
            .queue_priorities(&priorities)];
        let extensions: Vec<_> = req.extensions.iter().map(|e| e.as_ptr()).collect();
        let device = unsafe {
            instance
                .create_device(
                    physical_device,
                    &vk::DeviceCreateInfo::default()
                        .queue_create_infos(&queues)
                        .enabled_extension_names(&extensions)
                        .push(&mut features)
                        .push(&mut v11)
                        .push(&mut v12)
                        .push(&mut v13),
                    None,
                )
                .unwrap()
        };
        let queue = unsafe { device.get_device_queue(family, 0) };
        let lock = QueueLock::shared();
        let ctx = Context::from_existing(
            instance.clone(),
            physical_device,
            device.clone(),
            DeviceQueue::new(family, 0),
            lock.clone(),
            Roles::BOTH,
        )
        .unwrap();
        let pool = unsafe {
            device
                .create_command_pool(
                    &vk::CommandPoolCreateInfo::default().queue_family_index(family),
                    None,
                )
                .unwrap()
        };

        eprintln!("testing on {name}");
        Self {
            entry,
            instance,
            physical_device,
            device,
            queue,
            family,
            lock,
            ctx: Some(ctx),
            name,
            errors,
            debug,
            pool,
        }
    }

    pub fn ctx(&self) -> Context {
        self.ctx.clone().unwrap()
    }

    /// Every validation error so far, taken.
    pub fn take_errors(&self) -> Vec<String> {
        std::mem::take(&mut *self.errors.lock().unwrap())
    }

    pub fn assert_clean(&self) {
        let errors = self.take_errors();
        assert!(
            errors.is_empty(),
            "{} validation errors:\n{}",
            errors.len(),
            errors.join("\n")
        );
    }

    fn memory_type(&self, bits: u32, want: vk::MemoryPropertyFlags) -> u32 {
        let props = unsafe {
            self.instance
                .get_physical_device_memory_properties(self.physical_device)
        };
        (0..props.memory_type_count)
            .find(|&i| {
                bits & (1 << i) != 0 && props.memory_types[i as usize].property_flags.contains(want)
            })
            .expect("no suitable memory type")
    }

    /// Blocks until a timeline point is reached.
    pub fn wait(&self, point: nespyro::TimelinePoint) {
        let semaphores = [point.semaphore];
        let values = [point.value];
        unsafe {
            self.device
                .wait_semaphores(
                    &vk::SemaphoreWaitInfo::default()
                        .semaphores(&semaphores)
                        .values(&values),
                    u64::MAX,
                )
                .unwrap()
        };
    }

    /// Records into a one-off command buffer, submits it and waits.
    pub fn run(&self, record: impl FnOnce(vk::CommandBuffer)) {
        let device = &self.device;
        unsafe {
            let cmd = device
                .allocate_command_buffers(
                    &vk::CommandBufferAllocateInfo::default()
                        .command_pool(self.pool)
                        .command_buffer_count(1),
                )
                .unwrap()[0];
            device
                .begin_command_buffer(cmd, &vk::CommandBufferBeginInfo::default())
                .unwrap();
            record(cmd);
            device.end_command_buffer(cmd).unwrap();
            let fence = device
                .create_fence(&vk::FenceCreateInfo::default(), None)
                .unwrap();
            let cmds = [cmd];
            {
                let _g = self.lock.lock();
                device
                    .queue_submit(
                        self.queue,
                        &[vk::SubmitInfo::default().command_buffers(&cmds)],
                        fence,
                    )
                    .unwrap();
            }
            device.wait_for_fences(&[fence], true, u64::MAX).unwrap();
            device.destroy_fence(fence, None);
            device.free_command_buffers(self.pool, &cmds);
        }
    }

    pub fn buffer(&self, size: u64, usage: vk::BufferUsageFlags) -> HostBuffer {
        let device = &self.device;
        unsafe {
            let buffer = device
                .create_buffer(
                    &vk::BufferCreateInfo::default().size(size).usage(usage),
                    None,
                )
                .unwrap();
            let req = device.get_buffer_memory_requirements(buffer);
            let memory = device
                .allocate_memory(
                    &vk::MemoryAllocateInfo::default()
                        .allocation_size(req.size)
                        .memory_type_index(self.memory_type(
                            req.memory_type_bits,
                            vk::MemoryPropertyFlags::HOST_VISIBLE
                                | vk::MemoryPropertyFlags::HOST_COHERENT,
                        )),
                    None,
                )
                .unwrap();
            device.bind_buffer_memory(buffer, memory, 0).unwrap();
            let ptr = device
                .map_memory(memory, 0, vk::WHOLE_SIZE, vk::MemoryMapFlags::empty())
                .unwrap()
                .cast();
            HostBuffer {
                device: device.clone(),
                buffer,
                memory,
                ptr,
                size: size as usize,
            }
        }
    }

    /// An image in `GENERAL`, filled from `bytes` tightly packed.
    pub fn upload(&self, format: vk::Format, width: u32, height: u32, bytes: &[u8]) -> GpuImage {
        let device = &self.device;
        let image = unsafe {
            device
                .create_image(
                    &vk::ImageCreateInfo::default()
                        .image_type(vk::ImageType::TYPE_2D)
                        .format(format)
                        .extent(vk::Extent3D {
                            width,
                            height,
                            depth: 1,
                        })
                        .mip_levels(1)
                        .array_layers(1)
                        .samples(vk::SampleCountFlags::TYPE_1)
                        .tiling(vk::ImageTiling::OPTIMAL)
                        .usage(
                            vk::ImageUsageFlags::SAMPLED
                                | vk::ImageUsageFlags::TRANSFER_DST
                                | vk::ImageUsageFlags::TRANSFER_SRC,
                        )
                        .initial_layout(vk::ImageLayout::UNDEFINED),
                    None,
                )
                .unwrap()
        };
        let req = unsafe { device.get_image_memory_requirements(image) };
        let memory = unsafe {
            device
                .allocate_memory(
                    &vk::MemoryAllocateInfo::default()
                        .allocation_size(req.size)
                        .memory_type_index(self.memory_type(
                            req.memory_type_bits,
                            vk::MemoryPropertyFlags::DEVICE_LOCAL,
                        )),
                    None,
                )
                .unwrap()
        };
        unsafe { device.bind_image_memory(image, memory, 0).unwrap() };

        let staging = self.buffer(bytes.len() as u64, vk::BufferUsageFlags::TRANSFER_SRC);
        staging.write(bytes);
        self.run(|cmd| unsafe {
            barrier(
                device,
                cmd,
                image,
                vk::ImageLayout::UNDEFINED,
                vk::ImageLayout::TRANSFER_DST_OPTIMAL,
            );
            device.cmd_copy_buffer_to_image(
                cmd,
                staging.buffer,
                image,
                vk::ImageLayout::TRANSFER_DST_OPTIMAL,
                &[vk::BufferImageCopy::default()
                    .image_subresource(color_layers())
                    .image_extent(vk::Extent3D {
                        width,
                        height,
                        depth: 1,
                    })],
            );
            barrier(
                device,
                cmd,
                image,
                vk::ImageLayout::TRANSFER_DST_OPTIMAL,
                vk::ImageLayout::GENERAL,
            );
        });
        GpuImage {
            device: device.clone(),
            image,
            memory,
            format,
            width,
            height,
        }
    }

    /// Copies a single-layer image in `GENERAL` back to the CPU.
    pub fn download(&self, image: vk::Image, width: u32, height: u32, texel_bytes: u32) -> Vec<u8> {
        let size = u64::from(width * height * texel_bytes);
        let staging = self.buffer(size, vk::BufferUsageFlags::TRANSFER_DST);
        let device = &self.device;
        self.run(|cmd| unsafe {
            let b = [vk::MemoryBarrier2::default()
                .src_stage_mask(vk::PipelineStageFlags2::ALL_COMMANDS)
                .src_access_mask(vk::AccessFlags2::MEMORY_WRITE)
                .dst_stage_mask(vk::PipelineStageFlags2::COPY)
                .dst_access_mask(vk::AccessFlags2::TRANSFER_READ)];
            device.cmd_pipeline_barrier2(cmd, &vk::DependencyInfo::default().memory_barriers(&b));
            device.cmd_copy_image_to_buffer(
                cmd,
                image,
                vk::ImageLayout::GENERAL,
                staging.buffer,
                &[vk::BufferImageCopy::default()
                    .image_subresource(color_layers())
                    .image_extent(vk::Extent3D {
                        width,
                        height,
                        depth: 1,
                    })],
            );
        });
        staging.read()
    }
}

impl Drop for Gpu {
    fn drop(&mut self) {
        self.ctx.take();
        unsafe {
            self.device.device_wait_idle().unwrap();
            self.device.destroy_command_pool(self.pool, None);
            self.device.destroy_device(None);
            if let Some((loader, messenger)) = self.debug.take() {
                loader.destroy_debug_utils_messenger(messenger, None);
            }
            self.instance.destroy_instance(None);
        }
    }
}

fn color_layers() -> vk::ImageSubresourceLayers {
    vk::ImageSubresourceLayers {
        aspect_mask: vk::ImageAspectFlags::COLOR,
        mip_level: 0,
        base_array_layer: 0,
        layer_count: 1,
    }
}

unsafe fn barrier(
    device: &ash::Device,
    cmd: vk::CommandBuffer,
    image: vk::Image,
    old: vk::ImageLayout,
    new: vk::ImageLayout,
) {
    let b = [vk::ImageMemoryBarrier2::default()
        .src_stage_mask(vk::PipelineStageFlags2::ALL_COMMANDS)
        .src_access_mask(vk::AccessFlags2::MEMORY_WRITE)
        .dst_stage_mask(vk::PipelineStageFlags2::ALL_COMMANDS)
        .dst_access_mask(vk::AccessFlags2::MEMORY_READ | vk::AccessFlags2::MEMORY_WRITE)
        .old_layout(old)
        .new_layout(new)
        .image(image)
        .subresource_range(vk::ImageSubresourceRange {
            aspect_mask: vk::ImageAspectFlags::COLOR,
            base_mip_level: 0,
            level_count: 1,
            base_array_layer: 0,
            layer_count: 1,
        })];
    unsafe {
        device.cmd_pipeline_barrier2(
            cmd,
            &vk::DependencyInfo::default().image_memory_barriers(&b),
        )
    };
}

pub struct HostBuffer {
    device: ash::Device,
    pub buffer: vk::Buffer,
    memory: vk::DeviceMemory,
    ptr: *mut u8,
    size: usize,
}

impl HostBuffer {
    pub fn write(&self, bytes: &[u8]) {
        assert!(bytes.len() <= self.size);
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), self.ptr, bytes.len()) };
    }

    pub fn read(&self) -> Vec<u8> {
        unsafe { std::slice::from_raw_parts(self.ptr, self.size).to_vec() }
    }
}

impl Drop for HostBuffer {
    fn drop(&mut self) {
        unsafe {
            self.device.destroy_buffer(self.buffer, None);
            self.device.free_memory(self.memory, None);
        }
    }
}

pub struct GpuImage {
    device: ash::Device,
    pub image: vk::Image,
    memory: vk::DeviceMemory,
    pub format: vk::Format,
    pub width: u32,
    pub height: u32,
}

impl Drop for GpuImage {
    fn drop(&mut self) {
        unsafe {
            self.device.destroy_image(self.image, None);
            self.device.free_memory(self.memory, None);
        }
    }
}

/// xorshift, so every run sees the same content.
pub struct Rng(pub u64);
impl Rng {
    pub fn next(&mut self) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 16) as u32
    }
}

/// Synthetic content, RGBA8, chosen to exercise the codec differently.
#[derive(Debug, Clone, Copy)]
pub enum Content {
    /// Smooth gradients: almost everything in the coarse bands.
    Gradient,
    /// Uniform noise: the worst case for a transform codec.
    Noise,
    /// Hard black and white edges, like text and UI.
    Edges,
    /// One flat colour: nearly nothing but DC.
    Flat,
}

pub fn rgba8(content: Content, width: u32, height: u32) -> Vec<u8> {
    let mut rng = Rng(0x1234_5678_9abc_def1);
    let mut out = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        for x in 0..width {
            let px = match content {
                Content::Gradient => [
                    (x * 255 / width.max(2).saturating_sub(1)) as u8,
                    (y * 255 / height.max(2).saturating_sub(1)) as u8,
                    ((x + y) * 255 / (width + height)) as u8,
                ],
                Content::Noise => [rng.next() as u8, rng.next() as u8, rng.next() as u8],
                Content::Edges => {
                    let on = ((x / 3) + (y / 7)) % 5 == 0 || (x % 16 < 2) || (y % 11 == 0);
                    if on { [250, 250, 250] } else { [12, 12, 12] }
                }
                Content::Flat => [40, 120, 200],
            };
            out.extend_from_slice(&[px[0], px[1], px[2], 255]);
        }
    }
    out
}

/// Full-range YCbCr from 8-bit sRGB, as the encoder's conversion computes it,
/// written independently of it. 4:2:0 chroma is the mean of each 2×2 quad.
pub fn reference_ycbcr(rgba: &[u8], w: u32, h: u32, yuv420: bool, bt2020: bool) -> [Vec<f32>; 3] {
    let (yr, cbr, crr) = if bt2020 {
        (
            [0.2627, 0.6780, 0.0593],
            [-0.1396, -0.3604, 0.5],
            [0.5, -0.4598, -0.0402],
        )
    } else {
        (
            [0.2126, 0.7152, 0.0722],
            [-0.1146, -0.3854, 0.5],
            [0.5, -0.4542, -0.0458],
        )
    };
    let dot = |a: [f32; 3], b: [f32; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let at = |x: u32, y: u32| {
        let i = ((y * w + x) * 4) as usize;
        let c = [rgba[i], rgba[i + 1], rgba[i + 2]].map(|v| f32::from(v) / 255.0);
        [
            dot(yr, c).clamp(0.0, 1.0),
            (0.5 + dot(cbr, c)).clamp(0.0, 1.0),
            (0.5 + dot(crr, c)).clamp(0.0, 1.0),
        ]
    };
    let mut y = Vec::with_capacity((w * h) as usize);
    for j in 0..h {
        for i in 0..w {
            y.push(at(i, j)[0]);
        }
    }
    let (cw, ch) = if yuv420 { (w / 2, h / 2) } else { (w, h) };
    let mut cb = Vec::with_capacity((cw * ch) as usize);
    let mut cr = Vec::with_capacity((cw * ch) as usize);
    for j in 0..ch {
        for i in 0..cw {
            let v = if yuv420 {
                let q = [
                    at(2 * i, 2 * j),
                    at(2 * i + 1, 2 * j),
                    at(2 * i, 2 * j + 1),
                    at(2 * i + 1, 2 * j + 1),
                ];
                [1, 2].map(|k| q.iter().map(|p| p[k]).sum::<f32>() / 4.0)
            } else {
                let p = at(i, j);
                [p[1], p[2]]
            };
            cb.push(v[0]);
            cr.push(v[1]);
        }
    }
    [y, cb, cr]
}

/// A decoded plane as floats in [0, 1], cropped to the picture.
pub fn plane_values(gpu: &Gpu, plane: &nespyro::PlaneView) -> Vec<f32> {
    let texel = if plane.format == vk::Format::R16_UNORM {
        2
    } else {
        1
    };
    let raw = gpu.download(plane.image, plane.image_width, plane.image_height, texel);
    let mut out = Vec::with_capacity((plane.width * plane.height) as usize);
    for y in 0..plane.height {
        for x in 0..plane.width {
            let i = ((y * plane.image_width + x) * texel) as usize;
            out.push(if texel == 2 {
                f32::from(u16::from_le_bytes([raw[i], raw[i + 1]])) / 65535.0
            } else {
                f32::from(raw[i]) / 255.0
            });
        }
    }
    out
}

/// PSNR in dB against a peak of 1.0.
pub fn psnr(a: &[f32], b: &[f32]) -> f64 {
    assert_eq!(a.len(), b.len());
    let mse = a
        .iter()
        .zip(b)
        .map(|(x, y)| (f64::from(*x) - f64::from(*y)).powi(2))
        .sum::<f64>()
        / a.len() as f64;
    if mse == 0.0 {
        f64::INFINITY
    } else {
        -10.0 * mse.log10()
    }
}
