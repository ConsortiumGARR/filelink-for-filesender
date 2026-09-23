'use strict';

// Settings, instance configuration and the cloudFile upload flow.

const fs = globalThis.filesender;
const fc = globalThis.fscrypto;
const acct = globalThis.fsAccount;

const activeUploads = new Map();

const t = (key, ...subs) => browser.i18n.getMessage(key, subs);

const OPTION_LABELS = {
  email_me_on_expire: 'optEmailMeOnExpire',
  email_upload_complete: 'optEmailUploadComplete',
  email_download_complete: 'optEmailDownloadComplete',
  email_report_on_closing: 'optEmailReportOnClosing',
  must_be_logged_in_to_download: 'optMustBeLoggedIn',
};
const REUSE_MIN_SECONDS = 86400;

async function loadConfig(accountId) {
  const data = await browser.storage.local.get(accountId);
  const c = data[accountId];
  if (!c || !c.baseUrl || !c.username || !c.apikey) return null;
  const d = c.defaults || {};
  return {
    baseUrl: acct.normalizeBaseUrl(c.baseUrl),
    username: String(c.username).trim(),
    from: String(c.email || '').trim(),
    apikey: String(c.apikey).trim(),
    aup: c.aup === true,
    askOptions: c.askOptions !== false,
    days: Number(d.days) || null,
    options: Object.assign({}, acct.DEFAULT_OPTIONS, d.options),
  };
}

const INSTANCE_TTL_MS = 3600 * 1000;
const instanceCache = new Map();

async function instanceConfig(baseUrl) {
  baseUrl = acct.normalizeBaseUrl(baseUrl);
  const hit = instanceCache.get(baseUrl);
  if (hit && Date.now() - hit.at < INSTANCE_TTL_MS) return hit.cfg;
  const cfg = await fs.getInstanceConfig({ baseUrl });
  instanceCache.set(baseUrl, { cfg, at: Date.now() });
  log(
    'instance config',
    baseUrl,
    'days',
    cfg.defaultDays + '/' + cfg.maxDays,
    'max size',
    cfg.maxTransferSize,
  );
  return cfg;
}

async function applySizeLimit(accountId, inst) {
  if (!inst || !inst.maxTransferSize) return;
  try {
    await browser.cloudFile.updateAccount(accountId, { uploadSizeLimit: inst.maxTransferSize });
  } catch (e) {
    warn('updateAccount failed', errText(e));
  }
}

function chooseDays(days, inst) {
  const max = (inst && inst.maxDays) || null;
  days = Number(days) || (inst && inst.defaultDays) || null;
  if (days && max && days > max) days = max;
  if (days && days < 1) days = 1;
  return days;
}

function encryptionInfo(inst) {
  const e = inst && inst.encryption;
  const supported = !!(
    e &&
    e.enabled &&
    e.cryptName === 'AES-GCM' &&
    e.hashName === 'SHA-256' &&
    e.keyVersion === 3 &&
    e.hashIterations &&
    e.ivLength > 4
  );
  return {
    enabled: supported,
    mandatory: !!(e && e.mandatory),
    rules: e
      ? {
          minPasswordLength: e.minPasswordLength || 0,
          generatedPasswordLength: e.generatedPasswordLength || 0,
          mixedCase: !!e.mixedCase,
          numbers: !!e.numbers,
          special: !!e.special,
        }
      : {},
  };
}

