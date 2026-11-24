# AGY Sync Dashboard (VS Code / Antigravity IDE Extension)

VS Code & Antigravity IDE companion extension for [`agy-sync-dashboard`](../README.md), sharing the exact same local SQLite reader, `language_server` quota RPC, Syncthing / WebDAV multi-device sync, and data directory (`~/.gemini/antigravity/sidecar_data/agy-sync-dashboard/dashboard/data`).

## Features

- **Sidebar / Secondary Side Bar Dashboard**: Full Midnight Nocturne / Opal Pearl Webview panel (`Overview`, `Devices`, `Models`, `Settings`) synced with your VS Code theme and native folder picker.
- **Native Bottom Status Bar Capsule**: Displays live session context usage (`%`, tokens), multi-model quota summary (`G` / `C` / `A`), cache hit rate, and generation speed (`tok/s`). Hover for detailed Markdown breakdown; click to focus the Dashboard view.
- **Automatic `node:sqlite` Fallback**: Runs in-process when the IDE Extension Host provides Node `>= 22.5`, or automatically spawns a background worker using local `agy-node` / Node `>= 22.5` when running inside older Electron Extension Hosts.

## Build `.vsix`

From the repository root:

```bash
npm run build:vsix
```

This syncs the shared runtime into `vscode-extension/runtime/` and outputs:

`vscode-extension/dist/agy-sync-dashboard-vscode-1.5.0.vsix`

## Install Locally

```bash
# VS Code
code --install-extension vscode-extension/dist/agy-sync-dashboard-vscode-1.5.0.vsix

# Antigravity IDE
antigravity --install-extension vscode-extension/dist/agy-sync-dashboard-vscode-1.5.0.vsix
```

Or install via the Extensions view menu: **Install from VSIX...**.
