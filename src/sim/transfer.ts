/**
 * Moving a city between browsers, by hand.
 *
 * The save lives in localStorage, which means it is tied to one browser on one
 * machine and is thrown away by a routine "clear site data". For a game whose
 * whole appeal is a city you have been growing for a week, that is a real
 * hazard, and a static site has nowhere to put a backup. So: a block of text
 * the player owns.
 *
 * It is plain JSON on purpose rather than something base64-ish and opaque. It
 * is trivially inspectable, it survives being pasted into anything, and when a
 * paste fails the player can see what they actually pasted.
 */

import { cityFromJson } from './save'
import type { CityState } from './types'

export function exportCity(state: CityState): string {
  return JSON.stringify(state)
}

export type ImportResult =
  | { ok: true; state: CityState }
  | { ok: false; reason: string }

/**
 * Runs the paste through exactly the same validator a loaded save goes
 * through. A city typed in by hand is no more trusted than one found in
 * storage, and there is only one definition of a valid city.
 */
export function importCity(text: string): ImportResult {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, reason: 'Nothing pasted' }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, reason: 'That is not a city — it is not even JSON' }
  }

  const state = cityFromJson(parsed)
  if (!state) return { ok: false, reason: 'That JSON is not a city this version can open' }

  // An imported city arrives with whatever wall-clock stamp it was exported
  // with, which could be days old. Crediting offline earnings for the gap
  // would turn the export box into a coin printer, so the clock starts now.
  state.lastSavedAt = Date.now()
  return { ok: true, state }
}
