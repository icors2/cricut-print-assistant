# Starter drawings

These are a few original placeholder drawings so the app and the tests can run. They are dedicated to the public domain under [CC0 1.0](LICENSE).

Add a real drawing by following the art notes in `BUILD.md` (the section for people making the images), then run:

```
node tools/build_assets.js
```

That checks the catalog and writes the thumbnails in `thumbs/`. Do not draw the thumbnails by hand.

`private/`, `*.cpapack.zip` and `*.cpapack.json` are gitignored. A private pack never goes in this folder.

## Private packs

Private art never goes in this folder. Validate a private pack folder elsewhere with:

```
node tools/build_assets.js --check --private --root /path/to/my-pack
```

`--private` allows `LicenseRef-Private` and avatar-only packs (`avatar/parts.json`), and refuses to run on folders inside this repo.
Avatar parts use the 1000 × 1500 (2 × 3 in) `templates/avatar-kid-v1.svg` artboard; see BUILD.md §4.5 and §17.4.
