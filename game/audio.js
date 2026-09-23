// ===================================================================
// 音频系统 - BGM + 音效
// http(s) 部署（GitHub Pages 等）：Web Audio API 预解码 AudioBuffer，
//   页面加载即后台预取全部音效/BGM，播放零网络等待、近零延迟，
//   解决 HTMLAudioElement 首播需取流导致的"音频滞后于画面"
// file:// 本地打开：fetch 被浏览器禁止，自动退回 HTMLAudioElement 池
// ===================================================================
(function (global) {
  'use strict';

  var C = global.Constants;
  var Audio = {};

  var currentBgm = 0;
  var muted = false;

  // ---------------- 文件映射 ----------------
  var BGM_FILES = {};
  BGM_FILES[C.BGM.FIELD] = 'field.mp3';
  BGM_FILES[C.BGM.DUNGEON] = 'dungeon.mp3';
  BGM_FILES[C.BGM.STAR] = 'star4.mp3';
  BGM_FILES[C.BGM.CASTLE] = 'castle.mp3';
  BGM_FILES[C.BGM.PUYO] = 'puyo.mp3';

  // 音效文件名（与 soundpatch.js SFX 表 / 原版 _soundplay case 一致）
  var SE_FILES = {
    1: 'jump.mp3',
    3: 'brockbreak.mp3',
    4: 'coin.mp3',
    5: 'humi.mp3',
    6: 'koura.mp3',
    7: 'dokan.mp3',
    8: 'brockkinoko.mp3',
    9: 'powerup.mp3',
    10: 'kirra.mp3',
    11: 'goal.mp3',
    12: 'death.mp3',
    13: 'Pswitch.mp3',
    14: 'jumpBlock.mp3',
    15: 'hintBlock.mp3',
    16: '4-clear.mp3',
    17: 'allclear.mp3',
    18: 'tekifire.mp3'
  };

  // 自定义 BGM/音效映射（id → dataUrl），由外部注入
  var customBgmMap = {};
  var customSfxMap = {};

  Audio.setCustomBgm = function (map) {
    customBgmMap = map || {};
    // 被自定义覆盖的 id 需重新解码；随后整体预取
    Object.keys(customBgmMap).forEach(function (k) {
      delete bgmBufs[k]; delete bgmTried[k]; delete bgmFailed[k]; delete pendingBgm[k];
    });
    preloadAll();
  };
  Audio.setCustomSfx = function (map) {
    customSfxMap = map || {};
    Object.keys(customSfxMap).forEach(function (k) {
      delete seBufs[k]; delete seTried[k]; delete seFailed[k]; delete pendingSe[k];
    });
    preloadAll();
  };

  // 获取 BGM URL：优先自定义 dataUrl，否则原版文件
  function getBgmUrl(id) {
    if (customBgmMap[id]) return customBgmMap[id];
    var file = BGM_FILES[id];
    return file ? C.RES.AUDIO_DIR + file : null;
  }
  // 获取音效 URL：优先自定义 dataUrl，否则原版文件
  function getSfxUrl(id) {
    if (customSfxMap[id]) return customSfxMap[id];
    var file = SE_FILES[id];
    return file ? C.RES.SE_DIR + file : null;
  }

  // ---------------- Web Audio（http/https 低延迟路径） ----------------
  var AC = global.AudioContext || global.webkitAudioContext;
  // file:// 下 fetch 被浏览器禁止，仅 http(s) 启用 Web Audio 路径
  var webAudioOk = !!AC && /^https?:$/.test(global.location.protocol);

  var ctx = null;
  var seGain = null;
  var bgmGain = null;
  var seBufs = {};    // id -> AudioBuffer
  var bgmBufs = {};   // id -> AudioBuffer
  var seTried = {};   // id -> 已发起解码（失败会移除以便重试）
  var bgmTried = {};
  var seFailed = {};  // id -> 解码失败（用于进度统计；不影响运行时重试）
  var bgmFailed = {};
  var pendingSe = {};   // id -> url，正在加载的音效
  var pendingBgm = {};  // id -> url，正在加载的 BGM
  var activeSe = {};  // id -> [BufferSource]，stopSe 切断用
  var seIdGain = {};  // id -> GainNode，每 id 自动缩混（N 路同播各 1/N）
  var bgmEl = null;   // 兜底路径的 BGM 元素
  var bgmSrc = null;
  var bgmBuf = null;          // 当前 BGM 的 buffer（挂起恢复用）
  var bgmStartCtxTime = 0;    // 当前源起播时的 ctx.currentTime
  var bgmStartOffset = 0;     // 当前源起播的 buffer 内偏移
  var suspendPos = 0;         // 挂起时的播放位置

  function ensureCtx() {
    if (!webAudioOk) return null;
    if (!ctx) {
      try {
        ctx = new AC();
        seGain = ctx.createGain();
        bgmGain = ctx.createGain();
        seGain.connect(ctx.destination);
        bgmGain.connect(ctx.destination);
        applyMute();
      } catch (e) { webAudioOk = false; return null; }
    }
    return ctx;
  }

  function applyMute() {
    if (ctx) {
      try {
        seGain.gain.value = muted ? 0 : 1;
        bgmGain.gain.value = muted ? 0 : 0.5;
      } catch (e) {}
    }
    if (bgmEl) {
      try { bgmEl.volume = muted ? 0 : 0.5; bgmEl.muted = muted; } catch (e) {}
    }
  }

  function decodeBuf(url, cb) {
    var c = ensureCtx();
    if (!c) { cb(new Error('no webaudio')); return; }
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (ab) {
      // 兼容旧式回调 API（iOS Safari）
      c.decodeAudioData(ab, function (buf) { cb(null, buf); },
        function () { cb(new Error('decode fail')); });
    }).catch(function (e) { cb(e); });
  }

  // 取音效 buffer：已缓存直接返回；未解码则异步解码并返回 null（本次兜底播放）
  function getSeBuffer(id) {
    if (seBufs[id]) return seBufs[id];
    if (!webAudioOk || seTried[id]) return null;
    var url = getSfxUrl(id);
    if (!url) return null;
    seTried[id] = true;
    pendingSe[id] = url;
    decodeBuf(url, function (err, buf) {
      delete pendingSe[id];
      if (err) { delete seTried[id]; seFailed[id] = true; return; }
      seBufs[id] = buf;
    });
    return null;
  }

  function getBgmBuffer(id, cb) {
    if (bgmBufs[id]) { if (cb) cb(null, bgmBufs[id]); return bgmBufs[id]; }
    if (!webAudioOk || bgmTried[id]) { if (cb) cb(new Error('no buffer')); return null; }
    var url = getBgmUrl(id);
    if (!url) { if (cb) cb(new Error('no url')); return null; }
    bgmTried[id] = true;
    pendingBgm[id] = url;
    decodeBuf(url, function (err, buf) {
      delete pendingBgm[id];
      if (err) { delete bgmTried[id]; bgmFailed[id] = true; if (cb) cb(err); return; }
      bgmBufs[id] = buf;
      if (cb) cb(null, buf);
    });
    return null;
  }

  // 页面加载即后台预取全部音效/BGM（fetch 无需用户手势，仅播放需要解锁）
  function preloadAll() {
    if (!webAudioOk) return;
    Object.keys(SE_FILES).forEach(function (k) { getSeBuffer(+k); });
    Object.keys(customSfxMap).forEach(function (k) { getSeBuffer(+k); });
    Object.keys(BGM_FILES).forEach(function (k) { getBgmBuffer(+k); });
    Object.keys(customBgmMap).forEach(function (k) { getBgmBuffer(+k); });
  }

  function playSeWeb(id, buf) {
    var c = ensureCtx();
    if (!c) return;
    var list = activeSe[id] || (activeSe[id] = []);
    // 每 id 自动缩混：N 路同播时单源增益 = 1/N，叠加始终 ≤1.0 不削波。
    // 金币量产（ttype=113）每3帧播1次 coin.mp3（时长1.332s）峰值 ~20 路
    // 同播；若各 gain=1.0 则 sum=20.0 在 destination 处硬削波=破音。
    // 缩混后单发=1.0 满音量、20 路各 0.05 叠加=1.0，保留层叠听感不破音
    var g = seIdGain[id];
    if (!g) { g = c.createGain(); g.connect(seGain); seIdGain[id] = g; }
    var src = c.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    list.push(src);
    g.gain.setTargetAtTime(1 / list.length, c.currentTime, 0.005);
    src.onended = function () {
      var j = list.indexOf(src);
      if (j >= 0) list.splice(j, 1);
      var n = list.length;
      g.gain.setTargetAtTime(n > 0 ? 1 / n : 1, c.currentTime, 0.005);
    };
    if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
    src.start(0);
  }

  // ---------------- HTMLAudioElement 兜底池（file:// / 解码未就绪） ----------------
  var POOL_SIZE = 8;
  var sePools = {};

  function getSePool(id) {
    if (!sePools[id]) sePools[id] = [];
    return sePools[id];
  }

  function playSeFile(id) {
    if (muted) return;
    var url = getSfxUrl(id);
    if (!url) return;
    var pool = getSePool(id);
    var el = null;
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].paused || pool[i].ended) { el = pool[i]; break; }
    }
    if (!el) {
      if (pool.length >= POOL_SIZE) el = pool.shift();
      else el = new window.Audio();
      pool.push(el);
    }
    if (el.src !== url) el.src = url;
    el.currentTime = 0;
    var pr = el.play();
    if (pr && pr.catch) pr.catch(function () {});
  }

  function startBgmLegacy(url) {
    bgmEl = new window.Audio();
    bgmEl.src = url;
    bgmEl.loop = true;
    bgmEl.volume = muted ? 0 : 0.5;
    try { bgmEl.muted = muted; } catch (e) {}
    var pr = bgmEl.play();
    if (pr && pr.catch) pr.catch(function () {});
  }

  // ---------------- 对外 API ----------------
  Audio.mute = function () {
    muted = !muted;
    applyMute();
    return muted;
  };

  Audio.isMuted = function () { return muted; };

  Audio.init = function () {
    preloadAll();
  };

  // 加载进度查询：返回 {loaded, total, disabled, current}
  // - disabled=true 表示 Web Audio 不可用（file:// 协议），无预解码任务
  // - current = 最后一个发起但未完成的文件 URL（优先 BGM，因为文件较大更耗时）
  // - 失败（seFailed/bgmFailed）的 id 计入 loaded，确保进度条能到 100%
  Audio.getProgress = function () {
    if (!webAudioOk) return { loaded: 0, total: 0, disabled: true, current: null };
    var seTotal = Object.keys(SE_FILES).length + Object.keys(customSfxMap).length;
    var bgmTotal = Object.keys(BGM_FILES).length + Object.keys(customBgmMap).length;
    var seLoaded = 0, bgmLoaded = 0, k;
    for (k in SE_FILES) { if (seBufs[+k] || seFailed[+k]) seLoaded++; }
    for (k in customSfxMap) { if (seBufs[+k] || seFailed[+k]) seLoaded++; }
    for (k in BGM_FILES) { if (bgmBufs[+k] || bgmFailed[+k]) bgmLoaded++; }
    for (k in customBgmMap) { if (bgmBufs[+k] || bgmFailed[+k]) bgmLoaded++; }
    // 优先返回 BGM 中正在加载的文件（文件大、耗时更明显）
    var current = null;
    var bgmKeys = Object.keys(pendingBgm);
    if (bgmKeys.length) current = pendingBgm[bgmKeys[bgmKeys.length - 1]];
    else {
      var seKeys = Object.keys(pendingSe);
      if (seKeys.length) current = pendingSe[seKeys[seKeys.length - 1]];
    }
    return { loaded: seLoaded + bgmLoaded, total: seTotal + bgmTotal, disabled: false, current: current };
  };

  Audio.unlock = function () {
    // 浏览器要求用户交互后才能播放音频
    if (webAudioOk) {
      var c = ensureCtx();
      if (c && c.state === 'suspended') { try { c.resume(); } catch (e) {} }
    }
    try {
      var unlockEl = new window.Audio();
      unlockEl.play().catch(function () {});
    } catch (e) {}
  };

  Audio.playSE = function (id) {
    if (muted) return;
    var buf = webAudioOk ? getSeBuffer(id) : null;
    if (buf) { playSeWeb(id, buf); return; }
    playSeFile(id); // file:// 或缓冲未就绪时兜底；解码完成后自动走低延迟路径
  };

  // 停止指定音效（Web Audio 活动源 + 兜底池一并切断）。
  // 不传 id 时停止所有音效。用于阵亡时切断终点/通关等长曲目
  // （goal.mp3、4-clear.mp3 等走音效池播放，bgmStop 停不掉）。
  Audio.stopSe = function (id) {
    Object.keys(activeSe).forEach(function (k) {
      if (id !== undefined && id !== null && Number(k) !== Number(id)) return;
      var list = activeSe[k];
      list.slice().forEach(function (src) {
        try { src.onended = null; src.stop(); src.disconnect(); } catch (e) {}
      });
      activeSe[k] = [];
    });
    Object.keys(sePools).forEach(function (k) {
      if (id !== undefined && id !== null && Number(k) !== Number(id)) return;
      var pool = sePools[k];
      for (var i = 0; i < pool.length; i++) {
        try { pool[i].pause(); pool[i].currentTime = 0; } catch (e) {}
      }
    });
  };

  // ---------------- BGM ----------------
  function stopBgmWeb() {
    if (bgmSrc) {
      try { bgmSrc.onended = null; bgmSrc.stop(); bgmSrc.disconnect(); } catch (e) {}
      bgmSrc = null;
    }
  }

  function startBgmWeb(buf, offset) {
    var c = ensureCtx();
    if (!c) return false;
    stopBgmWeb();
    bgmBuf = buf;
    bgmSrc = c.createBufferSource();
    bgmSrc.buffer = buf;
    bgmSrc.loop = true;
    bgmSrc.connect(bgmGain);
    var d = buf.duration || 1;
    bgmStartOffset = ((offset || 0) % d + d) % d;
    bgmStartCtxTime = c.currentTime;
    if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
    bgmSrc.start(0, bgmStartOffset);
    return true;
  }

  function bgmWebPos() {
    if (!bgmSrc || !bgmBuf) return 0;
    var d = bgmBuf.duration || 1;
    return (bgmStartOffset + (ctx.currentTime - bgmStartCtxTime)) % d;
  }

  Audio.bgmChange = function (id) {
    if (currentBgm === id && (bgmSrc || bgmEl)) return;
    currentBgm = id;
    var url = getBgmUrl(id);
    if (!url) return;
    stopBgmWeb();
    if (bgmEl) { try { bgmEl.pause(); } catch (e) {} bgmEl = null; }
    suspendPos = 0;

    if (webAudioOk) {
      var buf = getBgmBuffer(id, function (err, b) {
        if (err || !b) { startBgmLegacy(url); return; } // 解码失败退兜底
        // 解码期间仍是当前曲且未被停止/切换，才起播
        if (currentBgm === id && !bgmSrc && !bgmEl) startBgmWeb(b, 0);
      });
      if (buf) startBgmWeb(buf, 0);
      return;
    }
    startBgmLegacy(url);
  };

  Audio.bgmStop = function () {
    stopBgmWeb();
    bgmBuf = null;
    suspendPos = 0;
    if (bgmEl) {
      try { bgmEl.pause(); bgmEl.currentTime = 0; } catch (e) {}
      bgmEl = null;
    }
  };

  Audio.bgmPlay = function (id) {
    if (id) currentBgm = id;
    Audio.bgmChange(currentBgm);
  };

  // 暂停游戏（P 键）时挂起 BGM，恢复时从原位置继续（不重置进度）
  Audio.bgmSuspend = function () {
    if (bgmSrc) { suspendPos = bgmWebPos(); stopBgmWeb(); }
    if (bgmEl) { try { bgmEl.pause(); } catch (e) {} }
  };
  Audio.bgmResume = function () {
    if (bgmSrc) return;
    if (bgmBuf) {
      if (startBgmWeb(bgmBuf, suspendPos)) { suspendPos = 0; return; }
    }
    if (bgmEl) {
      var pr = bgmEl.play();
      if (pr && pr.catch) pr.catch(function () {});
    }
  };

  global.AudioSys = Audio;

  // 脚本加载即开始后台预取解码（http/https）
  if (webAudioOk) preloadAll();
})(window);
