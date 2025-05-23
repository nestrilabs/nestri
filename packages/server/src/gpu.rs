use regex::Regex;
use std::fs;
use std::process::Command;
use std::str;

#[derive(Debug, Eq, PartialEq, Clone)]
pub enum GPUVendor {
    UNKNOWN,
    INTEL,
    NVIDIA,
    AMD,
}

#[derive(Debug, Clone)]
pub struct GPUInfo {
    vendor: GPUVendor,
    card_path: String,
    render_path: String,
    device_name: String,
}

impl GPUInfo {
    pub fn vendor(&self) -> &GPUVendor {
        &self.vendor
    }

    pub fn vendor_string(&self) -> &str {
        match self.vendor {
            GPUVendor::INTEL => "Intel",
            GPUVendor::NVIDIA => "NVIDIA",
            GPUVendor::AMD => "AMD",
            GPUVendor::UNKNOWN => "Unknown",
        }
    }

    pub fn card_path(&self) -> &str {
        &self.card_path
    }

    pub fn render_path(&self) -> &str {
        &self.render_path
    }

    pub fn device_name(&self) -> &str {
        &self.device_name
    }
}

fn get_gpu_vendor(vendor_id: &str) -> GPUVendor {
    match vendor_id {
        "8086" => GPUVendor::INTEL,
        "10de" => GPUVendor::NVIDIA,
        "1002" => GPUVendor::AMD,
        _ => GPUVendor::UNKNOWN,
    }
}

/// Retrieves a list of GPUs available on the system.
/// # Returns
/// * `Vec<GPUInfo>` - A vector containing information about each GPU.
pub fn get_gpus() -> Vec<GPUInfo> {
    let output = Command::new("lspci")
        .args(["-mm", "-nn"])
        .output()
        .expect("Failed to execute lspci");

    str::from_utf8(&output.stdout)
        .unwrap()
        .lines()
        .filter_map(|line| parse_pci_device(line))
        .filter(|(class_id, _, _, _)| matches!(class_id.as_str(), "0300" | "0302" | "0380"))
        .filter_map(|(_, vendor_id, device_name, pci_addr)| {
            get_dri_device_path(&pci_addr)
                .map(|(card, render)| (vendor_id, card, render, device_name))
        })
        .map(|(vid, card_path, render_path, device_name)| GPUInfo {
            vendor: get_gpu_vendor(&vid),
            card_path,
            render_path,
            device_name,
        })
        .collect()
}

fn parse_pci_device(line: &str) -> Option<(String, String, String, String)> {
    let re = Regex::new(
        r#"^(?P<pci_addr>\S+)\s+"[^\[]*\[(?P<class_id>[0-9a-f]{4})\].*?"\s+"[^"]*?\[(?P<vendor_id>[0-9a-f]{4})\][^"]*?"\s+"(?P<device_name>[^"]+?)""#,
    ).unwrap();

    let caps = re.captures(line)?;

    // Clean device name by removing only the trailing device ID
    let device_name = caps.name("device_name")?.as_str().trim();
    let clean_re = Regex::new(r"\s+\[[0-9a-f]{4}\]$").unwrap();
    let cleaned_name = clean_re.replace(device_name, "").trim().to_string();

    Some((
        caps.name("class_id")?.as_str().to_lowercase(),
        caps.name("vendor_id")?.as_str().to_lowercase(),
        cleaned_name,
        caps.name("pci_addr")?.as_str().to_string(),
    ))
}

fn get_dri_device_path(pci_addr: &str) -> Option<(String, String)> {
    let target_dir = format!("0000:{}", pci_addr);
    let entries = fs::read_dir("/sys/bus/pci/devices").ok()?;

    for entry in entries.flatten() {
        if !entry.path().to_string_lossy().contains(&target_dir) {
            continue;
        }

        let mut card = String::new();
        let mut render = String::new();
        let drm_path = entry.path().join("drm");

        for drm_entry in fs::read_dir(drm_path).ok()?.flatten() {
            let name = drm_entry.file_name().to_string_lossy().into_owned();

            if name.starts_with("card") {
                card = format!("/dev/dri/{}", name);
            } else if name.starts_with("renderD") {
                render = format!("/dev/dri/{}", name);
            }

            if !card.is_empty() && !render.is_empty() {
                break;
            }
        }

        if !card.is_empty() {
            return Some((card, render));
        }
    }

    None
}

// Helper functions remain similar with improved readability:
pub fn get_gpus_by_vendor(gpus: &[GPUInfo], vendor: &str) -> Vec<GPUInfo> {
    let target = vendor.to_lowercase();
    gpus.iter()
        .filter(|gpu| gpu.vendor_string().to_lowercase() == target)
        .cloned()
        .collect()
}

pub fn get_gpus_by_device_name(gpus: &[GPUInfo], substring: &str) -> Vec<GPUInfo> {
    let target = substring.to_lowercase();
    gpus.iter()
        .filter(|gpu| gpu.device_name.to_lowercase().contains(&target))
        .cloned()
        .collect()
}

pub fn get_gpu_by_card_path(gpus: &[GPUInfo], path: &str) -> Option<GPUInfo> {
    gpus.iter()
        .find(|gpu| {
            gpu.card_path.eq_ignore_ascii_case(path) || gpu.render_path.eq_ignore_ascii_case(path)
        })
        .cloned()
}

pub fn get_gpu_by_index(gpus: &[GPUInfo], index: i32) -> Option<GPUInfo> {
    if index < 0 || index as usize >= gpus.len() {
        None
    } else {
        Some(gpus[index as usize].clone())
    }
}
