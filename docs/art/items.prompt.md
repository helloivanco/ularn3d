# Artifact item artwork

Generated with the built-in image generation tool on September 18, 2026.

Assets live in `public/art/items/*.png` (transparent PNGs). Presentation-only
replacements for fifteen notable floor items in the 3D game. Original engine
item identities, attributes, behavior, spawn rules, and classic
`public/engine/img/o{id}.png` sprites remain unchanged. Each texture is loaded
once and shared. Camera-facing planes mirror left/right as the overhead camera
orbits, matching the monster art convention (single view, not eight-direction sheets).

| Item | ID | Asset |
|------|----|-------|
| Orb of Enlightenment | 3 | `orb-of-enlightenment.png` |
| Sword of Slashing | 26 | `sword-of-slashing.png` |
| Bessman's Flailing Hammer | 27 | `bessmans-flailing-hammer.png` |
| Amulet of Invisibility | 45 | `amulet-of-invisibility.png` |
| Orb of Dragon Slaying | 46 | `orb-of-dragon-slaying.png` |
| Scarab of Negate Spirit | 47 | `scarab-of-negate-spirit.png` |
| Cube of Undead Control | 48 | `cube-of-undead-control.png` |
| Device of Theft Prevention | 49 | `device-of-theft-prevention.png` |
| Brass Lamp | 85 | `brass-lamp.png` |
| Hand of Fear | 86 | `hand-of-fear.png` |
| Talisman of the Sphere | 87 | `talisman-of-the-sphere.png` |
| Wand of Wonder | 88 | `wand-of-wonder.png` |
| Staff of Power | 89 | `staff-of-power.png` |
| Slayer | 91 | `slayer.png` |
| Elven Chain | 92 | `elven-chain.png` |

## Shared generation prompt pattern

Use case: stylized-concept. Asset type: one transparent 2D item sprite for a
small overhead fantasy dungeon game. Three-quarter view facing RIGHT, slightly
seen from above. Dark pixel outline, restrained pixel-art shading that reads
clearly when displayed about 40 pixels wide. Single object centered and fully
visible on a truly transparent alpha background, no ground plane or shadow, no
scene, no text, no border, no hand or wearer. Occupy roughly 80% of the frame
with transparent breathing room. Deliver a square transparent PNG game asset;
use crisp pixel-art shapes, not a photographic image.

## Per-item subject lines

- **Sword of Slashing** — ornate longsword, blue-steel blade with cornflower-blue glow edge, silver crossguard, leather-wrapped grip, round pommel; blade angled diagonally.
- **Bessman's Flailing Hammer** — flailing war hammer with three spiked metal balls on short chains attached to a dark-goldenrod wooden haft with brass bands.
- **Orb of Enlightenment** — crystal orb of plum and violet glass with an inner soft white light and tiny floating runes; small ornate silver pedestal cup.
- **Orb of Dragon Slaying** — sky-blue crystal orb with a tiny stylized dragon silhouette coiled inside glowing ember-red; brass claw pedestal.
- **Scarab of Negate Spirit** — Egyptian-style scarab beetle amulet in dark orange and amber enamel with turquoise wing markings and a gold rim; tiny spirit-ward glyph on the shell.
- **Amulet of Invisibility** — circular gold medallion with a translucent pale gem that looks faintly see-through; thin gold chain looped above.
- **Cube of Undead Control** — solid plum-colored cube with glowing violet runes on each visible face and a faint skull motif etched into the top; isometric three faces.
- **Device of Theft Prevention** — small mechanical lock-ward gadget with a blue crystal core, brass gears, and a protective ward ring; cornflower-blue metal.
- **Brass Lamp** — classic brass oil lamp with a curved spout, rounded body, small handle, and a soft warm flame tip.
- **Hand of Fear** — crimson and pale flesh severed-hand relic with dark nails, fingers slightly curled in a warding gesture, faint red aura; stylized fantasy relic, not gory.
- **Talisman of the Sphere** — sky-blue circular disc pendant with a floating miniature glowing sphere held in concentric metal rings like an orrery; thin chain loop.
- **Wand of Wonder** — slender twisted wooden wand tipped with a swirling prismatic green gem that sparks tiny multicolored motes; medium sea green and wood.
- **Staff of Power** — tall dark-orange wooden staff topped with a glowing amber crystal orb in bronze claws; carved spiral runes on the shaft.
- **Slayer** — crimson-edged black steel longsword with a blood-red fuller, dark iron fang crossguard, black grip, crimson gem pommel.
- **Elven Chain** — light cornflower-blue and silver fine-link chain mail shirt with leaf-shaped shoulder accents and a subtle green leaf clasp; no mannequin.
