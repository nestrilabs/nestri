pub struct AppArgs {
    /// Verbose output mode
    pub verbose: bool,

    /// Virtual display resolution
    pub resolution: (u32, u32),
    /// Virtual display framerate
    pub framerate: u32,

    /// Nestri relay url
    pub relay_url: String,
    /// Nestri room name/identifier
    pub room: String,

    /// Experimental DMA-BUF support
    /// TODO: Move to video encoding flags
    pub dma_buf: bool,
}
impl AppArgs {
    pub fn from_matches(matches: &clap::ArgMatches) -> Self {
        Self {
            verbose: matches.get_one::<bool>("verbose").unwrap_or(&false).clone(),
            resolution: {
                let res = matches
                    .get_one::<String>("resolution")
                    .unwrap_or(&"1280x720".to_string())
                    .clone();
                let parts: Vec<&str> = res.split('x').collect();
                if parts.len() >= 2 {
                    (
                        parts[0].parse::<u32>().unwrap_or(1280),
                        parts[1].parse::<u32>().unwrap_or(720),
                    )
                } else {
                    (1280, 720)
                }
            },
            framerate: matches.get_one::<u32>("framerate").unwrap_or(&60).clone(),
            relay_url: matches
                .get_one::<String>("relay-url")
                .expect("relay url cannot be empty")
                .clone(),
            // Generate random room name if not provided
            room: matches
                .get_one::<String>("room")
                .unwrap_or(&rand::random::<u32>().to_string())
                .clone(),
            dma_buf: matches.get_one::<bool>("dma-buf").unwrap_or(&false).clone(),
        }
    }

    pub fn debug_print(&self) {
        tracing::info!("AppArgs:");
        tracing::info!("> verbose: {}", self.verbose);
        tracing::info!(
            "> resolution: '{}x{}'",
            self.resolution.0,
            self.resolution.1
        );
        tracing::info!("> framerate: {}", self.framerate);
        tracing::info!("> relay_url: '{}'", self.relay_url);
        tracing::info!("> room: '{}'", self.room);
        tracing::info!("> dma_buf: {}", self.dma_buf);
    }
}
