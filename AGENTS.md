# AGENTS.md

Guidance for AI agents working in this repo. Read this before making changes; the
FileSender signing rules in particular are load-bearing.

## What this is

A Thunderbird Manifest V3 WebExtension implementing the `cloud_file` (FileLink) provider
API, backed by any FileSender instance. It lets users send large attachments as
FileSender download links from the compose window instead of attaching them inline.

## Design principles

- Behave like the FileSender web UI ("get a link" mode): empty files are refused, file
  names the instance does not allow are an error (never silently renamed), the terms of
  use must be accepted explicitly, only the standard FileSender transfer options exist.
  When in doubt, read the upstream source (branch `master3`) and replicate it.
- No silent uploads: every upload the user did not explicitly start is either confirmed
  in a window or notified.
- Anything the user must not miss goes in a window, not a notification (desktop "Do not
  disturb" hides notifications).
- Instance-agnostic: no default endpoint and no operator-specific text in UI strings or
  docs.

## Layout

`src/` is the extension payload (manifest at its root, as WebExtensions require for
`manifest.json` and `_locales/`); the xpi is its content plus `NOTICE.md`. Docs, tests
and tooling live outside it.

- `src/manifest.json`: MV3 manifest: cloud_file, permissions, host_permissions
- `src/background/`: background scripts, loaded in manifest order:
  - `log.js`: log(), warn(), redact(), maskKey(), maskId(), errText()
  - `background.js`: settings, instance config, onFileUpload flow, reuse check,
    notifications, keepalive, abort
  - `windows.js`: popups: options window batches, reuse question
  - `cleanup.js`: tracking and deletion of transfers of unsent mails
- `src/lib/filesender.js`: FileSender REST signing + upload client (the tricky part)
- `src/lib/fscrypto.js`: FileSender-compatible encryption (PBKDF2 + AES-GCM)
- `src/lib/account.js`: shared account helpers (`DEFAULT_OPTIONS`, `normalizeBaseUrl`,
  `isInsecureUrl`), used by both the background and the management page so the two never
  drift apart on how a base URL is normalized or rejected
- `src/lib/ui-common.js`: helpers shared by the pages (i18n fill, fit window height,
  days)
- `src/management/`: account settings page (storage.local per account)
- `src/options/`: pre-upload options popup (one window per batch)
- `src/reuse/`: "reuse or upload again?" popup (expiring < 24h or encrypted)
- `src/css/`: `common.css` (shared) + one stylesheet per page
- `src/_locales/`: UI strings and error messages (en default, it)
- `src/icons/`: PNG icons derived from the FileSender logo (BSD-3, `src/icons/LICENSE`),
  rendered by `tools/icons.sh` from `icons/filesender-mail.svg` (envelope badge, all
  sizes)
- `docs/TESTING.md`: manual + automated test plan
- `docs/ATN_REVIEW_NOTES.md`: notes for addons.thunderbird.net reviewers
- `test/`: automated tests; `sh test/check.sh` runs them all
- `test/files/`: manual upload fixtures; the big ones (`ok-*.bin`, sparse
  `too-large-200GiB.bin`) come from `test/make_fixtures.sh`
- `tools/build.sh`: zips src/ + NOTICE.md into dist/*.xpi (run from anywhere)
- `tools/auth_check.py`: read-only credential check from the terminal
- `tools/icons.sh`: regenerates src/icons/*.png from icons/*.svg (ImageMagick)
- `tools/format.sh`: black + ruff (Python), Prettier (JS/HTML/JSON/CSS)
- `pyproject.toml`: formatter settings, plus `[dependency-groups] dev` pinning black and
  ruff, the single source CI and `uv run --group dev <tool>` install from
- `uv.lock`: exact resolved versions for that dev group; commit it, don't hand-edit it
- `.prettierrc.json`, `.prettierignore`: Prettier settings
- `.markdownlint.jsonc`: editor-only markdownlint rules for the docs (not run in CI)
- `reference/filesender.py`: upstream FileSender CLI client (BSD-3); the source of truth
  for signing, NOT shipped in the xpi
- `reference/thunderbird-webextensions-skill.md`: upstream AI-agent guidance for
  Thunderbird WebExtension development, from
  <https://github.com/thunderbird/webext-support/tree/master/ai>, NOT shipped in the
  xpi. Read it before touching any `browser.*`/`cloudFile.*` API usage or adding a new
  one: never guess a WebExtension API's name or parameters, Thunderbird's are ONLY at
  <https://webextension-api.thunderbird.net/en/mv3/>, and differ from Firefox's
- `README.md`: install / usage documentation
- `TRANSLATIONS.md`: locales and how to add one
- `NOTICE.md`: third-party notices (FileSender BSD-3 parts), in the xpi
- `.github/workflows/test.yml`: reusable (`workflow_call`); `sh test/check.sh` plus
  `webext-linter`. The only place the test steps are written; checks.yml and release.yml
  both call it instead of repeating it
- `.github/workflows/checks.yml`: calls `test.yml` on push to `main`, on every pull
  request, and manually
- `.github/workflows/release.yml`: on an `X.Y.Z` tag, calls `test.yml`, then verifies
  the tag matches `src/manifest.json`'s version and publishes the built xpi as a GitHub
  release asset

## Tech / build

- Plain JS, HTML, CSS and JSON. No package.json, no bundler, no transpiler, no Node.
  `tools/build.sh` only zips the files; they load into Thunderbird as-is.
- Extension scripts are classic scripts, not ES modules. The manifest
  `background.scripts` array lists `lib/filesender.js`, `lib/account.js`,
  `lib/fscrypto.js`, then `background/log.js`, `background/background.js`,
  `background/windows.js`, `background/cleanup.js`. The libs are IIFEs that attach
  themselves to `globalThis.filesender` / `globalThis.fsAccount` / `globalThis.fscrypto`.
  The background files share the global scope: top-level functions and `const`s are
  visible across files. Code running at load time may only use what earlier files
  declare; listeners and functions may use anything, since they run after all files are
  loaded. Keep it that way.
- Pages load `../lib/ui-common.js` (and `../lib/fscrypto.js` for options,
  `../lib/account.js` for management), `../css/common.css` and their own
  `../css/<page>.css`. No inline styles.
- All paths inside the extension (manifest, `windows.create`, `service_icon`) are
  relative to `src/`, the extension root (e.g. `options/options.html`); paths in HTML
  are relative to the page. `test/static/static_check.py` verifies that every file
  referenced by the manifest, the background scripts and the pages exists.

## Formatting

- Python (`test/`, `tools/`): black (88 columns) for formatting, ruff for lint only (`E
  F W I B UP`). Settings in `pyproject.toml`; `reference/` is excluded. Tool versions
  are pinned in `pyproject.toml`'s `[dependency-groups] dev` and `uv.lock`, not in CI
  YAML: `uv sync --group dev` (used by `.github/workflows/test.yml`) installs exactly
  those into `.venv/`. `tools/format.sh` still just runs bare `black`/`ruff`, wherever
  they are on PATH; it does not require `uv` locally.
- JS/HTML/JSON/CSS of the extension, plus the JS test files (`test/**/*.js`): Prettier 3
  (`.prettierrc.json`: single quotes, 100 columns, trailing commas). Markdown is not
  formatted by Prettier: docs are wrapped by hand at 88 columns (tables excepted).
- `.markdownlint.jsonc` sets `MD013` to 88 columns (tables exempt, matching the hand
  wrapping above) and lets `MD033` allow `<p>`/`<img>` for the README's centered logo.
  It is not run anywhere; it only makes an editor's markdownlint extension agree with
  our conventions.
- `sh tools/format.sh` formats everything, `--check` only verifies (also run by `sh
  test/check.sh`). Prettier uses a local `npx` if present, otherwise a Docker
  `node:24-alpine` container, since Node is not installed here.

## Testing (no Node installed on the host; it always runs containerized or in CI)

`test/` has one subdirectory per target. The JS behavior tests (`*.test.js`) run on
Node's own builtin test runner (`node --test`, `node:assert/strict`, no npm
dependencies), never on a hand-rolled shim: Node has real `crypto.subtle`,
`TextEncoder`, `atob`/`btoa` and `fetch` built in, so these tests exercise the exact
async code paths the extension runs, not a re-implementation of them. Nothing is
installed on the host to get this: `test/check.sh` uses a local `node` if one happens
to be on PATH, otherwise a disposable `node:24-alpine` container (the same fallback
`tools/format.sh` already uses for Prettier); CI has Node natively via
`actions/setup-node`. `test/signing/vectors.json` and `test/crypto/vectors.json` are
generated, gitignored and never committed: `check.sh` (re)generates them before using
them, so a test can never run against a stale copy left over from a previous
`reference.py`/`crypto_reference.py` edit.

- Everything at once: `sh test/check.sh` (includes the formatting check).
- Static checks: `python3 test/static/static_check.py` (locale parity, placeholders,
  i18n keys used/unused, referenced files exist in src/) plus `node --test
  test/static/syntax.test.js` (every `src/**/*.js` file parses, via `vm.Script` --
  compiles but never runs it).
- Signing: `python3 test/signing/gen.py && node --test test/signing/signing.test.js`
  after any change to `src/lib/filesender.js`. Loads the real library and checks it
  against the freshly generated `test/signing/vectors.json`.
- Ground-truth vectors live in `test/signing/reference.py` (a Python mirror of
  `filesender.py`), turned by `test/signing/gen.py` into `test/signing/vectors.json`.
  If you must change the signing, keep `test/signing/reference.py` in sync with
  `filesender.py` (there is nothing to commit for the generated vectors themselves).
- Encryption: `python3 test/crypto/gen.py && node --test test/crypto/crypto.test.js`
  after changes to `src/lib/fscrypto.js`. Ground-truth vectors come from
  `test/crypto/crypto_reference.py`, a copy of the filesender.py encryption (needs
  python `cryptography`).
- Requests: `node --test test/request/request.test.js` (fake fetch/timers/AbortSignal:
  Retry-After, retry statuses, no retry on 500, timeouts, abort during backoff). The
  fake timer queue is only flushed by `flushTimers()`; a `waitFor()` helper polls the
  real Node event loop until request()'s promise chain has actually reached the point
  being tested, instead of a blind tick count.
- Background logic: `node --test test/background/background.test.js` after any change
  to `src/background/`. `test/background/harness.js` (fake `browser.*` APIs and a fake
  `globalThis.filesender`) and `test/background/scenarios.js` (the scenario steps) are
  run with `vm.runInContext` in one shared `vm.Context`, alongside the real background
  scripts in manifest order -- `require()` would give each file its own module scope
  and break the classic-script shared-global-scope assumption the background scripts
  rely on (see Layout above). Scenarios: direct upload, terms, empty, too large, bad
  name, reuse long/short/invalid/changed/encrypted, options batch, cancel, window
  closed, abort while pending, bad password, ignored options, credential check, cleanup
  of unsent mails, redaction, window centering. Add a step to `scenarios.js` when you
  add a branch.
- A live test needs a real Thunderbird plus a FileSender API key and username. The
  manual plan is `docs/TESTING.md`.
- The local Thunderbird is a flatpak: it only sees the single file picked in the file
  chooser. Load `dist/*.xpi` (from `sh tools/build.sh`), never `src/manifest.json`, or
  the background and settings pages will not load.

## FileSender signing -- MUST match filesender.py exactly

This is the core invariant; the differential tests exist to pin it down. Do not
"simplify" any step.

- `flatten(data)`: Object.keys, drop null/undefined, map to `"k=v"`, `sort()`
  (full-string lexicographic), join with `"&"`.
- `signData = { ...data, remote_user, timestamp }` (timestamp = unix seconds).
- `hostPath` = baseUrl with the scheme removed, + path. baseUrl already ends in
  `/rest.php`.
- `preimage = method.lower() + "&" + hostPath + "?" + flatten(signData).join("&")`.
- JSON body: `preimage += "&" + compactJson(content)`. compactJson is JSON.stringify
  then every non-ASCII char -> `\uXXXX` (Python ensure_ascii).
- Raw body: `preimage += "&" + rawBytes` (no encoding of the body).
- `signature = HMAC-SHA1(apikeyBytes, preimage).hexdigest()`, where apikeyBytes = each
  character mapped to its code point (`bytearray(map(ord, apikey))`).
- Query string: `flatten(signData + {signature})`, then percent-encode key and value
  separately with `pyQuote`. RFC3986 unreserved are A-Za-z0-9 and `_.~-`; note that `/`
  is also NOT encoded.

## Upload flow

- `GET /info` -- UNSIGNED. Gives upload_chunk_size only (default_transfer_days_valid is
  NOT there on 3.x); its `Date` header is the server clock used for `expires`.
- `GET <site>/filesender-config.js.php` -- UNSIGNED, parsed with regexes in
  `fs.parseInstanceConfig` (like filesender.py): default/max days, max_transfer_size,
  file name rules, encryption params, password rules. Cached 1h in the background
  (`instanceConfig`); the settings page asks for it via the runtime message
  `{type:'instance-config', baseUrl}`. `max_transfer_size` is pushed to Thunderbird with
  `cloudFile.updateAccount({uploadSizeLimit})`.
- `POST /transfer` -- signed, JSON body: files:[{name,size}], recipients:[], subject,
  message, expires, aup_checked, options (all explicit booleans + `get_a_link:1`),
  `from` only when the user set a sender email, encryption fields when encrypted. The
  server assigns files[0].id and files[0].puid.
- `PUT /file/{id}/chunk/{offset}` -- signed, octet-stream raw chunk; query {key: puid,
  roundtriptoken?}.
- `PUT /file/{id}` -- signed, JSON {complete:true}.
- `PUT /transfer/{id}` -- signed, JSON {complete:true}; the response's
  recipients[].download_url is the link to return.
- On any failure, best-effort `DELETE /transfer/{id}`, sent WITHOUT the abort signal
  (otherwise an aborted upload would also cancel its own cleanup).
- `puid` and `id` are always SERVER-assigned. Never invent them.
- `expires` mirrors the 3.x web UI (`www/js/upload_page.js`): now + N days with
  `Date.setDate` (same time of day, DST-aware), `Math.floor` to seconds
  (`fs.expiresForDays`). "Now" is the SERVER time from `GET /info` (`fs.fetchInfo`): the
  server max is `strtotime('+N day')` on its own clock, so a client clock even a second
  ahead would get `bad_expire`. Never add fixed margins.

## Requests: timeouts and retries

- Every request has a timeout (`withTimeout`: 60 s control, 5 min per chunk) combined
  with the user abort signal via `AbortSignal.any`.
- Retries only on network errors/timeouts and 408, 429, 502, 503, 504, with
  `Retry-After` (seconds or HTTP date, capped at 30 s) else 2/4/6 s. The backoff `sleep`
  is abortable.
- FileSender answers 500 for every application error (auth, size, validation): never
  retry 500. A user abort always surfaces as AbortError.

## Account settings page

- The page only has a limited API set (cloudFile, extension, i18n, runtime, storage).
  Get the account id with `new URL(location.href).searchParams.get('accountId')`.
- `http://` base URLs are rejected, both on save (`management.js`) and, defense in
  depth, before every upload and every "Test connection" call in `background.js`
  (`fsAccount.isInsecureUrl`, `errInsecureUrl`/`mgmtInsecureUrl`): the API key and the
  file content would otherwise travel in clear text. A scheme-less input is still
  upgraded to `https://` by `normalizeBaseUrl`; only an explicit `http://` is refused.
- Account record in `storage.local[accountId]`: `{baseUrl, username, email, apikey, aup,
  askOptions, defaults: {days, options: {email_me_on_expire, email_upload_complete,
  email_download_complete, email_report_on_closing, must_be_logged_in_to_download}}}`.
  Global `storage.local.debug` enables detailed logs.
- "Test connection": runtime message `check-credentials` -> signed `GET /user/@me`. Auth
  errors (`auth_remote_signature_check_failed` / `auth_remote_user_rejected`) are
  reported as rejected credentials. Save does no network call. On success, and only if
  the account has never been saved (no `defaults` yet), the default options are
  pre-filled from `user.transfer_preferences` (the options of the user's last transfer,
  which the web UI also uses via `User::defaultOptionState`).
- The terms checkbox is never pre-filled, not even from `aup_ticked`: it is ticked by
  hand at the first configuration. `aup_checked` is sent only when `aup` is true, and
  uploads are refused otherwise.

## remote_user vs from

- `username` is remote_user, used only in the signature. It must be the user's SAML uid
  exactly as FileSender stores it (the `username` in the filesender.py.ini downloadable
  from the profile). It is often NOT an email (e.g. a persistent-id
  `https://idp...!https://sp...!opaque=`).
- `email` is the transfer's `from` and is optional: when empty, `from` is omitted and
  the server uses the account's primary email (`Transfer::create` ->
  `Auth::user()->email`). When set it must be one of the account's `email_addresses`,
  else `bad_email`. The REST user object does not expose the email, so it cannot be
  auto-filled.
- A wrong remote_user and a wrong API key give the same server error,
  `auth_remote_signature_check_failed`. `tools/auth_check.py` checks credentials outside
  Thunderbird.

## Minimum Thunderbird version

- `strict_min_version: "128.0"` is set by MV3 support itself (TB 128 is the first
  release that supports it), not by any single API: `cloudFile` events,
  `storage.session`, `compose.onAfterSave` and
  `cloudFile.updateAccount({uploadSizeLimit})` were all available well before 128. Do
  not raise or lower it without checking whether an API in use actually needs a newer
  version.

## Thunderbird cloudFile gotchas

- An account's `configured` flag lives only in memory (`_configured = false` in
  Thunderbird's `ext-cloudFile.js`): after every restart it is false and the account is
  not offered in the compose window until `updateAccount({configured: true})`.
  `refreshAllAccounts()` re-asserts it at background load for every account with saved
  settings and accepted terms.
- At app startup Thunderbird does not start an MV3 event page that has persisted
  listeners: it only primes them, unless one of them is `runtime.onStartup`
  (`ext-backgroundPage.js`). The empty `onStartup` listener is what makes the
  background, and so `refreshAllAccounts()`, run at startup. Never remove it.
- `onFileUpload(account, fileInfo, tab, relatedFileInfo)` must return `{url,
  templateInfo?, error?, aborted?}`. `error` is boolean or string.
- `templateInfo` is a CloudFileTemplateInfo: service_name, service_url, service_icon,
  download_expiry_date:{timestamp in ms}, download_password_protected.
- An MV3 background can be idle-terminated: keep persistent state in `storage.local`
  (settings) or `storage.session` (cleanup tracking); only per-upload state (abort
  controllers, pending windows) lives in memory.
- Thunderbird calls onFileUpload once per attachment, concurrently: one transfer per
  file; do not batch files into a single transfer.
- Transfers are "get a link" (`get_a_link: 1`, no recipients): one public link,
  FileSender sends no email, the extension never reads the mail.

## Link reuse

- `reuse_uploads` is false: with true, Thunderbird reuses a previous upload (the attach
  menu list) without calling the extension and without checking expiry. With false,
  Thunderbird calls onFileUpload with `relatedFileInfo` ({url, dataChanged, ...}).
- `fs.getLinkStatus` resolves the download token via signed `GET
  /transfer/fileidsextended?token=` -> transferid and file size, then `GET
  /transfer/{id}` -> `expires.raw` and `options.encryption`.
- At least 24h left and not encrypted: reuse silently. Less than 24h, or encrypted
  (password reminder): ask every time in `reuse/reuse.html` (`askReuse`, messages
  `reuse-init` / `reuse-answer`; closing it cancels). Expired, closed (a manual close
  sets expires=now), deleted (the call fails), or server size != local size
  (Thunderbird's `dataChanged` only compares paths): new upload, with the reason shown
  in the options window or notified.
- `relatedFileInfo.templateInfo` is always undefined (Thunderbird stores the fields
  flat): never rely on it.
- Uploads started with "FileSender..." + browse never carry `relatedFileInfo`, so they
  are always new uploads.

## Options window (pre-upload)

- Account setting `askOptions` (default true). If false, uploads use `defaults`
  directly; encryption is then impossible (no password), so an instance with
  `encryption_mandatory` returns an error asking to enable it.
- The first onFileUpload of a batch opens `options/options.html?accountId=`; later calls
  for the same account join the same batch (`batches` Map). The page asks
  `{type:'options-init'}`, receives live `{type:'options-files'}` pushes, and answers
  `options-submit` (choice) or `options-cancel`. Closing the window
  (`windows.onRemoved`) cancels the whole batch; `onFileUploadAbort` removes one file
  from it.
- Popups open through `openPopup()`: centered on the compose window (the `tab` passed to
  onFileUpload), screen center as fallback; `fitWindow()` measures the body (not the
  document, which is never smaller than the viewport) and keeps the center. On native
  Wayland the compositor ignores positions.
- File name and extension are checked BEFORE any window, with the instance rules
  (`fs.checkFileName`: `valid_filename_regex` + `$`, flag `u`, like PHP `/.../u`;
  extension after the last dot vs `extension_whitelist_regex` and `ban_extension`,
  case-sensitive like the server).
- The background re-validates every choice (`sanitizeChoice`, days clamped to the
  instance max, password re-checked with `fscrypto.checkPassword`). Never trust the
  page.
- After upload, requested vs applied `transfer.options` are compared; a mismatch means
  the instance does not allow that option for the user, and a notification says so. No
  API exposes it beforehand.

## Encryption

- Mirrors filesender.py exactly: the file entry gets `iv` (base64 of ivLength-4 random
  bytes) and `aead` (base64 of the literal JSON string
  `{"aeadversion":1,"chunkcount":N,"chunksize":S,"iv":"...","aeadterminator":1}`); the
  transfer gets `encryption:true`, `encryption_key_version:"3"`,
  `encryption_password_encoding:"none"`, `encryption_password_version:"1"`,
  `encryption_password_hash_iterations`. Key = PBKDF2-SHA256(password ASCII,
  transfer.salt ASCII, iterations) -> AES-GCM-256. Chunk = fullIv (iv + chunk index
  uint32 LE) + ciphertext+tag, AAD = the aead string; PUT at the PLAIN offset.
- Only AES-GCM / SHA-256 / key version 3 are supported (`encryptionInfo`).
- Passwords: ASCII only (encoding "none"), checked against the instance rules. Never
  log, store or put them in the mail. `templateInfo.download_password_protected = true`.

## Cleanup of unsent mails

- Thunderbird calls `onFileDeleted` only when an attachment is removed or converted,
  never when a compose window is closed, and not at all once a draft was saved (it marks
  uploads immutable on send AND save).
- So every transfer WE created is tracked in `storage.session` (`tracked`): `{url:
  {accountId, transferId, puid, holders: [{fileId, tabId}]}}`. Reuse of a tracked url
  adds a holder; untracked (older or sent) links are never deleted.
- `compose.onAfterSend` (no error) / `onAfterSave` -> drop the tab's entries (kept).
  `tabs.onRemoved` -> drop that tab's holders; a transfer with no holders left is
  deleted. `onBeforeSend` marks the tab `sending`: if the tab closes before
  `onAfterSend`, the decision waits for its result.
- `onAccountDeleted` removes the account's settings.
- Needs the `compose` permission (events only, never the mail content).

## Notifications and keepalive

- `notify()` is used for uploads the user did not explicitly start (reuse fallback) when
  the options window is off, and for ignored options.
- While uploads or windows are pending, a 20 s interval calls
  `runtime.getPlatformInfo()` so the MV3 event page is not idle-terminated (extension
  API calls reset the idle timer). DevTools also prevents idle termination, so test long
  uploads with DevTools closed.

## Logging

- `log()` prints only when `storage.local.debug` is true; `warn()` always prints errors.
  Both pass every argument through `redact()`: token/signature keep 4 chars,
  key/roundtriptoken/remote_user are removed, emails become `v…@domain`.
  `maskKey`/`maskId` shorten the API key and the SAML username. Log prefix is
  `[FileSender]`.

## Abort

- An in-memory `Map<fileId, AbortController>` in `src/background/background.js`.
- `onFileUploadAbort` aborts it, removes the file from a pending options window and
  closes a pending reuse question; the signal is threaded into fetch via
  `account.signal`; on AbortError return `{aborted:true}`.

## CORS / host permissions

- FileSender sends no CORS headers; in Gecko a cross-origin fetch from the background
  needs a host permission. The value is `https://*/*` so any self-hosted FileSender
  works, as all self-hosted FileLink providers on ATN do (table in
  `docs/ATN_REVIEW_NOTES.md`). Runtime `permissions.request` is not available on the
  cloudFile settings page.

## Conventions

- Everything in the repository is in English: code, identifiers, comments, docs, test
  data, commit messages. The only non-English text is the translations in
  `src/_locales/<lang>/`.
- Comments explain the code to its reader (why a non-obvious step exists). They never
  tell the history of a decision or what was tried before.
- User-facing strings live only in `src/_locales/{en,it}/messages.json`
  (`default_locale: en`), read with `browser.i18n.getMessage`; pages fill `data-i18n`
  elements at load. Keep en and it key sets identical; never hardcode UI text in JS or
  HTML. This includes the service name: `cloud_file.name` is `__MSG_serviceName__` and
  `templateInfo.service_name` uses the same key.
- Code stays light on comments (match the existing style).
- `reference/filesender.py` is read-only ground truth. If behavior is wrong, fix the JS,
  not the reference.
- `reference/thunderbird-webextensions-skill.md` is upstream, read-only: update it only
  by re-downloading a newer version from
  <https://github.com/thunderbird/webext-support/tree/master/ai>, never by hand-editing
  it.
- `src/manifest.json`'s version follows semver; bump it whenever the release workflow
  will be used, tagging `X.Y.Z` to match.
