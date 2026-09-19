# -*- coding: utf-8 -*-
"""
猫里奥（Syobon Action）精灵切图脚本
====================================
读取 catmario/docs/res 下的整合精灵图，按照 main.cpp 图形初始化代码
（grap[][] = subimage(x, y, w, h, mgrap[...]) ）中的坐标，
把每个 UI / 游戏元素切成单独的 PNG，输出到 new/assets/sprites/。

同时生成：
  - manifest.json   切图清单（grap 索引 -> 文件 / 尺寸）
  - _contact_sheet.png  总览图（人工核对用）

不修改 catmario 目录下的任何文件。
"""
import os
import json
from PIL import Image, ImageDraw

RES_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "catmario", "docs", "res")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "sprites")
AUDIO_SRC = os.path.join(os.path.dirname(__file__), "..", "..", "catmario", "docs", "snd")
AUDIO_DST = os.path.join(os.path.dirname(__file__), "..", "assets", "audio")

# ---------------------------------------------------------------------------
# 切图表：(源图, grap索引组, x, y, w, h, 分类, 文件名, 中文名)
# 坐标完全来自 catmario/src/main.cpp 的 subimage() 调用（约 569~658 行）
# grap[id][page]：page 0=玩家 1=方块(brock) 2=道具(item) 3=敌人 4=背景 5=方块2(brock2)
# ---------------------------------------------------------------------------
SLICES = [
    # ===== 玩家 player.png（页0）=====
    ("player.png", "g40_0",   0,   0, 30, 36, "player", "player_stand",     "玩家(站立帧)"),
    ("player.png", "g0_0",  124,   0, 30, 36, "player", "player_walk1",     "玩家(行走帧A)"),
    ("player.png", "g1_0",   31,   0, 30, 36, "player", "player_walk2",     "玩家(行走帧B)"),
    ("player.png", "g2_0",   62,   0, 30, 36, "player", "player_small",     "玩家(小)"),
    ("player.png", "g3_0",   93,   0, 30, 36, "player", "player_hurt",      "玩家(受伤帧)"),
    # 巨大化猫（来自 omake.png）
    ("omake.png",  "g41_0",  50,   0, 51, 73, "player", "player_giant",     "玩家(巨大化)"),

    # ===== 方块 brock.png（页1）33px 网格，30x30/格 =====
    # 第一行：地上（棕色）
    ("brock.png",  "g0_1",    0,   0, 30, 30, "block", "block_0",           "方块0(未使用)"),
    ("brock.png",  "g1_1",   33,   0, 30, 30, "block", "block_brick",       "砖块"),
    ("brock.png",  "g2_1",   66,   0, 30, 30, "block", "block_question",    "问号块"),
    ("brock.png",  "g3_1",   99,   0, 30, 30, "block", "block_hard",        "硬方块(土台)"),
    ("brock.png",  "g4_1",  132,   0, 30, 30, "block", "block_stair",       "楼梯块"),
    ("brock.png",  "g5_1",  165,   0, 30, 30, "block", "block_ground_top",  "地面(表层)"),
    ("brock.png",  "g6_1",  198,   0, 30, 30, "block", "block_ground_fill", "地面(填充)"),
    ("brock.png",  "g8_1",  231,   0, 30, 30, "block", "block_cat_shut",    "猫脸块(闭眼,ttype8)"),
    ("brock.png",  "-",     264,   0, 30, 30, "block", "block_cat_open",    "猫脸块(睁眼,原图未用)"),
    ("brock.png",  "g10_1", 297,   0, 30, 30, "block", "block_spike",       "尖刺块(下三角)"),
    # 第二行：地下（青色）grap[t+30]
    ("brock.png",  "g30_1",   0,  33, 30, 30, "block", "block_d_0",         "地下方块0(未使用)"),
    ("brock.png",  "g31_1",  33,  33, 30, 30, "block", "block_d_brick",     "地下砖块"),
    ("brock.png",  "g32_1",  66,  33, 30, 30, "block", "block_d_question",  "地下问号块"),
    ("brock.png",  "g33_1",  99,  33, 30, 30, "block", "block_d_hard",      "地下硬方块"),
    ("brock.png",  "g34_1", 132,  33, 30, 30, "block", "block_d_stair",     "地下楼梯块"),
    ("brock.png",  "g35_1", 165,  33, 30, 30, "block", "block_d_ground_top","地下地面(表层)"),
    ("brock.png",  "g36_1", 198,  33, 30, 30, "block", "block_d_ground_fill","地下地面(填充)"),
    ("brock.png",  "g40_1", 297,  33, 30, 30, "block", "block_d_spike",     "地下尖刺块"),
    # 第三行：城堡（灰色）grap[t+60]
    ("brock.png",  "g60_1",   0,  66, 30, 30, "block", "block_c_0",         "城堡方块0(未使用)"),
    ("brock.png",  "g61_1",  33,  66, 30, 30, "block", "block_c_brick",     "城堡砖块"),
    ("brock.png",  "g62_1",  66,  66, 30, 30, "block", "block_c_question",  "城堡问号块"),
    ("brock.png",  "g63_1",  99,  66, 30, 30, "block", "block_c_hard",      "城堡硬方块"),
    ("brock.png",  "g64_1", 132,  66, 30, 30, "block", "block_c_stair",     "城堡楼梯块"),
    ("brock.png",  "g65_1", 165,  66, 30, 30, "block", "block_c_ground_top","城堡地面(表层)"),
    ("brock.png",  "g66_1", 198,  66, 30, 30, "block", "block_c_ground_fill","城堡地面(填充)"),
    ("brock.png",  "g70_1", 297,  66, 30, 30, "block", "block_c_spike",     "城堡尖刺块"),

    # ===== 道具 item.png（页2）33px 网格 =====
    ("item.png",   "g0_2",    0,   0, 30, 30, "item", "item_coin",         "金币"),
    ("item.png",   "g1_2",   33,   0, 30, 30, "item", "item_mushroom_red", "红蘑菇"),
    ("item.png",   "g2_2",   66,   0, 30, 30, "item", "item_mushroom_dark","棕蘑菇(毒)"),
    ("item.png",   "g3_2",   99,   0, 30, 30, "item", "item_mushroom_purple","紫蘑菇(骷髅)"),
    ("item.png",   "g4_2",  132,   0, 30, 30, "item", "item_star",         "无敌星"),
    ("item.png",   "g5_2",  165,   0, 30, 30, "item", "item_green_question","绿色问号球"),
    ("item.png",   "g16_1", 198,   0, 24, 27, "item", "item_jumppad",      "弹簧跳台"),
    ("item.png",   "g101_3",231,   0, 30, 30, "item", "item_flower",       "火焰花"),

    # ===== 敌人 teki.png（页3）33px 网格 =====
    ("teki.png",   "g0_3",    0,   0, 30, 30, "enemy", "enemy_syobon",      "白猫怪(ショボン)"),
    ("teki.png",   "g1_3",   33,   0, 30, 43, "enemy", "enemy_turtle",      "绿龟怪"),
    ("teki.png",   "g2_3",   66,   0, 30, 30, "enemy", "enemy_shell",       "龟壳"),
    ("teki.png",   "g3_3",   99,   0, 30, 44, "enemy", "enemy_ghost",       "白幽灵(高)"),
    ("teki.png",   "g4_3",  132,   0, 33, 35, "enemy", "enemy_king",        "皇冠怪"),
    ("teki.png",   "g84_3", 166,   0, 30, 30, "enemy", "enemy_fireball",    "火球"),
    ("teki.png",   "g7_3",  199,   0, 32, 32, "enemy", "enemy_syobon_pad",  "猫脸怪(带台座)"),
    ("teki.png",   "g9_3",  232,   0, 26, 30, "enemy", "enemy_flame",       "火焰(小)"),

    # ===== 敌人/角色 omake2.png =====
    ("omake2.png", "g5_3",    0,   0, 37, 55, "enemy", "enemy_tongue_cat",  "吐舌猫怪"),
    ("omake2.png", "g6_3",   76,   0, 36, 50, "enemy", "enemy_robot",       "方块机器人"),
    ("omake2.png", "g150_3",150,   0, 36, 50, "enemy", "enemy_robot_alt",   "方块机器人(框)"),
    ("omake2.png", "g8_3",  187,   0, 37, 47, "enemy", "enemy_runner",      "奔跑猪脸怪"),
    ("omake2.png", "g151_3",225,   0, 37, 47, "enemy", "enemy_runner_alt",  "奔跑猪脸怪(汗)"),
    ("omake2.png", "g30_3",   0,  56, 30, 36, "enemy", "enemy_moralar",     "小猫咪(モララー)"),
    ("omake2.png", "g155_3", 93,  56, 30, 36, "enemy", "enemy_moralar_wave","小猫咪(挥手)"),

    # ===== 敌人/角色 omake.png =====
    ("omake.png",  "g83_3",   0,   0, 49, 48, "enemy", "enemy_spike_ball",  "刺球(伪地块)"),
    ("omake.png",  "g90_3", 102,   0, 64, 63, "enemy", "enemy_beam",        "黄色光束"),
    ("omake.png",  "g0_5",  167,   0, 45, 45, "enemy", "enemy_bigface",     "大脸(升降机碎片)"),
    ("omake.png",  "g10_3", 214,   0, 46, 16, "enemy", "enemy_flame_h",     "横火焰"),
    ("omake.png",  "g31_3",  50,  74, 49, 79, "enemy", "enemy_chicken",     "肌肉鸡(BOSS)"),
    ("omake.png",  "g86_3", 102,  66, 49, 59, "enemy", "enemy_peach_cat",   "桃色方块猫"),
    ("omake.png",  "g152_3",152,  66, 49, 59, "enemy", "enemy_peach_cat_angry","桃色方块猫(怒)"),

    # ===== 背景 haikei.png（页4）=====
    ("haikei.png", "g0_4",    0,   0,150, 90, "bg",    "bg_hill_house",     "背景(山与小屋)"),
    ("haikei.png", "g1_4",  151,   0, 65, 29, "bg",    "bg_grass",          "背景(草丛)"),
    ("haikei.png", "g2_4",  151,  31, 70, 40, "bg",    "bg_cloud_face",     "背景(脸云)"),
    ("haikei.png", "g3_4",    0,  91,100, 90, "bg",    "bg_tree",           "背景(松树)"),
    ("haikei.png", "g4_4",  151, 113, 51, 29, "bg",    "bg_cloud_angry",    "背景(怒云)"),
    ("haikei.png", "g5_4",  222,   0, 28, 60, "bg",    "bg_tree_round",     "背景(圆树)"),
    ("haikei.png", "g6_4",  151, 143, 90, 40, "bg",    "bg_lava",           "背景(熔岩浪)"),
    ("haikei.png", "g20_4",  40, 182, 40, 60, "bg",    "bg_midflag",        "中间旗(中間)"),
    # 敌人用的云（haikei 同源）
    ("haikei.png", "g80_3", 151,  31, 70, 40, "enemy", "enemy_cloud_face",  "敌人(脸云)"),
    ("haikei.png", "g81_3", 151,  72, 70, 40, "enemy", "enemy_cloud_plain", "敌人(普通云)"),
    ("haikei.png", "g130_3",222,  72, 70, 40, "enemy", "enemy_cloud_stealth","敌人(隐身云)"),

    # ===== brock2.png（页5）特殊方块 =====
    ("brock2.png", "g0_5",    0,   0, 30, 30, "block", "b2_empty",          "brock2空块(未使用)"),
    ("brock2.png", "g1_5",   33,   0, 30, 30, "block", "b2_hint",           "提示块(橙圆)"),
    ("brock2.png", "g2_5",   66,   0, 30, 30, "block", "b2_pswitch",        "P开关(蓝)"),
    ("brock2.png", "g3_5",   99,   0, 30, 30, "block", "b2_note_white",     "白音符块"),
    ("brock2.png", "g4_5",  132,   0, 30, 30, "block", "b2_note_peach",     "桃色音符块"),
    ("brock2.png", "g5_5",  165,   0, 30, 30, "block", "b2_crack",          "裂地块(brock2)"),
    ("brock2.png", "g6_5",  198,   0, 30, 30, "block", "b2_lined",          "条纹块(brock2)"),
    ("brock2.png", "g10_5",  33,  33, 30, 30, "block", "b2_on",             "ON开关块(品红)"),
    ("brock2.png", "g11_5",  66,  33, 30, 30, "block", "b2_off",            "OFF开关块(蓝)"),
    ("brock2.png", "g12_5",   0,  66, 30, 30, "block", "b2_sword",          "剑刺陷阱"),
    ("brock2.png", "g13_5",  33,  66, 30, 30, "block", "b2_blade",          "刀刃陷阱"),
    ("brock2.png", "g14_5",  66,  66, 30, 30, "block", "b2_pineapple",      "菠萝雷(绿)"),
]

