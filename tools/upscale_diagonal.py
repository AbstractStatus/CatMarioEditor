"""
高清化预处理 v13-1 — 回到 v13 最干净版（端点在中心，不延伸）
=============================================================

核心：
  - nearest-neighbor 放大 k 倍作底图
  - 扫描 2 个对角方向，同色对角对 + 边缘检测
  - cv2.line lineType=8 thickness=k
  - 端点在方块中心
  - 亮色先画，黑色最后画覆盖
  - 跳过白色像素

运行: python tools/upscale_diagonal.py bg/bg_tree_round.png
"""

import os, sys, math
from collections import defaultdict
import numpy as np
import cv2
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..', 'new', 'assets', 'sprites')
ORIG_ROOT = os.path.join(os.path.dirname(__file__), '..', 'new', 'assets', 'sprites_original')
TARGET_MAX = 3840
SKIP = {'_contact_sheet.png'}


def diagonal_upscale(path, k):
    orig_path = os.path.join(ORIG_ROOT, os.path.relpath(path, ROOT))
    if not os.path.exists(orig_path):
        orig_path = path
    im = cv2.imread(orig_path, cv2.IMREAD_UNCHANGED)
    if im is None:
        return None
    H, W = im.shape[:2]
    if im.ndim == 2:
        im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGRA)
    elif im.shape[2] == 3:
        im = cv2.cvtColor(im, cv2.COLOR_BGR2BGRA)

    base = cv2.resize(im, (W * k, H * k), interpolation=cv2.INTER_NEAREST)
    # 用 PIL Image 当 overlay，ImageDraw.line 用 butt cap（方形端点）！
    overlay_pil = Image.new('RGBA', (W * k, H * k), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay_pil)

    diagonals = [(1, 1), (1, -1)]

    color_groups = defaultdict(list)

    for dy, dx in diagonals:
        y_start = 0 if dy > 0 else -dy
        y_end   = H - dy if dy > 0 else H
        x_start = 0 if dx > 0 else -dx
        x_end   = W - dx if dx > 0 else W

        for y in range(y_start, y_end):
            for x in range(x_start, x_end):
                a = im[y, x]
                b = im[y + dy, x + dx]
                if a[3] == 0 or b[3] == 0:
                    continue
                if not np.array_equal(a, b):
                    continue
                # 跳过白色
                if int(a[0]) >= 250 and int(a[1]) >= 250 and int(a[2]) >= 250:
                    continue

                # 缝隙暴露判定（正交）：对角对 A、B 共享角点，只要有一个正交邻居
                # (x+dx,y) 或 (x,y+dy) 与 A 同色，同色区域就已通过它连通，
                # 角点处没有对角缝隙，跳过；两个正交邻居都不同色（透明或异色）
                # 时 A、B 仅角接触，缝隙暴露，才需要画线填补
                def _same(nx, ny):
                    if nx < 0 or nx >= W or ny < 0 or ny >= H:
                        return False
                    p = im[ny, nx]
                    return p[3] > 0 and np.array_equal(p, a)

                if _same(x + dx, y) or _same(x, y + dy):
                    continue

                # A, B 中心
                ax, ay = int(x * k + k / 2), int(y * k + k / 2)
                bx, by = int((x + dx) * k + k / 2), int((y + dy) * k + k / 2)
                pt1, pt2 = (ax, ay), (bx, by)

                color_key = (int(a[0]), int(a[1]), int(a[2]), int(a[3]))
                bright = (int(a[2]) + int(a[1]) + int(a[0])) / 3.0
                color_groups[color_key].append((bright, pt1, pt2))

    # 亮色先画，暗色后画
    sorted_colors = sorted(color_groups.items(),
                           key=lambda kv: -np.mean([b for b, _, _ in kv[1]]))

    for color_key, items in sorted_colors:
        # PIL 用 RGBA
        rgba = (int(color_key[2]), int(color_key[1]), int(color_key[0]), int(color_key[3]))
        for bright, pt1, pt2 in items:
            draw.line([pt1, pt2], fill=rgba, width=int(k * 1.5))

    overlay = cv2.cvtColor(np.array(overlay_pil), cv2.COLOR_RGBA2BGRA)
    # 亮度门控：不透明底上，线段颜色不得比底色亮。原因：线宽 1.5k 的
    # 半宽(0.75k)大于线段半长(0.707k)，在棋盘格拐角处两条垂直线段的
    # 矩形角会互相戳出，亮色线段以 ~0.06k 细条侵入暗色方块（月牙残留）。
    # 黑色线段永远最暗不受影响；透明底不受限（保持镂空处轮廓连续）。
    lb = base[:, :, :3].sum(axis=2, dtype=np.int16)
    lo = overlay[:, :, :3].sum(axis=2, dtype=np.int16)
    mask = (overlay[:, :, 3] > 0) & ((base[:, :, 3] == 0) | (lo <= lb))
    base[mask] = overlay[mask]
    return Image.fromarray(cv2.cvtColor(base, cv2.COLOR_BGRA2RGBA), 'RGBA')


def main():
    args = sys.argv[1:]
    targets = []
    if args:
        rel = args[0].replace('\\', '/').lstrip('/')
        targets = [os.path.join(ROOT, rel)]
    else:
        for root, dirs, files in os.walk(ROOT):
            for fn in files:
                if fn.lower().endswith('.png') and fn not in SKIP:
                    targets.append(os.path.join(root, fn))

    count = 0
    for path in targets:
        orig_path = os.path.join(ORIG_ROOT, os.path.relpath(path, ROOT))
        if not os.path.exists(orig_path):
            orig_path = path
        im_pil = Image.open(orig_path)
        w, h = im_pil.size
        k = max(1, round(TARGET_MAX / max(w, h)))
        rel = os.path.relpath(path, ROOT)
        print(f"  [{count+1:3d}] {rel:42s}  {w:4d}x{h:<4d} x{k:3d}")
        out = diagonal_upscale(path, k)
        if out is not None:
            out.save(path, 'PNG', optimize=False)
        count += 1
    print(f"\nDone. {count} files.")


if __name__ == '__main__':
    main()
