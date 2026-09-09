import type { CityEvent } from './events'

export type BuildingType =
  | 'house'
  | 'shop'
  | 'factory'
  | 'park'
  | 'station'
  | 'school'
  | 'harbour'
  | 'landfill'

/** Types the build queue may contain. Factory and park are placed by hand. */
export type QueueableType = 'house' | 'shop'

export interface Building {
  type: BuildingType
  /** 1..MAX_LEVEL. Scales output, population and emission together. */
  level: number
  /** Tile index: z * WORLD_SIZE + x. */
  tile: number
  /** Stable 0..1 jitter seed, used by the renderer for height and hue variation. */
  variant: number
  /** Sim time at which it was placed, for the spawn animation. */
  bornAt: number
  derelict: boolean
  /** Sim time since tile happiness fell below DERELICT_HAPPINESS, else null. */
  lowSince: number | null
  /** Sim time since tile happiness rose above RECOVER_HAPPINESS, else null. */
  highSince: number | null
}

/** Everything that is saved. Derived values are recomputed, never stored. */
export interface CityState {
  version: number
  /** Seconds of sim time elapsed since the city was founded. */
  time: number
  coins: number
  /** Length TILE_COUNT. null means empty. */
  grid: (Building | null)[]
  /** Length PARCEL_COUNT. */
  ownedParcels: boolean[]
  /** Front of the array is built next. Never left empty while the city lives. */
  queue: QueueableType[]
  /** Lifetime build counts, used for cost escalation. */
  builtCount: Record<BuildingType, number>
  /** Deterministic RNG state, so a reloaded save keeps building the same city. */
  rngSeed: number
  /**
   * Fixed for the life of a city. Terrain is regenerated from it rather than
   * stored, so the map survives a reload without bloating the save.
   */
  terrainSeed: number
  /**
   * Multiplier on upgrade costs, 1.0 unless the city was founded under a
   * prestige that bought it down. Stamped in at founding and saved with the
   * city, so the auto-builder never has to know prestige exists and a saved
   * city keeps the terms it was founded on.
   */
  upgradeDiscount: number
  /** Sim time of the next auto-build attempt. */
  nextBuildAt: number
  /** Wall-clock ms of the last save, for offline earnings. */
  lastSavedAt: number
  /** Recent things the city did to itself. Capped; see sim/events.ts. */
  events: CityEvent[]
  /** Sim time of the player's last action. Everything before it has been seen. */
  lastSeenAt: number
}

/** Recomputed from CityState. Never saved, never mutated by the renderer. */
export interface Derived {
  /** Happiness per tile, 0..1, length TILE_COUNT. */
  field: Float32Array
  population: number
  /** Mean happiness over occupied tiles, 0..1. 0.5 when the city is empty. */
  cityHappiness: number
  /** Coins per second at the current layout. */
  incomeRate: number
  /** Cost of the next parcel, or null when everything is owned. */
  nextLandCost: number | null
}
