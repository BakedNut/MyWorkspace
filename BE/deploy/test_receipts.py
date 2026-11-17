import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import initialize
import preview


class ReceiptTest(unittest.TestCase):
    def test_atomic_server_record_preserves_old_contents_on_failed_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'record.json'
            target.write_text('old')
            def run(ct, args, data=None):
                return subprocess.run(args, input=data, text=True, capture_output=True, check=True).stdout
            with patch.object(initialize, 'run', side_effect=run):
                with self.assertRaises(subprocess.CalledProcessError):
                    initialize.private_file(200, str(target), 'new', mode='invalid', atomic=True)
                self.assertEqual(target.read_text(), 'old')
                initialize.private_file(200, str(target), 'new', atomic=True)
            self.assertEqual(target.read_text(), 'new')
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(target.parent.iterdir()), [target])

    def test_atomic_local_record_preserves_old_contents_and_cleans_partial(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'record.json'
            target.write_text('old')
            with patch.object(preview.json, 'dumps', side_effect=ValueError('invalid data')):
                with self.assertRaises(ValueError): preview.atomic_receipt(target, {})
            self.assertEqual(target.read_text(), 'old')
            preview.atomic_receipt(target, {'commit':'new'})
            self.assertEqual(json.loads(target.read_text()), {'commit':'new'})
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(target.parent.iterdir()), [target])
