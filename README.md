# Antigravity Sync Dashboard (`agy-sync-dashboard`)

原生 Antigravity 右侧辅助栏插件：直接以只读模式读取本机 `~/.gemini/antigravity` SQLite 对话数据库与本地 `language_server` RPC 配额，通过 **Syncthing / 网盘共享文件夹** 在多台个人设备之间安全交换各自快照，按 **多设备累加合并（今日 / 14 天趋势 / 历史总计 / 模型 / 最近对话）** 展示用量。

## 核心特性

- **原生侧边栏集成**：遵循 Antigravity 插件与 Sidecar 规范（`SIDECAR_UI_ENTRYPOINT_AUX_PANE`），**不修改** `app.asar`，不注入编辑器 DOM。
- **零外部运行时依赖**：仅使用 Antigravity 内置 Node.js（`node:sqlite` + 原生 `fetch`）与 Python 3.10+ 标准库安装脚本。
- **按设备独立文件累加，永不互相覆盖**：
  - 每台设备仅写入自己独立的 `<syncDir>/devices/<deviceId>.json`（原子写入 `.syncthing.<deviceId>.<pid>.tmp` 后重命名）。
  - 汇总时自动扫描 `<syncDir>/devices/*.json`，跳过临时文件与 `.sync-conflict` 冲突文件，逐字段累加各设备统计。
  - 单机内部按 `responseId` / `messageId` 去重，避免子代理或重试统计翻倍。
- **实时账号限额展示**：直接查询本机运行中的 Antigravity `language_server`（`5h` / 周额度及倒计时）。
- **回合结束自动触发同步**：内置 `Stop` Hook（`hooks/on-stop.mjs`），每次对话回合结束自动通知后台刷新快照，并有 30 秒周期同步兜底。

---

## 环境要求

1. **Antigravity 桌面客户端**（内置 Node.js `v22.5+` / `v24+`）
2. **Python 3.10+**（安装/管理脚本 `manage.py` 使用，仅依赖标准库）
3. **Syncthing 或任意网盘同步目录**（推荐 Syncthing；也可使用 OneDrive / iCloud Drive / Dropbox，甚至不配置目录时以“仅本机模式”运行）

---

## 多设备部署指南

### 第一步：准备跨设备共享目录（每台设备一次）

推荐在所有设备的 Syncthing 中共享同一个目录，例如：

- **Windows**：`D:\Sync`（插件会在其下使用 `D:\Sync\agy-sync-dashboard\devices\`）
- **macOS / Linux**：`~/Sync`（插件会在其下使用 `~/Sync/agy-sync-dashboard/devices/`）

> 如果你只使用网盘（如 OneDrive、iCloud），同样只需在所有设备指向对应的 `agy-sync-dashboard` 子目录即可。

---

### 第二步：克隆仓库（私有仓库）

在每台新设备上克隆仓库（推荐使用 GitHub CLI 或 SSH）：

```bash
# 方式 A：使用 gh CLI（推荐，私有仓库自动认证）
gh repo clone reona-ou/agy-sync-dashboard
cd agy-sync-dashboard

# 方式 B：使用 HTTPS / SSH Git
git clone https://github.com/reona-ou/agy-sync-dashboard.git
cd agy-sync-dashboard
```

---

### 第三步：安装并启用插件

#### Windows（PowerShell）

如果使用 Conda 环境（例如 `Agent`），请先激活对应环境再执行：

```powershell
# 如果有 Conda 环境：
conda activate Agent

