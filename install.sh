#!/usr/bin/env bash
# ==============================================================================
#   macOS Sequoia / Tahoe Transformation Modpack (macW1Y Release)
#  Installer & Maintenance System - Version 0.3
# ==============================================================================

set -e

# Version Constants
NEW_VERSION="0.3"

# ANSI Color Codes
C_RESET="\033[0m"
C_BOLD="\033[1m"
C_CYAN="\033[1;36m"
C_BLUE="\033[1;34m"
C_GREEN="\033[1;32m"
C_YELLOW="\033[1;33m"
C_RED="\033[1;31m"
C_MAGENTA="\033[1;35m"

# Detect user context
if [ -n "$SUDO_USER" ]; then
    TARGET_USER="$SUDO_USER"
    TARGET_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
else
    TARGET_USER="$USER"
    TARGET_HOME="$HOME"
fi

TARGET_UID=$(id -u "$TARGET_USER")

# Detect script and assets directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -d "$SCRIPT_DIR/extensions" ]; then
    if [ -d "$TARGET_HOME/macW1Y/extensions" ]; then
        SCRIPT_DIR="$TARGET_HOME/macW1Y"
    elif [ -d "$TARGET_HOME/MACTHEMEFILES/extensions" ]; then
        SCRIPT_DIR="$TARGET_HOME/MACTHEMEFILES"
    fi
fi

print_banner() {
    clear 2>/dev/null || true
    echo -e "${C_CYAN}"
    echo "  ╔════════════════════════════════════════════════════════════════════════════╗"
    echo "  ║                                                                            ║"
    echo "  ║         m a c O S   S e q u o i a  /  T a h o e   M o d p a c k           ║"
    echo "  ║                Transformation & Maintenance System                         ║"
    echo "  ║                         Release: macW1Y (v${NEW_VERSION})                            ║"
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
        if sudo -n true 2>/dev/null; then
            return 0
        fi
        log_info "Для виконання системних налаштувань потрібні права адміністратора (sudo)."
        sudo -v || { log_error "Не вдалося отримати права sudo. Вихід."; exit 1; }
    fi
}

# ------------------------------------------------------------------------------
# Керування версіями (Version Detection & Comparison)
# ------------------------------------------------------------------------------
get_installed_version() {
    if [ -f "$TARGET_HOME/.local/share/macW1Y/version" ]; then
        cat "$TARGET_HOME/.local/share/macW1Y/version" | tr -d " \n\r"
        return
    elif [ -f "/etc/macW1Y/version" ]; then
        cat "/etc/macW1Y/version" | tr -d " \n\r"
        return
    elif [ -f "$TARGET_HOME/.config/mac-styling/version" ]; then
        cat "$TARGET_HOME/.config/mac-styling/version" | tr -d " \n\r"
        return
    fi

    # Експериментальне виявлення попередньо встановленої версії
    if [ -d "$TARGET_HOME/.themes/macW1Y-Dark" ] || \
       [ -d "$TARGET_HOME/.icons/macW1Y-dark" ] || \
       [ -f "$TARGET_HOME/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/components/menubar_v29.js" ] || \
       [ -f "/etc/systemd/system/mac-touchpad-daemon.service" ] || \
       [ -d "/boot/grub/themes/apple-mac" ]; then
        echo "0.1"
        return
    fi

    echo ""
}

save_version() {
    local ver="${1:-$NEW_VERSION}"
    mkdir -p "$TARGET_HOME/.local/share/macW1Y" "$TARGET_HOME/.config/mac-styling"
    echo "$ver" > "$TARGET_HOME/.local/share/macW1Y/version"
    echo "$ver" > "$TARGET_HOME/.config/mac-styling/version"
    chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.local/share/macW1Y" "$TARGET_HOME/.config/mac-styling" 2>/dev/null || true
    
    if [ -w "/etc" ] || [ "$EUID" -eq 0 ] || sudo -n true 2>/dev/null; then
        sudo mkdir -p /etc/macW1Y
        echo "$ver" | sudo tee /etc/macW1Y/version >/dev/null
    fi
}

