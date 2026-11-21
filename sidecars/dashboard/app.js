(function () {
  'use strict';

  const apiFetch =
    window.sidecar && typeof window.sidecar.fetch === 'function'
      ? window.sidecar.fetch.bind(window.sidecar)
      : window.fetch.bind(window);

  const I18N = {
    'zh-CN': {
      title: 'Sync Dashboard',
      syncBtn: '同步',
      syncingBtn: '同步中…',
      syncBtnTitle: '立即同步',
      tablistAria: '仪表盘视图',
      loadingMsg: '正在加载本机与多设备数据…',
      loadFailed: '加载仪表盘数据失败',
      tabs: { overview: '总览', devices: '设备', models: '模型', settings: '设置' },
      badgeSynced: (n) => `${n} 台设备已合并`,
      badgeLocalOnly: '仅本机模式',
      badgeSyncErr: '同步异常',
      quotaTitle: '账号实时额度 (RPC)',
      quotaNote: '按账户统计',
      quotaOffline: '未检测到运行中的 Antigravity 本地服务，配额暂不可用。',
      quotaWin5h: '5 小时周期',
      quotaWinWeekly: '周周期',
      quotaResetIn: (t) => `重置于 ${t}`,
      quotaDisabled: '不可用',
      fcCurrUsed: (v) => `本周期 ${v}`,
      fcPrevUsed: (v) => `上周期 ${v}`,
      fcEstRem: (v) => `预计剩余 ~${v}`,
      fcEstRemNone: '预计剩余 --',
      fcRateBasis: {
        'curr+prev': '当前+上周期',
        curr: '当前周期',
        prev: '上周期',
        none: '无消耗',
      },
      fcRunwaySafe: (d) => `可用 ~${d}（可撑至重置）`,
      fcRunwayRisk: (d) => `可用 ~${d}（重置前可能耗尽）`,
      fcRunwayNeutral: (d) => `可用 ~${d}`,
      fcRunwayDepleted: '已耗尽，等待重置',
      fcRunwayInsufficient: '暂无足够消耗样本预测',
      fcRateTip: (rate, basis) => `平均速率 ${rate}/h（依据：${basis}）`,
      totalsTitle: '多设备累计用量',
      todayLabel: '今日累计',
      allTimeLabel: '历史总计',
      cacheRateLabel: '综合缓存命中率',
      devicesLabel: '同步设备 / 会话数',
      deviceCountTag: (n) => `${n} 台设备`,
      latestGenTitle: '本机最近一次生成',
      trendTitle: '近 14 天多设备趋势',
      trendPeak: '峰值',
      vsPrevDay: '较昨日',
      recentTitle: '最近对话 (跨设备)',
      devicesTitle: '设备周期用量',
      modelsTitle: '模型周期用量',
      modelCountTag: (n) => `${n} 个模型`,
      filterDeviceLabel: '设备',
      filterModelLabel: '模型',
      allDevicesOption: '全部设备',
      allModelsOption: '全部模型',
      noActiveModelsOption: '当前周期暂无有用量模型',
      periodFilterAria: '用量统计周期',
      period5h: '5h',
      periodToday: '今日',
      period7d: '7d',
      periodAll: '全部',
      periodAllChip: '累计',
      periodHints: {
        '5h': '近 5 小时滚动窗口',
        today: '今日累计 (00:00 至今)',
        '7d': '近 7 天滚动窗口',
        all: '历史全部累计',
      },
      periodDesc: {
        '5h': '近 5 小时',
        today: '今日累计',
        '7d': '近 7 天',
        all: '历史累计',
      },
      noPeriodData: (label) => `${label}暂无用量记录，可切换上方周期查看。`,
      noScopePeriodData: (scope, label) => `${scope} · ${label}暂无用量记录，可切换上方筛选或周期查看。`,
      noData: '暂无统计数据，请确认本地会话或同步目录。',
      currentDevice: '本机',
      staleBadge: '超过24小时未更新',
      conflictWarning: (files) =>
        `检测到 ${files.length} 个 Syncthing 冲突文件 (${files.join(', ')})，已自动忽略，建议在同步目录中清理多余冲突副本。`,
      settingsTitle: '多设备同步配置',
      labelSyncMode: '同步方式',
      modeFolder: '同步目录',
      modeWebdav: 'WebDAV',
      modeBoth: '目录 + WebDAV',
      modeLocal: '仅本机',
      folderSectionTitle: '本地 / Syncthing / 网盘同步目录',
      syncDirPlaceholder: '选择或输入同步目录路径',
      pickFolderBtn: '选择目录…',
      pickingBtn: '选择中…',
      testFolderBtn: '测试目录',
      webdavSectionTitle: 'WebDAV 云同步',
      testWebdavBtn: '测试连接',
      testingBtn: '测试中…',
      presetsLabel: '常用模板:',
      presetJianguoyun: '坚果云',
      labelDavUrl: '服务器地址 (URL)',
      labelDavPath: '远端同步子目录',
      labelDavUser: '用户名',
      labelDavPass: '应用密码',
      passPlaceholderNew: '输入密码 / 应用密码',
      passPlaceholderSaved: '已保存（留空保持不变）',
      passSavedHint: '已在本机安全保存密码，留空保存不会覆盖原密码。',
      passClearedMsg: '密码将在保存时清除。',
      clearPassBtn: '清除',
      prefsSectionTitle: '设备与偏好设置',
      labelSyncDir: '同步文件夹路径 (Syncthing / 网盘)',
      labelDeviceName: '本机显示名称',
      labelInterval: '自动刷新周期 (秒)',
      labelLang: '界面语言',
      saveBtn: '保存并立即同步',
      savingBtn: '保存中…',
      savedMsg: '已保存并完成同步',
      testFolderOk: (files) =>
        `目录可读写。当前发现 ${files.length} 个设备快照${files.length ? `: ${files.join(', ')}` : '（首次同步后生成）'}`,
      testWebdavOk: (ms, files, url) =>
        `WebDAV 连接成功 (${ms} ms) · 目录: ${url} · 远端设备快照 (${files.length}): ${files.length ? files.join(', ') : '暂无'}`,
      testFail: (msg) => `测试失败: ${msg}`,
      diagSyncDir: '同步目录',
      diagRemoteDir: 'WebDAV 目录',
      diagSnapshot: '本机快照',
      diagLastSync: '最近同步',
      diagSyncError: '同步错误',
      ctxTitle: '当前对话',
      ctxRemainLabel: '剩余',
      ctxEstLabel: (v) => `预估 ${v}`,
      ctxSourceExact: 'API 实测',
      ctxSourceEst: '本地预估',
      ctxRunning: '生成中',
      ctxLatestGen: '最近生成',
      ctxLabelShort: '上下文',
      ctxActiveBadge: '当前',
      ctxPending: '当前会话尚未产生模型调用，发送消息后将显示上下文占用。',
      ctxEmpty: '暂未检测到本地对话记录。',
      inTok: '输入',
      outTok: '输出',
      cacheTok: '缓存命中',
      gens: '次生成',
      convs: '会话',
      share: '占比',
      todayShort: '今日',
      totalShort: '累计',
      justNow: '刚刚',
      minsAgo: (m) => `${m} 分钟前`,
      hoursAgo: (h) => `${h} 小时前`,
      daysAgo: (d) => `${d} 天前`,
    },
    en: {
      title: 'Sync Dashboard',
      syncBtn: 'Sync',
      syncingBtn: 'Syncing…',
      syncBtnTitle: 'Sync Now',
      tablistAria: 'Dashboard views',
      loadingMsg: 'Loading local & multi-device usage data…',
      loadFailed: 'Failed to load dashboard',
      tabs: { overview: 'Overview', devices: 'Devices', models: 'Models', settings: 'Settings' },
      badgeSynced: (n) => `${n} devices merged`,
      badgeLocalOnly: 'Local only',
      badgeSyncErr: 'Sync error',
      quotaTitle: 'Account Live Quota (RPC)',
      quotaNote: 'Account-wide',
      quotaOffline: 'Local Antigravity language server not detected.',
      quotaWin5h: '5h Window',
      quotaWinWeekly: 'Weekly',
      quotaResetIn: (t) => `Resets in ${t}`,
      quotaDisabled: 'Unavailable',
      fcCurrUsed: (v) => `Curr ${v}`,
      fcPrevUsed: (v) => `Prev ${v}`,
      fcEstRem: (v) => `Est. left ~${v}`,
      fcEstRemNone: 'Est. left --',
      fcRateBasis: {
        'curr+prev': 'curr+prev cycles',
        curr: 'current cycle',
        prev: 'previous cycle',
        none: 'no usage',
      },
      fcRunwaySafe: (d) => `~${d} left (lasts past reset)`,
      fcRunwayRisk: (d) => `~${d} left (may deplete early)`,
      fcRunwayNeutral: (d) => `~${d} left`,
      fcRunwayDepleted: 'Depleted until reset',
      fcRunwayInsufficient: 'Not enough usage data to forecast',
      fcRateTip: (rate, basis) => `Burn rate ${rate}/h (${basis})`,
      totalsTitle: 'Multi-Device Summed Usage',
      todayLabel: 'Today (All Devices)',
      allTimeLabel: 'All-Time Sum',
      cacheRateLabel: 'Blended Cache Hit',
      devicesLabel: 'Devices / Conversations',
      deviceCountTag: (n) => `${n} devices`,
      latestGenTitle: 'Latest Local Generation',
      trendTitle: '14-Day Multi-Device Trend',
      trendPeak: 'Peak',
      vsPrevDay: 'vs yesterday',
      recentTitle: 'Recent Conversations (All Devices)',
      devicesTitle: 'Device Usage by Period',
      modelsTitle: 'Model Usage by Period',
      modelCountTag: (n) => `${n} models`,
      filterDeviceLabel: 'Device',
      filterModelLabel: 'Model',
      allDevicesOption: 'All devices',
      allModelsOption: 'All models',
      noActiveModelsOption: 'No models used in this period',
      periodFilterAria: 'Usage period filter',
      period5h: '5h',
      periodToday: 'Today',
      period7d: '7d',
      periodAll: 'All',
      periodAllChip: 'All',
      periodHints: {
        '5h': 'Rolling 5-hour window',
        today: 'Today (since midnight)',
        '7d': 'Rolling 7-day window',
        all: 'All-time cumulative',
      },
      periodDesc: {
        '5h': 'Last 5h',
        today: 'Today',
        '7d': 'Last 7d',
        all: 'All-time',
      },
      noPeriodData: (label) => `No usage recorded for ${label}. Switch period above to inspect other ranges.`,
      noScopePeriodData: (scope, label) => `${scope} · No usage recorded for ${label}. Switch filter or period above.`,
      noData: 'No token records found yet.',
      currentDevice: 'This device',
      staleBadge: 'Stale (>24h)',
      conflictWarning: (files) =>
        `Detected ${files.length} Syncthing conflict file(s) (${files.join(', ')}). Ignored automatically; consider cleaning duplicates.`,
      settingsTitle: 'Multi-Device Sync Configuration',
      labelSyncMode: 'Sync Transport',
      modeFolder: 'Sync Folder',
      modeWebdav: 'WebDAV',
      modeBoth: 'Folder + WebDAV',
      modeLocal: 'Local Only',
      folderSectionTitle: 'Local / Syncthing / Cloud Folder',
      syncDirPlaceholder: 'Select or enter sync folder path',
      pickFolderBtn: 'Browse…',
      pickingBtn: 'Opening…',
      testFolderBtn: 'Test Folder',
      webdavSectionTitle: 'WebDAV Remote Sync',
      testWebdavBtn: 'Test Connection',
      testingBtn: 'Testing…',
      presetsLabel: 'Presets:',
      presetJianguoyun: 'Jianguoyun',
      labelDavUrl: 'Server URL',
      labelDavPath: 'Remote Subdirectory',
      labelDavUser: 'Username',
      labelDavPass: 'Password / App Token',
      passPlaceholderNew: 'Enter password or app token',
      passPlaceholderSaved: 'Saved (leave blank to keep)',
      passSavedHint: 'Password saved locally. Leave blank to keep existing credential.',
      passClearedMsg: 'Saved password will be removed on Save.',
      clearPassBtn: 'Clear',
      prefsSectionTitle: 'Device & Preferences',
      labelSyncDir: 'Sync Folder Path (Syncthing / Cloud Drive)',
      labelDeviceName: 'This Device Display Name',
      labelInterval: 'Refresh Interval (s)',
      labelLang: 'Language',
      saveBtn: 'Save & Sync Now',
      savingBtn: 'Saving…',
      savedMsg: 'Saved and synced',
      testFolderOk: (files) =>
        `Folder writable. Found ${files.length} device snapshot(s)${files.length ? `: ${files.join(', ')}` : ''}`,
      testWebdavOk: (ms, files, url) =>
        `WebDAV OK (${ms} ms) · ${url} · ${files.length} device file(s): ${files.length ? files.join(', ') : 'none yet'}`,
      testFail: (msg) => `Test failed: ${msg}`,
      diagSyncDir: 'Sync folder',
      diagRemoteDir: 'WebDAV folder',
      diagSnapshot: 'Local snapshot',
      diagLastSync: 'Last sync',
      diagSyncError: 'Sync error',
      ctxTitle: 'Current Session',
      ctxRemainLabel: 'Left',
      ctxEstLabel: (v) => `Est. ${v}`,
      ctxSourceExact: 'Measured',
      ctxSourceEst: 'Estimated',
      ctxRunning: 'Running',
      ctxLatestGen: 'Last gen',
      ctxLabelShort: 'Context',
      ctxActiveBadge: 'Active',
      ctxPending: 'No model turns in this session yet. Send a message to see context usage.',
      ctxEmpty: 'No local conversations found yet.',
      inTok: 'In',
      outTok: 'Out',
      cacheTok: 'Cache',
      gens: 'reqs',
      convs: 'chats',
      share: 'Share',
      todayShort: 'Today',
      totalShort: 'Total',
      justNow: 'just now',
      minsAgo: (m) => `${m}m ago`,
      hoursAgo: (h) => `${h}h ago`,
      daysAgo: (d) => `${d}d ago`,
    },
    ja: {
      title: 'Sync Dashboard',
      syncBtn: '同期',
      syncingBtn: '同期中…',
      syncBtnTitle: '今すぐ同期',
      tablistAria: 'ダッシュボードビュー',
      loadingMsg: 'ローカルおよびマルチデバイスデータを読み込み中…',
      loadFailed: 'ダッシュボードの読み込みに失敗しました',
      tabs: { overview: '概要', devices: 'デバイス', models: 'モデル', settings: '設定' },
      badgeSynced: (n) => `${n} 台を統合済み`,
      badgeLocalOnly: 'ローカルのみ',
      badgeSyncErr: '同期エラー',
      quotaTitle: 'アカウントリアルタイム枠 (RPC)',
      quotaNote: 'アカウント別集計',
      quotaOffline: '稼働中のローカル Antigravity サービスが見つかりません。枠情報は現在利用できません。',
      quotaWin5h: '5時間枠',
      quotaWinWeekly: '週間枠',
      quotaResetIn: (t) => `リセットまで ${t}`,
      quotaDisabled: '利用不可',
      fcCurrUsed: (v) => `今周期 ${v}`,
      fcPrevUsed: (v) => `前周期 ${v}`,
      fcEstRem: (v) => `推定残量 ~${v}`,
      fcEstRemNone: '推定残量 --',
      fcRateBasis: {
        'curr+prev': '今周期+前周期',
        curr: '今周期',
        prev: '前周期',
        none: '消費なし',
      },
      fcRunwaySafe: (d) => `残り ~${d}（リセットまで持続）`,
      fcRunwayRisk: (d) => `残り ~${d}（リセット前に枯渇の可能性）`,
      fcRunwayNeutral: (d) => `残り ~${d}`,
      fcRunwayDepleted: '枯渇済み（リセット待ち）',
      fcRunwayInsufficient: '予測に必要な消費データが不足しています',
      fcRateTip: (rate, basis) => `平均消費速度 ${rate}/h（根拠：${basis}）`,
      totalsTitle: 'マルチデバイス累計使用量',
      todayLabel: '本日の累計',
      allTimeLabel: '全期間合計',
      cacheRateLabel: '統合キャッシュヒット率',
      devicesLabel: '同期デバイス / 会話数',
      deviceCountTag: (n) => `${n} 台`,
      latestGenTitle: 'ローカル最新生成',
      trendTitle: '直近14日間のマルチデバイス推移',
      trendPeak: 'ピーク',
      vsPrevDay: '前日比',
      recentTitle: '最近の会話 (全デバイス)',
      devicesTitle: 'デバイス別・期間別使用量',
      modelsTitle: 'モデル別・期間別使用量',
      modelCountTag: (n) => `${n} モデル`,
      filterDeviceLabel: 'デバイス',
      filterModelLabel: 'モデル',
      allDevicesOption: '全デバイス',
      allModelsOption: '全モデル',
      noActiveModelsOption: 'この期間の使用モデルなし',
      periodFilterAria: '集計期間の切り替え',
      period5h: '5h',
      periodToday: '本日',
      period7d: '7d',
      periodAll: '全期間',
      periodAllChip: '累計',
      periodHints: {
        '5h': '直近5時間のロール集計',
        today: '本日の累計 (0:00以降)',
        '7d': '直近7日間のロール集計',
        all: '全期間の累計',
      },
      periodDesc: {
        '5h': '直近5時間',
        today: '本日累計',
        '7d': '直近7日間',
        all: '全期間累計',
      },
      noPeriodData: (label) => `${label}の使用記録はありません。上の期間を切り替えて確認できます。`,
      noScopePeriodData: (scope, label) => `${scope} · ${label}の使用記録はありません。上のフィルターまたは期間を切り替えてください。`,
      noData: '統計データがまだありません。ローカル会話または同期ディレクトリを確認してください。',
      currentDevice: 'この端末',
      staleBadge: '24時間以上未更新',
      conflictWarning: (files) =>
        `${files.length} 件の Syncthing 競合ファイル (${files.join(', ')}) を検出し、自動的に除外しました。同期ディレクトリ内の不要な競合コピーを削除することをおすすめします。`,
      settingsTitle: 'マルチデバイス同期設定',
      labelSyncMode: '同期方式',
      modeFolder: '同期フォルダ',
      modeWebdav: 'WebDAV',
      modeBoth: 'フォルダ + WebDAV',
      modeLocal: 'ローカルのみ',
      folderSectionTitle: 'ローカル / Syncthing / クラウドフォルダ',
      syncDirPlaceholder: '同期フォルダのパスを選択または入力',
      pickFolderBtn: '選択…',
      pickingBtn: '選択中…',
      testFolderBtn: 'フォルダテスト',
      webdavSectionTitle: 'WebDAV クラウド同期',
      testWebdavBtn: '接続テスト',
      testingBtn: 'テスト中…',
      presetsLabel: 'テンプレート:',
      presetJianguoyun: 'Jianguoyun (堅果雲)',
      labelDavUrl: 'サーバー URL',
      labelDavPath: 'リモートサブディレクトリ',
      labelDavUser: 'ユーザー名',
      labelDavPass: 'パスワード / アプリパスワード',
      passPlaceholderNew: 'パスワード / アプリパスワードを入力',
      passPlaceholderSaved: '保存済み（空欄で現状維持）',
      passSavedHint: 'パスワードはローカルに安全保存されています。空欄のまま保存すると変更されません。',
      passClearedMsg: '保存時にパスワードが削除されます。',
      clearPassBtn: 'クリア',
      prefsSectionTitle: 'デバイスと環境設定',
      labelSyncDir: '同期フォルダパス (Syncthing / クラウド)',
      labelDeviceName: 'この端末の表示名',
      labelInterval: '自動更新間隔 (秒)',
      labelLang: '表示言語',
      saveBtn: '保存して今すぐ同期',
      savingBtn: '保存中…',
      savedMsg: '保存して同期しました',
      testFolderOk: (files) =>
        `フォルダは読み書き可能です。デバイススナップショット ${files.length} 件を検出${files.length ? `: ${files.join(', ')}` : '（初回同期後に生成されます）'}`,
      testWebdavOk: (ms, files, url) =>
        `WebDAV 接続成功 (${ms} ms) · ディレクトリ: ${url} · リモートスナップショット (${files.length}): ${files.length ? files.join(', ') : 'なし'}`,
      testFail: (msg) => `テスト失敗: ${msg}`,
      diagSyncDir: '同期フォルダ',
      diagRemoteDir: 'WebDAV フォルダ',
      diagSnapshot: 'ローカルスナップショット',
      diagLastSync: '最終同期',
      diagSyncError: '同期エラー',
      ctxTitle: '現在の会話',
      ctxRemainLabel: '残り',
      ctxEstLabel: (v) => `推定 ${v}`,
      ctxSourceExact: '実測値',
      ctxSourceEst: '推定値',
      ctxRunning: '生成中',
      ctxLatestGen: '最新生成',
      ctxLabelShort: 'コンテキスト',
      ctxActiveBadge: '現在',
      ctxPending: 'この会話ではまだモデル呼び出しがありません。メッセージ送信後に表示されます。',
      ctxEmpty: 'ローカルの会話履歴がまだ見つかりません。',
      inTok: '入力',
      outTok: '出力',
      cacheTok: 'キャッシュ',
      gens: '回生成',
      convs: '会話',
      share: '割合',
      todayShort: '本日',
      totalShort: '累計',
      justNow: 'たった今',
      minsAgo: (m) => `${m} 分前`,
      hoursAgo: (h) => `${h} 時間前`,
      daysAgo: (d) => `${d} 日前`,
    },
  };

  let state = {
    lang: 'zh-CN',
    dashboard: null,
    selectedDateKey: null,
    devicesPeriod: '5h',
    devicesModel: 'all',
    modelsPeriod: '5h',
    modelsDevice: 'all',
    syncing: false,
    settingsDirty: false,
    selectedSyncMode: 'folder',
    clearPassword: false,
    hostThemeHint: null,
    lastThemeSig: '',
    lastRevision: null,
    lastContextSig: '',
    versionEndpointSupported: true,
    refreshIntervalMs: 30000,
    lastDashboardFetchAt: 0,
    inFlightLoad: null,
    fullRefreshTimer: null,
  };

  const probeCtx = (() => {
    try {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      return c.getContext('2d', { willReadFrequently: true });
    } catch {
      return null;
    }
  })();

  function parseCssColor(val) {
    if (!val || typeof val !== 'string' || !probeCtx) return null;
    let trimmed = val.trim();
    if (!trimmed) return null;
    if (/^\d+(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%$/.test(trimmed)) {
      trimmed = `hsl(${trimmed})`;
    }
    probeCtx.clearRect(0, 0, 1, 1);
    probeCtx.fillStyle = 'rgba(0,0,0,0)';
    probeCtx.fillStyle = trimmed;
    if (probeCtx.fillStyle === 'rgba(0, 0, 0, 0)' && trimmed !== 'transparent') {
      return null;
    }
    probeCtx.fillRect(0, 0, 1, 1);
    const data = probeCtx.getImageData(0, 0, 1, 1).data;
    if (data[3] < 10) return null;
    return { css: trimmed, r: data[0], g: data[1], b: data[2], a: data[3] / 255 };
  }

  function luminance(rgb) {
    const lin = (c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  }

  function syncHostTheme(hostThemeHint) {
    if (hostThemeHint !== undefined) {
      state.hostThemeHint = hostThemeHint;
    }
    const hint = state.hostThemeHint;
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const bgRaw = cs.getPropertyValue('--background').trim();

    const sig = `${bgRaw}|${hint?.mode || ''}`;
    if (sig === state.lastThemeSig && root.dataset.theme) return;
    state.lastThemeSig = sig;

    const bgParsed = parseCssColor(bgRaw);

    let isDark = true;
    if (bgParsed) {
      isDark = luminance(bgParsed) < 0.45;
    } else if (hint?.mode === 'light') {
      isDark = false;
    } else if (hint?.mode === 'dark') {
      isDark = true;
    } else if (window.matchMedia) {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    root.dataset.theme = isDark ? 'dark' : 'light';
  }

  function watchHostTheme() {
    syncHostTheme();
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'theme-change') {
        requestAnimationFrame(() => syncHostTheme());
      }
    });
    if (typeof MutationObserver !== 'undefined') {
      let scheduled = false;
      const obs = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          syncHostTheme();
        });
      });
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    }
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', () => syncHostTheme());
      }
    }
  }

  function t() {
    return I18N[state.lang] || I18N['zh-CN'];
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'className') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (v !== undefined && v !== null) node.setAttribute(k, String(v));
      }
    }
    if (Array.isArray(children)) {
      for (const c of children) {
        if (c !== null && c !== undefined) {
          node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        }
      }
    }
    return node;
  }

  function fmtTokens(n) {
    const val = Number(n || 0);
    if (val >= 1e9) return `${(val / 1e9).toFixed(2)}B`;
    if (val >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
    if (val >= 1e3) return `${(val / 1e3).toFixed(1)}K`;
    return String(Math.round(val));
  }

  function fmtPct(ratio) {
    return `${(Number(ratio || 0) * 100).toFixed(1)}%`;
  }

  function fmtRelative(ms) {
    if (!ms) return '--';
    const diffSec = Math.max(0, Math.floor((Date.now() - Number(ms)) / 1000));
    const dict = t();
    if (diffSec < 60) return dict.justNow;
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return dict.minsAgo(mins);
    const hrs = Math.floor(mins / 60);
    if (hrs < 48) return dict.hoursAgo(hrs);
    return dict.daysAgo(Math.floor(hrs / 24));
  }

  function fmtDurationMs(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return '--';
    const clamped = Math.max(0, ms);
    const totalMins = Math.round(clamped / 60000);
    if (totalMins < 1) return '< 1m';
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hrs >= 24 * 30) {
      return '> 30d';
    }
    if (hrs >= 24) {
      const days = Math.floor(hrs / 24);
      const remH = hrs % 24;
      return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
    }
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  }

  function fmtCountdown(isoTime) {
    if (!isoTime) return '';
    const target = Date.parse(isoTime);
    if (!Number.isFinite(target)) return '';
    return fmtDurationMs(Math.max(0, target - Date.now()));
  }

  function quotaLevelClass(frac) {
    if (frac <= 0.15) return 'danger';
    if (frac <= 0.4) return 'warn';
    return 'ok';
  }

  async function requestJson(url, options) {
    const res = await apiFetch(url, options);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {}
      throw new Error(msg);
    }
    return res.json();
  }

  function setupTabs() {
    const tablist = document.querySelector('.tablist');
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));

    function activateTab(tab, focusIt) {
      for (const tb of tabs) {
        const active = tb === tab;
        tb.setAttribute('aria-selected', String(active));
        tb.setAttribute('tabindex', active ? '0' : '-1');
        const panelId = tb.getAttribute('aria-controls');
        const panel = document.getElementById(panelId);
        if (panel) panel.hidden = !active;
      }
      if (focusIt) tab.focus();
    }

    tabs.forEach((tab, idx) => {
      tab.addEventListener('click', () => activateTab(tab, false));
      tab.addEventListener('keydown', (e) => {
        let nextIdx = idx;
        if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') nextIdx = 0;
        else if (e.key === 'End') nextIdx = tabs.length - 1;
        else return;
        e.preventDefault();
        activateTab(tabs[nextIdx], true);
      });
    });

    const params = new URLSearchParams(window.location.search);
    if (
      window.location.pathname === '/settings' ||
      params.get('view') === 'settings' ||
      window.location.hash === '#settings'
    ) {
      const settingsTab = document.getElementById('tab-settings');
      if (settingsTab) activateTab(settingsTab, false);
    }
  }

  function applySyncModeUi(mode) {
    state.selectedSyncMode = mode || 'local-only';
    const buttons = document.querySelectorAll('#sync-mode-group .mode-btn');
    buttons.forEach((btn) => {
      btn.setAttribute('aria-checked', String(btn.dataset.mode === state.selectedSyncMode));
    });
    document.getElementById('section-folder').hidden =
      state.selectedSyncMode !== 'folder' && state.selectedSyncMode !== 'both';
    document.getElementById('section-webdav').hidden =
      state.selectedSyncMode !== 'webdav' && state.selectedSyncMode !== 'both';
  }

  function applyStaticLabels() {
    const dict = t();
    document.documentElement.lang = state.lang;
    document.getElementById('ui-title').textContent = dict.title;
    const syncBtnEl = document.getElementById('btn-sync');
    syncBtnEl.setAttribute('aria-label', dict.syncBtnTitle);
    syncBtnEl.setAttribute('title', dict.syncBtnTitle);
    document.getElementById('ui-sync-label').textContent = state.syncing ? dict.syncingBtn : dict.syncBtn;
    const tablistEl = document.getElementById('ui-tablist');
    if (tablistEl) tablistEl.setAttribute('aria-label', dict.tablistAria);
    const loadingEl = document.getElementById('ui-loading');
    if (loadingEl) loadingEl.textContent = dict.loadingMsg;
    document.getElementById('tab-overview').textContent = dict.tabs.overview;
    document.getElementById('tab-devices').textContent = dict.tabs.devices;
    document.getElementById('tab-models').textContent = dict.tabs.models;
    document.getElementById('tab-settings').textContent = dict.tabs.settings;
    document.getElementById('ui-settings-title').textContent = dict.settingsTitle;
    document.getElementById('ui-label-syncmode').textContent = dict.labelSyncMode;
    document.getElementById('sync-mode-group').setAttribute('aria-label', dict.labelSyncMode);
    document.getElementById('mode-btn-folder').textContent = dict.modeFolder;
    document.getElementById('mode-btn-webdav').textContent = dict.modeWebdav;
    document.getElementById('mode-btn-both').textContent = dict.modeBoth;
    document.getElementById('mode-btn-local').textContent = dict.modeLocal;
    document.getElementById('ui-folder-section-title').textContent = dict.folderSectionTitle;
    document.getElementById('input-syncdir').placeholder = dict.syncDirPlaceholder;
    document.getElementById('btn-pick-folder').textContent = dict.pickFolderBtn;
    document.getElementById('btn-test-folder').textContent = dict.testFolderBtn;
    document.getElementById('ui-webdav-section-title').textContent = dict.webdavSectionTitle;
    document.getElementById('btn-test-webdav').textContent = dict.testWebdavBtn;
    document.getElementById('ui-presets-label').textContent = dict.presetsLabel;
    document.getElementById('preset-jianguoyun').textContent = dict.presetJianguoyun;
    document.getElementById('ui-label-davurl').textContent = dict.labelDavUrl;
    document.getElementById('ui-label-davpath').textContent = dict.labelDavPath;
    document.getElementById('ui-label-davuser').textContent = dict.labelDavUser;
    document.getElementById('ui-label-davpass').textContent = dict.labelDavPass;
    document.getElementById('btn-clear-davpass').textContent = dict.clearPassBtn;
    document.getElementById('ui-prefs-section-title').textContent = dict.prefsSectionTitle;
    document.getElementById('ui-label-devicename').textContent = dict.labelDeviceName;
    document.getElementById('ui-label-interval').textContent = dict.labelInterval;
    document.getElementById('ui-label-lang').textContent = dict.labelLang;
    document.getElementById('btn-save-settings').textContent = dict.saveBtn;
  }

  function renderTopStatus(data) {
    const dict = t();
    const dot = document.getElementById('sync-dot');
    const badge = document.getElementById('sync-badge');
    const status = data?.syncStatus;
    const count = data?.merged?.deviceCount || 1;

    dot.className = 'brand-dot';
    badge.className = 'status-pill';

    if (!status || status.mode === 'local-only') {
      dot.classList.add('warn');
      badge.classList.add('warn');
      badge.textContent = dict.badgeLocalOnly;
    } else if (status.mode === 'sync-error') {
      dot.classList.add('err');
      badge.textContent = dict.badgeSyncErr;
      badge.title = status.error || '';
    } else {
      dot.classList.add('ok');
      badge.classList.add('ok');
      badge.textContent = dict.badgeSynced(count);
    }
  }

  function contextLevelClass(usedRatio) {
    if (usedRatio >= 0.85) return 'danger';
    if (usedRatio >= 0.65) return 'warn';
    return 'ok';
  }

  function buildContextCard(sessionContext, localLatestGen) {
    const dict = t();
    const card = el('article', { className: 'card' });
    const current = sessionContext?.current || null;

    const rightTagText =
      current?.displayName || current?.modelId || localLatestGen?.displayName || '';
    const headChildren = [el('h2', { className: 'card-title', text: dict.ctxTitle })];
    if (rightTagText) {
      headChildren.push(el('span', { className: 'tag accent', text: rightTagText, title: rightTagText }));
    }
    card.appendChild(el('div', { className: 'card-head' }, headChildren));

    const genInfo = current?.latestGeneration || localLatestGen || null;
    if (!current && !genInfo) {
      card.appendChild(el('p', { className: 'empty-note', text: dict.ctxEmpty }));
      return card;
    }

    const box = el('div', { className: 'ctx-box' });

    if (current) {
      const statusText = current.isRunning
        ? dict.ctxRunning
        : current.source === 'estimate'
          ? dict.ctxSourceEst
          : current.source === 'usage'
            ? dict.ctxSourceExact
            : '';
      box.appendChild(
        el('div', { className: 'ctx-conv-row' }, [
          el('span', {
            className: 'ctx-conv-name',
            text: current.title || current.conversationId,
            title: current.title || current.conversationId,
          }),
          statusText
            ? el('span', {
                className: `ctx-badge${current.isRunning ? ' live' : ''}`,
                text: statusText,
              })
            : null,
        ])
      );

      if (current.maxContextTokens > 0 || current.usedTokens > 0) {
        const hasMax = current.maxContextTokens > 0;
        const ratio = hasMax ? Math.max(0, Number(current.usageRatio || 0)) : 0;
        const pctClamped = hasMax ? Math.min(100, Math.max(1, Math.round(ratio * 100))) : 0;
        const usedMainText = `${fmtTokens(current.usedTokens)} / ${hasMax ? fmtTokens(current.maxContextTokens) : '--'}`;
        const usedSubParts = [];
        if (hasMax) usedSubParts.push(fmtPct(ratio));
        if (hasMax) usedSubParts.push(`${dict.ctxRemainLabel} ${fmtTokens(current.remainingTokens)}`);

        const exactTip = hasMax
          ? `${Number(current.usedTokens || 0).toLocaleString()} / ${Number(current.maxContextTokens || 0).toLocaleString()} tokens`
          : `${Number(current.usedTokens || 0).toLocaleString()} tokens`;

        box.appendChild(
          el('div', { className: 'ctx-numbers', title: exactTip }, [
            el('span', { className: 'ctx-used-main', text: usedMainText }),
            el('span', { className: 'ctx-used-sub', text: usedSubParts.join(' · ') }),
          ])
        );
        box.appendChild(
          el('div', { className: 'meter' }, [
            el('div', {
              className: `meter-fill ${hasMax ? contextLevelClass(ratio) : ''}`,
              style: { width: `${pctClamped}%` },
            }),
          ])
        );

        const metaItems = [];
        if (current.promptTokens > 0) {
          metaItems.push(el('span', { text: `${dict.inTok} ${fmtTokens(current.promptTokens)}` }));
        }
        if (current.responseTokens > 0) {
          metaItems.push(el('span', { text: `${dict.outTok} ${fmtTokens(current.responseTokens)}` }));
        }
        if (current.estimatedTokensUsed > 0 && current.source === 'usage') {
          metaItems.push(el('span', { text: dict.ctxEstLabel(fmtTokens(current.estimatedTokensUsed)) }));
        }
        const ts = current.lastUserViewMs || current.lastModifiedMs;
        if (ts) {
          metaItems.push(el('span', { text: fmtRelative(ts) }));
        }
        if (metaItems.length) {
          box.appendChild(el('div', { className: 'entity-sub' }, metaItems));
        }
      } else {
        box.appendChild(el('p', { className: 'empty-note', text: dict.ctxPending }));
      }
    }

    if (genInfo) {
      const genItems = [
        el('span', { className: 'ctx-gen-label', text: dict.ctxLatestGen }),
        el('span', { text: `${fmtTokens(genInfo.totalTokens)} tok` }),
      ];
      if (genInfo.tps > 0) {
        genItems.push(el('span', { text: `${genInfo.tps} tok/s` }));
      }
      if (genInfo.ttftMs > 0) {
        genItems.push(el('span', { text: `TTFT ${(genInfo.ttftMs / 1000).toFixed(2)}s` }));
      }
      if (genInfo.timestampMs) {
        genItems.push(el('span', { text: fmtRelative(genInfo.timestampMs) }));
      }
      box.appendChild(el('div', { className: 'ctx-gen-foot' }, genItems));
    }

    card.appendChild(box);
    return card;
  }

  function buildQuotaCard(quota) {
    const dict = t();
    const card = el('article', { className: 'card' });
    const head = el('div', { className: 'card-head' }, [
      el('h2', { className: 'card-title', text: dict.quotaTitle }),
      el('span', {
        className: 'tag',
        text: quota?.maskedEmail ? `${quota.maskedEmail}${quota.planName ? ` · ${quota.planName}` : ''}` : dict.quotaNote,
        title: quota?.maskedEmail ? `${quota.maskedEmail}${quota.planName ? ` · ${quota.planName}` : ''}` : dict.quotaNote,
      }),
    ]);
    card.appendChild(head);

    if (!quota?.connected || !quota.groups?.length) {
      card.appendChild(el('p', { className: 'empty-note', text: dict.quotaOffline }));
      return card;
    }

    const list = el('div', { className: 'quota-list' });
    for (const grp of quota.groups) {
      const windows = grp.windows || [];
      for (const win of windows) {
        const frac = Math.max(0, Math.min(1, Number(win.remainingFraction || 0)));
        const winLabel = win.kind === 'weekly' ? dict.quotaWinWeekly : dict.quotaWin5h;
        const resetText = win.disabled
          ? dict.quotaDisabled
          : win.resetTime
            ? dict.quotaResetIn(fmtCountdown(win.resetTime))
            : '';
        const itemChildren = [
          el('div', { className: 'quota-top' }, [
            el('span', {
              className: 'quota-name',
              text: `${grp.title} (${winLabel})`,
              title: `${grp.title} (${winLabel})`,
            }),
            el('span', {
              className: 'quota-meta',
              text: `${Math.round(frac * 100)}%${resetText ? ` · ${resetText}` : ''}`,
            }),
          ]),
          el('div', { className: 'meter' }, [
            el('div', {
              className: `meter-fill ${win.disabled ? '' : quotaLevelClass(frac)}`,
              style: { width: `${Math.round(frac * 100)}%` },
            }),
          ]),
        ];

        const fc = win.forecast;
        if (fc) {
          const currStr = dict.fcCurrUsed(fmtTokens(fc.currUsedTokens || 0));
          const prevStr = dict.fcPrevUsed(fmtTokens(fc.prevUsedTokens || 0));
          const remStr =
            fc.estimatedRemainingTokens !== null && fc.estimatedRemainingTokens !== undefined
              ? dict.fcEstRem(fmtTokens(fc.estimatedRemainingTokens))
              : dict.fcEstRemNone;

          let runwayText = dict.fcRunwayInsufficient;
          let runwayClass = 'forecast-runway';
          if (fc.status === 'depleted') {
            runwayText = dict.fcRunwayDepleted;
            runwayClass += ' danger';
          } else if (fc.estimatedRunwayMs !== null && fc.estimatedRunwayMs !== undefined) {
            const durText = fmtDurationMs(fc.estimatedRunwayMs);
            if (fc.willLastUntilReset === true) {
              runwayText = dict.fcRunwaySafe(durText);
              runwayClass += ' ok';
            } else if (fc.willLastUntilReset === false) {
              runwayText = dict.fcRunwayRisk(durText);
              runwayClass += ' warn';
            } else {
              runwayText = dict.fcRunwayNeutral(durText);
            }
          }

          const basisLabel = dict.fcRateBasis[fc.rateSource || 'none'] || fc.rateSource;
          const rateTip =
            fc.burnRatePerHour > 0 ? dict.fcRateTip(fmtTokens(fc.burnRatePerHour), basisLabel) : '';

          const fcBox = el(
            'div',
            { className: 'quota-forecast', ...(rateTip ? { title: rateTip } : {}) },
            [
              el('div', { className: 'forecast-metrics' }, [
                el('span', { text: currStr }),
                el('span', { text: prevStr }),
                el('span', { text: remStr }),
              ]),
              el('div', { className: 'forecast-foot' }, [
                el('span', { className: runwayClass, text: runwayText }),
                fc.burnRatePerHour > 0
                  ? el('span', {
                      className: 'forecast-rate',
                      text: `${fmtTokens(fc.burnRatePerHour)}/h · ${basisLabel}`,
                    })
                  : null,
              ]),
            ]
          );
          itemChildren.push(fcBox);
        }

        const item = el('div', { className: 'quota-item' }, itemChildren);
        list.appendChild(item);
      }
    }
    card.appendChild(list);
    return card;
  }

  function buildTrendCard(byDate, todayKey) {
    const dict = t();
    const dates = [];
    const base = new Date(`${todayKey}T00:00:00`);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(base.getTime() - i * 86400000);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${day}`);
    }

    const maxVal = Math.max(
      0,
      ...dates.map((dk) => Number(byDate?.[dk]?.totalTokens || 0))
    );
    // Square-root scale: on a linear axis one heavy day flattens every other
    // bar to the 2px floor, which reads as "no usage" when it is not.
    const barHeightPct = (val) =>
      val > 0 && maxVal > 0 ? Math.max(8, Math.round(Math.sqrt(val / maxVal) * 100)) : 2;

    if (!state.selectedDateKey || !dates.includes(state.selectedDateKey)) {
      state.selectedDateKey = todayKey;
    }

    const card = el('article', { className: 'card' });
    card.appendChild(
      el('div', { className: 'card-head' }, [
        el('h2', { className: 'card-title', text: dict.trendTitle }),
        el('span', {
          className: maxVal > 0 ? 'tag accent' : 'tag',
          text: maxVal > 0 ? `${dict.trendPeak} ${fmtTokens(maxVal)}` : '14d',
        }),
      ])
    );

    const bars = el('div', { className: 'chart-bars' });
    const detail = el('div', { className: 'chart-detail' });

    const updateDetail = (dk) => {
      state.selectedDateKey = dk;
      const b = byDate?.[dk];
      if (!b || !b.totalTokens) {
        detail.textContent = `${dk}: 0`;
      } else {
        detail.textContent = `${dk}: ${fmtTokens(b.totalTokens)} (${dict.inTok} ${fmtTokens(b.inputTokens)} / ${dict.cacheTok} ${fmtTokens(b.cacheReadTokens)} / ${dict.outTok} ${fmtTokens(b.outputTokens)} · ${b.generations} ${dict.gens})`;
      }
      Array.from(bars.children).forEach((col, idx) => {
        const active = dates[idx] === dk;
        col.classList.toggle('active', active);
        col.setAttribute('aria-pressed', String(active));
      });
    };

    dates.forEach((dk) => {
      const val = Number(byDate?.[dk]?.totalTokens || 0);
      const label = `${dk}: ${fmtTokens(val)}`;
      const col = el(
        'button',
        {
          type: 'button',
          className: `chart-col${dk === state.selectedDateKey ? ' active' : ''}`,
          'aria-label': label,
          'aria-pressed': String(dk === state.selectedDateKey),
          title: label,
        },
        [el('div', { className: 'chart-bar', style: { height: `${barHeightPct(val)}%` } })]
      );
      col.addEventListener('click', () => updateDetail(dk));
      bars.appendChild(col);
    });

    const axis = el('div', { className: 'chart-axis' }, [
      el('span', { text: dates[0].slice(5) }),
      el('span', { text: dates[dates.length - 1].slice(5) }),
    ]);

    updateDetail(state.selectedDateKey);
    card.appendChild(el('div', { className: 'chart-wrap' }, [bars, axis, detail]));
    return card;
  }

  function renderOverview(data) {
    const dict = t();
    const root = document.getElementById('overview-root');
    root.textContent = '';

    const merged = data.merged;
    const totals = merged.totals;
    const today = merged.today;

    // Leading metric gets a day-over-day delta; no extra node, same sub line.
    const todaySubText = () => {
      const base = `${dict.inTok} ${fmtTokens(today.inputTokens)} · ${dict.outTok} ${fmtTokens(today.outputTokens)}`;
      const yest = new Date(`${merged.todayKey}T00:00:00`);
      yest.setDate(yest.getDate() - 1);
      const yestKey = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(
        yest.getDate()
      ).padStart(2, '0')}`;
      const prevTotal = Number(merged.byDate?.[yestKey]?.totalTokens || 0);
      if (!(prevTotal > 0 && today.totalTokens > 0)) return base;
      const ratio = today.totalTokens / prevTotal - 1;
      return `${base} · ${ratio >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(ratio))} ${dict.vsPrevDay}`;
    };

    root.appendChild(buildContextCard(data.sessionContext, data.device?.local?.latestGeneration));
    root.appendChild(buildQuotaCard(data.quota));

    // Totals KPI card
    const totalsCard = el('article', { className: 'card' });
    totalsCard.appendChild(
      el('div', { className: 'card-head' }, [
        el('h2', { className: 'card-title', text: dict.totalsTitle }),
        el('span', { className: 'tag accent', text: dict.deviceCountTag(merged.deviceCount) }),
      ])
    );

    const grid = el('div', { className: 'kpi-grid' }, [
      el('div', { className: 'kpi-box' }, [
        el('div', { className: 'kpi-label', text: dict.todayLabel }),
        el('div', { className: 'kpi-value', text: fmtTokens(today.totalTokens) }),
        el('div', {
          className: 'kpi-sub',
          text: todaySubText(),
        }),
      ]),
      el('div', { className: 'kpi-box' }, [
        el('div', { className: 'kpi-label', text: dict.allTimeLabel }),
        el('div', { className: 'kpi-value', text: fmtTokens(totals.totalTokens) }),
        el('div', {
          className: 'kpi-sub',
          text: `${totals.generations} ${dict.gens}`,
        }),
      ]),
      el('div', { className: 'kpi-box' }, [
        el('div', { className: 'kpi-label', text: dict.cacheRateLabel }),
        el('div', { className: 'kpi-value', text: fmtPct(totals.cacheHitRate) }),
        el('div', {
          className: 'kpi-sub',
          text: `${dict.cacheTok} ${fmtTokens(totals.cacheReadTokens)}`,
        }),
      ]),
      el('div', { className: 'kpi-box' }, [
        el('div', { className: 'kpi-label', text: dict.devicesLabel }),
        el('div', { className: 'kpi-value', text: `${merged.deviceCount} / ${merged.conversationCount}` }),
        el('div', {
          className: 'kpi-sub',
          text: fmtRelative(data.syncStatus?.lastSyncAt),
        }),
      ]),
    ]);
    totalsCard.appendChild(grid);
    root.appendChild(totalsCard);

    // 14-day trend
    root.appendChild(buildTrendCard(merged.byDate, merged.todayKey));

    // Recent conversations
    if (merged.recentConversations?.length) {
      const liveConvMap = new Map(
        (data.sessionContext?.conversations || []).map((item) => [item.conversationId, item])
      );
      const activeConvId = data.sessionContext?.current?.conversationId || '';
      const convCard = el('article', { className: 'card' });
      convCard.appendChild(
        el('div', { className: 'card-head' }, [
          el('h2', { className: 'card-title', text: dict.recentTitle }),
        ])
      );
      const list = el('div', { className: 'conv-list' });
      for (const c of merged.recentConversations.slice(0, 8)) {
        const live = liveConvMap.get(c.conversationId);
        const ctxUsed = Number(live?.usedTokens || c.contextUsedTokens || 0);
        const ctxMax = Number(live?.maxContextTokens || c.maxContextTokens || 0);
        const modelLabel = live?.displayName || c.displayName || c.modelId || '';
        const isCurrent = activeConvId && c.conversationId === activeConvId;
        const isRunning = Boolean(live?.isRunning);

        const rowChildren = [
          el('div', { className: 'conv-top' }, [
            el('div', { className: 'conv-title-wrap' }, [
              el('span', {
                className: 'conv-title',
                text: c.title || c.conversationId,
                title: c.title || c.conversationId,
              }),
              isRunning
                ? el('span', { className: 'ctx-badge live', text: dict.ctxRunning })
                : isCurrent
                  ? el('span', { className: 'ctx-badge', text: dict.ctxActiveBadge })
                  : null,
            ]),
            el('span', { className: 'entity-val', text: fmtTokens(c.totalTokens) }),
          ]),
        ];

        if (ctxMax > 0 || ctxUsed > 0) {
          const hasMax = ctxMax > 0;
          const ratio = hasMax ? Math.max(0, ctxUsed / ctxMax) : 0;
          const pctW = hasMax ? Math.min(100, Math.max(2, Math.round(ratio * 100))) : 0;
          if (hasMax) {
            rowChildren.push(
              el('div', { className: 'meter mini' }, [
                el('div', {
                  className: `meter-fill ${contextLevelClass(ratio)}`,
                  style: { width: `${pctW}%` },
                }),
              ])
            );
          }
          const ctxText = hasMax
            ? `${dict.ctxLabelShort} ${fmtTokens(ctxUsed)} / ${fmtTokens(ctxMax)} (${fmtPct(ratio)})`
            : `${dict.ctxLabelShort} ${fmtTokens(ctxUsed)}`;
          rowChildren.push(
            el('div', { className: 'conv-ctx' }, [
              el('span', { text: ctxText }),
              modelLabel ? el('span', { text: modelLabel }) : null,
            ])
          );
        } else if (modelLabel) {
          rowChildren.push(
            el('div', { className: 'conv-ctx' }, [el('span', { text: modelLabel })])
          );
        }

        const metaLeftParts = [`${c.deviceName} · ${c.generations} ${dict.gens}`];
        if (c.latestGeneration?.tps > 0) {
          metaLeftParts.push(`${c.latestGeneration.tps} tok/s`);
        }
        rowChildren.push(
          el('div', { className: 'conv-meta' }, [
            el('span', { text: metaLeftParts.join(' · ') }),
            el('span', { text: fmtRelative(c.lastModifiedMs) }),
          ])
        );

        list.appendChild(el('div', { className: 'conv-row' }, rowChildren));
      }
      convCard.appendChild(list);
      root.appendChild(convCard);
    }
  }

  const PERIOD_KEYS = ['5h', 'today', '7d', 'all'];

  function getMergedPeriods(merged) {
    if (merged?.periods) return merged.periods;
    return {
      '5h': { totalTokens: 0, generations: 0, cacheHitRate: 0 },
      today: { ...(merged?.today || {}), cacheHitRate: 0 },
      '7d': { totalTokens: 0, generations: 0, cacheHitRate: 0 },
      all: merged?.totals || { totalTokens: 0, generations: 0, cacheHitRate: 0 },
    };
  }

  function getPeriodBucket(entity, periodKey, fallbackAllBucket) {
    if (entity?.periods?.[periodKey]) return entity.periods[periodKey];
    if (periodKey === 'all') {
      return fallbackAllBucket || entity?.totals || entity || { totalTokens: 0, generations: 0, cacheHitRate: 0, shareRatio: 0 };
    }
    if (periodKey === 'today') {
      return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: Number(entity?.todayTokens || 0),
        generations: 0,
        cacheHitRate: 0,
        shareRatio: 0,
      };
    }
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      generations: 0,
      cacheHitRate: 0,
      shareRatio: 0,
    };
  }

  function periodTabLabel(dict, key, isChip = false) {
    if (key === '5h') return dict.period5h;
    if (key === 'today') return dict.periodToday;
    if (key === '7d') return dict.period7d;
    return isChip ? dict.periodAllChip : dict.periodAll;
  }

  function rerenderPreservingFocus(root, renderBody, opts) {
    const active = document.activeElement;
    if (!opts?.fromUserAction && active && root.contains(active) && active.tagName === 'SELECT') {
      return;
    }
    const focusedPeriod =
      active && root.contains(active) ? active.getAttribute('data-period') : null;
    const focusedId =
      active && root.contains(active) && active.id ? active.id : null;
    renderBody();
    if (focusedPeriod) {
      const nextBtn = root.querySelector(`.period-btn[data-period="${focusedPeriod}"]`);
      if (nextBtn) nextBtn.focus({ preventScroll: true });
    } else if (focusedId) {
      const nextEl = document.getElementById(focusedId);
      if (nextEl) nextEl.focus({ preventScroll: true });
    }
  }

  function buildFilterSelectRow({ id, label, options, value, onChange }) {
    const select = el(
      'select',
      {
        className: 'input filter-select',
        id,
      },
      [
        el('button', { type: 'button', className: 'select-trigger' }, [el('selectedcontent')]),
        ...options.map((opt) =>
          el('option', {
            value: opt.value,
            text: opt.label,
            selected: opt.value === value ? '' : undefined,
          })
        ),
      ]
    );
    select.value = value;
    select.addEventListener('change', (e) => onChange(e.target.value));
    return el('div', { className: 'filter-bar' }, [
      el('label', { className: 'filter-label', for: id, text: label }),
      select,
    ]);
  }

  function buildPeriodSelector(mergedPeriods, activePeriod, onSelect) {
    const dict = t();
    const grid = el('div', {
      className: 'period-grid',
      role: 'group',
      'aria-label': dict.periodFilterAria,
    });
    for (const pKey of PERIOD_KEYS) {
      const b = mergedPeriods?.[pKey] || {};
      const label = periodTabLabel(dict, pKey, false);
      const hint = dict.periodHints?.[pKey] || label;
      const isSelected = pKey === activePeriod;
      const btn = el(
        'button',
        {
          type: 'button',
          className: 'period-btn',
          'data-period': pKey,
          'aria-pressed': String(isSelected),
          title: `${hint} · ${Number(b.totalTokens || 0).toLocaleString()} tokens`,
        },
        [
          el('span', { className: 'period-btn-label', text: label }),
          el('span', { className: 'period-btn-val', text: fmtTokens(b.totalTokens || 0) }),
        ]
      );
      btn.addEventListener('click', () => {
        if (pKey !== activePeriod) onSelect(pKey);
      });
      grid.appendChild(btn);
    }
    return grid;
  }

  function buildPeriodMetaBar(mergedPeriods, activePeriod) {
    const dict = t();
    const b = mergedPeriods?.[activePeriod] || {};
    const desc = dict.periodDesc?.[activePeriod] || periodTabLabel(dict, activePeriod, false);
    const items = [
      el('span', { className: 'period-meta-desc', text: desc }),
      el('span', { text: `${Number(b.generations || 0)} ${dict.gens}` }),
      el('span', { text: `${dict.cacheTok} ${fmtPct(b.cacheHitRate || 0)}` }),
    ];
    return el('div', { className: 'period-meta-bar' }, items);
  }

  function buildEntityPeriodsRow(entity, activePeriod, fallbackAllBucket) {
    const dict = t();
    const row = el('div', { className: 'entity-periods' });
    for (const pKey of PERIOD_KEYS) {
      const b = getPeriodBucket(entity, pKey, fallbackAllBucket);
      const label = periodTabLabel(dict, pKey, true);
      row.appendChild(
        el('span', {
          className: `entity-period-chip${pKey === activePeriod ? ' active' : ''}`,
          text: `${label} ${fmtTokens(b.totalTokens || 0)}`,
          title: `${dict.periodHints?.[pKey] || label}: ${Number(b.totalTokens || 0).toLocaleString()} tokens`,
        })
      );
    }
    return row;
  }

  function renderDevices(data, opts) {
    const dict = t();
    const root = document.getElementById('devices-root');
    const activePeriod = PERIOD_KEYS.includes(state.devicesPeriod) ? state.devicesPeriod : '5h';
    state.devicesPeriod = activePeriod;

    rerenderPreservingFocus(
      root,
      () => {
        root.textContent = '';

        const conflicts = data.syncStatus?.conflictFiles || [];
        if (conflicts.length > 0) {
          root.appendChild(el('div', { className: 'notice', text: dict.conflictWarning(conflicts) }));
        }

        const devices = data.merged.devices || [];
        const allModels = data.merged.models || [];
        const mergedPeriods = getMergedPeriods(data.merged);

        const card = el('article', { className: 'card' });
        card.appendChild(
          el('div', { className: 'card-head' }, [
            el('h2', { className: 'card-title', text: dict.devicesTitle }),
            el('span', { className: 'tag', text: dict.deviceCountTag(data.merged.deviceCount) }),
          ])
        );

        if (!devices.length) {
          card.appendChild(el('p', { className: 'empty-note', text: dict.noData }));
          root.appendChild(card);
          return;
        }

        // Model filter on Devices page: only live-display models with >0 usage in the active period.
        const activePeriodModels = allModels
          .map((m) => ({ model: m, bucket: getPeriodBucket(m, activePeriod, m) }))
          .filter((item) => Number(item.bucket.totalTokens || 0) > 0)
          .sort((a, b) => Number(b.bucket.totalTokens || 0) - Number(a.bucket.totalTokens || 0));

        const selectedModelItem =
          state.devicesModel !== 'all'
            ? activePeriodModels.find((item) => item.model.modelId === state.devicesModel) || null
            : null;
        if (!selectedModelItem) {
          state.devicesModel = 'all';
        }
        const selectedModel = selectedModelItem ? selectedModelItem.model : null;
        const scopePeriods = selectedModel
          ? getMergedPeriods({ periods: selectedModel.periods })
          : mergedPeriods;

        if (allModels.length) {
          const allOptLabel = activePeriodModels.length
            ? `${dict.allModelsOption} (${activePeriodModels.length}) · ${fmtTokens(mergedPeriods[activePeriod]?.totalTokens || 0)}`
            : `${dict.allModelsOption} · ${dict.noActiveModelsOption}`;
          const modelOptions = [
            { value: 'all', label: allOptLabel },
            ...activePeriodModels.map(({ model: m, bucket: mb }) => ({
              value: m.modelId,
              label: `${m.displayName || m.modelId} · ${fmtTokens(mb.totalTokens || 0)}`,
            })),
          ];
          card.appendChild(
            buildFilterSelectRow({
              id: 'devices-model-select',
              label: dict.filterModelLabel,
              options: modelOptions,
              value: state.devicesModel,
              onChange: (nextModel) => {
                state.devicesModel = nextModel;
                if (state.dashboard) renderDevices(state.dashboard, { fromUserAction: true });
              },
            })
          );
        }

        card.appendChild(
          buildPeriodSelector(scopePeriods, activePeriod, (nextPeriod) => {
            state.devicesPeriod = nextPeriod;
            if (state.dashboard) renderDevices(state.dashboard, { fromUserAction: true });
          })
        );
        card.appendChild(buildPeriodMetaBar(scopePeriods, activePeriod));

        const periodTotal = Math.max(0, Number(scopePeriods?.[activePeriod]?.totalTokens || 0));
        const getDevScopeEntity = (dev) =>
          selectedModel ? dev.models?.[selectedModel.modelId] || null : dev;
        const getDevFallbackAll = (dev) =>
          selectedModel ? dev.models?.[selectedModel.modelId]?.periods?.all || null : dev.totals;

        const sortedDevices = [...devices].sort((a, b) => {
          const aTok = Number(getPeriodBucket(getDevScopeEntity(a), activePeriod, getDevFallbackAll(a)).totalTokens || 0);
          const bTok = Number(getPeriodBucket(getDevScopeEntity(b), activePeriod, getDevFallbackAll(b)).totalTokens || 0);
          if (bTok !== aTok) return bTok - aTok;
          if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
          return Number(b.totals?.totalTokens || 0) - Number(a.totals?.totalTokens || 0);
        });

        const list = el('div', { className: 'bar-list' });
        const now = Date.now();
        for (const dev of sortedDevices) {
          const isStale = dev.updatedAt && now - dev.updatedAt > 24 * 3600 * 1000;
          const devEntity = getDevScopeEntity(dev);
          const fallbackAll = getDevFallbackAll(dev);
          const pBucket = getPeriodBucket(devEntity, activePeriod, fallbackAll);
          const pTokens = Number(pBucket.totalTokens || 0);
          const share = selectedModel
            ? periodTotal > 0
              ? pTokens / periodTotal
              : 0
            : typeof pBucket.shareRatio === 'number'
              ? pBucket.shareRatio
              : periodTotal > 0
                ? pTokens / periodTotal
                : 0;
          const pct = pTokens > 0 ? Math.max(2, Math.min(100, Math.round(share * 100))) : 0;
          const devMeta = [dev.platform, fmtRelative(dev.updatedAt)].filter(Boolean).join(' · ');

          const subItems = [
            el('span', { text: `${dict.share} ${fmtPct(share)}` }),
            el('span', { text: `${dict.cacheTok} ${fmtPct(pBucket.cacheHitRate || 0)}` }),
            el('span', { text: `${Number(pBucket.generations || 0)} ${dict.gens}` }),
          ];
          if (!selectedModel) {
            subItems.push(el('span', { text: `${dev.conversationCount} ${dict.convs}` }));
          }
          if (devMeta) subItems.push(el('span', { text: devMeta }));

          const row = el('div', { className: 'entity-row' }, [
            el('div', { className: 'entity-top' }, [
              el('div', { className: 'entity-title' }, [
                el('span', { text: dev.deviceName, title: dev.deviceName }),
                dev.isCurrent ? el('span', { className: 'tag accent', text: dict.currentDevice }) : null,
                isStale ? el('span', { className: 'tag', text: dict.staleBadge }) : null,
              ]),
              el('span', {
                className: 'entity-val',
                text: fmtTokens(pTokens),
                title: `${pTokens.toLocaleString()} tokens`,
              }),
            ]),
            el('div', { className: 'meter' }, [
              el('div', { className: 'meter-fill', style: { width: `${pct}%` } }),
            ]),
            el('div', { className: 'entity-sub' }, subItems),
            buildEntityPeriodsRow(devEntity, activePeriod, fallbackAll),
          ]);
          list.appendChild(row);
        }
        card.appendChild(list);
        root.appendChild(card);
      },
      opts
    );
  }

  function renderModels(data, opts) {
    const dict = t();
    const root = document.getElementById('models-root');
    const activePeriod = PERIOD_KEYS.includes(state.modelsPeriod) ? state.modelsPeriod : '5h';
    state.modelsPeriod = activePeriod;

    rerenderPreservingFocus(
      root,
      () => {
        root.textContent = '';

        const devices = data.merged.devices || [];
        const mergedPeriods = getMergedPeriods(data.merged);
        const allModels = data.merged.models || [];

        const selectedDevice =
          state.modelsDevice !== 'all'
            ? devices.find((d) => d.deviceId === state.modelsDevice) || null
            : null;
        if (!selectedDevice) {
          state.modelsDevice = 'all';
        }

        const scopePeriods = selectedDevice
          ? getMergedPeriods({ periods: selectedDevice.periods, totals: selectedDevice.totals })
          : mergedPeriods;
        const rawModels = selectedDevice
          ? Object.values(selectedDevice.models || {})
          : allModels;
        const periodTotal = Math.max(0, Number(scopePeriods?.[activePeriod]?.totalTokens || 0));

        const activeModels = rawModels
          .map((m) => ({ model: m, bucket: getPeriodBucket(m, activePeriod, m) }))
          .filter((item) => Number(item.bucket.totalTokens || 0) > 0)
          .sort((a, b) => Number(b.bucket.totalTokens || 0) - Number(a.bucket.totalTokens || 0));

        const card = el('article', { className: 'card' });
        card.appendChild(
          el('div', { className: 'card-head' }, [
            el('h2', { className: 'card-title', text: dict.modelsTitle }),
            allModels.length ? el('span', { className: 'tag', text: dict.modelCountTag(activeModels.length) }) : null,
          ])
        );

        if (!allModels.length) {
          card.appendChild(el('p', { className: 'empty-note', text: dict.noData }));
          root.appendChild(card);
          return;
        }

        if (devices.length) {
          const sortedDevices = [...devices].sort((a, b) => {
            const aTok = Number(getPeriodBucket(a, activePeriod, a.totals).totalTokens || 0);
            const bTok = Number(getPeriodBucket(b, activePeriod, b.totals).totalTokens || 0);
            if (bTok !== aTok) return bTok - aTok;
            if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
            return Number(b.totals?.totalTokens || 0) - Number(a.totals?.totalTokens || 0);
          });
          const deviceOptions = [
            {
              value: 'all',
              label: `${dict.allDevicesOption} (${devices.length}) · ${fmtTokens(mergedPeriods[activePeriod]?.totalTokens || 0)}`,
            },
            ...sortedDevices.map((dev) => {
              const dTok = Number(getPeriodBucket(dev, activePeriod, dev.totals).totalTokens || 0);
              const name = dev.isCurrent ? `${dev.deviceName} (${dict.currentDevice})` : dev.deviceName;
              return {
                value: dev.deviceId,
                label: `${name} · ${fmtTokens(dTok)}`,
              };
            }),
          ];
          card.appendChild(
            buildFilterSelectRow({
              id: 'models-device-select',
              label: dict.filterDeviceLabel,
              options: deviceOptions,
              value: state.modelsDevice,
              onChange: (nextDevice) => {
                state.modelsDevice = nextDevice;
                if (state.dashboard) renderModels(state.dashboard, { fromUserAction: true });
              },
            })
          );
        }

        card.appendChild(
          buildPeriodSelector(scopePeriods, activePeriod, (nextPeriod) => {
            state.modelsPeriod = nextPeriod;
            if (state.dashboard) renderModels(state.dashboard, { fromUserAction: true });
          })
        );
        card.appendChild(buildPeriodMetaBar(scopePeriods, activePeriod));

        if (!activeModels.length) {
          const desc = dict.periodDesc?.[activePeriod] || periodTabLabel(dict, activePeriod, false);
          const emptyMsg = selectedDevice
            ? dict.noScopePeriodData(selectedDevice.deviceName, desc)
            : dict.noPeriodData(desc);
          card.appendChild(el('p', { className: 'empty-note', text: emptyMsg }));
          root.appendChild(card);
          return;
        }

        const list = el('div', { className: 'bar-list' });
        for (const { model: m, bucket: pBucket } of activeModels) {
          const pTokens = Number(pBucket.totalTokens || 0);
          const share =
            typeof pBucket.shareRatio === 'number'
              ? pBucket.shareRatio
              : periodTotal > 0
                ? pTokens / periodTotal
                : 0;
          const pct = pTokens > 0 ? Math.max(2, Math.min(100, Math.round(share * 100))) : 0;

          list.appendChild(
            el('div', { className: 'entity-row' }, [
              el('div', { className: 'entity-top' }, [
                el('span', { className: 'entity-title' }, [
                  // inner span: text-overflow needs a block, and the row is a flex
                  // container once the name is wrapped in an element of its own
                  el('span', { text: m.displayName || m.modelId, title: m.displayName || m.modelId }),
                ]),
                el('span', {
                  className: 'entity-val',
                  text: fmtTokens(pTokens),
                  title: `${pTokens.toLocaleString()} tokens`,
                }),
              ]),
              el('div', { className: 'meter' }, [
                el('div', { className: 'meter-fill', style: { width: `${pct}%` } }),
              ]),
              el('div', { className: 'entity-sub' }, [
                el('span', { text: `${dict.inTok} ${fmtTokens(pBucket.inputTokens || 0)}` }),
                el('span', { text: `${dict.cacheTok} ${fmtTokens(pBucket.cacheReadTokens || 0)}` }),
                el('span', { text: `${dict.outTok} ${fmtTokens(pBucket.outputTokens || 0)}` }),
                el('span', { text: `${Number(pBucket.generations || 0)} ${dict.gens} · ${fmtPct(share)}` }),
              ]),
              buildEntityPeriodsRow(m, activePeriod, m),
            ])
          );
        }
        card.appendChild(list);
        root.appendChild(card);
      },
      opts
    );
  }

  function renderSettings(data, forceReset) {
    const dict = t();
    const settings = data.settings || {};

    document.getElementById('settings-device-id').textContent = data.device?.deviceId || '--';

    const syncDirInput = document.getElementById('input-syncdir');
    const davUrlInput = document.getElementById('input-dav-url');
    const davPathInput = document.getElementById('input-dav-path');
    const davUserInput = document.getElementById('input-dav-user');
    const davPassInput = document.getElementById('input-dav-pass');
    const davPassHint = document.getElementById('dav-pass-hint');
    const clearPassBtn = document.getElementById('btn-clear-davpass');
    const devNameInput = document.getElementById('input-devicename');
    const intervalInput = document.getElementById('input-interval');
    const langSelect = document.getElementById('input-lang');

    const hasSavedPass = Boolean(settings.webdav?.hasPassword) && !state.clearPassword;
    davPassInput.placeholder = hasSavedPass ? dict.passPlaceholderSaved : dict.passPlaceholderNew;
    clearPassBtn.hidden = !hasSavedPass;
    if (state.clearPassword) {
      davPassHint.hidden = false;
      davPassHint.textContent = dict.passClearedMsg;
    } else if (hasSavedPass) {
      davPassHint.hidden = false;
      davPassHint.textContent = dict.passSavedHint;
    } else {
      davPassHint.hidden = true;
    }

    const activeInSettingsForm =
      document.activeElement &&
      document.getElementById('settings-form')?.contains(document.activeElement);

    if ((!state.settingsDirty && !activeInSettingsForm) || forceReset) {
      applySyncModeUi(settings.syncMode || (settings.syncDir ? 'folder' : 'local-only'));
      syncDirInput.value = settings.syncDir || '';
      davUrlInput.value = settings.webdav?.url || '';
      davPathInput.value = settings.webdav?.remotePath || '/agy-sync-dashboard';
      davUserInput.value = settings.webdav?.username || '';
      davPassInput.value = '';
      devNameInput.value = settings.deviceName || '';
      intervalInput.value = String(Math.max(3, Math.round(Number(settings.syncIntervalMs || 30000) / 1000)));
      langSelect.value = settings.language || state.lang;
    }

    const diag = document.getElementById('settings-diag');
    diag.textContent = '';
    if (data.syncStatus?.syncDir) {
      diag.appendChild(el('div', { text: `${dict.diagSyncDir}: ${data.syncStatus.syncDir}` }));
    }
    if (data.syncStatus?.remoteDirUrl) {
      diag.appendChild(el('div', { text: `${dict.diagRemoteDir}: ${data.syncStatus.remoteDirUrl}` }));
    }
    if (data.syncStatus?.snapshotPath) {
      diag.appendChild(el('div', { text: `${dict.diagSnapshot}: ${data.syncStatus.snapshotPath}` }));
    }
    if (data.syncStatus?.error) {
      diag.appendChild(el('div', { text: `${dict.diagSyncError}: ${data.syncStatus.error}` }));
    }
    diag.appendChild(el('div', { text: `${dict.diagLastSync}: ${fmtRelative(data.syncStatus?.lastSyncAt)}` }));
  }

  function scheduleFullRefreshTimer() {
    if (state.fullRefreshTimer) {
      clearInterval(state.fullRefreshTimer);
    }
    const intervalMs = Math.max(3000, Number(state.refreshIntervalMs || 30000));
    state.fullRefreshTimer = setInterval(() => {
      if (document.hidden) return;
      void loadDashboard({ force: true }).catch(() => {});
    }, intervalMs);
  }

  function renderAll(data, opts) {
    state.dashboard = data;
    state.lastDashboardFetchAt = Date.now();
    if (typeof data?.revision === 'number') {
      state.lastRevision = data.revision;
    }
    const ctxCur = data?.sessionContext?.current;
    state.lastContextSig = ctxCur
      ? `${ctxCur.conversationId}|${ctxCur.usedTokens}|${ctxCur.maxContextTokens}`
      : '';
    const nextInterval = Math.max(3000, Number(data?.settings?.syncIntervalMs || 30000));
    if (nextInterval !== state.refreshIntervalMs || !state.fullRefreshTimer) {
      state.refreshIntervalMs = nextInterval;
      scheduleFullRefreshTimer();
    }
    syncHostTheme(data?.hostTheme);
    if ((!state.settingsDirty || opts?.forceSettingsReset) && data?.settings?.language && I18N[data.settings.language]) {
      state.lang = data.settings.language;
    }
    applyStaticLabels();
    renderTopStatus(data);
    renderOverview(data);
    renderDevices(data);
    renderModels(data);
    renderSettings(data, Boolean(opts?.forceSettingsReset));
  }

  async function loadDashboard(opts) {
    if (state.inFlightLoad && !opts?.force) {
      return state.inFlightLoad;
    }
    const q = new URLSearchParams();
    if (opts?.force) q.set('force', '1');
    const suffix = q.toString() ? `?${q.toString()}` : '';
    const pending = requestJson(`/api/dashboard${suffix}`, { method: 'GET' })
      .then((data) => {
        renderAll(data);
        return data;
      })
      .finally(() => {
        if (state.inFlightLoad === pending) {
          state.inFlightLoad = null;
        }
      });
    state.inFlightLoad = pending;
    return pending;
  }

  async function triggerSync() {
    if (state.syncing) return;
    const btn = document.getElementById('btn-sync');
    state.syncing = true;
    btn.disabled = true;
    document.documentElement.classList.add('agy-syncing');
    applyStaticLabels();
    try {
      const data = await requestJson('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      renderAll(data);
    } finally {
      state.syncing = false;
      btn.disabled = false;
      document.documentElement.classList.remove('agy-syncing');
      applyStaticLabels();
    }
  }

  function readDraftSettingsPayload() {
    const passVal = document.getElementById('input-dav-pass').value;
    return {
      syncMode: state.selectedSyncMode,
      syncDir: document.getElementById('input-syncdir').value.trim(),
      webdav: {
        url: document.getElementById('input-dav-url').value.trim(),
        remotePath: document.getElementById('input-dav-path').value.trim() || '/agy-sync-dashboard',
        username: document.getElementById('input-dav-user').value.trim(),
        ...(passVal ? { password: passVal } : {}),
        ...(state.clearPassword && !passVal ? { clearPassword: true } : {}),
      },
      deviceName: document.getElementById('input-devicename').value.trim(),
      syncIntervalMs:
        Math.min(86400, Math.max(3, Math.round(Number(document.getElementById('input-interval').value) || 30))) * 1000,
      language: document.getElementById('input-lang').value,
    };
  }

  function showTestBox(ok, message) {
    const box = document.getElementById('test-result-box');
    box.hidden = false;
    box.className = `test-box ${ok ? 'ok' : 'err'}`;
    box.textContent = message;
  }

  function setupActions() {
    document.getElementById('btn-sync').addEventListener('click', () => {
      void triggerSync();
    });

    const settingsForm = document.getElementById('settings-form');
    settingsForm.addEventListener('input', () => {
      state.settingsDirty = true;
    });
    settingsForm.addEventListener('change', () => {
      state.settingsDirty = true;
    });

    document.getElementById('input-lang').addEventListener('change', (e) => {
      const nextLang = e.target.value;
      if (I18N[nextLang]) {
        state.lang = nextLang;
        applyStaticLabels();
        if (state.dashboard) {
          renderTopStatus(state.dashboard);
          renderOverview(state.dashboard);
          renderDevices(state.dashboard);
          renderModels(state.dashboard);
          renderSettings(state.dashboard, false);
        }
      }
    });

    document.querySelectorAll('#sync-mode-group .mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.settingsDirty = true;
        document.getElementById('test-result-box').hidden = true;
        applySyncModeUi(btn.dataset.mode);
      });
    });

    document.querySelectorAll('[data-dav-url]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.settingsDirty = true;
        const urlEl = document.getElementById('input-dav-url');
        urlEl.value = btn.dataset.davUrl || '';
        const pathEl = document.getElementById('input-dav-path');
        if (!pathEl.value.trim()) pathEl.value = '/agy-sync-dashboard';
        urlEl.focus();
      });
    });

    document.getElementById('btn-clear-davpass').addEventListener('click', () => {
      state.settingsDirty = true;
      state.clearPassword = true;
      const passEl = document.getElementById('input-dav-pass');
      passEl.value = '';
      if (state.dashboard) renderSettings(state.dashboard, false);
    });

    document.getElementById('btn-pick-folder').addEventListener('click', async () => {
      const btn = document.getElementById('btn-pick-folder');
      btn.disabled = true;
      btn.textContent = t().pickingBtn;
      try {
        const res = await requestJson('/api/settings/pick-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            initialDir: document.getElementById('input-syncdir').value.trim(),
            language: state.lang,
          }),
        });
        if (!res?.cancelled && res?.path) {
          document.getElementById('input-syncdir').value = res.path;
          state.settingsDirty = true;
        } else if (res?.error) {
          showTestBox(false, res.error);
        }
      } catch (err) {
        showTestBox(false, err?.message || 'Error');
      } finally {
        btn.disabled = false;
        btn.textContent = t().pickFolderBtn;
      }
    });

    const runTest = async (target, btnEl, defaultText) => {
      btnEl.disabled = true;
      btnEl.textContent = t().testingBtn;
      try {
        const res = await requestJson('/api/settings/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...readDraftSettingsPayload(), target }),
        });
        if (target === 'folder') {
          if (res?.folder?.ok) {
            showTestBox(true, t().testFolderOk(res.folder.deviceFiles || []));
          } else {
            showTestBox(false, t().testFail(res?.folder?.error || 'Unknown error'));
          }
        } else {
          if (res?.webdav?.ok) {
            showTestBox(
              true,
              t().testWebdavOk(res.webdav.latencyMs || 0, res.webdav.deviceFiles || [], res.webdav.remoteDirUrl || '')
            );
          } else {
            showTestBox(false, t().testFail(res?.webdav?.error || 'Unknown error'));
          }
        }
      } catch (err) {
        showTestBox(false, t().testFail(err?.message || 'Error'));
      } finally {
        btnEl.disabled = false;
        btnEl.textContent = defaultText;
      }
    };

    document.getElementById('btn-test-folder').addEventListener('click', (e) => {
      void runTest('folder', e.currentTarget, t().testFolderBtn);
    });
    document.getElementById('btn-test-webdav').addEventListener('click', (e) => {
      void runTest('webdav', e.currentTarget, t().testWebdavBtn);
    });

    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('btn-save-settings');
      const feedback = document.getElementById('settings-feedback');
      const payload = readDraftSettingsPayload();
      saveBtn.disabled = true;
      saveBtn.textContent = t().savingBtn;
      feedback.textContent = '';

      try {
        const res = await requestJson('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        state.settingsDirty = false;
        state.clearPassword = false;
        if (res?.dashboard) {
          renderAll(res.dashboard, { forceSettingsReset: true });
        } else {
          await loadDashboard({ force: true });
        }
        feedback.textContent = t().savedMsg;
        setTimeout(() => {
          feedback.textContent = '';
        }, 3000);
      } catch (err) {
        feedback.textContent = err?.message || 'Error';
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = t().saveBtn;
      }
    });
  }

  function startAutoRefresh() {
    scheduleFullRefreshTimer();

    const checkForUpdates = async () => {
      if (document.hidden || state.inFlightLoad || state.syncing) return;
      if (!state.versionEndpointSupported) {
        if (Date.now() - state.lastDashboardFetchAt >= 5000) {
          await loadDashboard().catch(() => {});
        }
        return;
      }
      try {
        const res = await apiFetch('/api/version', { method: 'GET' });
        if (res.status === 404) {
          state.versionEndpointSupported = false;
          return;
        }
        if (!res.ok) return;
        const ver = await res.json();
        const verCtxSig = ver?.activeConvId
          ? `${ver.activeConvId}|${ver.activeUsedTokens || 0}|${ver.activeMaxContextTokens || 0}`
          : '';
        const ctxChanged = Boolean(verCtxSig && verCtxSig !== state.lastContextSig);
        if ((typeof ver?.revision === 'number' && ver.revision !== state.lastRevision) || ctxChanged) {
          await loadDashboard().catch(() => {});
        }
      } catch {
        // Ignore transient network errors during sidecar reload
      }
    };

    setInterval(() => {
      void checkForUpdates();
    }, 3000);

    setInterval(() => {
      if (document.hidden || !state.dashboard || state.inFlightLoad) return;
      renderAll(state.dashboard);
    }, 15000);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void loadDashboard({ force: true }).catch(() => {});
      }
    });

    window.addEventListener('focus', () => {
      if (Date.now() - state.lastDashboardFetchAt > 2500) {
        void loadDashboard().catch(() => {});
      }
    });
  }

  watchHostTheme();
  setupTabs();
  setupActions();
  startAutoRefresh();
  void loadDashboard().catch((err) => {
    const root = document.getElementById('overview-root');
    root.textContent = '';
    root.appendChild(
      el('article', { className: 'card' }, [
        el('p', { className: 'empty-note', text: err?.message || t().loadFailed }),
      ])
    );
  });
})();
