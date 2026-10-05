import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('fixture',Path(__file__).with_name('client.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class FixtureTests(unittest.TestCase):
    def test_model_tool_and_auth_calls_rejected_before_process_access(self):
        client=m.Client.__new__(m.Client)
        for method in ('turn/start','command/exec','thread/shellCommand','account/login/start','thread/inject_items'):
            with self.assertRaisesRegex(ValueError,'forbids method'):
                client.call(method,{})

    def scenario(self, persisted=True, wrong_identity=False):
        events=[]
        class Fake:
            def __init__(self,label): self.label=label
            def initialize(self): events.append(('init',self.label))
            def stop(self): events.append(('stop',self.label))
            def call(self,method,params):
                events.append((method,params))
                if method=='thread/name/set': return {}
                return {'thread':{'id':'wrong' if wrong_identity and method=='thread/resume' else 'fixture-id', 'name':'roe-offline-persistence-fixture'}}
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);state=root/'state';state.mkdir();out=root/'out';out.mkdir()
            if persisted:
                (state/'sessions').mkdir();(state/'sessions/fixture.jsonl').write_text('{}\n')
            with patch.object(m,'STATE',state),patch.object(m,'OUT',out),patch.object(m,'Client',Fake),patch.object(m,'denied_reads'),contextlib.redirect_stdout(io.StringIO()):
                m.main()
        return events

    def test_exact_binding_is_used_after_first_process_stops(self):
        events=self.scenario()
        self.assertLess(events.index(('stop','first')),events.index(('init','second')))
        for method,params in events:
            if method in ('thread/read','thread/resume'): self.assertEqual(params['threadId'],'fixture-id')
        self.assertEqual(events[-1],('stop','second'))

    def test_missing_rollout_still_requires_protocol_identity(self):
        events=self.scenario(persisted=False)
        self.assertIn(('thread/read',{'threadId':'fixture-id','includeTurns':False}),events)
        self.assertIn(('thread/resume',{'threadId':'fixture-id','excludeTurns':True}),events)

    def test_wrong_resume_identity_is_failure(self):
        with self.assertRaisesRegex(RuntimeError,'identity/name mismatch'): self.scenario(wrong_identity=True)

if __name__=='__main__': unittest.main()
