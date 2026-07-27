import * as vscode from 'vscode';
import { CollectionsStore } from './storage';
import { Collection, Folder, SavedRequest } from './types';
import { NodeRef } from './collectionsOps';

export class CollectionsProvider implements vscode.TreeDataProvider<NodeRef> {
  private _onDidChangeTreeData = new vscode.EventEmitter<NodeRef | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private store: CollectionsStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(ref: NodeRef): vscode.TreeItem {
    const collections = this.store.getAll();
    const collection = collections.find((c) => c.id === ref.collectionId);
    if (!collection) return new vscode.TreeItem('(missing)');

    if (ref.kind === 'collection') {
      const item = new vscode.TreeItem(collection.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'collection';
      item.iconPath = new vscode.ThemeIcon('archive');
      return item;
    }

    if (ref.kind === 'folder') {
      const folder = collection.folders.find((f) => f.id === ref.folderId);
      const item = new vscode.TreeItem(folder?.name ?? '(missing)', vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'folder';
      item.iconPath = new vscode.ThemeIcon('folder');
      return item;
    }

    const list = ref.folderId
      ? collection.folders.find((f) => f.id === ref.folderId)?.requests ?? []
      : collection.requests;
    const request = list.find((r) => r.id === ref.requestId);
    const item = new vscode.TreeItem(request?.name ?? '(missing)', vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'request';
    item.description = request ? `${request.method} ${request.url}` : '';
    item.iconPath = new vscode.ThemeIcon('symbol-method');
    if (request) {
      item.command = {
        command: 'apibird.openRequest',
        title: 'Open Request',
        arguments: [ref],
      };
    }
    return item;
  }

  getChildren(ref?: NodeRef): NodeRef[] {
    const collections = this.store.getAll();

    if (!ref) {
      return collections.map((c) => ({ kind: 'collection', collectionId: c.id } as NodeRef));
    }

    const collection = collections.find((c) => c.id === ref.collectionId);
    if (!collection) return [];

    if (ref.kind === 'collection') {
      const folderRefs: NodeRef[] = collection.folders.map((f) => ({
        kind: 'folder',
        collectionId: collection.id,
        folderId: f.id,
      }));
      const requestRefs: NodeRef[] = collection.requests.map((r) => ({
        kind: 'request',
        collectionId: collection.id,
        requestId: r.id,
      }));
      return [...folderRefs, ...requestRefs];
    }

    if (ref.kind === 'folder') {
      const folder = collection.folders.find((f) => f.id === ref.folderId);
      if (!folder) return [];
      return folder.requests.map(
        (r) => ({ kind: 'request', collectionId: collection.id, folderId: folder.id, requestId: r.id } as NodeRef)
      );
    }

    return [];
  }
}

export function findCollectionById(collections: Collection[], id: string): Collection | undefined {
  return collections.find((c) => c.id === id);
}

export function findFolderById(collection: Collection, id: string): Folder | undefined {
  return collection.folders.find((f) => f.id === id);
}

export function nodeLabel(collections: Collection[], ref: NodeRef): string {
  const collection = findCollectionById(collections, ref.collectionId);
  if (!collection) return '(missing)';
  if (ref.kind === 'collection') return collection.name;
  if (ref.kind === 'folder') return findFolderById(collection, ref.folderId)?.name ?? '(missing)';
  const list: SavedRequest[] = ref.folderId
    ? findFolderById(collection, ref.folderId)?.requests ?? []
    : collection.requests;
  return list.find((r) => r.id === ref.requestId)?.name ?? '(missing)';
}
