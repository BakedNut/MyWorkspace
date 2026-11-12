"""Deploy a release and restore BE, FE, service and Nginx together on failure."""
from pathlib import Path
import datetime
import hashlib
import io
import json
import subprocess
import tarfile
import time
from initialize import run, private_file


JAR_LINK = "/opt/myworkspace/current.jar"
FE_LINK = "/var/www/myworkspace/current"
NGINX = "/etc/nginx/nginx.conf"
SERVICE = "/etc/systemd/system/myworkspace.service"


def link(path):
    return run(200, ["sh", "-c", f"readlink {path} || true"]).strip()


def active(service):
    return run(200, ["sh", "-c", f"systemctl is-active --quiet {service} && echo yes || true"]).strip() == "yes"


def ready():
    for attempt in range(90):
        try:
            value = run(200, ["curl", "--fail", "--silent", "--max-time", "1", "http://127.0.0.1:8080/api/health"])
            if json.loads(value).get("status") == "ok":
                return True
        except (subprocess.CalledProcessError, ValueError):
            pass
        time.sleep(1)
    return False


def restore(previous, staging):
    """Attempt every restoration step, even if an earlier step fails."""
    commands = [["sh", "-c", f"systemctl stop myworkspace || test ! -f {SERVICE}"]]
    if not previous["enabled"]:
        commands.append(["sh", "-c", f"if test -f {SERVICE}; then systemctl disable myworkspace; fi"])
    for path, old in [(JAR_LINK, previous["jar"]), (FE_LINK, previous["frontend"])]:
        commands.append(["ln", "-sfn", old, path] if old else ["rm", "-f", path])
    commands.append(["cp", "-a", staging + "/nginx.before", NGINX])
    commands.append(["cp", "-a", staging + "/service.before", SERVICE] if previous["service"] else ["rm", "-f", SERVICE])
    commands.append(["systemctl", "daemon-reload"])
    if previous["enabled"]:
        commands.append(["systemctl", "enable", "myworkspace"])
    if previous["active"]:
        commands.append(["systemctl", "restart", "myworkspace"])
    if previous["nginx_active"]:
        commands.extend([["nginx", "-t"], ["systemctl", "reload", "nginx"]])
    failures = []
    for command in commands:
        try:
            run(200, command)
        except Exception as error:
            failures.append(f"{command[0]}: {type(error).__name__}")
    if previous["active"] and not ready():
        failures.append("previous backend readiness")
    return failures


def deploy(root=None):
    root = Path(root) if root is not None else Path(__file__).resolve().parents[2]
    jar = root / "BE/target/myworkspace-0.0.1-SNAPSHOT.jar"
    dist = root / "FE/dist"
    if not jar.is_file() or not (dist / "index.html").is_file():
        raise ValueError("Build the backend and frontend before deployment")
    digest = hashlib.sha256(jar.read_bytes()).hexdigest()[:12]
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    release = f"backend-{digest}-{stamp}"
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w:gz") as tar:
        tar.add(jar, arcname="backend.jar")
        tar.add(dist, arcname="frontend")
    program = """import io,sys,tarfile,tempfile,shutil
staging=tempfile.mkdtemp(prefix='myworkspace-deploy-',dir='/run')
try:
    with tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read())) as archive:
        archive.extractall(staging,filter='data')
except BaseException:
    shutil.rmtree(staging)
    raise
print(staging)
"""
    uploaded = subprocess.run(["pct", "exec", "200", "--", "python3", "-c", program], input=archive.getvalue(), check=True, capture_output=True)
    staging = uploaded.stdout.decode().strip()
    if not staging.startswith("/run/myworkspace-deploy-") or "/" in staging.removeprefix("/run/"):
        raise ValueError("Invalid deployment staging path")
    target = f"/opt/myworkspace/releases/{release}.jar"
    frontend = f"/var/www/myworkspace/releases/{release}"
    cleanup = True
    try:
        previous = {
            "jar": link(JAR_LINK),
            "frontend": link(FE_LINK),
            "active": active("myworkspace"),
            "nginx_active": active("nginx"),
            "enabled": run(200, ["sh", "-c", "systemctl is-enabled --quiet myworkspace && echo yes || true"]).strip() == "yes",
            "service": run(200, ["sh", "-c", f"test -f {SERVICE} && echo yes || true"]).strip() == "yes",
        }
        run(200, ["cp", "-a", NGINX, staging + "/nginx.before"])
        if previous["service"]:
            run(200, ["cp", "-a", SERVICE, staging + "/service.before"])
        run(200, ["mkdir", "-p", "/opt/myworkspace/releases", "/var/www/myworkspace/releases"])
        run(200, ["cp", staging + "/backend.jar", target])
        run(200, ["chmod", "644", target])
        run(200, ["cp", "-r", staging + "/frontend", frontend])
        run(200, ["chmod", "-R", "a+rX", frontend])
        try:
            private_file(200, NGINX, (root / "FE/deploy/nginx.conf").read_text(), 0o644)
            run(200, ["nginx", "-t"])
            private_file(200, SERVICE, (root / "BE/deploy/myworkspace.service").read_text(), 0o644)
            run(200, ["systemctl", "daemon-reload"])
            run(200, ["ln", "-sfn", target, JAR_LINK])
            run(200, ["systemctl", "enable", "myworkspace"])
            run(200, ["systemctl", "restart", "myworkspace"])
            if not ready():
                raise RuntimeError("Backend did not become ready")
            run(200, ["ln", "-sfn", frontend, FE_LINK])
            run(200, ["systemctl", "reload", "nginx"])
        except BaseException as error:
            failures = restore(previous, staging)
            if failures:
                cleanup = False
                raise RuntimeError("Deployment failed; rollback incomplete; backups retained at " + staging + ": " + ", ".join(failures)) from error
            raise
    finally:
        if cleanup:
            run(200, ["rm", "-rf", staging])
    print("Deployed", release)


if __name__ == "__main__":
    deploy()
