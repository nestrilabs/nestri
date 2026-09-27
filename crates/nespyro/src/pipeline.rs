//! Compute pipelines, with the layouts Granite derived by reflection written
//! out by hand.
//!
//! Every pass binds its images and samplers with push descriptors, so there
//! is no descriptor pool, and reaches its buffers through device addresses in
//! push constants, so buffers need no descriptors at all.

use std::ffi::CStr;

use ash::vk;
use ash::vk::TaggedStructure as _;

use crate::device::Context;
use crate::error::{Error, Result};

/// How a pipeline's subgroups are sized.
#[derive(Debug, Clone, Copy)]
pub(crate) enum SubgroupSize {
    /// Whatever the driver likes; the shader does not care.
    Any,
    /// Exactly this size, every subgroup full.
    Full(u32),
}

pub(crate) struct Pipeline {
    ctx: Context,
    set_layout: vk::DescriptorSetLayout,
    layout: vk::PipelineLayout,
    pipeline: vk::Pipeline,
    push_size: u32,
}

pub(crate) struct PipelineDesc<'a> {
    pub spirv: &'a [u8],
    pub entry: &'a CStr,
    pub bindings: &'a [vk::DescriptorType],
    pub push_size: u32,
    /// `(constant_id, value)` pairs, every value a 32-bit word.
    pub specialization: &'a [(u32, u32)],
    pub subgroup: SubgroupSize,
}

impl Pipeline {
    pub fn new(ctx: &Context, desc: &PipelineDesc) -> Result<Self> {
        let device = ctx.device();

        let words = ash::util::read_spv(&mut std::io::Cursor::new(desc.spirv))
            .map_err(|e| Error::Config(format!("embedded SPIR-V is malformed: {e}")))?;
        let module = unsafe {
            device
                .create_shader_module(&vk::ShaderModuleCreateInfo::default().code(&words), None)?
        };

        let bindings: Vec<_> = desc
            .bindings
            .iter()
            .enumerate()
            .map(|(i, &ty)| {
                vk::DescriptorSetLayoutBinding::default()
                    .binding(i as u32)
                    .descriptor_type(ty)
                    .descriptor_count(1)
                    .stage_flags(vk::ShaderStageFlags::COMPUTE)
            })
            .collect();
        let set_layout = unsafe {
            device.create_descriptor_set_layout(
                &vk::DescriptorSetLayoutCreateInfo::default()
                    .flags(vk::DescriptorSetLayoutCreateFlags::PUSH_DESCRIPTOR_KHR)
                    .bindings(&bindings),
                None,
            )?
        };
        let ranges = [vk::PushConstantRange::default()
            .stage_flags(vk::ShaderStageFlags::COMPUTE)
            .offset(0)
            .size(desc.push_size)];
        let set_layouts = [set_layout];
        let layout = unsafe {
            device.create_pipeline_layout(
                &vk::PipelineLayoutCreateInfo::default()
                    .set_layouts(&set_layouts)
                    .push_constant_ranges(if desc.push_size > 0 { &ranges } else { &[] }),
                None,
            )?
        };

        let entries: Vec<_> = desc
            .specialization
            .iter()
            .enumerate()
            .map(|(i, &(id, _))| vk::SpecializationMapEntry {
                constant_id: id,
                offset: 4 * i as u32,
                size: 4,
            })
            .collect();
        let data: Vec<u8> = desc
            .specialization
            .iter()
            .flat_map(|&(_, v)| v.to_ne_bytes())
            .collect();
        let specialization = vk::SpecializationInfo::default()
            .map_entries(&entries)
            .data(&data);

        let mut required = vk::PipelineShaderStageRequiredSubgroupSizeCreateInfo::default();
        let mut stage = vk::PipelineShaderStageCreateInfo::default()
            .stage(vk::ShaderStageFlags::COMPUTE)
            .module(module)
            .name(desc.entry)
            .specialization_info(&specialization);
        if let SubgroupSize::Full(size) = desc.subgroup {
            required = required.required_subgroup_size(size);
            stage = stage
                .flags(vk::PipelineShaderStageCreateFlags::REQUIRE_FULL_SUBGROUPS)
                .push(&mut required);
        }

        let created = unsafe {
            device.create_compute_pipelines(
                vk::PipelineCache::null(),
                &[vk::ComputePipelineCreateInfo::default()
                    .stage(stage)
                    .layout(layout)],
                None,
            )
        };
        unsafe { device.destroy_shader_module(module, None) };
        let pipeline = match created {
            Ok(p) => p[0],
            Err((_, e)) => {
                unsafe {
                    device.destroy_pipeline_layout(layout, None);
                    device.destroy_descriptor_set_layout(set_layout, None);
                }
                return Err(e.into());
            }
        };

        Ok(Self {
            ctx: ctx.clone(),
            set_layout,
            layout,
            pipeline,
            push_size: desc.push_size,
        })
    }

