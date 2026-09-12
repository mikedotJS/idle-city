import { beforeEach, describe, expect, it } from 'vitest'
import { clearSave, load, save } from '../save'
import { createCity, placeManual, spawnBuilding } from '../actions'
import { derive } from '../economy'
import { step } from '../tick'
import { OFFLINE_CAP_SECONDS, SAVE_KEY, SAVE_VERSION, SIM_DT } from '../config'
import { tileIndex } from '../grid'
import { MemoryStorage } from './helpers'
import type { CityState } from '../types'

let store: MemoryStorage

beforeEach(() => {
  store = new MemoryStorage()
  globalThis.localStorage = store
})

/** A city with a factory or two, so it has a non-zero income rate to bank. */
function earningCity(): CityState {
  const state = createCity(9)
  state.coins = 5000
  placeManual(state, 'factory', tileIndex(4, 4))
  placeManual(state, 'factory', tileIndex(7, 7))
  for (let i = 0; i < 50; i++) step(state, SIM_DT)
  return state
}

/** Rewrite the stored save's lastSavedAt to simulate having been away. */
function ageSaveBy(seconds: number): void {
  const raw = JSON.parse(store.getItem(SAVE_KEY)!)
  raw.lastSavedAt = Date.now() - seconds * 1000
  store.setItem(SAVE_KEY, JSON.stringify(raw))
}

