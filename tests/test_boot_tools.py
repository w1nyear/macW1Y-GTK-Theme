import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class BootToolsTests(unittest.TestCase):
    def run_case(self, tools, config):
        with tempfile.TemporaryDirectory() as folder:
            temp = pathlib.Path(folder)
            if config == 'apt':
                (temp / 'initramfs-tools').mkdir()
            if config == 'mkinitcpio':
                (temp / 'mkinitcpio.d').mkdir()
                (temp / 'mkinitcpio.d/linux.preset').touch()
            source = (ROOT / 'dependencies/boot-tools.sh').read_text().replace('/etc/', folder + '/')
            cases = '|'.join(tools) or 'nonexistent'
            stub = 'command() { case "$2" in ' + cases + ') return 0;; *) return 1;; esac; }; sudo() { printf "%s\\n" "$*"; };\n'
            return subprocess.run(['bash', '-c', stub + source + '\nmacw1y_rebuild_initramfs'], capture_output=True, text=True)

    def test_debian(self):
        result = self.run_case(['update-initramfs', 'dracut'], 'apt')
        self.assertEqual(result.stdout.strip(), 'update-initramfs -u')
        self.assertEqual(result.returncode, 0)

    def test_arch_presets_win_over_unused_dracut(self):
        result = self.run_case(['mkinitcpio', 'dracut'], 'mkinitcpio')
        self.assertEqual(result.stdout.strip(), 'mkinitcpio -P')

    def test_fedora_or_dracut_cachyos(self):
        result = self.run_case(['dracut', 'mkinitcpio'], None)
        self.assertEqual(result.stdout.strip(), 'dracut --regenerate-all --force')

    def test_grub_is_never_selected_with_systemd_boot(self):
        source = (ROOT / 'dependencies/boot-tools.sh').read_text()
        for installed in (0, 1):
            stub = 'command() { return 0; }; bootctl() { return '+str(installed)+'; };\n'
            result = subprocess.run(['bash', '-c', stub + source + '\nmacw1y_has_grub'], capture_output=True)
            self.assertEqual(result.returncode, 1 if installed == 0 else 0)

    def test_unknown_fails(self):
        self.assertNotEqual(self.run_case([], None).returncode, 0)


if __name__ == '__main__':
    unittest.main()
