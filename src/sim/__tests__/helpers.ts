import { createCity } from '../actions'
import { tileIndex } from '../grid'
import { SAFE_ZONE } from '../terrain'
import type { Building, BuildingType, CityState } from '../types'

/**
 * Terrain seed 0 is the flat world: no water, no peaks, every tile buildable.
 * Tests about the economy should not also be tests about where the lake landed.
 */
export function flatten(state: CityState): CityState {
  state.terrainSeed = 0
  return state
}

/** A city with no auto-builder running, for tests that want a static layout. */
export function quietCity(seed = 1): CityState {
  const state = flatten(createCity(seed))
  state.queue.length = 0
  // Far enough away to never fire, but FINITE: JSON.stringify turns Infinity
  // into null, the save validator rightly rejects that, and load() then returns
  // null — so a quietCity could not be round-tripped at all. That has cost four
  // separate debugging sessions in this codebase; it dies here.
  state.nextBuildAt = Number.MAX_SAFE_INTEGER
  return state
}

/**
 * Give the city something that pays, so it is allowed to buy land.
 *
 * buyParcel refuses while incomeRate is zero: houses earn nothing by design,
 * so a city that spends its last coins on land before a shop is paying has no
 * way back at all. A factory pays regardless of happiness, which makes it the
 * shortest route to a city that may expand. The starting parcels are always
 * plain terrain, so a tile in the middle of them is always free to build on.
 */
export function earning(state: CityState): CityState {
  // Use an inner region of SAFE_ZONE to ensure we stay well within protected terrain
  const minX = SAFE_ZONE.minX + 1
  const maxX = SAFE_ZONE.maxX
  const minZ = SAFE_ZONE.minZ + 1
  const maxZ = SAFE_ZONE.maxZ
  for (let z = minZ; z < maxZ; z++) {
    for (let x = minX; x < maxX; x++) {
      if (state.grid[tileIndex(x, z)] === null) {
        put(state, 'factory', x, z)
        return state
      }
    }
  }
  throw new Error('no free tile in the starting plot')
}

/** Drop a building straight onto the grid, free and without touching the RNG. */
export function put(
  state: CityState,
  type: BuildingType,
  x: number,
  z: number,
  derelict = false,
): Building {
  const tile = tileIndex(x, z)
  const b: Building = {
    type,
    level: 1,
    tile,
    variant: 0.5,
    commerceKind: type === 'shop' ? 'general' : null,
    bornAt: state.time,
    derelict,
    lowSince: null,
    highSince: null,
    mergeAnchor: null,
  }
  state.grid[tile] = b
  state.builtCount[type]++
  return b
}

/** An in-memory Storage, so save.ts can be exercised in a node test run. */
export class MemoryStorage implements Storage {
  private map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }
  clear(): void {
    this.map.clear()
  }
  getItem(key: string): string | null {
    const v = this.map.get(key)
    return v === undefined ? null : v
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
}
