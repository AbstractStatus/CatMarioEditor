"""
高清化预处理 v3 — Nearest-NN 放大 + 边缘平滑（一步完成）
--------------------------------------------------------
对每个 PNG：
  1) PIL Image.NEAREST 放大 k 倍到 ~4K（每个原始像素→k×k 纯色方块）
  2) 检测色块边界像素
  3) 只对**边缘像素带**做 Gaussian blur（内部不动）
  → 内部颜色块锐利 ✅，边界 3 像素柔和过渡 ✅
  → 缩略图看平滑 ✅，游戏里 nearest 两次采样还是锐利 ✅

运行: python tools/upscale_edge_smooth.py
恢复: robocopy assets\\sprites_original assets\\sprites /E
"""

import os, sys
from PIL import Image, ImageFilter
import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), '..', 'new', 'assets', 'sprites')
TARGET_MAX = 3840
EDGE_PAD = 4       # 边缘平滑带宽度（越大过渡越宽）
BLUR_RADIUS = 3.5   # 高斯模糊半径（越大越柔和）
SKIP = {'_contact_sheet.png'}


def find_edge_mask(arr):
    """arr H×W×4 RGBA → H×W bool True=边缘带（纯 NumPy 膨胀，零依赖）"""
    H, W = arr.shape[:2]
    mask = np.zeros((H, W), dtype=np.uint8)
    # 1) 检测上下左右相邻像素颜色不同
    mask[1:, :]  |= np.any(arr[1:, :, :] != arr[:-1, :, :], axis=2)
    mask[:, 1:]  |= np.any(arr[:, 1:, :] != arr[:, :-1, :], axis=2)
    if EDGE_PAD <= 0:
        return mask.astype(bool)
    # 2) 膨胀：每个边缘点周围 EDGE_PAD 范围内全 True
    expanded = np.zeros((H, W), dtype=np.uint8)
    for dy in range(-EDGE_PAD, EDGE_PAD + 1):
        for dx in range(-EDGE_PAD, EDGE_PAD + 1):
            ys0, ys1 = max(0, -dy), H - max(0, dy)
            yd0, yd1 = max(0,  dy), H - max(0, -dy)
            xs0, xs1 = max(0, -dx), W - max(0, dx)
            xd0, xd1 = max(0,  dx), W - max(0, -dx)
            if ys0 < ys1 and xs0 < xs1:
                expanded[yd0:yd1, xd0:xd1] |= mask[ys0:ys1, xs0:xs1]
    return expanded.astype(bool)


def process(img_path):
    """nearest 放大 + 边缘平滑，返回新 PIL.Image"""
    im = Image.open(img_path).convert('RGBA')
    w, h = im.size
    k = max(1, round(TARGET_MAX / max(w, h)))
    new_w, new_h = w * k, h * k

    # 1) nearest 放大
    im_nn = im.resize((new_w, new_h), Image.NEAREST)
    if k <= 2:
        return im_nn   # 很小的图不用平滑

    # 2) 边缘带 mask
    arr = np.array(im_nn)
    edge_mask = find_edge_mask(arr)

    # 3) 整张轻量高斯模糊
    im_blur = im_nn.filter(ImageFilter.GaussianBlur(radius=BLUR_RADIUS))
    arr_blur = np.array(im_blur)

    # 4) 合成：内部=锐，边缘带=柔
    out = np.where(edge_mask[:, :, None], arr_blur, arr)
    return Image.fromarray(out.astype(np.uint8))


def main():
    count = 0
    errors = []

    for root, dirs, files in os.walk(ROOT):
        for fn in files:
            if not fn.lower().endswith('.png') or fn in SKIP:
                continue
            path = os.path.join(root, fn)
            try:
                out = process(path)
                out.save(path, 'PNG', optimize=False)
                count += 1
                if count <= 5 or count % 10 == 0:
                    rel = os.path.relpath(path, ROOT)
                    print(f"  [{count:3d}] {rel:42s} -> {out.size[0]}x{out.size[1]}")
            except Exception as e:
                errors.append(f"  ! FAIL {os.path.relpath(path, ROOT)}: {e}")

    print(f"\nDone. {count} files processed.")
    if errors:
        print(f"\n{len(errors)} errors:")
        for e in errors:
            print(e)


if __name__ == '__main__':
    main()
