"""Regression tests adapted for macW1Y v0.8: GNOME 46-51 startup safety, localization fallbacks, Control Center sliders, and safe modular state/rollback."""
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
        for lineno, line in enumerate(src.splitlines(), 1):
            if line.strip() == "bypass_overlay":
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

            ok, mb = PLAT_MOD.check_disk_space(str(tmp), min_mb=1)
            self.assertTrue(ok)
            self.assertGreaterEqual(mb, 1)


class LocalizationAndPathSafetyTests(unittest.TestCase):
    def test_english_localization_resources_and_fallbacks(self):
        dconf_txt = (ROOT / "dconf/gnome-all.dconf").read_text(encoding="utf-8")
        self.assertNotIn("Робочий стіл", dconf_txt)
        self.assertNotIn("/home/vitaliy", dconf_txt)

        ws_txt = (ROOT / "extensions/appmenu@ChathurangaBW.github.io/workspaceIndicator.js").read_text(encoding="utf-8")
        self.assertIn("t('desktop'", ws_txt)

        for rel in (
            "extensions/macw1y-touchpad-gestures@mactheme/gestureImpl.js",
            "touchpad/macw1y-touchpad-gestures@mactheme/gestureImpl.js",
        ):
            g_txt = (ROOT / rel).read_text(encoding="utf-8")
            self.assertNotIn("_showOsd('Скопійовано'", g_txt)
            self.assertNotIn("_showOsd('Вставлено'", g_txt)
            self.assertIn("t('copied'", g_txt)

        i18n_txt = (ROOT / "extensions/kiwi@kemma/apps/mac_i18n.js").read_text(encoding="utf-8")
        for key in (
            "stage_manager",
            "notifications",
            "screen_capture",
            "screenshot",
            "copied",
            "pasted",
            "brightness_unavailable_title",
            "brightness_unavailable_body",
        ):
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
        for line in active_lines:
            self.assertFalse(line.startswith("ALL "), f"World NOPASSWD rule forbidden: {line}")
            self.assertRegex(line, r"^%(sudo|wheel)\s+ALL=\(ALL\)\s+NOPASSWD:\s+/usr/local/bin/mac-boot-config$")

        checked_files = [
            "services/org.gnome.Settings.service",
            "bin/mac-apply-locale",
            "bin/mac-boot-config",
            "bin/mac-airdrop",
            "bin/mac-gdm-bypass",
            "bin/mac-diagnostics",
            "bin/mac-theme-sync",
            "bin/mac-integrity-check",
            "bin/mac-installer-gui",
            "bin/mac-screenshot-process",
            "bin/mac-sync-applications",
            "systemd/mac-grub-status.service",
            "applications/launchpad.desktop",
            "applications/com.mattjakeman.ExtensionManager.desktop",
        ]
        for rel in checked_files:
            content = (ROOT / rel).read_text(encoding="utf-8")
            self.assertNotIn("/home/vitaliy", content, f"Hardcoded /home/vitaliy found in {rel}")
            self.assertNotIn('"vitaliy"', content, f"Hardcoded vitaliy fallback found in {rel}")


class InstallerAndRollbackTests(unittest.TestCase):
    def test_installer_dry_run_modular_and_full_defaults(self):
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

            res2 = subprocess.run(
                [str(ROOT / "install.sh"), "--dry-run", "--install"],
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
        self.assertIsNone(re.search(r"[\u0400-\u04FF]", installer), "install.sh must remain ASCII/English-only")
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

            link_target = tmp / "orig_target"
            link_target.write_text("target", encoding="utf-8")
            link_path = tmp / "my_link"
            os.symlink(str(link_target), str(link_path))

            new_file = tmp / "created_by_macw1y.conf"

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

            gs_log = tmp / "gsettings.log"
            fake_gs = tmp / "gsettings"
            fake_gs.write_text(
                f'#!/bin/sh\necho "$*" >> "{gs_log}"\nexit 0\n',
                encoding="utf-8",
            )
            fake_gs.chmod(0o755)
            STATE_MOD.record_gsetting(state_dir, "org.gnome.desktop.interface", "gtk-theme", value="'Kali-Dark'")
            STATE_MOD.record_gsetting(state_dir, "org.gnome.desktop.interface", "gtk-theme", value="'macW1Y-Dark'")

            ok_dry, err_dry, new_dry = STATE_MOD.rollback(state_dir, dry_run=True, remove_new=False, gsettings_bin=str(fake_gs))
            self.assertEqual(err_dry, [])
            self.assertIn(str(new_file), new_dry)
            self.assertTrue(new_file.exists())

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

            manifest = STATE_MOD.load_manifest(state_dir)
            self.assertIn("some-shared-dependency", manifest["packages"])


if __name__ == "__main__":
    unittest.main()
