// ─────────────────────────────────────────────────────────────────────────────
//  dispatch.rs — raw Vulkan function-pointer type aliases and dispatch tables
// ─────────────────────────────────────────────────────────────────────────────

use ash::vk;
use std::os::raw::c_char;

pub type RawFn = unsafe extern "system" fn();

// ── Instance-level ────────────────────────────────────────────────────────────

pub type PFN_vkGetInstanceProcAddr =
    unsafe extern "system" fn(vk::Instance, *const c_char) -> Option<RawFn>;
pub type PFN_vkGetDeviceProcAddr =
    unsafe extern "system" fn(vk::Device, *const c_char) -> Option<RawFn>;

pub type PFN_vkCreateInstance = unsafe extern "system" fn(
    *const vk::InstanceCreateInfo,
    *const vk::AllocationCallbacks,
    *mut vk::Instance,
) -> vk::Result;
pub type PFN_vkDestroyInstance =
    unsafe extern "system" fn(vk::Instance, *const vk::AllocationCallbacks);

pub type PFN_vkGetPhysicalDeviceMemoryProperties =
    unsafe extern "system" fn(vk::PhysicalDevice, *mut vk::PhysicalDeviceMemoryProperties);

pub type PFN_vkCreateDevice = unsafe extern "system" fn(
    vk::PhysicalDevice,
    *const vk::DeviceCreateInfo,
    *const vk::AllocationCallbacks,
    *mut vk::Device,
) -> vk::Result;

// ── Device infrastructure ─────────────────────────────────────────────────────

pub type PFN_vkDestroyDevice =
    unsafe extern "system" fn(vk::Device, *const vk::AllocationCallbacks);

pub type PFN_vkGetDeviceQueue = unsafe extern "system" fn(vk::Device, u32, u32, *mut vk::Queue);

pub type PFN_vkQueuePresentKHR =
    unsafe extern "system" fn(vk::Queue, *const vk::PresentInfoKHR) -> vk::Result;

// ── Phase 1: Shader modules ───────────────────────────────────────────────────

pub type PFN_vkCreateShaderModule = unsafe extern "system" fn(
    vk::Device,
    *const vk::ShaderModuleCreateInfo,
    *const vk::AllocationCallbacks,
    *mut vk::ShaderModule,
) -> vk::Result;

pub type PFN_vkDestroyShaderModule =
    unsafe extern "system" fn(vk::Device, vk::ShaderModule, *const vk::AllocationCallbacks);

// ── Phase 1: Graphics pipelines ──────────────────────────────────────────────

pub type PFN_vkCreateGraphicsPipelines = unsafe extern "system" fn(
    vk::Device,
    vk::PipelineCache,
    u32,
    *const vk::GraphicsPipelineCreateInfo,
    *const vk::AllocationCallbacks,
    *mut vk::Pipeline,
) -> vk::Result;

pub type PFN_vkDestroyPipeline =
    unsafe extern "system" fn(vk::Device, vk::Pipeline, *const vk::AllocationCallbacks);

// ── Phase 2: Image views and framebuffers ─────────────────────────────────────

pub type PFN_vkCreateImageView = unsafe extern "system" fn(
    vk::Device,
    *const vk::ImageViewCreateInfo,
    *const vk::AllocationCallbacks,
    *mut vk::ImageView,
) -> vk::Result;

pub type PFN_vkDestroyImageView =
    unsafe extern "system" fn(vk::Device, vk::ImageView, *const vk::AllocationCallbacks);

pub type PFN_vkCreateFramebuffer = unsafe extern "system" fn(
    vk::Device,
    *const vk::FramebufferCreateInfo,
    *const vk::AllocationCallbacks,
    *mut vk::Framebuffer,
) -> vk::Result;

pub type PFN_vkDestroyFramebuffer =
    unsafe extern "system" fn(vk::Device, vk::Framebuffer, *const vk::AllocationCallbacks);

pub type PFN_vkAllocateCommandBuffers = unsafe extern "system" fn(
    vk::Device,
    *const vk::CommandBufferAllocateInfo,
    *mut vk::CommandBuffer,
) -> vk::Result;

pub type PFN_vkFreeCommandBuffers =
    unsafe extern "system" fn(vk::Device, vk::CommandPool, u32, *const vk::CommandBuffer);

// ── Phase 2: Render pass and rendering ───────────────────────────────────────

