from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / 'extensions/ding@rastersoft.com'

class DingBundleTests(unittest.TestCase):
    def test_existing_patches_are_included_exactly(self):
        for patch in (ROOT / 'extensions/ding-patches').iterdir():
            if patch.is_file():
                self.assertEqual(patch.read_bytes(), (BUNDLE / 'app' / patch.name).read_bytes(), patch.name)

    def test_schema_compiles_without_system_ding(self):
        with tempfile.TemporaryDirectory() as folder:
            subprocess.run(['glib-compile-schemas', '--strict', '--targetdir', folder,
                            str(BUNDLE / 'schemas')], check=True)
            self.assertTrue((Path(folder) / 'gschemas.compiled').is_file())

    def test_package_owned_ding_is_not_overwritten(self):
        installer = (ROOT / 'install.sh').read_text()
        self.assertNotIn('sudo cp "$SCRIPT_DIR/extensions/ding-patches/', installer)
        self.assertIn('"ding@rastersoft.com"', (ROOT / 'uninstall.sh').read_text())
        for file in ('COPYING', 'COPYRIGHT.packaging', 'ORIGIN.txt', 'extension.js', 'app/ding.js'):
            self.assertTrue((BUNDLE / file).is_file(), file)
