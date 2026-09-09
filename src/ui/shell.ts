/**
 * The shell: the single place every HUD section gets positioned.
 *
 * Replaces each panel positioning itself independently with `position:
 * fixed` — prestige.ts's header comment documents the invisible-overlap bug
 * that arrangement shipped twice. A section here is a label plus the panels
 * that belong to it; the shell decides where they render, and every panel
 * stops needing to know about every other panel's coordinates to avoid
 * covering them.
 *
 * At or above 960px wide, sections dock side by side, always visible — the
 * same layout Phases 1-3 built. Below 960px, a bottom tab bar switches
 * between full-height sheets, one section's content visible at a time. In
 * both cases the same DOM nodes move between presentations rather than
 * being rebuilt, so state inside a panel survives a tab switch or a resize
 * across the breakpoint.
 *
 * Left and right dock independently: each side renders its own dock only
 * when it has at least one section, anchored straight to its own screen
 * edge. Adding, removing, or resizing a section on one side never moves
 * the other side's dock.
 *
 * Contract for future sections: a section's column is bounded and scrollable
 * against the viewport height, not infinite — see .shell-dock__column in
 * shell.css. A panel that caps its own height against 100vh (several do)
 * is layering a redundant, harmless cap on top of that budget, not
 * providing the actual bound itself. The same contract extends to the
 * mobile sheet: a column must also work as the sole content of a
 * height-capped (60vh) sheet, not just when docked — don't assume a
 * column can grow arbitrarily tall even off-screen, since the sheet
 * scrolls it, same principle as the dock.
 */

import './shell.css'

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
  /** Which side of the screen this section's column docks to. */
  side: 'left' | 'right'
  /** One or more panels rendered together under this section's heading. */
  panels: HTMLElement[]
}

export interface HudShell {
  dispose(): void
}

const DESKTOP_QUERY = '(min-width: 960px)'

function buildColumn(section: HudSection): HTMLElement {
  const column = el('div', 'shell-dock__column')
  column.dataset.section = section.id
  column.append(el('h2', 'shell-dock__label', section.label), ...section.panels)
  return column
}

/** A section with no actual content shouldn't get a mobile tab of its own —
 * see the "empty Social tab" finding in the Phase 4 fix wave. */
function hasContent(section: HudSection): boolean {
  return section.panels.some((panel) => panel.childNodes.length > 0)
}

/** Measures the tab bar's real rendered height (including its own
 * safe-area-inset padding) and publishes it as a CSS variable, so the sheet
 * and the toast offset read one real measurement instead of guessing it
 * independently. Call whenever the tab bar's size could have changed. */
function publishTabbarHeight(tabbar: HTMLElement): void {
  const height = tabbar.getBoundingClientRect().height
  if (height > 0) {
    document.documentElement.style.setProperty('--shell-tabbar-h', `${height}px`)
  }
}

export function createShell(root: HTMLElement, sections: HudSection[]): HudShell {
  const columns = new Map<string, HTMLElement>()
  for (const section of sections) {
    columns.set(section.id, buildColumn(section))
  }

  // ------------------------------------------------------------- desktop

  const docks = new Map<'left' | 'right', HTMLElement>()
  for (const side of ['left', 'right'] as const) {
    if (sections.some((section) => section.side === side)) {
      docks.set(side, el('div', `shell-dock shell-dock--${side}`))
    }
  }

  // ------------------------------------------------------------- mobile

  const tabbar = el('div', 'shell-tabbar')
  const sheet = el('div', 'shell-sheet')
  const tabButtons = new Map<string, HTMLButtonElement>()
  const tabSections = sections.filter(hasContent)
  let activeId = tabSections[0]?.id

  const tabbarResizeObserver = new ResizeObserver(() => publishTabbarHeight(tabbar))
  tabbarResizeObserver.observe(tabbar)

  for (const section of tabSections) {
    const button = el('button', 'shell-tab', section.label)
    button.type = 'button'
    button.addEventListener('click', () => {
      activeId = section.id
      renderMobile()
    })
    tabButtons.set(section.id, button)
    tabbar.append(button)
  }

  function renderMobile(): void {
    for (const [id, button] of tabButtons) {
      button.classList.toggle('is-active', id === activeId)
    }
    const column = activeId ? columns.get(activeId) : undefined
    sheet.replaceChildren(...(column ? [column] : []))
  }

  // --------------------------------------------------------- mode switch

  const mq = window.matchMedia(DESKTOP_QUERY)

  function applyMode(): void {
    // Detach from wherever a column currently lives before re-attaching it —
    // appending an already-attached node moves it, but a stale empty dock
    // or sheet left behind looks like an empty panel rather than nothing.
    for (const dock of docks.values()) dock.remove()
    sheet.remove()
    tabbar.remove()

    if (mq.matches) {
      for (const section of sections) {
        docks.get(section.side)?.append(columns.get(section.id)!)
      }
      for (const dock of docks.values()) root.append(dock)
    } else {
      renderMobile()
      root.append(sheet, tabbar)
      // The tab bar has real layout only once it's in the DOM.
      publishTabbarHeight(tabbar)
    }
  }

  mq.addEventListener('change', applyMode)
  applyMode()

  return {
    dispose(): void {
      mq.removeEventListener('change', applyMode)
      tabbarResizeObserver.disconnect()
      for (const dock of docks.values()) dock.remove()
      sheet.remove()
      tabbar.remove()
    },
  }
}