describe('save/load', () => {
  it('returns null when there is nothing saved', () => {
    expect(load()).toBeNull()
  })

  it('round-trips a city', () => {
    const state = earningCity()
    save(state)

    const result = load()!
    expect(result).not.toBeNull()
    expect(result.state.time).toBe(state.time)
    expect(result.state.grid.map((c) => c?.type ?? null)).toEqual(
      state.grid.map((c) => c?.type ?? null),
    )
    expect(result.state.ownedParcels).toEqual(state.ownedParcels)
    expect(result.state.queue).toEqual(state.queue)
    expect(result.state.builtCount).toEqual(state.builtCount)
    expect(result.state.rngSeed).toBe(state.rngSeed)
    expect(result.state.nextBuildAt).toBe(state.nextBuildAt)
    expect(result.offlineSeconds).toBeLessThan(1)
  })

  it('round-trips a shop\'s commerce kind', () => {
    const state = earningCity()
    const shop = spawnBuilding(state, 'shop', tileIndex(9, 9))
    save(state)

    const result = load()!
    expect(result.state.grid[shop.tile]?.commerceKind).toBe(shop.commerceKind)
  })

  it('round-trips a merged shop\'s maxi kind', () => {
    const state = earningCity()
    const shop = spawnBuilding(state, 'shop', tileIndex(9, 9))
    shop.commerceKind = 'food_court'
    save(state)

    const result = load()!
    expect(result.state.grid[shop.tile]?.commerceKind).toBe('food_court')
  })

  it('loads a save from before commerce kinds existed as a plain shop', () => {
    const state = earningCity()
    const shop = spawnBuilding(state, 'shop', tileIndex(9, 9))
    save(state)

    const raw = JSON.parse(store.getItem(SAVE_KEY)!)
    delete raw.grid[shop.tile].commerceKind
    store.setItem(SAVE_KEY, JSON.stringify(raw))

    const result = load()!
    expect(result.state.grid[shop.tile]?.commerceKind).toBeNull()
  })

  it('round-trips a building\'s merge anchor', () => {
    const state = earningCity()
    const house = spawnBuilding(state, 'house', tileIndex(5, 5))
    house.mergeAnchor = 65
    save(state)

    const result = load()!
    expect(result.state.grid[house.tile]?.mergeAnchor).toBe(65)
  })

  it('loads a save from before merge anchors existed as standing alone', () => {
    const state = earningCity()
    const house = spawnBuilding(state, 'house', tileIndex(5, 5))
    house.mergeAnchor = 65
    save(state)

    const raw = JSON.parse(store.getItem(SAVE_KEY)!)
    delete raw.grid[house.tile].mergeAnchor
    store.setItem(SAVE_KEY, JSON.stringify(raw))

    const result = load()!
    expect(result.state.grid[house.tile]?.mergeAnchor).toBeNull()
  })

  it('drops an off-grid merge anchor rather than failing to load', () => {
    const state = earningCity()
    const house = spawnBuilding(state, 'house', tileIndex(5, 5))
    house.mergeAnchor = 65
    save(state)

    const raw = JSON.parse(store.getItem(SAVE_KEY)!)
    raw.grid[house.tile].mergeAnchor = 999
    store.setItem(SAVE_KEY, JSON.stringify(raw))

    const result = load()!
    expect(result.state.grid[house.tile]?.mergeAnchor).toBeNull()
  })

  it('banks offline coins at the saved rate and freezes the sim', () => {
    const state = earningCity()
    const rate = derive(state).incomeRate
    expect(rate).toBeGreaterThan(0)
    const coinsAtSave = state.coins
    const timeAtSave = state.time
    const buildingsAtSave = state.grid.filter((c) => c !== null).length

    save(state)
    ageSaveBy(3600) // one hour away

    const result = load()!
    // `savedAt` must stay the original save time — a cross-device sync
    // comparison (sim/citysync.ts) needs this to survive `load()` resetting
    // `state.lastSavedAt` to now for its own, unrelated bookkeeping (see the
    // field's own doc comment on LoadResult).
    const rawSavedAt = JSON.parse(store.getItem(SAVE_KEY)!).lastSavedAt
    expect(result.savedAt).toBe(rawSavedAt)
    expect(result.savedAt).not.toBe(result.state.lastSavedAt)
    expect(result.offlineSeconds).toBeCloseTo(3600, 0)
    expect(result.offlineCoins).toBeCloseTo(rate * result.offlineSeconds, 4)
    expect(result.state.coins).toBeCloseTo(coinsAtSave + result.offlineCoins, 4)
    // Frozen: no ticks were replayed, so nothing grew, decayed, or aged.
    expect(result.state.time).toBe(timeAtSave)
    expect(result.state.grid.filter((c) => c !== null).length).toBe(buildingsAtSave)
  })

  it('caps offline earnings at eight hours', () => {
    const state = earningCity()
    const rate = derive(state).incomeRate
    save(state)
    ageSaveBy(72 * 3600) // three days away

    const result = load()!
    expect(OFFLINE_CAP_SECONDS).toBe(8 * 3600)
    expect(result.offlineSeconds).toBe(OFFLINE_CAP_SECONDS)
    expect(result.offlineCoins).toBeCloseTo(rate * OFFLINE_CAP_SECONDS, 4)
  })

  it('never pays for a clock that ran backwards', () => {
    const state = earningCity()
    save(state)
    ageSaveBy(-9999)
    const result = load()!
    expect(result.offlineSeconds).toBe(0)
    expect(result.offlineCoins).toBe(0)
  })

  it('returns null for a corrupt save rather than throwing', () => {
    store.setItem(SAVE_KEY, '{not json at all')
    expect(load()).toBeNull()

    store.setItem(SAVE_KEY, 'null')
    expect(load()).toBeNull()

    store.setItem(SAVE_KEY, '{"version":1}')
    expect(load()).toBeNull()

    const state = earningCity()
    save(state)
    const raw = JSON.parse(store.getItem(SAVE_KEY)!)
    raw.grid = raw.grid.slice(0, 10)
    store.setItem(SAVE_KEY, JSON.stringify(raw))
    expect(load()).toBeNull()
  })

  it('returns null for a save from another version', () => {
    const state = earningCity()
    save(state)
    const raw = JSON.parse(store.getItem(SAVE_KEY)!)
    expect(raw.version).toBe(SAVE_VERSION)
    raw.version = SAVE_VERSION + 1
    store.setItem(SAVE_KEY, JSON.stringify(raw))
    expect(load()).toBeNull()
  })

  it('clearSave removes the city', () => {
    save(earningCity())
    expect(load()).not.toBeNull()
    clearSave()
    expect(load()).toBeNull()
  })

  it('a loaded city keeps stepping exactly as the original would have', () => {
    const original = earningCity()
    save(original)
    const loaded = load()!.state
    loaded.coins = original.coins // ignore the offline credit for this comparison

    for (let i = 0; i < 100; i++) {
      step(original, SIM_DT)
      step(loaded, SIM_DT)
    }
    expect(loaded.grid.map((c) => c?.tile ?? null)).toEqual(
      original.grid.map((c) => c?.tile ?? null),
    )
    expect(loaded.coins).toBeCloseTo(original.coins, 6)
  })
})
