#!/bin/sh
# Formats the code: black and ruff (lint only) for Python, Prettier for the
# extension's JS/HTML/JSON/CSS. Usage: sh tools/format.sh [--check]
# Prettier runs through a local npx when available, otherwise in a Docker
# node container (npm cache kept in ~/.cache).
set -u
cd "$(dirname "$0")/.."
PRETTIER=prettier@3.9.9
status=0
if [ "${1:-}" = "--check" ]; then
  black --check -q . || status=1
  mode=--check
else
  black -q .
  mode=--write
fi
ruff check -q . || status=1

prettier() {
  if command -v npx > /dev/null 2>&1; then
    npx --yes "$PRETTIER" "$@"
  elif command -v docker > /dev/null 2>&1; then
    cache=${XDG_CACHE_HOME:-$HOME/.cache}/filelink-for-filesender-npm
    mkdir -p "$cache"
    docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/npm-cache \
      -e npm_config_update_notifier=false \
      -v "$cache":/npm-cache -v "$PWD":/work -w /work node:22-alpine \
      npx --yes "$PRETTIER" "$@"
  else
    echo "prettier: skipped (neither npx nor docker available)"
  fi
}
prettier --log-level warn "$mode" 'src/**/*.{js,html,json,css}' || status=1
exit $status
