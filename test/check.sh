#!/bin/sh
# Runs all automated tests. Usage: sh test/check.sh
# (the headless Chrome WebCrypto tests are skipped when Chrome is missing)
set -u
here=$(cd "$(dirname "$0")" && pwd)
status=0
run() {
  printf '%-28s ' "$1"
  out=$(python3 "$here/$1" 2>&1) || status=1
  echo "$out" | tail -1
}
run static_check.py
run jsc_run.py
run request_sim.py
run background_sim.py
python3 "$here/gen.py" > /dev/null || status=1
if command -v "${CHROME:-google-chrome}" > /dev/null 2>&1; then
  sh "$here/browser_run.sh" || status=1
else
  echo "browser_run.sh              SKIPPED (no Chrome)"
fi
printf '%-28s ' "format (tools/format.sh)"
if sh "$here/../tools/format.sh" --check > /dev/null 2>&1; then echo "OK"; else echo "FAILED (run sh tools/format.sh)"; status=1; fi
[ $status -eq 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $status
