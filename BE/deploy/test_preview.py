import contextlib
import hashlib
import io
import json
import http.server
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile
from unittest.mock import patch
import preview


class PreviewDeploymentTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        jar = self.root / "BE/target/myworkspace-0.0.1-SNAPSHOT.jar"
        jar.parent.mkdir(parents=True)
        with zipfile.ZipFile(jar, "w") as archive:
            archive.writestr("BOOT-INF/classes/git.properties", "git.commit.id.full=commit\ngit.dirty=false\n")
        dist = self.root / "FE/dist"
        dist.mkdir(parents=True)
        (dist / "index.html").write_text("preview")
        self.frontend_build()
        self.mock("LOCK_PATH", new=self.root / "preview-deploy.lock")
        self.old_jar = "/opt/myworkspace-preview/releases/old.jar"
        self.old_frontend = "/var/www/myworkspace-preview/releases/old"
        self.run = self.mock("run", side_effect=self.server_run)
        self.backup = self.mock("backup", return_value=Path("/tmp/preview.sql.gz"))
        self.push = self.mock("subprocess.run")
        self.mock("subprocess.check_output", return_value="commit")
        self.private = self.mock("private_file")
        self.ready = self.mock("ready", return_value=True)
        self.identity = self.mock("verify_identity", return_value={"instance": "preview", "previewDatabase": True})

    def frontend_build(self, commit="commit", dirty=False):
        dist = self.root / "FE/dist"
        files = {path.relative_to(dist).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                 for path in dist.rglob("*") if path.is_file() and path != dist / "build-info.json"}
        (dist / "build-info.json").write_text(json.dumps(dict(commit=commit, dirty=dirty, files=files)))

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
            source = self.root / "BE/target/myworkspace-0.0.1-SNAPSHOT.jar" if args[1].endswith(".jar") else self.root / "FE/dist" / Path(args[1]).name
            value = source.read_bytes()
            return hashlib.sha256(value).hexdigest() + " file"
        return ""

    def assert_restored(self):
        commands = [call.args[1] for call in self.run.call_args_list]
        self.assertTrue(any(args[:3] == ["ln", "-s", self.old_jar] for args in commands))
        self.assertTrue(any(args[:3] == ["ln", "-s", self.old_frontend] for args in commands))
        self.assertTrue(all("/opt/myworkspace/current.jar" not in args and
                            "/var/www/myworkspace/current" not in args for args in commands))
        self.private.assert_not_called()

    def test_wrong_backend_or_database_aborts_without_publishing_frontend(self):
        self.identity.side_effect = RuntimeError("Preview backend identity mismatch")
        with self.assertRaisesRegex(RuntimeError, "identity mismatch"):
            preview.deploy(self.root)
        self.assert_restored()
        commands = [call.args[1] for call in self.run.call_args_list]
        published = [args for args in commands if args[:2] == ["ln", "-s"] and args[-1].startswith(preview.FRONTEND + ".")]
        self.assertTrue(all(args[2] == self.old_frontend for args in published))

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

    def test_missing_referenced_script_aborts_before_backup_and_server_operations(self):
        (self.root / "FE/dist/index.html").write_text('<script type="module" src="/assets/missing.js"></script>')
        self.frontend_build()
        with self.assertRaisesRegex(ValueError, "Referenced frontend asset is missing"):
            preview.deploy(self.root)
        self.run.assert_not_called()
        self.backup.assert_not_called()
        self.private.assert_not_called()

    def test_frontend_content_verification_failure_rolls_back_before_receipt(self):
        def run(ct, args, data=None):
            if preview.WEB_URL in args:
                raise subprocess.CalledProcessError(1, args)
            return self.server_run(ct, args, data)
        self.run.side_effect = run
        with self.assertRaises(subprocess.CalledProcessError):
            preview.deploy(self.root)
        self.assert_restored()

    def test_frontend_timeout_rolls_back_and_releases_deployment_lock(self):
        def run(ct, args, data=None):
            if preview.WEB_URL in args:
                raise subprocess.CalledProcessError(124, args)
            return self.server_run(ct, args, data)
        self.run.side_effect = run
        with self.assertRaises(subprocess.CalledProcessError) as failure:
            preview.deploy(self.root)
        self.assertEqual(failure.exception.returncode, 124)
        self.assert_restored()
        self.run.side_effect = self.server_run
        preview.deploy(self.root)
        self.private.assert_called_once()

    def test_stale_build_commit_aborts_before_server_operations(self):
        for component in ("backend", "frontend"):
            with self.subTest(component=component):
                jar = self.root / "BE/target/myworkspace-0.0.1-SNAPSHOT.jar"
                with zipfile.ZipFile(jar, "w") as archive:
                    commit = "old" if component == "backend" else "commit"
                    archive.writestr("BOOT-INF/classes/git.properties", f"git.commit.id.full={commit}\ngit.dirty=false\n")
                commit = "old" if component == "frontend" else "commit"
                self.frontend_build(commit=commit)
                with self.assertRaisesRegex(ValueError, "commit"):
                    preview.deploy(self.root)
                self.run.assert_not_called()
                self.backup.assert_not_called()
                self.private.assert_not_called()

    def test_missing_build_metadata_aborts_before_server_operations(self):
        (self.root / "FE/dist/build-info.json").unlink()
        with self.assertRaises(ValueError):
            preview.deploy(self.root)
        self.run.assert_not_called()
        self.backup.assert_not_called()
        self.private.assert_not_called()

    def test_deployment_receipt_preserves_dirty_build_flags(self):
        self.frontend_build(dirty=True)
        preview.deploy(self.root)
        receipt = json.loads(self.private.call_args.args[2])
        self.assertEqual(receipt["commit"], "commit")
        self.assertFalse(receipt["backendDirty"])
        self.assertTrue(receipt["frontendDirty"])

    def test_jar_rebuild_during_backup_aborts_before_activation(self):
        def rebuild(stamp):
            jar = self.root / "BE/target/myworkspace-0.0.1-SNAPSHOT.jar"
            with zipfile.ZipFile(jar, "w") as archive:
                archive.writestr("BOOT-INF/classes/git.properties", "git.commit.id.full=other\ngit.dirty=false\n")
            return Path("/tmp/preview.sql.gz")
        self.backup.side_effect = rebuild
        with self.assertRaisesRegex(RuntimeError, "JAR checksum"):
            preview.deploy(self.root)
        self.private.assert_not_called()
        commands = [call.args[1] for call in self.run.call_args_list]
        self.assertFalse(any(args[0] == "ln" for args in commands))

    def test_jar_rebuild_after_upload_keeps_the_verified_artifact_hash(self):
        jar = self.root / "BE/target/myworkspace-0.0.1-SNAPSHOT.jar"
        original = jar.read_bytes()
        def push(args, **options):
            if args[:3] == ["pct", "push", "200"] and args[3] == str(jar):
                with zipfile.ZipFile(jar, "w") as archive:
                    archive.writestr("BOOT-INF/classes/git.properties", "git.commit.id.full=other\ngit.dirty=false\n")
        def run(ct, args, data=None):
            if args[0] == "sha256sum" and args[1].endswith(".jar"):
                return hashlib.sha256(original).hexdigest() + " file"
            return self.server_run(ct, args, data)
        self.push.side_effect = push
        self.run.side_effect = run
        preview.deploy(self.root)
        receipt = json.loads(self.private.call_args.args[2])
        self.assertEqual(receipt["commit"], "commit")
        self.assertEqual(receipt["backendSha256"], hashlib.sha256(original).hexdigest())

    def test_frontend_rebuild_during_deployment_preserves_the_initial_snapshot(self):
        for timing in ("backup", "upload"):
            with self.subTest(timing=timing):
                dist = self.root / "FE/dist"
                (dist / "images").mkdir(exist_ok=True)
                (dist / "images/icon.png").write_bytes(b"original image")
                (dist / "removed.txt").write_text("original file")
                (dist / "new.txt").unlink(missing_ok=True)
                self.frontend_build()
                original = {path.relative_to(dist).as_posix(): path.read_bytes()
                            for path in dist.rglob("*") if path.is_file()}
                uploaded = {}
                sources = []
                rebuilt = False

                def rebuild():
                    nonlocal rebuilt
                    rebuilt = True
                    (dist / "build-info.json").write_text('{"commit":"other","dirty":true}')
                    (dist / "images/icon.png").write_bytes(b"rebuilt image")
                    (dist / "removed.txt").unlink()
                    (dist / "new.txt").write_text("new file")

                def backup(stamp):
                    if timing == "backup":
                        rebuild()
                    return Path("/tmp/preview.sql.gz")

                def push(args, **options):
                    source = Path(args[3])
                    uploaded[args[4]] = source.read_bytes()
                    if not str(source).endswith(".jar"):
                        sources.append(source)
                        if timing == "upload" and not rebuilt:
                            rebuild()

                def run(ct, args, data=None):
                    if args[0] == "sha256sum":
                        return hashlib.sha256(uploaded[args[1]]).hexdigest() + " file"
                    return self.server_run(ct, args, data)

                self.backup.side_effect = backup
                self.push.side_effect = push
                self.run.side_effect = run
                preview.deploy(self.root)
                receipt = json.loads(self.private.call_args.args[2])
                prefix = receipt["frontend"] + "/"
                actual = {path.removeprefix(prefix): value for path, value in uploaded.items()
                          if path.startswith(prefix)}
                self.assertEqual(actual, original)
                self.assertEqual(receipt["commit"], "commit")
                self.assertFalse(receipt["frontendDirty"])
                self.assertTrue(rebuilt)
                self.assertTrue(sources)
                self.assertTrue(all(not source.exists() for source in sources))

    def test_corrupt_frontend_upload_aborts_before_activation_and_cleans_snapshot(self):
        sources = []

        def push(args, **options):
            if not args[3].endswith(".jar"):
                sources.append(Path(args[3]))

        def run(ct, args, data=None):
            if args[0] == "sha256sum" and not args[1].endswith(".jar"):
                return hashlib.sha256(b"corrupt upload").hexdigest() + " file"
            return self.server_run(ct, args, data)

        self.push.side_effect = push
        self.run.side_effect = run
        with self.assertRaisesRegex(RuntimeError, "frontend checksum"):
            preview.deploy(self.root)
        self.private.assert_not_called()
        self.assertFalse(any(call.args[1][0] == "ln" for call in self.run.call_args_list))
        self.assertTrue(sources)
        self.assertTrue(all(not source.exists() for source in sources))

    def test_mixed_frontend_builds_during_copy_abort_before_server_operations(self):
        copytree = preview.shutil.copytree
        for mixed in ("metadata", "asset", "added", "removed"):
            with self.subTest(mixed=mixed):
                dist = self.root / "FE/dist"
                (dist / "icon.png").write_bytes(b"old image")
                self.frontend_build()

                def copy(source, destination):
                    result = copytree(source, destination)
                    if mixed == "metadata":
                        (dist / "icon.png").write_bytes(b"new image")
                        self.frontend_build()
                        (destination / "build-info.json").write_bytes((dist / "build-info.json").read_bytes())
                    elif mixed == "asset":
                        (destination / "icon.png").write_bytes(b"new image")
                    elif mixed == "added":
                        (destination / "extra.txt").write_text("new file")
                    else:
                        (destination / "icon.png").unlink()
                    return result

                with patch.object(preview.shutil, "copytree", side_effect=copy):
                    with self.assertRaisesRegex(ValueError, "Build metadata"):
                        preview.deploy(self.root)
                self.run.assert_not_called()
                self.backup.assert_not_called()
                self.push.assert_not_called()
                self.private.assert_not_called()

    def test_missing_frontend_hash_manifest_aborts_before_server_operations(self):
        (self.root / "FE/dist/build-info.json").write_text('{"commit":"commit","dirty":false}')
        with self.assertRaisesRegex(ValueError, "Build metadata"):
            preview.deploy(self.root)
        self.run.assert_not_called()
        self.backup.assert_not_called()
        self.private.assert_not_called()

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


