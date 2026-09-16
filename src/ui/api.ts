import type { BuildingType, CityState, Derived, QueueableType } from '../sim/types'
import type { Tool } from '../render/api'

export interface HoverInfo {
  title: string
  /** Body lines, already formatted for display. */
  lines: string[]
  /** Cost of the pending action, if the hovered target implies one. */
  cost?: number
  affordable?: boolean
  /** The building this info is about — a built one, or the one about to be
   * placed. Unset for land with no building attached to it (an empty lot,
   * unclaimed land). */
  icon?: BuildingType
}

export interface HudCallbacks {
  onSelectTool(tool: Tool): void
  onQueue(type: QueueableType): void
  onClearQueue(): void
  /** Abandon this city and start a new one on fresh land. Destructive. */
  onRestart(): void
  /** A toast is about to be shown — the hook sound design plays a chime off, rather than every call site remembering to. */
  onToastShown?(): void
}

export interface Hud {
  /** The resource ribbon card (coins, income rate, happiness, population).
   * Placed by main.ts in the top-left HUD zone, outside any shell section —
   * it must stay visible no matter which section (or, later, which mobile
   * tab) is open. */
  topStripElement: HTMLElement
  /** The permanent row of build tool tiles (house/shop/.../demolish),
   * placed by main.ts directly in the dock bar rather than in any shell
   * section's popover — see shell.ts. */
  buildDockElement: HTMLElement
  /** The single inspect card: whatever tile or building is currently
   * hovered or selected, at every viewport size. Placed by main.ts in the
   * right-rail HUD zone, alongside the activity feed — see layout.ts. Shows
   * a placeholder message when nothing is hovered or selected, rather than
   * disappearing, so the right rail always holds the same card. */
  inspectElement: HTMLElement
  /** The compact "what's building now" strip, docked directly above the
   * build dock bar — see shell.ts. Always on screen: it also carries the
   * queue's own controls (add house/shop, pause) as small inline icon
   * buttons, so it's the only place needed to manage the queue — only its
   * "now building" readout hides itself when the queue is empty. */
  queueStripElement: HTMLElement
  /** The "New city" restart button, in its own panel. */
  restartElement: HTMLElement
  update(state: CityState, derived: Derived): void
  /** Reflect a tool chosen elsewhere, e.g. cleared with Escape after placing. */
  setTool(tool: Tool): void
  setHoverInfo(info: HoverInfo | null): void
  showOfflineEarnings(coins: number, seconds: number): void
  /** Transient message, e.g. "Not enough coins". */
  toast(message: string): void
}
