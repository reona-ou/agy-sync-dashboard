# Antigravity Sync Dashboard (`agy-sync-dashboard`)

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md)

Antigravity ネイティブ右サイドバー（補助ペイン）プラグインです。ローカルの `~/.gemini/antigravity` SQLite 会話データベース（読み取り専用）とローカル `language_server` RPC クォータを直接読み取り、**Syncthing / クラウド共有フォルダ** または **WebDAV（Jianguoyun / Alist / Nextcloud 等）** 経由で複数端末のスナップショットを安全に交換し、**マルチデバイス合算統計（本日 / 14日間推移 / 累計 / モデル別 / 最近の会話 / 5時間・週間枠の残量予測）** を表示します。日本語 / 簡体字中国語 / 英語の3言語に対応した設定画面を内蔵しています。

## 主な特徴

- **ネイティブサイドバー統合**：Antigravity プラグインおよび Sidecar 仕様（`SIDECAR_UI_ENTRYPOINT_AUX_PANE`）に準拠し、`app.asar` の改変や DOM 注入を行いません。
- **視覚階層の再設計（純 CSS・依存関係ゼロ・ビルド不要）**：ページ / カード / 埋め込みの 3 層サーフェストークンとセマンティックな状態色を採用し、追加の DOM ノードは不要です。14 日トレンドは平方根スケールに変更（ピーク日が他の棒を 2px に潰すのを回避）し、ピーク・中位のガイドラインを追加、棒はキーボードでフォーカス可能です。quota 取得不可およびデータ欠損時は破線の空状態に統一。テキストのコントラストはブラウザ上で WCAG AA（4.5:1 以上）を検証済みで、`prefers-reduced-motion` と幅 380px 以下の狭いペインにも対応しています。
- **完全に独立した Conda 環境**：最小限の `environment.yml`（環境名 `agy_sync_dashboard`、Python 3.10+ 標準ライブラリのみ）を同梱。`install.ps1` / `install.sh` / `manage.py` は自動的に `agy_sync_dashboard` 環境を作成・使用し、システムや他ソフトウェアの環境と完全に分離されます。
- **日 / 中 / 英 3言語対応（`ja` / `zh-CN` / `en`）**：フロントエンド UI、設定項目、OS ネイティブフォルダ選択ダイアログまで3言語に対応し、設定画面からリアルタイムに切り替え可能です。
- **ビジュアル設定画面を内蔵（初期状態はすべて空欄）**：初回インストール時は個人パス・端末名上書き・WebDAV 認証情報を一切プリセットせず、安全な **ローカルのみ** モードで起動します。サイドバーの **設定** タブ（または `http://127.0.0.1:17920/settings`）でいつでも設定できます：
  - **同期フォルダ（Syncthing / クラウドドライブ）**：OS 標準のフォルダ選択ダイアログ呼び出しと読み書きテストに対応。
  - **WebDAV クラウド同期**：依存ライブラリ不要の WebDAV クライアントとテンプレート（Jianguoyun / Alist / Nextcloud）を内蔵。接続テスト、リモートフォルダ自動作成、パスワード保護（空欄維持）に対応。
  - **フォルダ + WebDAV の同時併用**、またはオフライン時の **ローカルのみ** モード。
  - **自動更新間隔のカスタマイズ**：`3秒 – 86400秒` で設定可能。ローカル DB / 同期フォルダのファイル監視（Watcher）と軽量 `/api/version` ハートビートにより低負荷でリアルタイム更新します。
- **5時間枠 / 週間枠の残量＆持続時間（Runway）予測**：モデルファミリー別（Gemini / Claude & GPT / Argon）に今周期・前周期の複数端末合計消費量を集計し、推定残量トークン数と消費速度に基づく持続予測を算出します。
- **外部ランタイム依存ゼロ**：Antigravity 同梱の Node.js（`node:sqlite` + 標準 `fetch`）と独立 `agy_sync_dashboard` 環境の Python 3.10+ 標準ライブラリのみで動作します。
- **端末別ファイル追記方式（上書き競合なし）**：
  - 各端末は自身の `devices/<deviceId>.json` のみを書き込みます（フォルダ同期時は `.syncthing.*.tmp` によるアトミックリネーム、WebDAV は `PUT` + ETag キャッシュ）。
  - 一時ファイルや `.sync-conflict` ファイルを自動除外し、ローカル重複（`responseId` / `messageId`）も排除します。
- **ターン終了時の自動同期**：`Stop` Hook（`hooks/on-stop.mjs`）を内蔵し、会話ターン終了ごとにバックグラウンド同期を自動トリガーします。

