// ===================================================================
// 精灵管理 - 基于 assets/sprites/ 下的切片 PNG
// 通过 manifest.js 中的 grap ID 索引（与原版 grap[id][sheet] 对应）
// ===================================================================
(function (global) {
  'use strict';

  var C = global.Constants;
  var Sprites = {};

  // grap[id][sheet] -> HTMLImageElement
  var images = {};
  var loadedCount = 0;
  var totalCount = 0;
  var onReadyCb = null;

  // 从 manifest 构建索引
  function buildIndex(manifest) {
    var sprites = manifest.sprites || [];
    var dir = C.RES.SPRITE_DIR;
    sprites.forEach(function (s) {
      if (!s.grap || s.grap === '-') return;
      // grap 格式: g{id}_{sheet}
      var m = /^g(\d+)_(\d+)$/.exec(s.grap);
      if (!m) return;
      var id = parseInt(m[1], 10);
      var sheet = parseInt(m[2], 10);
      if (!images[sheet]) images[sheet] = {};
      var img = new Image();
      img.src = dir + s.file;
      totalCount++;
      img.onload = function () {
        loadedCount++;
        checkReady();
      };
      img.onerror = function () {
        loadedCount++;
        checkReady();
      };
      images[sheet][id] = { img: img, w: s.w, h: s.h };
    });
  }

  function checkReady() {
    if (loadedCount >= totalCount && onReadyCb) {
      var cb = onReadyCb;
      onReadyCb = null;
      cb();
    }
  }

  // 道具精灵在敌人 sheet(3) 中的 ID → item sheet(2) 中的 ID
  // 对应原版 grap[100][3]=subimage(33*1) 等（mgrap[2]=item.png）
  var ITEM_ALIAS_3_TO_2 = {
    100: 1,  // 红/毒蘑菇（看起来相同）
    102: 3,  // 紫蘑菇
    105: 5,  // 绿色问号球
    110: 4   // 无敌星
  };

  function registerAliases() {
    if (!images[3]) images[3] = {};
    Object.keys(ITEM_ALIAS_3_TO_2).forEach(function (dstId) {
      var srcId = ITEM_ALIAS_3_TO_2[dstId];
      if (!images[3][dstId] && images[2] && images[2][srcId]) {
        images[3][dstId] = images[2][srcId];
      }
    });
  }

  Sprites.init = function (cb) {
    onReadyCb = cb;
    if (global.SPRITE_MANIFEST) {
      buildIndex(global.SPRITE_MANIFEST);
      registerAliases();
    } else {
      // 尝试动态加载
      var script = document.createElement('script');
      script.src = C.RES.SPRITE_DIR + 'manifest.js';
      script.onload = function () {
        buildIndex(global.SPRITE_MANIFEST);
        registerAliases();
      };
      document.head.appendChild(script);
    }
  };

  // 获取精灵图像对象
  Sprites.get = function (id, sheet) {
    if (images[sheet] && images[sheet][id]) {
      return images[sheet][id];
    }
    return null;
  };

  // 绘制精灵到画布上下文
  // 自适应：无论替换的 PNG 原始分辨率多大（高清重绘/原版像素图），
  // 一律把整图缩放到 manifest 声明的 w/h，绝不按 naturalWidth/Height 绘制
  Sprites.draw = function (ctx, id, sheet, x, y, mirror) {
    var s = Sprites.get(id, sheet);
    if (!s || !s.img) return false;
    var w = s.w, h = s.h;
    if (x + w < 0 || x > C.CANVAS_W) return false;
    var img = s.img;
    // 高清重绘资源（源分辨率 >= 逻辑尺寸 1.5×）：高质量双线性插值，曲线平滑；
    // 原版像素图（naturalW≈逻辑尺寸）仍走引擎默认的 nearest-neighbor，保持方块锐利。
    // 注意：渲染在 setTransform(_baseScale) 下直接进行，浏览器会把高清源图
    // 一次性采样到最终设备像素，不存在“先缩到 30px 再放大”的中间锯齿。
    var hd = img.naturalWidth >= w * 1.5 || img.naturalHeight >= h * 1.5;
    if (hd) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; }
    if (mirror) {
      ctx.save();
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(img, x, y, w, h);
    }
    if (hd) { ctx.imageSmoothingEnabled = false; ctx.imageSmoothingQuality = 'low'; }
    return true;
  };

  global.Sprites = Sprites;
})(window);
