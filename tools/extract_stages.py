# -*- coding: utf-8 -*-
"""
从 catmario/src/main.cpp 的 stagep() 提取原版全部关卡（每个 sta/stb/stc 分支），
生成 new/stages_data.js（window.STAGES），供编辑器“示例世界”弹窗与试玩页直接载入。

每个关卡输出为新引擎 levels.js 同款 def 结构：
  { id, name, sta, stb, stc, stagecolor, bgm, scrollx,
    grid[17][1001], blocks:[{x,y,type,xt}], pipes:[{sa,sb,sc,sd,stype,sxtype}],
    enemies:[{ba,bb,btype,bxtype}], lifts:[{sra,srb,src,srtype,sracttype,sre,srsp}],
    spawn:{x,y} }
坐标口径：grid 字节由引擎 loadStage 解析；blocks 的 x/y 为像素（tyobi 入参）；
pipes/enemies/lifts 的坐标为世界单位（sa=sx*100）；spawn 由 ma/mb（世界单位）/100 得像素。
"""
import os
import re
import json

SRC = os.path.join(os.path.dirname(__file__), "..", "tiwb_catmario", "src", "main.cpp")
OUT = os.path.join(os.path.dirname(__file__), "..", "stages_data.js")

# ---- 安全表达式求值（仅允许数字与 + - * ( ) 空格）----
_EXPR_RE = re.compile(r"^[0-9\s\*\+\-\(\)]+$")


def ev(expr, default=0):
    if expr is None:
        return default
    expr = expr.strip()
    if not expr or not _EXPR_RE.match(expr):
        return default
    try:
        return int(eval(expr, {"__builtins__": {}}, {}))
    except Exception:
        return default


def strip_line_comments(text):
    """去掉 // 行注释（本文件无字符串内的 //，安全）。"""
    out = []
    for line in text.splitlines():
        idx = line.find("//")
        if idx != -1:
            line = line[:idx]
        out.append(line)
    return "\n".join(out)


def match_brace(text, open_pos):
    """从 open_pos 处的 '{' 起，返回与之配对的 '}' 的位置（跳过 // 与 /* */ 注释，
    避免注释里的花括号干扰配对，如 `//new byte stagedate[16][801]={`）。"""
    depth = 0
    i = open_pos
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            nl = text.find("\n", i)
            i = n if nl == -1 else nl
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            end = text.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


# 分支头：if (sta == N && stb == N && <stc 条件>) {
# stc 条件可能是 `stc == 0` 或复合 `(stc == 0 || stc == 10 || stc == 12)`，取第一个 stc 值
HEAD_RE = re.compile(r"if\s*\(\s*sta\s*==\s*(\d+)\s*&&\s*stb\s*==\s*(\d+)\s*&&\s*([^{]*?)\)\s*\{")
STC_RE = re.compile(r"stc\s*==\s*(-?\d+)")


def parse_grid(body):
    """提取 stagedatex[17][1001] 字节网格 → 17 行 x 1001 列。"""
    m = re.search(r"byte\s+stagedatex\s*\[\s*17\s*\]\s*\[\s*1001\s*\]\s*=\s*\{", body)
    if not m:
        return None
    end = body.find("};", m.end())
    if end == -1:
        return None
    arr_body = body[m.end():end]
    rows = re.findall(r"\{([0-9,\s]+?)\}", arr_body)
    if len(rows) not in (16, 17):
        return None
    grid = []
    for r in rows:
        vals = [int(x) for x in r.split(",") if x.strip() != ""]
        if len(vals) > 1001:
            vals = vals[:1001]
        grid.append(vals + [0] * (1001 - len(vals)))
    while len(grid) < 17:
        grid.append([0] * 1001)
    return grid


