#!/usr/bin/env bash
# Build a private Cloudflare Pages site (app + /packs Function) into OUT (default ./out-site).
# Usage: deploy/cloudflare-pages/build_site.sh [OUT] [PACK_INDEX_URL]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
OUT="${1:-$PWD/out-site}"; INDEX="${2:-/packs/index.json}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cp -r "$REPO/src" "$REPO/vendor" "$REPO/build.py" "$REPO/assets" "$REPO/icons" "$REPO/manifest.webmanifest" "$TMP/"
(cd "$TMP" && python3 build.py --pack-index "$INDEX" >/dev/null)
rm -rf "$OUT"; mkdir -p "$OUT/site/app"
cp "$TMP/index.html" "$TMP/sw.js" "$TMP/manifest.webmanifest" "$OUT/site/"
cp "$TMP/app/cricut_print_assistant.html" "$OUT/site/app/"
cp -r "$TMP/icons" "$OUT/site/"
cp -r "$TMP/assets" "$OUT/site/assets"; find "$OUT/site/assets" -depth -type d -name private -exec rm -rf {} +
cp -r "$HERE/functions" "$OUT/"
printf '/*\n  X-Robots-Tag: noindex\n  Referrer-Policy: same-origin\n' > "$OUT/site/_headers"
echo "built $OUT (pack index: $INDEX)"
