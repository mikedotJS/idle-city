# Micro City — design spec

A micro city-building idle game in three.js. The city grows on its own; you
decide where the land is and where the pollution goes.

Status: pre-prototype. Every number below is a starting point to be tuned by
playing, not a balanced economy.

---

## 1. The pitch

You own a small plot. Houses and shops appear on their own, filling whatever
gap is nearest, with no regard for whether that gap is a good place to live.
You place factories, which pay well and poison everything around them, and
parks, which fix that and earn nothing.

Left alone, the city grows itself into trouble: a row of houses creeps into a
factory's smog, happiness drops, income falls, buildings go derelict. You come
back, look at the board, and fix it — demolish, re-buffer, buy land to grow in
a better direction.

**The thing being prototyped:** is watching your city grow into a mess, and
then fixing it, fun? Everything not serving that question stays out.

---

## 2. Core loop

```
city auto-builds  →  grows into pollution  →  happiness drops
      ↑                                             ↓
 you fix the layout  ←  income falls, buildings go derelict
```

The engine of your income is also the thing that ruins your layout. A happy
city builds faster, and building faster is how it eats its own buffer zones.

---

## 3. Decisions locked in

| Question | Decision |
|---|---|
| Placement | City auto-builds filler; you place the field emitters |
| Scope | Prototype first, then decide |
| Constraint | Pollution vs happiness |
| Offline | Sim frozen; coins accrue at last known rate |
| Decay | Buildings go derelict below a happiness floor |
| Rhythm | Second-monitor tab, open for hours |
| Look | Cozy pastel diorama |
| Auto-builder | Dumb — fills the nearest gap, ignores pollution |
| Control | A build queue you fill |
| Pollution | Distance falloff, contributions stack |
| Long arc | Buy adjacent land parcels |
| Empty queue | Auto-repeats the last thing queued |
| Overlay | Always-on ground tint |
| Demolish | Free and instant |
| Stack | Vite + TypeScript + three.js |

### One ambiguity, resolved

"You queue specific buildings" and "you hand-place the field emitters" pull in
opposite directions. Resolution:

- **The queue** is the auto-builder's standing policy. Houses and shops only.
  It spends your coins on its own and *rotates*: what it just built goes to the
  back of the list, so `[house, house, shop]` means two houses per shop forever
  with no further input. Clearing the queue stops construction entirely, which
  is also how you save up for land or a factory — you and your own city are
  spending from the same purse, and the city acts every few seconds.
- **Direct placement** is for factories and parks. Click a tile, pay, it's
  built. These are the only two buildings that emit into the happiness field,
  so they are the only two whose position is an interesting decision — and
  they stay in your hands.

The boring placements never reach you; the interesting ones always do. If you'd
rather queue factories and parks too, say so and I'll fold them in as pending
placements instead.

---

## 4. Systems

### 4.1 Land

The world is a **12×12 tile grid** split into **3×3-tile parcels** (16 parcels).
You start owning the centre four (a 6×6 plot, 36 tiles).

Buying a parcel requires it to be orthogonally adjacent to land you own.
Price: `400 × 1.7^(parcels owned − 4)`, scaled by how much of that particular
parcel you could actually build on — `0.35 + 0.65 × (buildable tiles / 9)`.

The escalation is what stops the city swallowing the board; the second factor
is what stops terrain being a pure tax. Before it, a parcel that was half lake
cost exactly what a meadow cost, so discovering water was simply being charged
full price for four usable tiles and told nothing about it. A parcel with
nothing buildable in it still costs 35%, because it is the bridge to whatever
lies past it and free land nobody wants is not a decision. The hover panel now
says how many of the nine tiles are usable before the money is spent — a price
that moves for reasons the player cannot see reads as a bug, not as terrain.

Parcels rather than whole blocks so the city outline goes irregular as it
grows — an L-shaped or ragged city reads far better as a diorama than a
perfect square, and irregular edges make placement genuinely harder.

Unowned parcels render as flat, desaturated ground with a faint border.

### 4.2 Buildings

| Type | Cost | Placed by | Produces | Emits (strength / range) | Can rot |
|---|---|---|---|---|---|
| House | `20 × 1.15^n` | queue | 4 population | — | yes |
| Shop | `60 × 1.15^n` | queue | coins ∝ nearby population | — | yes |
| Factory | `200 × 1.25^n` | you | 5 coins/s flat | −1.0 / 3.5 | no |
| Landfill | `90 × 1.30^n` | you | 1.6 coins/s flat | −2.6 / 1.8 | no |
| Park | `80 × 1.20^n` | you | nothing | +0.8 / 2.5 | no |
| School | `260 × 1.22^n` | you | nothing | +0.45 / 4.5 | no |
| Harbour | `300 × 1.25^n` | you, on a shore tile | nothing | +0.7 / 3.0 | no |
| Station | `320 × 1.30^n` | you | nothing | +0.5 / 3.0 | no |

