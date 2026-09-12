import { describe, expect, it } from 'vitest'
import { COMMERCE_KINDS, SPAWN_COMMERCE_KINDS } from '../buildings'
import { MAX_LEVEL, SIM_DT, WORLD_SIZE } from '../config'
import { computeField } from '../field'
import { tileIndex } from '../grid'
import { blockCells, isMergedBlock, maxiCommerceKind } from '../merge'
import { step } from '../tick'
import type { BuildingType, CityState, CommerceKind } from '../types'
import { put, quietCity } from './helpers'

describe('blockCells', () => {
  it('returns the four tiles of the 2x2 block from its top-left corner', () => {
    expect(blockCells(tileIndex(5, 5))).toEqual([
      tileIndex(5, 5),
      tileIndex(6, 5),
      tileIndex(5, 6),
      tileIndex(6, 6),
    ])
    expect(blockCells(0)).toEqual([0, 1, WORLD_SIZE, WORLD_SIZE + 1])
  })
})

describe('isMergedBlock', () => {
  const anchor = tileIndex(5, 5)

  it('is true when the four cells hold one type, all pointing at the anchor', () => {
    const state = quietCity()
    for (const [x, z] of [
      [5, 5],
      [6, 5],
      [5, 6],
      [6, 6],
    ]) {
      put(state, 'house', x, z).mergeAnchor = anchor
    }
    expect(isMergedBlock(state, anchor)).toBe(true)
  })

  it('is false when a cell is empty, of another type, or anchored elsewhere', () => {
    const empty = quietCity()
    put(empty, 'house', 5, 5).mergeAnchor = anchor
    expect(isMergedBlock(empty, anchor)).toBe(false)

    const mixed = quietCity()
    for (const [x, z] of [
      [5, 5],
      [6, 5],
      [5, 6],
      [6, 6],
    ]) {
      put(mixed, 'house', x, z).mergeAnchor = anchor
    }
    put(mixed, 'shop', 6, 6).mergeAnchor = anchor
    expect(isMergedBlock(mixed, anchor)).toBe(false)

    const stray = quietCity()
    for (const [x, z] of [
      [5, 5],
      [6, 5],
      [5, 6],
      [6, 6],
    ]) {
      put(stray, 'house', x, z).mergeAnchor = anchor
    }
    stray.grid[tileIndex(6, 6)]!.mergeAnchor = null
    expect(isMergedBlock(stray, anchor)).toBe(false)
  })
})

describe('maxiCommerceKind', () => {
  it('prefers restaurant over everything, then clothing, then konbini', () => {
    expect(maxiCommerceKind(['restaurant', 'clothing', 'konbini', 'general'])).toBe('food_court')
    expect(maxiCommerceKind(['general', 'konbini', 'restaurant', 'clothing'])).toBe('food_court')
    expect(maxiCommerceKind(['clothing', 'konbini', 'general', 'general'])).toBe(
      'department_store',
    )
    expect(maxiCommerceKind(['konbini', 'clothing'])).toBe('department_store')
    expect(maxiCommerceKind(['konbini', 'general', 'general', 'general'])).toBe('supermarket')
    expect(maxiCommerceKind(['general', 'general', 'general', 'general'])).toBe('arcade')
  })

  it('decides every block of four spawn kinds by the same priority rule', () => {
    // The rule restated declaratively, so a slipped priority in the
    // implementation shows up as a mismatch rather than a copied typo.
    const expected = (kinds: CommerceKind[]): CommerceKind =>
      kinds.includes('restaurant')
        ? 'food_court'
        : kinds.includes('clothing')
          ? 'department_store'
          : kinds.includes('konbini')
            ? 'supermarket'
            : 'arcade'
    for (const a of SPAWN_COMMERCE_KINDS) {
      for (const b of SPAWN_COMMERCE_KINDS) {
        for (const c of SPAWN_COMMERCE_KINDS) {
          for (const d of SPAWN_COMMERCE_KINDS) {
            expect(maxiCommerceKind([a, b, c, d])).toBe(expected([a, b, c, d]))
          }
        }
      }
    }
  })

  it('always lands on a maxi kind, whatever the input holds', () => {
    const maxi: CommerceKind[] = ['food_court', 'department_store', 'supermarket', 'arcade']
    for (const a of COMMERCE_KINDS) {
      for (const b of COMMERCE_KINDS) {
        for (const c of COMMERCE_KINDS) {
          for (const d of COMMERCE_KINDS) {
            expect(maxi).toContain(maxiCommerceKind([a, b, c, d]))
          }
        }
      }
    }
    expect(maxi).toContain(maxiCommerceKind([]))
  })
})

