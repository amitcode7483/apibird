import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('restTester.open', () => {
    RestPanel.createOrShow();
  });
  context.subscriptions.push(disposable);
}

export function deactivate() {}

interface RequestMessage {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

class RestPanel {
  public static currentPanel: RestPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow() {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (RestPanel.currentPanel) {
      RestPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'restTester',
      'REST Tester',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    RestPanel.currentPanel = new RestPanel(panel);
  }

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
    this._panel.webview.html = this._getHtml(this._panel.webview);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: { type: string; payload: RequestMessage }) => {
        if (message.type === 'send') {
          await this._handleRequest(message.payload);
        }
      },
      null,
      this._disposables
    );
  }

  private async _handleRequest(req: RequestMessage) {
    const start = Date.now();
    try {
      const options: RequestInit = {
        method: req.method,
        headers: req.headers,
      };
      const noBody = req.method === 'GET' || req.method === 'HEAD';
      if (!noBody && req.body && req.body.trim().length > 0) {
        options.body = req.body;
      }

      const res = await fetch(req.url, options);
      const elapsed = Date.now() - start;
      const text = await res.text();

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });

      this._panel.webview.postMessage({
        type: 'response',
        payload: {
          status: res.status,
          statusText: res.statusText,
          time: elapsed,
          size: new TextEncoder().encode(text).length,
          headers,
          body: text,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this._panel.webview.postMessage({
        type: 'error',
        payload: { message, time: Date.now() - start },
      });
    }
  }

  public dispose() {
    RestPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }
  }

  private _getHtml(webview: vscode.Webview): string {
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
<title>REST Tester</title>
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
  .muted { opacity: 0.7; font-weight: 400; margin-left: 10px; }
  pre {
    white-space: pre-wrap; word-break: break-word;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.1));
    padding: 10px; border-radius: 3px; max-height: 420px; overflow: auto;
    font-family: var(--vscode-editor-font-family, monospace);
  }
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
  </div>

  <div class="tabs">
    <button class="tab active" data-tab="headers">Headers</button>
    <button class="tab" data-tab="body">Body</button>
  </div>

  <div id="headers-panel" class="panel">
    <div id="headers-list"></div>
    <button class="secondary" id="add-header">+ Add header</button>
  </div>

  <div id="body-panel" class="panel hidden">
    <textarea id="body" placeholder='{ "key": "value" }'></textarea>
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
      document.getElementById('headers-panel').classList.toggle('hidden', target !== 'headers');
      document.getElementById('body-panel').classList.toggle('hidden', target !== 'body');
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
    rm.className = 'secondary remove'; rm.textContent = '\u2715';
    rm.addEventListener('click', () => row.remove());
    row.append(k, v, rm);
    headersList.appendChild(row);
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

  // --- send ---
  document.getElementById('send').addEventListener('click', () => {
    const statusLine = document.getElementById('status-line');
    document.getElementById('response').style.display = 'block';
    statusLine.textContent = 'Sending\u2026';
    statusLine.className = '';
    vscode.postMessage({
      type: 'send',
      payload: {
        method: document.getElementById('method').value,
        url: document.getElementById('url').value.trim(),
        headers: collectHeaders(),
        body: document.getElementById('body').value,
      },
    });
  });

  document.getElementById('url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('send').click();
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
        '<span class="muted">' + p.time + ' ms \u00b7 ' + fmtSize(p.size) + '</span>';
      document.getElementById('resp-body').textContent = pretty(p.body);
      document.getElementById('resp-headers').textContent =
        Object.entries(p.headers).map(([k, v]) => k + ': ' + v).join('\\n');
    } else if (msg.type === 'error') {
      statusLine.className = 'status-err';
      statusLine.innerHTML = 'Request failed <span class="muted">' + msg.payload.time + ' ms</span>';
      document.getElementById('resp-body').textContent = msg.payload.message;
      document.getElementById('resp-headers').textContent = '';
    }
  });
</script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
