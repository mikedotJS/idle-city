import {
  BASE_HAPPINESS,
  FRIEND_INCOME_BONUS,
  HABITABLE_HAPPINESS,
  INCOME_FLOOR,
  LAND_BARREN_FLOOR,
  LAND_BASE_COST,
  LAND_COST_GROWTH,
  PARCEL_COUNT,
  PARCEL_SIZE,
  LEVEL_OUTPUT,
  MERGE_OUTPUT_BONUS,
  POP_PER_HOUSE,
  SHOP_COINS_PER_POP,
  SHOP_POP_CAP,
  SHOP_RADIUS,
  STARTING_PARCELS,
  WORLD_SIZE,
} from './config'
import { BUILDINGS } from './buildings'
import { computeField } from './field'
import { parcelNeighbours, tileDistance, tileX, tileZ } from './grid'
import { isMergedBlock } from './merge'
import { buildableTilesInParcel, terrainFor } from './terrain'
import type { CityState, Derived } from './types'

/** A house holds people only while it is standing and its tile is pleasant enough. */
function isHoused(state: CityState, field: Float32Array, tile: number): boolean {
  const b = state.grid[tile]
  if (!b || b.type !== 'house' || b.derelict) return false
  return field[tile] >= HABITABLE_HAPPINESS
}

/** Living population housed within `radius` of `tile`. */
export function populationNear(
  state: CityState,
  field: Float32Array,
  tile: number,
  radius: number,
  mergeCache: Map<number, boolean> = new Map(),
): number {
  let pop = 0
  for (let i = 0; i < state.grid.length; i++) {
    if (!isHoused(state, field, i)) continue
    if (tileDistance(i, tile) <= radius) {
      pop += housedCount(state, i, mergeOutputBonus(state, i, mergeCache))
    }
  }
  return pop
}

/**
 * Output multiplier for one cell of a merged block, or 1 for anything else.
 * Only a block isMergedBlock still vouches for earns the bonus — a stray
 * mergeAnchor left by a console poke is worth nothing. Anchor validity is
 * cached in `cache` for the duration of a derive pass: the four cells of a
 * block share one anchor, and isMergedBlock re-reads the whole 2x2 each call.
 */
function mergeOutputBonus(state: CityState, tile: number, cache: Map<number, boolean>): number {
  const anchor = state.grid[tile]?.mergeAnchor
  if (anchor === null || anchor === undefined) return 1
  let valid = cache.get(anchor)
  if (valid === undefined) {
    // The corner guard revalidateBlocks applies too: a hand-edited anchor on
    // the last row or column would make isMergedBlock read past the map edge.
    valid =
      tileX(anchor) < WORLD_SIZE - 1 &&
      tileZ(anchor) < WORLD_SIZE - 1 &&
      isMergedBlock(state, anchor)
    cache.set(anchor, valid)
  }
  return valid ? MERGE_OUTPUT_BONUS : 1
}

/** People a house holds at its level. A level 3 house is a small tower block. */
function housedCount(state: CityState, tile: number, bonus = 1): number {
  const b = state.grid[tile]
  return b ? POP_PER_HOUSE * LEVEL_OUTPUT[b.level] * bonus : 0
}

/**
 * What one specific parcel costs, or null if it is already owned.
 *
 * Two factors. The escalation is how many parcels you already hold, which is
 * what keeps the city from swallowing the board; the second is how much of
 * THIS parcel you could actually build on. Charging the same for a lake as for
 * a meadow made terrain a pure tax — you saw the water, you paid full price
 * for it, and nothing in the game acknowledged that you had been handed three
 * usable tiles instead of nine. Now the map is priced.
 */
export function parcelCost(state: CityState, parcel: number): number | null {
  if (state.ownedParcels[parcel]) return null
  let owned = 0
  for (const o of state.ownedParcels) if (o) owned++
  if (owned >= PARCEL_COUNT) return null

  const escalation = LAND_BASE_COST * Math.pow(LAND_COST_GROWTH, owned - STARTING_PARCELS.length)
  const usable = buildableTilesInParcel(terrainFor(state), parcel) / (PARCEL_SIZE * PARCEL_SIZE)
  return Math.round(escalation * (LAND_BARREN_FLOOR + (1 - LAND_BARREN_FLOOR) * usable))
}

/**
 * The cheapest parcel you could buy right now, or null when there is none.
 * This is the number the HUD quotes: with per-parcel pricing there is no
 * single "next" price any more, and the useful thing to say is the floor.
 */
export function nextLandCost(state: CityState): number | null {
  let cheapest: number | null = null
  for (let parcel = 0; parcel < PARCEL_COUNT; parcel++) {
    if (state.ownedParcels[parcel]) continue
    if (!parcelNeighbours(parcel).some((n) => state.ownedParcels[n])) continue
    const cost = parcelCost(state, parcel)
    if (cost !== null && (cheapest === null || cost < cheapest)) cheapest = cost
  }
  return cheapest
}

/**
 * `friendCount` is the only thing here that isn't drawn from `state`: it's
 * social, not civic, so it doesn't belong in a save file. Defaults to 0 so
 * every existing caller — tests included — is unaffected until it opts in.
 */
export function derive(state: CityState, friendCount = 0): Derived {
  const field = computeField(state)
  const mergeCache = new Map<number, boolean>()

  let population = 0
  let occupied = 0
  let happinessSum = 0

  for (let i = 0; i < state.grid.length; i++) {
    const b = state.grid[i]
    if (!b) continue
    occupied++
    happinessSum += field[i]
    if (isHoused(state, field, i)) {
      population += housedCount(state, i, mergeOutputBonus(state, i, mergeCache))
    }
  }

  const cityHappiness = occupied === 0 ? BASE_HAPPINESS : happinessSum / occupied

  let base = 0
  for (let i = 0; i < state.grid.length; i++) {
    const b = state.grid[i]
    if (!b || b.derelict) continue
    const bonus = mergeOutputBonus(state, i, mergeCache)
    if (b.type === 'shop') {
      const cap = SHOP_POP_CAP * LEVEL_OUTPUT[b.level] * bonus
      const near = Math.min(populationNear(state, field, i, SHOP_RADIUS, mergeCache), cap)
      base += near * SHOP_COINS_PER_POP * bonus
    } else {
      // Driven off the registry rather than a list of type names here. A
      // second earning building type used to mean editing this branch too,
      // and forgetting to was silent: the building simply earned nothing.
      const flat = BUILDINGS[b.type].coins
      if (flat !== undefined) base += flat * LEVEL_OUTPUT[b.level] * bonus
    }
  }

  return {
    field,
    population,
    cityHappiness,
    incomeRate: base * (INCOME_FLOOR + cityHappiness) * (1 + FRIEND_INCOME_BONUS * friendCount),
    nextLandCost: nextLandCost(state),
  }
}
