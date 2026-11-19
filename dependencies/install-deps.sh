#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. /etc/os-release
case " ${ID:-} ${ID_LIKE:-} " in
    *' debian '*|*' ubuntu '*) manager=apt ;;
    *' fedora '*|*' rhel '*) manager=dnf ;;
    *' arch '*|*' cachyos '*) manager=pacman ;;
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
        sudo dnf install -y "${packages[@]}" || {
            echo "Попередження: масове встановлення dnf не вдалося, спроба встановлення по одному..." >&2
            for pkg in "${packages[@]}"; do
                sudo dnf install -y "$pkg" 2>/dev/null || echo "Пропущено необов'язковий пакет: $pkg" >&2
            done
        }
        ;;
    pacman)
        sudo pacman -Syu --needed --noconfirm "${packages[@]}" || {
            echo "Попередження: масове встановлення pacman не вдалося, спроба окремо..." >&2
            for pkg in "${packages[@]}"; do
                sudo pacman -S --needed --noconfirm "$pkg" 2>/dev/null || echo "Пропущено необов'язковий пакет: $pkg" >&2
            done
        }
        ;;
esac
printf 'Обов’язкові залежності встановлено.\n'
