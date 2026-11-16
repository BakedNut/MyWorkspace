from pathlib import Path
import gzip
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import preview
import preview_key


class PreviewBackupTest(unittest.TestCase):
    def test_key_is_required_for_encrypted_settings_and_kept_with_database(self):
        for required, key, success in [(1, "", False), (0, "", True),
                                       (1, "01" * 32, True), (0, "01" * 31, False),
                                       (1, "invalid", False)]:
            with self.subTest(required=required, key_length=len(key)), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                def run(ct, args, data=None):
                    if ct == 202:
                        return "fixture SQL" if args[0] == "mysqldump" else ("1" if "information_schema.tables" in args[-1] else str(required))
                    self.assertEqual(args[-1], "/releases/verified.jar")
                    return key
                with patch.object(preview, "BACKUP_DIRECTORY", directory), patch.object(preview, "run", side_effect=run):
                    if not success:
                        with self.assertRaises(RuntimeError):
                            preview.backup("fixture", "/releases/verified.jar")
                        self.assertEqual(list(directory.iterdir()), [])
                        continue
                    target = preview.backup("fixture", "/releases/verified.jar")
                    self.assertEqual(gzip.decompress(target.read_bytes()), b"fixture SQL")
                    self.assertEqual(target.stat().st_mode & 0o777, 0o600)
                    if key:
                        self.assertEqual(target.with_suffix(".key").read_bytes(), bytes.fromhex(key))
                        self.assertEqual(target.with_suffix(".key").stat().st_mode & 0o777, 0o600)

    def test_empty_database_can_be_backed_up_without_an_encryption_key(self):
        with tempfile.TemporaryDirectory() as temporary:
            def run(ct, args, data=None):
                if ct == 200:
                    return ""
                if args[0] == "mysqldump":
                    return "empty database"
                self.assertIn("information_schema.tables", args[-1])
                return "0"
            with patch.object(preview, "BACKUP_DIRECTORY", Path(temporary)), patch.object(preview, "run", side_effect=run):
                target = preview.backup("empty", "/releases/verified.jar")
                self.assertEqual(gzip.decompress(target.read_bytes()), b"empty database")

    def test_key_read_failure_does_not_publish_a_database_only_backup(self):
        with tempfile.TemporaryDirectory() as temporary:
            def run(ct, args, data=None):
                if ct == 200:
                    raise subprocess.CalledProcessError(1, args)
                return "fixture SQL" if args[0] == "mysqldump" else "1"
            with patch.object(preview, "BACKUP_DIRECTORY", Path(temporary)), patch.object(preview, "run", side_effect=run):
                with self.assertRaises(subprocess.CalledProcessError):
                    preview.backup("fixture", "/releases/verified.jar")
                self.assertEqual(list(Path(temporary).iterdir()), [])


class PreviewKeyEnvironmentTest(unittest.TestCase):
    def result(self, key="00" * 32):
        return subprocess.CompletedProcess([], 0, "startup log\nPREVIEW_BACKUP_KEY=" + key + "\n", "")

    def test_stopped_service_uses_native_systemd_environment_and_command_properties(self):
        properties = {
            "MainPID": "0", "ExecStart": "{ path=/usr/bin/java ; argv[]=/usr/bin/java -Dapp.icloud-key-file=/custom/key -jar /old.jar --spring.profiles.active=preview ; ignore_errors=no ; }",
            "User": "preview", "Group": "preview", "WorkingDirectory": "/var/lib/preview",
            "Environment": 'ICLOUD_KEY_FILE="/custom key"',
            "EnvironmentFiles": "/etc/preview.env (ignore_errors=no) /etc/optional.env (ignore_errors=yes)",
        }
        with patch.object(preview_key, "service_property", side_effect=properties.__getitem__), patch.object(preview_key.subprocess, "run", return_value=self.result()) as execute:
            self.assertEqual(preview_key.read_key("/new.jar"), "00" * 32)
            command = execute.call_args.args[0]
            self.assertEqual(command[0], "systemd-run")
            self.assertIn("--setenv=ICLOUD_KEY_FILE", command)
            self.assertEqual(execute.call_args.kwargs["env"]["ICLOUD_KEY_FILE"], "/custom key")
            self.assertNotIn('Environment=ICLOUD_KEY_FILE="/custom key"', command)
            self.assertIn("EnvironmentFile=/etc/preview.env -/etc/optional.env", command)
            self.assertIn("-Dapp.icloud-key-file=/custom/key", command)
            self.assertIn("--spring.profiles.active=preview", command)
            self.assertIn("/new.jar", command)
            self.assertNotIn("/old.jar", command)

    def test_running_service_uses_the_applied_process_environment_and_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            process = root / "42"
            process.mkdir()
            (process / "environ").write_bytes(b"ICLOUD_KEY_FILE=/running/key\0")
            (process / "cmdline").write_bytes(b"/usr/bin/java\0-jar\0/old.jar\0--app.icloud-key-file=/applied/key\0")
            (process / "status").write_text("Groups:\t10 20\n")
            (process / "cwd").symlink_to(root, target_is_directory=True)
            with patch.object(preview_key, "PROC", root), patch.object(preview_key, "service_property", return_value="42"), patch.object(preview_key.subprocess, "run", return_value=self.result()) as execute:
                self.assertEqual(preview_key.read_key("/new.jar"), "00" * 32)
                command = execute.call_args.args[0]
                options = execute.call_args.kwargs
                self.assertEqual(command[0], "/usr/bin/java")
                self.assertEqual(options["env"], {"ICLOUD_KEY_FILE": "/running/key"})
                self.assertEqual(options["extra_groups"], [10, 20])
                self.assertEqual(options["user"], process.stat().st_uid)
                self.assertIn("--app.icloud-key-file=/applied/key", command)
