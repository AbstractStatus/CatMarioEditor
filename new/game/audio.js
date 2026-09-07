// ===================================================================
// 音频系统 - BGM + 音效
// 使用 HTMLAudioElement 池，兼容 http:// 和 file://（直接双击打开）
// ===================================================================
(function (global) {
  'use strict';

  var C = global.Constants;
  var Audio = {};

  var currentBgm = 0;
  var bgmEl = null;
  var muted = false;

  Audio.mute = function () {
    muted = !muted;
    if (bgmEl) {
      try { bgmEl.muted = muted; } catch (e) {}
    }
    return muted;
  };

  Audio.isMuted = function () { return muted; };

  // BGM 文件名映射
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

  var POOL_SIZE = 8;
  var sePools = {};

  function getSePool(id) {
    if (!sePools[id]) sePools[id] = [];
    return sePools[id];
  }

  function playSeFile(id) {
    if (muted) return;
    var file = SE_FILES[id];
    if (!file) return;
    var url = C.RES.SE_DIR + file;
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

  Audio.init = function () {
    // 预创建音效池元素（可选，首次播放时也会懒加载）
  };

  Audio.unlock = function () {
    // 浏览器要求用户交互后才能播放音频
    try {
      var unlockEl = new window.Audio();
      unlockEl.play().catch(function () {});
    } catch (e) {}
  };

  Audio.playSE = function (id) {
    playSeFile(id);
  };

  Audio.bgmChange = function (id) {
    if (currentBgm === id && bgmEl) return;
    currentBgm = id;
    var file = BGM_FILES[id];
    if (!file) return;
    Audio.bgmStop();
    bgmEl = new window.Audio();
    bgmEl.src = C.RES.AUDIO_DIR + file;
    bgmEl.loop = true;
    bgmEl.volume = muted ? 0 : 0.5;
    try { bgmEl.muted = muted; } catch (e) {}
    var pr = bgmEl.play();
    if (pr && pr.catch) pr.catch(function () {});
  };

  Audio.bgmStop = function () {
    if (bgmEl) {
      try { bgmEl.pause(); bgmEl.currentTime = 0; } catch (e) {}
      bgmEl = null;
    }
  };

  Audio.bgmPlay = function (id) {
    if (id) currentBgm = id;
    Audio.bgmChange(currentBgm);
  };

  global.AudioSys = Audio;
})(window);
