import { PALETTE } from '../config/palette';
import type { Entity } from './Entity';

export interface Player extends Entity {
  kind: 'player';
  name: string;
}

export function createPlayer(x: number, y: number): Player {
  return {
    id: 'player',
    kind: 'player',
    glyph: '@',
    fg: PALETTE.playerFg,
    x,
    y,
    name: 'The Courier',
  };
}
