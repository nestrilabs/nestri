//! The little of Granite nespyro needs: buffers, images, samplers, command
//! buffers and semaphores, each owning what it creates.
//!
//! Every allocation is dedicated. A codec instance makes a few dozen objects
//! once and then reuses them for every frame, so a suballocator would buy
//! nothing here.

use ash::vk;
use ash::vk::TaggedStructure as _;

use crate::device::Context;
use crate::error::{Error, Result};

/// Where a buffer's memory lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Location {
    /// Only the GPU touches it.
    Device,
    /// Written by the CPU, read by the GPU. Device-local when the device has
    /// such memory mappable (ReBAR, or an integrated GPU), so shaders read it
    /// without a copy.
    Upload,
    /// Written by the GPU, read by the CPU. Cached, so reading it back is not
    /// an uncached crawl.
    Readback,
}

fn find_memory_type(
    ctx: &Context,
    bits: u32,
    preferred: &[vk::MemoryPropertyFlags],
) -> Option<(u32, vk::MemoryPropertyFlags)> {
    let memory = &ctx.inner().memory;
    preferred.iter().find_map(|&want| {
        (0..memory.memory_type_count).find_map(|i| {
            let flags = memory.memory_types[i as usize].property_flags;
            (bits & (1 << i) != 0 && flags.contains(want)).then_some((i, flags))
        })
    })
}

fn allocate(
    ctx: &Context,
    requirements: vk::MemoryRequirements,
    preferred: &[vk::MemoryPropertyFlags],
    device_address: bool,
    dedicated: vk::MemoryDedicatedAllocateInfo,
) -> Result<(vk::DeviceMemory, vk::MemoryPropertyFlags)> {
    let (index, flags) = find_memory_type(ctx, requirements.memory_type_bits, preferred)
        .ok_or_else(|| {
            Error::Unsupported(vec![format!(
                "a memory type with any of {preferred:?} for bits {:#x}",
                requirements.memory_type_bits
            )])
        })?;
    let mut flags_info =
        vk::MemoryAllocateFlagsInfo::default().flags(vk::MemoryAllocateFlags::DEVICE_ADDRESS);
    let mut dedicated = dedicated;
    let mut info = vk::MemoryAllocateInfo::default()
        .allocation_size(requirements.size)
        .memory_type_index(index)
        .push(&mut dedicated);
    if device_address {
        info = info.push(&mut flags_info);
    }
    let memory = unsafe { ctx.device().allocate_memory(&info, None)? };
    Ok((memory, flags))
}

pub(crate) struct Buffer {
    ctx: Context,
    pub buffer: vk::Buffer,
    memory: vk::DeviceMemory,
    pub size: u64,
    pub address: u64,
    mapped: *mut u8,
    coherent: bool,
}

// SAFETY: the mapping is plain memory owned by this buffer; synchronising its
// use with the GPU is the owner's business, as with any Vulkan memory.
unsafe impl Send for Buffer {}
unsafe impl Sync for Buffer {}

