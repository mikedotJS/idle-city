/**
 * Choosing between two copies of the same city: this device's running one,
 * and whatever a signed-in player's account last saved to the cloud (see
 * net/citysync.ts, which calls this).
 *
 * Deliberately dumb: whichever was saved more recently, by real clock time,
 * wins outright. No merge — a city is one coherent grid, queue and history;
 * splicing two of them together would produce a city neither device ever
 * actually had.
 *
 * Takes the local side's timestamp as a plain number, not the running
 * `CityState.lastSavedAt` field: `load()` resets that field to "now" the
 * moment a save is loaded (see its own doc comment), so by the time a page
 * has finished loading, the running state's own `lastSavedAt` no longer
 * says when it was actually last saved — only `LoadResult.savedAt` still
 * does. Comparing against the running state's field here would make a
 * stale local city look newer than it is on every single reload, which
 * defeats this feature outright: the caller must pass the real thing.
 */

import type { CityState } from './types'

/**
 * True when the cloud city is strictly newer than the local save time
 * given. A tie keeps local — this runs right after every save, so a tie
 * (most commonly: nothing on the cloud has changed since we last pushed
 * this exact state) should not trigger a pointless swap.
 */
export function remoteIsNewer(localSavedAt: number, remote: CityState): boolean {
  return remote.lastSavedAt > localSavedAt
}
