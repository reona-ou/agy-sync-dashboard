(function () {
  'use strict';

  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  if (!vscode) return;

  let seq = 0;
  const pending = new Map();

  function makeResponse(status, ok, bodyText) {
    return {
      status,
      ok,
      headers: {
        get(name) {
          return String(name || '').toLowerCase() === 'content-type'
            ? 'application/json; charset=utf-8'
            : null;
        },
      },
      async text() {
        return bodyText;
      },
      async json() {
        return bodyText ? JSON.parse(bodyText) : {};
      },
    };
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'agy-api-res') {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) {
        entry.reject(new Error(msg.error));
      } else {
        entry.resolve(makeResponse(msg.status || 200, Boolean(msg.ok), msg.bodyText || ''));
      }
      return;
    }

    if (msg.type === 'agy-theme') {
      const root = document.documentElement;
      if (msg.mode) {
        root.dataset.theme = msg.mode === 'light' ? 'light' : 'dark';
      }
      const styleEl = document.getElementById('vscode-theme-vars');
      if (styleEl && typeof msg.themeCss === 'string') {
        styleEl.textContent = msg.themeCss;
      }
      window.postMessage({ type: 'theme-change' }, '*');
      return;
    }

    if (msg.type === 'agy-refresh') {
      const syncBtn = document.getElementById('btn-sync');
      if (syncBtn && !syncBtn.disabled) {
        syncBtn.click();
      }
    }
  });

  window.sidecar = {
    fetch(url, options) {
      const id = ++seq;
      const method = (options && options.method ? String(options.method) : 'GET').toUpperCase();
      const body = options && typeof options.body === 'string' ? options.body : '';
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Extension host API timeout'));
        }, 30000);
        pending.set(id, { resolve, reject, timer });
        vscode.postMessage({
          type: 'agy-api',
          id,
          url: String(url || '/'),
          method,
          body,
        });
      });
    },
  };
})();
