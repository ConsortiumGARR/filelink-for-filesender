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
    if (!/\/rest\.php$/i.test(u)) u += '/rest.php';
    return u;
  }

  function isInsecureUrl(baseUrl) {
    return /^http:\/\//i.test(String(baseUrl || '').trim());
  }

  global.fsAccount = { DEFAULT_OPTIONS, normalizeBaseUrl, isInsecureUrl };
})(typeof globalThis !== 'undefined' ? globalThis : this);
