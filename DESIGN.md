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

- **The queue** is the auto-builder's shopping list. Houses and shops only.
  It spends your coins on its own and auto-repeats its last entry, so the city
  keeps growing while you're not watching.
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
Price: `400 × 1.7^(parcels owned − 4)`.

Parcels rather than whole blocks so the city outline goes irregular as it
grows — an L-shaped or ragged city reads far better as a diorama than a
perfect square, and irregular edges make placement genuinely harder.

Unowned parcels render as flat, desaturated ground with a faint border.

### 4.2 Buildings

| Type | Cost | Placed by | Produces | Emits |
|---|---|---|---|---|
| House | `20 × 1.15^n` | queue | 4 population | — |
| Shop | `60 × 1.15^n` | queue | coins ∝ nearby population | — |
| Factory | `200 × 1.25^n` | you | 5 coins/s flat | −1.0 pollution |
| Park | `80 × 1.20^n` | you | nothing | +0.8 happiness |

- A house only holds population while its tile happiness ≥ `0.30`.
- A shop earns `0.4 coins/s` per population within radius 3 of it, capped at
  25 population. Shops in a housing desert earn nothing.
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

Hysteresis, so nothing flickers on the boundary:

- Tile happiness below `0.25` for 30 continuous seconds → building goes
  derelict: produces nothing, houses nobody, renders desaturated and slightly
  sunken.
- Tile happiness above `0.35` for 15 continuous seconds → it recovers.

Derelict buildings are never removed automatically. Clearing them is your call,
and free.

### 4.5 Growth

Every `3.0 / (0.5 + cityHappiness)` seconds, the builder tries to build the
front of the queue:

1. Can we afford it? If not, wait.
2. Find the free owned tile with the shortest euclidean distance to any
   existing building (ties broken by a seeded RNG, so a save replays the same).
3. Build it. Pay for it. If the queue is now empty, push a copy of what we just
   built.

Step 2 is the whole design. The builder does not look at happiness, does not
avoid factories, and will cheerfully wall in your park. That's the feature.

### 4.6 Offline

The entire sim freezes when the tab is hidden or closed. On return:

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

## 7. Milestones

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

## 8. Deliberately out of scope

Prestige, upgrade trees, research, more than four building types, roads,
terrain, multiple maps, mobile support, tutorial. None of these answer the M2
question, and each one is a place to hide from it.
