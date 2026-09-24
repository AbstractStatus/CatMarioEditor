# 陷阱触发区重构为「方向 + 对象」模型 实施方案

## Context

当前陷阱触发区 `_trapzone` 用原版 stype 100-104 五种类型分类（100 猫脸怪/101 天降幽灵/102 按 sxtype 天降敌人/103 激光炮/104 光束）。每种 stype 的生成位置、对象、行为都硬编码在 [game/elements.js PipeTypes[100..104]](file:///r:/PythonNewProcject/NewCatMarioEditor/game/elements.js#L561-L629) 中，扩展性差。

用户要求简化为 **4 种方向类型**（上/下/左/右生成）+ **任意元素作为对象**。例如：
- 天降白幽灵 = 上生成 + 白幽灵
- 激光炮 = 右生成 + 激光
- 横火焰 = 右生成 + 横火焰
- 地面生成白幽灵 = 下生成 + 白幽灵
- 天降馒头怪 = 上生成 + 馒头怪
- 地下发出馒头怪 = 下生成 + 馒头怪

原版 stype 100-104 关卡数据（如示例世界 1-1）在载入时自动转换为新模型。生成位置统一按"方向 + AABB 边缘"推导。

## 设计概要

### 数据模型

**编辑器实例**（[editor.js state.elements](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L46-L57)）：
```js
{
  id: '_trapzone', col, row, uid,
  trap: {
    dir: 'up' | 'down' | 'left' | 'right',
    target: 'enemy_ghost',  // elementId，下拉选所有 cat=enemy/item/block/bg 元素
    sa, sb, sc, sd          // AABB 世界单位（保留）
  }
}
```

**引擎 pipe**（[play.html convert](file:///r:/PythonNewProcject/NewCatMarioEditor/play.html#L505-L513) 输出，[engine.js loadStage](file:///r:/PythonNewProcject/NewCatMarioEditor/game/engine.js#L204-L291) 透传）：
```js
{
  sa, sb, sc, sd,
  stype: 105,              // 通用陷阱（新增）
  dir: 'up'|'down'|'left'|'right',
  targetCat: 'enemy',      // 元素类别（engine 侧按 cat 分发）
  targetAtype: 3,          // cat=enemy/item 时用
  targetTtype: 0,          // cat=block 时用
  targetNtype: 0,          // cat=bg 时用
  uid
}
```

### 生成位置规则（按方向 + AABB）

参考 [engine.js spawnEnemy](file:///r:/PythonNewProcject/NewCatMarioEditor/game/engine.js#L352) 签名 `(xa, xb, xc, xd, xnotm, xtype, xxtype, xbdir)`，单位世界单位：

| 方向 | 生成 x（世界单位） | 生成 y（世界单位） | 含义 |
|---|---|---|---|
| up | `s.sa + s.sc/2` | `s.sb - 3000` | AABB 上方 30px 下落进入 |
| down | `s.sa + s.sc/2` | `s.sb + s.sd` | AABB 下方地面生成 |
| left | `s.sa - 3000` | `s.sb + s.sd/2` | AABB 左侧 30px |
| right | `s.sa + s.sc` | `s.sb + s.sd/2` | AABB 右侧 |

方块/背景同位置规则，用 `ta/tb` 或 `na/nb` 字段。

### 元素支持范围

| cat | 生成方式 | 引擎字段 |
|---|---|---|
| enemy | `spawnEnemy(x, y, 0, 0, 0, atype, 0)` | targetAtype |
| item | `spawnEnemy(x, y, 0, 0, 0, atype, 0)`（道具复用 spawnEnemy，原版道具就是 atype） | targetAtype |
| block | `state.blocks.push({ta, tb, ttype, txtype:0, thp:0, titem:0, uid})` | targetTtype |
| bg | `state.bg.push({na, nb, ntype, uid})` | targetNtype |

下拉过滤掉 `struct`（管道/旗杆/升降台生成逻辑复杂无意义）和 `audio`（音乐类无生成意义）。

## 实施步骤

### 1. 新增「激光」元素 — [elements.js](file:///r:/PythonNewProcject/NewCatMarioEditor/elements.js)

在 `enemy_beam` 附近添加：
```js
{ id: 'enemy_laser', cat: 'enemy', name: '激光', kind: 'vector',
  tw: 4, th: 1, atype: 79,
  hint: 'atype=79：横向扁矩形激光（120×15px），原版 stype103/104 陷阱触发后生成。静止不动，碰到即死' }
```
- `kind: 'vector'` 因为无图片资源，编辑器画布按引擎实际渲染（黄色矩形+黑描边）矢量绘制
- `tw: 4, th: 1` 因为 120px≈4 格宽、15px<1 格高

### 2. 修改 `_trapzone` 元素定义 — [elements.js L96-100](file:///r:/PythonNewProcject/NewCatMarioEditor/elements.js#L96-L100)

```js
{ id: '_trapzone', cat: 'struct', name: '陷阱触发区', kind: 'special', img: 'enemy/enemy_ghost.png',
  tw: 1, th: 1, trapDir: 'up', trapTarget: 'enemy_ghost', trapW: 7000, trapH: 70000,
  hint: '方向+对象模型：玩家进入 AABB 区域时按方向生成对象。方向=上/下/左/右（生成位置）；对象=任意敌人/方块/道具/背景元素。画布以虚线框+方向箭头+对象图标显示' }
```
移除 `trapStype/trapSxtype`，新增 `trapDir/trapTarget`。

### 3. 编辑器 `add()` 默认 trap — [editor.js L529-538](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L529-L538)

```js
if (d.id === '_trapzone') {
  ne.trap = {
    dir: d.trapDir || 'up',
    target: d.trapTarget || 'enemy_ghost',
    sa: col * 2900,
    sb: (row * 29 - 12) * 100,
    sc: d.trapW || 7000,
    sd: d.trapH || 70000
  };
}
```

### 4. 重写 `drawTrapPreview` — [editor.js L654-726](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L654-L726)

新签名 `drawTrapPreview(dir, target, ax, ay, aw, ah)`：
- 按 dir 计算生成位置（画布像素）：up=ay-30, down=ay+ah, left=ax-30, right=ax+aw
- 在生成位置画对象图标：
  - cat=enemy/item/block/bg → 用 `getImg(CAT.byId(target))` 画精灵图（按 tw×th 格缩放）
  - enemy_laser 特殊：矢量画黄色矩形（120×15px 比例）+ 黑描边（与 [engine.js drawEnemy atype=79](file:///r:/PythonNewProcject/NewCatMarioEditor/game/engine.js#L1655-L1663) 一致）
- 在生成位置外侧画方向箭头（白色细线，指向生成方向）

### 5. 修改 `_trapzone` 渲染块标签 — [editor.js L728-766](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L728-L766)

- 颜色按方向区分（统一视觉）：up=#c084fc 紫 / down=#ff5c5c 红 / left=#fbbf24 黄 / right=#38bdf8 蓝
- 标签文字：「↑对象名 / ↓对象名 / ←对象名 / →对象名」（对象名取 `CAT.byId(target).name`）

### 6. 重写属性编辑器 — [editor.js L1899-1912](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L1899-L1912)

移除 `fTzStype/fTzSxtype`，新增：
- `fTzDir`：下拉「↑ 上生成 / ↓ 下生成 / ← 左生成 / → 右生成」
- `fTzTarget`：下拉，按 cat 分组 optgroup（敌人/方块/道具/背景），列出所有 cat=enemy/item/block/bg 元素（用 `CAT.ELEMENTS.filter` 过滤）
- `fTzW`：数字输入 1-50（默认 trapW/2900≈2.4 格）
- `fTzH`：数字输入 1-50（默认 trapH/2900≈24 格）

### 7. 修改保存逻辑 — [editor.js L2157-2164](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L2157-L2164)

```js
if (fTzDir) {
  if (!selected.trap) selected.trap = { sa: selected.col*2900, sb:(selected.row*29-12)*100, sc:7000, sd:70000 };
  selected.trap.dir = fTzDir.value;
  selected.trap.target = fTzTarget.value;
  selected.trap.sc = parseInt(fTzW.value, 10) * 2900;
  selected.trap.sd = parseInt(fTzH.value, 10) * 2900;
  selected.trap.sa = selected.col * 2900;
  selected.trap.sb = (selected.row * 29 - 12) * 100;
}
```

### 8. 序列化兼容 — [editor.js L3916-3923](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L3916-L3923)

```js
if (e.id === '_trapzone' && e.trap) {
  var tz = e.trap;
  out.trap = {
    dir: tz.dir || 'up',
    target: tz.target || 'enemy_ghost',
    sa: tz.sa|0, sb: tz.sb|0, sc: tz.sc|0, sd: tz.sd|0
  };
}
```
旧 JSON（含 stype/sxtype）载入时若发现 `trap.stype`，按下方映射转换为新模型。

### 9. worldToElements 原版兼容映射 — [editor.js L3521-3527](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L3521-L3527)

```js
} else if (p.stype >= 100 && p.stype <= 104) {
  var dirMap = { 100:'down', 101:'up', 103:'right', 104:'right' };
  var targetMap = { 100:'enemy_ghost', 101:'enemy_ghost', 103:'enemy_laser', 104:'enemy_laser' };
  var dir = dirMap[p.stype] || 'up';
  var target = targetMap[p.stype] || 'enemy_syobon';
  if (p.stype === 102) {
    // 102 按 sxtype 映射敌人
    var map102 = { 0:'enemy_syobon', 1:'enemy_king', 2:'enemy_tongue_cat',
      4:'enemy_tongue_cat', 9:'enemy_ghost', 12:'enemy_flame' };
    target = map102[p.sxtype] || 'enemy_syobon';
    // sxtype=1 是地面附近生成（sb=44000），归为 down
    dir = (p.sxtype === 1) ? 'down' : 'up';
  }
  add('_trapzone', col, row, {
    trap: { dir: dir, target: target, sa: p.sa, sb: p.sb, sc: p.sc, sd: p.sd }
  }, puid);
}
```

### 10. play.html 转换 — [play.html L505-513](file:///r:/PythonNewProcject/NewCatMarioEditor/play.html#L505-L513)

```js
} else if (id === '_trapzone') {
  var tz = e.trap || {};
  var tdef = CAT.byId(tz.target) || {};
  pipes.push({
    sa: tz.sa|0, sb: tz.sb|0, sc: tz.sc|0, sd: tz.sd|0,
    stype: 105,
    dir: tz.dir || 'up',
    targetCat: tdef.cat || 'enemy',
    targetAtype: tdef.atype != null ? tdef.atype : 0,
    targetTtype: tdef.ttype != null ? tdef.ttype : (tdef.mapId != null ? tdef.mapId : 0),
    targetNtype: tdef.ntype != null ? tdef.ntype : 0,
    uid: e.uid || null
  });
  used++;
}
```

### 11. 新增 PipeTypes[105] — [game/elements.js](file:///r:/PythonNewProcject/NewCatMarioEditor/game/elements.js) 在 PipeTypes[104] 后

```js
// stype 105: 通用陷阱（编辑器「方向+对象」模型）
PipeTypes[105] = makeTrapType(function (p, s, xx, state, A, spawnEnemy) {
  var dx = 0, dy = 0;
  if (s.dir === 'up')         { dx = s.sc / 2; dy = -3000; }
  else if (s.dir === 'down')  { dx = s.sc / 2; dy = s.sd; }
  else if (s.dir === 'left')  { dx = -3000;    dy = s.sd / 2; }
  else                        { dx = s.sc;     dy = s.sd / 2; }  // right
  var gx = s.sa + dx, gy = s.sb + dy;
  
  if (s.targetCat === 'block') {
    state.blocks.push({
      ta: gx, tb: gy, ttype: s.targetTtype, txtype: 0, thp: 0, titem: 0,
      uid: s.uid ? s.uid + '#trap' : null
    });
  } else if (s.targetCat === 'bg') {
    state.bg.push({
      na: gx, nb: gy, ntype: s.targetNtype,
      uid: s.uid ? s.uid + '#trap' : null
    });
  } else {
    // enemy / item / 默认
    spawnEnemy(gx, gy, 0, 0, 0, s.targetAtype, 0);
  }
  s.sa = -800000000; A.playSE(10);
});
```

### 12. engine.js loadStage 透传字段 — [game/engine.js L204+](file:///r:/PythonNewProcject/NewCatMarioEditor/game/engine.js#L204)

`def.pipes.forEach` 注册 pipe 时，原样透传 `dir/targetCat/targetAtype/targetTtype/targetNtype`（引擎不解析，仅 onCollide 用）。检查现有注册逻辑是否已 spread 所有字段，若未 spread 则补充。

## 验证

### 语法验证
```
node --check r:\PythonNewProcject\NewCatMarioEditor\editor.js
node --check r:\PythonNewProcject\NewCatMarioEditor\elements.js
node --check r:\PythonNewProcject\NewCatMarioEditor\game\elements.js
node --check r:\PythonNewProcject\NewCatMarioEditor\game\engine.js
```

### 功能验证（浏览器）
1. `python -m http.server 8765` 启动服务器
2. 打开 `http://localhost:8765/index.html`
3. 载入示例世界 1-1：原 5 个 stype 100-104 陷阱触发区应自动转换为：
   - col 20 stype=100 → ↓白幽灵
   - col 53 stype=101 → ↑白幽灵
   - col 112 stype=102 sxtype=0 → ↑馒头怪
   - col 117 stype=103 → →激光
   - col 125 stype=101 → ↑白幽灵
4. 选中一个陷阱触发区，⚙属性面板应显示：方向下拉 + 对象下拉 + 宽高输入（不再有 stype/sxtype）
5. 改方向/对象后画布预览应实时更新（方向箭头 + 对象图标）
6. 试玩：陷阱触发后应按方向生成对应对象（↑=从上方下落，↓=地面生成，→=右侧出现）

### 像素扫描验证（参考前一轮）
用 browser_evaluate 扫描画布，确认各方向陷阱触发区按颜色（紫/红/黄/蓝）绘制虚线框 + 对应方向箭头 + 对象图标。

## 风险与边界

- **原版 1:1 还原**：新模型用 stype=105，原版 100-104 关卡载入后行为等价但内部 stype 变了。`state._worldDef` 保留原 def，试玩时若 `_worldDef` 存在且未编辑，可走原 def 直接转换（保留 stype 100-104）以 100% 还原；编辑过的关卡走新 stype=105。
- **struct/audio 元素**：下拉过滤掉，不支持作为陷阱对象。
- **激光元素 atype=79**：ENEMY_SIZE[79]=[12000,1500] 已存在，spawnEnemy 直接可用。
- **方块/背景生成**：原版无此场景，新模型支持但行为可能奇怪（浮空方块/背景出现在玩家区），属用户自定义责任。
