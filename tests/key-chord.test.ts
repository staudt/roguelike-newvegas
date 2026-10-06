import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyChordDetector, type ArrowKey } from '../src/input/KeyChordDetector';
import type { Direction } from '../src/utils/geometry';

function setup(windowMs = 45) {
  const directions: Direction[] = [];
  const detector = new KeyChordDetector((d) => directions.push(d), windowMs);
  return { directions, detector };
}

describe('KeyChordDetector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits a diagonal when a second orthogonal key arrives within the window', () => {
    const { directions, detector } = setup();

    detector.onKeyDown('ArrowUp', false);
    vi.advanceTimersByTime(10);
    detector.onKeyDown('ArrowRight', false);

    expect(directions).toEqual(['NE']);
  });

  it('emits the cardinal alone once the window elapses with only one key held', () => {
    const { directions, detector } = setup();

    detector.onKeyDown('ArrowUp', false);
    vi.advanceTimersByTime(50);

    expect(directions).toEqual(['N']);
  });

  it('emits two separate cardinals when the second key arrives after the window elapsed', () => {
    const { directions, detector } = setup();

    detector.onKeyDown('ArrowUp', false);
    vi.advanceTimersByTime(50);
    detector.onKeyDown('ArrowRight', false);
    vi.advanceTimersByTime(50);

    expect(directions).toEqual(['N', 'E']);
  });

  it('cancels out and emits nothing when opposite keys are held together', () => {
    const { directions, detector } = setup();

    detector.onKeyDown('ArrowUp', false);
    vi.advanceTimersByTime(10);
    detector.onKeyDown('ArrowDown', false);
    vi.advanceTimersByTime(50);

    expect(directions).toEqual([]);
  });

  it('stays silent on release after an opposite-key cancel (no stray fire)', () => {
    const { directions, detector } = setup();

    detector.onKeyDown('ArrowUp', false);
    vi.advanceTimersByTime(10);
    detector.onKeyDown('ArrowDown', false); // cancels the pending 'N'
    detector.onKeyUp('ArrowUp');
    detector.onKeyUp('ArrowDown');

    expect(directions).toEqual([]);
  });

  it('fires immediately on key-up when released before the window with no chord partner', () => {
    const { directions, detector } = setup();

    detector.onKeyDown('ArrowLeft', false);
    vi.advanceTimersByTime(10);
    detector.onKeyUp('ArrowLeft');

    expect(directions).toEqual(['W']);

    // Must not fire again once the original window would have elapsed.
    vi.advanceTimersByTime(50);
    expect(directions).toEqual(['W']);
  });

  it('ignores OS key-repeat events entirely', () => {
    const { directions, detector } = setup();

    detector.onKeyDown('ArrowUp', false);
    detector.onKeyDown('ArrowUp', true);
    detector.onKeyDown('ArrowUp', true);
    vi.advanceTimersByTime(50);

    expect(directions).toEqual(['N']);
  });

  it('resolves all four diagonal combinations, in either key order', () => {
    const combos: Array<[ArrowKey, ArrowKey, Direction]> = [
      ['ArrowUp', 'ArrowRight', 'NE'],
      ['ArrowRight', 'ArrowUp', 'NE'],
      ['ArrowUp', 'ArrowLeft', 'NW'],
      ['ArrowLeft', 'ArrowUp', 'NW'],
      ['ArrowDown', 'ArrowRight', 'SE'],
      ['ArrowRight', 'ArrowDown', 'SE'],
      ['ArrowDown', 'ArrowLeft', 'SW'],
      ['ArrowLeft', 'ArrowDown', 'SW'],
    ];

    for (const [first, second, expected] of combos) {
      const { directions, detector } = setup();
      detector.onKeyDown(first, false);
      vi.advanceTimersByTime(5);
      detector.onKeyDown(second, false);
      expect(directions).toEqual([expected]);
    }
  });

  it('starts a fresh chord after a key is released and re-pressed', () => {
    const { directions, detector } = setup();

    detector.onKeyDown('ArrowUp', false);
    vi.advanceTimersByTime(50); // fires 'N'
    detector.onKeyUp('ArrowUp');

    detector.onKeyDown('ArrowUp', false);
    vi.advanceTimersByTime(10);
    detector.onKeyDown('ArrowRight', false);

    expect(directions).toEqual(['N', 'NE']);
  });

  it('respects a custom windowMs', () => {
    const { directions, detector } = setup(20);

    detector.onKeyDown('ArrowDown', false);
    vi.advanceTimersByTime(25); // past the shorter window with nothing else held

    expect(directions).toEqual(['S']);
  });
});