impl Buffer {
    pub fn new(
        ctx: &Context,
        size: u64,
        usage: vk::BufferUsageFlags,
        location: Location,
    ) -> Result<Self> {
        let device = ctx.device();
        let usage = usage | vk::BufferUsageFlags::SHADER_DEVICE_ADDRESS;
        let buffer = unsafe {
            device.create_buffer(
                &vk::BufferCreateInfo::default()
                    .size(size.max(4))
                    .usage(usage)
                    .sharing_mode(vk::SharingMode::EXCLUSIVE),
                None,
            )?
        };
        let requirements = unsafe { device.get_buffer_memory_requirements(buffer) };
        use vk::MemoryPropertyFlags as M;
        let preferred: &[M] = match location {
            Location::Device => &[M::DEVICE_LOCAL],
            Location::Upload => &[
                M::DEVICE_LOCAL | M::HOST_VISIBLE | M::HOST_COHERENT,
                M::HOST_VISIBLE | M::HOST_COHERENT,
            ],
            Location::Readback => &[
                M::HOST_VISIBLE | M::HOST_CACHED | M::HOST_COHERENT,
                M::HOST_VISIBLE | M::HOST_CACHED,
                M::HOST_VISIBLE | M::HOST_COHERENT,
            ],
        };
        let allocated = allocate(
            ctx,
            requirements,
            preferred,
            true,
            vk::MemoryDedicatedAllocateInfo::default().buffer(buffer),
        );
        let (memory, flags) = match allocated {
            Ok(m) => m,
            Err(e) => {
                unsafe { device.destroy_buffer(buffer, None) };
                return Err(e);
            }
        };
        unsafe { device.bind_buffer_memory(buffer, memory, 0)? };
        let address = unsafe {
            device.get_buffer_device_address(&vk::BufferDeviceAddressInfo::default().buffer(buffer))
        };
        let mapped = if flags.contains(M::HOST_VISIBLE) {
            unsafe { device.map_memory(memory, 0, vk::WHOLE_SIZE, vk::MemoryMapFlags::empty())? }
                .cast()
        } else {
            std::ptr::null_mut()
        };
        Ok(Self {
            ctx: ctx.clone(),
            buffer,
            memory,
            size,
            address,
            mapped,
            coherent: flags.contains(M::HOST_COHERENT),
        })
    }

    /// Whether the CPU can reach this buffer's memory directly.
    pub fn is_mapped(&self) -> bool {
        !self.mapped.is_null()
    }

    /// The mapping. Only valid for host-visible buffers.
    pub fn bytes(&self) -> &[u8] {
        assert!(self.is_mapped());
        unsafe { std::slice::from_raw_parts(self.mapped, self.size as usize) }
    }

    pub fn bytes_mut(&mut self) -> &mut [u8] {
        assert!(self.is_mapped());
        unsafe { std::slice::from_raw_parts_mut(self.mapped, self.size as usize) }
    }

    /// Makes the GPU's writes visible to the CPU, after the fence or
    /// semaphore that ordered them has been waited on.
    pub fn invalidate(&self) -> Result<()> {
        if !self.coherent {
            unsafe {
                self.ctx.device().invalidate_mapped_memory_ranges(&[
                    vk::MappedMemoryRange::default()
                        .memory(self.memory)
                        .offset(0)
                        .size(vk::WHOLE_SIZE),
                ])?
            };
        }
        Ok(())
    }

    /// Makes the CPU's writes visible to the GPU, before the submission that
    /// reads them.
    pub fn flush(&self) -> Result<()> {
        if !self.coherent {
            unsafe {
                self.ctx
                    .device()
                    .flush_mapped_memory_ranges(&[vk::MappedMemoryRange::default()
                        .memory(self.memory)
                        .offset(0)
                        .size(vk::WHOLE_SIZE)])?
            };
        }
        Ok(())
    }
}

impl Drop for Buffer {
    fn drop(&mut self) {
        let device = self.ctx.device();
        unsafe {
            device.destroy_buffer(self.buffer, None);
            device.free_memory(self.memory, None);
        }
    }
}

/// A 2D image, possibly an array with mips, with a view per subresource
/// range asked for.
pub(crate) struct Image {
    ctx: Context,
    pub image: vk::Image,
    memory: vk::DeviceMemory,
    pub format: vk::Format,
    pub width: u32,
    pub height: u32,
    views: Vec<vk::ImageView>,
}

pub(crate) struct ImageDesc<'a> {
    pub format: vk::Format,
    pub width: u32,
    pub height: u32,
    pub layers: u32,
    pub mips: u32,
    pub usage: vk::ImageUsageFlags,
    /// Families that share the image. One or none means exclusive.
    pub families: &'a [u32],
}

