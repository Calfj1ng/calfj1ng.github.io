// Functional test: parse encrypted payload from built HTML, decrypt, verify.
// Run: node scripts/verify-crypto.mjs
import { readFileSync } from 'node:fs';

const html = readFileSync('dist/daily/hello-world/index.html', 'utf8');
const m = html.match(/data-payload="([^"]+)"/);
if (!m) throw new Error('payload attribute not found');

// Decode HTML entity encoding (Astro serializes " as &quot; which may render as &#38;quot;).
const raw = m[1];
const decoded = raw
  .replace(/&#38;quot;/g, '"')
  .replace(/&amp;quot;/g, '"')
  .replace(/&quot;/g, '"');

const payload = JSON.parse(decoded);
console.log('payload keys:', Object.keys(payload).join(','));
console.log('iterations:', payload.n);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(password, salt, iterations) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

async function decryptString(p, password) {
  const salt = base64ToBytes(p.s);
  const iv = base64ToBytes(p.i);
  const key = await deriveKey(password, salt, p.n);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    base64ToBytes(p.c),
  );
  return textDecoder.decode(plainBuf);
}

const password = process.env.DAILY_PASSWORD || '1173';

console.log('--- correct password ---');
const plain = await decryptString(payload, password);
console.log('decrypted length:', plain.length);
console.log('contains title:', plain.includes('加密栏目使用说明'));
console.log('contains body:', plain.includes('这里是第一篇每日学习笔记'));
console.log('contains def:', plain.includes('def'));
console.log('contains hello:', plain.includes('hello'));
console.log('contains language-python:', plain.includes('language-python'));

console.log('--- wrong password ---');
try {
  await decryptString(payload, 'wrong-password-xxx');
  console.log('FAIL: wrong password succeeded');
  process.exit(1);
} catch (e) {
  console.log('OK: rejected. error name:', e.name);
}
