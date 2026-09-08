"""
高清化预处理 v5 — Nearest-NN 精确放大 + Alpha 边缘抗锯齿
-----------------------------------------------------------
关键：**形状 100% 和原图一致**，只在边缘做 alpha 抗锯齿（不碰颜色、不碰轮廓）。

流程：
  1) PIL Image.NEAREST 放大 k 倍到 ~4K
  2) 对 alpha 通道单独做 cv2.GaussianBlur → 边缘像素的 alpha 变成渐变色
     （原来 alpha=255 的边缘，现在变成 alpha=100~200 的过渡）
  3) 颜色通道完全不动（保持每个原始像素→k×k 纯色块，形状精确）
效果：
  - 形状和原版完全一致 ✅（nearest 放大）
  - 边缘没有锯齿 ✅（alpha 抗锯齿）
  - 内部颜色块锐利 ✅（blur 只影响 alpha，不影响 RGB）

运行: python tools/upscale_alpha_smooth.py
恢复: robocopy assets\\sprites_original assets\\sprites /E
"""

import os, sys
from PIL import Image
import numpy as np
import cv2

ROOT = os.path.join(os.path.dirname(__file__), '..', 'new', 'assets', 'sprites')
TARGET_MAX = 3840
ALPHA_BLUR_RADIUS = 2.5   # alpha 通道高斯模糊半径（越大边缘过渡越宽）
SKIP = {'_contact_sheet.png'}


def process(img_path):
    im = Image.open(img_path).convert('RGBA')
    w, h = im.size
    k = max(1, round(TARGET_MAX / max(w, h)))

    # 1) nearest 放大（形状精确）
    im_nn = im.resize((w * k, h * k), Image.NEAREST)
    arr = np.array(im_nn)   # H×W×4 RGBA

    # 2) 只对 alpha 通道做高斯模糊（边缘抗锯齿）
    alpha = arr[:, :, 3].astype(np.float32)
    # 先归一化到 0-1 再 blur，避免 uint8 边界问题
    alpha_n = alpha / 255.0
    alpha_smooth = cv2.GaussianBlur(alpha_n, (0, 0), sigmaX=ALPHA_BLUR_RADIUS, sigmaY=ALPHA_BLUR_RADIUS)
    # gamma=1.0，保持内部 alpha=1 的地方还是 1
    # 内部纯色区域本来就是 alpha=1，blur 后还是≈1（大面积相同值 blur 不变）
    arr[:, :, 3] = np.clip(alpha_smooth * 255, 0, 255).astype(np.uint8)

    return Image.fromarray(arr, 'RGBA')


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
                import traceback
                errors.append(f"  ! FAIL {os.path.relpath(path, ROOT)}: {e}")
                traceback.print_exc()

    print(f"\nDone. {count} files. alpha_blur_radius={ALPHA_BLUR_RADIUS}")
    if errors:
        print(f"\n{len(errors)} errors:")
        for e in errors:
            print(e)


if __name__ == '__main__':
    main()
