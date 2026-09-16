/**
 * Minimal modal focus management, shared by every full-screen `.overlay`
 * dialog (offline earnings in hud.ts, the leaderboard and friends modals).
 *
 * Each of those already closes on Escape (its own `keydown` listener) and on
 * a click outside the card — this only adds the other half of a modal's
 * keyboard contract: opening it moves focus onto the dialog itself instead
 * of leaving it wherever it was on the page behind it, Tab stays inside the
 * dialog while it's open rather than leaking into the dock bar underneath,
 * and closing it hands focus back to whatever opened it (the launcher
 * button, in every current case).
 */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (node) => node.offsetParent !== null,
  )
}

export interface DialogFocus {
  /** Call right after the dialog becomes visible. */
  open(): void
  /** Call right after the dialog is hidden again. */
  close(): void
  /** Feed every keydown the dialog already listens for (or the window's,
   * while it's open) through this — it only acts on Tab/Shift+Tab. */
  onKeydown(event: KeyboardEvent): void
}

/** `dialog` should carry `tabIndex = -1` so it's a valid focus target even
 * when it holds nothing focusable yet. */
export function createDialogFocus(dialog: HTMLElement): DialogFocus {
  let previouslyFocused: HTMLElement | null = null

  function open(): void {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = focusableIn(dialog)[0]
    ;(first ?? dialog).focus()
  }

  function close(): void {
    previouslyFocused?.focus()
    previouslyFocused = null
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return
    const focusable = focusableIn(dialog)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    const insideDialog = active instanceof Node && dialog.contains(active)
    if (event.shiftKey) {
      if (!insideDialog || active === first) {
        event.preventDefault()
        last.focus()
      }
    } else {
      if (!insideDialog || active === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  return { open, close, onKeydown }
}
