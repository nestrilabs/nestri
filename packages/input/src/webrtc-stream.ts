import {
  MessageBase,
  MessageICE,
  MessageJoin,
  MessageSDP,
  MessageAnswer,
  JoinerType,
  AnswerType,
} from "./messages";

//FIXME: Sometimes the room will wait to say offline, then appear to be online after retrying :D
// This works for me, with my trashy internet, does it work for you as well?

export class WebRTCStream {
  private _ws: WebSocket | undefined = undefined;
  private _pc: RTCPeerConnection | undefined = undefined;
  private _audioTrack: MediaStreamTrack | undefined = undefined;
  private _videoTrack: MediaStreamTrack | undefined = undefined;
  private _dataChannel: RTCDataChannel | undefined = undefined;
  private _onConnected: ((stream: MediaStream | null) => void) | undefined = undefined;
  private _connectionTimer: NodeJS.Timeout | NodeJS.Timer | undefined = undefined;
  private _serverURL: string | undefined = undefined;
  private _roomName: string | undefined = undefined;
  private _isConnected: boolean = false; // Add flag to track connection state
  currentFrameRate: number = 60;

  constructor(serverURL: string, roomName: string, connectedCallback: (stream: MediaStream | null) => void) {
    if (roomName.length <= 0) {
      console.error("Room name not provided");
      return;
    }

    this._onConnected = connectedCallback;
    this._serverURL = serverURL;
    this._roomName = roomName;
    this._setup(serverURL, roomName);
  }

  private _setup(serverURL: string, roomName: string) {
    // Don't setup new connection if already connected
    if (this._isConnected) {
      console.log("Already connected, skipping setup");
      return;
    }

    console.log("Setting up WebSocket");
    const wsURL = serverURL.replace(/^http/, "ws");
    this._ws = new WebSocket(`${wsURL}/api/ws/${roomName}`);
    this._ws.onopen = async () => {
      console.log("WebSocket opened");
      // Send join message
      const joinMessage: MessageJoin = {
        payload_type: "join",
        joiner_type: JoinerType.JoinerClient
      };
      this._ws!.send(JSON.stringify(joinMessage));
    }

    let iceHolder: RTCIceCandidateInit[] = [];

    this._ws.onmessage = async (e) => {
      // allow only JSON
      if (typeof e.data === "object") return;
      if (!e.data) return;
      const message = JSON.parse(e.data) as MessageBase;
      switch (message.payload_type) {
        case "sdp":
          if (!this._pc) {
            // Setup peer connection now
            this._setupPeerConnection();
          }
          console.log("Received SDP: ", (message as MessageSDP).sdp);
          await this._pc!.setRemoteDescription((message as MessageSDP).sdp);
          // Create our answer
          const answer = await this._pc!.createAnswer();
          // Force stereo in Chromium browsers
          answer.sdp = this.forceOpusStereo(answer.sdp!);
          await this._pc!.setLocalDescription(answer);
          this._ws!.send(JSON.stringify({
            payload_type: "sdp",
            sdp: answer
          }));
          break;
        case "ice":
          if (!this._pc) break;
          if (this._pc.remoteDescription) {
            try {
              await this._pc.addIceCandidate((message as MessageICE).candidate);
              // Add held ICE candidates
              for (const ice of iceHolder) {
                try {
                  await this._pc.addIceCandidate(ice);
                } catch (e) {
                  console.error("Error adding held ICE candidate: ", e);
                }
              }
              iceHolder = [];
            } catch (e) {
              console.error("Error adding ICE candidate: ", e);
            }
          } else {
            iceHolder.push((message as MessageICE).candidate);
          }
          break;
        case "answer":
          switch ((message as MessageAnswer).answer_type) {
            case AnswerType.AnswerOffline:
              console.log("Room is offline");
              // Call callback with null stream
              if (this._onConnected)
                this._onConnected(null);

              break;
            case AnswerType.AnswerInUse:
              console.warn("Room is in use, we shouldn't even be getting this message");
              break;
            case AnswerType.AnswerOK:
              console.log("Joining Room was successful");
              break;
          }
          break;
        default:
          console.error("Unknown message type: ", message);
      }
    }

    this._ws.onclose = () => {
      console.log("WebSocket closed, reconnecting in 3 seconds");
      if (this._onConnected)
        this._onConnected(null);

      // Clear PeerConnection
      this._cleanupPeerConnection()

      this._handleConnectionFailure()
      // setTimeout(() => {
      //   this._setup(serverURL, roomName);
      // }, this._connectionTimeout);
    }

    this._ws.onerror = (e) => {
      console.error("WebSocket error: ", e);
    }
  }

  // Forces opus to stereo in Chromium browsers, because of course
  private forceOpusStereo(SDP: string): string {
    // Look for "minptime=10;useinbandfec=1" and replace with "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;"
    return SDP.replace(/(minptime=10;useinbandfec=1)/, "$1;stereo=1;sprop-stereo=1;");
  }

