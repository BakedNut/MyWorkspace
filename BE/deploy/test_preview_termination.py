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
