#!/usr/bin/env python3
# Tests request() in src/lib/filesender.js with fake fetch, timers and
# AbortSignal: retries (408/429/5xx, Retry-After), no retry on 500, timeouts and
# abort during the backoff. Usage: python3 test/request_sim.py
import os
import sys

import gi

gi.require_version("JavaScriptCore", "4.1")
from gi.repository import JavaScriptCore as J  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SHIMS = r"""
globalThis.console = { log: function () {}, warn: function () {} };
globalThis.TextEncoder = function () {};
TextEncoder.prototype.encode = function (s) {
  var out = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
};
globalThis.btoa = function (s) { return s; };
globalThis.atob = function (s) { return s; };
globalThis.DOMException = function (msg, name) { this.message = msg; this.name = name; };
globalThis.crypto = { subtle: {
  importKey: function () { return Promise.resolve({}); },
  sign: function () { return Promise.resolve(new ArrayBuffer(20)); },
} };

var T = { timers: [], delays: [] };
globalThis.setTimeout = function (fn, ms) { T.delays.push(ms); T.timers.push(fn); return T.timers.length; };
globalThis.clearTimeout = function (id) { T.timers[id - 1] = null; };
function flushTimers() { var list = T.timers; T.timers = []; list.forEach(function (fn) { if (fn) fn(); }); }

function makeSignal() {
  var s = { aborted: false, listeners: [] };
  s.addEventListener = function (ev, fn) { s.listeners.push(fn); };
  s.removeEventListener = function (ev, fn) { s.listeners = s.listeners.filter(function (f) { return f !== fn; }); };
  return s;
}
globalThis.AbortSignal = {
  timeout: function () { return makeSignal(); },
  any: function (list) { return list[0]; },
};
function abortSignal(s) { s.aborted = true; s.listeners.forEach(function (fn) { fn(); }); }

var F = { queue: [], calls: 0 };
function resp(status, body, headers) {
  return { ok: status >= 200 && status < 300, status: status,
    headers: { get: function (k) { return (headers || {})[k] || null; } },
    text: function () { return Promise.resolve(body || ''); } };
}
globalThis.fetch = function () {
  F.calls++;
  var next = F.queue.shift();
  if (!next) return Promise.reject(new Error('no more responses'));
  if (next.error) { var e = new Error(next.error); e.name = next.error; return Promise.reject(e); }
  return Promise.resolve(resp(next.status, next.body, next.headers));
};
"""

SCENARIOS = r"""
var fs = globalThis.filesender;
var checks = [];
function check(name, ok, detail) { checks.push((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' -- ' + JSON.stringify(detail))); }
var acc = { baseUrl: 'https://fs.example.org/rest.php', username: 'u', apikey: 'k' };
var R = {};
function run(key, account, opts) {
  fs.request(account, opts).then(function (v) { R[key] = { ok: v }; }, function (e) {
    R[key] = { err: e && (e.message || e.name), name: e && e.name, code: e && e.code, status: e && e.status }; });
}
function reset(queue) { F.queue = queue; F.calls = 0; T.timers = []; T.delays = []; }
var steps = [];
function step(fn) { steps.push(fn); }

step(function () { reset([{ status: 429, headers: { 'Retry-After': '2' } }, { status: 200, body: '{"a":1}' }]);
  run('a', acc, { method: 'get', path: '/x', data: {} }); });
step(function () { flushTimers(); });
step(function () { check('429 + Retry-After', R.a && R.a.ok && R.a.ok.a === 1 && T.delays[0] === 2000 && F.calls === 2, [R.a, T.delays]); });

step(function () { reset([{ status: 408 }, { status: 503 }, { status: 504 }, { status: 502 }]);
  run('b', acc, { method: 'get', path: '/x', data: {} }); });
step(function () { flushTimers(); });
step(function () { flushTimers(); });
step(function () { flushTimers(); });
step(function () { check('retries exhausted', R.b && R.b.status === 502 && F.calls === 4 &&
  JSON.stringify(T.delays) === '[2000,4000,6000]', [R.b, T.delays, F.calls]); });

step(function () { reset([{ status: 500, body: '{"message":"transfer_maximum_size_exceeded"}' }]);
  run('c', acc, { method: 'post', path: '/transfer', data: {}, content: {} }); });
step(function () { check('500 no retry', R.c && R.c.code === 'transfer_maximum_size_exceeded' && F.calls === 1 &&
  T.delays.length === 0, [R.c, F.calls]); });

step(function () { reset([{ status: 500, body: 'auth_remote_signature_check_failed' }]);
  run('d', acc, { method: 'get', path: '/x', data: {} }); });
step(function () { check('auth error no retry', R.d && F.calls === 1 && /HTTP 500/.test(R.d.err), R.d); });

step(function () { reset([{ error: 'TimeoutError' }, { status: 200, body: '"ok"' }]);
  run('e', acc, { method: 'put', path: '/file/1/chunk/0', data: {}, rawContent: new Uint8Array(3) }); });
step(function () { flushTimers(); });
step(function () { check('timeout then ok', R.e && R.e.ok === 'ok' && F.calls === 2, [R.e, F.calls]); });

step(function () { reset([{ error: 'TimeoutError' }, { error: 'TimeoutError' }]);
  run('f', acc, { method: 'get', path: '/x', data: {}, retries: 1 }); });
step(function () { flushTimers(); });
step(function () { check('timeout message', R.f && /timeout after 60s/.test(R.f.err), R.f); });

step(function () { var sig = makeSignal(); S_sig = sig; reset([{ status: 503 }, { status: 200, body: '{}' }]);
  run('g', Object.assign({}, acc, { signal: sig }), { method: 'get', path: '/x', data: {} }); });
step(function () { abortSignal(S_sig); });
step(function () { check('abort during backoff', R.g && R.g.name === 'AbortError' && F.calls === 1, [R.g, F.calls]); });

step(function () { reset([{ status: 429, headers: { 'Retry-After': '120' } }, { status: 200, body: '{}' }]);
  run('h', acc, { method: 'get', path: '/x', data: {} }); });
step(function () { flushTimers(); });
step(function () { check('Retry-After capped at 30s', T.delays[0] === 30000 && R.h && R.h.ok, [T.delays, R.h]); });
"""


def main():
    ctx = J.Context()

    def run(code, name):
        val = ctx.evaluate(code, len(code.encode("utf-8")))
        exc = ctx.get_exception()
        if exc:
            print("JS ERROR in", name, ":", exc.get_message())
            ctx.clear_exception()
            sys.exit(1)
        return val

    run(SHIMS, "shims")
    with open(
        os.path.join(ROOT, "src", "lib", "filesender.js"), encoding="utf-8"
    ) as fh:
        run(fh.read(), "src/lib/filesender.js")
    run("var S_sig = null;" + SCENARIOS, "scenarios")
    n = int(run("steps.length", "count").to_double())
    for i in range(n):
        for _ in range(30):
            run("0", "tick")
        run(f"steps[{i}]()", f"step {i}")
    for _ in range(30):
        run("0", "tick")
    out = run('checks.join("\\n")', "report").to_string()
    print(out)
    failed = out.count("FAIL ")
    total = out.count("PASS ") + failed
    print(
        "RESULT:",
        "ALL PASS" if failed == 0 else f"{failed} FAILED",
        f"({total} checks)",
    )
    sys.exit(1 if failed else 0)


main()
