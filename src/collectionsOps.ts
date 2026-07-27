import { newId } from './storage';
import { Collection, Folder, SavedRequest } from './types';

export type NodeRef =
  | { kind: 'collection'; collectionId: string }
  | { kind: 'folder'; collectionId: string; folderId: string }
  | { kind: 'request'; collectionId: string; folderId?: string; requestId: string };

function cloneCollections(collections: Collection[]): Collection[] {
  return JSON.parse(JSON.stringify(collections));
}

function findCollection(collections: Collection[], id: string): Collection | undefined {
  return collections.find((c) => c.id === id);
}

function findFolder(collection: Collection, id: string): Folder | undefined {
  return collection.folders.find((f) => f.id === id);
}

function requestListFor(collection: Collection, folderId: string | undefined): SavedRequest[] {
  if (!folderId) return collection.requests;
  const folder = findFolder(collection, folderId);
  return folder ? folder.requests : [];
}

export function addCollection(collections: Collection[], name: string): Collection[] {
  const next = cloneCollections(collections);
  next.push({ id: newId(), name, folders: [], requests: [] });
  return next;
}

export function addFolder(collections: Collection[], collectionId: string, name: string): Collection[] {
  const next = cloneCollections(collections);
  const collection = findCollection(next, collectionId);
  if (!collection) return next;
  collection.folders.push({ id: newId(), name, requests: [] });
  return next;
}

export function saveRequest(
  collections: Collection[],
  collectionId: string,
  folderId: string | undefined,
  request: SavedRequest
): Collection[] {
  const next = cloneCollections(collections);
  const collection = findCollection(next, collectionId);
  if (!collection) return next;
  requestListFor(collection, folderId).push(request);
  return next;
}

export function renameNode(collections: Collection[], ref: NodeRef, name: string): Collection[] {
  const next = cloneCollections(collections);
  const collection = findCollection(next, ref.collectionId);
  if (!collection) return next;

  if (ref.kind === 'collection') {
    collection.name = name;
  } else if (ref.kind === 'folder') {
    const folder = findFolder(collection, ref.folderId);
    if (folder) folder.name = name;
  } else {
    const list = requestListFor(collection, ref.folderId);
    const request = list.find((r) => r.id === ref.requestId);
    if (request) request.name = name;
  }
  return next;
}

export function deleteNode(collections: Collection[], ref: NodeRef): Collection[] {
  const next = cloneCollections(collections);
  if (ref.kind === 'collection') {
    return next.filter((c) => c.id !== ref.collectionId);
  }
  const collection = findCollection(next, ref.collectionId);
  if (!collection) return next;

  if (ref.kind === 'folder') {
    collection.folders = collection.folders.filter((f) => f.id !== ref.folderId);
  } else {
    if (ref.folderId) {
      const folder = findFolder(collection, ref.folderId);
      if (folder) folder.requests = folder.requests.filter((r) => r.id !== ref.requestId);
    } else {
      collection.requests = collection.requests.filter((r) => r.id !== ref.requestId);
    }
  }
  return next;
}

export function duplicateNode(collections: Collection[], ref: NodeRef): Collection[] {
  const next = cloneCollections(collections);
  const collection = findCollection(next, ref.collectionId);
  if (!collection) return next;

  if (ref.kind === 'collection') {
    const copy: Collection = JSON.parse(JSON.stringify(collection));
    copy.id = newId();
    copy.name = `${collection.name} (copy)`;
    copy.requests.forEach((r) => (r.id = newId()));
    copy.folders.forEach((f) => {
      f.id = newId();
      f.requests.forEach((r) => (r.id = newId()));
    });
    next.push(copy);
  } else if (ref.kind === 'folder') {
    const folder = findFolder(collection, ref.folderId);
    if (!folder) return next;
    const cloned: Folder = JSON.parse(JSON.stringify(folder));
    cloned.id = newId();
    cloned.name = `${folder.name} (copy)`;
    cloned.requests.forEach((r) => (r.id = newId()));
    collection.folders.push(cloned);
  } else {
    const list = requestListFor(collection, ref.folderId);
    const request = list.find((r) => r.id === ref.requestId);
    if (!request) return next;
    const cloned: SavedRequest = JSON.parse(JSON.stringify(request));
    cloned.id = newId();
    cloned.name = `${request.name} (copy)`;
    list.push(cloned);
  }
  return next;
}

export function findRequest(collections: Collection[], ref: NodeRef): SavedRequest | undefined {
  if (ref.kind !== 'request') return undefined;
  const collection = findCollection(collections, ref.collectionId);
  if (!collection) return undefined;
  return requestListFor(collection, ref.folderId).find((r) => r.id === ref.requestId);
}
