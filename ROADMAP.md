# Roadmap

Live: https://staudt.github.io/roguelike-newvegas/ · Repo: staudt/roguelike-newvegas

## Done — M1: walk Goodsprings + talk
Height-ladder terrain, seamless interiors (Prospector Saloon), monologue balloons (cleared on
move, NPCs cycle through multiple lines), map editor, `window.__game` dev bridge, 68 tests, Pages deploy.

## Done — M2: melee combat core
SPECIAL stats (fixed spread), NetHack-style melee (bump a hostile or `F` + direction, confirm before
hitting peacefuls), `w` wield / `i` inventory / `C` character sheet, NetHack energy-based speed
(fast creatures act several times per turn; crippled legs slow you), per-limb HP with hurt/crippled
effects, weapon-driven hit location, log lines that always name the weapon, permadeath, geckos /
bloatflies / radroaches / a peaceful brahmin, Doc Mitchell's enterable house with a Talk/Heal menu,
editor support for monsters and NPC interactions. 245 tests.

## Done — M2.5: single-map buildings
Design change: buildings are ordinary walls + floor + a door inside the one world map (no separate
interior spaces, no vestibule trick). Closed doors block movement and sight; bumping one opens it
(NetHack rule), so line of sight alone gives the "step inside and the outside disappears" feel and a
lit room shows through an open door. Named `places` (rectangles in the map JSON) drive the status-bar
Location and "You enter/leave X." messages. Editor: Building tool (drag a rectangle, pick a door side),
Box tool, live shape previews, game-matching cell proportions. The game auto-loads every file in
`src/world/goodsprings/`, which is how future extra floors will appear. Separate `Space` files + the
`transitions` machinery remain only for floors reached by stairs.

## Done — M2.6: scalable, growable world
The world is a sparse set of 64x64 chunks in WORLD coordinates (negative allowed), behind a `TileMap` interface (`ChunkedMap` for the world, `FlatMap` for small spaces) — nothing outside
`src/world` knows how cells are stored. One byte per tile, run-length-encoded chunk files (all of Goodsprings is 1.8 KB, was
~90 KB). Missing chunks are void: the hard stop where the map ends (the old rock border is gone).
The game streams chunks (ring around the player loaded, far clean ones dropped, dirty ones kept,
explored memory preserved); visibility uses a small window instead of a whole-map array; only creatures
within SIM_RADIUS (40) act, with an occupancy index. Editor: viewport rendering, pan/zoom/minimap, chunk
outlines, Expand (+N/S/E/W, add/remove chunk), void swatch, delta-based undo, saves only dirty chunks.
Measured before the refactor: map JSON hit 22 MB at 1024^2 and 88 MB at 2048^2; 20,000 creatures cost
~230 ms/turn. Streaming was verified in the real game across several chunk seams.

