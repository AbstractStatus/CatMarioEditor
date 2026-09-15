# 猫里奥编辑器 7 功能分批实现计划

## Context
用户要求 7 个功能：精灵方向翻转、下一关配置、提示块、1-3 数据修复、自定义元素、自定义 BGM/音效、目录保存/读取。经确认分两批实现：**第一批（1-4）先做**，第二批（5-7）后续处理。

---

## 第一批（本次实现）

### 功能1：精灵方向翻转
**问题**：仅 atype=9 在向下运动时做垂直翻转，其他有垂直运动的敌人（80/81/82/84/10）未翻转。

**修改**：[engine.js](file:///r:/PythonNewProcject/NewCatMarioEditor/new/game/engine.js) `drawEnemy()` 函数（~L1121）

- 定义模块级常量 `FLIP_ATYPES = {9:true, 10:true, 80:true, 81:true, 82:true, 84:true}`
- 将 `e.atype === 9` 判定改为 `FLIP_ATYPES[e.atype]`，当 `e.ad > 0`（向下运动）时执行 `ctx.scale(1,-1)` 垂直翻转
- 保留水平镜像 `m`（`e.amuki === 1`）叠加

### 功能2：编辑器"下一关"配置
**问题**：通关后引擎写死 `state.stb++` 进入下一子关，自定义关卡无法指定去向。

**修改 4 个文件**：

1. **[index.html](file:///r:/PythonNewProcject/NewCatMarioEditor/new/index.html)** — toolbar 添加 `<select id="nextLevelSel">` 下拉框
2. **[editor.js](file:///r:/PythonNewProcject/NewCatMarioEditor/new/editor.js)** — 
   - `state` 添加 `nextLevel: {end:false, id:null}`
   - `buildNextLevelSel()` 填充选项（下一关/游戏结束/世界列表）
   - change 事件 → `pushHistory()` + 设置 `state.nextLevel` + `persist()`
   - snapshot/undo/loadData/persist/playBtn 中同步 nextLevel
3. **[play.html](file:///r:/PythonNewProcject/NewCatMarioEditor/new/play.html)** —
   - `convert()` 返回值添加 `nextLevel`
   - 添加 `GameEngine.setGoalNextHandler(fn)` 调用，fn 处理 `{end:true}` 回标题、`{id:'x-y'}` 加载指定世界、`{end:false,id:null}` 默认下一关
4. **[engine.js](file:///r:/PythonNewProcject/NewCatMarioEditor/new/game/engine.js)** —
   - `state` 添加 `nextLevel: null, onGoalNext: null`
   - `loadStage()` 读取 `def.nextLevel`
   - 添加 `Engine.setGoalNextHandler`
   - GOAL_SLIDE `mtm===250`（~L396）改为调用 `state.onGoalNext(state.nextLevel)`，返回 true 则 `startGame()`，返回 false 则宿主自行处理

### 功能3：提示块功能
**问题**：旧引擎 ttype=300 提示块有完整的"碰撞→展开消息框→暂停游戏→显示文本→按键后收起"流程，新引擎仅有字段但未实现。

**参考**：[main.cpp](file:///r:/PythonNewProcject/NewCatMarioEditor/catmario/src/main.cpp) L2403-2414（碰撞）、L1449-1468（状态机）、L5870-5975（渲染）、[str.h](file:///r:/PythonNewProcject/NewCatMarioEditor/catmario/src/str.h) L279-352（文本）

**修改**：

#### engine.js
- **collideBlocks**（~L540 区域，`xx[17]===1` 判定后）添加：
  - `b.ttype === 300` 时：`A.playSE(C.SE.HINT)`，设置 `state.tmsgtype=1, tmsgtm=15, tmsgy=300+(txtype-1), tmsg=txtype`
  - `txtype===540` 时：`tmsg=100, txtype=541`（隐藏提示）
- **frame()**（~L1389，`state.tmsgtype === 0` 判定之前）添加消息状态机：
  - type=1（展开）：`tmsgy += 1200`/帧，15 帧后转 type=2
  - type=2（暂停显示）：等玩家按键 → 转 type=3
  - type=3（收起）：`tmsgy += 1200`/帧，15 帧后清零
  - `tmsgtm--`
  - **关键**：type=2 时 `tmsgtype !== 0`，L1390 的 `tmsgtype === 0` 判定会跳过游戏更新，实现暂停
- **render()** 末尾添加消息框渲染：
  - type=1/2：黑色矩形背景 + 白色边框，高度 = `tmsgy/100`
  - type=2：白色文字绘制提示文本（每行 `lineHeight=24px`）
  - type=3：剩余高度收起动画
- **loadStage()**：读取 `def.hintTexts`
- 定义 `DEFAULT_HINT_TEXTS`（10 条+1 条隐藏，中文翻译来自 str.h）和 `getHintText(tmsg, customTexts)`

#### editor.js
- `state` 添加 `hintTexts: {}`
- b2_hint 属性弹窗（`openPropModal`）添加：
  - txtype 下拉（0-9 + 100=隐藏）
  - textarea 编辑当前 txtype 对应文本（每行一条）
- snapshot/undo/saveBtn/loadData/persist/playBtn 中同步 hintTexts

#### play.html
- `convert()` 返回值添加 `hintTexts: level.hintTexts`

### 功能4：1-3 问号球下方坠落砖组数据修复
**问题**：[extract_stages.py](file:///r:/PythonNewProcject/NewCatMarioEditor/new/tools/extract_stages.py) 的 `parse_pipes()` 搜索 sxtype 时取 stype 后 160 字符，会串读到下一个管道定义，导致 stype=52 的管道被错误赋予 sxtype=1。

**旧引擎数据**（main.cpp L4515）：`stype=52` 管道在 col 9, row 13（问号球 col 10, row 11 正下方偏左），无 sxtype 赋值（应为 0）。

**修改**：[extract_stages.py](file:///r:/PythonNewProcject/NewCatMarioEditor/new/tools/extract_stages.py) `parse_pipes()`
- 将 sxtype 搜索范围从"stype 后固定 160 字符"改为"到下一个断点（`sa[`/`sra[`/`sco++`/`t=bco` 等）"
- 修复后运行脚本重新生成 stages_data.js

---

## 第二批（后续实现，本次仅概述）

### 功能5：自定义元素
- 编辑器添加文件上传按钮，用户选择图片文件
- 图片转 Base64 编码嵌入 JSON
- 配置：元素名称、横纵格子数（tw/th）、类别（struct/block/item/enemy/bg，影响碰撞行为）
- 试玩页 convert() 将自定义元素转为引擎 pipe/block/trigger 数据
- 自定义 stype ID 从 1000+ 开始避免冲突

### 功能6：自定义 BGM 和音效
- 编辑器音乐 TAB 添加"添加自定义 BGM"按钮，上传 mp3 文件转 Base64
- 音效区添加"添加自定义音效"按钮
- 数据保存到 JSON 的 `customBgm` 和 `customSfx` 字段
- play.html 用 Base64 创建 Audio 对象，注入 audio.js 的 BGM/SFX 播放系统

### 功能7：目录保存/读取
- 保存时：分别下载 level.json + 自定义元素图片 + 自定义音频文件（多文件下载）
- 读取时：用户通过文件夹选择 API（`webkitdirectory`）选择目录，检查必需文件是否存在
- 缺少文件时弹窗警告具体缺少的文件名

---

## 验证方法

| 功能 | 验证步骤 |
|------|----------|
| 1. 精灵翻转 | 编辑器放 enemy_flame(atype=9)，试玩观察向下运动时精灵垂直翻转 |
| 2. 下一关 | 编辑器设"通关后=游戏结束"，放 goal_pole，通关后回标题；设为某世界，通关后加载该世界 |
| 3. 提示块 | 编辑器放 b2_hint，设 txtype=1，试玩从下方顶到，消息框展开→暂停→显示文本→按键后收起 |
| 4. 1-3 数据 | 运行修复后的 extract_stages.py，检查 1-3 stype=52 的 sxtype=0，试玩验证 col 9 地面正确 |
