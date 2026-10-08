/**
 * Decor anchor placement: derives WHERE ambient street furniture and yard
 * props may stand, from the same road network, ownership and terrain rules
 * sidewalks.ts and render/traffic.ts already use. Pure data — nothing here
 * renders (src/sim never imports three.js), and nothing here is stored: like
 * every other derived module (roads, crosswalks, the happiness field), it is
 * recomputed from state and a seed, never saved.
 *
 * Four anchor classes, each aimed at a different later prop:
 *  - kerb: a slot along a street segment's kerb line (mailboxes, hydrants,
 *    bins) — the lateral offset a lamp post already proves safe.
 *  - corner: a slot in a junction's apron quadrant, for furniture that reads
 *    as belonging to the corner rather than mid-block.
 *  - yard: the centre of an owned, buildable tile that is currently empty and
 *    so free for a standalone prop (a tree, a bench) until something is built
 *    there.
 *  - edge-run: points along a yard tile's four edges, for a later fence/wall
 *    task to walk without re-deriving tile geometry itself.
 */

import { WORLD_SIZE } from './config'
import { parcelOfTile, tileIndex, tileToWorld, tileX, tileZ } from './grid'
import { computeRoads, CORNER_COUNT, cornerToWorld, cornerX, cornerZ, type RoadNetwork } from './roads'
import { hash32, NX, NZ, PX, PZ } from './sidewalks'
import { isBuildable, terrainFor } from './terrain'
import type { BuildingType, CityState } from './types'

export type DecorAnchorKind = 'kerb' | 'corner' | 'yard' | 'edge-run'

export interface DecorAnchor {
  kind: DecorAnchorKind
  x: number
  z: number
  yaw: number
  /** Stable per-anchor seed, for the renderer to pick a variant/scale/tint. */
  seed: number
  /**
   * The building type of the tile this anchor stands in front of, if any —
   * lets the renderer restrict a prop to a specific building type (e.g. a
   * mailbox only in front of a house). Undefined for anchors with no single
   * flanking tile (corner) or no building there at all.
   */
  buildingType?: BuildingType
}

/**
 * Copy of the CLEARANCE table in src/render/traffic.ts: how much room each
 * building type leaves between the tile seam and its own bulk. src/sim can
 * never import src/render, so this is a duplicate on purpose (the same trade
 * sidewalks.ts already makes for hash32) — keep the two in sync if a building
 * silhouette changes.
 */
export const CLEARANCE: Record<BuildingType, number> = {
  house: 0.19,
  shop: 0.16,
  factory: 0.13,
  park: 0.04,
  station: 0.14,
  school: 0.09,
  harbour: 0.1,
  landfill: 0.18,
}
/** An empty tile takes nothing; a prop may stand anywhere on bare ground. */
export const OPEN_CLEARANCE = 0.5

/**
 * Lateral offset from the seam, in tiles. Matches LAMP_SIDE in
 * src/render/roads.ts — the one offset already proven to clear the tarmac
 * (0.1 either side of the seam) and to sit inboard of the pedestrian lane
 * (0.125-0.145 in src/render/traffic.ts), so kerb decor never stands in a
 * walking pedestrian's way. It still has to pass the clearance check per tile
 * below: it is only safe next to a specific building when that building's own
 * clearance reaches at least this far.
 */
const KERB_OFFSET = 0.105

/**
 * Diagonal offset from a junction corner into one of its quadrants, in tiles
 * per axis. Sits between the junction pad's half-width (0.11) and the
 * sidewalk's outer edge (0.19) in src/render/roads.ts, so a corner anchor
 * reads as standing on the apron rather than in the street or over the lawn.
 */
const CORNER_OFFSET = 0.15

/**
 * How far in from a tile's centre an edge-run point sits. Just short of the
 * true tile boundary (0.5) so a fence reads as running along the edge while
 * staying unambiguously inside the tile it belongs to — exactly on the seam,
 * rounding to a tile is a coin flip, and at the outer rim of the map it can
 * round to a coordinate half a tile beyond the last row entirely.
 */
