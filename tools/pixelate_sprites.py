"""
高清化预处理脚本
------------------
把 assets/sprites 里的 PNG 全部做像素马赛克处理：
  1) 放大到 4K（最长边 3840px，PIL LANCZOS 双线性）
  2) 按 BLOCK_SIZE 分块（默认 60px）
  3) 每块取中心像素颜色，fill 整个色块
  4) 输出 PNG 覆盖原图

旧文件已备份到 assets/sprites_original（robocopy 命令手动跑）。
运行: python tools/pixelate_sprites.py
"""

import os, sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'new', 'assets', 'sprites')
BLOCK_SIZE = 60
TARGET_MAX = 3840   # 4K 最长边
SKIP = {'_contact_sheet.png'}

def pixelate(img_path, block_size=BLOCK_SIZE):
    im = Image.open(img_path).convert('RGBA')
    w, h = im.size
    # 1) 放大到 4K
    scale = max(1, TARGET_MAX / max(w, h))
    up_w = int(round(w * scale))
    up_h = int(round(h * scale))
    up = im.resize((up_w, up_h), Image.LANCZOS)

    # 2) 分块取中心色
    cols = (up_w + block_size - 1) // block_size
    rows = (up_h + block_size - 1) // block_size
    out_w = cols * block_size
    out_h = rows * block_size
    out = Image.new('RGBA', (out_w, out_h))

    px = up.load()
    out_px = out.load()
    for r in range(rows):
        for c in range(cols):
            cx = min(up_w - 1, int((c + 0.5) * block_size))
            cy = min(up_h - 1, int((r + 0.5) * block_size))
            color = px[cx, cy]
            for dy in range(block_size):
                for dx in range(block_size):
                    x = c * block_size + dx
                    y = r * block_size + dy
                    if x < out_w and y < out_h:
                        out_px[x, y] = color
    return out

def main():
    count = 0
    total_in = 0
    total_out = 0
    for root, dirs, files in os.walk(ROOT):
        for fn in files:
            if not fn.lower().endswith('.png'):
                continue
            if fn in SKIP:
                continue
            path = os.path.join(root, fn)
            try:
                size_before = os.path.getsize(path)
                im = pixelate(path)
                im.save(path, 'PNG', optimize=True)
                size_after = os.path.getsize(path)
                total_in += size_before
                total_out += size_after
                count += 1
                print(f"  [{count:3d}] {os.path.relpath(path, ROOT)}  "
                      f"{size_before//1024:4d}KB -> {size_after//1024:4d}KB  "
                      f"({im.size[0]}x{im.size[1]})")
            except Exception as e:
                print(f"  ! FAIL {os.path.relpath(path, ROOT)}: {e}", file=sys.stderr)

    print(f"\nDone. {count} files processed. "
          f"Total {total_in//1024}KB -> {total_out//1024}KB "
          f"(ratio {total_out/total_in:.2f}x)")

if __name__ == '__main__':
    main()
