use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Debug)]
pub struct TimestampEntry {
    pub stage: String,
    pub time: String, // ISO 8601 timestamp
}

#[derive(Serialize, Deserialize, Debug)]
pub struct LatencyTracker {
    pub sequence_id: String,
    pub timestamps: Vec<TimestampEntry>,
    pub metadata: Option<HashMap<String, String>>, // Optional metadata
}

impl LatencyTracker {
    // Creates a new LatencyTracker
    pub fn new(sequence_id: String) -> Self {
        Self {
            sequence_id,
            timestamps: Vec::new(),
            metadata: None,
        }
    }

    // Returns the sequence ID
    pub fn sequence_id(&self) -> &str {
        &self.sequence_id
    }

    // Adds a timestamp for a specific stage
    pub fn add_timestamp(&mut self, stage: &str) {
        // Ensure extremely precise UTC format (YYYY-MM-DDTHH:MM:SS.658548387Z)
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);
        self.timestamps.push(TimestampEntry {
            stage: stage.to_string(),
            time: now,
        });
    }

    // Calculate total latency (first to last timestamp)
    pub fn total_latency(&self) -> Option<i64> {
        if self.timestamps.len() < 2 {
            return None;
        }
        let parsed_times: Result<Vec<_>, _> = self
            .timestamps
            .iter()
            .map(|entry| chrono::DateTime::parse_from_rfc3339(&entry.time))
            .collect();
        if let Ok(parsed_times) = parsed_times {
            let min_time = parsed_times.iter().min().unwrap();
            let max_time = parsed_times.iter().max().unwrap();
            Some((*max_time - *min_time).num_milliseconds())
        } else {
            None
        }
    }
}
