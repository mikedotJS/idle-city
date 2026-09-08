/**
 * The ground: one instanced plate per tile, coloured by tile happiness.
 *
 * This is the game's primary readout, so it gets the design weight. Owned tiles
 * sit at y = 0 and take the full happiness ramp; unowned parcels sit 0.1 lower,
 * take a single flat desaturated colour and get a faint frame, so the buyable
 * edge of the plot is legible from any angle without a UI overlay.
 */

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PARCEL_SIZE, TILE_COUNT, WORLD_SIZE } from '../sim/config'
import { parcelOfTile, tileIndex, tileToWorld } from '../sim/grid'
import type { CityState } from '../sim/types'
import {
  HIGHLIGHT_COLOR,
  PARCEL_BORDER,
  RING_BAD,
  RING_GOOD,
  TABLE_COLOR,
  UNOWNED_GROUND,
  happinessRgb,
  setSrgb,
} from './palette'

const PLATE_GAP = 0.045
const UNOWNED_DROP = 0.1

/** A flat rectangular outline lying in the XZ plane, centred on the origin. */
function frameGeometry(size: number, thickness: number): BufferGeometry {
  const h = 0.024
  const outer = (size - thickness) / 2
  const inner = size - thickness * 2
  const parts: BufferGeometry[] = []
  const a = new BoxGeometry(size, h, thickness)
  a.translate(0, 0, -outer)
  parts.push(a)
  const b = new BoxGeometry(size, h, thickness)
  b.translate(0, 0, outer)
  parts.push(b)
  const c = new BoxGeometry(thickness, h, inner)
  c.translate(-outer, 0, 0)
  parts.push(c)
  const d = new BoxGeometry(thickness, h, inner)
  d.translate(outer, 0, 0)
  parts.push(d)
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  if (!merged) throw new Error('render/ground: frame merge failed')
  return merged
}

export interface GroundUpdate {
  /** Happiness per tile, from Derived. Read only. */
  field: Float32Array
  /** 0 in day, 1 at night. */
  night: number
}

export interface GroundLayer {
  /** The plate mesh; instance index equals tile index. */
  plates: InstancedMesh
  pickables: Object3D[]
  sync(state: CityState): void
  update(u: GroundUpdate): void
  /** Highlight a tile, a parcel, or nothing. */
  setHover(tile: number | null, parcel: number | null): void
  /** Show the emission footprint of a pending placement. */
  setRing(tile: number | null, range: number, good: boolean): void
  dispose(): void
}

