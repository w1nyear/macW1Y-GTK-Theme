#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. /etc/os-release
case " ${ID:-} ${ID_LIKE:-} " in
    *' debian '*|*' ubuntu '*|*' linuxmint '*|*' mint '*) manager=apt ;;
    *' fedora '*|*' rhel '*) manager=dnf ;;
    *' arch '*|*' cachyos '*|*' manjaro '*|*' endeavouros '*) manager=pacman ;;
    *) echo "Непідтримуваний дистрибутив: ${ID:-невідомий}" >&2; exit 1 ;;
esac
list=$manager
[ "$manager" != apt ] || list=apt
mapfile -t packages < <(sed -e 's/#.*//' -e '/^[[:space:]]*$/d' "$script_dir/$list-packages.txt")
[ ${#packages[@]} -gt 0 ] || exit 1
case "$manager" in
    apt)
        sudo apt-get update
        sudo apt-get install -y "${packages[@]}"
        for opt in ptyxis fastfetch; do
            if apt-cache show "$opt" >/dev/null 2>&1; then
                sudo apt-get install -y "$opt" 2>/dev/null || true
            fi
        done
        ;;
    dnf)
        missing=()
        for pkg in "${packages[@]}"; do
            rpm -q "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
        done
        if [ ${#missing[@]} -gt 0 ]; then
            sudo dnf install -y --setopt=install_weak_deps=False "${missing[@]}"
        fi
        for opt in ptyxis fastfetch; do
            rpm -q "$opt" >/dev/null 2>&1 || sudo dnf install -y --setopt=install_weak_deps=False "$opt" 2>/dev/null || true
        done
        ;;
    pacman)
        sudo pacman -Syu --needed --noconfirm "${packages[@]}"
        for opt in ptyxis fastfetch; do
            sudo pacman -S --needed --noconfirm "$opt" 2>/dev/null || true
        done
        ;;
esac
printf 'Обов’язкові залежності встановлено.\n'
