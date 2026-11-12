"""Install the host sensor authorization in a root-controlled SSH directory."""
import os
from pathlib import Path
import secrets
import stat
from sensor_key import public_key


def controlled_directory(path, uid, gid, parent=None):
    try:
        os.mkdir(path, mode=0o750, dir_fd=parent)
    except FileExistsError:
        pass
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    try:
        info = os.fstat(descriptor)
        if info.st_uid not in (0, uid):
            raise ValueError("Unexpected sensor directory owner")
        os.fchown(descriptor, 0, gid)
        os.fchmod(descriptor, 0o750)
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def install_authorized_key(home, uid, gid, public):
    public = public_key(public)
    home = Path(home)
    parent = home.parent.stat()
    if parent.st_uid != 0 or parent.st_mode & 0o022:
        raise ValueError("Sensor home parent must be root-controlled")
    home_fd = controlled_directory(home, uid, gid)
    try:
        ssh_fd = controlled_directory(".ssh", uid, gid, home_fd)
        try:
            try:
                info = os.stat("authorized_keys", dir_fd=ssh_fd, follow_symlinks=False)
            except FileNotFoundError:
                info = None
            if info is not None and (not stat.S_ISREG(info.st_mode) or info.st_uid not in (0, uid) or info.st_nlink != 1):
                raise ValueError("Authorization must be a single regular file")
            temporary = ".authorized_keys-" + secrets.token_hex(16)
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o640, dir_fd=ssh_fd)
            try:
                with os.fdopen(descriptor, "w") as output:
                    os.fchown(output.fileno(), 0, gid)
                    os.fchmod(output.fileno(), 0o640)
                    output.write('from="192.168.1.200",restrict,command="/usr/local/libexec/myworkspace-sensors" ' + public + "\n")
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, "authorized_keys", src_dir_fd=ssh_fd, dst_dir_fd=ssh_fd)
                os.fsync(ssh_fd)
            finally:
                try:
                    os.unlink(temporary, dir_fd=ssh_fd)
                except FileNotFoundError:
                    pass
        finally:
            os.close(ssh_fd)
    finally:
        os.close(home_fd)