pub type PFN_vkCmdBindPipeline =
    unsafe extern "system" fn(vk::CommandBuffer, vk::PipelineBindPoint, vk::Pipeline);

pub type PFN_vkCmdBeginRenderPass = unsafe extern "system" fn(
    vk::CommandBuffer,
    *const vk::RenderPassBeginInfo,
    vk::SubpassContents,
);

pub type PFN_vkCmdEndRenderPass = unsafe extern "system" fn(vk::CommandBuffer);

pub type PFN_vkCmdBeginRenderingKHR =
    unsafe extern "system" fn(vk::CommandBuffer, *const vk::RenderingInfo);

pub type PFN_vkCmdEndRenderingKHR = unsafe extern "system" fn(vk::CommandBuffer);

// ── Phase 4: Capture images and memory ───────────────────────────────────────

pub type PFN_vkCreateImage = unsafe extern "system" fn(
    vk::Device,
    *const vk::ImageCreateInfo,
    *const vk::AllocationCallbacks,
    *mut vk::Image,
) -> vk::Result;

pub type PFN_vkDestroyImage =
    unsafe extern "system" fn(vk::Device, vk::Image, *const vk::AllocationCallbacks);

pub type PFN_vkAllocateMemory = unsafe extern "system" fn(
    vk::Device,
    *const vk::MemoryAllocateInfo,
    *const vk::AllocationCallbacks,
    *mut vk::DeviceMemory,
) -> vk::Result;

pub type PFN_vkFreeMemory =
    unsafe extern "system" fn(vk::Device, vk::DeviceMemory, *const vk::AllocationCallbacks);

pub type PFN_vkBindImageMemory = unsafe extern "system" fn(
    vk::Device,
    vk::Image,
    vk::DeviceMemory,
    vk::DeviceSize,
) -> vk::Result;

pub type PFN_vkGetImageMemoryRequirements =
    unsafe extern "system" fn(vk::Device, vk::Image, *mut vk::MemoryRequirements);

pub type PFN_vkMapMemory = unsafe extern "system" fn(
    vk::Device,
    vk::DeviceMemory,
    vk::DeviceSize,
    vk::DeviceSize,
    vk::MemoryMapFlags,
    *mut *mut std::os::raw::c_void,
) -> vk::Result;

pub type PFN_vkUnmapMemory = unsafe extern "system" fn(vk::Device, vk::DeviceMemory);

pub type PFN_vkCmdPipelineBarrier = unsafe extern "system" fn(
    vk::CommandBuffer,
    vk::PipelineStageFlags,
    vk::PipelineStageFlags,
    vk::DependencyFlags,
    u32,
    *const vk::MemoryBarrier,
    u32,
    *const vk::BufferMemoryBarrier,
    u32,
    *const vk::ImageMemoryBarrier,
);

pub type PFN_vkCmdCopyImage = unsafe extern "system" fn(
    vk::CommandBuffer,
    vk::Image,
    vk::ImageLayout,
    vk::Image,
    vk::ImageLayout,
    u32,
    *const vk::ImageCopy,
);

pub type PFN_vkGetImageSubresourceLayout = unsafe extern "system" fn(
    vk::Device,
    vk::Image,
    *const vk::ImageSubresource,
    *mut vk::SubresourceLayout,
);

// DRM format modifiers. Both optional: without them the capture ring stays
// linear, which is what it was before it could be anything else.
pub type PFN_vkGetPhysicalDeviceFormatProperties2 = unsafe extern "system" fn(
    vk::PhysicalDevice,
    vk::Format,
    *mut vk::FormatProperties2<'_>,
);

pub type PFN_vkGetImageDrmFormatModifierPropertiesEXT = unsafe extern "system" fn(
    vk::Device,
    vk::Image,
    *mut vk::ImageDrmFormatModifierPropertiesEXT<'_>,
) -> vk::Result;

// Timestamp queries around the capture blit. All optional: without them the
// blit's GPU cost is simply not reported.
pub type PFN_vkGetPhysicalDeviceProperties =
    unsafe extern "system" fn(vk::PhysicalDevice, *mut vk::PhysicalDeviceProperties);

pub type PFN_vkGetPhysicalDeviceQueueFamilyProperties =
    unsafe extern "system" fn(vk::PhysicalDevice, *mut u32, *mut vk::QueueFamilyProperties);

