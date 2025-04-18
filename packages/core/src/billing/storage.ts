import {
  type IngestionContext,
  IngestionStrategy,
  type IngestionStrategyCustomer,
  type IngestionStrategyExternalCustomer,
} from "@polar-sh/ingestion";

// Define the context specific to storage usage
export type StorageStrategyContext = IngestionContext<{
  storageSizeGB: number;
  storageType: string;
  storageLocation: string;
}>;

// Define the client interface for storage operations
export interface StorageClient {
  // Record a storage snapshot for a customer
  recordStorageUsage: (options: {
    storageSizeGB: number;
    storageType?: string;
    storageLocation?: string;
    metadata?: Record<string, any>;
  }) => Promise<void>;
  
  // Calculate costs for a specific storage amount
  calculateStorageCost: (sizeGB: number) => {
    creditsUsed: number;
    ratePerGB: number;
  };
}

// Storage strategy implementation
export class StorageStrategy extends IngestionStrategy<StorageStrategyContext, StorageClient> {
  // Rate in credits per GB
  private creditsPerGB: number;
  
  constructor(options: { creditsPerGB?: number } = {}) {
    super();
    // Default to 3 credits per GB, but allow customization
    this.creditsPerGB = options.creditsPerGB ?? 3;
  }

  override client(
    customer: IngestionStrategyCustomer | IngestionStrategyExternalCustomer
  ): StorageClient {
    const executionHandler = this.createExecutionHandler();

    return {
      // Record storage usage for a customer
      recordStorageUsage: async ({ 
        storageSizeGB, 
        storageType = "default",
        storageLocation = "default",
        metadata = {}
      }) => {
        // Create the storage usage context
        const usageContext: StorageStrategyContext = {
          storageSizeGB,
          storageType,
          storageLocation,
          ...metadata
        };
        
        // Send the usage data to Polar
        await executionHandler(usageContext, customer);
      },
      
      // Calculate the cost for a specific storage amount
      calculateStorageCost: (sizeGB: number) => {
        const creditsUsed = sizeGB * this.creditsPerGB;
        return {
          creditsUsed,
          ratePerGB: this.creditsPerGB
        };
      }
    };
  }
}