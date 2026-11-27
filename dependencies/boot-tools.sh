#!/usr/bin/env bash
# Генератор обирається за конфігурацією встановленої системи.
macw1y_rebuild_initramfs() {
    local PATH="${PATH}:/usr/local/sbin:/usr/sbin:/sbin"
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

macw1y_has_grub() {
    local PATH="${PATH}:/usr/local/sbin:/usr/sbin:/sbin"
    if [ -d /run/initramfs/live ] || grep -q -E 'boot=live|liveimg|root=live:' /proc/cmdline 2>/dev/null; then
        return 1
    fi
    if command -v bootctl >/dev/null 2>&1 && bootctl is-installed >/dev/null 2>&1; then
        return 1
    fi
    command -v update-grub >/dev/null 2>&1 || command -v grub2-mkconfig >/dev/null 2>&1 || command -v grub-mkconfig >/dev/null 2>&1
}
