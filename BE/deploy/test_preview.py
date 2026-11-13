import contextlib
import hashlib
import io
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import preview


class PreviewDeploymentTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        jar = self.root / "BE/target/myworkspace-0.0.1-SNAPSHOT.jar"
        jar.parent.mkdir(parents=True)
        jar.write_bytes(b"jar")
        dist = self.root / "FE/dist"
        dist.mkdir(parents=True)
        (dist / "index.html").write_text("preview")
        self.mock("LOCK_PATH", new=self.root / "preview-deploy.lock")
        self.old_jar = "/opt/myworkspace-preview/releases/old.jar"
        self.old_frontend = "/var/www/myworkspace-preview/releases/old"
        self.run = self.mock("run", side_effect=self.server_run)
        self.backup = self.mock("backup", return_value=Path("/tmp/preview.sql.gz"))
        self.push = self.mock("subprocess.run")
        self.mock("subprocess.check_output", return_value="commit")
        self.private = self.mock("private_file")
        self.ready = self.mock("ready", return_value=True)

    def mock(self, name, **options):
        patcher = patch("preview." + name, **options)
        mock = patcher.start()
        self.addCleanup(patcher.stop)
        return mock

    def server_run(self, ct, args, data=None):
        if args == ["readlink", preview.JAR]:
            return self.old_jar
        if args == ["readlink", preview.FRONTEND]:
            return self.old_frontend
        if args[0] == "sha256sum":
            value = b"jar" if args[1].endswith(".jar") else b"preview"
            return hashlib.sha256(value).hexdigest() + " file"
        return ""

    def assert_restored(self):
        commands = [call.args[1] for call in self.run.call_args_list]
        self.assertTrue(any(args[:3] == ["ln", "-s", self.old_jar] for args in commands))
        self.assertTrue(any(args[:3] == ["ln", "-s", self.old_frontend] for args in commands))
        self.assertTrue(all("/opt/myworkspace/current.jar" not in args and
                            "/var/www/myworkspace/current" not in args for args in commands))
        self.private.assert_not_called()

    def test_failed_backend_readiness_restores_both_preview_links(self):
        self.ready.side_effect = [False, True, True]
        with self.assertRaisesRegex(RuntimeError, "backend did not become ready"):
            preview.deploy(self.root)
        self.assert_restored()

    def test_failed_web_readiness_restores_both_preview_links(self):
        self.ready.side_effect = [True, False, True, True]
        with self.assertRaisesRegex(RuntimeError, "web endpoint did not become ready"):
            preview.deploy(self.root)
        self.assert_restored()
        self.assertEqual([call.args for call in self.ready.call_args_list],
                         [(), (8088,), (8081,), (8088,)])

    def test_frontend_switch_and_restore_failure_still_restarts_the_old_backend(self):
        def run(ct, args, data=None):
            if args[0] == "ln" and args[-1].startswith(preview.FRONTEND + "."):
                raise PermissionError("frontend directory is read only")
            return self.server_run(ct, args, data)
        self.run.side_effect = run
        with self.assertRaisesRegex(RuntimeError, "rollback incomplete") as failure:
            preview.deploy(self.root)
        self.assertIsInstance(failure.exception.__cause__, PermissionError)
        commands = [call.args[1] for call in self.run.call_args_list]
        restore_jar = next(index for index, args in enumerate(commands)
                           if args[:3] == ["ln", "-s", self.old_jar])
        self.assertIn(["systemctl", "restart", "myworkspace-preview"], commands[restore_jar + 1:])
        self.assertEqual([call.args for call in self.ready.call_args_list], [(), (8081,), (8088,)])
        self.private.assert_not_called()

    def test_each_rollback_step_is_attempted_and_failures_are_reported(self):
        def run(ct, args, data=None):
            if args[0] == "ln" or args[:2] == ["systemctl", "restart"]:
                raise PermissionError("injected rollback failure")
            return ""
        self.run.side_effect = run
        self.ready.side_effect = [RuntimeError("readiness failed"), False]
        failures = preview.restore(self.old_jar, self.old_frontend, "stamp")
        self.assertEqual(len(failures), 5)
        self.run.assert_any_call(200, ["ln", "-s", self.old_frontend, preview.FRONTEND + ".stamp-restore"])
        self.run.assert_any_call(200, ["systemctl", "restart", "myworkspace-preview"])
        self.assertEqual([call.args for call in self.ready.call_args_list], [(8081,), (8088,)])

    def test_either_stopped_service_aborts_before_backup_or_upload(self):
        for stopped in ("myworkspace-preview", "myworkspace-preview-web"):
            with self.subTest(service=stopped):
                def run(ct, args, data=None):
                    if args == ["systemctl", "is-active", "--quiet", stopped]:
                        raise subprocess.CalledProcessError(3, args)
                    return self.server_run(ct, args, data)
                self.run.side_effect = run
                with self.assertRaises(subprocess.CalledProcessError):
                    preview.deploy(self.root)
                self.backup.assert_not_called()
                self.push.assert_not_called()
                self.private.assert_not_called()

    def test_success_checks_each_service_and_the_web_endpoint(self):
        preview.deploy(self.root)
        for service in ("myworkspace-preview", "myworkspace-preview-web"):
            self.run.assert_any_call(200, ["systemctl", "is-active", "--quiet", service])
        self.assertEqual([call.args for call in self.ready.call_args_list], [(), (8088,)])
        self.private.assert_called_once()

    def test_server_receipt_failure_reports_active_release_and_still_writes_local_receipt(self):
        self.private.side_effect = OSError("disk full")
        warnings = io.StringIO()
        with contextlib.redirect_stderr(warnings):
            preview.deploy(self.root)
        self.assertIn("release commit is active; server deployment record write failed", warnings.getvalue())
        self.assertTrue((self.root / ".runtime/shortcuts-preview/deployment.json").exists())
        commands = [call.args[1] for call in self.run.call_args_list]
        self.assertFalse(any(args[:3] == ["ln", "-s", self.old_jar] for args in commands))

    def test_local_receipt_failure_reports_active_release_after_server_receipt_succeeds(self):
        write_text = Path.write_text
        def write(path, *args, **kwargs):
            if path.name == "deployment.json":
                raise PermissionError("read only")
            return write_text(path, *args, **kwargs)
        warnings = io.StringIO()
        with patch.object(Path, "write_text", write), contextlib.redirect_stderr(warnings):
            preview.deploy(self.root)
        self.private.assert_called_once()
        self.assertIn("release commit is active; local deployment record write failed", warnings.getvalue())
        commands = [call.args[1] for call in self.run.call_args_list]
        self.assertFalse(any(args[:3] == ["ln", "-s", self.old_jar] for args in commands))

    def test_overlapping_deployment_is_rejected_before_reading_release_links(self):
        started = threading.Event()
        release = threading.Event()
        def run(ct, args, data=None):
            if args == ["readlink", preview.JAR]:
                started.set()
                if not release.wait(5):
                    raise RuntimeError("test deployment did not release")
            return self.server_run(ct, args, data)
        self.run.side_effect = run
        with ThreadPoolExecutor(max_workers=1) as executor:
            first = executor.submit(preview.deploy, self.root)
            try:
                self.assertTrue(started.wait(5))
                before = self.run.call_count
                with self.assertRaisesRegex(RuntimeError, "already running"):
                    preview.deploy(self.root)
                self.assertEqual(self.run.call_count, before)
            finally:
                release.set()
            first.result(timeout=5)
        self.private.assert_called_once()

    def test_lock_is_released_after_a_failed_deployment_and_rollback(self):
        self.ready.side_effect = [False, True, True]
        with self.assertRaisesRegex(RuntimeError, "backend did not become ready"):
            preview.deploy(self.root)
        self.ready.side_effect = None
        preview.deploy(self.root)
        self.private.assert_called_once()

    def test_missing_build_is_rejected_before_server_operations(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                preview.deploy(directory)
            self.run.assert_not_called()


class PreviewReadinessTest(unittest.TestCase):
    def test_checks_requested_web_port(self):
        with patch.object(preview, "run", return_value='{"status":"ok"}') as run:
            self.assertTrue(preview.ready(8088))
            self.assertIn("http://127.0.0.1:8088/api/health", run.call_args.args[1])

    def test_rejects_failed_or_unhealthy_web_responses(self):
        for response in ('{"status":"down"}', 'invalid'):
            with self.subTest(response=response), patch.object(preview, "run", return_value=response), patch.object(preview.time, "sleep"):
                self.assertFalse(preview.ready(8088))
        with patch.object(preview, "run", side_effect=subprocess.CalledProcessError(22, "curl")), patch.object(preview.time, "sleep"):
            self.assertFalse(preview.ready(8088))


if __name__ == "__main__":
    unittest.main()
