import { createCity } from '../actions'
import { tileIndex } from '../grid'
import type { Building, BuildingType, CityState } from '../types'

/** A city with no auto-builder running, for tests that want a static layout. */
export function quietCity(seed = 1): CityState {
  const state = createCity(seed)
  state.queue.length = 0
  state.nextBuildAt = Infinity
  return state
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
    tile,
    variant: 0.5,
    bornAt: state.time,
    derelict,
    lowSince: null,
    highSince: null,
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
