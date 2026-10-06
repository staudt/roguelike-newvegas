import type { Creature } from '../entities/Creature';
import type { Npc } from '../entities/Npc';

/**
 * Decouples systems from each other (e.g. UI reacting to state changes without TurnManager
 * knowing the UI exists). `GameEvents` maps event names to their payload type.
 */
export interface GameEvents {
  'turn-ended': { turnCount: number };
  'npc-interacted': { npc: Npc };
  'space-changed': { spaceId: string };
  /** Bumped (or F-attacked) something peaceful: ask before starting a fight. */
  'attack-prompted': { target: Creature };
  /** Bumped someone with more than one thing to offer: open the interaction menu. */
  'npc-menu': { npc: Npc };
  'player-died': Record<string, never>;
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
