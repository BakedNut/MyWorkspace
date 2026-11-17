"""Run in LXC 200 to read a key with the selected service's applied configuration."""
from pathlib import Path
import json
import os
import re
import shlex
import subprocess
import sys


SERVICE = "myworkspace-preview.service"
PROC = Path("/proc")


def service_property(name):
    return subprocess.run(["systemctl", "show", SERVICE, "--value", "-p", name],
                          capture_output=True, text=True, check=True).stdout.strip()


def configured_arguments():
    command = service_property("ExecStart")
    matches = re.findall(r"argv\[\]=(.*?) ; ignore_errors=", command)
    if len(matches) != 1:
        raise RuntimeError("Cannot resolve preview service command")
    return shlex.split(matches[0])


def java_command(jar, arguments, entrypoint):
    if not isinstance(arguments, list) or not arguments or not all(isinstance(arg, str) for arg in arguments):
        raise RuntimeError("Invalid preview service arguments")
    jar_index = arguments.index("-jar")
    for argument in arguments[1:jar_index]:
        if argument.startswith("@") or ("$" in argument and not argument.startswith("-D")):
            raise RuntimeError("Preview requires explicit JVM options; unresolved expansions and argument files are unsupported")
    if jar_index + 1 >= len(arguments) or "$" in arguments[jar_index + 1]:
        raise RuntimeError("Preview requires an explicit JVM jar argument")
    properties = [arg for arg in arguments[1:jar_index] if arg.startswith("-D")]
    return [arguments[0], "-Xms16m", "-Xmx64m", "-XX:MaxMetaspaceSize=96m", *properties,
            "-Dloader.main=" + entrypoint, "-cp", jar,
            "org.springframework.boot.loader.launch.PropertiesLauncher", *arguments[jar_index + 2:]]


def read_key(jar):
    pid = int(service_property("MainPID"))
    options = {}
    if pid:
        process = PROC / str(pid)
        environment = dict(item.split("=", 1) for item in os.fsdecode(
            (process / "environ").read_bytes()).split("\0") if "=" in item)
        arguments = [os.fsdecode(arg) for arg in (process / "cmdline").read_bytes().split(b"\0") if arg]
        identity = process.stat()
        groups = next(line.split()[1:] for line in (process / "status").read_text().splitlines()
                      if line.startswith("Groups:"))
        options = dict(env=environment, cwd=str((process / "cwd").resolve()),
                       user=identity.st_uid, group=identity.st_gid, extra_groups=[int(g) for g in groups])
        prefix = []
    else:
        arguments = configured_arguments()
        prefix = ["systemd-run", "--quiet", "--wait", "--pipe", "--collect",
                  "-p", "RuntimeMaxSec=30s"]
        for name in ("User", "Group", "WorkingDirectory"):
            value = service_property(name)
            if value:
                prefix.extend(["-p", name + "=" + value])
        environment = dict(os.environ)
        for assignment in shlex.split(service_property("Environment")):
            name, value = assignment.split("=", 1)
            environment[name] = value
            prefix.append("--setenv=" + name)
        options["env"] = environment
        files = service_property("EnvironmentFiles")
        entries = re.findall(r"(.+?) \(ignore_errors=(yes|no)\)(?:\s+|$)", files)
        if files and not entries:
            raise RuntimeError("Cannot resolve preview environment files")
        if entries:
            value = " ".join(("-" if optional == "yes" else "") + path.strip()
                             for path, optional in entries)
            prefix.extend(["-p", "EnvironmentFile=" + value])
    command = prefix + java_command(jar, arguments,
                                    "kr.myworkspace.common.database.PreviewKeyBackup")
    result = subprocess.run(command, capture_output=True, text=True, check=True, timeout=40, **options)
    lines = [line.removeprefix("PREVIEW_BACKUP_KEY=") for line in result.stdout.splitlines()
             if line.startswith("PREVIEW_BACKUP_KEY=")]
    if len(lines) != 1 or (lines[0] and not re.fullmatch(r"[0-9a-f]{64}", lines[0])):
        raise RuntimeError("Invalid preview key backup response")
    return lines[0]


if __name__ == "__main__":
    try:
        if len(sys.argv) > 2:
            SERVICE = sys.argv[2]
        if sys.argv[1] == "--service-arguments":
            print(json.dumps(configured_arguments()))
        else:
            print(read_key(sys.argv[1]))
    except Exception:
        raise SystemExit("Cannot read the service encryption key") from None
