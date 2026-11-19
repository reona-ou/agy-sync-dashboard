# Antigravity Sync Dashboard (`agy-sync-dashboard`)

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md)

A native Antigravity Auxiliary Pane plugin that reads local `~/.gemini/antigravity` SQLite conversation databases (read-only) and local `language_server` RPC quotas, exchanges per-device snapshots safely via **Syncthing / shared cloud folders** or **WebDAV (Jianguoyun / Alist / Nextcloud, etc.)**, displays **additive multi-device usage (Today / 14-day trend / All-time / Models / Recent chats / 5h & Weekly quota runway forecasts)**, and includes a built-in trilingual configuration UI.

## Key Features

- **Native Auxiliary Pane Integration**: Follows Antigravity plugin and sidecar specifications (`SIDECAR_UI_ENTRYPOINT_AUX_PANE`) without modifying `app.asar` or injecting editor DOM.
- **Current Session Context Monitor**: Tracks the active conversation's context window limit (`maxContextTokens`) and current context usage (exact measured `promptTokens + responseTokens` with local pre-flight estimate fallback during streaming), auto-following the focused session or letting you switch between recent local conversations with color-coded capacity meters.
- **Redesigned Visual Hierarchy (pure CSS, zero dependencies, no build step)**: Layered page / card / inset surface tokens with semantic status colours and no extra DOM nodes. The 14-day trend uses a square-root scale (so one peak day no longer flattens every other bar to 2px) plus peak and midpoint guide lines, and bars are keyboard-focusable. Offline quota and empty datasets share a dashed empty state. Text contrast is verified in-browser against WCAG AA (>=4.5:1), with `prefers-reduced-motion` support and a fluid narrow-pane layout (clamped spacing, `auto-fit` grids and container queries; verified down to a 200px pane with no text spilling outside its box).
- **Strictly Isolated Conda Environment**: Includes a minimal `environment.yml` (`agy_sync_dashboard`, containing only an isolated Python 3.10+ runtime). `install.ps1`, `install.sh`, and `manage.py` automatically create and run inside `agy_sync_dashboard` so system Python and other Conda environments stay untouched.
- **Trilingual UI & Config (`zh-CN` / `en` / `ja`)**: Full Simplified Chinese, English, and Japanese support across the frontend UI, settings persistence, and native folder picker dialogs, with instant live preview when switching languages.
- **Built-In Visual Settings Page (Blank Out-of-the-Box)**: Fresh installs ship with all personal sync paths, device overrides, and WebDAV credentials left blank (`local-only` mode by default). Configure anytime in the **Settings** tab (or `http://127.0.0.1:17920/settings`):
  - **Sync Folder (Syncthing / Cloud Drive)**: Native OS folder picker button and one-click read/write test.
  - **WebDAV Cloud Sync**: Zero-dependency WebDAV client with quick presets (Jianguoyun / Alist / Nextcloud), connection testing, automatic remote collection creation, and password redaction.
  - **Folder + WebDAV Dual Transport**, or **Local Only** mode when offline.
  - **Custom Refresh Interval**: Configurable `3s – 86400s` refresh cycle combined with local DB/sync-folder watchers and a lightweight `/api/version` heartbeat.
- **5h / Weekly Quota Capacity & Runway Forecast**: Aggregates current- and previous-cycle usage across all synced devices per model family (`Gemini`, `Claude / GPT`, `Argon`), estimating remaining token capacity and combined burn-rate runway.
- **Zero External Runtime Dependencies**: Uses only Antigravity's bundled Node.js (`node:sqlite` + built-in `fetch`) and Python 3.10+ standard library inside `agy_sync_dashboard`.
- **Append-Only Per-Device Snapshots (No Overwrite Conflicts)**:
  - Each machine only writes its own `devices/<deviceId>.json` (atomic `.syncthing.*.tmp` rename for folders; `PUT` + ETag caching for WebDAV).
  - Automatically ignores temporary and `.sync-conflict` files, and deduplicates locally by `responseId` / `messageId`.
