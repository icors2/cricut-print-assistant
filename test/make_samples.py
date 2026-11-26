from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math, os
D = os.path.join(os.path.dirname(__file__), 'samples')
def font(s):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        if os.path.exists(p): return ImageFont.truetype(p, s)
    return ImageFont.load_default()
# 1 star sticker, transparent
im = Image.new('RGBA', (800, 800), (0,0,0,0)); d = ImageDraw.Draw(im)
pts = [(400+360*math.cos(math.pi/2*3+i*math.pi/5)*(1 if i%2==0 else .45), 420+360*math.sin(math.pi/2*3+i*math.pi/5)*(1 if i%2==0 else .45)) for i in range(10)]
d.polygon(pts, fill=(255,190,30,255), outline=(200,90,0,255), width=14); d.text((400,430), 'TEST', font=font(90), fill=(120,40,0,255), anchor='mm')
im.save(f'{D}/star_sticker.png')
# 2 donut with hole + separate speck (tests hole fill / island removal)
im = Image.new('RGBA', (700, 700), (0,0,0,0)); d = ImageDraw.Draw(im)
d.ellipse((40,40,660,660), fill=(40,140,230,255)); d.ellipse((230,230,470,470), fill=(0,0,0,0)); d.ellipse((5,5,12,12), fill=(0,0,0,255))
d.text((350,120), 'SAMPLE', font=font(60), fill=(255,255,255,255), anchor='mm'); im.save(f'{D}/donut_badge.png')
# 3 two-blob cloud (two components joined by offset)
im = Image.new('RGBA', (900, 500), (0,0,0,0)); d = ImageDraw.Draw(im)
d.ellipse((20,100,430,480), fill=(120,200,90,255)); d.ellipse((470,60,880,440), fill=(90,170,200,255)); im = im.filter(ImageFilter.GaussianBlur(1.5)); im.save(f'{D}/two_blobs.png')
# 4 opaque photo-like JPG (gradient + shapes)
im = Image.new('RGB', (1200, 800)); px = im.load()
for y in range(800):
    for x in range(1200): px[x,y] = (int(255*x/1200), int(120+100*math.sin(y/60)), int(255*(1-y/800)))
d = ImageDraw.Draw(im); d.rectangle((0,0,1199,799), outline=(20,20,20), width=10); d.text((600,400),'MADE-UP PHOTO', font=font(90), fill=(255,255,255), anchor='mm'); im.save(f'{D}/gradient_photo.jpg', quality=92)
# 5 label JPG square
im = Image.new('RGB', (600, 600), (250,245,235)); d = ImageDraw.Draw(im); d.rectangle((0,0,599,599), fill=(180,30,60)); d.rectangle((30,30,569,569), fill=(250,245,235)); d.text((300,300),'LABEL', font=font(110), fill=(180,30,60), anchor='mm'); im.save(f'{D}/label_square.jpg')
# 6 SVG heart (no width/height, viewBox only)
open(f'{D}/heart.svg','w').write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 90"><path d="M50 88 C10 60 0 40 0 25 C0 10 12 0 26 0 C38 0 46 8 50 16 C54 8 62 0 74 0 C88 0 100 10 100 25 C100 40 90 60 50 88Z" fill="#d81b60"/><circle cx="30" cy="28" r="8" fill="#fff" opacity=".7"/></svg>')
print('ok')
