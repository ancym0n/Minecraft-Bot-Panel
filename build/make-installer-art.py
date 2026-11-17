"""Regenerates logo.ico and the NSIS installer bitmaps in build/installer (needs Pillow)."""
import glob
import os
from PIL import Image, ImageDraw, ImageFont

here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "installer")
os.makedirs(out, exist_ok=True)
logo = Image.open(os.path.join(here, "logo.png")).convert("RGBA")
logo.save(
    os.path.join(here, "logo.ico"),
    format="ICO",
    sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)],
)
BG = (22, 19, 31)
MID = (43, 35, 66)
ACC = (177, 151, 252)
ACC2 = (145, 113, 248)

cands = glob.glob("/usr/share/fonts/**/NotoSans-Bold.ttf", recursive=True) + glob.glob(
    "/usr/share/fonts/**/*Bold*.ttf", recursive=True
)
FONT = cands[0] if cands else None


def f(size):
    return ImageFont.truetype(FONT, size) if FONT else ImageFont.load_default()


def grad(w, h):
    im = Image.new("RGB", (w, h), BG)
    px = im.load()
    for y in range(h):
        for x in range(w):
            t = (x / w * 0.4 + y / h * 0.6) * 0.5
            px[x, y] = tuple(int(BG[i] * (1 - t) + MID[i] * t) for i in range(3))
    return im


s = grad(164, 314)
d = ImageDraw.Draw(s)
l = logo.resize((120, 120), Image.LANCZOS)
s.paste(l, (22, 40), l)
d.text((82, 185), "MCBP", font=f(21), fill=(255, 255, 255), anchor="mm")
d.text((82, 208), "Bot Panel", font=f(14), fill=ACC, anchor="mm")
d.rounded_rectangle((52, 230, 112, 234), 2, fill=ACC2)
d.text((82, 290), "by ancymon", font=f(11), fill=ACC, anchor="mm")
s.save(os.path.join(out, "sidebar.bmp"))
s.save(os.path.join(out, "uninstallerSidebar.bmp"))

h = grad(150, 57)
d = ImageDraw.Draw(h)
l = logo.resize((42, 42), Image.LANCZOS)
h.paste(l, (100, 8), l)
d.text((10, 28), "MCBP", font=f(16), fill=(255, 255, 255), anchor="lm")
h.save(os.path.join(out, "header.bmp"))