Each amenity answers a different shape of problem rather than being a bigger
park. A park fixes one bad corner hard; a school lifts a whole district a
little; a harbour is worth more than either but you have to buy land to reach a
shore, so it is a reward for expanding rather than a purchase. That reach was
measured before shipping it, because a building nobody can legally place is not
a decision: across 400 seeds every one puts a buildable shore tile inside the
first ring of parcels around the starting plot, so a harbour is one or two land
purchases away and never further.

The landfill exists to give the factory an opponent, and its numbers had to be
measured to earn that. At the −1.4 it was first given it was strictly gentler
than a factory at every distance: cheaper, weaker, and never the right answer
for a reason. At −2.6 over 1.8 tiles it makes 9 tiles unlivable to the
factory's 21, and no single park can rescue any of the 9, where one park does
rescue the tile beside a factory. Cheap ruin you can wall off, against
expensive ruin that seeps. It is also worse value per coin (0.018/coin against
0.025) and escalates faster, so it is the polluter you can afford in the first
five minutes and not the one you want in the twentieth.

A new city starts with 300 coins, enough for a first factory outright, and a
`[house, house, shop]` policy. Houses alone earn nothing whatsoever, so a
starting queue that never reaches a shop strands the city at zero income with
no way back.

- A house only holds population while its tile happiness ≥ `0.30`.
- A shop earns `0.06 coins/s` per population within radius 3 of it, capped at
  25 population. Shops in a housing desert earn nothing. This number started at
  0.4 and was cut by a factor of six after measurement: at 0.4 a full plot earns
  120 coins/s against houses costing ~300, so money stopped constraining
  anything and the city filled its plot in two minutes.
- Factories pay regardless of happiness. That's the temptation.

### 4.3 The happiness field

Per tile, from every emitter within its range:

```
contribution = strength × max(0, 1 − distance / range)     // euclidean
happiness(tile) = clamp(0.5 + Σ contributions, 0, 1)
```

| Emitter | strength | range |
|---|---|---|
| Factory | −1.0 | 3.5 |
| Park | +0.8 | 2.5 |

Linear falloff, not inverse-square: it's easier to reason about at a glance and
easier to tune. Contributions stack, so two parks half-cover a factory and
three factories in a corner make that corner uninhabitable — which is fine, if
you meant to do it.

**City happiness** = mean tile happiness over *occupied* tiles.
**Income multiplier** = `0.5 + cityHappiness`, so 0.5× to 1.5×.

The field only changes when a factory or park is added or removed. Recompute it
then, cache it, never per frame.

### 4.4 Dereliction

**Only what the city builds for itself can rot.** Houses and shops go derelict;
hand-placed factories and parks never do. This is not a softening — it is
load-bearing. A factory sits on `0.5 − 1.0`, clamped to 0, which is below its
own floor, so a derelictable factory shuts *itself* down 30 seconds after being
placed and the "pays well regardless of happiness" temptation that the whole
design rests on silently disappears. The rule also reads cleanly as a rule:
what you placed by hand stays where you put it.

Hysteresis, so nothing flickers on the boundary:

- Tile happiness below `0.25` for 30 continuous seconds → building goes
  derelict: produces nothing, houses nobody, renders desaturated and slightly
  sunken.
- Tile happiness above `0.35` for 15 continuous seconds → it recovers.

Derelict buildings are never removed automatically. Clearing them is your call,
and free.

### 4.5 Growth

Every `8.0 / (0.5 + cityHappiness)` seconds, the builder tries to build the
front of the queue:

1. Can we afford it? If not, wait.
2. Find the free owned tile with the shortest euclidean distance to any
   existing building (ties broken by a seeded RNG, so a save replays the same).
3. Build it. Pay for it. Move it to the back of the queue, so the list cycles.

Step 2 is the whole design. The builder does not look at happiness, does not
avoid factories, and will cheerfully wall in your park. That's the feature.

### 4.6 Offline

The entire sim freezes when the tab is hidden or closed — and those are the
same absence, so they take the same path. Freezing only on save/reload would
credit nothing for switching tabs for an hour and full rate for closing the tab
for an hour. On return:

