import {
  MessageBase,
  MessageICE,
  MessageJoin,
  MessageSDP,
  MessageAnswer,
  JoinerType,
  AnswerType,
  decodeMessage,
  encodeMessage
} from "./messages";

export class WebRTCStream {
  private _ws: WebSocket | undefined = undefined;
  private _pc: RTCPeerConnection | undefined = undefined;
  private _mediaStream: MediaStream | undefined = undefined;
  private _dataChannel: RTCDataChannel | undefined = undefined;
  private _onConnected: ((stream: MediaStream | null) => void) | undefined = undefined;

  constructor(serverURL: string, roomName: string, connectedCallback: (stream: MediaStream | null) => void) {
    // If roomName is not provided, return
    if (roomName.length <= 0) {
      console.error("Room name not provided");
      return;
    }

    this._onConnected = connectedCallback;
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
      this._ws!.send(encodeMessage(joinMessage));
    }

    let iceHolder: RTCIceCandidateInit[] = [];

    this._ws.onmessage = async (e) => {
      // allow only binary
      if (typeof e.data !== "object") return;
      if (!e.data) return;
      const message = await decodeMessage<MessageBase>(e.data);
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
          this._ws!.send(encodeMessage({
            payload_type: "sdp",
            sdp: answer
          }));
          break;
        case "ice":
          if (!this._pc) break;
          // If remote description is not set yet, hold the ICE candidates
          if (this._pc.remoteDescription) {
            await this._pc.addIceCandidate((message as MessageICE).candidate);
            // Add held ICE candidates
            for (const ice of iceHolder) {
              await this._pc.addIceCandidate(ice);
            }
            iceHolder = [];
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
      if (this._pc) {
        this._pc.close();
        this._pc = undefined;
      }

      setTimeout(() => {
        this._setup(serverURL, roomName);
      }, 3000);
    }

    this._ws.onerror = (e) => {
      console.error("WebSocket error: ", e);
    }
  }

  private _setupPeerConnection() {
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
      this._mediaStream = e.streams[e.streams.length - 1];
    };

    this._pc.onconnectionstatechange = () => {
      console.log("Connection state: ", this._pc!.connectionState);
      if (this._pc!.connectionState === "connected") {
        if (this._onConnected && this._mediaStream)
          this._onConnected(this._mediaStream);
      }
    };

    this._pc.onicecandidate = (e) => {
      if (e.candidate) {
        const message: MessageICE = {
          payload_type: "ice",
          candidate: e.candidate
        };
        this._ws!.send(encodeMessage(message));
      }
    }

    this._pc.ondatachannel = (e) => {
      this._dataChannel = e.channel;
      this._setupDataChannelEvents();
    }
  }

  // Forces opus to stereo in Chromium browsers, because of course
  private forceOpusStereo(SDP: string): string {
    // Look for "minptime=10;useinbandfec=1" and replace with "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;"
    return SDP.replace(/(minptime=10;useinbandfec=1)/, "$1;stereo=1;sprop-stereo=1;");
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
