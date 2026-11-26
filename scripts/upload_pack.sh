#!/usr/bin/env bash
# Add or update a private pack in the R2 bucket behind a private Cloudflare Pages deployment
# (see deploy/cloudflare-pages/README.md), then update the bucket's index.json so the app's
# "Sync family packs" picks it up. Re-uploading the same pack id needs a new pack.version.
#
# Usage:  scripts/upload_pack.sh path/to/name.cpapack.zip [more.cpapack.zip ...]
# Env:    CPA_BUCKET  R2 bucket name (required)
# Needs:  python3 and wrangler, signed in to your own Cloudflare account (`npx wrangler login`).
set -euo pipefail
: "${CPA_BUCKET:?set CPA_BUCKET to your private R2 bucket name}"
WR="${WRANGLER:-npx --yes wrangler@latest}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
if ! $WR r2 object get "$CPA_BUCKET/index.json" --file "$TMP/index.json" --remote >/dev/null 2>&1; then
  echo '{"schema":"cpa-pack-index/1","packs":[]}' > "$TMP/index.json"
fi
for ZIP in "$@"; do
  [ -f "$ZIP" ] || { echo "no such file: $ZIP" >&2; exit 1; }
  META="$(python3 - "$ZIP" <<'PY'
import hashlib, json, sys, zipfile, os
p = sys.argv[1]; z = zipfile.ZipFile(p); c = json.loads(z.read('pack.json'))
assert c.get('schema') == 'cpa-catalog/1', 'pack.json is not cpa-catalog/1'
pk = c['pack']; b = open(p, 'rb').read()
print(json.dumps({'id': pk['id'], 'name': pk.get('name', pk['id']), 'version': str(pk['version']), 'file': os.path.basename(p) if p.endswith('.cpapack.zip') else pk['id'] + '.cpapack.zip', 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest(), 'assets': len(c.get('assets', []))}))
PY
)"
  ID="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["id"])' "$META")"
  VER="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["version"])' "$META")"
  FILE="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["file"])' "$META")"
  KEY="$ID/$VER/$FILE"
  echo "uploading $ZIP -> $CPA_BUCKET/$KEY"
  $WR r2 object put "$CPA_BUCKET/$KEY" --file "$ZIP" --content-type application/zip --remote >/dev/null
  python3 - "$TMP/index.json" "$META" "$KEY" <<'PY'
import json, sys
path, meta, key = sys.argv[1], json.loads(sys.argv[2]), sys.argv[3]
idx = json.load(open(path)); meta['url'] = key
idx['packs'] = [p for p in idx.get('packs', []) if p.get('id') != meta['id']] + [meta]
json.dump(idx, open(path, 'w'), indent=1)
PY
done
$WR r2 object put "$CPA_BUCKET/index.json" --file "$TMP/index.json" --content-type application/json --remote >/dev/null
echo "index.json updated:"; python3 -c 'import json,sys; [print(" ", p["id"], p["version"], p.get("assets","?"), "assets") for p in json.load(open(sys.argv[1]))["packs"]]' "$TMP/index.json"
echo "Open the site and tap Assets > Sync family packs (or just reload)."
