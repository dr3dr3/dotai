import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

p=Path(__file__).resolve().parents[1]/'scripts/firstmate-captain-home.py'
spec=importlib.util.spec_from_file_location('captain_home',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class CaptainHome(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.home=self.root/'home'
        for part in ('config','data','state'): (self.home/part).mkdir(parents=True)
        self.registry=self.root/'registry.json'
        self.registry.write_text(json.dumps({'version':1,'homes':[str(self.home)]}))
    def resolve(self,value): return m.resolve_home(value,self.registry,self.home)
    def test_restore_without_home(self): self.assertEqual(self.resolve(None),str(self.home))
    def test_explicit_correct_home(self): self.assertEqual(self.resolve(str(self.home)),str(self.home))
    def test_other_home_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'differs'): self.resolve(str(self.root))
    def test_missing_registry_is_rejected(self):
        self.registry.unlink()
        with self.assertRaises(OSError): self.resolve(None)
    def test_unregistered_home_is_rejected(self):
        self.registry.write_text('{"version":1,"homes":[]}')
        with self.assertRaisesRegex(ValueError,'not registered'): self.resolve(None)
    def test_missing_state_is_not_created(self):
        (self.home/'state').rmdir()
        with self.assertRaisesRegex(ValueError,'not initialised'): self.resolve(None)
        self.assertFalse((self.home/'state').exists())

if __name__=='__main__': unittest.main()
