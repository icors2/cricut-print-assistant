# Agent handoff – Cricut Print Assistant

Notes for the next developer or coding agent. Read this before changing anything.

> **Start with [AGENT_MEMORY.md](AGENT_MEMORY.md)** (purpose, invariants, decisions, status, working rules), then follow the plan in **[BUILD.md](BUILD.md)** (Assets tab, color editor, avatar builder, iPad/PWA). This file is the code tour. The tool is used for real print-and-cut jobs, so the cut geometry, calibration math and sheet codes must keep their current behaviour.

## What it is

A single, self-contained, offline HTML file. It lays out images on a printer sheet, then exports:

- a print PDF made with the embedded jsPDF;
- a matching cut SVG for Cricut Design Space.

It also holds a print/cut calibration, a view-only Mockup, an asset library and a colour editor. The avatar builder is still in the file, and its tab is hidden. The downloaded file makes no network calls. The web version loads `assets/` from the same site and can install a service worker. On the Cloudflare deploy, that `assets/` prefix is the R2 library, and Extract from a picture can add to it.

## File map

```
build.py                    # inlines everything into index.html + app/cricut_print_assistant.html
src/modules/ORDER            # module load order (one file name per line)
src/modules/*.js             # bus, touch, pwa, assets, recolor, avatar, extract, and the tab UIs
src/sw.template.js           # service worker source; build.py writes sw.js
worker/index.js              # Cloudflare Worker: R2 library reads and token-gated writes
wrangler.jsonc               # Worker config. No account id and no token in this file
assets/                      # catalog, palettes, placeholder art, avatar parts (CC0)
tools/build_assets.js        # catalog validator and thumbnail renderer
tools/seed_r2.js             # copy the starter catalog into the library bucket
tools/make_pack.js           # folder of PNG/JPG files → a private .cpapack.zip
tools/serve.js               # localhost static server for PWA and asset tests
index.html                  # BUILT (GitHub Pages entry point). Don't edit by hand.
app/cricut_print_assistant.html   # BUILT, identical copy for download
app/cricut_print_assistant_bundled.html  # BUILT with python3 build.py --bundle-assets
sw.js                       # BUILT from src/sw.template.js. Don't edit by hand.
src/template.html           # markup + CSS; placeholders /*JSPDF*/ /*CORE*/ /*APP*/ <!--HOWTO-->
src/core.js                 # pure math, no DOM: window.CSTCore (also loadable in Node via globalThis)
src/app.js                  # UI, state, persistence, exports, wizard, mockup; test hooks on window.CST
src/howto.html              # the "How to print & cut" tab
vendor/jspdf.umd.min.js     # jsPDF 2.5.2 (MIT, minified UMD build)
vendor/LICENSE              # jsPDF MIT license; build.py inlines it as a comment banner
docs/GUIDE.md, docs/images/ # user guide; screenshots from test/docs_shots.js
test/                       # Node + headless Chrome tests, sample generators, run_all.sh
sample_output/              # test output (git-ignored, kept with .gitkeep)
```

### core.js sections

- `edt`: Euclidean distance transform (Felzenszwalb–Huttenlocher) with a nearest-feature index, used for the contour offset and the bleed colours.
- Mask helpers (`fillHoles`, `dropSmallComponents`), `marchingSquares`, and `simplifyClosed`/`rdp`, which turn a mask into smooth closed loops.
- `processItem(src, o)`: raster, then cut loop + bleed image for one image. `rotateProcessed` turns it by 90°.
- `packAll`: MaxRects bin packing (best short side fit) across several sheets.
- Calibration:
  - legacy `makeCorrector`/`fitLinear`/`fitMachine`;
  - v3 model `calDefault`, `calFit`, `calCutCorr`, `printMap`, `calCode`, `readingPattern`, `suggestFixes`, `rulerShrink`, `judgePass`.
- `buildCutSVG(sheet, inset, anchor, cutLoops, meta)`.

### app.js sections (in file order)

- Persistence: `STORE` is localStorage with a memory fallback, mirrored to sessionStorage/window.name. Keys: `cst.settings`, `cst.cal.<sheet>`, legacy `cst.corr.<sheet>`, `cst.draft.<sheet>`, `cst.mockup`.
- Saves:
  - `projectData(kind)` builds the one file format, with images as data URLs. `applyProject(d, {settings, cal})` restores it; `loadProject` is the full version.
  - The Mockup **Save work** panel has:
    - a file save/open (`mkSaveFile`, `mkOpenFile`), which keeps this browser's settings and calibration;
    - named saves in IndexedDB `cst-mockups`, with stores `meta` (name, time, counts, thumbnail) and `data` (the project object);
    - an autosave record `__auto` plus a matching `cst.mkAuto` stamp in localStorage. The restore only runs when both match and no images are loaded, so tests that clear localStorage start fresh.
  - Collapse state is `S.mkCol` (settings); `mkPanelSum` builds the summaries.
