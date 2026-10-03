#!/usr/bin/env node
'use strict';
// ===================================================================
// 录像系统确定性回放测试（无头，Node 直接运行）
//
// 用法：node tools/replay_test.js
//
// 原理：
//   在 vm 沙箱中加载 constants + replay + elements + engine（mock
//   Input/AudioSys/Sprites/Levels，注入 btoa/atob），脚本化按键录制一段
//   含「标题按键开局 → 走路/跳跃 → O 键自杀与自动复活（重复载关）→
//   管道宿主换关（warp 钩子复刻）→ 第二关行走」的流程，逐帧采集状态快照；
//   然后回到标题播放同一录像，播放时故意全程按下真实按键 + 按住 O 键，
//   验证真实输入被录像输入覆盖，逐帧比对录制与播放状态完全一致。
//
// 第二个场景覆盖「帧间按钮开局（ext:true 事件）」路径。
// ===================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ---------------- 浏览器环境 mock ----------------
const _input = { mask: 0, suicide: false };
const sandbox = {
  console,
  Date,
  Image: function () { this.complete = false; this.naturalWidth = 0; },
  // replay.js 用全局 btoa/atob 编解码帧数据
  btoa: function (s) { return Buffer.from(s, 'binary').toString('base64'); },
  atob: function (b) { return Buffer.from(b, 'base64').toString('binary'); },
};
sandbox.window = sandbox;
vm.createContext(sandbox);

sandbox.Input = {
  get: function () { return _input.mask; },
  consumeSuicide: function () { const v = _input.suicide; _input.suicide = false; return v; },
  endFrame: function () {},
};
sandbox.AudioSys = {
  playSE() {}, stopSe() {}, bgmChange() {}, bgmStop() {},
  bgmSuspend() {}, bgmResume() {}, unlock() {}, mute() {},
};
sandbox.Sprites = { draw() {}, get() { return null; }, init() {} };

