"""Generate deterministic PNG brand assets from the existing app head icon."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src-tauri" / "icons" / "icon.png"
PUBLIC = ROOT / "public"
FONT_REGULAR = Path("C:/Windows/Fonts/segoeui.ttf")
FONT_BOLD = Path("C:/Windows/Fonts/segoeuib.ttf")
FONT_MONO = Path("C:/Windows/Fonts/consola.ttf")


def font(path: Path, size: int):
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()


def app_icon(size: int) -> Image.Image:
    head = Image.open(SOURCE).convert("RGBA")
    canvas = Image.new("RGBA", (size, size), "#080b10")
    inset = max(12, round(size * 0.12))
    head.thumbnail((size - inset * 2, size - inset * 2), Image.Resampling.LANCZOS)
    canvas.alpha_composite(head, ((size - head.width) // 2, (size - head.height) // 2))
    return canvas


def social_card() -> Image.Image:
    width, height = 1200, 630
    image = Image.new("RGB", (width, height), "#080b10")
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            teal = max(0.0, 1.0 - ((x - 930) ** 2 + (y - 220) ** 2) ** 0.5 / 720)
            blue = max(0.0, 1.0 - ((x - 120) ** 2 + (y - 610) ** 2) ** 0.5 / 660)
            pixels[x, y] = (
                int(8 + 4 * teal + 4 * blue),
                int(11 + 24 * teal + 9 * blue),
                int(16 + 20 * teal + 22 * blue),
            )

    glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((790, 40, 1180, 430), fill=(84, 221, 178, 88))
    glow = glow.filter(ImageFilter.GaussianBlur(75))
    image = Image.alpha_composite(image.convert("RGBA"), glow)

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((58, 54, 1142, 576), radius=34, fill=(8, 12, 18, 205), outline=(84, 221, 178, 45), width=2)
    draw.text((104, 96), "GNM", font=font(FONT_BOLD, 29), fill="#54ddb2")
    draw.text((180, 96), "STUDIO", font=font(FONT_BOLD, 29), fill="#e8eef5")
    draw.text((104, 178), "Create. Track. Animate.", font=font(FONT_BOLD, 56), fill="#f5f8fb")
    draw.multiline_text((106, 257), "Local 3D head creation and real-time\nface motion capture for Blender.", font=font(FONT_REGULAR, 29), fill="#aeb9c7", spacing=10)

    badge_x = 104
    for label in ("OPEN SOURCE", "NO PYTHON", "WEB + WINDOWS"):
        badge_font = font(FONT_MONO, 16)
        box = draw.textbbox((0, 0), label, font=badge_font)
        badge_width = box[2] - box[0] + 30
        draw.rounded_rectangle((badge_x, 400, badge_x + badge_width, 440), radius=12, fill=(16, 49, 42, 255), outline=(84, 221, 178, 110))
        draw.text((badge_x + 15, 410), label, font=badge_font, fill="#9cf0d5")
        badge_x += badge_width + 13
    draw.text((105, 500), "drbaph.is-a.dev/GNM-Studio/", font=font(FONT_MONO, 19), fill="#758394")

    head = Image.open(SOURCE).convert("RGBA")
    head.thumbnail((315, 315), Image.Resampling.LANCZOS)
    icon_back = Image.new("RGBA", image.size, (0, 0, 0, 0))
    icon_draw = ImageDraw.Draw(icon_back)
    icon_draw.ellipse((815, 136, 1083, 404), fill=(84, 221, 178, 18), outline=(84, 221, 178, 80), width=2)
    image = Image.alpha_composite(image, icon_back)
    image.alpha_composite(head, (790 + (320 - head.width) // 2, 110 + (320 - head.height) // 2))
    return image.convert("RGB")


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    app_icon(180).save(PUBLIC / "apple-touch-icon.png", optimize=True)
    app_icon(192).save(PUBLIC / "icon-192.png", optimize=True)
    app_icon(512).save(PUBLIC / "icon-512.png", optimize=True)
    social_path = PUBLIC / "og-image.png"
    if not social_path.exists():
        social_card().save(social_path, optimize=True, quality=92)
    print("Generated favicon companion icons; preserved the existing 1200x630 Open Graph image.")


if __name__ == "__main__":
    main()
