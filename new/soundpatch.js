/* =====================================================================
 * 猫里奥 音效拆分补丁（纯 JS，不修改 catmario/ 任何原文件）
 *
 * 原理：
 *  原版引擎把所有音效打包在 snd/se1.mp3、snd/se2.mp3 两个长音频里，
 *  用 Web Audio 按 (起始偏移秒, 时长秒) 播放切片（见 catmario.js
 *  _soundplay：case1/3/4/5/6/7/8/9/10/11/12 来自 se1，13~18 来自 se2，
 *  调用 source.start(0, 偏移, 时长) 三参数；BGM 只传 1 个参数且 loop）。
 *
 *  补丁做两件事：
 *  1. 劫持 AudioBufferSourceNode.start：三参数调用且偏移/时长命中音效
 *     切片表时，不播原切片，改为用 HTMLAudio 播放 new/soundEffect/ 下
 *     的拆分 mp3（池化元素支持同名音效重叠播放）；stop 同样劫持以
 *     支持 soundstop（如玩家阵亡时 goal.mp3 停止）。
 *  2. 劫持 XMLHttpRequest：把引擎对 snd/se1.mp3、snd/se2.mp3 的请求
 *     替换为一段内联合成的静音 WAV，使 decodeAudioData 成功、引擎
 *     照常创建 source 节点交给第 1 步处理。这也是 file:// 直接打开
 *     网页时无声的根因——浏览器禁止 file:// 下的 XHR 读本地文件，
 *     audioBuffer 永远加载不出来；HTMLAudio 不受此限制。
 * ===================================================================== */
(function () {
  'use strict';

  var SE_DIR = new URL('soundEffect/', document.currentScript.src).href;

  /* ---- 音效表：[偏移秒, 时长秒] → 拆分文件（与 _soundplay case 对应） ---- */
  var SFX = [
    // se1.mp3
    [0.0,  0.641, 'jump.mp3'],        // case1  玩家跳跃
    [0.7,  0.432, 'brockbreak.mp3'],  // case3  砖块碎裂
    [1.2,  0.928, 'coin.mp3'],        // case4  获得金币/问号块出金币(brockcoin 同切片)
    [2.2,  0.458, 'humi.mp3'],        // case5  踩踏弹起 / 机器人抛投动作
    [2.7,  0.249, 'koura.mp3'],       // case6  龟壳滑动击杀
    [3.0,  0.928, 'dokan.mp3'],       // case7  进入管道
    [4.0,  0.928, 'brockkinoko.mp3'], // case8  问号块顶出道具
    [5.0,  0.928, 'powerup.mp3'],     // case9  吃蘑菇变强
    [6.0,  0.432, 'kirra.mp3'],       // case10 弹簧猫脸/白幽灵出现
    [6.5,  6.936, 'goal.mp3'],        // case11 接触终点旗杆
    [13.5, 3.253, 'death.mp3'],       // case12 玩家阵亡
    // se2.mp3
    [0.0,  0.275, 'Pswitch.mp3'],     // case13 头顶开关块/脚踩P开关
    [0.3,  0.118, 'jumpBlock.mp3'],   // case14 音符块弹跳
    [0.5,  0.797, 'hintBlock.mp3'],   // case15 顶提示块
    [1.4,  4.428, '4-clear.mp3'],     // case16 接触剑刺(过关)
    [5.9,  6.936, 'allclear.mp3'],    // case17 过关结算
    [13.0, 1.476, 'tekifire.mp3']     // case18 横火焰出现
  ];

  function matchFile(offset, duration) {
    if (typeof offset !== 'number' || !isFinite(offset) ||
        typeof duration !== 'number' || !isFinite(duration)) return null;
    for (var i = 0; i < SFX.length; i++) {
      if (Math.abs(SFX[i][0] - offset) <= 0.05 &&
          Math.abs(SFX[i][1] - duration) <= 0.05) return SFX[i][2];
    }
    return null;
  }

  /* ---- HTMLAudio 池：同名音效可重叠，stop 可整组停 ---- */
  var POOL_SIZE = 8;
  var pools = {};
  var stats = {};

  function playFile(name) {
    var url = SE_DIR + name;
    var list = pools[name] || (pools[name] = []);
    var el = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].paused || list[i].ended) { el = list[i]; break; }
    }
    if (!el) {
      if (list.length >= POOL_SIZE) el = list.shift();
      else el = new Audio();
      list.push(el);
    }
    if (el.src !== url) el.src = url;
    el.currentTime = 0;
    stats[name] = (stats[name] || 0) + 1;
    var pr = el.play();
    if (pr && pr.catch) pr.catch(function () { /* 浏览器尚未解锁音频时忽略 */ });
  }

  function stopFile(name) {
    var list = pools[name];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i].pause(); list[i].currentTime = 0; } catch (e) {}
    }
  }

  /* ---- 劫持 Web Audio source 节点 ---- */
  var proto = window.AudioBufferSourceNode && AudioBufferSourceNode.prototype;
  if (proto && !proto.__sePatched) {
    var origStart = proto.start;
    var origStop = proto.stop;

    proto.start = function (when, offset, duration) {
      // _soundplay 恒为三参数 start(0, 偏移, 时长)；BGM/解锁音只传 1 个参数
      if (arguments.length >= 3) {
        var file = matchFile(offset, duration);
        if (file) {
          this.__seFile = file;
          playFile(file);
          return; // 不启动原切片（原缓冲是静音 WAV，双保险）
        }
      }
      return origStart.apply(this, arguments);
    };

    proto.stop = function (when) {
      if (this.__seFile) {
        stopFile(this.__seFile);
        return; // 原节点从未 start，直接 stop 会抛 InvalidStateError
      }
      return origStop.apply(this, arguments);
    };

    proto.__sePatched = true;
  }

  /* ---- 合成一段静音 WAV（arraybuffer），喂给 decodeAudioData ---- */
  function silentWavArrayBuffer() {
    var rate = 22050, seconds = 0.2, n = rate * seconds;
    var buf = new ArrayBuffer(44 + n * 2);
    var v = new DataView(buf);
    function ws(off, str) { for (var i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); }
    ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE');
    ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, n * 2, true);
    // 采样全 0（静音）
    return buf;
  }

  /* ---- 劫持 XHR：se1/se2 用静音 WAV 应答（file:// 下 XHR 被禁的关键修复） ---- */
  if (window.XMLHttpRequest && !XMLHttpRequest.prototype.__sePatched) {
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__seUrl = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var url = this.__seUrl || '';
      if (/(^|\/)snd\/se[12]\.mp3(\?|$)/.test(url)) {
        var self = this;
        setTimeout(function () {
          try {
            Object.defineProperty(self, 'response', { value: silentWavArrayBuffer() });
            Object.defineProperty(self, 'status', { value: 200 });
            Object.defineProperty(self, 'readyState', { value: 4 });
            if (typeof self.onload === 'function') self.onload.call(self, { target: self });
          } catch (e) {
            if (typeof self.onerror === 'function') self.onerror.call(self, e);
          }
        }, 10);
        return;
      }
      return origSend.apply(this, arguments);
    };
    XMLHttpRequest.prototype.__sePatched = true;
  }

  window.soundPatch = { dir: SE_DIR, sfx: SFX, stats: stats, play: playFile, stop: stopFile };
})();