function formatWhen(expires) {
  return new Date(expires * 1000).toLocaleString(browser.i18n.getUILanguage(), {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function notify(message) {
  log('notify', message);
  browser.notifications
    .create({ type: 'basic', title: 'FileSender', message })
    .catch((e) => warn('notification failed', errText(e)));
}

let keepAliveTimer = null;
function updateKeepAlive() {
  const busy = activeUploads.size > 0 || batches.size > 0 || prompts.size > 0;
  if (busy && !keepAliveTimer) {
    keepAliveTimer = setInterval(() => {
      browser.runtime.getPlatformInfo().catch(() => {});
    }, 20000);
  } else if (!busy && keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function sanitizeChoice(raw, cfg, inst) {
  raw = raw || {};
  const options = {};
  for (const k of Object.keys(acct.DEFAULT_OPTIONS)) {
    options[k] = raw.options && k in raw.options ? !!raw.options[k] : !!cfg.options[k];
  }
  return {
    days: chooseDays(raw.days || cfg.days, inst),
    options,
    password: typeof raw.password === 'string' && raw.password ? raw.password : null,
  };
}

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg.type !== 'string') return false;
  if (msg.type === 'instance-config') {
    return instanceConfig(msg.baseUrl).then(
      (cfg) => ({ ok: true, cfg }),
      (e) => ({ ok: false, error: errText(e) }),
    );
  }
  if (msg.type === 'check-credentials') {
    const account = {
      baseUrl: acct.normalizeBaseUrl(msg.baseUrl),
      username: String(msg.username || '').trim(),
      apikey: String(msg.apikey || '').trim(),
    };
    if (acct.isInsecureUrl(account.baseUrl)) {
      return Promise.resolve({ ok: false, error: t('errInsecureUrl') });
    }
    return fs.request(account, { method: 'get', path: '/user/@me', data: {}, retries: 0 }).then(
      (user) => {
        log('credentials ok for', account.baseUrl, 'user id', user && user.id);
        const prefs = (user && user.transfer_preferences) || {};
        const options = {};
        for (const k of Object.keys(acct.DEFAULT_OPTIONS)) {
          if (k in prefs)
            options[k] = fs.isTrue(prefs[k]) || (typeof prefs[k] === 'number' && prefs[k] > 0);
        }
        return { ok: true, options };
      },
      (e) => {
        warn('credentials check failed', errText(e));
        return { ok: false, auth: !!(e && e.auth), error: errText(e) };
      },
    );
  }
  return false;
});

async function refreshAllAccounts() {
  const accounts = await browser.cloudFile.getAllAccounts();
  for (const a of accounts) {
    const cfg = await loadConfig(a.id);
    if (!cfg || !cfg.aup) continue;
    try {
      await browser.cloudFile.updateAccount(a.id, { configured: true });
    } catch (e) {
      warn('updateAccount failed', errText(e));
    }
    try {
      await applySizeLimit(a.id, await instanceConfig(cfg.baseUrl));
    } catch (e) {
      warn('instance config unavailable', cfg.baseUrl, errText(e));
    }
  }
}

refreshAllAccounts().catch((e) => warn('refresh accounts failed', errText(e)));

function uploadResult(cfg, url, expires, encrypted) {
  const ret = {
    url,
    templateInfo: {
      service_name: t('serviceName'),
      service_icon: 'icons/filesender-32.png',
      service_url: cfg.baseUrl.replace(/\/rest\.php$/i, ''),
    },
  };
  if (expires) ret.templateInfo.download_expiry_date = { timestamp: Number(expires) * 1000 };
  if (encrypted) ret.templateInfo.download_password_protected = true;
  return ret;
}

async function evaluateRelated(fsAccount, related, size) {
  if (related.dataChanged) return { action: 'upload', reason: 'changed' };
  let st = null;
  try {
    st = await fs.getLinkStatus(fsAccount, related.url);
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.auth)) throw e;
    warn('previous link not valid', errText(e));
  }
  const now = Math.round(Date.now() / 1000);
  const left = st && st.expires ? st.expires - now : 0;
  log(
    'previous link',
    st ? 'transfer ' + st.transferId : 'not found',
    'seconds left',
    left,
    'encrypted',
    !!(st && st.encrypted),
  );
  if (left <= 0) return { action: 'upload', reason: 'invalid' };
  if (st.size !== null && st.size !== size) return { action: 'upload', reason: 'changed' };
  if (left >= REUSE_MIN_SECONDS) return { action: 'reuse', st };
  return { action: 'ask', st };
}

function reasonText(ev, name) {
  if (!ev || !ev.reason) return null;
  if (ev.reason === 'changed') return t('ntfReuploadChanged', name);
  return t('ntfReuploadInvalid', name);
}

function ignoredOptions(requested, transfer) {
  const applied = (transfer && transfer.options) || {};
  return Object.keys(requested).filter((k) => fs.isTrue(applied[k]) !== !!requested[k]);
}

function errorResult(e) {
  if (e && e.auth) return { error: t('errAuth') };
  if (e && /maximum_size_exceeded/.test(e.code || '')) return { error: t('errTooLarge') };
  if (e && /file_name_invalid/.test(e.code || '')) return { error: t('errFileName') };
  if (e && /extension_not_allowed/.test(e.code || '')) return { error: t('errFileExtension', '') };
  if (e && /bad_email/.test(e.code || '')) return { error: t('errBadEmail') };
  return { error: t('errUpload', e && e.message ? e.message : String(e)) };
}

