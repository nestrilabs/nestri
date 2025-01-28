package relay

import (
	"fmt"
	"time"
)

type TimestampEntry struct {
	Stage string `json:"stage"`
	Time  string `json:"time"` // ISO 8601 string
}

// LatencyTracker provides a generic structure for measuring time taken at various stages in message processing.
// It can be embedded in message structs for tracking the flow of data and calculating round-trip latency.
type LatencyTracker struct {
	SequenceID string            `json:"sequence_id"`
	Timestamps []TimestampEntry  `json:"timestamps"`
	Metadata   map[string]string `json:"metadata,omitempty"`
}

// NewLatencyTracker initializes a new LatencyTracker with the given sequence ID
func NewLatencyTracker(sequenceID string) *LatencyTracker {
	return &LatencyTracker{
		SequenceID: sequenceID,
		Timestamps: make([]TimestampEntry, 0),
		Metadata:   make(map[string]string),
	}
}

// AddTimestamp adds a new timestamp for a specific stage
func (lt *LatencyTracker) AddTimestamp(stage string) {
	lt.Timestamps = append(lt.Timestamps, TimestampEntry{
		Stage: stage,
		// Ensure extremely precise UTC RFC3339 timestamps (down to nanoseconds)
		Time: time.Now().UTC().Format(time.RFC3339Nano),
	})
}

// TotalLatency calculates the total latency from the earliest to the latest timestamp
func (lt *LatencyTracker) TotalLatency() (int64, error) {
	if len(lt.Timestamps) < 2 {
		return 0, nil // Not enough timestamps to calculate latency
	}

	var earliest, latest time.Time
	for _, ts := range lt.Timestamps {
		t, err := time.Parse(time.RFC3339, ts.Time)
		if err != nil {
			return 0, err
		}
		if earliest.IsZero() || t.Before(earliest) {
			earliest = t
		}
		if latest.IsZero() || t.After(latest) {
			latest = t
		}
	}

	return latest.Sub(earliest).Milliseconds(), nil
}

// PainPoints returns a list of stages where the duration exceeds the given threshold.
func (lt *LatencyTracker) PainPoints(threshold time.Duration) []string {
	var painPoints []string
	var lastStage string
	var lastTime time.Time

	for _, ts := range lt.Timestamps {
		stage := ts.Stage
		t := ts.Time
		if lastStage == "" {
			lastStage = stage
			lastTime, _ = time.Parse(time.RFC3339, t)
			continue
		}

		currentTime, _ := time.Parse(time.RFC3339, t)
		if currentTime.Sub(lastTime) > threshold {
			painPoints = append(painPoints, fmt.Sprintf("%s -> %s", lastStage, stage))
		}

		lastStage = stage
		lastTime = currentTime
	}
	return painPoints
}

// StageLatency calculates the time taken between two specific stages.
func (lt *LatencyTracker) StageLatency(startStage, endStage string) (time.Duration, error) {
	startTime, endTime := "", ""
	for _, ts := range lt.Timestamps {
		if ts.Stage == startStage {
			startTime = ts.Time
		}
		if ts.Stage == endStage {
			endTime = ts.Time
		}
	}

	if startTime == "" || endTime == "" {
		return 0, fmt.Errorf("missing timestamps for stages: %s -> %s", startStage, endStage)
	}

	start, err := time.Parse(time.RFC3339, startTime)
	if err != nil {
		return 0, err
	}
	end, err := time.Parse(time.RFC3339, endTime)
	if err != nil {
		return 0, err
	}

	return end.Sub(start), nil
}
