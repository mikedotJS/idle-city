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
  building: Building
  /** Sim time it happened, so the UI can say how long ago. */
  at: number
}

let stack: Demolition[] = []

export function rememberDemolition(state: CityState, building: Building): void {
  // The stored object is the very one that was on the grid; nothing else holds
  // a reference to it once demolish() nulls the cell, so it cannot be mutated
  // behind our back.
  stack.push({ building, at: state.time })
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
 * Put the last demolished building back, exactly as it stood. Fails if
 * something has since been built on its tile — silently rebuilding over that
 * would destroy a second building to restore the first.
 */
export function undoDemolition(state: CityState): boolean {
  const last = stack.pop()
  if (!last) return false
  if (state.grid[last.building.tile]) return false
  state.grid[last.building.tile] = last.building
  // builtCount is a lifetime tally and demolishing never decremented it, so
  // restoring must not increment it either — otherwise demolish-and-undo would
  // quietly inflate the cost of the next one of that type.
  return true
}

/** Called when the city itself is replaced: loaded, restarted, imported. */
export function forgetDemolitions(): void {
  stack = []
}