pub type PFN_vkCreateQueryPool = unsafe extern "system" fn(
    vk::Device,
    *const vk::QueryPoolCreateInfo<'_>,
    *const vk::AllocationCallbacks,
    *mut vk::QueryPool,
) -> vk::Result;

pub type PFN_vkDestroyQueryPool = unsafe extern "system" fn(
    vk::Device,
    vk::QueryPool,
    *const vk::AllocationCallbacks,
);

pub type PFN_vkCmdResetQueryPool =
    unsafe extern "system" fn(vk::CommandBuffer, vk::QueryPool, u32, u32);

pub type PFN_vkCmdWriteTimestamp = unsafe extern "system" fn(
    vk::CommandBuffer,
    vk::PipelineStageFlags,
    vk::QueryPool,
    u32,
);

pub type PFN_vkGetQueryPoolResults = unsafe extern "system" fn(
    vk::Device,
    vk::QueryPool,
    u32,
    u32,
    usize,
    *mut std::ffi::c_void,
    vk::DeviceSize,
    vk::QueryResultFlags,
) -> vk::Result;

// DMA-BUF fd export (used to share final_image with pixelforge zero-copy)
pub type PFN_vkGetMemoryFdKHR = unsafe extern "system" fn(
    vk::Device,
    *const vk::MemoryGetFdInfoKHR,
    *mut std::os::raw::c_int,
) -> vk::Result;

// ── Phase 4: Synchronisation ─────────────────────────────────────────────────

pub type PFN_vkCreateFence = unsafe extern "system" fn(
    vk::Device,
    *const vk::FenceCreateInfo,
    *const vk::AllocationCallbacks,
    *mut vk::Fence,
) -> vk::Result;

pub type PFN_vkDestroyFence =
    unsafe extern "system" fn(vk::Device, vk::Fence, *const vk::AllocationCallbacks);

pub type PFN_vkCreateSemaphore = unsafe extern "system" fn(
    vk::Device,
    *const vk::SemaphoreCreateInfo,
    *const vk::AllocationCallbacks,
    *mut vk::Semaphore,
) -> vk::Result;

pub type PFN_vkDestroySemaphore =
    unsafe extern "system" fn(vk::Device, vk::Semaphore, *const vk::AllocationCallbacks);

pub type PFN_vkCreateCommandPool = unsafe extern "system" fn(
    vk::Device,
    *const vk::CommandPoolCreateInfo,
    *const vk::AllocationCallbacks,
    *mut vk::CommandPool,
) -> vk::Result;

pub type PFN_vkDestroyCommandPool =
    unsafe extern "system" fn(vk::Device, vk::CommandPool, *const vk::AllocationCallbacks);

pub type PFN_vkResetCommandPool =
    unsafe extern "system" fn(vk::Device, vk::CommandPool, vk::CommandPoolResetFlags) -> vk::Result;

pub type PFN_vkBeginCommandBuffer =
    unsafe extern "system" fn(vk::CommandBuffer, *const vk::CommandBufferBeginInfo) -> vk::Result;

pub type PFN_vkEndCommandBuffer = unsafe extern "system" fn(vk::CommandBuffer) -> vk::Result;

pub type PFN_vkQueueSubmit =
    unsafe extern "system" fn(vk::Queue, u32, *const vk::SubmitInfo, vk::Fence) -> vk::Result;

pub type PFN_vkWaitForFences =
    unsafe extern "system" fn(vk::Device, u32, *const vk::Fence, vk::Bool32, u64) -> vk::Result;

pub type PFN_vkResetFences =
    unsafe extern "system" fn(vk::Device, u32, *const vk::Fence) -> vk::Result;

// ── Phase 4: Swapchain tracking ──────────────────────────────────────────────

pub type PFN_vkCreateSwapchainKHR = unsafe extern "system" fn(
    vk::Device,
    *const vk::SwapchainCreateInfoKHR,
    *const vk::AllocationCallbacks,
    *mut vk::SwapchainKHR,
) -> vk::Result;

pub type PFN_vkDestroySwapchainKHR =
    unsafe extern "system" fn(vk::Device, vk::SwapchainKHR, *const vk::AllocationCallbacks);

pub type PFN_vkGetSwapchainImagesKHR =
    unsafe extern "system" fn(vk::Device, vk::SwapchainKHR, *mut u32, *mut vk::Image) -> vk::Result;

