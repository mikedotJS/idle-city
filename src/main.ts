import { createMusic } from './audio/music'
import { createSfx } from './audio/sfx'
import { createBasedClient } from './net/based'
import { createLeaderboard } from './net/leaderboard'
import { createLeaderboardUI } from './ui/leaderboard'
import { createFriends } from './net/friends'
import { createFriendsUI } from './ui/friends'
import { createRenderer } from './render/scene'
import type { PickTarget, Renderer, Tool } from './render/api'
import { createHud } from './ui/hud'
import { createActivityPanel } from './ui/activity'
import { createToolsPanel } from './ui/tools'
import { createPrestigePanel } from './ui/prestige'
import type { HoverInfo, Hud } from './ui/api'
import {
  buyParcel,
  clearQueue,
  createCity,
  demolish,
  enqueue,
  landCost,
  placeManual,
} from './sim/actions'
import { step } from './sim/tick'
import { derive } from './sim/economy'
import { clearSave, load, loadPrestige, save, savePrestige } from './sim/save'
import { retire } from './sim/prestige'
import { forgetDemolitions } from './sim/history'
import { BUILDINGS, buildingCost } from './sim/buildings'
import { AUTOSAVE_INTERVAL, OFFLINE_CAP_SECONDS, PARCEL_SIZE, SIM_DT } from './sim/config'
import { buildableTilesInParcel, terrainFor } from './sim/terrain'
import type { CityState, Derived } from './sim/types'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const uiRoot = document.getElementById('ui') as HTMLElement

/**
 * Read before the city, because founding one consults it: prestige is applied
 * at founding and nowhere else. It lives under its own storage key and
 * survives everything that destroys a city.
 */
const prestige = loadPrestige()

const loaded = load()
/**
 * Mutable, because importing a city replaces it wholesale rather than editing
 * it in place. Everything that outlives a frame reads it through currentCity()
 * for that reason; a stored reference goes stale the moment an import lands.
 */
let state: CityState = loaded ? loaded.state : createCity(undefined, prestige)
let derived: Derived = derive(state)

function currentCity(): CityState {
  return state
}

let tool: Tool = { kind: 'none' }
let hovered: PickTarget | null = null
let structureDirty = true

const music = createMusic()
const sfx = createSfx()

// The board is optional infrastructure. With no backend configured the client
// reports itself unconfigured and the UI never enters the DOM, so the static
// build keeps working exactly as it did before any of this existed.
//
// One client, two features: friends and the leaderboard share the same
// signed-in session rather than each asking to sign in separately.
const basedClient = createBasedClient({
  url: import.meta.env.VITE_BASED_URL,
  anonKey: import.meta.env.VITE_BASED_ANON_KEY,
})
const leaderboard = createLeaderboard(basedClient)
const friends = createFriends(basedClient)

/**
 * Confirmed friend count, pushed here by the friends panel whenever it
 * changes. Read by the tick loop for the income bonus — social state, so it
 * lives beside the sim rather than inside CityState, which is a save file.
 */
let friendCount = 0

const renderer: Renderer = createRenderer(canvas, { onPick, onHover })
const hud: Hud = createHud(uiRoot, {
  onSelectTool: setTool,
  onQueue: (type) => {
    enqueue(state, type)
  },
  onClearQueue: () => {
    clearQueue(state)
  },
  onRestart: () => {
    // Nothing about the old city may outlive it, including what was demolished
    // in it — an undo offered on a city that no longer exists would put a
    // building on a tile of somebody else's map.
    forgetDemolitions()
    // Order matters. The page saves on unload, so clearing and then reloading
    // would write this very city straight back over the blank slate — the same
    // trap that silently defeated the biome harness. Suppress saving first.
    restarting = true
    clearSave()
    window.location.reload()
  },
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
  onToastShown: () => {
    sfx.playToast()
  },
})

music.subscribe((musicState) => hud.setMusicState(musicState))
sfx.subscribe((sfxState) => hud.setSfxState(sfxState))

createLeaderboardUI(uiRoot, leaderboard, currentCity)
createFriendsUI(uiRoot, friends, (confirmedCount) => {
  friendCount = confirmedCount
})

const activity = createActivityPanel(uiRoot, {
  onGoTo: (tile) => {
    renderer.flashTile(tile)
  },
})

