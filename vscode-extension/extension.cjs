'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { createBackendClient } = require('./backend-client.cjs');

const DASHBOARD_VIEW_ID = 'agySyncDashboard.sidebarView';
const DASHBOARD_CONTAINER_ID = 'agy-sync-dashboard';

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
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtDurationMs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '--';
  const totalMins = Math.round(Math.max(0, ms) / 60000);
  if (totalMins < 1) return '<1m';
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs >= 24 * 30) return '>30d';
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

function shortQuotaCode(grp) {
  if (grp?.family === 'gemini') return 'G';
  if (grp?.family === 'claude_gpt') return 'C';
  if (grp?.family === 'argon') return 'A';
  return String(grp?.title || '?').trim().charAt(0).toUpperCase() || '?';
}

function buildVscodeThemeCss() {
  const kind = vscode.window.activeColorTheme.kind;
  const isLight = kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
  const mode = isLight ? 'light' : 'dark';
  const css = `:root {
  color-scheme: ${mode};
  --theme-mode: ${mode};
  --background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  --theme-bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
  --theme-fg: var(--vscode-foreground);
  --theme-font-sans: var(--vscode-font-family, system-ui, -apple-system, "Segoe UI", sans-serif);
  --theme-font-mono: var(--vscode-editor-font-family, ui-monospace, "Cascadia Mono", Consolas, monospace);
}`;
  return { mode, themeCss: css };
}

