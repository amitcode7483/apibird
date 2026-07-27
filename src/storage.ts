import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { Collection, Environment, HistoryEntry } from './types';

const COLLECTIONS_KEY = 'apibird.collections';
const ENVIRONMENTS_KEY = 'apibird.environments';
const ACTIVE_ENVIRONMENT_KEY = 'apibird.activeEnvironmentId';
const HISTORY_KEY = 'apibird.history';
const HISTORY_LIMIT = 50;

export function newId(): string {
  return randomUUID();
}

export class CollectionsStore {
  constructor(private context: vscode.ExtensionContext) {}

  getAll(): Collection[] {
    return this.context.globalState.get<Collection[]>(COLLECTIONS_KEY, []);
  }

  async setAll(collections: Collection[]): Promise<void> {
    await this.context.globalState.update(COLLECTIONS_KEY, collections);
  }
}

export class EnvironmentsStore {
  constructor(private context: vscode.ExtensionContext) {}

  getAll(): Environment[] {
    return this.context.globalState.get<Environment[]>(ENVIRONMENTS_KEY, []);
  }

  async setAll(environments: Environment[]): Promise<void> {
    await this.context.globalState.update(ENVIRONMENTS_KEY, environments);
  }

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
}
