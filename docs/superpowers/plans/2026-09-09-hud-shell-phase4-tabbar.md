# HUD Shell Phase 4: Mobile Tab Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Below a breakpoint, replace the always-visible docked columns with a bottom tab bar (Ville / Menu / Social) and a full-height sheet showing one section's content at a time — the actual "compact, touch-playable on a phone" result this whole redesign has been building toward. Above the breakpoint, nothing changes: docked columns, exactly as Phases 1-3 built them.

**Architecture:** `createShell` builds each section's column once, same as today, but no longer appends it directly — it keeps every column in a `Map<id, HTMLElement>` and re-parents them between two presentations depending on a `matchMedia` query: **desktop** (columns appended into their side's dock, as today) or **mobile** (only the active section's column appended into a full-height sheet, with a bottom tab bar to switch which one is active). Re-parenting moves the *same* DOM nodes — nothing is destroyed or rebuilt on a resize or a tab switch, so a signed-in Leaderboard form or a mid-scroll position survives both.

**Tech Stack:** TypeScript, Vite, vanilla DOM (no framework) — matches every other `ui/*.ts` module in this codebase.

**Spec:** `docs/superpowers/specs/2026-09-09-hud-shell-redesign-design.md`

## Global Constraints

- No unit tests exist for `ui/*.ts` in this project; this plan keeps that convention — verification is `npm run build`, `npm test`, and a live visual check at both a desktop and a phone-width viewport.
- Every panel's internal behaviour, copy, and event wiring is unchanged. This phase only changes *how many of a section's panels are visible at once and where* — a section's own panels (already built by Phases 1-3) are untouched.
- The breakpoint is 960px (`min-width: 960px` = desktop). Chosen with margin above the ~900-930px collision zone Phase 3's review measured for the current two-column desktop layout, so nothing straddles both a layout change and a near-collision at the same width.
- `HudSection`'s public shape (`id`, `label`, `side`, `panels`) does not change — `side` is simply ignored in mobile mode (there's only one active section at a time, so "which edge" is meaningless there).
- Content providers (`hud.ts`, `tools.ts`, `prestige.ts`, `musicsound.ts`, `leaderboard.ts`, `friends.ts`) are NOT touched by this plan. Everything they already return works unmodified in both presentations.

---

## File Structure

- **Modify** `src/ui/shell.ts` — the responsive rewrite: `matchMedia`, column re-parenting, tab bar, sheet, active-tab state.
- **Modify** `src/ui/shell.css` — new `.shell-tabbar`/`.shell-tab`/`.shell-sheet` rules; a scoped override so a column inside a sheet scrolls with the sheet instead of capping its own height.
- **Modify** `src/ui/style.css` — give `.toasts` a bottom offset that clears the tab bar when it's present; cap `.topstrip`'s width so it doesn't overflow a phone-width viewport.

---

### Task 1: Responsive shell — docks above the breakpoint, tab bar + sheet below it

**Files:**
- Modify: `src/ui/shell.ts` (the whole file body — see below)
- Modify: `src/ui/shell.css`

**Interfaces:**
- `HudSection` and `createShell(root, sections): HudShell` keep their existing public signatures — this task only changes `createShell`'s internal behaviour.

- [ ] **Step 1: Rewrite `src/ui/shell.ts`**

Replace the file's body from `export interface HudShell {` through the end of `createShell` with:

```ts
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
  let activeId = sections[0]?.id

  for (const section of sections) {
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
    }
  }

  mq.addEventListener('change', applyMode)
  applyMode()

  return {
    dispose(): void {
      mq.removeEventListener('change', applyMode)
      for (const dock of docks.values()) dock.remove()
      sheet.remove()
      tabbar.remove()
    },
  }
}
```

Keep the `HudSection` interface, the `el()` helper, and the file's import (`import './shell.css'`) exactly as they are — only the body from `HudShell` onward changes.

- [ ] **Step 2: Update the file's header docblock**

Replace the paragraph "Desktop-only for now: sections dock side by side, always visible. The mobile bottom tab bar this is designed to grow into is a later pass — see docs/superpowers/specs/2026-09-09-hud-shell-redesign-design.md." with a short paragraph describing what's actually true now: at or above 960px wide, sections dock side by side as before; below it, a bottom tab bar switches between full-height sheets, one section's content visible at a time, and the same DOM nodes move between the two presentations rather than being rebuilt.

- [ ] **Step 3: Add the mobile CSS to `src/ui/shell.css`**

Append to the end of the file:

```css
/* ---------------------------------------------------------------- mobile */

.shell-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 7;
  display: flex;
  gap: 4px;
  padding: 8px 8px calc(env(safe-area-inset-bottom, 0px) + 8px);
  background: var(--paper);
  border-top: 1px solid var(--line);
  pointer-events: auto;
}

.shell-tab {
  flex: 1;
  min-height: 44px;
  appearance: none;
  border: none;
  border-radius: var(--radius-card);
  background: transparent;
  color: var(--ink-soft);
  font: inherit;
  font-size: 13px;
  font-weight: 620;
  cursor: pointer;
}

.shell-tab.is-active {
  background: var(--accent-wash);
  color: var(--accent-deep);
}

.shell-sheet {
  position: fixed;
  inset: 0;
  bottom: 68px;
  z-index: 6;
  overflow-y: auto;
  background: var(--paper);
  padding: 16px;
  pointer-events: auto;
}

.shell-sheet .shell-dock__column {
  max-height: none;
  overflow-y: visible;
  align-items: stretch;
}
```

