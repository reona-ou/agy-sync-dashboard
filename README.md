# Antigravity Sync Dashboard (`agy-sync-dashboard`)

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md)

原生 Antigravity 右侧辅助栏插件：以只读模式读取本机 `~/.gemini/antigravity` SQLite 对话数据库与本地 `language_server` RPC 配额，通过 **Syncthing / 网盘共享文件夹** 或 **WebDAV（坚果云 / Alist / Nextcloud 等）** 在多台个人设备之间安全交换各自快照，按 **多设备累加合并（今日 / 14 天趋势 / 历史总计 / 模型 / 最近对话 / 5h 与周配额余量预测）** 展示用量，并内置支持中/英/日三语的可视化配置页面。

## 核心特性

- **原生侧边栏集成**：遵循 Antigravity 插件与 Sidecar 规范（`SIDECAR_UI_ENTRYPOINT_AUX_PANE`），**不修改** `app.asar`，不注入编辑器 DOM。
- **当前对话上下文监控**：实时读取当前活跃会话的上下文窗口上限（`maxContextTokens`）与当前已用上下文（优先采用 API 实测 `promptTokens + responseTokens`，流式阶段回退本地预估值），支持自动跟随活跃会话或手动切换查看近期本地会话，并分级提示剩余容量。
- **多周期统计与交叉筛选**：**设备** 与 **模型** 视图支持按 `5h` / `今日` / `7d` / `全部` 四个周期统计（基于本地 15 分钟模型时间片 `bySlotModel` 聚合并兼容旧版快照回退），支持按实时有用量模型筛选设备、按设备筛选模型，并按推理档位精准区分 `High`、`XHigh`、`Medium`、`Low` 等变体。
- **信息层级与定制主题设计（纯 CSS、零依赖、零构建）**：内置夜空靛紫（Midnight Nocturne）深色与珠光雪白（Opal Pearl）浅色双主题，采用 `color-mix(in oklab, ...)` 分层令牌与 `@supports (appearance: base-select)` 原生顶层定制下拉菜单；14 天趋势采用平方根刻度并绘制峰值 / 中位参考线；文本对比度满足 WCAG AA（≥4.5:1），支持 `prefers-reduced-motion`、`forced-colors`，并以流体间距 + `auto-fit` 网格 + 容器查询自适应窄面板（实测 200px 宽度下无文字溢出框外）。
- **彻底独立的 Conda 环境**：提供最小化 `environment.yml`（环境名 `agy_sync_dashboard`，仅包含独立 Python 3.10+ 标准库环境，不污染系统或现有软件环境）；`install.ps1`、`install.sh` 与 `manage.py` 均支持自动创建并切换至该独立环境运行。
- **中 / 英 / 日三语界面（`zh-CN` / `en` / `ja`）**：前后端、配置项及系统文件夹选择器均完整支持简体中文、English、日本語，可在 **设置** 页即时切换并持久化保存。
- **内置可视化配置页（默认全留空）**：首次安装默认不预置任何个人路径、设备名或 WebDAV 凭据，以 **仅本机** 模式安全启动；可在右侧辅助栏 **设置** 标签页（或预览地址 `http://127.0.0.1:17920/settings`）中随时配置：
  - **同步目录（Syncthing / 网盘）**：支持一键调起系统原生文件夹选择框与目录可读写测试。
  - **WebDAV 云同步**：内置无依赖 WebDAV 客户端与常用服务模板（坚果云 / Alist / Nextcloud），支持一键测试连接、远端目录自动创建与密码脱敏保留。
  - **目录 + WebDAV 双通道同时同步**，或无网络时以 **仅本机** 模式运行。
  - **自定义自动刷新周期**：支持 `3s – 86400s` 自定义刷新间隔，结合本地数据库/同步目录文件监听器（Watcher）与轻量 `/api/version` 心跳实现低开销实时更新。
- **5h / 周配额余量与续航预测**：按模型族（Gemini / Claude & GPT / Argon）实时汇总多设备本周期与上周期消耗，估算当前周期剩余可用 Token 与综合消耗速率续航（Runway）。
- **零外部运行时依赖**：仅使用 Antigravity 内置 Node.js（`node:sqlite` + 原生 `fetch`）与独立 `agy_sync_dashboard` Python 3.10+ 标准库环境。
- **按设备独立文件累加，永不互相覆盖**：
  - 每台设备仅写入自己独立的 `devices/<deviceId>.json`（本地目录使用 `.syncthing.*.tmp` 原子重命名；WebDAV 直接 `PUT` 并基于 ETag 缓存增量拉取）。
  - 汇总时自动忽略临时文件与 `.sync-conflict` 冲突文件，逐字段累加各设备统计；单机内部按 `responseId` / `messageId` 去重。
