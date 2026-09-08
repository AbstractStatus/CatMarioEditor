"""
高清化预处理 v9 — 像素边合并（矢量重绘，用户描述的"相邻像素顶点相连"）
-------------------------------------------------------------------------
核心思路：
  原图 (32×32) 每个像素看作一个 1×1 小方块
  对每种颜色：收集所有该色像素方块的边界边
  相邻同色像素之间的共享边 → 从边界集合中删除（内部边）
  剩余边界 → 拼合成闭合轮廓（外轮廓 + 内洞）
  在 ~4K 画布上，用轮廓点 ×k 坐标 + fillPoly(LINE_AA) 精确重绘

关键：
  - 不 approxPolyDP、不样条插值 → 轮廓点和像素顶点 1:1 对应，形状精确
  - LINE_AA 只对斜线边缘产生抗锯齿过渡
  - 颜色完全保留原图调色板

运行: python tools/upscale_vector_fill.py [单张路径]
恢复: robocopy assets\\sprites_original assets\\sprites /E
"""

import os, sys, glob, ctypes

ROOT = os.path.join(os.path.dirname(__file__), '..', 'new', 'assets', 'sprites')
ORIG_ROOT = os.path.join(os.path.dirname(__file__), '..', 'new', 'assets', 'sprites_original')
TARGET_MAX = 3840
SKIP = {'_contact_sheet.png'}


def _bootstrap_cuda_dlls():
    site = os.path.join(sys.prefix, 'Lib', 'site-packages', 'nvidia')
    if not os.path.isdir(site):
        import site as _s
        for d in _s.getsitepackages() + [_s.getusersitepackages()]:
            cand = os.path.join(d, 'nvidia')
            if os.path.isdir(cand):
                site = cand; break
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

# 尝试 GPU：轮廓提取是 CPU 瓶颈，fillPoly 纯 CPU 更快，GPU 可用于放大后的调色板吸附

try:
    import cupy as cp
    GPU_OK = True
except Exception:
    GPU_OK = False


# ---------- 核心：像素边合并 + 轮廓拼接 ----------

def build_outline(pixel_mask):
    """
    pixel_mask: H×W bool, 某颜色覆盖的像素
    返回: list of 点集 [[(x,y),...], ...]，每个闭合轮廓的顶点（像素坐标，H+1×W+1 网格）
    
    原理：
      对每个 mask[i,j] == True 的像素方块，4 条边加入边界集合
      相邻同色像素的共享边 → 各自会被加一次，用 set 去重时删除
      最终每条边界边都是唯一的线段，按方向标记后拼合成闭合环
    """
    H, W = pixel_mask.shape
    if not pixel_mask.any():
        return []

    # 用 cv2.findContours 在整数像素网格上直接取轮廓
    # 掩码 1 像素宽黑色边界 + findContours RETR_CCOMP 直接得到精确像素轮廓
    # 比手写边合并更健壮
    mask_u8 = (pixel_mask.astype(np.uint8)) * 255
    contours, hierarchy = cv2.findContours(
        mask_u8, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)

    if not contours:
        return []

    result = []
    hierarchy = hierarchy[0]
    for i, cnt in enumerate(contours):
        # 轮廓点是 findContours 返回的 (x,y) 整数像素坐标（mask 值变化处的像素中心）
        pts = cnt.reshape(-1, 2).astype(np.float32)
        # 像素中心坐标 → 像素顶点坐标（-0.5，让轮廓包住方块角）
        pts = pts - 0.5
        if len(pts) >= 3:
            result.append((i, hierarchy[i], pts))
    return result


