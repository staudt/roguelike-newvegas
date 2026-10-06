import { getTileId, type MapGrid } from '../world/GameMap';

/**
 * Connected wall glyphs for building frontage — a run of `wall` tiles reads as a building corner
 * rather than a row of identical stubs. Purely presentational: the tile id underneath is always
 * `wall`, box-drawing is just what gets drawn for it.
 */
const CONNECTED = 'wall';

/** Indexed by a bitmask of which orthogonal neighbours are also wall: N=1, S=2, W=4, E=8. */
const GLYPHS: readonly string[] = [
  '─', // 0: alone
  '│', // 1: N
  '│', // 2: S
  '│', // 3: N S
  '─', // 4: W
  '┘', // 5: N W
  '┐', // 6: S W
  '┤', // 7: N S W
  '─', // 8: E
  '└', // 9: N E
  '┌', // 10: S E
  '├', // 11: N S E
  '─', // 12: W E
  '┴', // 13: N W E
  '┬', // 14: S W E
  '┼', // 15: all four
];

export function isConnectedWall(tileId: string): boolean {
  return tileId === CONNECTED;
}

export function wallGlyph(map: MapGrid, x: number, y: number): string {
  let mask = 0;
  if (getTileId(map, x, y - 1) === CONNECTED) mask |= 1;
  if (getTileId(map, x, y + 1) === CONNECTED) mask |= 2;
  if (getTileId(map, x - 1, y) === CONNECTED) mask |= 4;
  if (getTileId(map, x + 1, y) === CONNECTED) mask |= 8;
  return GLYPHS[mask]!;
}
