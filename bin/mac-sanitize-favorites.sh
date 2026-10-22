#!/usr/bin/env python3
"""
mac-sanitize-favorites.sh - Dynamically inspects and sanitizes org.gnome.shell favorite-apps
for the macOS Tahoe theme.

Ensures that:
1. Applications not installed on the system (e.g. Steam, Telegram, Chrome, Antigravity, OpenCode)
   are never pinned to the dock.
2. Stale or phantom .desktop files in ~/.local/share/applications/ are removed.
3. Essential macOS base dock applications are always present and properly ordered:
   - Finder (org.gnome.Nautilus.desktop)
   - Launchpad (launchpad.desktop)
   - Default Browser (Chrome, Firefox, Brave, Chromium, Edge, Opera)
   - Default Terminal (Ptyxis, GNOME Terminal, Console, Tilix, Alacritty, Kitty)
   - Other installed user applications
   - System Settings (org.gnome.Settings.desktop)
"""

import os
import sys
import shutil
import subprocess
import ast

def which_exists(cmd):
    return shutil.which(cmd) is not None

def flatpak_app_exists(app_ref):
    try:
        out = subprocess.check_output(['flatpak', 'list'], stderr=subprocess.DEVNULL, text=True)
        return app_ref in out
    except Exception:
        return False

def is_steam_installed():
    return (
        os.path.exists('/snap/bin/steam') or 
        os.path.exists('/usr/games/steam') or 
        os.path.exists('/usr/bin/steam') or
        (shutil.which('steam') not in (None, '/usr/local/bin/steam')) or
        (which_exists('flatpak') and flatpak_app_exists('com.valvesoftware.Steam'))
    )

def is_chrome_installed():
    return (
        os.path.exists('/usr/bin/google-chrome-stable') or
        os.path.exists('/usr/bin/google-chrome') or
        os.path.exists('/snap/bin/google-chrome') or
        (shutil.which('google-chrome') not in (None, os.path.expanduser('~/.local/bin/google-chrome'))) or
        (shutil.which('google-chrome-stable') not in (None, os.path.expanduser('~/.local/bin/google-chrome-stable'))) or
        (which_exists('flatpak') and flatpak_app_exists('com.google.Chrome'))
    )

def is_telegram_installed():
    return (
        os.path.exists('/snap/bin/telegram-desktop') or
        os.path.exists('/usr/bin/telegram-desktop') or
        which_exists('telegram-desktop') or
        (which_exists('flatpak') and flatpak_app_exists('org.telegram.desktop'))
    )

def is_antigravity_installed():
    return (
        os.path.exists('/snap/bin/antigravity') or
        os.path.exists('/usr/bin/antigravity') or
        os.path.exists('/usr/local/bin/antigravity') or
        which_exists('antigravity') or
        which_exists('agy')
    )

def is_opencode_installed():
    return (
        os.path.exists('/opt/OpenCode/ai.opencode.desktop') or
        which_exists('opencode') or
        which_exists('ai.opencode.desktop')
    )

def get_desktop_file_path(app_id):
    search_dirs = [
        os.path.expanduser('~/.local/share/applications'),
        '/usr/local/share/applications',
        '/usr/share/applications',
        '/var/lib/snapd/desktop/applications',
        '/var/lib/flatpak/exports/share/applications',
        os.path.expanduser('~/.local/share/flatpak/exports/share/applications'),
    ]
    for d in search_dirs:
        p = os.path.join(d, app_id)
        if os.path.isfile(p):
            return p
    return None

