'use strict';

const accountId = new URL(location.href).searchParams.get('accountId');
const fc = globalThis.fscrypto;

const elFiles = document.getElementById('files');
const elDays = document.getElementById('days');
const elOptions = document.querySelectorAll('[data-option]');
const elEncSection = document.getElementById('encSection');
const elEncrypt = document.getElementById('encrypt');
const elPwBox = document.getElementById('pwBox');
const elPassword = document.getElementById('password');
const elShow = document.getElementById('show');
const elGenerate = document.getElementById('generate');
const elCopy = document.getElementById('copy');
const elPwRules = document.getElementById('pwRules');
const elPwErrors = document.getElementById('pwErrors');
const elUpload = document.getElementById('upload');
const elCancel = document.getElementById('cancel');

const FALLBACK_MAX_DAYS = 30;
const RULE_KEYS = {
  ascii: 'optRuleAscii',
  mixedCase: 'optRuleMixed',
  numbers: 'optRuleNumbers',
  special: 'optRuleSpecial',
};

const { t, fillDays, formatSize, fitWindow } = globalThis.uiCommon;
globalThis.uiCommon.localize();

let rules = {};
let fileCount = 0;

function renderFiles(files) {
  fileCount = files.length;
  elFiles.textContent = '';
  for (const f of files) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'fname';
    name.textContent = f.name;
    const size = document.createElement('span');
    size.className = 'fsize';
    size.textContent = formatSize(f.size);
    li.append(name, size);
    if (f.reason) {
      const r = document.createElement('span');
      r.className = 'reason';
      r.textContent = f.reason;
      li.appendChild(r);
    }
    elFiles.appendChild(li);
  }
  refresh();
}

function ruleText() {
  const parts = [];
  if (rules.minPasswordLength) parts.push(t('optRuleLength', String(rules.minPasswordLength)));
  if (rules.mixedCase) parts.push(t('optRuleMixed'));
  if (rules.numbers) parts.push(t('optRuleNumbers'));
  if (rules.special) parts.push(t('optRuleSpecial'));
  parts.push(t('optRuleAscii'));
  return t('optPwRules', parts.join(', '));
}

function passwordProblems() {
  if (!elEncrypt.checked) return [];
  return fc.checkPassword(elPassword.value, rules);
}

function refresh() {
  elPwBox.hidden = !elEncrypt.checked;
  const problems = passwordProblems();
  elPwErrors.textContent =
    elEncrypt.checked && elPassword.value && problems.length
      ? t(
          'optPwMissing',
          problems
            .map((p) =>
              p === 'length'
                ? t('optRuleLength', String(rules.minPasswordLength))
                : t(RULE_KEYS[p]),
            )
            .join(', '),
        )
      : '';
  elUpload.disabled = fileCount === 0 || (elEncrypt.checked && problems.length > 0);
  fitWindow();
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'options-files' && msg.accountId === accountId) renderFiles(msg.files);
  return false;
});

elEncrypt.addEventListener('change', refresh);
elPassword.addEventListener('input', refresh);
elShow.addEventListener('click', () => {
  elPassword.type = elPassword.type === 'password' ? 'text' : 'password';
});
elGenerate.addEventListener('click', () => {
  elPassword.value = fc.generatePassword(rules);
  elPassword.type = 'text';
  refresh();
});
elCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(elPassword.value);
    elCopy.textContent = t('optCopied');
  } catch (e) {
    elPassword.type = 'text';
    elPassword.select();
  }
});

elCancel.addEventListener('click', () => {
  browser.runtime.sendMessage({ type: 'options-cancel', accountId }).finally(() => window.close());
});

elUpload.addEventListener('click', () => {
  const options = {};
  for (const el of elOptions) options[el.dataset.option] = el.checked;
  const choice = {
    days: Number(elDays.value) || null,
    options,
    password: elEncrypt.checked ? elPassword.value : null,
  };
  elUpload.disabled = true;
  browser.runtime
    .sendMessage({ type: 'options-submit', accountId, choice })
    .finally(() => window.close());
});

browser.runtime.sendMessage({ type: 'options-init', accountId }).then((init) => {
  if (!init || !init.ok) {
    window.close();
    return;
  }
  const max = init.maxDays || FALLBACK_MAX_DAYS;
  fillDays(elDays, max, Math.min(init.days || max, max));
  for (const el of elOptions) el.checked = !!init.options[el.dataset.option];
  rules = init.encryption.rules || {};
  if (init.encryption.enabled) {
    elEncSection.hidden = false;
    elPwRules.textContent = ruleText();
    if (init.encryption.mandatory) {
      elEncrypt.checked = true;
      elEncrypt.disabled = true;
    }
  }
  renderFiles(init.files);
});
