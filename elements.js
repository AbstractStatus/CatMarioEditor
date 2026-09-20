/*
 * 猫里奥关卡编辑器 - 元素定义
 * ---------------------------------------------------------------
 * 每个元素对应 catmario/src/main.cpp 中的一个游戏对象：
 *   mapId : stagedate[17][1001] 地图字节 ID（stage() 中解析）
 *   ttype : tyobi() 方块类型（stagep 额外追加元素用）
 *   atype : ayobi() 敌人/道具类型
 *   ntype : 背景类型（na/ntype，地图 ID 80-89 = ntype 0-9）
 *   bgmId : bgmchange() 音乐 ID
 * img 字段对应 assets/sprites/manifest.js 中的 sprite 文件名。
 * 无 img 的元素由编辑器按 main.cpp 的图元绘制方式实时矢量绘制。
 */
(function () {
  'use strict';

  const CATS = {
    struct: '地形 / 机关',
    block: '方块',
    item: '道具',
    enemy: '敌人',
    bg: '背景装饰',
    audio: '背景音乐'
  };

  // kind: 'sprite' 贴精灵图 | 'vector' 矢量绘制 | 'special' 特殊处理
  const ELEMENTS = [
    // ================= 地形 / 机关 =================
    { id: 'player_start', cat: 'struct', name: '玩家起点', kind: 'special', img: 'player/player_small.png',
      tw: 1, th: 1, hint: '关卡开始时猫里奥出生的位置（游戏中固定在左侧，编辑器仅作标记）' },
    { id: 'pipe_mouth', cat: 'struct', name: '管道口', kind: 'vector',
      tw: 2, th: 4,
      dir: 'up', length: 3, entry: 'none',
      hint: '统一管道元素：dir=管口朝向(up/down/left/right 默认up)、length=管身长度格(默认3)、entry=进入事件(none/trap/warp)' },
    { id: 'pipe_cross', cat: 'struct', name: '四口连接管', kind: 'vector',
      tw: 2, th: 2, rot: 0, lengths: [1,1,1,1], hint: '四个方向都连接的管道交叉点；中心块 2×2 满格，每端口向外延伸 1-4 格管身（可配）' },
    { id: 'pipe_tee', cat: 'struct', name: '三口连接管', kind: 'vector',
      tw: 2, th: 2, rot: 0, lengths: [1,1,1,1], hint: 'T形三口连接管，rot 决定缺失方向（0=缺下/90=缺左/180=缺上/270=缺右）；中心块 2×2 满格，每端口 1-4 格管身' },
    { id: 'pipe_L_a', cat: 'struct', name: '两口直角管(A)', kind: 'vector',
      tw: 2, th: 2, rot: 0, lengths: [1,1], hint: 'L形直角连接管A（基础 up+right）；中心块 2×2 满格，两端口各 1-4 格管身（可配）' },
    { id: 'pipe_L_b', cat: 'struct', name: '两口直角管(B)', kind: 'vector',
      tw: 2, th: 2, rot: 0, lengths: [1,1], hint: 'L形直角连接管B（基础 up+left）；中心块 2×2 满格，两端口各 1-4 格管身（可配）' },
    { id: 'goal_pole', cat: 'struct', name: '终点旗杆', kind: 'vector', img: 'vector/goal_pole.png',
      tw: 1, th: 12, mapId: 99, hint: 'stype=300：白色杆(10宽)+黄色圆球(r10)，地图99号，杆从放置行向下延伸到第12行' },
    { id: 'bg_midflag', cat: 'struct', name: '中间旗', kind: 'sprite', img: 'bg/bg_midflag.png',
      tw: 2, th: 3, mapId: 30, hint: 'stype=500，haikei(40,182,40,60)，旗面40x60像素；编辑器按 40x60 原始比例绘制（约1.4格宽、2格高），过了之后死亡从中点复活' },
    { id: 'lift_yellow', cat: 'struct', name: '升降台(黄)', kind: 'vector', img: 'vector/lift_yellow.png',
      tw: 3, th: 1, mapId: 20, len: 3, hint: '地图20-29号：黄色移动平台，14px厚，长度可在JSON的len字段调整' },
    { id: 'lift_green', cat: 'struct', name: '升降台(绿)', kind: 'vector', img: 'vector/lift_green.png',
      tw: 3, th: 1, len: 3, hint: 'srsp=2 的绿色平台（游戏附加机关）' },
    { id: 'lift_gray', cat: 'struct', name: '升降台(灰)', kind: 'vector', img: 'vector/lift_gray.png',
      tw: 3, th: 1, len: 3, hint: 'srsp=21 的灰色平台' },
    { id: 'firebar', cat: 'struct', name: '火焰棒(旋转)', kind: 'vector', img: 'vector/firebar.png',
      tw: 3, th: 3, atype: 87, xt: 5, hint: 'atype=87/88：一串橙色圆(fillarc r8)绕中心旋转，xt为火球个数' },
    { id: 'block_fall', cat: 'struct', name: '坠落砖组', kind: 'vector', img: 'block/block_brick.png',
      tw: 3, th: 1, count: 3, ori: 'h', dir: 'down', delay: 0,
      hint: 'stype=51：连在一起的砖块（默认3块横排）。玩家完全进入砖组长轴区域并处于运动方向一侧时，砖组加速坠落/平移；移动中碰到玩家即阵亡。可配置延时(秒，默认0=立即坠落)与链式触发(触发本组时联动触发所选砖组，默认无=靠近触发)。选中后在⚙属性里改排列(横/竖)、砖块数(2-12)、移动方向(上/下/左/右)、延时、链式触发' },
    { id: 'block_fall_d', cat: 'struct', name: '坠落砖组·延时', kind: 'vector', img: 'block/block_d_brick.png',
      tw: 3, th: 1, count: 3, ori: 'h', dir: 'down', delay: 0.5,
      hint: 'stype=51/sxtype=1：地下砖样式的坠落砖组（1-2-1 连锁崩塌桥）。未设链式时：触发后延迟指定秒数再坠落（默认0.5秒，延时期间可踩）。设链式后走旧引擎连锁语义：监视目标砖组，其坠落到位(高度25000/48000)且玩家位置满足时本组崩塌（延时无效）。选中后在⚙属性里改排列、砖块数(2-12)、移动方向、延时(秒)、链式触发' },
    { id: 'block_fall_g', cat: 'struct', name: '坠落地面块', kind: 'vector', img: 'block/block_ground_top.png',
      tw: 3, th: 2, count: 3, variant: 0, rows: 1,
      hint: 'stype=52：地面样式的坠落砖组。玩家深入水平区域且脚底接近砖顶时整组加速向下坠落（不致死，可踩；与坠落砖组 stype=51 不同，碰到不阵亡）。variant=0 横排地面(顶+填充两层)、1 砖块矩阵(横×竖)、2 地面矩阵(横×竖)。选中后在⚙属性里改变体、列数(1-12)、行数(矩阵变体1/2)' },
    { id: 'block_brick_m', cat: 'struct', name: '可移动砖块', kind: 'vector', img: 'block/block_brick.png',
      tw: 3, th: 1, count: 3, ori: 'h',
      hint: 'stype=51/noauto：普通砖块外观的静态砖组，永不自动坠落（复刻旧引擎 1-3 的 22列3行 tyobi 砖）。' +
        '实体可踩可顶。选中后在⚙属性里改排列(横/竖)、块数(1-12)；配事件触发器的"移动元素"动作可在触发后平移位置' },
    { id: 'platform_hang', cat: 'struct', name: '悬挂站台', kind: 'vector', img: 'vector/lift_green.png',
      tw: 5, th: 1, w: 5, h: 16, drop: false,
      hint: 'srsp=10：1-3/2-3 的高空站台——30px 厚绿色站台顶 + 向下延伸的棕色吊柱（吊柱纯装饰，不参与碰撞，默认16格高≈原版480px）。w=站台宽度（格），h=吊柱高度（格，仅视觉），drop=可下降：开启后玩家一站上台面即加速下坠（sracttype=1），并带着玩家一起掉落。选中后在⚙属性里修改' },

    // ================= 方块（地上主题） =================
    { id: 'block_brick', cat: 'block', name: '砖块', kind: 'sprite', img: 'block/block_brick.png',
      tw: 1, th: 1, mapId: 1, hint: 'ttype=1，可被顶碎（碎裂时产生棕色圆形碎片特效）' },
    { id: 'block_question', cat: 'block', name: '问号块', kind: 'sprite', img: 'block/block_question.png',
      tw: 1, th: 1, mapId: 2, pop: 'coin', mass: false,
      hint: '统一问号块：pop=弹出对象(金币/红蘑菇/毒蘑菇/白猫怪/火焰花/坏星/P开关，与隐藏块同选项集，默认金币)、mass=是否量产(默认否；P开关无量产)。选中后在⚙属性里修改' },
    { id: 'block_hard', cat: 'block', name: '硬方块', kind: 'sprite', img: 'block/block_hard.png',
      tw: 1, th: 1, mapId: 3, hint: 'ttype=3/111/113，土台硬方块，不可破坏' },
    { id: 'block_stair', cat: 'block', name: '楼梯块', kind: 'sprite', img: 'block/block_stair.png',
      tw: 1, th: 1, mapId: 4, hint: 'ttype=4，终点前金字塔楼梯用块' },
    { id: 'block_ground_top', cat: 'block', name: '地面(表层)', kind: 'sprite', img: 'block/block_ground_top.png',
      tw: 1, th: 1, mapId: 5, hint: 'ttype=5，地面最上层（带裂纹草皮）' },
    { id: 'block_ground_fill', cat: 'block', name: '地面(填充)', kind: 'sprite', img: 'block/block_ground_fill.png',
      tw: 1, th: 1, mapId: 6, hint: 'ttype=6，表层以下的填土块' },
    { id: 'block_hidden', cat: 'block', name: '隐藏块', kind: 'special', img: 'block/block_cat_shut.png',
      tw: 1, th: 1, mapId: 7, pop: 'coin', mass: false,
      hint: '统一隐藏块：游戏中完全隐形，被头顶到才触发。pop=弹出对象(金币/红蘑菇/毒蘑菇/白猫怪/火焰花/坏星/P开关，与问号块同选项集，默认金币)、mass=是否量产(默认否；P开关无量产)。编辑器中按弹出对象用彩色虚线框+半透明图标显示' },
    { id: 'block_cat_shut', cat: 'block', name: '猫脸块(闭眼)', kind: 'sprite', img: 'block/block_cat_shut.png',
      tw: 1, th: 1, mapId: 8, hint: 'ttype=8，白色猫脸方块' },
    { id: 'block_spike', cat: 'block', name: '尖刺块', kind: 'sprite', img: 'block/block_spike.png',
      tw: 1, th: 1, mapId: 10, hint: 'ttype=10，落地后致命' },
    { id: 'block_pipe_top', cat: 'block', name: '管道砖(顶)', kind: 'sprite', internal: true,
      img: 'vector/pipe_top.png', tw: 2, th: 1, mapId: 40, hint: '原版内部用：grid字节40 → 顶部帽' },
    { id: 'block_pipe_body', cat: 'block', name: '管道砖(身)', kind: 'sprite', internal: true,
      img: 'vector/pipe_body.png', tw: 2, th: 1, mapId: 41, hint: '原版内部用：grid字节41/43/44 → 管身' },
    { id: '_trapzone', cat: 'struct', name: '陷阱触发区', kind: 'special', img: 'enemy/enemy_ghost.png',
      tw: 1, th: 1, trapStype: 101, trapSxtype: 0, trapW: 7000, trapH: 70000,
      hint: '原版 stype 100-104 非实体 AABB 触发区：玩家进入区域时触发。' +
        '100=猫脸怪(生成白幽灵) / 101=天降白幽灵 / 102=按sxtype天降敌人 / 103=激光炮 / 104=光束。' +
        '画布以虚线框显示，可调 stype/sxtype，试玩时 1:1 还原' },
    { id: 'trap_event', cat: 'struct', name: '事件触发区', kind: 'special',
      tw: 3, th: 3, w: 3, h: 3, events: [],
      hint: '隐形AABB触发区（画布虚线框，玩家看不见）：玩家进入区域即按顺序执行事件动作（播音效/按偏移生成敌人/改其他元素属性/移动其他元素），每关触发一次。选中后在⚙属性里改宽(格)、高(格)、编辑事件动作列表（可一键填入1-3整蛊模板）' },
    { id: 'block_qball', cat: 'struct', name: '问号球(触碰事件)', kind: 'sprite', img: 'item/item_green_question.png',
      tw: 1, th: 1, events: [],
      hint: '复刻原版绿问号球（atype=105）：非实体，玩家触碰即按顺序执行事件动作并消失（每关一次，检查点复活不重置）。' +
        '配 1-3 整蛊模板可还原：金币音效+提示块变空白框+天降7颗恶星+脆弱砖下移。选中后在⚙属性里编辑事件动作列表' },

    // ================= 方块（特殊机关块，brock2.png） =================
    { id: 'b2_hint', cat: 'block', name: '提示块(橙圆)', kind: 'sprite', img: 'block/b2_hint.png',
      tw: 1, th: 1, ttype: 300, hint: 'ttype=300：顶一下弹出作者提示文字' },
    { id: 'b2_pswitch', cat: 'block', name: 'P开关', kind: 'sprite', img: 'block/b2_pswitch.png',
      tw: 1, th: 1, ttype: 400, hint: 'ttype=400：蓝色P按钮开关' },
    { id: 'b2_on', cat: 'block', name: 'ON开关块', kind: 'sprite', img: 'block/b2_on.png',
      tw: 1, th: 1, ttype: 130, hint: 'ttype=130：品红色ON块，与OFF块联动' },
    { id: 'b2_off', cat: 'block', name: 'OFF开关块', kind: 'sprite', img: 'block/b2_off.png',
      tw: 1, th: 1, ttype: 131, hint: 'ttype=131：蓝色OFF块' },
    { id: 'b2_note_peach', cat: 'block', name: '音符块(桃色)', kind: 'sprite', img: 'block/b2_note_peach.png',
      tw: 1, th: 1, ttype: 117, hint: 'ttype=117：音符弹跳块' },
    { id: 'b2_note_white', cat: 'block', name: '音符块(白色)', kind: 'sprite', img: 'block/b2_note_white.png',
      tw: 1, th: 1, ttype: 117, hint: 'ttype=117：白色音符弹跳块' },
    { id: 'b2_sword', cat: 'block', name: '剑刺陷阱', kind: 'sprite', img: 'block/b2_sword.png',
      tw: 1, th: 1, ttype: 140, hint: 'ttype=140：弹出的剑' },
    { id: 'b2_blade', cat: 'block', name: '刀刃陷阱', kind: 'sprite', img: 'block/b2_blade.png',
      tw: 1, th: 1, ttype: 141, hint: 'ttype=141：斜向刀刃' },
    { id: 'b2_pineapple', cat: 'block', name: '菠萝雷', kind: 'sprite', img: 'block/b2_pineapple.png',
      tw: 1, th: 1, ttype: 142, hint: 'ttype=142：绿色菠萝形炸弹' },
    { id: 'item_jumppad', cat: 'block', name: '弹簧跳台', kind: 'sprite', img: 'item/item_jumppad.png',
      tw: 1, th: 1, ttype: 120, hint: 'ttype=120：踩上去高高弹起（item.png 第6格 24x27）' },

    // ================= 方块（地下 / 城堡主题） =================
    { id: 'block_d_brick', cat: 'block', name: '地下砖块(青)', kind: 'sprite', img: 'block/block_d_brick.png',
      tw: 1, th: 1, hint: 'stagecolor=2 地下关卡时砖块自动变此色（brock.png第2行）' },
    { id: 'block_d_question', cat: 'block', name: '地下问号块', kind: 'sprite', img: 'block/block_d_question.png',
      tw: 1, th: 1, hint: '地下关卡的问号块外观' },
    { id: 'block_d_hard', cat: 'block', name: '地下硬方块', kind: 'sprite', img: 'block/block_d_hard.png',
      tw: 1, th: 1, hint: '地下关卡的硬方块外观' },
    { id: 'block_d_stair', cat: 'block', name: '地下楼梯块', kind: 'sprite', img: 'block/block_d_stair.png',
      tw: 1, th: 1, mapId: 4, hint: '地下关卡的楼梯块外观' },
    { id: 'block_d_ground_top', cat: 'block', name: '地下地面(表)', kind: 'sprite', img: 'block/block_d_ground_top.png',
      tw: 1, th: 1, hint: '地下地面表层' },
    { id: 'block_d_ground_fill', cat: 'block', name: '地下地面(填)', kind: 'sprite', img: 'block/block_d_ground_fill.png',
      tw: 1, th: 1, hint: '地下地面填充' },
    { id: 'block_d_spike', cat: 'block', name: '地下尖刺', kind: 'sprite', img: 'block/block_d_spike.png',
      tw: 1, th: 1, hint: '地下关卡的尖刺块' },
    { id: 'block_c_brick', cat: 'block', name: '城堡砖块(灰)', kind: 'sprite', img: 'block/block_c_brick.png',
      tw: 1, th: 1, hint: 'stagecolor=4 城堡关卡时方块变灰色（brock.png第3行）' },
    { id: 'block_c_question', cat: 'block', name: '城堡问号块', kind: 'sprite', img: 'block/block_c_question.png',
      tw: 1, th: 1, hint: '城堡关卡问号块外观' },
    { id: 'block_c_hard', cat: 'block', name: '城堡硬方块', kind: 'sprite', img: 'block/block_c_hard.png',
      tw: 1, th: 1, hint: '城堡关卡硬方块外观' },
    { id: 'block_c_stair', cat: 'block', name: '城堡楼梯块', kind: 'sprite', img: 'block/block_c_stair.png',
      tw: 1, th: 1, mapId: 4, hint: '城堡关卡的楼梯块外观' },
    { id: 'block_c_ground_top', cat: 'block', name: '城堡地面(表)', kind: 'sprite', img: 'block/block_c_ground_top.png',
      tw: 1, th: 1, hint: '城堡地面表层' },
    { id: 'block_c_ground_fill', cat: 'block', name: '城堡地面(填)', kind: 'sprite', img: 'block/block_c_ground_fill.png',
      tw: 1, th: 1, hint: '城堡地面填充' },
    { id: 'block_c_spike', cat: 'block', name: '城堡尖刺', kind: 'sprite', img: 'block/block_c_spike.png',
      tw: 1, th: 1, hint: '城堡关卡尖刺块' },

    // ================= 道具 =================
    { id: 'item_coin', cat: 'item', name: '金币', kind: 'sprite', img: 'item/item_coin.png',
      tw: 1, th: 1, mapId: 9, ttype: 800, hint: '地图9号 / ttype=800：item.png第0格金币' },
    { id: 'item_mushroom_red', cat: 'item', name: '红蘑菇', kind: 'sprite', img: 'item/item_mushroom_red.png',
      tw: 1, th: 1, atype: 100, hint: 'atype=100：吃了变大（问号块中弹出）' },
    { id: 'item_mushroom_dark', cat: 'item', name: '棕蘑菇(毒)', kind: 'sprite', img: 'item/item_mushroom_dark.png',
      tw: 1, th: 1, titem: 2, hint: '毒蘑菇，item.png第2格' },
    { id: 'item_mushroom_purple', cat: 'item', name: '紫蘑菇(骷髅)', kind: 'sprite', img: 'item/item_mushroom_purple.png',
      tw: 1, th: 1, atype: 102, hint: 'atype=102：带骷髅的紫色蘑菇' },
    { id: 'item_star', cat: 'item', name: '无敌星', kind: 'sprite', img: 'item/item_star.png',
      tw: 1, th: 1, atype: 110, hint: 'atype=110：戴墨镜的星星，短暂无敌' },
    { id: 'item_green_question', cat: 'item', name: '绿色问号球', kind: 'sprite', img: 'item/item_green_question.png',
      tw: 1, th: 1, atype: 105, hint: 'atype=105：绿色问号圆球' },
    { id: 'item_flower', cat: 'item', name: '火焰花', kind: 'sprite', img: 'item/item_flower.png',
      tw: 1, th: 1, atype: 101, hint: 'atype=101：吃了"肚子里有火球"' },

    // ================= 敌人 =================
    { id: 'enemy_syobon', cat: 'enemy', name: '馒头怪', kind: 'sprite', img: 'enemy/enemy_syobon.png',
      tw: 1, th: 1, mapId: 50, atype: 0, hint: 'atype=0：最常见的ショボン，左右走动，踩不死（会反杀）' },
    { id: 'enemy_turtle', cat: 'enemy', name: '龟壳馒头怪', kind: 'sprite', img: 'enemy/enemy_turtle.png',
      tw: 1, th: 1, mapId: 51, atype: 1, hint: 'atype=1：30x43 的绿龟（地图上占 1 格，精灵向下溢出绘制）' },
    { id: 'enemy_shell', cat: 'enemy', name: '龟壳', kind: 'sprite', img: 'enemy/enemy_shell.png',
      tw: 1, th: 1, mapId: 52, atype: 2, hint: 'atype=2：静止龟壳，踩后可滑动' },
    { id: 'enemy_ghost', cat: 'enemy', name: '白幽灵', kind: 'sprite', img: 'enemy/enemy_ghost.png',
      tw: 1, th: 2, mapId: 53, atype: 3, hint: 'atype=3：30x44 高个幽灵，背对时才动' },
    { id: 'enemy_king', cat: 'enemy', name: '尖刺馒头怪', kind: 'sprite', img: 'enemy/enemy_king.png',
      tw: 1, th: 1, mapId: 54, atype: 4, hint: 'atype=4：33x35 戴皇冠的白猫' },
    { id: 'enemy_fireball', cat: 'enemy', name: '火球', kind: 'sprite', img: 'enemy/enemy_fireball.png',
      tw: 1, th: 1, atype: 84, hint: 'atype=84：橙色圆形火球' },
    { id: 'enemy_syobon_pad', cat: 'enemy', name: '火箭馒头怪', kind: 'sprite', img: 'enemy/enemy_syobon_pad.png',
      tw: 1, th: 1, mapId: 57, atype: 7, hint: 'atype=7：32x32 猫脸+蓝色弹簧，会弹起' },
    { id: 'enemy_flame', cat: 'enemy', name: '火焰(小)', kind: 'sprite', img: 'enemy/enemy_flame.png',
      tw: 1, th: 1, mapId: 59, atype: 9, hint: 'atype=9：26x30 红色火焰，可翻转' },
    { id: 'enemy_tongue_cat', cat: 'enemy', name: '吐舌猫怪', kind: 'sprite', img: 'enemy/enemy_tongue_cat.png',
      tw: 1, th: 2, mapId: 55, atype: 5, hint: 'atype=5：omake2(0,0,37,55)，吐舌头的高个猫' },
    { id: 'enemy_robot', cat: 'enemy', name: '方块机器人', kind: 'sprite', img: 'enemy/enemy_robot.png',
      tw: 1, th: 2, mapId: 56, atype: 6, hint: 'atype=6：デフラグ，36x50 方块头机器人' },
    { id: 'enemy_runner', cat: 'enemy', name: '奔跑怪', kind: 'sprite', img: 'enemy/enemy_runner.png',
      tw: 1, th: 2, mapId: 58, atype: 8, hint: 'atype=8：37x47 猪脸奔跑怪，带蓝色披风' },
    { id: 'enemy_moralar', cat: 'enemy', name: '小猫咪', kind: 'sprite', img: 'enemy/enemy_moralar.png',
      tw: 1, th: 1, atype: 30, hint: 'atype=30：モララー，30x36 小猫，靠近会一起跳' },
    { id: 'enemy_chicken', cat: 'enemy', name: '肌肉鸡(BOSS)', kind: 'sprite', img: 'enemy/enemy_chicken.png',
      tw: 2, th: 3, atype: 31, hint: 'atype=31：omake(50,74,49,79) 戴皇冠的肌肉鸡' },
    { id: 'enemy_cloud_face', cat: 'enemy', name: '脸云', kind: 'sprite', img: 'enemy/enemy_cloud_face.png',
      tw: 2, th: 1, atype: 80, hint: 'atype=80：haikei(151,31,70,40) 带脸的云，碰到会"好吃"' },
    { id: 'enemy_cloud_plain', cat: 'enemy', name: '普通云', kind: 'sprite', img: 'enemy/enemy_cloud_plain.png',
      tw: 2, th: 1, atype: 81, hint: 'atype=81：haikei(151,72,70,40)，会变隐身的云' },
    { id: 'enemy_spike_ball', cat: 'enemy', name: '伪地块刺球', kind: 'sprite', img: 'enemy/enemy_spike_ball.png',
      tw: 2, th: 2, atype: 83, hint: 'atype=82/83：omake(0,0,49,48) 带刺圆球，伪装成地面' },
    { id: 'enemy_peach_cat', cat: 'enemy', name: '桃色方块猫', kind: 'sprite', img: 'enemy/enemy_peach_cat.png',
      tw: 2, th: 2, atype: 86, hint: 'atype=86：49x59 桃色方块猫（ニャッスン），靠近才变表情' },
    { id: 'enemy_beam', cat: 'enemy', name: '巨型馒头怪', kind: 'sprite', img: 'enemy/enemy_beam.png',
      tw: 2, th: 2, atype: 90, hint: 'atype=90：omake(102,0,64,63) 斜向黄色光束' },
    { id: 'enemy_flame_h', cat: 'enemy', name: '横火焰', kind: 'sprite', img: 'enemy/enemy_flame_h.png',
      tw: 2, th: 1, atype: 10, hint: 'atype=10：omake(214,0,46,16) 横向喷火' },
    { id: 'fake_pole', cat: 'enemy', name: '假旗杆(陷阱)', kind: 'vector', img: 'vector/fake_pole.png',
      tw: 1, th: 10, atype: 85, hint: 'atype=85：白杆+青色球，看似终点杆其实是陷阱' },

    // ================= 背景装饰（地图 80-86 = ntype 0-6） =================
    { id: 'bg_hill_house', cat: 'bg', name: '山与小屋', kind: 'sprite', img: 'bg/bg_hill_house.png',
      tw: 5, th: 3, mapId: 80, ntype: 0, hint: 'ntype=0：haikei(0,0,150,90) 青山+房子' },
    { id: 'bg_grass', cat: 'bg', name: '草丛', kind: 'sprite', img: 'bg/bg_grass.png',
      tw: 2, th: 1, mapId: 81, ntype: 1, hint: 'ntype=1：haikei(151,0,65,29) 五根尖草' },
    { id: 'bg_cloud_face', cat: 'bg', name: '脸云(背景)', kind: 'sprite', img: 'bg/bg_cloud_face.png',
      tw: 2, th: 1, mapId: 82, ntype: 2, hint: 'ntype=2：haikei(151,31,70,40)' },
    { id: 'bg_tree', cat: 'bg', name: '松树', kind: 'sprite', img: 'bg/bg_tree.png',
      tw: 3, th: 3, mapId: 83, ntype: 3, hint: 'ntype=3：haikei(0,91,100,90) 三层松树' },
    { id: 'bg_cloud_angry', cat: 'bg', name: '怒云', kind: 'sprite', img: 'bg/bg_cloud_angry.png',
      tw: 2, th: 1, mapId: 84, ntype: 4, hint: 'ntype=4：haikei(151,113,51,29) 生气的云' },
    { id: 'bg_tree_round', cat: 'bg', name: '圆树', kind: 'sprite', img: 'bg/bg_tree_round.png',
      tw: 1, th: 2, mapId: 85, ntype: 5, hint: 'ntype=5：haikei(222,0,28,60) 黄绿色圆头树' },
    { id: 'bg_lava', cat: 'bg', name: '熔岩浪', kind: 'sprite', img: 'bg/bg_lava.png',
      tw: 3, th: 1, mapId: 86, ntype: 6, hint: 'ntype=6：haikei(151,143,90,40) 红色熔岩' },

    // ================= 背景音乐（bgmchange） =================
    { id: 'bgm_field', cat: 'audio', name: '地上BGM', kind: 'audio', bgmId: 100,
      file: 'audio/field.mp3', tw: 1, th: 1, color: '#4caf50', hint: 'bgmchange(100)：field.mp3，地上关卡' },
    { id: 'bgm_dungeon', cat: 'audio', name: '地下BGM', kind: 'audio', bgmId: 103,
      file: 'audio/dungeon.mp3', tw: 1, th: 1, color: '#00bcd4', hint: 'bgmchange(103)：dungeon.mp3，地下关卡' },
    { id: 'bgm_star', cat: 'audio', name: '空中/无敌BGM', kind: 'audio', bgmId: 104,
      file: 'audio/star4.mp3', tw: 1, th: 1, color: '#ffd740', hint: 'bgmchange(104)：star4.mp3，空中关卡' },
    { id: 'bgm_castle', cat: 'audio', name: '城堡BGM', kind: 'audio', bgmId: 105,
      file: 'audio/castle.mp3', tw: 1, th: 1, color: '#9e9e9e', hint: 'bgmchange(105)：castle.mp3，城堡关卡' },
    { id: 'bgm_puyo', cat: 'audio', name: '结局BGM', kind: 'audio', bgmId: 106,
      file: 'audio/puyo.mp3', tw: 1, th: 1, color: '#e91e63', hint: 'bgmchange(106)：puyo.mp3，通关结局' }
  ];

  window.CAT = {
    CATS: CATS,
    ELEMENTS: ELEMENTS,
    byId: function (id) {
      for (var i = 0; i < ELEMENTS.length; i++) if (ELEMENTS[i].id === id) return ELEMENTS[i];
      return null;
    },
    TILE: (window.SPRITE_MANIFEST && window.SPRITE_MANIFEST.tile) || 29,
    ROWS: 17,
    // 注册自定义元素（动态追加到 ELEMENTS）
    registerCustom: function (def) {
      // 去重：同 id 先移除
      for (var i = 0; i < ELEMENTS.length; i++) {
        if (ELEMENTS[i].id === def.id) { ELEMENTS.splice(i, 1); break; }
      }
      def.custom = true;
      ELEMENTS.push(def);
    },
    // 移除自定义元素
    removeCustom: function (id) {
      for (var i = 0; i < ELEMENTS.length; i++) {
        if (ELEMENTS[i].id === id && ELEMENTS[i].custom) {
          ELEMENTS.splice(i, 1);
          return true;
        }
      }
      return false;
    },
    // 获取所有自定义元素
    listCustom: function () {
      return ELEMENTS.filter(function (e) { return e.custom; });
    }
  };
})();
