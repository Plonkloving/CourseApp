from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SIZE = 512
OUTPUT = Path(__file__).resolve().parents[1] / "app" / "src" / "main" / "res" / "drawable-nodpi" / "course_icon.png"


def load_font(size: int):
    for candidate in (Path("C:/Windows/Fonts/msyhbd.ttc"), Path("C:/Windows/Fonts/msyh.ttc")):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((28, 28, 484, 484), radius=112, fill="#173B57")
draw.rounded_rectangle((96, 126, 416, 420), radius=48, fill="#FBFAF7")
draw.rounded_rectangle((96, 126, 416, 220), radius=48, fill="#E87545")
draw.rectangle((96, 182, 416, 220), fill="#E87545")
for x in (200, 312):
    draw.rounded_rectangle((x - 13, 84, x + 13, 166), radius=13, fill="#B8CEDA")

text = "课"
font = load_font(164)
box = draw.textbbox((0, 0), text, font=font)
draw.text(((SIZE - box[2] + box[0]) / 2, 226), text, font=font, fill="#173B57")
image.save(OUTPUT, optimize=True)