const EDGE_OFFSET = 0.49

function isOwned(state: CityState, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= WORLD_SIZE || z >= WORLD_SIZE) return false
  return state.ownedParcels[parcelOfTile(tileIndex(x, z))]
}

/**
 * Owned, buildable (no water, no sand/beach) and — when a building stands
 * there — not part of a merged 2x2 block. A maxi building's real footprint
 * and clearance are not modelled by the CLEARANCE table below (that table is
 * per single-tile silhouette), so rather than guess, no anchor is ever
 * placed flanking or on one of its four cells.
 */
function isUsable(state: CityState, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= WORLD_SIZE || z >= WORLD_SIZE) return false
  if (!isOwned(state, x, z)) return false
  if (!isBuildable(terrainFor(state), tileIndex(x, z))) return false
  const b = state.grid[tileIndex(x, z)]
  if (b && b.mergeAnchor !== null) return false
  return true
}

/** How much lateral room the tile at (x, z) leaves before its own building wall. */
function clearanceAt(state: CityState, x: number, z: number): number {
  if (x < 0 || z < 0 || x >= WORLD_SIZE || z >= WORLD_SIZE) return OPEN_CLEARANCE
  const b = state.grid[tileIndex(x, z)]
  return b ? CLEARANCE[b.type] : OPEN_CLEARANCE
}

/** Which directions have a real street segment leaving each corner. */
function cornerDirs(network: RoadNetwork): Uint8Array {
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
  return dirs
}

/**
 * Kerb anchors: one candidate per side of each street segment, at the fixed
 * KERB_OFFSET from the seam, kept only where the flanking tile is owned,
 * buildable and leaves at least KERB_OFFSET of clearance — the same test
 * render/traffic.ts runs to keep a pedestrian off a building wall.
 */
function kerbAnchors(state: CityState, network: RoadNetwork, seed: number, out: DecorAnchor[]): void {
  for (let s = 0; s < network.segmentCount; s++) {
    const a = network.segments[s * 2]
    const b = network.segments[s * 2 + 1]
    const w0 = cornerToWorld(a)
    const w1 = cornerToWorld(b)
    const dx = w1.x - w0.x
    const dz = w1.z - w0.z
    // Right-hand normal of the segment direction (segments are unit length).
    const nx = -dz
    const nz = dx
    const midX = (w0.x + w1.x) / 2
    const midZ = (w0.z + w1.z) / 2

    for (const sign of [1, -1]) {
      // The tile the segment's midpoint, stepped half a tile along the
      // normal, lands inside — the same construction as sideClearance() in
      // src/render/traffic.ts.
      const tx = Math.floor((cornerX(a) + cornerX(b)) * 0.5 + (nx * sign) * 0.5)
      const tz = Math.floor((cornerZ(a) + cornerZ(b)) * 0.5 + (nz * sign) * 0.5)
      if (!isUsable(state, tx, tz)) continue
      if (clearanceAt(state, tx, tz) < KERB_OFFSET) continue

      const x = midX + nx * sign * KERB_OFFSET
      const z = midZ + nz * sign * KERB_OFFSET
      const yaw = Math.atan2(nz * sign, nx * sign)
      const building = state.grid[tileIndex(tx, tz)]
      out.push({
        kind: 'kerb',
        x,
        z,
        yaw,
        seed: hash32((a * 4 + (sign > 0 ? 1 : 2)) ^ seed),
        buildingType: building?.type,
      })
    }
  }
}

/**
 * Corner anchors: one candidate per owned quadrant of every real junction
 * (degree >= 3, the same "real crossroad" test computeCrosswalks() applies),
 * offset diagonally onto the apron and clearance-checked the same way kerb
 * anchors are.
 */
