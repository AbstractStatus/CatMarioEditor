# 陷阱触发区：生成区与触发区拆分为两个独立矩形

## Context

当前 `_trapzone` 元素只有一个矩形（触发区 `tw×th` at `col,row`），生成区位置由触发区 + 方向 + count **派生**（drawTrapPreview 中 `ax/ay/aw/ah` + dir + count 计算），两者在画布上重叠（生成区绘制在触发区边缘内侧），无法独立移动/改大小。

用户要求：
1. 生成区与触发区为**两个独立矩形**（各自有位置/尺寸）
2. 两个矩形显示**共同的 group id**（用元素 uid 作为 group id）
3. 删除一个区域时，另一个也被删除（单元素天然满足）

经确认采用「**同一元素两个矩形**」方案：保持 `_trapzone` 为单元素，`trap` 对象内增加生成区独立坐标/尺寸。`count` 保留，对象在生成区内按方向自动排列。

## 数据模型

`trap` 对象新增 4 个字段（生成区独立位置/尺寸，单位=格子）：

```js
trap = {
  tw, th,               // 触发区尺寸（位置 = 元素 col/row，不变）
  gcol, grow,           // 生成区位置（独立于触发区）
  gtw, gth,             // 生成区尺寸
  dir, target, count    // 方向/对象/个数（不变）
}
```
group id = 元素 uid（已存在，无需新增字段）。

**默认/迁移派生规则**（gcol/grow/gtw/gth 缺失时按现派生公式补全，兼容旧存档+legacy stype 转换）：
- up:    gcol=col,         grow=row+th-1,   gtw=count, gth=1
- down:  gcol=col,         grow=row,        gtw=count, gth=1
- left:  gcol=col+tw-1,    grow=row+th-count, gtw=1,    gth=count
- right: gcol=col,         grow=row+th-count, gtw=1,   gth=count

## 实施步骤

### 1. trapDims 扩展 — [editor.js L358-379](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L358-L379)

返回值新增 `gcol/grow/gtw/gth`：若 `tz` 已有则取，否则按上方派生规则补全（用已算出的 tw/th/dir/count）。注意 grow 可能为负（ EXTRA_TOP_ROWS 区域），不做钳制（仅渲染/拖拽时钳制）。

### 2. placeAt 初始化生成区 — [editor.js L556-564](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L556-L564)

`ne.trap` 增加 `gcol/grow/gtw/gth`，按 dir 派生默认值（与上方规则一致）。这样新建的陷阱触发区生成区初始位置与旧版视觉一致。

### 3. drawElement(_trapzone) 双矩形绘制 — [editor.js L823-858](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L823-L858)

- 触发区矩形（方向色虚线框 + 顶部标签）：保持现 ax/ay/aw/ah 计算
- 生成区矩形（青色虚线框 + 顶部标签）：用 `tzd.gcol/grow/gtw/gth` 独立计算
  - `gax = gcol*TILE`, `gay = (grow+EXTRA_TOP_ROWS)*TILE - 12*WPX`, `gaw=gtw*TILE`, `gah=gth*TILE`
- 两个标签都显示 group id：`[uid]` 前缀，例如 `[u5] ↓白幽灵 ×3`
- 生成区内对象图标：调用新签名 `drawTrapPreview(dir, target, count, gax, gay, gaw, gah)`（传入生成区矩形而非触发区）
- 方向箭头：从触发区中心指向生成区中心（白色细线）
- resize 手柄：触发区 + 生成区都画（选中时）

### 4. drawTrapPreview 改签名 — [editor.js L705-777](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L705-L777)

参数 `ax/ay/aw/ah` 现在直接是生成区矩形（不再是从触发区派生）。函数内：
- 不再二次计算 gRect（传入的就是生成区矩形），直接用 ax/ay/aw/ah 画虚线框
- 对象图标在生成区内按 dir 排列：
  - up/down: 沿 x 方向均分 count 个，y 取生成区底/顶边
  - left/right: 沿 y 方向均分 count 个，x 取生成区右/左边
- 删除内部的 gRect 派生逻辑

### 5. drawResizeHandles 扩展 — [editor.js L779-799](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L779-L799)

新增 `drawResizeHandlesGen(gax, gay, gaw, gah)` 或参数化：生成区手柄用青色填充区分（触发区手柄保持白色）。

### 6. resizeHitTest 扩展 — [editor.js L802-818](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L802-L818)

新增对生成区矩形的命中检测，返回带前缀的代号：`'t-nw'`(触发区) / `'g-nw'`(生成区)，区分两个矩形的 8 个手柄。

### 7. 鼠标交互：拖拽/resize 两个矩形 — [editor.js L3172-3360](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L3172-L3360)

新增状态变量：
- `dragMode`: `'trigger'` | `'gen'` | null（拖拽哪个矩形）
- `resizeRect`: `'trigger'` | `'gen'`（resize 哪个矩形）

**mousedown**：
- 已选中 _trapzone 时：先检测 resize 手柄（触发区白色 + 生成区青色），命中则设 `resizeRect` + `resizeEdge`
- 未命中手柄但命中生成区矩形 → 选中 + `dragMode='gen'`
- 未命中手柄但命中触发区矩形 → 选中 + `dragMode='trigger'`（现有行为）
- hitTest 仍只看触发区（footprintOf 不变），生成区命中在 mousedown 单独判断

