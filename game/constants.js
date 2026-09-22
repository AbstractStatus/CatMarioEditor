// ===================================================================
// 猫里奥新引擎 - 常量定义
// 坐标单位：像素*100（与原版一致，如 mascrollmax=21000 即 210px）
// 瓦片尺寸：29px
// 画布：480 x 420
// ===================================================================
(function (global) {
  'use strict';

  var C = {};

  // ---- 画布 ----
  C.CANVAS_W = 480;
  C.CANVAS_H = 420;
  C.FPS = 60;               // 物理帧率（原版30，提升至60）
  C._DT = 30 / C.FPS;       // 帧率缩放因子（0.5=60Hz相对30Hz，2的幂次确保整数帧比较精确）

  // ---- 瓦片 ----
  C.TILE = 29;              // 单格像素
  C.ROWS = 17;              // 地图行数
  C.COLS = 1001;            // 地图列数

  // ---- 镜头 ----
  C.FXMAX = 48000;          // 屏幕宽（*100）
  C.FYMAX = 42000;          // 屏幕高（*100）
  C.MASCROLLMAX = 21000;    // 玩家在屏幕上的最大 x（触发右滚）
  C.MASCROLLMIN = 16000;    // 玩家在屏幕上的最小 x（触发左滚）

  // ---- 玩家 ----
  C.PLAYER_W = 3000;        // mnobia 宽
  C.PLAYER_H = 3600;        // mnobib 高
  C.PLAYER_GIANT_W = 5200;
  C.PLAYER_GIANT_H = 7300;
  C.GRAVITY = 100;          // 每帧重力
  C.MAX_FALL = 1600;        // 最大下落速度
  C.MAX_RUN = 800;          // 最大奔跑速度
  C.JUMP_V = -1200;         // 跳跃初速
  C.JUMP_HOLD_BOOST = -1300;

  // ---- 输入键位 ----
  C.KEY = {
    LEFT: 0x01,
    RIGHT: 0x02,
    DOWN: 0x04,
    UP: 0x08,
    JUMP: 0x10,
    CLICK: 0x20
  };

  // ---- 主流程状态 ----
  C.PROC = {
    TITLE: 100,
    STAGE_START: 10,
    GAME: 1,
    ENDING: 2
  };

  // ---- 关卡字节编码 ----
  // 1-19: 方块(1砖/2问号/3硬/4楼梯/5地面表/6地面填/7隐藏/8猫脸/10尖刺)
  // 9: 金币
  // 20-29: 升降台
  // 30: 中间旗
  // 40-44: 管道(40竖口/41竖身/43竖变/44横)
  // 50-79: 敌人触发器(type=字节-50)
  // 80-89: 背景
  // 99: 终点杆
  C.TILE_BYTE = {
    BRICK: 1, QUESTION: 2, HARD: 3, STAIR: 4,
    GROUND_TOP: 5, GROUND_FILL: 6, HIDDEN: 7, CAT: 8,
    COIN: 9, SPIKE: 10,
    LIFT: 20,
    MIDFLAG: 30,
    PIPE_TOP: 40, PIPE_BODY: 41, PIPE_V2: 43, PIPE_H: 44,
    GOAL: 99
  };

  // ---- 方块 ttype ----
  // <100: 普通方块(字节值)
  // 100-199: 特殊交互块
  // 300+: 提示块等
  C.TTYPE = {
    EMPTY: 0, BRICK: 1, QUESTION: 2, HARD: 3, STAIR: 4,
    GROUND_TOP: 5, GROUND_FILL: 6, HIDDEN: 7, CAT: 8,
    SPIKE: 10,
    COIN: 800,                    // 金币(由 P 开关生成)
    MUSHROOM_RED: 100,            // 红蘑菇问号块
    ENEMY_BLOCK: 101,             // 出怪问号块
    POISON_BLOCK: 102,            // 毒蘑菇问号块
    BADSTAR_BLOCK: 104,           // 恶星问号块
    POISON_MASS: 110,             // 毒蘑菇量产
    COIN_MASS: 112,               // 金币量产
    HIDDEN_POISON: 114,           // 隐藏毒蘑菇
    FRAGILE: 115,                 // 脆块
    P_SWITCH_SPAWN: 116,          // P开关生成块
    NOTE: 117,                    // 音符块
    JUMP_PAD: 120,                // 跳台
    ON_SWITCH: 130, OFF_SWITCH: 131,
    SWORD: 140, BLADE: 141, PINEAPPLE: 142,
    FIREBAR_BUFF: 124,
    HINT: 300, HINT_BREAK: 301,
    P_SWITCH: 400
  };

  // ---- 敌人 atype ----
  C.ATYPE = {
    SYOBON: 0,        // 白猫怪
    TURTLE: 1,        // 绿龟
    SHELL: 2,         // 龟壳
    GHOST: 3,         // 幽灵
    KING: 4,          // 皇冠怪
    BEAR: 5,          // 熊
    DEFRAG: 6,        // 方块机器人(投掷)
    CANNON: 7,        // 大炮
    BOON: 8,          // 飞行怪
    BOON_NORMAL: 151, // 普通飞行怪
    FIREBALL_SMALL: 9,
    FIRE: 10,         // 火焰
    MORALAR: 30,      // 小猫咪
    CHICKEN: 31,      // 肌肉鸡
    LASER: 79,        // 激光
    CLOUD_FACE: 80,   // 脸云
    CLOUD_PLAIN: 81,  // 普通云
    BLOCK_MIMIC: 82,  // 方块伪装
    SPIKE_BALL: 83,   // 刺球
    FIREBALL: 84,     // 火球
    FAKE_POLE: 85,    // 假旗杆
    PEACH_CAT: 86,    // 桃色猫
    FIREBAR: 87,      // 火焰棒
    FIREBAR_REV: 88,
    BEAM: 90,         // 光束
    MUSHROOM: 100,    // 红蘑菇(道具)
    FLOWER: 101,      // 火焰花(道具)
    POISON: 102,      // 毒蘑菇(道具)
    GREEN_Q: 105,     // 绿色问号球
    BADSTAR: 110      // 恶星
  };

  // ---- 管道/墙体 stype ----
  C.STYPE = {
    GROUND: 0,        // 地面
    PIPE_V: 1,        // 竖管
    PIPE_V_BODY: 2,   // 竖管身
    PIPE_H: 5,        // 横管
    ENTER_PIPE: 50,   // 可进入管道(陷阱)
    ENTER_PIPE_L: 40, // 从左进入管道
    FALL_BLOCK: 51,   // 下落块
    FALL_BLOCK2: 52,  // 下落块2
    GOAL: 300,        // 终点杆
    MIDFLAG: 500,     // 中间旗
    SPAWN_CAT: 100,   // 猫脸怪出现区域
    FIRE_PIPE: 101,   // 火焰管道
    TRAP: 102,        // 陷阱管道
    TRAP_MSG: 103,    // 陷阱消息
    BEAM_TRAP: 104,   // 光束陷阱
    LIFT_SWITCH: 105,
    FIRE_SPAWNER: 180
  };

  // ---- 升降台 srsp ----
  C.SRSP = {
    NORMAL: 0, YELLOW: 1, GREEN: 2,
    BREAKABLE: 10, SLIPPERY: 12, BRICK: 15, GRAY: 21
  };

  // ---- 粒子 egtype ----
  C.EGTYPE = {
    COIN: 0, BRICK_DEBRIS: 1, LIFT_DEBRIS_L: 2, LIFT_DEBRIS_R: 3,
    POLE: 4
  };

  // ---- 玩家 mtype ----
  C.MTYPE = {
    NORMAL: 0, GIANT: 1, NOTE: 2, JUMP_PAD: 3,
    PIPE: 100, GOAL_SLIDE: 300, ENDING: 301, ENDING2: 302,
    DEAD: 200
  };

  // ---- 音效 ID（与原版 soundplay 编号一致）----
  C.SE = {
    JUMP: 1, BLOCK_BREAK: 3, COIN: 4, STOMP: 5, SHELL: 6,
    PIPE: 7, BLOCK_ITEM: 8, POWERUP: 9, GHOST_SPRING: 10,
    GOAL: 11, DEATH: 12, P_SWITCH: 13, NOTE_BLOCK: 14, HINT: 15,
    SWORD_CLEAR: 16, ALL_CLEAR: 17, FIRE: 18
  };

  // ---- BGM ID ----
  C.BGM = {
    FIELD: 100, DUNGEON: 103, STAR: 104, CASTLE: 105, PUYO: 106
  };

  // ---- 敌人尺寸表（anobia, anobib）----
  C.ENEMY_SIZE = {
    0: [3000, 3000], 1: [3000, 4300], 2: [3000, 3000], 3: [3000, 4400],
    4: [3300, 3500], 5: [3700, 5500], 6: [3600, 5000], 7: [3200, 3200],
    8: [3700, 4700], 9: [2600, 3000], 10: [3000, 3000],
    30: [3000, 3600], 31: [4900, 7900],
    79: [12000, 1500], 80: [7000, 4000], 81: [7000, 4000],
    82: [3000, 3000], 83: [4900, 4800], 84: [3000, 3000],
    85: [2500, 30000], 86: [4900, 5900], 87: [3000, 3000],
    90: [6400, 6300],
    100: [3000, 3000], 101: [3000, 3000], 102: [3000, 3000],
    105: [3000, 3000], 110: [3000, 3000], 151: [3700, 4700],
    150: [3600, 5000], 152: [4900, 5900], 155: [3000, 3600],
    200: [3000, 3000]
  };

  // ---- 关卡颜色 ----
  C.STAGECOLOR = {
    OVERWORLD: 1, UNDERGROUND: 2, CASTLE: 4
  };

  // ---- 资源路径（相对于 game/）----
  C.RES = {
    SPRITE_DIR: '../assets/sprites/',
    AUDIO_DIR: '../assets/audio/',
    SE_DIR: '../soundEffect/'
  };

  global.Constants = C;
})(window);
