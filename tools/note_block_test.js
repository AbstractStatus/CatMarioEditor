'use strict';
// 音符块(117)/跳台(120)测试：验证 1-3 隐藏桃色音符块的完整链路
//   txtype=0 隐形 → 触碰显形(txtype=1, 桃色) → mtype=2 匀速上升(md=-1500/30Hz帧) →
//   冲出屏幕顶(mb<=-6000) → stc+=5 传送到上空子关(1-3 地上→1-3-5 空中区)；
//   txtype>=2 白色音符块 = 普通大跳(md=-1600) 不传送（原版 main.cpp:2119-2124/1861-1875）
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

const C = sandbox.Constants;

// 关卡提供器：记录坐标调用，按坐标表返回对应 def（模拟 play.html 的世界链解析）
const coordCalls = [];
const stageMap = {};
let currentDef = null;
sandbox.Levels = {
  get: function (sta, stb, stc) {
    coordCalls.push([sta, stb, stc]);
    return stageMap[sta + ',' + stb + ',' + stc] || currentDef;
  }
};

load('game/elements.js');
load('game/engine.js');

const E = sandbox.GameEngine;
const st = E._state;

function makeDef(over) {
  const grid = [];
  for (let r = 0; r < 17; r++) grid.push(new Array(1001).fill(0));
  const def = { id: 'note-test', stagecolor: 1, scrollx: 99999999, grid, blocks: [], pipes: [], enemies: [], bg: [], lifts: [], spawn: { ma: 53000, mb: 20000 } };
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

// ==================== 场景1：隐形桃色音符块 → 显形 → 弹升 → 传送到 1-3-5 ====================
(function () {
  coordCalls.length = 0;
  // 模拟 1-3 地上(0)：一块 txtype=0 隐藏音符块（1-3 的 b2/b3/b4 同参数），玩家从其正上方落下
  const groundDef = makeDef({
    id: '1-3', sta: 1, stb: 3, stc: 0,
    blocks: [{ x: 522, y: 320, type: 117, xt: 0 }]
  });
  // 1-3-5 空中区（stagecolor=3，spawn ma=3000/mb=33000，与 stages_data.js 一致）
  const skyDef = makeDef({ id: '1-3-5', sta: 1, stb: 3, stc: 5, stagecolor: 3, spawn: { ma: 3000, mb: 33000 } });
  stageMap['1,3,5'] = skyDef;
  currentDef = groundDef;
  boot();

  const note = st.blocks.find(b => b.ttype === 117);
  check(!!note && note.txtype === 0, '初始隐形（txtype=0，引擎不绘制）');

  // 玩家落到块上：捕获弹跳帧 → 上升帧 → 传送
  let bounced = false, rose = false, transferred = false;
  let mdAtBounce = 0, mtAtBounce = 0;
  const frames = Math.round(240 * C.FPS / 30);
  for (let i = 0; i < frames; i++) {
    E._stepFrame();
    const p = st.player;
    if (!bounced && p.mtype === C.MTYPE.NOTE) {
      bounced = true; mdAtBounce = p.md; mtAtBounce = p.mtype;
    }
    if (bounced && !transferred) {
      // mtype=2 期间每帧强制 md=-1500（60Hz 积分 -750/帧 = 30Hz -1500/帧）
      if (p.mtype === C.MTYPE.NOTE && p.md !== -1500) { check(false, 'mtype=2 期间 md 恒为 -1500'); rose = true; }
      if (p.mb < 30000) rose = true;
    }
    if (st.stc === 5) { transferred = true; break; }
    if (p.mtype === C.MTYPE.DEAD) break;
  }
  check(bounced, '触碰后进入 mtype=2 弹升状态');
  check(mdAtBounce === -1500 && mtAtBounce === C.MTYPE.NOTE, '弹起初速 md=-1500');
  check(note.txtype === 1, '隐形块触碰后显形（txtype 0→1，渲染 grap[4][5] 桃色）');
  check(rose, '匀速持续上升(mb 递减)');
  check(transferred, '冲出屏幕顶后 stc+=5 传送到上空子关');
  if (transferred) {
    const hit = coordCalls.some(cc => cc[0] === 1 && cc[1] === 3 && cc[2] === 5);
    check(hit, 'Levels.get(1,3,5) 被调用（载入 1-3-5 空中区）');
    // STAGE_START 流程走完，落到空中区地面且存活
    let guard = Math.round(120 * C.FPS / 30);
    while (st.proc !== C.PROC.GAME && guard-- > 0) E._stepFrame();
    check(st.proc === C.PROC.GAME, '空中区载入完成进入 GAME');
    check(st.player.mhp > 0 && st.player.mtype !== C.MTYPE.DEAD, '空中区玩家存活');
    check(st.player.ma === 3000 || st.player.mb <= 42000, '空中区出生点生效(ma=3000)');
  }
  delete stageMap['1,3,5'];
})();

// ==================== 场景2：白色音符块(txtype=3) → 普通大跳不传送 ====================
(function ()  {
  coordCalls.length = 0;
  const def = makeDef({ id: '1-3w', sta: 1, stb: 3, stc: 0, blocks: [{ x: 522, y: 320, type: 117, xt: 3 }] });
  currentDef = def;
  boot();
  const note = st.blocks.find(b => b.ttype === 117);
  check(note.txtype === 3, '白色音符块初始可见(txtype=3，渲染 grap[3][5])');

  let sawBigJump = false, transferred = false, everNote = false;
  const frames = Math.round(240 * C.FPS / 30);
  for (let i = 0; i < frames; i++) {
    E._stepFrame();
    const p = st.player;
    if (p.md === -1600 && p.mtype === 0) sawBigJump = true;
    if (p.mtype === C.MTYPE.NOTE) everNote = true;
    if (st.stc !== 0) { transferred = true; break; }
  }
  check(sawBigJump, '触碰后普通大跳(md=-1600, mtype=0)');
  check(!everNote, '不进入 mtype=2 上升/传送状态');
  check(!transferred && st.stc === 0, '不触发 stc+=5 传送');
  check(note.txtype === 3, 'txtype 保持 3（显形白色，main.cpp:2122）');
})();

// ==================== 场景3：跳台(120) → 弹飞出屏顶死亡 ====================
(function () {
  const def = makeDef({ id: 'pad', blocks: [{ x: 522, y: 320, type: 120, xt: 0 }] });
  currentDef = def;
  boot();
  let sawPad = false, died = false;
  const frames = Math.round(240 * C.FPS / 30);
  for (let i = 0; i < frames; i++) {
    E._stepFrame();
    const p = st.player;
    if (p.mtype === C.MTYPE.JUMP_PAD) sawPad = true;
    if (p.mtype === C.MTYPE.DEAD || p.mhp <= 0) { died = true; break; }
  }
  check(sawPad, '跳台触碰进入 mtype=3(md=-2400 匀速上升)');
  check(died, '冲出屏幕顶后死亡(main.cpp:1872-1875)');
  check(st._lastHurt && st._lastHurt.reason === 'jump-pad', '死亡原因记录为 jump-pad');
})();

console.log('\n合计: ' + (pass + fail) + ' 通过: ' + pass + ' 失败: ' + fail);
process.exit(fail > 0 ? 1 : 0);
