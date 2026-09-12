import { describe, expect, it } from 'vitest'
import { PARCEL_SIZE } from '../config'
import { recentreGrid } from '../migrate'

/**
 * Sizes chosen independently of the game's real WORLD_SIZE, but compatible
 * with the real PARCEL_SIZE (3): an offset of (12 - 6) / 2 = 3 is exactly one
 * parcel, so recentring stays parcel-aligned.
 */
const OLD_SIZE = 6
const NEW_SIZE = 12
const OFFSET = (NEW_SIZE - OLD_SIZE) / 2 // 3

function oldTile(x: number, z: number): number {
  return z * OLD_SIZE + x
}

function newTile(x: number, z: number): number {
  return z * NEW_SIZE + x
}

function emptyOldGrid(): (Record<string, unknown> | null)[] {
  return new Array(OLD_SIZE * OLD_SIZE).fill(null)
}

function emptyOldParcels(): boolean[] {
  const perSide = OLD_SIZE / PARCEL_SIZE
  return new Array(perSide * perSide).fill(false)
}

describe('recentreGrid', () => {
  it('moves a simple building to its recentred tile and updates its tile field', () => {
    const grid = emptyOldGrid()
    grid[oldTile(0, 0)] = { type: 'house', level: 1, tile: oldTile(0, 0), mergeAnchor: null }

    const result = recentreGrid(OLD_SIZE, NEW_SIZE, {
      grid,
      ownedParcels: emptyOldParcels(),
      events: [],
    })

    expect(result).not.toBeNull()
    const expectedTile = newTile(0 + OFFSET, 0 + OFFSET)
    expect(result!.grid[expectedTile]).toMatchObject({ type: 'house', tile: expectedTile })
    // Everywhere else on the new, bigger map stays empty.
    expect(result!.grid.filter((c) => c !== null)).toHaveLength(1)
    expect(result!.grid).toHaveLength(NEW_SIZE * NEW_SIZE)
  })

  it('remaps a merged block anchor along with its own tile', () => {
    const grid = emptyOldGrid()
    const anchorOld = oldTile(1, 1)
    const cellOld = oldTile(2, 2)
    grid[cellOld] = { type: 'shop', level: 3, tile: cellOld, mergeAnchor: anchorOld }

    const result = recentreGrid(OLD_SIZE, NEW_SIZE, {
      grid,
      ownedParcels: emptyOldParcels(),
      events: [],
    })

    expect(result).not.toBeNull()
    const expectedCell = newTile(2 + OFFSET, 2 + OFFSET)
    const expectedAnchor = newTile(1 + OFFSET, 1 + OFFSET)
    expect(result!.grid[expectedCell]).toMatchObject({ tile: expectedCell, mergeAnchor: expectedAnchor })
  })

  it('moves an owned parcel into the matching parcel of the new map', () => {
    const oldPerSide = OLD_SIZE / PARCEL_SIZE // 2
    const newPerSide = NEW_SIZE / PARCEL_SIZE // 4
    const parcelOffset = OFFSET / PARCEL_SIZE // 1
    const ownedParcels = emptyOldParcels()
    const ownedIndex = 0 * oldPerSide + 0 // parcel (0, 0)
    ownedParcels[ownedIndex] = true

    const result = recentreGrid(OLD_SIZE, NEW_SIZE, {
      grid: emptyOldGrid(),
      ownedParcels,
      events: [],
    })

    expect(result).not.toBeNull()
    const expectedIndex = parcelOffset * newPerSide + parcelOffset // parcel (1, 1) on the new map
    expect(result!.ownedParcels[expectedIndex]).toBe(true)
    expect(result!.ownedParcels.filter(Boolean)).toHaveLength(1)
    expect(result!.ownedParcels).toHaveLength(newPerSide * newPerSide)
  })

  it('remaps an event log entry\'s tile the same way as a building', () => {
    const where = oldTile(3, 0)
    const result = recentreGrid(OLD_SIZE, NEW_SIZE, {
      grid: emptyOldGrid(),
      ownedParcels: emptyOldParcels(),
      events: [{ kind: 'built', at: 12, where }],
    })

    expect(result).not.toBeNull()
    expect(result!.events).toEqual([{ kind: 'built', at: 12, where: newTile(3 + OFFSET, 0 + OFFSET) }])
  })

  it('refuses when the centring offset does not land on a parcel boundary', () => {
    // (10 - 6) / 2 = 2, not a multiple of PARCEL_SIZE (3).
    const result = recentreGrid(6, 10, {
      grid: emptyOldGrid(),
      ownedParcels: emptyOldParcels(),
      events: [],
    })
    expect(result).toBeNull()
  })

  it('refuses to shrink the world', () => {
    const result = recentreGrid(NEW_SIZE, OLD_SIZE, {
      grid: new Array(NEW_SIZE * NEW_SIZE).fill(null),
      ownedParcels: new Array((NEW_SIZE / PARCEL_SIZE) ** 2).fill(false),
      events: [],
    })
    expect(result).toBeNull()
  })

  it('is a no-op when the size has not changed', () => {
    const grid = emptyOldGrid()
    grid[oldTile(2, 2)] = { type: 'park', tile: oldTile(2, 2), mergeAnchor: null }
    const ownedParcels = emptyOldParcels()
    ownedParcels[1] = true
    const events = [{ kind: 'built', at: 5, where: oldTile(2, 2) }]

    const result = recentreGrid(OLD_SIZE, OLD_SIZE, { grid, ownedParcels, events })

    expect(result).not.toBeNull()
    expect(result).toEqual({ grid, ownedParcels, events })
  })
})
