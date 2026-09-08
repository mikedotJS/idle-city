import { describe, expect, it } from 'vitest'
import { step } from '../tick'
import { computeField } from '../field'
import {
  DERELICT_DELAY,
  DERELICT_HAPPINESS,
  RECOVER_DELAY,
  RECOVER_HAPPINESS,
  SIM_DT,
} from '../config'
import { tileIndex } from '../grid'
import { put, quietCity } from './helpers'

const EPS = 1e-9

/** Step until sim time reaches `until` seconds. */
function runUntil(state: ReturnType<typeof quietCity>, until: number): void {
  while (state.time < until - EPS) step(state, SIM_DT)
}

describe('dereliction hysteresis', () => {
  it('derelicts a house after exactly DERELICT_DELAY below the floor, not at 29s', () => {
    const state = quietCity()
    const house = put(state, 'house', 5, 5)
    put(state, 'factory', 6, 5)
    expect(computeField(state)[tileIndex(5, 5)]).toBeLessThan(DERELICT_HAPPINESS)

    step(state, SIM_DT)
    const lowSince = house.lowSince
    expect(lowSince).not.toBeNull()

    runUntil(state, lowSince! + 29)
    expect(state.time - lowSince!).toBeCloseTo(29, 6)
    expect(house.derelict).toBe(false)

    runUntil(state, lowSince! + DERELICT_DELAY)
    expect(state.time - lowSince!).toBeCloseTo(DERELICT_DELAY, 6)
    expect(house.derelict).toBe(true)
  })

  it('resets the timer if happiness recovers before the delay elapses', () => {
    const state = quietCity()
    const house = put(state, 'house', 5, 5)
    put(state, 'factory', 6, 5)

    runUntil(state, 20)
    expect(house.derelict).toBe(false)
    expect(house.lowSince).not.toBeNull()

    state.grid[tileIndex(6, 5)] = null // demolish the factory
    step(state, SIM_DT)
    expect(house.lowSince).toBeNull()

    runUntil(state, 60)
    expect(house.derelict).toBe(false)
  })

  it('does not flicker while happiness sits between the two thresholds', () => {
    // A factory 2 tiles diagonally away leaves the house at ~0.308: below the
    // recovery threshold, above the dereliction floor. Neither timer may run.
    const state = quietCity()
    const house = put(state, 'house', 5, 5)
    put(state, 'factory', 7, 7)
    const h = computeField(state)[tileIndex(5, 5)]
    expect(h).toBeGreaterThan(DERELICT_HAPPINESS)
    expect(h).toBeLessThan(RECOVER_HAPPINESS)

    runUntil(state, 120)
    expect(house.derelict).toBe(false)
    expect(house.lowSince).toBeNull()

    // And a building that is already derelict stays derelict in the same band.
    const state2 = quietCity()
    const ruin = put(state2, 'house', 5, 5, true)
    put(state2, 'factory', 7, 7)
    runUntil(state2, 120)
    expect(ruin.derelict).toBe(true)
    expect(ruin.highSince).toBeNull()
  })

  it('recovers after RECOVER_DELAY above the recovery threshold', () => {
    const state = quietCity()
    const ruin = put(state, 'house', 5, 5, true)
    expect(computeField(state)[tileIndex(5, 5)]).toBeGreaterThan(RECOVER_HAPPINESS)

    step(state, SIM_DT)
    const highSince = ruin.highSince
    expect(highSince).not.toBeNull()

    runUntil(state, highSince! + RECOVER_DELAY - 1)
    expect(ruin.derelict).toBe(true)

    runUntil(state, highSince! + RECOVER_DELAY)
    expect(ruin.derelict).toBe(false)
  })

  it('never derelicts a hand-placed park or factory, however bad it gets', () => {
    const state = quietCity()
    const park = put(state, 'park', 5, 5)
    const factory = put(state, 'factory', 5, 6)
    put(state, 'factory', 6, 5)
    put(state, 'factory', 4, 5)
    const field = computeField(state)
    expect(field[tileIndex(5, 5)]).toBeLessThan(DERELICT_HAPPINESS)
    expect(field[tileIndex(5, 6)]).toBeLessThan(DERELICT_HAPPINESS)

    runUntil(state, DERELICT_DELAY * 4)
    expect(park.derelict).toBe(false)
    expect(factory.derelict).toBe(false)
  })

  it('keeps an unbuffered factory earning, which is the point of building one', () => {
    // A lone factory sits at 0.5 - 1.0, clamped to 0 — well under the floor. If it
    // could derelict it would shut itself down 30s after being placed, and the
    // whole "pays well regardless of happiness" temptation would silently vanish.
    const state = quietCity()
    const factory = put(state, 'factory', 5, 5)
    runUntil(state, DERELICT_DELAY * 3)
    expect(computeField(state)[tileIndex(5, 5)]).toBe(0)
    expect(factory.derelict).toBe(false)
  })
})
