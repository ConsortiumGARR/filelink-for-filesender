(function (global) {
  'use strict';

  const t = (key, ...subs) => browser.i18n.getMessage(key, subs);

  function localize() {
    document.documentElement.lang = browser.i18n.getUILanguage();
    for (const el of document.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.dataset.i18n);
    }
  }

  async function fitWindow() {
    if (!browser.windows) return;
    try {
      const win = await browser.windows.getCurrent();
      const chrome = window.outerHeight - window.innerHeight;
      const content = Math.ceil(document.body.getBoundingClientRect().height);
      const wanted = content + chrome + 2;
      const max = Math.max(300, (screen.availHeight || 900) - 40);
      const height = Math.min(wanted, max);
      if (Math.abs((win.height || 0) - height) > 2) {
        const top = Math.max(0, Math.round((win.top || 0) + ((win.height || height) - height) / 2));
        await browser.windows.update(win.id, { height, top });
      }
    } catch (e) {
      /* resizing is best effort */
    }
  }

  function dayChoices(max) {
    const out = [];
    for (let d = 1; d <= Math.min(7, max); d++) out.push(d);
    for (let d = 14; d < max; d += 7) out.push(d);
    if (!out.includes(max)) out.push(max);
    return out;
  }

  function fillDays(select, max, selected) {
    select.textContent = '';
    for (const d of dayChoices(max)) {
      const o = document.createElement('option');
      o.value = String(d);
      o.textContent = d === 1 ? t('mgmtDaysOne') : t('mgmtDaysValue', String(d));
      if (d === selected) o.selected = true;
      select.appendChild(o);
    }
  }

  function formatSize(n) {
    const units = ['B', 'kB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1000 && i < units.length - 1) {
      n /= 1000;
      i++;
    }
    return (i === 0 ? String(n) : n.toFixed(1)) + ' ' + units[i];
  }

  global.uiCommon = { t, localize, fitWindow, dayChoices, fillDays, formatSize };
})(globalThis);
