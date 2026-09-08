"""
高清化预处理 v6 — Nearest-NN 精确放大 + 轮廓抗锯齿重绘（不简化）
----------------------------------------------------------------
v5 的 alpha 模糊方法对斜线效果不够——斜线锯齿是因为黑像素变成 k×k 方块
后，阶梯状边缘没被真正消掉。

本方案：
  1) PIL Image.NEAREST 放大 k 倍到 ~4K（形状精确）
  2) 对每种颜色的连通域：cv2.findContours 拿**精确像素轮廓点**
     —— 不 approxPolyDP，不 Catmull-Rom，轮廓点就是原始像素位置
  3) cv2.fillPoly(contours, color, cv2.LINE_AA) 抗锯齿填充重绘
效果：
  - 轮廓点和原图像素 1:1 对应 → 形状绝对精确 ✅
  - 水平线垂直线边缘平行 → LINE_AA 过渡极窄，看不到 ✅
  - 斜线 45° 边缘 → LINE_AA 自动产生抗锯齿，锯齿消失 ✅
  - 内部完全覆盖纯色块 ✅

运行: python tools/upscale_contour_aa.py
恢复: robocopy assets\\sprites_original assets\\sprites /E
"""

import os, sys
from PIL import Image
import numpy as np
import cv2

ROOT = os.path.join(os.path.dirname(__file__), '..', 'new', 'assets', 'sprites')
TARGET_MAX = 3840
SKIP = {'_contact_sheet.png'}


def process(img_path):
    im = Image.open(img_path).convert('RGBA')
    w, h = im.size
    k = max(1, round(TARGET_MAX / max(w, h)))

    # 1) nearest 放大（形状精确，k×k 纯色方块）
    im_nn = im.resize((w * k, h * k), Image.NEAREST)
    arr = np.array(im_nn)
    out = np.zeros_like(arr)
    H, W = arr.shape[:2]

    # 加速：先在**小尺寸原图**上做轮廓（轮廓点数少 k² 倍），再把点坐标乘 k
    # 因为 nearest 放大是 k×k 纯色方块，所以小图轮廓×k  = 大图精确轮廓
    small = np.array(im)   # 原始小图 H0×W0
    H0, W0 = small.shape[:2]

    # 按颜色分组（RGBA 完全相同才算同色）——在小图上做，极快
    flat = small.reshape(-1, 4)
    visible_idx = np.where(flat[:, 3] > 0)[0]
    if not len(visible_idx):
        return im_nn

    unique_colors, color_ids = np.unique(flat[visible_idx], axis=0, return_inverse=True)

    for ci, color in enumerate(unique_colors):
        m = np.zeros(H0 * W0, dtype=np.uint8)
        m[visible_idx[color_ids == ci]] = 255
        mask = m.reshape(H0, W0).copy()

        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)

        for lbl in range(1, num_labels):
            x, y, bw, bh, area = stats[lbl]
            if area < 2:
                # 极小色块：直接 nearest 放大这块
                roi_src = (labels == lbl).astype(np.uint8) * 255
                roi_src = roi_src[y:y+bw, x:x+bh]
                big = cv2.resize(roi_src, (bw * k, bh * k), interpolation=cv2.INTER_NEAREST)
                out[y*k:(y+bw)*k, x*k:(x+bh)*k] = np.where(big[:,:,None] > 0, color, out[y*k:(y+bw)*k, x*k:(x+bh)*k])
                continue

            region = (labels == lbl).astype(np.uint8) * 255
            contours, hierarchy = cv2.findContours(region, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
            if not contours:
                continue

            fill_polys = []
            hole_polys = []
            for i, cnt in enumerate(contours):
                # 轮廓点直接 ×k → 大图精确坐标
                pts = (cnt.reshape(-1, 2).astype(np.int32)) * k
                if hierarchy is not None and hierarchy[0][i][3] != -1:
                    hole_polys.append(pts)
                else:
                    fill_polys.append(pts)

            if color[3] < 255:
                overlay = np.zeros_like(out)
                if fill_polys:
                    cv2.fillPoly(overlay, fill_polys, color.tolist(), cv2.LINE_AA)
                if hole_polys:
                    cv2.fillPoly(overlay, hole_polys, [0, 0, 0, 0], cv2.LINE_AA)
                a_mask = (overlay[:, :, 3].astype(np.float32) / 255) * (color[3] / 255.0)
                for c in range(4):
                    out[:, :, c] = (out[:, :, c].astype(np.float32) * (1 - a_mask) +
                                    overlay[:, :, c].astype(np.float32) * a_mask).astype(np.uint8)
            else:
                if fill_polys:
                    cv2.fillPoly(out, fill_polys, color.tolist(), cv2.LINE_AA)
                if hole_polys:
                    cv2.fillPoly(out, hole_polys, [0, 0, 0, 0], cv2.LINE_AA)

    return Image.fromarray(out, 'RGBA')


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

    print(f"\nDone. {count} files. contour_fillPoly_AA.")
    if errors:
        print(f"\n{len(errors)} errors:")
        for e in errors:
            print(e)


if __name__ == '__main__':
    main()
