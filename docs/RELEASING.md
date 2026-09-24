# Releasing

This project ships through two channels: GitHub Releases (self-hosted install, no
review, no account needed) and addons.thunderbird.net (ATN, listed, reviewed, gives
users automatic updates). Both stay in sync with the same tag and the same built `.xpi`.

## Version numbering

`src/manifest.json`'s `version` follows semver (`X.Y.Z`). Bump it by hand before every
release; nothing does this automatically (see `AGENTS.md`).

## 1. GitHub Releases (already automated)

1. Bump `version` in `src/manifest.json`, commit.
2. Tag the commit `X.Y.Z` (matching the manifest exactly) and push the tag.
3. `.github/workflows/release.yml` runs the full test suite, checks the tag matches the
   manifest version, builds the xpi with `tools/build.sh`, and publishes it as a GitHub
   release asset with auto-generated notes.

Users who installed via "Load Temporary Add-on" or "Install Add-on From File" (see
README.md) do not get automatic updates; they reinstall the new `.xpi` by hand.

## 2. addons.thunderbird.net (ATN)

### First submission

1. Build the release xpi first (step 1 above under GitHub Releases).
2. Sign in to <https://addons.thunderbird.net/developers/> and submit it there. Choose
   "On this site" (listed, auto-updating), not "On your own" (self-distribution only) --
   GitHub Releases already covers manual self-distribution. Follow the rest of the form
   for the remaining fields (listing text, categories).
3. Privacy Policy field: paste the full text of `docs/PRIVACY_POLICY.md` verbatim (ATN
   requires the complete text there, not a link).
4. Source code: not needed separately. `tools/build.sh` only zips `src/` as-is (no
   bundler, no minification), so the xpi already *is* the human-readable source, per
   <https://thunderbird.github.io/atn-review-policy/> ("Source Code Submission").
5. Background for the listing description: `docs/ATN_REVIEW_NOTES.md`.

### What to expect

Per <https://thunderbird.github.io/atn-review-policy/>, manual review is required only
if the add-on uses Experiments, or requests permission to access sensitive user data
(messages, contacts) -- neither applies here. If a reviewer requests changes, respond
within 10 days.

### Future updates

1. Do steps 1-3 under "GitHub Releases" above first (bump, tag, push -- CI builds and
   publishes to GitHub).
2. Upload the same `dist/filelink-for-filesender-<version>.xpi` as a new version of the
   existing ATN listing (not a new submission). No documented ATN API for this was
   found, so it is a manual upload through the developer hub for now.
3. Users who installed from ATN get the new version automatically; GitHub Releases users
   still update manually.
