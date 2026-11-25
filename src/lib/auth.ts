const encoder = new TextEncoder();
const decoder = new TextDecoder();

const DEFAULT_DEV_SECRET = 'stagesync-dev-secret-change-in-production';

export interface SessionPayload {
  username: string;
  role: 'admin' | 'user';
  exp: number;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function derivePbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return toHex(new Uint8Array(bits));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePbkdf2(password, salt);
  return `pbkdf2:${toHex(salt)}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('pbkdf2:')) {
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    const salt = fromHex(parts[1]);
    const expectedHash = parts[2];
    const actualHash = await derivePbkdf2(password, salt);
    return constantTimeEqual(actualHash, expectedHash);
  }
  return constantTimeEqual(password, stored);
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function createSessionToken(
  payload: Omit<SessionPayload, 'exp'>,
  secret?: string,
  ttlSeconds = 60 * 60 * 24 * 14
): Promise<string> {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = toBase64Url(encoder.encode(JSON.stringify(fullPayload)));
  const key = await getHmacKey(secret || DEFAULT_DEV_SECRET);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret?: string
): Promise<SessionPayload | null> {
  if (!token || !token.includes('.')) return null;
  const [body, sigB64] = token.split('.', 2);
  if (!body || !sigB64) return null;

  try {
    const key = await getHmacKey(secret || DEFAULT_DEV_SECRET);
    const sig = fromBase64Url(sigB64);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sig as BufferSource,
      encoder.encode(body)
    );
    if (!valid) return null;

    const parsed = JSON.parse(decoder.decode(fromBase64Url(body))) as SessionPayload;
    if (!parsed.username || !parsed.role || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