  private _setupPeerConnection() {
    if (this._pc) {
      this._cleanupPeerConnection();
    }

    console.log("Setting up PeerConnection");
    this._pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302"
        }
      ],
    });

    this._pc.ontrack = (e) => {
      console.log("Track received: ", e.track);
      if (e.track.kind === "audio")
        this._audioTrack = e.track;
      else if (e.track.kind === "video")
        this._videoTrack = e.track;

      this._checkConnectionState();
    };

    this._pc.onconnectionstatechange = () => {
      console.log("Connection state changed to: ", this._pc!.connectionState);
      this._checkConnectionState();
    };

    this._pc.oniceconnectionstatechange = () => {
      console.log("ICE connection state changed to: ", this._pc!.iceConnectionState);
      this._checkConnectionState();
    };

    this._pc.onicegatheringstatechange = () => {
      console.log("ICE gathering state changed to: ", this._pc!.iceGatheringState);
      this._checkConnectionState();
    };

    this._pc.onicecandidate = (e) => {
      if (e.candidate) {
        const message: MessageICE = {
          payload_type: "ice",
          candidate: e.candidate
        };
        this._ws!.send(JSON.stringify(message));
      }
    };

    this._pc.ondatachannel = (e) => {
      this._dataChannel = e.channel;
      this._setupDataChannelEvents();
    };
  }

  private _checkConnectionState() {
    if (!this._pc) return;

    console.log("Checking connection state:", {
      connectionState: this._pc.connectionState,
      iceConnectionState: this._pc.iceConnectionState,
      hasAudioTrack: !!this._audioTrack,
      hasVideoTrack: !!this._videoTrack,
      isConnected: this._isConnected
    });

    if (this._pc.connectionState === "connected" && this._audioTrack !== undefined && this._videoTrack !== undefined) {
      this._clearConnectionTimer();
      if (!this._isConnected) {
        // Only trigger callback if not already connected
        this._isConnected = true;
        if (this._onConnected !== undefined) {
          this._onConnected(new MediaStream([this._audioTrack, this._videoTrack]));

          // Continuously set low-latency target
          this._pc.getReceivers().forEach((receiver: RTCRtpReceiver) => {
            let intervalLoop = setInterval(async () => {
              if (receiver.track.readyState !== "live" || (receiver.transport && receiver.transport.state !== "connected")) {
                clearInterval(intervalLoop);
                return;
              } else {
                // @ts-ignore
                receiver.jitterBufferTarget = receiver.jitterBufferDelayHint = receiver.playoutDelayHint = 0;
              }
            }, 15);
          });
        }
      }

      this._gatherFrameRate();
    } else if (this._pc.connectionState === "failed" ||
      this._pc.connectionState === "closed" ||
      this._pc.iceConnectionState === "failed") {
      console.log("Connection failed or closed, attempting reconnect");
      this._isConnected = false; // Reset connected state
      this._handleConnectionFailure();
    }
  }

  private _handleConnectionFailure() {
    this._clearConnectionTimer();
    if (this._isConnected) { // Only notify if previously connected
      this._isConnected = false;
      if (this._onConnected) {
        this._onConnected(null);
      }
    }
    this._cleanupPeerConnection();

    // Attempt to reconnect only if not already connected
    if (!this._isConnected && this._serverURL && this._roomName) {
      this._setup(this._serverURL, this._roomName);
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
        if (this._audioTrack)
          this._audioTrack.stop();
        if (this._videoTrack)
          this._videoTrack.stop();
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
    }
    this._isConnected = false; // Reset connected state during cleanup
  }

  private _clearConnectionTimer() {
    if (this._connectionTimer) {
      clearTimeout(this._connectionTimer as any);
      this._connectionTimer = undefined;
    }
  }

  private _setupDataChannelEvents() {
    if (!this._dataChannel) return;

    this._dataChannel.onclose = () => console.log('sendChannel has closed')
    this._dataChannel.onopen = () => console.log('sendChannel has opened')
    this._dataChannel.onmessage = e => console.log(`Message from DataChannel '${this._dataChannel?.label}' payload '${e.data}'`)
  }

  private _gatherFrameRate() {
    if (this._pc === undefined || this._videoTrack === undefined)
      return;

    const videoInfoPromise = new Promise<{ fps: number}>((resolve) => {
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
      this.currentFrameRate = value.fps
    }) 
  }

  // Send binary message through the data channel
  public sendBinary(data: Uint8Array) {
    if (this._dataChannel && this._dataChannel.readyState === "open")
      this._dataChannel.send(data);
    else
      console.log("Data channel not open or not established.");
  }

  public disconnect() {
    this._clearConnectionTimer();
    this._cleanupPeerConnection();
    if (this._ws) {
      this._ws.close();
      this._ws = undefined;
    }
    this._isConnected = false;
  }
}