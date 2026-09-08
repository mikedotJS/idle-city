import { describe, expect, it } from 'vitest'
import { computeField } from '../field'
import { BASE_HAPPINESS, TILE_COUNT } from '../config'
import { BUILDINGS } from '../buildings'
import { tileIndex } from '../grid'
import { put, quietCity } from './helpers'

const PARK = BUILDINGS.park.emit!
const FACTORY = BUILDINGS.factory.emit!

describe('computeField', () => {
  it('is BASE_HAPPINESS everywhere with no emitters', () => {
    const field = computeField(quietCity())
    expect(field.length).toBe(TILE_COUNT)
    for (const v of field) expect(v).toBe(BASE_HAPPINESS)
  })

  it('falls off linearly with euclidean distance', () => {
    const state = quietCity()
    put(state, 'park', 5, 5)
    const field = computeField(state)

    const at = (x: number, z: number) => field[tileIndex(x, z)]
    const clamp = (v: number) => Math.min(1, Math.max(0, v))
    // strength * max(0, 1 - dist / range), range 2.5, strength 0.8
    expect(at(5, 5)).toBeCloseTo(clamp(BASE_HAPPINESS + PARK.strength), 6)
    expect(at(6, 5)).toBeCloseTo(clamp(BASE_HAPPINESS + PARK.strength * (1 - 1 / PARK.range)), 6)
    expect(at(7, 5)).toBeCloseTo(clamp(BASE_HAPPINESS + PARK.strength * (1 - 2 / PARK.range)), 6)
    // Diagonal: distance sqrt(2), not 2.
    expect(at(6, 6)).toBeCloseTo(
      clamp(BASE_HAPPINESS + PARK.strength * (1 - Math.SQRT2 / PARK.range)),
      6,
    )
  })

  it('gives nothing at or beyond the range edge', () => {
    const state = quietCity()
    put(state, 'park', 5, 5)
    const field = computeField(state)
    // range 2.5, so 3 tiles away is outside it entirely.
    expect(field[tileIndex(8, 5)]).toBe(BASE_HAPPINESS)
    expect(field[tileIndex(5, 8)]).toBe(BASE_HAPPINESS)
  })

  it('stacks contributions from two parks', () => {
    const state = quietCity()
    put(state, 'park', 4, 5)
    put(state, 'park', 6, 5)
    const field = computeField(state)

    const one = PARK.strength * (1 - 1 / PARK.range)
    expect(field[tileIndex(5, 5)]).toBeCloseTo(Math.min(1, BASE_HAPPINESS + one * 2), 6)
    // Two parks half-cover a factory: net contribution stacks arithmetically.
    const state2 = quietCity()
    put(state2, 'factory', 5, 5)
    put(state2, 'park', 4, 5)
    put(state2, 'park', 6, 5)
    const f2 = computeField(state2)
    const expected = BASE_HAPPINESS + FACTORY.strength + one * 2
    expect(f2[tileIndex(5, 5)]).toBeCloseTo(Math.max(0, expected), 6)
  })

  it('clamps to 0..1', () => {
    const state = quietCity()
    put(state, 'factory', 5, 5)
    put(state, 'factory', 5, 6)
    const dark = computeField(state)
    expect(dark[tileIndex(5, 5)]).toBe(0)

    const bright = quietCity()
    put(bright, 'park', 5, 5)
    put(bright, 'park', 5, 5 + 1)
    put(bright, 'park', 5, 5 - 1)
    const f = computeField(bright)
    expect(f[tileIndex(5, 5)]).toBe(1)
  })

  it('emits regardless of the derelict flag, since emitters never carry one', () => {
    const polluted = quietCity()
    put(polluted, 'factory', 5, 5, true)
    // 0.5 - 0.71 clamps to 0 on the near tile, so read two tiles out where the
    // sum is still positive.
    expect(computeField(polluted)[tileIndex(7, 5)]).toBeCloseTo(
      BASE_HAPPINESS + FACTORY.strength * (1 - 2 / FACTORY.range),
      6,
    )
    expect(computeField(polluted)[tileIndex(6, 5)]).toBe(0)

    const wilted = quietCity()
    put(wilted, 'park', 5, 5, true)
    expect(computeField(wilted)[tileIndex(6, 5)]).toBeGreaterThan(BASE_HAPPINESS)
  })
})
