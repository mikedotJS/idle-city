import { BUILD_INTERVAL, INCOME_FLOOR, WORLD_SIZE } from './config'
import { buildingCost } from './buildings'
import { nextRandom, parcelOfTile, tileDistance, tileX, tileZ } from './grid'
import { spawnBuilding } from './actions'
import type { Building, CityState, Derived } from './types'

const EPS = 1e-9

/**
 * The tile the auto-builder would fill next, or null if there is nowhere.
 *
 * The free owned tile closest (euclidean) to any existing building; the tile
 * nearest the world centre when the city is empty. Happiness is deliberately
 * ignored — the builder will cheerfully wall itself into a factory's smog.
 * Ties are broken with the seeded RNG, so a reloaded save builds the same city.
 */
export function pickBuildTile(state: CityState): number | null {
  const buildings: number[] = []
  for (let i = 0; i < state.grid.length; i++) if (state.grid[i]) buildings.push(i)

  const centre = (WORLD_SIZE - 1) / 2

  let best = Infinity
  let chosen: number | null = null
  let ties = 0

  for (let i = 0; i < state.grid.length; i++) {
    if (state.grid[i]) continue
    if (!state.ownedParcels[parcelOfTile(i)]) continue

    let d: number
    if (buildings.length === 0) {
      d = Math.hypot(tileX(i) - centre, tileZ(i) - centre)
    } else {
      d = Infinity
      for (const b of buildings) {
        const dist = tileDistance(i, b)
        if (dist < d) d = dist
      }
    }

    if (d < best - EPS) {
      best = d
      chosen = i
      ties = 1
    } else if (d <= best + EPS) {
      // Reservoir sample among equal-distance tiles, advancing the seeded RNG.
      ties++
      const [r, seed] = nextRandom(state.rngSeed)
      state.rngSeed = seed
      if (r < 1 / ties) chosen = i
    }
  }

  return chosen
}

/**
 * One auto-build attempt. Returns the building placed, or null.
 *
 * On success it pays, counts the build, shifts the queue (re-pushing the type
 * built to the back of the queue, so the list cycles as a standing policy) and
 * schedules the next attempt. On failure — nothing queued, unaffordable, or nowhere to build — it
 * changes nothing, so the caller simply retries at the next interval.
 */
export function tryAutoBuild(state: CityState, derived: Derived): Building | null {
  const type = state.queue[0]
  if (!type) return null

  const cost = buildingCost(type, state.builtCount[type])
  if (state.coins < cost) return null

  const tile = pickBuildTile(state)
  if (tile === null) return null

  state.coins -= cost
  const building = spawnBuilding(state, type, tile)

  // The queue rotates rather than draining: what was just built goes to the back,
  // so the list is a repeating policy ([house, house, shop] builds two houses per
  // shop forever) instead of a shopping list that decays into one building type.
  state.queue.push(state.queue.shift()!)

  state.nextBuildAt = state.time + BUILD_INTERVAL / (INCOME_FLOOR + derived.cityHappiness)
  return building
}
