#!/usr/bin/env bash
# ==============================================================================
#  macW1Y Transformation Modpack (macW1Y Release)
#  Installer & Maintenance System - Version 0.8
# ==============================================================================

set -e

# Version Constants (loaded dynamically from info.json)
get_project_version() {
    local base_dir="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
    local v=""
    for candidate in "$base_dir/info.json" "$TARGET_HOME/macW1Y/info.json" "$TARGET_HOME/MACTHEMEFILES/info.json" "/usr/share/mactheme/info.json"; do
        if [ -f "$candidate" ]; then
            v=$(grep -Po '"version":\s*"\K[^"]+' "$candidate" 2>/dev/null || sed -n 's/.*"version"[^"]*"\([^"]*\)".*/\1/p' "$candidate" 2>/dev/null)
            if [ -n "$v" ]; then
                echo "$v"
                return 0
            fi
        fi
    done
    echo "0.8"
}
NEW_VERSION="$(get_project_version)"

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

# Ensure target user configuration directories exist with correct permissions
mkdir -p "$TARGET_HOME/.config/dconf" "$TARGET_HOME/.local/share" "$TARGET_HOME/.themes" "$TARGET_HOME/.icons"
chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.config" "$TARGET_HOME/.local" "$TARGET_HOME/.themes" "$TARGET_HOME/.icons" 2>/dev/null || true

# Detect script and assets directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -d "$SCRIPT_DIR/extensions" ]; then
    if [ -d "$TARGET_HOME/macW1Y/extensions" ]; then
        SCRIPT_DIR="$TARGET_HOME/macW1Y"
    elif [ -d "$TARGET_HOME/MACTHEMEFILES/extensions" ]; then
        SCRIPT_DIR="$TARGET_HOME/MACTHEMEFILES"
    fi
fi
NEW_VERSION="$(get_project_version "$SCRIPT_DIR")"

source "$SCRIPT_DIR/dependencies/boot-tools.sh"

show_usage() {
    echo "Usage: ./install.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --install, -i, --all, -y, --yes  Full installation of macW1Y release v${NEW_VERSION}"
    echo "  --update, -u                     Incremental update of existing installation to v${NEW_VERSION}"
    echo "  --clean-update, -c               Clean reinstall (complete removal of old files + fresh install)"
    echo "  -let_me_try_bradar               UI test simulation mode (runs visual interface with 10-second mock install)"
    echo "  --low-spec, --eco, -e            Enable ZRAM and performance optimizations for low-end / Intel HD hardware"
    echo "  --cli, -cli                      Force CLI text mode instead of launching GUI installer"
    echo "  -debug_install, --debug_install  Interactive CLI installation & maintenance menu"
    echo "  --uninstall, -debug_uninstall    Completely uninstall macW1Y and restore original GNOME appearance"
    echo "  --benchmark, -benchmark          Run Liquid Glass GPU performance benchmark"
    echo "  --help, -h, -?                   Show all launch parameters and options"
}

# Early check for help options
for arg in "$@"; do
    if [ "$arg" = "-?" ] || [ "$arg" = "-h" ] || [ "$arg" = "--help" ] || [ "$arg" = "-help" ]; then
        show_usage
        exit 0
    fi
done

# Early check for benchmark mode
if [ "$1" = "--benchmark" ] || [ "$1" = "-benchmark" ]; then
    shift
    if [ "$1" = "--cli" ] || [ "$1" = "-cli" ] || { [ -z "$DISPLAY" ] && [ -z "$WAYLAND_DISPLAY" ]; }; then
        [ "$1" = "--cli" ] || [ "$1" = "-cli" ] && shift
        exec "$SCRIPT_DIR/bin/mac-liquid-benchmark" --cli "$@"
    else
        exec "$SCRIPT_DIR/bin/mac-installer-gui" --benchmark "$@"
    fi
fi

# Low-Spec, Eco Engine and Mock Simulation Detection
APPLY_LOW_SPEC="false"
MOCK_MODE="false"
_CLEANED_ARGS=()
for arg in "$@"; do
    if [ "$arg" = "--low-spec" ] || [ "$arg" = "--eco" ] || [ "$arg" = "-e" ]; then
        APPLY_LOW_SPEC="true"
    elif [ "$arg" = "-let_me_try_bradar" ] || [ "$arg" = "--let_me_try_bradar" ]; then
        MOCK_MODE="true"
    else
        _CLEANED_ARGS+=("$arg")
    fi
done
[ ${#_CLEANED_ARGS[@]} -gt 0 ] && set -- "${_CLEANED_ARGS[@]}" || set --
export APPLY_LOW_SPEC
export MOCK_MODE

# GUI Installer Dispatcher
GUI_WORKER="false"
if [ "$1" = "--gui-worker" ]; then
    GUI_WORKER="true"
    shift
elif [ "$1" = "--cli" ] || [ "$1" = "-cli" ]; then
    shift
    MAC_INSTALLER_CLI="1"
elif [ -z "$MAC_INSTALLER_CLI" ]; then
    if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; then
        if [ -x "$SCRIPT_DIR/bin/mac-installer-gui" ] && command -v python3 >/dev/null 2>&1; then
            if [ "$MOCK_MODE" != "true" ]; then
                python3 "$SCRIPT_DIR/dependencies/check-platform.py" "$SCRIPT_DIR" || exit 1
            fi
            _prep_bar() {
                local cur=$1 tot=$2 msg=$3
                local pct=$(( cur * 100 / tot ))
                local fill=$(( cur * 24 / tot ))
                local empty=$(( 24 - fill ))
                printf "\r  [%-24s] %3d%%  %s" "$(printf '%*s' "$fill" '' | tr ' ' '#')" "$pct" "$msg"
            }
            _dis_exts=("ubuntu-dock@ubuntu.com" "tiling-assistant@ubuntu.com" "ding@rastersoft.com" "dash-to-dock@micxgx.gmail.com" "snapd-prompting@canonical.com" "web-search-provider@ubuntu.com")
            _ena_exts=("user-theme@gnome-shell-extensions.gcampax.github.com" "eval-helper@mactheme" "blur-my-shell@aunetx" "dash2dock-motion@unmade.space" "appmenu@ChathurangaBW.github.io" "kiwi@kemma" "desktop-widgets@r3nhick" "macw1y-touchpad-gestures@mactheme" "compiz-alike-magic-lamp-effect@hermes83.github.com" "cupertino-dock-lite@rinzler69-wastaken.github.com" "custom-command-toggle@storageb.github.com" "liquid-glass@thinkingcoding1231.gmail.com" "quick-settings-scroll@diskmth.fr" "Rounded_Corners@lennart-k" "volume-percentage-quick-settings@imdarktom" "wack-lockscreen-clock@rinzler69-wastaken.github.com" "wifi-hotspot-quick-settings@aryan10.github.io")
            _prep_tot=$(( ${#_dis_exts[@]} + ${#_ena_exts[@]} + 4 ))
            _prep_cur=0
            for ext in "${_dis_exts[@]}"; do
                gnome-extensions disable "$ext" 2>/dev/null || true
                _prep_cur=$(( _prep_cur + 1 ))
                _prep_bar "$_prep_cur" "$_prep_tot" "Підготовка модпаку..."
            done
            for ext in "${_ena_exts[@]}"; do
                gnome-extensions enable "$ext" 2>/dev/null || true
                _prep_cur=$(( _prep_cur + 1 ))
                _prep_bar "$_prep_cur" "$_prep_tot" "Підготовка модпаку..."
            done
            gsettings set org.gnome.shell.extensions.user-theme name "macW1Y-Dark" 2>/dev/null || true; _prep_cur=$(( _prep_cur + 1 )); _prep_bar "$_prep_cur" "$_prep_tot" "Підготовка модпаку..."
            gsettings set org.gnome.desktop.interface gtk-theme "macW1Y-Dark" 2>/dev/null || true; _prep_cur=$(( _prep_cur + 1 )); _prep_bar "$_prep_cur" "$_prep_tot" "Підготовка модпаку..."
            gsettings set org.gnome.desktop.interface icon-theme "macW1Y-dark" 2>/dev/null || true; _prep_cur=$(( _prep_cur + 1 )); _prep_bar "$_prep_cur" "$_prep_tot" "Підготовка модпаку..."
            gsettings set org.gnome.desktop.interface font-name "default 10" 2>/dev/null || true; _prep_cur=$(( _prep_cur + 1 )); _prep_bar "$_prep_cur" "$_prep_tot" "Готово! Запуск інсталятора..."
            printf "\n"
            export MAC_INSTALLER_SCRIPT="$SCRIPT_DIR/install.sh"
            if [ "$MOCK_MODE" = "true" ]; then
                export MAC_MOCK_INSTALLER="1"
                exec "$SCRIPT_DIR/bin/mac-installer-gui" -let_me_try_bradar "$@"
            else
                exec "$SCRIPT_DIR/bin/mac-installer-gui" "$@"
            fi
        fi
    fi
fi

print_banner() {
    [ "$GUI_WORKER" = "true" ] && return 0
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
    if [ "$GUI_WORKER" = "true" ]; then
        case "$1" in
            *"Stage 1/"*) echo "PROGRESS:10:stage1";;
            *"Stage 2/"*) echo "PROGRESS:20:stage2";;
            *"Stage 3/"*) echo "PROGRESS:35:stage3";;
            *"Stage 4/"*) echo "PROGRESS:45:stage4";;
            *"Stage 5/"*) echo "PROGRESS:55:stage5";;
            *"Stage 6/"*) echo "PROGRESS:65:stage6";;
            *"Stage 7/"*) echo "PROGRESS:75:stage7";;
            *"Stage 8/"*) echo "PROGRESS:82:stage8";;
            *"Stage 9/"*) echo "PROGRESS:88:stage9";;
            *"Stage 10/"*) echo "PROGRESS:92:stage10";;
            *"Stage 11/"*) echo "PROGRESS:95:stage11";;
            *"Stage 12/"*) echo "PROGRESS:97:stage12";;
            *"Stage 13/"*) echo "PROGRESS:98:stage13";;
            *"Finalizing"*) echo "PROGRESS:99:finalizing";;
            *) echo "PROGRESS:50:$1";;
        esac
    fi
}

emit_progress() {
    local pct="$1"
    local stage_id="$2"
    local desc="$3"
    if [ "$GUI_WORKER" = "true" ]; then
        echo "PROGRESS:${pct}:${stage_id}"
    elif [ -n "$desc" ]; then
        echo -e "  ${C_CYAN}[${pct}%]${C_RESET} ${desc}..."
    fi
}

run_as_user() {
    if [ "$TARGET_USER" != "$USER" ]; then
        sudo -u "$TARGET_USER" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${TARGET_UID}/bus" "$@"
    else
        if [ -z "$DBUS_SESSION_BUS_ADDRESS" ] && [ -S "/run/user/${TARGET_UID}/bus" ]; then
            DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${TARGET_UID}/bus" "$@"
        else
            "$@"
        fi
    fi
}

require_root() {
    if [ "$EUID" -ne 0 ]; then
        if sudo -n true 2>/dev/null; then
            return 0
        fi
        log_info "Administrator privileges (sudo) are required to apply system settings."
        sudo -v || { log_error "Failed to acquire sudo privileges. Exiting."; exit 1; }
    fi
}

# ------------------------------------------------------------------------------
# Version Detection & Comparison
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

    # Experimental detection of pre-installed version
    if [ -d "$TARGET_HOME/.themes/macW1Y-Dark" ] || \
       [ -d "$TARGET_HOME/.icons/macW1Y-dark" ] || \
       [ -f "$TARGET_HOME/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/components/menubar_v29.js" ] || \
       [ -f "/etc/systemd/system/mac-touchpad-daemon.service" ] || \
       [ -d "/boot/grub/themes/macw1y-boot" ]; then
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
    echo "1" > "$TARGET_HOME/.local/share/macW1Y/macSetupWizard"
    echo "1" > "$TARGET_HOME/.config/mac-styling/macSetupWizard"
    if [ -f "$SCRIPT_DIR/info.json" ]; then
        cp -f "$SCRIPT_DIR/info.json" "$TARGET_HOME/.local/share/macW1Y/info.json" 2>/dev/null || true
        cp -f "$SCRIPT_DIR/info.json" "$TARGET_HOME/.config/mac-styling/info.json" 2>/dev/null || true
    fi
    chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.local/share/macW1Y" "$TARGET_HOME/.config/mac-styling" 2>/dev/null || true
    
    if [ -w "/etc" ] || [ "$EUID" -eq 0 ] || sudo -n true 2>/dev/null; then
        sudo mkdir -p /etc/macW1Y /usr/share/mactheme
        echo "$ver" | sudo tee /etc/macW1Y/version >/dev/null
        echo "1" | sudo tee /etc/macW1Y/macSetupWizard >/dev/null
        if [ -f "$SCRIPT_DIR/info.json" ]; then
            sudo install -Dm644 "$SCRIPT_DIR/info.json" /usr/share/mactheme/info.json 2>/dev/null || true
            sudo install -Dm644 "$SCRIPT_DIR/info.json" /etc/macW1Y/info.json 2>/dev/null || true
        fi
    fi
}

# Semantic version comparison (x.y / x.y.z):
# returns: 0 if v1 == v2, 1 if v1 > v2, 2 if v1 < v2
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
# File synchronizer helper functions
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
            sudo chown root:root "$dest_dir" 2>/dev/null || true
        else
            mkdir -p "$dest_dir"
        fi
    fi
    
    if [ ! -e "$dest" ] && [ ! -L "$dest" ]; then
        echo -e "   ${C_GREEN}[+] Added new file:${C_RESET} $dest"
        if [ "$use_sudo" = "true" ]; then
            sudo cp -f "$src" "$dest"
            sudo chown root:root "$dest" 2>/dev/null || true
            if [ -x "$src" ]; then
                sudo chmod 755 "$dest" 2>/dev/null || true
            else
                sudo chmod 644 "$dest" 2>/dev/null || true
            fi
        else
            cp -a "$src" "$dest"
        fi
        MODIFIED_COUNT=$((MODIFIED_COUNT + 1))
    elif [ -L "$src" ]; then
        local src_tgt dest_tgt
        src_tgt="$(readlink "$src")"
        dest_tgt="$(readlink "$dest" 2>/dev/null || true)"
        if [ "$src_tgt" != "$dest_tgt" ]; then
            echo -e "   ${C_CYAN}[~] Updated symlink:${C_RESET} $dest"
            if [ "$use_sudo" = "true" ]; then
                sudo rm -f "$dest"
                sudo cp -P "$src" "$dest"
                sudo chown -h root:root "$dest" 2>/dev/null || true
            else
                rm -f "$dest"
                cp -P "$src" "$dest"
            fi
            MODIFIED_COUNT=$((MODIFIED_COUNT + 1))
        else
            UNCHANGED_COUNT=$((UNCHANGED_COUNT + 1))
        fi
    elif [ -f "$src" ] && [ -f "$dest" ]; then
        if ! cmp -s "$src" "$dest"; then
            echo -e "   ${C_CYAN}[~] Updated modified file:${C_RESET} $dest"
            if [ "$use_sudo" = "true" ]; then
                sudo cp -f "$src" "$dest"
                sudo chown root:root "$dest" 2>/dev/null || true
                if [ -x "$src" ]; then
                    sudo chmod 755 "$dest" 2>/dev/null || true
                else
                    sudo chmod 644 "$dest" 2>/dev/null || true
                fi
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
        sudo chown root:root "$dest_dir" 2>/dev/null || true
    else
        mkdir -p "$dest_dir"
    fi
    
    if command -v rsync >/dev/null 2>&1; then
        local RSYNC_CMD=("rsync" "-a" "-c" "--itemize-changes")
        if [ "$use_sudo" = "true" ]; then
            RSYNC_CMD+=("--no-owner" "--no-group" "--chown=root:root")
        fi
        RSYNC_CMD+=("$src_dir/" "$dest_dir/")
        local OUT
        if [ "$use_sudo" = "true" ]; then
            OUT=$(sudo "${RSYNC_CMD[@]}" 2>/dev/null || true)
            sudo chown -R root:root "$dest_dir" 2>/dev/null || true
        else
            OUT=$("${RSYNC_CMD[@]}" 2>/dev/null || true)
        fi
        
        while IFS= read -r line; do
            [ -z "$line" ] && continue
            local change="${line:0:11}"
            local item="${line:12}"
            [ "$item" = "." ] && continue
            
            if [[ "$change" =~ ^\>f\+{9} ]]; then
                echo -e "   ${C_GREEN}[+] Added new file:${C_RESET} $dest_dir/$item"
                MODIFIED_COUNT=$((MODIFIED_COUNT + 1))
            elif [[ "$change" =~ ^\>f ]] || [[ "$change" =~ ^cL ]]; then
                echo -e "   ${C_CYAN}[~] Updated file:${C_RESET} $dest_dir/$item"
                MODIFIED_COUNT=$((MODIFIED_COUNT + 1))
            fi
        done <<< "$OUT"
    else
        while IFS= read -r -d "" src_file; do
            local rel_path="${src_file#$src_dir/}"
            local target_file="$dest_dir/$rel_path"
            sync_or_update_file "$src_file" "$target_file" "$use_sudo"
        done < <(find "$src_dir" -type f -print0)
        if [ "$use_sudo" = "true" ]; then
            sudo chown -R root:root "$dest_dir" 2>/dev/null || true
        fi
    fi
}

