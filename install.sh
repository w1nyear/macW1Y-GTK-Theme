#!/usr/bin/env bash
# ==============================================================================
#   macOS Sequoia / Tahoe Transformation Modpack for Ubuntu 24.04 (GNOME 46)
#  Installer Script - Master Version (macW1Y Release)
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
    echo -e "${C_CYAN}"
    echo "  ╔════════════════════════════════════════════════════════════════════════════╗"
    echo "  ║                                                                            ║"
    echo "  ║         m a c O S   S e q u o i a  /  T a h o e   M o d p a c k           ║"
    echo "  ║                Deep Transformation for Ubuntu 24.04 LTS                    ║"
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
        log_info "Для виконання системних налаштувань потрібні права адміністратора (sudo)."
        sudo -v || { log_error "Не вдалося отримати права sudo. Вихід."; exit 1; }
    fi
}

# ------------------------------------------------------------------------------
# 1. Залежності
# ------------------------------------------------------------------------------
install_dependencies() {
    log_step "Етап 1/13: Встановлення системних залежностей (APT)"
    require_root
    
    if [ -f "$SCRIPT_DIR/dependencies/apt-packages.txt" ]; then
        log_info "Оновлення індексів пакунків..."
        sudo apt-get update -qq
        
        log_info "Встановлення пакунків із dependencies/apt-packages.txt..."
        local PKGS
        PKGS=$(grep -v '^#' "$SCRIPT_DIR/dependencies/apt-packages.txt" | tr '\n' ' ')
        sudo apt-get install -y $PKGS
        log_success "Системні залежності успішно встановлено!"
    else
        log_warning "Файл dependencies/apt-packages.txt не знайдено, пропускаємо."
    fi
}

# ------------------------------------------------------------------------------
# 2. Шрифти Apple San Francisco Pro
# ------------------------------------------------------------------------------
install_fonts() {
    log_step "Етап 2/13: Встановлення шрифтів Apple SF Pro Display/Text"
    local USER_FONT_DIR="$TARGET_HOME/.local/share/fonts/SF_Pro"
    local SYS_FONT_DIR="/usr/local/share/fonts/SF_Pro"
    
    mkdir -p "$USER_FONT_DIR"
    if [ -d "$SCRIPT_DIR/fonts/SF_Pro" ]; then
        cp -r "$SCRIPT_DIR/fonts/SF_Pro/"* "$USER_FONT_DIR/" 2>/dev/null || true
        chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.local/share/fonts"
        
        require_root
        sudo mkdir -p "$SYS_FONT_DIR"
        sudo cp -r "$SCRIPT_DIR/fonts/SF_Pro/"* "$SYS_FONT_DIR/" 2>/dev/null || true
        sudo fc-cache -f >/dev/null 2>&1 || true
        run_as_user fc-cache -f >/dev/null 2>&1 || true
        log_success "29 шрифтів Apple SF Pro успішно розгорнуто та оновлено в кеші шрифтів!"
    else
        log_warning "Папку fonts/SF_Pro не знайдено, пропускаємо."
    fi
}

# ------------------------------------------------------------------------------
# 3. Теми (GTK 3, GTK 4, GNOME Shell)
# ------------------------------------------------------------------------------
install_themes() {
    log_step "Етап 3/13: Встановлення теми MacTahoe (GTK3, GTK4, Shell)"
    local THEMES_DIR="$TARGET_HOME/.themes"
    mkdir -p "$THEMES_DIR"
    
    if [ -d "$SCRIPT_DIR/MacTahoe-Dark" ]; then
        cp -r "$SCRIPT_DIR/MacTahoe-Dark" "$THEMES_DIR/"
        [ -d "$SCRIPT_DIR/MacTahoe-Dark-solid" ] && cp -r "$SCRIPT_DIR/MacTahoe-Dark-solid" "$THEMES_DIR/"
        chown -R "${TARGET_USER}:${TARGET_USER}" "$THEMES_DIR"
        log_success "Теми скопійовано до ~/.themes/"
    fi
    
    # GTK 3 та GTK 4 конфігурація
    mkdir -p "$TARGET_HOME/.config/gtk-3.0" "$TARGET_HOME/.config/gtk-4.0"
    [ -d "$SCRIPT_DIR/gtk-3.0" ] && cp -r "$SCRIPT_DIR/gtk-3.0/"* "$TARGET_HOME/.config/gtk-3.0/"
    [ -d "$SCRIPT_DIR/gtk-4.0" ] && cp -r "$SCRIPT_DIR/gtk-4.0/"* "$TARGET_HOME/.config/gtk-4.0/"
    chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.config/gtk-3.0" "$TARGET_HOME/.config/gtk-4.0"
    
    # GNOME Shell тема
    if [ -d "$SCRIPT_DIR/gnome-shell-theme" ]; then
        mkdir -p "$THEMES_DIR/MacTahoe-Dark/gnome-shell"
        cp -r "$SCRIPT_DIR/gnome-shell-theme/"* "$THEMES_DIR/MacTahoe-Dark/gnome-shell/"
    fi
    
    run_as_user gsettings set org.gnome.desktop.interface gtk-theme 'MacTahoe-Dark'
    run_as_user gsettings set org.gnome.desktop.interface color-scheme 'prefer-dark'
    run_as_user gsettings set org.gnome.desktop.wm.preferences theme 'MacTahoe-Dark'
    log_success "Теми інтерфейсу успішно активовано!"
}

