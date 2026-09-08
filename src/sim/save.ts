import {
  MAX_LEVEL,
  OFFLINE_CAP_SECONDS,
  PARCEL_COUNT,
  SAVE_KEY,
  SAVE_VERSION,
  TILE_COUNT,
} from './config'
import { BUILDINGS, BUILDING_TYPES } from './buildings'
import { derive } from './economy'
import type { Building, BuildingType, CityState, QueueableType } from './types'

/** localStorage is the only DOM API the sim touches, and only here. */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function save(state: CityState): void {
  const store = storage()
  if (!store) return
  state.version = SAVE_VERSION
  state.lastSavedAt = Date.now()
  try {
    store.setItem(SAVE_KEY, JSON.stringify(state))
  } catch {
    // A full or blocked storage must never take the sim down.
  }
}

export interface LoadResult {
  state: CityState
  offlineSeconds: number
  offlineCoins: number
}

export function load(): LoadResult | null {
  const store = storage()
  if (!store) return null

  let raw: string | null = null
  try {
    raw = store.getItem(SAVE_KEY)
  } catch {
    return null
  }
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const state = validate(parsed)
  if (!state) return null

  // The sim is frozen offline: no growth, no decay, no catch-up ticks, and
  // state.time does not advance. Coins accrue at the rate the saved layout had.
  const elapsed = (Date.now() - state.lastSavedAt) / 1000
  const offlineSeconds = Math.min(Math.max(elapsed, 0), OFFLINE_CAP_SECONDS)
  const offlineCoins = derive(state).incomeRate * offlineSeconds

  state.coins += offlineCoins
  state.lastSavedAt = Date.now()

  return { state, offlineSeconds, offlineCoins }
}

export function clearSave(): void {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(SAVE_KEY)
  } catch {
    // Nothing sensible to do.
  }
}

function isFinite_(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function validateBuilding(raw: unknown, tile: number): Building | null {
  if (typeof raw !== 'object' || raw === null) return null
  const b = raw as Record<string, unknown>
  if (typeof b.type !== 'string' || !(b.type in BUILDINGS)) return null
  if (!isFinite_(b.bornAt) || !isFinite_(b.variant)) return null
  if (b.lowSince !== null && !isFinite_(b.lowSince)) return null
  if (b.highSince !== null && !isFinite_(b.highSince)) return null
  return {
    type: b.type as BuildingType,
    // Saves written before levels existed have none; everything standing then
    // was level 1 by definition.
    level: isFinite_(b.level) ? Math.min(Math.max(Math.round(b.level as number), 1), MAX_LEVEL) : 1,
    tile,
    variant: b.variant,
    bornAt: b.bornAt,
    derelict: b.derelict === true,
    lowSince: b.lowSince === null ? null : (b.lowSince as number),
    highSince: b.highSince === null ? null : (b.highSince as number),
  }
}

/**
 * Turn parsed JSON into a CityState, or null if it is not a save of this
 * version or is malformed. Never throws: a bad save is a fresh city, not a crash.
 */
function validate(raw: unknown): CityState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const s = raw as Record<string, unknown>

  // A version bump used to throw the city away. Migrating instead costs a few
  // defaults and keeps everyone's plot: the v1 shape is a strict subset of v2.
  if (s.version !== SAVE_VERSION && s.version !== 1) return null
  if (!isFinite_(s.time) || !isFinite_(s.coins)) return null
  if (!isFinite_(s.rngSeed) || !isFinite_(s.nextBuildAt) || !isFinite_(s.lastSavedAt)) return null

  if (!Array.isArray(s.grid) || s.grid.length !== TILE_COUNT) return null
  const grid: (Building | null)[] = new Array(TILE_COUNT).fill(null)
  for (let i = 0; i < TILE_COUNT; i++) {
    const cell = s.grid[i]
    if (cell === null || cell === undefined) continue
    const b = validateBuilding(cell, i)
    if (!b) return null
    grid[i] = b
  }

  if (!Array.isArray(s.ownedParcels) || s.ownedParcels.length !== PARCEL_COUNT) return null
  const ownedParcels = s.ownedParcels.map((o) => o === true)

  if (!Array.isArray(s.queue)) return null
  const queue: QueueableType[] = []
  for (const q of s.queue) {
    if (q !== 'house' && q !== 'shop') return null
    queue.push(q)
  }

  if (typeof s.builtCount !== 'object' || s.builtCount === null) return null
  const counts = s.builtCount as Record<string, unknown>
  // Driven off the registry rather than a literal list. A hardcoded one was a
  // second source of truth for the building types: adding `station` silently
  // dropped its count on every load, with no error anywhere.
  const builtCount = {} as Record<BuildingType, number>
  for (const type of BUILDING_TYPES) {
    const n = counts[type]
    // A type added since the save was written simply has none built yet, which
    // is not corruption — rejecting here would delete a city for gaining a
    // building type it has never seen.
    if (n === undefined) {
      builtCount[type] = 0
      continue
    }
    if (!isFinite_(n)) return null
    builtCount[type] = n as number
  }

  return {
    version: SAVE_VERSION,
    time: s.time,
    coins: s.coins,
    grid,
    ownedParcels,
    queue,
    builtCount,
    rngSeed: s.rngSeed | 0 || 1,
    // v1 saves predate terrain. Deriving the seed from the RNG seed gives each
    // returning city a stable map of its own rather than all sharing one.
    terrainSeed: isFinite_(s.terrainSeed) ? (s.terrainSeed as number) | 0 : ((s.rngSeed as number) | 0) ^ 0x5eed,
    nextBuildAt: s.nextBuildAt,
    lastSavedAt: s.lastSavedAt,
  }
}
