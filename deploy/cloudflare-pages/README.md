# Private Cloudflare Pages deployment (optional)

The public build works anywhere with no server. This folder adds an **optional** private
deployment for families who want their own sticker packs to load automatically on every
device, behind a sign-in:

- **Cloudflare Pages** hosts the built app (direct upload, not a Git connection, so private
  art never touches a repository).
- **R2** holds the private packs. The bucket stays private (no public `r2.dev` URL).
- A **Pages Function** (`functions/packs/[[path]].js`) serves the bucket same-origin at
  `/packs/*`. It checks the Cloudflare Access token itself and **fails closed**, so packs are
  never served without a valid sign-in, even if the Access app is removed.
- **Cloudflare Access** (Zero Trust, free plan) puts an email one-time-PIN sign-in in front of
  the whole site, preview URLs included.
- The app is built with `--pack-index /packs/index.json`, which turns on **Assets → ⟳ Sync
  family packs** and a quiet auto-sync on start. Packs already imported at the same version
  are skipped; imported packs live in IndexedDB and work offline.

## Pack index (`index.json` at the bucket root)

```json
{ "schema": "cpa-pack-index/1",
  "packs": [
    { "id": "mypack", "name": "My pack", "version": "1.0.0", "file": "mypack.cpapack.zip",
      "bytes": 123456, "sha256": "…", "url": "mypack/1.0.0/mypack.cpapack.zip" },
    { "id": "big", "version": "2.0.0", "file": "big.cpapack.zip", "bytes": 9000000, "sha256": "…",
      "parts": ["big/2.0.0/big.cpapack.zip.000", "big/2.0.0/big.cpapack.zip.001"] } ] }
```

`url` and `parts` are relative to the index. `parts` are concatenated in order (useful when an
upload path limits object size). `bytes` and `sha256` are checked before import. To ship an
update, bump `pack.version` in the pack's `pack.json`.

## Steps

1. `npx wrangler login` (your account), then create the bucket: `npx wrangler r2 bucket create YOUR-BUCKET`.
2. Upload packs: `CPA_BUCKET=YOUR-BUCKET scripts/upload_pack.sh path/to/*.cpapack.zip`.
3. Build: `deploy/cloudflare-pages/build_site.sh out-site` → `out-site/site` + `out-site/functions`.
4. Copy `wrangler.toml.example` to `out-site/wrangler.toml`, fill in the project and bucket
   names, then `cd out-site && npx wrangler pages project create YOUR-PROJECT --production-branch main`
   and `npx wrangler pages deploy`.
5. Zero Trust → Access → Applications → **Add a self-hosted application** covering
   `YOUR-PROJECT.pages.dev` and `*.YOUR-PROJECT.pages.dev`; policy **Allow** → *Emails* → your
   family's addresses; login method **One-time PIN**. Copy the app's **AUD tag** and your team
   domain into `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN`, and redeploy.
6. On the iPad: open the site in Safari, sign in with the emailed code, then Share → **Add to
   Home Screen**.
