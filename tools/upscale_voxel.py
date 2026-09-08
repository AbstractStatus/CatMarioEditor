"""
v11 重写：用 findContours(8-连通) + 去共线中间点
================================================
1) 每种颜色 mask 做 8-连通合并（把对角接触的阶梯像素算在一起）
2) cv2.findContours(RETR_CCOMP, CHAIN_APPROX_NONE) 拿到像素级边界
3) 删除连续共线的中间点（只保留真正的拐角）
4) 顶点 -0.5 → 网格顶点坐标，×k 放大
5) fillPoly(LINE_AA) 精确填充

关键：不去 approxPolyDP！只删共线点，保留所有真正的拐角顶点。
对于 45° 阶梯：每个小台阶的右→下 拐角都是真拐角，不共线，所以保留。
但 findContours(CHAIN_APPROX_NONE) 返回的点是每个边界像素的"一侧"点——
这正是用户说的"相邻矩阵顶点"。
"""

import os, sys, glob, ctypes, time

ROOT = os.path.join(os.path.dirname(__file__), '..', 'new', 'assets', 'sprites')
ORIG_ROOT = os.path.join(os.path.dirname(__file__), '..', 'new', 'assets', 'sprites_original')
TARGET_MAX = 3840
SKIP = {'_contact_sheet.png'}


def _bootstrap_cuda_dlls():
    site = os.path.join(sys.prefix, 'Lib', 'site-packages', 'nvidia')
    if not os.path.isdir(site):
        import site as _s
        for d in _s.getsitepackages() + [_s.getusersitepackages()]:
            if os.path.isdir(os.path.join(d, 'nvidia')):
                site = os.path.join(d, 'nvidia'); break
    if not os.path.isdir(site): return
    for dll in glob.glob(os.path.join(site, '*', 'bin', '*.dll')):
        try: os.add_dll_directory(os.path.dirname(dll))
        except Exception: pass
    for name in ('cudart64_12.dll','nvrtc-builtins64_123.dll','nvrtc64_120_0.dll'):
        hits = glob.glob(os.path.join(site, '*', 'bin', name))
        if hits:
            try: ctypes.CDLL(hits[0])
            except OSError: pass

_bootstrap_cuda_dlls()

import numpy as np
import cv2
from PIL import Image


def remove_collinear_loose(cnt):
    """
    删除共线中间点。用"方向变化阈值"判断：
    - 三点 p0,p1,p2 的前向向量 v1=p1-p0 和后向向量 v2=p2-p1
    - 如果归一化点积 > cos(25°)，认为近似共线，删除 p1
    25° 阈值：保守删除近似直线上的冗余点，但保留真正的拐角
    """
    pts = cnt.reshape(-1, 2).astype(np.float32)
    n = len(pts)
    if n <= 3: return pts

    COS_THRESH = np.cos(np.radians(25))  # ~0.906

    keep = np.ones(n, dtype=bool)
    for i in range(n):
        p0 = pts[i]
        p1 = pts[(i+1) % n]
        p2 = pts[(i+2) % n]
        v1 = p1 - p0
        v2 = p2 - p1
        n1 = np.linalg.norm(v1)
        n2 = np.linalg.norm(v2)
        if n1 < 0.5 or n2 < 0.5:
            keep[(i+1) % n] = False
            continue
        cos_a = np.dot(v1, v2) / (n1 * n2)
        if cos_a > COS_THRESH:
            keep[(i+1) % n] = False

    # 清理 + 必要时再次迭代（删除导致新共线）
    result = pts[keep]
    # 第二轮，删除新产生的共线
    if len(result) > 3:
        keep2 = np.ones(len(result), dtype=bool)
        for i in range(len(result)):
            p0 = result[i]
            p1 = result[(i+1) % len(result)]
            p2 = result[(i+2) % len(result)]
            v1 = p1 - p0
            v2 = p2 - p1
            n1 = np.linalg.norm(v1)
            n2 = np.linalg.norm(v2)
            if n1 < 0.5 or n2 < 0.5:
                keep2[(i+1) % len(result)] = False
                continue
            cos_a = np.dot(v1, v2) / (n1 * n2)
            if cos_a > COS_THRESH:
                keep2[(i+1) % len(result)] = False
        result = result[keep2]

    return result


