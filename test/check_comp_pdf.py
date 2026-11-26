# Renders the pass-2 (compensated) calibration PDF made by cal_ui_test.js and measures the printed corner squares.
import subprocess, glob, numpy as np, sys; from PIL import Image
import os, re; pdf=os.environ.get('PDF', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sample_output', 'calibration-letter-PRINT_pass2_compensated_example.pdf'))
# compensation as printed on the sheet ("COMPENSATION +a% / +b%"); the made-up printer of cal_ui_test.js shrinks 2.55% / 2.80%
txt=subprocess.run(['pdftotext','-layout',pdf,'-'],capture_output=True,text=True).stdout; m=re.search(r'COMPENSATION \+([\d.]+)% / \+([\d.]+)%',txt)
EX,EY=1+float(m.group(1))/100,1+float(m.group(2))/100; SHX,SHY=0.0255,0.028; T=0.06
subprocess.run(['pdftoppm','-r','600','-gray','-png',pdf,'/tmp/cc'],check=True)
a=np.array(Image.open(sorted(glob.glob('/tmp/cc*.png'))[0]).convert('L'))<128; H,W=a.shape; R=600
def ext(sub): c=np.nonzero(sub.any(0))[0]; r=np.nonzero(sub.any(1))[0]; return c.min(),c.max(),r.min(),r.max()
n=int(0.45*R); tl=ext(a[:n,:n]); tr=ext(a[:n,W-n:]); bl=ext(a[H-n:,:n])
dx=((tr[1]+W-n+1)-tl[0])/R-2*T*EX; dy=((bl[3]+H-n+1)-tl[2])/R-2*T*EY
px,py=dx*(1-SHX),dy*(1-SHY); print('PDF corner squares %.4f x %.4f in; after the printer shrink %.4f x %.4f in (target 8.000 x 10.500)'%(dx,dy,px,py))
ok=abs(px-8)<0.01 and abs(py-10.5)<0.01; print('PASS' if ok else 'FAIL','printed size true within 0.01 in'); sys.exit(0 if ok else 1)
