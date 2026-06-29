import json
import shutil
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
mark_source = root / 'src/assets/nexus-go-mark.png'
icon_bundle = root / 'build/Nexus.icon'
assets_dir = icon_bundle / 'Assets'
CANVAS_SIZE = 1024
MARK_SCALE = 0.68
cyan = (34, 211, 238)
violet = (139, 92, 246)
blue = (59, 130, 246)


def blend(color_a, color_b, amount):
    return tuple(int(color_a[i] + (color_b[i] - color_a[i]) * amount) for i in range(3))


def binarize_white_mark(mark: Image.Image, alpha_threshold: int = 48):
    pixels = mark.load()
    for y in range(mark.height):
        for x in range(mark.width):
            if pixels[x, y][3] >= alpha_threshold:
                pixels[x, y] = (255, 255, 255, 255)
            else:
                pixels[x, y] = (0, 0, 0, 0)


def build_white_mark_layer():
    source = Image.open(mark_source).convert('RGBA')
    binarize_white_mark(source)
    mark_size = int(CANVAS_SIZE * MARK_SCALE)
    resized = source.resize((mark_size, mark_size), Image.Resampling.LANCZOS)
    binarize_white_mark(resized, alpha_threshold=32)
    canvas = Image.new('RGBA', (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    offset = (CANVAS_SIZE - mark_size) // 2
    canvas.alpha_composite(resized, (offset, offset))
    binarize_white_mark(canvas, alpha_threshold=32)
    return canvas


def write_background_png(target: Path):
    img = Image.new('RGBA', (CANVAS_SIZE, CANVAS_SIZE))
    pixels = img.load()
    for y in range(CANVAS_SIZE):
        for x in range(CANVAS_SIZE):
            t = (x + y) / (2 * (CANVAS_SIZE - 1))
            if t <= 0.5:
                color = blend(cyan, violet, t / 0.5)
            else:
                color = blend(violet, blue, (t - 0.5) / 0.5)
            pixels[x, y] = (color[0], color[1], color[2], 255)
    img.alpha_composite(build_white_mark_layer())
    img.save(target)


def write_icon_json(target: Path):
    document = {
        'fill': {
            'automatic-gradient': 'extended-srgb:0.54510,0.36078,0.96471,1.00000',
        },
        'groups': [
            {
                'layers': [
                    {
                        'glass': True,
                        'image-name': 'Background.png',
                        'name': 'Background',
                    },
                ],
                'lighting': 'individual',
                'shadow': {'kind': 'neutral', 'opacity': 0.5},
                'specular': True,
                'translucency': {'enabled': True, 'value': 0.5},
            },
        ],
        'supported-platforms': {'squares': 'shared'},
    }
    target.write_text(json.dumps(document, indent=2) + '\n', encoding='utf-8')


if assets_dir.exists():
    shutil.rmtree(assets_dir)
assets_dir.mkdir(parents=True, exist_ok=True)
write_background_png(assets_dir / 'Background.png')
write_icon_json(icon_bundle / 'icon.json')
