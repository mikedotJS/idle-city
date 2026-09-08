import { BASE_HAPPINESS, TILE_COUNT, WORLD_SIZE } from './config'
import { BUILDINGS } from './buildings'
import { tileIndex, tileX, tileZ } from './grid'
import type { CityState } from './types'

/**
 * Happiness per tile, 0..1, length TILE_COUNT.
 *
 * happiness(tile) = clamp(BASE_HAPPINESS + Σ strength * max(0, 1 - dist / range), 0, 1)
 * over every emitting building, with linear falloff and stacking contributions.
 */
export function computeField(state: CityState): Float32Array {
  const field = new Float32Array(TILE_COUNT)
  field.fill(BASE_HAPPINESS)

  for (let i = 0; i < state.grid.length; i++) {
    const b = state.grid[i]
    if (!b) continue
    const emit = BUILDINGS[b.type].emit
    if (!emit) continue
    // A derelict park stops helping, but a derelict factory is still a ruin nobody
    // wants to live beside — so only positive emitters switch off when derelict.
    if (b.derelict && emit.strength > 0) continue

    const bx = tileX(b.tile)
    const bz = tileZ(b.tile)
    const reach = emit.range
    const x0 = Math.max(0, Math.ceil(bx - reach))
    const x1 = Math.min(WORLD_SIZE - 1, Math.floor(bx + reach))
    const z0 = Math.max(0, Math.ceil(bz - reach))
    const z1 = Math.min(WORLD_SIZE - 1, Math.floor(bz + reach))

    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - bx, z - bz)
        const falloff = 1 - d / reach
        if (falloff <= 0) continue
        field[tileIndex(x, z)] += emit.strength * falloff
      }
    }
  }

  for (let i = 0; i < field.length; i++) {
    const v = field[i]
    field[i] = v < 0 ? 0 : v > 1 ? 1 : v
  }
  return field
}
