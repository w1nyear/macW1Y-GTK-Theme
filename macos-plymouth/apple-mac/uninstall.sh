#!/bin/bash
set -e

# ==============================================================================
# Apple macOS Boot Theme Uninstaller / Restore Ubuntu Default
# ==============================================================================

if [ "$(id -u)" -ne 0 ]; then
    echo "❌ Цей скрипт потребує прав суперкористувача (root)."
    echo "Будь ласка, запустіть його через sudo:"
    echo "   sudo bash $0"
    exit 1
fi

THEME_NAME="apple-mac"
THEME_DIR="/usr/share/plymouth/themes/${THEME_NAME}"
GRUB_CONFIG="/etc/default/grub"

echo "=================================================="
echo " 🔄 Відновлення стандартного завантажувача Ubuntu "
echo "=================================================="

# 1. Повернення стандартної теми bgrt
if [ -f "/usr/share/plymouth/themes/bgrt/bgrt.plymouth" ]; then
    echo "⚙️ Встановлення стандартної теми BGRT..."
    update-alternatives --set default.plymouth /usr/share/plymouth/themes/bgrt/bgrt.plymouth
elif [ -f "/usr/share/plymouth/themes/spinner/spinner.plymouth" ]; then
    echo "⚙️ Встановлення теми Spinner..."
    update-alternatives --set default.plymouth /usr/share/plymouth/themes/spinner/spinner.plymouth
fi

# Видалення теми зі списку альтернатив
update-alternatives --remove default.plymouth "${THEME_DIR}/${THEME_NAME}.plymouth" 2>/dev/null || true

# 2. Відновлення GRUB
if [ -f "${GRUB_CONFIG}.bak_mactheme" ]; then
    echo "🔧 Відновлення резервної копії /etc/default/grub..."
    cp "${GRUB_CONFIG}.bak_mactheme" "${GRUB_CONFIG}"
    update-grub
else
    # Видаляємо додані параметри
    sed -i 's/ bgrt.disable=1//g' "${GRUB_CONFIG}"
    sed -i 's/ vt.global_cursor_default=0//g' "${GRUB_CONFIG}"
    update-grub
fi

# 3. Оновлення initramfs
echo "📦 Оновлення initramfs..."
update-initramfs -u

echo "=================================================="
echo "✅ Стандартний вигляд завантаження Ubuntu відновлено."
echo "=================================================="
