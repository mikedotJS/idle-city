# HUD Shell Phase 2: Social Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dock the Leaderboard and Friends launcher buttons into the same shared shell (`ui/shell.ts`) that Phase 1 built for Tools/Prestige/music-sound, retiring their last two independently-`position: fixed` corners.

**Architecture:** Leaderboard and Friends are a different shape than Tools/Prestige: their launcher is a small button+hint widget that opens a full-screen `.overlay` modal, not an inline collapsible panel. This phase docks only the *launcher* widgets as a new `social` `HudSection` — the full-screen overlay behavior is untouched, stays exactly as it is, and keeps being appended straight to `root` (same as the pre-existing "Welcome back" offline overlay already does, independent of any dock). Only the launcher's own fixed positioning goes away.

**Tech Stack:** TypeScript, Vite, vanilla DOM (no framework) — matches every other `ui/*.ts` module in this codebase.

**Spec:** `docs/superpowers/specs/2026-09-09-hud-shell-redesign-design.md`

## Global Constraints

- No unit tests exist for `ui/*.ts` in this project; this plan keeps that convention — verification is `npm run build`, `npm test`, and a live visual/browser check.
- Every panel's internal behaviour, copy, and event wiring stays exactly as it is today. Only *placement* changes — this explicitly includes Leaderboard/Friends' sign-in flow, modal open/close, Escape-to-close, and click-outside-to-close, none of which change in this phase.
- This is Phase 2 of the redesign (Social section). The Ville section and the mobile tab bar are separate, later phases.
- Desktop-only shell still — no mobile tab bar logic here.
- `ui/shell.ts`'s `createShell(root, sections)` already supports multiple `HudSection`s in one call (Phase 1 built it that way even though only one section existed then). This phase is the first to actually pass two.

---

## File Structure

- **Modify** `src/ui/leaderboard.ts` — `createLeaderboardUI` stops appending its `launcher` to `root` itself; returns it instead. The `overlay` keeps being appended to `root` directly, unchanged.
- **Modify** `src/ui/friends.ts` — same treatment as `leaderboard.ts`.
- **Modify** `src/ui/style.css` — `.panel--board-launch` and `.panel--friends-launch` stop being independently `position: fixed`.
- **Modify** `src/main.ts` — extend the existing `createShell(...)` call with a second `social` section.

---

### Task 1: Dock the Leaderboard launcher

