/**
 * The HUD: plain DOM over the 3D board.
 *
 * Reads sim state, never mutates it. Every player action leaves through
 * `HudCallbacks`. `update()` runs every animation frame, so it caches every
 * element reference up front and only touches the DOM when a displayed value
 * has actually changed.
 */

import type { MusicState } from '../audio/music'
import type { Tool } from '../render/api'
import { BUILDINGS, BUILDING_TYPES, buildingCost } from '../sim/buildings'
import { INCOME_FLOOR, OFFLINE_CAP_SECONDS } from '../sim/config'
import type { BuildingType, CityState, Derived, QueueableType } from '../sim/types'
import type { HoverInfo, Hud, HudCallbacks } from './api'
import {
  formatCoins,
  formatDuration,
  formatMultiplier,
  formatPercent,
  formatRate,
  happinessBand,
} from './format'
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

const MAX_QUEUE_ROWS = 8
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
  const hud = el('div', 'hud')

  // ---------------------------------------------------------------- readouts

  const topLeft = el('div', 'hud__zone hud__zone--tl')
  const readouts = el('section', 'panel panel--readouts')

  const coinsBlock = el('div', 'coins')
  coinsBlock.append(el('div', 'label', 'Coins'))
  const coinsLine = el('div', 'coins__line')
  const coinsValue = el('span', 'coins__value', '0')
  const coinsRate = el('span', 'coins__rate', '+0.0/s')
  coinsLine.append(coinsValue, coinsRate)
  coinsBlock.append(coinsLine)

  const statGrid = el('div', 'stat-grid')

  const popStat = el('div', 'stat')
  popStat.append(el('div', 'label', 'People'))
  const popValue = el('div', 'stat__value', '0')
  popStat.append(popValue)

  const multStat = el('div', 'stat stat--accent')
  multStat.append(el('div', 'label', 'Income'))
  const multValue = el('div', 'stat__value', formatMultiplier(1))
  multStat.append(multValue)

  statGrid.append(popStat, multStat)

  const happy = el('div', 'happy')
  const happyHead = el('div', 'happy__head')
  const happyValue = el('span', 'happy__value', '50%')
  const happyBadge = el('span', 'badge badge--content', 'content')
  happyHead.append(el('span', 'label', 'Happiness'), happyValue, happyBadge)
  const meter = el('div', 'meter')
  const meterFill = el('div', 'meter__fill meter__fill--content')
  meter.append(meterFill)
  const happyNote = el('div', 'hint', 'Liveable. Parks would push it higher.')
  happy.append(happyHead, meter, happyNote)

  const multNote = el(
    'p',
    'note',
    'Income multiplier = 0.50 + happiness, so 0.50x at worst and 1.50x at best. A happier city earns more from the same buildings, and builds faster too. The rate beside your coins already has it applied.',
  )

  readouts.append(coinsBlock, statGrid, happy, multNote)

  // ------------------------------------------------------------- hover panel

  const hoverPanel = el('section', 'panel panel--hover')
  hoverPanel.hidden = true
  const hoverTitle = el('div', 'hover__title')
  const hoverLines = el('div', 'hover__lines')
  const hoverCost = el('div', 'hover__cost')
  hoverCost.hidden = true
  hoverPanel.append(hoverTitle, hoverLines, hoverCost)

  topLeft.append(readouts)

  // ------------------------------------------------------------ tool palette

  const toolsPanel = el('section', 'panel panel--tools')
  toolsPanel.append(el('h2', 'panel__title', 'Place by hand'))
  const toolList = el('div', 'tool-list')
  const cards: ToolCard[] = []

  for (const type of MANUAL_TYPES) {
    const def = BUILDINGS[type]
    const button = el('button', 'tool')
    button.type = 'button'
    const head = el('span', 'tool__head')
    const costNode = el('span', 'tool__cost', formatCoins(def.baseCost))
    head.append(el('span', 'tool__name', def.label), costNode)
    button.append(head, el('span', 'tool__blurb', def.blurb))
    const tool: Tool = { kind: 'place', type }
    button.addEventListener('click', () => select(tool))
    toolList.append(button)
    cards.push({ button, tool, type, costNode, lastCost: -1, lastAffordable: null })
  }

  const demolishButton = el('button', 'tool tool--demolish')
  demolishButton.type = 'button'
  const demolishHead = el('span', 'tool__head')
  demolishHead.append(el('span', 'tool__name', 'Demolish'), el('span', 'tool__cost', 'free'))
  demolishButton.append(
    demolishHead,
    el('span', 'tool__blurb', 'Clear a tile instantly. Costs nothing, refunds nothing.'),
  )
  const demolishTool: Tool = { kind: 'demolish' }
  demolishButton.addEventListener('click', () => select(demolishTool))
  toolList.append(demolishButton)
  cards.push({
    button: demolishButton,
    tool: demolishTool,
    type: null,
    costNode: demolishHead,
    lastCost: 0,
    lastAffordable: null,
  })

  toolsPanel.append(toolList)
  toolsPanel.append(
    el('p', 'hint', 'Pick a tool, then click a tile. Escape or right-click puts it down again.'),
    el(
      'p',
      'hint',
      'The pale land past your plot is for sale. Click it to buy, and the city will spread into it.',
    ),
  )
  // One left-hand column, not two. The palette used to live in its own
  // bottom-left zone, which meant nothing related its height to the readouts'
  // — and adding three buildings to the registry pushed it up through them and
  // then off the top of a 1280x720 window. In one flex column the readouts
  // keep their size, the palette takes what is left, and its list scrolls.
  topLeft.append(toolsPanel, hoverPanel)

  // ------------------------------------------------------------- build queue

  const rightSide = el('div', 'hud__zone hud__zone--tr')
  const queuePanel = el('section', 'panel panel--queue')
  queuePanel.append(el('h2', 'panel__title', 'Build queue'))
  queuePanel.append(
    el('p', 'hint', 'The city builds this list on repeat, paying out of your coins.'),
  )
  const queueList = el('ol', 'queue-list')
  const queueRepeat = el('p', 'repeat')
  const queueActions = el('div', 'queue-actions')
  const addButtons: QueueAddButton[] = []

  for (const type of QUEUE_TYPES) {
    const def = BUILDINGS[type]
    const button = el('button', 'btn')
    button.type = 'button'
    const costNode = el('span', 'btn__cost', formatCoins(def.baseCost))
    button.append(el('span', 'btn__label', 'Add ' + def.label), costNode)
    button.title = def.blurb
    button.addEventListener('click', () => cb.onQueue(type))
    queueActions.append(button)
    addButtons.push({ type, costNode, lastCost: -1 })
  }

  const clearButton = el('button', 'btn btn--ghost', 'Pause building')
  clearButton.type = 'button'
  clearButton.title = 'Empty the queue.'
  clearButton.addEventListener('click', () => cb.onClearQueue())
  queueActions.append(clearButton)

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

  queuePanel.append(queueList, queueRepeat, queueActions)
  rightSide.append(queuePanel)

  // Its own panel, not a third button in the queue's action row. Restarting is
  // not a queue action, and crowding that row made it wrap, which overflowed
  // the panel and hid the button under the music panel below — where it was
  // visible, correctly placed, and completely dead.
  const restartPanel = el('section', 'panel panel--restart')
  restartPanel.append(restartButton)
  rightSide.append(restartPanel)

  // ------------------------------------------------------------------- music

  const musicPanel = el('section', 'panel panel--music')
  const musicRow = el('div', 'music__row')
  const musicButton = el('button', 'music__toggle')
  musicButton.type = 'button'
  musicButton.addEventListener('click', () => cb.onToggleMusic())
  const musicTitle = el('span', 'music__title')
  musicRow.append(musicButton, musicTitle)

  const musicVolume = document.createElement('input')
  musicVolume.type = 'range'
  musicVolume.className = 'music__volume'
  musicVolume.min = '0'
  musicVolume.max = '100'
  musicVolume.step = '1'
  musicVolume.setAttribute('aria-label', 'Music volume')
  musicVolume.addEventListener('input', () => {
    cb.onMusicVolume(Number(musicVolume.value) / 100)
  })

  musicPanel.append(musicRow, musicVolume)
  rightSide.append(musicPanel)

  let musicSignature = ''

  function setMusicState(music: MusicState): void {
    // The waiting state is the normal state on load, not a failure: browsers
    // block audio until the page has been interacted with.
    const label = !music.enabled
      ? 'Music off'
      : music.waitingForGesture
        ? 'Click anywhere to start the music'
        : (music.nowPlaying ?? 'Music on')
    const signature = `${music.enabled}|${label}|${music.volume}`
    if (signature === musicSignature) return
    musicSignature = signature

    setText(musicButton, music.enabled ? 'Music on' : 'Music off')
    musicButton.className = music.enabled ? 'music__toggle is-on' : 'music__toggle'
    musicButton.setAttribute('aria-pressed', String(music.enabled))
    setText(musicTitle, music.enabled ? label : '')
    musicPanel.classList.toggle('is-muted', !music.enabled)
    if (document.activeElement !== musicVolume) {
      musicVolume.value = String(Math.round(music.volume * 100))
    }
  }

  // ------------------------------------------------------------------ toasts

  const toastLayer = el('div', 'toasts')

  // -------------------------------------------------------- offline earnings

  const offlineOverlay = el('div', 'overlay')
  offlineOverlay.hidden = true
  const offlineCard = el('section', 'panel panel--offline')
  const offlineAway = el('p', 'offline__away')
  const offlineCoins = el('p', 'offline__coins')
  const offlineRule = el('p', 'note')
  const offlineCap = el('p', 'offline__cap')
  offlineCap.hidden = true
  const offlineDismiss = el('button', 'btn btn--primary', 'Back to the city')
  offlineDismiss.type = 'button'
  offlineCard.append(
    el('h2', 'offline__title', 'Welcome back'),
    offlineAway,
    offlineCoins,
    offlineRule,
    offlineCap,
    offlineDismiss,
  )
  offlineOverlay.append(offlineCard)

  hud.append(topLeft, rightSide, toastLayer, offlineOverlay)
  root.append(hud)

  // ------------------------------------------------------------------- state

  let currentTool: Tool = { kind: 'none' }

  let displayCoins = 0
  let coinsPrimed = false
  let lastFrameMs = performance.now()

  let lastRate = Number.NaN
  let lastPopulation = -1
  let lastHappiness = Number.NaN
  let lastBand: HappinessKey | null = null
  let lastQueueSignature: string | null = null
  let lastHoverSignature: string | null = null

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

  function renderQueue(state: CityState): void {
    const signature = state.queue.join(',')
    if (signature === lastQueueSignature) return
    lastQueueSignature = signature

    const rows: HTMLLIElement[] = []
    const shown = Math.min(state.queue.length, MAX_QUEUE_ROWS)
    for (let i = 0; i < shown; i++) {
      const type = state.queue[i]
      const row = el('li', i === 0 ? 'qrow qrow--next' : 'qrow')
      row.append(el('span', 'qrow__dot qrow__dot--' + type))
      row.append(el('span', 'qrow__name', BUILDINGS[type].label))
      if (i === 0) row.append(el('span', 'qrow__badge', 'building next'))
      rows.push(row)
    }
    const hiddenCount = state.queue.length - shown
    if (hiddenCount > 0) {
      rows.push(el('li', 'qrow qrow--more', '+' + hiddenCount + ' more'))
    }
    if (rows.length === 0) {
      rows.push(el('li', 'qrow qrow--empty', 'Nothing queued'))
    }
    queueList.replaceChildren(...rows)

    if (state.queue.length === 0) {
      setClass(queueRepeat, 'repeat repeat--empty')
      setText(
        queueRepeat,
        'Building is paused, so nothing new goes up and your coins pile up instead. ' +
          'This is how you save for land or a factory: the city spends from the same purse you do.',
      )
      return
    }
    setClass(queueRepeat, 'repeat')
    setText(
      queueRepeat,
      state.queue.length === 1
        ? `This list repeats forever, so the city will keep building ${pluralLabel(state.queue[0])} and nothing else.`
        : `This list repeats forever: ${describeCycle(state.queue)}, then round again.`,
    )
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
    setText(coinsValue, formatCoins(advanceCoins(state.coins)))

    if (derived.incomeRate !== lastRate) {
      lastRate = derived.incomeRate
      setText(coinsRate, '+' + formatRate(derived.incomeRate) + '/s')
    }

    if (derived.population !== lastPopulation) {
      lastPopulation = derived.population
      setText(popValue, formatCoins(derived.population))
    }

    const happiness = derived.cityHappiness
    if (!(Math.abs(happiness - lastHappiness) < 0.0005)) {
      lastHappiness = happiness
      setText(happyValue, formatPercent(happiness))
      setText(multValue, formatMultiplier(INCOME_FLOOR + happiness))
      meterFill.style.width = (Math.max(0, Math.min(1, happiness)) * 100).toFixed(1) + '%'
      const band = happinessBand(happiness)
      if (band.key !== lastBand) {
        lastBand = band.key
        setText(happyBadge, band.label)
        setText(happyNote, band.note)
        setClass(happyBadge, 'badge badge--' + band.key)
        setClass(meterFill, 'meter__fill meter__fill--' + band.key)
      }
    }

    for (const card of cards) {
      if (card.type === null) continue
      const cost = buildingCost(card.type, state.builtCount[card.type])
      if (cost !== card.lastCost) {
        card.lastCost = cost
        setText(card.costNode, formatCoins(cost))
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

    renderQueue(state)
  }

  function setHoverInfo(info: HoverInfo | null): void {
    if (!info) {
      if (!hoverPanel.hidden) hoverPanel.hidden = true
      lastHoverSignature = null
      return
    }
    const signature = [
      info.title,
      info.lines.join('\n'),
      info.cost === undefined ? '' : String(info.cost),
      info.affordable === undefined ? '' : String(info.affordable),
    ].join('|')

    if (signature !== lastHoverSignature) {
      lastHoverSignature = signature
      setText(hoverTitle, info.title)
      hoverLines.replaceChildren(...info.lines.map((line) => el('div', 'hover__line', line)))
      if (info.cost === undefined) {
        hoverCost.hidden = true
      } else {
        const affordable = info.affordable !== false
        setClass(hoverCost, 'hover__cost ' + (affordable ? 'is-affordable' : 'is-unaffordable'))
        setText(
          hoverCost,
          formatCoins(info.cost) + (affordable ? ' coins' : ' coins - not enough'),
        )
        hoverCost.hidden = false
      }
    }
    if (hoverPanel.hidden) hoverPanel.hidden = false
  }

  function toast(message: string): void {
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
    if (event.key === 'Escape') hideOffline()
  }

  function hideOffline(): void {
    if (offlineOverlay.hidden) return
    offlineOverlay.hidden = true
    window.removeEventListener('keydown', onOfflineKey)
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
    }
  }

  paintSelection()

  return { update, setTool, setHoverInfo, setMusicState, showOfflineEarnings, toast }
}
