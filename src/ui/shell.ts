/**
 * The shell: the single place every HUD section gets positioned.
 *
 * One floating bar, centered at the bottom of the screen, at every viewport
 * size — no more separate desktop docks and mobile tab bar. The always-
 * visible resource readout (coins, income/s, happiness, population) lives in
 * its own card in the top-left HUD zone now, built and updated by hud.ts —
 * see main.ts and layout.ts.
 *
 * The bar itself carries a single "More" button rather than one tab per
 * section (the earlier Ville/Menu/Social split): tapping it opens one sheet
 * — a popover with its own internal nav column listing every section (Sound,
 * Speed, Prestige, Leaderboard, Friends) down the side. Picking a nav item
 * swaps which section's panels show in the sheet's body without closing and
 * reopening it; only the "More" button and the sheet's own close button
 * toggle the sheet itself. This replaced the one-tab-per-section dock once
 * build tools and the queue got their own permanent places in the bar (see
 * hud.ts's buildDockElement/queueStripElement below) and only a handful of
 * secondary sections were left needing a home at all — one entry point for
 * all of them reads as "more stuff", not as three unrelated destinations.
 *
 * Only CSS media queries change between screen sizes (padding, which stats
 * stay visible, whether the sheet's nav sits beside its body or above it):
 * the DOM and the interaction are identical on a phone and on a desktop
 * monitor, which is the whole point of building one shared block instead of
 * a dock/tabbar split that only ever grew further apart with each phase.
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

/**
 * One small decorative icon per sheet nav item, inlined as SVG rather than
 * built assets (unlike the old per-tab NAV_ICONS) — these only ever live
 * inside the sheet's own nav column, not the bar, and there are exactly five
 * of them, each already validated in the approved Design Canvas mockup
 * (MoreSheet.dc.html). A section id with no entry here still gets a nav
 * item, just text-only — see the nav-item loop in `createShell` below.
 */
