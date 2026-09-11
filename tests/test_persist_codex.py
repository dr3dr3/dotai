"""Exercise migration with isolated state, including an open WAL database."""
import importlib.util
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import sys
sys.dont_write_bytecode = True
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('persist', Path(__file__).resolve().parents[1] / 'scripts/persist-codex.py')
persist = importlib.util.module_from_spec(spec)
spec.loader.exec_module(persist)


class PersistenceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        (self.home / '.ai').mkdir()
        self.source = self.home / '.codex'
        self.target = self.home / '.ai/codex'
        self.enterContext(patch.dict(os.environ, {'HOME': str(self.home), 'CODEX_HOME': str(self.source)}))
        self.enterContext(patch.object(Path, 'is_mount', return_value=True))
        self.enterContext(patch('sys.argv', ['persist-codex.py']))

    def test_fresh_and_repeat(self):
        persist.main()
        (self.target / 'history.jsonl').write_text('preserve\n')
        persist.main()
        self.assertEqual(self.source.resolve(), self.target)
        self.assertEqual((self.source / 'history.jsonl').read_text(), 'preserve\n')

    def test_migrate_preserves_original_and_symlinks(self):
        self.source.mkdir()
        (self.source / 'history.jsonl').write_text('preserve\n')
        (self.source / 'link').symlink_to('history.jsonl')
        with patch.object(persist, "active_writers", return_value=False):
            persist.main()
        self.assertTrue((self.target / 'link').is_symlink())
        self.assertEqual((self.home / '.codex.pre-persistence/history.jsonl').read_text(), 'preserve\n')

    def test_collision_does_not_overwrite(self):
        self.source.mkdir()
        self.target.mkdir()
        with self.assertRaises(SystemExit):
            persist.main()
        self.assertFalse(self.source.is_symlink())

    def test_live_wal_snapshot_and_migration_guard(self):
        self.source.mkdir()
        db = sqlite3.connect(self.source / 'state.sqlite')
        self.addCleanup(db.close)
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('CREATE TABLE example (value TEXT)')
        db.execute("INSERT INTO example VALUES ('committed-in-wal')")
        db.commit()
        with self.assertRaises(SystemExit):
            persist.main()
        with patch('sys.argv', ['persist-codex.py', '--snapshot']):
            persist.main()
        snapshot = next((self.home / '.ai/backups').iterdir())
        with closing(sqlite3.connect(snapshot / 'state.sqlite')) as copied:
            self.assertEqual(copied.execute('SELECT value FROM example').fetchone()[0], 'committed-in-wal')
        self.assertFalse((snapshot / 'state.sqlite-wal').exists())
        self.assertFalse(self.source.is_symlink())


if __name__ == '__main__':
    unittest.main()
