import './style.css';
import { Game } from './engine/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const messageLogEl = document.querySelector<HTMLElement>('#message-log');
const statusBarEl = document.querySelector<HTMLElement>('#status-bar');
const menuEl = document.querySelector<HTMLElement>('#menu-overlay');
if (!canvas || !messageLogEl || !statusBarEl || !menuEl) {
  throw new Error('Missing #game-canvas, #message-log, or #status-bar element');
}

const game = new Game(canvas, messageLogEl, statusBarEl, menuEl);
game.start();
