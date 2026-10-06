# Roadmap

Live: https://staudt.github.io/roguelike-newvegas/ · Repo: staudt/roguelike-newvegas

## Done — M1: walk Goodsprings + talk
Height-ladder terrain, seamless interiors (Prospector Saloon), monologue balloons (cleared on
move, NPCs cycle through multiple lines), map editor, `window.__game` dev bridge, 68 tests, Pages deploy.

## Next — M2: combat core (decisions made, not yet started)
- **Stats:** SPECIAL, fixed starting spread for now (no allocation screen). Simple derived stats:
  max HP from Endurance, AC/to-hit from Agility, melee damage bonus from Strength.
- **Death:** permadeath — death screen, no reload.
- **Hostiles:** never talk; they attack on sight, and bumping one attacks it. First enemy: geckos.
- **Peaceful characters:**
  - One option (talk): bump talks, as now.
  - More than one option: bump opens a menu like rogueout's (Doc Mitchell: Talk / Heal).
  - `F` + direction into a peaceful NPC, or walking into a non-talking creature (e.g. a brahmin),
    asks for confirmation before attacking. An attacked NPC/creature turns hostile.
- **Firing:** `f` + one of 8 directions only (no angled aiming). Reuses `hasLineOfSight`, so
  terrain between you and the target is cover. Starting 9mm pistol with limited ammo.
- **Doc Mitchell's house:** enterable interior (same pattern as the saloon: grid extends one tile
  past the door for the exit transition); Doc moves inside.
- **Engine shape:** RNG injected into pure combat functions (`combat/`), monsters in `Space.monsters`,
  BFS pathfinding with `canStep` (`ai/`), UI prompts (direction/confirm/menu) owned by `Game`,
  engine reports them via events (`attack-prompted`, `npc-menu`).
- **Editor:** needs monster placement and must round-trip new NPC fields (`interactions`).

## Later
Inventory/items (`i`, stimpaks, ammo pickups) → quests learned from overheard monologues → save/load
→ larger map, more interiors, shops → perks/skills.

## Dev notes
- Node 22.4 here is below Vite 8's requirement, so `vite` is pinned to `^7`.
- `tsconfig` has `erasableSyntaxOnly`: no constructor parameter properties.
- Vitest occasionally flakes on first run when other node processes are busy; re-run.
- Stale duplicate repo `staudt/newvegasrl` (created by mistake) can be deleted.
