/**
 * License keys.
 *
 * Current format (2.x):  vwe2.<base64url JSON { org, plan?, exp? }>.<base64url Ed25519 signature>
 * Keys are signed with a private key that never leaves the issuer (generate-key.js);
 * the package only holds the public key, so keys cannot be forged from the source.
 *
 * Legacy format (1.x):   <base64 JSON>.<16 hex chars of HMAC-SHA256>
 * Still accepted with a warning so existing installs keep working. Its secret is
 * public, so it will stop being accepted in 3.0.
 *
 * What needs a key: createEngine and createHandler with real (non-memory)
 * stores. The editor and in-memory stores (tests, demos) don't.
 * State lives on globalThis so every entry point sees the same activation.
 */
import { ed25519 } from '@noble/curves/ed25519';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';

const PUBLIC_KEY_HEX = '9b02ed94388c2f8ea461bb00ad9b53d8fa0ca593870f151647893d715b8e7507';
const LEGACY_SECRET = 'vise-wfe-2026';
const STATE = Symbol.for('vise-workflow-engine.license');

export interface LicenseInfo {
  org: string;
  plan: string;
  exp?: number;
  /** True for 1.x keys: still accepted, should be replaced. */
  legacy?: boolean;
}

export type LicenseResult = ({ valid: true } & LicenseInfo) | { valid: false; error: string };

interface State {
  info: LicenseInfo | null;
  publicKey: string;
  warned: boolean;
}

function state(): State {
  const g = globalThis as Record<symbol, State | undefined>;
  return (g[STATE] ??= { info: null, publicKey: PUBLIC_KEY_HEX, warned: false });
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
const utf8 = (s: string) => new TextEncoder().encode(s);

function fromBase64(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  if (typeof atob === 'function') return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Uint8Array((globalThis as any).Buffer.from(b64, 'base64'));
}

function parsePayload(b64: string): { org?: string; plan?: string; exp?: number } | null {
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64(b64)));
  } catch {
    return null;
  }
}

/** Checks a key without activating it. */
export function checkLicense(key: string | undefined | null): LicenseResult {
  if (!key || typeof key !== 'string') return { valid: false, error: 'License key is required' };
  const parts = key.trim().split('.');
  let data: { org?: string; plan?: string; exp?: number } | null;
  let legacy = false;

  if (parts.length === 3 && parts[0] === 'vwe2') {
    let ok = false;
    try {
      ok = ed25519.verify(fromBase64(parts[2]), utf8(parts[1]), fromHex(state().publicKey));
    } catch {
      ok = false;
    }
    if (!ok) return { valid: false, error: 'Invalid license key' };
    data = parsePayload(parts[1]);
  } else if (parts.length === 2) {
    if (hex(hmac(sha256, utf8(LEGACY_SECRET), utf8(parts[0]))).slice(0, 16) !== parts[1]) {
      return { valid: false, error: 'Invalid license key' };
    }
    data = parsePayload(parts[0]);
    legacy = true;
  } else {
    return { valid: false, error: 'Invalid key format' };
  }

  if (!data) return { valid: false, error: 'Corrupted key data' };
  if (data.exp && Date.now() > data.exp) {
    return { valid: false, error: `License expired on ${new Date(data.exp).toISOString().slice(0, 10)}` };
  }
  return { valid: true, org: data.org ?? '', plan: data.plan ?? 'standard', exp: data.exp, ...(legacy ? { legacy } : {}) };
}

/** Validates and activates a key for this process. Safe to call more than once. */
export function validateLicense(key: string | undefined | null): LicenseResult {
  const result = checkLicense(key);
  if (result.valid) {
    const { valid: _v, ...info } = result;
    state().info = info;
    if (info.legacy && !state().warned) {
      state().warned = true;
      console.warn('vise-workflow-engine: this is a 1.x license key. It still works, but ask for a new key: 1.x keys stop working in 3.0.');
    }
  }
  return result;
}

export function getLicenseInfo(): LicenseInfo | null {
  const info = state().info;
  return info ? { ...info } : null;
}

/** @internal Throws unless a key was activated, or `key` is valid. */
export function requireLicense(caller: string, key?: string | null): void {
  if (key) {
    const r = validateLicense(key);
    if (!r.valid) throw licenseError(caller, r.error);
    return;
  }
  if (!state().info) throw licenseError(caller, 'License key required');
}

function licenseError(caller: string, reason: string): Error {
  const err = new Error(
    `vise-workflow-engine: ${reason}. Pass { licenseKey } to ${caller} or call validateLicense(key) once at startup. ` +
      `(In-memory stores for tests and demos need no key.)`,
  );
  Object.assign(err, { name: 'WorkflowError', code: 'LICENSE' });
  return err;
}

/** @internal Test hook: trust another public key and clear the activation. */
export function _resetLicenseForTests(publicKeyHex?: string): void {
  Object.assign(state(), { info: null, warned: false, publicKey: publicKeyHex ?? PUBLIC_KEY_HEX });
}

/** Marks stores that need no license (in-memory ones). */
export const NO_LICENSE = Symbol.for('vise-workflow-engine.no-license');
export const needsLicense = (...stores: unknown[]) =>
  !stores.every((s) => !!s && typeof s === 'object' && (s as Record<symbol, unknown>)[NO_LICENSE] === true);
