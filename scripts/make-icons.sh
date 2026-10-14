#!/bin/sh
# Regenerates every logo asset in app/assets from scripts/make-icon.swift.
set -e
cd "$(dirname "$0")/.."
tmp="${TMPDIR:-/tmp}/autocut-icons"
rm -rf "$tmp" && mkdir -p "$tmp"
swift scripts/make-icon.swift "$tmp" 2>/dev/null
a=app/assets
# The App Store rejects icons with an alpha channel.
node_modules/ffmpeg-static/ffmpeg -loglevel error -y -i "$tmp/icon.png" -pix_fmt rgb24 "$a/icon.png"
cp "$tmp/tile.png" "$a/splash-icon.png"
sips -z 256 256 "$tmp/mark.png" --out "$a/logo-mark.png" >/dev/null
sips -z 48 48 "$tmp/tile.png" --out "$a/favicon.png" >/dev/null
sips -z 512 512 "$tmp/android-foreground.png" --out "$a/android-icon-foreground.png" >/dev/null
sips -z 512 512 "$tmp/android-background.png" --out "$a/android-icon-background.png" >/dev/null
sips -z 432 432 "$tmp/android-monochrome.png" --out "$a/android-icon-monochrome.png" >/dev/null
echo "Wrote icon, splash, logo mark, favicon and Android icons to $a"
