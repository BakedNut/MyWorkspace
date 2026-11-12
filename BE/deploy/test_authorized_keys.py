from pathlib import Path
import os
import tempfile
import unittest
from authorized_keys import install_authorized_key
from sensor_key import prepare_key


class AuthorizedKeysTest(unittest.TestCase):
    def test_existing_sensor_owned_home_is_migrated_and_key_replaced_atomically(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            public = prepare_key(root / "private", 65534)
            home = root / "home"
            ssh = home / ".ssh"
            ssh.mkdir(parents=True)
            target = ssh / "authorized_keys"
            target.write_text("old")
            for path in (home, ssh, target):
                os.chown(path, 65534, 65534)
            install_authorized_key(home, 65534, 65534, public)
            install_authorized_key(home, 65534, 65534, public)
            self.assertEqual(0, target.stat().st_uid)
            self.assertEqual(0o640, target.stat().st_mode & 0o777)
            self.assertEqual(0, home.stat().st_uid)
            self.assertEqual(0, ssh.stat().st_uid)
            self.assertEqual(0o750, ssh.stat().st_mode & 0o777)
            self.assertEqual(1, len(target.read_text().splitlines()))
            self.assertIn('restrict,command="/usr/local/libexec/myworkspace-sensors"', target.read_text())

    def test_authorization_and_directory_links_are_rejected_without_changing_targets(self):
        for directory_link in (False, True):
            with self.subTest(directory_link=directory_link), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                public = prepare_key(root / "private", 0)
                home = root / "home"
                home.mkdir()
                marker = root / "marker"
                marker.mkdir() if directory_link else marker.write_text("unchanged")
                before = marker.stat()
                if directory_link:
                    (home / ".ssh").symlink_to(marker, target_is_directory=True)
                else:
                    (home / ".ssh").mkdir()
                    (home / ".ssh/authorized_keys").symlink_to(marker)
                with self.assertRaises((OSError, ValueError)):
                    install_authorized_key(home, 65534, 65534, public)
                after = marker.stat()
                self.assertEqual((before.st_uid, before.st_gid, before.st_mode), (after.st_uid, after.st_gid, after.st_mode))
                if not directory_link:
                    self.assertEqual("unchanged", marker.read_text())


if __name__ == "__main__":
    unittest.main()