impl Image {
    pub fn new(ctx: &Context, desc: &ImageDesc) -> Result<Self> {
        let device = ctx.device();
        let mut families: Vec<u32> = desc.families.to_vec();
        families.sort_unstable();
        families.dedup();
        let concurrent = families.len() > 1;
        let info = vk::ImageCreateInfo::default()
            .image_type(vk::ImageType::TYPE_2D)
            .format(desc.format)
            .extent(vk::Extent3D {
                width: desc.width,
                height: desc.height,
                depth: 1,
            })
            .mip_levels(desc.mips)
            .array_layers(desc.layers)
            .samples(vk::SampleCountFlags::TYPE_1)
            .tiling(vk::ImageTiling::OPTIMAL)
            .usage(desc.usage)
            .initial_layout(vk::ImageLayout::UNDEFINED);
        let info = if concurrent {
            info.sharing_mode(vk::SharingMode::CONCURRENT)
                .queue_family_indices(&families)
        } else {
            info.sharing_mode(vk::SharingMode::EXCLUSIVE)
        };
        let image = unsafe { device.create_image(&info, None)? };
        let requirements = unsafe { device.get_image_memory_requirements(image) };
        let allocated = allocate(
            ctx,
            requirements,
            &[vk::MemoryPropertyFlags::DEVICE_LOCAL],
            false,
            vk::MemoryDedicatedAllocateInfo::default().image(image),
        );
        let (memory, _) = match allocated {
            Ok(m) => m,
            Err(e) => {
                unsafe { device.destroy_image(image, None) };
                return Err(e);
            }
        };
        unsafe { device.bind_image_memory(image, memory, 0)? };
        Ok(Self {
            ctx: ctx.clone(),
            image,
            memory,
            format: desc.format,
            width: desc.width,
            height: desc.height,
            views: Vec::new(),
        })
    }

    /// A view of `layers` layers from `base_layer` at mip `mip`. Owned by the
    /// image.
    pub fn view(
        &mut self,
        view_type: vk::ImageViewType,
        mip: u32,
        base_layer: u32,
        layers: u32,
    ) -> Result<vk::ImageView> {
        let view = unsafe {
            self.ctx.device().create_image_view(
                &vk::ImageViewCreateInfo::default()
                    .image(self.image)
                    .view_type(view_type)
                    .format(self.format)
                    .subresource_range(vk::ImageSubresourceRange {
                        aspect_mask: vk::ImageAspectFlags::COLOR,
                        base_mip_level: mip,
                        level_count: 1,
                        base_array_layer: base_layer,
                        layer_count: layers,
                    }),
                None,
            )?
        };
        self.views.push(view);
        Ok(view)
    }

    /// Every mip and layer.
    pub fn whole(&self) -> vk::ImageSubresourceRange {
        vk::ImageSubresourceRange {
            aspect_mask: vk::ImageAspectFlags::COLOR,
            base_mip_level: 0,
            level_count: vk::REMAINING_MIP_LEVELS,
            base_array_layer: 0,
            layer_count: vk::REMAINING_ARRAY_LAYERS,
        }
    }
}

impl Drop for Image {
    fn drop(&mut self) {
        let device = self.ctx.device();
        unsafe {
            for &v in &self.views {
                device.destroy_image_view(v, None);
            }
            device.destroy_image(self.image, None);
            device.free_memory(self.memory, None);
        }
    }
}

/// A view the caller's image is sampled through, made per frame and dropped
/// once that frame's work is known done.
pub(crate) struct OwnedView {
    ctx: Context,
    pub view: vk::ImageView,
}

impl OwnedView {
    pub fn new(ctx: &Context, image: vk::Image, format: vk::Format) -> Result<Self> {
        let view = unsafe {
            ctx.device().create_image_view(
                &vk::ImageViewCreateInfo::default()
                    .image(image)
                    .view_type(vk::ImageViewType::TYPE_2D)
                    .format(format)
                    .subresource_range(vk::ImageSubresourceRange {
                        aspect_mask: vk::ImageAspectFlags::COLOR,
                        base_mip_level: 0,
                        level_count: 1,
                        base_array_layer: 0,
                        layer_count: 1,
                    }),
                None,
            )?
        };
        Ok(Self {
            ctx: ctx.clone(),
            view,
        })
    }
}

