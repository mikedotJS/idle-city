# HUD shell redesign — one placement system, mobile-playable

## Context

The HUD has no single layout system. Eight regions position themselves
independently, several with hand-tuned pixel offsets that reference each
other (`.tools-root` sits at `right: calc(var(--hud-side) + 30px)`,
`.panel--friends-launch` sits at `bottom: 92px` specifically to clear
`.panel--board-launch` beneath it). `prestige.ts`'s header comment documents
that a correctly-wired button has shipped hidden under another fixed panel
**twice**, and that every new panel now requires manually cross-checking its
position against six others. Adding the Friends panel in this same session
repeated that pattern — a fixed offset chosen by eyeballing a screenshot.

Mobile support is superficial: one media query at 900px shrinks gaps and
zone width. Nothing reflows, nothing stacks, nothing accounts for touch.

**Goal:** one responsive placement system, from phone to desktop, that a new
panel plugs into without anyone hand-checking pixel coordinates — and that
makes the game genuinely playable, one-handed, on a phone.

## Decisions made during brainstorming

- **Mobile target:** real touch playability (not just "doesn't break").
- **Scope:** one unified system across all viewport sizes, not a separate
  mobile codepath bolted onto the existing desktop layout.
- **Navigation shape (chosen over a side drawer and an icon-dock
  alternative):** a persistent top strip plus three grouped sections —
  **Ville**, **Social**, **Menu** — rendered as a bottom tab bar with
  full-screen sheets under the breakpoint, and as docked side-by-side panels
  above it.
- **Top strip content:** coins, income/s, happiness, population, next-build
  badge — the full current top-left readout, not a trimmed version.
- **Grouping:**
  - **Ville** — build palette ("Place by hand"), the build queue, and the
    activity feed (folded in here rather than kept as its own floating
    panel).
  - **Social** — Leaderboard, Friends.
  - **Menu** — speed control, undo demolition, export city, Prestige,
    music/sound toggles and volume.
- Toasts stay a separate, transient overlay system — unaffected by which
  tab is active, just repositioned to clear the mobile tab bar.

## Non-goals

- No change to any panel's internal behaviour, copy, or data (Tools,
  Prestige, Leaderboard, Friends, the build palette, the activity feed all
  keep doing exactly what they do today).
- No change to the 3D scene, camera, or tile interaction.
- Not attempting pixel-perfect parity with the current desktop look — the
  desktop layout is allowed to look different where the new shared system
  genuinely serves it better, but should not feel like a downgrade.

## Architecture

### New module: `src/ui/shell.ts`

The single owner of layout. Everything that used to `position: fixed`
itself now mounts into a zone the shell hands it. Responsibilities:

