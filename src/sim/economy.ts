import {
  BASE_HAPPINESS,
  HABITABLE_HAPPINESS,
  INCOME_FLOOR,
  LAND_BARREN_FLOOR,
  LAND_BASE_COST,
  LAND_COST_GROWTH,
  PARCEL_COUNT,
  PARCEL_SIZE,
  LEVEL_OUTPUT,
  POP_PER_HOUSE,
  SHOP_COINS_PER_POP,
  SHOP_POP_CAP,
  SHOP_RADIUS,
  STARTING_PARCELS,
} from './config'
import { BUILDINGS } from './buildings'
import { computeField } from './field'
import { parcelNeighbours, tileDistance } from './grid'
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
): number {
  let pop = 0
  for (let i = 0; i < state.grid.length; i++) {
    if (!isHoused(state, field, i)) continue
    if (tileDistance(i, tile) <= radius) pop += housedCount(state, i)
  }
  return pop
}

/** People a house holds at its level. A level 3 house is a small tower block. */
function housedCount(state: CityState, tile: number): number {
  const b = state.grid[tile]
  return b ? POP_PER_HOUSE * LEVEL_OUTPUT[b.level] : 0
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

export function derive(state: CityState): Derived {
  const field = computeField(state)

  let population = 0
  let occupied = 0
  let happinessSum = 0

  for (let i = 0; i < state.grid.length; i++) {
    const b = state.grid[i]
    if (!b) continue
    occupied++
    happinessSum += field[i]
    if (isHoused(state, field, i)) population += housedCount(state, i)
  }

  const cityHappiness = occupied === 0 ? BASE_HAPPINESS : happinessSum / occupied

  let base = 0
  for (let i = 0; i < state.grid.length; i++) {
    const b = state.grid[i]
    if (!b || b.derelict) continue
    if (b.type === 'shop') {
      const cap = SHOP_POP_CAP * LEVEL_OUTPUT[b.level]
      const near = Math.min(populationNear(state, field, i, SHOP_RADIUS), cap)
      base += near * SHOP_COINS_PER_POP
    } else {
      // Driven off the registry rather than a list of type names here. A
      // second earning building type used to mean editing this branch too,
      // and forgetting to was silent: the building simply earned nothing.
      const flat = BUILDINGS[b.type].coins
      if (flat !== undefined) base += flat * LEVEL_OUTPUT[b.level]
    }
  }

  return {
    field,
    population,
    cityHappiness,
    incomeRate: base * (INCOME_FLOOR + cityHappiness),
    nextLandCost: nextLandCost(state),
  }
}
