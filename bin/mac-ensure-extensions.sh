#!/bin/bash
# mac-ensure-extensions.sh - Self-healing watchdog on session startup
# Wait for GNOME Shell session and D-Bus readiness (up to 15s)
for i in {1..30}; do
    if gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.freedesktop.DBus.Peer.Ping >/dev/null 2>&1; then
        break
    fi
    sleep 0.5
done

gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell disable-extension-version-validation true

CURRENT=$(gsettings get org.gnome.shell.extensions.user-theme name 2>/dev/null | tr -d "'")
if [ -z "$CURRENT" ] || [ "$CURRENT" = "''" ]; then
    gsettings set org.gnome.shell.extensions.user-theme name 'macW1Y-Dark'
fi

# Ensure wallpaper is applied across all distros (Arch/CachyOS, Fedora, Debian, Mint)
DEFAULT_WP="/usr/share/backgrounds/GoldenGate_Day.jpg"
if [ -f "$DEFAULT_WP" ]; then
    CUR_URI=$(gsettings get org.gnome.desktop.background picture-uri 2>/dev/null | tr -d "'")
    CUR_URI_DARK=$(gsettings get org.gnome.desktop.background picture-uri-dark 2>/dev/null | tr -d "'")
    CUR_OPTS=$(gsettings get org.gnome.desktop.background picture-options 2>/dev/null | tr -d "'")
    CUR_PATH="${CUR_URI#file://}"
    CUR_DARK_PATH="${CUR_URI_DARK#file://}"
    if [ -z "$CUR_URI" ] || [ ! -f "$CUR_PATH" ]; then
        gsettings set org.gnome.desktop.background picture-uri "file://$DEFAULT_WP" 2>/dev/null || true
    fi
    if [ -z "$CUR_URI_DARK" ] || [ ! -f "$CUR_DARK_PATH" ]; then
        gsettings set org.gnome.desktop.background picture-uri-dark "file://$DEFAULT_WP" 2>/dev/null || true
    fi
    if [ -z "$CUR_OPTS" ] || [ "$CUR_OPTS" = "none" ]; then
        gsettings set org.gnome.desktop.background picture-options 'zoom' 2>/dev/null || true
    fi
fi

REQUIRED_EXTENSIONS=(
    "user-theme@gnome-shell-extensions.gcampax.github.com"
    "ubuntu-appindicators@ubuntu.com"
    "compiz-alike-magic-lamp-effect@hermes83.github.com"
    "Rounded_Corners@lennart-k"
    "macw1y-touchpad-gestures@mactheme"
    "desktop-widgets@r3nhick"
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
)

for ext in "${REQUIRED_EXTENSIONS[@]}"; do
    staged_update="$HOME/.local/share/gnome-shell/extension-updates/$ext"
    if [ -e "$staged_update" ]; then
        rm -rf "$staged_update" 2>/dev/null || true
    fi
done

ENABLED=$(LD_PRELOAD= gnome-extensions list --enabled 2>/dev/null)
for ext_dir in "$HOME/.local/share/gnome-shell/extensions"/*; do
    if [ -d "$ext_dir/schemas" ]; then
        if [ ! -f "$ext_dir/schemas/gschemas.compiled" ] || find "$ext_dir/schemas" -name '*.gschema.xml' -newer "$ext_dir/schemas/gschemas.compiled" | grep -q .; then
            glib-compile-schemas "$ext_dir/schemas" 2>/dev/null || true
        fi
    fi
done
for ext in "${REQUIRED_EXTENSIONS[@]}"; do
    if ! echo "$ENABLED" | grep -qx "$ext"; then
        LD_PRELOAD= gnome-extensions enable "$ext" 2>/dev/null || true
    fi
done

# Ensure bloat remains disabled
BLOAT_EXTS=(
    "snapd-prompting@canonical.com"
    "snapd-search-provider@canonical.com"
    "web-search-provider@ubuntu.com"
    "tiling-assistant@ubuntu.com"
    "ubuntu-dock@ubuntu.com"
    "dash-to-dock@micxgx.gmail.com"
)
for ext in "${BLOAT_EXTS[@]}"; do
    LD_PRELOAD= gnome-extensions disable "$ext" 2>/dev/null || true
done

# Ensure bookmarks and favorite-apps in background so startup dock does not flicker/rebuild Trash twice
(
    if [ -x /usr/local/bin/mac-generate-bookmarks.sh ]; then
        /usr/local/bin/mac-generate-bookmarks.sh "$(id -un)" "$HOME" 2>/dev/null || true
    fi
    if [ -x /usr/local/bin/mac-sanitize-favorites.sh ]; then
        /usr/local/bin/mac-sanitize-favorites.sh 2>/dev/null || true
    fi
) >/dev/null 2>&1 &