const SECTION_ICONS: Record<string, string> = {
  sound:
    '<path d="M11 5 6 9H3v6h3l5 4z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path>',
  speed: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"></path>',
  prestige:
    '<path d="M12 2 4 7v6c0 5 3.6 7.4 8 9 4.4-1.6 8-4 8-9V7z"></path>',
  leaderboard: '<path d="M3 17l4-8 4 5 3-4 7 7"></path>',
  friends:
    '<circle cx="9" cy="8" r="3"></circle><path d="M2 20c0-3.3 3.1-6 7-6s7 2.7 7 6"></path><circle cx="18" cy="9" r="2.4"></circle><path d="M16 14.2c2.7.4 5 2.2 5 5.8"></path>',
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function buildIcon(innerMarkup: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  // Static, built-in markup only (SECTION_ICONS above) — never user input.
  svg.innerHTML = innerMarkup
  return svg
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

export interface HudSection {
  id: string
  label: string
  /** One or more panels rendered together under this section's heading. */
  panels: HTMLElement[]
}

export interface HudShell {
  /** Close the sheet, if it's open — e.g. once picking a tool from the
   * board's build tiles hands control back to the board. A no-op when
   * nothing is open. */
  close(): void
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

/** Measures the whole bottom-center cluster's real rendered height
 * (including its own safe-area-inset padding, and the queue strip above the
 * bar whenever it's showing) and publishes it as a CSS variable, so the
 * popover and the toast offset read one real measurement instead of
 * guessing it independently. Needed at every breakpoint now: the bar sits
 * bottom-center on desktop too, where toasts used to have the run of the
 * bottom edge to themselves. Named for the bar for history's sake — it kept
 * working unchanged for every existing reader when the queue strip joined
 * the stack above it. */
function publishBarHeight(stack: HTMLElement): void {
  const height = stack.getBoundingClientRect().height
  if (height > 0) {
    document.documentElement.style.setProperty('--dock-bar-h', `${height}px`)
  }
}

export function createShell(
  root: HTMLElement,
  sections: HudSection[],
  /** The permanent build-tool tile row (hud.ts's `buildDockElement`), laid
   * out in the bar itself ahead of the section tabs rather than inside any
   * popover — the one thing in the bar that isn't a tab. Optional so a shell
   * with nothing to build (there is none today) still works. */
  buildDock?: HTMLElement,
  /** hud.ts's compact `queueStripElement`, docked directly above the bar in
   * the same fixed bottom-center cluster (`.dock-stack`) rather than as a
   * separately positioned element. It carries the queue's own controls
   * (add house/shop, pause) as well as its "now building" readout, so it
   * stays on screen at all times rather than hiding when the queue empties
   * — only that readout hides itself then. */
  queueStrip?: HTMLElement,
): HudShell {
  const tabSections = sections.filter(hasContent)
  const columns = new Map<string, HTMLElement>()
  for (const section of tabSections) {
    columns.set(section.id, buildColumn(section))
  }

  const bar = el('div', 'dock-bar')
  const tabs = el('div', 'dock-bar__tabs')
  if (buildDock) bar.append(buildDock)
  bar.append(tabs)

  // The fixed, centered bottom-center cluster: the queue strip (when the
  // queue holds anything) stacked directly above the bar, both laid out as
  // one visually connected column rather than two independently positioned
  // elements that happen to line up.
  const stack = el('div', 'dock-stack')
  if (queueStrip) stack.append(queueStrip)
  stack.append(bar)

  // The single "More" dock button. It only opens/closes the sheet as a
  // whole; which section the sheet shows is switched by the nav column
  // inside it (`popoverNav` below), not by this button.
  const moreButton = el('button', 'dock-tab dock-tab--more')
  moreButton.type = 'button'
  moreButton.title = 'More'
  moreButton.setAttribute('aria-label', 'More')
  moreButton.setAttribute('aria-pressed', 'false')
  moreButton.append(el('span', 'dock-tab__label', '•••'))

  // One sheet for every section: a nav column listing all of them down the
  // side, and a main area — a title (the active section's own label, one
  // heading, not a second hidden one under it), a close button, then that
  // section's panels underneath. Only the main area's content swaps when a
  // nav item is picked; the sheet itself never closes and reopens for that
  // — see shell.css's `.dock-popover` / `.dock-popover__nav` for the layout.
  const popover = el('div', 'dock-popover')
  popover.hidden = true
  const popoverNav = el('div', 'dock-popover__nav')
  const popoverMain = el('div', 'dock-popover__main')
  const popoverHead = el('div', 'dock-popover__head')
  const popoverTitle = el('h2', 'dock-popover__title')
  const popoverClose = el('button', 'dock-popover__close', '×')
  popoverClose.type = 'button'
  popoverClose.setAttribute('aria-label', 'Close')
  popoverHead.append(popoverTitle, popoverClose)
  const popoverBody = el('div', 'dock-popover__body')
  popoverMain.append(popoverHead, popoverBody)
  popover.append(popoverNav, popoverMain)

  const sectionsById = new Map(tabSections.map((section) => [section.id, section]))
  const navButtons = new Map<string, HTMLButtonElement>()

  // Closed by default at every size: the bar alone is the resting state,
  // and nothing forces the sheet open just because the screen is narrow —
  // the previous mobile tab bar always had one sheet open on first paint.
  let open = false
  // Which section the sheet shows once it's open. Persists across opens —
  // closing the sheet to tap the board and reopening it lands back on
  // whatever you were last looking at, rather than resetting every time.
  // "sound" is the stable first-run default (see the task's own note on
  // picking one); falls back to the first section that actually has
  // content if "sound" isn't among them.
  let currentId: string | null = sectionsById.has('sound')
    ? 'sound'
    : (tabSections[0]?.id ?? null)

  function render(): void {
    moreButton.classList.toggle('is-active', open)
    moreButton.setAttribute('aria-pressed', String(open))

    for (const [id, button] of navButtons) {
      const active = id === currentId
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-pressed', String(active))
    }
    const section = currentId ? sectionsById.get(currentId) : undefined
    const column = currentId ? columns.get(currentId) : undefined
    popoverTitle.textContent = section?.label ?? ''
    popoverBody.replaceChildren(...(column ? [column] : []))
    popover.hidden = !open
  }

  moreButton.addEventListener('click', () => {
    open = !open
    render()
  })

  popoverClose.addEventListener('click', () => {
    open = false
    render()
  })

  for (const section of tabSections) {
    const button = el('button', 'dock-popover__nav-item')
    button.type = 'button'
    const icon = SECTION_ICONS[section.id]
    if (icon) button.append(buildIcon(icon))
    button.append(el('span', 'dock-popover__nav-label', section.label))
    button.setAttribute('aria-pressed', 'false')
    button.addEventListener('click', () => {
      // Switches the sheet's content in place — the sheet stays open.
      currentId = section.id
      render()
    })
    navButtons.set(section.id, button)
    popoverNav.append(button)
  }

  if (tabSections.length > 0) tabs.append(moreButton)

  // Observes the whole stack, not just the bar: the queue strip showing or
  // hiding changes the cluster's height too, and the popover/toast offset
  // need to track that same change.
  const barResizeObserver = new ResizeObserver(() => publishBarHeight(stack))
  barResizeObserver.observe(stack)

  root.append(popover, stack)
  // The stack has real layout only once it's in the DOM.
  publishBarHeight(stack)
  render()

  return {
    close(): void {
      if (!open) return
      open = false
      render()
    },
    dispose(): void {
      barResizeObserver.disconnect()
      popover.remove()
      stack.remove()
    },
  }
}
