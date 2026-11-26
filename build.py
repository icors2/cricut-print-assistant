#!/usr/bin/env python3
"""Inline the vendored jsPDF + the sources into one offline HTML file.

Writes:
  index.html                      (repo root; GitHub Pages serves this)
  app/cricut_print_assistant.html (the same file, for downloading / keeping offline)
"""
import hashlib, json, pathlib, re, sys
R = pathlib.Path(__file__).resolve().parent
def read(p): return pathlib.Path(p).read_text(encoding='utf-8')
def write(p, text): pathlib.Path(p).write_text(text, encoding='utf-8', newline='\n')
t = read(R / 'src/template.html')
js = read(R / 'vendor/jspdf.umd.min.js')
js = re.sub(r'//# sourceMappingURL=\S+', '', js)
lic = read(R / 'vendor/LICENSE').replace('*/', '* /')
for name, body in [('/*JSPDF*/', f'/* jsPDF 2.5.2 - MIT License\n{lic}\n*/\n' + js), ('/*CORE*/', read(R / 'src/core.js')), ('/*APP*/', read(R / 'src/app.js'))]:
    assert '</script' not in body.lower(), name
    t = t.replace(name, body, 1)
mod_dir = R / 'src/modules'
order = [l.strip() for l in read(mod_dir / 'ORDER').splitlines() if l.strip() and not l.lstrip().startswith('#')]
present = {p.name for p in mod_dir.glob('*.js')}
missing, unknown = present - set(order), set(order) - present
if missing or unknown:
    raise SystemExit(f'src/modules/ORDER mismatch: missing {sorted(missing)}, unknown {sorted(unknown)}')
mods = '\n'.join(read(mod_dir / n) for n in order)
assert '</script' not in mods.lower(), '/*MODULES*/'
t = t.replace('/*MODULES*/', mods, 1)
t = t.replace('<!--HOWTO-->', read(R / 'src/howto.html'), 1)
# Optional remote pack index for a private deployment (off in the public build):
#   python3 build.py --pack-index /packs/index.json
if '--pack-index' in sys.argv:
    import html
    i = sys.argv.index('--pack-index'); url = sys.argv[i + 1] if i + 1 < len(sys.argv) else ''
    if not url or url.startswith('-'): raise SystemExit('--pack-index needs a URL')
    t = t.replace('<meta name="cpa-pack-index" content="">', f'<meta name="cpa-pack-index" content="{html.escape(url, quote=True)}">', 1)
(R / 'app').mkdir(exist_ok=True)
if len(t.encode('utf-8')) > 800 * 1024:
    raise SystemExit(f'index.html is {len(t.encode("utf-8"))} bytes, over the 800 KB budget')
for out in (R / 'index.html', R / 'app' / 'cricut_print_assistant.html'):
    write(out, t)
    print('wrote', out.relative_to(R), len(t), 'bytes')

def precache():
    rels = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon-180.png', 'assets/catalog.json', 'assets/palettes.json', 'assets/avatar/parts.json']
    thumbs = R / 'assets' / 'thumbs'
    if thumbs.is_dir():
        for p in thumbs.rglob('*'):
            if p.is_file() and p.suffix != '.json': rels.append(p.relative_to(R).as_posix())
    return [r for r in rels if r in ('./',) or (R / r).exists()]

cat = R / 'assets' / 'catalog.json'
digest = hashlib.sha256((R / 'index.html').read_bytes() + (cat.read_bytes() if cat.exists() else b'')).hexdigest()[:12]
sw = read(R / 'src' / 'sw.template.js').replace('__HASH__', digest).replace('__PRECACHE__', json.dumps(precache()))
write(R / 'sw.js', sw)
print('wrote sw.js', digest)

if '--bundle-assets' in sys.argv:
    import base64, mimetypes
    cat_doc = json.loads(read(R / 'assets' / 'catalog.json'))
    pal_doc = json.loads(read(R / 'assets' / 'palettes.json')) if (R / 'assets' / 'palettes.json').exists() else {'palettes': []}
    av_path = R / 'assets' / 'avatar' / 'parts.json'
    av_doc = json.loads(read(av_path)) if av_path.exists() else None
    files = {}
    def add_file(rel):
        p = R / 'assets' / rel
        if not p.is_file() or 'private' in p.parts: return
        mime = 'image/svg+xml' if p.suffix == '.svg' else (mimetypes.guess_type(p.name)[0] or 'application/octet-stream')
        files[rel.replace('\\', '/')] = 'data:%s;base64,%s' % (mime, base64.b64encode(p.read_bytes()).decode('ascii'))
    for a in cat_doc.get('assets', []):
        for key in ('svg', 'png', 'thumb'):
            if a.get('files', {}).get(key): add_file(a['files'][key])
        for rel in (a.get('files', {}).get('masks') or {}).values(): add_file(rel)
    if av_doc:
        add_file(av_doc.get('template', {}).get('file', ''))
        for part in av_doc.get('parts', []): add_file(part.get('file', ''))
    blob = json.dumps({'catalog': cat_doc, 'palettes': pal_doc, 'avatar': av_doc, 'files': files}, separators=(',', ':')).replace('</', '<\\/')
    marker = t.rfind('<script>')
    bundled = t[:marker] + '<script type="application/json" id="cstAssets">' + blob + '</script>\n' + t[marker:]
    write(R / 'app' / 'cricut_print_assistant_bundled.html', bundled)
    print('wrote app/cricut_print_assistant_bundled.html', len(bundled), 'bytes')
