// Dev-only one-shot connectivity check for the Telegram bot.
//
// Reads TELEGRAM_BOT_TOKEN from .env.local, calls Telegram's
// /getMe endpoint, and prints just the result of the call. The
// token itself is NEVER echoed.
//
// Usage:  node scripts/telegram-getme.mjs

import fs from 'node:fs';
import path from 'node:path';

const envPath = path.join(process.cwd(), '.env.local');
if (!fs.existsSync(envPath)) {
  console.error('No .env.local found at', envPath);
  process.exit(1);
}

// Tiny dotenv-equivalent so we don't pull a runtime dep just for
// this one-liner. Handles `KEY=VALUE` lines, ignores comments and
// blanks. Trims trailing CR (Windows line endings).
const env = Object.create(null);
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq < 0) continue;
  const key = trimmed.slice(0, eq).trim();
  const val = trimmed.slice(eq + 1).trim();
  env[key] = val;
}

const token = env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is empty in .env.local');
  process.exit(1);
}

// Cheap shape sanity check before we hit the network.
const looksValid = /^\d{5,15}:[A-Za-z0-9_-]{30,}$/.test(token);
if (!looksValid) {
  console.error('Token format looks wrong.');
  console.error('Expected: <digits>:<letters/digits/_-> (e.g. 1234567890:ABC...)');
  console.error('Length detected:', token.length);
  console.error('Has colon?', token.includes(':'));
  process.exit(1);
}

// Disable TLS verification for the corporate-proxy environment,
// matching what the Next dev server already does via
// NODE_TLS_REJECT_UNAUTHORIZED in .env.local.
if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

console.log('Calling api.telegram.org/getMe ...');
try {
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const json = await res.json();
  if (!json.ok) {
    console.error('Telegram rejected the token:');
    console.error(' description:', json.description);
    console.error(' error_code :', json.error_code);
    process.exit(1);
  }
  const me = json.result;
  console.log('OK');
  console.log('  bot id      :', me.id);
  console.log('  username    :', '@' + me.username);
  console.log('  first_name  :', me.first_name);
  console.log('  can_join_groups        :', me.can_join_groups);
  console.log('  can_read_all_group_msgs:', me.can_read_all_group_messages);
  console.log('  supports_inline_queries:', me.supports_inline_queries);
} catch (err) {
  console.error('Network error reaching Telegram:', err?.message ?? err);
  process.exit(1);
}