impl Drop for OwnedView {
    fn drop(&mut self) {
        unsafe { self.ctx.device().destroy_image_view(self.view, None) };
    }
}

/// Nearest-filtered samplers: gathers read exact texels, and the address mode
/// is the only thing that differs.
pub(crate) struct Sampler {
    ctx: Context,
    pub sampler: vk::Sampler,
}

impl Sampler {
    pub fn new(ctx: &Context, address_mode: vk::SamplerAddressMode) -> Result<Self> {
        let sampler = unsafe {
            ctx.device().create_sampler(
                &vk::SamplerCreateInfo::default()
                    .mag_filter(vk::Filter::NEAREST)
                    .min_filter(vk::Filter::NEAREST)
                    .mipmap_mode(vk::SamplerMipmapMode::NEAREST)
                    .address_mode_u(address_mode)
                    .address_mode_v(address_mode)
                    .address_mode_w(address_mode)
                    .border_color(vk::BorderColor::FLOAT_TRANSPARENT_BLACK)
                    .max_lod(vk::LOD_CLAMP_NONE),
                None,
            )?
        };
        Ok(Self {
            ctx: ctx.clone(),
            sampler,
        })
    }
}

impl Drop for Sampler {
    fn drop(&mut self) {
        unsafe { self.ctx.device().destroy_sampler(self.sampler, None) };
    }
}

/// A command pool with one primary buffer per slot.
pub(crate) struct Commands {
    ctx: Context,
    pool: vk::CommandPool,
    pub buffers: Vec<vk::CommandBuffer>,
}

impl Commands {
    pub fn new(ctx: &Context, count: u32) -> Result<Self> {
        let device = ctx.device();
        let pool = unsafe {
            device.create_command_pool(
                &vk::CommandPoolCreateInfo::default()
                    .queue_family_index(ctx.queue_family())
                    .flags(vk::CommandPoolCreateFlags::RESET_COMMAND_BUFFER),
                None,
            )?
        };
        let buffers = unsafe {
            device.allocate_command_buffers(
                &vk::CommandBufferAllocateInfo::default()
                    .command_pool(pool)
                    .level(vk::CommandBufferLevel::PRIMARY)
                    .command_buffer_count(count),
            )
        };
        let buffers = match buffers {
            Ok(b) => b,
            Err(e) => {
                unsafe { device.destroy_command_pool(pool, None) };
                return Err(e.into());
            }
        };
        Ok(Self {
            ctx: ctx.clone(),
            pool,
            buffers,
        })
    }
}

impl Drop for Commands {
    fn drop(&mut self) {
        unsafe { self.ctx.device().destroy_command_pool(self.pool, None) };
    }
}

pub(crate) struct Timeline {
    ctx: Context,
    pub semaphore: vk::Semaphore,
}

impl Timeline {
    pub fn new(ctx: &Context) -> Result<Self> {
        let mut kind = vk::SemaphoreTypeCreateInfo::default()
            .semaphore_type(vk::SemaphoreType::TIMELINE)
            .initial_value(0);
        let semaphore = unsafe {
            ctx.device()
                .create_semaphore(&vk::SemaphoreCreateInfo::default().push(&mut kind), None)?
        };
        Ok(Self {
            ctx: ctx.clone(),
            semaphore,
        })
    }

    /// Blocks until the semaphore reaches `value`.
    pub fn wait(&self, value: u64) -> Result<()> {
        let semaphores = [self.semaphore];
        let values = [value];
        unsafe {
            self.ctx.device().wait_semaphores(
                &vk::SemaphoreWaitInfo::default()
                    .semaphores(&semaphores)
                    .values(&values),
                u64::MAX,
            )?
        };
        Ok(())
    }

    pub fn value(&self) -> Result<u64> {
        Ok(unsafe {
            self.ctx
                .device()
                .get_semaphore_counter_value(self.semaphore)?
        })
    }
}

impl Drop for Timeline {
    fn drop(&mut self) {
        unsafe { self.ctx.device().destroy_semaphore(self.semaphore, None) };
    }
}

