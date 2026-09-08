import { OFFLINE_CAP_SECONDS, PARCEL_COUNT, SAVE_KEY, SAVE_VERSION, TILE_COUNT } from './config'
import { BUILDINGS } from './buildings'
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

  if (s.version !== SAVE_VERSION) return null
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
  const builtCount = { house: 0, shop: 0, factory: 0, park: 0 } as Record<BuildingType, number>
  for (const type of Object.keys(builtCount) as BuildingType[]) {
    const n = counts[type]
    if (!isFinite_(n)) return null
    builtCount[type] = n
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
    nextBuildAt: s.nextBuildAt,
    lastSavedAt: s.lastSavedAt,
  }
}
