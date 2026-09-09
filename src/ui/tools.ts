/**
 * The tools panel: export/import, speed control, undo-demolition.
 *
 * Three quality-of-life features bolted onto a game that otherwise has none:
 * the save is trapped in one browser's localStorage, the sim only ever runs
 * at 1x, and demolishing is instant, free and irreversible. None of that is
 * part of the core loop, so it lives in its own collapsed-by-default panel
 * rather than crowding the board — see tools.css for where it sits.
 *
 * Same shape as hud.ts: reads sim state, never mutates it directly, and every
 * player action leaves through `ToolsCallbacks`. `update()` runs every
 * animation frame, so element references are cached up front and the DOM is
 * only touched when a displayed value actually changed.
 */

import './tools.css'

import { BUILDINGS } from '../sim/buildings'
import { peekDemolition, undoDemolition, undoDepth } from '../sim/history'
import { exportCity, importCity } from '../sim/transfer'
import type { CityState } from '../sim/types'
import { formatDuration } from './format'

export interface ToolsCallbacks {
  /** Multiplier applied to sim time. Called only when it actually changes. */
  onSetSpeed(multiplier: number): void
  /** Replace the running city wholesale. main.ts re-syncs the renderer. */
  onImport(state: CityState): void
  /** Something changed on the grid; main.ts must rebuild the instances. */
  onStructureChanged(): void
  /** Show a transient message through the existing HUD toast. */
  onToast(message: string): void
  /** A PNG data URL of the board as it currently looks. */
  onPostcard(): string
}

export interface ToolsPanel {
  /** The whole tools block (toggle + collapsible panel), for a caller to place. */
  element: HTMLElement
  /** Called every animation frame. Cheap: bail early when nothing changed. */
  update(state: CityState): void
  dispose(): void
}

/**
 * Speed steps: 1x / 2x / 4x.
 *
 * The sim runs on a fixed 10Hz tick and the auto-builder fires roughly every
 * 8 sim-seconds. At 4x that cycle takes 2 real seconds — still a visible
 * "something just went up", still legible as construction. A step past that
 * (8x, 16x...) would compress that 8s cycle to under a second, at which point
 * fast-forward stops being a way to watch your city grow faster and starts
 * being a way to skip watching it grow at all — which is skipping the game.
 * 1x/2x/4x gives a real choice without offering a button whose best use is
 * "make the idle game stop being a thing you look at".
 */
const SPEED_STEPS = [1, 2, 4] as const

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

