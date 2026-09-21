// ===================================================================
// 元素类型注册表 - 管道/墙体类型 (stype) 的渲染与行为
// 将原版 main.cpp 中硬编码的 stype 逻辑解耦为可注册的类型处理器
// 编辑器可通过 PipeTypes.register(id, config) 自定义新元素
// 注意：render(ctx, s, x, y, w, h, state) 接收 state 参数以解耦
// ===================================================================
(function (global) {
  'use strict';

  var PipeTypes = {};

  // ---- 从 global 动态获取模块（避免初始化时还未加载的问题） ----
  function getC() { return global.Constants; }
  function getS() { return global.Sprites; }
  function getA() { return global.AudioSys; }

  // ---- 内部工具 ----
  function drawTileGrid(ctx, s, x, y, w, h, gid, sheet) {
    var S = getS();
    var cols = Math.floor(s.sc / 3000);
    var rows = Math.floor(s.sd / 3000);
    for (var c = 0; c <= cols; c++) {
      for (var r = 0; r <= rows; r++) {
        if (S) S.draw(ctx, gid, sheet, x + 29 * c, y + 29 * r);
      }
    }
  }

  function stageColorOffset(state) {
    if (state && state._stagecolor === 2) return 30;
    if (state && state._stagecolor === 4) return 60;
    if (state && state.stagecolor === 2) return 30;
    if (state && state.stagecolor === 4) return 60;
    return 0;
  }

  // ==================== 管道进入检测（方向感知） ====================
  // 按管道开口方向选择对应的进入按键，并校验玩家位于开口一侧：
  //   dir='up'    → 按下键，玩家在管口上方
  //   dir='down'  → 按上键(JUMP)，玩家在管口下方
  //   dir='left'  → 按右键，玩家在管口左侧
  //   dir='right' → 按左键，玩家在管口右侧
  // 通过后写入 p._pipeDir 供引擎播放沉入动画时确定方向。
  function pipeEnterCheck(p, s, xx) {
    var dir = s.dir;
    if (!dir) {
      // stype 40 原版左进入管道：无 dir 属性时默认 'left'
      if (s.stype === 40) dir = 'left';
      else dir = 'up';
    }
    // 1. 按键校验
    // 注意：水平移动处理后 actaon[0] 会被改写为哨兵值 3（同原版 main.cpp），
    // 所以横管进入必须判定 actaon[4]（本帧按键写入的方向记忆，-1左/1右）。
    var keyOk;
    if (dir === 'up')         keyOk = (p.actaon[3] === 1);        // DOWN
    else if (dir === 'down')  keyOk = (p.actaon[2] === 1);        // UP/JUMP
    else if (dir === 'left')  keyOk = (p.actaon[4] === 1);        // RIGHT
    else                       keyOk = (p.actaon[4] === -1);       // LEFT (dir='right')
    if (!keyOk || p.mtype !== 0) return false;

    // 2. AABB 校验：玩家必须位于开口一侧并与管口重叠
    var pl = p.ma, pr = p.ma + p.mnobia;
    var pt = p.mb, pb = p.mb + p.mnobib;
    var L = xx[8], R = xx[8] + s.sc;
    var T = xx[9], B = xx[9] + s.sd;

    if (dir === 'up') {
      // 玩家在管顶：水平重叠 + 脚踩管口 + 着地（原版 stype 50 同条件）
      if (!(pr > L + 2800 && pl < R - 3000)) return false;
      if (!(pb > T - 1000 && pb < T + 5400)) return false;
      if (p.mzimen !== 1) return false;
    } else if (dir === 'down') {
      // 玩家在管底下方：水平重叠 + 头顶贴管底
      if (!(pr > L + 2800 && pl < R - 3000)) return false;
      if (!(pt > B - 3000 && pt < B + 1000)) return false;
    } else if (dir === 'left') {
      // 玩家在管口左侧按→走入（原版 stype 40「入る土管(左から)」同条件）：
      //   pr > L-300、pl < L+sc-1000、pt > T+1000、pb < T+6400、着地
      if (!(pr > L - 300 && pl < L + s.sc - 1000)) return false;
      if (!(pt > T + 1000 && pb < T + 6400)) return false;
      if (p.mzimen !== 1) return false;
    } else { // right
      // 玩家在管口右侧按←走入（左开口条件的水平镜像）
      if (!(pl < R + 300 && pr > R - s.sc + 1000)) return false;
      if (!(pt > T + 1000 && pb < T + 6400)) return false;
      if (p.mzimen !== 1) return false;
    }

    p._pipeDir = dir;
    return true;
  }

  // ==================== 已注册的管道类型 ====================

  // stype 0: 地面（深绿实心矩形 + 黑边）
  PipeTypes[0] = {
    solid: true,
    render: function (ctx, s, x, y, w, h) {
      ctx.fillStyle = '#28c828'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#000'; ctx.strokeRect(x, y, w, h);
    }
  };

  // stype 1: 竖管口（亮绿实心矩形 + 黑边）
  PipeTypes[1] = {
    solid: true,
    render: function (ctx, s, x, y, w, h) {
      ctx.fillStyle = '#00e600'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#000'; ctx.strokeRect(x, y, w, h);
    }
  };

  // stype 2: 竖管身（只画左右竖线，y偏移1px，无上下边线）
  PipeTypes[2] = {
    solid: true,
    render: function (ctx, s, x, y, w, h) {
      ctx.fillStyle = '#00e600'; ctx.fillRect(x, y + 1, w, h);
      ctx.strokeStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x, y + h);
      ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h);
      ctx.stroke();
    }
  };

  // stype 5: 横管（只画上下横线，y偏移1px，无左右竖线）
  // sxtype 10/11：横向管道口，在对应端（左/右）画一圈略高出管身的管口沿（凸缘）
  PipeTypes[5] = {
    solid: true,
    render: function (ctx, s, x, y, w, h) {
      ctx.fillStyle = '#00e600'; ctx.fillRect(x, y + 1, w, h);
      ctx.strokeStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + w, y);
      ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h);
      ctx.stroke();
      if (s.sxtype === 10 || s.sxtype === 11) {
        var lipW = Math.max(8, w * 0.28);
        var lipX = s.sxtype === 10 ? x - 2 : x + w - lipW + 2;
        var lipY = y - 4, lipH = h + 8;
        ctx.fillStyle = '#00e600'; ctx.fillRect(lipX, lipY, lipW, lipH);
        ctx.strokeStyle = '#000'; ctx.strokeRect(lipX, lipY, lipW, lipH);
      }
    }
  };

  // stype 40: 左进入管道（与竖管口相同，y偏移1px）
  // 原版左进入管道：玩家在左侧按→进入，进入下一子关（stc++）
  PipeTypes[40] = {
    solid: true,
    render: function (ctx, s, x, y, w, h) {
      ctx.fillStyle = '#00e600'; ctx.fillRect(x, y + 1, w, h);
      ctx.strokeStyle = '#000'; ctx.strokeRect(x, y + 1, w, h);
    },
    onEnter: function (p, s, xx, state) {
      var C = getC();
      if (pipeEnterCheck(p, s, xx)) {
        p.mtype = C.MTYPE.PIPE; p.mtm = 0; p.mxtype = 1;
        p._warp = null;
        p._trapPipe = null;
        return true;
      }
      return false;
    }
  };

  // stype 50: 可进入管道（支持四方向）
  // dir='up'(默认竖管)/'down'(倒置竖管)/'left'(左开口横管)/'right'(右开口横管)
  // 竖管：w=60(sa固定6000), h=变长; 横管：w=变长, h=60(sd固定6000)
  PipeTypes[50] = {
    solid: true,
    render: function (ctx, s, x, y, w, h) {
      var dir = s.dir || 'up';
      var PIPE_OVER = 4;
      ctx.fillStyle = '#00e600'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      if (dir === 'left') {
        ctx.fillRect(x + 1, y, 30, 60); ctx.strokeRect(x + 1, y, 30, 60);
        ctx.fillRect(x + 30, y + 5, w - 30 + PIPE_OVER, 50);
        ctx.beginPath();
        ctx.moveTo(x + 30, y + 5); ctx.lineTo(x + w + PIPE_OVER, y + 5);
        ctx.moveTo(x + 30, y + 55); ctx.lineTo(x + w + PIPE_OVER, y + 55);
        ctx.stroke();
      } else if (dir === 'right') {
        ctx.fillRect(x + w - 31, y, 30, 60); ctx.strokeRect(x + w - 31, y, 30, 60);
        ctx.fillRect(x - PIPE_OVER, y + 5, w - 30 + PIPE_OVER, 50);
        ctx.beginPath();
        ctx.moveTo(x - PIPE_OVER, y + 5); ctx.lineTo(x + w - 30, y + 5);
        ctx.moveTo(x - PIPE_OVER, y + 55); ctx.lineTo(x + w - 30, y + 55);
        ctx.stroke();
      } else if (dir === 'down') {
        ctx.fillRect(x + 5, y - PIPE_OVER, 50, h - 30 + PIPE_OVER);
        ctx.beginPath();
        ctx.moveTo(x + 5, y - PIPE_OVER); ctx.lineTo(x + 5, y + h - 30);
        ctx.moveTo(x + 55, y - PIPE_OVER); ctx.lineTo(x + 55, y + h - 30);
        ctx.stroke();
        ctx.fillRect(x, y + h - 31, 60, 30); ctx.strokeRect(x, y + h - 31, 60, 30);
      } else {
        ctx.fillRect(x + 5, y + 30, 50, h - 30 + PIPE_OVER);
        ctx.beginPath();
        ctx.moveTo(x + 5, y + 30); ctx.lineTo(x + 5, y + h + PIPE_OVER);
        ctx.moveTo(x + 55, y + 30); ctx.lineTo(x + 55, y + h + PIPE_OVER);
        ctx.stroke();
        ctx.fillRect(x, y + 1, 60, 30); ctx.strokeRect(x, y + 1, 60, 30);
      }
    },
    onEnter: function (p, s, xx, state) {
      var C = getC();
      if (pipeEnterCheck(p, s, xx)) {
        p.mtype = C.MTYPE.PIPE; p.mtm = 0; p.mxtype = s.sxtype;
        // sxtype===0 为陷阱管道：记录管道对象，动画期间驱动管道本体抖动/上升
        p._trapPipe = (s.sxtype === 0) ? s : null;
        return true;
      }
      return false;
    }
  };

  // stype 60: 传送管道口（外观同可进入竖管，管口中央有黄色菱形标记）
  // 玩家按↓进入后，引擎在进管动画结束时调用 state.onWarp(s.warp)：
  //   warp = { end:true }              → 游戏结束/通关
  //   warp = { id:'1-2' }              → 传送到指定世界
  // onWarp 返回 false 表示宿主自行处理结局（不再重载关卡）；否则引擎重载关卡。
  PipeTypes[60] = {
    solid: true,
    render: function (ctx, s, x, y, w, h) {
      var dir = s.dir || 'up';
      var PIPE_OVER = 4;
      ctx.fillStyle = '#00e600'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      var markCx, markCy;
      if (dir === 'left') {
        ctx.fillRect(x + 1, y, 30, 60); ctx.strokeRect(x + 1, y, 30, 60);
        ctx.fillRect(x + 30, y + 5, w - 30 + PIPE_OVER, 50);
        ctx.beginPath();
        ctx.moveTo(x + 30, y + 5); ctx.lineTo(x + w + PIPE_OVER, y + 5);
        ctx.moveTo(x + 30, y + 55); ctx.lineTo(x + w + PIPE_OVER, y + 55); ctx.stroke();
        markCx = x + 16; markCy = y + 30;
      } else if (dir === 'right') {
        ctx.fillRect(x + w - 31, y, 30, 60); ctx.strokeRect(x + w - 31, y, 30, 60);
        ctx.fillRect(x - PIPE_OVER, y + 5, w - 30 + PIPE_OVER, 50);
        ctx.beginPath();
        ctx.moveTo(x - PIPE_OVER, y + 5); ctx.lineTo(x + w - 30, y + 5);
        ctx.moveTo(x - PIPE_OVER, y + 55); ctx.lineTo(x + w - 30, y + 55); ctx.stroke();
        markCx = x + w - 15; markCy = y + 30;
      } else if (dir === 'down') {
        ctx.fillRect(x + 5, y - PIPE_OVER, 50, h - 30 + PIPE_OVER);
        ctx.beginPath();
        ctx.moveTo(x + 5, y - PIPE_OVER); ctx.lineTo(x + 5, y + h - 30);
        ctx.moveTo(x + 55, y - PIPE_OVER); ctx.lineTo(x + 55, y + h - 30); ctx.stroke();
        ctx.fillRect(x, y + h - 31, 60, 30); ctx.strokeRect(x, y + h - 31, 60, 30);
        markCx = x + 30; markCy = y + h - 16;
      } else { // up
        ctx.fillRect(x + 5, y + 30, 50, h - 30 + PIPE_OVER);
        ctx.beginPath();
        ctx.moveTo(x + 5, y + 30); ctx.lineTo(x + 5, y + h + PIPE_OVER);
        ctx.moveTo(x + 55, y + 30); ctx.lineTo(x + 55, y + h + PIPE_OVER); ctx.stroke();
        ctx.fillRect(x, y + 1, 60, 30); ctx.strokeRect(x, y + 1, 60, 30);
        markCx = x + 30; markCy = y + 16;
      }
      ctx.fillStyle = '#ffe600';
      ctx.beginPath();
      ctx.moveTo(markCx, markCy - 8); ctx.lineTo(markCx + 8, markCy);
      ctx.lineTo(markCx, markCy + 8); ctx.lineTo(markCx - 8, markCy);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.stroke();
    },
    onEnter: function (p, s, xx, state) {
      var C = getC();
      if (pipeEnterCheck(p, s, xx)) {
        p.mtype = C.MTYPE.PIPE; p.mtm = 0; p.mxtype = 1;
        // 带上管道实例 uid，供直接通关(warp.end)事件溯源
        p._warp = s.warp ? { end: !!s.warp.end, id: s.warp.id || null, uid: s.uid || null } : null;
        p._trapPipe = null;
        return true;
      }
      return false;
    }
  };

  // stype 51: 下落块（使用砖块精灵铺排）
  // 两种驱动方式：
  //   1) 经典关卡（无 mov）：sxtype=0 横排砖块，玩家完全进入水平区域且在下方时坠落，
  //      运动中无实体碰撞、碰到玩家即致死（main.cpp:2471-2501）；
  //      sxtype=10 触发余量更小（+1200）；sxtype=3/4 按玩家高度 mb 阈值触发（1-4 城堡）；
  //      sxtype=1/2 地下砖横排（1-2-1 连锁崩塌桥），原版为链式触发（引用其它对象索引），
  //      通用化为玩家触发 + delay 延时（秒，loadStage 对原版数据注入近似值）。
  //   2) 通用配置 mov={axis:'x'|'y', dir:-1|1}（编辑器"坠落砖组"）：横排沿 y、竖排沿 x，
  //      长轴"完全进入"+ 位于运动方向一侧时触发，四方向均可。
  // delay 属性（秒，默认0）：触发后等待指定秒数才开始坠落（延时期间保持实体可踩）。
  // chain 属性（默认空=靠近触发）：本砖组被触发时联动触发目标砖组（按 uid 引用，
  //   目标按自身 delay 倒计时后坠落）；沿链递归传播，已触发的目标不重复触发（天然防环）。
  // physics 返回 true = 本帧运动中，引擎跳过该实体的常规碰撞。

  // 链式触发：沿 chain 引用递归触发后续坠落砖组（stype=51），各自按自身 delay 倒计时
  function triggerFallChain(s, state, depth) {
    if (!s.chain || depth > 8) return;
    var list = state.pipes || [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t.uid && t.uid === s.chain && t.stype === 51 && t.sgtype === 0) {
        t.sgtype = 1;
        if (t.sr == null) t.sr = 0;
        t.sdelay = Math.max(0, Math.round((t.delay || 0) * 60));
        triggerFallChain(t, state, depth + 1);
      }
    }
  }

  PipeTypes[51] = {
    solid: true,
    physics: function (p, s, xx, state) {
      if (s.noauto) return false;   // 静态砖（block_brick_m）：永不自动触发，仅事件 move 平移 sa/sb
      var C = getC();
      var chainTrig = false;   // sxtype=1/2 连锁触发（旧引擎语义：立即坠落、不外传链）
      if (s.sgtype === 0) {
        var triggered = false;
        if (s.mov) {
          // 通用砖组：长轴完全进入 + 处于运动方向一侧
          var longIn, onSide;
          if (s.mov.axis === 'y') {
            longIn = p.ma + p.mnobia > s.sa + 3200 && p.ma + p.mnobia < s.sa + s.sc - 200;
            onSide = s.mov.dir > 0
              ? (p.mb + p.mnobib > s.sb + 3000)   // 向下：玩家在下方
              : (p.mb < s.sb - 3000);              // 向上：玩家在上方
          } else {
            longIn = p.mb + p.mnobib > s.sb + 3200 && p.mb + p.mnobib < s.sb + s.sd - 200;
            onSide = s.mov.dir < 0
              ? (p.ma + p.mnobia < s.sa - 200)     // 向左：玩家在左侧
              : (p.ma > s.sa + s.sc + 200);        // 向右：玩家在右侧
          }
          if (longIn && onSide) triggered = true;
        } else if (s.sxtype === 0 || s.sxtype === 10) {
          // 经典横排：右缘越过第一块砖（sxtype10 余量 1200）+ 脚底在砖组顶下方
          var margin = s.sxtype === 10 ? 1200 : 3200;
          if (p.ma + p.mnobia > s.sa + margin && p.ma + p.mnobia < s.sa + s.sc - 200 &&
              p.mb + p.mnobib > s.sb + 3000) triggered = true;
        } else if (s.sxtype === 1 || s.sxtype === 2) {
          if (s.chain) {
            // 旧引擎连锁崩塌桥（main.cpp:2484-2488，1-2-1）：不自触发（无靠近检测），
            // 仅当链式监视目标坠落到位后触发，延时无效、立即坠落：
            //   sxtype=1：目标坠落至绝对高度 sb>=25000 且玩家右缘在目标左侧（回头陷阱）
            //   sxtype=2：目标坠落至绝对高度 sb>=48000 且玩家存活
            var tgt = null;
            for (var fi = 0; fi < state.pipes.length; fi++) {
              var fp = state.pipes[fi];
              if (fp !== s && fp.uid && fp.uid === s.chain) { tgt = fp; break; }
            }
            if (tgt && tgt.stype === 51) {
              var th = s.sxtype === 1 ? 25000 : 48000;
              if (tgt.sb >= th) {
                if (s.sxtype === 1) { if (tgt.sa > p.ma + p.mnobia) { triggered = true; chainTrig = true; } }
                else if (p.mhp >= 1) { triggered = true; chainTrig = true; }
              }
            }
          } else {
            // 兜底：未接线（编辑器单独放置的地下砖组）→ 退化为靠近触发（同 sxtype=0），延时有效
            if (p.ma + p.mnobia > s.sa + 3200 && p.ma + p.mnobia < s.sa + s.sc - 200 &&
                p.mb + p.mnobib > s.sb + 3000) triggered = true;
          }
        } else if (s.sxtype === 3 || s.sxtype === 4) {
          // 城堡二维砖块阵：玩家到达固定高度且水平进入时坠落（sxtype4 带 100 初速）
          var hmin = s.sxtype === 3 ? 30000 : 25000;
          if (p.mb >= hmin &&
              p.ma + p.mnobia > s.sa + 2700 && p.ma + p.mnobia < s.sa + s.sc - 200) {
            triggered = true;
            s.sr = s.sxtype === 4 ? 100 : 0;
          }
        }
        if (triggered) {
          s.sgtype = 1;
          if (s.sr == null) s.sr = 0;
          if (chainTrig) {
            // 连锁崩塌桥：旧引擎无延时概念，立即坠落
            s.sdelay = 0;
          } else {
            // 延时：触发后等待 delay 秒才开始运动（sdelay 单位=帧）
            s.sdelay = Math.max(0, Math.round((s.delay || 0) * 60));
            // 链式触发：联动触发 chain 指向的目标砖组
            triggerFallChain(s, state, 0);
          }
        }
      }

      if (s.sgtype !== 1) return false;

      // 延时倒计时：保持原位（实体可踩），归零后开始加速坠落
      if (s.sdelay > 0) { s.sdelay--; return false; }

      // 加速运动（原版 30fps：每帧 +120，上限 1600）
      s.sr = Math.min((s.sr || 0) + 120, 1600);
      if (s.mov) {
        if (s.mov.axis === 'x') s.sa += s.sr * s.mov.dir;
        else s.sb += s.sr * s.mov.dir;
      } else {
        s.sb += s.sr;
      }

      // 飞出镜头范围：经典向下超过 FYMAX+18000 后冻结（与原版一致，永不复位）；
      // 通用四方向离开镜头 20000 后置哨兵彻底停用
      var out = false;
      if (s.mov) {
        if (s.mov.axis === 'x') {
          out = s.mov.dir > 0
            ? s.sa > state.fx + C.FXMAX + 20000
            : s.sa < state.fx - 20000;
        } else {
          out = s.mov.dir > 0 ? s.sb > C.FYMAX + 20000 : s.sb < -20000;
        }
      } else if (s.sb > C.FYMAX + 18000) {
        s.sgtype = 2;
        return false;
      }
      if (out) { s.sa = -80000000; return false; }

      // 运动中与玩家相交即致死（头顶被砸/身体触碰同理；不用无敌帧，与原版 mhp-- 一致）
      if (p.ma + p.mnobia > s.sa + 200 && p.ma < s.sa + s.sc - 200 &&
          p.mb + p.mnobib > s.sb && p.mb < s.sb + s.sd + 200) {
        // 调试：记录伤害来源实例 uid（state._lastHurt 由 engine 在玩家死亡时输出）
        state._lastHurt = { reason: 'fall-brick', uid: s.uid || null };
        p.mhp--;
      }
      return true;
    },
    render: function (ctx, s, x, y, w, h, state) {
      var S = getS();
      var offset = stageColorOffset(state);
      if (s.sxtype === 0) {
        if (s.mov && s.mov.axis === 'x') {
          // 通用竖排砖组
          var rowsV = Math.floor(s.sd / 3000);
          for (var rv = 0; rv <= rowsV; rv++)
            S && S.draw(ctx, 1 + offset, 1, x, y + 29 * rv);
        } else {
          var cols = Math.floor(s.sc / 3000);
          for (var c = 0; c <= cols; c++)
            S && S.draw(ctx, 1 + offset, 1, x + 29 * c, y);
        }
      } else if (s.sxtype === 1 || s.sxtype === 2) {
        // 地下砖样式（固定 grap[31]，不随主题偏移）；竖排由编辑器 mov 配置
        if (s.mov && s.mov.axis === 'x') {
          var rowsD = Math.floor(s.sd / 3000);
          for (var rd = 0; rd <= rowsD; rd++)
            S && S.draw(ctx, 31, 1, x, y + 29 * rd);
        } else {
          var colsD = Math.floor(s.sc / 3000);
          for (var cd = 0; cd <= colsD; cd++)
            S && S.draw(ctx, 31, 1, x + 29 * cd, y);
        }
      } else if (s.sxtype === 3 || s.sxtype === 4 || s.sxtype === 10) {
        drawTileGrid(ctx, s, x, y, w, h, 65, 1);
      }
    }
  };

  // stype 52: 下落块2（使用地面精灵铺排）
  // 经典行为（main.cpp:2504-2512）：玩家深入水平区域（右缘 >sa+2200、左缘 <sa+sc-2700）
  // 且脚底接近砖顶（>sb-3000）即坠落；保持实体（可踩、可随其移动、顶头被推），不致死。
  PipeTypes[52] = {
    solid: true,
    physics: function (p, s) {
      var C = getC();
      if (s.sgtype === 0) {
        if (p.ma + p.mnobia > s.sa + 2200 && p.ma < s.sa + s.sc - 2700 &&
            p.mb + p.mnobib > s.sb - 3000) {
          s.sgtype = 1; s.sr = 0;
        }
      }
      if (s.sgtype === 1) {
        if (s.sb > C.FYMAX + 18000) { s.sgtype = 2; return false; }
        s.sr = Math.min((s.sr || 0) + 120, 1600);
        s.sb += s.sr;
      }
      return false;
    },
    render: function (ctx, s, x, y, w, h, state) {
      var S = getS();
      var offset = stageColorOffset(state);
      var cols = Math.floor(s.sc / 3000);
      for (var c = 0; c <= cols; c++) {
        if (s.sxtype === 0) {
          S && S.draw(ctx, 5 + offset, 1, x + 29 * c, y);
          if (!state || state._stagecolor !== 4)
            S && S.draw(ctx, 6 + offset, 1, x + 29 * c, y + 29);
          else
            S && S.draw(ctx, 5 + offset, 1, x + 29 * c, y + 29);
        } else if (s.sxtype === 1) {
          var rows = Math.floor(s.sd / 3000);
          for (var r = 0; r <= rows; r++)
            S && S.draw(ctx, 1 + offset, 1, x + 29 * c, y + 29 * r);
        } else if (s.sxtype === 2) {
          var rows2 = Math.floor(s.sd / 3000);
          for (var r2 = 0; r2 <= rows2; r2++)
            S && S.draw(ctx, 5 + offset, 1, x + 29 * c, y + 29 * r2);
        }
      }
    }
  };

  // stype 200: 块状地面（使用地面精灵铺排整片区域，按 stagecolor 变色）
  PipeTypes[200] = {
    solid: true,
    render: function (ctx, s, x, y, w, h, state) {
      var off = stageColorOffset(state);
      drawTileGrid(ctx, s, x, y, w, h, 5 + off, 1);
    }
  };

  // stype 300: 终点杆（白色杆 + 黑边 + 黄色圆球）
  PipeTypes[300] = {
    solid: false,
    render: function (ctx, s, x, y, w, h) {
      ctx.fillStyle = '#fff'; ctx.fillRect(x + 10, y, 10, h - 8);
      ctx.strokeStyle = '#000'; ctx.strokeRect(x + 10, y, 10, h - 8);
      ctx.fillStyle = '#fafa00';
      ctx.beginPath(); ctx.arc(x + 14, y, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.arc(x + 14, y, 10, 0, Math.PI * 2); ctx.stroke();
    },
    onCollide: function (p, s, xx, state, A) {
      var C = getC();
      if (p.mtype === 0 && p.mb < xx[9] + s.sd + xx[0] - 3000 && p.mhp >= 1) {
        // 记录旗杆实例 uid，供引擎在进入 GOAL_SLIDE 时写入通关事件
        state._goalTouchUid = s.uid || null;
        A.bgmStop(); p.mtype = C.MTYPE.GOAL_SLIDE; p.mtm = 0;
        p.ma = s.sa - 2000; A.playSE(C.SE.GOAL);
      }
    }
  };

  // stype 500: 中间旗（使用旗杆精灵）
  PipeTypes[500] = {
    solid: false,
    render: function (ctx, s, x, y, w, h) {
      var S = getS();
      S && S.draw(ctx, 20, 4, x, y);
    },
    onCollide: function (p, s, xx, state, A) {
      if (p.mtype === 0 && p.mhp >= 1) {
        // 记录检查点：旗子左缘 x、旗子顶部 y，复活时玩家自然落地
        state.checkpoint = { ma: s.sa, mb: s.sb };
        if (A) A.playSE(getC().SE.COIN);
        s.sa = -80000000;
      }
    }
  };

  // ---- 陷阱管道 (stype 100-104): 默认不可见，仅在调试模式显示边框 ----

  function makeTrapType(onCollideFn) {
    return {
      solid: false,
      debugColor: '#ff00ff',
      render: function (ctx, s, x, y, w, h, state) {
        if (state && state._showTraps) {
          ctx.strokeStyle = this.debugColor || '#ff00ff';
          ctx.strokeRect(x, y, w, h);
        }
      },
      onCollide: onCollideFn
    };
  }

  // stype 100: 生成猫脸怪
  PipeTypes[100] = makeTrapType(function (p, s, xx, state, A, spawnEnemy) {
    if (s.sxtype === 0 || (s.sxtype === 1)) {
      spawnEnemy(s.sa + 1000, 32000, 0, 0, 0, 3, 0);
      s.sa = -800000000; A.playSE(10);
    }
  });

  // stype 101: 火焰管道（从上方喷出幽灵）
  PipeTypes[101] = makeTrapType(function (p, s, xx, state, A, spawnEnemy) {
    spawnEnemy(s.sa + 6000, -4000, 0, 0, 0, 3, 1);
    s.sa = -800000000; A.playSE(10);
  });

  // stype 102: 陷阱管道（根据 sxtype 生成不同敌人）
  PipeTypes[102] = makeTrapType(function (p, s, xx, state, A, spawnEnemy) {
    if (s.sxtype === 0) {
      for (var t3 = 0; t3 <= 3; t3++)
        spawnEnemy(s.sa + t3 * 3000, -3000, 0, 0, 0, 0, 0);
    } else if (s.sxtype === 1 && p.mb >= 16000) {
      spawnEnemy(s.sa + 1500, 44000, 0, -2000, 0, 4, 0);
    } else if (s.sxtype === 2) {
      spawnEnemy(s.sa + 4500, 30000, 0, -1600, 0, 5, 0);
      A.playSE(10); s.sxtype = 3; s.sa -= 12000;
    } else if (s.sxtype === 3) {
      s.sa += 12000; s.sxtype = 4;
    } else if (s.sxtype === 4) {
      spawnEnemy(s.sa + 4500, 30000, 0, -1600, 0, 5, 0);
      A.playSE(10); s.sxtype = 5; s.sxtype = 0;
    } else if (s.sxtype === 7) {
      state.mainmsgtype = 1;
    } else if (s.sxtype === 8) {
      spawnEnemy(s.sa - 8000, 26000, 0, -1600, 0, 5, 0);
      A.playSE(10);
    } else if (s.sxtype === 9) {
      for (var t = 0; t <= 2; t++)
        spawnEnemy(s.sa + t * 3000 + 3000, 48000, 0, -6000, 0, 3, 0);
    } else if (s.sxtype === 10) {
      s.sa -= 15000; s.stype = 101;
    } else if (s.sxtype === 12) {
      for (var t2 = 1; t2 <= 3; t2++)
        spawnEnemy(s.sa + t2 * 3000 - 1000, 40000, 0, -2600, 0, 9, 0);
    } else if (s.sxtype === 20) {
      state.scrollx = 0;
    } else if (s.sxtype === 30) {
      s.sa = -80000000; p.md = 0;
      A.bgmStop(); p.mtype = 302; p.mtm = 0; A.playSE(16);
    }
    if (s.sxtype !== 3 && s.sxtype !== 4 && s.sxtype !== 10) {
      s.sa = -800000000;
    }
  });

  // stype 103: 陷阱消息（生成消息 NPC）
  PipeTypes[103] = makeTrapType(function (p, s, xx, state, A, spawnEnemy) {
    if (s.sxtype === 0) {
      spawnEnemy(s.sa + 9000, s.sb + 2000, 0, 0, 0, 79, 0);
      s.sa = -800000000;
    }
  });

  // stype 104: 光束陷阱（生成多个消息 NPC）
  PipeTypes[104] = makeTrapType(function (p, s, xx, state, A, spawnEnemy) {
    if (s.sxtype === 0) {
      for (var i = 0; i <= 4; i++)
        spawnEnemy(s.sa + 12000, s.sb + 5000, 0, 0, 0, 79, i);
      s.sa = -800000000;
    }
  });

  // ==================== 连接管道（精确碰撞 + 统一边框）====================
  // 拆分策略：play.html convert 时每个 connector 生成 1+N 条碰撞 pipe + 1 条边框 pipe
  //   stype 74: 中心块 2×2 tile — 只 fillRect（碰撞）
  //   stype 75: 单臂段 — 只 fillRect（碰撞）
  //   stype 76: 统一边框 pipe（非实体）— 完整 stub + 2-side + 去帽 边框渲染（与编辑器一致）

  PipeTypes[74] = {
    solid: true,
    render: function (ctx, s, x, y, w, h) {
      ctx.fillStyle = '#00e600';
      ctx.fillRect(x, y, w, h);
      // 边框由 stype 76 统一画，这里不 stroke
    }
  };

  PipeTypes[75] = {
    solid: true,
    render: function (ctx, s, x, y, w, h) {
      ctx.fillStyle = '#00e600';
      var HALF = 4;
      var PIPE_OVER = 4;
      if (s.dir === 'up' || s.dir === 'down') {
        // 竖臂：管身沿 y 方向延伸，末端溢出 PIPE_OVER
        if (s.dir === 'down') {
          ctx.fillRect(x + HALF, y, 50, h + PIPE_OVER);
        } else {
          ctx.fillRect(x + HALF, y - PIPE_OVER, 50, h + PIPE_OVER);
        }
      } else {
        // 横臂：管身沿 x 方向延伸
        if (s.dir === 'right') {
          ctx.fillRect(x, y + HALF, w + PIPE_OVER, 50);
        } else {
          ctx.fillRect(x - PIPE_OVER, y + HALF, w + PIPE_OVER, 50);
        }
      }
    }
  };

  PipeTypes[76] = {
    solid: false,
    render: function (ctx, s, x, y, w, h) {
      var TILE_PX = 29;
      var PIPE_W = 50;
      var HALF_PIPE_W = 25;
      var PIPE_OVER = 4;
      // s.lengths = [up, down, left, right]，s.dirs = ['up', 'right', ...] 或 s.rot+s.id
      var L = s.lengths || [1, 1, 1, 1];
      for (var _i = 0; _i < 4; _i++) L[_i] = Math.max(1, Math.min(4, L[_i] | 0 || 1));
      var dirs = s.dirs || ['up', 'down', 'left', 'right'];
      var dirLen = { up: L[0], down: L[1], left: L[2], right: L[3] };
      var hasArm = { up: false, down: false, left: false, right: false };
      dirs.forEach(function (dd) { hasArm[dd] = true; });
      var centerX = x + L[2] * TILE_PX;
      var centerY = y + L[0] * TILE_PX;

      ctx.strokeStyle = '#000'; ctx.lineWidth = 2;

      // 中心块 4 条边的 stub
      ctx.beginPath();
      if (hasArm.up) {
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(centerX + TILE_PX - HALF_PIPE_W, centerY);
        ctx.moveTo(centerX + TILE_PX + HALF_PIPE_W, centerY);
        ctx.lineTo(centerX + 2 * TILE_PX, centerY);
      } else { ctx.moveTo(centerX, centerY); ctx.lineTo(centerX + 2 * TILE_PX, centerY); }
      ctx.stroke();

      ctx.beginPath();
      if (hasArm.down) {
        ctx.moveTo(centerX, centerY + 2 * TILE_PX);
        ctx.lineTo(centerX + TILE_PX - HALF_PIPE_W, centerY + 2 * TILE_PX);
        ctx.moveTo(centerX + TILE_PX + HALF_PIPE_W, centerY + 2 * TILE_PX);
        ctx.lineTo(centerX + 2 * TILE_PX, centerY + 2 * TILE_PX);
      } else { ctx.moveTo(centerX, centerY + 2 * TILE_PX); ctx.lineTo(centerX + 2 * TILE_PX, centerY + 2 * TILE_PX); }
      ctx.stroke();

      ctx.beginPath();
      if (hasArm.left) {
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(centerX, centerY + TILE_PX - HALF_PIPE_W);
        ctx.moveTo(centerX, centerY + TILE_PX + HALF_PIPE_W);
        ctx.lineTo(centerX, centerY + 2 * TILE_PX);
      } else { ctx.moveTo(centerX, centerY); ctx.lineTo(centerX, centerY + 2 * TILE_PX); }
      ctx.stroke();

      ctx.beginPath();
      if (hasArm.right) {
        ctx.moveTo(centerX + 2 * TILE_PX, centerY);
        ctx.lineTo(centerX + 2 * TILE_PX, centerY + TILE_PX - HALF_PIPE_W);
        ctx.moveTo(centerX + 2 * TILE_PX, centerY + TILE_PX + HALF_PIPE_W);
        ctx.lineTo(centerX + 2 * TILE_PX, centerY + 2 * TILE_PX);
      } else { ctx.moveTo(centerX + 2 * TILE_PX, centerY); ctx.lineTo(centerX + 2 * TILE_PX, centerY + 2 * TILE_PX); }
      ctx.stroke();

      // 每臂 2 侧（去帽，端口开口，末端溢出 OVER 与邻管无缝）
      dirs.forEach(function (dd) {
        var len = dirLen[dd];
        var armPx = len * TILE_PX;
        ctx.beginPath();
        if (dd === 'up') {
          var ux = centerX + TILE_PX - HALF_PIPE_W, uy = centerY - armPx - PIPE_OVER;
          ctx.moveTo(ux, uy); ctx.lineTo(ux, centerY);
          ctx.moveTo(ux + PIPE_W, uy); ctx.lineTo(ux + PIPE_W, centerY);
        } else if (dd === 'down') {
          var dx = centerX + TILE_PX - HALF_PIPE_W;
          var dy1 = centerY + 2 * TILE_PX, dy2 = dy1 + armPx + PIPE_OVER;
          ctx.moveTo(dx, dy1); ctx.lineTo(dx, dy2);
          ctx.moveTo(dx + PIPE_W, dy1); ctx.lineTo(dx + PIPE_W, dy2);
        } else if (dd === 'left') {
          var ly = centerY + TILE_PX - HALF_PIPE_W, lx1 = centerX - armPx - PIPE_OVER;
          ctx.moveTo(lx1, ly); ctx.lineTo(centerX, ly);
          ctx.moveTo(lx1, ly + PIPE_W); ctx.lineTo(centerX, ly + PIPE_W);
        } else if (dd === 'right') {
          var rx = centerX + 2 * TILE_PX, ry = centerY + TILE_PX - HALF_PIPE_W;
          ctx.moveTo(rx, ry); ctx.lineTo(rx + armPx + PIPE_OVER, ry);
          ctx.moveTo(rx, ry + PIPE_W); ctx.lineTo(rx + armPx + PIPE_OVER, ry + PIPE_W);
        }
        ctx.stroke();
      });
    }
  };

  // ==================== 注册接口 ====================

  // 注册新的管道类型（供编辑器使用）
  PipeTypes.register = function (id, config) {
    PipeTypes[id] = config;
  };

  // 获取管道类型配置
  PipeTypes.get = function (id) {
    return PipeTypes[id] || null;
  };

  // 查询是否为实体（有物理碰撞）
  PipeTypes.isSolid = function (id) {
    var t = PipeTypes[id];
    return t ? !!t.solid : (id <= 99 || id === 200);
  };

  // 查询是否有自定义渲染
  PipeTypes.hasRender = function (id) {
    var t = PipeTypes[id];
    return t && typeof t.render === 'function';
  };

  // 列出所有已注册类型 ID
  PipeTypes.list = function () {
    return Object.keys(PipeTypes).filter(function (k) {
      return k !== 'register' && k !== 'get' && k !== 'isSolid' && k !== 'hasRender' && k !== 'list';
    }).map(Number).sort(function (a, b) { return a - b; });
  };

  global.PipeTypes = PipeTypes;
})(window);
