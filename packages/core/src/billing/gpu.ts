import {
    type IngestionContext,
    IngestionStrategy,
    type IngestionStrategyCustomer,
    type IngestionStrategyExternalCustomer,
} from "@polar-sh/ingestion";

// Define known GPU types and their credit rates
export type GPUModel = "3080" | "4080" | "4090" | string;

// Map of GPU models to their credit costs per minute
const GPU_CREDIT_RATES: Record<GPUModel, number> = {
  "3080": 3,
  "4080": 6,
  "4090": 9,
  // Default for unknown models
  "default": 1
};

// Define the context specific to GPU usage
export type GPUStrategyContext = IngestionContext<{
  gpuModel: GPUModel;
  durationMinutes: number;
  utilizationPercent: number;
  memoryUsedMB: number;
}>;

// Define the client interface we'll return
export interface GPUClient {
  startSession: (options: {
    gpuModel: GPUModel;
    instanceId: string;
    onMetrics?: (metrics: { 
      utilizationPercent: number; 
      memoryUsedMB: number;
    }) => void;
  }) => Promise<{ sessionId: string }>;
  
  endSession: (sessionId: string) => Promise<{
    durationMinutes: number;
    creditsUsed: number;
    finalMetrics: {
      avgUtilization: number;
      peakMemoryUsed: number;
    }
  }>;
  
  getActiveSessionMetrics: (sessionId: string) => Promise<{
    durationMinutes: number;
    currentUtilization: number;
    memoryUsedMB: number;
  } | null>;
}

export class GPUUsageStrategy extends IngestionStrategy<GPUStrategyContext, GPUClient> {
  private activeSessions: Map<string, {
    startTime: number;
    gpuModel: GPUModel;
    instanceId: string;
    customer: IngestionStrategyCustomer | IngestionStrategyExternalCustomer;
    metrics: {
      utilizationSamples: number[];
      memoryUsageSamples: number[];
      lastUpdateTime: number;
    };
  }> = new Map();

