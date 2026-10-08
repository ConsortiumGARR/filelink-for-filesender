(function (global) {
  'use strict';

  const DEFAULT_OPTIONS = {
    email_me_on_expire: true,
    email_upload_complete: false,
    email_download_complete: true,
    email_report_on_closing: true,
    must_be_logged_in_to_download: false,
  };

  function normalizeBaseUrl(u) {
    u = (u || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    // The signature covers the base URL without its scheme, removed in lower case.
    u = u.replace(/^https?:/i, (s) => s.toLowerCase());
    if (!/\/rest\.php$/i.test(u)) u += '/rest.php';
    return u;
  }

  function isInsecureUrl(baseUrl) {
    return /^http:\/\//i.test(String(baseUrl || '').trim());
  }

  // FileSender builds every download link as site_url + '?s=download&token=...', and
  // in a standard installation site_url is the base URL without rest.php.
  function siteUrlOf(baseUrl) {
    return normalizeBaseUrl(baseUrl).replace(/rest\.php$/i, '');
  }

  function sameSite(url, siteUrl) {
    try {
      const a = new URL(url);
      const b = new URL(siteUrl);
      return a.origin === b.origin && a.pathname === b.pathname;
    } catch (e) {
      return false;
    }
  }

  global.fsAccount = { DEFAULT_OPTIONS, normalizeBaseUrl, isInsecureUrl, siteUrlOf, sameSite };
})(typeof globalThis !== 'undefined' ? globalThis : this);
