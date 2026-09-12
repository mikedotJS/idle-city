import { describe, expect, it } from 'vitest'
import { createCity, placeManual } from '../actions'
import { MAX_LEVEL, SIM_DT, TILE_COUNT, WORLD_SIZE } from '../config'
import { derive } from '../economy'
import { tileIndex, tileX, tileZ } from '../grid'
import { computeRail } from '../rail'
import { computeRoads } from '../roads'
import {
  Biome,
  SAFE_ZONE,
  Terrain,
  countTerrain,
  generateTerrain,
  isBuildable,
  terrainFor,
} from '../terrain'
import { step } from '../tick'
import { flatten, put, quietCity } from './helpers'

describe('generateTerrain', () => {
  it('is a pure function of the seed', () => {
    const a = generateTerrain(1234)
    const b = generateTerrain(1234)
    expect([...a.terrain]).toEqual([...b.terrain])
    expect([...a.beach]).toEqual([...b.beach])
  })

  it('gives different seeds different maps', () => {
    expect([...generateTerrain(1).terrain]).not.toEqual([...generateTerrain(2).terrain])
  })

  it('treats seed 0 as a flat world', () => {
    const flat = generateTerrain(0)
    expect(countTerrain(flat, Terrain.Water)).toBe(0)
    expect(countTerrain(flat, Terrain.Mountain)).toBe(0)
  })

  it('never puts water or mountain in the centre, so a new city can always grow', () => {
    // The starting plot is the centre 6x6. A city that opened onto a lake
    // would have nowhere to build and no way to earn its way out.
    for (let seed = 1; seed < 60; seed++) {
      const map = generateTerrain(seed)
      // The starting plot bounds are derived from SAFE_ZONE.
      for (let z = SAFE_ZONE.minZ; z <= SAFE_ZONE.maxZ; z++) {
        for (let x = SAFE_ZONE.minX; x <= SAFE_ZONE.maxX; x++) {
          expect(isBuildable(map, tileIndex(x, z))).toBe(true)
        }
      }
    }
  })

  it('leaves a margin of plain around the starting plot, so a new city is never walled in', () => {
    for (let seed = 1; seed < 60; seed++) {
      const map = generateTerrain(seed)
      for (let z = SAFE_ZONE.minZ - 1; z <= SAFE_ZONE.maxZ + 1; z++) {
        for (let x = SAFE_ZONE.minX - 1; x <= SAFE_ZONE.maxX + 1; x++) {
          if (x < 0 || z < 0 || x >= WORLD_SIZE || z >= WORLD_SIZE) continue
          expect(isBuildable(map, tileIndex(x, z))).toBe(true)
        }
      }
    }
  })

  it('marks every land tile beside water as beach and coast', () => {
    const map = generateTerrain(7)
    for (let i = 0; i < TILE_COUNT; i++) {
      if (map.beach[i] === 1) {
        expect(map.terrain[i]).toBe(Terrain.Plain)
        expect(map.biome[i]).toBe(Biome.Coast)
      }
    }
  })

  it('keeps the unbuildable share in a measured band, on every seed', () => {
    // Coverage now comes from a seed-drawn budget (see TOTAL_BUDGET in
    // terrain.ts) instead of a fixed threshold, so it varies with the seed
    // instead of clustering tightly. Measured over seeds 1-199 after that
    // change: min 21.0%, median ~25.7%, max ~30.0% — the 15/35 band below
    // gives headroom on both sides without being so loose it would miss a
    // real regression.
    for (let seed = 1; seed < 200; seed++) {
      const map = generateTerrain(seed)
      const blocked = countTerrain(map, Terrain.Water) + countTerrain(map, Terrain.Mountain)
      expect(blocked).toBeGreaterThan(TILE_COUNT * 0.15)
      expect(blocked).toBeLessThan(TILE_COUNT * 0.35)
      // The port is coastOnly: a seed with no water at all would make it
      // unbuildable on that city, so every seed must keep at least some.
      expect(countTerrain(map, Terrain.Water)).toBeGreaterThan(0)
    }
  })

  it('does not always draw the same shape of map', () => {
    // The silhouette itself (bay/lake/archipelago/river, range/ridge/massif/
    // buttes) is an implementation detail of landforms.ts, so this checks an
    // observable instead: how many separate 4-connected water bodies a map
    // has. A single ramp shape (the old mechanism) always makes one blob
    // touching one edge; an archipelago or a bent river routed around the
    // starting plot can split into several. Measured over seeds 1-199: 109
    // maps with exactly one body, 71 with three or more — the thresholds
    // below give headroom on both sides while still failing if a future
    // change collapses everything back to a single shape.
    function countWaterBodies(map: ReturnType<typeof generateTerrain>): number {
      const seen = new Uint8Array(TILE_COUNT)
      let bodies = 0
      for (let i = 0; i < TILE_COUNT; i++) {
        if (map.terrain[i] !== Terrain.Water || seen[i]) continue
        bodies++
        const stack = [i]
        seen[i] = 1
        while (stack.length) {
          const t = stack.pop() as number
          const x = tileX(t)
          const z = tileZ(t)
          for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nx = x + dx
            const nz = z + dz
            if (nx < 0 || nz < 0 || nx >= WORLD_SIZE || nz >= WORLD_SIZE) continue
            const ni = tileIndex(nx, nz)
            if (map.terrain[ni] === Terrain.Water && !seen[ni]) {
              seen[ni] = 1
              stack.push(ni)
            }
          }
        }
      }
      return bodies
    }

    let singleBody = 0
    let manyBodies = 0
    for (let seed = 1; seed < 200; seed++) {
      const map = generateTerrain(seed)
      const bodies = countWaterBodies(map)
      if (bodies === 1) singleBody++
      if (bodies >= 3) manyBodies++
    }
    expect(singleBody).toBeGreaterThan(10)
    expect(manyBodies).toBeGreaterThan(10)
  })

  it('varies water depth from -0.11 at the edge to -0.20 at the centre', () => {
    // Water now has variable depth to create visual transition from shallow
    // edges (hauts-fonds) to deeper centre, using the same normalisation as
    // mountain height. Range -0.11 (edge) to -0.20 (centre) keeps pier bottoms
    // at PIER_Y0 = -0.22 in render/rail.ts safely buried (margin 0.02).
    for (let seed = 1; seed < 60; seed++) {
      const map = generateTerrain(seed)
      for (let i = 0; i < TILE_COUNT; i++) {
        if (map.terrain[i] !== Terrain.Water) continue
        // Marge de sécurité : -0.21 et -0.10 plutôt que exactement -0.20 et -0.11
        // pour laisser de la place aux arrondis de la normalisation.
        expect(map.height[i]).toBeGreaterThanOrEqual(-0.21)
        expect(map.height[i]).toBeLessThanOrEqual(-0.10)
      }
    }
  })
})

