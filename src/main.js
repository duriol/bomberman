import Phaser from 'phaser';
import { MenuScene } from './scenes/MenuScene.js';
import { GameScene } from './scenes/GameScene.js';
import { LobbyScene } from './scenes/LobbyScene.js';
import { GAME_WIDTH, CANVAS_HEIGHT } from './data/constants.js';

const config = {
  type: Phaser.AUTO,
  width:  GAME_WIDTH,
  height: CANVAS_HEIGHT,
  backgroundColor: '#111111',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false,
    },
  },
  scene: [MenuScene, LobbyScene, GameScene],
  parent: 'game-canvas',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    pixelArt: false,
    antialias: true,
  },
};

const game = new Phaser.Game(config);
export default game;
