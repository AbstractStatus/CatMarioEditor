// ===================================================================
// 关卡数据 - 从原版 main.cpp stagep() 提取
// 每个关卡包含：字节网格 stagedate[17][1001] + 特殊块/管道/敌人/升降台
// 字节编码见 constants.js TILE_BYTE
// ===================================================================
(function (global) {
  'use strict';

  var Levels = {};

  // 从 base64 解码 17x1001 字节图
  function decodeGrid(b64) {
    var bin = atob(b64);
    var grid = [];
    for (var r = 0; r < 17; r++) {
      var row = [];
      for (var c = 0; c < 1001; c++) {
        row.push(bin.charCodeAt(r * 1001 + c) || 0);
      }
      grid.push(row);
    }
    return grid;
  }

  var STAGE1_1_GRID = null;

  // 获取关卡定义
  Levels.get = function (sta, stb, stc) {
    if (!STAGE1_1_GRID) {
      if (global.STAGE11_IMAGE_B64) {
        STAGE1_1_GRID = decodeGrid(global.STAGE11_IMAGE_B64);
      } else {
        // 回退到粗略数据
        STAGE1_1_GRID = [];
        for (var i = 0; i < 17; i++) {
          var row = [];
          for (var j = 0; j < 1001; j++) row.push(0);
          STAGE1_1_GRID.push(row);
        }
      }
    }

    if (sta === 1 && stb === 1 && stc === 0) {
      return {
        grid: STAGE1_1_GRID,
        stagecolor: 1,
        scrollx: 3600 * 100,
        bgm: 100,
        // 特殊方块 tyobi(x, y, type)
        blocks: [
          { x: 8 * 29, y: 9 * 29 - 12, type: 100, xt: 2 },
          { x: 13 * 29, y: 9 * 29 - 12, type: 102, xt: 0 },
          { x: 14 * 29, y: 5 * 29 - 12, type: 101 },
          { x: 35 * 29, y: 8 * 29 - 12, type: 110 },
          { x: 47 * 29, y: 9 * 29 - 12, type: 103 },
          { x: 59 * 29, y: 9 * 29 - 12, type: 112 },
          { x: 67 * 29, y: 9 * 29 - 12, type: 104 }
        ],
        // 管道/墙体 sa,sb,sc,sd,stype,sxtype
        pipes: [
          { sa: 20 * 29 * 100 + 500, sb: -6000, sc: 5000, sd: 70000, stype: 100 },
          { sa: 54 * 29 * 100 - 500, sb: -6000, sc: 7000, sd: 70000, stype: 101 },
          { sa: 112 * 29 * 100 + 1000, sb: -6000, sc: 3000, sd: 70000, stype: 102 },
          { sa: 117 * 29 * 100, sb: (2 * 29 - 12) * 100 - 1500, sc: 15000, sd: 3000, stype: 103 },
          { sa: 125 * 29 * 100, sb: -6000, sc: 9000, sd: 70000, stype: 101 },
          // 陷阱管道
          { sa: 29 * 29 * 100 + 500, sb: (9 * 29 - 12) * 100, sc: 6000, sd: 12000 - 200, stype: 50 },
          // 下落块
          { sa: 49 * 29 * 100, sb: (5 * 29 - 12) * 100, sc: 9000 - 1, sd: 3000, stype: 51 },
          { sa: 72 * 29 * 100, sb: (13 * 29 - 12) * 100, sc: 3000 * 5 - 1, sd: 3000, stype: 52 }
        ],
        // 敌人触发器 ba,bb,btype,bxtype
        enemies: [
          { ba: 27 * 29 * 100, bb: (9 * 29 - 12) * 100, btype: 0 },
          { ba: 103 * 29 * 100, bb: (5 * 29 - 12 + 10) * 100, btype: 80 }
        ],
        lifts: []
      };
    }
    // 默认返回空关卡
    return {
      grid: STAGE1_1_GRID,
      stagecolor: 1,
      scrollx: 3600 * 100,
      bgm: 100,
      blocks: [], pipes: [], enemies: [], lifts: []
    };
  };

  global.Levels = Levels;
})(window);
