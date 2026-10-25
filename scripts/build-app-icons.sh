#!/usr/bin/env bash
#
# Regenerate every pre-rounded icon artefact from the designer's SVGs:
#
#   src-tauri/icons/icon.svg            the 1024 squircle source (release)
#   src-tauri/icons/source/xmark-*.svg  the mark as it is drawn at 16 and 32/48 pt
#
# Outputs (all committed, so `cargo build` needs no tooling):
#   src-tauri/icons/       icon.icns, icon.png (512), 32x32/64x64/128x128/128x128@2x.png,
#                          icon.ico, Square*Logo.png, StoreLogo.png, ios/, android/
#   src-tauri/icons-dev/   the same ladder with an orange DEV badge (macOS/Windows/Linux only)
#   src/assets/app-icon.png            the About page's 48pt image (256px, @2x)
#   landing/logo.svg                   copied from the designer; the source of the site's
#                                      hero image (website/public/logo.png, 640px)
#   website/public/favicon.svg         the designer's favicon, C2PA manifest stripped
#   website/public/favicon.ico         the same mark for browsers that ask for /favicon.ico
#
# The .icns is hand-built with iconutil rather than taken from `tauri icon`, so the
# 16 and 32 point representations use the per-size variant in icons/source/: the
# chevron's stroke is widened from 14 to 16 units so the V still separates from the
# columns when the whole icon is a 24 px glyph. Every representation keeps the same
# 100/1024 gutter and 22.5% radius.
#
# Needs: rsvg-convert (librsvg), magick (ImageMagick 7) for compositing and checks,
# iconutil (macOS), python3 with Pillow (the .ico writer), pnpm (for `tauri icon`).

set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
icons="$repo/src-tauri/icons"; dev="$repo/src-tauri/icons-dev"; src="$icons/source"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

# The per-size source already carries the 100/1024 gutter and the squircle, so it
# is rendered like icon.svg rather than wrapped here.
cp "$icons/icon.svg" "$work/mark.svg"
cp "$src/xmark-16.svg" "$work/mark16.svg"
cp "$src/xmark-16.svg" "$work/mark32.svg"
cp "$src/xmark-16.svg" "$work/mark48.svg"

# SVG is rasterised by rsvg-convert directly, never through `magick file.svg`.
# ImageMagick only delegates SVG to whatever external renderer it found at build
# time; its internal fallback (MSVG) silently DROPS a stroked polyline, so the
# icons came out as two bare columns — right size, right colour, nothing to see.
# That exact failure shipped once, which is why the chevron is asserted below.
svg_to_png() { rsvg-convert --width "$2" --height "$2" "$1" -o "$3"; }

# Every rendered icon must contain the chevron: after the resample its mint has to
# cover at least 40 pixels of the canvas. A two-column render has exactly zero.
assert_chevron() {
  local mint
  mint=$(magick "$1" -alpha off -fuzz 12% -fill black +opaque "#00FFA3" -fill white -opaque black \
    -colorspace gray -format "%[fx:mean*w*h]" info:)
  if python3 -c "import sys; sys.exit(0 if float('$mint') < 40 else 1)"; then
    echo "build-app-icons: $1 has no chevron ($mint mint pixels) — the SVG renderer dropped the stroked polyline" >&2
    exit 1
  fi
}

# Render at size, then apply the squircle as an explicit alpha mask: ImageMagick's
# SVG renderer ignores `clip-path`, so the shape is cut here rather than trusted
# to the SVG. Same geometry as icon.svg: 824/1024 wide, rx 22.5% of that.
#
# `-depth 8` is load-bearing, not a size optimisation. ImageMagick renders SVG at
# 16 bits per channel and writes that out unless told otherwise, and macOS 26
# classifies a legacy .icns built from 16-bit PNGs as a non-conforming icon: it
# shrinks it and draws it inside a grey tile in the Dock. The identical artwork
# at 8 bits is accepted and drawn edge to edge with the system's glass rim.
# Measured with scripts/render-dock-icon.swift, which is how to check it again.
render() {
  local px="$2" g r
  g=$(python3 -c "print(round(100/1024*$px, 3))"); r=$(python3 -c "print(round(185/1024*$px, 3))")
  svg_to_png "$1" "$px" "$work/render-$px.png"
  assert_chevron "$work/render-$px.png"
  magick "$work/render-$px.png" \
    \( -size "${px}x${px}" xc:none -fill white -draw "roundrectangle $g,$g $(python3 -c "print(round($px-100/1024*$px-1, 3))"),$(python3 -c "print(round($px-100/1024*$px-1, 3))") $r,$r" \) \
    -compose DstIn -composite -strip -depth 8 "PNG32:$3"
  assert_8bit "$3"
  assert_rgba "$3"
}

