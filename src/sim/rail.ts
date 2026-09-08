/**
 * The railway, derived from where the stations are.
 *
 * Same posture as the streets: decoration computed from the layout, never
 * stored, costing nothing and blocking nothing. Stations are the only part
 * that touches the simulation, and they do it the way every other hand-placed
 * building does — by emitting into the happiness field. No second constraint.
 *
 * Track runs on the corner lattice, exactly like roads, so the two networks
 * share a coordinate system and a renderer can lay them out together. Unlike
 * roads it is allowed to cross water and mountain: a line that stopped at the
 * shore would need a station on every island, and a bridge is the better
 * looking answer anyway.
 */

import { WORLD_SIZE } from './config'
import { tileX, tileZ } from './grid'
import { cornerIndex, type RoadNetwork } from './roads'
import type { CityState } from './types'

export interface RailNetwork {
  /** Corner-index pairs, two per segment, matching RoadNetwork.segments. */
  segments: Int32Array
  segmentCount: number
  /**
   * One ordered corner path per leg of the line, for trains to run along.
   * Empty until a second station exists — one station is a stop, not a route.
   */
  lines: Int32Array[]
  /** Tile indices carrying a station, in the order the line visits them. */
  stations: number[]
}

const EMPTY: RailNetwork = {
  segments: new Int32Array(0),
  segmentCount: 0,
  lines: [],
  stations: [],
}

/** The lattice corner at a tile's north-west, where its track joins. */
function cornerOfTile(tile: number): number {
  return cornerIndex(tileX(tile), tileZ(tile))
}

/**
 * An L-shaped path between two corners: all the way along x, then along z.
 * Manhattan rather than diagonal because track drawn on a square lattice reads
 * as track, and a diagonal across tile corners reads as a mistake.
 */
function elbowPath(from: number, to: number): number[] {
  const stride = WORLD_SIZE + 1
  const fx = from % stride
  const fz = Math.floor(from / stride)
  const tx = to % stride
  const tz = Math.floor(to / stride)

  const path: number[] = [from]
  const stepX = Math.sign(tx - fx)
  for (let x = fx; x !== tx; x += stepX) path.push((x + stepX) + fz * stride)
  const stepZ = Math.sign(tz - fz)
  for (let z = fz; z !== tz; z += stepZ) path.push(tx + (z + stepZ) * stride)
  return path
}

export function computeRail(state: CityState): RailNetwork {
  const stations: number[] = []
  for (let i = 0; i < state.grid.length; i++) {
    if (state.grid[i]?.type === 'station') stations.push(i)
  }
  if (stations.length < 2) {
    return stations.length === 1 ? { ...EMPTY, stations } : EMPTY
  }

  // Chained in tile order, which is deterministic and stable: adding a station
  // in the middle of the map reroutes one leg rather than redrawing the line.
  stations.sort((a, b) => a - b)

  const pairs: number[] = []
  const lines: Int32Array[] = []
  const seen = new Set<number>()

  for (let i = 0; i + 1 < stations.length; i++) {
    const path = elbowPath(cornerOfTile(stations[i]), cornerOfTile(stations[i + 1]))
    lines.push(Int32Array.from(path))

    for (let n = 0; n + 1 < path.length; n++) {
      const a = path[n]
      const b = path[n + 1]
      if (a === b) continue
      // Two legs sharing a stretch of track must not draw it twice.
      const key = a < b ? a * 100000 + b : b * 100000 + a
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push(a, b)
    }
  }

  return {
    segments: Int32Array.from(pairs),
    segmentCount: pairs.length / 2,
    lines,
    stations,
  }
}

/**
 * Where buses may run: the street network, unchanged. Buses are pure
 * decoration on infrastructure that already exists, which is why there is no
 * bus network to compute — only vehicles for the renderer to move.
 */
export function busRoutesAvailable(roads: RoadNetwork): boolean {
  return roads.segmentCount > 0
}