def parse_blocks(body):
    """tyobi(x,y,type) + txtype[tco]=N。
    C 语义：tyobi 写 ta[tco] 后 tco++，故 tyobi 之后的 txtype[tco]=N 作用于下一个 tyobi。
    这里按出现顺序扫描，用 tco 指针 + txtype_map 精确还原。
    另支持 for 循环展开：`for(int i = -1; i > -7; i -= 1){ tyobi(X, i*29-12, T); tco += 1; }`
    （2-1 col85 / 2-3 col55 的屏幕上方竖排硬块柱）。"""
    blocks = []
    txtype_map = {}
    tco = 0

    def evv(expr, var=None, val=0):
        """ev() 的带变量版本：先把循环变量替换为数值再求值。"""
        if expr is None:
            return 0
        if var is not None:
            expr = re.sub(r"\b%s\b" % re.escape(var), "(%d)" % val, expr)
        return ev(expr)

    # 交替匹配 tyobi(...) / txtype[tco] = N / for 循环 tyobi
    token_re = re.compile(
        r"tyobi\s*\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,\s*([^)]+?)\s*\)\s*;"
        r"|txtype\s*\[\s*tco\s*\]\s*=\s*([^;]+?)\s*;"
        r"|for\s*\(\s*int\s+(\w+)\s*=\s*([^;]+?)\s*;\s*\5\s*([<>]=?)\s*([^;]+?)\s*;\s*\5\s*(\+=|-=)\s*([^)]+?)\s*\)\s*\{"
        r"\s*tyobi\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*,\s*([^)]+?)\s*\)\s*;\s*(?:tco\s*\+\=\s*1\s*;?\s*)?\}")
    for m in token_re.finditer(body):
        if m.group(1) is not None:
            x = ev(m.group(1))
            y = ev(m.group(2))
            typ = ev(m.group(3))
            blocks.append({"x": x, "y": y, "type": typ, "xt": txtype_map.get(tco, 0)})
            tco += 1
        elif m.group(4) is not None:
            txtype_map[tco] = ev(m.group(4))
        else:
            # for 循环展开（从 -1 向上逐次减步长，与 C 循环一致）
            var, start, op, end, step_op, step = m.group(5), ev(m.group(6)), m.group(7), ev(m.group(8)), m.group(9), ev(m.group(10))
            i = start
            guard = 0
            while ((op == ">" and i > end) or (op == ">=" and i >= end) or
                   (op == "<" and i < end) or (op == "<=" and i <= end)):
                x = evv(m.group(11), var, i)
                y = evv(m.group(12), var, i)
                typ = evv(m.group(13), var, i)
                blocks.append({"x": x, "y": y, "type": typ, "xt": txtype_map.get(tco, 0)})
                tco += 1
                i += -step if step_op == "-=" else step
                guard += 1
                if guard > 100:
                    break
    return blocks


def parse_pipes(body):
    """sa[X]=..; sb[X]=..; sc[X]=..; sd[X]=..; stype[X]=..; [sxtype[X]=..;] [sgtype[X]=..;]
    下标 X：1 系列用 t，2 系列用 sco（两种都必须匹配）。"""
    pipes = []
    pipe_re = re.compile(
        r"sa\[\s*(\w+)\s*\]\s*=\s*([^;]+?)\s*;"
        r"\s*sb\[\s*\w+\s*\]\s*=\s*([^;]+?)\s*;"
        r"\s*sc\[\s*\w+\s*\]\s*=\s*([^;]+?)\s*;"
        r"\s*sd\[\s*\w+\s*\]\s*=\s*([^;]+?)\s*;"
        r"\s*stype\[\s*\w+\s*\]\s*=\s*([^;]+?)\s*;")
    for m in pipe_re.finditer(body):
        # sxtype 搜索范围：从 stype 匹配结束到下一个管道/敌人/升降台定义开始
        # 断点：sa[t/sco/bco]、sra[t/srco]、计数器自增（++ 与 += 1 两种写法）、
        # t=bco/sco/srco
        seg_end = len(body)
        for bp in [r"sa\[\s*\w+\s*\]",
                   r"sra\[\s*\w+\s*\]",
                   r"\w+\s*(?:\+\+|\+=)",
                   r"t\s*=\s*(?:bco|sco|srco)"]:
            bp_m = re.search(bp, body[m.end():])
            if bp_m:
                seg_end = min(seg_end, m.end() + bp_m.start())
                break
        seg = body[m.end():seg_end]
        sx = re.search(r"sxtype\[\s*\w+\s*\]\s*=\s*([^;]+?)\s*;", seg)
        sg = re.search(r"sgtype\[\s*\w+\s*\]\s*=\s*([^;]+?)\s*;", seg)
        pipes.append({
            "sa": ev(m.group(2)), "sb": ev(m.group(3)),
            "sc": ev(m.group(4)), "sd": ev(m.group(5)),
            "stype": ev(m.group(6)),
            "sxtype": ev(sx.group(1)) if sx else 0,
            "sgtype": ev(sg.group(1)) if sg else 0,
        })
    return pipes