def process(img_path):
    orig_path = os.path.join(ORIG_ROOT, os.path.relpath(img_path, ROOT))
    if not os.path.exists(orig_path):
        orig_path = img_path
    im = Image.open(orig_path).convert('RGBA')
    w, h = im.size
    k = max(1, round(TARGET_MAX / max(w, h)))

    arr0 = np.array(im)  # H0×W0×4 原图
    H0, W0 = arr0.shape[:2]
    # nearest 放大原图，得到 k×k 精确色块（内部基准）
    im_nn = im.resize((w * k, h * k), Image.NEAREST)
    arr_big = np.array(im_nn)
    out = arr_big.copy()

    # 调色板（仅不透明像素）
    opaque = arr0[arr0[:, :, 3] > 0]
    if len(opaque) == 0:
        return im_nn
    unique_colors = np.unique(opaque.reshape(-1, 4), axis=0).astype(np.float32)

    # ------ 关键改进：在【小图】上提取轮廓 + 简化 ------
    # 小图 findContours 拿到像素级阶梯边界（~105 点）
    # approxPolyDP 在小图上用 epsilon=0.8（不到 1 小像素），把同方向连续台阶合并成直线
    # 简化后的顶点数通常 15-25 个，真正的拐角点
    # 顶点 ×k 就得到大图精确坐标

    for color in unique_colors:
        # 小图 mask
        match0 = (arr0[:, :, :4].astype(np.float32) == color).all(axis=2)
        if not match0.any():
            continue
        mask0 = match0.astype(np.uint8) * 255

        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask0, connectivity=8)

        for lbl in range(1, num_labels):
            sx, sy, sw, sh, area = stats[lbl]
            region0 = (labels == lbl).astype(np.uint8) * 255

            if area < 2:
                # 极小块 nearest 放大直接写
                big = cv2.resize(region0, (sw * k, sh * k), interpolation=cv2.INTER_NEAREST)
                dst = out[sy*k:(sy+sh)*k, sx*k:(sx+sw)*k]
                dst[big > 0] = color.astype(np.uint8)
                out[sy*k:(sy+sh)*k, sx*k:(sx+sw)*k] = dst
                continue

            # 小图轮廓 + 简化
            contours, hierarchy = cv2.findContours(
                region0, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
            if not contours:
                continue

            fill_polys = []
            hole_polys = []
            for i, cnt in enumerate(contours):
                if len(cnt) < 3: continue
                # 小图上 approxPolyDP，epsilon 用 0.8 小像素
                # 含义：轮廓允许偏离原边界 0.8 个小像素
                # 效果：连续同方向的 45° 阶梯被合并成一条斜线；水平/垂直段不变
                cnt_simp = cv2.approxPolyDP(cnt, 1.0, closed=True)
                if len(cnt_simp) < 3:
                    cnt_simp = cnt
                # 小图像素中心坐标 → 顶点坐标 (-0.5)，再 ×k 放大
                pts = (cnt_simp.reshape(-1, 2).astype(np.float32) - 0.5) * k
                pts = pts.astype(np.int32)
                is_hole = (hierarchy is not None and hierarchy[0][i][3] != -1)
                (hole_polys if is_hole else fill_polys).append(pts)

            c_uint8 = color.astype(np.uint8).tolist()
            c_bgra = [c_uint8[2], c_uint8[1], c_uint8[0], c_uint8[3]]
            # 整块区域用 fillPoly(LINE_AA) 重绘
            # 内部像素 LINE_AA 精确填同色 → 和 nearest 一致
            # 边缘像素 LINE_AA 在简化后的斜线/直线上自然抗锯齿 → 消除阶梯
            if fill_polys:
                cv2.fillPoly(out, fill_polys, c_bgra, cv2.LINE_AA)
            if hole_polys:
                cv2.fillPoly(out, hole_polys, [0,0,0,0], cv2.LINE_AA)

    # 调色板吸附：LINE_AA 在边缘可能产生混合色 → 吸附回最近纯色
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

    # 内部像素 (alpha>240) 强制与 nearest 基准一致（fillPoly LINE_AA 零偏移保护）
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
    import time; t0 = time.time()
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
    print('\nDone. %d files in %.1fs (vector-fill).' % (count, time.time()-t0))


if __name__ == '__main__':
    main()
