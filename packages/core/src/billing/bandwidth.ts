import {
    type IngestionContext,
    IngestionStrategy,
    type IngestionStrategyCustomer,
    type IngestionStrategyExternalCustomer,
} from "@polar-sh/ingestion";

// Define the context specific to bandwidth usage
export type BandwidthStrategyContext = IngestionContext<{
    megabytesTransferred: number;
    durationSeconds: number;
    direction: "inbound" | "outbound" | "both";
    protocol?: string;
}>;

// Bandwidth rates per MB
const DEFAULT_CREDITS_PER_MB = 0.01; // 1 credit per 100 MB

// Client interface for bandwidth tracking
export interface BandwidthClient {
    // Track bandwidth usage
    recordBandwidthUsage: (options: {
        megabytesTransferred: number;
        durationSeconds?: number;
        direction?: "inbound" | "outbound" | "both";
        protocol?: string;
        metadata?: Record<string, any>;
    }) => Promise<{ creditsUsed: number }>;

    // Start a bandwidth tracking session
    startBandwidthSession: () => {
        sessionId: string;
        startTime: number;
    };

    // End a bandwidth tracking session with the total transferred
    endBandwidthSession: (options: {
        sessionId: string;
        megabytesTransferred: number;
        direction?: "inbound" | "outbound" | "both";
        protocol?: string;
        metadata?: Record<string, any>;
    }) => Promise<{
        creditsUsed: number;
        durationSeconds: number;
    }>;
}

// Bandwidth tracking strategy
export class BandwidthStrategy extends IngestionStrategy<BandwidthStrategyContext, BandwidthClient> {
    private creditsPerMB: number;
    private activeSessions: Map<string, {
        startTime: number;
        customer: IngestionStrategyCustomer | IngestionStrategyExternalCustomer;
    }> = new Map();

    constructor(options: { creditsPerMB?: number } = {}) {
        super();
        this.creditsPerMB = options.creditsPerMB ?? DEFAULT_CREDITS_PER_MB;
    }

    // Calculate credits for a specific amount of bandwidth
    private calculateCredits(megabytesTransferred: number): number {
        return megabytesTransferred * this.creditsPerMB;
    }

    override client(
        customer: IngestionStrategyCustomer | IngestionStrategyExternalCustomer
    ): BandwidthClient {
        const executionHandler = this.createExecutionHandler();

        return {
            // Record a single bandwidth usage event
            recordBandwidthUsage: async ({
                megabytesTransferred,
                durationSeconds = 0,
                direction = "both",
                protocol = "webrtc",
                metadata = {}
            }) => {
                // Calculate credits used
                const creditsUsed = this.calculateCredits(megabytesTransferred);

                // Create the bandwidth usage context
                const usageContext: BandwidthStrategyContext = {
                    megabytesTransferred,
                    durationSeconds,
                    direction,
                    protocol,
                    ...metadata
                };

                // Send the usage data to Polar
                await executionHandler(usageContext, customer);

                return { creditsUsed };
            },

            // Start tracking a bandwidth session
            startBandwidthSession: () => {
                const sessionId = `bw-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                const startTime = Date.now();

                // Store the session data
                this.activeSessions.set(sessionId, {
                    startTime,
                    customer
                });

                return { sessionId, startTime };
            },

            // End a bandwidth tracking session
            endBandwidthSession: async ({
                sessionId,
                megabytesTransferred,
                direction = "both",
                protocol = "webrtc",
                metadata = {}
            }) => {
                // Get the session data
                const sessionData = this.activeSessions.get(sessionId);
                if (!sessionData) {
                    throw new Error(`Session ${sessionId} not found`);
                }

                // Calculate duration
                const durationSeconds = (Date.now() - sessionData.startTime) / 1000;

                // Calculate credits used
                const creditsUsed = this.calculateCredits(megabytesTransferred);

                // Create the bandwidth usage context
                const usageContext: BandwidthStrategyContext = {
                    megabytesTransferred,
                    durationSeconds,
                    direction,
                    protocol,
                    ...metadata
                };

                // Send the usage data to Polar
                await executionHandler(usageContext, customer);

                // Clean up session data
                this.activeSessions.delete(sessionId);

                return {
                    creditsUsed,
                    durationSeconds
                };
            }
        };
    }
}