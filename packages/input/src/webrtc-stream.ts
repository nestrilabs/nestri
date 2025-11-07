import { webSockets } from "@libp2p/websockets";
import { webTransport } from "@libp2p/webtransport";
import { createLibp2p, Libp2p } from "libp2p";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { identify } from "@libp2p/identify";
import { multiaddr } from "@multiformats/multiaddr";
import { Connection } from "@libp2p/interface";
import { ping } from "@libp2p/ping";
import { createMessage } from "./utils";
import { create } from "@bufbuild/protobuf";
import {
  ProtoClientRequestRoomStream,
  ProtoClientRequestRoomStreamSchema,
  ProtoICE,
  ProtoICESchema, ProtoRaw,
  ProtoSDP,
  ProtoSDPSchema
} from "./proto/types_pb";
import { P2PMessageStream } from "./streamwrapper";

const NESTRI_PROTOCOL_STREAM_REQUEST = "/nestri-relay/stream-request/1.0.0";

export class WebRTCStream {
  private _sessionId: string | null = null;
  private _p2p: Libp2p | undefined = undefined;
  private _p2pConn: Connection | undefined = undefined;
  private _msgStream: P2PMessageStream | undefined = undefined;
  private _pc: RTCPeerConnection | undefined = undefined;
  private _audioTrack: MediaStreamTrack | undefined = undefined;
  private _videoTrack: MediaStreamTrack | undefined = undefined;
  private _dataChannel: RTCDataChannel | undefined = undefined;
  private _onConnected: ((stream: MediaStream | null) => void) | undefined =
    undefined;
  private _connectionTimer: NodeJS.Timeout | NodeJS.Timer | undefined =
    undefined;
  private _serverURL: string | undefined = undefined;
  private _roomName: string | undefined = undefined;
  private _isConnected: boolean = false;
  private _dataChannelCallbacks: Array<(data: any) => void> = [];
  currentFrameRate: number = 100;

  constructor(
    serverURL: string,
    roomName: string,
    connectedCallback: (stream: MediaStream | null) => void,
  ) {
    if (roomName.length <= 0) {
      console.error("Room name not provided");
      return;
    }

    this._onConnected = connectedCallback;
    this._serverURL = serverURL;
    this._roomName = roomName;
    this._setup(serverURL, roomName).catch(console.error);
  }

