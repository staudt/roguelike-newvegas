# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## New Vegas Roguelike — working notes

A NetHack-style roguelike set in Fallout: New Vegas (Goodsprings), TypeScript + Vite, rendered to a
canvas. Live site: https://staudt.github.io/roguelike-newvegas/ (Pages, deployed from `main`).
`ROADMAP.md` is the plan and history; this file is how to work on it. Keep both current.

## Commands
- `npm run dev` — game at `/`, map editor at `/editor.html`. `npm test` — vitest (gates the deploy).
- One file: `npx vitest run tests/kick.test.ts`; one test by name: `npx vitest run -t "<test name>"`.
  `npm run test:watch` for watch mode. Vitest occasionally flakes on a first run when the machine is busy; re-run.
- `npm run build` — `tsc` + vite build. Always run `npx tsc --noEmit` and `npm test` before committing.
  CI (`.github/workflows/deploy.yml`, Node 22) runs `npm test` then `npm run build` on every push to `main`
  and deploys `dist` to Pages, so a red suite or type error blocks the live site.
- Dev builds expose `window.__game` (state, spawn, give, teleport, press key…): use it to check a change
  in the real game instead of guessing.

## Layout
- `src/engine` — game loop and rules: `Game` (input modes, menus, orchestration), `TurnManager`
  (commands, `advanceTurn`), `Combat` (melee/shots), `Kick`, `Items`, `GameState`.
- `src/combat` — pure rules: `CombatFormulas` (to-hit, speed, aim bands, crowding), `CombatResolver`,
  `Limbs`, `Narration`. `src/ai` — creature turns and pathfinding. `src/fov` — height-aware line of sight.
- `src/items`, `src/entities` — data-driven defs (`ItemData`, `CreatureData`) plus carrying/loadouts. `CreatureData` holds every creature
  kind, beasts and people; a named NPC is a kind (default `townsperson`, see `NpcData`) plus name and dialogue.
- `src/world` — tiles, heights, chunked world (`ChunkedMap`; `ChunkStreamer` keeps the chunks around the
  player loaded and preserves dirty/explored state on unload). Map data: `src/world/goodsprings/world.json`
  (places, creatures, items) plus one file per chunk in `goodsprings/chunks/` (`<cx>_<cy>.json`).
  `src/editor` — the map editor (`MapDocument`). `src/ui` — renderer, menus, status bar, log. `src/config` — constants, palette.
- Everything tunable lives in `src/config/constants.ts` or the data files. Prefer data and constants over
  special cases. A new table, or a new field that names ids in another table, gets a check in
  `tests/data-integrity.test.ts`; ids written in code use the `ItemId` / `CreatureId` types.

## Conventions
- Engine functions return whether a turn was spent and call `advanceTurn` themselves; a refused action is
  a message and no turn. The UI only maps keys to engine calls.
- One player input = one log line group (`Game.groupInput`). Log lines name the weapon and the limb (a torso/body hit, the default, goes unsaid); the torso is never hurt or crippled.
- Randomness always comes from the passed `RNG`, so tests can script it (`scriptedRNG` in `tests/helpers/fixtures.ts`; `tests/helpers/world.ts` builds test worlds).
- Terrain: ground and road carry a height 0–3 (`tileIsGround`, never compare to `GROUND_TILE` directly).
  Ground levels 0 and 1 share the `▒` texture and differ in colour (then `▓ █`), road reuses the ground's glyphs in greys, floor is a blank
  glyph (colour only, no dots). The ladder is `GROUND_LEVELS` in `config/palette.ts`; stored map heights follow it.
- `tsconfig` has `erasableSyntaxOnly` (no constructor parameter properties). `vite` is pinned to `^7`
  (Node 22.4).
- A Windows checkout has CRLF; there the byte-for-byte map round-trip tests (`map-document`, `editor-items`) fail
  locally for that reason only and pass on Linux CI. Don't "fix" them. Map JSON edited in the editor
  must not be committed together with code unless the map tests are updated with it.
- Editing: Edit tool preferred over shell one-liners (shell escaping mangled template literals before).

## Workflow: Opus plans, Sonnet executes
- Opus (the main session) designs, decides trade-offs, and reviews. Delegate with the Agent tool
  (`model: "sonnet"`) the predictable parts: mechanical refactors, adding data entries, writing tests from a
  spec, renames across files, running the suite and reporting, and read-only reviews/explorations.
- Give a delegate a self-contained brief: the goal, the files, the conventions above, the acceptance check
  (`tsc` + the named tests), and what it must not touch. Review its diff before accepting it.
- Keep design decisions, balance numbers and anything that touches several systems with Opus. Ask the user
  only for decisions that are really theirs (game design intent), not for conventional choices.

## Keeping state and avoiding silent breakage
- After every feature: update `ROADMAP.md` (done / planned / open items) and this file if a convention
  changed, then commit. Commit code separately from map-editor JSON.
- Before changing a system, check the **ripple list** below and review each listed area; after, update it.
- Add a test for each rule you add, next to the related tests.

### Ripple list (change X → re-check Y)
- **SPECIAL stats** (not yet implemented as real progression; fixed in `Player.STARTING_SPECIAL`):
  Strength feeds melee damage (`strengthDamageBonus`) and kick force/knockback (`Kick.knockbackDistance`);
  Agility feeds AC, to-hit and melee/kick accuracy; Perception feeds gun accuracy; Endurance feeds max HP.
  When SPECIAL becomes variable, review `CombatFormulas`, `Kick`, `Player`, the character sheet, and the
  tests that assume strength 5 / agility 7 (`kick.test`, `gun-accuracy.test`, `combat-*`).
