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
      settingsTitle: '多设备同步设置',
      labelSyncDir: '同步文件夹路径 (Syncthing / 网盘)',
      labelDeviceName: '本机显示名称',
      labelLang: '界面语言',
      saveBtn: '保存并立即同步',
      savingBtn: '保存中…',
      savedMsg: '已保存并完成同步',
      detectedPrefix: '已检测目录: ',
      diagSyncDir: '同步目录',
      diagSnapshot: '本机快照',
      diagLastSync: '最近同步',
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
      settingsTitle: 'Multi-Device Sync Settings',
      labelSyncDir: 'Sync Folder Path (Syncthing / Cloud Drive)',
      labelDeviceName: 'This Device Display Name',
      labelLang: 'Language',
      saveBtn: 'Save & Sync Now',
      savingBtn: 'Saving…',
      savedMsg: 'Saved and synced',
      detectedPrefix: 'Detected: ',
      diagSyncDir: 'Sync folder',
      diagSnapshot: 'Local snapshot',
      diagLastSync: 'Last sync',
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
    document.getElementById('ui-label-syncdir').textContent = dict.labelSyncDir;
    document.getElementById('ui-label-devicename').textContent = dict.labelDeviceName;
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

  function renderSettings(data) {
    const dict = t();
    const settings = data.settings || {};
    const candidates = data.candidates || [];

    document.getElementById('settings-device-id').textContent = data.device?.deviceId || '--';

    const syncDirInput = document.getElementById('input-syncdir');
    const devNameInput = document.getElementById('input-devicename');
    const langSelect = document.getElementById('input-lang');

    if (document.activeElement !== syncDirInput) {
      syncDirInput.value = settings.syncDir || '';
    }
    if (document.activeElement !== devNameInput) {
      devNameInput.value = settings.deviceName || '';
    }
    if (document.activeElement !== langSelect) {
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
        });
        candRow.appendChild(chip);
      }
    } else {
      candRow.hidden = true;
    }

    const diag = document.getElementById('settings-diag');
    diag.textContent = '';
    diag.appendChild(el('div', { text: `${dict.diagSyncDir}: ${data.syncStatus?.syncDir || '(not set)'}` }));
    if (data.syncStatus?.snapshotPath) {
      diag.appendChild(el('div', { text: `${dict.diagSnapshot}: ${data.syncStatus.snapshotPath}` }));
    }
    diag.appendChild(el('div', { text: `${dict.diagLastSync}: ${fmtRelative(data.syncStatus?.lastSyncAt)}` }));
  }

  function renderAll(data) {
    state.dashboard = data;
    if (data?.settings?.language && (data.settings.language === 'zh-CN' || data.settings.language === 'en')) {
      state.lang = data.settings.language;
    }
    applyStaticLabels();
    renderTopStatus(data);
    renderOverview(data);
    renderDevices(data);
    renderModels(data);
    renderSettings(data);
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

  function setupActions() {
    document.getElementById('btn-sync').addEventListener('click', () => {
      void triggerSync();
    });

    document.getElementById('settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('btn-save-settings');
      const feedback = document.getElementById('settings-feedback');
      const payload = {
        syncDir: document.getElementById('input-syncdir').value.trim(),
        deviceName: document.getElementById('input-devicename').value.trim(),
        language: document.getElementById('input-lang').value,
      };
      saveBtn.disabled = true;
      saveBtn.textContent = t().savingBtn;
      feedback.textContent = '';

      try {
        const res = await requestJson('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res?.dashboard) {
          renderAll(res.dashboard);
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
