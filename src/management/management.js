'use strict';

const params = new URL(location.href).searchParams;
const accountId = params.get('accountId');

const elBase = document.getElementById('baseUrl');
const elUser = document.getElementById('username');
const elEmail = document.getElementById('email');
const elKey = document.getElementById('apikey');
const elAup = document.getElementById('aup');
const elSiteLink = document.getElementById('siteLink');
const elDays = document.getElementById('days');
const elAskOptions = document.getElementById('askOptions');
const elDebug = document.getElementById('debug');
const elDaysHint = document.getElementById('daysHint');
const elOptions = document.querySelectorAll('[data-option]');
const elForm = document.getElementById('form');
const elTest = document.getElementById('test');
const elTestStatus = document.getElementById('testStatus');
const elStatus = document.getElementById('status');

const FALLBACK_MAX_DAYS = 30;

const { DEFAULT_OPTIONS, normalizeBaseUrl, isInsecureUrl } = globalThis.fsAccount;
const { t } = globalThis.uiCommon;
globalThis.uiCommon.localize();

const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;

function setStatus(msg, kind) {
  elStatus.textContent = msg;
  elStatus.className = kind || '';
}

function setTestStatus(msg, kind) {
  elTestStatus.textContent = msg;
  elTestStatus.className = kind || '';
}

let wantedDays = null;
let hasSavedDefaults = false;

function fillDays(max, def) {
  globalThis.uiCommon.fillDays(elDays, max, Math.min(wantedDays || def || max, max));
}

async function loadInstance() {
  const raw = elBase.value.trim();
  if (!raw) {
    fillDays(FALLBACK_MAX_DAYS, null);
    elDaysHint.textContent = '';
    elSiteLink.textContent = '';
    return;
  }
  const baseUrl = normalizeBaseUrl(raw);
  const site = baseUrl.replace(/\/rest\.php$/i, '/');
  elSiteLink.href = site;
  elSiteLink.textContent = site;
  let res = null;
  try {
    res = await browser.runtime.sendMessage({ type: 'instance-config', baseUrl });
  } catch (e) {
    res = null;
  }
  if (res && res.ok && res.cfg.maxDays) {
    fillDays(res.cfg.maxDays, res.cfg.defaultDays);
    elDaysHint.textContent = t('mgmtDaysHint', String(res.cfg.maxDays));
  } else {
    fillDays(FALLBACK_MAX_DAYS, null);
    elDaysHint.textContent = t('mgmtInstanceUnavailable');
  }
}

if (!accountId) {
  setStatus(t('mgmtInvalidAccount'), 'err');
} else {
  browser.storage.local.get('debug').then((d) => {
    elDebug.checked = d.debug === true;
  });
  browser.storage.local.get(accountId).then((d) => {
    const c = d[accountId] || {};
    const defs = c.defaults || {};
    const opts = Object.assign({}, DEFAULT_OPTIONS, defs.options);
    elBase.value = c.baseUrl || '';
    elUser.value = c.username || '';
    elEmail.value = c.email || '';
    elKey.value = c.apikey || '';
    elAup.checked = c.aup === true;
    elAskOptions.checked = c.askOptions !== false;
    for (const el of elOptions) el.checked = !!opts[el.dataset.option];
    wantedDays = Number(defs.days) || null;
    hasSavedDefaults = !!c.defaults;
    return loadInstance();
  });

  elBase.addEventListener('change', () => loadInstance());
  elDays.addEventListener('change', () => {
    wantedDays = Number(elDays.value) || null;
  });

  elTest.addEventListener('click', async () => {
    if (!elBase.value.trim() || !elUser.value.trim() || !elKey.value.trim()) {
      setTestStatus(t('mgmtRequired'), 'err');
      return;
    }
    if (isInsecureUrl(normalizeBaseUrl(elBase.value))) {
      setTestStatus(t('mgmtInsecureUrl'), 'err');
      return;
    }
    elTest.disabled = true;
    setTestStatus(t('mgmtChecking'), '');
    let res = null;
    try {
      res = await browser.runtime.sendMessage({
        type: 'check-credentials',
        baseUrl: normalizeBaseUrl(elBase.value),
        username: elUser.value.trim(),
        apikey: elKey.value.trim(),
      });
    } catch (e) {
      res = { ok: false, error: e && e.message ? e.message : String(e) };
    }
    elTest.disabled = false;
    if (res && res.ok) {
      const fill = !hasSavedDefaults && res.options && Object.keys(res.options).length > 0;
      if (fill) {
        for (const el of elOptions) {
          if (el.dataset.option in res.options) el.checked = !!res.options[el.dataset.option];
        }
      }
      setTestStatus(t(fill ? 'mgmtTestOkFilled' : 'mgmtTestOk'), 'ok');
    } else if (res && res.auth) {
      setTestStatus(t('mgmtCredentialsInvalid'), 'err');
    } else {
      setTestStatus(t('mgmtTestFailed', (res && res.error) || '?'), 'err');
    }
  });

  elForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const baseUrl = normalizeBaseUrl(elBase.value);
    const username = elUser.value.trim();
    const email = elEmail.value.trim();
    const apikey = elKey.value.trim();
    if (!elBase.value.trim() || !username || !apikey) {
      setStatus(t('mgmtRequired'), 'err');
      return;
    }
    if (isInsecureUrl(baseUrl)) {
      setStatus(t('mgmtInsecureUrl'), 'err');
      return;
    }
    if (email && !EMAIL_RE.test(email)) {
      setStatus(t('mgmtInvalidEmail'), 'err');
      return;
    }
    if (!elAup.checked) {
      setStatus(t('mgmtAupRequired'), 'err');
      return;
    }
    const options = {};
    for (const el of elOptions) options[el.dataset.option] = el.checked;
    const defaults = { days: Number(elDays.value) || null, options };
    const askOptions = elAskOptions.checked;
    try {
      await browser.storage.local.set({
        [accountId]: { baseUrl, username, email, apikey, aup: true, askOptions, defaults },
        debug: elDebug.checked,
      });
      await browser.cloudFile.updateAccount(accountId, { configured: true });
      hasSavedDefaults = true;
      setStatus(t('mgmtSaved'), 'ok');
    } catch (e) {
      setStatus(t('mgmtError', e && e.message ? e.message : String(e)), 'err');
    }
  });
}
