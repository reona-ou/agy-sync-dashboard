# AGY Sync Dashboard (VS Code / Antigravity IDE Extension)

VS Code & Antigravity IDE companion extension for [`agy-sync-dashboard`](https://github.com/reona-ou/agy-sync-dashboard#readme), sharing the exact same local read-only SQLite reader, `language_server` quota RPC, Syncthing / WebDAV multi-device sync, and data directory (`~/.gemini/antigravity/sidecar_data/agy-sync-dashboard/dashboard/data`).

## Features

- **Sidebar / Secondary Side Bar Dashboard**: Full Midnight Nocturne / Opal Pearl Webview panel (`Overview`, `Devices`, `Models`, `Settings`) synced with your IDE color theme and native folder picker.
- **Native Bottom Status Bar Capsule**: Displays live session context usage (`%`, tokens), multi-model quota summary (`G` / `C` / `A`), cache hit rate, and generation speed (`tok/s`). Hover for detailed Markdown breakdown; click to focus the Dashboard view.
- **Multi-Device Aggregation & Quota Forecasts**: Combines per-device snapshots (`devices/<deviceId>.json`) across Syncthing / shared folders or WebDAV (Jianguoyun, Alist, Nextcloud, etc.) with 5h / weekly quota runway forecasts.
- **Automatic `node:sqlite` Fallback**: Runs in-process when the IDE Extension Host provides Node `>= 22.5`, or automatically spawns a background worker using local `agy-node` / Node `>= 22.5` when running inside older Electron Extension Hosts.

## Commands

- `AGY Sync Dashboard: Focus Dashboard` (`agySyncDashboard.openDashboard`)
- `AGY Sync Dashboard: Open in Editor Tab` (`agySyncDashboard.openPanel`)
- `AGY Sync Dashboard: Sync Now` (`agySyncDashboard.syncNow`)
- `AGY Sync Dashboard: Toggle Status Bar Capsule` (`agySyncDashboard.toggleStatusBar`)

## Extension Settings

- `agySyncDashboard.statusBar.enabled` (boolean, default `true`): Show live context, multi-model quota, cache hit rate, and speed capsule in the bottom status bar.
- `agySyncDashboard.statusBar.refreshSeconds` (number, default `5`, range `3`–`300`): Refresh interval in seconds for the status bar capsule.
- `agySyncDashboard.nodePath` (string, default `""`): Optional path to a Node.js `>= 22.5` (or `agy-node`) executable used if the IDE extension host lacks `node:sqlite`.

## Requirements

- Antigravity installed locally (`~/.gemini/antigravity`) for local conversation & quota telemetry.
- Either an IDE Extension Host with Node `>= 22.5`, or a local `agy-node` / Node.js `>= 22.5` executable on `PATH` (or configured via `agySyncDashboard.nodePath`).

## Build `.vsix`

From the [repository root](https://github.com/reona-ou/agy-sync-dashboard):

```bash
npm run build:vsix
```

This syncs the shared runtime into `vscode-extension/runtime/` and outputs:

`vscode-extension/dist/agy-sync-dashboard-vscode-1.7.0.vsix`

## Install Locally

```bash
# Antigravity IDE
antigravity-ide --install-extension vscode-extension/dist/agy-sync-dashboard-vscode-1.7.0.vsix

# VS Code
code --install-extension vscode-extension/dist/agy-sync-dashboard-vscode-1.7.0.vsix
```

Or install via the Extensions view menu: **Install from VSIX...**.

## Links

- [Source Repository](https://github.com/reona-ou/agy-sync-dashboard)
- [Releases & VSIX Downloads](https://github.com/reona-ou/agy-sync-dashboard/releases)
- [Report an Issue](https://github.com/reona-ou/agy-sync-dashboard/issues)
