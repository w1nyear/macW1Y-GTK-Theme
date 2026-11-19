#!/usr/bin/env bash
# Виконувати всередині тестової ОС після встановлення залежностей.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
output=${1:?Вкажіть каталог звіту поза репозиторієм}
mkdir -p "$output"
cp /etc/os-release "$output/os-release"
uname -m > "$output/architecture.txt"
pkg-config --modversion gtk4 libadwaita-1 glib-2.0 libnautilus-extension-4 > "$output/library-versions.txt"
bash "$root/dependencies/build-native.sh" "$output/lib" > "$output/build.log" 2>&1
for lib in "$output/lib/"*.so; do
    ldd -r "$lib" > "$output/$(basename "$lib").linkage.txt" 2>&1
    if grep -Eq 'undefined symbol:|not found' "$output/$(basename "$lib").linkage.txt"; then
        cat "$output/$(basename "$lib").linkage.txt" >&2
        exit 1
    fi
done
printf 'PASS: збірка та символи семи бібліотек\n'