  private async _setup(serverURL: string, roomName: string) {
    // Don't setup new connection if already connected
    if (this._isConnected) {
      console.log("Already connected, skipping setup");
      return;
    }

    console.log("Setting up libp2p");

    this._p2p = await createLibp2p({
      transports: [webSockets(), webTransport()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      connectionGater: {
        denyDialMultiaddr: () => {
          return false;
        },
      },
      services: {
        identify: identify(),
        ping: ping(),
      },
    });

    this._p2p.addEventListener("peer:connect", async (e) => {
      console.debug("Peer connected:", e.detail);
    });
    this._p2p.addEventListener("peer:disconnect", (e) => {
      console.debug("Peer disconnected:", e.detail);
    });

    const ma = multiaddr(serverURL);
    console.debug("Dialing peer at:", ma.toString());
    this._p2pConn = await this._p2p.dial(ma);

    if (this._p2pConn) {
      console.log("Stream is being established");
      let stream = await this._p2pConn
        .newStream(NESTRI_PROTOCOL_STREAM_REQUEST)
        .catch(console.error);
      if (stream) {
        this._msgStream = new P2PMessageStream(stream);
        console.log("Stream opened with peer");

        let iceHolder: RTCIceCandidateInit[] = [];
        this._msgStream.on("ice-candidate", (data: ProtoICE) => {
          const cand: RTCIceCandidateInit = {
            candidate: data.candidate.candidate,
            sdpMLineIndex: data.candidate.sdpMLineIndex,
            sdpMid: data.candidate.sdpMid,
            usernameFragment: data.candidate.usernameFragment,
          };
          if (this._pc) {
            if (this._pc.remoteDescription) {
              this._pc.addIceCandidate(cand).catch((err) => {
                console.error("Error adding ICE candidate:", err);
              });
              // Add held candidates
              iceHolder.forEach((candidate) => {
                this._pc!.addIceCandidate(candidate).catch((err) => {
                  console.error("Error adding held ICE candidate:", err);
                });
              });
              iceHolder = [];
            } else {
              iceHolder.push(cand);
            }
          }
        });

        this._msgStream.on("session-assigned", (data: ProtoClientRequestRoomStream) => {
          this._sessionId = data.sessionId;
          localStorage.setItem("nestri-session-id", this._sessionId);
          console.log("Session ID assigned:", this._sessionId, "for room:", data.roomName);
        });

        this._msgStream.on("offer", async (data: ProtoSDP) => {
          if (!this._pc) {
            // Setup peer connection now
            this._setupPeerConnection();
          }
          await this._pc!.setRemoteDescription({
            sdp: data.sdp.sdp,
            type: data.sdp.type as RTCSdpType,
          });
          // Add held candidates
          iceHolder.forEach((candidate) => {
            this._pc!.addIceCandidate(candidate).catch((err) => {
              console.error("Error adding held ICE candidate:", err);
            });
          });
          iceHolder = [];

          // Create our answer
          const answer = await this._pc!.createAnswer();
          // Force stereo in Chromium browsers
          answer.sdp = this.forceOpusStereo(answer.sdp!);
          await this._pc!.setLocalDescription(answer);
          // Send answer back
          const answerMsg = createMessage(
            create(ProtoSDPSchema, {
              sdp: answer,
            }),
            "answer",
          );
          await this._msgStream?.write(answerMsg);
        });

        this._msgStream.on("request-stream-offline", (msg: ProtoRaw) => {
          console.warn("Stream is offline for room:", msg.data);
          this._onConnected?.(null);
        });

        const clientId = this.getSessionID();
        if (clientId) {
          console.debug("Using existing session ID:", clientId);
        }

        // Send stream request
        const requestMsg = createMessage(
          create(ProtoClientRequestRoomStreamSchema, {
            roomName: roomName,
            sessionId: clientId ?? "",
          }),
          "request-stream-room",
        );
        await this._msgStream.write(requestMsg);
      }
    }
  }

  public getSessionID(): string | null {
    if (this._sessionId === null)
      this._sessionId = localStorage.getItem("nestri-session-id");
    return this._sessionId;
  }

  // Forces opus to stereo in Chromium browsers, because of course
  private forceOpusStereo(SDP: string): string {
    // Look for "minptime=10;useinbandfec=1" and replace with "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;"
    return SDP.replace(
      /(minptime=10;useinbandfec=1)/,
      "$1;stereo=1;sprop-stereo=1;",
    );
  }

  private _setupPeerConnection() {
    if (this._pc) {
      this._cleanupPeerConnection();
    }

    console.log("Setting up PeerConnection");
    this._pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302",
        },
      ],
    });

    this._pc.ontrack = (e) => {
      console.debug("Track received: ", e.track);
      if (e.track.kind === "audio") this._audioTrack = e.track;
      else if (e.track.kind === "video") this._videoTrack = e.track;

      this._checkConnectionState();
    };

    this._pc.onconnectionstatechange = () => {
      console.debug("Connection state changed to: ", this._pc!.connectionState);
      this._checkConnectionState();
    };

    this._pc.oniceconnectionstatechange = () => {
      console.debug(
        "ICE connection state changed to: ",
        this._pc!.iceConnectionState,
      );
      this._checkConnectionState();
    };

    this._pc.onicegatheringstatechange = () => {
      console.debug(
        "ICE gathering state changed to: ",
        this._pc!.iceGatheringState,
      );
      this._checkConnectionState();
    };

    this._pc.onicecandidate = (e) => {
      if (e.candidate) {
        const iceMsg = createMessage(
          create(ProtoICESchema, {
            candidate: e.candidate,
          }),
          "ice-candidate",
        );
        if (this._msgStream) {
          this._msgStream
            .write(iceMsg)
            .catch((err) => console.error("Error sending ICE candidate:", err));
        } else {
          console.warn("P2P stream not established, cannot send ICE candidate");
        }
      }
    };

    this._pc.ondatachannel = (e) => {
      this._dataChannel = e.channel;
      this._setupDataChannelEvents();
    };
  }

  private _checkConnectionState() {
    if (!this._pc || !this._p2p || !this._p2pConn) return;

    console.debug("Checking connection state:", {
      connectionState: this._pc.connectionState,
      iceConnectionState: this._pc.iceConnectionState,
      hasAudioTrack: !!this._audioTrack,
      hasVideoTrack: !!this._videoTrack,
      isConnected: this._isConnected,
    });

    if (
      this._pc.connectionState === "connected" &&
      this._audioTrack !== undefined &&
      this._videoTrack !== undefined
    ) {
      this._clearConnectionTimer();
      if (!this._isConnected) {
        // Only trigger callback if not already connected
        this._isConnected = true;
        if (this._onConnected !== undefined) {
          this._onConnected(
            new MediaStream([this._audioTrack, this._videoTrack]),
          );

          // Continuously set low-latency target
          this._pc.getReceivers().forEach((receiver: RTCRtpReceiver) => {
            let intervalLoop = setInterval(async () => {
              if (
                receiver.track.readyState !== "live" ||
                (receiver.transport && receiver.transport.state !== "connected")
              ) {
                clearInterval(intervalLoop);
                return;
              } else {
                // @ts-ignore
                receiver.jitterBufferTarget = receiver.jitterBufferDelayHint = receiver.playoutDelayHint = 0;
              }
            }, 50);
          });
        }
      }

      this._gatherFrameRate();
    } else if (
      this._pc.connectionState === "failed" ||
      this._pc.connectionState === "closed" ||
      this._pc.iceConnectionState === "failed"
    ) {
      console.log("PeerConnection failed or closed");
      //this._isConnected = false; // Reset connected state
      //this._handleConnectionFailure();
    }
  }

  private _handleConnectionFailure() {
    this._clearConnectionTimer();
    if (this._isConnected) {
      // Only notify if previously connected
      this._isConnected = false;
      if (this._onConnected) {
        this._onConnected(null);
      }
    }
    this._cleanupPeerConnection();

    // Attempt to reconnect only if not already connected
    if (!this._isConnected && this._serverURL && this._roomName) {
      this._setup(this._serverURL, this._roomName).catch((err) =>
        console.error("Reconnection failed:", err),
      );
    }
  }

  private _cleanupPeerConnection() {
    if (this._pc) {
      try {
        this._pc.close();
      } catch (err) {
        console.error("Error closing peer connection:", err);
      }
      this._pc = undefined;
    }

    if (this._audioTrack || this._videoTrack) {
      try {
        if (this._audioTrack) this._audioTrack.stop();
        if (this._videoTrack) this._videoTrack.stop();
      } catch (err) {
        console.error("Error stopping media tracks:", err);
      }
      this._audioTrack = undefined;
      this._videoTrack = undefined;
    }

    if (this._dataChannel) {
      try {
        this._dataChannel.close();
      } catch (err) {
        console.error("Error closing data channel:", err);
      }
      this._dataChannel = undefined;
      this._dataChannelCallbacks = [];
    }
    this._isConnected = false; // Reset connected state during cleanup
  }

  private _clearConnectionTimer() {
    if (this._connectionTimer) {
      clearTimeout(this._connectionTimer as any);
      this._connectionTimer = undefined;
    }
  }

  public addDataChannelCallback(callback: (data: any) => void) {
    this._dataChannelCallbacks.push(callback);
  }

  public removeDataChannelCallback(callback: (data: any) => void) {
    this._dataChannelCallbacks = this._dataChannelCallbacks.filter(
      (cb) => cb !== callback,
    );
  }

  private _setupDataChannelEvents() {
    if (!this._dataChannel) return;

    this._dataChannel.onclose = () => console.log("sendChannel has closed");
    this._dataChannel.onopen = () => console.log("sendChannel has opened");
    this._dataChannel.onmessage = (event) => {
      // Parse as ProtoBuf message
      const data = event.data;
      // Call registered callback if exists
      this._dataChannelCallbacks.forEach((callback) => {
        try {
          callback(data);
        } catch (err) {
          console.error("Error in data channel callback:", err);
        }
      });
    };
  }

  private _gatherFrameRate() {
    if (this._pc === undefined || this._videoTrack === undefined) return;

    const videoInfoPromise = new Promise<{ fps: number }>((resolve) => {
      // Keep trying to get fps until it's found
      const interval = setInterval(async () => {
        if (this._pc === undefined) {
          clearInterval(interval);
          return;
        }

        const stats = await this._pc!.getStats(this._videoTrack);
        stats.forEach((report) => {
          if (report.type === "inbound-rtp") {
            clearInterval(interval);

            resolve({ fps: report.framesPerSecond });
          }
        });
      }, 250);
    });

    videoInfoPromise.then((value) => {
      this.currentFrameRate = value.fps;
    });
  }

  // Send binary message through the data channel
  public sendBinary(data: Uint8Array) {
    if (this._dataChannel && this._dataChannel.readyState === "open")
      this._dataChannel.send(data);
    else console.log("Data channel not open or not established.");
  }

  public disconnect() {
    this._clearConnectionTimer();
    this._cleanupPeerConnection();
    if (this._p2pConn) {
      this._p2pConn
        .close()
        .catch((err) => console.error("Error closing P2P connection:", err));
      this._p2pConn = undefined;
    }
    this._isConnected = false;
  }
}
