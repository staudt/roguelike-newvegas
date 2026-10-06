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

## Planned (in order) — and how each fits the current code

### M3 — Items you carry, drop and loot; guns
- **Ground items + inventory verbs:** `GroundItem` in `Space`, rendered on the map; `,` pick up, `d`
  drop (both already greyed rows in the Enter menu); creatures drop their inventory when they die.
- **Creatures carry items:** NPCs/monsters get `inventory: Item[]`, a `wielded` id and a readied
  ammo stack, from a per-definition loadout (and optional loot table). Their melee profile comes from
  what they wield via the same `attackProfileFor` the player uses, falling back to natural attacks
  (teeth) or fists. Today `CreatureStats.attack` is the fallback.
- **Undroppable items:** `ItemDef.flags` (`undroppable`, `quest`; instances can override). `d` refuses with a
  message ("You can't let go of the Pip-Boy."), shops won't buy quest items. (Sticky/cursed-style
  curses are a possible later use of the same flag.)
- **Guns:** pistol + 9mm ammo; `f` fires only a wielded gun with readied ammunition (a quiver slot),
  8 directions, cover via `hasLineOfSight`; a shared `fireProjectile` used by the player *and* creatures.
- **Creatures that use guns:** when hostile and holding a gun with ammo, the AI wields it (costs a
  turn, like the player), lines itself up on a straight line to you (NetHack monsters do this too), and
  fires; at melee range it hits with what it holds or switches. So hit Ringo and, if he has a pistol,
  he draws it and shoots back.

### M4 — Alignment, factions, temperament
- Replace the single `hostile` boolean with: `faction` (Goodsprings, Powder Gangers, NCR, wildlife…),
  a faction relations table, per-faction reputation for the player, and a monster/NPC
  `temperament` (`aggressive` | `territorial` | `peaceful` | `cowardly`). `hostile` stays as the
  *current* state (provoked or hostile-by-faction) so combat/AI code keeps working; a function
  `isHostileToPlayer` derives the initial value. Naturally hostile characters (Powder Gangers, raiders)
  are simply members of a faction at odds with the player's.
- Attacking a peaceful sets `provoked` (what we do today), lowers standing with their faction, and
  alerts nearby faction members (rogueout has an alert-radius pattern to borrow). Witness reactions and
  fleeing (`cowardly`) come with it. `Factions.ts` from rogueout is the reference.

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

### Smaller open items
- **Scale follow-ups:** the editor loads every chunk file up front (lazy loading once there are hundreds);
  long-distance travel/run commands and fast travel between discovered places; creatures stored per chunk
  (spawn/despawn) instead of one list; hunters farther than ~20 cells in open ground exceed the path budget.
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
