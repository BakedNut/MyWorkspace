import base64
import gzip
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import backup


class Process:
    def __init__(self, content=b"fixture SQL"):
        self.stdout = io.BytesIO(content)
        self.stdin = io.BytesIO()
        self.returncode = 0
    def wait(self, **kwargs): return self.returncode
    def poll(self): return self.returncode
    def kill(self): self.returncode = -9


class BackupTest(unittest.TestCase):
    def encrypted(self, key, purpose):
        iv = b"fixture-nonc"
        value = AESGCM(key).encrypt(iv, b"fixture-secret", f"myworkspace-{purpose}-v1".encode())
        return base64.b64encode(iv).decode() + "." + base64.b64encode(value).decode()

    def records(self, key):
        return [
            ("icloud", {"encryptedCredentials": self.encrypted(key, "icloud")}),
            ("security-settings", {"otpSecret": self.encrypted(key, "otp"), "pendingSecret": self.encrypted(key, "otp")}),
        ]

    def rows(self, records):
        return "\n".join(name + "\t" + json.dumps(value).encode().hex() for name, value in records)

    def test_every_encrypted_field_is_authenticated_with_the_saved_key(self):
        key = b"a" * 32
        for missing in (b"", b"b" * 32):
            with patch.object(backup, "sql", return_value=self.rows(self.records(key))):
                with self.assertRaisesRegex(RuntimeError, "authenticate"):
                    backup.verify_secrets("fixture", missing)
        for index, field in [(0, "encryptedCredentials"), (1, "otpSecret"), (1, "pendingSecret")]:
            records = self.records(key)
            records[index][1][field] = self.encrypted(b"b" * 32, "icloud" if index == 0 else "otp")
            with patch.object(backup, "sql", return_value=self.rows(records)):
                with self.assertRaisesRegex(RuntimeError, "authenticate"):
                    backup.verify_secrets("fixture", key)
        with patch.object(backup, "sql", return_value=self.rows(self.records(key))):
            backup.verify_secrets("fixture", key)
        with patch.object(backup, "sql", return_value=self.rows([("icloud", {"encryptedCredentials": None})])):
            backup.verify_secrets("fixture", b"")

    def test_rotation_missing_key_and_key_read_failure_never_publish_or_prune(self):
        key = b"a" * 32
        for actual in (b"", b"b" * 32, OSError("key unreadable")):
            with self.subTest(actual=type(actual).__name__), tempfile.TemporaryDirectory() as temporary:
                folder = Path(temporary)
                previous = folder / "myworkspace-existing.sql.gz"
                previous.write_bytes(b"old backup")
                def sql(statement):
                    return self.rows(self.records(key)) if statement.startswith("SELECT id,") else ""
                with patch.object(backup, "directory", folder), patch.object(backup, "sql", side_effect=sql), patch.object(backup.subprocess, "Popen", side_effect=lambda *a, **k: Process()), patch.object(backup, "read_key", **({"side_effect": actual} if isinstance(actual, Exception) else {"return_value": actual})):
                    with self.assertRaises((RuntimeError, OSError)):
                        backup.backup()
                self.assertEqual(list(folder.glob("*.sql.gz")), [previous])
                self.assertEqual(list(folder.glob("*.key")), [])
                self.assertEqual(list(folder.glob(".staging-*")), [])

    def test_pair_publication_is_unique_and_cleanup_handles_failure_after_key_publish(self):
        key = b"a" * 32
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            def sql(statement):
                return self.rows(self.records(key)) if statement.startswith("SELECT id,") else ""
            with patch.object(backup, "directory", folder), patch.object(backup, "sql", side_effect=sql), patch.object(backup.subprocess, "Popen", side_effect=lambda *a, **k: Process()) as execute, patch.object(backup, "read_key", return_value=key):
                first, second = backup.backup(), backup.backup()
                self.assertNotEqual(first, second)
                self.assertIn("--hex-blob", execute.call_args_list[0].args[0])
                self.assertEqual(gzip.decompress(first.read_bytes()), b"fixture SQL")
                self.assertEqual(first.with_suffix(".key").read_bytes(), key)
                self.assertEqual(first.stat().st_mode & 0o777, 0o600)
                replace = Path.replace
                for error in (OSError("disk full"), SystemExit(143)):
                    def fail(path, target):
                        if path.name == "database.sql.gz": raise error
                        return replace(path, target)
                    with patch.object(Path, "replace", fail):
                        with self.assertRaises(type(error)): backup.backup()
                self.assertEqual(len(list(folder.glob("*.sql.gz"))), 2)
                self.assertEqual(len(list(folder.glob("*.key"))), 2)

    def test_isolated_restore_database_is_dropped_when_authentication_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "database.sql.gz"
            target.write_bytes(gzip.compress(b"SQL"))
            with patch.object(backup, "sql", return_value=self.rows(self.records(b"a" * 32))) as sql, patch.object(backup.subprocess, "Popen", return_value=Process()):
                with self.assertRaisesRegex(RuntimeError, "authenticate"):
                    backup.verify(target, structural=False)
                self.assertTrue(sql.call_args.args[0].startswith("DROP DATABASE `myworkspace_restore_"))

    def test_key_reader_selects_production_service_with_private_helper_staging(self):
        with tempfile.TemporaryDirectory() as temporary:
            helper = Path(temporary) / "helper.jar"
            helper.write_bytes(b"jar")
            calls = []
            def run(args, **options):
                calls.append(args)
                value = "/run/myworkspace-backup-helper.fixture\n" if "mktemp" in args else ""
                if "-c" in args:
                    self.assertEqual(args[-1], "myworkspace.service")
                    self.assertIn('SERVICE = sys.argv[2]', args[args.index('-c')+1])
                    value = "02" * 32 + "\n"
                return subprocess.CompletedProcess(args, 0, value, "")
            with patch.dict(backup.os.environ, {"BACKUP_HELPER_JAR": str(helper)}), patch.object(backup.subprocess, "run", side_effect=run):
                self.assertEqual(backup.read_key(), b"\x02" * 32)
            self.assertEqual(calls[-1][-3:], ["rm", "-rf", "/run/myworkspace-backup-helper.fixture"])
            self.assertTrue(any("0755" in args for args in calls))

    def test_retention_prunes_only_complete_pairs_after_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            for index in range(15):
                old = folder / f"myworkspace-20000101T0000{index:02}Z.sql.gz"
                old.write_bytes(b"old")
                old.with_suffix('.key').write_bytes(b"old key")
            orphan = folder / "myworkspace-orphan.sql.key"
            orphan.write_bytes(b"orphan")
            with patch.object(backup, "directory", folder), patch.object(backup, "read_key", return_value=b""), patch.object(backup, "verify"), patch.object(backup.subprocess, "Popen", return_value=Process()):
                backup.backup()
            self.assertEqual(len(list(folder.glob('*.sql.gz'))), 14)
            self.assertTrue(orphan.exists())
            self.assertFalse((folder / 'myworkspace-20000101T000000Z.sql.gz').exists())


