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

Thunderbird does not require add-ons to be signed, so the `.xpi` can be installed
permanently without going through addons.thunderbird.net:

1. Download `filelink-for-filesender-<version>.xpi` from the
   [releases page](https://github.com/ConsortiumGARR/filelink-for-filesender/releases).
2. In Thunderbird, open "Add-ons and Themes" (Ctrl+Shift+A).
3. Gear menu (top right) -> "Install Add-on From File..." and pick the `.xpi` file.
4. Accept the permissions prompt:

   <p align="center">
     <img src="docs/images/install-permissions.png" alt="Permissions prompt" width="380">
   </p>

   - **Access your data for all websites**: the `https://*/*` host permission.
     FileSender is self-hosted and sends no CORS headers, so the add-on needs a broad
     permission to reach whichever instance you configure; it only ever contacts that
     one instance.
   - **Read and modify your email messages as you compose and send them**: the
     `compose` permission, used only to know whether a mail was sent, saved or
     discarded, so that transfers left over from a discarded mail are deleted from
     FileSender. The add-on never reads or modifies the mail content.
   - **Display notifications to you**: used for information you don't have to act on,
     such as an upload option the server did not apply. Anything you must decide on
     opens a window instead.

Unlike a temporary add-on, this install survives a Thunderbird restart; to update, just
repeat these steps with the new `.xpi`.

## Configuration

1. Settings -> Composition -> "Attachments" -> "Add FileSender". Click the new entry's
   name to rename it, e.g. if you configure more than one FileSender instance.
2. Select the account in the list: the settings page opens on the right.

   <p align="center">
     <img src="docs/images/account-settings.png" alt="Account settings page" width="480">
   </p>

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