- **Turn-End Auto Sync**: Includes a `Stop` hook (`hooks/on-stop.mjs`) to trigger background sync at the end of every agent turn.

---

## Requirements

1. **Antigravity Desktop Client** (bundles Node.js `v22.5+` / `v24+`)
2. **Conda (Miniconda / Anaconda / Miniforge)** (Recommended: installers automatically create and use `agy_sync_dashboard`; falls back to system Python `3.10+` if `--no-conda` / `-NoConda` is used or Conda is absent)
3. **Syncthing / Cloud Drive folder or WebDAV server** (Optional; starts cleanly in `local-only` mode without any configuration)

---

## 🤖 AI Agent One-Click Deployment Prompt (Copy & Paste)

Send the following prompt to an AI Agent on any new machine to deploy cleanly into an isolated `agy_sync_dashboard` Conda environment with **all personal settings left blank**:

```text
Please deploy the agy-sync-dashboard plugin for me by following these exact rules:
1. Strict environment isolation: Do NOT use system Python or modify my `base` or any other existing Conda environment. After cloning, use the repository's `environment.yml` to create or reuse the isolated Conda environment `agy_sync_dashboard` (Python 3.10+ only).
2. Clone the repository into a clean local directory (or pull latest `main` if already present):
   - Prefer `gh repo clone reona-ou/agy-sync-dashboard` or `git clone https://github.com/reona-ou/agy-sync-dashboard.git`
3. Keep all personal configuration blank: Do NOT pass any personal syncDir, deviceName override, or WebDAV credentials; install with default `local-only` settings.
   - Windows (PowerShell): `.\install.ps1`
   - macOS / Linux (Bash): `chmod +x install.sh && ./install.sh`
4. Run the full test suite and status check inside the `agy_sync_dashboard` environment:
   - `conda run -n agy_sync_dashboard python -m unittest discover -s tests`
   - `npm test`
   - `conda run -n agy_sync_dashboard python manage.py status`
5. Report back with the test results, plugin install path, and isolation status from `status`, and remind me to restart the Antigravity desktop client once and configure my Sync Folder / WebDAV and preferred language (`zh-CN` / `en` / `ja`) in the sidecar Settings tab.
```

---

## Manual Multi-Device Setup

### Step 1: Clone the Repository

```bash
# Option A: GitHub CLI (recommended)
gh repo clone reona-ou/agy-sync-dashboard
cd agy-sync-dashboard

# Option B: HTTPS Git
git clone https://github.com/reona-ou/agy-sync-dashboard.git
cd agy-sync-dashboard
```

### Step 2: Create Isolated Environment & Install Plugin

The install scripts detect Conda automatically, create `agy_sync_dashboard` from `environment.yml` if missing, install the plugin, and run an initial local scan.

#### Windows (PowerShell)

```powershell
# Creates isolated Conda env `agy_sync_dashboard`, installs plugin, and runs initial sync (all personal settings blank)
.\install.ps1

# Optional: specify UI language (zh-CN / en / ja), sync folder, or device name
.\install.ps1 -Language en -SyncDir "<YourSyncRoot>\agy-sync-dashboard" -DeviceName "Workstation-Win"
```

#### macOS / Linux (Bash / Zsh)

```bash
chmod +x install.sh
./install.sh

