/**
 * The HUD's three-zone skeleton.
 *
 * Every HUD piece eventually mounts into one of three fixed zones instead of
 * being appended straight to `#ui` with its own ad-hoc `position: fixed`:
 *
 *   - top-left    — the resource ribbon (coins, income rate, happiness,
 *     population), its own small card built and styled by hud.ts/style.css
 *   - bottom-center — the build dock (already mostly there)
 *   - right-rail  — the inspect card, then the activity feed stacked below
 *     it (see main.ts's append order and activity.css)
 *
 * This module only builds the three mount points and appends them to the
 * document. It does not decide what goes in a zone, how a zone looks once
 * it has real content, or resize/restyle anything that moves into one — see
 * layout.css. Every occupant is laid out by its zone as a plain flow child
 * rather than positioning itself.
 */

import './layout.css'

export interface HudLayout {
  /** Mount point for the top-left zone (the resource ribbon). */
  topLeft: HTMLElement
  /** Mount point for the bottom-center zone (the build dock). */
  bottomCenter: HTMLElement
  /** Mount point for the right rail (inspect card + activity feed). */
  rightRail: HTMLElement
  dispose(): void
}

function zone(modifier: string): HTMLElement {
  const el = document.createElement('div')
  el.className = `hud-zone hud-zone--${modifier}`
  return el
}

/**
 * Builds the three zone containers and appends them to `root` (normally
 * `#ui`, matching the rest of the HUD). Returns each zone's mount element so
 * other modules can `append()` their existing content into the right one.
 */
export function createHudLayout(root: HTMLElement): HudLayout {
  const topLeft = zone('top-left')
  const bottomCenter = zone('bottom-center')
  const rightRail = zone('right-rail')

  root.append(topLeft, bottomCenter, rightRail)

  return {
    topLeft,
    bottomCenter,
    rightRail,
    dispose() {
      topLeft.remove()
      bottomCenter.remove()
      rightRail.remove()
    },
  }
}
