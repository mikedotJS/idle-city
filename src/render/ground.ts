/**
 * The ground: one instanced plate per tile, coloured by tile happiness.
 *
 * This is the game's primary readout, so it gets the design weight. Owned tiles
 * sit at y = 0 and take the full happiness ramp; unowned parcels sit 0.1 lower,
 * take a single flat desaturated colour and get a faint frame, so the buyable
 * edge of the plot is legible from any angle without a UI overlay.
 *
 * Terrain rides on the same plates, under three rules:
 *
 * - **Water and mountain tiles leave the ramp entirely.** Nothing can be built
 *   on them and nobody lives there, so a happiness colour on them would be a
 *   reading of nothing — worse than useless, because the player reads the board
 *   at a glance and would count them. A water tile's plate drops to the sim's
 *   own water height and becomes the lake bed, seen only through the surface
 *   render/terrain.ts lays over it; a mountain tile's plate becomes plain rock
 *   under the peak. Both take cool, low-chroma colours the warm happiness ramp
 *   cannot produce, so neither can be mistaken for a reading on it.
 * - **Beaches keep their happiness.** A beach tile is ordinary buildable
 *   ground that happens to touch water, so it keeps the full tint and is only
 *   shifted toward sand — far enough that every beach tile carries a warm cast
 *   the ramp never has at any happiness (red minus blue above 40 against the
 *   ramp's 16 to 30), not so far that the tint stops being legible. Sand that
 *   swamped the tint would be trading the interface for scenery.
 * - **Terrain ignores ownership.** Unowned plain drops 0.1 to show it can be
 *   bought; water and rock stay where they are, because the drop says
 *   "buildable, not yours yet" and neither of them will ever be buildable.
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
import { Terrain, terrainFor } from '../sim/terrain'
import type { CityState } from '../sim/types'
import type { RGB } from './palette'
import {
  HIGHLIGHT_COLOR,
  PARCEL_BORDER,
  RING_BAD,
  RING_GOOD,
  TABLE_COLOR,
  UNOWNED_GROUND,
  hexToRgb,
  happinessRgb,
  mixRgb,
  setSrgb,
} from './palette'

const PLATE_GAP = 0.045
const UNOWNED_DROP = 0.1

/**
 * Sand. Warmer and more chromatic than anything on the happiness ramp, whose
 * warmest stop is a near-neutral 0xc2bda4, so a beach reads as a material
 * rather than as a score.
 */
const SAND = hexToRgb(0xf0cf9b)
/** How far a beach plate is pulled toward sand. Above ~0.5 the tint dies. */
const BEACH_MIX = 0.38
/** And a little brighter with it: sand is the palest ground on the board. */
const BEACH_LIFT = 1.05
/** Unowned beaches show their sand too, but stay flat and unbought. */
const UNOWNED_BEACH_MIX = 0.3

/** The lake bed, seen only through the water surface. Cool, silty, off-ramp. */
const SEA_FLOOR = hexToRgb(0x8f9b95)
/** Bare rock under a peak: the same slate as the mountain, one step darker. */
const ROCK_PLATE = hexToRgb(0x74727d)

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
  // Terrain per tile, copied out in sync(). Zeroed is the flat world, which is
  // also what seed 0 generates, so the layer is correct before its first sync.
  const kind = new Uint8Array(TILE_COUNT)
  const beach = new Uint8Array(TILE_COUNT)

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
    const map = terrainFor(state)
    for (let tile = 0; tile < TILE_COUNT; tile++) {
      const isOwned = state.ownedParcels[parcelOfTile(tile)] ? 1 : 0
      owned[tile] = isOwned
      kind[tile] = map.terrain[tile]
      beach[tile] = map.beach[tile]
      const w = tileToWorld(tile)
      // Water sinks to the sim's own water height and becomes the lake bed;
      // rock stays at ground level under the peak. Only plain land takes the
      // unowned drop, because only plain land can ever be bought and built on.
      const y =
        kind[tile] === Terrain.Water
          ? map.height[tile]
          : kind[tile] === Terrain.Mountain
            ? 0
            : isOwned
              ? 0
              : -UNOWNED_DROP
      pos.set(w.x, y, w.z)
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
  const UNOWNED_WASH = setSrgb(new Color(), hexToRgb(0xcfc7b6))
  const seaFloor = setSrgb(new Color(), SEA_FLOOR)
  const rock = setSrgb(new Color(), ROCK_PLATE)
  const sandLinear = setSrgb(new Color(), SAND)
  const sandMix: RGB = [0, 0, 0]

  function update(u: GroundUpdate): void {
    // Night would otherwise crush the ramp into one dark blue-grey smear. The
    // plates are lifted as the light drops and their chroma is pushed back out
    // against the moonlight's wash, because the tint is the readout and it has
    // to survive every hour of the cycle.
    const lift = 1 + 0.42 * u.night
    const sat = 1 + 0.6 * u.night
    for (let tile = 0; tile < TILE_COUNT; tile++) {
      if (kind[tile] === Terrain.Water) {
        // No happiness reading here at all: this is the bed of the lake.
        color.copy(seaFloor)
      } else if (kind[tile] === Terrain.Mountain) {
        color.copy(rock)
      } else if (owned[tile]) {
        // Beaches are tinted first and sanded second, so the sand rides on top
        // of the reading instead of standing in for it.
        if (beach[tile]) {
          setSrgb(color, mixRgb(happinessRgb(u.field[tile]), SAND, BEACH_MIX, sandMix))
          color.multiplyScalar(BEACH_LIFT)
        } else {
          setSrgb(color, happinessRgb(u.field[tile]))
        }
      } else {
        // Washed out and slightly brighter than the plot, not darker: unowned
        // land is space the city could have, and a dark ring around a small
        // plot reads as a void the city is hiding in.
        color.copy(unowned).lerp(UNOWNED_WASH, 0.32).multiplyScalar(1.02)
        if (beach[tile]) color.lerp(sandLinear, UNOWNED_BEACH_MIX)
      }
      color.multiplyScalar(lift)
      if (u.night > 0) {
        const lum = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722
        color.setRGB(
          lum + (color.r - lum) * sat,
          lum + (color.g - lum) * sat,
          lum + (color.b - lum) * sat,
        )
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