# Optional: specify UI language (zh-CN / en / ja), sync folder, or device name
./install.sh --language en --sync-dir "$HOME/Sync/agy-sync-dashboard" --device-name "Linux-Desktop"
```

#### Manual Conda + `manage.py`

```bash
conda env create -f environment.yml -y
conda activate agy_sync_dashboard
python manage.py install
python manage.py sync
python manage.py status
```

> **Note**: Even if you run `python manage.py <cmd>` from outside `agy_sync_dashboard`, `manage.py` automatically detects (or creates) the `agy_sync_dashboard` Conda environment and re-executes inside it (pass `--no-conda` to opt out).

### Step 3: Configure Sync Transport & Language in the UI

1. Fully restart the **Antigravity** desktop client once after installing or updating.
2. Open **AGY Sync Dashboard** in the right Auxiliary Pane and switch to the **Settings** tab (or run `conda run -n agy_sync_dashboard python manage.py preview` and open `http://127.0.0.1:17920/settings`):
   - **Language**: Switch freely between `简体中文`, `English`, and `日本語`.
   - **Sync Folder**: Click **Browse…** (or enter a path such as `D:\Sync\agy-sync-dashboard` / `~/Sync/agy-sync-dashboard`), click **Test Folder**, then click **Save & Sync Now**.
   - **WebDAV**: Select `WebDAV` or `Folder + WebDAV`, fill or pick a preset URL, remote subdirectory (`/agy-sync-dashboard`), username, and app password, click **Test Connection**, and save (leave the password field blank on later edits to keep the saved credential).
3. Once peer `<deviceId>.json` snapshots arrive, click **Sync** or wait for auto-refresh to view merged usage across **Overview / Devices / Models**.

---

## Daily Management & Testing Commands

```bash
conda activate agy_sync_dashboard

# Create or verify the isolated Conda environment
python manage.py ensure-env

# Inspect install status, isolated Python path, sync config, deviceId, and peer snapshots
python manage.py status

# Trigger a one-shot local DB scan and sync
python manage.py sync

# Launch standalone HTTP preview server (http://127.0.0.1:17920)
python manage.py preview --port 17920

# Run all Python and Node.js unit tests
python -m unittest discover -s tests
npm test

# Disable plugin (keeps settings and synced data)
python manage.py disable

# Re-enable plugin
python manage.py enable

# Update plugin after pulling new commits (preserves deviceId & settings)
git pull
python manage.py install
```

---

## Uninstall

```bash
conda activate agy_sync_dashboard

# Remove plugin files from ~/.gemini/config/plugins/agy-sync-dashboard
# Preserves local device.json/config.json and shared devices/*.json by default
python manage.py uninstall

# Also remove local device/config state (never deletes shared syncDir or WebDAV files)
python manage.py uninstall --purge-data

# Optionally remove the isolated Conda environment
conda deactivate
conda env remove -n agy_sync_dashboard -y
```

> If Antigravity is running on Windows and holds a lock on the sidecar folder during uninstall, close Antigravity and run `uninstall` once more.

---

## Storage & Directory Layout

- **Plugin install path**: `~/.gemini/config/plugins/agy-sync-dashboard/`
- **Host plugin toggle**: `plugins["agy-sync-dashboard"]` in `~/.gemini/config/config.json`
- **Local config & device identity**: `~/.gemini/antigravity/sidecar_data/agy-sync-dashboard/dashboard/data/`
  - `device.json`: persistent `deviceId` (e.g. `desktop-a1b2c3`; renaming display name keeps the same ID)
  - `config.json`: `syncMode`, `syncDir`, `webdav`, `deviceName`, `language` (`zh-CN` / `en` / `ja`), `syncIntervalMs`
  - `quota-calibration.json`: adaptive quota capacity calibration cache
- **Shared snapshots**: `<syncDir>/devices/<deviceId>.json` (or WebDAV `<remotePath>/devices/<deviceId>.json`)

### FAQ

1. **Why does the header say "Local only"?**  
   Neither a writable sync folder nor WebDAV is configured yet. Configure either transport in the **Settings** tab and save.
2. **What if I see a Syncthing conflict file warning in the Devices tab?**  
   Syncthing creates `*sync-conflict*.json` if two devices somehow wrote the same file concurrently. The plugin ignores conflict files automatically; delete the extra `*sync-conflict*` file inside `<syncDir>/devices/`.
3. **Does renaming my device create duplicate device entries?**  
   No. `deviceId` is persisted in `device.json`. Changing the display name updates the existing device record without creating a duplicate.

---

## License

Released under the [MIT License](LICENSE).
