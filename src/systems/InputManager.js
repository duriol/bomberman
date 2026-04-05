/**
 * InputManager — maps keyboard keys to actions for up to 5 local players.
 *
 * Each player has: up, down, left, right, action1..action4.
 *
 * Controls:
 *  P1: WASD + J(action1) + K(action2) + H(action3) + U(action4)
 *  P2: Arrows + ;(action1) + '(action2) + L(action3) + P(action4)
 *
 * action1 = character ability
 * action2 = place bomb
 * action3 = item action (multi-bomb for now)
 * action4 = reserved (unused)
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
        action1: add(KB.KeyCodes.J),
        action2: add(KB.KeyCodes.K),
        action3: add(KB.KeyCodes.H),
        action4: add(KB.KeyCodes.U),
      },
      // Player 1
      {
        up:     add(KB.KeyCodes.UP),
        down:   add(KB.KeyCodes.DOWN),
        left:   add(KB.KeyCodes.LEFT),
        right:  add(KB.KeyCodes.RIGHT),
        action1: add(KB.KeyCodes.SEMICOLON),
        action2: add(KB.KeyCodes.QUOTE),
        action3: add(KB.KeyCodes.L),
        action4: add(KB.KeyCodes.P),
      },
      // Player 2
      {
        up:     add(KB.KeyCodes.I),
        down:   add(KB.KeyCodes.K),
        left:   add(KB.KeyCodes.J),
        right:  add(KB.KeyCodes.L),
        action1: add(KB.KeyCodes.Y),
        action2: add(KB.KeyCodes.U),
        action3: add(KB.KeyCodes.H),
        action4: add(KB.KeyCodes.J),
      },
      // Player 3 (Numpad)
      {
        up:     add(KB.KeyCodes.NUMPAD_EIGHT),
        down:   add(KB.KeyCodes.NUMPAD_FIVE),
        left:   add(KB.KeyCodes.NUMPAD_FOUR),
        right:  add(KB.KeyCodes.NUMPAD_SIX),
        action1: add(KB.KeyCodes.NUMPAD_TWO),
        action2: add(KB.KeyCodes.NUMPAD_SIX),
        action3: add(KB.KeyCodes.NUMPAD_FOUR),
        action4: add(KB.KeyCodes.NUMPAD_EIGHT),
      },
      // Player 4
      {
        up:     add(KB.KeyCodes.T),
        down:   add(KB.KeyCodes.G),
        left:   add(KB.KeyCodes.F),
        right:  add(KB.KeyCodes.H),
        action1: add(KB.KeyCodes.V),
        action2: add(KB.KeyCodes.B),
        action3: add(KB.KeyCodes.N),
        action4: add(KB.KeyCodes.M),
      },
    ];
  }

  getState(playerIndex) {
    const k = this.keys[playerIndex];
    if (!k) return null;

    const state = {
      up:         k.up.isDown,
      down:       k.down.isDown,
      left:       k.left.isDown,
      right:      k.right.isDown,
      action1Just: Phaser.Input.Keyboard.JustDown(k.action1),
      action2Just: Phaser.Input.Keyboard.JustDown(k.action2),
      action3Just: Phaser.Input.Keyboard.JustDown(k.action3),
      action4Just: Phaser.Input.Keyboard.JustDown(k.action4),
    };

    // Temporary aliases to keep call sites stable while migration completes.
    state.bombJust = state.action2Just;
    state.actionJust = state.action3Just;

    // Merge on-screen controls for player 0 (mobile)
    if (playerIndex === 0) {
      const joy  = window._mobileJoystick;
      const btns = window._mobileBtns;
      if (joy) {
        state.up    = state.up    || !!joy.up;
        state.down  = state.down  || !!joy.down;
        state.left  = state.left  || !!joy.left;
        state.right = state.right || !!joy.right;
        // Analog vector: lets Player skip the 0.707 diagonal normalization
        if (joy.vx !== 0 || joy.vy !== 0) {
          state.joy = { vx: joy.vx, vy: joy.vy };
        }
      }
      if (btns) {
        state.action1Just = state.action1Just || !!btns.a1;
        state.action2Just = state.action2Just || !!btns.a2 || !!btns.bomb;
        state.action3Just = state.action3Just || !!btns.a3 || !!btns.action;
        state.action4Just = state.action4Just || !!btns.a4;
        state.bombJust = state.action2Just;
        state.actionJust = state.action3Just;

        btns.a1 = false;
        btns.a2 = false;
        btns.a3 = false;
        btns.a4 = false;
        btns.bomb = false;
        btns.action = false;
      }
    }

    return state;
  }

  destroy() {
    this.keys.forEach(set => {
      Object.values(set).forEach(key => key.destroy());
    });
  }
}
