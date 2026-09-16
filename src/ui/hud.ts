/**
 * The HUD: plain DOM over the 3D board.
 *
 * Reads sim state, never mutates it. Every player action leaves through
 * `HudCallbacks`. `update()` runs every animation frame, so it caches every
 * element reference up front and only touches the DOM when a displayed value
 * has actually changed.
 */

import type { Tool } from '../render/api'
import { BUILDINGS, BUILDING_TYPES, buildingCost } from '../sim/buildings'
import { OFFLINE_CAP_SECONDS } from '../sim/config'
import type { BuildingType, CityState, Derived, QueueableType } from '../sim/types'
import type { HoverInfo, Hud, HudCallbacks } from './api'
import { BUILDING_ICONS } from './buildingIcons'
import { createDialogFocus } from './focusTrap'
import { formatCoins, formatDuration, formatPercent, formatRate, happinessBand } from './format'
import { RESOURCE_ICONS } from './resourceIcons'
import type { HappinessKey } from './format'

/**
 * Buildings the player places by hand — the ones that emit into the field.
 *
 * Read off the registry rather than listed by hand. A hardcoded list was a
 * second source of truth for which buildings the player places: adding the
 * station left it unplaceable, with nothing anywhere reporting a problem.
 */
const MANUAL_TYPES: BuildingType[] = BUILDING_TYPES.filter(
  (type) => BUILDINGS[type].placement === 'manual',
)
/** Buildings the auto-builder will take off the queue. */
const QUEUE_TYPES: QueueableType[] = ['house', 'shop']

const MAX_TOASTS = 4
const TOAST_LIFE_MS = 2600
const TOAST_FADE_MS = 400
/** Exponential approach rate for the coin counter, in 1/seconds. */
const COIN_EASE = 9
/** Frame deltas above this (a hidden tab) are clamped so nothing lurches. */
const MAX_FRAME_DT = 0.25

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

function setClass(node: HTMLElement, value: string): void {
  if (node.className !== value) node.className = value
}

function buildingIcon(type: BuildingType, className: string): HTMLImageElement {
  const img = el('img', className)
  img.src = BUILDING_ICONS[type]
  img.alt = ''
  return img
}

/**
 * Demolish has no building of its own to draw, so it gets a plain X glyph
 * instead of one of the PNGs in buildingIcons.ts — drawn as an inline SVG
 * (not an <img>) so it tints with `currentColor` like any other icon-as-text
 * would, with no asset file to add just for one tool.
 */
function demolishIcon(className: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', className)
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M5 5l14 14M19 5L5 19')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '2.5')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('fill', 'none')
  svg.append(path)
  return svg
}

/**
 * Two plain bars — the universal "stop/pause" glyph — for the queue strip's
 * inline pause control. An inline SVG for the same reason demolishIcon is:
 * it tints with `currentColor`, and doesn't need an asset file of its own.
 */
function pauseIcon(className: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', className)
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute(
    'd',
    'M7 5.5a1 1 0 0 1 1 1v11a1 1 0 1 1-2 0v-11a1 1 0 0 1 1-1Zm10 0a1 1 0 0 1 1 1v11a1 1 0 1 1-2 0v-11a1 1 0 0 1 1-1Z',
  )
  path.setAttribute('fill', 'currentColor')
  svg.append(path)
  return svg
}

function resourceIcon(key: keyof typeof RESOURCE_ICONS, className: string): HTMLImageElement {
  const img = el('img', className)
  img.src = RESOURCE_ICONS[key]
  img.alt = ''
  return img
}

function sameTool(a: Tool, b: Tool): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'place' && b.kind === 'place') return a.type === b.type
  return true
}

/** "house" -> "houses". Both queueable labels pluralise with an s. */
function pluralLabel(type: BuildingType): string {
  return BUILDINGS[type].label.toLowerCase() + 's'
}

interface ToolCard {
  button: HTMLButtonElement
  tool: Tool
  /** null for the demolish tool, which has no cost to track. */
  type: BuildingType | null
  costNode: HTMLElement
  lastCost: number
  lastAffordable: boolean | null
}

interface QueueAddButton {
  type: QueueableType
  costNode: HTMLElement
  lastCost: number
}

