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
  var EXTRA_TOP_ROWS = 3;   // 画布顶部额外留出 3 行，让 row<0 的超界元素（如桃色方块猫）可见
  var ASSETS = 'assets/';

  // 响应式：TILE 放大到让整个关卡高度占页面的 ~80%
  function updateTileSize() {
    // 可用高度 = 窗口高度 - 工具栏 - 状态栏 - 一些 padding
    var availH = window.innerHeight - 56 - 46 - 20;
    var tileByH = Math.floor(availH / (ROWS + EXTRA_TOP_ROWS));
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

  // sky 背景色与新引擎 engine.js 的 stagecolor 背景色严格对应：
  // stagecolor 1(地上)/3(空中) → #a0b4fa 蓝；2(地下)/4(城堡) → #0a0a0a 黑
  var THEMES = {
    overworld: { name: '地上', sky: '#a0b4fa', debris: [144, 96, 48] },
    dungeon:   { name: '地下', sky: '#0a0a0a', debris: [0, 120, 160] },
    castle:    { name: '城堡', sky: '#0a0a0a', debris: [192, 192, 192] },
    sky:       { name: '空中', sky: '#a0b4fa', debris: [144, 96, 48] }
  };

  var state = {
    cols: 120,
    theme: 'overworld',
    bgm: 100,         // 本关 BGM ID（关卡级设置，不放画布；100/103/104/105/106 或自定义 200+）
    nextLevel: { end: false, id: null },  // 通关后去向：{end:false,id:null}=下一关，{end:true}=游戏结束，{id:'1-3'}=指定世界
    hintTexts: {},    // 提示块自定义文本 {txtype: ["line1","line2",...]}
    customBgm: [],    // 自定义 BGM 列表 [{id, name, dataUrl}]
    customSfx: [],    // 自定义音效列表 [{id, name, dataUrl}]
    grid: true,
    elements: [],     // {uid, id, col, row, len?, xt?}
    _worldDef: null   // 载入“示例世界”时的原版关卡 def（未编辑前用于试玩 1:1 还原）
  };

  // ---------- 元素实例唯一 ID（uid） ----------
  // 注意与类型 id（CAT 定义里的 block_brick / enemy_syobon 等）区分：
  // uid 标识关卡内“一个具体实例”，同一关里的每块砖/每个敌人都不同。
  // 命名约定：
  //   u1,u2,...        用户手放元素、以及旧档/异常数据补号
  //   g行_列 / b序号 / p序号 / e序号 / l序号 / spawn
  //                    示例世界反推（worldToElements）的确定性 id，
  //                    同一关重复载入 uid 恒定，序号=stages_data 原数组下标，便于复现问题
  var uidSeq = 0;
  var uidSet = Object.create(null);
  function nextUid() {
    var u;
    do { u = 'u' + (++uidSeq); } while (uidSet[u]);
    uidSet[u] = true;
    return u;
  }
  // 认领外部带入的 uid：合法且本关未用过则保留，否则返回 null 由调用方补号
  function claimUid(u) {
    if (typeof u === 'string' && u.length > 0 && !uidSet[u]) { uidSet[u] = true; return u; }
    return null;
  }
  // 载入后把 u<n> 的最大序号并入计数器，使新手放元素续号不碰撞
  function bumpUidSeq() {
    state.elements.forEach(function (e) {
      var m = /^u(\d+)$/.exec(e.uid || '');
      if (m) uidSeq = Math.max(uidSeq, +m[1]);
    });
  }

  // 音效表（与 game/audio.js SE_FILES 一致；仅用于音乐 TAB 试听，游戏内自动触发）
  var SFX_LIST = [
    { id: 1,  file: 'jump.mp3',        name: '跳跃' },
    { id: 3,  file: 'brockbreak.mp3',  name: '砖块碎裂' },
    { id: 4,  file: 'coin.mp3',        name: '吃金币' },
    { id: 5,  file: 'humi.mp3',        name: '踩踏敌人' },
    { id: 6,  file: 'koura.mp3',       name: '踢龟壳' },
    { id: 7,  file: 'dokan.mp3',       name: '进入管道' },
    { id: 8,  file: 'brockkinoko.mp3', name: '顶出道具' },
    { id: 9,  file: 'powerup.mp3',     name: '获得强化' },
    { id: 10, file: 'kirra.mp3',       name: '击中敌人' },
    { id: 11, file: 'goal.mp3',        name: '到达终点' },
    { id: 12, file: 'death.mp3',       name: '死亡' },
    { id: 13, file: 'Pswitch.mp3',     name: 'P开关' },
    { id: 14, file: 'jumpBlock.mp3',   name: '头顶砖块' },
    { id: 15, file: 'hintBlock.mp3',   name: '提示块' },
    { id: 16, file: '4-clear.mp3',     name: '过关结算' },
    { id: 17, file: 'allclear.mp3',    name: '全部通关' },
    { id: 18, file: 'tekifire.mp3',    name: '敌人喷火' }
 ];
  var BGM_VALID = [100, 103, 104, 105, 106];

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
    // 自定义元素：用 dataUrl 直接加载
    if (el.dataUrl) {
      if (!imgCache[el.dataUrl]) {
        var im = new Image();
        im.src = el.dataUrl;
        im.onload = function () { requestRender(); };
        imgCache[el.dataUrl] = im;
      }
      return imgCache[el.dataUrl];
    }
    if (!el.img) return null;
    if (!imgCache[el.img]) {
      var im2 = new Image();
      im2.src = ASSETS + 'sprites/' + el.img;
      im2.onload = function () { requestRender(); };
      imgCache[el.img] = im2;
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
      bgm: state.bgm,
      nextLevel: state.nextLevel ? { end: !!state.nextLevel.end, id: state.nextLevel.id || null } : { end: false, id: null },
      hintTexts: state.hintTexts ? JSON.parse(JSON.stringify(state.hintTexts)) : {},
      customBgm: state.customBgm ? JSON.parse(JSON.stringify(state.customBgm)) : [],
      customSfx: state.customSfx ? JSON.parse(JSON.stringify(state.customSfx)) : [],
      elements: state.elements.map(function (e) {
        var o = { id: e.id, col: e.col, row: e.row };
        if (e.uid) o.uid = e.uid;   // 撤销快照白名单：uid 必须随快照保留
        if (e.len != null) o.len = e.len;
        if (e.xt != null) o.xt = e.xt;
        if (e.rot) o.rot = e.rot;
        if (e.warp) o.warp = { end: !!e.warp.end, id: e.warp.id || null };
        if (e.hintType) o.hintType = e.hintType;
        if (e.hintCustom) o.hintCustom = e.hintCustom;
        if (e.pop) o.pop = e.pop;
        if (e.mass) o.mass = true;
        if (e.ori) o.ori = e.ori;
        if (e.count != null) o.count = e.count;
        if (e.dir) o.dir = e.dir;
        if (e.delay != null) o.delay = e.delay;
        if (e.chain) o.chain = e.chain;   // 坠落砖组链式触发目标 uid
        if (e.trap) o.trap = JSON.parse(JSON.stringify(e.trap));   // 内部陷阱触发区原始参数
        return o;
      })
    };
  }
  function pushHistory() {
    // 任何编辑（增删元素/换主题/改列数/清空）都会使“原版世界高保真 def”失效
    state._worldDef = null;
    history.push(snapshot());
    if (history.length > MAX_HISTORY) history.shift();
  }
  function undo() {
    if (!history.length) return false;
    var prev = history.pop();
    state.cols = prev.cols;
    state.theme = prev.theme;
    state.bgm = prev.bgm || 100;
    state.nextLevel = prev.nextLevel || { end: false, id: null };
    state.hintTexts = prev.hintTexts || {};
    state.customBgm = prev.customBgm || [];
    state.customSfx = prev.customSfx || [];
    state.elements = prev.elements;
    selected = null;
    colsInput.value = state.cols;
    document.getElementById('themeSel').value = state.theme;
    updateBgmCard();
    persist();
    rebuildPalette();
    requestRender();
    hintEl.textContent = '已撤销（剩余 ' + history.length + ' 步）';
    return true;
  }

  // ---------- 选中 / 拖动 ----------
  var selected = null;        // 当前选中的元素（state.elements 中的引用）
  var dragging = false;       // 是否正在拖动选中元素
  var dragCommitted = false;  // 本次拖动是否已真正移位并入撤销栈（仅单击选中不入栈）
  var dragOrigCol = 0, dragOrigRow = 0;   // 拖动开始时元素位置
  var dragStartCol = 0, dragStartRow = 0; // 拖动开始时鼠标所在格
  var dblSeedUid = null;      // 双击第一下按下时该格已有元素的 uid（区分“双击已有元素”与“空白处放置”）

  // 命中测试：按图层从高到低，返回第一个覆盖 (col,row) 的元素
  function hitTest(col, row) {
    var list = state.elements.slice().sort(function (a, b) {
      return layerOfSorted(CAT.byId(b.id)) - layerOfSorted(CAT.byId(a.id));
    });
    for (var i = 0; i < list.length; i++) {
      var fp = footprintOf(list[i]);
      if (col >= fp.c0 && col <= fp.c1 && row >= fp.r0 && row <= fp.r1) return list[i];
    }
    return null;
  }

  function cellKey(c, r) { return c + ',' + r; }

  // 坠落砖组属性（元素实例缺省时取元素定义默认值；block_fall_d 为地下砖延时变体）
  function fallInfo(e) {
    var d = CAT.byId((e && e.id) || 'block_fall') || CAT.byId('block_fall');
    var ori = (e && e.ori === 'v') ? 'v' : 'h';
    var count = (e && e.count != null) ? (e.count | 0) : (d.count || 3);
    if (!count || count < 2) count = 2;
    if (count > 12) count = 12;
    var dir = (e && e.dir) || d.dir || 'down';
    var valid = ori === 'h' ? { up: 1, down: 1 } : { left: 1, right: 1 };
    if (!valid[dir]) dir = ori === 'h' ? 'down' : 'left';
    var delay = (e && e.delay != null) ? +e.delay : (d.delay != null ? d.delay : 0);
    if (!isFinite(delay) || delay < 0) delay = 0;
    if (delay > 10) delay = 10;
    var chain = (e && e.chain) ? String(e.chain) : '';
    return { ori: ori, count: count, dir: dir, delay: delay, chain: chain };
  }

  // 悬挂站台属性（元素实例缺省时取元素定义默认值）
  function platInfo(e) {
    var d = CAT.byId('platform_hang');
    var w = (e && e.w != null) ? (e.w | 0) : (d.w || 5);
    var h = (e && e.h != null) ? (e.h | 0) : (d.h || 16);
    if (!w || w < 1) w = 1;
    if (w > 50) w = 50;
    if (!h || h < 1) h = 1;
    if (h > 30) h = 30;
    var drop = !!(e && e.drop);
    return { w: w, h: h, drop: drop };
  }

  function footprint(elDef, col, row) {
    var tw = elDef.tw || 1, th = elDef.th || 1;
    var len = elDef.len || 1;
    if (elDef.id === 'platform_hang') {
      // 悬挂站台：仅站台顶占 1 行 × w 列；吊柱向下延伸纯视觉，不占碰撞格
      var pw = elDef.w || 5;
      return { c0: col, c1: col + pw - 1, r0: row, r1: row, tw: pw, th: 1 };
    }
    if (elDef.id === 'block_fall' || elDef.id === 'block_fall_d') {
      // 坠落砖组：横排 1×count，竖排 count×1（放置预览按定义默认属性）
      var fc = elDef.count || 3, fhoriz = elDef.ori !== 'v';
      return fhoriz
        ? { c0: col, c1: col + fc - 1, r0: row, r1: row, tw: fc, th: 1 }
        : { c0: col, c1: col, r0: row, r1: row + fc - 1, tw: 1, th: fc };
    }
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

  // footprint → 画布像素矩形（支持 pixel 级精确覆盖，如中间旗按 40x60 原始比例绘制）
  function fpRect(fp) {
    var x = fp.c0 * TILE, y = (fp.r0 + EXTRA_TOP_ROWS) * TILE;
    var w = (fp.c1 - fp.c0 + 1) * TILE, h = (fp.r1 - fp.r0 + 1) * TILE;
    if (fp.pixel) {
      x += fp.pixel.dx; y += fp.pixel.dy;
      w = fp.pixel.w; h = fp.pixel.h;
    }
    return { x: x, y: y, w: w, h: h };
  }

  function footprintOf(e) {
    var d = CAT.byId(e.id);
    if (d.id === '_trapzone') {
      // 陷阱触发区：仅显示起始区域（1×2 格标记），实际 AABB（trap.sc/sd）保留给试玩，不在画布展开
      return { c0: e.col, c1: e.col, r0: e.row, r1: e.row + 1, tw: 1, th: 2 };
    }
    if (d.id === 'bg_midflag') {
      // 中间旗：格子对齐——旗子占放置行顶 ~ 下一行行底（高 2 格整）、左贴 col 格线，
      // 宽保持原版 40px 比例；选中框 = pixel 精确矩形，与视觉完全重合且上下左三边贴格线
      var vw = Math.round(40 / 29 * TILE);
      return {
        c0: e.col, c1: e.col + 1, r0: e.row, r1: e.row + 1, tw: 2, th: 2,
        pixel: { dx: 0, dy: 0, w: vw, h: 2 * TILE }
      };
    }
    if (d.id === 'platform_hang') {
      var pi = platInfo(e);
      return { c0: e.col, c1: e.col + pi.w - 1, r0: e.row, r1: e.row, tw: pi.w, th: 1 };
    }
    if (d.id === 'block_fall' || d.id === 'block_fall_d') {
      var fi = fallInfo(e);
      return fi.ori === 'h'
        ? { c0: e.col, c1: e.col + fi.count - 1, r0: e.row, r1: e.row, tw: fi.count, th: 1 }
        : { c0: e.col, c1: e.col, r0: e.row, r1: e.row + fi.count - 1, tw: 1, th: fi.count };
    }
    if (d.id === 'pipe_cross' || d.id === 'pipe_tee' || d.id === 'pipe_L_a' || d.id === 'pipe_L_b') {
      // connector：中心块 2×2 tile（col,row）~(col+1,row+1)，每方向臂从中心块边缘向外延伸 length 格
      var DIR_BASE_IDX = { up: 0, down: 1, left: 2, right: 3 };
      var defLen = d.lengths || [1, 1, 1, 1];
      var eLen = e.lengths || defLen.slice();
      var portLens = [1, 1, 1, 1];
      if (d.id === 'pipe_cross' || d.id === 'pipe_tee') {
        for (var _i = 0; _i < 4; _i++) portLens[_i] = Math.max(1, Math.min(4, eLen[_i] | 0 || defLen[_i] || 1));
      } else if (d.id === 'pipe_L_a') {
        portLens[0] = Math.max(1, Math.min(4, eLen[0] | 0 || defLen[0] || 1));
        portLens[3] = Math.max(1, Math.min(4, eLen[1] | 0 || defLen[1] || 1));
      } else if (d.id === 'pipe_L_b') {
        portLens[0] = Math.max(1, Math.min(4, eLen[0] | 0 || defLen[0] || 1));
        portLens[2] = Math.max(1, Math.min(4, eLen[1] | 0 || defLen[1] || 1));
      }
      var rot = (((e.rot | 0) || 0) % 360 + 360) % 360;
      var dirs;
      if (d.id === 'pipe_cross') dirs = ['up', 'down', 'left', 'right'];
      else if (d.id === 'pipe_tee') {
        var miss = ({ 0: 'down', 90: 'left', 180: 'up', 270: 'right' })[rot] || 'down';
        dirs = ['up', 'down', 'left', 'right'].filter(function (dd) { return dd !== miss; });
      } else if (d.id === 'pipe_L_a') {
        dirs = ({ 0: ['up', 'right'], 90: ['right', 'down'], 180: ['down', 'left'], 270: ['left', 'up'] })[rot] || ['up', 'right'];
      } else {
        dirs = ({ 0: ['up', 'left'], 90: ['up', 'right'], 180: ['right', 'down'], 270: ['down', 'left'] })[rot] || ['up', 'left'];
      }
      // 中心块初始 bounds
      var c0 = e.col, c1 = e.col + 1, r0 = e.row, r1 = e.row + 1;
      dirs.forEach(function (dd) {
        var armLen = portLens[DIR_BASE_IDX[dd]];
        if (dd === 'up') r0 = Math.min(r0, e.row - armLen);
        else if (dd === 'down') r1 = Math.max(r1, e.row + 1 + armLen);
        else if (dd === 'left') c0 = Math.min(c0, e.col - armLen);
        else c1 = Math.max(c1, e.col + 1 + armLen);
      });
      return { c0: c0, c1: c1, r0: r0, r1: r1, tw: c1 - c0 + 1, th: r1 - r0 + 1 };
    }
    if (d.id === 'pipe_mouth') {
      // 管口 1 tile + 管身 length tile，共 1 + length 格
      var _pmLen = Math.max(1, Math.min(20, e.length | 0 || d.length || 1));
      var _pmDir = e.dir || d.dir || 'up';
      if (_pmDir === 'left' || _pmDir === 'right') {
        // 横管：(length+1) 宽 × 2 高
        return { c0: e.col, c1: e.col + _pmLen, r0: e.row, r1: e.row + 1, tw: _pmLen + 1, th: 2 };
      }
      // 竖管（up/down）：2 宽 × (length+1) 高
      return { c0: e.col, c1: e.col + 1, r0: e.row, r1: e.row + _pmLen, tw: 2, th: _pmLen + 1 };
    }
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
  // player_start / bg_midflag 不参与互斥（中间旗是背景装饰，可与方块同格）
  function isSolid(d) {
    return d.cat === 'block' ||
      (d.cat === 'struct' && d.id !== 'player_start' && d.id !== 'bg_midflag' && d.id !== '_trapzone');
  }

  function placeAt(col, row) {
    if (col < 0 || col >= state.cols) return;
    if (row < -EXTRA_TOP_ROWS || row >= ROWS) return;
    if (!inStroke) pushHistory();
    var d = CAT.byId(tool);
    if (!d) return;
    var tw = d.tw || 1, th = d.th || 1;
    var len = d.len || tw;
    if (d.id.indexOf('lift_') === 0) { tw = len; }
    if (d.id === 'platform_hang') { tw = d.w || 5; th = 1; }
    if (d.id === 'block_fall' || d.id === 'block_fall_d') {
      tw = d.ori === 'v' ? 1 : (d.count || 3);
      th = d.ori === 'v' ? (d.count || 3) : 1;
    }
    if (d.id === 'pipe_mouth') {
      var _pmLen0 = Math.max(1, Math.min(20, d.length || 1));
      var _pmDir0 = d.dir || 'up';
      if (_pmDir0 === 'left' || _pmDir0 === 'right') { tw = _pmLen0 + 1; th = 2; }
      else { tw = 2; th = _pmLen0 + 1; }
    }
    if (d.id === '_trapzone') { tw = 1; th = 2; }
    col = Math.min(col, state.cols - tw);
    row = Math.min(row, ROWS - th);
    row = Math.max(row, -EXTRA_TOP_ROWS);
    if (col < 0) return;

    var fp = footprint(d, col, row);
    if (d.id.indexOf('lift_') === 0) fp.c1 = col + len - 1;
    if (d.id === 'platform_hang') fp.c1 = col + (d.w || 5) - 1;
    // connector：用临时元素计算 arm-aware 完整 footprint（避免新建后与臂范围内已有元素重叠）
    if (d.id === 'pipe_cross' || d.id === 'pipe_tee' || d.id === 'pipe_L_a' || d.id === 'pipe_L_b') {
      var _tmp = { id: d.id, col: col, row: row, lengths: (d.lengths || [1, 1]).slice(), rot: 0 };
      fp = footprintOf(_tmp);
    }
    // pipe_mouth：用临时元素计算动态 footprint（含方向）
    if (d.id === 'pipe_mouth') {
      var _pmLenTmp = Math.max(1, Math.min(20, d.length || 1));
      var _pmDirTmp = d.dir || 'up';
      fp = footprintOf({ id: 'pipe_mouth', col: col, row: row, length: _pmLenTmp, dir: _pmDirTmp });
    }

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

    var ne = { id: d.id, col: col, row: row, uid: nextUid() };
    if (d.id.indexOf('lift_') === 0) ne.len = len;
    if (d.id === 'platform_hang') { ne.w = d.w || 5; ne.h = d.h || 16; ne.drop = !!d.drop; }
    if (d.id === 'block_fall' || d.id === 'block_fall_d') {
      ne.ori = d.ori || 'h'; ne.count = d.count || 3; ne.dir = d.dir || 'down';
      ne.delay = (d.delay != null) ? d.delay : 0;
    }
    if (d.id === 'pipe_mouth') { ne.length = Math.max(1, d.length || 1); ne.dir = d.dir || 'up'; ne.entry = d.entry || 'none'; if (ne.entry === 'warp') ne.warp = { end: true, id: null }; }
    if (d.id === 'block_question' || d.id === 'block_hidden') { ne.pop = d.pop || 'coin'; ne.mass = !!d.mass; }
    if (d.id === 'pipe_cross' || d.id === 'pipe_tee' || d.id === 'pipe_L_a' || d.id === 'pipe_L_b') {
      ne.lengths = (d.lengths || [1, 1]).slice();
      ne.rot = 0;
    }
    if (d.xt) ne.xt = d.xt;
    if (d.id === '_trapzone') {
      ne.trap = {
        stype: d.trapStype || 101,
        sxtype: d.trapSxtype || 0,
        sa: col * 2900,
        sb: (row * 29 - 12) * 100,
        sc: d.trapW || 7000,
        sd: d.trapH || 70000
      };
    }
    if (d.warpable) ne.warp = { end: false, id: (window.STAGES && window.STAGES[0]) ? window.STAGES[0].id : '1-1' };
    state.elements.push(ne);
    if (d.warpable) { selected = ne; updateWarpSel(); }
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
      if (p.life <= 0 || p.y > (ROWS + EXTRA_TOP_ROWS) * TILE + 20) debris.splice(i, 1);
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
  // 火焰棒特殊处理：始终在最上层渲染，不被方块/敌人遮挡
  function layerOfSorted(d) {
    if (d.id === 'firebar') return 10;
    return layerOf(d);
  }

  // TILE 比例的工具：原始设计按 TILE=29，所以任何硬编码 px 都除以 29 再乘 TILE
  function tilePx(n) { return Math.round(n / CAT.TILE * TILE); }

  // 高清资源自适应绘图：
  // 源分辨率 >= 目标 1.5× 视为高清重绘资源，用高质量双线性插值（平滑曲线）；
  // 原版像素图（naturalW ≈ 目标）保持最近邻，放大后仍是锐利方块。
  // 主画布已按 DPR 出图，dw/dh 为 CSS 像素，浏览器直接采样到最终设备像素。
  function drawImg(im, dx, dy, dw, dh) {
    var hd = im.naturalWidth >= dw * 1.5 || im.naturalHeight >= dh * 1.5;
    if (hd) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; }
    ctx.drawImage(im, Math.round(dx), Math.round(dy), Math.ceil(dw), Math.ceil(dh));
    if (hd) { ctx.imageSmoothingEnabled = false; ctx.imageSmoothingQuality = 'low'; }
  }

  function drawSprite(el, def, x, y, alpha) {
    var im = getImg(def);
    if (!im || !im.complete || im.naturalWidth === 0) return;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    if (def.custom) {
      // 自定义元素：按 tw×th 格子数绘制
      var cw = TILE * (def.tw || 1), ch = TILE * (def.th || 1);
      drawImg(im, x, y, cw, ch);
    } else if (def.cat === 'bg') {
      // 背景图：按 manifest 设计尺寸随 TILE 等比放大（跨多格，按锚点位置放置）
      var bs = bgDrawSize(def, im);
      drawImg(im, x, y, bs.w, bs.h);
    } else {
      // 所有非背景元素：强制缩放到 TILE × TILE
      var dx = Math.round(x);
      var dy = Math.round(y);
      if (def.id === 'player_start') dy = Math.round(y - (TILE - TILE)); // 脚在格底（dh=TILE）
      drawImg(im, dx, dy, TILE, TILE);
    }
    ctx.globalAlpha = 1;
  }

  function drawElement(e, alpha) {
    var d = CAT.byId(e.id);
    if (!d) return;
    if (d.id === '_trapzone') {
      // 陷阱触发区：仅绘制起始标记（1×2 格），不展开完整 AABB（过程区域不显示）
      var tz = e.trap || {};
      var tx = e.col * TILE, ty = (e.row + EXTRA_TOP_ROWS) * TILE;
      var tw = TILE, th = 2 * TILE;
      ctx.save();
      ctx.globalAlpha = a * 0.9;
      var st = tz.stype || d.trapStype || 101;
      var colors = { 100: '#ff5c5c', 101: '#c084fc', 102: '#fbbf24', 103: '#38bdf8', 104: '#34d399' };
      var col = colors[st] || '#ff00ff';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(tx + 1, ty + 1, tw - 2, th - 2);
      ctx.setLineDash([]);
      // 标签
      var names = { 100: '猫脸', 101: '幽灵', 102: '天降', 103: '激光', 104: '光束' };
      var label = names[st] || st;
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = col;
      ctx.fillRect(tx, ty, tw, 15);
      ctx.fillStyle = '#0b0e14';
      ctx.fillText(label, tx + 3, ty + 12);
      ctx.restore();
      return;
    }
    var x = e.col * TILE, y = (e.row + EXTRA_TOP_ROWS) * TILE;
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
      // 与引擎渲染一致：第0颗火球（圆心）=格子中心，间距18px、半径6px，
      // 链条从圆心按 e.rot 角度（顺时针，0=向右）伸出，共 xt+1 颗（含圆心）
      var n = e.xt || d.xt || 5;
      var ang = ((e.rot || 0) * Math.PI) / 180;
      var pcx = x + TILE / 2, pcy = y + TILE / 2;
      ctx.globalAlpha = a;
      for (var i = 0; i <= n; i++) {
        // 球心距：原 18px，空隙缩小 5px → 13px
        var fbx = pcx + Math.cos(ang) * i * tilePx(13);
        var fby = pcy + Math.sin(ang) * i * tilePx(13);
        ctx.fillStyle = '#ff6000';
        ctx.beginPath(); ctx.arc(fbx, fby, tilePx(6), 0, Math.PI * 2); ctx.fill();
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
        drawImg(im, x - 1, y + tilePx(7), Lw + 2, tilePx(14));
      } else {
        ctx.fillStyle = d.img.indexOf('yellow') >= 0 ? '#dcdc00' :
                        d.img.indexOf('green') >= 0 ? '#00dcdc' : '#b0b0b0';
        ctx.fillRect(x, y + tilePx(7), Lw, tilePx(14));
      }
      ctx.globalAlpha = 1;
      return;
    }

    if (d.id === 'platform_hang') {
      // 原版 main.cpp srsp=10：绿色站台顶(30px) + 棕色吊柱(宽=站台-40，高=h格)
      var pi = platInfo(e);
      var ppw = pi.w * TILE;
      var pin = Math.min(tilePx(20), ppw / 4);
      ctx.globalAlpha = a;
      if (ppw - pin * 2 > 0 && pi.h > 0) {
        ctx.fillStyle = '#b4783c';
        ctx.fillRect(x + pin, y + tilePx(30), ppw - pin * 2, pi.h * TILE);
        ctx.strokeStyle = '#645014';
        ctx.lineWidth = Math.max(1, tilePx(2));
        ctx.strokeRect(x + pin, y + tilePx(30), ppw - pin * 2, pi.h * TILE);
      }
      ctx.fillStyle = '#00c800';
      ctx.fillRect(x, y, ppw, tilePx(30));
      ctx.strokeStyle = '#00a000';
      ctx.lineWidth = Math.max(1, tilePx(2));
      ctx.strokeRect(x, y, ppw, tilePx(30));
      if (pi.drop) {
        var pcx = x + ppw / 2, pcy = y + tilePx(30) / 2;
        ctx.font = 'bold ' + tilePx(18) + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeText('↓', pcx, pcy + 1);
        ctx.fillStyle = 'rgba(200,30,30,0.95)';
        ctx.fillText('↓', pcx, pcy + 1);
      }
      ctx.globalAlpha = 1;
      return;
    }

    if (d.id === 'block_fall' || d.id === 'block_fall_d') {
      // count 张砖块精灵按横/竖拼接，中心叠加红色方向箭头标识机关
      // block_fall 用普通砖、block_fall_d 用地下砖（各取元素定义 img）
      var fi = fallInfo(e);
      var bimg = getImg(d);
      ctx.globalAlpha = a;
      for (var bi = 0; bi < fi.count; bi++) {
        var bx = fi.ori === 'h' ? x + bi * TILE : x;
        var by = fi.ori === 'h' ? y : y + bi * TILE;
        if (bimg && bimg.complete && bimg.naturalWidth) {
          drawImg(bimg, bx, by, TILE, TILE);
        } else {
          ctx.fillStyle = '#b5652a';
          ctx.fillRect(bx + 1, by + 1, TILE - 2, TILE - 2);
        }
      }
      var arw = { down: '↓', up: '↑', left: '←', right: '→' }[fi.dir] || '↓';
      var acx = x + (fi.ori === 'h' ? fi.count * TILE / 2 : TILE / 2);
      var acy = y + (fi.ori === 'h' ? TILE / 2 : fi.count * TILE / 2);
      ctx.font = 'bold ' + tilePx(18) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(arw, acx, acy + 1);
      ctx.fillStyle = 'rgba(220,40,40,0.95)';
      ctx.fillText(arw, acx, acy + 1);
      ctx.globalAlpha = 1;
      return;
    }

    // 问号块/隐藏块：底图 + 弹出对象图标 + 量产角标
    if (d.id === 'block_question' || d.id === 'block_hidden') {
      var qpop = e.pop || d.pop || 'coin';
      var qmass = !!e.mass;
      var hidden = d.id === 'block_hidden';
      var qImgId = qpop === 'mushroom' ? 'item_mushroom_red'
        : qpop === 'poison' ? 'item_mushroom_purple'
        : qpop === 'flower' ? 'item_flower'
        : qpop === 'enemy' ? 'enemy_syobon'
        : qpop === 'badstar' ? 'item_star'
        : qpop === 'pswitch' ? 'b2_pswitch'
        : 'item_coin';
      var qImg = getImg(CAT.byId(qImgId));
      if (hidden) {
        // 隐形块：半透明内容物 + 按弹出对象着色的虚线框（游戏中完全不可见）
        ctx.globalAlpha = a * 0.55;
        if (qImg && qImg.complete) drawImg(qImg, x, y, TILE, TILE);
        ctx.globalAlpha = 1;
        ctx.setLineDash([4, 3]);
        var qBC = { coin: '#e8c14d', poison: '#b04de8', pswitch: '#4db4e8',
          mushroom: '#e05555', enemy: '#7dc95e', flower: '#ff9a3c', badstar: '#ffe14d' };
        ctx.strokeStyle = qBC[qpop] || '#e8c14d';
        ctx.lineWidth = Math.max(1.5, TILE / 20);
        ctx.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3);
        ctx.setLineDash([]);
      } else {
        // 可见问号块：先画问号精灵，内容物非金币时叠加半透明内容图标
        drawSprite(e, d, x, y, a);
        if (qpop !== 'coin' && qImg && qImg.complete) {
          ctx.globalAlpha = a * 0.55;
          drawImg(qImg, x + TILE * 0.2, y + TILE * 0.2, TILE * 0.6, TILE * 0.6);
          ctx.globalAlpha = 1;
        }
      }
      if (qmass) {
        // 量产角标：右上角金底“量”字
        var bs = tilePx(11);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#e8a000';
        ctx.fillRect(x + TILE - bs - 1, y + 1, bs, bs);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        ctx.strokeRect(x + TILE - bs - 1, y + 1, bs, bs);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold ' + tilePx(8) + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('量', x + TILE - bs / 2 - 1, y + 1 + bs / 2 + 0.5);
        ctx.globalAlpha = 1;
      }
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
      if (pt && pt.complete) drawImg(pt, x, y, 2 * TILE, TILE);
      for (var py = 1; py < 4; py++) {
        if (pb && pb.complete) drawImg(pb, x, y + py * TILE, 2 * TILE, TILE);
      }
      ctx.globalAlpha = 1;
      return;
    }

    // 连接管：中心块 2×2 tile 满格 + 每方向延伸 length 格管身（外轮廓边框）
    if (d.id === 'pipe_cross' || d.id === 'pipe_tee' || d.id === 'pipe_L_a' || d.id === 'pipe_L_b') {
      ctx.globalAlpha = a;
      var DIR_BASE_IDX = { up: 0, down: 1, left: 2, right: 3 };
      var defLen = d.lengths || [1, 1, 1, 1];
      var eLen = e.lengths || defLen.slice();
      var portLens = [1, 1, 1, 1];
      if (d.id === 'pipe_cross' || d.id === 'pipe_tee') {
        for (var _k = 0; _k < 4; _k++) portLens[_k] = Math.max(1, Math.min(4, eLen[_k] | 0 || defLen[_k] || 1));
      } else if (d.id === 'pipe_L_a') {
        portLens[0] = Math.max(1, Math.min(4, eLen[0] | 0 || defLen[0] || 1));
        portLens[3] = Math.max(1, Math.min(4, eLen[1] | 0 || defLen[1] || 1));
      } else if (d.id === 'pipe_L_b') {
        portLens[0] = Math.max(1, Math.min(4, eLen[0] | 0 || defLen[0] || 1));
        portLens[2] = Math.max(1, Math.min(4, eLen[1] | 0 || defLen[1] || 1));
      }
      var rot = (((e.rot | 0) || 0) % 360 + 360) % 360;
      var dirs;
      if (d.id === 'pipe_cross') dirs = ['up', 'down', 'left', 'right'];
      else if (d.id === 'pipe_tee') {
        var _miss = ({ 0: 'down', 90: 'left', 180: 'up', 270: 'right' })[rot] || 'down';
        dirs = ['up', 'down', 'left', 'right'].filter(function (dd) { return dd !== _miss; });
      } else if (d.id === 'pipe_L_a') {
        dirs = ({ 0: ['up', 'right'], 90: ['right', 'down'], 180: ['down', 'left'], 270: ['left', 'up'] })[rot] || ['up', 'right'];
      } else {
        dirs = ({ 0: ['up', 'left'], 90: ['up', 'right'], 180: ['right', 'down'], 270: ['down', 'left'] })[rot] || ['up', 'left'];
      }
      var dirLenMap = { up: portLens[0], down: portLens[1], left: portLens[2], right: portLens[3] };
      var hasArm = { up: false, down: false, left: false, right: false };
      dirs.forEach(function (dd) { hasArm[dd] = true; });

      // 编辑器 canvas：TILE=29，管身宽 = round(50/29*TILE) ≈ 50 虚拟像素
      var bW = Math.round(50 / 29 * TILE);
      var bHalf = bW / 2;
      var PIPE_OVER = 4;  // 管身末端溢出 = (2*TILE - bW)/2，正好填满缝隙

      // ===== 第一遍：全部填充 =====
      ctx.fillStyle = '#00e600';
      // 中心块 2×2 tile
      ctx.fillRect(x, y, 2 * TILE, 2 * TILE);
      dirs.forEach(function (dd) {
        var armLen = dirLenMap[dd];
        var pxLen = armLen * TILE;
        if (dd === 'up') ctx.fillRect(x + TILE - bHalf, y - pxLen - PIPE_OVER, bW, pxLen + PIPE_OVER);
        else if (dd === 'down') ctx.fillRect(x + TILE - bHalf, y + 2 * TILE, bW, pxLen + PIPE_OVER);
        else if (dd === 'left') ctx.fillRect(x - pxLen - PIPE_OVER, y + TILE - bHalf, pxLen + PIPE_OVER, bW);
        else ctx.fillRect(x + 2 * TILE, y + TILE - bHalf, pxLen + PIPE_OVER, bW);
      });

      // ===== 第二遍：精准边框（无叠合）=====
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2;

      // 中心块 4 条边：有臂 → 只画臂外两侧的 stub 段；无臂 → 画完整
      var stubL = Math.round(TILE - bHalf);  // = TILE - HALF_PIPE_EDITOR
      var stubR = Math.round(TILE + bHalf);  // = TILE + HALF_PIPE_EDITOR
      // 上边
      ctx.beginPath();
      if (hasArm.up) {
        ctx.moveTo(x, y); ctx.lineTo(x + stubL, y);
        ctx.moveTo(x + stubR, y); ctx.lineTo(x + 2 * TILE, y);
      } else {
        ctx.moveTo(x, y); ctx.lineTo(x + 2 * TILE, y);
      }
      ctx.stroke();
      // 下边
      ctx.beginPath();
      if (hasArm.down) {
        ctx.moveTo(x, y + 2 * TILE); ctx.lineTo(x + stubL, y + 2 * TILE);
        ctx.moveTo(x + stubR, y + 2 * TILE); ctx.lineTo(x + 2 * TILE, y + 2 * TILE);
      } else {
        ctx.moveTo(x, y + 2 * TILE); ctx.lineTo(x + 2 * TILE, y + 2 * TILE);
      }
      ctx.stroke();
      // 左边
      ctx.beginPath();
      if (hasArm.left) {
        ctx.moveTo(x, y); ctx.lineTo(x, y + stubL);
        ctx.moveTo(x, y + stubR); ctx.lineTo(x, y + 2 * TILE);
      } else {
        ctx.moveTo(x, y); ctx.lineTo(x, y + 2 * TILE);
      }
      ctx.stroke();
      // 右边
      ctx.beginPath();
      if (hasArm.right) {
        ctx.moveTo(x + 2 * TILE, y); ctx.lineTo(x + 2 * TILE, y + stubL);
        ctx.moveTo(x + 2 * TILE, y + stubR); ctx.lineTo(x + 2 * TILE, y + 2 * TILE);
      } else {
        ctx.moveTo(x + 2 * TILE, y); ctx.lineTo(x + 2 * TILE, y + 2 * TILE);
      }
      ctx.stroke();

      // 每方向臂：画 2 侧（跳过衔接中心块的那条 + 远端帽，端口开口）
      dirs.forEach(function (dd) {
        var armLen = dirLenMap[dd];
        var pxLen = armLen * TILE;
        ctx.beginPath();
        if (dd === 'up') {
          var ux = x + TILE - bHalf, uy = y - pxLen - PIPE_OVER;
          ctx.moveTo(ux, uy); ctx.lineTo(ux, y);
          ctx.moveTo(ux + bW, uy); ctx.lineTo(ux + bW, y);
        } else if (dd === 'down') {
          var dx = x + TILE - bHalf;
          var dy1 = y + 2 * TILE, dy2 = dy1 + pxLen + PIPE_OVER;
          ctx.moveTo(dx, dy1); ctx.lineTo(dx, dy2);
          ctx.moveTo(dx + bW, dy1); ctx.lineTo(dx + bW, dy2);
        } else if (dd === 'left') {
          var ly = y + TILE - bHalf, lx1 = x - pxLen - PIPE_OVER;
          ctx.moveTo(lx1, ly); ctx.lineTo(x, ly);
          ctx.moveTo(lx1, ly + bW); ctx.lineTo(x, ly + bW);
        } else {
          var rx = x + 2 * TILE, ry = y + TILE - bHalf;
          ctx.moveTo(rx, ry); ctx.lineTo(rx + pxLen + PIPE_OVER, ry);
          ctx.moveTo(rx, ry + bW); ctx.lineTo(rx + pxLen + PIPE_OVER, ry + bW);
        }
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      return;
    }

    // 管道口：管口 + 管身，管身只画两侧边（远端去帽），与 connector 端口一致
    if (d.id === 'pipe_mouth') {
      ctx.globalAlpha = a;
      var pmLen = Math.max(1, Math.min(20, e.length | 0 || d.length || 1));
      var pmDir = e.dir || d.dir || 'up';
      var pmPipeW = Math.round(50 / 29 * TILE);
      var bodyThick = pmLen * TILE;
      var PIPE_OVER = 4;
      ctx.fillStyle = '#00e600'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      // 辅助函数：画管身（fillRect + 两侧线，去远端帽，末端溢出 OVER px）
      function drawPipeBody(bx, by, bw, bh, dir) {
        // 末端沿延伸方向多画 OVER px
        var fillX = bx, fillY = by, fillW = bw, fillH = bh;
        if (dir === 'down') { fillH += PIPE_OVER; }
        else if (dir === 'up') { fillY -= PIPE_OVER; fillH += PIPE_OVER; }
        else if (dir === 'right') { fillW += PIPE_OVER; }
        else { fillX -= PIPE_OVER; fillW += PIPE_OVER; }
        ctx.fillRect(fillX, fillY, fillW, fillH);
        // 两侧线也同步延伸
        ctx.beginPath();
        if (dir === 'up') {
          ctx.moveTo(bx, by - PIPE_OVER); ctx.lineTo(bx, by + bh);
          ctx.moveTo(bx + bw, by - PIPE_OVER); ctx.lineTo(bx + bw, by + bh);
        } else if (dir === 'down') {
          ctx.moveTo(bx, by); ctx.lineTo(bx, by + bh + PIPE_OVER);
          ctx.moveTo(bx + bw, by); ctx.lineTo(bx + bw, by + bh + PIPE_OVER);
        } else if (dir === 'left') {
          ctx.moveTo(bx - PIPE_OVER, by); ctx.lineTo(bx + bw, by);
          ctx.moveTo(bx - PIPE_OVER, by + bh); ctx.lineTo(bx + bw, by + bh);
        } else { // right
          ctx.moveTo(bx, by); ctx.lineTo(bx + bw + PIPE_OVER, by);
          ctx.moveTo(bx, by + bh); ctx.lineTo(bx + bw + PIPE_OVER, by + bh);
        }
        ctx.stroke();
      }
      if (pmDir === 'up') {
        var bodyX = x + Math.round((2 * TILE - pmPipeW) / 2);
        ctx.fillRect(x, y, 2 * TILE, TILE); ctx.strokeRect(x, y, 2 * TILE, TILE);
        drawPipeBody(bodyX, y + TILE, pmPipeW, bodyThick, 'down');
      } else if (pmDir === 'down') {
        var bodyX2 = x + Math.round((2 * TILE - pmPipeW) / 2);
        drawPipeBody(bodyX2, y, pmPipeW, bodyThick, 'up');
        ctx.fillRect(x, y + bodyThick, 2 * TILE, TILE); ctx.strokeRect(x, y + bodyThick, 2 * TILE, TILE);
      } else if (pmDir === 'left') {
        var bodyY = y + Math.round((2 * TILE - pmPipeW) / 2);
        ctx.fillRect(x, y, TILE, 2 * TILE); ctx.strokeRect(x, y, TILE, 2 * TILE);
        drawPipeBody(x + TILE, bodyY, bodyThick, pmPipeW, 'right');
      } else { // right
        var bodyY2 = y + Math.round((2 * TILE - pmPipeW) / 2);
        drawPipeBody(x, bodyY2, bodyThick, pmPipeW, 'left');
        ctx.fillRect(x + bodyThick, y, TILE, 2 * TILE); ctx.strokeRect(x + bodyThick, y, TILE, 2 * TILE);
      }
      ctx.globalAlpha = 1;
      return;
    }
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
        drawImg(im2, dx2, dy2, dw2, dh2);
      } else if (d.cat === 'struct' || d.cat === 'enemy') {
        // 管道/旗杆/假旗杆/大敌人：按 tw/th 格数等比缩放
        dx2 = x; dy2 = y;
        if (d.id === 'enemy_turtle') {
          // 绿龟在地图上只占 1 格：按 30x43 原始比例绘制，格底对齐（脚踩地面，向上溢出）
          dw2 = Math.round(im2.naturalWidth / 29 * TILE);
          dh2 = Math.round(im2.naturalHeight / 29 * TILE);
          dy2 = y + TILE - dh2;
        } else if (d.id === 'enemy_robot') {
          // 方块机器人占 2 格高但精灵为 36x50：按 manifest 逻辑比例绘制（不拉伸），
          // 脚底对齐占格底边（与游戏中落地姿态一致）；左侧贴格线，宽 36 向右微溢出
          var rd = designSize[d.img] || { w: im2.naturalWidth, h: im2.naturalHeight };
          dw2 = Math.round(rd.w / 29 * TILE);
          dh2 = Math.round(rd.h / 29 * TILE);
          dy2 = y + 2 * TILE - dh2;
        } else if (d.id === 'bg_midflag') {
          // 中间旗：格子对齐绘制——高度取整 2 格，占放置行+下一行（顶=放置行行顶，底=下一行行底），
          // 宽度保持原版 40px 比例（左贴格线）；play.html convert 同步 sb=row*29
          dw2 = Math.round(40 / 29 * TILE);
          dh2 = 2 * TILE;
          dy2 = y;
        } else {
          dw2 = tw * TILE;
          dh2 = th * TILE;
        }
        drawImg(im2, dx2, dy2, dw2, dh2);
      } else {
        // 方块/物品：按 tw/th 格数缩放（默认 1×1，block_pipe_top/body 是 2×1）
        dx2 = x; dy2 = y;
        dw2 = tw * TILE; dh2 = th * TILE;
        drawImg(im2, dx2, dy2, dw2, dh2);
      }
      ctx.globalAlpha = 1;
    }
  }

  function render() {
    updateDebris();

    var W = state.cols * TILE;
    var H = (ROWS + EXTRA_TOP_ROWS) * TILE;
    // 按设备像素比(DPR)出图：高清资源直接采样到物理像素，避免低分 backing 被二次放大产生锯齿。
    // CSS 显示尺寸固定为 W×H（坐标/命中检测均基于 CSS 像素，与 backing 无关）。
    var dpr = window.devicePixelRatio || 1;
    var BW = Math.round(W * dpr), BH = Math.round(H * dpr);
    if (canvas.width !== BW) canvas.width = BW;
    if (canvas.height !== BH) canvas.height = BH;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 默认 nearest-neighbor，保持原版像素艺术锐利；
    // 高清重绘资源在 drawImg 内临时切换为高质量平滑插值
    ctx.imageSmoothingEnabled = false;

    // 天空（正常区域 + 超界区域统一背景，但超界区画虚线分隔）
    ctx.fillStyle = THEMES[state.theme].sky;
    ctx.fillRect(0, 0, W, H);
    // 超界区（row < 0）用稍暗颜色 + 虚线分隔
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 0, W, EXTRA_TOP_ROWS * TILE);
    ctx.strokeStyle = 'rgba(255,200,80,0.6)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, EXTRA_TOP_ROWS * TILE + 0.5);
    ctx.lineTo(W, EXTRA_TOP_ROWS * TILE + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffcc50';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('↑ 超界区（游戏外）', 4, EXTRA_TOP_ROWS * TILE - 4);

    // 网格
    if (state.grid) {
      // 亮色主题（地上/空中）用半透明黑线；暗色主题（地下/城堡）用半透明白线
      var gridStroke = (state.theme === 'overworld' || state.theme === 'sky')
        ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.22)';
      ctx.strokeStyle = gridStroke;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var c = 0; c <= state.cols; c++) {
        ctx.moveTo(c * TILE + 0.5, 0);
        ctx.lineTo(c * TILE + 0.5, H);
      }
      for (var r = -EXTRA_TOP_ROWS; r <= ROWS; r++) {
        ctx.moveTo(0, (r + EXTRA_TOP_ROWS) * TILE + 0.5);
        ctx.lineTo(W, (r + EXTRA_TOP_ROWS) * TILE + 0.5);
      }
      ctx.stroke();
    }

    // 按层排序绘制
    var list = state.elements.slice().sort(function (a, b) {
      return layerOfSorted(CAT.byId(a.id)) - layerOfSorted(CAT.byId(b.id));
    });
    for (var i = 0; i < list.length; i++) drawElement(list[i]);

    // 悬停幽灵预览
    if (hover && tool && tool !== 'eraser') {
      var d = CAT.byId(tool);
      if (d) {
        // 构造临时伪元素实例（带默认值，让 footprintOf 能正确算动态 footprint）
        var _hLen = (d.id === 'pipe_mouth') ? Math.max(1, Math.min(20, d.length || 1))
          : (d.id.indexOf('lift_') === 0 ? (d.len || 4)
          : (d.id === 'platform_hang' ? (d.w || 5)
          : ((d.id === 'block_fall' || d.id === 'block_fall_d') ? (d.count || 3) : 1)));
        var _hTh = (d.id === 'pipe_mouth') ? (_hLen + 1)
          : (d.id.indexOf('lift_') === 0 ? 1
          : (d.id === 'platform_hang' ? 1
          : ((d.id === 'block_fall' || d.id === 'block_fall_d') ? ((d.ori === 'v') ? _hLen : 1) : (d.th || 1))));
        var _hTw = (d.id === 'platform_hang') ? _hLen
          : ((d.id === 'block_fall' || d.id === 'block_fall_d') ? ((d.ori === 'h') ? _hLen : 1)
          : (d.tw || 1));
        var col = Math.min(hover.col, Math.max(0, state.cols - _hTw));
        var row = Math.min(Math.max(hover.row, -EXTRA_TOP_ROWS), ROWS - _hTh);
        col = Math.max(col, 0);
        // 构造临时元素用于 drawElement + footprintOf
        var _pe = { id: d.id, col: col, row: row, len: d.len, length: d.length, dir: d.dir, rot: d.rot, ori: d.ori, count: d.count, w: d.w, h: d.h, drop: d.drop, warp: d.warp };
        drawElement(_pe, 0.55);
        var fp = fpRect(footprintOf(_pe));
        ctx.strokeStyle = 'rgba(20,80,255,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(fp.x + 1, fp.y + 1, fp.w - 2, fp.h - 2);
      }
    } else if (hover && tool === 'eraser') {
      ctx.strokeStyle = 'rgba(255,40,40,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(hover.col * TILE + 1, (hover.row + EXTRA_TOP_ROWS) * TILE + 1, TILE - 2, TILE - 2);
    }

    // 选中高亮框
    if (selected) {
      var sfp = fpRect(footprintOf(selected));
      ctx.save();
      ctx.strokeStyle = '#ff7a00';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(sfp.x + 1, sfp.y + 1, sfp.w - 2, sfp.h - 2);
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
    updateWarpSel();   // 同步“传送目标”下拉的显隐与取值（幂等）
    updateNextLevelSel();   // 同步“通关后”下拉取值
    updatePropBtn();   // 同步“属性”按钮显隐（选中元素时显示）
  }

  // ---------- 传送管道口：目标选择下拉 ----------
  var warpSel = document.getElementById('warpSel');
  var warpLabel = document.getElementById('warpLabel');
  var warpSep = document.getElementById('warpSep');
  var _warpSelBuilt = false;
  function buildWarpSel() {
    if (_warpSelBuilt) return;
    _warpSelBuilt = true;
    var html = '<option value="__end__">🚩 游戏结束（通关）</option>';
    (window.STAGES || []).forEach(function (s) {
      html += '<option value="' + s.id + '">🌍 ' + s.id + ' ' + s.name + '</option>';
    });
    warpSel.innerHTML = html;
  }
  function updateWarpSel() {
    if (!warpSel) return;
    buildWarpSel();
    var on = selected && CAT.byId(selected.id) && CAT.byId(selected.id).warpable;
    warpSel.style.display = on ? '' : 'none';
    warpLabel.style.display = on ? '' : 'none';
    warpSep.style.display = on ? '' : 'none';
    if (on) {
      var w = selected.warp || (selected.warp = { end: false, id: (window.STAGES && window.STAGES[0]) ? window.STAGES[0].id : '1-1' });
      var val = w.end ? '__end__' : (w.id || '__end__');
      if (warpSel.value !== val) {
        // 若目标世界已不在列表（数据缺失），回退到游戏结束
        var exists = false;
        for (var i = 0; i < warpSel.options.length; i++) if (warpSel.options[i].value === val) { exists = true; break; }
        warpSel.value = exists ? val : '__end__';
      }
    }
  }
  warpSel.addEventListener('change', function () {
    if (!selected || !CAT.byId(selected.id).warpable) return;
    pushHistory();
    var v = warpSel.value;
    selected.warp = (v === '__end__') ? { end: true, id: null } : { end: false, id: v };
    persist();
    hintEl.textContent = '传送管道口目标已设为：' + (v === '__end__' ? '游戏结束（通关）' : '世界 ' + v);
  });

  // ---------- 下一关配置 ----------
  var nextLevelSel = document.getElementById('nextLevelSel');
  var _nextLevelBuilt = false;
  function buildNextLevelSel() {
    if (_nextLevelBuilt) return;
    _nextLevelBuilt = true;
    var html = '<option value="__next__">▶ 进入下一关（默认）</option>';
    html += '<option value="__end__">🏁 游戏结束</option>';
    (window.STAGES || []).forEach(function (s) {
      html += '<option value="' + s.id + '">🌍 ' + s.id + ' ' + s.name + '</option>';
    });
    nextLevelSel.innerHTML = html;
  }
  function updateNextLevelSel() {
    if (!nextLevelSel) return;
    buildNextLevelSel();
    var nl = state.nextLevel || { end: false, id: null };
    var val = nl.end ? '__end__' : (nl.id || '__next__');
    var exists = false;
    for (var i = 0; i < nextLevelSel.options.length; i++) if (nextLevelSel.options[i].value === val) { exists = true; break; }
    nextLevelSel.value = exists ? val : '__next__';
  }
  nextLevelSel.addEventListener('change', function () {
    pushHistory();
    var v = nextLevelSel.value;
    state.nextLevel = (v === '__end__') ? { end: true, id: null }
      : (v === '__next__') ? { end: false, id: null }
      : { end: false, id: v };
    persist();
    hintEl.textContent = '通关后去向已设为：' + (v === '__end__' ? '游戏结束' : v === '__next__' ? '进入下一关' : '世界 ' + v);
  });

  // ---------- 元素属性弹窗 ----------
  var propBtn = document.getElementById('propBtn');
  var propModal = document.getElementById('propModal');
  var propTitle = document.getElementById('propTitle');
  var propBody = document.getElementById('propBody');
  function updatePropBtn() {
    if (!propBtn) return;
    propBtn.style.display = selected ? '' : 'none';
  }
  function propRow(labelText, inner, note) {
    var row = document.createElement('div');
    row.className = 'prop-row';
    var lb = document.createElement('label');
    lb.textContent = labelText;
    row.appendChild(lb);
    row.appendChild(inner);
    if (note) {
      var nt = document.createElement('span');
      nt.className = 'prop-note';
      nt.textContent = note;
      row.appendChild(nt);
    }
    return row;
  }
  function numInput(min, max, val) {
    var inp = document.createElement('input');
    inp.type = 'number'; inp.min = min; inp.max = max; inp.value = val;
    return inp;
  }
  function openPropModal() {
    if (!selected) return;
    var d = CAT.byId(selected.id);
    if (!d) return;
    propTitle.textContent = '⚙ 元素属性 — ' + (d.name || selected.id);
    propBody.innerHTML = '';

    // 通用：位置（行允许 -EXTRA_TOP_ROWS 到 ROWS-1，覆盖超界元素）
    var colInp = numInput(0, state.cols - 1, selected.col);
    var rowInp = numInput(-EXTRA_TOP_ROWS, ROWS - 1, selected.row);
    var posRow = document.createElement('div');
    posRow.className = 'prop-row';
    var plb = document.createElement('label');
    plb.textContent = '位置（列,行）';
    posRow.appendChild(plb);
    posRow.appendChild(colInp);
    posRow.appendChild(rowInp);
    propBody.appendChild(posRow);

    var fTotal = null, fRot = null, fLen = null, fWarp = null;
    var fFallOri = null, fFallCount = null, fFallDir = null, fFallDelay = null, fFallChain = null;
    if (d.id === 'firebar') {
      // 火焰棒：长度（火球总数，含圆心）+ 初始角度（顺时针，0=向右）
      fTotal = numInput(1, 21, (selected.xt || d.xt || 5) + 1);
      propBody.appendChild(propRow('火球总数', fTotal, '含圆心，圆心即旋转原点'));
      fRot = numInput(0, 359, ((selected.rot || 0) % 360 + 360) % 360);
      propBody.appendChild(propRow('初始角度', fRot, '度，顺时针，0=向右'));
    }
    if (d.id === 'block_fall' || d.id === 'block_fall_d') {
      // 坠落砖组：排列（横/竖）、砖块数（2-12）、移动方向（横排=上/下，竖排=左/右）、延时（秒）
      var fi0 = fallInfo(selected);
      fFallOri = document.createElement('select');
      [['h', '横排（左右连排）'], ['v', '竖排（上下连排）']].forEach(function (op) {
        var o = document.createElement('option');
        o.value = op[0]; o.textContent = op[1];
        fFallOri.appendChild(o);
      });
      fFallOri.value = fi0.ori;
      propBody.appendChild(propRow('排列', fFallOri));

      fFallCount = numInput(2, 12, fi0.count);
      propBody.appendChild(propRow('砖块数', fFallCount, '2-12 格'));

      fFallDir = document.createElement('select');
      function refillDir(ori, cur) {
        fFallDir.innerHTML = '';
        var opts = ori === 'h'
          ? [['down', '↓ 向下坠落（玩家在下方）'], ['up', '↑ 向上顶起（玩家在上方）']]
          : [['left', '← 向左平移（玩家在左侧）'], ['right', '→ 向右平移（玩家在右侧）']];
        opts.forEach(function (op) {
          var o = document.createElement('option');
          o.value = op[0]; o.textContent = op[1];
          fFallDir.appendChild(o);
        });
        if (cur) fFallDir.value = cur;
      }
      refillDir(fi0.ori, fi0.dir);
      fFallOri.addEventListener('change', function () {
        var old = fFallDir.value;
        refillDir(fFallOri.value, fFallOri.value === 'h'
          ? (old === 'up' || old === 'down' ? old : 'down')
          : (old === 'left' || old === 'right' ? old : 'left'));
      });
      propBody.appendChild(propRow('移动方向', fFallDir, '玩家完全进入后触发，运动中碰到即阵亡'));

      fFallDelay = numInput(0, 10, fi0.delay);
      fFallDelay.step = '0.5';
      propBody.appendChild(propRow('延时(秒)', fFallDelay, '触发后等待再坠落，0=立即；延时期间砖组可踩'));

      // 链式触发：本砖组被触发时联动触发目标砖组（目标按自身延时坠落）；默认无=靠近触发
      fFallChain = document.createElement('select');
      var _fcNone = document.createElement('option');
      _fcNone.value = '__none__'; _fcNone.textContent = '无（靠近触发）';
      fFallChain.appendChild(_fcNone);
      var _fcFound = false;
      state.elements.forEach(function (el) {
        if (el === selected || (el.id !== 'block_fall' && el.id !== 'block_fall_d')) return;
        var eld = CAT.byId(el.id);
        var o = document.createElement('option');
        o.value = el.uid || '';
        o.textContent = '#' + (el.uid || '?') + ' ' + (eld ? eld.name : el.id) + ' (' + el.col + ',' + el.row + ')';
        fFallChain.appendChild(o);
        if (el.uid && el.uid === fi0.chain) _fcFound = true;
      });
      if (fi0.chain) {
        // 悬空引用（目标已删除）：保留原值并标注，便于重新指定或清除
        if (!_fcFound) {
          var oDangle = document.createElement('option');
          oDangle.value = fi0.chain;
          oDangle.textContent = '(悬空) #' + fi0.chain;
          fFallChain.appendChild(oDangle);
        }
        fFallChain.value = fi0.chain;
      } else {
        fFallChain.value = '__none__';
      }
      propBody.appendChild(propRow('链式触发', fFallChain, d.id === 'block_fall_d'
        ? '监视目标砖组（旧引擎1-2-1连锁）：目标坠落到位(高度25000/48000)且玩家位置满足时本组崩塌，延时无效；未选=靠近触发'
        : '本组被触发（含被链式触发）时，联动触发所选砖组；多级链条依次传播'));
    }
    // 连接管：每端口长度编辑
    var fPortInputs = null, fPortIdxs = null, fCrot = null;
    if (d.id === 'pipe_cross' || d.id === 'pipe_tee' || d.id === 'pipe_L_a' || d.id === 'pipe_L_b') {
      var _DIR_BASE_IDX = { up: 0, down: 1, left: 2, right: 3 };
      var _defLen2 = d.lengths || [1, 1, 1, 1];
      var _eLen2 = selected.lengths || _defLen2.slice();
      var _portLens2 = [1, 1, 1, 1];
      if (d.id === 'pipe_cross' || d.id === 'pipe_tee') {
        for (var _kk = 0; _kk < 4; _kk++) _portLens2[_kk] = Math.max(1, Math.min(4, _eLen2[_kk] | 0 || _defLen2[_kk] || 1));
      } else if (d.id === 'pipe_L_a') {
        _portLens2[0] = Math.max(1, Math.min(4, _eLen2[0] | 0 || _defLen2[0] || 1));
        _portLens2[3] = Math.max(1, Math.min(4, _eLen2[1] | 0 || _defLen2[1] || 1));
      } else if (d.id === 'pipe_L_b') {
        _portLens2[0] = Math.max(1, Math.min(4, _eLen2[0] | 0 || _defLen2[0] || 1));
        _portLens2[2] = Math.max(1, Math.min(4, _eLen2[1] | 0 || _defLen2[1] || 1));
      }
      var _rot0 = (((selected.rot | 0) || 0) % 360 + 360) % 360;
      var _dirs0;
      if (d.id === 'pipe_cross') _dirs0 = ['up', 'down', 'left', 'right'];
      else if (d.id === 'pipe_tee') {
        var _miss0 = ({ 0: 'down', 90: 'left', 180: 'up', 270: 'right' })[_rot0] || 'down';
        _dirs0 = ['up', 'down', 'left', 'right'].filter(function (dd) { return dd !== _miss0; });
      } else if (d.id === 'pipe_L_a') {
        _dirs0 = ({ 0: ['up', 'right'], 90: ['right', 'down'], 180: ['down', 'left'], 270: ['left', 'up'] })[_rot0] || ['up', 'right'];
      } else {
        _dirs0 = ({ 0: ['up', 'left'], 90: ['up', 'right'], 180: ['right', 'down'], 270: ['down', 'left'] })[_rot0] || ['up', 'left'];
      }
      fPortInputs = {};
      fPortIdxs = [];
      // 旋转（cross 不旋转）
      if (d.id !== 'pipe_cross') {
        fCrot = numInput(0, 359, _rot0);
        propBody.appendChild(propRow('旋转', fCrot, '度，顺时针'));
      }
      _dirs0.forEach(function (dd, _i0) {
        var _baseIdx = _DIR_BASE_IDX[dd];
        var _dirLabel = ({ up: '↑ 上', down: '↓ 下', left: '← 左', right: '→ 右' })[dd];
        var _ip = numInput(1, 4, _portLens2[_baseIdx]);
        propBody.appendChild(propRow('端口 ' + (_i0 + 1) + ' (' + _dirLabel + ') 长度', _ip, '格（范围1-4）'));
        fPortInputs['port_' + _baseIdx] = _ip;
        fPortIdxs.push(_baseIdx);
      });
    }
    // 管道口：管身长度 + 进入事件 + 开口方向
    var fPmLen = null, fPmEntry = null, fPmDir = null;
    if (d.id === 'pipe_mouth') {
      fPmLen = numInput(1, 20, Math.max(1, selected.length | 0 || d.length || 1));
      propBody.appendChild(propRow('管身长度', fPmLen, '格'));
      fPmEntry = document.createElement('select');
      [['none', '普通管道（可从管口进入）'], ['trap', '陷阱管道（进入即阵亡）'], ['warp', '传送管道（进入即传送到目标）']].forEach(function (op) {
        var opt = document.createElement('option'); opt.value = op[0]; opt.textContent = op[1];
        if ((selected.entry || d.entry || 'none') === op[0]) opt.selected = true;
        fPmEntry.appendChild(opt);
      });
      propBody.appendChild(propRow('进入事件', fPmEntry, '玩家从管口按↓进入时触发'));
      fPmDir = document.createElement('select');
      [['up', '↑ 向上（管口朝上）'], ['down', '↓ 向下'], ['left', '← 向左'], ['right', '→ 向右']].forEach(function (op) {
        var opt2 = document.createElement('option'); opt2.value = op[0]; opt2.textContent = op[1];
        if ((selected.dir || d.dir || 'up') === op[0]) opt2.selected = true;
        fPmDir.appendChild(opt2);
      });
      propBody.appendChild(propRow('开口方向', fPmDir, '决定管口朝向和管身延伸方向'));
    }
    // 陷阱触发区：stype + sxtype
    var fTzStype = null, fTzSxtype = null;
    if (d.id === '_trapzone') {
      var tz0 = selected.trap || {};
      fTzStype = document.createElement('select');
      [['100', '100：猫脸怪（地面生成白幽灵）'], ['101', '101：天降白幽灵'],
        ['102', '102：按 sxtype 天降敌人'], ['103', '103：激光炮'], ['104', '104：光束']].forEach(function (op) {
        var o = document.createElement('option'); o.value = op[0]; o.textContent = op[1];
        if (String(tz0.stype || d.trapStype || 101) === op[0]) o.selected = true;
        fTzStype.appendChild(o);
      });
      propBody.appendChild(propRow('触发类型', fTzStype, '玩家进入 AABB 区域时触发'));
      fTzSxtype = numInput(0, 999, tz0.sxtype != null ? tz0.sxtype : (d.trapSxtype || 0));
      propBody.appendChild(propRow('子类型 sxtype', fTzSxtype, '102 用：0=4白猫/9=3幽灵天降/10=转101 等'));
    }
    if (d.id.indexOf('lift_') === 0) {
      fLen = numInput(1, 50, liftLen(selected));
      propBody.appendChild(propRow('平台长度', fLen, '格'));
    }
    var fPlatW = null, fPlatH = null, fPlatDrop = null;
    if (d.id === 'platform_hang') {
      var pi0 = platInfo(selected);
      fPlatW = numInput(1, 50, pi0.w);
      propBody.appendChild(propRow('站台宽度', fPlatW, '格（绿色台面）'));
      fPlatH = numInput(1, 30, pi0.h);
      propBody.appendChild(propRow('吊柱高度', fPlatH, '格，纯视觉不参与碰撞（原版约16格）'));
      fPlatDrop = document.createElement('select');
      [['no', '否：固定站台（不会下降）'], ['yes', '是：玩家站上即加速下坠']].forEach(function (op) {
        var po = document.createElement('option');
        po.value = op[0]; po.textContent = op[1];
        fPlatDrop.appendChild(po);
      });
      fPlatDrop.value = pi0.drop ? 'yes' : 'no';
      propBody.appendChild(propRow('可下降', fPlatDrop, '下坠时会带着站在台上的玩家一起掉落'));
    }
    if (d.warpable) {
      fWarp = document.createElement('select');
      var optEnd = document.createElement('option');
      optEnd.value = '__end__'; optEnd.textContent = '🚩 游戏结束（通关）';
      fWarp.appendChild(optEnd);
      (window.STAGES || []).forEach(function (s) {
        var op = document.createElement('option');
        op.value = s.id; op.textContent = '🌍 ' + s.id + ' ' + s.name;
        fWarp.appendChild(op);
      });
      var wv = selected.warp && !selected.warp.end ? (selected.warp.id || '__end__') : '__end__';
      for (var oi = 0; oi < fWarp.options.length; oi++) {
        if (fWarp.options[oi].value === wv) { fWarp.value = wv; break; }
      }
      propBody.appendChild(propRow('传送目标', fWarp, '进入管道后前往'));
    }
    // 问号块/隐藏块：弹出对象（两者取并集）+ 是否量产（默认金币/否）
    var fQPop = null, fQMass = null;
    if (d.id === 'block_question' || d.id === 'block_hidden') {
      var qPopOpts = [['coin', '金币（默认）'], ['mushroom', '红蘑菇'], ['poison', '毒蘑菇'],
        ['enemy', '白猫怪（敌人）'], ['flower', '火焰花'], ['badstar', '坏星星'], ['pswitch', 'P开关']];
      fQPop = document.createElement('select');
      qPopOpts.forEach(function (op) {
        var o = document.createElement('option');
        o.value = op[0]; o.textContent = op[1];
        if ((selected.pop || d.pop || 'coin') === op[0]) o.selected = true;
        fQPop.appendChild(o);
      });
      propBody.appendChild(propRow('弹出对象', fQPop, '从下方顶到方块时弹出的内容'));
      fQMass = document.createElement('select');
      [['no', '否：只弹出一次（默认）'], ['yes', '是：量产（连续弹出）']].forEach(function (op) {
        var o = document.createElement('option');
        o.value = op[0]; o.textContent = op[1];
        fQMass.appendChild(o);
      });
      fQMass.value = (selected.mass || d.mass) ? 'yes' : 'no';
      propBody.appendChild(propRow('是否量产', fQMass, '金币连出20枚、其余每约16帧弹一个；P开关无量产'));
    }
    // 提示块：消息类型选择 + 自定义文本
    var fHintType = null, fHintText = null;
    if (d.id === 'b2_hint') {
      fHintType = document.createElement('select');
      var hintOpts = [
        ['1', '1：第一关祝贺'], ['2', '2：需要？道具'], ['3', '3：金币无用'],
        ['4', '4：前方隐藏方块'], ['5', '5：难度降低'], ['6', '6：敌人会跳'],
        ['7', '7：跳到敌人带了吗'], ['8', '8：别走捷径'], ['9', '9：最终关'],
        ['100', '100：路过的提示框'], ['__custom__', '自定义文本…']
      ];
      hintOpts.forEach(function (op) {
        var o = document.createElement('option');
        o.value = op[0]; o.textContent = op[1];
        fHintType.appendChild(o);
      });
      var curHt = selected.hintType || (selected.hintCustom ? '__custom__' : '1');
      fHintType.value = curHt;
      propBody.appendChild(propRow('消息类型', fHintType, '选择预设消息或自定义文本'));

      fHintText = document.createElement('textarea');
      fHintText.rows = 4;
      fHintText.style.cssText = 'width:100%;font-size:12px;background:#1a1e28;color:#d8dee9;border:1px solid #454d61;border-radius:4px;padding:4px';
      fHintText.value = (selected.hintCustom || '').replace(/\n/g, '\n');
      fHintText.placeholder = '每行一条消息，最多5行';
      propBody.appendChild(propRow('自定义文本', fHintText, '仅当消息类型=自定义时生效'));
    }

    propModal.classList.add('show');
    propOk.onclick = function () {
      pushHistory();
      var c = parseInt(colInp.value, 10), r = parseInt(rowInp.value, 10);
      if (isFinite(c)) selected.col = Math.max(0, Math.min(state.cols - 1, c));
      if (isFinite(r)) selected.row = Math.max(-EXTRA_TOP_ROWS, Math.min(ROWS - 1, r));
      if (fTotal) selected.xt = Math.max(1, Math.min(20, (parseInt(fTotal.value, 10) || 6) - 1));
      if (fRot) selected.rot = ((parseInt(fRot.value, 10) || 0) % 360 + 360) % 360;
      if (fLen) selected.len = Math.max(1, Math.min(50, parseInt(fLen.value, 10) || 3));
      if (fPlatW) {
        var nW = Math.max(1, Math.min(50, parseInt(fPlatW.value, 10) || 5));
        var nH = Math.max(1, Math.min(30, parseInt(fPlatH.value, 10) || 16));
        selected.w = nW; selected.h = nH; selected.drop = fPlatDrop.value === 'yes';
        selected.col = Math.min(selected.col, state.cols - nW);
      }
      if (fFallOri) {
        var nOri = fFallOri.value === 'v' ? 'v' : 'h';
        var nCnt = Math.max(2, Math.min(12, parseInt(fFallCount.value, 10) || 3));
        var nDir = fFallDir.value;
        var dirOk = nOri === 'h' ? (nDir === 'up' || nDir === 'down')
                                  : (nDir === 'left' || nDir === 'right');
        if (!dirOk) nDir = nOri === 'h' ? 'down' : 'left';
        selected.ori = nOri; selected.count = nCnt; selected.dir = nDir;
        // 超界钳制（横排不超右界，竖排不超底界）
        if (nOri === 'h') selected.col = Math.min(selected.col, state.cols - nCnt);
        else selected.row = Math.min(selected.row, ROWS - nCnt);
        if (fFallDelay) {
          var nDelay = parseFloat(fFallDelay.value);
          if (!isFinite(nDelay) || nDelay < 0) nDelay = 0;
          if (nDelay > 10) nDelay = 10;
          selected.delay = Math.round(nDelay * 2) / 2;   // 0.5 秒步进
        }
        if (fFallChain) {
          var nChain = (fFallChain.value === '__none__' || !fFallChain.value) ? '' : fFallChain.value;
          if (nChain) selected.chain = nChain;
          else delete selected.chain;   // 空引用不落盘
        }
      }
      if (fWarp) selected.warp = (fWarp.value === '__end__')
        ? { end: true, id: null } : { end: false, id: fWarp.value };
      if (fHintType) {
        if (fHintType.value === '__custom__') {
          selected.hintType = '__custom__';
          selected.hintCustom = fHintText.value;
        } else {
          selected.hintType = fHintType.value;
          selected.hintCustom = null;
        }
      }
      if (fQPop) {
        selected.pop = fQPop.value;
        selected.mass = fQMass.value === 'yes';
      }
      // 连接管保存：per-port lengths + rot
      if (fPortInputs) {
        if (fCrot) selected.rot = ((parseInt(fCrot.value, 10) || 0) % 360 + 360) % 360;
        // cross/tee 存 4 槽，L_a/L_b 存 2 槽（基础方向 up+right / up+left）
        if (d.id === 'pipe_cross' || d.id === 'pipe_tee') {
          var _newLens4 = [1, 1, 1, 1];
          for (var _si = 0; _si < 4; _si++) {
            var _inp = fPortInputs['port_' + _si];
            _newLens4[_si] = _inp ? Math.max(1, Math.min(4, parseInt(_inp.value, 10) || 1)) : 1;
          }
          selected.lengths = _newLens4;
        } else if (d.id === 'pipe_L_a') {
          selected.lengths = [
            fPortInputs['port_0'] ? Math.max(1, Math.min(4, parseInt(fPortInputs['port_0'].value, 10) || 1)) : 1,
            fPortInputs['port_3'] ? Math.max(1, Math.min(4, parseInt(fPortInputs['port_3'].value, 10) || 1)) : 1
          ];
        } else if (d.id === 'pipe_L_b') {
          selected.lengths = [
            fPortInputs['port_0'] ? Math.max(1, Math.min(4, parseInt(fPortInputs['port_0'].value, 10) || 1)) : 1,
            fPortInputs['port_2'] ? Math.max(1, Math.min(4, parseInt(fPortInputs['port_2'].value, 10) || 1)) : 1
          ];
        }
      }
      // 管道口保存
      if (fPmLen) selected.length = Math.max(1, Math.min(20, parseInt(fPmLen.value, 10) || 1));
      if (fPmEntry) {
        var newEntry = fPmEntry.value;
        selected.entry = newEntry;
        if (newEntry === 'warp') {
          // 传送：确保有 warp 对象
          if (!selected.warp) selected.warp = { end: false, id: (window.STAGES && window.STAGES[0]) ? window.STAGES[0].id : '1-1' };
        } else {
          // 非传送：清掉 warp 避免 play.html 误传
          delete selected.warp;
        }
      }
      if (fPmDir) selected.dir = fPmDir.value;
      // 陷阱触发区保存：stype/sxtype + 同步 sa/sb 到新坐标
      if (fTzStype) {
        if (!selected.trap) selected.trap = { sa: selected.col * 2900, sb: (selected.row * 29 - 12) * 100, sc: d.trapW || 7000, sd: d.trapH || 70000 };
        selected.trap.stype = Math.max(100, Math.min(104, parseInt(fTzStype.value, 10) || 101));
        selected.trap.sxtype = Math.max(0, parseInt(fTzSxtype.value, 10) || 0);
        selected.trap.sa = selected.col * 2900;
        selected.trap.sb = (selected.row * 29 - 12) * 100;
      }
      persist();
      requestRender();
      closePropModal();
      hintEl.textContent = '已更新属性：' + (d.name || selected.id);
    };
  }
  function closePropModal() { propModal.classList.remove('show'); }
  var propOk = document.getElementById('propOk');
  if (propBtn) {
    propBtn.addEventListener('click', openPropModal);
    document.getElementById('propClose').addEventListener('click', closePropModal);
    document.getElementById('propCancel').addEventListener('click', closePropModal);
    propModal.addEventListener('click', function (ev) {
      if (ev.target === propModal) closePropModal();   // 点遮罩关闭
    });
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
    var totalH = (ROWS + EXTRA_TOP_ROWS) * TILE;
    gutter.width = 34;
    gutter.height = totalH;
    gctx.fillStyle = '#2b2f38';
    gctx.fillRect(0, 0, 34, totalH);
    gctx.fillStyle = '#aab2c5';
    gctx.font = '10px monospace';
    gctx.textAlign = 'center'; gctx.textBaseline = 'middle';
    // 超界区（负数行号）
    gctx.fillStyle = '#ffcc50';
    for (var r = -EXTRA_TOP_ROWS; r < 0; r++) {
      gctx.strokeStyle = '#6a5a30';
      gctx.beginPath();
      gctx.moveTo(28, (r + EXTRA_TOP_ROWS) * TILE + 0.5);
      gctx.lineTo(34, (r + EXTRA_TOP_ROWS) * TILE + 0.5);
      gctx.stroke();
      gctx.fillText(String(r), 14, (r + EXTRA_TOP_ROWS) * TILE + 14);
    }
    // 正常区
    gctx.fillStyle = '#aab2c5';
    for (var r = 0; r < ROWS; r++) {
      gctx.strokeStyle = '#3c4250';
      gctx.beginPath();
      gctx.moveTo(28, (r + EXTRA_TOP_ROWS) * TILE + 0.5);
      gctx.lineTo(34, (r + EXTRA_TOP_ROWS) * TILE + 0.5);
      gctx.stroke();
      gctx.fillText(String(r), 14, (r + EXTRA_TOP_ROWS) * TILE + 14);
    }
  }

  // ---------- vector 元素缩略图（用于 sidebar palette）----------
  function drawVectorThumb(d) {
    var size = 80;
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#d8d8d8'; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1;
    // 小网格背景（32px）
    for (var gx = 0; gx < size; gx += 8) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, gx); ctx.lineTo(size, gx); ctx.stroke();
    }

    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.fillStyle = '#00e600';

    if (d.id === 'pipe_mouth') {
      // dir=up 默认：管口在上（strokeRect 完整），管身向下（两侧线去下帽）
      var _tw = 24;
      var _th = 12;
      var _bodyH = _th * 2;
      var _bx = (size - _tw) / 2;
      var _by = (size - _th - _bodyH) / 2;
      var _bw = Math.round(_tw * 50 / 58);
      // 管口（完整 strokeRect）
      ctx.fillRect(_bx, _by, _tw, _th);
      ctx.strokeRect(_bx, _by, _tw, _th);
      // 管身（fillRect + 两侧线，去下帽）
      var _bX = _bx + Math.round((_tw - _bw) / 2);
      ctx.fillRect(_bX, _by + _th, _bw, _bodyH);
      ctx.beginPath();
      ctx.moveTo(_bX, _by + _th); ctx.lineTo(_bX, _by + _th + _bodyH);
      ctx.moveTo(_bX + _bw, _by + _th); ctx.lineTo(_bX + _bw, _by + _th + _bodyH);
      ctx.stroke();
    } else {
      // connector：中心块 2×2 tile，默认各臂 length=1
      var tSize = 12;  // 缩略图里每 tile 12px
      var cx = size / 2 - tSize;  // 中心块左上角
      var cy = size / 2 - tSize;
      var armPx = tSize;          // armLen=1 的臂长度
      var armW = Math.round(50 / 58 * tSize * 2);  // 臂宽按 50/58 比例
      var armH = armW;
      var armX, armY;

      // 决定哪些臂画
      var hasUp = true, hasDown = true, hasLeft = true, hasRight = true;
      if (d.id === 'pipe_tee') hasDown = false;  // 默认 rot=0 缺下
      if (d.id === 'pipe_L_a') { hasDown = false; hasLeft = false; }  // up+right
      if (d.id === 'pipe_L_b') { hasDown = false; hasRight = false; } // up+left

      // 先全部 fill
      ctx.fillRect(cx, cy, 2 * tSize, 2 * tSize);  // 中心块
      if (hasUp) {
        armX = cx + tSize - armH / 2;
        armY = cy - armPx;
        ctx.fillRect(armX, armY, armH, armPx);
      }
      if (hasDown) {
        armX = cx + tSize - armH / 2;
        armY = cy + 2 * tSize;
        ctx.fillRect(armX, armY, armH, armPx);
      }
      if (hasLeft) {
        armX = cx - armPx;
        armY = cy + tSize - armW / 2;
        ctx.fillRect(armX, armY, armPx, armW);
      }
      if (hasRight) {
        armX = cx + 2 * tSize;
        armY = cy + tSize - armW / 2;
        ctx.fillRect(armX, armY, armPx, armW);
      }

      // 再精准 stroke（stub + 3-side）
      // 中心块 4 条边的 stub
      var hStubL = Math.round(tSize - armW / 2);
      var hStubR = Math.round(tSize + armW / 2);
      var vStubT = Math.round(tSize - armH / 2);
      var vStubB = Math.round(tSize + armH / 2);
      // 上边
      ctx.beginPath();
      if (hasUp) {
        ctx.moveTo(cx, cy); ctx.lineTo(cx + hStubL, cy);
        ctx.moveTo(cx + hStubR, cy); ctx.lineTo(cx + 2 * tSize, cy);
      } else { ctx.moveTo(cx, cy); ctx.lineTo(cx + 2 * tSize, cy); }
      ctx.stroke();
      // 下边
      ctx.beginPath();
      if (hasDown) {
        ctx.moveTo(cx, cy + 2 * tSize); ctx.lineTo(cx + hStubL, cy + 2 * tSize);
        ctx.moveTo(cx + hStubR, cy + 2 * tSize); ctx.lineTo(cx + 2 * tSize, cy + 2 * tSize);
      } else { ctx.moveTo(cx, cy + 2 * tSize); ctx.lineTo(cx + 2 * tSize, cy + 2 * tSize); }
      ctx.stroke();
      // 左边
      ctx.beginPath();
      if (hasLeft) {
        ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + vStubT);
        ctx.moveTo(cx, cy + vStubB); ctx.lineTo(cx, cy + 2 * tSize);
      } else { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + 2 * tSize); }
      ctx.stroke();
      // 右边
      ctx.beginPath();
      if (hasRight) {
        ctx.moveTo(cx + 2 * tSize, cy); ctx.lineTo(cx + 2 * tSize, cy + vStubT);
        ctx.moveTo(cx + 2 * tSize, cy + vStubB); ctx.lineTo(cx + 2 * tSize, cy + 2 * tSize);
      } else { ctx.moveTo(cx + 2 * tSize, cy); ctx.lineTo(cx + 2 * tSize, cy + 2 * tSize); }
      ctx.stroke();

      // 每臂 2 侧（去远端帽，端口开口）
      ctx.beginPath();
      if (hasUp) {
        ctx.moveTo(armX, cy); ctx.lineTo(armX, armY);
        ctx.moveTo(armX + armH, cy); ctx.lineTo(armX + armH, armY);
      }
      if (hasDown) {
        ctx.moveTo(armX, cy + 2 * tSize); ctx.lineTo(armX, armY + armPx);
        ctx.moveTo(armX + armH, cy + 2 * tSize); ctx.lineTo(armX + armH, armY + armPx);
      }
      if (hasLeft) {
        ctx.moveTo(cx, armY); ctx.lineTo(armX, armY);
        ctx.moveTo(cx, armY + armW); ctx.lineTo(armX, armY + armW);
      }
      if (hasRight) {
        ctx.moveTo(cx + 2 * tSize, armY); ctx.lineTo(armX + armPx, armY);
        ctx.moveTo(cx + 2 * tSize, armY + armW); ctx.lineTo(armX + armPx, armY + armW);
      }
      ctx.stroke();
    }

    return c.toDataURL();
  }

  // ---------- 左侧面板（TAB：元素 / 音乐） ----------
  function buildPalette() {
    // TAB 栏
    var tabs = document.createElement('div');
    tabs.id = 'palTabs';
    [['el', '🧱 元素'], ['music', '🎵 音乐']].forEach(function (t, i) {
      var b = document.createElement('button');
      b.className = 'pal-tab' + (i === 0 ? ' active' : '');
      b.dataset.tab = t[0];
      b.textContent = t[1];
      b.addEventListener('click', function () { switchPalTab(t[0]); });
      tabs.appendChild(b);
    });
    paletteEl.appendChild(tabs);

    // 元素面板（BGM 属关卡级设置，不在此列出）
    var elPane = document.createElement('div');
    elPane.className = 'pal-pane show';
    elPane.id = 'palPaneEl';
    var order = ['struct', 'block', 'item', 'enemy', 'bg'];
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
        if (d.internal) return;  // 内部元素（原版 grid 转换用）不显示在 palette
        var b = document.createElement('div');
        b.className = 'pal-item';
        b.dataset.id = d.id;

        var thumb = document.createElement('div');
        thumb.className = 'pal-thumb';
        var im = document.createElement('img');
        im.alt = d.name;
        // 高清重绘资源（>=64px）走浏览器平滑缩放，原版像素小图保持 pixelated 锐利
        im.addEventListener('load', function () {
          if (im.naturalWidth >= 64 || im.naturalHeight >= 64) im.classList.add('pal-hd');
        });
        if (d.dataUrl) im.src = d.dataUrl;
        else im.src = ASSETS + 'sprites/' + d.img;
        thumb.appendChild(im);
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
        b.title = d.hint + (tag.length ? '\n原生ID：' + tag.join(' / ') : '');

        b.addEventListener('click', function () { selectTool(d.id); });
        grid.appendChild(b);
      });

      // 自定义元素上传入口
      var addBtn = document.createElement('div');
      addBtn.className = 'pal-item pal-add';
      addBtn.title = '上传图片添加自定义' + CAT.CATS[cat] + '元素';
      addBtn.innerHTML = '<div class="pal-thumb pal-add-thumb">＋</div>' +
        '<div class="pal-label">添加自定义</div>';
      addBtn.addEventListener('click', function () { openCustomElementUploader(cat, grid); });
      grid.appendChild(addBtn);

      sec.appendChild(grid);
      elPane.appendChild(sec);
    });
    paletteEl.appendChild(elPane);

    // 音乐面板
    var muPane = document.createElement('div');
    muPane.className = 'pal-pane';
    muPane.id = 'palPaneMusic';
    buildMusicPane(muPane);
    paletteEl.appendChild(muPane);
  }

  function switchPalTab(name) {
    document.querySelectorAll('.pal-tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    document.getElementById('palPaneEl').classList.toggle('show', name === 'el');
    document.getElementById('palPaneMusic').classList.toggle('show', name === 'music');
    if (name !== 'music') stopBgm();   // 离开音乐页停止 BGM 试听
  }

  // ---------- 自定义元素上传 ----------
  var customImgInput = document.createElement('input');
  customImgInput.type = 'file';
  customImgInput.accept = 'image/*';
  customImgInput.style.display = 'none';
  document.body.appendChild(customImgInput);

  var _pendingCustomCat = null;
  var _pendingCustomGrid = null;
  var _pendingDataUrl = null;
  var _pendingImgName = null;

  function openCustomElementUploader(cat, gridEl) {
    _pendingCustomCat = cat;
    _pendingCustomGrid = gridEl;
    customImgInput.click();
  }

  customImgInput.addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    _pendingImgName = f.name.replace(/\.[^.]+$/, '');
    var reader = new FileReader();
    reader.onload = function () {
      _pendingDataUrl = reader.result;
      openCustomPropModal();
    };
    reader.readAsDataURL(f);
    ev.target.value = '';
  });

  // 自定义元素属性弹窗（复用 propModal 结构）
  function openCustomPropModal() {
    var modal = document.getElementById('propModal');
    var title = document.getElementById('propTitle');
    var body = document.getElementById('propBody');
    title.textContent = '⚙ 自定义元素属性';
    body.innerHTML = '';

    // 预览图
    var previewWrap = document.createElement('div');
    previewWrap.style.textAlign = 'center';
    previewWrap.style.marginBottom = '12px';
    var prevImg = document.createElement('img');
    prevImg.src = _pendingDataUrl;
    prevImg.style.maxWidth = '120px';
    prevImg.style.maxHeight = '80px';
    prevImg.style.border = '1px solid #454d61';
    previewWrap.appendChild(prevImg);
    body.appendChild(previewWrap);

    // 名称
    var nameRow = document.createElement('div');
    nameRow.className = 'prop-row';
    nameRow.innerHTML = '<label>名称</label>';
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = _pendingImgName || '自定义';
    nameInput.style.width = '200px';
    nameRow.appendChild(nameInput);
    body.appendChild(nameRow);

    // 类别
    var catRow = document.createElement('div');
    catRow.className = 'prop-row';
    catRow.innerHTML = '<label>类别</label>';
    var catSel = document.createElement('select');
    ['struct', 'block', 'item', 'enemy', 'bg'].forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c; opt.textContent = CAT.CATS[c];
      if (c === _pendingCustomCat) opt.selected = true;
      catSel.appendChild(opt);
    });
    catRow.appendChild(catSel);
    body.appendChild(catRow);

    // 横向格子数
    var twRow = document.createElement('div');
    twRow.className = 'prop-row';
    twRow.innerHTML = '<label>横向格子数</label>';
    var twInput = document.createElement('input');
    twInput.type = 'number';
    twInput.min = '1'; twInput.max = '20'; twInput.value = '1';
    twInput.style.width = '60px';
    twRow.appendChild(twInput);
    body.appendChild(twRow);

    // 纵向格子数
    var thRow = document.createElement('div');
    thRow.className = 'prop-row';
    thRow.innerHTML = '<label>纵向格子数</label>';
    var thInput = document.createElement('input');
    thInput.type = 'number';
    thInput.min = '1'; thInput.max = '20'; thInput.value = '1';
    thInput.style.width = '60px';
    thRow.appendChild(thInput);
    body.appendChild(thRow);

    // 碰撞类型
    var colRow = document.createElement('div');
    colRow.className = 'prop-row';
    colRow.innerHTML = '<label>碰撞类型</label>';
    var colSel = document.createElement('select');
    var colOpts = [
      { v: 'none', t: '无碰撞（背景装饰）' },
      { v: 'block', t: '实体方块（可踩可顶）' },
      { v: 'pipe', t: '管道型（实体碰撞）' },
      { v: 'trigger', t: '敌人触发器（触碰触发）' }
    ];
    colOpts.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.v; opt.textContent = o.t;
      if (_pendingCustomCat === 'bg') opt.disabled = (o.v !== 'none');
      colSel.appendChild(opt);
    });
    if (_pendingCustomCat === 'bg') colSel.value = 'none';
    colRow.appendChild(colSel);
    body.appendChild(colRow);

    // 类别改变时联动禁用碰撞选项
    catSel.addEventListener('change', function () {
      var isBg = catSel.value === 'bg';
      for (var i = 0; i < colSel.options.length; i++) {
        colSel.options[i].disabled = isBg && colSel.options[i].value !== 'none';
      }
      if (isBg) colSel.value = 'none';
    });

    modal.classList.add('show');

    // 覆盖确定按钮逻辑
    var okBtn = document.getElementById('propOk');
    var cancelBtn = document.getElementById('propCancel');
    var closeBtn = document.getElementById('propClose');
    var origOk = okBtn.onclick;
    var origCancel = cancelBtn.onclick;
    var origClose = closeBtn.onclick;

    okBtn.onclick = function () {
      var tw = Math.max(1, Math.min(20, parseInt(twInput.value) || 1));
      var th = Math.max(1, Math.min(20, parseInt(thInput.value) || 1));
      var cat = catSel.value;
      var collide = colSel.value;
      var customId = 'custom_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      var def = {
        id: customId,
        name: nameInput.value || '自定义',
        cat: cat,
        kind: 'sprite',
        dataUrl: _pendingDataUrl,
        tw: tw, th: th,
        custom: true,
        collide: collide,
        hint: '自定义元素（' + CAT.CATS[cat] + '，' + tw + '×' + th + '格，碰撞：' + collide + '）'
      };
      // 派生字段
      if (collide === 'block') def.ttype = 3;
      if (collide === 'pipe') def.stype = 700 + Math.floor(Math.random() * 1000);
      if (collide === 'trigger') def.btype = 200 + Math.floor(Math.random() * 1000);

      CAT.registerCustom(def);
      rebuildPalette();
      selectTool(customId);
      hintEl.textContent = '已添加自定义元素：' + def.name;

      modal.classList.remove('show');
      okBtn.onclick = origOk;
      cancelBtn.onclick = origCancel;
      closeBtn.onclick = origClose;
    };
    cancelBtn.onclick = function () {
      modal.classList.remove('show');
      okBtn.onclick = origOk;
      cancelBtn.onclick = origCancel;
      closeBtn.onclick = origClose;
    };
    closeBtn.onclick = cancelBtn.onclick;
  }

  function rebuildPalette() {
    paletteEl.innerHTML = '';
    buildPalette();
  }

  // 音乐面板：BGM 卡片（点击弹单选窗）+ 音效试听网格
  function buildMusicPane(pane) {
    // --- BGM 区 ---
    var sec = document.createElement('div');
    sec.className = 'pal-sec';
    var h = document.createElement('div');
    h.className = 'pal-h';
    h.textContent = CAT.CATS.audio;
    sec.appendChild(h);

    var card = document.createElement('div');
    card.className = 'bgm-card';
    card.id = 'bgmCard';
    card.title = '点击选择本关背景音乐（单选弹窗）';
    card.addEventListener('click', openBgmModal);
    sec.appendChild(card);
    pane.appendChild(sec);
    updateBgmCard();

    // --- 音效区 ---
    var sec2 = document.createElement('div');
    sec2.className = 'pal-sec';
    var h2 = document.createElement('div');
    h2.className = 'pal-h';
    h2.textContent = '🔊 音效试听（游戏内自动触发）';
    sec2.appendChild(h2);
    var grid = document.createElement('div');
    grid.className = 'pal-grid';
    SFX_LIST.forEach(function (s) {
      var b = document.createElement('div');
      b.className = 'pal-item';
      b.title = '试听：' + s.name + '（' + s.file + '，音效ID ' + s.id + '）';
      var thumb = document.createElement('div');
      thumb.className = 'pal-thumb sfx-thumb';
      var dot = document.createElement('div');
      dot.className = 'pal-dot';
      dot.style.background = '#607d8b';
      dot.textContent = '♪';
      thumb.appendChild(dot);
      b.appendChild(thumb);
      var lb = document.createElement('div');
      lb.className = 'pal-label';
      lb.textContent = s.name;
      b.appendChild(lb);
      b.addEventListener('click', function () { playSfx(s); });
      grid.appendChild(b);
    });

    // 自定义音效上传入口 + 已上传列表
    var addSfxBtn = document.createElement('div');
    addSfxBtn.className = 'pal-item pal-add';
    addSfxBtn.title = '上传 mp3 添加自定义音效';
    addSfxBtn.innerHTML = '<div class="pal-thumb pal-add-thumb">＋</div>' +
      '<div class="pal-label">添加音效</div>';
    addSfxBtn.addEventListener('click', function () { openCustomAudioUploader('sfx'); });
    grid.appendChild(addSfxBtn);

    state.customSfx.forEach(function (s) {
      var cb = document.createElement('div');
      cb.className = 'pal-item custom-item';
      cb.title = '试听：' + s.name + '（自定义音效 ID ' + s.id + '）';
      var cthumb = document.createElement('div');
      cthumb.className = 'pal-thumb sfx-thumb';
      var cdot = document.createElement('div');
      cdot.className = 'pal-dot';
      cdot.style.background = '#e91e63';
      cdot.textContent = '♪';
      cthumb.appendChild(cdot);
      cb.appendChild(cthumb);
      var clb = document.createElement('div');
      clb.className = 'pal-label';
      clb.textContent = s.name;
      cb.appendChild(clb);
      var del = document.createElement('span');
      del.className = 'custom-del';
      del.textContent = '×';
      del.title = '删除此自定义音效';
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        pushHistory();
        state.customSfx = state.customSfx.filter(function (x) { return x.id !== s.id; });
        persist();
        rebuildPalette();
      });
      cb.appendChild(del);
      cb.addEventListener('click', function () {
        var audio = new window.Audio();
        audio.src = s.dataUrl;
        audio.play().catch(function () {});
      });
      grid.appendChild(cb);
    });

    sec2.appendChild(grid);
    pane.appendChild(sec2);
  }

  function bgmDefById(id) {
    for (var i = 0; i < CAT.ELEMENTS.length; i++) {
      if (CAT.ELEMENTS[i].cat === 'audio' && CAT.ELEMENTS[i].bgmId === id) return CAT.ELEMENTS[i];
    }
    return null;
  }

  function updateBgmCard() {
    var card = document.getElementById('bgmCard');
    if (!card) return;
    var d = bgmDefById(state.bgm);
    // 自定义 BGM
    var customB = null;
    for (var i = 0; i < state.customBgm.length; i++) {
      if (state.customBgm[i].id === state.bgm) { customB = state.customBgm[i]; break; }
    }
    card.innerHTML = '';
    var dot = document.createElement('div');
    dot.className = 'bgm-card-dot';
    dot.style.background = d ? d.color : (customB ? '#e91e63' : '#888');
    dot.textContent = '♪';
    card.appendChild(dot);
    var info = document.createElement('div');
    info.className = 'bgm-card-info';
    var nm = d ? d.name : (customB ? customB.name : '默认 BGM');
    info.innerHTML = '<div class="bgm-card-name">' + nm + '</div>' +
      '<div class="bgm-card-sub">关卡级设置 · 不放画布' + (customB ? '（自定义）' : '') + '</div>';
    card.appendChild(info);
    var chg = document.createElement('div');
    chg.className = 'bgm-card-chg';
    chg.textContent = '切换 ›';
    card.appendChild(chg);
  }

  // ---------- BGM 单选弹窗 ----------
  var bgmModal = document.getElementById('bgmModal');
  var bgmListEl = document.getElementById('bgmList');

  function buildBgmList() {
    bgmListEl.innerHTML = '';
    CAT.ELEMENTS.forEach(function (d) {
      if (d.cat !== 'audio') return;
      var item = document.createElement('div');
      item.className = 'world-item bgm-item' + (d.bgmId === state.bgm ? ' sel' : '');
      item.innerHTML = '<span class="bgm-radio">' + (d.bgmId === state.bgm ? '●' : '○') + '</span>' +
        '<span class="bgm-dot" style="background:' + d.color + '">♪</span>' +
        '<span class="wname">' + d.name + '</span>' +
        '<span class="wmeta">ID ' + d.bgmId + ' · ' + d.file + '</span>';
      item.title = d.hint;
      item.addEventListener('click', function () {
        if (d.bgmId !== state.bgm) {
          pushHistory();
          state.bgm = d.bgmId;
          persist();
          updateBgmCard();
          bgmListEl.querySelectorAll('.bgm-item').forEach(function (it) {
            it.classList.remove('sel');
            var r = it.querySelector('.bgm-radio');
            if (r) r.textContent = '○';
          });
          item.classList.add('sel');
          var radio = item.querySelector('.bgm-radio');
          if (radio) radio.textContent = '●';
        }
        playBgm(d);   // 点击即试听（含已选中项重播）
      });
      bgmListEl.appendChild(item);
    });

    // 自定义 BGM 列表
    state.customBgm.forEach(function (b) {
      var item = document.createElement('div');
      item.className = 'world-item bgm-item custom-item' + (b.id === state.bgm ? ' sel' : '');
      item.innerHTML = '<span class="bgm-radio">' + (b.id === state.bgm ? '●' : '○') + '</span>' +
        '<span class="bgm-dot" style="background:#e91e63">♪</span>' +
        '<span class="wname">' + b.name + '</span>' +
        '<span class="wmeta">自定义 ID ' + b.id + '</span>';
      item.title = '点击试听/选中';
      item.addEventListener('click', function () {
        if (b.id !== state.bgm) {
          pushHistory();
          state.bgm = b.id;
          persist();
          updateBgmCard();
          bgmListEl.querySelectorAll('.bgm-item').forEach(function (it) {
            it.classList.remove('sel');
            var r = it.querySelector('.bgm-radio');
            if (r) r.textContent = '○';
          });
          item.classList.add('sel');
          var radio = item.querySelector('.bgm-radio');
          if (radio) radio.textContent = '●';
        }
        // 试听自定义 BGM
        stopBgm();
        bgmAudio = new window.Audio();
        bgmAudio.src = b.dataUrl;
        bgmAudio.loop = true;
        bgmAudio.volume = 0.5;
        bgmAudio.play().catch(function () {});
      });
      // 删除按钮
      var del = document.createElement('span');
      del.className = 'custom-del';
      del.textContent = '×';
      del.title = '删除此自定义 BGM';
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        pushHistory();
        state.customBgm = state.customBgm.filter(function (x) { return x.id !== b.id; });
        if (state.bgm === b.id) { state.bgm = 100; updateBgmCard(); }
        persist();
        buildBgmList();
      });
      item.appendChild(del);
      bgmListEl.appendChild(item);
    });

    // 上传自定义 BGM 按钮
    var addBtn = document.createElement('div');
    addBtn.className = 'world-item pal-add';
    addBtn.style.cursor = 'pointer';
    addBtn.innerHTML = '<span class="bgm-dot" style="background:transparent;border:2px dashed #5a6478;color:#7d8aff">＋</span>' +
      '<span class="wname">上传自定义 BGM</span>';
    addBtn.addEventListener('click', function () { openCustomAudioUploader('bgm'); });
    bgmListEl.appendChild(addBtn);
  }

  // ---------- 自定义音频上传 ----------
  var customAudioInput = document.createElement('input');
  customAudioInput.type = 'file';
  customAudioInput.accept = 'audio/*';
  customAudioInput.style.display = 'none';
  document.body.appendChild(customAudioInput);

  var _pendingAudioType = null;
  function openCustomAudioUploader(type) {
    _pendingAudioType = type;
    customAudioInput.click();
  }

  customAudioInput.addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var name = f.name.replace(/\.[^.]+$/, '');
    var reader = new FileReader();
    reader.onload = function () {
      pushHistory();
      var id = 200 + Math.floor(Math.random() * 10000);
      if (_pendingAudioType === 'bgm') {
        // 确保 id 不重复
        while (state.customBgm.some(function (b) { return b.id === id; })) id++;
        state.customBgm.push({ id: id, name: name, dataUrl: reader.result });
        persist();
        rebuildPalette();
        hintEl.textContent = '已添加自定义 BGM：' + name;
      } else {
        while (state.customSfx.some(function (s) { return s.id === id; })) id++;
        state.customSfx.push({ id: id, name: name, dataUrl: reader.result });
        persist();
        rebuildPalette();
        hintEl.textContent = '已添加自定义音效：' + name;
      }
    };
    reader.readAsDataURL(f);
    ev.target.value = '';
  });
  function openBgmModal() {
    buildBgmList();
    bgmModal.classList.add('show');
  }
  function closeBgmModal() {
    bgmModal.classList.remove('show');
    stopBgm();
  }
  document.getElementById('bgmClose').addEventListener('click', closeBgmModal);
  bgmModal.addEventListener('click', function (ev) { if (ev.target === bgmModal) closeBgmModal(); });

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

  // ---------- 音效试听（一次性，不循环） ----------
  var sfxAudio = null;
  function playSfx(s) {
    if (!sfxAudio) sfxAudio = new Audio();
    sfxAudio.pause();
    sfxAudio.src = 'soundEffect/' + s.file;
    sfxAudio.currentTime = 0;
    sfxAudio.volume = 0.6;
    var p = sfxAudio.play();
    if (p && p.catch) p.catch(function () { /* 浏览器自动播放限制时忽略 */ });
    hintEl.textContent = '试听音效：' + s.name + '（游戏内由对应事件自动触发）';
  }

  // ---------- 鼠标交互 ----------
  function evtCell(ev) {
    var rect = canvas.getBoundingClientRect();
    var mx = ev.clientX - rect.left;
    var my = ev.clientY - rect.top;
    return { col: Math.floor(mx / TILE), row: Math.floor(my / TILE) - EXTRA_TOP_ROWS };
  }

  canvas.addEventListener('mousedown', function (ev) {
    ev.preventDefault();
    var cell = evtCell(ev);
    hover = cell;
    painting = true;
    paintBtn = ev.button;
    paintedCells = {};

    // 双击手势第一下（detail===1）按下时，记录该格“已存在”的元素；
    // 供 dblclick 判定，避免空白处双击先触发放置、再误弹属性框
    if (ev.button === 0 && ev.detail === 1) {
      var _seedHit = hitTest(cell.col, cell.row);
      dblSeedUid = _seedHit ? _seedHit.uid : null;
    }

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
        // 命中已有元素：仅选中；单击/双击不产生编辑历史（避免误清空原版世界高保真 def），
        // 真正发生拖动移位时才在 mousemove 中把拖动前状态压入撤销栈
        inStroke = true;
        selected = hit;
        dragging = true;
        dragCommitted = false;
        dragOrigCol = hit.col;
        dragOrigRow = hit.row;
        dragStartCol = cell.col;
        dragStartRow = cell.row;
        // 调试：点击选中时打印该元素实例完整数据（含 uid/自定义字段）
        console.log('[editor] 选中元素实例 [' + hit.uid + ']', JSON.parse(JSON.stringify(hit)));
        hintEl.textContent = '已选中：[' + hit.uid + '] ' + (CAT.byId(hit.id).name || hit.id) +
          '（双击可编辑属性，按住拖动可移动，按 Delete 删除）';
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
    // 悬停的元素实例（带 uid，调试复现时可据此精确定位）
    var hovHit = hitTest(cell.col, cell.row);
    var statusTxt = '位置：列 ' + cell.col + ' / 行 ' + cell.row +
      '（共 ' + state.elements.length + ' 个元素，画布 ' + state.cols + ' 列）';
    if (hovHit) {
      var hd = CAT.byId(hovHit.id);
      statusTxt += ' · 悬停：[' + hovHit.uid + '] ' + (hd ? hd.name : hovHit.id);
    }
    if (selected) {
      var sd2 = CAT.byId(selected.id);
      statusTxt += ' · 已选中：[' + selected.uid + '] ' + (sd2 ? sd2.name : selected.id);
    }
    statusEl.textContent = statusTxt;

    if (dragging && selected) {
      // 拖动选中元素：按鼠标位移更新位置，吸附网格并做边界钳制
      var d = CAT.byId(selected.id);
      var tw = (d.tw || 1), th = (d.th || 1);
      if (d.id.indexOf('lift_') === 0) tw = liftLen(selected);
      if (d.id === 'platform_hang') { tw = platInfo(selected).w; th = 1; }
      if (d.id === 'block_fall' || d.id === 'block_fall_d') {
        var fdi = fallInfo(selected);
        tw = fdi.ori === 'h' ? fdi.count : 1;
        th = fdi.ori === 'h' ? 1 : fdi.count;
      }
      if (d.id === '_trapzone') { tw = 1; th = 2; }
      var nc = dragOrigCol + (cell.col - dragStartCol);
      var nr = dragOrigRow + (cell.row - dragStartRow);
      nc = Math.max(0, Math.min(state.cols - tw, nc));
      nr = Math.max(-EXTRA_TOP_ROWS, Math.min(ROWS - th, nr));
      if (nc !== selected.col || nr !== selected.row) {
        // 首次真正移位：先把拖动前状态压入撤销栈（snapshot 必须在改坐标之前），
        // 仅单击选中不移动时不产生历史、不丢失原版世界高保真 def
        if (!dragCommitted) { pushHistory(); dragCommitted = true; }
        selected.col = nc;
        selected.row = nr;
        // 陷阱触发区：拖动时同步世界坐标 sa/sb
        if (selected.id === '_trapzone' && selected.trap) {
          selected.trap.sa = nc * 2900;
          selected.trap.sb = (nr * 29 - 12) * 100;
        }
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
      if (dragCommitted) persist();   // 仅真正移位后才自动保存
      dragCommitted = false;
    }
  });
  canvas.addEventListener('mouseleave', function () { hover = null; requestRender(); });
  canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
  // 双击画布上已有元素：选中并弹出属性框（与上方“⚙ 属性”按钮同一弹窗）
  canvas.addEventListener('dblclick', function (ev) {
    ev.preventDefault();
    var cell = evtCell(ev);
    var hit = hitTest(cell.col, cell.row);
    // 仅当双击起始时该位置已有同一元素才弹窗（空白处双击放置元素不弹、橡皮擦除后不弹）
    if (!hit || !dblSeedUid || hit.uid !== dblSeedUid) return;
    selected = hit;
    updatePropBtn();
    requestRender();
    openPropModal();
  });
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
      bgm: state.bgm,
      nextLevel: state.nextLevel,
      hintTexts: state.hintTexts,
      elements: state.elements
    };
    // 自定义元素定义列表
    var customElements = CAT.listCustom();
    // 多文件下载：level.json + custom_elements.json + custom_bgm.json + custom_sfx.json
    var files = [
      { name: 'catmario_level.json', data: data },
      { name: 'custom_elements.json', data: customElements.length ? customElements : null },
      { name: 'custom_bgm.json', data: state.customBgm.length ? state.customBgm : null },
      { name: 'custom_sfx.json', data: state.customSfx.length ? state.customSfx : null }
    ].filter(function (f) { return f.data !== null; });

    var idx = 0;
    function downloadNext() {
      if (idx >= files.length) {
        hintEl.textContent = '已保存 ' + files.length + ' 个文件（含 ' + state.elements.length + ' 个元素）';
        return;
      }
      var f = files[idx++];
      var blob = new Blob([JSON.stringify(f.data, null, 1)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      setTimeout(downloadNext, 200);
    }
    downloadNext();
  });

  document.getElementById('loadBtn').addEventListener('click', function () {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', function (ev) {
    var files = ev.target.files;
    if (!files || files.length === 0) return;
    readMultipleFiles(files);
    ev.target.value = '';
  });

  // ---------- 示例世界：原版关卡 def（window.STAGES）→ 编辑器元素 ----------
  // 字节网格值 → 元素 id（与 play.html TILE_VAL 互逆）
  var W_BYTE_ID = { 1: 'block_brick', 2: 'block_question', 3: 'block_hard', 4: 'block_stair',
    5: 'block_ground_top', 6: 'block_ground_fill', 7: 'block_hidden', 8: 'block_cat_shut',
    9: 'item_coin', 10: 'block_spike', 30: 'bg_midflag' };
  // 注：原版管道装饰砖块 v=40(pipe_top)/v=41/43/44(pipe_body) 已由 pipe_mouth/connector 自绘，不再作为独立元素导入
  var W_ENEMY0 = ['enemy_syobon', 'enemy_turtle', 'enemy_shell', 'enemy_ghost', 'enemy_king',
    'enemy_tongue_cat', 'enemy_robot', 'enemy_syobon_pad', 'enemy_runner', 'enemy_flame'];
  var W_BG0 = ['bg_hill_house', 'bg_grass', 'bg_cloud_face', 'bg_tree',
    'bg_cloud_angry', 'bg_tree_round', 'bg_lava'];
  function wBlockId(type, xt) {
    xt = xt || 0;
    if (type === 100) return { id: 'block_brick' };
    // ttype=101 txtype：0=白猫怪 1=皇冠怪 3/10=火焰花 4=机器人（皇冠怪/机器人按敌人近似）
    if (type === 101) return (xt === 3 || xt === 10)
      ? { id: 'block_question', extra: { pop: 'flower' } }
      : { id: 'block_question', extra: { pop: 'enemy' } };
    if (type === 102) return { id: 'block_question', extra: { pop: 'mushroom' } };
    if (type === 103) return { id: 'block_question', extra: { pop: 'poison' } };
    if (type === 104) return { id: 'block_question', extra: { pop: 'badstar' } };
    // 问号块出P开关（引擎新增 ttype=105：顶出后原地变P开关块400）
    if (type === 105) return { id: 'block_question', extra: { pop: 'pswitch' } };
    // 量产块（110→111）：xt 选择量产对象 0=毒蘑菇 1=白猫怪 2=红蘑菇 3=火焰花 4=坏星
    if (type === 110 || type === 111) return {
      id: 'block_question',
      extra: { pop: ({ 1: 'enemy', 2: 'mushroom', 3: 'flower', 4: 'badstar' })[xt] || 'poison', mass: true }
    };
    if (type === 112 || type === 113) return { id: 'block_question', extra: { pop: 'coin', mass: true } };
    // 隐藏块 txtype（弹出对象与问号块取并集）：
    //   单发 0=毒蘑菇 2=金币 4=红蘑菇 6=白猫怪 8=火焰花 10=P开关 11=坏星
    //   量产 12=金币 20=毒蘑菇 22=红蘑菇 26=白猫怪 28=火焰花 30=坏星
    if (type === 114) {
      var hM = { 12: 'coin', 20: 'poison', 22: 'mushroom', 26: 'enemy', 28: 'flower', 30: 'badstar' };
      if (hM[xt] != null) return { id: 'block_hidden', extra: { pop: hM[xt], mass: true } };
      var hS = { 0: 'poison', 2: 'coin', 4: 'mushroom', 6: 'enemy', 8: 'flower', 10: 'pswitch', 11: 'badstar' };
      return { id: 'block_hidden', extra: { pop: hS[xt] || 'poison' } };
    }
    if (type === 117) return { id: xt === 1 ? 'b2_note_peach' : 'b2_note_white' };
    if (type === 120) return { id: 'item_jumppad' };
    if (type === 130) return { id: 'b2_on' };
    if (type === 131) return { id: 'b2_off' };
    if (type === 140) return { id: 'b2_sword' };
    if (type === 141) return { id: 'b2_blade' };
    if (type === 142) return { id: 'b2_pineapple' };
    if (type === 300) return { id: 'b2_hint' };
    if (type === 400) return { id: 'b2_pswitch' };
    if (type === 800) return { id: 'item_coin' };
    return null;
  }
  function wEnemyId(t) {
    if (t >= 0 && t <= 9) return W_ENEMY0[t];
    var m = { 100: 'item_mushroom_red', 101: 'item_flower', 102: 'item_mushroom_purple',
      105: 'item_green_question', 110: 'item_star', 10: 'enemy_flame_h', 30: 'enemy_moralar',
      31: 'enemy_chicken', 80: 'enemy_cloud_face', 81: 'enemy_cloud_plain', 83: 'enemy_spike_ball',
      84: 'enemy_fireball', 85: 'fake_pole', 86: 'enemy_peach_cat', 87: 'firebar', 90: 'enemy_beam' };
    return m[t] || null;
  }
  var W_LIFT_ID = { 0: 'lift_yellow', 2: 'lift_green', 21: 'lift_gray' };
  var W_BGM_ID = { 100: 'bgm_field', 103: 'bgm_dungeon', 104: 'bgm_star', 105: 'bgm_castle', 106: 'bgm_puyo' };
  var W_THEME = { 1: 'overworld', 2: 'dungeon', 3: 'sky', 4: 'castle' };
  // 主题变体：地下/城堡关卡的网格字节用对应配色元素还原（与引擎 id+30/+60 贴图一致）
  var W_THEME_VAR = {
    dungeon: { block_brick: 'block_d_brick', block_question: 'block_d_question', block_hard: 'block_d_hard',
      block_stair: 'block_d_stair', block_ground_top: 'block_d_ground_top', block_ground_fill: 'block_d_ground_fill',
      block_spike: 'block_d_spike' },
    castle: { block_brick: 'block_c_brick', block_question: 'block_c_question', block_hard: 'block_c_hard',
      block_stair: 'block_c_stair', block_ground_top: 'block_c_ground_top', block_ground_fill: 'block_c_ground_fill',
      block_spike: 'block_c_spike' }
  };

  function worldToElements(def) {
    var E = [];
    var skip = 0;
    var maxCol = 0;
    var tv = W_THEME_VAR[W_THEME[def.stagecolor] || 'overworld'] || null;
    function vid(baseId) { return (baseId && tv && tv[baseId]) ? tv[baseId] : baseId; }
    function note(col) { if (col > maxCol) maxCol = col; }
    function add(id, col, row, extra, uid) {
      if (!id || !CAT.byId(id)) { skip++; return; }
      var e = { id: id, col: col | 0, row: row | 0, uid: uid || null };
      if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
      E.push(e);
    }
    // 1) 字节网格 — 先把 stype=200 块状地面注入网格副本（原版用独立管道填充，
    //    编辑器需要可见，游戏侧 convert 也会从网格字节正确还原）
    var g = [];
    var srcGrid = def.grid || [];
    for (var gi = 0; gi < 17; gi++) g.push((srcGrid[gi] || []).slice());
    (def.pipes || []).forEach(function (p) {
      if (p.stype !== 200) return;
      var c0 = Math.round(p.sa / 100 / 29), r0 = Math.round((p.sb / 100 + 12) / 29);
      var nCols = Math.floor(p.sc / 3000), nRows = Math.floor(p.sd / 3000);
      for (var cc = 0; cc <= nCols; cc++) {
        for (var rr = 0; rr <= nRows; rr++) {
          var tc = c0 + cc, tr = r0 + rr;
          if (tr >= 0 && tr < 17 && tc >= 0 && tc < 1001) {
            if (!g[tr][tc]) g[tr][tc] = (rr === 0) ? 5 : 6; // 5=ground_top, 6=ground_fill
          }
        }
      }
    });
    for (var t = 0; t < 17; t++) {
      var row = g[t] || [];
      for (var tt = 0; tt < 1001; tt++) {
        var v = row[tt];
      if (!v) continue;
      note(tt);
      var guid = 'g' + t + '_' + tt;   // 网格字节元素：行_列 天然唯一
      if (v === 40) {
        // 管口字节：向下扫描管身字节(41/43/44)，合并为 pipe_mouth 元素
        var _pmBody = 0;
        for (var _pr = t + 1; _pr < 17; _pr++) {
          var _pv = (g[_pr] || [])[tt];
          if (_pv === 41 || _pv === 43 || _pv === 44) _pmBody++;
          else break;
        }
        add('pipe_mouth', tt, t, { length: Math.max(1, _pmBody), dir: 'up', entry: 'none' }, guid);
        continue;
      }
      if (v === 41 || v === 43 || v === 44) continue;  // 管身字节：已由管口合并，跳过
      if (v === 99) add('goal_pole', tt, Math.min(t, 11), null, guid);
      else if (v >= 20 && v <= 29) add('lift_yellow', tt, t, { len: 1 }, guid);
      else if (v >= 50 && v <= 79) add(W_ENEMY0[v - 50], tt, t, null, guid);
      else if (v >= 80 && v <= 89) add(W_BG0[v - 80], tt, t, null, guid);
      else if (W_BYTE_ID[v]) add(vid(W_BYTE_ID[v]), tt, t, null, guid);
      else skip++;
      }
    }
    // 2) 特殊方块（tyobi，x/y 像素）
    (def.blocks || []).forEach(function (b, bi) {
      var col = Math.round(b.x / 29), row = Math.round((b.y + 12) / 29);
      note(col);
      var wb = wBlockId(b.type, b.xt);
      // 问号块/隐藏块带 pop/mass 属性时不套主题外观变体（变体是纯金币外观的字节块）
      var plainQ = wb && (wb.id === 'block_question' || wb.id === 'block_hidden') && wb.extra;
      var bid = (wb && !plainQ) ? vid(wb.id) : (wb ? wb.id : null);
      var extra = wb && wb.extra ? JSON.parse(JSON.stringify(wb.extra)) : null;
      // 提示块：恢复 txtype → hintType
      if (b.type === 300 && b.xt >= 1 && b.xt <= 100) {
        extra = { hintType: String(b.xt) };
      }
      add(bid, col, row, extra, 'b' + bi);
    });
    // 3) 独立管道/墙体（sa/sb 世界单位）
    // 1-2-1 连锁崩塌桥自动接线记忆：最近 sxtype=0 砖组 uid（_faUid）/ sxtype=1 砖组 uid（_fb1Uid）
    var _faUid = null, _fb1Uid = null;
    (def.pipes || []).forEach(function (p, pi) {
      var col = Math.round(p.sa / 100 / 29), row = Math.round((p.sb / 100 + 12) / 29);
      note(col);
      var puid = 'p' + pi;
      if (p.stype === 50) {
        // 原版 stype=50 竖管：sxtype=0→陷阱、1/2/5→普通（变体）
        // 坐标：sa = col*2900+500，sb = row*2900-1200（管口上沿）
        var pmCol = Math.round((p.sa - 500) / 2900);
        var pmRow = Math.round((p.sb / 100 + 12) / 29);
        // 长度：sd = 总高度（含管口），length = sd/2900 - 管口1格
        var pmLen = Math.max(1, Math.min(20, Math.max(1, Math.round((p.sd + 100) / 2900) - 1)));
        var pmEntry = (p.sxtype === 0) ? 'trap' : 'none';
        add('pipe_mouth', pmCol, pmRow, { length: pmLen, dir: 'up', entry: pmEntry }, puid);
      } else if (p.stype === 60) {
        var pmCol2 = Math.round((p.sa - 500) / 2900);
        var pmRow2 = Math.round((p.sb / 100 + 12) / 29);
        var pmLen2 = Math.max(1, Math.min(20, Math.max(1, Math.round((p.sd + 100) / 2900) - 1)));
        add('pipe_mouth', pmCol2, pmRow2, { length: pmLen2, dir: 'up', entry: 'warp', warp: p.warp || { end: true, id: null } }, puid);
      } else if (p.stype === 40) {
        // 原版左进入管道（简单 AABB，无 onEnter，只是实心绿色矩形）
        // 位置：sa=col*2900, sb=(row*29-12)*100, sc=3000, sd=5800
        // 作为特殊 pipe_mouth 存：stype=40 标记，dir='left'
        var pmCol40 = Math.round(p.sa / 2900);
        var pmRow40 = Math.round((p.sb / 100 + 12) / 29);
        add('pipe_mouth', pmCol40, pmRow40, { length: 1, dir: 'left', entry: 'none', _origStype: 40 }, puid);
      } else if (p.stype === 5 && p.sxtype === 10) {
        // 原版横管向左口
        add('pipe_mouth', col, row, { length: 1, dir: 'left', entry: 'none' }, puid);
      } else if (p.stype === 5 && p.sxtype === 11) {
        // 原版横管向右口
        add('pipe_mouth', col, row, { length: 1, dir: 'right', entry: 'none' }, puid);
      } else if (p.stype === 1 || p.stype === 2 || p.stype === 5) {
        // grid 字节已恢复，跳过（避免重复）
      } else if (p.stype === 51 && (!p.sxtype || p.sxtype === 0) && (p.mov || p.sc >= p.sd)) {
        // 坠落砖组：经典 sxtype=0 横排（sc>=sd），或编辑器 mov 配置（支持竖排/四方向）
        var horiz = p.mov ? (p.mov.axis !== 'x') : true;
        var fnum = Math.round(((horiz ? p.sc : p.sd) + 1) / 3000);
        fnum = Math.max(2, Math.min(12, fnum || 3));
        var fori = horiz ? 'h' : 'v';
        var fdir;
        if (p.mov && p.mov.dir < 0) fdir = horiz ? 'up' : 'left';
        else if (p.mov) fdir = horiz ? 'down' : 'right';
        else fdir = 'down';
        add('block_fall', col, row, { ori: fori, count: fnum, dir: fdir, chain: p.chain || '' }, puid);
        _faUid = puid;   // 记忆最近 sxtype=0 砖组（供 sxtype=1 连锁监视接线）
      } else if (p.stype === 51 && (p.sxtype === 1 || p.sxtype === 2) && p.sc >= p.sd) {
        // 坠落砖组·延时（sxtype=1/2 地下砖横排，1-2-1 连锁崩塌桥）：
        // 旧引擎连锁（main.cpp:2484-2488）：sxtype=1 监视首个 sxtype=0 砖组（其坠落至
        // sb>=25000 且玩家右缘在其左侧才崩塌）；sxtype=2 监视 sxtype=1 砖组（坠落至
        // sb>=48000 且玩家存活）。按管线顺序自动接线，引擎 loadStage 同规则兜底
        var fdnum = Math.round((p.sc + 1) / 3000);
        fdnum = Math.max(2, Math.min(12, fdnum || 3));
        add('block_fall_d', col, row, {
          ori: 'h', count: fdnum, dir: 'down',
          delay: p.delay != null ? +p.delay : (p.sxtype === 1 ? 0.5 : 1),
          chain: p.chain || (p.sxtype === 1 ? _faUid : _fb1Uid) || ''
        }, puid);
        if (p.sxtype === 1) _fb1Uid = puid;   // 记忆最近 sxtype=1 砖组（供 sxtype=2 接线）
      } else if (p.stype >= 100 && p.stype <= 104) {
        // 非实体陷阱触发区（100猫脸怪/101幽灵/102天降敌人/103激光/104光束）：
        // 以 _trapzone 元素保留原始世界坐标，画布以虚线框可视化，可编辑 stype/sxtype、可拖动，
        // 试玩 convert 时 1:1 还原；刷新恢复、编辑其他元素都不会使其丢失
        add('_trapzone', col, row, {
          trap: { stype: p.stype, sxtype: p.sxtype || 0, sa: p.sa, sb: p.sb, sc: p.sc, sd: p.sd }
        }, puid);
      } else {
        skip++;   // 51 其他变体/52 下落块、火焰管/消息、40 进入管等暂不在编辑器暴露
      }
    });
    // 4) 敌人/道具触发器（ba/bb 世界单位）
    (def.enemies || []).forEach(function (en, ei) {
      var eid = wEnemyId(en.btype);
      var euid = 'e' + ei;
      if (eid === 'firebar') {
        // 火焰棒：圆心在第0颗火球=格子中心（ba=(col*29+14.5)*100, bb=(row*29-12+14.5)*100）；
        // bxtype = 火球数 + (角度+100)*100（角度编码 bxtype>=10000；遗留值 101~120 是
        // 原版 P 开关联动值，100 位非角度，按 rot=0 处理）
        var bt = en.bxtype || 5;
        var fbCol = Math.round((en.ba / 100 - 14.5) / 29);
        var fbRow = Math.round((en.bb / 100 + 12 - 14.5) / 29);
        note(fbCol);
        add('firebar', fbCol, fbRow, { xt: bt % 100 || 5, rot: bt >= 10000 ? (Math.floor(bt / 100) - 100) % 360 : 0 }, euid);
      } else {
        var col = Math.round(en.ba / 100 / 29), row = Math.round((en.bb / 100 + 12) / 29);
        note(col);
        add(eid, col, row, null, euid);
      }
    });
    // 5) 升降台（sra/srb 世界单位）
    (def.lifts || []).forEach(function (l, li) {
      var col = Math.round(l.sra / 100 / 29), row = Math.round((l.srb / 100 + 12) / 29);
      note(col);
      var luid = 'l' + li;
      if (l.srsp >= 10 && l.srsp <= 14 && l.src >= 5000) {
        // 悬挂站台 srsp=10~14：自定义柱高 srh（世界单位，缺省48000≈16格）；sracttype=1=可下降
        var pw0 = Math.max(1, Math.min(50, Math.round(l.src / 3000)));
        var ph0 = l.srh ? Math.max(1, Math.min(30, Math.round(l.srh / 2900))) : 16;
        add('platform_hang', col, row, { w: pw0, h: ph0, drop: l.sracttype === 1 }, luid);
      } else if (l.srsp === 1) {
        // 易碎台 srsp=1：编辑器按普通黄台还原（踩碎陷阱不保留）
        add('lift_yellow', col, row, { len: Math.max(1, Math.round(l.src / 3000)) }, luid);
      } else if (W_LIFT_ID[l.srsp]) {
        add(W_LIFT_ID[l.srsp], col, row, { len: Math.max(1, Math.round(l.src / 3000)) }, luid);
      } else skip++;
    });
    // 6) 出生点（BGM 是关卡级设置，不放画布，随返回值交给 loadData）
    // 原版抽取关 spawn={ma,mb} 世界坐标；编辑器自定义关 spawn={x,y} 像素坐标
    if (def.spawn) {
      var sp = (typeof def.spawn.ma === 'number')
        ? { x: def.spawn.ma / 100, y: def.spawn.mb / 100 + 12 }
        : { x: def.spawn.x, y: def.spawn.y + 12 };
      add('player_start', Math.round(sp.x / 29), Math.round(sp.y / 29), null, 'spawn');
    }
    return {
      elements: E,
      theme: W_THEME[def.stagecolor] || 'overworld',
      cols: maxCol + 2,
      skip: skip,
      bgm: (def.bgm && W_BGM_ID[def.bgm]) ? def.bgm : 100
    };
  }

  function loadWorld(stage) {
    var conv = worldToElements(stage);
    loadData({ cols: conv.cols, theme: conv.theme, bgm: conv.bgm, elements: conv.elements });
    state._worldDef = stage;   // 未编辑前试玩 1:1 还原原版
    scroller.scrollLeft = 0;
    hintEl.textContent = '已载入世界 ' + stage.id + '（' + stage.name + '）：' + conv.elements.length +
      ' 个元素，' + conv.cols + ' 列' +
      (conv.skip ? '；其中 ' + conv.skip + ' 个陷阱/特效机关未在编辑器暴露（试玩仍 1:1 还原）' : '');
  }

  // 示例世界弹窗
  var worldModal = document.getElementById('worldModal');
  var worldListEl = document.getElementById('worldList');
  var W_THEME_NAME = { 1: '地上', 2: '地下', 3: '空中', 4: '城堡' };
  function buildWorldList() {
    worldListEl.innerHTML = '';
    (window.STAGES || []).forEach(function (s) {
      var item = document.createElement('div');
      item.className = 'world-item';
      item.innerHTML = '<span class="wid">' + s.id + '</span>' +
        '<span class="wname">' + s.name + '</span>' +
        '<span class="wmeta">' + (W_THEME_NAME[s.stagecolor] || '') + ' · BGM ' + s.bgm + '</span>';
      item.addEventListener('click', function () {
        worldModal.classList.remove('show');
        loadWorld(s);
      });
      worldListEl.appendChild(item);
    });
  }
  document.getElementById('demoBtn').addEventListener('click', function () {
    if (!window.STAGES || !window.STAGES.length) { hintEl.textContent = '未找到关卡数据 stages_data.js'; return; }
    buildWorldList();
    worldModal.classList.add('show');
  });
  document.getElementById('worldClose').addEventListener('click', function () { worldModal.classList.remove('show'); });
  worldModal.addEventListener('click', function (ev) { if (ev.target === worldModal) worldModal.classList.remove('show'); });

  // 试玩：把当前关卡交给 play.html（新引擎 game/engine.js，JSON 直接转关卡定义）
  document.getElementById('playBtn').addEventListener('click', function () {
    var data = {
      app: 'catmario-level-editor',
      version: 1,
      tile: TILE,
      rows: ROWS,
      cols: state.cols,
      theme: state.theme,
      bgm: state.bgm,
      nextLevel: state.nextLevel,
      hintTexts: state.hintTexts,
      elements: state.elements,
      customDefs: CAT.listCustom().reduce(function (m, d) {
        m[d.id] = { cat: d.cat, name: d.name, dataUrl: d.dataUrl, tw: d.tw, th: d.th, collide: d.collide,
          ttype: d.ttype, stype: d.stype, btype: d.btype };
        return m;
      }, {}),
      customBgm: state.customBgm,
      customSfx: state.customSfx
    };
    // 载入示例世界且未编辑时，附带原版关卡 def，试玩页 1:1 还原（含编辑器未暴露的陷阱/特效机关）
    if (state._worldDef) data._worldDef = state._worldDef;
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

  // 拖拽 JSON 文件到窗口加载（支持多文件）
  window.addEventListener('dragover', function (ev) { ev.preventDefault(); });
  window.addEventListener('drop', function (ev) {
    ev.preventDefault();
    var files = ev.dataTransfer.files;
    if (files && files.length > 0) readMultipleFiles(files);
  });

  function readJsonFile(f) {
    // 单文件读取（向后兼容）：直接作为 level 加载
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        // 单文件模式：兼容含/不含 customElements 字段的 level
        readMultipleFiles([f]);
      } catch (err) {
        alert('JSON 解析失败：' + err.message);
      }
    };
    reader.readAsText(f);
  }

  // 多文件读取：按文件名前缀分流，custom_* 先加载再 level
  function readMultipleFiles(files) {
    var pending = [];
    var levelFile = null;
    var customElementsFile = null;
    var customBgmFile = null;
    var customSfxFile = null;
    for (var i = 0; i < files.length; i++) {
      var n = files[i].name.toLowerCase();
      if (/^catmario_level/.test(n)) levelFile = files[i];
      else if (/^custom_elements/.test(n)) customElementsFile = files[i];
      else if (/^custom_bgm/.test(n)) customBgmFile = files[i];
      else if (/^custom_sfx/.test(n)) customSfxFile = files[i];
      else if (/\.json$/.test(n) && !levelFile) levelFile = files[i]; // 兼容旧单文件
    }
    var missing = [];
    function readOne(f, cb) {
      if (!f) { cb(null); return; }
      var rd = new FileReader();
      rd.onload = function () {
        try { cb(JSON.parse(rd.result)); }
        catch (e) { alert(f.name + ' 解析失败：' + e.message); cb(null); }
      };
      rd.readAsText(f);
    }
    // 先读取 custom_* 文件
    var tasks = [];
    if (customElementsFile) tasks.push(function (cb) { readOne(customElementsFile, function (d) { cb({ type: 'elements', data: d }); }); });
    if (customBgmFile) tasks.push(function (cb) { readOne(customBgmFile, function (d) { cb({ type: 'bgm', data: d }); }); });
    if (customSfxFile) tasks.push(function (cb) { readOne(customSfxFile, function (d) { cb({ type: 'sfx', data: d }); }); });
    if (levelFile) tasks.push(function (cb) { readOne(levelFile, function (d) { cb({ type: 'level', data: d }); }); });

    function runTask(i, cb) {
      if (i >= tasks.length) { cb(); return; }
      tasks[i](function (result) {
        if (result && result.type === 'elements' && Array.isArray(result.data)) {
          // 注入自定义元素定义
          result.data.forEach(function (d) {
            if (d && d.id && d.dataUrl) CAT.registerCustom(d);
          });
        } else if (result && result.type === 'bgm' && Array.isArray(result.data)) {
          state.customBgm = result.data;
        } else if (result && result.type === 'sfx' && Array.isArray(result.data)) {
          state.customSfx = result.data;
        } else if (result && result.type === 'level' && result.data) {
          var lv = result.data;
          // 把已加载的 customBgm/Sfx 合并到 level 数据中
          if (state.customBgm.length) lv.customBgm = state.customBgm;
          if (state.customSfx.length) lv.customSfx = state.customSfx;
          // level.customElements → 注入到 CAT（兼容旧格式）
          if (Array.isArray(lv.customElements)) {
            lv.customElements.forEach(function (d) {
              if (d && d.id && d.dataUrl) CAT.registerCustom(d);
            });
          }
          // customDefs 格式
          if (lv.customDefs) {
            for (var cid in lv.customDefs) {
              var cd = lv.customDefs[cid];
              CAT.registerCustom({
                id: cid, name: cd.name || '自定义', cat: cd.cat || 'bg',
                kind: 'sprite', dataUrl: cd.dataUrl, tw: cd.tw || 1, th: cd.th || 1,
                custom: true, collide: cd.collide || 'none',
                ttype: cd.ttype, stype: cd.stype, btype: cd.btype
              });
            }
          }
          loadData(lv);
          hintEl.textContent = '已加载 ' + (levelFile ? levelFile.name : '关卡') +
            '（' + state.elements.length + ' 个元素，' + state.cols + ' 列）';
        }
        runTask(i + 1, cb);
      });
    }
    runTask(0, function () {
      // 检查缺失文件
      if (levelFile) {
        // 检查 level 是否引用了自定义元素但未加载 custom_elements
        var refs = state.elements.some(function (e) {
          return e.id && e.id.indexOf('custom_') === 0;
        });
        if (refs && !customElementsFile) {
          missing.push('custom_elements.json（画布上有自定义元素引用）');
        }
        if (state.bgm >= 200 && !customBgmFile) {
          missing.push('custom_bgm.json（BGM 引用了自定义音频）');
        }
      } else {
        missing.push('catmario_level.json（关卡主文件）');
      }
      if (missing.length) {
        alert('⚠ 警告：缺少文件\n\n' + missing.join('\n') +
          '\n\n相关功能将无法正常工作。');
      }
    });
  }

  function loadData(data) {
    if (!data || !Array.isArray(data.elements)) throw new Error('格式不正确：缺少 elements 数组');
    state._worldDef = null;   // 外部载入（JSON/示例世界转换结果）默认无高保真 def；loadWorld 会在其后显式设置
    history = [];
    var bgmFromEl = null;     // 兼容旧数据：画布上的 BGM 标记迁移为关卡级 bgm
    // 清除已有自定义元素（避免重复）
    CAT.ELEMENTS = CAT.ELEMENTS.filter(function (e) { return !e.custom; });
    // 注入自定义元素定义
    if (data.customDefs) {
      for (var cid in data.customDefs) {
        var cd = data.customDefs[cid];
        CAT.registerCustom({
          id: cid, name: cd.name || '自定义', cat: cd.cat || 'bg',
          kind: 'sprite', dataUrl: cd.dataUrl, tw: cd.tw || 1, th: cd.th || 1,
          custom: true, collide: cd.collide || 'none',
          ttype: cd.ttype, stype: cd.stype, btype: cd.btype,
          hint: '自定义元素'
        });
      }
    }
    if (data.customElements) {
      data.customElements.forEach(function (d) {
        CAT.registerCustom(JSON.parse(JSON.stringify(d)));
      });
    }
    // 新载入一关：重置 uid 占用表（uid 仅要求关卡内唯一）
    uidSeq = 0; uidSet = Object.create(null);
    // 旧档变体元素映射：问号块/隐藏块已统一为 pop/mass 属性模型
    var LEGACY_QMAP = {
      block_q_mushroom:    { pop: 'mushroom' },
      block_q_enemy:       { pop: 'enemy' },
      block_q_poison:      { pop: 'poison' },
      block_q_poison_mass: { pop: 'poison', mass: true },
      block_q_coin_mass:   { pop: 'coin', mass: true },
      block_q_badstar:     { pop: 'badstar' }
    };
    var rawEls = data.elements.map(function (e) {
      if (!e || typeof e.id !== 'string') return e;
      if (LEGACY_QMAP[e.id]) {
        var lm = LEGACY_QMAP[e.id];
        var ne2 = {};
        for (var lk in e) ne2[lk] = e[lk];
        ne2.id = 'block_question';
        ne2.pop = lm.pop;
        ne2.mass = !!lm.mass;
        return ne2;
      }
      if (e.id === 'block_hidden_poison') {
        var nh = {};
        for (var hk in e) nh[hk] = e[hk];
        nh.id = 'block_hidden';
        nh.pop = e.hv === 2 ? 'coin' : (e.hv === 10 ? 'pswitch' : 'poison');
        nh.mass = false;
        return nh;
      }
      return e;
    });
    state.elements = rawEls.filter(function (e) {
      return e && CAT.byId(e.id) && typeof e.col === 'number' && typeof e.row === 'number';
    }).map(function (e) {
      var ed = CAT.byId(e.id);
      if (ed.cat === 'audio') { if (bgmFromEl == null) bgmFromEl = ed.bgmId; return null; }
      var out = { id: e.id, col: e.col | 0, row: e.row | 0 };
      // 字段白名单：uid 合法且未重复则保留（示例世界确定性 id / 旧档已有 id），否则补 u<n>
      out.uid = claimUid(e.uid) || nextUid();
      if (e.len) out.len = e.len | 0;
      if (e.xt) out.xt = e.xt | 0;
      if (e.rot) out.rot = (((e.rot | 0) % 360) + 360) % 360;
      if (e.warp && (e.warp.end || e.warp.id)) out.warp = { end: !!e.warp.end, id: e.warp.id || null };
      // 问号块/隐藏块的弹出对象与量产标记（pop 必须保留，mass 默认 false）
      if (e.id === 'block_question' || e.id === 'block_hidden') {
        if (e.pop) out.pop = String(e.pop);
        out.mass = !!e.mass;
      }
      if (e.id === 'platform_hang') {
        if (e.w != null) out.w = e.w | 0;
        if (e.h != null) out.h = e.h | 0;
        out.drop = !!e.drop;
      }
      if (e.id === 'block_fall' || e.id === 'block_fall_d') {
        if (e.ori === 'h' || e.ori === 'v') out.ori = e.ori;
        if (e.count != null) out.count = e.count | 0;
        if (e.dir) out.dir = String(e.dir);
        if (e.delay != null) out.delay = Math.max(0, +e.delay || 0);
        if (e.chain) out.chain = String(e.chain);   // 链式触发目标 uid（悬空引用运行时自动忽略）
      }
      // 连接管字段放行：rot + lengths 数组
      if (e.id === 'pipe_cross' || e.id === 'pipe_tee' || e.id === 'pipe_L_a' || e.id === 'pipe_L_b') {
        if (e.rot != null) out.rot = ((e.rot | 0) % 360 + 360) % 360;
        if (Array.isArray(e.lengths)) {
          out.lengths = e.lengths.map(function (x) { return Math.max(1, Math.min(4, x | 0 || 1)); });
        } else {
          out.lengths = (ed.lengths || [1, 1]).slice();
        }
      }
      // 内部陷阱触发区：原样保留 stype/sxtype + 世界坐标矩形（sa/sb/sc/sd）
      if (e.id === '_trapzone' && e.trap && typeof e.trap === 'object') {
        var tz = e.trap;
        out.trap = {
          stype: Math.max(100, Math.min(104, tz.stype | 0)),
          sxtype: tz.sxtype | 0,
          sa: tz.sa | 0, sb: tz.sb | 0, sc: tz.sc | 0, sd: tz.sd | 0
        };
      }
      // 管道口字段放行：length + dir + entry
      if (e.id === 'pipe_mouth') {
        out.length = Math.max(1, Math.min(20, e.length | 0 || ed.length || 1));
        if (e.dir) out.dir = String(e.dir);
        if (e.entry) out.entry = String(e.entry);
        if (e.entry === 'warp' && e.warp && (e.warp.end || e.warp.id)) {
          out.warp = { end: !!e.warp.end, id: e.warp.id || null };
        }
      }
      return out;
    }).filter(Boolean);
    bumpUidSeq();   // 续号从本关已有 u<n> 最大值之后开始
    if (data.cols) state.cols = Math.max(20, Math.min(1000, data.cols | 0));
    if (data.theme && THEMES[data.theme]) state.theme = data.theme;
    // BGM：原版 id 100-106 或自定义 id（先加载 customBgm 再判断）
    state.customBgm = data.customBgm || [];
    state.customSfx = data.customSfx || [];
    var bgmId = data.bgm | 0;
    var isOrig = BGM_VALID.indexOf(bgmId) >= 0;
    var isCustom = state.customBgm.some(function (b) { return b.id === bgmId; });
    if (isOrig || isCustom) state.bgm = bgmId;
    else if (bgmFromEl != null) state.bgm = bgmFromEl;
    state.nextLevel = data.nextLevel || { end: false, id: null };
    state.hintTexts = data.hintTexts || {};
    colsInput.value = state.cols;
    document.getElementById('themeSel').value = state.theme;
    updateBgmCard();
    // 给没有 img 的 vector 元素生成缩略图 dataUrl
    CAT.ELEMENTS.forEach(function (d) {
      if (!d.img && !d.dataUrl && (d.id === 'pipe_mouth' || d.id === 'pipe_cross' || d.id === 'pipe_tee' || d.id === 'pipe_L_a' || d.id === 'pipe_L_b')) {
        d.dataUrl = drawVectorThumb(d);
      }
    });
    rebuildPalette();
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
          cols: state.cols, theme: state.theme, bgm: state.bgm, nextLevel: state.nextLevel, hintTexts: state.hintTexts,
          customBgm: state.customBgm, customSfx: state.customSfx,
          grid: state.grid, elements: state.elements
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
    var E = [{"id":"block_ground_top","col":0,"row":13},{"id":"block_ground_fill","col":0,"row":14},{"id":"bg_hill_house","col":1,"row":10},{"id":"block_ground_top","col":1,"row":13},{"id":"block_ground_fill","col":1,"row":14},{"id":"block_ground_top","col":2,"row":13},{"id":"block_ground_fill","col":2,"row":14},{"id":"block_ground_top","col":3,"row":13},{"id":"block_ground_fill","col":3,"row":14},{"id":"block_ground_top","col":4,"row":13},{"id":"block_ground_fill","col":4,"row":14},{"id":"block_ground_top","col":5,"row":13},{"id":"block_ground_fill","col":5,"row":14},{"id":"bg_cloud_face","col":6,"row":3},{"id":"block_ground_top","col":6,"row":13},{"id":"block_ground_fill","col":6,"row":14},{"id":"block_ground_top","col":7,"row":13},{"id":"block_ground_fill","col":7,"row":14},{"id":"block_ground_top","col":8,"row":13},{"id":"block_ground_fill","col":8,"row":14},{"id":"block_ground_top","col":9,"row":13},{"id":"block_ground_fill","col":9,"row":14},{"id":"enemy_syobon","col":10,"row":12},{"id":"block_ground_top","col":10,"row":13},{"id":"block_ground_fill","col":10,"row":14},{"id":"block_ground_top","col":11,"row":13},{"id":"block_ground_fill","col":11,"row":14},{"id":"block_brick","col":12,"row":9},{"id":"block_ground_top","col":12,"row":13},{"id":"block_ground_fill","col":12,"row":14},{"id":"block_hidden","col":13,"row":10},{"id":"block_ground_top","col":13,"row":13},{"id":"block_ground_fill","col":13,"row":14},{"id":"block_brick","col":14,"row":9},{"id":"block_ground_top","col":14,"row":13},{"id":"block_ground_fill","col":14,"row":14},{"id":"block_question","col":15,"row":9},{"id":"block_ground_top","col":15,"row":13},{"id":"block_ground_fill","col":15,"row":14},{"id":"block_brick","col":16,"row":9},{"id":"enemy_syobon","col":16,"row":12},{"id":"block_ground_top","col":16,"row":13},{"id":"block_ground_fill","col":16,"row":14},{"id":"block_ground_top","col":17,"row":13},{"id":"block_ground_fill","col":17,"row":14},{"id":"block_ground_top","col":18,"row":13},{"id":"block_ground_fill","col":18,"row":14},{"id":"bg_grass","col":19,"row":12},{"id":"block_ground_top","col":19,"row":13},{"id":"block_ground_fill","col":19,"row":14},{"id":"pipe_mouth","col":20,"row":10,"length":2,"dir":"up","entry":"none"},{"id":"pipe_mouth","col":29,"row":9,"length":3,"dir":"up","entry":"trap"},{"id":"block_ground_top","col":20,"row":13},{"id":"block_ground_fill","col":20,"row":14},{"id":"block_ground_top","col":21,"row":13},{"id":"block_ground_fill","col":21,"row":14},{"id":"bg_cloud_face","col":22,"row":2},{"id":"block_ground_top","col":22,"row":13},{"id":"block_ground_fill","col":22,"row":14},{"id":"block_ground_top","col":23,"row":13},{"id":"block_ground_fill","col":23,"row":14},{"id":"block_ground_top","col":24,"row":13},{"id":"block_ground_fill","col":24,"row":14},{"id":"block_ground_top","col":25,"row":13},{"id":"block_ground_fill","col":25,"row":14},{"id":"bg_grass","col":26,"row":12},{"id":"block_ground_top","col":26,"row":13},{"id":"block_ground_fill","col":26,"row":14},{"id":"block_ground_top","col":27,"row":13},{"id":"block_ground_fill","col":27,"row":14},{"id":"block_ground_top","col":28,"row":13},{"id":"block_ground_fill","col":28,"row":14},{"id":"block_ground_top","col":29,"row":13},{"id":"block_ground_fill","col":29,"row":14},{"id":"block_ground_top","col":30,"row":13},{"id":"block_ground_fill","col":30,"row":14},{"id":"block_ground_top","col":31,"row":13},{"id":"block_ground_fill","col":31,"row":14},{"id":"block_ground_top","col":32,"row":13},{"id":"block_ground_fill","col":32,"row":14},{"id":"bg_hill_house","col":33,"row":10},{"id":"block_ground_top","col":33,"row":13},{"id":"block_ground_fill","col":33,"row":14},{"id":"block_ground_top","col":34,"row":13},{"id":"block_ground_fill","col":34,"row":14},{"id":"block_ground_top","col":35,"row":13},{"id":"block_ground_fill","col":35,"row":14},{"id":"block_ground_top","col":36,"row":13},{"id":"block_ground_fill","col":36,"row":14},{"id":"block_ground_top","col":37,"row":13},{"id":"block_ground_fill","col":37,"row":14},{"id":"block_ground_top","col":38,"row":13},{"id":"block_ground_fill","col":38,"row":14},{"id":"block_ground_top","col":39,"row":13},{"id":"block_ground_fill","col":39,"row":14},{"id":"block_hidden","col":40,"row":9},{"id":"block_ground_top","col":43,"row":13},{"id":"block_ground_fill","col":43,"row":14},{"id":"block_ground_top","col":44,"row":13},{"id":"block_ground_fill","col":44,"row":14},{"id":"block_ground_top","col":45,"row":13},{"id":"block_ground_fill","col":45,"row":14},{"id":"block_brick","col":46,"row":9},{"id":"bg_grass","col":46,"row":12},{"id":"block_ground_top","col":46,"row":13},{"id":"block_ground_fill","col":46,"row":14},{"id":"block_ground_top","col":47,"row":13},{"id":"block_ground_fill","col":47,"row":14},{"id":"enemy_syobon","col":48,"row":7},{"id":"block_brick","col":48,"row":9},{"id":"block_ground_top","col":48,"row":13},{"id":"block_ground_fill","col":48,"row":14},{"id":"block_ground_top","col":49,"row":13},{"id":"block_ground_fill","col":49,"row":14},{"id":"block_ground_top","col":50,"row":13},{"id":"block_ground_fill","col":50,"row":14},{"id":"block_ground_top","col":51,"row":13},{"id":"block_ground_fill","col":51,"row":14},{"id":"enemy_syobon","col":52,"row":3},{"id":"block_brick","col":52,"row":5},{"id":"block_ground_top","col":52,"row":13},{"id":"block_ground_fill","col":52,"row":14},{"id":"block_brick","col":53,"row":5},{"id":"block_ground_top","col":53,"row":13},{"id":"block_ground_fill","col":53,"row":14},{"id":"block_brick","col":57,"row":5},{"id":"block_ground_top","col":57,"row":13},{"id":"block_ground_fill","col":57,"row":14},{"id":"block_brick","col":58,"row":5},{"id":"block_ground_top","col":58,"row":13},{"id":"block_ground_fill","col":58,"row":14},{"id":"block_brick","col":59,"row":5},{"id":"block_ground_top","col":59,"row":13},{"id":"block_ground_fill","col":59,"row":14},{"id":"block_ground_top","col":60,"row":13},{"id":"block_ground_fill","col":60,"row":14},{"id":"enemy_syobon","col":61,"row":12},{"id":"block_ground_top","col":61,"row":13},{"id":"block_ground_fill","col":61,"row":14},{"id":"block_ground_top","col":62,"row":13},{"id":"block_ground_fill","col":62,"row":14},{"id":"enemy_syobon","col":63,"row":12},{"id":"block_ground_top","col":63,"row":13},{"id":"block_ground_fill","col":63,"row":14},{"id":"bg_cloud_face","col":64,"row":1},{"id":"block_ground_top","col":64,"row":13},{"id":"block_ground_fill","col":64,"row":14},{"id":"block_ground_top","col":65,"row":13},{"id":"block_ground_fill","col":65,"row":14},{"id":"bg_midflag","col":66,"row":7},{"id":"block_brick","col":66,"row":9},{"id":"enemy_turtle","col":66,"row":12},{"id":"block_ground_top","col":66,"row":13},{"id":"block_ground_fill","col":66,"row":14},{"id":"block_ground_top","col":67,"row":13},{"id":"block_ground_fill","col":67,"row":14},{"id":"block_ground_top","col":68,"row":13},{"id":"block_ground_fill","col":68,"row":14},{"id":"block_ground_top","col":69,"row":13},{"id":"block_ground_fill","col":69,"row":14},{"id":"block_ground_top","col":70,"row":13},{"id":"block_ground_fill","col":70,"row":14},{"id":"block_question","col":71,"row":9},{"id":"block_ground_top","col":71,"row":13},{"id":"block_ground_fill","col":71,"row":14},{"id":"block_question","col":74,"row":5},{"id":"block_question","col":74,"row":9},{"id":"block_question","col":77,"row":9},{"id":"block_ground_top","col":77,"row":13},{"id":"block_ground_fill","col":77,"row":14},{"id":"bg_grass","col":78,"row":12},{"id":"block_ground_top","col":78,"row":13},{"id":"block_ground_fill","col":78,"row":14},{"id":"block_ground_top","col":79,"row":13},{"id":"block_ground_fill","col":79,"row":14},{"id":"block_ground_top","col":80,"row":13},{"id":"block_ground_fill","col":80,"row":14},{"id":"block_ground_top","col":81,"row":13},{"id":"block_ground_fill","col":81,"row":14},{"id":"block_stair","col":82,"row":12},{"id":"block_ground_top","col":82,"row":13},{"id":"block_ground_fill","col":82,"row":14},{"id":"block_stair","col":83,"row":11},{"id":"block_stair","col":83,"row":12},{"id":"block_ground_top","col":83,"row":13},{"id":"block_ground_fill","col":83,"row":14},{"id":"block_stair","col":84,"row":10},{"id":"block_stair","col":84,"row":11},{"id":"block_stair","col":84,"row":12},{"id":"block_ground_top","col":84,"row":13},{"id":"block_ground_fill","col":84,"row":14},{"id":"block_stair","col":88,"row":10},{"id":"block_stair","col":88,"row":11},{"id":"block_stair","col":88,"row":12},{"id":"block_ground_top","col":88,"row":13},{"id":"block_ground_fill","col":88,"row":14},{"id":"block_hidden","col":89,"row":6},{"id":"block_stair","col":89,"row":11},{"id":"block_stair","col":89,"row":12},{"id":"block_ground_top","col":89,"row":13},{"id":"block_ground_fill","col":89,"row":14},{"id":"block_hidden","col":90,"row":10},{"id":"block_ground_top","col":90,"row":13},{"id":"block_ground_fill","col":90,"row":14},{"id":"block_hidden","col":91,"row":10},{"id":"block_ground_top","col":91,"row":13},{"id":"block_ground_fill","col":91,"row":14},{"id":"block_hidden","col":92,"row":10},{"id":"block_ground_top","col":92,"row":13},{"id":"block_ground_fill","col":92,"row":14},{"id":"block_hidden","col":93,"row":10},{"id":"block_ground_top","col":93,"row":13},{"id":"block_ground_fill","col":93,"row":14},{"id":"block_hidden","col":94,"row":10},{"id":"pipe_mouth","col":95,"row":10,"length":2,"dir":"up","entry":"none"},{"id":"block_ground_top","col":95,"row":13},{"id":"block_ground_fill","col":95,"row":14},{"id":"block_ground_top","col":96,"row":13},{"id":"block_ground_fill","col":96,"row":14},{"id":"block_ground_top","col":97,"row":13},{"id":"block_ground_fill","col":97,"row":14},{"id":"block_ground_top","col":98,"row":13},{"id":"block_ground_fill","col":98,"row":14},{"id":"block_brick","col":99,"row":9},{"id":"block_ground_top","col":99,"row":13},{"id":"block_ground_fill","col":99,"row":14},{"id":"block_brick","col":100,"row":9},{"id":"block_ground_top","col":100,"row":13},{"id":"block_ground_fill","col":100,"row":14},{"id":"block_question","col":101,"row":9},{"id":"enemy_syobon","col":101,"row":12},{"id":"block_ground_top","col":101,"row":13},{"id":"block_ground_fill","col":101,"row":14},{"id":"block_brick","col":102,"row":9},{"id":"block_ground_top","col":102,"row":13},{"id":"block_ground_fill","col":102,"row":14},{"id":"enemy_syobon","col":103,"row":12},{"id":"block_ground_top","col":103,"row":13},{"id":"block_ground_fill","col":103,"row":14},{"id":"block_ground_top","col":104,"row":13},{"id":"block_ground_fill","col":104,"row":14},{"id":"block_ground_top","col":105,"row":13},{"id":"block_ground_fill","col":105,"row":14},{"id":"pipe_mouth","col":106,"row":11,"length":1,"dir":"up","entry":"none"},{"id":"block_ground_top","col":106,"row":13},{"id":"block_ground_fill","col":106,"row":14},{"id":"block_ground_top","col":107,"row":13},{"id":"block_ground_fill","col":107,"row":14},{"id":"block_stair","col":108,"row":12},{"id":"block_ground_top","col":108,"row":13},{"id":"block_ground_fill","col":108,"row":14},{"id":"block_stair","col":109,"row":11},{"id":"block_stair","col":109,"row":12},{"id":"block_ground_top","col":109,"row":13},{"id":"block_ground_fill","col":109,"row":14},{"id":"block_stair","col":110,"row":10},{"id":"block_stair","col":110,"row":11},{"id":"block_stair","col":110,"row":12},{"id":"block_ground_top","col":110,"row":13},{"id":"block_ground_fill","col":110,"row":14},{"id":"block_stair","col":111,"row":9},{"id":"block_stair","col":111,"row":10},{"id":"block_stair","col":111,"row":11},{"id":"block_stair","col":111,"row":12},{"id":"block_ground_top","col":111,"row":13},{"id":"block_ground_fill","col":111,"row":14},{"id":"block_stair","col":112,"row":8},{"id":"block_stair","col":112,"row":9},{"id":"block_stair","col":112,"row":10},{"id":"block_stair","col":112,"row":11},{"id":"block_stair","col":112,"row":12},{"id":"block_ground_top","col":112,"row":13},{"id":"block_ground_fill","col":112,"row":14},{"id":"block_stair","col":113,"row":7},{"id":"block_stair","col":113,"row":8},{"id":"block_stair","col":113,"row":9},{"id":"block_stair","col":113,"row":10},{"id":"block_stair","col":113,"row":11},{"id":"block_stair","col":113,"row":12},{"id":"block_ground_top","col":113,"row":13},{"id":"block_ground_fill","col":113,"row":14},{"id":"block_stair","col":114,"row":6},{"id":"block_stair","col":114,"row":7},{"id":"block_stair","col":114,"row":8},{"id":"block_stair","col":114,"row":9},{"id":"block_stair","col":114,"row":10},{"id":"block_stair","col":114,"row":11},{"id":"block_stair","col":114,"row":12},{"id":"block_ground_top","col":114,"row":13},{"id":"block_ground_fill","col":114,"row":14},{"id":"block_stair","col":115,"row":5},{"id":"block_stair","col":115,"row":6},{"id":"block_stair","col":115,"row":7},{"id":"block_stair","col":115,"row":8},{"id":"block_stair","col":115,"row":9},{"id":"block_stair","col":115,"row":10},{"id":"block_stair","col":115,"row":11},{"id":"block_stair","col":115,"row":12},{"id":"block_ground_top","col":115,"row":13},{"id":"block_ground_fill","col":115,"row":14},{"id":"block_stair","col":116,"row":5},{"id":"block_stair","col":116,"row":6},{"id":"block_stair","col":116,"row":7},{"id":"block_stair","col":116,"row":8},{"id":"block_stair","col":116,"row":9},{"id":"block_stair","col":116,"row":10},{"id":"block_stair","col":116,"row":11},{"id":"block_stair","col":116,"row":12},{"id":"block_ground_top","col":116,"row":13},{"id":"block_ground_fill","col":116,"row":14},{"id":"block_ground_top","col":117,"row":13},{"id":"block_ground_fill","col":117,"row":14},{"id":"block_ground_top","col":118,"row":13},{"id":"block_ground_fill","col":118,"row":14},{"id":"block_ground_top","col":119,"row":13},{"id":"block_ground_fill","col":119,"row":14},{"id":"block_ground_top","col":120,"row":13},{"id":"block_ground_fill","col":120,"row":14},{"id":"block_ground_top","col":121,"row":13},{"id":"block_ground_fill","col":121,"row":14},{"id":"block_ground_top","col":122,"row":13},{"id":"block_ground_fill","col":122,"row":14},{"id":"goal_pole","col":123,"row":2},{"id":"block_stair","col":123,"row":12},{"id":"block_ground_top","col":123,"row":13},{"id":"block_ground_fill","col":123,"row":14},{"id":"bg_grass","col":124,"row":12},{"id":"block_ground_top","col":124,"row":13},{"id":"block_ground_fill","col":124,"row":14},{"id":"block_ground_top","col":125,"row":13},{"id":"block_ground_fill","col":125,"row":14},{"id":"block_ground_top","col":126,"row":13},{"id":"block_ground_fill","col":126,"row":14},{"id":"block_ground_top","col":127,"row":13},{"id":"block_ground_fill","col":127,"row":14},{"id":"bg_tree","col":128,"row":10},{"id":"block_ground_top","col":128,"row":13},{"id":"block_ground_fill","col":128,"row":14},{"id":"block_ground_top","col":129,"row":13},{"id":"block_ground_fill","col":129,"row":14},{"id":"block_q_mushroom","col":8,"row":9},{"id":"block_q_poison","col":13,"row":9},{"id":"block_q_enemy","col":14,"row":5},{"id":"block_q_badstar","col":35,"row":8},{"id":"block_q_poison_mass","col":47,"row":9},{"id":"block_q_coin_mass","col":59,"row":9},{"id":"block_q_badstar","col":67,"row":9},{"id":"enemy_syobon","col":27,"row":9},{"id":"enemy_cloud_face","col":103,"row":5},{"id":"player_start","col":1,"row":12},{"id":"bgm_field","col":0,"row":0}];
    loadData({ cols: 130, theme: "overworld", elements: E });
    hintEl.textContent = "已载入原版 1-1 示例关卡：共 350 个元素，130 列";
    scroller.scrollLeft = 0;
  }

  // ---------- 调试接口：元素实例 uid 查询 ----------
  // __els()           列出全关元素摘要 [{uid,type,name,col,row}]
  // __els('e7')       按 uid 查单个元素完整数据（深拷贝，可直接改而不影响编辑器）
  // __els('block_brick', true)  第二参 true 时按“类型 id”过滤
  window.__els = function (q, byType) {
    if (q === undefined || q === null) {
      return state.elements.map(function (e) {
        var d = CAT.byId(e.id);
        return { uid: e.uid, type: e.id, name: d ? d.name : '?', col: e.col, row: e.row };
      });
    }
    var hits = state.elements.filter(function (e) {
      return byType ? (e.id === q) : (e.uid === q);
    });
    if (!hits.length) return null;
    return byType ? hits.map(function (e) { return JSON.parse(JSON.stringify(e)); })
                  : JSON.parse(JSON.stringify(hits[0]));
  };

  // ---------- 初始化 ----------
  buildPalette();
  updateTileSize();   // 首次计算响应式 tile 大小
  renderGutter();
  colsInput.value = state.cols;
  document.getElementById('gridBtn').classList.add('active');
  if (!restore()) {
    if (window.STAGES && window.STAGES.length) loadWorld(window.STAGES[0]);
    else loadDemo();
  } else {
    requestRender();
  }
})();
