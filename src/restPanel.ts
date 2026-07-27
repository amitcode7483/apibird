import * as vscode from 'vscode';
import { getPanelHtml } from './panelHtml';
import { CollectionsStore, EnvironmentsStore, HistoryStore, newId } from './storage';
import { CollectionsProvider } from './collectionsProvider';
import { HistoryProvider } from './historyProvider';
import { addCollection, addFolder, saveRequest as saveRequestOp } from './collectionsOps';
import { substituteVars } from './environments';
import { AuthConfig, HistoryEntry, KeyValue, SavedRequest } from './types';

interface RequestMessage {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  auth: AuthConfig;
}

interface SaveMessage {
  method: string;
  url: string;
  headers: KeyValue[];
  params: KeyValue[];
  body: string;
  auth: AuthConfig;
}

export interface RestPanelDeps {
  context: vscode.ExtensionContext;
  collectionsStore: CollectionsStore;
  collectionsProvider: CollectionsProvider;
  environmentsStore: EnvironmentsStore;
  historyStore: HistoryStore;
  historyProvider: HistoryProvider;
}

const NEW_COLLECTION_PICK = '$(add) New Collection…';
const NO_FOLDER_PICK = '(No folder — save directly in collection)';
const NEW_FOLDER_PICK = '$(add) New Folder…';

export class RestPanel {
  public static currentPanel: RestPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(deps: RestPanelDeps): RestPanel {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (RestPanel.currentPanel) {
      RestPanel.currentPanel._panel.reveal(column);
      return RestPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'restTester',
      'apibird',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    RestPanel.currentPanel = new RestPanel(panel, deps);
    return RestPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, private deps: RestPanelDeps) {
    this._panel = panel;
    this._panel.webview.html = getPanelHtml(this._panel.webview);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: { type: string; payload: unknown }) => {
        if (message.type === 'send') {
          await this._handleRequest(message.payload as RequestMessage);
        } else if (message.type === 'save') {
          await this._handleSave(message.payload as SaveMessage);
        }
      },
      null,
      this._disposables
    );
  }

  public loadRequest(request: SavedRequest): void {
    this._panel.reveal();
    this._panel.webview.postMessage({ type: 'loadRequest', payload: request });
  }

  public loadFromHistory(entry: HistoryEntry): void {
    this._panel.reveal();
    this._panel.webview.postMessage({ type: 'loadRequest', payload: { method: entry.method, url: entry.url } });
  }

  private async _logHistory(method: string, url: string, status: number | string, time: number) {
    await this.deps.historyStore.push({ id: newId(), method, url, status, time, timestamp: Date.now() });
    this.deps.historyProvider.refresh();
  }

  private async _handleRequest(req: RequestMessage) {
    const start = Date.now();

    const activeVars = this.deps.environmentsStore.getActive()?.variables ?? [];
    const unresolved = new Set<string>();
    const applySub = (text: string): string => {
      const { result, unresolved: tokens } = substituteVars(text, activeVars);
      tokens.forEach((t) => unresolved.add(t));
      return result;
    };

    const url = applySub(req.url);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[applySub(key)] = applySub(value);
    }
    const body = req.body ? applySub(req.body) : req.body;

    if (req.auth?.type === 'bearer' && req.auth.token) {
      headers['Authorization'] = `Bearer ${applySub(req.auth.token)}`;
    } else if (req.auth?.type === 'basic') {
      const username = applySub(req.auth.username);
      const password = applySub(req.auth.password);
      headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }

    if (unresolved.size > 0) {
      this._panel.webview.postMessage({
        type: 'unresolved',
        payload: { tokens: [...unresolved] },
      });
      return;
    }

    try {
      const options: RequestInit = {
        method: req.method,
        headers,
      };
      const noBody = req.method === 'GET' || req.method === 'HEAD';
      if (!noBody && body && body.trim().length > 0) {
        options.body = body;
      }

      const res = await fetch(url, options);
      const elapsed = Date.now() - start;
      const text = await res.text();

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      this._panel.webview.postMessage({
        type: 'response',
        payload: {
          status: res.status,
          statusText: res.statusText,
          time: elapsed,
          size: new TextEncoder().encode(text).length,
          headers: responseHeaders,
          body: text,
        },
      });
      await this._logHistory(req.method, req.url, res.status, elapsed);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const elapsed = Date.now() - start;
      this._panel.webview.postMessage({
        type: 'error',
        payload: { message, time: elapsed },
      });
      await this._logHistory(req.method, req.url, 'ERR', elapsed);
    }
  }

  private async _handleSave(payload: SaveMessage) {
    const name = await vscode.window.showInputBox({
      prompt: 'Request name',
      placeHolder: 'e.g. Get all users',
    });
    if (!name) return;

    const { collectionsStore, collectionsProvider } = this.deps;
    let collections = collectionsStore.getAll();

    let collectionId: string;
    if (collections.length === 0) {
      const collectionName = await vscode.window.showInputBox({
        prompt: 'No collections yet — name your first one',
        placeHolder: 'e.g. My API',
      });
      if (!collectionName) return;
      collections = addCollection(collections, collectionName);
      collectionId = collections[collections.length - 1].id;
    } else {
      const picked = await vscode.window.showQuickPick(
        [...collections.map((c) => c.name), NEW_COLLECTION_PICK],
        { placeHolder: 'Save to which collection?' }
      );
      if (!picked) return;
      if (picked === NEW_COLLECTION_PICK) {
        const collectionName = await vscode.window.showInputBox({ prompt: 'New collection name' });
        if (!collectionName) return;
        collections = addCollection(collections, collectionName);
        collectionId = collections[collections.length - 1].id;
      } else {
        collectionId = collections.find((c) => c.name === picked)!.id;
      }
    }

    const collection = collections.find((c) => c.id === collectionId)!;
    let folderId: string | undefined;
    const folderChoices = [NO_FOLDER_PICK, ...collection.folders.map((f) => f.name), NEW_FOLDER_PICK];
    const folderPicked = await vscode.window.showQuickPick(folderChoices, {
      placeHolder: 'Save in which folder?',
    });
    if (!folderPicked) return;
    if (folderPicked === NEW_FOLDER_PICK) {
      const folderName = await vscode.window.showInputBox({ prompt: 'New folder name' });
      if (!folderName) return;
      collections = addFolder(collections, collectionId, folderName);
      const updatedCollection = collections.find((c) => c.id === collectionId)!;
      folderId = updatedCollection.folders[updatedCollection.folders.length - 1].id;
    } else if (folderPicked !== NO_FOLDER_PICK) {
      folderId = collection.folders.find((f) => f.name === folderPicked)?.id;
    }

    const savedRequest: SavedRequest = {
      id: newId(),
      name,
      method: payload.method,
      url: payload.url,
      headers: payload.headers,
      params: payload.params,
      body: payload.body,
      auth: payload.auth,
    };

    collections = saveRequestOp(collections, collectionId, folderId, savedRequest);
    await collectionsStore.setAll(collections);
    collectionsProvider.refresh();
    vscode.window.showInformationMessage(`Saved "${name}"`);
  }

  public dispose() {
    RestPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }
  }
}
