#!/usr/bin/env node
'use strict';
// ===================================================================
// 新旧引擎物理速度一致性自动化测试（无头，Node 直接运行）
//
// 用法：node tools/physics_speed_test.js
//
// 原理：
//   旧引擎（tiwb_catmario/src/main.cpp）为 30Hz 固定步长，所有速度常量
//   都是"每帧位移"（世界单位/帧，1单位=1/100像素）。其真实速度 = 常量 × 30。
//   新引擎（game/engine.js）通过 C._DT = 30/C.FPS 缩放支持 30/60/120Hz，
//   理想情况下任意刷新率下测得的"世界单位/秒"都应等于 旧引擎常量 × 30。
//
//   本脚本在 Node 的 vm 沙箱中加载 game/constants.js + game/elements.js +
//   game/engine.js（mock 掉 Input/AudioSys/Sprites/Levels），用
//   GameEngine.setFps(30|60|120) + GameEngine._stepFrame() 确定性推进物理帧，
//   对每个元素场景实测速度并与 main.cpp 基准对比。
//
// 注意：
//   - 恒速运动（步行/敌人/恒速升降台）跨刷新率应完全一致（容差 ~0.2%）。
//   - 加速运动（坠落砖/升降台坠落/粒子重力）用半隐式欧拉积分，位置随步长
//     减小而更接近真值，位置存在固有离散误差（30Hz 最大），对位置用宽容差
//     （~10%），对瞬时速度用紧容差。
//   - 跳跃高度受 boost 触发时刻（mjumptm 里程碑）影响，天生随刷新率略有
//     差异（30>60>120），用宽带判定；关键是 boost 必须触发（md 重置到
//     -1300/-1400/-1500），否则跳跃高度只剩 64%（hd34 修复的回归项）。
// ===================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FPS_LIST = [30, 60, 120];

// ---------------- 浏览器环境 mock ----------------
const _input = { mask: 0 };
const sandbox = {
  console,
  Image: function () { this.complete = false; this.naturalWidth = 0; },
};
sandbox.window = sandbox;
vm.createContext(sandbox);

sandbox.Input = {
  get: function () { return _input.mask; },
  consumeSuicide: function () { return false; },
  endFrame: function () {},
};
sandbox.AudioSys = {
  playSE() {}, stopSe() {}, bgmChange() {}, bgmStop() {},
  bgmSuspend() {}, bgmResume() {}, unlock() {},
};
sandbox.Sprites = { draw() {}, get() { return null; } };

