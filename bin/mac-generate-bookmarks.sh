#!/bin/bash
# mac-generate-bookmarks.sh
# Dynamically generates ~/.config/gtk-3.0/bookmarks for ANY user and ANY system language.
# Prevents hardcoding /home/vitaliy or localized folder names.

TARGET_USER="${1:-$(id -un)}"
TARGET_HOME="${2:-$(getent passwd "$TARGET_USER" 2>/dev/null | cut -d: -f6)}"
[ -z "$TARGET_HOME" ] && TARGET_HOME="$HOME"

CONFIG_DIR="$TARGET_HOME/.config/gtk-3.0"
BOOKMARKS_FILE="$CONFIG_DIR/bookmarks"
mkdir -p "$CONFIG_DIR"

# Ensure ~/Applications exists
APPS_DIR="$TARGET_HOME/Applications"
mkdir -p "$APPS_DIR"
chown "$TARGET_USER:$TARGET_USER" "$APPS_DIR" 2>/dev/null || true

# Determine language / locale
IS_UKRAINIAN=0
if [ -f "$TARGET_HOME/.config/user-dirs.locale" ]; then
    grep -qi "^uk" "$TARGET_HOME/.config/user-dirs.locale" && IS_UKRAINIAN=1
fi
if [ "$IS_UKRAINIAN" -eq 0 ] && [ -n "$LANG" ]; then
    echo "$LANG" | grep -qi "^uk" && IS_UKRAINIAN=1
fi

# Resolve XDG user dirs for TARGET_USER
UDIRS_FILE="$TARGET_HOME/.config/user-dirs.dirs"
if [ -f "$UDIRS_FILE" ]; then
    # Parse user-dirs.dirs safely without executing arbitrary code
    DESKTOP_DIR=$(grep "^XDG_DESKTOP_DIR=" "$UDIRS_FILE" | cut -d= -f2- | tr -d '"' | sed "s|\$HOME|$TARGET_HOME|g")
    DOCUMENTS_DIR=$(grep "^XDG_DOCUMENTS_DIR=" "$UDIRS_FILE" | cut -d= -f2- | tr -d '"' | sed "s|\$HOME|$TARGET_HOME|g")
    DOWNLOAD_DIR=$(grep "^XDG_DOWNLOAD_DIR=" "$UDIRS_FILE" | cut -d= -f2- | tr -d '"' | sed "s|\$HOME|$TARGET_HOME|g")
    PICTURES_DIR=$(grep "^XDG_PICTURES_DIR=" "$UDIRS_FILE" | cut -d= -f2- | tr -d '"' | sed "s|\$HOME|$TARGET_HOME|g")
    VIDEOS_DIR=$(grep "^XDG_VIDEOS_DIR=" "$UDIRS_FILE" | cut -d= -f2- | tr -d '"' | sed "s|\$HOME|$TARGET_HOME|g")
elif [ "$TARGET_HOME" = "$HOME" ] && command -v xdg-user-dir >/dev/null 2>&1; then
    DESKTOP_DIR="$(xdg-user-dir DESKTOP)"
    DOCUMENTS_DIR="$(xdg-user-dir DOCUMENTS)"
    DOWNLOAD_DIR="$(xdg-user-dir DOWNLOAD)"
    PICTURES_DIR="$(xdg-user-dir PICTURES)"
    VIDEOS_DIR="$(xdg-user-dir VIDEOS)"
else
    DESKTOP_DIR="$TARGET_HOME/Desktop"
    DOCUMENTS_DIR="$TARGET_HOME/Documents"
    DOWNLOAD_DIR="$TARGET_HOME/Downloads"
    PICTURES_DIR="$TARGET_HOME/Pictures"
    VIDEOS_DIR="$TARGET_HOME/Videos"
fi

