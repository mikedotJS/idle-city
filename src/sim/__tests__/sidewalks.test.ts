import { describe, expect, it } from 'vitest'
import { createCity } from '../actions'
import { WORLD_SIZE } from '../config'
import { cornerIndex, computeRoads } from '../roads'
import { NX, NZ, PX, PZ, computeCrosswalks } from '../sidewalks'
import { flatten, put } from './helpers'
import type { CityState } from '../types'

/** Copy of the sim/renderer hash32, to pin which corners the coin flip keeps. */
function hash32(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** A flat city with every tile built on, so every interior corner is a crossroad. */
function fullCity(): CityState {
  const state = flatten(createCity(11))
  state.ownedParcels.fill(true)
  for (let z = 0; z < WORLD_SIZE; z++) {
    for (let x = 0; x < WORLD_SIZE; x++) put(state, 'house', x, z)
  }
  return state
}

/** Flanking tiles of the segment leaving corner (cx, cz) in direction bit d. */
function flanks(cx: number, cz: number, d: number): [number, number][] {
  switch (d) {
    case PX:
      return [
        [cx, cz],
        [cx, cz - 1],
      ]
    case NX:
      return [
        [cx - 1, cz],
        [cx - 1, cz - 1],
      ]
    case PZ:
      return [
        [cx, cz],
        [cx - 1, cz],
      ]
    default:
      return [
        [cx, cz - 1],
        [cx - 1, cz - 1],
      ]
  }
}

describe('computeCrosswalks', () => {
  it('gives an eligible crossroad all four crossings', () => {
    const state = fullCity()
    const mask = computeCrosswalks(state, computeRoads(state))

    let seen = 0
    for (let cz = 1; cz < WORLD_SIZE; cz++) {
      for (let cx = 1; cx < WORLD_SIZE; cx++) {
        if (((cx + cz) & 1) !== 0) continue
        const c = cornerIndex(cx, cz)
        if ((hash32(c) & 1) !== 0) continue
        seen++
        expect(mask[c]).toBe(PX | NX | PZ | NZ)
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('excludes a mere corner bend (degree 2)', () => {
    const state = flatten(createCity(11))
    state.ownedParcels.fill(true)
    put(state, 'house', 5, 5)
    const mask = computeCrosswalks(state, computeRoads(state))

    for (const [cx, cz] of [
      [5, 5],
      [6, 5],
      [5, 6],
      [6, 6],
    ]) {
      expect(mask[cornerIndex(cx, cz)]).toBe(0)
    }
  })

  it('never crosses toward a half-paved street (unowned flanking tile)', () => {
    const state = fullCity()
    state.ownedParcels[0] = false // tiles x 0-2, z 0-2 are no longer ours
    const mask = computeCrosswalks(state, computeRoads(state))

    const owned = (x: number, z: number): boolean =>
      x >= 0 && z >= 0 && x < WORLD_SIZE && z < WORLD_SIZE && (x >= 3 || z >= 3)
    for (let c = 0; c < mask.length; c++) {
      for (const d of [PX, NX, PZ, NZ]) {
        if ((mask[c] & d) === 0) continue
        const cx = c % (WORLD_SIZE + 1)
        const cz = Math.floor(c / (WORLD_SIZE + 1))
        for (const [x, z] of flanks(cx, cz, d)) expect(owned(x, z)).toBe(true)
      }
    }
    // And the rule really bit: some direction was refused for lack of ownership.
    const c33 = cornerIndex(3, 3)
    if (mask[c33] !== 0) expect(mask[c33] & (NX | NZ)).toBe(0)
  })

  it('is deterministic: same state, same mask', () => {
    const state = fullCity()
    const network = computeRoads(state)
    expect([...computeCrosswalks(state, network)]).toEqual([...computeCrosswalks(state, network)])
  })

  it('excludes corners off the checkerboard', () => {
    const state = fullCity()
    const mask = computeCrosswalks(state, computeRoads(state))
    for (let c = 0; c < mask.length; c++) {
      const cx = c % (WORLD_SIZE + 1)
      const cz = Math.floor(c / (WORLD_SIZE + 1))
      if (((cx + cz) & 1) !== 0) expect(mask[c]).toBe(0)
    }
  })
})
