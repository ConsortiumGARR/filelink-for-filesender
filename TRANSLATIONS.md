# Translations

This add-on is localized through the standard WebExtension i18n mechanism:
`src/_locales/<language>/messages.json`.

## Available locales

| Locale folder |     Language      |
| ------------- | ----------------- |
| `en`          | English (default) |
| `it`          | Italiano          |

Thunderbird picks the file matching its own UI language, and falls back to `en` for
anything missing.

## Adding a language

1. Copy `src/_locales/en/messages.json` to `src/_locales/<code>/messages.json`, using a
   [Chrome-style locale
   code](https://developer.chrome.com/docs/extensions/reference/api/i18n#locales) (e.g.
   `fr`, `de`, `pt_BR`).
2. Translate only the `"message"` values. Keep the JSON keys, the `"placeholders"`
   blocks and the `$NAME$` markers inside messages exactly as they are; only the
   surrounding text changes.
3. Run `python3 test/static/static_check.py` (or `sh test/check.sh`). It fails if a
   locale is missing a key the other has, or uses a `$NAME$` placeholder that is not
   declared.
4. Open the built extension in Thunderbird with that UI language and check the account
   settings, the pre-upload options window and an error message.

There is no separate translation platform: send a pull request, or a patch, with the new
`messages.json` file.
