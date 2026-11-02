#!/usr/bin/env node
/**
 * License key generator for vise-workflow-engine (2.x keys, Ed25519).
 *
 *   node generate-key.js --org "Acme Corp"
 *   node generate-key.js --org "Acme Corp" --plan pro --days 365
 *
 * Signs with the private key in VWE_LICENSE_PRIVATE_KEY (hex) or
 * ~/.vise-workflow-engine/license-private.key. Never commit or publish that key;
 * keep a backup — keys can't be issued without it. The matching public key is
 * PUBLIC_KEY_HEX in src/core/license.ts.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ed25519 } = require('@noble/curves/ed25519');

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const org = arg('org');
const plan = arg('plan') || 'standard';
const days = arg('days') ? parseInt(arg('days'), 10) : undefined;
if (!org) {
  console.error('Usage: node generate-key.js --org "Company Name" [--plan pro] [--days 365]');
  process.exit(1);
}

const keyFile = path.join(os.homedir(), '.vise-workflow-engine', 'license-private.key');
const privateHex = (process.env.VWE_LICENSE_PRIVATE_KEY || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : '')).trim();
if (!/^[0-9a-f]{64}$/i.test(privateHex)) {
  console.error(`No private key. Set VWE_LICENSE_PRIVATE_KEY or create ${keyFile}.`);
  process.exit(1);
}

const data = { org, plan, ...(days ? { exp: Date.now() + days * 86400000 } : {}) };
const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
const signature = Buffer.from(ed25519.sign(new TextEncoder().encode(payload), Buffer.from(privateHex, 'hex'))).toString('base64url');
const key = `vwe2.${payload}.${signature}`;

console.log(`\n  Org:    ${org}\n  Plan:   ${plan}\n  Expiry: ${data.exp ? new Date(data.exp).toISOString().slice(0, 10) : 'never'}\n\n  ${key}\n`);
