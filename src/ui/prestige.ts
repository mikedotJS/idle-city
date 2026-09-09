/**
 * The prestige panel: retiring a city for charter, and spending charter on
 * the next one's starting conditions.
 *
 * Same shape as tools.ts and hud.ts: reads sim state, never mutates it
 * directly (buyUpgrade is the one exception, and it mutates the PrestigeState
 * object handed in by reference, per its own contract — every call is
 * followed by `callbacks.onPrestigeChanged()` so it actually gets saved).
 * `update()` runs every animation frame, so every element reference is
 * cached up front and the DOM is only touched when a displayed value has
 * actually changed.
 *
 * Collapsed by default, like tools.ts. A player in their first hour has no
 * charter and nothing built up worth retiring for — see prestige.ts's own
 * header: a city left to grow itself earns nothing at all. Surfacing a
 * half-empty shop for a currency that doesn't exist yet would just be more
 * furniture around the board. The toggle carries a live charter badge once
 * there is any, so the panel finds the player instead of the other way round.
 *
 * Positioned by ui/shell.ts's .shell-dock now, alongside Tools and the
 * music/sound controls, instead of picking its own fixed spot — see
 * shell.ts's header comment for why that arrangement was retired.
 */

import './prestige.css'

import { derive } from '../sim/economy'
import {
  UPGRADE_KEYS,
  UPGRADES,
  buyUpgrade,
  charterFor,
  startingCoins,
  upgradeCost,
  upgradeDiscount,
} from '../sim/prestige'
import type { PrestigeState, UpgradeKey } from '../sim/prestige'
import type { CityState } from '../sim/types'
import { formatCoins, formatPercent, happinessBand } from './format'

export interface PrestigeCallbacks {
  /** Retire the running city and found a new one. Destroys the current city. */
  onRetire(): void
  /** Persist prestige after a purchase. */
  onPrestigeChanged(): void
  /** Show a transient message through the existing HUD toast. */
  onToast(message: string): void
}

export interface PrestigePanel {
  /** The panel's root element. */
  element: HTMLElement
  /** Called every animation frame. Cheap: bail early when nothing changed. */
  update(state: CityState): void
  dispose(): void
}

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

/** How a city left entirely to itself settles, per prestige.ts's own header. */
const NEGLECTED_HAPPINESS_NOTE =
  'A city left to run itself settles around 33-36% happiness, and that earns nothing here.'

interface UpgradeRow {
  key: UpgradeKey
  levelNode: HTMLElement
  buyButton: HTMLButtonElement
  buyLabel: HTMLElement
  buyCost: HTMLElement
  lastLevel: number
  /** null = maxed. NaN = not yet painted. */
  lastCost: number | null
  lastAffordable: boolean | null
}

