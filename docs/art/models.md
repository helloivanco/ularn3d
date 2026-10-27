# Rigged characters and dungeon props

The hero, the undead, cave props and chests use models from three KayKit packs by
Kay Lousberg ([kaylousberg.com](https://www.kaylousberg.com)). All three are CC0: free for
commercial use, credit appreciated but not required. Terrain surfaces stay procedural
([terrain.md](terrain.md)).

## Sources

| Pack | Repository | Commit | Used for |
|------|-----------|--------|----------|
| Character Pack: Adventurers 1.0 | [KayKit-Character-Pack-Adventures-1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) | `672074b` | Hero bodies, shared clips |
| Character Pack: Skeletons 1.0 | [KayKit-Character-Pack-Skeletons-1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0) | `15b62b9` | Zombie, wraith, vampire |
| Dungeon Remastered 1.0 | [KayKit-Dungeon-Remastered-1.0](https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0) | `b0ca9bd` | Set dressing, torches, chests |

## Pipeline

`node scripts/build-models.mjs <kaykit-dir>` reads the untouched downloads and writes
`public/models/`. It has no dependencies: it rewrites the GLB JSON chunk and repacks the
binary chunk.

- Every body shares one rig, so the ten clips the game plays ship once in
  `rig-clips.glb` (≈430 KB). The bodies ship without animation (≈220–360 KB each, down from
  3.6–4.9 MB).
- Pack weapons, shields and other held props are removed. The game keeps its own wielded
  weapons and the hero's lantern, mounted on the rig's `handslot` bones.
- Only the props listed in `PROPS` in `src/set-dressing.js` are written.

## Rules

- **The procedural rigs still run.** `src/hero-skin.js` draws a skinned body over the
  procedural hero and creatures. Their poses, facing, weapon pivot and sword trail keep
  running hidden, so gameplay and the existing animation contracts do not depend on a
  download. If a model fails to load, the procedural body stays.
- **Set dressing is decoration only.** Props never sit on item tiles, under torches or in
  corridors, and are never picked or collided with. Nothing that could pass for loot ships
  (bottles, coins, small boxes, trunks). Placement depends only on the known walls, so a
  floor dresses the same way every visit.
- **Torches follow the wall cutaway.** A torch hides while its wall column is lowered.
- **Town dressing stays clear of play.** Lamp posts, shop props and lawn pieces never stand on
  a path or within a tile of a building, and nothing is taller than a lamp post. Lawn pieces
  are procedural; shop props use the pack.
- **Lighting stays tiered.** The wall-base shade and flame flicker are Cinematic only.
  Balanced and Auto caves stay flat.
