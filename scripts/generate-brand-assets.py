#!/usr/bin/env python3
"""Generate every runtime NubArca image from the preserved brand sources.

Reproducible: delete the outputs, re-run, get byte-identical files. The sources
in assets/brand/source/ are the approved artwork and are never modified — this
script only trims, pads, and DOWNSCALES. It never upscales past a source, never
recolors, never stretches, and never rotates.

    python3 scripts/generate-brand-assets.py [--check]

--check verifies the committed derivatives match what the sources produce
(used by the brand test) instead of writing them.

Source roles
    icon-transparent.png                 primary icon, alpha, light-on-dark
    wordmark-dark-text-transparent.png   lockup with DARK text — light backgrounds only
    app-icon.png                         opaque app-icon artwork (favicon/PWA/mobile)
    tv-lockup.png                        opaque "NubArca TV" lockup
    reference-*.png                      guideline boards — NEVER shipped as UI
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "brand" / "source"
WEB = ROOT / "frontend" / "public" / "brand"
TV = ROOT / "tv" / "assets" / "brand"

# Reference boards must never become runtime UI images.
REFERENCE_ONLY = {
    "reference-brand-system.png",
    "reference-color-and-type.png",
    "reference-development-guidelines.png",
}

MIDNIGHT_NAVY = (10, 15, 26, 255)


def load(name: str) -> Image.Image:
    if name in REFERENCE_ONLY:
        raise SystemExit(f"refusing to build a runtime asset from the guideline board {name}")
    return Image.open(SOURCE / name).convert("RGBA")


def trim_alpha(im: Image.Image) -> Image.Image:
    """Crop to the visible artwork. Keeps proportions — it only removes empty canvas."""
    bbox = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return im.crop(bbox) if bbox else im


def square_pad(im: Image.Image, fill: tuple[int, int, int, int] = (0, 0, 0, 0)) -> Image.Image:
    """Centre the artwork on a square canvas. Padding, never scaling: proportions hold."""
    side = max(im.size)
    out = Image.new("RGBA", (side, side), fill)
    out.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    return out


def scale_to(im: Image.Image, size: int) -> Image.Image:
    """Resize a square to `size`. Refuses to upscale beyond the source."""
    if size > im.width:
        raise SystemExit(
            f"refusing to upscale {im.width}px artwork to {size}px — supply a larger source"
        )
    return im.resize((size, size), Image.LANCZOS)


def fit_width(im: Image.Image, width: int) -> Image.Image:
    """Resize preserving the exact aspect ratio. Refuses to upscale."""
    if width > im.width:
        raise SystemExit(f"refusing to upscale {im.width}px artwork to {width}px")
    height = max(1, round(im.height * width / im.width))
    return im.resize((width, height), Image.LANCZOS)


def flatten(im: Image.Image, background: tuple[int, int, int, int] = MIDNIGHT_NAVY) -> Image.Image:
    """Composite onto Midnight Navy for surfaces that cannot carry alpha."""
    out = Image.new("RGBA", im.size, background)
    out.alpha_composite(im)
    return out


def build() -> dict[Path, Image.Image]:
    """Every generated file, keyed by destination path."""
    out: dict[Path, Image.Image] = {}

    # --- primary icon (transparent, light-on-dark) ---------------------------
    icon = square_pad(trim_alpha(load("icon-transparent.png")))
    for size in (512, 256, 192, 128, 96, 64, 48, 32, 24):
        out[WEB / f"icon-{size}.png"] = scale_to(icon, size)

    # --- app icon (opaque artwork: favicon, PWA, mobile) ---------------------
    app_icon = load("app-icon.png")
    for size in (512, 384, 256, 192, 180, 152, 144, 128, 96, 72, 64, 48, 32, 16):
        out[WEB / f"app-icon-{size}.png"] = scale_to(app_icon, size)
    # Apple wants an opaque square at a fixed name.
    out[WEB / "apple-touch-icon.png"] = scale_to(app_icon, 180)
    # Maskable: the artwork is already full-bleed dark with the glyph centred at
    # ~57% of the canvas, comfortably inside the 80% safe circle, so the same
    # square is safe to declare maskable without re-cropping.
    out[WEB / "maskable-icon-512.png"] = scale_to(app_icon, 512)

    # --- wordmark (DARK text — light backgrounds only) -----------------------
    # Kept at its true proportions. Never recolored: the app shell uses the icon
    # plus live UI text instead, because no light-on-dark wordmark was supplied.
    wordmark = trim_alpha(load("wordmark-dark-text-transparent.png"))
    for width in (960, 480, 240):
        out[WEB / f"wordmark-dark-text-{width}.png"] = fit_width(wordmark, width)

    # --- TV --------------------------------------------------------------------
    tv_lockup = load("tv-lockup.png")
    for width in (1280, 640):
        out[TV / f"tv-lockup-{width}.png"] = fit_width(tv_lockup, width)
    # Android TV banner is a fixed 320x180 landscape slot.
    banner = tv_lockup.resize((320, 180), Image.LANCZOS)
    out[TV / "tv-banner-320x180.png"] = banner
    for size in (512, 192, 96):
        out[TV / f"tv-icon-{size}.png"] = scale_to(app_icon, size)
    # Splash: the lockup centred at the launcher's 16:9 aspect.
    #
    # The canvas takes the LOCKUP'S OWN background colour, sampled from its
    # corner, rather than the Midnight Navy token. The approved artwork sits on
    # a slightly deeper navy, and compositing it onto #0A0F1A leaves a visible
    # rectangle where the two meet — the seam reads as a boxed logo. Sampling
    # keeps the field continuous, changes nothing about the logo itself, and
    # stays correct if the source artwork is ever replaced.
    splash_bg = tv_lockup.convert("RGB").getpixel((1, 1)) + (255,)
    splash = Image.new("RGBA", (1920, 1080), splash_bg)
    lockup = fit_width(tv_lockup, 1100)
    splash.alpha_composite(lockup, ((1920 - lockup.width) // 2, (1080 - lockup.height) // 2))
    out[TV / "tv-splash-1920x1080.png"] = splash
    out[TV / "tv-adaptive-icon-432.png"] = flatten(scale_to(app_icon, 432))

    return out


def encode(im: Image.Image) -> bytes:
    """Deterministic PNG bytes (no timestamp chunk)."""
    import io

    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def write_ico(path: Path, source: Image.Image) -> bytes:
    import io

    buf = io.BytesIO()
    source.save(buf, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    return buf.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify instead of writing")
    args = parser.parse_args()

    assets = build()
    blobs = {path: encode(im) for path, im in assets.items()}
    blobs[WEB / "favicon.ico"] = write_ico(WEB / "favicon.ico", load("app-icon.png"))

    problems: list[str] = []
    for path, data in sorted(blobs.items()):
        rel = path.relative_to(ROOT)
        if args.check:
            if not path.exists():
                problems.append(f"missing: {rel}")
            elif path.read_bytes() != data:
                problems.append(f"stale (regenerate): {rel}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()[:12]
            print(f"{rel}  {len(data):>8,} B  {digest}")

    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    if args.check:
        print(f"{len(blobs)} brand assets match their sources")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
