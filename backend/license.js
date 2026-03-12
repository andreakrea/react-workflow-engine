/**
 * License key validation for vise-workflow-engine.
 *
 * Key format: base64({ org, exp, plan }) + '.' + hmac_signature
 *
 * Keys are generated with generate-key.js and validated at runtime.
 * This prevents casual use without a license but doesn't require a server.
 */

const crypto = require('crypto');

// Public validation salt (the secret is only in generate-key.js)
const SIGN_KEY = 'vise-wfe-2026';

let _validatedLicense = null;

function _verify(payload, signature) {
  const expected = crypto
    .createHmac('sha256', SIGN_KEY)
    .update(payload)
    .digest('hex')
    .slice(0, 16);
  return expected === signature;
}

/**
 * Validate a license key and unlock the package.
 *
 * @param {string} key  License key string (e.g. "eyJvcm...==.a1b2c3d4e5f6g7h8")
 * @returns {{ valid: boolean, org?: string, plan?: string, error?: string }}
 */
function validateLicense(key) {
  if (!key || typeof key !== 'string') {
    return { valid: false, error: 'License key is required' };
  }

  const parts = key.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Invalid key format' };
  }

  const [payload, signature] = parts;

  if (!_verify(payload, signature)) {
    return { valid: false, error: 'Invalid license key' };
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return { valid: false, error: 'Corrupted key data' };
  }

  if (data.exp && Date.now() > data.exp) {
    return { valid: false, error: `License expired on ${new Date(data.exp).toISOString().split('T')[0]}` };
  }

  _validatedLicense = data;
  return { valid: true, org: data.org, plan: data.plan || 'standard' };
}

/**
 * Check whether a valid license has been activated.
 * Called internally by WorkflowEngine and createWorkflowRouter.
 */
function _requireLicense(caller) {
  if (!_validatedLicense) {
    throw new Error(
      `vise-workflow-engine: License key required. Call validateLicense(key) before using ${caller}.\n` +
      `Get a key at: https://github.com/andreakrea/workflow-engine`
    );
  }
}

/**
 * Returns the current license info, or null if not activated.
 */
function getLicenseInfo() {
  return _validatedLicense ? { ..._validatedLicense } : null;
}

module.exports = { validateLicense, _requireLicense, getLicenseInfo };
