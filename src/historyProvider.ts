import * as vscode from 'vscode';
import { HistoryStore } from './storage';
import { HistoryEntry } from './types';

export class HistoryProvider implements vscode.TreeDataProvider<HistoryEntry> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private store: HistoryStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(entry: HistoryEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(`${entry.method} ${entry.url}`, vscode.TreeItemCollapsibleState.None);
    const ok = typeof entry.status === 'number' && entry.status >= 200 && entry.status < 400;
    item.description = `${entry.status} · ${entry.time} ms`;
    item.iconPath = new vscode.ThemeIcon(ok ? 'pass' : 'error');
    item.command = {
      command: 'apibird.openHistoryEntry',
      title: 'Reload Request',
      arguments: [entry],
    };
    return item;
  }

  getChildren(): HistoryEntry[] {
    return this.store.getAll();
  }
}
