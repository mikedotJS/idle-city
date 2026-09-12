import { describe, expect, it } from 'vitest'
import { createCity, enqueue, placeManual } from '../actions'
import { step } from '../tick'
import { SIM_DT } from '../config'
import { tileIndex } from '../grid'
import { SAFE_ZONE } from '../terrain'
import type { CityState } from '../types'

function grow(seed: number, ticks = 200): CityState {
  const state = createCity(seed)
  state.coins = 5000
  placeManual(state, 'factory', tileIndex(SAFE_ZONE.minX + 1, SAFE_ZONE.minZ + 1))
  placeManual(state, 'park', tileIndex(SAFE_ZONE.minX + 4, SAFE_ZONE.minZ + 4))
  enqueue(state, 'shop')
  for (let i = 0; i < ticks; i++) step(state, SIM_DT)
  return state
}

/** Everything the sim owns. lastSavedAt is wall-clock, so it is not sim state. */
function snapshot(state: CityState): string {
  const { lastSavedAt: _ignored, ...rest } = state
  return JSON.stringify(rest)
}

describe('determinism', () => {
  it('builds the same 200-tick city twice from the same seed', () => {
    const a = grow(4242)
    const b = grow(4242)

    const count = a.grid.filter((c) => c !== null).length
    expect(count).toBeGreaterThan(4) // it actually grew, so the check means something
    expect(snapshot(a)).toBe(snapshot(b))
  })

  it('consumes the seeded RNG as it builds', () => {
    const state = grow(4242)
    expect(state.rngSeed).not.toBe(4242)
  })

  it('keeps stepping deterministically after the state is cloned', () => {
    const a = grow(77)
    const b = JSON.parse(JSON.stringify(a)) as CityState
    for (let i = 0; i < 200; i++) {
      step(a, SIM_DT)
      step(b, SIM_DT)
    }
    expect(snapshot(a)).toBe(snapshot(b))
  })
})
