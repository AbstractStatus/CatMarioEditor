// 无头仿真：验证尖刺馒头怪(atype=4)跳跃跟随 bug
// 用法: node tools/_test_followjump.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const G = globalThis;
G.window = G;
G.devicePixelRatio = 1;
G.requestAnimationFrame = function () {};
G.addEventListener = function () {};

let curKey = 0;
G.Input = {
  init: function () {},
  get: function () { return curKey; },
  endFrame: function () {},
  consumeSuicide: function () { return false; }
};
G.AudioSys = new Proxy({}, { get: function () { return function () {}; } });
G.Sprites = { init: function (cb) { if (cb) cb(); } };

function load(rel) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'game', rel), 'utf8'), { filename: rel });
}
load('constants.js');
load('elements.js');

const C = G.Constants;

// 合成关卡：平地 + 一只尖刺馒头怪(btype=4/bxtype=1, uid 'e0')，放在第 100 列（镜头必滚动）
function makeDef(enemyCol) {
  const grid = [];
  for (let r = 0; r < 17; r++) {
    const row = [];
    for (let c = 0; c < 1001; c++) {
      row.push(r === 10 ? 5 : (r > 10 ? 6 : 0));
    }
    grid.push(row);
  }
  return {
    grid: grid,
    stagecolor: 1,
    scrollx: 900000,
    bgm: 100,
    blocks: [], pipes: [], lifts: [],
    enemies: [{ ba: enemyCol * 29 * 100, bb: (9 * 29 - 12) * 100, btype: 4, bxtype: 1, uid: 'e0' }],
    spawn: { ma: 3000, mb: 20000 }
  };
}

let currentDef = makeDef(100);
G.Levels = { get: function () { return currentDef; } };

load('engine.js');
const E = G.GameEngine;
const st = E._rawState();

function step(n, key) {
  curKey = key || 0;
  for (let i = 0; i < n; i++) {
    E._stepFrame();
    curKey = key || 0; // IN.get 每帧读取
  }
}

function findE0() {
  for (let i = 0; i < st.enemies.length; i++) {
    if (st.enemies[i].uid === 'e0') return st.enemies[i];
  }
  return null;
}

function runCase(enemyCol, label) {
  // 重置关卡
  st.sta = 1; st.stb = 1; st.stc = 0;
  currentDef = makeDef(enemyCol);
  E.startGame();
  step(70, 0); // STAGE_START → GAME

  // 把玩家放到敌人左侧 3 格处（同步镜头，避免相机追赶干扰）
  const enemyX = enemyCol * 29 * 100;
  const p = st.player;
  p.ma = enemyX - 3 * 2900;
  p.mb = 20000;
  p.mc = 0; p.md = 0;
  st.fx = p.ma - 20000; // 保持 screenX=20000（左 1/3 与右 2/3 之间，相机不动）
  if (st.fx < 0) st.fx = 0;
  st.fzx = st.fx;

  // 等玩家落地 + 敌人生成落地
  let e = null;
  for (let i = 0; i < 400; i++) {
    step(1, 0);
    e = findE0();
    if (e && e.axzimen === 1 && p.mzimen === 1) break;
  }
  if (!e) { console.log(label + ': 敌人未生成!'); return; }

  const before = { followJump: e.followJump, axtype: e.axtype, axzimen: e.axzimen, mzimen: p.mzimen, fx: st.fx, dist: Math.abs(p.ma + p.mnobia - (e.aa - st.fx) - 500) };

  // 按住跳跃 30 物理帧，观察敌人是否起跳（ad<0 或 ab 明显上升）
  const abBefore = e.ab;
  let jumped = false, minAd = 0;
  for (let i = 0; i < 30; i++) {
    step(1, C.KEY.JUMP);
    if (e.ad < minAd) minAd = e.ad;
    if (e.ad < -100 || e.ab < abBefore - 2000) jumped = true;
  }

  console.log(label + ':');
  console.log('  fx=' + st.fx + '  距离项=' + before.dist + ' (阈值9000)');
  console.log('  e.followJump=' + before.followJump + ' axtype=' + before.axtype + ' axzimen(起跳前每帧)=1');
  console.log('  玩家跳后敌人 minAd=' + minAd + '  →  ' + (jumped ? '跟着跳了 ✓' : '没有跟跳 ✗'));
  console.log('');
}

// 用例1：敌人在第 27 列（fx≈0，坐标混用恰好不暴露）
runCase(27, '近关首(enemyCol=27)');
// 用例2：敌人在第 100 列（fx 很大，模拟 1-3 e0 位置 92 列附近的场景）
runCase(100, '关卡深处(enemyCol=100)');

// 用例3：真实 1-3 关卡数据（stages_data.js + injectWorldDef 等价 uid 注入）
(function realStage13() {
  const src = fs.readFileSync(path.join(ROOT, 'stages_data.js'), 'utf8');
  const start = src.indexOf('[', src.indexOf('window.STAGES'));
  const STAGES = JSON.parse(src.slice(start, src.lastIndexOf(';')).trim());
  const def = STAGES.find(function (s) { return s.id === '1-3'; });
  def.enemies.forEach(function (en, ei) { if (!en.uid) en.uid = 'e' + ei; });
  // 1-3 e0 区域为悬空机关地形，给玩家/敌人铺一段临时立足地面（row12 起，col 90-115），
  // 仅提供站立面，不影响 e0 的触发器/属性链路验证
  for (let c = 90; c <= 115; c++) {
    def.grid[12][c] = 5;
    for (let r = 13; r < 17; r++) def.grid[r][c] = 6;
  }
  currentDef = def;
  st.sta = 1; st.stb = 3; st.stc = 0;
  E.startGame();
  step(70, 0);
  const p = st.player;
  p.ma = 292900 - 3 * 2900; p.mb = 20000; p.mc = 0; p.md = 0;
  st.fx = p.ma - 20000; st.fzx = st.fx;
  let e = null;
  for (let i = 0; i < 600; i++) {
    step(1, 0);
    e = findE0();
    if (e && e.axzimen === 1 && p.mzimen === 1) break;
  }
  if (!e) { console.log('真实1-3: 敌人 e0 未生成!'); return; }
  if (p.mzimen !== 1) { console.log('真实1-3: 玩家未落地（mb=' + p.mb + '），跳过'); return; }
  const abBefore = e.ab;
  let jumped = false, minAd = 0;
  for (let i = 0; i < 30; i++) {
    step(1, C.KEY.JUMP);
    if (e.ad < minAd) minAd = e.ad;
    if (e.ad < -100 || e.ab < abBefore - 2000) jumped = true;
  }
  console.log('真实1-3(e0, btype=4/bxtype=1):');
  console.log('  fx=' + st.fx + '  e.followJump=' + e.followJump + ' axtype=' + e.axtype);
  console.log('  玩家跳后敌人 minAd=' + minAd + '  →  ' + (jumped ? '跟着跳了 ✓' : '没有跟跳 ✗'));
})();
