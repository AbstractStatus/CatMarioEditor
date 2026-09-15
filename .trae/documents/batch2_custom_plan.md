# 第二批功能实现方案：自定义元素 / 自定义 BGM+音效 / 目录保存

## Context

用户希望在编辑器中支持：
1. **功能5**：上传图片添加自定义元素，配置横纵格子数 resize + 类别 + 碰撞类型
2. **功能6**：上传 mp3 添加自定义 BGM 和音效，替换或扩展原版音频
3. **功能7**：保存/读取从单 JSON 改为多文件目录（level.json + custom_*.json），缺失文件弹窗警告

用户已确认：
- 自定义元素碰撞类型由用户选择（无碰撞/实体方块/管道型/敌人触发器）
- 目录格式为多文件下载 + 多文件读取（不引入 JSZip）

## 功能5：自定义元素

### 数据结构

自定义元素定义追加到 `CAT.ELEMENTS`，字段：
```js
{
  id: 'custom_' + Date.now(),
  name: '自定义',
  cat: 'block',          // 用户选择：struct/block/item/enemy/bg
  kind: 'sprite',
  img: null,              // 不走 ASSETS 路径
  dataUrl: 'data:image/png;base64,...',
  tw: 2, th: 1,           // 横纵格子数
  custom: true,
  collide: 'block',      // 用户选择：none/block/pipe/trigger
  // 派生字段（由 collide 决定，convert 时使用）：
  ttype: 3,              // collide=block → 硬方块
  stype: 700,            // collide=pipe → 自定义 stype（700+ 避免冲突）
  btype: 200             // collide=trigger → 自定义 btype（200+）
}
```

### UI 流程（editor.js）

1. **上传入口**：`buildPalette()` L1087 每个分类末尾追加"+ 自定义"卡片，点击触发隐藏 `<input type=file accept=image/*>`
2. **配置弹窗**：复用 `propModal`（L799），上传图片后弹出属性对话框：
   - 类别 select（struct/block/item/enemy/bg）
   - 横纵格子数 numInput（1-20）
   - 碰撞类型 radio（无碰撞/实体方块/管道型/敌人触发器；类别=bg 时强制无碰撞）
3. **注册**：`CAT.registerCustom(def)` 动态 push 到 `ELEMENTS` 并刷新当前分类面板
4. **删除**：自定义元素卡片右上角加删除按钮，从 `ELEMENTS` 移除并清空画布引用

### 编辑器渲染（editor.js `getImg` L93）

在 `imgCache` 查找前判断 `el.dataUrl`：
```js
function getImg(el) {
  if (el.dataUrl) {
    if (!imgCache[el.dataUrl]) {
      var im = new Image();
      im.src = el.dataUrl;
      im.onload = function () { requestRender(); };
      imgCache[el.dataUrl] = im;
    }
    return imgCache[el.dataUrl];
  }
  // 原有逻辑...
}
```

`drawSprite` L404 已按 TILE 缩放，但自定义元素需按 tw/th 多格绘制：
```js
// 自定义元素：按 tw×th 格子绘制
if (def.custom) {
  ctx.drawImage(im, dx, dy, TILE * def.tw, TILE * def.th);
}
```

### play.html convert() 接入（L275 EX_BLOCK 之后）

```js
var EX_CUSTOM = level._customDefs || {};
if (EX_CUSTOM[id]) {
  var c = EX_CUSTOM[id];
  if (c.collide === 'block') {
    blocks.push({ x: x, y: y, type: c.ttype, xt: 0 });
  } else if (c.collide === 'pipe') {
    pipes.push({ sa: x*100, sb: y*100, sc: c.tw*3000, sd: c.th*3000,
                 stype: c.stype, sxtype: 0 });
  } else if (c.collide === 'trigger') {
    enemies.push({ ba: x*100, bb: y*100, btype: c.btype, bxtype: 0 });
  } else {
    // collide=none → 背景装饰
    bg.push({ na: x*100, nb: y*100, ntype: -1, _dataUrl: c.dataUrl, _tw: c.tw, _th: c.th });
  }
}
```

### 引擎接入（engine.js）

1. **方块型**：复用 `ttype=3` 硬方块行为，`collideBlocks` L502 零改动
2. **管道型**：`loadStage()` L180 后注册自定义 stype：
   ```js
   def.pipes.forEach(function (p) {
     if (p.stype >= 700) {
       PT.register(p.stype, { solid: true, render: customPipeRender });
     }
   });
   ```
3. **敌人触发器**：`spawnEnemy` 新增 `atype>=200` 分支，用 dataUrl 绘制
4. **背景装饰**：`render()` L1301 背景层新增 `ntype===-1` 分支，用 dataUrl 绘制

### elements.js 修改

```js
CAT.registerCustom = function (def) {
  ELEMENTS.push(def);
};
```

## 功能6：自定义 BGM 和音效

### 数据结构

