# HUD Shell Phase 1: Menu Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Tools', Prestige's, and the music/sound controls' independent `position: fixed` placement with one shared shell module, proving the content-provider pattern before the Social and Ville sections migrate onto it in follow-up plans.

**Architecture:** A new `ui/shell.ts` renders a `HudSection[]` — each section a label plus a list of already-built `HTMLElement` panels — docked in one place. Tools and Prestige stop appending themselves to `root` and instead return their root element for the shell to place. Music/sound controls, currently built inline inside `hud.ts`, become their own module (`ui/musicsound.ts`) for the same reason. `main.ts` wires the three into one `menu` section.

**Tech Stack:** TypeScript, Vite, vanilla DOM (no framework) — matches every other `ui/*.ts` module in this codebase.

**Spec:** `docs/superpowers/specs/2026-09-09-hud-shell-redesign-design.md`

## Global Constraints

- No unit tests exist for `ui/*.ts` in this project (network-backed panels are verified live instead); this plan keeps that convention — verification is `npm run build`, `npm test` (the sim suite must stay green — it's unrelated but must not regress), and a live visual check via the `run`/browser workflow already used in this project.
- Every panel's internal behaviour, copy, and event wiring stays exactly as it is today. Only *placement* changes.
- This is Phase 1 of the spec's suggested migration order (Menu first — "lowest traffic, safest to get wrong first"). The mobile tab bar, the Social section, and the Ville section are explicitly out of scope here and get their own follow-up plans once this lands.
- Desktop-only shell for this phase — narrow viewports keep today's shrink-only behaviour (the existing 900px media query) until the mobile tab bar phase.

---

## File Structure

- **Create** `src/ui/shell.ts` — `HudSection` type, `createShell(root, sections)`.
- **Create** `src/ui/shell.css` — the dock's own layout rules.
- **Create** `src/ui/musicsound.ts` — music/sound controls, extracted from `hud.ts`.
- **Create** `src/ui/musicsound.css` — extracted from `style.css`.
- **Modify** `src/ui/hud.ts` — remove the music/sound block and `setMusicState`/`setSfxState`.
- **Modify** `src/ui/api.ts` — trim `Hud` and `HudCallbacks`.
- **Modify** `src/ui/style.css` — remove the music/sound rules (moved out).
- **Modify** `src/ui/tools.ts` — `createToolsPanel` stops taking `root`, returns its element instead of appending it.
- **Modify** `src/ui/tools.css` — `.tools-root` stops being independently fixed-positioned.
- **Modify** `src/ui/prestige.ts` — same treatment as `tools.ts`.
- **Modify** `src/ui/prestige.css` — same treatment as `tools.css`.
- **Modify** `src/main.ts` — wire `shell.ts` + `musicsound.ts`, update the `tools`/`prestige` call sites, drop the four music/sound callbacks from `createHud`.

---

### Task 1: `ui/musicsound.ts` — extract music/sound controls from `hud.ts`

**Files:**
- Create: `src/ui/musicsound.ts`
- Create: `src/ui/musicsound.css`
- Modify: `src/ui/hud.ts:1-25` (imports), `:293-343` (music/sound panel construction), `:345-388` (state-painting functions), `:416` (`hud.append`), `:674` (return statement)
- Modify: `src/ui/api.ts:14-27` (`HudCallbacks`), `:29-38` (`Hud`)

**Interfaces:**
- Produces: `createMusicSoundControls(callbacks: MusicSoundCallbacks): MusicSoundControls`, where
  ```ts
  export interface MusicSoundCallbacks {
    onToggleMusic(): void
    onMusicVolume(volume: number): void
    onToggleSfx(): void
    onSfxVolume(volume: number): void
  }

  export interface MusicSoundControls {
    /** The whole music+sound block, ready to be placed by a caller. */
    element: HTMLElement
    setMusicState(state: MusicState): void
    setSfxState(state: SfxState): void
  }
  ```

- [ ] **Step 1: Create `src/ui/musicsound.ts`**

```ts
/**
 * Music and sound-effect controls: two identical toggle+volume panels for
 * two independent decisions (hear the score, hear the city). Split out of
 * hud.ts so it can be placed by the new shell (ui/shell.ts) instead of
 * hud.ts's own hud__zone--tr.
 */

import './musicsound.css'

import type { MusicState } from '../audio/music'
import type { SfxState } from '../audio/sfx'

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

function setText(node: HTMLElement, value: string): void {
  if (node.textContent !== value) node.textContent = value
}

function setClass(node: HTMLElement, value: string): void {
  if (node.className !== value) node.className = value
}

export interface MusicSoundCallbacks {
  onToggleMusic(): void
  onMusicVolume(volume: number): void
  onToggleSfx(): void
  onSfxVolume(volume: number): void
}

export interface MusicSoundControls {
  /** The whole music+sound block, ready to be placed by a caller. */
  element: HTMLElement
  setMusicState(state: MusicState): void
  setSfxState(state: SfxState): void
}

export function createMusicSoundControls(callbacks: MusicSoundCallbacks): MusicSoundControls {
  const wrap = el('div', 'musicsound-root')

  // ------------------------------------------------------------------- music

  const musicPanel = el('section', 'panel panel--music')
  const musicRow = el('div', 'music__row')
  const musicButton = el('button', 'music__toggle')
  musicButton.type = 'button'
  musicButton.addEventListener('click', () => callbacks.onToggleMusic())
  const musicTitle = el('span', 'music__title')
  musicRow.append(musicButton, musicTitle)

  const musicVolume = document.createElement('input')
  musicVolume.type = 'range'
  musicVolume.className = 'music__volume'
  musicVolume.min = '0'
  musicVolume.max = '100'
  musicVolume.step = '1'
  musicVolume.setAttribute('aria-label', 'Music volume')
  musicVolume.addEventListener('input', () => {
    callbacks.onMusicVolume(Number(musicVolume.value) / 100)
  })

  musicPanel.append(musicRow, musicVolume)
  wrap.append(musicPanel)

  // ------------------------------------------------------------------- sound

  const soundPanel = el('section', 'panel panel--sound')
  const soundRow = el('div', 'sound__row')
  const soundButton = el('button', 'sound__toggle')
  soundButton.type = 'button'
  soundButton.addEventListener('click', () => callbacks.onToggleSfx())
  const soundTitle = el('span', 'sound__title', 'Sound effects')
  soundRow.append(soundButton, soundTitle)

  const soundVolume = document.createElement('input')
  soundVolume.type = 'range'
  soundVolume.className = 'sound__volume'
  soundVolume.min = '0'
  soundVolume.max = '100'
  soundVolume.step = '1'
  soundVolume.setAttribute('aria-label', 'Sound effects volume')
  soundVolume.addEventListener('input', () => {
    callbacks.onSfxVolume(Number(soundVolume.value) / 100)
  })

  soundPanel.append(soundRow, soundVolume)
  wrap.append(soundPanel)

  // ------------------------------------------------------------------- state

  let musicSignature = ''
  let sfxSignature = ''

  function setMusicState(music: MusicState): void {
    // The waiting state is the normal state on load, not a failure: browsers
    // block audio until the page has been interacted with.
    const label = !music.enabled
      ? 'Music off'
      : music.waitingForGesture
        ? 'Click anywhere to start the music'
        : (music.nowPlaying ?? 'Music on')
    const signature = `${music.enabled}|${label}|${music.volume}`
    if (signature === musicSignature) return
    musicSignature = signature

    setText(musicButton, music.enabled ? 'Music on' : 'Music off')
    musicButton.className = music.enabled ? 'music__toggle is-on' : 'music__toggle'
    musicButton.setAttribute('aria-pressed', String(music.enabled))
    setText(musicTitle, music.enabled ? label : '')
    musicPanel.classList.toggle('is-muted', !music.enabled)
    if (document.activeElement !== musicVolume) {
      musicVolume.value = String(Math.round(music.volume * 100))
    }
  }

  function setSfxState(sfx: SfxState): void {
    const label = !sfx.enabled
      ? 'Sound off'
      : sfx.waitingForGesture
        ? 'Click anywhere to start'
        : 'Sound on'
    const signature = `${sfx.enabled}|${label}|${sfx.volume}`
    if (signature === sfxSignature) return
    sfxSignature = signature

    setText(soundButton, sfx.enabled ? 'Sound on' : 'Sound off')
    soundButton.className = sfx.enabled ? 'sound__toggle is-on' : 'sound__toggle'
    soundButton.setAttribute('aria-pressed', String(sfx.enabled))
    setText(soundTitle, sfx.enabled ? label : 'Sound effects')
    soundPanel.classList.toggle('is-muted', !sfx.enabled)
    if (document.activeElement !== soundVolume) {
      soundVolume.value = String(Math.round(sfx.volume * 100))
    }
  }

  return { element: wrap, setMusicState, setSfxState }
}
```

- [ ] **Step 2: Create `src/ui/musicsound.css`**

Move the CSS verbatim from `src/ui/style.css` — the block runs from `.panel--music {` through the last `.sound__volume::-moz-range-thumb { ... }` rule (currently lines 748–909, immediately before the `/* -------------------------------------------------------------- leaderboard */` comment). Cut that whole block out of `style.css` and paste it as the entire content of `musicsound.css`, with this header prepended:

```css
/*
 * Music and sound-effect panels. Layout position comes from wherever
 * musicsound.ts's `element` is placed by its caller — nothing here is
 * position: fixed.
 */

```

- [ ] **Step 3: Remove music/sound from `hud.ts`**

Delete these three blocks from `src/ui/hud.ts`:

1. The whole `// ------------------------------------------------------------------- music` section through the end of `// ------------------------------------------------------------------- sound` (current lines 293–343 — from `const musicPanel = ...` through `rightSide.append(soundPanel)`).
2. `let musicSignature = ''` / `let sfxSignature = ''` and the `setMusicState` / `setSfxState` functions (current lines 345–388).
3. Remove `MusicState` and `SfxState` from the `import type` line at the top (`src/ui/hud.ts:10-11`) since nothing in this file uses them anymore.

Update the return statement (currently line 674):

```ts
return { update, setTool, setHoverInfo, showOfflineEarnings, toast }
```

- [ ] **Step 4: Trim `src/ui/api.ts`**

Remove `onToggleMusic`, `onMusicVolume`, `onToggleSfx`, `onSfxVolume` from `HudCallbacks`, and remove `setMusicState`/`setSfxState` from `Hud`. Also remove the now-unused `MusicState`/`SfxState` imports at the top of the file if nothing else in `api.ts` uses them (check before deleting — `grep -n "MusicState\|SfxState" src/ui/api.ts` after the edit should show nothing).

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: fails, listing every call site still passing the four removed callbacks or calling `hud.setMusicState`/`hud.setSfxState` — that's `main.ts`, fixed in Task 2 (Step 3, next commit). Confirm the *only* errors are in `main.ts`; anything else means a step above missed a reference.

- [ ] **Step 6: Commit**

```bash
git add src/ui/musicsound.ts src/ui/musicsound.css src/ui/hud.ts src/ui/api.ts src/ui/style.css
git commit -m "refactor(ui): extract music/sound controls into their own module

Pulled out of hud.ts so the new shell (next commit) can place it
instead of hud.ts's own hud__zone--tr. main.ts still needs updating
to match — that lands with the shell in the next commit, so the build
is expected to fail on main.ts alone until then."
```

---

### Task 2: `ui/shell.ts` and wiring it into `main.ts`

**Files:**
- Create: `src/ui/shell.ts`
- Create: `src/ui/shell.css`
- Modify: `src/main.ts:1-30` (imports), `:85-120` (`createHud` call), `:122-123` (subscribe wiring)

**Interfaces:**
- Consumes: `createMusicSoundControls` from Task 1 (`src/ui/musicsound.ts`), returning `{ element, setMusicState, setSfxState }`.
- Produces: `createShell(root: HTMLElement, sections: HudSection[]): HudShell`, where
  ```ts
  export interface HudSection {
    id: string
    label: string
    /** One or more panels rendered together under this section's heading. */
    panels: HTMLElement[]
  }

  export interface HudShell {
    dispose(): void
  }
  ```
  Later tasks (Tools, Prestige) produce the panels this task's `main.ts` wiring collects into the `menu` section's `panels` array.

- [ ] **Step 1: Create `src/ui/shell.ts`**

```ts
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
```

- [ ] **Step 2: Create `src/ui/shell.css`**

```css
/*
 * The dock: every section's panels, side by side. Provisionally anchored
 * where tools.ts's own launcher used to sit (right: hud-side+30, bottom:18)
 * — proven clear of the leaderboard/friends launchers, which are not on the
 * shell yet. Revisited once the Social and Ville sections join (see the
 * design doc's migration order) and this needs to account for all of them
 * at once instead of reusing one panel's old safe spot.
 */

.shell-dock {
  position: fixed;
  right: calc(var(--hud-side) + 30px);
  bottom: 18px;
  z-index: 5;
  display: flex;
  align-items: flex-end;
  gap: 16px;
  /* The dock itself must never catch a pointer event — only what's inside
     a section's own panels should, same rule tools.ts and prestige.ts
     already followed for their own wrappers. */
  pointer-events: none;
}

.shell-dock__column {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
  pointer-events: none;
}

.shell-dock__column > * {
  pointer-events: auto;
}

.shell-dock__label {
  /* One section this phase, so a visible heading would just repeat
     "Menu" above menu-shaped controls. Kept in the DOM, not the layout,
     so the mobile tab bar phase can give it a job (the tab's own text)
     without another markup change. */
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
```

- [ ] **Step 3: Wire the shell and music/sound into `main.ts`**

Add to the import block near the top of `src/main.ts` (alongside the other `./ui/*` imports):

```ts
import { createShell } from './ui/shell'
import { createMusicSoundControls } from './ui/musicsound'
```

Replace the `createHud` call (currently `src/main.ts:85-120`) — remove the four music/sound callback fields, leaving everything else as it is:

```ts
const hud: Hud = createHud(uiRoot, {
  onSelectTool: setTool,
  onQueue: (type) => {
    enqueue(state, type)
  },
  onClearQueue: () => {
    clearQueue(state)
  },
  onRestart: () => {
    forgetDemolitions()
    restarting = true
    clearSave()
    window.location.reload()
  },
  onToastShown: () => {
    sfx.playToast()
  },
})
```

(Keep the existing comments in that block — only the four `onToggleMusic`/`onMusicVolume`/`onToggleSfx`/`onSfxVolume` fields are deleted.)

Replace the subscribe wiring (currently `src/main.ts:122-123`):

```ts
const musicSound = createMusicSoundControls({
  onToggleMusic: () => {
    music.setEnabled(!music.getState().enabled)
  },
  onMusicVolume: (level) => {
    music.setVolume(level)
  },
  onToggleSfx: () => {
    sfx.setEnabled(!sfx.getState().enabled)
  },
  onSfxVolume: (level) => {
    sfx.setVolume(level)
  },
})
music.subscribe((musicState) => musicSound.setMusicState(musicState))
sfx.subscribe((sfxState) => musicSound.setSfxState(sfxState))

createShell(uiRoot, [{ id: 'menu', label: 'Menu', panels: [musicSound.element] }])
```

(Tasks 3 and 4 extend this same `createShell` call's `panels` array with Tools' and Prestige's elements — this step's array has only `musicSound.element` because those don't exist yet.)

- [ ] **Step 4: Typecheck and build**

Run: `npm run build`
Expected: passes cleanly now (Task 1 left `main.ts` as the only error source; this step fixes it).

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: all `sim/` tests still pass — this change touches no sim code, so a failure here means something outside this plan's scope broke; investigate before continuing.

- [ ] **Step 6: Visual check**

Use this project's `run` workflow (or `npm run dev` + a browser) to load the game. Confirm:
- The music and sound panels appear stacked in the bottom-right area (where Tools used to sit alone), both fully functional (toggle, volume slider, track-name display).
- The old bottom-right-of-`hud__zone--tr` gap where they used to be is now empty.
- Nothing else on screen shifted or broke (readouts, palette, build queue, leaderboard/friends launchers, tools/prestige toggles still all in their old spots — those migrate in later tasks).

- [ ] **Step 7: Commit**

```bash
git add src/ui/shell.ts src/ui/shell.css src/main.ts
git commit -m "feat(ui): add the HUD shell, dock music/sound controls onto it

First real use of the content-provider pattern from the redesign spec.
Menu section has one panel so far (music/sound); Tools and Prestige
join it in the next two commits."
```

---

### Task 3: Migrate Tools onto the shell

**Files:**
- Modify: `src/ui/tools.ts:72-80` (`createToolsPanel` signature), `:314-315` (append/root)
- Modify: `src/ui/tools.css:24-40` (`.tools-root`)
- Modify: `src/main.ts` (Tools call site + `createShell` panels array)

**Interfaces:**
- Produces: `ToolsPanel` gains an `element: HTMLElement` field. `createToolsPanel` drops its `root` parameter.

- [ ] **Step 1: Change `createToolsPanel`'s signature and return value**

In `src/ui/tools.ts`, change:

```ts
export interface ToolsPanel {
  /** Called every animation frame. Cheap: bail early when nothing changed. */
  update(state: CityState): void
  dispose(): void
}
```

to:

```ts
export interface ToolsPanel {
  /** The whole tools block (toggle + collapsible panel), for a caller to place. */
  element: HTMLElement
  /** Called every animation frame. Cheap: bail early when nothing changed. */
  update(state: CityState): void
  dispose(): void
}
```

Change the function signature (currently `src/ui/tools.ts:72-76`):

```ts
export function createToolsPanel(getState: () => CityState, callbacks: ToolsCallbacks): ToolsPanel {
```

(Drops the `root: HTMLElement` parameter — everything else in the function body is unchanged.)

Replace the current `wrap.append(toggleButton, panel)` / `root.append(wrap)` (currently `src/ui/tools.ts:314-315`) with just:

```ts
wrap.append(toggleButton, panel)
```

Update the final `return` (currently `src/ui/tools.ts:328`):

```ts
return { element: wrap, update, dispose }
```

- [ ] **Step 2: Stop `.tools-root` positioning itself**

In `src/ui/tools.css`, replace the `.tools-root` rule (currently lines 24–40, everything from `.tools-root {` to its closing `}`) with:

```css
.tools-root {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
  pointer-events: none;
}
```

(Drops `position: fixed`, `right`, `bottom`, `z-index` — the shell's `.shell-dock__column` now supplies positioning. Keeps the flex layout, since `tools-root` still wraps its own toggle+panel internally.)

Also delete the large comment block above `.tools-root` (currently `src/ui/tools.css:14-23`, the one about "Left of the leaderboard launcher... invisible-overlap bug twice") — it describes a fixed-position rationale that no longer applies. Replace it with:

```css
/* Positioned by ui/shell.ts's .shell-dock now, not on its own — see
   shell.ts's header comment. */
```

- [ ] **Step 3: Update `main.ts`'s Tools call site**

Find the `createToolsPanel` call (currently `src/main.ts:157`, `const tools = createToolsPanel(uiRoot, currentCity, { ... })`). Remove the `uiRoot` argument:

```ts
const tools = createToolsPanel(currentCity, {
```

(Everything inside the callbacks object is unchanged.)

Add `tools.element` to the `createShell` panels array from Task 2, Step 3:

```ts
createShell(uiRoot, [{ id: 'menu', label: 'Menu', panels: [musicSound.element, tools.element] }])
```

`createShell` must be called *after* `tools` is created — check the current file order (`createShell` was placed right after `musicSound` is built in Task 2; `tools` is created later, at line 157). Move the `createShell(...)` call down so it comes after both `tools` and `prestigePanel` exist (this task moves it after `tools`; Task 4 moves it again, after `prestigePanel`, and that's its final position for this plan).

- [ ] **Step 4: Typecheck and build**

Run: `npm run build`
Expected: passes.

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: all tests pass (unaffected by this change).

- [ ] **Step 6: Visual check**

Load the game. Confirm:
- The "Tools" toggle button now appears in the same bottom-right stack as music/sound, and clicking it still expands/collapses the Tools panel exactly as before (speed buttons, undo, export/import).
- No leftover empty gap or visual artifact where Tools used to sit alone.

- [ ] **Step 7: Commit**

```bash
git add src/ui/tools.ts src/ui/tools.css src/main.ts
git commit -m "refactor(ui): dock Tools onto the HUD shell

Tools no longer positions itself — createToolsPanel returns its
element instead of appending itself to root, and the shell places it
in the Menu section next to music/sound."
```

---

### Task 4: Migrate Prestige onto the shell

**Files:**
- Modify: `src/ui/prestige.ts:1-35` (header comment), `:64-68` (`PrestigePanel`), `:101-105` (`createPrestigePanel` signature), `:333-334` (append/root)
- Modify: `src/ui/prestige.css` (equivalent of `.tools-root`, likely named `.prestige-root`)
- Modify: `src/main.ts` (Prestige call site + final `createShell` panels array)

**Interfaces:**
- Produces: `PrestigePanel` gains an `element: HTMLElement` field. `createPrestigePanel` drops its `root` parameter.

- [ ] **Step 1: Change `createPrestigePanel`'s signature and return value**

Same shape as Task 3, Step 1. In `src/ui/prestige.ts`:

Add `element: HTMLElement` to the `PrestigePanel` interface (currently lines 64–68).

Change the function signature (currently lines 101–105) from:

```ts
export function createPrestigePanel(
  root: HTMLElement,
  getPrestige: () => PrestigeState,
  callbacks: PrestigeCallbacks,
): PrestigePanel {
```

to:

```ts
export function createPrestigePanel(
  getPrestige: () => PrestigeState,
  callbacks: PrestigeCallbacks,
): PrestigePanel {
```

Replace `wrap.append(toggleButton, panel)` / `root.append(wrap)` (currently lines 333–334) with just `wrap.append(toggleButton, panel)`.

Update the final `return` (currently line 417, `return { update, dispose }`) to:

```ts
return { element: wrap, update, dispose }
```

- [ ] **Step 2: Update the file header comment**

`src/ui/prestige.ts`'s header comment (lines 19–35) describes the same "checked against every other fixed island" layout rationale as `tools.css` did — it documents the *old* system this plan retires. Replace the "Layout:" paragraph (from `* Layout: this project has shipped...` through the end of the comment block) with:

```
 * Positioned by ui/shell.ts's .shell-dock now, alongside Tools and the
 * music/sound controls, instead of picking its own fixed spot — see
 * shell.ts's header comment for why that arrangement was retired.
```

- [ ] **Step 3: Stop `.prestige-root` positioning itself**

Find `.prestige-root` in `src/ui/prestige.css` (equivalent structure to `tools.css`'s `.tools-root` — locate it with `grep -n "prestige-root" src/ui/prestige.css`). Apply the same change as Task 3 Step 2: remove `position: fixed`, `left`/`right`, `bottom`, `z-index`; keep the flex layout properties; replace any "fixed island" rationale comment above it with the one-line pointer to `shell.ts`.

- [ ] **Step 4: Update `main.ts`'s Prestige call site and finalize the shell wiring**

Find the `createPrestigePanel` call (currently `src/main.ts:136`, `const prestigePanel = createPrestigePanel(uiRoot, () => prestige, { ... })`). Remove the `uiRoot` argument:

```ts
const prestigePanel = createPrestigePanel(() => prestige, {
```

Move the `createShell(...)` call (relocated once already in Task 3) to after `prestigePanel` is created, as its final position for this plan:

```ts
createShell(uiRoot, [
  { id: 'menu', label: 'Menu', panels: [musicSound.element, tools.element, prestigePanel.element] },
])
```

- [ ] **Step 5: Typecheck and build**

Run: `npm run build`
Expected: passes.

- [ ] **Step 6: Run the test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Visual check — full Menu section**

Load the game. Confirm, in order:
- Music, sound, Tools, and Prestige toggles all appear stacked in one bottom-right dock.
- Each still works exactly as before: Prestige's toggle shows/hides its panel, its charter badge still appears once there's charter to spend, the retire confirm/arm/timeout behaviour is unchanged, upgrade purchases still work.
- Resize the window across the existing 900px breakpoint — nothing overlaps or clips.
- Leaderboard and Friends launchers (bottom-right corner, not yet migrated) are unaffected and still open their own modals correctly — the new dock must not cover or shift them.

- [ ] **Step 8: Commit**

```bash
git add src/ui/prestige.ts src/ui/prestige.css src/main.ts
git commit -m "refactor(ui): dock Prestige onto the HUD shell

Completes the Menu section: music/sound, Tools, and Prestige all place
themselves through ui/shell.ts now instead of each choosing its own
fixed position. Social and Ville sections are the next two plans."
```

---

## What comes after this plan

Per the spec's migration order: a follow-up plan migrates the Social section (Leaderboard + Friends, which currently open their own modal overlays rather than docking inline — a different shape of change than Tools/Prestige's toggle-in-place), then Ville (build palette, build queue, activity feed — the biggest single-file change, since it means splitting up `hud.ts`), then the mobile bottom tab bar itself, then a final pass to delete every now-dead CSS class this plan didn't already remove.
