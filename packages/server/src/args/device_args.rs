pub struct DeviceArgs {
    /// GPU vendor (e.g. "intel")
    pub gpu_vendor: String,
    /// GPU name (e.g. "a770")
    pub gpu_name: String,
    /// GPU index, if multiple same GPUs are present
    pub gpu_index: u32,
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
                .get_one::<String>("gpu-index")
                .unwrap()
                .parse::<u32>()
                .unwrap(),
            gpu_card_path: matches
                .get_one::<String>("gpu-card-path")
                .unwrap_or(&"".to_string())
                .clone(),
        }
    }

    pub fn debug_print(&self) {
        println!("DeviceArgs:");
        println!("> gpu_vendor: {}", self.gpu_vendor);
        println!("> gpu_name: {}", self.gpu_name);
        println!("> gpu_index: {}", self.gpu_index);
        println!(
            "> gpu_card_path: {}",
            if self.gpu_card_path.is_empty() {
                "Auto-Selection"
            } else {
                &self.gpu_card_path
            }
        );
    }
}