- `state.customBgm = [{ id: 200, name: '自定义', dataUrl: 'data:audio/mp3;base64,...' }]`
- `state.customSfx = [{ id: 200, name: '自定义', dataUrl: 'data:audio/mp3;base64,...' }]`
- ID 范围：200+，避免与原版 100-106/1-18 冲突

### UI（editor.js 音乐 TAB）

1. **BGM 弹窗** `buildBgmList` L1231 末尾追加"＋ 上传 BGM"按钮 + 自定义 BGM 列表项（带删除）
2. **SFX 网格** L1176 后追加"＋ 上传音效"按钮 + 自定义音效项
3. **BGM_VALID** L76 扩展为动态：`[100,103,104,105,106].concat(state.customBgm.map(c=>c.id))`
4. **试听**：`playBgm(d)` / `playSfx(s)` 支持 dataUrl 直接播放

### audio.js 接入

将 `BGM_FILES`/`SE_FILES` 查找改为函数式：
```js
var customBgmMap = {}, customSfxMap = {};
Audio.setCustomBgm = function (map) { customBgmMap = map || {}; };
Audio.setCustomSfx = function (map) { customSfxMap = map || {}; };

function getBgmUrl(id) {
  if (customBgmMap[id]) return customBgmMap[id];
  var file = BGM_FILES[id];
  return file ? C.RES.AUDIO_DIR + file : null;
}
function getSfxUrl(id) {
  if (customSfxMap[id]) return customSfxMap[id];
  var file = SE_FILES[id];
  return file ? C.RES.SE_DIR + file : null;
}
```

`bgmChange` L99 和 `playSeFile` L62 改用 `getBgmUrl(id)` / `getSfxUrl(id)`。

### play.html 注入

`loadLevelObject` L429 末尾：
```js
if (window.AudioSys) {
  var bgmMap = {}, sfxMap = {};
  (obj.customBgm || []).forEach(function (b) { bgmMap[b.id] = b.dataUrl; });
  (obj.customSfx || []).forEach(function (s) { sfxMap[s.id] = s.dataUrl; });
  AudioSys.setCustomBgm(bgmMap);
  AudioSys.setCustomSfx(sfxMap);
}
```

## 功能7：多文件保存 + 读取多文件

### 保存（editor.js saveBtn L1532）

改为生成 4 个 Blob 顺序下载：
1. `catmario_level.json`：state（cols/theme/bgm/nextLevel/hintTexts/elements，含 `_customRefs` 引用 customId）
2. `custom_elements.json`：`CAT.ELEMENTS.filter(e => e.custom)`（含 dataUrl）
3. `custom_bgm.json`：`state.customBgm`
4. `custom_sfx.json`：`state.customSfx`

每个 Blob 间隔 100ms 触发 `a.click()`，避免浏览器拦截多下载。

### 读取（editor.js fileInput L1557）

- `fileInput` 加 `multiple` 属性
- change 事件遍历 `files`，按文件名前缀分流：
  - `/^catmario_level/` → level 数据
  - `/^custom_elements/` → 自定义元素
  - `/^custom_bgm/` → 自定义 BGM
  - `/^custom_sfx/` → 自定义音效
- 拖拽 drop 事件 L1828 同步处理多文件
- 读取顺序：先 custom_*（注入 CAT.ELEMENTS / state.customBgm/Sfx），再 level

### 缺失文件警告

加载后比对必需清单：
- 如果 level.elements 引用了 `custom_*` id 但未加载 custom_elements.json → 警告
- 如果 level.bgm 是自定义 id 但未加载 custom_bgm.json → 警告
- 警告方式：`alert('缺少文件：\n- custom_elements.json（画布上有自定义元素）\n- custom_bgm.json（BGM 引用了自定义音频）')`
- 不阻塞已加载部分，自定义元素缺失时画布对应位置显示占位符

## 需要修改的文件

1. **elements.js** — 暴露 `CAT.registerCustom(def)` / `CAT.removeCustom(id)`
2. **editor.js** — 自定义元素/音频 UI、多文件保存/读取、`getImg`/`drawSprite` 适配 dataUrl
3. **play.html** — `convert` 增 `EX_CUSTOM` 分发；`loadLevelObject` 注入 `AudioSys.setCustom*`
4. **game/audio.js** — `BGM_FILES`/`SE_FILES` 改函数式 + `setCustomBgm/Sfx` 接口
5. **game/engine.js** — `loadStage` 注册自定义 stype；`render` 背景层支持 dataUrl；`spawnEnemy` 支持 atype>=200

## 验证方案

1. **功能5**：编辑器上传图片 → 配置属性 → 放置画布 → 试玩 → 验证碰撞/渲染
2. **功能6**：上传 mp3 → 音乐 TAB 选择 → 试玩 → 验证 BGM 播放/音效触发
3. **功能7**：保存 → 检查 4 个文件 → 读取 → 验证完整还原；故意缺少文件 → 验证警告
