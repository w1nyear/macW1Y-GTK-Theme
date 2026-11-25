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
        ;;
    dnf)
        missing=()
        for pkg in "${packages[@]}"; do
            rpm -q "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
        done
        if [ ${#missing[@]} -gt 0 ]; then
            sudo dnf install -y --setopt=install_weak_deps=False "${missing[@]}"
        fi
        ;;
    pacman) sudo pacman -Syu --needed --noconfirm "${packages[@]}" ;;
esac
printf 'Обов’язкові залежності встановлено.\n'
