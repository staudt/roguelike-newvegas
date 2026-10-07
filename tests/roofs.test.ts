import { describe, expect, it } from 'vitest';
import { PALETTE } from '../src/config/palette';
import type { Place, Space } from '../src/engine/GameState';
import { isRoofed, roofedPlaces } from '../src/ui/Roofs';

const HOUSE: Place = { name: 'House', rect: { x: 10, y: 10, width: 5, height: 4 } };
const SHED: Place = { name: 'Shed', rect: { x: 30, y: 10, width: 3, height: 3 } };

function space(indoor = false): Space {
  return { indoor, places: [HOUSE, SHED] } as unknown as Space;
}

describe('roofs', () => {
  it('uses the wall brown', () => {
    expect(PALETTE.roof).toBe(PALETTE.wallFg);
  });

  it('every building you are not in is roofed; the one you stand in is not', () => {
    expect(roofedPlaces(space(), { x: 0, y: 0 })).toEqual([HOUSE, SHED]);
    expect(roofedPlaces(space(), { x: 12, y: 11 })).toEqual([SHED]);
  });

  it('indoor spaces have no roofs', () => {
    expect(roofedPlaces(space(true), { x: 0, y: 0 })).toEqual([]);
  });

  it('unseen interior is roofed, and so is the remembered interior', () => {
    const roofs = [HOUSE];
    expect(isRoofed(roofs, 12, 11, 'floor', false, false)).toBe(true);
    expect(isRoofed(roofs, 12, 11, 'floor', true, false)).toBe(true);
  });

  it('what you can see right now is shown as it is, through a door or window', () => {
    expect(isRoofed([HOUSE], 12, 11, 'floor', true, true)).toBe(false);
  });

  it('walls and doors you have seen keep drawing as walls; unseen ones are filled in', () => {
    expect(isRoofed([HOUSE], 10, 10, 'wall', true, false)).toBe(false);
    expect(isRoofed([HOUSE], 12, 10, 'door', true, false)).toBe(false);
    expect(isRoofed([HOUSE], 10, 10, 'wall', false, false)).toBe(true);
  });

  it('nothing outside a building is roofed', () => {
    expect(isRoofed([HOUSE], 5, 5, 'ground', false, false)).toBe(false);
    expect(isRoofed([HOUSE], 15, 10, 'ground', true, false)).toBe(false); // just past the rect
  });
});
