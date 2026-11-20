#!/usr/bin/env bash
# ==============================================================================
#  macW1Y Transformation Modpack - Uninstaller & Restoration Script
#  Повне відновлення стандартного вигляду GNOME (Ubuntu, Fedora, Arch, Debian)
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
source "$SCRIPT_DIR/dependencies/boot-tools.sh"

# Detect user context
if [ -n "$SUDO_USER" ]; then
    TARGET_USER="$SUDO_USER"
    TARGET_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
else
    TARGET_USER="$USER"
    TARGET_HOME="$HOME"
fi

TARGET_UID=$(id -u "$TARGET_USER")

# Detect distribution
IS_UBUNTU=false
IS_FEDORA=false
IS_ARCH=false
IS_DEBIAN=false

if [ -f /etc/os-release ]; then
    . /etc/os-release
    case "${ID:-}:${ID_LIKE:-}" in
        *ubuntu*) IS_UBUNTU=true ;;
        *fedora*|*rhel*) IS_FEDORA=true ;;
        *arch*|*cachyos*|*endeavouros*|*manjaro*) IS_ARCH=true ;;
        *debian*) IS_DEBIAN=true ;;
    esac
fi

print_banner() {
    clear 2>/dev/null || true
    echo -e "${C_RED}"
    echo "  ╔════════════════════════════════════════════════════════════════════════════╗"
    echo "  ║                                                                            ║"
    echo "  ║         m a c W 1 Y   U n i n s t a l l e r                               ║"
    echo "  ║         Повне відновлення стандартного вигляду та налаштувань GNOME        ║"
    echo "  ║                         Release: macW1Y (v0.7)                             ║"
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
# 1. Відновлення стандартного вигляду GNOME (Теми, Іконки, Шрифти, Шпалери, Док)
# ------------------------------------------------------------------------------
restore_ui() {
    log_step "Повне відновлення інтерфейсу та параметрів GNOME..."

    # Список усіх 21 розширень macW1Y
    local ALL_MAC_EXTS=(
        "appmenu@ChathurangaBW.github.io"
        "blur-my-shell@aunetx"
        "compiz-alike-magic-lamp-effect@hermes83.github.com"
        "cupertino-dock-lite@rinzler69-wastaken.github.com"
        "custom-command-toggle@storageb.github.com"
        "dash-to-dock@micxgx.gmail.com"
        "dash2dock-motion@unmade.space"
        "desktop-widgets@r3nhick"
        "ding@rastersoft.com"
        "display-brightness-ddcutil@themightydeity.github.com"
        "eval-helper@mactheme"
        "kiwi@kemma"
        "liquid-glass@thinkingcoding1231.gmail.com"
        "macw1y-touchpad-gestures@mactheme"
        "macos-touchpad-gestures@mactheme"
        "quick-settings-scroll@diskmth.fr"
        "Rounded_Corners@lennart-k"
        "run-cmd@custom.extension"
        "stage-manager@gnome-stage-manager"
        "top-bar-organizer@julian.gse.jsts.xyz"
        "volume-percentage-quick-settings@imdarktom"
        "wack-lockscreen-clock@rinzler69-wastaken.github.com"
        "wifi-hotspot-quick-settings@aryan10.github.io"
        "user-theme@gnome-shell-extensions.gcampax.github.com"
    )

    log_info "Вимкнення всіх кастомних розширень macW1Y..."
    for ext_id in "${ALL_MAC_EXTS[@]}"; do
        run_as_user gnome-extensions disable "$ext_id" 2>/dev/null || true
    done

    log_info "Видалення кастомних розширень з каталогу користувача..."
    for ext_id in "${ALL_MAC_EXTS[@]}" "ding-patches"; do
        rm -rf "$TARGET_HOME/.local/share/gnome-shell/extensions/$ext_id"
    done
    sudo rm -rf /usr/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com 2>/dev/null || true

    log_info "Скидання списків розширень GNOME Shell до заводських налаштувань..."
    run_as_user gsettings reset org.gnome.shell enabled-extensions 2>/dev/null || true
    run_as_user gsettings reset org.gnome.shell disabled-extensions 2>/dev/null || true

    # Повторна активація стандартних розширень системи
    if [ "$IS_UBUNTU" = "true" ]; then
        log_info "Повторна активація стандартних розширень Ubuntu..."
        local UBUNTU_DEFAULT_EXTS=(
            "ubuntu-dock@ubuntu.com"
            "tiling-assistant@ubuntu.com"
            "ding@rastersoft.com"
            "ubuntu-appindicators@ubuntu.com"
        )
        for ext_id in "${UBUNTU_DEFAULT_EXTS[@]}"; do
            run_as_user gnome-extensions enable "$ext_id" 2>/dev/null || true
        done
        run_as_user systemctl --user unmask snap.snapd-desktop-integration.snapd-desktop-integration.service 2>/dev/null || true
    elif [ "$IS_FEDORA" = "true" ]; then
        if [ -d /usr/share/gnome-shell/extensions/background-logo@fedorahosted.org ]; then
            run_as_user gnome-extensions enable "background-logo@fedorahosted.org" 2>/dev/null || true
        fi
    fi

    # Повне очищення конфігурацій розширень у dconf
    log_info "Очищення схем dconf від налаштувань розширень macW1Y..."
    run_as_user dconf reset -f /org/gnome/shell/extensions/dash2dock-motion/ 2>/dev/null || true
    run_as_user dconf reset -f /org/gnome/shell/extensions/dash-to-dock/ 2>/dev/null || true
    run_as_user dconf reset -f /org/gnome/shell/extensions/ubuntu-dock/ 2>/dev/null || true
    run_as_user dconf reset -f /org/gnome/shell/extensions/blur-my-shell/ 2>/dev/null || true
    run_as_user dconf reset -f /org/gnome/shell/extensions/desktop-widgets-r3nhick/ 2>/dev/null || true
    run_as_user dconf reset -f /org/gnome/shell/extensions/wack-lockscreen-clock/ 2>/dev/null || true
    run_as_user dconf reset -f /org/gnome/shell/extensions/cupertino-dock-lite/ 2>/dev/null || true
    run_as_user dconf reset -f /org/gnome/shell/extensions/top-bar-organizer/ 2>/dev/null || true
    run_as_user dconf reset -f /org/gnome/shell/extensions/appmenu/ 2>/dev/null || true
    run_as_user dconf reset -f /org/gnome/shell/extensions/liquid-glass/ 2>/dev/null || true
    run_as_user dconf reset -f /org/gnome/shell/extensions/compiz-alike-magic-lamp-effect/ 2>/dev/null || true
    run_as_user dconf reset -f /org/gnome/shell/extensions/Rounded_Corners/ 2>/dev/null || true
    run_as_user dconf reset -f /org/gnome/shell/extensions/user-theme/ 2>/dev/null || true

    # Відновлення тем GTK, іконок, курсорів, кнопок вікон та звуків
    log_info "Відновлення тем GTK, іконок, курсорів та розташування кнопок вікон..."
    if [ "$IS_UBUNTU" = "true" ]; then
        run_as_user gsettings set org.gnome.desktop.interface gtk-theme 'Yaru' 2>/dev/null || true
        run_as_user gsettings set org.gnome.desktop.interface icon-theme 'Yaru' 2>/dev/null || true
        run_as_user gsettings set org.gnome.desktop.interface cursor-theme 'Yaru' 2>/dev/null || true
        run_as_user gsettings set org.gnome.desktop.wm.preferences theme 'Yaru' 2>/dev/null || true
        run_as_user gsettings set org.gnome.desktop.wm.preferences button-layout ':minimize,maximize,close' 2>/dev/null || true
        run_as_user gsettings set org.gnome.desktop.sound theme-name 'Yaru' 2>/dev/null || true
    else
        run_as_user gsettings set org.gnome.desktop.interface gtk-theme 'Adwaita' 2>/dev/null || true
        run_as_user gsettings set org.gnome.desktop.interface icon-theme 'Adwaita' 2>/dev/null || true
        run_as_user gsettings set org.gnome.desktop.interface cursor-theme 'Adwaita' 2>/dev/null || true
        run_as_user gsettings set org.gnome.desktop.wm.preferences theme 'Adwaita' 2>/dev/null || true
        run_as_user gsettings reset org.gnome.desktop.wm.preferences button-layout 2>/dev/null || true
        run_as_user gsettings set org.gnome.desktop.sound theme-name 'freedesktop' 2>/dev/null || true
    fi

    # Скидання кольорової схеми та акцентного кольору
    run_as_user gsettings reset org.gnome.desktop.interface accent-color 2>/dev/null || true
    run_as_user gsettings reset org.gnome.desktop.interface color-scheme 2>/dev/null || true
    run_as_user dconf write /org/gnome/shell/extensions/user-theme/name "''" 2>/dev/null || true

    # Відновлення стандартних шрифтів GNOME
    log_info "Відновлення стандартних шрифтів GNOME..."
    run_as_user gsettings reset org.gnome.desktop.interface font-name 2>/dev/null || true
    run_as_user gsettings reset org.gnome.desktop.interface document-font-name 2>/dev/null || true
    run_as_user gsettings reset org.gnome.desktop.interface monospace-font-name 2>/dev/null || true
    run_as_user gsettings reset org.gnome.desktop.wm.preferences titlebar-font 2>/dev/null || true

    # Відновлення закріплених програм у доці (видалення launchpad.desktop)
    log_info "Відновлення стандартного списку закріплених програм..."
    run_as_user gsettings reset org.gnome.shell favorite-apps 2>/dev/null || true

    # Скидання звукових ефектів та аудіозворотного зв'язку
    run_as_user gsettings reset org.gnome.desktop.sound event-sounds 2>/dev/null || true
    run_as_user gsettings reset org.gnome.desktop.sound input-feedback-sounds 2>/dev/null || true

    # Скидання налаштувань Mutter та перемикання повідомлень
    run_as_user gsettings reset org.gnome.mutter dynamic-workspaces 2>/dev/null || true
    run_as_user gsettings reset org.gnome.mutter edge-tiling 2>/dev/null || true
    run_as_user gsettings reset org.gnome.shell.keybindings toggle-message-tray 2>/dev/null || true

    # Скидання параметрів індексації файлів
    run_as_user gsettings reset org.freedesktop.Tracker3.Miner.Files index-recursive-directories 2>/dev/null || true
    run_as_user gsettings reset org.freedesktop.Tracker3.Miner.Files index-single-directories 2>/dev/null || true
    run_as_user gsettings reset org.freedesktop.Tracker3.Miner.Files throttle 2>/dev/null || true

    # Відновлення стандартних шпалер робочого столу
    log_info "Відновлення оригінальних шпалер системи..."
    run_as_user gsettings reset org.gnome.desktop.background picture-uri 2>/dev/null || true
    run_as_user gsettings reset org.gnome.desktop.background picture-uri-dark 2>/dev/null || true
    run_as_user gsettings reset org.gnome.desktop.screensaver picture-uri 2>/dev/null || true

    if [ "$IS_UBUNTU" = "true" ]; then
        if [ -f "/usr/share/backgrounds/warty-final-ubuntu.png" ]; then
            run_as_user gsettings set org.gnome.desktop.background picture-uri "file:///usr/share/backgrounds/warty-final-ubuntu.png" 2>/dev/null || true
            run_as_user gsettings set org.gnome.desktop.background picture-uri-dark "file:///usr/share/backgrounds/warty-final-ubuntu.png" 2>/dev/null || true
            run_as_user gsettings set org.gnome.desktop.screensaver picture-uri "file:///usr/share/backgrounds/warty-final-ubuntu.png" 2>/dev/null || true
        elif [ -f "/usr/share/backgrounds/ubuntu-wallpaper-d.png" ]; then
            run_as_user gsettings set org.gnome.desktop.background picture-uri "file:///usr/share/backgrounds/ubuntu-wallpaper-d.png" 2>/dev/null || true
            run_as_user gsettings set org.gnome.desktop.background picture-uri-dark "file:///usr/share/backgrounds/ubuntu-wallpaper-d.png" 2>/dev/null || true
            run_as_user gsettings set org.gnome.desktop.screensaver picture-uri "file:///usr/share/backgrounds/ubuntu-wallpaper-d.png" 2>/dev/null || true
        fi
    fi

    # Видалення оверлею Параметрів та кастомних ярликів у каталозі користувача
    log_info "Видалення тем, іконок, шрифтів та оверлеїв користувача..."
    rm -rf "$TARGET_HOME/.themes/macW1Y"* "$TARGET_HOME/.themes/macOS"*
    rm -rf "$TARGET_HOME/.icons/macW1Y"* "$TARGET_HOME/.icons/macw1y"*
    rm -rf "$TARGET_HOME/.local/share/icons/macW1Y"* "$TARGET_HOME/.local/share/icons/macw1y"*
    rm -rf "$TARGET_HOME/.local/share/fonts/SF_Pro" "$TARGET_HOME/.local/share/fonts/Default"*
    rm -rf "$TARGET_HOME/.config/gtk-3.0" "$TARGET_HOME/.config/gtk-4.0"
    rm -rf "$TARGET_HOME/.config/mac-styling" "$TARGET_HOME/.config/macW1Y" "$TARGET_HOME/.local/share/macW1Y"
    rm -rf "$TARGET_HOME/.local/share/sounds/macW1Y"
    rm -rf "$TARGET_HOME/.cache/mac-clipboard"
    rm -rf "$TARGET_HOME/.local/share/gnome-control-center-overlay"
    rm -f "$TARGET_HOME/.local/bin/gnome-control-center" "$TARGET_HOME/.local/bin/mac-styling-settings" "$TARGET_HOME/.local/bin/extension-manager"
    rm -f "$TARGET_HOME/.local/lib/libmac_settings.so" "$TARGET_HOME/.local/lib/libmac_extension_manager.so"
    rm -f "$TARGET_HOME/.local/share/applications/launchpad.desktop"
    rm -f "$TARGET_HOME/.local/share/applications/mac-styling-settings.desktop"
    rm -f "$TARGET_HOME/.local/share/applications/mac-app-launcher.desktop"
    rm -f "$TARGET_HOME/.local/share/applications/org.gnome.Settings.desktop"
    rm -f "$TARGET_HOME/.local/share/applications/com.mattjakeman.ExtensionManager.desktop"
    rm -f "$TARGET_HOME/.local/share/dbus-1/services/org.gnome.Settings.service"
    rm -f "$TARGET_HOME/.config/autostart/macw1y-login-sound.desktop"
    rm -f "$TARGET_HOME/.config/autostart/mac-sync-applications.desktop"
    rm -f "$TARGET_HOME/.config/autostart/mac-ensure-extensions.desktop"
    rm -f "$TARGET_HOME/.config/autostart/nautilus-daemon.desktop"
    rm -f "$TARGET_HOME/.config/environment.d/10-mac-theme.conf"
    rm -f "$TARGET_HOME/.config/environment.d/20-macw1y-performance.conf"
    rm -f "$TARGET_HOME/.config/environment.d/10-gnome-shell-overlay.conf"
    rm -f "$TARGET_HOME/.config/systemd/user/mac-app-manager.service"
    rm -f "$TARGET_HOME/.config/systemd/user/mac-screenshot-daemon.service"
    rm -f "$TARGET_HOME/.config/systemd/user/org.gnome.Shell@.service.d/mac-transition.conf*"
    run_as_user update-desktop-database "$TARGET_HOME/.local/share/applications" 2>/dev/null || true

    log_success "Користувацький інтерфейс GNOME повністю повернено до стандарту!"
}

# ------------------------------------------------------------------------------
# 2. Видалення системних компонентів, служб, завантажувача та бібліотек
# ------------------------------------------------------------------------------
restore_system() {
    log_step "Вимкнення та видалення системних служб і компонентів macW1Y..."
    require_root

    # Відновлення системної теми курсора
    log_info "Відновлення системної теми курсора..."
    if [ "$IS_UBUNTU" = "true" ]; then
        if [ -d /usr/share/icons/default ]; then
            sudo tee /usr/share/icons/default/index.theme >/dev/null << 'EOF'
[Icon Theme]
Inherits=Yaru
EOF
        fi
        if command -v update-alternatives >/dev/null 2>&1; then
            sudo update-alternatives --auto x-cursor-theme 2>/dev/null || true
        fi
    else
        if [ -d /usr/share/icons/default ]; then
            sudo tee /usr/share/icons/default/index.theme >/dev/null << 'EOF'
[Icon Theme]
Inherits=Adwaita
EOF
        fi
    fi

    # Видалення загальносистемних каталогів тем, іконок, шпалер, звуків, шрифтів
    log_info "Видалення загальносистемних тем та ресурсів macW1Y..."
    sudo rm -rf /usr/share/themes/macW1Y* 2>/dev/null || true
    sudo rm -rf /usr/share/icons/macW1Y* /usr/share/icons/macw1y* 2>/dev/null || true
    sudo rm -rf /usr/share/sounds/macW1Y 2>/dev/null || true
    sudo rm -rf /usr/local/share/fonts/SF_Pro /usr/local/share/fonts/Default* 2>/dev/null || true
    sudo rm -f /usr/share/backgrounds/GoldenGate* 2>/dev/null || true
    sudo rm -f /usr/share/applications/launchpad.desktop /usr/share/applications/mac-app-launcher.desktop 2>/dev/null || true

    # Жести тачпада
    log_info "Зупинка та видалення демона жестів тачпада..."
    sudo systemctl stop mac-touchpad-daemon.service 2>/dev/null || true
    sudo systemctl disable mac-touchpad-daemon.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/mac-touchpad-daemon.service
    sudo rm -f /usr/local/bin/mac-touchpad-daemon
    sudo rm -f /usr/local/lib/libmac_3fg_drag.so
    sudo rm -f /etc/mac-touchpad.conf
    sudo rm -f /etc/udev/rules.d/99-uinput.rules
    sudo udevadm control --reload-rules 2>/dev/null || true

    # Стан курсора Snap
    sudo systemctl stop mac-snap-cursor-override.service 2>/dev/null || true
    sudo systemctl disable mac-snap-cursor-override.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/mac-snap-cursor-override.service
    sudo rm -f /usr/local/bin/mac-snap-cursor-sync

    # Режим гри та системні оптимізації
    log_info "Вимкнення Game Mode та видалення оптимізацій macW1Y..."
    sudo systemctl stop mac-gamemode.service 2>/dev/null || true
    sudo systemctl disable mac-gamemode.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/mac-gamemode.service
    sudo rm -f /usr/local/bin/mac-gamemode
    sudo rm -f /usr/local/bin/gamemoderun
    sudo rm -f /usr/local/bin/nvidia-game-run
    sudo rm -f /usr/local/bin/prime-run
    sudo rm -f /usr/local/bin/steam
    sudo rm -f /usr/local/bin/mac-sanitize-favorites.sh
    sudo rm -f /usr/local/bin/mac-generate-bookmarks.sh
    sudo rm -f /usr/local/bin/mac-clipboard
    sudo rm -f /usr/local/bin/mac-login-sound
    sudo rm -f /usr/local/bin/mac-uninstall-app
    sudo rm -f /usr/local/bin/mac-sync-applications
    sudo rm -f /usr/local/bin/mac-diagnostics
    sudo rm -f /usr/local/bin/mac-extension-guard
    sudo rm -f /usr/local/bin/mac-audit-sync
    sudo rm -f /usr/local/bin/mac-setup-wizard
    sudo rm -f /usr/local/bin/mac-apply-theme
    sudo rm -f /usr/local/bin/mac-apply-locale
    sudo rm -f /usr/local/bin/mac-build-theme
    sudo rm -f /usr/local/bin/mac-icon-normalizer
    sudo rm -f /usr/local/bin/mac-theme-sync
    sudo rm -f /usr/local/bin/mac-integrity-check
    sudo rm -f /usr/local/bin/mac-widget-picker
    sudo rm -f /usr/local/bin/mac-lowspec-optimizer
    sudo rm -f /usr/local/bin/mac-installer-gui
    sudo rm -f /usr/local/bin/macW1Y /usr/local/bin/macw1y
    sudo rm -f /etc/mac-gamemode.state
    sudo rm -f /etc/sysctl.d/99-macw1y-performance.conf
    sudo rm -f /etc/modprobe.d/nvidia-runtimepm.conf
    sudo rm -f /etc/xdg/autostart/nautilus-daemon.desktop
    sudo rm -rf /etc/macW1Y

    # Відновлення обгорток Nautilus, Параметрів та Ptyxis
    log_info "Відновлення стандартних Nautilus, gnome-control-center та Ptyxis..."
    for app in nautilus gnome-control-center ptyxis; do
        if [ -f "/usr/bin/$app.orig" ] && { [ ! -e "/usr/bin/$app" ] || { grep -Iq . "/usr/bin/$app" && grep -Eq 'find_mac_lib\(\)|/usr/bin/[^ ]+\.orig' "/usr/bin/$app"; }; }; then
            sudo install -m 755 "/usr/bin/$app.orig" "/usr/bin/$app"
        fi
        for wrapper in "/usr/local/bin/$app" "$TARGET_HOME/.local/bin/$app"; do
            if [ -f "$wrapper" ] && { grep -Iq . "$wrapper" && grep -Eq 'find_mac_lib\(\)|/usr/bin/[^ ]+\.orig' "$wrapper"; }; then
                sudo rm -f "$wrapper"
            fi
        done
    done

    # Видалення ін'єктованих спільних C-бібліотек
    sudo rm -f /usr/lib/x86_64-linux-gnu/libmac* /usr/lib64/libmac* /usr/lib/libmac* /usr/local/lib/libmac* 2>/dev/null || true
    sudo rm -f /usr/lib/x86_64-linux-gnu/nautilus/extensions-4/libmac_nautilus_menu.so /usr/lib64/nautilus/extensions-4/libmac_nautilus_menu.so /usr/lib/nautilus/extensions-4/libmac_nautilus_menu.so 2>/dev/null || true

    # GDM перехід та GNOME Shell Overlays
    log_info "Видалення системних оверлеїв GNOME Shell..."
    sudo rm -rf /usr/share/mactheme/gnome-shell-overlay
    sudo rm -rf /usr/share/mactheme/gnome-control-center-overlay
    sudo rm -rf /usr/share/mactheme
    sudo rm -f /etc/gnome-shell/ui/layout.js
    sudo rm -f /var/tmp/mactheme-overlay-* /tmp/mactheme-overlay-* /tmp/disable-mactheme-overlay /etc/mactheme/disable-overlay
    sudo rm -f /etc/systemd/user/org.gnome.Shell@.service.d/mac-transition.conf*
    sudo rm -f "$TARGET_HOME/.config/systemd/user/org.gnome.Shell@.service.d/mac-transition.conf*"
    sudo rm -f "$TARGET_HOME/.config/environment.d/10-gnome-shell-overlay.conf"
    if [ -f /etc/environment ]; then
        sudo sed -i '/G_RESOURCE_OVERLAYS.*gnome-shell/d' /etc/environment 2>/dev/null || true
    fi

    # Відновлення оригінального бінарника gnome-shell
    if [ -f "/usr/bin/gnome-shell.real" ]; then
        log_info "Відновлення оригінального /usr/bin/gnome-shell (зняття dpkg-divert)..."
        if command -v dpkg-divert >/dev/null 2>&1 && [ "$(dpkg-divert --truename /usr/bin/gnome-shell)" = /usr/bin/gnome-shell.real ]; then
            sudo cp -p /usr/bin/gnome-shell /usr/bin/gnome-shell.macw1y-backup
            sudo rm /usr/bin/gnome-shell
            if ! sudo dpkg-divert --remove --rename --divert /usr/bin/gnome-shell.real /usr/bin/gnome-shell; then
                sudo cp -p /usr/bin/gnome-shell.real /usr/bin/gnome-shell
                return 1
            fi
        elif [ ! -e /usr/bin/gnome-shell ] || grep -q 'GNOME Shell Launch Wrapper' /usr/bin/gnome-shell; then
            sudo install -m 755 /usr/bin/gnome-shell.real /usr/bin/gnome-shell
        fi
    fi

    sudo rm -f /etc/dconf/db/gdm.d/99-macw1y-auth
    sudo rm -f /etc/dconf/db/gdm.d/99-macw1y* /etc/dconf/db/local.d/99-mactheme* /etc/dconf/db/local.d/99-macw1y* 2>/dev/null || true
    sudo dconf update 2>/dev/null || true

    # Plymouth
    log_info "Відновлення стандартного завантажувача Plymouth..."
    sudo systemctl stop plymouth-verbose-logger.service 2>/dev/null || true
    sudo systemctl disable plymouth-verbose-logger.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/plymouth-verbose-logger.service
    sudo rm -f /usr/local/bin/plymouth-verbose-logger
    sudo rm -rf /usr/share/plymouth/themes/macw1y-boot
    sudo rm -f /etc/systemd/system/plymouth-quit.service.d/override.conf
    sudo rm -f /etc/dracut.conf.d/10-intel-kms.conf
    if command -v plymouth-set-default-theme >/dev/null 2>&1; then
        if [ "$IS_UBUNTU" = "true" ]; then
            sudo plymouth-set-default-theme -R bgrt 2>/dev/null || sudo plymouth-set-default-theme -R ubuntu-logo 2>/dev/null || true
        elif [ "$IS_FEDORA" = "true" ]; then
            sudo plymouth-set-default-theme -R bgrt 2>/dev/null || sudo plymouth-set-default-theme -R spinner 2>/dev/null || true
        else
            sudo plymouth-set-default-theme -R bgrt 2>/dev/null || sudo plymouth-set-default-theme -R details 2>/dev/null || true
        fi
    fi

    # GRUB
    if command -v bootctl >/dev/null 2>&1 && bootctl is-installed 2>/dev/null; then
        log_info "Виявлено systemd-boot; очищення тем GRUB..."
        sudo rm -rf /boot/grub/themes/macw1y-boot /boot/grub2/themes/macw1y-boot /boot/grub/themes/macw1y-boot-usb
    else
        log_info "Відновлення оригінальної конфігурації GRUB..."
        if [ -f /etc/default/grub.bak_mactheme ]; then
            sudo cp /etc/default/grub.bak_mactheme /etc/default/grub
        else
            sudo sed -i '/GRUB_THEME.*macw1y-boot/d' /etc/default/grub 2>/dev/null || true
        fi

        if [ -f /etc/grub.d/10_linux.bak_mactheme ]; then
            sudo cp /etc/grub.d/10_linux.bak_mactheme /etc/grub.d/10_linux
        fi
        sudo rm -f /etc/grub.d/06_mac_theme_select /etc/grub.d/08_mac_usb_entry
        sudo rm -rf /boot/grub/themes/macw1y-boot /boot/grub2/themes/macw1y-boot /boot/grub/themes/macw1y-boot-usb
        sudo rm -f /etc/systemd/system/mac-grub-status.service

        if command -v update-grub >/dev/null 2>&1; then
            sudo update-grub
        elif command -v grub2-mkconfig >/dev/null 2>&1; then
            sudo grub2-mkconfig -o /boot/grub2/grub.cfg 2>/dev/null || true
        elif command -v grub-mkconfig >/dev/null 2>&1; then
            sudo grub-mkconfig -o /boot/grub/grub.cfg 2>/dev/null || true
        fi
    fi

    sudo systemctl daemon-reload
    log_info "Оновлення initramfs..."
    macw1y_rebuild_initramfs
    log_success "Системні служби, Plymouth та GRUB повністю відновлено до стандарту!"
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
    echo -e " Стандартний вигляд GNOME повністю відновлено.\n"
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
elif [ "$1" = "--help" ] || [ "$1" = "-h" ] || [ "$1" = "-?" ] || [ "$1" = "-help" ]; then
    echo "Використання: ./uninstall.sh [ОПЦІЇ]"
    echo "  --all, -y, --yes  Повне видалення та повернення стандартного вигляду GNOME"
    echo "  --ui              Відновлення лише теми, іконок, шрифтів, дока та розширень"
    echo "  --system          Відновлення системних компонентів (GRUB, Plymouth, служби, обгортки)"
    echo "  --help, -h, -?    Показати цю довідку"
    exit 0
fi

# Interactive Menu
print_banner
echo -e " ${C_BOLD}Оберіть дію для деінсталяції:${C_RESET}\n"
echo -e "  ${C_RED}[1]${C_RESET} ${C_BOLD}Повне видалення${C_RESET} (Відновити стандартний GNOME, вимкнути кастомні розширення, повернути завантажувач)"
echo -e "  ${C_YELLOW}[2]${C_RESET} Відновити лише вигляд інтерфейсу GNOME (теми, іконки, шрифти, док, розширення)"
echo -e "  ${C_CYAN}[3]${C_RESET} Вимкнути та видалити системні служби і компоненти (Touchpad daemon, GRUB, Plymouth, обгортки)"
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
