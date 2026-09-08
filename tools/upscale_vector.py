"""
高清化预处理 v4 — 轮廓矢量化 + 抗锯齿曲线重绘
-----------------------------------------------
原理（替代 potrace 的纯 cv2 实现）：
  1) 对原图按颜色分组（去 alpha=0 的透明像素）
  2) 每种颜色内 cv2.connectedComponents 分成独立色块
  3) 每个色块 cv2.findContours 得到轮廓 → cv2.approxPolyDP 简化多边形
  4) 顶点过少(≤3) → 直接按原像素 nearest 放大
  5) 顶点足够 → Catmull-Rom 样条插值加密顶点，让曲线圆滑
  6) 在 4K 画布上 cv2.fillPoly(抗锯齿 LINE_AA) + polylines 重绘边界
→ 矢量级平滑曲线，零锯齿！
→ 小色块（≤4顶点）回退 nearest 保证游戏中还是锐利
→ 大色块用曲线重绘 → 缩略图/边缘都平滑

运行: python tools/upscale_vector.py
恢复: robocopy assets\\sprites_original assets\\sprites /E
"""

import os, sys
import numpy as np
import cv2
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'new', 'assets', 'sprites')
TARGET_MAX = 3840
SKIP = {'_contact_sheet.png'}

# 轮廓简化参数：越小越精细
POLY_EPSILON_RATIO = 0.015   # approxPolyDP epsilon = 周长 * 此值
MIN_VERTICES_FOR_SPLINE = 4  # 顶点数 > 这个才做样条插值


def catmull_rom_chain(points, segments_per_span=20):
    """
    Catmull-Rom 样条：N 个输入点 → (N-1)*segments_per_span 个输出点。
    用 1,0,0,1 保证首尾和输入点重合。
    points: list of [x, y] int
    """
    pts = np.array(points, dtype=np.float64)
    # 把首尾各复制一份，让曲线经过原始端点
    if len(pts) >= 2:
        pts = np.vstack([pts[0:1], pts, pts[-2:-1] if len(pts) > 2 else pts[-1:]])
    out = []
    for i in range(len(pts) - 3):
        p0, p1, p2, p3 = pts[i], pts[i+1], pts[i+2], pts[i+3]
        for s in range(segments_per_span):
            t = s / segments_per_span
            t2 = t * t
            t3 = t2 * t
            p = 0.5 * ((2*p1) +
                       (-p0 + p2) * t +
                       (2*p0 - 5*p1 + 4*p2 - p3) * t2 +
                       (-p0 + 3*p1 - 3*p2 + p3) * t3)
            out.append(p)
    return np.array(out, dtype=np.float64)


def simplify_contour(contour):
    """cv2 approxPolyDP，让多边形顶点数合理"""
    perimeter = cv2.arcLength(contour, True)
    epsilon = POLY_EPSILON_RATIO * perimeter
    approx = cv2.approxPolyDP(contour, epsilon, True)
    return approx.reshape(-1, 2)


