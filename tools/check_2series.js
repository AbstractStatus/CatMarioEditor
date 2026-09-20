var fs = require('fs');
var src = fs.readFileSync('r:/PythonNewProcject/NewCatMarioEditor/stages_data.js', 'utf8');
var window = {};
eval(src);
var stages = window.STAGES;

function T(sa) { return Math.round(sa / 100 / 29); }
function R(sb) { return Math.round((sb / 100 + 12) / 29); }

// ---- 2-1 重点核查：g12_85 下方坠落地面 ----
var d21 = stages.find(function (s) { return s.id === '2-1'; });
console.log('== 2-1 grid[12] cols 80-95:', d21.grid[12].slice(80, 96).join(','));
console.log('== 2-1 grid[13] cols 25-40:', d21.grid[13].slice(25, 41).join(','));
console.log('   grid[13] cols 82-92 :', d21.grid[13].slice(82, 93).join(','));
console.log('   grid[13] cols 100-112:', d21.grid[13].slice(100, 113).join(','));
console.log('== 2-1 pipes:');
d21.pipes.forEach(function (p) {
  console.log('   stype=%d sxtype=%d col=%d row=%d wCols=%d hRows=%d',
    p.stype, p.sxtype, T(p.sa), R(p.sb), Math.floor((p.sc + 1) / 3000) + (p.sc % 3000 ? 1 : 0), Math.round(p.sd / 3000));
});
console.log('== 2-1 enemies:');
d21.enemies.forEach(function (e) {
  console.log('   btype=%d bxtype=%d col=%d row=%d', e.btype, e.bxtype, T(e.ba), R(e.bb));
});
console.log('== 2-1 blocks (last 8):');
d21.blocks.slice(-8).forEach(function (b) {
  console.log('   type=%d col=%d row=%d', b.type, Math.round(b.x / 29), Math.round((b.y + 12) / 29));
});

// ---- 2 系列汇总 ----
['2-2', '2-2-1', '2-2-2', '2-3', '2-4', '2-4-1', '2-4-2'].forEach(function (id) {
  var d = stages.find(function (s) { return s.id === id; });
  console.log('== ' + id + ' ==');
  d.pipes.forEach(function (p) {
    console.log('   pipe stype=%d sxtype=%d col=%d row=%d sc=%d sd=%d', p.stype, p.sxtype, T(p.sa), R(p.sb), p.sc, p.sd);
  });
  var byType = {};
  d.enemies.forEach(function (e) { byType[e.btype] = (byType[e.btype] || 0) + 1; });
  console.log('   enemies:', JSON.stringify(byType), 'lifts:', d.lifts.length);
  d.lifts.forEach(function (l) {
    console.log('   lift srsp=%d col=%d row=%d len=%d', l.srsp, T(l.sra), R(l.srb), Math.round(l.src / 3000));
  });
});
