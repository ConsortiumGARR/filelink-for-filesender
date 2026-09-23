#!/bin/sh
# Runs the signing and encryption test pages in headless Chrome (real WebCrypto).
# Usage: sh test/browser_run.sh   (regenerate the pages first: python3 test/gen.py)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
chrome=${CHROME:-google-chrome}
profile=${TMPDIR:-/tmp}/filelink-for-filesender-chrome-profile
mkdir -p "$profile"
status=0
for page in sign-test.html crypto-test.html; do
  line=$("$chrome" --headless=new --disable-gpu --no-sandbox --user-data-dir="$profile" \
    --virtual-time-budget=30000 --dump-dom "file://$here/$page" 2>/dev/null \
    | grep -o '<div id="summary"[^>]*>[^<]*' | sed 's/.*>//')
  echo "$page: ${line:-NO RESULT}"
  case "$line" in "ALL PASS"*) ;; *) status=1 ;; esac
done
exit $status
