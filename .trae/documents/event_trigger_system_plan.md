# 事件触发系统实现方案（第一期）

## Context

旧引擎 1-3 问号球（btype=105）接触后触发 4 个硬编码事件（main.cpp:3694-3712）：播金币音效、把提示块消息号改成 80（空白框整蛊）、天降 7 颗恶星（atype=110）、脆弱砖下移 3 格。这些是写死全局数组下标的关卡专属逻辑，新引擎未移植（ttype 105 已被重定义为 P 开关块），编辑器也没有"触碰→联动"的事件系统。

本期目标：给编辑器+引擎新增**通用、数据驱动的事件触发系统**（符合"元素解耦"硬约束），可配置动作序列：播音效 / 按偏移生成敌人 / 改其他元素属性 / 移动其他元素。

用户已确认：
- **不做**原版 1-3/1-2 的 btype:105 兼容还原层（第二期再议）
- 触发器做**两种形态**：隐形触发区 + 可见问号球，共用同一套事件编辑器

## 数据模型

编辑器元素实例新增 `events` 数组（动作按序执行，uid 引用其他元素，参照 pipe.chain 模式）：

```js
e.events = [
  { act: 'se',      id: 4 },                                       // 播音效（A.playSE）
  { act: 'spawn',   atype: 110, axtype: 0, dx: -25000, dy: -42000 }, // 相对触发器左上角的世界单位偏移生成敌人，生成后受重力下落
  { act: 'setprop', target: 'u7', field: 'txtype', value: 80 },    // 按目标 uid 改引擎字段（txtype=80 → 提示块弹空白框，与原版 tmsg=80 行为一致）
  { act: 'move',    target: 'u3', dx: 0, dy: 9000 }                // 按目标 uid 平移元素（block 改 ta/tb，pipe 改 sa/sb）
]
```

- 引擎侧触发对象：`{ ax, ay, aw, ah, uid, img, events, fired }`（世界单位 AABB，`once` 语义固定为每关一次：`fired=true` 后不再触发，检查点复活不重置，与原版球消失后不回来一致）
- `setprop.field` 第一期限定下拉：`txtype` / `ttype` / `sxtype`（直接引擎字段名）
- `spawn` 恶星天降原理：dy 为大负值把生成点放到屏幕上方，atype=110 受重力自然下落（与原版 110 天降一致）

## 文件改动

### 1. elements.js（根目录）
注册两个新元素（放在 `_trapzone` 附近，cat:'struct'）：

```js
{ id: 'trap_event', cat: 'struct', name: '事件触发区', kind: 'special',
  tw: 3, th: 3, w: 3, h: 3, events: [],
  hint: '隐形AABB触发区：玩家进入区域即按顺序执行事件动作...' }
{ id: 'block_qball', cat: 'struct', name: '问号球(触碰事件)', kind: 'sprite',
  img: 'item/item_green_question.png', tw: 1, th: 1, events: [],
  hint: '复刻原版绿问号球：玩家触碰即按顺序执行事件动作并消失（每关一次）...' }
```

不走 stype/mapId 管线，转换走专属分支（同 `_trapzone` 模式）。

### 2. editor.js
- **placeAt**（~L445-524）：两种元素放置时初始化 `events: []`；trap_event 初始化 `w:3, h:3`
- **snapshot()**（L189-207 白名单）：加 `if (e.events) o.events = JSON.parse(JSON.stringify(e.events));`
- **loadData 白名单 / saveBtn / worldToElements**（参照 L3426 `out.chain` 同路径）：透传 `events`；worldToElements 恢复时保留
- **openPropModal**（L1350）：两种元素追加"事件动作列表"编辑区：
  - 每行：动作类型下拉（播音效/生成敌人/改属性/移动元素）+ 按类型动态显隐的参数输入 + 删除按钮
  - `target` 用 uid 下拉，构建方式参照坠落砖组 chain 下拉（L1433-1443），列出除两个触发器外的所有元素实例，悬空引用运行时忽略
  - "添加动作"按钮；确定时写回 `selected.events` 并 `pushHistory()`
  - 附"填入 1-3 整蛊模板"按钮：一键生成 se(4) + setprop(txtype=80) + 7×spawn 恶星（dx: -29000/-25000/+13000/+14000/+19000/+20000/+25000，dy: -42000）+ move(dy:+9000)，target 由用户自选
