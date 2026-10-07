import { describe, expect, it } from 'vitest';
import { RUN_MAX_STEPS, TRAVEL_DANGER_RADIUS, TRAVEL_PROBE_STEPS } from '../src/config/constants';
import { addGroundItem } from '../src/engine/GroundItems';
import { getActiveSpace, type GameState } from '../src/engine/GameState';
import {
  planRun,
  planTravel,
  snapshotTravel,
  travelInterruption,
  type TravelPlan,
} from '../src/engine/Travel';
import { createMonster } from '../src/entities/Monster';
import { createNpc } from '../src/entities/Npc';
import { VisibleSet } from '../src/fov/VisibleSet';
import { createItem } from '../src/items/Item';
import type { Point } from '../src/utils/geometry';
import { buildArena, type ArenaOptions } from './helpers/fixtures';

/** An arena with every cell already explored (so travel may route anywhere), unless `explore` limits it. */
function arena(opts: ArenaOptions, explore: (x: number, y: number) => boolean = () => true) {
  const a = buildArena(opts);
  for (let y = 0; y < opts.height; y++) {
    for (let x = 0; x < opts.width; x++) if (explore(x, y)) a.grid.markExplored(x, y);
  }
  return a;
}

function plan(state: GameState, target: Point): TravelPlan {
  const r = planTravel(state, target);
  if (!('plan' in r)) throw new Error(`no plan: ${r.refusal}`);
  return r.plan;
}

function refusal(state: GameState, target: Point): string | null {
  const r = planTravel(state, target);
  if ('plan' in r) throw new Error('expected a refusal');
  return r.refusal;
}

describe('planTravel: a known destination', () => {
  it('walks straight there, diagonals included', () => {
    const a = arena({ width: 12, height: 12, player: { x: 1, y: 1 } });
    const p = plan(a.state, { x: 7, y: 4 });
    expect(p.path).toHaveLength(6);
    expect(p.path[p.path.length - 1]).toEqual({ x: 7, y: 4 });
    let at: Point = { x: 1, y: 1 };
    for (const step of p.path) {
      expect(Math.max(Math.abs(step.x - at.x), Math.abs(step.y - at.y))).toBe(1);
      at = step;
    }
  });

  it('routes round a wall', () => {
    const walls: Array<[number, number]> = [0, 1, 2, 3, 4].map((y) => [5, y]);
    const a = arena({ width: 12, height: 8, player: { x: 2, y: 2 }, walls });
    const p = plan(a.state, { x: 8, y: 2 });
    expect(p.path.some((c) => c.x === 5 && c.y >= 5)).toBe(true);
    expect(p.path.every((c) => !(c.x === 5 && c.y <= 4))).toBe(true);
  });

  it('goes through a closed door, which the walk will open on the way', () => {
    const walls: Array<[number, number]> = [0, 1, 3, 4].map((y) => [5, y]);
    const a = arena({ width: 10, height: 5, player: { x: 2, y: 2 }, walls, doors: [[5, 2]] });
    const p = plan(a.state, { x: 8, y: 2 });
    expect(p.path.some((c) => c.x === 5 && c.y === 2)).toBe(true);
  });

  it('walks round creatures standing in the way', () => {
    const gecko = createMonster('g', 'gecko', 4, 2);
    const a = arena({ width: 10, height: 5, player: { x: 2, y: 2 }, monsters: [gecko] });
    const p = plan(a.state, { x: 7, y: 2 });
    expect(p.path.some((c) => c.x === 4 && c.y === 2)).toBe(false);
  });

  it('says nothing about a click on a wall or on yourself', () => {
    const a = arena({ width: 8, height: 5, player: { x: 2, y: 2 }, walls: [[5, 2]] });
    expect(refusal(a.state, { x: 5, y: 2 })).toBeNull();
    expect(refusal(a.state, { x: 2, y: 2 })).toBeNull();
  });

  it('says so when a place is known but there is no way in', () => {
    const walls: Array<[number, number]> = [];
    for (let i = 5; i <= 7; i++) walls.push([i, 1], [i, 3]);
    walls.push([5, 2], [7, 2]);
    const a = arena({ width: 12, height: 5, player: { x: 1, y: 2 }, walls });
    expect(refusal(a.state, { x: 6, y: 2 })).toBe("You can't find a way there.");
  });
});