def fill_color_region(output, mask_color, src_xform, k, x_offset, y_offset):
    """
    mask_color: tuple/list of 4 numpy-friendly values → 必须转 Python int 给 cv2
    """
    # 关键：cv2.fillPoly 需要原生 Python int，numpy.uint8 会报错
    color_bgra = [int(c) for c in mask_color]
    color_bgr = color_bgra[:3]
    alpha = color_bgra[3]
    src_xform = np.ascontiguousarray(src_xform)
    H, W = src_xform.shape
    output_x0 = x_offset
    output_y0 = y_offset

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(src_xform, connectivity=8)

    for lbl in range(1, num_labels):   # 0 = background
        x, y, w, h, area = stats[lbl]
        if area < 2:
            # 单点或 2 像素，直接 nearest 画
            mask = (labels == lbl).astype(np.uint8) * 255
            resized = cv2.resize(mask, (w * k, h * k), interpolation=cv2.INTER_NEAREST)
            roi = output[output_y0 + y*k: output_y0 + (y+h)*k,
                         output_x0 + x*k: output_x0 + (x+w)*k]
            # 混合 color 到 roi（alpha * 区域）
            if alpha < 255:
                alpha_mask = resized.astype(np.float32) / 255 * (alpha / 255.0)
                for c in range(3):
                    roi[:, :, c] = (roi[:, :, c].astype(np.float32) * (1 - alpha_mask) +
                                    float(color_bgr[c]) * alpha_mask).astype(np.uint8)
                roi[:, :, 3] = np.maximum(roi[:, :, 3],
                                          (alpha_mask * 255).astype(np.uint8))
            else:
                roi[resized > 0] = color_bgra
            continue

        # 提取这个连通域的 bbox 轮廓
        region = (labels == lbl).astype(np.uint8) * 255
        contours, hierarchy = cv2.findContours(region, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue

        # 把轮廓点转成绝对坐标（大图）
        big_contours = []
        holes = []   # 第 i 个 contour 是否是 hole
        for ci, cnt in enumerate(contours):
            cnt_big = cnt * k + np.array([output_x0 + x*k, output_y0 + y*k])
            big_contours.append(cnt_big.astype(np.int32))
            # hierarchy: [Next, Prev, First_Child, Parent]
            holes.append(hierarchy[0][ci][3] != -1 if hierarchy is not None else False)

        # 简化 + 平滑（只对简单多边形，避免样条自相交）
        smoothed = []
        for ci, cnt in enumerate(big_contours):
            flat = cnt.reshape(-1, 2)
            flat = simplify_contour(flat).astype(np.float64)
            if len(flat) >= MIN_VERTICES_FOR_SPLINE and not holes[ci]:
                try:
                    spline = catmull_rom_chain(flat, segments_per_span=max(6, k // 2))
                    smoothed.append(spline.astype(np.int32))
                except Exception:
                    smoothed.append(flat.astype(np.int32))
            else:
                smoothed.append(flat.astype(np.int32))

        # 填充（支持 holes）
        fill_polys = []
        hole_polys = []
        for ci, cnt in enumerate(smoothed):
            if holes[ci]:
                hole_polys.append(cnt)
            else:
                fill_polys.append(cnt)

        # 用 alpha 通道做透明混合
        if alpha < 255:
            overlay = np.zeros_like(output)
            cv2.fillPoly(overlay, fill_polys, color_bgra, cv2.LINE_AA)
            if hole_polys:
                cv2.fillPoly(overlay, hole_polys, [0, 0, 0, 0], cv2.LINE_AA)
            # 把 overlay alpha 通道乘 alpha
            a_mask = (overlay[:, :, 3].astype(np.float32) / 255) * (alpha / 255.0)
            for c in range(3):
                output[:, :, c] = (output[:, :, c].astype(np.float32) * (1 - a_mask) +
                                   overlay[:, :, c].astype(np.float32) * a_mask).astype(np.uint8)
            output[:, :, 3] = np.maximum(output[:, :, 3], (a_mask * 255).astype(np.uint8))
        else:
            cv2.fillPoly(output, fill_polys, color_bgra, cv2.LINE_AA)
            if hole_polys:
                cv2.fillPoly(output, hole_polys, [0, 0, 0, 0], cv2.LINE_AA)


def vectorize(path, k):
    """对单个 PNG 做轮廓矢量化重绘"""
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        return None
    H, W = im.shape[:2]
    # 保证 BGRA 格式
    if im.ndim == 2:
        im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGRA)
    elif im.shape[2] == 3:
        im = cv2.cvtColor(im, cv2.COLOR_BGR2BGRA)

    # 输出画布（k 倍）
    out_W, out_H = W * k, H * k
    output = np.zeros((out_H, out_W, 4), dtype=np.uint8)

    # 按颜色分组（BGR + A 一起分组）
    pixels = im.reshape(-1, 4)
    # 去掉完全透明的
    visible_mask = pixels[:, 3] > 0
    visible_idx = np.where(visible_mask)[0]
    if not len(visible_idx):
        return Image.fromarray(output, 'RGBA')

    unique_colors, color_ids = np.unique(pixels[visible_idx], axis=0, return_inverse=True)

    # 为每种颜色建立 mask（正确用 np.where 后的绝对索引）
    flat = np.zeros(H * W, dtype=np.uint8)
    for color_idx, color in enumerate(unique_colors):
        flat[visible_idx[color_ids == color_idx]] = 255
        mask = flat.reshape(H, W).copy()  # 必须 copy！reshape 是 view，flat 清零会把 mask 也清掉
        flat[visible_idx[color_ids == color_idx]] = 0
        fill_color_region(output, tuple(color), mask, k, 0, 0)

    return Image.fromarray(cv2.cvtColor(output, cv2.COLOR_BGRA2RGBA), 'RGBA')


def main():
    count = 0
    errors = []

    for root, dirs, files in os.walk(ROOT):
        for fn in files:
            if not fn.lower().endswith('.png') or fn in SKIP:
                continue
            path = os.path.join(root, fn)
            try:
                im_pil = Image.open(path)
                w, h = im_pil.size
                k = max(1, round(TARGET_MAX / max(w, h)))
                out = vectorize(path, k)
                if out is not None:
                    out.save(path, 'PNG', optimize=False)
                count += 1
                if count <= 5 or count % 10 == 0:
                    rel = os.path.relpath(path, ROOT)
                    print(f"  [{count:3d}] {rel:42s}  {w:4d}x{h:<4d} x{k:3d}")
            except Exception as e:
                import traceback
                errors.append(f"  ! FAIL {os.path.relpath(path, ROOT)}: {e}")
                traceback.print_exc()

    print(f"\nDone. {count} files vectorized.")
    if errors:
        print(f"\n{len(errors)} errors:")
        for e in errors:
            print(e)


if __name__ == '__main__':
    main()
