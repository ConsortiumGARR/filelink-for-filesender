#!/usr/bin/env python3
# Runs src/background.js in JavaScriptCore with fake browser.* APIs and a fake
# FileSender client, and drives scenarios (reuse, notifications, options window,
# aborts, cleanup of unsent mails) without Thunderbird.
# Usage: python3 test/background_sim.py
import json
import os
import sys

import gi

gi.require_version("JavaScriptCore", "4.1")
from gi.repository import JavaScriptCore as J  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

HARNESS = r"""
var timers = [];
globalThis.setTimeout = function (fn) { timers.push(fn); return timers.length; };
globalThis.setInterval = function () { return 1; };
globalThis.clearInterval = function () {};
globalThis.console = { log: function () {}, warn: function () {} };
globalThis.TextEncoder = function () {};
TextEncoder.prototype.encode = function (s) { return s; };
globalThis.AbortController = function () {
  var self = this;
  this.signal = { aborted: false };
  this.abort = function () { self.signal.aborted = true; };
};
globalThis.crypto = { getRandomValues: function (a) {
  for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } };

var S = { notes: [], uploads: [], windows: 0, removed: [], pushes: 0, config: null, session: {},
  deleted: [], removedKeys: [], allAccounts: [], updateAccountCalls: [], startupListeners: [],
  link: null, results: {}, listeners: {}, msgListeners: [], removedListeners: [] };
var NOW = Math.round(Date.now() / 1000);

function ev(name) {
  return { addListener: function (fn) { S.listeners[name] = fn; } };
}
globalThis.browser = {
  storage: {
    local: { get: function (id) { var o = {}; o[id] = S.config; return Promise.resolve(o); },
      remove: function (id) { S.removedKeys.push(id); return Promise.resolve(); } },
    onChanged: { addListener: function () {} },
    session: { get: function (k) { var o = {}; if (k in S.session) o[k] = JSON.parse(S.session[k]); return Promise.resolve(o); },
      set: function (o) { for (var k in o) S.session[k] = JSON.stringify(o[k]); return Promise.resolve(); } },
  },
  onChangedStub: null,
  compose: { onBeforeSend: ev('beforeSend'), onAfterSend: ev('afterSend'), onAfterSave: ev('afterSave') },
  tabs: { onRemoved: ev('tabRemoved') },
  cloudFile: {
    onFileUpload: ev('upload'), onFileUploadAbort: ev('abort'),
    onFileDeleted: ev('fileDeleted'), onAccountDeleted: ev('accountDeleted'),
    getAllAccounts: function () { return Promise.resolve(S.allAccounts || []); },
    updateAccount: function (id, props) { S.updateAccountCalls.push({ id: id, props: props }); return Promise.resolve(); },
  },
  runtime: {
    onMessage: { addListener: function (fn) { S.msgListeners.push(fn); } },
    onStartup: { addListener: function (fn) { S.startupListeners.push(fn); } },
    sendMessage: function () { S.pushes++; return Promise.resolve(); },
    getPlatformInfo: function () { return Promise.resolve({}); },
  },
  windows: {
    create: function (o) { S.windows++; S.lastCreate = o;
      return Promise.resolve({ id: 100 + S.windows, left: o.left, top: o.top }); },
    get: function () { return Promise.resolve({ left: 100, top: 50, width: 1000, height: 800 }); },
    update: function () { return Promise.resolve({}); },
    remove: function (id) { S.removed.push(id); return Promise.resolve(); },
    onRemoved: { addListener: function (fn) { S.removedListeners.push(fn); } },
  },
  notifications: { create: function (o) { S.notes.push(o.message); return Promise.resolve('n'); } },
  i18n: {
    getMessage: function (k, subs) { return k + (subs && subs.length ? '|' + subs.join('|') : ''); },
    getUILanguage: function () { return 'en'; },
  },
};

globalThis.filesender = {
  isTrue: function (v) { return v === true || v === 1 || v === '1' || v === 'true'; },
  checkFileName: function (name) {
    if (name.indexOf('=') >= 0) return { code: 'name' };
    if (/\.exe$/.test(name)) return { code: 'extension', ext: 'exe' };
    return null;
  },
  getInstanceConfig: function () { return Promise.resolve({ defaultDays: 14, maxDays: 14,
    maxTransferSize: 1000000, encryption: { enabled: true, mandatory: false,
      minPasswordLength: 12, generatedPasswordLength: 30, keyVersion: 3,
      hashIterations: 1000, ivLength: 16, cryptName: 'AES-GCM', hashName: 'SHA-256',
      mixedCase: true, numbers: true, special: true } }); },
  request: function (acc, opts) {
    if (acc.apikey === 'bad') { var e = new Error('FileSender HTTP 500: auth_remote_signature_check_failed');
      e.auth = true; return Promise.reject(e); }
    return Promise.resolve({ id: 42, aup_ticked: '1',
      transfer_preferences: { email_download_complete: false, must_be_logged_in_to_download: 1, get_a_link: true } });
  },
  getLinkStatus: function () {
    if (S.link instanceof Error) return Promise.reject(S.link);
    return Promise.resolve(S.link);
  },
  uploadFile: function (acc, blob, file, opts) {
    S.uploads.push({ name: file.name, days: opts.days, options: opts.options,
      encrypted: !!opts.encryption });
    var applied = Object.assign({}, opts.options);
    if (S.dropOption) applied[S.dropOption] = false;
    return Promise.resolve({ url: 'https://fs/?s=download&token=new-' + file.name,
      expires: NOW + 14 * 86400, transfer: { options: applied }, transferId: 'T-' + file.name, puid: 'P-' + file.name });
  },
  deleteTransfer: function (acc, transfer) { S.deleted.push(transfer.id); return Promise.resolve({}); },
};

function baseConfig(extra) {
  return Object.assign({ baseUrl: 'https://fs.example.org/rest.php', username: 'u',
    email: 'u@example.org', apikey: 'k'.repeat(64), aup: true, askOptions: false,
    defaults: { days: 7, options: { email_me_on_expire: true } } }, extra || {});
}
function reset(cfg) {
  S.notes = []; S.uploads = []; S.windows = 0; S.removed = []; S.pushes = 0;
  S.config = cfg; S.link = null; S.results = {}; S.dropOption = null;
}
function file(id, name, size) {
  return { id: id, name: name, data: { size: size === undefined ? 10 : size } };
}
function start(key, f, related, tab) {
  S.listeners.upload({ id: 'acc1' }, f, tab || null, related).then(function (r) { S.results[key] = r; });
}
function msg(m) {
  var out = null;
  S.msgListeners.forEach(function (fn) { var r = fn(m); if (r && r.then) out = r; });
  return out;
}
"""

