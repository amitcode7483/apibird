import * as vscode from 'vscode';
import { EnvironmentsStore, newId } from './storage';
import { Environment, KeyValue } from './types';

const VAR_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function substituteVars(text: string, vars: KeyValue[]): { result: string; unresolved: string[] } {
  const map = new Map(vars.filter((v) => v.key.trim().length > 0).map((v) => [v.key, v.value]));
  const unresolved = new Set<string>();
  const result = text.replace(VAR_PATTERN, (match, name) => {
    if (map.has(name)) return map.get(name)!;
    unresolved.add(name);
    return match;
  });
  return { result, unresolved: [...unresolved] };
}

export function registerEnvironmentsFeature(
  context: vscode.ExtensionContext,
  store: EnvironmentsStore
): vscode.StatusBarItem {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'apibird.selectEnvironment';
  refreshStatusBar(statusBarItem, store);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('apibird.selectEnvironment', async () => {
      const environments = store.getAll();
      type Item = vscode.QuickPickItem & { action?: 'none' | 'new' | 'manage'; envId?: string };
      const items: Item[] = environments.map((e) => ({
        label: e.name,
        description: `${e.variables.length} variable${e.variables.length === 1 ? '' : 's'}`,
        envId: e.id,
      }));
      items.push(
        { label: '$(circle-slash) No Environment', action: 'none' },
        { label: '$(add) New Environment…', action: 'new' },
        { label: '$(gear) Manage Environments…', action: 'manage' }
      );
      const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select active environment' });
      if (!picked) return;

      if (picked.action === 'none') {
        await store.setActiveId(undefined);
      } else if (picked.action === 'new') {
        const created = await createEnvironmentFlow(store);
        if (created) await store.setActiveId(created.id);
      } else if (picked.action === 'manage') {
        await manageEnvironmentsFlow(store);
      } else if (picked.envId) {
        await store.setActiveId(picked.envId);
      }
      refreshStatusBar(statusBarItem, store);
    }),

    vscode.commands.registerCommand('apibird.manageEnvironments', async () => {
      await manageEnvironmentsFlow(store);
      refreshStatusBar(statusBarItem, store);
    })
  );

  return statusBarItem;
}

function refreshStatusBar(item: vscode.StatusBarItem, store: EnvironmentsStore): void {
  const active = store.getActive();
  item.text = `$(globe) ${active ? active.name : 'No Environment'}`;
  item.tooltip = 'apibird: active environment (click to change)';
}

async function createEnvironmentFlow(store: EnvironmentsStore): Promise<Environment | undefined> {
  const name = await vscode.window.showInputBox({ prompt: 'New environment name', placeHolder: 'e.g. Staging' });
  if (!name) return undefined;
  const environments = [...store.getAll(), { id: newId(), name, variables: [] }];
  await store.setAll(environments);
  const created = environments[environments.length - 1];
  await editEnvironmentFlow(store, created.id);
  return created;
}

async function manageEnvironmentsFlow(store: EnvironmentsStore): Promise<void> {
  for (;;) {
    const environments = store.getAll();
    if (environments.length === 0) {
      const choice = await vscode.window.showInformationMessage('No environments yet.', 'New Environment');
      if (choice) await createEnvironmentFlow(store);
      return;
    }

    type Item = vscode.QuickPickItem & { envId?: string; action?: 'new' };
    const items: Item[] = environments.map((e) => ({
      label: e.name,
      description: `${e.variables.length} variable${e.variables.length === 1 ? '' : 's'}`,
      envId: e.id,
    }));
    items.push({ label: '$(add) New Environment…', action: 'new' });

    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Manage which environment?' });
    if (!picked) return;
    if (picked.action === 'new') {
      await createEnvironmentFlow(store);
      continue;
    }
    if (picked.envId) await editEnvironmentFlow(store, picked.envId);
  }
}

async function editEnvironmentFlow(store: EnvironmentsStore, envId: string): Promise<void> {
  for (;;) {
    const environments = store.getAll();
    const env = environments.find((e) => e.id === envId);
    if (!env) return;

    type Item = vscode.QuickPickItem & { action: string; varIndex?: number };
    const items: Item[] = env.variables.map((v, i) => ({
      label: `${v.key} = ${v.value}`,
      action: 'editVar',
      varIndex: i,
    }));
    items.push(
      { label: '$(add) Add Variable', action: 'addVar' },
      { label: '$(edit) Rename Environment', action: 'rename' },
      { label: '$(trash) Delete Environment', action: 'delete' },
      { label: '$(arrow-left) Back', action: 'back' }
    );

    const picked = await vscode.window.showQuickPick(items, { placeHolder: `Editing "${env.name}"` });
    if (!picked || picked.action === 'back') return;

    if (picked.action === 'addVar') {
      const key = await vscode.window.showInputBox({ prompt: 'Variable name', placeHolder: 'baseUrl' });
      if (!key) continue;
      const value = (await vscode.window.showInputBox({ prompt: `Value for ${key}` })) ?? '';
      env.variables.push({ key, value });
      await store.setAll(environments);
    } else if (picked.action === 'editVar' && picked.varIndex !== undefined) {
      const variable = env.variables[picked.varIndex];
      const action = await vscode.window.showQuickPick(['Edit Value', 'Remove'], { placeHolder: variable.key });
      if (action === 'Edit Value') {
        const value = await vscode.window.showInputBox({ prompt: `Value for ${variable.key}`, value: variable.value });
        if (value !== undefined) {
          variable.value = value;
          await store.setAll(environments);
        }
      } else if (action === 'Remove') {
        env.variables.splice(picked.varIndex, 1);
        await store.setAll(environments);
      }
    } else if (picked.action === 'rename') {
      const name = await vscode.window.showInputBox({ prompt: 'Rename environment', value: env.name });
      if (name) {
        env.name = name;
        await store.setAll(environments);
      }
    } else if (picked.action === 'delete') {
      const confirm = await vscode.window.showWarningMessage(`Delete environment "${env.name}"?`, { modal: true }, 'Delete');
      if (confirm === 'Delete') {
        await store.setAll(environments.filter((e) => e.id !== envId));
        if (store.getActiveId() === envId) await store.setActiveId(undefined);
        return;
      }
    }
  }
}
