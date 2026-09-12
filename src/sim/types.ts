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

/**
 * What a shop actually sells. Purely cosmetic: every shop earns and costs
 * exactly the same regardless of kind. The first four are drawn at spawn time;
 * the last four exist only on a merged 2x2 block, decided from the kinds that
 * went into it (see sim/merge.ts's maxiCommerceKind) and never drawn at spawn.
 */
export type CommerceKind =
  | 'restaurant'
  | 'clothing'
  | 'konbini'
  | 'general'
  | 'food_court'
  | 'department_store'
  | 'supermarket'
  | 'arcade'

export interface Building {
  type: BuildingType
  /** 1..MAX_LEVEL. Scales output, population and emission together. */
  level: number
  /** Tile index: z * WORLD_SIZE + x. */
  tile: number
  /** Stable 0..1 jitter seed, used by the renderer for height and hue variation. */
  variant: number
  /**
   * What kind of shop this is. Null for every building that is not a shop, and
   * for shops saved before this existed. Drawn once at spawn time from
   * SPAWN_COMMERCE_KINDS; a merged block carries one of the maxi kinds instead,
   * decided by the merge logic.
   */
  commerceKind: CommerceKind | null
  /** Sim time at which it was placed, for the spawn animation. */
  bornAt: number
  derelict: boolean
  /** Sim time since tile happiness fell below DERELICT_HAPPINESS, else null. */
  lowSince: number | null
  /** Sim time since tile happiness rose above RECOVER_HAPPINESS, else null. */
  highSince: number | null
  /**
   * Tile index of the top-left anchor of the merged 2x2 block this building
   * belongs to, or null when it stands alone. Set by the merge logic.
   */
  mergeAnchor: number | null
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
