#!/usr/bin/python3
"""Daily private backup with authenticated, isolated restore before publication."""
from pathlib import Path
import base64
import datetime
import fcntl
import gzip
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import uuid
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

os.umask(0o077)
directory = Path("/root/.local/state/myworkspace/backups")
mysql = ["pct", "exec", "202", "--", "mysql", "--defaults-extra-file=/root/.myworkspace.cnf", "--batch", "--skip-column-names"]


def sql(statement):
    return subprocess.run(mysql, input=statement, text=True, capture_output=True, check=True).stdout


def read_key():
    helper = Path(os.environ.get("BACKUP_HELPER_JAR", str(Path(__file__).resolve().parents[1] / "target/myworkspace-0.0.1-SNAPSHOT.jar")))
    if not helper.is_file():
        helper = Path("/usr/local/share/myworkspace-backup-helper.jar")
    if not helper.is_file():
        raise RuntimeError("Build or install the backup helper JAR before backing up")
    remote = subprocess.run(["pct", "exec", "200", "--", "mktemp", "-d", "/run/myworkspace-backup-helper.XXXXXXXX"], capture_output=True, text=True, check=True).stdout.strip()
    if not re.fullmatch(r"/run/myworkspace-backup-helper\.[a-zA-Z0-9]+", remote):
        raise RuntimeError("Invalid backup helper staging path")
    try:
        subprocess.run(["pct", "exec", "200", "--", "chmod", "0755", remote], capture_output=True, check=True)
        jar = remote + "/helper.jar"
        subprocess.run(["pct", "push", "200", str(helper), jar, "--perms", "0644"], capture_output=True, check=True)
        program = Path(__file__).with_name("preview_key.py").read_text()
        result = subprocess.run(["pct", "exec", "200", "--", "python3", "-c", program, jar, "myworkspace.service"], capture_output=True, text=True, check=True)
        value = result.stdout.strip()
        if value and not re.fullmatch(r"[0-9a-f]{64}", value):
            raise RuntimeError("Invalid service encryption key")
        return bytes.fromhex(value)
    finally:
        subprocess.run(["pct", "exec", "200", "--", "rm", "-rf", remote], capture_output=True, check=True)


def verify_secrets(database, key):
    rows = sql(f"SELECT id,HEX(payload) FROM `{database}`.app_document WHERE id IN ('icloud','security-settings');")
    for row in rows.splitlines():
        document, payload = row.split("\t", 1)
        value = json.loads(bytes.fromhex(payload))
        fields = ("encryptedCredentials",) if document == "icloud" else ("otpSecret", "pendingSecret")
        purpose = "icloud" if document == "icloud" else "otp"
        for field in fields:
            encrypted = value.get(field)
            if encrypted is None:
                continue
            try:
                if len(key) != 32 or not isinstance(encrypted, str):
                    raise ValueError()
                iv, ciphertext = encrypted.split(".")
                nonce = base64.b64decode(iv, validate=True)
                if len(nonce) != 12:
                    raise ValueError()
                AESGCM(key).decrypt(nonce, base64.b64decode(ciphertext, validate=True), f"myworkspace-{purpose}-v1".encode())
            except Exception:
                raise RuntimeError("Backup encryption key does not authenticate restored secrets") from None


def backup(full_verify=False):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / ".backup.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + "-" + uuid.uuid4().hex[:8]
        target = directory / ("myworkspace-" + stamp + ".sql.gz")
        published = False
        try:
            with tempfile.TemporaryDirectory(prefix=".staging-", dir=directory) as temporary:
                staged = Path(temporary) / "database.sql.gz"
                with tempfile.TemporaryFile() as errors:
                    process = subprocess.Popen(["pct", "exec", "202", "--", "mysqldump", "--defaults-extra-file=/root/.myworkspace.cnf",
                        "--single-transaction", "--no-tablespaces", "--set-gtid-purged=OFF", "--column-statistics=0", "--hex-blob", "myworkspace"], stdout=subprocess.PIPE, stderr=errors)
                    try:
                        with gzip.open(staged, "wb") as output:
                            while chunk := process.stdout.read(1024 * 1024):
                                output.write(chunk)
                        process.wait(timeout=60)
                        if process.returncode:
                            raise RuntimeError("Database backup failed; inspect the private backup service log")
                    finally:
                        if process.poll() is None:
                            process.kill()
                        process.wait()
                        process.stdout.close()
                key = read_key()
                if key:
                    if len(key) != 32:
                        raise RuntimeError("Invalid encryption key; preserve existing backups")
                    staged.with_suffix(".key").write_bytes(key)
                verify(staged, structural=full_verify)
                if key:
                    staged.with_suffix(".key").replace(target.with_suffix(".key"))
                # The final SQL file is the commit marker for the complete pair.
                staged.replace(target)
                published = True
        finally:
            if not published:
                target.unlink(missing_ok=True)
                target.with_suffix(".key").unlink(missing_ok=True)
        for old in sorted(directory.glob("myworkspace-*.sql.gz"))[:-14]:
            old.unlink()
            old.with_suffix(".key").unlink(missing_ok=True)
        print("Backup saved:", target)
        return target


def verify(target, structural=True):
    name = "myworkspace_restore_" + uuid.uuid4().hex[:12]
    assert re.fullmatch(r"myworkspace_restore_[0-9a-f]{12}", name)
    sql(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;")
    try:
        with gzip.open(target, "rb") as source:
            process = subprocess.Popen([*mysql, name], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            try:
                while chunk := source.read(1024 * 1024):
                    process.stdin.write(chunk)
                process.stdin.close()
                process.wait(timeout=90)
                if process.returncode:
                    raise RuntimeError("Isolated restore failed")
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait()
        key_path = target.with_suffix(".key")
        verify_secrets(name, key_path.read_bytes() if key_path.exists() else b"")
        if structural:
            tables = sql(f"SHOW TABLES FROM `{name}`;").splitlines()
            expected = {"app_document", "calendar_event", "flyway_schema_history", "metric_sample", "wol_request", "icloud_range", "icloud_resource"}
            version = int(sql(f"SELECT MAX(CAST(version AS UNSIGNED)) FROM `{name}`.flyway_schema_history WHERE success=1;").strip())
            if version >= 9:
                expected.add("shortcut_icon")
            assert set(tables) == expected
            assert int(sql(f"SELECT COUNT(*) FROM `{name}`.app_document;")) >= 2
            assert sql(f"SELECT COUNT(*) FROM `{name}`.flyway_schema_history WHERE success=0;").strip() == "0"
            for table in tables:
                assert "OK" in sql(f"CHECK TABLE `{name}`.`{table}`;")
        print("Isolated restore and encryption authentication verified")
    finally:
        sql(f"DROP DATABASE `{name}`;")


def main():
    previous = signal.getsignal(signal.SIGTERM)
    def terminate(signum, frame):
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGTERM, terminate)
    try:
        backup(full_verify="--verify" in sys.argv)
    finally:
        signal.signal(signal.SIGTERM, previous)


if __name__ == "__main__":
    main()