(`.shell-sheet`'s `bottom: 68px` clears the tab bar's own height — 44px min-height plus 16px of padding — with a little slack; `.shell-tabbar`'s `z-index: 7` keeps it above the sheet's `6` so the tab bar is never covered by the sheet's content scrolling underneath it.)

- [ ] **Step 4: Typecheck and build**

Run: `npm run build`
Expected: passes cleanly — this task's changes are self-contained to `shell.ts`/`shell.css`, and every existing caller of `createShell`/`HudSection` in `main.ts` still compiles against the unchanged public interface.

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: all 168 tests pass (unrelated to this change).

- [ ] **Step 6: Visual check — both breakpoints, tab switching, resize**

Load the game. At a desktop width (≥960px, e.g. 1440px): confirm nothing changed from Phase 3 — Ville left, Menu/Social right, all docked and always visible, no tab bar visible.

Resize (or load at) a width below 960px, e.g. 800px, then a phone width like 390px: confirm a bottom tab bar with three buttons (Ville, Menu, Social) appears, the docks disappear, and tapping each tab shows that section's panels full-height above the tab bar — Ville shows the build palette/hover panel/queue/restart; Menu shows music/sound, Tools, Prestige; Social shows the Leaderboard and Friends launchers, each still opening its own full-screen overlay correctly on top of everything.

Specifically verify state survives: open the Tools panel's own toggle while on the Menu tab, switch to the Ville tab, switch back to Menu — confirm Tools is still open (proving the column wasn't rebuilt). Then resize from mobile width back up to desktop width with the Ville tab active — confirm Ville's content reappears correctly in its desktop dock position, not stuck in a removed sheet.

- [ ] **Step 7: Commit**

```bash
git add src/ui/shell.ts src/ui/shell.css
git commit -m "feat(ui): mobile bottom tab bar below 960px

createShell now renders one of two presentations depending on a
matchMedia(min-width: 960px) query: docked columns (unchanged from
Phase 3) at or above it, or a bottom tab bar switching between full-
height sheets below it. Every section's column is built exactly once
and re-parented between the two — and between tabs — rather than
rebuilt, so a form left open or a mid-scroll position survives both a
tab switch and a resize across the breakpoint.

This is the presentation the whole redesign has been building toward:
the desktop dock work in Phases 1-3 turned eight independently
positioned panels into three consistent sections, and this is what
those same three sections look like with only one visible at a time
on a screen too narrow for all of them at once."
```

---

### Task 2: Toast/top-strip mobile awareness, and final verification

**Files:**
- Modify: `src/ui/style.css` (`.toasts`, `.topstrip`)

**Interfaces:** None — this task only adjusts CSS values, no interface changes.

- [ ] **Step 1: Give toasts room to clear the tab bar**

In `src/ui/style.css`, find the `.toasts` rule (currently `position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); ...`). Add a media query right after it:

```css
@media (max-width: 959px) {
  .toasts {
    bottom: 86px;
  }
}
```

(68px for the tab bar's own height, per Task 1's `.shell-sheet` comment, plus the original 18px margin — so a toast never sits under the tab bar on a narrow viewport. `959px`, one below the shell's own `960px` breakpoint, so the two switch at the same point.)

- [ ] **Step 2: Cap the top strip's width so it doesn't overflow a phone screen**

Find the `.topstrip` rule. Add one property to it: `max-width: calc(100vw - 36px);` (18px margin on each side, matching every other panel's edge margin in this codebase). If the strip's content still doesn't fit at very narrow widths once this cap is in place, that's expected and fine — the browser will wrap or the row will scroll horizontally within its own box; this step's job is only to stop the strip from forcing the *page* wider than the viewport, not to redesign its internal layout for tiny screens.

- [ ] **Step 3: Typecheck, build, test**

Run: `npm run build` — expected to pass cleanly.
Run: `npm test` — expected 168/168.

- [ ] **Step 4: Full final visual pass**

At a phone width (e.g. 390px) and a small-tablet width (e.g. 800px):
- Trigger a toast; confirm it renders fully above the tab bar, not under it.
- Confirm the top strip doesn't cause horizontal page scrolling (check `document.documentElement.scrollWidth` isn't greater than the viewport width, or just visually confirm no horizontal scrollbar).
- Re-open each of the three tabs once more and confirm every panel inside still works (a build placed from the palette, a tile hover, the Tools speed buttons, a Leaderboard sign-in attempt) — this is the last check in the whole four-phase redesign, so be thorough rather than quick.
- At a desktop width, confirm toasts and the top strip look exactly as they did at the end of Phase 3 (the `max-width: 959px` media query and this task's `.toasts` change should have zero effect there).

- [ ] **Step 5: Commit**

```bash
git add src/ui/style.css
git commit -m "fix(ui): keep toasts clear of the tab bar, cap the top strip's width

Two small mobile-only adjustments to close out the redesign: toasts
get a taller bottom offset below 960px so the new tab bar (Task 1)
never covers one, and the top strip gets a max-width so it can't force
the page wider than a phone screen. Neither has any effect at desktop
widths."
```

---

## What comes after this plan

A final CSS/comment sweep across every module this four-phase redesign touched — Phase 1's plan flagged this as the very last step, and by now there are a handful of small items already deferred across all four phases' final reviews (stale comments, the unused `HudShell.dispose()`/discarded `createShell` return value, a couple of Minor polish items). Otherwise, the redesign described in `docs/superpowers/specs/2026-09-09-hud-shell-redesign-design.md` is complete: one placement system, from phone to desktop.
