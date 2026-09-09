import { describe, expect, it } from 'vitest'
import { createCity, placeManual, placementProblem } from '../actions'
import { BUILDINGS, buildingCost } from '../buildings'
import {
  BASE_HAPPINESS,
  HABITABLE_HAPPINESS,
  INCOME_FLOOR,
  LANDFILL_COINS,
  LEVEL_OUTPUT,
} from '../config'
import { derive } from '../economy'
import { computeField } from '../field'
import { tileIndex } from '../grid'
import { Terrain, generateTerrain, isCoast, terrainFor } from '../terrain'
import { flatten, put, quietCity } from './helpers'

describe('the school', () => {
  it('reaches further than a park and lifts less at the centre', () => {
    const park = quietCity()
    put(park, 'park', 5, 5)
    const school = quietCity()
    put(school, 'school', 5, 5)

    const pf = computeField(park)
    const sf = computeField(school)

    // Right next to it, the park wins.
    expect(pf[tileIndex(6, 5)]).toBeGreaterThan(sf[tileIndex(6, 5)])
    // Four tiles out, the park has run out entirely and the school has not.
    expect(pf[tileIndex(9, 5)]).toBe(BASE_HAPPINESS)
    expect(sf[tileIndex(9, 5)]).toBeGreaterThan(BASE_HAPPINESS)
  })

  it('earns nothing by itself', () => {
    const state = quietCity()
    state.coins = 1e6
    put(state, 'school', 5, 5)
    expect(derive(state).incomeRate).toBe(0)
  })
})

describe('the harbour', () => {
  it('will not stand inland', () => {
    const state = flatten(createCity(3)) // seed 0 terrain: no water anywhere
    state.coins = 1e6
    const r = placeManual(state, 'harbour', tileIndex(5, 5))
    expect(r.ok).toBe(false)
    expect(state.grid[tileIndex(5, 5)]).toBeNull()
  })

  it('stands on a shoreline tile once you own the shore', () => {
    // The coast is never inside the starting plot — terrain begins beyond it,
    // which is the whole reason to buy land. So own everything first.
    const state = createCity(7)
    state.ownedParcels.fill(true)
    state.coins = 1e6
    const map = terrainFor(state)

    const shore = map.terrain.findIndex((_, tile) => isCoast(map, tile))
    expect(shore).toBeGreaterThanOrEqual(0)

    const before = state.coins
    expect(placeManual(state, 'harbour', shore).ok).toBe(true)
    expect(state.grid[shore]!.type).toBe('harbour')
    expect(state.coins).toBe(before - buildingCost('harbour', 0))
  })

  it('charges nothing for a refusal', () => {
    const state = createCity(7)
    state.ownedParcels.fill(true)
    state.coins = 1e6
    const map = terrainFor(state)
    const inland = map.terrain.findIndex(
      (t, tile) => t === Terrain.Plain && !isCoast(map, tile),
    )
    const before = state.coins
    expect(placeManual(state, 'harbour', inland).ok).toBe(false)
    expect(state.coins).toBe(before)
    expect(state.builtCount.harbour).toBe(0)
  })

  it('marks the shore the renderer draws, not a shore of its own', () => {
    // isCoast reads the same beach array the sand strip comes from. If these
    // ever diverge, a harbour lands on a tile with no visible water by it.
    const map = generateTerrain(12345)
    for (let tile = 0; tile < map.terrain.length; tile++) {
      if (!isCoast(map, tile)) continue
      expect(map.terrain[tile]).toBe(Terrain.Plain)
    }
  })
})

describe('the landfill', () => {
  it('earns, unlike every other amenity', () => {
    const state = quietCity()
    put(state, 'landfill', 5, 5)
    const d = derive(state)
    expect(d.incomeRate).toBeCloseTo(LANDFILL_COINS * (INCOME_FLOOR + d.cityHappiness), 6)
  })

  it('scales its earnings with its level like a factory does', () => {
    const state = quietCity()
    const b = put(state, 'landfill', 5, 5)
    const one = derive(state).incomeRate
    b.level = 2
    expect(derive(state).incomeRate).toBeCloseTo(one * LEVEL_OUTPUT[2], 6)
  })

  it('is worse value per coin than a factory, and gets worse faster', () => {
    const landfill = BUILDINGS.landfill
    const factory = BUILDINGS.factory
    expect(landfill.coins! / landfill.baseCost).toBeLessThan(factory.coins! / factory.baseCost)
    expect(landfill.costGrowth).toBeGreaterThan(factory.costGrowth)
    // ...but affordable from the very first minute, which is its whole point.
    expect(landfill.baseCost).toBeLessThan(factory.baseCost)
  })

  it('ruins a much smaller circle than a factory', () => {
    // Measured, not asserted from the constants: 9 tiles against 21, which is
    // a 3x3 you can wall off against a blot across a whole district.
    const unlivable = (type: 'landfill' | 'factory') => {
      const s = quietCity()
      put(s, type, 5, 5)
      const f = computeField(s)
      let n = 0
      for (const h of f) if (h < HABITABLE_HAPPINESS) n++
      return n
    }
    expect(unlivable('landfill')).toBe(9)
    expect(unlivable('factory')).toBe(21)
  })

  it('ruins that circle past saving, which the factory does not', () => {
    // This is the trade the two are meant to pose. A park rescues the tile
    // beside a factory; beside a landfill it does nothing at all, and it takes
    // two to scrape the tile back over the habitable line.
    const beside = (type: 'landfill' | 'factory', parks: number) => {
      const s = quietCity()
      put(s, type, 5, 5)
      if (parks >= 1) put(s, 'park', 7, 5)
      if (parks >= 2) put(s, 'park', 6, 6)
      return computeField(s)[tileIndex(6, 5)]
    }
    expect(beside('landfill', 1)).toBe(0)
    expect(beside('factory', 1)).toBeGreaterThan(0)
    expect(beside('landfill', 2)).toBeGreaterThanOrEqual(HABITABLE_HAPPINESS)
  })
})

describe('the registry is the only list of building types', () => {
  it('gives every type a count on a brand new city', () => {
    const state = createCity(1)
    for (const type of Object.keys(BUILDINGS)) {
      expect(state.builtCount[type as keyof typeof state.builtCount]).toBe(0)
    }
  })
})

describe('one rule for whether a building may go there', () => {
  it('agrees with placeManual on every tile of a real map', () => {
    // The renderer's ghost asks placementProblem and the click calls
    // placeManual. If they can ever disagree, the ghost is a lie: it sat green
    // on grass for a harbour and only refused once the player committed.
    for (const type of ['factory', 'park', 'school', 'harbour', 'landfill', 'station'] as const) {
      const probe = createCity(11)
      probe.ownedParcels.fill(true)
      probe.coins = 500
      for (let tile = 0; tile < probe.grid.length; tile++) {
        const predicted = placementProblem(probe, type, tile)
        const state = createCity(11)
        state.ownedParcels.fill(true)
        state.coins = 500
        const actual = placeManual(state, type, tile)
        expect(actual.ok).toBe(predicted === null)
        if (!actual.ok) expect(actual.reason).toBe(predicted)
      }
    }
  })

  it('refuses for want of coins, so the ghost can say so before the click', () => {
    const state = createCity(11)
    state.ownedParcels.fill(true)
    state.coins = 0
    expect(placementProblem(state, 'park', tileIndex(5, 5))).toBe('Not enough coins')
  })
})
