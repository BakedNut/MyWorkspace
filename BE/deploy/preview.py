"""Update the already provisioned LXC preview while preserving its data and config."""
from pathlib import Path
import datetime
import gzip
import fcntl
import hashlib
import json
import subprocess
import sys
import time
from initialize import run, private_file


LOCK_PATH = Path("/root/.local/state/myworkspace/preview-deploy.lock")
JAR = "/opt/myworkspace-preview/current.jar"
FRONTEND = "/var/www/myworkspace-preview/current"


def ready(port=8081):
    for attempt in range(90):
        try:
            response = run(200, ["curl", "--fail", "--silent", "--max-time", "1", f"http://127.0.0.1:{port}/api/health"])
            if json.loads(response).get("status") == "ok":
                return True
        except (subprocess.CalledProcessError, ValueError):
            pass
        time.sleep(1)
    return False


def backup(stamp):
    directory = Path("/root/.local/state/myworkspace/preview-backups")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = directory / ("myworkspace-preview-" + stamp + ".sql.gz")
    dump = run(202, ["mysqldump", "--defaults-extra-file=/root/.myworkspace.cnf", "--single-transaction", "--no-tablespaces", "--set-gtid-purged=OFF", "--column-statistics=0", "--hex-blob", "myworkspace_preview"])
    target.write_bytes(gzip.compress(dump.encode()))
    target.chmod(0o600)
    key = run(200, ["python3", "-c", "from pathlib import Path;import os;p=Path('/var/lib/myworkspace-preview/icloud-master.key');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW) if p.exists() else None;print(os.read(fd,33).hex() if fd is not None else '');fd is not None and os.close(fd)"]).strip()
    if key:
        value = bytes.fromhex(key)
        if len(value) != 32:
            raise RuntimeError("Invalid preview encryption key")
        target.with_suffix(".key").write_bytes(value)
        target.with_suffix(".key").chmod(0o600)
    return target


def replace(target, link, stamp):
    temporary = link + "." + stamp
    run(200, ["ln", "-s", target, temporary])
    run(200, ["mv", "-Tf", temporary, link])


def restore(previous_jar, previous_frontend, stamp):
    failures = []
    for target, path in ((previous_jar, JAR), (previous_frontend, FRONTEND)):
        try:
            replace(target, path, stamp + "-restore")
        except Exception as error:
            failures.append(f"{path}: {type(error).__name__}")
    try:
        run(200, ["systemctl", "restart", "myworkspace-preview"])
    except Exception as error:
        failures.append(f"backend restart: {type(error).__name__}")
    for port in (8081, 8088):
        try:
            if not ready(port):
                failures.append(f"port {port} readiness")
        except Exception as error:
            failures.append(f"port {port}: {type(error).__name__}")
    return failures


def deploy(root=None):
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with LOCK_PATH.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another preview deployment is already running") from None
        _deploy(root)


def _deploy(root=None):
    root = Path(root) if root is not None else Path(__file__).resolve().parents[2]
    jar = root / "BE/target/myworkspace-0.0.1-SNAPSHOT.jar"
    dist = root / "FE/dist"
    if not jar.is_file() or not (dist / "index.html").is_file():
        raise ValueError("Build BE and FE before updating the preview")
    previous_jar = run(200, ["readlink", JAR]).strip()
    previous_frontend = run(200, ["readlink", FRONTEND]).strip()
    if not previous_jar.startswith("/opt/myworkspace-preview/releases/") or not previous_frontend.startswith("/var/www/myworkspace-preview/releases/"):
        raise ValueError("Preview release links are not configured")
    for service in ("myworkspace-preview", "myworkspace-preview-web"):
        run(200, ["systemctl", "is-active", "--quiet", service])
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    snapshot = backup(stamp)
    release = "preview-" + commit[:12] + "-" + stamp
    target = "/opt/myworkspace-preview/releases/" + release + ".jar"
    frontend = "/var/www/myworkspace-preview/releases/" + release
    subprocess.run(["pct", "push", "200", str(jar), target, "--perms", "0644"], capture_output=True, check=True)
    if run(200, ["sha256sum", target]).split()[0] != hashlib.sha256(jar.read_bytes()).hexdigest():
        raise RuntimeError("Uploaded JAR checksum mismatch")
    run(200, ["install", "-d", "-m", "755", frontend])
    for path in dist.rglob("*"):
        destination = frontend + "/" + str(path.relative_to(dist))
        if path.is_dir():
            run(200, ["install", "-d", "-m", "755", destination])
        else:
            subprocess.run(["pct", "push", "200", str(path), destination, "--perms", "0644"], capture_output=True, check=True)
            if run(200, ["sha256sum", destination]).split()[0] != hashlib.sha256(path.read_bytes()).hexdigest():
                raise RuntimeError("Uploaded frontend checksum mismatch")
    try:
        replace(target, JAR, stamp)
        run(200, ["systemctl", "restart", "myworkspace-preview"])
        if not ready():
            raise RuntimeError("Preview backend did not become ready")
        replace(frontend, FRONTEND, stamp)
        if not ready(8088):
            raise RuntimeError("Preview web endpoint did not become ready")
    except BaseException as error:
        failures = restore(previous_jar, previous_frontend, stamp)
        if failures:
            raise RuntimeError("Preview rollback incomplete; backup at " + str(snapshot) + ": " + ", ".join(failures)) from error
        raise
    receipt = dict(commit=commit, release=release, jar=target, frontend=frontend, backup=str(snapshot), backendPort=8081, webPort=8088, database="myworkspace_preview")
    print("Preview deployed", commit)
    try:
        private_file(200, "/opt/myworkspace-preview/deployed-version.json", json.dumps(receipt, indent=2) + "\n")
    except Exception as error:
        print(f"Warning: release {commit} is active; server deployment record write failed ({type(error).__name__}).", file=sys.stderr)
    try:
        output = root / ".runtime/shortcuts-preview"
        output.mkdir(parents=True, exist_ok=True, mode=0o700)
        (output / "deployment.json").write_text(json.dumps(receipt, indent=2))
        (output / "deployment.json").chmod(0o600)
    except Exception as error:
        print(f"Warning: release {commit} is active; local deployment record write failed ({type(error).__name__}).", file=sys.stderr)


if __name__ == "__main__":
    deploy()
