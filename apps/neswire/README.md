## neswire

A small custom PipeWire sink for cloud gaming audio capture.

Currently for debugging uses RTP to send Opus (with FEC enabled by default) over to target address.


### Testing

#### Mono/Stereo

Launch gstreamer pipeline to receive audio as so (will save incoming RTP audio into test.mkv):
```bash
gst-launch-1.0 udpsrc port=12345 caps="application/x-rtp,media=audio,encoding-name=OPUS,clock-rate=48000,payload=111" ! rtpopusdepay2 ! opusdec ! matroskamux ! filesink location=test.mkv sync=false
```

Then run neswire like so for example:
```bash
cargo run --release --bin neswire -- --rtp-addr 127.0.0.1:12345
```

#### Surround

Launch gstreamer pipeline to receive audio as so (will save incoming RTP audio into test_multi.mkv):
```bash
gst-launch-1.0 udpsrc port=12345 caps='application/x-rtp,media=audio,encoding-name=MULTIOPUS,clock-rate=48000,payload=111,encoding-params=(string)8,num_streams=(string)5,coupled_streams=(string)3,channel_mapping=(string)"0,6,1,2,3,4,5,7"' ! rtpopusdepay2 ! opusdec ! matroskamux ! filesink location=test.mkv sync=false
```

Then run neswire like so for example:
```bash
cargo run --release --bin neswire -- --rtp-addr 127.0.0.1:12345 --channels 8
```


For both afterwards, set the neswire sink as audio output source in your system (or specify it as output in some app/game),
 then play some audio, stop gst pipeline and sink, listen to results after.
