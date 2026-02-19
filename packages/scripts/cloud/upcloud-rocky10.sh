#!/bin/bash

# Setup package repos #
dnf install epel-release -y
dnf config-manager --enable crb

# Install dev packages #
dnf groupinstall "Development Tools" -y
dnf install kernel-devel-matched kernel-headers -y

# NVIDIA repo and driver install #
dnf config-manager --add-repo http://developer.download.nvidia.com/compute/cuda/repos/rhel10/$(uname -m)/cuda-rhel10.repo
dnf clean expire-cache
dnf install nvidia-open -y

# Update to be safe #
dnf update -y

# Install NVIDIA container toolkit and podman + SELinux helper #
dnf install nvidia-container-toolkit podman container-selinux -y

# Setup required boot flags #
grubby --args="nouveau.modeset=0 rd.driver.blacklist=nouveau nvidia-drm.modeset=1" --update-kernel=ALL

# ENSURE we have required packages, had a weird case where it didn't have kernel and caused modeset to fail??? #
dnf update -y

# Reboot! #
reboot now

# Make sure modeset is available #
nvidia-modprobe -c 0 -u -m

# And make sure CDI devices are listed #
systemctl restart nvidia-cdi-refresh.service
