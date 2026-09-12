/**
 * Crosswalk placement, derived from the road network and owned land.
 *
 * A crosswalk is painted across a street at a junction corner, in a direction
 * where both tarmac halves are real (both flanking tiles owned — the same
 * "never float" rule the sidewalk ribbons follow). Like every other derived
 * module, nothing here is stored in state or saved: it is recomputed from the
 * layout, and the result is a per-corner direction bitmask in the exact shape
 * of the road renderer's `dirs` (PX/NX/PZ/NZ), so task 3 can read it corner
 * by corner without translation.
 */

import { WORLD_SIZE } from './config'
import { parcelOfTile, tileIndex } from './grid'
import { CORNER_COUNT, cornerX, cornerZ, type RoadNetwork } from './roads'
import type { CityState } from './types'

// Direction bits on a corner. Same values as src/render/roads.ts (PX/NX/PZ/NZ),
// duplicated because the sim must never import the renderer.
export const PX = 1
export const NX = 2
export const PZ = 4
export const NZ = 8

/**
 * Cheap integer mix — a copy of the hash32 in src/render/roads.ts, so the sim
 * and the renderer pick the same deterministic subsets of corners (lamps there,
 * crosswalks here) without sharing code across the sim/render boundary.
 */
function hash32(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

function isOwned(state: CityState, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= WORLD_SIZE || z >= WORLD_SIZE) return false
  return state.ownedParcels[parcelOfTile(tileIndex(x, z))]
}

/**
 * Bitmask per corner of the directions in which a crosswalk may be painted.
 *
 * A corner qualifies only when it is a genuine junction (degree >= 3 — a
 * crossroad or a T, never a bend or a straight), sits on the even checkerboard
 * (same spacing trick as the lamps, so two crossings never touch), and passes
 * hash32 — a stable coin flip that keeps about one junction in two striped. A
 * direction then qualifies when the segment exists and BOTH tiles flanking it
 * are owned: a zebra must not float over a half-paved street.
 */
export function computeCrosswalks(state: CityState, network: RoadNetwork): Uint8Array {
  // Rebuild the renderer's `dirs`: which directions have a segment per corner.
  const dirs = new Uint8Array(CORNER_COUNT)
  for (let s = 0; s < network.segmentCount; s++) {
    const a = network.segments[s * 2]
    const b = network.segments[s * 2 + 1]
    if (cornerZ(a) === cornerZ(b)) {
      const lo = cornerX(a) < cornerX(b) ? a : b
      const hi = lo === a ? b : a
      dirs[lo] |= PX
      dirs[hi] |= NX
    } else {
      const lo = cornerZ(a) < cornerZ(b) ? a : b
      const hi = lo === a ? b : a
      dirs[lo] |= PZ
      dirs[hi] |= NZ
    }
  }

  const out = new Uint8Array(CORNER_COUNT)
  for (let c = 0; c < CORNER_COUNT; c++) {
    const d = dirs[c]
    if (d === 0) continue
    const degree = network.adjacencyStart[c + 1] - network.adjacencyStart[c]
    if (degree < 3) continue
    const cx = cornerX(c)
    const cz = cornerZ(c)
    if (((cx + cz) & 1) !== 0) continue
    if ((hash32(c) & 1) !== 0) continue

    let mask = 0
    // Both flanking tiles owned, on each direction that really has a street.
    if (d & PX && isOwned(state, cx, cz) && isOwned(state, cx, cz - 1)) mask |= PX
    if (d & NX && isOwned(state, cx - 1, cz) && isOwned(state, cx - 1, cz - 1)) mask |= NX
    if (d & PZ && isOwned(state, cx, cz) && isOwned(state, cx - 1, cz)) mask |= PZ
    if (d & NZ && isOwned(state, cx, cz - 1) && isOwned(state, cx - 1, cz - 1)) mask |= NZ
    out[c] = mask
  }
  return out
}
