import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from smaran_cli import discovery


class DiscoveryTests(unittest.TestCase):
    def test_live_probe_does_not_terminate_process(self):
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        try:
            self.assertTrue(discovery._pid_alive(process.pid))
            self.assertIsNone(process.poll())
        finally:
            process.terminate()
            process.wait(timeout=10)
        self.assertFalse(discovery._pid_alive(process.pid))

    def test_invalid_process_ids_are_not_signalled(self):
        with patch.object(discovery.os, "kill", side_effect=AssertionError("must not signal")):
            for pid in [0, -1, 2**40, True, "invalid"]:
                self.assertFalse(discovery._pid_alive(pid))

    def test_malformed_runtime_records_are_ignored(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[2] / ".cache" / "audit") as directory:
            with patch.object(discovery, "_data_dirs", return_value=[directory]), patch.object(discovery, "_port_open", return_value=False), patch.dict(os.environ, {"SMARAN_URL": ""}):
                for record in [[], None, {"port": "bad"}, {"port": -2}, {"port": 99999}, {"port": 3003, "pid": []}, {"port": 3003, "pid": -1}]:
                    Path(directory, "runtime.json").write_text(json.dumps(record), encoding="utf-8")
                    self.assertIsNone(discovery.find_backend())

    def test_runtime_url_cannot_redirect_local_discovery(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[2] / ".cache" / "audit") as directory:
            Path(directory, "runtime.json").write_text(json.dumps({"port": 8017, "url": "https://example.invalid"}), encoding="utf-8")
            with patch.object(discovery, "_data_dirs", return_value=[directory]), patch.object(discovery, "_port_open", return_value=True), patch.dict(os.environ, {"SMARAN_URL": ""}):
                self.assertEqual(discovery.find_backend(), "http://127.0.0.1:8017")

    def test_explicit_data_directory_has_priority(self):
        with patch.dict(os.environ, {"DATA_DIR": str(Path.cwd())}):
            self.assertEqual(discovery._data_dirs()[0], str(Path.cwd()))


if __name__ == "__main__":
    unittest.main()