def parse_enemies(body):
    """ba[X]=..; bb[X]=..; btype[X]=..; bxtype[X]=..;
    下标 X：1 系列用 t，2 系列用 bco（2-3 还混用 sco），统一按标识符匹配。"""
    enemies = []
    en_re = re.compile(
        r"ba\[\s*\w+\s*\]\s*=\s*([^;]+?)\s*;"
        r"\s*bb\[\s*\w+\s*\]\s*=\s*([^;]+?)\s*;"
        r"\s*btype\[\s*\w+\s*\]\s*=\s*([^;]+?)\s*;"
        r"\s*bxtype\[\s*\w+\s*\]\s*=\s*([^;]+?)\s*;")
    for m in en_re.finditer(body):
        enemies.append({
            "ba": ev(m.group(1)), "bb": ev(m.group(2)),
            "btype": ev(m.group(3)), "bxtype": ev(m.group(4)),
        })
    return enemies


def parse_lifts(body):
    """sra[t|srco]=..; srb=..; src=..; srtype=..; sracttype=..; sre=..; [srsp=..;]
    注意：1-1/1-3 等用 sra[t]，2-3 与 2-4-2 用 sra[srco]（两种下标都必须匹配）。"""
    lifts = []
    idx = r"\[\s*(?:t|srco)\s*\]"
    lift_re = re.compile(
        r"sra" + idx + r"\s*=\s*([^;]+?)\s*;"
        r"\s*srb" + idx + r"\s*=\s*([^;]+?)\s*;"
        r"\s*src" + idx + r"\s*=\s*([^;]+?)\s*;")
    for m in lift_re.finditer(body):
        seg = body[m.start():m.start() + 320]
        srtype = re.search(r"srtype" + idx + r"\s*=\s*([^;]+?)\s*;", seg)
        sracttype = re.search(r"sracttype" + idx + r"\s*=\s*([^;]+?)\s*;", seg)
        sre = re.search(r"\bsre" + idx + r"\s*=\s*([^;]+?)\s*;", seg)
        srsp = re.search(r"srsp" + idx + r"\s*=\s*([^;]+?)\s*;", seg)
        lifts.append({
            "sra": ev(m.group(1)), "srb": ev(m.group(2)), "src": ev(m.group(3)),
            "srtype": ev(srtype.group(1)) if srtype else 0,
            "sracttype": ev(sracttype.group(1)) if sracttype else 0,
            "sre": ev(sre.group(1)) if sre else 0,
            "srsp": ev(srsp.group(1)) if srsp else 0,
        })
    return lifts


def stage_name(sta, stb, stc, stagecolor):
    theme = {1: "地上", 2: "地下", 3: "空中", 4: "城堡"}.get(stagecolor, "")
    base = "%d-%d" % (sta, stb)
    if stc == 1:
        base += "-1"
    elif stc == 2:
        base += "-2"
    elif stc == 5:
        base += " 空中区"
    if stc == 5:
        return "%s 空中" % base
    if theme:
        return "%s %s" % (base, theme)
    return base


