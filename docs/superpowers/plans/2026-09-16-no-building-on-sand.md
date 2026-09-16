# No Building On Sand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The sand strip along the shore becomes unbuildable ground, and the coast look moves one tile inland onto the first row of buildable land facing the sand.

**Architecture:** `src/sim/terrain.ts` already derives a `beach` array (land tile touching water) and a `biome` array where those same tiles are `Biome.Coast`. Two derived facts get pulled apart: `beach` stays the sand strip and becomes non-buildable, while `Biome.Coast` shifts to the ring of plain land that *touches* the sand. Everything downstream (auto-builder, roads, parcel pricing, building looks, ghost preview) already reads `isBuildable` / `map.biome`, so it follows for free.

**Tech Stack:** TypeScript, Vite, vitest, three.js. No new dependency fits — this is grid adjacency and game rules.

**Spec:** user request (FR): "On devrait pas pouvoir construire sur la plage, le sable, et c'est donc à partir de cases adjacentes au sable que les bâtiments devraient être en biome sable/plage."

## Global Constraints

- Terrain stays a pure function of the seed; no new field is persisted in saves.
- The sim never imports the renderer.
- The starting plot and its one-tile margin must stay buildable on every seed (see finding below — seed 20 puts sand in that margin, so the existing margin test must assert on `terrain`, not on `isBuildable`).
- Every seed must keep at least one placeable harbour tile (verified: over seeds 1..199, every seed has a non-empty inland coast ring).

## Key findings from the codebase

- `Terrain` = Plain | Water | Mountain. There is **no** Sand terrain value; the sand strip is the separate `beach: Uint8Array` (1 where a plain tile touches water, 8-neighbourhood).
- Beach tiles are currently **buildable** and already carry `Biome.Coast`. So after blocking them, nothing would wear the coast look unless the biome ring moves inland — that is exactly what the user asked for.
- `isCoast()` = `beach[tile] === 1` and is the harbour's `coastOnly` rule. Blocking sand without changing this makes the harbour unplaceable — these two must move together.
- Adjacency pass already exists in `generateTerrain` (the 3x3 loop that sets beach/biome); reuse it rather than inventing a helper.
- Blocking sand raises the unbuildable share from ~25% median to ~32% median (max ~44%) of the board. The existing "unbuildable share" test counts `Terrain` kinds only, so it still passes, but parcel pricing (`buildableTilesInParcel`) legitimately gets cheaper on the coast.
- Over seeds 1..399, only seed 20 has sand inside the safe-zone+1 margin, and no seed has sand inside the safe zone itself.

---

## Micro tasks

### Task 1: The coast biome moves one tile inland

**Size:** small — 1 file + 1 test, ~30 lines. **Library:** no library fits.

**Files:** Modify `src/sim/terrain.ts` (second pass of `generateTerrain`). Test `src/sim/__tests__/terrain.test.ts`.

Split the second pass in two: pass A marks `beach` (plain tile touching water) exactly as today; pass B assigns `Biome.Coast` to a plain, non-beach tile that touches a beach tile, keeping the existing "water beats mountain" tie rule. Beach tiles themselves keep `Biome.Coast`.

**Test:** every tile with `biome === Coast` is either a beach tile or touches one; every seed 1..199 has at least one buildable Coast tile.

**Visual check:** load a coastal city, place houses/parks on the row of grass just behind the sand — they wear the bleached coast look (white walls, flat roofs, palms in parks) instead of the plain look.

---

### Task 2: The shoreline rule points at the land facing the sand

**Size:** small — 2 files, ~20 lines. **Library:** no library fits.

**Files:** Modify `src/sim/terrain.ts` (`isCoast`), `src/sim/actions.ts` (message copy if needed). Test `src/sim/__tests__/emitters.test.ts`.

`isCoast(map, tile)` becomes "a plain tile, not itself sand, whose biome is Coast" — the harbour row. The harbour's `coastOnly` check is unchanged in shape, only its answer moves.

**Test:** update "marks the shore the renderer draws" to assert `isCoast` tiles are plain, not beach, and adjacent to a beach tile; the harbour test picks the new ring.

