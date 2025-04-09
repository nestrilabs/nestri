package common

import (
	"fmt"
	"google.golang.org/protobuf/types/known/timestamppb"
	gen "relay/internal/proto"
	"time"
)

type TimestampEntry struct {
	Stage string    `json:"stage"`
	Time  time.Time `json:"time"`
}

// LatencyTracker provides a generic structure for measuring time taken at various stages in message processing.
// It can be embedded in message structs for tracking the flow of data and calculating round-trip latency.
type LatencyTracker struct {
	SequenceID string           `json:"sequence_id"`
	Timestamps []TimestampEntry `json:"timestamps"`
}

// NewLatencyTracker initializes a new LatencyTracker with the given sequence ID
func NewLatencyTracker(sequenceID string) *LatencyTracker {
	return &LatencyTracker{
		SequenceID: sequenceID,
		Timestamps: make([]TimestampEntry, 0),
	}
}

// AddTimestamp adds a new timestamp for a specific stage
func (lt *LatencyTracker) AddTimestamp(stage string) {
	lt.Timestamps = append(lt.Timestamps, TimestampEntry{
		Stage: stage,
		// Ensure extremely precise UTC RFC3339 timestamps (down to nanoseconds)
		Time: time.Now().UTC(),
	})
}

// TotalLatency calculates the total latency from the earliest to the latest timestamp
func (lt *LatencyTracker) TotalLatency() (int64, error) {
	if len(lt.Timestamps) < 2 {
		return 0, nil // Not enough timestamps to calculate latency
	}

	var earliest, latest time.Time
	for _, ts := range lt.Timestamps {
		if earliest.IsZero() || ts.Time.Before(earliest) {
			earliest = ts.Time
		}
		if latest.IsZero() || ts.Time.After(latest) {
			latest = ts.Time
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
		if lastStage == "" {
			lastStage = stage
			lastTime = ts.Time
			continue
		}

		currentTime := ts.Time
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
	var startTime, endTime time.Time
	for _, ts := range lt.Timestamps {
		if ts.Stage == startStage {
			startTime = ts.Time
		}
		if ts.Stage == endStage {
			endTime = ts.Time
		}
	}

	/*if startTime == "" || endTime == "" {
		return 0, fmt.Errorf("missing timestamps for stages: %s -> %s", startStage, endStage)
	}*/

	return endTime.Sub(startTime), nil
}

func LatencyTrackerFromProto(protolt *gen.ProtoLatencyTracker) *LatencyTracker {
	ret := &LatencyTracker{
		SequenceID: protolt.GetSequenceId(),
		Timestamps: make([]TimestampEntry, 0),
	}

	for _, ts := range protolt.GetTimestamps() {
		ret.Timestamps = append(ret.Timestamps, TimestampEntry{
			Stage: ts.GetStage(),
			Time:  ts.GetTime().AsTime(),
		})
	}

	return ret
}

func (lt *LatencyTracker) ToProto() *gen.ProtoLatencyTracker {
	ret := &gen.ProtoLatencyTracker{
		SequenceId: lt.SequenceID,
		Timestamps: make([]*gen.ProtoTimestampEntry, len(lt.Timestamps)),
	}

	for i, timestamp := range lt.Timestamps {
		ret.Timestamps[i] = &gen.ProtoTimestampEntry{
			Stage: timestamp.Stage,
			Time:  timestamppb.New(timestamp.Time),
		}
	}

	return ret
}
