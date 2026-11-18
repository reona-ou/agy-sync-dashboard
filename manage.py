#!/usr/bin/env python3
"""Lifecycle manager for Antigravity Sync Dashboard (agy-sync-dashboard)."""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import uuid
from pathlib import Path

PLUGIN_ID = "agy-sync-dashboard"
CONDA_ENV_NAME = "agy_sync_dashboard"
SUPPORTED_LANGUAGES = ("zh-CN", "en", "ja")
REPO_ROOT = Path(__file__).resolve().parent
ENVIRONMENT_YML = REPO_ROOT / "environment.yml"
RUNTIME_ITEMS = [
    "plugin.json",
    "hooks.json",
    "package.json",
    "assets",
    "compat",
    "hooks",
    "sidecars",
]


def is_running_in_conda_env(env_name: str = CONDA_ENV_NAME) -> bool:
    try:
        return Path(sys.prefix).name == env_name
    except OSError:
        return False


def _env_python_path(env_prefix: Path) -> Path:
    if sys.platform == "win32":
        return env_prefix / "python.exe"
    return env_prefix / "bin" / "python"


def find_conda_executable() -> str | None:
    env_exe = os.environ.get("CONDA_EXE")
    if env_exe:
        try:
            if Path(env_exe).is_file():
                return str(Path(env_exe))
        except OSError:
            pass

    which_conda = shutil.which("conda")
    if which_conda:
        return which_conda

    home = Path.home()
    candidates: list[Path] = []
    if sys.platform == "win32":
        local = Path(os.environ.get("LOCALAPPDATA") or (home / "AppData" / "Local"))
        for base in [
            home / "miniconda3",
            home / "anaconda3",
            home / "miniforge3",
            home / "mambaforge",
            local / "miniconda3",
            local / "anaconda3",
            local / "miniforge3",
            Path("C:/ProgramData/miniconda3"),
            Path("C:/ProgramData/anaconda3"),
            Path("D:/miniconda3"),
            Path("D:/anaconda3"),
            Path("D:/conda"),
        ]:
            candidates.append(base / "condabin" / "conda.bat")
            candidates.append(base / "Scripts" / "conda.exe")
    else:
        for base in [
            home / "miniconda3",
            home / "anaconda3",
            home / "miniforge3",
            home / "mambaforge",
            Path("/opt/conda"),
            Path("/opt/homebrew/Caskroom/miniconda/base"),
            Path("/usr/local/Caskroom/miniconda/base"),
        ]:
            candidates.append(base / "bin" / "conda")

    for cand in candidates:
        try:
            if cand.is_file():
                return str(cand)
        except OSError:
            continue
    return None