pub type PFN_vkAcquireNextImageKHR = unsafe extern "system" fn(
    vk::Device,
    vk::SwapchainKHR,
    u64,
    vk::Semaphore,
    vk::Fence,
    *mut u32,
) -> vk::Result;

pub type PFN_vkAcquireNextImage2KHR = unsafe extern "system" fn(
    vk::Device,
    *const vk::AcquireNextImageInfoKHR<'_>,
    *mut u32,
) -> vk::Result;

// ── Phase 6: Draw commands ───────────────────────────────────────────────────

pub type PFN_vkCmdDraw = unsafe extern "system" fn(vk::CommandBuffer, u32, u32, u32, u32);
pub type PFN_vkCmdDrawIndexed =
    unsafe extern "system" fn(vk::CommandBuffer, u32, u32, u32, i32, u32);
pub type PFN_vkCmdDrawIndirect =
    unsafe extern "system" fn(vk::CommandBuffer, vk::Buffer, vk::DeviceSize, u32, u32);
pub type PFN_vkCmdDrawIndexedIndirect =
    unsafe extern "system" fn(vk::CommandBuffer, vk::Buffer, vk::DeviceSize, u32, u32);
pub type PFN_vkCmdDrawIndirectCount = unsafe extern "system" fn(
    vk::CommandBuffer,
    vk::Buffer,
    vk::DeviceSize,
    vk::Buffer,
    vk::DeviceSize,
    u32,
    u32,
);
pub type PFN_vkCmdDrawIndexedIndirectCount = unsafe extern "system" fn(
    vk::CommandBuffer,
    vk::Buffer,
    vk::DeviceSize,
    vk::Buffer,
    vk::DeviceSize,
    u32,
    u32,
);

pub type PFN_vkResetCommandBuffer =
    unsafe extern "system" fn(vk::CommandBuffer, vk::CommandBufferResetFlags) -> vk::Result;

// ── Dispatch table structs ────────────────────────────────────────────────────

pub struct NextInstanceFn {
    pub get_instance_proc_addr: PFN_vkGetInstanceProcAddr,
    pub destroy_instance: PFN_vkDestroyInstance,
    pub get_physical_device_memory_properties: PFN_vkGetPhysicalDeviceMemoryProperties,
    /// `None` on an instance below Vulkan 1.1 without
    /// `VK_KHR_get_physical_device_properties2`. Without it the modifier list
    /// cannot be queried and the capture ring stays linear.
    pub get_physical_device_format_properties2: Option<PFN_vkGetPhysicalDeviceFormatProperties2>,
    /// Needed for `timestampPeriod`, which turns device ticks into nanoseconds.
    pub get_physical_device_properties: Option<PFN_vkGetPhysicalDeviceProperties>,
    /// Needed for a queue family's `timestampValidBits`. A family reporting
    /// zero makes `vkCmdWriteTimestamp` illegal on it, so it has to be asked.
    pub get_physical_device_queue_family_properties:
        Option<PFN_vkGetPhysicalDeviceQueueFamilyProperties>,
    pub create_device: PFN_vkCreateDevice,
}

#[derive(Clone, Copy)]
pub struct NextDeviceFn {
    // Infrastructure
    pub get_device_proc_addr: PFN_vkGetDeviceProcAddr,
    pub destroy_device: PFN_vkDestroyDevice,
    pub get_device_queue: PFN_vkGetDeviceQueue,
    pub queue_present_khr: Option<PFN_vkQueuePresentKHR>,

    // Phase 1
    pub create_shader_module: PFN_vkCreateShaderModule,
    pub destroy_shader_module: PFN_vkDestroyShaderModule,
    pub create_graphics_pipelines: PFN_vkCreateGraphicsPipelines,
    pub destroy_pipeline: PFN_vkDestroyPipeline,

    // Phase 2
    pub create_image_view: PFN_vkCreateImageView,
    pub destroy_image_view: PFN_vkDestroyImageView,
    pub create_framebuffer: PFN_vkCreateFramebuffer,
    pub destroy_framebuffer: PFN_vkDestroyFramebuffer,
    pub allocate_command_buffers: PFN_vkAllocateCommandBuffers,
    pub free_command_buffers: PFN_vkFreeCommandBuffers,
    pub cmd_bind_pipeline: PFN_vkCmdBindPipeline,
    pub cmd_begin_render_pass: PFN_vkCmdBeginRenderPass,
    pub cmd_end_render_pass: PFN_vkCmdEndRenderPass,
    pub cmd_begin_rendering_khr: Option<PFN_vkCmdBeginRenderingKHR>,
    pub cmd_end_rendering_khr: Option<PFN_vkCmdEndRenderingKHR>,

