import { DIAGONAL_CHORD_WINDOW_MS } from '../config/constants';
import type { Direction } from '../utils/geometry';
import { KeyChordDetector, type ArrowKey } from './KeyChordDetector';

const ARROW_KEYS = new Set<string>(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export interface InputCallbacks {
  onDirection: (direction: Direction) => void;
  onWait: () => void;
}

/**
 * Wires raw DOM keyboard events to game actions. Movement goes through KeyChordDetector (arrow
 * cardinals, chord diagonals); everything else is a direct key mapping. NetHack-style action keys
 * (inventory, look, etc.) land here as M1 grows past "walk and talk."
 */
export class InputManager {
  private readonly chord: KeyChordDetector;
  private readonly callbacks: InputCallbacks;

  constructor(callbacks: InputCallbacks) {
    this.callbacks = callbacks;
    this.chord = new KeyChordDetector(callbacks.onDirection, DIAGONAL_CHORD_WINDOW_MS);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (isArrowKey(event.key)) {
      event.preventDefault();
      this.chord.onKeyDown(event.key, event.repeat);
      return;
    }
    if (event.key === '.') {
      event.preventDefault();
      this.callbacks.onWait();
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    if (isArrowKey(event.key)) {
      this.chord.onKeyUp(event.key);
    }
  };
}

function isArrowKey(key: string): key is ArrowKey {
  return ARROW_KEYS.has(key);
}
