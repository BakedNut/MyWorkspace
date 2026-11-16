"""Update the already provisioned LXC preview while preserving its data and config."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import unquote, urljoin, urlsplit
import datetime
import gzip
import fcntl
import hashlib
import json
import io
import shutil
import signal
import subprocess
import tempfile
import sys
import time
import threading
import zipfile
from initialize import run, private_file
from preview_key import java_command


WEB_URL = "http://127.0.0.1:8088"
FRONTEND_VERIFY_SECONDS = 30
LOCK_PATH = Path("/root/.local/state/myworkspace/preview-deploy.lock")
JAR = "/opt/myworkspace-preview/current.jar"
FRONTEND = "/var/www/myworkspace-preview/current"
DATABASE_GUARD = "/etc/systemd/system/myworkspace-preview.service.d/database-check.conf"
BACKUP_DIRECTORY = Path("/root/.local/state/myworkspace/preview-backups")


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


def verify_identity():
    responses = []
    for port in (8081, 8088):
        raw = run(200, ["curl", "--fail", "--silent", "--max-time", "3",
                        f"http://127.0.0.1:{port}/api/health/deployment"])
        try:
            value = json.loads(raw)
        except ValueError as error:
            raise RuntimeError("Invalid preview backend identity response") from error
        if (not isinstance(value, dict) or not isinstance(value.get("instance"), str)
                or not value["instance"] or value.get("previewDatabase") is not True):
            raise RuntimeError("Preview backend identity or database mismatch")
        responses.append(value)
    if responses[0]["instance"] != responses[1]["instance"]:
        raise RuntimeError("Preview backend identity mismatch")
    return responses[0]


class FrontendAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == "script" and attrs.get("src"):
            self.urls.append((attrs["src"], "javascript"))
        if tag == "link" and attrs.get("rel") in ("modulepreload", "stylesheet") and attrs.get("href"):
            kind = "javascript" if attrs["rel"] == "modulepreload" else "css"
            self.urls.append((attrs["href"], kind))


def frontend_manifest(dist):
    dist = dist.resolve()
    index = dist / "index.html"
    parser = FrontendAssets()
    parser.feed(index.read_text())
    files = {"/": (index, "html"), "/build-info.json": (dist / "build-info.json", "json")}
    for reference, kind in parser.urls:
        url = urlsplit(urljoin("/", reference))
        if url.scheme or url.netloc:
            continue
        path = (dist / unquote(url.path).lstrip("/")).resolve()
        if not path.is_relative_to(dist) or not path.is_file():
            raise ValueError("Referenced frontend asset is missing: " + reference)
        files[url.path + ("?" + url.query if url.query else "")] = (path, kind)
    for path in dist.rglob("*"):
        if path.is_file() and path.suffix in (".js", ".mjs", ".css"):
            kind = "css" if path.suffix == ".css" else "javascript"
            files.setdefault("/" + path.relative_to(dist).as_posix(), (path, kind))
    return {url: {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "kind": kind, "size": path.stat().st_size}
            for url, (path, kind) in files.items()}


def verify_frontend(expected):
    program = """import email.message,hashlib,json,sys,urllib.request,urllib.parse

def origin(url):
    parsed = urllib.parse.urlsplit(url)
    port = parsed.port
    if port is None:
        port = 443 if parsed.scheme=='https' else 80
    return parsed.scheme,parsed.hostname,port

class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,request,fp,code,message,headers,new_url):
        if origin(request.full_url)!=origin(new_url):
            raise RuntimeError('Cross-origin frontend redirect: '+request.full_url)
        current_directory = urllib.parse.urlsplit(urllib.parse.urljoin(request.full_url,'.')).path
        next_directory = urllib.parse.urlsplit(urllib.parse.urljoin(new_url,'.')).path
        if current_directory!=next_directory:
            raise RuntimeError('Frontend redirect changes relative dependency directory: '+request.full_url)
        return super().redirect_request(request,fp,code,message,headers,new_url)

