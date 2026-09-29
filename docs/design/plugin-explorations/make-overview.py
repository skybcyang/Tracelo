"""Compose actual browser captures; never redraw or stretch the interface."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent
SHOTS = ROOT / "screenshots"
FONT = "/System/Library/Fonts/STHeiti Medium.ttc"
font = lambda size: ImageFont.truetype(FONT, size)
names = [
    ("cards", "A  项目卡片", "在卡片里展开与推进"),
    ("console", "B  任务调度台", "列表扫描，固定详情区"),
    ("journal", "C  今日推进", "时间流与上下文记录"),
    ("focus", "D  清单聚焦", "Things 3 参考，单列就地展开"),
]
# DOM-measured bounds at 1100 × 740; crop full viewport PNGs because the
# browser's clip API scales its contents incorrectly on this local runtime.
bounds = {
    "cards-quick-create": (280, 92, 820, 646),
    "cards-quick-progress": (280, 77, 820, 661),
    "console-quick-create": (240, 60, 860, 735),
    "console-quick-progress": (240, 107, 860, 631),
    "journal-quick-create": (265, 81, 835, 657),
    "journal-quick-progress": (265, 77, 835, 661),
    "focus-quick-create": (295, 142, 805, 596),
    "focus-quick-progress": (295, 130, 805, 608),
}
for key, box in bounds.items():
    for suffix in ("", "-neutral"):
        source = Image.open(SHOTS / f"{key}{suffix}-frame.png").convert("RGB")
        factor = source.width / 1100
        source.crop(tuple(round(v * factor) for v in box)).save(SHOTS / f"{key}{suffix}.png")

def overview(suffix=""):
    canvas = Image.new("RGB", (1640, 1320), "#f4f5f6")
    draw = ImageDraw.Draw(canvas)
    draw.text((35, 26), "Tracelo / 四种工作方式" + (" / 统一配色" if suffix else ""), font=font(29), fill="#263640")
    draw.text((35, 73), "同一组任务，四种信息结构与交互路径。实际浏览器截图，1100 × 740 插件窗格。", font=font(17), fill="#63747e")
    for i, (key, title, description) in enumerate(names):
        x, y = 30 + (i % 2) * 810, 126 + (i // 2) * 590
        draw.rounded_rectangle((x, y, x + 780, y + 563), 12, fill="#fcfdfd", outline="#d5dde2")
        draw.text((x + 18, y + 17), title, font=font(24), fill="#243640")
        draw.text((x + 18, y + 51), description, font=font(15), fill="#6b7b83")
        source = Image.open(SHOTS / f"{key}-main{suffix}.png").convert("RGB")
        source = ImageOps.contain(source, (752, 473), Image.Resampling.LANCZOS)
        canvas.paste(source, (x + (780 - source.width) // 2, y + 84))
    canvas.save(ROOT / f"overview{suffix}.png")

def quick_overview():
    canvas = Image.new("RGB", (1640, 1430), "#f4f5f6")
    draw = ImageDraw.Draw(canvas)
    draw.text((35, 28), "四套快捷工具 / 新建与记录", font=font(29), fill="#263640")
    draw.text((35, 77), "左侧：快捷新建    右侧：快捷记录；B 款先搜索，再进入编辑。", font=font(17), fill="#63747e")
    for i, (key, title, _) in enumerate(names):
        x, y = 30 + (i % 2) * 810, 126 + (i // 2) * 644
        draw.rounded_rectangle((x, y, x + 780, y + 615), 12, fill="#fcfdfd", outline="#d5dde2")
        draw.text((x + 20, y + 17), title, font=font(24), fill="#243640")
        for j, surface in enumerate(("quick-create", "quick-progress")):
            source = Image.open(SHOTS / f"{key}-{surface}.png").convert("RGB")
            source = ImageOps.contain(source, (360, 515), Image.Resampling.LANCZOS)
            draw.text((x + 20 + j * 386, y + 53), "快捷新建" if j == 0 else "快捷记录", font=font(15), fill="#64747d")
            canvas.paste(source, (x + 20 + j * 386 + (360 - source.width) // 2, y + 84 + (515 - source.height) // 2))
    canvas.save(ROOT / "quick-overview.png")

overview()
overview("-neutral")
quick_overview()
print("Composed 16 correctly cropped quick captures and 3 overview sheets.")
