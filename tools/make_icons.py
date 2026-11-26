#!/usr/bin/env python3
"""Write the PWA icons. Solid mark, no third-party art."""
import struct, zlib
from pathlib import Path
R = Path(__file__).resolve().parents[1] / 'icons'

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

def mark(x, y, w, h, maskable=False):
    nx, ny = (x + 0.5) / w, (y + 0.5) / h
    bg = (31, 111, 235, 255) if maskable else (244, 246, 249, 255)
    # a simple sheet with a corner mark, kept inside the maskable safe zone
    m = 0.18 if maskable else 0.12
    if m < nx < 1 - m and m < ny < 1 - m:
        if abs(nx - (1 - m)) < 0.035 or abs(ny - m) < 0.035:
            return (224, 17, 95, 255)
        return (255, 255, 255, 255)
    return bg

R.mkdir(exist_ok=True)
for name, size, mask in (('icon-192.png', 192, False), ('icon-512.png', 512, False), ('icon-maskable-512.png', 512, True), ('apple-touch-icon-180.png', 180, False)):
    (R / name).write_bytes(png(size, size, lambda x, y, w, h, mask=mask: mark(x, y, w, h, mask)))
    print(name, size)
