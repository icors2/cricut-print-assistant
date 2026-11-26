import re, json, sys, os, subprocess, itertools
from PIL import Image, ImageDraw
D = os.path.join(os.path.dirname(__file__), '..', 'sample_output'); os.chdir(D)
def parse_d(d):
    toks = re.findall(r'[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?', d); loops=[]; cur=None; i=0; closed=[]
    while i < len(toks):
        t = toks[i]; i+=1
        if t=='M': cur=[(float(toks[i]),float(toks[i+1]))]; i+=2; loops.append(cur)
        elif t=='L': cur.append((float(toks[i]),float(toks[i+1]))); i+=2
        elif t=='C':
            p0=cur[-1]; c=[float(x) for x in toks[i:i+6]]; i+=6
            for k in range(1,9):
                s=k/8; a=(1-s)**3; b=3*(1-s)**2*s; cc=3*(1-s)*s*s; e=s**3
                cur.append((a*p0[0]+b*c[0]+cc*c[2]+e*c[4], a*p0[1]+b*c[1]+cc*c[3]+e*c[5]))
        elif t=='Z': closed.append(len(loops)-1)
    return loops, closed
ok=True
def check(name, cond, msg):
    global ok; print(('PASS ' if cond else 'FAIL ')+name+': '+msg); ok &= bool(cond)
L = json.load(open('layout.json')); sh=L['sheet']; ins=L['inset']
pdfsz = re.search(r'Page size:\s+([\d.]+) x ([\d.]+) pts', subprocess.run(['pdfinfo','sample-letter-PRINT.pdf'],capture_output=True,text=True).stdout)
check('pdf page size', abs(float(pdfsz[1])-sh['w']*72)<0.01 and abs(float(pdfsz[2])-sh['h']*72)<0.01, f"{pdfsz[1]} x {pdfsz[2]} pt = {float(pdfsz[1])/72} x {float(pdfsz[2])/72} in")
for si, pl in enumerate(L['place']):
    svg = open(f'sample-letter-{si+1}-CUT.svg').read()
    m = re.search(r'width="([\d.]+)in" height="([\d.]+)in" viewBox="0 0 ([\d.]+) ([\d.]+)"', svg)
    W,H,VW,VH = map(float, m.groups())
    check(f'svg{si+1} size', abs(W-(sh['w']-2*ins))<1e-4 and abs(H-(sh['h']-2*ins))<1e-4 and abs(VW-W*72)<1e-3 and abs(VH-H*72)<1e-3, f'{W} x {H} in, viewBox {VW} x {VH} (72 units/in)')
    d = re.search(r'id="cuts"[^>]* d="([^"]+)"', svg)[1]
    loops, closed = parse_d(d)
    check(f'svg{si+1} closed', len(closed)==len(loops) and d.count('M')==d.count('Z'), f'{len(loops)} subpaths, {len(closed)} closed with Z')
    xs=[p[0] for l in loops for p in l]; ys=[p[1] for l in loops for p in l]
    check(f'svg{si+1} anchors define canvas', abs(min(xs))<1e-3 and abs(min(ys))<1e-3 and abs(max(xs)-VW)<1e-3 and abs(max(ys)-VH)<1e-3, f'content bbox {min(xs):.3f},{min(ys):.3f} .. {max(xs):.3f},{max(ys):.3f} pt')
    # overlaps (cut bboxes + spacing) and in-bounds
    rs=[(p['x'],p['y'],p['x']+p['w'],p['y']+p['h']) for p in pl]; ov=0; minGap=9
    for a,b in itertools.combinations(rs,2):
        gx=max(b[0]-a[2],a[0]-b[2]); gy=max(b[1]-a[3],a[1]-b[3]); g=max(gx,gy); minGap=min(minGap,g)
        if g < L['spacing']-1e-6: ov+=1
    check(f'sheet{si+1} no overlaps', ov==0, f'{len(rs)} pieces, min gap between cut boxes {minGap:.4f} in (spacing {L["spacing"]})')
    M = L['margin'] if isinstance(L['margin'], dict) else {k: L['margin'] for k in 'ltrb'}
    inb = all(r[0]>=M['l']-1e-6 and r[1]>=M['t']-1e-6 and r[2]<=sh['w']-M['r']+1e-6 and r[3]<=sh['h']-M['b']+1e-6 for r in rs)
    pinb = all(p['px']>=0.124 and p['py']>=0.124 and p['px']+p['pw']<=sh['w']-0.124 and p['py']+p['ph']<=sh['h']-0.124 for p in pl)
    check(f'sheet{si+1} in bounds', inb and pinb, f'cuts inside margins {M}; print+bleed >= 0.125 in from edge')
    # overlay: render PDF page at 150dpi and draw SVG cut lines (shifted by inset) in pink
    dpi=150; subprocess.run(['pdftoppm','-r',str(dpi),'-png','-f',str(si+1),'-l',str(si+1),'-singlefile','sample-letter-PRINT.pdf',f'_p{si+1}'],check=True)
    im = Image.open(f'_p{si+1}.png').convert('RGB'); dr = ImageDraw.Draw(im)
    for l in loops:
        pts=[((x/72+ins)*dpi,(y/72+ins)*dpi) for x,y in l]; dr.line(pts+[pts[0]], fill=(230,0,110), width=2)
    im.save(f'overlay_sheet{si+1}_pdf+svg.png'); os.remove(f'_p{si+1}.png')
# calibration files
c = open('calibration-letter-CUT.svg').read(); loops,closed=parse_d(re.search(r'id="cuts"[^>]* d="([^"]+)"', c)[1])
check('calibration svg', len(loops)==9 and len(closed)==9, f'{len(loops)} closed subpaths (4 anchors + 5 targets)')
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
