//! Compiles every shader to SPIR-V at build time.
//!
//! `slangc` is a hard build dependency, as in nesrecon: a build that cannot
//! compile the shaders must not produce a binary that discovers it on a
//! customer's machine. Nothing compiles at runtime.
//!
//! Every module is also run through `spirv-val` (or `$SPIRV_VAL`), and that
//! is required too: slangc has been seen to emit SPIR-V that does not
//! validate (see `shuffle_xor` in common.slang), and a check that quietly
//! skips when its tool is missing looks exactly like one that passed. The
//! guest image builder has it from spirv-tools.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Every module the crate creates, as `(source, entry point, defines, name)`.
/// Listed rather than discovered, so a new variant is a deliberate line here.
const MODULES: &[(&str, &str, &[&str], &str)] = &[
    ("rgb_to_ycbcr.slang", "rgb_to_ycbcr", &[], "rgb_to_ycbcr"),
    // The encoder requires shaderFloat16, so only the FP16 tile exists.
    ("dwt.slang", "dwt", &["FP16=1"], "dwt"),
    ("wavelet_quant.slang", "wavelet_quant", &[], "wavelet_quant"),
    (
        "analyze_rate_control.slang",
        "analyze_rate_control",
        &[],
        "analyze_rate_control",
    ),
    (
        "analyze_rate_control.slang",
        "analyze_rate_control_finalize",
        &[],
        "analyze_rate_control_finalize",
    ),
    // One per subgroup size the resolve pass can run at: the workgroup is
    // exactly one subgroup.
    (
        "resolve_rate_control.slang",
        "resolve_rate_control",
        &["WG_SIZE=16"],
        "resolve_rate_control_16",
    ),
    (
        "resolve_rate_control.slang",
        "resolve_rate_control",
        &["WG_SIZE=32"],
        "resolve_rate_control_32",
    ),
    (
        "resolve_rate_control.slang",
        "resolve_rate_control",
        &["WG_SIZE=64"],
        "resolve_rate_control_64",
    ),
    ("block_packing.slang", "block_packing", &[], "block_packing"),
    (
        "wavelet_dequant.slang",
        "wavelet_dequant",
        &[],
        "wavelet_dequant",
    ),
    // The decoder does not require shaderFloat16 and picks at runtime.
    ("idwt.slang", "idwt", &["FP16=1"], "idwt_fp16"),
    ("idwt.slang", "idwt", &["FP16=0"], "idwt_fp32"),
];

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let shader_dir = manifest.join("shaders");
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());

    println!("cargo:rerun-if-changed={}", shader_dir.display());
    println!("cargo:rerun-if-env-changed=SLANGC");
    println!("cargo:rerun-if-env-changed=SPIRV_VAL");

    let slangc = std::env::var("SLANGC").unwrap_or_else(|_| "slangc".into());
    let spirv_val = std::env::var("SPIRV_VAL").unwrap_or_else(|_| "spirv-val".into());

    let mut table = String::new();
    for (file, entry, defines, name) in MODULES {
        let src = shader_dir.join(file);
        let out = out_dir.join(format!("{name}.spv"));

        let mut cmd = Command::new(&slangc);
        cmd.arg(&src)
            .args(["-target", "spirv"])
            .args(["-profile", "spirv_1_5"])
            .arg("-emit-spirv-directly")
            // Pipelines look the entry point up by this name.
            .arg("-fvk-use-entrypoint-name")
            // Push constants are written by Rust `#[repr(C)]` structs.
            .arg("-fvk-use-c-layout")
            // slangc raises the profile for subgroup operations and says so on
            // every module; the capabilities it adds are what the shader uses,
            // and the device check is what decides whether they are there.
            .args(["-warnings-disable", "41012"])
            .args(["-I", shader_dir.to_str().unwrap()])
            .args(["-entry", entry])
            .args(["-stage", "compute"])
            .args(["-o", out.to_str().unwrap()]);
        for d in *defines {
            cmd.arg(format!("-D{d}"));
        }

        let output = cmd.output().unwrap_or_else(|e| {
            panic!(
                "could not run `{slangc}`: {e}\n\
                 nespyro compiles its shaders at build time, so Slang is \
                 required to build it. Install shader-slang, or point $SLANGC \
                 at the binary."
            )
        });
        let diagnostics = String::from_utf8_lossy(&output.stderr);
        assert!(
            output.status.success(),
            "slangc failed on {file}:{entry} {defines:?}\n{diagnostics}"
        );
        // Warnings are real here: an uninitialised read or an implicit
        // narrowing in a codec shader is a bug, not noise.
        assert!(
            !diagnostics.contains("warning"),
            "slangc warned on {file}:{entry} {defines:?}\n{diagnostics}"
        );

        let status = Command::new(&spirv_val)
            .args(["--target-env", "vulkan1.3"])
            .arg(&out)
            .status()
            .unwrap_or_else(|e| {
                panic!(
                    "could not run `{spirv_val}`: {e}\n\
                     nespyro validates its shaders at build time. Install \
                     spirv-tools, or point $SPIRV_VAL at the binary."
                )
            });
        assert!(
            status.success(),
            "{name}.spv from {file}:{entry} {defines:?} failed spirv-val"
        );

        table.push_str(&format!(
            "pub(crate) static {}: &[u8] = include_bytes!({:?});\n",
            name.to_uppercase(),
            out.display().to_string()
        ));
    }

    std::fs::write(Path::new(&out_dir).join("shaders.rs"), table).unwrap();
}