/// A query pool for GPU timestamps around each pass.
pub(crate) struct Timestamps {
    ctx: Context,
    pub pool: vk::QueryPool,
    pub count: u32,
}

impl Timestamps {
    pub fn new(ctx: &Context, count: u32) -> Result<Self> {
        let pool = unsafe {
            ctx.device().create_query_pool(
                &vk::QueryPoolCreateInfo::default()
                    .query_type(vk::QueryType::TIMESTAMP)
                    .query_count(count),
                None,
            )?
        };
        Ok(Self {
            ctx: ctx.clone(),
            pool,
            count,
        })
    }

    /// Nanoseconds between consecutive timestamps, once the work that wrote
    /// them is known done.
    pub fn read(&self) -> Result<Vec<f64>> {
        let mut raw = vec![0u64; self.count as usize];
        unsafe {
            self.ctx.device().get_query_pool_results(
                self.pool,
                0,
                &mut raw,
                vk::QueryResultFlags::TYPE_64,
            )?
        };
        let period = f64::from(self.ctx.inner().timestamp_period);
        Ok(raw
            .windows(2)
            .map(|w| w[1].wrapping_sub(w[0]) as f64 * period)
            .collect())
    }
}

impl Drop for Timestamps {
    fn drop(&mut self) {
        unsafe { self.ctx.device().destroy_query_pool(self.pool, None) };
    }
}

/// A barrier between two compute passes: every shader write before it is
/// visible to every shader read and write after it.
pub(crate) fn compute_barrier(ctx: &Context, cmd: vk::CommandBuffer) {
    memory_barrier(
        ctx,
        cmd,
        vk::PipelineStageFlags2::COMPUTE_SHADER,
        vk::AccessFlags2::SHADER_WRITE,
        vk::PipelineStageFlags2::COMPUTE_SHADER,
        vk::AccessFlags2::SHADER_READ | vk::AccessFlags2::SHADER_WRITE,
    );
}

pub(crate) fn memory_barrier(
    ctx: &Context,
    cmd: vk::CommandBuffer,
    src_stage: vk::PipelineStageFlags2,
    src_access: vk::AccessFlags2,
    dst_stage: vk::PipelineStageFlags2,
    dst_access: vk::AccessFlags2,
) {
    let barrier = [vk::MemoryBarrier2::default()
        .src_stage_mask(src_stage)
        .src_access_mask(src_access)
        .dst_stage_mask(dst_stage)
        .dst_access_mask(dst_access)];
    unsafe {
        ctx.device().cmd_pipeline_barrier2(
            cmd,
            &vk::DependencyInfo::default().memory_barriers(&barrier),
        )
    };
}

/// Moves `image` from `old` to `GENERAL`, ordered after `src_stage`.
pub(crate) fn to_general(
    ctx: &Context,
    cmd: vk::CommandBuffer,
    images: &[(vk::Image, vk::ImageLayout)],
    dst_access: vk::AccessFlags2,
) {
    let barriers: Vec<_> = images
        .iter()
        .map(|&(image, old)| {
            vk::ImageMemoryBarrier2::default()
                .src_stage_mask(vk::PipelineStageFlags2::ALL_COMMANDS)
                .src_access_mask(vk::AccessFlags2::MEMORY_WRITE)
                .dst_stage_mask(vk::PipelineStageFlags2::COMPUTE_SHADER)
                .dst_access_mask(dst_access)
                .old_layout(old)
                .new_layout(vk::ImageLayout::GENERAL)
                .src_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                .dst_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                .image(image)
                .subresource_range(vk::ImageSubresourceRange {
                    aspect_mask: vk::ImageAspectFlags::COLOR,
                    base_mip_level: 0,
                    level_count: vk::REMAINING_MIP_LEVELS,
                    base_array_layer: 0,
                    layer_count: vk::REMAINING_ARRAY_LAYERS,
                })
        })
        .collect();
    unsafe {
        ctx.device().cmd_pipeline_barrier2(
            cmd,
            &vk::DependencyInfo::default().image_memory_barriers(&barriers),
        )
    };
}
