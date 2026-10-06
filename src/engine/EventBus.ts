import type { Creature } from '../entities/Creature';
import type { Npc } from '../entities/Npc';
import type { Direction, Point } from '../utils/geometry';

/**
 * Decouples systems from each other (e.g. UI reacting to state changes without TurnManager
 * knowing the UI exists). `GameEvents` maps event names to their payload type.
 */
export interface GameEvents {
  'turn-ended': { turnCount: number };
  'npc-interacted': { npc: Npc };
  'space-changed': { spaceId: string };
  /**
   * Bumped, F-attacked or kicked something peaceful: ask before starting a fight. `kick` is the
   * direction when it was a kick that needs confirming, so the answer can finish that kick.
   */
  'attack-prompted': { target: Creature; kick?: Direction };
  /** Bumped someone with more than one thing to offer: open the interaction menu. */
  'npc-menu': { npc: Npc };
  'player-died': Record<string, never>;
  /** A bullet flew: the cells it crossed (in order, ending at whatever it hit), for the tracer. */
  'shot-fired': { path: Point[]; shooterId: string; hitId?: string };
  [event: string]: unknown;
}

type Listener<T> = (payload: T) => void;

export class EventBus<Events extends Record<string, unknown>> {
  private listeners: { [K in keyof Events]?: Listener<Events[K]>[] } = {};

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const list = (this.listeners[event] ??= []);
    list.push(listener);
    return () => {
      this.listeners[event] = list.filter((l) => l !== listener);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const list = this.listeners[event];
    if (!list) return;
    for (const listener of list) listener(payload);
  }
}
