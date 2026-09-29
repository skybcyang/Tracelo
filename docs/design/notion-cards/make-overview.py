"""Arrange actual browser captures without reconstructing UI elements."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent
SHOTS = ROOT / "screenshots"
FONT = "/System/Library/Fonts/STHeiti Medium.ttc"
font = lambda size: ImageFont.truetype(FONT, size)

# Measured .quick-wrap bounds at the browser's native 1280 x 720 viewport.
for name, bounds in {
    "quick-create": (367, 97, 913, 624),
    "quick-progress": (367, 67, 913, 654),
}.items():
    for suffix in ("", "-dark"):
        image = Image.open(SHOTS / f"{name}{suffix}.png").convert("RGB")
        image.crop(bounds).save(SHOTS / f"{name}{suffix}-crop.png")

canvas = Image.new("RGB", (1328, 1480), "#eeefed")
draw = ImageDraw.Draw(canvas)
draw.text((24, 20), "Tracelo / 项目卡片", font=font(25), fill="#302f2c")
draw.text((24, 57), "Notion 的灰白层次与柔和标签，Things 的原处展开与快捷录入。", font=font(16), fill="#686963")
canvas.paste(Image.open(SHOTS / "main.png").convert("RGB"), (24, 95))
draw.text((42, 844), "快捷新建", font=font(22), fill="#302f2c")
draw.text((692, 844), "快捷推进", font=font(22), fill="#302f2c")
for x, name in [(56, "quick-create"), (706, "quick-progress")]:
    image = Image.open(SHOTS / f"{name}-crop.png").convert("RGB")
    image = ImageOps.contain(image, (550, 568), Image.Resampling.LANCZOS)
    canvas.paste(image, (x + (550 - image.width) // 2, 888))
canvas.save(ROOT / "overview.png")
print("Created cropped quick-window captures and overview.png from browser screenshots.")
