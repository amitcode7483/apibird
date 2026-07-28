import * as vscode from 'vscode';
import { CollectionsStore, EnvironmentsStore, HistoryStore, newId } from './storage';
import { CollectionsProvider, nodeLabel } from './collectionsProvider';
import { HistoryProvider } from './historyProvider';
import { NodeRef, addCollection, addFolder, deleteNode, duplicateNode, findRequest, renameNode } from './collectionsOps';
import { registerEnvironmentsFeature } from './environments';
import { RestPanel } from './restPanel';
import { Collection, HistoryEntry, SavedRequest } from './types';
import { exportToPostmanCollection, importPostmanCollection } from './postman';
import { importThunderClientCollection } from './thunderClient';
import { parseCurl } from './curl';

function reportImportWarnings(channel: vscode.OutputChannel, summary: string, warnings: string[]): void {
  if (warnings.length === 0) {
    vscode.window.showInformationMessage(summary);
    return;
  }
  channel.appendLine(`--- ${summary} ---`);
  warnings.forEach((w) => channel.appendLine(`• ${w}`));
  channel.appendLine('');
  vscode.window.showWarningMessage(`${summary} — ${warnings.length} item(s) need attention.`, 'Show Details').then((choice) => {
    if (choice === 'Show Details') channel.show();
  });
}

export async function activate(context: vscode.ExtensionContext) {
  const collectionsStore = new CollectionsStore(context);
  const collectionsProvider = new CollectionsProvider(collectionsStore);
  const environmentsStore = new EnvironmentsStore(context);
  const historyStore = new HistoryStore(context);
  const historyProvider = new HistoryProvider(historyStore);

  await collectionsStore.initialize();
  await environmentsStore.initialize();

  const importLog = vscode.window.createOutputChannel('apibird Import');

  context.subscriptions.push(
    importLog,
    vscode.window.registerTreeDataProvider('apibird.collections', collectionsProvider),
    vscode.window.registerTreeDataProvider('apibird.history', historyProvider)
  );
  registerEnvironmentsFeature(context, environmentsStore);

  // A workspace folder can be opened/closed after activation — re-sync so
  // collections/environments switch between workspace files and globalState.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await collectionsStore.initialize();
      await environmentsStore.initialize();
      collectionsProvider.refresh();
    })
  );

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

    vscode.commands.registerCommand('apibird.exportCollection', async (ref?: NodeRef) => {
      const collections = collectionsStore.getAll();
      let collection: Collection | undefined;
      if (ref?.collectionId) {
        collection = collections.find((c) => c.id === ref.collectionId);
      } else {
        if (collections.length === 0) {
          vscode.window.showErrorMessage('No collections to export.');
          return;
        }
        const picked = await vscode.window.showQuickPick(
          collections.map((c) => c.name),
          { placeHolder: 'Export which collection?' }
        );
        if (!picked) return;
        collection = collections.find((c) => c.name === picked);
      }
      if (!collection) return;

      const format = await vscode.window.showQuickPick(
        [
          { label: 'apibird JSON', description: 'Native format — no lock-in, re-importable into apibird', value: 'apibird' as const },
          { label: 'Postman Collection v2.1', description: 'Compatible with Postman and other v2.1-schema tools', value: 'postman' as const },
        ],
        { placeHolder: 'Export format' }
      );
      if (!format) return;

      if (format.value === 'apibird') {
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(`${collection.name}.json`),
          filters: { JSON: ['json'] },
        });
        if (!uri) return;
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(collection, null, 2), 'utf8'));
      } else {
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(`${collection.name}.postman_collection.json`),
          filters: { JSON: ['json'] },
        });
        if (!uri) return;
        const postmanJson = exportToPostmanCollection(collection);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(postmanJson, null, 2), 'utf8'));
      }
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
    }),

    vscode.commands.registerCommand('apibird.importPostman', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { JSON: ['json'] },
        title: 'Import Postman Collection (v2.1)',
      });
      if (!uris || uris.length === 0) return;
      try {
        const bytes = await vscode.workspace.fs.readFile(uris[0]);
        const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
        const { collection, warnings } = importPostmanCollection(parsed);
        await collectionsStore.setAll([...collectionsStore.getAll(), collection]);
        collectionsProvider.refresh();
        reportImportWarnings(importLog, `Imported "${collection.name}" from Postman`, warnings);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Postman import failed: ${message}`);
      }
    }),

    vscode.commands.registerCommand('apibird.importThunderClient', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { JSON: ['json'] },
        title: 'Import Thunder Client Collection',
      });
      if (!uris || uris.length === 0) return;
      try {
        const bytes = await vscode.workspace.fs.readFile(uris[0]);
        const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
        const { collection, warnings } = importThunderClientCollection(parsed);
        await collectionsStore.setAll([...collectionsStore.getAll(), collection]);
        collectionsProvider.refresh();
        reportImportWarnings(importLog, `Imported "${collection.name}" from Thunder Client`, warnings);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Thunder Client import failed: ${message}`);
      }
    }),

    vscode.commands.registerCommand('apibird.importCurl', async () => {
      const clipboard = await vscode.env.clipboard.readText();
      const seed = /^\s*curl\b/i.test(clipboard) ? clipboard : '';
      const input = await vscode.window.showInputBox({
        title: 'apibird: Import cURL',
        prompt: 'Paste a curl command',
        placeHolder: 'curl https://api.example.com/users -H "Authorization: Bearer xyz"',
        value: seed,
        ignoreFocusOut: true,
      });
      if (!input) return;
      try {
        const parsed = parseCurl(input);
        const request: SavedRequest = {
          id: newId(),
          name: '',
          method: parsed.method,
          url: parsed.url,
          headers: parsed.headers,
          params: [],
          body: parsed.body,
          auth: parsed.auth,
        };
        RestPanel.createOrShow(panelDeps).loadRequest(request);
        vscode.window.setStatusBarMessage('apibird: imported cURL command into the request panel', 3000);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`cURL import failed: ${message}`);
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