# Tauri's generate_context! embeds the bundle.icon PNGs and panics at compile
# time on any colour type but RGBA ("icon … is not RGBA"). ImageMagick writes
# whatever is most compact unless the PNG32: prefix forces RGBA, so every writer
# here carries the prefix and every output is checked; the dev badge step once
# dropped it and broke `tauri dev` while the release set stayed green.
assert_rgba() {
  local ct; ct=$(magick identify -format "%[png:IHDR.color-type-orig]" "$1")
  if [[ "$ct" != 6 ]]; then
    echo "build-app-icons: $1 has PNG colour type $ct, not 6 (RGBA); tauri::generate_context! rejects it" >&2
    exit 1
  fi
}

# The tile failure above is silent — the file looks right in every viewer — so
# the property is asserted rather than trusted.
assert_8bit() {
  local depth; depth=$(magick identify -format "%z" "$1")
  if [[ "$depth" != 8 ]]; then
    echo "build-app-icons: $1 is ${depth}-bit; macOS 26 tiles a legacy icon built from it" >&2
    exit 1
  fi
}

# The DEV badge: an orange pill with "DEV" at the bottom-right, sized to the icon
# (45% wide, 19% tall, like the badge the previous dev set carried), so it reads
# the same at every representation.
#
# `-strip` matters here as much as in render(): without it ImageMagick embeds
# creation timestamps, and every regeneration produced byte-different dev PNGs
# with identical pixels, a spurious diff on files nothing had changed.
#
# It must stay INSIDE the squircle. The body ends 9.77% from each edge, and the
# corner arc (radius 18.07%) cuts further in than that; at a 9% offset the pill
# crossed both, and macOS 26 judged the silhouette non-conforming and drew the
# dev icon shrunk inside a grey tile. 13% keeps the pill's rounded end about 1%
# inside the arc. assert_inside_squircle() makes a regression loud instead of
# grey.
badge() { # $1 = in png, $2 = out png
  local px w h r fs off
  px=$(magick identify -format "%w" "$1")
  w=$((px * 45 / 100)); h=$((px * 19 / 100)); r=$((h / 2)); fs=$((h * 72 / 100)); off=$((px * 13 / 100))
  magick "$1" \( -size "${w}x${h}" xc:none -fill "#FF9500" -draw "roundrectangle 0,0 $((w-1)),$((h-1)) $r,$r" \
    -font /System/Library/Fonts/Helvetica.ttc -pointsize "$fs" -fill white -gravity center -annotate +0+$((h/40)) "DEV" \) \
    -gravity southeast -geometry "+${off}+${off}" -composite -strip -depth 8 "PNG32:$2"
  assert_rgba "$2"
  assert_inside_squircle "$2"
}

# Every pre-rounded artefact must have the squircle as its exact silhouette:
# nothing opaque outside the 824/1024 rounded rectangle. Erase the squircle from
# the image and demand that nothing is left. The bound is 0.5, not 0: the
# squircle's own anti-aliased edge pixels survive the erase at up to 0.25 alpha
# (measured 0.251 on the clean release shape), while anything that actually
# protrudes survives at 1.0.
assert_inside_squircle() {
  local px g r far leftover
  px=$(magick identify -format "%w" "$1")
  g=$(python3 -c "print(round(100/1024*$px, 3))"); r=$(python3 -c "print(round(185/1024*$px, 3))")
  far=$(python3 -c "print(round($px-100/1024*$px-1, 3))")
  leftover=$(magick "$1" \( -size "${px}x${px}" xc:none -fill white -draw "roundrectangle $g,$g $far,$far $r,$r" \) \
    -compose DstOut -composite -format "%[fx:maxima.a]" info:)
  if python3 -c "import sys; sys.exit(0 if float('$leftover') > 0.5 else 1)"; then
    echo "build-app-icons: $1 has opaque pixels outside the squircle (alpha up to $leftover); macOS 26 tiles it" >&2
    exit 1
  fi
}