- **drawElement**：trap_event 画虚线框（参照 _trapzone 画法，标注宽高格数）；block_qball 按 manifest 1×1 画绿球

### 3. play.html（convert）
新增分支（参照 L442-450 `_trapzone` 分支位置）：

```js
} else if (id === 'trap_event' || id === 'block_qball') {
  var evW = (id === 'trap_event') ? (e.w || 3) : 1, evH = (id === 'trap_event') ? (e.h || 3) : 1;
  eventTriggers.push({
    ax: c * 2900, ay: (r * 29 - 12) * 100, aw: evW * 2900, ah: evH * 2900,
    uid: e.uid || null,
    img: (id === 'block_qball') ? 'item/item_green_question.png' : null,
    events: e.events || []
  });
}
```

convert 返回值加 `eventTriggers` 字段。

### 4. game/engine.js
- **loadStage**：`state.eventTriggers = (def.eventTriggers || []).map(...)`（字段透传 + `fired:false`；def 无该字段时为空数组，原版关卡不受影响）
- **updateEventTriggers()**：在 updateTriggers()（L985）之后加入主循环。带镜头门控（`ax - fx > FXMAX + 2000 || ax + aw - fx < -2000` 跳过）；玩家 AABB（p.ma/p.mnobia/p.mb/p.mnobib）与触发区重叠且 `!fired` → `fired = true` → 按序执行 `runEvents`
- **runEvents(tr)**：
  - `se` → `A.playSE(id)`
  - `spawn` → `spawnEnemy(tr.ax + dx, tr.ay + dy, 0, 0, 0, atype, axtype)`（继承触发器 uid 命名 `uid+'#ev<i>'` 便于调试）
  - `setprop` / `move` → 按 target uid 在 `state.blocks` / `state.pipes` / `state.eventTriggers` 中查找（有 ta→block、有 sa→pipe）；setprop 直接 `obj[field] = value`，move 偏移 ta/tb 或 sa/sb；state 对象每帧重渲染，改完即生效
- **渲染**：遍历 state.eventTriggers，`tr.img && !tr.fired` 时按 manifest 绘制精灵（复用引擎现有按 manifest 画图的 helper / _custom 元素渲染模式）；fired 后问号球消失（原版行为），trap_event 无 img 不渲染
- **SE 表**：确认 `C.SE` 中金币音效 id（原版 soundplay(4)=金币）供模板使用

### 5. 版本号递增（改 JS 必递增，提醒用户 Ctrl+F5）
- elements.js：index.html `?v=shell19→shell20`、play.html `?v=evlog16→evlog17`
- editor.js：`?v=hd19→hd20`（index.html）
- engine.js：`?v=hd13→hd14`（game/index.html 与 play.html 同步）

## 不做（第二期备选）
- 原版关卡 btype:105 兼容还原层（含 1-2 的 sgtype[26] 门联动）
- 更多动作类型：消息框（mmsg）、删除元素、事件链式触发事件、延时执行
- 触发条件扩展：onBump（从下方顶）、onTimer

## 验证

1. **编辑器**：放置 block_qball + b2_hint + block_brick + trap_event；属性面板用模板配事件、手工增删动作行、target 下拉选择；保存 JSON → 读取 → 撤销/重做多次，确认 events 不丢（重点回归 snapshot 白名单）
2. **试玩（block_qball 复刻 1-3）**：触碰绿球 → 金币音效；再顶提示块 → 弹空白框；7 颗恶星从天而降，碰到 -1HP 显示"被刺死了！"；脆弱砖下移 3 格；球消失且不重复触发
3. **试玩（trap_event）**：玩家走进隐形区 → 动作执行一次；离开再进不重复
4. **回归**：原版示例 1-3 试玩不受影响（绿球静默消失，等待第二期）；坠落砖组 chain、P开关、提示块等既有功能正常