browser.cloudFile.onFileUpload.addListener(async (account, fileInfo, tab, related) => {
  log(
    'onFileUpload',
    fileInfo.name,
    fileInfo.data.size + 'B',
    'account',
    account.id,
    related ? 'related ' + related.url + ' dataChanged ' + related.dataChanged : '',
  );
  const cfg = await loadConfig(account.id);
  if (!cfg) {
    log('not configured');
    return { error: t('errNotConfigured') };
  }
  if (acct.isInsecureUrl(cfg.baseUrl)) {
    log('insecure base url', cfg.baseUrl);
    return { error: t('errInsecureUrl') };
  }
  log(
    'config ok',
    cfg.baseUrl,
    'remote_user',
    maskId(cfg.username),
    'from',
    cfg.from || '(account default)',
    'key',
    maskKey(cfg.apikey),
    'askOptions',
    cfg.askOptions,
  );
  if (!cfg.aup) {
    log('terms of use not accepted');
    return { error: t('errAupNotAccepted') };
  }
  if (fileInfo.data.size === 0) {
    log('empty file');
    return { error: t('errEmptyFile') };
  }
  let inst = null;
  try {
    inst = await instanceConfig(cfg.baseUrl);
    await applySizeLimit(account.id, inst);
  } catch (e) {
    warn('instance config unavailable', errText(e));
  }
  if (inst && inst.maxTransferSize && fileInfo.data.size > inst.maxTransferSize) {
    log('file too large', fileInfo.data.size, '>', inst.maxTransferSize);
    return { error: t('errTooLarge') };
  }
  const bad = fs.checkFileName(fileInfo.name, inst);
  if (bad) {
    log('file name not allowed by the instance', bad.code, bad.ext || '');
    return { error: bad.code === 'extension' ? t('errFileExtension', bad.ext) : t('errFileName') };
  }

  const controller = new AbortController();
  activeUploads.set(fileInfo.id, controller);
  updateKeepAlive();
  const fsAccount = {
    baseUrl: cfg.baseUrl,
    username: cfg.username,
    from: cfg.from,
    apikey: cfg.apikey,
    signal: controller.signal,
  };
  const name = fileInfo.name;

  try {
    let ev = null;
    if (related && related.url) {
      ev = await evaluateRelated(fsAccount, related, fileInfo.data.size);
      if (ev.action === 'ask' || (ev.action === 'reuse' && ev.st.encrypted)) {
        const answer = await askReuse(
          fileInfo.id,
          {
            name,
            when: formatWhen(ev.st.expires),
            encrypted: !!ev.st.encrypted,
            short: ev.action === 'ask',
          },
          tab,
        );
        if (!answer) {
          log('reuse question cancelled');
          return { aborted: true };
        }
        ev = answer === 'reuse' ? { action: 'reuse', st: ev.st } : { action: 'upload' };
      }
      if (ev.action === 'reuse') {
        log('reusing link', related.url);
        await trackHolder(related.url, fileInfo.id, tab);
        return uploadResult(cfg, related.url, ev.st.expires, ev.st.encrypted);
      }
    }
    const reason = reasonText(ev, name);
    const enc = encryptionInfo(inst);

    let choice;
    if (cfg.askOptions) {
      choice = await requestOptions(
        account.id,
        cfg,
        inst,
        { id: fileInfo.id, name, size: fileInfo.data.size, reason },
        tab,
      );
      if (!choice) {
        log('options cancelled');
        return { aborted: true };
      }
    } else {
      if (enc.mandatory) return { error: t('errEncryptionMandatory') };
      choice = sanitizeChoice(null, cfg, inst);
      if (reason) notify(reason);
    }
    if (controller.signal.aborted) return { aborted: true };

    let encryption = null;
    if (choice.password || enc.mandatory) {
      if (!enc.enabled) return { error: t('errEncryptionUnsupported') };
      if (!choice.password || fc.checkPassword(choice.password, enc.rules).length) {
        return { error: t('errPasswordInvalid') };
      }
      encryption = {
        password: choice.password,
        hashIterations: inst.encryption.hashIterations,
        ivLength: inst.encryption.ivLength,
        keyVersion: inst.encryption.keyVersion,
      };
    }

    log(
      'upload start',
      'days',
      choice.days,
      'options',
      JSON.stringify(choice.options),
      'encrypted',
      !!encryption,
    );
    const res = await fs.uploadFile(
      fsAccount,
      fileInfo.data,
      { name, size: fileInfo.data.size },
      {
        days: choice.days,
        aupChecked: cfg.aup,
        options: choice.options,
        encryption,
      },
    );
    if (!res || !res.url) {
      log('upload done but no download url');
      return { error: t('errNoUrl') };
    }
    const ignored = ignoredOptions(choice.options, res.transfer);
    if (ignored.length) {
      log('options not applied by the server', ignored.join(','));
      notify(t('ntfOptionsIgnored', name, ignored.map((k) => t(OPTION_LABELS[k])).join(', ')));
    }
    log('upload done, url:', res.url);
    await trackCreated(res.url, account.id, res.transferId, res.puid, fileInfo.id, tab);
    return uploadResult(cfg, res.url, res.expires, !!encryption);
  } catch (e) {
    if (e && e.name === 'AbortError') {
      log('upload aborted');
      return { aborted: true };
    }
    warn('upload error', errText(e), String((e && e.stack) || ''));
    return errorResult(e);
  } finally {
    activeUploads.delete(fileInfo.id);
    updateKeepAlive();
  }
});

browser.cloudFile.onFileUploadAbort.addListener(async (account, fileId) => {
  log('onFileUploadAbort', fileId);
  if (cancelPending(fileId)) log('removed from options window', fileId);
  if (answerReuse(fileId, null)) log('reuse question closed', fileId);
  const c = activeUploads.get(fileId);
  if (c) c.abort();
});
