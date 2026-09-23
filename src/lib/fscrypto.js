(function (global) {
  'use strict';

  const te = new TextEncoder();

  const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const LOWER = 'abcdefghijklmnopqrstuvwxyz';
  const DIGITS = '0123456789';
  const SPECIAL = '!@#$%^&*()-_=+[]{};:,.?';

  function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function randomBytes(n) {
    const out = new Uint8Array(n);
    crypto.getRandomValues(out);
    return out;
  }

  function randomIndex(n) {
    const limit = 256 - (256 % n);
    const b = new Uint8Array(1);
    do {
      crypto.getRandomValues(b);
    } while (b[0] >= limit);
    return b[0] % n;
  }

  function checkPassword(pw, rules) {
    rules = rules || {};
    const failed = [];
    if (!/^[\x20-\x7e]*$/.test(pw)) failed.push('ascii');
    if (pw.length < (rules.minPasswordLength || 1)) failed.push('length');
    if (rules.mixedCase && !(/[a-z]/.test(pw) && /[A-Z]/.test(pw))) failed.push('mixedCase');
    if (rules.numbers && !/[0-9]/.test(pw)) failed.push('numbers');
    if (rules.special && !/[^A-Za-z0-9]/.test(pw)) failed.push('special');
    return failed;
  }

  function generatePassword(rules) {
    rules = rules || {};
    const len = Math.max(rules.generatedPasswordLength || 0, rules.minPasswordLength || 0, 16);
    const all = UPPER + LOWER + DIGITS + SPECIAL;
    const chars = [UPPER, LOWER, DIGITS, SPECIAL].map((set) => set[randomIndex(set.length)]);
    while (chars.length < len) chars.push(all[randomIndex(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  function aeadString(ivB64, chunkCount, chunkSize) {
    return (
      '{"aeadversion":1,"chunkcount":' +
      chunkCount +
      ',"chunksize":' +
      chunkSize +
      ',"iv":"' +
      ivB64 +
      '","aeadterminator":1}'
    );
  }

  function newFileParams(ivLength, size, chunkSize, ivBytes) {
    ivBytes = ivBytes || randomBytes(ivLength - 4);
    const ivB64 = bytesToB64(ivBytes);
    const aead = aeadString(ivB64, Math.ceil(size / chunkSize), chunkSize);
    return { ivBytes, ivB64, aead, aeadB64: btoa(aead) };
  }

  async function deriveKey(password, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, [
      'deriveKey',
    ]);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: te.encode(salt), iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );
  }

  async function encryptChunk(key, ivBytes, chunkIndex, aead, data) {
    const fullIv = new Uint8Array(ivBytes.length + 4);
    fullIv.set(ivBytes, 0);
    new DataView(fullIv.buffer).setUint32(ivBytes.length, chunkIndex, true);
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: fullIv, additionalData: te.encode(aead), tagLength: 128 },
        key,
        data,
      ),
    );
    const out = new Uint8Array(fullIv.length + ct.length);
    out.set(fullIv, 0);
    out.set(ct, fullIv.length);
    return out;
  }

  global.fscrypto = {
    checkPassword,
    generatePassword,
    aeadString,
    newFileParams,
    deriveKey,
    encryptChunk,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