const prestigePanel = createPrestigePanel(uiRoot, () => prestige, {
  onRetire: () => {
    // Bank it before anything is destroyed, and persist it before the reload:
    // a charter that only exists in memory when the page navigates away is a
    // city retired for nothing.
    const gained = retire(prestige, state)
    savePrestige(prestige)
    sfx.playPrestige()
    forgetDemolitions()
    // Same order as a restart, for the same reason — the page saves on unload,
    // so clearing and then reloading would write this very city back over the
    // blank slate. Suppress saving first.
    restarting = true
    clearSave()
    hud.toast(`Retired for ${gained} charter.`)
    window.location.reload()
  },
  onPrestigeChanged: () => savePrestige(prestige),
  onToast: (message) => hud.toast(message),
})

const tools = createToolsPanel(uiRoot, currentCity, {
  onSetSpeed: setSpeed,
  onImport: (next) => {
    // The imported city is a different city, so nothing derived from the old
    // one may survive: the undo stack would restore a building onto somebody
    // else's map, and the renderer's instances belong to the old layout.
    state = next
    derived = derive(state, friendCount)
    forgetDemolitions()
    structureDirty = true
    save(state)
  },
  onStructureChanged: () => {
    structureDirty = true
  },
  onToast: (message) => hud.toast(message),
  onPostcard: () => renderer.postcard(),
})

// Browsers block audio until the page has been interacted with, so the first
// real gesture is what actually starts playback. Placing a park counts.
for (const event of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(
    event,
    () => {
      music.unlock()
      sfx.unlock()
    },
    { passive: true },
  )
}

// One delegated listener rather than wiring a click sound into every button
// in every panel (hud.ts, tools.ts, prestige.ts, activity.ts, leaderboard.ts):
// every button in the HUD is a real <button>, so this covers all of them —
// present and future — without any of those files needing to know sound
// design exists.
uiRoot.addEventListener('click', (event) => {
  if ((event.target as HTMLElement).closest('button')) sfx.playClick()
})

function setTool(next: Tool): void {
  tool = next
  renderer.setTool(tool)
  hud.setTool(tool)
  refreshHover()
}

function onPick(target: PickTarget): void {
  if (target.kind === 'parcel') {
    const result = buyParcel(state, target.parcel)
    if (!result.ok) return hud.toast(result.reason)
    structureDirty = true
    return refreshHover()
  }

  if (tool.kind === 'demolish') {
    const result = demolish(state, target.tile)
    if (!result.ok) return hud.toast(result.reason)
    structureDirty = true
    return refreshHover()
  }

  if (tool.kind === 'place') {
    const result = placeManual(state, tool.type, target.tile)
    if (!result.ok) return hud.toast(result.reason)
    // Manual placement never touches state.events (see sim/events.ts — only
    // the auto-builder and dereliction record there), so it is the one thing
    // sound design cannot pick up by watching the log; tell it directly.
    sfx.playPlacement(tool.type, target.tile)
    // The tool stays selected so several can be placed in a row; Escape clears it.
    structureDirty = true
    return refreshHover()
  }
}

function onHover(target: PickTarget | null): void {
  hovered = target
  refreshHover()
}

function refreshHover(): void {
  hud.setHoverInfo(hovered ? describe(hovered) : null)
}

