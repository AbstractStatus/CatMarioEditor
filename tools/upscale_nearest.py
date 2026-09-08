"""
高清化预处理脚本 v2 — Nearest-Neighbor（最近邻）放大
-----------------------------------------------------
原理：Windows 10 图片查看器放大像素艺术时用的就是 nearest-neighbor，
      每个原始像素直接变成一个 K×K 的锐利大方块，零插值模糊。

流程：
  1) 读 manifest.js，拿每张图的 w/h 和 file 路径
  2) 对每张原图算 k = round(3840 / max(w, h)) —— 保证最长边 ≈ 4K
  3) PIL Image.NEAREST 放大 k 倍（纯复制像素，不做任何插值）
  4) 保存新 PNG 覆盖原图
  5) manifest.js 里 w/h 同步 ×k，保持 drawImage 逻辑不变

原图需已在 assets/sprites_original/ 中备份（robocopy 手动跑一次即可）。
运行: python tools/upscale_nearest.py
恢复: robocopy assets\\sprites_original assets\\sprites /E
"""

import os, sys, re, json
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'new', 'assets', 'sprites')
MANIFEST = os.path.join(ROOT, 'manifest.js')
TARGET_MAX = 3840   # 放大后最长边 ≈ 4K
SKIP = {'_contact_sheet.png'}

def load_manifest(path):
    with open(path, 'r', encoding='utf-8') as f:
        raw = f.read()
    m = re.search(r'window\.SPRITE_MANIFEST\s*=\s*(\{.*\})\s*;?\s*$', raw, re.DOTALL)
    if not m:
        raise ValueError("manifest.js 格式不匹配")
    return json.loads(m.group(1))

def save_manifest(path, data):
    body = json.dumps(data, ensure_ascii=False, indent=1)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// 由 tools/upscale_nearest.py 自动生成\n')
        f.write('window.SPRITE_MANIFEST = ')
        f.write(body)
        f.write('\n')

def main():
    manifest = load_manifest(MANIFEST)
    sprites = manifest.get('sprites', [])

    count = 0
    errors = []

    for s in sprites:
        fn = s['file']
        if fn in SKIP:
            continue
        path = os.path.join(ROOT, fn)
        if not os.path.exists(path):
            errors.append(f"  ! MISSING: {fn}")
            continue

        old_w = s['w']
        old_h = s['h']
        k = max(1, round(TARGET_MAX / max(old_w, old_h)))
        new_w = old_w * k
        new_h = old_h * k

        try:
            im = Image.open(path).convert('RGBA')
            im = im.resize((new_w, new_h), Image.NEAREST)
            im.save(path, 'PNG', optimize=False)
            count += 1
            if count <= 5 or count % 10 == 0 or count >= len(sprites) - 3:
                print(f"  [{count:3d}] {fn:40s}  {old_w:4d}x{old_h:<4d} x{k:3d} -> {new_w}x{new_h}")
        except Exception as e:
            errors.append(f"  ! FAIL {fn}: {e}")

    print(f"\nDone. {count} sprites upscaled (manifest.js NOT modified).")
    if errors:
        print(f"\n{len(errors)} errors:")
        for e in errors:
            print(e)

if __name__ == '__main__':
    main()
