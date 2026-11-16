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
target = preview.JAR if sys.argv[1] == "jar" else preview.FRONTEND
terminated = False

def run(ct, args, data=None):
    global terminated
    result = case.server_run(ct, args, data)
    if args[:2] == ["mv", "-Tf"] and args[-1] == target:
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
            assert stopped.code == 128 + signal.SIGTERM
        else:
            raise AssertionError("termination was not propagated")
    case.assert_restored()
    assert signal.getsignal(signal.SIGTERM) == signal.SIG_DFL
    print("rollback verified")
finally:
    case.doCleanups()
'''
        directory = Path(__file__).resolve().parent
        environment = dict(os.environ, PYTHONPATH=str(directory))
        for stage in ("jar", "frontend"):
            with self.subTest(stage=stage):
                result = subprocess.run([sys.executable, "-c", program, stage],
                                        env=environment, capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("rollback verified", result.stdout)