1. **Top strip** — renders the five always-visible readouts directly (it's
   simple enough not to need its own module; reads the same values
   `hud.ts`'s current top-left panel reads today).
2. **Section registry** — three named sections (`ville`, `social`, `menu`),
   each a list of **content providers** (see below) rendered in order.
3. **Responsive shell** — a single breakpoint (reuse/tune the existing
   900px). Below it: bottom tab bar, one section's content visible at a
   time in a full-height sheet. At or above it: all three sections docked
   side-by-side (Ville left, Social + Menu right, mirroring today's
   left/right split), no tab bar rendered at all.
4. **Mount/unmount lifecycle** — a content provider's DOM node is created
   once and moved between "docked" and "sheet" containers on breakpoint
   crossing (a `matchMedia` listener), not recreated — state inside a panel
   (e.g. an open form, scroll position) survives a resize.

### Content provider contract

Every existing panel module changes from *"create my own fixed-position
launcher and overlay"* to *"hand the shell a mount function"*:

```ts
export interface HudSection {
  id: 'ville' | 'social' | 'menu'
  /** Short label + icon for the tab bar / dock header. */
  label: string
  /** Called once; returns the root node the shell places. */
  mount(): HTMLElement
}
```

`tools.ts`, `prestige.ts`, `leaderboard.ts`, `friends.ts` each keep their
existing internal panel markup and event wiring — the only change is
deleting their own launcher button + `position: fixed` overlay code, and
returning their `panel` element (or a small wrapping fragment) through
`mount()` instead. The build palette, build queue, and activity feed move
from `hud.ts`/`activity.ts`'s current zone wiring into the `ville`
section's provider list the same way.

Two different things currently answer to "launcher button," and the
migration treats them differently. Leaderboard and Friends each open a
*separate modal overlay* — that pattern goes away entirely; the shell's own
tab/dock chrome is now what shows or hides their content, so their overlay
markup collapses into a plain mounted panel. Tools and Prestige instead
*collapse inline in place* (no overlay) — that's a second, independent
axis (declutter a docked panel, not switch sections) and can stay as
internal detail inside their `mount()`ed content if it still earns its
keep once the Menu section itself already gates visibility. Prestige's
live charter badge in particular is worth moving onto the Menu section's
own tab/dock header instead of Prestige's own toggle — a decision left to
the implementation plan, not resolved here.

`main.ts` changes from calling `createXUI(uiRoot, ...)` (each wiring itself
into the DOM) to registering each section's providers with
`createShell(uiRoot, { ville: [...], social: [...], menu: [...] })`, which
does the actual `root.append(...)`.

### CSS

- Retire `.hud__zone`, `.hud__zone--tl/--tr`, `.panel--board-launch`,
  `.panel--friends-launch`, `.tools-root`, `.prestige-root`,
  `.activity-root` and their fixed offsets.
- New: `.shell-topstrip` (fixed top, full width, the five readouts), 
  `.shell-dock` (desktop docked columns), `.shell-tabbar` (mobile bottom
  bar), `.shell-sheet` (mobile full-height section content).
- `--hud-side` and other sizing tokens carry over where still meaningful;
  audited during implementation rather than decided here.

### Data flow

Unchanged. The shell owns no sim state — it's pure layout. The top strip
reads the same `Derived`/`CityState` values `hud.ts` already reads on every
frame; each section's content provider keeps reading whatever it already
reads today (e.g. `leaderboard.ts` still takes a `Leaderboard` and a
`getState` callback).

### Toasts

Stay in their current module, anchored bottom-center, z-indexed above the
shell. Only change: their bottom offset becomes aware of the mobile tab
bar's height (a CSS custom property the shell sets) so a toast never sits
under it.

### Overlays unaffected by this change

The "Welcome back" offline-earnings modal and any other full-screen
`.overlay` stay exactly as they are — they already sit above everything
via `z-index`, independent of panel placement.

## Testing

- No sim/economy logic changes, so no new `sim/` tests.
- `ui/` in this project has no unit tests today (network-backed panels are
  verified live instead); this stays consistent — the shell's correctness
  is verified visually: build queue, palette, activity feed, leaderboard,
  friends, tools, and prestige each checked in both the docked (desktop)
  and sheet (mobile-width) presentation, plus a resize between the two to
  confirm state survives (e.g. an open leaderboard sign-in form isn't wiped
  by crossing the breakpoint).
- Manual pass at a real phone viewport width for touch target sizing
  (buttons large enough to tap, no hover-only affordances left — the info
  badges added for the leaderboard/friends tooltips need a tap-friendly
  fallback, since `title` tooltips don't work on touch).

## Migration order (for the implementation plan)

Suggested sequence, each independently shippable:
1. Build `ui/shell.ts` with the top strip and the docked (desktop) layout
   only, migrating one section at a time onto it (start with Menu — lowest
   traffic, safest to get wrong first).
2. Add the mobile tab bar / sheet behaviour once all three sections are on
   the shell.
3. Retire the old CSS classes and any now-dead code in the migrated
   modules.

## Open risk

Touch-target sizing and the hover-tooltip fallback (the `title`-based info
badges from the leaderboard/friends work) are the two things most likely to
need a real device check rather than a resized desktop browser window.
