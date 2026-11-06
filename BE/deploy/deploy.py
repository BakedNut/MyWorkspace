"""Deploy locally built artifacts from the Proxmox host; keep previous releases."""
from pathlib import Path
import datetime
import hashlib
import io
import json
import subprocess
import tarfile
import time
from initialize import run, private_file


def deploy():
    root = Path(__file__).resolve().parents[2]
    jar = root / "BE/target/myworkspace-0.0.1-SNAPSHOT.jar"
    dist = root / "FE/dist"
    assert jar.is_file() and (dist / "index.html").is_file()
    digest = hashlib.sha256(jar.read_bytes()).hexdigest()[:12]
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    release = f"backend-{digest}-{stamp}"
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w:gz") as tar:
        tar.add(jar, arcname="backend.jar")
        tar.add(dist, arcname="frontend")
    program = "import sys,tarfile,pathlib; p=pathlib.Path('/tmp/myworkspace-deploy.tar.gz');p.write_bytes(sys.stdin.buffer.read());tarfile.open(p).extractall('/tmp/myworkspace-deploy',filter='data')"
    subprocess.run(["pct", "exec", "200", "--", "python3", "-c", program], input=archive.getvalue(), check=True, capture_output=True)
    old = run(200, ["sh", "-c", "readlink /opt/myworkspace/current.jar || true"]).strip()
    target = f"/opt/myworkspace/releases/{release}.jar"
    run(200, ["mkdir", "-p", "/opt/myworkspace/releases"])
    run(200, ["cp", "/tmp/myworkspace-deploy/backend.jar", target])
    run(200, ["chmod", "644", target])
    run(200, ["ln", "-sfn", target, "/opt/myworkspace/current.jar"])
    private_file(200, "/etc/systemd/system/myworkspace.service", (root / "BE/deploy/myworkspace.service").read_text(), 0o644)
    run(200, ["systemctl", "daemon-reload"])
    run(200, ["systemctl", "enable", "myworkspace"])
    run(200, ["systemctl", "restart", "myworkspace"])
    ready = False
    for attempt in range(90):
        try:
            status = run(200, ["curl", "--fail", "--silent", "--max-time", "1", "http://127.0.0.1:8080/api/health"])
            if json.loads(status).get("status") == "ok":ready = True;break
        except Exception:pass
        time.sleep(1)
    if not ready:
        if old:
            run(200, ["ln", "-sfn", old, "/opt/myworkspace/current.jar"])
            run(200, ["systemctl", "restart", "myworkspace"])
        raise SystemExit("Backend did not become ready; inspect the private service log.")
    frontend = f"/var/www/myworkspace/releases/{release}"
    run(200, ["cp", "-r", "/tmp/myworkspace-deploy/frontend", frontend])
    run(200, ["chmod", "-R", "a+rX", frontend])
    backup = f"/etc/nginx/nginx.conf.before-{release}"
    run(200, ["cp", "/etc/nginx/nginx.conf", backup])
    private_file(200, "/etc/nginx/nginx.conf", (root / "FE/deploy/nginx.conf").read_text(), 0o644)
    try:
        run(200, ["nginx", "-t"])
    except Exception:
        run(200, ["cp", backup, "/etc/nginx/nginx.conf"])
        raise
    run(200, ["ln", "-sfn", frontend, "/var/www/myworkspace/current"])
    run(200, ["systemctl", "reload", "nginx"])
    run(200, ["rm", "-rf", "/tmp/myworkspace-deploy", "/tmp/myworkspace-deploy.tar.gz"])
    print("Deployed", release)


if __name__ == "__main__":
    deploy()
