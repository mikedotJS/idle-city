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
  /** Compact, always-visible readouts. Placed by main.ts outside any
   * shell section — it must stay visible no matter which section (or,
   * later, which mobile tab) is open. */
  topStripElement: HTMLElement
  /** The "Place by hand" build palette. */
  paletteElement: HTMLElement
  /** The hovered-tile info panel, shown beneath the palette in the Ville tab
   * (phone/tablet widths). */
  hoverPanelElement: HTMLElement
  /** The same hovered-tile info, as a standalone floating card. Placed by
   * main.ts outside any shell section, directly on `#ui`; CSS shows it only
   * at desktop widths (and hides `hoverPanelElement`'s copy inside the Ville
   * tab there), so the info reads as its own thing instead of hiding inside
   * a menu once there's room for it to float freely. */
  hoverCardElement: HTMLElement
  /** The build queue. */
  queueElement: HTMLElement
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