# Порівняння семантичних версій (x.y / x.y.z):
# повертає: 0 якщо v1 == v2, 1 якщо v1 > v2, 2 якщо v1 < v2
compare_semver() {
    local v1="$1"
    local v2="$2"
    if [ "$v1" = "$v2" ]; then
        echo 0
        return
    fi
    local IFS=.
    local i ver1=($v1) ver2=($v2)
    for ((i=${#ver1[@]}; i<${#ver2[@]}; i++)); do ver1[i]=0; done
    for ((i=${#ver2[@]}; i<${#ver1[@]}; i++)); do ver2[i]=0; done
    for ((i=0; i<${#ver1[@]}; i++)); do
        local n1=$((10#${ver1[i]}))
        local n2=$((10#${ver2[i]}))
        if (( n1 > n2 )); then
            echo 1
            return
        elif (( n1 < n2 )); then
            echo 2
            return
        fi
    done
    echo 0
}

# ------------------------------------------------------------------------------
# Допоміжні функції пофайлового синхронізатора
# ------------------------------------------------------------------------------
sync_or_update_file() {
    local src="$1"
    local dest="$2"
    local use_sudo="${3:-false}"
    
    if [ ! -f "$src" ] && [ ! -L "$src" ]; then
        return
    fi
    
    local dest_dir
    dest_dir="$(dirname "$dest")"
    if [ ! -d "$dest_dir" ]; then
        if [ "$use_sudo" = "true" ]; then
            sudo mkdir -p "$dest_dir"
        else
            mkdir -p "$dest_dir"
        fi
    fi
    
    if [ ! -e "$dest" ] && [ ! -L "$dest" ]; then
        echo -e "   ${C_GREEN}[+] Додано новий файл:${C_RESET} $dest"
        if [ "$use_sudo" = "true" ]; then
            sudo cp -a "$src" "$dest"
        else
            cp -a "$src" "$dest"
        fi
        MODIFIED_COUNT=$((MODIFIED_COUNT + 1))
    elif [ -L "$src" ]; then
        local src_tgt dest_tgt
        src_tgt="$(readlink "$src")"
        dest_tgt="$(readlink "$dest" 2>/dev/null || true)"
        if [ "$src_tgt" != "$dest_tgt" ]; then
            echo -e "   ${C_CYAN}[~] Оновлено посилання:${C_RESET} $dest"
            if [ "$use_sudo" = "true" ]; then
                sudo rm -f "$dest"
                sudo cp -a "$src" "$dest"
            else
                rm -f "$dest"
                cp -a "$src" "$dest"
            fi
            MODIFIED_COUNT=$((MODIFIED_COUNT + 1))
        else
            UNCHANGED_COUNT=$((UNCHANGED_COUNT + 1))
        fi
    elif [ -f "$src" ] && [ -f "$dest" ]; then
        if ! cmp -s "$src" "$dest"; then
            echo -e "   ${C_CYAN}[~] Оновлено змінений файл:${C_RESET} $dest"
            if [ "$use_sudo" = "true" ]; then
                sudo cp -a "$src" "$dest"
            else
                cp -a "$src" "$dest"
            fi
            MODIFIED_COUNT=$((MODIFIED_COUNT + 1))
        else
            UNCHANGED_COUNT=$((UNCHANGED_COUNT + 1))
        fi
    fi
}

sync_directory_tree() {
    local src_dir="$1"
    local dest_dir="$2"
    local use_sudo="${3:-false}"
    
    if [ ! -d "$src_dir" ]; then
        return
    fi
    
    if [ "$use_sudo" = "true" ]; then
        sudo mkdir -p "$dest_dir"
    else
        mkdir -p "$dest_dir"
    fi
    
    if command -v rsync >/dev/null 2>&1; then
        local RSYNC_CMD=("rsync" "-a" "-c" "--itemize-changes" "$src_dir/" "$dest_dir/")
        local OUT
        if [ "$use_sudo" = "true" ]; then
            OUT=$(sudo "${RSYNC_CMD[@]}" 2>/dev/null || true)
        else
            OUT=$("${RSYNC_CMD[@]}" 2>/dev/null || true)
        fi
        
        while IFS= read -r line; do
            [ -z "$line" ] && continue
            local change="${line:0:11}"
            local item="${line:12}"
            [ "$item" = "." ] && continue
            
            if [[ "$change" =~ ^\>f\+{9} ]]; then
                echo -e "   ${C_GREEN}[+] Додано новий файл:${C_RESET} $dest_dir/$item"
                MODIFIED_COUNT=$((MODIFIED_COUNT + 1))
            elif [[ "$change" =~ ^\>f ]] || [[ "$change" =~ ^cL ]]; then
                echo -e "   ${C_CYAN}[~] Оновлено файл:${C_RESET} $dest_dir/$item"
                MODIFIED_COUNT=$((MODIFIED_COUNT + 1))
            fi
        done <<< "$OUT"
    else
        while IFS= read -r -d "" src_file; do
            local rel_path="${src_file#$src_dir/}"
            local target_file="$dest_dir/$rel_path"
            sync_or_update_file "$src_file" "$target_file" "$use_sudo"
        done < <(find "$src_dir" -type f -print0)
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
        PKGS=$(grep -v "^#" "$SCRIPT_DIR/dependencies/apt-packages.txt" | tr "\n" " ")
        sudo apt-get install -y $PKGS
        log_success "Системні залежності успішно встановлено!"
    else
        log_warning "Файл dependencies/apt-packages.txt не знайдено, пропускаємо."
    fi

    if ! command -v opendrop &>/dev/null; then
        log_info "Встановлення утиліти Apple AirDrop (opendrop)..."
        pip3 install --break-system-packages opendrop 2>/dev/null || true
    fi

    if [ ! -f "/usr/lib/x86_64-linux-gnu/girepository-1.0/Blur-1.0.typelib" ] || [ ! -f "/usr/lib/x86_64-linux-gnu/libblur-effect-1.0.so" ]; then
        log_info "Збирання та встановлення бібліотеки gnome-rounded-blur для підтримки апаратного скруглення блуру..."
        local BUILD_TMP="/tmp/gnome-rounded-blur"
        rm -rf "$BUILD_TMP"
        if git clone --depth 1 https://github.com/kancko/gnome-rounded-blur "$BUILD_TMP" 2>/dev/null; then
            (
                cd "$BUILD_TMP"
                meson setup build --prefix=/usr 2>/dev/null || true
                meson compile -C build 2>/dev/null || true
                sudo meson install -C build 2>/dev/null || true
                sudo mkdir -p /usr/lib/girepository-1.0
                sudo cp -f /usr/lib/x86_64-linux-gnu/girepository-1.0/Blur-1.0.typelib /usr/lib/girepository-1.0/ 2>/dev/null || true
                echo "/usr/lib/x86_64-linux-gnu/mutter-18" | sudo tee /etc/ld.so.conf.d/mutter-18.conf >/dev/null 2>&1 || true
                sudo ldconfig 2>/dev/null || true
            )
            log_success "Бібліотеку gnome-rounded-blur успішно встановлено!"
        fi
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
    fi

    if [ -d "$SCRIPT_DIR/fonts/Open_Runde" ]; then
        mkdir -p "$TARGET_HOME/.local/share/fonts/Open_Runde"
        cp -r "$SCRIPT_DIR/fonts/Open_Runde/"* "$TARGET_HOME/.local/share/fonts/Open_Runde/" 2>/dev/null || true
        require_root
        sudo mkdir -p "/usr/local/share/fonts/Open_Runde" "/usr/share/fonts/opentype/Open_Runde"
        sudo cp -r "$SCRIPT_DIR/fonts/Open_Runde/"* "/usr/local/share/fonts/Open_Runde/" 2>/dev/null || true
        sudo cp -r "$SCRIPT_DIR/fonts/Open_Runde/"* "/usr/share/fonts/opentype/Open_Runde/" 2>/dev/null || true
    fi

    sudo fc-cache -f >/dev/null 2>&1 || true
    run_as_user fc-cache -f >/dev/null 2>&1 || true
    log_success "Шрифти Apple SF Pro та Open Runde успішно розгорнуто та оновлено в кеші шрифтів!"
}

# ------------------------------------------------------------------------------
# 3. Теми (GTK 3, GTK 4, GNOME Shell)
# ------------------------------------------------------------------------------
install_themes() {
    log_step "Етап 3/13: Встановлення теми macW1Y (GTK3, GTK4, Shell)"
    local THEMES_DIR="$TARGET_HOME/.themes"
    mkdir -p "$THEMES_DIR"
    
    if [ -d "$SCRIPT_DIR/macW1Y-Dark" ]; then
        cp -r "$SCRIPT_DIR/macW1Y-Dark" "$THEMES_DIR/"
        [ -d "$SCRIPT_DIR/macW1Y-Dark-solid" ] && cp -r "$SCRIPT_DIR/macW1Y-Dark-solid" "$THEMES_DIR/"
        ln -sfn "macW1Y-Dark" "$THEMES_DIR/MacTahoe-Dark"
        ln -sfn "macW1Y-Dark-solid" "$THEMES_DIR/MacTahoe-Dark-solid"
        sudo mkdir -p /usr/share/themes
        sudo cp -rf "$SCRIPT_DIR/macW1Y-Dark" /usr/share/themes/
        [ -d "$SCRIPT_DIR/macW1Y-Dark-solid" ] && sudo cp -rf "$SCRIPT_DIR/macW1Y-Dark-solid" /usr/share/themes/
        sudo ln -sfn macW1Y-Dark /usr/share/themes/MacTahoe-Dark
        sudo ln -sfn macW1Y-Dark /usr/share/themes/macW1Y
        sudo chmod -R a+rX /usr/share/themes/macW1Y* /usr/share/themes/MacTahoe* 2>/dev/null || true
        log_success "Теми скопійовано до ~/.themes/ та /usr/share/themes/"
    fi
    
    mkdir -p "$TARGET_HOME/.config/gtk-3.0" "$TARGET_HOME/.config/gtk-4.0"
    [ -d "$SCRIPT_DIR/gtk-3.0" ] && cp -r "$SCRIPT_DIR/gtk-3.0/"* "$TARGET_HOME/.config/gtk-3.0/"
    [ -d "$SCRIPT_DIR/gtk-4.0" ] && cp -r "$SCRIPT_DIR/gtk-4.0/"* "$TARGET_HOME/.config/gtk-4.0/"
    chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.config/gtk-3.0" "$TARGET_HOME/.config/gtk-4.0"
    
    if [ -d "$SCRIPT_DIR/gnome-shell-theme" ]; then
        mkdir -p "$THEMES_DIR/macW1Y-Dark/gnome-shell"
        cp -r "$SCRIPT_DIR/gnome-shell-theme/"* "$THEMES_DIR/macW1Y-Dark/gnome-shell/"
    fi
    
    if [ -f "$SCRIPT_DIR/lib/libmacpopover.so" ]; then
        sudo cp "$SCRIPT_DIR/lib/libmacpopover.so" /usr/local/lib/libmacpopover.so
        sudo chmod 755 /usr/local/lib/libmacpopover.so
        mkdir -p "$TARGET_HOME/.config/environment.d"
        echo "LD_PRELOAD=/usr/local/lib/libmacpopover.so" > "$TARGET_HOME/.config/environment.d/10-mac-theme.conf"
        chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.config/environment.d"
        sudo sed -i "/libmacpopover.so/d" /etc/environment 2>/dev/null || true
        sudo cp -f "$SCRIPT_DIR/lib/libmacpopover.so" /usr/lib/libmacpopover.so 2>/dev/null || true
    fi
    
    # Налаштування macOS Nautilus Finder Sidebar та розділу Програми
    log_info "Встановлення macOS Nautilus Finder Sidebar та розширень..."
    if [ -f "$SCRIPT_DIR/lib/libmac_nautilus.so" ]; then
        sudo cp -f "$SCRIPT_DIR/lib/libmac_nautilus.so" /usr/lib/x86_64-linux-gnu/libmac_nautilus.so 2>/dev/null || true
        sudo chmod 755 /usr/lib/x86_64-linux-gnu/libmac_nautilus.so 2>/dev/null || true
    fi
    if [ -f "$SCRIPT_DIR/lib/libmac_nautilus_menu.so" ]; then
        sudo mkdir -p /usr/lib/x86_64-linux-gnu/nautilus/extensions-4
        sudo cp -f "$SCRIPT_DIR/lib/libmac_nautilus_menu.so" /usr/lib/x86_64-linux-gnu/nautilus/extensions-4/libmac_nautilus_menu.so 2>/dev/null || true
        sudo chmod 755 /usr/lib/x86_64-linux-gnu/nautilus/extensions-4/libmac_nautilus_menu.so 2>/dev/null || true
    fi
    if [ -f "/usr/bin/nautilus" ] && [ ! -f "/usr/bin/nautilus.orig" ]; then
        sudo mv /usr/bin/nautilus /usr/bin/nautilus.orig
    fi
    cat << 'EOF_NAUT' | sudo tee /usr/bin/nautilus >/dev/null
#!/bin/sh
export LD_PRELOAD="/usr/lib/x86_64-linux-gnu/libmac_nautilus.so${LD_PRELOAD:+:$LD_PRELOAD}"
exec /usr/bin/nautilus.orig "$@"
EOF_NAUT
    sudo chmod +x /usr/bin/nautilus 2>/dev/null || true

    if [ -f "$SCRIPT_DIR/bin/mac-sync-applications" ]; then
        sudo cp -f "$SCRIPT_DIR/bin/mac-sync-applications" /usr/local/bin/mac-sync-applications
        sudo chmod 755 /usr/local/bin/mac-sync-applications
    fi
    if [ -f "$SCRIPT_DIR/bin/mac-uninstall-app" ]; then
        sudo cp -f "$SCRIPT_DIR/bin/mac-uninstall-app" /usr/local/bin/mac-uninstall-app
        sudo chmod 755 /usr/local/bin/mac-uninstall-app
    fi
    if [ -f "$SCRIPT_DIR/applications/mac-app-launcher.desktop" ]; then
        sudo cp -f "$SCRIPT_DIR/applications/mac-app-launcher.desktop" /usr/share/applications/mac-app-launcher.desktop
        run_as_user xdg-mime default mac-app-launcher.desktop application/x-desktop 2>/dev/null || true
        run_as_user gio mime application/x-desktop mac-app-launcher.desktop 2>/dev/null || true
    fi
    if [ -f "$SCRIPT_DIR/config/gtk-3.0/bookmarks" ]; then
        mkdir -p "$TARGET_HOME/.config/gtk-3.0"
        cp -f "$SCRIPT_DIR/config/gtk-3.0/bookmarks" "$TARGET_HOME/.config/gtk-3.0/bookmarks"
        chown "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.config/gtk-3.0/bookmarks"
    fi
    if [ -f "$SCRIPT_DIR/autostart/mac-sync-applications.desktop" ]; then
        mkdir -p "$TARGET_HOME/.config/autostart"
        cp -f "$SCRIPT_DIR/autostart/mac-sync-applications.desktop" "$TARGET_HOME/.config/autostart/mac-sync-applications.desktop"
        chown "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.config/autostart/mac-sync-applications.desktop"
    fi
    run_as_user /usr/local/bin/mac-sync-applications 2>/dev/null || true

    run_as_user gsettings set org.gnome.desktop.interface gtk-theme "macW1Y-Dark"
    run_as_user gsettings set org.gnome.desktop.interface color-scheme "prefer-dark"
    run_as_user gsettings set org.gnome.desktop.wm.preferences theme "macW1Y-Dark"
    run_as_user gsettings set org.gnome.desktop.wm.preferences button-layout "close,minimize,maximize:"

    # Синхронізація стилів вікон та кнопок керування для Snap-додатків
    if [ -d "$TARGET_HOME/snap" ]; then
        for snap_dir in "$TARGET_HOME"/snap/*/*/; do
            if [ -d "$snap_dir" ]; then
                mkdir -p "${snap_dir}.config/gtk-3.0" "${snap_dir}.config/gtk-4.0"
                [ -d "$SCRIPT_DIR/gtk-3.0" ] && cp -rf "$SCRIPT_DIR/gtk-3.0/"* "${snap_dir}.config/gtk-3.0/" 2>/dev/null || true
                [ -d "$SCRIPT_DIR/gtk-4.0" ] && cp -rf "$SCRIPT_DIR/gtk-4.0/"* "${snap_dir}.config/gtk-4.0/" 2>/dev/null || true
            fi
        done
        chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/snap" 2>/dev/null || true
    fi
    log_success "Теми інтерфейсу успішно активовано!"
}

# ------------------------------------------------------------------------------
# 4. Іконки та Активи
# ------------------------------------------------------------------------------
install_icons() {
    log_step "Етап 4/13: Встановлення іконок MacTahoe та Control Center"
    local ICONS_DIR="$TARGET_HOME/.local/share/icons"
    mkdir -p "$ICONS_DIR" "$ICONS_DIR/hicolor/scalable/apps"
    
    for theme_dir in MacTahoe MacTahoe-dark MacTahoe-light; do
        if [ -d "$SCRIPT_DIR/icons/$theme_dir" ]; then
            cp -r "$SCRIPT_DIR/icons/$theme_dir" "$ICONS_DIR/"
        fi
    done
    
    # Створюємо сумісне посилання macW1Y-dark -> MacTahoe-dark
    ln -sfn "MacTahoe-dark" "$ICONS_DIR/macW1Y-dark"
    
    [ -f "$SCRIPT_DIR/icons/control-center.png" ] && cp "$SCRIPT_DIR/icons/control-center.png" "$ICONS_DIR/hicolor/scalable/apps/"
    [ -f "$SCRIPT_DIR/icons/control-center-symbolic.svg" ] && cp "$SCRIPT_DIR/icons/control-center-symbolic.svg" "$ICONS_DIR/hicolor/scalable/apps/"
    
    chown -R "${TARGET_USER}:${TARGET_USER}" "$ICONS_DIR"
    gtk-update-icon-cache -f -t "$ICONS_DIR/MacTahoe" 2>/dev/null || true
    gtk-update-icon-cache -f -t "$ICONS_DIR/MacTahoe-dark" 2>/dev/null || true
    gtk-update-icon-cache -f -t "$ICONS_DIR/MacTahoe-light" 2>/dev/null || true
    gtk-update-icon-cache -f -t "$ICONS_DIR/hicolor" 2>/dev/null || true
    
    run_as_user gsettings set org.gnome.desktop.interface icon-theme "MacTahoe-dark"
    log_success "Набір іконок macOS активовано!"
}

# ------------------------------------------------------------------------------
# 5. Системні звуки (macOS Sound Theme)
# ------------------------------------------------------------------------------
install_sounds() {
    log_step "Етап 5/14: Встановлення звукової теми macOS"
    local SOUNDS_DIR="$TARGET_HOME/.local/share/sounds"
    mkdir -p "$SOUNDS_DIR"
    
    if [ -d "$SCRIPT_DIR/sounds/macOS" ]; then
        rm -rf "$SOUNDS_DIR/macOS"
        cp -r "$SCRIPT_DIR/sounds/macOS" "$SOUNDS_DIR/"
        chown -R "${TARGET_USER}:${TARGET_USER}" "$SOUNDS_DIR"
        
        if [ -w "/usr/share/sounds" ] || sudo -n true 2>/dev/null; then
            sudo mkdir -p /usr/share/sounds/macOS
            sudo cp -r "$SCRIPT_DIR/sounds/macOS/"* /usr/share/sounds/macOS/
        fi
        
        run_as_user gsettings set org.gnome.desktop.sound theme-name 'macOS'
        run_as_user gsettings set org.gnome.desktop.sound event-sounds true
        run_as_user gsettings set org.gnome.desktop.sound input-feedback-sounds true
        log_success "Звукову тему macOS успішно встановлено та активовано!"
    fi
    
    if [ -f "$SCRIPT_DIR/autostart/macos-login-sound.desktop" ]; then
        mkdir -p "$TARGET_HOME/.config/autostart"
        cp "$SCRIPT_DIR/autostart/macos-login-sound.desktop" "$TARGET_HOME/.config/autostart/"
        chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.config/autostart"
        log_success "Автозапуск стартового звуку macOS додано!"
    fi
}

# ------------------------------------------------------------------------------
# 6. Шпалери (Wallpapers)
# ------------------------------------------------------------------------------
install_wallpaper() {
    log_step "Етап 5/13: Встановлення оригінальних шпалер macOS"
    local WALLPAPER_SRC="$SCRIPT_DIR/wallpapers/GoldenGate_Day.jpg"
    local WALLPAPER_DEST="/usr/share/backgrounds/GoldenGate_Day.jpg"
    
    if [ -f "$WALLPAPER_SRC" ]; then
        require_root
        sudo cp "$WALLPAPER_SRC" "$WALLPAPER_DEST"
        sudo chmod 644 "$WALLPAPER_DEST"
        
        run_as_user gsettings set org.gnome.desktop.background picture-uri "file://$WALLPAPER_DEST"
        run_as_user gsettings set org.gnome.desktop.background picture-uri-dark "file://$WALLPAPER_DEST"
        run_as_user gsettings set org.gnome.desktop.screensaver picture-uri "file://$WALLPAPER_DEST"
        log_success "Шпалери успішно встановлено та активовано!"
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
    
    # Патч для DING
    if [ -d "$SCRIPT_DIR/extensions/ding-patches" ] && [ -d "/usr/share/gnome-shell/extensions/ding@rastersoft.com/app" ]; then
        require_root
        log_info "Застосування патчу для вікна перейменування DING..."
        sudo cp "$SCRIPT_DIR/extensions/ding-patches/askRenamePopup.js" /usr/share/gnome-shell/extensions/ding@rastersoft.com/app/ 2>/dev/null || true
        sudo cp "$SCRIPT_DIR/extensions/ding-patches/desktopManager.js" /usr/share/gnome-shell/extensions/ding@rastersoft.com/app/ 2>/dev/null || true
        sudo cp "$SCRIPT_DIR/extensions/ding-patches/stylesheet.css" /usr/share/gnome-shell/extensions/ding@rastersoft.com/app/ 2>/dev/null || true
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

    # Вимкнення Stage Manager та накладок/баласту Ubuntu поверх чистого GNOME
    run_as_user gnome-extensions disable "stage-manager@gnome-stage-manager" 2>/dev/null || true
    local UBUNTU_BLOAT_EXTS=(
        "snapd-prompting@canonical.com"
        "snapd-search-provider@canonical.com"
        "web-search-provider@ubuntu.com"
        "tiling-assistant@ubuntu.com"
        "ubuntu-dock@ubuntu.com"
    )
    for ext_id in "${UBUNTU_BLOAT_EXTS[@]}"; do
        run_as_user gnome-extensions disable "$ext_id" 2>/dev/null || true
    done

    # Оптимізація та розблокування служб індексації (усуває зависання Nautilus та програм при запуску)
    run_as_user systemctl --user unmask localsearch-3.service tracker-miner-fs-3.service 2>/dev/null || true
    run_as_user systemctl --user stop snap.snapd-desktop-integration.snapd-desktop-integration.service 2>/dev/null || true
    run_as_user systemctl --user mask snap.snapd-desktop-integration.snapd-desktop-integration.service 2>/dev/null || true
    run_as_user gsettings set org.freedesktop.Tracker3.Miner.Files index-recursive-directories "[]" 2>/dev/null || true
    run_as_user gsettings set org.freedesktop.Tracker3.Miner.Files index-single-directories "[]" 2>/dev/null || true
    run_as_user gsettings set org.freedesktop.Tracker3.Miner.Files throttle 20 2>/dev/null || true

    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com quick-settings-corner-radius 24.0 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com quick-settings-toggle-corner-radius 9999.0 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com panel-menu-tint-color '#000000' 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com panel-menu-tint-strength 0.02 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com panel-menu-brightness 1.0 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com panel-menu-blur-radius 20 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com menu-tint-color '#000000' 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com menu-tint-strength 0.02 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com menu-brightness 1.0 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com application-tint-strength 0.02 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com desktop-menu-tint-strength 0.02 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com osd-tint-strength 0.02 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com quick-settings-toggle-tint-strength 0.02 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com dock-tint-strength 0.02 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com quick-settings-tint-strength 0.02 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com notification-tint-strength 0.02 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock dash-max-icon-size 48 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock dock-fixed false 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock autohide true 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock intellihide true 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock intellihide-mode 'ALL_WINDOWS' 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock require-pressure-to-show false 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com dock-corner-radius 24.0 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.keybindings toggle-message-tray "['<Super>m']" 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.appmenu clipboard-shortcut "['<Super>v']" 2>/dev/null || true
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
    
    if [ -d "$SCRIPT_DIR/gnome-control-center-overlay" ]; then
        cp "$SCRIPT_DIR/gnome-control-center-overlay"/cc-*.ui "$OVERLAY_DIR/"
        cp "$SCRIPT_DIR/gnome-control-center-overlay/libmac_settings.c" "$OVERLAY_DIR/"
    fi
    
    log_info "Збірка динамічної бібліотеки libmac_settings.so..."
    if command -v gcc >/dev/null 2>&1; then
        gcc -shared -fPIC -o "$LOCAL_LIB/libmac_settings.so" "$OVERLAY_DIR/libmac_settings.c" $(pkg-config --cflags --libs glib-2.0 gio-2.0 json-glib-1.0 2>/dev/null) -ldl 2>/dev/null || {
            [ -f "$SCRIPT_DIR/lib/libmac_settings.so" ] && cp "$SCRIPT_DIR/lib/libmac_settings.so" "$LOCAL_LIB/libmac_settings.so"
        }
    else
        [ -f "$SCRIPT_DIR/lib/libmac_settings.so" ] && cp "$SCRIPT_DIR/lib/libmac_settings.so" "$LOCAL_LIB/libmac_settings.so"
    fi

    log_info "Збірка динамічної бібліотеки libmac_extension_manager.so..."
    if [ -f "$SCRIPT_DIR/extension-manager/libmac_extension_manager.c" ] && command -v gcc >/dev/null 2>&1; then
        gcc -shared -fPIC -O2 -o "$LOCAL_LIB/libmac_extension_manager.so" "$SCRIPT_DIR/extension-manager/libmac_extension_manager.c" $(pkg-config --cflags --libs glib-2.0 gio-2.0 2>/dev/null) -ldl 2>/dev/null || {
            [ -f "$SCRIPT_DIR/lib/libmac_extension_manager.so" ] && cp "$SCRIPT_DIR/lib/libmac_extension_manager.so" "$LOCAL_LIB/libmac_extension_manager.so"
        }
    else
        [ -f "$SCRIPT_DIR/lib/libmac_extension_manager.so" ] && cp "$SCRIPT_DIR/lib/libmac_extension_manager.so" "$LOCAL_LIB/libmac_extension_manager.so"
    fi
    
    [ -f "$SCRIPT_DIR/bin/gnome-control-center" ] && cp "$SCRIPT_DIR/bin/gnome-control-center" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/gnome-control-center"
    [ -f "$SCRIPT_DIR/bin/mac-styling-settings" ] && cp "$SCRIPT_DIR/bin/mac-styling-settings" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/mac-styling-settings"
    [ -f "$SCRIPT_DIR/bin/gnome-theme-switcher" ] && cp "$SCRIPT_DIR/bin/gnome-theme-switcher" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/gnome-theme-switcher"
    [ -f "$SCRIPT_DIR/bin/toggle-launchpad.sh" ] && cp "$SCRIPT_DIR/bin/toggle-launchpad.sh" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/toggle-launchpad.sh"
    [ -f "$SCRIPT_DIR/bin/extension-manager" ] && cp "$SCRIPT_DIR/bin/extension-manager" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/extension-manager"
    [ -f "$SCRIPT_DIR/bin/google-chrome" ] && cp "$SCRIPT_DIR/bin/google-chrome" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/google-chrome"
    
    rm -f "$APP_DIR/mac-styling-settings.desktop"
    if [ -d "$SCRIPT_DIR/applications" ]; then
        cp -f "$SCRIPT_DIR/applications/"*.desktop "$APP_DIR/" 2>/dev/null || true
        sed -i "s|/home/vitaliy|$TARGET_HOME|g" "$APP_DIR/"*.desktop 2>/dev/null || true
        chmod +x "$APP_DIR/"*.desktop 2>/dev/null || true
    fi
    [ -f "$SCRIPT_DIR/services/org.gnome.Settings.service" ] && cp "$SCRIPT_DIR/services/org.gnome.Settings.service" "$SVC_DIR/"
    
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
    
    if [ -f "$SCRIPT_DIR/etc/udev/rules.d/99-uinput.rules" ]; then
        sudo cp "$SCRIPT_DIR/etc/udev/rules.d/99-uinput.rules" /etc/udev/rules.d/
        sudo udevadm control --reload-rules 2>/dev/null || true
        sudo udevadm trigger 2>/dev/null || true
    fi
    
    [ -f "$SCRIPT_DIR/touchpad/mac-touchpad.conf" ] && sudo cp "$SCRIPT_DIR/touchpad/mac-touchpad.conf" /etc/mac-touchpad.conf
    
    if [ -f "$SCRIPT_DIR/systemd/mac-touchpad-daemon.service" ]; then
        sudo cp "$SCRIPT_DIR/systemd/mac-touchpad-daemon.service" /etc/systemd/system/
        sudo systemctl daemon-reload
        sudo systemctl enable mac-touchpad-daemon.service
        sudo systemctl restart mac-touchpad-daemon.service || true
    fi
    
    sudo usermod -aG input "$TARGET_USER" 2>/dev/null || true

    sudo rm -f /etc/systemd/user/org.gnome.Shell@.service.d/3fg-drag.conf \
               "$TARGET_HOME/.config/systemd/user/org.gnome.Shell@.service.d/3fg-drag.conf" \
               /usr/local/lib/libmac_3fg_drag.so 2>/dev/null || true

    log_success "Демон жестів тачпада успішно запущено та ввімкнено в автозавантаження!"
}

# ------------------------------------------------------------------------------
# 9. Апаратні драйвери GPU, Режим гри та прискорення запуску програм
# ------------------------------------------------------------------------------
install_gamemode() {
    log_step "Етап 9/13: Встановлення апаратних драйверів GPU, Game Mode та прискорення додатків"
    require_root
    
    # 1. Встановлення бінарних утиліт та скриптів
    for bin_file in mac-gamemode gamemoderun nvidia-game-run prime-run steam DAMX nitro-key-detection.sh mac-boot-config mac-clipboard; do
        if [ -f "$SCRIPT_DIR/bin/$bin_file" ]; then
            sudo cp "$SCRIPT_DIR/bin/$bin_file" /usr/local/bin/
            sudo chmod +x "/usr/local/bin/$bin_file"
        fi
    done
    
    if [ -d "$SCRIPT_DIR/etc/sudoers.d" ]; then
        for sf in "$SCRIPT_DIR/etc/sudoers.d/"*; do
            if [ -f "$sf" ]; then
                sbase="$(basename "$sf")"
                sudo cp "$sf" "/etc/sudoers.d/$sbase"
                sudo chmod 440 "/etc/sudoers.d/$sbase"
            fi
        done
    fi

    # 2. Служба фонового оптимізатора Game Mode
    if [ -f "$SCRIPT_DIR/systemd/mac-gamemode.service" ]; then
        sudo cp "$SCRIPT_DIR/systemd/mac-gamemode.service" /etc/systemd/system/
        sudo systemctl daemon-reload
        sudo systemctl enable mac-gamemode.service
    fi
    sudo touch /etc/mac-gamemode.state

    # 3. Багатоархітектурна підтримка (Multiarch i386 для Steam, Wine, Proton)
    sudo dpkg --add-architecture i386 2>/dev/null || true

    # 4. Автоматичне виявлення та встановлення відповідних драйверів GPU
    local HAS_NVIDIA=false
    local HAS_AMD=false
    local HAS_INTEL=false

    if lspci -nn 2>/dev/null | grep -Ei "vga|3d|display" | grep -Ei "nvidia" >/dev/null 2>&1; then
        HAS_NVIDIA=true
    fi
    if lspci -nn 2>/dev/null | grep -Ei "vga|3d|display" | grep -Ei "amd|ati|radeon" >/dev/null 2>&1; then
        HAS_AMD=true
    fi
    if lspci -nn 2>/dev/null | grep -Ei "vga|3d|display" | grep -Ei "intel" >/dev/null 2>&1; then
        HAS_INTEL=true
    fi

    if [ "$HAS_NVIDIA" = true ]; then
        log_info "Виявлено GPU NVIDIA. Перевірка наявності пропрієтарного драйвера..."
        local NV_VER=""
        if ! command -v nvidia-smi &>/dev/null && ! lsmod | grep -q "^nvidia"; then
            log_info "Пошук та автоматичне встановлення рекомендованого драйвера NVIDIA..."
            local RECOMMENDED_DRIVER=""
            if command -v ubuntu-drivers >/dev/null 2>&1; then
                RECOMMENDED_DRIVER=$(ubuntu-drivers devices 2>/dev/null | grep 'recommended' | awk '{print $3}' | head -n1)
            fi
            if [ -n "$RECOMMENDED_DRIVER" ]; then
                log_info "Встановлення $RECOMMENDED_DRIVER та компонентів PRIME/Wayland..."
                sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "$RECOMMENDED_DRIVER" nvidia-prime nvidia-settings libnvidia-egl-wayland1 2>/dev/null || true
                NV_VER=$(echo "$RECOMMENDED_DRIVER" | grep -oP '\d+')
            else
                sudo DEBIAN_FRONTEND=noninteractive ubuntu-drivers autoinstall 2>/dev/null || true
                NV_VER=$(dpkg -l 2>/dev/null | grep -oP 'nvidia-driver-\K\d+' | head -n1)
            fi
        else
            log_info "Драйвер NVIDIA вже встановлено в системі."
            NV_VER=$(dpkg -l 2>/dev/null | grep -oP 'nvidia-driver-\K\d+' | head -n1)
        fi

        # Встановлення 32-бітних бібліотек NVIDIA OpenGL/Vulkan для Steam та ігор
        if [ -n "$NV_VER" ]; then
            log_info "Встановлення 32-бітних бібліотек libnvidia-gl-$NV_VER:i386 та Vulkan для Steam/ігор..."
            sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "libnvidia-gl-${NV_VER}:i386" libvulkan1:i386 mesa-vulkan-drivers:i386 2>/dev/null || true
        else
            sudo DEBIAN_FRONTEND=noninteractive apt-get install -y libvulkan1:i386 mesa-vulkan-drivers:i386 2>/dev/null || true
        fi

        # Блокування nouveau та оновлення initramfs для коректного завантаження модуля nvidia
        sudo mkdir -p /etc/modprobe.d
        cat << 'EOF' | sudo tee /etc/modprobe.d/blacklist-nouveau.conf >/dev/null
blacklist nouveau
blacklist lbm-nouveau
options nouveau modeset=0
alias nouveau off
alias lbm-nouveau off
EOF

        # Налаштування Dynamic Power Management (RTD3) для миттєвого виходу зі сну без лагів
        cat << 'EOF' | sudo tee /etc/modprobe.d/nvidia-runtimepm.conf >/dev/null
options nvidia "NVreg_DynamicPowerManagement=0x02"
options nvidia-drm modeset=1
options nvidia-drm fbdev=1
EOF
        sudo systemctl enable nvidia-suspend.service nvidia-hibernate.service nvidia-resume.service 2>/dev/null || true
        if command -v update-initramfs >/dev/null 2>&1; then
            sudo update-initramfs -u 2>/dev/null || true
        fi
    fi

    if [ "$HAS_AMD" = true ]; then
        log_info "Виявлено графіку AMD Radeon. Встановлення драйверів Mesa Vulkan/VA-API..."
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y mesa-vulkan-drivers mesa-vulkan-drivers:i386 mesa-va-drivers vulkan-tools 2>/dev/null || true
    fi

    if [ "$HAS_INTEL" = true ]; then
        log_info "Виявлено графіку Intel. Встановлення драйверів апаратного прискорення..."
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y intel-media-va-driver-non-free mesa-vulkan-drivers mesa-vulkan-drivers:i386 vulkan-tools 2>/dev/null || \
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y intel-media-va-driver mesa-vulkan-drivers mesa-vulkan-drivers:i386 vulkan-tools 2>/dev/null || true
    fi

    # 5. Встановлення бібліотек GameMode, Vulkan та демона Preload
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y gamemode libgamemode0 libgamemodeauto0 libvulkan1 vulkan-tools preload 2>/dev/null || true
    sudo systemctl enable --now preload 2>/dev/null || true

    # 6. Оптимізації ядра sysctl (vm.max_map_count для ігор/Proton, кешування та низька латентність)
    if [ -f "$SCRIPT_DIR/etc/sysctl.d/99-macw1y-performance.conf" ]; then
        sudo mkdir -p /etc/sysctl.d
        sudo cp "$SCRIPT_DIR/etc/sysctl.d/99-macw1y-performance.conf" /etc/sysctl.d/
        sudo sysctl -p /etc/sysctl.d/99-macw1y-performance.conf 2>/dev/null || true
    fi

    # 7. Очищення застарілих фонових служб nautilus (використовується системний preload)
    rm -f "$TARGET_HOME/.config/autostart/nautilus-daemon.desktop" 2>/dev/null || true
    sudo rm -f /etc/xdg/autostart/nautilus-daemon.desktop 2>/dev/null || true

    # Кешування GPU шейдерів для усунення затримок компіляції при відкритті програм та ігор
    mkdir -p "$TARGET_HOME/.cache/mesa_shader_cache" "$TARGET_HOME/.cache/nv_shader_cache"
    chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.cache/mesa_shader_cache" "$TARGET_HOME/.cache/nv_shader_cache" 2>/dev/null || true
    mkdir -p "$TARGET_HOME/.config/environment.d"
    cat << EOF > "$TARGET_HOME/.config/environment.d/20-macw1y-performance.conf"
__GL_SHADER_DISK_CACHE=1
__GL_SHADER_DISK_CACHE_PATH=$TARGET_HOME/.cache/nv_shader_cache
__GL_SHADER_DISK_CACHE_SIZE=10737418240
MESA_SHADER_CACHE_DIR=$TARGET_HOME/.cache/mesa_shader_cache
EOF
    chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.config/environment.d" 2>/dev/null || true

    log_success "Апаратні драйвери, ігрові бібліотеки та прискорення додатків успішно налаштовано!"
}

# ------------------------------------------------------------------------------
# 10. Плавний перехід GDM -> Робочий стіл
# ------------------------------------------------------------------------------
install_gdm_transition() {
    log_step "Етап 10/13: Налаштування плавного переходу GDM та екрана блокування macW1Y"
    require_root
    
    if [ -f "$SCRIPT_DIR/etc/gnome-shell/ui/layout.js" ]; then
        sudo mkdir -p /etc/gnome-shell/ui
        sudo cp "$SCRIPT_DIR/etc/gnome-shell/ui/layout.js" /etc/gnome-shell/ui/layout.js
    fi
    
    if ! grep -q "G_RESOURCE_OVERLAYS" /etc/environment 2>/dev/null; then
        echo "G_RESOURCE_OVERLAYS=\"/org/gnome/shell/ui=/etc/gnome-shell/ui\"" | sudo tee -a /etc/environment >/dev/null
    fi

    # 1. Dconf профіль GDM
    sudo mkdir -p /etc/dconf/profile
    if [ -f "$SCRIPT_DIR/macos-gdm/gdm" ]; then
        sudo cp "$SCRIPT_DIR/macos-gdm/gdm" /etc/dconf/profile/gdm
        sudo chmod 644 /etc/dconf/profile/gdm
    fi

    # 2. Dconf налаштування для GDM та екрана блокування
    if [ -f "$SCRIPT_DIR/macos-gdm/99-wack-lockscreen" ]; then
        sudo mkdir -p /etc/dconf/db/gdm.d
        sudo cp "$SCRIPT_DIR/macos-gdm/99-wack-lockscreen" /etc/dconf/db/gdm.d/99-wack-lockscreen
        sudo chmod 644 /etc/dconf/db/gdm.d/99-wack-lockscreen
    fi

    # 3. Системні теми та іконки для GDM
    sudo mkdir -p /usr/share/themes /usr/share/icons
    [ -d "$TARGET_HOME/.themes/macW1Y-Dark" ] && sudo cp -rf "$TARGET_HOME/.themes/macW1Y-Dark" /usr/share/themes/
    [ -d "$TARGET_HOME/.themes/macW1Y-Dark-solid" ] && sudo cp -rf "$TARGET_HOME/.themes/macW1Y-Dark-solid" /usr/share/themes/
    sudo ln -sfn /usr/share/themes/macW1Y-Dark /usr/share/themes/MacTahoe-Dark
    sudo ln -sfn /usr/share/themes/macW1Y-Dark /usr/share/themes/macW1Y
    sudo chmod -R a+rX /usr/share/themes/macW1Y* /usr/share/themes/MacTahoe* 2>/dev/null || true
    
    [ -d "$TARGET_HOME/.local/share/icons/MacTahoe-dark" ] && sudo ln -sfn "$TARGET_HOME/.local/share/icons/MacTahoe-dark" /usr/share/icons/MacTahoe-dark
    sudo chmod -R a+rX /usr/share/icons/MacTahoe* 2>/dev/null || true

    # 4. Встановлення та компіляція схем GSettings (wack-lockscreen та 99_mactheme override)
    local WACK_SCHEMA="$SCRIPT_DIR/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/schemas/org.gnome.shell.extensions.wack-lockscreen-clock.gschema.xml"
    [ ! -f "$WACK_SCHEMA" ] && WACK_SCHEMA="$SCRIPT_DIR/wack-system/schemas/org.gnome.shell.extensions.wack-lockscreen-clock.gschema.xml"
    if [ -f "$WACK_SCHEMA" ]; then
        sudo cp "$WACK_SCHEMA" /usr/share/glib-2.0/schemas/
        sudo chmod 644 /usr/share/glib-2.0/schemas/org.gnome.shell.extensions.wack-lockscreen-clock.gschema.xml
    fi
    if [ -f "$SCRIPT_DIR/macos-gdm/99_mactheme.gschema.override" ]; then
        sudo cp "$SCRIPT_DIR/macos-gdm/99_mactheme.gschema.override" /usr/share/glib-2.0/schemas/
        sudo chmod 644 /usr/share/glib-2.0/schemas/99_mactheme.gschema.override
    fi

    # 5. Очищення та нейтралізація накладань теми Ubuntu Yaru
    if [ -f /usr/share/glib-2.0/schemas/10_ubuntu-settings.gschema.override ]; then
        sudo sed -i 's|gtk-theme = "Yaru"|gtk-theme = "macW1Y-Dark"|g' /usr/share/glib-2.0/schemas/10_ubuntu-settings.gschema.override
        sudo sed -i 's|icon-theme = "Yaru"|icon-theme = "MacTahoe-dark"|g' /usr/share/glib-2.0/schemas/10_ubuntu-settings.gschema.override
        sudo sed -i 's|cursor-theme = "Yaru"|cursor-theme = "macOS"|g' /usr/share/glib-2.0/schemas/10_ubuntu-settings.gschema.override
        sudo sed -i -E 's|(warty-final-ubuntu\.png\|mendhak-Bluebells_Suspended_In_Time\.jpg)|GoldenGate_Day.jpg|g' /usr/share/glib-2.0/schemas/10_ubuntu-settings.gschema.override
    fi
    sudo glib-compile-schemas /usr/share/glib-2.0/schemas/ 2>/dev/null || true

    # 6. Дозвіл розширень у режимах unlock-dialog та gdm
    for mpath in "/usr/share/gnome-shell/extensions/user-theme@gnome-shell-extensions.gcampax.github.com/metadata.json" \
                "$TARGET_HOME/.local/share/gnome-shell/extensions/user-theme@gnome-shell-extensions.gcampax.github.com/metadata.json"; do
        if [ -f "$mpath" ] && ! grep -q "unlock-dialog" "$mpath"; then
            sudo sed -i 's|"shell-version": \[|"session-modes": ["user", "unlock-dialog", "gdm"],\n  "shell-version": [|' "$mpath" 2>/dev/null || true
        fi
    done
    sudo chmod 644 /usr/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/metadata.json 2>/dev/null || true
    sudo chmod 644 /usr/share/gnome-shell/extensions/user-theme@gnome-shell-extensions.gcampax.github.com/metadata.json 2>/dev/null || true
    sudo chmod -R a+rX /usr/share/gnome-shell/extensions/wack-lockscreen-clock@* /usr/share/gnome-shell/extensions/user-theme@* 2>/dev/null || true

    # 7. Збірка та реєстрація системного gresource для GDM
    local GRES_TARGET="/usr/share/gnome-shell/theme/macW1Y-Dark/gnome-shell-theme.gresource"
    local SRC_SH="/usr/share/themes/macW1Y-Dark/gnome-shell"
    if [ ! -f "$GRES_TARGET" ] || [ "$SRC_SH/gnome-shell.css" -nt "$GRES_TARGET" ]; then
        log_info "Компіляція системного ресурсу macW1Y для GDM..."
        local BUILD_TMP="/tmp/macW1Y-build-installer"
        rm -rf "$BUILD_TMP" && mkdir -p "$BUILD_TMP"
        if [ -d "$SRC_SH" ]; then
            cp "$SRC_SH/gnome-shell.css" "$BUILD_TMP/gnome-shell.css"
            cp "$SRC_SH/gnome-shell.css" "$BUILD_TMP/gnome-shell-dark.css"
            cp "$SRC_SH/gnome-shell.css" "$BUILD_TMP/gnome-shell-light.css"
            cp "$SRC_SH/gnome-shell.css" "$BUILD_TMP/gdm.css"
            [ -f "$SRC_SH/pad-osd.css" ] && cp "$SRC_SH/pad-osd.css" "$BUILD_TMP/"
            [ -d "$SRC_SH/assets" ] && cp -r "$SRC_SH/assets" "$BUILD_TMP/"
            [ -d "$SRC_SH/icons" ] && cp -r "$SRC_SH/icons" "$BUILD_TMP/"
            for svg in no-events.svg no-notifications.svg process-working.svg; do
                [ -f "$SRC_SH/$svg" ] && cp "$SRC_SH/$svg" "$BUILD_TMP/"
            done
            for item in gnome-shell-start.svg calendar-today-light.svg calendar-today.svg workspace-placeholder.svg; do
                if [ ! -f "$BUILD_TMP/$item" ] && [ -f /usr/share/gnome-shell/gnome-shell-theme.gresource ]; then
                    gresource extract /usr/share/gnome-shell/gnome-shell-theme.gresource "/org/gnome/shell/theme/$item" > "$BUILD_TMP/$item" 2>/dev/null || true
                fi
            done
            
            (
                echo '<?xml version="1.0" encoding="UTF-8"?>'
                echo '<gresources>'
                echo '  <gresource prefix="/org/gnome/shell/theme">'
                cd "$BUILD_TMP" && find . -type f ! -name "*.xml" ! -name "*.gresource" | sed 's|^\./||' | sort | while read -r f; do
                    echo "    <file>$f</file>"
                done
                echo '  </gresource>'
                echo '</gresources>'
            ) > "$BUILD_TMP/gnome-shell-theme.gresource.xml"
            
            glib-compile-resources --sourcedir="$BUILD_TMP" --target="$BUILD_TMP/gnome-shell-theme.gresource" "$BUILD_TMP/gnome-shell-theme.gresource.xml" 2>/dev/null || true
            if [ -f "$BUILD_TMP/gnome-shell-theme.gresource" ]; then
                sudo mkdir -p /usr/share/gnome-shell/theme/macW1Y-Dark
                sudo cp "$BUILD_TMP/gnome-shell-theme.gresource" "$GRES_TARGET"
                sudo chmod 644 "$GRES_TARGET"
            fi
            rm -rf "$BUILD_TMP"
        fi
    fi

    # 8. update-alternatives для GDM theme та icons
    if [ -f "$GRES_TARGET" ]; then
        sudo update-alternatives --install /usr/share/gnome-shell/gdm-theme.gresource gdm-theme.gresource "$GRES_TARGET" 100 2>/dev/null || true
        sudo update-alternatives --set gdm-theme.gresource "$GRES_TARGET" 2>/dev/null || true
    fi
    if [ -f /usr/share/gnome-shell/gnome-shell-icons.gresource ]; then
        sudo update-alternatives --set gdm-icons.gresource /usr/share/gnome-shell/gnome-shell-icons.gresource 2>/dev/null || true
    fi

    # 9. Налаштування аватара користувача в AccountsService
    if [ ! -f "$TARGET_HOME/.face" ] && [ -f "$SCRIPT_DIR/icons/default-avatar.png" ]; then
        cp "$SCRIPT_DIR/icons/default-avatar.png" "$TARGET_HOME/.face"
        cp "$SCRIPT_DIR/icons/default-avatar.png" "$TARGET_HOME/.face.icon"
        chown "$TARGET_USER:$TARGET_USER" "$TARGET_HOME/.face" "$TARGET_HOME/.face.icon" 2>/dev/null || true
    fi
    if [ -f "$TARGET_HOME/.face" ]; then
        sudo mkdir -p /var/lib/AccountsService/icons /var/lib/AccountsService/users
        sudo cp "$TARGET_HOME/.face" "/var/lib/AccountsService/icons/$TARGET_USER"
        sudo chmod 644 "/var/lib/AccountsService/icons/$TARGET_USER"
        if [ -f "/var/lib/AccountsService/users/$TARGET_USER" ]; then
            sudo sed -i "s|^Icon=.*|Icon=/var/lib/AccountsService/icons/$TARGET_USER|" "/var/lib/AccountsService/users/$TARGET_USER"
        fi
    fi

    # 10. Вимикання сканера відбитків для усунення затримок GDM
    if [ -f /etc/gdm3/greeter.dconf-defaults ]; then
        if ! grep -q "enable-fingerprint-authentication=false" /etc/gdm3/greeter.dconf-defaults; then
            echo "enable-fingerprint-authentication=false" | sudo tee -a /etc/gdm3/greeter.dconf-defaults >/dev/null
        fi
    fi
    if [ -f /etc/pam.d/gdm-fingerprint ]; then
        sudo sed -i "s/.*pam_fprintd.so.*/auth requisite pam_deny.so/" /etc/pam.d/gdm-fingerprint 2>/dev/null || true
    fi
    run_as_user gsettings set org.gnome.login-screen enable-fingerprint-authentication false 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.wack-lockscreen-clock lockscreen-mode 'cupertino' 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.wack-lockscreen-clock cupertino-always-show-user true 2>/dev/null || true
    run_as_user gsettings set org.gnome.desktop.screensaver picture-uri "file:///usr/share/backgrounds/GoldenGate_Day.jpg" 2>/dev/null || true

    # 11. Вимкнення автоматичного входу для обов'язкового відображення екрана блокування GDM
    if [ -f /etc/gdm3/custom.conf ]; then
        sudo sed -i 's|^AutomaticLoginEnable=.*|AutomaticLoginEnable=false|' /etc/gdm3/custom.conf
        sudo sed -i 's|^AutomaticLogin=.*|# AutomaticLogin=vitaliy|' /etc/gdm3/custom.conf
    fi

    sudo dconf update 2>/dev/null || true
    log_success "Екран блокування macW1Y GDM та усунення накладань Yaru налаштовано!"
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
    
    if [ -f "$SCRIPT_DIR/etc/initramfs-tools/modules" ]; then
        sudo cp "$SCRIPT_DIR/etc/initramfs-tools/modules" /etc/initramfs-tools/modules
    fi
    
    if [ -d "$SCRIPT_DIR/dracut.conf.d" ]; then
        sudo mkdir -p /etc/dracut.conf.d
        sudo cp -r "$SCRIPT_DIR/dracut.conf.d/"* /etc/dracut.conf.d/ 2>/dev/null || true
    fi
    
    # Реєстрація теми у Plymouth Alternatives та встановлення за замовчуванням
    if [ -f "$PLYMOUTH_TARGET/apple-mac.plymouth" ]; then
        if command -v update-alternatives >/dev/null 2>&1; then
            sudo update-alternatives --install /usr/share/plymouth/themes/default.plymouth default.plymouth "$PLYMOUTH_TARGET/apple-mac.plymouth" 200 2>/dev/null || true
            sudo update-alternatives --set default.plymouth "$PLYMOUTH_TARGET/apple-mac.plymouth" 2>/dev/null || true
        fi
        if command -v plymouth-set-default-theme >/dev/null 2>&1; then
            sudo plymouth-set-default-theme -R apple-mac 2>/dev/null || true
        fi
        sudo mkdir -p /etc/plymouth
        sudo tee /etc/plymouth/plymouthd.conf >/dev/null << 'EOF'
[Daemon]
Theme=apple-mac
ShowDelay=0
DeviceTimeout=8
EOF
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
    
    [ -f /etc/default/grub ] && [ ! -f /etc/default/grub.bak_mactheme ] && sudo cp /etc/default/grub /etc/default/grub.bak_mactheme
    [ -f /etc/grub.d/10_linux ] && [ ! -f /etc/grub.d/10_linux.bak_mactheme ] && sudo cp /etc/grub.d/10_linux /etc/grub.d/10_linux.bak_mactheme
    
    if [ -f "$SCRIPT_DIR/grub/grub.default" ]; then
        sudo cp "$SCRIPT_DIR/grub/grub.default" /etc/default/grub
    else
        sudo sed -i "s/^GRUB_THEME=.*/GRUB_THEME=\"\/boot\/grub\/themes\/apple-mac\/theme.txt\"/" /etc/default/grub
    fi
    
    if [ -f "$SCRIPT_DIR/grub/10_linux" ]; then
        sudo cp "$SCRIPT_DIR/grub/10_linux" /etc/grub.d/10_linux
        sudo chmod 755 /etc/grub.d/10_linux
    fi

    if [ -f "$SCRIPT_DIR/grub/patch_grub_keys.py" ]; then
        log_info "Застосування бінарних патчів навігації клавіш GRUB..."
        sudo python3 "$SCRIPT_DIR/grub/patch_grub_keys.py" 2>/dev/null || true
    fi

    if [ -f "$SCRIPT_DIR/grub/generate_icons.py" ]; then
        log_info "Генерація прозорих іконок Apple Silicon та статусних віджетів GRUB..."
        sudo python3 "$SCRIPT_DIR/grub/generate_icons.py" 2>/dev/null || true
    fi

    if [ -f "$SCRIPT_DIR/systemd/mac-grub-status.service" ]; then
        sudo cp "$SCRIPT_DIR/systemd/mac-grub-status.service" /etc/systemd/system/
        sudo systemctl daemon-reload
        sudo systemctl enable mac-grub-status.service 2>/dev/null || true
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
    
    save_version "$NEW_VERSION"
    
    log_info "Перезапуск компонентів оболонки..."
    run_as_user gnome-extensions disable blur-my-shell@aunetx 2>/dev/null || true
    sleep 1
    run_as_user gnome-extensions enable blur-my-shell@aunetx 2>/dev/null || true
    
    echo -e "\n${C_GREEN}═══════════════════════════════════════════════════════════════════════${C_RESET}"
    echo -e " ${C_BOLD}${C_GREEN}✔ ВСТАНОВЛЕННЯ / ОНОВЛЕННЯ macW1Y v${NEW_VERSION} УСПІШНО ЗАВЕРШЕНО!${C_RESET}"
    echo -e "${C_GREEN}═══════════════════════════════════════════════════════════════════════${C_RESET}"
    echo -e " ${C_CYAN}Всі компоненти macOS Modpack розгорнуто:${C_RESET}"
    echo -e "   • Тема інтерфейсу macW1Y-Dark та іконки"
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
# Основні режими виконання (Run Modes)
# ------------------------------------------------------------------------------

# 1. Встановлення всього
run_full_install() {
    install_dependencies
    install_fonts
    install_themes
    install_icons
    install_sounds
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

# 2. Оновлення [на пк версія] -> [нова версія]
# Перевіряє кожен файл, замінює змінені та додає відсутні
run_incremental_update() {
    local cur_ver="$1"
    local new_ver="$2"
    
    log_step "Оновлення [v$cur_ver] -> [v$new_ver]: Перевірка та заміна змінених або відсутніх файлів"
    require_root
    
    MODIFIED_COUNT=0
    UNCHANGED_COUNT=0
    
    log_info "1/9 Перевірка шрифтів..."
    sync_directory_tree "$SCRIPT_DIR/fonts/SF_Pro" "$TARGET_HOME/.local/share/fonts/SF_Pro" false
    sync_directory_tree "$SCRIPT_DIR/fonts/SF_Pro" "/usr/local/share/fonts/SF_Pro" true
    sync_directory_tree "$SCRIPT_DIR/fonts/Open_Runde" "$TARGET_HOME/.local/share/fonts/Open_Runde" false
    sync_directory_tree "$SCRIPT_DIR/fonts/Open_Runde" "/usr/local/share/fonts/Open_Runde" true
    
    log_info "2/9 Перевірка тем інтерфейсу..."
    sync_directory_tree "$SCRIPT_DIR/macW1Y-Dark" "$TARGET_HOME/.themes/macW1Y-Dark" false
    sync_directory_tree "$SCRIPT_DIR/macW1Y-Dark-solid" "$TARGET_HOME/.themes/macW1Y-Dark-solid" false
    ln -sfn "macW1Y-Dark" "$TARGET_HOME/.themes/MacTahoe-Dark"
    ln -sfn "macW1Y-Dark-solid" "$TARGET_HOME/.themes/MacTahoe-Dark-solid"
    sync_directory_tree "$SCRIPT_DIR/gtk-3.0" "$TARGET_HOME/.config/gtk-3.0" false
    sync_directory_tree "$SCRIPT_DIR/gtk-4.0" "$TARGET_HOME/.config/gtk-4.0" false
    run_as_user gsettings set org.gnome.desktop.wm.preferences button-layout "close,minimize,maximize:" 2>/dev/null || true
    if [ -d "$TARGET_HOME/snap" ]; then
        for snap_dir in "$TARGET_HOME"/snap/*/*/; do
            if [ -d "$snap_dir" ]; then
                mkdir -p "${snap_dir}.config/gtk-3.0" "${snap_dir}.config/gtk-4.0"
                [ -d "$SCRIPT_DIR/gtk-3.0" ] && cp -rf "$SCRIPT_DIR/gtk-3.0/"* "${snap_dir}.config/gtk-3.0/" 2>/dev/null || true
                [ -d "$SCRIPT_DIR/gtk-4.0" ] && cp -rf "$SCRIPT_DIR/gtk-4.0/"* "${snap_dir}.config/gtk-4.0/" 2>/dev/null || true
            fi
        done
        chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/snap" 2>/dev/null || true
    fi
    if [ -d "$SCRIPT_DIR/gnome-shell-theme" ]; then
        sync_directory_tree "$SCRIPT_DIR/gnome-shell-theme" "$TARGET_HOME/.themes/macW1Y-Dark/gnome-shell" false
    fi
    if [ -f "$SCRIPT_DIR/lib/libmacpopover.so" ]; then
        sync_or_update_file "$SCRIPT_DIR/lib/libmacpopover.so" "/usr/local/lib/libmacpopover.so" true
        sync_or_update_file "$SCRIPT_DIR/lib/libmacpopover.so" "/usr/lib/libmacpopover.so" true
    fi

    log_info "3/9 Перевірка набору іконок..."
    for theme_dir in MacTahoe MacTahoe-dark MacTahoe-light; do
        if [ -d "$SCRIPT_DIR/icons/$theme_dir" ]; then
            sync_directory_tree "$SCRIPT_DIR/icons/$theme_dir" "$TARGET_HOME/.local/share/icons/$theme_dir" false
        fi
    done
    ln -sfn "MacTahoe-dark" "$TARGET_HOME/.local/share/icons/macW1Y-dark"
    sync_or_update_file "$SCRIPT_DIR/icons/control-center.png" "$TARGET_HOME/.local/share/icons/hicolor/scalable/apps/control-center.png" false
    sync_or_update_file "$SCRIPT_DIR/icons/control-center-symbolic.svg" "$TARGET_HOME/.local/share/icons/hicolor/scalable/apps/control-center-symbolic.svg" false
    run_as_user gsettings set org.gnome.desktop.interface icon-theme "MacTahoe-dark"

    log_info "4/10 Перевірка звукової теми macOS..."
    if [ -d "$SCRIPT_DIR/sounds/macOS" ]; then
        sync_directory_tree "$SCRIPT_DIR/sounds/macOS" "$TARGET_HOME/.local/share/sounds/macOS" false
        if [ -w "/usr/share/sounds" ] || sudo -n true 2>/dev/null; then
            sudo mkdir -p /usr/share/sounds/macOS
            sync_directory_tree "$SCRIPT_DIR/sounds/macOS" "/usr/share/sounds/macOS" true
        fi
        run_as_user gsettings set org.gnome.desktop.sound theme-name 'macOS'
        run_as_user gsettings set org.gnome.desktop.sound event-sounds true
        run_as_user gsettings set org.gnome.desktop.sound input-feedback-sounds true
    fi
    if [ -f "$SCRIPT_DIR/autostart/macos-login-sound.desktop" ]; then
        sync_or_update_file "$SCRIPT_DIR/autostart/macos-login-sound.desktop" "$TARGET_HOME/.config/autostart/macos-login-sound.desktop" false
    fi

    log_info "5/10 Перевірка шпалер..."
    if [ -f "$SCRIPT_DIR/wallpapers/GoldenGate_Day.jpg" ]; then
        sync_or_update_file "$SCRIPT_DIR/wallpapers/GoldenGate_Day.jpg" "/usr/share/backgrounds/GoldenGate_Day.jpg" true
    fi

    log_info "5/9 Перевірка розширень GNOME Shell..."
    local EXT_USER_DIR="$TARGET_HOME/.local/share/gnome-shell/extensions"
    if [ -d "$SCRIPT_DIR/extensions" ]; then
        for ext in "$SCRIPT_DIR/extensions"/*; do
            if [ -d "$ext" ]; then
                local bname="$(basename "$ext")"
                if [ "$bname" != "ding-patches" ]; then
                    sync_directory_tree "$ext" "$EXT_USER_DIR/$bname" false
                    if [ -d "$EXT_USER_DIR/$bname/schemas" ]; then
                        glib-compile-schemas "$EXT_USER_DIR/$bname/schemas" 2>/dev/null || true
                    fi
                fi
            fi
        done
        local UBUNTU_BLOAT_EXTS=(
            "stage-manager@gnome-stage-manager"
            "snapd-prompting@canonical.com"
            "snapd-search-provider@canonical.com"
            "web-search-provider@ubuntu.com"
            "tiling-assistant@ubuntu.com"
            "ubuntu-dock@ubuntu.com"
        )
        for ext_id in "${UBUNTU_BLOAT_EXTS[@]}"; do
            run_as_user gnome-extensions disable "$ext_id" 2>/dev/null || true
        done
        run_as_user systemctl --user unmask localsearch-3.service tracker-miner-fs-3.service 2>/dev/null || true
        run_as_user systemctl --user stop snap.snapd-desktop-integration.snapd-desktop-integration.service 2>/dev/null || true
        run_as_user systemctl --user mask snap.snapd-desktop-integration.snapd-desktop-integration.service 2>/dev/null || true
        run_as_user gsettings set org.freedesktop.Tracker3.Miner.Files index-recursive-directories "[]" 2>/dev/null || true
        run_as_user gsettings set org.freedesktop.Tracker3.Miner.Files index-single-directories "[]" 2>/dev/null || true
        run_as_user gsettings set org.freedesktop.Tracker3.Miner.Files throttle 20 2>/dev/null || true
    fi

    log_info "6/9 Перевірка компонентів Параметрів (GNOME Control Center Overlay)..."
    local OVERLAY_DIR="$TARGET_HOME/.local/share/gnome-control-center-overlay"
    local LOCAL_BIN="$TARGET_HOME/.local/bin"
    local LOCAL_LIB="$TARGET_HOME/.local/lib"
    local APP_DIR="$TARGET_HOME/.local/share/applications"
    local SVC_DIR="$TARGET_HOME/.local/share/dbus-1/services"
    local CFG_DIR="$TARGET_HOME/.config/mac-styling"

    if [ -d "$SCRIPT_DIR/gnome-control-center-overlay" ]; then
        sync_directory_tree "$SCRIPT_DIR/gnome-control-center-overlay" "$OVERLAY_DIR" false
    fi
    if [ -f "$SCRIPT_DIR/lib/libmac_settings.so" ]; then
        sync_or_update_file "$SCRIPT_DIR/lib/libmac_settings.so" "$LOCAL_LIB/libmac_settings.so" false
    fi
    if [ -f "$SCRIPT_DIR/lib/libmac_extension_manager.so" ]; then
        sync_or_update_file "$SCRIPT_DIR/lib/libmac_extension_manager.so" "$LOCAL_LIB/libmac_extension_manager.so" false
    fi
    for b in gnome-control-center mac-styling-settings gnome-theme-switcher toggle-launchpad.sh extension-manager google-chrome; do
        if [ -f "$SCRIPT_DIR/bin/$b" ]; then
            sync_or_update_file "$SCRIPT_DIR/bin/$b" "$LOCAL_BIN/$b" false
            chmod +x "$LOCAL_BIN/$b" 2>/dev/null || true
        fi
    done
    if [ -d "$SCRIPT_DIR/applications" ]; then
        for df in "$SCRIPT_DIR/applications/"*.desktop; do
            if [ -f "$df" ]; then
                local bdf="$(basename "$df")"
                sync_or_update_file "$df" "$APP_DIR/$bdf" false
                chmod +x "$APP_DIR/$bdf" 2>/dev/null || true
            fi
        done
    fi
    [ -f "$SCRIPT_DIR/services/org.gnome.Settings.service" ] && sync_or_update_file "$SCRIPT_DIR/services/org.gnome.Settings.service" "$SVC_DIR/org.gnome.Settings.service" false
    if [ -d "$SCRIPT_DIR/config/mac-styling" ]; then
        sync_directory_tree "$SCRIPT_DIR/config/mac-styling" "$CFG_DIR" false
    fi

    log_info "7/9 Перевірка жестів тачпада та Game Mode..."
    if [ -f "$SCRIPT_DIR/bin/mac-touchpad-daemon" ]; then
        sync_or_update_file "$SCRIPT_DIR/bin/mac-touchpad-daemon" "/usr/local/bin/mac-touchpad-daemon" true
        sudo chmod +x /usr/local/bin/mac-touchpad-daemon
    fi
    [ -f "$SCRIPT_DIR/touchpad/mac-touchpad.conf" ] && sync_or_update_file "$SCRIPT_DIR/touchpad/mac-touchpad.conf" "/etc/mac-touchpad.conf" true
    [ -f "$SCRIPT_DIR/etc/udev/rules.d/99-uinput.rules" ] && sync_or_update_file "$SCRIPT_DIR/etc/udev/rules.d/99-uinput.rules" "/etc/udev/rules.d/99-uinput.rules" true
    [ -f "$SCRIPT_DIR/systemd/mac-touchpad-daemon.service" ] && sync_or_update_file "$SCRIPT_DIR/systemd/mac-touchpad-daemon.service" "/etc/systemd/system/mac-touchpad-daemon.service" true

    for gb in mac-gamemode gamemoderun nvidia-game-run prime-run steam DAMX nitro-key-detection.sh mac-boot-config mac-clipboard; do
        if [ -f "$SCRIPT_DIR/bin/$gb" ]; then
            sync_or_update_file "$SCRIPT_DIR/bin/$gb" "/usr/local/bin/$gb" true
            sudo chmod +x "/usr/local/bin/$gb"
        fi
    done
    [ -f "$SCRIPT_DIR/systemd/mac-gamemode.service" ] && sync_or_update_file "$SCRIPT_DIR/systemd/mac-gamemode.service" "/etc/systemd/system/mac-gamemode.service" true

    # Системні оптимізації швидкодії та ігор у режимі оновлення
    if [ -f "$SCRIPT_DIR/etc/sysctl.d/99-macw1y-performance.conf" ]; then
        sync_or_update_file "$SCRIPT_DIR/etc/sysctl.d/99-macw1y-performance.conf" "/etc/sysctl.d/99-macw1y-performance.conf" true
        sudo sysctl -p /etc/sysctl.d/99-macw1y-performance.conf 2>/dev/null || true
    fi
    if [ -f "$SCRIPT_DIR/etc/modprobe.d/nvidia-runtimepm.conf" ]; then
        sync_or_update_file "$SCRIPT_DIR/etc/modprobe.d/nvidia-runtimepm.conf" "/etc/modprobe.d/nvidia-runtimepm.conf" true
    fi
    if [ -f "$SCRIPT_DIR/autostart/nautilus-daemon.desktop" ]; then
        mkdir -p "$TARGET_HOME/.config/autostart"
        sync_or_update_file "$SCRIPT_DIR/autostart/nautilus-daemon.desktop" "$TARGET_HOME/.config/autostart/nautilus-daemon.desktop" false
        if [ -w "/etc/xdg/autostart" ] || sudo -n true 2>/dev/null; then
            sudo cp "$SCRIPT_DIR/autostart/nautilus-daemon.desktop" /etc/xdg/autostart/ 2>/dev/null || true
        fi
    fi

    # Nautilus Finder Sidebar та розширення
    log_info "Оновлення macOS Nautilus Finder Sidebar..."
    if [ -f "$SCRIPT_DIR/lib/libmac_nautilus.so" ]; then
        sync_or_update_file "$SCRIPT_DIR/lib/libmac_nautilus.so" "/usr/lib/x86_64-linux-gnu/libmac_nautilus.so" true
        sudo chmod 755 /usr/lib/x86_64-linux-gnu/libmac_nautilus.so 2>/dev/null || true
    fi
    if [ -f "$SCRIPT_DIR/lib/libmac_nautilus_menu.so" ]; then
        sudo mkdir -p /usr/lib/x86_64-linux-gnu/nautilus/extensions-4
        sync_or_update_file "$SCRIPT_DIR/lib/libmac_nautilus_menu.so" "/usr/lib/x86_64-linux-gnu/nautilus/extensions-4/libmac_nautilus_menu.so" true
        sudo chmod 755 /usr/lib/x86_64-linux-gnu/nautilus/extensions-4/libmac_nautilus_menu.so 2>/dev/null || true
    fi
    if [ -f "/usr/bin/nautilus" ] && [ ! -f "/usr/bin/nautilus.orig" ]; then
        sudo mv /usr/bin/nautilus /usr/bin/nautilus.orig
    fi
    cat << 'EOF_NAUT' | sudo tee /usr/bin/nautilus >/dev/null
#!/bin/sh
export LD_PRELOAD="/usr/lib/x86_64-linux-gnu/libmac_nautilus.so${LD_PRELOAD:+:$LD_PRELOAD}"
exec /usr/bin/nautilus.orig "$@"
EOF_NAUT
    sudo chmod +x /usr/bin/nautilus 2>/dev/null || true

    if [ -f "$SCRIPT_DIR/bin/mac-sync-applications" ]; then
        sync_or_update_file "$SCRIPT_DIR/bin/mac-sync-applications" "/usr/local/bin/mac-sync-applications" true
        sudo chmod 755 /usr/local/bin/mac-sync-applications
    fi
    if [ -f "$SCRIPT_DIR/bin/mac-uninstall-app" ]; then
        sync_or_update_file "$SCRIPT_DIR/bin/mac-uninstall-app" "/usr/local/bin/mac-uninstall-app" true
        sudo chmod 755 /usr/local/bin/mac-uninstall-app
    fi
    if [ -f "$SCRIPT_DIR/applications/mac-app-launcher.desktop" ]; then
        sync_or_update_file "$SCRIPT_DIR/applications/mac-app-launcher.desktop" "/usr/share/applications/mac-app-launcher.desktop" true
        run_as_user xdg-mime default mac-app-launcher.desktop application/x-desktop 2>/dev/null || true
        run_as_user gio mime application/x-desktop mac-app-launcher.desktop 2>/dev/null || true
    fi
    if [ -f "$SCRIPT_DIR/config/gtk-3.0/bookmarks" ]; then
        mkdir -p "$TARGET_HOME/.config/gtk-3.0"
        sync_or_update_file "$SCRIPT_DIR/config/gtk-3.0/bookmarks" "$TARGET_HOME/.config/gtk-3.0/bookmarks" false
    fi
    if [ -f "$SCRIPT_DIR/autostart/mac-sync-applications.desktop" ]; then
        mkdir -p "$TARGET_HOME/.config/autostart"
        sync_or_update_file "$SCRIPT_DIR/autostart/mac-sync-applications.desktop" "$TARGET_HOME/.config/autostart/mac-sync-applications.desktop" false
    fi
    run_as_user /usr/local/bin/mac-sync-applications 2>/dev/null || true

    log_info "8/9 Перевірка Plymouth та GDM переходу..."
    [ -f "$SCRIPT_DIR/etc/gnome-shell/ui/layout.js" ] && sync_or_update_file "$SCRIPT_DIR/etc/gnome-shell/ui/layout.js" "/etc/gnome-shell/ui/layout.js" true
    if [ -d "$SCRIPT_DIR/plymouth/apple-mac" ]; then
        sync_directory_tree "$SCRIPT_DIR/plymouth/apple-mac" "/usr/share/plymouth/themes/apple-mac" true
        if command -v update-alternatives >/dev/null 2>&1; then
            sudo update-alternatives --install /usr/share/plymouth/themes/default.plymouth default.plymouth "/usr/share/plymouth/themes/apple-mac/apple-mac.plymouth" 200 2>/dev/null || true
            sudo update-alternatives --set default.plymouth "/usr/share/plymouth/themes/apple-mac/apple-mac.plymouth" 2>/dev/null || true
        fi
        sudo mkdir -p /etc/plymouth
        sudo tee /etc/plymouth/plymouthd.conf >/dev/null << 'EOF'
[Daemon]
Theme=apple-mac
ShowDelay=0
DeviceTimeout=8
EOF
        sudo update-initramfs -u 2>/dev/null || true
    fi

    log_info "9/9 Перевірка завантажувача GRUB..."
    if [ -d "$SCRIPT_DIR/grub/apple-mac" ]; then
        sync_directory_tree "$SCRIPT_DIR/grub/apple-mac" "/boot/grub/themes/apple-mac" true
    fi
    [ -f "$SCRIPT_DIR/grub/10_linux" ] && sync_or_update_file "$SCRIPT_DIR/grub/10_linux" "/etc/grub.d/10_linux" true
    [ -f "$SCRIPT_DIR/systemd/mac-grub-status.service" ] && sync_or_update_file "$SCRIPT_DIR/systemd/mac-grub-status.service" "/etc/systemd/system/mac-grub-status.service" true

    log_info "Оновлення системних кешів..."
    chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.themes" "$TARGET_HOME/.local/share/fonts" "$TARGET_HOME/.local/share/icons" "$EXT_USER_DIR" "$OVERLAY_DIR" "$LOCAL_BIN" "$LOCAL_LIB" "$APP_DIR" "$SVC_DIR" "$CFG_DIR" 2>/dev/null || true
    
    sudo fc-cache -f >/dev/null 2>&1 || true
    run_as_user fc-cache -f >/dev/null 2>&1 || true
    gtk-update-icon-cache -f -t "$TARGET_HOME/.local/share/icons/macW1Y-dark" 2>/dev/null || true
    run_as_user update-desktop-database "$APP_DIR" 2>/dev/null || true
    
    sudo systemctl daemon-reload 2>/dev/null || true
    sudo systemctl restart mac-touchpad-daemon.service 2>/dev/null || true
    
    # Збереження версії
    save_version "$new_ver"
    
    # Перезавантаження розширення
    run_as_user gnome-extensions disable blur-my-shell@aunetx 2>/dev/null || true
    sleep 1
    run_as_user gnome-extensions enable blur-my-shell@aunetx 2>/dev/null || true
    
    echo -e "\n${C_GREEN}═══════════════════════════════════════════════════════════════════════${C_RESET}"
    echo -e " ${C_BOLD}${C_GREEN}✔ ОНОВЛЕННЯ [v$cur_ver] -> [v$new_ver] УСПІШНО ЗАВЕРШЕНО!${C_RESET}"
    echo -e "${C_GREEN}═══════════════════════════════════════════════════════════════════════${C_RESET}"
    echo -e "   • Змінених / доданих файлів: ${C_BOLD}${C_CYAN}$MODIFIED_COUNT${C_RESET}"
    echo -e "   • Незмінених файлів (актуальних): ${C_BOLD}$UNCHANGED_COUNT${C_RESET}"
    echo -e "   • Поточна версія системи: ${C_BOLD}${C_GREEN}v$new_ver${C_RESET}\n"
}

# 3. Чисте оновлення [на пк версія] -> [нова версія]
# Видаляє ВСІ файли темпаку з ПК до нуля і встановлює все заново
run_clean_update() {
    local cur_ver="$1"
    local new_ver="$2"
    
    if [ -n "$cur_ver" ]; then
        log_step "Чисте оновлення [v$cur_ver] -> [v$new_ver]: Повне видалення ВСІХ файлів темпаку до нуля"
    else
        log_step "Чисте оновлення [v$new_ver]: Видалення залишків темпаку до нуля та чисте встановлення"
    fi
    require_root
    
    log_info "1/3 Тимчасове повернення до стандартної теми Yaru..."
    run_as_user gsettings set org.gnome.desktop.interface gtk-theme "Yaru" 2>/dev/null || true
    run_as_user gsettings set org.gnome.desktop.interface icon-theme "Yaru" 2>/dev/null || true
    run_as_user gsettings set org.gnome.desktop.interface cursor-theme "Yaru" 2>/dev/null || true
    run_as_user gsettings set org.gnome.desktop.wm.preferences theme "Yaru" 2>/dev/null || true
    run_as_user dconf write /org/gnome/shell/extensions/user-theme/name "" 2>/dev/null || true
    
    log_info "2/3 Видалення ВСІХ компонентів macW1Y з ПК до нуля..."
    rm -rf "$TARGET_HOME/.themes/macW1Y-Dark"* "$TARGET_HOME/.themes/MacTahoe"*
    rm -rf "$TARGET_HOME/.local/share/icons/macW1Y-dark"* "$TARGET_HOME/.local/share/icons/MacTahoe"* "$TARGET_HOME/.local/share/icons/apple-cursors"*
    rm -f "$TARGET_HOME/.local/share/icons/hicolor/scalable/apps/control-center"*
    
    rm -rf "$TARGET_HOME/.local/share/fonts/SF_Pro"
    sudo rm -rf "/usr/local/share/fonts/SF_Pro"
    
    rm -rf "$TARGET_HOME/.config/gtk-3.0" "$TARGET_HOME/.config/gtk-4.0"
    
    rm -rf "$TARGET_HOME/.local/share/gnome-control-center-overlay"
    rm -f "$TARGET_HOME/.local/bin/gnome-control-center" "$TARGET_HOME/.local/bin/mac-styling-settings" "$TARGET_HOME/.local/bin/gnome-theme-switcher"
    rm -f "$TARGET_HOME/.local/lib/libmac_settings.so"
    sudo rm -f /usr/local/lib/libmacpopover.so /usr/lib/libmacpopover.so
    rm -f "$TARGET_HOME/.local/share/applications/mac-styling-settings.desktop" "$TARGET_HOME/.local/share/applications/org.gnome.Settings.desktop"
    rm -f "$TARGET_HOME/.local/share/dbus-1/services/org.gnome.Settings.service"
    rm -rf "$TARGET_HOME/.config/mac-styling"
    rm -f "$TARGET_HOME/.config/environment.d/10-mac-theme.conf"
    
    rm -rf "$TARGET_HOME/.local/share/sounds/macOS"
    sudo rm -rf /usr/share/sounds/macOS 2>/dev/null || true
    rm -f "$TARGET_HOME/.config/autostart/macos-login-sound.desktop"
    run_as_user gsettings set org.gnome.desktop.sound theme-name 'Yaru' 2>/dev/null || true

    rm -rf "$TARGET_HOME/.local/share/gnome-shell/extensions/macos-touchpad-gestures@mactheme"
    rm -rf "$TARGET_HOME/.local/share/gnome-shell/extensions/eval-helper@mactheme"
    rm -rf "$TARGET_HOME/.local/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com"
    sudo rm -rf /usr/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com
    
    sudo systemctl stop mac-touchpad-daemon.service 2>/dev/null || true
    sudo systemctl disable mac-touchpad-daemon.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/mac-touchpad-daemon.service /usr/local/bin/mac-touchpad-daemon /etc/mac-touchpad.conf /etc/udev/rules.d/99-uinput.rules
    
    sudo systemctl stop mac-gamemode.service 2>/dev/null || true
    sudo systemctl disable mac-gamemode.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/mac-gamemode.service /usr/local/bin/mac-gamemode /usr/local/bin/gamemoderun /usr/local/bin/nvidia-game-run /usr/local/bin/prime-run /usr/local/bin/mac-clipboard /etc/mac-gamemode.state
    rm -rf "$TARGET_HOME/.cache/mac-clipboard"
    
    sudo rm -f /etc/gnome-shell/ui/layout.js
    
    sudo systemctl stop plymouth-verbose-logger.service 2>/dev/null || true
    sudo systemctl disable plymouth-verbose-logger.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/plymouth-verbose-logger.service /usr/local/bin/plymouth-verbose-logger
    sudo rm -rf /usr/share/plymouth/themes/apple-mac
    
    sudo systemctl stop mac-grub-status.service 2>/dev/null || true
    sudo systemctl disable mac-grub-status.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/mac-grub-status.service
    sudo rm -rf /boot/grub/themes/apple-mac
    
    rm -rf "$TARGET_HOME/.local/share/macW1Y"
    sudo rm -rf /etc/macW1Y
    
    log_success "Усі старі файли темпаку видалено до нуля!"
    
    log_info "3/3 Встановлення чистої версії v$new_ver з нуля..."
    run_full_install
}

# ------------------------------------------------------------------------------
# CLI Аргументи командного рядка
# ------------------------------------------------------------------------------
if [ "$1" = "--install" ] || [ "$1" = "-i" ] || [ "$1" = "--all" ] || [ "$1" = "-y" ] || [ "$1" = "--yes" ]; then
    print_banner
    run_full_install
    exit 0
elif [ "$1" = "--update" ] || [ "$1" = "-u" ]; then
    print_banner
    INSTALLED_VER="$(get_installed_version)"
    run_incremental_update "${INSTALLED_VER:-0.1}" "$NEW_VERSION"
    exit 0
elif [ "$1" = "--clean-update" ] || [ "$1" = "-c" ]; then
    print_banner
    INSTALLED_VER="$(get_installed_version)"
    run_clean_update "$INSTALLED_VER" "$NEW_VERSION"
    exit 0
elif [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Використання: ./install.sh [ОПЦІЇ]"
    echo "  --install, -i, --all    Повне встановлення версії v${NEW_VERSION}"
    echo "  --update, -u            Пофайлове оновлення існуючої версії до v${NEW_VERSION}"
    echo "  --clean-update, -c      Чисте оновлення (повне видалення до нуля + чисте встановлення)"
    echo "  --help, -h              Показати цю довідку"
    exit 0
fi

# ------------------------------------------------------------------------------
# Інтерактивне Меню
# ------------------------------------------------------------------------------
print_banner

INSTALLED_VER="$(get_installed_version)"
CMP_RES=0
if [ -n "$INSTALLED_VER" ]; then
    CMP_RES=$(compare_semver "$INSTALLED_VER" "$NEW_VERSION")
fi

echo -e " ${C_BOLD}Інформація про версію:${C_RESET}"
if [ -n "$INSTALLED_VER" ]; then
    echo -e "   • Встановлена версія на ПК: ${C_BOLD}${C_YELLOW}v$INSTALLED_VER${C_RESET}"
else
    echo -e "   • Встановлена версія на ПК: ${C_BOLD}${C_RED}Не встановлено${C_RESET}"
fi
echo -e "   • Версія інсталятора (пакунку): ${C_BOLD}${C_GREEN}v$NEW_VERSION${C_RESET}\n"

echo -e " ${C_BOLD}Оберіть дію:${C_RESET}\n"

HAS_OPT1=false
HAS_OPT2=false
HAS_OPT3=true

if [ -z "$INSTALLED_VER" ]; then
    # Нічого не встановлено: показуємо пункт 1 і 3
    HAS_OPT1=true
    HAS_OPT2=false
    echo -e "  ${C_GREEN}[1]${C_RESET} ${C_BOLD}Встановлення всього [v${NEW_VERSION}]${C_RESET} (Первинне повне встановлення macW1Y)"
    echo -e "  ${C_YELLOW}[3]${C_RESET} ${C_BOLD}Чисте оновлення / встановлення [v${NEW_VERSION}]${C_RESET} (Видаляє ВСІ залишки темпаку з ПК до нуля та встановлює все заново)"
    echo -e "  ${C_RED}[4]${C_RESET} Вихід з програми\n"
elif [ "$CMP_RES" -eq 2 ]; then
    # Є попередня менша версія (наприклад 0.1 < 0.2): пункт 1 ховаємо, показуємо 2 і 3
    HAS_OPT1=false
    HAS_OPT2=true
    echo -e "  ${C_CYAN}[2]${C_RESET} ${C_BOLD}Оновлення [v${INSTALLED_VER}] -> [v${NEW_VERSION}]${C_RESET} (Перевіряє кожен файл і замінює/додає відсутні чи змінені файли)"
    echo -e "  ${C_YELLOW}[3]${C_RESET} ${C_BOLD}Чисте оновлення [v${INSTALLED_VER}] -> [v${NEW_VERSION}]${C_RESET} (Видаляє ВСІ файли темпаку з ПК до нуля та встановлює все заново)"
    echo -e "  ${C_RED}[4]${C_RESET} Вихід з програми\n"
else
    # Версія збігається або новіша (0.2 == 0.2): показуємо 2 і 3
    HAS_OPT1=false
    HAS_OPT2=true
    echo -e "  ${C_CYAN}[2]${C_RESET} ${C_BOLD}Оновлення / Перевірка цілісності [v${INSTALLED_VER}] -> [v${NEW_VERSION}]${C_RESET} (Перевіряє кожен файл і відновлює відсутні чи пошкоджені файли)"
    echo -e "  ${C_YELLOW}[3]${C_RESET} ${C_BOLD}Чисте оновлення [v${INSTALLED_VER}] -> [v${NEW_VERSION}]${C_RESET} (Видаляє ВСІ файли темпаку з ПК до нуля та встановлює все заново)"
    echo -e "  ${C_RED}[4]${C_RESET} Вихід з програми\n"
fi

read -r -p " Введіть номер варіанту: " CHOICE

case "$CHOICE" in
    1)
        if [ "$HAS_OPT1" = "true" ]; then
            run_full_install
        else
            log_error "Пункт 1 недоступний: на ПК вже встановлено macW1Y v${INSTALLED_VER}. Оберіть [2] для оновлення або [3] для чистого оновлення."
            exit 1
        fi
        ;;
    2)
        if [ "$HAS_OPT2" = "true" ]; then
            run_incremental_update "$INSTALLED_VER" "$NEW_VERSION"
        else
            log_error "Пункт 2 недоступний: на ПК не виявлено попередньої версії. Оберіть [1] для встановлення або [3] для чистого встановлення."
            exit 1
        fi
        ;;
    3)
        run_clean_update "$INSTALLED_VER" "$NEW_VERSION"
        ;;
    4|0)
        echo -e "\nРоботу завершено. Вихід з інсталятора."
        exit 0
        ;;
    *)
        echo -e "\nНевірний вибір. Встановлення скасовано."
        exit 1
        ;;
esac
