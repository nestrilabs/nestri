import { pbStream, type ProtobufStream } from "@libp2p/utils";
import type { Stream } from "@libp2p/interface";
import { bufbuildAdapter } from "./utils";
import {
  ProtoMessage,
  ProtoMessageSchema,
  ProtoMessageBase,
} from "./proto/messages_pb";

type MessageHandler = (
  data: any,
  base: ProtoMessageBase,
) => void | Promise<void>;

export class P2PMessageStream {
  private pb: ProtobufStream;
  private handlers = new Map<string, MessageHandler[]>();
  private closed = false;
  private readLoopRunning = false;

  constructor(stream: Stream) {
    this.pb = pbStream(stream);
  }

  public on(payloadType: string, handler: MessageHandler): void {
    if (!this.handlers.has(payloadType)) {
      this.handlers.set(payloadType, []);
    }
    this.handlers.get(payloadType)!.push(handler);

    if (!this.readLoopRunning) this.startReading().catch(console.error);
  }

  private async startReading(): Promise<void> {
    if (this.readLoopRunning || this.closed) return;
    this.readLoopRunning = true;

    while (!this.closed) {
      try {
        const msg: ProtoMessage = await this.pb.read(
          bufbuildAdapter(ProtoMessageSchema),
        );

        const payloadType = msg.messageBase?.payloadType;
        if (payloadType && this.handlers.has(payloadType)) {
          const handlers = this.handlers.get(payloadType)!;
          if (msg.payload.value) {
            for (const handler of handlers) {
              try {
                await handler(msg.payload.value, msg.messageBase);
              } catch (err) {
                console.error(`Error in handler for ${payloadType}:`, err);
              }
            }
          }
        }
      } catch (err) {
        if (this.closed) break;
        console.error("Stream read error:", err);
        this.close();
      }
    }

    this.readLoopRunning = false;
  }

  public async write(
    message: ProtoMessage,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    if (this.closed)
      throw new Error("Cannot write to closed stream");

    await this.pb.write(message, bufbuildAdapter(ProtoMessageSchema), options);
  }

  public close(): void {
    this.closed = true;
    this.handlers.clear();
  }
}
