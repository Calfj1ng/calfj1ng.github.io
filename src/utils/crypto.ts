/**
 * 「每日学习」栏目加解密工具。
 *
 * 算法：PBKDF2(HMAC-SHA256, 100k 迭代) 派生密钥 → AES-GCM-256 加密。
 *
 * 同时运行于两个上下文：
 *   - 构建期（Node 19+，全局 crypto.subtle）：把 Astro slot 渲染出的 HTML 加密成密文。
 *   - 运行期（浏览器）：用户输入密码后用同一套派生流程解密。
 *
 * 注意：源 markdown 仍在 public 仓库里，本模块只保护部署后的渲染产物。
 * 真正的私密请勿放入此仓库。
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_LEN = 16;
const IV_LEN = 12;
const KEY_LEN = 256;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
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
    { name: 'AES-GCM', length: KEY_LEN },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** 密文载体。字段名刻意短，省字节。 */
export interface EncryptedPayload {
  /** ciphertext, base64 */
  c: string;
  /** salt, base64 */
  s: string;
  /** iv, base64 */
  i: string;
  /** PBKDF2 iterations */
  n: number;
}

/** 构建期：用密码加密一段 HTML 字符串。 */
export async function encryptString(
  plaintext: string,
  password: string,
): Promise<EncryptedPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(password, salt);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(plaintext),
  );
  return {
    c: bytesToBase64(new Uint8Array(cipherBuf)),
    s: bytesToBase64(salt),
    i: bytesToBase64(iv),
    n: PBKDF2_ITERATIONS,
  };
}

/** 运行期：用密码解密。密码错误会抛错（AES-GCM 校验失败）。 */
export async function decryptString(
  payload: EncryptedPayload,
  password: string,
): Promise<string> {
  const salt = base64ToBytes(payload.s);
  const iv = base64ToBytes(payload.i);
  const key = await deriveKey(password, salt, payload.n);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    base64ToBytes(payload.c),
  );
  return textDecoder.decode(plainBuf);
}
