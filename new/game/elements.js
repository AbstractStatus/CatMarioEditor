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

  // stype 50: 可进入管道（两部分：顶部管口60px宽30px高 + 底部管道50px宽）
  PipeTypes[50] = {
    solid: true,
    render: function (ctx, s, x, y, w, h) {
      // 底部管道（竖管身：只画左右线）
      ctx.fillStyle = '#00e600'; ctx.fillRect(x + 5, y + 30, 50, h - 30);
      ctx.strokeStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(x + 5, y + 30); ctx.lineTo(x + 5, y + h);
      ctx.moveTo(x + 55, y + 30); ctx.lineTo(x + 55, y + h);
      ctx.stroke();
      // 顶部管口
      ctx.fillStyle = '#00e600'; ctx.fillRect(x, y + 1, 60, 30);
      ctx.strokeStyle = '#000'; ctx.strokeRect(x, y + 1, 60, 30);
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
      // 底部竖管身（只画左右线）
      ctx.fillStyle = '#00e600'; ctx.fillRect(x + 5, y + 30, 50, h - 30);
      ctx.strokeStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(x + 5, y + 30); ctx.lineTo(x + 5, y + h);
      ctx.moveTo(x + 55, y + 30); ctx.lineTo(x + 55, y + h);
      ctx.stroke();
      // 顶部管口
      ctx.fillStyle = '#00e600'; ctx.fillRect(x, y + 1, 60, 30);
      ctx.strokeStyle = '#000'; ctx.strokeRect(x, y + 1, 60, 30);
      // 传送标记：管口中央黄色菱形
      var cx = x + 30, cy = y + 16;
      ctx.fillStyle = '#ffe600';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 8); ctx.lineTo(cx + 8, cy);
      ctx.lineTo(cx, cy + 8); ctx.lineTo(cx - 8, cy);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.stroke();
    },
    onEnter: function (p, s, xx, state) {
      var C = getC();
      if (p.ma + p.mnobia > xx[8] + 2800 && p.ma < xx[8] + s.sc - 3000 &&
          p.mb + p.mnobib > xx[9] - 1000 && p.mb + p.mnobib < xx[9] + xx[1] + 3000 &&
          p.mzimen === 1 && p.actaon[3] === 1 && p.mtype === 0) {
        p.mtype = C.MTYPE.PIPE; p.mtm = 0; p.mxtype = 1;
        p._warp = s.warp || null;
        p._trapPipe = null;
        return true;
      }
      return false;
    }
  };

  // stype 51: 下落块（使用砖块精灵铺排）
  PipeTypes[51] = {
    solid: true,
    render: function (ctx, s, x, y, w, h, state) {
      var S = getS();
      var offset = stageColorOffset(state);
      if (s.sxtype === 0) {
        var cols = Math.floor(s.sc / 3000);
        for (var c = 0; c <= cols; c++)
          S && S.draw(ctx, 1 + offset, 1, x + 29 * c, y);
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
  PipeTypes[52] = {
    solid: true,
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

  // stype 200: 块状地面（使用砖块精灵铺排整片区域）
  PipeTypes[200] = {
    solid: true,
    render: function (ctx, s, x, y, w, h) {
      drawTileGrid(ctx, s, x, y, w, h, 65, 1);
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
    onCollide: function (p, s, xx, state) {
      if (p.mtype === 0 && p.mhp >= 1) {
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