build_set() { # $1 = out dir, $2 = "dev" | "release"
  local out="$1" kind="$2"; mkdir -p "$out" "$work/$kind.iconset"
  for spec in "16:mark16" "32:mark32" "48:mark48" "64:mark48" "128:mark" "256:mark" "512:mark" "1024:mark"; do
    local px="${spec%%:*}" m="${spec##*:}"
    render "$work/$m.svg" "$px" "$work/$kind-$px.png"
    # Loud on purpose: a badge step that fails quietly ships an unbadged dev icon
    # that is indistinguishable from the release one.
    if [[ "$kind" == dev ]]; then badge "$work/$kind-$px.png" "$work/$kind-$px.png"; fi
  done
  # iconutil's exact filenames: icon_<pt>x<pt>[@2x].png
  local s="$work/$kind.iconset"
  cp "$work/$kind-16.png" "$s/icon_16x16.png";     cp "$work/$kind-32.png"   "$s/icon_16x16@2x.png"
  cp "$work/$kind-32.png" "$s/icon_32x32.png";     cp "$work/$kind-64.png"   "$s/icon_32x32@2x.png"
  cp "$work/$kind-128.png" "$s/icon_128x128.png";  cp "$work/$kind-256.png"  "$s/icon_128x128@2x.png"
  cp "$work/$kind-256.png" "$s/icon_256x256.png";  cp "$work/$kind-512.png"  "$s/icon_256x256@2x.png"
  cp "$work/$kind-512.png" "$s/icon_512x512.png";  cp "$work/$kind-1024.png" "$s/icon_512x512@2x.png"
  iconutil -c icns "$s" -o "$out/icon.icns"
  cp "$work/$kind-32.png" "$out/32x32.png"; cp "$work/$kind-64.png" "$out/64x64.png"
  cp "$work/$kind-128.png" "$out/128x128.png"; cp "$work/$kind-256.png" "$out/128x128@2x.png"
  cp "$work/$kind-512.png" "$out/icon.png"
  # The .ico carries the hand-tuned 16/32 frames plus 48/64/256; Pillow stores the
  # frames PNG-compressed, which keeps it under 10 KB where ImageMagick's writer
  # emitted a raw 256 frame (~290 KB).
  python3 - "$out/icon.ico" "$work/$kind-16.png" "$work/$kind-32.png" "$work/$kind-48.png" "$work/$kind-64.png" "$work/$kind-256.png" <<'PY'
import sys
from PIL import Image
out, *frames = sys.argv[1:]
# Pillow takes the LARGEST frame as the base and uses an appended frame wherever
# its size is listed, so the hand-tuned small frames are kept rather than resampled.
imgs = sorted((Image.open(f).convert("RGBA") for f in frames), key=lambda im: -im.size[0])
imgs[0].save(out, format="ICO", append_images=imgs[1:], sizes=[im.size for im in imgs])
PY
}

build_set "$icons" release
build_set "$dev" dev

# Windows Square logos + iOS/Android sets: tauri's generator, from the 1024 release
# PNG, into a scratch dir — only those platform files are copied; the icns/ico/PNG
# ladder above stays authoritative.
( cd "$repo" && pnpm -s tauri icon "$work/release-1024.png" -o "$work/tauri-icons" >/dev/null )
cp "$work/tauri-icons"/Square*Logo.png "$work/tauri-icons/StoreLogo.png" "$icons/"
rm -rf "$icons/ios" "$icons/android"; cp -R "$work/tauri-icons/ios" "$work/tauri-icons/android" "$icons/"
# icons-dev carries only what tauri.dev.conf.json references (plus the 64/512 PNGs
# the release ladder also has): a dev build is never bundled for a store, and
# unbadged store logos in the dev set would just be a stale copy of the release ones.

# In-app and website assets.
cp "$work/release-256.png" "$repo/src/assets/app-icon.png"
# The website hero (`src: /logo.png` in every locale's index.md) is the designer's
# landing/logo.svg at 640px: the hero displays it at up to 320px, so this is its @2x.
svg_to_png "$repo/landing/logo.svg" 640 "$repo/website/public/logo.png"
# favicon.ico mirrors favicon.svg (the M mark, full bleed, no squircle): the .svg is
# what modern browsers load, the .ico is what the rest request by name.
for px in 16 32 48; do
  svg_to_png "$src/favicon.svg" "$px" "$work/favicon-raw-$px.png"
  magick "$work/favicon-raw-$px.png" -background none -strip -depth 8 "PNG32:$work/favicon-$px.png"
done
python3 - "$repo/website/public/favicon.ico" "$work/favicon-16.png" "$work/favicon-32.png" "$work/favicon-48.png" <<'PY2'
import sys
from PIL import Image
out, *frames = sys.argv[1:]
imgs = sorted((Image.open(f).convert("RGBA") for f in frames), key=lambda im: -im.size[0])
imgs[0].save(out, format="ICO", append_images=imgs[1:], sizes=[im.size for im in imgs])
PY2
python3 - "$src/favicon.svg" "$repo/website/public/favicon.svg" <<'PY'
import re,sys
s=re.sub(r"<metadata>.*?</metadata>","",open(sys.argv[1]).read(),flags=re.S).replace(' xmlns:c2pa="http://c2pa.org/manifest"','')
open(sys.argv[2],"w").write(s)
PY
echo "build-app-icons: wrote $icons, $dev, src/assets/app-icon.png, website/public/{logo.png,favicon.svg,favicon.ico}"
