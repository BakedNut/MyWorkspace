from pathlib import Path
import os
import subprocess
import sys
import unittest


class PreviewTerminationTest(unittest.TestCase):
    def test_sigterm_after_each_link_switch_restores_both_releases(self):
        program = r'''
import os, signal, sys
from unittest.mock import patch
import preview
from test_preview import PreviewDeploymentTest
case = PreviewDeploymentTest()
case.setUp()
original = preview.deploy
validation_failure = sys.argv[1] == "validation"
target = preview.JAR if sys.argv[1] in ("jar", "validation") else preview.FRONTEND
if validation_failure:
    case.mock("verify_frontend", side_effect=RuntimeError("bad frontend"))
terminated = False

def run(ct, args, data=None):
    global terminated
    result = case.server_run(ct, args, data)
    if args[:2] == ["mv", "-Tf"] and args[-1] == target:
        if validation_failure and not args[-2].endswith("-restore"):
            return result
        if not terminated:
            terminated = True
            os.kill(os.getpid(), signal.SIGTERM)
        else:
            # A second stop request must not interrupt rollback.
            os.kill(os.getpid(), signal.SIGTERM)
    return result

case.run.side_effect = run
try:
    with patch.object(preview, "deploy", side_effect=lambda: original(case.root)):
        try:
            if hasattr(preview, "main"):
                preview.main()
            else:
                preview.deploy()
        except SystemExit as stopped:
            assert not validation_failure
            assert stopped.code == 128 + signal.SIGTERM
        except RuntimeError as failed:
            assert validation_failure and str(failed) == "bad frontend"
        else:
            raise AssertionError("termination was not propagated")
    case.assert_restored()
    commands = [call.args[1] for call in case.run.call_args_list]
    restored_frontend = next(i for i, args in enumerate(commands)
                             if args[:2] == ["mv", "-Tf"] and args[-1] == preview.FRONTEND
                             and args[-2].endswith("-restore"))
    assert ["systemctl", "restart", "myworkspace-preview"] in commands[restored_frontend + 1:]
    assert signal.getsignal(signal.SIGTERM) == signal.SIG_DFL
    print("rollback verified")
finally:
    case.doCleanups()
'''
        directory = Path(__file__).resolve().parent
        environment = dict(os.environ, PYTHONPATH=str(directory))
        for stage in ("jar", "frontend", "validation"):
            with self.subTest(stage=stage):
                result = subprocess.run([sys.executable, "-c", program, stage],
                                        env=environment, capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("rollback verified", result.stdout)

    def test_sigterm_at_activation_commit_and_receipt_publication(self):
        program = r'''
import json, os, signal, sys
from pathlib import Path
from unittest.mock import patch
import preview
from test_preview import PreviewDeploymentTest
case = PreviewDeploymentTest();case.setUp()
stage=sys.argv[1]
original=preview.deploy
server=case.root/'server-receipt.json'
terminated=False

def terminate_once():
    global terminated
    if not terminated:
        terminated=True
        os.kill(os.getpid(),signal.SIGTERM)

def write(ct,path,content,*args,**kwargs):
    if path=='/opt/myworkspace-preview/deployed-version.json':
        if stage=='server': terminate_once()
        server.write_text(content)

case.private.side_effect=write
if stage=='verified':case.mock('verify_frontend',side_effect=lambda expected:terminate_once())
publish_receipt=preview.atomic_receipt

def local_write(path,*args,**kwargs):
    if stage=='local':
        terminate_once()
    return publish_receipt(path,*args,**kwargs)

try:
    with patch.object(preview,'deploy',side_effect=lambda:original(case.root)),patch.object(preview,'atomic_receipt',local_write):
        try:preview.main()
        except SystemExit as error:assert error.code==143
        else:raise AssertionError('SIGTERM was not delivered')
    assert terminated
    if stage=='verified':
        case.assert_restored()
        assert not server.exists()
    else:
        local=case.root/'.runtime/shortcuts-preview/deployment.json'
        assert json.loads(server.read_text())==json.loads(local.read_text())
        assert json.loads(local.read_text())['commit']=='commit'
        assert not list(local.parent.glob('.deployment.json.*'))
        commands=[call.args[1] for call in case.run.call_args_list]
        assert not any(args[:3]==['ln','-s',case.old_jar] for args in commands)
    print('activation boundary verified',stage)
finally:case.doCleanups()
'''
        directory = Path(__file__).resolve().parent
        for stage in ("verified", "server", "local"):
            with self.subTest(stage=stage):
                result = subprocess.run([sys.executable, "-c", program, stage], env=dict(os.environ, PYTHONPATH=str(directory)), capture_output=True, text=True, timeout=20)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("activation boundary verified", result.stdout)
