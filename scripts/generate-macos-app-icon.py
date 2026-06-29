from pathlib import Path

from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
mark_path = root / 'src/assets/nexus-go-mark.png'
CANVAS_SIZE = 1024
ART_SIZE = 832
ART_PADDING = (CANVAS_SIZE - ART_SIZE) // 2
ART_RADIUS = round(ART_SIZE * 0.22)
ART_BOX = (ART_PADDING, ART_PADDING, ART_PADDING + ART_SIZE - 1, ART_PADDING + ART_SIZE - 1)
cyan = (34, 211, 238)
violet = (139, 92, 246)
blue = (59, 130, 246)
MARK_SCALE = 0.68


def blend(color_a, color_b, amount):
    return tuple(int(color_a[i] + (color_b[i] - color_a[i]) * amount) for i in range(3))


def sample_gradient(x, y):
    t = (x + y) / (2 * (CANVAS_SIZE - 1))
    if t <= 0.5:
        amount = t / 0.5
        return blend(cyan, violet, amount)
    amount = (t - 0.5) / 0.5
    return blend(violet, blue, amount)


def build_gradient_image(full_bleed: bool):
    if full_bleed:
        img = Image.new('RGBA', (CANVAS_SIZE, CANVAS_SIZE))
        pixels = img.load()
        for y in range(CANVAS_SIZE):
            for x in range(CANVAS_SIZE):
                color = sample_gradient(x, y)
                pixels[x, y] = (color[0], color[1], color[2], 255)
        return img

    layer = Image.new('RGBA', (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for y in range(ART_PADDING, ART_PADDING + ART_SIZE):
        for x in range(ART_PADDING, ART_PADDING + ART_SIZE):
            color = sample_gradient(x, y)
            draw.point((x, y), fill=(color[0], color[1], color[2], 255))
    mask = Image.new('L', (CANVAS_SIZE, CANVAS_SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(ART_BOX, radius=ART_RADIUS, fill=255)
    img = Image.composite(layer, Image.new('RGBA', (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0)), mask)
    border = Image.new('RGBA', (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    bd = ImageDraw.Draw(border)
    inner_left = ART_PADDING + 1
    inner_top = ART_PADDING + 1
    inner_right = ART_PADDING + ART_SIZE - 2
    inner_bottom = ART_PADDING + ART_SIZE - 2
    bd.rounded_rectangle(
        (inner_left, inner_top, inner_right, inner_bottom),
        radius=ART_RADIUS - 1,
        outline=(255, 255, 255, 64),
        width=2,
    )
    bd.rounded_rectangle(
        (inner_left + 2, inner_top + 2, inner_right - 2, inner_bottom - 2),
        radius=ART_RADIUS - 3,
        outline=(255, 255, 255, 24),
        width=1,
    )
    return Image.alpha_composite(img, border)


def white_mark(mark: Image.Image):
    pixels = mark.load()
    for y in range(mark.height):
        for x in range(mark.width):
            alpha = pixels[x, y][3]
            if alpha >= 32:
                pixels[x, y] = (255, 255, 255, 255)
            else:
                pixels[x, y] = (0, 0, 0, 0)
    return mark


def apply_mark(img: Image.Image, full_bleed: bool):
    mark = white_mark(Image.open(mark_path).convert('RGBA'))
    mark_basis = CANVAS_SIZE if full_bleed else ART_SIZE
    mark_size = int(mark_basis * MARK_SCALE)
    mark = mark.resize((mark_size, mark_size), Image.Resampling.LANCZOS)
    mark = white_mark(mark)
    mx = (CANVAS_SIZE - mark_size) // 2
    my = (CANVAS_SIZE - mark_size) // 2
    img.alpha_composite(mark, (mx, my))
    return img


apply_mark(build_gradient_image(True), True).save(root / 'build/icon.png')
ui_img = apply_mark(build_gradient_image(False), False)
for rel in ['public/nexus-logo.png', 'src/assets/nexus-logo.png']:
    ui_img.save(root / rel)
