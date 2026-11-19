"""Перевірка обгорток на ізольованих виконуваних файлах."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class WrapperTests(unittest.TestCase):
    def execute(self, app, system, backup=None, args=()):
        with tempfile.TemporaryDirectory() as folder:
            temp = Path(folder)
            wrapper = temp / 'wrapper'
            source = (ROOT / 'bin' / app).read_text()
            source = source.replace('/usr/bin/' + app, str(temp / app))
            source = source.replace('for d in /usr/local/lib', 'for d in /nonexistent')
            # Бібліотеки хоста не потрібні для перевірки вибору виконуваного файла.
            start = source.index('find_mac_lib() {')
            end = source.index('\n}\n', start) + 3
            source = source[:start] + 'find_mac_lib() { return 1; }\n' + source[end:]
            wrapper.write_text(source)
            wrapper.chmod(0o755)
            for name, content in ((app, system), (app + '.orig', backup)):
                if content is not None:
                    path = temp / name
                    path.write_text(content)
                    path.chmod(0o755)
            return subprocess.run([str(wrapper), *args], env=dict(os.environ, LD_PRELOAD=''), capture_output=True, text=True, timeout=3)

    def test_new_package_wins_over_old_backup(self):
        for app in ('nautilus', 'gnome-control-center', 'ptyxis'):
            result = self.execute(app, '#!/bin/sh\nprintf "new:%s\\n" "$*"\n', '#!/bin/sh\necho old\n', ('--help',))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), 'new:--help')

    def test_legacy_wrapper_uses_original(self):
        result = self.execute('nautilus', '#!/bin/sh\n# find_mac_lib()\nexit 88\n', '#!/bin/sh\necho original\n')
        self.assertEqual(result.stdout.strip(), 'original')

    def test_missing_binary_fails_without_recursion(self):
        for app in ('nautilus', 'gnome-control-center', 'ptyxis'):
            result = self.execute(app, None)
            self.assertEqual(result.returncode, 127)


if __name__ == '__main__':
    unittest.main()
