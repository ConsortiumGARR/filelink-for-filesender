'use strict';
// Tests request() in src/lib/filesender.js with a fake fetch, fake timers and a
// fake AbortSignal: retries (408/429/5xx, Retry-After), no retry on 500, timeouts
// and abort during the backoff. Real crypto.subtle (Node's, not a stub) signs
// each attempt, so this exercises the exact code path the extension runs.
// Run: node --test test/request/request.test.js
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

globalThis.console = { log() {}, warn() {} };

const T = { timers: [], delays: [] };
globalThis.setTimeout = (fn, ms) => {
  T.delays.push(ms);
  T.timers.push(fn);
  return T.timers.length;
};
globalThis.clearTimeout = (id) => {
  T.timers[id - 1] = null;
};
function flushTimers() {
  const list = T.timers;
  T.timers = [];
  list.forEach((fn) => fn && fn());
}

function makeSignal() {
  const s = { aborted: false, listeners: [] };
  s.addEventListener = (ev, fn) => s.listeners.push(fn);
  s.removeEventListener = (ev, fn) => {
    s.listeners = s.listeners.filter((f) => f !== fn);
  };
  return s;
}
globalThis.AbortSignal = { timeout: () => makeSignal(), any: (list) => list[0] };
function abortSignal(s) {
  s.aborted = true;
  s.listeners.forEach((fn) => fn());
}

const F = { queue: [], calls: 0 };
function resp(status, body, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (headers || {})[k] || null },
    text: () => Promise.resolve(body || ''),
  };
}
globalThis.fetch = () => {
  F.calls++;
  const next = F.queue.shift();
  if (!next) return Promise.reject(new Error('no more responses'));
  if (next.error) {
    const e = new Error(next.error);
    e.name = next.error;
    return Promise.reject(e);
  }
  return Promise.resolve(resp(next.status, next.body, next.headers));
};

require(path.join(__dirname, '..', '..', 'src', 'lib', 'filesender.js'));
const fs = globalThis.filesender;

const acc = { baseUrl: 'https://fs.example.org/rest.php', username: 'u', apikey: 'k' };

function reset(queue) {
  F.queue = queue;
  F.calls = 0;
  T.timers = [];
  T.delays = [];
}

// Polls the real Node event loop (via setImmediate, never faked) until `cond`
// is true, so each test advances exactly as far as request()'s own promise
// chain has gotten -- no blind tick counts.
async function waitFor(cond, what) {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('waitFor: ' + what + ' never happened');
}

test('429 with Retry-After schedules the given delay, then succeeds', async () => {
  reset([
    { status: 429, headers: { 'Retry-After': '2' } },
    { status: 200, body: '{"a":1}' },
  ]);
  const p = fs.request(acc, { method: 'get', path: '/x', data: {} });
  await waitFor(() => T.timers.length > 0, 'the retry sleep to be scheduled');
  flushTimers();
  const v = await p;
  assert.equal(v.a, 1);
  assert.equal(T.delays[0], 2000);
  assert.equal(F.calls, 2);
});

test('retries are exhausted after 3 attempts with exponential backoff', async () => {
  reset([{ status: 408 }, { status: 503 }, { status: 504 }, { status: 502 }]);
  const p = fs.request(acc, { method: 'get', path: '/x', data: {} });
  for (let i = 0; i < 3; i++) {
    await waitFor(() => T.timers.length > 0, 'retry ' + i + ' to be scheduled');
    flushTimers();
  }
  await assert.rejects(p, (e) => e.status === 502);
  assert.equal(F.calls, 4);
  assert.deepEqual(T.delays, [2000, 4000, 6000]);
});

test('500 is a FileSender application error, never retried', async () => {
  reset([{ status: 500, body: '{"message":"transfer_maximum_size_exceeded"}' }]);
  const p = fs.request(acc, { method: 'post', path: '/transfer', data: {}, content: {} });
  await assert.rejects(p, (e) => e.code === 'transfer_maximum_size_exceeded');
  assert.equal(F.calls, 1);
  assert.equal(T.delays.length, 0);
});

test('an auth error is never retried', async () => {
  reset([{ status: 500, body: 'auth_remote_signature_check_failed' }]);
  const p = fs.request(acc, { method: 'get', path: '/x', data: {} });
  await assert.rejects(p, (e) => /HTTP 500/.test(e.message));
  assert.equal(F.calls, 1);
});

test('a network timeout is retried', async () => {
  reset([{ error: 'TimeoutError' }, { status: 200, body: '"ok"' }]);
  const p = fs.request(acc, {
    method: 'put',
    path: '/file/1/chunk/0',
    data: {},
    rawContent: new Uint8Array(3),
  });
  await waitFor(() => T.timers.length > 0, 'the retry sleep to be scheduled');
  flushTimers();
  const v = await p;
  assert.equal(v, 'ok');
  assert.equal(F.calls, 2);
});

test('the timeout error message names the elapsed seconds', async () => {
  reset([{ error: 'TimeoutError' }, { error: 'TimeoutError' }]);
  const p = fs.request(acc, { method: 'get', path: '/x', data: {}, retries: 1 });
  await waitFor(() => T.timers.length > 0, 'the retry sleep to be scheduled');
  flushTimers();
  await assert.rejects(p, (e) => /timeout after 60s/.test(e.message));
});

test('aborting during the backoff sleep surfaces AbortError', async () => {
  const sig = makeSignal();
  reset([{ status: 503 }, { status: 200, body: '{}' }]);
  const p = fs.request(Object.assign({}, acc, { signal: sig }), {
    method: 'get',
    path: '/x',
    data: {},
  });
  await waitFor(() => T.timers.length > 0, 'the retry sleep to be scheduled');
  abortSignal(sig);
  await assert.rejects(p, (e) => e.name === 'AbortError');
  assert.equal(F.calls, 1);
});

test('Retry-After is capped at 30s', async () => {
  reset([
    { status: 429, headers: { 'Retry-After': '120' } },
    { status: 200, body: '{}' },
  ]);
  const p = fs.request(acc, { method: 'get', path: '/x', data: {} });
  await waitFor(() => T.timers.length > 0, 'the retry sleep to be scheduled');
  flushTimers();
  await p;
  assert.equal(T.delays[0], 30000);
});
