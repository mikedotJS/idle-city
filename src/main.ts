import { createRenderer } from './render/scene'
import type { PickTarget, Renderer, Tool } from './render/api'
import { createHud } from './ui/hud'
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
import { load, save } from './sim/save'
import { BUILDINGS, buildingCost } from './sim/buildings'
import { AUTOSAVE_INTERVAL, OFFLINE_CAP_SECONDS, SIM_DT } from './sim/config'
import type { CityState, Derived } from './sim/types'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const uiRoot = document.getElementById('ui') as HTMLElement

const loaded = load()
const state: CityState = loaded ? loaded.state : createCity()
let derived: Derived = derive(state)

let tool: Tool = { kind: 'none' }
let hovered: PickTarget | null = null
let structureDirty = true

const renderer: Renderer = createRenderer(canvas, { onPick, onHover })
const hud: Hud = createHud(uiRoot, {
  onSelectTool: setTool,
  onQueue: (type) => {
    enqueue(state, type)
  },
  onClearQueue: () => {
    clearQueue(state)
  },
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
    const cost = landCost(state)
    return {
      title: 'Unclaimed land',
      lines: ['Nine tiles. The city will spread into it as soon as you own it.'],
      cost: cost ?? undefined,
      affordable: cost !== null && state.coins >= cost,
    }
  }

  const tile = target.tile
  const happiness = derived.field[tile]
  const building = state.grid[tile]
  const lines = [`Happiness ${(happiness * 100).toFixed(0)}% — ${moodOf(happiness)}`]

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

function goAway(): void {
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
window.addEventListener('beforeunload', () => save(state))

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

function frame(now: number): void {
  requestAnimationFrame(frame)

  // Clamped so a stalled tab never fast-forwards the city on its way back.
  const dt = Math.min((now - clock) / 1000, 0.25)
  clock = now

  if (!document.hidden) {
    accumulator += dt
    while (accumulator >= SIM_DT) {
      const result = step(state, SIM_DT)
      derived = result.derived
      if (result.structureChanged) structureDirty = true
      accumulator -= SIM_DT
    }

    sinceSave += dt
    if (sinceSave >= AUTOSAVE_INTERVAL) {
      sinceSave = 0
      save(state)
    }
  }

  if (structureDirty) {
    structureDirty = false
    renderer.sync(state, derived)
    refreshHover()
  }

  renderer.frame(dt, state, derived)
  hud.update(state, derived)
}

if (loaded && loaded.offlineSeconds > 60) {
  hud.showOfflineEarnings(loaded.offlineCoins, loaded.offlineSeconds)
}

requestAnimationFrame(frame)
