import os
from pathlib import Path
import subprocess
import tempfile
import unittest
ROOT = Path(__file__).resolve().parents[1]

class DependencyFailures(unittest.TestCase):
    def test_required_package_failure_is_fatal(self):
        for distro, manager in [('fedora', 'dnf'), ('arch', 'pacman'), ('debian', 'apt')]:
            with self.subTest(distro=distro), tempfile.TemporaryDirectory() as folder:
                tmp = Path(folder)
                (tmp / 'os-release').write_text('ID=' + distro + '\n')
                (tmp / (manager + '-packages.txt')).write_text('required-package\n')
                (tmp / 'sudo').write_text('#!/bin/sh\necho "$*" >> "'+folder+'/calls"\nexit 42\n')
                (tmp / 'sudo').chmod(0o755)
                script = (ROOT / 'dependencies/install-deps.sh').read_text().replace('. /etc/os-release', '. '+str(tmp/'os-release'))
                (tmp/'install.sh').write_text(script)
                result = subprocess.run(['bash', str(tmp/'install.sh')],env=dict(os.environ, PATH=folder+':'+os.environ['PATH']),capture_output=True,text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('Обов’язкові залежності встановлено',result.stdout)
                self.assertEqual(len((tmp/'calls').read_text().splitlines()),1)

if __name__ == '__main__': unittest.main()
