# python split_sheet.py <sheet.png> <prefix> : split a turnaround sheet into views by empty (white) columns,
# each view padded to a square on white
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB'); W, H = im.size; px = im.load()
col = [any(sum(px[x, y]) < 700 for y in range(0, H, 2)) for x in range(W)]
runs = []; x = 0
while x < W:
    if col[x]:
        s = x
        while x < W and col[x]: x += 1
        if x - s > W * 0.05: runs.append((s, x))
    x += 1
names = ['front', 'side', 'back'] if len(runs) == 3 else [f'v{i}' for i in range(len(runs))]
for (a, b), n in zip(runs, names):
    rows = [y for y in range(H) if any(sum(px[xx, y]) < 700 for xx in range(a, b, 2))]
    box = (a, rows[0], b, rows[-1] + 1); crop = im.crop(box)
    side = int(max(crop.size) * 1.15); out = Image.new('RGB', (side, side), 'white')
    out.paste(crop, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2)); out.save(f'{sys.argv[2]}-{n}.png')
    print(n, box)