    // Phase 4 — capture images
    pub create_image: PFN_vkCreateImage,
    pub destroy_image: PFN_vkDestroyImage,
    pub allocate_memory: PFN_vkAllocateMemory,
    pub free_memory: PFN_vkFreeMemory,
    pub bind_image_memory: PFN_vkBindImageMemory,
    pub get_image_memory_requirements: PFN_vkGetImageMemoryRequirements,
    pub map_memory: PFN_vkMapMemory,
    pub unmap_memory: PFN_vkUnmapMemory,
    pub cmd_pipeline_barrier: PFN_vkCmdPipelineBarrier,
    pub cmd_copy_image: PFN_vkCmdCopyImage,
    pub get_image_subresource_layout: PFN_vkGetImageSubresourceLayout,
    /// `None` when `VK_KHR_external_memory_fd` is unavailable.
    /// Required for DMA-BUF export to pixelforge's VkDevice.
    pub get_memory_fd_khr: Option<PFN_vkGetMemoryFdKHR>,
    /// `None` when `VK_EXT_image_drm_format_modifier` was not enabled. The
    /// driver picks the modifier from the list it is offered, so this is how
    /// the layer learns which one it actually got — and the importer needs the
    /// exact value, not the list.
    pub get_image_drm_format_modifier_properties_ext:
        Option<PFN_vkGetImageDrmFormatModifierPropertiesEXT>,

    // Phase 4 — blit timing. All-or-nothing: the ring only times the blit when
    // every one of these loaded and the presenting queue family can timestamp.
    pub create_query_pool: Option<PFN_vkCreateQueryPool>,
    pub destroy_query_pool: Option<PFN_vkDestroyQueryPool>,
    pub cmd_reset_query_pool: Option<PFN_vkCmdResetQueryPool>,
    pub cmd_write_timestamp: Option<PFN_vkCmdWriteTimestamp>,
    pub get_query_pool_results: Option<PFN_vkGetQueryPoolResults>,

    // Phase 4 — synchronisation
    pub create_fence: PFN_vkCreateFence,
    pub destroy_fence: PFN_vkDestroyFence,
    /// Core since 1.0, but loaded optionally so a driver that somehow fails to
    /// resolve it degrades to no capture rather than to a null-pointer call.
    pub create_semaphore: Option<PFN_vkCreateSemaphore>,
    pub destroy_semaphore: Option<PFN_vkDestroySemaphore>,
    pub create_command_pool: PFN_vkCreateCommandPool,
    pub destroy_command_pool: PFN_vkDestroyCommandPool,
    pub reset_command_pool: PFN_vkResetCommandPool,
    pub begin_command_buffer: PFN_vkBeginCommandBuffer,
    pub end_command_buffer: PFN_vkEndCommandBuffer,
    pub queue_submit: PFN_vkQueueSubmit,
    pub wait_for_fences: PFN_vkWaitForFences,
    pub reset_fences: PFN_vkResetFences,

    // Phase 4 — swapchain
    pub create_swapchain_khr: Option<PFN_vkCreateSwapchainKHR>,
    pub destroy_swapchain_khr: Option<PFN_vkDestroySwapchainKHR>,
    pub get_swapchain_images_khr: Option<PFN_vkGetSwapchainImagesKHR>,
    /// Both acquire entry points, hooked only to time them. A game uses one or
    /// the other and the layer must not care which.
    pub acquire_next_image_khr: Option<PFN_vkAcquireNextImageKHR>,
    pub acquire_next_image2_khr: Option<PFN_vkAcquireNextImage2KHR>,

    // Phase 6 — draw commands
    pub cmd_draw: PFN_vkCmdDraw,
    pub cmd_draw_indexed: PFN_vkCmdDrawIndexed,
    pub cmd_draw_indirect: PFN_vkCmdDrawIndirect,
    pub cmd_draw_indexed_indirect: PFN_vkCmdDrawIndexedIndirect,
    pub cmd_draw_indirect_count: Option<PFN_vkCmdDrawIndirectCount>,
    pub cmd_draw_indexed_indirect_count: Option<PFN_vkCmdDrawIndexedIndirectCount>,

    pub reset_command_buffer: PFN_vkResetCommandBuffer,
}
