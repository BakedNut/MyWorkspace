import os
from pathlib import Path
import tempfile
import unittest

from sensor_key import prepare_key, public_key


class SensorKeyTest(unittest.TestCase):
    def test_key_is_stable_and_root_controlled(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "sensors"
            first = prepare_key(directory, os.getgid())
            self.assertEqual(first, prepare_key(directory, os.getgid()))
            self.assertEqual(0o640, (directory / "key").stat().st_mode & 0o777)
            with self.assertRaises(ValueError):
                public_key(first + "\n" + first)
            with self.assertRaises(ValueError):
                public_key("restrict " + first)

    def test_link_is_rejected_without_modifying_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "sensors"
            directory.mkdir(mode=0o750)
            marker = Path(temporary) / "marker"
            marker.write_text("unchanged")
            before = marker.stat()
            (directory / "key").symlink_to(marker)
            with self.assertRaises(ValueError):
                prepare_key(directory, os.getgid())
            self.assertEqual(before.st_mode, marker.stat().st_mode)
            self.assertEqual(before.st_uid, marker.stat().st_uid)
            self.assertEqual("unchanged", marker.read_text())


if __name__ == "__main__":
    unittest.main()
