pub struct DeviceArgs {
    /// GPU vendor (e.g. "intel")
    pub gpu_vendor: Option<String>,
    /// GPU name (e.g. "a770")
    pub gpu_name: Option<String>,
    /// GPU index, if multiple same GPUs are present, None for auto-selection
    pub gpu_index: Option<u32>,
    /// GPU card/render path, sets card explicitly from such path
    pub gpu_card_path: Option<String>,
}
impl DeviceArgs {
    pub fn from_matches(matches: &clap::ArgMatches) -> Self {
        Self {
            gpu_vendor: matches.get_one::<String>("gpu-vendor").cloned(),
            gpu_name: matches.get_one::<String>("gpu-name").cloned(),
            gpu_index: matches.get_one::<u32>("gpu-index").cloned(),
            gpu_card_path: matches.get_one::<String>("gpu-card-path").cloned(),
        }
    }

    pub fn debug_print(&self) {
        tracing::info!("DeviceArgs:");
        tracing::info!(
            "> gpu_vendor: '{}'",
            self.gpu_vendor.as_deref().unwrap_or("auto")
        );
        tracing::info!(
            "> gpu_name: '{}'",
            self.gpu_name.as_deref().unwrap_or("auto")
        );
        tracing::info!(
            "> gpu_index: {}",
            self.gpu_index.map_or("auto".to_string(), |i| i.to_string())
        );
        tracing::info!(
            "> gpu_card_path: '{}'",
            self.gpu_card_path.as_deref().unwrap_or("auto")
        );
    }
}
