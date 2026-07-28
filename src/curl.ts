import { AuthConfig, KeyValue } from './types';

export interface CurlRequest {
  method: string;
  url: string;
  headers: KeyValue[];
  body: string;
  auth: AuthConfig;
}

/** Tokenizes a shell-style command line, honoring single/double quotes and backslash escapes. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    while (i < n && /\s/.test(input[i])) i++;
    if (i >= n) break;
    let token = '';
    while (i < n && !/\s/.test(input[i])) {
      const ch = input[i];
      if (ch === "'") {
        i++;
        while (i < n && input[i] !== "'") token += input[i++];
        i++;
      } else if (ch === '"') {
        i++;
        while (i < n && input[i] !== '"') {
          if (input[i] === '\\' && i + 1 < n && '"\\$`'.includes(input[i + 1])) {
            token += input[i + 1];
            i += 2;
          } else {
            token += input[i++];
          }
        }
        i++;
      } else if (ch === '\\' && i + 1 < n) {
        token += input[i + 1];
        i += 2;
      } else {
        token += ch;
        i++;
      }
    }
    tokens.push(token);
  }
  return tokens;
}

const NO_OP_FLAGS = new Set([
  '-k',
  '--insecure',
  '-s',
  '--silent',
  '-S',
  '--show-error',
  '-L',
  '--location',
  '-v',
  '--verbose',
  '--compressed',
  '-i',
  '--include',
  '-#',
  '--progress-bar',
]);

export function parseCurl(input: string): CurlRequest {
  const normalized = input.replace(/\\\r?\n/g, ' ').replace(/\r?\n/g, ' ').trim();
  if (!normalized) throw new Error('Nothing to parse.');

  const tokens = tokenize(normalized);
  if (tokens[0]?.toLowerCase() === 'curl') tokens.shift();

  let method: string | undefined;
  let url: string | undefined;
  const headers: KeyValue[] = [];
  const dataParts: string[] = [];
  let auth: AuthConfig = { type: 'none' };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    switch (tok) {
      case '-X':
      case '--request':
        method = tokens[++i];
        break;
      case '-H':
      case '--header': {
        const raw = tokens[++i] ?? '';
        const idx = raw.indexOf(':');
        if (idx !== -1) headers.push({ key: raw.slice(0, idx).trim(), value: raw.slice(idx + 1).trim() });
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
      case '--data-urlencode':
        dataParts.push(tokens[++i] ?? '');
        break;
      case '-u':
      case '--user': {
        const cred = tokens[++i] ?? '';
        const sep = cred.indexOf(':');
        const username = sep === -1 ? cred : cred.slice(0, sep);
        const password = sep === -1 ? '' : cred.slice(sep + 1);
        auth = { type: 'basic', username, password };
        break;
      }
      case '--url':
        url = tokens[++i];
        break;
      case '-A':
      case '--user-agent':
        headers.push({ key: 'User-Agent', value: tokens[++i] ?? '' });
        break;
      case '-b':
      case '--cookie':
        headers.push({ key: 'Cookie', value: tokens[++i] ?? '' });
        break;
      case '-I':
      case '--head':
        method = method ?? 'HEAD';
        break;
      case '-G':
      case '--get':
        method = method ?? 'GET';
        break;
      default:
        if (NO_OP_FLAGS.has(tok)) break;
        if (!tok.startsWith('-') && !url) url = tok;
        break;
    }
  }

  if (!url) throw new Error('No URL found in the curl command.');

  const body = dataParts.join('&');
  if (!method) method = dataParts.length > 0 ? 'POST' : 'GET';

  if (auth.type === 'none') {
    const bearerIdx = headers.findIndex((h) => h.key.toLowerCase() === 'authorization' && /^bearer\s/i.test(h.value));
    if (bearerIdx !== -1) {
      auth = { type: 'bearer', token: headers[bearerIdx].value.replace(/^bearer\s+/i, '') };
      headers.splice(bearerIdx, 1);
    }
  }

  return { method: method.toUpperCase(), url, headers, body, auth };
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function toCurl(req: CurlRequest): string {
  const parts = ['curl'];
  if (req.method && req.method !== 'GET') parts.push('-X', req.method);
  parts.push(shQuote(req.url));

  const headers = [...req.headers];
  if (req.auth?.type === 'bearer' && req.auth.token) {
    headers.push({ key: 'Authorization', value: `Bearer ${req.auth.token}` });
  }
  for (const h of headers) {
    if (!h.key.trim()) continue;
    parts.push('-H', shQuote(`${h.key}: ${h.value}`));
  }
  if (req.auth?.type === 'basic') {
    parts.push('-u', shQuote(`${req.auth.username}:${req.auth.password}`));
  }
  if (req.body?.trim() && req.method !== 'GET' && req.method !== 'HEAD') {
    parts.push('--data-raw', shQuote(req.body));
  }
  return parts.join(' \\\n  ');
}