# Fallbacks if variable is empty or doesn't exist
[ -z "$DESKTOP_DIR" ] && DESKTOP_DIR="$TARGET_HOME/Desktop"
[ -z "$DOCUMENTS_DIR" ] && DOCUMENTS_DIR="$TARGET_HOME/Documents"
[ -z "$DOWNLOAD_DIR" ] && DOWNLOAD_DIR="$TARGET_HOME/Downloads"
[ -z "$PICTURES_DIR" ] && PICTURES_DIR="$TARGET_HOME/Pictures"
[ -z "$VIDEOS_DIR" ] && VIDEOS_DIR="$TARGET_HOME/Videos"

# Ensure all target directories physically exist
for d in "$DESKTOP_DIR" "$DOCUMENTS_DIR" "$DOWNLOAD_DIR" "$PICTURES_DIR" "$VIDEOS_DIR"; do
    if [ ! -d "$d" ]; then
        mkdir -p "$d" 2>/dev/null || true
        chown "$TARGET_USER:$TARGET_USER" "$d" 2>/dev/null || true
    fi
done

# Create compatibility symlinks for English names if system has localized non-English names
create_compat_symlink() {
    local target="$1"
    local link_name="$TARGET_HOME/$2"
    if [ "$target" != "$link_name" ] && [ ! -e "$link_name" ] && [ -d "$target" ]; then
        ln -sfn "$target" "$link_name" 2>/dev/null || true
        chown -h "$TARGET_USER:$TARGET_USER" "$link_name" 2>/dev/null || true
    fi
}
create_compat_symlink "$DESKTOP_DIR" "Desktop"
create_compat_symlink "$DOCUMENTS_DIR" "Documents"
create_compat_symlink "$DOWNLOAD_DIR" "Downloads"
create_compat_symlink "$PICTURES_DIR" "Pictures"
create_compat_symlink "$VIDEOS_DIR" "Videos"

# Also if vitaliy had 'Десктоп', ensure that symlink exists if target is Desktop
if [ "$DESKTOP_DIR" != "$TARGET_HOME/Десктоп" ] && [ ! -e "$TARGET_HOME/Десктоп" ]; then
    ln -sfn "$DESKTOP_DIR" "$TARGET_HOME/Десктоп" 2>/dev/null || true
fi

# Helper function to encode path into URI
encode_path_uri() {
    python3 -c "import urllib.parse, sys; print('file://' + urllib.parse.quote(sys.argv[1]))" "$1" 2>/dev/null || echo "file://$1"
}

APPS_URI="$(encode_path_uri "$APPS_DIR")"
DESKTOP_URI="$(encode_path_uri "$DESKTOP_DIR")"
DOCUMENTS_URI="$(encode_path_uri "$DOCUMENTS_DIR")"
DOWNLOAD_URI="$(encode_path_uri "$DOWNLOAD_DIR")"
PICTURES_URI="$(encode_path_uri "$PICTURES_DIR")"
VIDEOS_URI="$(encode_path_uri "$VIDEOS_DIR")"

# Set localized labels
if [ "$IS_UKRAINIAN" -eq 1 ]; then
    LBL_APPS="Програми"
    LBL_DESK="Робочий стіл"
    LBL_DOCS="Документи"
    LBL_DOWN="Завантаження"
    LBL_PICS="Фото"
    LBL_VIDS="Відеозаписи"
else
    LBL_APPS="Applications"
    LBL_DESK="Desktop"
    LBL_DOCS="Documents"
    LBL_DOWN="Downloads"
    LBL_PICS="Pictures"
    LBL_VIDS="Movies"
fi

cat > "$BOOKMARKS_FILE" <<EOF
$APPS_URI $LBL_APPS
$DESKTOP_URI $LBL_DESK
$DOCUMENTS_URI $LBL_DOCS
$DOWNLOAD_URI $LBL_DOWN
$PICTURES_URI $LBL_PICS
$VIDEOS_URI $LBL_VIDS
EOF

chown "$TARGET_USER:$TARGET_USER" "$BOOKMARKS_FILE" 2>/dev/null || true
chmod 644 "$BOOKMARKS_FILE" 2>/dev/null || true