```
coins += lastKnownIncomeRate × elapsedSeconds
```

No growth, no decay, no catch-up simulation. One multiplication.

This is a deliberate trade. Dereliction has a timer, so income is *not* a pure
function of the grid, and a real offline simulation would mean replaying ticks
— the thing that kills idle-game codebases. Freezing buys exact offline math
for one sentence of rules, and it means you can never be punished for logging
off. Elapsed time is capped at 8 hours so a week away doesn't hand you the game.

---

## 5. Look

Cozy pastel diorama. A small toy city on a table under soft light.

- **No assets.** Every building is generated in code: a box, a roof prism, a
  palette color, small per-instance jitter in height and hue. No glTF, no
  texture files, no Blender, no asset pipeline.
- **Ground tint is the UI.** Each tile plate is colored by its happiness —
  warm sage where it's good, desaturated grey-brown where it isn't. You read
  the whole city's health without clicking anything, which is what a
  second-monitor game needs.
- **Camera:** perspective, ~35° FOV, orbit rig, pitch clamped 25–65°, damped.
  Close to isometric without being flat.
- **Lighting:** one directional light with a soft shadow map, plus a hemisphere
  light for fill. Fog to fade the plot edges.
- **Placement animation:** scale from 0 with an ease-out-back over 400 ms.
  Cheap, and it's most of what makes auto-growth satisfying to watch.
- **Day/night:** not in the prototype. It's the best perceived-quality win per
  line of code and it gives an idle game a pulse, so it's first on the list
  once the loop is proven.

---

## 6. Code shape

```
src/
  main.ts              boot, rAF loop, wiring
  sim/                 ← never imports three.js
    state.ts           City, Tile, save shape
    buildings.ts       the registry table
    field.ts           happiness field
    builder.ts         auto-placement
    economy.ts         income rate from state
    tick.ts            step(state, dt)
    save.ts            localStorage, versioned
  render/
    scene.ts, ground.ts, buildings.ts, camera.ts, lighting.ts
  ui/
    hud.ts, queue.ts   plain DOM over the canvas
```

**The one discipline that matters:** `sim/` never imports three.js. The
simulation is pure TypeScript over plain data, so it can be stepped a thousand
times in a test to check an economy change without a renderer existing. The
renderer reads sim state and diffs it against what it drew last frame.

- Sim ticks at a fixed 10 Hz with an accumulator; render on rAF.
- One `InstancedMesh` per building type, capacity 144, rebuilt only when the
  grid changes.
- Ground is one `InstancedMesh` of tile plates with per-instance color.
- 144 tiles is nothing. Do not optimize this.
- Save is JSON in localStorage with a `version` field from commit one, so
  rebalancing later doesn't mean throwing away everyone's city.

---

## 7. Measured pacing

`npm run pacing` plays the city headlessly and prints the growth curve. Hours of
play take seconds, because `sim/` has no renderer to wait for. Every balance
number above was set against it rather than by argument.

Current curve, playing a buffered factory and buying land whenever affordable:

| min | income/s | built | owned tiles | happiness | derelict |
|---|---|---|---|---|---|
| 5 | 18.7 | 33 | 36 | 51% | 3 |
| 30 | 24.2 | 57 | 81 | 45% | 9 |
| 60 | 26.2 | 66 | 90 | 44% | 11 |
| 180 | 67.5 | 73 | 99 | 43% | 15 |

**Income now grows 5.7× over three hours, up from 2.5×.** The jump between the
60 and 90 minute marks is the plot filling and the auto-builder switching from
spreading to upgrading. Building levels were added precisely because this curve
was flat, and the same script that diagnosed it confirmed the fix. Fewer
buildings than before (73 against 80) because terrain took tiles out of the
board, and more than double the income anyway.

One thing still to watch when a person finally plays it:

- **Happiness settles around 43% and stops falling.** The city degrades to
  mediocre and then holds there rather than spiralling. That is probably the
  right shape — a death spiral in a game you leave running would be miserable —
  but it means the pressure to intervene is gentle, and gentle pressure in an
  idle game is easy to ignore entirely.

## 8. Milestones

**M1 — does the field read?**
Grid, camera, lighting. Click to place factories and parks. Happiness field and
ground tint. No economy, no growth, infinite money.
*Test: can you see a pollution problem across the board without thinking about it?*

**M2 — does the loop work?**
Economy, auto-builder, queue, HUD, land purchase, save. The full loop.
*Test: play 30 minutes on a second monitor. Do you want to intervene, or are you
just watching a number go up?*

