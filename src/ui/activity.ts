/**
 * "What the city did while you weren't looking" — a notification, not a HUD
 * element. The sim (`sim/events.ts`) already decides what happened and
 * whether it is worth a sentence; this file only decides whether *now* is a
 * good time to say it, and how to say it in words instead of a stat block.
 *
 * Same shape as hud.ts: reads sim state, never mutates it, caches every
 * element up front, and `update()` only touches the DOM when the thing it
 * would show has actually changed.
 */

import './activity.css'

import { BUILDINGS } from '../sim/buildings'
import { WORLD_SIZE } from '../sim/config'
import { noteInteraction, summarise, worthReporting } from '../sim/events'
import type { ActivitySummary } from '../sim/events'
import { tileX, tileZ } from '../sim/grid'
import type { CityState } from '../sim/types'
import { formatDuration } from './format'

export interface ActivityCallbacks {
  /** Swing the camera to a tile. Implemented by main.ts. */
  onGoTo(tile: number): void
}

export interface ActivityPanel {
  /** Called every animation frame. Cheap: bail early when nothing changed. */
  update(state: CityState): void
  dispose(): void
}

/**
 * `worthReporting` says the news is big enough; this says it is *old* enough.
 * Without a floor, a fast-building queue can clear `built >= 3` within a few
 * seconds of a click and pop the panel up over the player's own cursor — news
 * about an action they are still watching happen is not news. Ninety seconds
 * is comfortably past a queue's fastest three-item burst (roughly a 5-16s
 * build interval depending on happiness, so worst case ~48s) and well short
 * of DERELICT_DELAY's own 30s-plus ramp-up, so real trouble is never held
 * back waiting on this floor — only clicks are.
 */
const MIN_SPAN_SECONDS = 90

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function setText(node: HTMLElement, value: string): void {
  if (node.textContent !== value) node.textContent = value
}

/**
 * A place, not a coordinate. The compass mapping matches the one the terrain
 * generator already uses (sim/terrain.ts: z=0 is north, x=WORLD_SIZE-1 is
 * east), so "the northeast" here points at the same corner of the board a
 * player would call by that name.
 */
function compassOf(tile: number): string {
  const half = WORLD_SIZE / 2
  const ns = tileZ(tile) < half ? 'north' : 'south'
  const ew = tileX(tile) < half ? 'west' : 'east'
  return ns + ew
}

/**
 * What kind of building is rotting, when we can still tell. `trouble` is a
 * tile, not a building record, and by the time the player looks it may have
 * recovered or been bulldozed — so this only claims a type when the tile
 * still actually holds a derelict building, and falls back to the generic
 * word otherwise rather than guessing.
 */
function derelictNoun(state: CityState, summary: ActivitySummary): string {
  const tile = summary.trouble
  const building = tile !== null ? state.grid[tile] : null
  const base = building && building.derelict ? BUILDINGS[building.type].label.toLowerCase() : 'building'
  return summary.derelict === 1 ? base : base + 's'
}

/** "a, b, and c" — never an Oxford-comma-less pair, never a trailing "and" on one item. */
function joinAnd(parts: string[]): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts[0] + ' and ' + parts[1]
  return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1]
}

/**
 * One sentence, always led by the worst news. Dereliction is what the player
 * has to act on, so it goes first and carries the place; growth and recovery
 * ride along after it as context, not as separate bullet points. With no
 * dereliction the same clauses still read fine as the whole sentence.
 */
function buildMessage(state: CityState, summary: ActivitySummary): string {
  // "In the last", never "while you were away". The sim is frozen whenever the
  // tab is hidden, so this window is time the player was present and simply
  // not watching — usually with the game open on a second monitor. Telling
  // someone they were away while they have been sitting right there is the
  // kind of small lie that makes the rest of the text feel written rather than
  // true. See the header of sim/events.ts, which is why the window is measured
  // from the last action rather than from the last visit.
  const span = formatDuration(summary.span)
  const clauses: string[] = []

  if (summary.derelict > 0) {
    const noun = derelictNoun(state, summary)
    const place = summary.trouble !== null ? ` in the ${compassOf(summary.trouble)} of town` : ''
    clauses.push(`${summary.derelict} ${noun} went derelict${place}`)
  }
  if (summary.recovered > 0) {
    clauses.push(`${summary.recovered} recovered`)
  }
  if (summary.upgraded > 0) {
    clauses.push(`${summary.upgraded} upgraded`)
  }
  if (summary.built > 0) {
    clauses.push(`${summary.built} new building${summary.built === 1 ? '' : 's'} went up`)
  }

  return `In the last ${span}, ${joinAnd(clauses)}.`
}

export function createActivityPanel(
  root: HTMLElement,
  callbacks: ActivityCallbacks,
): ActivityPanel {
  const wrap = el('div', 'activity-wrap')
  const panel = el('section', 'activity-panel')
  panel.hidden = true

  const dot = el('span', 'activity-panel__dot')
  const body = el('div', 'activity-panel__body')
  const text = el('p', 'activity-panel__text')
  const actions = el('div', 'activity-panel__actions')

  const goToButton = el('button', 'btn btn--primary', 'Show me')
  goToButton.type = 'button'
  goToButton.hidden = true

  const dismissButton = el('button', 'btn btn--ghost', 'Got it')
  dismissButton.type = 'button'

  const closeButton = el('button', 'activity-panel__close', '×')
  closeButton.type = 'button'
  closeButton.setAttribute('aria-label', 'Dismiss')

  actions.append(goToButton, dismissButton)
  body.append(text, actions)
  panel.append(dot, body, closeButton)
  wrap.append(panel)
  root.append(wrap)

  // The panel outlives any single frame's summary, so the tile to jump to and
  // the state to close the window on both have to be cached here rather than
  // recomputed inside a click handler that only ever fires on a real click.
  let latestState: CityState | null = null
  let currentTrouble: number | null = null
  let shown = false
  let lastSignature = ''

  function dismiss(): void {
    if (latestState) noteInteraction(latestState)
    hide()
  }

  function hide(): void {
    if (!shown) return
    shown = false
    panel.hidden = true
    lastSignature = ''
  }

  goToButton.addEventListener('click', () => {
    if (currentTrouble !== null) callbacks.onGoTo(currentTrouble)
  })
  dismissButton.addEventListener('click', dismiss)
  closeButton.addEventListener('click', dismiss)

  function update(state: CityState): void {
    latestState = state
    const summary = summarise(state)

    if (!worthReporting(summary) || summary.span < MIN_SPAN_SECONDS) {
      hide()
      return
    }

    // Recomputed every frame (it is three field comparisons and a string),
    // but the DOM itself — the expensive part — is only touched when the
    // sentence it would show has actually changed.
    const signature = `${summary.built}|${summary.upgraded}|${summary.derelict}|${summary.recovered}|${summary.trouble}`
    currentTrouble = summary.trouble
    goToButton.hidden = summary.trouble === null

    if (signature === lastSignature) {
      if (!shown) {
        shown = true
        panel.hidden = false
      }
      return
    }
    lastSignature = signature

    setText(text, buildMessage(state, summary))
    panel.classList.toggle('activity-panel--trouble', summary.derelict > 0)

    if (!shown) {
      shown = true
      panel.hidden = false
    }
  }

  function dispose(): void {
    wrap.remove()
  }

  return { update, dispose }
}
