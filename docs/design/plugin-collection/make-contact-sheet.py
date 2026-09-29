"""Compose review sheets from actual browser captures; no generated UI artwork."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
PALETTES = [
    ('evergreen', 'A  Evergreen', '#356d54'),
    ('motorsport', 'B  Motorsport', '#204774'),
    ('afterglow', 'C  Afterglow', '#77ecdb'),
    ('graphite', 'D  Graphite', '#b6a5ef'),
    ('glacier', 'E  Glacier', '#2862a2'),
    ('vermilion', 'F  Vermilion', '#ac4934'),
]

def make_sheet(screen, title, output):
    canvas = Image.new('RGB', (1800, 1080), '#f5f5f3')
    draw = ImageDraw.Draw(canvas)
    heading = ImageFont.truetype(FONT, 31)
    label = ImageFont.truetype(FONT, 21)
    small = ImageFont.truetype(FONT, 15)
    draw.text((30, 22), title, font=heading, fill='#25292e')
    draw.text((31, 66), 'Tracelo / six compact directions / actual browser captures / 2026.09.29', font=small, fill='#6e766c')
    for index, (key, name, accent) in enumerate(PALETTES):
        x, y = 30 + (index % 3) * 590, 110 + (index // 3) * 480
        draw.rounded_rectangle((x, y, x + 560, y + 453), radius=9, fill='#fcfdfa', outline='#d7dcd4')
        draw.text((x + 17, y + 14), name, font=label, fill='#29332c')
        draw.ellipse((x + 520, y + 17, x + 536, y + 33), fill=accent)
        source = Image.open(ROOT / 'screenshots' / f'{key}-{screen}.png').convert('RGB')
        # Keep the complete real shortcut window, but omit unused desktop margins.
        if screen != 'board':
            source = source.crop((245, 0, 855, source.height))
        source.thumbnail((534, 388), Image.Resampling.LANCZOS)
        canvas.paste(source, (x + (560-source.width)//2, y + 54 + (388-source.height)//2))
    canvas.save(ROOT / output, optimize=True)

make_sheet('board', 'Plugin workspace', 'overview.png')
make_sheet('quick-create', 'Quick capture', 'quick-overview.png')
make_sheet('quick-progress', 'Quick progress', 'progress-overview.png')
