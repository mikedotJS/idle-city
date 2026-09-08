import { describe, expect, it } from 'vitest'
import { pickBuildTile, tryAutoBuild } from '../builder'
import { derive } from '../economy'
import { computeField } from '../field'
import { buildingCost } from '../buildings'
import { BUILD_INTERVAL, INCOME_FLOOR, WORLD_SIZE } from '../config'
import { parcelOfTile, tileDistance, tileIndex, tileX, tileZ } from '../grid'
import { put, quietCity } from './helpers'

describe('pickBuildTile', () => {
  it('picks the owned tile nearest the world centre when the city is empty', () => {
    const state = quietCity()
    const tile = pickBuildTile(state)!
    const centre = (WORLD_SIZE - 1) / 2
    const d = Math.hypot(tileX(tile) - centre, tileZ(tile) - centre)
    expect(d).toBeCloseTo(Math.SQRT2 / 2, 6)
  })

  it('fills the nearest gap and ignores a much nicer far-away tile', () => {
    const state = quietCity()
    put(state, 'factory', 5, 5)
    const field = computeField(state)

    const nice = tileIndex(8, 8)
    expect(state.ownedParcels[parcelOfTile(nice)]).toBe(true)
    expect(field[nice]).toBeGreaterThan(field[tileIndex(4, 5)])

    for (let i = 0; i < 20; i++) {
      const tile = pickBuildTile(state)!
      // Always a neighbour of the factory, never the pleasant tile across the plot.
      expect(tileDistance(tile, tileIndex(5, 5))).toBeCloseTo(1, 6)
      expect(tile).not.toBe(nice)
    }
  })

  it('measures distance to the nearest of several buildings', () => {
    const state = quietCity()
    // Two clusters plus a lone outlier: the gap next to any of them may win.
    put(state, 'house', 3, 3)
    put(state, 'house', 4, 3)
    put(state, 'house', 8, 8)

    const nearestBuilding = (tile: number) => {
      let best = Infinity
      for (let i = 0; i < state.grid.length; i++) {
        if (state.grid[i]) best = Math.min(best, tileDistance(tile, i))
      }
      return best
    }

    let globalBest = Infinity
    for (let i = 0; i < state.grid.length; i++) {
      if (state.grid[i] || !state.ownedParcels[parcelOfTile(i)]) continue
      globalBest = Math.min(globalBest, nearestBuilding(i))
    }

    const tile = pickBuildTile(state)!
    expect(state.grid[tile]).toBeNull()
    expect(state.ownedParcels[parcelOfTile(tile)]).toBe(true)
    expect(nearestBuilding(tile)).toBeCloseTo(globalBest, 6)
  })

  it('reaches a diagonal gap when the orthogonal ones are not on our land', () => {
    const state = quietCity()
    // A building just outside the owned block: the only owned tile touching it
    // does so diagonally, at sqrt(2), and must still be chosen over 2.236.
    put(state, 'house', 2, 2)
    expect(pickBuildTile(state)).toBe(tileIndex(3, 3))
  })

  it('returns null when every owned tile is taken', () => {
    const state = quietCity()
    for (let z = 3; z <= 8; z++) for (let x = 3; x <= 8; x++) put(state, 'house', x, z)
    expect(pickBuildTile(state)).toBeNull()
  })

  it('breaks ties the same way for the same seed', () => {
    const a = quietCity(12345)
    const b = quietCity(12345)
    put(a, 'factory', 5, 5)
    put(b, 'factory', 5, 5)
    for (let i = 0; i < 10; i++) expect(pickBuildTile(a)).toBe(pickBuildTile(b))
  })
})

describe('tryAutoBuild', () => {
  it('does nothing and does not reschedule when the front of the queue is unaffordable', () => {
    const state = quietCity()
    state.queue = ['shop']
    state.coins = buildingCost('shop', 0) - 1
    state.nextBuildAt = 5

    expect(tryAutoBuild(state, derive(state))).toBeNull()
    expect(state.nextBuildAt).toBe(5)
    expect(state.grid.some((c) => c !== null)).toBe(false)
    expect(state.coins).toBe(buildingCost('shop', 0) - 1)
  })

  it('pays, counts the build, and re-pushes the type when the queue empties', () => {
    const state = quietCity()
    state.queue = ['shop']
    state.coins = 500
    state.time = 10

    const cost = buildingCost('shop', 0)
    const derived = derive(state)
    const built = tryAutoBuild(state, derived)!

    expect(built.type).toBe('shop')
    expect(built.bornAt).toBe(10)
    expect(state.coins).toBe(500 - cost)
    expect(state.builtCount.shop).toBe(1)
    expect(state.queue).toEqual(['shop'])
    expect(state.nextBuildAt).toBeCloseTo(
      10 + BUILD_INTERVAL / (INCOME_FLOOR + derived.cityHappiness),
      6,
    )
  })

  it('consumes the queue in order without repeating while entries remain', () => {
    const state = quietCity()
    state.queue = ['house', 'shop']
    state.coins = 500
    expect(tryAutoBuild(state, derive(state))!.type).toBe('house')
    expect(state.queue).toEqual(['shop'])
    expect(tryAutoBuild(state, derive(state))!.type).toBe('shop')
    expect(state.queue).toEqual(['shop'])
  })

  it('does nothing with an empty queue', () => {
    const state = quietCity()
    state.queue = []
    state.coins = 500
    expect(tryAutoBuild(state, derive(state))).toBeNull()
  })
})
