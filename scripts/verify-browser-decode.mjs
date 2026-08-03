// Simulate exactly what the browser does:
//   1. Browser parses HTML, entity-decodes attribute value ONCE
//   2. JS calls element.getAttribute('data-payload') → gets the once-decoded string
//   3. Our client script does .replace(/&quot;/g, '"') then JSON.parse
//
// This script reproduces that chain against the BUILT html file (not source bytes)
// to prove the runtime decode actually works.
import { readFileSync } from 'node:fs';

const html = readFileSync('dist/daily/hello-world/index.html', 'utf8');
const m = html.match(/data-payload="([^"]*)"/);
if (!m) throw new Error('data-payload attribute not found in built HTML');

const rawSource = m[1];
console.log('raw source (first 100 chars):', rawSource.slice(0, 100));

// Step 1: browser entity-decodes the attribute value ONCE.
// Common encodings Astro produces: &amp; → &, &#38; → &, &quot; → ".
// The DOMParser/getAttribute does this automatically.
function decodeHtmlEntitiesOnce(s) {
  return s
    .replace(/&#38;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

const browserDecoded = decodeHtmlEntitiesOnce(rawSource);
console.log('after browser once-decode (first 100):', browserDecoded.slice(0, 100));

// Step 2: our client script's processing
const clientProcessed = browserDecoded.replace(/&quot;/g, '"');
console.log('after client replace (first 100):', clientProcessed.slice(0, 100));

// Step 3: JSON.parse
let payload;
try {
  payload = JSON.parse(clientProcessed);
  console.log('JSON.parse OK. keys:', Object.keys(payload).join(','));
} catch (e) {
  console.log('JSON.parse FAILED:', e.message);
  process.exit(1);
}

// Step 4: decrypt with test password
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
function b64(b) { const bin = atob(b); const out = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
async function deriveKey(pw, salt, iters) {
  const bk = await crypto.subtle.importKey('raw', textEncoder.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:iters,hash:'SHA-256'}, bk, {name:'AES-GCM',length:256}, false, ['decrypt']);
}
async function decrypt(p, pw) {
  const k = await deriveKey(pw, b64(p.s), p.n);
  const buf = await crypto.subtle.decrypt({name:'AES-GCM', iv: b64(p.i)}, k, b64(p.c));
  return textDecoder.decode(buf);
}

const plain = await decrypt(payload, process.env.DAILY_PASSWORD || '1173');
console.log('decrypted length:', plain.length);
console.log('contains 加密栏目使用说明:', plain.includes('加密栏目使用说明'));
console.log('contains 这里是第一篇:', plain.includes('这里是第一篇'));
console.log('SIMULATION PASSED');
