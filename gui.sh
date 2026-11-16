#!/usr/bin/env bash
# ==============================================================================
#   macOS Sequoia / Tahoe Transformation Modpack (macW1Y Release)
#  GUI Test Simulator & Mock Installer - Version 0.7
# ==============================================================================

set -e

# Version Constants
NEW_VERSION="0.7"

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

# GUI Installer Dispatcher
GUI_WORKER="false"
if [ "$1" = "--gui-worker" ]; then
    GUI_WORKER="true"
    shift
elif [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    : # Let help option be handled below
elif [ "$1" = "--cli" ] || [ "$1" = "-cli" ]; then
    shift
    MAC_INSTALLER_CLI="1"
elif [ -z "$MAC_INSTALLER_CLI" ]; then
    if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; then
        if [ -x "$SCRIPT_DIR/bin/mac-installer-gui" ] && command -v python3 >/dev/null 2>&1; then
            # Pre-activate macW1Y environment and disable legacy extensions
            for ext in "ubuntu-dock@ubuntu.com" "tiling-assistant@ubuntu.com" "ding@rastersoft.com" "dash-to-dock@micxgx.gmail.com" "stage-manager@gnome-stage-manager" "snapd-prompting@canonical.com" "web-search-provider@ubuntu.com"; do
                gnome-extensions disable "$ext" 2>/dev/null || true
            done
            for ext in "user-theme@gnome-shell-extensions.gcampax.github.com" "eval-helper@mactheme" "blur-my-shell@aunetx" "dash2dock-motion@unmade.space" "appmenu@ChathurangaBW.github.io" "kiwi@kemma" "desktop-widgets@r3nhick" "macos-touchpad-gestures@mactheme" "compiz-alike-magic-lamp-effect@hermes83.github.com" "cupertino-dock-lite@rinzler69-wastaken.github.com" "custom-command-toggle@storageb.github.com" "liquid-glass@thinkingcoding1231.gmail.com" "quick-settings-scroll@diskmth.fr" "Rounded_Corners@lennart-k" "volume-percentage-quick-settings@imdarktom" "wack-lockscreen-clock@rinzler69-wastaken.github.com" "wifi-hotspot-quick-settings@aryan10.github.io"; do
                gnome-extensions enable "$ext" 2>/dev/null || true
            done
            gsettings set org.gnome.shell.extensions.user-theme name "macW1Y-Dark" 2>/dev/null || true
            gsettings set org.gnome.desktop.interface gtk-theme "macW1Y-Dark" 2>/dev/null || true
            gsettings set org.gnome.desktop.interface icon-theme "MacTahoe-dark" 2>/dev/null || true
            gsettings set org.gnome.desktop.interface font-name "Inter 10" 2>/dev/null || true
            export MAC_INSTALLER_SCRIPT="$SCRIPT_DIR/gui.sh"
            exec "$SCRIPT_DIR/bin/mac-installer-gui" --mock-installer "$@"
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
    echo "  ║              Transformation GUI Simulator (Mock Installer)                 ║"
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
# Mock Installation Engine (10-Second Simulation)
# ------------------------------------------------------------------------------
run_mock_installation() {
    local action_title="${1:-Mock Installation}"

    if [ "$GUI_WORKER" != "true" ]; then
        log_step "Running 10-Second Simulation: $action_title"
        log_info "Simulating macW1Y deployment without modifying system files or packages."
    fi

    local steps=(
        "10:stage1:Stage 1/10: Verifying system dependencies and environment"
        "20:stage2:Stage 2/10: Verifying typography and font bundles"
        "30:stage3:Stage 3/10: Preparing macW1Y GTK and Shell theme engines"
        "45:stage4:Stage 4/10: Validating MacTahoe icon assets and cursors"
        "55:stage5:Stage 5/10: Checking sound themes and audio feedback"
        "65:stage6:Stage 6/10: Preparing Golden Gate wallpaper integration"
        "75:stage7:Stage 7/10: Simulating GNOME Shell extensions deployment"
        "85:stage8:Stage 8/10: Testing System Settings control panels"
        "95:stage9:Stage 9/10: Simulating touchpad gesture daemon"
        "100:finalizing:Finalizing simulated configuration"
    )

    for item in "${steps[@]}"; do
        IFS=":" read -r pct stage_id desc <<< "$item"
        if [ "$GUI_WORKER" = "true" ]; then
            echo "PROGRESS:${pct}:${stage_id}"
        else
            echo -e "  [${pct}%] ${C_CYAN}${desc}...${C_RESET}"
        fi
        sleep 1
    done

    if [ "$GUI_WORKER" != "true" ]; then
        echo -e "\n${C_GREEN}[✔] Simulation completed successfully in 10 seconds!${C_RESET}"
        echo -e " ${C_BOLD}No system files or packages were modified.${C_RESET}\n"
    fi
}

run_full_install() {
    run_mock_installation "Full Installation"
}

run_incremental_update() {
    run_mock_installation "Incremental Update"
}

run_clean_update() {
    run_mock_installation "Clean Reinstall"
}

run_debug_uninstall() {
    run_mock_installation "Simulated Uninstall"
}

# ------------------------------------------------------------------------------
# CLI Command-Line Arguments
# ------------------------------------------------------------------------------
if [ "$1" = "-debug_uninstall" ] || [ "$1" = "--debug_uninstall" ] || [ "$1" = "--uninstall" ]; then
    print_banner
    run_debug_uninstall
    exit 0
elif [ "$1" = "--install" ] || [ "$1" = "-i" ] || [ "$1" = "--all" ] || [ "$1" = "-y" ] || [ "$1" = "--yes" ]; then
    print_banner
    run_full_install
    exit 0
elif [ "$1" = "--update" ] || [ "$1" = "-u" ]; then
    print_banner
    run_incremental_update
    exit 0
elif [ "$1" = "--clean-update" ] || [ "$1" = "-c" ]; then
    print_banner
    run_clean_update
    exit 0
elif [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Usage: ./gui.sh [OPTIONS]"
    echo "  --install, -i, --all    Simulate full installation (10-second mock)"
    echo "  --update, -u            Simulate incremental update (10-second mock)"
    echo "  --clean-update, -c      Simulate clean reinstall (10-second mock)"
    echo "  --uninstall             Simulate uninstall (10-second mock)"
    echo "  --cli                   Force CLI text mode instead of launching GUI"
    echo "  --help, -h              Show this help message"
    exit 0
fi

# ------------------------------------------------------------------------------
# Interactive Menu (CLI Mode)
# ------------------------------------------------------------------------------
print_banner

INSTALLED_VER="$(get_installed_version)"
CMP_RES=0
if [ -n "$INSTALLED_VER" ]; then
    CMP_RES=$(compare_semver "$INSTALLED_VER" "$NEW_VERSION")
fi

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
    1)
        run_full_install
        ;;
    2)
        run_incremental_update
        ;;
    3)
        run_clean_update
        ;;
    4|0)
        echo -e "\nSimulation exited cleanly."
        exit 0
        ;;
    *)
        echo -e "\nInvalid choice. Simulation cancelled."
        exit 1
        ;;
esac
