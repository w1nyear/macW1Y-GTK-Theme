"""Регресійні перевірки без зміни завантажувача та пакетів хоста."""
import importlib.util
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('platform_check', ROOT / 'dependencies/check-platform.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class PortabilityTests(unittest.TestCase):
    def test_missing_extensions_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):
                check.incompatible_extensions(pathlib.Path(folder), "50")

    def test_version_matrix(self):
        for version in ('46', '47', '48', '49', '50', '51'):
            self.assertFalse(check.incompatible_extensions(ROOT, version), f'Version {version} should be compatible')
        for version in ('43', '44'):
            self.assertTrue(check.incompatible_extensions(ROOT, version), f'Version {version} should be incompatible')

    def test_ubuntu_26_10_gnome_51_compatibility(self):
        incompatible = check.incompatible_extensions(ROOT, "51")
        self.assertEqual(incompatible, [], f'GNOME 51 incompatible extensions: {incompatible}')

    def test_native_failure_preserves_existing_outputs(self):
        with tempfile.TemporaryDirectory() as folder:
            temp = pathlib.Path(folder)
            fake = temp / 'pkg-config'
            fake.write_text('#!/bin/sh\nexit 42\n')
            fake.chmod(0o755)
            output = temp / 'output'
            output.mkdir()
            artifact = output / 'libmacpopover.so'
            artifact.write_bytes(b'previous build')
            import os
            env = dict(os.environ, PATH=str(temp) + ':' + os.environ['PATH'])
            result = subprocess.run(['bash', str(ROOT / 'dependencies/build-native.sh'), str(output)], env=env, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(artifact.read_bytes(), b'previous build')

    def test_legacy_shell_restore_without_dpkg(self):
        script = (ROOT / 'libexec/macw1y-uninstall').read_text()
        start = script.index('    if [ -f "/usr/bin/gnome-shell.real" ]; then')
        end = script.index('    sudo rm -f /etc/dconf/db/gdm.d/99-macw1y-auth', start)
        block = script[start:end]
        for current in (None, b'# GNOME Shell Launch Wrapper', b'new packaged executable'):
            with self.subTest(current=current), tempfile.TemporaryDirectory() as folder:
                temp = pathlib.Path(folder)
                (temp / 'gnome-shell.real').write_bytes(b'original executable')
                if current is not None:
                    (temp / 'gnome-shell').write_bytes(current)
                body = block.replace('/usr/bin/', folder + '/')
                prefix = "log_info() { :; }; sudo() { \"$@\"; }; command() { if [ \"$2\" = dpkg-divert ]; then return 1; else builtin command \"$@\"; fi; }; "
                subprocess.run(['bash', '-ec', prefix + body], check=True)
                expected = current if current == b'new packaged executable' else b'original executable'
                self.assertEqual((temp / 'gnome-shell').read_bytes(), expected)

    def test_boot_and_package_commands(self):
        installer = (ROOT / 'install.sh').read_text()
        deps = (ROOT / 'dependencies/install-deps.sh').read_text()
        self.assertNotIn('-o /boot/efi/EFI/fedora/grub.cfg', installer)
        self.assertNotIn('pacman -Sy ', installer + deps)
        self.assertIn('pacman -Syu --needed', deps)
        self.assertNotIn('sudo mv /usr/bin/gnome-shell ', installer)

    def test_no_hardcoded_user_paths_in_extensions(self):
        for js_file in (ROOT / 'extensions').rglob('*.js'):
            if 'node_modules' in js_file.parts:
                continue
            content = js_file.read_text(encoding='utf-8', errors='ignore')
            self.assertNotIn('/home/vitaliy', content, f'Found hardcoded /home/vitaliy in {js_file}')

    def test_installer_does_not_mutate_extensions(self):
        installer = (ROOT / 'install.sh').read_text()
        self.assertNotIn('find "$EXT_USER_DIR" -type f', installer)
        self.assertNotIn('sed -i "s|/home/vitaliy|$TARGET_HOME|g" {} +', installer)


if __name__ == '__main__':
    unittest.main()