def process(img_path):
    orig_path = os.path.join(ORIG_ROOT, os.path.relpath(img_path, ROOT))
    if not os.path.exists(orig_path):
        orig_path = img_path
    im = Image.open(orig_path).convert('RGBA')
    w, h = im.size
    k = max(1, round(TARGET_MAX / max(w, h)))

    arr0 = np.array(im)
    # nearest 放大作为内部像素基准
    im_nn = im.resize((w * k, h * k), Image.NEAREST)
    arr_big = np.array(im_nn)
    out = arr_big.copy()

    opaque = arr0[arr0[:, :, 3] > 0]
    if len(opaque) == 0:
        return im_nn
    unique_colors = np.unique(opaque.reshape(-1, 4), axis=0).astype(np.float32)

    for color in unique_colors:
        mask0 = ((arr0[:, :, :4].astype(np.float32) == color).all(axis=2) * 255).astype(np.uint8)
        if not mask0.any():
            continue

        # findContours 默认是 8-连通 mask + 4-连通边界追踪
        # 对于像素艺术（45° 阶梯），返回的轮廓是像素级阶梯边界
        contours, hierarchy = cv2.findContours(
            mask0, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
        if not contours:
            continue

        c_uint8 = color.astype(np.uint8).tolist()
        c_bgra = [c_uint8[2], c_uint8[1], c_uint8[0], c_uint8[3]]

        fill_polys = []
        hole_polys = []

        for i, cnt in enumerate(contours):
            if len(cnt) < 3: continue
            # 直接用 findContours 返回的精确像素边界点
            # 这些点就是用户说的"相邻矩阵的顶点"，不做任何简化
            # fillPoly 用这些整数坐标 → 精确轮廓
            # 顶点直接 ×k 放大（整数 × 整数 = 整数）
            pts_big = cnt.reshape(-1, 1, 2).astype(np.int32) * k

            if hierarchy is not None and hierarchy[0][i][3] != -1:
                hole_polys.append(pts_big)
            else:
                fill_polys.append(pts_big)

        if fill_polys:
            cv2.fillPoly(out, fill_polys, c_bgra, cv2.LINE_AA)
        if hole_polys:
            cv2.fillPoly(out, hole_polys, [0, 0, 0, 0], cv2.LINE_AA)

    # 调色板吸附
    if len(unique_colors) >= 1:
        pal_rgb = unique_colors[:, :3].astype(np.float32)
        visible = out[:, :, 3] > 0
        if visible.any():
            flat_rgb = out[visible, :3].astype(np.float32)
            best = np.full(flat_rgb.shape[0], np.inf)
            bi = np.zeros(flat_rgb.shape[0], dtype=np.int32)
            for i, pc in enumerate(pal_rgb):
                d = ((flat_rgb - pc[None, :]) ** 2).sum(axis=1)
                closer = d < best
                best[closer] = d[closer]; bi[closer] = i
            out[visible, :3] = pal_rgb[bi].astype(np.uint8)

    # 内部像素强制与 nearest 基准一致
    near_full_mask = out[:, :, 3] > 240
    rgb_diff = (out[:, :, :3] != arr_big[:, :, :3]).any(axis=2)
    fix = near_full_mask & rgb_diff
    out[fix] = arr_big[fix]

    return Image.fromarray(out, 'RGBA')


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
    t0 = time.time()
    for path in targets:
        try:
            out = process(path)
            out.save(path, 'PNG', optimize=False)
            count += 1
            rel = os.path.relpath(path, ROOT)
            print('  [%3d] %-42s -> %dx%d' % (count, rel, out.size[0], out.size[1]))
        except Exception as e:
            import traceback
            print('  ! FAIL %s: %s' % (os.path.relpath(path, ROOT), e))
            traceback.print_exc()
    print('\nDone. %d files in %.1fs.' % (count, time.time()-t0))


if __name__ == '__main__':
    main()