function cornerAnchors(state: CityState, network: RoadNetwork, seed: number, out: DecorAnchor[]): void {
  const dirs = cornerDirs(network)
  const cornersPerSide = WORLD_SIZE + 1
  for (let c = 0; c < dirs.length; c++) {
    const d = dirs[c]
    if (d === 0) continue
    const degree = network.adjacencyStart[c + 1] - network.adjacencyStart[c]
    if (degree < 3) continue
    const cx = c % cornersPerSide
    const cz = Math.floor(c / cornersPerSide)
    const w = cornerToWorld(c)

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const alongX = sx > 0 ? d & PX : d & NX
        const alongZ = sz > 0 ? d & PZ : d & NZ
        if (!alongX && !alongZ) continue
        const tx = sx > 0 ? cx : cx - 1
        const tz = sz > 0 ? cz : cz - 1
        if (!isUsable(state, tx, tz)) continue
        if (clearanceAt(state, tx, tz) < CORNER_OFFSET) continue

        const x = w.x + sx * CORNER_OFFSET
        const z = w.z + sz * CORNER_OFFSET
        const yaw = Math.atan2(-sz, -sx)
        out.push({ kind: 'corner', x, z, yaw, seed: hash32((c * 4 + (sx > 0 ? 1 : 0) * 2 + (sz > 0 ? 1 : 0)) ^ seed) })
      }
    }
  }
}

/**
 * Yard anchors: the centre of every owned, buildable, currently-empty tile.
 * An empty tile can never be part of a merged 2x2 block — a merge requires a
 * building on all four cells — so that exclusion holds automatically here.
 */
function yardAnchors(state: CityState, seed: number, out: DecorAnchor[]): void {
  for (let z = 0; z < WORLD_SIZE; z++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const tile = tileIndex(x, z)
      if (state.grid[tile] !== null) continue
      if (!isUsable(state, x, z)) continue
      const w = tileToWorld(tile)
      const h = hash32(tile ^ seed)
      out.push({ kind: 'yard', x: w.x, z: w.z, yaw: (h % 360) * (Math.PI / 180), seed: h })
    }
  }
}

/** The four edge midpoints of a yard tile, spaced for a later fence to run along. */
const EDGE_DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/**
 * Edge-run anchors: points along the boundary of every yard tile, one per
 * side, for a later fence/wall task. Since each point sits on the boundary of
 * a tile already proven owned, buildable and empty, it inherits those same
 * guarantees without re-checking them.
 */
function edgeRunAnchors(state: CityState, seed: number, out: DecorAnchor[]): void {
  for (let z = 0; z < WORLD_SIZE; z++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const tile = tileIndex(x, z)
      if (state.grid[tile] !== null) continue
      if (!isUsable(state, x, z)) continue
      const w = tileToWorld(tile)
      for (const [dx, dz] of EDGE_DIRS) {
        const h = hash32((tile * 4 + (dx > 0 ? 0 : dx < 0 ? 1 : dz > 0 ? 2 : 3)) ^ seed)
        const x2 = w.x + dx * EDGE_OFFSET
        const z2 = w.z + dz * EDGE_OFFSET
        // A fence runs ALONG the edge, so it faces perpendicular to the
        // direction that reached this edge.
        const yaw = Math.atan2(dx, -dz) + Math.PI / 2
        out.push({ kind: 'edge-run', x: x2, z: z2, yaw, seed: h })
      }
    }
  }
}

/**
 * All decor anchors for the current layout. Deterministic in `state` and
 * `seed`: same inputs, same array, every call — nothing here reads the clock
 * or any RNG stream, so it is safe to call every frame or once and cache.
 */
export function computeDecorAnchors(
  state: CityState,
  seed: number,
  network: RoadNetwork = computeRoads(state),
): DecorAnchor[] {
  const out: DecorAnchor[] = []
  kerbAnchors(state, network, seed, out)
  cornerAnchors(state, network, seed, out)
  yardAnchors(state, seed, out)
  edgeRunAnchors(state, seed, out)
  return out
}

// Re-exported so callers/tests can walk tile coordinates without importing
// grid.ts separately for these two.
export { tileX, tileZ }
