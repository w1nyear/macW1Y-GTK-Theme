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

    def test_hash_is_independent_of_creation_order_and_root(self):
        scope = runpy.run_path(str(ROOT / 'bin/mac-extension-guard'))
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name, order in [('first', ['a', 'z']), ('second', ['z', 'a'])]:
                for part in order:
                    path = root / name / part / 'same.js'
                    path.parent.mkdir(parents=True)
                    path.write_text(part)
            self.assertEqual(scope['dir_hash'](root / 'first'), scope['dir_hash'](root / 'second'))
            (root / 'second' / 'a').rename(root / 'second' / 'renamed')
            self.assertNotEqual(scope['dir_hash'](root / 'first'), scope['dir_hash'](root / 'second'))

    def test_unreadable_file_fails_and_links_are_hashed(self):
        from unittest.mock import patch
        scope = runpy.run_path(str(ROOT / 'bin/mac-extension-guard'))
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / 'extension.js'
            path.write_text('code')
            original = scope['dir_hash'](root)
            (root / 'link').symlink_to('extension.js')
            self.assertNotEqual(original, scope['dir_hash'](root))
            with patch('builtins.open', side_effect=PermissionError('denied')):
                with self.assertRaises(PermissionError):
                    scope['dir_hash'](root)

    def test_versioned_lock_and_missing_entrypoint(self):
        import json
        scope = runpy.run_path(str(ROOT / 'bin/mac-extension-guard'))
        verify = scope['cmd_verify']
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            ext = root / 'user' / 'demo@example'
            ext.mkdir(parents=True)
            (ext / 'metadata.json').write_text('{}')
            lock = root / 'lock.json'
            data = {'_meta': {'hash_algorithm': scope['HASH_ALGORITHM']},
                    'extensions': {'demo@example': {'sha256': scope['dir_hash'](ext)}}}
            lock.write_text(json.dumps(data))
            verify.__globals__.update(LOCK_FILE=str(lock), USER_EXT_DIR=str(root / 'user'),
                                      SYS_EXT_DIR=str(root / 'system'), USER_UPDATES_DIR=str(root / 'updates'))
            self.assertFalse(verify())
            (ext / 'extension.js').write_text('code')
            data['extensions']['demo@example']['sha256'] = scope['dir_hash'](ext)
            lock.write_text(json.dumps(data))
            self.assertTrue(verify())
            (ext / 'extension.js').write_text('changed')
            self.assertFalse(verify())

    def test_target_generated_schema_cache_does_not_change_source_hash(self):
        scope = runpy.run_path(str(ROOT / 'bin/mac-extension-guard'))
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            schemas = root / 'schemas'
            schemas.mkdir()
            xml = schemas / 'sample.gschema.xml'
            xml.write_text('schema source')
            digest = scope['dir_hash'](root)
            (schemas / 'gschemas.compiled').write_bytes(b'target GLib cache')
            self.assertEqual(digest, scope['dir_hash'](root))
            xml.write_text('changed schema')
            self.assertNotEqual(digest, scope['dir_hash'](root))
