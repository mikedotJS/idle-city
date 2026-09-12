/**
 * Undo, for demolition only.
 *
 * Demolishing is the one action in the game that is instant, free and
 * irreversible, which makes it the one action a misclick can actually cost you
 * — a level 3 house is twenty minutes of the city's own work, and there is no
 * way to buy it back. Everything else a misclick can do is either refundable by
 * playing on or was going to happen anyway.
 *
 * Deliberately NOT part of CityState: it is not saved, does not survive a
 * reload, and does not ride in the export. An undo history is a property of
 * this sitting at the keyboard, not of the city.
 */

import type { Building, CityState } from './types'

/** Enough to walk back a fumbled drag, not enough to rebuild a district. */
const DEPTH = 12

interface Demolition {
  /**
   * One per cell the demolition cleared — a single building, or the four of a
   * merged block, anchor first so labels read from it. The stored objects are
   * the very ones that were on the grid; nothing else holds a reference once
   * demolish() nulls the cells, so they cannot be mutated behind our back.
   * mergeAnchor and commerceKind ride along on them, so a restored block is a
   * valid merged block again.
   */
  buildings: Building[]
  /** Sim time it happened, so the UI can say how long ago. */
  at: number
}

let stack: Demolition[] = []

export function rememberDemolition(state: CityState, buildings: Building[]): void {
  stack.push({ buildings, at: state.time })
  if (stack.length > DEPTH) stack.splice(0, stack.length - DEPTH)
}

/** What undoing next would put back, or null. For labelling the button. */
export function peekDemolition(): Demolition | null {
  return stack.length === 0 ? null : stack[stack.length - 1]
}

export function undoDepth(): number {
  return stack.length
}

/**
 * Put the last demolished lot back, exactly as it stood. Fails if anything
 * has since been built on ANY of its tiles — silently rebuilding over that
 * would destroy a second building to restore the first, and restoring half a
 * merged block would leave a broken anchor on the board.
 */
export function undoDemolition(state: CityState): boolean {
  const last = stack.pop()
  if (!last) return false
  for (const b of last.buildings) {
    if (state.grid[b.tile]) return false
  }
  for (const b of last.buildings) {
    state.grid[b.tile] = b
  }
  // builtCount is a lifetime tally and demolishing never decremented it, so
  // restoring must not increment it either — otherwise demolish-and-undo would
  // quietly inflate the cost of the next one of that type.
  return true
}

/** Called when the city itself is replaced: loaded, restarted, imported. */
export function forgetDemolitions(): void {
  stack = []
}
