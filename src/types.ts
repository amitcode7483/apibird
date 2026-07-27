export type AuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string };

export interface KeyValue {
  key: string;
  value: string;
}

export interface SavedRequest {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: KeyValue[];
  params: KeyValue[];
  body: string;
  auth: AuthConfig;
}

export interface Folder {
  id: string;
  name: string;
  requests: SavedRequest[];
}

export interface Collection {
  id: string;
  name: string;
  folders: Folder[];
  requests: SavedRequest[];
}

export interface Environment {
  id: string;
  name: string;
  variables: KeyValue[];
}

export interface HistoryEntry {
  id: string;
  method: string;
  url: string;
  status: number | string;
  time: number;
  timestamp: number;
}
