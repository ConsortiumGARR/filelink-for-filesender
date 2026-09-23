# FileLink for FileSender

<p align="center">
  <img src="src/icons/filesender-128.png" alt="FileLink for FileSender" width="96">
</p>

A Thunderbird add-on that attaches large files to your emails as
[FileSender](https://filesender.org) download links instead of attaching them directly.
It works with any FileSender instance you have an account on.

## What it does

- Adds "FileSender" as a FileLink provider in the attachment menu.
- Uploads the file to your FileSender instance and puts a download link in the mail
  instead of the file itself.
- Lets you set an expiry date, notifications and password encryption before each upload
  (or use saved defaults).
- Reuses a link you already sent when you attach the same file again, as long as it is
  still valid.

## Requirements

- Thunderbird 128 or later.
- An account on a FileSender instance, with its REST API enabled for you.

## Getting your FileSender credentials

The add-on needs three values: the instance's base URL, your username and your API key.
FileSender can hand you all three in one file:

1. On your FileSender instance, open `/?s=user` (or find "My Account" / "Profile" in the
   menu) and scroll to the bottom, "Remote authentication".
2. Click "Download the Python client configuration".
3. Open the downloaded `filesender.py.ini`: it has a `[system]` section with `base_url`,
   and a `[user]` section with `username` and `apikey`. Use those three values in the
   add-on's settings (see "Configuration" below).

Your username here is your FileSender identifier for signing requests (`remote_user`);
it is often not your email address.

## Installation

A signed release is not published yet; install it as a temporary add-on:

1. Download or build `filelink-for-filesender-<version>.xpi` (see `docs/TESTING.md` to
   build it from source).
2. In Thunderbird, open "Add-ons and Themes" (Ctrl+Shift+A).
3. Gear menu (top right) -> "Debug Add-ons" -> "Load Temporary Add-on..." and pick the
   `.xpi` file.

A temporary add-on stays installed until Thunderbird restarts, and needs to be reloaded
after every change.

## Configuration

1. Settings -> Composition -> "Attachments" -> "Add FileSender".
2. Select the account in the list: the settings page opens on the right.
3. Fill in the base URL, username and API key from "Getting your FileSender credentials"
   above; optionally a sender email. Click "Test connection".
4. Tick the terms of use, adjust the default upload options if you want, and save.

## Usage

1. Write a mail, click Attach -> FileLink -> "FileSender" -> pick one or more files.
2. If asked, set the expiry, notifications and optional password, then click "Upload".
3. Each file becomes a FileSender link in the mail, with its expiry date (and "password
   protected" when encrypted). The password is never stored nor put in the mail: send it
   to the recipients separately.
4. To reuse a file you already sent, pick it again from the attach menu; a new upload
   starts only if the previous link is no longer valid.

## Troubleshooting

- **"FileSender is not configured"**: the settings were not saved, or a field is
  missing.
- **`auth_remote_signature_check_failed`**: wrong username or API key (FileSender gives
  the same error for both). Re-download the `filesender.py.ini` file above and compare
  it with the saved settings.
- **Access to all websites permission**: FileSender sends no CORS headers, so the add-on
  needs a broad host permission to reach any self-hosted instance. Requests only ever go
  to the instance you configured.
- **Debug logs**: enable "Detailed logs in the console (debug)" in the account settings,
  then "Inspect" the add-on from "Add-ons and Themes" and open its Console (enable
  "Persist Logs"). API keys, tokens, signatures and email addresses are always masked,
  so logs can be pasted into a bug report.
