"""Build the KK logo: icons/logo.svg, the inline header SVG, and the PNG app icons.
A messy game-menu mark: a blue wedge and a thin red stripe slash up across the back, a big hollow
outline of "KK" sits off-register behind (thin pale lines, like hollow title lettering), the first K
is cyan inside a cyan ring it breaks out of, and the second K is white. Both solid Ks have navy
outlines and blue offset shadows. The drawing is square and centred, so it also sits in the middle
of the clock's back face.
Usage (from the kronokairos folder): python tools/make_logo.py .
Prints the inline header SVG; paste it into the <h1> in index.html if the drawing changes."""
import io, math, os, sys
from PIL import Image, ImageDraw

ROOT = sys.argv[1]
NAVY, WHITE, CYAN, BLUE, WEDGE, RED, PALE, BG = (
    "#00184c", "#ffffff", "#2ad4ff", "#0a58ca", "#1f4fe0", "#e3173d", "#9fb4e6", "#050d24")
W, H = 64, 64
CX, CY = W / 2, H / 2


def italic(pts, cy, tan=0.2679):  # skewX(-15deg): a hard forward lean
    return [(x - (y - cy) * tan, y) for x, y in pts]


def k_outline(x, y, w, h):
    """One K as a single closed outline (no inner seams), so it can be filled or drawn hollow."""
    s = 0.36 * w  # stem width
    pts = [(0, 0), (s, 0), (s, 0.36 * h), (0.60 * w, 0), (w, 0), (0.56 * w, 0.47 * h),
           (w, h), (0.60 * w, h), (s, 0.70 * h), (s, h), (0, h)]
    return [(x + px, y + py) for px, py in pts]


def shift(pts, dx, dy):
    return [(x + dx, y + dy) for x, y in pts]


def around(pts, cx, cy, scale=1.0, deg=0.0):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return [(cx + ((x - cx) * c - (y - cy) * s) * scale, cy + ((x - cx) * s + (y - cy) * c) * scale) for x, y in pts]


def ring(cx, cy, r, n=96):
    return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


# The two solid Ks, the second one a step higher and both leaning forward.
K1 = italic(k_outline(13, 21, 17, 25), cy=33.5)
K2 = italic(k_outline(31, 18, 17, 25), cy=30.5)
_xs = [x for x, _ in K1 + K2]
_dx = CX - (min(_xs) + max(_xs) + 2) / 2  # centre the pair (shadow included)
K1, K2 = shift(K1, _dx, 0), shift(K2, _dx, 0)
k1_cx = sum(x for x, _ in K1) / len(K1)

# The hollow copy behind: bigger, turned a little and knocked off-register up and left.
GHOST = [around(shift(k, -4, -7), CX, CY, 1.3, -7) for k in (K1, K2)]
RING = ring(k1_cx - 2.5, 34, 18)
WEDGE_POLY = [(1, 47), (63, 15), (63, 43), (1, 50)]  # thin on the left, thick on the right
STRIPE = [(1, 42.5), (63, 10.5), (63, 12.2), (1, 44.2)]  # a thin red cut along the wedge's top

# (fill, stroke, stroke width, polygons) in paint order. A fill of None draws only the outline.
LAYERS = [
    (WEDGE, None, 0, [WEDGE_POLY]),
    (RED, None, 0, [STRIPE]),
    (None, PALE, 1.0, GHOST),
    (None, CYAN, 2.4, [RING]),
    (BLUE, BLUE, 2.4, [shift(k, 2.2, 2.2) for k in (K1, K2)]),
    (CYAN, NAVY, 2.4, [K1]),
    (WHITE, NAVY, 2.4, [K2]),
]


def svg_markup(attrs, background=False):
    out = [f'<svg {attrs} viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg">']
    if background:
        out.append(f'<rect width="{W}" height="{H}" rx="13" fill="{BG}"/>')
    for fill, stroke, width, polys in LAYERS:
        for p in polys:
            pts = " ".join(f"{x:.2f},{y:.2f}" for x, y in p)
            if fill is None:
                out.append(f'<polygon points="{pts}" fill="none" stroke="{stroke}" stroke-width="{width}" stroke-linejoin="round"/>')
            elif stroke:
                # outline under the fill: draw the stroke, then the fill on top of it
                out.append(f'<polygon points="{pts}" fill="{stroke}" stroke="{stroke}" stroke-width="{width}" stroke-linejoin="round"/>')
                out.append(f'<polygon points="{pts}" fill="{fill}"/>')
            else:
                out.append(f'<polygon points="{pts}" fill="{fill}"/>')
    out.append("</svg>")
    return "".join(out)


def png(size, scale, path, rounded=True):
    ss = 4
    S = size * ss
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.2), fill=BG)
    else:
        d.rectangle([0, 0, S, S], fill=BG)
    unit = S / W * scale
    ox, oy = (S - W * unit) / 2, (S - H * unit) / 2

    def tr(p):
        return [(ox + x * unit, oy + y * unit) for x, y in p]

    for fill, stroke, width, polys in LAYERS:
        for p in polys:
            pts = tr(p)
            if stroke:  # a round-joined line along every edge
                d.line(pts + [pts[0]], fill=stroke, width=max(1, int(width * unit)), joint="curve")
                if fill is not None:
                    d.polygon(pts, fill=stroke)
            if fill is not None:
                d.polygon(pts, fill=fill)
    img.resize((size, size), Image.LANCZOS).save(path)


icons = os.path.join(ROOT, "icons")
io.open(os.path.join(icons, "logo.svg"), "w", encoding="utf-8", newline="\n").write(svg_markup(f'width="{W}" height="{H}"', background=True) + "\n")
png(192, 0.9, os.path.join(icons, "icon-192.png"))
png(512, 0.9, os.path.join(icons, "icon-512.png"))
png(512, 0.7, os.path.join(icons, "maskable-512.png"), rounded=False)  # inside the maskable safe zone
png(180, 0.9, os.path.join(icons, "apple-touch-icon.png"), rounded=False)
print(svg_markup('class="logo" aria-hidden="true" focusable="false"'))
