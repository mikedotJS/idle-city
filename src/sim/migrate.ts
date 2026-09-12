/**
 * Recentres a saved city built on an older, smaller (or, one day, larger)
 * `WORLD_SIZE` into the map size the game currently runs. Runs once, inside
 * save.ts's `validate()`, on the RAW parsed JSON — before anything else about
 * the save has been checked — so every helper here reads defensively and
 * treats "not shaped the way it should be" as a reason to refuse (return
 * null), never as a reason to throw or guess.
 *
 * Pure and side-effect free: no rendering import, no storage access, nothing
 * beyond array arithmetic. That is also why it cannot reuse sim/grid.ts's
 * tileIndex/tileX/tileZ — those are hard-wired to the CURRENT WORLD_SIZE, and
 * this module has to reason about the OLD size and the new one side by side.
 * The index helpers below are the same arithmetic, just taking a width
 * parameter instead of reading the module-level constant.
 */

import { PARCEL_SIZE } from './config'

function tileIndexAt(x: number, z: number, width: number): number {
  return z * width + x
}

function tileXAt(index: number, width: number): number {
  return index % width
}

function tileZAt(index: number, width: number): number {
  return Math.floor(index / width)
}

function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)
}

/** Raw, not-yet-validated arrays as they come out of JSON.parse. */
export interface GridMigrationInput {
  /** Expected length oldSize * oldSize when oldSize !== newSize. */
  grid: unknown
  /** Expected length (oldSize / PARCEL_SIZE)^2 when oldSize !== newSize. */
  ownedParcels: unknown
  /** CityEvent-shaped objects; only the `where` tile index is touched. */
  events: unknown
}

export interface GridMigrationResult {
  grid: (Record<string, unknown> | null)[]
  ownedParcels: boolean[]
  events: Record<string, unknown>[]
}

/**
 * Moves an old `oldSize`-wide world into the middle of a `newSize`-wide one.
 *
 * Refuses (returns null) rather than producing a partial or misaligned result
 * when:
 *  - the new map is smaller (shrinking would delete tiles the player owns —
 *    not this function's call to make),
 *  - the centring offset is not a whole number of tiles (the old grid would
 *    sit on a half-tile boundary in the new one), or
 *  - the offset is not a multiple of PARCEL_SIZE (a parcel that was whole in
 *    the old grid must stay whole in the new one; PARCEL_SIZE itself is the
 *    one geometric constant this task treats as stable across both sizes).
 *
 * `oldSize === newSize` is a no-op: the arrays are handed back unchanged
 * (shallow-copied), never rejected — this is the path every save takes today,
 * since WORLD_SIZE has not actually changed yet.
 */
export function recentreGrid(oldSize: number, newSize: number, input: GridMigrationInput): GridMigrationResult | null {
  if (oldSize === newSize) {
    return {
      grid: Array.isArray(input.grid) ? input.grid.slice() : [],
      ownedParcels: Array.isArray(input.ownedParcels) ? input.ownedParcels.map((o) => o === true) : [],
      events: Array.isArray(input.events) ? input.events.slice() : [],
    }
  }

  if (newSize < oldSize) return null

  const offset = (newSize - oldSize) / 2
  if (!Number.isInteger(offset)) return null
  if (offset % PARCEL_SIZE !== 0) return null

  if (!Array.isArray(input.grid) || input.grid.length !== oldSize * oldSize) return null
  if (!Array.isArray(input.ownedParcels)) return null
  if (!Array.isArray(input.events)) return null

  // Shared by the building grid and the event log: both index tiles the same
  // way, just at different widths on either side of the move.
  const remapTile = (oldTile: number): number => {
    const x = tileXAt(oldTile, oldSize) + offset
    const z = tileZAt(oldTile, oldSize) + offset
    return tileIndexAt(x, z, newSize)
  }

  const newGrid: (Record<string, unknown> | null)[] = new Array(newSize * newSize).fill(null)
  for (let i = 0; i < input.grid.length; i++) {
    const cell = input.grid[i]
    if (cell === null || cell === undefined || typeof cell !== 'object') continue
    const raw = cell as Record<string, unknown>
    const newTile = remapTile(i)
    // mergeAnchor is the one field, besides tile, that encodes a tile index a
    // building carries around; a malformed or absent one is left untouched so
    // the normal per-building validator (save.ts's validateBuilding) can keep
    // treating it as "no anchor" exactly like it already does today.
    const mergeAnchor = isFiniteInt(raw.mergeAnchor) ? remapTile(raw.mergeAnchor) : raw.mergeAnchor
    newGrid[newTile] = { ...raw, tile: newTile, mergeAnchor }
  }

  // PARCEL_SIZE is stable across both sizes (the guard above already checked
  // the offset respects it), but PARCELS_PER_SIDE is not: it must be
  // recomputed for each size rather than imported from config.ts, which only
  // ever describes the CURRENT world.
  const oldParcelsPerSide = oldSize / PARCEL_SIZE
  const newParcelsPerSide = newSize / PARCEL_SIZE
  const parcelOffset = offset / PARCEL_SIZE
  const oldParcelCount = oldParcelsPerSide * oldParcelsPerSide
  if (input.ownedParcels.length !== oldParcelCount) return null

  const newOwnedParcels: boolean[] = new Array(newParcelsPerSide * newParcelsPerSide).fill(false)
  for (let i = 0; i < input.ownedParcels.length; i++) {
    if (input.ownedParcels[i] !== true) continue
    const px = tileXAt(i, oldParcelsPerSide) + parcelOffset
    const pz = tileZAt(i, oldParcelsPerSide) + parcelOffset
    newOwnedParcels[tileIndexAt(px, pz, newParcelsPerSide)] = true
  }

  const newEvents: Record<string, unknown>[] = []
  for (const item of input.events) {
    if (typeof item !== 'object' || item === null) {
      newEvents.push(item as Record<string, unknown>)
      continue
    }
    const e = item as Record<string, unknown>
    // `where` doubles as a parcel index for 'land' events (see sim/events.ts's
    // CityEvent.where comment) but is remapped here the same way as every
    // other event's tile index, per this migration's scope: the log is a
    // best-effort recent-activity feed the player reads, not something the
    // sim logic reads back, so a 'land' entry's location drifting slightly
    // across a one-time migration is a cosmetic gap, not a correctness bug.
    const where = isFiniteInt(e.where) ? remapTile(e.where) : e.where
    newEvents.push({ ...e, where })
  }

  return { grid: newGrid, ownedParcels: newOwnedParcels, events: newEvents }
}
