'use strict';

// Transfers created for a mail are deleted when the mail is closed without being
// sent or saved, or when the attachment is removed. The state lives in
// storage.session: it survives event page suspension and is cleared when
// Thunderbird quits, like the cloudFile file ids it refers to.
const TRACK_KEY = 'tracked';
const sessionStore = browser.storage.session || null;
const memoryTrack = { transfers: {}, tabs: {} };
let trackQueue = Promise.resolve();

async function loadTrack() {
  if (!sessionStore) return memoryTrack;
  const d = await sessionStore.get(TRACK_KEY);
  return d[TRACK_KEY] || { transfers: {}, tabs: {} };
}

async function saveTrack(state) {
  if (sessionStore) await sessionStore.set({ [TRACK_KEY]: state });
}

function withTrack(fn) {
  trackQueue = trackQueue
    .then(async () => {
      const state = await loadTrack();
      const toDelete = [];
      await fn(state, toDelete);
      await saveTrack(state);
      return toDelete;
    })
    .then((list) => Promise.all(list.map(deleteTracked)))
    .catch((e) => warn('tracking failed', errText(e)));
  return trackQueue;
}

function tabIdOf(tab) {
  return tab && tab.id != null ? String(tab.id) : null;
}

function trackCreated(url, accountId, transferId, puid, fileId, tab) {
  if (!transferId || !puid) return Promise.resolve();
  return withTrack((state) => {
    state.transfers[url] = {
      accountId,
      transferId,
      puid,
      kept: false,
      holders: [{ fileId, tabId: tabIdOf(tab) }],
    };
  });
}

function trackHolder(url, fileId, tab) {
  return withTrack((state) => {
    const tr = state.transfers[url];
    if (tr && !tr.kept) tr.holders.push({ fileId, tabId: tabIdOf(tab) });
  });
}

function dropHolders(state, toDelete, match) {
  for (const [url, tr] of Object.entries(state.transfers)) {
    const before = tr.holders.length;
    tr.holders = tr.holders.filter((h) => !match(h));
    if (tr.holders.length === before) continue;
    if (!tr.holders.length) {
      delete state.transfers[url];
      if (!tr.kept) toDelete.push(Object.assign({ url }, tr));
    }
  }
}

function keepTab(state, tabId) {
  for (const [url, tr] of Object.entries(state.transfers)) {
    if (tr.holders.some((h) => h.tabId === tabId)) {
      log('transfer kept (mail sent or saved)', tr.transferId);
      delete state.transfers[url];
    }
  }
}

async function deleteTracked(tr) {
  const cfg = await loadConfig(tr.accountId);
  if (!cfg) return;
  log('deleting transfer of a mail not sent', tr.transferId);
  try {
    await fs.deleteTransfer(
      { baseUrl: cfg.baseUrl, username: cfg.username, apikey: cfg.apikey },
      { id: tr.transferId, files: [{ puid: tr.puid }] },
    );
  } catch (e) {
    warn('transfer delete failed', tr.transferId, errText(e));
  }
}

browser.cloudFile.onFileDeleted.addListener((account, fileId) => {
  log('onFileDeleted', fileId);
  return withTrack((state, toDelete) => dropHolders(state, toDelete, (h) => h.fileId === fileId));
});

browser.compose.onBeforeSend.addListener((tab) => {
  withTrack((state) => {
    state.tabs[String(tab.id)] = 'sending';
  });
});

browser.compose.onAfterSend.addListener((tab, info) => {
  const tabId = String(tab.id);
  withTrack((state, toDelete) => {
    const closed = state.tabs[tabId] === 'closed-while-sending';
    delete state.tabs[tabId];
    if (info && !info.error) keepTab(state, tabId);
    else if (closed) dropHolders(state, toDelete, (h) => h.tabId === tabId);
  });
});

browser.compose.onAfterSave.addListener((tab, info) => {
  if (info && !info.error) withTrack((state) => keepTab(state, String(tab.id)));
});

browser.tabs.onRemoved.addListener((tabId) => {
  const id = String(tabId);
  withTrack((state, toDelete) => {
    if (state.tabs[id] === 'sending') {
      state.tabs[id] = 'closed-while-sending';
      return;
    }
    dropHolders(state, toDelete, (h) => h.tabId === id);
  });
});

browser.cloudFile.onAccountDeleted.addListener((accountId) => {
  log('account deleted, removing its settings', accountId);
  browser.storage.local.remove(accountId).catch((e) => warn('settings removal failed', errText(e)));
});
