/**
 * What the city did while you were not looking at it.
 *
 * The design's whole loop is coming back to a city that grew itself into
 * trouble — but the trouble has to be *found*, and on a second monitor that
 * means squinting at a board you last studied ten minutes ago. This records
 * what actually happened so it can be said plainly instead.
 *
 * Note what it is NOT. "While you were away" would record nothing: the sim is
 * frozen whenever the tab is hidden, so an absence changes only the coin
 * counter. What changes unwatched is a tab that is open and ignored, which is
 * exactly how this game is meant to be played. So the window is measured from
 * the last time the player touched the city, not from the last time they were
 * present.
 */

import { tileX, tileZ } from './grid'
import type { BuildingType, CityState } from './types'

/** Kept small on purpose: it rides in every save. */
export const EVENT_LIMIT = 48

export type CityEventKind =
  | 'built'
  | 'upgraded'
  | 'derelict'
  | 'recovered'
  | 'demolished'
  | 'land'

export interface CityEvent {
  kind: CityEventKind
  /** Sim time, so it survives a reload alongside everything else. */
  at: number
  /** Tile index, or the parcel index for a land purchase. */
  where: number
  type?: BuildingType
  level?: number
}

export function recordEvent(state: CityState, event: CityEvent): void {
  state.events.push(event)
  // A ring in spirit: the oldest go first, because a summary nobody read is
  // worth less than a save that stays small.
  if (state.events.length > EVENT_LIMIT) {
    state.events.splice(0, state.events.length - EVENT_LIMIT)
  }
}

/**
 * Called whenever the player acts on the city. Everything before this moment
 * has been seen, by definition — they were looking when they did it.
 */
export function noteInteraction(state: CityState): void {
  state.lastSeenAt = state.time
}

export function eventsSinceSeen(state: CityState): CityEvent[] {
  return state.events.filter((e) => e.at > state.lastSeenAt)
}

export interface ActivitySummary {
  built: number
  upgraded: number
  derelict: number
  recovered: number
  /** Sim seconds covered by this summary. */
  span: number
  /**
   * The tile the worst news clusters around, or null. A count tells you the
   * city rotted; a place tells you where to go and look.
   */
  trouble: number | null
  troubleCount: number
}

/**
 * Collapses the log into something worth a sentence. Dereliction is what the
 * player has to act on, so that is what gets located: the tile with the most
 * derelictions near it, which is nearly always the factory that caused them.
 */
export function summarise(state: CityState): ActivitySummary {
  const since = eventsSinceSeen(state)
  const summary: ActivitySummary = {
    built: 0,
    upgraded: 0,
    derelict: 0,
    recovered: 0,
    span: Math.max(0, state.time - state.lastSeenAt),
    trouble: null,
    troubleCount: 0,
  }

  const rotted: number[] = []
  for (const event of since) {
    if (event.kind === 'built') summary.built++
    else if (event.kind === 'upgraded') summary.upgraded++
    else if (event.kind === 'recovered') summary.recovered++
    else if (event.kind === 'derelict') {
      summary.derelict++
      rotted.push(event.where)
    }
  }

  if (rotted.length > 0) {
    // The rotted tile with the most other rotted tiles within three of it.
    let best = rotted[0]
    let bestCount = 0
    for (const tile of rotted) {
      let count = 0
      for (const other of rotted) {
        const dx = tileX(tile) - tileX(other)
        const dz = tileZ(tile) - tileZ(other)
        if (Math.hypot(dx, dz) <= 3) count++
      }
      if (count > bestCount) {
        bestCount = count
        best = tile
      }
    }
    summary.trouble = best
    summary.troubleCount = bestCount
  }

  return summary
}

/** True when there is enough news to be worth interrupting anyone over. */
export function worthReporting(summary: ActivitySummary): boolean {
  return summary.derelict > 0 || summary.built >= 3 || summary.upgraded > 0
}
