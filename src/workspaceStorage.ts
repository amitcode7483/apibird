import * as vscode from 'vscode';
import { Collection, Environment, KeyValue } from './types';

const GITIGNORE_ENTRY = '.apibird/environments/*.local.json';

export function getWorkspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(uri: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.createDirectory(uri);
}

async function readJson<T>(uri: vscode.Uri): Promise<T | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as T;
  } catch {
    return undefined;
  }
}

async function writeJson(uri: vscode.Uri, data: unknown): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8');
  await vscode.workspace.fs.writeFile(uri, bytes);
}

async function deleteIfExists(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri);
  } catch {
    // already gone — fine
  }
}

async function listJsonFiles(dir: vscode.Uri): Promise<string[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    return entries.filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json')).map(([name]) => name);
  } catch {
    return [];
  }
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

/**
 * Ensures .apibird/ exists and reports whether this is the very first time we've
 * seen this workspace, via a marker file. Migration must run exactly once — if a
 * user later empties .apibird/ on purpose, we must NOT pull stale globalState data
 * back in, so the marker (not "is the folder empty") is the source of truth.
 */
export async function ensureApibirdWorkspace(root: vscode.Uri): Promise<{ dir: vscode.Uri; shouldMigrate: boolean }> {
  const dir = vscode.Uri.joinPath(root, '.apibird');
  await ensureDir(dir);
  const marker = vscode.Uri.joinPath(dir, '.migrated');
  const alreadyMigrated = await pathExists(marker);
  if (!alreadyMigrated) {
    await writeJson(marker, { migratedAt: new Date().toISOString() });
  }
  return { dir, shouldMigrate: !alreadyMigrated };
}

export async function ensureGitignoreEntry(root: vscode.Uri): Promise<void> {
  const gitignoreUri = vscode.Uri.joinPath(root, '.gitignore');
  let content = '';
  try {
    const bytes = await vscode.workspace.fs.readFile(gitignoreUri);
    content = Buffer.from(bytes).toString('utf8');
  } catch {
    content = '';
  }
  const alreadyPresent = content.split(/\r?\n/).some((line) => line.trim() === GITIGNORE_ENTRY);
  if (alreadyPresent) return;

  const prefix = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  const newContent = `${content}${prefix}${GITIGNORE_ENTRY}\n`;
  await vscode.workspace.fs.writeFile(gitignoreUri, Buffer.from(newContent, 'utf8'));
}

// ---------- Collections ----------

interface CollectionsIndex {
  order: string[];
}

export async function readCollectionsFromDisk(dir: vscode.Uri): Promise<Collection[]> {
  const indexUri = vscode.Uri.joinPath(dir, 'index.json');
  const index = (await readJson<CollectionsIndex>(indexUri)) ?? { order: [] };

  const files = await listJsonFiles(dir);
  const byId = new Map<string, Collection>();
  for (const file of files) {
    if (file === 'index.json') continue;
    const collection = await readJson<Collection>(vscode.Uri.joinPath(dir, file));
    if (collection?.id) byId.set(collection.id, collection);
  }

  const ordered: Collection[] = [];
  for (const id of index.order) {
    const collection = byId.get(id);
    if (collection) {
      ordered.push(collection);
      byId.delete(id);
    }
  }
  // Anything on disk but missing from the index (e.g. added outside apibird) goes last.
  ordered.push(...byId.values());
  return ordered;
}

export async function writeCollectionsToDisk(dir: vscode.Uri, collections: Collection[]): Promise<void> {
  await ensureDir(dir);
  const keepFiles = new Set(collections.map((c) => `${c.id}.json`));
  const existingFiles = await listJsonFiles(dir);
  for (const file of existingFiles) {
    if (file !== 'index.json' && !keepFiles.has(file)) {
      await deleteIfExists(vscode.Uri.joinPath(dir, file));
    }
  }
  for (const collection of collections) {
    await writeJson(vscode.Uri.joinPath(dir, `${collection.id}.json`), collection);
  }
  await writeJson(vscode.Uri.joinPath(dir, 'index.json'), { order: collections.map((c) => c.id) } as CollectionsIndex);
}

// ---------- Environments (secret-split) ----------

interface CommittedEnvFile {
  id: string;
  name: string;
  variables: KeyValue[];
}

interface LocalEnvFile {
  id: string;
  variables: KeyValue[];
}

function splitEnvironment(env: Environment): { committed: CommittedEnvFile; local: LocalEnvFile } {
  const committed: KeyValue[] = env.variables.map((v) =>
    v.secret ? { key: v.key, value: '', secret: true } : { key: v.key, value: v.value }
  );
  const local: KeyValue[] = env.variables
    .filter((v) => v.secret)
    .map((v) => ({ key: v.key, value: v.value, secret: true }));
  return { committed: { id: env.id, name: env.name, variables: committed }, local: { id: env.id, variables: local } };
}

function mergeEnvironment(committed: CommittedEnvFile, local: LocalEnvFile | undefined): Environment {
  const localValues = new Map((local?.variables ?? []).map((v) => [v.key, v.value]));
  const variables: KeyValue[] = committed.variables.map((v) =>
    v.secret ? { key: v.key, value: localValues.get(v.key) ?? '', secret: true } : v
  );
  return { id: committed.id, name: committed.name, variables };
}

export async function readEnvironmentsFromDisk(dir: vscode.Uri): Promise<Environment[]> {
  const files = await listJsonFiles(dir);
  const environments: Environment[] = [];
  for (const file of files) {
    if (file === 'index.json' || file.endsWith('.local.json')) continue;
    const committed = await readJson<CommittedEnvFile>(vscode.Uri.joinPath(dir, file));
    if (!committed?.id) continue;
    const slug = file.slice(0, -'.json'.length);
    const local = await readJson<LocalEnvFile>(vscode.Uri.joinPath(dir, `${slug}.local.json`));
    environments.push(mergeEnvironment(committed, local));
  }
  return environments;
}

export async function writeEnvironmentsToDisk(root: vscode.Uri, dir: vscode.Uri, environments: Environment[]): Promise<void> {
  await ensureDir(dir);

  const existingFiles = await listJsonFiles(dir);
  const usedSlugs = new Set<string>();
  const keepFiles = new Set<string>();

  for (const env of environments) {
    let slug = slugify(env.name);
    let candidate = slug;
    let n = 2;
    while (usedSlugs.has(candidate)) {
      candidate = `${slug}-${n++}`;
    }
    slug = candidate;
    usedSlugs.add(slug);

    const { committed, local } = splitEnvironment(env);
    keepFiles.add(`${slug}.json`);
    await writeJson(vscode.Uri.joinPath(dir, `${slug}.json`), committed);

    const localUri = vscode.Uri.joinPath(dir, `${slug}.local.json`);
    if (local.variables.length > 0) {
      keepFiles.add(`${slug}.local.json`);
      await writeJson(localUri, local);
    } else {
      await deleteIfExists(localUri);
    }
  }

  for (const file of existingFiles) {
    if (file !== 'index.json' && !keepFiles.has(file)) {
      await deleteIfExists(vscode.Uri.joinPath(dir, file));
    }
  }

  const hasSecrets = environments.some((e) => e.variables.some((v) => v.secret));
  if (hasSecrets) {
    await ensureGitignoreEntry(root);
  }
}
