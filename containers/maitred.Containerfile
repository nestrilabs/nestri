FROM docker.io/golang:1.24-bookworm AS go-build
WORKDIR /builder
COPY packages/maitred/ /builder/
RUN go build

FROM docker.io/golang:1.24-bookworm
COPY --from=go-build /builder/maitred /maitred/maitred
WORKDIR /maitred

RUN apt update && apt install -y --no-install-recommends pciutils

ENTRYPOINT ["/maitred/maitred"]