"""Optional: generate the extension icons (PNG) and add an "icons" key to
manifest.json pointing at them. Requires Pillow: pip install pillow."""
from PIL import Image, ImageDraw

def make(size, path):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = max(2, size // 5)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(108, 93, 240, 255))
    w = max(1, size // 10)
    cx, top, bot = size / 2, size * 0.28, size * 0.74
    d.line([(size * 0.30, top), (cx, bot)], fill=(255, 255, 255, 255), width=w)
    d.line([(cx, bot), (size * 0.70, top)], fill=(255, 255, 255, 255), width=w)
    img.save(path)

for s in (16, 48, 128):
    make(s, f"icon{s}.png")
print("done — now add the icons key to manifest.json")
