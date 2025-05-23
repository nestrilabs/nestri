pub struct DeviceArgs {
    /// GPU vendor (e.g. "intel")
    pub gpu_vendor: String,
    /// GPU name (e.g. "a770")
    pub gpu_name: String,
    /// GPU index, if multiple same GPUs are present, -1 for auto-selection
    pub gpu_index: i32,
    /// GPU card/render path, sets card explicitly from such path
    pub gpu_card_path: String,
}
impl DeviceArgs {
    pub fn from_matches(matches: &clap::ArgMatches) -> Self {
        Self {
            gpu_vendor: matches
                .get_one::<String>("gpu-vendor")
                .unwrap_or(&"".to_string())
                .clone(),
            gpu_name: matches
                .get_one::<String>("gpu-name")
                .unwrap_or(&"".to_string())
                .clone(),
            gpu_index: matches
                .get_one::<i32>("gpu-index")
                .unwrap_or(&-1)
                .clone(),
            gpu_card_path: matches
                .get_one::<String>("gpu-card-path")
                .unwrap_or(&"".to_string())
                .clone(),
        }
    }

    pub fn debug_print(&self) {
        tracing::info!("DeviceArgs:");
        tracing::info!("> gpu_vendor: '{}'", self.gpu_vendor);
        tracing::info!("> gpu_name: '{}'", self.gpu_name);
        tracing::info!("> gpu_index: {}", self.gpu_index);
        tracing::info!("> gpu_card_path: '{}'", self.gpu_card_path);
    }
}
