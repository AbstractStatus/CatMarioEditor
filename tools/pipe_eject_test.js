#!/usr/bin/env node
'use strict';
// ===================================================================
// 喷出管道（进入事件 entry='eject'）行为自动化测试（无头，Node 直接运行）
//
// 用法：node tools/pipe_eject_test.js
//
// 移植基准：旧引擎 tiwb_catmario/src/main.cpp
//   - 触发：stype=40 sxtype=0（main.cpp:2554-2559「飛び出し」）→ mtype=100/mxtype=10
//   - 动画：mxtype=10「ふっとばし」（main.cpp:1904-1913）
//       mtm 1..16  沉入管内 ma+=240（16 步 ×240=3840）
//       mtm ==16   向上弹出 mb-=1100
//       mtm ==20   音效 soundplay(10)
//       mtm 24..47 沿开口方向喷出 2000/物理帧（24 步 ×2000=48000）+ 转身背对管口
//       mtm >=48   mtype=0; mhp--;（1 血即死 → mtype=200 死亡演出）
//   新引擎四方向泛化（编辑器「喷出管道」entry='eject'）：
//       dir='up'    沉入向下 → 向上喷出
//       dir='down'  沉入向上 → 向下喷出
//       dir='left'  沉入向右 → 向左喷出（=原版）
//       dir='right' 沉入向左 → 向右喷出
//   沉入按整数物理帧步进（mtm%1===0），喷出窗口 mtm∈[24,48) 按帧数计步，
//   保证 30/60/120Hz 在相同 mtm 检查点位置逐点一致。
// ===================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ---------------- 浏览器环境 mock（同 physics_speed_test.js） ----------------
const _input = { mask: 0 };
const sandbox = { console, Image: function () { this.complete = false; this.naturalWidth = 0; } };
sandbox.window = sandbox;
vm.createContext(sandbox);
sandbox.Input = { get: function () { return _input.mask; }, consumeSuicide: function () { return false; }, endFrame: function () {} };
sandbox.AudioSys = { playSE() {}, stopSe() {}, bgmChange() {}, bgmStop() {}, bgmSuspend() {}, bgmResume() {}, unlock() {} };
sandbox.Sprites = { draw() {}, get() { return null; } };

function load(f) { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f }); }
load('game/constants.js');
let currentDef = null;
sandbox.Levels = { get: function () { return currentDef; } };
load('game/elements.js');
load('game/engine.js');

const C = sandbox.Constants;
const E = sandbox.GameEngine;
const st = E._state;
const KEY = C.KEY;          // LEFT=1 RIGHT=2 DOWN=4 UP=8 JUMP=16

function stepN(n) { for (let i = 0; i < n; i++) E._stepFrame(); }

function boot(def, fps) {
  currentDef = def;
  E.setFps(fps);
  E.startGame();
  let guard = 10000;
  while (st.proc !== C.PROC.GAME && guard-- > 0) E._stepFrame();
  if (guard <= 0) throw new Error('startGame 后未能进入 GAME 状态');
}

// 平地关卡：row13 地面顶层(ttype5) + 14-16 填充(ttype6)，地面顶世界 y=36500
function makeDef(over) {
  const grid = [];
  for (let r = 0; r < 17; r++) grid.push(new Array(1001).fill(0));
  const def = {
    id: 'eject-test', stagecolor: 1, scrollx: 99999999,
    grid: grid,
    blocks: [], pipes: [], enemies: [], bg: [], lifts: [],
    spawn: { ma: 5600, mb: 32000 },
  };
  for (let c = 0; c <= 400; c++) { grid[13][c] = 5; grid[14][c] = 6; grid[15][c] = 6; grid[16][c] = 6; }
  if (over) Object.assign(def, over);
  return def;
}

// 等待玩家落地（mzimen===1）
function waitGround(maxFrames) {
  let guard = maxFrames || 300;
  while (st.player.mzimen !== 1 && guard-- > 0) E._stepFrame();
  if (guard <= 0) throw new Error('玩家未落地');
}

// 触发喷出：按方向键直到 mtype=100/mxtype=10；返回触发帧末的 {ma, mb}
function triggerEject(def, fps, keyMask) {
  boot(def, fps);
  waitGround();
  _input.mask = keyMask;
  let guard = 600;
  while (!(st.player.mtype === 100 && st.player.mxtype === 10) && guard-- > 0) E._stepFrame();
  if (guard <= 0) throw new Error('喷出未触发（mtype=100/mxtype=10）: mtype=' + st.player.mtype);
  const entry = { ma: st.player.ma, mb: st.player.mb, mtm: st.player.mtm };
  _input.mask = 0;
  return entry;
}

