import { MAX_LEVEL, WORLD_SIZE } from './config'
import { recordEvent } from './events'
import { tileIndex, tileX, tileZ } from './grid'
import type { Building, CityState, CommerceKind } from './types'

/**
 * The four tile indices of the 2x2 block whose top-left corner is `anchor`.
 * Pure arithmetic — no bounds check: callers only pass an anchor that was
 * already validated as the corner of a block that fits on the map.
 */
export function blockCells(anchor: number): number[] {
  return [anchor, anchor + 1, anchor + WORLD_SIZE, anchor + WORLD_SIZE + 1]
}

/**
 * Whether the 2x2 block at `anchor` is a complete merge: every cell holds a
 * building, all of the same type, and every one points back at the anchor.
 */
export function isMergedBlock(state: CityState, anchor: number): boolean {
  const cells = blockCells(anchor)
  const first = state.grid[cells[0]]
  if (first === null || first.mergeAnchor !== anchor) return false
  for (let i = 1; i < cells.length; i++) {
    const b = state.grid[cells[i]]
    if (b === null || b.type !== first.type || b.mergeAnchor !== anchor) return false
  }
  return true
}

/**
 * What a merged 2x2 shop block becomes, decided from the kinds of its parts.
 * The priority order is fixed and total — restaurant beats clothing beats
 * konbini, and a block with none of the three (four general stores, or
 * anything weirder a save might hold) is an arcade — so the result never
 * depends on the order `kinds` is listed in.
 */
export function maxiCommerceKind(kinds: CommerceKind[]): CommerceKind {
  if (kinds.includes('restaurant')) return 'food_court'
  if (kinds.includes('clothing')) return 'department_store'
  if (kinds.includes('konbini')) return 'supermarket'
  return 'arcade'
}

/**
 * Merge every eligible 2x2 square into a block, and unpick the blocks the
 * board no longer supports. Runs once per sim step, after dereliction and the
 * auto-builder, judging the layout exactly as those left it.
 *
 * The eligibility rule is the one the player can plan around: four buildings
 * of one base type (shop kinds may differ), every one at MAX_LEVEL, none
 * derelict, none already merged, on tiles whose happiness sits at the field's
 * ceiling — computeField clamps to exactly 1, so `>= 1` is an exact test, not
 * a float gamble. Anchors are scanned in reading order (z, then x), and a
 * merge marks its four cells immediately, so an overlapping candidate later
 * in the same scan is no longer eligible: merged blocks are disjoint by
 * construction, and two identical boards merge identically.
 *
 * A merge is forever by design — nothing here re-checks happiness afterwards,
 * so a block never un-merges when the neighbourhood sours. What can break one
 * is only something the sim did not do itself: a cell cleared from the debug
 * console, a hand-edited save. revalidateBlocks releases those ghost anchors
 * at the top of every pass rather than letting them exclude their tiles from
 * play forever.
 *
 * Returns true when anything changed, so the caller can flag the structure
 * dirty and re-derive, the way dereliction and auto-build already do.
 */
export function tryMerges(state: CityState, field: Float32Array): boolean {
  let changed = revalidateBlocks(state)

  for (let z = 0; z < WORLD_SIZE - 1; z++) {
    for (let x = 0; x < WORLD_SIZE - 1; x++) {
      const anchor = tileIndex(x, z)
      const cells = blockCells(anchor)
      const first = state.grid[cells[0]]
      if (!first || first.mergeAnchor !== null) continue

      const group: Building[] = []
      for (const cell of cells) {
        const b = state.grid[cell]
        if (
          !b ||
          b.type !== first.type ||
          b.mergeAnchor !== null ||
          b.level !== MAX_LEVEL ||
          b.derelict ||
          field[cell] < 1
        ) {
          break
        }
        group.push(b)
      }
      if (group.length < cells.length) continue

      for (const b of group) b.mergeAnchor = anchor
      if (first.type === 'shop') {
        // A null kind is a shop saved before kinds existed; it votes general.
        const maxi = maxiCommerceKind(group.map((b) => b.commerceKind ?? 'general'))
        for (const b of group) b.commerceKind = maxi
      }
      // The anchor regrows, so the merge reads as an event on the board; this
      // is the same sim clock spawnBuilding stamps bornAt from.
      first.bornAt = state.time
      recordEvent(state, { kind: 'merged', at: state.time, where: anchor, type: first.type })
      changed = true
    }
  }

  return changed
}

/**
 * Release every anchor that no longer heads a complete block. Merges are
 * forever, so this should never fire on a state the sim produced itself; it
 * exists for the console poke and the hand-edited save, and it only clears
 * the cells still pointing at the broken anchor — a cell that has since
 * joined a real block keeps it.
 */
function revalidateBlocks(state: CityState): boolean {
  let changed = false
  const checked = new Set<number>()
  for (const b of state.grid) {
    if (!b || b.mergeAnchor === null) continue
    const anchor = b.mergeAnchor
    if (checked.has(anchor)) continue
    checked.add(anchor)
    // An anchor outside the top-left-corner grid can never head a block, and
    // asking isMergedBlock about one would read past the edge of the map.
    const validCorner = tileX(anchor) < WORLD_SIZE - 1 && tileZ(anchor) < WORLD_SIZE - 1
    if (validCorner && isMergedBlock(state, anchor)) continue
    for (const cell of blockCells(anchor)) {
      const c = state.grid[cell]
      if (c && c.mergeAnchor === anchor) {
        c.mergeAnchor = null
        changed = true
      }
    }
  }
  return changed
}