**M3 — does it feel good?**
Dereliction, day/night cycle, placement and demolition animations, sound.

M3 only happens if M2 passes. If M2 fails, the fix is almost certainly in how
fast the city grows relative to how long a fix takes — tune that before adding
anything.

### Failure signals to watch for in M2

- You never demolish anything → the auto-builder isn't making bad enough
  decisions, or pollution isn't punishing enough.
- You demolish constantly → growth is too fast, or the plot is too tight.
- You stop looking at the 3D and just watch the coin counter → the ground tint
  isn't carrying the information, and the whole premise is in trouble.

---

## 9. Built since the prototype

Everything below was added after the milestones above, at the point where the
list in this section still read "deliberately out of scope". It is kept honest
rather than quietly deleted: several of these were ruled out on purpose, and
what changed was the request, not the reasoning.

### Streets, traffic and transit

Roads were excluded as a *mechanic* and still are: road access would be a
second constraint competing with pollution, and the whole design rests on there
being one. They exist as decoration instead — derived from the layout like the
happiness field, never stored, costing nothing. They run along the seams
BETWEEN tiles rather than on them, because a road that occupied a tile would
eat buildable space and quietly rebalance an economy tuned against 36 starting
tiles.

A seam becomes a street once a building stands beside it, so neighbours share
streets instead of each getting a ring: 80 buildings produce 189 segments, not
320. Cars, pedestrians and buses walk that network, with lane offsets picked per
segment against a clearance table measured off the actual building geometry —
without it, pedestrians disappeared into park lawns for a second at a time.

Railways follow the same posture, derived from where stations stand. Unlike
roads, track may cross water: a line halting at every shore would need a station
on every island, and a bridge looks better anyway. Stations are the only part
that touches the simulation, and they do it the way every hand-placed building
does — by emitting into the happiness field. Still one constraint.

### Terrain, biomes and levels

Water and mountain are generated from a stable seed rather than stored: one
number reproduces 144 tiles exactly. The starting plot is always plain, derived
from `STARTING_PARCELS` rather than a hardcoded radius, so a new city can never
open onto a lake with nowhere to build. Coverage was measured, not eyeballed —
a linear falloff from the board edge swung between 23% and 50% by seed; cubing
it holds 31% with a 24-33% range over 300 seeds. Seed 0 is the flat world, which
makes "terrain is optional" a property of the code and keeps economy tests from
also being tests about where the lake landed.

Buildings run to level 3, and the auto-builder upgrades only once there is
nowhere left to spread. That ordering is the point: density is the answer to a
full plot, which is exactly where the income curve used to flatten. Level scales
a factory's emission strength but not its range, so upgrading one makes the same
neighbourhood worse rather than poisoning a wider one.

Tiles beside water or below the peaks carry a biome, and buildings take their
theme from it. Purely cosmetic — a coastal house and an inland house earn the
same.

### Music, accounts and the board

Four generated tracks crossfade on an equal-power curve. Crossfading rather than
looping is the point: a generated track has an ending, not a loop point, so
looping one would put an audible seam in the room every three minutes.

Players sign in and publish their city to a global leaderboard, ranked by
happiness x population x income. That metric rewards scale, so two players of
equal skill are separated by how long they left the tab open — a test pins the
behaviour so it cannot drift unnoticed. Scores are computed by the browser: the
backend cannot yet recompute them, so a score can be inflated even though no
player can overwrite another's row.

### Telling the player what happened, and letting them undo it

The loop is a city that grows itself into trouble, but trouble has to be
*found*, and after ten minutes on a second monitor a 12x12 board of sixty
buildings does not volunteer which four just rotted. A panel says it in one
sentence and points at the tile the dereliction clusters around — a count says
the city rotted, a place says where to go.

It says "in the last 4m", never "while you were away". The sim freezes whenever
the tab is hidden, so this window is always time the player was present and not
watching. That is also why it is measured from the last time they *acted* on
the city rather than the last time they were present: an absence changes only
the coin counter.

Alongside it: speed (1x/2x/4x, scaling the whole city rather than only the
build timer), undo for demolition, and export/import of the city as text.
Demolition is the only action in the game that is instant, free and
irreversible, so it is the only one a misclick can really cost you; the undo
stack lives in a module rather than in `CityState`, because it belongs to
whoever is at the keyboard, not to the city. The export exists because the save
lives in `localStorage`, so one routine "clear site data" ends a week of play
and a static site has nowhere else to put a backup.

## 10. Still deliberately out of scope

Prestige, research trees, mobile support, tutorial.
