import { describe, expect, it } from 'vitest'
import { createCity, placeManual } from '../actions'
import { flatten, put } from './helpers'
import { WORLD_SIZE } from '../config'
import { tileIndex } from '../grid'
import { CORNERS_PER_SIDE, computeRoads, cornerIndex, cornerToWorld, neighboursOf } from '../roads'
import type { CityState } from '../types'

/** A flat city with the whole board owned, so nothing else confuses a case. */
function openCity(): CityState {
  const state = flatten(createCity(11))
  state.ownedParcels.fill(true)
  state.coins = 1e9
  return state
}

describe('computeRoads', () => {
  it('paves nothing on an empty plot', () => {
    expect(computeRoads(openCity()).segmentCount).toBe(0)
  })

  it('rings a lone building with exactly four segments', () => {
    const state = openCity()
    placeManual(state, 'park', tileIndex(5, 5))
    const roads = computeRoads(state)
    expect(roads.segmentCount).toBe(4)

    // Every corner of that tile carries two of them.
    for (const [cx, cz] of [
      [5, 5],
      [6, 5],
      [5, 6],
      [6, 6],
    ]) {
      expect(neighboursOf(roads, cornerIndex(cx, cz)).length).toBe(2)
    }
  })

  it('shares the seam between two neighbours instead of doubling it', () => {
    const state = openCity()
    placeManual(state, 'park', tileIndex(5, 5))
    placeManual(state, 'park', tileIndex(6, 5))
    // Seven, not eight: the shared edge is one street, not two.
    expect(computeRoads(state).segmentCount).toBe(7)
  })

  it('leaves every corner reachable from its neighbours both ways', () => {
    const state = openCity()
    placeManual(state, 'park', tileIndex(4, 4))
    placeManual(state, 'factory', tileIndex(5, 4))
    const roads = computeRoads(state)

    for (let i = 0; i < roads.segmentCount; i++) {
      const a = roads.segments[i * 2]
      const b = roads.segments[i * 2 + 1]
      expect([...neighboursOf(roads, a)]).toContain(b)
      expect([...neighboursOf(roads, b)]).toContain(a)
    }
  })

  it('lists only corners that actually carry a street', () => {
    const state = openCity()
    placeManual(state, 'park', tileIndex(0, 0))
    const roads = computeRoads(state)
    expect([...roads.connectedCorners].sort((x, y) => x - y)).toEqual(
      [cornerIndex(0, 0), cornerIndex(1, 0), cornerIndex(0, 1), cornerIndex(1, 1)].sort(
        (x, y) => x - y,
      ),
    )
  })

  it('puts corner (0,0) at the far corner of the centred plot', () => {
    expect(cornerToWorld(cornerIndex(0, 0))).toEqual({ x: -WORLD_SIZE / 2, z: -WORLD_SIZE / 2 })
    const far = cornerIndex(CORNERS_PER_SIDE - 1, CORNERS_PER_SIDE - 1)
    expect(cornerToWorld(far)).toEqual({ x: WORLD_SIZE / 2, z: WORLD_SIZE / 2 })
  })

  it('paves no seam inside a merged block, but still rings it', () => {
    const state = openCity()
    const anchor = tileIndex(5, 5)
    for (const [x, z] of [
      [5, 5],
      [6, 5],
      [5, 6],
      [6, 6],
    ]) {
      const b = put(state, 'house', x, z)
      b.level = 3
      b.mergeAnchor = anchor
    }
    const roads = computeRoads(state)

    const hasSegment = (a: number, b: number): boolean => {
      for (let i = 0; i < roads.segmentCount; i++) {
        const s = roads.segments[i * 2]
        const t = roads.segments[i * 2 + 1]
        if ((s === a && t === b) || (s === b && t === a)) return true
      }
      return false
    }

    // The four internal seams of the 2x2 block stay bare.
    expect(hasSegment(cornerIndex(6, 5), cornerIndex(6, 6))).toBe(false)
    expect(hasSegment(cornerIndex(6, 6), cornerIndex(6, 7))).toBe(false)
    expect(hasSegment(cornerIndex(5, 6), cornerIndex(6, 6))).toBe(false)
    expect(hasSegment(cornerIndex(6, 6), cornerIndex(7, 6))).toBe(false)

    // Border seams still pave, so the network routes around the block.
    expect(hasSegment(cornerIndex(5, 5), cornerIndex(6, 5))).toBe(true)
    expect(hasSegment(cornerIndex(5, 5), cornerIndex(5, 6))).toBe(true)
    expect(hasSegment(cornerIndex(7, 6), cornerIndex(7, 7))).toBe(true)
    expect(hasSegment(cornerIndex(6, 7), cornerIndex(7, 7))).toBe(true)

    // A lone 2x2 block keeps its full ring: 4 sides x 2 segments.
    expect(roads.segmentCount).toBe(8)
  })

  it('stays inside the lattice at the board edge', () => {
    const state = openCity()
    placeManual(state, 'park', tileIndex(WORLD_SIZE - 1, WORLD_SIZE - 1))
    const roads = computeRoads(state)
    for (const corner of roads.segments) {
      expect(corner).toBeGreaterThanOrEqual(0)
      expect(corner).toBeLessThan(CORNERS_PER_SIDE * CORNERS_PER_SIDE)
    }
  })
})
