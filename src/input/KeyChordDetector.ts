import type { Direction } from '../utils/geometry';

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

const OPPOSITES: Record<ArrowKey, ArrowKey> = {
  ArrowUp: 'ArrowDown',
  ArrowDown: 'ArrowUp',
  ArrowLeft: 'ArrowRight',
  ArrowRight: 'ArrowLeft',
};

const SINGLE_TO_DIRECTION: Record<ArrowKey, Direction> = {
  ArrowUp: 'N',
  ArrowDown: 'S',
  ArrowLeft: 'W',
  ArrowRight: 'E',
};

const CHORD_TO_DIRECTION: Record<string, Direction> = {
  'ArrowUp+ArrowRight': 'NE',
  'ArrowRight+ArrowUp': 'NE',
  'ArrowUp+ArrowLeft': 'NW',
  'ArrowLeft+ArrowUp': 'NW',
  'ArrowDown+ArrowRight': 'SE',
  'ArrowRight+ArrowDown': 'SE',
  'ArrowDown+ArrowLeft': 'SW',
  'ArrowLeft+ArrowDown': 'SW',
};

interface PendingChord {
  firstKey: ArrowKey;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Turns raw arrow-key down/up events into single Direction emissions — one input, one turn.
 *
 * Diagonal movement has no dedicated key: holding two orthogonal arrow keys within a short window
 * (`windowMs`) counts as a diagonal chord. DOM-decoupled and driven purely by (key, repeat) pairs
 * plus a timer, so it's unit-testable with fake timers.
 */
export class KeyChordDetector {
  private readonly held = new Set<ArrowKey>();
  private pending: PendingChord | null = null;
  private readonly onDirection: (direction: Direction) => void;
  private readonly windowMs: number;

  constructor(onDirection: (direction: Direction) => void, windowMs: number = 45) {
    this.onDirection = onDirection;
    this.windowMs = windowMs;
  }

  onKeyDown(key: ArrowKey, repeat: boolean): void {
    // OS key-repeat must never spam turns — only the first physical press of a key counts.
    if (repeat || this.held.has(key)) return;

    if (this.held.has(OPPOSITES[key])) {
      this.held.add(key);
      this.cancelPending();
      return;
    }

    this.held.add(key);

    if (this.pending) {
      const direction = CHORD_TO_DIRECTION[`${this.pending.firstKey}+${key}`];
      this.cancelPending();
      this.onDirection(direction ?? SINGLE_TO_DIRECTION[key]);
      return;
    }

    this.pending = {
      firstKey: key,
      timer: setTimeout(() => {
        this.pending = null;
        this.onDirection(SINGLE_TO_DIRECTION[key]);
      }, this.windowMs),
    };
  }

  onKeyUp(key: ArrowKey): void {
    this.held.delete(key);

    if (this.pending?.firstKey === key) {
      this.cancelPending();
      this.onDirection(SINGLE_TO_DIRECTION[key]);
    }
  }

  private cancelPending(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
  }
}