# ------------------------------------------------------------------------------
# 4. Іконки та Активи
# ------------------------------------------------------------------------------
install_icons() {
    log_step "Етап 4/13: Встановлення іконок MacTahoe та Control Center"
    local ICONS_DIR="$TARGET_HOME/.local/share/icons"
    mkdir -p "$ICONS_DIR" "$ICONS_DIR/hicolor/scalable/apps"
    
    if [ -d "$SCRIPT_DIR/icons/MacTahoe-dark" ]; then
        cp -r "$SCRIPT_DIR/icons/MacTahoe-dark" "$ICONS_DIR/"
    fi
    
    [ -f "$SCRIPT_DIR/icons/control-center.png" ] && cp "$SCRIPT_DIR/icons/control-center.png" "$ICONS_DIR/hicolor/scalable/apps/"
    [ -f "$SCRIPT_DIR/icons/control-center-symbolic.svg" ] && cp "$SCRIPT_DIR/icons/control-center-symbolic.svg" "$ICONS_DIR/hicolor/scalable/apps/"
    
    chown -R "${TARGET_USER}:${TARGET_USER}" "$ICONS_DIR"
    gtk-update-icon-cache -f -t "$ICONS_DIR/MacTahoe-dark" 2>/dev/null || true
    gtk-update-icon-cache -f -t "$ICONS_DIR/hicolor" 2>/dev/null || true
    
    run_as_user gsettings set org.gnome.desktop.interface icon-theme 'MacTahoe-dark'
    log_success "Набір іконок macOS активовано!"
}

# ------------------------------------------------------------------------------
# 5. Шпалери (Wallpapers)
# ------------------------------------------------------------------------------
install_wallpaper() {
    log_step "Етап 5/13: Встановлення оригінальних шпалер macOS"
    local WALLPAPER_SRC="$SCRIPT_DIR/wallpapers/mendhak-Bluebells_Suspended_In_Time.jpg"
    local WALLPAPER_DEST="/usr/share/backgrounds/mendhak-Bluebells_Suspended_In_Time.jpg"
    
    if [ -f "$WALLPAPER_SRC" ]; then
        require_root
        sudo cp "$WALLPAPER_SRC" "$WALLPAPER_DEST"
        sudo chmod 644 "$WALLPAPER_DEST"
        
        run_as_user gsettings set org.gnome.desktop.background picture-uri "file://$WALLPAPER_DEST"
        run_as_user gsettings set org.gnome.desktop.background picture-uri-dark "file://$WALLPAPER_DEST"
        run_as_user gsettings set org.gnome.desktop.screensaver picture-uri "file://$WALLPAPER_DEST"
        log_success "Шпалери успішно встановлено та активовано для робочого столу і екрана блокування!"
    else
        log_warning "Файл шпалер не знайдено, пропускаємо."
    fi
}

