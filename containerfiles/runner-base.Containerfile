# Container build arguments #
ARG BASE_IMAGE=docker.io/cachyos/cachyos:latest

#****************************************#
# Base Stage - Installs build essentials #
#****************************************#
FROM ${BASE_IMAGE} AS bases

# Environment setup for Rust and Cargo
ENV CARGO_HOME=/usr/local/cargo \
    PATH="${CARGO_HOME}/bin:${PATH}"

# Install build essentials and caching tools
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -Sy --noconfirm rustup git base-devel

# Install latest Rust using rustup
RUN rustup default stable

# Install cargo-chef with proper caching
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    cargo install -j $(nproc) cargo-chef cargo-c --locked
