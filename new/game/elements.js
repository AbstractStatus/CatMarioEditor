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
  PipeTypes[40] = {
    solid: true,
    render: function (ctx, s, x, y, w, h) {
      ctx.fillStyle = '#00e600'; ctx.fillRect(x, y + 1, w, h);
      ctx.strokeStyle = '#000'; ctx.strokeRect(x, y + 1, w, h);
    }
  };

  // stype 50: 可进入管道（支持四方向）
  // dir='up'(默认竖管)/'down'(倒置竖管)/'left'(左开口横管)/'right'(右开口横管)
  // 竖管：w=60(sa固定6000), h=变长; 横管：w=变长, h=60(sd固定6000)
  PipeTypes[50] = {
    solid: true,
    render: function (ctx, s, x, y, w, h) {
      var dir = s.dir || 'up';
      ctx.fillStyle = '#00e600'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      if (dir === 'left') {
        // 横管：管口在左侧 x 起 30px，管身向右延伸 50px 高
        ctx.fillRect(x + 1, y, 30, 60); ctx.strokeRect(x + 1, y, 30, 60);
        ctx.fillRect(x + 30, y + 5, w - 30, 50);
        ctx.beginPath();
        ctx.moveTo(x + 30, y + 5); ctx.lineTo(x + w, y + 5);
        ctx.moveTo(x + 30, y + 55); ctx.lineTo(x + w, y + 55);
        ctx.stroke();
      } else if (dir === 'right') {
        // 横管：管口在右侧 w-30 起 30px，管身向左
        ctx.fillRect(x + w - 31, y, 30, 60); ctx.strokeRect(x + w - 31, y, 30, 60);
        ctx.fillRect(x, y + 5, w - 30, 50);
        ctx.beginPath();
        ctx.moveTo(x, y + 5); ctx.lineTo(x + w - 30, y + 5);
        ctx.moveTo(x, y + 55); ctx.lineTo(x + w - 30, y + 55);
        ctx.stroke();
      } else if (dir === 'down') {
        // 竖管倒置：管口在底部，管身向上延伸
        ctx.fillRect(x + 5, y, 50, h - 30);
        ctx.beginPath();
        ctx.moveTo(x + 5, y); ctx.lineTo(x + 5, y + h - 30);
        ctx.moveTo(x + 55, y); ctx.lineTo(x + 55, y + h - 30);
        ctx.stroke();
        ctx.fillRect(x, y + h - 31, 60, 30); ctx.strokeRect(x, y + h - 31, 60, 30);
      } else {
        // dir='up' 默认竖管：管口在顶部，管身向下
        ctx.fillRect(x + 5, y + 30, 50, h - 30);
        ctx.beginPath();
        ctx.moveTo(x + 5, y + 30); ctx.lineTo(x + 5, y + h);
        ctx.moveTo(x + 55, y + 30); ctx.lineTo(x + 55, y + h);
        ctx.stroke();
        ctx.fillRect(x, y + 1, 60, 30); ctx.strokeRect(x, y + 1, 60, 30);
      }
    },
    onEnter: function (p, s, xx, state) {
      var C = getC();
      if (p.ma + p.mnobia > xx[8] + 2800 && p.ma < xx[8] + s.sc - 3000 &&
          p.mb + p.mnobib > xx[9] - 1000 && p.mb + p.mnobib < xx[9] + xx[1] + 3000 &&
          p.mzimen === 1 && p.actaon[3] === 1 && p.mtype === 0) {
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
      ctx.fillStyle = '#00e600'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      var markCx, markCy;
      if (dir === 'left') {
        ctx.fillRect(x + 1, y, 30, 60); ctx.strokeRect(x + 1, y, 30, 60);
        ctx.fillRect(x + 30, y + 5, w - 30, 50);
        ctx.beginPath();
        ctx.moveTo(x + 30, y + 5); ctx.lineTo(x + w, y + 5);
        ctx.moveTo(x + 30, y + 55); ctx.lineTo(x + w, y + 55); ctx.stroke();
        markCx = x + 16; markCy = y + 30;
      } else if (dir === 'right') {
        ctx.fillRect(x + w - 31, y, 30, 60); ctx.strokeRect(x + w - 31, y, 30, 60);
        ctx.fillRect(x, y + 5, w - 30, 50);
        ctx.beginPath();
        ctx.moveTo(x, y + 5); ctx.lineTo(x + w - 30, y + 5);
        ctx.moveTo(x, y + 55); ctx.lineTo(x + w - 30, y + 55); ctx.stroke();
        markCx = x + w - 15; markCy = y + 30;
      } else if (dir === 'down') {
        ctx.fillRect(x + 5, y, 50, h - 30);
        ctx.beginPath();
        ctx.moveTo(x + 5, y); ctx.lineTo(x + 5, y + h - 30);
        ctx.moveTo(x + 55, y); ctx.lineTo(x + 55, y + h - 30); ctx.stroke();
        ctx.fillRect(x, y + h - 31, 60, 30); ctx.strokeRect(x, y + h - 31, 60, 30);
        markCx = x + 30; markCy = y + h - 16;
      } else { // up
        ctx.fillRect(x + 5, y + 30, 50, h - 30);
        ctx.beginPath();
        ctx.moveTo(x + 5, y + 30); ctx.lineTo(x + 5, y + h);
        ctx.moveTo(x + 55, y + 30); ctx.lineTo(x + 55, y + h); ctx.stroke();
        ctx.fillRect(x, y + 1, 60, 30); ctx.strokeRect(x, y + 1, 60, 30);
        markCx = x + 30; markCy = y + 16;
      }
      // 传送标记：管口中央黄色菱形
      ctx.fillStyle = '#ffe600';
      ctx.beginPath();
      ctx.moveTo(markCx, markCy - 8); ctx.lineTo(markCx + 8, markCy);
      ctx.lineTo(markCx, markCy + 8); ctx.lineTo(markCx - 8, markCy);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.stroke();
    },
    onEnter: function (p, s, xx, state) {
      var C = getC();
      if (p.ma + p.mnobia > xx[8] + 2800 && p.ma < xx[8] + s.sc - 3000 &&
          p.mb + p.mnobib > xx[9] - 1000 && p.mb + p.mnobib < xx[9] + xx[1] + 3000 &&
          p.mzimen === 1 && p.actaon[3] === 1 && p.mtype === 0) {
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
  //      sxtype=1/2 与陷阱管道联动，维持现状（静态实体）。
  //   2) 通用配置 mov={axis:'x'|'y', dir:-1|1}（编辑器“坠落砖组”）：横排沿 y、竖排沿 x，
  //      长轴“完全进入”+ 位于运动方向一侧时触发，四方向均可。
  // physics 返回 true = 本帧运动中，引擎跳过该实体的常规碰撞。
  PipeTypes[51] = {
    solid: true,
    physics: function (p, s, xx, state) {
      var C = getC();
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
        } else if (s.sxtype === 3 || s.sxtype === 4) {
          // 城堡二维砖块阵：玩家到达固定高度且水平进入时坠落（sxtype4 带 100 初速）
          var hmin = s.sxtype === 3 ? 30000 : 25000;
          if (p.mb >= hmin &&
              p.ma + p.mnobia > s.sa + 2700 && p.ma + p.mnobia < s.sa + s.sc - 200) {
            triggered = true;
            s.sr = s.sxtype === 4 ? 100 : 0;
          }
        }
        if (triggered) { s.sgtype = 1; if (s.sr == null) s.sr = 0; }
      }

      if (s.sgtype !== 1) return false;

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
        var cols2 = Math.floor(s.sc / 3000);
        for (var c2 = 0; c2 <= cols2; c2++)
          S && S.draw(ctx, 31, 1, x + 29 * c2, y);
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
      // 臂段只居中填管身（50px 宽），不画整 tile 避免视觉溢出
      // dir=up/down → 管身垂直 50px 宽；dir=left/right → 管身水平 50px 高
      ctx.fillStyle = '#00e600';
      var HALF = 4; // (58-50)/2 = 4px 偏移
      if (s.dir === 'up' || s.dir === 'down') {
        ctx.fillRect(x + HALF, y, 50, h);
      } else {
        ctx.fillRect(x, y + HALF, w, 50);
      }
      // 边框由 stype 76 统一画
    }
  };

  PipeTypes[76] = {
    solid: false,
    render: function (ctx, s, x, y, w, h) {
      // 统一边框：与 editor.js drawElement connector 完全一致的 stub + 2-side + 去帽
      var TILE_PX = 29;
      var PIPE_W = 50;
      var HALF_PIPE_W = 25;
      // s.lengths = [up, down, left, right]，s.dirs = ['up', 'right', ...] 或 s.rot+s.id
      var L = s.lengths || [1, 1, 1, 1];
      for (var _i = 0; _i < 4; _i++) L[_i] = Math.max(1, Math.min(4, L[_i] | 0 || 1));
      var dirs = s.dirs || ['up', 'down', 'left', 'right'];
      var dirLen = { up: L[0], down: L[1], left: L[2], right: L[3] };
      var hasArm = { up: false, down: false, left: false, right: false };
      dirs.forEach(function (dd) { hasArm[dd] = true; });
      // 原始锚点 tile 的虚拟像素坐标（相对于 s 的 bounding box 左上角 x, y）
      // 中心块左上角 = x + leftLen*TILE_PX, y + upLen*TILE_PX
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

      // 每臂 2 侧（去帽，端口开口）
      dirs.forEach(function (dd) {
        var len = dirLen[dd];
        var armPx = len * TILE_PX;
        ctx.beginPath();
        if (dd === 'up') {
          var ux = centerX + TILE_PX - HALF_PIPE_W, uy = centerY - armPx;
          ctx.moveTo(ux, uy); ctx.lineTo(ux, centerY);
          ctx.moveTo(ux + PIPE_W, uy); ctx.lineTo(ux + PIPE_W, centerY);
        } else if (dd === 'down') {
          var dx = centerX + TILE_PX - HALF_PIPE_W;
          var dy1 = centerY + 2 * TILE_PX, dy2 = dy1 + armPx;
          ctx.moveTo(dx, dy1); ctx.lineTo(dx, dy2);
          ctx.moveTo(dx + PIPE_W, dy1); ctx.lineTo(dx + PIPE_W, dy2);
        } else if (dd === 'left') {
          var ly = centerY + TILE_PX - HALF_PIPE_W, lx1 = centerX - armPx;
          ctx.moveTo(lx1, ly); ctx.lineTo(centerX, ly);
          ctx.moveTo(lx1, ly + PIPE_W); ctx.lineTo(centerX, ly + PIPE_W);
        } else if (dd === 'right') {
          var rx = centerX + 2 * TILE_PX, ry = centerY + TILE_PX - HALF_PIPE_W;
          ctx.moveTo(rx, ry); ctx.lineTo(rx + armPx, ry);
          ctx.moveTo(rx, ry + PIPE_W); ctx.lineTo(rx + armPx, ry + PIPE_W);
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