    /// Binds the pipeline, pushes its descriptors and constants, and
    /// dispatches.
    pub fn dispatch<P: Copy>(
        &self,
        cmd: vk::CommandBuffer,
        images: &[Bind],
        push: &P,
        groups: (u32, u32, u32),
    ) {
        assert_eq!(std::mem::size_of::<P>() as u32, self.push_size);
        let ctx = self.ctx.inner();
        let infos: Vec<_> = images
            .iter()
            .map(|b| {
                [vk::DescriptorImageInfo::default()
                    .image_view(b.view)
                    .image_layout(b.layout)
                    .sampler(b.sampler.unwrap_or_default())]
            })
            .collect();
        let writes: Vec<_> = images
            .iter()
            .zip(&infos)
            .enumerate()
            .map(|(i, (b, info))| {
                vk::WriteDescriptorSet::default()
                    .dst_binding(i as u32)
                    .descriptor_type(b.ty)
                    .image_info(info)
            })
            .collect();
        unsafe {
            ctx.device
                .cmd_bind_pipeline(cmd, vk::PipelineBindPoint::COMPUTE, self.pipeline);
            if !writes.is_empty() {
                ctx.push_descriptor.cmd_push_descriptor_set(
                    cmd,
                    vk::PipelineBindPoint::COMPUTE,
                    self.layout,
                    0,
                    &writes,
                );
            }
            if self.push_size > 0 {
                let bytes = std::slice::from_raw_parts(
                    (push as *const P).cast::<u8>(),
                    std::mem::size_of::<P>(),
                );
                ctx.device.cmd_push_constants(
                    cmd,
                    self.layout,
                    vk::ShaderStageFlags::COMPUTE,
                    0,
                    bytes,
                );
            }
            ctx.device.cmd_dispatch(cmd, groups.0, groups.1, groups.2);
        }
    }
}

impl Drop for Pipeline {
    fn drop(&mut self) {
        let device = self.ctx.device();
        unsafe {
            device.destroy_pipeline(self.pipeline, None);
            device.destroy_pipeline_layout(self.layout, None);
            device.destroy_descriptor_set_layout(self.set_layout, None);
        }
    }
}

/// One image binding, in binding order. nespyro's own images are always in
/// `GENERAL`; only the caller's source image comes in some other layout.
pub(crate) struct Bind {
    pub ty: vk::DescriptorType,
    pub view: vk::ImageView,
    pub sampler: Option<vk::Sampler>,
    pub layout: vk::ImageLayout,
}

impl Bind {
    pub fn sampled(view: vk::ImageView, sampler: vk::Sampler) -> Self {
        Self {
            ty: vk::DescriptorType::COMBINED_IMAGE_SAMPLER,
            view,
            sampler: Some(sampler),
            layout: vk::ImageLayout::GENERAL,
        }
    }

    pub fn texture(view: vk::ImageView, layout: vk::ImageLayout) -> Self {
        Self {
            ty: vk::DescriptorType::SAMPLED_IMAGE,
            view,
            sampler: None,
            layout,
        }
    }

    pub fn storage(view: vk::ImageView) -> Self {
        Self {
            ty: vk::DescriptorType::STORAGE_IMAGE,
            view,
            sampler: None,
            layout: vk::ImageLayout::GENERAL,
        }
    }
}

/// Entry point names, as `-fvk-use-entrypoint-name` keeps them.
pub(crate) mod entry {
    use std::ffi::CStr;
    pub const RGB_TO_YCBCR: &CStr = c"rgb_to_ycbcr";
    pub const DWT: &CStr = c"dwt";
    pub const WAVELET_QUANT: &CStr = c"wavelet_quant";
    pub const ANALYZE_RATE_CONTROL: &CStr = c"analyze_rate_control";
    pub const ANALYZE_RATE_CONTROL_FINALIZE: &CStr = c"analyze_rate_control_finalize";
    pub const RESOLVE_RATE_CONTROL: &CStr = c"resolve_rate_control";
    pub const BLOCK_PACKING: &CStr = c"block_packing";
    pub const WAVELET_DEQUANT: &CStr = c"wavelet_dequant";
    pub const IDWT: &CStr = c"idwt";
}
