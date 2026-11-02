import { ed25519 } from '@noble/curves/ed25519';
import { _resetLicenseForTests, validateLicense } from '../src/core/license';

/** A 1.x key (HMAC). Still accepted, with a warning. */
export const LEGACY_KEY = 'eyJvcmciOiJEZW1vIiwicGxhbiI6InBybyJ9.c61270d419656170';

// Throwaway keypair: tests never touch the real signing key.
const privateKey = ed25519.utils.randomPrivateKey();
export const TEST_PUBLIC_KEY = Buffer.from(ed25519.getPublicKey(privateKey)).toString('hex');

export function signKey(data: Record<string, unknown>, key: Uint8Array = privateKey): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `vwe2.${payload}.${Buffer.from(ed25519.sign(new TextEncoder().encode(payload), key)).toString('base64url')}`;
}

export function activateTestLicense(): void {
  _resetLicenseForTests(TEST_PUBLIC_KEY);
  validateLicense(signKey({ org: 'Test', plan: 'test' }));
}
