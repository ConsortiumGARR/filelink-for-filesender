'use strict';

// Logging: detailed logs only in debug mode, errors always; every argument is
// redacted so logs can be shared.

const LOG_PREFIX = '[FileSender]';
let debugEnabled = false;

function redact(v) {
  let text =
    typeof v === 'string' ? v : v instanceof Error ? String(v.stack || v) : JSON.stringify(v);
  if (typeof text !== 'string') text = String(v);
  return text
    .replace(/([?&](?:token|signature)=)([^&\s"']{4})[^&\s"']*/g, '$1$2…')
    .replace(/([?&](?:key|roundtriptoken|remote_user)=)[^&\s"']+/g, '$1…')
    .replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g, '$1…@$2');
}

function log(...args) {
  if (debugEnabled) console.log(LOG_PREFIX, ...args.map(redact));
}

function warn(...args) {
  console.warn(LOG_PREFIX, ...args.map(redact));
}

function maskId(u) {
  u = String(u);
  return u.length > 16 ? u.slice(0, 12) + '…' + u.slice(-4) : u;
}

browser.storage.local
  .get('debug')
  .then((d) => {
    debugEnabled = d.debug === true;
  })
  .catch(() => {});
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.debug) debugEnabled = changes.debug.newValue === true;
});
function maskKey(k) {
  k = String(k);
  return k.length > 8 ? k.slice(0, 4) + '…' + k.slice(-2) + ' (' + k.length + ')' : '****';
}
function errText(e) {
  return String((e && e.message) || e);
}
