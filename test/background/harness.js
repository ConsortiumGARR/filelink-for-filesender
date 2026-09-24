// Fakes for src/background/*.js: browser.* WebExtension APIs and the
// filesender client (background.js never talks to a real server). Loaded via
// vm.runInContext in background.test.js, in the SAME context as the background
// scripts themselves, so top-level `function`/`const` declared here (and in
// background.js/windows.js/cleanup.js/log.js) share one global scope exactly
// like the classic <script> tags Thunderbird loads them as.
var timers = [];
globalThis.setTimeout = function (fn) {
  timers.push(fn);
  return timers.length;
};
globalThis.setInterval = function () {
  return 1;
};
globalThis.clearInterval = function () {};
globalThis.console = { log: function () {}, warn: function () {} };
globalThis.TextEncoder = function () {};
TextEncoder.prototype.encode = function (s) {
  return s;
};
globalThis.AbortController = function () {
  var self = this;
  this.signal = { aborted: false };
  this.abort = function () {
    self.signal.aborted = true;
  };
};
globalThis.crypto = {
  getRandomValues: function (a) {
    for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return a;
  },
};

var S = {
  notes: [],
  uploads: [],
  windows: 0,
  removed: [],
  pushes: 0,
  config: null,
  session: {},
  deleted: [],
  removedKeys: [],
  allAccounts: [],
  updateAccountCalls: [],
  startupListeners: [],
  link: null,
  results: {},
  listeners: {},
  msgListeners: [],
  removedListeners: [],
};
var NOW = Math.round(Date.now() / 1000);

function ev(name) {
  return {
    addListener: function (fn) {
      S.listeners[name] = fn;
    },
  };
}
globalThis.browser = {
  storage: {
    local: {
      get: function (id) {
        var o = {};
        o[id] = S.config;
        return Promise.resolve(o);
      },
      remove: function (id) {
        S.removedKeys.push(id);
        return Promise.resolve();
      },
    },
    onChanged: { addListener: function () {} },
    session: {
      get: function (k) {
        var o = {};
        if (k in S.session) o[k] = JSON.parse(S.session[k]);
        return Promise.resolve(o);
      },
      set: function (o) {
        for (var k in o) S.session[k] = JSON.stringify(o[k]);
        return Promise.resolve();
      },
    },
  },
  onChangedStub: null,
  compose: {
    onBeforeSend: ev('beforeSend'),
    onAfterSend: ev('afterSend'),
    onAfterSave: ev('afterSave'),
  },
  tabs: { onRemoved: ev('tabRemoved') },
  cloudFile: {
    onFileUpload: ev('upload'),
    onFileUploadAbort: ev('abort'),
    onFileDeleted: ev('fileDeleted'),
    onAccountDeleted: ev('accountDeleted'),
    getAllAccounts: function () {
      return Promise.resolve(S.allAccounts || []);
    },
    updateAccount: function (id, props) {
      S.updateAccountCalls.push({ id: id, props: props });
      return Promise.resolve();
    },
  },
  runtime: {
    onMessage: {
      addListener: function (fn) {
        S.msgListeners.push(fn);
      },
    },
    onStartup: {
      addListener: function (fn) {
        S.startupListeners.push(fn);
      },
    },
    sendMessage: function () {
      S.pushes++;
      return Promise.resolve();
    },
    getPlatformInfo: function () {
      return Promise.resolve({});
    },
  },
  windows: {
    create: function (o) {
      S.windows++;
      S.lastCreate = o;
      return Promise.resolve({ id: 100 + S.windows, left: o.left, top: o.top });
    },
    get: function () {
      return Promise.resolve({ left: 100, top: 50, width: 1000, height: 800 });
    },
    update: function () {
      return Promise.resolve({});
    },
    remove: function (id) {
      S.removed.push(id);
      return Promise.resolve();
    },
    onRemoved: {
      addListener: function (fn) {
        S.removedListeners.push(fn);
      },
    },
  },
  notifications: {
    create: function (o) {
      S.notes.push(o.message);
      return Promise.resolve('n');
    },
  },
  i18n: {
    getMessage: function (k, subs) {
      return k + (subs && subs.length ? '|' + subs.join('|') : '');
    },
    getUILanguage: function () {
      return 'en';
    },
  },
};

globalThis.filesender = {
  isTrue: function (v) {
    return v === true || v === 1 || v === '1' || v === 'true';
  },
  checkFileName: function (name) {
    if (name.indexOf('=') >= 0) return { code: 'name' };
    if (/\.exe$/.test(name)) return { code: 'extension', ext: 'exe' };
    return null;
  },
  getInstanceConfig: function () {
    return Promise.resolve({
      defaultDays: 14,
      maxDays: 14,
      maxTransferSize: 1000000,
      encryption: {
        enabled: true,
        mandatory: false,
        minPasswordLength: 12,
        generatedPasswordLength: 30,
        keyVersion: 3,
        hashIterations: 1000,
        ivLength: 16,
        cryptName: 'AES-GCM',
        hashName: 'SHA-256',
        mixedCase: true,
        numbers: true,
        special: true,
      },
    });
  },
  request: function (acc, opts) {
    if (acc.apikey === 'bad') {
      var e = new Error('FileSender HTTP 500: auth_remote_signature_check_failed');
      e.auth = true;
      return Promise.reject(e);
    }
    return Promise.resolve({
      id: 42,
      aup_ticked: '1',
      transfer_preferences: {
        email_download_complete: false,
        must_be_logged_in_to_download: 1,
        get_a_link: true,
      },
    });
  },
  getLinkStatus: function () {
    if (S.link instanceof Error) return Promise.reject(S.link);
    return Promise.resolve(S.link);
  },
  uploadFile: function (acc, blob, file, opts) {
    S.uploads.push({
      name: file.name,
      days: opts.days,
      options: opts.options,
      encrypted: !!opts.encryption,
    });
    var applied = Object.assign({}, opts.options);
    if (S.dropOption) applied[S.dropOption] = false;
    return Promise.resolve({
      url: 'https://fs/?s=download&token=new-' + file.name,
      expires: NOW + 14 * 86400,
      transfer: { options: applied },
      transferId: 'T-' + file.name,
      puid: 'P-' + file.name,
    });
  },
  deleteTransfer: function (acc, transfer) {
    S.deleted.push(transfer.id);
    return Promise.resolve({});
  },
};

function baseConfig(extra) {
  return Object.assign(
    {
      baseUrl: 'https://fs.example.org/rest.php',
      username: 'u',
      email: 'u@example.org',
      apikey: 'k'.repeat(64),
      aup: true,
      askOptions: false,
      defaults: { days: 7, options: { email_me_on_expire: true } },
    },
    extra || {},
  );
}
function reset(cfg) {
  S.notes = [];
  S.uploads = [];
  S.windows = 0;
  S.removed = [];
  S.pushes = 0;
  S.config = cfg;
  S.link = null;
  S.results = {};
  S.dropOption = null;
}
function file(id, name, size) {
  return { id: id, name: name, data: { size: size === undefined ? 10 : size } };
}
function start(key, f, related, tab) {
  S.listeners.upload({ id: 'acc1' }, f, tab || null, related).then(function (r) {
    S.results[key] = r;
  });
}
function msg(m) {
  var out = null;
  S.msgListeners.forEach(function (fn) {
    var r = fn(m);
    if (r && r.then) out = r;
  });
  return out;
}
