"""Run on the Proxmox host as root. Secrets stay in root-only server files."""
from pathlib import Path
import bcrypt
import json
import secrets
import subprocess


def run(ct, args, data=None):
    return subprocess.run(["pct", "exec", str(ct), "--", *args], input=data,
                          text=True, capture_output=True, check=True).stdout


def private_file(ct, path, text, mode=0o600):
    program = "import pathlib,sys,os;p=pathlib.Path(sys.argv[1]);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(sys.stdin.read());p.chmod(int(sys.argv[2]))"
    run(ct, ["python3", "-c", program, path, str(mode)], text)


def initialize():
    # Refuse to initialize any existing database or overwrite existing credentials.
    if run(202, ["find", "/var/lib/mysql", "-mindepth", "1", "-maxdepth", "1"]).strip():
        raise SystemExit("MySQL data already exists; inspect it before running initialization.")
    root = secrets.token_urlsafe(36)
    runtime = secrets.token_urlsafe(36)
    migration = secrets.token_urlsafe(36)
    password = secrets.token_urlsafe(24)
    private_file(202, "/etc/my.cnf.d/myworkspace.cnf", """[mysqld]
bind-address=192.168.1.202
mysqlx=OFF
innodb_buffer_pool_size=128M
innodb_log_buffer_size=8M
innodb_redo_log_capacity=64M
max_connections=20
performance_schema=OFF
table_open_cache=200
tmp_table_size=16M
max_heap_table_size=16M
skip_name_resolve=ON
binlog_expire_logs_seconds=259200
""", 0o644)
    run(202, ["mysqld", "--validate-config"])
    run(202, ["systemctl", "enable", "--now", "mysqld"])
    log = run(202, ["cat", "/var/log/mysqld.log"])
    temporary = next(line.split("root@localhost: ", 1)[1] for line in reversed(log.splitlines()) if "temporary password" in line)
    private_file(202, "/run/myworkspace-initial.cnf", "[client]\nuser=root\npassword=" + temporary + "\n")
    sql = f"""ALTER USER 'root'@'localhost' IDENTIFIED BY '{root}';
CREATE DATABASE myworkspace CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'myworkspace'@'192.168.1.200' IDENTIFIED BY '{runtime}';
CREATE USER 'myworkspace_migrate'@'192.168.1.200' IDENTIFIED BY '{migration}';
GRANT SELECT,INSERT,UPDATE,DELETE ON myworkspace.* TO 'myworkspace'@'192.168.1.200';
GRANT ALL PRIVILEGES ON myworkspace.* TO 'myworkspace_migrate'@'192.168.1.200';
"""
    run(202, ["mysql", "--defaults-extra-file=/run/myworkspace-initial.cnf", "--connect-expired-password"], sql)
    run(202, ["rm", "/run/myworkspace-initial.cnf"])
    private_file(202, "/root/.myworkspace.cnf", f"[client]\nuser=root\npassword={root}\n")
    private_file(200, "/etc/myworkspace/login-password", password + "\n")
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()
    private_file(200, "/etc/myworkspace/application.env", f"""DB_URL=jdbc:mysql://192.168.1.202:3306/myworkspace?connectionTimeZone=UTC&sslMode=PREFERRED&allowPublicKeyRetrieval=true
DB_USER=myworkspace
DB_PASSWORD={runtime}
DB_MIGRATION_USER=myworkspace_migrate
DB_MIGRATION_PASSWORD={migration}
APP_PASSWORD_HASH={hashed}
TRUSTED_NETWORKS=192.168.1.0/24
WOL_BROADCAST=192.168.1.255
""")
    run(202, ["systemctl", "enable", "--now", "firewalld"])
    rule = 'rule family="ipv4" source address="192.168.1.200/32" port port="3306" protocol="tcp" accept'
    run(202, ["firewall-cmd", "--permanent", "--add-rich-rule=" + rule])
    run(202, ["firewall-cmd", "--reload"])
    print("MySQL initialized. Private credentials saved on LXC 200 and 202.")


if __name__ == "__main__":
    initialize()
