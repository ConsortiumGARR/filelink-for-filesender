#!/bin/sh
# Generates the big fixtures in test/files/ (ignored by git) and prints their
# sha256, to compare with downloaded files. Usage: sh test/files/make_fixtures.sh
set -eu
cd "$(dirname "$0")"
chunk=5242880
head -c "$chunk" /dev/urandom > ok-5MB-exact.bin
head -c $((chunk + 1)) /dev/urandom > ok-5MB-plus-1-byte.bin
head -c $((12 * 1024 * 1024)) /dev/urandom > ok-12MB.bin
truncate -s 214748364801 too-large-200GiB.bin
truncate -s 199G ok-199GiB.bin
sha256sum ok-5MB-exact.bin ok-5MB-plus-1-byte.bin ok-12MB.bin
