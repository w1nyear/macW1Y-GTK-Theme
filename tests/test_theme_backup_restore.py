import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class ThemeBackupRestoreTests(unittest.TestCase):
    def test_backup_custom_themes(self):
        with tempfile.TemporaryDirectory() as folder:
            fake_home = folder
            script = f"""
TARGET_HOME="{fake_home}"
TARGET_USER="testuser"
DISTRO_ID="arch"
run_as_user() {{
    case "$*" in
        *"interface gtk-theme"*) echo "'Nordic'" ;;
        *"interface icon-theme"*) echo "'Papirus-Dark'" ;;
        *"interface cursor-theme"*) echo "'Bibata-Modern-Classic'" ;;
        *"wm.preferences theme"*) echo "'Nordic'" ;;
        *"wm.preferences button-layout"*) echo "'close,minimize,maximize:'" ;;
        *"sound theme-name"*) echo "'custom-sound'" ;;
        *) echo "" ;;
    esac
}}
chown() {{ return 0; }}

# Source backup function from install.sh
eval "$(sed -n '/^backup_original_user_themes()/,/^}}/p' "{ROOT / 'install.sh'}")"

backup_original_user_themes
"""
            res = subprocess.run(['bash', '-c', script], capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, res.stderr)

            conf_path = pathlib.Path(fake_home) / '.config/mac-styling/backup_theme_state.conf'
            self.assertTrue(conf_path.exists())
            content = conf_path.read_text()
            self.assertIn('ORIG_GTK="Nordic"', content)
            self.assertIn('ORIG_ICON="Papirus-Dark"', content)
            self.assertIn('ORIG_CURSOR="Bibata-Modern-Classic"', content)
            self.assertIn('ORIG_WM="Nordic"', content)
            self.assertIn('ORIG_BUTTONS="close,minimize,maximize:"', content)
            self.assertIn('ORIG_SOUND="custom-sound"', content)

    def test_backup_handles_already_macw1y(self):
        with tempfile.TemporaryDirectory() as folder:
            fake_home = folder
            script = f"""
TARGET_HOME="{fake_home}"
TARGET_USER="testuser"
DISTRO_ID="arch"
run_as_user() {{
    case "$*" in
        *"interface gtk-theme"*) echo "'macW1Y-Dark'" ;;
        *"interface icon-theme"*) echo "'macW1Y-Icons'" ;;
        *"interface cursor-theme"*) echo "'macW1Y'" ;;
        *"wm.preferences theme"*) echo "'macW1Y-Dark'" ;;
        *"wm.preferences button-layout"*) echo "'close,minimize,maximize:'" ;;
        *"sound theme-name"*) echo "'macW1Y'" ;;
        *) echo "" ;;
    esac
}}
chown() {{ return 0; }}

eval "$(sed -n '/^backup_original_user_themes()/,/^}}/p' "{ROOT / 'install.sh'}")"

backup_original_user_themes
"""
            res = subprocess.run(['bash', '-c', script], capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, res.stderr)

            conf_path = pathlib.Path(fake_home) / '.config/mac-styling/backup_theme_state.conf'
            self.assertTrue(conf_path.exists())
            content = conf_path.read_text()
            # Must fall back to Adwaita, NOT save macW1Y as original!
            self.assertIn('ORIG_GTK="Adwaita"', content)
            self.assertIn('ORIG_ICON="Adwaita"', content)
            self.assertIn('ORIG_CURSOR="Adwaita"', content)
            self.assertIn('ORIG_WM="Adwaita"', content)

    def test_restore_preserves_custom_themes(self):
        with tempfile.TemporaryDirectory() as folder:
            fake_home = folder
            backup_dir = pathlib.Path(fake_home) / '.config/mac-styling'
            backup_dir.mkdir(parents=True)
            conf_path = backup_dir / 'backup_theme_state.conf'
            conf_path.write_text("""
ORIG_GTK="Nordic"
ORIG_ICON="Papirus-Dark"
ORIG_CURSOR="Bibata-Modern-Classic"
ORIG_WM="Nordic"
ORIG_BUTTONS="close,minimize,maximize:"
ORIG_SOUND="custom-sound"
ORIG_SYS_CURSOR="Bibata-Modern-Classic"
""")
            script = f"""
TARGET_HOME="{fake_home}"
IS_UBUNTU=false
SET_COMMANDS=()
run_as_user() {{
    SET_COMMANDS+=("$*")
}}
log_info() {{ :; }}

# Simulate the theme restore block from uninstall.sh
backup_file="$TARGET_HOME/.config/mac-styling/backup_theme_state.conf"
orig_gtk="" orig_icon="" orig_cursor="" orig_wm="" orig_buttons="" orig_sound="" orig_sys_cursor=""
if [ -f "$backup_file" ]; then
    . "$backup_file"
    orig_gtk="$ORIG_GTK"
    orig_icon="$ORIG_ICON"
    orig_cursor="$ORIG_CURSOR"
    orig_wm="$ORIG_WM"
    orig_buttons="$ORIG_BUTTONS"
    orig_sound="$ORIG_SOUND"
    orig_sys_cursor="$ORIG_SYS_CURSOR"
fi

default_theme="Adwaita"
default_cursor="Adwaita"
default_sound="freedesktop"
if [ "$IS_UBUNTU" = "true" ]; then
    default_theme="Yaru"
    default_cursor="Yaru"
    default_sound="Yaru"
fi

[ -z "$orig_gtk" ] || [[ "$orig_gtk" =~ macW1Y ]] && orig_gtk="$default_theme"
[ -z "$orig_icon" ] || [[ "$orig_icon" =~ macW1Y ]] && orig_icon="$default_theme"
[ -z "$orig_cursor" ] || [[ "$orig_cursor" =~ macW1Y ]] && orig_cursor="$default_cursor"
[ -z "$orig_wm" ] || [[ "$orig_wm" =~ macW1Y ]] && orig_wm="$default_theme"
[ -z "$orig_sound" ] || [[ "$orig_sound" =~ (macW1Y|mac-styling) ]] && orig_sound="$default_sound"

run_as_user gsettings set org.gnome.desktop.interface gtk-theme "$orig_gtk"
run_as_user gsettings set org.gnome.desktop.interface icon-theme "$orig_icon"
run_as_user gsettings set org.gnome.desktop.interface cursor-theme "$orig_cursor"
run_as_user gsettings set org.gnome.desktop.wm.preferences theme "$orig_wm"
if [ -n "$orig_buttons" ]; then
    run_as_user gsettings set org.gnome.desktop.wm.preferences button-layout "$orig_buttons"
fi
run_as_user gsettings set org.gnome.desktop.sound theme-name "$orig_sound"

printf "%s\\n" "${{SET_COMMANDS[@]}}"
"""
            res = subprocess.run(['bash', '-c', script], capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, res.stderr)
            stdout = res.stdout
            self.assertIn("gtk-theme Nordic", stdout)
            self.assertIn("icon-theme Papirus-Dark", stdout)
            self.assertIn("cursor-theme Bibata-Modern-Classic", stdout)
            self.assertIn("wm.preferences theme Nordic", stdout)
            self.assertIn("button-layout close,minimize,maximize:", stdout)
            self.assertIn("sound theme-name custom-sound", stdout)


if __name__ == '__main__':
    unittest.main()