---

## 動作要件

1. **Antigravity デスクトップクライアント**（Node.js `v22.5+` / `v24+` 同梱）
2. **Conda（Miniconda / Anaconda / Miniforge）**（推奨：インストーラが独立環境 `agy_sync_dashboard` を自動作成・使用します。Conda がない場合は `--no-conda` / `-NoConda` でシステム Python `3.10+` へのフォールバックも可能です）
3. **Syncthing / クラウド共有フォルダ または WebDAV サーバー**（任意：未設定でも **ローカルのみ** モードで動作します）

---

## 🤖 AI Agent ワンクリック導入プロンプト（そのままコピー可能）

新しい端末で AI Agent にセットアップを任せる場合は、以下のプロンプトをそのままコピーして送信してください。既存の Python / Conda 環境を汚さず、独立した `agy_sync_dashboard` 環境で導入・テストまで完了し、**個人設定はすべて空欄のまま**安全に初期化します：

```text
agy-sync-dashboard プラグインを以下の手順とルールに従ってセットアップしてください：
1. 環境の完全分離：システムの Python や `base`・他の既存 Conda 環境は一切使用・変更しないでください。リポジトリをクローン後、同梱の `environment.yml` を使って独立した Conda 環境 `agy_sync_dashboard`（Python 3.10+ のみ）を作成または利用してください。
2. ローカルディレクトリへリポジトリをクローン（既存の場合は最新の `main` を pull）：
   - `gh repo clone reona-ou/agy-sync-dashboard` または `git clone https://github.com/reona-ou/agy-sync-dashboard.git`
3. 個人設定はすべて空欄のままにする：インストール時に個人の syncDir、deviceName 上書き、WebDAV 認証情報などは一切指定せず、デフォルトの `local-only` モードで導入してください。
   - Windows (PowerShell): `.\install.ps1`
   - macOS / Linux (Bash): `chmod +x install.sh && ./install.sh`
4. 独立環境 `agy_sync_dashboard` 内で全テストとステータス確認を実行：
   - `conda run -n agy_sync_dashboard python -m unittest discover -s tests`
   - `npm test`
   - `conda run -n agy_sync_dashboard python manage.py status`
5. 完了後、テスト結果・プラグインのインストール先・`status` の環境分離状態を報告し、Antigravity デスクトップクライアントを一度再起動したうえで、サイドバーの「設定」タブから同期フォルダ / WebDAV と表示言語（日本語 / 简体中文 / English）を設定するよう案内してください。
```

---

## 手動セットアップ手順

### 1. リポジトリのクローン

```bash
# 方法 A：GitHub CLI（推奨）
gh repo clone reona-ou/agy-sync-dashboard
cd agy-sync-dashboard

# 方法 B：HTTPS Git
git clone https://github.com/reona-ou/agy-sync-dashboard.git
cd agy-sync-dashboard
```

### 2. 独立環境の作成とプラグインの導入・有効化

インストールスクリプトは Conda を自動検出し、`environment.yml` から独立環境 `agy_sync_dashboard` を作成（既存の場合は再利用）したうえでプラグインの導入と初回スキャンを実行します。

#### Windows（PowerShell）

```powershell
# 独立 Conda 環境 agy_sync_dashboard を作成し、プラグインを導入・初回同期（個人設定はすべて空欄）
.\install.ps1

# 任意：表示言語（ja / zh-CN / en）や同期フォルダを同時に指定する場合
.\install.ps1 -Language ja -SyncDir "<同期フォルダパス>\agy-sync-dashboard" -DeviceName "Workstation-Win"
```

#### macOS / Linux（Bash / Zsh）

```bash
chmod +x install.sh
./install.sh

