import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
import test_backup as fixtures


class InstalledBackupTest(unittest.TestCase):
    def test_documented_layout_runs_from_unrelated_directory_and_preserves_backups_on_failure(self):
        source = Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            sbin = root / 'usr/local/sbin'
            share = root / 'usr/local/share'
            unit = root / 'etc/systemd/system/myworkspace-backup.service'
            binary = root / 'bin'
            for folder in (sbin, share, unit.parent, binary): folder.mkdir(parents=True, exist_ok=True)
            entry = sbin / 'myworkspace-backup.py'
            shutil.copyfile(source / 'backup.py', entry)
            shutil.copyfile(source / 'preview_key.py', sbin / 'preview_key.py')
            shutil.copyfile(source / 'myworkspace-backup.service', unit)
            entry.chmod(0o700)
            (sbin / 'preview_key.py').chmod(0o700)
            helper = share / 'myworkspace-backup-helper.jar'
            with zipfile.ZipFile(helper, 'w') as archive:
                archive.writestr('BOOT-INF/classes/kr/myworkspace/common/database/PreviewKeyBackup.class', b'fixture')
            helper.chmod(0o600)
            self.assertIn('ExecStart=/usr/bin/python3 /usr/local/sbin/myworkspace-backup.py', unit.read_text())
            key = b'a' * 32
            records = fixtures.BackupTest().rows(fixtures.BackupTest().records(key))
            config = root / 'fixture.json'
            config.write_text(json.dumps(dict(root=str(root), key=key.hex(), rows=records,
                programHash=hashlib.sha256((sbin / 'preview_key.py').read_bytes()).hexdigest())))
            pct = binary / 'pct'
            pct.write_text('#!' + sys.executable + '\n' + r'''
import hashlib,json,os,pathlib,shutil,sys,zipfile
cfg=json.loads(pathlib.Path(os.environ['FAKE_PCT_FIXTURE']).read_text())
root=pathlib.Path(cfg['root']);args=sys.argv[1:]
def remote(value):return root/'remote'/value.lstrip('/')
def log(value):
 with (root/'calls.log').open('a') as output:output.write(value+'\n')
if args[0]=='push':
 target=remote(args[3]);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(args[2],target);log('push helper')
else:
 assert args[:3] in (['exec','200','--'],['exec','202','--'])
 command=args[3:]
 if command[0]=='mktemp':
  path='/run/myworkspace-backup-helper.fixture';remote(path).mkdir(parents=True,exist_ok=True);print(path)
 elif command[0]=='chmod':remote(command[2]).chmod(int(command[1],8))
 elif command[0]=='rm':shutil.rmtree(remote(command[-1]));log('cleanup helper')
 elif command[0]=='python3':
  assert command[-1]=='myworkspace.service'
  assert hashlib.sha256(command[2].encode()).hexdigest()==cfg['programHash']
  with zipfile.ZipFile(remote(command[-2])) as jar:assert 'BOOT-INF/classes/kr/myworkspace/common/database/PreviewKeyBackup.class' in jar.namelist()
  log('production helper');print(cfg['key'])
 elif command[0]=='mysqldump':
  assert '--hex-blob' in command;log('dump');print('-- fixture SQL')
 elif command[0]=='mysql':
  statement=sys.stdin.read()
  if command[-1].startswith('myworkspace_restore_'):log('isolated restore')
  elif statement.startswith('SELECT id,'):print(cfg['rows']);log('authenticate rows')
  else:
   assert statement.startswith(('CREATE DATABASE','DROP DATABASE')) and 'myworkspace_restore_' in statement
   log(statement.split()[0])
 else:raise AssertionError(command)
''')
            pct.chmod(0o700)
            backups = root / 'backups'
            # Redirect only the output directory; helper lookup uses the installed __file__.
            program = "import pathlib,runpy,sys;m=runpy.run_path(sys.argv[1]);m['main'].__globals__['directory']=pathlib.Path(sys.argv[2]);sys.argv=[sys.argv[1]];m['main']()"
            environment = dict(os.environ, PATH=str(binary) + os.pathsep + os.environ['PATH'],
                BACKUP_HELPER_JAR=str(helper), FAKE_PCT_FIXTURE=str(config))
            result = subprocess.run([sys.executable, '-I', '-c', program, str(entry), str(backups)],
                cwd=root, env=environment, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            archives = list(backups.glob('*.sql.gz'))
            self.assertEqual(len(archives), 1)
            target = archives[0]
            self.assertEqual(target.with_suffix('.key').read_bytes(), key)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            before = {path.name: path.read_bytes() for path in backups.glob('*.sql*')}
            (sbin / 'preview_key.py').unlink()
            failed = subprocess.run([sys.executable, '-I', '-c', program, str(entry), str(backups)],
                cwd=root, env=environment, capture_output=True, text=True, timeout=30)
            self.assertNotEqual(failed.returncode, 0)
            self.assertEqual(before, {path.name:path.read_bytes() for path in backups.glob('*.sql*')})
            self.assertFalse(list(backups.glob('.staging-*')))
            calls = (root / 'calls.log').read_text()
            for expected in ('push helper', 'production helper', 'isolated restore', 'authenticate rows', 'DROP', 'cleanup helper'):
                self.assertIn(expected, calls)
