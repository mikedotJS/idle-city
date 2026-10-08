import type { Object3D } from 'three'
import type { RoadNetwork } from '../sim/roads'
import type { CityState, Derived } from '../sim/types'

/** The street surface itself: tarmac, kerbs, markings, lamps. */
export interface Roads {
  /** Called only when the grid changed. Rebuilds geometry from the network. */
  sync(state: CityState, network: RoadNetwork): void
  /** Every frame. `night` is 0 at midday and 1 at midnight. */
  frame(dt: number, night: number): void
  readonly object: Object3D
  dispose(): void
}

export function isRoads(value: unknown): value is Roads {
  return typeof value === 'object' && value !== null && 'sync' in value
}

/** Cars and pedestrians moving along the street network. */
export interface Traffic {
  /** Called only when the grid changed. Re-seeds agents onto the new network. */
  sync(state: CityState, derived: Derived, network: RoadNetwork): void
  /** Every frame. `night` is 0 at midday and 1 at midnight. */
  frame(dt: number, night: number): void
  readonly object: Object3D
  dispose(): void
}

/** Water, peaks and the sand strip along the shore. */
export interface TerrainView {
  /** Called when the map or owned parcels changed. Terrain itself never changes. */
  sync(state: CityState): void
  /** Every frame. `night` is 0 at midday and 1 at midnight. */
  frame(dt: number, night: number): void
  readonly object: Object3D
  dispose(): void
}

/** Track, and the trains running on it. */
export interface RailView {
  sync(state: CityState): void
  frame(dt: number, night: number): void
  readonly object: Object3D
  dispose(): void
}

/** Ambient street furniture and yard props (bollard lights, and later
 *  hydrants, benches, fences...) placed on the decor anchors computed from
 *  the road network and ownership. Purely cosmetic: never a pickable. */
export interface DecorView {
  /** Called only when the grid changed. Recomputes anchors and rebuilds. */
  sync(state: CityState): void
  /** Every frame. `night` is 0 at midday and 1 at midnight. */
  frame(dt: number, night: number): void
  readonly object: Object3D
  dispose(): void
}
