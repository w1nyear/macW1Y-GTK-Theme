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


if __name__ == "__main__":
    unittest.main()
