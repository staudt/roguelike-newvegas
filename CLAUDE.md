# New Vegas Roguelike — working notes for Claude Code

A NetHack-style roguelike set in Fallout: New Vegas (Goodsprings), TypeScript + Vite, rendered to a
canvas. Live site: https://staudt.github.io/roguelike-newvegas/ (Pages, deployed from `main`).
`ROADMAP.md` is the plan and history; this file is how to work on it. Keep both current.

## Commands
- `npm run dev` — game at `/`, map editor at `/editor.html`. `npm test` — vitest (gates the deploy).
- `npm run build` — `tsc` + vite build. Always run `npx tsc --noEmit` and `npm test` before committing.
- Dev builds expose `window.__game` (state, spawn, give, teleport, press key…): use it to check a change
  in the real game instead of guessing.

## Layout
- `src/engine` — game loop and rules: `Game` (input modes, menus, orchestration), `TurnManager`
  (commands, `advanceTurn`), `Combat` (melee/shots), `Kick`, `Items`, `GameState`.
- `src/combat` — pure rules: `CombatFormulas` (to-hit, speed, aim bands, crowding), `CombatResolver`,
  `Limbs`, `Narration`. `src/ai` — creature turns and pathfinding. `src/fov` — height-aware line of sight.
- `src/items`, `src/entities` — data-driven defs (`ItemData`, `MonsterData`) plus carrying/loadouts.
- `src/world` — tiles, heights, chunked world (`ChunkedMap`), map JSON in `src/world/goodsprings/`.
  `src/editor` — the map editor. `src/ui` — renderer, menus, status bar, log. `src/config` — constants, palette.
- Everything tunable lives in `src/config/constants.ts` or the data files. Prefer data and constants over
  special cases.

## Conventions
- Engine functions return whether a turn was spent and call `advanceTurn` themselves; a refused action is
  a message and no turn. The UI only maps keys to engine calls.
- One player input = one log line group (`Game.groupInput`). Log lines name the weapon and the limb.
- Randomness always comes from the passed `RNG`, so tests can script it (`scriptedRNG` in `tests/helpers`).
- Terrain: ground and road carry a height 0–4 (`tileIsGround`, never compare to `GROUND_TILE` directly).
  Ground level 0 is a blank glyph, road reuses the ground's glyphs in greys, floor is `.`.
- `tsconfig` has `erasableSyntaxOnly` (no constructor parameter properties). `vite` is pinned to `^7`
  (Node 22.4).
- Windows checkout has CRLF; the byte-for-byte map round-trip tests (`map-document`, `editor-items`) fail
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
- **Terrain heights / new ground-like tiles**: `canStep`, `LineOfSight`, `Kick` slopes, renderer glyphs,
  editor palette, `TILE_ORDER` (append only). Gunshots use the same line of sight.
- **Gun stats** (`effectiveRange`, bonuses): aim bands (`AIM_ZONES`), crowding penalty, creature gun AI
  (`actWithGun` lines up shots using `range`), tests in `gun-accuracy`/`shooting`.
- **Hostility** (`hostile` flag; factions planned in M4): any blow, bullet or kick on a creature goes
  through `provoke` (`engine/Sound.ts`), never set `hostile` directly; noises go through `emitSound`.
  Crowding penalty counts adjacent hostiles,
  noise alerts hostiles, kick/attack provoke, the red hostile ring, menus asking before attacking peacefuls.
- **Wielded/alternate/readied**: `wieldItem`, `swapWeapons`, drop (`clearSlotsFor`), loadouts, inventory
  tags, command menu context, status bar.
- **Energy/speed system**: kick stagger subtracts `energy`; crippled legs, `MAX_ACTIONS_PER_TURN`.
- **Status bar / log layout**: the renderer measures the middle band, so header height changes just work,
  but check the menu placement code if overlays move.

## Current state (update this section as work lands)
- Done: M1–M3 plus M3.5 (see `ROADMAP.md`), kick (`k`), alternate weapon (`x`), ghoul, road tile,
  height-aware line of sight with eye/target heights, two-line status bar under the log.
- Known gaps: creatures knocked into each other do not fight each other (AI only targets the player);
  "attacks affect aim" is not modelled; the kick asks no confirmation on peacefuls; no ghoul placed in the
  world map yet; SPECIAL is fixed.
- M4 step 1 done: sound (`emitSound`), `provoke`, investigate and witness AI (see `ROADMAP.md`).
- Next planned: M4 steps 2–4 (factions and temperament data, reputation, creature infighting), M5 multi-level buildings,
  then VATS, quests, save/load.
