import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

import manage  # noqa: E402


def run_manage(*argv: str) -> tuple[int, dict]:
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = manage.main(list(argv))
    out = json.loads(buf.getvalue())
    return rc, out


class LifecycleTests(unittest.TestCase):
    def test_install_enable_disable_uninstall_preserves_host_and_sync_data(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            home = tmp_path / "home"
            sync_dir = tmp_path / "Sync" / "agy-sync-dashboard"
            (sync_dir / "devices").mkdir(parents=True, exist_ok=True)
            peer_file = sync_dir / "devices" / "peer-123456.json"
            peer_file.write_text('{"schemaVersion":1,"deviceId":"peer-123456"}', encoding="utf-8")

            host_cfg_path = home / ".gemini" / "config" / "config.json"
            host_cfg_path.parent.mkdir(parents=True, exist_ok=True)
            host_cfg_path.write_text(
                json.dumps(
                    {
                        "themeMode": "dark",
                        "plugins": {"other-plugin": {"enabled": True}},
                    }
                ),
                encoding="utf-8",
            )

            rc, res = run_manage(
                "--home",
                str(home),
                "install",
                "--sync-dir",
                str(sync_dir),
                "--device-name",
                "TestWinBox",
                "--language",
                "en",
            )
            self.assertEqual(rc, 0)
            self.assertTrue(res["ok"])
            self.assertTrue(res["status"]["installed"])
            self.assertTrue(res["status"]["enabled"])
            self.assertEqual(res["status"]["deviceName"], "TestWinBox")
            self.assertEqual(res["status"]["language"], "en")
            self.assertEqual(res["status"]["peerSnapshots"], ["peer-123456.json"])

            plugin_dir = home / ".gemini" / "config" / "plugins" / "agy-sync-dashboard"
            self.assertTrue((plugin_dir / "plugin.json").is_file())
            self.assertTrue((plugin_dir / "sidecars" / "dashboard" / "main.mjs").is_file())
            self.assertTrue((plugin_dir / "hooks" / "on-stop.mjs").is_file())

            # Unrelated host config keys preserved
            cfg = json.loads(host_cfg_path.read_text(encoding="utf-8"))
            self.assertEqual(cfg["themeMode"], "dark")
            self.assertEqual(cfg["plugins"]["other-plugin"], {"enabled": True})
            self.assertEqual(cfg["plugins"]["agy-sync-dashboard"], {"enabled": True})

            # Disable -> files intact, flag false
            rc, dis = run_manage("--home", str(home), "disable")
            self.assertEqual(rc, 0)
            self.assertFalse(dis["status"]["enabled"])
            self.assertTrue((plugin_dir / "plugin.json").is_file())

            # Enable -> flag true again
            rc, en = run_manage("--home", str(home), "enable")
            self.assertEqual(rc, 0)
            self.assertTrue(en["status"]["enabled"])

            # Uninstall preserves local data & shared syncDir
            rc, un = run_manage("--home", str(home), "uninstall")
            self.assertEqual(rc, 0)
            self.assertTrue(un["pluginDirRemoved"])
            self.assertTrue(un["dataPreserved"])
            data_dir = home / ".gemini" / "antigravity" / "sidecar_data" / "agy-sync-dashboard" / "dashboard" / "data"
            self.assertTrue((data_dir / "config.json").is_file())
            self.assertTrue(peer_file.is_file())

            cfg_after = json.loads(host_cfg_path.read_text(encoding="utf-8"))
            self.assertNotIn("agy-sync-dashboard", cfg_after["plugins"])
            self.assertEqual(cfg_after["plugins"]["other-plugin"], {"enabled": True})

            # Purge data still never removes shared syncDir peer files
            rc, un_purge = run_manage("--home", str(home), "uninstall", "--purge-data")
            self.assertEqual(rc, 0)
            self.assertFalse(data_dir.exists())
            self.assertTrue(peer_file.is_file())


if __name__ == "__main__":
    unittest.main()