export function createHud(root: HTMLElement, cb: HudCallbacks): Hud {
  // -------------------------------------------------------------- top strip

  // Coins are the hero figure: big and bold, with the income rate directly
  // beneath it. Happiness renders as a small colored meter (fill color
  // switches per mood band, see the `topstrip--<band>` class below) with its
  // percentage as a label, and population is the smallest, least prominent
  // line — see the design reference this task builds to.
  const topStrip = el('section', 'topstrip')

  const tsCoins = el('span', 'topstrip__coins', '0')
  const tsCoinRow = el('div', 'topstrip__coinrow')
  tsCoinRow.append(resourceIcon('coins', 'topstrip__coin-icon'), tsCoins)

  const tsRateValue = el('span', undefined, '+0.0/s')
  const tsRate = el('div', 'topstrip__rate')
  tsRate.append(resourceIcon('income', 'topstrip__rate-icon'), tsRateValue)

  const tsHappyFill = el('div', 'topstrip__meter-fill')
  const tsHappyTrack = el('div', 'topstrip__meter-track')
  tsHappyTrack.append(tsHappyFill)
  const tsHappyValue = el('span', 'topstrip__meter-label', '50%')
  const tsHappy = el('div', 'topstrip__happy')
  tsHappy.append(resourceIcon('happiness', 'topstrip__happy-icon'), tsHappyTrack, tsHappyValue)

  const tsPopValue = el('span', undefined, '0')
  const tsPop = el('div', 'topstrip__pop')
  tsPop.append(resourceIcon('population', 'topstrip__pop-icon'), tsPopValue)

  const tsNext = el('div', 'topstrip__next', '')

  const tsInfo = el('span', 'topstrip__info')
  tsInfo.append(resourceIcon('info', 'topstrip__info-icon'))
  tsInfo.tabIndex = 0
  tsInfo.title =
    'Income multiplier = 0.50 + happiness, so 0.50x at worst and 1.50x at best — the rate shown here already includes it. A happier city earns more from the same buildings, and builds faster too.'

  topStrip.append(tsCoinRow, tsRate, tsHappy, tsPop, tsNext, tsInfo)

  // ------------------------------------------------------------ inspect card

  /**
   * The single tile-info readout, in the right rail at every viewport size
   * (see layout.ts/api.ts's `inspectElement` doc) — replaces what used to be
   * two copies of the same panel (one nested in the Ville tab for phone/
   * tablet, one floating free on desktop). It never hides: with nothing
   * hovered or selected it falls back to `INSPECT_EMPTY_LINE` instead of
   * disappearing, so the right rail always holds the same card rather than
   * the layout shifting as the player moves the cursor.
   */
  const INSPECT_EMPTY_TITLE = 'Nothing selected'
  const INSPECT_EMPTY_LINE = 'Hover a tile or building to see what it is.'

  const inspectPanel = el('section', 'panel panel--inspect')
  const inspectHead = el('div', 'hover__head')
  const inspectIcon = el('img', 'hover__icon')
  inspectIcon.alt = ''
  inspectIcon.hidden = true
  const inspectTitle = el('div', 'hover__title')
  inspectHead.append(inspectIcon, inspectTitle)
  const inspectLines = el('div', 'hover__lines')
  const inspectCost = el('div', 'hover__cost')
  inspectCost.hidden = true
  inspectPanel.append(inspectHead, inspectLines, inspectCost)
  // Built already showing the placeholder, matching EMPTY_SIGNATURE below,
  // so the card never has a blank frame before the first real hover.
  setText(inspectTitle, INSPECT_EMPTY_TITLE)
  inspectLines.append(el('div', 'hover__line', INSPECT_EMPTY_LINE))

  // -------------------------------------------------------------- build dock

  // A permanent row of icon tiles in the dock bar itself (see shell.ts/
  // shell.css) rather than a panel tucked inside the Ville tab's popover —
  // picking what to build is the single most frequent action in the game,
  // so it no longer costs an extra tap to open a menu first. Each tile is
  // just an icon and a cost badge; the full name and blurb that used to sit
  // on the card live in the tooltip (`title`) instead — the same trade the
  // nav tabs in the bar already made.
  const buildDock = el('div', 'dock-build')
  const buildScroll = el('div', 'dock-build__scroll')
  const cards: ToolCard[] = []

  for (const type of MANUAL_TYPES) {
    const def = BUILDINGS[type]
    const tile = el('button', 'tile')
    tile.type = 'button'
    tile.title = `${def.label} — ${formatCoins(def.baseCost)} coins. ${def.blurb}`
    tile.setAttribute('aria-label', def.label)
    const costNode = el('span', 'tile__cost', formatCoins(def.baseCost))
    tile.append(buildingIcon(type, 'tile__icon'), costNode)
    const tool: Tool = { kind: 'place', type }
    tile.addEventListener('click', () => select(tool))
    buildScroll.append(tile)
    cards.push({ button: tile, tool, type, costNode, lastCost: -1, lastAffordable: null })
  }

  buildScroll.append(el('div', 'dock-divider'))

  const demolishTile = el('button', 'tile tile--demolish')
  demolishTile.type = 'button'
  demolishTile.title = 'Demolish — free. Clear a tile instantly. Costs nothing, refunds nothing.'
  demolishTile.setAttribute('aria-label', 'Demolish')
  const demolishCost = el('span', 'tile__cost', 'free')
  demolishTile.append(demolishIcon('tile__icon'), demolishCost)
  const demolishTool: Tool = { kind: 'demolish' }
  demolishTile.addEventListener('click', () => select(demolishTool))
  buildScroll.append(demolishTile)
  cards.push({
    button: demolishTile,
    tool: demolishTool,
    type: null,
    costNode: demolishCost,
    lastCost: 0,
    lastAffordable: null,
  })

  buildDock.append(buildScroll)

  // A restart throws the city away, so it asks twice. The second press is the
  // confirmation, and moving the pointer away or waiting cancels it — nobody
  // should lose three hours to a misclick next to "Pause building".
  const restartButton = el('button', 'btn btn--ghost btn--danger', 'New city')
  restartButton.type = 'button'
  restartButton.title = 'Abandon this city and start again on fresh land.'
  let armed = false
  let armedTimer = 0

  function disarm(): void {
    if (!armed) return
    armed = false
    window.clearTimeout(armedTimer)
    setText(restartButton, 'New city')
    restartButton.classList.remove('is-armed')
  }

  restartButton.addEventListener('click', (event) => {
    event.stopPropagation()
    if (armed) {
      disarm()
      cb.onRestart()
      return
    }
    armed = true
    setText(restartButton, 'Confirm?')
    restartButton.classList.add('is-armed')
    armedTimer = window.setTimeout(disarm, 4000)
  })

  // Cancelling on pointerleave was the obvious guard and it broke the button
  // outright: arming widened it, the row reflowed, the pointer ended up outside
  // its own box, pointerleave fired, and the press disarmed itself in under a
  // frame. Every click armed and cancelled, so nothing ever happened. The
  // confirm label is now short enough to fit the reserved width, and cancelling
  // is a click somewhere else or four seconds of hesitation.
  window.addEventListener('click', disarm)

  // --------------------------------------------------------- queue strip

  // A slim strip docked directly above the build dock (see shell.ts/
  // shell.css — it shares the same fixed bottom-center cluster as the bar,
  // not a floating panel of its own) showing what the auto-builder is
  // working toward right now, plus the queue's own controls — adding to it
  // and pausing it — as small inline icon buttons at its end. Those used to
  // live in a separate controls-only panel tucked in the Ville tab; now the
  // strip is fully self-sufficient, so that panel is gone. Because the
  // controls live here too, the strip itself always stays on screen (only
  // its "now building" readout hides when the queue is empty) — it's the
  // only place left to start the queue back up.
  const queueStrip = el('div', 'queue-strip')
  const queueStripIcon = el('img', 'queue-strip__icon')
  queueStripIcon.alt = ''
  const queueStripName = el('span', 'queue-strip__name')
  const queueStripFill = el('div', 'queue-strip__fill')
  const queueStripTrack = el('div', 'queue-strip__track')
  queueStripTrack.append(queueStripFill)
  const queueStripBody = el('div', 'queue-strip__body')
  queueStripBody.append(queueStripName, queueStripTrack)
  const queueStripNow = el('div', 'queue-strip__now')
  queueStripNow.hidden = true
  queueStripNow.append(queueStripIcon, queueStripBody)
  const queueStripWaiting = el('span', 'queue-strip__waiting')
  queueStripWaiting.hidden = true

  const queueStripActions = el('div', 'queue-strip__actions')
  const addButtons: QueueAddButton[] = []

  for (const type of QUEUE_TYPES) {
    const def = BUILDINGS[type]
    const button = el('button', 'queue-strip__action')
    button.type = 'button'
    const costNode = el('span', 'queue-strip__action-cost', formatCoins(def.baseCost))
    button.append(buildingIcon(type, 'queue-strip__action-icon'), costNode)
    button.title = `Add ${def.label} to the queue — ${formatCoins(def.baseCost)} coins. ${def.blurb}`
    button.setAttribute('aria-label', 'Add ' + def.label)
    button.addEventListener('click', () => cb.onQueue(type))
    queueStripActions.append(button)
    addButtons.push({ type, costNode, lastCost: -1 })
  }

  const pauseButton = el('button', 'queue-strip__pause')
  pauseButton.type = 'button'
  pauseButton.title = 'Empty the queue — the auto-builder stops until something is added again.'
  pauseButton.setAttribute('aria-label', 'Pause building')
  pauseButton.append(pauseIcon('queue-strip__pause-icon'))
  pauseButton.addEventListener('click', () => cb.onClearQueue())
  queueStripActions.append(pauseButton)

  queueStrip.append(queueStripNow, queueStripWaiting, queueStripActions)

  // Its own panel, not a third button in the queue's action row. Restarting is
  // not a queue action, and crowding that row made it wrap, which overflowed
  // the panel and pushed the button out of reach entirely.
  const restartPanel = el('section', 'panel panel--restart')
  restartPanel.append(restartButton)

  // ------------------------------------------------------------------ toasts

  const toastLayer = el('div', 'toasts')

  // -------------------------------------------------------- offline earnings

  const offlineOverlay = el('div', 'overlay')
  offlineOverlay.hidden = true
  const offlineCard = el('section', 'panel panel--offline')
  offlineCard.setAttribute('role', 'dialog')
  offlineCard.setAttribute('aria-modal', 'true')
  offlineCard.setAttribute('aria-labelledby', 'offline-title')
  offlineCard.tabIndex = -1
  const offlineTitle = el('h2', 'offline__title', 'Welcome back')
  offlineTitle.id = 'offline-title'
  const offlineAway = el('p', 'offline__away')
  const offlineCoins = el('p', 'offline__coins')
  const offlineRule = el('p', 'note')
  const offlineCap = el('p', 'offline__cap')
  offlineCap.hidden = true
  const offlineDismiss = el('button', 'btn btn--primary offline__dismiss', 'Back to the city')
  offlineDismiss.type = 'button'
  offlineCard.append(offlineTitle, offlineAway, offlineCoins, offlineRule, offlineCap, offlineDismiss)
  offlineOverlay.append(offlineCard)
  const offlineFocus = createDialogFocus(offlineCard)

  root.append(toastLayer, offlineOverlay)

  // ------------------------------------------------------------------- state

  let currentTool: Tool = { kind: 'none' }

  let displayCoins = 0
  let coinsPrimed = false
  let lastFrameMs = performance.now()

  let lastRate = Number.NaN
  let lastPopulation = -1
  let lastHappiness = Number.NaN
  let lastBand: HappinessKey | null = null
  let lastStripType: QueueableType | null = null
  let lastStripWaiting = -1
  /** Matches the signature `setHoverInfo(null)` computes, since the card is
   * built already showing the placeholder — see `inspectPanel` above. */
  const EMPTY_SIGNATURE = '__empty__'
  let lastHoverSignature: string = EMPTY_SIGNATURE

  function paintSelection(): void {
    for (const card of cards) {
      card.button.classList.toggle('is-selected', sameTool(card.tool, currentTool))
    }
  }

  /** A click in the palette: tell the game, and reflect it straight away. */
  function select(tool: Tool): void {
    const next: Tool = sameTool(tool, currentTool) ? { kind: 'none' } : tool
    currentTool = next
    paintSelection()
    cb.onSelectTool(next)
  }

  function setTool(tool: Tool): void {
    if (sameTool(tool, currentTool)) return
    currentTool = tool
    paintSelection()
  }

  /**
   * Ease the shown coin count toward the real one so it drifts upward instead
   * of stepping once per sim tick. Big jumps (offline earnings) snap.
   */
  function advanceCoins(target: number): number {
    const now = performance.now()
    let dt = (now - lastFrameMs) / 1000
    lastFrameMs = now
    if (!(dt > 0)) dt = 0
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT

    if (!coinsPrimed) {
      coinsPrimed = true
      displayCoins = target
      return displayCoins
    }
    const diff = target - displayCoins
    if (Math.abs(diff) > Math.max(400, Math.abs(target) * 0.4) || Math.abs(diff) < 0.01) {
      displayCoins = target
    } else {
      displayCoins += diff * (1 - Math.exp(-COIN_EASE * dt))
    }
    return displayCoins
  }

  /**
   * The compact dock strip: the currently-building item's name and a
   * progress fill toward its cost (coins already saved toward it, out of
   * what it costs — the actual gate on the auto-builder most of the time,
   * since BUILD_INTERVAL itself is short), plus a "+N waiting" count for
   * whatever else sits behind it in the rotation. The strip itself stays on
   * screen even with an empty queue now (it carries the add/pause controls,
   * the only place left to start the queue back up) — only the "now
   * building" readout and the waiting badge hide when there's nothing
   * queued.
   */
  function updateQueueStrip(state: CityState): void {
    const type = state.queue[0] ?? null
    if (!type) {
      if (!queueStripNow.hidden) queueStripNow.hidden = true
      if (!queueStripWaiting.hidden) queueStripWaiting.hidden = true
      lastStripType = null
      lastStripWaiting = -1
      queueStrip.title = ''
      return
    }
    if (queueStripNow.hidden) queueStripNow.hidden = false

    if (type !== lastStripType) {
      lastStripType = type
      queueStripIcon.src = BUILDING_ICONS[type]
      setText(queueStripName, BUILDINGS[type].label)
    }

    const cost = buildingCost(type, state.builtCount[type])
    const progress = cost > 0 ? Math.max(0, Math.min(1, state.coins / cost)) : 1
    queueStripFill.style.width = progress * 100 + '%'

    const waiting = state.queue.length - 1
    if (waiting !== lastStripWaiting) {
      lastStripWaiting = waiting
      if (waiting > 0) {
        setText(queueStripWaiting, '+' + waiting + ' waiting')
        queueStripWaiting.hidden = false
      } else {
        queueStripWaiting.hidden = true
      }
    }

    // The standing-policy explanation used to sit as always-visible text in
    // the queue panel; it survives as this tooltip instead of a second
    // on-screen copy of what the strip already shows at a glance.
    queueStrip.title =
      state.queue.length === 1
        ? `This list repeats forever, so the city will keep building ${pluralLabel(state.queue[0])} and nothing else.`
        : `This list repeats forever: ${describeCycle(state.queue)}, then round again.`
  }

  /** "two houses, then a shop" — the queue read as the standing policy it is. */
  function describeCycle(queue: readonly QueueableType[]): string {
    const runs: { type: QueueableType; count: number }[] = []
    for (const type of queue) {
      const last = runs[runs.length - 1]
      if (last && last.type === type) last.count++
      else runs.push({ type, count: 1 })
    }
    const parts = runs.map(({ type, count }) =>
      count === 1 ? `one ${BUILDINGS[type].label.toLowerCase()}` : `${count} ${pluralLabel(type)}`,
    )
    if (parts.length === 1) return parts[0]
    return `${parts.slice(0, -1).join(', ')}, then ${parts[parts.length - 1]}`
  }

  function update(state: CityState, derived: Derived): void {
    setText(tsCoins, formatCoins(advanceCoins(state.coins)))

    if (derived.incomeRate !== lastRate) {
      lastRate = derived.incomeRate
      setText(tsRateValue, '+' + formatRate(derived.incomeRate) + '/s')
    }

    if (derived.population !== lastPopulation) {
      lastPopulation = derived.population
      setText(tsPopValue, formatCoins(derived.population))
    }

    const happiness = derived.cityHappiness
    if (!(Math.abs(happiness - lastHappiness) < 0.0005)) {
      lastHappiness = happiness
      setText(tsHappyValue, formatPercent(happiness))
      tsHappyFill.style.width = Math.max(0, Math.min(1, happiness)) * 100 + '%'
      const band = happinessBand(happiness)
      if (band.key !== lastBand) {
        lastBand = band.key
        setClass(topStrip, 'topstrip topstrip--' + band.key)
      }
    }

    for (const card of cards) {
      if (card.type === null) continue
      const cost = buildingCost(card.type, state.builtCount[card.type])
      if (cost !== card.lastCost) {
        card.lastCost = cost
        setText(card.costNode, formatCoins(cost))
        // The tooltip quotes the price too, so it must track the same
        // rising cost as the badge rather than freeze at the opening price.
        const def = BUILDINGS[card.type]
        card.button.title = `${def.label} — ${formatCoins(cost)} coins. ${def.blurb}`
      }
      const affordable = state.coins >= cost
      if (affordable !== card.lastAffordable) {
        card.lastAffordable = affordable
        card.button.classList.toggle('is-broke', !affordable)
      }
    }

    for (const add of addButtons) {
      const cost = buildingCost(add.type, state.builtCount[add.type])
      if (cost !== add.lastCost) {
        add.lastCost = cost
        setText(add.costNode, formatCoins(cost))
      }
    }

    updateQueueStrip(state)

    const nextBuild = state.queue[0]
    const nextLabel = nextBuild ? '▶ ' + BUILDINGS[nextBuild].label : ''
    setText(tsNext, nextLabel)
  }

  function setHoverInfo(info: HoverInfo | null): void {
    const signature = info
      ? [
          info.title,
          info.lines.join('\n'),
          info.cost === undefined ? '' : String(info.cost),
          info.affordable === undefined ? '' : String(info.affordable),
        ].join('|')
      : EMPTY_SIGNATURE

    if (signature === lastHoverSignature) return
    lastHoverSignature = signature

    if (!info) {
      inspectIcon.hidden = true
      setText(inspectTitle, INSPECT_EMPTY_TITLE)
      inspectLines.replaceChildren(el('div', 'hover__line', INSPECT_EMPTY_LINE))
      inspectCost.hidden = true
      return
    }

    if (info.icon) {
      inspectIcon.src = BUILDING_ICONS[info.icon]
      inspectIcon.hidden = false
    } else {
      inspectIcon.hidden = true
    }
    setText(inspectTitle, info.title)
    inspectLines.replaceChildren(...info.lines.map((line) => el('div', 'hover__line', line)))
    if (info.cost === undefined) {
      inspectCost.hidden = true
    } else {
      const affordable = info.affordable !== false
      setClass(inspectCost, 'hover__cost ' + (affordable ? 'is-affordable' : 'is-unaffordable'))
      setText(inspectCost, formatCoins(info.cost) + (affordable ? ' coins' : ' coins - not enough'))
      inspectCost.hidden = false
    }
  }

  function toast(message: string): void {
    cb.onToastShown?.()
    const node = el('div', 'toast', message)
    toastLayer.append(node)
    while (toastLayer.childElementCount > MAX_TOASTS) {
      toastLayer.firstElementChild?.remove()
    }
    window.setTimeout(() => {
      node.classList.add('is-leaving')
      window.setTimeout(() => node.remove(), TOAST_FADE_MS)
    }, TOAST_LIFE_MS)
  }

  function onOfflineKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      hideOffline()
      return
    }
    offlineFocus.onKeydown(event)
  }

  function hideOffline(): void {
    if (offlineOverlay.hidden) return
    offlineOverlay.hidden = true
    window.removeEventListener('keydown', onOfflineKey)
    offlineFocus.close()
  }

  offlineDismiss.addEventListener('click', hideOffline)
  offlineOverlay.addEventListener('click', (event) => {
    if (event.target === offlineOverlay) hideOffline()
  })

  function showOfflineEarnings(coins: number, seconds: number): void {
    const capped = seconds >= OFFLINE_CAP_SECONDS - 1
    const away = formatDuration(Math.min(seconds, OFFLINE_CAP_SECONDS))
    setText(offlineAway, capped ? `You were away longer than ${away}.` : `You were away for ${away}.`)
    setText(offlineCoins, '+' + formatCoins(coins) + ' coins')
    setText(
      offlineRule,
      'Your city was frozen while you were gone. It kept earning at the rate you left it at, but nothing was built and nothing decayed, so this is exactly the city you left.',
    )
    offlineCap.hidden = !capped
    if (capped) {
      setText(
        offlineCap,
        `Offline earnings stop after ${formatDuration(OFFLINE_CAP_SECONDS)}, so that is all this trip paid.`,
      )
    }
    if (offlineOverlay.hidden) {
      offlineOverlay.hidden = false
      window.addEventListener('keydown', onOfflineKey)
      offlineFocus.open()
    }
  }

  paintSelection()

  return {
    topStripElement: topStrip,
    buildDockElement: buildDock,
    inspectElement: inspectPanel,
    queueStripElement: queueStrip,
    restartElement: restartPanel,
    update,
    setTool,
    setHoverInfo,
    showOfflineEarnings,
    toast,
  }
}