def find_conda_env_python(conda_exe: str | None = None, env_name: str = CONDA_ENV_NAME) -> Path | None:
    conda_prefix = os.environ.get("CONDA_PREFIX")
    if conda_prefix:
        try:
            p = Path(conda_prefix)
            if p.name == env_name:
                py = _env_python_path(p)
                if py.is_file():
                    return py
        except OSError:
            pass

    exe = conda_exe or find_conda_executable()
    if not exe:
        return None

    try:
        proc = subprocess.run(
            [exe, "env", "list", "--json"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        if proc.returncode != 0 or not proc.stdout:
            return None
        payload = json.loads(proc.stdout)
        for raw_env in payload.get("envs", []):
            env_path = Path(raw_env)
            if env_path.name == env_name:
                py = _env_python_path(env_path)
                if py.is_file():
                    return py
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return None
    return None


def ensure_conda_env(
    conda_exe: str | None = None,
    env_name: str = CONDA_ENV_NAME,
    env_yml: Path = ENVIRONMENT_YML,
    log_stream=None,
) -> Path | None:
    exe = conda_exe or find_conda_executable()
    if not exe:
        return None

    existing = find_conda_env_python(exe, env_name)
    if existing:
        return existing

    stream = log_stream if log_stream is not None else sys.stderr
    print(f"[agy-sync] Creating isolated Conda environment '{env_name}'...", file=stream, flush=True)
    if env_yml.is_file() and env_name == CONDA_ENV_NAME:
        cmd = [exe, "env", "create", "-f", str(env_yml), "-y"]
    elif env_yml.is_file():
        cmd = [exe, "env", "create", "-n", env_name, "-f", str(env_yml), "-y"]
    else:
        cmd = [exe, "create", "-n", env_name, "python>=3.10", "-y"]

    proc = subprocess.run(cmd, stdout=stream, stderr=stream, check=False)
    if proc.returncode != 0:
        return None
    return find_conda_env_python(exe, env_name)


def maybe_reexec_in_conda(argv: list[str]) -> int | None:
    if "--no-conda" in argv or os.environ.get("AGY_SYNC_NO_CONDA_REEXEC") == "1":
        return None
    if is_running_in_conda_env():
        return None
    conda_exe = find_conda_executable()
    if not conda_exe:
        return None
    env_py = ensure_conda_env(conda_exe, log_stream=sys.stderr)
    if not env_py:
        return None
    try:
        if env_py.resolve() == Path(sys.executable).resolve():
            return None
    except OSError:
        pass

    env = os.environ.copy()
    env["AGY_SYNC_NO_CONDA_REEXEC"] = "1"
    env["CONDA_DEFAULT_ENV"] = CONDA_ENV_NAME
    env["CONDA_PREFIX"] = str(env_py.parent if sys.platform == "win32" else env_py.parent.parent)
    proc = subprocess.run([str(env_py), str(Path(__file__).resolve()), *argv], env=env, check=False)
    return proc.returncode


def resolve_home(home_override: str | None = None) -> Path:
    if home_override:
        return Path(home_override).expanduser().resolve()
    env_home = os.environ.get("AGY_SYNC_HOME")
    if env_home:
        return Path(env_home).expanduser().resolve()
    return Path.home().resolve()


def resolve_paths(home_override: str | None = None) -> dict[str, Path]:
    home = resolve_home(home_override)
    config_root = home / ".gemini" / "config"
    antigravity_root = home / ".gemini" / "antigravity"
    return {
        "home": home,
        "config_json": config_root / "config.json",
        "plugin_dir": config_root / "plugins" / PLUGIN_ID,
        "data_dir": antigravity_root / "sidecar_data" / PLUGIN_ID / "dashboard" / "data",
        "conversations_dir": antigravity_root / "conversations",
    }


def detect_sync_candidates(home: Path) -> list[str]:
    sys_name = platform.system().lower()
    roots: list[Path] = []
    if sys_name == "windows":
        roots.extend([
            Path("D:/Sync"),
            Path("C:/Sync"),
            home / "Sync",
            home / "Syncthing",
        ])
        if os.environ.get("OneDrive"):
            roots.append(Path(os.environ["OneDrive"]))
        roots.extend([Path("D:/OneDrive"), home / "OneDrive", Path("D:/GoogleDrive"), home / "GoogleDrive"])
    elif sys_name == "darwin":
        roots.extend([
            home / "Sync",
            home / "Syncthing",
            home / "Library" / "Mobile Documents" / "com~apple~CloudDocs",
            home / "Library" / "CloudStorage",
        ])
    else:
        roots.extend([home / "Sync", home / "Syncthing", home / "sync"])

    found: list[str] = []
    seen: set[str] = set()
    for root in roots:
        key = str(root)
        if key in seen:
            continue
        seen.add(key)
        try:
            if root.exists():
                found.append(str(root / PLUGIN_ID))
        except OSError:
            pass
    return found


def find_node_executable(home: Path) -> str | None:
    sys_name = platform.system().lower()
    candidates: list[Path] = []
    if sys_name == "windows":
        appdata = Path(os.environ.get("APPDATA") or (home / "AppData" / "Roaming"))
        local = Path(os.environ.get("LOCALAPPDATA") or (home / "AppData" / "Local"))
        candidates.extend([
            appdata / "Antigravity" / "bin" / "agy-node.cmd",
            local / "Programs" / "antigravity" / "resources" / "app" / "extensions" / "antigravity" / "bin" / "node.exe",
        ])
    elif sys_name == "darwin":
        candidates.extend([
            home / "Library" / "Application Support" / "Antigravity" / "bin" / "agy-node",
            Path("/Applications/Antigravity.app/Contents/MacOS/Electron"),
        ])
    else:
        candidates.extend([
            home / ".config" / "Antigravity" / "bin" / "agy-node",
        ])

    for cand in candidates:
        if cand.is_file():
            return str(cand)
    return shutil.which("node")


def read_json(path: Path, default: dict | None = None) -> dict:
    if not path.is_file():
        return dict(default or {})
    try:
        raw = path.read_text(encoding="utf-8-sig")
        data = json.loads(raw)
        return data if isinstance(data, dict) else dict(default or {})
    except (OSError, json.JSONDecodeError):
        return dict(default or {})


def write_json_atomic(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{path.name}.{os.getpid()}.tmp"
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def copy_runtime_tree(src_root: Path, dst_root: Path) -> None:
    dst_root.mkdir(parents=True, exist_ok=True)
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store", "Thumbs.db", ".git", ".scratch")
    for item_name in RUNTIME_ITEMS:
        src = src_root / item_name
        dst = dst_root / item_name
        if not src.exists():
            continue
        if src.is_dir():
            if dst.exists():
                shutil.rmtree(dst, ignore_errors=True)
            shutil.copytree(src, dst, ignore=ignore, dirs_exist_ok=True)
        else:
            shutil.copy2(src, dst)


def set_plugin_enabled(config_json: Path, enabled: bool | None) -> None:
    cfg = read_json(config_json, {})
    plugins = cfg.get("plugins")
    if not isinstance(plugins, dict):
        plugins = {}
    if enabled is None:
        plugins.pop(PLUGIN_ID, None)
    else:
        entry = plugins.get(PLUGIN_ID)
        if not isinstance(entry, dict):
            entry = {}
        entry["enabled"] = bool(enabled)
        plugins[PLUGIN_ID] = entry
    cfg["plugins"] = plugins
    write_json_atomic(config_json, cfg)


def ensure_local_settings(
    paths: dict[str, Path],
    sync_dir: str | None = None,
    sync_mode: str | None = None,
    webdav_url: str | None = None,
    webdav_path: str | None = None,
    webdav_user: str | None = None,
    device_name: str | None = None,
    language: str | None = None,
) -> tuple[dict, dict]:
    data_dir = paths["data_dir"]
    data_dir.mkdir(parents=True, exist_ok=True)

    device_file = data_dir / "device.json"
    config_file = data_dir / "config.json"

    device = read_json(device_file, {})
    if not device.get("deviceId"):
        host = socket.gethostname() or "host"
        slug = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in host.lower()).strip("-")[:28] or "device"
        device = {
            "deviceId": f"{slug}-{uuid.uuid4().hex[:6]}",
            "deviceName": device_name or host,
            "hostname": host,
            "platform": sys.platform,
            "arch": platform.machine(),
        }
        write_json_atomic(device_file, device)
    elif device_name:
        device["deviceName"] = device_name.strip()
        write_json_atomic(device_file, device)

    cfg = read_json(config_file, {})
    changed = False
    if sync_dir is not None:
        cfg["syncDir"] = str(Path(sync_dir).expanduser()) if sync_dir.strip() else ""
        changed = True
    elif "syncDir" not in cfg:
        cfg["syncDir"] = ""
        changed = True

    dav = cfg.get("webdav")
    if not isinstance(dav, dict):
        dav = {"url": "", "remotePath": "/agy-sync-dashboard", "username": "", "password": ""}
        changed = True
    if webdav_url is not None:
        dav["url"] = webdav_url.strip().rstrip("/")
        changed = True
    if webdav_path is not None:
        rp = "/" + webdav_path.strip().strip("/")
        dav["remotePath"] = "/agy-sync-dashboard" if rp == "/" else rp
        changed = True
    if webdav_user is not None:
        dav["username"] = webdav_user.strip()
        changed = True
    cfg["webdav"] = dav

    if sync_mode in ("folder", "webdav", "both", "local-only"):
        cfg["syncMode"] = sync_mode
        changed = True
    elif not cfg.get("syncMode"):
        if dav.get("url") and cfg.get("syncDir"):
            cfg["syncMode"] = "both"
        elif dav.get("url"):
            cfg["syncMode"] = "webdav"
        elif cfg.get("syncDir"):
            cfg["syncMode"] = "folder"
        else:
            cfg["syncMode"] = "local-only"
        changed = True

    if device_name:
        cfg["deviceName"] = device_name.strip()
        changed = True
    elif not cfg.get("deviceName"):
        cfg["deviceName"] = device.get("deviceName") or socket.gethostname()
        changed = True

    if language in SUPPORTED_LANGUAGES:
        cfg["language"] = language
        changed = True
    elif not cfg.get("language"):
        cfg["language"] = "zh-CN"
        changed = True

    if not cfg.get("syncIntervalMs"):
        cfg["syncIntervalMs"] = 30000
        changed = True

    if changed or not config_file.exists():
        write_json_atomic(config_file, cfg)

    return device, cfg


def build_status(paths: dict[str, Path]) -> dict:
    plugin_dir = paths["plugin_dir"]
    installed = (plugin_dir / "plugin.json").is_file() and (plugin_dir / "sidecars" / "dashboard" / "main.mjs").is_file()
    host_cfg = read_json(paths["config_json"], {})
    plugin_entry = host_cfg.get("plugins", {}).get(PLUGIN_ID, {})
    enabled = bool(plugin_entry.get("enabled", False)) if isinstance(plugin_entry, dict) else False

    local_cfg = read_json(paths["data_dir"] / "config.json", {})
    device = read_json(paths["data_dir"] / "device.json", {})
    sync_dir = local_cfg.get("syncDir", "")
    dav = local_cfg.get("webdav") if isinstance(local_cfg.get("webdav"), dict) else {}
    peer_files: list[str] = []
    if sync_dir:
        devices_dir = Path(sync_dir) / "devices"
        if devices_dir.is_dir():
            peer_files = sorted(
                f.name
                for f in devices_dir.iterdir()
                if f.is_file() and f.name.endswith(".json") and not f.name.startswith(".") and "sync-conflict" not in f.name.lower()
            )

    plugin_meta = read_json(plugin_dir / "plugin.json", {}) if installed else read_json(REPO_ROOT / "plugin.json", {})
    conda_exe = find_conda_executable()
    conda_py = find_conda_env_python(conda_exe) if conda_exe else None
    return {
        "plugin": PLUGIN_ID,
        "version": plugin_meta.get("version", "1.1.0"),
        "installed": installed,
        "enabled": enabled,
        "pluginDir": str(plugin_dir),
        "hostConfig": str(paths["config_json"]),
        "dataDir": str(paths["data_dir"]),
        "syncMode": local_cfg.get("syncMode", "folder" if sync_dir else "local-only"),
        "syncDir": sync_dir,
        "webdav": {
            "url": dav.get("url", ""),
            "remotePath": dav.get("remotePath", "/agy-sync-dashboard"),
            "username": dav.get("username", ""),
            "hasPassword": bool(dav.get("password")),
        },
        "deviceId": device.get("deviceId", ""),
        "deviceName": local_cfg.get("deviceName", device.get("deviceName", "")),
        "language": local_cfg.get("language", "zh-CN"),
        "peerSnapshots": peer_files,
        "detectedSyncCandidates": detect_sync_candidates(paths["home"]),
        "nodeExecutable": find_node_executable(paths["home"]),
        "conversationsDbExists": paths["conversations_dir"].is_dir(),
        "condaEnvName": CONDA_ENV_NAME,
        "condaExecutable": conda_exe,
        "condaEnvPython": str(conda_py) if conda_py else None,
        "currentPython": sys.executable,
        "runningInIsolatedEnv": is_running_in_conda_env(),
    }


def cmd_ensure_env(_args: argparse.Namespace) -> int:
    conda_exe = find_conda_executable()
    if not conda_exe:
        print(
            json.dumps(
                {
                    "action": "ensure-env",
                    "ok": False,
                    "envName": CONDA_ENV_NAME,
                    "error": "Conda executable not found",
                },
                indent=2,
                ensure_ascii=False,
            )
        )
        return 1
    env_py = ensure_conda_env(conda_exe, log_stream=sys.stderr)
    ok = bool(env_py and env_py.is_file())
    print(
        json.dumps(
            {
                "action": "ensure-env",
                "ok": ok,
                "envName": CONDA_ENV_NAME,
                "condaExecutable": conda_exe,
                "python": str(env_py) if env_py else None,
                "runningInIsolatedEnv": is_running_in_conda_env(),
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return 0 if ok else 1


def cmd_install(args: argparse.Namespace) -> int:
    paths = resolve_paths(args.home)
    copy_runtime_tree(REPO_ROOT, paths["plugin_dir"])
    set_plugin_enabled(paths["config_json"], True)
    ensure_local_settings(
        paths,
        sync_dir=args.sync_dir,
        sync_mode=args.sync_mode,
        webdav_url=args.webdav_url,
        webdav_path=args.webdav_path,
        webdav_user=args.webdav_user,
        device_name=args.device_name,
        language=args.language,
    )
    status = build_status(paths)
    print(json.dumps({"action": "install", "ok": True, "status": status}, indent=2, ensure_ascii=False))
    return 0


def cmd_enable(args: argparse.Namespace) -> int:
    paths = resolve_paths(args.home)
    if not (paths["plugin_dir"] / "plugin.json").is_file():
        print(json.dumps({"action": "enable", "ok": False, "error": "Plugin not installed yet"}, ensure_ascii=False))
        return 1
    set_plugin_enabled(paths["config_json"], True)
    print(json.dumps({"action": "enable", "ok": True, "status": build_status(paths)}, indent=2, ensure_ascii=False))
    return 0


def cmd_disable(args: argparse.Namespace) -> int:
    paths = resolve_paths(args.home)
    set_plugin_enabled(paths["config_json"], False)
    print(json.dumps({"action": "disable", "ok": True, "status": build_status(paths)}, indent=2, ensure_ascii=False))
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    paths = resolve_paths(args.home)
    print(json.dumps(build_status(paths), indent=2, ensure_ascii=False))
    return 0


def cmd_sync(args: argparse.Namespace) -> int:
    paths = resolve_paths(args.home)
    node_exe = find_node_executable(paths["home"])
    if not node_exe:
        print(json.dumps({"action": "sync", "ok": False, "error": "Node.js 22.5+ (or Antigravity bundled node) not found"}, ensure_ascii=False))
        return 1
    script = paths["plugin_dir"] / "sidecars" / "dashboard" / "sync-cli.mjs"
    if not script.is_file():
        script = REPO_ROOT / "sidecars" / "dashboard" / "sync-cli.mjs"

    cmd = [node_exe, str(script)]
    if args.sync_dir:
        cmd.extend(["--sync-dir", args.sync_dir])
    if args.device_name:
        cmd.extend(["--device-name", args.device_name])

    env = os.environ.copy()
    if args.home:
        env["AG_SYNC_DATA_DIR"] = str(paths["data_dir"])
    proc = subprocess.run(cmd, check=False, env=env)
    return proc.returncode


def cmd_preview(args: argparse.Namespace) -> int:
    paths = resolve_paths(args.home)
    node_exe = find_node_executable(paths["home"])
    if not node_exe:
        print("Node.js not found.", file=sys.stderr)
        return 1
    script = paths["plugin_dir"] / "sidecars" / "dashboard" / "main.mjs"
    if not script.is_file():
        script = REPO_ROOT / "sidecars" / "dashboard" / "main.mjs"
    env = os.environ.copy()
    env["AGY_SYNC_PORT"] = str(args.port)
    env.pop("ANTIGRAVITY_SIDECAR_WEB_PORT", None)
    if args.home:
        env["AG_SYNC_DATA_DIR"] = str(paths["data_dir"])
    print(f"Dashboard: http://127.0.0.1:{args.port}/", flush=True)
    print(f"Settings : http://127.0.0.1:{args.port}/settings", flush=True)
    return subprocess.run([node_exe, str(script)], check=False, env=env).returncode


def cmd_uninstall(args: argparse.Namespace) -> int:
    paths = resolve_paths(args.home)
    set_plugin_enabled(paths["config_json"], None)

    leftover: list[str] = []
    plugin_dir = paths["plugin_dir"]
    if plugin_dir.exists():
        def on_error(_func, p, _exc):
            leftover.append(str(p))

        shutil.rmtree(plugin_dir, onerror=on_error)

    if args.purge_data and paths["data_dir"].exists():
        shutil.rmtree(paths["data_dir"], ignore_errors=True)

    result = {
        "action": "uninstall",
        "ok": len(leftover) == 0,
        "pluginDirRemoved": not plugin_dir.exists(),
        "leftoverLockedPaths": leftover,
        "dataPreserved": not args.purge_data,
        "note": "If Antigravity is running, restart Antigravity once to release any remaining sidecar folder handle."
        if leftover
        else "Uninstalled cleanly. Synced folder files were kept untouched.",
    }
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage Antigravity Sync Dashboard plugin")
    parser.add_argument("--home", default=None, help="Override home directory (primarily for isolated tests)")
    parser.add_argument("--no-conda", action="store_true", help="Do not auto-switch into the agy_sync_dashboard Conda env")
    sub = parser.add_subparsers(dest="command", required=True)

    p_env = sub.add_parser("ensure-env", help="Create or verify the isolated agy_sync_dashboard Conda environment")
    p_env.set_defaults(func=cmd_ensure_env)

    p_install = sub.add_parser("install", help="Install plugin into ~/.gemini/config/plugins and enable it")
    p_install.add_argument("--sync-mode", choices=["folder", "webdav", "both", "local-only"], default=None, help="Sync transport mode")
    p_install.add_argument("--sync-dir", default=None, help="Shared sync directory path (e.g. D:\\Sync\\agy-sync-dashboard)")
    p_install.add_argument("--webdav-url", default=None, help="WebDAV base server URL")
    p_install.add_argument("--webdav-path", default=None, help="WebDAV remote subdirectory (default /agy-sync-dashboard)")
    p_install.add_argument("--webdav-user", default=None, help="WebDAV username")
    p_install.add_argument("--device-name", default=None, help="Display name for this machine")
    p_install.add_argument("--language", choices=list(SUPPORTED_LANGUAGES), default=None, help="UI language (zh-CN, en, ja)")
    p_install.set_defaults(func=cmd_install)

    p_enable = sub.add_parser("enable", help="Enable installed plugin")
    p_enable.set_defaults(func=cmd_enable)

    p_disable = sub.add_parser("disable", help="Disable plugin without removing files")
    p_disable.set_defaults(func=cmd_disable)

    p_status = sub.add_parser("status", help="Show plugin and sync configuration status")
    p_status.set_defaults(func=cmd_status)

    p_sync = sub.add_parser("sync", help="Run a one-shot local scan and sync pass")
    p_sync.add_argument("--sync-dir", default=None, help="Override/update sync directory before syncing")
    p_sync.add_argument("--device-name", default=None, help="Override/update device name before syncing")
    p_sync.set_defaults(func=cmd_sync)

    p_prev = sub.add_parser("preview", help="Run standalone HTTP preview server on 127.0.0.1")
    p_prev.add_argument("--port", type=int, default=17920, help="Loopback preview port")
    p_prev.set_defaults(func=cmd_preview)

    p_uninst = sub.add_parser("uninstall", help="Disable and remove plugin from Antigravity")
    p_uninst.add_argument("--purge-data", action="store_true", help="Also delete local device/config state (never deletes syncDir)")
    p_uninst.set_defaults(func=cmd_uninstall)

    return parser


def main(argv: list[str] | None = None) -> int:
    if sys.version_info < (3, 10):
        print("Python 3.10+ is required.", file=sys.stderr)
        return 1
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    reexec_rc = maybe_reexec_in_conda(sys.argv[1:])
    if reexec_rc is not None:
        raise SystemExit(reexec_rc)
    raise SystemExit(main())
