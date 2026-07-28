import { newId } from './storage';
import { AuthConfig, Collection, Folder, KeyValue, SavedRequest } from './types';

interface TcNameValue {
  name?: string;
  key?: string;
  value?: string;
  type?: string;
  disabled?: boolean;
}
interface TcBody {
  type?: string;
  raw?: string;
  form?: TcNameValue[];
  formdata?: TcNameValue[];
}
interface TcAuth {
  type?: string;
  bearer?: string;
  basic?: { username?: string; password?: string };
}
interface TcFolder {
  _id: string;
  name: string;
  containerId?: string;
}
interface TcRequest {
  containerId?: string;
  name?: string;
  url?: string;
  method?: string;
  headers?: TcNameValue[];
  params?: TcNameValue[];
  body?: TcBody;
  auth?: TcAuth;
}
interface TcCollection {
  collectionName?: string;
  folders?: TcFolder[];
  requests?: TcRequest[];
}

export interface ImportResult {
  collection: Collection;
  warnings: string[];
}

function nv(entry: TcNameValue): KeyValue {
  return { key: (entry.name ?? entry.key ?? '').toString(), value: entry.value ?? '' };
}

function mapAuth(auth: TcAuth | undefined, warnings: string[], context: string): AuthConfig {
  if (!auth || !auth.type || auth.type === 'none' || auth.type === 'No Auth') return { type: 'none' };
  if (auth.type === 'bearer') return { type: 'bearer', token: auth.bearer ?? '' };
  if (auth.type === 'basic') return { type: 'basic', username: auth.basic?.username ?? '', password: auth.basic?.password ?? '' };
  warnings.push(`${context}: auth type "${auth.type}" isn't supported yet — set to None.`);
  return { type: 'none' };
}

function mapBody(body: TcBody | undefined, headers: KeyValue[], warnings: string[], context: string): string {
  if (!body || !body.type || body.type === 'none') return '';
  const ensureContentType = (value: string) => {
    if (!headers.some((h) => h.key.toLowerCase() === 'content-type')) headers.push({ key: 'Content-Type', value });
  };
  switch (body.type) {
    case 'json':
      ensureContentType('application/json');
      return body.raw ?? '';
    case 'xml':
      ensureContentType('application/xml');
      return body.raw ?? '';
    case 'text':
      ensureContentType('text/plain');
      return body.raw ?? '';
    case 'form': {
      ensureContentType('application/x-www-form-urlencoded');
      return (body.form ?? [])
        .filter((p) => !p.disabled)
        .map((p) => `${encodeURIComponent(p.name ?? p.key ?? '')}=${encodeURIComponent(p.value ?? '')}`)
        .join('&');
    }
    case 'formdata': {
      const fields = (body.formdata ?? []).filter((f) => !f.disabled);
      const fileFields = fields.filter((f) => f.type === 'file');
      if (fileFields.length > 0) {
        warnings.push(`${context}: form-data file field(s) can't be imported — skipped.`);
      }
      warnings.push(`${context}: multipart form-data approximated as a urlencoded-style body.`);
      return fields
        .filter((f) => f.type !== 'file')
        .map((f) => `${encodeURIComponent(f.name ?? f.key ?? '')}=${encodeURIComponent(f.value ?? '')}`)
        .join('&');
    }
    case 'graphql':
      warnings.push(`${context}: GraphQL body mapped to a raw body.`);
      return body.raw ?? '';
    default:
      warnings.push(`${context}: unrecognized body type "${body.type}" — left empty.`);
      return '';
  }
}

function mapRequest(req: TcRequest, warnings: string[]): SavedRequest {
  const name = req.name ?? 'Untitled';
  const headers = (req.headers ?? []).filter((h) => !h.disabled).map(nv);
  const auth = mapAuth(req.auth, warnings, name);
  const body = mapBody(req.body, headers, warnings, name);
  return {
    id: newId(),
    name,
    method: (req.method ?? 'GET').toUpperCase(),
    url: req.url ?? '',
    headers,
    params: (req.params ?? []).filter((p) => !p.disabled).map(nv),
    body,
    auth,
  };
}

export function importThunderClientCollection(json: unknown): ImportResult {
  const tc = json as TcCollection;
  if (!Array.isArray(tc?.requests)) {
    throw new Error('This file does not look like a Thunder Client collection export.');
  }

  const warnings: string[] = [];
  const tcFolders = tc.folders ?? [];
  const folders: Folder[] = tcFolders.map((f) => ({ id: newId(), name: f.name || 'Untitled folder', requests: [] }));
  const folderIdMap = new Map<string, Folder>();
  tcFolders.forEach((f, i) => folderIdMap.set(f._id, folders[i]));

  const nestedFolders = tcFolders.filter((f) => f.containerId);
  if (nestedFolders.length > 0) {
    warnings.push(`${nestedFolders.length} nested folder(s) were flattened to the top level — apibird folders are one level deep.`);
  }

  const rootRequests: SavedRequest[] = [];
  for (const req of tc.requests ?? []) {
    const mapped = mapRequest(req, warnings);
    const folder = req.containerId ? folderIdMap.get(req.containerId) : undefined;
    if (folder) folder.requests.push(mapped);
    else rootRequests.push(mapped);
  }

  const collection: Collection = {
    id: newId(),
    name: tc.collectionName || 'Imported Collection',
    folders,
    requests: rootRequests,
  };
  return { collection, warnings };
}
