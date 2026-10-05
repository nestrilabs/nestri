SHELL := /bin/bash
.PHONY: build build-debug image image-debug kernel kernel-clean kernel-objclean proton-image proton-push clean help

CONTAINER_RT := $(shell command -v podman 2>/dev/null || command -v docker 2>/dev/null)
ifeq ($(CONTAINER_RT),)
$(error "Neither docker nor podman found in PATH")
endif

# The Containerfile COPYs from apps/ and crates/, so the build context is the
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

# Proton is the one artifact worth publishing on its own: it takes hours to
# build and changes only when its tag moves. It is not part of the guest
# rootfs; it is a separate payload that reaches a box at run time, so this
# is built and published on its own cadence.
#
# `PROTON_TAG` is the single place to change it. The published version is
# derived from the tag rather than written twice, because the two are the same
# number in two spellings and an image whose name does not say which Proton is
# inside it is worse than no image at all. Changing the tag by hand and
# forgetting the version is exactly the mistake this removes.
PROTON_TAG     ?= cachyos-11.0-20261005-native
PROTON_VERSION := $(PROTON_TAG:cachyos-%-native=%)
PROTON_IMAGE   ?= ghcr.io/nestrilabs/proton-cachyos-native-wow64
PROTON_REF     := $(PROTON_IMAGE):$(PROTON_VERSION)
OUTPUT_DIR   := output
ROOTFS_SIZE  ?= 2G
FORCE_REBUILD ?=

# The guest kernel: CachyOS's fork, for its scheduler patches, with our own
# minimal config on top (kernel/nestri.fragment). The tree is a clone rather
# than vendored, and lives under output/, which git ignores and the guest
# build never sees.
# KERNEL_SRC may point at an existing tree elsewhere.
KERNEL_GIT    ?= https://github.com/CachyOS/linux.git
KERNEL_REF    ?= cachyos-7.2.6-1
# The target hardware is at least AVX2-capable. Never `native`: the build host
# is not the target. Empty leaves the tree's own generic choice alone.
KERNEL_MARCH  ?= x86-64-v3

# Experimental: KERNEL_INFINITY=1 applies the Infinity scheduler series (fair,
# rt and DRM scheduler rework) on top. It builds in its own tree and installs
# under its own name, so the stock kernel is never patched and switching the
# flag back and forth never needs a revert.
#
# The series is published per CachyOS release, so its directory is derived
# from KERNEL_REF rather than written twice: bumping the kernel to a release
# the series does not cover fails at the patch step, not in a booted box.
KERNEL_INFINITY ?=
INFINITY_GIT    ?= https://github.com/galpt/infinity-sched-new.git
INFINITY_REV    ?= e6c85d841f25e21393a7ea47fdef286318915d8c
INFINITY_SERIES := patches/cachyos/tuned-eevdf/$(KERNEL_REF:cachyos-%=%)
INFINITY_WORK   := $(OUTPUT_DIR)/infinity-sched

# Experimental: KERNEL_SCX=1 adds what a sched_ext scheduler needs
# (kernel/scx.fragment), so a guest can load one. Its own tree and its own
# name for the same reason as above, and it does not combine with
# KERNEL_INFINITY: they are two answers to the same question.
KERNEL_SCX ?=

# The guest half of NVIDIA forwarding: the driver, built into the kernel, and
# its Vulkan layer, built into the rootfs. A branch, so each build takes them
# as they are now; set NVGPU_REF to a tag or commit to pin it. The commit built
# is recorded as $(KERNEL_OUTPUT).nvgpu-rev and, in the image, as
# /usr/share/nestri/virtio-nvgpu.rev. Build both from the same ref.
NVGPU_GIT  ?= https://github.com/nestrilabs/virtio-nvgpu.git
NVGPU_REF  ?= dev
NVGPU_WORK := $(OUTPUT_DIR)/virtio-nvgpu

ifneq ($(and $(KERNEL_INFINITY),$(KERNEL_SCX)),)
$(error KERNEL_INFINITY and KERNEL_SCX are alternatives; set one)
endif
ifneq ($(KERNEL_INFINITY),)
KERNEL_SRC    ?= $(OUTPUT_DIR)/kernel-infinity
KERNEL_OUTPUT := $(OUTPUT_DIR)/vmlinux-infinity
else ifneq ($(KERNEL_SCX),)
KERNEL_SRC    ?= $(OUTPUT_DIR)/kernel-scx
KERNEL_OUTPUT := $(OUTPUT_DIR)/vmlinux-scx
else
KERNEL_SRC    ?= $(OUTPUT_DIR)/kernel
KERNEL_OUTPUT := $(OUTPUT_DIR)/vmlinux
endif

build:
	DOCKER_BUILDKIT=1 $(CONTAINER_RT) build $(if $(FORCE_REBUILD),--no-cache,) \
		--build-arg NVGPU_GIT=$(NVGPU_GIT) --build-arg NVGPU_REF=$(NVGPU_REF) \
		-f Containerfile -t $(IMAGE_NAME):latest --target runtime_prod $(CONTEXT)

