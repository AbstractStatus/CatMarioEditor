# 升降台 setprop 字段补全

## Context（为什么改）

问号球/事件触发器配置「改属性」动作（`setprop`），目标选升降台时字段下拉里只有「列 col、行 row、平台长度 len」三项，其它升降台属性（往复移动、往复方向、靠近触发、颜色、接触事件等）都不可改。

而升降台元素本身在 [editor.js#L2622-2732 元素属性面板](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L2622-L2732) 已经支持完整字段集合：`len / move / dir / prox / color / cev.{speedUp,standBreak,launch,slip,dropFall,launchMc,fatigueFrames}`。

根因有两处：
1. **编辑器字段目录** [editor.js#L1969-1971 `setpropFieldsFor()`](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L1969-L1971) 的 `isLiftId(id)` 分支只 push 了 `len`。
2. **引擎运行时分派** [engine.js#L1608-1690 `evApplySetprop()`](file:///r:/PythonNewProcject/NewCatMarioEditor/game/engine.js#L1608-L1690) 也只识别 `len` 字段；其它字段即便加上也会落到通用兜底 `obj[f] = v`，写到运行时对象的同名属性上但引擎 tick 不读这些字段，等于不生效（因为编辑器字段名与运行时字段名不同，需要做映射，参考 [play.html#L467-496 convert lift](file:///r:/PythonNewProcject/NewCatMarioEditor/play.html#L467-L496) 的转换规则）。

修复后，问号球对升降台改属性时与元素主属性面板字段一一对应，且运行时立刻生效。

## 修改清单

### 1. `editor.js` — `setpropFieldsFor()` 升降台分支补全字段

在现有 `push({ field: 'len', ... })` 后追加字段，沿用元素主属性面板的命名与默认值（参考 [editor.js#L2622-2732 主属性面板](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L2622-L2732)）：

```js
if (isLiftId(id)) {
  push({ field: 'len', label: '平台长度', kind: 'num', min: 1, max: 50, tip: '格' });
  push({ field: 'move', label: '往复移动', kind: 'bool', tip: '纵向循环移动（默认速度300）' });
  push({ field: 'dir', label: '往复方向', kind: 'enum', opts: [['up','向上（上升）'],['down','向下（下降）']], tip: '仅往复移动时生效' });
  push({ field: 'prox', label: '靠近触发', kind: 'bool', tip: '玩家水平接近即加速下坠；与往复移动互斥' });
  push({ field: 'color', label: '颜色', kind: 'enum', opts: [['yellow','黄'],['green','绿'],['gray','灰']], tip: '台面颜色' });
  push({ field: 'cev.speedUp',    label: '往复速度加快', kind: 'bool', tip: '仅往复时有效：站上瞬间提速到900' });
  push({ field: 'cev.standBreak', label: '碎裂消失',     kind: 'bool', tip: '站上即碎裂' });
  push({ field: 'cev.launch',     label: '弹飞(疲劳)',   kind: 'bool', tip: '站上被弹飞；连续站立疲劳帧后碎裂' });
  push({ field: 'cev.slip',       label: '打滑',         kind: 'bool', tip: '站上强制打滑' });
  push({ field: 'cev.dropFall',   label: '踩上坠落',     kind: 'bool', tip: '站上即加速下坠；仅非往复时有效' });
  push({ field: 'cev.launchMc',     label: '弹飞力度', kind: 'num', min: -9999, max: 0, tip: '勾选「弹飞」时生效（默认 -2400）' });
  push({ field: 'cev.fatigueFrames', label: '疲劳帧数', kind: 'num', min: 1, max: 999, tip: '勾选「弹飞」时连续站立多少帧后碎裂（默认100）' });
}
```

注：
- `color` 在主面板支持自定义 rgba，setprop 简化为三档枚举（yellow/green/gray），够用且与现有 enum 控件一致。
- `cev.*` 路径已被 [setpropCurrentValue()#L1990-1998](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L1990-L1998) 的 `split('.')` 嵌套读取支持，无需改 reader。
- 旧数据如果 setprop 的 `field` 不在新字段列表里，已有兜底逻辑 [editor.js#L2216-2218](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L2216-L2218) 会追加「旧/自定义」项，不破坏兼容。

### 2. `game/engine.js` — `evApplySetprop()` 增加升降台字段映射

在现有 `} else if (f === 'len' && 'src' in obj && 'sra' in obj) {` 分支后，参考 [play.html#L467-496 convert lift](file:///r:/PythonNewProcject/NewCatMarioEditor/play.html#L467-L496) 的转换规则，追加（注意 `move/prox/color/cev.*` 全部需要 `'srsp' in obj` 兜底以区分管道/连接管等同名字段）：

```js
} else if (f === 'move' && 'srsp' in obj && obj.srsp === 0) {
  var yes = isYes(v);
  obj.sracttype = yes ? 5 : (obj.bhv && obj.bhv.dropFall ? 1 : 0);   // 往复=5 / 踩上坠落=1
  obj.sre = yes ? (obj._liftDir === 'down' ? 300 : -300) : 0;        // 往复方向（向下=+300，向上=-300）
  obj._liftMove = yes;                                               // 缓存当前状态供 dir/dropFall 联动
} else if (f === 'dir' && 'srsp' in obj && obj.srsp === 0) {
  obj._liftDir = v;
  if (obj.sracttype === 5) obj.sre = (v === 'down' ? 300 : -300);    // 仅往复时生效
} else if (f === 'prox' && 'srsp' in obj && obj.srsp === 0) {
  obj.proximity = isYes(v);
  if (isYes(v)) { obj.sracttype = 0; obj.sre = 0; obj._liftMove = false; }  // 互斥：往复优先→prox 优先则关往复
} else if (f === 'color' && 'srsp' in obj && obj.srsp === 0) {
  obj.color = v;
} else if (f.indexOf('cev.') === 0 && 'srsp' in obj && obj.srsp === 0) {
  var sub = f.slice(4);
  if (!obj.bhv) obj.bhv = {};
  if (sub === 'speedUp')    { if (isYes(v)) obj.bhv.speedUp = true; else delete obj.bhv.speedUp; }
  else if (sub === 'standBreak') { if (isYes(v)) obj.bhv.standBreak = true; else delete obj.bhv.standBreak; }
  else if (sub === 'launch') {
    if (isYes(v)) {
      if (obj.bhv.launchMc == null) obj.bhv.launchMc = -2400;
      if (obj.bhv.fatigueFrames == null) obj.bhv.fatigueFrames = 100;
    } else { delete obj.bhv.launchMc; delete obj.bhv.fatigueFrames; }
  } else if (sub === 'slip') {
    if (isYes(v)) obj.bhv.slipMd = -800; else delete obj.bhv.slipMd;
  } else if (sub === 'dropFall') {
    // 仅非往复时有效：sracttype=1 表示踩上坠落
    if (isYes(v)) { if (obj.sracttype !== 5) obj.sracttype = 1; }
    else if (obj.sracttype === 1) obj.sracttype = 0;
  } else if (sub === 'launchMc') {
    obj.bhv.launchMc = (v | 0);
  } else if (sub === 'fatigueFrames') {
    obj.bhv.fatigueFrames = (v | 0);
  }
}
```

注：
- `obj.srsp === 0` 兜底区分 `lift`（合并升降台，srsp=0）与 `platform_hang`（悬挂站台，srsp=10）。悬挂站台不支持这些字段，保持原 `drop`/`w`/`h` 字段不变。
- `obj._liftMove` / `obj._liftDir` 是运行时缓存，不参与持久化（仅在同一 setprop 序列内多动作联动时使用，避免 dir 在 move 之前设置时丢失）。
- `cev.launch` 关闭时清掉 `launchMc/fatigueFrames`，与元素主面板「未勾选弹飞时两行隐藏、值不落盘」语义一致。
- `prox` 与 `move` 互斥：参考 [editor.js#L2645-2646 主面板联动](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L2645-L2646) 的「往复优先」规则，setprop 设 prox=yes 时同时关掉往复（写 sracttype=0 / sre=0）。

## 验证（人工）

1. 编辑器中创建问号球（事件触发器）+ 升降台（lift）。
2. 双击问号球 → 事件动作 → 选「改属性」→ 目标选升降台 uid。
3. 字段下拉应出现 13 项：col / row / len / move / dir / prox / color / cev.speedUp / cev.standBreak / cev.launch / cev.slip / cev.dropFall / cev.launchMc / cev.fatigueFrames（含原有 col/row 共 15 项）。
4. 切换字段时「当前值」控件正确显示升降台当前配置（如 move=yes、color=green、cev.launch=yes）。
5. 试玩关卡：触碰问号球触发后，升降台运行时行为按 setprop 设置改变（如把 move=no 改 yes → 台开始往复移动；color 改 gray → 颜色变灰；cev.standBreak 改 yes → 站上台即碎）。
6. 验证旧档：原有「setprop field=txtype/row」等不升降台相关动作仍正常工作。