// 逐帧推进并按 mtm 检查点采样（整数 mtm；喷出全流程 mtm 1..48）
// 注意：必须精确匹配 p.mtm===检查点（_DT=1/0.5/0.25 均为 2 的幂，累加精确），
// 不能用 Math.round(mtm*2)/2 半步映射——120Hz 的 x.75 帧会被舍入成下一整数，
// 导致检查点被提前半步采样
function sampleByMtm(entry, checkpoints) {
  const out = {};
  let guard = 400;
  while (Object.keys(out).length < checkpoints.length && guard-- > 0) {
    E._stepFrame();
    const p = st.player;
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      if (out[cp] === undefined && Math.abs(p.mtm - cp) < 1e-9) {
        out[cp] = { ma: p.ma, mb: p.mb, mhp: p.mhp, mtype: p.mtype, mmuki: p.mmuki, mtm: p.mtm };
        break;
      }
    }
    if (p.mtype !== 100 && Object.keys(out).length < checkpoints.length) {
      // mtype 已退出（死亡/切关）而检查点未采满：补采当前帧
      for (const cp of checkpoints) if (out[cp] === undefined) out[cp] = { ma: p.ma, mb: p.mb, mhp: p.mhp, mtype: p.mtype, mmuki: p.mmuki, mtm: p.mtm, _late: true };
      break;
    }
  }
  if (guard <= 0) throw new Error('采样超时');
  return out;
}

// ---------------- 断言辅助 ----------------
let passCount = 0, failCount = 0;
function check(ok, name, detail) {
  if (ok) { passCount++; console.log('[PASS] ' + name + (detail ? ' —— ' + detail : '')); }
  else { failCount++; console.log('[FAIL] ' + name + (detail ? ' —— ' + detail : '')); }
}

const SINK_STEP = 240, SINK_FRAMES = 16, POP = 1100, BLAST_STEP = 2000, BLAST_FRAMES = 24;

// ===================================================================
// 场景 1：原版 stype=40 sxtype=0 左进入喷出管（1-2 地上 p1 / 2-2-1 p3 同数据）
// ===================================================================
(function scenario1() {
  const pipe = { sa: 17400, sb: 30700, sc: 3000, sd: 5800, stype: 40, sxtype: 0, sgtype: 0 };
  const def = makeDef({ pipes: [pipe], spawn: { ma: 15200, mb: 32000 } });
  const entry = triggerEject(def, 30, KEY.RIGHT);
  const p = st.player;
  check(p._pipeDir === 'left', 's1._pipeDir=left（原版 stype=40 无 dir 默认左开口）', '_pipeDir=' + p._pipeDir);
  check(entry.mtm < 1, 's1.触发帧 mtm=0', 'mtm=' + entry.mtm);

  // 采样检查点：mtm=8（沉入中）、16（沉入完成+弹出）、32（喷出中）、47（喷出末帧）、48（受伤）
  // 注：mtm 先加后判断（与原版 mstm++ 后 switch 一致），故 mtm=32 采样点已喷
  // mtm 24..32 共 9 步，mtm=47 采样点恰好喷满 24 步（24..47）
  const s = sampleByMtm(entry, [8, 16, 32, 47, 48]);
  const sinked = entry.ma + SINK_STEP * SINK_FRAMES;
  check(s[16] && Math.abs(s[16].ma - sinked) < 1e-6, 's1.mtm16 沉入 16 步×240=3840',
    'ma=' + s[16].ma + ' 期望=' + sinked);
  check(s[16] && Math.abs(s[16].mb - (entry.mb - POP)) < 1e-6, 's1.mtm16 向上弹出 1100',
    'mb=' + s[16].mb + ' 期望=' + (entry.mb - POP));
  const blasted32 = sinked - BLAST_STEP * (32 - 24 + 1);
  check(s[32] && Math.abs(s[32].ma - blasted32) < 1e-6, 's1.mtm32 喷出 9 步×-2000（含当前帧）',
    'ma=' + s[32].ma + ' 期望=' + blasted32);
  const blasted47 = sinked - BLAST_STEP * BLAST_FRAMES;
  check(s[47] && Math.abs(s[47].ma - blasted47) < 1e-6, 's1.mtm47 喷出 24 步×-2000=48000',
    'ma=' + s[47].ma + ' 期望=' + blasted47);
  check(s[47] && Math.abs(s[47].mb - (entry.mb - POP)) < 1e-6, 's1.喷出期间 md=0 高度不变（mtype=100 无重力）',
    'mb=' + s[47].mb);
  check(s[47] && s[47].mmuki === 0, 's1.喷出后转身背对管口（左喷 mmuki=0）', 'mmuki=' + (s[47] && s[47].mmuki));
  check(s[48] && s[48].mhp === 0 && s[48].mtype === 0, 's1.mtm48 mhp--（1血→0 未即时切死亡类型）',
    'mhp=' + (s[48] && s[48].mhp) + ' mtype=' + (s[48] && s[48].mtype));

  // 下一物理帧进入死亡演出
  E._stepFrame();
  check(st.player.mtype === C.MTYPE.DEAD, 's1.喷出结束次帧进入死亡（mtype=200）',
    'mtype=' + st.player.mtype);
  // 死亡日志原因（state._lastHurt 已在死亡流程消费；改为检查 _rawState 内部记录）
  // 阵亡事件日志：
  const evs = E.getEventLog();
  const death = evs.filter(function (e) { return e.kind === 'death'; }).pop();
  check(!!death && death.reason === 'pipe-eject', 's1.死亡日志 reason=pipe-eject',
    death ? death.reason + ' / ' + death.reasonCn : '无死亡事件');
})();