# ------------------------------------------------------------------------------
# Distribution and System Library Path Detection
# ------------------------------------------------------------------------------
detect_distro_and_paths() {
    DISTRO_ID="unknown"
    DISTRO_FAMILY="unknown"
    DISTRO_NAME="Linux"

    if [ -f "/etc/os-release" ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        DISTRO_ID="${ID:-unknown}"
        DISTRO_NAME="${PRETTY_NAME:-$NAME}"

        if [[ "$ID" =~ ^(ubuntu|debian|pop|linuxmint|elementary|neon|zorin)$ ]] || [[ "$ID_LIKE" =~ (ubuntu|debian) ]]; then
            DISTRO_FAMILY="debian"
        elif [[ "$ID" =~ ^(fedora|rhel|centos|rocky|almalinux|nobara)$ ]] || [[ "$ID_LIKE" =~ (fedora|rhel) ]]; then
            DISTRO_FAMILY="fedora"
        elif [[ "$ID" =~ ^(arch|cachyos|manjaro|endeavouros|garuda)$ ]] || [[ "$ID_LIKE" =~ (arch) ]]; then
            DISTRO_FAMILY="arch"
        fi
    fi

    if [ "$DISTRO_FAMILY" = "unknown" ]; then
        if command -v apt-get >/dev/null 2>&1; then
            DISTRO_FAMILY="debian"
        elif command -v dnf >/dev/null 2>&1; then
            DISTRO_FAMILY="fedora"
        elif command -v pacman >/dev/null 2>&1; then
            DISTRO_FAMILY="arch"
        fi
    fi

    SYS_LIB_DIR="/usr/lib"
    local multiarch
    multiarch=$(gcc -print-multiarch 2>/dev/null || true)
    if [ -n "$multiarch" ] && [ -d "/usr/lib/$multiarch" ]; then
        SYS_LIB_DIR="/usr/lib/$multiarch"
    elif [ -d "/usr/lib64" ]; then
        SYS_LIB_DIR="/usr/lib64"
    fi
    export DISTRO_ID DISTRO_FAMILY DISTRO_NAME SYS_LIB_DIR
}
detect_distro_and_paths

install_app_wrapper() {
    local app="$1"
    local executable="/usr/bin/$app"
    if [ -f "$executable.orig" ] && { [ ! -e "$executable" ] || { grep -Iq . "$executable" && grep -Eq 'find_mac_lib\(\)|/usr/bin/[^ ]+\.orig' "$executable"; }; }; then
        sudo install -m 755 "$executable.orig" "$executable"
    fi
    sudo install -Dm755 "$SCRIPT_DIR/bin/$app" "/usr/local/bin/$app"
}

install_mac_shared_lib() {
    local src="$1"
    local filename
    filename="$(basename "$src")"

    sync_or_update_file "$src" "$SYS_LIB_DIR/$filename" true
    sudo chmod 755 "$SYS_LIB_DIR/$filename" 2>/dev/null || true

    sync_or_update_file "$src" "/usr/local/lib/$filename" true
    sudo chmod 755 "/usr/local/lib/$filename" 2>/dev/null || true
    if [ "$SYS_LIB_DIR" != "/usr/lib" ]; then
        sync_or_update_file "$src" "/usr/lib/$filename" true
        sudo chmod 755 "/usr/lib/$filename" 2>/dev/null || true
    fi
    if [ -d "/usr/lib64" ] && [ "$SYS_LIB_DIR" != "/usr/lib64" ]; then
        sync_or_update_file "$src" "/usr/lib64/$filename" true
        sudo chmod 755 "/usr/lib64/$filename" 2>/dev/null || true
    fi
}

install_mac_typelib() {
    local src="$1"
    local filename
    filename="$(basename "$src")"

    sudo mkdir -p "$SYS_LIB_DIR/girepository-1.0" /usr/lib/girepository-1.0
    sync_or_update_file "$src" "$SYS_LIB_DIR/girepository-1.0/$filename" true
    sudo chmod 644 "$SYS_LIB_DIR/girepository-1.0/$filename" 2>/dev/null || true
    if [ "$SYS_LIB_DIR" != "/usr/lib" ]; then
        sync_or_update_file "$src" "/usr/lib/girepository-1.0/$filename" true
        sudo chmod 644 "/usr/lib/girepository-1.0/$filename" 2>/dev/null || true
    fi
}

install_nautilus_extension() {
    local src="$1"
    local filename
    filename="$(basename "$src")"

    sudo mkdir -p "$SYS_LIB_DIR/nautilus/extensions-4" /usr/lib/nautilus/extensions-4 /usr/lib64/nautilus/extensions-4
    sync_or_update_file "$src" "$SYS_LIB_DIR/nautilus/extensions-4/$filename" true
    sudo chmod 755 "$SYS_LIB_DIR/nautilus/extensions-4/$filename" 2>/dev/null || true
    if [ "$SYS_LIB_DIR" != "/usr/lib" ]; then
        sync_or_update_file "$src" "/usr/lib/nautilus/extensions-4/$filename" true
        sudo chmod 755 "/usr/lib/nautilus/extensions-4/$filename" 2>/dev/null || true
    fi
}

# ------------------------------------------------------------------------------
# 1. Dependencies
# ------------------------------------------------------------------------------
install_dependencies() {
    log_step "Stage 1/13: Installing system dependencies"
    require_root

    detect_distro_and_paths
    log_info "Detected OS: $DISTRO_NAME ($DISTRO_FAMILY family, libdir: $SYS_LIB_DIR)"

    bash "$SCRIPT_DIR/dependencies/install-deps.sh"

    if ! command -v opendrop &>/dev/null; then
        log_info "Installing macW1Y AirDrop utility (opendrop)..."
        pip3 install --break-system-packages opendrop 2>/dev/null || true
    fi

    if [ ! -f "$SYS_LIB_DIR/girepository-1.0/Blur-1.0.typelib" ] && [ ! -f "/usr/lib/girepository-1.0/Blur-1.0.typelib" ]; then
        log_info "Building and installing gnome-rounded-blur library for hardware-accelerated rounded blur..."
        local BUILD_TMP
        BUILD_TMP="$(mktemp -d /tmp/gnome-rounded-blur.XXXXXX)"
        if git clone --depth 1 https://github.com/kancko/gnome-rounded-blur "$BUILD_TMP" 2>/dev/null; then
            (
                cd "$BUILD_TMP"
                meson setup build --prefix=/usr 2>/dev/null || true
                meson compile -C build 2>/dev/null || true
                sudo meson install -C build 2>/dev/null || true
                sudo mkdir -p /usr/lib/girepository-1.0 "$SYS_LIB_DIR/girepository-1.0"
                if [ -f "$SYS_LIB_DIR/girepository-1.0/Blur-1.0.typelib" ]; then
                    sudo cp -f "$SYS_LIB_DIR/girepository-1.0/Blur-1.0.typelib" /usr/lib/girepository-1.0/ 2>/dev/null || true
                elif [ -f "/usr/lib/girepository-1.0/Blur-1.0.typelib" ]; then
                    sudo cp -f "/usr/lib/girepository-1.0/Blur-1.0.typelib" "$SYS_LIB_DIR/girepository-1.0/" 2>/dev/null || true
                fi
                for mdir in "$SYS_LIB_DIR"/mutter-* /usr/lib64/mutter-* /usr/lib/mutter-*; do
                    if [ -d "$mdir" ]; then
                        echo "$mdir" | sudo tee /etc/ld.so.conf.d/mutter-macw1y.conf >/dev/null 2>&1 || true
                        break
                    fi
                done
                sudo ldconfig 2>/dev/null || true
            )
            rm -rf "$BUILD_TMP"
            log_success "gnome-rounded-blur library installed successfully!"
        else
            rm -rf "$BUILD_TMP"
        fi
    fi
}

# ------------------------------------------------------------------------------
# 2. Default Typography & Open Runde Fonts
# ------------------------------------------------------------------------------
install_fonts() {
    log_step "Stage 2/13: Installing Default typography and Open Runde fonts"
    local USER_FONT_DIR="$TARGET_HOME/.local/share/fonts/default"
    local SYS_FONT_DIR="/usr/local/share/fonts/default"
    
    mkdir -p "$USER_FONT_DIR"
    if [ -d "$SCRIPT_DIR/fonts/default" ]; then
        cp -r "$SCRIPT_DIR/fonts/default/"* "$USER_FONT_DIR/" 2>/dev/null || true
        chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.local/share/fonts"
        
        require_root
        sudo mkdir -p "$SYS_FONT_DIR"
        sudo cp -r "$SCRIPT_DIR/fonts/default/"* "$SYS_FONT_DIR/" 2>/dev/null || true
    fi

    if [ -d "$SCRIPT_DIR/fonts/Open_Runde" ]; then
        mkdir -p "$TARGET_HOME/.local/share/fonts/Open_Runde"
        cp -r "$SCRIPT_DIR/fonts/Open_Runde/"* "$TARGET_HOME/.local/share/fonts/Open_Runde/" 2>/dev/null || true
        require_root
        sudo mkdir -p "/usr/local/share/fonts/Open_Runde" "/usr/share/fonts/opentype/Open_Runde"
        sudo cp -r "$SCRIPT_DIR/fonts/Open_Runde/"* "/usr/local/share/fonts/Open_Runde/" 2>/dev/null || true
        sudo cp -r "$SCRIPT_DIR/fonts/Open_Runde/"* "/usr/share/fonts/opentype/Open_Runde/" 2>/dev/null || true
    fi

    # Fontconfig rules
    if [ -f "$SCRIPT_DIR/config/fonts.conf" ]; then
        mkdir -p "$TARGET_HOME/.config/fontconfig/conf.d"
        cp -f "$SCRIPT_DIR/config/fonts.conf" "$TARGET_HOME/.config/fontconfig/conf.d/50-macw1y-fonts.conf" 2>/dev/null || true
        require_root
        sudo mkdir -p /etc/fonts/conf.d
        sudo cp -f "$SCRIPT_DIR/config/fonts.conf" /etc/fonts/conf.d/50-macw1y-fonts.conf 2>/dev/null || true
    fi

    sudo fc-cache -f >/dev/null 2>&1 || true
    run_as_user fc-cache -f >/dev/null 2>&1 || true

    # Force apply default font to user environment
    run_as_user gsettings set org.gnome.desktop.interface font-name "default 10" 2>/dev/null || true
    run_as_user gsettings set org.gnome.desktop.interface document-font-name "default 10" 2>/dev/null || true
    run_as_user gsettings set org.gnome.desktop.interface monospace-font-name "DefaultMono 10" 2>/dev/null || true

    log_success "Default typography deployed and font cache updated successfully!"
}

# ------------------------------------------------------------------------------
# 3. Themes (GTK3, GTK4, GNOME Shell)
# ------------------------------------------------------------------------------
backup_original_user_themes() {
    local backup_file="$TARGET_HOME/.config/mac-styling/backup_theme_state.conf"
    if [ ! -f "$backup_file" ]; then
        mkdir -p "$TARGET_HOME/.config/mac-styling"
        local orig_gtk orig_icon orig_cursor orig_wm orig_buttons orig_sound orig_sys_cursor
        orig_gtk=$(run_as_user gsettings get org.gnome.desktop.interface gtk-theme 2>/dev/null | tr -d "'")
        orig_icon=$(run_as_user gsettings get org.gnome.desktop.interface icon-theme 2>/dev/null | tr -d "'")
        orig_cursor=$(run_as_user gsettings get org.gnome.desktop.interface cursor-theme 2>/dev/null | tr -d "'")
        orig_wm=$(run_as_user gsettings get org.gnome.desktop.wm.preferences theme 2>/dev/null | tr -d "'")
        orig_buttons=$(run_as_user gsettings get org.gnome.desktop.wm.preferences button-layout 2>/dev/null | tr -d "'")
        orig_sound=$(run_as_user gsettings get org.gnome.desktop.sound theme-name 2>/dev/null | tr -d "'")
        orig_sys_cursor=""
        if [ -f /usr/share/icons/default/index.theme ]; then
            orig_sys_cursor=$(grep "^Inherits=" /usr/share/icons/default/index.theme 2>/dev/null | cut -d= -f2 | tr -d '\r')
        fi

        local fallback_theme="Adwaita"
        local fallback_cursor="Adwaita"
        if [ "$DISTRO_ID" = "ubuntu" ]; then
            fallback_theme="Yaru"
            fallback_cursor="Yaru"
        fi

        [ -z "$orig_gtk" ] || [[ "$orig_gtk" =~ macW1Y ]] && orig_gtk="$fallback_theme"
        [ -z "$orig_icon" ] || [[ "$orig_icon" =~ macW1Y ]] && orig_icon="$fallback_theme"
        [ -z "$orig_cursor" ] || [[ "$orig_cursor" =~ macW1Y ]] && orig_cursor="$fallback_cursor"
        [ -z "$orig_wm" ] || [[ "$orig_wm" =~ macW1Y ]] && orig_wm="$fallback_theme"
        [ -z "$orig_sys_cursor" ] || [[ "$orig_sys_cursor" =~ macW1Y ]] && orig_sys_cursor="$fallback_cursor"

        cat << EOF_THEME_BACKUP > "$backup_file"
ORIG_GTK="$orig_gtk"
ORIG_ICON="$orig_icon"
ORIG_CURSOR="$orig_cursor"
ORIG_WM="$orig_wm"
ORIG_BUTTONS="$orig_buttons"
ORIG_SOUND="$orig_sound"
ORIG_SYS_CURSOR="$orig_sys_cursor"
EOF_THEME_BACKUP
        chown "${TARGET_USER}:${TARGET_USER}" "$backup_file" 2>/dev/null || true
    fi
}

install_themes() {
    log_step "Stage 3/13: Installing macW1Y themes (GTK3, GTK4, Shell)"
    backup_original_user_themes
    local THEMES_DIR="$TARGET_HOME/.themes"
    mkdir -p "$THEMES_DIR"
    
    if [ -d "$SCRIPT_DIR/macW1Y-Dark" ]; then
        cp -r "$SCRIPT_DIR/macW1Y-Dark" "$THEMES_DIR/"
        [ -d "$SCRIPT_DIR/macW1Y-Dark-solid" ] && cp -r "$SCRIPT_DIR/macW1Y-Dark-solid" "$THEMES_DIR/"
        ln -sfn "macW1Y-Dark" "$THEMES_DIR/macW1Y-Dark"
        ln -sfn "macW1Y-Dark-solid" "$THEMES_DIR/macW1Y-Dark-solid"
        sudo mkdir -p /usr/share/themes
        sudo cp -rf "$SCRIPT_DIR/macW1Y-Dark" /usr/share/themes/
        [ -d "$SCRIPT_DIR/macW1Y-Dark-solid" ] && sudo cp -rf "$SCRIPT_DIR/macW1Y-Dark-solid" /usr/share/themes/
        sudo ln -sfn macW1Y-Dark /usr/share/themes/macW1Y-Dark
        sudo ln -sfn macW1Y-Dark /usr/share/themes/macW1Y
        sudo chmod -R a+rX /usr/share/themes/macW1Y* /usr/share/themes/macW1Y* 2>/dev/null || true
        log_success "Themes copied to ~/.themes/ and /usr/share/themes/"
    fi
    
    mkdir -p "$TARGET_HOME/.config/gtk-3.0" "$TARGET_HOME/.config/gtk-4.0"
    if [ -f "$SCRIPT_DIR/bin/mac-build-theme" ]; then
        python3 "$SCRIPT_DIR/bin/mac-build-theme" || true
    fi
    [ -d "$SCRIPT_DIR/gtk-3.0" ] && cp -r "$SCRIPT_DIR/gtk-3.0/"* "$TARGET_HOME/.config/gtk-3.0/"
    [ -d "$SCRIPT_DIR/gtk-4.0" ] && cp -r "$SCRIPT_DIR/gtk-4.0/"* "$TARGET_HOME/.config/gtk-4.0/"
    (cd "$TARGET_HOME/.config/gtk-4.0" && ln -sfn gtk-Dark.css gtk-dark.css 2>/dev/null || true)
    sed -i "s|/home/vitaliy|$TARGET_HOME|g" "$TARGET_HOME/.config/gtk-3.0/gtk.css" "$TARGET_HOME/.config/gtk-4.0/gtk.css" "$TARGET_HOME/.config/gtk-4.0/gtk-Dark.css" 2>/dev/null || true
    chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.config/gtk-3.0" "$TARGET_HOME/.config/gtk-4.0"
    
    if [ -d "$SCRIPT_DIR/gnome-shell-theme" ]; then
        mkdir -p "$THEMES_DIR/macW1Y-Dark/gnome-shell"
        cp -r "$SCRIPT_DIR/gnome-shell-theme/"* "$THEMES_DIR/macW1Y-Dark/gnome-shell/"
    fi
    
    if [ -f "$SCRIPT_DIR/lib/libmacpopover.so" ]; then
        install_mac_shared_lib "$SCRIPT_DIR/lib/libmacpopover.so"
        rm -f "$TARGET_HOME/.config/environment.d/10-mac-theme.conf" 2>/dev/null || true
        sudo sed -i "/libmacpopover.so/d" /etc/environment 2>/dev/null || true
    fi

    if [ -f "$SCRIPT_DIR/lib/libmac_terminal.so" ]; then
        install_mac_shared_lib "$SCRIPT_DIR/lib/libmac_terminal.so"
    fi
    if [ -f "$SCRIPT_DIR/bin/ptyxis" ]; then
        sudo cp -f "$SCRIPT_DIR/bin/ptyxis" /usr/local/bin/ptyxis
        sudo chmod 755 /usr/local/bin/ptyxis
    fi

    if [ -f "$SCRIPT_DIR/lib/libmac_memtrim.so" ]; then
        install_mac_shared_lib "$SCRIPT_DIR/lib/libmac_memtrim.so"
    fi
    if [ -f "$SCRIPT_DIR/lib/MacMemTrim-1.0.typelib" ]; then
        install_mac_typelib "$SCRIPT_DIR/lib/MacMemTrim-1.0.typelib"
    fi
    
    # Configuring macW1Y Nautilus Finder Sidebar and Applications section
    log_info "Installing macW1Y Nautilus Finder Sidebar and extensions..."
    if [ -f "$SCRIPT_DIR/lib/libmac_nautilus.so" ]; then
        install_mac_shared_lib "$SCRIPT_DIR/lib/libmac_nautilus.so"
    fi
    if [ -f "$SCRIPT_DIR/lib/libmac_nautilus_menu.so" ]; then
        install_nautilus_extension "$SCRIPT_DIR/lib/libmac_nautilus_menu.so"
    fi
    install_app_wrapper nautilus

    if [ -f "$SCRIPT_DIR/bin/mac-sync-applications" ]; then
        sudo cp -f "$SCRIPT_DIR/bin/mac-sync-applications" /usr/local/bin/mac-sync-applications
        sudo chmod 755 /usr/local/bin/mac-sync-applications
    fi
    if [ -f "$SCRIPT_DIR/bin/mac-icon-normalizer" ]; then
        sudo cp -f "$SCRIPT_DIR/bin/mac-icon-normalizer" /usr/local/bin/mac-icon-normalizer
        sudo chmod 755 /usr/local/bin/mac-icon-normalizer
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
    if [ -f "$SCRIPT_DIR/applications/wine.desktop" ]; then
        sudo cp -f "$SCRIPT_DIR/applications/wine.desktop" /usr/share/applications/wine.desktop
        for mt in application/x-ms-dos-executable application/x-msdownload application/x-msi application/x-bat application/vnd.microsoft.portable-executable; do
            run_as_user xdg-mime default wine.desktop "$mt" 2>/dev/null || true
            run_as_user gio mime "$mt" wine.desktop 2>/dev/null || true
        done
    fi
    if [ -f "/usr/share/applications/winetricks.desktop" ]; then
        if ! grep -q "NoDisplay=true" /usr/share/applications/winetricks.desktop; then
            sudo sed -i '/^\[Desktop Entry\]/a NoDisplay=true' /usr/share/applications/winetricks.desktop 2>/dev/null || true
        fi
    fi
    if [ -f "$SCRIPT_DIR/bin/mac-generate-bookmarks.sh" ]; then
        sudo cp -f "$SCRIPT_DIR/bin/mac-generate-bookmarks.sh" /usr/local/bin/mac-generate-bookmarks.sh
        sudo chmod 755 /usr/local/bin/mac-generate-bookmarks.sh
        run_as_user /usr/local/bin/mac-generate-bookmarks.sh "$TARGET_USER" "$TARGET_HOME"
    fi
    # Clean up redundant legacy autostart entries (handled by systemd user services & /etc/xdg/autostart)
    rm -f "$TARGET_HOME/.config/autostart/mac-sync-applications.desktop" 2>/dev/null || true
    rm -f "$TARGET_HOME/.config/autostart/mac-ensure-extensions.desktop" 2>/dev/null || true

    # Suppress xdg-user-dirs-gtk prompt on locale change (macW1Y directory structure preservation)
    mkdir -p "$TARGET_HOME/.config/autostart"
    cat << 'EOF_UDIRS' > "$TARGET_HOME/.config/autostart/user-dirs-update-gtk.desktop"
[Desktop Entry]
Type=Application
Name=User folders update
Exec=true
Hidden=true
X-GNOME-Autostart-enabled=false
EOF_UDIRS
    echo "enabled=False" > "$TARGET_HOME/.config/user-dirs.conf"
    chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.config/autostart/user-dirs-update-gtk.desktop" "$TARGET_HOME/.config/user-dirs.conf" 2>/dev/null || true

    run_as_user gsettings set org.gnome.desktop.interface gtk-theme "macW1Y-Dark" 2>/dev/null || true
    run_as_user gsettings set org.gnome.desktop.interface color-scheme "prefer-dark" 2>/dev/null || true
    run_as_user gsettings set org.gnome.desktop.wm.preferences theme "macW1Y-Dark" 2>/dev/null || true
    run_as_user gsettings set org.gnome.desktop.wm.preferences button-layout "close,minimize,maximize:" 2>/dev/null || true

    # Synchronizing window styles and control buttons for Snap applications
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
    log_success "UI themes activated successfully!"
}

# ------------------------------------------------------------------------------
# 4. Icons and Assets
# ------------------------------------------------------------------------------
install_icons() {
    log_step "Stage 4/13: Installing macW1Y and Control Center icons"
    local ICONS_DIR="$TARGET_HOME/.local/share/icons"
    mkdir -p "$ICONS_DIR" "$ICONS_DIR/hicolor/scalable/apps"
    
    for theme_dir in macW1Y macW1Y-dark macW1Y-light; do
        if [ -d "$SCRIPT_DIR/icons/$theme_dir" ]; then
            rm -rf "$ICONS_DIR/$theme_dir"
            if command -v rsync >/dev/null 2>&1; then
                mkdir -p "$ICONS_DIR/$theme_dir"
                rsync -a --force "$SCRIPT_DIR/icons/$theme_dir/" "$ICONS_DIR/$theme_dir/"
            else
                cp -r "$SCRIPT_DIR/icons/$theme_dir" "$ICONS_DIR/"
            fi
        fi
    done
    
    # Creating compatibility symlinks macW1Y-dark -> macW1Y-dark, macW1Y-Dark -> macW1Y-dark and macW1Y -> macW1Y
    ln -sfn "macW1Y-dark" "$ICONS_DIR/macW1Y-dark"
    ln -sfn "macW1Y-dark" "$ICONS_DIR/macW1Y-Dark"
    ln -sfn "macW1Y" "$ICONS_DIR/macW1Y"
    mkdir -p "$TARGET_HOME/.icons" "$ICONS_DIR/default" "$TARGET_HOME/.icons/default"
    ln -sfn "$ICONS_DIR/macW1Y" "$TARGET_HOME/.icons/macW1Y"
    ln -sfn "$ICONS_DIR/macW1Y" "$TARGET_HOME/.icons/macW1Y"
    ln -sfn "$ICONS_DIR/macW1Y-dark" "$TARGET_HOME/.icons/macW1Y-dark"
    ln -sfn "$ICONS_DIR/macW1Y-dark" "$TARGET_HOME/.icons/macW1Y-Dark"
    ln -sfn "$ICONS_DIR/macW1Y-dark" "$TARGET_HOME/.icons/macW1Y-dark"

    # User-level default cursor theme fallback
    cat << 'EOF_DEF_THEME' > "$ICONS_DIR/default/index.theme"
[Icon Theme]
Name=Default
Comment=Default Cursor Theme
Inherits=macW1Y
EOF_DEF_THEME
    cp -f "$ICONS_DIR/default/index.theme" "$TARGET_HOME/.icons/default/index.theme"
    cat << 'EOF_CUR_THEME' > "$ICONS_DIR/macW1Y/cursor.theme"
[Icon Theme]
Name=macW1Y
Comment=macW1Y macW1Y Cursor Theme
Inherits=macW1Y
EOF_CUR_THEME

    if [ -w "/usr/share/icons" ] || sudo -n true 2>/dev/null; then
        sudo ln -sfn "$ICONS_DIR/macW1Y" /usr/share/icons/macW1Y
        sudo ln -sfn "$ICONS_DIR/macW1Y" /usr/share/icons/macW1Y
        if command -v update-alternatives >/dev/null 2>&1; then
            sudo update-alternatives --install /usr/share/icons/default/index.theme x-cursor-theme "$ICONS_DIR/macW1Y/cursor.theme" 100 2>/dev/null || true
            sudo update-alternatives --set x-cursor-theme "$ICONS_DIR/macW1Y/cursor.theme" 2>/dev/null || true
        else
            sudo mkdir -p /usr/share/icons/default
            printf '[Icon Theme]\nInherits=macW1Y\n' | sudo tee /usr/share/icons/default/index.theme >/dev/null 2>&1 || true
        fi
    fi
    
    # System Control Center icons (user-independent and protected from removal)
    sudo mkdir -p /usr/share/mactheme/icons /usr/share/icons/hicolor/scalable/status
    if [ -d "$SCRIPT_DIR/assets/icons" ]; then
        sudo cp -f "$SCRIPT_DIR/assets/icons"/* /usr/share/mactheme/icons/ 2>/dev/null || true
        sudo chmod 644 /usr/share/mactheme/icons/* 2>/dev/null || true
        if [ -f "$SCRIPT_DIR/assets/icons/control-center-symbolic.svg" ]; then
            sudo cp -f "$SCRIPT_DIR/assets/icons/control-center-symbolic.svg" /usr/share/icons/hicolor/scalable/status/ 2>/dev/null || true
        fi
    fi
    
    [ -f "$SCRIPT_DIR/assets/icons/controlcenter.png" ] && cp "$SCRIPT_DIR/assets/icons/controlcenter.png" "$ICONS_DIR/hicolor/scalable/apps/" 2>/dev/null || true
    [ -f "$SCRIPT_DIR/assets/icons/controlcenter-dark.png" ] && cp "$SCRIPT_DIR/assets/icons/controlcenter-dark.png" "$ICONS_DIR/hicolor/scalable/apps/" 2>/dev/null || true
    [ -f "$SCRIPT_DIR/assets/icons/control-center-symbolic.svg" ] && cp "$SCRIPT_DIR/assets/icons/control-center-symbolic.svg" "$ICONS_DIR/hicolor/scalable/apps/" 2>/dev/null || true
    
    chown -R "${TARGET_USER}:${TARGET_USER}" "$ICONS_DIR"
    gtk-update-icon-cache -f -t "$ICONS_DIR/macW1Y" 2>/dev/null || true
    gtk-update-icon-cache -f -t "$ICONS_DIR/macW1Y-dark" 2>/dev/null || true
    gtk-update-icon-cache -f -t "$ICONS_DIR/macW1Y-light" 2>/dev/null || true
    gtk-update-icon-cache -f -t "$ICONS_DIR/hicolor" 2>/dev/null || true
    
    run_as_user gsettings set org.gnome.desktop.interface icon-theme "macW1Y-dark" 2>/dev/null || true
    run_as_user /usr/local/bin/mac-icon-normalizer 2>/dev/null || true
    run_as_user /usr/local/bin/mac-sync-applications 2>/dev/null || true
    log_success "macW1Y icon theme activated!"
}

# ------------------------------------------------------------------------------
# 5. System Sounds (macW1Y Sound Theme)
# ------------------------------------------------------------------------------
install_sounds() {
    log_step "Stage 5/13: Installing macW1Y sound theme"
    local SOUNDS_DIR="$TARGET_HOME/.local/share/sounds"
    mkdir -p "$SOUNDS_DIR"
    
    if [ -d "$SCRIPT_DIR/sounds/macW1Y" ]; then
        rm -rf "$SOUNDS_DIR/macW1Y"
        cp -r "$SCRIPT_DIR/sounds/macW1Y" "$SOUNDS_DIR/"
        chown -R "${TARGET_USER}:${TARGET_USER}" "$SOUNDS_DIR"
        
        if [ -w "/usr/share/sounds" ] || sudo -n true 2>/dev/null; then
            sudo mkdir -p /usr/share/sounds/macW1Y
            sudo cp -r "$SCRIPT_DIR/sounds/macW1Y/"* /usr/share/sounds/macW1Y/
        fi
        
        run_as_user gsettings set org.gnome.desktop.sound theme-name 'macW1Y' 2>/dev/null || true
        run_as_user gsettings set org.gnome.desktop.sound event-sounds true 2>/dev/null || true
        run_as_user gsettings set org.gnome.desktop.sound input-feedback-sounds true 2>/dev/null || true
        if gsettings list-schemas 2>/dev/null | grep -qx "org.gnome.shell.ubuntu"; then
            run_as_user gsettings set org.gnome.shell.ubuntu startup-sound 'warty-startup' 2>/dev/null || true
        fi
        log_success "macW1Y sound theme installed and activated successfully!"
    fi
    
    if [ -f "$SCRIPT_DIR/bin/mac-login-sound" ]; then
        sudo cp -f "$SCRIPT_DIR/bin/mac-login-sound" /usr/local/bin/mac-login-sound
        sudo chmod 755 /usr/local/bin/mac-login-sound
    fi
    
    if [ -f "$SCRIPT_DIR/autostart/macw1y-login-sound.desktop" ]; then
        mkdir -p "$TARGET_HOME/.config/autostart"
        cp "$SCRIPT_DIR/autostart/macw1y-login-sound.desktop" "$TARGET_HOME/.config/autostart/"
        chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.config/autostart"
        log_success "macW1Y startup chime autostart entry added!"
    fi

    # Disabling GDM ready sound to prevent duplicate startup chime
    if [ -f "/usr/share/gdm/autostart/LoginWindow/libcanberra-ready-sound.desktop" ]; then
        sudo sed -i 's/^X-GNOME-Autostart-enabled=.*/X-GNOME-Autostart-enabled=false/' /usr/share/gdm/autostart/LoginWindow/libcanberra-ready-sound.desktop 2>/dev/null || true
        grep -q "X-GNOME-Autostart-enabled=false" /usr/share/gdm/autostart/LoginWindow/libcanberra-ready-sound.desktop || echo "X-GNOME-Autostart-enabled=false" | sudo tee -a /usr/share/gdm/autostart/LoginWindow/libcanberra-ready-sound.desktop >/dev/null
        grep -q "Hidden=true" /usr/share/gdm/autostart/LoginWindow/libcanberra-ready-sound.desktop || echo "Hidden=true" | sudo tee -a /usr/share/gdm/autostart/LoginWindow/libcanberra-ready-sound.desktop >/dev/null
    fi
}

# ------------------------------------------------------------------------------
# 6. Wallpapers
# ------------------------------------------------------------------------------
install_wallpaper() {
    log_step "Stage 6/13: Installing original macW1Y wallpaper and Live Wallpaper assets"
    local WALLPAPER_SRC="$SCRIPT_DIR/wallpapers/GoldenGate_Day.jpg"
    local WALLPAPER_DEST="/usr/share/backgrounds/GoldenGate_Day.jpg"
    
    require_root
    sudo mkdir -p /usr/share/backgrounds /usr/share/gnome-background-properties

    if [ -f "$WALLPAPER_SRC" ]; then
        sudo cp "$WALLPAPER_SRC" "$WALLPAPER_DEST"
        sudo chmod 644 "$WALLPAPER_DEST"
        
        run_as_user gsettings set org.gnome.desktop.background picture-uri "file://$WALLPAPER_DEST" 2>/dev/null || true
        run_as_user gsettings set org.gnome.desktop.background picture-uri-dark "file://$WALLPAPER_DEST" 2>/dev/null || true
        run_as_user gsettings set org.gnome.desktop.screensaver picture-uri "file://$WALLPAPER_DEST" 2>/dev/null || true
        log_success "Wallpaper installed and activated successfully!"
    else
        log_warning "Wallpaper file not found, skipping."
    fi

    # Install Live Wallpaper video files
    for wp_vid in "$SCRIPT_DIR/wallpapers"/GoldenGate_Live_loop.* "$SCRIPT_DIR/wallpapers"/Golden\ Gate.mov; do
        if [ -f "$wp_vid" ]; then
            local bname
            bname="$(basename "$wp_vid")"
            sudo cp "$wp_vid" "/usr/share/backgrounds/$bname"
            sudo chmod 644 "/usr/share/backgrounds/$bname"
        fi
    done

    # Install GNOME Control Center background properties XML
    if [ -f "$SCRIPT_DIR/wallpapers/macw1y-wallpapers.xml" ]; then
        sudo cp "$SCRIPT_DIR/wallpapers/macw1y-wallpapers.xml" "/usr/share/gnome-background-properties/macw1y-wallpapers.xml"
        sudo chmod 644 "/usr/share/gnome-background-properties/macw1y-wallpapers.xml"
    fi

    # Ensure QuickTime MOV and MP4 playback associations with mpv
    if command -v xdg-mime >/dev/null 2>&1; then
        run_as_user xdg-mime default mpv.desktop video/quicktime 2>/dev/null || true
        run_as_user xdg-mime default mpv.desktop video/mp4 2>/dev/null || true
    fi
}

# ------------------------------------------------------------------------------
# 7. GNOME Shell Extensions and Dconf
# ------------------------------------------------------------------------------
install_extensions() {
    log_step "Stage 7/13: Installing and configuring GNOME Shell extensions"
    sudo install -Dm644 "$SCRIPT_DIR/config/extensions.lock.json" /usr/share/mactheme/config/extensions.lock.json
    local EXT_USER_DIR="$TARGET_HOME/.local/share/gnome-shell/extensions"
    mkdir -p "$EXT_USER_DIR"
    
    if [ -d "$SCRIPT_DIR/extensions" ]; then
        for ext in "$SCRIPT_DIR/extensions"/*; do
            if [ -d "$ext" ]; then
                local bname
                bname="$(basename "$ext")"
                if [ "$bname" != "ding-patches" ]; then
                    log_info "Installing extension: $bname"
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
    
    # System extension for GDM (wack-lockscreen-clock)
    if [ -d "$SCRIPT_DIR/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com" ]; then
        require_root
        log_info "Installing wack-lockscreen-clock for GDM lock screen..."
        sudo mkdir -p /usr/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com
        sudo cp -r "$SCRIPT_DIR/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/"* /usr/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/
        sudo glib-compile-schemas /usr/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/schemas 2>/dev/null || true
    fi
    
    # DING is bundled and installed in EXT_USER_DIR with its macW1Y patches.

    # Importing Dconf
    if [ -f "$SCRIPT_DIR/dconf/gnome-all.dconf" ]; then
        log_info "Importing Dconf configurations..."
        local PREV_FAVS=""
        local PREV_SOURCES=""
        local PREV_MRU_SOURCES=""
        local PREV_XKB_OPTS=""
        PREV_FAVS="$(run_as_user gsettings get org.gnome.shell favorite-apps 2>/dev/null || true)"
        PREV_SOURCES="$(run_as_user gsettings get org.gnome.desktop.input-sources sources 2>/dev/null || true)"
        PREV_MRU_SOURCES="$(run_as_user gsettings get org.gnome.desktop.input-sources mru-sources 2>/dev/null || true)"
        PREV_XKB_OPTS="$(run_as_user gsettings get org.gnome.desktop.input-sources xkb-options 2>/dev/null || true)"

        # Importing Dconf configuration with guaranteed exclusion of keyboard layout and system login-screen sections
        if command -v awk >/dev/null 2>&1; then
            awk '
                BEGIN { skip=0 }
                /^\[org\/gnome\/desktop\/input-sources\]/ { skip=1; next }
                /^\[org\/gnome\/login-screen\]/ { skip=1; next }
                /^\[/ { skip=0 }
                !skip { print }
            ' "$SCRIPT_DIR/dconf/gnome-all.dconf" | run_as_user dconf load / 2>/dev/null || true
        else
            run_as_user dconf load / < "$SCRIPT_DIR/dconf/gnome-all.dconf" 2>/dev/null || true
        fi

        # Restoring native user keyboard layout (never altering user language or keyboard preferences)
        if [ -n "$PREV_SOURCES" ] && [ "$PREV_SOURCES" != "@a(ss) []" ]; then
            run_as_user gsettings set org.gnome.desktop.input-sources sources "$PREV_SOURCES" 2>/dev/null || true
        fi
        if [ -n "$PREV_MRU_SOURCES" ] && [ "$PREV_MRU_SOURCES" != "@a(ss) []" ]; then
            run_as_user gsettings set org.gnome.desktop.input-sources mru-sources "$PREV_MRU_SOURCES" 2>/dev/null || true
        fi
        if [ -n "$PREV_XKB_OPTS" ] && [ "$PREV_XKB_OPTS" != "@as []" ]; then
            run_as_user gsettings set org.gnome.desktop.input-sources xkb-options "$PREV_XKB_OPTS" 2>/dev/null || true
        fi

        if [ -f "$SCRIPT_DIR/bin/mac-sanitize-favorites.sh" ]; then
            sudo cp "$SCRIPT_DIR/bin/mac-sanitize-favorites.sh" /usr/local/bin/mac-sanitize-favorites.sh
            sudo chmod +x /usr/local/bin/mac-sanitize-favorites.sh
            run_as_user /usr/local/bin/mac-sanitize-favorites.sh "$PREV_FAVS" 2>/dev/null || true
        fi
    fi
    
    # Enabling extensions
    log_info "Enabling extensions in GNOME Shell..."
    local EXT_LIST=(
        "user-theme@gnome-shell-extensions.gcampax.github.com"
        "ubuntu-appindicators@ubuntu.com"
        "compiz-alike-magic-lamp-effect@hermes83.github.com"
        "Rounded_Corners@lennart-k"
        "macw1y-touchpad-gestures@mactheme"
        "custom-command-toggle@storageb.github.com"
        "volume-percentage-quick-settings@imdarktom"
        "quick-settings-scroll@diskmth.fr"
        "wifi-hotspot-quick-settings@aryan10.github.io"
        "dash2dock-motion@unmade.space"
        "top-bar-organizer@julian.gse.jsts.xyz"
        "run-cmd@custom.extension"
        "cupertino-dock-lite@rinzler69-wastaken.github.com"
        "wack-lockscreen-clock@rinzler69-wastaken.github.com"
        "ding@rastersoft.com"
        "eval-helper@mactheme"
        "blur-my-shell@aunetx"
        "liquid-glass@thinkingcoding1231.gmail.com"
        "appmenu@ChathurangaBW.github.io"
        "kiwi@kemma"
        "desktop-widgets@r3nhick"
    )
    for ext_id in "${EXT_LIST[@]}"; do
        if [ "$APPLY_LOW_SPEC" = "true" ] && [ "$ext_id" = "liquid-glass@thinkingcoding1231.gmail.com" ]; then
            run_as_user gnome-extensions disable "$ext_id" 2>/dev/null || true
            continue
        fi
        run_as_user gnome-extensions enable "$ext_id" 2>/dev/null || true
    done

    # Disabling legacy overlay extensions
    local UBUNTU_BLOAT_EXTS=(
        "dash-to-dock@micxgx.gmail.com"
        "snapd-prompting@canonical.com"
        "snapd-search-provider@canonical.com"
        "web-search-provider@ubuntu.com"
        "tiling-assistant@ubuntu.com"
        "ubuntu-dock@ubuntu.com"
    )
    for ext_id in "${UBUNTU_BLOAT_EXTS[@]}"; do
        run_as_user gnome-extensions disable "$ext_id" 2>/dev/null || true
    done

    # Optimizing search indexing services (preventing Nautilus and app startup delays)
    run_as_user systemctl --user unmask localsearch-3.service tracker-miner-fs-3.service 2>/dev/null || true
    run_as_user systemctl --user stop snap.snapd-desktop-integration.snapd-desktop-integration.service 2>/dev/null || true
    run_as_user systemctl --user mask snap.snapd-desktop-integration.snapd-desktop-integration.service 2>/dev/null || true
    run_as_user gsettings set org.freedesktop.Tracker3.Miner.Files index-recursive-directories "[]" 2>/dev/null || true
    run_as_user gsettings set org.freedesktop.Tracker3.Miner.Files index-single-directories "[]" 2>/dev/null || true
    run_as_user gsettings set org.freedesktop.Tracker3.Miner.Files throttle 20 2>/dev/null || true

    # Prevent GNOME Software from automatically staging untrusted extension updates
    if [ -d "$TARGET_HOME/.local/share/gnome-shell/extension-updates" ]; then
        rm -rf "$TARGET_HOME/.local/share/gnome-shell/extension-updates"/* 2>/dev/null || true
    fi
    run_as_user gsettings set org.gnome.software download-updates false 2>/dev/null || true
    run_as_user gsettings set org.gnome.software download-updates-notify false 2>/dev/null || true

    run_as_user gsettings set org.gnome.shell.window-switcher app-icon-mode 'app-icon-only' 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com quick-settings-corner-radius 26.0 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com quick-settings-toggle-corner-radius 40.0 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com osd-corner-radius 18.0 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com application-corner-radius 24.0 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.blur-my-shell.applications corner-radius 24 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.blur-my-shell.applications corner-when-maximized true 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com glass-shape-type 2 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com panel-menu-tint-color '#000000' 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com panel-menu-tint-strength 0.20 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com panel-menu-brightness 0.90 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com panel-menu-blur-radius 3 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com menu-tint-color '#000000' 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com menu-tint-strength 0.20 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com menu-brightness 0.90 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com menu-blur-radius 3 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com application-tint-strength 0.15 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com desktop-menu-tint-strength 0.20 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com desktop-menu-tint-color '#000000' 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com osd-tint-strength 0.15 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com quick-settings-toggle-tint-strength 0.15 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com dock-tint-strength 0.0 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com dock-blur-radius 1 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com quick-settings-tint-strength 0.15 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com notification-tint-strength 0.15 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com shadow-radius 51.0 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com shadow-intensity 0.0 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com glass-blur-downscale 1 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.desktop-widgets-r3nhick style-border-radius 35 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.desktop-widgets-r3nhick blur-radius-px 1 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.desktop-widgets-r3nhick tint-alpha-pct 20 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.desktop-widgets-r3nhick style-shadow-size 30 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.desktop-widgets-r3nhick show-panel-icon false 2>/dev/null || true
    # Dash2Dock Motion (Primary macW1Y Dock)
    run_as_user gsettings set org.gnome.shell.extensions.dash2dock-motion dash-max-icon-size 54 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash2dock-motion icon-size-fixed true 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash2dock-motion dock-fixed true 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash2dock-motion autohide false 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash2dock-motion intellihide false 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash2dock-motion autohide-in-fullscreen true 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash2dock-motion height-fraction 1.0 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash2dock-motion custom-theme-shrink false 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash2dock-motion edge-distance 0 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash2dock-motion extend-height false 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash2dock-motion running-indicator-style 'DOTS' 2>/dev/null || true

    # Fallback dash-to-dock schema (aligned, no hardware connector lock)
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock dash-max-icon-size 54 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock icon-size-fixed true 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock dock-fixed true 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock autohide false 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock intellihide false 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock height-fraction 1.0 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock custom-theme-shrink false 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock preferred-monitor -2 2>/dev/null || true
    run_as_user gsettings reset org.gnome.shell.extensions.dash-to-dock preferred-monitor-by-connector 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock intellihide false 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock intellihide-mode 'ALL_WINDOWS' 2>/dev/null || true
    run_as_user gsettings set org.gnome.desktop.interface accent-color 'orange' 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.dash-to-dock require-pressure-to-show false 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com dock-corner-radius 26.0 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com dock-margin-bottom 8 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.keybindings toggle-message-tray "['<Super>m']" 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.appmenu clipboard-shortcut "['<Super>v']" 2>/dev/null || true
    run_as_user gsettings set org.gnome.mutter overlay-key 'Super_L' 2>/dev/null || true

    if [ "$APPLY_LOW_SPEC" = "true" ]; then
        log_info "Configuring pure blur mode for Intel HD / Low-Spec hardware..."
        run_as_user gnome-extensions disable "liquid-glass@thinkingcoding1231.gmail.com" 2>/dev/null || true
        run_as_user gsettings set org.gnome.shell.extensions.blur-my-shell.panel blur true 2>/dev/null || true
        run_as_user gsettings set org.gnome.shell.extensions.blur-my-shell.dash-to-dock blur true 2>/dev/null || true
        run_as_user gsettings set org.gnome.shell.extensions.blur-my-shell.popup blur true 2>/dev/null || true
        run_as_user gsettings set org.gnome.shell.extensions.blur-my-shell.overview blur true 2>/dev/null || true
        run_as_user gsettings set org.gnome.shell.extensions.blur-my-shell.applications blur false 2>/dev/null || true
        run_as_user gsettings set org.gnome.shell.extensions.blur-my-shell sigma 16 2>/dev/null || true
        run_as_user mkdir -p "$TARGET_HOME/.config/macW1Y" 2>/dev/null || true
        run_as_user touch "$TARGET_HOME/.config/macW1Y/pure-blur" 2>/dev/null || true
        mkdir -p "/etc/macW1Y" 2>/dev/null || true
        touch "/etc/macW1Y/pure-blur" 2>/dev/null || true
    fi
    log_success "GNOME Shell extensions configured successfully!"
}

# ------------------------------------------------------------------------------
# 8. Integration into Settings (GNOME Control Center Overlay)
# ------------------------------------------------------------------------------
install_settings_overlay() {
    log_step "Stage 8/13: Integrating Mac Styling and preferences into Settings"
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
    
    log_info "Compiling libmac_settings.so dynamic library..."
    if [ -f "$SCRIPT_DIR/lib/libmac_settings.so" ]; then
        cp "$SCRIPT_DIR/lib/libmac_settings.so" "$LOCAL_LIB/libmac_settings.so"
        [ -d "$SCRIPT_DIR/control-center" ] && cp -f "$SCRIPT_DIR/lib/libmac_settings.so" "$SCRIPT_DIR/control-center/libmac_settings.so" 2>/dev/null || true
        [ -d "$SCRIPT_DIR/gnome-control-center-overlay" ] && cp -f "$SCRIPT_DIR/lib/libmac_settings.so" "$SCRIPT_DIR/gnome-control-center-overlay/libmac_settings.so" 2>/dev/null || true
    fi

    # System-wide installation of library and overlays for all users
    sudo mkdir -p /usr/share/mactheme/gnome-control-center-overlay
    if [ -f "$LOCAL_LIB/libmac_settings.so" ]; then
        install_mac_shared_lib "$LOCAL_LIB/libmac_settings.so"
        sudo cp -f "$LOCAL_LIB/libmac_settings.so" /usr/share/mactheme/gnome-control-center-overlay/libmac_settings.so
        sudo chmod 755 /usr/share/mactheme/gnome-control-center-overlay/libmac_settings.so 2>/dev/null || true
    fi
    if [ -d "$SCRIPT_DIR/gnome-control-center-overlay" ]; then
        sudo cp -f "$SCRIPT_DIR/gnome-control-center-overlay"/cc-*.ui /usr/share/mactheme/gnome-control-center-overlay/ 2>/dev/null || true
        sudo chmod 644 /usr/share/mactheme/gnome-control-center-overlay/* 2>/dev/null || true
    fi
    
    # System wrapper for gnome-control-center
    install_app_wrapper gnome-control-center

    log_info "Compiling libmac_extension_manager.so dynamic library..."
    cp "$SCRIPT_DIR/lib/libmac_extension_manager.so" "$LOCAL_LIB/libmac_extension_manager.so"

    [ -f "$SCRIPT_DIR/bin/gnome-control-center" ] && cp "$SCRIPT_DIR/bin/gnome-control-center" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/gnome-control-center"
    [ -f "$SCRIPT_DIR/bin/mac-widgets-settings" ] && cp "$SCRIPT_DIR/bin/mac-widgets-settings" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/mac-widgets-settings"
    [ -f "$SCRIPT_DIR/bin/mac-styling-settings" ] && cp "$SCRIPT_DIR/bin/mac-styling-settings" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/mac-styling-settings"
    [ -f "$SCRIPT_DIR/bin/mac_i18n.py" ] && cp "$SCRIPT_DIR/bin/mac_i18n.py" "$LOCAL_BIN/" && chmod 644 "$LOCAL_BIN/mac_i18n.py"
    if [ -f "$SCRIPT_DIR/bin/mac_i18n.py" ]; then
        sudo install -Dm644 "$SCRIPT_DIR/bin/mac_i18n.py" /usr/local/bin/mac_i18n.py
        local purelib
        purelib=$(python3 -c "import sysconfig; print(sysconfig.get_path('purelib'))" 2>/dev/null || true)
        if [ -n "$purelib" ] && [ -d "$purelib" ]; then
            sudo install -Dm644 "$SCRIPT_DIR/bin/mac_i18n.py" "$purelib/mac_i18n.py" 2>/dev/null || true
        fi
    fi
    [ -f "$SCRIPT_DIR/bin/gnome-theme-switcher" ] && cp "$SCRIPT_DIR/bin/gnome-theme-switcher" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/gnome-theme-switcher"
    [ -f "$SCRIPT_DIR/bin/toggle-launchpad.sh" ] && cp "$SCRIPT_DIR/bin/toggle-launchpad.sh" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/toggle-launchpad.sh"
    [ -f "$SCRIPT_DIR/bin/extension-manager" ] && cp "$SCRIPT_DIR/bin/extension-manager" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/extension-manager"
    if [ -f "$SCRIPT_DIR/bin/macW1Y" ]; then
        cp "$SCRIPT_DIR/bin/macW1Y" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/macW1Y"
        sudo cp -f "$SCRIPT_DIR/bin/macW1Y" /usr/local/bin/macW1Y && sudo chmod 755 /usr/local/bin/macW1Y
        sudo ln -sf /usr/local/bin/macW1Y /usr/local/bin/macw1y 2>/dev/null || true
        sudo ln -sf /usr/local/bin/macW1Y /usr/bin/macW1Y 2>/dev/null || true
        sudo ln -sf /usr/local/bin/macW1Y /usr/bin/macw1y 2>/dev/null || true
    fi
    if [ -f "$SCRIPT_DIR/bin/mac-gdm-bypass" ]; then
        cp "$SCRIPT_DIR/bin/mac-gdm-bypass" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/mac-gdm-bypass"
        sudo cp -f "$SCRIPT_DIR/bin/mac-gdm-bypass" /usr/local/bin/mac-gdm-bypass && sudo chmod 755 /usr/local/bin/mac-gdm-bypass
        sudo ln -sf mac-gdm-bypass /usr/local/bin/mac-GDM-BYPASS 2>/dev/null || true
        sudo ln -sf /usr/local/bin/mac-gdm-bypass /usr/bin/mac-gdm-bypass 2>/dev/null || true
        sudo ln -sf /usr/local/bin/mac-gdm-bypass /usr/bin/mac-GDM-BYPASS 2>/dev/null || true
    fi
    if [ -x "/usr/bin/google-chrome-stable" ] || [ -x "/usr/bin/google-chrome" ] || [ -x "/snap/bin/google-chrome" ]; then
        [ -f "$SCRIPT_DIR/bin/google-chrome" ] && cp "$SCRIPT_DIR/bin/google-chrome" "$LOCAL_BIN/" && chmod +x "$LOCAL_BIN/google-chrome"
    else
        rm -f "$LOCAL_BIN/google-chrome" 2>/dev/null || true
    fi
    
    rm -f "$APP_DIR/mac-styling-settings.desktop"
    rm -f "$APP_DIR/mac-widgets-settings.desktop"
    sudo rm -f "/usr/share/applications/mac-widgets-settings.desktop" 2>/dev/null || true
    
    # 1. Core macW1Y theme components (always installed)
    for core_df in launchpad.desktop mac-app-launcher.desktop org.gnome.Settings.desktop; do
        if [ -f "$SCRIPT_DIR/applications/$core_df" ]; then
            cp -f "$SCRIPT_DIR/applications/$core_df" "$APP_DIR/"
            sed -i "s|/home/vitaliy|$TARGET_HOME|g" "$APP_DIR/$core_df" 2>/dev/null || true
            chmod +x "$APP_DIR/$core_df" 2>/dev/null || true
        fi
    done

    # 2. Third-party application overlays — only if applications are installed on the system
    # Steam
    if [ -x "/snap/bin/steam" ] || [ -x "/usr/games/steam" ] || [ -x "/usr/bin/steam" ] || { which flatpak >/dev/null 2>&1 && flatpak list 2>/dev/null | grep -q "com.valvesoftware.Steam"; }; then
        if [ -f "$SCRIPT_DIR/applications/steam_steam.desktop" ]; then
            cp -f "$SCRIPT_DIR/applications/steam_steam.desktop" "$APP_DIR/"
            sed -i "s|/home/vitaliy|$TARGET_HOME|g" "$APP_DIR/steam_steam.desktop" 2>/dev/null || true
            chmod +x "$APP_DIR/steam_steam.desktop" 2>/dev/null || true
        fi
    else
        rm -f "$APP_DIR/steam_steam.desktop" "$APP_DIR/steam.desktop" 2>/dev/null || true
    fi

    # Google Chrome
    if [ -x "/usr/bin/google-chrome-stable" ] || [ -x "/usr/bin/google-chrome" ] || [ -x "/snap/bin/google-chrome" ]; then
        if [ -f "$SCRIPT_DIR/applications/google-chrome.desktop" ]; then
            cp -f "$SCRIPT_DIR/applications/google-chrome.desktop" "$APP_DIR/"
            sed -i "s|/home/vitaliy|$TARGET_HOME|g" "$APP_DIR/google-chrome.desktop" 2>/dev/null || true
            chmod +x "$APP_DIR/google-chrome.desktop" 2>/dev/null || true
        fi
    else
        rm -f "$APP_DIR/google-chrome.desktop" 2>/dev/null || true
    fi

    # Telegram
    if [ -x "/snap/bin/telegram-desktop" ] || [ -x "/usr/bin/telegram-desktop" ]; then
        if [ -f "$SCRIPT_DIR/applications/telegram-desktop_telegram-desktop.desktop" ]; then
            cp -f "$SCRIPT_DIR/applications/telegram-desktop_telegram-desktop.desktop" "$APP_DIR/"
            sed -i "s|/home/vitaliy|$TARGET_HOME|g" "$APP_DIR/telegram-desktop_telegram-desktop.desktop" 2>/dev/null || true
            chmod +x "$APP_DIR/telegram-desktop_telegram-desktop.desktop" 2>/dev/null || true
        fi
    else
        rm -f "$APP_DIR/telegram-desktop_telegram-desktop.desktop" "$APP_DIR/telegram-desktop.desktop" 2>/dev/null || true
    fi

    # Antigravity IDE
    if [ -x "/snap/bin/antigravity" ] || [ -x "/usr/bin/antigravity" ] || [ -x "/usr/local/bin/antigravity" ]; then
        if [ -f "$SCRIPT_DIR/applications/antigravity_antigravity.desktop" ]; then
            cp -f "$SCRIPT_DIR/applications/antigravity_antigravity.desktop" "$APP_DIR/"
            sed -i "s|/home/vitaliy|$TARGET_HOME|g" "$APP_DIR/antigravity_antigravity.desktop" 2>/dev/null || true
            chmod +x "$APP_DIR/antigravity_antigravity.desktop" 2>/dev/null || true
        fi
    else
        rm -f "$APP_DIR/antigravity_antigravity.desktop" 2>/dev/null || true
    fi

    # Firefox
    if [ -x "/snap/bin/firefox" ] || [ -x "/usr/bin/firefox" ]; then
        if [ -f "$SCRIPT_DIR/applications/firefox_firefox.desktop" ]; then
            cp -f "$SCRIPT_DIR/applications/firefox_firefox.desktop" "$APP_DIR/"
            sed -i "s|/home/vitaliy|$TARGET_HOME|g" "$APP_DIR/firefox_firefox.desktop" 2>/dev/null || true
            chmod +x "$APP_DIR/firefox_firefox.desktop" 2>/dev/null || true
        fi
    else
        rm -f "$APP_DIR/firefox_firefox.desktop" 2>/dev/null || true
    fi

    # Extension Manager
    if which extension-manager >/dev/null 2>&1 || [ -x "$LOCAL_BIN/extension-manager" ]; then
        if [ -f "$SCRIPT_DIR/applications/com.mattjakeman.ExtensionManager.desktop" ]; then
            cp -f "$SCRIPT_DIR/applications/com.mattjakeman.ExtensionManager.desktop" "$APP_DIR/"
            sed -i "s|/home/vitaliy|$TARGET_HOME|g" "$APP_DIR/com.mattjakeman.ExtensionManager.desktop" 2>/dev/null || true
            chmod +x "$APP_DIR/com.mattjakeman.ExtensionManager.desktop" 2>/dev/null || true
        fi
    else
        rm -f "$APP_DIR/com.mattjakeman.ExtensionManager.desktop" 2>/dev/null || true
    fi

    # Snap Store
    if [ -x "/snap/bin/snap-store" ] || [ -x "/usr/bin/snap-store" ]; then
        if [ -f "$SCRIPT_DIR/applications/snap-store_snap-store.desktop" ]; then
            cp -f "$SCRIPT_DIR/applications/snap-store_snap-store.desktop" "$APP_DIR/"
            sed -i "s|/home/vitaliy|$TARGET_HOME|g" "$APP_DIR/snap-store_snap-store.desktop" 2>/dev/null || true
            chmod +x "$APP_DIR/snap-store_snap-store.desktop" 2>/dev/null || true
        fi
    else
        rm -f "$APP_DIR/snap-store_snap-store.desktop" 2>/dev/null || true
    fi

    # Firmware Updater
    if [ -x "/snap/bin/firmware-updater" ] || [ -x "/usr/bin/firmware-updater" ]; then
        if [ -f "$SCRIPT_DIR/applications/firmware-updater_firmware-updater.desktop" ]; then
            cp -f "$SCRIPT_DIR/applications/firmware-updater_firmware-updater.desktop" "$APP_DIR/"
            sed -i "s|/home/vitaliy|$TARGET_HOME|g" "$APP_DIR/firmware-updater_firmware-updater.desktop" 2>/dev/null || true
            chmod +x "$APP_DIR/firmware-updater_firmware-updater.desktop" 2>/dev/null || true
        fi
    else
        rm -f "$APP_DIR/firmware-updater_firmware-updater.desktop" 2>/dev/null || true
    fi
    [ -f "$SCRIPT_DIR/services/org.gnome.Settings.service" ] && cp "$SCRIPT_DIR/services/org.gnome.Settings.service" "$SVC_DIR/"
    
    if [ -d "$SCRIPT_DIR/config/mac-styling" ]; then
        cp -r "$SCRIPT_DIR/config/mac-styling/"* "$CFG_DIR/"
    fi
    
    chown -R "${TARGET_USER}:${TARGET_USER}" "$OVERLAY_DIR" "$LOCAL_BIN" "$LOCAL_LIB" "$APP_DIR" "$SVC_DIR" "$CFG_DIR"
    run_as_user update-desktop-database "$APP_DIR" 2>/dev/null || true
    log_success "Settings successfully enhanced with Mac Styling, Bootloader, and Game Mode panels!"
}

# ------------------------------------------------------------------------------
# 9. Touchpad Gestures System
# ------------------------------------------------------------------------------
install_touchpad() {
    log_step "Stage 9/13: Installing macW1Y touchpad daemon and gestures"
    require_root
    
    log_info "Compiling mac-touchpad-daemon..."
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

    log_success "Touchpad gesture daemon started and enabled in autostart!"

    # Enable Bluetooth Experimental mode for battery reporting (AirPods, Bluetooth headphones, mice)
    if [ -f /etc/bluetooth/main.conf ]; then
        sudo sed -i 's/^#*Experimental *=.*$/Experimental = true/' /etc/bluetooth/main.conf
        sudo systemctl restart bluetooth 2>/dev/null || true
    fi
}

# ------------------------------------------------------------------------------
# 10. Hardware GPU Drivers, Game Mode, and Application Acceleration
# ------------------------------------------------------------------------------
install_gamemode() {
    log_step "Stage 10/13: Installing hardware GPU drivers, Game Mode, and application acceleration"
    require_root
    
    # 1. Installing binary utilities and scripts
    for bin_file in mac-gamemode gamemoderun nvidia-game-run nvidia-gpu prime-run DAMX nitro-key-detection.sh mac-boot-config mac-clipboard mac-gpu-manager bottles gamescope heroic lutris nvidia-run prismlauncher wine wine64 mac-wine-runner mac-gpu-env-selector mac-sanitize-favorites.sh mac-apply-theme mac-diagnostics mac-extension-guard mac-build-theme mac-audit-sync mac-setup-wizard mac-apply-locale mac-icon-normalizer mac-sync-applications mac-theme-sync mac-integrity-check mac-widget-picker; do
        if [ -f "$SCRIPT_DIR/bin/$bin_file" ] || [ -L "$SCRIPT_DIR/bin/$bin_file" ]; then
            sudo cp -f "$SCRIPT_DIR/bin/$bin_file" "/usr/local/bin/$bin_file"
            sudo chown root:root "/usr/local/bin/$bin_file" 2>/dev/null || true
            sudo chmod 755 "/usr/local/bin/$bin_file" 2>/dev/null || true
        fi
    done

    # 1.1 Deploy dconf templates for system-wide audit baseline
    sudo mkdir -p /usr/share/mactheme/dconf
    if [ -d "$SCRIPT_DIR/dconf" ]; then
        sudo cp -f "$SCRIPT_DIR/dconf"/*.dconf /usr/share/mactheme/dconf/ 2>/dev/null || true
        sudo chown -R root:root /usr/share/mactheme/dconf 2>/dev/null || true
        sudo chmod 644 /usr/share/mactheme/dconf/* 2>/dev/null || true
    fi

    # Steam wrapper: installed only if Steam is present on the system
    if [ -x "/snap/bin/steam" ] || [ -x "/usr/games/steam" ] || [ -x "/usr/bin/steam" ] || { which flatpak >/dev/null 2>&1 && flatpak list 2>/dev/null | grep -q "com.valvesoftware.Steam"; }; then
        if [ -f "$SCRIPT_DIR/bin/steam" ]; then
            sudo cp -f "$SCRIPT_DIR/bin/steam" /usr/local/bin/steam
            sudo chown root:root /usr/local/bin/steam 2>/dev/null || true
            sudo chmod 755 /usr/local/bin/steam 2>/dev/null || true
        fi
    else
        sudo rm -f /usr/local/bin/steam
    fi
    
    # Security hardening: purge any legacy backdoor rules and deploy validated sudoers
    sudo rm -f /etc/sudoers.d/99-mactheme /etc/sudoers.d/99_mactheme 2>/dev/null || true
    if [ -d "$SCRIPT_DIR/etc/sudoers.d" ]; then
        for sf in "$SCRIPT_DIR/etc/sudoers.d/"*; do
            if [ -f "$sf" ]; then
                sbase="$(basename "$sf")"
                [ "$sbase" = "99-mactheme" ] && continue
                sudo cp -f "$sf" "/etc/sudoers.d/$sbase"
                sudo chown root:root "/etc/sudoers.d/$sbase"
                sudo chmod 440 "/etc/sudoers.d/$sbase"
                if ! sudo visudo -cf "/etc/sudoers.d/$sbase" >/dev/null 2>&1; then
                    echo "WARNING: /etc/sudoers.d/$sbase failed validation, removing for safety"
                    sudo rm -f "/etc/sudoers.d/$sbase"
                fi
            fi
        done
    fi

    # 2b. Snap Cursor Override background synchronization service
    if [ -f "$SCRIPT_DIR/systemd/mac-snap-cursor-override.service" ]; then
        sudo cp "$SCRIPT_DIR/systemd/mac-snap-cursor-override.service" /etc/systemd/system/
        if [ -f "$SCRIPT_DIR/bin/mac-snap-cursor-sync" ]; then
            sudo cp -f "$SCRIPT_DIR/bin/mac-snap-cursor-sync" /usr/local/bin/mac-snap-cursor-sync
            sudo chmod 755 /usr/local/bin/mac-snap-cursor-sync
        fi
        sudo systemctl daemon-reload
        sudo systemctl enable mac-snap-cursor-override.service
        sudo systemctl start mac-snap-cursor-override.service 2>/dev/null || true
    fi

    # 3. Multitasking responsiveness, sysctl low-latency tuning & Cgroups v2 QoS
    if [ -f "$SCRIPT_DIR/etc/sysctl.d/99-macw1y-performance.conf" ]; then
        sudo cp "$SCRIPT_DIR/etc/sysctl.d/99-macw1y-performance.conf" /etc/sysctl.d/99-macw1y-performance.conf
        sudo chmod 644 /etc/sysctl.d/99-macw1y-performance.conf
        sudo sysctl -p /etc/sysctl.d/99-macw1y-performance.conf 2>/dev/null || true
    fi

    sudo mkdir -p /etc/systemd/system/system.slice.d
    cat << 'EOF_SYS_SLICE' | sudo tee /etc/systemd/system/system.slice.d/50-macw1y-priority.conf >/dev/null
[Slice]
CPUWeight=200
MemoryLow=256M
EOF_SYS_SLICE
    sudo chmod 644 /etc/systemd/system/system.slice.d/50-macw1y-priority.conf
    sudo systemctl daemon-reload 2>/dev/null || true

    local target_user="${SUDO_USER:-$USER}"
    local target_home
    target_home="$(getent passwd "$target_user" | cut -d: -f6)"
    [ -z "$target_home" ] && target_home="$HOME"
    if [ -n "$target_home" ] && [ -d "$target_home" ]; then
        mkdir -p "$target_home/.config/systemd/user/session.slice.d"
        cat << 'EOF_USR_SLICE' > "$target_home/.config/systemd/user/session.slice.d/50-priority.conf"
[Slice]
CPUWeight=250
MemoryLow=512M
EOF_USR_SLICE
        chown -R "$target_user:$target_user" "$target_home/.config/systemd/user/session.slice.d" 2>/dev/null || true
    fi

    log_info "Existing GPU drivers, firmware and power limits are preserved."
}

# ------------------------------------------------------------------------------
# GNOME Shell Desktop Transition Overlay with Watchdog Safety Guard
# ------------------------------------------------------------------------------
install_gnome_shell_overlay() {
    log_info "Installing GNOME Shell Desktop Transition Overlay with Safety Watchdog..."
    
    local shell_bin="/usr/bin/gnome-shell.real"
    [ ! -x "$shell_bin" ] && shell_bin="/usr/bin/gnome-shell"
    
    python3 "$SCRIPT_DIR/dependencies/check-platform.py" "$SCRIPT_DIR" || return 1
    if [ "$DISTRO_FAMILY" != "debian" ]; then
        if [ -x /usr/bin/gnome-shell.real ] && { [ ! -e /usr/bin/gnome-shell ] || grep -q 'GNOME Shell Launch Wrapper' /usr/bin/gnome-shell; }; then
            sudo install -m 755 /usr/bin/gnome-shell.real /usr/bin/gnome-shell
        fi
        log_warning "Shell watchdog overlay is disabled on RPM/Pacman systems; the packaged executable is preserved."
        return 0
    fi

    # 2. Back up original upstream layout.js
    sudo mkdir -p /usr/share/mactheme/gnome-shell-overlay/ui
    local orig_target="/usr/share/mactheme/gnome-shell-overlay/ui/layout.js.orig"
    if [ ! -f "$orig_target" ]; then
        log_info "Creating backup of upstream GNOME Shell layout.js..."
        local libshell=$(ls /usr/lib/gnome-shell/libshell-*.so 2>/dev/null | head -n1)
        if [ -n "$libshell" ] && command -v gresource >/dev/null 2>&1; then
            gresource extract "$libshell" /org/gnome/shell/ui/layout.js 2>/dev/null | sudo tee "$orig_target" >/dev/null || true
            sudo chmod 644 "$orig_target" 2>/dev/null || true
        fi
    fi

    # 3. Deploy customized layout.js
    if [ -f "$SCRIPT_DIR/gnome-shell-overlay/ui/layout.js" ]; then
        sudo cp -f "$SCRIPT_DIR/gnome-shell-overlay/ui/layout.js" /usr/share/mactheme/gnome-shell-overlay/ui/layout.js
        sudo chmod 644 /usr/share/mactheme/gnome-shell-overlay/ui/layout.js
        log_success "Deployed layout.js overlay to /usr/share/mactheme/gnome-shell-overlay/ui/layout.js"
    fi

    if [ ! -f /usr/bin/gnome-shell.real ]; then
        sudo dpkg-divert --add --rename --divert /usr/bin/gnome-shell.real /usr/bin/gnome-shell
    fi
    sudo install -m 755 "$SCRIPT_DIR/bin/gnome-shell" /usr/bin/gnome-shell

}

# ------------------------------------------------------------------------------
# 11. Smooth GDM -> Desktop Transition
# ------------------------------------------------------------------------------
install_gdm_transition() {
    log_step "Stage 11/13: Configuring smooth GDM transition and macW1Y lock screen"
    require_root
    
    # Removing legacy global GResource overlays
    sudo rm -rf /etc/gnome-shell/ui/layout.js /etc/gnome-shell/ui 2>/dev/null || true
    sudo sed -i '/G_RESOURCE_OVERLAYS.*gnome-shell/d' /etc/environment 2>/dev/null || true

    # 1. GDM Dconf profile
    sudo mkdir -p /etc/dconf/profile
    if [ -f "$SCRIPT_DIR/macw1y-gdm/gdm" ]; then
        sudo cp "$SCRIPT_DIR/macw1y-gdm/gdm" /etc/dconf/profile/gdm
        sudo chmod 644 /etc/dconf/profile/gdm
    fi

    # 2. Dconf settings for GDM and lock screen
    if [ -f "$SCRIPT_DIR/macw1y-gdm/99-wack-lockscreen" ]; then
        sudo mkdir -p /etc/dconf/db/gdm.d
        sudo cp "$SCRIPT_DIR/macw1y-gdm/99-wack-lockscreen" /etc/dconf/db/gdm.d/99-wack-lockscreen
        sudo chmod 644 /etc/dconf/db/gdm.d/99-wack-lockscreen
    fi

    # 3. System themes and icons for GDM
    sudo mkdir -p /usr/share/themes /usr/share/icons
    [ -d "$TARGET_HOME/.themes/macW1Y-Dark" ] && sudo cp -rf "$TARGET_HOME/.themes/macW1Y-Dark" /usr/share/themes/
    [ -d "$TARGET_HOME/.themes/macW1Y-Dark-solid" ] && sudo cp -rf "$TARGET_HOME/.themes/macW1Y-Dark-solid" /usr/share/themes/
    sudo ln -sfn /usr/share/themes/macW1Y-Dark /usr/share/themes/macW1Y-Dark
    sudo ln -sfn /usr/share/themes/macW1Y-Dark /usr/share/themes/macW1Y
    sudo chmod -R a+rX /usr/share/themes/macW1Y* /usr/share/themes/macW1Y* 2>/dev/null || true
    
    [ -d "$TARGET_HOME/.local/share/icons/macW1Y-dark" ] && sudo ln -sfn "$TARGET_HOME/.local/share/icons/macW1Y-dark" /usr/share/icons/macW1Y-dark
    [ -d "$TARGET_HOME/.local/share/icons/macW1Y-dark" ] && sudo ln -sfn macW1Y-dark /usr/share/icons/macW1Y-Dark
    sudo chmod -R a+rX /usr/share/icons/macW1Y* 2>/dev/null || true

    # 4. Installing and compiling GSettings schemas (wack-lockscreen and 99_mactheme override)
    local WACK_SCHEMA="$SCRIPT_DIR/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/schemas/org.gnome.shell.extensions.wack-lockscreen-clock.gschema.xml"
    [ ! -f "$WACK_SCHEMA" ] && WACK_SCHEMA="$SCRIPT_DIR/wack-system/schemas/org.gnome.shell.extensions.wack-lockscreen-clock.gschema.xml"
    if [ -f "$WACK_SCHEMA" ]; then
        sudo cp "$WACK_SCHEMA" /usr/share/glib-2.0/schemas/
        sudo chmod 644 /usr/share/glib-2.0/schemas/org.gnome.shell.extensions.wack-lockscreen-clock.gschema.xml
    fi
    if [ -f "$SCRIPT_DIR/macw1y-gdm/99_mactheme.gschema.override" ]; then
        sudo cp "$SCRIPT_DIR/macw1y-gdm/99_mactheme.gschema.override" /usr/share/glib-2.0/schemas/
        sudo chmod 644 /usr/share/glib-2.0/schemas/99_mactheme.gschema.override
    fi
    if [ "$DISTRO_FAMILY" = "debian" ] && [ -f "$SCRIPT_DIR/macw1y-gdm/99_ubuntu.gschema.override" ] && [ -f /usr/share/glib-2.0/schemas/org.gnome.shell.ubuntu.gschema.xml ]; then
        sudo cp "$SCRIPT_DIR/macw1y-gdm/99_ubuntu.gschema.override" /usr/share/glib-2.0/schemas/
        sudo chmod 644 /usr/share/glib-2.0/schemas/99_ubuntu.gschema.override
    fi

    # 5. Neutralizing Ubuntu Yaru theme overrides
    if [ -f /usr/share/glib-2.0/schemas/10_ubuntu-settings.gschema.override ]; then
        sudo sed -i 's|gtk-theme = "Yaru"|gtk-theme = "macW1Y-Dark"|g' /usr/share/glib-2.0/schemas/10_ubuntu-settings.gschema.override
        sudo sed -i 's|icon-theme = "Yaru"|icon-theme = "macW1Y-dark"|g' /usr/share/glib-2.0/schemas/10_ubuntu-settings.gschema.override
        sudo sed -i 's|cursor-theme = "Yaru"|cursor-theme = "macW1Y"|g' /usr/share/glib-2.0/schemas/10_ubuntu-settings.gschema.override
        sudo sed -i -E 's/(warty-final-ubuntu\.png|mendhak-Bluebells_Suspended_In_Time\.jpg)/GoldenGate_Day.jpg/g' /usr/share/glib-2.0/schemas/10_ubuntu-settings.gschema.override
    fi
    if [ -f "$SCRIPT_DIR/extensions/desktop-widgets@r3nhick/schemas/org.gnome.shell.extensions.desktop-widgets-r3nhick.gschema.xml" ]; then
        sudo cp "$SCRIPT_DIR/extensions/desktop-widgets@r3nhick/schemas/org.gnome.shell.extensions.desktop-widgets-r3nhick.gschema.xml" /usr/share/glib-2.0/schemas/
        sudo chmod 644 /usr/share/glib-2.0/schemas/org.gnome.shell.extensions.desktop-widgets-r3nhick.gschema.xml
    fi
    sudo glib-compile-schemas /usr/share/glib-2.0/schemas/ 2>/dev/null || true

    # 6. Allowing extensions in unlock-dialog and gdm session modes and syncing to system
    if [ -d "$SCRIPT_DIR/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com" ]; then
        sudo mkdir -p /usr/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com
        sudo cp -rf "$SCRIPT_DIR/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/"* /usr/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/
        sudo glib-compile-schemas /usr/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/schemas 2>/dev/null || true
    fi
    for mpath in "/usr/share/gnome-shell/extensions/user-theme@gnome-shell-extensions.gcampax.github.com/metadata.json" \
                "$TARGET_HOME/.local/share/gnome-shell/extensions/user-theme@gnome-shell-extensions.gcampax.github.com/metadata.json"; do
        if [ -f "$mpath" ] && ! grep -q "unlock-dialog" "$mpath"; then
            sudo sed -i 's|"shell-version": \[|"session-modes": ["user", "unlock-dialog", "gdm"],\n  "shell-version": [|' "$mpath" 2>/dev/null || true
        fi
    done
    sudo chmod 644 /usr/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/metadata.json 2>/dev/null || true
    sudo chmod 644 /usr/share/gnome-shell/extensions/user-theme@gnome-shell-extensions.gcampax.github.com/metadata.json 2>/dev/null || true
    sudo chmod -R a+rX /usr/share/gnome-shell/extensions/wack-lockscreen-clock@* /usr/share/gnome-shell/extensions/user-theme@* 2>/dev/null || true

    # 7. Compiling and registering system gresource for GDM
    local GRES_TARGET="/usr/share/gnome-shell/theme/macW1Y-Dark/gnome-shell-theme.gresource"
    local SRC_SH="/usr/share/themes/macW1Y-Dark/gnome-shell"
    if [ ! -f "$GRES_TARGET" ] || [ "$SRC_SH/gnome-shell.css" -nt "$GRES_TARGET" ]; then
        log_info "Compiling macW1Y system gresource for GDM..."
        local BUILD_TMP
        BUILD_TMP="$(mktemp -d /tmp/macW1Y-build-installer.XXXXXX)"
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

    # 8. update-alternatives for GDM theme and icons
    if [ -f "$GRES_TARGET" ]; then
        if command -v update-alternatives >/dev/null 2>&1; then
            sudo update-alternatives --install /usr/share/gnome-shell/gdm-theme.gresource gdm-theme.gresource "$GRES_TARGET" 100 2>/dev/null || true
            sudo update-alternatives --set gdm-theme.gresource "$GRES_TARGET" 2>/dev/null || true
        fi
    fi
    if [ -f /usr/share/gnome-shell/gnome-shell-icons.gresource ]; then
        if command -v update-alternatives >/dev/null 2>&1; then
            sudo update-alternatives --set gdm-icons.gresource /usr/share/gnome-shell/gnome-shell-icons.gresource 2>/dev/null || true
        fi
    fi

    # 9. Configuring user avatar in AccountsService
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

    sudo mkdir -p /etc/dconf/db/gdm.d
    printf '[org/gnome/login-screen]\nenable-fingerprint-authentication=false\n' | sudo tee /etc/dconf/db/gdm.d/99-macw1y-auth >/dev/null
    run_as_user gsettings set org.gnome.shell.extensions.wack-lockscreen-clock lockscreen-mode 'cupertino' 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.wack-lockscreen-clock cupertino-always-show-user true 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.wack-lockscreen-clock lockscreen-wallpaper-enable false 2>/dev/null || true
    run_as_user gsettings set org.gnome.shell.extensions.wack-lockscreen-clock lockscreen-wallpaper-path "/usr/share/backgrounds/GoldenGate_Day.jpg" 2>/dev/null || true
    run_as_user gsettings set org.gnome.desktop.screensaver picture-uri "file:///usr/share/backgrounds/GoldenGate_Day.jpg" 2>/dev/null || true

    # 11. Disabling automatic login to display GDM lock screen
    local gdm_config=/etc/gdm/custom.conf
    [ ! -f /etc/gdm3/custom.conf ] || gdm_config=/etc/gdm3/custom.conf
    if [ -f "$gdm_config" ]; then
        sudo sed -i 's|^AutomaticLoginEnable=.*|AutomaticLoginEnable=false|' "$gdm_config"
        sudo sed -i "s|^AutomaticLogin=.*|# AutomaticLogin=$TARGET_USER|" "$gdm_config"
    fi

    sudo dconf update 2>/dev/null || true
    install_gnome_shell_overlay
    log_success "macW1Y GDM lock screen configured successfully!"
}

# ------------------------------------------------------------------------------
# 12. Plymouth macW1Y Boot Splash
# ------------------------------------------------------------------------------
install_plymouth() {
    log_step "Stage 12/13: Installing macW1Y Plymouth boot splash"
    require_root
    
    local PLYMOUTH_TARGET="/usr/share/plymouth/themes/macw1y-boot"
    if [ -d "$SCRIPT_DIR/plymouth/macw1y-boot" ]; then
        sudo mkdir -p "$PLYMOUTH_TARGET"
        sudo cp -r "$SCRIPT_DIR/plymouth/macw1y-boot/"* "$PLYMOUTH_TARGET/"
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

    if [ -d "$SCRIPT_DIR/systemd/plymouth-start.service.d" ]; then
        sudo mkdir -p /etc/systemd/system/plymouth-start.service.d
        sudo cp -r "$SCRIPT_DIR/systemd/plymouth-start.service.d/"* /etc/systemd/system/plymouth-start.service.d/
    fi
    sudo systemctl daemon-reload 2>/dev/null || true
    sudo systemctl enable plymouth-verbose-logger.service 2>/dev/null || true
    
    if [ -f "$SCRIPT_DIR/systemd/plymouth-quit.service.d/override.conf" ]; then
        sudo mkdir -p /etc/systemd/system/plymouth-quit.service.d
        sudo cp "$SCRIPT_DIR/systemd/plymouth-quit.service.d/override.conf" /etc/systemd/system/plymouth-quit.service.d/
    fi
    
    if [ -d /etc/initramfs-tools ] && [ -f "$SCRIPT_DIR/etc/initramfs-tools/modules" ]; then
        while IFS= read -r module; do
            case "$module" in ''|\#*) continue ;; esac
            if ! grep -Fxq "$module" /etc/initramfs-tools/modules; then
                printf '%s\n' "$module" | sudo tee -a /etc/initramfs-tools/modules >/dev/null
            fi
        done < "$SCRIPT_DIR/etc/initramfs-tools/modules"
    fi
    
    if [ -d "$SCRIPT_DIR/dracut.conf.d" ]; then
        sudo mkdir -p /etc/dracut.conf.d
        if modinfo i915 >/dev/null 2>&1; then
            sudo cp -r "$SCRIPT_DIR/dracut.conf.d/"* /etc/dracut.conf.d/ 2>/dev/null || true
        fi
    fi
    
    # Registering theme in Plymouth alternatives and setting default
    if [ -f "$PLYMOUTH_TARGET/macw1y-boot.plymouth" ]; then
        if command -v update-alternatives >/dev/null 2>&1; then
            sudo update-alternatives --install /usr/share/plymouth/themes/default.plymouth default.plymouth "$PLYMOUTH_TARGET/macw1y-boot.plymouth" 200 2>/dev/null || true
            sudo update-alternatives --set default.plymouth "$PLYMOUTH_TARGET/macw1y-boot.plymouth" 2>/dev/null || true
        fi
        if command -v plymouth-set-default-theme >/dev/null 2>&1; then
            sudo plymouth-set-default-theme macw1y-boot 2>/dev/null || true
        fi
        sudo mkdir -p /etc/plymouth
        sudo tee /etc/plymouth/plymouthd.conf >/dev/null << 'EOF'
[Daemon]
Theme=macw1y-boot
ShowDelay=0
DeviceTimeout=8
EOF
    fi
    
    emit_progress 96 "stage12" "Regenerating initramfs image"
    log_info "Updating initramfs..."
    macw1y_rebuild_initramfs
    log_success "macW1Y Boot Splash activated successfully!"
}

# ------------------------------------------------------------------------------
# 13. GRUB macW1Y Boot Manager
# ------------------------------------------------------------------------------
install_grub() {
    log_step "Stage 13/13: Installing macW1Y horizontal GRUB boot menu"
    require_root
    
    if ! macw1y_has_grub; then
        log_info "No active GRUB configuration required; skipping GRUB setup."
        return 0
    fi

    # Ensure /boot/grub exists (symlink to /boot/grub2 on Fedora/RHEL if needed)
    if [ -d /boot/grub2 ] && [ ! -d /boot/grub ]; then
        sudo ln -sf grub2 /boot/grub 2>/dev/null || true
    fi
    
    local GRUB_TARGET="/boot/grub/themes/macw1y-boot"
    if [ -d "$SCRIPT_DIR/grub/macw1y-boot" ]; then
        sudo mkdir -p "$GRUB_TARGET"
        sudo cp -r "$SCRIPT_DIR/grub/macw1y-boot/"* "$GRUB_TARGET/"
    fi

    local GRUB_USB_TARGET="/boot/grub/themes/macw1y-boot-usb"
    if [ -d "$SCRIPT_DIR/grub/macw1y-boot-usb" ]; then
        sudo mkdir -p "$GRUB_USB_TARGET"
        sudo cp -r "$SCRIPT_DIR/grub/macw1y-boot-usb/"* "$GRUB_USB_TARGET/"
    fi
    sudo ln -sfn macw1y-boot /boot/grub/themes/apple-mac 2>/dev/null || true
    sudo ln -sfn macw1y-boot-usb /boot/grub/themes/apple-mac-usb 2>/dev/null || true
    
    if [ "$DISTRO_ID" = "ubuntu" ]; then
        [ -f /etc/default/grub ] && [ ! -f /etc/default/grub.bak_mactheme ] && sudo cp /etc/default/grub /etc/default/grub.bak_mactheme
        [ -f /etc/grub.d/10_linux ] && [ ! -f /etc/grub.d/10_linux.bak_mactheme ] && sudo cp /etc/grub.d/10_linux /etc/grub.d/10_linux.bak_mactheme

        if [ -f "$SCRIPT_DIR/grub/grub.default" ]; then
            sudo cp "$SCRIPT_DIR/grub/grub.default" /etc/default/grub
        else
            sudo sed -i "s/^GRUB_THEME=.*/#GRUB_THEME=\"\/boot\/grub\/themes\/macw1y-boot\/theme.txt\"/" /etc/default/grub
        fi

        if [ -f "$SCRIPT_DIR/grub/10_linux" ]; then
            sudo cp "$SCRIPT_DIR/grub/10_linux" /etc/grub.d/10_linux
            sudo chmod 755 /etc/grub.d/10_linux
        fi

        if [ -f "$SCRIPT_DIR/grub/30_uefi-firmware" ]; then
            sudo cp "$SCRIPT_DIR/grub/30_uefi-firmware" /etc/grub.d/30_uefi-firmware
            sudo chmod 644 /etc/grub.d/30_uefi-firmware
        fi

        if [ -f "$SCRIPT_DIR/grub/patch_grub_keys.py" ]; then
            log_info "Applying binary key navigation patches for GRUB..."
            sudo python3 "$SCRIPT_DIR/grub/patch_grub_keys.py" 2>/dev/null || true
        fi
    else
        # Non-Ubuntu (Debian, Fedora, Arch, CachyOS):
        # 1. Restore native 10_linux if previously overwritten
        if [ -f /etc/grub.d/10_linux.bak_mactheme ]; then
            sudo cp /etc/grub.d/10_linux.bak_mactheme /etc/grub.d/10_linux
            sudo rm -f /etc/grub.d/10_linux.bak_mactheme
        fi
        # 2. Restore native /etc/default/grub if it was overwritten with Ubuntu template
        if [ -f /etc/default/grub.bak_mactheme ] && grep -q 'GRUB_DEFAULT="Ubuntu"' /etc/default/grub 2>/dev/null; then
            sudo cp /etc/default/grub.bak_mactheme /etc/default/grub
        fi
        # 3. Non-destructively configure macW1Y theme and gfxmode in /etc/default/grub
        if [ -f /etc/default/grub ]; then
            [ ! -f /etc/default/grub.bak_mactheme ] && sudo cp /etc/default/grub /etc/default/grub.bak_mactheme
            if grep -q '^GRUB_THEME=' /etc/default/grub; then
                sudo sed -i 's|^GRUB_THEME=.*|#GRUB_THEME="/boot/grub/themes/macw1y-boot/theme.txt"|' /etc/default/grub
            fi
            if ! grep -q '^GRUB_GFXMODE=' /etc/default/grub; then
                echo 'GRUB_GFXMODE="3840x2160,2560x1440,1920x1080,auto"' | sudo tee -a /etc/default/grub >/dev/null
            fi
            if ! grep -q '^GRUB_GFXPAYLOAD_LINUX=' /etc/default/grub; then
                echo 'GRUB_GFXPAYLOAD_LINUX="keep"' | sudo tee -a /etc/default/grub >/dev/null
            fi
        fi
    fi

    if [ -f "$SCRIPT_DIR/grub/06_mac_theme_select" ]; then
        sudo cp "$SCRIPT_DIR/grub/06_mac_theme_select" /etc/grub.d/06_mac_theme_select
        sudo chmod 755 /etc/grub.d/06_mac_theme_select
    fi

    if [ -f "$SCRIPT_DIR/grub/08_mac_usb_entry" ]; then
        sudo cp "$SCRIPT_DIR/grub/08_mac_usb_entry" /etc/grub.d/08_mac_usb_entry
        sudo chmod 755 /etc/grub.d/08_mac_usb_entry
    fi

    if [ -f "$SCRIPT_DIR/grub/40_custom" ]; then
        sudo cp "$SCRIPT_DIR/grub/40_custom" /etc/grub.d/40_custom
        sudo chmod 755 /etc/grub.d/40_custom
    fi

    sudo mkdir -p /usr/share/mactheme/grub
    if [ -f "$SCRIPT_DIR/grub/generate_icons.py" ]; then
        log_info "Generating transparent macW1Y icons and GRUB status widgets..."
        sudo cp -f "$SCRIPT_DIR/grub/generate_icons.py" /usr/share/mactheme/grub/generate_icons.py
        sudo chown root:root /usr/share/mactheme/grub/generate_icons.py
        sudo chmod 755 /usr/share/mactheme/grub/generate_icons.py
        sudo python3 /usr/share/mactheme/grub/generate_icons.py 2>/dev/null || true
    fi

    if [ -f "$SCRIPT_DIR/systemd/mac-grub-status.service" ]; then
        sudo cp -f "$SCRIPT_DIR/systemd/mac-grub-status.service" /etc/systemd/system/
        sudo chown root:root /etc/systemd/system/mac-grub-status.service
        sudo chmod 644 /etc/systemd/system/mac-grub-status.service
        sudo systemctl daemon-reload
        sudo systemctl enable mac-grub-status.service 2>/dev/null || true
    fi

    emit_progress 98 "stage13" "Regenerating GRUB bootloader configuration"
    log_info "Updating GRUB configuration..."
    if command -v update-grub >/dev/null 2>&1; then
        sudo update-grub 2>/dev/null || true
    elif command -v grub2-mkconfig >/dev/null 2>&1; then
        sudo grub2-mkconfig -o /boot/grub2/grub.cfg 2>/dev/null || true 2>/dev/null || true
    elif command -v grub-mkconfig >/dev/null 2>&1; then
        sudo grub-mkconfig -o /boot/grub/grub.cfg 2>/dev/null || true
    fi
    log_success "macW1Y boot manager menu installed successfully!"
}

# ------------------------------------------------------------------------------
# Finalization and Component Restart
# ------------------------------------------------------------------------------
finalize_installation() {
    log_step "Finalizing and applying changes"
    
    save_version "$NEW_VERSION"
    
    log_info "Restarting shell components..."
    run_as_user gnome-extensions disable blur-my-shell@aunetx 2>/dev/null || true
    sleep 1
    run_as_user gnome-extensions enable blur-my-shell@aunetx 2>/dev/null || true
    
    # Sanitizing and optimizing pinned Dock applications
    if [ -x "/usr/local/bin/mac-sanitize-favorites.sh" ]; then
        run_as_user /usr/local/bin/mac-sanitize-favorites.sh 2>/dev/null || true
    fi

    log_info "Configuring memory arena thresholds and trimming background services..."
    sudo bash -c 'cat << "EOF_MEM" > /etc/environment
PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin"
MALLOC_ARENA_MAX=2
MALLOC_TRIM_THRESHOLD_=131072
MALLOC_MMAP_THRESHOLD_=131072
EOF_MEM' 2>/dev/null || true

    mkdir -p "$TARGET_HOME/.config/environment.d"
    cat << 'EOF_MEMCONF' > "$TARGET_HOME/.config/environment.d/60-memory-opt.conf"
MALLOC_ARENA_MAX=2
MALLOC_TRIM_THRESHOLD_=131072
MALLOC_MMAP_THRESHOLD_=131072
EOF_MEMCONF
    chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.config/environment.d" 2>/dev/null || true

    # Mask unneeded evolution data services to conserve RAM
    run_as_user systemctl --user stop evolution-addressbook-factory.service evolution-calendar-factory.service evolution-source-registry.service 2>/dev/null || true
    run_as_user systemctl --user mask evolution-addressbook-factory.service evolution-calendar-factory.service evolution-source-registry.service 2>/dev/null || true
    mkdir -p "$TARGET_HOME/.config/autostart"
    cat << 'EOF_EVO' > "$TARGET_HOME/.config/autostart/org.gnome.Evolution-alarm-notify.desktop"
[Desktop Entry]
Type=Application
Name=Evolution Alarm Notify
Hidden=true
EOF_EVO
    chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.config/autostart" 2>/dev/null || true

    # Configure Liquid Glass downscale to 2 for optimal RAM footprint
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com glass-blur-downscale 2 2>/dev/null || true

    if [ "$APPLY_LOW_SPEC" = "true" ]; then
        log_info "Applying Intel HD and low-spec hardware optimizations (ZRAM, sysctl, Eco profile)..."
        if [ -x "/usr/local/bin/mac-lowspec-optimizer" ]; then
            /usr/local/bin/mac-lowspec-optimizer apply || true
        elif [ -x "$SCRIPT_DIR/bin/mac-lowspec-optimizer" ]; then
            "$SCRIPT_DIR/bin/mac-lowspec-optimizer" apply || true
        fi
    fi

    # Security hardening: ensure all system files are strictly owned by root:root and safe
    log_info "Verifying system file security and root permissions..."
    sudo rm -f /etc/sudoers.d/99-mactheme /etc/sudoers.d/99_mactheme 2>/dev/null || true
    sudo chown root:root /usr/local/bin/* /usr/local/lib/* 2>/dev/null || true
    sudo chmod 755 /usr/local/bin/* 2>/dev/null || true
    sudo chmod 644 /usr/local/lib/*.so* 2>/dev/null || true
    sudo chown -R root:root /usr/share/mactheme /etc/sudoers.d 2>/dev/null || true
    sudo chmod 440 /etc/sudoers.d/* 2>/dev/null || true
    
    emit_progress 100 "finalizing" "Installation completed successfully"

    echo -e "\n${C_GREEN}═══════════════════════════════════════════════════════════════════════${C_RESET}"
    echo -e " ${C_BOLD}${C_GREEN}✔ macW1Y v${NEW_VERSION} INSTALLATION / UPDATE COMPLETED SUCCESSFULLY!${C_RESET}"
    echo -e "${C_GREEN}═══════════════════════════════════════════════════════════════════════${C_RESET}"
    echo -e " ${C_CYAN}All macW1Y Modpack components successfully deployed:${C_RESET}"
    echo -e "   • macW1Y-Dark UI theme and icons"
    echo -e "   • Default Pro fonts"
    echo -e "   • Liquid Glass menu bar with 8px margins and macW1Y Menu"
    echo -e "   • Control Center and system Settings with Mac Styling panel"
    echo -e "   • Multi-touch macW1Y touchpad gestures (3-finger drag, pinch copy/paste)"
    echo -e "   • Game Mode and GPU graphics management"
    echo -e "   • macW1Y GRUB boot menu and Plymouth boot splash"
    echo -e "   • Smooth GDM transition with seamless wallpaper alignment"
    echo -e "\n ${C_YELLOW}It is recommended to log out and log back in (or restart your PC),${C_RESET}"
    echo -e " ${C_YELLOW}for all environment variables and overlays to take full effect.${C_RESET}\n"
}

# ------------------------------------------------------------------------------
# Main Execution Modes (Run Modes)
# ------------------------------------------------------------------------------

# 1. Full Installation
run_full_install() {
    python3 "$SCRIPT_DIR/dependencies/check-platform.py" "$SCRIPT_DIR" || return 1
    install_dependencies
    python3 "$SCRIPT_DIR/dependencies/check-platform.py" "$SCRIPT_DIR" || return 1
    bash "$SCRIPT_DIR/dependencies/build-native.sh" "$SCRIPT_DIR/lib"
    [ -d "$SCRIPT_DIR/control-center" ] && cp -f "$SCRIPT_DIR/lib/libmac_settings.so" "$SCRIPT_DIR/control-center/libmac_settings.so" 2>/dev/null || true
    [ -d "$SCRIPT_DIR/gnome-control-center-overlay" ] && cp -f "$SCRIPT_DIR/lib/libmac_settings.so" "$SCRIPT_DIR/gnome-control-center-overlay/libmac_settings.so" 2>/dev/null || true
    sudo install -Dm644 "$SCRIPT_DIR/config/extensions.lock.json" /usr/share/mactheme/config/extensions.lock.json
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

# 2. Incremental Update [installed version] -> [new version]
# Verifies every file, replaces modified, and adds missing
run_incremental_update() {
    python3 "$SCRIPT_DIR/dependencies/check-platform.py" "$SCRIPT_DIR" || return 1
    local cur_ver="$1"
    local new_ver="$2"
    
    log_step "Update [v$cur_ver] -> [v$new_ver]: Verifying and syncing modified or missing files"
    require_root
    
    bash "$SCRIPT_DIR/dependencies/build-native.sh" "$SCRIPT_DIR/lib"
    [ -d "$SCRIPT_DIR/control-center" ] && cp -f "$SCRIPT_DIR/lib/libmac_settings.so" "$SCRIPT_DIR/control-center/libmac_settings.so" 2>/dev/null || true
    [ -d "$SCRIPT_DIR/gnome-control-center-overlay" ] && cp -f "$SCRIPT_DIR/lib/libmac_settings.so" "$SCRIPT_DIR/gnome-control-center-overlay/libmac_settings.so" 2>/dev/null || true
    sudo install -Dm644 "$SCRIPT_DIR/config/extensions.lock.json" /usr/share/mactheme/config/extensions.lock.json
    MODIFIED_COUNT=0
    UNCHANGED_COUNT=0
    
    log_info "1/10 Checking fonts..."
    sync_directory_tree "$SCRIPT_DIR/fonts/SF_Pro" "$TARGET_HOME/.local/share/fonts/SF_Pro" false
    sync_directory_tree "$SCRIPT_DIR/fonts/SF_Pro" "/usr/local/share/fonts/SF_Pro" true
    sync_directory_tree "$SCRIPT_DIR/fonts/Open_Runde" "$TARGET_HOME/.local/share/fonts/Open_Runde" false
    sync_directory_tree "$SCRIPT_DIR/fonts/Open_Runde" "/usr/local/share/fonts/Open_Runde" true
    
    log_info "2/10 Checking UI themes..."
    sync_directory_tree "$SCRIPT_DIR/macW1Y-Dark" "$TARGET_HOME/.themes/macW1Y-Dark" false
    sync_directory_tree "$SCRIPT_DIR/macW1Y-Dark-solid" "$TARGET_HOME/.themes/macW1Y-Dark-solid" false
    ln -sfn "macW1Y-Dark" "$TARGET_HOME/.themes/macW1Y-Dark"
    ln -sfn "macW1Y-Dark-solid" "$TARGET_HOME/.themes/macW1Y-Dark-solid"
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
        install_mac_shared_lib "$SCRIPT_DIR/lib/libmacpopover.so"
    fi
    if [ -f "$SCRIPT_DIR/lib/libmac_terminal.so" ]; then
        install_mac_shared_lib "$SCRIPT_DIR/lib/libmac_terminal.so"
    fi
    if [ -f "$SCRIPT_DIR/bin/ptyxis" ]; then
        sync_or_update_file "$SCRIPT_DIR/bin/ptyxis" "/usr/local/bin/ptyxis" true
        sudo chmod 755 /usr/local/bin/ptyxis 2>/dev/null || true
    fi
    if [ -f "$SCRIPT_DIR/lib/libmac_memtrim.so" ]; then
        install_mac_shared_lib "$SCRIPT_DIR/lib/libmac_memtrim.so"
    fi
    if [ -f "$SCRIPT_DIR/lib/MacMemTrim-1.0.typelib" ]; then
        install_mac_typelib "$SCRIPT_DIR/lib/MacMemTrim-1.0.typelib"
    fi

    log_info "3/10 Checking icon themes..."
    for theme_dir in macW1Y macW1Y-dark macW1Y-light; do
        if [ -d "$SCRIPT_DIR/icons/$theme_dir" ]; then
            sync_directory_tree "$SCRIPT_DIR/icons/$theme_dir" "$TARGET_HOME/.local/share/icons/$theme_dir" false
        fi
    done
    ln -sfn "macW1Y-dark" "$TARGET_HOME/.local/share/icons/macW1Y-dark"
    ln -sfn "macW1Y-dark" "$TARGET_HOME/.local/share/icons/macW1Y-Dark"
    ln -sfn "macW1Y" "$TARGET_HOME/.local/share/icons/macW1Y"
    mkdir -p "$TARGET_HOME/.icons" "$TARGET_HOME/.local/share/icons/default" "$TARGET_HOME/.icons/default"
    ln -sfn "$TARGET_HOME/.local/share/icons/macW1Y" "$TARGET_HOME/.icons/macW1Y"
    ln -sfn "$TARGET_HOME/.local/share/icons/macW1Y" "$TARGET_HOME/.icons/macW1Y"
    ln -sfn "$TARGET_HOME/.local/share/icons/macW1Y-dark" "$TARGET_HOME/.icons/macW1Y-dark"
    ln -sfn "$TARGET_HOME/.local/share/icons/macW1Y-dark" "$TARGET_HOME/.icons/macW1Y-Dark"
    ln -sfn "$TARGET_HOME/.local/share/icons/macW1Y-dark" "$TARGET_HOME/.icons/macW1Y-dark"

    cat << 'EOF_DEF_THEME_UP' > "$TARGET_HOME/.local/share/icons/default/index.theme"
[Icon Theme]
Name=Default
Comment=Default Cursor Theme
Inherits=macW1Y
EOF_DEF_THEME_UP
    cp -f "$TARGET_HOME/.local/share/icons/default/index.theme" "$TARGET_HOME/.icons/default/index.theme"
    cat << 'EOF_CUR_THEME_UP' > "$TARGET_HOME/.local/share/icons/macW1Y/cursor.theme"
[Icon Theme]
Name=macW1Y
Comment=macW1Y macW1Y Cursor Theme
Inherits=macW1Y
EOF_CUR_THEME_UP

    if [ -w "/usr/share/icons" ] || sudo -n true 2>/dev/null; then
        sudo ln -sfn "$TARGET_HOME/.local/share/icons/macW1Y" /usr/share/icons/macW1Y
        sudo ln -sfn "$TARGET_HOME/.local/share/icons/macW1Y" /usr/share/icons/macW1Y
        sudo update-alternatives --install /usr/share/icons/default/index.theme x-cursor-theme "$TARGET_HOME/.local/share/icons/macW1Y/cursor.theme" 100 2>/dev/null || true
        sudo update-alternatives --set x-cursor-theme "$TARGET_HOME/.local/share/icons/macW1Y/cursor.theme" 2>/dev/null || true
    fi
    sync_or_update_file "$SCRIPT_DIR/icons/control-center.png" "$TARGET_HOME/.local/share/icons/hicolor/scalable/apps/control-center.png" false
    sync_or_update_file "$SCRIPT_DIR/icons/control-center-symbolic.svg" "$TARGET_HOME/.local/share/icons/hicolor/scalable/apps/control-center-symbolic.svg" false
    run_as_user gsettings set org.gnome.desktop.interface icon-theme "macW1Y-dark" 2>/dev/null || true

    log_info "4/10 Checking macW1Y sound theme..."
    if [ -d "$SCRIPT_DIR/sounds/macW1Y" ]; then
        sync_directory_tree "$SCRIPT_DIR/sounds/macW1Y" "$TARGET_HOME/.local/share/sounds/macW1Y" false
        if [ -w "/usr/share/sounds" ] || sudo -n true 2>/dev/null; then
            sudo mkdir -p /usr/share/sounds/macW1Y
            sync_directory_tree "$SCRIPT_DIR/sounds/macW1Y" "/usr/share/sounds/macW1Y" true
        fi
        run_as_user gsettings set org.gnome.desktop.sound theme-name 'macW1Y' 2>/dev/null || true
        run_as_user gsettings set org.gnome.desktop.sound event-sounds true 2>/dev/null || true
        run_as_user gsettings set org.gnome.desktop.sound input-feedback-sounds true 2>/dev/null || true
    fi
    if [ -f "$SCRIPT_DIR/bin/mac-login-sound" ]; then
        sync_or_update_file "$SCRIPT_DIR/bin/mac-login-sound" "/usr/local/bin/mac-login-sound" true
        sudo chmod 755 /usr/local/bin/mac-login-sound
    fi
    if [ -f "$SCRIPT_DIR/autostart/macw1y-login-sound.desktop" ]; then
        sync_or_update_file "$SCRIPT_DIR/autostart/macw1y-login-sound.desktop" "$TARGET_HOME/.config/autostart/macw1y-login-sound.desktop" false
    fi
    if [ -f "/usr/share/gdm/autostart/LoginWindow/libcanberra-ready-sound.desktop" ]; then
        sudo sed -i 's/^X-GNOME-Autostart-enabled=.*/X-GNOME-Autostart-enabled=false/' /usr/share/gdm/autostart/LoginWindow/libcanberra-ready-sound.desktop 2>/dev/null || true
        grep -q "X-GNOME-Autostart-enabled=false" /usr/share/gdm/autostart/LoginWindow/libcanberra-ready-sound.desktop || echo "X-GNOME-Autostart-enabled=false" | sudo tee -a /usr/share/gdm/autostart/LoginWindow/libcanberra-ready-sound.desktop >/dev/null
        grep -q "Hidden=true" /usr/share/gdm/autostart/LoginWindow/libcanberra-ready-sound.desktop || echo "Hidden=true" | sudo tee -a /usr/share/gdm/autostart/LoginWindow/libcanberra-ready-sound.desktop >/dev/null
    fi

    log_info "5/10 Checking wallpaper and Live Wallpaper assets..."
    if [ -f "$SCRIPT_DIR/wallpapers/GoldenGate_Day.jpg" ]; then
        sync_or_update_file "$SCRIPT_DIR/wallpapers/GoldenGate_Day.jpg" "/usr/share/backgrounds/GoldenGate_Day.jpg" true
    fi
    for wp_vid in "$SCRIPT_DIR/wallpapers"/GoldenGate_Live_loop.* "$SCRIPT_DIR/wallpapers"/Golden\ Gate.mov; do
        if [ -f "$wp_vid" ]; then
            local bname="$(basename "$wp_vid")"
            sync_or_update_file "$wp_vid" "/usr/share/backgrounds/$bname" true
        fi
    done
    if [ -f "$SCRIPT_DIR/wallpapers/macw1y-wallpapers.xml" ]; then
        sync_or_update_file "$SCRIPT_DIR/wallpapers/macw1y-wallpapers.xml" "/usr/share/gnome-background-properties/macw1y-wallpapers.xml" true
    fi

    log_info "6/10 Checking GNOME Shell extensions..."
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
        local EXT_LIST=(
            "user-theme@gnome-shell-extensions.gcampax.github.com"
            "ubuntu-appindicators@ubuntu.com"
            "compiz-alike-magic-lamp-effect@hermes83.github.com"
            "Rounded_Corners@lennart-k"
            "macw1y-touchpad-gestures@mactheme"
            "custom-command-toggle@storageb.github.com"
            "volume-percentage-quick-settings@imdarktom"
            "quick-settings-scroll@diskmth.fr"
            "wifi-hotspot-quick-settings@aryan10.github.io"
            "dash2dock-motion@unmade.space"
            "top-bar-organizer@julian.gse.jsts.xyz"
            "run-cmd@custom.extension"
            "cupertino-dock-lite@rinzler69-wastaken.github.com"
            "wack-lockscreen-clock@rinzler69-wastaken.github.com"
            "ding@rastersoft.com"
            "eval-helper@mactheme"
            "blur-my-shell@aunetx"
            "liquid-glass@thinkingcoding1231.gmail.com"
            "appmenu@ChathurangaBW.github.io"
            "kiwi@kemma"
            "desktop-widgets@r3nhick"
        )
        for ext_id in "${EXT_LIST[@]}"; do
            run_as_user gnome-extensions enable "$ext_id" 2>/dev/null || true
        done
        local UBUNTU_BLOAT_EXTS=(
            "dash-to-dock@micxgx.gmail.com"
            "snapd-prompting@canonical.com"
            "snapd-search-provider@canonical.com"
            "web-search-provider@ubuntu.com"
            "tiling-assistant@ubuntu.com"
            "ubuntu-dock@ubuntu.com"
        )
        for ext_id in "${UBUNTU_BLOAT_EXTS[@]}"; do
            run_as_user gnome-extensions disable "$ext_id" 2>/dev/null || true
        done

        local motion_check
        motion_check="$(run_as_user dconf dump /org/gnome/shell/extensions/dash2dock-motion/ 2>/dev/null || true)"
        if [ -z "$motion_check" ] && [ -f "$SCRIPT_DIR/dconf/gnome-all.dconf" ]; then
            if command -v awk >/dev/null 2>&1; then
                awk '
                    BEGIN { skip=0 }
                    /^\[org\/gnome\/desktop\/input-sources\]/ { skip=1; next }
                    /^\[org\/gnome\/login-screen\]/ { skip=1; next }
                    /^\[/ { skip=0 }
                    !skip { print }
                ' "$SCRIPT_DIR/dconf/gnome-all.dconf" | run_as_user dconf load / 2>/dev/null || true
            else
                run_as_user dconf load / < "$SCRIPT_DIR/dconf/gnome-all.dconf" 2>/dev/null || true
            fi
        fi

        # System gschema overrides
        if [ -f "$SCRIPT_DIR/extensions/desktop-widgets@r3nhick/schemas/org.gnome.shell.extensions.desktop-widgets-r3nhick.gschema.xml" ]; then
            sudo cp "$SCRIPT_DIR/extensions/desktop-widgets@r3nhick/schemas/org.gnome.shell.extensions.desktop-widgets-r3nhick.gschema.xml" /usr/share/glib-2.0/schemas/
            sudo chmod 644 /usr/share/glib-2.0/schemas/org.gnome.shell.extensions.desktop-widgets-r3nhick.gschema.xml
        fi
        if [ -f "$SCRIPT_DIR/macw1y-gdm/99_mactheme.gschema.override" ]; then
            sudo cp "$SCRIPT_DIR/macw1y-gdm/99_mactheme.gschema.override" /usr/share/glib-2.0/schemas/
            sudo chmod 644 /usr/share/glib-2.0/schemas/99_mactheme.gschema.override
            sudo glib-compile-schemas /usr/share/glib-2.0/schemas/ 2>/dev/null || true
        fi

        # Extension watchdog autostart script (unload protection)
        if [ -f "$SCRIPT_DIR/bin/mac-ensure-extensions.sh" ]; then
            sync_or_update_file "$SCRIPT_DIR/bin/mac-ensure-extensions.sh" "/usr/local/bin/mac-ensure-extensions.sh" true
            sudo chmod +x /usr/local/bin/mac-ensure-extensions.sh
            [ -f "$SCRIPT_DIR/autostart/mac-ensure-extensions.desktop" ] && sync_or_update_file "$SCRIPT_DIR/autostart/mac-ensure-extensions.desktop" "/etc/xdg/autostart/mac-ensure-extensions.desktop" true
        fi
        run_as_user systemctl --user unmask localsearch-3.service tracker-miner-fs-3.service 2>/dev/null || true
        run_as_user systemctl --user stop snap.snapd-desktop-integration.snapd-desktop-integration.service 2>/dev/null || true
        run_as_user systemctl --user mask snap.snapd-desktop-integration.snapd-desktop-integration.service 2>/dev/null || true
        run_as_user gsettings set org.freedesktop.Tracker3.Miner.Files index-recursive-directories "[]" 2>/dev/null || true
        run_as_user gsettings set org.freedesktop.Tracker3.Miner.Files index-single-directories "[]" 2>/dev/null || true
        run_as_user gsettings set org.freedesktop.Tracker3.Miner.Files throttle 20 2>/dev/null || true
    fi

    log_info "7/10 Checking Settings components (GNOME Control Center Overlay)..."
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
        install_mac_shared_lib "$SCRIPT_DIR/lib/libmac_settings.so"
        sync_or_update_file "$SCRIPT_DIR/lib/libmac_settings.so" "/usr/share/mactheme/gnome-control-center-overlay/libmac_settings.so" true
        sudo chmod 755 /usr/share/mactheme/gnome-control-center-overlay/libmac_settings.so 2>/dev/null || true
    fi
    sudo mkdir -p /usr/share/mactheme/gnome-control-center-overlay 2>/dev/null || true
    if [ -d "$SCRIPT_DIR/gnome-control-center-overlay" ]; then
        sudo cp -f "$SCRIPT_DIR/gnome-control-center-overlay"/cc-*.ui /usr/share/mactheme/gnome-control-center-overlay/ 2>/dev/null || true
        sudo chmod 644 /usr/share/mactheme/gnome-control-center-overlay/* 2>/dev/null || true
    fi
    install_app_wrapper gnome-control-center
    if [ -f "$SCRIPT_DIR/lib/libmac_extension_manager.so" ]; then
        sync_or_update_file "$SCRIPT_DIR/lib/libmac_extension_manager.so" "$LOCAL_LIB/libmac_extension_manager.so" false
    fi
    for b in gnome-control-center mac-widgets-settings mac-styling-settings mac-apply-theme mac-theme-sync mac-extension-guard mac-integrity-check mac-diagnostics toggle-launchpad.sh extension-manager mac-setup-wizard mac-apply-locale mac-gdm-bypass macW1Y mac_i18n.py; do
        if [ -f "$SCRIPT_DIR/bin/$b" ]; then
            sync_or_update_file "$SCRIPT_DIR/bin/$b" "$LOCAL_BIN/$b" false
            chmod +x "$LOCAL_BIN/$b" 2>/dev/null || true
            sudo cp -f "$SCRIPT_DIR/bin/$b" "/usr/local/bin/$b" 2>/dev/null || true
            sudo chmod 755 "/usr/local/bin/$b" 2>/dev/null || true
        fi
    done
    local purelib
    purelib=$(python3 -c "import sysconfig; print(sysconfig.get_path('purelib'))" 2>/dev/null || true)
    if [ -n "$purelib" ] && [ -d "$purelib" ] && [ -f "$SCRIPT_DIR/bin/mac_i18n.py" ]; then
        sudo install -Dm644 "$SCRIPT_DIR/bin/mac_i18n.py" "$purelib/mac_i18n.py" 2>/dev/null || true
    fi
    if [ -f "$SCRIPT_DIR/bin/macW1Y" ]; then
        sudo ln -sf /usr/local/bin/macW1Y /usr/local/bin/macw1y 2>/dev/null || true
        sudo ln -sf /usr/local/bin/macW1Y /usr/bin/macW1Y 2>/dev/null || true
        sudo ln -sf /usr/local/bin/macW1Y /usr/bin/macw1y 2>/dev/null || true
    fi
    if [ -f "$SCRIPT_DIR/bin/mac-gdm-bypass" ]; then
        sudo ln -sf mac-gdm-bypass /usr/local/bin/mac-GDM-BYPASS 2>/dev/null || true
        sudo ln -sf /usr/local/bin/mac-gdm-bypass /usr/bin/mac-gdm-bypass 2>/dev/null || true
        sudo ln -sf /usr/local/bin/mac-gdm-bypass /usr/bin/mac-GDM-BYPASS 2>/dev/null || true
    fi

    # Installing and enabling macW1Y theme sync daemon
    if [ -f "$SCRIPT_DIR/systemd/mac-theme-sync.service" ]; then
        local USER_SYSTEMD="$TARGET_HOME/.config/systemd/user"
        mkdir -p "$USER_SYSTEMD"
        sync_or_update_file "$SCRIPT_DIR/systemd/mac-theme-sync.service" "$USER_SYSTEMD/mac-theme-sync.service" false
        run_as_user systemctl --user daemon-reload 2>/dev/null || true
        run_as_user systemctl --user enable --now mac-theme-sync.service 2>/dev/null || true
    fi

    # Installing and enabling mac-app-manager user service (replaces autostart mac-sync-applications)
    if [ -f "$SCRIPT_DIR/systemd/mac-app-manager.service" ]; then
        local USER_SYSTEMD="$TARGET_HOME/.config/systemd/user"
        mkdir -p "$USER_SYSTEMD"
        sync_or_update_file "$SCRIPT_DIR/systemd/mac-app-manager.service" "$USER_SYSTEMD/mac-app-manager.service" false
        run_as_user systemctl --user daemon-reload 2>/dev/null || true
        run_as_user systemctl --user enable --now mac-app-manager.service 2>/dev/null || true
    fi

    # Installing and enabling mac-screenshot-daemon user service
    if [ -f "$SCRIPT_DIR/systemd/mac-screenshot-daemon.service" ]; then
        local USER_SYSTEMD="$TARGET_HOME/.config/systemd/user"
        mkdir -p "$USER_SYSTEMD"
        sync_or_update_file "$SCRIPT_DIR/systemd/mac-screenshot-daemon.service" "$USER_SYSTEMD/mac-screenshot-daemon.service" false
        run_as_user systemctl --user daemon-reload 2>/dev/null || true
        run_as_user systemctl --user enable --now mac-screenshot-daemon.service 2>/dev/null || true
    fi

    # Installing and enabling macW1Y background integrity check timer
    if [ -f "$SCRIPT_DIR/systemd/mac-integrity-check.service" ] && [ -f "$SCRIPT_DIR/systemd/mac-integrity-check.timer" ]; then
        local USER_SYSTEMD="$TARGET_HOME/.config/systemd/user"
        mkdir -p "$USER_SYSTEMD"
        sync_or_update_file "$SCRIPT_DIR/systemd/mac-integrity-check.service" "$USER_SYSTEMD/mac-integrity-check.service" false
        sync_or_update_file "$SCRIPT_DIR/systemd/mac-integrity-check.timer" "$USER_SYSTEMD/mac-integrity-check.timer" false
        run_as_user systemctl --user daemon-reload 2>/dev/null || true
        run_as_user systemctl --user enable --now mac-integrity-check.timer 2>/dev/null || true
    fi
    if [ -x "/usr/bin/google-chrome-stable" ] || [ -x "/usr/bin/google-chrome" ] || [ -x "/snap/bin/google-chrome" ]; then
        [ -f "$SCRIPT_DIR/bin/google-chrome" ] && sync_or_update_file "$SCRIPT_DIR/bin/google-chrome" "$LOCAL_BIN/google-chrome" false && chmod +x "$LOCAL_BIN/google-chrome" 2>/dev/null || true
    else
        rm -f "$LOCAL_BIN/google-chrome" 2>/dev/null || true
    fi

    # Core macW1Y theme desktop files
    for core_df in launchpad.desktop mac-app-launcher.desktop org.gnome.Settings.desktop; do
        if [ -f "$SCRIPT_DIR/applications/$core_df" ]; then
            sync_or_update_file "$SCRIPT_DIR/applications/$core_df" "$APP_DIR/$core_df" false
            sed -i "s|/home/vitaliy|$TARGET_HOME|g" "$APP_DIR/$core_df" 2>/dev/null || true
            chmod +x "$APP_DIR/$core_df" 2>/dev/null || true
        fi
    done

    # Selective optional third-party desktop files
    if [ -x "/snap/bin/steam" ] || [ -x "/usr/games/steam" ] || [ -x "/usr/bin/steam" ] || { which flatpak >/dev/null 2>&1 && flatpak list 2>/dev/null | grep -q "com.valvesoftware.Steam"; }; then
        [ -f "$SCRIPT_DIR/applications/steam_steam.desktop" ] && sync_or_update_file "$SCRIPT_DIR/applications/steam_steam.desktop" "$APP_DIR/steam_steam.desktop" false && chmod +x "$APP_DIR/steam_steam.desktop" 2>/dev/null || true
    else
        rm -f "$APP_DIR/steam_steam.desktop" "$APP_DIR/steam.desktop" 2>/dev/null || true
    fi

    if [ -x "/usr/bin/google-chrome-stable" ] || [ -x "/usr/bin/google-chrome" ] || [ -x "/snap/bin/google-chrome" ]; then
        [ -f "$SCRIPT_DIR/applications/google-chrome.desktop" ] && sync_or_update_file "$SCRIPT_DIR/applications/google-chrome.desktop" "$APP_DIR/google-chrome.desktop" false && chmod +x "$APP_DIR/google-chrome.desktop" 2>/dev/null || true
    else
        rm -f "$APP_DIR/google-chrome.desktop" 2>/dev/null || true
    fi

    if [ -x "/snap/bin/telegram-desktop" ] || [ -x "/usr/bin/telegram-desktop" ]; then
        [ -f "$SCRIPT_DIR/applications/telegram-desktop_telegram-desktop.desktop" ] && sync_or_update_file "$SCRIPT_DIR/applications/telegram-desktop_telegram-desktop.desktop" "$APP_DIR/telegram-desktop_telegram-desktop.desktop" false && chmod +x "$APP_DIR/telegram-desktop_telegram-desktop.desktop" 2>/dev/null || true
    else
        rm -f "$APP_DIR/telegram-desktop_telegram-desktop.desktop" "$APP_DIR/telegram-desktop.desktop" 2>/dev/null || true
    fi

    if [ -x "/snap/bin/antigravity" ] || [ -x "/usr/bin/antigravity" ] || [ -x "/usr/local/bin/antigravity" ]; then
        [ -f "$SCRIPT_DIR/applications/antigravity_antigravity.desktop" ] && sync_or_update_file "$SCRIPT_DIR/applications/antigravity_antigravity.desktop" "$APP_DIR/antigravity_antigravity.desktop" false && chmod +x "$APP_DIR/antigravity_antigravity.desktop" 2>/dev/null || true
    else
        rm -f "$APP_DIR/antigravity_antigravity.desktop" 2>/dev/null || true
    fi

    if [ -x "/snap/bin/firefox" ] || [ -x "/usr/bin/firefox" ]; then
        [ -f "$SCRIPT_DIR/applications/firefox_firefox.desktop" ] && sync_or_update_file "$SCRIPT_DIR/applications/firefox_firefox.desktop" "$APP_DIR/firefox_firefox.desktop" false && chmod +x "$APP_DIR/firefox_firefox.desktop" 2>/dev/null || true
    else
        rm -f "$APP_DIR/firefox_firefox.desktop" 2>/dev/null || true
    fi

    if which extension-manager >/dev/null 2>&1 || [ -x "$LOCAL_BIN/extension-manager" ]; then
        [ -f "$SCRIPT_DIR/applications/com.mattjakeman.ExtensionManager.desktop" ] && sync_or_update_file "$SCRIPT_DIR/applications/com.mattjakeman.ExtensionManager.desktop" "$APP_DIR/com.mattjakeman.ExtensionManager.desktop" false && chmod +x "$APP_DIR/com.mattjakeman.ExtensionManager.desktop" 2>/dev/null || true
    else
        rm -f "$APP_DIR/com.mattjakeman.ExtensionManager.desktop" 2>/dev/null || true
    fi

    if [ -x "/snap/bin/snap-store" ] || [ -x "/usr/bin/snap-store" ]; then
        [ -f "$SCRIPT_DIR/applications/snap-store_snap-store.desktop" ] && sync_or_update_file "$SCRIPT_DIR/applications/snap-store_snap-store.desktop" "$APP_DIR/snap-store_snap-store.desktop" false && chmod +x "$APP_DIR/snap-store_snap-store.desktop" 2>/dev/null || true
    else
        rm -f "$APP_DIR/snap-store_snap-store.desktop" 2>/dev/null || true
    fi

    if [ -x "/snap/bin/firmware-updater" ] || [ -x "/usr/bin/firmware-updater" ]; then
        [ -f "$SCRIPT_DIR/applications/firmware-updater_firmware-updater.desktop" ] && sync_or_update_file "$SCRIPT_DIR/applications/firmware-updater_firmware-updater.desktop" "$APP_DIR/firmware-updater_firmware-updater.desktop" false && chmod +x "$APP_DIR/firmware-updater_firmware-updater.desktop" 2>/dev/null || true
    else
        rm -f "$APP_DIR/firmware-updater_firmware-updater.desktop" 2>/dev/null || true
    fi
    [ -f "$SCRIPT_DIR/services/org.gnome.Settings.service" ] && sync_or_update_file "$SCRIPT_DIR/services/org.gnome.Settings.service" "$SVC_DIR/org.gnome.Settings.service" false
    if [ -d "$SCRIPT_DIR/config/mac-styling" ]; then
        sync_directory_tree "$SCRIPT_DIR/config/mac-styling" "$CFG_DIR" false
    fi

    log_info "8/10 Checking touchpad gestures and Game Mode..."
    if [ -f "$SCRIPT_DIR/bin/mac-touchpad-daemon" ]; then
        sync_or_update_file "$SCRIPT_DIR/bin/mac-touchpad-daemon" "/usr/local/bin/mac-touchpad-daemon" true
        sudo chmod +x /usr/local/bin/mac-touchpad-daemon
    fi
    [ -f "$SCRIPT_DIR/touchpad/mac-touchpad.conf" ] && sync_or_update_file "$SCRIPT_DIR/touchpad/mac-touchpad.conf" "/etc/mac-touchpad.conf" true
    [ -f "$SCRIPT_DIR/etc/udev/rules.d/99-uinput.rules" ] && sync_or_update_file "$SCRIPT_DIR/etc/udev/rules.d/99-uinput.rules" "/etc/udev/rules.d/99-uinput.rules" true
    [ -f "$SCRIPT_DIR/systemd/mac-touchpad-daemon.service" ] && sync_or_update_file "$SCRIPT_DIR/systemd/mac-touchpad-daemon.service" "/etc/systemd/system/mac-touchpad-daemon.service" true

    for gb in mac-gamemode gamemoderun nvidia-game-run nvidia-gpu prime-run DAMX nitro-key-detection.sh mac-boot-config mac-clipboard mac-gpu-manager bottles gamescope heroic lutris nvidia-run prismlauncher wine wine64 mac-wine-runner mac-gpu-env-selector mac-sanitize-favorites.sh mac-apply-theme mac-diagnostics mac-extension-guard mac-build-theme mac-audit-sync mac-setup-wizard mac-apply-locale mac-icon-normalizer mac-sync-applications mac-theme-sync mac-integrity-check mac-widget-picker; do
        if [ -f "$SCRIPT_DIR/bin/$gb" ] || [ -L "$SCRIPT_DIR/bin/$gb" ]; then
            sync_or_update_file "$SCRIPT_DIR/bin/$gb" "/usr/local/bin/$gb" true
            sudo chmod +x "/usr/local/bin/$gb" 2>/dev/null || true
        fi
    done

    # Steam wrapper: updated only if Steam is present on the system
    if [ -x "/snap/bin/steam" ] || [ -x "/usr/games/steam" ] || [ -x "/usr/bin/steam" ] || { which flatpak >/dev/null 2>&1 && flatpak list 2>/dev/null | grep -q "com.valvesoftware.Steam"; }; then
        if [ -f "$SCRIPT_DIR/bin/steam" ]; then
            sync_or_update_file "$SCRIPT_DIR/bin/steam" "/usr/local/bin/steam" true
            sudo chmod +x "/usr/local/bin/steam" 2>/dev/null || true
        fi
    else
        sudo rm -f /usr/local/bin/steam
    fi
    [ -f "$SCRIPT_DIR/systemd/mac-gamemode.service" ] && sync_or_update_file "$SCRIPT_DIR/systemd/mac-gamemode.service" "/etc/systemd/system/mac-gamemode.service" true

    # Performance and gaming optimizations in update mode
    if [ -f "$SCRIPT_DIR/autostart/nautilus-daemon.desktop" ]; then
        mkdir -p "$TARGET_HOME/.config/autostart"
        sync_or_update_file "$SCRIPT_DIR/autostart/nautilus-daemon.desktop" "$TARGET_HOME/.config/autostart/nautilus-daemon.desktop" false
        if [ -w "/etc/xdg/autostart" ] || sudo -n true 2>/dev/null; then
            sudo cp "$SCRIPT_DIR/autostart/nautilus-daemon.desktop" /etc/xdg/autostart/ 2>/dev/null || true
        fi
    fi

    # Nautilus Finder Sidebar and extensions
    log_info "Updating macW1Y Nautilus Finder Sidebar..."
    if [ -f "$SCRIPT_DIR/lib/libmac_nautilus.so" ]; then
        install_mac_shared_lib "$SCRIPT_DIR/lib/libmac_nautilus.so"
    fi
    if [ -f "$SCRIPT_DIR/lib/libmac_nautilus_menu.so" ]; then
        install_nautilus_extension "$SCRIPT_DIR/lib/libmac_nautilus_menu.so"
    fi
    install_app_wrapper nautilus

    if [ -f "$SCRIPT_DIR/bin/mac-sync-applications" ]; then
        sync_or_update_file "$SCRIPT_DIR/bin/mac-sync-applications" "/usr/local/bin/mac-sync-applications" true
        sudo chmod 755 /usr/local/bin/mac-sync-applications
    fi
    if [ -f "$SCRIPT_DIR/bin/mac-icon-normalizer" ]; then
        sync_or_update_file "$SCRIPT_DIR/bin/mac-icon-normalizer" "/usr/local/bin/mac-icon-normalizer" true
        sudo chmod 755 /usr/local/bin/mac-icon-normalizer
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
    if [ -f "$SCRIPT_DIR/applications/wine.desktop" ]; then
        sync_or_update_file "$SCRIPT_DIR/applications/wine.desktop" "/usr/share/applications/wine.desktop" true
        for mt in application/x-ms-dos-executable application/x-msdownload application/x-msi application/x-bat application/vnd.microsoft.portable-executable; do
            run_as_user xdg-mime default wine.desktop "$mt" 2>/dev/null || true
            run_as_user gio mime "$mt" wine.desktop 2>/dev/null || true
        done
    fi
    if [ -f "/usr/share/applications/winetricks.desktop" ]; then
        if ! grep -q "NoDisplay=true" /usr/share/applications/winetricks.desktop; then
            sudo sed -i '/^\[Desktop Entry\]/a NoDisplay=true' /usr/share/applications/winetricks.desktop 2>/dev/null || true
        fi
    fi
    if [ -f "$SCRIPT_DIR/bin/mac-generate-bookmarks.sh" ]; then
        sudo cp -f "$SCRIPT_DIR/bin/mac-generate-bookmarks.sh" /usr/local/bin/mac-generate-bookmarks.sh
        sudo chmod 755 /usr/local/bin/mac-generate-bookmarks.sh
        run_as_user /usr/local/bin/mac-generate-bookmarks.sh "$TARGET_USER" "$TARGET_HOME"
    fi
    # Clean up redundant legacy autostart entries (handled by systemd user services & /etc/xdg/autostart)
    rm -f "$TARGET_HOME/.config/autostart/mac-sync-applications.desktop" 2>/dev/null || true
    rm -f "$TARGET_HOME/.config/autostart/mac-ensure-extensions.desktop" 2>/dev/null || true

    # Suppress xdg-user-dirs-gtk prompt on locale change (macW1Y directory structure preservation)
    mkdir -p "$TARGET_HOME/.config/autostart"
    cat << 'EOF_UDIRS' > "$TARGET_HOME/.config/autostart/user-dirs-update-gtk.desktop"
[Desktop Entry]
Type=Application
Name=User folders update
Exec=true
Hidden=true
X-GNOME-Autostart-enabled=false
EOF_UDIRS
    echo "enabled=False" > "$TARGET_HOME/.config/user-dirs.conf"
    chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.config/autostart/user-dirs-update-gtk.desktop" "$TARGET_HOME/.config/user-dirs.conf" 2>/dev/null || true
    run_as_user /usr/local/bin/mac-sync-applications 2>/dev/null || true

    log_info "9/10 Checking Plymouth and GDM transition..."
    sudo rm -rf /etc/gnome-shell/ui/layout.js /etc/gnome-shell/ui 2>/dev/null || true
    sudo sed -i '/G_RESOURCE_OVERLAYS.*gnome-shell/d' /etc/environment 2>/dev/null || true
    install_gnome_shell_overlay
    if [ -d "$SCRIPT_DIR/plymouth/macw1y-boot" ]; then
        sync_directory_tree "$SCRIPT_DIR/plymouth/macw1y-boot" "/usr/share/plymouth/themes/macw1y-boot" true
        if command -v update-alternatives >/dev/null 2>&1; then
            sudo update-alternatives --install /usr/share/plymouth/themes/default.plymouth default.plymouth "/usr/share/plymouth/themes/macw1y-boot/macw1y-boot.plymouth" 200 2>/dev/null || true
            sudo update-alternatives --set default.plymouth "/usr/share/plymouth/themes/macw1y-boot/macw1y-boot.plymouth" 2>/dev/null || true
        fi
        sudo mkdir -p /etc/plymouth
        sudo tee /etc/plymouth/plymouthd.conf >/dev/null << 'EOF'
[Daemon]
Theme=macw1y-boot
ShowDelay=0
DeviceTimeout=8
EOF
        macw1y_rebuild_initramfs
    fi

    if macw1y_has_grub; then
    log_info "10/10 Checking GRUB bootloader..."
    if [ -d "$SCRIPT_DIR/grub/macw1y-boot" ]; then
        sync_directory_tree "$SCRIPT_DIR/grub/macw1y-boot" "/boot/grub/themes/macw1y-boot" true
    fi
    if [ -d "$SCRIPT_DIR/grub/macw1y-boot-usb" ]; then
        sync_directory_tree "$SCRIPT_DIR/grub/macw1y-boot-usb" "/boot/grub/themes/macw1y-boot-usb" true
    fi
    if [ "$DISTRO_ID" = "ubuntu" ]; then
        [ -f "$SCRIPT_DIR/grub/grub.default" ] && sync_or_update_file "$SCRIPT_DIR/grub/grub.default" "/etc/default/grub" true
        [ -f "$SCRIPT_DIR/grub/10_linux" ] && sync_or_update_file "$SCRIPT_DIR/grub/10_linux" "/etc/grub.d/10_linux" true
        [ -f "$SCRIPT_DIR/grub/30_uefi-firmware" ] && sync_or_update_file "$SCRIPT_DIR/grub/30_uefi-firmware" "/etc/grub.d/30_uefi-firmware" true
        sudo chmod 755 /etc/grub.d/10_linux 2>/dev/null || true
        sudo chmod 644 /etc/grub.d/30_uefi-firmware 2>/dev/null || true
    fi
    [ -f "$SCRIPT_DIR/grub/06_mac_theme_select" ] && sync_or_update_file "$SCRIPT_DIR/grub/06_mac_theme_select" "/etc/grub.d/06_mac_theme_select" true
    [ -f "$SCRIPT_DIR/grub/08_mac_usb_entry" ] && sync_or_update_file "$SCRIPT_DIR/grub/08_mac_usb_entry" "/etc/grub.d/08_mac_usb_entry" true
    [ -f "$SCRIPT_DIR/grub/40_custom" ] && sync_or_update_file "$SCRIPT_DIR/grub/40_custom" "/etc/grub.d/40_custom" true
    if [ -f "$SCRIPT_DIR/grub/generate_icons.py" ]; then
        sudo mkdir -p /usr/share/mactheme/grub
        sync_or_update_file "$SCRIPT_DIR/grub/generate_icons.py" "/usr/share/mactheme/grub/generate_icons.py" true
        sudo chmod 755 /usr/share/mactheme/grub/generate_icons.py 2>/dev/null || true
    fi
    [ -f "$SCRIPT_DIR/systemd/mac-grub-status.service" ] && sync_or_update_file "$SCRIPT_DIR/systemd/mac-grub-status.service" "/etc/systemd/system/mac-grub-status.service" true
    sudo chmod 755 /etc/grub.d/06_mac_theme_select /etc/grub.d/08_mac_usb_entry /etc/grub.d/40_custom 2>/dev/null || true
    if command -v update-grub >/dev/null 2>&1; then
        sudo update-grub 2>/dev/null || true
    elif command -v grub2-mkconfig >/dev/null 2>&1; then
        sudo grub2-mkconfig -o /boot/grub2/grub.cfg 2>/dev/null || true
    elif command -v grub-mkconfig >/dev/null 2>&1; then
        sudo grub-mkconfig -o /boot/grub/grub.cfg 2>/dev/null || true
    fi

    else
        log_info "GRUB update skipped for this bootloader."
    fi

    log_info "Updating system caches..."
    chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.themes" "$TARGET_HOME/.local/share/fonts" "$TARGET_HOME/.local/share/icons" "$EXT_USER_DIR" "$OVERLAY_DIR" "$LOCAL_BIN" "$LOCAL_LIB" "$APP_DIR" "$SVC_DIR" "$CFG_DIR" 2>/dev/null || true
    
    sudo fc-cache -f >/dev/null 2>&1 || true
    run_as_user fc-cache -f >/dev/null 2>&1 || true
    gtk-update-icon-cache -f -t "$TARGET_HOME/.local/share/icons/macW1Y-dark" 2>/dev/null || true
    run_as_user update-desktop-database "$APP_DIR" 2>/dev/null || true
    
    # Sanitizing and optimizing pinned Dock applications
    if [ -x "/usr/local/bin/mac-sanitize-favorites.sh" ]; then
        run_as_user /usr/local/bin/mac-sanitize-favorites.sh 2>/dev/null || true
    fi

    log_info "Configuring memory arena thresholds and trimming background services..."
    sudo bash -c 'cat << "EOF_MEM" > /etc/environment
PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin"
MALLOC_ARENA_MAX=2
MALLOC_TRIM_THRESHOLD_=131072
MALLOC_MMAP_THRESHOLD_=131072
EOF_MEM' 2>/dev/null || true

    mkdir -p "$TARGET_HOME/.config/environment.d"
    cat << 'EOF_MEMCONF' > "$TARGET_HOME/.config/environment.d/60-memory-opt.conf"
MALLOC_ARENA_MAX=2
MALLOC_TRIM_THRESHOLD_=131072
MALLOC_MMAP_THRESHOLD_=131072
EOF_MEMCONF
    chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.config/environment.d" 2>/dev/null || true

    # Mask unneeded evolution data services to conserve RAM
    run_as_user systemctl --user stop evolution-addressbook-factory.service evolution-calendar-factory.service evolution-source-registry.service 2>/dev/null || true
    run_as_user systemctl --user mask evolution-addressbook-factory.service evolution-calendar-factory.service evolution-source-registry.service 2>/dev/null || true
    mkdir -p "$TARGET_HOME/.config/autostart"
    cat << 'EOF_EVO' > "$TARGET_HOME/.config/autostart/org.gnome.Evolution-alarm-notify.desktop"
[Desktop Entry]
Type=Application
Name=Evolution Alarm Notify
Hidden=true
EOF_EVO
    chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME/.config/autostart" 2>/dev/null || true

    # Configure Liquid Glass downscale to 2 for optimal RAM footprint
    run_as_user gsettings set org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com glass-blur-downscale 2 2>/dev/null || true

    if [ "$APPLY_LOW_SPEC" = "true" ]; then
        log_info "Applying Intel HD and low-spec hardware optimizations (ZRAM, sysctl, Eco profile)..."
        if [ -x "/usr/local/bin/mac-lowspec-optimizer" ]; then
            /usr/local/bin/mac-lowspec-optimizer apply || true
        elif [ -x "$SCRIPT_DIR/bin/mac-lowspec-optimizer" ]; then
            "$SCRIPT_DIR/bin/mac-lowspec-optimizer" apply || true
        fi
    fi

    # Security hardening: ensure all system files are strictly owned by root:root and safe
    log_info "Verifying system file security and root permissions..."
    sudo rm -f /etc/sudoers.d/99-mactheme /etc/sudoers.d/99_mactheme 2>/dev/null || true
    sudo chown root:root /usr/local/bin/* /usr/local/lib/* 2>/dev/null || true
    sudo chmod 755 /usr/local/bin/* 2>/dev/null || true
    sudo chmod 644 /usr/local/lib/*.so* 2>/dev/null || true
    sudo chown -R root:root /usr/share/mactheme /etc/sudoers.d 2>/dev/null || true
    sudo chmod 440 /etc/sudoers.d/* 2>/dev/null || true
    
    sudo systemctl daemon-reload 2>/dev/null || true
    sudo systemctl restart mac-touchpad-daemon.service 2>/dev/null || true
    
    # Saving version
    save_version "$new_ver"
    
    # Reloading extension
    run_as_user gnome-extensions disable blur-my-shell@aunetx 2>/dev/null || true
    sleep 1
    run_as_user gnome-extensions enable blur-my-shell@aunetx 2>/dev/null || true
    
    emit_progress 100 "finalizing" "Installation completed successfully"

    echo -e "\n${C_GREEN}═══════════════════════════════════════════════════════════════════════${C_RESET}"
    echo -e " ${C_BOLD}${C_GREEN}✔ UPDATE [v$cur_ver] -> [v$new_ver] COMPLETED SUCCESSFULLY!${C_RESET}"
    echo -e "${C_GREEN}═══════════════════════════════════════════════════════════════════════${C_RESET}"
    echo -e "   • Modified / added files: ${C_BOLD}${C_CYAN}$MODIFIED_COUNT${C_RESET}"
    echo -e "   • Unchanged files (up to date): ${C_BOLD}$UNCHANGED_COUNT${C_RESET}"
    echo -e "   • Current system version: ${C_BOLD}${C_GREEN}v$new_ver${C_RESET}\n"
}

# 3. Clean Reinstall [installed version] -> [new version]
# Completely removes all theme pack files and reinstalls from scratch
run_clean_update() {
    python3 "$SCRIPT_DIR/dependencies/check-platform.py" "$SCRIPT_DIR" || return 1
    local cur_ver="$1"
    local new_ver="$2"
    
    if [ -n "$cur_ver" ]; then
        log_step "Clean Reinstall [v$cur_ver] -> [v$new_ver]: Completely removing all previous theme pack files"
    else
        log_step "Clean Reinstall [v$new_ver]: Completely removing all previous files and performing fresh installation"
    fi
    require_root
    
    log_info "1/3 Creating backup checkpoint before reinstall..."
    local BKP_DIR="$TARGET_HOME/.config/macw1y/backups/pre_clean_update_$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BKP_DIR"
    [ -d "$TARGET_HOME/.themes" ] && cp -a "$TARGET_HOME/.themes" "$BKP_DIR/themes" 2>/dev/null || true
    [ -d "$TARGET_HOME/.config/gtk-4.0" ] && cp -a "$TARGET_HOME/.config/gtk-4.0" "$BKP_DIR/gtk-4.0" 2>/dev/null || true
    run_as_user dconf dump / > "$BKP_DIR/dconf_dump.ini" 2>/dev/null || true
    
    log_info "2/3 Removing ALL macW1Y components from the system..."
    rm -rf "$TARGET_HOME/.themes/macW1Y-Dark"* "$TARGET_HOME/.themes/macW1Y"*
    rm -rf "$TARGET_HOME/.local/share/icons/macW1Y-dark"* "$TARGET_HOME/.local/share/icons/macW1Y"* "$TARGET_HOME/.local/share/icons/macw1y-cursors"*
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
    
    rm -rf "$TARGET_HOME/.local/share/sounds/macW1Y"
    sudo rm -rf /usr/share/sounds/macW1Y 2>/dev/null || true
    rm -f "$TARGET_HOME/.config/autostart/macw1y-login-sound.desktop"
    sudo rm -f /usr/local/bin/mac-login-sound
    run_as_user gsettings set org.gnome.desktop.sound theme-name 'macW1Y' 2>/dev/null || true

    rm -rf "$TARGET_HOME/.local/share/gnome-shell/extensions/macw1y-touchpad-gestures@mactheme"
    rm -rf "$TARGET_HOME/.local/share/gnome-shell/extensions/eval-helper@mactheme"
    rm -rf "$TARGET_HOME/.local/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com"
    sudo rm -rf /usr/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com
    
    sudo systemctl stop mac-touchpad-daemon.service 2>/dev/null || true
    sudo systemctl disable mac-touchpad-daemon.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/mac-touchpad-daemon.service /usr/local/bin/mac-touchpad-daemon /etc/mac-touchpad.conf /etc/udev/rules.d/99-uinput.rules
    
    sudo systemctl stop mac-gamemode.service 2>/dev/null || true
    sudo systemctl disable mac-gamemode.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/mac-gamemode.service /usr/local/bin/mac-gamemode /usr/local/bin/gamemoderun /usr/local/bin/nvidia-game-run /usr/local/bin/prime-run /usr/local/bin/mac-clipboard /etc/mac-gamemode.state
    sudo rm -f /etc/sysctl.d/99-macw1y-performance.conf /etc/systemd/system/system.slice.d/50-macw1y-priority.conf /dev/shm/mac_focused_pid
    rm -f "$TARGET_HOME/.config/systemd/user/session.slice.d/50-priority.conf"
    rm -rf "$TARGET_HOME/.cache/mac-clipboard"
    
    sudo rm -rf /etc/gnome-shell/ui/layout.js /etc/gnome-shell/ui 2>/dev/null || true
    sudo sed -i '/G_RESOURCE_OVERLAYS.*gnome-shell/d' /etc/environment 2>/dev/null || true
    sudo rm -rf /usr/share/mactheme/gnome-shell-overlay /usr/share/mactheme/gnome-control-center-overlay 2>/dev/null || true
    sudo rm -f /var/tmp/mactheme-overlay-* /tmp/mactheme-overlay-* /tmp/disable-mactheme-overlay /etc/mactheme/disable-overlay 2>/dev/null || true
    sudo rm -f /etc/systemd/user/org.gnome.Shell@.service.d/mac-transition.conf* 2>/dev/null || true
    rm -f "$TARGET_HOME/.config/systemd/user/org.gnome.Shell@.service.d/mac-transition.conf*" 2>/dev/null || true
    rm -f "$TARGET_HOME/.config/environment.d/10-gnome-shell-overlay.conf" 2>/dev/null || true
    
    sudo systemctl stop plymouth-verbose-logger.service 2>/dev/null || true
    sudo systemctl disable plymouth-verbose-logger.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/plymouth-verbose-logger.service /usr/local/bin/plymouth-verbose-logger
    sudo rm -rf /usr/share/plymouth/themes/macw1y-boot
    
    sudo systemctl stop mac-grub-status.service 2>/dev/null || true
    sudo systemctl disable mac-grub-status.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/mac-grub-status.service
    sudo rm -rf /boot/grub/themes/macw1y-boot
    
    rm -rf "$TARGET_HOME/.local/share/macW1Y"
    sudo rm -rf /etc/macW1Y
    
    log_success "All previous theme pack files removed completely!"
    
    log_info "3/3 Performing fresh installation of v$new_ver..."
    run_full_install
}

# ------------------------------------------------------------------------------
# Debug Installer & CLI Dispatcher System
# ------------------------------------------------------------------------------
print_debug_banner() {
    clear 2>/dev/null || true
    echo -e "${C_CYAN}"
    echo "  ╔════════════════════════════════════════════════════════════════════════════╗"
    echo "  ║                                                                            ║"
    echo "  ║         m a c W 1 Y   D e b u g   &   C L I   E n v i r o n m e n t       ║"
    echo "  ║                Developer & Debugging Tools Installer                       ║"
    echo "  ║                         Release: macW1Y Debug (v${NEW_VERSION})                      ║"
    echo "  ║                                                                            ║"
    echo "  ╚════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${C_RESET}"
}

get_debug_installed_version() {
    if [ -f "/etc/macW1Y/debug.version" ]; then
        cat "/etc/macW1Y/debug.version" 2>/dev/null | tr -d 'v \n\r'
    elif [ -f "$TARGET_HOME/.local/share/macW1Y/debug.version" ]; then
        cat "$TARGET_HOME/.local/share/macW1Y/debug.version" 2>/dev/null | tr -d 'v \n\r'
    elif [ -x "/usr/local/bin/macW1Y" ] || [ -x "/usr/bin/macW1Y" ]; then
        echo "0.8"
    fi
}

run_debug_install() {
    require_root
    log_step "Installing macW1Y debug tools and CLI dispatcher environment (v${NEW_VERSION})"

    local LOCAL_BIN="$TARGET_HOME/.local/bin"
    mkdir -p "$LOCAL_BIN"

    # Install macW1Y dispatcher
    if [ -f "$SCRIPT_DIR/bin/macW1Y" ]; then
        log_info "Installing macW1Y command dispatcher to /usr/local/bin and /usr/bin..."
        cp -f "$SCRIPT_DIR/bin/macW1Y" "$LOCAL_BIN/macW1Y" 2>/dev/null || true
        chmod 755 "$LOCAL_BIN/macW1Y" 2>/dev/null || true
        sudo cp -f "$SCRIPT_DIR/bin/macW1Y" /usr/local/bin/macW1Y
        sudo chown root:root /usr/local/bin/macW1Y 2>/dev/null || true
        sudo chmod 755 /usr/local/bin/macW1Y
        sudo ln -sf /usr/local/bin/macW1Y /usr/local/bin/macw1y
        sudo ln -sf /usr/local/bin/macW1Y /usr/bin/macW1Y
        sudo ln -sf /usr/local/bin/macW1Y /usr/bin/macw1y
        log_success "macW1Y dispatcher installed."
    else
        log_error "bin/macW1Y not found in $SCRIPT_DIR/bin!"
        exit 1
    fi

    # Install all debug utilities and CLI helpers
    log_info "Installing developer and debug helper utilities..."
    for bin_file in "$SCRIPT_DIR"/bin/*; do
        if [ -f "$bin_file" ] || [ -L "$bin_file" ]; then
            local b_name
            b_name="$(basename "$bin_file")"
            cp -f "$bin_file" "$LOCAL_BIN/$b_name" 2>/dev/null || true
            chmod 755 "$LOCAL_BIN/$b_name" 2>/dev/null || true
            sudo cp -f "$bin_file" "/usr/local/bin/$b_name" 2>/dev/null || true
            sudo chown root:root "/usr/local/bin/$b_name" 2>/dev/null || true
            sudo chmod 755 "/usr/local/bin/$b_name" 2>/dev/null || true
        fi
    done

    # Save debug version marker
    sudo mkdir -p /etc/macW1Y
    echo "v${NEW_VERSION}" | sudo tee /etc/macW1Y/debug.version >/dev/null
    mkdir -p "$TARGET_HOME/.local/share/macW1Y"
    echo "v${NEW_VERSION}" > "$TARGET_HOME/.local/share/macW1Y/debug.version"

    log_success "macW1Y Debug Environment (v${NEW_VERSION}) installed successfully!"
    echo -e "\n ${C_BOLD}Quick Start:${C_RESET}"
    echo -e "   • Type ${C_GREEN}macW1Y -?${C_RESET} to view all available commands."
    echo -e "   • Type ${C_GREEN}macW1Y Mac-setup-wizard start${C_RESET} to launch the first-stage setup wizard."
    echo -e "   • Type ${C_GREEN}macW1Y diagnostics${C_RESET} to perform system diagnostics."
    echo -e "   • To uninstall: ${C_YELLOW}./install.sh -debug_uninstall${C_RESET}\n"
}

run_debug_update() {
    require_root
    log_step "Updating macW1Y debug tools and CLI dispatcher to v${NEW_VERSION}"
    run_debug_install
}

run_debug_clean_install() {
    require_root
    log_step "Clean reinstalling macW1Y debug tools (v${NEW_VERSION})"
    log_info "Removing existing debug CLI tools..."
    sudo rm -f /usr/local/bin/macW1Y /usr/local/bin/macw1y /usr/bin/macW1Y /usr/bin/macw1y
    sudo rm -f /etc/macW1Y/debug.version
    rm -f "$TARGET_HOME/.local/share/macW1Y/debug.version" 2>/dev/null || true
    run_debug_install
}

run_debug_uninstall() {
    require_root
    log_step "Uninstalling macW1Y debug tools and CLI dispatcher"

    log_info "Removing macW1Y command dispatchers and symlinks..."
    sudo rm -f /usr/local/bin/macW1Y /usr/local/bin/macw1y /usr/bin/macW1Y /usr/bin/macw1y
    sudo rm -f /etc/macW1Y/debug.version
    rm -f "$TARGET_HOME/.local/share/macW1Y/debug.version" 2>/dev/null || true
    rm -f "$TARGET_HOME/.local/bin/macW1Y" "$TARGET_HOME/.local/bin/macw1y" 2>/dev/null || true

    log_success "macW1Y debug tools and CLI dispatcher successfully uninstalled."
}

interactive_debug_menu() {
    print_debug_banner

    local DEBUG_VER
    DEBUG_VER="$(get_debug_installed_version)"
    local CMP_RES=0
    if [ -n "$DEBUG_VER" ]; then
        CMP_RES=$(compare_semver "$DEBUG_VER" "$NEW_VERSION")
    fi

    echo -e " ${C_BOLD}Version Information:${C_RESET}"
    if [ -n "$DEBUG_VER" ]; then
        echo -e "   • Installed debug version on PC: ${C_BOLD}${C_YELLOW}v$DEBUG_VER${C_RESET}"
    else
        echo -e "   • Installed debug version on PC: ${C_BOLD}${C_RED}Not installed${C_RESET}"
    fi
    echo -e "   • Debug package version: ${C_BOLD}${C_GREEN}v$NEW_VERSION${C_RESET}\n"

    echo -e " ${C_BOLD}Select an action:${C_RESET}\n"

    local HAS_OPT1=false
    local HAS_OPT2=false
    local HAS_OPT3=true

    if [ -z "$DEBUG_VER" ]; then
        HAS_OPT1=true
        HAS_OPT2=false
        echo -e "  ${C_GREEN}[1]${C_RESET} ${C_BOLD}Full Debug Installation [v${NEW_VERSION}]${C_RESET} (Installs macW1Y CLI dispatcher and developer debug tools)"
        echo -e "  ${C_YELLOW}[3]${C_RESET} ${C_BOLD}Clean Reinstall Debug Tools [v${NEW_VERSION}]${C_RESET} (Completely removes debug tools and performs fresh setup)"
        echo -e "  ${C_RED}[4]${C_RESET} Exit installer\n"
    elif [ "$CMP_RES" -eq 2 ]; then
        HAS_OPT1=false
        HAS_OPT2=true
        echo -e "  ${C_CYAN}[2]${C_RESET} ${C_BOLD}Update Debug Tools [v${DEBUG_VER}] -> [v${NEW_VERSION}]${C_RESET} (Verifies and updates CLI dispatchers and debug utilities)"
        echo -e "  ${C_YELLOW}[3]${C_RESET} ${C_BOLD}Clean Reinstall Debug Tools [v${DEBUG_VER}] -> [v${NEW_VERSION}]${C_RESET} (Completely removes debug tools and reinstalls from scratch)"
        echo -e "  ${C_RED}[4]${C_RESET} Exit installer\n"
    else
        HAS_OPT1=false
        HAS_OPT2=true
        echo -e "  ${C_CYAN}[2]${C_RESET} ${C_BOLD}Update / Integrity Check [v${DEBUG_VER}] -> [v${NEW_VERSION}]${C_RESET} (Verifies CLI dispatchers and restores missing utilities)"
        echo -e "  ${C_YELLOW}[3]${C_RESET} ${C_BOLD}Clean Reinstall Debug Tools [v${DEBUG_VER}] -> [v${NEW_VERSION}]${C_RESET} (Completely removes debug tools and reinstalls from scratch)"
        echo -e "  ${C_RED}[4]${C_RESET} Exit installer\n"
    fi

    local CHOICE="$2"
    if [ -z "$CHOICE" ]; then
        read -r -p " Enter option number: " CHOICE
    fi

    case "$CHOICE" in
        1)
            if [ "$HAS_OPT1" = "true" ]; then
                run_debug_install
            else
                log_error "Option 1 is not available: debug tools v${DEBUG_VER} already installed. Choose [2] to update or [3] for clean reinstall."
                exit 1
            fi
            ;;
        2)
            if [ "$HAS_OPT2" = "true" ]; then
                run_debug_update
            else
                log_error "Option 2 is not available: no previous debug version detected. Choose [1] for full install or [3] for clean reinstall."
                exit 1
            fi
            ;;
        3)
            run_debug_clean_install
            ;;
        4|0)
            echo -e "\nOperation complete. Exiting installer."
            exit 0
            ;;
        *)
            echo -e "\nInvalid choice. Installation cancelled."
            exit 1
            ;;
    esac
}

# ------------------------------------------------------------------------------
# Mock Installation Engine (10-Second Simulation)
# ------------------------------------------------------------------------------
run_mock_installation() {
    local action_title="${1:-Mock Installation}"

    if [ "$GUI_WORKER" != "true" ]; then
        log_step "Running 10-Second Simulation: $action_title"
        log_info "Simulating macW1Y deployment without modifying system files or packages."
    fi

    local steps=(
        "5:stage1:Stage 1/13: Verifying system dependencies and environment"
        "10:stage1:Checking platform toolchain and native libraries"
        "18:stage1:Verifying Python runtime packages and meson"
        "25:stage2:Stage 2/13: Validating Apple SF Pro typography"
        "30:stage2:Rebuilding font cache and fontconfig rules"
        "38:stage3:Stage 3/13: Preparing macW1Y GTK and Shell themes"
        "45:stage4:Stage 4/13: Testing icon caches and macOS cursors"
        "52:stage5:Stage 5/13: Validating sound effects and login chime"
        "60:stage6:Stage 6/13: Verifying dynamic wallpapers integration"
        "68:stage7:Stage 7/13: Simulating GNOME Shell extensions deployment"
        "76:stage7:Applying extension configuration schemas"
        "82:stage8:Stage 8/13: Testing System Settings control panel overlay"
        "86:stage9:Stage 9/13: Simulating touchpad gesture daemon"
        "90:stage10:Stage 10/13: Testing GameMode and GPU acceleration"
        "93:stage11:Stage 11/13: Testing GDM lock screen transition"
        "96:stage12:Stage 12/13: Simulating Plymouth boot splash"
        "97:stage12:Checking initramfs generation prerequisites"
        "98:stage13:Stage 13/13: Simulating GRUB bootloader configuration"
        "99:finalizing:Finalizing simulated configuration"
        "100:finalizing:Complete"
    )

    for item in "${steps[@]}"; do
        IFS=":" read -r pct stage_id desc <<< "$item"
        if [ "$GUI_WORKER" = "true" ]; then
            echo "PROGRESS:${pct}:${stage_id}"
        else
            echo -e "  [${pct}%] ${C_CYAN}${desc}...${C_RESET}"
        fi
        sleep 0.5
    done

    if [ "$APPLY_LOW_SPEC" = "true" ]; then
        if [ "$GUI_WORKER" = "true" ]; then
            echo "PROGRESS:100:lowspec"
        else
            echo -e "  [100%] ${C_CYAN}Applying Intel HD and Eco Engine optimizations...${C_RESET}"
        fi
        if [ -x "/usr/local/bin/mac-lowspec-optimizer" ]; then
            /usr/local/bin/mac-lowspec-optimizer apply || true
        elif [ -x "$SCRIPT_DIR/bin/mac-lowspec-optimizer" ]; then
            "$SCRIPT_DIR/bin/mac-lowspec-optimizer" apply || true
        fi
    fi

    if [ "$GUI_WORKER" != "true" ]; then
        echo -e "\n${C_GREEN}[✔] Simulation completed successfully in 10 seconds!${C_RESET}"
        echo -e " ${C_BOLD}No system files or packages were modified.${C_RESET}\n"
    fi
}

# ------------------------------------------------------------------------------
# CLI Command-Line Arguments
# ------------------------------------------------------------------------------
if [ "$1" = "--help" ] || [ "$1" = "-h" ] || [ "$1" = "-?" ] || [ "$1" = "-help" ]; then
    show_usage
    exit 0
elif [ "$MOCK_MODE" = "true" ]; then
    if [ "$1" = "-debug_uninstall" ] || [ "$1" = "--debug_uninstall" ] || [ "$1" = "--uninstall" ]; then
        print_banner
        run_mock_installation "Simulated Uninstall"
        exit 0
    elif [ "$1" = "--install" ] || [ "$1" = "-i" ] || [ "$1" = "--all" ] || [ "$1" = "-y" ] || [ "$1" = "--yes" ]; then
        print_banner
        run_mock_installation "Full Installation"
        exit 0
    elif [ "$1" = "--update" ] || [ "$1" = "-u" ]; then
        print_banner
        run_mock_installation "Incremental Update"
        exit 0
    elif [ "$1" = "--clean-update" ] || [ "$1" = "-c" ]; then
        print_banner
        run_mock_installation "Clean Reinstall"
        exit 0
    elif [ "$GUI_WORKER" = "true" ]; then
        run_mock_installation "GUI Worker Simulation"
        exit 0
    else
        # Interactive CLI Simulation menu
        print_banner
        INSTALLED_VER="$(get_installed_version)"
        echo -e " ${C_BOLD}Version Information (Simulation Mode):${C_RESET}"
        if [ -n "$INSTALLED_VER" ]; then
            echo -e "   • Installed version on PC: ${C_BOLD}${C_YELLOW}v$INSTALLED_VER${C_RESET}"
        else
            echo -e "   • Installed version on PC: ${C_BOLD}${C_RED}Not installed${C_RESET}"
        fi
        echo -e "   • Installer package version: ${C_BOLD}${C_GREEN}v$NEW_VERSION${C_RESET}\n"
        echo -e " ${C_BOLD}Select an action to simulate:${C_RESET}\n"
        echo -e "  ${C_GREEN}[1]${C_RESET} ${C_BOLD}Simulated Full Installation [v${NEW_VERSION}]${C_RESET} (10-second mock run)"
        echo -e "  ${C_CYAN}[2]${C_RESET} ${C_BOLD}Simulated Update [v${NEW_VERSION}]${C_RESET} (10-second mock run)"
        echo -e "  ${C_YELLOW}[3]${C_RESET} ${C_BOLD}Simulated Clean Reinstall [v${NEW_VERSION}]${C_RESET} (10-second mock run)"
        echo -e "  ${C_RED}[4]${C_RESET} Exit simulator\n"
        if [ -n "$1" ]; then
            CHOICE="$1"
        else
            read -r -p " Enter option number: " CHOICE
        fi
        case "$CHOICE" in
            1) run_mock_installation "Full Installation" ;;
            2) run_mock_installation "Incremental Update" ;;
            3) run_mock_installation "Clean Reinstall" ;;
            4|0) echo -e "\nSimulation exited cleanly."; exit 0 ;;
            *) echo -e "\nInvalid choice. Simulation cancelled."; exit 1 ;;
        esac
        exit 0
    fi
elif [ "$1" = "-debug_install" ] || [ "$1" = "--debug_install" ]; then
    interactive_debug_menu "$@"
    exit 0
elif [ "$1" = "-debug_uninstall" ] || [ "$1" = "--debug_uninstall" ] || [ "$1" = "--uninstall" ]; then
    print_banner
    exec "$SCRIPT_DIR/libexec/macw1y-uninstall" --all
elif [ "$1" = "--install" ] || [ "$1" = "-i" ] || [ "$1" = "--all" ] || [ "$1" = "-y" ] || [ "$1" = "--yes" ]; then
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
fi

# ------------------------------------------------------------------------------
# Interactive Menu
# ------------------------------------------------------------------------------
print_banner

INSTALLED_VER="$(get_installed_version)"
CMP_RES=0
if [ -n "$INSTALLED_VER" ]; then
    CMP_RES=$(compare_semver "$INSTALLED_VER" "$NEW_VERSION")
fi

echo -e " ${C_BOLD}Version Information:${C_RESET}"
if [ -n "$INSTALLED_VER" ]; then
    echo -e "   • Installed version on PC: ${C_BOLD}${C_YELLOW}v$INSTALLED_VER${C_RESET}"
else
    echo -e "   • Installed version on PC: ${C_BOLD}${C_RED}Not installed${C_RESET}"
fi
echo -e "   • Installer package version: ${C_BOLD}${C_GREEN}v$NEW_VERSION${C_RESET}\n"

echo -e " ${C_BOLD}Select an action:${C_RESET}\n"

HAS_OPT1=false
HAS_OPT2=false
HAS_OPT3=true

if [ -z "$INSTALLED_VER" ]; then
    # Nothing installed: show options 1, 3 and 4
    HAS_OPT1=true
    HAS_OPT2=false
    echo -e "  ${C_GREEN}[1]${C_RESET} ${C_BOLD}Full Installation [v${NEW_VERSION}]${C_RESET} (Initial complete installation of macW1Y)"
    echo -e "  ${C_YELLOW}[3]${C_RESET} ${C_BOLD}Clean Reinstall [v${NEW_VERSION}]${C_RESET} (Completely removes all theme pack remnants and performs fresh installation)"
    echo -e "  ${C_RED}[4]${C_RESET} ${C_BOLD}Uninstall macW1Y${C_RESET} (Restore original GNOME appearance and remove all modpack files)"
    echo -e "  ${C_CYAN}[0]${C_RESET} Exit installer\n"
elif [ "$CMP_RES" -eq 2 ]; then
    # Previous version found: show options 2, 3 and 4
    HAS_OPT1=false
    HAS_OPT2=true
    echo -e "  ${C_CYAN}[2]${C_RESET} ${C_BOLD}Update [v${INSTALLED_VER}] -> [v${NEW_VERSION}]${C_RESET} (Verifies every file and updates modified or missing components)"
    echo -e "  ${C_YELLOW}[3]${C_RESET} ${C_BOLD}Clean Reinstall [v${INSTALLED_VER}] -> [v${NEW_VERSION}]${C_RESET} (Completely removes all theme pack files and reinstalls from scratch)"
    echo -e "  ${C_RED}[4]${C_RESET} ${C_BOLD}Uninstall macW1Y${C_RESET} (Restore original GNOME appearance and remove all modpack files)"
    echo -e "  ${C_CYAN}[0]${C_RESET} Exit installer\n"
else
    # Version matches or is newer: show options 2, 3 and 4
    HAS_OPT1=false
    HAS_OPT2=true
    echo -e "  ${C_CYAN}[2]${C_RESET} ${C_BOLD}Update / Integrity Check [v${INSTALLED_VER}] -> [v${NEW_VERSION}]${C_RESET} (Verifies files and restores missing or damaged components)"
    echo -e "  ${C_YELLOW}[3]${C_RESET} ${C_BOLD}Clean Reinstall [v${INSTALLED_VER}] -> [v${NEW_VERSION}]${C_RESET} (Completely removes all theme pack files and reinstalls from scratch)"
    echo -e "  ${C_RED}[4]${C_RESET} ${C_BOLD}Uninstall macW1Y${C_RESET} (Restore original GNOME appearance and remove all modpack files)"
    echo -e "  ${C_CYAN}[0]${C_RESET} Exit installer\n"
fi

if [ -n "$1" ]; then
    CHOICE="$1"
else
    read -r -p " Enter option number: " CHOICE
fi

case "$CHOICE" in
    1)
        if [ "$HAS_OPT1" = "true" ]; then
            run_full_install
        else
            log_error "Option 1 is not available: macW1Y v${INSTALLED_VER} is already installed. Choose [2] to update or [3] for clean reinstall."
            exit 1
        fi
        ;;
    2)
        if [ "$HAS_OPT2" = "true" ]; then
            run_incremental_update "$INSTALLED_VER" "$NEW_VERSION"
        else
            log_error "Option 2 is not available: no previous version detected on this system. Choose [1] for full install or [3] for clean reinstall."
            exit 1
        fi
        ;;
    3)
        run_clean_update "$INSTALLED_VER" "$NEW_VERSION"
        ;;
    4)
        exec "$SCRIPT_DIR/libexec/macw1y-uninstall" --all
        ;;
    0)
        echo -e "\nOperation complete. Exiting installer."
        exit 0
        ;;
    *)
        echo -e "\nInvalid choice. Installation cancelled."
        exit 1
        ;;
esac
