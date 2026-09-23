#!/usr/bin/env python3
# Runs the signing differential test in JavaScriptCore (driven from Python
# via python3-gi), no Node needed. Shims the Web APIs a bare JSC context lacks
# (btoa/atob/TextEncoder) with standard implementations, validates them against
# RFC 2202 / known-answer vectors, then checks src/lib/filesender.js against the
# ground-truth vectors in test/vectors.json.
#
# Verifies synchronously (buildSigned + __Shims.hmac + pyQuote/flatten), which
# covers the entire signing chain; the thin async crypto.subtle glue
# (hmacSha1Hex) is exercised by test/sign-test.html in a real browser/Thunderbird.
# Run: python3 test/jsc_run.py
import json
import os
import sys

import gi

gi.require_version("JavaScriptCore", "4.1")
from gi.repository import JavaScriptCore as J  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

SHIM_JS = r"""
(function () {
  try {
    var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    function btoa(s) {
      var o = '';
      for (var i = 0; i < s.length;) {
        var c1 = s.charCodeAt(i++);
        var h2 = i < s.length;
        var c2 = h2 ? s.charCodeAt(i++) : 0;
        var h3 = i < s.length;
        var c3 = h3 ? s.charCodeAt(i++) : 0;
        o += B64[c1 >> 2] + B64[((c1 & 3) << 4) | (c2 >> 4)] +
          (h2 ? B64[((c2 & 15) << 2) | (c3 >> 6)] : '=') +
          (h3 ? B64[c3 & 63] : '=');
      }
      return o;
    }
    function atob(s) {
      s = s.replace(/=+$/, '');
      var o = '';
      for (var i = 0; i < s.length; i += 4) {
        var e1 = B64.indexOf(s[i]);
        var e2 = B64.indexOf(s[i + 1]);
        var e3 = (s[i + 2] === '=' || s[i + 2] === undefined) ? -1 : B64.indexOf(s[i + 2]);
        var e4 = (s[i + 3] === '=' || s[i + 3] === undefined) ? -1 : B64.indexOf(s[i + 3]);
        o += String.fromCharCode((e1 << 2) | (e2 >> 4));
        if (e3 !== -1) o += String.fromCharCode(((e2 & 15) << 4) | ((e3 & 63) >> 2));
        if (e4 !== -1) o += String.fromCharCode(((e3 & 3) << 6) | (e4 & 63));
      }
      return o;
    }
    function utf8(str) {
      var o = [];
      for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        if (c < 0x80) { o.push(c); }
        else if (c < 0x800) { o.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
        else if (c >= 0xD800 && c < 0xE000) {
          var c2 = str.charCodeAt(++i);
          var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
          o.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        } else { o.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
      }
      return new Uint8Array(o);
    }
    function sha1(bytes) {
      var ml = bytes.length;
      var totalLen = ((ml + 9 + 63) >> 6) << 6;
      var m = new Uint8Array(totalLen);
      m.set(bytes, 0);
      m[ml] = 0x80;
      var bl = ml * 8;
      m[totalLen - 4] = (bl >>> 24) & 0xff;
      m[totalLen - 3] = (bl >>> 16) & 0xff;
      m[totalLen - 2] = (bl >>> 8) & 0xff;
      m[totalLen - 1] = bl & 0xff;
      var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
      var w = new Array(80);
      for (var i = 0; i < totalLen; i += 64) {
        for (var t = 0; t < 16; t++) {
          w[t] = ((m[i + 4 * t] << 24) | (m[i + 4 * t + 1] << 16) | (m[i + 4 * t + 2] << 8) | m[i + 4 * t + 3]) >>> 0;
        }
        for (var t = 16; t < 80; t++) {
          var x = (w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]);
          w[t] = ((x << 1) | (x >>> 31)) >>> 0;
        }
        var a = h0, b = h1, c = h2, d = h3, e = h4;
        for (var t = 0; t < 80; t++) {
          var f, k;
          if (t < 20) { f = (b & c) | ((~b) & d); k = 0x5A827999; }
          else if (t < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
          else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
          else { f = b ^ c ^ d; k = 0xCA62C1D6; }
          var tmp = ((((a << 5) | (a >>> 27)) >>> 0) + f + e + k + w[t]) >>> 0;
          e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = tmp;
        }
        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
      }
      var out = new Uint8Array(20);
      function wr(n, v) { out[n] = (v >>> 24) & 0xff; out[n + 1] = (v >>> 16) & 0xff; out[n + 2] = (v >>> 8) & 0xff; out[n + 3] = v & 0xff; }
      wr(0, h0); wr(4, h1); wr(8, h2); wr(12, h3); wr(16, h4);
      return out;
    }
    function hmac(keyBytes, msgBytes) {
      var B = 64;
      var key = (keyBytes.length > B) ? sha1(keyBytes) : new Uint8Array(keyBytes);
      var op = new Uint8Array(B), ip = new Uint8Array(B);
      for (var i = 0; i < B; i++) { op[i] = 0x5c ^ key[i]; ip[i] = 0x36 ^ key[i]; }
      var inner = new Uint8Array(B + msgBytes.length);
      inner.set(ip, 0); inner.set(msgBytes, B);
      var ih = sha1(inner);
      var outer = new Uint8Array(B + 20);
      outer.set(op, 0); outer.set(ih, B);
      return sha1(outer);
    }
    function hex(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) { var h = bytes[i].toString(16); if (h.length < 2) h = '0' + h; s += h; } return s; }
    globalThis.btoa = btoa;
    globalThis.atob = atob;
    globalThis.TextEncoder = function () { this.encode = utf8; };
    globalThis.__Shims = { btoa: btoa, atob: atob, utf8: utf8, sha1: sha1, hmac: hmac, hex: hex };
    return JSON.stringify({ ok: true });
  } catch (e) {
    return JSON.stringify({ ok: false, err: String(e && e.stack || e) });
  }
})();
"""