  private metricsPollingInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    // Start the metrics polling system
    this.startMetricsPolling();
  }

  private startMetricsPolling() {
    // Poll every 30 seconds to collect metrics from active sessions
    this.metricsPollingInterval = setInterval(() => {
      this.collectMetricsForActiveSessions();
    }, 30000);
  }

  private async collectMetricsForActiveSessions() {
    for (const [sessionId, sessionData] of this.activeSessions.entries()) {
      try {
        // In a real implementation, you would call your GPU monitoring service here
        const metrics = await this.fetchGPUMetrics(sessionData.instanceId, sessionData.gpuModel);
        
        // Store the metrics
        sessionData.metrics.utilizationSamples.push(metrics.utilizationPercent);
        sessionData.metrics.memoryUsageSamples.push(metrics.memoryUsedMB);
        sessionData.metrics.lastUpdateTime = Date.now();
        
        // Update the session data
        this.activeSessions.set(sessionId, sessionData);
      } catch (error) {
        console.error(`Failed to collect metrics for session ${sessionId}:`, error);
      }
    }
  }

  // This would connect to your actual GPU monitoring system
  private async fetchGPUMetrics(instanceId: string, gpuModel: GPUModel): Promise<{
    utilizationPercent: number;
    memoryUsedMB: number;
  }> {
    // Mock implementation - in a real system you would:
    // 1. Call your GPU monitoring API
    // 2. Parse and return the actual metrics
    
    // For this example, we're generating random values
    return {
      utilizationPercent: Math.floor(Math.random() * 100),
      memoryUsedMB: Math.floor(Math.random() * 
        (gpuModel === "4090" ? 24000 : 
         gpuModel === "4080" ? 16000 : 
         gpuModel === "3080" ? 10000 : 8000))
    };
  }

  // Get credit rate for a given GPU model
  private getCreditsForGPU(gpuModel: GPUModel): number {
    return GPU_CREDIT_RATES[gpuModel] || GPU_CREDIT_RATES.default;
  }

  // Calculate average from array of samples
  private calculateAverage(samples: number[]): number {
    if (samples.length === 0) return 0;
    return samples.reduce((sum, value) => sum + value, 0) / samples.length;
  }

  // Find maximum value in array of samples
  private findPeakValue(samples: number[]): number {
    if (samples.length === 0) return 0;
    return Math.max(...samples);
  }

  // Clean up resources when the strategy is no longer needed
  public cleanup() {
    if (this.metricsPollingInterval) {
      clearInterval(this.metricsPollingInterval);
      this.metricsPollingInterval = null;
    }
  }

  override client(
    customer: IngestionStrategyCustomer | IngestionStrategyExternalCustomer
  ): GPUClient {
    const executionHandler = this.createExecutionHandler();

    return {
      startSession: async ({ gpuModel, instanceId, onMetrics }) => {
        const sessionId = `${instanceId}-${Date.now()}`;
        
        // Initialize the session tracking
        this.activeSessions.set(sessionId, {
          startTime: Date.now(),
          gpuModel,
          instanceId,
          customer,
          metrics: {
            utilizationSamples: [],
            memoryUsageSamples: [],
            lastUpdateTime: Date.now()
          }
        });

        // Set up a callback for metrics if provided
        if (onMetrics) {
          const metricsInterval = setInterval(async () => {
            const sessionData = this.activeSessions.get(sessionId);
            if (!sessionData) {
              clearInterval(metricsInterval);
              return;
            }

            const latestMetrics = await this.fetchGPUMetrics(instanceId, gpuModel);
            onMetrics(latestMetrics);
          }, 60000); // Send metrics callback once per minute
        }

        return { sessionId };
      },

      endSession: async (sessionId) => {
        const sessionData = this.activeSessions.get(sessionId);
        if (!sessionData) {
          throw new Error(`Session ${sessionId} not found`);
        }

        // Calculate duration in minutes
        const durationMinutes = (Date.now() - sessionData.startTime) / (1000 * 60);
        
        // Calculate average utilization and peak memory
        const avgUtilization = this.calculateAverage(sessionData.metrics.utilizationSamples);
        const peakMemoryUsed = this.findPeakValue(sessionData.metrics.memoryUsageSamples);
        
        // Get credit rate for this GPU model
        const creditsPerMinute = this.getCreditsForGPU(sessionData.gpuModel);
        
        // Calculate total credits used
        const totalCredits = creditsPerMinute * durationMinutes;
        
        // Create the usage context for this GPU session
        const usageContext: GPUStrategyContext = {
          gpuModel: sessionData.gpuModel,
          durationMinutes,
          utilizationPercent: avgUtilization,
          memoryUsedMB: peakMemoryUsed
        };

        // Send the usage data to Polar
        await executionHandler(usageContext, sessionData.customer);
        
        // Clean up session tracking
        this.activeSessions.delete(sessionId);
        
        return {
          durationMinutes,
          creditsUsed: Math.ceil(totalCredits),
          finalMetrics: {
            avgUtilization,
            peakMemoryUsed
          }
        };
      },

      getActiveSessionMetrics: async (sessionId) => {
        const sessionData = this.activeSessions.get(sessionId);
        if (!sessionData) {
          return null;
        }

        const currentDurationMinutes = (Date.now() - sessionData.startTime) / (1000 * 60);
        
        // Get the most recent metrics or fetch new ones if needed
        const lastMetricsUpdateAgeMs = Date.now() - sessionData.metrics.lastUpdateTime;
        
        // If metrics are older than 2 minutes, fetch fresh data
        let currentUtilization = 0;
        let memoryUsedMB = 0;
        
        if (lastMetricsUpdateAgeMs > 120000) {
          const freshMetrics = await this.fetchGPUMetrics(sessionData.instanceId, sessionData.gpuModel);
          currentUtilization = freshMetrics.utilizationPercent;
          memoryUsedMB = freshMetrics.memoryUsedMB;
        } else if (sessionData.metrics.utilizationSamples.length > 0) {
          // Use the most recent sample
          const lastIdx = sessionData.metrics.utilizationSamples.length - 1;
          currentUtilization = sessionData.metrics.utilizationSamples[lastIdx];
          memoryUsedMB = sessionData.metrics.memoryUsageSamples[lastIdx];
        }

        return {
          durationMinutes: currentDurationMinutes,
          currentUtilization,
          memoryUsedMB
        };
      }
    };
  }
}