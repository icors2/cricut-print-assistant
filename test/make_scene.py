# Made-up pastel dollhouse-room sticker pieces for the Mockup tests (all drawn here; no real artwork).
from PIL import Image, ImageDraw
import os
D = os.path.join(os.path.dirname(__file__), 'samples', 'scene'); os.makedirs(D, exist_ok=True)
def save(im, n): im.save(os.path.join(D, n))
# wall panel (opaque, 6 x 4 in at 300 dpi -> 1800x1200): pastel stripes
w = Image.new('RGB', (1800, 1200), '#f8d9e4'); g = ImageDraw.Draw(w)
for x in range(0, 1800, 120): g.rectangle([x, 0, x + 50, 1200], fill='#fbe7ee')
g.rectangle([0, 1080, 1800, 1200], fill='#e9b9c9'); save(w, 'wall_panel.png')
# floor strip (opaque 6 x 1 in)
f = Image.new('RGB', (1800, 300), '#e8cfae'); g = ImageDraw.Draw(f)
for x in range(0, 1800, 200): g.line([x, 0, x, 300], fill='#cfae86', width=6)
save(f, 'floor_boards.jpg'.replace('.jpg', '.png'))
# window (transparent)
im = Image.new('RGBA', (600, 690), (0, 0, 0, 0)); g = ImageDraw.Draw(im)
g.rounded_rectangle([20, 20, 580, 670], 40, fill='#ffffff'); g.rectangle([70, 70, 530, 620], fill='#bfe3f7')
g.rectangle([290, 70, 310, 620], fill='#ffffff'); g.rectangle([70, 335, 530, 355], fill='#ffffff'); save(im, 'window.png')
# bear (transparent)
im = Image.new('RGBA', (600, 720), (0, 0, 0, 0)); g = ImageDraw.Draw(im); br = '#c99a6e'; lt = '#ecd3b5'
for c in [(120, 110), (480, 110)]: g.ellipse([c[0] - 80, c[1] - 80, c[0] + 80, c[1] + 80], fill=br)
g.ellipse([110, 60, 490, 400], fill=br); g.ellipse([230, 230, 370, 340], fill=lt); g.ellipse([280, 240, 320, 275], fill='#4a3426')
g.ellipse([210, 170, 250, 210], fill='#2a1d14'); g.ellipse([350, 170, 390, 210], fill='#2a1d14')
g.ellipse([140, 360, 460, 700], fill=br); g.ellipse([220, 430, 380, 640], fill=lt)
g.rounded_rectangle([170, 40, 430, 80], 20, fill='#9fd3c7'); g.ellipse([130, 60, 210, 150], fill='#9fd3c7'); g.ellipse([390, 60, 470, 150], fill='#9fd3c7')  # headset
save(im, 'bear_headset.png')
# sofa (transparent)
im = Image.new('RGBA', (1050, 600), (0, 0, 0, 0)); g = ImageDraw.Draw(im); s = '#b9d8f0'
g.rounded_rectangle([90, 40, 960, 330], 80, fill=s); g.rounded_rectangle([20, 230, 1030, 500], 70, fill='#a3c8e6')
g.rounded_rectangle([20, 200, 190, 500], 60, fill=s); g.rounded_rectangle([860, 200, 1030, 500], 60, fill=s)
g.rectangle([90, 500, 150, 580], fill='#8a6a4f'); g.rectangle([900, 500, 960, 580], fill='#8a6a4f'); save(im, 'sofa.png')
# lamp
im = Image.new('RGBA', (360, 900), (0, 0, 0, 0)); g = ImageDraw.Draw(im)
g.polygon([(60, 260), (300, 260), (240, 40), (120, 40)], fill='#fff1a8'); g.rectangle([170, 260, 190, 820], fill='#9a8c7a'); g.ellipse([70, 800, 290, 880], fill='#9a8c7a'); save(im, 'floor_lamp.png')
# rug
im = Image.new('RGBA', (1200, 360), (0, 0, 0, 0)); g = ImageDraw.Draw(im)
g.ellipse([10, 10, 1190, 350], fill='#d9c2ee'); g.ellipse([120, 60, 1080, 300], fill='#ead9f7'); save(im, 'rug.png')
print('wrote', sorted(os.listdir(D)))
