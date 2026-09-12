import {
  MAX_LEVEL,
  OFFLINE_CAP_SECONDS,
  PARCEL_COUNT,
  PRESTIGE_KEY,
  SAVE_KEY,
  SAVE_VERSION,
  TILE_COUNT,
  WORLD_SIZE,
} from './config'
import { BUILDINGS, BUILDING_TYPES, COMMERCE_KINDS } from './buildings'
import { derive } from './economy'
import {
  MIN_UPGRADE_DISCOUNT,
  UPGRADES,
  UPGRADE_KEYS,
  emptyPrestige,
  type PrestigeState,
} from './prestige'
import { EVENT_LIMIT, type CityEvent } from './events'
import { recentreGrid } from './migrate'
import type { Building, BuildingType, CityState, CommerceKind, QueueableType } from './types'

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
  /**
   * The real wall-clock time this exact save was actually written, before
   * `state.lastSavedAt` below gets reset to now (so a reload without an
   * intervening save doesn't double-credit the same offline stretch a
   * second time). A cross-device sync comparison (see sim/citysync.ts) needs
   * this original value — `state.lastSavedAt` on the returned state no
   * longer means what its name says by the time this function returns.
   */
  savedAt: number
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
  const savedAt = state.lastSavedAt

  // The sim is frozen offline: no growth, no decay, no catch-up ticks, and
  // state.time does not advance. Coins accrue at the rate the saved layout had.
  const elapsed = (Date.now() - state.lastSavedAt) / 1000
  const offlineSeconds = Math.min(Math.max(elapsed, 0), OFFLINE_CAP_SECONDS)
  const offlineCoins = derive(state).incomeRate * offlineSeconds

  state.coins += offlineCoins
  state.lastSavedAt = Date.now()

  return { state, offlineSeconds, offlineCoins, savedAt }
}

/**
 * Prestige is stored apart from the city on purpose; see PRESTIGE_KEY. A
 * malformed or missing record is an empty one rather than an error, exactly
 * like a malformed city is a fresh city.
 */
export function loadPrestige(): PrestigeState {
  const store = storage()
  if (!store) return emptyPrestige()
  let raw: string | null = null
  try {
    raw = store.getItem(PRESTIGE_KEY)
  } catch {
    return emptyPrestige()
  }
  if (raw === null) return emptyPrestige()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyPrestige()
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyPrestige()

  const p = parsed as Record<string, unknown>
  const out = emptyPrestige()
  if (isFinite_(p.charter)) out.charter = Math.max(0, Math.floor(p.charter as number))
  if (isFinite_(p.retired)) out.retired = Math.max(0, Math.floor(p.retired as number))

  const levels = typeof p.levels === 'object' && p.levels !== null ? (p.levels as Record<string, unknown>) : {}
  for (const key of UPGRADE_KEYS) {
    const value = levels[key]
    // Clamped to the table rather than trusted: a hand-edited record must not
    // be able to name a level the upgrade does not have.
    if (isFinite_(value)) {
      out.levels[key] = Math.min(Math.max(Math.floor(value as number), 0), UPGRADES[key].costs.length)
    }
  }
  return out
}

export function savePrestige(prestige: PrestigeState): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(PRESTIGE_KEY, JSON.stringify(prestige))
  } catch {
    // A full or blocked storage must never take the sim down.
  }
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
  // Saves written before commerce kinds existed have none — they read back as
  // a shop with no flavour rather than failing to load at all. COMMERCE_KINDS
  // covers the maxi kinds too, so a merged block's kind survives the round-trip.
  const commerceKind =
    typeof b.commerceKind === 'string' && (COMMERCE_KINDS as string[]).includes(b.commerceKind)
      ? (b.commerceKind as CommerceKind)
      : null
  // Saves written before merge blocks existed have none, and a hand-edited or
  // stale anchor off the grid is no anchor at all — the building stands alone
  // rather than failing to load.
  const mergeAnchor =
    isFinite_(b.mergeAnchor) &&
    Number.isInteger(b.mergeAnchor) &&
    b.mergeAnchor >= 0 &&
    b.mergeAnchor < TILE_COUNT
      ? b.mergeAnchor
      : null
  return {
    type: b.type as BuildingType,
    // Saves written before levels existed have none; everything standing then
    // was level 1 by definition.
    level: isFinite_(b.level) ? Math.min(Math.max(Math.round(b.level as number), 1), MAX_LEVEL) : 1,
    tile,
    variant: b.variant,
    commerceKind,
    bornAt: b.bornAt,
    derelict: b.derelict === true,
    lowSince: b.lowSince === null ? null : (b.lowSince as number),
    highSince: b.highSince === null ? null : (b.highSince as number),
    mergeAnchor,
  }
}