function load(f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
load('game/constants.js');
load('game/replay.js');     // 必须在 engine.js 之前（engine 顶部取 GameReplay）

let def1 = null, def2 = null;
sandbox.Levels = {
  get: function (sta, stb, stc) { return stb === 2 ? def2 : def1; },
};
load('game/elements.js');
load('game/engine.js');

const C = sandbox.Constants;
const E = sandbox.GameEngine;
const R = sandbox.GameReplay;
const st = E._state;
const KEY = C.KEY;          // LEFT=1 RIGHT=2 DOWN=4 UP=8 JUMP=16 CLICK=32

// ---------------- 关卡构造 ----------------
function makeDef(id, over) {
  const grid = [];
  for (let r = 0; r < 17; r++) grid.push(new Array(1001).fill(0));
  const def = {
    id: id, stagecolor: 1, scrollx: 99999999,
    grid: grid,
    blocks: [], pipes: [], enemies: [], bg: [], lifts: [],
    spawn: { ma: 5600, mb: 32000 },
  };
  for (let c = 0; c <= 400; c++) { grid[13][c] = 5; grid[14][c] = 6; grid[15][c] = 6; grid[16][c] = 6; }
  if (over) Object.assign(def, over);
  return def;
}

// 横式换关管（同 pipe_eject_test 场景4：stype=40 sxtype=2，右侧步入）
// 携带 warp：沉管结束走宿主 onWarp 钩子
const WARP_PIPE = {
  sa: 110000, sb: 30700, sc: 3000, sd: 5800,
  stype: 40, sxtype: 2, sgtype: 0,
  warp: { id: 'stage2' },
};

// ---------------- 驱动 ----------------
function snap() {
  const p = st.player;
  return {
    proc: st.proc, maintm: st.maintm, life: st.life, score: st.score,
    c: [st.sta, st.stb, st.stc],
    p: p ? [p.ma, p.mb, p.mc, p.md, p.mtype, p.mtm, p.mhp, p.mzimen, p.mmuki, p.mkeytm] : null,
    fx: st.fx, fy: st.fy,
    en: st.enemies ? st.enemies.map(function (e) {
      return [e.aa, e.ab, e.ac, e.ad, e.atype, e.axtype, e.atm, e.amuki, e.hp, e.stime];
    }) : [],
    n: [st.blocks.length, st.pipes.length, st.particles.length,
        st.lifts.length, (st.triggers || []).length, st.enemies.length],
  };
}

let hostCalls = 0;
function installHost() {
  hostCalls = 0;
  st.onWarp = function (w) {
    hostCalls++;
    st.sta = 1; st.stb = 2; st.stc = 0;
    return true;
  };
}

// ---------------- 断言辅助 ----------------
let passCount = 0, failCount = 0;
function check(ok, name, detail) {
  if (ok) { passCount++; console.log('[PASS] ' + name + (detail ? ' —— ' + detail : '')); }
  else { failCount++; console.log('[FAIL] ' + name + (detail ? ' —— ' + detail : '')); }
}
function assertMode(m, name) {
  check(R.status().mode === m, name, 'mode=' + R.status().mode);
}

// 逐帧比对（浮点为同序列确定性运算结果，按位相等；mtm 等是 0.5 的整数倍）
function diffSnap(a, b) {
  const diffs = [];
  const fields = ['proc', 'maintm', 'life', 'score', 'c', 'p', 'fx', 'fy', 'n'];
  for (const k of fields) {
    const ja = JSON.stringify(a[k]), jb = JSON.stringify(b[k]);
    if (ja !== jb) diffs.push(k + ' rec=' + ja + ' play=' + jb);
  }
  if (a.en.length !== b.en.length) {
    diffs.push('en.length rec=' + a.en.length + ' play=' + b.en.length);
  } else {
    for (let i = 0; i < a.en.length; i++) {
      const ja = JSON.stringify(a.en[i]), jb = JSON.stringify(b.en[i]);
      if (ja !== jb) { diffs.push('en[' + i + '] rec=' + ja + ' play=' + jb); break; }
    }
  }
  return diffs;
}

// ===================================================================
// 场景 A：按键开局 + 走跳 + 自杀复活 + warp 宿主换关，完整录制/播放一致性
// ===================================================================
(function scenarioA() {
  def1 = makeDef('stage1', { pipes: [WARP_PIPE] });
  def2 = makeDef('stage2', { stagecolor: 2 });
  installHost();
  _input.mask = 0; _input.suicide = false;

  // ---- 非标题画面禁止录制（临时把 proc 拨离标题再试，随后还原）----
  st.proc = C.PROC.GAME;
  const reject = R.beginRecord({});
  check(reject.ok !== true, 'A.非标题画面禁止启动录制', 'error=' + reject.error);
  st.proc = C.PROC.TITLE;

  // ---- 录制 ----
  const rb = R.beginRecord({ name: 'A-走跳自杀换关' });
  check(rb.ok === true, 'A.标题画面启动录制成功', 'seed=' + rb.seed);
  assertMode('record', 'A.启动后 mode=record');

  const recSnaps = [];
  function step() { E._stepFrame(); recSnaps.push(snap()); }
  function steps(n) { for (let i = 0; i < n; i++) step(); }
  function waitUntil(pred, max, tag) {
    let g = max;
    while (!pred() && g-- > 0) step();
    if (g <= 0) throw new Error('等待超时: ' + (tag || '') + ' proc=' + st.proc +
      ' mtype=' + st.player.mtype + ' stb=' + st.stb);
  }

  steps(10);                              // 标题待机帧（应被裁掉）
  _input.mask = KEY.JUMP; step();         // 标题按键开局（start 事件 ext:false）
  _input.mask = 0;
  waitUntil(function () { return st.proc === C.PROC.GAME; }, 300, '开局进入 GAME');

  _input.mask = KEY.RIGHT; steps(120);            // 步行
  _input.mask = KEY.RIGHT | KEY.UP; steps(25);    // 起跳
  _input.mask = KEY.RIGHT; steps(90);             // 落地继续
  _input.mask = 0; steps(20);

  _input.suicide = true; step();                  // O 键自杀（写入帧字节 bit6）
  check(st.player.mtype === C.MTYPE.DEAD || (function () {
    for (let i = 0; i < 5; i++) step();
    return st.player.mtype === C.MTYPE.DEAD;
  })(), 'A.自杀后进入死亡演出', 'mtype=' + st.player.mtype);
  waitUntil(function () { return st.proc === C.PROC.GAME; }, 600, '死亡后自动复活');

  _input.mask = KEY.RIGHT; steps(60);
  // 持续右行步入换关管（沉管动画 ~20 帧后触发 warp 宿主钩子 → stb=2）
  waitUntil(function () { return st.stb === 2; }, 2000, '管道换关到第二关');
  waitUntil(function () { return st.proc === C.PROC.GAME; }, 300, '第二关进入 GAME');
  _input.mask = KEY.RIGHT; steps(120);
  _input.mask = 0; steps(30);

  const out = R.stopRecord();
  check(out.ok === true, 'A.停止录制产出录像文件', (out.error || '') +
    (out.file ? ' 帧数=' + out.file.meta.durationFrames + ' 关卡快照=' + out.file.stages.length : ''));
  assertMode('off', 'A.停止后 mode=off');
  if (!out.ok) return;
  const file = out.file;

  // ---- 文件结构 ----
  check(file.app === 'catmario-replay' && file.ver === 1, 'A.录像头 app/ver 正确');
  check(file.viewW === 480 && file.fps === 60, 'A.录像锁定 480 宽 / 60fps',
    'viewW=' + file.viewW + ' fps=' + file.fps);
  check(file.stages.length === 2, 'A.关卡快照去重为 2（第一关载入2次+第二关1次）',
    'stages=' + file.stages.length);
  check(JSON.stringify(file.stageSeq) === JSON.stringify([0, 0, 1]),
    'A.stageSeq=[0,0,1]（首载/复活重载/换关）', 'seq=' + JSON.stringify(file.stageSeq));
  const hookEvents = file.events.filter(function (e) { return e[1] === 'hook'; });
  check(hookEvents.length === 1 && hookEvents[0][2].kind === 'warp' &&
    hookEvents[0][2].r === true && hookEvents[0][2].stb === 2,
    'A.含 1 个 warp 宿主钩子事件且记录了换关决策', JSON.stringify(hookEvents));
  const startEvents = file.events.filter(function (e) { return e[1] === 'start'; });
  check(startEvents.length === 1 && startEvents[0][2].ext === false,
    'A.开局事件 ext=false（标题按键开局）');
  check(file.stages[0].id === 'stage1' && file.stages[1].id === 'stage2',
    'A.快照内容顺序 stage1→stage2');

  // ---- 回到标题播放 ----
  E.backToTitle();
  hostCalls = 0;   // 清掉录制期的合法调用计数，单独统计播放期
  check(st.proc === C.PROC.TITLE, 'A.回到标题可播放');
  const pr = R.startPlay(file);
  check(pr.ok === true, 'A.开始播放', pr.error || '');
  assertMode('play', 'A.播放中 mode=play');
  if (!pr.ok) return;

  const N = file.meta.durationFrames;
  check(recSnaps.length - (function () {
    for (let i = 0; i < recSnaps.length; i++) if (recSnaps[i].proc !== C.PROC.TITLE) return i;
    return recSnaps.length;
  })() === N, 'A.快照裁掉标题帧后长度=录像帧数', 'N=' + N);

  const playSnaps = [];
  for (let i = 0; i < N; i++) {
    // 故意全程乱按真实按键（含 CLICK）+ 按住 O：播放输入必须全部来自录像
    _input.mask = (i % 2 === 0) ? 0x3f : KEY.LEFT;
    _input.suicide = true;
    E._stepFrame();
    playSnaps.push(snap());
  }

  const i0 = (function () {
    for (let i = 0; i < recSnaps.length; i++) if (recSnaps[i].proc !== C.PROC.TITLE) return i;
    return recSnaps.length;
  })();
  const refSnaps = recSnaps.slice(i0);
  check(refSnaps.length === N && playSnaps.length === N, 'A.录制/播放快照数对齐',
    'rec=' + refSnaps.length + ' play=' + playSnaps.length);

  let mism = 0;
  const firstDiffs = [];
  for (let i = 0; i < N; i++) {
    // 最后一帧：播放结束自动回标题（_finishPlay），录制末帧仍在游戏中 —— 设计行为
    const d = (i === N - 1)
      ? diffSnap(refSnaps[i], playSnaps[i]).filter(function (x) { return x.slice(0, 4) !== 'proc'; })
      : diffSnap(refSnaps[i], playSnaps[i]);
    if (d.length) {
      mism++;
      if (firstDiffs.length < 8) firstDiffs.push('f=' + i + ': ' + d.slice(0, 3).join(' | '));
    }
  }
  check(mism === 0, 'A.全部 ' + N + ' 物理帧录制/播放状态逐位一致',
    mism ? ('不一致帧=' + mism + '\n      ' + firstDiffs.join('\n      ')) : 'N=' + N);
  check(playSnaps[N - 1].proc === C.PROC.TITLE, 'A.播放到末尾自动回标题');
  check(hostCalls === 0, 'A.播放期不回调宿主 onWarp（副作用由录像复刻）', 'calls=' + hostCalls);
  check(playSnaps.some(function (s) { return s.c[1] === 2; }), 'A.播放中确实到达第二关');
  check(playSnaps.some(function (s) { return s.p[4] === C.MTYPE.DEAD; }), 'A.播放中自杀死亡按录像复现');
  assertMode('ended', 'A.播放结束 mode=ended');
  R.stopPlay();
})();

// ===================================================================
// 场景 B：帧间按钮开局（ext:true 事件）路径
// ===================================================================
(function scenarioB() {
  def1 = makeDef('stage1');
  def2 = makeDef('stage2', { stagecolor: 2 });
  installHost();
  E.backToTitle();
  R.stopPlay();
  _input.mask = 0; _input.suicide = false;

  const rb = R.beginRecord({ name: 'B-按钮开局' });
  check(rb.ok === true, 'B.标题画面启动录制');

  const recSnaps = [];
  function step() { E._stepFrame(); recSnaps.push(snap()); }
  function steps(n) { for (let i = 0; i < n; i++) step(); }
  function waitUntil(pred, max, tag) {
    let g = max;
    while (!pred() && g-- > 0) step();
    if (g <= 0) throw new Error('等待超时: ' + tag);
  }

  // 模拟宿主按钮在帧间开局（Engine.startGame 录制分支会落 ext 事件）
  E.startGame();
  check(st.proc === C.PROC.STAGE_START, 'B.按钮立即开局（不必等下一帧）');
  waitUntil(function () { return st.proc === C.PROC.GAME; }, 300, '进入 GAME');
  _input.mask = KEY.RIGHT; steps(80);
  _input.mask = KEY.RIGHT | KEY.UP; steps(20);
  _input.mask = 0; steps(20);

  const out = R.stopRecord();
  check(out.ok === true, 'B.停止录制', out.error || '');
  if (!out.ok) return;
  const file = out.file;
  check(file.events.some(function (e) { return e[1] === 'start' && e[2].ext === true; }),
    'B.开局事件 ext=true（帧间外部开局）');
  check(file.meta.startType === 'ext', 'B.meta.startType=ext');

  E.backToTitle();
  const pr = R.startPlay(file);
  check(pr.ok === true, 'B.开始播放', pr.error || '');
  if (!pr.ok) return;

  const N = file.meta.durationFrames;
  const playSnaps = [];
  for (let i = 0; i < N; i++) {
    _input.mask = 0x3f;       // 真实按键全程干扰
    _input.suicide = true;
    E._stepFrame();
    playSnaps.push(snap());
  }

  let mism = 0;
  const firstDiffs = [];
  for (let i = 0; i < N; i++) {
    const d = (i === N - 1)
      ? diffSnap(recSnaps[i], playSnaps[i]).filter(function (x) { return x.slice(0, 4) !== 'proc'; })
      : diffSnap(recSnaps[i], playSnaps[i]);
    if (d.length) {
      mism++;
      if (firstDiffs.length < 8) firstDiffs.push('f=' + i + ': ' + d.slice(0, 3).join(' | '));
    }
  }
  check(mism === 0, 'B.ext 开局路径全部 ' + N + ' 帧逐位一致',
    mism ? ('不一致帧=' + mism + '\n      ' + firstDiffs.join('\n      ')) : 'N=' + N);
  check(R.status().mode === 'ended', 'B.播放结束 mode=ended');
  R.stopPlay();
})();

// ===================================================================
// 场景 C：录像文件校验（损坏/非标题播放）
// ===================================================================
(function scenarioC() {
  E.backToTitle();
  const good = (function () {
    R.beginRecord({});
    _input.mask = KEY.JUMP; E._stepFrame(); _input.mask = 0;
    for (let i = 0; i < 120; i++) E._stepFrame();
    return R.stopRecord().file;
  })();
  check(!!good, 'C.准备有效录像');

  check(R.startPlay(Object.assign({}, good, { app: 'xxx' })).ok !== true, 'C.拒绝非猫里奥录像');
  check(R.startPlay(Object.assign({}, good, { ver: 99 })).ok !== true, 'C.拒绝版本不兼容');
  check(R.startPlay(Object.assign({}, good, { frames: good.frames + '!!' })).ok !== true, 'C.拒绝损坏帧数据');
  check(R.startPlay(Object.assign({}, good, { stages: [] })).ok !== true, 'C.拒绝缺关卡数据');

  // 游戏中禁止播放
  E.backToTitle();
  const r1 = R.startPlay(good);
  check(r1.ok === true, 'C.标题可正常播放');
  const mid = R.startPlay(good);
  check(mid.ok !== true, 'C.播放中禁止再次播放');
  R.stopPlay();
})();

// ===================================================================
// 汇总
// ===================================================================
console.log('================================================================');
console.log(' 检查项合计: ' + (passCount + failCount) + '，通过: ' + passCount + '，失败: ' + failCount);
console.log('================================================================');
process.exit(failCount > 0 ? 1 : 0);
