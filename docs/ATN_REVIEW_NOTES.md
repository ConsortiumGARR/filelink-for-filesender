# Notes for addons.thunderbird.net reviewers

## What the add-on does

FileLink for FileSender is a Thunderbird FileLink (`cloud_file`) provider for
[FileSender](https://filesender.org), the open source large-file transfer service run by
many research and education networks. Each attachment the user sends "via FileSender" is
uploaded to the user's own FileSender instance as a "get a link" transfer, and
Thunderbird inserts the download link into the mail.

## Source and build

- Plain JavaScript, HTML, CSS and JSON. No bundler, no minification, no transpilation,
  no third-party libraries, no remote code. The XPI is a zip of `src/` plus `NOTICE.md`
  (`tools/build.sh`).
- `src/icons/` are derived from the FileSender logo (BSD-3-Clause, see
  `src/icons/LICENSE`).
- `reference/filesender.py` is the upstream FileSender CLI client (BSD-3), used only as
  a reference for the REST signing; it is not part of the XPI.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Account settings (base URL, username, API key, default options) in `storage.local`; per-session upload tracking in `storage.session`. |
| `notifications` | Non-blocking information, e.g. options the server did not apply. Anything the user must decide goes into a window instead. |
| `compose` | Only the `compose.onBeforeSend`, `onAfterSend` and `onAfterSave` events, to know whether a mail was sent or saved. Transfers created for a mail that is closed without being sent or saved are deleted from FileSender. The add-on never reads or modifies the mail content. |
| `https://*/*` (host) | FileSender is self-hosted by many organizations, so the instance URL is configured by the user. FileSender does not send CORS headers, so the background needs a host permission for that origin. Requests go only to the configured instance. |

## Host permission compared with other FileLink providers

Host permissions of the add-ons tagged "filelink" on ATN (September 2026):

| Add-on | Users | Host permission |
|---|---|---|
| FileLink provider for Send (self-hosted) | 48.6k | `<all_urls>` |
| FileLink Provider for Dropbox | 44.7k | `https://*.dropboxapi.com/*` |
| *cloud - FileLink for Nextcloud/ownCloud | 36.1k | `<all_urls>` |
| FileLink provider for WebDAV | 36.0k | `<all_urls>` |
| FileLink Provider for Box | 9.6k | none (`identity`) |
| FEX.net FileLink | 6.5k | `https://*.fex.net/*` |
| FileLink for Plik (self-hosted) | 2.5k | `<all_urls>` |
| S3 FileLink Provider | 1.0k | `<all_urls>` |
| FileLink For Synology FileStation | 25 | `https://*/*` |

Providers for self-hosted services declare a broad fixed permission; only services with
a fixed domain restrict it. `https://*/*` is narrower than the common `<all_urls>`. The
`cloud_file` settings page has no `permissions` API, so a per-origin runtime request is
not possible there.

## Network traffic

Only to the FileSender instance configured by the user:

- `GET /rest.php/info` and `GET /filesender-config.js.php` (public, unsigned): chunk
  size, limits, allowed file names, encryption parameters.
- Signed REST calls (HMAC-SHA1 with the user's API secret, as in the official client):
  create transfer, upload chunks, complete, delete, read transfer status for link reuse,
  `GET /user/@me` for "Test connection".

No analytics, no telemetry, no third-party services.

## Data and secrets

- The FileSender API secret is stored in `storage.local`, like other FileLink providers
  do with their credentials. It is never logged: logs mask the key and redact tokens,
  signatures and email addresses. Detailed logs are off unless the user enables debug.
- Optional client-side encryption follows the FileSender web client (PBKDF2 with the
  instance's parameters, AES-GCM per chunk, WebCrypto). The password is typed or
  generated in the options window, is never stored or logged, and is never inserted into
  the mail.

## Windows opened by the add-on

- `src/options/options.html`: pre-upload options (expiry, notifications, encryption),
  one window per batch of attachments.
- `src/reuse/reuse.html`: asks whether to reuse an existing link (expiring within 24
  hours, or encrypted) or upload again.
- `src/management/management.html`: the standard `cloud_file` account settings page.

## Files not reachable by static analysis

`src/options/options.html`, `src/reuse/reuse.html` and their stylesheets
(`css/options.css`, `css/reuse.css`) are not linked from any manifest entry point or
from `src/management/management.html`, the one page the manifest does name
(`management_url`). A crawl starting only from declared entry points will not visit them
and may flag them as unused.

They are opened at runtime with `browser.windows.create()`, from a URL built by string
concatenation (`openPopup()` in `src/background/windows.js`):

```js
openPopup('options/options.html?accountId=' + encodeURIComponent(accountId), ...)
openPopup('reuse/reuse.html?fileId=' + encodeURIComponent(fileId), ...)
```

Both windows are described above, under "Windows opened by the add-on".

## Testing

`sh test/check.sh` runs static checks, signing tests against vectors generated from the
official client, request retry/timeout tests, a simulation of the background logic with
fake `browser.*` APIs, and WebCrypto tests in headless Chrome. The manual test plan is
in `docs/TESTING.md`. GitHub Actions (`.github/workflows/checks.yml`) runs the same
suite on every push and pull request, plus Thunderbird's own `webext-linter` against the
built xpi.
