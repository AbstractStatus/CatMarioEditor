// ===================================================================
// 猫里奥新引擎 - 核心引擎
// 复刻 catmario/src/main.cpp 的游戏逻辑，原生支持左右滚动和敌人重生
// 坐标系：世界单位 = 像素 * 100
// ===================================================================
(function (global) {
  'use strict';

  var C = global.Constants;
  var S = global.Sprites;
  var A = global.AudioSys;
  var IN = global.Input;
  var Lv = global.Levels;
  var PT = global.PipeTypes;
  var BlockTypes = global.BlockTypes;
  var LiftTypes = global.LiftTypes;

  // ---- 合并升降台（元素 id=lift）默认参数 ----
  // 运动/行为由编辑器属性配置，经 play.html convert 转成 sracttype/sre/bhv/proximity/color；
  // 这里集中存放原版硬编码数值，供运行时兜底。
  var LIFT_BREAK_DEFAULT = { parts: 2, vx: 240, vy: -1400, grav: 160, w: 4500, h: 4500, life: 120, sound: 3 };
  var LIFT_CONTACT_SPEED = 900;   // 接触加速：站上往复台瞬间台速绝对值提到 900（原版 main.cpp:2774）
  var LIFT_PROX_DIST = 1500;      // 靠近触发：水平接近距离
  var LIFT_PROX_ACCEL = 60;       // 靠近触发后下坠加速度（srf）
  var LIFT_COLOR_HEX = { yellow: '#dcdc00', green: '#00dc00', gray: '#b4b4b4' };

  var Engine = {};

  // ==================== 游戏状态 ====================
  var state = {
    proc: C.PROC.TITLE,
    maintm: 0,
    paused: false,
    stagecolor: 1,
    fx: 0, fy: 0, fzx: 0, fzy: 0,
    scrollx: 0, scrolly: 0,
    kscroll: 0,
    score: 0, scorepos: 0,
    life: 0,   // 死亡次数（原版 save.life），剩余生命 = 2 - life
    cheat: false,  // 作弊模式（C 键切换）：方向键悬空移动、不死亡
    speedup: false,  // 加速模式（空格按住）：物理 2x 倍速
    randomMode: false,  // 随机模式（标题画面按 0 开关）：参考旧引擎 RAND_STAGE 宏，当前关卡内元素随机分布
    sta: 1, stb: 1, stc: 0,
    _showTraps: false,   // 调试模式：显示陷阱区域
    _stagecolor: 1,      // 当前关卡色调缓存（供 PipeTypes 渲染使用）
    tyuukan: 0,
    ending: 0,
    blacktm: 1, blackx: 0,
    stageonoff: 0,
    // 数据数组
    blocks: [],      // t[]
    pipes: [],       // s[]
    enemies: [],     // a[]
    triggers: [],    // b[]
    particles: [],   // e[]
    bg: [],          // n[]
    lifts: [],       // sr[]
    // 玩家
    player: null,
    // 中间旗检查点（触碰后保存的复活坐标 {ma,mb}，本关内死亡复活时复用；进下一关/新游戏时清空）
    checkpoint: null,
    // 传送出生位置覆盖（音符块/传送管道口的 warp.spawnMode）：
    // {x,y}|{ma,mb} + persist（true=永远，死亡复活保留；false=单次，loadStage 用后即清）；
    // 普通进管/通关/新游戏等非 warp 换关时清空
    warpSpawn: null,
    // 通关后去向配置 {end, id}（来自关卡定义 def.nextLevel）
    nextLevel: null,
    onGoalNext: null,
    // 消息
    mmsgtm: 0, mmsgtype: 0,
    mainmsgtype: 0,  // 主消息类型（原版 mainmsgtype）
    tmsgtype: 0, tmsgtm: 0, tmsg: 0, tmsgy: 0
  };

  // ==================== 提示块默认文本 ====================
  // txtype → 行数组（原版 IDS_TMSG_* 中文版）
  // 自定义文本通过 state.hintTexts[txtype] 覆盖
  var DEFAULT_HINT_TEXTS = {
    0: ["Test hoge"],
    1: ["居然可以通过第一关",
        "看来有点实力啊",
        "接下来要当心一点～",
        "因为真正的挑战才刚刚开始...",
        "                      哇哈哈哈哈"],
    2: ["            必须获得带有？的道具",
        "                         m9(^Д^)"],
    3: ["   吃再多的金币，也不会增加分数.. ",
        "                      (・ω・ )ﾉｼ"],
    4: ["前方有一个隐藏的方块",
        "请小心一点 !!"],
    5: [" 比上一关玩难度更低了",
        " 请随便玩玩吧",
        "                       作者"],
    6: [" 你站在敌人的旁边",
        " 它就会和你一起跳起来。",
        " 真是太可爱了。"],
    7: [" 你把那个会跳到敌人带来了吗？",
        " 如果你没把它带过来、",
        " 那我就把你踢到坑里 Let's dive!"],
    8: ["别想着很容易的",
        "就能走捷径",
        "接下来怎么办，自己想办法吧!!"],
    9: [" 这是正宗的最后一关。",
        " 只要能打通，就能迎来结局!!",
        " 我能从那跟管道里回去吗?"],
    100: ["诶?是我吗? ",
          "不是的, 我只是一个路过的提示框",
          "不是很奇怪的方块～",
          "",
          "                          "]
  };

  // 制作名单（スタッフロール）19 行文本，对应原版 str.h IDS_STAFF_1~19 官中版
  var STAFF_TEXT = [
    '制作名单',
    '关卡1 制作',
    '先輩　Ⅹ～Ｚ',
    '关卡2 制作',
    '友人　willowlet',
    '关卡3 制作',
    '友人　willowlet',
    '关卡4 制作',
    '友人２　ann',
    '协助',
    'Ｔ先輩',
    'Ｓ先輩',
    '動画技術提供',
    'Ｋ先輩',
    '动画制作',
    'willowlet',
    '程序・美术・动画',
    'ちく',
    '感谢您的参与～'
  ];

  // ==================== 台词气泡系统 ====================
  // 文本来源：旧引擎 src/str.h 官中版（IDS_MSG_* 玩家台词 / IDS_AMSG_* 敌人台词）。
  // 触发点与旧引擎 main.cpp 一致：
  //   玩家台词在受伤/拾取现场触发（main.cpp:3685-3717、3224 等）；
  //   敌人嘲讽在接触击杀分支触发（main.cpp:3601-3659）。
  // 气泡用世界坐标锚定（随镜头与实体移动），倒计时按 C._DT 缩放，时长沿用旧帧值。

  // 玩家台词（原版 mmsgtype，气泡跟随玩家头顶）
  var PLAYER_LINES = {
    1: '好吃!!',                        // 碰到脸云(atype100/axtype0) main.cpp:3685
    2: '虽然没有毒...',                  // 碰到普通云(atype100/axtype1) main.cpp:3687
    3: '被刺死了!!',                     // 尖刺块(ttype10) main.cpp:2170 / 恶星(atype110) :3717
    10: '吃蘑菇才不会变大呢..',           // 毒蘑菇(atype102) main.cpp:3690
    11: '肚子里有火球，烫死了!!',         // 火焰花(atype101) main.cpp:3689
    50: '身体烧着了……',                  // 火球(atype84) main.cpp:3648
    51: '这...!!',                       // 火焰棒(87/88) main.cpp:3224/3250 / 机关陷阱 :1920
    52: '死路一条',                      // 陷阱管道（旧 mxtype=5 main.cpp:1921）
    53: '我的脚、我的脚啊!!',             // 疲劳升降台 main.cpp:2828
    54: '不愧是摄氏800度!!',             // 弹跳/横向火焰(atype9/10) main.cpp:3628
    55: '烫死了……'                       // 城堡岩浆 main.cpp:2073（stagecolor==4）
  };

  // 敌人台词（原版 amsgtype，气泡跟随对应敌人）
  // 1001-1008 / 1011-1018 / 1021-1028 / 1031-1038：第 1~4 大关普通怪
  // （白猫0/弹簧白猫7/皇冠4）的随机嘲讽池
  var ENEMY_LINES = {
    1001: 'Yeah!!', 1002: '恩？这样就赢了？', 1003: '简直是不堪一击!',
    1004: '你确定你会打游戏？', 1005: '我是最强的!!', 1006: '没见过这么笨的!!',
    1007: '冲啊!!', 1008: '哈哈!!',
    1011: '...', 1012: '完全不是我的对手', 1013: '这里就是你的归宿!',
    1014: '你这个不知天高地厚的家伙……', 1015: '少看不起我了', 1016: '菜鸟一个',
    1017: '笨死了!!', 1018: '太乱来了……',
    1021: 'Yes!!', 1022: '我就这么赢了吗?', 1023: '你还是放弃吧',
    1024: '就你也敢跟我斗？', 1025: '我是不会输的!!', 1026: '我这招是不会被你识破的',
    1027: '去死吧!!', 1028: '任務完成!!',
    1031: 'Yahoo!!', 1032: '就这么赢了?', 1033: '今天就是您的死期了!',
    1034: '居然敢碰我……', 1035: '大意了吧', 1036: '你也没那么厉害么',
    1037: '笨蛋!', 1038: '太乱来了……',
    15: '我有壳，我是无敌的!!', 16: '你就这身垃圾装备还想赢我?',
    17: '巴里!!', 18: '这是你自找的',
    20: 'Zzz', 21: '好、好吃', 24: '?',
    25: '不应该吃它的!!',                 // 小猫咪(30)吃到毒蘑菇时 main.cpp:3151
    30: '哎呀，不好意思!!', 31: '不带这么玩的..', 32: '我来了',
    50: '波動砲!!',                       // 激光陷阱(stype103)发射瞬间 main.cpp:2636
    85: '你觉得被出卖了吗?', 86: '超级攻击!!'
  };

  var BUBBLE_FADE_IN = 3, BUBBLE_FADE_OUT = 6;   // 淡入淡出帧数（30Hz 帧单位）

  // 玩家说台词（time 为旧引擎帧值，30≈1 秒；内部按 C._DT 倒计时）
  function sayPlayer(type, time) {
    var p = state.player;
    if (!p || !PLAYER_LINES[type]) return;
    p.mmsgtm = time; p.mmsgtype = type; p._mmsgmax = time;
  }
  // 敌人说台词
  function sayEnemy(e, type, time) {
    if (!e || !ENEMY_LINES[type]) return;
    e.amsgtm = time; e.amsgtype = type; e._amsgmax = time;
  }
  // 旧引擎 getrand(n)=floor(rand*n)，取值 0..n-1（lib.js:384，上界不含）
  function oldRand(n) { return (Math.random() * n) | 0; }

  // 玩家被敌人接触击杀时的台词分派（对应旧 main.cpp:3601-3659 的 mhp==0 分支）
  function dispatchContactLine(e) {
    switch (e.atype) {
      case 0: case 7: case 4: {
        // 旧：getrand(7)+1+1000+(stb-1)*10 → 每大关只能取到 1001..1007（1008 永远抽不到）
        var grp = state.stb < 1 ? 1 : (state.stb > 4 ? 4 : state.stb);
        sayEnemy(e, 1000 + (grp - 1) * 10 + 1 + oldRand(7), 60);
        break;
      }
      case 1: sayEnemy(e, 15 + oldRand(2), 60); break;       // 绿龟：15/16（17 抽不到）
      case 2: if (e.axtype >= 1) sayEnemy(e, 18, 60); break; // 滑动中的龟壳
      case 3: sayEnemy(e, 20, 60); break;                    // 幽灵
      case 5: sayEnemy(e, 21, 60); break;                    // 吐舌猫
      case 9: case 10: sayPlayer(54, 30); break;             // 火焰
      case 31: sayEnemy(e, 24, 30); break;                   // 肌肉鸡
      case 80: case 81: sayEnemy(e, 30, 60); break;          // 云怪
      case 84: sayPlayer(50, 30); break;                     // 火球
      case 85: sayEnemy(e, 85 + oldRand(1), 60); break;      // 假旗杆（旧只抽得到 85）
      // 82(伪装方块) 由变形专属分支处理（31）；79(激光) 台词在发射瞬间播放；
      // 6(机器人)不造成伤害；8(奔跑怪)/86/90 等敌人旧版无台词
    }
  }

  // 台词计时（frame() 内调用；提示块面板暂停游戏时气泡仍可自然消散）
  function tickBubbles() {
    var p = state.player;
    if (p && p.mmsgtm > 0) {
      p.mmsgtm -= C._DT;
      if (p.mmsgtm <= 0) { p.mmsgtm = 0; p.mmsgtype = 0; }
    }
    var es = state.enemies;
    for (var i = 0; i < es.length; i++) {
      var e = es[i];
      if (e.amsgtm > 0) {
        e.amsgtm -= C._DT;
        if (e.amsgtm <= 0) { e.amsgtm = 0; e.amsgtype = 0; }
      }
    }
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    var rr = r > h / 2 ? h / 2 : r;
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // 绘制单个气泡。cx/ay 为屏幕虚拟像素，ay = 角色头顶（气泡尾巴尖指向处）
  function drawSpeechBubble(ctx, cx, ay, text, tm, maxTm, fill) {
    if (tm <= 0) return;
    var alpha = 1;
    if (maxTm - tm < BUBBLE_FADE_IN) alpha = (maxTm - tm) / BUBBLE_FADE_IN;
    if (tm < BUBBLE_FADE_OUT) alpha = Math.min(alpha, tm / BUBBLE_FADE_OUT);
    if (alpha <= 0) return;

    var padX = 7, bh = 20, tailH = 5, tailW = 8;
    var tw = ctx.measureText(text).width;
    var bw = tw + padX * 2;
    if (bw < 34) bw = 34;
    var bx = cx - bw / 2;
    if (bx < 3) bx = 3;
    if (bx > C.CANVAS_W - 3 - bw) bx = C.CANVAS_W - 3 - bw;
    var by = ay - tailH - bh;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    // 尾巴
    var tx = cx;
    if (tx < bx + 7) tx = bx + 7;
    if (tx > bx + bw - 7) tx = bx + bw - 7;
    ctx.beginPath();
    ctx.moveTo(tx - tailW / 2, by + bh);
    ctx.lineTo(tx + tailW / 2, by + bh);
    ctx.lineTo(tx, ay);
    ctx.closePath();
    ctx.fill();
    // 气泡框
    roundRectPath(ctx, bx, by, bw, bh, 6);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 尾巴斜边描边
    ctx.beginPath();
    ctx.moveTo(tx - tailW / 2, by + bh - 0.5);
    ctx.lineTo(tx, ay - 1);
    ctx.lineTo(tx + tailW / 2, by + bh - 0.5);
    ctx.stroke();
    // 文字
    ctx.fillStyle = '#000';
    ctx.fillText(text, bx + bw / 2, by + bh / 2 + 0.5);
    ctx.restore();
  }

  // 渲染全部台词气泡（在实体/管道之后、提示块面板之前调用）
  function renderBubbles(ctx) {
    if (state.proc !== C.PROC.GAME || !state.player) return;
    var p = state.player;
    ctx.save();
    ctx.font = '12px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (p.mmsgtm > 0 && PLAYER_LINES[p.mmsgtype]) {
      var cx = (p.ma + p.mnobia / 2 - state.fx) / 100;
      var ay = (p.mb - state.fy) / 100 - 4;
      if (cx > -80 && cx < C.FXMAX / 100 + 80 && ay > -60 && ay < C.FYMAX / 100 + 40) {
        drawSpeechBubble(ctx, cx, ay, PLAYER_LINES[p.mmsgtype],
          p.mmsgtm, p._mmsgmax || p.mmsgtm, '#ffffff');
      }
    }
    for (var i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      if (e.amsgtm <= 0 || !ENEMY_LINES[e.amsgtype]) continue;
      var ecx = (e.aa + e.anobia / 2 - state.fx) / 100;
      var eay = (e.ab - state.fy) / 100 - 4;
      if (ecx > -120 && ecx < C.FXMAX / 100 + 120 && eay > -60 && eay < C.FYMAX / 100 + 40) {
        drawSpeechBubble(ctx, ecx, eay, ENEMY_LINES[e.amsgtype],
          e.amsgtm, e._amsgmax || e.amsgtm, '#fff39a');
      }
    }
    ctx.restore();
  }

  // 临时变量（仿原版 xx[]）
  var xx = {};

  // ==================== 玩家对象 ====================
  function createPlayer() {
    return {
      ma: 5600, mb: 32000,        // 屏幕坐标 x, y
      mc: 0, md: 0,                // 速度 x, y
      mnobia: C.PLAYER_W, mnobib: C.PLAYER_H,
      mhp: 1,
      mtype: C.MTYPE.NORMAL,
      mxtype: 0,
      mtm: 0,
      mzimen: 0,                   // 是否站在地面
      mrzimen: 0,                  // 滑行
      mkasok: 0,
      mmuki: 1,                    // 朝向 0=左 1=右
      mmukitm: 0,
      mjumptm: 0,
      mkeytm: 0,
      mact: 0, mactp: 0,
      mzz: 0,
      mmutekitm: 0, mmutekion: 0,
      // 台词气泡（原版 mmsgtm/mmsgtype；_mmsgmax 记录初始时长用于淡入淡出）
      mmsgtm: 0, mmsgtype: 0, _mmsgmax: 0,
      actaon: [0, 0, 0, 0, 0]      // [左右, 跳, 跳按住, 下, 左右方向]
    };
  }

  // 自定义元素图片缓存（dataUrl → Image）
  var _customImgCache = {};

  // ==================== 关卡加载 ====================
  // 拷贝传送对象 {end,id} 并附带出生位置覆盖（spawnMode once/forever + spawnCol/spawnRow）
  function copyWarp(w) {
    if (!w) return null;
    var o = { end: !!w.end, id: w.id || null };
    if (w.spawnMode === 'once' || w.spawnMode === 'forever') {
      o.spawnMode = w.spawnMode;
      o.spawnCol = w.spawnCol | 0;
      o.spawnRow = w.spawnRow | 0;
    }
    return o;
  }
  function loadStage() {
    var def = Lv.get(state.sta, state.stb, state.stc);
    // 原版世界 def 自带世界坐标：载入时同步引擎内部 sta/stb/stc，
    // 使通关 stb++、进管 stc++ 后下一次 Lv.get 能取到正确的关卡
    if (def.sta) { state.sta = def.sta; state.stb = def.stb; state.stc = def.stc || 0; }
    state.stagecolor = def.stagecolor;
    state._stagecolor = def.stagecolor;
    state.scrollx = def.scrollx;

    // 事件触发器已触发标记：与 checkpoint 同生命周期（死亡复活保留、换关清空）。
    // 换关靠坐标键检测（进管 stc++/通关 stb++ 都在 startGame 前改坐标）；
    // 同坐标的新游戏（标题重开/外部 startGame）由调用点显式清空
    var _evKey = state.sta + ',' + state.stb + ',' + state.stc;
    if (state._evStageKey !== _evKey || !state._evFired) state._evFired = {};
    state._evStageKey = _evKey;

    // 清空
    state.blocks = [];
    state.pipes = [];
    state.enemies = [];
    state.triggers = [];
    state.particles = [];
    state.bg = [];
    state.lifts = [];
    state.eventTriggers = [];
    // 重置提示块消息状态
    state.tmsgtype = 0; state.tmsgtm = 0; state.tmsg = 0; state.tmsgy = 0;

    // 加载字节网格
    var grid = def.grid;
    // 编辑器实例 uid 的平行网格（play.html convert 生成；原版 STAGES 无此数据时为 null）
    var guids = def.gridUid || null;
    // 方块顺序必须与旧引擎一致：stagep() 的自定义 tyobi 块先注册（tco=0 起），
    // main.cpp:4075 网格扫描块追加在后（main.cpp:4070 stagep() 在网格循环之前调用）。
    // 旧陷阱按硬编码索引引用方块（stype=105 移 blocks[1]/blocks[2]；stype=103/1 判 blocks[6]），
    // 顺序反了会指错方块。故先放 def.blocks，网格块收集后追加。
    def.blocks.forEach(function (b) {
      state.blocks.push({
        // ttype=116（旧引擎P开关问号块，如 1-3 的54列9行）归一为 105，渲染/行为走同一通道
        ta: b.x * 100, tb: b.y * 100, ttype: b.type === 116 ? 105 : b.type, txtype: b.xt || 0, thp: 0, titem: 0,
        followJump: (b.followJump != null) ? !!b.followJump : (b.type === 100 && (b.xt || 0) === 0),
        // showQ：ttype=110 隐藏量产块的"可见问号块"扩展（编辑器问号块+量产），原版 110 不绘制
        showQ: !!b.showQ,
        uid: b.uid || null,
        // 行为属性覆盖（BlockTypes 注册表默认值的实例级覆盖；编辑器属性面板写回）
        bhv: b.bhv ? JSON.parse(JSON.stringify(b.bhv)) : null,
        // ttype=117 桃色音符块：冲顶后的传送目标 {end,id,spawnMode,spawnCol,spawnRow}
        // （解耦原硬编码 stc+=5；无此字段时走原版默认上空子关 stc+=5）
        warp: copyWarp(b.warp)
      });
    });
    var _gridBlocks = [];
    for (var tt = 0; tt <= 1000; tt++) {
      for (var t = 0; t <= 16; t++) {
        var v = grid[t][tt];
        if (v === 0) continue;
        var wx = tt * 29 * 100;
        var wy = (t * 29 - 12) * 100;
        var uid0 = guids ? (guids[t][tt] || null) : null;
        if (v >= 1 && v <= 19 && v !== 9) {
          _gridBlocks.push({ ta: wx, tb: wy, ttype: v, txtype: 0, thp: 0, titem: 0, uid: uid0 });
        } else if (v >= 20 && v <= 29) {
          state.lifts.push({ sra: wx, srb: wy, src: 3000, srtype: 0, sracttype: 0, sre: 0, srf: 0, srsp: 0, sron: 0, srmuki: 0, srsok: 0, srmove: 0, srmovep: 0, uid: uid0 });
        } else if (v === 30) {
          state.pipes.push({ sa: wx, sb: wy, sc: 3000, sd: 6000, stype: 500, sxtype: 0, sgtype: 0, sr: 0, uid: uid0 });
        } else if (v === 40) {
          state.pipes.push({ sa: wx, sb: wy, sc: 6000, sd: 3000, stype: 1, sxtype: 0, sgtype: 0, sr: 0, uid: uid0 });
        } else if (v === 41) {
          state.pipes.push({ sa: wx + 500, sb: wy, sc: 5000, sd: 3000, stype: 2, sxtype: 0, sgtype: 0, sr: 0, uid: uid0 });
        } else if (v === 43) {
          state.pipes.push({ sa: wx, sb: wy + 500, sc: 2900, sd: 5300, stype: 1, sxtype: 0, sgtype: 0, sr: 0, uid: uid0 });
        } else if (v === 44) {
          state.pipes.push({ sa: wx, sb: wy + 700, sc: 3900, sd: 5000, stype: 5, sxtype: 0, sgtype: 0, sr: 0, uid: uid0 });
        } else if (v >= 50 && v <= 79) {
          state.triggers.push({ ba: wx, bb: wy, btype: v - 50, bxtype: 0, bz: 1, btm: 0, spawned: false, uid: uid0 });
        } else if (v >= 80 && v <= 89) {
          state.bg.push({ na: wx, nb: wy, ntype: v - 80, uid: uid0 });
        } else if (v === 9) {
          _gridBlocks.push({ ta: wx, tb: wy, ttype: 800, txtype: 0, thp: 0, titem: 0, uid: uid0 });
        } else if (v === 99) {
          state.pipes.push({ sa: wx, sb: wy, sc: 3000, sd: (12 - t) * 3000, stype: 300, sxtype: 0, sgtype: 0, sr: 0, uid: uid0 });
        }
      }
    }
    // 网格块追加在自定义块之后（索引与旧引擎 tyobi 顺序一致）
    _gridBlocks.forEach(function (b) { state.blocks.push(b); });

    // 管道
    var _fbCreated = [];   // stype=51 砖组创建记录（原版连锁自动接线用）
    def.pipes.forEach(function (p) {
      var pipe = { sa: p.sa, sb: p.sb, sc: p.sc, sd: p.sd, stype: p.stype, sxtype: p.sxtype || 0, sgtype: 0, sr: 0, uid: p.uid || null };
      if (p.stype === 51) _fbCreated.push({ p: p, pipe: pipe });
      // stype=106 通用陷阱：保留方向(dir) + 目标对象(target) + 生成个数(count) + 生成区 AABB(gsa/gsb/gsc/gsd)
      if (p.stype === 106) {
        pipe.dir = p.dir || 'down'; pipe.target = p.target || 'enemy_ghost';
        pipe.count = Math.max(1, Math.min(12, p.count | 0 || 1));
        if (p.gsa != null) pipe.gsa = p.gsa | 0;
        if (p.gsb != null) pipe.gsb = p.gsb | 0;
        if (p.gsc != null) pipe.gsc = p.gsc | 0;
        if (p.gsd != null) pipe.gsd = p.gsd | 0;
      }
      // stype=180 喷火管：保留喷射周期 sgtype（物理帧，默认48≈1.6秒）+ 喷射对象 target；
      // dir 由下方通用逻辑保留；sr 帧计数每次载入从 0 开始
      if (p.stype === 180) {
        pipe.sgtype = Math.max(1, p.sgtype | 0 || 48);
        pipe.target = p.target || 'enemy_fireball';
      }
      // stype=60 传送管道口：保留传送目标 {end,id} 及出生位置覆盖
      if (p.warp) pipe.warp = copyWarp(p.warp);
      // 喷出管道（编辑器 pipe_mouth entry='eject'）：透传进入事件标记（PipeTypes[50] 读取）
      if (p.entry) pipe.entry = p.entry;
      // stype=51 坠落砖组：保留通用运动配置 {axis:'x'|'y', dir:-1|1}
      if (p.mov) pipe.mov = { axis: p.mov.axis === 'x' ? 'x' : 'y', dir: p.mov.dir < 0 ? -1 : 1 };
      // stype=51 延时（秒）：convert 路径由元素 delay 提供；原版 sxtype=1/2（1-2-1 连锁桥）
      // 无 delay 字段，注入兜底值（仅当连锁自动接线未命中目标时才生效——
      // 接线成功后走旧引擎连锁语义，物理侧忽略 delay）
      if (p.delay != null) pipe.delay = Math.max(0, +p.delay || 0);
      else if (p.stype === 51 && (p.sxtype === 1 || p.sxtype === 2)) pipe.delay = p.sxtype === 1 ? 0.5 : 1;
      // stype=51 链式触发：目标砖组 uid（触发本组时联动触发目标，目标按自身 delay 倒计时）
      if (p.chain) pipe.chain = String(p.chain);
      // stype=51 静态砖（block_brick_m）：关闭自动坠落，仅事件 move 平移 sa/sb
      if (p.noauto) pipe.noauto = true;
      // 自定义元素管道：保留 _custom 用于渲染
      if (p._custom) pipe._custom = p._custom;
      // connector 统一边框 pipe（stype 76）：保留 lengths + dirs
      if (p.lengths) pipe.lengths = p.lengths.slice();
      if (p.dirs) pipe.dirs = p.dirs.slice();
      // connector 单臂 pipe（stype 75）：保留 dir 给渲染用
      if (p.dir) pipe.dir = p.dir;
      // 陷阱管道（stype=50 sxtype=0）：抖动动画参数覆盖（默认=PipeTypes.trapPipeAnimDefault）
      if (p.trapAnim) pipe.trapAnim = JSON.parse(JSON.stringify(p.trapAnim));
      state.pipes.push(pipe);
    });

    // 1-2-1 连锁崩塌桥自动接线（无显式 chain 的 sxtype=0/1）：
    // 按管线顺序（=旧引擎 sa[] 数组顺序）sxtype=0 → 首个 sxtype=1 砖组、sxtype=1 → 首个 sxtype=2 砖组。
    // 接线后走通用联动语义：sxtype=0 触发时调 triggerFallChain 沿 chain 向下递归触发目标，
    // 各目标按自身 delay 倒计时后坠落（原版 1-2-1：p6→p7 0.5s、p7→p8 1.0s）。
    // sxtype=1/2 自身不靠近触发（physics 分支仅在无 chain 时退化靠近触发）。
    (function () {
      // 先给所有 stype=51 砖组补 uid（原版数据无 uid，链源/目标都可能被引用）
      for (var ui = 0; ui < _fbCreated.length; ui++) {
        var u = _fbCreated[ui];
        if (!u.pipe.uid) u.pipe.uid = '_fb' + ui;
      }
      for (var wi = 0; wi < _fbCreated.length; wi++) {
        var w = _fbCreated[wi];
        if (w.p.chain) continue;
        var sx = w.p.sxtype || 0;
        if (sx !== 0 && sx !== 1) continue;        // sxtype=0/1 才向下接线
        var want = sx + 1;                          // sxtype=0→1, sxtype=1→2
        for (var wj = 0; wj < _fbCreated.length; wj++) {
          var c = _fbCreated[wj];
          if (c === w || (c.p.sxtype || 0) !== want) continue;
          w.pipe.chain = c.pipe.uid;
          break;
        }
      }
    })();

    // 注册自定义 stype（>=700）到 PipeTypes，提供实体碰撞 + 图片渲染
    def.pipes.forEach(function (p) {
      if (p.stype >= 700 && p._custom && !PipeTypes.get(p.stype)) {
        PipeTypes.register(p.stype, {
          solid: true,
          render: function (ctx, s, xx) {
            var cu = s._custom;
            if (!cu) return;
            if (!_customImgCache[cu.dataUrl]) {
              var im = new Image();
              im.src = cu.dataUrl;
              _customImgCache[cu.dataUrl] = im;
            }
            var im = _customImgCache[cu.dataUrl];
            if (im && im.complete && im.naturalWidth > 0) {
              ctx.drawImage(im, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100),
                cu.tw * 29, cu.th * 29);
            }
          }
        });
      }
    });

    // 敌人触发器
    def.enemies.forEach(function (e) {
      // btype=105 绿色问号球：可见形态与触碰事件完全由 eventTriggers 承载
      // （play.html _worldDef 分支 step5 已为每个 btype=105 注入对应 trigger，
      // 含 img/repeat/events）。此处不再生成普通敌人触发器，否则同一位置
      // drawEnemy(sprite 105/3) 与 eventTrigger 各画一个绿问号球 → 显示 2 个。
      if (e.btype === 105) return;
      // followJump（跳跃跟随，解耦属性）：显式优先；原版 atype=4/axtype=1（尖刺馒头怪跟随跳）
      // 未携带属性时自动迁移，保持原版行为不变
      var followJump = (e.followJump != null) ? !!e.followJump : (e.btype === 4 && (e.bxtype || 0) === 1);
      var trig = { ba: e.ba, bb: e.bb, btype: e.btype, bxtype: e.bxtype || 0, bdir: e.bdir || null, bz: 1, btm: 0, spawned: false, uid: e.uid || null, followJump: followJump };
      // baway：编辑器「移动方向=远离玩家」。生成敌人时把 spawnEnemy 按玩家位置推断的
      // 初始 amuki 翻转一次；缺省/旧数据无此标记 = 靠近玩家 = 原版行为
      if (e.baway) trig.baway = true;
      if (e._custom) trig._custom = e._custom;
      state.triggers.push(trig);
    });

    // 背景装饰（自定义 ntype=-1）
    (def.bg || []).forEach(function (n) {
      var bgObj = { na: n.na, nb: n.nb, ntype: n.ntype, uid: n.uid || null };
      if (n._custom) bgObj._custom = n._custom;
      state.bg.push(bgObj);
    });

    // 事件触发器（编辑器 trap_event/block_qball 透传；原版 def 无此字段）
    (def.eventTriggers || []).forEach(function (t) {
      // repeat=true（问号球）：每次关卡载入都可再触发，不查 _evFired 持久化
      // repeat 缺省/false（trap_door 等）：载入时按 _evFired 还原 fired，保持"一关一次"
      var _isRepeat = !!t.repeat;
      // 问号球是实体元素：像普通敌人一样受重力下落、站在地形上，不悬浮。
      // 碰撞盒统一为 1 格并随球一起移动（_worldDef 转换曾给 2 格 AABB 补偿下落，
      // 现在 AABB 跟随球，不再需要）。
      var _isQball = !!(t.img && t.img.indexOf('item_green_question') >= 0);
      state.eventTriggers.push({
        ax: t.ax, ay: t.ay,
        aw: _isQball ? 2900 : t.aw, ah: _isQball ? 2900 : t.ah,
        uid: t.uid || null,
        img: t.img || null,
        events: Array.isArray(t.events) ? t.events : [],
        repeat: _isRepeat,
        fired: !_isRepeat && !!(t.uid && state._evFired[t.uid]),
        physical: _isQball,   // 受重力 + 地形落地
        vy: 0                // 垂直速度（世界单位/帧）
      });
    });

    // 升降台（透传原版字段；srh=悬挂台吊柱高，世界单位，缺省48000=原版写死480px）
    (def.lifts || []).forEach(function (l) {
      state.lifts.push({
        sra: l.sra, srb: l.srb, src: l.src,
        srtype: l.srtype || 0, sracttype: l.sracttype || 0,
        sre: l.sre || 0, srf: l.srf || 0, srsp: l.srsp || 0,
        sron: l.sron || 0, srmuki: l.srmuki || 0, srsok: l.srsok || 0,
        srmove: l.srmove || 0, srmovep: l.srmovep || 0,
        srh: l.srh || 48000, uid: l.uid || null,
        // 合并升降台：颜色（渲染用，缺省按 srsp 反推）+ 靠近触发模式
        color: l.color || null, proximity: !!l.proximity,
        // 行为属性覆盖（LiftTypes 注册表默认值的实例级覆盖；编辑器属性面板写回）
        bhv: l.bhv ? JSON.parse(JSON.stringify(l.bhv)) : null
      });
    });

    // 自定义关卡 BGM（试玩页注入；默认地上 100）
    state.bgmId = def.bgm || 100;
    // 通关后去向 & 提示文本（关卡级配置）
    state.nextLevel = def.nextLevel || null;
    state.hintTexts = def.hintTexts || null;

    // 0 随机元素模式（参考旧引擎 main.cpp RAND_STAGE 宏）
    if (state.randomMode) _randomizeElements();

    // 出生点优先级：
    //  1. 中间旗 state.checkpoint（本关内死亡复活）
    //  2. 传送出生位置覆盖 state.warpSpawn（音符块/传送管道口 warp 携带）：
    //     persist=false（单次修改）用后即清，死亡复活回到关卡自身出生点；
    //     persist=true（永远修改）跨死亡复活保留，直到普通进管/通关/新游戏等换关清空
    //  3. def.spawn：原版抽取关卡 {ma,mb} 直接放置；自定义关 {x,y} 按编辑器像素口径转换
    if (state.player) {
      if (state.checkpoint) {
        state.player.ma = state.checkpoint.ma;
        state.player.mb = state.checkpoint.mb;
      } else if (state.warpSpawn) {
        var ws = state.warpSpawn;
        if (typeof ws.ma === 'number') {
          state.player.ma = ws.ma;
          state.player.mb = ws.mb;
        } else {
          state.player.ma = ws.x * 100 + 200;
          state.player.mb = (ws.y - 30) * 100;   // 略高几格，自然落地
        }
        if (!ws.persist) state.warpSpawn = null;   // 单次修改：仅本次传送生效
      } else if (def.spawn) {
        if (typeof def.spawn.ma === 'number') {
          state.player.ma = def.spawn.ma;
          state.player.mb = def.spawn.mb;
        } else {
          state.player.ma = def.spawn.x * 100 + 200;
          state.player.mb = (def.spawn.y - 30) * 100;   // 略高几格，自然落地
        }
      }
      state.scorepos = state.player.ma;
      var fxp = state.player.ma - C.FXMAX / 2;
      if (fxp > 700 && fxp < state.scrollx) {
        state.fx = fxp;
        state.fzx = fxp;
        _camSnap = true;   // 换关/复活镜头定位为非连续跳变，渲染吸附
      }
    }
  }

  // ==================== 0 随机元素模式 ====================
  // 参考旧引擎 main.cpp:1672-1697 RAND_STAGE 宏。
  // 在 loadStage() 末尾调用，对当前关卡内的元素做随机分布。
  // 核心差异：旧引擎遍历整个固定数组（tmax=641 砖块槽、bmax=81 触发器槽），
  // 新引擎改为"保留原有元素 + 额外填充"，避免清空导致稀疏。
  function _randomizeElements() {
    var i, r;

    // ── 敌人触发器（旧引擎 t 数组 → 新引擎 state.triggers）──
    // 保留现有触发器，再额外生成新触发器填满关卡空间。
    // 密度参考旧引擎：bmax=81 个槽位，全部重新随机化 → 81 个触发器。
    var scrollCols = Math.max(1, Math.round(state.scrollx / 2900)); // 关卡列数（scrollx/29px）
    var existingTrigCount = state.triggers.length;
    var targetTrigCount = Math.max(existingTrigCount, 81); // 至少 81 个（旧引擎密度）
    var addTrigCount = targetTrigCount - existingTrigCount;

    for (i = 0; i < addTrigCount; i++) {
      // 均匀分布在关卡范围内，避免过于集中在开头
      var col = Math.floor((i + 0.5) / addTrigCount * scrollCols);
      var row = Math.floor(Math.random() * 14); // 0~13 行
      var x = col * 2900; // 世界单位（29px * 100）
      var y = (row * 29 - 12) * 100;
      // 类型：0~141；9~99 重抽为 0~8（旧引擎逻辑）
      var btype = Math.floor(Math.random() * 142);
      if (btype >= 9 && btype <= 99) btype = Math.floor(Math.random() * 8);
      var bxtype = Math.floor(Math.random() * 4);
      state.triggers.push({
        ba: x, bb: y, btype: btype, bxtype: bxtype,
        bz: 1, btm: 0, spawned: false, uid: null
      });
    }

    // ── 砖块（旧引擎 b 数组 → 新引擎 state.blocks）──
    // 保留现有砖块，再额外生成新砖块填满关卡空间。
    // 密度参考旧引擎：tmax=641 个槽位，约 2/3 被重新随机化 → ~427 个砖块。
    var existingBlkCount = state.blocks.length;
    var targetBlkCount = Math.max(existingBlkCount, 427); // 至少 ~427 个（旧引擎密度）
    var addBlkCount = targetBlkCount - existingBlkCount;

    for (i = 0; i < addBlkCount; i++) {
      // 均匀分布在关卡范围内
      var col = Math.floor((i + 0.5) / addBlkCount * scrollCols);
      var row = Math.floor(Math.random() * 15); // 0~14 行（原版 getrand(15)）
      var x = col * 2900;
      var y = (row * 29 - 12) * 100 - 3000; // 原版 -1200 - 3000
      // 1/6 概率随机类型，否则保持 0（空，即 invisible）
      var ttype = (Math.floor(Math.random() * 6) === 0) ? Math.floor(Math.random() * 9) : 0;
      state.blocks.push({
        ta: x, tb: y, ttype: ttype, txtype: 0, thp: 0, titem: 0, uid: null
      });
    }

    // ── 关卡色调：25% 概率随机 ──
    if (Math.floor(Math.random() * 4) === 0) {
      state.stagecolor = Math.floor(Math.random() * 4);  // 0~3
      state._stagecolor = state.stagecolor;
    }
  }

  // ==================== 敌人生成 ====================
  function spawnEnemy(xa, xb, xc, xd, xnotm, xtype, xxtype, xbdir) {
    var sz = C.ENEMY_SIZE[xtype] || [3000, 3000];
    var e = {
      aa: xa, ab: xb,
      ac: xc, ad: xd,
      anobia: sz[0], anobib: sz[1],
      atype: xtype, axtype: xxtype,
      bdir: xbdir || null,   // 火焰棒旋转方向：'cw'顺时针 / 'ccw'逆时针 / null=按原版 aa%10 推断
      amuki: 1,
      anotm: xnotm,
      atm: 0, a2tm: 0,
      abrocktm: 0,
      azimentype: 1,
      axzimen: 0,
      aacta: 0, aactb: 0,
      amsgtm: 0, amsgtype: 0, _amsgmax: 0,
      af: 0, ae: 0
    };
    if (e.aa <= state.player.ma + state.player.mnobia / 2) e.amuki = 1;
    else e.amuki = 0;
    // 火焰棒：axtype>=10000 时高位编码初始角度（axtype = 火球数 + (角度+100)*100），
    // 旧数据 axtype=101..110 无角度语义（旧引擎仅 %100 取球数），仍走随机初相
    if (xtype === 87 || xtype === 88) e.atm = xxtype >= 10000
      ? (((Math.floor(xxtype / 100) - 100) % 360 + 360) % 360) * 2
      : Math.floor(Math.random() * 179) - 90;
    // 生成音效（与原版 ayobi 一致）
    if (xtype === 7) A.playSE(C.SE.GHOST_SPRING);
    if (xtype === 10) A.playSE(C.SE.FIRE);
    state.enemies.push(e);
    _debugLog.push({ f: _debugFrame, key: _debugKey, ma: state.player ? state.player.ma : 0, mb: state.player ? state.player.mb : 0, mc: 0, md: 0, mz: 0, mt: 0, before: true, spawn: true, atype: xtype, aa: xa, ab: xb });
    return e;
  }

  // 粒子生成
  function spawnParticle(xa, xb, xc, xd, xe, xf, xnobia, xnobib, xgtype, xtm) {
    state.particles.push({
      ea: xa, eb: xb, ec: xc, ed: xd, ee: xe, ef: xf,
      enobia: xnobia, enobib: xnobib, egtype: xgtype, etm: xtm
    });
  }

  // ==================== 玩家输入与物理 ====================
  function updatePlayer(key) {
    var p = state.player;

    // 作弊模式：方向键自由移动、无视重力、不死亡（C 键切换）
    if (state.cheat) {
      var spd = 400;
      p.mc = 0; p.md = 0;
      if (key & C.KEY.LEFT) { p.ma -= spd * C._DT; p.mmuki = 0; }
      if (key & C.KEY.RIGHT) { p.ma += spd * C._DT; p.mmuki = 1; }
      if (key & C.KEY.JUMP) p.mb -= spd * C._DT;   // 上/空格 = 向上
      if (key & C.KEY.DOWN) p.mb += spd * C._DT;    // 下 = 向下
      p.mhp = 1;
      p.mzimen = 0;
      p.mtype = 0;
      return;
    }

    xx[0] = 0; p.actaon[2] = 0; p.actaon[3] = 0;

    if (p.mkeytm <= 0) {
      if ((key & C.KEY.LEFT)) { p.actaon[0] = -1; p.mmuki = 0; p.actaon[4] = -1; }
      if ((key & C.KEY.RIGHT)) { p.actaon[0] = 1; p.mmuki = 1; p.actaon[4] = 1; }
      if (key & C.KEY.DOWN) { p.actaon[3] = 1; }
    }

    if (p.mkeytm <= 0) {
      if (key & C.KEY.JUMP) {
        if (p.actaon[1] === 10) { p.actaon[1] = 1; xx[0] = 1; }
        p.actaon[2] = 1;
      }
    }

    if (key & C.KEY.JUMP) {
      // boost 触发偏移对齐：原 mjumptm===8 的命中偏移=2+DT 物理帧（30Hz=3.0/60Hz=2.5/
      // 120Hz=2.25，随帧率漂移导致 60/120Hz 提前 boost、跳得更高滞空更短）。阈值改
      // 7+DT 使三帧率都在偏移 3.0（原版 30Hz 基准）触发，此时 md 一律=-900>=-1000；
      // 触发后闭锁 mjumptm 防止 <= 比较重复命中（起跳时重设 10 自动解锁）
      if (p.mjumptm > 0 && p.mjumptm <= 7 + C._DT && p.md >= -1000) {
        p.md = -1300;
        if (p.mc >= 200 || p.mc <= -200) p.md = -1400;
        if (p.mc >= 600 || p.mc <= -600) p.md = -1500;
        p.mjumptm = -1000;
      }
      if (xx[0] === 0) p.actaon[1] = 10;
    }

    // 加速
    xx[0] = 40; xx[1] = 700; xx[8] = 500; xx[9] = 700;
    xx[12] = 1; xx[13] = 2;
    if (p.mrzimen === 1) { xx[0] = 20; xx[12] = 9; xx[13] = 10; }

    if (p.actaon[0] === -1) {
      if (!(p.mzimen === 0 && p.mc < -xx[8])) {
        if (p.mc >= -xx[9]) { p.mc -= xx[0] * C._DT; if (p.mc < -xx[9]) p.mc = -xx[9] - 1; }
        // 超速助推（main.cpp:1770）：超过700后每帧再 -xx[0]/10，配合800上限使稳态=800
        // 原版条件 atktm<=0 恒真（atktm 仅声明从未赋值），故省略
        if (p.mc < -xx[9]) p.mc -= xx[0] / 10 * C._DT;
      }
      if (p.mrzimen !== 1) {
        if (p.mc > 100 && p.mzimen === 0) p.mc -= xx[0] * 2 / 3 * C._DT;
        if (p.mc > 100 && p.mzimen === 1) { p.mc -= xx[0] * C._DT; p.mc -= xx[0] / 2 * C._DT; }
        p.actaon[0] = 3; p.mkasok += C._DT;
      }
    }
    if (p.actaon[0] === 1) {
      if (!(p.mzimen === 0 && p.mc > xx[8])) {
        if (p.mc <= xx[9]) { p.mc += xx[0] * C._DT; if (p.mc > xx[9]) p.mc = xx[9] + 1; }
        // 超速助推（main.cpp:1782）：超过700后每帧再 +xx[0]/10，配合800上限使稳态=800
        if (p.mc > xx[9]) p.mc += xx[0] / 10 * C._DT;
      }
      if (p.mrzimen !== 1) {
        if (p.mc < -100 && p.mzimen === 0) p.mc += xx[0] * 2 / 3 * C._DT;
        if (p.mc < -100 && p.mzimen === 1) { p.mc += xx[0] * C._DT; p.mc += xx[0] / 2 * C._DT; }
        p.actaon[0] = 3; p.mkasok += C._DT;
      }
    }
    if (p.actaon[0] === 0 && p.mkasok > 0) p.mkasok -= 2 * C._DT;
    if (p.mkasok > 8) p.mkasok = 8;
    if (p.mzimen !== 1) p.mrzimen = 0;

    // 跳跃
    if (p.mjumptm >= 0) p.mjumptm -= C._DT;
    if (p.actaon[1] === 1 && p.mzimen === 1) {
      p.mb -= 400; p.md = -1200; p.mjumptm = 10;
      A.playSE(C.SE.JUMP);
      p.mzimen = 0;
    }
    if (p.actaon[1] <= 9) p.actaon[1] = 0;

    if (p.mmutekitm >= -1) p.mmutekitm -= C._DT;

    // MHP 变化追踪（在死亡检查之前）
    if (p._prevMhp !== p.mhp) {
      _debugLog.push({ f: _debugFrame, key: key, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, mtm: p.mtm, before: true, mhpChange: true, mhp: p.mhp, prevMhp: p._prevMhp, reason: 'start-of-frame' });
      p._prevMhp = p.mhp;
    }
    // MTYPE 变化追踪
    if (p._prevMtype !== p.mtype) {
      _debugLog.push({ f: _debugFrame, key: key, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, mtm: p.mtm, before: true, mtypeChange: true, prevMtype: p._prevMtype });
      // 进入旗杆滑行 = 通关瞬间（旗杆 uid 由 elements.js stype300 onCollide 写入）
      if (p.mtype === C.MTYPE.GOAL_SLIDE) {
        pushEvent({ kind: 'goal', via: 'pole', f: _debugFrame, uid: state._goalTouchUid || null, ma: p.ma, mb: p.mb });
        state._goalTouchUid = null;
      }
      p._prevMtype = p.mtype;
    }

    // 死亡
    if (p.mhp <= 0 && p.mhp >= -9) {
      var hurtInfo = state._lastHurt || { reason: 'unknown', uid: null, detail: null };
      // 调试：死亡瞬间输出最后伤害来源（uid 对应编辑器中的元素实例，便于复现）
      console.warn('[catmario] 玩家死亡 f=' + _debugFrame +
        ' 来源=' + hurtInfo.reason + (hurtInfo.uid ? (' uid=' + hurtInfo.uid) : '（无实例uid）') +
        ' 坐标 ma=' + p.ma + ' mb=' + p.mb);
      _debugLog.push({ f: _debugFrame, key: 0, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, before: false, death: true, mhp: p.mhp, hurt: hurtInfo });
      state._lastHurt = null;
      state.life++;
      // 阵亡事件（试玩页"日志"面板展示：原因中文化，敌人碰撞额外标明敌人种类）
      var reasonCn = HURT_REASON_CN[hurtInfo.reason] || ('未知伤害（' + hurtInfo.reason + '）');
      if (hurtInfo.reason === 'enemy' && hurtInfo.detail) {
        var enemyName = ENEMY_NAME_CN[hurtInfo.detail.atype];
        if (enemyName) {
          reasonCn = '敌人碰撞：' + enemyName +
            (hurtInfo.detail.atype === 2 ? (hurtInfo.detail.axtype >= 1 ? '（龟壳滑动中）' : '（静止龟壳）') : '');
        }
      }
      pushEvent({
        kind: 'death', n: state.life, f: _debugFrame,
        reason: hurtInfo.reason, reasonCn: reasonCn,
        uid: hurtInfo.uid || null, ma: p.ma, mb: p.mb,
        // 敌人伤害：记录命中瞬间敌人位置（原版陷阱即时生成的敌人没有 uid，靠坐标溯源）
        ex: (hurtInfo.detail && hurtInfo.detail.aa !== undefined) ? hurtInfo.detail.aa : null,
        ey: (hurtInfo.detail && hurtInfo.detail.ab !== undefined) ? hurtInfo.detail.ab : null
      });
      p.mkeytm = 12; p.mhp = -20; p.mtype = C.MTYPE.DEAD; p.mtm = 0;
      // 终点/通关曲目走音效池，bgmStop 停不掉：阵亡时先切断再播死亡音效
      A.stopSe(C.SE.GOAL); A.stopSe(C.SE.SWORD_CLEAR); A.stopSe(C.SE.ALL_CLEAR);
      A.playSE(C.SE.DEATH); A.bgmStop();
    }
    if (p.mtype === C.MTYPE.DEAD) {
      if (p.mtm <= 11) { p.mc = 0; p.md = 0; }
      if (p.mtm === 12) p.md = -1200;
      if (p.mtm >= 12) p.mc = 0;
      if (p.mtm >= 100) {
        startGame();
        state.proc = C.PROC.STAGE_START; state.maintm = 0;
      }
    }

    // 进管道
    if (p.mtype >= 100) {
      p.mtm += C._DT;
      if (p.mtype === C.MTYPE.PIPE) {
        // 沉入方向由进管时记录的开口方向决定
        var pdir = p._pipeDir || 'up';
        var sinkDx = 0, sinkDy = 0;
        if (pdir === 'up')         sinkDy = 240;
        else if (pdir === 'down')  sinkDy = -240;
        else if (pdir === 'left')  sinkDx = 240;
        else if (pdir === 'right') sinkDx = -240;
        if (p.mxtype === 0) {
          p.mc = 0; p.md = 0;
          var tp = p._trapPipe;
          // 玩家沉入管道（mtm<=16）后移出屏幕（17）
          if (p.mtm <= 16) { p.ma += sinkDx * C._DT; p.mb += sinkDy * C._DT; p.mzz = 100; }
          if (p.mtm === 17) p.mb = -80000000;
          // 陷阱管道动画：玩家已离屏，此时驱动管道本体（对应原版 main.cpp 的 sa/sb[28]）
          // 参数由 PipeTypes.trapPipeAnimDefault() 提供，管道实例可用 trapAnim 覆盖
          if (tp) {
            var tpa = tp.trapAnim || PipeTypes.trapPipeAnimDefault();
            if (tpa.nudge && p.mtm === tpa.nudge.tm) tp.sa += tpa.nudge.dx;
            // 60Hz 下 mtm 按 _DT=0.5 递增，半整数帧会让 % 2 奇偶判定恒走 - 分支，
            // 导致抖动期间管道整体向左漂移。仅整数帧应用抖动，行为与原版 30Hz 一致。
            if (p.mtm % 1 === 0 && Array.isArray(tpa.shakes)) {
              for (var si = 0; si < tpa.shakes.length; si++) {
                var sh = tpa.shakes[si];
                if (p.mtm >= sh.from && p.mtm <= sh.to) tp.sa += (p.mtm % 2 === 0) ? sh.amp : -sh.amp;
              }
            }
            if (tpa.rise && p.mtm >= tpa.rise.tm) {
              tp.sb -= p.mzz * C._DT;
              p.mzz += (tpa.rise.accel != null ? tpa.rise.accel : 80) * C._DT;
              if (p.mzz > (tpa.rise.max != null ? tpa.rise.max : 1600)) p.mzz = tpa.rise.max;
            }
          }
          if (p.mtm === (tp && tp.trapAnim && tp.trapAnim.end != null ? tp.trapAnim.end : 160)) {
            markHurt('trap-pipe', p._trapPipe ? p._trapPipe.uid : null);
            sayPlayer(52, 30);   // 「死路一条」（旧 mxtype=5 为入管即死，新引擎陷阱管道统一在抬升终结时说）
            p._trapPipe = null; p.mtype = 0; p.mhp--;
            _debugLog.push({ f: _debugFrame, key: key, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, before: true, mhpDmg: true, reason: 'pipe-exit', uid: state._lastHurt ? state._lastHurt.uid : null });
          }
        } else if (p.mxtype === 10) {
          // 喷出管道（原版「ふっとばし」main.cpp:1904-1913）：沉入后沿管口开口方向
          // 反向喷出，喷出结束后受伤（mhp--，1血即死）。四方向泛化：
          //   横管（开口左/右）：mtm16 先向上弹出管口（原版 mb-=1100）、mtm24 起沿开口
          //   方向水平喷出（2000/物理帧）并转身背对管口；
          //   竖管（开口上/下）：mtm24 起沿开口方向垂直喷出。
          p.mc = 0; p.md = 0;
          // 沉入/喷出均按整数物理帧步进（mtm 先加后判断，与原版30Hz switch 逐点一致；
          // 60Hz 半整数帧不步进，保证跨刷新率在相同 mtm 检查点轨迹逐点一致）
          if (p.mtm % 1 === 0 && p.mtm <= 16) { p.ma += sinkDx; p.mb += sinkDy; }
          if (pdir === 'left' || pdir === 'right') {
            if (p.mtm === 16) p.mb -= 1100;
            if (p.mtm % 1 === 0 && p.mtm >= 24 && p.mtm < 48) {
              p.ma += (pdir === 'left' ? -2000 : 2000);
              p.mmuki = (pdir === 'left') ? 0 : 1;
            }
          } else {
            if (p.mtm % 1 === 0 && p.mtm >= 24 && p.mtm < 48) {
              p.mb += (pdir === 'up' ? -2000 : 2000);
            }
          }
          if (p.mtm === 20) A.playSE(C.SE.GHOST_SPRING);   // 原版 soundplay(10)
          if (p.mtm >= 48) {
            markHurt('pipe-eject', p._trapPipe ? p._trapPipe.uid : null);
            p._trapPipe = null; p.mtype = 0; p.mhp--;
          }
        } else {
          p.mc = 0; p.md = 0;
          if (p.mtm <= 16) { p.ma += sinkDx; p.mb += sinkDy; }
          // 旧引擎即死管（stype=50 sxtype=2/5 → mxtype=2/5，main.cpp:1918-1919）：
          // 沉入后 mtm==19 即死（mhp=0，无视残机）+ 台词气泡（51「这...!!」/ 52「死路一条」），不换关。
          // 1-2-1 地下的三根连续管（sxtype=5）即此陷阱
          if (p.mtm === 19 && (p.mxtype === 2 || p.mxtype === 5)) {
            sayPlayer(p.mxtype === 2 ? 51 : 52, 30);
            markHurt('trap-pipe-msg', p._trapPipe ? p._trapPipe.uid : null);
            p._trapPipe = null; p.mtype = 0; p.mhp = 0;
          }
          if (p.mtm === 20) {
            // 玩家已完全沉入管道并离屏：进行关卡切换
            p.mb = -80000000; p.mtype = 0; A.bgmStop();
            state.fx = 0;
            _camSnap = true;   // 进管传送：镜头归零，渲染吸附不做插值
            var warp = p._warp; p._warp = null;
            var proceed = true;
            if (warp) {
              // 传送管道口：交给宿主（试玩页）决定目标世界或游戏结束
              // onWarp 返回 false 表示宿主自行处理结局（如回标题），引擎不再重载关卡
              proceed = (typeof state.onWarp === 'function') ? state.onWarp(warp) !== false : false;
              if (warp.end) pushEvent({ kind: 'goal', via: 'warp', f: _debugFrame, uid: warp.uid || null, ma: p.ma, mb: p.mb });
              if (!proceed) state.warpSpawn = null;   // 结局/失败：宿主已自行处理，丢弃出生覆盖
            } else {
              state.stc++;   // 普通进管：进入下一子关
              state.warpSpawn = null;   // 非 warp 换关：传送出生覆盖仅对目标关有效
            }
            if (proceed) { state.checkpoint = null; startGame(); state.proc = C.PROC.STAGE_START; state.maintm = 0; }
          }
        }
      }
      if (p.mtype === C.MTYPE.GOAL_SLIDE) {
        p.mkeytm = 3;
        if (p.mtm <= 1) { p.mc = 0; p.md = 0; }
        if (p.mtm >= 2 && p.mtm <= 42) { p.md = 600; p.mmuki = 1; }
        if (p.mtm > 43 && p.mtm <= 108) p.mc = 300;
        if (p.mtm === 110) { p.mb = -80000000; p.mc = 0; }
        if (p.mtm === 250) {
          state.checkpoint = null;
          state.warpSpawn = null;   // 通关换关：传送出生覆盖不延续到下一大关
          var nl = state.nextLevel;
          if (nl && typeof state.onGoalNext === 'function') {
            var proceed = state.onGoalNext(nl) !== false;
            if (proceed) {
              if (!nl.end && !nl.id) { state.stb++; state.stc = 0; }
              startGame(); state.proc = C.PROC.STAGE_START; state.maintm = 0;
            }
          } else {
            state.stb++; state.stc = 0;
            startGame(); state.proc = C.PROC.STAGE_START; state.maintm = 0;
          }
        }
      }

      // 剑结局(301) / 通关触发结局(302) 演出序列（原版 main.cpp:1960-2012）
      if (p.mtype === C.MTYPE.ENDING || p.mtype === C.MTYPE.ENDING2) {
        p.mkeytm = 3;
        var isSword = (p.mtype === C.MTYPE.ENDING);
        if (p.mtm <= 1) { p.mc = 0; p.md = 0; }
        // 玩家自动向右奔跑，镜头由 updateCamera() 正常向右跟随；
        // 原版 ma-=500/fx+=500 的强制左拉会让玩家滑向屏幕左侧，此处按需求改为向右推进。
        // 演出中不做无敌保护：坠落、敌人、尖刺等均可正常造成死亡（与原版 main.cpp:2074/3582 一致）。
        if (p.mtm >= 2 && p.mtm <= 130) { p.mc = 250; p.mmuki = 1; }
        // mtm==200：播全通关音效、登记通关、剑结局额外生成"恭喜通关/感谢游玩"文本
        if (p.mtm === 200) {
          A.playSE(C.SE.ALL_CLEAR);
          if (isSword) {
            // 原版 na/nb/ntype=101(IDS_2 恭喜通关)、102(IDS_3 感谢游玩)
            // 文本锚定在玩家当前世界坐标，随镜头左移逐渐移出屏幕左侧
            state.bg.push({ na: p.ma, nb: 4 * 29 * 100, ntype: 101, uid: null, _endingText: true });
            state.bg.push({ na: p.ma, nb: 6 * 29 * 100, ntype: 102, uid: null, _endingText: true });
          }
        }
        // mtm==440：剑结局→进入制作名单(staff roll)；通关触发→进入下一大关
        if (p.mtm === 440) {
          if (isSword) {
            state.ending = 1;   // frame() 中据此切换 proc=ENDING
          } else {
            state.checkpoint = null;
            state.warpSpawn = null;   // 通关换关：传送出生覆盖不延续到下一大关
            var nl2 = state.nextLevel;
            if (nl2 && typeof state.onGoalNext === 'function') {
              var proceed2 = state.onGoalNext(nl2) !== false;
              if (proceed2) {
                if (!nl2.end && !nl2.id) { state.sta++; state.stb = 1; state.stc = 0; }
                startGame(); state.proc = C.PROC.STAGE_START; state.maintm = 0;
              }
            } else {
              state.sta++; state.stb = 1; state.stc = 0;
              startGame(); state.proc = C.PROC.STAGE_START; state.maintm = 0;
            }
          }
        }
      }
    }

    // 音符块弹跳上升+传送（原版 main.cpp:1861-1869）：mtype=2 期间每帧重置 md=-1500 匀速上升、
    // 锁输入，冲出屏幕顶（mb<=-6000）后切换关卡。目标由弹跳的音符块实例 warp 属性决定
    // （编辑器「传送目标」：游戏结束/我的场景/原版关卡）；无 warp 时走原版默认 stc+=5
    // 切换到上空子关（如 1-3 地上(0)→空中区(5)）
    if (p.mtype === C.MTYPE.NOTE) {
      p.mtm += C._DT;
      p.mkeytm = 2;
      p.md = -1500;
      if (p.mb <= -6000) {
        p.mtype = 0; p.mtm = 0; p.mkeytm = 0;
        p.mb = -80000000;
        A.bgmStop();
        state.checkpoint = null;
        var noteWarp = p._noteWarp; p._noteWarp = null;
        var noteWarpUid = p._noteWarpUid; p._noteWarpUid = null;
        var noteProceed = true;
        if (noteWarp && (noteWarp.end || noteWarp.id) && typeof state.onWarp === 'function') {
          // 与传送管道口同一宿主钩子：onWarp 返回 false 表示宿主自行处理（如回标题），引擎不重载。
          // via='note' 供宿主区分触发来源（音符块 vs 传送管道），仅作文案用途；
          // spawnMode/spawnCol/spawnRow 为目标关出生位置覆盖（宿主据此调 setWarpSpawn）
          var _noteWarpArg = { end: !!noteWarp.end, id: noteWarp.id || null, via: 'note' };
          if (noteWarp.spawnMode === 'once' || noteWarp.spawnMode === 'forever') {
            _noteWarpArg.spawnMode = noteWarp.spawnMode;
            _noteWarpArg.spawnCol = noteWarp.spawnCol | 0;
            _noteWarpArg.spawnRow = noteWarp.spawnRow | 0;
          }
          noteProceed = state.onWarp(_noteWarpArg) !== false;
          if (noteWarp.end) pushEvent({ kind: 'goal', via: 'note', f: _debugFrame, uid: noteWarpUid, ma: p.ma, mb: p.mb });
          if (!noteProceed) state.warpSpawn = null;   // 结局/失败：丢弃出生覆盖
        } else {
          state.stc += 5;   // 原版 stc+=5：如 1-3 地上(0)→空中区(5)
          state.warpSpawn = null;   // 无显式 warp 的音符块：按普通换关处理
        }
        if (noteProceed) {
          startGame();
          state.proc = C.PROC.STAGE_START; state.maintm = 0;
        }
      }
    }
    // 跳台弹飞（原版 main.cpp:1872-1875）：匀速上升，冲出屏幕顶即死亡
    if (p.mtype === C.MTYPE.JUMP_PAD) {
      p.md = -2400;
      if (p.mb <= -6000) { p.mb = -80000000; markHurt('jump-pad', null); p.mhp = 0; }
    }

    // 移动
    // 锁键计时：60Hz(_DT=0.5) 下偶数初值(如抛投的 24)按 >=1 递减会卡在 0.5 永不解锁，
    // 导致抛出后玩家永久无法移动；改为 >0 递减并夹到 0（30Hz 整数行为不变）
    if (p.mkeytm > 0) {
      p.mkeytm -= C._DT;
      if (p.mkeytm < 0) p.mkeytm = 0;
    }
    p.ma += p.mc * C._DT; p.mb += p.md * C._DT;
    if (p.mc < 0) p.mactp += -p.mc * C._DT;
    else p.mactp += p.mc * C._DT;
    if ((p.mtype <= 9 && p.mtype !== C.MTYPE.NOTE && p.mtype !== C.MTYPE.JUMP_PAD) ||
        p.mtype === C.MTYPE.DEAD || p.mtype === C.MTYPE.GOAL_SLIDE ||
        p.mtype === C.MTYPE.ENDING || p.mtype === C.MTYPE.ENDING2) {
      // 帧率一致性补偿：匀加速下显式欧拉（先位移后加重力）的位移误差 = -g·T·DT/2，
      // 30Hz(DT=1) 为原版手感基准（误差率最大），非 30Hz 补回 g·DT·(1-DT)/2，
      // 使跳跃/坠落轨迹与 30Hz 逐帧一致（DT=1 时补偿=0，30Hz 行为分毫不变）
      // 注：mtype=2/3（音符弹升/跳台弹飞）每帧强制重置 md，重力增量下帧即被丢弃，
      // 与原版 main.cpp:2021/2025 顺序一致——无匀加速误差，不参与补偿
      p.mb -= C.GRAVITY * C._DT * (1 - C._DT) / 2;
      p.md += C.GRAVITY * C._DT;
    }

    // 速度上限
    if (p.mtype === 0) {
      xx[0] = 800; xx[1] = 1600;
      if (p.mc > xx[0] && p.mc < xx[0] + 200) p.mc = xx[0];
      if (p.mc > xx[0] + 200) p.mc -= 200 * C._DT;
      if (p.mc < -xx[0] && p.mc > -xx[0] - 200) p.mc = -xx[0];
      if (p.mc < -xx[0] - 200) p.mc += 200 * C._DT;
      if (p.md > xx[1]) p.md = xx[1];
    }

    // 地面摩擦
    if (p.mzimen === 1 && p.actaon[0] !== 3) {
      if (p.mtype <= 9 || p.mtype === C.MTYPE.ENDING || p.mtype === C.MTYPE.ENDING2) {
        if (p.mrzimen === 0) {
          xx[2] = 30; xx[1] = 60; xx[3] = 30;
          if (p.mc >= -xx[3] && p.mc <= xx[3]) p.mc = 0;
          if (p.mc >= xx[2]) p.mc -= xx[1] * C._DT;
          if (p.mc <= -xx[2]) p.mc += xx[1] * C._DT;
        }
      }
    }

    p.mzimen = 0;
    // 边界（世界坐标）
    if (p.mtype <= 9 && p.mhp >= 1) {
      if (p.ma < 100) { p.ma = 100; p.mc = 0; }
      if (p.ma + p.mnobia > state.scrollx + C.FXMAX) { p.ma = state.scrollx + C.FXMAX - p.mnobia; p.mc = 0; }
    }
    if (p.mb >= 52000 && p.mhp >= 0) {
      markHurt('out-of-world', null);
      // 旧 main.cpp:2073：城堡关(stagecolor==4) y>=38000 即岩浆，台词「烫死了……」；
      // 新引擎统一在 52000 击杀面判定，城堡主题沿用岩浆台词
      if (state.stagecolor === 4) sayPlayer(55, 30);
      p.mhp = -2;
    }

    // 行走动画
    if (p.mactp >= 2000) { p.mactp -= 2000; p.mact = p.mact === 0 ? 1 : 0; }
  }

  // ==================== 玩家与方块碰撞 ====================
  var _debugCollideTop = 0, _debugCollideCount = 0;
  function collideBlocks() {
    var p = state.player;
    xx[15] = 0;
    _debugCollideCount++;
    for (var i = 0; i < state.blocks.length; i++) {
      var b = state.blocks[i];
      if (b.ta < -800000) continue;
      xx[0] = 200; xx[1] = 3000; xx[2] = 1000; xx[3] = 3000;
      xx[8] = b.ta; xx[9] = b.tb;
      if (b.ta - state.fx + xx[1] < -10 || b.ta - state.fx > C.FXMAX + 12000) continue;

      if (p.mtype !== C.MTYPE.DEAD && p.mtype !== 1) {
        if (b.ttype < 1000 && b.ttype !== 800 && b.ttype !== 140) {
          // 原版行 2092：每块碰撞开始前重置标志，避免上一块的 xx[17] 泄漏
          xx[16] = 0; xx[17] = 0;
          // 上方碰撞（站上去）
          if (b.ttype !== 7 && b.ttype !== 110 && b.ttype !== 114) {
            if (p.ma + p.mnobia > xx[8] + xx[0] * 2 + 100 && p.ma < xx[8] + xx[1] - xx[0] * 2 - 100 &&
                p.mb + p.mnobib > xx[9] && p.mb + p.mnobib < xx[9] + xx[1] && p.md >= -100) {
              // 特殊行为块（115 易碎砖/400 P开关/117 音符块/120 弹簧台）不参与普通站立，
              // 由 BlockTypes 注册表驱动；bhv 属性可覆盖默认参数
              var bhvStand = BlockTypes.resolve(b);
              var isSpecial = bhvStand && (bhvStand.standBreak || bhvStand.pswitch || bhvStand.bounceMd != null);
              if (!isSpecial) {
                _debugCollideTop++;
                p.mb = xx[9] - p.mnobib + 100; p.md = 0; p.mzimen = 1; xx[16] = 1;
              } else if (bhvStand.standBreak) {
                var bc = bhvStand.breakCfg || {};
                if (bc.sound != null && bc.sound >= 0) A.playSE(bc.sound);
                var parts = bc.parts != null ? bc.parts : 2;
                var vx = bc.vx != null ? bc.vx : 300;
                var vy = bc.vy != null ? bc.vy : -1000;
                var grav = bc.grav != null ? bc.grav : 160;
                var bw = bc.w != null ? bc.w : 1000;
                var bh = bc.h != null ? bc.h : 1000;
                var bl = bc.life != null ? bc.life : 120;
                if (parts >= 2) {
                  spawnParticle(b.ta + 1200, b.tb + 1200, vx, vy, 0, grav, bw, bh, 1, bl);
                  spawnParticle(b.ta + 1200, b.tb + 1200, -vx, vy, 0, grav, bw, bh, 1, bl);
                }
                if (parts >= 4) {
                  spawnParticle(b.ta + 1200, b.tb + 1200, vx * 0.8, vy * 0.7, 0, grav, bw, bh, 1, bl);
                  spawnParticle(b.ta + 1200, b.tb + 1200, -vx * 0.8, vy * 0.7, 0, grav, bw, bh, 1, bl);
                }
                b.ta = -800000;
              } else if (bhvStand.pswitch) {
                p.md = 0; b.ta = -8000000; A.playSE(bhvStand.sound != null ? bhvStand.sound : 13);
                var tgt = bhvStand.targetType != null ? bhvStand.targetType : 800;
                state.blocks.forEach(function (bb) { if (bb.ttype !== 7) bb.ttype = tgt; });
                A.bgmStop();
              } else if (bhvStand.bounceMd != null) {
                if (bhvStand.bounceSound != null) A.playSE(bhvStand.bounceSound);
                if (b.ttype === 117 && b.txtype >= 2) {
                  // 原版 main.cpp:2122：txtype>=2 音符块=白色普通大跳（不进入上升/传送状态），显形为白色
                  p.mtype = 0; p.md = -1600; b.txtype = 3; p.mtm = 0;
                  p._noteWarp = null; p._noteWarpUid = null;
                } else {
                  // 原版 main.cpp:2121：弹起（mtype=2 音符上升+传送 / mtype=3 跳台弹飞）
                  p.md = bhvStand.bounceMd; p.mtype = bhvStand.mtype != null ? bhvStand.mtype : C.MTYPE.NOTE; p.mtm = 0;
                  // 桃色音符块：记住本块的传送目标，冲顶（mb<=-6000）时交给 onWarp 宿主处理；
                  // 无 warp 字段则走原版默认 stc+=5（上空子关）
                  if (p.mtype === C.MTYPE.NOTE) {
                    p._noteWarp = copyWarp(b.warp);
                    p._noteWarpUid = b.uid || null;
                  }
                  // 原版 main.cpp:2123：txtype 0→1，隐形音符块触碰后显形为桃色
                  if (b.ttype === 117 && b.txtype === 0) b.txtype = 1;
                }
              }
            }
          }

          // 下方碰撞（顶方块）
          xx[21] = 0; xx[22] = 1;
          if (p.mzimen === 1 || p.mjumptm >= 10) { xx[21] = 3; xx[22] = 0; }
          for (var t3 = 0; t3 <= 1; t3++) {
            if (t3 === xx[21] && p.mtype !== 100 && b.ttype !== 117) {
              if (p.ma + p.mnobia > xx[8] + xx[0] * 2 + 800 && p.ma < xx[8] + xx[1] - xx[0] * 2 - 800 &&
                  p.mb > xx[9] - xx[0] * 2 && p.mb < xx[9] + xx[1] - xx[0] * 2 && p.md <= 0) {
                xx[16] = 1; xx[17] = 1;
                p.mb = xx[9] + xx[1] + xx[0];
                if (p.md < 0) p.md = -p.md * 2 / 3;
                // 顶方块行为：由 BlockTypes 注册表驱动（bhv 属性可覆盖默认参数）
                var bhvButt = BlockTypes.resolve(b);
                // 作弊模式：无视方块类型顶到即碎；唯独隐藏块（ttype=7/114，以及无 showQ
                // 的隐藏量产块 110）第一下走原行为（弹金币/出道具/启动量产），第二下才碎。
                // 第一下后块会变形（→3/115/111/113），用块实例标志跨类型记住"已顶过一次"。
                var cheatHiddenFirst = false;
                if (state.cheat) {
                  var isHiddenNow = b.ttype === 7 || b.ttype === 114 || (b.ttype === 110 && !b.showQ);
                  if (isHiddenNow && !b._cheatBumpOnce) { cheatHiddenFirst = true; b._cheatBumpOnce = 1; }
                }
                var cheatWillBreak = state.cheat && !cheatHiddenFirst;
                if ((cheatWillBreak || (!state.cheat && bhvButt && bhvButt.buttBreak)) && p.mzimen === 0) {
                  var bc2 = (bhvButt && bhvButt.breakCfg) || {};
                  // 作弊顶碎无 breakCfg 的方块时缺省播放碎砖音效（SE 3）
                  A.playSE(bc2.sound != null ? bc2.sound : 3);
                  var parts2 = bc2.parts != null ? bc2.parts : 2;
                  var vx2 = bc2.vx != null ? bc2.vx : 300;
                  var vy2 = bc2.vy != null ? bc2.vy : -1000;
                  var grav2 = bc2.grav != null ? bc2.grav : 160;
                  var bw2 = bc2.w != null ? bc2.w : 1000;
                  var bh2 = bc2.h != null ? bc2.h : 1000;
                  var bl2 = bc2.life != null ? bc2.life : 120;
                  if (parts2 >= 2) {
                    spawnParticle(b.ta + 1200, b.tb + 1200, vx2, vy2, 0, grav2, bw2, bh2, 1, bl2);
                    spawnParticle(b.ta + 1200, b.tb + 1200, -vx2, vy2, 0, grav2, bw2, bh2, 1, bl2);
                  }
                  if (parts2 >= 4) {
                    spawnParticle(b.ta + 1200, b.tb + 1200, vx2 * 0.8, vy2 * 0.7, 0, grav2, bw2, bh2, 1, bl2);
                    spawnParticle(b.ta + 1200, b.tb + 1200, -vx2 * 0.8, vy2 * 0.7, 0, grav2, bw2, bh2, 1, bl2);
                  }
                  b.ta = -800000;
                  // 作弊顶碎后屏蔽本块后续顶击触发（金币/道具/隐藏块/提示块等原行为不再执行）
                  if (cheatWillBreak) xx[17] = 0;
                }
                // 隐藏块作弊第一下：保留金币弹出等原顶击行为（xx[17]=1 仍驱动 ttype=110/114 专项处理）
                if ((!state.cheat || cheatHiddenFirst) && bhvButt && bhvButt.buttCoin && (!bhvButt.coinNoStand || p.mzimen === 0)) {
                  var cc = bhvButt.coinCfg || {};
                  if (cc.sound != null && cc.sound >= 0) A.playSE(cc.sound);
                  spawnParticle(b.ta + 10, b.tb, cc.vx != null ? cc.vx : 0, cc.vy != null ? cc.vy : -800, 0, cc.grav != null ? cc.grav : 40, cc.w != null ? cc.w : 3000, cc.h != null ? cc.h : 3000, 0, cc.life != null ? cc.life : 16);
                  b.ttype = bhvButt.usedType != null ? bhvButt.usedType : 3;
                }
                if (!state.cheat && bhvButt && bhvButt.damage > 0) {
                  // 原版 main.cpp:2170 顶到尖刺块(ttype10)：「被刺死了!!」
                  sayPlayer(bhvButt.msgType != null ? bhvButt.msgType : 3,
                            bhvButt.msgTm != null ? bhvButt.msgTm : 30);
                  markHurt('spike', b.uid);
                  p.mhp -= bhvButt.damage;
                  _debugLog.push({ f: _debugFrame, key: _debugKey, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, before: true, mhpDmg: true, reason: 'ttype10', uid: b.uid, ta: b.ta, tb: b.tb });
                }
              }
            }
            // 左右碰撞
            if (t3 === xx[22] && xx[15] === 0) {
              // 原版行 2182：ttype=114 隐藏毒蘑菇块不参与左右碰撞（隐形，只能从下方顶到）
              if (b.ttype !== 7 && b.ttype !== 110 && b.ttype !== 117 && b.ttype !== 114) {
                if (b.ta >= -20000) {
                  if (p.ma + p.mnobia > xx[8] && p.ma < xx[8] + xx[2] &&
                      p.mb + p.mnobib > xx[9] + xx[1] / 2 - xx[0] && p.mb < xx[9] + xx[2] && p.mc >= 0) {
                    p.ma = xx[8] - p.mnobia; p.mc = 0; xx[16] = 1;
                  }
                  if (p.ma + p.mnobia > xx[8] + xx[2] && p.ma < xx[8] + xx[1] &&
                      p.mb + p.mnobib > xx[9] + xx[1] / 2 - xx[0] && p.mb < xx[9] + xx[2] && p.mc <= 0) {
                    p.ma = xx[8] + xx[1]; p.mc = 0; xx[16] = 1;
                  }
                }
              }
            }
          }

          // 特殊方块交互 — 跳跃跟随（解耦属性 b.followJump，任意方块可配置；loadStage 对
          // 原版 ttype=100/xt=0（1-1 b0 逃跑问号砖）自动迁移，原版行为不变）
          // 原版行 2224-2227：mb 在 tb 附近且 md<=0 时，tb 跟随 mb 移动
          // 公式 tb[t] = mb - 1200 - xx[1]（fy 在原版恒为 0）
          // 条件：玩家在方块下方附近（mb 在 tb-600 到 tb+4600 之间）+ 水平对齐 + 上升/静止
          if (b.followJump &&
              p.mb > xx[9] - 600 && p.mb < xx[9] + 4600 &&
              p.ma + p.mnobia > xx[8] - 400 && p.ma < xx[8] + xx[1] && 
              p.md < 600) {
            b.tb = p.mb - 1200 - xx[1];
          }

          // 特殊方块交互 — 碰撞触发（玩家顶到方块底部）
          if (b.ttype === 100 && xx[17] === 1) {
            if (b.txtype === 0 || b.txtype === 2) {
              A.playSE(C.SE.COIN);
              spawnParticle(b.ta + 10, b.tb, 0, -800, 0, 40, 3000, 3000, 0, 16);
              b.ttype = 3;
            }
          }
          if (b.ttype === 101 && xx[17] === 1) {
            A.playSE(8); b.ttype = 3;
            var e101;
            if (b.txtype === 0) e101 = spawnEnemy(b.ta, b.tb, 0, 0, 0, 0, 0);
            else if (b.txtype === 1) e101 = spawnEnemy(b.ta, b.tb, 0, 0, 0, 4, 0);
            else if (b.txtype === 3 || b.txtype === 10) e101 = spawnEnemy(b.ta, b.tb, 0, 0, 0, 101, 0);
            else if (b.txtype === 4) { e101 = spawnEnemy(b.ta - 400, b.tb - 1600, 0, 0, 0, 6, 0); e101.abrocktm = 20; }
            if (e101) { if (b.txtype !== 4) e101.abrocktm = 16; if (b.uid) e101.uid = b.uid + '#item'; }
          }
          if (b.ttype === 102 && xx[17] === 1) {
            A.playSE(8); b.ttype = 3;
            var e102;
            if (b.txtype === 0) e102 = spawnEnemy(b.ta, b.tb, 0, 0, 0, 100, 0);
            else if (b.txtype === 2) e102 = spawnEnemy(b.ta, b.tb, 0, 0, 0, 100, 2);
            else if (b.txtype === 3) e102 = spawnEnemy(b.ta, b.tb, 0, 0, 0, 102, 1);
            if (e102) { e102.abrocktm = 16; if (b.uid) e102.uid = b.uid + '#item'; }
          }
          if (b.ttype === 103 && xx[17] === 1) {
            A.playSE(8); b.ttype = 3;
            var e103 = spawnEnemy(b.ta, b.tb, 0, 0, 0, 100, 1);
            e103.abrocktm = 16; if (b.uid) e103.uid = b.uid + '#item';
          }
          if (b.ttype === 104 && xx[17] === 1) {
            A.playSE(8); b.ttype = 3;
            var e104 = spawnEnemy(b.ta, b.tb, 0, 0, 0, 110, 0);
            e104.abrocktm = 16; if (b.uid) e104.uid = b.uid + '#item';
          }
          if (b.ttype === 105 && xx[17] === 1) {
            // 问号块出P开关（与旧引擎 ttype=116 同语义，main.cpp:2354-2361）：
            // 自身变已用块(3)，P开关块(400)生成在上方1格，站上去触发全体方块变金币
            A.playSE(8); b.ttype = 3;
            state.blocks.push({ ta: b.ta, tb: b.tb - 2900, ttype: 400, txtype: 0, thp: 0, titem: 0, uid: b.uid ? b.uid + '#pswitch' : null });
          }
          if (b.ttype === 110 && xx[17] === 1) { b.ttype = 111; b.thp = 999; }
          if (b.ttype === 111 && b.ta - state.fx >= 0) {
            b.thp += C._DT;
            if (b.thp >= 16) {
              b.thp = 0; A.playSE(8);
              // 量产对象由 txtype 选择（编辑器统一问号块）：
              //   0=紫毒蘑菇(原版默认) 1=白猫怪 2=红蘑菇 3=火焰花 4=坏星
              var massMap = { 1: [0, 0], 2: [100, 0], 3: [101, 0], 4: [110, 0] };
              var msp = massMap[b.txtype] || [102, 1];
              var e111 = spawnEnemy(b.ta, b.tb, 0, 0, 0, msp[0], msp[1]);
              e111.abrocktm = 16; if (b.uid) e111.uid = b.uid + '#item';
            }
          }
          if (b.ttype === 112 && xx[17] === 1) { b.ttype = 113; b.thp = 999; b.titem = 0; }
          if (b.ttype === 113 && b.ta - state.fx >= 0) {
            if (b.titem <= 19) b.thp += C._DT;
            if (b.thp >= 3) { b.thp = 0; b.titem++; A.playSE(C.SE.COIN); spawnParticle(b.ta + 10, b.tb, 0, -800, 0, 40, 3000, 3000, 0, 16); }
          }
          // 隐藏块（ttype=114，原版行 2323-2344）：平时隐形且不碰撞，仅从下方顶到时触发
          // 编辑器统一隐藏块的 txtype 语义（弹出对象与问号块取并集）：
          //   单发：0=紫毒蘑菇(变3) 2=金币(变115脆弱块) 4=红蘑菇 6=白猫怪 8=火焰花 10=P开关(变400) 11=坏星
          //   量产：12=金币(变113连出20枚) 20=毒蘑菇 22=红蘑菇 26=白猫怪 28=火焰花 30=坏星（变111循环）
          if (b.ttype === 114 && xx[17] === 1) {
            if (b.txtype === 0) {
              A.playSE(8); b.ttype = 3;
              var e114 = spawnEnemy(b.ta, b.tb, 0, 0, 0, 102, 1);
              if (e114) { e114.abrocktm = 16; if (b.uid) e114.uid = b.uid + '#item'; }
            } else if (b.txtype === 2) {
              A.playSE(C.SE.COIN); spawnParticle(b.ta + 10, b.tb, 0, -800, 0, 40, 3000, 3000, 0, 16);
              b.ttype = 115; b.txtype = 0;
            } else if (b.txtype === 12) {
              // 金币量产：与 112→113 相同，立即出1枚后每3帧1枚共20枚
              b.ttype = 113; b.thp = 999; b.titem = 0;
            } else if (b.txtype === 20 || b.txtype === 22 || b.txtype === 26 || b.txtype === 28 || b.txtype === 30) {
              // 量产：与 110→111 相同，立即出1个后每16帧1个持续弹出
              // txtype 重映射到 111 量产循环的对象键（0毒 1白猫怪 2红蘑菇 3火焰花 4坏星）
              b.ttype = 111; b.thp = 999;
              b.txtype = { 20: 0, 22: 2, 26: 1, 28: 3, 30: 4 }[b.txtype];
            } else if (b.txtype === 4 || b.txtype === 6 || b.txtype === 8 || b.txtype === 11) {
              // 单发道具：4=红蘑菇 6=白猫怪 8=火焰花 11=坏星 → 生成后变已用块(3)
              var hm114 = { 4: [100, 0], 6: [0, 0], 8: [101, 0], 11: [110, 0] }[b.txtype];
              A.playSE(8); b.ttype = 3;
              var hx114 = spawnEnemy(b.ta, b.tb, 0, 0, 0, hm114[0], hm114[1]);
              if (hx114) { hx114.abrocktm = 16; if (b.uid) hx114.uid = b.uid + '#item'; }
            } else if (b.txtype === 10) {
              // P开关：原地变成P开关块（站上去触发全体方块变金币）
              A.playSE(8); b.ttype = 400;
            }
          }
          // 提示块（ttype=300）：玩家从下方顶到时弹出消息框
          if (b.ttype === 300 && xx[17] === 1) {
            A.playSE(15);
            var tx = b.txtype || 0;
            if (tx <= 100) {
              state.tmsgtype = 1; state.tmsgtm = 15;
              state.tmsgy = 300 + (tx - 1); state.tmsg = tx;
            }
            if (tx === 540) {
              state.tmsgtype = 1; state.tmsgtm = 15;
              state.tmsgy = 400; state.tmsg = 100; b.txtype = 541;
            }
          }
          // 提示块自动消失（txtype>=500 时逐帧上移直到出屏）
          if (b.ttype === 300 && b.txtype >= 500 && b.ta >= -6000) {
            if (b.txtype <= 539) b.txtype += C._DT;
            if (b.txtype >= 540) b.ta -= 500 * C._DT;
          }
        }

        // 金币
        if (b.ttype === 800) {
          if (p.mb > xx[9] - xx[0] * 2 - 2000 && p.mb < xx[9] + xx[1] - xx[0] * 2 + 2000 &&
              p.ma + p.mnobia > xx[8] - 400 && p.ma < xx[8] + xx[1]) {
            b.ta = -800000; A.playSE(C.SE.COIN);
          }
        }

        // 剣とってクリア（剑结局）：拾取剑方块 → 进入 mtype=301 剑结局演出
        if (b.ttype === C.TTYPE.SWORD) {
          if (p.mb > xx[9] - xx[0] * 2 - 2000 && p.mb < xx[9] + xx[1] - xx[0] * 2 + 2000 &&
              p.ma + p.mnobia > xx[8] - 400 && p.ma < xx[8] + xx[1]) {
            b.ta = -800000;
            // 激活灰色升降台（srsp=21）作为结局载台（原版 sracttype[20]=1; sron[20]=1）
            state.lifts.forEach(function (lf) {
              if (lf.srsp === C.SRSP.GRAY) { lf.sracttype = 1; lf.sron = 1; }
            });
            A.bgmStop();
            p.mtype = C.MTYPE.ENDING; p.mtm = 0;
            A.playSE(C.SE.SWORD_CLEAR);
            pushEvent({ kind: 'goal', via: 'sword', f: _debugFrame, uid: b.uid || null, ma: p.ma, mb: p.mb });
          }
        }
      }
      // ONOFF 开关
      if (b.ttype === 130 && state.stageonoff === 0) b.ttype = 131;
      if (b.ttype === 131 && state.stageonoff === 1) b.ttype = 130;
    }
  }

  // ==================== 玩家与管道/墙体碰撞 ====================
  function collidePipes() {
    var p = state.player;
    for (var i = 0; i < state.pipes.length; i++) {
      var s = state.pipes[i];
      if (s.sa < -8000000) continue;
      xx[0] = 200; xx[1] = 2400; xx[2] = 1000; xx[7] = 0;
      xx[8] = s.sa; xx[9] = s.sb;
      if (s.sa - state.fx + s.sc < -12000 || s.sa - state.fx > C.FXMAX) continue;

      // 每帧驱动（不依赖玩家 AABB）：stype=180 喷火管周期喷射（原版 main.cpp:2671-2677 位置）
      var ptTick = PT.get(s.stype);
      if (ptTick && ptTick.tick) ptTick.tick(p, s, xx, state, A, spawnEnemy);

      // 通过注册表查询该类型的实体性
      // 剑结局/通关演出(301/302)期间保留与正常游玩完全一致的墙体/管道阻挡，
      // 不沿用旧引擎 main.cpp:2469 的 mtype<10 门槛（按需求演出中不得穿墙穿管道）。
      // 管道进入 onEnter 内部要求 mtype===0，演出中自动不会触发。
      if (PT.isSolid(s.stype) &&
          (p.mtype < 10 || p.mtype === C.MTYPE.ENDING || p.mtype === C.MTYPE.ENDING2)) {
        // 自定义物理钩子（stype 51/52 坠落砖组）：必须在常规碰撞前执行；
        // 返回 true = 本帧运动中，跳过常规实体碰撞（对应原版 xx[7]=1）
        var ptPhys = PT.get(s.stype);
        if (ptPhys && ptPhys.physics && ptPhys.physics(p, s, xx, state, A)) xx[7] = 1;
        // 通常地面碰撞
        if (xx[7] === 0) {
          if (p.ma + p.mnobia > xx[8] + xx[0] && p.ma < xx[8] + s.sc - xx[0] &&
              p.mb + p.mnobib > xx[9] && p.mb + p.mnobib < xx[9] + xx[1] && p.md >= -100) {
            p.mb = s.sb - p.mnobib + 100; p.md = 0; p.mzimen = 1;
          }
          if (p.ma + p.mnobia > xx[8] - xx[0] && p.ma < xx[8] + xx[2] &&
              p.mb + p.mnobib > xx[9] + xx[1] * 3 / 4 && p.mb < xx[9] + s.sd - xx[2]) {
            p.ma = xx[8] - xx[0] - p.mnobia; p.mc = 0;
          }
          if (p.ma + p.mnobia > xx[8] + s.sc - xx[0] && p.ma < xx[8] + s.sc + xx[0] &&
              p.mb + p.mnobib > xx[9] + xx[1] * 3 / 4 && p.mb < xx[9] + s.sd - xx[2]) {
            p.ma = xx[8] + s.sc + xx[0]; p.mc = 0;
          }
          if (p.ma + p.mnobia > xx[8] + xx[0] * 2 && p.ma < xx[8] + s.sc - xx[0] * 2 &&
              p.mb > xx[9] + s.sd - xx[1] && p.mb < xx[9] + s.sd + xx[0]) {
            p.mb = xx[9] + s.sd + xx[0];
            if (p.md < 0) p.md = -p.md * 2 / 3;
          }
        }

        // 可进入管道（通过 onEnter 回调）
        var ptype = PT.get(s.stype);
        if (ptype && ptype.onEnter) {
          if (ptype.onEnter(p, s, xx, state)) {
            A.playSE(C.SE.PIPE);
          }
        }
      }

      // 非实体类型的碰撞回调（陷阱、终点杆、中间旗等）
      // 原版逻辑：stype > 99 且 != 200 的全部使用统一的 AABB 碰撞检测
      if (!PT.isSolid(s.stype)) {
        var ptype2 = PT.get(s.stype);
        if (ptype2 && ptype2.onCollide) {
          // 原版统一 AABB 碰撞检测（覆盖所有非实体类型：100-299 陷阱 + 300 终点 + 500 中间旗）
          if (p.ma + p.mnobia > xx[8] + xx[0] && p.ma < xx[8] + s.sc - xx[0] &&
              p.mb + p.mnobib > xx[9] && p.mb < xx[9] + s.sd + xx[0]) {
            ptype2.onCollide(p, s, xx, state, A, spawnEnemy);
          }
        }
      }
    }
  }

  // ==================== 升降台（含 srsp=10~14 悬挂站台） ====================
  // 对应原版 main.cpp:2698-2871 的 リフト 循环。玩家 ma/mb 为世界坐标，
  // 故站立判定直接与 sra/srb 比较（原版是屏坐标 sra-fx）。
  function collideLifts() {
    var p = state.player;
    for (var i = 0; i < state.lifts.length; i++) {
      var l = state.lifts[i];
      if (l.sra < -8000000) continue;
      // 水平剔除（含原版 12000 宽边距）
      if (l.sra - state.fx + l.src < -12010 || l.sra - state.fx > C.FXMAX + 12100) continue;

      // 运动积分：保存旧台底/旧速度后再移动。玩家站立判定与吸附基于「旧台底」，
      // 随动用「旧 sre」（台本帧实际位移）→ 脚=新台底+100，始终紧贴台面不嵌入。
      var oldSrb = l.srb;
      var oldSre = l.sre;
      l.srb += l.sre * C._DT;
      l.sre += l.srf * C._DT;
      l._oldSrb = oldSrb;   // 供敌人 enemyGroundCollide 随动使用
      l._oldSre = oldSre;

      // 行为解析：srsp 默认 + 实例 bhv（合并升降台 srsp=0，行为全由 bhv 给出）
      var lb = LiftTypes.resolve(l);

      switch (l.sracttype) {
        case 1: if (l.sron === 1) l.srf = 60; break;            // 踩上即加速下坠
        case 5:                                                  // 纵向循环（1-2-1）
          l.srmuki = (l.srmove === 0) ? 0 : 1;
          // 越界瞬移时同步偏移渲染插值快照 _py（瞬移距离 FYMAX+4100 < 跳变阈值
          // _CAM_SNAP_DIST，否则渲染期会在瞬移两点间插值，台在屏幕中间闪现一帧）
          if (l.srb < -2100) { l.srb = C.FYMAX + 2000; if (l._py != null) l._py += C.FYMAX + 4100; }
          if (l.srb > C.FYMAX + 2000) { l.srb = -2100; if (l._py != null) l._py -= C.FYMAX + 4100; }
          break;
        case 6: if (l.sron === 1) l.srf = 40; break;
      }

      // 靠近触发（合并升降台 prox；与往复移动互斥；原版 srsp=11 走 LiftTypes 同路径）：
      // 玩家水平接近即触发，之后台身加速下坠（运动积分已在上方完成，不重复积分）
      var proxCfg = l.proximity
        ? { dist: LIFT_PROX_DIST, accel: LIFT_PROX_ACCEL }
        : (lb && lb.proxDist != null ? { dist: -lb.proxDist, accel: lb.accel || 60 } : null);
      if (proxCfg && p.mhp >= 1 &&
          (p.mtype < 10 || p.mtype === C.MTYPE.ENDING || p.mtype === C.MTYPE.ENDING2)) {
        if (l.sron === 0 &&
            p.ma + p.mnobia > l.sra - proxCfg.dist && p.ma < l.sra + l.src + 500) l.sron = 1;
        if (l.sron === 1) l.srf = proxCfg.accel;
      }

      // 旧引擎 main.cpp:2765 本处仅要求 mhp>=1（无 mtype 门槛），
      // 故 301/302 演出期间升降台站立/随动/刺台伤害全部与正常游玩一致
      if (p.mhp >= 1 &&
          (p.mtype < 10 || p.mtype === C.MTYPE.ENDING || p.mtype === C.MTYPE.ENDING2)) {
        // 站立吸附窗口：脚底在台面下方 1200 世界单位内（下落速度大时放宽 900+md）
        var win = 1200;
        if (p.md >= 100) win = 900 + p.md;
        if (p.md > win) win = p.md + 100;

        if (p.ma + p.mnobia > l.sra + 500 && p.ma < l.sra + l.src - 500 &&
            p.mb + p.mnobib > oldSrb && p.mb + p.mnobib < oldSrb + win && p.md >= -100) {
          // 先吸附到旧台底（脚=旧台底+100），再随台移动 sre → 脚=新台底+100，紧贴不嵌入
          p.mb = oldSrb - p.mnobib + 100;
          if (lb && lb.slipMd != null) { p.md = lb.slipMd; }
          else { p.mzimen = 1; p.md = 0; }

          // 踩上触发下坠
          if (l.sracttype === 1 && l.sron === 0) l.sron = 1;
          // 下坠/循环/靠近触发台带着玩家一起动（oldSre×DT 是台本帧实际位移，脚=新台底+100）
          if ((l.sracttype === 1 && l.sron === 1) || l.sracttype === 3 || l.sracttype === 5 ||
              (proxCfg && l.sron === 1)) {
            p.mb += oldSre * C._DT;
          }

          // 接触加速（原版 main.cpp:2774）：站上 srtype=1 往复台时，同组台速度立即
          // 变为 900、方向不变（原码硬编码 sre[10]=sre[11]=900，即 1-2-1 下行一对台
          // 踩任一台则两台同时提速）。本帧随台位移仍用旧 sre（脚下不嵌入），下帧起按 900。
          if (l.srtype === 1) {
            for (var lj = 0; lj < state.lifts.length; lj++) {
              var lo = state.lifts[lj];
              if (lo.srtype === 1) lo.sre = lo.sre >= 0 ? LIFT_CONTACT_SPEED : -LIFT_CONTACT_SPEED;
            }
          }

          if (lb) {
            // speedUp（自定义接触事件，复刻原版接触加速）：站上往复台瞬间速度提到 900，
            // 方向不变（仅 sracttype=5 有效）。speedGroup 为非0整数时同组所有往复台一起
            // 提速（数据驱动版 1-2-1 l2/l3 联动，替代原版 sre[10]=sre[11]=900 硬编码）；
            // speedGroup=0（默认）仅被踩的台自身提速。
            if (lb.speedUp && l.sracttype === 5) {
              var _spdGrp = lb.speedGroup | 0;
              if (_spdGrp !== 0) {
                for (var _li2 = 0; _li2 < state.lifts.length; _li2++) {
                  var _l2 = state.lifts[_li2];
                  if (_l2.sracttype !== 5) continue;
                  var _lb2 = LiftTypes.resolve(_l2);
                  if (_lb2 && (_lb2.speedGroup | 0) === _spdGrp) {
                    _l2.sre = _l2.sre >= 0 ? LIFT_CONTACT_SPEED : -LIFT_CONTACT_SPEED;
                  }
                }
              } else {
                l.sre = l.sre >= 0 ? LIFT_CONTACT_SPEED : -LIFT_CONTACT_SPEED;
              }
            }
            // 站碎台：breakCfg 缺省时用引擎默认（合并升降台 bhv 只给 standBreak 标记）
            if (lb.standBreak) {
              var lbc = lb.breakCfg || LIFT_BREAK_DEFAULT;
              if (lbc.sound != null && lbc.sound >= 0) A.playSE(lbc.sound);
              var lbp = lbc.parts != null ? lbc.parts : 2;
              var lbx = lbc.vx != null ? lbc.vx : 240;
              var lby = lbc.vy != null ? lbc.vy : -1400;
              var lbg = lbc.grav != null ? lbc.grav : 160;
              var lbw = lbc.w != null ? lbc.w : 4500;
              var lbh = lbc.h != null ? lbc.h : 4500;
              var lbl = lbc.life != null ? lbc.life : 120;
              if (lbp >= 2) {
                spawnParticle(l.sra + 200, l.srb - 1000, -lbx, lby, 0, lbg, lbw, lbh, 1, lbl);
                spawnParticle(l.sra + l.src - 200, l.srb - 1000, lbx, lby, 0, lbg, lbw, lbh, 1, lbl);
              }
              if (lbp >= 4) {
                spawnParticle(l.sra + 200, l.srb - 1000, -lbx * 0.8, lby * 0.7, 0, lbg, lbw, lbh, 1, lbl);
                spawnParticle(l.sra + l.src - 200, l.srb - 1000, lbx * 0.8, lby * 0.7, 0, lbg, lbw, lbh, 1, lbl);
              }
              l.sra = -70000000;
            }
            // 弹飞 + 疲劳：连续站立 fatigueFrames 帧后台碎人亡
            if (lb.launchMc != null) {
              p.mc = lb.launchMc;
              l.srmove += C._DT;
              var fat = lb.fatigueFrames != null ? lb.fatigueFrames : 100;
              if (l.srmove >= fat) { markHurt('fatigue-lift', l.uid); sayPlayer(53, 30); p.mhp = 0; l.srmove = -5000; }
            }
          }
        }

        // 疲劳计时：未被弹飞且不在台上时逐帧回退（行为含 launchMc 即生效，不再按 srsp=2 判定）
        if (lb && lb.launchMc != null && p.mc !== lb.launchMc && l.srmove > 0) l.srmove -= C._DT;
        // sracttype=6：横向经过即触发下坠
        if (l.sracttype === 6) {
          if (p.ma + p.mnobia > l.sra + 500 && p.ma < l.sra + l.src - 500) l.sron = 1;
        }
      }

      // 纵向定速运动（srsok；现有数据均为 0，保留原版结构）
      if (l.sracttype === 3 || l.sracttype === 5) {
        if (l.srmuki === 0) l.srb -= l.srsok * C._DT;
        if (l.srmuki === 1) l.srb += l.srsok * C._DT;
      }
    }
  }

  // ==================== 敌人触发与更新 ====================
  function updateTriggers() {
    var p = state.player;
    for (var i = 0; i < state.triggers.length; i++) {
      var tr = state.triggers[i];
      if (tr.ba < -80000) continue;
      if (tr.btm >= 0) tr.btm -= C._DT;

      // 敌人重生：当玩家离开触发区域足够远时重置
      var dist = tr.ba - state.fx;
      if (tr.spawned && (dist > C.FXMAX + 20000 || dist < -20000)) {
        tr.spawned = false;
        tr.bz = 1; tr.btm = 0;
      }

      for (var tt = 0; tt <= 1; tt++) {
        xx[0] = 0; xx[1] = 0;
        var w = C.ENEMY_SIZE[tr.btype] ? C.ENEMY_SIZE[tr.btype][0] : 3000;
        if (tr.bz === 0 && tr.btm < 0 && dist >= C.FXMAX + 2000 && dist < C.FXMAX + 2000 + p.mc && tt === 0) {
          xx[0] = 1;
        }
        if (tr.bz === 0 && tr.btm < 0 && dist >= -400 - w + p.mc && dist < -400 - w && tt === 1) {
          xx[0] = 1; xx[1] = 1;
        }
        if (tr.bz === 1 && dist >= 0 - w && dist <= C.FXMAX + 4000 &&
            tr.bb - state.fy >= -9000 && tr.bb - state.fy <= C.FYMAX + 4000 && tr.btm < 0) {
          xx[0] = 1; tr.bz = 0;
        }
        if (xx[0] === 1) {
          tr.btm = 401; tr.spawned = true;
          if (tr.btype >= 10) tr.btm = 9999999;
          var spawnedE = spawnEnemy(tr.ba, tr.bb, 0, 0, 0, tr.btype, tr.bxtype, tr.bdir);
          if (spawnedE) {
            if (tr.uid) spawnedE.uid = tr.uid;   // 敌人实例继承触发器（=编辑器元素）uid
            if (tr._custom) spawnedE._custom = tr._custom;
            if (tr.followJump != null) spawnedE.followJump = !!tr.followJump;  // 跳跃跟随（解耦属性）
            // 移动方向=远离玩家：spawnEnemy 已按「面朝玩家」设好 amuki（敌人在左→1朝右，
            // 在右→0朝左），此处翻转一次即背向玩家。仅初始方向，撞墙转向逻辑不变；重生同样生效
            if (tr.baway) spawnedE.amuki = spawnedE.amuki === 0 ? 1 : 0;
          }
        }
      }
    }
  }

  // ==================== 事件触发器（编辑器 trap_event / block_qball）====================
  // 玩家 AABB 与触发区重叠即按顺序执行动作；每个触发器每关一次（fired，
  // 检查点复活不重置，换关/新游戏随关卡重载清空）
  // 问号球（实体 eventTrigger）落地：顶面规则与敌人 enemyGroundCollide 一致，
  // 只处理垂直方向（球无水平速度），使其站在管道/方块/升降台顶面上，不悬浮。
  // 调用前 updateEventTriggers 已完成本帧重力积分；collideLifts 更早执行，
  // 升降台 _oldSrb/_oldSre 均已就绪。
  function eventBallGroundCollide(tr) {
    var bottom;
    // 管道/墙体顶面
    for (var i = 0; i < state.pipes.length; i++) {
      var s = state.pipes[i];
      if (s.sa < -8000000 || !PT.isSolid(s.stype)) continue;
      bottom = tr.ay + tr.ah;
      if (tr.ax + tr.aw > s.sa + 200 && tr.ax < s.sa + s.sc - 200 &&
          bottom > s.sb && bottom < s.sb + 2000 && tr.vy >= -100) {
        tr.ay = s.sb - tr.ah + 100; tr.vy = 0;
        return;
      }
    }
    // 方块顶面（隐藏块 ttype=7 / 音符块 ttype=117 与敌人规则一致不承载顶面；ttype>=1000 非实体）
    for (var j = 0; j < state.blocks.length; j++) {
      var b = state.blocks[j];
      if (b.ta < -800000 || b.ttype >= 1000 || b.ttype === 7 || b.ttype === 117) continue;
      bottom = tr.ay + tr.ah;
      if (tr.ax + tr.aw > b.ta + 200 && tr.ax < b.ta + 3000 - 200 &&
          bottom > b.tb && bottom < b.tb + 3000 && tr.vy >= -100) {
        tr.ay = b.tb - tr.ah + 100; tr.vy = 0;
        return;
      }
    }
    // 升降台/悬挂站台顶面
    for (var li = 0; li < state.lifts.length; li++) {
      var lf = state.lifts[li];
      if (lf.sra < -8000000) continue;
      var lOld = lf._oldSrb != null ? lf._oldSrb : lf.srb;
      bottom = tr.ay + tr.ah;
      if (tr.ax + tr.aw > lf.sra + 500 && tr.ax < lf.sra + lf.src - 500 &&
          bottom > lOld && bottom < lOld + 1200 && tr.vy >= -100) {
        tr.ay = lOld - tr.ah + 100;
        // 随活动台面纵向移动（与敌人同款吸附）
        if ((lf.sracttype === 1 && lf.sron === 1) || lf.sracttype === 3 || lf.sracttype === 5) {
          tr.ay += (lf._oldSre != null ? lf._oldSre : lf.sre) * C._DT;
        }
        tr.vy = 0;
        return;
      }
    }
  }

  function updateEventTriggers() {
    var list = state.eventTriggers;
    if (!list || !list.length) return;
    var p = state.player;
    for (var i = 0; i < list.length; i++) {
      var tr = list[i];
      if (tr.fired) continue;
      // 实体问号球：每帧重力积分 + 落地（与普通敌人同参数：重力120、限速1200），
      // AABB 与可见球一起移动
      if (tr.physical) {
        tr.vy += 120 * C._DT;
        if (tr.vy > 1200) tr.vy = 1200;
        tr.ay += tr.vy * C._DT;
        eventBallGroundCollide(tr);
      }
      // 镜头窗口门控（与管道连锁检查同款条件）：视野外不检测
      if (tr.ax - state.fx + tr.aw < -12000 || tr.ax - state.fx > C.FXMAX) continue;
      // 玩家 AABB 重叠
      if (p.ma + p.mnobia <= tr.ax || p.ma >= tr.ax + tr.aw ||
          p.mb + p.mnobib <= tr.ay || p.mb >= tr.ay + tr.ah) continue;
      tr.fired = true;
      // repeat=true（问号球）：不写入 _evFired，玩家死亡复活后关卡重载时
      // 可再次触发（参考旧引擎 main.cpp:3695-3714，原版无 fired 持久化）
      if (tr.uid && !tr.repeat) state._evFired[tr.uid] = true;
      runEvents(tr);
    }
  }

  // 顺序执行动作列表（se=播音效 / spawn=按偏移生成对象 / setprop=改目标属性 /
  // move=平移目标；target uid 找不到时跳过该动作）
  // ---------- setprop 友好名→运行时字段映射（与 play.html 转换表保持一致）----------
  // 问号块/隐藏块弹出对象 ↔ 运行时 ttype/txtype 查表
  var Q_S = { coin:[2,0], mushroom:[102,0], poison:[103,0], enemy:[101,0], flower:[101,3], badstar:[104,0], pswitch:[105,0] };
  var Q_M = { coin:[112,0], mushroom:[110,2], poison:[110,0], enemy:[110,1], flower:[110,3], badstar:[110,4] };
  var H_S = { coin:[7,0], poison:[114,0], mushroom:[114,4], enemy:[114,6], flower:[114,8], badstar:[114,11], pswitch:[114,10] };
  var H_M = { coin:[114,12], poison:[110,0], mushroom:[110,2], enemy:[110,1], flower:[110,3], badstar:[110,4] };
  var POP_REV = {};
  (function () {
    function reg(tbl, mass, kind) { for (var k in tbl) { var a = tbl[k]; POP_REV[a[0] + '_' + a[1]] = { pop: k, mass: mass, kind: kind }; } }
    reg(Q_S, false, 'Q'); reg(Q_M, true, 'Q'); reg(H_S, false, 'H'); reg(H_M, true, 'H');
  })();
  function isYes(v) { return v === 'yes' || v === true || v === 1; }
  // 管道：从运行时 sa/sb/sc/sd/dir 反推 编辑器 col/row/len
  function pipeDerive(obj) {
    var dir = obj.dir || 'up';
    var len, col, row;
    if (dir === 'up' || dir === 'down') len = (obj.sd + 100) / 2900 - 1;
    else len = (obj.sc + 100) / 2900 - 1;
    len = Math.max(1, Math.round(len));
    if (dir === 'up' || dir === 'down') col = (obj.sa - 500) / 2900;
    else col = obj.sa / 2900;
    col = Math.round(col);
    if (dir === 'down') row = (obj.sb / 100 + 12) / 29 - len;
    else row = (obj.sb / 100 + 12) / 29;
    row = Math.round(row);
    return { col: col, row: row, len: len, dir: dir };
  }
  // 管道：按 col/row/len/dir 重算 sa/sb/sc/sd（与 play.html L624-644 一致）
  function pipeApply(obj, col, row, len, dir) {
    if (dir === 'down') {
      obj.sa = col * 2900 + 500; obj.sb = ((row + len) * 29 - 12) * 100;
      obj.sc = 6000; obj.sd = (len + 1) * 2900 - 100;
    } else if (dir === 'left' || dir === 'right') {
      obj.sa = col * 2900; obj.sb = (row * 29 - 12) * 100;
      obj.sc = (len + 1) * 2900 - 100; obj.sd = 6000;
    } else { // up
      obj.sa = col * 2900 + 500; obj.sb = (row * 29 - 12) * 100;
      obj.sc = 6000; obj.sd = (len + 1) * 2900 - 100;
    }
  }
  // 通用：按对象类型把 grid 坐标写入运行时位置字段
  function evSetPos(obj, field, g) {
    if ('ta' in obj) {                     // blocks
      if (field === 'col') obj.ta = g * 2900; else obj.tb = (g * 29 - 12) * 100;
    } else if ('sa' in obj) {              // pipes
      var d = pipeDerive(obj);
      if (field === 'col') d.col = g; else d.row = g;
      pipeApply(obj, d.col, d.row, d.len, d.dir);
    } else if ('ba' in obj) {              // triggers
      if (field === 'col') obj.ba = g * 2900; else obj.bb = (g * 29 - 12) * 100;
    } else if ('sra' in obj) {             // lifts
      if (field === 'col') obj.sra = g * 2900; else obj.srb = (g * 29 - 12) * 100;
    }
  }
  // 问号块/隐藏块 pop → ttype/txtype（保留当前量产状态与块种类）
  function evBlockPop(obj, pop) {
    var cur = POP_REV[(obj.ttype | 0) + '_' + (obj.txtype | 0)] || { pop: 'coin', mass: false, kind: 'Q' };
    var tbl = cur.mass ? (cur.kind === 'H' ? H_M : Q_M) : (cur.kind === 'H' ? H_S : Q_S);
    var a = tbl[pop] || (cur.kind === 'H' ? H_S.coin : Q_S.coin);
    obj.ttype = a[0]; obj.txtype = a[1];
    obj.showQ = (cur.mass && cur.kind === 'Q' && a[0] === 110);
  }
  // 问号块/隐藏块 mass 切换（保留当前 pop 与块种类）
  function evBlockMass(obj, yes) {
    var cur = POP_REV[(obj.ttype | 0) + '_' + (obj.txtype | 0)] || { pop: 'coin', mass: false, kind: 'Q' };
    var tbl = yes ? (cur.kind === 'H' ? H_M : Q_M) : (cur.kind === 'H' ? H_S : Q_S);
    var a = tbl[cur.pop] || (cur.kind === 'H' ? (H_S[cur.pop] || H_S.coin) : (Q_S[cur.pop] || Q_S.coin));
    obj.ttype = a[0]; obj.txtype = a[1];
    obj.showQ = (yes && cur.kind === 'Q' && a[0] === 110);
  }
  // 管道 entry → stype/sxtype（与 play.html pipe_mouth 转换分支一致）
  function evPipeEntry(obj, entry) {
    if (entry === 'trap') { obj.stype = 50; obj.sxtype = 0; }
    else if (entry === 'warp') { obj.stype = 60; obj.sxtype = 1; if (!obj.warp) obj.warp = { end: true, id: null }; }
    else { obj.stype = 50; obj.sxtype = 1; }   // none / off
    // off（无进入事件）：标记透传，PipeTypes[50]/[40].onEnter 据此禁用进入；
    // 切回其它值时清除该标记恢复可进入（不动 'eject' 标记——它由 else 分支的 sxtype=1 协同工作）
    if (entry === 'off') obj.entry = 'off';
    else if (obj.entry === 'off') delete obj.entry;
  }
  // 定位喷射运行时实体：
  //  - 目标本身就是 stype=180 生成器（旧档事件 target 带 '#spray' 后缀）→ 直接返回；
  //  - 目标是管道口（stype=50/60 等）→ 找 uid 派生为「管口 uid + '#spray'」的生成器
  //    （play.html convert 的喷火管 push 与原版 injectWorldDef 均按此约定派生 uid）。
  function resolveSprayGen(obj) {
    if (!obj) return null;
    if (obj.stype === 180) return obj;
    if (!obj.uid || !state.pipes) return null;
    var genUid = obj.uid + '#spray';
    for (var i = 0; i < state.pipes.length; i++) {
      var g = state.pipes[i];
      if (g.stype === 180 && g.uid === genUid) return g;
    }
    return null;
  }
  // setprop 主分派
  function evApplySetprop(obj, ev) {
    var f = ev.field || 'txtype';
    var raw = ev.value;
    var v = (typeof raw === 'string') ? raw : (raw | 0);
    if (f === 'col' || f === 'row') {
      evSetPos(obj, f, v);
    } else if (f === 'length' && 'sa' in obj && 'sc' in obj) {
      var pd = pipeDerive(obj); pd.len = Math.max(1, Math.min(20, v | 0));
      pipeApply(obj, pd.col, pd.row, pd.len, pd.dir);
    } else if (f === 'dir' && 'sa' in obj && 'sc' in obj) {
      var pd2 = pipeDerive(obj); pd2.dir = v;
      pipeApply(obj, pd2.col, pd2.row, pd2.len, pd2.dir);
      obj.dir = v;
    } else if (f === 'dir' && 'bdir' in obj) {
      obj.bdir = v;                              // 火焰棒旋转方向 cw/ccw
    } else if (f === 'entry' && 'stype' in obj) {
      evPipeEntry(obj, v);
    } else if (f === 'pop' && 'ttype' in obj) {
      evBlockPop(obj, v);
    } else if (f === 'mass' && 'ttype' in obj) {
      evBlockMass(obj, isYes(v));
    } else if (f === 'follow') {
      if ('followJump' in obj) obj.followJump = isYes(v);
    } else if (f === 'moveDir' && 'btype' in obj && 'bz' in obj) {
      // 敌人移动方向：away=远离玩家（触发器 baway，敌人(重新)生成时翻转初始 amuki）；
      // toward=靠近玩家（清除标记，恢复原版面朝玩家）。已生成敌人的方向由其撞墙逻辑管理
      if (v === 'away') obj.baway = true;
      else delete obj.baway;
    } else if (f === 'spray') {
      obj.spray = isYes(v);                       // 仅标记，不动态创建喷射生成器
    } else if (f === 'sprayTarget') {
      obj.sprayTarget = v;
      // 命中生成器直接改其 target；命中管道口则传播到配对生成器（tick 读 s.target）
      var _genT = resolveSprayGen(obj);
      if (_genT) _genT.target = v;
    } else if (f === 'sprayFreq') {
      // play.html convert 时基于 sprayFreq 生成 stype=180 生成器的 sgtype（round(freq*30)）。
      // setprop 目标语义统一为「管道口元素」：这里必须改到真正驱动 tick 的 stype=180
      // 生成器上才会生效。注意不能用 'sgtype' in obj 判断——loadStage 给所有 pipe
      // （含普通管口 stype=50/60）都初始化了 sgtype:0，写它没有任何 tick 读取。
      // 必须用原始值 raw 而非上方统一取整后的 v：分派入口对数字做了 (raw|0)，
      // 0.2 秒这类小数周期会被截成 0 → 下面 0>0 不成立 → 兜底回 1.6 → sgtype 仍是 48。
      var _fv = +raw;
      var _use = (isFinite(_fv) && _fv > 0) ? _fv : 1.6;
      obj.sprayFreq = _use;
      var _gen = resolveSprayGen(obj);
      if (_gen) _gen.sgtype = Math.max(1, Math.round(_use * 30));
    } else if (f === 'warp' && 'warp' in obj) {
      obj.warp = (v === '__end__') ? { end: true, id: null } : { end: false, id: v };
    } else if (f === 'w' && 'src' in obj && 'sra' in obj) {
      obj.src = (v | 0) * 3000;                   // 升降台/悬挂站台宽度
    } else if (f === 'h' && 'sra' in obj) {
      obj.srh = (v | 0) * 3000;                   // 悬挂站台吊柱高
    } else if (f === 'drop' && 'sracttype' in obj) {
      obj.sracttype = isYes(v) ? 1 : 0;
    } else if (f === 'len' && 'src' in obj && 'sra' in obj) {
      obj.src = (v | 0) * 3000;                   // 升降台长度
    } else if (f === 'move' && 'srsp' in obj && obj.srsp === 0) {
      // 合并升降台往复移动：sracttype=5（往复）/ 0（静止）；sre=±300（向下+/向上-）
      var _mvYes = isYes(v);
      obj.sracttype = _mvYes ? 5 : (obj.bhv && obj.bhv.dropFall ? 1 : 0);
      obj.sre = _mvYes ? (obj._liftDir === 'down' ? 300 : -300) : 0;
      obj._liftMove = _mvYes;                    // 运行时缓存，不参与持久化
    } else if (f === 'dir' && 'srsp' in obj && obj.srsp === 0) {
      // 往复方向：仅往复移动时生效（向下 sre=+300，向上 sre=-300，与 play.html 一致）
      obj._liftDir = v;
      if (obj.sracttype === 5) obj.sre = (v === 'down' ? 300 : -300);
    } else if (f === 'prox' && 'srsp' in obj && obj.srsp === 0) {
      // 靠近触发：与往复移动互斥（设 yes 时关掉往复）
      var _pxYes = isYes(v);
      obj.proximity = _pxYes;
      if (_pxYes) { obj.sracttype = 0; obj.sre = 0; obj._liftMove = false; }
    } else if (f === 'color' && 'srsp' in obj && obj.srsp === 0) {
      obj.color = v;
    } else if (f.indexOf('cev.') === 0 && 'srsp' in obj && obj.srsp === 0) {
      // 接触事件 → bhv（引擎 LiftTypes.resolve 直接消费；srsp=0 无默认行为）
      var _csub = f.slice(4);
      if (!obj.bhv) obj.bhv = {};
      if (_csub === 'speedUp') {
        if (isYes(v)) obj.bhv.speedUp = true; else delete obj.bhv.speedUp;
      } else if (_csub === 'speedGroup') {
        // 加速分组：非0整数=同组联动，0/负值=不联动（清掉走默认）
        var _sg0 = v | 0;
        if (_sg0 > 0) obj.bhv.speedGroup = Math.min(9999, _sg0);
        else delete obj.bhv.speedGroup;
      } else if (_csub === 'standBreak') {
        if (isYes(v)) obj.bhv.standBreak = true; else delete obj.bhv.standBreak;
      } else if (_csub === 'launch') {
        // 弹飞：开启时补默认 launchMc/fatigueFrames；关闭时清掉避免遗留
        if (isYes(v)) {
          if (obj.bhv.launchMc == null) obj.bhv.launchMc = -2400;
          if (obj.bhv.fatigueFrames == null) obj.bhv.fatigueFrames = 100;
        } else { delete obj.bhv.launchMc; delete obj.bhv.fatigueFrames; }
      } else if (_csub === 'slip') {
        if (isYes(v)) obj.bhv.slipMd = -800; else delete obj.bhv.slipMd;
      } else if (_csub === 'dropFall') {
        // 仅非往复时有效：sracttype=1 表示踩上坠落
        if (isYes(v)) { if (obj.sracttype !== 5) obj.sracttype = 1; }
        else if (obj.sracttype === 1) obj.sracttype = 0;
      } else if (_csub === 'launchMc') {
        obj.bhv.launchMc = (v | 0);
      } else if (_csub === 'fatigueFrames') {
        obj.bhv.fatigueFrames = (v | 0);
      }
    } else if (f === 'xt' && (obj.btype === 87 || obj.btype === 88)) {
      // 火焰棒火球总数：bxtype = rotFlag*100 + cnt（cnt=xt-1），保留 rotFlag
      var rf = Math.floor((obj.bxtype | 0) / 100);
      obj.bxtype = rf * 100 + Math.max(0, (v | 0) - 1);
    } else if (f === 'rot' && (obj.btype === 87 || obj.btype === 88)) {
      // 火焰棒角度：随机=100+cnt(<1000)，固定=cnt+(rot+100)*100(>=10000)
      var rv = v | 0;
      var bx = obj.bxtype | 0;
      var cnt2 = (bx >= 10000) ? (bx % 100) : Math.max(0, bx - 100);
      if (rv < 0) {
        obj.bxtype = 100 + cnt2;                  // 随机初相
      } else {
        var r2 = ((rv % 360) + 360) % 360;
        obj.bxtype = cnt2 + (r2 + 100) * 100;
      }
      obj.bdir = obj.bdir || 'cw';
    } else if (f === 'mirror' && (obj.btype === 87 || obj.btype === 88)) {
      // 火焰棒水平镜像：btype 88=镜像，87=正常
      obj.btype = isYes(v) ? 88 : 87;
    } else if (f.indexOf('trap.') === 0 && ('dir' in obj || 'target' in obj || 'count' in obj)) {
      var sub = f.slice(5);
      if (sub === 'tw') obj.sc = (v | 0) * 2900;
      else if (sub === 'th') obj.sd = (v | 0) * 2900;
      else obj[sub] = v;
    } else if (f.indexOf('lengths.') === 0 && obj.lengths) {
      obj.lengths[+f.slice(8)] = Math.max(1, Math.min(4, v | 0));
    } else if (f === 'rot' && obj.lengths) {
      obj.rot = ((v | 0) % 360 + 360) % 360;       // 连接管旋转
    } else {
      obj[f] = v;                                  // 通用兜底
    }
  }
  function runEvents(tr) {
    var evs = tr.events || [];
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      if (!ev || !ev.act) continue;
      if (ev.act === 'se') {
        if ((ev.id | 0) >= 1) A.playSE(ev.id | 0);
      } else if (ev.act === 'spawn') {
        var sp = spawnEnemy(tr.ax + (ev.dx | 0), tr.ay + (ev.dy | 0), 0, 0, 0, ev.atype | 0, ev.axtype | 0);
        if (sp && tr.uid) sp.uid = tr.uid + '#ev' + i;
      } else if (ev.act === 'setprop' || ev.act === 'move') {
        var tgt = ev.target ? String(ev.target) : '';
        if (!tgt) continue;
        var obj = null, k;
        for (k = 0; k < state.blocks.length; k++) if (state.blocks[k].uid === tgt) { obj = state.blocks[k]; break; }
        if (!obj) for (k = 0; k < state.pipes.length; k++) if (state.pipes[k].uid === tgt) { obj = state.pipes[k]; break; }
        if (!obj) for (k = 0; k < state.triggers.length; k++) if (state.triggers[k].uid === tgt) { obj = state.triggers[k]; break; }
        if (!obj) for (k = 0; k < state.lifts.length; k++) if (state.lifts[k].uid === tgt) { obj = state.lifts[k]; break; }
        if (!obj) continue;
        if (ev.act === 'setprop') {
          evApplySetprop(obj, ev);
        } else {
          var mdx = ev.dx | 0, mdy = ev.dy | 0;
          if ('ta' in obj) { obj.ta += mdx; obj.tb += mdy; }
          else if ('sa' in obj) { obj.sa += mdx; obj.sb += mdy; }
          else if ('ba' in obj) { obj.ba += mdx; obj.bb += mdy; }
          else if ('sra' in obj) { obj.sra += mdx; obj.srb += mdy; }
        }
      }
    }
  }

  function updateEnemies() {
    var p = state.player;
    for (var i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      if (e.aa < -800000) continue;
      xx[0] = e.aa - state.fx; xx[1] = e.ab - state.fy;
      xx[2] = e.anobia; xx[3] = e.anobib;
      if (e.anotm >= 0) e.anotm -= C._DT;
      if (xx[0] + xx[2] < -12000 || xx[0] > C.FXMAX + 12000 ||
          xx[1] + xx[3] < -9000 || xx[1] > C.FYMAX + 20000) {
        e.aa = -900000; continue;
      }

      e.aacta = 0; e.aactb = 0;
      xx[10] = 0;

      // 敌人 AI（按 atype）
      switch (e.atype) {
        case 0: case 1:
          xx[10] = 100;
          // 跳跃跟随（解耦属性 e.followJump）：玩家在附近起跳时敌人同步起跳。
          // 普通馒头怪(atype=0)/龟壳馒头怪(atype=1) 原版无此行为，开启 followJump 后复用
          // 尖刺馒头怪(case 4) 的判定与力度
          if (e.atm >= 0) e.atm -= C._DT;
          // 距离判定需在屏幕系比较（xx[0] 已是屏幕 x；p.ma 为世界 x，须先减 fx，
          // 否则镜头滚动后差值≈fx 恒超阈值，跟随跳永不触发——1-3 e0 即此根因）
          if (e.followJump && Math.abs(p.ma - state.fx + p.mnobia - xx[0] - 500) < 9000 && p.md <= -600 && e.atm <= 0) {
            if (p.mzimen === 0 && e.axzimen === 1) {
              e.ad = -1600; e.atm = 40; e.ab -= 1000;
            }
          }
          break;
        case 2:
          xx[10] = 0;
          if (e.axtype >= 1) {
            xx[10] = 800;
            // 滑动龟壳撞翻其他敌人（原版 main.cpp:2986-2997「他の敵を倒す」）：
            // AABB 重叠即直接移除（无死亡动画）并播放 koura 音效；原版不区分敌种，
            // 静止壳/道具被滑动壳碰到也会一并消失
            for (var ei = 0; ei < state.enemies.length; ei++) {
              var oe = state.enemies[ei];
              if (oe === e || oe.aa < -800000) continue;
              if (e.aa + e.anobia > oe.aa + 500 && e.aa < oe.aa + oe.anobia - 500 &&
                  e.ab + e.anobib > oe.ab - 800 &&
                  e.ab + e.anobib < oe.ab + 6300) {
                oe.aa = -800000;
                A.playSE(C.SE.SHELL);
              }
            }
          }
          break;
        case 3:
          e.azimentype = 0;
          // 原版 30Hz 每帧 ±800/1200，按 hd35 转换规则乘 C._DT 保证各帧率速度一致
          if (e.axtype === 0) e.ab -= 800 * C._DT;
          else e.ab += 1200 * C._DT;
          break;
        case 4:
          xx[10] = 120;
          if (e.atm >= 0) e.atm -= C._DT;
          // 跳跃跟随（解耦属性 e.followJump）：玩家在附近起跳时敌人同步起跳。
          // 原版硬编码为 axtype===1；显式 followJump 优先，旧数据 axtype===1 自动迁移
          // 距离判定同 case 0/1：屏幕系比较，p.ma 须先减 state.fx
          if (e.followJump && Math.abs(p.ma - state.fx + p.mnobia - xx[0] - 500) < 9000 && p.md <= -600 && e.atm <= 0) {
            if (p.mzimen === 0 && e.axzimen === 1) {
              e.ad = -1600; e.atm = 40; e.ab -= 1000;
            }
          }
          break;
        case 5: xx[10] = 160; break;
        case 6:
          // デフラグさん（方块机器人）：原版 main.cpp:3035-3085
          xx[10] = 120;   // 平时贴地行走速度
          if (e.atm >= 200) xx[10] = 0;   // 扔出道具后的短暂停（原版 atm>=200 时 xx[10]=0）
          if (e.atm >= 10) {
            e.atm += C._DT;
            if (p.mhp >= 1) {
              // 抓住玩家期间（atm 10~20 之间）：把玩家锁在头顶（ab 上方 30px），机器人停步。
              // 用 < 20 而非 <= 19：60Hz(_DT=0.5) 下 atm=19.5 的"空档帧"既不锁定也不抛出，
              // 玩家带着累积下落速度坠入机器人头部 → 踩踏判定再触发 atm 重置 10 → 二次前摇；
              // 30Hz 整数语义下 <20 与 <=19 等价，行为不变
              if (e.atm < 20) { p.ma = e.aa; p.mb = e.ab - 3000; p.mtype = C.MTYPE.NORMAL; }
              xx[10] = 0;
              // atm==20：向右上方抛出玩家（mc=700 / md=-1200），锁键 24 帧
              if (e.atm === 20) {
                p.mc = 700; p.mkeytm = 24; p.md = -1200;
                p.mb = e.ab - 1000 - 3000;
                e.amuki = 1;
                if (e.axtype === 1) { p.mc = 840; e.axtype = 0; }
              }
              if (e.atm === 40) { e.amuki = 0; e.atm = 0; }
            }
          }
          if (e.atm >= 220) { e.atm = 0; e.amuki = 0; }
          // 他の敵を投げる：碰到道具类敌人(atype>=100)、馒头怪系(atype=0/1/4)或假旗杆(atype=85)时举过头顶再抛出
          // （abrocktm=120：先上升 20 帧，到 100 时按通用逻辑 ad=-1200/ac=700 弹出）
          // 馒头怪系：0=馒头怪、1=龟壳馒头怪、4=尖刺馒头怪（原版 main.cpp:3081 仅扔 atype>=100，
          // 0/1/4/85 为本引擎扩展；举起期间 abrocktm>0 已停用行走/重力/玩家碰撞，通用投掷流程对各 atype 一致）
          for (var ri = 0; ri < state.enemies.length; ri++) {
            var re = state.enemies[ri];
            if (re === e || re.aa < -800000 || re.abrocktm > 0) continue;
            // 被举起的机器人不再扔其他敌人
            if (e.abrocktm > 0) break;
            // 方块机器人相遇：随机挑 1 个作为被扔对象，另一个做扔出动作
            // 由 aa 较小的一侧处理相遇，避免双方在各自循环中重复触发
            if (re.atype === 6) {
              if (e.aa > re.aa) continue;
              if (e.atm >= 10 || re.atm >= 10) continue;
              if (e.aa + e.anobia > re.aa + 500 && e.aa < re.aa + re.anobia - 500 &&
                  e.ab + e.anobib > re.ab - 800 &&
                  e.ab + e.anobib < re.ab + 6300) {
                if (Math.random() < 0.5) {
                  // e 扔 re
                  re.amuki = 1; re.aa = e.aa + 300; re.ab = e.ab - 3000; re.abrocktm = 120;
                  e.atm = 200; e.amuki = 1;
                } else {
                  // re 扔 e
                  e.amuki = 1; e.aa = re.aa + 300; e.ab = re.ab - 3000; e.abrocktm = 120;
                  re.atm = 200; re.amuki = 1;
                }
                break;
              }
              continue;
            }
            var canThrowEnemy = re.atype >= 100 ||
              re.atype === 0 || re.atype === 1 || re.atype === 4 || re.atype === 85;
            if (!canThrowEnemy) continue;
            // 垂直窗口：假旗杆(85)杆高 30000，机器人只需与杆身纵向重叠即可抓起；
            // 其余敌人维持原版「脚底不超过敌人顶部+6300」
            var vertReach = re.atype === 85 ? re.anobib + 800 : 6300;
            if (e.aa + e.anobia > re.aa + 500 && e.aa < re.aa + re.anobia - 500 &&
                e.ab + e.anobib > re.ab - 800 &&
                e.ab + e.anobib < re.ab + vertReach) {
              re.amuki = 1; re.aa = e.aa + 300; re.ab = e.ab - 3000; re.abrocktm = 120;
              e.atm = 200; e.amuki = 1;
            }
          }
          // ポール捨て：原版 main.cpp:3055-3074，axtype=1 变体机器人（デフラグ）走到终点杆左侧
          // 将其拔起（atm=100 举杆 20 帧→atm=120 抛出 egtype=4 杆粒子→atm=140 结束）。
          // 杆粒子仅飞行表现，无碰撞（原版即无通关判定）；拔杆时若玩家正在杆上滑行则强行取消通关
          if (e.axtype === 1) {
            for (var gi = 0; gi < state.pipes.length; gi++) {
              var gs = state.pipes[gi];
              if (gs.stype === 300 && gs.sa > -800000 &&
                  e.aa - state.fx >= -8000 && e.aa >= gs.sa + 2000 && e.aa <= gs.sa + 3600 &&
                  e.axzimen === 1) {
                gs.sa = -800000; e.atm = 100;
              }
            }
            if (e.atm === 100) {
              spawnParticle(e.aa, e.ab + 3000 - 10 * 3000 - 1500, 0, 0, 0, 0, 1000, 10 * 3000 - 1200, 4, 20);
              if (p.mtype === C.MTYPE.GOAL_SLIDE) { p.mtype = 0; A.stopSe(C.SE.GOAL); A.bgmChange(state.bgmId || 100); }
              for (var gi2 = 0; gi2 < state.pipes.length; gi2++) {
                if (state.pipes[gi2].stype === 104) state.pipes[gi2].sa = -80000000;
              }
            }
            if (e.atm === 120) {
              spawnParticle(e.aa, e.ab + 3000 - 10 * 3000 - 1500, 600, -1200, 0, 160, 1000, 10 * 3000 - 1200, 4, 240);
              e.amuki = 1;
            }
            if (e.atm === 140) { e.amuki = 0; e.atm = 0; }
          }
          break;
        case 7:
          e.azimentype = 0;
          xx[11] = 400;
          if (e.axtype === 0) xx[10] = xx[11];
          if (e.axtype === 1) xx[10] = -xx[11];
          if (e.axtype === 2) e.ab -= xx[11] * C._DT;
          if (e.axtype === 3) e.ab += xx[11] * C._DT;
          break;
        case 8:
          // スーパーブーン / 奔跑怪（空中上下浮动）：原版 main.cpp:3103-3114
          // azimentype=0 关闭重力，af 相位累加器驱动 ad 速度做正弦式上下漂浮
          e.azimentype = 0;
          if (e.atm === 0) { e.af += 20 * C._DT; e.ad += 20 * C._DT; }
          if (e.atm === 1) { e.af -= 20 * C._DT; e.ad -= 20 * C._DT; }
          if (e.ad > 300) e.ad = 300;
          if (e.ad < -300) e.ad = -300;
          if (e.af >= 1200) e.atm = 1;
          if (e.af < 0) e.atm = 0;
          e.ab += e.ad * C._DT;
          break;
        case 9:
          e.azimentype = 5;
          e.ab += e.ad * C._DT; e.ad += 100 * C._DT;
          if (e.ab >= C.FYMAX + 1000) e.ad = 900;
          // 原版 main.cpp case 9：落出屏幕底部后瞬移回底部并向上抛出，形成上下弹跳
          if (e.ab >= C.FYMAX + 12000) { e.ab = C.FYMAX; e.ad = -2600; }
          break;
        case 10:
          e.azimentype = 0;
          xx[11] = 400;
          if (e.axtype === 0) xx[10] = xx[11];
          if (e.axtype === 1) xx[10] = -xx[11];
          break;
        case 30:
          e.atm += C._DT;
          if (e.axtype === 0) {
            if (e.atm === 50 && p.mb >= 6000) { e.ac = 300; e.ad -= 1600; e.ab -= 1000; }
          } else {
            e.azimentype = 0; e.ab += e.ad * C._DT; e.ad += 120 * C._DT;
          }
          break;
        case 79:
          // 激光（main.cpp:3163-3170）：axtype=0 水平速度1600；
          // 1/2 速度1200 且每帧上飘/下沉200；3/4 速度900 且每帧上飘/下沉600
          e.azimentype = 0; xx[10] = 1600;
          if (e.axtype === 1) { xx[10] = 1200; e.ab -= 200 * C._DT; }
          if (e.axtype === 2) { xx[10] = 1200; e.ab += 200 * C._DT; }
          if (e.axtype === 3) { xx[10] = 900; e.ab -= 600 * C._DT; }
          if (e.axtype === 4) { xx[10] = 900; e.ab += 600 * C._DT; }
          break;
        case 80: case 81: case 82: case 83:
          e.azimentype = 0; break;
        case 84:
          e.azimentype = 2; break;
        case 85:
          if (e.axtype === 0) { e.axtype = 1; e.amuki = 1; }
          // 原版 main.cpp:3193-3194 两条触发：玩家从左侧/右侧接近时旗杆分别向左/向右逃跑
          if (p.mb >= 30000 && p.ma >= e.aa - 15000 && p.ma <= e.aa && e.axtype === 1) { e.axtype = 5; e.amuki = 0; }
          if (p.mb >= 24000 && p.ma <= e.aa + 24000 && p.ma >= e.aa && e.axtype === 1) { e.axtype = 5; e.amuki = 1; }
          if (e.axtype === 5) xx[10] = 400;
          break;
        case 86:
          e.azimentype = 4;
          // 原版 main.cpp case 86：玩家水平范围与猫身重叠才触发下落（xx[26] 运行时≈18，几乎无余量）
          if (p.ma >= e.aa - p.mnobia - 18 && p.ma <= e.aa + e.anobia + 18) e.atm = 1;
          if (e.atm === 1) e.ab += 1200 * C._DT;
          break;
        case 87: case 88:
          e.azimentype = 0;
          // 旋转方向：bdir='cw'顺时针(atm+=) / 'ccw'逆时针(atm-=)；
          // 未设置时按原版 aa%10===1 推断（原版坐标末尾为1的火焰棒反转）
          var fbCw = e.bdir ? (e.bdir === 'cw') : (e.aa % 10 !== 1);
          if (fbCw) e.atm += 6 * C._DT; else e.atm -= 6 * C._DT;
          if (e.atm > 720) e.atm -= 720;
          if (e.atm < 0) e.atm += 720;
          break;
        case 90: xx[10] = 160; break;
        case 91:
          // 五重激光：主对象以中间激光速度(1600)右移，atm 记录经过时间
          // 5 道子激光位置由 drawEnemy/collision 按 atm 相对主对象计算：
          //   sub i 的 x = e.aa + amukiSign*(speed[i]-1600)*atm, y = e.ab + vspeed[i]*atm
          // 旧引擎 main.cpp:3163-3170 速度表：0→1600, 1→1200↑200, 2→1200↓200, 3→900↑600, 4→900↓600
          e.azimentype = 0; xx[10] = 1600; e.atm += C._DT; break;
        case 100:
          e.azimentype = 1; xx[10] = 100;
          // 巨大化：红蘑菇(axtype=2)碰到馒头怪系(atype=0/1/4/7)→变巨型馒头怪(atype=90)
          // 原版 main.cpp:3268-3283：原版仅 atype=0/4，按用户要求扩展到全部馒头怪系
          // （巨型馒头怪 atype=90 本身已是目标态，不再处理）
          if (e.axtype === 2) {
            for (var gi = 0; gi < state.enemies.length; gi++) {
              var ge = state.enemies[gi];
              if (ge === e || ge.aa < -800000) continue;
              if (ge.atype !== 0 && ge.atype !== 1 && ge.atype !== 4 && ge.atype !== 7) continue;
              // AABB 重叠（沿用原版检测窗口：xx[0]*2=500、xx[5]=-800、xx[1]*3=4800）
              if (e.aa + e.anobia > ge.aa + 500 &&
                  e.aa < ge.aa + ge.anobia - 500 &&
                  e.ab + e.anobib > ge.ab - 800 &&
                  e.ab + e.anobib < ge.ab + 4800) {
                ge.atype = 90;
                ge.anobia = 6400; ge.anobib = 6300; ge.axtype = 0;
                ge.aa -= 1050; ge.ab -= 1050;
                A.playSE(C.SE.POWERUP);
                e.aa = -80000000;  // 红蘑菇消失（与原版 aa[t]=-80000000 一致）
                break;
              }
            }
          }
          break;
        case 102:
          e.azimentype = 1; xx[10] = e.axtype === 1 ? 200 : 100; break;
        case 110:
          e.azimentype = 1; xx[10] = 200;
          if (e.axzimen === 1) { e.ab -= 1200; e.ad = -1400; }
          break;
      }

      if (e.abrocktm >= 1) xx[10] = 0;
      if (e.amuki === 0) e.aacta -= xx[10] * C._DT;
      else e.aacta += xx[10] * C._DT;

      if (e.ad > 1200 && e.azimentype !== 5) e.ad = 1200;

      e.aa += e.aacta;
      if (e.azimentype >= 1 && e.abrocktm <= 0) {
        e.aa += e.ac * C._DT;
        if (e.azimentype >= 1 && e.azimentype <= 3) { e.ab += e.ad * C._DT; e.ad += 120 * C._DT; }
        if (e.axzimen === 1) {
          if (e.ac >= 200) e.ac -= 100 * C._DT;
          else if (e.ac <= -200) e.ac += 100 * C._DT;
          else e.ac = 0;
        }
        e.axzimen = 0;
        enemyGroundCollide(e);
      }

      if (e.abrocktm > 0) {
        e.abrocktm -= C._DT;
        if (e.abrocktm < 100) e.ab -= 180 * C._DT;
        if (e.abrocktm === 100) { e.ab -= 800; e.ad = -1200; e.ac = 700; e.abrocktm = 0; }
      }

      // 玩家踩敌人
      xx[0] = 250; xx[1] = 1600; xx[5] = -800;
      xx[8] = e.aa; xx[9] = e.ab;
      xx[12] = 0; if (p.md >= 100) xx[12] = p.md;
      xx[25] = 0;

      // 火焰棒特殊碰撞：检测每颗火球是否碰到玩家（而不仅仅是中心点）
      // 参考旧引擎 main.cpp case 87/88：间距 xx[26]=18px，基准方框 xx[4]=1800(18px)、
      // 内缩 xx[5]=800(8px) → 等效仅中心 2×2px 判定区（火球视觉半径8px，碰撞远小于视觉）
      if ((e.atype === 87 || e.atype === 88) && p.mmutekitm <= 0 && p.mtype !== C.MTYPE.DEAD) {
        var fbCnt = e.axtype % 100;
        var fbAng = e.atm * Math.PI / 180 / 2;
        var FB_BOX = 1800;      // 基准方框边长（世界单位=18px，略大于视觉直径16px）
        var FB_INSET = 800;     // 内缩量（世界单位=8px）
        var fbHalf = FB_BOX / 2 - FB_INSET;   // 等效半边长=100(1px)，判定盒2×2px
        for (var fi = 0; fi <= fbCnt; fi++) {
          // atype 88 是水平镜像的火焰棒：cos 取反
          var sign = e.atype === 88 ? -1 : 1;
          var fbx = e.aa + sign * fi * 1800 * Math.cos(fbAng);  // 1800 = 18px * 100 世界单位（旧引擎 xx[26]=18）
          var fby = e.ab + fi * 1800 * Math.sin(fbAng);
          if (p.ma + p.mnobia > fbx - fbHalf && p.ma < fbx + fbHalf &&
              p.mb + p.mnobib > fby - fbHalf && p.mb < fby + fbHalf) {
            markHurt('firebar', e.uid);
            sayPlayer(51, 30);   // 原版 main.cpp:3224/3250：被火焰棒烧到「这...!!」
            p.mhp -= 1;
            break;
          }
        }
      }

      // 五重激光碰撞：5 道子激光逐条检测（与 atype=79 单激光使用同一碰撞窗口）
      if (e.atype === 91 && p.mmutekitm <= 0 && p.mtype !== C.MTYPE.DEAD) {
        var amukiSign91 = e.amuki === 0 ? -1 : 1;
        var sp91 = [1600, 1200, 1200, 900, 900];
        var vs91 = [0, -200, 200, -600, 600];
        for (var li = 0; li < 5; li++) {
          var lx91 = e.aa + amukiSign91 * (sp91[li] - 1600) * e.atm;
          var ly91 = e.ab + vs91[li] * e.atm;
          if (p.ma + p.mnobia > lx91 + 500 && p.ma < lx91 + e.anobia - 500 &&
              p.mb < ly91 + e.anobib - 500 && p.mb + p.mnobib > ly91 + e.anobib - 250) {
            markHurt('laser5', e.uid);
            sayPlayer(51, 30);   // 五重激光为新引擎合并机关，沿用旧机关致死台词
            p.mhp -= 1;
            break;
          }
        }
      }

      if (p.ma + p.mnobia > xx[8] + xx[0] * 2 && p.ma < xx[8] + e.anobia - xx[0] * 2 &&
          p.mb + p.mnobib > xx[9] - xx[5] && p.mb + p.mnobib < xx[9] + xx[1] + xx[12] &&
          p.mmutekitm <= 0 && e.abrocktm <= 0) {
        if (e.atype !== 4 && e.atype !== 9 && e.atype !== 10 && (e.atype <= 78 || e.atype === 85) &&
            p.mzimen !== 1 && p.mtype !== C.MTYPE.DEAD) {
          if (e.atype === 0) {
            if (e.axtype === 0) e.aa = -900000;
            else { A.playSE(5); p.mb = xx[9] - 900 - e.anobib; p.md = -2100; xx[25] = 1; }
          }
          // 原版 main.cpp:3523-3535：if(atype==1){变静止壳} else if(atype==2&&md>=0){壳状态切换}
          // 必须是 else if：绿龟变壳的同一帧不能再触发壳启动，否则壳一出现就立刻滑动
          if (e.atype === 1) {
            e.atype = 2; e.anobib = 3000; e.axtype = 0;
          } else if (e.atype === 2 && p.md >= 0) {
            if (e.axtype === 1 || e.axtype === 2) {
              e.axtype = 0;                        // 滑动壳 → 静止
            } else if (e.axtype === 0) {
              // 静止壳 → 启动：玩家在壳左侧则壳向右滑(amuki=1)，在右侧则向左滑
              if (p.ma + p.mnobia > xx[8] + xx[0] * 2 &&
                  p.ma < xx[8] + e.anobia / 2 - xx[0] * 4) e.amuki = 1;
              else e.amuki = 0;
              e.axtype = 1;
            }
          }
          // デフラグさん：从上方接触也进入抓取流程（原版 main.cpp:3540-3542），
          // 不弹死玩家；随后通用反弹逻辑本帧仍会播踩踏音/轻弹，下一帧起被抓取锁定覆盖
          if (e.atype === 6) { e.atm = 10; p.md = 0; p.actaon[2] = 0; }
          if (e.atype === 7) e.aa = -900000;
          if (e.atype === 85) {
            if (xx[25] === 0) { A.playSE(5); p.mb = xx[9] - 4000; p.md = -1000; e.axtype = 5; }
          } else if (xx[25] === 0) {
            A.playSE(5); p.mb = xx[9] - 1000 - e.anobib; p.md = -1000;
          }
          if (p.actaon[2] === 1) { p.md = -1600; p.actaon[2] = 0; }
        }
      }

      // 玩家碰到敌人（受伤）
      xx[15] = -500; xx[16] = 0;
      if (e.atype === 4 || e.atype === 9 || e.atype === 10) xx[16] = -3000;
      if (e.atype === 82 || e.atype === 83 || e.atype === 84) xx[16] = -3200;
      if (e.atype === 85) xx[16] = -e.anobib + 6000;

      if (p.ma + p.mnobia > xx[8] + 500 && p.ma < xx[8] + e.anobia - 500 &&
          p.mb < xx[9] + e.anobib + xx[15] && p.mb + p.mnobib > xx[9] + e.anobib - xx[0] + xx[16] &&
          e.anotm <= 0 && e.abrocktm <= 0) {
        if (p.mmutekitm <= 0 && (e.atype <= 99 || e.atype >= 200) && e.atype !== 91) {
          if (p.mmutekion !== 1 && p.mtype !== C.MTYPE.DEAD) {
            if ((e.atype !== 2 || e.axtype !== 0) && p.mhp >= 1) {
              // 方块机器人(atype=6)接触不造成伤害：改为抓住玩家并抛投（原版 main.cpp:3586-3597）
              if (e.atype !== 6) {
                markHurt('enemy', e.uid, { atype: e.atype, axtype: e.axtype, aa: e.aa, ab: e.ab });
                p.mhp -= 1;
                // 击杀成立：按旧 main.cpp:3601-3659 mhp==0 分支播放敌人/玩家台词
                if (p.mhp <= 0) dispatchContactLine(e);
                _debugLog.push({ f: _debugFrame, key: _debugKey, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, before: true, mhpDmg: true, reason: 'enemy', uid: e.uid, atype: e.atype, aa: e.aa, ab: e.ab });
              }
            }
            if (e.atype === 6) e.atm = 10;

            // 鬼脸云(atype=80)致死接触后现形为 81（旧引擎 main.cpp:3656-3659，mhp==0 分支）；
            // axtype 保持：隐形鬼脸云(80+1) → 现形隐形云(81+1，绘制 grap[130][3])
            if (e.atype === 80 && p.mhp <= 0) e.atype = 81;

            // 伪装方块(atype=82)致命接触瞬间「开花」（旧引擎 main.cpp:3642-3645，
            // 位于 mhp==0 分支）：82→83 露出四周白尖；本体左上移(-1000,-900)，
            // 使 83 形态在(+10,+9)叠加的 30×30 方块仍贴在原格位置。
            // anobia/anobib 保持 3000（碰撞盒不随形态放大，与旧引擎一致）；
            // 巨大化(mhp≫0)接触不致死则不变形（旧引擎 mhp!=0 不进本分支）
            if (e.atype === 82 && p.mhp <= 0) {
              // 旧 main.cpp:3642-3645：getrand(1)+31 → getrand 上界不含，只会抽到 31
              sayEnemy(e, 31 + oldRand(1), 20);
              e.atype = 83;
              e.aa -= 1000;
              e.ab -= 900;
            }

            // こうら踢效果（原版 main.cpp:3665-3677）：
            // 玩家水平触碰静止龟壳(atype=2,axtype=0) → 启动滑动并把壳瞬移到玩家旁，
            // 给玩家5帧无敌防止本帧/下帧重复触发；滑动中壳(axtype>=1)撞玩家已由上面 markHurt 扣血分支处理
            if (e.atype === 2 && e.axtype === 0) {
              if (p.ma + p.mnobia > xx[8] + xx[0] * 2 &&
                  p.ma < xx[8] + e.anobia / 2 - xx[0] * 4) {
                // 玩家从壳左侧触碰 → 壳向右滑
                e.amuki = 1; e.aa = p.ma + p.mnobia + p.mc;
              } else {
                // 玩家从壳右侧触碰 → 壳向左滑
                e.amuki = 0; e.aa = p.ma - e.anobia - p.mc;
              }
              e.axtype = 1;
              p.mmutekitm = 5;
              A.playSE(C.SE.SHELL);
              console.log('[KICK] shell kicked:', { fromAa: xx[8], toAa: e.aa, amuki: e.amuki, pMa: p.ma, pMc: p.mc });
            }
          }
        }
        // 道具拾取
        if (e.atype >= 100 && e.atype <= 199) {
          // 旧 main.cpp:3685-3717：云/花/毒蘑菇/恶星拾取台词（与是否致死无关）
          if (e.atype === 100 && e.axtype === 0) { sayPlayer(1, 30); A.playSE(C.SE.POWERUP); }
          if (e.atype === 100 && e.axtype === 1) { sayPlayer(2, 30); A.playSE(C.SE.POWERUP); }
          if (e.atype === 100 && e.axtype === 2) {
            // 巨大蘑菇：玩家变大
            p.mnobia = C.PLAYER_GIANT_W; p.mnobib = C.PLAYER_GIANT_H;
            A.playSE(C.SE.POWERUP); p.ma -= 1100; p.mb -= 4000; p.mtype = 1; p.mhp = 50000000;
          }
          if (e.atype === 101) { sayPlayer(11, 30); markHurt('flower', e.uid); p.mhp -= 1; _debugLog.push({ f: _debugFrame, key: _debugKey, mhpDmg: true, reason: 'flower', uid: e.uid }); }
          if (e.atype === 102) { sayPlayer(10, 30); markHurt('poison-mushroom', e.uid); p.mhp -= 1; _debugLog.push({ f: _debugFrame, key: _debugKey, mhpDmg: true, reason: 'poison-mushroom', uid: e.uid }); }
          if (e.atype === 110) { sayPlayer(3, 30); markHurt('bad-star', e.uid); p.mhp -= 1; _debugLog.push({ f: _debugFrame, key: _debugKey, mhpDmg: true, reason: 'bad-star', uid: e.uid }); }
          e.aa = -90000000;
        }
      }
    }
    // 清理死亡敌人；喷火管火球坠入深渊（y 超过玩家击杀面 52000）也移除
    // （旧引擎离开处理窗口 main.cpp:2970 即不再参与）
    state.enemies = state.enemies.filter(function (e) { return e.aa >= -800000 && !(e.atype === 84 && e.ab > 52000); });
  }

  function enemyGroundCollide(e) {
    // 喷火管火球（atype=84）：旧引擎 azimentype=2 跳过全部地形判定（main.cpp:3480），
    // 火球坠穿地形后因离开处理窗口而消失；这里按「落地即消失」还原——
    // 落到管道/方块/升降台顶面的瞬间移除，不做墙面反弹
    var isFireball = e.atype === 84;
    // 与管道碰撞
    for (var i = 0; i < state.pipes.length; i++) {
      var s = state.pipes[i];
      if (s.sa < -8000000 || !PT.isSolid(s.stype)) continue;
      xx[0] = 200; xx[2] = 1000; xx[1] = 2000;
      xx[8] = s.sa; xx[9] = s.sb;
      if (!isFireball && e.aa + e.anobia > xx[8] - xx[0] && e.aa < xx[8] + xx[2] &&
          e.ab + e.anobib > xx[9] + xx[1] * 3 / 4 && e.ab < xx[9] + s.sd - xx[2]) {
        e.aa = xx[8] - xx[0] - e.anobia; e.amuki = 0;
      }
      if (!isFireball && e.aa + e.anobia > xx[8] + s.sc - xx[0] && e.aa < xx[8] + s.sc + xx[0] &&
          e.ab + e.anobib > xx[9] + xx[1] * 3 / 4 && e.ab < xx[9] + s.sd - xx[2]) {
        e.aa = xx[8] + s.sc + xx[0]; e.amuki = 1;
      }
      if (e.aa + e.anobia > xx[8] + xx[0] && e.aa < xx[8] + s.sc - xx[0] &&
          e.ab + e.anobib > xx[9] && e.ab + e.anobib < xx[9] + s.sd - xx[1] && e.ad >= -100) {
        if (isFireball) { e.aa = -90000000; return; }   // 落到管顶即消失
        e.ab = s.sb - e.anobib + 100; e.ad = 0; e.axzimen = 1;
      }
    }
    // 与方块碰撞
    for (var j = 0; j < state.blocks.length; j++) {
      var b = state.blocks[j];
      if (b.ta < -800000) continue;
      xx[0] = 200; xx[1] = 3000; xx[2] = 1000;
      xx[8] = b.ta; xx[9] = b.tb;
      // 桃色方块猫(86)/光束(90)：不与方块做阻挡反弹，只要 AABB 重叠就立刻把方块撞碎
      // 桃色方块猫(86)/光束(90)：不与方块做阻挡反弹，只要 AABB 重叠就立刻把方块撞碎
      // （原版 main.cpp tekizimen：soundplay(3) + 4 方向碎片 eyobi + brockbreak）；
      // 管道/墙体仍在上方管道循环中正常阻挡它们。
      // 撞碎粒子参数由 BlockTypes.resolveCrush(e) 驱动（bhv 可覆盖默认）
      var crushCfg = BlockTypes.resolveCrush(e);
      if (crushCfg) {
        if (e.aa + e.anobia > xx[8] && e.aa < xx[8] + xx[1] &&
            e.ab + e.anobib > xx[9] && e.ab < xx[9] + xx[1]) {
          if (crushCfg.sound != null && crushCfg.sound >= 0) A.playSE(crushCfg.sound);
          var cp = crushCfg.parts != null ? crushCfg.parts : 4;
          var cvx = crushCfg.vx != null ? crushCfg.vx : 300;
          var cvy = crushCfg.vy != null ? crushCfg.vy : -1000;
          var cvx2 = crushCfg.vx2 != null ? crushCfg.vx2 : 240;
          var cvy2 = crushCfg.vy2 != null ? crushCfg.vy2 : -1400;
          var cg = crushCfg.grav != null ? crushCfg.grav : 160;
          var cw = crushCfg.w != null ? crushCfg.w : 1000;
          var ch = crushCfg.h != null ? crushCfg.h : 1000;
          var cl = crushCfg.life != null ? crushCfg.life : 120;
          spawnParticle(b.ta + 1200, b.tb + 1200, cvx, cvy, 0, cg, cw, ch, 1, cl);
          spawnParticle(b.ta + 1200, b.tb + 1200, -cvx, cvy, 0, cg, cw, ch, 1, cl);
          if (cp >= 4) {
            spawnParticle(b.ta + 1200, b.tb + 1200, cvx2, cvy2, 0, cg, cw, ch, 1, cl);
            spawnParticle(b.ta + 1200, b.tb + 1200, -cvx2, cvy2, 0, cg, cw, ch, 1, cl);
          }
          b.ta = -800000;
        }
        continue;
      }
      if (b.ttype >= 1000) continue;
      if (b.ttype !== 7 && b.ttype !== 117) {
        if (e.aa + e.anobia > xx[8] + xx[0] && e.aa < xx[8] + xx[1] - xx[0] &&
            e.ab + e.anobib > xx[9] && e.ab + e.anobib < xx[9] + xx[1] && e.ad >= -100) {
          if (isFireball) { e.aa = -90000000; return; }   // 落到方块顶即消失
          e.ab = xx[9] - e.anobib + 100; e.ad = 0; e.axzimen = 1;
        }
      }
      // 左右侧面碰撞：原版 main.cpp:3950 — 隐藏块(ttype=7)对普通敌人(atype<100 且
      // atype!==2)连侧面也不存在，敌人可横穿/坠落穿过；道具敌人(atype>=100)与滑动
      // 龟壳(atype=2)除外。此前只排除117导致敌人坠落时被侧面解析反复向左瞬移
      // （2-1 尖刺馒头怪离开 g10_11 时瞬移到 g10_7 的根因）
      if (!isFireball && (e.atype >= 100 || b.ttype !== 7 || e.atype === 2) && b.ttype !== 117) {
        var sideHit = false;
        if (e.aa + e.anobia > xx[8] && e.aa < xx[8] + xx[2] &&
            e.ab + e.anobib > xx[9] + xx[1] / 2 - xx[0] && e.ab < xx[9] + xx[2]) {
          e.aa = xx[8] - e.anobia; e.ac = 0; e.amuki = 0; sideHit = true;
        }
        if (e.aa + e.anobia > xx[8] + xx[1] - xx[0] * 2 && e.aa < xx[8] + xx[1] &&
            e.ab + e.anobib > xx[9] + xx[1] / 2 - xx[0] && e.ab < xx[9] + xx[2]) {
          e.aa = xx[8] + xx[1]; e.ac = 0; e.amuki = 1; sideHit = true;
        }
        // こうらブレイク（原版 main.cpp:3955-3959）：滑动龟壳(atype=2)侧面撞击
        // 隐藏块(ttype=7)时触发隐藏块——播金币音、变已用块(ttype=3)、弹金币粒子
        // （与玩家从下方顶撞 ttype=7 的触发一致，见上方玩家分支）
        if (sideHit && e.atype === 2 && b.ttype === 7) {
          A.playSE(C.SE.COIN);
          spawnParticle(b.ta + 10, b.tb, 0, -800, 0, 40, 3000, 3000, 0, 16);
          b.ttype = 3;
        }
      }
    }
    // 与升降台碰撞（含悬挂站台 srsp=10~14）：敌人可站在台面上；
    // collideLifts 在 updateEnemies 之前已把 srb 更新到本帧位置并记录 _oldSrb。
    // 用旧台底判定 + 新台底吸附 + sre 随动，脚始终紧贴台面不嵌入。
    for (var li = 0; li < state.lifts.length; li++) {
      var lf = state.lifts[li];
      if (lf.sra < -8000000) continue;
      // 水平剔除：sra 是世界坐标，必须先减镜头 fx 再与屏宽 FXMAX 比较
      // （与 collideLifts 玩家分支一致；原实现漏减 fx，导致 x>FXMAX+120 的
      //   升降台/悬挂台对敌人永远失效——敌人站不上任何远处站台）
      if (lf.sra - state.fx + lf.src < -12000 || lf.sra - state.fx > C.FXMAX + 12000) continue;
      var lOld = lf._oldSrb != null ? lf._oldSrb : lf.srb;
      if (e.aa + e.anobia > lf.sra + 500 && e.aa < lf.sra + lf.src - 500 &&
          e.ab + e.anobib > lOld && e.ab + e.anobib < lOld + 1200 && e.ad >= -100) {
        if (isFireball) { e.aa = -90000000; return; }   // 落到台面即消失
        e.ab = lOld - e.anobib + 100;
        // 随台移动（用旧 sre×DT=台本帧实际位移，与玩家一致；需存到 lift 上）
        if ((lf.sracttype === 1 && lf.sron === 1) || lf.sracttype === 3 || lf.sracttype === 5) {
          e.ab += (lf._oldSre != null ? lf._oldSre : lf.sre) * C._DT;
        }
        e.ad = 0; e.axzimen = 1;
      }
    }
  }

  // ==================== 粒子更新 ====================
  function updateParticles() {
    for (var i = 0; i < state.particles.length; i++) {
      var p = state.particles[i];
      if (p.etm >= 0) p.etm -= C._DT;
      xx[0] = p.ea - state.fx; xx[1] = p.eb - state.fy;
      if (p.etm >= 0 && xx[0] > -100 && xx[0] < C.FXMAX && xx[1] > -10000 && xx[1] < C.FYMAX) {
        p.ea += p.ec * C._DT; p.eb += p.ed * C._DT;
        p.ec += p.ee * C._DT; p.ed += p.ef * C._DT;
      } else {
        p.ea = -9000000;
      }
    }
    state.particles = state.particles.filter(function (p) { return p.ea >= -800000; });
  }

  // ==================== 镜头滚动 ====================
  function updateCamera() {
    var p = state.player;
    if (state.kscroll !== 1 && state.kscroll !== 2) {
      var screenX = p.ma - state.fx;
      // 触发阈值：屏幕宽度的 1/3 和 2/3 处（动态，适配镜头变宽后的 FXMAX）
      var leftTrigger  = C.FXMAX / 3;
      var rightTrigger = C.FXMAX * 2 / 3;
      // 右滚：玩家超过 2/3 屏幕宽时才推镜头（保留右边 1/3 缓冲）
      if (screenX > rightTrigger && state.fzx < state.scrollx) {
        var push = screenX - rightTrigger;
        state.fx  += push * C._DT;
        state.fzx += push * C._DT;
      }
      // 左滚：玩家退到 1/3 屏幕宽以下才拉镜头（保留左边 1/3 缓冲）
      if (screenX < leftTrigger && state.fzx > 700) {
        var pull = leftTrigger - screenX;
        state.fx  -= pull * C._DT;
        state.fzx -= pull * C._DT;
      }
    }
    if (state.fx < 0) state.fx = 0;
  }

  // ==================== 敌人绘制（供分层渲染复用）====================
  function drawEnemy(ctx, e) {
    xx[0] = e.aa - state.fx; xx[1] = e.ab - state.fy;
    if (xx[0] + e.anobia < -100 || xx[0] > C.FXMAX) return;
    var m = e.amuki === 1;
    if (e.atype < 200 && e.atype !== 6 && e.atype !== 79 && e.atype !== 91 && e.atype !== 85 && e.atype !== 86 && e.atype !== 30 && e.atype !== 87 && e.atype !== 88 && e.atype !== 82 && e.atype !== 83 &&
        !(e.atype === 80 && e.axtype === 1) && !(e.atype === 81 && e.axtype === 1)) {
      // 注：80+1（隐形鬼脸云，接触前不绘制）与 81+1（stealth 精灵 grap[130][3]）
      // 由下方专用分支处理，本通用分支必须跳过，否则会抢先用 grap[atype][3] 画出
      // 有垂直运动的敌人向下运动时垂直翻转精灵（180°镜像）
      // 白幽灵(atype=3)原版UI朝上，axtype=1天降时同样需垂直翻转180°
      var FLIP_ATYPES = { 9: true, 10: true, 80: true, 81: true, 82: true, 84: true };
      var dx = Math.floor(xx[0] / 100), dy = Math.floor(xx[1] / 100);
      if ((FLIP_ATYPES[e.atype] && e.ad > 0) || (e.atype === 3 && e.axtype === 1)) {
        var sp = S.get(e.atype, 3);
        if (sp && sp.img) {
          // 与 Sprites.draw 一致：高清资源走高质量平滑插值，像素图保持最近邻
          var hdFlip = sp.img.naturalWidth >= sp.w * 1.5 || sp.img.naturalHeight >= sp.h * 1.5;
          if (hdFlip) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; }
          var fdr = S.deviceRect ? S.deviceRect(ctx, dx, dy, sp.w, sp.h) : null;
          ctx.save();
          if (fdr) {
            // 设备像素对齐后的翻转（同 Sprites.draw 对齐路径）
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.translate(fdr.dx + fdr.dw / 2, fdr.dy + fdr.dh / 2);
            ctx.scale(1, -1);
            if (m) ctx.scale(-1, 1);
            ctx.drawImage(sp.img, -fdr.dw / 2, -fdr.dh / 2, fdr.dw, fdr.dh);
          } else {
            ctx.translate(dx + sp.w / 2, dy + sp.h / 2);
            ctx.scale(1, -1);
            if (m) ctx.scale(-1, 1);
            ctx.drawImage(sp.img, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
          }
          ctx.restore();
          if (hdFlip) { ctx.imageSmoothingEnabled = false; ctx.imageSmoothingQuality = 'low'; }
        } else { S.draw(ctx, e.atype, 3, dx, dy, m); }
      } else {
        S.draw(ctx, e.atype, 3, dx, dy, m);
      }
    } else if (e.atype === 30) {
      S.draw(ctx, e.axtype === 0 ? 30 : 155, 3, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
    } else if (e.atype === 82) {
      // 伪装成方块的敌人（原版 main.cpp:985-1001）：axtype=0 画地面顶(grap5)、
      // axtype=1 画楼梯块/内框块(grap4)、axtype=2 画 grap[1][5]，
      // 贴图随主题偏移（地下+30/城堡+60）；碰撞盒 30×30（ENEMY_SIZE[82]）
      var off82 = state.stagecolor === 2 ? 30 : (state.stagecolor === 4 ? 60 : 0);
      if (e.axtype === 2) S.draw(ctx, 1, 5, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      else S.draw(ctx, (e.axtype === 1 ? 4 : 5) + off82, 1, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
    } else if (e.atype === 83) {
      // 开花形态（原版 main.cpp:948 通用层 + 1002-1014 叠加层）：
      // ① 49×48 omake 白尖刺球(grap83,3)；② (x+10,y+9) 再盖一块 30×30 伪装方块，
      //    axtype=0→地面顶(grap5)、axtype=1→楼梯块(grap4)，主题偏移地下+30/城堡+60；
      //    刺球中心的紫/橙区域被方块盖住，仅四周白尖露出（1-2-1 e0「墙上长刺」）。
      //    82 致命接触变形时本体已左上移(-1000,-900)，叠加方块正好落在原格。
      var dx83 = Math.floor(xx[0] / 100), dy83 = Math.floor(xx[1] / 100);
      S.draw(ctx, 83, 3, dx83, dy83);
      var off83 = state.stagecolor === 2 ? 30 : (state.stagecolor === 4 ? 60 : 0);
      if (e.axtype === 0) S.draw(ctx, 5 + off83, 1, dx83 + 10, dy83 + 9);
      else if (e.axtype === 1) S.draw(ctx, 4 + off83, 1, dx83 + 10, dy83 + 9);
    } else if (e.atype === 79) {
      // 激光炮（stype103/104 隐形陷阱带生成的横向扁矩形，anobia×anobib≈120×15）：
      // 旧引擎 main.cpp:978-983 — 黄色填充矩形 + 黑色描边
      var dx79 = Math.floor(xx[0] / 100), dy79 = Math.floor(xx[1] / 100);
      var w79 = Math.floor(e.anobia / 100), h79 = Math.floor(e.anobib / 100);
      ctx.fillStyle = 'rgb(250, 250, 0)';
      ctx.fillRect(dx79, dy79, w79, h79);
      ctx.strokeStyle = '#000';
      ctx.strokeRect(dx79, dy79, w79, h79);
    } else if (e.atype === 91) {
      // 五重激光：5 道子激光合并为单一对象。主对象以中间激光速度(1600)移动，
      // 其余 4 道按 atm 计算偏移（旧引擎 main.cpp:3163-3170 速度表）
      var amukiSign91r = e.amuki === 0 ? -1 : 1;
      var sp91r = [1600, 1200, 1200, 900, 900];
      var vs91r = [0, -200, 200, -600, 600];
      var w91 = Math.floor(e.anobia / 100), h91 = Math.floor(e.anobib / 100);
      for (var li = 0; li < 5; li++) {
        var dxoff = amukiSign91r * (sp91r[li] - 1600) * e.atm;
        var dyoff = vs91r[li] * e.atm;
        var dx91 = Math.floor((xx[0] + dxoff) / 100);
        var dy91 = Math.floor((xx[1] + dyoff) / 100);
        ctx.fillStyle = 'rgb(250, 250, 0)';
        ctx.fillRect(dx91, dy91, w91, h91);
        ctx.strokeStyle = '#000';
        ctx.strokeRect(dx91, dy91, w91, h91);
      }
    } else if (e.atype === 6) {
      // 原版 main.cpp:931 setmirror 为全局状态，机器人分支（955-962）在镜像状态下绘制：
      // amuki=1（向右）时水平翻转精灵，与其他敌人一致；抱人姿态 id150 同样受镜像
      if ((e.atm >= 10 && e.atm <= 19) || (e.atm >= 100 && e.atm <= 119) || e.atm >= 200)
        S.draw(ctx, 150, 3, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100), m);
      else
        S.draw(ctx, 6, 3, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100), m);
    } else if (e.atype === 80 && e.axtype === 1) {
      // 隐形鬼脸云：接触前完全不绘制（旧引擎 main.cpp:949 对 80/81+axtype1 跳过普通绘制，
      // 且 stealth 绘制分支 973 只覆盖 81+1，故 80+1 无画面输出）
    } else if (e.atype === 81 && e.axtype === 1) {
      S.draw(ctx, 130, 3, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
    } else if (e.atype === 86) {
      var pl = state.player;
      var eid = (pl.ma >= e.aa - pl.mnobia - 4000 && pl.ma <= e.aa + e.anobia + 4000) ? 152 : 86;
      S.draw(ctx, eid, 3, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
    } else if (e.atype === 85) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(Math.floor(xx[0] / 100) + 10, Math.floor(xx[1] / 100), 10, Math.floor(e.anobib / 100));
      ctx.fillStyle = '#00fae0';
      ctx.beginPath(); ctx.arc(Math.floor(xx[0] / 100) + 14, Math.floor(xx[1] / 100), 10, 0, Math.PI * 2); ctx.fill();
    } else if (e.atype === 87 || e.atype === 88) {
      // 火焰棒旋转 — 参考旧引擎 main.cpp L1308-1334：
      // 间距 xx[26]=18px，球半径 xx[23]=8px，颜色(230,120,0)+黑色描边
      // atype 88 是水平镜像版本（cos 取反）
      var cx = Math.floor(xx[0] / 100), cy = Math.floor(xx[1] / 100);
      var cnt = e.axtype % 100;
      var sign = e.atype === 88 ? -1 : 1;
      for (var k = 0; k <= cnt; k++) {
        var ang = e.atm * Math.PI / 180 / 2;
        var dx = sign * k * 18 * Math.cos(ang);
        var dy = k * 18 * Math.sin(ang);
        ctx.fillStyle = 'rgb(230,120,0)';
        ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 8, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
      }
    } else if (e.atype === 200) {
      S.draw(ctx, 0, 3, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
    } else if (e.atype >= 200 && e._custom) {
      // 自定义敌人触发器渲染
      var cu = e._custom;
      if (!_customImgCache[cu.dataUrl]) {
        var im = new Image();
        im.src = cu.dataUrl;
        _customImgCache[cu.dataUrl] = im;
      }
      var im = _customImgCache[cu.dataUrl];
      if (im && im.complete && im.naturalWidth > 0) {
        var cdx = Math.floor(xx[0] / 100), cdy = Math.floor(xx[1] / 100);
        var cdw = cu.tw * 29, cdh = cu.th * 29;
        var cdr = S.deviceRect ? S.deviceRect(ctx, cdx, cdy, cdw, cdh) : null;
        if (cdr) {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(im, cdr.dx, cdr.dy, cdr.dw, cdr.dh);
          ctx.restore();
        } else {
          ctx.drawImage(im, cdx, cdy, cdw, cdh);
        }
      }
    }
  }

  // ==================== 渲染 ====================
  // 渲染包装：alpha 为累加器相位（距上一物理帧的时间比例 0~1），
  // 在前后两物理帧的镜头与玩家坐标之间线性插值后再绘制。
  // 物理/碰撞/触发永远只使用整数物理帧的 state（确定性不变），
  // 插值仅临时替换绘制期坐标，使世界滚动在 rAF 时序抖动下仍连续平滑。
  function render(ctx, alpha) {
    var logicFx = state.fx;
    var logicMa = state.player ? state.player.ma : 0;
    var logicMb = state.player ? state.player.mb : 0;
    var renderFx = logicFx;
    var renderMa = logicMa;
    var renderMb = logicMb;
    if (state.proc === C.PROC.GAME && alpha > 0 && alpha < 1 && !_camSnap && state.player) {
      var dFx = logicFx - _fxPrev;
      var dMa = logicMa - _playerPrev.ma;
      var dMb = logicMb - _playerPrev.mb;
      // 正常跟镜每帧仅数像素~数十像素；跨关/进管/复活已用 _camSnap 显式标记，
      // 位移阈值再兜底外部直接写 fx/ma 的情况
      if (Math.abs(dFx) < _CAM_SNAP_DIST) {
        renderFx = _fxPrev + dFx * alpha;
        state.fx = renderFx;
      }
      if (Math.abs(dMa) < _CAM_SNAP_DIST) {
        renderMa = _playerPrev.ma + dMa * alpha;
        state.player.ma = renderMa;
      }
      if (Math.abs(dMb) < _CAM_SNAP_DIST) {
        renderMb = _playerPrev.mb + dMb * alpha;
        state.player.mb = renderMb;
      }
      // 全实体与镜头/玩家同一 alpha 插值（敌人/升降台/粒子/砖块/管道）
      _interpList(state.enemies, 'aa', 'ab', alpha);
      _interpList(state.lifts, 'sra', 'srb', alpha);
      _interpList(state.particles, 'ea', 'eb', alpha);
      _interpList(state.blocks, 'ta', 'tb', alpha);
      _interpList(state.pipes, 'sa', 'sb', alpha);
    }
    _lastCamAlpha = alpha;
    _lastRenderFx = renderFx;
    try {
      renderScene(ctx);
    } finally {
      // 恢复逻辑坐标，保证物理帧永不读到插值
      state.fx = logicFx;
      if (state.player) {
        state.player.ma = logicMa;
        state.player.mb = logicMb;
      }
      _restoreList(state.enemies || [], 'aa', 'ab');
      _restoreList(state.lifts || [], 'sra', 'srb');
      _restoreList(state.particles || [], 'ea', 'eb');
      _restoreList(state.blocks || [], 'ta', 'tb');
      _restoreList(state.pipes || [], 'sa', 'sb');
    }
  }

  function renderScene(ctx) {
    // 关掉插值：所有 drawImage 用 nearest-neighbor
    // 高清 PNG → 缩到虚拟坐标 → setTransform 放大到屏幕
    // 两次 nearest 保证每个原始像素最终还是锐利大方块（Win10 图片查看器那种效果）
    ctx.imageSmoothingEnabled = false;

    // 等比例缩放：所有虚拟坐标乘 _baseScale 渲染到实际像素
    // 虚拟宽度 C.CANVAS_W 已由 resizeCanvas() 动态扩展（镜头变宽），
    // 画面本身不拉伸（X/Y 用同一个 _baseScale）
    ctx.setTransform(_baseScale, 0, 0, _baseScale, 0, 0);

    // 背景
    var bgColor = '#000';
    // 原版 stagecolor：1(地上)/3(空中) → setcolor(160,180,250) 蓝；2(地下)/4(城堡) → setcolor(10,10,10) 黑
    if (state.stagecolor === 1 || state.stagecolor === 3) bgColor = '#a0b4fa';
    if (state.stagecolor === 2 || state.stagecolor === 4) bgColor = '#0a0a0a';
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, C.CANVAS_W, C.CANVAS_H);

    if (state.proc === C.PROC.TITLE) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('猫 里 奥', C.CANVAS_W / 2, C.CANVAS_H / 2 - 40);
      ctx.font = '16px sans-serif';
      ctx.fillText('按任意键开始', C.CANVAS_W / 2, C.CANVAS_H / 2 + 20);
      // 0 随机模式：参考旧引擎 RAND_STAGE 宏，当前关卡内元素随机分布
      ctx.font = '14px sans-serif';
      ctx.fillStyle = state.randomMode ? '#ffd54a' : '#9aa4b8';
      ctx.fillText('按 0 随机元素：' + (state.randomMode ? '开' : '关'), C.CANVAS_W / 2, C.CANVAS_H / 2 + 48);
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.fillText('← → 移动   ↑/空格 跳跃   ↓ 进管道', C.CANVAS_W / 2, C.CANVAS_H / 2 + 76);
      return;
    }

    // 死亡画面（STAGE_START）：黑底 + 玩家图标 + 剩余生命
    if (state.proc === C.PROC.STAGE_START) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, C.CANVAS_W, C.CANVAS_H);
      // 玩家小图标 + 剩余生命数 居中显示
      var iconX = Math.floor(C.CANVAS_W / 2 - 40);
      var iconY = Math.floor(C.CANVAS_H / 2 - 12);
      S.draw(ctx, 0, 0, iconX, iconY);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(' x ' + (2 - state.life), iconX + 30, iconY + 15);
      return;
    }

    // 制作名单（staff roll）：黑底 + 19 行白字居中自下而上滚动
    if (state.proc === C.PROC.ENDING) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, C.CANVAS_W, C.CANVAS_H);
      ctx.fillStyle = '#fff';
      ctx.font = '16px "Microsoft YaHei", "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var ys = state._staffY || [];
      for (var ti = 0; ti < STAFF_TEXT.length; ti++) {
        var yp = ys[ti] != null ? ys[ti] / 100 : -9999;
        if (yp > -30 && yp < C.CANVAS_H + 30) {
          ctx.fillText(STAFF_TEXT[ti], C.CANVAS_W / 2, yp);
        }
      }
      return;
    }

    if (state.proc !== C.PROC.GAME) return;

    // 背景层（原版用 16000 单位的包围盒做剔除，避免宽元素被过早剔除）
    state.bg.forEach(function (n) {
      xx[0] = n.na - state.fx; xx[1] = n.nb - state.fy;
      if (xx[0] + 16000 >= -10 && xx[0] <= C.FXMAX &&
          xx[1] + 16000 >= -10 && xx[1] <= C.FYMAX) {
        // 剑结局文本覆盖层（ntype=101「恭喜通关」/102「感谢游玩」）
        if (n._endingText && (n.ntype === 101 || n.ntype === 102)) {
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 20px "Microsoft YaHei", "PingFang SC", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          var txt = (n.ntype === 101) ? '恭喜您通关了' : '感谢您体验我们的游戏';
          ctx.fillText(txt, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
        } else if (n.ntype === -1 && n._custom) {
          // 自定义背景装饰
          var cu = n._custom;
          if (!_customImgCache[cu.dataUrl]) {
            var im = new Image();
            im.src = cu.dataUrl;
            _customImgCache[cu.dataUrl] = im;
          }
          var im = _customImgCache[cu.dataUrl];
          if (im && im.complete && im.naturalWidth > 0) {
            ctx.drawImage(im, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100),
              cu.tw * 29, cu.th * 29);
          }
        } else {
          S.draw(ctx, n.ntype, 4, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
        }
      }
    });

    // 粒子
    state.particles.forEach(function (p) {
      xx[0] = p.ea - state.fx; xx[1] = p.eb - state.fy;
      if (p.egtype === 0) {
        S.draw(ctx, 0, 2, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (p.egtype === 1) {
        // 砖块碎片颜色随主题（原版 main.cpp 745-751：地上/空中=棕橙、地下=蓝、城堡=灰，带黑描边）
        var sc = state.stagecolor;
        ctx.fillStyle = (sc <= 1 || sc === 3) ? '#906030' : (sc === 2 ? '#0078a0' : '#c0c0c0');
        ctx.beginPath();
        ctx.arc(Math.floor(xx[0] / 100), Math.floor(xx[1] / 100), 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.stroke();
      } else if (p.egtype === 4) {
        // ポール（原版 main.cpp:762-771）：白杆+黑描边，顶端黄球——机器人拔起/抛出的终点杆
        var px = Math.floor(xx[0] / 100), py = Math.floor(xx[1] / 100), ph = Math.floor(p.enobib / 100);
        ctx.fillStyle = '#fff'; ctx.fillRect(px + 10, py, 10, ph);
        ctx.strokeStyle = '#000'; ctx.strokeRect(px + 10, py, 10, ph);
        ctx.fillStyle = '#fafa00';
        ctx.beginPath(); ctx.arc(px + 15, py, 10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.beginPath(); ctx.arc(px + 15, py, 10, 0, Math.PI * 2); ctx.stroke();
      }
    });

    // 升降台
    state.lifts.forEach(function (l) {
      if (l.sra < -8000000) return;   // 已消失（srsp=1 踩碎后）
      xx[0] = l.sra - state.fx; xx[1] = l.srb - state.fy;
      if (xx[0] + l.src < -10 || xx[0] > C.FXMAX + 120) return;
      var lx = Math.floor(xx[0] / 100), ly = Math.floor(xx[1] / 100), lw = Math.floor(l.src / 100);
      if (l.srsp >= 10 && l.srsp <= 14 && l.src >= 5000) {
        // 悬挂站台（原版 main.cpp:819-832）：棕色吊柱 + 30px 绿色台面，柱高=srh
        var lph = Math.floor(l.srh / 100);
        if (lw - 40 > 0 && lph > 0) {
          ctx.fillStyle = '#b4783c';
          ctx.fillRect(lx + 20, ly + 30, lw - 40, lph);
          ctx.strokeStyle = '#645014';
          ctx.strokeRect(lx + 20, ly + 30, lw - 40, lph);
        }
        ctx.fillStyle = '#00c800';
        ctx.fillRect(lx, ly, lw, 30);
        ctx.strokeStyle = '#00a000';
        ctx.strokeRect(lx, ly, lw, 30);
      } else {
        var lh = l.srsp === 1 ? 12 : 14;
        // 颜色：合并升降台读 l.color（预设名或自定义 rgba/hex）；原版 srsp 台反推（2=绿/21=灰/其余黄）
        var liftColorName = l.color || (l.srsp === 2 ? 'green' : l.srsp === 21 ? 'gray' : 'yellow');
        var liftHex = LIFT_COLOR_HEX[liftColorName];
        ctx.fillStyle = liftHex || (typeof l.color === 'string' && l.color ? l.color : LIFT_COLOR_HEX.yellow);
        ctx.fillRect(lx, ly, lw, lh);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.strokeRect(lx, ly, lw, lh);
        if (l.srsp === 15) {
          // srsp=15：台面三块砖（grap[0][1] = 砖块）
          for (var li = 0; li < 3; li++) S.draw(ctx, 1, 1, lx + li * 29, ly);
        }
      }
    });

    // 正从问号块/砖块中被顶出（abrocktm>0）的道具/敌人：先于方块绘制，
    // 让不透明方块遮挡其尚在砖块内的部分，只露出砖块上方，避免“顶出时透视”
    state.enemies.forEach(function (e) {
      if (e.abrocktm > 0) drawEnemy(ctx, e);
    });

    // 方块
    state.blocks.forEach(function (b) {
      if (b.ta < -800000) return;
      xx[0] = b.ta - state.fx; xx[1] = b.tb - state.fy;
      if (xx[0] < -3200 || xx[0] > C.FXMAX) return;
      var sheet = 1;
      var id = b.ttype;
      if (state.stagecolor === 2) id += 30;
      else if (state.stagecolor === 4) id += 60;
      if (b.ttype < 100) {
        S.draw(ctx, id, sheet, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (b.ttype === 800) {
        S.draw(ctx, 0, 2, Math.floor(xx[0] / 100) + 2, Math.floor(xx[1] / 100) + 1);
      } else if (b.ttype === 120) {
        S.draw(ctx, 16, 1, Math.floor(xx[0] / 100) + 3, Math.floor(xx[1] / 100) + 2);
      } else if (b.ttype === 300 || b.ttype === 301) {
        S.draw(ctx, 1, 5, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (b.ttype === 400) {
        S.draw(ctx, 2, 5, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (b.ttype === 100 || b.ttype === 101 || b.ttype === 102 || b.ttype === 103 || b.ttype === 104 || b.ttype === 105) {
        S.draw(ctx, 2 + (state.stagecolor === 2 ? 30 : (state.stagecolor === 4 ? 60 : 0)), 1, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (b.ttype === 110) {
        // 隐藏量产块（原版 main.cpp:1077-1087 无 110 绘制分支：1-1 b3 毒蘑菇量产即此类型）：
        // 默认隐形不绘制；showQ（编辑器"问号块+量产"的可见量产扩展）时显示问号块外观
        if (b.showQ) S.draw(ctx, 2 + (state.stagecolor === 2 ? 30 : (state.stagecolor === 4 ? 60 : 0)), 1, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (b.ttype === 112) {
        // 金币量产块未顶过：显示问号块外观（编辑器统一模型；原版为砖块外观）
        S.draw(ctx, 2 + (state.stagecolor === 2 ? 30 : (state.stagecolor === 4 ? 60 : 0)), 1, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (b.ttype === 111 || b.ttype === 113 || (b.ttype === 115 && b.txtype !== 1 && b.txtype !== 3)) {
        // 顶过后（量产中/已用）：已用块外观
        S.draw(ctx, 3 + (state.stagecolor === 2 ? 30 : (state.stagecolor === 4 ? 60 : 0)), 1, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (b.ttype === 115 && (b.txtype === 1 || b.txtype === 3)) {
        // 原版行 1080/1098：t115 txtype=1/3 与 112/104 同贴图
        S.draw(ctx, 1 + (state.stagecolor === 2 ? 30 : (state.stagecolor === 4 ? 60 : 0)), 1, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (b.ttype === 130) {
        S.draw(ctx, 10, 5, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (b.ttype === 131) {
        S.draw(ctx, 11, 5, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (b.ttype === 117 && b.txtype === 1) {
        S.draw(ctx, 4, 5, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (b.ttype === 117 && b.txtype >= 3) {
        S.draw(ctx, 3, 5, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (b.ttype === C.TTYPE.SWORD) {
        // 剣（剑）grap[12][5] = b2_sword.png
        S.draw(ctx, 12, 5, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (b.ttype === C.TTYPE.BLADE) {
        // 刀刃 grap[13][5] = b2_blade.png
        S.draw(ctx, 13, 5, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (b.ttype === C.TTYPE.PINEAPPLE) {
        // 菠萝雷 grap[14][5] = b2_pineapple.png
        S.draw(ctx, 14, 5, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      }
    });

    // 玩家
    var p = state.player;
    var pmx = p.ma - state.fx;
    var pmy = p.mb - state.fy;
    var mirror = p.mmuki === 0;
    if (p.mtype !== C.MTYPE.DEAD && p.mtype !== 1) {
      if (p.mzimen === 1) {
        S.draw(ctx, p.mact === 0 ? 0 : 1, 0, Math.floor(pmx / 100), Math.floor(pmy / 100), mirror);
      } else {
        S.draw(ctx, 2, 0, Math.floor(pmx / 100), Math.floor(pmy / 100), mirror);
      }
    } else if (p.mtype === 1) {
      S.draw(ctx, 41, 0, Math.floor(pmx / 100), Math.floor(pmy / 100));
    } else if (p.mtype === C.MTYPE.DEAD) {
      S.draw(ctx, 3, 0, Math.floor(pmx / 100), Math.floor(pmy / 100));
    }

    // 事件触发器可见形态（block_qball 绿问号球：未触发时显示，触发后消失）
    (state.eventTriggers || []).forEach(function (tr) {
      if (tr.fired || !tr.img) return;
      xx[0] = tr.ax - state.fx; xx[1] = tr.ay - state.fy;
      if (xx[0] + tr.aw < -10 || xx[0] > C.FXMAX) return;
      if (tr.img.indexOf('item_green_question') >= 0) {
        S.draw(ctx, 105, 3, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      }
    });

    // 敌人（顶出中的 abrocktm>0 已在方块之前绘制，此处跳过，避免透视）
    state.enemies.forEach(function (e) {
      if (e.abrocktm > 0) return;
      drawEnemy(ctx, e);
    });

    // 管道/墙体：放在玩家、敌人之后绘制（对应原版 main.cpp 的“描画上書き(土管)”），
    // 不透明绿色管体盖住正在进入/探出管道的玩家与敌人，避免透视
    state.pipes.forEach(function (s) {
      if (s.sa < -8000000) return;
      xx[0] = s.sa - state.fx; xx[1] = s.sb - state.fy;
      if (xx[0] + s.sc < -10 || xx[0] > C.FXMAX) return;
      var x = Math.floor(xx[0] / 100), y = Math.floor(xx[1] / 100);
      var w = Math.floor(s.sc / 100), h = Math.floor(s.sd / 100);
      var ptype = PT.get(s.stype);
      if (ptype && ptype.render) {
        ptype.render(ctx, s, x, y, w, h, state);
      }
    });

    // 台词气泡（玩家/敌人；居中提示块消息框在其后绘制）
    renderBubbles(ctx);

    // 调试状态文字（仅 CHEAT 模式显示，不显示 SCORE/POS）
    if (state.cheat) {
      ctx.fillStyle = '#ff4040';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('CHEAT ON (C to toggle)', 10, 20);
    }

    // 提示块消息框（原版 main.cpp ttmsg() 5870-5968）
    if (state.tmsgtype === 1 || state.tmsgtype === 2) {
      var bh = Math.floor(state.tmsgy / 100);
      ctx.fillStyle = '#000';
      ctx.fillRect(60, 40, 360, bh);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(60, 40, 360, bh);
    }
    if (state.tmsgtype === 2) {
      // 文本
      var lines = (state.hintTexts && state.hintTexts[state.tmsg]) ||
                  DEFAULT_HINT_TEXTS[state.tmsg] || [''];
      ctx.fillStyle = '#fff';
      ctx.font = '14px "Microsoft YaHei", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      for (var li = 0; li < lines.length; li++) {
        ctx.fillText(lines[li], 66, 46 + li * 24);
      }
    }
    if (state.tmsgtype === 3) {
      var fullH = Math.floor(((15 - 1) * 1200 + 1500) / 100);  // 183
      var ch = fullH - Math.floor(state.tmsgy / 100);
      if (ch > 0) {
        var cy = 40 + Math.floor(state.tmsgy / 100);
        ctx.fillStyle = '#000';
        ctx.fillRect(60, cy, 360, ch);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(60, cy, 360, ch);
      }
    }

    // 暂停遮罩（P 键切换，F 键单步）
    if (state.paused) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 0, C.CANVAS_W, C.CANVAS_H);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('已暂停', C.CANVAS_W / 2, C.CANVAS_H / 2 - 10);
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#c8d8ff';
      ctx.fillText('P 继续 ｜ F 单步下一帧', C.CANVAS_W / 2, C.CANVAS_H / 2 + 22);
    }
  }

  // ==================== 主循环 ====================
  function frame() {
    // 记录本物理帧开始前的镜头与玩家坐标，供渲染期在前后两物理帧间插值；
    // 同时清除上一帧的跳变标记（帧内/帧外的换关、进管、复活会重新置位）
    _camSnap = false;
    _fxPrev = state.fx;
    if (state.player) {
      _playerPrev.ma = state.player.ma;
      _playerPrev.mb = state.player.mb;
    }
    // 全实体快照：敌人/升降台/粒子/砖块/管道与镜头、玩家同一时基
    _snapSeq++;
    if (state.enemies) _snapList(state.enemies, 'aa', 'ab');
    if (state.lifts) _snapList(state.lifts, 'sra', 'srb');
    if (state.particles) _snapList(state.particles, 'ea', 'eb');
    if (state.blocks) _snapList(state.blocks, 'ta', 'tb');
    if (state.pipes) _snapList(state.pipes, 'sa', 'sb');
    var key = IN.get();
    _debugKey = key;
    _debugFrame++;

    if (state.proc === C.PROC.GAME) {
      // 台词气泡计时（不随提示块面板暂停而冻结，保证触发后可自然消散）
      tickBubbles();
      // 提示块消息状态机（原版 main.cpp 1450-1469）
      // tmsgtype: 0=隐藏, 1=展开中, 2=等待按键, 3=收起中
      if (state.tmsgtype > 0) {
        if (state.tmsgtype === 1) {
          state.tmsgy += 1200 * C._DT;
          state.tmsgtm -= C._DT;
          if (state.tmsgtm === 0) state.tmsgtype = 2;
        } else if (state.tmsgtype === 2) {
          if (key) { state.tmsgtype = 3; state.tmsgtm = 15; state.tmsgy = 0; }
        } else if (state.tmsgtype === 3) {
          state.tmsgy += 1200 * C._DT;
          state.tmsgtm -= C._DT;
          if (state.tmsgtm === 0) { state.tmsgtype = 0; state.tmsgy = 0; }
        }
      }
      if (state.proc === C.PROC.GAME && state.tmsgtype === 0) {
        // O 键自杀：仅在玩家存活时触发，复用死亡流程（含死亡动画/生命计数/事件日志）
        if (IN.consumeSuicide() && state.player.mtype !== C.MTYPE.DEAD && state.player.mhp > 0) {
          markHurt('suicide');
          state.player.mhp = 0;
        }
        updatePlayer(key);
        var p = state.player;
        if (key & 2 || p.mb > 40000 || _debugFrame <= 10) {
          _debugLog.push({ f: _debugFrame, key: key, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, before: true });
        }
        collideBlocks();
        collidePipes();
        collideLifts();
        // キー入力初期化（原版行 2694：帧末尾重置方向输入，使摩擦生效）
        state.player.actaon[0] = 0; state.player.actaon[4] = 0;
        var p2 = state.player;
        if (key & 2 || p2.mb > 40000 || _debugFrame <= 10) {
          _debugLog.push({ f: _debugFrame, key: key, ma: p2.ma, mb: p2.mb, mc: p2.mc, md: p2.md, mz: p2.mzimen, mt: p2.mtype, before: false });
        }
        updateTriggers();
        updateEventTriggers();
        updateEnemies();
        updateParticles();
        updateCamera();

        // 分数
        state.scorepos = Math.max(state.scorepos, state.player.ma);
        state.score = Math.floor(state.scorepos / 1000) * 100;
      }
    }

    if (state.proc === C.PROC.STAGE_START) {
      state.maintm += C._DT;
      if (state.maintm >= 30) {
        state.maintm = 0; state.proc = C.PROC.GAME;
        A.bgmChange(state.bgmId || 100);   // 进入游戏界面后才播放 BGM
      }
    }

    // 剑结局演出收尾：进入制作名单（staff roll）
    if (state.ending === 1) {
      state.ending = 0;
      state.proc = C.PROC.ENDING;
      state.maintm = 0;
      state._staffInit = false;
    }

    // スタッフロール（制作名单）：19 行文字自下而上滚动，BGM=PUYO(106)
    if (state.proc === C.PROC.ENDING) {
      state.maintm += C._DT;
      if (!state._staffInit) {
        state._staffInit = true;
        A.bgmChange(C.BGM.PUYO);
        // 原版 main.cpp:3795-3819：xx[12..30] 初始为各行 y 偏移（像素），
        // 叠加 (screenH-420) 后 ×100。画布恒为 420，偏移为 0。
        var staffBase = [460, 540, 590, 650, 700, 760, 810, 870, 920,
                         1000, 1050, 1100, 1180, 1230, 1360, 1410, 1540, 1590, 1800];
        state._staffY = staffBase.map(function (v) { return v * 100; });
      }
      // 按键快进：原版每帧 -=300
      var step = 100 * C._DT;
      if (key) step = 300 * C._DT;
      for (var sj = 0; sj < state._staffY.length; sj++) state._staffY[sj] -= step;
      // 最后一行滚出屏幕（<= -400）→ 回到标题
      if (state._staffY[18] <= -400) {
        state.proc = C.PROC.TITLE;
        state.maintm = 0;
        A.bgmStop();
      }
    }

    if (state.proc === C.PROC.TITLE) {
      state.maintm += C._DT;
      if (key) beginNewGame();
    }

    IN.endFrame();
  }

  function startGame() {
    state.player = createPlayer();
    state.fx = 0; state.fy = 0; state.fzx = 0;
    _camSnap = true;   // 标题开局/宿主换关：镜头重置，渲染吸附
    state.scorepos = 0; state.score = 0;
    loadStage();
    // BGM 延后到 STAGE_START 倒计时结束、真正进入 GAME 状态时才播放，
    // 避免死亡界面 / 剩余生命界面期间提前播放（main.cpp bgmchange 在 startGame 里，
    // 但原版 STAGE_START 显示剩余生命时 BGM 实际上等 proc 切换后才起）
  }

  // 标题画面开始新游戏（按键 / Engine.startGame 按钮共用）。
  function beginNewGame() {
    state.life = 0;   // 新游戏，重置死亡计数
    state.checkpoint = null;   // 新游戏，清空中间旗检查点
    state.warpSpawn = null;    // 新游戏，清空传送出生位置覆盖
    state._evFired = {};       // 新游戏，事件触发器重新待命
    state.proc = C.PROC.STAGE_START;
    state.maintm = 0;
    startGame();
  }

  // ==================== 公开接口 ====================
  var canvas, ctx2d;
  var _loopRunning = false;
  var _lastFrameTime = 0;
  var _accumulator = 0;
  var _PHYS_STEP = 1000 / C.FPS;     // 物理固定 timestep = 16.67ms（60Hz，C._DT=0.5 缩放原版30Hz常量）

  // ---- 渲染插值：消除 60Hz 物理 / rAF 不同步导致的"停-跳-停-跳"抖动 ----
  // rAF 时序 ±1-2ms 抖动会让某些 rAF 触发 0 个物理步（画面沿用上一帧），
  // 某些触发 2 个物理步（世界跳一格）。在前后两物理帧之间按 alpha 线性插值
  // 相机+玩家坐标，可让 rAF 抖动不可见。物理/碰撞永远读整数物理帧的 state。
  var _fxPrev = 0;                   // 上一物理帧开始时的镜头 fx
  var _playerPrev = { ma: 0, mb: 0 }; // 上一物理帧开始时的玩家坐标
  var _camSnap = false;              // 本物理帧发生关卡级镜头跳变（换关/进管/复活），渲染直接吸附
  var _CAM_SNAP_DIST = 100000;       // 兜底：帧间位移 >1000px 视为非连续跳变（外部直接写 fx/ma 时）
  var _lastCamAlpha = 0;             // 调试：最近一次渲染 alpha
  var _lastRenderFx = 0;             // 调试：最近一次实际绘制 fx

  // ---- 全实体渲染插值（敌人/升降台/粒子/砖块/管道）----
  // 逐实体快照字段 _px/_py/_ps：物理帧开始时记录坐标与快照序号，
  // 渲染期按与镜头/玩家相同的 alpha 插值，finally 中恢复逻辑坐标。
  // _ps 不等于当前序号 = 本物理帧新生成/跨关残留 → 直接吸附不插值；
  // 数组被 filter/重建、索引漂移均不影响（快照挂在实体对象上）。
  var _snapSeq = 0;
  function _snapList(list, f1, f2) {
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      o._px = o[f1]; o._py = o[f2]; o._ps = _snapSeq;
    }
  }
  function _interpList(list, f1, f2, alpha) {
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o._ps !== _snapSeq) continue;                 // 新生成实体吸附
      var dx = o[f1] - o._px, dy = o[f2] - o._py;
      if (Math.abs(dx) >= _CAM_SNAP_DIST || Math.abs(dy) >= _CAM_SNAP_DIST) continue; // 传送/事件位移吸附
      o._cx = o[f1]; o._cy = o[f2];                     // 逻辑坐标暂存（恢复用）
      o[f1] = o._px + dx * alpha;
      o[f2] = o._py + dy * alpha;
    }
  }
  function _restoreList(list, f1, f2) {
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o._cx === undefined) continue;                // 未被插值（新生成/跳变/非本帧）
      o[f1] = o._cx; o[f2] = o._cy;
      o._cx = undefined; o._cy = undefined;
    }
  }

  // 按住 F 连续单步：由引擎 rAF 驱动，不依赖系统 keyrepeat
  // （系统 repeat 会切换到最后按下的键，按住 F 再按方向键时 F repeat 停止，导致暂停下物理帧停摆、方向键"失灵"）
  var _stepHold = false;             // F 当前被按住
  var _stepHoldT0 = 0;               // F 按下时刻（用于 initial delay）
  var _stepAcc = 0;
  var _STEP_DELAY = 300;             // 按住 300ms 后开始连步（同系统 repeat 初延迟）
  var _STEP_RATE = 50;               // 连步间隔 50ms ≈ 20 步/秒

  // ---- 响应式：等比例缩放 + 镜头宽度可变 ----
  // 策略：
  //   1) 以画布高度为基准，取 baseScale = canvas.height / 420（等比例缩放所有虚拟坐标）
  //   2) 画布实际宽度除以 baseScale = virtW，作为虚拟宽度（可变，镜头宽度由宿主控制）
  //   3) 动态更新 C.CANVAS_W / C.FXMAX，使剔除 / 背景 / 精灵绘制覆盖新的虚拟宽度
  //   virtW 下限 = 420（CSS 宽=高，画面正方形），无上限（随页面宽度占满）
  var _BASE_CANVAS_W = C.CANVAS_W;
  var _BASE_CANVAS_H = C.CANVAS_H;
  var _BASE_FXMAX = C.FXMAX;
  var _baseScale = 1;       // 等比例缩放系数
  var _virtW = C.CANVAS_W;  // 当前虚拟宽度（420~..., 可变；420=与高度相等的正方形）

  function resizeCanvas() {
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var cssW = Math.max(10, Math.round(rect.width));
    var cssH = Math.max(10, Math.round(rect.height));
    var dpr = window.devicePixelRatio || 1;
    var newW = Math.floor(cssW * dpr);
    var newH = Math.floor(cssH * dpr);

    // 只在尺寸真正变化时才重设 canvas.width/height
    // （重设会清空 canvas 导致闪黑，所以必须节流）
    if (canvas.width === newW && canvas.height === newH) {
      // 即使尺寸没变也更新虚拟宽度（DPR/窗口变宽时 FXMAX 仍要刷新）
      _baseScale = newH / _BASE_CANVAS_H;
      _virtW = Math.max(_BASE_CANVAS_H, Math.round(newW / _baseScale));
      C.CANVAS_W = _virtW;
      C.FXMAX    = _virtW * 100;
      return;
    }

    canvas.width  = newW;
    canvas.height = newH;
    _baseScale = newH / _BASE_CANVAS_H;
    _virtW = Math.max(_BASE_CANVAS_H, Math.round(newW / _baseScale));
    C.CANVAS_W = _virtW;
    C.FXMAX    = _virtW * 100;
  }

  Engine.init = function (canvasEl) {
    canvas = canvasEl;
    ctx2d = canvas.getContext('2d');
    IN.init(canvas);
    A.init();
    state.proc = C.PROC.TITLE;
    S.init(function () {});

    // 响应式 resize
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // 调试快捷键
    window.addEventListener('keydown', function (e) {
      if (e.keyCode === 67) {                     // C: 作弊模式
        state.cheat = !state.cheat;
        if (state.cheat && state.player) {
          state.player.mhp = 1;
          state.player.mtype = 0;
        }
      }
      if (e.keyCode === 84) {                     // T: 陷阱可视化
        state._showTraps = !state._showTraps;
      }
      if (e.keyCode === 77) {                     // M: 静音
        A.mute();
      }
      if (e.keyCode === 80 && !e.repeat) {        // P: 暂停/继续（过滤按住重复触发）
        state.paused = !state.paused;
        if (state.paused) {
          _accumulator = 0;                       // 丢弃暂停前的残余 delta，防止恢复时跳帧
          A.bgmSuspend();
        } else {
          _stepHold = false;                      // 恢复时清掉可能残留的 F 连步状态
          A.bgmResume();
        }
      }
      if (e.keyCode === 70 && state.paused) {     // F: 暂停状态下单步推进一个物理帧（30fps 基准）
        A.unlock();
        if (!e.repeat) {                          // 单击立即走一帧（精确单步）
          frame();
          _stepHoldT0 = performance.now();
        }
        _stepHold = true;                         // 按住时由 loop() 以 _STEP_RATE 连步
      }
      if (e.keyCode === 32) {                     // Space: 加速（不再跳跃）
        state.speedup = true;
        e.preventDefault();
      }
      // 0（主键区 48 / 小键盘 96）：标题画面开关随机模式。
      // 参考旧引擎 TmpCatMarioEditor 标题画面数字键预选起始关（1..6），0=随机起始关。
      // 0 未映射到 keyState，不会触发"按任意键开始"；表单控件内不拦截。
      if ((e.keyCode === 48 || e.keyCode === 96) && !e.repeat &&
          state.proc === C.PROC.TITLE) {
        var tgt = e.target;
        var tag = tgt && tgt.tagName;
        var inControl = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tgt.isContentEditable;
        if (!inControl) state.randomMode = !state.randomMode;
      }
    });
    window.addEventListener('keyup', function (e) {
      if (e.keyCode === 32) {
        state.speedup = false;
        e.preventDefault();
      }
      if (e.keyCode === 70) {
        _stepHold = false;
      }
    });

    if (!_loopRunning) {
      _loopRunning = true;
      _lastFrameTime = performance.now();
      loop();
    }
  };

  function loop() {
    if (!_loopRunning) return;
    requestAnimationFrame(loop);

    var now = performance.now();
    var delta = now - _lastFrameTime;
    _lastFrameTime = now;
    // 防止标签页切回来后的巨大 delta
    if (delta > 500) delta = 500;

    // 暂停（P）：停止物理推进，但保持渲染（F 单步后画面即时更新）
    if (state.paused) {
      _accumulator = 0;
      // 按住 F：超过初延迟后由引擎持续连步（方向键照常读取，可边步进边操作）
      if (_stepHold && now - _stepHoldT0 >= _STEP_DELAY) {
        _stepAcc += delta;
        while (_stepAcc >= _STEP_RATE) {
          _stepAcc -= _STEP_RATE;
          A.unlock();
          frame();
        }
      } else {
        _stepAcc = 0;
      }
      resizeCanvas();
      render(ctx2d, 0);
      return;
    }

    // 加速倍率：按住空格时物理跑 2 倍
    var speedMult = state.speedup ? 2 : 1;
    _accumulator += delta * speedMult;

    // 固定 timestep 物理更新（原版 30FPS 基准）
    while (_accumulator >= _PHYS_STEP) {
      A.unlock();
      frame();
      _accumulator -= _PHYS_STEP;
    }

    // 每帧重新同步画布虚拟尺寸（窗口 / DPR 变化即时生效）
    resizeCanvas();

    // 渲染插值：alpha = 累加器相位（距上一物理帧的时间比例 0~1），
    // 镜头与玩家在前后两物理帧之间线性插值。60Hz 屏呈现物理帧→中点→物理帧
    // 的均匀步进；rAF 时序抖动下也连续平滑，不再出现"停-跳-停-跳"。
    var camAlpha = _accumulator / _PHYS_STEP;
    if (camAlpha > 1) camAlpha = 1;
    if (camAlpha < 0) camAlpha = 0;
    render(ctx2d, camAlpha);
  }

  var _debugKey = 0, _debugFrame = 0;
  var _debugLog = [];
  // 记录最近一次伤害来源（uid=编辑器元素实例 id），死亡时输出，串联“编辑器元素↔游戏内死亡”
  // detail：可选补充信息（如敌人 atype/axtype），死亡时转成中文原因
  function markHurt(reason, uid, detail) {
    state._lastHurt = { reason: reason, uid: uid || null, f: _debugFrame, detail: detail || null };
  }

  // ===== 阵亡 / 通关事件日志（供试玩页“日志”面板展示，与底层 _debugLog 调试流分离）=====
  var _eventLog = [];
  var EVENT_LOG_MAX = 100;
  function pushEvent(ev) {
    ev.ts = Date.now();
    _eventLog.push(ev);
    if (_eventLog.length > EVENT_LOG_MAX) _eventLog.shift();
  }
  // 伤害原因 → 中文（与各 markHurt 调用点一一对应）
  var HURT_REASON_CN = {
    'trap-pipe': '陷阱管道：进入伪装管道，被带到高空后抛下',
    'trap-pipe-msg': '陷阱管道：进入死路管道（旧引擎 sxtype=2/5 即死管）',
    'pipe-eject': '喷出管道：进入后从管口被喷出',
    'out-of-world': '坠入深渊：掉出地图底部',
    'spike': '尖刺：撞上地刺',
    'fatigue-lift': '疲劳升降台：站台停留过久失控坠落',
    'firebar': '火焰棒：被旋转火球烧到',
    'enemy': '敌人碰撞',
    'flower': '火焰花：碰到伤人火花',
    'poison-mushroom': '毒蘑菇：吃下紫毒蘑菇',
    'bad-star': '坏星：碰到恶魔星',
    'fall-brick': '坠落砖组：被运动中的砖组砸中',
    'jump-pad': '弹簧跳台：被弹飞出世界顶部',
    'suicide': '自杀：按 O 键主动结束生命',
    'unknown': '未知原因'
  };
  // 敌人 atype → 中文名（atype 即触发器 btype，见 spawnEnemy）
  var ENEMY_NAME_CN = {
    0: '白猫怪', 1: '绿龟', 2: '龟壳', 3: '幽灵', 4: '国王怪',
    5: '吐舌猫', 6: '机器人', 7: '弹簧白猫', 8: '奔跑怪', 9: '弹跳火焰',
    10: '横向火焰', 30: '小猫咪', 31: '肌肉鸡',
    79: '大脸怪',
    80: '鬼脸云怪', 81: '鬼脸云怪(现形)', 82: '伪装方块怪', 83: '刺球', 84: '火球',
    85: '假旗杆', 86: '桃色方块猫', 87: '火焰棒', 90: '黄色光束',
    101: '火花', 102: '紫毒蘑菇', 105: '绿问号球', 110: '恶星'
  };
  Engine.getState = function () {
    return { proc: state.proc, key: _debugKey, frame: _debugFrame, maintm: state.maintm, blocks: state.blocks.length, fx: state.fx, collideCount: _debugCollideCount, collideTop: _debugCollideTop, player: state.player ? { ma: state.player.ma, mb: state.player.mb, mc: state.player.mc, md: state.player.md, mzimen: state.player.mzimen, mhp: state.player.mhp, mtype: state.player.mtype } : null };
  };
  // 调试用：暴露内部 state（含 pipes/player 完整字段），供自动化验证使用
  Engine._rawState = function () { return state; };
  // 调试用：镜头+玩家插值观测（逻辑 fx / 上一物理帧 fx / 跳变标记 / 本次渲染相位 alpha / 实际绘制 fx / 玩家 prev-ma/curr-ma）
  Engine._camDebug = function () {
    return {
      fx: state.fx, prev: _fxPrev, snap: _camSnap,
      alpha: _lastCamAlpha, renderFx: _lastRenderFx,
      playerPrev: _playerPrev.ma,
      playerCurr: state.player ? state.player.ma : 0
    };
  };

  Engine.debugBlocks = function (xMin, xMax) {
    var result = [];
    var p = state.player;
    state.blocks.forEach(function (b, i) {
      var show = (xMin === undefined) ? (i < 10 || b.ttype === 5 || b.ttype === 6) : (b.ta >= xMin && b.ta <= xMax);
      if (show) {
        result.push({ i: i, ta: b.ta, tb: b.tb, ttype: b.ttype });
      }
    });
    return { total: state.blocks.length, sample: result, playerX: p ? p.ma : 0, playerY: p ? p.mb : 0 };
  };

  Engine.getDebugLog = function () {
    var output = '';
    _debugLog.forEach(function (e) {
      var tag = e.before ? ' [before]' : ' [after ]';
      if (e.death) tag += ' [DEATH]';
      if (e.mhpChange) tag += ' [MHP]';
      if (e.mtypeChange) tag += ' [MTYPE]';
      if (e.mhpDmg) tag += ' [DMG:' + (e.reason || '?') + ']';
      if (e.spawn) tag += ' [SPAWN]';
      output += 'f=' + e.f + tag + ' key=' + e.key + ' ma=' + e.ma + ' mb=' + e.mb + ' mc=' + e.mc + ' md=' + e.md + ' mz=' + e.mz + ' mt=' + e.mt;
      if (e.uid !== undefined && e.uid) output += ' uid=' + e.uid;
      if (e.hurt) output += ' hurt=' + e.hurt.reason + (e.hurt.uid ? ':' + e.hurt.uid : '');
      if (e.atype !== undefined) output += ' atype=' + e.atype + ' eaa=' + e.aa + ' eab=' + e.ab;
      if (e.ta !== undefined) output += ' bta=' + e.ta + ' btb=' + e.tb;
      if (e.mtm !== undefined) output += ' mtm=' + e.mtm;
      if (e.mhp !== undefined) output += ' mhp=' + e.mhp;
      if (e.prevMhp !== undefined) output += ' prev=' + e.prevMhp;
      if (e.prevMtype !== undefined) output += ' prevMt=' + e.prevMtype;
      output += '\n';
    });
    return output;
  };

  // 阵亡/通关事件日志：返回事件数组的副本（按时间正序）
  // 事件结构：{kind:'death', n, f, reason, reasonCn, uid, ma, mb, ts}
  //          {kind:'goal', via:'pole'|'warp', f, uid, ma, mb, ts}
  Engine.getEventLog = function () { return _eventLog.slice(); };
  Engine.clearEventLog = function () { _eventLog.length = 0; };

  Engine.debugPipes = function () {
    var result = [];
    state.pipes.forEach(function (s, i) {
      if (s.sa >= 0 && s.sa <= 30000) {
        result.push({ i: i, sa: s.sa, sb: s.sb, sc: s.sc, sd: s.sd, stype: s.stype });
      }
    });
    return result;
  };

  Engine.debugEnemies = function () {
    var result = [];
    var p = state.player;
    for (var i = 0; i < state.max_enemy; i++) {
      var e = state.enemy[i];
      if (e.stype !== 0 || e.stime > 0) {
        result.push({ i: i, atype: e.atype, stype: e.stype, sx: e.sx, sy: e.sy, zx: e.zx, zy: e.zy, zc: e.zc, stime: e.stime, zt: e.zt, hp: e.hp });
      }
    }
    return { count: result.length, enemies: result, player: p ? { ma: p.ma, mb: p.mb, mtype: p.mtype, mhp: p.mhp } : null };
  };

  Engine.startGame = function () {
    beginNewGame();            // 与标题按键开局同一入口（含 0 随机起始关）
    _debugFrame = 0;
  };

  // 回到标题画面（试玩页"回到标题"按钮用）
  Engine.backToTitle = function () {
    state.proc = C.PROC.TITLE;
    state.maintm = 0;
    state.checkpoint = null;
    state.warpSpawn = null;
    A.bgmStop();
  };

  // 传送管道口钩子：玩家进入 stype=60 管道、沉管动画结束时调用 fn(warp)。
  // warp = {end:true} 或 {id:'世界id'}；fn 返回 false 表示宿主自行处理结局（引擎不重载关卡）。
  Engine.setWarpHandler = function (fn) { state.onWarp = fn; };

  // 传送出生位置覆盖：宿主在 onWarp 回调内、startGame 重载前调用。
  // sp = {x,y}（编辑器像素口径）或 {ma,mb}（世界坐标），persist=true 死亡复活保留（永远修改），
  // false/省略 仅本次 loadStage 生效（单次修改）；传 null 清除覆盖。
  Engine.setWarpSpawn = function (sp) { state.warpSpawn = sp; };

  // 通关去向钩子：玩家碰到终点旗杆通关后调用 fn(nextLevel)。
  // nextLevel = {end:true} 或 {id:'世界id'} 或 null（默认下一关）；
  // fn 返回 false 表示宿主自行处理结局（引擎不重载关卡），返回 true 让引擎继续重载。
  Engine.setGoalNextHandler = function (fn) { state.onGoalNext = fn; };

  // 调试：访问内部状态
  Engine._state = state;

  // 调试/自动化：手动推进一个物理帧（30fps 基准，不驱动渲染）。
  // 自动化浏览器在后台标签会冻结 requestAnimationFrame，可用定时器按 33ms 调用本接口
  // 获得确定性物理；正常游戏由内部 rAF accumulator 驱动，勿在外部重复调用。
  Engine._stepFrame = function () { frame(); };

  // 切换物理刷新率（30/60/120，默认 60）
  // 注意：120Hz 在 60Hz 屏上可能出现步进感（渲染插值已移除）。
  // 跳跃/坠落轨迹跨帧率一致（hd39：重力补偿 + boost 阈值 7+DT 对齐偏移 3.0）
  Engine.setFps = function (fps) {
    if (fps !== 30 && fps !== 60 && fps !== 120) return;
    C.FPS = fps;
    C._DT = 30 / fps;
    _PHYS_STEP = 1000 / fps;
    _accumulator = 0;       // 切换时丢弃残余 delta，避免立刻补帧导致跳变
  };
  Engine.getFps = function () { return C.FPS; };

  global.GameEngine = Engine;
})(window);
