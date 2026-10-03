# 录像录制/播放系统 实施计划

## 需求
- 仅在游戏尚未开始（标题画面 proc=100）时可启动录制
- 录制结束后可下载录像文件
- 播放 = 录像文件 + 游戏数据（关卡 def 内嵌）经同一引擎确定性还原画面与镜头
- 录像记录每物理帧玩家按键，不存画面；引擎 + 关卡数据重放模拟

## Repository Research（关键事实）

- 物理主循环：[engine.js](file:///r:/PythonNewProcject/NewCatMarioEditor/game/engine.js) 的 `frame()`（L3565）是唯一物理帧入口，由 `loop()` 的固定步长累加器驱动（30/60/120Hz，`C._DT=30/FPS`）；暂停 F 单步与 `Engine._stepFrame` 也走 `frame()`。**在 frame 层录制即覆盖所有路径**。
- 输入：每帧仅 `var key = IN.get()`（L3581，位掩码 1/2/4/8/16/32）+ `IN.consumeSuicide()`（O 键，L3605）。`IN.endFrame()` 帧末调用。
- 随机源（全部 Math.random，需替换为种子 RNG）：
  - engine.js:197 `oldRand`（敌人嘲讽台词）
  - engine.js:685-720 `_randomizeElements`（0 随机模式，影响玩法）
  - engine.js:750 火焰棒初相（影响玩法）
  - engine.js:2211 机器人相遇 50%（影响玩法）
  - [elements.js](file:///r:/PythonNewProcject/NewCatMarioEditor/game/elements.js):779 喷火管火球随机初速（影响玩法）
  - 已确认全仓再无其他玩法相关随机（Date.now 仅事件日志，performance.now 仅 rAF 调度，音频单向不影响模拟）。
- **镜头宽度 FXMAX 参与物理**：loadStage 镜头居中（L657）、关卡右边界钳制（L1175）、触发器/管道/升降台生成门控（L1502/1721-1735/1822）、滚镜阈值（L2708）。FXMAX 由 resizeCanvas 按窗口尺寸动态计算 → 录制/播放必须锁定同一虚拟宽度，否则敌人生成时刻不同步。方案：录制与播放期间锁定标准宽 480（FXMAX=48000），画面居中加黑边。
- 开局两条路径（必须分别精确复刻，差 1 帧都会错位）：
  - 标题按键：frame 末尾 TITLE 分支 `if(key) beginNewGame()`（L3689），当帧 maintm 走的是 TITLE 分支；
  - 外部开局：宿主点击/按钮直接调 `Engine.startGame()`（= beginNewGame + `_debugFrame=0`），在帧间完成，首帧即 STAGE_START 倒计时。
- 换关/传送：warp（L1006）、goal（L1028/1068）、note（L1108）经宿主钩子 `state.onWarp/onGoalNext` 决策；宿主在回调中会：写 `state.sta/stb/stc`（世界链）、调 `setWarpSpawn`、返回 false 时 `backToTitle()`。这些钩子副作用必须录制并重放。死亡复活（L912）、普通进管 stc++ 全在引擎内部，确定性自动重现。
- 关卡来源：`loadStage()` 调 `Lv.get(sta,stb,stc)`（L373）；play.html 覆盖了 `Levels.get`（闭包返回 levelConv / STAGES 世界）。录制时在 loadStage 内对返回的 def 做快照（JSON 安全：grid+blocks+pipes+enemies+lifts+eventTriggers+warp/bhv 等均为纯数据），播放时按调用次序回放快照，绕过宿主 Levels。
- state.cheat（C 键，玩法相关）、state.randomMode（标题 0 键）需随开局录制；speedup（空格）只影响每秒帧数不影响帧内容，无需录制，播放时可作快进。
- 页面：game/index.html（原版 1-1）与 play.html（自定义/世界链试玩）共用 game/ 下引擎；play.html 有 `<base href="game/">`。两页都有顶栏/底栏按钮与版本号 `?v=` 约定（改 JS 必递增）。

## 文件与改动

- **新增** `game/replay.js`：种子随机 `GameRand`（mulberry32）+ 录制/播放控制器 `GameReplay`（状态机 + 帧流/事件/关卡快照 + 文件编解码）。无引擎私有状态，靠引擎在 begin/start 时注入 api 闭包。
- `game/engine.js`：5 处 Math.random → GameRand；frame 输入/自杀/帧末挂 Replay 钩子；loadStage 关卡快照截获/回放；warp/goal/note 钩子经 Replay 路由；resizeCanvas 锁宽 + 渲染偏移；renderScene 黑边清理 + REC/PLAY 角标；Engine.startGame 外部开局通知与播放期拦截；setFps 录制播放期锁定；新增 `Engine.Replay` 公开 API；C 键作弊在播放期屏蔽。
- `game/elements.js`：L779 `rnd` 改用 `global.GameRand.int(n)`。
- `game/index.html`：加 replay.js script、版本号、底部栏「● 录制 / 📂 播放录像」按钮 + 隐藏 file input + 控制胶水（与现有镜头/FPS 代码同风格 IIFE）。
- `play.html`：同上，按钮加在 #topbar；播放期间拦截宿主点击开局（引擎层已兜底）。

## 录像文件格式（.json，自包含）
```json
{
  "app": "catmario-replay", "ver": 1, "engineVer": "rep1",
  "fps": 60, "seed": 1234567890, "viewW": 480,
  "meta": { "date": "...", "durationFrames": 0, "startType": "ext|key" },
  "stages": [ {def...} ],          // 去重后的关卡 def
  "stageSeq": [0, 0, 1],           // 每次 loadStage 使用的 def 序号
  "events": [ [f, type, data] ],   // 开局标记/cheat/钩子决策
  "frames": "<base64>"             // 每物理帧 1 字节：低6位=按键掩码，bit6=O自杀
}
```
事件类型：
- `[f,"start",{ext:true|false,sta,stb,stc,randomMode,cheat}]`
- `[f,"cheat",{v}]`
- `[f,"hook",{kind:"warp"|"goal",no:0,r:bool,ws:warpSpawn快照,sta,stb,stc}]`

## 实施步骤（依赖序）
1. 新建 `game/replay.js`：GameRand（seed/int/float）；GameReplay 状态机（off/record/play/ended/error）；beginRecord/stopRecord/startPlay/stopPlay；preFrame/suicide/postFrame；captureStage/nextStage；hostHook 录制与回放；视角锁 lockViewW()；base64 帧编解码、def 哈希去重（cyrb53）、文件校验。
2. engine.js 接入：
   - Math.random 五处替换；
   - frame()：`key=GR.preFrame(IN.get())`、自杀走 `GR.suicide(IN)`、末尾 `GR.postFrame()`；
   - loadStage()：play 取 `GR.nextStage()`，record 调 Lv.get 后 `GR.captureStage()`；
   - 三处宿主钩子包一层 `_replayHook(kind,arg,orig)`；
   - Engine.startGame 包外部开局通知（play 模式直接忽略）；setFps 活跃期锁定；播放期屏蔽 C 键；
   - resizeCanvas 锁 480 + `_renderOffsetX`；renderScene 先全屏黑底再按偏移变换；loop 末尾画 REC/PLAY 角标；
   - 暴露 `Engine.Replay = {beginRecord,stopRecord,startPlay,stopPlay,status}`，注入 api（externalStart=beginNewGame+_debugFrame=0、backToTitle、state、setFps/getFps）。
3. elements.js L779 改 GameRand。
4. game/index.html：script 与版本号（replay.js?v=1、engine/elements 升 ?v=rep1）、按钮与胶水：录制仅标题可启；停止即下载；自动终局（回标题）后可下载；选文件即播放；状态轮询更新按钮/提示。
5. play.html 同步 UI（#topbar 两按钮 + file input）与同版胶水。
6. 验证（下详）。
7. 递增全部 ?v 版本号；更新项目记忆。

## 确定性与兼容性要点
- 录制从标题开始 arm，最终化时裁掉开局前的标题帧，帧流第 0 帧 = 开局帧；key/ext 两种开局标记在播放时分别以"帧前 externalStart"与"标题键自然触发"精确复刻。
- FPS 写入文件并在播放时 setFps 强制；录制中禁止切换刷新率；结束恢复用户设置。
- 回标题（钩子 r=false）自动终局；手动停止允许截断（播放到末尾强制回标题）。
- 播放期忽略真实键盘输入（经 preFrame 注入），但 P 暂停、F 单步、空格快进仍可用（只改变推进节奏，不改变帧内容）。
- 回放宿主钩子时不再回调页面 onWarp/onGoalNext（只复刻其对引擎 state 的副作用：坐标/warpSpawn/回标题），故录像不依赖 play.html 场景库是否还存在。
- 自定义 BGM/音效不内嵌（纯表现，不影响模拟）；def 内 bgm id 仍可播默认音乐。
- 文件带 ver/engineVer，不兼容直接报错不播放。

## 验证
- 新增 `tools/replay_test.js`（node 直接运行，仿 physics_speed_test.js 的 vm 沙箱 mock）：脚本化按键录制约 600-1200 帧（含走/跳/击杀/死亡复活/进管换关），录制侧每 60 帧采集 (proc,ma,mb,fx,enemies,life)；同上下文 startPlay 重放逐帧比对全部采样点一致；断言：文件自包含可 JSON 往返、stageSeq 次序、frames 长度、错误文件被拒。
- 浏览器手动验证（game/index.html 与 play.html 各一次，Ctrl+F5）：标题录制约 1 分钟→自动/手动停止→下载 JSON；拖入/选择录像→画面、镜头、死亡、换关与原过程一致；空格快进、P 暂停正常；非标题状态录制按钮禁用；录制播放中镜头锁定 480 居中黑边。
- 回归：现有 tools/physics_speed_test.js 32 项仍全过（确认 RNG 替换与钩子不改变非录制路径行为）。

## 风险
- 遗漏的非确定性源（如宿主外部 state 写入）：无头逐帧状态比对测试兜底；浏览器实测含进管/通关路径。
- 录像体积（内嵌 17×1001 grid 约 50-150KB/关）：def 哈希去重，死亡/复活重复关不重复存；总体积可接受。
- 玩家窗口小于 480 虚拟宽时播放裁切：480 为引擎原始设计宽，等比居中、仅两侧黑边/裁切，属可接受折中，并在录制按钮提示中说明。
- def 中若混入非 JSON 字段：快照用 JSON 往返，序列化失败在录制开始即报错而非产出坏录像。
