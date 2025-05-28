package core

import "time"

// --- Constants ---
const (
	// PubSub Topics
	roomStateTopicName    = "room-states"
	relayMetricsTopicName = "relay-metrics"

	// Timers and Intervals
	metricsPublishInterval = 15 * time.Second // How often to publish own metrics
)
