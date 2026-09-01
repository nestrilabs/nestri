SHELL := /bin/bash
.PHONY: build build-debug image image-debug clean help

CONTAINER_RT := $(shell command -v docker 2>/dev/null || command -v podman 2>/dev/null)
ifeq ($(CONTAINER_RT),)
$(error "Neither docker nor podman found in PATH")
endif

# The Dockerfile COPYs from apps/ and crates/, so the build context is the
# repo root, not this directory — same reason borealis's build/ *is* its own
# context: here the guest source lives one level up instead of inside build/.
CONTEXT      := ..
# `ghcr.io/nestrilabs/nestri/base` (a package name with a `/` in it, matching
# how every other image this org has published is named) is a deliberate
# name, not just a tag: this is the image other builds start FROM —
# nesbox's jailer image extracts Mesa/virgl from it to keep the guest and
# host sides of the virtio-gpu native-context protocol on the same patched
# Mesa, and closed downstream builds layer Proton/Steam on top of it
# elsewhere. `runtime_prod`/`runtime_debug` already are exactly that: distro
# packages plus our own Mesa/nestri artifacts overlaid on top, nothing
# stripped that a downstream COPY --from= would miss — no separate
# unstripped tag is needed for this.
#
# The registry host is part of the name on purpose, including for local
# builds: a bare `nestrilabs/nestri` has no host, so anyone who pulls
# instead of building locally resolves it against Docker Hub by default,
# where it does not exist. One name, always pullable, beats a local-only
# short name and a different published one.
IMAGE_NAME   := ghcr.io/nestrilabs/nestri/base
OUTPUT_DIR   := output
ROOTFS_SIZE  ?= 5G
FORCE_REBUILD ?=

build:
	DOCKER_BUILDKIT=1 $(CONTAINER_RT) build $(if $(FORCE_REBUILD),--no-cache,) \
		-f Dockerfile -t $(IMAGE_NAME):latest --target runtime_prod $(CONTEXT)

build-debug:
	DOCKER_BUILDKIT=1 $(CONTAINER_RT) build $(if $(FORCE_REBUILD),--no-cache,) \
		-f Dockerfile -t $(IMAGE_NAME):debug --target runtime_debug $(CONTEXT)

# Not `sudo make image`/sudo'd in here: mkimage.sh runs as you and escalates
# only the specific commands that need root. Under rootless Podman, `make
# build` stores the image in *your* storage — sudo-ing the whole script would
# have root's podman look for that tag in its own, separate storage and fail
# to find it.
image: build
	@mkdir -p $(OUTPUT_DIR)
	bash scripts/mkimage.sh $(IMAGE_NAME):latest $(OUTPUT_DIR)/rootfs.ext4 $(ROOTFS_SIZE)

image-debug: build-debug
	@mkdir -p $(OUTPUT_DIR)
	bash scripts/mkimage.sh $(IMAGE_NAME):debug $(OUTPUT_DIR)/rootfs-debug.ext4 $(ROOTFS_SIZE)

clean:
	rm -rf $(OUTPUT_DIR)

help:
	@echo "Usage:"
	@echo "  make build              Build the runtime_prod container image"
	@echo "  make build-debug        Build the runtime_debug container image"
	@echo "  make image              Build + pack runtime_prod into output/rootfs.ext4"
	@echo "  make image-debug        Build + pack runtime_debug into output/rootfs-debug.ext4"
	@echo "  make clean               Remove output/"
	@echo "  make FORCE_REBUILD=1 ...  Rebuild from scratch, no layer cache"
	@echo "  make ROOTFS_SIZE=8G image  Override the packed image size (default 5G)"
