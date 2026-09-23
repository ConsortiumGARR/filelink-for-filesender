'use strict';

// Popup windows: the pre-upload options window (one per batch of files of the
// same account) and the per-file "reuse the link?" question.

const batches = new Map();
const prompts = new Map();

function batchFiles(b) {
  return [...b.items.values()].map((i) => ({
    id: i.id,
    name: i.name,
    size: i.size,
    reason: i.reason,
  }));
}

function pushBatch(b) {
  browser.runtime
    .sendMessage({ type: 'options-files', accountId: b.accountId, files: batchFiles(b) })
    .catch(() => {});
}

function closeBatch(b, choice) {
  if (batches.get(b.accountId) === b) batches.delete(b.accountId);
  for (const item of b.items.values()) item.resolve(choice);
  b.items.clear();
  if (b.winId != null) browser.windows.remove(b.winId).catch(() => {});
  updateKeepAlive();
}

async function openPopup(url, width, height, tab) {
  let area = null;
  try {
    if (tab && tab.windowId != null) area = await browser.windows.get(tab.windowId);
  } catch (e) {
    /* compose window gone: fall back to the screen */
  }
  if (!area || !area.width) {
    const s = globalThis.screen;
    area = s
      ? { left: s.availLeft || 0, top: s.availTop || 0, width: s.availWidth, height: s.availHeight }
      : null;
  }
  const pos =
    area && area.width
      ? {
          left: Math.max(0, Math.round(area.left + (area.width - width) / 2)),
          top: Math.max(0, Math.round(area.top + (area.height - height) / 2)),
        }
      : {};
  const win = await browser.windows.create(
    Object.assign({ url, type: 'popup', width, height }, pos),
  );
  if (pos.left !== undefined && (win.left !== pos.left || win.top !== pos.top)) {
    browser.windows.update(win.id, pos).catch(() => {});
  }
  return win;
}

function requestOptions(accountId, cfg, inst, item, tab) {
  let b = batches.get(accountId);
  if (!b) {
    b = { accountId, cfg, inst, items: new Map(), winId: null };
    batches.set(accountId, b);
    updateKeepAlive();
    openPopup('options/options.html?accountId=' + encodeURIComponent(accountId), 560, 560, tab)
      .then((win) => {
        b.winId = win.id;
        if (!batches.has(accountId) || batches.get(accountId) !== b)
          browser.windows.remove(win.id).catch(() => {});
      })
      .catch((e) => {
        warn('options window failed', errText(e));
        closeBatch(b, null);
      });
  }
  return new Promise((resolve) => {
    b.items.set(item.id, Object.assign({}, item, { resolve }));
    pushBatch(b);
  });
}

function cancelPending(fileId) {
  for (const b of batches.values()) {
    const item = b.items.get(fileId);
    if (!item) continue;
    b.items.delete(fileId);
    item.resolve(null);
    if (b.items.size === 0) closeBatch(b, null);
    else pushBatch(b);
    return true;
  }
  return false;
}

function askReuse(fileId, info, tab) {
  return new Promise((resolve) => {
    const p = { info, resolve, winId: null };
    prompts.set(fileId, p);
    updateKeepAlive();
    openPopup('reuse/reuse.html?fileId=' + encodeURIComponent(fileId), 480, 260, tab)
      .then((win) => {
        p.winId = win.id;
        if (prompts.get(fileId) !== p) browser.windows.remove(win.id).catch(() => {});
      })
      .catch((e) => {
        warn('reuse window failed', errText(e));
        answerReuse(fileId, null);
      });
  });
}

function answerReuse(fileId, answer) {
  const p = prompts.get(fileId);
  if (!p) return false;
  prompts.delete(fileId);
  if (p.winId != null) browser.windows.remove(p.winId).catch(() => {});
  p.resolve(answer);
  updateKeepAlive();
  return true;
}

browser.windows.onRemoved.addListener((winId) => {
  for (const [fileId, p] of prompts) {
    if (p.winId === winId) {
      p.winId = null;
      answerReuse(fileId, null);
    }
  }
  for (const b of batches.values()) {
    if (b.winId === winId) {
      b.winId = null;
      log('options window closed, cancelling', b.items.size, 'file(s)');
      closeBatch(b, null);
    }
  }
});

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg.type !== 'string') return false;
  if (msg.type === 'reuse-init') {
    const p = prompts.get(Number(msg.fileId));
    return Promise.resolve(p ? { ok: true, info: p.info } : { ok: false });
  }
  if (msg.type === 'reuse-answer') {
    const answer = msg.answer === 'reuse' || msg.answer === 'reupload' ? msg.answer : null;
    log('reuse answer', answer);
    answerReuse(Number(msg.fileId), answer);
    return Promise.resolve({ ok: true });
  }
  const b = batches.get(msg.accountId);
  if (msg.type === 'options-init') {
    if (!b) return Promise.resolve({ ok: false });
    return Promise.resolve({
      ok: true,
      files: batchFiles(b),
      days: chooseDays(b.cfg.days, b.inst),
      maxDays: (b.inst && b.inst.maxDays) || null,
      options: b.cfg.options,
      encryption: encryptionInfo(b.inst),
    });
  }
  if (msg.type === 'options-submit') {
    if (!b) return Promise.resolve({ ok: false });
    const choice = sanitizeChoice(msg.choice, b.cfg, b.inst);
    log(
      'options chosen for',
      b.items.size,
      'file(s)',
      'days',
      choice.days,
      'options',
      JSON.stringify(choice.options),
      'encrypted',
      !!choice.password,
    );
    closeBatch(b, choice);
    return Promise.resolve({ ok: true });
  }
  if (msg.type === 'options-cancel') {
    if (b) closeBatch(b, null);
    return Promise.resolve({ ok: true });
  }
  return false;
});