TEST_JS = r"""
(function () {
  try {
    var V = globalThis.__VECTORS__;
    var FS = globalThis.filesender;
    var S = globalThis.__Shims;
    var report = { kat: [], cases: [], pass: 0, fail: 0 };
    function kat(name, got, exp) { report.kat.push({ name: name, ok: got === exp, got: got, exp: exp }); }

    kat('hmac-rfc2202-t1', S.hex(S.hmac(S.utf8('Jefe'), S.utf8('what do ya want for nothing?'))), 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79');
    var k2 = new Uint8Array(20); for (var i = 0; i < 20; i++) k2[i] = 0x0b;
    kat('hmac-rfc2202-t2', S.hex(S.hmac(k2, S.utf8('Hi There'))), 'b617318655057264e28bc0b6fb378c8ef146be00');
    kat('btoa-hello', S.btoa('hello'), 'aGVsbG8=');
    kat('btoa-a', S.btoa('a'), 'YQ==');
    kat('atob-roundtrip', S.atob(S.btoa('hello world!')), 'hello world!');
    kat('utf8-acute-e', Array.from(S.utf8('\u00e8')).join(','), '195,168');
    kat('utf8-emoji', Array.from(S.utf8('\ud83d\ude00')).join(','), '240,159,152,128');
    var katOk = report.kat.every(function (x) { return x.ok; });
    report.katOk = katOk;

    for (var ci = 0; ci < V.cases.length; ci++) {
      var c = V.cases[ci];
      var opts = {
        method: c.method, baseUrl: V.baseUrl, path: c.path, data: c.data,
        username: V.username, apikey: V.apikey, timestamp: V.timestamp
      };
      if (c.content !== null && c.content !== undefined) opts.content = c.content;
      if (c.rawContent !== null) opts.rawContent = FS.b64ToBytes(c.rawContent);
      var checks = [];
      try {
        var b = FS.buildSigned(opts);
        checks.push({ label: 'preimage', ok: FS.bytesToB64(b.preimage) === c.expectedSignedB64, got: FS.bytesToB64(b.preimage), exp: c.expectedSignedB64 });
        var sig = S.hex(S.hmac(S.utf8(V.apikey), b.preimage));
        checks.push({ label: 'signature', ok: sig === c.expectedSignature, got: sig, exp: c.expectedSignature });
        var urlData = {};
        for (var kk in b.signData) urlData[kk] = b.signData[kk];
        urlData.signature = sig;
        var q = FS.flatten(urlData).map(function (item) {
          var idx = item.indexOf('=');
          return FS.pyQuote(item.slice(0, idx)) + '=' + FS.pyQuote(item.slice(idx + 1));
        }).join('&');
        checks.push({ label: 'url', ok: (V.baseUrl + c.path + '?' + q) === c.expectedUrl, got: V.baseUrl + c.path + '?' + q, exp: c.expectedUrl });
      } catch (e) {
        checks.push({ label: 'error', ok: false, got: String(e && e.stack || e), exp: '' });
      }
      var ok = checks.every(function (x) { return x.ok; });
      if (ok) report.pass++; else report.fail++;
      report.cases.push({ name: c.name, ok: ok, checks: checks });
    }
    report.allOk = report.fail === 0 && katOk;
    return JSON.stringify(report);
  } catch (e) {
    return JSON.stringify({ fatal: String(e && e.stack || e) });
  }
})();
"""


