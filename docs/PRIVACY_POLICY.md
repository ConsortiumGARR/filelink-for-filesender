# Privacy policy

This is the full text for the "Privacy Policy" field on addons.thunderbird.net. Paste it
verbatim; ATN requires the full text there, not a link to this file.

## What data this add-on handles

FileLink for FileSender needs the following to upload attachments to the FileSender
instance you configure:

- The instance's base URL, your FileSender identifier and your FileSender API key.
- Optionally, a sender email address (one of your FileSender account's own addresses).
- Your default upload options (expiry, notification and encryption preferences).

This data is entered by you, in the add-on's account settings page, and is stored only
in Thunderbird's local extension storage (`storage.local`) on your own computer. It is
never sent anywhere except to the FileSender instance you configured, as part of signing
and authenticating the upload requests you initiate.

While an upload is pending, the add-on also keeps a short-lived local record (in
`storage.session`, cleared when Thunderbird restarts) of which transfers it created for
which draft emails, so it can delete a transfer if you discard the email without sending
it, and reuse a link if you attach the same file again.

## What this add-on does NOT do

- It does not send any data to its developers or to any third party other than the
  FileSender instance you yourself configured.
- It does not read or transmit the content of your emails. It only observes whether a
  message was sent, saved or discarded, to decide whether to keep or delete a transfer.
- It does not use analytics, telemetry, tracking or advertising of any kind.
- It does not set cookies.
- Optional password-based encryption is performed entirely on your device (WebCrypto);
  the password is never stored, never logged and never included in the email. You are
  responsible for sharing it with your recipients through a separate channel.

## Logging

The add-on can optionally print debug logs to its own console, off by default. When
enabled, API keys, signatures, upload tokens and email addresses are masked or redacted
before being logged, so that a log can be safely copied into a bug report. Logs stay on
your device; the add-on never transmits them anywhere.

## Network requests

The only network requests this add-on makes are to the FileSender instance whose URL you
entered in the account settings: to read its public configuration, to sign and upload
files, and to check your account status ("Test connection"). All requests require
`https://`; an `http://` instance URL is refused.

## Contact

Questions about this policy or the add-on's data handling can be sent through the
project's GitHub repository issue tracker.