// ===================================================================
// 场景 2：编辑器管道 stype=50 + entry='eject' 四方向泛化
// ===================================================================
// dir='up'：竖管口在顶，玩家站管口上按 ↓
(function scenario2up() {
  // 3 格竖管：sa=col*2900+500, sb=row*2900-1200, sc=6000, sd=(3+1)*2900-100
  const col = 6, row = 10;
  const sa = col * 2900 + 500, sb = row * 2900 - 1200, sd = 4 * 2900 - 100;
  const pipe = { sa: sa, sb: sb, sc: 6000, sd: sd, stype: 50, sxtype: 1, sgtype: 0, entry: 'eject', dir: 'up' };
  // 玩家出生在管口上方：pl=sa+1200（需 ∈ (sa+800, sa+3000)）
  const def = makeDef({ pipes: [pipe], spawn: { ma: sa + 1200, mb: sb - 6000 } });
  const entry = triggerEject(def, 30, KEY.DOWN);
  const p = st.player;
  check(p._pipeDir === 'up', 's2up._pipeDir=up', '_pipeDir=' + p._pipeDir);
  const s = sampleByMtm(entry, [16, 47]);
  const sinked = entry.mb + SINK_STEP * SINK_FRAMES;
  check(s[16] && Math.abs(s[16].mb - sinked) < 1e-6, 's2up.mtm16 向下沉入 16 步×240',
    'mb=' + s[16].mb + ' 期望=' + sinked);
  check(s[16] && Math.abs(s[16].ma - entry.ma) < 1e-6, 's2up.竖管沉入无水平弹出（无 -1100 pop）',
    'ma=' + s[16].ma);
  const blasted = sinked - BLAST_STEP * BLAST_FRAMES;
  check(s[47] && Math.abs(s[47].mb - blasted) < 1e-6, 's2up.mtm47 沿开口向上喷出 24 步×-2000',
    'mb=' + s[47].mb + ' 期望=' + blasted);
  check(s[47] && Math.abs(s[47].ma - entry.ma) < 1e-6, 's2up.垂直喷出无水平位移', 'ma=' + s[47].ma);
  // 采样停在 mtm=47，mtm48 受伤 mtype=0、次帧才切死亡类型：等待数帧确认
  let g = 3;
  while (st.player.mtype !== C.MTYPE.DEAD && g-- > 0) E._stepFrame();
  check(st.player.mtype === C.MTYPE.DEAD, 's2up.死亡确认', 'mtype=' + st.player.mtype);
})();

