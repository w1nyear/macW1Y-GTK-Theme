#!/bin/bash
set -e
echo "==> Встановлення залежностей для macOS Modpack..."
sudo apt-get update
sudo apt-get install -y \
    gcc make pkg-config \
    libglib2.0-dev libjson-glib-dev libjson-glib-1.0-0 \
    libinput-tools evemu-tools gamemode \
    plymouth plymouth-themes \
    grub2-common os-prober \
    dconf-cli gnome-tweaks gnome-shell-extension-manager \
    mesa-utils nvidia-prime
echo "==> Залежності успішно встановлено!"