SCENARIOS = r"""
var checks = [];
function check(name, ok, detail) { checks.push((ok ? 'PASS ' : 'FAIL ') + name +
  (ok ? '' : ' -- ' + JSON.stringify(detail))); }

var steps = [];
function step(fn) { steps.push(fn); }

// 1. direct upload with the default options
step(function () { reset(baseConfig()); start('a', file(1, 'a.txt')); });
step(function () {
  check('direct upload', S.results.a && S.results.a.url && S.uploads.length === 1 &&
    S.uploads[0].days === 7 && S.windows === 0 && S.notes.length === 0, [S.results, S.uploads, S.notes]);
  check('expiry in templateInfo', S.results.a.templateInfo.download_expiry_date.timestamp > 0, S.results.a);
});

// 2. terms not accepted, empty file, file too large
step(function () { reset(baseConfig({ aup: false })); start('b', file(2, 'b.txt')); });
step(function () { check('aup required', S.results.b.error === 'errAupNotAccepted', S.results.b); });
step(function () { reset(baseConfig()); start('c', file(3, 'c.txt', 0)); });
step(function () { check('empty refused', S.results.c.error === 'errEmptyFile', S.results.c); });
step(function () { reset(baseConfig()); start('d', file(4, 'd.txt', 2000000)); });
step(function () { check('too large refused', S.results.d.error === 'errTooLarge' &&
  S.uploads.length === 0, S.results.d); });

// 3. reuse: valid for more than 24h
step(function () { reset(baseConfig()); S.link = { transferId: 9, expires: NOW + 5 * 86400, encrypted: false, size: 10 };
  start('e', file(5, 'e.txt'), { url: 'https://fs/?s=download&token=old', dataChanged: false }); });
step(function () { check('reuse long', S.results.e.url.indexOf('token=old') > 0 && S.uploads.length === 0 &&
  S.notes.length === 0, [S.results.e, S.notes]); });

// 4. reuse: less than 24h -> question; "upload again" -> upload, no notification
step(function () { reset(baseConfig()); S.link = { transferId: 9, expires: NOW + 3600, encrypted: false, size: 10 };
  start('f', file(6, 'f.txt'), { url: 'https://fs/?s=download&token=old', dataChanged: false }, { windowId: 3 }); });
step(function () {});
step(function () {
  check('short -> question window', S.windows === 1 && !S.results.f, [S.windows, S.results]);
  check('window centered on compose', S.lastCreate.left === 360 && S.lastCreate.top === 320, S.lastCreate);
  msg({ type: 'reuse-init', fileId: '6' }).then(function (r) { S.rinit = r; });
});
step(function () {
  check('question info', S.rinit && S.rinit.ok && S.rinit.info.name === 'f.txt' && S.rinit.info.when, S.rinit);
  msg({ type: 'reuse-answer', fileId: '6', answer: 'reupload' });
});
step(function () {});
step(function () { check('answer reupload', S.uploads.length === 1 && S.results.f.url.indexOf('token=new') > 0 &&
  S.notes.length === 0, [S.results.f, S.notes]); });

// 5. reuse: less than 24h -> question; "reuse" -> old link, no notification
step(function () { reset(baseConfig()); S.link = { transferId: 9, expires: NOW + 3600, encrypted: true, size: 10 };
  start('g', file(7, 'g.txt'), { url: 'https://fs/?s=download&token=old', dataChanged: false }); });
step(function () { msg({ type: 'reuse-answer', fileId: '7', answer: 'reuse' }); });
step(function () {});
step(function () { check('answer reuse', S.uploads.length === 0 && S.results.g.url.indexOf('token=old') > 0 &&
  S.results.g.templateInfo.download_password_protected === true && S.notes.length === 0, [S.results.g, S.notes]); });

// 5b. question window closed -> aborted
step(function () { reset(baseConfig()); S.link = { transferId: 9, expires: NOW + 3600, encrypted: false, size: 10 };
  start('g2', file(71, 'g2.txt'), { url: 'https://fs/?s=download&token=old', dataChanged: false }); });
step(function () { S.removedListeners.forEach(function (fn) { fn(101); }); });
step(function () { check('question closed -> aborted', S.results.g2 && S.results.g2.aborted && S.uploads.length === 0,
  S.results.g2); });

// 5c. reuse of a long-valid encrypted link -> question, no notification
step(function () { reset(baseConfig()); S.link = { transferId: 9, expires: NOW + 5 * 86400, encrypted: true, size: 10 };
  start('g3', file(72, 'g3.txt'), { url: 'https://fs/?s=download&token=old', dataChanged: false }); });
step(function () {
  check('long encrypted -> question', S.windows === 1 && !S.results.g3, [S.windows, S.results]);
  msg({ type: 'reuse-init', fileId: '72' }).then(function (r) { S.rinit = r; });
});
step(function () {
  check('question says valid+encrypted', S.rinit.info.short === false && S.rinit.info.encrypted === true, S.rinit);
  msg({ type: 'reuse-answer', fileId: '72', answer: 'reuse' });
});
step(function () {});
step(function () { check('long encrypted reuse', S.results.g3.url.indexOf('token=old') > 0 && S.notes.length === 0 &&
  S.uploads.length === 0, [S.results.g3, S.notes]); });

// 5d. name or extension not allowed -> error before any window
step(function () { reset(baseConfig({ askOptions: true })); start('x1', file(73, 'a=b.txt')); start('x2', file(74, 'v.exe')); });
step(function () { check('bad name/extension', S.results.x1.error === 'errFileName' &&
  S.results.x2.error === 'errFileExtension|exe' && S.windows === 0, [S.results, S.windows]); });

// 6. link no longer valid (server error) -> upload + notification
step(function () { reset(baseConfig()); S.link = new Error('transfer_not_found');
  start('h', file(8, 'h.txt'), { url: 'https://fs/?s=download&token=old', dataChanged: false }); });
step(function () { check('invalid -> reupload + note', S.uploads.length === 1 && S.notes.length === 1 &&
  S.notes[0].indexOf('ntfReuploadInvalid') === 0, S.notes); });

// 6b. file changed (size differs from the server) -> upload + notification
step(function () { reset(baseConfig()); S.link = { transferId: 9, expires: NOW + 5 * 86400, encrypted: false, size: 99 };
  start('h2', file(9, 'h2.txt'), { url: 'https://fs/?s=download&token=old', dataChanged: false }); });
step(function () { check('changed size -> reupload + note', S.uploads.length === 1 && S.notes.length === 1 &&
  S.notes[0].indexOf('ntfReuploadChanged') === 0, S.notes); });

// 6c. credential check from the account page
step(function () { reset(baseConfig());
  msg({ type: 'check-credentials', baseUrl: 'fs.example.org', username: 'u', apikey: 'good' })
    .then(function (r) { S.cc1 = r; });
  msg({ type: 'check-credentials', baseUrl: 'fs.example.org', username: 'u', apikey: 'bad' })
    .then(function (r) { S.cc2 = r; }); });
step(function () { check('credentials check', S.cc1 && S.cc1.ok === true &&
  S.cc1.options.email_download_complete === false && S.cc1.options.must_be_logged_in_to_download === true &&
  !('get_a_link' in S.cc1.options) && !('email_me_on_expire' in S.cc1.options) && S.cc2 && S.cc2.ok === false &&
  S.cc2.auth === true, [S.cc1, S.cc2]); });

// 6d. cleanup: mail closed without sending -> transfer deleted
step(function () { reset(baseConfig()); S.session = {}; S.deleted = [];
  start('p1', file(81, 'p1.txt'), undefined, { id: 5, windowId: 1 }); });
step(function () {});
step(function () { S.listeners.tabRemoved(5); });
step(function () {});
step(function () { check('unsent mail -> transfer deleted', JSON.stringify(S.deleted) === '["T-p1.txt"]', S.deleted); });

// 6e. mail sent -> kept (also when the tab closes before the send result)
step(function () { reset(baseConfig()); S.session = {}; S.deleted = [];
  start('p2', file(82, 'p2.txt'), undefined, { id: 6, windowId: 1 });
  start('p3', file(83, 'p3.txt'), undefined, { id: 7, windowId: 1 }); });
step(function () {});
step(function () { S.listeners.afterSend({ id: 6 }, { mode: 'sendNow' }); S.listeners.tabRemoved(6);
  S.listeners.beforeSend({ id: 7 }); });
step(function () { S.listeners.tabRemoved(7); });
step(function () { S.listeners.afterSend({ id: 7 }, { mode: 'sendNow' }); });
step(function () {});
step(function () { check('sent mails -> kept', S.deleted.length === 0, S.deleted); });

// 6f. send failed after the tab closed -> deleted; draft saved -> kept
step(function () { reset(baseConfig()); S.session = {}; S.deleted = [];
  start('p4', file(84, 'p4.txt'), undefined, { id: 8, windowId: 1 });
  start('p5', file(85, 'p5.txt'), undefined, { id: 9, windowId: 1 }); });
step(function () {});
step(function () { S.listeners.beforeSend({ id: 8 }); S.listeners.afterSave({ id: 9 }, { mode: 'draft' }); });
step(function () { S.listeners.tabRemoved(8); S.listeners.tabRemoved(9); });
step(function () { S.listeners.afterSend({ id: 8 }, { error: 'smtp down' }); });
step(function () {});
step(function () { check('failed send deleted, draft kept', JSON.stringify(S.deleted) === '["T-p4.txt"]', S.deleted); });

// 6g. attachment removed -> deleted
step(function () { reset(baseConfig()); S.session = {}; S.deleted = [];
  start('p6', file(86, 'p6.txt'), undefined, { id: 10, windowId: 1 }); });
step(function () {});
step(function () { S.listeners.fileDeleted({ id: 'acc1' }, 86); });
step(function () {});
step(function () { check('attachment removed -> deleted', JSON.stringify(S.deleted) === '["T-p6.txt"]', S.deleted); });

// 6h. link reused by another mail: deleted only when no mail uses it anymore
step(function () { reset(baseConfig()); S.session = {}; S.deleted = [];
  start('p7', file(87, 'p7.txt'), undefined, { id: 11, windowId: 1 }); });
step(function () {});
step(function () { S.link = { transferId: 'T-p7.txt', expires: NOW + 5 * 86400, encrypted: false, size: 10 };
  start('p8', file(88, 'p7.txt'), { url: 'https://fs/?s=download&token=new-p7.txt', dataChanged: false },
    { id: 12, windowId: 1 }); });
step(function () {});
step(function () { S.listeners.tabRemoved(11); });
step(function () {});
step(function () { check('still used by other mail -> kept', S.deleted.length === 0 && S.results.p8.url.indexOf('new-p7') > 0,
  [S.deleted, S.results.p8]); S.listeners.tabRemoved(12); });
step(function () {});
step(function () { check('last holder closed -> deleted', JSON.stringify(S.deleted) === '["T-p7.txt"]', S.deleted); });

// 6i. reused link not created in this session -> never deleted
step(function () { reset(baseConfig()); S.session = {}; S.deleted = [];
  S.link = { transferId: 'OLD', expires: NOW + 5 * 86400, encrypted: false, size: 10 };
  start('p9', file(89, 'old.txt'), { url: 'https://fs/?s=download&token=old', dataChanged: false }, { id: 13, windowId: 1 }); });
step(function () {});
step(function () { S.listeners.tabRemoved(13); });
step(function () {});
step(function () { check('old reused link never deleted', S.deleted.length === 0, S.deleted); });

// 6j. account removed -> settings deleted
step(function () { S.removedKeys = []; S.listeners.accountDeleted('acc9'); });
step(function () { check('account settings removed', JSON.stringify(S.removedKeys) === '["acc9"]', S.removedKeys); });

// 6k. logs: tokens, signatures, keys and emails are redacted
step(function () {
  var r = redact('POST https://fs/rest.php/transfer?key=PUID123&remote_user=https://idp!x!y=&signature=abcdef123456&timestamp=1 ' +
    'url https://fs/?s=download&token=bbdf3d2c-db97 from jane.roe@example.org');
  check('redact', r.indexOf('PUID123') < 0 && r.indexOf('idp!x') < 0 && r.indexOf('signature=abcd…') > 0 &&
    r.indexOf('token=bbdf…') > 0 && r.indexOf('3d2c') < 0 && r.indexOf('j…@example.org') > 0 &&
    r.indexOf('roe') < 0 && r.indexOf('timestamp=1') > 0, r);
});

// 7. options window: two files in one window, submit with a choice
step(function () { reset(baseConfig({ askOptions: true }));
  start('i1', file(10, 'i1.txt')); start('i2', file(11, 'i2.txt')); });
step(function () {
  check('one window for batch', S.windows === 1, S.windows);
  var init = msg({ type: 'options-init', accountId: 'acc1' });
  init.then(function (r) { S.init = r; });
});
step(function () {
  check('init has 2 files', S.init && S.init.ok && S.init.files.length === 2 && S.init.days === 7 &&
    S.init.maxDays === 14 && S.init.encryption.enabled === true, S.init);
  msg({ type: 'options-submit', accountId: 'acc1', choice: { days: 99,
    options: { email_download_complete: false, must_be_logged_in_to_download: true },
    password: 'Abcdefgh123!' } });
});
step(function () {});
step(function () {
  check('batch uploaded', S.uploads.length === 2 && S.uploads.every(function (u) {
    return u.days === 14 && u.encrypted && u.options.must_be_logged_in_to_download === true &&
      u.options.email_download_complete === false; }), S.uploads);
  check('encrypted flag', S.results.i1 && S.results.i1.templateInfo.download_password_protected === true, S.results.i1);
  check('window removed', S.removed.length === 1, S.removed);
});

// 8. window closed -> all files aborted
step(function () { reset(baseConfig({ askOptions: true }));
  start('j1', file(12, 'j1.txt')); start('j2', file(13, 'j2.txt')); });
step(function () { S.removedListeners.forEach(function (fn) { fn(101); }); });
step(function () { check('window closed -> aborted', S.results.j1 && S.results.j1.aborted &&
  S.results.j2 && S.results.j2.aborted && S.uploads.length === 0, S.results); });

// 9. one file aborted while the window is open
step(function () { reset(baseConfig({ askOptions: true }));
  start('k1', file(14, 'k1.txt')); start('k2', file(15, 'k2.txt')); });
step(function () { S.listeners.abort({ id: 'acc1' }, 14); });
step(function () {
  check('abort one -> aborted', S.results.k1 && S.results.k1.aborted && !S.results.k2, S.results);
  msg({ type: 'options-submit', accountId: 'acc1', choice: { days: 3, options: {} } });
});
step(function () {});
step(function () { check('other still uploads', S.results.k2 && S.results.k2.url && S.uploads.length === 1 &&
  S.uploads[0].days === 3, [S.results, S.uploads]); });

// 10. invalid password submitted -> error
step(function () { reset(baseConfig({ askOptions: true })); start('l', file(16, 'l.txt')); });
step(function () { msg({ type: 'options-submit', accountId: 'acc1', choice: { password: 'short' } }); });
step(function () {});
step(function () { check('bad password refused', S.results.l && S.results.l.error === 'errPasswordInvalid' &&
  S.uploads.length === 0, S.results.l); });

// 11. option ignored by the server -> notification
step(function () { reset(baseConfig()); S.dropOption = 'email_me_on_expire'; start('m', file(17, 'm.txt')); });
step(function () { check('ignored option note', S.notes.length === 1 &&
  S.notes[0].indexOf('ntfOptionsIgnored') === 0, S.notes); });

// 12. reupload through the options window: reason shown there, no notification
step(function () { reset(baseConfig({ askOptions: true })); S.link = new Error('gone');
  start('n', file(18, 'n.txt'), { url: 'https://fs/?s=download&token=old', dataChanged: false }); });
step(function () { msg({ type: 'options-init', accountId: 'acc1' }).then(function (r) { S.init = r; }); });
step(function () { check('reason in window', S.init.files[0].reason &&
  S.init.files[0].reason.indexOf('ntfReuploadInvalid') === 0 && S.notes.length === 0, [S.init, S.notes]);
  msg({ type: 'options-cancel', accountId: 'acc1' }); });
step(function () {});
step(function () { check('cancel -> aborted', S.results.n && S.results.n.aborted, S.results.n); });

// 13. startup: known accounts get "configured" and size limit re-asserted
step(function () { S.config = baseConfig(); S.allAccounts = [{ id: 'acc1' }]; S.updateAccountCalls = [];
  refreshAllAccounts(); });
step(function () {});
step(function () {
  check('startup re-asserts configured', S.updateAccountCalls.some(function (c) {
    return c.id === 'acc1' && c.props.configured === true; }), S.updateAccountCalls);
  check('startup applies size limit', S.updateAccountCalls.some(function (c) {
    return c.id === 'acc1' && c.props.uploadSizeLimit === 1000000; }), S.updateAccountCalls);
});

// 13b. startup: account with terms not accepted is left alone
step(function () { S.config = baseConfig({ aup: false }); S.allAccounts = [{ id: 'acc1' }]; S.updateAccountCalls = [];
  refreshAllAccounts(); });
step(function () {});
step(function () { check('startup skips account without accepted terms', S.updateAccountCalls.length === 0,
  S.updateAccountCalls); });

// 13c. an onStartup listener exists: it is what makes Thunderbird start the event page
// at app startup, so that the refresh above runs
step(function () { check('onStartup listener registered', S.startupListeners.length === 1,
  S.startupListeners.length); });

// 14. insecure http:// base url refused before any request is signed
step(function () { reset(baseConfig({ baseUrl: 'http://fs.example.org/rest.php' })); start('q1', file(90, 'q1.txt')); });
step(function () { check('insecure url refused', S.results.q1.error === 'errInsecureUrl' && S.uploads.length === 0,
  S.results.q1); });

// 14b. credential check over http:// refused before signing the request
step(function () { reset(baseConfig());
  msg({ type: 'check-credentials', baseUrl: 'http://fs.example.org', username: 'u', apikey: 'good' })
    .then(function (r) { S.cc3 = r; }); });
step(function () { check('insecure credential check refused', S.cc3 && S.cc3.ok === false &&
  S.cc3.error === 'errInsecureUrl', S.cc3); });
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

    run(HARNESS, "harness")
    with open(os.path.join(ROOT, "src", "manifest.json"), encoding="utf-8") as fh:
        scripts = json.load(fh)["background"]["scripts"]
    for f in ["src/" + s for s in scripts if s != "lib/filesender.js"]:
        with open(os.path.join(ROOT, f), encoding="utf-8") as fh:
            run(fh.read(), f)
    run(SCENARIOS, "scenarios")
    n = int(run("steps.length", "count").to_double())
    for i in range(n):
        for _ in range(20):  # let pending promises settle between steps
            run("0", "tick")
        run(f"steps[{i}]()", f"step {i}")
    for _ in range(20):
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
