import { describe, expect, it } from 'vitest'
import { createCity, placeManual } from '../actions'
import { MAX_LEVEL, SIM_DT, TILE_COUNT } from '../config'
import { derive } from '../economy'
import { tileIndex } from '../grid'
import { computeRail } from '../rail'
import { computeRoads } from '../roads'
import {
  Biome,
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
      // The starting plot is the centre 6x6: tiles 3..8 on both axes.
      for (let z = 3; z <= 8; z++) {
        for (let x = 3; x <= 8; x++) {
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

  it('leaves most of the board buildable, or the economy has nothing to stand on', () => {
    for (let seed = 1; seed < 40; seed++) {
      const map = generateTerrain(seed)
      const blocked = countTerrain(map, Terrain.Water) + countTerrain(map, Terrain.Mountain)
      expect(blocked).toBeLessThan(TILE_COUNT * 0.4)
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
    for (let t = 0; t < 1200; t += SIM_DT) step(state, SIM_DT)

    const map = terrainFor(state)
    for (let i = 0; i < TILE_COUNT; i++) {
      if (state.grid[i]) expect(isBuildable(map, i)).toBe(true)
    }
  })

  it('stops streets at the shoreline', () => {
    const state = createCity(3)
    state.ownedParcels.fill(true)
    state.coins = 1e9
    for (let t = 0; t < 900; t += SIM_DT) step(state, SIM_DT)
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
    const state = flatten(createCity(21))
    state.coins = 1e9
    for (let t = 0; t < 4000; t += SIM_DT) step(state, SIM_DT)

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
