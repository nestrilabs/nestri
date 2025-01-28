pub struct AppArgs {
    /// Verbose output mode
    pub verbose: bool,
    /// Debug the pipeline by showing a window on host
    pub debug_feed: bool,
    /// Debug the latency by showing time in stream
    pub debug_latency: bool,

    /// Virtual display resolution
    pub resolution: (u32, u32),
    /// Virtual display framerate
    pub framerate: u32,

    /// Nestri relay url
    pub relay_url: String,
    /// Nestri room name/identifier
    pub room: String,

    /// Experimental DMA-BUF support
    pub dma_buf: bool,
}
impl AppArgs {
    pub fn from_matches(matches: &clap::ArgMatches) -> Self {
        Self {
            verbose: matches.get_one::<String>("verbose").unwrap() == "true"
                || matches.get_one::<String>("verbose").unwrap() == "1",
            debug_feed: matches.get_one::<String>("debug-feed").unwrap() == "true"
                || matches.get_one::<String>("debug-feed").unwrap() == "1",
            debug_latency: matches.get_one::<String>("debug-latency").unwrap() == "true"
                || matches.get_one::<String>("debug-latency").unwrap() == "1",
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
            framerate: matches
                .get_one::<String>("framerate")
                .unwrap()
                .parse::<u32>()
                .unwrap_or(60),
            relay_url: matches.get_one::<String>("relay-url").unwrap().clone(),
            // Generate random room name if not provided
            room: matches
                .get_one::<String>("room")
                .unwrap_or(&rand::random::<u32>().to_string())
                .clone(),
            dma_buf: matches.get_one::<String>("dma-buf").unwrap() == "true"
                || matches.get_one::<String>("dma-buf").unwrap() == "1",
        }
    }

    pub fn debug_print(&self) {
        println!("AppArgs:");
        println!("> verbose: {}", self.verbose);
        println!("> debug_feed: {}", self.debug_feed);
        println!("> debug_latency: {}", self.debug_latency);
        println!("> resolution: {}x{}", self.resolution.0, self.resolution.1);
        println!("> framerate: {}", self.framerate);
        println!("> relay_url: {}", self.relay_url);
        println!("> room: {}", self.room);
        println!("> dma_buf: {}", self.dma_buf);
    }
}