build-debug:
	DOCKER_BUILDKIT=1 $(CONTAINER_RT) build $(if $(FORCE_REBUILD),--no-cache,) \
		--build-arg NVGPU_GIT=$(NVGPU_GIT) --build-arg NVGPU_REF=$(NVGPU_REF) \
		-f Containerfile -t $(IMAGE_NAME):debug --target runtime_debug $(CONTEXT)

# Hours, and only when PROTON_TAG moves. Its context is this directory rather
# than the repository root: the two scripts beside the Containerfile are the
# whole input, and the root would hand it everything else for nothing.
proton-image:
	DOCKER_BUILDKIT=1 $(CONTAINER_RT) build $(if $(FORCE_REBUILD),--no-cache,) \
		--build-arg PROTON_TAG=$(PROTON_TAG) \
		-f Containerfile.proton -t $(PROTON_REF) .
	@echo "Built $(PROTON_REF)"

# Publishing is what lets a box be given this Proton by name. Push before
# expecting anyone to use a new tag.
proton-push: proton-image
	$(CONTAINER_RT) push $(PROTON_REF)

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

# Not part of `build`: it changes far less often than the rootfs, and nothing
# in the image depends on it. A rerun rebuilds only what changed in the tree.
kernel:
	KERNEL_GIT=$(KERNEL_GIT) KERNEL_REF=$(KERNEL_REF) KERNEL_SRC=$(KERNEL_SRC) \
		KERNEL_MARCH=$(KERNEL_MARCH) KERNEL_OUTPUT=$(KERNEL_OUTPUT) \
		KERNEL_INFINITY=$(KERNEL_INFINITY) KERNEL_SCX=$(KERNEL_SCX) INFINITY_GIT=$(INFINITY_GIT) \
		INFINITY_REV=$(INFINITY_REV) INFINITY_SERIES=$(INFINITY_SERIES) \
		INFINITY_WORK=$(INFINITY_WORK) \
		NVGPU_GIT=$(NVGPU_GIT) NVGPU_REF=$(NVGPU_REF) NVGPU_WORK=$(NVGPU_WORK) \
		bash scripts/kernel-build.sh

# Leaves the kernel alone: it is a clone and a warm object tree, and a rootfs
# is neither. kernel-clean is the one that drops it.
clean:
	find $(OUTPUT_DIR) -mindepth 1 -maxdepth 1 ! -name 'kernel*' \
		! -name 'vmlinux*' ! -name infinity-sched ! -name virtio-nvgpu -exec rm -rf {} + 2>/dev/null || true

# Drops the objects and keeps the clone, the config and the driver checkout.
# For a tree whose compiler changed underneath it: kbuild's dependency files
# name the old compiler's headers by path, and once a compiler upgrade removes
# them make stops on "No rule to make target" for a file it cannot rebuild.
# Acts on the tree the same flags select for `kernel`, so
# `make KERNEL_SCX=1 kernel-objclean` cleans that one.
kernel-objclean:
	$(MAKE) -C $(KERNEL_SRC) LLVM=1 clean

kernel-clean:
	rm -rf $(OUTPUT_DIR)/kernel $(OUTPUT_DIR)/kernel-infinity $(OUTPUT_DIR)/kernel-scx $(INFINITY_WORK) $(NVGPU_WORK) \
		$(OUTPUT_DIR)/vmlinux $(OUTPUT_DIR)/vmlinux-infinity $(OUTPUT_DIR)/vmlinux-scx $(OUTPUT_DIR)/vmlinux*.nvgpu-rev

help:
	@echo "Usage:"
	@echo "  make build              Build the runtime_prod container image"
	@echo "  make build-debug        Build the runtime_debug container image"
	@echo "  make image              Build + pack runtime_prod into output/rootfs.ext4"
	@echo "  make image-debug        Build + pack runtime_debug into output/rootfs-debug.ext4"
	@echo "  make kernel              Build the guest kernel into output/vmlinux"
	@echo "  make KERNEL_INFINITY=1 kernel  Experimental Infinity scheduler build → output/vmlinux-infinity"
	@echo "  make KERNEL_SCX=1 kernel       Experimental build that can load a sched_ext scheduler → output/vmlinux-scx"
	@echo "  make kernel-objclean     Drop a kernel tree's objects, keep the clone and config (after a compiler upgrade)"
	@echo "  make kernel-clean        Remove every kernel tree and image"
	@echo "  make clean               Remove the rootfs images from output/"
	@echo "  make proton-image        Build Proton from source (hours)"
	@echo "  make proton-push         Build it and publish it"
	@echo "  make FORCE_REBUILD=1 ...  Rebuild from scratch, no layer cache"
	@echo "  make PROTON_TAG=... ...   Use a different proton-cachyos tag"
	@echo "  make ROOTFS_SIZE=8G image  Override the packed image size (default 5G)"
