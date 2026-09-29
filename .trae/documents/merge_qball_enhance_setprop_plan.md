# 合并问号球 + 增强「改属性」事件动作

## Context（背景）

当前编辑器里有两个外观相同（都用 `item/item_green_question.png`）但分属不同类别的元素：
- `block_qball`（struct 类别，「问号球(触碰事件)」）：带 `events: []`，玩家触碰即执行事件动作并消失。
- `item_green_question`（item 类别，「绿色问号球」）：`atype=105`，只是个普通道具，无事件行为。

原版游戏里 atype=105 绿问号球本身就是「触碰触发事件」的元素，所以 `item_green_question` 是冗余副本。用户要求合并为同一个元素，并增强其事件动作列表里的「改属性」(setprop) 动作：目前只能改 `txtype/ttype/sxtype` 三个数字字段，需扩展为能改任意元素的全部可编辑属性，包括行列位置；目标若是管道，则对应管道专属属性（长度/方向/进入事件/喷射）。编辑器用友好名展示，引擎运行时自动换算到对应世界坐标字段。

用户已确认：覆盖**全部可编辑属性** + **编辑器友好名 + 引擎自动换算**。

## 方案

### Part A：合并两个问号球元素

1. **elements.js ~L173-174**：删除 `item_green_question` 元素定义。
2. **elements.js ~L105-108**：把 `block_qball` 的 `name` 改为「绿色问号球(触碰事件)」，更新 `hint` 说明它就是原版 atype=105 绿问号球（触碰执行事件并消失），合并自旧 `item_green_question`。
3. **editor.js ~L4006-4010 (`wEnemyId`)**：把 `105: 'item_green_question'` 改为 `105: 'block_qball'`，让导入原版关卡时 atype=105 映射到合并后的元素（导入后 events 为空，需用户手动配事件，符合预期）。
4. **editor.js ~L4007 周边的 atype→id 表**已无其他 `item_green_question` 引用需要清理；palette 自动按 `CAT.ELEMENTS` 重建，无需手动改。
5. 检查 play.html L332 (`item_green_question: { t: 105, xt: 0 }`)：这是原版 atype→精灵索引的映射表，与编辑器元素无关（block_qball 走 `eventTriggers` 渲染路径，见 engine.js L2352-2358），保留不动。
6. 调色板里 `item` 分类会少一个「绿色问号球」；`struct` 分类里 `block_qball` 改名后即是合并入口。

### Part B：编辑器 — setprop 动态字段下拉

在 `editor.js` 的 `buildEventsEditor()`（~L1801）里，setprop 分支（~L1855-1867）目前硬编码 3 个字段。改为根据**所选目标元素的类型**动态生成字段列表与对应的值输入控件。

新增辅助函数 `setpropFieldsFor(targetEl)`：传入目标元素实例（含 `id`），返回字段描述数组 `[{field, label, kind, opts?}]`，`kind` ∈ `num/enum/bool/ref`。字段目录（按元素 id）：

| 元素 | 友好字段 |
|---|---|
| 通用（所有非触发器） | `col`（列）、`row`（行）|
| `pipe_mouth` | `length`（管身长度,1-20）、`dir`（开口方向:up/down/left/right）、`entry`（进入事件:none/trap/warp）、`spray`（是否喷射:yes/no）、`sprayTarget`（喷射对象,enemy 列表）|
| `block_question`/`block_hidden` | `pop`（弹出对象:coin/mushroom/poison/enemy/flower/badstar/pswitch）、`mass`（量产:yes/no）|
| 通用 block | `follow`（跳跃跟随:yes/no，仅 block 类 + syobon/turtle/king）|
| `firebar` | `xt`（火球总数）、`rot`（角度,-1=随机）、`dir`（cw/ccw）、`mirror`（镜像:yes/no）|
| `lift_*` | `len`（平台长度）|
| `platform_hang` | `w`（站台宽）、`h`（吊柱高）、`drop`（可下降:yes/no）|
| `block_fall`/`block_fall_d` | `ori`（h/v）、`count`（块数）、`dir`（生成方向）、`delay`（延迟）、`chain`（链 uid）|
| `block_fall_g` | `variant`（0/1/2）、`count`、`rows`|
| `block_brick_m` | `ori`、`count`|
| `_trapzone` | `trap.dir`、`trap.target`、`trap.count`、`trap.tw`、`trap.th`|
| `pipe_cross`/`tee`/`L_a`/`L_b` | `rot`、`lengths[0..3]`|
| `warpable`（旗杆等）| `warp`（传送目标）|

实现细节：
- 目标下拉 `evTargetSelect` 选中变化时，重建字段下拉 + 值控件。
- 值控件按 `kind` 渲染：`num`→`numInput`；`enum`→`<select>` 带 `opts`；`bool`→yes/no select；`ref`→元素 id 下拉（复用 `evTargetSelect` 的 enemy 元素遍历风格）。
- 当前选中目标的元素 id 从 `state.elements` 里按 `uid===a.target` 查得；查不到（悬空）时退化为通用 col/row + 旧的 txtype/ttype/sxtype 兜底，避免空面板。
- action 切换到 setprop 时的默认值从 `{target:'',field:'col',value:0}` 改起。
- 保留旧数据兼容：读取时 `field` 若是旧的 `txtype/ttype/sxtype`，仍能在兜底分支显示。

### Part C：引擎 — runEvents 支持友好名 + 自动换算

`game/engine.js` 的 `runEvents()`（~L1411-1429）setprop 分支当前 `obj[ev.field]=ev.value|0`。改为按字段名分派，复用 `move` 动作已有的类型探测（`'ta' in obj`/`'sa' in obj`/`'ba' in obj`/`'sra' in obj`）：

