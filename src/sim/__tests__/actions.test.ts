import { describe, expect, it } from 'vitest'
import {
  buyParcel,
  clearQueue,
  createCity,
  demolish,
  enqueue,
  landCost,
  placeManual,
} from '../actions'
import { buildingCost } from '../buildings'
import {
  LAND_BASE_COST,
  LAND_COST_GROWTH,
  PARCEL_COUNT,
  STARTING_PARCELS,
  TILE_COUNT,
} from '../config'
import { parcelOfTile, tileIndex } from '../grid'
import { earning, put, quietCity } from './helpers'

describe('createCity', () => {
  it('starts on the centre parcels with an empty grid and a workable policy', () => {
    const state = createCity(7)
    expect(state.grid.length).toBe(TILE_COUNT)
    expect(state.grid.every((c) => c === null)).toBe(true)
    expect(state.ownedParcels.filter(Boolean).length).toBe(STARTING_PARCELS.length)
    for (const p of STARTING_PARCELS) expect(state.ownedParcels[p]).toBe(true)
    // Two houses per shop: houses alone earn nothing at all, so a queue that
    // cannot reach a shop leaves a new city stalled at zero income forever.
    expect(state.queue).toEqual(['house', 'house', 'shop'])
    expect(state.time).toBe(0)
  })
})

describe('placeManual', () => {
  it('places a factory on an empty owned tile and charges for it', () => {
    const state = quietCity()
    state.coins = 1000
    const cost = buildingCost('factory', 0)
    const r = placeManual(state, 'factory', tileIndex(5, 5))
    expect(r.ok).toBe(true)
    expect(state.coins).toBe(1000 - cost)
    expect(state.grid[tileIndex(5, 5)]!.type).toBe('factory')
    expect(state.builtCount.factory).toBe(1)
  })

  it('refuses queue-placed types, taken tiles, unowned land and empty pockets', () => {
    const state = quietCity()
    state.coins = 100000

    expect(placeManual(state, 'house', tileIndex(5, 5))).toEqual({
      ok: false,
      reason: 'Houses are built by the queue',
    })

    // Corner tile 0 belongs to a parcel we do not own at the start.
    expect(state.ownedParcels[parcelOfTile(0)]).toBe(false)
    expect(placeManual(state, 'park', 0)).toEqual({
      ok: false,
      reason: 'You do not own that land',
    })

    expect(placeManual(state, 'park', -1).ok).toBe(false)
    expect(placeManual(state, 'park', TILE_COUNT).ok).toBe(false)

    placeManual(state, 'park', tileIndex(5, 5))
    expect(placeManual(state, 'park', tileIndex(5, 5))).toEqual({
      ok: false,
      reason: 'That tile is taken',
    })

    state.coins = 0
    expect(placeManual(state, 'park', tileIndex(4, 4))).toEqual({
      ok: false,
      reason: 'Not enough coins',
    })
  })

  it('escalates cost with every build of that type', () => {
    const state = quietCity()
    state.coins = 100000
    const costs: number[] = []
    for (let i = 0; i < 4; i++) {
      const before = state.coins
      placeManual(state, 'park', tileIndex(3 + i, 3))
      costs.push(before - state.coins)
    }
    expect(costs).toEqual([80, 96, 115, 138])
    for (let i = 0; i < 4; i++) expect(costs[i]).toBe(buildingCost('park', i))
  })
})

describe('demolish', () => {
  it('clears any tile for free, derelict ones included, with no refund', () => {
    const state = quietCity()
    put(state, 'house', 5, 5, true)
    state.coins = 42
    expect(demolish(state, tileIndex(5, 5))).toEqual({ ok: true })
    expect(state.grid[tileIndex(5, 5)]).toBeNull()
    expect(state.coins).toBe(42)
  })

  it('refuses an empty tile', () => {
    const state = quietCity()
    expect(demolish(state, tileIndex(5, 5))).toEqual({ ok: false, reason: 'Nothing to demolish' })
  })
})

describe('buyParcel', () => {
  it('requires adjacency, funds, and that it is not already yours', () => {
    const state = earning(quietCity())
    state.coins = 100000

    expect(buyParcel(state, STARTING_PARCELS[0])).toEqual({
      ok: false,
      reason: 'You already own that land',
    })

    // Parcel 0 is diagonal from the starting 2x2 block, so it borders nothing owned.
    expect(buyParcel(state, 0)).toEqual({ ok: false, reason: 'Must border land you own' })

    expect(buyParcel(state, 1)).toEqual({ ok: true })
    expect(state.ownedParcels[1]).toBe(true)
    // Now parcel 0 borders parcel 1.
    expect(buyParcel(state, 0)).toEqual({ ok: true })

    state.coins = 0
    expect(buyParcel(state, 2)).toEqual({ ok: false, reason: 'Not enough coins' })
    expect(buyParcel(state, PARCEL_COUNT)).toEqual({ ok: false, reason: 'No such parcel' })
  })

  it('escalates land cost from the starting parcel count', () => {
    const state = earning(quietCity())
    state.coins = 1000000
    expect(landCost(state)).toBe(LAND_BASE_COST)

    buyParcel(state, 1)
    expect(landCost(state)).toBe(Math.round(LAND_BASE_COST * LAND_COST_GROWTH))
    buyParcel(state, 2)
    expect(landCost(state)).toBe(Math.round(LAND_BASE_COST * LAND_COST_GROWTH ** 2))
    // 400 * 1.7^2 lands a hair under 1156 in float; rounding keeps the price the
    // one the design arithmetic actually names.
    expect(landCost(state)).toBe(1156)
  })

  it('returns null land cost once the whole world is owned', () => {
    const state = quietCity()
    state.ownedParcels.fill(true)
    expect(landCost(state)).toBeNull()
  })
})

describe('queue', () => {
  it('appends and clears', () => {
    const state = createCity(3)
    enqueue(state, 'shop')
    enqueue(state, 'house')
    expect(state.queue).toEqual(['house', 'house', 'shop', 'shop', 'house'])
    clearQueue(state)
    expect(state.queue).toEqual([])
  })
})

describe('a new city is its own city', () => {
  it('gives every unseeded city a different map and build order', () => {
    // This defaulted to a constant, so every new city was the same city: same
    // lake, same ridge, same order of building. Terrain varied by seed and
    // nothing ever varied the seed.
    const seeds = new Set<number>()
    const terrains = new Set<number>()
    for (let i = 0; i < 40; i++) {
      const city = createCity()
      seeds.add(city.rngSeed)
      terrains.add(city.terrainSeed)
    }
    expect(seeds.size).toBeGreaterThan(35)
    expect(terrains.size).toBeGreaterThan(35)
  })

  it('stays exactly reproducible when a seed is given', () => {
    expect(createCity(7).terrainSeed).toBe(createCity(7).terrainSeed)
    expect(createCity(7).rngSeed).toBe(createCity(7).rngSeed)
    expect(createCity(7).rngSeed).not.toBe(createCity(8).rngSeed)
  })

  it('never lands on a zero seed, which would mean the flat world', () => {
    // terrainSeed 0 is the deliberate no-terrain escape hatch used by tests.
    // A real city falling into it by accident would silently lose its geography.
    for (let i = 0; i < 200; i++) {
      expect(createCity().rngSeed).not.toBe(0)
      expect(createCity().terrainSeed).not.toBe(0)
    }
  })
})
