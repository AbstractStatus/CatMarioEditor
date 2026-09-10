# 绿龟占格修正 + 连锁坠落砖块组 实施方案

## 调研结论

### 问题 1：绿龟怪占两个格子
- 编辑器元素目录 [new/elements.js:162-163](file:///r:/PythonNewProcject/NewCatMarioEditor/new/elements.js#L162-L163) 中 `enemy_turtle` 声明 `tw:1, th:2`，放置/擦除/碰撞占位都按 2 格高处理。
- 原版中它只是**地图上的一个字节（51 → 敌人触发器 btype=1）**，只占 1 格（main.cpp:4091-4093）；精灵图为 30×43，以格子左上角为原点绘制，向下溢出约 14px。新引擎常量 `ENEMY_SIZE[1]=[3000,4300]`（constants.js:192）即同一口径。
- 因此修正方式：编辑器改为 1 格占位，画布上按精灵原始比例（30×43 随 TILE 缩放、格顶对齐）绘制，与试玩画面 1:1。转换侧无需改动（mapId 51 本就写单字节）。

### 问题 2：1-1 三连坠落砖块（原版 stype=51）
- 1-1 数据（main.cpp:4189）：`sa=49*29*100, sb=(5*29-12)*100, sc=9000-1, sd=3000, stype=51, sxtype=0`，即**第 49 列第 5 行、3 块横排砖块**（红圈位置）。
- 触发与运动（main.cpp:2471-2501）：
  1. 待机时是**普通实心砖块**，可站立；
  2. 玩家右缘完全进入砖组水平范围（`ma+mnobia > sa+3200` 且 `< sa+sc-200`，即走过第一块砖）**且脚底在砖组顶下方 3000 以下**（人在砖组下方）→ `sgtype=1` 开始下落；
  3. 下落：`sr += 120/帧，上限 1600；sb += sr`（30fps 加速下落）；
  4. **下落过程中关闭实体碰撞，只要与玩家 AABB 相交就 `mhp--`（碰到即死，头顶被砸中同理）**；
  5. 落到 `fymax+18000` 以下停止；触发一次后不复位（重开关卡才复位）。
- sxtype 变体：`10`=硬砖块横排、触发余量更小（1-4 城堡）；`3/4`=二维砖块阵、按玩家高度触发（1-4）；`1/2`=与 27/28 号陷阱管道上升联动（1-2）。
- 同类还有 **stype=52（坠落地面块，main.cpp:2504-2512）**：1-1 第 72 列用到，6 块连排，触发带更深（进入约 2 块砖）、保持实体（可踩可随其移动）、**不造成伤害**，贴图为地面表+填两格高。
- 新引擎现状：
  - [new/game/elements.js:170-215](file:///r:/PythonNewProcject/NewCatMarioEditor/new/game/elements.js#L170-L215) 已注册 51/52 的**渲染**，但引擎完全没有运动/触发逻辑 → 示例世界里它们是静止实心砖；
  - [new/editor.js:1399](file:///r:/PythonNewProcject/NewCatMarioEditor/new/editor.js#L1399) worldToElements 显式跳过 51/52 → 编辑器载入 1-1 时红圈处空白；
  - stages_data.js 已正确提取 1-1 的两条数据（51: sa=142100/sb=13300/sc=8999；52: sa=208800/sb=36500/sc=14999）。
- 引擎物理为固定 30fps timestep（engine.js:1284），原版 120/1600 等常量可直接使用。

## 方案设计

### A. 绿龟：1 格占位 + 原比例渲染
- 元素目录 `enemy_turtle` 改为 `tw:1, th:1`。
- 编辑器画布：敌人在 th=1 时按精灵原始宽高比绘制（宽=30/29*TILE、高=43/29*TILE，左上角对齐格点，允许向下溢出到相邻格但不占格）。仅改绿龟，其他高个子敌人（幽灵/吐舌猫等 th=2）维持现状。

### B. 新编辑器元素「坠落砖组」
- id：`block_fall`，分类 struct（地形/机关），kind=vector（编辑器用 block_brick 精灵拼排绘制），默认 3 块横排。
- 数据结构：`{ id:'block_fall', col, row, ori:'h'|'v', count:3, dir:'down'|'up'|'left'|'right' }`
  - `ori='h'` 横排：占位 1 行 × count 列，dir 限 `down`（默认）/ `up`；
  - `ori='v'` 竖排：占位 count 行 × 1 列，dir 限 `left` / `right`（默认 `left`）；
  - count 范围 2~12。
- 占格/擦除/拖动/选中框/悬停预览：仿照 lift_* 的动态 footprint 模式（footprint/footprintOf/placeAt/eraseAt/drag/hover 六处特判）。
- 画布渲染：count 张砖块精灵横/竖拼接；砖组中心叠加一个细小的**方向箭头**标明运动方向（待机时也可见，便于识别机关）。
- 属性弹窗（复用现有 ⚙ propBtn/propModal，仿火焰棒/升降台）：
  - 排列：下拉（横排/竖排）；
  - 砖块数：数字（2~12）；
  - 移动方向：下拉，选项随排列过滤（横排=上/下，竖排=左/右），改排列导致方向非法时自动修正；
  - 位置行复用通用列/行输入；修改走 pushHistory（可 Ctrl+Z）。
- 面板标签 hint 说明：玩家完全进入砖组长轴区域并处于运动方向一侧时触发，加速移动、碰到即死。

### C. 试玩转换（play.html convert）
新增分支，与 pipe_trap/pipe_warp 同级，输出 pipes 条目：
- 横排：`sc = count*3000-1, sd = 3000`；竖排：`sc = 3000, sd = count*3000-1`；
- `sa = col*29*100, sb = (row*29-12)*100, stype = 51, sxtype = 0`；
- 附加通用运动配置 `mov: { axis:'x'|'y', dir:-1|1 }`（down/up→y，left/right→x）。

### D. 引擎行为（new/game）
1. engine.js loadStage：复制管道时保留 `mov` 字段（目前只保留 warp）。
2. engine.js collidePipes：在常规实体碰撞之前，调用注册表新钩子 `PT.get(stype).physics(p,s,xx,state,A)`；返回 true 时置 `xx[7]=1` 跳过该实体本帧常规碰撞。仅 `p.mtype < 10` 时执行（与原版条件一致）。
3. game/elements.js：
   - **PipeTypes[51].physics**（数据驱动，不硬编码元素）：
     - 通用 `mov` 路径（自定义砖组）：
      - 触发：长轴“完全进入”判定（玩家前进缘越过起点+3200 且未越过远端-200）+ 位于运动方向一侧（down：脚底>sb+3000；up：头顶<sb-3000；left：右缘<sa-200；right：左缘>sa+sc+200）；
      - 运动：`sr += 120，封顶 1600`，沿 axis/dir 更新 sa 或 sb；
      - 致死：运动中与玩家 AABB 相交 → `p.mhp--`（每帧判定，直接致死，不用无敌帧，与原版一致）；
      - 飞出镜头外 20000 后置 `sa=-80000000` 哨兵停用；
      - 返回 true（运动中关闭实体碰撞）。
    - 经典路径（无 mov，示例世界）：sxtype=0 完全照搬原版触发（+3200/下方+3000）；sxtype=10 用 +1200 余量；sxtype=3/4 保留高度阈值（mb≥30000/25000，sxtype4 初速 100）；sxtype=1/2 维持现状（静态，不在本次范围）。
    - 渲染扩展：sxtype=0 分支当 `sd>sc` 时纵向铺砖块贴图，支持自定义竖排；贴图仍随 stagecolor 走 +30/+60 主题偏移。
  - **PipeTypes[52].physics**：照搬原版（进入+2200 且未到远端-2700、脚底在顶-3000 以下触发；同样 120/1600 下落）；**不致死、不关闭实体碰撞**（返回 false，玩家可踩可被推）。编辑器暂不暴露该元素，仅保证示例世界试玩 1:1。
4. editor.js worldToElements：stype=51 且 sxtype=0 且横排（sc≥sd）→ 还原为 `block_fall {ori:'h', count:floor(sc/3000)+1, dir:'down'}`，col=sa/2900、row=(sb/100+12)/29；其余 51 变体与 52 保持现有 skip（不暴露），试玩仍由 stages_data 1:1 驱动。

## 涉及文件
- `new/elements.js`：绿龟 th 改 1；新增 block_fall 元素定义。
- `new/editor.js`：绿龟原比例绘制；block_fall 动态占位六处特判 + 矢量绘制（砖块+方向箭头）+ 属性弹窗（排列/数量/方向）+ worldToElements 还原。
- `new/play.html`：convert 增加 block_fall → stype51+mov。
- `new/game/engine.js`：loadStage 保留 mov；collidePipes 派发 physics 钩子。
- `new/game/elements.js`：PipeTypes[51] 通用/经典 physics + 竖排渲染；PipeTypes[52] physics。

## 验证
1. 编辑器：绿龟只占 1 格、图像比例正常不拉伸；坠落砖组放置/擦除/拖动/多选不串格；属性弹窗改排列/数量/方向后占格与箭头正确；撤销重做正常。
2. 载入示例世界 1-1（硬刷新 Ctrl+F5）：第 49 列第 5 行出现 3 块砖且可继续编辑；重复载入不产生重复元素。
3. 试玩 1-1：走到 49 列砖组下方深处→砖块加速坠落，站立不被提前触发；下落中触碰（头顶/身体）即死亡；死亡自动重开后砖组复位；第 72 列 stype52 地面块下落但不致死、可踩踏。
4. 自定义关卡：横排上/下落、竖排左/右移四个方向各测一次；数量边界 2 与 12；存档/读档/试玩数据保留属性。
5. 控制台无报错；1-2/1-4 中原静态的 sxtype 1/2/3/4/10 外观行为不回归。

## 风险与对策
- 世界坐标/屏幕坐标混用：新引擎玩家与管道均为世界坐标，触发判定直接用世界量，不用再减 fx。
- 60fps 页面下物理变快：引擎物理固定 30fps timestep，常量沿用原版，无需折半。
- 运动中实体碰撞与致死判定顺序：钩子必须在常规碰撞前执行并返回 xx[7]=1（与原版 main.cpp 执行顺序一致），否则会被顶回/踩稳导致不死。
- 1-4 的 sxtype=10/3/4 若还原进编辑器会因贴图/触发阈值不同产生偏差：本次 worldToElements 只还原 sxtype=0 横排，其余保持 skip，零回归。
