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
import { blockCells } from '../merge'
import type { CityState } from '../types'
import { put, quietCity } from './helpers'

const EPS = 1e-9
const ANCHOR = tileIndex(5, 5) // 65
const CELLS = blockCells(ANCHOR)

/** Step until sim time reaches `until` seconds. */
function runUntil(state: CityState, until: number): void {
  while (state.time < until - EPS) step(state, SIM_DT)
}

/** Four level-1 houses merged by hand into the block anchored at (5,5). */
function mergedHouses(state: CityState, derelict = false): void {
  for (const [x, z] of [
    [5, 5],
    [6, 5],
    [5, 6],
    [6, 6],
  ]) {
    put(state, 'house', x, z, derelict).mergeAnchor = ANCHOR
  }
}

describe('merged block dereliction', () => {
  it('flips all four cells together when only one tile drops below the floor', () => {
    const state = quietCity()
    mergedHouses(state)
    // Only tile 78 (6,6) falls under DERELICT_HAPPINESS; the other three stay
    // above the floor, so a per-building rule would touch nothing else.
    put(state, 'factory', 8, 7)
    const field = computeField(state)
    expect(field[tileIndex(6, 6)]).toBeLessThan(DERELICT_HAPPINESS)
    for (const cell of [tileIndex(5, 5), tileIndex(6, 5), tileIndex(5, 6)]) {
      expect(field[cell]).toBeGreaterThan(DERELICT_HAPPINESS)
    }

    step(state, SIM_DT)
    const anchor = state.grid[ANCHOR]!
    expect(anchor.lowSince).not.toBeNull()
    for (const cell of [tileIndex(6, 5), tileIndex(5, 6), tileIndex(6, 6)]) {
      expect(state.grid[cell]!.lowSince).toBeNull()
    }

    runUntil(state, anchor.lowSince! + DERELICT_DELAY - 1)
    for (const cell of CELLS) expect(state.grid[cell]!.derelict).toBe(false)

    runUntil(state, anchor.lowSince! + DERELICT_DELAY)
    for (const cell of CELLS) expect(state.grid[cell]!.derelict).toBe(true)
    for (const cell of CELLS) {
      expect(state.grid[cell]!.lowSince).toBeNull()
      expect(state.grid[cell]!.highSince).toBeNull()
    }

    const events = state.events.filter((e) => e.kind === 'derelict')
    expect(events).toHaveLength(1)
    expect(events[0].where).toBe(ANCHOR)
  })

  it('does not recover while one tile is still below the recovery threshold', () => {
    const state = quietCity()
    mergedHouses(state, true)
    // Tile 78 sits at ~0.308, between the thresholds; the other three are at
    // the 0.5 base. Three tiles back is not enough: the block waits for all four.
    put(state, 'factory', 8, 8)
    const field = computeField(state)
    expect(field[tileIndex(6, 6)]).toBeGreaterThan(DERELICT_HAPPINESS)
    expect(field[tileIndex(6, 6)]).toBeLessThan(RECOVER_HAPPINESS)

    runUntil(state, RECOVER_DELAY * 4)
    for (const cell of CELLS) expect(state.grid[cell]!.derelict).toBe(true)
    expect(state.events.filter((e) => e.kind === 'recovered')).toHaveLength(0)
  })

  it('recovers all four cells together once every tile is back', () => {
    const state = quietCity()
    mergedHouses(state, true)
    for (const cell of CELLS) {
      expect(computeField(state)[cell]).toBeGreaterThan(RECOVER_HAPPINESS)
    }

    step(state, SIM_DT)
    const anchor = state.grid[ANCHOR]!
    expect(anchor.highSince).not.toBeNull()

    runUntil(state, anchor.highSince! + RECOVER_DELAY - 1)
    for (const cell of CELLS) expect(state.grid[cell]!.derelict).toBe(true)

    runUntil(state, anchor.highSince! + RECOVER_DELAY)
    for (const cell of CELLS) expect(state.grid[cell]!.derelict).toBe(false)

    const events = state.events.filter((e) => e.kind === 'recovered')
    expect(events).toHaveLength(1)
    expect(events[0].where).toBe(ANCHOR)
  })

  it('never emits events for the non-anchor cells of a block', () => {
    const state = quietCity()
    mergedHouses(state)
    put(state, 'factory', 8, 7)
    runUntil(state, DERELICT_DELAY * 3)
    for (const e of state.events) {
      expect(e.where).toBe(ANCHOR)
    }
  })

  it('leaves unmerged buildings on the per-building rule', () => {
    const state = quietCity()
    const crushed = put(state, 'house', 5, 5)
    const fine = put(state, 'house', 5, 8)
    put(state, 'factory', 4, 5)
    expect(computeField(state)[tileIndex(5, 5)]).toBeLessThan(DERELICT_HAPPINESS)
    expect(computeField(state)[tileIndex(5, 8)]).toBeGreaterThan(RECOVER_HAPPINESS)

    runUntil(state, DERELICT_DELAY * 2)
    expect(crushed.derelict).toBe(true)
    expect(fine.derelict).toBe(false)
    const events = state.events.filter((e) => e.kind === 'derelict')
    expect(events).toHaveLength(1)
    expect(events[0].where).toBe(tileIndex(5, 5))
  })
})
