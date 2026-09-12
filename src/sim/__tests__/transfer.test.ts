import { describe, expect, it } from 'vitest'
import { createCity, placeManual } from '../actions'
import { OFFLINE_CAP_SECONDS, SAVE_VERSION } from '../config'
import { tileIndex } from '../grid'
import { exportCity, importCity } from '../transfer'
import { SAFE_ZONE } from '../terrain'
import { flatten, put, quietCity } from './helpers'

const SX = SAFE_ZONE.minX
const SZ = SAFE_ZONE.minZ

function cityWorthMoving() {
  const state = flatten(createCity(9))
  state.coins = 4321
  state.time = 987
  state.queue.length = 0
  state.nextBuildAt = Number.MAX_SAFE_INTEGER
  put(state, 'house', SX + 1, SZ + 1)
  put(state, 'shop', SX + 2, SZ + 1)
  state.coins = 1e6
  placeManual(state, 'factory', tileIndex(SX + 4, SZ + 4))
  return state
}

describe('carrying a city to another browser', () => {
  it('round-trips the whole city', () => {
    const before = cityWorthMoving()
    const result = importCity(exportCity(before))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const after = result.state
    expect(after.coins).toBe(before.coins)
    expect(after.time).toBe(before.time)
    expect(after.rngSeed).toBe(before.rngSeed)
    expect(after.terrainSeed).toBe(before.terrainSeed)
    expect(after.builtCount).toEqual(before.builtCount)
    expect(after.ownedParcels).toEqual(before.ownedParcels)
    expect(after.grid[tileIndex(SX + 4, SZ + 4)]!.type).toBe('factory')
  })

  it('does not pay out for the time the text spent on a clipboard', () => {
    // The export carries the wall clock of the moment it was made. Trusting it
    // would make the box a coin printer: export, wait a day, import, collect a
    // day of offline earnings, repeat.
    const state = cityWorthMoving()
    state.lastSavedAt = Date.now() - OFFLINE_CAP_SECONDS * 1000 * 10
    const text = exportCity(state)

    const result = importCity(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.coins).toBe(state.coins)
    expect(Date.now() - result.state.lastSavedAt).toBeLessThan(1000)
  })

  it('says what is wrong rather than silently doing nothing', () => {
    for (const [text, fragment] of [
      ['', 'Nothing'],
      ['   ', 'Nothing'],
      ['not json at all', 'JSON'],
      ['{"version":1}', 'not a city'],
      ['[1,2,3]', 'not a city'],
    ] as const) {
      const result = importCity(text)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.reason).toContain(fragment)
    }
  })

  it('refuses a city from a future version rather than half-opening it', () => {
    const state = quietCity()
    const raw = JSON.parse(exportCity(state))
    raw.version = SAVE_VERSION + 1
    expect(importCity(JSON.stringify(raw)).ok).toBe(false)
  })

  it('refuses a city that has been edited into nonsense', () => {
    const state = quietCity()
    const raw = JSON.parse(exportCity(state))
    raw.coins = 'lots'
    expect(importCity(JSON.stringify(raw)).ok).toBe(false)

    const short = JSON.parse(exportCity(state))
    short.grid = short.grid.slice(0, 10)
    expect(importCity(JSON.stringify(short)).ok).toBe(false)
  })

  it('tolerates the whitespace a copy-paste picks up', () => {
    const text = exportCity(quietCity())
    expect(importCity(`\n  ${text}\n\n`).ok).toBe(true)
  })

  it('goes through the same validator a stored save does', () => {
    // Not a behaviour test so much as a guard: if a second, looser validator
    // ever appears, hand-edited coin counts arrive through the import box.
    const raw = JSON.parse(exportCity(quietCity()))
    delete raw.builtCount
    expect(importCity(JSON.stringify(raw)).ok).toBe(false)
  })
})
