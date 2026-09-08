"""
高清化预处理 v7 — LANCZOS 等比例放大 + 原图调色板吸附
------------------------------------------------------
LANCZOS 高质量重采样放大，边缘天然平滑；
然后把每个像素的 RGB 吸附到【原图小图的调色板】中最近的纯色，
消除重采样产生的大量中间混合色（灰边/脏色）。
抗锯齿完全靠 alpha 通道的平滑过渡（LANCZOS 保留），RGB 永远是原色。

用法：
  python tools/upscale_lanczos.py                 # 全部 97 张
  python tools/upscale_lanczos.py player/player_walk1.png   # 单张
恢复：robocopy assets\\sprites_original assets\\sprites /E
"""

import os, sys
from PIL import Image
import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), '..', 'new', 'assets', 'sprites')
ORIG_ROOT = os.path.join(os.path.dirname(__file__), '..', 'new', 'assets', 'sprites_original')
TARGET_MAX = 3840
SKIP = {'_contact_sheet.png'}


def process(img_path, hard_alpha=False, alpha_thresh=128):
    # 调色板/放大源都用【原图备份】，避免把已放大图的混合色当成调色板
    orig_path = os.path.join(ORIG_ROOT, os.path.relpath(img_path, ROOT))
    if not os.path.exists(orig_path):
        orig_path = img_path
    im = Image.open(orig_path).convert('RGBA')
    w, h = im.size

    # 原图调色板（不透明像素的唯一颜色）——放大后所有 RGB 都吸附到这些纯色
    arr0 = np.array(im)
    opaque = arr0[arr0[:, :, 3] > 0]
    if len(opaque) == 0:
        return im
    palette = np.unique(opaque.reshape(-1, 4), axis=0)[:, :3].astype(np.float32)  # N×3 RGB

    # 1) LANCZOS 等比例放大
    k = TARGET_MAX / max(w, h)
    new_size = (max(1, round(w * k)), max(1, round(h * k)))
    up = np.array(im.resize(new_size, Image.LANCZOS)).astype(np.float32)

    # 2) alpha 处理：硬边模式二值化，否则保留 LANCZOS 平滑过渡
    if hard_alpha:
        up[:, :, 3] = np.where(up[:, :, 3] > alpha_thresh, 255, 0).astype(np.float32)
    else:
        up[:, :, 3] = np.clip(up[:, :, 3], 0, 255)

    # 3) RGB 吸附到最近的调色板颜色（只吸附可见像素，透明区清零）
    visible = up[:, :, 3] > 0
    rgb = up[:, :, :3]
    best_dist = np.full(rgb.shape[:2], np.inf, dtype=np.float32)
    best_idx = np.zeros(rgb.shape[:2], dtype=np.int32)
    for i, pc in enumerate(palette):
        d = ((rgb - pc[None, None, :]) ** 2).sum(axis=2)
        closer = d < best_dist
        best_dist[closer] = d[closer]
        best_idx[closer] = i
    snapped = palette[best_idx]
    up[:, :, :3] = np.where(visible[:, :, None], snapped, 0)

    return Image.fromarray(up.astype(np.uint8), 'RGBA')


def main():
    args = sys.argv[1:]
    hard_alpha = 'hard' in args
    args = [a for a in args if a != 'hard']

    targets = []
    if args:
        # 单张模式：参数为相对 sprites 的路径
        rel = args[0].replace('\\', '/').lstrip('/')
        targets = [os.path.join(ROOT, rel)]
    else:
        for root, dirs, files in os.walk(ROOT):
            for fn in files:
                if fn.lower().endswith('.png') and fn not in SKIP:
                    targets.append(os.path.join(root, fn))

    mode = 'HARD-ALPHA' if hard_alpha else 'soft-alpha'
    count = 0
    errors = []
    for path in targets:
        try:
            out = process(path, hard_alpha=hard_alpha)
            out.save(path, 'PNG', optimize=False)
            count += 1
            rel = os.path.relpath(path, ROOT)
            print('  [%3d] %-42s -> %dx%d' % (count, rel, out.size[0], out.size[1]))
        except Exception as e:
            import traceback
            errors.append('  ! FAIL %s: %s' % (os.path.relpath(path, ROOT), e))
            traceback.print_exc()

    print('\nDone. %d files. LANCZOS + palette-snap (%s).' % (count, mode))
    if errors:
        print('\n%d errors:' % len(errors))
        for e in errors:
            print(e)


if __name__ == '__main__':
    main()