class BackupTerminationTest(unittest.TestCase):
    def test_sigterm_during_key_read_or_after_key_publication_preserves_old_backups(self):
        program = r'''
import os,signal,sys,tempfile
from pathlib import Path
from unittest.mock import patch
import backup
from test_backup import BackupTest,Process
case=BackupTest()
key=b'\x01'*32
stage=sys.argv[1]
with tempfile.TemporaryDirectory() as temporary:
 folder=Path(temporary)
 old=folder/'myworkspace-existing.sql.gz';old.write_bytes(b'previous')
 def sql(statement):return case.rows(case.records(key)) if statement.startswith('SELECT id,') else ''
 def read_key():
  if stage=='key-read':os.kill(os.getpid(),signal.SIGTERM)
  return key
 original=Path.replace
 def replace(path,target):
  result=original(path,target)
  if path.name=='database.sql.key' and stage=='key-published':os.kill(os.getpid(),signal.SIGTERM)
  return result
 with patch.object(backup,'directory',folder),patch.object(backup,'sql',side_effect=sql),patch.object(backup,'read_key',side_effect=read_key),patch.object(backup.subprocess,'Popen',side_effect=lambda *a,**k:Process()),patch.object(Path,'replace',replace):
  try:backup.main()
  except SystemExit as stop:assert stop.code==143
  else:raise AssertionError('termination not delivered')
 assert list(folder.glob('*.sql.gz'))==[old]
 assert not list(folder.glob('*.key'))
 assert not list(folder.glob('.staging-*'))
 print('backup termination cleanup verified')
'''
        import os
        import sys
        for stage in ('key-read', 'key-published'):
            with self.subTest(stage=stage):
                result = subprocess.run([sys.executable, '-c', program, stage], env=dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parent)), capture_output=True, text=True, timeout=20)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn('backup termination cleanup verified', result.stdout)