opener = urllib.request.build_opener(SameOriginRedirect())
javascript_types = {
    'application/ecmascript','application/javascript','application/x-ecmascript','application/x-javascript',
    'text/ecmascript','text/javascript','text/javascript1.0','text/javascript1.1','text/javascript1.2',
    'text/javascript1.3','text/javascript1.4','text/javascript1.5','text/jscript','text/livescript',
    'text/x-ecmascript','text/x-javascript'
}
allowed_types = {'html': {'text/html'}, 'css': {'text/css'}, 'javascript': javascript_types, 'json': {'application/json'}}
utf8_labels = {'unicode-1-1-utf-8','unicode11utf8','unicode20utf8','utf-8','utf8','x-unicode20utf8'}
for path,asset in json.loads(sys.argv[2]).items():
    with opener.open(sys.argv[1]+path,timeout=5) as response:
        if path=='/' and urllib.parse.urlsplit(response.geturl()).path!='/':
            raise RuntimeError('Frontend home redirect changes app route: '+response.geturl())
        headers = response.headers.get_all('Content-Type') or []
        media_type = headers[-1].split(';',1)[0].strip().lower() if headers else ''
        if media_type not in allowed_types[asset['kind']]:
            raise RuntimeError('Invalid Content-Type for '+asset['kind']+': '+path)
        if asset['kind'] in ('html','css','json'):
            for header in headers:
                parsed = email.message.Message()
                parsed['Content-Type'] = header
                for name,value in (parsed.get_params() or [])[1:]:
                    if name.lower()=='charset' and (not isinstance(value,str) or value.strip().lower() not in utf8_labels):
                        raise RuntimeError(asset['kind'].upper()+' charset does not match UTF-8 build: '+path)
        encodings = response.headers.get_all('Content-Encoding') or []
        if any(value.strip().lower()!='identity' for value in encodings):
            raise RuntimeError('Unsupported frontend Content-Encoding: '+path)
        data = response.read(asset['size']+1)
        if len(data)!=asset['size']:
            raise RuntimeError('Served frontend size mismatch: '+path)
        for header in response.headers.get_all('Content-Length') or []:
            for value in header.split(','):
                value = value.strip()
                if not value.isdecimal() or int(value)!=len(data):
                    raise RuntimeError('Served frontend Content-Length mismatch: '+path)
        if hashlib.sha256(data).hexdigest()!=asset['sha256']:
            raise RuntimeError('Served frontend content mismatch: '+path)
