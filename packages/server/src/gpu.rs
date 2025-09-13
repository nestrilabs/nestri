use std::error::Error;
use std::fs;
use std::str;

#[derive(Debug, Eq, PartialEq, Clone, Hash)]
pub enum GPUVendor {
    UNKNOWN = 0x0000,
    INTEL = 0x8086,
    NVIDIA = 0x10de,
    AMD = 0x1002,
}
impl From<u16> for GPUVendor {
    fn from(value: u16) -> Self {
        match value {
            0x8086 => GPUVendor::INTEL,
            0x10de => GPUVendor::NVIDIA,
            0x1002 => GPUVendor::AMD,
            _ => GPUVendor::UNKNOWN,
        }
    }
}
impl GPUVendor {
    pub fn as_str(&self) -> &str {
        match self {
            GPUVendor::INTEL => "Intel",
            GPUVendor::NVIDIA => "NVIDIA",
            GPUVendor::AMD => "AMD",
            GPUVendor::UNKNOWN => "Unknown",
        }
    }
}
impl std::fmt::Display for GPUVendor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub struct GPUInfo {
    vendor: GPUVendor,
    card_path: String,
    render_path: String,
    device_name: String,
    pci_bus_id: String,
}
impl GPUInfo {
    pub fn vendor(&self) -> &GPUVendor {
        &self.vendor
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

    pub fn pci_bus_id(&self) -> &str {
        &self.pci_bus_id
    }

    pub fn as_str(&self) -> String {
        format!(
            "{} (Vendor: {}, Card Path: {}, Render Path: {}, PCI Bus ID: {})",
            self.device_name, self.vendor, self.card_path, self.render_path, self.pci_bus_id
        )
    }
}
impl std::fmt::Display for GPUInfo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Retrieves a list of GPUs available on the system.
/// # Returns
/// * `Vec<GPUInfo>` - A vector containing information about each GPU.
pub fn get_gpus() -> Result<Vec<GPUInfo>, Box<dyn Error>> {
    // Use "/sys/class/drm/card{}" to find all GPU devices
    let mut gpus = Vec::new();
    let re = regex::Regex::new(r"^card(\d+)$")?;
    for entry in fs::read_dir("/sys/class/drm")? {
        let entry = entry?;
        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy();

        // We are only interested in entries that match "cardN", and getting the minor number
        let caps = match re.captures(&file_name_str) {
            Some(caps) => caps,
            None => continue,
        };
        let minor = &caps[1];

        // Read vendor and device ID
        let vendor_str = fs::read_to_string(format!("/sys/class/drm/card{}/device/vendor", minor))?;
        let vendor_str = vendor_str.trim_start_matches("0x").trim_end_matches('\n');
        let vendor = u16::from_str_radix(vendor_str, 16)?;

        let device_str = fs::read_to_string(format!("/sys/class/drm/card{}/device/device", minor))?;
        let device_str = device_str.trim_start_matches("0x").trim_end_matches('\n');

        // Look up in hwdata PCI database
        let device_name = match fs::read_to_string("/usr/share/hwdata/pci.ids") {
            Ok(pci_ids) => parse_pci_ids(&pci_ids, vendor_str, device_str).unwrap_or("".to_owned()),
            Err(e) => {
                tracing::warn!("Failed to read /usr/share/hwdata/pci.ids: {}", e);
                "".to_owned()
            }
        };

        // Read PCI bus ID
        let pci_bus_id = fs::read_to_string(format!("/sys/class/drm/card{}/device/uevent", minor))?;
        let pci_bus_id = pci_bus_id
            .lines()
            .find_map(|line| {
                if line.starts_with("PCI_SLOT_NAME=") {
                    Some(line.trim_start_matches("PCI_SLOT_NAME=").to_owned())
                } else {
                    None
                }
            })
            .ok_or("PCI_SLOT_NAME not found")?;

        // Get DRI device paths
        if let Some((card_path, render_path)) = get_dri_device_path(pci_bus_id.as_str()) {
            gpus.push(GPUInfo {
                vendor: vendor.into(),
                card_path,
                render_path,
                device_name,
                pci_bus_id,
            });
        }
    }

    Ok(gpus)
}

fn parse_pci_ids(pci_data: &str, vendor_id: &str, device_id: &str) -> Option<String> {
    let mut current_vendor = String::new();
    let vendor_id = vendor_id.to_lowercase();
    let device_id = device_id.to_lowercase();

    for line in pci_data.lines() {
        // Skip comments and empty lines
        if line.starts_with('#') || line.is_empty() {
            continue;
        }

        // Check for vendor lines (no leading whitespace)
        if !line.starts_with(['\t', ' ']) {
            let mut parts = line.splitn(2, ' ');
            if let (Some(vendor), Some(_)) = (parts.next(), parts.next()) {
                current_vendor = vendor.to_lowercase();
            }
            continue;
        }

        // Check for device lines (leading whitespace)
        let line = line.trim_start();
        let mut parts = line.splitn(2, ' ');
        if let (Some(dev_id), Some(desc)) = (parts.next(), parts.next()) {
            if dev_id.to_lowercase() == device_id && current_vendor == vendor_id {
                return Some(desc.trim().to_owned());
            }
        }
    }

    None
}

fn get_dri_device_path(pci_addr: &str) -> Option<(String, String)> {
    let entries = fs::read_dir("/sys/bus/pci/devices").ok()?;

    for entry in entries.flatten() {
        if !entry.path().to_string_lossy().contains(&pci_addr) {
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

pub fn get_gpus_by_vendor(gpus: &[GPUInfo], vendor: &str) -> Vec<GPUInfo> {
    let target = vendor.to_lowercase();
    gpus.iter()
        .filter(|gpu| gpu.vendor().as_str().to_lowercase() == target)
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

pub fn get_nvidia_gpu_by_cuda_id(gpus: &[GPUInfo], cuda_device_id: usize) -> Option<GPUInfo> {
    // Check if nvidia-smi is available
    if std::process::Command::new("nvidia-smi")
        .arg("--help")
        .output()
        .is_err()
    {
        tracing::warn!("nvidia-smi is not available");
        return None;
    }

    // Run nvidia-smi to get information about the CUDA device
    let output = std::process::Command::new("nvidia-smi")
        .args([
            "--query-gpu=pci.bus_id",
            "--format=csv,noheader",
            "-i",
            &cuda_device_id.to_string(),
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    // Parse the output to get the PCI bus ID
    let pci_bus_id = str::from_utf8(&output.stdout).ok()?.trim().to_uppercase(); // nvidia-smi returns uppercase PCI IDs

    // Convert from 00000000:05:00.0 to 05:00.0 if needed
    let pci_bus_id = if pci_bus_id.starts_with("00000000:") {
        pci_bus_id[9..].to_string() // Skip the domain part
    } else if pci_bus_id.starts_with("0000:") {
        pci_bus_id[5..].to_string() // Alternate check for older nvidia-smi versions
    } else {
        pci_bus_id
    };

    // Find the GPU with the matching PCI bus ID
    gpus.iter()
        .find(|gpu| gpu.vendor == GPUVendor::NVIDIA && gpu.pci_bus_id.to_uppercase() == pci_bus_id)
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires access to /sys/class/drm and a GPU; not suitable for default CI"]
    fn test_get_gpus() {
        let gpus = get_gpus().unwrap();
        // Environment-dependent; just print for manual runs.
        if gpus.is_empty() {
            eprintln!("No GPUs found; skipping assertions");
            return;
        }
        // Print the GPUs found for manual verification
        for gpu in &gpus {
            println!("{}", gpu);
        }
    }
}