- Units.
- Image loading.
- Processing & layout.
- Manual placement (pins).
- Export: `buildPDF`, cut SVGs.
- Optional piece numbers: `pieceLabels` uses `cutStepLabels(layout)` (the mockup's assembly steps) or falls back to `numOf`.
- Calibration (targets, sheets, readings).
- Wizard UI.
- Preview.
- UI wiring.
- Undo/redo.
- Interactive canvas.
- Mockup, including:
  - the background image: `mkBgRect`, `renderMkBg`, `mkBgToBackdrop`;
  - assembly steps: `mkSteps`, `legendRows`, `mkNumPos`, and the per-node `noNum` flag plus `MK.num = { show, size }`.
  - Transform: `n.warp = { sx, sy, q[4] }` per copy, in the piece's base (unwarped) box frame. It is baked into the printed sticker through the image's `it.warp`.
    - `warpQuad`/`warpMap` give a projective square→quad map. `nodePath` is the warped outline, used for drawing, hit-testing and badge spots.
    - `drawWarped` is the mesh render (affine per triangle, `growTri` overlap). The Guide PDF maps its outline through `warpMap`.
    - Handles: `mkWarpHandles`/`mkWarpAt`/`mkWarpDrag`. Transform mode is `mkXf`.
    - Printing: `processed(it)` is what prints and cuts. For a warped image, `core.warpProcessed` resamples the unwarped print raster at print dpi through the inverse homography (`warpMap(...).inv`, bilinear, premultiplied). It maps the flattened cut loops through the forward map and re-bases to the warped bbox.
    - `processedBase(it)` is the unwarped box the Mockup uses (`ng`). Cache key = `procKey` + warp; the old warped entry for an image is evicted.
    - `syncItemWarps()` (called in `mkCommit`, `mkApply` and every `refresh`): `it.warp` = the warp most of the image's copies share (ties: the lowest layer). Images without copies keep theirs.
    - `mkSendPlan` groups copies by warp. Extra groups go to `plan.splits` and `mkSendApply` clones them into "name (warped N)" / "name (unwarped)" items. `nodeItem` falls back from such a name to the base image.
- Send to Layout: `mkSendPlan`, `mkSendOpen`, `mkSendApply`.

Everything the tests need is exposed on `window.CST`.

## Build pipeline

`python3 build.py` reads `src/template.html` and replaces its placeholders with:

- `vendor/LICENSE` as a comment + `vendor/jspdf.umd.min.js`, with the sourceMappingURL stripped. It asserts that no inlined body contains `</script`;
- `src/core.js`;
- `src/app.js`;
- `src/modules/*.js`, concatenated in the order listed in `src/modules/ORDER` (one file name per line, `#` comments) into the `/*MODULES*/` placeholder in the same script, right after `/*APP*/`. The build fails if a file in `src/modules/` is not listed, or a listed file is missing;
- `src/howto.html`.

It writes the result to `index.html` and to `app/cricut_print_assistant.html`, then writes `sw.js` (cache name `cpa-` plus a hash of `index.html` and `assets/catalog.json`). `python3 build.py --bundle-assets` also writes `app/cricut_print_assistant_bundled.html` with the catalog inlined. `index.html` must stay under 800 KB. Always rebuild and commit the built files with any `src/` change; GitHub Pages serves `index.html` from `main`.

"Save tool with my calibration built in" saves the page's pristine source with a `<script id="cstEmbedded" type="application/json">` block added. Don't break `PRISTINE` capture: it must run before anything changes the DOM.

## Key invariants (don't break)

1. **Cut SVG geometry.** The canvas is the sheet minus `S.inset` = 0.25 in per side, so 8 × 10.5 in on Letter. The cut coordinates are sheet coordinates minus the 0.25 in anchor, because Design Space places an upload with its top-left 0.25 in from the mat corner. Four 1 mm **pin squares** sit in the canvas corners so Design Space keeps the exact size and position. All cuts, pins included, are **one compound path**, so it uploads as one layer.
2. **Print PDF:**
   - the full sheet at true size;
   - four corner marks whose outer corners are exactly the cut canvas corners (8.000 × 10.500 in on Letter, ruler check);
   - bleed images under the art.
   - Print compensation scales the whole page about the sheet centre: `printMap(ex, ey, cx, cy)`. The corner marks are scaled too, so with compensation the PDF marks measure e.g. 8.205 × 10.801 in, and the paper shows true size.
3. **Calibration model v3** (comment block in `core.js`):
   - design position `p` → print file position `y = c + E(p − c)`, with `E = diag(ex, ey)`;
   - `Q(y)` = where the printer actually puts `y`, as seen by the cutter. It's an affine fit (least squares, `calFit`) from readings `r = cut − ink`, so `Q(y_i) = f_i − r_i`. Fits are absolute and never stacked: pass 2 refits from the issued sheet's own Q/E;
   - the cut file uses `calCutCorr(cal)` = Q·E;
   - option (a) "compensate" sets `E = 1/scale(Q)`;
   - `judgePass` returns the verdict, misfits, a flagged target, and swap/sign-flip detection via `suggestFixes`.
4. **Sheet codes:**
   - `calCode(Q, ex, ey, layout)` is an FNV-1a hash of the 6-decimal values (plus `|L2` for layout ≥ 2), shown as 4 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`;
   - each issued sheet is recorded in `cal.issued[code]` with its Q/E/layout, so readings are always interpreted against the sheet that was really printed;
   - **Keep `CAL_LAYOUT = 2`**: 0.875 in squares at inset + 0.9 in, ±8 mm scales. Layout 1 (0.5 in squares at inset + 0.75, ±4 mm) and "no code" must keep working for old sheets. The 'none' code uses layout 1;
   - never change the hash input format or the alphabet. Existing printed sheets would stop matching. The identity codes `KGKF` (layout 1) and `EMQ2` (layout 2) are deterministic and appear as fixtures in the tests.
5. **Byte-identity guarantees** (tests freeze `Date` and call `setFileId('0'*32)`):
   - Mockup moves, rotations, flips, layers, hiding, the guide and the background never change the print PDF or cut SVGs (`mock_test`, `mock_bg_test`).
   - Piece numbers OFF gives byte-identical output to the old behaviour. Numbers ON changes only the PDF, never the SVG.
   - Send to Layout gives the same exports as the equivalent hand-made layout (`mock_send_test`).
   - Hand-placed pins export exactly where they were dropped (`drag_test`).
6. **Sizes are shared:** a mockup resize changes the item's real size, so the Layout and the cut change too. That's intended. The Mockup **warp** also carries into the print and the cut (invariant 10). Everything else in the Mockup is view-only.
7. **Undo:** a Layout-tab change, including Send to Layout and Reset to auto-pack, is one undo step.
8. **Single offline file:** no CDN, fonts or fetches. Images are read with FileReader; downloads use Blob URLs.
9. **Assembly steps:**
   - `mkSteps()` numbers the visible `MK.nodes` in array order. Index 0 is the bottom layer, drawn first. So #1 goes on first, every copy gets its own step, hidden layers get none, and the steps are always 1..N.
   - The Layers list, the Selected panel, the canvas badges, the Guide PNG/PDF and their legends, the Layout card badges (`mkCardNums`) and the printed piece numbers all derive from it.
   - Printed labels (`cutStepLabels`): copies of one image take its ascending steps in reading order (sheet, then `round(y·10)`, then x). Pieces beyond the mockup copies get `sp`. With no visible step, it falls back to the image number.
   - Hiding a number (`noNum`, or `MK.num.show = 'none'`) only removes the badge. The step stays reserved and stays in the legend.
   - None of this touches the cut SVG or the sheet code.
10. **Warp is baked into the print and the cut with ONE mapping.** The raster and the loops must both go through `warpMap` of the base cut box; `mock_warp_test` checks the alpha edge against the contour, and the exported PDF against the SVG. Unwarped images must stay byte-identical (bake only when `isWarped(it)`). The warp never touches calibration, sheet codes or anchors.

## Tests

You need Python 3 with Pillow (for the generators), Node ≥ 18, Google Chrome/Chromium (default `/usr/bin/google-chrome`; set `CHROME=/path`), and poppler-utils (`pdftoppm`, `pdftotext`, `pdfinfo`).

```bash
cd test && npm install          # puppeteer-core only
./run_all.sh                    # build + every test, fails fast
node docs_shots.js              # regenerate docs/images/*.png
```

| Test | Checks |
|---|---|
| `sim_cal.js`, `sim_wizard.js` | Pure-math simulations of a made-up printer: the fit recovers shrink, rotation and offset; the wizard flow converges in 2 passes; ruler shrink |
| `run_test.js` + `verify.py` | Full layout → PDF/SVG export; verify.py rasterizes and checks cut/print alignment, the pin squares and the SVG size |
| `cal_ui_test.js`, `check_comp_pdf.py` | The wizard UI end to end with synthetic readings; the compensated PDF scale |
| `cal_safeguard_test.js`, `cal_swap_test.js`, `cal_scale_test.js` | Stale codes, swapped X/Y detection, old-state migration, ±8 mm scales |
| `persist_test.js`, `proj_test.js` | Storage, export/import, the embedded calibration, project save/open |
| `drag_test.js` | Hand placement, snapping, undo, pins in exports |
| `mock_test.js`, `mock_resize_test.js`, `mock_bg_test.js`, `mock_send_test.js` | The Mockup and its byte-identity guarantees. `mock_test.js` also checks that the Images ✕ removes a picture and Undo puts it back |
| `mock_steps_test.js` | Assembly-step numbering, number hiding (view/PNG/PDF), undo/persist, cut-sheet labels = guide steps |
| `mock_warp_test.js` | Transform: corner distort / side skew / typed skew, warped render (pixels), Guide PDF + PNG outlines follow the warp. Layout takes the warp live (cut size = warped bbox). Print raster vs cut path aligned (processed alpha vs loops for rect + contour pieces; exported PDF render vs cut SVG). Other images byte-identical; Reset gives byte-identical exports; undo/redo; per-copy warps split on Send to Layout (and Layout undo); saves |
| `mock_save_test.js` | Collapsible Mockup panels; file save → fresh page → open gives an identical state and exports; IndexedDB named saves, Ctrl+S, rename/delete; image autosave across reloads; low-storage warning |
| `modules_test.js` | Module registry and event bus; `items:changed` after refresh; a module left out of `ORDER` fails the build |
| `touch_test.js` | Two-finger pinch and twist, one undo step, 44 px targets; a gesture matches a mouse edit |
| `pwa_test.js` | Manifest, service worker on localhost, offline reload, cache purge; no registration on file://; Add to Home Screen is hidden from a file and shows the iPad steps when served |
| `ipad_quirks_test.js` | Share-or-download, canvas budget, storage banner, HEIC message |
| `assets_validator_test.js` | Each broken catalog fails for its own reason |
| `assets_loader_test.js` | file:// does not fetch; http loads the catalog; the bundle inlines it |
| `assets_ui_test.js` | Category order, search, details, kid mode, 500-tile paint |
| `assets_add_test.js` | Catalog size, a second copy is a node, project `asset` field, cut alignment |
| `packs_test.js` | A private zip imports into IndexedDB and is not a git file |
| `make_pack_test.js` | A folder of pictures becomes a valid pack, and Save to library posts one PNG |
| `recolor_test.js` | Paint-only recolor; alpha and cut loops unchanged |
| `color_ui_test.js` | Cut SVG byte-identical, PDF changes, undo, PNG tint, seeded Surprise |
| `avatar_compose_test.js` | Pairs, hides, swap, prefixed ids, locked randomize |
| `avatar_ui_test.js` | The Avatar tab stays hidden; the compositor is still loaded |
| `avatar_export_test.js` | One 2×3 in contour sticker, alignment, in-place edit |
| `extract_test.js` | Knockout, a valid library entry, a mocked save, and the Worker against a fake bucket, including Characters on an older catalog |
| `shot.js` | UI screenshots for a quick visual check (`sample_output/`) |

Sample generators: `make_samples.py` (stickers), `make_scene.py` (mockup scene), plus the committed background test images in `samples/bg/`. All the art is made up.

## Known limitations

- Contour cuts follow the image's transparency (alpha). Images without transparency (JPGs, opaque PNGs) are cut as their rectangle, so use Rectangle/Rounded rect for them.
- One cut operation (Basic Cut). No score or draw layers.
- The calibration is per browser and sheet size. It needs export/import to move between computers, and browsers may drop storage for `file://` pages.
- Design Space's UI changes over time. The 0.25 in placement has stayed stable, but if Cricut changes it, the anchor must change too.
- Very large images at 300 dpi can be slow to process, since everything is on the main thread.
- Browser saves and the autosave hold every image, so they can be large. IndexedDB quotas differ per browser, and some browsers (or private windows) may evict or refuse them. The file save is the durable option.

## Ideas backlog

- Web Worker for `processItem`.
- Leader lines/callouts that move crowded guide numbers into a margin, and "hide numbers in a selection box" (today: per-piece # toggles, Numbers: None, the size slider).
- Score/draw layers (a separate SVG per operation).
- Kiss-cut sheet outline option.
- More paper presets and custom sizes in the UI.
- PWA install / offline cache for the Pages version: planned in [BUILD.md](BUILD.md) P1·M3, along with the Assets tab, color editor and avatar builder.
- A localisation layer for the UI strings.
- An optional calibration report PDF.

## Conventions

- Plain ES2018+, no frameworks and no build step besides `build.py`. Keep `core.js` free of DOM access so Node tests can load it.
- Internal units are inches. mm appears only in the UI and in readings, converted at the edges.
- UI text is short and practical. Explain *why* in tooltips. Never mention a specific printer brand as a requirement.
- Every behaviour change gets a test in `test/`. Run `./run_all.sh` before committing and commit the rebuilt `index.html` + `app/…html`.
- Test fixtures are synthetic: made-up printer parameters, generated sample art. Don't commit real user calibration data, photos or personal paths.
