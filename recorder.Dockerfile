# This builds and updates the screen recorder we use on Netris
# From https://git.dec05eba.com/gpu-screen-recorder
FROM ubuntu:23.10

ENV DEBIAN_FRONTEND=noninteractive

USER root

#Build and install gpu-screen-recorder
#TODO: Install ffmpeg
RUN apt-get update -y \
    && apt-get install -y \
    curl \
    unzip \
    git \
    build-essential \
    ninja-build \
    gcc \
    meson \
    cmake \
    ccache \
    bison \
    equivs \
    ca-certificates\
    libcap2-bin \
    libllvm15 \
    libavcodec-dev \
    libavformat-dev \
    libavutil-dev \
    libx11-dev \
    libxcomposite-dev \
    libxrandr-dev \
    libxfixes-dev \
    libpulse-dev \
    libswresample-dev \
    libavfilter-dev \
    libva-dev \
    libcap-dev \
    libdrm-dev \
    libgl-dev \
    libegl-dev \
    libwayland-dev \
    libwayland-egl-backend-dev \
    wayland-protocols \
    && rm -rf /var/lib/apt/lists/* \
    #Install Cuda
    && cd /tmp && curl -fsSL -o nvidia_cuda_nvrtc_linux_x86_64.whl "https://developer.download.nvidia.com/compute/redist/nvidia-cuda-nvrtc/nvidia_cuda_nvrtc-11.0.221-cp36-cp36m-linux_x86_64.whl" \
    && unzip -joq -d ./nvrtc nvidia_cuda_nvrtc_linux_x86_64.whl && cd nvrtc && chmod 755 libnvrtc* \
    && find . -maxdepth 1 -type f -name "*libnvrtc.so.*" -exec sh -c 'ln -snf $(basename {}) libnvrtc.so' \; \
    && mkdir -p /usr/local/nvidia/lib && mv -f libnvrtc* /usr/local/nvidia/lib \
    && echo "/usr/local/nvidia/lib" >> /etc/ld.so.conf.d/nvidia.conf && echo "/usr/local/nvidia/lib64" >> /etc/ld.so.conf.d/nvidia.conf \
    && git clone https://repo.dec05eba.com/gpu-screen-recorder && cd gpu-screen-recorder \
    && chmod +x ./build.sh ./install.sh \
    && ./install.sh \
    #Test
    && ls -la /usr/bin/gpu-screen-recorder && ls -la /usr/bin/gsr-kms-server \
    && /usr/bin/gpu-screen-recorder --help