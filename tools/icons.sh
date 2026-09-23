#!/bin/sh
# Renders the PNG icons in src/icons/ from the SVG sources in icons/ (needs
# ImageMagick). The 16 px icon uses the plain folder: at that size the envelope
# badge would be an unreadable dot. Usage: sh tools/icons.sh
set -eu
cd "$(dirname "$0")/.."
render() {
  convert -background none -density 600 "$1" -resize "$2x$2" -gravity center \
    -extent "$2x$2" "src/icons/filesender-$2.png"
}
render icons/filesender.svg 16
for size in 32 48 64 96 128; do
  render icons/filesender-mail.svg "$size"
done
