#!/bin/bash
# mac-ensure-extensions.sh - Self-healing watchdog on session startup
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell disable-extension-version-validation true

CURRENT=$(gsettings get org.gnome.shell.extensions.user-theme name 2>/dev/null | tr -d "'")
if [ -z "$CURRENT" ] || [ "$CURRENT" = "''" ]; then
    gsettings set org.gnome.shell.extensions.user-theme name 'macW1Y-Dark'
fi

REQUIRED_EXTENSIONS=(
    "user-theme@gnome-shell-extensions.gcampax.github.com"
    "ubuntu-appindicators@ubuntu.com"
    "compiz-alike-magic-lamp-effect@hermes83.github.com"
    "Rounded_Corners@lennart-k"
    "macos-touchpad-gestures@mactheme"
    "custom-command-toggle@storageb.github.com"
    "volume-percentage-quick-settings@imdarktom"
    "quick-settings-scroll@diskmth.fr"
    "wifi-hotspot-quick-settings@aryan10.github.io"
    "tahoe-widgets@micronix"
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

ENABLED=$(LD_PRELOAD= gnome-extensions list --enabled 2>/dev/null)
for ext in "${REQUIRED_EXTENSIONS[@]}"; do
    if ! echo "$ENABLED" | grep -qx "$ext"; then
        LD_PRELOAD= gnome-extensions enable "$ext" 2>/dev/null || true
    fi
done

# Ensure bloat remains disabled
BLOAT_EXTS=(
    "stage-manager@gnome-stage-manager"
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

# Ensure bookmarks are dynamically generated for current user and locale
if [ -x /usr/local/bin/mac-generate-bookmarks.sh ]; then
    /usr/local/bin/mac-generate-bookmarks.sh "$(id -un)" "$HOME" 2>/dev/null || true
fi

# Ensure favorite-apps does not contain uninstalled/phantom apps (Steam, Chrome, etc.)
if [ -x /usr/local/bin/mac-sanitize-favorites.sh ]; then
    /usr/local/bin/mac-sanitize-favorites.sh 2>/dev/null || true
fi