describe('planTravel: into the unknown', () => {
  const explored = (px: number, py: number, r: number) => (x: number, y: number) =>
    Math.max(Math.abs(x - px), Math.abs(y - py)) <= r;

  it('heads for the edge of what is known and a little way beyond, and no farther', () => {
    const a = arena({ width: 60, height: 9, player: { x: 3, y: 4 } }, explored(3, 4, 4));
    const p = plan(a.state, { x: 50, y: 4 });
    const last = p.path[p.path.length - 1]!;
    expect(last.x).toBeGreaterThan(7); // past the explored bubble (x<=7)
    expect(p.path.length).toBeLessThanOrEqual(4 + TRAVEL_PROBE_STEPS);
    expect(last.x).toBeLessThan(50);
  });

  it('a wall in the unknown just ends the probe', () => {
    const walls: Array<[number, number]> = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((y) => [10, y]);
    const a = arena({ width: 30, height: 9, player: { x: 3, y: 4 }, walls }, explored(3, 4, 4));
    const p = plan(a.state, { x: 25, y: 4 });
    expect(Math.max(...p.path.map((c) => c.x))).toBeLessThan(10);
  });

  it('has nothing to say, and nowhere to go, when the way is shut at once', () => {
    const a = arena(
      { width: 10, height: 5, player: { x: 1, y: 2 }, walls: [[2, 1], [2, 2], [2, 3], [1, 1], [1, 3], [0, 1], [0, 2], [0, 3]] },
      explored(1, 2, 0),
    );
    expect(refusal(a.state, { x: 9, y: 2 })).toBe("You can't go that way.");
  });
});

describe('planTravel: clicking someone', () => {
  it('a person to talk to: walk up beside them, then bump', () => {
    const doc = createNpc('doc', 'Doc', 8, 2, ['hi']);
    const a = arena({ width: 12, height: 5, player: { x: 1, y: 2 }, npcs: [doc] });
    const p = plan(a.state, { x: 8, y: 2 });
    expect(p.interact).toBe(doc);
    const end = p.path[p.path.length - 1]!;
    expect(Math.max(Math.abs(end.x - 8), Math.abs(end.y - 2))).toBe(1);
    expect(p.path.some((c) => c.x === 8 && c.y === 2)).toBe(false);
  });

  it('beside them already: nothing to walk, just the bump', () => {
    const doc = createNpc('doc', 'Doc', 3, 2, ['hi']);
    const a = arena({ width: 8, height: 5, player: { x: 2, y: 2 }, npcs: [doc] });
    const p = plan(a.state, { x: 3, y: 2 });
    expect(p.path).toEqual([]);
    expect(p.interact).toBe(doc);
  });

  it('a hostile or an animal is approached but never auto-attacked', () => {
    const gecko = createMonster('g', 'gecko', 8, 2);
    const brahmin = createMonster('b', 'brahmin', 8, 4);
    const a = arena({ width: 12, height: 6, player: { x: 1, y: 2 }, monsters: [gecko, brahmin] });
    expect(plan(a.state, { x: 8, y: 2 }).interact).toBeNull();
    expect(plan(a.state, { x: 8, y: 4 }).interact).toBeNull();
  });

  it('a hostile person is not walked up to and spoken to', () => {
    const raider = createNpc('r', 'Raider', 8, 2, ['grr']);
    raider.hostile = true;
    const a = arena({ width: 12, height: 5, player: { x: 1, y: 2 }, npcs: [raider] });
    expect(plan(a.state, { x: 8, y: 2 }).interact).toBeNull();
  });
});

describe('planRun (g)', () => {
  it('runs until the wall', () => {
    const a = arena({ width: 12, height: 5, player: { x: 2, y: 2 }, walls: [[8, 2]] });
    const path = planRun(a.state, 'E');
    expect(path[path.length - 1]).toEqual({ x: 7, y: 2 });
    expect(path).toHaveLength(5);
  });

  it('stops short of a creature, and does not run into a wall at all', () => {
    const gecko = createMonster('g', 'gecko', 6, 2);
    const a = arena({ width: 12, height: 5, player: { x: 2, y: 2 }, monsters: [gecko], walls: [[1, 2]] });
    expect(planRun(a.state, 'E')).toHaveLength(3);
    expect(planRun(a.state, 'W')).toEqual([]);
  });

  it('covers no more than the run limit', () => {
    const a = arena({ width: 200, height: 3, player: { x: 1, y: 1 } });
    expect(planRun(a.state, 'E')).toHaveLength(RUN_MAX_STEPS);
  });

  it('runs up to a closed door and stops there, opening it being the last step', () => {
    const a = arena({ width: 12, height: 5, player: { x: 2, y: 2 }, doors: [[6, 2]] });
    const path = planRun(a.state, 'E');
    expect(path[path.length - 1]).toEqual({ x: 6, y: 2 });
  });
});