## Done — M3: items, loot, guns
Ground items (`,` pick up with an "All of it" menu, `d` drop), stimpaks (`q`), a 9mm pistol (`w` wield,
`Q` ready ammo, `f` + direction fires along 8 lines; hills and walls block; a miss flies on to the next
creature; shots alert nearby hostiles). Undroppable items (the Pip-Boy). Creatures carry items from map
loadouts, drop them (plus rolled loot) when they die, and use them: a provoked Ringo draws his pistol,
lines up and shoots back; creatures fight with what they wield and the log names it. Status bar shows
ammo and what you wield; objects (rock, wall) take the base under them (`overlay` tiles; the base is its own map layer, stored by tile name), red/amber shot tracers (the map shows creatures as they were before the turn until the tracers land, so kills, monster moves and a fatal shot's death screen wait for the animation; the log still updates at once). Editor: ground-item mode and NPC/monster loadouts.
483 tests.

## Planned (in order) — and how each fits the current code

### M3.5 — Gun refinements (done)
A gun declares one `effectiveRange` (+ close/effective to-hit bonuses and falloff); the aim bands are shared by every
gun as fractions of it (`AIM_ZONES` in constants): torso-leaning out to 1/3, the sweet spot for head/limb hits to 2/3,
torso-leaning again to the full range, then a floor. Hostiles adjacent to the shooter cost 10 to-hit each (cap 30) on
shots at range 2+, for the player ("You are too hemmed in to aim.") and for creatures shooting the player. Also added:
`k` kick (torso only, knocks back by Strength vs mass; uphill costs extra, downhill tumbles), `x` alternate weapon,
the ghoul, a two-line status bar and a more forgiving height-aware line of sight. VATS would build on the bands later.

### M4 — Sound, alignment, factions, temperament
Design decisions (agreed with the user):
- **Goodsprings is not a faction.** Townsfolk are individuals: peaceful, avoid conflict, fight back if hurt,
  call for help, and neighbours who hear come to look and join once they *see* a provoked neighbour
  fighting. Such conflicts stay local. Per-NPC temperament decides fight vs flee (Doc Mitchell fights and
  flees while calling for help; Sunny Smiles is a warrior who goes for you, still calling for help).
- **Factions are for real factions** (NCR, Legion, Powder Gangers, wildlife…): a relations table, some pairs
  in instant conflict (NCR vs Legion), hostile monsters hostile to any human. Reputation is per faction:
  killing a *leader* (`important` flag in data) hurts it a lot; killing rank and file only draws nearby
  members. At the threshold the whole faction is hostile on sight, for the rest of the run, until a
  recovery route exists (quests, later). No per-location reputation.
- **Everything happens near the player.** Only the simulated window acts (`SIM_RADIUS`), so NPC-vs-NPC
  fights and sound never run far away.
- Sound: screams, shouts (calls for help or to arms) and gunshots draw creatures in range; gunshots
  especially draw hunters (non-territorial), not territorial creatures.

Order: (1) sound + investigate + provoke/witness — **done**; (2) factions, relations, temperament — **done**;
(3) reputation, leaders, hostile on sight; (4) creatures fighting each other (targets other than the player).

Step 2 as built (`entities/Factions.ts`, `entities/NpcData.ts`): `faction` (wildlife, ghouls, powder-gangers, ncr,
legion, or null for a civilian), `temperament` (aggressive / territorial / peaceful: how it treats strangers) and
`nerve` (bold / steady / timid: how it holds up once provoked) are on every creature. `factionRelation(a, b)` is the
relations table (NCR vs Legion and vs Powder Gangers, Powder Gangers vs civilians, beasts vs everyone else).
`hostileToPlayer(faction, temperament, standing)` derives hostility: peaceful never, others when the faction's
standing (`state.standing`, starting values in `FACTIONS`) is at or below `HOSTILE_STANDING`, factionless
non-peaceful always. `hostile` stays the runtime state, refreshed from standing at the start of each creature
action. Nerve sets `UNARMED_FLEE_CHANCE` / `GUN_KITE_CHANCE` (Sunny bold, Doc timid, in `NPC_PROFILES`; a map NPC may
add `faction`/`temperament`/`nerve`). Gunshots: aggressive creatures (geckos, ghouls) come from afar, territorial ones
(radroach) only if the shot is within their awareness. Fleeing uses an escape map (`fleeStep`) so runners go round walls.
Sound ranges (cells, walls don't muffle): gunshot 22, scream 18, shout 24. A hunter hearing a shot from beyond 2.5x its
awareness can't hunt by itself yet, so it walks to where the shot was (`investigate`) and notices the player on arrival.
Step 3 will move `state.standing` (reputation) when leaders are killed.

Step 1 as built: `engine/Sound.ts` (`emitSound`, `provoke`), `provoked` / `investigate` on creatures,
`SCREAM_NOISE_RADIUS` / `SHOUT_NOISE_RADIUS`, AI `joinsTrouble` and `investigateNoise`. Every blow, bullet
and kick on a creature goes through `provoke`. Scream vs gunshot: a scream alerts every peaceful person in range at once (`alarm: 'pending'`); on their
next action each shouts it on once from their own spot, pointing at the original trouble, so it ripples through
a settlement. A gunshot alerts hostiles, but peaceful people only go and look on a
`GUNSHOT_CURIOSITY_CHANCE` roll and relay nothing (no scream, no danger). People (not animals) open closed
doors when pathing, so a scream reaches indoors. A provoked person's `stance` is decided on their first action:
armed (gun or wielded melee weapon) fights; unarmed flees (`UNARMED_FLEE_CHANCE`), screaming again now and then
while you are in sight (`FLEE_SCREAM_CHANCE`), lashing out only when cornered; a gun-carrier backs off when you
are within `GUN_KEEP_DISTANCE` (`GUN_KITE_CHANCE` of their actions) and shoots otherwise. Step 2's temperament
should override these defaults per person (Sunny brawls even unarmed). Known gaps:
a witness of an outright killing learns nothing unless they see a provoked neighbour, no fleeing yet
(needs temperament), gunshots only alert hostiles.

Original sketch (to reconcile with the above):
- Replace the single `hostile` boolean with: `faction` (Goodsprings, Powder Gangers, NCR, wildlife…),
  a faction relations table, per-faction reputation for the player, and a monster/NPC
  `temperament` (`aggressive` | `territorial` | `peaceful` | `cowardly`). `hostile` stays as the
  *current* state (provoked or hostile-by-faction) so combat/AI code keeps working; a function
  `isHostileToPlayer` derives the initial value. Naturally hostile characters (Powder Gangers, raiders)
  are simply members of a faction at odds with the player's.
- Attacking a peaceful sets `provoked` (what we do today), lowers standing with their faction, and
  alerts nearby faction members (rogueout has an alert-radius pattern to borrow). Witness reactions and
  fleeing (`cowardly`) come with it. `Factions.ts` from rogueout is the reference.

### Mouse, travel and run (done)
Click a cell to walk there (BFS over explored cells, closed doors opened in passing; an unexplored target gets the
nearest known cell plus a short straight probe, `TRAVEL_PROBE_STEPS`). Click a person to walk up and talk or open
their menu; click an adjacent creature to attack (or answer "which direction?"); click away from a menu to close it;
menu rows highlight on hover and take clicks. `g` + direction runs (up to `RUN_MAX_STEPS`). A walk stops on: a hostile
new in view (peacefuls never stop it), a hostile closing within `TRAVEL_DANGER_RADIUS`, damage, a heard scream, stepping on an item, entering or
leaving a place, or any key or click. Reference: `../rogueout` AutoTravel.

Also done: right-click opens the command menu (and backs out of any open menu or prompt); wielding or swapping to a
gun readies its ammunition automatically (the kind last used with that gun, else the first that fits).

### M5 — Multi-level buildings
- The ground floor lives in the world map (see M2.5). Each *extra* floor (upstairs, basement) is its own
  `Space` file at the *same world coordinates* (`worldOrigin` = the building footprint), so the camera
  and "seamless" rendering work unchanged. Interior files get `building` + `floor` metadata.
- Stairs are transitions with a `kind` (`up`/`down`) triggered deliberately with `<` / `>` (like
  NetHack and rogueout) rather than by stepping on them; they land on the matching stair tile of the
  other floor. Basements are floors with negative numbers.
- Only the active floor is simulated and drawn; creatures stay in their own space (NetHack-style
  levels don't tick while you're away; a catch-up pass on arrival can fake time passing).
- Editor: "Add floor" on a building (new file, stair tiles placed on both floors), and the Building
  tool grows a floor count.

### Later
VATS (limb targeting at an AP cost; the limb system is the groundwork) → quests learned from overheard
monologues → save/load (spaces serialize independently, which multi-level needs anyway) → larger map,
shops/trade → perks and skills → SPECIAL allocation screen.

### Scaling refactor (from the October 2026 review)
Ahead of many more creatures, factions, tiles and items. In order:
1. Done: objects keep their base as a tile in a `bases` map layer (saved by name), not a code in the height byte.
2. Done: creature behaviour comes from traits on the kind (`opensDoors`, `social`, wander), not NPC vs monster;
   `MonsterData` became `CreatureData`, named NPCs are a kind (`townsperson` by default) plus identity. A Powder
   Ganger or NCR trooper is now just a table entry (stats, faction, `social`, a loadout in the map).
3. Spatial index: measured and deferred into 7. `creatureAt` is ~5 µs at 200 creatures in a space and ~34 µs at
   2,000; it only matters for a world-wide list of ~10k, which per-chunk storage removes. Done now: the renderer
   finds the top item per cell in one pass (it was quadratic in ground items).
4. Done: A* in `nextStepToward`. On the real map it finds 230/230 reachable hunts (BFS on the same 600-node budget
   found 57, none past 40 steps) in a third of the time. Hunters and gunshot investigators now arrive from far off.
   A shared distance map per tick is only worth it once many hunters chase at once; measure first.
5. Tile behaviour from data: `opensTo` for doors/gates, editor palette and overview colours from `TILES`.
6. Done: faction relations live in `FactionDef` (`beast`, `enemies` listed on one side), and `factionRelation`
   is a lookup in a table built once at load, ready for per-pair infighting checks.
7. Per-chunk creatures/items (also in Scale follow-ups); instance ids unique across spaces before save/load.
8. A data-integrity test (loot/loadout ids, ammo types, factions, NPC profiles, map def ids).
9. Split `Game.ts` and `editor/main.ts` when next touched.

### Smaller open items
- **Scale follow-ups:** the editor loads every chunk file up front (lazy loading once there are hundreds);
  long-distance travel/run commands and fast travel between discovered places; creatures stored per chunk
  (spawn/despawn) instead of one list.
- **Doors:** hostile humanoids (and gun-wielding NPCs) should open closed doors on their way to you;
  animals can't. Add `c` close and locked doors/keys. Lit vs dark rooms (a tile `indoor` flag) later.
- **Balance:** a full-HP bare-handed player beats a lone gecko ~99.95% of the time. Consider lowering
  max HP (now 20 + 4*Endurance) or raising monster damage.
- **AI polish:** a hunter with no path to you holds still instead of closing up behind a blocker.
- **Editor:** saving a map triggers a Vite full reload (selection/undo lost); exclude
  `src/world/**/*.json` from the reload watch.

## Dev notes
- Node 22.4 here is below Vite 8's requirement, so `vite` is pinned to `^7`.
- `tsconfig` has `erasableSyntaxOnly`: no constructor parameter properties.
- Vitest occasionally flakes on first run when other node processes are busy; re-run.
- Stale duplicate repo `staudt/newvegasrl` (created by mistake) can be deleted.
- Known quirk: `legSpeedFactor`'s 0.25 floor is unreachable (worst real case is 0.35).