- **Creature size / mass / speed**: gun to-hit (`targetEvasion`), kick knockback (`SIZE_MASS`, `mass`),
  stagger after a kick, AI action counts. Any new monster needs size, speed and (if unusual) mass reviewed.
- **Creature traits** (`opensDoors`, `social`, `wanderChance`, `wanderRadius` on `CreatureDef`, copied onto each creature
  by `creatureStatsFrom`): AI and sound branch on these, never on `kind === 'npc'` (that is only for talking/menus).
  `social` bundles alarms and relays, gunshot curiosity, joining fights, crying out, fight-or-flee stance and gun kiting.
  A new behaviour that only some creatures have gets a trait, with its default in `traitsOf`.
- **Objects on a base (rock, wall, future fences/safes)**: tiles with `overlay: true` draw only their glyph and take the
  background of what is under them. What they stand on is a tile in the map's base layer (`TileMap.getBase`, saved by name
  through the chunk palette as `bases`); the height stays the real terrain height (0 when the base is not ground-like).
  `MapDocument.paintTile` keeps the base when an object is painted over a cell (`baseAs` on a tile says what an object over
  it stands on: door → floor). New object tiles just set `overlay: true`; any plain tile can be a base with no code change.
  Re-check `visualFor`, `LineOfSight.groundHeightAt`, the editor overview colours.
- **Terrain heights / new ground-like tiles**: `canStep`, `LineOfSight`, `Kick` slopes, renderer glyphs,
  editor palette, `TILE_ORDER` (append only). Gunshots use the same line of sight.
- **Gun stats** (`effectiveRange`, bonuses): aim bands (`AIM_ZONES`), crowding penalty, creature gun AI
  (`actWithGun` lines up shots using `range`), tests in `gun-accuracy`/`shooting`.
- **Hostility** (`hostile` flag = runtime state; derived from `faction`/`temperament`/`state.standing` by
  `hostileToPlayer` in `entities/Factions.ts`, plus `nerve` for how provoked people fight): any blow, bullet or kick
  on a creature goes through `provoke` (`engine/Sound.ts`), never set `hostile` directly; noises go through
  `emitSound`. New creature kinds need a faction (or null) and temperament; named NPCs override theirs in `NpcData`. Crowding penalty counts adjacent hostiles,
  noise alerts hostiles, kick/attack provoke, the red hostile ring, menus asking before attacking peacefuls.
- **Wielded/alternate/readied**: `wieldItem`, `swapWeapons`, drop (`clearSlotsFor`), loadouts, inventory
  tags, command menu context, status bar. Wielding a gun auto-readies ammunition (`readyAmmoForWielded` in
  `engine/Ammo.ts`: the kind last readied with that gun, `player.lastAmmo`, else the first that fits; a melee
  weapon leaves `readied` alone), so any new way to take up a weapon should call it. `fireGun` and pick-up call it
  too, so a fitting stack replaces a wrong or empty readied one. Worn armor (`worn`, `W`/`T` in `engine/Apparel.ts`)
  is a slot like the others: `clearSlotsFor` clears it, loadouts take `wear`.
- **Item condition and armor** (`items/Condition.ts` rules, `engine/Wear.ts` when it happens, constants under
  "Item condition"): weapons wear per shot or landed blow, armor when the piece over the struck spot stops damage;
  broken things come off (`clearSlotsFor`) and are refused by wield/wear/swap and skipped by the AI. Damage Threshold
  (`damageThreshold`: worn armor + `naturalDT`) goes into every `resolveMelee`/`resolveShot` call, and a new attack
  path must pass it and call `wearWielded`/`wearArmorHit`. Jams only roll below `JAM_BELOW`, so fresh gear never
  touches the RNG; map gear gets its condition rolled by the loader's RNG (`CARRIED_CONDITION`/`GROUND_CONDITION`).
- **Travel / mouse / run** (`engine/Travel.ts` plans and judges; `Game.stepTravel` takes the steps on a timer; `g` and
  clicks both feed it): anything new that should stop a walk (a new kind of alarm, hazard, event) belongs in
  `travelInterruption`. Clicks route over explored cells only, closed doors are routable, and unexplored targets
  get the nearest known cell plus `TRAVEL_PROBE_STEPS` straight on. A click never auto-attacks from a distance.
- **Idle wandering** (`wander` in `AIScheduler`: `wanderChance` per action, within `wanderRadius` of `home`; animals roam):
  every idle creature rolls the RNG each action, so a test that spends a turn with a scripted RNG needs a roll per
  idle creature, or an RNG that never wanders (`() => 0.999`).
- **Energy/speed system**: kick stagger subtracts `energy`; crippled legs, `MAX_ACTIONS_PER_TURN`.
- **Status bar / log layout**: the renderer measures the middle band, so header height changes just work,
  but check the menu placement code if overlays move.

## Current state (update this section as work lands)
- Done: M1–M3 plus M3.5 (see `ROADMAP.md`), kick (`k`), alternate weapon (`x`), ghoul, road tile,
  height-aware line of sight with eye/target heights, two-line status bar under the log.
- Item condition, armor (body/head, DT) and their wear, New Vegas style; repair is not built yet.
- Known gaps: creatures knocked into each other do not fight each other (AI only targets the player);
  "attacks affect aim" is not modelled; SPECIAL is fixed.
- M4 steps 1–2 done: sound (`emitSound`), `provoke`, investigate/witness/flee AI, factions, temperament, nerve
  (see `ROADMAP.md`).
- Next planned: M4 steps 3–4 (reputation and leaders, creature infighting), M5 multi-level buildings,
  then VATS, quests, save/load.
