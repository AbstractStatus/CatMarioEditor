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
    // 消息
    mmsgtm: 0, mmsgtype: 0,
    mainmsgtype: 0,  // 主消息类型（原版 mainmsgtype）
    tmsgtype: 0, tmsgtm: 0, tmsg: 0
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

  // ==================== 关卡加载 ====================
  function loadStage() {
    var def = Lv.get(state.sta, state.stb, state.stc);
    state.stagecolor = def.stagecolor;
    state._stagecolor = def.stagecolor;
    state.scrollx = def.scrollx;

    // 清空
    state.blocks = [];
    state.pipes = [];
    state.enemies = [];
    state.triggers = [];
    state.particles = [];
    state.bg = [];
    state.lifts = [];

    // 加载字节网格
    var grid = def.grid;
    for (var tt = 0; tt <= 1000; tt++) {
      for (var t = 0; t <= 16; t++) {
        var v = grid[t][tt];
        if (v === 0) continue;
        var wx = tt * 29 * 100;
        var wy = (t * 29 - 12) * 100;
        if (v >= 1 && v <= 19 && v !== 9) {
          state.blocks.push({ ta: wx, tb: wy, ttype: v, txtype: 0, thp: 0, titem: 0 });
        } else if (v >= 20 && v <= 29) {
          state.lifts.push({ sra: wx, srb: wy, src: 3000, srtype: 0, sracttype: 0, sre: 0, srf: 0, srsp: 0, sron: 0, srmuki: 0, srsok: 0, srmove: 0, srmovep: 0 });
        } else if (v === 30) {
          state.pipes.push({ sa: wx, sb: wy, sc: 3000, sd: 6000, stype: 500, sxtype: 0, sgtype: 0, sr: 0 });
        } else if (v === 40) {
          state.pipes.push({ sa: wx, sb: wy, sc: 6000, sd: 3000, stype: 1, sxtype: 0, sgtype: 0, sr: 0 });
        } else if (v === 41) {
          state.pipes.push({ sa: wx + 500, sb: wy, sc: 5000, sd: 3000, stype: 2, sxtype: 0, sgtype: 0, sr: 0 });
        } else if (v === 43) {
          state.pipes.push({ sa: wx, sb: wy + 500, sc: 2900, sd: 5300, stype: 1, sxtype: 0, sgtype: 0, sr: 0 });
        } else if (v === 44) {
          state.pipes.push({ sa: wx, sb: wy + 700, sc: 3900, sd: 5000, stype: 5, sxtype: 0, sgtype: 0, sr: 0 });
        } else if (v >= 50 && v <= 79) {
          state.triggers.push({ ba: wx, bb: wy, btype: v - 50, bxtype: 0, bz: 1, btm: 0, spawned: false });
        } else if (v >= 80 && v <= 89) {
          state.bg.push({ na: wx, nb: wy, ntype: v - 80 });
        } else if (v === 9) {
          state.blocks.push({ ta: wx, tb: wy, ttype: 800, txtype: 0, thp: 0, titem: 0 });
        } else if (v === 99) {
          state.pipes.push({ sa: wx, sb: wy, sc: 3000, sd: (12 - t) * 3000, stype: 300, sxtype: 0, sgtype: 0, sr: 0 });
        }
      }
    }

    // 特殊方块
    def.blocks.forEach(function (b) {
      state.blocks.push({ ta: b.x * 100, tb: b.y * 100, ttype: b.type, txtype: b.xt || 0, thp: 0, titem: 0 });
    });

    // 管道
    def.pipes.forEach(function (p) {
      var pipe = { sa: p.sa, sb: p.sb, sc: p.sc, sd: p.sd, stype: p.stype, sxtype: p.sxtype || 0, sgtype: 0, sr: 0 };
      // stype=60 传送管道口：保留传送目标 {end,id}
      if (p.warp) pipe.warp = { end: !!p.warp.end, id: p.warp.id || null };
      state.pipes.push(pipe);
    });

    // 敌人触发器
    def.enemies.forEach(function (e) {
      state.triggers.push({ ba: e.ba, bb: e.bb, btype: e.btype, bxtype: e.bxtype || 0, bz: 1, btm: 0, spawned: false });
    });

    // 升降台
    (def.lifts || []).forEach(function (l) {
      state.lifts.push(l);
    });

    // 自定义关卡 BGM（试玩页注入；默认地上 100）
    state.bgmId = def.bgm || 100;

    // 自定义出生点（def.spawn：像素单位，与 blocks 的 x/y 同系）
    // 新引擎 ma/mb 为世界坐标；进关直接把玩家放到出生点并把镜头居中，
    // 远端出生不再依赖首帧相机追赶
    if (def.spawn && state.player) {
      state.player.ma = def.spawn.x * 100 + 200;
      state.player.mb = (def.spawn.y - 30) * 100;   // 略高几格，自然落地
      state.scorepos = state.player.ma;
      var fxp = state.player.ma - C.FXMAX / 2;
      if (fxp > 700 && fxp < state.scrollx) {
        state.fx = fxp;
        state.fzx = fxp;
      }
    }
  }

  // ==================== 敌人生成 ====================
  function spawnEnemy(xa, xb, xc, xd, xnotm, xtype, xxtype) {
    var sz = C.ENEMY_SIZE[xtype] || [3000, 3000];
    var e = {
      aa: xa, ab: xb,
      ac: xc, ad: xd,
      anobia: sz[0], anobib: sz[1],
      atype: xtype, axtype: xxtype,
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
    if (xtype === 87) e.atm = xxtype >= 10000
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
      if (key & C.KEY.LEFT) { p.ma -= spd; p.mmuki = 0; }
      if (key & C.KEY.RIGHT) { p.ma += spd; p.mmuki = 1; }
      if (key & C.KEY.JUMP) p.mb -= spd;   // 上/空格 = 向上
      if (key & C.KEY.DOWN) p.mb += spd;    // 下 = 向下
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
      if (p.mjumptm === 8 && p.md >= -900) {
        p.md = -1300;
        if (p.mc >= 200 || p.mc <= -200) p.md = -1400;
        if (p.mc >= 600 || p.mc <= -600) p.md = -1500;
      }
      if (xx[0] === 0) p.actaon[1] = 10;
    }

    // 加速
    xx[0] = 40; xx[1] = 700; xx[8] = 500; xx[9] = 700;
    xx[12] = 1; xx[13] = 2;
    if (p.mrzimen === 1) { xx[0] = 20; xx[12] = 9; xx[13] = 10; }

    if (p.actaon[0] === -1) {
      if (!(p.mzimen === 0 && p.mc < -xx[8])) {
        if (p.mc >= -xx[9]) { p.mc -= xx[0]; if (p.mc < -xx[9]) p.mc = -xx[9] - 1; }
      }
      if (p.mrzimen !== 1) {
        if (p.mc > 100 && p.mzimen === 0) p.mc -= xx[0] * 2 / 3;
        if (p.mc > 100 && p.mzimen === 1) { p.mc -= xx[0]; p.mc -= xx[0] / 2; }
        p.actaon[0] = 3; p.mkasok += 1;
      }
    }
    if (p.actaon[0] === 1) {
      if (!(p.mzimen === 0 && p.mc > xx[8])) {
        if (p.mc <= xx[9]) { p.mc += xx[0]; if (p.mc > xx[9]) p.mc = xx[9] + 1; }
      }
      if (p.mrzimen !== 1) {
        if (p.mc < -100 && p.mzimen === 0) p.mc += xx[0] * 2 / 3;
        if (p.mc < -100 && p.mzimen === 1) { p.mc += xx[0]; p.mc += xx[0] / 2; }
        p.actaon[0] = 3; p.mkasok += 1;
      }
    }
    if (p.actaon[0] === 0 && p.mkasok > 0) p.mkasok -= 2;
    if (p.mkasok > 8) p.mkasok = 8;
    if (p.mzimen !== 1) p.mrzimen = 0;

    // 跳跃
    if (p.mjumptm >= 0) p.mjumptm--;
    if (p.actaon[1] === 1 && p.mzimen === 1) {
      p.mb -= 400; p.md = -1200; p.mjumptm = 10;
      A.playSE(C.SE.JUMP);
      p.mzimen = 0;
    }
    if (p.actaon[1] <= 9) p.actaon[1] = 0;

    if (p.mmutekitm >= -1) p.mmutekitm--;

    // MHP 变化追踪（在死亡检查之前）
    if (p._prevMhp !== p.mhp) {
      _debugLog.push({ f: _debugFrame, key: key, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, mtm: p.mtm, before: true, mhpChange: true, mhp: p.mhp, prevMhp: p._prevMhp, reason: 'start-of-frame' });
      p._prevMhp = p.mhp;
    }
    // MTYPE 变化追踪
    if (p._prevMtype !== p.mtype) {
      _debugLog.push({ f: _debugFrame, key: key, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, mtm: p.mtm, before: true, mtypeChange: true, prevMtype: p._prevMtype });
      p._prevMtype = p.mtype;
    }

    // 死亡
    if (p.mhp <= 0 && p.mhp >= -9) {
      _debugLog.push({ f: _debugFrame, key: 0, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, before: false, death: true, mhp: p.mhp });
      state.life++;
      p.mkeytm = 12; p.mhp = -20; p.mtype = C.MTYPE.DEAD; p.mtm = 0;
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
      p.mtm++;
      if (p.mtype === C.MTYPE.PIPE) {
        if (p.mxtype === 0) {
          p.mc = 0; p.md = 0;
          var tp = p._trapPipe;
          // 玩家沉入管道（mtm<=16）后移出屏幕（17）
          if (p.mtm <= 16) { p.mb += 240; p.mzz = 100; }
          if (p.mtm === 17) p.mb = -80000000;
          // 陷阱管道动画：玩家已离屏，此时驱动管道本体（对应原版 main.cpp 的 sa/sb[28]）
          if (tp) {
            if (p.mtm === 23) tp.sa -= 100;
            if (p.mtm >= 44 && p.mtm <= 60) tp.sa += (p.mtm % 2 === 0) ? 200 : -200;
            if (p.mtm >= 61 && p.mtm <= 77) tp.sa += (p.mtm % 2 === 0) ? 400 : -400;
            if (p.mtm >= 78 && p.mtm <= 94) tp.sa += (p.mtm % 2 === 0) ? 600 : -600;
            if (p.mtm >= 110) {
              tp.sb -= p.mzz;
              p.mzz += 80;
              if (p.mzz > 1600) p.mzz = 1600;
            }
          }
          if (p.mtm === 160) { p._trapPipe = null; p.mtype = 0; p.mhp--; _debugLog.push({ f: _debugFrame, key: key, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, before: true, mhpDmg: true, reason: 'pipe-exit' }); }
        } else {
          p.mc = 0; p.md = 0;
          if (p.mtm <= 16) p.mb += 240;
          if (p.mtm === 20) {
            // 玩家已完全沉入管道并离屏：进行关卡切换
            p.mb = -80000000; p.mtype = 0; A.bgmStop();
            state.fx = 0;
            var warp = p._warp; p._warp = null;
            var proceed = true;
            if (warp) {
              // 传送管道口：交给宿主（试玩页）决定目标世界或游戏结束
              // onWarp 返回 false 表示宿主自行处理结局（如回标题），引擎不再重载关卡
              proceed = (typeof state.onWarp === 'function') ? state.onWarp(warp) !== false : false;
            } else {
              state.stc++;   // 普通进管：进入下一子关
            }
            if (proceed) { startGame(); state.proc = C.PROC.STAGE_START; state.maintm = 0; }
          }
        }
      }
      if (p.mtype === C.MTYPE.GOAL_SLIDE) {
        p.mkeytm = 3;
        if (p.mtm <= 1) { p.mc = 0; p.md = 0; }
        if (p.mtm >= 2 && p.mtm <= 42) { p.md = 600; p.mmuki = 1; }
        if (p.mtm > 43 && p.mtm <= 108) p.mc = 300;
        if (p.mtm === 110) { p.mb = -80000000; p.mc = 0; }
        if (p.mtm === 250) { state.stb++; state.stc = 0; startGame(); state.proc = C.PROC.STAGE_START; state.maintm = 0; }
      }
    }

    // 移动
    if (p.mkeytm >= 1) p.mkeytm--;
    p.ma += p.mc; p.mb += p.md;
    if (p.mc < 0) p.mactp += -p.mc;
    else p.mactp += p.mc;
    if (p.mtype <= 9 || p.mtype === C.MTYPE.DEAD || p.mtype === C.MTYPE.GOAL_SLIDE) p.md += C.GRAVITY;

    // 速度上限
    if (p.mtype === 0) {
      xx[0] = 800; xx[1] = 1600;
      if (p.mc > xx[0] && p.mc < xx[0] + 200) p.mc = xx[0];
      if (p.mc > xx[0] + 200) p.mc -= 200;
      if (p.mc < -xx[0] && p.mc > -xx[0] - 200) p.mc = -xx[0];
      if (p.mc < -xx[0] - 200) p.mc += 200;
      if (p.md > xx[1]) p.md = xx[1];
    }

    // 地面摩擦
    if (p.mzimen === 1 && p.actaon[0] !== 3) {
      if (p.mtype <= 9) {
        if (p.mrzimen === 0) {
          xx[2] = 30; xx[1] = 60; xx[3] = 30;
          if (p.mc >= -xx[3] && p.mc <= xx[3]) p.mc = 0;
          if (p.mc >= xx[2]) p.mc -= xx[1];
          if (p.mc <= -xx[2]) p.mc += xx[1];
        }
      }
    }

    p.mzimen = 0;
    // 边界（世界坐标）
    if (p.mtype <= 9 && p.mhp >= 1) {
      if (p.ma < 100) { p.ma = 100; p.mc = 0; }
      if (p.ma + p.mnobia > state.scrollx + C.FXMAX) { p.ma = state.scrollx + C.FXMAX - p.mnobia; p.mc = 0; }
    }
    if (p.mb >= 52000 && p.mhp >= 0) p.mhp = -2;

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
                if (b.ttype === 10) { p.mmsgtm = 30; p.mmsgtype = 3; p.mhp--; _debugLog.push({ f: _debugFrame, key: _debugKey, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, before: true, mhpDmg: true, reason: 'ttype10', ta: b.ta, tb: b.tb }); }
              }
            }
            // 左右碰撞
            if (t3 === xx[22] && xx[15] === 0) {
              if (b.ttype !== 7 && b.ttype !== 110 && b.ttype !== 117) {
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

          // 特殊方块交互 — ttype 100 每帧跟随行为（玩家从下方靠近时方块上移/下移）
          // 原版行 2224-2227：mb 在 tb 附近且 md<=0 时，tb 跟随 mb 移动
          // 公式 tb[t] = mb - 1200 - xx[1]（fy 在原版恒为 0）
          // 条件：玩家在方块下方附近（mb 在 tb-600 到 tb+4600 之间）+ 水平对齐 + 上升/静止
          if (b.ttype === 100 && b.txtype === 0 &&
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
            if (e101 && b.txtype !== 4) e101.abrocktm = 16;
          }
          if (b.ttype === 102 && xx[17] === 1) {
            A.playSE(8); b.ttype = 3;
            var e102;
            if (b.txtype === 0) e102 = spawnEnemy(b.ta, b.tb, 0, 0, 0, 100, 0);
            else if (b.txtype === 2) e102 = spawnEnemy(b.ta, b.tb, 0, 0, 0, 100, 2);
            else if (b.txtype === 3) e102 = spawnEnemy(b.ta, b.tb, 0, 0, 0, 102, 1);
            if (e102) e102.abrocktm = 16;
          }
          if (b.ttype === 103 && xx[17] === 1) {
            A.playSE(8); b.ttype = 3;
            var e103 = spawnEnemy(b.ta, b.tb, 0, 0, 0, 100, 1);
            e103.abrocktm = 16;
          }
          if (b.ttype === 104 && xx[17] === 1) {
            A.playSE(8); b.ttype = 3;
            var e104 = spawnEnemy(b.ta, b.tb, 0, 0, 0, 110, 0);
            e104.abrocktm = 16;
          }
          if (b.ttype === 110 && xx[17] === 1) { b.ttype = 111; b.thp = 999; }
          if (b.ttype === 111 && b.ta - state.fx >= 0) {
            b.thp++;
            if (b.thp >= 16) { b.thp = 0; A.playSE(8); var e111 = spawnEnemy(b.ta, b.tb, 0, 0, 0, 102, 1); e111.abrocktm = 16; }
          }
          if (b.ttype === 112 && xx[17] === 1) { b.ttype = 113; b.thp = 999; b.titem = 0; }
          if (b.ttype === 113 && b.ta - state.fx >= 0) {
            if (b.titem <= 19) b.thp++;
            if (b.thp >= 3) { b.thp = 0; b.titem++; A.playSE(C.SE.COIN); spawnParticle(b.ta + 10, b.tb, 0, -800, 0, 40, 3000, 3000, 0, 16); }
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

  // ==================== 敌人触发与更新 ====================
  function updateTriggers() {
    var p = state.player;
    for (var i = 0; i < state.triggers.length; i++) {
      var tr = state.triggers[i];
      if (tr.ba < -80000) continue;
      if (tr.btm >= 0) tr.btm--;

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
          spawnEnemy(tr.ba, tr.bb, 0, 0, 0, tr.btype, tr.bxtype);
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
      if (e.anotm >= 0) e.anotm--;
      if (xx[0] + xx[2] < -12000 || xx[0] > C.FXMAX + 12000 ||
          xx[1] + xx[3] < -9000 || xx[1] > C.FYMAX + 20000) {
        e.aa = -900000; continue;
      }

      e.aacta = 0; e.aactb = 0;
      xx[10] = 0;

      // 敌人 AI（按 atype）
      switch (e.atype) {
        case 0: case 1: xx[10] = 100; break;
        case 2:
          xx[10] = 0;
          if (e.axtype >= 1) xx[10] = 800;
          break;
        case 3:
          e.azimentype = 0;
          if (e.axtype === 0) e.ab -= 800;
          else e.ab += 1200;
          break;
        case 4:
          xx[10] = 120;
          if (e.atm >= 0) e.atm--;
          if (Math.abs(p.ma + p.mnobia - xx[0] - 500) < 9000 && p.md <= -600 && e.atm <= 0) {
            if (e.axtype === 1 && p.mzimen === 0 && e.axzimen === 1) {
              e.ad = -1600; e.atm = 40; e.ab -= 1000;
            }
          }
          break;
        case 5: xx[10] = 160; break;
        case 7:
          e.azimentype = 0;
          xx[11] = 400;
          if (e.axtype === 0) xx[10] = xx[11];
          if (e.axtype === 1) xx[10] = -xx[11];
          if (e.axtype === 2) e.ab -= xx[11];
          if (e.axtype === 3) e.ab += xx[11];
          break;
        case 9:
          e.azimentype = 5;
          e.ab += e.ad; e.ad += 100;
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
          e.atm++;
          if (e.axtype === 0) {
            if (e.atm === 50 && p.mb >= 6000) { e.ac = 300; e.ad -= 1600; e.ab -= 1000; }
          } else {
            e.azimentype = 0; e.ab += e.ad; e.ad += 120;
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
          if (p.mb >= 30000 && p.ma >= e.aa - 15000 && p.ma <= e.aa && e.axtype === 1) { e.axtype = 5; e.amuki = 0; }
          if (e.axtype === 5) xx[10] = 400;
          break;
        case 86:
          e.azimentype = 4;
          // 原版 main.cpp case 86：玩家水平范围与猫身重叠才触发下落（xx[26] 运行时≈18，几乎无余量）
          if (p.ma >= e.aa - p.mnobia - 18 && p.ma <= e.aa + e.anobia + 18) e.atm = 1;
          if (e.atm === 1) e.ab += 1200;
          break;
        case 87:
          e.azimentype = 0;
          if (e.aa % 10 !== 1) e.atm += 6; else e.atm -= 6;
          if (e.atm > 720) e.atm -= 720;
          if (e.atm < 0) e.atm += 720;
          break;
        case 90: xx[10] = 160; break;
        case 100:
          e.azimentype = 1; xx[10] = 100; break;
        case 102:
          e.azimentype = 1; xx[10] = e.axtype === 1 ? 200 : 100; break;
        case 110:
          e.azimentype = 1; xx[10] = 200;
          if (e.axzimen === 1) { e.ab -= 1200; e.ad = -1400; }
          break;
      }

      if (e.abrocktm >= 1) xx[10] = 0;
      if (e.amuki === 0) e.aacta -= xx[10];
      else e.aacta += xx[10];

      if (e.ad > 1200 && e.azimentype !== 5) e.ad = 1200;

      e.aa += e.aacta;
      if (e.azimentype >= 1 && e.abrocktm <= 0) {
        e.aa += e.ac;
        if (e.azimentype >= 1 && e.azimentype <= 3) { e.ab += e.ad; e.ad += 120; }
        if (e.axzimen === 1) {
          if (e.ac >= 200) e.ac -= 100;
          else if (e.ac <= -200) e.ac += 100;
          else e.ac = 0;
        }
        e.axzimen = 0;
        enemyGroundCollide(e);
      }

      if (e.abrocktm > 0) {
        e.abrocktm--;
        if (e.abrocktm < 100) e.ab -= 180;
        if (e.abrocktm === 100) { e.ab -= 800; e.ad = -1200; e.ac = 700; e.abrocktm = 0; }
      }

      // 玩家踩敌人
      xx[0] = 250; xx[1] = 1600; xx[5] = -800;
      xx[8] = e.aa; xx[9] = e.ab;
      xx[12] = 0; if (p.md >= 100) xx[12] = p.md;
      xx[25] = 0;

      if (p.ma + p.mnobia > xx[8] + xx[0] * 2 && p.ma < xx[8] + e.anobia - xx[0] * 2 &&
          p.mb + p.mnobib > xx[9] - xx[5] && p.mb + p.mnobib < xx[9] + xx[1] + xx[12] &&
          p.mmutekitm <= 0 && e.abrocktm <= 0) {
        if (e.atype !== 4 && e.atype !== 9 && e.atype !== 10 && (e.atype <= 78 || e.atype === 85) &&
            p.mzimen !== 1 && p.mtype !== C.MTYPE.DEAD) {
          if (e.atype === 0) {
            if (e.axtype === 0) e.aa = -900000;
            else { A.playSE(5); p.mb = xx[9] - 900 - e.anobib; p.md = -2100; xx[25] = 1; }
          }
          if (e.atype === 1) { e.atype = 2; e.anobib = 3000; e.axtype = 0; }
          if (e.atype === 2 && p.md >= 0) {
            if (e.axtype === 1 || e.axtype === 2) e.axtype = 0;
            else { e.axtype = 1; e.amuki = p.ma + p.mnobia > xx[8] + xx[0] * 2 && p.ma < xx[8] + e.anobia / 2 ? 1 : 0; }
          }
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
              p.mhp -= 1;
              _debugLog.push({ f: _debugFrame, key: _debugKey, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, before: true, mhpDmg: true, reason: 'enemy', atype: e.atype, aa: e.aa, ab: e.ab });
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
          if (e.atype === 101) { p.mhp -= 1; _debugLog.push({ f: _debugFrame, key: _debugKey, mhpDmg: true, reason: 'flower' }); }
          if (e.atype === 102) { p.mhp -= 1; _debugLog.push({ f: _debugFrame, key: _debugKey, mhpDmg: true, reason: 'poison-mushroom' }); }
          if (e.atype === 110) { p.mhp -= 1; _debugLog.push({ f: _debugFrame, key: _debugKey, mhpDmg: true, reason: 'bad-star' }); }
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
      if (b.ttype !== 117) {
        if (e.aa + e.anobia > xx[8] && e.aa < xx[8] + xx[2] &&
            e.ab + e.anobib > xx[9] + xx[1] / 2 - xx[0] && e.ab < xx[9] + xx[2]) {
          e.aa = xx[8] - e.anobia; e.ac = 0; e.amuki = 0;
        }
        if (e.aa + e.anobia > xx[8] + xx[1] - xx[0] * 2 && e.aa < xx[8] + xx[1] &&
            e.ab + e.anobib > xx[9] + xx[1] / 2 - xx[0] && e.ab < xx[9] + xx[2]) {
          e.aa = xx[8] + xx[1]; e.ac = 0; e.amuki = 1;
        }
      }
    }
  }

  // ==================== 粒子更新 ====================
  function updateParticles() {
    for (var i = 0; i < state.particles.length; i++) {
      var p = state.particles[i];
      if (p.etm >= 0) p.etm--;
      xx[0] = p.ea - state.fx; xx[1] = p.eb - state.fy;
      if (p.etm >= 0 && xx[0] > -100 && xx[0] < C.FXMAX && xx[1] > -10000 && xx[1] < C.FYMAX) {
        p.ea += p.ec; p.eb += p.ed;
        p.ec += p.ee; p.ed += p.ef;
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
        state.fx  += push;
        state.fzx += push;
      }
      // 左滚：玩家退到 1/3 屏幕宽以下才拉镜头（保留左边 1/3 缓冲）
      if (screenX < leftTrigger && state.fzx > 700) {
        var pull = leftTrigger - screenX;
        state.fx  -= pull;
        state.fzx -= pull;
      }
    }
    if (state.fx < 0) state.fx = 0;
  }

  // ==================== 敌人绘制（供分层渲染复用）====================
  function drawEnemy(ctx, e) {
    xx[0] = e.aa - state.fx; xx[1] = e.ab - state.fy;
    if (xx[0] + e.anobia < -100 || xx[0] > C.FXMAX) return;
    var m = e.amuki === 1;
    if (e.atype < 200 && e.atype !== 6 && e.atype !== 79 && e.atype !== 86 && e.atype !== 30 && e.atype !== 87) {
      // 火焰(小) atype=9：向下运动时垂直翻转图标180°
      var dx = Math.floor(xx[0] / 100), dy = Math.floor(xx[1] / 100);
      if (e.atype === 9 && e.ad > 0) {
        var sp = S.get(e.atype, 3);
        if (sp && sp.img) {
          ctx.save();
          ctx.translate(dx + sp.w / 2, dy + sp.h / 2);
          ctx.scale(1, -1);
          if (m) ctx.scale(-1, 1);
          ctx.drawImage(sp.img, -sp.w / 2, -sp.h / 2);
          ctx.restore();
        } else { S.draw(ctx, e.atype, 3, dx, dy, m); }
      } else {
        S.draw(ctx, e.atype, 3, dx, dy, m);
      }
    } else if (e.atype === 30) {
      S.draw(ctx, e.axtype === 0 ? 30 : 155, 3, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
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
    } else if (e.atype === 87) {
      // 火焰棒旋转
      var cx = Math.floor(xx[0] / 100), cy = Math.floor(xx[1] / 100);
      var cnt = e.axtype % 100;
      for (var k = 0; k <= cnt; k++) {
        var ang = e.atm * Math.PI / 180 / 2;
        var dx = k * 18 * Math.cos(ang);
        var dy = k * 18 * Math.sin(ang);
        ctx.fillStyle = '#ff6000';
        ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 6, 0, Math.PI * 2); ctx.fill();
      }
    } else if (e.atype === 200) {
      S.draw(ctx, 0, 3, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
    }
  }

  // ==================== 渲染 ====================
  function render(ctx) {
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
      // 分数（左上角）
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('SCORE: ' + state.score, 15, 20);
      return;
    }

    if (state.proc !== C.PROC.GAME) return;

    // 背景层（原版用 16000 单位的包围盒做剔除，避免宽元素被过早剔除）
    state.bg.forEach(function (n) {
      xx[0] = n.na - state.fx; xx[1] = n.nb - state.fy;
      if (xx[0] + 16000 >= -10 && xx[0] <= C.FXMAX &&
          xx[1] + 16000 >= -10 && xx[1] <= C.FYMAX) {
        S.draw(ctx, n.ntype, 4, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
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
      xx[0] = l.sra - state.fx; xx[1] = l.srb - state.fy;
      if (xx[0] + l.src >= -10 && xx[0] <= C.FXMAX + 120) {
        var h = 14;
        ctx.fillStyle = '#dcdc00';
        if (l.srsp === 2) ctx.fillStyle = '#00dc00';
        if (l.srsp === 21) ctx.fillStyle = '#b4b4b4';
        ctx.fillRect(Math.floor(xx[0] / 100), Math.floor(xx[1] / 100), Math.floor(l.src / 100), h);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.strokeRect(Math.floor(xx[0] / 100), Math.floor(xx[1] / 100), Math.floor(l.src / 100), h);
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
      } else if (b.ttype === 100 || b.ttype === 101 || b.ttype === 102 || b.ttype === 103 || b.ttype === 104) {
        S.draw(ctx, 2 + (state.stagecolor === 2 ? 30 : (state.stagecolor === 4 ? 60 : 0)), 1, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (b.ttype === 110 || b.ttype === 111) {
        S.draw(ctx, 1 + (state.stagecolor === 2 ? 30 : (state.stagecolor === 4 ? 60 : 0)), 1, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
      } else if (b.ttype === 112 || b.ttype === 113) {
        S.draw(ctx, 3 + (state.stagecolor === 2 ? 30 : (state.stagecolor === 4 ? 60 : 0)), 1, Math.floor(xx[0] / 100), Math.floor(xx[1] / 100));
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

    // 标题/状态文字
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('SCORE: ' + state.score, 10, 10);
    ctx.fillText('POS: ' + Math.floor(p.ma / 100), 10, 28);
    if (state.cheat) {
      ctx.fillStyle = '#ff4040';
      ctx.fillText('CHEAT ON (C to toggle)', 10, 46);
    }
  }

  // ==================== 主循环 ====================
  function frame() {
    var key = IN.get();
    _debugKey = key;
    _debugFrame++;

    if (state.proc === C.PROC.GAME) {
      if (state.proc === C.PROC.GAME && state.tmsgtype === 0) {
        updatePlayer(key);
        var p = state.player;
        if (key & 2 || p.mb > 40000 || _debugFrame <= 10) {
          _debugLog.push({ f: _debugFrame, key: key, ma: p.ma, mb: p.mb, mc: p.mc, md: p.md, mz: p.mzimen, mt: p.mtype, before: true });
        }
        collideBlocks();
        collidePipes();
        // キー入力初期化（原版行 2694：帧末尾重置方向输入，使摩擦生效）
        state.player.actaon[0] = 0; state.player.actaon[4] = 0;
        var p2 = state.player;
        if (key & 2 || p2.mb > 40000 || _debugFrame <= 10) {
          _debugLog.push({ f: _debugFrame, key: key, ma: p2.ma, mb: p2.mb, mc: p2.mc, md: p2.md, mz: p2.mzimen, mt: p2.mtype, before: false });
        }
        updateTriggers();
        updateEnemies();
        updateParticles();
        updateCamera();

        // 分数
        state.scorepos = Math.max(state.scorepos, state.player.ma);
        state.score = Math.floor(state.scorepos / 1000) * 100;
      }
    }

    if (state.proc === C.PROC.STAGE_START) {
      state.maintm++;
      if (state.maintm >= 30) {
        state.maintm = 0; state.proc = C.PROC.GAME;
      }
    }

    if (state.proc === C.PROC.TITLE) {
      state.maintm++;
      if (key) {
        state.life = 0;   // 新游戏，重置死亡计数
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
    state.scorepos = 0; state.score = 0;
    loadStage();
    A.bgmChange(state.bgmId || 100);
  }

  // ==================== 公开接口 ====================
  var canvas, ctx2d;
  var _loopRunning = false;
  var _lastFrameTime = 0;
  var _accumulator = 0;
  var _PHYS_STEP = 1000 / C.FPS;     // 物理固定 timestep = 30ms（原版基准）
  var _renderStep = 1000 / 60;       // 渲染目标 60Hz（仅做节流，rAF 驱动）
  var _lastRenderTime = 0;

  // ---- 响应式：等比例缩放 + 镜头变宽 ----
  // 策略：
  //   1) 以画布高度为基准，取 baseScale = canvas.height / 420（等比例缩放所有虚拟坐标）
  //   2) 画布实际宽度除以 baseScale = virtW，作为虚拟宽度（可变，镜头变宽）
  //   3) 动态更新 C.CANVAS_W / C.FXMAX，使剔除 / 背景 / 精灵绘制覆盖新的虚拟宽度
  var _BASE_CANVAS_W = C.CANVAS_W;
  var _BASE_CANVAS_H = C.CANVAS_H;
  var _BASE_FXMAX = C.FXMAX;
  var _baseScale = 1;       // 等比例缩放系数
  var _virtW = C.CANVAS_W;  // 当前虚拟宽度（>= 480，可变）

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
      _virtW = Math.max(_BASE_CANVAS_W, Math.round(newW / _baseScale));
      C.CANVAS_W = _virtW;
      C.FXMAX    = _virtW * 100;
      return;
    }

    canvas.width  = newW;
    canvas.height = newH;
    _baseScale = newH / _BASE_CANVAS_H;
    _virtW = Math.max(_BASE_CANVAS_W, Math.round(newW / _baseScale));
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
      if (e.keyCode === 32) {                     // Space: 加速
        state.speedup = true;
      }
    });
    window.addEventListener('keyup', function (e) {
      if (e.keyCode === 32) {
        state.speedup = false;
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

    // 渲染节流：目标 60Hz，实际 rAF 驱动会自动适配屏幕刷新率
    // 跳过不必要的渲染可以省电/避免撕裂
    if (now - _lastRenderTime >= _renderStep - 1) {
      _lastRenderTime = now;
      render(ctx2d);
    }
  }

  var _debugKey = 0, _debugFrame = 0;
  var _debugLog = [];
  Engine.getState = function () {
    return { proc: state.proc, key: _debugKey, frame: _debugFrame, maintm: state.maintm, blocks: state.blocks.length, fx: state.fx, collideCount: _debugCollideCount, collideTop: _debugCollideTop, player: state.player ? { ma: state.player.ma, mb: state.player.mb, mc: state.player.mc, md: state.player.md, mzimen: state.player.mzimen, mhp: state.player.mhp, mtype: state.player.mtype } : null };
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
    _debugFrame = 0;
    startGame();
  };

  // 回到标题画面（试玩页"回到标题"按钮用）
  Engine.backToTitle = function () {
    state.proc = C.PROC.TITLE;
    state.maintm = 0;
    A.bgmStop();
  };

  // 传送管道口钩子：玩家进入 stype=60 管道、沉管动画结束时调用 fn(warp)。
  // warp = {end:true} 或 {id:'世界id'}；fn 返回 false 表示宿主自行处理结局（引擎不重载关卡）。
  Engine.setWarpHandler = function (fn) { state.onWarp = fn; };

  // 调试：访问内部状态
  Engine._state = state;

  global.GameEngine = Engine;
})(window);
