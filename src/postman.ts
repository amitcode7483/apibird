import { newId } from './storage';
import { AuthConfig, Collection, Folder, KeyValue, SavedRequest } from './types';

interface PmHeader {
  key: string;
  value: string;
  disabled?: boolean;
}
interface PmQueryParam {
  key: string;
  value: string;
  disabled?: boolean;
}
interface PmUrl {
  raw?: string;
}
interface PmFormField {
  key: string;
  value?: string;
  type?: string;
  disabled?: boolean;
}
interface PmBody {
  mode?: 'raw' | 'urlencoded' | 'formdata' | 'graphql' | 'file';
  raw?: string;
  urlencoded?: PmQueryParam[];
  formdata?: PmFormField[];
  graphql?: { query?: string; variables?: string };
}
interface PmAuthEntry {
  key: string;
  value: string;
}
interface PmAuth {
  type?: string;
  bearer?: PmAuthEntry[];
  basic?: PmAuthEntry[];
}
interface PmRequest {
  method?: string;
  header?: PmHeader[];
  url?: PmUrl | string;
  body?: PmBody;
  auth?: PmAuth;
}
interface PmItem {
  name?: string;
  item?: PmItem[];
  request?: PmRequest;
}
interface PmCollection {
  info?: { name?: string };
  item?: PmItem[];
  auth?: PmAuth;
}

export interface ImportResult {
  collection: Collection;
  warnings: string[];
}

function isFolder(item: PmItem): boolean {
  return Array.isArray(item.item);
}

function mapAuth(auth: PmAuth | undefined, warnings: string[], context: string): AuthConfig {
  if (!auth || !auth.type || auth.type === 'noauth') return { type: 'none' };
  if (auth.type === 'bearer') {
    return { type: 'bearer', token: auth.bearer?.find((e) => e.key === 'token')?.value ?? '' };
  }
  if (auth.type === 'basic') {
    return {
      type: 'basic',
      username: auth.basic?.find((e) => e.key === 'username')?.value ?? '',
      password: auth.basic?.find((e) => e.key === 'password')?.value ?? '',
    };
  }
  warnings.push(`${context}: auth type "${auth.type}" isn't supported yet — set to None.`);
  return { type: 'none' };
}

function safeParseJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function mapBody(body: PmBody | undefined, headers: KeyValue[], warnings: string[], context: string): string {
  if (!body || !body.mode) return '';
  const ensureContentType = (value: string) => {
    if (!headers.some((h) => h.key.toLowerCase() === 'content-type')) headers.push({ key: 'Content-Type', value });
  };
  switch (body.mode) {
    case 'raw':
      return body.raw ?? '';
    case 'urlencoded': {
      ensureContentType('application/x-www-form-urlencoded');
      return (body.urlencoded ?? [])
        .filter((p) => !p.disabled)
        .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
        .join('&');
    }
    case 'formdata': {
      const fields = (body.formdata ?? []).filter((f) => !f.disabled);
      const fileFields = fields.filter((f) => f.type === 'file');
      if (fileFields.length > 0) {
        warnings.push(`${context}: form-data file field(s) (${fileFields.map((f) => f.key).join(', ')}) can't be imported — skipped.`);
      }
      warnings.push(`${context}: multipart form-data approximated as a urlencoded-style body.`);
      return fields
        .filter((f) => f.type !== 'file')
        .map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value ?? '')}`)
        .join('&');
    }
    case 'graphql':
      warnings.push(`${context}: GraphQL body mapped to a raw JSON body.`);
      return JSON.stringify({ query: body.graphql?.query ?? '', variables: safeParseJson(body.graphql?.variables) }, null, 2);
    case 'file':
      warnings.push(`${context}: file-upload body isn't supported — left empty.`);
      return '';
    default:
      warnings.push(`${context}: unrecognized body mode "${body.mode}" — left empty.`);
      return '';
  }
}

function mapUrl(url: PmUrl | string | undefined): string {
  if (!url) return '';
  return typeof url === 'string' ? url : url.raw ?? '';
}

function mapRequest(item: PmItem, collectionAuth: PmAuth | undefined, warnings: string[], namePrefix: string): SavedRequest {
  const req = item.request ?? {};
  const name = namePrefix ? `${namePrefix} / ${item.name ?? 'Untitled'}` : item.name ?? 'Untitled';
  const headers: KeyValue[] = (req.header ?? []).filter((h) => !h.disabled).map((h) => ({ key: h.key, value: h.value }));
  const auth = mapAuth(req.auth ?? collectionAuth, warnings, name);
  const body = mapBody(req.body, headers, warnings, name);
  return {
    id: newId(),
    name,
    method: (req.method ?? 'GET').toUpperCase(),
    url: mapUrl(req.url),
    headers,
    params: [],
    body,
    auth,
  };
}

export function importPostmanCollection(json: unknown): ImportResult {
  const pm = json as PmCollection;
  if (!pm || !pm.info || !Array.isArray(pm.item)) {
    throw new Error('This file does not look like a Postman v2.1 collection export.');
  }

  const warnings: string[] = [];
  const folders: Folder[] = [];
  const requests: SavedRequest[] = [];

  function walkFolder(item: PmItem, pathPrefix: string): SavedRequest[] {
    const collected: SavedRequest[] = [];
    for (const child of item.item ?? []) {
      if (isFolder(child)) {
        warnings.push(`Nested folder "${child.name}" inside "${item.name}" was flattened — apibird folders are one level deep.`);
        const nextPrefix = pathPrefix ? `${pathPrefix} / ${child.name ?? 'Untitled'}` : child.name ?? 'Untitled';
        collected.push(...walkFolder(child, nextPrefix));
      } else {
        collected.push(mapRequest(child, pm.auth, warnings, pathPrefix));
      }
    }
    return collected;
  }

  for (const item of pm.item) {
    if (isFolder(item)) {
      folders.push({ id: newId(), name: item.name ?? 'Untitled folder', requests: walkFolder(item, '') });
    } else {
      requests.push(mapRequest(item, pm.auth, warnings, ''));
    }
  }

  const collection: Collection = {
    id: newId(),
    name: pm.info?.name ?? 'Imported Collection',
    folders,
    requests,
  };
  return { collection, warnings };
}

// ---------- Export ----------

function toPmAuth(auth: AuthConfig): PmAuth {
  if (auth.type === 'bearer') return { type: 'bearer', bearer: [{ key: 'token', value: auth.token }] };
  if (auth.type === 'basic') {
    return {
      type: 'basic',
      basic: [
        { key: 'username', value: auth.username },
        { key: 'password', value: auth.password },
      ],
    };
  }
  return { type: 'noauth' };
}

function toPmRequestItem(request: SavedRequest): PmItem {
  return {
    name: request.name,
    request: {
      method: request.method,
      header: request.headers.map((h) => ({ key: h.key, value: h.value })),
      url: { raw: request.url },
      body: request.body ? { mode: 'raw', raw: request.body } : undefined,
      auth: toPmAuth(request.auth),
    },
  };
}

export function exportToPostmanCollection(collection: Collection): unknown {
  const items: PmItem[] = [
    ...collection.folders.map((f) => ({ name: f.name, item: f.requests.map(toPmRequestItem) })),
    ...collection.requests.map(toPmRequestItem),
  ];
  return {
    info: {
      name: collection.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: items,
  };
}