def is_app_installed_and_valid(app_id):
    if app_id == 'launchpad.desktop':
        return True
    if app_id in ('steam_steam.desktop', 'steam.desktop'):
        return is_steam_installed()
    if app_id == 'ai.opencode.desktop.desktop':
        return is_opencode_installed()
    if app_id == 'antigravity_antigravity.desktop':
        return is_antigravity_installed()
    if app_id in ('google-chrome.desktop', 'com.google.Chrome.desktop'):
        return is_chrome_installed()
    if app_id in ('telegram-desktop_telegram-desktop.desktop', 'org.telegram.desktop.desktop', 'telegram-desktop.desktop'):
        return is_telegram_installed()
    if app_id in ('org.gnome.Nautilus.desktop', 'org.gnome.Settings.desktop'):
        return True

    df = get_desktop_file_path(app_id)
    if not df:
        return False

    exec_cmd = None
    try:
        with open(df, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                line = line.strip()
                if line.startswith('Exec='):
                    exec_cmd = line[5:].strip()
                    break
    except Exception:
        return False

    if not exec_cmd:
        return False

    parts = exec_cmd.split()
    if not parts:
        return False
    bin_name = parts[0]

    # Steam wrapper special check
    if bin_name in ('/usr/local/bin/steam', 'steam'):
        return is_steam_installed()
    if bin_name in ('/usr/local/bin/google-chrome', os.path.expanduser('~/.local/bin/google-chrome')):
        return is_chrome_installed()

    if bin_name.startswith('/'):
        return os.path.isfile(bin_name) and os.access(bin_name, os.X_OK)
    else:
        return which_exists(bin_name)

def clean_stale_local_desktops():
    local_apps = os.path.expanduser('~/.local/share/applications')
    if not os.path.isdir(local_apps):
        return

    stale_checks = [
        (['steam_steam.desktop', 'steam.desktop'], is_steam_installed),
        (['antigravity_antigravity.desktop'], is_antigravity_installed),
        (['telegram-desktop_telegram-desktop.desktop', 'telegram-desktop.desktop'], is_telegram_installed),
        (['google-chrome.desktop'], is_chrome_installed),
    ]

    for files, check_fn in stale_checks:
        if not check_fn():
            for fname in files:
                target = os.path.join(local_apps, fname)
                if os.path.isfile(target):
                    try:
                        os.remove(target)
                    except Exception:
                        pass

def find_best_browser():
    candidates = [
        ('google-chrome.desktop', ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/snap/bin/google-chrome', 'google-chrome']),
        ('firefox_firefox.desktop', ['/snap/bin/firefox']),
        ('firefox.desktop', ['/usr/bin/firefox', '/usr/lib/firefox/firefox', 'firefox']),
        ('brave-browser.desktop', ['/usr/bin/brave-browser', 'brave-browser']),
        ('chromium_chromium.desktop', ['/snap/bin/chromium']),
        ('chromium.desktop', ['/usr/bin/chromium', '/usr/bin/chromium-browser', 'chromium']),
        ('microsoft-edge.desktop', ['/usr/bin/microsoft-edge', 'microsoft-edge']),
        ('opera.desktop', ['/usr/bin/opera', 'opera']),
    ]
    for desk, bins in candidates:
        for b in bins:
            if b.startswith('/'):
                if os.path.isfile(b) and os.access(b, os.X_OK):
                    return desk
            else:
                if which_exists(b):
                    return desk
    return None

def find_best_terminal():
    candidates = [
        ('org.gnome.Ptyxis.desktop', ['/usr/bin/ptyxis', 'ptyxis']),
        ('org.gnome.Terminal.desktop', ['/usr/bin/gnome-terminal', 'gnome-terminal']),
        ('org.gnome.Console.desktop', ['/usr/bin/kgx', 'kgx']),
        ('com.gexperts.Tilix.desktop', ['/usr/bin/tilix', 'tilix']),
        ('Alacritty.desktop', ['/usr/bin/alacritty', 'alacritty']),
        ('kitty.desktop', ['/usr/bin/kitty', 'kitty']),
    ]
    for desk, bins in candidates:
        for b in bins:
            if b.startswith('/'):
                if os.path.isfile(b) and os.access(b, os.X_OK):
                    return desk
            else:
                if which_exists(b):
                    return desk
    return None

def read_favorites_from_gsettings():
    try:
        out = subprocess.check_output(['gsettings', 'get', 'org.gnome.shell', 'favorite-apps'], text=True).strip()
        return ast.literal_eval(out)
    except Exception:
        return []

def write_favorites_to_gsettings(favs):
    # Format as GSettings array string: ['app1.desktop', 'app2.desktop']
    strv = "[" + ", ".join(f"'{f}'" for f in favs) + "]"
    try:
        subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'favorite-apps', strv], check=True)
    except Exception as e:
        print(f"Error updating favorite-apps: {e}", file=sys.stderr)

def main():
    # 1. Clean stale .desktop files in ~/.local/share/applications/
    clean_stale_local_desktops()

    # 2. Get input favorites
    input_favs = []
    if len(sys.argv) > 1 and sys.argv[1].strip():
        arg_val = sys.argv[1].strip()
        try:
            input_favs = ast.literal_eval(arg_val)
        except Exception:
            pass

    current_favs = read_favorites_from_gsettings()

    # Combine input and current favorites while preserving order and uniqueness
    combined_favs = []
    seen = set()
    for item in (current_favs + input_favs):
        if item and item not in seen:
            combined_favs.append(item)
            seen.add(item)

    # 3. Filter valid applications
    valid_favs = [app for app in combined_favs if is_app_installed_and_valid(app)]

    # 4. Construct macOS Tahoe dock layout
    # Ensure Finder (Nautilus) at pos 0
    nautilus = 'org.gnome.Nautilus.desktop'
    if nautilus in valid_favs:
        valid_favs.remove(nautilus)
    valid_favs.insert(0, nautilus)

    # Ensure Launchpad at pos 1
    launchpad = 'launchpad.desktop'
    if launchpad in valid_favs:
        valid_favs.remove(launchpad)
    valid_favs.insert(1, launchpad)

    # Check if a browser is present
    known_browsers = {
        'google-chrome.desktop', 'firefox_firefox.desktop', 'firefox.desktop',
        'brave-browser.desktop', 'chromium_chromium.desktop', 'chromium.desktop',
        'microsoft-edge.desktop', 'opera.desktop', 'org.gnome.Epiphany.desktop'
    }
    has_browser = any(b in valid_favs for b in known_browsers)
    if not has_browser:
        best_browser = find_best_browser()
        if best_browser:
            valid_favs.insert(2, best_browser)

    # Check if a terminal is present
    known_terminals = {
        'org.gnome.Ptyxis.desktop', 'ptyxis.desktop', 'org.gnome.Terminal.desktop',
        'org.gnome.Console.desktop', 'com.gexperts.Tilix.desktop', 'Alacritty.desktop', 'kitty.desktop'
    }
    has_terminal = any(t in valid_favs for t in known_terminals)
    if not has_terminal:
        best_terminal = find_best_terminal()
        if best_terminal:
            # Insert after browser (pos 3 or pos 2)
            insert_pos = 3 if any(b in valid_favs for b in known_browsers) else 2
            valid_favs.insert(insert_pos, best_terminal)

    # Ensure Settings at the end
    settings = 'org.gnome.Settings.desktop'
    if settings in valid_favs:
        valid_favs.remove(settings)
    valid_favs.append(settings)

    # 5. Write back only if changed
    if valid_favs != current_favs:
        print(f"mac-sanitize-favorites: Updating favorite-apps from {len(current_favs)} to {len(valid_favs)} items:")
        print(f"  Old: {current_favs}")
        print(f"  New: {valid_favs}")
        write_favorites_to_gsettings(valid_favs)
    else:
        print(f"mac-sanitize-favorites: favorite-apps already optimal ({len(valid_favs)} items).")

if __name__ == '__main__':
    main()