# ------------------------------------------------------------------------------
# 6. Розширення GNOME Shell та Dconf
# ------------------------------------------------------------------------------
install_extensions() {
    log_step "Етап 6/13: Встановлення та конфігурація розширень GNOME Shell"
    local EXT_USER_DIR="$TARGET_HOME/.local/share/gnome-shell/extensions"
    mkdir -p "$EXT_USER_DIR"
    
    if [ -d "$SCRIPT_DIR/extensions" ]; then
        for ext in "$SCRIPT_DIR/extensions"/*; do
            if [ -d "$ext" ]; then
                local bname
                bname="$(basename "$ext")"
                if [ "$bname" != "ding-patches" ]; then
                    log_info "Встановлення розширення: $bname"
                    rm -rf "$EXT_USER_DIR/$bname"
                    cp -r "$ext" "$EXT_USER_DIR/"
                    if [ -d "$EXT_USER_DIR/$bname/schemas" ]; then
                        glib-compile-schemas "$EXT_USER_DIR/$bname/schemas" 2>/dev/null || true
                    fi
                fi
            fi
        done
        chown -R "${TARGET_USER}:${TARGET_USER}" "$EXT_USER_DIR"
    fi
    
    # Системне розширення для GDM (wack-lockscreen-clock)
    if [ -d "$SCRIPT_DIR/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com" ]; then
        require_root
        log_info "Встановлення wack-lockscreen-clock для GDM екрана блокування..."
        sudo mkdir -p /usr/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com
        sudo cp -r "$SCRIPT_DIR/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/"* /usr/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/
        sudo glib-compile-schemas /usr/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/schemas 2>/dev/null || true
    fi
    
    # Патч для DING (Keep-Above Rename Popup Fix)
    if [ -d "$SCRIPT_DIR/extensions/ding-patches" ] && [ -d "/usr/share/gnome-shell/extensions/ding@rastersoft.com/app" ]; then
        require_root
        log_info "Застосування патчу для вікна перейменування DING..."
        sudo cp "$SCRIPT_DIR/extensions/ding-patches/askRenamePopup.js" /usr/share/gnome-shell/extensions/ding@rastersoft.com/app/ 2>/dev/null || true
        sudo cp "$SCRIPT_DIR/extensions/ding-patches/desktopManager.js" /usr/share/gnome-shell/extensions/ding@rastersoft.com/app/ 2>/dev/null || true
    fi
    
    # Імпорт Dconf
    if [ -f "$SCRIPT_DIR/dconf/gnome-all.dconf" ]; then
        log_info "Імпорт конфігурацій Dconf..."
        run_as_user dconf load / < "$SCRIPT_DIR/dconf/gnome-all.dconf"
    fi
    
    # Активація розширень
    log_info "Увімкнення розширень у системі..."
    local EXT_LIST=(
        "blur-my-shell@aunetx"
        "dash-to-dock@micxgx.gmail.com"
        "compiz-alike-magic-lamp-effect@hermes83.github.com"
        "Rounded_Corners@lennart-k"
        "liquid-glass@thinkingcoding1231.gmail.com"
        "appmenu@ChathurangaBW.github.io"
        "user-theme@gnome-shell-extensions.gcampax.github.com"
        "macos-touchpad-gestures@mactheme"
        "eval-helper@mactheme"
        "wack-lockscreen-clock@rinzler69-wastaken.github.com"
        "ubuntu-appindicators@ubuntu.com"
    )
    for ext_id in "${EXT_LIST[@]}"; do
        run_as_user gnome-extensions enable "$ext_id" 2>/dev/null || true
    done
    log_success "Розширення GNOME Shell успішно налаштовано!"
}

# ------------------------------------------------------------------------------
# 7. Інтеграція в Параметри (GNOME Control Center Overlay)
# ------------------------------------------------------------------------------
install_settings_overlay() {
    log_step "Етап 7/13: Інтеграція сторінки «Mac стилізація» та налаштувань у Параметри"
    local OVERLAY_DIR="$TARGET_HOME/.local/share/gnome-control-center-overlay"
    local LOCAL_BIN="$TARGET_HOME/.local/bin"
    local LOCAL_LIB="$TARGET_HOME/.local/lib"
    local APP_DIR="$TARGET_HOME/.local/share/applications"
    local SVC_DIR="$TARGET_HOME/.local/share/dbus-1/services"
    local CFG_DIR="$TARGET_HOME/.config/mac-styling"
    
    mkdir -p "$OVERLAY_DIR" "$LOCAL_BIN" "$LOCAL_LIB" "$APP_DIR" "$SVC_DIR" "$CFG_DIR"
    
    # Копіювання шаблонів UI
    if [ -d "$SCRIPT_DIR/gnome-control-center-overlay" ]; then
        cp "$SCRIPT_DIR/gnome-control-center-overlay"/cc-*.ui "$OVERLAY_DIR/"
        cp "$SCRIPT_DIR/gnome-control-center-overlay/libmac_settings.c" "$OVERLAY_DIR/"
    fi
    
    # Компіляція бібліотеки-перехоплювача
    log_info "Збірка динамічної бібліотеки libmac_settings.so..."
    if command -v gcc >/dev/null 2>&1; then
        gcc -shared -fPIC -o "$LOCAL_LIB/libmac_settings.so" "$OVERLAY_DIR/libmac_settings.c" $(pkg-config --cflags --libs glib-2.0 gio-2.0 json-glib-1.0 2>/dev/null) -ldl 2>/dev/null || {
            [ -f "$SCRIPT_DIR/lib/libmac_settings.so" ] && cp "$SCRIPT_DIR/lib/libmac_settings.so" "$LOCAL_LIB/libmac_settings.so"
        }
    else
        [ -f "$SCRIPT_DIR/lib/libmac_settings.so" ] && cp "$SCRIPT_DIR/lib/libmac_settings.so" "$LOCAL_LIB/libmac_settings.so"
    fi
    
    # Бінарники та скрипти запуску
    [ -f "$SCRIPT_DIR/bin/gnome-control-center" ] && cp "$SCRIPT_DIR/bin/gnome-control-center" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/gnome-control-center"
    [ -f "$SCRIPT_DIR/bin/mac-styling-settings" ] && cp "$SCRIPT_DIR/bin/mac-styling-settings" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/mac-styling-settings"
    [ -f "$SCRIPT_DIR/bin/gnome-theme-switcher" ] && cp "$SCRIPT_DIR/bin/gnome-theme-switcher" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/gnome-theme-switcher"
    
    # Desktop файли та D-Bus сервіси
    [ -f "$SCRIPT_DIR/applications/mac-styling-settings.desktop" ] && cp "$SCRIPT_DIR/applications/mac-styling-settings.desktop" "$APP_DIR/"
    [ -f "$SCRIPT_DIR/applications/org.gnome.Settings.desktop" ] && cp "$SCRIPT_DIR/applications/org.gnome.Settings.desktop" "$APP_DIR/"
    [ -f "$SCRIPT_DIR/services/org.gnome.Settings.service" ] && cp "$SCRIPT_DIR/services/org.gnome.Settings.service" "$SVC_DIR/"
    
    # Конфіги
    if [ -d "$SCRIPT_DIR/config/mac-styling" ]; then
        cp -r "$SCRIPT_DIR/config/mac-styling/"* "$CFG_DIR/"
    fi
    
    chown -R "${TARGET_USER}:${TARGET_USER}" "$OVERLAY_DIR" "$LOCAL_BIN" "$LOCAL_LIB" "$APP_DIR" "$SVC_DIR" "$CFG_DIR"
    run_as_user update-desktop-database "$APP_DIR" 2>/dev/null || true
    log_success "Параметри успішно розширено вкладками Mac стилізації, Bootloader та Режиму гри!"
}

# ------------------------------------------------------------------------------
# 8. Демон жестів тачпада (Touchpad Gestures System)
# ------------------------------------------------------------------------------
install_touchpad() {
    log_step "Етап 8/13: Встановлення демона та жестів тачпада macOS"
    require_root
    
    # Компіляція демона
    log_info "Збірка mac-touchpad-daemon..."
    if [ -f "$SCRIPT_DIR/touchpad/mac-touchpad-daemon.c" ]; then
        sudo gcc -O2 "$SCRIPT_DIR/touchpad/mac-touchpad-daemon.c" -lm -o /usr/local/bin/mac-touchpad-daemon 2>/dev/null || {
            sudo cp "$SCRIPT_DIR/bin/mac-touchpad-daemon" /usr/local/bin/mac-touchpad-daemon
        }
        sudo chmod +x /usr/local/bin/mac-touchpad-daemon
    elif [ -f "$SCRIPT_DIR/bin/mac-touchpad-daemon" ]; then
        sudo cp "$SCRIPT_DIR/bin/mac-touchpad-daemon" /usr/local/bin/mac-touchpad-daemon
        sudo chmod +x /usr/local/bin/mac-touchpad-daemon
    fi
    
    # Udev правила для uinput
    if [ -f "$SCRIPT_DIR/etc/udev/rules.d/99-uinput.rules" ]; then
        sudo cp "$SCRIPT_DIR/etc/udev/rules.d/99-uinput.rules" /etc/udev/rules.d/
        sudo udevadm control --reload-rules 2>/dev/null || true
        sudo udevadm trigger 2>/dev/null || true
    fi
    
    # Конфіг тачпада
    [ -f "$SCRIPT_DIR/touchpad/mac-touchpad.conf" ] && sudo cp "$SCRIPT_DIR/touchpad/mac-touchpad.conf" /etc/mac-touchpad.conf
    
    # Системний сервіс
    if [ -f "$SCRIPT_DIR/systemd/mac-touchpad-daemon.service" ]; then
        sudo cp "$SCRIPT_DIR/systemd/mac-touchpad-daemon.service" /etc/systemd/system/
        sudo systemctl daemon-reload
        sudo systemctl enable mac-touchpad-daemon.service
        sudo systemctl restart mac-touchpad-daemon.service || true
    fi
    
    # Додавання користувача до групи input
    sudo usermod -aG input "$TARGET_USER" 2>/dev/null || true
    log_success "Демон жестів тачпада успішно запущено та ввімкнено в автозавантаження!"
}

# ------------------------------------------------------------------------------
# 9. Режим гри та GPU Оптимізація
# ------------------------------------------------------------------------------
install_gamemode() {
    log_step "Етап 9/13: Встановлення Game Mode та утиліт перемикання GPU"
    require_root
    
    for bin_file in mac-gamemode gamemoderun nvidia-game-run prime-run steam DAMX nitro-key-detection.sh; do
        if [ -f "$SCRIPT_DIR/bin/$bin_file" ]; then
            sudo cp "$SCRIPT_DIR/bin/$bin_file" /usr/local/bin/
            sudo chmod +x "/usr/local/bin/$bin_file"
        fi
    done
    
    if [ -f "$SCRIPT_DIR/systemd/mac-gamemode.service" ]; then
        sudo cp "$SCRIPT_DIR/systemd/mac-gamemode.service" /etc/systemd/system/
        sudo systemctl daemon-reload
        sudo systemctl enable mac-gamemode.service
    fi
    
    sudo touch /etc/mac-gamemode.state
    log_success "Службу Game Mode та інтеграцію з параметрами успішно встановлено!"
}

# ------------------------------------------------------------------------------
# 10. Плавний перехід GDM -> Робочий стіл
# ------------------------------------------------------------------------------
install_gdm_transition() {
    log_step "Етап 10/13: Налаштування плавного переходу GDM та екрана блокування"
    require_root
    
    if [ -f "$SCRIPT_DIR/etc/gnome-shell/ui/layout.js" ]; then
        sudo mkdir -p /etc/gnome-shell/ui
        sudo cp "$SCRIPT_DIR/etc/gnome-shell/ui/layout.js" /etc/gnome-shell/ui/layout.js
    fi
    
    # G_RESOURCE_OVERLAYS у /etc/environment
    if ! grep -q "G_RESOURCE_OVERLAYS" /etc/environment 2>/dev/null; then
        echo 'G_RESOURCE_OVERLAYS="/org/gnome/shell/ui=/etc/gnome-shell/ui"' | sudo tee -a /etc/environment >/dev/null
    fi
    log_success "Плавний перехід шпалер та усунення ривків GDM налаштовано!"
}

# ------------------------------------------------------------------------------
# 11. Plymouth Apple Boot Splash
# ------------------------------------------------------------------------------
install_plymouth() {
    log_step "Етап 11/13: Встановлення теми завантаження Apple Plymouth"
    require_root
    
    local PLYMOUTH_TARGET="/usr/share/plymouth/themes/apple-mac"
    if [ -d "$SCRIPT_DIR/plymouth/apple-mac" ]; then
        sudo mkdir -p "$PLYMOUTH_TARGET"
        sudo cp -r "$SCRIPT_DIR/plymouth/apple-mac/"* "$PLYMOUTH_TARGET/"
    fi
    
    # Verbose logger
    if [ -f "$SCRIPT_DIR/plymouth/plymouth-verbose-logger.c" ]; then
        sudo gcc -O2 "$SCRIPT_DIR/plymouth/plymouth-verbose-logger.c" -o /usr/local/bin/plymouth-verbose-logger 2>/dev/null || {
            [ -f "$SCRIPT_DIR/bin/plymouth-verbose-logger" ] && sudo cp "$SCRIPT_DIR/bin/plymouth-verbose-logger" /usr/local/bin/
        }
        sudo chmod +x /usr/local/bin/plymouth-verbose-logger
    fi
    
    if [ -f "$SCRIPT_DIR/systemd/plymouth-verbose-logger.service" ]; then
        sudo cp "$SCRIPT_DIR/systemd/plymouth-verbose-logger.service" /etc/systemd/system/
    fi
    
    if [ -f "$SCRIPT_DIR/systemd/plymouth-quit.service.d/override.conf" ]; then
        sudo mkdir -p /etc/systemd/system/plymouth-quit.service.d
        sudo cp "$SCRIPT_DIR/systemd/plymouth-quit.service.d/override.conf" /etc/systemd/system/plymouth-quit.service.d/
    fi
    
    # Early KMS для Intel GPU
    if [ -f "$SCRIPT_DIR/etc/initramfs-tools/modules" ]; then
        sudo cp "$SCRIPT_DIR/etc/initramfs-tools/modules" /etc/initramfs-tools/modules
    fi
    
    if [ -d "$SCRIPT_DIR/dracut.conf.d" ]; then
        sudo mkdir -p /etc/dracut.conf.d
        sudo cp -r "$SCRIPT_DIR/dracut.conf.d/"* /etc/dracut.conf.d/ 2>/dev/null || true
    fi
    
    if command -v plymouth-set-default-theme >/dev/null 2>&1; then
        sudo plymouth-set-default-theme -R apple-mac 2>/dev/null || true
    fi
    
    log_info "Оновлення initramfs..."
    sudo update-initramfs -u 2>/dev/null || true
    log_success "Apple Boot Splash успішно активовано!"
}

# ------------------------------------------------------------------------------
# 12. GRUB Apple Silicon Boot Manager
# ------------------------------------------------------------------------------
install_grub() {
    log_step "Етап 12/13: Встановлення горизонтального меню GRUB у стилі Apple Silicon"
    require_root
    
    local GRUB_TARGET="/boot/grub/themes/apple-mac"
    if [ -d "$SCRIPT_DIR/grub/apple-mac" ]; then
        sudo mkdir -p "$GRUB_TARGET"
        sudo cp -r "$SCRIPT_DIR/grub/apple-mac/"* "$GRUB_TARGET/"
    fi
    
    # Резервна копія конфігурації
    [ -f /etc/default/grub ] && [ ! -f /etc/default/grub.bak_mactheme ] && sudo cp /etc/default/grub /etc/default/grub.bak_mactheme
    [ -f /etc/grub.d/10_linux ] && [ ! -f /etc/grub.d/10_linux.bak_mactheme ] && sudo cp /etc/grub.d/10_linux /etc/grub.d/10_linux.bak_mactheme
    
    if [ -f "$SCRIPT_DIR/grub/grub.default" ]; then
        sudo cp "$SCRIPT_DIR/grub/grub.default" /etc/default/grub
    else
        sudo sed -i 's/^GRUB_THEME=.*/GRUB_THEME="\/boot\/grub\/themes\/apple-mac\/theme.txt"/' /etc/default/grub
    fi
    
    if [ -f "$SCRIPT_DIR/grub/10_linux" ]; then
        sudo cp "$SCRIPT_DIR/grub/10_linux" /etc/grub.d/10_linux
        sudo chmod 755 /etc/grub.d/10_linux
    fi
    
    log_info "Оновлення GRUB конфігурації..."
    sudo update-grub
    log_success "Горизонтальне меню запуску Apple Silicon успішно встановлено!"
}