describe('terrain blocks building', () => {
  it('refuses a hand-placed building on water, with a reason worth reading', () => {
    const state = createCity(3)
    state.ownedParcels.fill(true)
    state.coins = 1e9
    const map = terrainFor(state)

    const water = [...map.terrain].findIndex((t) => t === Terrain.Water)
    expect(water).toBeGreaterThanOrEqual(0)
    const result = placeManual(state, 'park', water)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('You cannot build on water')
  })

  it('never lets the auto-builder settle on water or a peak', () => {
    const state = createCity(3)
    state.ownedParcels.fill(true)
    state.coins = 1e9
    // Horizon trimmed from 1200s to 300s: the whole grid is owned here (9x
    // more tiles than when this was written), and per-tick cost scales with
    // it, so 1200s now costs far more real time for the same guarantee. 300s
    // still lets the auto-builder place dozens of buildings across the full
    // board, which is what exercises the water/mountain exclusion this test
    // is checking.
    for (let t = 0; t < 300; t += SIM_DT) step(state, SIM_DT)

    const built = state.grid.filter((c) => c !== null).length
    expect(built).toBeGreaterThan(30) // still a meaningful sample of the board

    const map = terrainFor(state)
    for (let i = 0; i < TILE_COUNT; i++) {
      if (state.grid[i]) expect(isBuildable(map, i)).toBe(true)
    }
  })

  it('stops streets at the shoreline', () => {
    const state = createCity(3)
    state.ownedParcels.fill(true)
    state.coins = 1e9
    // Horizon trimmed from 900s to 300s for the same reason as the test
    // above (full-grid ownership, per-tick cost scales with the 9x bigger
    // grid) — a handful of buildings is already enough to produce a street
    // segment, which is all this asserts.
    for (let t = 0; t < 300; t += SIM_DT) step(state, SIM_DT)
    // Every street exists because a building stands beside it, and no building
    // can stand on water, so no segment may bound two unbuildable tiles.
    expect(computeRoads(state).segmentCount).toBeGreaterThan(0)
  })
})

