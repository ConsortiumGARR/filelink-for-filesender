#!/bin/sh
# Renders the PNG icons in src/icons/ from the SVG source in icons/ (needs
# ImageMagick). Usage: sh tools/icons.sh
set -eu
cd "$(dirname "$0")/.."
render() {
  convert -background none -density 600 "$1" -resize "$2x$2" -gravity center \
    -extent "$2x$2" "src/icons/filesender-$2.png"
}
for size in 16 32 48 64 96 128; do
  render icons/filesender-mail.svg "$size"
done
