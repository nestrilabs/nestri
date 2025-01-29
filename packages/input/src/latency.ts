type TimestampEntry = {
  stage: string;
  time: Date;
};

export class LatencyTracker {
  sequence_id: string;
  timestamps: TimestampEntry[];

  constructor(sequence_id: string, timestamps: TimestampEntry[] = []) {
    this.sequence_id = sequence_id;
    this.timestamps = timestamps;
  }

  addTimestamp(stage: string): void {
    const timestamp: TimestampEntry = {
      stage,
      time: new Date(),
    };
    this.timestamps.push(timestamp);
  }

  // Calculates the total time between the first and last recorded timestamps.
  getTotalLatency(): number {
    if (this.timestamps.length < 2) return 0;

    const times = this.timestamps.map((entry) => entry.time.getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    return maxTime - minTime;
  }

  toJSON(): Record<string, any> {
    return {
      sequence_id: this.sequence_id,
      timestamps: this.timestamps.map((entry) => ({
        stage: entry.stage,
        // Fill nanoseconds with zeros to match the expected format
        time: entry.time.toISOString().replace(/\.(\d+)Z$/, ".$1000000Z"),
      })),
    };
  }

  static fromJSON(json: any): LatencyTracker {
    const timestamps: TimestampEntry[] = json.timestamps.map((ts: any) => ({
      stage: ts.stage,
      time: new Date(ts.time),
    }));
    return new LatencyTracker(json.sequence_id, timestamps);
  }
}
