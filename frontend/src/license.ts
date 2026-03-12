const SIGN_KEY = 'vise-wfe-2026';

async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface LicenseData {
  org: string;
  plan?: string;
  exp?: number;
}

export async function validateLicenseKey(
  key: string | undefined
): Promise<{ valid: boolean; data?: LicenseData; error?: string }> {
  if (!key) return { valid: false, error: 'License key is required' };

  const parts = key.split('.');
  if (parts.length !== 2) return { valid: false, error: 'Invalid key format' };

  const [payload, signature] = parts;

  const fullHmac = await hmacHex(SIGN_KEY, payload);
  const expected = fullHmac.slice(0, 16);

  if (expected !== signature) return { valid: false, error: 'Invalid license key' };

  try {
    const data: LicenseData = JSON.parse(atob(payload));
    if (data.exp && Date.now() > data.exp) {
      return { valid: false, error: `License expired` };
    }
    return { valid: true, data };
  } catch {
    return { valid: false, error: 'Corrupted key data' };
  }
}