class PreviewIdentityTest(unittest.TestCase):
    def test_rejects_other_instance_production_database_and_invalid_response(self):
        expected = {"instance": "preview", "previewDatabase": True}
        invalid = [
            {"instance": "production", "previewDatabase": True},
            {"instance": "preview", "previewDatabase": False},
            {"instance": "preview", "previewDatabase": "true"},
            {"status": "ok"},
            {},
        ]
        for direct, web in [(expected, item) for item in invalid] + [(item, expected) for item in invalid]:
            with self.subTest(direct=direct, web=web), patch.object(preview, "run", side_effect=[json.dumps(direct), json.dumps(web)]):
                with self.assertRaises(RuntimeError):
                    preview.verify_identity()

    def test_healthy_web_route_to_the_wrong_backend_is_rejected_over_http(self):
        import urllib.request
        current = {"instance": "preview", "previewDatabase": True}
        routed = dict(current)

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                value = {"status": "ok"} if self.path == "/api/health" else (
                    current if self.server is direct else routed)
                content = json.dumps(value).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)

            def log_message(self, *args):
                pass

        direct = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        web = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        servers = [direct, web]
        threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in servers]
        for thread in threads:
            thread.start()
        try:
            def run(ct, args):
                url = args[-1].replace(":8081/", f":{direct.server_port}/").replace(
                    ":8088/", f":{web.server_port}/")
                with urllib.request.urlopen(url, timeout=2) as response:
                    return response.read().decode()

            with patch.object(preview, "run", side_effect=run):
                for invalid in [{"instance": "production", "previewDatabase": True},
                                {"instance": "preview", "previewDatabase": False}]:
                    routed.clear()
                    routed.update(invalid)
                    self.assertTrue(preview.ready(8081))
                    self.assertTrue(preview.ready(8088))
                    with self.assertRaises(RuntimeError):
                        preview.verify_identity()
                routed.clear()
                routed.update(current)
                self.assertEqual(preview.verify_identity(), current)
        finally:
            for server, thread in zip(servers, threads):
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_verifies_the_actual_web_route_against_direct_backend(self):
        expected = {"instance": "preview", "previewDatabase": True}
        with patch.object(preview, "run", return_value=json.dumps(expected)) as run:
            self.assertEqual(preview.verify_identity(), expected)
            self.assertIn("http://127.0.0.1:8081/api/health/deployment", run.call_args_list[0].args[1])
            self.assertIn("http://127.0.0.1:8088/api/health/deployment", run.call_args_list[1].args[1])


