# Item artwork catalog

Generated with the built-in image generation tool on September 18, 2026.

Assets live in `public/art/items/*.png` (transparent PNGs, 256×256). Presentation-only
floor replacements for weapons, armor, rings, consumables, artifacts, and gems in the
3D game. Original engine item identities, attributes, behavior, spawn rules, and classic
`public/engine/img/o{id}.png` sprites remain unchanged. Each texture is loaded once and
shared. Camera-facing planes mirror left/right as the overhead camera orbits, matching
the monster art convention (single view, not eight-direction sheets).

Potions (`id` 42) select art by `arg` only after the potion is discovered.
Undiscovered potions share `/art/items/potion-unknown.png`. Scrolls (`id` 41)
still select art by `arg` from the full scroll table.

## Shared generation prompt pattern

Use case: stylized-concept. Asset type: one transparent 2D item sprite for a small
overhead fantasy dungeon game. Three-quarter view facing RIGHT (or slightly from above
for armor/rings/bottles), slightly seen from above. Dark pixel outline, restrained
pixel-art shading that reads clearly when displayed about 40 pixels wide. Single object
centered and fully visible on a truly transparent alpha background, no ground plane or
shadow, no scene, no text, no border, no hand or wearer. Occupy roughly 80% of the frame.
Deliver a square transparent PNG game asset; use crisp pixel-art shapes, not photographic.

## Coverage

| Category | Count | Notes |
|----------|------:|-------|
| Weapons | 12 | Including legendary blades and Bessman's hammer |
| Armor | 10 | Plate mail, plate armor, stainless plate, Elven Chain, shield |
| Rings / belt | 9 | Eight rings + belt of striking |
| Artifacts / special | 11 | Orbs, scarab, cube, lamp, hand, talisman, wand, staff, amulet |
| Gems / gold | 5 | Diamond, ruby, emerald, sapphire, gold pile |
| Book / cookie | 2 | |
| Potions | 24 | Full `POTION_NAMES` table |
| Scrolls | 24 | Full `SCROLL_NAMES` table |
| **Total** | **97** | |

## Potion args (id 42)

| Arg | Name | Asset |
|----:|------|-------|
| 0 | sleep | `potion-sleep.png` |
| 1 | healing | `potion-healing.png` |
| 2 | raise level | `potion-raise-level.png` |
| 3 | increase ability | `potion-increase-ability.png` |
| 4 | wisdom | `potion-wisdom.png` |
| 5 | strength | `potion-strength.png` |
| 6 | raise charisma | `potion-raise-charisma.png` |
| 7 | dizziness | `potion-dizziness.png` |
| 8 | learning | `potion-learning.png` |
| 9 | object detection | `potion-object-detection.png` |
| 10 | monster detection | `potion-monster-detection.png` |
| 11 | forgetfulness | `potion-forgetfulness.png` |
| 12 | water | `potion-water.png` |
| 13 | blindness | `potion-blindness.png` |
| 14 | confusion | `potion-confusion.png` |
| 15 | heroism | `potion-heroism.png` |
| 16 | sturdiness | `potion-sturdiness.png` |
| 17 | giant strength | `potion-giant-strength.png` |
| 18 | fire resistance | `potion-fire-resistance.png` |
| 19 | treasure finding | `potion-treasure-finding.png` |
| 20 | instant healing | `potion-instant-healing.png` |
| 21 | cure dianthroritis | `potion-cure-dianthroritis.png` |
| 22 | poison | `potion-poison.png` |
| 23 | see invisible | `potion-see-invisible.png` |

## Scroll args (id 41)

| Arg | Name | Asset |
|----:|------|-------|
| 0 | enchant armor | `scroll-enchant-armor.png` |
| 1 | enchant weapon | `scroll-enchant-weapon.png` |
| 2 | enlightenment | `scroll-enlightenment.png` |
| 3 | blank paper | `scroll-blank-paper.png` |
| 4 | create monster | `scroll-create-monster.png` |
| 5 | create artifact | `scroll-create-artifact.png` |
| 6 | aggravate monsters | `scroll-aggravate-monsters.png` |
| 7 | time warp | `scroll-time-warp.png` |
| 8 | teleportation | `scroll-teleportation.png` |
| 9 | expanded awareness | `scroll-expanded-awareness.png` |
| 10 | haste monsters | `scroll-haste-monsters.png` |
| 11 | monster healing | `scroll-monster-healing.png` |
| 12 | spirit protection | `scroll-spirit-protection.png` |
| 13 | undead protection | `scroll-undead-protection.png` |
| 14 | stealth | `scroll-stealth.png` |
| 15 | magic mapping | `scroll-magic-mapping.png` |
| 16 | hold monsters | `scroll-hold-monsters.png` |
| 17 | gem perfection | `scroll-gem-perfection.png` |
| 18 | spell extension | `scroll-spell-extension.png` |
| 19 | identify | `scroll-identify.png` |
| 20 | remove curse | `scroll-remove-curse.png` |
| 21 | annihilation | `scroll-annihilation.png` |
| 22 | pulverization | `scroll-pulverization.png` |
| 23 | life protection | `scroll-life-protection.png` |
