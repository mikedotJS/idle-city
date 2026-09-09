import {
  PARCEL_COUNT,
  SAVE_VERSION,
  STARTING_COINS,
  STARTING_PARCELS,
  TILE_COUNT,
} from './config'
import { BUILDINGS, BUILDING_TYPES, buildingCost } from './buildings'
import { nextLandCost } from './economy'
import { noteInteraction, recordEvent } from './events'
import { nextRandom, parcelNeighbours, parcelOfTile } from './grid'
import { Terrain, isBuildable, isCoast, terrainFor } from './terrain'
import type { Building, BuildingType, CityState, QueueableType } from './types'

/**
 * A brand new city gets a fresh random seed, so its terrain and its build order
 * are its own. Passing a seed explicitly keeps everything reproducible, which is
 * what tests and the pacing harness rely on.
 *
 * This defaulted to a constant until it was noticed that every new city was
 * therefore the SAME city: same lake, same ridge, same order of building, for
 * everyone, forever. Terrain existed and varied by seed, but nothing ever
 * varied the seed.
 */
function freshSeed(): number {
  const n = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) | 0
  return n || 1
}

/**
 * Every known type at zero. Written out as a literal until adding a type meant
 * remembering to edit that literal too, which nothing enforced.
 */
function emptyCounts(): Record<BuildingType, number> {
  const counts = {} as Record<BuildingType, number>
  for (const type of BUILDING_TYPES) counts[type] = 0
  return counts
}

export type ActionResult = { ok: true } | { ok: false; reason: string }

const OK: ActionResult = { ok: true }
function fail(reason: string): ActionResult {
  return { ok: false, reason }
}

/** Draw a 0..1 value, advancing the state's deterministic RNG. */
function draw(state: CityState): number {
  const [value, seed] = nextRandom(state.rngSeed)
  state.rngSeed = seed
  return value
}

export function createCity(seed?: number): CityState {
  const chosen = seed === undefined ? freshSeed() : (seed | 0 || 1)
  const ownedParcels = new Array<boolean>(PARCEL_COUNT).fill(false)
  for (const p of STARTING_PARCELS) ownedParcels[p] = true

  return {
    version: SAVE_VERSION,
    time: 0,
    coins: STARTING_COINS,
    grid: new Array<Building | null>(TILE_COUNT).fill(null),
    ownedParcels,
    queue: ['house', 'house', 'shop'],
    builtCount: emptyCounts(),
    terrainSeed: chosen ^ 0x5eed,
    rngSeed: chosen,
    nextBuildAt: 0,
    lastSavedAt: Date.now(),
    events: [],
    lastSeenAt: 0,
  }
}

/**
 * Put a building on the grid and bump the lifetime count for cost escalation.
 * Does not charge for it — callers decide the price. Shared with the auto-builder.
 */
export function spawnBuilding(state: CityState, type: BuildingType, tile: number): Building {
  const b: Building = {
    type,
    level: 1,
    tile,
    variant: draw(state),
    bornAt: state.time,
    derelict: false,
    lowSince: null,
    highSince: null,
  }
  state.grid[tile] = b
  state.builtCount[type]++
  return b
}

export function placeManual(state: CityState, type: BuildingType, tile: number): ActionResult {
  const def = BUILDINGS[type]
  if (def.placement !== 'manual') return fail(`${def.label}s are built by the queue`)
  if (!Number.isInteger(tile) || tile < 0 || tile >= TILE_COUNT) return fail('Outside the world')
  if (!state.ownedParcels[parcelOfTile(tile)]) return fail('You do not own that land')
  const map = terrainFor(state)
  if (!isBuildable(map, tile)) {
    return fail(map.terrain[tile] === Terrain.Water ? 'You cannot build on water' : 'Too steep to build on')
  }
  if (def.coastOnly && !isCoast(map, tile)) return fail(`A ${def.label.toLowerCase()} needs a shoreline`)
  if (state.grid[tile]) return fail('That tile is taken')

  const cost = buildingCost(type, state.builtCount[type])
  if (state.coins < cost) return fail('Not enough coins')

  state.coins -= cost
  spawnBuilding(state, type, tile)
  noteInteraction(state)
  return OK
}

export function demolish(state: CityState, tile: number): ActionResult {
  if (!Number.isInteger(tile) || tile < 0 || tile >= TILE_COUNT) return fail('Outside the world')
  if (!state.grid[tile]) return fail('Nothing to demolish')
  // Free, instant, no refund — derelict buildings clear the same way.
  const removed = state.grid[tile]
  state.grid[tile] = null
  recordEvent(state, { kind: 'demolished', at: state.time, where: tile, type: removed?.type })
  noteInteraction(state)
  return OK
}

export function buyParcel(state: CityState, parcel: number): ActionResult {
  if (!Number.isInteger(parcel) || parcel < 0 || parcel >= PARCEL_COUNT) {
    return fail('No such parcel')
  }
  if (state.ownedParcels[parcel]) return fail('You already own that land')
  if (!parcelNeighbours(parcel).some((n) => state.ownedParcels[n])) {
    return fail('Must border land you own')
  }

  const cost = nextLandCost(state)
  if (cost === null) return fail('You already own that land')
  if (state.coins < cost) return fail('Not enough coins')

  state.coins -= cost
  state.ownedParcels[parcel] = true
  recordEvent(state, { kind: 'land', at: state.time, where: parcel })
  noteInteraction(state)
  return OK
}

export function enqueue(state: CityState, type: QueueableType): void {
  state.queue.push(type)
}

export function clearQueue(state: CityState): void {
  state.queue.length = 0
}

/** Cost of the next parcel given how many are owned, or null if all owned. */
export function landCost(state: CityState): number | null {
  return nextLandCost(state)
}
