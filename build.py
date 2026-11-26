#!/usr/bin/env python3
"""Inline the vendored jsPDF + the sources into one offline HTML file.

Writes:
  index.html                      (repo root; GitHub Pages serves this)
  app/cricut_print_assistant.html (the same file, for downloading / keeping offline)
"""
import pathlib, re
R = pathlib.Path(__file__).resolve().parent
t = (R / 'src/template.html').read_text()
js = (R / 'vendor/jspdf.umd.min.js').read_text()
js = re.sub(r'//# sourceMappingURL=\S+', '', js)
lic = (R / 'vendor/LICENSE').read_text().replace('*/', '* /')
for name, body in [('/*JSPDF*/', f'/* jsPDF 2.5.2 - MIT License\n{lic}\n*/\n' + js), ('/*CORE*/', (R / 'src/core.js').read_text()), ('/*APP*/', (R / 'src/app.js').read_text())]:
    assert '</script' not in body.lower(), name
    t = t.replace(name, body, 1)
t = t.replace('<!--HOWTO-->', (R / 'src/howto.html').read_text(), 1)
(R / 'app').mkdir(exist_ok=True)
for out in (R / 'index.html', R / 'app' / 'cricut_print_assistant.html'):
    out.write_text(t)
    print('wrote', out.relative_to(R), len(t), 'bytes')
