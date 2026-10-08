'use strict';

const params = new URL(location.href).searchParams;
const accountId = params.get('accountId');
const fileId = params.get('fileId');
const t = globalThis.uiCommon.t;
globalThis.uiCommon.localize();

function answer(value) {
  browser.runtime
    .sendMessage({ type: 'reuse-answer', accountId, fileId, answer: value })
    .finally(() => window.close());
}

document.getElementById('cancel').addEventListener('click', () => answer(null));
document.getElementById('reuse').addEventListener('click', () => answer('reuse'));
document.getElementById('reupload').addEventListener('click', () => answer('reupload'));

browser.runtime.sendMessage({ type: 'reuse-init', accountId, fileId }).then((init) => {
  if (!init || !init.ok) {
    window.close();
    return;
  }
  document.getElementById('name').textContent = init.info.name;
  document.getElementById('text').textContent = t(
    init.info.short ? 'reuseText' : 'reuseTextValid',
    init.info.when,
  );
  document.getElementById('encrypted').hidden = !init.info.encrypted;
  globalThis.uiCommon.fitWindow();
});
