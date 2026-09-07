// ===================================================================
// 输入系统 - 键盘 + 触摸
// 位掩码：LEFT=1 RIGHT=2 DOWN=4 UP=8 JUMP=16 CLICK=32
// ===================================================================
(function (global) {
  'use strict';

  var C = global.Constants;
  var Input = {};

  var keyState = 0;
  var prevKeyState = 0;

  Input.init = function (canvas) {
    var map = function (code) {
      switch (code) {
        case 37: return C.KEY.LEFT;
        case 38: return C.KEY.JUMP;
        case 39: return C.KEY.RIGHT;
        case 40: return C.KEY.DOWN;
        case 13: return C.KEY.CLICK;
        case 32: return C.KEY.JUMP;
        default: return 0;
      }
    };

    var onKeyDown = function (e) {
      var b = map(e.keyCode);
      if (b) {
        keyState |= b;
        e.preventDefault();
      }
    };
    var onKeyUp = function (e) {
      var b = map(e.keyCode);
      if (b) {
        keyState &= ~b;
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);

    // 鼠标点击（用于开始游戏）
    canvas.addEventListener('mousedown', function () {
      keyState |= C.KEY.CLICK;
    });
    canvas.addEventListener('mouseup', function () {
      keyState &= ~C.KEY.CLICK;
    });

    // 触摸控制（简化版 - 屏幕分区）
    if (canvas) {
      var touches = {};
      var handleTouch = function (clientX, clientY, id, down) {
        var rect = canvas.getBoundingClientRect();
        var x = (clientX - rect.left) / rect.width * C.CANVAS_W;
        var y = (clientY - rect.top) / rect.height * C.CANVAS_H;
        var bit = 0;
        if (y < C.CANVAS_H) {
          if (x < C.CANVAS_W / 3) bit = C.KEY.LEFT;
          else if (x < C.CANVAS_W * 2 / 3) bit = C.KEY.JUMP;
          else bit = C.KEY.RIGHT;
          if (y > C.CANVAS_H * 0.7) bit = C.KEY.DOWN;
        }
        if (down) {
          touches[id] = bit;
        } else {
          delete touches[id];
        }
        var ts = 0;
        Object.keys(touches).forEach(function (k) { ts |= touches[k]; });
        keyState = ts | (keyState & 0);
      };

      canvas.addEventListener('touchstart', function (e) {
        e.preventDefault();
        for (var i = 0; i < e.changedTouches.length; i++) {
          var t = e.changedTouches[i];
          handleTouch(t.clientX, t.clientY, t.identifier, true);
        }
      }, { passive: false });
      canvas.addEventListener('touchend', function (e) {
        e.preventDefault();
        for (var i = 0; i < e.changedTouches.length; i++) {
          var t = e.changedTouches[i];
          handleTouch(t.clientX, t.clientY, t.identifier, false);
        }
      }, { passive: false });
    }
  };

  Input.get = function () {
    return keyState;
  };

  Input.getPressed = function () {
    return keyState & ~prevKeyState;
  };

  Input.endFrame = function () {
    prevKeyState = keyState;
  };

  // 直接设置按键状态（用于测试/自动化）
  Input.set = function (mask) {
    keyState = mask;
  };
  Input.add = function (mask) {
    keyState |= mask;
  };
  Input.clear = function () {
    keyState = 0;
  };

  global.Input = Input;
})(window);
