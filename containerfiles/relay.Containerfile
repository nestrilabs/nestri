FROM docker.io/golang:1.25-alpine AS go-build
WORKDIR /builder
COPY packages/relay/ /builder/
RUN go build

FROM docker.io/alpine:3.23
COPY --from=go-build /builder/relay /relay/relay
WORKDIR /relay

# ENV flags
ENV REGEN_IDENTITY=false
ENV VERBOSE=false
ENV DEBUG=false
ENV ENDPOINT_PORT=8088
ENV WEBRTC_UDP_START=0
ENV WEBRTC_UDP_END=0
ENV STUN_SERVER="stun.l.google.com:19302"
ENV WEBRTC_UDP_MUX=8088
ENV WEBRTC_NAT_IPS=""
ENV AUTO_ADD_LOCAL_IP=true
ENV PERSIST_DIR="./persist-data"

ENTRYPOINT ["/relay/relay"]