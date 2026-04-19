"""
Generate Brevmont extension icons at 16, 32, 48, 128 px.

Design (per fix brief 2026-04-19):
  - Rounded-square background in Brevmont deep teal #0D6E6E
  - Bone/white "B" mark, weight 600ish, centered
  - Reads on Chrome dark toolbar (~#3C4043) AND light panel (#fff)
  - Replaces prior near-black (#0f1419) keystone trapezoid that was
    invisible in dark-mode Chrome.

Dependencies: Pillow only. Uses Segoe UI Bold as the closest system
stand-in for Inter 600 (no Inter TTF on the Windows box; visually
equivalent geometric sans at icon sizes). The exact letterform
doesn't ship at the pixel scales we care about — what matters is a
tall bold glyph with clean counters.

Run:
  python scripts/gen_icons.py
Writes to public/icons/icon-{16,32,48,128}.png. The 512px master is
regenerated as well for store listings + marketing.
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ICON_DIR = os.path.normpath(os.path.join(HERE, '..', 'public', 'icons'))
os.makedirs(ICON_DIR, exist_ok=True)

TEAL = (13, 110, 110, 255)          # #0D6E6E
BONE = (245, 241, 232, 255)         # #F5F1E8
SIZES = [16, 32, 48, 128, 512]

# Corner radius 18% — matches Chrome app-icon language. For 16px we
# round down to 3 to avoid fuzziness at sub-pixel grids.
def radius_for(size: int) -> int:
    r = int(round(size * 0.18))
    return max(2, r)

# Try Segoe UI Bold (Windows default) with fallback to Arial Bold.
def load_font(px_size: int) -> ImageFont.ImageFont:
    for path in (
        'C:/Windows/Fonts/segoeuib.ttf',
        'C:/Windows/Fonts/arialbd.ttf',
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, px_size)
    return ImageFont.load_default()


def render(size: int) -> Image.Image:
    # 4x supersample for clean edges then downsample with LANCZOS.
    scale = 4
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Background: rounded teal square, scaled.
    pad = 0  # No inner padding — icon fills the whole tile. Chrome
             # will render its own drop-shadow in the toolbar.
    d.rounded_rectangle(
        [(pad, pad), (s - pad - 1, s - pad - 1)],
        radius=radius_for(size) * scale,
        fill=TEAL,
    )

    # Foreground glyph "B". Tuned ratio per target size.
    # At 16 we need the glyph to nearly fill vertically; at 128 we
    # want more breathing room for a cleaner display.
    if size <= 16:
        glyph_ratio = 0.82
    elif size <= 32:
        glyph_ratio = 0.72
    elif size <= 48:
        glyph_ratio = 0.68
    else:
        glyph_ratio = 0.64

    glyph_px = int(s * glyph_ratio)
    font = load_font(glyph_px)

    text = 'B'
    bbox = d.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    # Optical centering: Segoe UI's B has bottom-heavy whitespace,
    # so shift up slightly.
    cx = (s - text_w) // 2 - bbox[0]
    cy = (s - text_h) // 2 - bbox[1] - int(s * 0.02)
    d.text((cx, cy), text, font=font, fill=BONE)

    return img.resize((size, size), Image.LANCZOS)


for size in SIZES:
    out = os.path.join(ICON_DIR, f'icon-{size}.png')
    render(size).save(out, 'PNG', optimize=True)
    print(f'wrote {out}')
