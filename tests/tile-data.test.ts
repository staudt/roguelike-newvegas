import { describe, expect, it } from 'vitest';
import {
  PAINTABLE_TILES,
  TILE_ORDER,
  tileDef,
  tileIndex,
  tileOpenable,
  tileOpensTo,
  tileWalkable,
} from '../src/world/Tile';

describe('tile data', () => {
  it('a closed door opens to an open door', () => {
    expect(tileOpensTo(tileIndex('door'))).toBe(tileIndex('openDoor'));
    expect(tileOpenable(tileIndex('door'))).toBe(true);
  });

  it('nothing else opens', () => {
    for (const id of ['openDoor', 'floor', 'wall', 'ground']) {
      expect(tileOpenable(tileIndex(id))).toBe(false);
      expect(tileOpensTo(tileIndex(id))).toBeNull();
    }
  });

  it('every opensTo names an existing walkable tile', () => {
    for (const id of TILE_ORDER) {
      const target = tileDef(id).opensTo;
      if (target === undefined) continue;
      expect(TILE_ORDER).toContain(target);
      expect(tileWalkable(tileIndex(target))).toBe(true);
    }
  });

  it('the editor palette lists paintable tiles with void last', () => {
    expect(PAINTABLE_TILES).toEqual(['ground', 'rock', 'wall', 'door', 'openDoor', 'floor', 'road', 'void']);
  });
});
