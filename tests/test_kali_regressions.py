"""Regression tests for Kali Linux GNOME 50.5 startup, English localization, path safety, and rollback."""
import importlib.util
import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


STATE_MOD = load_module("macw1y_state", ROOT / "libexec/macw1y-state.py")
PLAT_MOD = load_module("check_platform", ROOT / "dependencies/check-platform.py")


class GnomeShellStartupTests(unittest.TestCase):
    def test_layout_js_guards_start_in_overview_for_supported_and_missing_schema(self):
        layout_src = (ROOT / "gnome-shell-overlay/ui/layout.js").read_text(encoding="utf-8")
        # Extract the guarded _startInOverview initialization block
        m = re.search(
            r"this\._startInOverview = false;.*?catch \(_e\) \{\s*this\._startInOverview = false;\s*\}\s*\}",
            layout_src,
            re.S,
        )
        self.assertIsNotNone(m, "layout.js must guard start-in-overview lookup")
        snippet = m.group(0)

        if not shutil.which("gjs"):
            self.skipTest("gjs not available")

        with tempfile.TemporaryDirectory() as folder:
            test_js = pathlib.Path(folder) / "test_layout_guard.js"
            test_js.write_text(
                f"""
function runCase(hasKey, keyVal, throwOnGet) {{
    const Main = {{ sessionMode: {{ hasOverview: true }} }};
    const global = {{
        settings: {{
            settings_schema: {{ has_key: (k) => hasKey && k === 'start-in-overview' }},
            get_boolean: (k) => {{
                if (throwOnGet) throw new Error('Schema key missing: ' + k);
                return keyVal;
            }},
        }},
    }};
    const obj = {{}};
    (function() {{
        {snippet}
    }}).call(obj);
    return obj._startInOverview;
}}

if (runCase(true, true, false) !== true) throw new Error('Expected true when schema has key');
if (runCase(false, true, true) !== false) throw new Error('Expected false without crash when schema lacks key');
if (runCase(true, true, true) !== false) throw new Error('Expected false when get_boolean throws');
print('OK');
""",
                encoding="utf-8",
            )
            res = subprocess.run(["gjs", str(test_js)], capture_output=True, text=True, check=True)
            self.assertEqual(res.stdout.strip(), "OK")

    def test_gnome_shell_wrapper_preserves_arguments_on_all_bypass_paths(self):
        wrapper = ROOT / "bin/gnome-shell"
        src = wrapper.read_text(encoding="utf-8")
        # Ensure no bare `bypass_overlay` call omits "$@"
        for lineno, line in enumerate(src.splitlines(), 1):
            stripped = line.strip()
            if stripped == "bypass_overlay":
                self.fail(f'bin/gnome-shell:{lineno} calls bypass_overlay without "$@"')

        with tempfile.TemporaryDirectory() as folder:
            tmp = pathlib.Path(folder)
            fake_shell = tmp / "gnome-shell.real"
            fake_shell.write_text(
                '#!/bin/sh\n'
                'if [ "$1" = "--version" ]; then echo "GNOME Shell $FAKE_GNOME_VER"; exit 0; fi\n'
                'printf "ARGS:%s|OVERLAY:%s\\n" "$*" "${G_RESOURCE_OVERLAYS:-}"\n',
                encoding="utf-8",
            )
            fake_shell.chmod(0o755)

            # 1. Manual safe mode bypass preserves all args and unsets G_RESOURCE_OVERLAYS
            env = dict(
                os.environ,
                REAL_SHELL=str(fake_shell),
                FAKE_GNOME_VER="50.5",
                MACW1Y_DISABLE_SHELL_OVERLAY="1",
                G_RESOURCE_OVERLAYS="/org/gnome/shell/ui/layout.js=/tmp/bad.js",
                XDG_RUNTIME_DIR=str(tmp),
            )
            res = subprocess.run(
                [str(wrapper), "--wayland", "--display-server", "--mode=user"],
                env=env,
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertEqual(res.stdout.strip(), "ARGS:--wayland --display-server --mode=user|OVERLAY:")

            # 2. Unsupported GNOME major version (e.g., 55.0) bypasses and preserves args
            env2 = dict(
                os.environ,
                REAL_SHELL=str(fake_shell),
                FAKE_GNOME_VER="55.0",
                MACW1Y_DISABLE_SHELL_OVERLAY="0",
                G_RESOURCE_OVERLAYS="/org/gnome/shell/ui/layout.js=/tmp/bad.js",
                XDG_RUNTIME_DIR=str(tmp),
            )
            res2 = subprocess.run(
                [str(wrapper), "--wayland", "--mode=gdm"],
                env=env2,
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertEqual(res2.stdout.strip(), "ARGS:--wayland --mode=gdm|OVERLAY:")

    def test_check_platform_schema_inspection_handles_missing_and_present_keys(self):
        with tempfile.TemporaryDirectory() as folder:
            tmp = pathlib.Path(folder)
            fake_gs_missing = tmp / "gs_missing"
            fake_gs_missing.write_text("#!/bin/sh\necho enabled-extensions\necho favorite-apps\n", encoding="utf-8")
            fake_gs_missing.chmod(0o755)
            info_missing = PLAT_MOD.inspect_shell_schema(str(fake_gs_missing))
            self.assertTrue(info_missing["available"])
            self.assertFalse(info_missing["has_start_in_overview"])

            fake_gs_present = tmp / "gs_present"
            fake_gs_present.write_text("#!/bin/sh\necho start-in-overview\necho favorite-apps\n", encoding="utf-8")
            fake_gs_present.chmod(0o755)
            info_present = PLAT_MOD.inspect_shell_schema(str(fake_gs_present))
            self.assertTrue(info_present["available"])
            self.assertTrue(info_present["has_start_in_overview"])


class LocalizationAndPathSafetyTests(unittest.TestCase):
    def test_english_localization_resources_and_fallbacks(self):
        # 1. dconf template has no Ukrainian workspace names or /home/vitaliy
        dconf_txt = (ROOT / "dconf/gnome-all.dconf").read_text(encoding="utf-8")
        self.assertNotIn("Робочий стіл", dconf_txt)
        self.assertNotIn("/home/vitaliy", dconf_txt)

        # 2. workspaceIndicator.js has no hardcoded Ukrainian defaults
        ws_txt = (ROOT / "extensions/appmenu@ChathurangaBW.github.io/workspaceIndicator.js").read_text(encoding="utf-8")
        self.assertNotIn("Робочий стіл", ws_txt)
        self.assertIn("getDefaultWorkspaceName", ws_txt)

        # 3. gestureImpl.js has no hardcoded Ukrainian OSD calls
        g_txt = (ROOT / "extensions/macw1y-touchpad-gestures@mactheme/gestureImpl.js").read_text(encoding="utf-8")
        self.assertNotIn("_showOsd('Скопійовано'", g_txt)
        self.assertNotIn("_showOsd('Вставлено'", g_txt)
        self.assertIn("_tGesture('copied')", g_txt)

        # 4. GRUB themes use English countdown text and readable non-black dual-boot menu colors/heights
        for theme_rel in ("grub/macw1y-boot/theme.txt", "grub/macw1y-boot-usb/theme.txt", "grub/macw1y-boot-usb2/theme.txt"):
            txt = (ROOT / theme_rel).read_text(encoding="utf-8")
            self.assertNotIn("Завантаження через", txt, f"Ukrainian countdown left in {theme_rel}")
            self.assertIn("Booting in %d s", txt)
            self.assertNotIn('item_color = "#000000"', txt, f"Invisible black item_color in {theme_rel}")
            self.assertNotIn('selected_item_color = "#000000"', txt, f"Invisible black selected_item_color in {theme_rel}")
            self.assertNotIn("item_height = 1080", txt, f"Fullscreen 1080 item_height hides dual-boot entries in {theme_rel}")

        # 4b. Default mac-styling locale and installer GUI default to English
        self.assertEqual((ROOT / "config/mac-styling/locale").read_text(encoding="utf-8").strip(), "en")
        gui_txt = (ROOT / "bin/mac-installer-gui").read_text(encoding="utf-8")
        self.assertNotIn('self.selected_language = "uk"', gui_txt)
        self.assertNotIn('os.environ.get("LANG", "uk_UA.UTF-8")', gui_txt)

        # 5. Settings English .ui files exist and install.sh deploys locales/
        en_ui_dir = ROOT / "gnome-control-center-overlay/locales/en"
        self.assertTrue(en_ui_dir.is_dir())
        self.assertGreaterEqual(len(list(en_ui_dir.glob("cc-*.ui"))), 5)
        installer_txt = (ROOT / "install.sh").read_text(encoding="utf-8")
        self.assertIn("gnome-control-center-overlay/locales", installer_txt)

        # 6. mac_i18n.js has newly added English keys
        i18n_txt = (ROOT / "extensions/kiwi@kemma/apps/mac_i18n.js").read_text(encoding="utf-8")
        for key in ("stage_manager", "notification_fallback", "screenshot_capture", "screenshot", "recording_and_pipewire"):
            self.assertIn(f'"{key}":', i18n_txt)

    def test_control_center_brightness_and_volume_buttons_and_dbus_set(self):
        for rel in (
            "extensions/kiwi@kemma/apps/tahoeControlCenter.js",
            "extensions/kiwi@kemma/apps/tahoeQuickSettings.js",
        ):
            src = (ROOT / rel).read_text(encoding="utf-8")
            self.assertNotIn("proxy.set('org.gnome.SettingsDaemon.Power.Screen'", src, f"Invalid Gio.DBusProxy.set in {rel}")
            self.assertIn("org.freedesktop.DBus.Properties.Set", src, f"Missing valid D-Bus Properties.Set in {rel}")
            self.assertIn("disp.iconL.reactive = true;", src, f"Missing disp.iconL handler in {rel}")
            self.assertIn("disp.iconR.reactive = true;", src, f"Missing disp.iconR handler in {rel}")
            self.assertIn("snd.iconL.reactive = true;", src, f"Missing snd.iconL handler in {rel}")
            self.assertIn("snd.iconR.reactive = true;", src, f"Missing snd.iconR handler in {rel}")
            self.assertIn("sink.change_is_muted", src, f"Missing Gvc change_is_muted in {rel}")

    def test_no_hardcoded_vitaliy_or_unsafe_sudoers(self):
        self.assertFalse((ROOT / "etc/sudoers.d/99-mactheme").exists(), "Author sudoers file must be removed")
        boot_sudoers = (ROOT / "etc/sudoers.d/99-mac-boot-config").read_text(encoding="utf-8")
        active_lines = [l.strip() for l in boot_sudoers.splitlines() if l.strip() and not l.strip().startswith("#")]
        self.assertEqual(active_lines, [], "99-mac-boot-config must not grant active world NOPASSWD rules")

        checked_files = [
            "services/org.gnome.Settings.service",
            "bin/mac-apply-locale",
            "bin/mac-boot-config",
            "bin/mac-airdrop",
            "bin/mac-gdm-bypass",
            "bin/mac-diagnostics",
            "bin/mac-theme-sync",
            "bin/mac-integrity-check",
            "systemd/mac-grub-status.service",
            "applications/launchpad.desktop",
            "applications/com.mattjakeman.ExtensionManager.desktop",
        ]
        for rel in checked_files:
            content = (ROOT / rel).read_text(encoding="utf-8")
            self.assertNotIn("/home/vitaliy", content, f"Hardcoded /home/vitaliy found in {rel}")
            self.assertNotIn('"vitaliy"', content, f"Hardcoded vitaliy fallback found in {rel}")


class InstallerAndRollbackTests(unittest.TestCase):
    def test_installer_dry_run_and_opt_in_defaults(self):
        with tempfile.TemporaryDirectory() as folder:
            env = dict(os.environ, HOME=folder, DISPLAY="", WAYLAND_DISPLAY="")
            res = subprocess.run(
                [str(ROOT / "install.sh"), "--dry-run", "--only-components", "gtk,icons"],
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertEqual(res.returncode, 0, res.stderr + res.stdout)
            self.assertIn("GTK / Shell theme : true", res.stdout)
            self.assertIn("Icons & cursors   : true", res.stdout)
            self.assertIn("Shell extensions  : false", res.stdout)
            self.assertIn("GDM theme         : false", res.stdout)
            self.assertIn("Shell overlay     : false", res.stdout)
            self.assertIn("unprivileged user mode", res.stdout)

            # With opt-in system component, privilege requirement switches to sudo/root
            res2 = subprocess.run(
                [str(ROOT / "install.sh"), "--dry-run", "--with-gdm", "--with-grub"],
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertEqual(res2.returncode, 0, res2.stderr + res2.stdout)
            self.assertIn("GDM theme         : true", res2.stdout)
            self.assertIn("GRUB theme        : true", res2.stdout)
            self.assertIn("sudo/root REQUIRED", res2.stdout)

    def test_installer_and_uninstaller_safety_invariants(self):
        installer = (ROOT / "install.sh").read_text(encoding="utf-8")
        # No Cyrillic in install.sh
        self.assertIsNone(re.search(r"[\u0400-\u04FF]", installer), "install.sh must remain ASCII/English-only")
        # No wholesale /etc/environment overwrite
        self.assertNotIn('cat << "EOF_MEM" > /etc/environment', installer)

        uninstaller = (ROOT / "libexec/macw1y-uninstall").read_text(encoding="utf-8")
        self.assertNotIn('rm -rf "$TARGET_HOME/.config/gtk-3.0" "$TARGET_HOME/.config/gtk-4.0"', uninstaller)

    def test_state_manifest_targeted_kv_update_and_rollback_symmetry(self):
        with tempfile.TemporaryDirectory() as folder:
            tmp = pathlib.Path(folder)
            state_dir = tmp / "state"
            env_file = tmp / "environment"
            env_file.write_text(
                '# Custom system environment\nPATH="/custom/bin:/usr/bin"\nFOO=bar\n',
                encoding="utf-8",
            )
            env_file.chmod(0o644)

            # Pre-existing symlink
            link_target = tmp / "orig_target"
            link_target.write_text("target", encoding="utf-8")
            link_path = tmp / "my_link"
            os.symlink(str(link_target), str(link_path))

            # Newly introduced file
            new_file = tmp / "created_by_macw1y.conf"

            # Record & mutate
            STATE_MOD.update_kv_file(state_dir, str(env_file), {"MALLOC_ARENA_MAX": "2", "FOO": "baz"})
            updated = env_file.read_text(encoding="utf-8")
            self.assertIn('PATH="/custom/bin:/usr/bin"', updated)
            self.assertIn("# Custom system environment", updated)
            self.assertIn("FOO=baz", updated)
            self.assertIn("MALLOC_ARENA_MAX=2", updated)

            STATE_MOD.record_file(state_dir, str(link_path), component="gtk")
            os.unlink(link_path)
            os.symlink("/tmp/other", str(link_path))

            STATE_MOD.record_file(state_dir, str(new_file), component="gtk")
            new_file.write_text("new content", encoding="utf-8")

            STATE_MOD.record_package(state_dir, "some-shared-dependency")

            # Mock gsettings binary for recording & rollback
            gs_log = tmp / "gsettings.log"
            fake_gs = tmp / "gsettings"
            fake_gs.write_text(
                f'#!/bin/sh\necho "$*" >> "{gs_log}"\nexit 0\n',
                encoding="utf-8",
            )
            fake_gs.chmod(0o755)
            STATE_MOD.record_gsetting(state_dir, "org.gnome.desktop.interface", "gtk-theme", value="'Kali-Dark'")
            # Second record must NOT overwrite original value
            STATE_MOD.record_gsetting(state_dir, "org.gnome.desktop.interface", "gtk-theme", value="'macW1Y-Dark'")

            # Dry-run rollback identifies newly introduced file without deleting it
            ok_dry, err_dry, new_dry = STATE_MOD.rollback(state_dir, dry_run=True, remove_new=False, gsettings_bin=str(fake_gs))
            self.assertEqual(err_dry, [])
            self.assertIn(str(new_file), new_dry)
            self.assertTrue(new_file.exists())

            # Real rollback with remove_new=True restores file, symlink, gsetting, and removes new file
            ok, errs, new_items = STATE_MOD.rollback(state_dir, dry_run=False, remove_new=True, gsettings_bin=str(fake_gs))
            self.assertEqual(errs, [], f"Unexpected rollback errors: {errs}")
            self.assertEqual(
                env_file.read_text(encoding="utf-8"),
                '# Custom system environment\nPATH="/custom/bin:/usr/bin"\nFOO=bar\n',
            )
            self.assertEqual(stat.S_IMODE(env_file.stat().st_mode), 0o644)
            self.assertEqual(os.readlink(str(link_path)), str(link_target))
            self.assertFalse(new_file.exists())
            self.assertIn("set org.gnome.desktop.interface gtk-theme 'Kali-Dark'", gs_log.read_text(encoding="utf-8"))

            # Recorded packages are preserved in manifest (never blindly uninstalled)
            manifest = STATE_MOD.load_manifest(state_dir)
            self.assertIn("some-shared-dependency", manifest["packages"])


if __name__ == "__main__":
    unittest.main()
