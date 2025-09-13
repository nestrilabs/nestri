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
            gpu_vendor: matches
                .get_one::<Option<String>>("gpu-vendor")
                .cloned()
                .unwrap_or(None),
            gpu_name: matches
                .get_one::<Option<String>>("gpu-name")
                .cloned()
                .unwrap_or(None),
            gpu_index: matches
                .get_one::<Option<u32>>("gpu-index")
                .cloned()
                .unwrap_or(None),
            gpu_card_path: matches
                .get_one::<Option<String>>("gpu-card-path")
                .cloned()
                .unwrap_or(None),
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