"""
    run(200, ["timeout", "--kill-after=2s", f"{FRONTEND_VERIFY_SECONDS}s", "python3", "-c", program, WEB_URL, json.dumps(expected)])


def build_metadata(root, jar, dist):
    try:
        jar_bytes = jar.read_bytes()
        with zipfile.ZipFile(io.BytesIO(jar_bytes)) as archive:
            properties = dict(line.split("=", 1) for line in
                              archive.read("BOOT-INF/classes/git.properties").decode().splitlines()
                              if line.startswith("git."))
        backend_commit = properties["git.commit.id.full"]
        backend_dirty = properties["git.dirty"]
        frontend = json.loads((dist / "build-info.json").read_text())
        if backend_dirty not in ("true", "false") or type(frontend["dirty"]) is not bool:
            raise ValueError("Invalid build flags")
        frontend_commit = frontend["commit"]
        if frontend.get("apiMode") != "rest":
            raise ValueError("Preview deployment requires a real API frontend build")
        files = {path.relative_to(dist).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                 for path in dist.rglob("*") if path.is_file() and path != dist / "build-info.json"}
        if frontend["files"] != files:
            raise ValueError("Frontend files do not match the build manifest")
    except (OSError, KeyError, ValueError, zipfile.BadZipFile) as error:
        raise ValueError("Build metadata is missing or invalid; rebuild BE and FE") from error
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    if backend_commit != commit or frontend_commit != commit:
        raise ValueError("Build commit does not match current checkout; rebuild BE and FE")
    return dict(commit=commit, backendDirty=backend_dirty == "true", frontendDirty=frontend["dirty"], frontendApiMode=frontend["apiMode"],
                backendSha256=hashlib.sha256(jar_bytes).hexdigest())


def backup(stamp, jar):
    directory = BACKUP_DIRECTORY
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = directory / ("myworkspace-preview-" + stamp + ".sql.gz")
    dump = run(202, ["mysqldump", "--defaults-extra-file=/root/.myworkspace.cnf", "--single-transaction", "--no-tablespaces", "--set-gtid-purged=OFF", "--column-statistics=0", "--hex-blob", "myworkspace_preview"])
    mysql = ["mysql", "--defaults-extra-file=/root/.myworkspace.cnf", "--batch", "--skip-column-names", "-e"]
    table = run(202, [*mysql, "SELECT COUNT(*) FROM information_schema.tables WHERE "
                     "table_schema='myworkspace_preview' AND table_name='app_document';"]).strip()
    if table not in ("0", "1"):
        raise RuntimeError("Cannot inspect preview backup schema")
    required = "0"
    if table == "1":
        required = run(202, [*mysql,
            "SELECT COUNT(*) FROM myworkspace_preview.app_document WHERE "
            "(id='icloud' AND JSON_TYPE(JSON_EXTRACT(payload,'$.encryptedCredentials'))='STRING') OR "
            "(id='security-settings' AND (JSON_TYPE(JSON_EXTRACT(payload,'$.otpSecret'))='STRING' OR "
            "JSON_TYPE(JSON_EXTRACT(payload,'$.pendingSecret'))='STRING'));" ]).strip()
    if not required.isdecimal():
        raise RuntimeError("Cannot determine whether preview encryption keys are required")
    program = Path(__file__).with_name("preview_key.py").read_text()
    key = run(200, ["python3", "-c", program, jar]).strip()
    try:
        value = bytes.fromhex(key)
    except ValueError:
        raise RuntimeError("Invalid preview encryption key") from None
    if (value and len(value) != 32) or (int(required) and not value):
        raise RuntimeError("Preview backup requires the service encryption key")
    with tempfile.TemporaryDirectory(prefix="key-backup-", dir=directory) as temporary:
        staged = Path(temporary) / "database.sql.gz"
        staged.write_bytes(gzip.compress(dump.encode()))
        staged.chmod(0o600)
        if value:
            staged_key = Path(temporary) / "database.key"
            staged_key.write_bytes(value)
            staged_key.chmod(0o600)
            staged_key.replace(target.with_suffix(".key"))
        staged.replace(target)
    return target


def replace(target, link, stamp):
    temporary = link + "." + stamp
    run(200, ["ln", "-s", target, temporary])
    run(200, ["mv", "-Tf", temporary, link])


def restore(previous_jar, previous_frontend, stamp, previous_guard, backend_active=True, web_active=True):
    failures = []
    for target, path in ((previous_jar, JAR), (previous_frontend, FRONTEND)):
        try:
            replace(target, path, stamp + "-restore")
        except Exception as error:
            failures.append(f"{path}: {type(error).__name__}")
    try:
        if previous_guard is None:
            run(200, ["rm", "-f", DATABASE_GUARD])
        else:
            private_file(200, DATABASE_GUARD, previous_guard, 0o600)
    except Exception as error:
        failures.append(f"database guard: {type(error).__name__}")
    try:
        run(200, ["systemctl", "daemon-reload"])
    except Exception as error:
        failures.append(f"daemon-reload: {type(error).__name__}")
    services = [("myworkspace-preview", "restart" if backend_active else "stop")]
    if not web_active:
        services.append(("myworkspace-preview-web", "stop"))
    for service, action in services:
        try:
            run(200, ["systemctl", action, service])
        except Exception as error:
            failures.append(f"{service} {action}: {type(error).__name__}")
    ports = [8081] if backend_active else []
    if backend_active and web_active:
        ports.append(8088)
    for port in ports:
        try:
            if not ready(port):
                failures.append(f"port {port} readiness")
        except Exception as error:
            failures.append(f"port {port}: {type(error).__name__}")
    return failures


def service_active(service):
    try:
        run(200, ["systemctl", "is-active", "--quiet", service])
        return True
    except subprocess.CalledProcessError as error:
        if error.returncode != 3:
            raise
        return False


def deploy(root=None):
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with LOCK_PATH.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another preview deployment is already running") from None
        with tempfile.TemporaryDirectory(prefix="myworkspace-preview-") as directory:
            _deploy(root, Path(directory) / "frontend")


def read_database_guard():
    program = "import json,pathlib,sys;p=pathlib.Path(sys.argv[1]);print(json.dumps(p.read_text() if p.exists() else None))"
    return json.loads(run(200, ["python3", "-c", program, DATABASE_GUARD]))


def configure_database_guard(jar):
    # Read the loaded command after applying pending unit changes.
    run(200, ["systemctl", "daemon-reload"])
    program = Path(__file__).with_name("preview_key.py").read_text()
    arguments = json.loads(run(200, ["python3", "-c", program, "--service-arguments"]))
    command = java_command(jar, arguments, "kr.myworkspace.common.database.PreviewDatabaseCheck")
    # Preserve argument boundaries and literal unit specifiers in the generated unit.
    encoded = " ".join(json.dumps(arg.replace("%", "%%"), ensure_ascii=False) for arg in command)
    private_file(200, DATABASE_GUARD,
                 "[Service]\nExecStartPre=" + encoded + "\n", 0o600)
    run(200, ["systemctl", "daemon-reload"])


def _deploy(root, frontend_snapshot):
    root = Path(root) if root is not None else Path(__file__).resolve().parents[2]
    jar = root / "BE/target/myworkspace-0.0.1-SNAPSHOT.jar"
    dist = root / "FE/dist"
    if not jar.is_file() or not (dist / "index.html").is_file():
        raise ValueError("Build BE and FE before updating the preview")
    # Keep build metadata and every uploaded file together across local rebuilds.
    shutil.copytree(dist, frontend_snapshot)
    dist = frontend_snapshot
    build = build_metadata(root, jar, dist)
    expected_frontend = frontend_manifest(dist)
    frontend_hashes = {path.relative_to(dist): hashlib.sha256(path.read_bytes()).hexdigest()
                       for path in dist.rglob("*") if path.is_file()}
    previous_jar = run(200, ["readlink", JAR]).strip()
    previous_frontend = run(200, ["readlink", FRONTEND]).strip()
    if not previous_jar.startswith("/opt/myworkspace-preview/releases/") or not previous_frontend.startswith("/var/www/myworkspace-preview/releases/"):
        raise ValueError("Preview release links are not configured")
    backend_active = service_active("myworkspace-preview")
    web_active = service_active("myworkspace-preview-web")
    commit = build["commit"]
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    release = "preview-" + commit[:12] + "-" + stamp
    target = "/opt/myworkspace-preview/releases/" + release + ".jar"
    frontend = "/var/www/myworkspace-preview/releases/" + release
    subprocess.run(["pct", "push", "200", str(jar), target, "--perms", "0644"], capture_output=True, check=True)
    if run(200, ["sha256sum", target]).split()[0] != build["backendSha256"]:
        raise RuntimeError("Uploaded JAR checksum mismatch")
    snapshot = backup(stamp, target)
    run(200, ["install", "-d", "-m", "755", frontend])
    for path in dist.rglob("*"):
        destination = frontend + "/" + str(path.relative_to(dist))
        if path.is_dir():
            run(200, ["install", "-d", "-m", "755", destination])
        else:
            subprocess.run(["pct", "push", "200", str(path), destination, "--perms", "0644"], capture_output=True, check=True)
            if run(200, ["sha256sum", destination]).split()[0] != frontend_hashes[path.relative_to(dist)]:
                raise RuntimeError("Uploaded frontend checksum mismatch")
    previous_guard = read_database_guard()
    try:
        configure_database_guard(target)
        replace(target, JAR, stamp)
        run(200, ["systemctl", "restart", "myworkspace-preview"])
        if not ready():
            raise RuntimeError("Preview backend did not become ready")
        if not web_active:
            run(200, ["systemctl", "start", "myworkspace-preview-web"])
            if not ready(8088):
                raise RuntimeError("Preview web endpoint did not become ready")
        verify_identity()
        replace(frontend, FRONTEND, stamp)
        if not ready(8088):
            raise RuntimeError("Preview web endpoint did not become ready")
        identity = verify_identity()
        verify_frontend(expected_frontend)
    except BaseException as error:
        handles_signals = threading.current_thread() is threading.main_thread()
        previous_handler = signal.getsignal(signal.SIGTERM) if handles_signals else None
        try:
            if handles_signals:
                signal.signal(signal.SIGTERM, signal.SIG_IGN)
            failures = restore(previous_jar, previous_frontend, stamp, previous_guard, backend_active, web_active)
        finally:
            if handles_signals:
                signal.signal(signal.SIGTERM, previous_handler)
        if failures:
            raise RuntimeError("Preview rollback incomplete; backup at " + str(snapshot) + ": " + ", ".join(failures)) from error
        raise
    receipt = dict(**build, release=release, jar=target, frontend=frontend, backup=str(snapshot), backendPort=8081, webPort=8088, database="myworkspace_preview", backendInstance=identity["instance"])
    print("Preview deployed", commit, "dirty=" + str(build["backendDirty"] or build["frontendDirty"]).lower())
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


def main():
    previous = signal.getsignal(signal.SIGTERM)

    def terminate(signum, frame):
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        raise SystemExit(128 + signum)

    try:
        signal.signal(signal.SIGTERM, terminate)
        deploy()
    finally:
        signal.signal(signal.SIGTERM, previous)


if __name__ == "__main__":
    main()