def main():
    ctx = J.Context()

    def ev(code):
        val = ctx.evaluate(code, len(code.encode("utf-8")))
        exc = ctx.get_exception()
        if exc is not None:
            raise RuntimeError("JS exception: " + (exc.get_message() or "?"))
        return val.to_string()

    # 1. shims
    shim = json.loads(ev(SHIM_JS))
    if not shim.get("ok"):
        print("SHIM INSTALL FAILED:", shim.get("err"))
        return 2

    # 2. vectors
    with open(os.path.join(HERE, "vectors.json"), encoding="utf-8") as f:
        vectors_json = f.read()
    ev("globalThis.__VECTORS__ = " + vectors_json + "; 1;")

    # 3. library
    with open(
        os.path.join(HERE, "..", "src", "lib", "filesender.js"), encoding="utf-8"
    ) as f:
        lib = f.read()
    ev(lib)
    if ev("typeof globalThis.filesender") != "object":
        print("LIB FAILED TO LOAD (globalThis.filesender missing)")
        return 2

    # 4. differential test
    report = json.loads(ev(TEST_JS))
    if "fatal" in report:
        print("FATAL:", report["fatal"])
        return 2

    print("--- shim known-answer tests ---")
    for k in report["kat"]:
        print(
            ("  OK " if k["ok"] else "  BAD")
            + " "
            + k["name"]
            + (
                ""
                if k["ok"]
                else "\n        got: " + k["got"] + "\n        exp: " + k["exp"]
            )
        )

    print("--- differential (vs filesender.py vectors) ---")
    for c in report["cases"]:
        print(("  PASS" if c["ok"] else "  FAIL") + "  " + c["name"])
        for ch in c["checks"]:
            if not ch["ok"]:
                print(
                    "        "
                    + ch["label"]
                    + "\n          got: "
                    + ch["got"]
                    + "\n          exp: "
                    + ch["exp"]
                )

    total = report["pass"] + report["fail"]
    kat_bad = sum(1 for k in report["kat"] if not k["ok"])
    print("---")
    print(f"shim KAT: {len(report['kat']) - kat_bad}/{len(report['kat'])} passed")
    print(f"differential: {report['pass']}/{total} passed")
    ok = report["allOk"]
    print("RESULT: " + ("ALL PASS" if ok else "FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
