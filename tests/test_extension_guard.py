from pathlib import Path
import runpy
import tempfile
import unittest
ROOT = Path(__file__).resolve().parents[1]
class GuardTests(unittest.TestCase):
    def test_missing_empty_and_invalid_lock_fail(self):
        scope=runpy.run_path(str(ROOT/'bin/mac-extension-guard'))
        function=scope['cmd_verify']
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'lock.json'
            function.__globals__['LOCK_FILE']=str(path)
            self.assertFalse(function())
            for content in ('{}','[]','null','{"extensions":{}}','broken','{"extensions":{"test":{}}}'):
                path.write_text(content)
                self.assertFalse(function())