function buildWebviewHtml(webview, extensionPath, runtimeRoot) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const dashboardDir = path.join(runtimeRoot, 'sidecars', 'dashboard');
  const rawHtml = fs.readFileSync(path.join(dashboardDir, 'index.html'), 'utf8');

  const stylesUri = webview.asWebviewUri(vscode.Uri.file(path.join(dashboardDir, 'styles.css')));
  const appUri = webview.asWebviewUri(vscode.Uri.file(path.join(dashboardDir, 'app.js')));
  const bridgeUri = webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'webview-bridge.js')));
  const { themeCss } = buildVscodeThemeCss();

  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
  ].join('; ');

  return rawHtml
    .replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`)
    .replace('<script src="preload.js"></script>', `<script nonce="${nonce}" src="${bridgeUri}"></script>`)
    .replace(
      /<link rel="stylesheet" href="theme\.css[^"]*">/,
      `<style id="vscode-theme-vars">${themeCss}</style>`
    )
    .replace(/href="styles\.css[^"]*"/, `href="${stylesUri}"`)
    .replace(/src="app\.js[^"]*"/, `nonce="${nonce}" src="${appUri}"`);
}

function formatStatusBarCapsule(data) {
  const cur = data?.sessionContext?.current || null;
  const gen = cur?.latestGeneration || data?.device?.local?.latestGeneration || null;
  const quota = data?.quota || null;

  const segs = [];
  let maxWarnLevel = 0; // 0 ok, 1 warn, 2 danger

  // 1. Context usage
  const hasMax = Number(cur?.maxContextTokens || 0) > 0;
  const ratio = hasMax ? Math.max(0, Number(cur.usageRatio || 0)) : 0;
  if (hasMax) {
    segs.push(`${(ratio * 100).toFixed(0)}% (${fmtTokens(cur.usedTokens)}/${fmtTokens(cur.maxContextTokens)})`);
    if (ratio >= 0.9) maxWarnLevel = Math.max(maxWarnLevel, 2);
    else if (ratio >= 0.75) maxWarnLevel = Math.max(maxWarnLevel, 1);
  } else if (Number(cur?.usedTokens || 0) > 0) {
    segs.push(`Ctx ${fmtTokens(cur.usedTokens)}`);
  } else {
    segs.push('Ctx --');
  }

  // 2. Multi-model quota summary
  if (quota?.connected && Array.isArray(quota.groups) && quota.groups.length) {
    const qParts = [];
    for (const grp of quota.groups) {
      const wins = grp.windows || [];
      const primary = wins.find((w) => w.kind === '5h' && !w.disabled) || wins.find((w) => !w.disabled) || wins[0];
      if (!primary || primary.remainingFraction === null || primary.remainingFraction === undefined) continue;
      const frac = Math.max(0, Math.min(1, Number(primary.remainingFraction)));
      qParts.push(`${shortQuotaCode(grp)} ${Math.round(frac * 100)}%`);
      if (frac <= 0.15) maxWarnLevel = Math.max(maxWarnLevel, 2);
      else if (frac <= 0.4) maxWarnLevel = Math.max(maxWarnLevel, 1);
    }
    segs.push(qParts.length ? qParts.slice(0, 3).join(' ') : 'Quota --');
  } else {
    segs.push('RPC --');
  }

  // 3. Cache hit rate
  const hasTurnCache = Number(cur?.inputTokens || 0) + Number(cur?.cacheReadTokens || 0) > 0;
  const hasSessCache = Number(cur?.sessionInputTokens || 0) + Number(cur?.sessionCacheReadTokens || 0) > 0;
  const cacheRate = hasTurnCache
    ? cur.cacheHitRate
    : hasSessCache
      ? cur.sessionCacheHitRate
      : null;
  segs.push(typeof cacheRate === 'number' ? `⚡${Math.round(cacheRate * 100)}%` : '⚡--');

  // 4. Generation speed
  const tps = Number(gen?.tps || 0);
  if (cur?.isRunning && !(tps > 0)) {
    segs.push('gen…');
  } else if (tps > 0) {
    segs.push(`${tps} t/s`);
  }

  const icon = cur?.isRunning ? '$(loading~spin)' : '$(pulse)';
  const text = `${icon} ${segs.join(' · ')}`;

  // Rich hover tooltip
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = false;
  md.supportHtml = false;

  const title = cur?.title || 'AGY Sync Dashboard';
  const modelName = cur?.displayName || cur?.modelId || gen?.displayName || '';
  md.appendMarkdown(`**${title}**${modelName ? ` · \`${modelName}\`` : ''}\n\n`);

  if (cur && (hasMax || cur.usedTokens > 0)) {
    md.appendMarkdown(
      `- **Context**: ${fmtTokens(cur.usedTokens)}${hasMax ? ` / ${fmtTokens(cur.maxContextTokens)} (**${fmtPct(ratio)}**, left ${fmtTokens(cur.remainingTokens)})` : ''}\n`
    );
    const parts = [];
    if (cur.inputTokens > 0) parts.push(`In ${fmtTokens(cur.inputTokens)}`);
    if (cur.cacheReadTokens > 0) parts.push(`CacheR ${fmtTokens(cur.cacheReadTokens)}`);
    if (cur.cacheWriteTokens > 0) parts.push(`CacheW ${fmtTokens(cur.cacheWriteTokens)}`);
    if (cur.responseTokens > 0) parts.push(`Out ${fmtTokens(cur.responseTokens)}`);
    if (parts.length) {
      md.appendMarkdown(`  - Breakdown: ${parts.join(' · ')}\n`);
    }
  }

  if (typeof cacheRate === 'number') {
    const ageStr = gen?.timestampMs ? ` (${fmtRelative(gen.timestampMs)})` : '';
    md.appendMarkdown(
      `- **Cache**: Last turn ${hasTurnCache ? fmtPct(cur.cacheHitRate) : '--'} · Session ${hasSessCache ? fmtPct(cur.sessionCacheHitRate) : '--'}${ageStr}\n`
    );
  }

  if (gen) {
    const ttftStr = gen.ttftMs > 0 ? ` · TTFT ${(gen.ttftMs / 1000).toFixed(2)}s` : '';
    md.appendMarkdown(
      `- **Speed**: ${tps > 0 ? `${tps} tok/s` : '--'}${ttftStr} · ${fmtTokens(gen.totalTokens)} tok\n`
    );
  }

  if (quota?.connected && quota.groups?.length) {
    md.appendMarkdown(`\n**Account Quotas**${quota.maskedEmail ? ` (${quota.maskedEmail})` : ''}\n`);
    for (const grp of quota.groups) {
      for (const win of grp.windows || []) {
        const frac = Math.max(0, Math.min(1, Number(win.remainingFraction || 0)));
        const winLabel = win.kind === 'weekly' ? '7d' : '5h';
        const resetStr = win.disabled ? 'Unavailable' : win.resetTime ? `resets in ${fmtCountdown(win.resetTime)}` : '';
        const runway = win.forecast?.estimatedRunwayMs != null ? ` · ~${fmtDurationMs(win.forecast.estimatedRunwayMs)} left` : '';
        md.appendMarkdown(
          `- ${grp.title} (${winLabel}): **${Math.round(frac * 100)}%**${resetStr ? ` · ${resetStr}` : ''}${runway}\n`
        );
      }
    }
  } else {
    md.appendMarkdown(`\n*Antigravity RPC offline*\n`);
  }

  md.appendMarkdown(`\n*Click to open AGY Sync Dashboard*`);

  return { text, tooltip: md, warnLevel: maxWarnLevel };
}

async function activate(context) {
  const cfg = vscode.workspace.getConfiguration('agySyncDashboard');
  const nodePath = cfg.get('nodePath', '');

  let backend = null;
  let backendError = null;
  try {
    backend = await createBackendClient(context.extensionPath, { nodePath });
  } catch (err) {
    backendError = err;
  }

  const webviews = new Set();

  const broadcastMessage = (msg) => {
    for (const view of webviews) {
      try {
        void view.postMessage(msg);
      } catch {}
    }
  };

  const wireWebview = (webview) => {
    webviews.add(webview);
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(context.extensionPath),
        ...(backend ? [vscode.Uri.file(backend.runtimeRoot)] : []),
      ],
    };

    if (!backend) {
      webview.html = `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:16px;"><h3>AGY Sync Dashboard</h3><p>${
        String(backendError?.message || 'Backend initialization failed').replace(/[<>&]/g, '')
      }</p></body></html>`;
      return;
    }

    webview.html = buildWebviewHtml(webview, context.extensionPath, backend.runtimeRoot);

    webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== 'object' || msg.type !== 'agy-api') return;
      const { id, url, method, body } = msg;
      try {
        const parsed = new URL(url || '/', 'http://127.0.0.1');
        if (parsed.pathname === '/api/settings/pick-folder' && String(method).toUpperCase() === 'POST') {
          let initialDir = '';
          try {
            initialDir = JSON.parse(body || '{}')?.initialDir || '';
          } catch {}
          const defaultUri = initialDir && fs.existsSync(initialDir) ? vscode.Uri.file(initialDir) : undefined;
          const picked = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri,
          });
          const respBody =
            picked && picked.length > 0
              ? { cancelled: false, path: picked[0].fsPath }
              : { cancelled: true, path: '' };
          void webview.postMessage({
            type: 'agy-api-res',
            id,
            status: 200,
            ok: true,
            bodyText: JSON.stringify(respBody),
          });
          return;
        }

        const res = await backend.handleApi(url, method, body);
        void webview.postMessage({
          type: 'agy-api-res',
          id,
          status: res.status,
          ok: res.ok,
          bodyText: res.bodyText,
        });
        if (parsed.pathname === '/api/sync' || parsed.pathname === '/api/settings') {
          void refreshStatusBar(true);
        }
      } catch (err) {
        void webview.postMessage({
          type: 'agy-api-res',
          id,
          status: 500,
          ok: false,
          error: err?.message || 'Bridge error',
        });
      }
    });
  };

  let sidebarViewRef = null;
  let editorPanelRef = null;

  const sidebarProvider = {
    resolveWebviewView(webviewView) {
      sidebarViewRef = webviewView;
      wireWebview(webviewView.webview);
      webviewView.onDidDispose(() => {
        webviews.delete(webviewView.webview);
        if (sidebarViewRef === webviewView) sidebarViewRef = null;
      });
    },
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DASHBOARD_VIEW_ID, sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Bottom Status Bar Capsule
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'agySyncDashboard.openDashboard';
  statusBarItem.text = '$(pulse) AGY --';
  statusBarItem.tooltip = 'AGY Sync Dashboard';
  context.subscriptions.push(statusBarItem);

  let statusTimer = null;
  let inFlightStatus = false;

  async function refreshStatusBar(forceQuota = false) {
    const enabled = vscode.workspace.getConfiguration('agySyncDashboard').get('statusBar.enabled', true);
    if (!enabled) {
      statusBarItem.hide();
      return;
    }
    if (!backend) {
      statusBarItem.text = '$(warning) AGY offline';
      statusBarItem.tooltip = backendError?.message || 'Backend unavailable';
      statusBarItem.show();
      return;
    }
    if (inFlightStatus) return;
    inFlightStatus = true;
    try {
      const q = forceQuota ? '?force=1&quotaRefresh=1' : '';
      const res = await backend.handleApi(`/api/dashboard${q}`, 'GET', '');
      if (res.ok && res.bodyText) {
        const data = JSON.parse(res.bodyText);
        const formatted = formatStatusBarCapsule(data);
        statusBarItem.text = formatted.text;
        statusBarItem.tooltip = formatted.tooltip;
        if (formatted.warnLevel === 2) {
          statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else if (formatted.warnLevel === 1) {
          statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
          statusBarItem.backgroundColor = undefined;
        }
        statusBarItem.show();
      }
    } catch {
      // Keep previous status bar value on transient errors
    } finally {
      inFlightStatus = false;
    }
  }

  function scheduleStatusTimer() {
    if (statusTimer) clearInterval(statusTimer);
    const secs = Math.max(3, Math.min(300, Number(vscode.workspace.getConfiguration('agySyncDashboard').get('statusBar.refreshSeconds', 5))));
    statusTimer = setInterval(() => {
      if (!vscode.window.state.focused) return;
      void refreshStatusBar(false);
    }, secs * 1000);
  }

  scheduleStatusTimer();
  void refreshStatusBar(false);

  context.subscriptions.push({
    dispose() {
      if (statusTimer) clearInterval(statusTimer);
    },
  });

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      const { mode, themeCss } = buildVscodeThemeCss();
      broadcastMessage({ type: 'agy-theme', mode, themeCss });
    }),
    vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) void refreshStatusBar(false);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agySyncDashboard.statusBar')) {
        scheduleStatusTimer();
        void refreshStatusBar(false);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agySyncDashboard.openDashboard', async () => {
      try {
        await vscode.commands.executeCommand(`workbench.view.extension.${DASHBOARD_CONTAINER_ID}`);
      } catch {}
      if (sidebarViewRef) {
        sidebarViewRef.show(false);
      }
      void refreshStatusBar(true);
    }),
    vscode.commands.registerCommand('agySyncDashboard.openPanel', () => {
      if (editorPanelRef) {
        editorPanelRef.reveal(vscode.ViewColumn.Beside);
        return;
      }
      const panel = vscode.window.createWebviewPanel(
        'agySyncDashboard.panel',
        'AGY Sync Dashboard',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      editorPanelRef = panel;
      wireWebview(panel.webview);
      panel.onDidDispose(() => {
        webviews.delete(panel.webview);
        if (editorPanelRef === panel) editorPanelRef = null;
      });
    }),
    vscode.commands.registerCommand('agySyncDashboard.syncNow', async () => {
      broadcastMessage({ type: 'agy-refresh' });
      await refreshStatusBar(true);
    }),
    vscode.commands.registerCommand('agySyncDashboard.toggleStatusBar', async () => {
      const conf = vscode.workspace.getConfiguration('agySyncDashboard');
      const curVal = conf.get('statusBar.enabled', true);
      await conf.update('statusBar.enabled', !curVal, vscode.ConfigurationTarget.Global);
      void refreshStatusBar(false);
    })
  );

  context.subscriptions.push({
    dispose() {
      if (backend) void backend.dispose();
    },
  });
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  formatStatusBarCapsule,
};