# 任意：表示言語（ja / zh-CN / en）や同期フォルダを同時に指定する場合
./install.sh --language ja --sync-dir "$HOME/Sync/agy-sync-dashboard" --device-name "Linux-Desktop"
```

#### Conda + `manage.py` を手動実行する場合

```bash
conda env create -f environment.yml -y
conda activate agy_sync_dashboard
python manage.py install
python manage.py sync
python manage.py status
```

> **補足**：`agy_sync_dashboard` 環境外から直接 `python manage.py <コマンド>` を実行した場合でも、`manage.py` が自動的に `agy_sync_dashboard` 環境を検出（未作成時は自動作成）して独立環境内で再実行します（無効化する場合は `--no-conda` を指定してください）。

### 3. 内蔵設定画面で同期方式と言語を設定

1. インストールまたは更新後、**Antigravity デスクトップクライアントを一度完全に再起動**してください。
2. 右側の補助ペインで **AGY Sync Dashboard** を開き、**設定** タブへ移動します（ブラウザで確認する場合は `conda run -n agy_sync_dashboard python manage.py preview` 実行後に `http://127.0.0.1:17920/settings` を開きます）：
   - **表示言語**：`日本語` / `简体中文` / `English` を即座に切り替え可能。
   - **同期フォルダモード**：**選択…** ボタンからフォルダを選択（または手動入力）し、**フォルダテスト** で書き込み可否を確認して **保存して今すぐ同期** をクリックします。
   - **WebDAV モード**（Jianguoyun / Alist / Nextcloud 等）：`WebDAV` または `フォルダ + WebDAV` を選択し、サーバー URL・リモートサブディレクトリ（既定 `/agy-sync-dashboard`）・ユーザー名・アプリパスワードを入力して **接続テスト** 後に保存します（次回以降、他の設定を変更する際はパスワード欄を空欄のままにすると保存済みパスワードが維持されます）。
3. 他端末の `<deviceId>.json` が同期されると、**概要 / デバイス / モデル** タブに統合データが表示されます。

---

## 日常管理・テストコマンド

```bash
conda activate agy_sync_dashboard

# 独立 Conda 環境の作成・確認
python manage.py ensure-env

# インストール状態・独立 Python パス・同期設定・deviceId・検出されたスナップショット一覧を確認
python manage.py status

# ローカル DB スキャンと同期を手動実行
python manage.py sync

# ブラウザ用スタンドアロンプレビューサーバーを起動（http://127.0.0.1:17920）
python manage.py preview --port 17920

# Python / Node.js の全ユニットテストを実行
python -m unittest discover -s tests
npm test

# プラグインを一時無効化（設定と同期データは保持）
python manage.py disable

# プラグインを再有効化
python manage.py enable

# 最新コード取得後の上書き更新（deviceId と個人設定は保持）
git pull
python manage.py install
```

---

## アンインストール

```bash
conda activate agy_sync_dashboard

# ~/.gemini/config/plugins/agy-sync-dashboard を削除して設定を解除
# 既定ではローカルの device.json / config.json および共有フォルダ内の devices/*.json は保持されます
python manage.py uninstall

# ローカルの端末/設定データも削除する場合（共有 syncDir / WebDAV 側のファイルは絶対に削除されません）：
python manage.py uninstall --purge-data

# 独立 Conda 環境自体も削除する場合：
conda deactivate
conda env remove -n agy_sync_dashboard -y
```

> Antigravity 起動中にアンインストールしてサイドバーフォルダがロックされている場合は、Antigravity を終了してから再度実行してください。

---

## データ保存先とディレクトリ構成

- **プラグイン配置先**：`~/.gemini/config/plugins/agy-sync-dashboard/`
- **ホスト側有効化設定**：`~/.gemini/config/config.json` 内の `plugins["agy-sync-dashboard"]`
- **ローカル設定・端末識別子**：`~/.gemini/antigravity/sidecar_data/agy-sync-dashboard/dashboard/data/`
  - `device.json`：初回生成される永続 `deviceId`（表示名を変更しても ID は変わりません）
  - `config.json`：`syncMode`、`syncDir`、`webdav`、`deviceName`、`language`（`zh-CN` / `en` / `ja`）、`syncIntervalMs`
  - `quota-calibration.json`：クォータ容量の自動キャリブレーションキャッシュ
- **マルチデバイス共有データ**：`<syncDir>/devices/<deviceId>.json`（または WebDAV 上の `<remotePath>/devices/<deviceId>.json`）

### よくある質問 (FAQ)

1. **ヘッダーに「ローカルのみ」と表示されるのはなぜですか？**  
   同期フォルダまたは WebDAV がまだ設定されていないか、書き込み権限がない状態です。**設定** タブで同期方式を設定・テストして保存してください。
2. **デバイスタブに「Syncthing 競合ファイルを検出」と表示された場合は？**  
   Syncthing で同一ファイルが同時に変更された場合に `*sync-conflict*.json` が生成されることがあります。プラグイン側で自動的に除外していますが、`<syncDir>/devices/` 内の不要な競合ファイルを削除することをおすすめします。
3. **端末の表示名を変更すると重複カウントされますか？**  
   いいえ。`deviceId` は `device.json` に永続保存されているため、表示名を変更しても同一端末として扱われます。