export function createGround(scene: Scene): GroundLayer {
  const owned = new Uint8Array(TILE_COUNT)

  // --- the table the diorama sits on ---------------------------------------
  const tableGeom = new BoxGeometry(WORLD_SIZE + 5, 0.6, WORLD_SIZE + 5)
  const tableMaterial = new MeshStandardMaterial({
    color: new Color().setHex(TABLE_COLOR, SRGBColorSpace),
    roughness: 1,
    metalness: 0,
  })
  const table = new Mesh(tableGeom, tableMaterial)
  table.position.y = -0.52
  table.receiveShadow = true
  scene.add(table)

  // --- tile plates ---------------------------------------------------------
  const plateGeom = new BoxGeometry(1 - PLATE_GAP, 0.22, 1 - PLATE_GAP)
  plateGeom.translate(0, -0.11, 0)
  const plateMaterial = new MeshStandardMaterial({
    roughness: 0.95,
    metalness: 0,
  })
  const plates = new InstancedMesh(plateGeom, plateMaterial, TILE_COUNT)
  plates.count = TILE_COUNT
  plates.frustumCulled = false
  plates.receiveShadow = true
  plates.castShadow = false
  scene.add(plates)

  const white = new Color(1, 1, 1)
  for (let i = 0; i < TILE_COUNT; i++) plates.setColorAt(i, white)
  if (plates.instanceColor) plates.instanceColor.needsUpdate = true

  // --- unowned parcel borders ---------------------------------------------
  const borderMaterial = new MeshBasicMaterial({
    color: new Color().setHex(PARCEL_BORDER, SRGBColorSpace),
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  })
  let borderMesh: Mesh | null = null

  // --- hover highlights ----------------------------------------------------
  const highlightMaterial = new MeshBasicMaterial({
    color: new Color().setHex(HIGHLIGHT_COLOR, SRGBColorSpace),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  })
  const tileFrameGeom = frameGeometry(0.98, 0.07)
  const tileFrame = new Mesh(tileFrameGeom, highlightMaterial)
  tileFrame.visible = false
  tileFrame.renderOrder = 3
  scene.add(tileFrame)

  const parcelFrameGeom = frameGeometry(PARCEL_SIZE - 0.06, 0.1)
  const parcelFrame = new Mesh(parcelFrameGeom, highlightMaterial)
  parcelFrame.visible = false
  parcelFrame.renderOrder = 3
  scene.add(parcelFrame)

  // --- emission radius preview --------------------------------------------
  const ringGeom = new RingGeometry(0.955, 1, 96)
  ringGeom.rotateX(-Math.PI / 2)
  const discGeom = new RingGeometry(0, 0.955, 64)
  discGeom.rotateX(-Math.PI / 2)
  const ringMaterial = new MeshBasicMaterial({
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    side: DoubleSide,
  })
  const discMaterial = new MeshBasicMaterial({
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    side: DoubleSide,
  })
  const ring = new Mesh(ringGeom, ringMaterial)
  const disc = new Mesh(discGeom, discMaterial)
  ring.renderOrder = 4
  disc.renderOrder = 2
  ring.visible = false
  disc.visible = false
  scene.add(ring, disc)
  const ringGood = new Color().setHex(RING_GOOD, SRGBColorSpace)
  const ringBad = new Color().setHex(RING_BAD, SRGBColorSpace)

  // --- sync ----------------------------------------------------------------
  const pos = new Vector3()
  const quat = new Quaternion()
  const scale = new Vector3(1, 1, 1)
  const matrix = new Matrix4()

  function sync(state: CityState): void {
    for (let tile = 0; tile < TILE_COUNT; tile++) {
      const isOwned = state.ownedParcels[parcelOfTile(tile)] ? 1 : 0
      owned[tile] = isOwned
      const w = tileToWorld(tile)
      pos.set(w.x, isOwned ? 0 : -UNOWNED_DROP, w.z)
      matrix.compose(pos, quat, scale)
      plates.setMatrixAt(tile, matrix)
    }
    plates.instanceMatrix.needsUpdate = true

    // Rebuild the faint frames around every parcel that can still be bought.
    if (borderMesh) {
      scene.remove(borderMesh)
      borderMesh.geometry.dispose()
      borderMesh = null
    }
    const frames: BufferGeometry[] = []
    for (let p = 0; p < state.ownedParcels.length; p++) {
      if (state.ownedParcels[p]) continue
      const px = p % (WORLD_SIZE / PARCEL_SIZE)
      const pz = Math.floor(p / (WORLD_SIZE / PARCEL_SIZE))
      const corner = tileToWorld(tileIndex(px * PARCEL_SIZE, pz * PARCEL_SIZE))
      const cx = corner.x + (PARCEL_SIZE - 1) / 2
      const cz = corner.z + (PARCEL_SIZE - 1) / 2
      const g = frameGeometry(PARCEL_SIZE - 0.12, 0.06)
      g.translate(cx, -UNOWNED_DROP + 0.012, cz)
      frames.push(g)
    }
    if (frames.length > 0) {
      const merged = mergeGeometries(frames, false)
      for (const g of frames) g.dispose()
      if (merged) {
        borderMesh = new Mesh(merged, borderMaterial)
        borderMesh.renderOrder = 2
        scene.add(borderMesh)
      }
    }
  }

  // --- per-frame colour ----------------------------------------------------
  const color = new Color()
  const unowned = setSrgb(new Color(), UNOWNED_GROUND)

  function update(u: GroundUpdate): void {
    // Night would otherwise crush the ramp into a single dark smear, so the
    // plates are lifted as the light drops. The tint stays the readout.
    const lift = 1 + 0.45 * u.night
    for (let tile = 0; tile < TILE_COUNT; tile++) {
      if (owned[tile]) {
        setSrgb(color, happinessRgb(u.field[tile]))
        color.multiplyScalar(lift)
      } else {
        color.copy(unowned).multiplyScalar(0.82 * lift)
      }
      plates.setColorAt(tile, color)
    }
    if (plates.instanceColor) plates.instanceColor.needsUpdate = true
    if (borderMesh) borderMaterial.opacity = 0.34 + 0.2 * u.night
  }

  function setHover(tile: number | null, parcel: number | null): void {
    tileFrame.visible = tile !== null
    if (tile !== null) {
      const w = tileToWorld(tile)
      tileFrame.position.set(w.x, 0.014, w.z)
    }
    parcelFrame.visible = parcel !== null
    if (parcel !== null) {
      const per = WORLD_SIZE / PARCEL_SIZE
      const px = parcel % per
      const pz = Math.floor(parcel / per)
      const corner = tileToWorld(tileIndex(px * PARCEL_SIZE, pz * PARCEL_SIZE))
      parcelFrame.position.set(
        corner.x + (PARCEL_SIZE - 1) / 2,
        -UNOWNED_DROP + 0.03,
        corner.z + (PARCEL_SIZE - 1) / 2,
      )
    }
  }

  function setRing(tile: number | null, range: number, good: boolean): void {
    const on = tile !== null && range > 0
    ring.visible = on
    disc.visible = on
    if (!on) return
    const w = tileToWorld(tile as number)
    ring.position.set(w.x, 0.022, w.z)
    disc.position.set(w.x, 0.018, w.z)
    ring.scale.set(range, 1, range)
    disc.scale.set(range, 1, range)
    const c = good ? ringGood : ringBad
    ringMaterial.color.copy(c)
    discMaterial.color.copy(c)
  }

  function dispose(): void {
    scene.remove(table, plates, tileFrame, parcelFrame, ring, disc)
    if (borderMesh) {
      scene.remove(borderMesh)
      borderMesh.geometry.dispose()
    }
    tableGeom.dispose()
    tableMaterial.dispose()
    plateGeom.dispose()
    plateMaterial.dispose()
    plates.dispose()
    tileFrameGeom.dispose()
    parcelFrameGeom.dispose()
    highlightMaterial.dispose()
    borderMaterial.dispose()
    ringGeom.dispose()
    discGeom.dispose()
    ringMaterial.dispose()
    discMaterial.dispose()
  }

  return { plates, pickables: [plates], sync, update, setHover, setRing, dispose }
}