- **回合结束自动触发同步**：内置 `Stop` Hook（`hooks/on-stop.mjs`），每次对话回合结束自动通知后台刷新快照，并有周期同步兜底。

---

## 环境要求

1. **Antigravity 桌面客户端**（内置 Node.js `v22.5+` / `v24+`）
2. **Conda（Miniconda / Anaconda / Miniforge）**（推荐：安装脚本会自动创建独立环境 `agy_sync_dashboard`；若无 Conda，也支持 `--no-conda` / `-NoConda` 回退到系统 Python `3.10+`）
3. **Syncthing / 网盘共享目录 或 WebDAV 服务**（可选；不配置时默认以 **仅本机模式** 运行）

---

## 🤖 AI Agent 一键部署 Prompt（可直接复制）

如果你在新设备使用 Antigravity / AI Agent 协助部署，可直接复制以下 Prompt 发送给 Agent。它会以**彻底独立的 `agy_sync_dashboard` Conda 环境**完成克隆、安装、测试与启⽤，且**所有个人同步配置默认留空**，不会写入任何私有路径或凭据：

```text
请帮我部署 agy-sync-dashboard 插件，严格遵守以下要求：
1. 环境彻底独立：不要使用系统 Python 或修改我的 base / 其他已有 Conda 环境。请在克隆仓库后使用仓库内的 environment.yml 创建或复用独立的 Conda 环境 `agy_sync_dashboard`（仅含 Python 3.10+）。
2. 克隆仓库到本地目录（若已存在则拉取最新 main 分支）：
   - 优先尝试 `gh repo clone reona-ou/agy-sync-dashboard` 或 `git clone https://github.com/reona-ou/agy-sync-dashboard.git`
3. 保留全部个人配置为空：安装时不要预设任何个人 syncDir、deviceName 覆盖或 WebDAV 账密（直接以默认的 local-only 模式安装）。
   - Windows 执行：`.\install.ps1`
   - macOS / Linux 执行：`chmod +x install.sh && ./install.sh`
4. 在独立环境 `agy_sync_dashboard` 中运行全部测试与状态校验：
   - `conda run -n agy_sync_dashboard python -m unittest discover -s tests`
   - `npm test`
   - `conda run -n agy_sync_dashboard python manage.py status`
5. 部署完成后向我汇报：测试结果、`status` 返回的插件安装路径与环境隔离状态，并提醒我重启一次 Antigravity 桌面客户端后在右侧面板「设置」标签页中自行填写同步目录或 WebDAV 与界面语言（简体中文 / English / 日本語）。
```

---

## 手动多设备部署指南

### 第一步：克隆仓库

在每台新设备上克隆仓库：

```bash
# 方式 A：使用 GitHub CLI（推荐）
gh repo clone reona-ou/agy-sync-dashboard
cd agy-sync-dashboard

# 方式 B：使用 HTTPS Git
git clone https://github.com/reona-ou/agy-sync-dashboard.git
cd agy-sync-dashboard
```

### 第二步：创建独立环境并安装启用插件

安装脚本会自动检测 Conda，从 `environment.yml` 创建隔离环境 `agy_sync_dashboard`（仅含独立 Python 3.10+），并在该环境中安装与执行首次本地扫描。

#### Windows（PowerShell）

```powershell
# 一键创建独立 Conda 环境 agy_sync_dashboard、安装插件并执行首次扫描（全部个人配置留空）
.\install.ps1

# 可选：若要在安装时一并指定语言（zh-CN / en / ja）或同步目录
.\install.ps1 -Language zh-CN -SyncDir "<你的同步目录>\agy-sync-dashboard" -DeviceName "Workstation-Win"
```

#### macOS / Linux（Bash / Zsh）

```bash
chmod +x install.sh
./install.sh

