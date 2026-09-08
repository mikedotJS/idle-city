import { describe, expect, it } from 'vitest'
import { createCity, placeManual } from '../actions'
import { flatten } from './helpers'
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
