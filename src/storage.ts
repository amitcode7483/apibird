import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { Collection, Environment, HistoryEntry } from './types';
import {
  ensureApibirdWorkspace,
  ensureGitignoreEntry,
  getWorkspaceRoot,
  readCollectionsFromDisk,
  readEnvironmentsFromDisk,
  writeCollectionsToDisk,
  writeEnvironmentsToDisk,
} from './workspaceStorage';

const COLLECTIONS_KEY = 'apibird.collections';
const ENVIRONMENTS_KEY = 'apibird.environments';
const ACTIVE_ENVIRONMENT_KEY = 'apibird.activeEnvironmentId';
const HISTORY_KEY = 'apibird.history';
const HISTORY_LIMIT = 50;

export function newId(): string {
  return randomUUID();
}

export class CollectionsStore {
  private cache: Collection[] = [];
  private workspaceDir: vscode.Uri | undefined;

  constructor(private context: vscode.ExtensionContext) {}

  async initialize(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) {
      this.workspaceDir = undefined;
      this.cache = this.context.globalState.get<Collection[]>(COLLECTIONS_KEY, []);
      return;
    }

    const { dir, shouldMigrate } = await ensureApibirdWorkspace(root);
    const collectionsDir = vscode.Uri.joinPath(dir, 'collections');
    this.workspaceDir = collectionsDir;

    let onDisk = await readCollectionsFromDisk(collectionsDir);
    if (shouldMigrate && onDisk.length === 0) {
      const legacy = this.context.globalState.get<Collection[]>(COLLECTIONS_KEY, []);
      if (legacy.length > 0) {
        await writeCollectionsToDisk(collectionsDir, legacy);
        onDisk = legacy;
      }
    }
    this.cache = onDisk;
  }

  getAll(): Collection[] {
    return this.cache;
  }

  async setAll(collections: Collection[]): Promise<void> {
    this.cache = collections;
    if (this.workspaceDir) {
      await writeCollectionsToDisk(this.workspaceDir, collections);
    } else {
      await this.context.globalState.update(COLLECTIONS_KEY, collections);
    }
  }
}

export class EnvironmentsStore {
  private cache: Environment[] = [];
  private workspaceRoot: vscode.Uri | undefined;
  private workspaceDir: vscode.Uri | undefined;

  constructor(private context: vscode.ExtensionContext) {}

  async initialize(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) {
      this.workspaceRoot = undefined;
      this.workspaceDir = undefined;
      this.cache = this.context.globalState.get<Environment[]>(ENVIRONMENTS_KEY, []);
      return;
    }

    const { dir, shouldMigrate } = await ensureApibirdWorkspace(root);
    const environmentsDir = vscode.Uri.joinPath(dir, 'environments');
    this.workspaceRoot = root;
    this.workspaceDir = environmentsDir;
    await ensureGitignoreEntry(root);

    let onDisk = await readEnvironmentsFromDisk(environmentsDir);
    if (shouldMigrate && onDisk.length === 0) {
      const legacy = this.context.globalState.get<Environment[]>(ENVIRONMENTS_KEY, []);
      if (legacy.length > 0) {
        await writeEnvironmentsToDisk(root, environmentsDir, legacy);
        onDisk = legacy;
      }
    }
    this.cache = onDisk;
  }

  getAll(): Environment[] {
    return this.cache;
  }

  async setAll(environments: Environment[]): Promise<void> {
    this.cache = environments;
    if (this.workspaceRoot && this.workspaceDir) {
      await writeEnvironmentsToDisk(this.workspaceRoot, this.workspaceDir, environments);
    } else {
      await this.context.globalState.update(ENVIRONMENTS_KEY, environments);
    }
  }

  // The active environment is a personal, per-machine choice (teammates often run
  // different environments locally) — it deliberately stays in globalState even in
  // workspace mode, rather than being written into a synced/shared file.
  getActiveId(): string | undefined {
    return this.context.globalState.get<string>(ACTIVE_ENVIRONMENT_KEY);
  }

  async setActiveId(id: string | undefined): Promise<void> {
    await this.context.globalState.update(ACTIVE_ENVIRONMENT_KEY, id);
  }

  getActive(): Environment | undefined {
    const id = this.getActiveId();
    if (!id) return undefined;
    return this.getAll().find((e) => e.id === id);
  }
}

export class HistoryStore {
  constructor(private context: vscode.ExtensionContext) {}

  getAll(): HistoryEntry[] {
    return this.context.globalState.get<HistoryEntry[]>(HISTORY_KEY, []);
  }

  async push(entry: HistoryEntry): Promise<void> {
    const entries = [entry, ...this.getAll()].slice(0, HISTORY_LIMIT);
    await this.context.globalState.update(HISTORY_KEY, entries);
  }

  async remove(id: string): Promise<void> {
    const entries = this.getAll().filter((e) => e.id !== id);
    await this.context.globalState.update(HISTORY_KEY, entries);
  }

  async clear(): Promise<void> {
    await this.context.globalState.update(HISTORY_KEY, []);
  }
}
