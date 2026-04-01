/**
 * InputManager — maps keyboard keys to actions for up to 5 local players.
 *
 * Each player has: up, down, left, right, bomb, action (remote detonate)
 *
 * Controls:
 *  P1: WASD + Space (bomb) + E (action)
 *  P2: Arrow keys + Enter (bomb) + RightShift (action)
 *  P3: IJKL + U (bomb) + O (action)
 *  P4: Numpad 8456 + Numpad0 (bomb) + NumpadDot (action)
 *  P5: TFGH + R (bomb) + Y (action)
 */
export class InputManager {
  constructor(scene) {
    this.scene = scene;
    this.keys = [];
    this._setupKeys();
  }

  _setupKeys() {
    const KB = Phaser.Input.Keyboard;
    const add = (code) => this.scene.input.keyboard.addKey(code, true, true);

    this.keys = [
      // Player 0
      {
        up:     add(KB.KeyCodes.W),
        down:   add(KB.KeyCodes.S),
        left:   add(KB.KeyCodes.A),
        right:  add(KB.KeyCodes.D),
        bomb:   add(KB.KeyCodes.SPACE),
        action: add(KB.KeyCodes.E),
      },
      // Player 1
      {
        up:     add(KB.KeyCodes.UP),
        down:   add(KB.KeyCodes.DOWN),
        left:   add(KB.KeyCodes.LEFT),
        right:  add(KB.KeyCodes.RIGHT),
        bomb:   add(KB.KeyCodes.ENTER),
        action: add(KB.KeyCodes.SHIFT),
      },
      // Player 2
      {
        up:     add(KB.KeyCodes.I),
        down:   add(KB.KeyCodes.K),
        left:   add(KB.KeyCodes.J),
        right:  add(KB.KeyCodes.L),
        bomb:   add(KB.KeyCodes.U),
        action: add(KB.KeyCodes.O),
      },
      // Player 3 (Numpad)
      {
        up:     add(KB.KeyCodes.NUMPAD_EIGHT),
        down:   add(KB.KeyCodes.NUMPAD_FIVE),
        left:   add(KB.KeyCodes.NUMPAD_FOUR),
        right:  add(KB.KeyCodes.NUMPAD_SIX),
        bomb:   add(KB.KeyCodes.NUMPAD_ZERO),
        action: add(KB.KeyCodes.NUMPAD_ADD),
      },
      // Player 4
      {
        up:     add(KB.KeyCodes.T),
        down:   add(KB.KeyCodes.G),
        left:   add(KB.KeyCodes.F),
        right:  add(KB.KeyCodes.H),
        bomb:   add(KB.KeyCodes.R),
        action: add(KB.KeyCodes.Y),
      },
    ];
  }

  getState(playerIndex) {
    const k = this.keys[playerIndex];
    if (!k) return null;
    return {
      up:        k.up.isDown,
      down:      k.down.isDown,
      left:      k.left.isDown,
      right:     k.right.isDown,
      bombJust:  Phaser.Input.Keyboard.JustDown(k.bomb),
      actionJust: Phaser.Input.Keyboard.JustDown(k.action),
    };
  }

  destroy() {
    this.keys.forEach(set => {
      Object.values(set).forEach(key => key.destroy());
    });
  }
}
