FROM docker.io/golang:1.23-alpine AS go-build
WORKDIR /builder
COPY packages/relay/ /builder/
RUN go build

FROM docker.io/golang:1.23-alpine
COPY --from=go-build /builder/relay /relay/relay
WORKDIR /relay

# ENV flags
ENV VERBOSE=false
ENV ENDPOINT_PORT=8088
ENV WEBRTC_UDP_START=10000
ENV WEBRTC_UDP_END=20000
ENV STUN_SERVER="stun.l.google.com:19302"

EXPOSE $ENDPOINT_PORT
EXPOSE $WEBRTC_UDP_START-$WEBRTC_UDP_END/udp

ENTRYPOINT ["/relay/relay"]