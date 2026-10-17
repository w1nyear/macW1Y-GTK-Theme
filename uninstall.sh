#!/usr/bin/env bash
# ==============================================================================
#   macOS Sequoia / Tahoe Transformation Modpack for Ubuntu 24.04 (GNOME 46)
#  Uninstaller Script - Master Version (macW1Y Release)
# ==============================================================================

set -e

# ANSI Color Codes
C_RESET="\033[0m"
C_BOLD="\033[1m"
C_CYAN="\033[1;36m"
C_BLUE="\033[1;34m"
C_GREEN="\033[1;32m"
C_YELLOW="\033[1;33m"
C_RED="\033[1;31m"
C_MAGENTA="\033[1;35m"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detect user context
if [ -n "$SUDO_USER" ]; then
    TARGET_USER="$SUDO_USER"
    TARGET_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
else
    TARGET_USER="$USER"
    TARGET_HOME="$HOME"
fi

TARGET_UID=$(id -u "$TARGET_USER")

print_banner() {
    clear 2>/dev/null || true
    echo -e "${C_RED}"
    echo "  ╔════════════════════════════════════════════════════════════════════════════╗"
    echo "  ║                                                                            ║"
    echo "  ║         m a c O S   M o d p a c k   U n i n s t a l l e r                 ║"
    echo "  ║            Відновлення стандартних налаштувань Ubuntu 24.04                ║"
    echo "  ║                         Release: macW1Y (v1.0)                             ║"
    echo "  ║                                                                            ║"
    echo "  ╚════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${C_RESET}"
}

log_info() {
    echo -e " ${C_CYAN}[i]${C_RESET} ${C_BOLD}$1${C_RESET}"
}

log_success() {
    echo -e " ${C_GREEN}[✔]${C_RESET} $1"
}

log_warning() {
    echo -e " ${C_YELLOW}[!]${C_RESET} $1"
}

log_error() {
    echo -e " ${C_RED}[✘]${C_RESET} $1"
}

log_step() {
    echo -e "\n${C_BLUE}═══════════════════════════════════════════════════════════════════════${C_RESET}"
    echo -e " ${C_BOLD}${C_MAGENTA}▶ $1${C_RESET}"
    echo -e "${C_BLUE}═══════════════════════════════════════════════════════════════════════${C_RESET}"
}

run_as_user() {
    if [ "$TARGET_USER" != "$USER" ]; then
        sudo -u "$TARGET_USER" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${TARGET_UID}/bus" "$@"
    else
        "$@"
    fi
}

require_root() {
    if [ "$EUID" -ne 0 ]; then
        log_info "Для видалення системних служб потрібні права адміністратора (sudo)."
        sudo -v || { log_error "Не вдалося отримати права sudo. Вихід."; exit 1; }
    fi
}