class FrontendVerificationTest(unittest.TestCase):
    def test_manifest_checks_local_references_and_includes_all_built_scripts(self):
        with tempfile.TemporaryDirectory() as directory:
            dist = Path(directory)
            (dist / "assets").mkdir()
            (dist / "index.html").write_text('<script src="./assets/app.js?v=1"></script><script src="/entry"></script><link rel="stylesheet" href="/assets/app.css">')
            (dist / "assets/app.js").write_text('console.log("ready")')
            (dist / "assets/app.css").write_text('body { color: blue }')
            (dist / "entry").write_text('console.log("entry")')
            manifest = preview.frontend_manifest(dist)
            self.assertIn("/", manifest)
            self.assertIn("/assets/app.js?v=1", manifest)
            self.assertIn("/assets/app.js", manifest)
            self.assertIn("/assets/app.css", manifest)
            self.assertEqual(manifest["/assets/app.js"]["sha256"], hashlib.sha256((dist / "assets/app.js").read_bytes()).hexdigest())
            self.assertEqual(manifest["/entry"]["kind"], "javascript")
            self.assertEqual(manifest["/entry"]["size"], (dist / "entry").stat().st_size)

    @contextlib.contextmanager
    def served_frontend(self, redirects=None, encodings=None, lengths=None):
        bodies = {"/": b'<script src="/assets/app.js"></script>',
                  "/assets/app.js": b'console.log("ready")',
                  "/assets/app.css": b'body { color: blue }', "/entry": b'console.log("entry")'}
        media = {"/": "text/html", "/assets/app.js": "text/javascript", "/assets/app.css": "text/css", "/entry": "text/javascript"}
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path in (redirects or {}):
                    self.send_response(302)
                    self.send_header("Location", redirects[self.path])
                    self.end_headers()
                    return
                content = bodies.get(self.path)
                self.send_response(200 if content is not None else 404)
                values = media.get(self.path)
                if isinstance(values, str):
                    values = [values]
                for value in values or []:
                    self.send_header("Content-Type", value)
                for value in (lengths or {}).get(self.path, []):
                    self.send_header("Content-Length", value)
                for value in (encodings or {}).get(self.path, []):
                    self.send_header("Content-Encoding", value)
                self.end_headers()
                self.wfile.write(content or b"missing")
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        kinds = {"/": "html", "/assets/app.css": "css", "/assets/app.js": "javascript", "/entry": "javascript"}
        expected = {path: {"sha256": hashlib.sha256(body).hexdigest(), "kind": kinds[path], "size": len(body)}
                    for path, body in bodies.items()}
        def local_run(ct, args, data=None):
            return subprocess.run(args, input=data, text=True, capture_output=True, check=True).stdout
        try:
            with patch.object(preview, "WEB_URL", f"http://127.0.0.1:{server.server_port}"), patch.object(preview, "run", side_effect=local_run):
                yield bodies, media, expected
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_web_page_and_script_must_be_served_with_expected_content(self):
        with self.served_frontend() as (bodies, media, expected):
            preview.verify_frontend(expected)
            del bodies["/assets/app.js"]
            with self.assertRaises(subprocess.CalledProcessError):
                preview.verify_frontend(expected)
            bodies["/assets/app.js"] = bodies["/"]
            with self.assertRaises(subprocess.CalledProcessError):
                preview.verify_frontend(expected)

    def test_streams_have_a_total_deadline_and_bounded_body_read(self):
        for mode in ("oversize", "drip"):
            with self.subTest(mode=mode):
                stop = threading.Event()
                size = 16 if mode == "oversize" else 1000
                class Handler(http.server.BaseHTTPRequestHandler):
                    def do_GET(self):
                        self.send_response(200)
                        self.send_header("Content-Type", "text/javascript")
                        self.end_headers()
                        try:
                            if mode == "oversize":
                                self.wfile.write(b"x" * (size + 1))
                                self.wfile.flush()
                                stop.wait(5)
                            else:
                                while not stop.wait(0.05):
                                    self.wfile.write(b"x")
                                    self.wfile.flush()
                        except (BrokenPipeError, ConnectionResetError):
                            pass
                    def log_message(self, *args):
                        pass
                server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                def local_run(ct, args, data=None):
                    return subprocess.run(args, input=data, text=True, capture_output=True, check=True, timeout=3).stdout
                expected = {"/stream.js": {"sha256": "unused", "kind": "javascript", "size": size}}
                try:
                    with patch.object(preview, "WEB_URL", f"http://127.0.0.1:{server.server_port}"), patch.object(preview, "FRONTEND_VERIFY_SECONDS", 1, create=True), patch.object(preview, "run", side_effect=local_run):
                        started = time.monotonic()
                        with self.assertRaises(subprocess.CalledProcessError) as failure:
                            preview.verify_frontend(expected)
                        self.assertLess(time.monotonic() - started, 3)
                        self.assertEqual(failure.exception.returncode, 1 if mode == "oversize" else 124)
                        if mode == "oversize":
                            self.assertIn("size mismatch", failure.exception.stderr)
                finally:
                    stop.set()
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=2)

    def test_only_unencoded_frontend_responses_are_accepted(self):
        encodings = {}
        with self.served_frontend(encodings=encodings) as (bodies, media, expected):
            for path in expected:
                for values in ([], ["identity"], ["IDENTITY"]):
                    encodings[path] = values
                    preview.verify_frontend(expected)
                for values in (["gzip"], ["br"], ["deflate"], ["identity", "gzip"], ["gzip", "identity"], ["identity, gzip"]):
                    encodings[path] = values
                    with self.subTest(path=path, encoding=values), self.assertRaises(subprocess.CalledProcessError):
                        preview.verify_frontend(expected)
                encodings[path] = []

    def test_content_length_must_match_the_received_body(self):
        lengths = {}
        with self.served_frontend(lengths=lengths) as (bodies, media, expected):
            for path in ("/", "/assets/app.js"):
                size = len(bodies[path])
                for values in ([str(size)], ["00" + str(size)], [str(size), str(size)], [f"{size}, {size}"]):
                    lengths[path] = values
                    preview.verify_frontend(expected)
                for values in ([str(size + 10)], [str(size - 1)], ["-1"], ["bad"], [""], [str(size), str(size + 1)], [f"{size}, {size + 1}"]):
                    lengths[path] = values
                    with self.subTest(path=path, content_length=values), self.assertRaises(subprocess.CalledProcessError):
                        preview.verify_frontend(expected)
                lengths[path] = []

    def test_html_charset_must_match_utf8_build(self):
        with self.served_frontend() as (bodies, media, expected):
            for value in ("text/html", 'text/html; charset="UTF-8"', "text/html; charset=utf8", "text/html; charset=unicode-1-1-utf-8"):
                media["/"] = value
                preview.verify_frontend(expected)
            for value in ("text/html; charset=utf-16le", "text/html; charset=windows-1252", "text/html; charset=unknown", "text/html; charset=utf-8; charset=utf-16le", ["text/html; charset=utf-8", "text/html; charset=utf-16le"]):
                media["/"] = value
                with self.subTest(content_type=value), self.assertRaises(subprocess.CalledProcessError):
                    preview.verify_frontend(expected)

    def test_css_charset_must_match_utf8_build(self):
        with self.served_frontend() as (bodies, media, expected):
            for value in ("text/css", 'text/css; charset="UTF-8"', "text/css; charset=utf8"):
                media["/assets/app.css"] = value
                preview.verify_frontend(expected)
            for value in ("text/css; charset=utf-16le", "text/css; charset=windows-1252", "text/css; charset=unknown", "text/css; charset=utf-8; charset=utf-16le", ["text/css; charset=utf-8", "text/css; charset=utf-16le"]):
                media["/assets/app.css"] = value
                with self.subTest(content_type=value), self.assertRaises(subprocess.CalledProcessError):
                    preview.verify_frontend(expected)

    def test_home_redirect_must_end_at_root_route(self):
        redirects = {}
        with self.served_frontend(redirects) as (bodies, media, expected):
            for destination in ("/index.html", "/shortcuts"):
                redirects["/"] = destination
                bodies[destination] = bodies["/"]
                media[destination] = media["/"]
                with self.subTest(destination=destination), self.assertRaises(subprocess.CalledProcessError):
                    preview.verify_frontend(expected)
            redirects["/"] = "/?preview=1"
            bodies["/?preview=1"] = bodies["/"]
            media["/?preview=1"] = media["/"]
            preview.verify_frontend(expected)
            redirects["/"] = "/index.html"
            redirects["/index.html"] = "/?preview=1"
            preview.verify_frontend(expected)

    def test_same_origin_redirects_preserve_content_and_media_validation(self):
        with self.served_frontend({"/assets/start": "/assets/middle", "/assets/middle": "/assets/app.js"}) as (bodies, media, expected):
            asset = {"/assets/start": expected["/assets/app.js"]}
            preview.verify_frontend(asset)
            media["/assets/app.js"] = "text/plain"
            with self.assertRaises(subprocess.CalledProcessError):
                preview.verify_frontend(asset)
            media["/assets/app.js"] = "text/javascript"
            bodies["/assets/app.js"] = b"wrong content"
            with self.assertRaises(subprocess.CalledProcessError):
                preview.verify_frontend(asset)

    def test_redirects_must_preserve_relative_dependency_directory(self):
        redirects = {"/assets/app.js": "/alternate/app.js",
                     "/assets/app.css": "/alternate/app.css", "/": "/alternate/index.html"}
        with self.served_frontend(redirects) as (bodies, media, expected):
            for path, destination in redirects.items():
                bodies[destination] = bodies[path]
                media[destination] = media[path]
                with self.subTest(path=path), self.assertRaises(subprocess.CalledProcessError):
                    preview.verify_frontend({path: expected[path]})
            # A temporary directory change is rejected even if the final URL returns.
            redirects["/assets/app.js"] = "/alternate/start.js"
            redirects["/alternate/start.js"] = "/assets/final.js"
            bodies["/assets/final.js"] = bodies["/assets/app.js"]
            media["/assets/final.js"] = media["/assets/app.js"]
            with self.assertRaises(subprocess.CalledProcessError):
                preview.verify_frontend({"/assets/app.js": expected["/assets/app.js"]})

    def test_local_assets_reject_cross_origin_redirects(self):
        with self.served_frontend() as (bodies, media, expected):
            target = preview.WEB_URL
            redirects = {}
            class Handler(http.server.BaseHTTPRequestHandler):
                def do_GET(self):
                    self.send_response(302)
                    self.send_header("Location", redirects.get(self.path, target + self.path))
                    self.end_headers()
                def log_message(self, *args):
                    pass
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            source = f"http://127.0.0.1:{server.server_port}"
            try:
                with patch.object(preview, "WEB_URL", source):
                    for path in ("/", "/assets/app.js", "/assets/app.css", "/entry"):
                        with self.subTest(path=path), self.assertRaises(subprocess.CalledProcessError):
                            preview.verify_frontend({path: expected[path]})
                    redirects["/assets/app.js"] = "/assets/same-origin"
                    redirects["/assets/same-origin"] = target + "/assets/app.js"
                    with self.assertRaises(subprocess.CalledProcessError):
                        preview.verify_frontend({"/assets/app.js": expected["/assets/app.js"]})
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_media_types_are_required_and_accept_valid_parameters(self):
        with self.served_frontend() as (bodies, media, expected):
            for valid in ("text/javascript", "application/javascript; charset=utf-8", "TEXT/JAVASCRIPT", "text/ecmascript"):
                media["/assets/app.js"] = valid
                preview.verify_frontend(expected)
            for path, invalid in (("/assets/app.js", None), ("/assets/app.js", "text/plain"),
                                  ("/assets/app.js", "application/octet-stream"),
                                  ("/assets/app.js", ["text/javascript", "text/plain"]),
                                  ("/assets/app.css", None), ("/assets/app.css", "text/plain"),
                                  ("/entry", None), ("/entry", "text/plain"),
                                  ("/", "application/octet-stream")):
                with self.subTest(path=path, media_type=invalid):
                    previous = media[path]
                    media[path] = invalid
                    with self.assertRaises(subprocess.CalledProcessError):
                        preview.verify_frontend(expected)
                    media[path] = previous
            media["/assets/app.css"] = "text/css; charset=utf-8"
            preview.verify_frontend(expected)


if __name__ == "__main__":
    unittest.main()
