# HUD Shell Phase 3: Ville Section + Compact Top Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the last independently-positioned HUD zones (the build palette, the build queue, and the tall readouts card) by docking the palette and queue into a new "Ville" shell section anchored on the LEFT, and replacing the tall readouts card with a genuinely compact, always-visible top strip. This is the change that actually makes the HUD look compact — Phases 1-2 only fixed *how* panels get positioned, not how much room they take up.

**Architecture:** `ui/shell.ts` gains a `side: 'left' | 'right'` field on `HudSection` and splits its single right-anchored dock into two independent docks (left and right), each with its own bounded/scrollable column — closing the architectural gap the Phase 2 final review flagged (a single right-anchored dock can't express "Ville left, Social+Menu right", and grows unboundedly leftward as columns are added). `ui/hud.ts` keeps its existing internal cohesion (one `update()` reading all sim state each frame) but stops wrapping everything in one `.hud` grid div — it now exposes five separate elements for callers to place: a new compact top strip, the build palette, the hover-info panel, the build queue, and the restart button. `main.ts` mounts the top strip directly (outside any section — it must stay visible no matter what), and registers palette/hover/queue/restart as the new `ville` section's panels.

**Tech Stack:** TypeScript, Vite, vanilla DOM (no framework) — matches every other `ui/*.ts` module in this codebase.

**Spec:** `docs/superpowers/specs/2026-09-09-hud-shell-redesign-design.md`

## Global Constraints

- No unit tests exist for `ui/*.ts` in this project; this plan keeps that convention — verification is `npm run build`, `npm test`, and a live visual check.
- The build palette, hover panel, build queue, and restart button keep their exact current internal behaviour, copy, and event wiring — only their placement and their DOM grouping change (they stop sharing an intermediate `.hud__zone` wrapper div and become independent panels in a shell section, matching how Tools/Prestige/music-sound already work).
- The top strip is the ONE exception to "placement only": it is a genuine visual redesign (a compact single row replacing the current tall, multi-block readouts card), approved during this redesign's brainstorming. Its underlying data (coins, income rate, happiness, population) and update cadence are unchanged — only the DOM/CSS presenting them is new.
- Desktop-only shell still. Narrow-viewport collision (already tracked from Phase 2's review) is not this plan's job to fix, but this plan's own left-dock addition must not make it worse than what Phase 2 already left — verify, don't just assume.
- This is Phase 3 (Ville). The mobile bottom tab bar is the next, final phase.

---

## File Structure

- **Modify** `src/ui/hud.ts` — the biggest change: stop wrapping palette/hover/queue/restart in `.hud`/`.hud__zone` divs; build a new compact top strip; expose five elements instead of appending two zone divs to `root`.
- **Modify** `src/ui/api.ts` — `Hud` gains the five new element fields.
- **Modify** `src/ui/style.css` — remove `.hud`, `.hud__zone`, `.hud__zone--tl`, `.hud__zone--tr` and their media-query rules (all now dead); give the four migrating panels an explicit width to replace the one they lost; add the new top strip's CSS.
- **Modify** `src/ui/shell.ts` — `HudSection` gains `side: 'left' | 'right'`; `createShell` renders one dock per side actually in use.
- **Modify** `src/ui/shell.css` — split the single right-anchored `.shell-dock` into `.shell-dock--left` / `.shell-dock--right`, each independently anchored and independently bounded/scrollable.
- **Modify** `src/main.ts` — mount the top strip directly; register the new `ville` section (`side: 'left'`); the existing `menu`/`social` sections both get `side: 'right'`.

---

### Task 1: Rebuild `hud.ts` — compact top strip, unbundled palette/queue elements

**Files:**
- Modify: `src/ui/hud.ts` (most of the file — see steps below for exact regions)
- Modify: `src/ui/api.ts` (the `Hud` interface)
- Modify: `src/ui/style.css` (remove dead zone CSS, add the top strip's CSS, width-fix the four migrating panels)

**Interfaces:**
- Produces: `Hud` gains
  ```ts
  export interface Hud {
    /** Compact, always-visible readouts. Placed by main.ts outside any
     * shell section — it must stay visible no matter which section (or,
     * later, which mobile tab) is open. */
    topStripElement: HTMLElement
    /** The "Place by hand" build palette. */
    paletteElement: HTMLElement
    /** The hovered-tile info panel, shown beneath the palette. */
    hoverPanelElement: HTMLElement
    /** The build queue. */
    queueElement: HTMLElement
    /** The "New city" restart button, in its own panel. */
    restartElement: HTMLElement
    update(state: CityState, derived: Derived): void
    setTool(tool: Tool): void
    setHoverInfo(info: HoverInfo | null): void
    showOfflineEarnings(coins: number, seconds: number): void
    toast(message: string): void
  }
  ```
  (`setMusicState`/`setSfxState` are already gone from Phase 1 — this only adds the five new fields.)

- [ ] **Step 1: Build the compact top strip, replacing the old `readouts` panel**

In `src/ui/hud.ts`, replace the whole `// ---------------------------------------------------------------- readouts` region (currently from `const topLeft = el('div', 'hud__zone hud__zone--tl')` down through `readouts.append(coinsBlock, statGrid, happy, multNote)`, i.e. lines 97-140 in the current file) with:

```ts
  // -------------------------------------------------------------- top strip

  const topStrip = el('section', 'panel topstrip')
  const tsCoins = el('span', 'topstrip__coins', '0')
  const tsRate = el('span', 'topstrip__rate', '+0.0/s')
  const tsHappy = el('span', 'topstrip__stat', '😊 50%')
  const tsPop = el('span', 'topstrip__stat', '👥 0')
  const tsNext = el('span', 'topstrip__next', '')
  const tsInfo = el('span', 'topstrip__info', 'i')
  tsInfo.tabIndex = 0
  tsInfo.title =
    'Income multiplier = 0.50 + happiness, so 0.50x at worst and 1.50x at best — the rate shown here already includes it. A happier city earns more from the same buildings, and builds faster too.'
  topStrip.append(
    el('span', 'topstrip__coin-icon', '💰'),
    tsCoins,
    tsRate,
    tsHappy,
    tsPop,
    tsNext,
    tsInfo,
  )
```

(`tsNext` starts empty — it's filled in once something is actually queued, wired in Step 4's `update()`, since that needs the queue's own state.)

- [ ] **Step 2: Unbundle the palette and hover panel**

Immediately after Step 1's block, the file currently has (unchanged in this step, just renamed as noted):
- `const hoverPanel = el('section', 'panel panel--hover')` through `hoverPanel.append(hoverTitle, hoverLines, hoverCost)` — **unchanged**, keep exactly as-is.
- `topLeft.append(readouts)` — **delete this line** (there is no more `topLeft`, and `readouts` no longer exists after Step 1).
- The `// ------------------------------------------------------------ tool palette` region builds `toolsPanel` exactly as today — **unchanged** through `toolsPanel.append(el('p', 'hint', 'The pale land...'))`.
- Delete the comment block and line `topLeft.append(toolsPanel, hoverPanel)` (the "One left-hand column, not two..." comment and the append call) — `toolsPanel` and `hoverPanel` are now returned separately (Step 5), not appended to any shared wrapper.

- [ ] **Step 3: Unbundle the queue and restart panel**

The `// ------------------------------------------------------------- build queue` region currently starts with `const rightSide = el('div', 'hud__zone hud__zone--tr')` — delete that line. Everything else that builds `queuePanel` is unchanged through `queuePanel.append(queueList, queueRepeat, queueActions)`. Delete the line `rightSide.append(queuePanel)`.

The restart button's construction (`const restartPanel = el(...)` etc.) is unchanged. Delete the "Its own panel, not a third button..." comment's trailing `rightSide.append(restartPanel)` line.

- [ ] **Step 4: Update `update()` to paint the top strip instead of the old readouts, and add the next-build badge**

Replace the block that currently reads:

```ts
  function update(state: CityState, derived: Derived): void {
    setText(coinsValue, formatCoins(advanceCoins(state.coins)))

    if (derived.incomeRate !== lastRate) {
      lastRate = derived.incomeRate
      setText(coinsRate, '+' + formatRate(derived.incomeRate) + '/s')
    }

    if (derived.population !== lastPopulation) {
      lastPopulation = derived.population
      setText(popValue, formatCoins(derived.population))
    }

    const happiness = derived.cityHappiness
    if (!(Math.abs(happiness - lastHappiness) < 0.0005)) {
      lastHappiness = happiness
      setText(happyValue, formatPercent(happiness))
      setText(multValue, formatMultiplier(INCOME_FLOOR + happiness))
      meterFill.style.width = (Math.max(0, Math.min(1, happiness)) * 100).toFixed(1) + '%'
      const band = happinessBand(happiness)
      if (band.key !== lastBand) {
        lastBand = band.key
        setText(happyBadge, band.label)
        setText(happyNote, band.note)
        setClass(happyBadge, 'badge badge--' + band.key)
        setClass(meterFill, 'meter__fill meter__fill--' + band.key)
      }
    }
```

with:

```ts
  function update(state: CityState, derived: Derived): void {
    setText(tsCoins, formatCoins(advanceCoins(state.coins)))

    if (derived.incomeRate !== lastRate) {
      lastRate = derived.incomeRate
      setText(tsRate, '+' + formatRate(derived.incomeRate) + '/s')
    }

    if (derived.population !== lastPopulation) {
      lastPopulation = derived.population
      setText(tsPop, '👥 ' + formatCoins(derived.population))
    }

    const happiness = derived.cityHappiness
    if (!(Math.abs(happiness - lastHappiness) < 0.0005)) {
      lastHappiness = happiness
      setText(tsHappy, '😊 ' + formatPercent(happiness))
      const band = happinessBand(happiness)
      if (band.key !== lastBand) {
        lastBand = band.key
        setClass(topStrip, 'panel topstrip topstrip--' + band.key)
      }
    }
```

`formatMultiplier`, `happyBadge`, `happyNote`, `meterFill`, `meter`, `multValue`, `multNote`, `INCOME_FLOOR` are no longer referenced anywhere in the file after this change — remove the now-unused `INCOME_FLOOR` and `formatMultiplier` imports at the top of the file, and remove the `HappinessKey` import if `lastBand`'s type is its only remaining use (check — it likely still needs `HappinessKey` for `lastBand`'s type, in which case keep that one import).

Directly below `renderQueue(state)` (still called at the end of `update()`, unchanged), add:

```ts
    const nextBuild = state.queue[0]
    const nextLabel = nextBuild ? '▶ ' + BUILDINGS[nextBuild].label : ''
    setText(tsNext, nextLabel)
```

(`tsNext` is the element Step 1 already created and appended to the strip.)

- [ ] **Step 5: Update the final return, and what gets appended to `root`**

Replace:

```ts
  hud.append(topLeft, rightSide, toastLayer, offlineOverlay)
  root.append(hud)
```

with:

```ts
  root.append(toastLayer, offlineOverlay)
```

(There is no more `hud` wrapper div — delete `const hud = el('div', 'hud')` too, at the top of `createHud`.)

Replace the final `return`:

```ts
  return { update, setTool, setHoverInfo, showOfflineEarnings, toast }
```

with:

```ts
  return {
    topStripElement: topStrip,
    paletteElement: toolsPanel,
    hoverPanelElement: hoverPanel,
    queueElement: queuePanel,
    restartElement: restartPanel,
    update,
    setTool,
    setHoverInfo,
    showOfflineEarnings,
    toast,
  }
```

- [ ] **Step 6: Update `src/ui/api.ts`**

Add the five new fields to the `Hud` interface exactly as specified in this task's "Interfaces" section above, above the existing `update(...)` line.

- [ ] **Step 7: CSS — remove the dead zone rules, add the top strip, width-fix the four migrating panels**

In `src/ui/style.css`:

Delete `.hud` (currently lines 84-93), `.hud__zone` (95-101), `.hud__zone--tl` (103-110), `.hud__zone--tr` (112-115), and the `@media (max-width: 900px)` block's `.hud`/`.hud__zone` rules (currently lines 728-736) — all now dead, nothing references these classes anymore after this task.

Add, near where `.panel--hover`/`.panel--tools` are defined:

```css
/* These four used to get their width for free from the `.hud__zone`
   wrapper they shared. Now that each is its own top-level panel in the
   Ville shell section, each needs to say so itself. */
.panel--tools,
.panel--hover,
.panel--queue,
.panel--restart {
  width: var(--hud-side);
}
```

Add a new section for the top strip:

```css
/* --------------------------------------------------------------- topstrip */

.topstrip {
  position: fixed;
  top: 18px;
  left: 18px;
  z-index: 5;
  flex-direction: row;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  pointer-events: auto;
  font-variant-numeric: tabular-nums;
}

.topstrip__coin-icon {
  font-size: 15px;
}

.topstrip__coins {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.topstrip__rate {
  font-size: 13px;
  font-weight: 620;
  color: var(--accent-deep);
  white-space: nowrap;
}

.topstrip__stat {
  font-size: 13px;
  color: var(--ink-soft);
  white-space: nowrap;
}

.topstrip__next {
  font-size: 12.5px;
  color: var(--ink-soft);
  white-space: nowrap;
}

.topstrip__info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--line);
  color: var(--ink-soft);
  font-size: 11px;
  font-style: italic;
  cursor: help;
  flex: none;
}

.topstrip__info:hover,
.topstrip__info:focus-visible {
  color: var(--ink);
  border-color: var(--accent);
  outline: none;
}

.topstrip--strained .topstrip__stat:nth-of-type(1) {
  color: var(--strained);
}

.topstrip--rotting .topstrip__stat:nth-of-type(1) {
  color: var(--rotting);
}
```

(The `topstrip--strained`/`--rotting` band-color rules only tint the happiness figure, matching how the old happiness badge changed color by band — `thriving`/`content` stay the default ink color, only the two worse bands call it out.)

- [ ] **Step 8: Typecheck**

Run: `npm run build`
Expected: fails — `main.ts` still calls `createHud(uiRoot, {...})` and does nothing with the five new fields, so nothing places `topStripElement`/`paletteElement`/`hoverPanelElement`/`queueElement`/`restartElement` anywhere yet. This is expected (fixed in Task 3, not this task) — confirm the only errors are about these fields being unused/main.ts not consuming them, not a type error inside `hud.ts` itself. If `hud.ts` itself has a type error, that's this task's to fix.

- [ ] **Step 9: Commit**

```bash
git add src/ui/hud.ts src/ui/api.ts src/ui/style.css
git commit -m "refactor(ui): compact top strip, unbundle palette/queue from hud.ts

Replaces the tall multi-block readouts card with a single always-
visible row (coins, income rate, happiness, population, next build).
The build palette, hover-info panel, build queue, and restart button
stop sharing the now-deleted .hud/.hud__zone wrapper divs and become
independently returned elements — same pattern Tools/Prestige/music-
sound already use.

main.ts doesn't place any of the five new elements yet (Task 3), so
none of this renders anywhere in the running app until then — expected,
not a regression to chase in this commit."
```

---

### Task 2: Redesign the shell for left/right sides

**Files:**
- Modify: `src/ui/shell.ts`
- Modify: `src/ui/shell.css`

**Interfaces:**
- Produces: `HudSection` gains `side: 'left' | 'right'`. `createShell`'s behaviour changes: one dock per side that has at least one section, not always exactly one dock.

- [ ] **Step 1: Add `side` to `HudSection` and render two docks**

In `src/ui/shell.ts`, change:

```ts
export interface HudSection {
  id: string
  label: string
  /** One or more panels rendered together under this section's heading. */
  panels: HTMLElement[]
}
```

to:

```ts
export interface HudSection {
  id: string
  label: string
  /** Which side of the screen this section's column docks to. */
  side: 'left' | 'right'
  /** One or more panels rendered together under this section's heading. */
  panels: HTMLElement[]
}
```

Change `createShell`'s body from:

```ts
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
```

to:

```ts
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
```

- [ ] **Step 2: Update the header docblock**

`shell.ts`'s file header currently says "Desktop-only for now: sections dock side by side, always visible." — that's still true, just now true independently per side. No change needed there. But the docblock's earlier note (added by Phase 2's fix wave) about the anchor "growing leftward" and needing "a real redesign... before Ville (third column) arrives" is exactly what this task IS that redesign — replace that paragraph with a short note that the shell now docks left and right independently, so adding a section to one side no longer affects the other side's position at all.

- [ ] **Step 3: Split the CSS into independent left/right docks**

In `src/ui/shell.css`, replace `.shell-dock` (currently anchored `right: calc(var(--hud-side) + 30px); bottom: 18px;`) with two rules:

```css
.shell-dock {
  position: fixed;
  bottom: 18px;
  z-index: 5;
  display: flex;
  align-items: flex-end;
  gap: 16px;
  pointer-events: none;
}

.shell-dock--left {
  left: 18px;
}

.shell-dock--right {
  right: 18px;
}
```

(Dropping the `--hud-side`-derived offset entirely — that offset existed only to clear the old `.hud__zone--tl`/`--tr` grid columns, which Task 1 deletes. Both docks now anchor straight to the screen edge, 18px in, matching every other panel's corner margin in this codebase.)

Leave `.shell-dock__column`, `.shell-dock__column > *`, and `.shell-dock__label` exactly as they are — unchanged by this task.

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: fails — every existing `createShell(...)` call site in `main.ts` passes `HudSection` objects without a `side` field, which is now required. Confirm the errors are all in `main.ts` (fixed in Task 3), not inside `shell.ts` itself.

- [ ] **Step 5: Commit**

```bash
git add src/ui/shell.ts src/ui/shell.css
git commit -m "refactor(ui): dock left and right independently

HudSection gains a required side: 'left' | 'right'. createShell now
renders one dock per side that actually has sections, each anchored
straight to its own screen edge — adding a section to one side no
longer moves the other side's dock, closing the gap the Phase 2 final
review flagged (a single right-anchored dock can't express a left
section, and grows unboundedly as columns join).

main.ts's existing createShell call doesn't pass `side` yet (Task 3),
so this intentionally doesn't build end-to-end until then."
```

---

### Task 3: Wire the Ville section and top strip into `main.ts`

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `Hud`'s five new element fields (Task 1). `HudSection.side` (Task 2).

- [ ] **Step 1: Mount the top strip directly**

In `src/main.ts`, find where `hud` is created (`const hud: Hud = createHud(uiRoot, {...})`). Immediately after that call (before anything else touches `hud`), add:

```ts
uiRoot.append(hud.topStripElement)
```

- [ ] **Step 2: Add `side` to the existing sections, and add the new `ville` section**

Find the `createShell(...)` call (built up across Phases 1-2; currently):

```ts
createShell(uiRoot, [
  { id: 'menu', label: 'Menu', panels: [musicSound.element, tools.element, prestigePanel.element] },
  { id: 'social', label: 'Social', panels: [leaderboardUI.launcher, friendsUI.launcher] },
])
```

Change to:

```ts
createShell(uiRoot, [
  {
    id: 'ville',
    label: 'Ville',
    side: 'left',
    panels: [hud.paletteElement, hud.hoverPanelElement, hud.queueElement, hud.restartElement],
  },
  {
    id: 'menu',
    label: 'Menu',
    side: 'right',
    panels: [musicSound.element, tools.element, prestigePanel.element],
  },
  {
    id: 'social',
    label: 'Social',
    side: 'right',
    panels: [leaderboardUI.launcher, friendsUI.launcher],
  },
])
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: passes cleanly.

- [ ] **Step 4: Run the test suite**

Run: `npm test`
Expected: all 168 tests pass (unrelated to this change).

- [ ] **Step 5: Visual check — the whole HUD, all three sections**

Load the game. Confirm, in order:
- A compact top strip sits top-left: coins, income rate, happiness (color-shifting by band), population, a "▶ [next building]" badge once something is queued, and a small "i" info badge whose hover/focus tooltip explains the income-multiplier formula. It updates live as the city runs — watch it for a few seconds.
- A "Ville" column now sits at the bottom-left with the build palette, the hover-info panel (hover a tile to confirm it still shows building info), the build queue, and the restart button — all fully functional, all copy and behavior unchanged from before this phase.
- "Menu" and "Social" still sit at the bottom-right, unaffected — re-verify Phase 1's height-budget fix (open Tools + Prestige together, confirm music/sound stays reachable) and Phase 2's toast-z-index fix (trigger a toast, confirm it's not hidden behind anything) both still hold with a third section now present.
- Resize the window across a range of realistic desktop widths (1600, 1440, 1280). Note (but do not fix) any collision between the new left dock and the right docks, or between either dock and the game board itself, and report exactly what you see — this determines whether Phase 2's already-tracked narrow-viewport collision got better, worse, or stayed the same now that a left dock exists too.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat(ui): dock the build palette and queue into a new Ville section

Completes Phase 3: the compact top strip is always visible, and Ville
(palette, hover info, queue, restart) docks left while Menu and Social
dock right — three independent sections, no shared coordinate system
between them. The old .hud grid this all used to live inside is gone.

The mobile bottom tab bar is the last phase."
```

---

## What comes after this plan

The mobile bottom tab bar: below the existing ~900px breakpoint, `createShell` needs to collapse each side's dock into a tab bar with one section's content visible at a time (a full-height sheet), rather than always-visible columns — the `HudSection`/`side` model this phase built is the input to that; the breakpoint logic and sheet/tab-bar rendering are new. A final CSS/comment sweep across every module this whole redesign touched is the very last step after that.
