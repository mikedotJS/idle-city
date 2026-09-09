import { describe, expect, it } from 'vitest'
import { buyParcel, createCity, landCost } from '../actions'
import { LAND_BARREN_FLOOR, PARCEL_COUNT, PARCEL_SIZE } from '../config'
import { nextLandCost, parcelCost } from '../economy'
import { parcelNeighbours } from '../grid'
import { buildableTilesInParcel, terrainFor } from '../terrain'
import { flatten } from './helpers'

const TILES_PER_PARCEL = PARCEL_SIZE * PARCEL_SIZE

/** A seed whose parcels differ in how much of them is usable. */
function mixedCity() {
  for (let seed = 1; seed < 400; seed++) {
    const state = createCity(seed)
    const map = terrainFor(state)
    const usable = new Set<number>()
    for (let p = 0; p < PARCEL_COUNT; p++) usable.add(buildableTilesInParcel(map, p))
    if (usable.size > 1 && usable.has(TILES_PER_PARCEL)) return state
  }
  throw new Error('no seed produced parcels of differing usability')
}

describe('land is priced by what is in it', () => {
  it('charges less for a parcel that is half lake', () => {
    const state = mixedCity()
    const map = terrainFor(state)
    let full = -1
    let poor = -1
    for (let p = 0; p < PARCEL_COUNT; p++) {
      if (state.ownedParcels[p]) continue
      const usable = buildableTilesInParcel(map, p)
      if (usable === TILES_PER_PARCEL) full = p
      else if (poor < 0 || usable < buildableTilesInParcel(map, poor)) poor = p
    }
    expect(full).toBeGreaterThanOrEqual(0)
    expect(poor).toBeGreaterThanOrEqual(0)
    expect(parcelCost(state, poor)!).toBeLessThan(parcelCost(state, full)!)
  })

  it('never gives barren land away, because it is still the bridge past it', () => {
    const state = mixedCity()
    const map = terrainFor(state)
    for (let p = 0; p < PARCEL_COUNT; p++) {
      if (state.ownedParcels[p]) continue
      const cost = parcelCost(state, p)!
      expect(cost).toBeGreaterThan(0)
      if (buildableTilesInParcel(map, p) === 0) {
        const full = parcelCost(flatten(createCity(1)), p)!
        expect(cost / full).toBeCloseTo(LAND_BARREN_FLOOR, 1)
      }
    }
  })

  it('still gets dearer the more you own', () => {
    // The escalation is what keeps the city from swallowing the board, and
    // pricing by terrain must not have quietly replaced it.
    const state = flatten(createCity(3)) // flat world: every parcel is 9/9
    state.coins = 1e9
    const prices: number[] = []
    for (let i = 0; i < 6; i++) {
      const buyable = []
      for (let p = 0; p < PARCEL_COUNT; p++) {
        if (state.ownedParcels[p]) continue
        if (parcelNeighbours(p).some((n) => state.ownedParcels[n])) buyable.push(p)
      }
      if (buyable.length === 0) break
      prices.push(parcelCost(state, buyable[0])!)
      buyParcel(state, buyable[0])
    }
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeGreaterThan(prices[i - 1])
  })

  it('charges for the parcel you clicked, not for some other one', () => {
    const state = mixedCity()
    state.coins = 1e6
    let target = -1
    for (let p = 0; p < PARCEL_COUNT; p++) {
      if (state.ownedParcels[p]) continue
      if (parcelNeighbours(p).some((n) => state.ownedParcels[n])) {
        target = p
        break
      }
    }
    const quoted = parcelCost(state, target)!
    const before = state.coins
    expect(buyParcel(state, target).ok).toBe(true)
    expect(before - state.coins).toBe(quoted)
  })

  it('quotes the cheapest thing you could actually buy', () => {
    const state = mixedCity()
    const cheapest = nextLandCost(state)!
    for (let p = 0; p < PARCEL_COUNT; p++) {
      if (state.ownedParcels[p]) continue
      if (!parcelNeighbours(p).some((n) => state.ownedParcels[n])) continue
      expect(parcelCost(state, p)!).toBeGreaterThanOrEqual(cheapest)
    }
    expect(landCost(state)).toBe(cheapest)
  })

  it('stops quoting a price once there is nothing left to buy', () => {
    const state = flatten(createCity(4))
    state.ownedParcels.fill(true)
    expect(nextLandCost(state)).toBeNull()
    expect(parcelCost(state, 0)).toBeNull()
  })
})
