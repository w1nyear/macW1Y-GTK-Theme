#!/bin/bash
set -e

# ==============================================================================
# Apple Boot Splash (Plymouth) & Kernel Initramfs Setup for macOS Theme
# ==============================================================================

if [ "$(id -u)" -ne 0 ]; then
    echo "❌ Для встановлення потрібні права суперкористувача (root)."
    echo "Запустіть скрипт через sudo:"
    echo "   sudo bash $0"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THEME_NAME="apple-mac"
THEME_SRC="$SCRIPT_DIR/plymouth/apple-mac"
THEME_DST="/usr/share/plymouth/themes/$THEME_NAME"

echo "=================================================="
echo " 🍎 Активація завантажувача Apple macOS Plymouth   "
echo "=================================================="

# 1. Копіювання файлів теми
echo "📁 Копіювання файлів теми у $THEME_DST..."
mkdir -p "$THEME_DST"
cp -r "$THEME_SRC/"* "$THEME_DST/"
chmod 644 "$THEME_DST"/*
chmod 755 "$THEME_DST"

# 2. Реєстрація теми у Plymouth Alternatives та вибір за замовчуванням
echo "⚙️ Налаштування default.plymouth в update-alternatives..."
update-alternatives --install /usr/share/plymouth/themes/default.plymouth default.plymouth "$THEME_DST/$THEME_NAME.plymouth" 200
update-alternatives --set default.plymouth "$THEME_DST/$THEME_NAME.plymouth"

# 3. Налаштування конфігурації демона /etc/plymouth/plymouthd.conf
echo "📝 Запис конфігурації у /etc/plymouth/plymouthd.conf..."
mkdir -p /etc/plymouth
cat << 'EOF' > /etc/plymouth/plymouthd.conf
[Daemon]
Theme=apple-mac
ShowDelay=0
DeviceTimeout=8
EOF

# 4. Налаштування параметрів ядра GRUB (вимкнення логотипу вендора BGRT)
GRUB_DEFAULT="/etc/default/grub"
if [ -f "$GRUB_DEFAULT" ]; then
    echo "🔧 Перевірка параметрів ядра у $GRUB_DEFAULT..."
    if ! grep -q "bgrt.disable=1" "$GRUB_DEFAULT"; then
        sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT="\([^"]*\)"/GRUB_CMDLINE_LINUX_DEFAULT="\1 bgrt.disable=1 vt.global_cursor_default=0"/' "$GRUB_DEFAULT"
        sed -i 's/  */ /g' "$GRUB_DEFAULT"
    fi
    echo "🔄 Оновлення конфігурації GRUB (update-grub)..."
    update-grub
fi

# 5. Встановлення правил sudoers для mac-налаштувань
if [ -d "$SCRIPT_DIR/etc/sudoers.d" ]; then
    echo "🔐 Оновлення правил безпеки у /etc/sudoers.d/..."
    for sf in "$SCRIPT_DIR/etc/sudoers.d/"*; do
        if [ -f "$sf" ]; then
            sbase="$(basename "$sf")"
            cp "$sf" "/etc/sudoers.d/$sbase"
            chmod 440 "/etc/sudoers.d/$sbase"
        fi
    done
fi

# 6. Оновлення образу ядра initramfs (щоб завантажувач увімкнувся з перших мілісекунд)
echo "📦 Оновлення образу завантаження initramfs (це займе 15-25 секунд)..."
update-initramfs -u -k all

echo "=================================================="
echo "✅ Тема Apple Plymouth успішно активована!"
echo "   - Біле яблуко по центру на чисто чорному фоні"
echo "   - Фірмовий плавний індикатор прогресу при завантаженні (boot)"
echo "   - Індикатор прогресу при вимкненні та перезавантаженні (shutdown/reboot)"
echo "   - Старий візуал Ubuntu (bgrt/spinner) повністю замінено"
echo "=================================================="
