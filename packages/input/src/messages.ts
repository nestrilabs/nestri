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
const MAX_QUEUE_SIZE = 1000; // Maximum number of messages in the queue

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
    (data.subarray(0, 1)[0] >>> 0) * 0x1000000 +
    (data.subarray(1, 2)[0] >>> 0) * 0x10000 +
    (data.subarray(2, 3)[0] >>> 0) * 0x100 +
    (data.subarray(3, 4)[0] >>> 0);

  // Set bytes read to 4
  length4ByteDecoder.bytes = 4;

  return length;
};
length4ByteDecoder.bytes = 4;

interface PromiseMessage {
  data: Uint8Array;
  resolve: () => void;
  reject: (error: Error) => void;
}

export class SafeStream {
  private stream: Stream;
  private callbacks: Map<string, ((data: any) => void)[]> = new Map();
  private isReading: boolean = false;
  private isWriting: boolean = false;
  private closed: boolean = false;
  private messageQueue: PromiseMessage[] = [];
  private writeLock = false;
  private readRetries = 0;
  private writeRetries = 0;
  private readonly MAX_RETRIES = 5;

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

        this.readRetries = 0;

        try {
          const data = chunk.slice();
          const message = JSON.parse(
            new TextDecoder().decode(data),
          ) as MessageBase;
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
      this.readRetries++;

      // If not closed, try to restart reading
      if (!this.closed && this.readRetries < this.MAX_RETRIES)
        setTimeout(() => this.startReading(), 100);
      else if (this.readRetries >= this.MAX_RETRIES)
        console.error(
          "Max retries reached for reading stream, stopping attempts",
        );
    }
  }

  public registerCallback(
    msgType: string,
    callback: (data: any) => void,
  ): void {
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
      // Create an async generator for real-time message processing
      const messageSource = async function* (this: SafeStream) {
        while (!this.closed) {
          // Check if we have messages to send
          if (this.messageQueue.length > 0) {
            this.writeLock = true;

            try {
              const message = this.messageQueue[0];

              // Encode the message
              const encoded = encode([message.data], {
                maxDataLength: MAX_SIZE,
                lengthEncoder: length4ByteEncoder,
              });

              for await (const chunk of encoded) {
                yield chunk;
              }

              // Remove message after successful sending
              this.writeRetries = 0;
              const sentMessage = this.messageQueue.shift();
              if (sentMessage)
                sentMessage.resolve();
            } catch (err) {
              console.error("Error encoding or sending message:", err);
              const failedMessage = this.messageQueue.shift();
              if (failedMessage)
                failedMessage.reject(new Error(`Failed to send message: ${err}`));
            } finally {
              this.writeLock = false;
            }
          } else {
            // No messages to send, wait for a short period
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
      }.bind(this);

      await pipe(messageSource(), this.stream.sink).catch((err) => {
        console.error("Sink error:", err);
        this.isWriting = false;
        this.writeRetries++;

        // Try to restart if not closed
        if (!this.closed && this.writeRetries < this.MAX_RETRIES) {
          setTimeout(() => this.startWriting(), 1000);
        } else if (this.writeRetries >= this.MAX_RETRIES) {
          console.error("Max retries reached for writing to stream sink, stopping attempts");
        }
      });
    } catch (err) {
      console.error("Stream writing error:", err);
      this.isWriting = false;
      this.writeRetries++;

      // Try to restart if not closed
      if (!this.closed && this.writeRetries < this.MAX_RETRIES) {
        setTimeout(() => this.startWriting(), 1000);
      } else if (this.writeRetries >= this.MAX_RETRIES) {
        console.error("Max retries reached for writing stream, stopping attempts");
      }
    }
  }

  public async writeMessage(message: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new Error("Cannot write to closed stream");
    }

    // Validate message size before queuing
    if (message.length > MAX_SIZE) {
      throw new Error("Message size exceeds maximum size limit");
    }

    // Check if the message queue is too large
    if (this.messageQueue.length >= MAX_QUEUE_SIZE) {
      throw new Error("Message queue is full, cannot write message");
    }

    // Create a promise to resolve when the message is sent
    return new Promise((resolve, reject) => {
      this.messageQueue.push({ data: message, resolve, reject } as PromiseMessage);
    });
  }

  public close(): void {
    this.closed = true;
    this.callbacks.clear();
    // Reject pending messages
    for (const msg of this.messageQueue)
      msg.reject(new Error("Stream closed"));

    this.messageQueue = [];
    this.readRetries = 0;
    this.writeRetries = 0;
  }
}
