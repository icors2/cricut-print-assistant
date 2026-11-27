# AGENT_MEMORY.md – read this first

A coding agent's long-term memory for **Cricut Print Assistant**. It holds what you need to pick up the coding with no other context: why the project exists, the rules you must not break, how to build and test, the decisions already made and why, where things stand, and what to do next.

| Doc | Use it for |
|---|---|
| **AGENT_MEMORY.md** (this file) | Purpose, invariants, conventions, decisions, status, working rules |
| [BUILD.md](BUILD.md) | **The plan**: phases P1–P4 with milestones, acceptance criteria, schemas, code skeletons and the art pipeline |
| [AGENT_HANDOFF.md](AGENT_HANDOFF.md) | A code tour of what exists today: file map, `core.js`/`app.js` sections, the test table |
| [docs/GUIDE.md](docs/GUIDE.md) | The user guide, with screenshots |
| [README.md](README.md) | The public overview |

**Keep these docs up to date in the same PR as the code:**
- the BUILD.md §14 status table;
- this file's "Current status" and "Decision log";
- AGENT_HANDOFF.md, when the structure changes.

---

## 1. Project purpose

The tool is a single offline HTML file for **Cricut print-then-cut**:
1. Lay out images on a printer sheet (Letter/A4).
2. Export a print PDF and a matching cut SVG for Design Space.
3. Correct printer drift (scale, rotation and offset) with a calibration wizard, so the printed art and the cut line up.

A **Mockup** tab lets you arrange the stickers in a scene: a dollhouse room, a planner page and so on. Each sticker can be resized, warped to fit perspective, numbered for assembly and sent back to the Layout.

**Who uses it:** a parent and a child, mostly on an iPad (Safari / Home Screen app), with a laptop driving the printer and the Cricut. The child picks and arranges stickers, recolors them and builds characters; the parent prints and cuts.

**What's next** (BUILD.md):
- P1: make the iPad experience first class (touch, PWA, offline);
- P2: an **Assets** tab with categorized preloaded art;
- P3: a **color editor**;
- P4: a **video-game style avatar builder**.

The art is made separately by the "image builders" to BUILD.md §17. The agent writes code and placeholder art only.

**Live:** https://icors2.github.io/cricut-print-assistant/ (GitHub Pages from `main`, `/`).

## 2. Invariants (never break; the tests guard most of them)

1. **Single offline file.**
   - `index.html` and `app/cricut_print_assistant.html` are self-contained: no CDN, web fonts or third-party requests.
   - jsPDF is vendored, along with its LICENSE.
   - *Amendment (BUILD.md §3.4):* same-origin fetches of `assets/…`, the service worker, and the library writes `POST /api/assets` and `PATCH /api/assets/:id` are allowed, and only when served over http(s). The file still works fully from `file://` without assets.
2. **Cut geometry.**
   - The cut canvas is the sheet minus 0.25 in per side; cut coordinates = sheet − 0.25 in anchor (Design Space places uploads 0.25 in from the mat corner).
   - Four 1 mm **pin squares** sit in the canvas corners.
   - **All cuts are one compound path.**
3. **Print PDF.**
   - The full sheet at true size, with corner marks whose outer corners are exactly the cut canvas corners.
   - Compensation scales the whole page about the centre (`printMap`).