/**
 * Turn parsed JSON into a CityState, or null if it is not a save of this
 * version or is malformed. Never throws: a bad save is a fresh city, not a crash.
 *
 * Exported as cityFromJson so an imported city goes through this and nothing
 * else. Two validators would mean two definitions of a valid city, and the
 * looser one would eventually be the one that mattered.
 */
export function cityFromJson(raw: unknown): CityState | null {
  return validate(raw)
}

function validate(raw: unknown): CityState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const s = raw as Record<string, unknown>

  // A version bump used to throw the city away. Migrating instead costs a few
  // defaults and keeps everyone's plot: each older shape is a strict subset of
  // the next, so every field added since is simply defaulted below.
  if (typeof s.version !== 'number' || s.version < 1 || s.version > SAVE_VERSION) return null
  if (!isFinite_(s.time) || !isFinite_(s.coins)) return null
  if (!isFinite_(s.rngSeed) || !isFinite_(s.nextBuildAt) || !isFinite_(s.lastSavedAt)) return null

  // A save written under a different WORLD_SIZE is recentred onto the
  // current one before anything else about it is checked, so every rule
  // below keeps judging a grid/parcel/event set shaped for TILE_COUNT and
  // PARCEL_COUNT as they are today. A save whose worldSize already matches
  // takes a no-op path here and is otherwise untouched.
  const savedWorldSize = isFinite_(s.worldSize) ? (s.worldSize as number) : WORLD_SIZE
  let rawGrid: unknown = s.grid
  let rawOwnedParcels: unknown = s.ownedParcels
  let rawEvents: unknown = s.events
  if (savedWorldSize !== WORLD_SIZE) {
    const migrated = recentreGrid(savedWorldSize, WORLD_SIZE, {
      grid: rawGrid,
      ownedParcels: rawOwnedParcels,
      events: rawEvents,
    })
    // A refusal (mismatched shape, a shrink, an offset that cannot preserve
    // parcel alignment) makes the whole save invalid — same as any other
    // malformed field here — never a partial or best-effort load.
    if (!migrated) return null
    rawGrid = migrated.grid
    rawOwnedParcels = migrated.ownedParcels
    rawEvents = migrated.events
  }

  if (!Array.isArray(rawGrid) || rawGrid.length !== TILE_COUNT) return null
  const grid: (Building | null)[] = new Array(TILE_COUNT).fill(null)
  for (let i = 0; i < TILE_COUNT; i++) {
    const cell = rawGrid[i]
    if (cell === null || cell === undefined) continue
    const b = validateBuilding(cell, i)
    if (!b) return null
    grid[i] = b
  }

  if (!Array.isArray(rawOwnedParcels) || rawOwnedParcels.length !== PARCEL_COUNT) return null
  const ownedParcels = rawOwnedParcels.map((o) => o === true)

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
    // Saves from before prestige were all founded at full price. Clamped
    // rather than trusted: a hand-edited save must not be able to name a
    // discount the upgrade table cannot reach.
    upgradeDiscount: isFinite_(s.upgradeDiscount)
      ? Math.min(Math.max(s.upgradeDiscount as number, MIN_UPGRADE_DISCOUNT), 1)
      : 1,
    nextBuildAt: s.nextBuildAt,
    lastSavedAt: s.lastSavedAt,
    events: validateEvents(rawEvents),
    // Saves from before the activity log have nothing to report, so the window
    // starts closed rather than announcing the whole history of the city.
    lastSeenAt: isFinite_(s.lastSeenAt) ? (s.lastSeenAt as number) : (s.time as number),
    // Whatever worldSize the save came in with, everything above this point now
    // describes a grid shaped for the current WORLD_SIZE — migrated moments ago
    // if it did not already match. So the state we hand back always records
    // today's size, never the one it was loaded under.
    worldSize: WORLD_SIZE,
  }
}

const EVENT_KINDS = new Set(['built', 'upgraded', 'derelict', 'recovered', 'demolished', 'land', 'merged'])

/** A malformed entry is dropped, never fatal: the log is news, not the city. */
function validateEvents(raw: unknown): CityEvent[] {
  if (!Array.isArray(raw)) return []
  const out: CityEvent[] = []
  for (const item of raw.slice(-EVENT_LIMIT)) {
    if (typeof item !== 'object' || item === null) continue
    const e = item as Record<string, unknown>
    if (typeof e.kind !== 'string' || !EVENT_KINDS.has(e.kind)) continue
    if (!isFinite_(e.at) || !isFinite_(e.where)) continue
    out.push({
      kind: e.kind as CityEvent['kind'],
      at: e.at,
      where: e.where,
      type: typeof e.type === 'string' && e.type in BUILDINGS ? (e.type as BuildingType) : undefined,
      level: isFinite_(e.level) ? (e.level as number) : undefined,
    })
  }
  return out
}
