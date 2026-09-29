'use strict';
// 方块机器人投掷测试：验证机器人能扔 蘑菇/馒头怪/假旗杆/终点旗杆
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

const _input = { mask: 0 };
const sandbox = { console, Image: function () { this.complete = false; this.naturalWidth = 0; } };
sandbox.window = sandbox;
vm.createContext(sandbox);

sandbox.Input = { get: () => _input.mask, consumeSuicide: () => false, endFrame() {} };
sandbox.AudioSys = { playSE() {}, stopSe() {}, bgmChange() {}, bgmStop() {}, bgmSuspend() {}, bgmResume() {}, unlock() {} };
sandbox.Sprites = { draw() {}, get() { return null; } };

function load(f) { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f }); }
load('game/constants.js');
let currentDef = null;
sandbox.Levels = { get: () => currentDef };
load('game/elements.js');
load('game/engine.js');

const C = sandbox.Constants;
const E = sandbox.GameEngine;
const st = E._state;

function makeDef(over) {
  const grid = [];
  for (let r = 0; r < 17; r++) grid.push(new Array(1001).fill(0));
  const def = { id: 'robot-throw', stagecolor: 1, scrollx: 99999999, grid, blocks: [], pipes: [], enemies: [], bg: [], lifts: [], spawn: { ma: 5600, mb: 32000 } };
  for (let c = 0; c <= 150; c++) { grid[13][c] = 5; grid[14][c] = 6; grid[15][c] = 6; grid[16][c] = 6; }
  if (over) Object.assign(def, over);
  return def;
}

function boot() {
  E.setFps(60); E.startGame();
  let guard = 10000; while (st.proc !== C.PROC.GAME && guard-- > 0) E._stepFrame();
  if (guard <= 0) throw new Error('未能进入 GAME');
}

let pass = 0, fail = 0;
function check(cond, msg) { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }

// 机器人(ba=41000) 在目标(ba=40000)右侧，玩家留在 spawn(ma=5600)。
// 玩家在左 → 机器人 amuki=0 向左走向目标；目标距玩家 34400 超出抓取/伤害窗口，安全。
// 投掷只持续 20 个 30Hz 帧(abrocktm=120→100 弹出)，故逐帧轮询捕获举起瞬间。
function scenarioThrow(targetBtype, targetBb) {
  currentDef = makeDef({ enemies: [
    { ba: 41000, bb: 32000, btype: 6, bxtype: 0 },
    { ba: 40000, bb: targetBb, btype: targetBtype, bxtype: 0 }
  ] });
  boot();
  let lifted = false;
  const frames = Math.round(80 * C.FPS / 30);
  for (let i = 0; i < frames; i++) {
    E._stepFrame();
    const re = st.enemies.find(e => e.atype === targetBtype && !e._goalPole);
    if (re && re.abrocktm > 0) { lifted = true; break; }
    if (st.player.mtype === C.MTYPE.DEAD) break;
  }
  return lifted;
}

// 场景1：机器人扔蘑菇(atype=100)
check(scenarioThrow(100, 32000), '机器人举起了蘑菇(abrocktm>0)');

// 场景2：机器人扔馒头怪(atype=0)
check(scenarioThrow(0, 32000), '机器人举起了馒头怪(abrocktm>0)');

// 场景3：机器人扔假旗杆(atype=85，高 30000)
check(scenarioThrow(85, 3000), '机器人举起了假旗杆(abrocktm>0)');

// 场景4（原版 main.cpp:3055-3074 ポール捨て）：axtype=1 机器人走到终点杆左侧拔杆扔出。
// spawnEnemy 判定：机器人 aa > 玩家中心 → amuki=0 向左走。故杆放机器人左侧：
// 杆 col=10 → sa=29000（拔杆窗口 aa∈[31000,32600]）；机器人 ba=40000 → 向左 ~75+ 帧(30Hz) 进入窗口。
// 玩家 spawn ma=30000：与机器人相距 10000 不重叠（不触发抓取），且站在杆右 1000 处——
// 杆非实心，玩家不会误通关；拔杆后杆消失更无碰撞。
// 抓杆 atm=100（举杆 20 帧 egtype=4 静止展示）→ atm=120 抛出（ec=600/ed=-1200/ef=160/etm=240）→ atm=140 复位。
(function () {
  const def = makeDef({
    enemies: [{ ba: 40000, bb: 32000, btype: 6, bxtype: 1 }],
    spawn: { ma: 30000, mb: 32000 }
  });
  def.grid[3][10] = 99; // 终点旗杆 col=10 row=3 → sa=29000
  currentDef = def;
  boot();
  const robot = () => st.enemies.find(e => e.atype === 6 && e.aa > -800000);
  const poleAlive = () => st.pipes.filter(s => s.stype === 300 && s.sa > -800000).length > 0;
  const poleParts = () => st.particles.filter(q => q.egtype === 4);

  let grabbed = false, thrown = false, ended = false;
  let grabParts = 0, throwParts = 0;
  let axtypeAtGrab = -1;
  const frames = Math.round(300 * C.FPS / 30);
  for (let i = 0; i < frames; i++) {
    E._stepFrame();
    const r = robot();
    if (!r) break;
    if (!grabbed && !poleAlive()) {          // 拔杆瞬间：杆消失、atm=100
      grabbed = true;
      axtypeAtGrab = r.axtype;
    }
    if (r.atm === 100) grabParts = Math.max(grabParts, poleParts().length);
    if (!thrown && r.atm === 120) {          // 抛出瞬间
      thrown = true;
      const tp = poleParts().find(q => q.ec === 600 && q.ed < 0);
      if (tp) throwParts++;
    }
    if (thrown && !ended && r.atm === 0) ended = true;   // atm=140 复位 → atm=0
    if (st.player.mtype === C.MTYPE.DEAD) break;
  }
  check(grabbed, 'axtype=1 机器人拔起了终点旗杆(stype=300 消失)');
  check(axtypeAtGrab === 1, '拔杆前 axtype 仍为 1（玩家未被抛投消耗）');
  check(grabParts > 0, '拔杆时生成 egtype=4 静止展示粒子');
  check(thrown && throwParts > 0, '抛出 egtype=4 飞行粒子(ec=600/上升)');
  check(ended, '拔杆流程完整结束(atm 复位 0)');
})();

// 场景5（负向）：axtype=0 普通机器人走到终点杆旁——原版行为：不拔杆
(function () {
  const def = makeDef({
    enemies: [{ ba: 40000, bb: 32000, btype: 6, bxtype: 0 }],
    spawn: { ma: 30000, mb: 32000 }
  });
  def.grid[3][10] = 99;
  currentDef = def;
  boot();
  const frames = Math.round(300 * C.FPS / 30);
  for (let i = 0; i < frames; i++) {
    E._stepFrame();
    if (st.player.mtype === C.MTYPE.DEAD) break;
  }
  check(st.pipes.filter(s => s.stype === 300 && s.sa > -800000).length > 0, 'axtype=0 机器人不拔杆（杆仍在）');
  check(st.particles.filter(q => q.egtype === 4).length === 0, 'axtype=0 机器人无杆粒子生成');
})();

console.log('\n合计: ' + (pass + fail) + ' 通过: ' + pass + ' 失败: ' + fail);
process.exit(fail > 0 ? 1 : 0);
