#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
destination=${1:?Вкажіть каталог результатів}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
build() {
    local name=$1 source=$2 packages=$3
    local flags
    flags=$(pkg-config --cflags --libs $packages)
    # pkg-config повертає окремі аргументи компілятора.
    gcc -shared -fPIC -O2 -o "$work/$name.so" "$root/$source" $flags -ldl -lm
}
build libmacpopover src/mac_popover.c 'gtk4 glib-2.0 gobject-2.0'
build libmac_terminal src/mac_terminal.c 'gtk4 libadwaita-1'
build libmac_memtrim src/mac_memtrim.c 'glib-2.0'
build libmac_nautilus src/mac_nautilus.c 'gtk4 libadwaita-1 gio-2.0'
build libmac_nautilus_menu src/mac_nautilus_menu.c 'gtk4 libnautilus-extension-4 gio-2.0'
build libmac_settings gnome-control-center-overlay/libmac_settings.c 'glib-2.0 gio-2.0 json-glib-1.0 gtk4 libadwaita-1'
build libmac_extension_manager extension-manager/libmac_extension_manager.c 'glib-2.0 gio-2.0'
mkdir -p "$destination"
cp "$work/"*.so "$destination/"