# 可选：若要在安装时一并指定语言（zh-CN / en / ja）或同步目录
./install.sh --language zh-CN --sync-dir "$HOME/Sync/agy-sync-dashboard" --device-name "Linux-Desktop"
```

#### 手动使用 Conda + `manage.py`

```bash
conda env create -f environment.yml -y
conda activate agy_sync_dashboard
python manage.py install
python manage.py sync
python manage.py status
```

> **提示**：即便不手动 `conda activate agy_sync_dashboard`，直接运行 `python manage.py <命令>` 时，`manage.py` 也会自动定位（或按需创建）`agy_sync_dashboard` 环境并切换进去执行（如需跳过自动隔离可追加 `--no-conda`）。

### 第三步：在内置配置页设置同步方式与语言

1. 安装或更新插件后，**完全重启一次 Antigravity 桌面客户端**（若首次加载未出现侧边栏入口）。
2. 在 Antigravity 窗口右侧辅助栏打开 **AGY Sync Dashboard**，切换到 **设置** 标签页（也可运行 `conda run -n agy_sync_dashboard python manage.py preview` 后在浏览器访问 `http://127.0.0.1:17920/settings`）：
   - **界面语言**：支持 `简体中文` / `English` / `日本語` 即时切换。
   - **同步目录模式**：点击 **选择目录…** 调用系统原生文件夹选择器或手动输入目录（例如 Syncthing 共享目录下的 `agy-sync-dashboard` 子目录），点击 **测试目录** 确认可写后保存。
   - **WebDAV 模式**（如坚果云、Alist、Nextcloud）：切换为 `WebDAV` 或 `目录 + WebDAV`，填写或点击模板填入服务器地址、子目录（默认 `/agy-sync-dashboard`）、用户名与应用密码，点击 **测试连接** 验证后再保存（后续修改其他配置时密码框留空即可保留原密码）。
3. 等待其他设备的 `<deviceId>.json` 同步到达后，点击右上角 **同步** 或等待自动刷新，即可在 **总览 / 设备 / 模型** 查看多设备合并数据。

---

## 日常管理与测试命令

所有 Python 管理与测试命令均推荐在独立环境 `agy_sync_dashboard` 中运行：

```bash
conda activate agy_sync_dashboard

# 确认/创建独立环境
python manage.py ensure-env

# 查看安装状态、独立环境路径、同步目录、本机 deviceId 与发现的设备快照数量
python manage.py status

# 手动触发一次本地数据库扫描并同步
python manage.py sync

# 在浏览器中以本地独立模式预览仪表盘（http://127.0.0.1:17920）
python manage.py preview --port 17920

# 运行全部 Python 与 Node.js 单元测试
python -m unittest discover -s tests
npm test

# 仅停用插件（保留配置与所有同步数据）
python manage.py disable

# 重新启用插件
python manage.py enable

# 更新插件代码后覆盖安装（保留设备 ID 与个人配置）
git pull
python manage.py install
```

---

## 卸载插件

```bash
conda activate agy_sync_dashboard

# 从 Antigravity 卸载插件并清理 ~/.gemini/config/plugins/agy-sync-dashboard
# 默认保留本地 device.json/config.json 以及共享目录 devices/*.json
python manage.py uninstall

# 如果同时想删除本机数据状态（绝不会删除共享 syncDir 或 WebDAV 中的文件）：
python manage.py uninstall --purge-data

# 如需连同独立 Conda 环境一起移除：
conda deactivate
conda env remove -n agy_sync_dashboard -y
```

> 如果卸载时 Antigravity 桌面版正在运行并锁定了侧边栏目录，请退出 Antigravity 后再执行一次（或重启后确认 `~/.gemini/config/plugins/agy-sync-dashboard` 已不存在）。

---

## 数据存储与目录结构说明

- **插件安装路径**：`~/.gemini/config/plugins/agy-sync-dashboard/`
- **宿主插件开关**：`~/.gemini/config/config.json` 中的 `plugins["agy-sync-dashboard"]`
- **本机配置与设备标识**：`~/.gemini/antigravity/sidecar_data/agy-sync-dashboard/dashboard/data/`
  - `device.json`：首次生成的永久 `deviceId`（例如 `desktop-a1b2c3`，修改显示名不变更 ID）
  - `config.json`：`syncMode`、`syncDir`、`webdav`、`deviceName`、`language`（`zh-CN` / `en` / `ja`）、`syncIntervalMs`
  - `quota-calibration.json`：配额容量自适应校准缓存
- **跨设备同步数据**：`<syncDir>/devices/<deviceId>.json`（或 WebDAV `<remotePath>/devices/<deviceId>.json`）

### 常见问题

1. **为什么界面显示“仅本机模式”？**  
   说明同步目录与 WebDAV 尚未配置或当前不可写。请在面板 **设置** 中选择同步方式并保存测试。
2. **设备页出现“检测到 Syncthing 冲突文件”提示怎么办？**  
   Syncthing 若在双端同时修改异常文件可能生成 `*sync-conflict*.json`。插件已自动忽略它们，只需到 `<syncDir>/devices/` 中删除带 `sync-conflict` 字样的副本文件即可。
3. **本机重命名电脑后会不会重复统计？**  
   同一台设备的 `deviceId` 持久化保存在 `device.json` 中，修改“本机显示名称”不会新建设备；只有重装系统生成了新 `deviceId` 时才需要在同步目录手动清理旧设备的 `.json` 文件。

---

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。
