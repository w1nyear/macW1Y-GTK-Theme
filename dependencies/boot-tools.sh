#!/usr/bin/env bash
# Генератор обирається за конфігурацією встановленої системи.
macw1y_rebuild_initramfs() {
    if command -v update-initramfs >/dev/null 2>&1 && [ -d /etc/initramfs-tools ]; then
        sudo update-initramfs -u
    elif command -v mkinitcpio >/dev/null 2>&1 && compgen -G '/etc/mkinitcpio.d/*.preset' >/dev/null; then
        sudo mkinitcpio -P
    elif command -v dracut >/dev/null 2>&1; then
        sudo dracut --regenerate-all --force
    else
        printf '%s\n' 'Не визначено налаштований генератор initramfs; автоматичну перебудову зупинено.' >&2
        return 1
    fi
}
