import * as vscode from 'vscode';

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

export function getPanelHtml(webview: vscode.Webview): string {
  const nonce = getNonce();
  const csp = [
    `default-src 'none'`,
    `style-src 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>apibird</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 12px;
    margin: 0;
  }
  .request-bar { display: flex; gap: 6px; margin-bottom: 12px; }
  select, input, textarea, button {
    font-family: inherit;
    font-size: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 6px 8px;
    border-radius: 2px;
  }
  #url { flex: 1; }
  button {
    cursor: pointer;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: none;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    color: var(--vscode-foreground);
    background: transparent;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  }
  button.secondary:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,0.15)); }
  .tabs, .resp-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 10px; }
  .tab, .rtab {
    background: transparent; color: var(--vscode-foreground);
    border: none; border-bottom: 2px solid transparent; border-radius: 0;
    padding: 6px 10px; opacity: 0.7;
  }
  .tab.active, .rtab.active { opacity: 1; border-bottom-color: var(--vscode-focusBorder); }
  .panel.hidden, .resp-panel.hidden { display: none; }
  .header-row { display: flex; gap: 6px; margin-bottom: 6px; }
  .header-row input { flex: 1; }
  .header-row .remove { flex: 0 0 auto; padding: 4px 10px; }
  textarea { width: 100%; min-height: 140px; resize: vertical; font-family: var(--vscode-editor-font-family, monospace); }
  .response { margin-top: 18px; }
  #status-line { margin: 10px 0; font-weight: 600; }
  .status-ok { color: var(--vscode-testing-iconPassed, #4caf50); }
  .status-err { color: var(--vscode-testing-iconFailed, #f44336); }
  .status-warn { color: var(--vscode-editorWarning-foreground, #cca700); }
  .muted { opacity: 0.7; font-weight: 400; margin-left: 10px; }
  pre {
    white-space: pre-wrap; word-break: break-word;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.1));
    padding: 10px; border-radius: 3px; max-height: 420px; overflow: auto;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  #auth-type { margin-bottom: 10px; }
  .auth-fields { display: flex; flex-direction: column; gap: 6px; max-width: 360px; }
  .auth-fields.hidden { display: none; }
</style>
</head>
<body>
  <div class="request-bar">
    <select id="method">
      <option>GET</option>
      <option>POST</option>
      <option>PUT</option>
      <option>PATCH</option>
      <option>DELETE</option>
      <option>HEAD</option>
      <option>OPTIONS</option>
    </select>
    <input id="url" type="text" placeholder="https://api.example.com/users" />
    <button id="send">Send</button>
    <button class="secondary" id="save">Save</button>
  </div>

  <div class="tabs">
    <button class="tab" data-tab="params">Params</button>
    <button class="tab active" data-tab="headers">Headers</button>
    <button class="tab" data-tab="body">Body</button>
    <button class="tab" data-tab="auth">Auth</button>
  </div>

  <div id="params-panel" class="panel hidden">
    <div id="params-list"></div>
    <button class="secondary" id="add-param">+ Add param</button>
  </div>

  <div id="headers-panel" class="panel">
    <div id="headers-list"></div>
    <button class="secondary" id="add-header">+ Add header</button>
  </div>

  <div id="body-panel" class="panel hidden">
    <textarea id="body" placeholder='{ "key": "value" }'></textarea>
  </div>

  <div id="auth-panel" class="panel hidden">
    <select id="auth-type">
      <option value="none">None</option>
      <option value="bearer">Bearer Token</option>
      <option value="basic">Basic Auth</option>
    </select>
    <div id="auth-bearer" class="auth-fields hidden">
      <input id="auth-token" type="text" placeholder="Token" />
    </div>
    <div id="auth-basic" class="auth-fields hidden">
      <input id="auth-username" type="text" placeholder="Username" />
      <input id="auth-password" type="password" placeholder="Password" />
    </div>
  </div>

  <div class="response" id="response" style="display:none;">
    <div id="status-line"></div>
    <div class="resp-tabs">
      <button class="rtab active" data-rtab="resp-body">Body</button>
      <button class="rtab" data-rtab="resp-headers">Headers</button>
    </div>
    <pre id="resp-body" class="resp-panel"></pre>
    <pre id="resp-headers" class="resp-panel hidden"></pre>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  // --- request tab switching ---
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      const target = t.getAttribute('data-tab');
      document.querySelectorAll('.panel').forEach((p) => {
        p.classList.toggle('hidden', p.id !== target + '-panel');
      });
    });
  });

  // --- response tab switching ---
  document.querySelectorAll('.rtab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.rtab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      const target = t.getAttribute('data-rtab');
      document.getElementById('resp-body').classList.toggle('hidden', target !== 'resp-body');
      document.getElementById('resp-headers').classList.toggle('hidden', target !== 'resp-headers');
    });
  });

  // --- dynamic header rows ---
  const headersList = document.getElementById('headers-list');
  function addHeaderRow(key, value) {
    const row = document.createElement('div');
    row.className = 'header-row';
    const k = document.createElement('input');
    k.placeholder = 'Key'; k.value = key || '';
    const v = document.createElement('input');
    v.placeholder = 'Value'; v.value = value || '';
    const rm = document.createElement('button');
    rm.className = 'secondary remove'; rm.textContent = '✕';
    rm.addEventListener('click', () => row.remove());
    row.append(k, v, rm);
    headersList.appendChild(row);
  }
  function clearHeaderRows() {
    headersList.innerHTML = '';
  }
  document.getElementById('add-header').addEventListener('click', () => addHeaderRow());
  addHeaderRow('Content-Type', 'application/json');

  function collectHeaders() {
    const headers = {};
    headersList.querySelectorAll('.header-row').forEach((row) => {
      const [k, v] = row.querySelectorAll('input');
      if (k.value.trim()) headers[k.value.trim()] = v.value;
    });
    return headers;
  }
  function collectHeaderPairs() {
    const pairs = [];
    headersList.querySelectorAll('.header-row').forEach((row) => {
      const [k, v] = row.querySelectorAll('input');
      if (k.value.trim()) pairs.push({ key: k.value.trim(), value: v.value });
    });
    return pairs;
  }

  // --- dynamic param rows, two-way synced with the URL query string ---
  const paramsList = document.getElementById('params-list');
  const urlInput = document.getElementById('url');
  let syncingParams = false;

  function addParamRow(key, value) {
    const row = document.createElement('div');
    row.className = 'header-row';
    const k = document.createElement('input');
    k.placeholder = 'Key'; k.value = key || '';
    const v = document.createElement('input');
    v.placeholder = 'Value'; v.value = value || '';
    const rm = document.createElement('button');
    rm.className = 'secondary remove'; rm.textContent = '✕';
    rm.addEventListener('click', () => { row.remove(); syncUrlFromParams(); });
    k.addEventListener('input', syncUrlFromParams);
    v.addEventListener('input', syncUrlFromParams);
    row.append(k, v, rm);
    paramsList.appendChild(row);
  }
  function clearParamRows() {
    paramsList.innerHTML = '';
  }
  function collectParamPairs() {
    const pairs = [];
    paramsList.querySelectorAll('.header-row').forEach((row) => {
      const [k, v] = row.querySelectorAll('input');
      if (k.value.trim()) pairs.push({ key: k.value.trim(), value: v.value });
    });
    return pairs;
  }
  function urlWithoutQuery(url) {
    const i = url.indexOf('?');
    return i === -1 ? url : url.slice(0, i);
  }
  function paramsFromUrl(url) {
    const i = url.indexOf('?');
    if (i === -1) return [];
    const qs = url.slice(i + 1);
    if (!qs) return [];
    return qs.split('&').filter(Boolean).map((pair) => {
      const [k, v] = pair.split('=');
      const decode = (s) => { try { return decodeURIComponent((s || '').replace(/\\+/g, ' ')); } catch { return s || ''; } };
      return { key: decode(k), value: decode(v) };
    });
  }
  function syncUrlFromParams() {
    if (syncingParams) return;
    syncingParams = true;
    const pairs = collectParamPairs();
    const qs = pairs.map((p) => encodeURIComponent(p.key) + '=' + encodeURIComponent(p.value)).join('&');
    urlInput.value = qs ? urlWithoutQuery(urlInput.value) + '?' + qs : urlWithoutQuery(urlInput.value);
    syncingParams = false;
  }
  function syncParamsFromUrl() {
    if (syncingParams) return;
    syncingParams = true;
    const pairs = paramsFromUrl(urlInput.value);
    clearParamRows();
    pairs.forEach((p) => addParamRow(p.key, p.value));
    if (pairs.length === 0) addParamRow();
    syncingParams = false;
  }
  document.getElementById('add-param').addEventListener('click', () => addParamRow());
  urlInput.addEventListener('input', syncParamsFromUrl);
  addParamRow();

  // --- auth tab ---
  const authType = document.getElementById('auth-type');
  function updateAuthFieldsVisibility() {
    document.getElementById('auth-bearer').classList.toggle('hidden', authType.value !== 'bearer');
    document.getElementById('auth-basic').classList.toggle('hidden', authType.value !== 'basic');
  }
  authType.addEventListener('change', updateAuthFieldsVisibility);
  updateAuthFieldsVisibility();

  function collectAuth() {
    if (authType.value === 'bearer') {
      return { type: 'bearer', token: document.getElementById('auth-token').value };
    }
    if (authType.value === 'basic') {
      return {
        type: 'basic',
        username: document.getElementById('auth-username').value,
        password: document.getElementById('auth-password').value,
      };
    }
    return { type: 'none' };
  }
  function loadAuth(auth) {
    authType.value = (auth && auth.type) || 'none';
    document.getElementById('auth-token').value = auth && auth.type === 'bearer' ? auth.token || '' : '';
    document.getElementById('auth-username').value = auth && auth.type === 'basic' ? auth.username || '' : '';
    document.getElementById('auth-password').value = auth && auth.type === 'basic' ? auth.password || '' : '';
    updateAuthFieldsVisibility();
  }

  // --- send ---
  document.getElementById('send').addEventListener('click', () => {
    const statusLine = document.getElementById('status-line');
    document.getElementById('response').style.display = 'block';
    statusLine.textContent = 'Sending…';
    statusLine.className = '';
    vscode.postMessage({
      type: 'send',
      payload: {
        method: document.getElementById('method').value,
        url: document.getElementById('url').value.trim(),
        headers: collectHeaders(),
        body: document.getElementById('body').value,
        auth: collectAuth(),
      },
    });
  });

  document.getElementById('url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('send').click();
  });

  // --- save ---
  document.getElementById('save').addEventListener('click', () => {
    vscode.postMessage({
      type: 'save',
      payload: {
        method: document.getElementById('method').value,
        url: document.getElementById('url').value.trim(),
        headers: collectHeaderPairs(),
        params: collectParamPairs(),
        body: document.getElementById('body').value,
        auth: collectAuth(),
      },
    });
  });

  // --- receive ---
  function pretty(text) {
    try { return JSON.stringify(JSON.parse(text), null, 2); }
    catch { return text; }
  }
  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    return (bytes / 1024).toFixed(1) + ' KB';
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    const statusLine = document.getElementById('status-line');
    if (msg.type === 'response') {
      const p = msg.payload;
      const ok = p.status >= 200 && p.status < 400;
      statusLine.className = ok ? 'status-ok' : 'status-err';
      statusLine.innerHTML = p.status + ' ' + p.statusText +
        '<span class="muted">' + p.time + ' ms · ' + fmtSize(p.size) + '</span>';
      document.getElementById('resp-body').textContent = pretty(p.body);
      document.getElementById('resp-headers').textContent =
        Object.entries(p.headers).map(([k, v]) => k + ': ' + v).join('\\n');
    } else if (msg.type === 'error') {
      statusLine.className = 'status-err';
      statusLine.innerHTML = 'Request failed <span class="muted">' + msg.payload.time + ' ms</span>';
      document.getElementById('resp-body').textContent = msg.payload.message;
      document.getElementById('resp-headers').textContent = '';
    } else if (msg.type === 'unresolved') {
      statusLine.className = 'status-warn';
      statusLine.textContent = 'Unresolved variables — not sent: ' +
        msg.payload.tokens.map((t) => '{{' + t + '}}').join(', ');
      document.getElementById('resp-body').textContent = '';
      document.getElementById('resp-headers').textContent = '';
    } else if (msg.type === 'loadRequest') {
      const r = msg.payload;
      document.getElementById('method').value = r.method;
      document.getElementById('url').value = r.url;
      document.getElementById('body').value = r.body || '';
      clearHeaderRows();
      (r.headers || []).forEach((h) => addHeaderRow(h.key, h.value));
      if ((r.headers || []).length === 0) addHeaderRow();
      syncParamsFromUrl();
      loadAuth(r.auth);
    }
  });
</script>
</body>
</html>`;
}