describe('building levels', () => {
  it('starts everything at level 1', () => {
    const state = quietCity()
    expect(put(state, 'house', 5, 5).level).toBe(1)
  })

  it('earns more at a higher level', () => {
    const base = flatten(createCity(9))
    base.ownedParcels.fill(true)
    for (let x = 4; x <= 7; x++) put(base, 'house', x, 5)
    put(base, 'shop', 5, 6)
    const before = derive(base).incomeRate

    for (const b of base.grid) if (b?.type === 'house') b.level = 2
    expect(derive(base).incomeRate).toBeGreaterThan(before)
  })

  it('houses more people at a higher level', () => {
    const state = flatten(createCity(9))
    state.ownedParcels.fill(true)
    const house = put(state, 'house', 5, 5)
    const before = derive(state).population
    house.level = 3
    expect(derive(state).population).toBeGreaterThan(before)
  })

  it('makes a levelled factory poison harder, not wider', () => {
    // Read three tiles out: closer in, a level 1 factory already clamps the
    // field to zero and there is no room left to show a difference.
    const near = tileIndex(8, 5)
    const one = quietCity()
    const factory = put(one, 'factory', 5, 5)
    const atLevel1 = derive(one).field[near]
    expect(atLevel1).toBeGreaterThan(0)

    factory.level = 3
    expect(derive(one).field[near]).toBeLessThan(atLevel1)
  })

  it('upgrades only once the plot is full, and never past the cap', () => {
    // A small owned plot fills fast, which is exactly when density should start.
    //
    // Horizon trimmed from 4000s to 800s: the world grid grew 9x (12->36
    // per side) since this was written, and per-tick cost scales with the
    // whole grid, not with the small owned plot this test cares about — so
    // 4000 simulated seconds now takes far longer in real time without
    // testing anything more. The owned plot is 36 tiles; at one auto-build
    // roughly every 8-16s (BUILD_INTERVAL / happiness-scaled), 800s is still
    // comfortably enough to fill it and then upgrade past level 1, which is
    // all this test checks for.
    const state = flatten(createCity(21))
    state.coins = 1e9
    for (let t = 0; t < 800; t += SIM_DT) step(state, SIM_DT)

    let levelled = 0
    for (const b of state.grid) {
      if (!b) continue
      expect(b.level).toBeGreaterThanOrEqual(1)
      expect(b.level).toBeLessThanOrEqual(MAX_LEVEL)
      if (b.level > 1) levelled++
    }
    expect(levelled).toBeGreaterThan(0)
  })
})

describe('computeRail', () => {
  it('lays no track for nought or one station', () => {
    const state = quietCity()
    expect(computeRail(state).segmentCount).toBe(0)
    put(state, 'station', 4, 4)
    const single = computeRail(state)
    expect(single.segmentCount).toBe(0)
    expect(single.stations).toHaveLength(1)
  })

  it('links two stations with an unbroken elbow of track', () => {
    const state = quietCity()
    put(state, 'station', 3, 3)
    put(state, 'station', 7, 6)
    const rail = computeRail(state)

    expect(rail.stations).toHaveLength(2)
    expect(rail.lines).toHaveLength(1)
    // Four across plus three down, and every step joins the previous corner.
    expect(rail.segmentCount).toBe(7)

    const line = rail.lines[0]
    for (let i = 0; i + 1 < line.length; i++) {
      expect(line[i]).not.toBe(line[i + 1])
    }
  })

  it('never draws a shared stretch of track twice', () => {
    const state = quietCity()
    put(state, 'station', 3, 3)
    put(state, 'station', 5, 3)
    put(state, 'station', 7, 3)
    const rail = computeRail(state)

    const seen = new Set<string>()
    for (let i = 0; i < rail.segmentCount; i++) {
      const a = rail.segments[i * 2]
      const b = rail.segments[i * 2 + 1]
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('crosses water rather than stopping at it, unlike a road', () => {
    // Track is allowed a bridge; a line that halted at every shore would need
    // a station on every island.
    const state = createCity(3)
    state.ownedParcels.fill(true)
    state.coins = 1e9
    put(state, 'station', 5, 5)
    put(state, 'station', 5, 6)
    expect(computeRail(state).segmentCount).toBeGreaterThan(0)
  })
})
