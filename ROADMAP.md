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

## Next — M3 (to decide)
- **Guns:** `f` fires only a wielded gun with readied ammunition (needs an ammo/quiver slot), 8
  directions, cover via `hasLineOfSight`. Add the 9mm pistol + ammo and pickups.
- **VATS** (later): the limb system is the groundwork; target a specific limb at an AP cost.
- **Balance:** a full-HP bare-handed player beats a lone gecko ~99.95% of the time. Consider lowering
  max HP (now 20 + 4*Endurance) or raising monster damage so single wild monsters are a real threat.
- **AI polish:** a hunter with no path to you holds still instead of closing up behind a blocker.
- **Editor:** saving a map triggers a Vite full reload (selection/undo lost); exclude
  `src/world/**/*.json` from the reload watch.

## Later
Inventory/items (`i`, stimpaks, ammo pickups) → quests learned from overheard monologues → save/load
→ larger map, more interiors, shops → perks/skills.

## Dev notes
- Node 22.4 here is below Vite 8's requirement, so `vite` is pinned to `^7`.
- `tsconfig` has `erasableSyntaxOnly`: no constructor parameter properties.
- Vitest occasionally flakes on first run when other node processes are busy; re-run.
- Stale duplicate repo `staudt/newvegasrl` (created by mistake) can be deleted.
- Known quirk: `legSpeedFactor`'s 0.25 floor is unreachable (worst real case is 0.35).
