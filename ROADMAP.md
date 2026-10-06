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

## In progress — M2.5: editor "New building" + auto-loaded spaces
Drag a rectangle on the world map, pick a door side, and get the outdoor shell + door + a matching
interior file with the exit vestibule and transitions. The game auto-loads every map file in
`src/world/goodsprings/` (no more hardcoded imports), so a new building is just a new file. Interior
files carry optional `building` / `floor` metadata as groundwork for multi-floor buildings.

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
- Each floor is its own `Space` (its own file; `building` + `floor` metadata already in place) at
  the *same world coordinates*, so the camera and "seamless" rendering work unchanged.
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
