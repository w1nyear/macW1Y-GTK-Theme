#!/bin/bash
set -e

# ==============================================================================
# Apple macOS Boot Theme Installer for Ubuntu 24.04
# Deep Customization (Root/Kernel Boot Splash)
# ==============================================================================

if [ "$(id -u)" -ne 0 ]; then
    echo "❌ Цей скрипт потребує прав суперкористувача (root)."
    echo "Будь ласка, запустіть його через sudo:"
    echo "   sudo bash $0"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THEME_NAME="apple-mac"
THEME_DIR="/usr/share/plymouth/themes/${THEME_NAME}"

echo "=================================================="
echo " 🍎 Встановлення macOS Boot Splash (Apple Logo) "
echo "=================================================="

# 1. Створення каталогу теми
echo "📁 Копіювання файлів теми у ${THEME_DIR}..."
mkdir -p "${THEME_DIR}"
cp -r "${SCRIPT_DIR}/"* "${THEME_DIR}/"
chmod 644 "${THEME_DIR}"/*
chmod 755 "${THEME_DIR}"

# 2. Реєстрація теми у Plymouth Alternatives
echo "⚙️ Реєстрація теми у системі Plymouth..."
update-alternatives --install /usr/share/plymouth/themes/default.plymouth default.plymouth "${THEME_DIR}/${THEME_NAME}.plymouth" 200
update-alternatives --set default.plymouth "${THEME_DIR}/${THEME_NAME}.plymouth"

# 3. Налаштування GRUB для відключення логотипу материнської плати (BGRT)
GRUB_CONFIG="/etc/default/grub"
if [ -f "${GRUB_CONFIG}" ]; then
    echo "🔧 Налаштування параметрів ядра у GRUB (приховування логотипу ноутбука/материнки)..."
    
    # Резервна копія
    if [ ! -f "${GRUB_CONFIG}.bak_mactheme" ]; then
        cp "${GRUB_CONFIG}" "${GRUB_CONFIG}.bak_mactheme"
        echo "   Створено резервну копію GRUB: ${GRUB_CONFIG}.bak_mactheme"
    fi

    # Додаємо bgrt.disable=1 та vt.global_cursor_default=0 якщо їх немає
    if ! grep -q "bgrt.disable=1" "${GRUB_CONFIG}"; then
        sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT="\([^"]*\)"/GRUB_CMDLINE_LINUX_DEFAULT="\1 bgrt.disable=1 vt.global_cursor_default=0"/' "${GRUB_CONFIG}"
        # Очищуємо зайві подвійні пробіли
        sed -i 's/  */ /g' "${GRUB_CONFIG}"
        echo "   Додано параметри ядра: bgrt.disable=1 vt.global_cursor_default=0"
    else
        echo "   Параметри bgrt.disable вже присутні у GRUB."
    fi

    # Оновлення конфігурації GRUB
    echo "🔄 Оновлення GRUB (update-grub)..."
    update-grub
fi

# 4. Оновлення initramfs
echo "📦 Оновлення образу завантаження ядра (update-initramfs -u)..."
echo "   Це може зайняти 20-30 секунд..."
update-initramfs -u

echo "=================================================="
echo "✅ Тема завантаження macOS успішно встановлена!"
echo "   - Логотип Apple по центру на чисто чорному фоні"
echo "   - Фірмовий повзунок прогресу завантаження macOS"
echo "   - Логотип ноутбука/Acer та надпис Ubuntu повністю вимкнено"
echo "=================================================="