4. **Calibration v3** (`core.js` comment block): `y = c + E(p − c)`; Q is an affine least-squares fit (`calFit`) from readings `r = cut − ink`; fits are absolute and never stacked; the cut uses `calCutCorr(cal) = Q·E`. Don't change the math.
5. **Sheet codes.**
   - `calCode(Q, ex, ey, layout)` is an FNV-1a hash of the 6-decimal values (plus `|L2` for layout ≥ 2), shown as 4 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`.
   - **Never change the hash input, the alphabet or `CAL_LAYOUT = 2`.** Layout 1 and "no code" must keep working for old printed sheets.
   - `cal.issued[code]` records what was really printed.
6. **Byte-identity.** With a frozen `Date` and `setFileId('0'*32)`:
   - Mockup moves, rotations, flips, layers, hiding, the guide and the background never change the PDF/SVG;
   - piece numbers OFF = the old output, and ON changes only the PDF;
   - Send to Layout = the equivalent hand-made layout;
   - unwarped items stay byte-identical.
   - New features (assets, recolor, avatars, touch, PWA) **must not change the exports of existing projects.**
7. **Shared sizes and the warp.**
   - A Mockup resize changes the item's real size, which changes the Layout and the cut.
   - A Mockup **warp is baked into the printed sticker**: the raster and the cut loops go through ONE `warpMap` of the base cut box, and per-copy warps split on Send.
   - Everything else in the Mockup is view-only.
8. **Print/cut alignment for every item type.** Whatever produces an item (upload, asset, recolor, avatar), the print raster and the cut contour come from the same `processed(it)`, and `mock_warp_test` style alignment checks must pass. **Recoloring never changes alpha or geometry**, so the cut SVG stays byte-identical after a colour change.
9. **Undo.** A Layout change (Send, Reset to auto-pack…) is one undo step. New actions (add asset, recolor, gesture, avatar edit) are one undo step each.
10. **Assembly steps.** `mkSteps()` numbers the visible nodes 1..N in array order (index 0 is the bottom, which goes on first). Every derived view uses it, and hiding a number keeps its step.
11. **`PRISTINE` capture** runs before any DOM change; "Save tool with calibration" depends on it. Modules must not touch the DOM before it.
12. **Public-repo privacy** (this repo is public):
    - No real people's names, emails, hostnames, IPs, tokens or local file paths.
    - No real calibration values or sheet codes from real runs. The deterministic identity codes in the tests are the only exception, as generic fixtures.
    - No naming of the user's own printer model. Generic wording like "some printers shrink about 3%" is fine.
    - No personal photos or attachments. Private art goes in git-ignored `private/` or in on-device packs.
    - Before every commit, grep the diff for these.
13. **Asset licensing.** `assets/` holds only CC0 art that is original, AI-generated by the owners, or third-party CC0, with `license`/`author`/`source` recorded in `catalog.json` (BUILD.md §18). The validator enforces this.

## 3. Conventions

- Plain ES2018+. No frameworks, bundlers or TypeScript; the only build step is `build.py`.
- `src/core.js` is pure (no DOM), so Node tests can load it.
- Code layout:
  - new features go in `src/modules/*.js` IIFEs, concatenated in `src/modules/ORDER` (BUILD.md P1·M1);
  - test hooks live on `window.CST`, and pure math on `window.CSTCore`.
- Internal units are **inches**. mm appears only at the UI/reading edges.
- Items are `{id, name, dataURL, img, wIn, hIn, qty, shape, offsetIn, border, warp, asset?}`. Add them via `addFromDataURL(name, dataURL, srcURL, isSvg, saved)`.
- UI text is short and practical, and for kids it is icons plus words. Explain *why* in tooltips, and never require a specific printer brand.
- Never hand-edit the built files (`index.html`, `app/*.html`, `sw.js`, `assets/thumbs/`). Always rebuild and commit them together with `src/`.
- Test fixtures and sample art are synthetic, and test assets are CC0 placeholders.

## 4. Run, build and test

```bash
python3 build.py                     # → index.html + app/cricut_print_assistant.html (prints the sizes)
cd test && npm install               # puppeteer-core only
./run_all.sh                         # rebuild + every test; fails fast. MUST be green before a commit
node docs_shots.js                   # regenerate docs/images/*.png when the UI changes
# later (BUILD.md): python3 build.py --bundle-assets ; node tools/build_assets.js ; node tools/serve.js
```

- **Requirements:**
  - Python 3 with Pillow;
  - Node ≥ 18;
  - Chrome/Chromium (default `/usr/bin/google-chrome`; set `CHROME=/path/to/chrome`);
  - poppler-utils (`pdftoppm`, `pdftotext`, `pdfinfo`).
- **Opening the app:** open `index.html` directly, or serve the repo root (`python3 -m http.server`) for PWA/asset work.
- **Test patterns to reuse:**
  - byte-identity: `T.frozen()` + `setFileId`, then compare base64 strings;
  - alignment: `align()` and the e2e PDF-vs-SVG check in `test/mock_warp_test.js`;
  - multi-touch: CDP `Input.dispatchTouchEvent` (BUILD.md §12).

## 5. Decision log (newest last)

| # | Decision | Why |
|---|---|---|
| D1 | One self-contained offline HTML file, with jsPDF vendored | Works anywhere, with no server or install, and can be emailed or AirDropped |
| D2 | Cut SVG anchored 0.25 in from the mat corner, with pin squares and one compound path | Design Space keeps the exact size and position and uploads one layer |
| D3 | Calibration model v3: an affine Q fit plus print compensation E, with absolute refits | Printers shrink, rotate and shift. The fits are stable and never compound errors |
| D4 | Sheet codes (FNV-1a → 4 characters) with `cal.issued` | Readings are always interpreted against the sheet that was really printed |
| D5 | `CAL_LAYOUT = 2` (0.875 in squares, ±8 mm scales); layout 1 kept for old sheets | Easier to read; supports larger drift |
| D6 | Generic printer language in the UI and docs | It's a public tool, so don't imply one brand is required |
| D7 | The Mockup is view-only, except shared sizes | The scene can't break a print job by accident |
| D8 | Assembly steps from layer order (#1 = bottom), with hideable numbers | Gives the order to stick, even with overlaps |
| D9 | Collapsible Mockup panels; file save plus IndexedDB named saves plus autosave | Less clutter on small screens; durable work |
| D10 | **The warp is baked into the printed sticker** (the user's choice), with per-copy warps split on Send | Pieces in perspective must print and cut warped, not only preview |
| D11 | MIT for the code, and a public GitHub repo with Pages | Easy sharing; the Pages URL works on an iPad |
| D12 | Next work = BUILD.md P1–P4; an **agent codes, people make the art** | Parallel tracks; the art spec decouples them |
| D13 | Assets are fetched same-origin from `assets/` (service-worker cached), plus an optional `--bundle-assets` single file | Keeps `index.html` small and still has a fully offline single-file option |
| D14 | Assets, recolors and avatars become normal items, with `it.asset` metadata and SVG data URLs | They reuse the proven print/cut/warp/steps pipeline, so there's no new export code |
| D15 | Recolor changes paint only (region fills / masked tint), never alpha | The cut stays identical, and the alignment is guaranteed |
| D16 | Private packs (`.cpapack.zip/json`) stay only in IndexedDB or the git-ignored `private/` | Family or personal art never reaches the public repo |
| D17 | CC0-only public art, with provenance recorded in the catalog | No licence risk in a public repo |
| D18 | Build locally, in small PRs; no cloud agents for this repo | Keeps control of the privacy scrub and of the tests |
| D19 | Modules load in the same script as `app.js`, after `window.CST` is assigned | `bus.js` needs `CST` immediately, and `PRISTINE` is already captured at the top of `app.js` |
| D20 | The canvas budget and import downscale apply only on a coarse pointer or when big targets are on | Desktop exports stay byte-identical; an iPad gets a lower dpi instead of a crashed tab |
| D21 | Kid mode is on by default only for a coarse pointer, and it only hides tabs | Layout, Calibrate and How to come back after a 2 second hold. It is a guardrail, not a lock |
| D22 | Remote pack sync (`remote_packs.js`) is off unless the build sets `<meta name="cpa-pack-index">` (`build.py --pack-index`) or localStorage `cst.packIndex`; same-origin only; skips packs by id + version; verifies bytes/sha256; imports through the normal pack import | Lets a private deployment (deploy/cloudflare-pages) auto-load family packs behind a sign-in, while the public build makes no extra requests |
| D23 | The service worker reloads the page on `controllerchange` only when a previous worker controlled it | The first install's `clients.claim()` also fires it, which reloaded the first visit mid-use (and raced the headless tests) |
| D24 | The Avatar tab stays hidden. `avatar.js` still loads | A full part set is more work than the library needs right now. A sticker that was already composed still prints |
| D25 | The deployed library lives in R2. The extractor writes it with `ASSET_WRITE_TOKEN`. No accounts (amends the "no server" line in BUILD.md for this one same-origin write) | One household shares one catalog. A login system is more than that needs. Private pictures stay out of the bucket; an imported `.cpapack` still stays on the device |
| D26 | Assets has a Characters category, and the Mockup Images ✕ removes that picture from the shared list, the scene, and the Layout. Undo restores the picture and its placed copies | Characters is where people file people and animals. The Images list had no way to drop a picture, so a leftover stayed on the sheet |
| D27 | An imported pack can be copied into the R2 library with the write token (amends D25) | `tools/make_pack.js` builds the zip. My packs → Save to library posts each picture. The files stay out of git. A read of the library does not ask for the token, so the pictures are visible to anyone with the site |

Add new rows when you make a design decision, with the reason, and never rewrite old rows. If you reverse a decision, add a new row that refers to the old one.

## 6. Current status

- `main` @ `77a82f8` (+ this docs commit):
  - all features in README/AGENT_HANDOFF;
  - the warp prints;
  - the Mockup panels collapse;
  - saves.
- The milestone tests for P1–P4 pass in headless Chrome. Re-run `test/run_all.sh` on a machine with Pillow, NumPy and poppler before a release.
- BUILD.md §14: P1–P4 code is done. The Avatar tab is hidden (D24). P2·M7 saves an extracted sticker to the shared library (D25), including a Characters category. The Mockup Images ✕ removes that picture from the list, the scene, and the Layout (D26). `tools/make_pack.js` builds a private pack, and My packs → Save to library copies it into R2 (D27). Still open: at least 30 real catalog assets and the physical iPad checklist (§12.3).
- `src/modules/` loads through `src/modules/ORDER`: bus, touch, pwa, assets, recolor, avatar, extract, the UI modules, and `remote_packs.js` (optional pack sync, off in the public build).
- `deploy/cloudflare-pages/` has an optional private deployment (Pages + private R2 bucket + Access, with a fail-closed `/packs` Function) and `scripts/upload_pack.sh` adds packs to it. The shared sticker library is a separate Worker (`worker/index.js`, `wrangler.jsonc`); `node tools/seed_r2.js --put` uploads the starter catalog. Never commit real pack files, bucket contents, emails, tokens or account IDs.
- `assets/` holds five original CC0 placeholders, palettes, and a few avatar parts. Avatar parts are on the 1000 × 1500 kid-v1 artboard; `avatar.js` supports per-source templates and `follows`, and `assets.js` merges avatar parts/presets/palettes from imported packs (`test/avatar_pack_test.js`). `tools/build_assets.js --private --root <outside folder>` validates private packs. Raster (PNG) parts, per-body `canvas` {px, dpi}, `bodies`/`exclusive` body-specific clothing: `test/avatar_raster_test.js`. `sw.js` is generated. Do not hand-edit `index.html`, `app/*.html`, `sw.js`, or `assets/thumbs/`.

## 7. Where to start

1. Read BUILD.md §1–§3 and the status table in §14.
2. The code for P1–P4 is in. The Avatar tab is paused. The next human jobs are the art counts (P2·M6.2) and the iPad checklist in §12.3. The library deploy is `wrangler.jsonc` plus `node tools/seed_r2.js --put`.
3. New behaviour goes in `src/modules/`. Rebuild with `python3 build.py`. Projects that have no asset must stay byte-identical.

## 8. Working rules for agents

- **Small PRs:** one milestone, or part of one, per PR. Use the title `P1·M2: two-finger resize/rotate`.
- **Tests stay green:**
  - run `test/run_all.sh` before every commit;
  - add the milestone's tests with the code;
  - never relax a byte-identity or alignment test to make it pass. Fix the code instead.
- **Rebuild and commit** the built files with every `src/` change.
- **Update the docs** in the same PR:
  - the BUILD.md §14 status;
  - this file's §5/§6;
  - AGENT_HANDOFF.md (file map, sections, test table);
  - README/GUIDE for user-visible changes, with `node docs_shots.js`.
- **Privacy scrub before every push.** Grep the diff for real names, emails, hostnames/IPs, tokens, local paths, real calibration values/codes and printer models. Never commit `private/`, backups, `node_modules`, browser profiles or user attachments.
- **Scope:** follow BUILD.md. If a change in scope is needed, edit BUILD.md first (with a decision-log row), then the code.
- If something is ambiguous, pick the option that keeps print/cut behaviour unchanged, write it down in the decision log and move on.
- **Don't add runtime dependencies.** Dev dependencies go in `test/package.json` only (puppeteer-core today).
