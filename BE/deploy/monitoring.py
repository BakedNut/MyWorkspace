"""Install read-only Proxmox access; run on the Proxmox host as root."""
from pathlib import Path
import json
import os
import pwd
import subprocess
from initialize import run, private_file


def host(args):
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout


def configure():
    run(200, ["sh", "-c", "id myworkspace >/dev/null 2>&1 || useradd --system --home-dir /var/lib/myworkspace --create-home --shell /sbin/nologin myworkspace"])
    config = run(200, ["cat", "/etc/myworkspace/application.env"])
    if "PROXMOX_TOKEN=" not in config:
        users = json.loads(host(["pvesh", "get", "/access/users", "--output-format", "json"]))
        user = "myworkspace-monitor@pve"
        if not any(u["userid"] == user for u in users):
            host(["pveum", "user", "add", user, "--comment", "MyWorkspace read-only monitoring"])
        host(["pveum", "acl", "modify", "/", "--users", user, "--roles", "PVEAuditor"])
        token = json.loads(host(["pveum", "user", "token", "add", user, "dashboard", "--privsep", "1", "--output-format", "json"]))
        host(["pveum", "acl", "modify", "/", "--tokens", user + "!dashboard", "--roles", "PVEAuditor"])
        config += "PROXMOX_URL=https://192.168.1.110:8006\nPROXMOX_NODE=proxmox\nPROXMOX_TOKEN=" + token["full-tokenid"] + "=" + token["value"] + "\n"
    private_file(200, "/etc/myworkspace/proxmox-ca.pem", Path("/etc/pve/pve-root-ca.pem").read_text(), 0o644)
    mysqlca = run(202, ["cat", "/var/lib/mysql/ca.pem"])
    private_file(200, "/etc/myworkspace/mysql-ca.pem", mysqlca, 0o644)
    run(200, ["sh", "-c", "test -f /etc/myworkspace/truststore.jks || cp /etc/pki/java/cacerts /etc/myworkspace/truststore.jks"])
    for alias, path in [("myworkspace-proxmox", "proxmox-ca.pem"), ("myworkspace-mysql", "mysql-ca.pem")]:
        run(200, ["sh", "-c", f"keytool -list -keystore /etc/myworkspace/truststore.jks -storepass changeit -alias {alias} >/dev/null 2>&1 || keytool -importcert -noprompt -alias {alias} -file /etc/myworkspace/{path} -keystore /etc/myworkspace/truststore.jks -storepass changeit"])
    run(200, ["chmod", "644", "/etc/myworkspace/truststore.jks"])
    config = config.replace("sslMode=PREFERRED&allowPublicKeyRetrieval=true", "sslMode=VERIFY_CA&trustCertificateKeyStoreUrl=file:/etc/myworkspace/truststore.jks&trustCertificateKeyStoreType=JKS&trustCertificateKeyStorePassword=changeit")
    try:
        account = pwd.getpwnam("myworkspace-sensors")
    except KeyError:
        host(["useradd", "--system", "--create-home", "--home-dir", "/var/lib/myworkspace-sensors", "--shell", "/bin/sh", "myworkspace-sensors"])
        account = pwd.getpwnam("myworkspace-sensors")
    sensor = Path("/usr/local/libexec/myworkspace-sensors")
    sensor.parent.mkdir(parents=True, exist_ok=True)
    sensor.write_text(Path(__file__).with_name("sensors.py").read_text());sensor.chmod(0o755)
    from sensor_key import public_key
    public = public_key(run(200, ["python3", "-c", Path(__file__).with_name("sensor_key.py").read_text()]).rstrip("\n"))
    ssh = Path(account.pw_dir) / ".ssh";ssh.mkdir(exist_ok=True, mode=0o700)
    authorized = ssh / "authorized_keys"
    authorized.write_text('from="192.168.1.200",restrict,command="/usr/local/libexec/myworkspace-sensors" ' + public + "\n")
    authorized.chmod(0o600)
    for path in [ssh, authorized]:os.chown(path, account.pw_uid, account.pw_gid)
    hostkey = Path("/etc/ssh/ssh_host_ed25519_key.pub").read_text().split()
    private_file(200, "/etc/myworkspace/sensor-known-hosts", "192.168.1.110 " + " ".join(hostkey[:2]) + "\n", 0o644)
    config = "\n".join(line for line in config.splitlines() if not line.startswith("SENSOR_KEY=")) + "\nSENSOR_KEY=/etc/myworkspace/sensors/key\n"
    private_file(200, "/etc/myworkspace/application.env", config)
    result = run(200, ["runuser", "-u", "myworkspace", "--", "ssh", "-F", "/dev/null", "-i", "/etc/myworkspace/sensors/key", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=/etc/myworkspace/sensor-known-hosts", "myworkspace-sensors@192.168.1.110"])
    assert "netin" in json.loads(result)
    print("Read-only monitoring and certificate verification configured; sensor access verified.")


if __name__ == "__main__":
    configure()
