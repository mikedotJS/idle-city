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
 * Desktop-only for now: sections dock side by side, always visible. The
 * mobile bottom tab bar this is designed to grow into is a later pass — see
 * docs/superpowers/specs/2026-09-09-hud-shell-redesign-design.md.
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
 * providing the actual bound itself.
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

function buildColumn(section: HudSection): HTMLElement {
  const column = el('div', 'shell-dock__column')
  column.dataset.section = section.id
  column.append(el('h2', 'shell-dock__label', section.label), ...section.panels)
  return column
}

export function createShell(root: HTMLElement, sections: HudSection[]): HudShell {
  const docks: HTMLElement[] = []

  for (const side of ['left', 'right'] as const) {
    const sideSections = sections.filter((section) => section.side === side)
    if (sideSections.length === 0) continue
    const dock = el('div', `shell-dock shell-dock--${side}`)
    for (const section of sideSections) {
      dock.append(buildColumn(section))
    }
    root.append(dock)
    docks.push(dock)
  }

  return {
    dispose(): void {
      for (const dock of docks) dock.remove()
    },
  }
}
