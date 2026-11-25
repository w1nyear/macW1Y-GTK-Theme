import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


class TestCrossDistroAndWizard(unittest.TestCase):
    def test_gschema_override_sets_wallpaper_zoom(self):
        override = (ROOT / "macw1y-gdm" / "99_mactheme.gschema.override").read_text(encoding="utf-8")
        self.assertIn("picture-uri = 'file:///usr/share/backgrounds/GoldenGate_Day.jpg'", override)
        self.assertIn("picture-uri-dark = 'file:///usr/share/backgrounds/GoldenGate_Day.jpg'", override)
        self.assertIn("picture-options = 'zoom'", override)

    def test_install_sh_supports_cross_distro_dbus_and_ensure_extensions(self):
        install_sh = (ROOT / "install.sh").read_text(encoding="utf-8")
        self.assertIn("dbus-run-session", install_sh)
        self.assertIn("picture-options 'zoom'", install_sh)
        self.assertIn("/etc/xdg/autostart/mac-ensure-extensions.desktop", install_sh)
        for pkg_file in ("apt-packages.txt", "dnf-packages.txt", "pacman-packages.txt"):
            txt = (ROOT / "dependencies" / pkg_file).read_text(encoding="utf-8")
            self.assertIn("gettext", txt)
            self.assertIn("zenity", txt)

    def test_ensure_extensions_checks_wallpaper(self):
        ensure_sh = (ROOT / "bin" / "mac-ensure-extensions.sh").read_text(encoding="utf-8")
        self.assertIn("GoldenGate_Day.jpg", ensure_sh)
        self.assertIn("picture-options", ensure_sh)

    def test_no_hardcoded_vitaliy_in_locale_and_blur_scripts(self):
        apply_locale = (ROOT / "bin" / "mac-apply-locale").read_text(encoding="utf-8")
        self.assertNotIn("/home/vitaliy", apply_locale)
        self.assertIn("_macDesktopWidgetsController", apply_locale)
        blur_script = (ROOT / "bin" / "update-bms-menubar-blur").read_text(encoding="utf-8")
        self.assertNotIn("/home/vitaliy", blur_script)

    def test_desktop_widgets_dynamic_locale_and_wizard_hooks(self):
        ext_js = (ROOT / "extensions" / "desktop-widgets@r3nhick" / "extension.js").read_text(encoding="utf-8")
        self.assertIn("_macDesktopWidgetsController", ext_js)
        self.assertIn("updateLocale(", ext_js)
        self.assertIn("hideForWizard(", ext_js)
        self.assertIn("showFromWizardAnimated(", ext_js)
        cal_js = (ROOT / "extensions" / "desktop-widgets@r3nhick" / "widgets" / "calendar" / "widget.js").read_text(encoding="utf-8")
        self.assertIn("getModpackIntlLocale", cal_js)
        weather_js = (ROOT / "extensions" / "desktop-widgets@r3nhick" / "widgets" / "weather" / "widget.js").read_text(encoding="utf-8")
        self.assertIn("getModpackIntlLocale", weather_js)

    def test_setup_wizard_language_pill_and_sync_restore(self):
        wizard_js = (ROOT / "extensions" / "eval-helper@mactheme" / "macSetupWizard.js").read_text(encoding="utf-8")
        self.assertIn("_showLanguageChangePill", wizard_js)
        self.assertIn("applyModpackSystemLocaleAsync", wizard_js)
        self.assertIn("Зміна мови", wizard_js)
        self.assertIn("_restoreDesktop(true)", wizard_js)

    def test_gnome51_offscreen_glass_and_unlock_hooks(self):
        glass_js = (ROOT / "extensions" / "desktop-widgets@r3nhick" / "lib" / "glass.js").read_text(encoding="utf-8")
        self.assertIn("USE_OFFSCREEN_SHADER_COMPAT", glass_js)
        self.assertIn("defineOffscreenShaderEffectCompat", glass_js)
        self.assertIn("Clutter.PipelineNode.new", glass_js)
        menubar_js = (ROOT / "extensions" / "blur-my-shell@aunetx" / "components" / "menubar_v29.js").read_text(encoding="utf-8")
        self.assertIn("_hoverGlideDisposed", menubar_js)
        self.assertIn("_menuManagerAddWrapper", menubar_js)
        eval_js = (ROOT / "extensions" / "eval-helper@mactheme" / "extension.js").read_text(encoding="utf-8")
        self.assertIn("_macGlideDisposed", eval_js)
        self.assertIn("_macGlideAddWrapper", eval_js)

    def test_debian_fedora_gdm_and_dnf_optimization(self):
        install_sh = (ROOT / "install.sh").read_text(encoding="utf-8")
        self.assertIn("update-alternatives --query gdm-theme.gresource", install_sh)
        self.assertIn("/usr/share/gdm/greeter-dconf-defaults", install_sh)
        deps_sh = (ROOT / "dependencies" / "install-deps.sh").read_text(encoding="utf-8")
        self.assertIn("install_weak_deps=False", deps_sh)
        self.assertIn("rpm -q", deps_sh)

    def test_extension_update_guard_prevents_ego_overwrites(self):
        eval_js = (ROOT / "extensions" / "eval-helper@mactheme" / "extension.js").read_text(encoding="utf-8")
        self.assertIn("_setupExtensionUpdateGuard", eval_js)
        self.assertIn("updatesSupported", eval_js)
        ensure_sh = (ROOT / "bin" / "mac-ensure-extensions.sh").read_text(encoding="utf-8")
        self.assertIn("extension-updates/$ext", ensure_sh)

    def test_boot_gdm_and_synchronized_desktop_startup(self):
        pro_js = (ROOT / "extensions" / "wack-lockscreen-clock@rinzler69-wastaken.github.com" / "src" / "pro" / "pro.js").read_text(encoding="utf-8")
        self.assertIn("_ensureBootCover", pro_js)
        self.assertIn("_scheduleBootReveal", pro_js)
        self.assertIn("waitingForSingleAutoSelect", pro_js)
        self.assertIn("macw1y-boot/logo.png", pro_js)
        self.assertIn("macBootLogoOverlay", pro_js)
        layout_js = (ROOT / "gnome-shell-overlay" / "ui" / "layout.js").read_text(encoding="utf-8")
        self.assertIn("_macStartupManaged", layout_js)
        self.assertIn("_macDockRevealActive", layout_js)
        self.assertIn("checkDing", layout_js)
        self.assertIn("macw1y-boot/logo.png", layout_js)
        self.assertIn("macBootLogoOverlay", layout_js)
        self.assertIn("dc._dock || dc", layout_js)
        self.assertIn("STARTUP_TIMEOUT_MS = 12000", layout_js)
        eval_js = (ROOT / "extensions" / "eval-helper@mactheme" / "extension.js").read_text(encoding="utf-8")
        self.assertIn("_macStartupManaged", eval_js)
        self.assertIn("_macDockRevealActive", eval_js)
        self.assertIn("_macTrashReady", eval_js)
        self.assertIn("suppressStartupOverview", eval_js)
        self.assertIn("runMacStartupSession", eval_js)
        self.assertIn("dc._dock || dc", eval_js)
        self.assertIn("STARTUP_TIMEOUT_MS = 12000", eval_js)
        install_sh = (ROOT / "install.sh").read_text(encoding="utf-8")
        self.assertIn("start-in-overview false", install_sh)
        self.assertIn("/usr/share/gnome-shell/extensions/ding@rastersoft.com", install_sh)
        kiwi_js = (ROOT / "extensions" / "kiwi@kemma" / "extension.js").read_text(encoding="utf-8")
        self.assertIn("_macKiwiReady", kiwi_js)
        ding_js = (ROOT / "extensions" / "ding@rastersoft.com" / "extension.js").read_text(encoding="utf-8")
        self.assertNotIn("Main.layoutManager.connect('startup-complete'", ding_js)
        ding_schema = (ROOT / "extensions" / "ding@rastersoft.com" / "schemas" / "org.gnome.shell.extensions.ding.gschema.xml").read_text(encoding="utf-8")
        self.assertNotIn('<key type="b" name="show-trash">\n        <default>true</default>', ding_schema)
        self.assertNotIn('<key type="b" name="show-volumes">\n        <default>true</default>', ding_schema)
        dconf_txt = (ROOT / "dconf" / "gnome-all.dconf").read_text(encoding="utf-8")
        self.assertIn("show-trash=false", dconf_txt)
        self.assertIn("show-volumes=false", dconf_txt)


if __name__ == "__main__":
    unittest.main()
