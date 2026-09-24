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
      actaon: [0, 0, 0, 0, 0]      // [左右, 跳, 跳按住, 下, 左右方向]
    };
  }

  // 自定义元素图片缓存（dataUrl → Image）
  var _customImgCache = {};

  // ==================== 关卡加载 ====================
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
    for (var tt = 0; tt <= 1000; tt++) {
      for (var t = 0; t <= 16; t++) {
        var v = grid[t][tt];
        if (v === 0) continue;
        var wx = tt * 29 * 100;
        var wy = (t * 29 - 12) * 100;
        var uid0 = guids ? (guids[t][tt] || null) : null;
        if (v >= 1 && v <= 19 && v !== 9) {
          state.blocks.push({ ta: wx, tb: wy, ttype: v, txtype: 0, thp: 0, titem: 0, uid: uid0 });
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
          state.blocks.push({ ta: wx, tb: wy, ttype: 800, txtype: 0, thp: 0, titem: 0, uid: uid0 });
        } else if (v === 99) {
          state.pipes.push({ sa: wx, sb: wy, sc: 3000, sd: (12 - t) * 3000, stype: 300, sxtype: 0, sgtype: 0, sr: 0, uid: uid0 });
        }
      }
    }

    // 特殊方块
    // followJump（跳跃跟随，解耦属性）：跟随逻辑见 collideBlocks，任何 ttype 均可配置；
    // 显式 followJump 优先，原版 ttype=100/xt=0（1-1 b0 逃跑问号砖）未携带属性时自动迁移
    def.blocks.forEach(function (b) {
      state.blocks.push({
        ta: b.x * 100, tb: b.y * 100, ttype: b.type, txtype: b.xt || 0, thp: 0, titem: 0,
        followJump: (b.followJump != null) ? !!b.followJump : (b.type === 100 && (b.xt || 0) === 0),
        uid: b.uid || null
      });
    });

    // 管道
    var _fbCreated = [];   // stype=51 砖组创建记录（原版连锁自动接线用）
    def.pipes.forEach(function (p) {
      var pipe = { sa: p.sa, sb: p.sb, sc: p.sc, sd: p.sd, stype: p.stype, sxtype: p.sxtype || 0, sgtype: 0, sr: 0, uid: p.uid || null };
      if (p.stype === 51) _fbCreated.push({ p: p, pipe: pipe });
      // stype=105 通用陷阱：保留方向(dir) + 目标对象(target) + 生成个数(count)
      if (p.stype === 105) { pipe.dir = p.dir || 'down'; pipe.target = p.target || 'enemy_ghost'; pipe.count = Math.max(1, Math.min(12, p.count | 0 || 1)); }
      // stype=60 传送管道口：保留传送目标 {end,id}
      if (p.warp) pipe.warp = { end: !!p.warp.end, id: p.warp.id || null };
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
      state.pipes.push(pipe);
    });

    // 原版 1-2-1 连锁崩塌桥自动接线（无显式 chain 的 sxtype=1/2）：
    // 按管线顺序（=旧引擎 sa[] 数组顺序）sxtype=1 → 首个 sxtype=0 砖组、sxtype=2 → 首个 sxtype=1 砖组。
    // 接线后走旧引擎连锁语义（监视目标绝对高度 sb>=25000/48000 + 玩家位置/存活条件），
    // 未找到目标则保持 delay 兜底（靠近触发）。
    (function () {
      for (var wi = 0; wi < _fbCreated.length; wi++) {
        var w = _fbCreated[wi];
        if (w.p.chain) continue;
        var sx = w.p.sxtype || 0;
        if (sx !== 1 && sx !== 2) continue;
        var want = (sx === 1) ? 0 : 1;
        for (var wj = 0; wj < _fbCreated.length; wj++) {
          var c = _fbCreated[wj];
          if (c === w || (c.p.sxtype || 0) !== want) continue;
          if (!c.pipe.uid) c.pipe.uid = '_fb' + wj;   // 原版数据无 uid，补内部编号
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
      // followJump（跳跃跟随，解耦属性）：显式优先；原版 atype=4/axtype=1（尖刺馒头怪跟随跳）
      // 未携带属性时自动迁移，保持原版行为不变
      var followJump = (e.followJump != null) ? !!e.followJump : (e.btype === 4 && (e.bxtype || 0) === 1);
      var trig = { ba: e.ba, bb: e.bb, btype: e.btype, bxtype: e.bxtype || 0, bdir: e.bdir || null, bz: 1, btm: 0, spawned: false, uid: e.uid || null, followJump: followJump };
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
      state.eventTriggers.push({
        ax: t.ax, ay: t.ay, aw: t.aw, ah: t.ah,
        uid: t.uid || null,
        img: t.img || null,
        events: Array.isArray(t.events) ? t.events : [],
        fired: !!(t.uid && state._evFired[t.uid])
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
        srh: l.srh || 48000, uid: l.uid || null
      });
    });

    // 自定义关卡 BGM（试玩页注入；默认地上 100）
    state.bgmId = def.bgm || 100;
    // 通关后去向 & 提示文本（关卡级配置）
    state.nextLevel = def.nextLevel || null;
    state.hintTexts = def.hintTexts || null;

    // 出生点：
    //  - 若已触碰中间旗（state.checkpoint），死亡复活时从旗子位置出生
    //  - 否则使用 def.spawn：
    //      原版抽取关卡 def.spawn={ma,mb}：与玩家世界坐标同系，直接放置
    //      自定义关 def.spawn={x,y}：编辑器像素口径，沿用 +200/(-30) 转换
    // 进关直接把玩家放到出生点并把镜头居中，远端出生不再依赖首帧相机追赶
    if (state.player) {
      if (state.checkpoint) {
        state.player.ma = state.checkpoint.ma;
        state.player.mb = state.checkpoint.mb;
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
      amsgtm: 0, amsgtype: 0,
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
          if (tp) {
            if (p.mtm === 23) tp.sa -= 100;
            if (p.mtm >= 44 && p.mtm <= 60) tp.sa += (p.mtm % 2 === 0) ? 200 : -200;
            if (p.mtm >= 61 && p.mtm <= 77) tp.sa += (p.mtm % 2 === 0) ? 400 : -400;
            if (p.mtm >= 78 && p.mtm <= 94) tp.sa += (p.mtm % 2 === 0) ? 600 : -600;
            if (p.mtm >= 110) {
              tp.sb -= p.mzz * C._DT;
              p.mzz += 80 * C._DT;
              if (p.mzz > 1600) p.mzz = 1600;
            }
          }
          if (p.mtm === 160) {
            markHurt('trap-pipe', p._trapPipe ? p._trapPipe.uid : null);
            p._trapPipe = null; p.mtype = 0; p.mhp--;
            _debugLog.push({ f: _debugFrame, key: key, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, before: true, mhpDmg: true, reason: 'pipe-exit', uid: state._lastHurt ? state._lastHurt.uid : null });
          }
        } else {
          p.mc = 0; p.md = 0;
          if (p.mtm <= 16) { p.ma += sinkDx; p.mb += sinkDy; }
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
            } else {
              state.stc++;   // 普通进管：进入下一子关
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
    }

    // 移动
    if (p.mkeytm >= 1) p.mkeytm -= C._DT;
    p.ma += p.mc * C._DT; p.mb += p.md * C._DT;
    if (p.mc < 0) p.mactp += -p.mc * C._DT;
    else p.mactp += p.mc * C._DT;
    if (p.mtype <= 9 || p.mtype === C.MTYPE.DEAD || p.mtype === C.MTYPE.GOAL_SLIDE) {
      // 帧率一致性补偿：匀加速下显式欧拉（先位移后加重力）的位移误差 = -g·T·DT/2，
      // 30Hz(DT=1) 为原版手感基准（误差率最大），非 30Hz 补回 g·DT·(1-DT)/2，
      // 使跳跃/坠落轨迹与 30Hz 逐帧一致（DT=1 时补偿=0，30Hz 行为分毫不变）
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
      if (p.mtype <= 9) {
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
    if (p.mb >= 52000 && p.mhp >= 0) { markHurt('out-of-world', null); p.mhp = -2; }

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
              if (b.ttype !== 115 && b.ttype !== 400 && b.ttype !== 117 && b.ttype !== 120) {
                _debugCollideTop++;
                p.mb = xx[9] - p.mnobib + 100; p.md = 0; p.mzimen = 1; xx[16] = 1;
              } else if (b.ttype === 115) {
                A.playSE(C.SE.BLOCK_BREAK);
                spawnParticle(b.ta + 1200, b.tb + 1200, 300, -1000, 0, 160, 1000, 1000, 1, 120);
                spawnParticle(b.ta + 1200, b.tb + 1200, -300, -1000, 0, 160, 1000, 1000, 1, 120);
                b.ta = -800000;
              } else if (b.ttype === 400) {
                p.md = 0; b.ta = -8000000; A.playSE(13);
                state.blocks.forEach(function (bb) { if (bb.ttype !== 7) bb.ttype = 800; });
                A.bgmStop();
              } else if (b.ttype === 117) {
                A.playSE(14); p.md = -1500; p.mtype = C.MTYPE.NOTE; p.mtm = 0;
              } else if (b.ttype === 120) {
                p.md = -2400; p.mtype = C.MTYPE.JUMP_PAD; p.mtm = 0;
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
                if (b.ttype === 1 && p.mzimen === 0) {
                  A.playSE(C.SE.BLOCK_BREAK);
                  spawnParticle(b.ta + 1200, b.tb + 1200, 300, -1000, 0, 160, 1000, 1000, 1, 120);
                  spawnParticle(b.ta + 1200, b.tb + 1200, -300, -1000, 0, 160, 1000, 1000, 1, 120);
                  b.ta = -800000;
                }
                if (b.ttype === 2 && p.mzimen === 0) {
                  A.playSE(C.SE.COIN);
                  spawnParticle(b.ta + 10, b.tb, 0, -800, 0, 40, 3000, 3000, 0, 16);
                  b.ttype = 3;
                }
                if (b.ttype === 7) {
                  A.playSE(C.SE.COIN);
                  spawnParticle(b.ta + 10, b.tb, 0, -800, 0, 40, 3000, 3000, 0, 16);
                  p.mb = xx[9] + xx[1] + xx[0]; b.ttype = 3;
                  if (p.md < 0) p.md = -p.md * 2 / 3;
                }
                if (b.ttype === 10) { p.mmsgtm = 30; p.mmsgtype = 3; markHurt('spike', b.uid); p.mhp--; _debugLog.push({ f: _debugFrame, key: _debugKey, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, before: true, mhpDmg: true, reason: 'ttype10', uid: b.uid, ta: b.ta, tb: b.tb }); }
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
            // 问号块出P开关（编辑器统一问号块新增）：原地变成P开关块(400)，站上去触发
            A.playSE(8); b.ttype = 400;
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

      // 通过注册表查询该类型的实体性
      if (PT.isSolid(s.stype) && p.mtype < 10) {
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

      switch (l.sracttype) {
        case 1: if (l.sron === 1) l.srf = 60; break;            // 踩上即加速下坠
        case 5:                                                  // 纵向循环（1-2-1）
          l.srmuki = (l.srmove === 0) ? 0 : 1;
          if (l.srb < -2100) l.srb = C.FYMAX + 2000;
          if (l.srb > C.FYMAX + 2000) l.srb = -2100;
          break;
        case 6: if (l.sron === 1) l.srf = 40; break;
      }

      if (p.mtype < 10 && p.mhp >= 1) {
        // 站立吸附窗口：脚底在台面下方 1200 世界单位内（下落速度大时放宽 900+md）
        var win = 1200;
        if (p.md >= 100) win = 900 + p.md;
        if (p.md > win) win = p.md + 100;

        if (p.ma + p.mnobia > l.sra + 500 && p.ma < l.sra + l.src - 500 &&
            p.mb + p.mnobib > oldSrb && p.mb + p.mnobib < oldSrb + win && p.md >= -100) {
          // 先吸附到旧台底（脚=旧台底+100），再随台移动 sre → 脚=新台底+100，紧贴不嵌入
          p.mb = oldSrb - p.mnobib + 100;
          if (l.srsp !== 12) { p.mzimen = 1; p.md = 0; }
          else { p.md = -800; }                               // srsp=12 打滑台

          // 踩上触发下坠
          if (l.sracttype === 1 && l.sron === 0) l.sron = 1;
          // 下坠/循环台带着玩家一起动（oldSre×DT 是台本帧实际位移，脚=新台底+100）
          if ((l.sracttype === 1 && l.sron === 1) || l.sracttype === 3 || l.sracttype === 5) {
            p.mb += oldSre * C._DT;
          }

          if (l.srsp === 1) {
            // 易碎台：音效 + 两片碎块 + 消失
            A.playSE(3);
            spawnParticle(l.sra + 200, l.srb - 1000, -240, -1400, 0, 160, 4500, 4500, 1, 120);
            spawnParticle(l.sra + l.src - 200, l.srb - 1000, 240, -1400, 0, 160, 4500, 4500, 1, 120);
            l.sra = -70000000;
          }

          if (l.srsp === 2) {
            // 绿色疲劳台：弹飞玩家，连续站立 100 帧阵亡
            p.mc = -2400;
            l.srmove += C._DT;
            if (l.srmove >= 100) { markHurt('fatigue-lift', l.uid); p.mhp = 0; l.srmove = -5000; }
          }
        }

        // 疲劳计时：未被弹飞且不在台上时逐帧回退
        if (l.srsp === 2 && p.mc !== -2400 && l.srmove > 0) l.srmove -= C._DT;

        // srsp=11：靠近即自动下坠（无原版数据，编辑器也不产生，保留行为一致）
        if (l.srsp === 11) {
          if (p.ma + p.mnobia > l.sra - 1500 && p.ma < l.sra + l.src - 500) l.sron = 1;
          if (l.sron === 1) { l.srf = 60; l.srb += l.sre * C._DT; }
        }
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
          }
        }
      }
    }
  }

  // ==================== 事件触发器（编辑器 trap_event / block_qball）====================
  // 玩家 AABB 与触发区重叠即按顺序执行动作；每个触发器每关一次（fired，
  // 检查点复活不重置，换关/新游戏随关卡重载清空）
  function updateEventTriggers() {
    var list = state.eventTriggers;
    if (!list || !list.length) return;
    var p = state.player;
    for (var i = 0; i < list.length; i++) {
      var tr = list[i];
      if (tr.fired) continue;
      // 镜头窗口门控（与管道连锁检查同款条件）：视野外不检测
      if (tr.ax - state.fx + tr.aw < -12000 || tr.ax - state.fx > C.FXMAX) continue;
      // 玩家 AABB 重叠
      if (p.ma + p.mnobia <= tr.ax || p.ma >= tr.ax + tr.aw ||
          p.mb + p.mnobib <= tr.ay || p.mb >= tr.ay + tr.ah) continue;
      tr.fired = true;
      if (tr.uid) state._evFired[tr.uid] = true;
      runEvents(tr);
    }
  }

  // 顺序执行动作列表（se=播音效 / spawn=按偏移生成对象 / setprop=改目标属性 /
  // move=平移目标；target uid 找不到时跳过该动作）
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
          obj[ev.field || 'txtype'] = ev.value | 0;
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
          if (e.followJump && Math.abs(p.ma + p.mnobia - xx[0] - 500) < 9000 && p.md <= -600 && e.atm <= 0) {
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
          if (e.followJump && Math.abs(p.ma + p.mnobia - xx[0] - 500) < 9000 && p.md <= -600 && e.atm <= 0) {
            if (p.mzimen === 0 && e.axzimen === 1) {
              e.ad = -1600; e.atm = 40; e.ab -= 1000;
            }
          }
          break;
        case 5: xx[10] = 160; break;
        case 6:
          // デフラグさん（方块机器人）：原版 main.cpp:3035-3085
          xx[10] = 120;   // 平时贴地行走速度
          if (e.atm >= 10) {
            e.atm += C._DT;
            if (p.mhp >= 1) {
              // 抓住玩家期间（atm 11~19）：把玩家锁在头顶（ab 上方 30px），机器人停步
              if (e.atm <= 19) { p.ma = e.aa; p.mb = e.ab - 3000; p.mtype = C.MTYPE.NORMAL; }
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
          // 他の敵を投げる：碰到道具类敌人(atype>=100)时举过头顶再抛出
          // （abrocktm=120：先上升 20 帧，到 100 时按通用逻辑 ad=-1200/ac=700 弹出）
          for (var ri = 0; ri < state.enemies.length; ri++) {
            var re = state.enemies[ri];
            if (re === e || re.aa < -800000 || re.atype < 100) continue;
            if (e.aa + e.anobia > re.aa + 500 && e.aa < re.aa + re.anobia - 500 &&
                e.ab + e.anobib > re.ab - 800 &&
                e.ab + e.anobib < re.ab + 6300) {
              re.amuki = 1; re.aa = e.aa + 300; re.ab = e.ab - 3000; re.abrocktm = 120;
              e.atm = 200; e.amuki = 1;
            }
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
          e.azimentype = 0; xx[10] = 1600;
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
        if (p.mmutekitm <= 0 && (e.atype <= 99 || e.atype >= 200)) {
          if (p.mmutekion !== 1 && p.mtype !== C.MTYPE.DEAD) {
            if ((e.atype !== 2 || e.axtype !== 0) && p.mhp >= 1) {
              // 方块机器人(atype=6)接触不造成伤害：改为抓住玩家并抛投（原版 main.cpp:3586-3597）
              if (e.atype !== 6) {
                markHurt('enemy', e.uid, { atype: e.atype, axtype: e.axtype, aa: e.aa, ab: e.ab });
                p.mhp -= 1;
                _debugLog.push({ f: _debugFrame, key: _debugKey, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, before: true, mhpDmg: true, reason: 'enemy', uid: e.uid, atype: e.atype, aa: e.aa, ab: e.ab });
              }
            }
            if (e.atype === 6) e.atm = 10;

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
          if (e.atype === 100 && e.axtype === 0) { A.playSE(C.SE.POWERUP); }
          if (e.atype === 100 && e.axtype === 1) { A.playSE(C.SE.POWERUP); }
          if (e.atype === 100 && e.axtype === 2) {
            // 巨大蘑菇：玩家变大
            p.mnobia = C.PLAYER_GIANT_W; p.mnobib = C.PLAYER_GIANT_H;
            A.playSE(C.SE.POWERUP); p.ma -= 1100; p.mb -= 4000; p.mtype = 1; p.mhp = 50000000;
          }
          if (e.atype === 101) { markHurt('flower', e.uid); p.mhp -= 1; _debugLog.push({ f: _debugFrame, key: _debugKey, mhpDmg: true, reason: 'flower', uid: e.uid }); }
          if (e.atype === 102) { markHurt('poison-mushroom', e.uid); p.mhp -= 1; _debugLog.push({ f: _debugFrame, key: _debugKey, mhpDmg: true, reason: 'poison-mushroom', uid: e.uid }); }
          if (e.atype === 110) { markHurt('bad-star', e.uid); p.mhp -= 1; _debugLog.push({ f: _debugFrame, key: _debugKey, mhpDmg: true, reason: 'bad-star', uid: e.uid }); }
          e.aa = -90000000;
        }
      }
    }
    // 清理死亡敌人
    state.enemies = state.enemies.filter(function (e) { return e.aa >= -800000; });
  }

  function enemyGroundCollide(e) {
    // 与管道碰撞
    for (var i = 0; i < state.pipes.length; i++) {
      var s = state.pipes[i];
      if (s.sa < -8000000 || !PT.isSolid(s.stype)) continue;
      xx[0] = 200; xx[2] = 1000; xx[1] = 2000;
      xx[8] = s.sa; xx[9] = s.sb;
      if (e.aa + e.anobia > xx[8] - xx[0] && e.aa < xx[8] + xx[2] &&
          e.ab + e.anobib > xx[9] + xx[1] * 3 / 4 && e.ab < xx[9] + s.sd - xx[2]) {
        e.aa = xx[8] - xx[0] - e.anobia; e.amuki = 0;
      }
      if (e.aa + e.anobia > xx[8] + s.sc - xx[0] && e.aa < xx[8] + s.sc + xx[0] &&
          e.ab + e.anobib > xx[9] + xx[1] * 3 / 4 && e.ab < xx[9] + s.sd - xx[2]) {
        e.aa = xx[8] + s.sc + xx[0]; e.amuki = 1;
      }
      if (e.aa + e.anobia > xx[8] + xx[0] && e.aa < xx[8] + s.sc - xx[0] &&
          e.ab + e.anobib > xx[9] && e.ab + e.anobib < xx[9] + s.sd - xx[1] && e.ad >= -100) {
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
      // （原版 main.cpp tekizimen：soundplay(3) + 4 方向碎片 eyobi + brockbreak）；
      // 管道/墙体仍在上方管道循环中正常阻挡它们。
      if (e.atype === 86 || e.atype === 90) {
        if (e.aa + e.anobia > xx[8] && e.aa < xx[8] + xx[1] &&
            e.ab + e.anobib > xx[9] && e.ab < xx[9] + xx[1]) {
          A.playSE(C.SE.BLOCK_BREAK);
          spawnParticle(b.ta + 1200, b.tb + 1200, 300, -1000, 0, 160, 1000, 1000, 1, 120);
          spawnParticle(b.ta + 1200, b.tb + 1200, -300, -1000, 0, 160, 1000, 1000, 1, 120);
          spawnParticle(b.ta + 1200, b.tb + 1200, 240, -1400, 0, 160, 1000, 1000, 1, 120);
          spawnParticle(b.ta + 1200, b.tb + 1200, -240, -1400, 0, 160, 1000, 1000, 1, 120);
          b.ta = -800000;
        }
        continue;
      }
      if (b.ttype >= 1000) continue;
      if (b.ttype !== 7 && b.ttype !== 117) {
        if (e.aa + e.anobia > xx[8] + xx[0] && e.aa < xx[8] + xx[1] - xx[0] &&
            e.ab + e.anobib > xx[9] && e.ab + e.anobib < xx[9] + xx[1] && e.ad >= -100) {
          e.ab = xx[9] - e.anobib + 100; e.ad = 0; e.axzimen = 1;
        }
      }
      // 左右侧面碰撞：原版 main.cpp:3950 — 隐藏块(ttype=7)对普通敌人(atype<100 且
      // atype!==2)连侧面也不存在，敌人可横穿/坠落穿过；道具敌人(atype>=100)与滑动
      // 龟壳(atype=2)除外。此前只排除117导致敌人坠落时被侧面解析反复向左瞬移
      // （2-1 尖刺馒头怪离开 g10_11 时瞬移到 g10_7 的根因）
      if ((e.atype >= 100 || b.ttype !== 7 || e.atype === 2) && b.ttype !== 117) {
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
      if (lf.sra + lf.src < -12000 || lf.sra > C.FXMAX + 12000) continue;
      var lOld = lf._oldSrb != null ? lf._oldSrb : lf.srb;
      if (e.aa + e.anobia > lf.sra + 500 && e.aa < lf.sra + lf.src - 500 &&
          e.ab + e.anobib > lOld && e.ab + e.anobib < lOld + 1200 && e.ad >= -100) {
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
    if (e.atype < 200 && e.atype !== 6 && e.atype !== 79 && e.atype !== 85 && e.atype !== 86 && e.atype !== 30 && e.atype !== 87 && e.atype !== 88 && e.atype !== 82) {
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
          ctx.save();
          ctx.translate(dx + sp.w / 2, dy + sp.h / 2);
          ctx.scale(1, -1);
          if (m) ctx.scale(-1, 1);
          ctx.drawImage(sp.img, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
          ctx.restore();
          if (hdFlip) { ctx.imageSmoothingEnabled = false; ctx.imageSmoothingQuality = 'low'; }
        } else { S.draw(ctx, e.atype, 3, dx, dy, m); }
      } else {
        S.draw(ctx, e.atype, 3, dx, dy, m);
      }
    } else if (e.atype === 30) {
      S.draw(ctx, e.axtype === 0 ? 30 : 155, 3, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
    } else if (e.atype === 82) {
      // 伪装成方块的敌人（原版 main.cpp:985-1001）：axtype=0 画地面顶、1 画硬块、2 画 grap[1][5]，
      // 贴图随主题偏移（地下+30/城堡+60）；碰撞盒 30×30（ENEMY_SIZE[82]）
      var off82 = state.stagecolor === 2 ? 30 : (state.stagecolor === 4 ? 60 : 0);
      if (e.axtype === 2) S.draw(ctx, 1, 5, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      else S.draw(ctx, (e.axtype === 1 ? 4 : 5) + off82, 1, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
    } else if (e.atype === 79) {
      // 激光炮（stype103/104 隐形陷阱带生成的横向扁矩形，anobia×anobib≈120×15）：
      // 旧引擎 main.cpp:978-983 — 黄色填充矩形 + 黑色描边
      var dx79 = Math.floor(xx[0] / 100), dy79 = Math.floor(xx[1] / 100);
      var w79 = Math.floor(e.anobia / 100), h79 = Math.floor(e.anobib / 100);
      ctx.fillStyle = 'rgb(250, 250, 0)';
      ctx.fillRect(dx79, dy79, w79, h79);
      ctx.strokeStyle = '#000';
      ctx.strokeRect(dx79, dy79, w79, h79);
    } else if (e.atype === 6) {
      if ((e.atm >= 10 && e.atm <= 19) || (e.atm >= 100 && e.atm <= 119) || e.atm >= 200)
        S.draw(ctx, 150, 3, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      else
        S.draw(ctx, 6, 3, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
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
        ctx.drawImage(im, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100),
          cu.tw * 29, cu.th * 29);
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
      ctx.font = '12px sans-serif';
      ctx.fillText('← → 移动   ↑/空格 跳跃   ↓ 进管道', C.CANVAS_W / 2, C.CANVAS_H / 2 + 60);
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

    if (state.proc !== C.PROC.GAME) return;

    // 背景层（原版用 16000 单位的包围盒做剔除，避免宽元素被过早剔除）
    state.bg.forEach(function (n) {
      xx[0] = n.na - state.fx; xx[1] = n.nb - state.fy;
      if (xx[0] + 16000 >= -10 && xx[0] <= C.FXMAX &&
          xx[1] + 16000 >= -10 && xx[1] <= C.FYMAX) {
        if (n.ntype === -1 && n._custom) {
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
        ctx.fillStyle = '#dcdc00';
        if (l.srsp === 2) ctx.fillStyle = '#00dc00';
        if (l.srsp === 21) ctx.fillStyle = '#b4b4b4';
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
      } else if (b.ttype === 110 || b.ttype === 112) {
        // 量产问号块未顶过：显示问号块外观（与编辑器统一模型一致，原为砖块/硬块外观）
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
    var key = IN.get();
    _debugKey = key;
    _debugFrame++;

    if (state.proc === C.PROC.GAME) {
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

    if (state.proc === C.PROC.TITLE) {
      state.maintm += C._DT;
      if (key) {
        state.life = 0;   // 新游戏，重置死亡计数
        state.checkpoint = null;   // 新游戏，清空中间旗检查点
        state._evFired = {};       // 新游戏，事件触发器重新待命
        state.proc = C.PROC.STAGE_START;
        state.maintm = 0;
        startGame();
      }
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
    'out-of-world': '坠入深渊：掉出地图底部',
    'spike': '尖刺：撞上地刺',
    'fatigue-lift': '疲劳升降台：站台停留过久失控坠落',
    'firebar': '火焰棒：被旋转火球烧到',
    'enemy': '敌人碰撞',
    'flower': '火焰花：碰到伤人火花',
    'poison-mushroom': '毒蘑菇：吃下紫毒蘑菇',
    'bad-star': '坏星：碰到恶魔星',
    'fall-brick': '坠落砖组：被运动中的砖组砸中',
    'suicide': '自杀：按 O 键主动结束生命',
    'unknown': '未知原因'
  };
  // 敌人 atype → 中文名（atype 即触发器 btype，见 spawnEnemy）
  var ENEMY_NAME_CN = {
    0: '白猫怪', 1: '绿龟', 2: '龟壳', 3: '幽灵', 4: '国王怪',
    5: '吐舌猫', 6: '机器人', 7: '弹簧白猫', 8: '奔跑怪', 9: '弹跳火焰',
    10: '横向火焰', 30: '小猫咪', 31: '肌肉鸡',
    79: '大脸怪',
    80: '脸云怪', 81: '普通云怪', 82: '隐形云怪', 83: '刺球', 84: '火球',
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
    state.proc = C.PROC.STAGE_START;
    state.maintm = 0;
    state.checkpoint = null;   // 从外部启动新游戏，清空中间旗检查点
    state._evFired = {};       // 事件触发器重新待命
    _debugFrame = 0;
    startGame();
  };

  // 回到标题画面（试玩页"回到标题"按钮用）
  Engine.backToTitle = function () {
    state.proc = C.PROC.TITLE;
    state.maintm = 0;
    state.checkpoint = null;
    A.bgmStop();
  };

  // 传送管道口钩子：玩家进入 stype=60 管道、沉管动画结束时调用 fn(warp)。
  // warp = {end:true} 或 {id:'世界id'}；fn 返回 false 表示宿主自行处理结局（引擎不重载关卡）。
  Engine.setWarpHandler = function (fn) { state.onWarp = fn; };

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
