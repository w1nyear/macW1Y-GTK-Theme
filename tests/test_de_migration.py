#!/usr/bin/env python3
"""
Unit tests for Desktop Environment (DE) Detection & Migration and Linux Mint Support.
"""
import os
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class DesktopEnvironmentMigrationTests(unittest.TestCase):
    def test_de_detection_in_install_sh(self):
        """Test detect_current_desktop_environment bash function with various DE values."""
        cases = [
            ("ubuntu:GNOME", "gnome", "gnome"),
            ("GNOME", "gnome", "gnome"),
            ("X-Cinnamon", "cinnamon", "cinnamon"),
            ("Cinnamon", "cinnamon", "cinnamon"),
            ("MATE", "mate", "mate"),
            ("XFCE", "xfce", "xfce"),
            ("KDE", "plasma", "kde"),
            ("LXQt", "lxqt", "lxqt"),
        ]
        install_sh = ROOT / "install.sh"
        self.assertTrue(install_sh.is_file())

        for desktop, session, expected in cases:
            script = f"""
eval "$(sed -n '/^detect_current_desktop_environment()/,/^}}/p' "{install_sh}")"
XDG_CURRENT_DESKTOP="{desktop}"
DESKTOP_SESSION="{session}"
detect_current_desktop_environment
"""
            res = subprocess.run(
                ["bash", "-c", script],
                capture_output=True,
                text=True,
                cwd=str(ROOT)
            )
            self.assertEqual(
                res.stdout.strip(),
                expected,
                f"Failed for XDG_CURRENT_DESKTOP={desktop}, DESKTOP_SESSION={session}"
            )

    def test_linuxmint_distro_detection(self):
        """Ensure install.sh recognizes linuxmint in debian family."""
        install_sh = ROOT / "install.sh"
        script = f"""
eval "$(sed -n '/^detect_distro_and_paths()/,/^}}/p' "{install_sh}")"
ID="linuxmint"
ID_LIKE="ubuntu debian"
NAME="Linux Mint"
PRETTY_NAME="Linux Mint 22"
detect_distro_and_paths
echo "$DISTRO_FAMILY"
"""
        res = subprocess.run(
            ["bash", "-c", script],
            capture_output=True,
            text=True,
            cwd=str(ROOT)
        )
        self.assertEqual(res.stdout.strip(), "debian")

    def test_linuxmint_in_install_deps(self):
        """Ensure dependencies/install-deps.sh matches linuxmint."""
        install_deps = (ROOT / "dependencies/install-deps.sh").read_text()
        self.assertIn("linuxmint", install_deps)

    def test_gnome_core_packages_in_apt_list(self):
        """Ensure gnome-shell, gnome-session, and gdm3 are listed in apt-packages.txt."""
        apt_pkgs = (ROOT / "dependencies/apt-packages.txt").read_text().splitlines()
        clean_pkgs = [p.strip() for p in apt_pkgs if p.strip() and not p.strip().startswith("#")]
        self.assertIn("gnome-shell", clean_pkgs)
        self.assertIn("gnome-session", clean_pkgs)
        self.assertIn("gdm3", clean_pkgs)

    def test_check_platform_supports_mint(self):
        """Ensure dependencies/check-platform.py recognizes linuxmint as supported."""
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "check_platform",
            ROOT / "dependencies/check-platform.py"
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertTrue(hasattr(mod, "is_supported_distribution"))

    def test_ensure_gnome_de_mock_mode(self):
        """Ensure ensure_gnome_desktop_environment returns 0 and logs properly in mock mode."""
        install_sh = ROOT / "install.sh"
        script = f"""
log_info() {{ echo "$@"; }}
log_step() {{ echo "$@"; }}
eval "$(sed -n '/^detect_current_desktop_environment()/,/^}}/p' "{install_sh}")"
eval "$(sed -n '/^ensure_gnome_desktop_environment()/,/^}}/p' "{install_sh}")"
MOCK_MODE="true"
XDG_CURRENT_DESKTOP="X-Cinnamon"
ensure_gnome_desktop_environment
"""
        res = subprocess.run(
            ["bash", "-c", script],
            capture_output=True,
            text=True,
            cwd=str(ROOT)
        )
        self.assertEqual(res.returncode, 0)
        self.assertIn("Simulating GNOME installation", res.stdout)


if __name__ == "__main__":
    unittest.main()