# ------------------------------------------------------------------------------
# 1. Відновлення інтерфейсу (Теми, Іконки, Шпалери)
# ------------------------------------------------------------------------------
restore_ui() {
    log_step "Відновлення тем, іконок та розширень Ubuntu Yaru..."
    
    run_as_user gsettings set org.gnome.desktop.interface gtk-theme 'Yaru'
    run_as_user gsettings set org.gnome.desktop.interface icon-theme 'Yaru'
    run_as_user gsettings set org.gnome.desktop.interface cursor-theme 'Yaru'
    run_as_user gsettings set org.gnome.desktop.wm.preferences theme 'Yaru'
    run_as_user dconf write /org/gnome/shell/extensions/user-theme/name "''" 2>/dev/null || true
    
    # Відновлення стандартних шпалер Ubuntu
    local DEFAULT_WP="/usr/share/backgrounds/warty-final-ubuntu.png"
    if [ -f "$DEFAULT_WP" ]; then
        run_as_user gsettings set org.gnome.desktop.background picture-uri "file://$DEFAULT_WP"
        run_as_user gsettings set org.gnome.desktop.background picture-uri-dark "file://$DEFAULT_WP"
    fi
    
    # Вимкнення кастомних розширень macOS
    log_info "Вимкнення кастомних розширень..."
    local CUSTOM_EXTS=(
        "blur-my-shell@aunetx"
        "compiz-alike-magic-lamp-effect@hermes83.github.com"
        "Rounded_Corners@lennart-k"
        "liquid-glass@thinkingcoding1231.gmail.com"
        "macos-touchpad-gestures@mactheme"
        "eval-helper@mactheme"
        "wack-lockscreen-clock@rinzler69-wastaken.github.com"
    )
    for ext_id in "${CUSTOM_EXTS[@]}"; do
        run_as_user gnome-extensions disable "$ext_id" 2>/dev/null || true
    done
    
    # Видалення оверлею Параметрів (gnome-control-center)
    log_info "Очищення оверлею gnome-control-center..."
    rm -rf "$TARGET_HOME/.local/share/gnome-control-center-overlay"
    rm -f "$TARGET_HOME/.local/bin/gnome-control-center"
    rm -f "$TARGET_HOME/.local/lib/libmac_settings.so"
    rm -f "$TARGET_HOME/.local/lib/libmac_extension_manager.so"
    rm -f "$TARGET_HOME/.local/bin/extension-manager"
    rm -f "$TARGET_HOME/.local/share/applications/mac-styling-settings.desktop"
    rm -f "$TARGET_HOME/.local/share/applications/org.gnome.Settings.desktop"
    rm -f "$TARGET_HOME/.local/share/applications/com.mattjakeman.ExtensionManager.desktop"
    rm -f "$TARGET_HOME/.local/share/dbus-1/services/org.gnome.Settings.service"
    run_as_user update-desktop-database "$TARGET_HOME/.local/share/applications" 2>/dev/null || true
    
    log_success "Користувацький інтерфейс повернено до стандарту Ubuntu Yaru!"
}

# ------------------------------------------------------------------------------
# 2. Видалення системних компонентів та служб
# ------------------------------------------------------------------------------
restore_system() {
    log_step "Вимкнення та видалення системних служб macOS..."
    require_root
    
    # Жести тачпада
    log_info "Зупинка демона тачпада..."
    sudo systemctl stop mac-touchpad-daemon.service 2>/dev/null || true
    sudo systemctl disable mac-touchpad-daemon.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/mac-touchpad-daemon.service
    sudo rm -f /usr/local/bin/mac-touchpad-daemon
    sudo rm -f /usr/local/lib/libmac_3fg_drag.so
    sudo rm -f /etc/mac-touchpad.conf
    sudo rm -f /etc/udev/rules.d/99-uinput.rules
    sudo udevadm control --reload-rules 2>/dev/null || true
    
    # Режим гри
    log_info "Вимкнення Game Mode..."
    sudo systemctl stop mac-gamemode.service 2>/dev/null || true
    sudo systemctl disable mac-gamemode.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/mac-gamemode.service
    sudo rm -f /usr/local/bin/mac-gamemode
    sudo rm -f /usr/local/bin/gamemoderun
    sudo rm -f /usr/local/bin/nvidia-game-run
    sudo rm -f /etc/mac-gamemode.state
    
    # GDM перехід
    log_info "Видалення кастомного layout.js..."
    sudo rm -f /etc/gnome-shell/ui/layout.js
    if [ -f /etc/environment ]; then
        sudo sed -i '/G_RESOURCE_OVERLAYS/d' /etc/environment
    fi
    
    # Plymouth
    log_info "Відновлення стандартного завантажувача Plymouth..."
    sudo systemctl stop plymouth-verbose-logger.service 2>/dev/null || true
    sudo systemctl disable plymouth-verbose-logger.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/plymouth-verbose-logger.service
    sudo rm -f /usr/local/bin/plymouth-verbose-logger
    sudo rm -rf /usr/share/plymouth/themes/apple-mac
    sudo rm -f /etc/systemd/system/plymouth-quit.service.d/override.conf
    if command -v plymouth-set-default-theme >/dev/null 2>&1; then
        sudo plymouth-set-default-theme -R bgrt 2>/dev/null || sudo plymouth-set-default-theme -R ubuntu-logo 2>/dev/null || true
    fi
    
    # GRUB
    log_info "Відновлення оригінальної конфігурації GRUB..."
    if [ -f /etc/default/grub.bak_mactheme ]; then
        sudo cp /etc/default/grub.bak_mactheme /etc/default/grub
    else
        sudo sed -i '/GRUB_THEME.*apple-mac/d' /etc/default/grub 2>/dev/null || true
    fi
    
    if [ -f /etc/grub.d/10_linux.bak_mactheme ]; then
        sudo cp /etc/grub.d/10_linux.bak_mactheme /etc/grub.d/10_linux
    fi
    sudo rm -rf /boot/grub/themes/apple-mac
    sudo update-grub
    
    sudo systemctl daemon-reload
    log_info "Оновлення initramfs..."
    sudo update-initramfs -u 2>/dev/null || true
    log_success "Системні служби, Plymouth та GRUB відновлено до стандарту Ubuntu!"
}

