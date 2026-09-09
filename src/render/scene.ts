/**
 * The renderer: assembles the ground, buildings, lighting and camera layers,
 * owns the WebGL context and the pointer interaction, and implements the
 * Renderer contract in ./api.
 *
 * It reads sim state and never writes to it.
 */

import {
  NeutralToneMapping,
  Raycaster,
  Scene as ThreeScene,
  Vector2,
  WebGLRenderer,
} from 'three'
import { BUILDINGS } from '../sim/buildings'
import { parcelOfTile } from '../sim/grid'
import { PARCELS_PER_SIDE, PARCEL_SIZE, WORLD_SIZE } from '../sim/config'
import { computeRoads } from '../sim/roads'
import type { CityState, Derived } from '../sim/types'
import type { PickTarget, Renderer, RendererCallbacks, Tool } from './api'
import { createBuildings } from './buildings'
import { createCameraRig } from './camera'
import { createGround } from './ground'
import { createRailView } from './rail'
import { createRoads } from './roads'
import { createTerrainView } from './terrain'
import { createTraffic } from './traffic'
import { SHADOW_MAP_TYPE, createLighting } from './lighting'

const CLICK_SLOP_PX = 6

export function createRenderer(canvas: HTMLCanvasElement, cb: RendererCallbacks): Renderer {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = SHADOW_MAP_TYPE
  // Neutral rather than ACES: ACES pulls the saturation out of pastels and the
  // whole point of the look is that the pastels survive.
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 1.0

  const scene = new ThreeScene()
  const lighting = createLighting(scene)
  const ground = createGround(scene)
  const buildings = createBuildings(scene)
  const terrainView = createTerrainView()
  const roads = createRoads()
  const rail = createRailView()
  const traffic = createTraffic()
  // Terrain first: the water surface is translucent and must draw after the
  // lake bed but before anything standing on the shore.
  scene.add(terrainView.object, roads.object, rail.object, traffic.object)
  const rig = createCameraRig(canvas)

  const pickables = [...ground.pickables, ...buildings.pickables]
  const raycaster = new Raycaster()
  const ndc = new Vector2()

  let tool: Tool = { kind: 'none' }
  let hover: PickTarget | null = null
  let pointerInside = false
  let pointerX = 0
  let pointerY = 0
  let downX = 0
  let downY = 0
  let downButton = -1
  let width = 0
  let height = 0
  let lastState: CityState | null = null
  let synced = false

  // --- sizing --------------------------------------------------------------

  function measure(): void {
    // Clamp to the window so a canvas with no CSS size cannot feed its own
    // backing-store growth back into the next measurement.
    const w = Math.max(
      1,
      Math.min(canvas.clientWidth || window.innerWidth, window.innerWidth),
    )
    const h = Math.max(
      1,
      Math.min(canvas.clientHeight || window.innerHeight, window.innerHeight),
    )
    if (w === width && h === height) return
    width = w
    height = h
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(w, h, false)
    rig.resize(w, h)
  }

  const onResize = (): void => measure()
  window.addEventListener('resize', onResize)
  const observer =
    typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null
  observer?.observe(canvas)
  measure()

  // --- picking -------------------------------------------------------------

  function targetsEqual(a: PickTarget | null, b: PickTarget | null): boolean {
    if (a === null || b === null) return a === b
    if (a.kind !== b.kind) return false
    return a.kind === 'tile' && b.kind === 'tile'
      ? a.tile === b.tile
      : a.kind === 'parcel' && b.kind === 'parcel'
        ? a.parcel === b.parcel
        : false
  }

  function pick(): PickTarget | null {
    if (!lastState || width === 0 || height === 0) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    ndc.x = ((pointerX - rect.left) / rect.width) * 2 - 1
    ndc.y = -((pointerY - rect.top) / rect.height) * 2 + 1
    // The controls moved the camera this frame; the renderer has not flushed
    // the scene graph yet, so bring this one matrix up to date ourselves.
    rig.camera.updateMatrixWorld()
    raycaster.setFromCamera(ndc, rig.camera)
    const hits = raycaster.intersectObjects(pickables, false)
    for (const hit of hits) {
      let tile: number | null = null
      if (hit.object === ground.plates) {
        tile = hit.instanceId ?? null
      } else if (hit.instanceId !== undefined) {
        tile = buildings.tileForHit(hit.object, hit.instanceId)
      }
      if (tile === null) continue
      const parcel = parcelOfTile(tile)
      return lastState.ownedParcels[parcel]
        ? { kind: 'tile', tile }
        : { kind: 'parcel', parcel }
    }
    return null
  }

  /** Recompute the hover target and everything that hangs off it. */
  function refreshHover(): void {
    const next = pointerInside ? pick() : null
    if (!targetsEqual(next, hover)) {
      hover = next
      cb.onHover(next)
    }
    applyHoverVisuals()
  }

  function applyHoverVisuals(): void {
    const tile = hover && hover.kind === 'tile' ? hover.tile : null
    const parcel = hover && hover.kind === 'parcel' ? hover.parcel : null
    ground.setHover(tile, parcel)

    let ghostType: Parameters<typeof buildings.setGhost>[0] = null
    let ghostTile: number | null = null
    let blocked = false
    let ringRange = 0
    let ringGood = true

    if (tool.kind === 'place' && tile !== null) {
      const def = BUILDINGS[tool.type]
      ghostType = tool.type
      ghostTile = tile
      blocked = !!(lastState && lastState.grid[tile])
      if (def.emit) {
        ringRange = def.emit.range
        ringGood = def.emit.strength >= 0
      }
    }
    buildings.setGhost(ghostType, ghostTile, blocked)
    ground.setRing(ringRange > 0 ? ghostTile : null, ringRange, ringGood)
  }

  function flashTile(tile: number): void {
    ground.flash(tile)
  }

  /** The tile whose building the demolish tool is currently aimed at. */
  function demolishTile(): number | null {
    if (tool.kind !== 'demolish') return null
    if (!hover || hover.kind !== 'tile') return null
    if (!lastState || !lastState.grid[hover.tile]) return null
    return hover.tile
  }

  // --- pointer -------------------------------------------------------------

  const onPointerMove = (e: PointerEvent): void => {
    pointerInside = true
    pointerX = e.clientX
    pointerY = e.clientY
    refreshHover()
  }

  const onPointerLeave = (): void => {
    pointerInside = false
    refreshHover()
  }

  const onPointerDown = (e: PointerEvent): void => {
    downX = e.clientX
    downY = e.clientY
    downButton = e.button
    pointerInside = true
    pointerX = e.clientX
    pointerY = e.clientY
  }

  const onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0 || downButton !== 0) {
      downButton = -1
      return
    }
    downButton = -1
    // An orbit drag also ends in a pointerup; only a near-stationary one counts.
    if (Math.abs(e.clientX - downX) > CLICK_SLOP_PX) return
    if (Math.abs(e.clientY - downY) > CLICK_SLOP_PX) return
    pointerX = e.clientX
    pointerY = e.clientY
    pointerInside = true
    refreshHover()
    if (hover) cb.onPick(hover)
  }

  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)

  // --- contract ------------------------------------------------------------

  /** Width in tiles of the bounding box of every parcel the player owns. */
  function ownedExtent(state: CityState): number {
    let minX = WORLD_SIZE
    let maxX = -1
    let minZ = WORLD_SIZE
    let maxZ = -1
    for (let parcel = 0; parcel < state.ownedParcels.length; parcel++) {
      if (!state.ownedParcels[parcel]) continue
      const px = (parcel % PARCELS_PER_SIDE) * PARCEL_SIZE
      const pz = Math.floor(parcel / PARCELS_PER_SIDE) * PARCEL_SIZE
      minX = Math.min(minX, px)
      maxX = Math.max(maxX, px + PARCEL_SIZE)
      minZ = Math.min(minZ, pz)
      maxZ = Math.max(maxZ, pz + PARCEL_SIZE)
    }
    if (maxX < 0) return PARCEL_SIZE
    return Math.max(maxX - minX, maxZ - minZ)
  }

  function sync(state: CityState, derived: Derived): void {
    lastState = state
    synced = true
    ground.sync(state)
    buildings.sync(state)
    // Streets are derived from the layout, exactly like the happiness field,
    // so they are recomputed here and never stored.
    const network = computeRoads(state)
    terrainView.sync(state)
    roads.sync(state, network)
    rail.sync(state)
    traffic.sync(state, derived, network)
    ground.update({ field: derived.field, night: 0, dt: 0 })
    rig.frameOwned(ownedExtent(state))
    applyHoverVisuals()
  }

  function frame(dt: number, state: CityState, derived: Derived): void {
    lastState = state
    if (!synced) sync(state, derived)

    const night = lighting.update(state.time)
    ground.update({ field: derived.field, night, dt })
    buildings.update({
      state,
      time: state.time,
      dt,
      night,
      demolishTile: demolishTile(),
    })
    terrainView.frame(dt, night)
    roads.frame(dt, night)
    rail.frame(dt, night)
    traffic.frame(dt, night)
    rig.update(dt)
    if (pointerInside) refreshHover()
    renderer.render(scene, rig.camera)
  }

  function setTool(next: Tool): void {
    tool = next
    applyHoverVisuals()
  }

  function dispose(): void {
    window.removeEventListener('resize', onResize)
    observer?.disconnect()
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerleave', onPointerLeave)
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointerup', onPointerUp)
    rig.dispose()
    traffic.dispose()
    rail.dispose()
    roads.dispose()
    terrainView.dispose()
    buildings.dispose()
    ground.dispose()
    lighting.dispose()
    pickables.length = 0
    renderer.dispose()
  }

  return { sync, frame, setTool, flashTile, dispose }
}
