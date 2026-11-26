# Third-party notices

The built files (`index.html`, `app/cricut_print_assistant.html`) inline the following third-party code. Nothing else is bundled, and the app loads nothing from the network.

## jsPDF 2.5.2

- Source: https://github.com/parallax/jsPDF
- File: `vendor/jspdf.umd.min.js` (unmodified upstream UMD build; only the `sourceMappingURL` comment is stripped at build time)
- License: MIT. The full text is in [`vendor/LICENSE`](vendor/LICENSE) and is also copied into the built HTML right above the inlined library.

```
Copyright
(c) 2010-2021 James Hall, https://github.com/MrRio/jsPDF
(c) 2015-2021 yWorks GmbH, https://www.yworks.com/
```

The minified jsPDF build contains code from several contributors and embedded libraries. Their original `@license` / copyright comment headers are preserved inside `vendor/jspdf.umd.min.js` (and therefore inside the built HTML), as the jsPDF distribution ships them. They include:

- the fflate compression library (MIT, © Arjun Barrett), bundled by jsPDF 2.x;
- a JPEG encoder ported from Adobe's AS3 code (BSD-style license, © 2008 Adobe Systems Incorporated; its full notice is kept in the file);
- an RGB colour parser by Stoyan Stefanov ("Use it if you like it");
- notices from James Hall, yWorks GmbH, Aras Abbasi and other jsPDF plugin authors (MIT). jsPDF's optional integrations (html2canvas, canvg, DOMPurify) are **not** bundled; this app doesn't use them.

## Test tooling (not shipped in the app)

- `puppeteer-core` (Apache-2.0), installed by `npm ci` in `test/`, used only to drive Chrome in the tests. Not committed (`node_modules` is git-ignored).