describe('travelInterruption', () => {
  function seeing(a: ReturnType<typeof arena>, cells: Array<[number, number]>): void {
    const space = getActiveSpace(a.state);
    const v = new VisibleSet(0, 0, 40, 10);
    for (const [x, y] of cells) v.add(x, y);
    space.visible = v;
  }

  it('does not stop a quiet walk', () => {
    const a = arena({ width: 30, height: 5, player: { x: 1, y: 2 } });
    const before = snapshotTravel(a.state);
    a.state.player.x = 2;
    expect(travelInterruption(a.state, before)).toBeNull();
  });

  it('stops when a hostile comes into view and names it', () => {
    const gecko = createMonster('g', 'gecko', 20, 2);
    const bloatfly = createMonster('f', 'bloatfly', 21, 2);
    const a = arena({ width: 30, height: 5, player: { x: 1, y: 2 }, monsters: [gecko, bloatfly] });
    const before = snapshotTravel(a.state);
    seeing(a, [[20, 2], [21, 2]]);
    expect(travelInterruption(a.state, before)?.message).toBe('You see the gecko and the bloatfly. You stop.');
  });

  it('does not stop for peaceful ones: a brahmin, a townsperson', () => {
    const brahmin = createMonster('b', 'brahmin', 20, 2);
    const doc = createNpc('doc', 'Doc', 21, 2, ['hi']);
    const a = arena({ width: 30, height: 5, player: { x: 1, y: 2 }, monsters: [brahmin], npcs: [doc] });
    const before = snapshotTravel(a.state);
    seeing(a, [[20, 2], [21, 2]]);
    expect(travelInterruption(a.state, before)).toBeNull();
  });

  it('names only the hostile when a peaceful comes into view with it', () => {
    const gecko = createMonster('g', 'gecko', 20, 2);
    const brahmin = createMonster('b', 'brahmin', 21, 2);
    const a = arena({ width: 30, height: 5, player: { x: 1, y: 2 }, monsters: [gecko, brahmin] });
    const before = snapshotTravel(a.state);
    seeing(a, [[20, 2], [21, 2]]);
    expect(travelInterruption(a.state, before)?.message).toBe('You see the gecko. You stop.');
  });

  it('does not stop again for someone already in view and still far', () => {
    const gecko = createMonster('g', 'gecko', 20, 2);
    const a = arena({ width: 30, height: 5, player: { x: 1, y: 2 }, monsters: [gecko] });
    seeing(a, [[20, 2]]);
    const before = snapshotTravel(a.state);
    a.state.player.x = 2;
    expect(travelInterruption(a.state, before)).toBeNull();
  });

  it('stops when a hostile in view gets close, once', () => {
    const gecko = createMonster('g', 'gecko', 10, 2);
    const a = arena({ width: 30, height: 5, player: { x: 1, y: 2 }, monsters: [gecko] });
    seeing(a, [[10, 2]]);
    const before = snapshotTravel(a.state);
    gecko.x = 1 + TRAVEL_DANGER_RADIUS;
    seeing(a, [[gecko.x, 2]]);
    expect(travelInterruption(a.state, before)?.message).toBe('The gecko is closing in. You stop.');
    expect(travelInterruption(a.state, snapshotTravel(a.state))).toBeNull();
  });

  it('stops when you are hurt, hear a cry, step on something, or enter a place', () => {
    const base = () => arena({ width: 30, height: 5, player: { x: 1, y: 2 } });

    let a = base();
    let before = snapshotTravel(a.state);
    a.state.player.hp -= 1;
    expect(travelInterruption(a.state, before)).not.toBeNull();

    a = base();
    before = snapshotTravel(a.state);
    a.state.noisesHeard++;
    expect(travelInterruption(a.state, before)).not.toBeNull();

    a = base();
    before = snapshotTravel(a.state);
    addGroundItem(getActiveSpace(a.state), 1, 2, createItem('stimpak'));
    expect(travelInterruption(a.state, before)).not.toBeNull();

    a = base();
    getActiveSpace(a.state).places.push({ name: 'Shed', rect: { x: 5, y: 0, width: 3, height: 5 } });
    before = snapshotTravel(a.state);
    a.state.player.x = 6;
    expect(travelInterruption(a.state, before)).not.toBeNull();
  });
});
