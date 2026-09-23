#!/bin/sh
# Builds dist/filelink-for-filesender-<version>.xpi: the content of src/ (the
# extension payload) plus NOTICE.md.
set -eu
cd "$(dirname "$0")/.."
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' src/manifest.json)
mkdir -p dist
out="$PWD/dist/filelink-for-filesender-$version.xpi"
rm -f "$out"
(cd src && zip -q -X -D -r "$out" . -x '*.DS_Store' '*~')
zip -q -X -j "$out" NOTICE.md
echo "dist/$(basename "$out")"