# ---------------------------------------------------------------------------
# 直接用图元绘制的元素（main.cpp 中 setcolor/fillrect/fillarc 绘制）
# 这里预渲染成 PNG，便于编辑器左侧面板显示。
# 坐标系：格子 29px，与游戏一致。
# ---------------------------------------------------------------------------
TILE = 29

def render_vector_sprites():
    """把管道、旗杆、升降台、火焰棒、碎砖特效等矢量元素渲染成小图。"""
    vec_dir = os.path.join(OUT_DIR, "vector")
    os.makedirs(vec_dir, exist_ok=True)
    manifest = []

    def save(img, name, cn, w_units=1, h_units=1):
        p = os.path.join("vector", name + ".png")
        img.save(os.path.join(vec_dir, name + ".png"))
        manifest.append({"file": p, "name": name, "cn": cn,
                         "w": img.width, "h": img.height,
                         "tw": w_units, "th": h_units})

    def new_canvas(w, h, bg=(0, 0, 0, 0)):
        return Image.new("RGBA", (w, h), bg)

    BLACK = (0, 0, 0, 255)
    GREEN = (0, 230, 0, 255)
    WHITE = (255, 255, 255, 255)
    YELLOW = (250, 250, 0, 255)
    ORANGE = (230, 120, 0, 255)
    BROWN = (9 * 16, 6 * 16, 3 * 16, 255)

    # ---- 管道（可进入，竖管上口）stype=40 / 地图40：60x30 绿块+黑框 ----
    img = new_canvas(62, 32)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 1, 60, 30], fill=GREEN, outline=BLACK)
    save(img, "pipe_top", "管道(竖·上口)", 2, 1)

    # ---- 管道（竖管身体）stype=2 / 地图41：50x30，仅两侧线 ----
    img = new_canvas(52, 32)
    d = ImageDraw.Draw(img)
    d.rectangle([1, 2, 50, 31], fill=GREEN)
    d.line([1, 1, 1, 31], fill=BLACK)
    d.line([50, 1, 50, 31], fill=BLACK)
    save(img, "pipe_body", "管道(竖·管身)", 2, 1)

    # ---- 管道（横管）stype=5 / 地图44：39x50，上下线 ----
    img = new_canvas(41, 52)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 2, 39, 51], fill=GREEN)
    d.line([0, 1, 39, 1], fill=BLACK)
    d.line([0, 51, 39, 51], fill=BLACK)
    save(img, "pipe_h", "管道(横向)", 2, 2)

    # ---- 管道（竖管变体）stype=1 / 地图43：29x53 绿块+黑框 ----
    img = new_canvas(31, 55)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 1, 29, 53], fill=GREEN, outline=BLACK)
    save(img, "pipe_v2", "管道(竖·变体)", 1, 2)

    # ---- 终点旗杆 stype=300 / 地图99：白杆10宽 + 黄球r10 ----
    pole_h = TILE * 12
    img = new_canvas(30, pole_h)
    d = ImageDraw.Draw(img)
    d.rectangle([10, 0, 20, pole_h - 8], fill=WHITE, outline=BLACK)
    d.ellipse([4, 0, 24, 20], fill=YELLOW, outline=BLACK)
    save(img, "goal_pole", "终点旗杆", 1, 12)

    # ---- 升降台（黄色）地图20-29：14px 厚黄条 ----
    img = new_canvas(90, 18)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 89, 14], fill=(220, 220, 0, 255), outline=(180, 180, 0, 255))
    save(img, "lift_yellow", "升降台(黄)", 3, 1)

    # ---- 升降台（绿色）srsp=2 ----
    img = new_canvas(90, 18)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 89, 14], fill=(0, 220, 0, 255), outline=(0, 180, 0, 255))
    save(img, "lift_green", "升降台(绿)", 3, 1)

    # ---- 升降台（灰色）srsp=21 ----
    img = new_canvas(90, 18)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 89, 14], fill=(180, 180, 180, 255), outline=(150, 150, 150, 255))
    save(img, "lift_gray", "升降台(灰)", 3, 1)

    # ---- 火焰棒 atype=87/88：一串橙色圆 ----
    img = new_canvas(200, 200)
    d = ImageDraw.Draw(img)
    cx, cy, r, n = 100, 100, 8, 6
    for i in range(n + 1):
        x = cx + i * 18 - n * 9
        y = cy
        d.ellipse([x - r, y - r, x + r, y + r], fill=ORANGE, outline=BLACK)
    save(img, "firebar", "火焰棒(旋转)", 3, 3)

    # ---- 砖块碎裂特效 egtype=1：棕色圆碎片 r7 + 黑边 ----
    img = new_canvas(60, 60)
    d = ImageDraw.Draw(img)
    for (x, y) in [(15, 15), (45, 18), (18, 45), (42, 42)]:
        d.ellipse([x - 7, y - 7, x + 7, y + 7], fill=BROWN, outline=BLACK)
    save(img, "debris_brick", "砖块碎裂特效", 2, 2)

    # ---- 假终点杆 atype=85：白杆+青球 ----
    pole_h = TILE * 10
    img = new_canvas(30, pole_h)
    d = ImageDraw.Draw(img)
    d.rectangle([10, 0, 20, pole_h], fill=WHITE, outline=BLACK)
    d.ellipse([4, 0, 24, 20], fill=(0, 250, 200, 255), outline=BLACK)
    save(img, "fake_pole", "假旗杆(陷阱)", 1, 10)

    return manifest


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = []
    loaded = {}

    for src, gid, x, y, w, h, cat, name, cn in SLICES:
        if src not in loaded:
            img = Image.open(os.path.join(RES_DIR, src)).convert("RGBA")
            loaded[src] = img
        img = loaded[src]
        crop = img.crop((x, y, x + w, y + h))
        cat_dir = os.path.join(OUT_DIR, cat)
        os.makedirs(cat_dir, exist_ok=True)
        rel = os.path.join(cat, name + ".png")
        crop.save(os.path.join(OUT_DIR, rel))
        manifest.append({
            "grap": gid, "file": rel.replace("\\", "/"),
            "name": name, "cn": cn, "w": w, "h": h,
            "src": src, "x": x, "y": y,
        })
        print("  切出 %-28s <- %-12s (%d,%d,%d,%d)" % (rel, src, x, y, w, h))

    # 矢量元素
    vec_manifest = render_vector_sprites()
    manifest.extend(vec_manifest)

    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"tile": TILE, "sprites": manifest}, f, ensure_ascii=False, indent=1)
    print("manifest.json 已生成，共 %d 个元素" % len(manifest))

    # 同时输出 manifest.js（便于 file:// 直接打开网页，无需 HTTP 服务）
    with open(os.path.join(OUT_DIR, "manifest.js"), "w", encoding="utf-8") as f:
        f.write("// 由 tools/slice_sprites.py 自动生成，请勿手改\n")
        f.write("window.SPRITE_MANIFEST = ")
        f.write(json.dumps({"tile": TILE, "sprites": manifest}, ensure_ascii=False, indent=1))
        f.write(";\n")
    print("manifest.js 已生成")

    # 复制音频
    os.makedirs(AUDIO_DST, exist_ok=True)
    import shutil
    for mp3 in os.listdir(AUDIO_SRC):
        if mp3.endswith(".mp3"):
            shutil.copy2(os.path.join(AUDIO_SRC, mp3), os.path.join(AUDIO_DST, mp3))
            print("  复制音频", mp3)

    # ---- 总览图 ----
    cols = 8
    cell = 110
    rows = (len(manifest) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell, rows * cell), (245, 245, 245, 255))
    d = ImageDraw.Draw(sheet)
    for i, m in enumerate(manifest):
        cx = (i % cols) * cell
        cy = (i // cols) * cell
        sp = Image.open(os.path.join(OUT_DIR, m["file"]))
        scale = min((cell - 16) / sp.width, (cell - 30) / sp.height, 1.0)
        if scale < 1.0:
            sp = sp.resize((max(1, int(sp.width * scale)), max(1, int(sp.height * scale))), Image.NEAREST)
        sheet.alpha_composite(sp, (cx + (cell - sp.width) // 2, cy + 4))
        d.text((cx + 4, cy + cell - 14), m["cn"][:12], fill=(0, 0, 0, 255))
        d.rectangle([cx, cy, cx + cell - 1, cy + cell - 1], outline=(200, 200, 200, 255))
    sheet.save(os.path.join(OUT_DIR, "_contact_sheet.png"))
    print("_contact_sheet.png 已生成")


if __name__ == "__main__":
    main()
