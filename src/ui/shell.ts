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
  /** One or more panels rendered together under this section's heading. */
  panels: HTMLElement[]
}

export interface HudShell {
  dispose(): void
}

export function createShell(root: HTMLElement, sections: HudSection[]): HudShell {
  const dock = el('div', 'shell-dock')

  for (const section of sections) {
    const column = el('div', 'shell-dock__column')
    column.dataset.section = section.id
    column.append(el('h2', 'shell-dock__label', section.label), ...section.panels)
    dock.append(column)
  }

  root.append(dock)

  return {
    dispose(): void {
      dock.remove()
    },
  }
}
