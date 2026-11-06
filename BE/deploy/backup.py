#!/usr/bin/python3
"""Daily root-only database backup to the host; optional isolated restore check."""
from pathlib import Path
import datetime
import gzip
import os
import re
import subprocess
import sys
import uuid

os.umask(0o077)
directory = Path("/root/.local/state/myworkspace/backups")
directory.mkdir(parents=True, exist_ok=True, mode=0o700)
mysql = ["pct", "exec", "202", "--", "mysql", "--defaults-extra-file=/root/.myworkspace.cnf", "--batch", "--skip-column-names"]


def sql(statement):
    return subprocess.run(mysql, input=statement, text=True, capture_output=True, check=True).stdout


def backup():
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = directory / ("myworkspace-" + stamp + ".sql.gz")
    temporary = target.with_suffix(".partial")
    process = subprocess.Popen(["pct", "exec", "202", "--", "mysqldump", "--defaults-extra-file=/root/.myworkspace.cnf",
        "--single-transaction", "--no-tablespaces", "--set-gtid-purged=OFF", "--column-statistics=0", "myworkspace"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        with gzip.open(temporary, "wb") as output:
            while chunk := process.stdout.read(1024 * 1024):output.write(chunk)
        process.wait(timeout=60)
        if process.returncode:raise RuntimeError("Database backup failed; inspect the private backup service log.")
        temporary.replace(target)
    finally:
        if process.poll() is None:process.kill()
        temporary.unlink(missing_ok=True)
    for old in sorted(directory.glob("myworkspace-*.sql.gz"))[:-14]:old.unlink()
    print("Backup saved:", target)
    return target


def verify(target):
    name = "myworkspace_restore_" + uuid.uuid4().hex[:12]
    assert re.fullmatch(r"myworkspace_restore_[0-9a-f]{12}", name)
    sql(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;")
    try:
        with gzip.open(target, "rb") as source:
            process = subprocess.Popen([*mysql, name], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            try:
                while chunk := source.read(1024 * 1024):process.stdin.write(chunk)
                process.stdin.close();process.wait(timeout=90)
                if process.returncode:raise RuntimeError("Isolated restore failed")
            finally:
                if process.poll() is None:process.kill()
        tables = sql(f"SHOW TABLES FROM `{name}`;").splitlines()
        assert set(tables) == {"app_document", "calendar_event", "flyway_schema_history", "metric_sample", "wol_request"}
        assert int(sql(f"SELECT COUNT(*) FROM `{name}`.app_document;")) >= 2
        assert sql(f"SELECT COUNT(*) FROM `{name}`.flyway_schema_history WHERE success=0;").strip() == "0"
        for table in tables:
            assert "OK" in sql(f"CHECK TABLE `{name}`.`{table}`;")
        print("Isolated restore verified; production database was not overwritten.")
    finally:
        sql(f"DROP DATABASE `{name}`;")


if __name__ == "__main__":
    target = backup()
    if "--verify" in sys.argv:verify(target)
