/**
 * Generated building geometry and the instanced meshes that draw it.
 *
 * No assets: every type is a box body plus a roof prism plus a couple of
 * silhouette details, merged into two geometries (body, roof) so the roof can
 * be tilted independently when a building goes derelict. A third geometry per
 * type holds the window quads that light up at night.
 *
 * Colour trick: the merged geometries carry a vertex colour that is the *ratio*
 * of the part colour to the building's body colour. The per-instance colour
 * then carries the jittered body colour, and body * ratio reproduces the roof
 * colour exactly — so one instanced colour drives the whole building and the
 * per-instance hue jitter, derelict fade and demolish tint apply coherently to
 * every part at once.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Scene,
  Vector3,
  AdditiveBlending,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BUILDINGS, BUILDING_TYPES } from '../sim/buildings'
import { TILE_COUNT } from '../sim/config'
import { tileToWorld } from '../sim/grid'
import type { BuildingType, CityState } from '../sim/types'
import {
  DANGER_COLOR,
  DERELICT_TINT,
  WINDOW_GLOW,
  clamp01,
  easeOutBack,
  setSrgb,
} from './palette'

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Flat-shaded triangular prism roof, base at y = 0, ridge running along z. */
function gableGeometry(w: number, d: number, h: number): BufferGeometry {
  const hw = w / 2
  const hd = d / 2
  const L0 = [-hw, 0, -hd]
  const L1 = [-hw, 0, hd]
  const R0 = [hw, 0, -hd]
  const R1 = [hw, 0, hd]
  const A0 = [0, h, -hd]
  const A1 = [0, h, hd]
  const tris = [
    L0, L1, A1, L0, A1, A0, // left slope
    R1, R0, A0, R1, A0, A1, // right slope
    L0, A0, R0, // gable end, -z
    R1, A1, L1, // gable end, +z
  ]
  const pos = new Float32Array(tris.length * 3)
  for (let i = 0; i < tris.length; i++) {
    pos[i * 3] = tris[i][0]
    pos[i * 3 + 1] = tris[i][1]
    pos[i * 3 + 2] = tris[i][2]
  }
  const geom = new BufferGeometry()
  geom.setAttribute('position', new BufferAttribute(pos, 3))
  geom.setAttribute('uv', new BufferAttribute(new Float32Array(tris.length * 2), 2))
  geom.computeVertexNormals()
  return geom
}

/** Ratio of `target` to `base`, per channel, in the linear working space. */
function ratioOf(base: Color, target: Color): Color {
  return new Color(
    Math.min(4, target.r / Math.max(base.r, 1e-3)),
    Math.min(4, target.g / Math.max(base.g, 1e-3)),
    Math.min(4, target.b / Math.max(base.b, 1e-3)),
  )
}

/** Make every part non-indexed and stamp a flat vertex colour on it. */
function tint(geom: BufferGeometry, color: Color): BufferGeometry {
  const flat = geom.index ? geom.toNonIndexed() : geom
  if (flat !== geom) geom.dispose()
  const n = flat.getAttribute('position').count
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3))
  // Drop anything we do not use so every part merges with every other part.
  for (const name of Object.keys(flat.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') {
      flat.deleteAttribute(name)
    }
  }
  return flat
}

function mergeParts(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  if (!merged) throw new Error('render/buildings: geometry merge failed')
  return merged
}

/** A window quad on each of the four faces, `count` of them per face. */
function windowQuads(
  half: number,
  y: number,
  w: number,
  h: number,
  offsets: number[],
): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const eps = 0.004
  for (const o of offsets) {
    const north = new PlaneGeometry(w, h)
    north.translate(o, y, half + eps)
    out.push(north)
    const south = new PlaneGeometry(w, h)
    south.rotateY(Math.PI)
    south.translate(-o, y, -half - eps)
    out.push(south)
    const east = new PlaneGeometry(w, h)
    east.rotateY(Math.PI / 2)
    east.translate(half + eps, y, -o)
    out.push(east)
    const west = new PlaneGeometry(w, h)
    west.rotateY(-Math.PI / 2)
    west.translate(-half - eps, y, o)
    out.push(west)
  }
  return out
}

interface Parts {
  body: BufferGeometry
  roof: BufferGeometry
  windows: BufferGeometry | null
  /** Local y the roof pivots about when it goes askew. */
  roofPivotY: number
  /** How much of the base height per-instance jitter may add or remove. */
  heightJitter: number
}

