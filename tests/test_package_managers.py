#!/usr/bin/env python3
"""
Integration test suite for mac-sync-applications and mac-uninstall-app
Testing .deb, .rpm, and .pkg.tar.zst package installation and uninstallation logic across distributions.
"""

import os
import sys
import shutil
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import subprocess

# Ensure repo root is in python path
d = os.path.dirname(os.path.abspath(__file__))
if os.path.basename(d) == "tests":
    REPO_ROOT = os.path.dirname(d)
else:
    REPO_ROOT = os.path.dirname(os.path.dirname(d))
sys.path.insert(0, os.path.join(REPO_ROOT, "bin"))

# Import functions from mac-sync-applications
from importlib.machinery import SourceFileLoader
sync_mod = SourceFileLoader("mac_sync_applications", os.path.join(REPO_ROOT, "bin", "mac-sync-applications")).load_module()
uninst_mod = SourceFileLoader("mac_uninstall_app", os.path.join(REPO_ROOT, "bin", "mac-uninstall-app")).load_module()


class TestPackageIntegration(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="macw1y_pkg_test_")

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_deb_rejected_on_non_debian(self):
        deb_file = os.path.join(self.test_dir, "test-app.deb")
        with open(deb_file, "w") as f:
            f.write("dummy deb content")

        with patch("shutil.which", return_value=None):  # simulate no apt-get
            with patch("subprocess.run") as mock_run:
                sync_mod.install_deb(deb_file)
                # Verify apt-get was not called with pkexec
                for call in mock_run.call_args_list:
                    args = call[0][0]
                    self.assertNotIn("apt-get", args)
                # File must NOT be deleted
                self.assertTrue(os.path.exists(deb_file))

    def test_rpm_rejected_on_non_rpm(self):
        rpm_file = os.path.join(self.test_dir, "test-app.rpm")
        with open(rpm_file, "w") as f:
            f.write("dummy rpm content")

        with patch("shutil.which", return_value=None):  # simulate no dnf
            with patch("subprocess.run") as mock_run:
                sync_mod.install_rpm(rpm_file)
                for call in mock_run.call_args_list:
                    args = call[0][0]
                    self.assertNotIn("dnf", args)
                self.assertTrue(os.path.exists(rpm_file))

    def test_arch_pkg_rejected_on_non_arch(self):
        arch_file = os.path.join(self.test_dir, "test-app.pkg.tar.zst")
        with open(arch_file, "w") as f:
            f.write("dummy pkg content")

        with patch("shutil.which", return_value=None):  # simulate no pacman
            with patch("subprocess.run") as mock_run:
                sync_mod.install_arch_pkg(arch_file)
                for call in mock_run.call_args_list:
                    args = call[0][0]
                    self.assertNotIn("pacman", args)
                self.assertTrue(os.path.exists(arch_file))

    def test_manager_failure_does_not_delete_pkg_or_notify_success(self):
        # When pacman/dnf/apt fails (returncode != 0)
        arch_file = os.path.join(self.test_dir, "corrupt.pkg.tar.zst")
        with open(arch_file, "w") as f:
            f.write("corrupted archive")

        mock_proc = MagicMock()
        mock_proc.returncode = 1  # manager failed

        with patch("shutil.which", return_value="/usr/bin/pacman"):
            with patch("subprocess.run", return_value=mock_proc) as mock_run:
                sync_mod.install_arch_pkg(arch_file)
                # File must NOT be deleted
                self.assertTrue(os.path.exists(arch_file))
                # Check notify-send calls: none should report "Installed"
                for call in mock_run.call_args_list:
                    args = call[0][0]
                    if args[0] == "notify-send":
                        self.assertNotIn("Installed", args)

    def test_path_with_spaces_handled_properly(self):
        spaced_dir = os.path.join(self.test_dir, "my downloaded packages")
        os.makedirs(spaced_dir, exist_ok=True)
        spaced_file = os.path.join(spaced_dir, "my application v1.0.pkg.tar.zst")
        with open(spaced_file, "w") as f:
            f.write("content")

        mock_proc = MagicMock()
        mock_proc.returncode = 0

        with patch("shutil.which", return_value="/usr/bin/pacman"):
            with patch("subprocess.run", return_value=mock_proc) as mock_run:
                with patch.object(sync_mod, "sync"):
                    sync_mod.install_arch_pkg(spaced_file)
                    # Verify command was called with the exact spaced filename as a single element
                    cmd_call = [call[0][0] for call in mock_run.call_args_list if call[0][0][0] == "pkexec"][0]
                    self.assertEqual(cmd_call, ["pkexec", "pacman", "-U", "--noconfirm", spaced_file])

    def test_uninstall_auth_cancel_preserves_shortcut(self):
        # If pkexec is cancelled (code 126 or 1), the shortcut must NOT be removed
        fake_app = os.path.join(self.test_dir, "testapp.desktop")
        fake_target = "/usr/share/applications/testapp.desktop"
        with open(fake_app, "w") as f:
            f.write("[Desktop Entry]\nName=Test\nExec=test\n")

        # Mock pacman detecting it as a package
        mock_pacman = MagicMock()
        mock_pacman.returncode = 0
        mock_pacman.stdout = "testapp-pkg\n"

        # Mock pkexec pacman -R cancelling (returncode 126)
        mock_uninstall = MagicMock()
        mock_uninstall.returncode = 126

        def mock_subprocess_run(cmd, *args, **kwargs):
            if cmd[:2] == ["pacman", "-Qoq"]:
                return mock_pacman
            elif cmd[:2] == ["pkexec", "pacman"]:
                return mock_uninstall
            return MagicMock(returncode=0)

        with patch("os.path.realpath", return_value=fake_target):
            with patch("shutil.which", side_effect=lambda x: "/usr/bin/pacman" if x == "pacman" else None):
                with patch("subprocess.run", side_effect=mock_subprocess_run):
                    with patch("os.path.islink", return_value=True):
                        with patch("os.path.exists", return_value=True):
                            with patch("os.remove") as mock_remove:
                                with patch("sys.argv", ["mac-uninstall-app", fake_app]):
                                    uninst_mod.main()
                                    # mock_remove must NOT have been called on fake_app
                                    mock_remove.assert_not_called()


if __name__ == "__main__":
    unittest.main()
