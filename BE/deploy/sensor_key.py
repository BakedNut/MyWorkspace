"""Prepare a root-owned, application-readable sensor key inside LXC 200."""
import base64
import grp
import os
from pathlib import Path
import stat
import subprocess
import tempfile


def public_key(value):
    if len(value.splitlines()) != 1:
        raise ValueError("Expected one public key record")
    fields = value.split()
    if len(fields) < 2 or fields[0] != "ssh-ed25519":
        raise ValueError("Expected an Ed25519 public key without options")
    decoded = base64.b64decode(fields[1], validate=True)
    if decoded[:19] != b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20" or len(decoded) != 51:
        raise ValueError("Invalid Ed25519 public key")
    return " ".join(fields[:2])


def prepare_key(directory, group):
    directory = Path(directory)
    directory.mkdir(mode=0o750, exist_ok=True)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError("Sensor key directory must be root-controlled")
    os.chown(directory, 0, group, follow_symlinks=False)
    directory.chmod(0o750)
    key = directory / "key"
    if key.is_symlink():
        raise ValueError("Sensor key must not be a symbolic link")
    if not key.exists():
        with tempfile.TemporaryDirectory(dir=directory) as temporary:
            generated = Path(temporary) / "key"
            subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(generated)], check=True)
            os.replace(generated, key)
    descriptor = os.open(key, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1:
            raise ValueError("Sensor key must be a root-owned regular file")
        os.fchown(descriptor, 0, group)
        os.fchmod(descriptor, 0o600)
        try:
            value = subprocess.run(["ssh-keygen", "-y", "-P", "", "-f", str(key)], check=True, capture_output=True, text=True).stdout
            return public_key(value.rstrip("\n"))
        finally:
            os.fchmod(descriptor, 0o640)
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    print(prepare_key("/etc/myworkspace/sensors", grp.getgrnam("myworkspace").gr_gid))
