import { LatencyTracker } from "./latency";
import { Uint8ArrayList } from "uint8arraylist";
import { allocUnsafe } from "uint8arrays/alloc";
import { pipe } from "it-pipe";
import { decode, encode } from "it-length-prefixed";
import { Stream } from "@libp2p/interface";

export interface MessageBase {
  payload_type: string;
  latency?: LatencyTracker;
}

export interface MessageRaw extends MessageBase {
  data: any;
}

export function NewMessageRaw(type: string, data: any): Uint8Array {
  const msg = {
    payload_type: type,
    data: data,
  };
  return new TextEncoder().encode(JSON.stringify(msg));
}

export interface MessageICE extends MessageBase {
  candidate: RTCIceCandidateInit;
}

export function NewMessageICE(
  type: string,
  candidate: RTCIceCandidateInit,
): Uint8Array {
  const msg = {
    payload_type: type,
    candidate: candidate,
  };
  return new TextEncoder().encode(JSON.stringify(msg));
}

export interface MessageSDP extends MessageBase {
  sdp: RTCSessionDescriptionInit;
}

export function NewMessageSDP(
  type: string,
  sdp: RTCSessionDescriptionInit,
): Uint8Array {
  const msg = {
    payload_type: type,
    sdp: sdp,
  };
  return new TextEncoder().encode(JSON.stringify(msg));
}

const MAX_SIZE = 1024 * 1024; // 1MB

// Custom 4-byte length encoder
export const length4ByteEncoder = (length: number) => {
  const buf = allocUnsafe(4);

  // Write the length as a 32-bit unsigned integer (4 bytes)
  buf[0] = length >>> 24;
  buf[1] = (length >>> 16) & 0xff;
  buf[2] = (length >>> 8) & 0xff;
  buf[3] = length & 0xff;

  // Set the bytes property to 4
  length4ByteEncoder.bytes = 4;

  return buf;
};
length4ByteEncoder.bytes = 4;

// Custom 4-byte length decoder
export const length4ByteDecoder = (data: Uint8ArrayList) => {
  if (data.byteLength < 4) {
    // Not enough bytes to read the length
    return -1;
  }

  // Read the length from the first 4 bytes
  let length = 0;
  length =
    (data.subarray(0, 1)[0] << 24) |
    (data.subarray(1, 2)[0] << 16) |
    (data.subarray(2, 3)[0] << 8) |
    data.subarray(3, 4)[0];

  // Set bytes read to 4
  length4ByteDecoder.bytes = 4;

  return length;
};
length4ByteDecoder.bytes = 4;

export class SafeStream {
  private stream: Stream;
  private callbacks: Map<string, ((data: any) => void)[]> = new Map();
  private isReading: boolean = false;
  private isWriting: boolean = false;
  private closed: boolean = false;
  private messageQueue: Uint8Array[] = [];
  private writeLock = false;

  constructor(stream: Stream) {
    this.stream = stream;
    this.startReading();
    this.startWriting();
  }

  private async startReading(): Promise<void> {
    if (this.isReading || this.closed) return;

    this.isReading = true;

    try {
      const source = this.stream.source;
      const decodedSource = decode(source, {
        maxDataLength: MAX_SIZE,
        lengthDecoder: length4ByteDecoder,
      });

      for await (const chunk of decodedSource) {
        if (this.closed) break;

        try {
          const data = chunk.slice();
          const message = JSON.parse(new TextDecoder().decode(data)) as MessageBase;
          const msgType = message.payload_type;

          if (this.callbacks.has(msgType)) {
            const handlers = this.callbacks.get(msgType)!;
            for (const handler of handlers) {
              try {
                handler(message);
              } catch (err) {
                console.error(`Error in message handler for ${msgType}:`, err);
              }
            }
          }
        } catch (err) {
          console.error("Error processing message:", err);
        }
      }
    } catch (err) {
      console.error("Stream reading error:", err);
    } finally {
      this.isReading = false;

      // If not closed, try to restart reading
      if (!this.closed) {
        setTimeout(() => this.startReading(), 100);
      }
    }
  }

  public registerCallback(msgType: string, callback: (data: any) => void): void {
    if (!this.callbacks.has(msgType)) {
      this.callbacks.set(msgType, []);
    }

    this.callbacks.get(msgType)!.push(callback);
  }

  public removeCallback(msgType: string, callback: (data: any) => void): void {
    if (this.callbacks.has(msgType)) {
      const callbacks = this.callbacks.get(msgType)!;
      const index = callbacks.indexOf(callback);

      if (index !== -1) {
        callbacks.splice(index, 1);
      }

      if (callbacks.length === 0) {
        this.callbacks.delete(msgType);
      }
    }
  }

  private async startWriting(): Promise<void> {
    if (this.isWriting || this.closed) return;

    this.isWriting = true;

    try {
      // Create a single async generator that never completes
      const continuousSource = (async function* () {
        while (true) {
          // Signal to keep connection alive even when no data
          yield new Uint8Array(0);
          // Wait a bit before next keep-alive
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      })();

      // Start the sink with our continuous source
      // This keeps it open indefinitely
      await pipe(
        continuousSource,
        async function* (source) {
          for await (const _ of source) {
            // Process any messages in the queue when they appear
            while (this.messageQueue.length > 0 && !this.closed) {
              this.writeLock = true;

              try {
                const message = this.messageQueue[0];

                // Wait for stream to be ready
                if (this.stream.writeStatus !== 'ready' && this.stream.writeStatus !== 'writing') {
                  await new Promise(resolve => setTimeout(resolve, 50));
                  continue;
                }

                // Encode the message
                const encoded = encode([message], {
                  maxDataLength: MAX_SIZE,
                  lengthEncoder: length4ByteEncoder,
                });

                for await (const chunk of encoded) {
                  yield chunk;
                }

                // Remove message after successful sending
                this.messageQueue.shift();
              } catch (err) {
                console.error("Error encoding or sending message:", err);
                await new Promise(resolve => setTimeout(resolve, 100));
              } finally {
                this.writeLock = false;
              }
            }

            // If we have no messages, yield the keep-alive signal
            if (!this.closed) {
              yield _;
            }
          }
        }.bind(this),
        this.stream.sink
      ).catch(err => {
        console.error("Sink error:", err);
        this.isWriting = false;

        // Try to restart if not closed
        if (!this.closed) {
          setTimeout(() => this.startWriting(), 1000);
        }
      });
    } catch (err) {
      console.error("Stream writing error:", err);
      this.isWriting = false;

      // Try to restart if not closed
      if (!this.closed) {
        setTimeout(() => this.startWriting(), 1000);
      }
    }
  }

  public async writeMessage(message: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new Error("Cannot write to closed stream");
    }

    // Add message to the queue, the writing loop will pick it up
    this.messageQueue.push(message);

    // Return a promise that resolves when message is likely processed
    // This is not a guarantee but provides some back-pressure
    return new Promise(resolve => {
      const checkProcessed = () => {
        if (!this.messageQueue.includes(message) || this.closed) {
          resolve();
        } else {
          setTimeout(checkProcessed, 10);
        }
      };
      setTimeout(checkProcessed, 10);
    });
  }

  public close(): void {
    this.closed = true;
    this.callbacks.clear();
    this.messageQueue = [];
  }
}