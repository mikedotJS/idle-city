/**
 * The street network, derived from the grid.
 *
 * Roads are decoration, not a mechanic. DESIGN.md keeps road access out of
 * scope deliberately: a second constraint competing with pollution would
 * dilute the one decision the game is about. So streets cost nothing, block
 * nothing, and are never saved — they are recomputed from the layout, exactly
 * like the happiness field.
 *
 * They run along the SEAMS BETWEEN TILES rather than on tiles. A road that
 * occupied a tile would eat buildable space and quietly change the economy;
 * a road on the boundary is free. Streets appear wherever a building has gone
 * up beside them, so the network paves itself as the city grows.
 *
 * Geometry is expressed in CORNER coordinates: a lattice of (WORLD_SIZE + 1)^2
 * points at tile corners, indexed cz * (WORLD_SIZE + 1) + cx.
 */

import { WORLD_SIZE } from './config'
import { tileIndex } from './grid'
import { isBuildable, terrainFor } from './terrain'
import type { CityState } from './types'

export const CORNERS_PER_SIDE = WORLD_SIZE + 1
export const CORNER_COUNT = CORNERS_PER_SIDE * CORNERS_PER_SIDE

export interface RoadNetwork {
  /** Corner-index pairs, two entries per segment: [a0, b0, a1, b1, ...]. */
  segments: Int32Array
  segmentCount: number
  /** CSR adjacency over corners: neighbours of n are adjacency[start[n]..start[n+1]]. */
  adjacencyStart: Int32Array
  adjacency: Int32Array
  /** Corners with at least one road, for picking somewhere to spawn. */
  connectedCorners: Int32Array
}

export function cornerIndex(cx: number, cz: number): number {
  return cz * CORNERS_PER_SIDE + cx
}

export function cornerX(index: number): number {
  return index % CORNERS_PER_SIDE
}

export function cornerZ(index: number): number {
  return Math.floor(index / CORNERS_PER_SIDE)
}

/** World-space position of a corner. The plot is centred on the origin. */
export function cornerToWorld(index: number): { x: number; z: number } {
  const half = WORLD_SIZE / 2
  return { x: cornerX(index) - half, z: cornerZ(index) - half }
}

function isBuilt(state: CityState, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= WORLD_SIZE || z >= WORLD_SIZE) return false
  return state.grid[tileIndex(x, z)] !== null
}

/** No tarmac across a lake or over a peak, whatever stands beside it. */
function isPaveable(state: CityState, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= WORLD_SIZE || z >= WORLD_SIZE) return false
  return isBuildable(terrainFor(state), tileIndex(x, z))
}

/**
 * A seam becomes a street when a building stands on either side of it, so the
 * network traces the built-up edge of the city and nothing else. An empty plot
 * has no roads at all, which is the correct look: bare ground, no infrastructure.
 */
export function computeRoads(state: CityState): RoadNetwork {
  const pairs: number[] = []
  const degree = new Int32Array(CORNER_COUNT)

  const add = (a: number, b: number): void => {
    pairs.push(a, b)
    degree[a]++
    degree[b]++
  }

  // Seams running east-west, between tile rows (cz - 1) and cz.
  for (let cz = 0; cz < CORNERS_PER_SIDE; cz++) {
    for (let cx = 0; cx < WORLD_SIZE; cx++) {
      const northOk = isBuilt(state, cx, cz - 1) && isPaveable(state, cx, cz - 1)
      const southOk = isBuilt(state, cx, cz) && isPaveable(state, cx, cz)
      if (northOk || southOk) {
        add(cornerIndex(cx, cz), cornerIndex(cx + 1, cz))
      }
    }
  }

  // Seams running north-south, between tile columns (cx - 1) and cx.
  for (let cz = 0; cz < WORLD_SIZE; cz++) {
    for (let cx = 0; cx < CORNERS_PER_SIDE; cx++) {
      const westOk = isBuilt(state, cx - 1, cz) && isPaveable(state, cx - 1, cz)
      const eastOk = isBuilt(state, cx, cz) && isPaveable(state, cx, cz)
      if (westOk || eastOk) {
        add(cornerIndex(cx, cz), cornerIndex(cx, cz + 1))
      }
    }
  }

  const adjacencyStart = new Int32Array(CORNER_COUNT + 1)
  for (let i = 0; i < CORNER_COUNT; i++) adjacencyStart[i + 1] = adjacencyStart[i] + degree[i]

  const cursor = adjacencyStart.slice(0, CORNER_COUNT)
  const adjacency = new Int32Array(pairs.length)
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i]
    const b = pairs[i + 1]
    adjacency[cursor[a]++] = b
    adjacency[cursor[b]++] = a
  }

  const connected: number[] = []
  for (let i = 0; i < CORNER_COUNT; i++) if (degree[i] > 0) connected.push(i)

  return {
    segments: Int32Array.from(pairs),
    segmentCount: pairs.length / 2,
    adjacencyStart,
    adjacency,
    connectedCorners: Int32Array.from(connected),
  }
}

/** Neighbours of a corner, as corner indices. */
export function neighboursOf(network: RoadNetwork, corner: number): Int32Array {
  return network.adjacency.subarray(network.adjacencyStart[corner], network.adjacencyStart[corner + 1])
}
