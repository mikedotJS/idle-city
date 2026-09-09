import type { BuildingType, CityState, Derived } from '../sim/types'

export type Tool =
  | { kind: 'none' }
  | { kind: 'place'; type: BuildingType }
  | { kind: 'demolish' }

export type PickTarget =
  | { kind: 'tile'; tile: number }
  | { kind: 'parcel'; parcel: number }

export interface RendererCallbacks {
  /** A left click landed on an owned tile, or on an unowned parcel. */
  onPick(target: PickTarget): void
  /** The pointer moved onto a new target, or off the board (null). */
  onHover(target: PickTarget | null): void
}

export interface Renderer {
  /** Called only when the grid or owned parcels changed. Rebuilds instances. */
  sync(state: CityState, derived: Derived): void
  /** Called every animation frame. Animates, updates the camera, renders. */
  frame(dt: number, state: CityState, derived: Derived): void
  setTool(tool: Tool): void
  /**
   * Point at a tile for a few seconds. Not a camera move: the rig already
   * frames the whole owned plot, so a tile worth reporting is already on
   * screen and what the player is missing is which one, not where.
   */
  flashTile(tile: number): void
  dispose(): void
}
