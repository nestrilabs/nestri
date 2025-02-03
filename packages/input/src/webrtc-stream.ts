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
  private _mediaStream: MediaStream | undefined = undefined;
  private _dataChannel: RTCDataChannel | undefined = undefined;
  private _onConnected: ((stream: MediaStream | null) => void) | undefined = undefined;
  // 5 second timeout, this looks like the sweet spot anything longer you wait too long... anything shorter it turns into a race condition from hell
  private _connectionTimeout: number =7000; 
  private _connectionTimer: NodeJS.Timeout | NodeJS.Timer | undefined = undefined;
  private _serverURL: string | undefined = undefined
  private _roomName: string | undefined = undefined

  constructor(serverURL: string, roomName: string, connectedCallback: (stream: MediaStream | null) => void) {
    // If roomName is not provided, return
    if (roomName.length <= 0) {
      console.error("Room name not provided");
      return;
    }

    this._onConnected = connectedCallback;
    this._serverURL = serverURL
    this._roomName = roomName
    this._setup(serverURL, roomName);
  }

  private _setup(serverURL: string, roomName: string) {
    console.log("Setting up WebSocket");
    // Replace http/https with ws/wss
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

    // Start connection timeout
    this._startConnectionTimer();

    this._pc.ontrack = (e) => {
      console.log("Track received: ", e.track);
      this._mediaStream = e.streams[e.streams.length - 1];
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
      hasMediaStream: !!this._mediaStream
    });

    if (this._pc.connectionState === "connected" && this._mediaStream) {
      this._clearConnectionTimer();
      if (this._onConnected) {
        this._onConnected(this._mediaStream);
      }
    } else if (this._pc.connectionState === "failed" ||
      this._pc.connectionState === "closed" ||
      this._pc.iceConnectionState === "failed") {
      console.log("Connection failed or closed, attempting reconnect");
      this._handleConnectionFailure();
    }
  }

  private _startConnectionTimer() {
    this._clearConnectionTimer();
    this._connectionTimer = setTimeout(() => {
      console.log("Connection timeout reached");
      this._handleConnectionFailure();
    }, this._connectionTimeout);
  }

  private _clearConnectionTimer() {
    if (this._connectionTimer) {
      clearTimeout(this._connectionTimer);
      this._connectionTimer = undefined;
    }
  }

  private _handleConnectionFailure() {
    this._clearConnectionTimer();
    if (this._onConnected) {
      this._onConnected(null);
    }
    this._cleanupPeerConnection();

    // Attempt to reconnect
    if (this._serverURL && this._roomName) {
      this._setup(this._serverURL,this._roomName);
    }
    // if (this._ws && this._ws.readyState === WebSocket.OPEN) {
    //   this._ws.close();
    // }
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

    if (this._mediaStream) {
      try {
        this._mediaStream.getTracks().forEach(track => track.stop());
      } catch (err) {
        console.error("Error stopping media tracks:", err);
      }
      this._mediaStream = undefined;
    }

    if (this._dataChannel) {
      try {
        this._dataChannel.close();
      } catch (err) {
        console.error("Error closing data channel:", err);
      }
      this._dataChannel = undefined;
    }
  }

  public disconnect() {
    this._clearConnectionTimer();
    this._cleanupPeerConnection();
    if (this._ws) {
      this._ws.close();
      this._ws = undefined;
    }
  }

  private _setupDataChannelEvents() {
    if (!this._dataChannel) return;

    this._dataChannel.onclose = () => console.log('sendChannel has closed')
    this._dataChannel.onopen = () => console.log('sendChannel has opened')
    this._dataChannel.onmessage = e => console.log(`Message from DataChannel '${this._dataChannel?.label}' payload '${e.data}'`)
  }

  // Send binary message through the data channel
  public sendBinary(data: Uint8Array) {
    if (this._dataChannel && this._dataChannel.readyState === "open")
      this._dataChannel.send(data);
    else
      console.log("Data channel not open or not established.");
  }
}
