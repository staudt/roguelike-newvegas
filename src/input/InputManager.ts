import { DIAGONAL_CHORD_WINDOW_MS } from '../config/constants';
import type { Direction } from '../utils/geometry';
import { KeyChordDetector, type ArrowKey } from './KeyChordDetector';

const ARROW_KEYS = new Set<string>(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const MODIFIER_KEYS = new Set<string>(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph']);

export interface InputCallbacks {
  /** A movement direction (arrow cardinal or chord diagonal). Game decides what it means now. */
  onDirection: (direction: Direction) => void;
  /** Any other (non-modifier) key, as `KeyboardEvent.key`. */
  onKey: (key: string) => void;
}

/**
 * Wires raw DOM keyboard events to the game. Arrow keys always go through KeyChordDetector —
 * key-ups in particular are forwarded unconditionally, whatever mode the game is in, otherwise a
 * key released while a menu was open would stay "held" forever and break later chords. What a
 * direction or key *means* (move, menu cursor, prompt answer) is the Game's input-mode decision.
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

  /** Dev/test driver: a full key press through the exact path real keys take. */
  press(key: string): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key, cancelable: true }));
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (isArrowKey(event.key)) {
      event.preventDefault();
      this.chord.onKeyDown(event.key, event.repeat);
      return;
    }
    if (MODIFIER_KEYS.has(event.key)) return;
    // Leave browser shortcuts (reload, devtools, copy...) alone.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length === 1 || event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      if (!event.repeat) this.callbacks.onKey(event.key);
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
