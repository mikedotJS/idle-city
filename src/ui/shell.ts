/**
 * The shell: the single place every HUD section gets positioned.
 *
 * One floating bar, centered at the bottom of the screen, at every viewport
 * size — no more separate desktop docks and mobile tab bar. The bar carries
 * the always-visible readout (coins, income/s, happiness, population, next
 * build — handed in as `topStrip`, still built and updated by hud.ts) and a
 * tab for each section (Ville / Menu / Social). Tapping a tab opens a
 * popover directly above the bar showing that section's panels; tapping the
 * same tab again — or picking another one — closes or swaps it. Only CSS
 * media queries change between screen sizes (padding, which stats stay
 * visible, the popover's width): the DOM and the interaction are identical
 * on a phone and on a desktop monitor, which is the whole point of building
 * one shared block instead of a dock/tabbar split that only ever grew
 * further apart with each phase.
 *
 * Replaces the earlier left/right `.shell-dock` + mobile `.shell-tabbar` /
 * `.shell-sheet` split: that arrangement kept a fixed top strip separate
 * from two side docks and, below 960px, a third independent tab bar — three
 * things to keep positioned against each other instead of one.
 *
 * Contract for future sections: the popover is bounded and scrollable
 * against the viewport height, not infinite — see .dock-popover in
 * shell.css. A panel that caps its own height against 100vh (several do) is
 * layering a redundant, harmless cap on top of that budget, not providing
 * the actual bound itself.
 */

import './shell.css'
import { NAV_ICONS } from './navIcons'

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

export interface HudSection {
  id: string
  label: string
  /** One or more panels rendered together under this section's heading. */
  panels: HTMLElement[]
}

export interface HudShell {
  dispose(): void
}

function buildColumn(section: HudSection): HTMLElement {
  const column = el('div', 'dock-popover__column')
  column.dataset.section = section.id
  column.append(...section.panels)
  return column
}

/** A section with no actual content shouldn't get a tab of its own — see
 * the "empty Social tab" finding from the previous shell's mobile phase. */
function hasContent(section: HudSection): boolean {
  return section.panels.some((panel) => panel.childNodes.length > 0)
}

/** Measures the bar's real rendered height (including its own
 * safe-area-inset padding) and publishes it as a CSS variable, so the
 * popover and the toast offset read one real measurement instead of
 * guessing it independently. Needed at every breakpoint now: the bar sits
 * bottom-center on desktop too, where toasts used to have the run of the
 * bottom edge to themselves. */
function publishBarHeight(bar: HTMLElement): void {
  const height = bar.getBoundingClientRect().height
  if (height > 0) {
    document.documentElement.style.setProperty('--dock-bar-h', `${height}px`)
  }
}

export function createShell(
  root: HTMLElement,
  topStrip: HTMLElement,
  sections: HudSection[],
): HudShell {
  const tabSections = sections.filter(hasContent)
  const columns = new Map<string, HTMLElement>()
  for (const section of tabSections) {
    columns.set(section.id, buildColumn(section))
  }

  const bar = el('div', 'dock-bar')
  const stats = el('div', 'dock-bar__stats')
  stats.append(topStrip)
  const divider = el('div', 'dock-bar__divider')
  const tabs = el('div', 'dock-bar__tabs')
  bar.append(stats, divider, tabs)

  // One card for whatever tab is open: a title (the active section's own
  // label — one heading, not a second hidden one under it) and a close
  // button next to it, then that section's panels underneath. Every open
  // section renders as this one surface rather than each panel keeping its
  // own bordered, shadowed card stacked under the last — see shell.css.
  const popover = el('div', 'dock-popover')
  popover.hidden = true
  const popoverHead = el('div', 'dock-popover__head')
  const popoverTitle = el('h2', 'dock-popover__title')
  const popoverClose = el('button', 'dock-popover__close', '×')
  popoverClose.type = 'button'
  popoverClose.setAttribute('aria-label', 'Close')
  popoverHead.append(popoverTitle, popoverClose)
  const popoverBody = el('div', 'dock-popover__body')
  popover.append(popoverHead, popoverBody)

  const sectionsById = new Map(tabSections.map((section) => [section.id, section]))
  const tabButtons = new Map<string, HTMLButtonElement>()
  // Closed by default at every size: the bar alone is the resting state,
  // and nothing forces a section open just because the screen is narrow —
  // the previous mobile tab bar always had one sheet open on first paint.
  let activeId: string | null = null

  function render(): void {
    for (const [id, button] of tabButtons) {
      const active = id === activeId
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-pressed', String(active))
    }
    const section = activeId ? sectionsById.get(activeId) : undefined
    const column = activeId ? columns.get(activeId) : undefined
    popoverTitle.textContent = section?.label ?? ''
    popoverBody.replaceChildren(...(column ? [column] : []))
    popover.hidden = !column
  }

  popoverClose.addEventListener('click', () => {
    activeId = null
    render()
  })

  for (const section of tabSections) {
    const button = el('button', 'dock-tab')
    button.type = 'button'
    const icon = NAV_ICONS[section.id]
    if (icon) {
      const img = el('img', 'dock-tab__icon')
      img.src = icon
      img.alt = ''
      button.append(img)
    } else {
      // No icon for this section (shouldn't happen today, but a future
      // section without one still needs to read as something): fall back
      // to the label as visible text rather than an unlabeled icon slot.
      button.append(el('span', 'dock-tab__label', section.label))
    }
    // The label still names the button for screen readers and shows up as
    // a tooltip — only its on-screen text is gone.
    button.title = section.label
    button.setAttribute('aria-label', section.label)
    button.setAttribute('aria-pressed', 'false')
    button.addEventListener('click', () => {
      activeId = activeId === section.id ? null : section.id
      render()
    })
    tabButtons.set(section.id, button)
    tabs.append(button)
  }

  const barResizeObserver = new ResizeObserver(() => publishBarHeight(bar))
  barResizeObserver.observe(bar)

  root.append(popover, bar)
  // The bar has real layout only once it's in the DOM.
  publishBarHeight(bar)
  render()

  return {
    dispose(): void {
      barResizeObserver.disconnect()
      popover.remove()
      bar.remove()
    },
  }
}
