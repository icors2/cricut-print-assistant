#!/usr/bin/env python3
"""Write the original placeholder PNG (teddy) and its tint mask. CC0, no third-party art."""
import struct, zlib
from pathlib import Path
R = Path(__file__).resolve().parents[1] / 'assets' / 'items'

def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

def png(w, h, fn):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            raw.extend(fn(x, y, w, h))
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')

def inside(x, y, w, h):
    nx, ny = (x + 0.5) / w - 0.5, (y + 0.5) / h - 0.48
    return (nx / 0.32) ** 2 + (ny / 0.40) ** 2 <= 1

def bear(x, y, w, h):
    if not inside(x, y, w, h): return (0, 0, 0, 0)
    return (196, 165, 116, 255)

def mask(x, y, w, h):
    v = 255 if inside(x, y, w, h) else 0
    return (v, v, v, 255)

R.mkdir(parents=True, exist_ok=True)
(R / 'teddy.png').write_bytes(png(120, 140, bear))
(R / 'teddy-mask.png').write_bytes(png(120, 140, mask))
print('teddy.png', 'teddy-mask.png')