export function createPrestigePanel(
  getPrestige: () => PrestigeState,
  callbacks: PrestigeCallbacks,
): PrestigePanel {
  const wrap = el('div', 'prestige-root')

  // ------------------------------------------------------------------ toggle

  const toggleButton = el('button', 'btn prestige-toggle')
  toggleButton.type = 'button'
  toggleButton.setAttribute('aria-expanded', 'false')
  const toggleLabel = el('span', undefined, 'Prestige')
  const toggleBadge = el('span', 'prestige-toggle__badge')
  toggleBadge.hidden = true
  toggleButton.append(toggleLabel, toggleBadge)

  const panel = el('section', 'panel prestige-panel')
  panel.hidden = true
  panel.append(el('h2', 'panel__title', 'Prestige'))

  // -------------------------------------------------------------- retire

  const retireSection = el('div', 'prestige-section')
  retireSection.append(el('p', 'prestige-section__title', 'Retire this city'))

  const charterNow = el('div', 'prestige-charter')
  const charterValue = el('span', 'prestige-charter__value', '0')
  charterNow.append(charterValue, el('span', 'prestige-charter__unit', ' charter'))
  const charterLive = el('p', 'hint', 'if retired right now')
  const charterRule = el(
    'p',
    'note',
    'Charter rewards care, not scale. It is sqrt(population) x happiness cubed, so size barely moves it and happiness decides it.',
  )
  const charterZeroNote = el('p', 'note prestige-note--warn', NEGLECTED_HAPPINESS_NOTE)
  charterZeroNote.hidden = true

  const retireButton = el('button', 'btn btn--danger prestige-retire-btn', 'Retire this city')
  retireButton.type = 'button'
  retireButton.disabled = true
  retireSection.append(
    charterNow,
    charterLive,
    charterRule,
    charterZeroNote,
    retireButton,
    el(
      'p',
      'hint',
      'Banks the charter above forever, then throws this city away and founds a new one on fresh land. Charter buys starting conditions only. Nothing it buys changes a rule once a city is running.',
    ),
  )

  // Destructive — worse than "New city", because it is offered as a reward,
  // which is exactly the situation where a player should be encouraged to
  // slow down rather than sped up. Same arm/confirm/timeout shape as the
  // restart button in hud.ts and the import button in tools.ts, except the
  // confirm label also names the exact payout, since this is the one place
  // in the game where "are you sure" needs a number attached to it.
  let armed = false
  let armedTimer = 0
  let armedCharter = 0

  function disarmRetire(): void {
    if (!armed) return
    armed = false
    window.clearTimeout(armedTimer)
    retireButton.classList.remove('is-armed')
    // The next update() call repaints the label from live state.
    lastRetireLabel = null
  }

  retireButton.addEventListener('click', (event) => {
    event.stopPropagation()
    if (retireButton.disabled) return
    if (armed) {
      disarmRetire()
      callbacks.onRetire()
      return
    }
    armed = true
    armedCharter = charterFor(getState())
    setText(retireButton, `Really retire for ${formatCoins(armedCharter)} charter?`)
    retireButton.classList.add('is-armed')
    armedTimer = window.setTimeout(disarmRetire, 4000)
  })
  window.addEventListener('click', disarmRetire)

  // update() needs the last CityState it was given to price the confirm
  // label without recomputing charter mid-click; stashed here rather than
  // threaded through the click handler.
  let lastState: CityState | null = null
  function getState(): CityState {
    // Only ever read after the first update() call, which always runs before
    // any click is possible (the panel starts hidden and disabled).
    return lastState as CityState
  }

  // -------------------------------------------------------------- spending

  const spendSection = el('div', 'prestige-section')
  spendSection.append(
    el('p', 'prestige-section__title', 'Spend charter'),
    el('p', 'hint', 'Banked charter. Nothing spends it but you.'),
  )
  const bankLine = el('p', 'prestige-bank')
  spendSection.append(bankLine)

  const rows: UpgradeRow[] = []
  for (const key of UPGRADE_KEYS) {
    const def = UPGRADES[key]
    const row = el('div', 'prestige-upgrade')
    const head = el('div', 'prestige-upgrade__head')
    const levelNode = el('span', 'prestige-upgrade__level')
    head.append(el('span', 'prestige-upgrade__label', def.label), levelNode)
    const buyButton = el('button', 'btn prestige-buy-btn')
    buyButton.type = 'button'
    const buyLabel = el('span', undefined, 'Buy')
    const buyCost = el('span', 'btn__cost')
    buyButton.append(buyLabel, buyCost)
    buyButton.addEventListener('click', () => {
      const prestige = getPrestige()
      const result = buyUpgrade(prestige, key)
      if (!result.ok) {
        callbacks.onToast(result.reason)
        return
      }
      callbacks.onPrestigeChanged()
      // Force an immediate repaint rather than waiting for the next frame —
      // a purchase should feel instant.
      paintUpgradeRow(rowFor(key), prestige)
      paintBank(prestige)
      paintStarting(prestige)
    })
    row.append(head, el('p', 'hint', def.blurb), buyButton)
    spendSection.append(row)
    rows.push({
      key,
      levelNode,
      buyButton,
      buyLabel,
      buyCost,
      lastLevel: -1,
      lastCost: Number.NaN,
      lastAffordable: null,
    })
  }

  function rowFor(key: UpgradeKey): UpgradeRow {
    // UPGRADE_KEYS never changes at runtime, so this always finds one.
    return rows.find((r) => r.key === key) as UpgradeRow
  }

  function paintUpgradeRow(row: UpgradeRow, prestige: PrestigeState): void {
    const level = prestige.levels[row.key]
    const cap = UPGRADES[row.key].costs.length
    if (level !== row.lastLevel) {
      row.lastLevel = level
      setText(row.levelNode, `Lv ${level}/${cap}`)
    }
    const cost = upgradeCost(prestige, row.key)
    const affordable = cost !== null && prestige.charter >= cost
    if (cost !== row.lastCost) {
      row.lastCost = cost
      if (cost === null) {
        setText(row.buyLabel, 'Maxed')
        setText(row.buyCost, '')
      } else {
        setText(row.buyLabel, 'Buy')
        setText(row.buyCost, formatCoins(cost))
      }
    }
    if (affordable !== row.lastAffordable) {
      row.lastAffordable = affordable
      row.buyButton.disabled = cost === null || !affordable
    }
  }

  // ---------------------------------------------------------- next city

  const startingSection = el('div', 'prestige-section')
  startingSection.append(el('p', 'prestige-section__title', 'Next city starts with'))
  const startingLine = el('p', 'prestige-starting')
  startingSection.append(
    startingLine,
    el(
      'p',
      'hint',
      // "New city", never "your city": the discount is stamped onto a city at
      // founding and saved with it, so it never touches the one running now,
      // and it does not make anything happier or richer — cheaper density
      // just concentrates whoever moves in near whatever gets built, for
      // better or worse.
      'Both are fixed the moment a new city is founded, and never change after. Cheaper upgrades make a city denser, not happier.',
    ),
  )

  let lastCoins = -1
  let lastDiscountPct = -1
  function paintStarting(prestige: PrestigeState): void {
    const coins = startingCoins(prestige)
    const discountPct = Math.round((1 - upgradeDiscount(prestige)) * 100)
    if (coins === lastCoins && discountPct === lastDiscountPct) return
    lastCoins = coins
    lastDiscountPct = discountPct
    const cheaper =
      discountPct > 0 ? `upgrades ${discountPct}% cheaper` : 'no discount on upgrades yet'
    setText(startingLine, `${formatCoins(coins)} coins, and ${cheaper}.`)
  }

  let lastBankSignature = ''
  function paintBank(prestige: PrestigeState): void {
    const signature = `${prestige.charter}|${prestige.retired}`
    if (signature === lastBankSignature) return
    lastBankSignature = signature
    const citiesWord = prestige.retired === 1 ? 'city' : 'cities'
    setText(
      bankLine,
      `${formatCoins(prestige.charter)} charter banked, from ${prestige.retired} retired ${citiesWord}.`,
    )
  }

  panel.append(retireSection, spendSection, startingSection)

  toggleButton.addEventListener('click', () => {
    const opening = panel.hidden
    panel.hidden = !opening
    toggleButton.classList.toggle('is-open', opening)
    toggleButton.setAttribute('aria-expanded', String(opening))
  })

  wrap.append(toggleButton, panel)

  // ------------------------------------------------------------------ frame

  let lastCharter = Number.NaN
  let lastRetireLabel: string | null = null
  let lastZeroVisible: boolean | null = null
  let lastRetireEnabled: boolean | null = null
  let lastToggleBadge = ''
  let lastLiveSignature = ''

  function update(state: CityState): void {
    lastState = state
    const prestige = getPrestige()

    // The toggle's badge is cheap (no derive() involved) and worth keeping
    // live even while the panel is collapsed, so a player notices charter
    // piling up without opening anything.
    const badgeText = prestige.charter >= 1 ? formatCoins(prestige.charter) : ''
    if (badgeText !== lastToggleBadge) {
      lastToggleBadge = badgeText
      toggleBadge.hidden = badgeText === ''
      setText(toggleBadge, badgeText)
    }

    if (panel.hidden) return

    // charterFor() calls derive() internally, and so does the manual derive()
    // call just below — two cheap passes over a 144-tile field, only while
    // this panel is actually open, rather than duplicating prestige.ts's
    // formula here to save one of them.
    const live = charterFor(state)
    if (live !== lastCharter) {
      lastCharter = live
      setText(charterValue, formatCoins(live))
    }

    const canRetireNow = live >= 1
    if (canRetireNow !== lastRetireEnabled) {
      lastRetireEnabled = canRetireNow
      if (!armed) retireButton.disabled = !canRetireNow
    }

    if (!armed) {
      const label = canRetireNow ? 'Retire this city' : 'Not worth retiring yet'
      if (label !== lastRetireLabel) {
        lastRetireLabel = label
        setText(retireButton, label)
      }
    }

    if (!canRetireNow) {
      if (lastZeroVisible !== true) {
        lastZeroVisible = true
        charterZeroNote.hidden = false
      }
    } else if (lastZeroVisible !== false) {
      lastZeroVisible = false
      charterZeroNote.hidden = true
    }

    const d = derive(state)
    const band = happinessBand(d.cityHappiness)
    const liveSignature = `${d.population}|${band.key}|${Math.round(d.cityHappiness * 1000)}`
    if (liveSignature !== lastLiveSignature) {
      lastLiveSignature = liveSignature
      setText(
        charterLive,
        `Right now: ${formatCoins(d.population)} people, ${band.label} at ${formatPercent(d.cityHappiness)} happiness → ${formatCoins(live)} charter if retired right now.`,
      )
    }

    for (const row of rows) paintUpgradeRow(row, prestige)
    paintBank(prestige)
    paintStarting(prestige)
  }

  function dispose(): void {
    window.removeEventListener('click', disarmRetire)
    window.clearTimeout(armedTimer)
    wrap.remove()
  }

  return { element: wrap, update, dispose }
}
