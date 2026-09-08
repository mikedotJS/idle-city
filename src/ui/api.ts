import type { CityState, Derived, QueueableType } from '../sim/types'
import type { Tool } from '../render/api'

export interface HoverInfo {
  title: string
  /** Body lines, already formatted for display. */
  lines: string[]
  /** Cost of the pending action, if the hovered target implies one. */
  cost?: number
  affordable?: boolean
}

export interface HudCallbacks {
  onSelectTool(tool: Tool): void
  onQueue(type: QueueableType): void
  onClearQueue(): void
}

export interface Hud {
  update(state: CityState, derived: Derived): void
  /** Reflect a tool chosen elsewhere, e.g. cleared with Escape after placing. */
  setTool(tool: Tool): void
  setHoverInfo(info: HoverInfo | null): void
  showOfflineEarnings(coins: number, seconds: number): void
  /** Transient message, e.g. "Not enough coins". */
  toast(message: string): void
}
