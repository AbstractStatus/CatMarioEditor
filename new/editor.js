/*
 * 猫里奥关卡编辑器 - 主逻辑
 * 网格 29x29、17 行（与 catmario/src/main.cpp 的 stagedate[17][1001] 一致）。
 * 关卡保存为 JSON：{ cols, theme, elements:[{id,col,row,len?,xt?}] }
 * 元素原生 ID（mapId/ttype/atype/ntype/bgmId）见 elements.js 中的注释。
 */
(function () {
  'use strict';

  var TILE = CAT.TILE;       // 29
  var ROWS = CAT.ROWS;       // 17
  var ASSETS = 'assets/';

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

  // ---------- 工具 ----------
  var tool = null;            // 选中的元素 id，或 'eraser'
  var hover = null;           // {col,row}
  var painting = false;
  var paintBtn = 0;
  var paintedCells = null;    // 本次拖拽已处理格子
  var debris = [];            // 碎裂粒子
  var bgmAudio = null;        // BGM 试听

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

  function drawSprite(el, def, x, y, alpha) {
    var im = getImg(def);
    if (!im || !im.complete || im.naturalWidth === 0) return;
    var w = im.naturalWidth, h = im.naturalHeight;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    if (def.cat === 'bg') {
      ctx.drawImage(im, Math.round(x), Math.round(y));
    } else {
      // 与游戏一致：以格子为锚点顶部对齐、水平居中
      var dx = x + (TILE - w) / 2;
      var dy = y;
      if (def.id === 'player_start') dy = y - (h - TILE); // 起点：脚在格底
      ctx.drawImage(im, Math.round(dx), Math.round(dy));
    }
    ctx.globalAlpha = 1;
  }

  function drawElement(e, alpha) {
    var d = CAT.byId(e.id);
    if (!d) return;
    var x = e.col * TILE, y = e.row * TILE;

    if (d.cat === 'audio') {
      var cx = x + 14, cy = y + 14;
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.fillStyle = d.color;
      ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('♪', cx, cy + 1);
      ctx.font = '9px sans-serif';
      ctx.fillText(String(d.bgmId), cx, cy + 20);
      ctx.globalAlpha = 1;
      return;
    }

    if (d.kind === 'vector' && d.id === 'firebar') {
      // 火焰棒：一串橙色圆（fillarc r8 + 黑圈），编辑器按 xt 个数横排显示
      var n = e.xt || d.xt || 5;
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      for (var i = 0; i < n; i++) {
        var fx = x + 14 + i * 17, fy = y + TILE + 6;
        ctx.fillStyle = '#e67800';
        ctx.beginPath(); ctx.arc(fx, fy, 8, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }

    if (d.id.indexOf('lift_') === 0) {
      // 升降台：按 len 拉伸预渲染图
      var im = getImg(d);
      var Lw = liftLen(e) * TILE;
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      if (im && im.complete && im.naturalWidth) {
        // 预渲染图为 90x18（3格87px+余量），条体在顶部15px，游戏中位于格内 y+7
        ctx.drawImage(im, Math.round(x - 1), Math.round(y + 7), Lw + 2, im.naturalHeight);
      } else {
        ctx.fillStyle = d.img.indexOf('yellow') >= 0 ? '#dcdc00' :
                        d.img.indexOf('green') >= 0 ? '#00dcdc' : '#b0b0b0';
        ctx.fillRect(x, y + 7, Lw, 14);
      }
      ctx.globalAlpha = 1;
      return;
    }

    if (d.id === 'block_hidden') {
      ctx.globalAlpha = alpha == null ? 0.35 : alpha * 0.35;
      var him = getImg(d);
      if (him && him.complete) {
        ctx.drawImage(him, Math.round(x - 0.5), Math.round(y - 1));
      }
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#c00';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      return;
    }

    if (d.id === 'player_start') {
      drawSprite(e, d, x, y, alpha);
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.fillStyle = '#0a7d20';
      ctx.fillRect(x + 1, y - 9, 26, 8);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 7px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('起点', x + 14, y - 5);
      ctx.strokeStyle = '#0a7d20';
      ctx.strokeRect(x + 0.5, y - 9.5, 27, TILE + 9);
      ctx.globalAlpha = 1;
      return;
    }

    // 其余精灵 / 管道 / 旗杆等矢量预渲染图
    var im2 = getImg(d);
    if (im2 && im2.complete && im2.naturalWidth) {
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      var iw = im2.naturalWidth, ih = im2.naturalHeight;
      var dx, dy;
      if (d.cat === 'bg') {
        dx = x; dy = y;
      } else if (d.cat === 'struct') {
        // 矢量预渲染图各自带 1px 黑边余量，按 main.cpp 的绘制坐标对齐
        switch (d.id) {
          case 'pipe_top':  dx = x;     dy = y - 1; break;  // 绿块 60x30
          case 'pipe_body': dx = x + 4; dy = y - 1; break;  // 管身 50x30（居中于60宽上口）
          case 'pipe_h':    dx = x + 9; dy = y + 2; break;  // 横管 39x50 居中于 2x2 格
          case 'pipe_v2':   dx = x;     dy = y + 4; break;  // 29x53
          case 'goal_pole':
          case 'fake_pole': dx = x;     dy = y;     break;  // 球心在格顶，杆向下延伸
          default:          dx = x;     dy = y;              // bg_midflag 等精灵
        }
      } else {
        dx = x + (TILE - iw) / 2;
        dy = y;
      }
      ctx.drawImage(im2, Math.round(dx), Math.round(dy));
      ctx.globalAlpha = 1;
    }
  }

  function render() {
    updateDebris();

    var W = state.cols * TILE;
    var H = ROWS * TILE;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;

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
      eraseAt(cell.col, cell.row);
    } else if (tool === 'eraser') {
      eraseAt(cell.col, cell.row);
    } else if (tool) {
      placeAt(cell.col, cell.row);
      stopBgm();
    }
    paintedCells[cellKey(cell.col, cell.row)] = true;
  });

  canvas.addEventListener('mousemove', function (ev) {
    var cell = evtCell(ev);
    hover = cell;
    statusEl.textContent = '位置：列 ' + cell.col + ' / 行 ' + cell.row +
      '（共 ' + state.elements.length + ' 个元素，画布 ' + state.cols + ' 列）';
    if (painting) {
      var k = cellKey(cell.col, cell.row);
      if (!paintedCells[k]) {
        paintedCells[k] = true;
        if (paintBtn === 2 || tool === 'eraser') {
          eraseAt(cell.col, cell.row);
        } else if (tool) {
          // 拖动连续放置：仅方块/地面类按格刷，其余只放一次
          var d = CAT.byId(tool);
          if (d && (d.cat === 'block')) placeAt(cell.col, cell.row);
        }
      }
    }
    requestRender();
  });

  window.addEventListener('mouseup', function () { painting = false; paintedCells = null; });
  canvas.addEventListener('mouseleave', function () { hover = null; requestRender(); });
  canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

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

  // 试玩：把当前关卡交给 play.html（原版引擎 + 内存补丁）
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
    var E = [];
    // 地面（表+填）
    for (var c = 0; c < 46; c++) {
      if (c >= 14 && c <= 15) continue;            // 留个坑
      if (c >= 33 && c <= 34) continue;
      E.push(el('block_ground_top', c, 13));
      E.push(el('block_ground_fill', c, 14));
    }
    // 坑底尖刺装饰
    E.push(el('block_spike', 14, 14));
    E.push(el('block_spike', 15, 14));
    // 起点
    E.push(el('player_start', 1, 12));
    // 砖块 + 问号
    E.push(el('block_brick', 6, 9));
    E.push(el('block_question', 7, 9));
    E.push(el('block_brick', 8, 9));
    E.push(el('block_question', 7, 5));
    E.push(el('block_hidden', 10, 9));
    // 金币
    E.push(el('item_coin', 7, 8));
    E.push(el('item_mushroom_red', 9, 12));
    // 敌人
    E.push(el('enemy_syobon', 12, 12));
    E.push(el('enemy_turtle', 24, 11));
    // 管道
    E.push(el('pipe_top', 19, 11));
    E.push(el('pipe_body', 19, 12));
    // 中间旗
    E.push(el('bg_midflag', 26, 10));
    // 升降台
    E.push(el('lift_yellow', 29, 10, { len: 3 }));
    // 楼梯
    for (var s = 0; s < 4; s++) {
      for (var s2 = 0; s2 <= s; s2++) E.push(el('block_stair', 38 + s, 12 - s2));
    }
    // 终点旗杆
    E.push(el('goal_pole', 44, 1));
    // 背景
    E.push(el('bg_hill_house', 2, 10));
    E.push(el('bg_grass', 11, 12));
    E.push(el('bg_cloud_face', 16, 3));
    E.push(el('bg_tree', 27, 10));
    E.push(el('bg_cloud_angry', 35, 4));
    // BGM
    E.push(el('bgm_field', 0, 2));
    E.push(el('bgm_castle', 43, 2));

    loadData({ cols: 60, theme: 'overworld', elements: E });
    hintEl.textContent = '已载入示例关卡：试试点击元素→画布放置，或擦除/保存 JSON';
    scroller.scrollLeft = 0;
  }

  // ---------- 初始化 ----------
  buildPalette();
  renderGutter();
  colsInput.value = state.cols;
  document.getElementById('gridBtn').classList.add('active');
  if (!restore()) {
    loadDemo();
  } else {
    requestRender();
  }
})();