def main():
    with open(SRC, "r", encoding="utf-8", errors="ignore") as f:
        raw = f.read()

    heads = []
    for m in HEAD_RE.finditer(raw):
        stc_m = STC_RE.search(m.group(3))
        if not stc_m:
            continue
        heads.append((int(m.group(1)), int(m.group(2)), int(stc_m.group(1)), m.start(), m.end() - 1))

    stages = []
    for idx, (sta, stb, stc, hstart, hobrace) in enumerate(heads):
        close = match_brace(raw, hobrace)
        if close == -1:
            continue
        body_raw = raw[hobrace:close]
        body = strip_line_comments(body_raw)

        grid = parse_grid(body)
        if grid is None:
            print("  跳过 %d-%d stc=%d：未找到 stagedatex" % (sta, stb, stc))
            continue

        blocks = parse_blocks(body)
        pipes = parse_pipes(body)
        enemies = parse_enemies(body)
        lifts = parse_lifts(body)

        sc_m = re.search(r"stagecolor\s*=\s*(\d+)\s*;", body)
        stagecolor = int(sc_m.group(1)) if sc_m else 1
        bgm_m = re.search(r"bgmchange\s*\(\s*(\d+)\s*\)\s*;", body)
        bgm = int(bgm_m.group(1)) if bgm_m else 100
        # stage() 入口默认 scrollx = 3600*100（main.cpp:4060/4135）；
        # 仅关卡分支内显式赋值时才覆盖（如 1-2 的 scrollx=0 = 镜头锁定）
        sx_m = re.search(r"scrollx\s*=\s*([^;]+?)\s*;", body)
        scrollx = ev(sx_m.group(1)) if sx_m else 3600 * 100

        # ma/mb 在 stage() 顶部初始化为 5600/32000（main.cpp:1649），部分关卡在分支内
        # 显式覆盖（如 1-4 的 ma=12000/mb=6000）。正则在分支内找不到时回退到默认值。
        # 注意排除 stagepoint 条件块（如 1-3 的 if(stagepoint==1){ma=4500;mb=-3000;}），
        # 那是子关卡传送回来的回归点，不是关卡初始出生点
        body_spawn = "\n".join(ln for ln in body.splitlines() if "stagepoint" not in ln)
        ma_m = re.search(r"\bma\s*=\s*([^;]+?)\s*;", body_spawn)
        mb_m = re.search(r"\bmb\s*=\s*([^;]+?)\s*;", body_spawn)
        # 直接输出世界坐标（ma/mb 同系），引擎按原单位放置；
        # 不再换算为编辑器像素口径，避免出生点被二次偏移
        spawn = {"ma": ev(ma_m.group(1)) if ma_m else 5600,
                 "mb": ev(mb_m.group(1)) if mb_m else 32000}

        sid = "%d-%d" % (sta, stb)
        if stc:
            sid += "-%d" % stc
        stages.append({
            "id": sid,
            "name": stage_name(sta, stb, stc, stagecolor),
            "sta": sta, "stb": stb, "stc": stc,
            "stagecolor": stagecolor, "bgm": bgm, "scrollx": scrollx,
            "grid": grid,
            "blocks": blocks, "pipes": pipes,
            "enemies": enemies, "lifts": lifts,
            "spawn": spawn,
        })

    print("共提取 %d 个关卡：" % len(stages))
    for s in stages:
        print("  %-8s %-12s color=%d bgm=%d 块=%d 管=%d 敌=%d 台=%d spawn=%s" %
              (s["id"], s["name"], s["stagecolor"], s["bgm"],
               len(s["blocks"]), len(s["pipes"]), len(s["enemies"]), len(s["lifts"]),
               s["spawn"]))

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 由 tools/extract_stages.py 自动生成：原版猫里奥全部关卡数据（新引擎 def 结构）\n")
        f.write("// 每关：{id,name,sta,stb,stc,stagecolor,bgm,scrollx,grid[17][1001],blocks,pipes,enemies,lifts,spawn}\n")
        f.write("window.STAGES = ")
        f.write(json.dumps(stages, ensure_ascii=False, separators=(",", ":")))
        f.write(";\n")
    print("已生成 %s" % os.path.abspath(OUT))


if __name__ == "__main__":
    main()