export function createToolsPanel(
  getState: () => CityState,
  callbacks: ToolsCallbacks,
): ToolsPanel {
  const wrap = el('div', 'tools-root')

  // ------------------------------------------------------------------ toggle

  const toggleButton = el('button', 'btn tools-toggle', 'Tools')
  toggleButton.type = 'button'
  toggleButton.setAttribute('aria-expanded', 'false')

  const panel = el('section', 'panel tools-panel')
  panel.hidden = true
  panel.append(el('h2', 'panel__title', 'Tools'))

  // ------------------------------------------------------------------- speed

  const speedSection = el('div', 'tools-section')
  speedSection.append(el('p', 'tools-section__title', 'Speed'))
  const speedRow = el('div', 'tools-speed-row')
  const speedButtons: { multiplier: number; button: HTMLButtonElement }[] = []
  let currentSpeed = 1

  function paintSpeed(): void {
    for (const entry of speedButtons) {
      entry.button.classList.toggle('is-selected', entry.multiplier === currentSpeed)
    }
  }

  for (const multiplier of SPEED_STEPS) {
    const button = el('button', 'btn tools-speed-btn', multiplier + 'x')
    button.type = 'button'
    button.addEventListener('click', () => {
      if (multiplier === currentSpeed) return
      currentSpeed = multiplier
      paintSpeed()
      callbacks.onSetSpeed(multiplier)
    })
    speedRow.append(button)
    speedButtons.push({ multiplier, button })
  }
  paintSpeed()
  speedSection.append(
    speedRow,
    el('p', 'hint', 'Runs the whole city faster, the auto-builder with it.'),
  )

  // -------------------------------------------------------------------- undo

  const undoSection = el('div', 'tools-section')
  undoSection.append(el('p', 'tools-section__title', 'Undo demolition'))
  const undoButton = el('button', 'btn tools-undo-btn', 'Nothing to undo')
  undoButton.type = 'button'
  undoButton.disabled = true
  undoButton.addEventListener('click', () => {
    const demo = peekDemolition()
    if (!demo) return
    const label = BUILDINGS[demo.building.type].label
    const state = getState()
    const restored = undoDemolition(state)
    if (restored) {
      callbacks.onStructureChanged()
      callbacks.onToast(`Restored the ${label.toLowerCase()}.`)
    } else {
      // undoDemolition() already popped this entry off the stack even on
      // refusal — it cannot be retried, so say what happened to it.
      callbacks.onToast(
        `Could not restore the ${label.toLowerCase()}. Something else stands on that tile now.`,
      )
    }
    refreshUndo(getState())
  })
  undoSection.append(
    undoButton,
    el('p', 'hint', 'Puts back the last building you demolished, if nothing has replaced it.'),
  )

  function refreshUndo(state: CityState): void {
    const demo = peekDemolition()
    if (undoDepth() === 0 || !demo) {
      setText(undoButton, 'Nothing to undo')
      if (!undoButton.disabled) undoButton.disabled = true
      return
    }
    const label = BUILDINGS[demo.building.type].label
    const ago = formatDuration(Math.max(0, state.time - demo.at))
    setText(undoButton, `Undo: bring back the ${label} (Lv ${demo.building.level}), demolished ${ago} ago`)
    if (undoButton.disabled) undoButton.disabled = false
  }

  // ------------------------------------------------------------------ export

  const exportSection = el('div', 'tools-section')
  exportSection.append(
    el('p', 'tools-section__title', 'Export city'),
    el('p', 'hint', 'A block of text that is your city. Copy it somewhere safe.'),
  )
  const exportTextarea = document.createElement('textarea')
  exportTextarea.className = 'tools-textarea'
  exportTextarea.rows = 3
  exportTextarea.readOnly = true
  exportTextarea.spellcheck = false
  exportTextarea.placeholder = 'Click "Export" to fill this in.'
  const exportRow = el('div', 'tools-row')
  const exportButton = el('button', 'btn', 'Export')
  exportButton.type = 'button'
  const copyButton = el('button', 'btn', 'Copy')
  copyButton.type = 'button'
  exportRow.append(exportButton, copyButton)
  exportSection.append(exportTextarea, exportRow)

  function refreshExport(): void {
    exportTextarea.value = exportCity(getState())
    exportTextarea.select()
  }
  exportButton.addEventListener('click', refreshExport)

  copyButton.addEventListener('click', () => {
    if (exportTextarea.value === '') refreshExport()
    const text = exportTextarea.value
    const clipboard = navigator.clipboard
    if (clipboard && typeof clipboard.writeText === 'function') {
      clipboard.writeText(text).then(
        () => callbacks.onToast('City code copied to clipboard.'),
        () => fallbackCopy(),
      )
    } else {
      fallbackCopy()
    }
    function fallbackCopy(): void {
      exportTextarea.focus()
      exportTextarea.select()
      callbacks.onToast('Clipboard blocked. Press Ctrl/Cmd+C to copy the selected text.')
    }
  })

  // ------------------------------------------------------------------ import

  const importSection = el('div', 'tools-section')
  importSection.append(
    el('p', 'tools-section__title', 'Import city'),
    el(
      'p',
      'hint',
      'Paste an exported city below. This throws away the city currently running.',
    ),
  )
  const importTextarea = document.createElement('textarea')
  importTextarea.className = 'tools-textarea'
  importTextarea.rows = 3
  importTextarea.spellcheck = false
  importTextarea.placeholder = 'Paste a city code here'
  const importButton = el('button', 'btn tools-import-btn', 'Load city')
  importButton.type = 'button'
  importSection.append(importTextarea, importButton)

  // Destructive, so it asks twice — the same arm/confirm/timeout shape as the
  // "New city" button in hud.ts. A single misclick must not be able to wipe
  // the running city.
  let importArmed = false
  let importArmedTimer = 0

  function disarmImport(): void {
    if (!importArmed) return
    importArmed = false
    window.clearTimeout(importArmedTimer)
    setText(importButton, 'Load city')
    importButton.classList.remove('is-armed')
  }

  function runImport(): void {
    const result = importCity(importTextarea.value)
    if (!result.ok) {
      callbacks.onToast(result.reason)
      return
    }
    callbacks.onImport(result.state)
    callbacks.onStructureChanged()
    importTextarea.value = ''
    callbacks.onToast('City imported.')
  }

  importButton.addEventListener('click', (event) => {
    event.stopPropagation()
    if (importTextarea.value.trim() === '') {
      callbacks.onToast('Paste a city code first.')
      return
    }
    if (importArmed) {
      disarmImport()
      runImport()
      return
    }
    importArmed = true
    setText(importButton, 'Overwrite this city?')
    importButton.classList.add('is-armed')
    importArmedTimer = window.setTimeout(disarmImport, 4000)
  })
  window.addEventListener('click', disarmImport)

  // ----------------------------------------------------------------- assemble

  // --------------------------------------------------------------- postcard

  const postcardSection = el('div', 'tools-section')
  postcardSection.append(el('p', 'tools-section__title', 'Postcard'))
  const postcardButton = el('button', 'btn', 'Save a picture')
  postcardButton.type = 'button'
  postcardButton.addEventListener('click', () => {
    const url = callbacks.onPostcard()
    // A canvas that never drew is a 1x1 transparent PNG, whose data URL is
    // tiny. Handing the player a blank file is worse than telling them.
    if (url.length < 1000) {
      callbacks.onToast('The board has not drawn yet.')
      return
    }
    const link = el('a')
    link.href = url
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    link.download = `micro-city-${stamp}.png`
    // Never added to the document: an <a> only has to exist to be clicked, and
    // appending it means remembering to remove it on every path out of here.
    link.click()
    callbacks.onToast('Postcard saved.')
  })
  postcardSection.append(
    postcardButton,
    el('p', 'hint', 'A picture of the board as it looks right now.'),
  )

  panel.append(speedSection, undoSection, postcardSection, exportSection, importSection)

  toggleButton.addEventListener('click', () => {
    const opening = panel.hidden
    panel.hidden = !opening
    toggleButton.classList.toggle('is-open', opening)
    toggleButton.setAttribute('aria-expanded', String(opening))
    if (opening) refreshExport()
  })

  wrap.append(toggleButton, panel)

  refreshUndo(getState())

  function update(state: CityState): void {
    refreshUndo(state)
  }

  function dispose(): void {
    window.removeEventListener('click', disarmImport)
    wrap.remove()
  }

  return { element: wrap, update, dispose }
}