describe('tryMerges', () => {
  const ANCHOR = tileIndex(5, 5) // 65: the block (5,5), (6,5), (5,6), (6,6)

  /**
   * The 2x2 block at (5,5) filled with MAX_LEVEL buildings of one type,
   * flanked by the two schools whose emissions clamp all four tiles to the
   * field's ceiling — the merge rule's whole precondition in one layout.
   */
  function mergeableBlock(state: CityState, type: BuildingType, kinds?: CommerceKind[]): void {
    const corners: [number, number][] = [
      [5, 5],
      [6, 5],
      [5, 6],
      [6, 6],
    ]
    corners.forEach(([x, z], i) => {
      const b = put(state, type, x, z)
      b.level = MAX_LEVEL
      if (type === 'shop' && kinds) b.commerceKind = kinds[i]
    })
    put(state, 'school', 4, 5)
    put(state, 'school', 7, 6)
  }

  function expectBlockAtCeiling(state: CityState, anchor: number): void {
    for (const cell of blockCells(anchor)) expect(computeField(state)[cell]).toBe(1)
  }

  function mergedEvents(state: CityState) {
    return state.events.filter((e) => e.kind === 'merged')
  }

  it('merges four level-3 buildings of one type on ceiling-happiness tiles', () => {
    const state = quietCity()
    mergeableBlock(state, 'house')
    expectBlockAtCeiling(state, ANCHOR)

    const result = step(state, SIM_DT)

    expect(result.structureChanged).toBe(true)
    for (const cell of blockCells(ANCHOR)) {
      expect(state.grid[cell]!.mergeAnchor).toBe(ANCHOR)
    }
    expect(isMergedBlock(state, ANCHOR)).toBe(true)
    expect(mergedEvents(state)).toHaveLength(1)
    expect(mergedEvents(state)[0]).toMatchObject({
      kind: 'merged',
      at: state.time,
      where: ANCHOR,
      type: 'house',
    })
  })

  it('emits exactly one event per merge, and never re-merges an anchored block', () => {
    const state = quietCity()
    mergeableBlock(state, 'house')

    step(state, SIM_DT)
    const second = step(state, SIM_DT)

    expect(second.structureChanged).toBe(false)
    expect(mergedEvents(state)).toHaveLength(1)
  })

  it('refreshes bornAt on the anchor cell, and only there', () => {
    const state = quietCity()
    mergeableBlock(state, 'house')

    step(state, SIM_DT)

    const cells = blockCells(ANCHOR)
    expect(state.grid[cells[0]]!.bornAt).toBe(state.time)
    for (const cell of cells.slice(1)) {
      expect(state.grid[cell]!.bornAt).toBe(0) // stamped by put() at founding time
    }
  })

  it('does not merge below MAX_LEVEL', () => {
    const state = quietCity()
    mergeableBlock(state, 'house')
    for (const cell of blockCells(ANCHOR)) state.grid[cell]!.level = MAX_LEVEL - 1

    const result = step(state, SIM_DT)

    expect(result.structureChanged).toBe(false)
    expect(mergedEvents(state)).toHaveLength(0)
    for (const cell of blockCells(ANCHOR)) {
      expect(state.grid[cell]!.mergeAnchor).toBeNull()
    }
  })

  it('does not merge a square of mixed base types', () => {
    const state = quietCity()
    mergeableBlock(state, 'house')
    put(state, 'shop', 6, 6).level = MAX_LEVEL // one corner is another type

    const result = step(state, SIM_DT)

    expect(result.structureChanged).toBe(false)
    expect(mergedEvents(state)).toHaveLength(0)
    expect(isMergedBlock(state, ANCHOR)).toBe(false)
  })

  it('does not merge while one tile sits below the happiness ceiling', () => {
    const state = quietCity()
    mergeableBlock(state, 'house')
    // A landfill's 1.8-tile reach from (7,7) poisons (6,6) and nothing else
    // in the block; the other three tiles stay clamped at the ceiling.
    put(state, 'landfill', 7, 7)
    const field = computeField(state)
    expect(field[tileIndex(6, 6)]).toBeLessThan(1)
    expect(field[tileIndex(5, 5)]).toBe(1)
    expect(field[tileIndex(6, 5)]).toBe(1)
    expect(field[tileIndex(5, 6)]).toBe(1)

    const result = step(state, SIM_DT)

    expect(result.structureChanged).toBe(false)
    expect(mergedEvents(state)).toHaveLength(0)
  })

  it('merges only the first of two overlapping candidates in a pass', () => {
    const state = quietCity()
    // A 3x2 strip of level-3 houses: anchors (5,5) and (6,5) both look
    // eligible until (5,5) takes cells (6,5) and (6,6) in the same scan.
    for (const [x, z] of [
      [5, 5],
      [6, 5],
      [7, 5],
      [5, 6],
      [6, 6],
      [7, 6],
    ]) {
      put(state, 'house', x, z).level = MAX_LEVEL
    }
    put(state, 'school', 4, 5)
    put(state, 'school', 8, 5)
    put(state, 'school', 6, 4)
    for (const [x, z] of [
      [5, 5],
      [6, 5],
      [7, 5],
      [5, 6],
      [6, 6],
      [7, 6],
    ]) {
      expect(computeField(state)[tileIndex(x, z)]).toBe(1)
    }

    step(state, SIM_DT)

    expect(isMergedBlock(state, tileIndex(5, 5))).toBe(true)
    expect(state.grid[tileIndex(7, 5)]!.mergeAnchor).toBeNull() // (7,5): its square lost two cells mid-scan
    expect(state.grid[tileIndex(7, 6)]!.mergeAnchor).toBeNull() // (7,6)
    expect(mergedEvents(state)).toHaveLength(1)
  })

  it('merges every disjoint eligible block in one pass, in scan order', () => {
    const state = quietCity()
    // Two independent blocks, each with the school pair that pins it to the
    // ceiling: houses at (5,1) and shops at (7,7), far enough apart that
    // neither school's reach touches the other block.
    for (const [x, z] of [
      [5, 1],
      [6, 1],
      [5, 2],
      [6, 2],
    ]) {
      put(state, 'house', x, z).level = MAX_LEVEL
    }
    put(state, 'school', 4, 1)
    put(state, 'school', 7, 2)
    for (const [x, z] of [
      [7, 7],
      [8, 7],
      [7, 8],
      [8, 8],
    ]) {
      put(state, 'shop', x, z).level = MAX_LEVEL
    }
    put(state, 'school', 6, 7)
    put(state, 'school', 9, 8)

    const houseAnchor = tileIndex(5, 1)
    const shopAnchor = tileIndex(7, 7)
    expectBlockAtCeiling(state, houseAnchor)
    expectBlockAtCeiling(state, shopAnchor)

    step(state, SIM_DT)

    expect(isMergedBlock(state, houseAnchor)).toBe(true)
    expect(isMergedBlock(state, shopAnchor)).toBe(true)
    expect(mergedEvents(state).map((e) => e.where)).toEqual([houseAnchor, shopAnchor])
  })

  it('rewrites the four shops with the maxi kind their kinds decide', () => {
    const state = quietCity()
    mergeableBlock(state, 'shop', ['restaurant', 'konbini', 'clothing', 'general'])

    step(state, SIM_DT)

    for (const cell of blockCells(ANCHOR)) {
      expect(state.grid[cell]!.commerceKind).toBe('food_court')
    }
  })

  it('releases a block the board no longer holds together', () => {
    const state = quietCity()
    mergeableBlock(state, 'house')
    step(state, SIM_DT)
    expect(isMergedBlock(state, ANCHOR)).toBe(true)

    state.grid[tileIndex(6, 6)] = null // a console-style demolition of one cell
    const result = step(state, SIM_DT)

    expect(result.structureChanged).toBe(true)
    expect(isMergedBlock(state, ANCHOR)).toBe(false)
    for (const cell of blockCells(ANCHOR)) {
      expect(state.grid[cell]?.mergeAnchor ?? null).toBeNull()
    }
    // The cleanup is not a merge: the log still holds exactly the one event.
    expect(mergedEvents(state)).toHaveLength(1)
  })
})