# ------------------------------------------------------------------------------
# 13. Фіналізація та перезавантаження компонентів
# ------------------------------------------------------------------------------
finalize_installation() {
    log_step "Етап 13/13: Фіналізація та застосування змін"
    
    log_info "Перезапуск компонентів оболонки..."
    run_as_user gnome-extensions disable blur-my-shell@aunetx 2>/dev/null || true
    sleep 1
    run_as_user gnome-extensions enable blur-my-shell@aunetx 2>/dev/null || true
    
    echo -e "\n${C_GREEN}═══════════════════════════════════════════════════════════════════════${C_RESET}"
    echo -e " ${C_BOLD}${C_GREEN}✔ ВСТАНОВЛЕННЯ УСПІШНО ЗАВЕРШЕНО!${C_RESET}"
    echo -e "${C_GREEN}═══════════════════════════════════════════════════════════════════════${C_RESET}"
    echo -e " ${C_CYAN}Всі компоненти macOS Modpack розгорнуто:${C_RESET}"
    echo -e "   • Тема інтерфейсу MacTahoe-Dark та іконки"
    echo -e "   • Шрифти San Francisco Pro"
    echo -e "   • Меню-бар Liquid Glass із відступами 8px та Apple Menu"
    echo -e "   • Control Center та системні параметри з розділом «Mac стилізація»"
    echo -e "   • Багатопальцеві жести тачпада macOS (3-пальцеве перетягування, щипки copy/paste)"
    echo -e "   • Режим гри (Game Mode) та перемикання графіки Nvidia RTX"
    echo -e "   • Завантажувальне горизонтальне меню GRUB Apple Silicon та Plymouth"
    echo -e "   • Плавний перехід GDM без ривків шпалер"
    echo -e "\n ${C_YELLOW}Рекомендується вийти із сеансу та увійти знову (або перезавантажити ПК),${C_RESET}"
    echo -e " ${C_YELLOW}щоб усі змінні оточення та оверлеї набрали повної сили.${C_RESET}\n"
}