**Visual check:** select the Harbour, hover the sand — refused ("needs a shoreline"); hover the grass tile just behind it — the ghost turns valid and it places.

---

### Task 3: You cannot build on the sand

**Size:** small — 2 files, ~15 lines. **Library:** no library fits.

**Files:** Modify `src/sim/terrain.ts` (`isBuildable`), `src/sim/actions.ts` (`placementProblem` refusal message). Tests `src/sim/__tests__/terrain.test.ts`.

`isBuildable` returns false for `terrain !== Plain` **or** `beach === 1`. `placementProblem` gains a third branch: "You cannot build on the sand". The auto-builder (`pickBuildTile`) and roads (`isPaveable`) already gate on `isBuildable`, so they follow with no edit.

**Also in this task:** the "leaves a margin of plain around the starting plot" test must assert `terrain[i] === Terrain.Plain` instead of `isBuildable` (seed 20 legitimately puts sand in that margin, and sand in the margin is not a walled-in city).

**Visual check:** try to place a house on a sand tile — refused with the sand message and a red ghost; let the city grow into a coastal parcel — the auto-builder fills up to the sand and stops, and streets stop at the sand line.

---

### Task 4: The sand reads as ground you cannot use

**Size:** small — 1 file, ~25 lines. **Library:** no library fits.

**Files:** Modify `src/render/ground.ts` (beach colouring + the file's header rule, which currently states "a beach tile is ordinary buildable ground"). Optionally `src/render/terrain.ts` header comment.

A sand plate leaves the happiness ramp the way water and rock do: full sand colour, no happiness tint, owned or not (keep the ownership drop so a coastal parcel still reads as buyable). The `BEACH_MIX` / `BEACH_LIFT` constants collapse into one sand colour pair.

**Visual check:** the shore is a continuous sand band whose colour no longer shifts with the happiness of the city around it; day and night both still legible.

---

### Task 5: Coastal land is priced and described for what it gives

**Size:** small — 1 file + 1 test, ~15 lines. **Library:** no library fits.

**Files:** Modify `src/main.ts` (`describe`, the "The rest is water or rock." line). Test `src/sim/__tests__/land.test.ts`.

Pricing already follows `buildableTilesInParcel`, so a coastal parcel automatically costs less; only the hover copy lies. Change it to "The rest is water, rock or sand." and add a test that a parcel containing sand reports fewer usable tiles than its 9.

**Visual check:** hover an unowned coastal parcel — the usable-tile count excludes the sand and the price is visibly lower than an inland parcel at the same stage.

---

### Task 6: Cities saved before this rule

**Size:** small — 1 file, ~15 lines. **Library:** no library fits.

**Files:** Modify `src/sim/migrate.ts` (or `src/sim/cityreset.ts` if that is where grid validation lives). Test `src/sim/__tests__/migrate.test.ts`.

Decide and encode one rule: buildings standing on sand in an older save are left standing (grandfathered) — the sim only checks placement at placement time — and the choice is documented in the migration file so it is not rediscovered as a bug. If the block-count/score invariants dislike that, clear them instead; pick one and test it.

**Visual check:** load an existing save on a coastal seed — nothing disappears or flickers on the shore, and the city keeps its score.

---

### Task 7: The tooling agrees with the rule

**Size:** small — 2 files, ~20 lines. **Library:** no library fits.

**Files:** Modify `scripts/terrain-stats.ts` (report sand as part of the unbuildable share), `scripts/biome-check.mjs` (pick coast tiles from the new inland ring, not from `biome === 1` on sand).

**Visual check:** `npm run terrain-stats` prints an unbuildable share that includes the sand; `npm run biome-check` produces a screenshot with buildings on the coast ring at all three levels.

---

## Self-review

- Spec point 1 (no building on sand) → Task 3, with the sand's new look in Task 4 and the copy in Task 5.
- Spec point 2 (coast look from adjacency to sand) → Task 1, with the harbour rule following in Task 2.
- Ordering is safe at every step: the biome ring exists (1) and the harbour has somewhere to go (2) before sand stops being buildable (3), so the game is never in a state where the coast look or the harbour is unreachable.