**mousemove**：
- `resizeRect==='trigger'` → 现有逻辑改 tw/th/col/row
- `resizeRect==='gen'` → 改 gtw/gth/gcol/grow（同样钳制 1-50、不越界）
- `dragMode==='trigger'` → 现有逻辑改 col/row
- `dragMode==='gen'` → 改 gcol/grow（钳制 -EXTRA_TOP_ROWS ~ ROWS-gth、0 ~ cols-gtw）

**mouseup**：清空 dragMode/resizeRect，已 commit 则 persist。

### 8. footprintOf 不变 — [editor.js L381-387](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L381-L387)

仍返回触发区 bounds（生成区不参与占位/互斥，与现行为一致 — 生成区可与其他元素重叠）。

### 9. 属性编辑器 — [editor.js L1988-2042](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L1988-L2042)

在现有「触发区宽/高」下方新增：
- `fTzGCol`: 生成区列(数字 0~cols) 
- `fTzGRow`: 生成区行(数字 -EXTRA_TOP_ROWS~ROWS)
- `fTzGTw`: 生成区宽(格)(1~50)
- `fTzGTh`: 生成区高(格)(1~50)
保留：方向/对象/触发区宽高/生成个数。

### 10. 属性保存 — [editor.js L2287-2305](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L2287-L2305)

写入 `selected.trap.gcol/grow/gtw/gth`，钳制范围。若 `trap` 不存在则初始化（含 gcol/grow/gtw/gth 默认值）。

### 11. 序列化 — [editor.js L4123-4134](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L4123-L4134)

`out.trap` 新增 `gcol/grow/gtw/gth`（用 trapDims 派生后的值，确保旧存档加载后再保存也会落盘新字段）。

### 12. worldToElements legacy 转换 — [editor.js L3723-3735](file:///r:/PythonNewProcject/NewCatMarioEditor/editor.js#L3723-L3735)

`trap` 对象只放 `dir/target/tw/th/count`（gcol/grow/gtw/gth 缺失，由 trapDims 派生），无需改。

### 13. play.html 转换 — [play.html L505-545](file:///r:/PythonNewProcject/NewCatMarioEditor/play.html#L505-L545)

pipe 对象新增生成区世界坐标：
```js
var tzGcol = tz.gcol != null ? tz.gcol : <派生值>;
// 同理 grow/gtw/gth（复制 trapDims 派生逻辑或直接用 editor 的 trapDims 输出）
pipes.push({
  sa: tzSa, sb: tzSb, sc: tzTw*2900, sd: tzTh*2900,   // 触发区
  gsa: tzGcol*2900, gsb: (tzGrow*29-12)*100,          // 生成区
  gsc: tzGtw*2900, gsd: tzGth*2900,
  stype: 105, dir: tzDir, target: tzTarget, count: ...,
  uid: e.uid || null
});
```
派生逻辑需在 play.html 内重复一份（play.html 无法访问 editor.js 的 trapDims）。

### 14. 引擎 PipeTypes[105] — [game/elements.js L648-686](file:///r:/PythonNewProcject/NewCatMarioEditor/game/elements.js#L648-L686)

生成位置改用生成区 AABB（`s.gsa/gsb/gsc/gsd`），不再从触发区 + dir 派生：
- up/down: `sx = gsa + i*(gsc/count) + offset`, `sy = gsb` 或 `gsb+gsd-2000`
- left/right: `sx = gsa` 或 `gsa+gsc-4000`, `sy = gsb + i*(gsd/count) + offset`
- 初始速度（sac/sad）仍按 dir（up=sad负，down=sad正，left/right=sac）
- 兼容：若 `gsa` 缺失（旧关卡直接走引擎），按现逻辑从 `sa/sb/sc/sd` + dir 派生

### 15. engine.js loadStage 透传 — [game/engine.js L204+](file:///r:/PythonNewProcject/NewCatMarioEditor/game/engine.js#L204)

确认 pipe 注册时 `gsa/gsb/gsc/gsd` 字段透传到 onCollide（检查现有 spread，缺则补）。

## 验证

### 语法
```
node --check r:\PythonNewProcject\NewCatMarioEditor\editor.js
node --check r:\PythonNewProcject\NewCatMarioEditor\game\elements.js
```

### 功能（浏览器）
1. `python -m http.server 8765` 启动
2. 编辑器新建 `_trapzone`：画布应显示两个独立虚线框（触发区方向色 + 生成区青色），两个标签都带 `[uid]` group id
3. 拖动触发区 → 只移动触发区；拖动生成区 → 只移动生成区
4. resize 手柄：触发区白色手柄改 tw/th；生成区青色手柄改 gtw/gth
5. 属性面板：生成区列/行/宽/高 4 个新输入框，改值后画布实时更新
6. 载入旧存档（无 gcol/grow/gtw/gth）：生成区位置应按旧派生规则显示，行为不变
7. 删除 _trapzone：两个矩形同时消失（单元素天然满足）
8. 试玩：生成区内按方向排列 count 个对象，对象从生成区位置生成

## 风险
- **拖拽冲突**：生成区与触发区重叠时优先命中生成区（mousedown 顺序：手柄 > 生成区 > 触发区）
- **grow 负值**：生成区可能在 EXTRA_TOP_ROWS 区域（上方溢出），拖拽钳制下限 -EXTRA_TOP_ROWS
- **旧引擎数据**：直接走 engine.js 的旧关卡无 gsa/gsb，PipeTypes[105] 保留从 sa/sb 派生的兜底分支