# ------------------------------------------------------------------------------
# Меню та Вибір дій
# ------------------------------------------------------------------------------
run_full_install() {
    install_dependencies
    install_fonts
    install_themes
    install_icons
    install_wallpaper
    install_extensions
    install_settings_overlay
    install_touchpad
    install_gamemode
    install_gdm_transition
    install_plymouth
    install_grub
    finalize_installation
}

run_user_install() {
    install_fonts
    install_themes
    install_icons
    install_wallpaper
    install_extensions
    install_settings_overlay
    finalize_installation
}

run_system_install() {
    install_dependencies
    install_touchpad
    install_gamemode
    install_gdm_transition
    install_plymouth
    install_grub
    log_success "Системні компоненти успішно встановлено!"
}

# CLI Flags
if [ "$1" = "--all" ] || [ "$1" = "-y" ] || [ "$1" = "--yes" ]; then
    print_banner
    run_full_install
    exit 0
elif [ "$1" = "--user" ]; then
    print_banner
    run_user_install
    exit 0
elif [ "$1" = "--system" ]; then
    print_banner
    run_system_install
    exit 0
elif [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Використання: ./install.sh [ОПЦІЇ]"
    echo "  --all, -y     Повне автоматичне встановлення всіх компонентів"
    echo "  --user        Встановлення лише користувацького інтерфейсу (без системних служб)"
    echo "  --system      Встановлення лише системних служб (Touchpad daemon, GRUB, Plymouth, Game Mode)"
    echo "  --help, -h    Показати цю довідку"
    exit 0
fi

# Interactive Menu
print_banner
echo -e " ${C_BOLD}Оберіть режим встановлення:${C_RESET}\n"
echo -e "  ${C_GREEN}[1]${C_RESET} ${C_BOLD}Повне встановлення${C_RESET} (Рекомендовано - інтерфейс, жести, налаштування, GRUB, Plymouth)"
echo -e "  ${C_CYAN}[2]${C_RESET} Тільки користувацький інтерфейс (Тема, іконки, шпалери, розширення, параметри)"
echo -e "  ${C_YELLOW}[3]${C_RESET} Тільки системні служби (Touchpad daemon, Game Mode, Plymouth, GRUB)"
echo -e "  ${C_RED}[0]${C_RESET} Вийти з інсталятора\n"
read -r -p " Введіть номер варіанту [1]: " CHOICE

case "$CHOICE" in
    2)
        run_user_install
        ;;
    3)
        run_system_install
        ;;
    0)
        echo -e "\nВстановлення скасовано."
        exit 0
        ;;
    *)
        run_full_install
        ;;
esac