**Files:**
- Modify: `src/ui/leaderboard.ts` (the `LeaderboardUI` interface, `createLeaderboardUI`'s `root.append(launcher, overlay)` line, and its final `return`)
- Modify: `src/ui/style.css` (`.panel--board-launch`)

**Interfaces:**
- Produces: `LeaderboardUI` gains a `launcher: HTMLElement` field.

- [ ] **Step 1: Change the `LeaderboardUI` interface**

In `src/ui/leaderboard.ts`, find:

```ts
export interface LeaderboardUI {
  dispose(): void
}
```

Change to:

```ts
export interface LeaderboardUI {
  /** The launcher button + hint, ready to be placed by a caller. The modal overlay it opens is unaffected — it's appended straight to root and stays fixed, full-screen, independent of any dock. */
  launcher: HTMLElement
  dispose(): void
}
```

- [ ] **Step 2: Stop appending the launcher to `root`, return it instead**

Find `root.append(launcher, overlay)` and change it to `root.append(overlay)` (the launcher is no longer appended here — the caller places it).

Find the final `return` statement:

```ts
  return {
    dispose(): void {
      window.removeEventListener('keydown', onKey, true)
      launcher.remove()
      overlay.remove()
    },
  }
```

Change to:

```ts
  return {
    launcher,
    dispose(): void {
      window.removeEventListener('keydown', onKey, true)
      launcher.remove()
      overlay.remove()
    },
  }
```

Also update the early-return for the not-configured case:

```ts
  if (!board.configured) {
    return { dispose: () => {} }
  }
```

to:

```ts
  if (!board.configured) {
    return { launcher: el('span'), dispose: () => {} }
  }
```

(An empty, never-appended placeholder element — nothing renders it since `main.ts`'s shell wiring only happens when there's a real launcher to show; see Task 3. `el` is already imported/defined in this file.)

- [ ] **Step 3: Stop `.panel--board-launch` positioning itself**

In `src/ui/style.css`, find `.panel--board-launch` (currently):

```css
.panel--board-launch {
  position: fixed;
  right: 18px;
  bottom: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  pointer-events: auto;
  max-width: 230px;
}
```

Remove `position: fixed;`, `right: 18px;`, and `bottom: 18px;` — keep everything else (`display`, `flex-direction`, `gap`, `padding`, `pointer-events`, `max-width`).

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: fails — `main.ts` still calls `createLeaderboardUI(uiRoot, leaderboard, currentCity)` expecting it to place itself, and doesn't yet collect `.launcher` anywhere. Confirm the only errors are about the leaderboard launcher not being placed (visually, once you check — TypeScript itself may not error here since `.launcher` being unused isn't a type error; if `npm run build` passes cleanly, that's fine too, it just means the leftover unplaced launcher is a runtime/visual issue fixed in Task 3, not a type error).

- [ ] **Step 5: Commit**

```bash
git add src/ui/leaderboard.ts src/ui/style.css
git commit -m "refactor(ui): stop the Leaderboard launcher positioning itself

createLeaderboardUI returns its launcher element instead of appending
it to root. The full-screen sign-in/board overlay it opens is
untouched — still appended straight to root, still fixed full-screen,
independent of any dock. main.ts doesn't collect the launcher yet
(Task 3), so it won't render anywhere until then — expected, not a
regression to chase in this commit."
```

---

### Task 2: Dock the Friends launcher

**Files:**
- Modify: `src/ui/friends.ts` (the `FriendsUI` interface, `createFriendsUI`'s `root.append(launcher, overlay)` line, and its final `return`)
- Modify: `src/ui/style.css` (`.panel--friends-launch`)

**Interfaces:**
- Produces: `FriendsUI` gains a `launcher: HTMLElement` field. Same shape as Task 1's `LeaderboardUI.launcher`.

- [ ] **Step 1: Change the `FriendsUI` interface**

Mirror Task 1 Step 1 exactly, in `src/ui/friends.ts`: add `launcher: HTMLElement` to the `FriendsUI` interface, with an equivalent doc comment.

- [ ] **Step 2: Stop appending the launcher to `root`, return it instead**

Mirror Task 1 Step 2 exactly: `root.append(launcher, overlay)` → `root.append(overlay)`; add `launcher` to the final `return`; update the not-configured early return to `{ launcher: el('span'), dispose: () => {} }`.

- [ ] **Step 3: Stop `.panel--friends-launch` positioning itself**

In `src/ui/style.css`, find `.panel--friends-launch` (currently):

```css
.panel--friends-launch {
  position: fixed;
  right: 18px;
  bottom: 92px;
  display: flex;
  padding: 10px 12px;
  pointer-events: auto;
}
```

Remove `position: fixed;`, `right: 18px;`, and `bottom: 92px;` — keep `display`, `padding`, `pointer-events`.

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: same situation as Task 1 Step 4 — the launcher isn't collected by `main.ts` yet (Task 3).

- [ ] **Step 5: Commit**

```bash
git add src/ui/friends.ts src/ui/style.css
git commit -m "refactor(ui): stop the Friends launcher positioning itself

Same treatment as the Leaderboard launcher in the previous commit.
createFriendsUI returns its launcher element instead of appending it
to root; the add-friend overlay it opens is untouched."
```

---

### Task 3: Wire the Social section into the shell

**Files:**
- Modify: `src/main.ts` (the `createLeaderboardUI`/`createFriendsUI` call sites, and the `createShell(...)` call)

**Interfaces:**
- Consumes: `LeaderboardUI.launcher` and `FriendsUI.launcher` from Tasks 1-2. `createShell(root: HTMLElement, sections: HudSection[])` from Phase 1 (`src/ui/shell.ts`, unchanged in this phase) — already accepts multiple sections.

- [ ] **Step 1: Collect both launchers and extend the shell call**

In `src/main.ts`, find:

```ts
createLeaderboardUI(uiRoot, leaderboard, currentCity)
createFriendsUI(uiRoot, friends, (confirmedCount) => {
  friendCount = confirmedCount
})
```

Change to:

```ts
const leaderboardUI = createLeaderboardUI(uiRoot, leaderboard, currentCity)
const friendsUI = createFriendsUI(uiRoot, friends, (confirmedCount) => {
  friendCount = confirmedCount
})
```

Find the `createShell(...)` call (built up across Phase 1's Tasks 2-4; currently a single `menu` section):

```ts
createShell(uiRoot, [
  { id: 'menu', label: 'Menu', panels: [musicSound.element, tools.element, prestigePanel.element] },
])
```

Change to:

```ts
createShell(uiRoot, [
  { id: 'menu', label: 'Menu', panels: [musicSound.element, tools.element, prestigePanel.element] },
  { id: 'social', label: 'Social', panels: [leaderboardUI.launcher, friendsUI.launcher] },
])
```

Leaderboard before Friends in that array — same order the two launchers already appear in today (Leaderboard was built first, sits closest to the screen's bottom-right corner; Friends sits just above it).

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: passes cleanly.

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: all 168 tests pass (unrelated to this change).

- [ ] **Step 4: Visual check**

Load the game (this project's `run` workflow / dev server). Confirm:
- A "Social" column now sits in the same dock as "Menu", with the Leaderboard and Friends launcher buttons in it, each still opening their own full-screen overlay exactly as before (sign-in form, board list, add-friend flow — nothing about their behavior changed).
- Both columns' combined width doesn't visually collide with the left-hand readouts/palette column at a typical desktop width (~1280-1440px wide). If it does at some width, note the width and report it as a concern rather than trying to fix it — narrow-viewport layout is explicitly out of scope until the mobile tab bar phase.
- Re-verify Phase 1's fix still holds with a second column present: open every collapsible panel in the Menu section (Tools, Prestige) at once, and confirm the Social column's launchers stay visible and clickable — the two columns are independent (`.shell-dock__column` each cap their own height), so this should be unaffected, but confirm rather than assume.
- Nothing else on screen shifted (build queue, palette, readouts, activity feed — none of those are part of this phase).

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(ui): dock Leaderboard and Friends into a new Social section

Completes Phase 2: the shell now has two sections side by side (Menu,
Social). Leaderboard and Friends keep their full-screen overlay
behavior exactly as it was — only their launcher buttons moved out of
their own independently-fixed corners and into the shared dock.

The Ville section (readouts, build palette, build queue, activity
feed) and the mobile tab bar are the next two phases."
```

---

## What comes after this plan

Per the spec's migration order: Ville (the biggest single change — splitting `hud.ts`'s readouts/palette/queue and `activity.ts` into their own shell-mounted content, plus building the always-visible top strip), then the mobile bottom tab bar itself, then a final CSS/comment cleanup pass across everything this whole redesign touched.
