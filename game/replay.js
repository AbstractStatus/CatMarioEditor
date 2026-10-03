// ===================================================================
// 录像系统 - 种子随机 + 输入录制/确定性回放
//
// 原理（确定性录像 / deterministic replay）：
//   录像不存画面，只存每物理帧的玩家按键（1 字节）+ 少量帧间事件
//   （开局、作弊开关、宿主换关决策）+ 关卡数据快照。播放时用同一引擎、
//   同一随机种子、同一刷新率、同一镜头宽度，逐帧喂入按键，由引擎重新
//   模拟并渲染，画面与镜头即与录制时一致。
//
// 本模块不持有引擎私有状态：引擎在加载时通过 bindApi 注入闭包
// （state/externalStart/backToTitle/setFps/getFps），并在物理帧、
// loadStage、宿主钩子等固定位置调用本模块的钩子函数。
//
// 文件格式（JSON，自包含关卡数据）：
//   { app, ver, engineVer, fps, seed, viewW, meta,
//     stages:[def...], stageSeq:[idx...],
//     events:[[frame,type,data]...], frames:"<base64 每物理帧1字节>" }
//   帧字节：低 6 位=按键掩码(1左2右4下8上16跳32点击)，bit6=O 自杀
// ===================================================================
(function (global) {
  'use strict';

  // ==================== 种子随机（mulberry32） ====================
  // 所有玩法相关随机必须走 GameRand，禁止再用 Math.random
  // （engine.js oldRand/_randomizeElements/火焰棒初相/机器人相遇、
  //   elements.js 喷火管初速）。非录制/播放时用时间种子，行为与
  // 原先 Math.random 等价（每局不同）。
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function timeSeed() {
    return ((Date.now() & 0xffffffff) ^ ((Math.random() * 0x100000000) | 0)) >>> 0;
  }

  var GameRand = {
    _r: mulberry32(timeSeed()),
    // 重设种子（录制开始 / 播放开始）
    seed: function (s) { this._r = mulberry32(s >>> 0); },
    // [0,1) 浮点
    next: function () { return this._r(); },
    // 0..n-1 整数（与旧引擎 getrand(n)=floor(rand*n)、(rand*n)|0 等价）
    int: function (n) { return (this._r() * n) | 0; }
  };

  // ==================== 工具 ====================
  // cyrb53：关卡 def 去重哈希（死亡复活重复载入同一关不重复存盘）
  function cyrb53(str, seed) {
    seed = seed || 0;
    var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), h1) ^ Math.imul(h2 ^ (h2 >>> 13), h2);
    h2 = Math.imul(h2 ^ (h2 >>> 16), h2) ^ Math.imul(h1 ^ (h1 >>> 13), h1);
    return 4294967296 * (2097152 & h2) + (h1 >>> 0);
  }

  function b64Encode(bytes) {
    var bin = '', CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return global.btoa(bin);
  }
  function b64Decode(str) {
    var bin = global.atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function clone(v) { return v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)); }

  // ==================== 常量 ====================
  var APP = 'catmario-replay';
  var VER = 1;
  var ENGINE_VER = 'rep1';
  var KEY_MASK = 0x3f;
  var SUICIDE_BIT = 0x40;

  // 模式：off=未启用 record=录制中 recorded=录制完成(待下载)
  //       play=播放中 ended=播放结束 error=播放失败
  var mode = 'off';
  var errorMsg = '';
  var api = null;

  // ---- 录制状态 ----
  var recFrames = [];           // 每物理帧 1 字节
  var recEvents = [];           // [f,type,data]
  var recStageHashes = [];      // 每次 loadStage 的 def 哈希
  var stageStore = new Map();   // hash -> def（JSON 克隆）
  var recStarted = false;
  var recStartFrame = -1;
  var recEndFrame = -1;
  var extQueue = [];            // 帧间外部开局事件，下一帧 preFrame 落账
  var extThisFrame = false;
  var recHookNo = { warp: 0, goal: 0 };
  var recordSeed = 0, recordFps = 60, recordMeta = null;
  var lastRecCheat = false;
  var playSuicide = false;
  // 录制/播放期锁定的虚拟镜头宽（FXMAX 参与物理，录制与播放必须一致）。
  // 录制时取录制开始那一刻的当前宽度，存进文件 viewW；播放时锁到文件里的
  // 宽度——这样录制不会让玩家的画面突然变化，播放端无论窗口多大都能还原。
  var lockedViewW = 0;

  // ---- 播放状态 ----
  var playFile = null;
  var playBytes = new Uint8Array(0);
  var playEvents = {};          // f -> [{t,d}]
  var playStageDefs = [];
  var playStageSeq = [];
  var playStagePtr = 0;
  var playPos = 0;
  var playHookNo = { warp: 0, goal: 0 };
  var prevFps = 60;

  function S() { return api.state(); }
  // 锁宽状态变化时通知引擎重算 FXMAX / 居中黑边
  function viewLock() { if (api && api.viewLock) api.viewLock(); }

  var GameReplay = {};

  // 引擎注入闭包
  GameReplay.bindApi = function (a) { api = a; };

  GameReplay.mode = function () { return mode; };
  GameReplay.lockViewW = function () {
    return ((mode === 'record' || mode === 'play') && lockedViewW > 0) ? lockedViewW : null;
  };

  // ==================== 录制 ====================
  GameReplay.beginRecord = function (meta) {
    if (mode === 'record' || mode === 'play') {
      return { ok: false, error: '已有录制/播放正在进行' };
    }
    if (S().proc !== 100) {
      return { ok: false, error: '只有在标题画面（游戏尚未开始）才能启动录制' };
    }
    recFrames = [];
    recEvents = [];
    recStageHashes = [];
    stageStore = new Map();
    recStarted = false;
    recStartFrame = -1;
    recEndFrame = -1;
    extQueue = [];
    extThisFrame = false;
    recHookNo = { warp: 0, goal: 0 };
    lastRecCheat = !!S().cheat;
    recordSeed = (meta && meta.seed != null) ? (meta.seed >>> 0) : timeSeed();
    recordFps = api.getFps();
    recordMeta = meta || {};
    // 锁定录制开始那一刻的镜头实际宽度（引擎 resizeCanvas 每帧同步
    // Constants.CANVAS_W），避免录制让画面突然变化
    var CC = global.Constants;
    lockedViewW = (CC && CC.CANVAS_W > 0) ? Math.round(CC.CANVAS_W) : 480;
    GameRand.seed(recordSeed);
    errorMsg = '';
    mode = 'record';
    viewLock();
    return { ok: true, seed: recordSeed };
  };

  // 引擎 Engine.startGame 包装器调用：外部（按钮/点击宿主）在帧间开局或重开
  GameReplay.externalStart = function () {
    if (mode !== 'record') return;
    var s = S();
    extQueue.push({
      ext: true,
      sta: s.sta, stb: s.stb, stc: s.stc,
      randomMode: !!s.randomMode, cheat: !!s.cheat
    });
  };

  // 每物理帧开头：返回本帧输入掩码
  GameReplay.preFrame = function (liveKey) {
    if (mode === 'record') {
      var f = recFrames.length;
      extThisFrame = extQueue.length > 0;
      while (extQueue.length) recEvents.push([f, 'start', extQueue.shift()]);
      recFrames.push(liveKey & KEY_MASK);
      // C 键作弊切换（键事件发生在帧间）：玩法相关，记为事件
      var ch = !!S().cheat;
      if (ch !== lastRecCheat) {
        lastRecCheat = ch;
        recEvents.push([f, 'cheat', { v: ch }]);
      }
      return liveKey & KEY_MASK;
    }
    if (mode === 'play') {
      var evs = playEvents[playPos];
      if (evs) {
        for (var i = 0; i < evs.length; i++) {
          var t = evs[i].t, d = evs[i].d, s = S();
          if (t === 'start') {
            s.sta = d.sta; s.stb = d.stb; s.stc = d.stc;
            s.randomMode = !!d.randomMode;
            s.cheat = !!d.cheat;
            if (d.ext) api.externalStart();   // 外部开局：帧前完成 beginNewGame
            // 按键开局（ext:false）：本帧返回的 key 会在 TITLE 分支自然触发 beginNewGame
          } else if (t === 'cheat') {
            s.cheat = !!d.v;
          }
        }
      }
      var b = playBytes[playPos];
      playSuicide = !!(b & SUICIDE_BIT);
      // 吞掉播放期真实 O 键，避免标志残留
      if (global.Input && global.Input.consumeSuicide) global.Input.consumeSuicide();
      return b & KEY_MASK;
    }
    return liveKey;
  };

  // 每物理帧内 updatePlayer 之前：O 键自杀请求
  GameReplay.suicide = function () {
    if (mode === 'record') {
      var v = global.Input && global.Input.consumeSuicide ? !!global.Input.consumeSuicide() : false;
      if (v) recFrames[recFrames.length - 1] |= SUICIDE_BIT;
      return v;
    }
    if (mode === 'play') return playSuicide;
    return global.Input && global.Input.consumeSuicide ? !!global.Input.consumeSuicide() : false;
  };

  // loadStage：录制侧截获关卡快照
  GameReplay.captureStage = function (def) {
    if (mode !== 'record') return;
    var json = JSON.stringify(def);
    var h = cyrb53(json);
    if (!stageStore.has(h)) stageStore.set(h, JSON.parse(json));
    recStageHashes.push(h);
  };

  // loadStage：播放侧按录制次序取关卡（绕过宿主 Levels.get）
  GameReplay.nextStage = function () {
    var idx = playStageSeq[playStagePtr];
    playStagePtr++;
    if (idx == null || !playStageDefs[idx]) {
      _fatal('关卡数据缺失（录像损坏或引擎版本不匹配），播放中止');
      return null;
    }
    return clone(playStageDefs[idx]);
  };

  // 宿主换关钩子（warp/goal/note 三处调用点）：
  // 录制=执行原逻辑并记录"决策+对引擎 state 的副作用"；
  // 播放=不回调宿主，直接复刻副作用（坐标/warpSpawn/回标题）。
  GameReplay.hostHook = function (kind, thunk) {
    if (mode === 'record') {
      var r = !!thunk();
      var s = S();
      recEvents.push([recFrames.length - 1, 'hook', {
        kind: kind, no: recHookNo[kind]++, r: r,
        ws: s.warpSpawn ? clone(s.warpSpawn) : null,
        sta: s.sta, stb: s.stb, stc: s.stc
      }]);
      return r;
    }
    if (mode === 'play') {
      var evs = playEvents[playPos] || [];
      var found = null;
      for (var i = 0; i < evs.length; i++) {
        var e = evs[i];
        if (e.t === 'hook' && e.d.kind === kind && e.d.no === playHookNo[kind]) { found = e.d; break; }
      }
      playHookNo[kind]++;
      if (!found) {
        _fatal('换关事件缺失（录像损坏或引擎版本不匹配），播放中止');
        return false;
      }
      var s2 = S();
      s2.sta = found.sta; s2.stb = found.stb; s2.stc = found.stc;
      s2.warpSpawn = found.ws ? clone(found.ws) : null;
      if (!found.r) api.backToTitle();
      return found.r;
    }
    return thunk();
  };

  // 每物理帧末尾
  GameReplay.postFrame = function () {
    if (mode === 'record') {
      var f = recFrames.length - 1;
      var s = S();
      if (!recStarted) {
        if (extThisFrame) {
          // 外部开局事件已在 preFrame 入账，仅标记起点
          recStarted = true; recStartFrame = f;
        } else if (s.proc !== 100) {
          // 标题按键开局（beginNewGame 在本帧 TITLE 分支内执行）
          recStarted = true; recStartFrame = f;
          recEvents.push([f, 'start', {
            ext: false,
            sta: s.sta, stb: s.stb, stc: s.stc,
            randomMode: !!s.randomMode, cheat: !!s.cheat
          }]);
        }
      } else if (s.proc === 100 && recEndFrame < 0) {
        // 通关回标题 / 宿主结局回标题：自动终局
        recEndFrame = f;
        mode = 'recorded';
        viewLock();
      }
      extThisFrame = false;
      return;
    }
    if (mode === 'play') {
      playPos++;
      if (playPos >= playBytes.length) _finishPlay();
    }
  };

  // 录制结束 → 产出录像文件（裁掉开局前的标题帧，事件帧号重基）
  GameReplay.stopRecord = function () {
    if (mode !== 'record' && mode !== 'recorded') {
      return { ok: false, error: '当前没有进行中的录制' };
    }
    var startEv = null;
    for (var i = 0; i < recEvents.length; i++) {
      if (recEvents[i][1] === 'start') { startEv = recEvents[i]; break; }
    }
    if (!startEv) {
      mode = 'off';
      viewLock();
      return { ok: false, error: '录像未包含开局（未开始游戏），已放弃' };
    }
    var startFrame = startEv[0];
    var endFrame = recEndFrame >= 0 ? recEndFrame : recFrames.length - 1;
    var bytes = recFrames.slice(startFrame, endFrame + 1);

    var events = [];
    for (var j = 0; j < recEvents.length; j++) {
      var e = recEvents[j];
      if (e[0] < startFrame || e[0] > endFrame) continue;
      events.push([e[0] - startFrame, e[1], e[2]]);
    }

    // stages：按首次出现顺序去重；stageSeq 与 loadStage 调用次序一一对应
    var defs = [], hashIdx = new Map();
    var stageSeq = [];
    for (var k = 0; k < recStageHashes.length; k++) {
      var h = recStageHashes[k];
      if (!hashIdx.has(h)) {
        hashIdx.set(h, defs.length);
        defs.push(stageStore.get(h));
      }
      stageSeq.push(hashIdx.get(h));
    }

    var file = {
      app: APP,
      ver: VER,
      engineVer: ENGINE_VER,
      fps: recordFps,
      seed: recordSeed,
      viewW: lockedViewW,
      meta: {
        date: recordMeta.date || new Date().toISOString(),
        name: recordMeta.name || '',
        durationFrames: bytes.length,
        startType: startEv[2].ext ? 'ext' : 'key'
      },
      stages: defs,
      stageSeq: stageSeq,
      events: events,
      frames: b64Encode(new Uint8Array(bytes))
    };
    mode = 'off';
    lockedViewW = 0;
    viewLock();
    return { ok: true, file: file };
  };

  // ==================== 播放 ====================
  GameReplay.startPlay = function (file) {
    if (mode === 'record' || mode === 'play') {
      return { ok: false, error: '已有录制/播放正在进行' };
    }
    if (!file || typeof file !== 'object') return { ok: false, error: '录像文件格式无效' };
    if (file.app !== APP) return { ok: false, error: '不是猫里奥录像文件' };
    if (file.ver !== VER) return { ok: false, error: '录像版本不兼容（ver=' + file.ver + '）' };
    if (file.fps !== 30 && file.fps !== 60 && file.fps !== 120) {
      return { ok: false, error: '录像刷新率无效（fps=' + file.fps + '）' };
    }
    if (typeof file.viewW !== 'number' || !isFinite(file.viewW) ||
        file.viewW < 420 || file.viewW > 4000) {
      return { ok: false, error: '录像镜头宽度无效（viewW=' + file.viewW + '）' };
    }
    if (!Array.isArray(file.stages) || !Array.isArray(file.stageSeq) ||
        !file.stageSeq.length || !file.stages.length) {
      return { ok: false, error: '录像缺少关卡数据' };
    }
    if (typeof file.frames !== 'string' || !file.frames.length) {
      return { ok: false, error: '录像缺少输入数据' };
    }
    var s = S();
    if (s.proc !== 100) return { ok: false, error: '请回到标题画面后再播放录像' };

    var bytes;
    try { bytes = b64Decode(file.frames); } catch (e) { return { ok: false, error: '录像输入数据损坏' }; }

    var startFound = false;
    playEvents = {};
    for (var i = 0; i < file.events.length; i++) {
      var ev = file.events[i];
      if (!Array.isArray(ev) || ev[0] < 0 || ev[0] >= bytes.length) {
        return { ok: false, error: '录像事件帧号越界' };
      }
      if (ev[1] === 'start') startFound = true;
      (playEvents[ev[0]] = playEvents[ev[0]] || []).push({ t: ev[1], d: ev[2] });
    }
    if (!startFound) return { ok: false, error: '录像缺少开局事件' };

    playFile = file;
    playBytes = bytes;
    playStageDefs = file.stages;
    playStageSeq = file.stageSeq;
    playStagePtr = 0;
    playPos = 0;
    playHookNo = { warp: 0, goal: 0 };
    playSuicide = false;
    errorMsg = '';
    prevFps = api.getFps();
    GameRand.seed(file.seed >>> 0);
    api.setFps(file.fps);
    // 锁到录像录制时的镜头宽度（旧文件为固定 480），与录制端物理一致
    lockedViewW = Math.round(file.viewW);
    mode = 'play';
    viewLock();
    return { ok: true, meta: file.meta || {} };
  };

  function _finishPlay() {
    mode = 'ended';
    lockedViewW = 0;
    api.backToTitle();
    api.setFps(prevFps);
    viewLock();
  }

  function _fatal(msg) {
    if (mode !== 'play') return;
    mode = 'error';
    errorMsg = msg;
    lockedViewW = 0;
    api.backToTitle();
    api.setFps(prevFps);
    viewLock();
  }
  GameReplay._fatal = _fatal;

  // 手动停止播放 / 清除错误状态
  GameReplay.stopPlay = function () {
    if (mode === 'play') {
      mode = 'off';
      lockedViewW = 0;
      api.backToTitle();
      api.setFps(prevFps);
      viewLock();
      return { ok: true };
    }
    if (mode === 'ended' || mode === 'error') { mode = 'off'; return { ok: true }; }
    return { ok: false, error: '当前没有播放中的录像' };
  };

  GameReplay.status = function () {
    if (mode === 'record') {
      return {
        mode: 'record',
        frames: recFrames.length,
        started: recStarted,
        startFrame: recStartFrame,
        fps: recordFps, seed: recordSeed
      };
    }
    if (mode === 'recorded') {
      return {
        mode: 'recorded',
        frames: (recEndFrame >= 0 ? recEndFrame : recFrames.length - 1) - recStartFrame + 1,
        fps: recordFps
      };
    }
    if (mode === 'play') {
      return { mode: 'play', pos: playPos, total: playBytes.length, fps: playFile.fps };
    }
    if (mode === 'ended') {
      return { mode: 'ended', total: playBytes.length, fps: prevFps };
    }
    if (mode === 'error') {
      return { mode: 'error', error: errorMsg, fps: prevFps };
    }
    return { mode: 'off' };
  };

  global.GameRand = GameRand;
  global.GameReplay = GameReplay;
})(window);
