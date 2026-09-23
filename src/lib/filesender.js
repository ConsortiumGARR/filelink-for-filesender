(function (global) {
  'use strict';

  const te = new TextEncoder();

  function flatten(data) {
    const items = [];
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (v === null || v === undefined) continue;
      items.push(k + '=' + v);
    }
    items.sort();
    return items;
  }

  function compactJson(obj) {
    let s = JSON.stringify(obj);
    if (s === undefined) return '';
    s = s.replace(
      /[^\u0000-\u007f]/g,
      (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
    );
    return s;
  }

  function bytesToB64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function pyQuote(s) {
    const keep = /^[A-Za-z0-9_.~\-\/]$/;
    let out = '';
    const bytes = te.encode(s);
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b < 0x80 && keep.test(String.fromCharCode(b))) {
        out += String.fromCharCode(b);
      } else {
        out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
      }
    }
    return out;
  }

  async function hmacSha1Hex(keyBytes, messageBytes) {
    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, messageBytes);
    return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function buildSigned(opts) {
    const method = String(opts.method).toLowerCase();
    const d = opts.data || {};
    const hostPath = opts.baseUrl.replace(/^https?:\/\//, '') + opts.path;
    const signData = Object.assign({}, d, {
      remote_user: opts.username,
      timestamp: String(opts.timestamp),
    });
    const preText = method + '&' + hostPath + '?' + flatten(signData).join('&');

    let body;
    let contentType = 'application/json';
    let preimage;
    if (opts.content !== null && opts.content !== undefined) {
      const json = compactJson(opts.content);
      body = json;
      contentType = 'application/json';
      preimage = te.encode(preText + '&' + json);
    } else if (opts.rawContent !== null && opts.rawContent !== undefined) {
      body = opts.rawContent;
      contentType = 'application/octet-stream';
      const head = te.encode(preText);
      preimage = new Uint8Array(head.length + 1 + opts.rawContent.length);
      preimage.set(head, 0);
      preimage[head.length] = 0x26;
      preimage.set(opts.rawContent, head.length + 1);
    } else {
      preimage = te.encode(preText);
    }
    return { preimage, body, contentType, signData };
  }

  async function signedRequest(opts) {
    const b = buildSigned(opts);
    const signature = await hmacSha1Hex(te.encode(opts.apikey), b.preimage);
    const urlData = Object.assign({}, b.signData, { signature });
    const encodedQuery = flatten(urlData)
      .map((item) => {
        const i = item.indexOf('=');
        return pyQuote(item.slice(0, i)) + '=' + pyQuote(item.slice(i + 1));
      })
      .join('&');

    return {
      url: opts.baseUrl + opts.path + '?' + encodedQuery,
      body: b.body,
      contentType: b.contentType,
      signature,
      signed: b.preimage,
    };
  }

  const CONTROL_TIMEOUT_MS = 60 * 1000;
  const CHUNK_TIMEOUT_MS = 5 * 60 * 1000;
  const RETRY_STATUSES = [408, 429, 502, 503, 504];
  const MAX_RETRY_AFTER_MS = 30 * 1000;

  function abortError() {
    return new DOMException('Aborted', 'AbortError');
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  function retryDelay(resp, attempt) {
    const h = resp && resp.headers ? resp.headers.get('Retry-After') : null;
    if (h) {
      const secs = Number(h);
      const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(h) - Date.now();
      if (Number.isFinite(ms) && ms >= 0) return Math.min(ms, MAX_RETRY_AFTER_MS);
    }
    return 2000 * (attempt + 1);
  }

  function withTimeout(signal, ms) {
    if (typeof AbortSignal === 'undefined' || !AbortSignal.timeout) return signal;
    const timeout = AbortSignal.timeout(ms);
    return signal && AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal || timeout;
  }

  async function request(account, opts) {
    const retries = opts.retries === undefined ? 3 : opts.retries;
    const userSignal = account && account.signal;
    const timeoutMs = opts.timeoutMs || (opts.rawContent ? CHUNK_TIMEOUT_MS : CONTROL_TIMEOUT_MS);
    const headers = { Accept: 'application/json' };
    if (opts.extraHeaders) Object.assign(headers, opts.extraHeaders);
    let lastErr = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const timestamp = Math.round(Date.now() / 1000);
      const signed = await signedRequest({
        method: opts.method,
        baseUrl: account.baseUrl,
        path: opts.path,
        data: opts.data,
        content: opts.content,
        rawContent: opts.rawContent,
        username: account.username,
        apikey: account.apikey,
        timestamp,
      });
      headers['Content-Type'] = signed.contentType;

      let resp;
      let text;
      try {
        resp = await fetch(signed.url, {
          method: String(opts.method).toUpperCase(),
          headers,
          body: signed.body,
          signal: withTimeout(userSignal, timeoutMs),
        });
        text = await resp.text();
      } catch (netErr) {
        if (userSignal && userSignal.aborted) throw abortError();
        lastErr =
          netErr && netErr.name === 'TimeoutError'
            ? new Error('FileSender timeout after ' + Math.round(timeoutMs / 1000) + 's')
            : netErr;
        if (attempt < retries) {
          await sleep(retryDelay(null, attempt), userSignal);
          continue;
        }
        break;
      }

      if (resp.ok) {
        if (text === '') return {};
        try {
          return JSON.parse(text);
        } catch (e) {
          return text;
        }
      }

      let msg = text;
      try {
        msg = JSON.parse(text).message || text;
      } catch (e) {
        /* keep text */
      }
      const isAuth =
        resp.status === 401 ||
        resp.status === 403 ||
        /auth_remote_(signature_check_failed|user_rejected)/.test(text);
      const err = new Error('FileSender HTTP ' + resp.status + ': ' + msg);
      err.status = resp.status;
      err.code = msg;
      err.auth = isAuth;
      if (isAuth || !RETRY_STATUSES.includes(resp.status)) throw err;
      lastErr = err;
      if (attempt < retries) await sleep(retryDelay(resp, attempt), userSignal);
    }
    throw lastErr;
  }

  async function getInfo(account) {
    return (await fetchInfo(account)).info;
  }

  async function fetchInfo(account) {
    const resp = await fetch(account.baseUrl + '/info', {
      signal: withTimeout(account.signal, CONTROL_TIMEOUT_MS),
    });
    const serverTime = Date.parse(resp.headers.get('Date') || '');
    return { info: await resp.json(), serverTime: Number.isFinite(serverTime) ? serverTime : null };
  }

  function parseInstanceConfig(text) {
    const pick = (k, re) => {
      const m = text.match(new RegExp('\\b' + k + ':\\s*' + re));
      return m ? m[1] : null;
    };
    const num = (k) => {
      const v = pick(k, "'?(\\d+)");
      return v === null ? null : Number(v);
    };
    const str = (k) => pick(k, "'((?:[^'\\\\]|\\\\.)*)'");
    const jsStr = (k) => {
      const v = str(k);
      return v === null ? null : v.replace(/\\(.)/g, '$1');
    };
    const bool = (k) => {
      const v = pick(k, '(true|false)');
      return v === null ? null : v === 'true';
    };
    return {
      siteName: str('site_name'),
      defaultDays: num('default_transfer_days_valid'),
      maxDays: num('max_transfer_days_valid'),
      maxTransferSize: num('max_transfer_size'),
      validFilenameRegex: jsStr('valid_filename_regex'),
      extensionWhitelistRegex: jsStr('extension_whitelist_regex'),
      banExtensions: (str('ban_extension') || '')
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean),
      encryption: {
        enabled: str('encryption_enabled') === '1',
        mandatory: str('encryption_mandatory') === '1',
        minPasswordLength: num('encryption_min_password_length'),
        generatedPasswordLength: num('encryption_generated_password_length'),
        generatedPasswordEncoding: str('encryption_generated_password_encoding'),
        keyVersion: num('encryption_key_version_new_files'),
        hashIterations: num('encryption_password_hash_iterations_new_files'),
        ivLength: num('crypto_iv_len'),
        cryptName: str('crypto_crypt_name'),
        hashName: str('crypto_hash_name'),
        cryptedChunkSize: num('upload_crypted_chunk_size'),
        mixedCase: bool('encryption_password_must_have_upper_and_lower_case'),
        numbers: bool('encryption_password_must_have_numbers'),
        special: bool('encryption_password_must_have_special_characters'),
      },
    };
  }

  function safeRegExp(src, flags) {
    try {
      return new RegExp(src, flags);
    } catch (e) {
      return null;
    }
  }

  function checkFileName(name, inst) {
    if (!inst) return null;
    if (inst.validFilenameRegex) {
      const re = safeRegExp(inst.validFilenameRegex + '$', 'u');
      if (re && !re.test(name)) return { code: 'name' };
    }
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot + 1) : '';
    if (inst.extensionWhitelistRegex) {
      const re = safeRegExp(inst.extensionWhitelistRegex);
      if (re && !re.test(ext)) return { code: 'extension', ext };
    }
    if ((inst.banExtensions || []).includes(ext)) return { code: 'extension', ext };
    return null;
  }

  async function getInstanceConfig(account) {
    const url = account.baseUrl.replace(/\/rest\.php$/i, '') + '/filesender-config.js.php';
    const resp = await fetch(url, { signal: withTimeout(account.signal, CONTROL_TIMEOUT_MS) });
    if (!resp.ok) throw new Error('FileSender config HTTP ' + resp.status);
    return parseInstanceConfig(await resp.text());
  }

  function buildTransferContent(account, file, opts) {
    const entry = Object.assign({}, file, opts.fileExtra);
    if (opts.mimeType) entry.mime_type = opts.mimeType;
    const content = {
      files: [entry],
      recipients: [],
      subject: opts.subject || '',
      message: opts.message || '',
      expires: opts.expires,
      aup_checked: opts.aupChecked ? 1 : 0,
      options: Object.assign({}, opts.options, { get_a_link: 1 }),
    };
    if (account.from) content.from = account.from;
    if (opts.encryption) {
      Object.assign(content, {
        encryption: true,
        encryption_key_version: String(opts.encryption.keyVersion),
        encryption_password_encoding: 'none',
        encryption_password_version: '1',
        encryption_password_hash_iterations: opts.encryption.hashIterations,
      });
    }
    return content;
  }

  async function createTransfer(account, file, opts) {
    const content = buildTransferContent(account, file, opts);
    return request(account, { method: 'post', path: '/transfer', data: {}, content });
  }

  function chunkData(transfer, file) {
    const data = { key: file.puid };
    if (transfer.roundtriptoken) data.roundtriptoken = transfer.roundtriptoken;
    return data;
  }

  async function putChunk(account, transfer, file, chunk, offset) {
    return request(account, {
      method: 'put',
      path: '/file/' + file.id + '/chunk/' + offset,
      data: chunkData(transfer, file),
      rawContent: chunk,
    });
  }

  async function fileComplete(account, transfer, file) {
    return request(account, {
      method: 'put',
      path: '/file/' + file.id,
      data: chunkData(transfer, file),
      content: { complete: true },
    });
  }

  async function transferComplete(account, transfer) {
    const data = { key: transfer.files[0].puid };
    return request(account, {
      method: 'put',
      path: '/transfer/' + transfer.id,
      data,
      content: { complete: true },
    });
  }

  async function deleteTransfer(account, transfer) {
    const data = { key: transfer.files[0].puid };
    return request(account, { method: 'delete', path: '/transfer/' + transfer.id, data });
  }

  function pickDownloadUrl(transfer) {
    const list = (transfer && transfer.recipients) || [];
    const r = list.find((x) => x.download_url);
    return r ? r.download_url : null;
  }

  function isTrue(v) {
    return v === true || v === 1 || v === '1' || v === 'true';
  }

  function expiresOf(transfer) {
    const e = transfer && transfer.expires;
    const raw = e && typeof e === 'object' ? e.raw : e;
    return Number(raw) || null;
  }

  async function getLinkStatus(account, url) {
    let token = null;
    try {
      token = new URL(url).searchParams.get('token');
    } catch (e) {
      /* not a URL */
    }
    if (!token) return null;
    const files = await request(account, {
      method: 'get',
      path: '/transfer/fileidsextended',
      data: { token },
      retries: 1,
    });
    const transferId = Array.isArray(files) && files[0] && files[0].transferid;
    if (!transferId) return null;
    const transfer = await request(account, {
      method: 'get',
      path: '/transfer/' + transferId,
      data: {},
      retries: 1,
    });
    const o = (transfer && transfer.options) || {};
    const size = files[0].size === undefined ? null : Number(files[0].size);
    return { transferId, expires: expiresOf(transfer), encrypted: isTrue(o.encryption), size };
  }

  function expiresForDays(days, now) {
    const d = new Date(now || Date.now());
    d.setDate(d.getDate() + days);
    return Math.floor(d.getTime() / 1000);
  }

  async function uploadFile(account, blob, file, opts) {
    opts = opts || {};
    const { info, serverTime } = await fetchInfo(account);
    const chunkSize = info.upload_chunk_size || 5 * 1024 * 1024;
    const days = opts.days || info.default_transfer_days_valid || 10;
    const expires = opts.expires || expiresForDays(days, serverTime);
    const enc = opts.encryption || null;
    const params = enc ? global.fscrypto.newFileParams(enc.ivLength, file.size, chunkSize) : null;

    const transfer = await createTransfer(account, file, {
      expires,
      aupChecked: opts.aupChecked,
      options: opts.options,
      encryption: enc,
      fileExtra: params ? { iv: params.ivB64, aead: params.aeadB64 } : null,
      subject: opts.subject,
      message: opts.message,
      mimeType: opts.mimeType,
    });
    const tfile = transfer.files[0];

    try {
      const key = enc
        ? await global.fscrypto.deriveKey(enc.password, transfer.salt, enc.hashIterations)
        : null;
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        if (account.signal && account.signal.aborted)
          throw new DOMException('Aborted', 'AbortError');
        const slice = blob.slice(offset, Math.min(offset + chunkSize, file.size));
        let buf = new Uint8Array(await slice.arrayBuffer());
        if (key)
          buf = await global.fscrypto.encryptChunk(
            key,
            params.ivBytes,
            offset / chunkSize,
            params.aead,
            buf,
          );
        await putChunk(account, transfer, tfile, buf, offset);
        if (opts.onProgress) opts.onProgress(Math.min(offset + chunkSize, file.size), file.size);
      }
      await fileComplete(account, transfer, tfile);
      const done = await transferComplete(account, transfer);
      const url = pickDownloadUrl(done) || pickDownloadUrl(transfer);
      const serverExpires = expiresOf(done) || expiresOf(transfer) || expires;
      return {
        url,
        transfer: done || transfer,
        transferId: transfer.id,
        puid: tfile.puid,
        expires: serverExpires,
      };
    } catch (e) {
      const cleanupAccount = Object.assign({}, account, { signal: undefined });
      try {
        await deleteTransfer(cleanupAccount, transfer);
      } catch (cleanup) {
        /* ignore */
      }
      throw e;
    }
  }

  global.filesender = {
    flatten,
    compactJson,
    bytesToB64,
    b64ToBytes,
    pyQuote,
    hmacSha1Hex,
    buildSigned,
    signedRequest,
    request,
    retryDelay,
    getInfo,
    fetchInfo,
    parseInstanceConfig,
    checkFileName,
    expiresForDays,
    getInstanceConfig,
    createTransfer,
    putChunk,
    fileComplete,
    transferComplete,
    deleteTransfer,
    pickDownloadUrl,
    isTrue,
    getLinkStatus,
    uploadFile,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
