/*
 * 猫里奥关卡编辑器 - 主逻辑
 * 网格 29x29、17 行（与 catmario/src/main.cpp 的 stagedate[17][1001] 一致）。
 * 关卡保存为 JSON：{ cols, theme, elements:[{id,col,row,len?,xt?}] }
 * 元素原生 ID（mapId/ttype/atype/ntype/bgmId）见 elements.js 中的注释。
 */
(function () {
  'use strict';

  // 每次进入编辑器清空本地缓存，恢复初始示例状态
  try { localStorage.clear(); } catch (e) { }

  var TILE = CAT.TILE;       // 基础 29（会动态放大）
  var ROWS = CAT.ROWS;       // 17
  var ASSETS = 'assets/';

  // 响应式：TILE 放大到让整个关卡高度占页面的 ~80%
  function updateTileSize() {
    // 可用高度 = 窗口高度 - 工具栏 - 状态栏 - 一些 padding
    var availH = window.innerHeight - 56 - 46 - 20;
    var tileByH = Math.floor(availH / ROWS);
    // 放大 tiles，最大到基础的 4 倍
    var newTile = Math.min(tileByH, CAT.TILE * 4);
    if (newTile < CAT.TILE) newTile = CAT.TILE;
    if (newTile !== TILE) {
      TILE = newTile;
      // 重新渲染所有 canvas
      render();
      renderGutter();
      renderRuler();
    }
  }

  window.addEventListener('resize', updateTileSize);

  var THEMES = {
    overworld: { name: '地上', sky: '#9fc4ff', debris: [144, 96, 48] },
    dungeon:   { name: '地下', sky: '#1c1c34', debris: [0, 120, 160] },
    castle:    { name: '城堡', sky: '#5f5f5f', debris: [192, 192, 192] },
    sky:       { name: '空中', sky: '#3a5a9e', debris: [144, 96, 48] }
  };

  var state = {
    cols: 120,
    theme: 'overworld',
    grid: true,
    elements: []      // {id, col, row, len?, xt?}
  };

  // ---------- DOM ----------
  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d');
  var ruler = document.getElementById('ruler');
  var rctx = ruler.getContext('2d');
  var gutter = document.getElementById('gutter');
  var gctx = gutter.getContext('2d');
  var scroller = document.getElementById('scroller');
  var paletteEl = document.getElementById('palette');
  var statusEl = document.getElementById('status');
  var hintEl = document.getElementById('hint');
  var colsInput = document.getElementById('colsInput');

  // ---------- 图片缓存 ----------
  var imgCache = {};
  function getImg(el) {
    if (!el.img) return null;
    if (!imgCache[el.img]) {
      var im = new Image();
      im.src = ASSETS + 'sprites/' + el.img;
      im.onload = function () { requestRender(); };
      imgCache[el.img] = im;
    }
    return imgCache[el.img];
  }

  // ---------- 背景设计尺寸（来自 manifest，与图片实际分辨率无关） ----------
  // 背景装饰（山/云/草/树等）跨多格，manifest 的 w/h 是设计像素（TILE=29 基准），
  // 游戏内即按此虚拟尺寸渲染；编辑器随动态 TILE 等比放大。
  var designSize = {};
  (function () {
    var sp = window.SPRITE_MANIFEST && window.SPRITE_MANIFEST.sprites;
    if (sp) for (var i = 0; i < sp.length; i++) {
      if (sp[i].file) designSize[sp[i].file] = { w: sp[i].w, h: sp[i].h };
    }
  })();

  function bgDrawSize(def, im) {
    var d = designSize[def.img];
    var k = TILE / CAT.TILE;
    return {
      w: Math.round((d ? d.w : im.naturalWidth) * k),
      h: Math.round((d ? d.h : im.naturalHeight) * k)
    };
  }

  // ---------- 工具 ----------
  var tool = null;            // 选中的元素 id，或 'eraser'
  var hover = null;           // {col,row}
  var painting = false;
  var paintBtn = 0;
  var paintedCells = null;    // 本次拖拽已处理格子
  var inStroke = false;       // 一次 mousedown→mouseup 笔画内只记一次历史
  var debris = [];            // 碎裂粒子
  var bgmAudio = null;        // BGM 试听

  // ---------- 撤销历史 ----------
  var history = [];           // 状态快照栈，每个元素 {cols, theme, elements}
  var MAX_HISTORY = 60;

  function snapshot() {
    return {
      cols: state.cols,
      theme: state.theme,
      elements: state.elements.map(function (e) {
        var o = { id: e.id, col: e.col, row: e.row };
        if (e.len != null) o.len = e.len;
        if (e.xt != null) o.xt = e.xt;
        return o;
      })
    };
  }
  function pushHistory() {
    history.push(snapshot());
    if (history.length > MAX_HISTORY) history.shift();
  }
  function undo() {
    if (!history.length) return false;
    var prev = history.pop();
    state.cols = prev.cols;
    state.theme = prev.theme;
    state.elements = prev.elements;
    selected = null;
    colsInput.value = state.cols;
    document.getElementById('themeSel').value = state.theme;
    persist();
    requestRender();
    hintEl.textContent = '已撤销（剩余 ' + history.length + ' 步）';
    return true;
  }

  // ---------- 选中 / 拖动 ----------
  var selected = null;        // 当前选中的元素（state.elements 中的引用）
  var dragging = false;       // 是否正在拖动选中元素
  var dragOrigCol = 0, dragOrigRow = 0;   // 拖动开始时元素位置
  var dragStartCol = 0, dragStartRow = 0; // 拖动开始时鼠标所在格

  // 命中测试：按图层从高到低，返回第一个覆盖 (col,row) 的元素
  function hitTest(col, row) {
    var list = state.elements.slice().sort(function (a, b) {
      return layerOf(CAT.byId(b.id)) - layerOf(CAT.byId(a.id));
    });
    for (var i = 0; i < list.length; i++) {
      var fp = footprintOf(list[i]);
      if (col >= fp.c0 && col <= fp.c1 && row >= fp.r0 && row <= fp.r1) return list[i];
    }
    return null;
  }

  function cellKey(c, r) { return c + ',' + r; }

  function footprint(elDef, col, row) {
    var tw = elDef.tw || 1, th = elDef.th || 1;
    var len = elDef.len || 1;
    if (elDef.cat === 'struct' && elDef.id.indexOf('lift_') === 0) {
      // 升降台长度由 len 决定
    }
    return {
      c0: col, c1: col + tw - 1,
      r0: row, r1: row + th - 1,
      tw: tw, th: th
    };
  }

  function liftLen(e) { return e.len || CAT.byId(e.id).len || CAT.byId(e.id).tw || 3; }

  function footprintOf(e) {
    var d = CAT.byId(e.id);
    var fp = footprint(d, e.col, e.row);
    if (d.id.indexOf('lift_') === 0) {
      fp.c1 = e.col + liftLen(e) - 1;
    }
    return fp;
  }

  function overlaps(fp, c, r) {
    return c >= fp.c0 && c <= fp.c1 && r >= fp.r0 && r <= fp.r1;
  }

  // 实体类：占格互斥（方块/管道/旗杆/升降台/机关块）
  function isSolid(d) {
    return d.cat === 'block' || (d.cat === 'struct' && d.id !== 'player_start');
  }

  function placeAt(col, row) {
    if (col < 0 || row < 0) return;
    if (!inStroke) pushHistory();
    var d = CAT.byId(tool);
    if (!d) return;
    var tw = d.tw || 1, th = d.th || 1;
    var len = d.len || tw;
    if (d.id.indexOf('lift_') === 0) { tw = len; }
    col = Math.min(col, state.cols - tw);
    row = Math.min(row, ROWS - th);
    if (row < 0 || col < 0) return;

    var fp = footprint(d, col, row);
    if (d.id.indexOf('lift_') === 0) fp.c1 = col + len - 1;

    // 移除占位重叠的实体
    state.elements = state.elements.filter(function (e) {
      var ed = CAT.byId(e.id);
      if (!ed) return false;
      if (isSolid(ed) && (isSolid(d))) {
        var efp = footprintOf(e);
        return !(efp.c1 >= fp.c0 && efp.c0 <= fp.c1 && efp.r1 >= fp.r0 && efp.r0 <= fp.r1);
      }
      // 同类同位置替换
      if (e.id === d.id && e.col === col && e.row === row) return false;
      return true;
    });

    var ne = { id: d.id, col: col, row: row };
    if (d.id.indexOf('lift_') === 0) ne.len = len;
    if (d.xt) ne.xt = d.xt;
    state.elements.push(ne);
    persist();
    requestRender();
  }

  function eraseAt(col, row) {
    var hit = false;
    var before = state.elements.length;
    if (!inStroke) pushHistory();
    state.elements = state.elements.filter(function (e) {
      var ed = CAT.byId(e.id);
      if (!ed) return false;
      var fp = footprintOf(e);
      if (overlaps(fp, col, row)) {
        if (ed.cat === 'block') spawnDebris(col, row);
        return false;
      }
      return true;
    });
    if (state.elements.length !== before) { persist(); requestRender(); }
  }

  // ---------- 碎裂粒子（还原 main.cpp egtype==1：棕色圆 + 黑圈） ----------
  function spawnDebris(col, row) {
    var cx = col * TILE + TILE / 2, cy = row * TILE + TILE / 2;
    var spd = [[-3, -4.5], [3, -4], [-2.5, -2.5], [2.5, -3]];
    for (var i = 0; i < 4; i++) {
      debris.push({
        x: cx, y: cy,
        vx: spd[i][0] + (Math.random() - 0.5),
        vy: spd[i][1],
        life: 45
      });
    }
  }

  function updateDebris() {
    if (!debris.length) return;
    for (var i = debris.length - 1; i >= 0; i--) {
      var p = debris[i];
      p.vy += 0.32;
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      if (p.life <= 0 || p.y > ROWS * TILE + 20) debris.splice(i, 1);
    }
  }

  // ---------- 渲染 ----------
  var renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      render();
    });
  }

  function layerOf(d) {
    if (d.cat === 'bg') return 0;
    if (d.cat === 'struct') return 1;
    if (d.cat === 'block') return 2;
    if (d.cat === 'item') return 3;
    if (d.cat === 'enemy') return 4;
    return 5; // audio / 起点标记
  }

  // TILE 比例的工具：原始设计按 TILE=29，所以任何硬编码 px 都除以 29 再乘 TILE
  function tilePx(n) { return Math.round(n / CAT.TILE * TILE); }

  function drawSprite(el, def, x, y, alpha) {
    var im = getImg(def);
    if (!im || !im.complete || im.naturalWidth === 0) return;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    if (def.cat === 'bg') {
      // 背景图：按 manifest 设计尺寸随 TILE 等比放大（跨多格，按锚点位置放置）
      var bs = bgDrawSize(def, im);
      ctx.drawImage(im, Math.round(x), Math.round(y), bs.w, bs.h);
    } else {
      // 所有非背景元素：强制缩放到 TILE × TILE
      var dx = Math.round(x);
      var dy = Math.round(y);
      if (def.id === 'player_start') dy = Math.round(y - (TILE - TILE)); // 脚在格底（dh=TILE）
      ctx.drawImage(im, dx, dy, TILE, TILE);
    }
    ctx.globalAlpha = 1;
  }

  function drawElement(e, alpha) {
    var d = CAT.byId(e.id);
    if (!d) return;
    var x = e.col * TILE, y = e.row * TILE;
    var a = alpha == null ? 1 : alpha;

    if (d.cat === 'audio') {
      var cx = x + TILE / 2, cy = y + TILE / 2;
      ctx.globalAlpha = a;
      ctx.fillStyle = d.color;
      ctx.beginPath(); ctx.arc(cx, cy, TILE / 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + tilePx(14) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('♪', cx, cy + 1);
      ctx.font = tilePx(9) + 'px sans-serif';
      ctx.fillText(String(d.bgmId), cx, cy + TILE / 2 + 4);
      ctx.globalAlpha = 1;
      return;
    }

    if (d.kind === 'vector' && d.id === 'firebar') {
      var n = e.xt || d.xt || 5;
      ctx.globalAlpha = a;
      for (var i = 0; i < n; i++) {
        var fx = x + TILE / 2 + i * tilePx(17), fy = y + TILE + tilePx(6);
        ctx.fillStyle = '#e67800';
        ctx.beginPath(); ctx.arc(fx, fy, TILE / 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }

    if (d.id.indexOf('lift_') === 0) {
      var im = getImg(d);
      var Lw = liftLen(e) * TILE;
      ctx.globalAlpha = a;
      if (im && im.complete && im.naturalWidth) {
        ctx.drawImage(im, Math.round(x - 1), Math.round(y + tilePx(7)), Lw + 2, tilePx(14));
      } else {
        ctx.fillStyle = d.img.indexOf('yellow') >= 0 ? '#dcdc00' :
                        d.img.indexOf('green') >= 0 ? '#00dcdc' : '#b0b0b0';
        ctx.fillRect(x, y + tilePx(7), Lw, tilePx(14));
      }
      ctx.globalAlpha = 1;
      return;
    }

    if (d.id === 'block_hidden') {
      ctx.globalAlpha = a * 0.35;
      var him = getImg(d);
      if (him && him.complete) {
        ctx.drawImage(him, Math.round(x), Math.round(y), TILE, TILE);
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#c00';
      ctx.lineWidth = Math.max(1.5, TILE / 20);
      ctx.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3);
      ctx.setLineDash([]);
      return;
    }

    if (d.id === 'player_start') {
      drawSprite(e, d, x, y, a);
      ctx.globalAlpha = 1;
      // 绿色小旗子（硬编码比例缩放）
      var fh = tilePx(8), fw = TILE - tilePx(3);
      ctx.fillStyle = '#0a7d20';
      ctx.fillRect(x, y - fh, fw, fh);
      ctx.strokeStyle = '#0a7d20';
      ctx.strokeRect(x + 0.5, y - fh - 0.5, TILE - 1, TILE + fh);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + tilePx(7) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('起点', x + TILE / 2, y - fh / 2 - 0.5);
      return;
    }

    // 陷阱管道：pipe_top + 3 个 pipe_body 拼成 2x4 格（管口/管身横跨 2 格，宽 2*TILE）
    if (d.id === 'pipe_trap') {
      var pt = getImg(CAT.byId('pipe_top')), pb = getImg(CAT.byId('pipe_body'));
      ctx.globalAlpha = a;
      if (pt && pt.complete) ctx.drawImage(pt, x, y, 2 * TILE, TILE);
      for (var py = 1; py < 4; py++) {
        if (pb && pb.complete) ctx.drawImage(pb, x, y + py * TILE, 2 * TILE, TILE);
      }
      ctx.globalAlpha = 1;
      return;
    }

    // 剩余所有元素：按 tw/th 声明的格数缩放
    var im2 = getImg(d);
    if (im2 && im2.complete && im2.naturalWidth) {
      ctx.globalAlpha = a;
      var dx2, dy2, dw2, dh2;
      var tw = d.tw || 1, th = d.th || 1;
      if (d.cat === 'bg') {
        // 背景：按 manifest 设计尺寸随 TILE 等比放大（与游戏内虚拟比例一致）
        var bs2 = bgDrawSize(d, im2);
        dx2 = x; dy2 = y;
        dw2 = bs2.w; dh2 = bs2.h;
        ctx.drawImage(im2, Math.round(dx2), Math.round(dy2), dw2, dh2);
      } else if (d.cat === 'struct' || d.cat === 'enemy') {
        // 管道/旗杆/假旗杆/大敌人：按 tw/th 格数等比缩放
        dx2 = x; dy2 = y;
        dw2 = tw * TILE;
        dh2 = th * TILE;
        ctx.drawImage(im2, Math.round(dx2), Math.round(dy2), dw2, dh2);
      } else {
        // 方块/物品（都是 1×1）：强制一格
        dx2 = x; dy2 = y; dw2 = TILE; dh2 = TILE;
        ctx.drawImage(im2, Math.round(dx2), Math.round(dy2), dw2, dh2);
      }
      ctx.globalAlpha = 1;
    }
  }

  function render() {
    updateDebris();

    var W = state.cols * TILE;
    var H = ROWS * TILE;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;

    // 关掉插值：所有 drawImage 用 nearest-neighbor，保持像素艺术锐利
    ctx.imageSmoothingEnabled = false;

    // 天空
    ctx.fillStyle = THEMES[state.theme].sky;
    ctx.fillRect(0, 0, W, H);

    // 网格
    if (state.grid) {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var c = 0; c <= state.cols; c++) {
        ctx.moveTo(c * TILE + 0.5, 0);
        ctx.lineTo(c * TILE + 0.5, H);
      }
      for (var r = 0; r <= ROWS; r++) {
        ctx.moveTo(0, r * TILE + 0.5);
        ctx.lineTo(W, r * TILE + 0.5);
      }
      ctx.stroke();
    }

    // 按层排序绘制
    var list = state.elements.slice().sort(function (a, b) {
      return layerOf(CAT.byId(a.id)) - layerOf(CAT.byId(b.id));
    });
    for (var i = 0; i < list.length; i++) drawElement(list[i]);

    // 悬停幽灵预览
    if (hover && tool && tool !== 'eraser') {
      var d = CAT.byId(tool);
      if (d) {
        var col = Math.min(hover.col, state.cols - (d.tw || 1));
        var row = Math.min(hover.row, ROWS - (d.th || 1));
        col = Math.max(col, 0); row = Math.max(row, 0);
        drawElement({ id: d.id, col: col, row: row, len: d.len, xt: d.xt }, 0.55);
        var fp = footprint(d, col, row);
        if (d.id.indexOf('lift_') === 0) fp.c1 = col + liftLen({ id: d.id, len: d.len }) - 1;
        ctx.strokeStyle = 'rgba(20,80,255,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(fp.c0 * TILE + 1, fp.r0 * TILE + 1,
          (fp.c1 - fp.c0 + 1) * TILE - 2, (fp.r1 - fp.r0 + 1) * TILE - 2);
      }
    } else if (hover && tool === 'eraser') {
      ctx.strokeStyle = 'rgba(255,40,40,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(hover.col * TILE + 1, hover.row * TILE + 1, TILE - 2, TILE - 2);
    }

    // 选中高亮框
    if (selected) {
      var sfp = footprintOf(selected);
      ctx.save();
      ctx.strokeStyle = '#ff7a00';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(sfp.c0 * TILE + 1, sfp.r0 * TILE + 1,
        (sfp.c1 - sfp.c0 + 1) * TILE - 2, (sfp.r1 - sfp.r0 + 1) * TILE - 2);
      ctx.restore();
    }

    // 碎裂粒子
    var dc = THEMES[state.theme].debris;
    for (var k = 0; k < debris.length; k++) {
      var p = debris[k];
      ctx.globalAlpha = Math.min(1, p.life / 20);
      ctx.fillStyle = 'rgb(' + dc[0] + ',' + dc[1] + ',' + dc[2] + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (debris.length) requestRender();

    renderRuler();
  }

  function renderRuler() {
    var W = state.cols * TILE;
    if (ruler.width !== W) ruler.width = W;
    ruler.height = 20;
    rctx.clearRect(0, 0, W, 20);
    rctx.fillStyle = '#2b2f38';
    rctx.fillRect(0, 0, W, 20);
    rctx.strokeStyle = '#4a5060';
    rctx.beginPath();
    rctx.moveTo(0, 19.5); rctx.lineTo(W, 19.5);
    rctx.stroke();
    rctx.fillStyle = '#aab2c5';
    rctx.font = '10px monospace';
    rctx.textAlign = 'left'; rctx.textBaseline = 'middle';
    for (var c = 0; c <= state.cols; c++) {
      var x = c * TILE;
      rctx.strokeStyle = c % 10 === 0 ? '#7a8298' : '#3c4250';
      rctx.beginPath();
      rctx.moveTo(x + 0.5, c % 10 === 0 ? 6 : 12);
      rctx.lineTo(x + 0.5, 20);
      rctx.stroke();
      if (c % 10 === 0 && c < state.cols) rctx.fillText(String(c), x + 2, 9);
    }
  }

  function renderGutter() {
    gutter.width = 34;
    gutter.height = ROWS * TILE;
    gctx.fillStyle = '#2b2f38';
    gctx.fillRect(0, 0, 34, ROWS * TILE);
    gctx.fillStyle = '#aab2c5';
    gctx.font = '10px monospace';
    gctx.textAlign = 'center'; gctx.textBaseline = 'middle';
    for (var r = 0; r < ROWS; r++) {
      gctx.strokeStyle = '#3c4250';
      gctx.beginPath();
      gctx.moveTo(28, r * TILE + 0.5);
      gctx.lineTo(34, r * TILE + 0.5);
      gctx.stroke();
      gctx.fillText(String(r), 14, r * TILE + 14);
    }
  }

  // ---------- 左侧元素面板 ----------
  function buildPalette() {
    var order = ['struct', 'block', 'item', 'enemy', 'bg', 'audio'];
    order.forEach(function (cat) {
      var sec = document.createElement('div');
      sec.className = 'pal-sec';
      var h = document.createElement('div');
      h.className = 'pal-h';
      h.textContent = CAT.CATS[cat];
      sec.appendChild(h);
      var grid = document.createElement('div');
      grid.className = 'pal-grid';

      CAT.ELEMENTS.forEach(function (d) {
        if (d.cat !== cat) return;
        var b = document.createElement('div');
        b.className = 'pal-item';
        b.dataset.id = d.id;

        var thumb = document.createElement('div');
        thumb.className = 'pal-thumb';
        if (d.cat === 'audio') {
          var dot = document.createElement('div');
          dot.className = 'pal-dot';
          dot.style.background = d.color;
          dot.textContent = '♪';
          thumb.appendChild(dot);
        } else {
          var im = document.createElement('img');
          im.src = ASSETS + 'sprites/' + d.img;
          im.alt = d.name;
          thumb.appendChild(im);
        }
        b.appendChild(thumb);

        var lb = document.createElement('div');
        lb.className = 'pal-label';
        lb.textContent = d.name;
        b.appendChild(lb);

        var tag = [];
        if (d.mapId) tag.push('地图' + d.mapId);
        if (d.ttype) tag.push('t' + d.ttype);
        if (d.atype != null && !d.mapId) tag.push('a' + d.atype);
        if (d.ntype != null) tag.push('背景' + d.ntype);
        if (d.bgmId) tag.push('BGM' + d.bgmId);
        b.title = d.hint + (tag.length ? '\n原生ID：' + tag.join(' / ') : '');

        b.addEventListener('click', function () { selectTool(d.id); });
        grid.appendChild(b);
      });
      sec.appendChild(grid);
      paletteEl.appendChild(sec);
    });
  }

  function selectTool(id) {
    tool = id;
    document.querySelectorAll('.pal-item').forEach(function (b) {
      b.classList.toggle('sel', b.dataset.id === id);
    });
    document.getElementById('eraserBtn').classList.toggle('active', false);
    var d = CAT.byId(id);
    if (d) {
      if (d.cat === 'audio') {
        playBgm(d);
        hintEl.textContent = '已选择：' + d.name + '（点击画布放置音乐标记；再次点击该项停止试听）';
      } else {
        stopBgm();
        hintEl.textContent = '已选择：' + d.name + ' — ' + d.hint;
      }
    }
    canvas.style.cursor = 'crosshair';
    requestRender();
  }

  function selectEraser() {
    tool = 'eraser';
    stopBgm();
    document.querySelectorAll('.pal-item').forEach(function (b) { b.classList.remove('sel'); });
    document.getElementById('eraserBtn').classList.add('active');
    hintEl.textContent = '橡皮：点击或拖动擦除画布上的元素（擦方块会播放碎裂特效）';
    canvas.style.cursor = 'cell';
    requestRender();
  }

  // 取消当前工具选择（右键触发）
  function cancelTool() {
    if (!tool) return;
    tool = null;
    stopBgm();
    document.querySelectorAll('.pal-item').forEach(function (b) { b.classList.remove('sel'); });
    document.getElementById('eraserBtn').classList.remove('active');
    canvas.style.cursor = 'default';
    hintEl.textContent = '已取消选择';
    requestRender();
  }

  // ---------- BGM 试听 ----------
  function playBgm(d) {
    stopBgm();
    bgmAudio = new Audio(ASSETS + d.file);
    bgmAudio.loop = true;
    bgmAudio.volume = 0.5;
    var p = bgmAudio.play();
    if (p && p.catch) p.catch(function () { /* 浏览器自动播放限制时忽略 */ });
  }
  function stopBgm() {
    if (bgmAudio) { bgmAudio.pause(); bgmAudio = null; }
  }

  // ---------- 鼠标交互 ----------
  function evtCell(ev) {
    var rect = canvas.getBoundingClientRect();
    var mx = ev.clientX - rect.left;
    var my = ev.clientY - rect.top;
    return { col: Math.floor(mx / TILE), row: Math.floor(my / TILE) };
  }

  canvas.addEventListener('mousedown', function (ev) {
    ev.preventDefault();
    var cell = evtCell(ev);
    hover = cell;
    painting = true;
    paintBtn = ev.button;
    paintedCells = {};

    if (ev.button === 2) {
      // 右键：取消当前工具选择，不擦除元素
      cancelTool();
      selected = null;
    } else if (tool === 'eraser') {
      pushHistory();
      inStroke = true;
      eraseAt(cell.col, cell.row);
      selected = null;
    } else {
      var hit = hitTest(cell.col, cell.row);
      if (hit) {
        // 命中已有元素：选中并准备拖动
        pushHistory();
        inStroke = true;
        selected = hit;
        dragging = true;
        dragOrigCol = hit.col;
        dragOrigRow = hit.row;
        dragStartCol = cell.col;
        dragStartRow = cell.row;
        hintEl.textContent = '已选中：' + (CAT.byId(hit.id).name || hit.id) +
          '（按住拖动可移动，按 Delete 删除）';
      } else if (tool) {
        // 空白处：放置当前工具元素
        pushHistory();
        inStroke = true;
        placeAt(cell.col, cell.row);
        selected = null;
        stopBgm();
      } else {
        // 无工具且点空白：取消选中
        selected = null;
      }
    }
    paintedCells[cellKey(cell.col, cell.row)] = true;
    requestRender();
  });

  canvas.addEventListener('mousemove', function (ev) {
    var cell = evtCell(ev);
    hover = cell;
    statusEl.textContent = '位置：列 ' + cell.col + ' / 行 ' + cell.row +
      '（共 ' + state.elements.length + ' 个元素，画布 ' + state.cols + ' 列）' +
      (selected ? ' · 已选中：' + (CAT.byId(selected.id).name || selected.id) : '');

    if (dragging && selected) {
      // 拖动选中元素：按鼠标位移更新位置，吸附网格并做边界钳制
      var d = CAT.byId(selected.id);
      var tw = (d.tw || 1), th = (d.th || 1);
      if (d.id.indexOf('lift_') === 0) tw = liftLen(selected);
      var nc = dragOrigCol + (cell.col - dragStartCol);
      var nr = dragOrigRow + (cell.row - dragStartRow);
      nc = Math.max(0, Math.min(state.cols - tw, nc));
      nr = Math.max(0, Math.min(ROWS - th, nr));
      if (nc !== selected.col || nr !== selected.row) {
        selected.col = nc;
        selected.row = nr;
      }
      requestRender();
      return;
    }

    if (painting) {
      var k = cellKey(cell.col, cell.row);
      if (!paintedCells[k]) {
        paintedCells[k] = true;
        if (tool === 'eraser') {
          eraseAt(cell.col, cell.row);
        } else if (tool) {
          // 拖动连续放置：仅方块/地面类按格刷，其余只放一次
          var td = CAT.byId(tool);
          if (td && (td.cat === 'block')) placeAt(cell.col, cell.row);
        }
      }
    }
    requestRender();
  });

  window.addEventListener('mouseup', function () {
    painting = false;
    paintedCells = null;
    inStroke = false;
    if (dragging) {
      dragging = false;
      persist();
    }
  });
  canvas.addEventListener('mouseleave', function () { hover = null; requestRender(); });
  canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
  // 左侧栏右键：取消工具选择
  paletteEl.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
    cancelTool();
  });

  // Delete / Backspace 删除选中元素
  window.addEventListener('keydown', function (ev) {
    if (!selected) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace' || ev.keyCode === 46 || ev.keyCode === 8) {
      // 焦点在输入框时不拦截
      var tag = (ev.target && ev.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      ev.preventDefault();
      pushHistory();
      var idx = state.elements.indexOf(selected);
      if (idx >= 0) state.elements.splice(idx, 1);
      var sd = CAT.byId(selected.id);
      if (sd && sd.cat === 'block') spawnDebris(selected.col, selected.row);
      var name = sd && sd.name ? sd.name : selected.id;
      selected = null;
      persist();
      requestRender();
      hintEl.textContent = '已删除：' + name;
    }
  });

  // Ctrl+Z 撤销
  window.addEventListener('keydown', function (ev) {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    var k = ev.key.toLowerCase();
    if (k !== 'z' && ev.keyCode !== 90) return;
    var tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    ev.preventDefault();
    if (!undo()) hintEl.textContent = '没有可撤销的操作';
  });

  // 竖向无滚动：滚轮统一转为横向滚动
  scroller.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var delta = ev.deltaX || ev.deltaY;
    scroller.scrollLeft += delta;
  }, { passive: false });

  // ---------- 工具栏 ----------
  document.getElementById('eraserBtn').addEventListener('click', selectEraser);

  document.getElementById('gridBtn').addEventListener('click', function () {
    state.grid = !state.grid;
    this.classList.toggle('active', state.grid);
    persist();
    requestRender();
  });

  document.getElementById('themeSel').addEventListener('change', function () {
    if (this.value === state.theme) return;
    pushHistory();
    state.theme = this.value;
    persist();
    requestRender();
  });

  document.getElementById('colsMinus').addEventListener('click', function () { setCols(state.cols - 10); });
  document.getElementById('colsPlus').addEventListener('click', function () { setCols(state.cols + 10); });
  colsInput.addEventListener('change', function () {
    var v = parseInt(this.value, 10);
    if (v >= 20) setCols(v);
  });
  function setCols(n) {
    n = Math.max(20, Math.min(1000, n));
    if (n === state.cols) return;
    pushHistory();
    state.cols = n;
    colsInput.value = n;
    persist();
    requestRender();
  }

  document.getElementById('saveBtn').addEventListener('click', function () {
    var data = {
      app: 'catmario-level-editor',
      version: 1,
      tile: TILE,
      rows: ROWS,
      cols: state.cols,
      theme: state.theme,
      elements: state.elements
    };
    var blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'catmario_level.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    hintEl.textContent = '已保存 catmario_level.json（含 ' + state.elements.length + ' 个元素）';
  });

  document.getElementById('loadBtn').addEventListener('click', function () {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', function (ev) {
    var f = ev.target.files[0];
    if (f) readJsonFile(f);
    ev.target.value = '';
  });

  document.getElementById('demoBtn').addEventListener('click', loadDemo);

  // 试玩：把当前关卡交给 play.html（新引擎 game/engine.js，JSON 直接转关卡定义）
  document.getElementById('playBtn').addEventListener('click', function () {
    var data = {
      app: 'catmario-level-editor',
      version: 1,
      tile: TILE,
      rows: ROWS,
      cols: state.cols,
      theme: state.theme,
      elements: state.elements
    };
    try {
      localStorage.setItem('catmario-editor-playdata', JSON.stringify(data));
      window.open('play.html');
    } catch (err) {
      hintEl.textContent = '无法启动试玩：' + err.message;
    }
  });

  document.getElementById('clearBtn').addEventListener('click', function () {
    if (confirm('确定清空当前关卡的所有元素？')) {
      pushHistory();
      state.elements = [];
      persist();
      requestRender();
      hintEl.textContent = '已清空';
    }
  });

  // 拖拽 JSON 文件到窗口加载
  window.addEventListener('dragover', function (ev) { ev.preventDefault(); });
  window.addEventListener('drop', function (ev) {
    ev.preventDefault();
    var f = ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) readJsonFile(f);
  });

  function readJsonFile(f) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        loadData(data);
        hintEl.textContent = '已加载 ' + f.name + '（' + state.elements.length + ' 个元素，' + state.cols + ' 列）';
      } catch (err) {
        alert('JSON 解析失败：' + err.message);
      }
    };
    reader.readAsText(f);
  }

  function loadData(data) {
    if (!data || !Array.isArray(data.elements)) throw new Error('格式不正确：缺少 elements 数组');
    history = [];
    state.elements = data.elements.filter(function (e) {
      return e && CAT.byId(e.id) && typeof e.col === 'number' && typeof e.row === 'number';
    }).map(function (e) {
      var out = { id: e.id, col: e.col | 0, row: e.row | 0 };
      if (e.len) out.len = e.len | 0;
      if (e.xt) out.xt = e.xt | 0;
      return out;
    });
    if (data.cols) state.cols = Math.max(20, Math.min(1000, data.cols | 0));
    if (data.theme && THEMES[data.theme]) state.theme = data.theme;
    colsInput.value = state.cols;
    document.getElementById('themeSel').value = state.theme;
    persist();
    requestRender();
  }

  // ---------- 本地自动保存 ----------
  var saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem('catmario-editor-autosave', JSON.stringify({
          cols: state.cols, theme: state.theme, grid: state.grid, elements: state.elements
        }));
      } catch (e) { /* localStorage 不可用时忽略 */ }
    }, 300);
  }
  function restore() {
    try {
      var raw = localStorage.getItem('catmario-editor-autosave');
      if (raw) {
        var data = JSON.parse(raw);
        if (data && Array.isArray(data.elements)) {
          loadData(data);
          state.grid = data.grid !== false;
          document.getElementById('gridBtn').classList.toggle('active', state.grid);
          return true;
        }
      }
    } catch (e) { }
    return false;
  }

  // ---------- 示例关卡 ----------
  function el(id, col, row, extra) {
    var e = { id: id, col: col, row: row };
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }
  function loadDemo() {
    var E = [{"id":"block_ground_top","col":0,"row":13},{"id":"block_ground_fill","col":0,"row":14},{"id":"bg_hill_house","col":1,"row":10},{"id":"block_ground_top","col":1,"row":13},{"id":"block_ground_fill","col":1,"row":14},{"id":"block_ground_top","col":2,"row":13},{"id":"block_ground_fill","col":2,"row":14},{"id":"block_ground_top","col":3,"row":13},{"id":"block_ground_fill","col":3,"row":14},{"id":"block_ground_top","col":4,"row":13},{"id":"block_ground_fill","col":4,"row":14},{"id":"block_ground_top","col":5,"row":13},{"id":"block_ground_fill","col":5,"row":14},{"id":"bg_cloud_face","col":6,"row":3},{"id":"block_ground_top","col":6,"row":13},{"id":"block_ground_fill","col":6,"row":14},{"id":"block_ground_top","col":7,"row":13},{"id":"block_ground_fill","col":7,"row":14},{"id":"block_ground_top","col":8,"row":13},{"id":"block_ground_fill","col":8,"row":14},{"id":"block_ground_top","col":9,"row":13},{"id":"block_ground_fill","col":9,"row":14},{"id":"enemy_syobon","col":10,"row":12},{"id":"block_ground_top","col":10,"row":13},{"id":"block_ground_fill","col":10,"row":14},{"id":"block_ground_top","col":11,"row":13},{"id":"block_ground_fill","col":11,"row":14},{"id":"block_brick","col":12,"row":9},{"id":"block_ground_top","col":12,"row":13},{"id":"block_ground_fill","col":12,"row":14},{"id":"block_hidden","col":13,"row":10},{"id":"block_ground_top","col":13,"row":13},{"id":"block_ground_fill","col":13,"row":14},{"id":"block_brick","col":14,"row":9},{"id":"block_ground_top","col":14,"row":13},{"id":"block_ground_fill","col":14,"row":14},{"id":"block_question","col":15,"row":9},{"id":"block_ground_top","col":15,"row":13},{"id":"block_ground_fill","col":15,"row":14},{"id":"block_brick","col":16,"row":9},{"id":"enemy_syobon","col":16,"row":12},{"id":"block_ground_top","col":16,"row":13},{"id":"block_ground_fill","col":16,"row":14},{"id":"block_ground_top","col":17,"row":13},{"id":"block_ground_fill","col":17,"row":14},{"id":"block_ground_top","col":18,"row":13},{"id":"block_ground_fill","col":18,"row":14},{"id":"bg_grass","col":19,"row":12},{"id":"block_ground_top","col":19,"row":13},{"id":"block_ground_fill","col":19,"row":14},{"id":"pipe_top","col":20,"row":10},{"id":"pipe_body","col":20,"row":11},{"id":"pipe_body","col":20,"row":12},{"id":"pipe_trap","col":29,"row":9},{"id":"block_ground_top","col":20,"row":13},{"id":"block_ground_fill","col":20,"row":14},{"id":"block_ground_top","col":21,"row":13},{"id":"block_ground_fill","col":21,"row":14},{"id":"bg_cloud_face","col":22,"row":2},{"id":"block_ground_top","col":22,"row":13},{"id":"block_ground_fill","col":22,"row":14},{"id":"block_ground_top","col":23,"row":13},{"id":"block_ground_fill","col":23,"row":14},{"id":"block_ground_top","col":24,"row":13},{"id":"block_ground_fill","col":24,"row":14},{"id":"block_ground_top","col":25,"row":13},{"id":"block_ground_fill","col":25,"row":14},{"id":"bg_grass","col":26,"row":12},{"id":"block_ground_top","col":26,"row":13},{"id":"block_ground_fill","col":26,"row":14},{"id":"block_ground_top","col":27,"row":13},{"id":"block_ground_fill","col":27,"row":14},{"id":"block_ground_top","col":28,"row":13},{"id":"block_ground_fill","col":28,"row":14},{"id":"block_ground_top","col":29,"row":13},{"id":"block_ground_fill","col":29,"row":14},{"id":"block_ground_top","col":30,"row":13},{"id":"block_ground_fill","col":30,"row":14},{"id":"block_ground_top","col":31,"row":13},{"id":"block_ground_fill","col":31,"row":14},{"id":"block_ground_top","col":32,"row":13},{"id":"block_ground_fill","col":32,"row":14},{"id":"bg_hill_house","col":33,"row":10},{"id":"block_ground_top","col":33,"row":13},{"id":"block_ground_fill","col":33,"row":14},{"id":"block_ground_top","col":34,"row":13},{"id":"block_ground_fill","col":34,"row":14},{"id":"block_ground_top","col":35,"row":13},{"id":"block_ground_fill","col":35,"row":14},{"id":"block_ground_top","col":36,"row":13},{"id":"block_ground_fill","col":36,"row":14},{"id":"block_ground_top","col":37,"row":13},{"id":"block_ground_fill","col":37,"row":14},{"id":"block_ground_top","col":38,"row":13},{"id":"block_ground_fill","col":38,"row":14},{"id":"block_ground_top","col":39,"row":13},{"id":"block_ground_fill","col":39,"row":14},{"id":"block_hidden","col":40,"row":9},{"id":"block_ground_top","col":43,"row":13},{"id":"block_ground_fill","col":43,"row":14},{"id":"block_ground_top","col":44,"row":13},{"id":"block_ground_fill","col":44,"row":14},{"id":"block_ground_top","col":45,"row":13},{"id":"block_ground_fill","col":45,"row":14},{"id":"block_brick","col":46,"row":9},{"id":"bg_grass","col":46,"row":12},{"id":"block_ground_top","col":46,"row":13},{"id":"block_ground_fill","col":46,"row":14},{"id":"block_ground_top","col":47,"row":13},{"id":"block_ground_fill","col":47,"row":14},{"id":"enemy_syobon","col":48,"row":7},{"id":"block_brick","col":48,"row":9},{"id":"block_ground_top","col":48,"row":13},{"id":"block_ground_fill","col":48,"row":14},{"id":"block_ground_top","col":49,"row":13},{"id":"block_ground_fill","col":49,"row":14},{"id":"block_ground_top","col":50,"row":13},{"id":"block_ground_fill","col":50,"row":14},{"id":"block_ground_top","col":51,"row":13},{"id":"block_ground_fill","col":51,"row":14},{"id":"enemy_syobon","col":52,"row":3},{"id":"block_brick","col":52,"row":5},{"id":"block_ground_top","col":52,"row":13},{"id":"block_ground_fill","col":52,"row":14},{"id":"block_brick","col":53,"row":5},{"id":"block_ground_top","col":53,"row":13},{"id":"block_ground_fill","col":53,"row":14},{"id":"block_brick","col":57,"row":5},{"id":"block_ground_top","col":57,"row":13},{"id":"block_ground_fill","col":57,"row":14},{"id":"block_brick","col":58,"row":5},{"id":"block_ground_top","col":58,"row":13},{"id":"block_ground_fill","col":58,"row":14},{"id":"block_brick","col":59,"row":5},{"id":"block_ground_top","col":59,"row":13},{"id":"block_ground_fill","col":59,"row":14},{"id":"block_ground_top","col":60,"row":13},{"id":"block_ground_fill","col":60,"row":14},{"id":"enemy_syobon","col":61,"row":12},{"id":"block_ground_top","col":61,"row":13},{"id":"block_ground_fill","col":61,"row":14},{"id":"block_ground_top","col":62,"row":13},{"id":"block_ground_fill","col":62,"row":14},{"id":"enemy_syobon","col":63,"row":12},{"id":"block_ground_top","col":63,"row":13},{"id":"block_ground_fill","col":63,"row":14},{"id":"bg_cloud_face","col":64,"row":1},{"id":"block_ground_top","col":64,"row":13},{"id":"block_ground_fill","col":64,"row":14},{"id":"block_ground_top","col":65,"row":13},{"id":"block_ground_fill","col":65,"row":14},{"id":"bg_midflag","col":66,"row":7},{"id":"block_brick","col":66,"row":9},{"id":"enemy_turtle","col":66,"row":12},{"id":"block_ground_top","col":66,"row":13},{"id":"block_ground_fill","col":66,"row":14},{"id":"block_ground_top","col":67,"row":13},{"id":"block_ground_fill","col":67,"row":14},{"id":"block_ground_top","col":68,"row":13},{"id":"block_ground_fill","col":68,"row":14},{"id":"block_ground_top","col":69,"row":13},{"id":"block_ground_fill","col":69,"row":14},{"id":"block_ground_top","col":70,"row":13},{"id":"block_ground_fill","col":70,"row":14},{"id":"block_question","col":71,"row":9},{"id":"block_ground_top","col":71,"row":13},{"id":"block_ground_fill","col":71,"row":14},{"id":"block_question","col":74,"row":5},{"id":"block_question","col":74,"row":9},{"id":"block_question","col":77,"row":9},{"id":"block_ground_top","col":77,"row":13},{"id":"block_ground_fill","col":77,"row":14},{"id":"bg_grass","col":78,"row":12},{"id":"block_ground_top","col":78,"row":13},{"id":"block_ground_fill","col":78,"row":14},{"id":"block_ground_top","col":79,"row":13},{"id":"block_ground_fill","col":79,"row":14},{"id":"block_ground_top","col":80,"row":13},{"id":"block_ground_fill","col":80,"row":14},{"id":"block_ground_top","col":81,"row":13},{"id":"block_ground_fill","col":81,"row":14},{"id":"block_stair","col":82,"row":12},{"id":"block_ground_top","col":82,"row":13},{"id":"block_ground_fill","col":82,"row":14},{"id":"block_stair","col":83,"row":11},{"id":"block_stair","col":83,"row":12},{"id":"block_ground_top","col":83,"row":13},{"id":"block_ground_fill","col":83,"row":14},{"id":"block_stair","col":84,"row":10},{"id":"block_stair","col":84,"row":11},{"id":"block_stair","col":84,"row":12},{"id":"block_ground_top","col":84,"row":13},{"id":"block_ground_fill","col":84,"row":14},{"id":"block_stair","col":88,"row":10},{"id":"block_stair","col":88,"row":11},{"id":"block_stair","col":88,"row":12},{"id":"block_ground_top","col":88,"row":13},{"id":"block_ground_fill","col":88,"row":14},{"id":"block_hidden","col":89,"row":6},{"id":"block_stair","col":89,"row":11},{"id":"block_stair","col":89,"row":12},{"id":"block_ground_top","col":89,"row":13},{"id":"block_ground_fill","col":89,"row":14},{"id":"block_hidden","col":90,"row":10},{"id":"block_ground_top","col":90,"row":13},{"id":"block_ground_fill","col":90,"row":14},{"id":"block_hidden","col":91,"row":10},{"id":"block_ground_top","col":91,"row":13},{"id":"block_ground_fill","col":91,"row":14},{"id":"block_hidden","col":92,"row":10},{"id":"block_ground_top","col":92,"row":13},{"id":"block_ground_fill","col":92,"row":14},{"id":"block_hidden","col":93,"row":10},{"id":"block_ground_top","col":93,"row":13},{"id":"block_ground_fill","col":93,"row":14},{"id":"block_hidden","col":94,"row":10},{"id":"pipe_top","col":95,"row":10},{"id":"pipe_body","col":95,"row":11},{"id":"pipe_body","col":95,"row":12},{"id":"block_ground_top","col":95,"row":13},{"id":"block_ground_fill","col":95,"row":14},{"id":"block_ground_top","col":96,"row":13},{"id":"block_ground_fill","col":96,"row":14},{"id":"block_ground_top","col":97,"row":13},{"id":"block_ground_fill","col":97,"row":14},{"id":"block_ground_top","col":98,"row":13},{"id":"block_ground_fill","col":98,"row":14},{"id":"block_brick","col":99,"row":9},{"id":"block_ground_top","col":99,"row":13},{"id":"block_ground_fill","col":99,"row":14},{"id":"block_brick","col":100,"row":9},{"id":"block_ground_top","col":100,"row":13},{"id":"block_ground_fill","col":100,"row":14},{"id":"block_question","col":101,"row":9},{"id":"enemy_syobon","col":101,"row":12},{"id":"block_ground_top","col":101,"row":13},{"id":"block_ground_fill","col":101,"row":14},{"id":"block_brick","col":102,"row":9},{"id":"block_ground_top","col":102,"row":13},{"id":"block_ground_fill","col":102,"row":14},{"id":"enemy_syobon","col":103,"row":12},{"id":"block_ground_top","col":103,"row":13},{"id":"block_ground_fill","col":103,"row":14},{"id":"block_ground_top","col":104,"row":13},{"id":"block_ground_fill","col":104,"row":14},{"id":"block_ground_top","col":105,"row":13},{"id":"block_ground_fill","col":105,"row":14},{"id":"pipe_top","col":106,"row":11},{"id":"pipe_body","col":106,"row":12},{"id":"block_ground_top","col":106,"row":13},{"id":"block_ground_fill","col":106,"row":14},{"id":"block_ground_top","col":107,"row":13},{"id":"block_ground_fill","col":107,"row":14},{"id":"block_stair","col":108,"row":12},{"id":"block_ground_top","col":108,"row":13},{"id":"block_ground_fill","col":108,"row":14},{"id":"block_stair","col":109,"row":11},{"id":"block_stair","col":109,"row":12},{"id":"block_ground_top","col":109,"row":13},{"id":"block_ground_fill","col":109,"row":14},{"id":"block_stair","col":110,"row":10},{"id":"block_stair","col":110,"row":11},{"id":"block_stair","col":110,"row":12},{"id":"block_ground_top","col":110,"row":13},{"id":"block_ground_fill","col":110,"row":14},{"id":"block_stair","col":111,"row":9},{"id":"block_stair","col":111,"row":10},{"id":"block_stair","col":111,"row":11},{"id":"block_stair","col":111,"row":12},{"id":"block_ground_top","col":111,"row":13},{"id":"block_ground_fill","col":111,"row":14},{"id":"block_stair","col":112,"row":8},{"id":"block_stair","col":112,"row":9},{"id":"block_stair","col":112,"row":10},{"id":"block_stair","col":112,"row":11},{"id":"block_stair","col":112,"row":12},{"id":"block_ground_top","col":112,"row":13},{"id":"block_ground_fill","col":112,"row":14},{"id":"block_stair","col":113,"row":7},{"id":"block_stair","col":113,"row":8},{"id":"block_stair","col":113,"row":9},{"id":"block_stair","col":113,"row":10},{"id":"block_stair","col":113,"row":11},{"id":"block_stair","col":113,"row":12},{"id":"block_ground_top","col":113,"row":13},{"id":"block_ground_fill","col":113,"row":14},{"id":"block_stair","col":114,"row":6},{"id":"block_stair","col":114,"row":7},{"id":"block_stair","col":114,"row":8},{"id":"block_stair","col":114,"row":9},{"id":"block_stair","col":114,"row":10},{"id":"block_stair","col":114,"row":11},{"id":"block_stair","col":114,"row":12},{"id":"block_ground_top","col":114,"row":13},{"id":"block_ground_fill","col":114,"row":14},{"id":"block_stair","col":115,"row":5},{"id":"block_stair","col":115,"row":6},{"id":"block_stair","col":115,"row":7},{"id":"block_stair","col":115,"row":8},{"id":"block_stair","col":115,"row":9},{"id":"block_stair","col":115,"row":10},{"id":"block_stair","col":115,"row":11},{"id":"block_stair","col":115,"row":12},{"id":"block_ground_top","col":115,"row":13},{"id":"block_ground_fill","col":115,"row":14},{"id":"block_stair","col":116,"row":5},{"id":"block_stair","col":116,"row":6},{"id":"block_stair","col":116,"row":7},{"id":"block_stair","col":116,"row":8},{"id":"block_stair","col":116,"row":9},{"id":"block_stair","col":116,"row":10},{"id":"block_stair","col":116,"row":11},{"id":"block_stair","col":116,"row":12},{"id":"block_ground_top","col":116,"row":13},{"id":"block_ground_fill","col":116,"row":14},{"id":"block_ground_top","col":117,"row":13},{"id":"block_ground_fill","col":117,"row":14},{"id":"block_ground_top","col":118,"row":13},{"id":"block_ground_fill","col":118,"row":14},{"id":"block_ground_top","col":119,"row":13},{"id":"block_ground_fill","col":119,"row":14},{"id":"block_ground_top","col":120,"row":13},{"id":"block_ground_fill","col":120,"row":14},{"id":"block_ground_top","col":121,"row":13},{"id":"block_ground_fill","col":121,"row":14},{"id":"block_ground_top","col":122,"row":13},{"id":"block_ground_fill","col":122,"row":14},{"id":"goal_pole","col":123,"row":2},{"id":"block_stair","col":123,"row":12},{"id":"block_ground_top","col":123,"row":13},{"id":"block_ground_fill","col":123,"row":14},{"id":"bg_grass","col":124,"row":12},{"id":"block_ground_top","col":124,"row":13},{"id":"block_ground_fill","col":124,"row":14},{"id":"block_ground_top","col":125,"row":13},{"id":"block_ground_fill","col":125,"row":14},{"id":"block_ground_top","col":126,"row":13},{"id":"block_ground_fill","col":126,"row":14},{"id":"block_ground_top","col":127,"row":13},{"id":"block_ground_fill","col":127,"row":14},{"id":"bg_tree","col":128,"row":10},{"id":"block_ground_top","col":128,"row":13},{"id":"block_ground_fill","col":128,"row":14},{"id":"block_ground_top","col":129,"row":13},{"id":"block_ground_fill","col":129,"row":14},{"id":"block_q_mushroom","col":8,"row":9},{"id":"block_q_poison","col":13,"row":9},{"id":"block_q_enemy","col":14,"row":5},{"id":"block_q_badstar","col":35,"row":8},{"id":"block_q_poison_mass","col":47,"row":9},{"id":"block_q_coin_mass","col":59,"row":9},{"id":"block_q_badstar","col":67,"row":9},{"id":"enemy_syobon","col":27,"row":9},{"id":"enemy_cloud_face","col":103,"row":5},{"id":"player_start","col":1,"row":12},{"id":"bgm_field","col":0,"row":0}];
    loadData({ cols: 130, theme: "overworld", elements: E });
    hintEl.textContent = "已载入原版 1-1 示例关卡：共 355 个元素，130 列";
    scroller.scrollLeft = 0;
  }

  // ---------- 初始化 ----------
  buildPalette();
  updateTileSize();   // 首次计算响应式 tile 大小
  renderGutter();
  colsInput.value = state.cols;
  document.getElementById('gridBtn').classList.add('active');
  if (!restore()) {
    loadDemo();
  } else {
    requestRender();
  }
})();
