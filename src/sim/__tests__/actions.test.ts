import { describe, expect, it } from 'vitest'
import {
  buyParcel,
  clearQueue,
  createCity,
  demolish,
  enqueue,
  landCost,
  placeManual,
  spawnBuilding,
} from '../actions'
import { COMMERCE_KINDS, SPAWN_COMMERCE_KINDS, buildingCost } from '../buildings'
import {
  LAND_BASE_COST,
  LAND_COST_GROWTH,
  PARCEL_COUNT,
  PARCELS_PER_SIDE,
  STARTING_PARCELS,
  TILE_COUNT,
} from '../config'
import { parcelIndex, parcelOfTile, tileIndex } from '../grid'
import { SAFE_ZONE } from '../terrain'
import { earning, put, quietCity } from './helpers'

// Tiles inside the always-plain starting plot (SAFE_ZONE), used instead of
// hardcoded coordinates so these tests track wherever the starting block is,
// whatever the world size.
const SX = SAFE_ZONE.minX
const SZ = SAFE_ZONE.minZ

// The starting 2x2 block of parcels sits at (topLeftPx, topLeftPz). PARCEL_A
// is diagonal to it (borders nothing owned); PARCEL_B and PARCEL_C sit
// directly above it, one column apart (each borders the block).
const topLeftPx = Math.min(...STARTING_PARCELS.map((p) => p % PARCELS_PER_SIDE))
const topLeftPz = Math.min(...STARTING_PARCELS.map((p) => Math.floor(p / PARCELS_PER_SIDE)))
const PARCEL_A = parcelIndex(topLeftPx - 1, topLeftPz - 1)
const PARCEL_B = parcelIndex(topLeftPx, topLeftPz - 1)
const PARCEL_C = parcelIndex(topLeftPx + 1, topLeftPz - 1)

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
    const r = placeManual(state, 'factory', tileIndex(SX + 2, SZ + 2))
    expect(r.ok).toBe(true)
    expect(state.coins).toBe(1000 - cost)
    expect(state.grid[tileIndex(SX + 2, SZ + 2)]!.type).toBe('factory')
    expect(state.builtCount.factory).toBe(1)
  })

  it('refuses queue-placed types, taken tiles, unowned land and empty pockets', () => {
    const state = quietCity()
    state.coins = 100000

    expect(placeManual(state, 'house', tileIndex(SX + 2, SZ + 2))).toEqual({
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

    placeManual(state, 'park', tileIndex(SX + 2, SZ + 2))
    expect(placeManual(state, 'park', tileIndex(SX + 2, SZ + 2))).toEqual({
      ok: false,
      reason: 'That tile is taken',
    })

    state.coins = 0
    expect(placeManual(state, 'park', tileIndex(SX + 1, SZ + 1))).toEqual({
      ok: false,
      reason: 'Not enough coins',
    })
  })

  it('draws a commerce kind for a shop, and none for anything else', () => {
    const state = quietCity()
    state.coins = 100000
    placeManual(state, 'factory', tileIndex(SX + 2, SZ + 2))
    expect(state.grid[tileIndex(SX + 2, SZ + 2)]!.commerceKind).toBeNull()

    const before = state.rngSeed
    const shop = spawnBuilding(state, 'shop', tileIndex(SX + 3, SZ + 3))
    expect(shop.commerceKind).not.toBeNull()
    expect(COMMERCE_KINDS).toContain(shop.commerceKind)
    // It consumed the RNG rather than reading state that never changed.
    expect(state.rngSeed).not.toBe(before)
  })

  it('never draws a maxi kind for an ordinary shop', () => {
    // The merge-only kinds must come from merging alone: if a plain spawn
    // could draw one, a lone level-1 shop could wear a food court's colours.
    for (let seed = 1; seed <= 50; seed++) {
      const state = quietCity(seed)
      for (let i = 0; i < 4; i++) {
        const shop = spawnBuilding(state, 'shop', tileIndex(i, 9))
        expect(SPAWN_COMMERCE_KINDS).toContain(shop.commerceKind)
      }
    }
    // The plain spawn kinds stay a subset of every known kind, which is what
    // the draw test above and the save validator both rely on.
    for (const kind of SPAWN_COMMERCE_KINDS) expect(COMMERCE_KINDS).toContain(kind)
  })

  it('escalates cost with every build of that type', () => {
    const state = quietCity()
    state.coins = 100000
    const costs: number[] = []
    for (let i = 0; i < 4; i++) {
      const before = state.coins
      placeManual(state, 'park', tileIndex(SX + i, SZ))
      costs.push(before - state.coins)
    }
    expect(costs).toEqual([80, 96, 115, 138])
    for (let i = 0; i < 4; i++) expect(costs[i]).toBe(buildingCost('park', i))
  })
})

describe('demolish', () => {
  it('clears any tile for free, derelict ones included, with no refund', () => {
    const state = quietCity()
    put(state, 'house', SX + 2, SZ + 2, true)
    state.coins = 42
    expect(demolish(state, tileIndex(SX + 2, SZ + 2))).toEqual({ ok: true })
    expect(state.grid[tileIndex(SX + 2, SZ + 2)]).toBeNull()
    expect(state.coins).toBe(42)
  })

  it('refuses an empty tile', () => {
    const state = quietCity()
    expect(demolish(state, tileIndex(SX + 2, SZ + 2))).toEqual({ ok: false, reason: 'Nothing to demolish' })
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

    // PARCEL_A is diagonal from the starting 2x2 block, so it borders nothing owned.
    expect(buyParcel(state, PARCEL_A)).toEqual({ ok: false, reason: 'Must border land you own' })

    expect(buyParcel(state, PARCEL_B)).toEqual({ ok: true })
    expect(state.ownedParcels[PARCEL_B]).toBe(true)
    // Now PARCEL_A borders PARCEL_B.
    expect(buyParcel(state, PARCEL_A)).toEqual({ ok: true })

    state.coins = 0
    expect(buyParcel(state, PARCEL_C)).toEqual({ ok: false, reason: 'Not enough coins' })
    expect(buyParcel(state, PARCEL_COUNT)).toEqual({ ok: false, reason: 'No such parcel' })
  })

  it('escalates land cost from the starting parcel count', () => {
    const state = earning(quietCity())
    state.coins = 1000000
    expect(landCost(state)).toBe(LAND_BASE_COST)

    buyParcel(state, PARCEL_B)
    expect(landCost(state)).toBe(Math.round(LAND_BASE_COST * LAND_COST_GROWTH))
    buyParcel(state, PARCEL_C)
    expect(landCost(state)).toBe(Math.round(LAND_BASE_COST * LAND_COST_GROWTH ** 2))
    // 400 * 1.1^2 lands a hair over 484 in float; rounding keeps the price the
    // one the design arithmetic actually names.
    expect(landCost(state)).toBe(484)
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
