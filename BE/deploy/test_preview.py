import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import preview


class PreviewDeploymentTest(unittest.TestCase):
    def test_failed_readiness_restores_both_preview_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            jar = root / "BE/target/myworkspace-0.0.1-SNAPSHOT.jar"
            jar.parent.mkdir(parents=True)
            jar.write_bytes(b"jar")
            dist = root / "FE/dist"
            dist.mkdir(parents=True)
            (dist / "index.html").write_text("preview")
            old_jar = "/opt/myworkspace-preview/releases/old.jar"
            old_frontend = "/var/www/myworkspace-preview/releases/old"
            calls = []

            def run(ct, args, data=None):
                calls.append((ct, args))
                if args == ["readlink", preview.JAR]:return old_jar
                if args == ["readlink", preview.FRONTEND]:return old_frontend
                if args[0] == "sha256sum":
                    value = b"jar" if args[1].endswith(".jar") else b"preview"
                    return hashlib.sha256(value).hexdigest() + " file"
                return ""

            with patch.object(preview, "run", side_effect=run), patch.object(preview, "backup", return_value=Path("/tmp/preview.sql.gz")), patch.object(preview.subprocess, "run"), patch.object(preview.subprocess, "check_output", return_value="commit"), patch.object(preview, "private_file") as private, patch.object(preview, "ready", side_effect=[False, True]):
                with self.assertRaisesRegex(RuntimeError, "did not become ready"):
                    preview.deploy(root)
            self.assertTrue(any(args[:3] == ["ln", "-s", old_jar] for ct, args in calls))
            self.assertTrue(any(args[:3] == ["ln", "-s", old_frontend] for ct, args in calls))
            self.assertTrue(all("/opt/myworkspace/current.jar" not in args and "/var/www/myworkspace/current" not in args for ct, args in calls))
            private.assert_not_called()

    def test_missing_build_is_rejected_before_server_operations(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(preview, "run") as run:
            with self.assertRaises(ValueError):preview.deploy(directory)
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
