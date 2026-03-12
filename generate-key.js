#!/usr/bin/env node

/**
 * License key generator for vise-workflow-engine.
 *
 * Usage:
 *   node generate-key.js --org "Acme Corp"
 *   node generate-key.js --org "Acme Corp" --plan pro --days 365
 *
 * Keep this file private — do NOT publish it to npm.
 */

const crypto = require('crypto');

const SIGN_KEY = 'vise-wfe-2026';

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--org' && args[i + 1]) result.org = args[++i];
    if (args[i] === '--plan' && args[i + 1]) result.plan = args[++i];
    if (args[i] === '--days' && args[i + 1]) result.days = parseInt(args[++i], 10);
  }
  return result;
}

function generateKey({ org, plan = 'standard', days }) {
  if (!org) {
    console.error('Usage: node generate-key.js --org "Company Name" [--plan pro] [--days 365]');
    process.exit(1);
  }

  const data = { org, plan };
  if (days) {
    data.exp = Date.now() + days * 24 * 60 * 60 * 1000;
  }

  const payload = Buffer.from(JSON.stringify(data)).toString('base64');
  const signature = crypto
    .createHmac('sha256', SIGN_KEY)
    .update(payload)
    .digest('hex')
    .slice(0, 16);

  const key = `${payload}.${signature}`;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  vise-workflow-engine — License Key');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Org:    ${org}`);
  console.log(`  Plan:   ${plan}`);
  console.log(`  Expiry: ${days ? `${days} days (${new Date(data.exp).toISOString().split('T')[0]})` : 'never'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n  ${key}\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  return key;
}

const opts = parseArgs(process.argv.slice(2));
generateKey(opts);