function load(f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
load('game/constants.js');
// Levels 必须在引擎加载前注入（engine.js 加载时捕获引用），关卡定义由场景动态提供
let currentDef = null;
sandbox.Levels = { get: function () { return currentDef; } };
load('game/elements.js');   // PipeTypes 注册表（含 stype=51 坠落砖 physics）
load('game/engine.js');

const C = sandbox.Constants;
const E = sandbox.GameEngine;
const st = E._state;
const KEY = C.KEY;          // LEFT=1 RIGHT=2 DOWN=4 UP=8 JUMP=16

// ---------------- 驱动辅助 ----------------
function stepN(n) { for (let i = 0; i < n; i++) E._stepFrame(); }
// n30 = 以旧引擎 30Hz 帧数为单位的时间，按当前刷新率换算
function step30(n30) { stepN(Math.round(n30 * C.FPS / 30)); }
// 收集每帧一个采样值
function stepCollect(n30, fn) {
  const n = Math.round(n30 * C.FPS / 30), out = [];
  for (let i = 0; i < n; i++) { E._stepFrame(); out.push(fn()); }
  return out;
}
function boot(def, fps) {
  currentDef = def;
  E.setFps(fps);
  E.startGame();
  let guard = 10000;
  while (st.proc !== C.PROC.GAME && guard-- > 0) E._stepFrame();
  if (guard <= 0) throw new Error('startGame 后未能进入 GAME 状态');
}
// 位移 → 世界单位/秒（f30 个 30Hz 帧）
function dispSpeed(p0, p1, f30) { return (p1 - p0) / (f30 / 30); }

// 跳跃上升段逐帧 mb 位移增量的峰值，归一化为"世界单位/30Hz帧"×30（=u/s）。
// 时序：mask 置位后第1帧是武装帧（actaon[1]→10，无位移），第2帧起跳（含 -400 瞬移
// nudge，不随 DT 缩放），故跳过前 2 个增量；boost 帧增量=1300×DT（普通帧 1200×DT，
// md 重置发生在重力积分前），归一化后可跨刷新率精确比较。
// 只统计 mb 单调下降段（到顶即停），避免落地回弹干扰。
function maxRiseDelta(n30) {
  const DT = C._DT;
  const n = Math.round(n30 * C.FPS / 30);
  let prev = st.player.mb, best = 0, skip = 2;
  for (let i = 0; i < n; i++) {
    E._stepFrame();
    const cur = st.player.mb;
    if (cur > prev) break;              // 到顶
    if (skip > 0) skip--;               // 跳过武装帧(0)与起跳帧(含nudge)
    else {
      const d = (prev - cur) / DT;      // 归一化为 30Hz 帧单位
      if (d > best) best = d;
    }
    prev = cur;
  }
  return best * 30;                     // → 世界单位/秒
}

// 平地关卡：row13 地面顶层(ttype5) + 14-16 填充(ttype6)，世界顶 y=36500
function makeDef(over) {
  const grid = [];
  for (let r = 0; r < 17; r++) grid.push(new Array(1001).fill(0));
  const def = {
    id: 'phys-test', stagecolor: 1, scrollx: 99999999,
    grid: grid,
    blocks: [], pipes: [], enemies: [], bg: [], lifts: [],
    spawn: { ma: 5600, mb: 32000 },
  };
  if (!over || !over.noGround) {
    for (let c = 0; c <= 150; c++) { grid[13][c] = 5; grid[14][c] = 6; grid[15][c] = 6; grid[16][c] = 6; }
  }
  if (over) Object.assign(def, over);
  return def;
}

// 敌人水平/垂直速度实测：触发器放在镜头内即时生成
function enemySpeed(fps, btype, bxtype, ba, bb, warm30, win30) {
  boot(makeDef({ enemies: [{ ba: ba, bb: bb, btype: btype, bxtype: bxtype || 0 }] }), fps);
  step30(warm30);
  const e = st.enemies[0];
  if (!e || e.aa < -800000) throw new Error('敌人未生成或已被剔除');
  const ax0 = e.aa, ab0 = e.ab;
  step30(win30);
  const e2 = st.enemies[0];
  if (!e2 || e2.aa < -800000) throw new Error('测量窗口内敌人被剔除/死亡');
  return { vx: dispSpeed(ax0, e2.aa, win30), vy: dispSpeed(ab0, e2.ab, win30) };
}

// ---------------- 场景定义 ----------------
// ref = 旧引擎(main.cpp 30Hz)基准；速度类 ref = main.cpp 每帧常量 × 30
const SCENARIOS = [
  // ---- 玩家 ----
  {
    name: 'player.walk.right',
    desc: '步行右行终点速度（main.cpp:1759 xx[9]=700 → 终点 mc=701/帧）',
    checks: [{ key: 'v', ref: 701 * 30, tol: 0.001 }],
    run(fps) {
      boot(makeDef(), fps);
      step30(60);
      _input.mask = KEY.RIGHT;
      step30(60);                       // 加速至终点
      const a = st.player.ma;
      step30(60);
      _input.mask = 0;
      return { v: dispSpeed(a, st.player.ma, 60) };
    },
  },
  {
    name: 'player.walk.left',
    desc: '步行左行终点速度（先右移远离世界左边界 ma<100）',
    checks: [{ key: 'v', ref: -701 * 30, tol: 0.001 }],
    run(fps) {
      boot(makeDef(), fps);
      step30(60);
      _input.mask = KEY.RIGHT;
      step30(150);                      // 移到 ma≈104000，左行全程不触及世界左边界
      _input.mask = KEY.LEFT;
      step30(60);                       // 加速至终点
      const a = st.player.ma;
      step30(60);
      _input.mask = 0;
      return { v: dispSpeed(a, st.player.ma, 60) };
    },
  },
  {
    name: 'player.fall.terminal',
    desc: '空中坠落终端速度（main.cpp:2025 md+=100、2033 上限1600）；位移差分含重力补偿偏移 -g·30·(1-DT)/2（hd39 轨迹对齐 30Hz）',
    checks: [{ key: 'v', ref: function (fps) { return 1600 * 30 - C.GRAVITY * 30 * (1 - 30 / fps) / 2; }, tol: 0.002 }],
    run(fps) {
      boot(makeDef({ noGround: true, spawn: { ma: 5600, mb: 0 } }), fps);
      step30(18);                       // 16帧后到达终端 md=1600
      const a = st.player.mb;
      step30(15);
      _input.mask = 0;
      return { v: dispSpeed(a, st.player.mb, 15) };
    },
  },
  {
    name: 'player.fall.cap_md',
    desc: '终端下落 md 应精确钳制在 1600/帧（速度=48000/s）',
    checks: [{ key: 'v', ref: 1600 * 30, tol: 0.0005 }],
    run(fps) {
      boot(makeDef({ noGround: true, spawn: { ma: 5600, mb: 0 } }), fps);
      step30(20);
      return { v: st.player.md * 30 };
    },
  },
  {
    name: 'player.jump.v0',
    desc: '跳跃初速 -1200/帧（main.cpp:1798）；帧末采样已含一帧重力衰减，按幅值带宽判定',
    checks: [
      { key: 'v', atLeast: 33000, atMost: 36000, note: '幅值∈[33000,36000]（-1200 减 0~1 帧重力）' },
    ],
    run(fps) {
      boot(makeDef(), fps);
      step30(30);                       // 落地站稳
      _input.mask = KEY.JUMP;
      const mds = [];                   // 采原始4个子帧（避免 step30 换算把 boost 帧采进来）
      for (let i = 0; i < 4; i++) { E._stepFrame(); mds.push(st.player.md); }
      _input.mask = 0;
      return { v: Math.abs(Math.min.apply(null, mds)) * 30 };
    },
  },
  {
    name: 'player.jump.boost_stand',
    desc: '原地跳 boost 重置 md=-1300（main.cpp:1736-1737）：逐帧 mb 位移增量峰值（boost帧1300 vs 普通帧1200）；含重力补偿偏移 +g·30·(1-DT)/2',
    checks: [{ key: 'v', ref: function (fps) { return 1300 * 30 + C.GRAVITY * 30 * (1 - 30 / fps) / 2; }, tol: 0.001 }],
    run(fps) {
      boot(makeDef(), fps);
      step30(30);
      _input.mask = KEY.JUMP;
      const v = maxRiseDelta(30);
      _input.mask = 0;
      return { v: v };
    },
  },
  {
    name: 'player.jump.boost_run',
    desc: '奔跑跳(|mc|>=600) boost 重置 md=-1500（main.cpp:1739-1740）：同上，峰值应为 1500/帧；含重力补偿偏移 +g·30·(1-DT)/2',
    checks: [{ key: 'v', ref: function (fps) { return 1500 * 30 + C.GRAVITY * 30 * (1 - 30 / fps) / 2; }, tol: 0.001 }],
    run(fps) {
      boot(makeDef(), fps);
      step30(30);
      _input.mask = KEY.RIGHT;
      step30(60);                       // mc 到 701 >= 600
      _input.mask = KEY.RIGHT | KEY.JUMP;
      const v = maxRiseDelta(30);
      _input.mask = 0;
      return { v: v };
    },
  },
  {
    name: 'player.jump.apex_stand',
    desc: '原地跳跃升高度（boost 触发时刻随刷新率固有差异，宽带；不触发≈8200=回归）',
    checks: [{ key: 'h', ref: 12800, tol: 0.15 }],
    run(fps) {
      boot(makeDef(), fps);
      step30(30);
      const mb0 = st.player.mb;
      _input.mask = KEY.JUMP;
      const mbs = stepCollect(60, function () { return st.player.mb; });
      _input.mask = 0;
      return { h: mb0 - Math.min.apply(null, mbs) };
    },
  },
  {
    name: 'player.jump.apex_run',
    desc: '奔跑跳跃升高度（-1500 boost，同上宽带）',
    checks: [{ key: 'h', ref: 15700, tol: 0.15 }],
    run(fps) {
      boot(makeDef(), fps);
      step30(30);
      _input.mask = KEY.RIGHT;
      step30(60);
      const mb0 = st.player.mb;
      _input.mask = KEY.RIGHT | KEY.JUMP;
      const mbs = stepCollect(60, function () { return st.player.mb; });
      _input.mask = 0;
      return { h: mb0 - Math.min.apply(null, mbs) };
    },
  },

  // ---- 敌人 ----
  {
    name: 'enemy.cat.walk',
    desc: '白猫怪步行 100/帧（main.cpp:2977）',
    checks: [{ key: 'vx', ref: -100 * 30, tol: 0.002 }],
    run(fps) { return enemySpeed(fps, 0, 0, 40000, 30000, 15, 30); },
  },
  {
    name: 'enemy.turtle.walk',
    desc: '绿龟步行 100/帧（main.cpp:2982）',
    checks: [{ key: 'vx', ref: -100 * 30, tol: 0.002 }],
    run(fps) { return enemySpeed(fps, 1, 0, 40000, 30000, 15, 30); },
  },
  {
    name: 'enemy.shell.slide',
    desc: '滑动龟壳 800/帧（main.cpp:2987-2988）',
    checks: [{ key: 'vx', ref: -800 * 30, tol: 0.002 }],
    run(fps) { return enemySpeed(fps, 2, 1, 40000, 30000, 10, 15); },
  },
  {
    name: 'enemy.ghost.rise',
    desc: '白幽灵上升 800/帧（main.cpp:3010）',
    checks: [{ key: 'vy', ref: -800 * 30, tol: 0.002 }],
    run(fps) { return enemySpeed(fps, 3, 0, 40000, 20000, 5, 30); },
  },
  {
    name: 'enemy.ghost.fall',
    desc: '白幽灵天降 1200/帧（main.cpp:3013）',
    checks: [{ key: 'vy', ref: 1200 * 30, tol: 0.002 }],
    run(fps) { return enemySpeed(fps, 3, 1, 40000, 20000, 5, 20); },
  },
  {
    name: 'enemy.laser',
    desc: '激光炮 1600/帧（main.cpp:3165）',
    checks: [{ key: 'vx', ref: -1600 * 30, tol: 0.002 }],
    run(fps) { return enemySpeed(fps, 79, 0, 40000, 30000, 3, 10); },
  },
  {
    name: 'enemy.mushroom.walk',
    desc: '红蘑菇步行 100/帧（main.cpp:3266）',
    checks: [{ key: 'vx', ref: -100 * 30, tol: 0.002 }],
    run(fps) { return enemySpeed(fps, 100, 0, 40000, 30000, 15, 30); },
  },
  {
    name: 'enemy.badstar.walk',
    desc: '恶星步行 200/帧（main.cpp:3298）',
    checks: [{ key: 'vx', ref: -200 * 30, tol: 0.002 }],
    run(fps) { return enemySpeed(fps, 110, 0, 40000, 30000, 15, 30); },
  },
  {
    name: 'enemy.boon.float',
    desc: '奔跑怪浮动：峰值 |ad|=300（9000/s）、相位周期 2s+2s、水平静止（main.cpp:3103-3114）',
    checks: [
      { key: 'peakV', ref: 300 * 30, tol: 0.001 },
      { key: 'tUp', ref: 2.0, tol: 0.03 },
      { key: 'tCycle', ref: 4.0, tol: 0.03 },
      { key: 'vx', ref: 0, tolAbs: 50 },
    ],
    run(fps) {
      boot(makeDef({ enemies: [{ ba: 40000, bb: 20000, btype: 8 }] }), fps);
      step30(2);                        // 敌人在首个 GAME 帧生成
      if (!st.enemies[0]) throw new Error('奔跑怪未生成');
      let maxAd = 0, tUp = 0, tCycle = 0;
      const ax0 = st.enemies[0].aa;
      const frames = Math.round(128 * C.FPS / 30);
      for (let f = 1; f <= frames; f++) {
        E._stepFrame();
        const e = st.enemies[0];
        if (!e) break;
        if (Math.abs(e.ad) > maxAd) maxAd = Math.abs(e.ad);
        const t = 2.0 / 30 + f / C.FPS;
        if (!tUp && e.atm === 1) tUp = t;
        if (!tCycle && tUp && e.atm === 0) tCycle = t;
      }
      const eEnd = st.enemies[0];
      return {
        peakV: maxAd * 30,
        tUp: tUp,
        tCycle: tCycle || NaN,
        vx: eEnd ? dispSpeed(ax0, eEnd.aa, 128) : NaN,
      };
    },
  },

  // ---- 升降台 ----
  {
    name: 'lift.loop.constant',
    desc: '循环升降台恒速 srsok=200 → 6000/s（main.cpp:2871-2872）',
    checks: [{ key: 'vy', ref: -200 * 30, tol: 0.001 }],
    run(fps) {
      boot(makeDef({ lifts: [{ sra: 30000, srb: 30000, src: 3000, sracttype: 5, srsok: 200 }] }), fps);
      step30(10);
      const b0 = st.lifts[0].srb;
      step30(60);
      return { vy: dispSpeed(b0, st.lifts[0].srb, 60) };
    },
  },
  {
    name: 'lift.fall.accel',
    desc: '下坠升降台加速度 srf=60/帧²：0.5s 时 sre=900 → 27000/s；位移离散误差宽容差；玩家随动',
    checks: [
      { key: 'v', ref: 60 * 15 * 30, tol: 0.002 },
      { key: 'pos', ref: 60 * 15 * 16 / 2, tol: 0.10 },
      { key: 'ride', ref: 0, tolAbs: 250 },
    ],
    run(fps) {
      boot(makeDef({ noGround: true, lifts: [{ sra: 4000, srb: 36100, src: 6000, sracttype: 1 }] }), fps);
      let guard = 500;
      while (!st.lifts[0].sron && guard-- > 0) stepN(1);   // 玩家从上方落台触发
      // srf 在积分之后才置 60（首帧/次帧 sre 仍为 0），等 sre 首次 >0 再捕获，
      // 之后每个 30Hz 帧 sre 恒增 60 → Δsre 跨刷新率精确一致
      guard = 100;
      while (!(st.lifts[0].sre > 0) && guard-- > 0) stepN(1);
      const v0 = st.lifts[0].sre, b0 = st.lifts[0].srb;
      step30(15);
      const srb1 = st.lifts[0].srb;
      return {
        v: (st.lifts[0].sre - v0) * 30,        // Δsre×30 = 27000（sre 是每30Hz帧位移）
        pos: srb1 - b0,                        // 30Hz=7200；60/120Hz 欧拉离散略小(-3%/-5%)
        ride: Math.abs(st.player.mb - (srb1 - 3500)),
      };
    },
  },

  // ---- 坠落砖组 ----
  {
    name: 'fallblock.accel',
    desc: 'stype=51 坠落砖 sr+=120/帧²（main.cpp:2496）：窗口 Δsr=1200 → 36000/s；位移扣除触发帧部分加速后宽容差',
    checks: [
      { key: 'v', ref: 120 * 10 * 30, tol: 0.002 },
      { key: 'pos', ref: 120 * (1 + 10) * 10 / 2, tol: 0.10 },
      { key: 'hp', ref: 1, tolAbs: 0 },
    ],
    run(fps) {
      boot(makeDef({ pipes: [{ sa: 58000, sb: 19100, sc: 14500, sd: 2900, stype: 51, sxtype: 0 }] }), fps);
      _input.mask = KEY.RIGHT;
      let guard = 5000;
      while (st.pipes[0].sgtype !== 1 && guard-- > 0) stepN(1);   // 走到砖组下方触发
      _input.mask = 0;
      // 触发帧已含一次部分加速（30Hz=120/60Hz=60/120Hz=30），从触发帧后统一测 Δsr
      const s0 = st.pipes[0].sr || 0, b0 = st.pipes[0].sb;
      step30(10);
      return {
        v: (st.pipes[0].sr - s0) * 30,          // Δsr×30 = 36000（跨刷新率精确一致）
        pos: (st.pipes[0].sb - b0) - s0 * 10,   // 扣除窗口初速贡献 → 纯加速位移 30Hz=6600
        hp: st.player.mhp,
      };
    },
  },

  // ---- 粒子 ----
  {
    name: 'particle.coin.gravity',
    desc: '金币粒子重力 ef=40/帧²（金币弹出参数 ed=-800/ef=40）：8帧后 ed=-480 → -14400/s',
    checks: [
      { key: 'v', ref: -480 * 30, tol: 0.002 },
      { key: 'pos', ref: -4960, tol: 0.08 },
    ],
    run(fps) {
      boot(makeDef(), fps);
      st.particles.push({ ea: 30000, eb: 20000, ec: 0, ed: -800, ee: 0, ef: 40, enobia: 3000, enobib: 3000, egtype: 0, etm: 999 });
      step30(8);
      const p = st.particles[0];
      if (!p) throw new Error('粒子被提前剔除');
      return { v: p.ed * 30, pos: p.eb - 20000 };
    },
  },

  // ---- 镜头 ----
  {
    name: 'camera.follow',
    desc: '镜头比例跟随平衡点：屏上 x 收敛于 2/3屏宽+mc（任意刷新率同值）',
    checks: [
      { key: 'screenX', ref: C.FXMAX * 2 / 3 + 701, tolAbs: 1500 },
      { key: 'fxMoved', ref: 1, tolAbs: 9999, atLeast: 1000 },
    ],
    run(fps) {
      boot(makeDef(), fps);
      _input.mask = KEY.RIGHT;
      step30(120);
      _input.mask = 0;
      return { screenX: st.player.ma - st.fx, fxMoved: st.fx };
    },
  },
];

// ---------------- 执行与报告 ----------------
function fmt(v) {
  if (typeof v !== 'number' || !isFinite(v)) return String(v);
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : (Math.round(v * 100) / 100).toString();
}

let totalChecks = 0, failed = 0;
const rows = [];

for (const sc of SCENARIOS) {
  const row = { name: sc.name, desc: sc.desc, cells: {}, errs: {} };
  let rowFail = false;
  for (const fps of FPS_LIST) {
    let measured;
    try {
      measured = sc.run(fps);
    } catch (err) {
      row.errs[fps] = '异常: ' + err.message;
      rowFail = true; failed += sc.checks.length; totalChecks += sc.checks.length;
      continue;
    }
    row.cells[fps] = measured;
  }
  // 逐检查项判定（以 30Hz 实测为准展示，全部 fps 都需通过）
  row.verdicts = sc.checks.map(function (ck) {
    const vals = {};
    let ok = true, bad = '';
    for (const fps of FPS_LIST) {
      const m = row.cells[fps];
      if (!m || row.errs[fps]) { ok = false; bad = row.errs[fps] || '无测量值'; vals[fps] = NaN; continue; }
      const v = m[ck.key];
      vals[fps] = v;
      if (typeof v !== 'number' || !isFinite(v)) { ok = false; bad = '测量值非数值'; continue; }
      if (ck.atLeast != null || ck.atMost != null) {
        if (ck.atLeast != null && !(Math.abs(v) >= ck.atLeast)) { ok = false; bad = '未达到下限 ' + ck.atLeast; }
        if (ck.atMost != null && !(Math.abs(v) <= ck.atMost)) { ok = false; bad = '超过上限 ' + ck.atMost; }
      } else {
        const refV = typeof ck.ref === 'function' ? ck.ref(fps) : ck.ref;  // 函数 ref：按帧率给期望（如重力补偿偏移）
        const limit = ck.tolAbs != null ? ck.tolAbs : Math.abs(refV) * ck.tol;
        if (Math.abs(v - refV) > limit) { ok = false; bad = '偏差 ' + fmt(v - refV) + ' 超容差 ±' + fmt(limit); }
      }
    }
    totalChecks++;
    if (!ok) failed++;
    else rowFail = false;
    return { ck: ck, vals: vals, refV: (typeof ck.ref === 'function' ? ck.ref(FPS_LIST[0]) : ck.ref), ok: ok, bad: bad };
  });
  row.fail = row.verdicts.some(function (v) { return !v.ok; }) || Object.keys(row.errs).length > 0;
  rows.push(row);
}

// 输出
console.log('================================================================');
console.log(' 新旧引擎物理速度一致性测试  基准=main.cpp(30Hz) 每帧常量×30');
console.log(' 引擎文件: game/engine.js  刷新率: ' + FPS_LIST.join('/'));
console.log('================================================================');

for (const row of rows) {
  console.log('');
  console.log((row.fail ? '[FAIL] ' : '[PASS] ') + row.name + ' —— ' + row.desc);
  for (const v of row.verdicts) {
    const refStr = v.ck.atLeast != null
      ? ('>=' + fmt(v.ck.atLeast) + (v.ck.atMost != null ? ' 且 <=' + v.ck.atMost : ''))
      : fmt(v.refV) + (v.ck.tolAbs != null ? ' ±' + fmt(v.ck.tolAbs) : ' ±' + (v.ck.tol * 100).toFixed(1) + '%');
    const ms = FPS_LIST.map(function (fps) {
      const x = v.vals[fps];
      return fps + 'Hz:' + (isFinite(x) ? fmt(x) : (row.errs[fps] || 'NaN'));
    }).join('  ');
    console.log('    ' + (v.ok ? '  ok  ' : ' FAIL ') + v.ck.key.padEnd(9) + ' 基准 ' + refStr.padEnd(22) + ' ' + ms + (v.ok ? '' : '  ← ' + v.bad));
  }
  for (const fps of FPS_LIST) {
    if (row.errs[fps]) console.log('    ' + fps + 'Hz 运行异常: ' + row.errs[fps]);
  }
}

console.log('');
console.log('================================================================');
console.log(' 检查项合计: ' + totalChecks + '，通过: ' + (totalChecks - failed) + '，失败: ' + failed);
console.log('================================================================');
process.exit(failed > 0 ? 1 : 0);
