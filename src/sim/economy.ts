import {
  BASE_HAPPINESS,
  HABITABLE_HAPPINESS,
  INCOME_FLOOR,
  LAND_BASE_COST,
  LAND_COST_GROWTH,
  PARCEL_COUNT,
  LEVEL_OUTPUT,
  POP_PER_HOUSE,
  SHOP_COINS_PER_POP,
  SHOP_POP_CAP,
  SHOP_RADIUS,
  STARTING_PARCELS,
} from './config'
import { BUILDINGS } from './buildings'
import { computeField } from './field'
import { tileDistance } from './grid'
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

/** Cost of the next parcel given how many are owned, or null if all are owned. */
export function nextLandCost(state: CityState): number | null {
  let owned = 0
  for (const o of state.ownedParcels) if (o) owned++
  if (owned >= PARCEL_COUNT) return null
  return Math.round(LAND_BASE_COST * Math.pow(LAND_COST_GROWTH, owned - STARTING_PARCELS.length))
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