const WHITE = new Color(1, 1, 1)

function buildParts(type: BuildingType): Parts {
  const def = BUILDINGS[type]
  const body = new Color().setHex(def.color, SRGBColorSpace)
  const roofC = ratioOf(body, new Color().setHex(def.roofColor, SRGBColorSpace))
  const H = def.height

  if (type === 'park') {
    // Deliberately not a short house: a wide low plinth with a pale path across
    // it and a little planting, so it reads as open ground from any angle.
    const pale = ratioOf(body, new Color().setHex(0xd9cdb4, SRGBColorSpace))
    const bark = ratioOf(body, new Color().setHex(0x8a7461, SRGBColorSpace))
    const lawn = new BoxGeometry(0.92, 0.12, 0.92)
    lawn.translate(0, 0.06, 0)
    const path = new BoxGeometry(0.9, 0.02, 0.18)
    path.translate(0, 0.125, -0.02)
    const bodyGeom = mergeParts([tint(lawn, WHITE), tint(path, pale)])

    const bushA = new IcosahedronGeometry(0.12, 0)
    bushA.translate(-0.24, 0.2, 0.2)
    const bushB = new IcosahedronGeometry(0.095, 0)
    bushB.translate(-0.06, 0.185, 0.28)
    const bushC = new IcosahedronGeometry(0.1, 0)
    bushC.translate(0.28, 0.19, 0.24)
    const canopy = new ConeGeometry(0.16, 0.3, 6)
    canopy.translate(0.2, 0.35, -0.22)
    const trunk = new CylinderGeometry(0.028, 0.034, 0.12, 5)
    trunk.translate(0.2, 0.18, -0.22)
    const roofGeom = mergeParts([
      tint(bushA, roofC),
      tint(bushB, roofC),
      tint(bushC, roofC),
      tint(canopy, roofC),
      tint(trunk, bark),
    ])
    return { body: bodyGeom, roof: roofGeom, windows: null, roofPivotY: 0.12, heightJitter: 0.08 }
  }

  if (type === 'shop') {
    const bodyBox = new BoxGeometry(0.68, H, 0.68)
    bodyBox.translate(0, H / 2, 0)
    const canopy = new BoxGeometry(0.84, 0.05, 0.84)
    canopy.translate(0, H * 0.46, 0)
    const bodyGeom = mergeParts([tint(bodyBox, WHITE), tint(canopy, roofC)])

    const slab = new BoxGeometry(0.76, 0.1, 0.76)
    slab.translate(0, H + 0.05, 0)
    const unit = new BoxGeometry(0.24, 0.14, 0.24)
    unit.translate(0.13, H + 0.17, -0.11)
    const roofGeom = mergeParts([tint(slab, roofC), tint(unit, roofC)])

    const win = mergeParts(
      windowQuads(0.34, H * 0.28, 0.4, 0.22, [0]).map((g) => tint(g, WHITE)),
    )
    return { body: bodyGeom, roof: roofGeom, windows: win, roofPivotY: H, heightJitter: 0.28 }
  }

  if (type === 'factory') {
    const bodyBox = new BoxGeometry(0.74, H, 0.74)
    bodyBox.translate(0, H / 2, 0)
    const bodyGeom = mergeParts([tint(bodyBox, WHITE)])

    const slab = new BoxGeometry(0.8, 0.09, 0.8)
    slab.translate(0, H + 0.045, 0)
    const stackA = new CylinderGeometry(0.062, 0.075, 0.44, 8)
    stackA.translate(0.2, H + 0.27, 0.16)
    const stackB = new CylinderGeometry(0.052, 0.062, 0.28, 8)
    stackB.translate(-0.17, H + 0.19, -0.18)
    const roofGeom = mergeParts([tint(slab, roofC), tint(stackA, roofC), tint(stackB, roofC)])

    const win = mergeParts(
      windowQuads(0.37, H * 0.46, 0.1, 0.12, [-0.19, 0, 0.19]).map((g) => tint(g, WHITE)),
    )
    return { body: bodyGeom, roof: roofGeom, windows: win, roofPivotY: H, heightJitter: 0.3 }
  }

  // house
  const bodyBox = new BoxGeometry(0.62, H, 0.62)
  bodyBox.translate(0, H / 2, 0)
  const bodyGeom = mergeParts([tint(bodyBox, WHITE)])

  const roofPrism = gableGeometry(0.74, 0.74, 0.3)
  roofPrism.translate(0, H, 0)
  const chimney = new BoxGeometry(0.1, 0.3, 0.1)
  chimney.translate(0.2, H + 0.16, 0.15)
  const roofGeom = mergeParts([tint(roofPrism, roofC), tint(chimney, roofC)])

  const win = mergeParts(
    windowQuads(0.31, H * 0.42, 0.13, 0.16, [-0.14, 0.14]).map((g) => tint(g, WHITE)),
  )
  return { body: bodyGeom, roof: roofGeom, windows: win, roofPivotY: H, heightJitter: 0.3 }
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

interface Record_ {
  tile: number
  variant: number
  bornAt: number
  derelict: boolean
  /** Smoothed 0..1 so dereliction fades in rather than popping. */
  derelictAmt: number
  /** Static per-instance body colour, hue/lightness jittered from the variant. */
  color: Color
  yaw: number
  heightScale: number
  lean: number
}

interface TypeEntry {
  type: BuildingType
  parts: Parts
  bodyMesh: InstancedMesh
  roofMesh: InstancedMesh
  windowMesh: InstancedMesh | null
  records: Record_[]
}

export interface BuildingsUpdate {
  /**
   * The live sim state. Dereliction flips on an existing Building without the
   * grid itself changing shape, so the renderer reads that flag every frame
   * rather than trusting the snapshot taken at the last sync().
   */
  state: CityState
  /** Sim time in seconds. The sim owns time, not the renderer. */
  time: number
  dt: number
  /** 0 in day, 1 at night. */
  night: number
  /** Tile whose building should be tinted for demolition, if any. */
  demolishTile: number | null
}

export interface BuildingsLayer {
  /** Meshes that should take part in pointer picking. */
  pickables: Object3D[]
  sync(state: CityState): void
  update(u: BuildingsUpdate): void
  /** Tile index behind a raycast hit, or null if the hit was not a building. */
  tileForHit(object: Object3D, instanceId: number): number | null
  setGhost(type: BuildingType | null, tile: number | null, blocked: boolean): void
  dispose(): void
}

const SPAWN_SECONDS = 0.4
const DERELICT_FADE = 1.4

export function createBuildings(scene: Scene): BuildingsLayer {
  const bodyMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0,
    flatShading: true,
  })
  const windowMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    // Additive + fog would add the fog colour rather than fade towards it, and
    // tone mapping would flatten the one thing that is meant to read as light.
    fog: false,
    toneMapped: false,
  })
  const ghostMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.6,
    metalness: 0,
    flatShading: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  })

  const entries = new Map<BuildingType, TypeEntry>()
  const byMesh = new Map<Object3D, TypeEntry>()
  const pickables: Object3D[] = []

  function makeMesh(geom: BufferGeometry, mat: Material): InstancedMesh {
    const mesh = new InstancedMesh(geom, mat, TILE_COUNT)
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.castShadow = true
    mesh.receiveShadow = true
    // Allocate the instance colour buffer up front so it is never null later.
    for (let i = 0; i < TILE_COUNT; i++) mesh.setColorAt(i, WHITE)
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    return mesh
  }

  for (const type of BUILDING_TYPES) {
    const parts = buildParts(type)
    const bodyMesh = makeMesh(parts.body, bodyMaterial)
    const roofMesh = makeMesh(parts.roof, bodyMaterial)
    let windowMesh: InstancedMesh | null = null
    if (parts.windows) {
      windowMesh = new InstancedMesh(parts.windows, windowMaterial, TILE_COUNT)
      windowMesh.count = 0
      windowMesh.frustumCulled = false
      windowMesh.castShadow = false
      windowMesh.receiveShadow = false
      for (let i = 0; i < TILE_COUNT; i++) windowMesh.setColorAt(i, WHITE)
      if (windowMesh.instanceColor) windowMesh.instanceColor.needsUpdate = true
      scene.add(windowMesh)
    }
    scene.add(bodyMesh, roofMesh)
    const entry: TypeEntry = { type, parts, bodyMesh, roofMesh, windowMesh, records: [] }
    entries.set(type, entry)
    byMesh.set(bodyMesh, entry)
    byMesh.set(roofMesh, entry)
    pickables.push(bodyMesh, roofMesh)
  }

  // Ghost preview: one plain mesh per type, only one visible at a time.
  const ghostGeoms = new Map<BuildingType, BufferGeometry>()
  const ghosts = new Map<BuildingType, Mesh>()
  for (const type of BUILDING_TYPES) {
    const parts = entries.get(type)!.parts
    const clones = [parts.body.clone(), parts.roof.clone()]
    const geom = mergeGeometries(clones, false)
    for (const c of clones) c.dispose()
    if (!geom) throw new Error('render/buildings: ghost merge failed')
    ghostGeoms.set(type, geom)
    const mesh = new Mesh(geom, ghostMaterial)
    mesh.visible = false
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.renderOrder = 5
    scene.add(mesh)
    ghosts.set(type, mesh)
  }

  const hsl = { h: 0, s: 0, l: 0 }
  const baseColors = new Map<BuildingType, Color>()
  for (const type of BUILDING_TYPES) {
    baseColors.set(type, new Color().setHex(BUILDINGS[type].color, SRGBColorSpace))
  }

  function jitteredColor(type: BuildingType, variant: number): Color {
    const base = baseColors.get(type)!
    base.getHSL(hsl, SRGBColorSpace)
    const j = variant - 0.5
    return new Color().setHSL(
      hsl.h + j * 0.05,
      clamp01(hsl.s * (1 + j * 0.4)),
      clamp01(hsl.l + j * 0.1),
      SRGBColorSpace,
    )
  }

  function sync(state: CityState): void {
    // Carry the smoothed dereliction across a rebuild so it does not restart.
    const carry = new Map<number, { bornAt: number; amt: number }>()
    for (const entry of entries.values()) {
      for (const r of entry.records) carry.set(r.tile, { bornAt: r.bornAt, amt: r.derelictAmt })
      entry.records.length = 0
    }

    for (let tile = 0; tile < state.grid.length; tile++) {
      const b = state.grid[tile]
      if (!b) continue
      const entry = entries.get(b.type)
      if (!entry) continue
      const prev = carry.get(tile)
      const amt =
        prev && prev.bornAt === b.bornAt ? prev.amt : b.derelict ? 1 : 0
      entry.records.push({
        tile,
        variant: b.variant,
        bornAt: b.bornAt,
        derelict: b.derelict,
        derelictAmt: amt,
        color: jitteredColor(b.type, b.variant),
        // Four cardinal orientations plus a couple of degrees of slop, so a row
        // of identical houses does not read as a repeated stamp.
        yaw: Math.floor(b.variant * 4) * (Math.PI / 2) + (b.variant - 0.5) * 0.09,
        heightScale: 1 + (b.variant - 0.5) * entry.parts.heightJitter,
        lean: (b.variant - 0.5) * 2,
      })
    }

    for (const entry of entries.values()) {
      const n = entry.records.length
      entry.bodyMesh.count = n
      entry.roofMesh.count = n
      if (entry.windowMesh) entry.windowMesh.count = n
    }
  }

  const pos = new Vector3()
  const scale = new Vector3()
  const quat = new Quaternion()
  const euler = new Euler()
  const matrix = new Matrix4()
  const roofMatrix = new Matrix4()
  const pivotUp = new Matrix4()
  const pivotDown = new Matrix4()
  const askew = new Matrix4()
  const askewEuler = new Euler()
  const askewQuat = new Quaternion()
  const tmpColor = new Color()
  const derelictColor = setSrgb(new Color(), DERELICT_TINT)
  const dangerColor = new Color().setHex(DANGER_COLOR, SRGBColorSpace)
  const glowColor = setSrgb(new Color(), WINDOW_GLOW)

  function update(u: BuildingsUpdate): void {
    for (const entry of entries.values()) {
      const { records, bodyMesh, roofMesh, windowMesh, parts } = entry
      for (let i = 0; i < records.length; i++) {
        const r = records[i]
        const live = u.state.grid[r.tile]
        const derelict =
          live && live.bornAt === r.bornAt ? live.derelict : r.derelict
        const target = derelict ? 1 : 0
        if (r.derelictAmt !== target) {
          const step = u.dt / DERELICT_FADE
          r.derelictAmt =
            target > r.derelictAmt
              ? Math.min(target, r.derelictAmt + step)
              : Math.max(target, r.derelictAmt - step)
        }
        const d = r.derelictAmt
        const grow = easeOutBack((u.time - r.bornAt) / SPAWN_SECONDS)

        const w = tileToWorld(r.tile)
        pos.set(w.x, -0.07 * d, w.z)
        euler.set(r.lean * 0.05 * d, r.yaw, r.lean * -0.07 * d)
        quat.setFromEuler(euler)
        scale.set(grow, grow * r.heightScale * (1 - 0.1 * d), grow)
        matrix.compose(pos, quat, scale)
        bodyMesh.setMatrixAt(i, matrix)
        if (windowMesh) windowMesh.setMatrixAt(i, matrix)

        // The roof rides the body but gets its own tilt about the eaves line.
        if (d > 0.001) {
          askewEuler.set(r.lean * 0.16 * d, r.lean * 0.1 * d, r.lean * -0.2 * d)
          askewQuat.setFromEuler(askewEuler)
          askew.makeRotationFromQuaternion(askewQuat)
          pivotUp.makeTranslation(0, parts.roofPivotY, 0)
          pivotDown.makeTranslation(0, -parts.roofPivotY, 0)
          roofMatrix.copy(matrix).multiply(pivotUp).multiply(askew).multiply(pivotDown)
          // Let it settle a touch lower than the walls, like sagging timber.
          roofMatrix.elements[13] -= 0.03 * d
          roofMesh.setMatrixAt(i, roofMatrix)
        } else {
          roofMesh.setMatrixAt(i, matrix)
        }

        tmpColor.copy(r.color)
        if (d > 0) tmpColor.lerp(derelictColor, 0.6 * d)
        if (u.demolishTile === r.tile) tmpColor.lerp(dangerColor, 0.7)
        // Keep silhouettes from going to mud once the sun is down.
        if (u.night > 0) tmpColor.multiplyScalar(1 + 0.14 * u.night)
        bodyMesh.setColorAt(i, tmpColor)
        roofMesh.setColorAt(i, tmpColor)

        if (windowMesh) {
          // Windows come on at slightly different points in the evening.
          const lit =
            clamp01((u.night - 0.15 - (r.variant - 0.5) * 0.3) / 0.35) * (1 - d)
          const flicker = 0.7 + 0.5 * r.variant
          tmpColor.copy(glowColor).multiplyScalar(lit * flicker * grow)
          windowMesh.setColorAt(i, tmpColor)
        }
      }

      bodyMesh.instanceMatrix.needsUpdate = true
      roofMesh.instanceMatrix.needsUpdate = true
      if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true
      if (roofMesh.instanceColor) roofMesh.instanceColor.needsUpdate = true
      if (windowMesh) {
        windowMesh.instanceMatrix.needsUpdate = true
        if (windowMesh.instanceColor) windowMesh.instanceColor.needsUpdate = true
        windowMesh.visible = u.night > 0.02
      }
    }
  }

  function tileForHit(object: Object3D, instanceId: number): number | null {
    const entry = byMesh.get(object)
    if (!entry) return null
    const r = entry.records[instanceId]
    return r ? r.tile : null
  }

  function setGhost(type: BuildingType | null, tile: number | null, blocked: boolean): void {
    for (const [t, mesh] of ghosts) {
      const on = type === t && tile !== null
      mesh.visible = on
      if (!on) continue
      const w = tileToWorld(tile!)
      mesh.position.set(w.x, 0.01, w.z)
      mesh.rotation.set(0, 0, 0)
      mesh.scale.set(1, 1, 1)
    }
    if (type) {
      ghostMaterial.color.copy(
        blocked ? dangerColor : baseColors.get(type)!,
      )
      ghostMaterial.opacity = blocked ? 0.42 : 0.5
    }
  }

  function dispose(): void {
    for (const entry of entries.values()) {
      scene.remove(entry.bodyMesh, entry.roofMesh)
      entry.bodyMesh.dispose()
      entry.roofMesh.dispose()
      entry.parts.body.dispose()
      entry.parts.roof.dispose()
      if (entry.windowMesh) {
        scene.remove(entry.windowMesh)
        entry.windowMesh.dispose()
      }
      entry.parts.windows?.dispose()
    }
    for (const mesh of ghosts.values()) scene.remove(mesh)
    for (const geom of ghostGeoms.values()) geom.dispose()
    bodyMaterial.dispose()
    windowMaterial.dispose()
    ghostMaterial.dispose()
    entries.clear()
    byMesh.clear()
    ghosts.clear()
    ghostGeoms.clear()
    pickables.length = 0
  }

  return { pickables, sync, update, tileForHit, setGhost, dispose }
}
