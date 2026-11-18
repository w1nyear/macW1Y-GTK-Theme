#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Detecting package manager and installing dependencies for macW1Y Modpack..."

if command -v apt-get >/dev/null 2>&1; then
    echo "==> Detected APT package manager (Debian/Ubuntu family)"
    sudo dpkg --add-architecture i386 2>/dev/null || true
    sudo apt-get update -qq
    if [ -f "$SCRIPT_DIR/apt-packages.txt" ]; then
        RAW_PKGS=$(grep -v "^#" "$SCRIPT_DIR/apt-packages.txt" | tr "\n" " ")
        VALID_PKGS=()
        for p in $RAW_PKGS; do
            if apt-cache show "$p" >/dev/null 2>&1; then
                VALID_PKGS+=("$p")
            fi
        done
        sudo apt-get install -y "${VALID_PKGS[@]}"
    fi
elif command -v dnf >/dev/null 2>&1; then
    echo "==> Detected DNF package manager (Fedora family)"
    if [ -f "$SCRIPT_DIR/dnf-packages.txt" ]; then
        RAW_PKGS=$(grep -v "^#" "$SCRIPT_DIR/dnf-packages.txt" | tr "\n" " ")
        VALID_PKGS=()
        for p in $RAW_PKGS; do
            if dnf list "$p" >/dev/null 2>&1; then
                VALID_PKGS+=("$p")
            fi
        done
        sudo dnf install -y "${VALID_PKGS[@]}"
    fi
elif command -v pacman >/dev/null 2>&1; then
    echo "==> Detected Pacman package manager (Arch/CachyOS family)"
    sudo pacman -Sy --needed --noconfirm
    if [ -f "$SCRIPT_DIR/pacman-packages.txt" ]; then
        RAW_PKGS=$(grep -v "^#" "$SCRIPT_DIR/pacman-packages.txt" | tr "\n" " ")
        VALID_PKGS=()
        for p in $RAW_PKGS; do
            if pacman -Si "$p" >/dev/null 2>&1; then
                VALID_PKGS+=("$p")
            fi
        done
        sudo pacman -S --needed --noconfirm "${VALID_PKGS[@]}"
    fi
else
    echo "==> Warning: Unsupported package manager. Please install dependencies manually."
fi

echo "==> Dependencies installation process completed!"