# ------------------------------------------------------------------------------
# Меню та Вибір дій
# ------------------------------------------------------------------------------
run_full_uninstall() {
    restore_ui
    restore_system
    echo -e "\n${C_GREEN}═══════════════════════════════════════════════════════════════════════${C_RESET}"
    echo -e " ${C_BOLD}${C_GREEN}✔ ДЕІНСТАЛЯЦІЮ УСПІШНО ЗАВЕРШЕНО!${C_RESET}"
    echo -e "${C_GREEN}═══════════════════════════════════════════════════════════════════════${C_RESET}"
    echo -e " Стандартні параметри Ubuntu відновлено. Рекомендується перезавантажити ПК.\n"
}

# CLI Flags
if [ "$1" = "--all" ] || [ "$1" = "-y" ] || [ "$1" = "--yes" ]; then
    print_banner
    run_full_uninstall
    exit 0
elif [ "$1" = "--ui" ]; then
    print_banner
    restore_ui
    exit 0
elif [ "$1" = "--system" ]; then
    print_banner
    restore_system
    exit 0
elif [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Використання: ./uninstall.sh [ОПЦІЇ]"
    echo "  --all, -y     Повне видалення та відновлення стандартного стану Ubuntu"
    echo "  --ui          Відновлення лише теми та іконок інтерфейсу (Yaru)"
    echo "  --system      Відновлення системних компонентів (GRUB, Plymouth, Services)"
    echo "  --help, -h    Показати цю довідку"
    exit 0
fi

# Interactive Menu
print_banner
echo -e " ${C_BOLD}Оберіть дію для деінсталяції:${C_RESET}\n"
echo -e "  ${C_RED}[1]${C_RESET} ${C_BOLD}Повне видалення${C_RESET} (Відновити тему Yaru, повернути GRUB, вимкнути служби)"
echo -e "  ${C_YELLOW}[2]${C_RESET} Відновити лише тему інтерфейсу Yaru (залишити служби жестів і GRUB)"
echo -e "  ${C_CYAN}[3]${C_RESET} Вимкнути та видалити лише системні служби (Touchpad daemon, GRUB, Plymouth)"
echo -e "  ${C_GREEN}[0]${C_RESET} Скасувати / Вийти\n"
read -r -p " Введіть номер варіанту [0]: " CHOICE

case "$CHOICE" in
    1)
        run_full_uninstall
        ;;
    2)
        restore_ui
        ;;
    3)
        restore_system
        ;;
    *)
        echo -e "\nДеінсталяцію скасовано."
        exit 0
        ;;
esac
