#!/bin/sh
# Runs all automated tests. Usage: sh test/check.sh
# Node runs through a local `node` when available, otherwise a disposable
# node:24-alpine container (same fallback tools/format.sh uses for Prettier), so
# nothing needs installing on the host either way.
set -u
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
status=0

run_py() {
  printf '%-28s ' "$1"
  out=$(python3 "$here/$1" 2>&1) || status=1
  echo "$out" | tail -1
}

node_test() {
  # A fixed TAP reporter keeps the output parseable below regardless of Node
  # version or TTY detection (the default reporter's format differs between them).
  if command -v node > /dev/null 2>&1; then
    node --test --test-reporter=tap --test-reporter-destination=stdout "$@"
  else
    docker run --rm -v "$root":/work -w /work node:24-alpine \
      node --test --test-reporter=tap --test-reporter-destination=stdout "$@"
  fi
}

run_py static/static_check.py
python3 "$here/signing/gen.py" > /dev/null || status=1
python3 "$here/crypto/gen.py" > /dev/null || status=1

printf '%-28s ' "node --test (5 files)"
if out=$(node_test \
  test/static/syntax.test.js \
  test/signing/signing.test.js \
  test/crypto/crypto.test.js \
  test/request/request.test.js \
  test/background/background.test.js 2>&1); then
  pass=$(echo "$out" | grep -m1 '^# pass ' | tr -dc '0-9')
  echo "OK ($pass passed)"
else
  status=1
  echo "FAILED"
  echo "$out"
fi

printf '%-28s ' "format (tools/format.sh)"
if sh "$here/../tools/format.sh" --check > /dev/null 2>&1; then echo "OK"; else echo "FAILED (run sh tools/format.sh)"; status=1; fi
[ $status -eq 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $status