# 一键安装并立即执行首次本地同步（建议显式指定 SyncDir 和本机名称）
.\install.ps1 -SyncDir "D:\Sync\agy-sync-dashboard" -DeviceName "Workstation-Win"
```

或者直接调用 Python 脚本：

```powershell
python manage.py install --sync-dir "D:\Sync\agy-sync-dashboard" --device-name "Workstation-Win"
python manage.py sync
python manage.py status
```

#### macOS / Linux（Bash / Zsh）

```bash
chmod +x install.sh
./install.sh --sync-dir "$HOME/Sync/agy-sync-dashboard" --device-name "MacBook-Pro"
```

或者直接调用 Python 脚本：

```bash
python3 manage.py install --sync-dir "$HOME/Sync/agy-sync-dashboard" --device-name "Linux-Desktop"
python3 manage.py sync
python3 manage.py status
```

> **提示**：如果不传 `--sync-dir`，安装脚本会自动检测常见同步根目录（`D:\Sync`、`~/Sync`、`~/Syncthing`、`OneDrive` 等）；如果未检测到，也可以安装后随时在右侧面板 **设置** 标签页中修改并保存。

---

### 第四步：在 Antigravity 中打开面板

1. 安装或更新插件后，**完全重启一次 Antigravity 桌面客户端**（若首次加载未出现侧边栏入口）。
2. 在 Antigravity 窗口右侧辅助栏（Auxiliary Pane）切换到 **Sync Dashboard**。
3. 查看 **总览 / 设备 / 模型 / 设置**：
   - 等待 Syncthing 把其他设备的 `<deviceId>.json` 同步到 `<syncDir>/devices/` 后，点击右上角 **同步** 或等待 30 秒自动刷新，即可看到多设备累加总计和每台设备的独立贡献占比。

---

## 日常管理与调试命令

所有命令均通过 `manage.py` 执行（Windows 下如使用 Conda，请先 `conda activate Agent`）：

```bash
# 查看安装状态、同步目录、本机 deviceId 与发现的设备快照数量
python manage.py status

# 手动触发一次本地数据库扫描并写入 devices/<deviceId>.json
python manage.py sync

# 在浏览器中以本地独立模式预览仪表盘（http://127.0.0.1:17920）
python manage.py preview --port 17920

# 仅停用插件（保留配置与所有同步数据）
python manage.py disable

# 重新启用插件
python manage.py enable

# 更新插件代码后覆盖安装（会保留设备 ID 与配置）
git pull
python manage.py install
```

---

## 卸载插件

```bash
# 从 Antigravity 卸载插件并清理 ~/.gemini/config/plugins/agy-sync-dashboard
# 默认保留本地 device.json/config.json 以及共享目录 devices/*.json
python manage.py uninstall

# 如果同时想删除本机数据状态（仍绝不会删除共享 syncDir 中的文件）：
python manage.py uninstall --purge-data
```

> 如果卸载时 Antigravity 桌面版正在运行并锁定了侧边栏目录，请退出 Antigravity 后再删一次（或重启后确认 `~/.gemini/config/plugins/agy-sync-dashboard` 已不存在）。

---

## 数据存储与目录结构说明

- **插件安装路径**：`~/.gemini/config/plugins/agy-sync-dashboard/`
- **宿主插件开关**：`~/.gemini/config/config.json` 中的 `plugins["agy-sync-dashboard"]`
- **本机配置与设备标识**：`~/.gemini/antigravity/sidecar_data/agy-sync-dashboard/dashboard/data/`
  - `device.json`：首次生成的永久 `deviceId`（例如 `desktop-a1b2c3`，重命名显示名不变更 ID）
  - `config.json`：`syncDir`、`deviceName`、`language`、`syncIntervalMs`
- **跨设备同步数据**：`<syncDir>/devices/<deviceId>.json`

### 常见问题

1. **为什么界面显示“仅本机模式”？**  
   说明 `syncDir` 尚未配置或目录当前无权限写入。请在面板 **设置** 中填写有效目录，或运行 `python manage.py sync --sync-dir "<你的同步目录>"`。
2. **设备页出现“检测到 Syncthing 冲突文件”提示怎么办？**  
   Syncthing 若在双端同时修改异常文件可能生成 `*sync-conflict*.json`。插件已自动忽略它们，只需到 `<syncDir>/devices/` 中删除带 `sync-conflict` 字样的副本文件即可（正常情况下每台设备只写自己的 `<deviceId>.json`，不会产生冲突）。
3. **本机多开代理/重命名电脑后会不会重复统计？**  
   同一台设备的 `deviceId` 保存在 `device.json` 中，修改“本机显示名称”不会新建设备；只有当重装系统生成了新 `deviceId` 时才需要在 `<syncDir>/devices/` 中手动删除旧设备的 `.json` 文件。
