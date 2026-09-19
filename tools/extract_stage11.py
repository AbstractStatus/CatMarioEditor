# -*- coding: utf-8 -*-
"""
从 catmario/src/main.cpp 提取 1-1 关卡的 stagedatex[17][1001] 原始字节，
生成 new/stage11_data.js（base64）。
播放页 play.html 用它作为指纹，在 asm.js 堆内存中定位 1-1 关卡数据
的常量存储位置，然后整体替换成编辑器 JSON 转换出的关卡，实现"JSON 变可玩关卡"。
"""
import base64
import re
import os

SRC = os.path.join(os.path.dirname(__file__), "..", "..", "catmario", "src", "main.cpp")
OUT = os.path.join(os.path.dirname(__file__), "..", "stage11_data.js")


def parse_stages():
    with open(SRC, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()

    # 找到所有 stagedatex 数组及其所属分支 (sta/stb)
    results = []
    for m in re.finditer(r"if \(sta == (\d+) && stb == (\d+)[^{]*\{", text):
        sta, stb = int(m.group(1)), int(m.group(2))
        arr = text.find("byte stagedatex[17][1001] = {", m.end())
        if arr == -1 or arr - m.end() > 4000:  # 必须紧跟在本分支内
            continue
        end = text.find("};", arr)
        body = text[arr:end]
        # 每行初始化列表可能不足 1001 个（C 会补零），非贪婪匹配逐行提取
        rows = re.findall(r"\{([0-9,\s]+?)\}", body)
        if len(rows) not in (16, 17):
            print("  跳过 %d-%d：初始化行数 %d 异常" % (sta, stb, len(rows)))
            continue
        grid = []
        ok = True
        for r in rows:
            vals = [int(x) for x in r.split(",") if x.strip() != ""]
            if len(vals) > 1001:
                ok = False
                break
            grid.append(vals + [0] * (1001 - len(vals)))
        # C 规则：未给出的行全零（1-1 只写了 16 行，第 17 行隐式全零）
        while len(grid) < 17:
            grid.append([0] * 1001)
        if not ok:
            print("  跳过 %d-%d：列数超过 1001" % (sta, stb))
            continue
        results.append((sta, stb, grid))
    return results


def main():
    stages = parse_stages()
    print("解析到 %d 个关卡数组：" % len(stages))
    for sta, stb, grid in stages:
        nz = sum(1 for row in grid for v in row if v)
        print("  %d-%d  非零格 %d" % (sta, stb, nz))

    target = None
    for sta, stb, grid in stages:
        if sta == 1 and stb == 1:
            target = grid
            break
    if target is None:
        raise SystemExit("未找到 1-1 关卡数据！")

    # 与其他关卡对比，确认指纹唯一性（完整 17x1001 图像）
    flat = bytes(v for row in target for v in row)
    for sta, stb, grid in stages:
        if (sta, stb) == (1, 1):
            continue
        other = bytes(v for row in grid for v in row)
        if other == flat:
            raise SystemExit("1-1 与 %d-%d 数据相同，指纹不唯一" % (sta, stb))

    b64 = base64.b64encode(flat).decode("ascii")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 由 tools/extract_stage11.py 自动生成：原版 1-1 关卡 stagedatex[17][1001] 字节图（base64）\n")
        f.write('window.STAGE11_IMAGE_B64 = "%s";\n' % b64)
    print("已生成 %s（%d 字节数据）" % (os.path.abspath(OUT), len(flat)))


if __name__ == "__main__":
    main()