// dir='right'：横管口朝右，玩家在管口右侧按 ←
(function scenario2right() {
  const col = 6, row = 11;
  const sa = col * 2900, sb = (row * 29 - 12) * 100, sc = 2 * 2900 - 100, sd = 6000;
  const pipe = { sa: sa, sb: sb, sc: sc, sd: sd, stype: 50, sxtype: 1, sgtype: 0, entry: 'eject', dir: 'right' };
  const R = sa + sc;
  // 玩家在管口右侧着地：pl≈R
  const def = makeDef({ pipes: [pipe], spawn: { ma: R + 200, mb: 32000 } });
  const entry = triggerEject(def, 30, KEY.LEFT);
  const p = st.player;
  check(p._pipeDir === 'right', 's2right._pipeDir=right', '_pipeDir=' + p._pipeDir);
  const s = sampleByMtm(entry, [16, 47]);
  const sinked = entry.ma - SINK_STEP * SINK_FRAMES;
  check(s[16] && Math.abs(s[16].ma - sinked) < 1e-6, 's2right.mtm16 向左沉入管内 16 步×240',
    'ma=' + s[16].ma + ' 期望=' + sinked);
  check(s[16] && Math.abs(s[16].mb - (entry.mb - POP)) < 1e-6, 's2right.mtm16 横管向上弹出 1100',
    'mb=' + s[16].mb);
  const blasted = sinked + BLAST_STEP * BLAST_FRAMES;
  check(s[47] && Math.abs(s[47].ma - blasted) < 1e-6, 's2right.mtm47 沿开口向右喷出 24 步×+2000',
    'ma=' + s[47].ma + ' 期望=' + blasted);
  check(s[47] && s[47].mmuki === 1, 's2right.右喷 mmuki=1', 'mmuki=' + (s[47] && s[47].mmuki));
  // 同 s2up：采样停在 mtm=47，等待数帧确认死亡
  let g2 = 3;
  while (st.player.mtype !== C.MTYPE.DEAD && g2-- > 0) E._stepFrame();
  check(st.player.mtype === C.MTYPE.DEAD, 's2right.死亡确认', 'mtype=' + st.player.mtype);
})();

// ===================================================================
// 场景 3：跨刷新率一致性（30/60/120Hz 相同 mtm 检查点逐点一致）
// ===================================================================
(function scenario3() {
  const pipe = { sa: 17400, sb: 30700, sc: 3000, sd: 5800, stype: 40, sxtype: 0, sgtype: 0 };
  const mk = function () { return makeDef({ pipes: [pipe], spawn: { ma: 15200, mb: 32000 } }); };
  const cps = [4, 8, 16, 24, 32, 40, 47, 48];
  const ref = sampleByMtm(triggerEject(mk(), 30, KEY.RIGHT), cps);
  [60, 120].forEach(function (fps) {
    const s = sampleByMtm(triggerEject(mk(), fps, KEY.RIGHT), cps);
    let ok = true, detail = [];
    cps.forEach(function (cp) {
      if (!ref[cp] || !s[cp]) { ok = false; detail.push('mtm' + cp + ':缺采样'); return; }
      if (Math.abs(ref[cp].ma - s[cp].ma) > 1e-6) {
        ok = false; detail.push('mtm' + cp + ' ma: ' + s[cp].ma + ' vs ' + ref[cp].ma); return;
      }
      // mtm48 为死亡切换帧（mtype=100→0 恢复重力）：非 30Hz 帧含引擎既定的帧率补偿
      // 位移 mb -= GRAVITY·DT·(1-DT)/2（hd39 机制，30Hz 基准补偿=0），下一帧即进入
      // 死亡演出接管位置，故 mb 不做逐点比较
      if (cp < 48 && Math.abs(ref[cp].mb - s[cp].mb) > 1e-6) {
        ok = false; detail.push('mtm' + cp + ' mb: ' + s[cp].mb + ' vs ' + ref[cp].mb);
      }
    });
    check(ok, 's3.' + fps + 'Hz 与 30Hz 轨迹逐点一致（沉入/喷出整数步进）', detail.join(' '));
  });
})();

// ===================================================================
// 场景 4：回归——stype=40 sxtype=2 仍为普通换关管（1-2-1 p4 语义，stc++）
// ===================================================================
(function scenario4() {
  const pipe = { sa: 17400, sb: 30700, sc: 3000, sd: 5800, stype: 40, sxtype: 2, sgtype: 0 };
  const def = makeDef({ pipes: [pipe], spawn: { ma: 15200, mb: 32000 } });
  boot(def, 30);
  waitGround();
  _input.mask = KEY.RIGHT;
  let guard = 600;
  while (!(st.player.mtype === 100 && st.player.mxtype === 1) && guard-- > 0) E._stepFrame();
  _input.mask = 0;
  check(guard > 0, 's4.sxtype=2 仍走普通进管 mxtype=1', 'mtype=' + st.player.mtype + ' mxtype=' + st.player.mxtype);
  guard = 600;
  while (st.proc === C.PROC.GAME && guard-- > 0) E._stepFrame();
  check(guard > 0 && st.stc === 1, 's4.沉管动画结束 stc++ 换关（未喷出未死亡）',
    'proc=' + st.proc + ' stc=' + st.stc + ' mhp=' + st.player.mhp);
})();

// ===================================================================
// 汇总
// ===================================================================
console.log('================================================================');
console.log(' 检查项合计: ' + (passCount + failCount) + '，通过: ' + passCount + '，失败: ' + failCount);
console.log('================================================================');
process.exit(failCount > 0 ? 1 : 0);
