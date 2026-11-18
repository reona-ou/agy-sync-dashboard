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
      totalsTitle: '多设备累计用量',
      todayLabel: '今日累计',
      allTimeLabel: '历史总计',
      cacheRateLabel: '综合缓存命中率',
      devicesLabel: '同步设备 / 会话数',
      latestGenTitle: '本机最近一次生成',
      trendTitle: '近 14 天多设备趋势',
      recentTitle: '最近对话 (跨设备)',
      devicesTitle: '参与合并的设备',
      modelsTitle: '模型用量汇总 (跨设备)',
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
      pickFolderBtn: '选择目录…',
      pickingBtn: '选择中…',
      testFolderBtn: '测试目录',
      webdavSectionTitle: 'WebDAV 云同步',
      testWebdavBtn: '测试连接',
      testingBtn: '测试中…',
      presetsLabel: '常用模板:',
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
      labelInterval: '自动同步间隔',
      labelLang: '界面语言',
      saveBtn: '保存并立即同步',
      savingBtn: '保存中…',
      savedMsg: '已保存并完成同步',
      detectedPrefix: '已检测目录: ',
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
      totalsTitle: 'Multi-Device Summed Usage',
      todayLabel: 'Today (All Devices)',
      allTimeLabel: 'All-Time Sum',
      cacheRateLabel: 'Blended Cache Hit',
      devicesLabel: 'Devices / Conversations',
      latestGenTitle: 'Latest Local Generation',
      trendTitle: '14-Day Multi-Device Trend',
      recentTitle: 'Recent Conversations (All Devices)',
      devicesTitle: 'Synced Devices Breakdown',
      modelsTitle: 'Usage by Model (Merged)',
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
      pickFolderBtn: 'Browse…',
      pickingBtn: 'Opening…',
      testFolderBtn: 'Test Folder',
      webdavSectionTitle: 'WebDAV Remote Sync',
      testWebdavBtn: 'Test Connection',
      testingBtn: 'Testing…',
      presetsLabel: 'Presets:',
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
      labelInterval: 'Auto-Sync Interval',
      labelLang: 'Language',
      saveBtn: 'Save & Sync Now',
      savingBtn: 'Saving…',
      savedMsg: 'Saved and synced',
      detectedPrefix: 'Detected: ',
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
  };

  let state = {
    lang: 'zh-CN',
    dashboard: null,
    selectedDateKey: null,
    syncing: false,
    settingsDirty: false,
    selectedSyncMode: 'folder',
    clearPassword: false,
  };

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

  function fmtCountdown(isoTime) {
    if (!isoTime) return '';
    const target = Date.parse(isoTime);
    if (!Number.isFinite(target)) return '';
    const diff = Math.max(0, target - Date.now());
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hrs >= 24) {
      const days = Math.floor(hrs / 24);
      return `${days}d ${hrs % 24}h`;
    }
    return hrs > 0 ? `${hrs}h ${remMins}m` : `${remMins}m`;
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
    document.getElementById('ui-title').textContent = dict.title;
    document.getElementById('ui-sync-label').textContent = state.syncing ? dict.syncingBtn : dict.syncBtn;
    document.getElementById('tab-overview').textContent = dict.tabs.overview;
    document.getElementById('tab-devices').textContent = dict.tabs.devices;
    document.getElementById('tab-models').textContent = dict.tabs.models;
    document.getElementById('tab-settings').textContent = dict.tabs.settings;
    document.getElementById('ui-settings-title').textContent = dict.settingsTitle;
    document.getElementById('ui-label-syncmode').textContent = dict.labelSyncMode;
    document.getElementById('mode-btn-folder').textContent = dict.modeFolder;
    document.getElementById('mode-btn-webdav').textContent = dict.modeWebdav;
    document.getElementById('mode-btn-both').textContent = dict.modeBoth;
    document.getElementById('mode-btn-local').textContent = dict.modeLocal;
    document.getElementById('ui-folder-section-title').textContent = dict.folderSectionTitle;
    document.getElementById('btn-pick-folder').textContent = dict.pickFolderBtn;
    document.getElementById('btn-test-folder').textContent = dict.testFolderBtn;
    document.getElementById('ui-webdav-section-title').textContent = dict.webdavSectionTitle;
    document.getElementById('btn-test-webdav').textContent = dict.testWebdavBtn;
    document.getElementById('ui-presets-label').textContent = dict.presetsLabel;
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

  function buildQuotaCard(quota) {
    const dict = t();
    const card = el('article', { className: 'card' });
    const head = el('div', { className: 'card-head' }, [
      el('h2', { className: 'card-title', text: dict.quotaTitle }),
      el('span', {
        className: 'tag',
        text: quota?.maskedEmail ? `${quota.maskedEmail}${quota.planName ? ` · ${quota.planName}` : ''}` : dict.quotaNote,
      }),
    ]);
    card.appendChild(head);

    if (!quota?.connected || !quota.groups?.length) {
      card.appendChild(el('p', { className: 'muted', text: dict.quotaOffline }));
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
        const item = el('div', { className: 'quota-item' }, [
          el('div', { className: 'quota-top' }, [
            el('span', { className: 'quota-name', text: `${grp.title} (${winLabel})` }),
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
        ]);
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
      1,
      ...dates.map((dk) => Number(byDate?.[dk]?.totalTokens || 0))
    );

    if (!state.selectedDateKey || !dates.includes(state.selectedDateKey)) {
      state.selectedDateKey = todayKey;
    }

    const card = el('article', { className: 'card' });
    card.appendChild(
      el('div', { className: 'card-head' }, [
        el('h2', { className: 'card-title', text: dict.trendTitle }),
        el('span', { className: 'tag', text: '14d' }),
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
        col.classList.toggle('active', dates[idx] === dk);
      });
    };

    dates.forEach((dk) => {
      const val = Number(byDate?.[dk]?.totalTokens || 0);
      const pct = val > 0 ? Math.max(4, Math.round((val / maxVal) * 100)) : 3;
      const col = el(
        'div',
        {
          className: `chart-col${dk === state.selectedDateKey ? ' active' : ''}`,
          title: `${dk}: ${fmtTokens(val)}`,
        },
        [el('div', { className: 'chart-bar', style: { height: `${pct}%` } })]
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

    root.appendChild(buildQuotaCard(data.quota));

    // Totals KPI card
    const totalsCard = el('article', { className: 'card' });
    totalsCard.appendChild(
      el('div', { className: 'card-head' }, [
        el('h2', { className: 'card-title', text: dict.totalsTitle }),
        el('span', { className: 'tag accent', text: `${merged.deviceCount} ${dict.devicesLabel.split('/')[0].trim()}` }),
      ])
    );

    const grid = el('div', { className: 'kpi-grid' }, [
      el('div', { className: 'kpi-box' }, [
        el('div', { className: 'kpi-label', text: dict.todayLabel }),
        el('div', { className: 'kpi-value', text: fmtTokens(today.totalTokens) }),
        el('div', {
          className: 'kpi-sub',
          text: `${dict.inTok} ${fmtTokens(today.inputTokens)} · ${dict.outTok} ${fmtTokens(today.outputTokens)}`,
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

    // Latest local generation
    const latest = data.device?.local?.latestGeneration;
    if (latest) {
      const latestCard = el('article', { className: 'card' });
      latestCard.appendChild(
        el('div', { className: 'card-head' }, [
          el('h2', { className: 'card-title', text: dict.latestGenTitle }),
          el('span', { className: 'tag', text: fmtRelative(latest.timestampMs) }),
        ])
      );
      latestCard.appendChild(
        el('div', { className: 'entity-sub' }, [
          el('strong', { text: latest.displayName }),
          el('span', { text: `${fmtTokens(latest.totalTokens)} tok` }),
          latest.tps > 0 ? el('span', { text: `${latest.tps} tok/s` }) : null,
          latest.ttftMs > 0 ? el('span', { text: `TTFT ${(latest.ttftMs / 1000).toFixed(2)}s` }) : null,
        ])
      );
      root.appendChild(latestCard);
    }

    // 14-day trend
    root.appendChild(buildTrendCard(merged.byDate, merged.todayKey));

    // Recent conversations
    if (merged.recentConversations?.length) {
      const convCard = el('article', { className: 'card' });
      convCard.appendChild(
        el('div', { className: 'card-head' }, [
          el('h2', { className: 'card-title', text: dict.recentTitle }),
        ])
      );
      const list = el('div', { className: 'conv-list' });
      for (const c of merged.recentConversations.slice(0, 8)) {
        list.appendChild(
          el('div', { className: 'conv-row' }, [
            el('div', { className: 'conv-top' }, [
              el('span', { className: 'conv-title', text: c.title || c.conversationId }),
              el('span', { className: 'entity-val', text: fmtTokens(c.totalTokens) }),
            ]),
            el('div', { className: 'conv-meta' }, [
              el('span', { text: `${c.deviceName} · ${c.generations} ${dict.gens}` }),
              el('span', { text: fmtRelative(c.lastModifiedMs) }),
            ]),
          ])
        );
      }
      convCard.appendChild(list);
      root.appendChild(convCard);
    }
  }

  function renderDevices(data) {
    const dict = t();
    const root = document.getElementById('devices-root');
    root.textContent = '';

    const conflicts = data.syncStatus?.conflictFiles || [];
    if (conflicts.length > 0) {
      root.appendChild(el('div', { className: 'notice', text: dict.conflictWarning(conflicts) }));
    }

    const card = el('article', { className: 'card' });
    card.appendChild(
      el('div', { className: 'card-head' }, [
        el('h2', { className: 'card-title', text: dict.devicesTitle }),
        el('span', { className: 'tag', text: String(data.merged.deviceCount) }),
      ])
    );

    const devices = data.merged.devices || [];
    if (!devices.length) {
      card.appendChild(el('p', { className: 'muted', text: dict.noData }));
      root.appendChild(card);
      return;
    }

    const list = el('div', { className: 'bar-list' });
    const now = Date.now();
    for (const dev of devices) {
      const isStale = dev.updatedAt && now - dev.updatedAt > 24 * 3600 * 1000;
      const pct = Math.max(0, Math.min(100, Math.round(dev.shareRatio * 100)));
      const row = el('div', { className: 'entity-row' }, [
        el('div', { className: 'entity-top' }, [
          el('div', { className: 'entity-title' }, [
            el('span', { text: dev.deviceName }),
            dev.isCurrent ? el('span', { className: 'tag accent', text: dict.currentDevice }) : null,
            isStale ? el('span', { className: 'tag', text: dict.staleBadge }) : null,
          ]),
          el('span', { className: 'entity-val', text: fmtTokens(dev.totals.totalTokens) }),
        ]),
        el('div', { className: 'meter' }, [
          el('div', { className: 'meter-fill', style: { width: `${Math.max(2, pct)}%` } }),
        ]),
        el('div', { className: 'entity-sub' }, [
          el('span', { text: `${dict.todayShort} ${fmtTokens(dev.todayTokens)}` }),
          el('span', { text: `${dict.share} ${fmtPct(dev.shareRatio)}` }),
          el('span', { text: `${dict.cacheTok} ${fmtPct(dev.totals.cacheHitRate)}` }),
          el('span', { text: `${dev.conversationCount} ${dict.convs}` }),
          el('span', { text: `${dev.platform || ''} · ${fmtRelative(dev.updatedAt)}` }),
        ]),
      ]);
      list.appendChild(row);
    }
    card.appendChild(list);
    root.appendChild(card);
  }

  function renderModels(data) {
    const dict = t();
    const root = document.getElementById('models-root');
    root.textContent = '';

    const card = el('article', { className: 'card' });
    card.appendChild(
      el('div', { className: 'card-head' }, [
        el('h2', { className: 'card-title', text: dict.modelsTitle }),
      ])
    );

    const models = data.merged.models || [];
    if (!models.length) {
      card.appendChild(el('p', { className: 'muted', text: dict.noData }));
      root.appendChild(card);
      return;
    }

    const total = Math.max(1, data.merged.totals.totalTokens);
    const list = el('div', { className: 'bar-list' });
    for (const m of models) {
      const share = m.totalTokens / total;
      list.appendChild(
        el('div', { className: 'entity-row' }, [
          el('div', { className: 'entity-top' }, [
            el('span', { className: 'entity-title', text: m.displayName || m.modelId }),
            el('span', { className: 'entity-val', text: fmtTokens(m.totalTokens) }),
          ]),
          el('div', { className: 'meter' }, [
            el('div', { className: 'meter-fill', style: { width: `${Math.max(2, Math.round(share * 100))}%` } }),
          ]),
          el('div', { className: 'entity-sub' }, [
            el('span', { text: `${dict.inTok} ${fmtTokens(m.inputTokens)}` }),
            el('span', { text: `${dict.cacheTok} ${fmtTokens(m.cacheReadTokens)}` }),
            el('span', { text: `${dict.outTok} ${fmtTokens(m.outputTokens)}` }),
            el('span', { text: `${m.generations} ${dict.gens} · ${fmtPct(share)}` }),
          ]),
        ])
      );
    }
    card.appendChild(list);
    root.appendChild(card);
  }

  function renderSettings(data, forceReset) {
    const dict = t();
    const settings = data.settings || {};
    const candidates = data.candidates || [];

    document.getElementById('settings-device-id').textContent = data.device?.deviceId || '--';

    const syncDirInput = document.getElementById('input-syncdir');
    const davUrlInput = document.getElementById('input-dav-url');
    const davPathInput = document.getElementById('input-dav-path');
    const davUserInput = document.getElementById('input-dav-user');
    const davPassInput = document.getElementById('input-dav-pass');
    const davPassHint = document.getElementById('dav-pass-hint');
    const clearPassBtn = document.getElementById('btn-clear-davpass');
    const devNameInput = document.getElementById('input-devicename');
    const intervalSelect = document.getElementById('input-interval');
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

    if (!state.settingsDirty || forceReset) {
      applySyncModeUi(settings.syncMode || (settings.syncDir ? 'folder' : 'local-only'));
      syncDirInput.value = settings.syncDir || '';
      davUrlInput.value = settings.webdav?.url || '';
      davPathInput.value = settings.webdav?.remotePath || '/agy-sync-dashboard';
      davUserInput.value = settings.webdav?.username || '';
      davPassInput.value = '';
      devNameInput.value = settings.deviceName || '';
      intervalSelect.value = String(settings.syncIntervalMs || 30000);
      langSelect.value = settings.language || state.lang;
    }

    const candRow = document.getElementById('sync-candidates');
    candRow.textContent = '';
    if (candidates.length) {
      candRow.hidden = false;
      candRow.appendChild(el('span', { className: 'field-label', text: dict.detectedPrefix }));
      for (const c of candidates) {
        const chip = el('button', { type: 'button', className: 'chip-btn mono', text: c });
        chip.addEventListener('click', () => {
          syncDirInput.value = c;
          state.settingsDirty = true;
        });
        candRow.appendChild(chip);
      }
    } else {
      candRow.hidden = true;
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

  function renderAll(data, opts) {
    state.dashboard = data;
    if (data?.settings?.language && (data.settings.language === 'zh-CN' || data.settings.language === 'en')) {
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
    const q = new URLSearchParams();
    if (opts?.force) q.set('force', '1');
    const suffix = q.toString() ? `?${q.toString()}` : '';
    const data = await requestJson(`/api/dashboard${suffix}`, { method: 'GET' });
    renderAll(data);
  }

  async function triggerSync() {
    if (state.syncing) return;
    const btn = document.getElementById('btn-sync');
    state.syncing = true;
    btn.disabled = true;
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
      syncIntervalMs: Number(document.getElementById('input-interval').value || 30000),
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
          body: JSON.stringify({ initialDir: document.getElementById('input-syncdir').value.trim() }),
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

  setupTabs();
  setupActions();
  void loadDashboard().catch((err) => {
    const root = document.getElementById('overview-root');
    root.textContent = '';
    root.appendChild(
      el('article', { className: 'card' }, [
        el('p', { className: 'muted', text: err?.message || 'Failed to load dashboard' }),
      ])
    );
  });

  setInterval(() => {
    void loadDashboard().catch(() => {});
  }, 30000);
})();