```js
if (ev.act === 'setprop') {
  var f = ev.field || 'txtype';
  var raw = ev.value;
  var isStr = typeof raw === 'string';
  var v = isStr ? raw : (raw | 0);
  if (f === 'col' || f === 'row') {
    applyPosition(obj, f, v);          // 见下
  } else if (f === 'length' && 'sc' in obj) {
    recomputePipeSize(obj, v);        // 重算 sc/sd，按 dir 调 sa/sb
  } else if (f === 'dir' && 'dir' in obj) {
    obj.dir = v;                       // 管道/火焰棒方向直接存
  } else if (f === 'entry' && 'stype' in obj) {
    setPipeEntry(obj, v);             // none→stype50 sxtype1；trap→50/0；warp→60/1
  } else if (f === 'pop' && 'btype' in obj) {
    setBlockPop(obj, v);              // 把 pop 字符串映射成 btype/bxtype（同 play.html 的 qSingle 表）
  } else if (f === 'mass') {
    setBlockMass(obj, v);             // 切换 btype 到量产变体
  } else if (f.indexOf('trap.') === 0 && obj.trap) {
    obj.trap[f.slice(5)] = v;
  } else if (f.indexOf('lengths.') === 0 && obj.lengths) {
    obj.lengths[+f.slice(8)] = Math.max(1, v);
  } else {
    obj[f] = v;                       // 通用兜底（rot/xt/mirror/delay/count/w/...）
  }
}
```

新增辅助函数（engine.js 内，runEvents 旁）：
- `applyPosition(obj, field, gridVal)`：按对象类型把 grid 坐标换算成世界坐标并写入。规则与 play.html 一致：
  - 块/敌人/触发器（`ba` 在 obj）：`col→ba = col*100+1450`；`row→bb = (row*29-12)*100`。
  - 升降台（`sra` 在 obj）：`col→sra = col*2900`；`row→srb = (row*29-12)*100`。
  - 管道（`sa` 在 obj 且有 `sc/sd`）：需要 `dir`；按 play.html L624-644 的公式重算 `sa/sb`（length 不变时仅移动）。管道若同时改了 length/dir，依赖 `recomputePipeSize` 配合。
- `recomputePipeSize(obj, len)`：按 `obj.dir` 重算 `sc/sd`，并按方向修正 `sa/sb`（down/left 的原点随长度变）。
- `setPipeEntry/setBlockPop/setBlockMass`：查表改 `stype/sxtype/btype/bxtype`，表与 play.html 的 `qSingle/qMass/hSingle` 完全一致，避免行为不一致。

数据类型注意：事件动作存进 `events` 数组里会被 JSON 序列化（snapshot L212 / save L4635），所以 `value` 可以是字符串（dir/entry/pop）。引擎读取时 `ev.value` 保持原类型；旧的纯数字 `value` 仍按 `|0` 走。

`spray` 喷射在运行时由独立的 stype=180 生成器驱动（play.html 配对到管口），运行中切换喷射需要创建/销毁生成器，复杂且收益低。本期 `spray`/`sprayTarget` 字段在编辑器可配置但引擎侧仅更新 `obj.spray`/`obj.sprayTarget` 标记，不动态创建生成器（标注为已知限制，可在 plan 里写明）。

### Part D：快照与存档白名单

事件动作存于 `events` 数组，已被 snapshot（editor.js L212）与 save（L4635）放行，新字段无需改白名单。`value` 支持字符串后，旧档的数字 value 仍兼容。

## 关键文件

- `r:\PythonNewProcject\NewCatMarioEditor\elements.js` — 删 `item_green_question`，改名 `block_qball`。
- `r:\PythonNewProcject\NewCatMarioEditor\editor.js` — `wEnemyId` 改 atype=105 映射；`buildEventsEditor` 的 setprop 分支改为动态字段；新增 `setpropFieldsFor`。
- `r:\PythonNewProcject\NewCatMarioEditor\game\engine.js` — `runEvents` setprop 分派 + 新增 `applyPosition/recomputePipeSize/setPipeEntry/setBlockPop/setBlockMass` 辅助。
- `r:\PythonNewProcject\NewCatMarioEditor\play.html` — 一般不改；仅在需要给管道运行时对象补影子字段（`_eCol/_eRow/_eLen`）以便引擎重算时，在 `pipes.push` 处补 3 个字段（若 `applyPosition/recomputePipeSize` 能纯靠 `sa/sb/sc/sd/dir` 反推则可不动 play.html，优先选此路）。

## 验证

1. **编辑器**：放一个 `block_qball` + 一个 `pipe_mouth` + 一个 `block_question`；打开问号球⚙属性→事件动作→加 setprop→选管道目标→确认下拉出现「列/行/管身长度/开口方向/进入事件/是否喷射/喷射对象」；选问号块目标→出现「列/行/弹出对象/是否量产/跳跃跟随」；切目标时字段与值控件正确重建。调色板里 `item` 分类不再有「绿色问号球」，`struct` 里有「绿色问号球(触碰事件)」。
2. **存档往返**：配好 setprop 动作→保存 JSON→重新加载→动作与字段/值不丢；撤销/重做多次→不丢。
3. **试玩**：配 setprop 把某管道 `entry` 从 none 改 trap、把某问号块 `pop` 改 mushroom、把某元素 col 改 5；触碰问号球→目标元素属性按预期变化（管道变陷阱/问号块弹红蘑菇/元素移到新列）。
4. **旧档兼容**：加载含旧 `txtype` setprop 动作的存档→兜底分支仍能显示与编辑。
