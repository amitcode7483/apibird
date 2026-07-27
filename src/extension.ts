import * as vscode from 'vscode';
import { CollectionsStore, EnvironmentsStore, HistoryStore } from './storage';
import { CollectionsProvider, nodeLabel } from './collectionsProvider';
import { HistoryProvider } from './historyProvider';
import { NodeRef, addCollection, addFolder, deleteNode, duplicateNode, findRequest, renameNode } from './collectionsOps';
import { registerEnvironmentsFeature } from './environments';
import { RestPanel } from './restPanel';
import { Collection, HistoryEntry } from './types';

export function activate(context: vscode.ExtensionContext) {
  const collectionsStore = new CollectionsStore(context);
  const collectionsProvider = new CollectionsProvider(collectionsStore);
  const environmentsStore = new EnvironmentsStore(context);
  const historyStore = new HistoryStore(context);
  const historyProvider = new HistoryProvider(historyStore);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('apibird.collections', collectionsProvider),
    vscode.window.registerTreeDataProvider('apibird.history', historyProvider)
  );
  registerEnvironmentsFeature(context, environmentsStore);

  const panelDeps = {
    context,
    collectionsStore,
    collectionsProvider,
    environmentsStore,
    historyStore,
    historyProvider,
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('restTester.open', () => {
      RestPanel.createOrShow(panelDeps);
    }),

    vscode.commands.registerCommand('apibird.newCollection', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'New collection name' });
      if (!name) return;
      await collectionsStore.setAll(addCollection(collectionsStore.getAll(), name));
      collectionsProvider.refresh();
    }),

    vscode.commands.registerCommand('apibird.newFolder', async (ref?: NodeRef) => {
      const collectionId = await resolveCollectionId(collectionsStore, ref);
      if (!collectionId) return;
      const name = await vscode.window.showInputBox({ prompt: 'New folder name' });
      if (!name) return;
      await collectionsStore.setAll(addFolder(collectionsStore.getAll(), collectionId, name));
      collectionsProvider.refresh();
    }),

    vscode.commands.registerCommand('apibird.renameItem', async (ref: NodeRef) => {
      const collections = collectionsStore.getAll();
      const current = nodeLabel(collections, ref);
      const name = await vscode.window.showInputBox({ prompt: 'Rename', value: current });
      if (!name || name === current) return;
      await collectionsStore.setAll(renameNode(collections, ref, name));
      collectionsProvider.refresh();
    }),

    vscode.commands.registerCommand('apibird.deleteItem', async (ref: NodeRef) => {
      const collections = collectionsStore.getAll();
      const label = nodeLabel(collections, ref);
      const confirm = await vscode.window.showWarningMessage(
        `Delete "${label}"?`,
        { modal: true },
        'Delete'
      );
      if (confirm !== 'Delete') return;
      await collectionsStore.setAll(deleteNode(collections, ref));
      collectionsProvider.refresh();
    }),

    vscode.commands.registerCommand('apibird.duplicateItem', async (ref: NodeRef) => {
      await collectionsStore.setAll(duplicateNode(collectionsStore.getAll(), ref));
      collectionsProvider.refresh();
    }),

    vscode.commands.registerCommand('apibird.openHistoryEntry', (entry: HistoryEntry) => {
      RestPanel.createOrShow(panelDeps).loadFromHistory(entry);
    }),

    vscode.commands.registerCommand('apibird.openRequest', (ref: NodeRef) => {
      const request = findRequest(collectionsStore.getAll(), ref);
      if (!request) {
        vscode.window.showErrorMessage('That request no longer exists.');
        return;
      }
      RestPanel.createOrShow(panelDeps).loadRequest(request);
    }),

    vscode.commands.registerCommand('apibird.exportCollection', async (ref: NodeRef) => {
      const collection = collectionsStore.getAll().find((c) => c.id === ref.collectionId);
      if (!collection) return;
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${collection.name}.json`),
        filters: { JSON: ['json'] },
      });
      if (!uri) return;
      const bytes = Buffer.from(JSON.stringify(collection, null, 2), 'utf8');
      await vscode.workspace.fs.writeFile(uri, bytes);
      vscode.window.showInformationMessage(`Exported "${collection.name}"`);
    }),

    vscode.commands.registerCommand('apibird.importCollection', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { JSON: ['json'] },
      });
      if (!uris || uris.length === 0) return;
      try {
        const bytes = await vscode.workspace.fs.readFile(uris[0]);
        const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as Collection;
        if (!parsed.name || !Array.isArray(parsed.folders) || !Array.isArray(parsed.requests)) {
          throw new Error('File is not a valid apibird collection export.');
        }
        await collectionsStore.setAll(addCollection(collectionsStore.getAll(), parsed.name));
        const collections = collectionsStore.getAll();
        const created = collections[collections.length - 1];
        created.folders = parsed.folders;
        created.requests = parsed.requests;
        await collectionsStore.setAll(collections);
        collectionsProvider.refresh();
        vscode.window.showInformationMessage(`Imported "${parsed.name}"`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Import failed: ${message}`);
      }
    })
  );
}

async function resolveCollectionId(store: CollectionsStore, ref?: NodeRef): Promise<string | undefined> {
  if (ref?.kind === 'collection') return ref.collectionId;

  const collections = store.getAll();
  if (collections.length === 0) {
    vscode.window.showErrorMessage('Create a collection first.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    collections.map((c) => c.name),
    { placeHolder: 'Add folder to which collection?' }
  );
  if (!picked) return undefined;
  return collections.find((c) => c.name === picked)?.id;
}

export function deactivate() {}