function describe(target: PickTarget): HoverInfo {
  if (target.kind === 'parcel') {
    const cost = landCost(state, target.parcel)
    // Say how much of it is usable before the money is spent, not after. The
    // price already reflects it, and a number that moves for reasons the
    // player cannot see reads as a bug rather than as terrain.
    const usable = buildableTilesInParcel(terrainFor(state), target.parcel)
    const total = PARCEL_SIZE * PARCEL_SIZE
    const lines =
      usable === total
        ? [`${total} tiles, all of them buildable. The city spreads into it as soon as you own it.`]
        : usable === 0
          ? [`${total} tiles and nothing to build on. Worth owning only to reach what is past it.`]
          : [`${total} tiles, ${usable} of them buildable. The rest is water or rock.`]
    // The one refusal worth saying before the click rather than after: a city
    // with no income has no way back if it spends its last coins here.
    if (derived.incomeRate <= 0) {
      lines.push('Your city earns nothing yet. Get a shop paying before you buy land.')
    }
    return {
      title: 'Unclaimed land',
      lines,
      cost: cost ?? undefined,
      affordable: cost !== null && state.coins >= cost,
    }
  }

  const tile = target.tile
  const happiness = derived.field[tile]
  const building = state.grid[tile]
  const lines = [`Happiness ${(happiness * 100).toFixed(0)}%, ${moodOf(happiness)}`]

  if (building) {
    const def = BUILDINGS[building.type]
    lines.push(building.derelict ? 'Derelict. Producing nothing.' : def.blurb)
    return { title: def.label, lines }
  }

  if (tool.kind === 'place') {
    const def = BUILDINGS[tool.type]
    const cost = buildingCost(tool.type, state.builtCount[tool.type])
    lines.push(def.blurb)
    return {
      title: `Place ${def.label.toLowerCase()}`,
      lines,
      cost,
      affordable: state.coins >= cost,
    }
  }

  return { title: 'Empty lot', lines }
}

function moodOf(happiness: number): string {
  if (happiness >= 0.7) return 'thriving'
  if (happiness >= 0.45) return 'liveable'
  if (happiness >= 0.25) return 'strained'
  return 'rotting'
}

/**
 * The sim is frozen whenever the player is not watching, and coins accrue at
 * the rate the city had when they left. Backgrounding a tab and closing it are
 * the same absence, so they take the same path: rAF stopping is not enough on
 * its own, because that credits nothing for a tab switch and full rate for a
 * reload.
 */
let awaySince: number | null = null

/** Set while a restart is in flight, so nothing writes the old city back. */
let restarting = false

function goAway(): void {
  if (restarting) return
  if (awaySince === null) awaySince = Date.now()
  save(state)
}

function comeBack(): void {
  if (awaySince === null) return
  const away = (Date.now() - awaySince) / 1000
  awaySince = null
  clock = performance.now()

  const credited = Math.min(away, OFFLINE_CAP_SECONDS)
  const coins = derived.incomeRate * credited
  state.coins += coins
  if (away > 60) hud.showOfflineEarnings(coins, away)
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) goAway()
  else comeBack()
})
window.addEventListener('pagehide', goAway)
window.addEventListener('pagehide', () => music.dispose())
window.addEventListener('pagehide', () => sfx.dispose())
window.addEventListener('beforeunload', () => {
  if (!restarting) save(state)
})

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setTool({ kind: 'none' })
})
canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  setTool({ kind: 'none' })
})

let clock = performance.now()
let accumulator = 0
let sinceSave = 0

/**
 * Sim time per real second. The whole city runs off this, not just the build
 * timer: coins, dereliction, the day/night cycle and the traffic all speed up
 * together, because a city where the cars crawl while the clock races reads as
 * broken rather than fast.
 */
let speed = 1

function setSpeed(multiplier: number): void {
  speed = multiplier
}

function frame(now: number): void {
  requestAnimationFrame(frame)

  // Clamped so a stalled tab never fast-forwards the city on its way back.
  const dt = Math.min((now - clock) / 1000, 0.25)
  clock = now

  const simDt = dt * speed

  if (!document.hidden) {
    accumulator += simDt
    while (accumulator >= SIM_DT) {
      const result = step(state, SIM_DT, friendCount)
      derived = result.derived
      if (result.structureChanged) structureDirty = true
      accumulator -= SIM_DT
    }

    // Deliberately real seconds, not sim seconds: autosave is about how much
    // play is at risk in a crash, and that is measured on the wall clock.
    sinceSave += dt
    if (sinceSave >= AUTOSAVE_INTERVAL && !restarting) {
      sinceSave = 0
      save(state)
    }
  }

  if (structureDirty) {
    structureDirty = false
    renderer.sync(state, derived)
    refreshHover()
  }

  renderer.frame(simDt, state, derived)
  sfx.update(state, renderer.listenerPose())
  hud.update(state, derived)
  activity.update(state)
  tools.update(state)
  prestigePanel.update(state)
}

if (loaded && loaded.offlineSeconds > 60) {
  hud.showOfflineEarnings(loaded.offlineCoins, loaded.offlineSeconds)
}

requestAnimationFrame(frame)
