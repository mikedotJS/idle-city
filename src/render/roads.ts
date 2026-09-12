/**
 * The street surface: tarmac ribbons along the tile seams, junction pads, and
 * a scatter of lamp posts that come on after dark.
 *
 * Two rules shape everything here.
 *
 * The first is that the ground tint is the game's user interface. Streets are
 * scenery laid on top of the one readout the player actually reads, so they
 * stay narrow (0.2 of a 1.0 tile pitch) and stay a near-neutral warm grey that
 * sits outside the happiness ramp entirely — the ramp runs grey-brown to sand
 * to sage, all of it warmer and more chromatic than the tarmac. A wider or
 * more colourful road would look better in isolation and cost the player the
 * ability to read their city at a glance, which is a bad trade at any width.
 *
 * The second is that roads never float. Unowned parcels are dropped 0.1 and
 * the world has an edge, so a ribbon centred on a seam would hang in the air
 * wherever the far side is not owned ground. Instead every ribbon is built as
 * two independent half-quads and every junction pad as up to four quadrants,
 * each emitted only if the tile it lies on is owned. Streets therefore stop
 * cleanly at the property line rather than jutting out over the drop.
 *
 * Everything is one merged geometry plus three small instanced meshes, rebuilt
 * only in sync(). frame() touches nothing but a handful of colours.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { WORLD_SIZE } from '../sim/config'
import { inBounds, parcelOfTile, tileIndex } from '../sim/grid'
import { CORNER_COUNT, cornerX, cornerZ } from '../sim/roads'
import type { RoadNetwork } from '../sim/roads'
import type { CityState } from '../sim/types'
import type { Roads } from './ambient-api'
import { clamp01, hexToRgb, setSrgb, smoothstep } from './palette'

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

/** Tarmac width. A fifth of a tile: enough to read as a street from the default
 *  camera (~19 px at the starting framing), narrow enough that a full board is
 *  still overwhelmingly ground tint. */
const ROAD_W = 0.2
const HALF_W = ROAD_W / 2

/** Junction pad, a touch wider than the road so the corner reads as an apron
 *  rather than a seam. Ribbons are trimmed by half of this at each end, so pad
 *  and ribbon tile exactly instead of overlapping — coplanar overlap would
 *  z-fight and double up the transparent-free surface. */
const PAD = 0.22
const HALF_PAD = PAD / 2

/** Sidewalk band: from the tarmac edge (HALF_W = 0.1 of the seam) out to 0.19.
 *  Pedestrians walk at a lateral offset of 0.125–0.145 (render/traffic.ts), so
 *  the band has to cover that whole range to keep them on the pavement. */
const WALK_OUT = 0.19

/**
 * Plate tops are at y = 0. Six millimetres of a one-metre tile is far above
 * the depth-buffer resolution at this camera range (near 0.5, far 200 gives
 * ~5e-5 units at 20 units out) and far below anything the eye can catch at the
 * shallowest allowed pitch of 25 degrees, where it displaces the silhouette by
 * 0.026 units. It also stays under the ground layer's hover frame (0.002 up)
 * and emission rings (0.018+), so those still draw over the street.
 */
const ROAD_Y = 0.012
/** The optional centre line rides just above the tarmac for the same reason. */
const LINE_Y = ROAD_Y + 0.004
/** Sidewalks sit 2 mm above the tarmac: a kerb reads as a step, and the gap is
 *  enough that a band overlapping a pad's outer rim never z-fights it. */
const WALK_Y = ROAD_Y + 0.002

/**
 * Off. A centre line at this road width has to be about 0.024 units wide, which
 * is ~2 px at the starting camera and ~1.3 px once the plot fills out — below
 * the point where it survives an orbiting camera without shimmering, and the
 * shimmer lands directly on top of the readout the player is meant to be
 * reading. The geometry is written and correct; flip this to true to see it.
 */
const CENTRE_LINE = false
const LINE_W = 0.024
const DASH = 0.2

// Lamps ---------------------------------------------------------------------

const POST_H = 0.3
const POST_R = 0.017
const ARM_LEN = 0.09
/** Distance from the seam to the post. Outside the pad (0.11) so the post sits
 *  on the kerb, and inside 0.114 so that the post centre still clears the
 *  widest building wall that can stand on the neighbouring tile — a factory
 *  body is 0.74 across, i.e. 0.37 from the tile centre, and 0.5 - 0.105 is
 *  0.395. Parks are the one exception: their 0.92 plinth swallows the bottom
 *  0.12 of the post, which reads as a lamp standing at the edge of the lawn. */
const LAMP_SIDE = 0.105
/** How far along the segment from the junction the post stands. */
const LAMP_ALONG = 0.3
const POOL_R = 0.34

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/** Pale worn tarmac. Deliberately less chromatic than every stop on the
 *  happiness ramp so it never reads as a tinted tile. */
const TARMAC = hexToRgb(0x9d978d)
/** Junction aprons, a shade lighter, so crossings have some structure. */
const TARMAC_PAD = hexToRgb(0xa39d93)
/** Pale stone for the sidewalks. One step lighter than the tarmac and, like
 *  it, less chromatic than every stop on the happiness ramp, so a band never
 *  reads as a tinted tile. */
const SIDEWALK = hexToRgb(0xb5afa3)
const CENTRE_LINE_RGB = hexToRgb(0xcac2b1)
/** Lamp post and its unlit head in daylight. */
const LAMP_POST = hexToRgb(0x6d675f)
const LAMP_HEAD_DARK = hexToRgb(0x746d64)
/** Sodium warm, a touch oranger than the palette's window glow. */
const LAMP_GLOW = hexToRgb(0xffcf94)

// Direction bits on a corner.
const PX = 1
const NX = 2
const PZ = 4
const NZ = 8

/** Cheap integer mix, so which junctions get a lamp is stable across rebuilds. */
function hash32(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

function popcount4(bits: number): number {
  return (bits & 1) + ((bits >> 1) & 1) + ((bits >> 2) & 1) + ((bits >> 3) & 1)
}

/** A soft round pool of light, unit radius, lying flat, black at the rim. */
function poolGeometry(): BufferGeometry {
  const geom = new RingGeometry(0, 1, 28, 1)
  geom.rotateX(-Math.PI / 2)
  const pos = geom.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i))
    const t = clamp01(1 - r)
    const v = t * t * (3 - 2 * t)
    colors[i * 3] = v
    colors[i * 3 + 1] = v
    colors[i * 3 + 2] = v
  }
  geom.setAttribute('color', new BufferAttribute(colors, 3))
  return geom
}

export function createRoads(): Roads {
  const group = new Group()
  group.name = 'roads'

  // --- tarmac --------------------------------------------------------------
  const surfaceMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
  })
  let surfaceGeom = new BufferGeometry()
  const surface = new Mesh(surfaceGeom, surfaceMaterial)
  surface.frustumCulled = false
  surface.castShadow = false
  surface.receiveShadow = true
  surface.visible = false
  group.add(surface)

  // --- lamps ---------------------------------------------------------------
  const postCyl = new CylinderGeometry(POST_R * 0.72, POST_R, POST_H, 6)
  postCyl.translate(0, POST_H / 2, 0)
  const armBox = new BoxGeometry(ARM_LEN, 0.016, 0.016)
  armBox.translate(ARM_LEN / 2, POST_H - 0.008, 0)
  const postGeom = mergeGeometries([postCyl, armBox], false)
  postCyl.dispose()
  armBox.dispose()
  if (!postGeom) throw new Error('render/roads: lamp post merge failed')

  const headGeom = new IcosahedronGeometry(0.03, 0)
  headGeom.translate(ARM_LEN, POST_H - 0.026, 0)

  const poolGeom = poolGeometry()

  const postMaterial = new MeshStandardMaterial({
    color: setSrgb(new Color(), LAMP_POST),
    roughness: 0.85,
    metalness: 0,
    flatShading: true,
  })

  const headMaterial = new MeshBasicMaterial({
    // Additive + fog would add the fog colour instead of fading into it, and
    // tone mapping would flatten the one thing meant to read as a light source.
    fog: false,
    toneMapped: false,
  })
  const poolMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    toneMapped: false,
  })

  // One instance per corner is the hard ceiling on lamps, so the buffers can
  // never overflow however the selection rule is retuned.
  const posts = new InstancedMesh(postGeom, postMaterial, CORNER_COUNT)
  const heads = new InstancedMesh(headGeom, headMaterial, CORNER_COUNT)
  const pools = new InstancedMesh(poolGeom, poolMaterial, CORNER_COUNT)
  for (const mesh of [posts, heads, pools]) {
    mesh.count = 0
    mesh.frustumCulled = false
    // A 0.024-wide post over a 2048 map spanning 24 units is two texels across;
    // its shadow would be a dotted smear, so it does not cast one.
    mesh.castShadow = false
    mesh.receiveShadow = false
    group.add(mesh)
  }
  const white = new Color(1, 1, 1)
  for (let i = 0; i < CORNER_COUNT; i++) {
    heads.setColorAt(i, white)
    pools.setColorAt(i, white)
  }
  if (heads.instanceColor) heads.instanceColor.needsUpdate = true
  if (pools.instanceColor) pools.instanceColor.needsUpdate = true
  pools.renderOrder = 1
  pools.visible = false

  /** Per-lamp phase for the slow breathe, parallel to the instance indices. */
  const lampPhase = new Float32Array(CORNER_COUNT)
  let lampCount = 0

  // --- rebuild -------------------------------------------------------------

  const dirs = new Uint8Array(CORNER_COUNT)
  const half = WORLD_SIZE / 2

  const positions: number[] = []
  const colors: number[] = []
  const scratch = new Color()
  const tarmac = setSrgb(new Color(), TARMAC)
  const tarmacPad = setSrgb(new Color(), TARMAC_PAD)
  const sidewalk = setSrgb(new Color(), SIDEWALK)
  const lineColor = setSrgb(new Color(), CENTRE_LINE_RGB)

  /** The state handed to the last sync(). Only read while rebuilding. */
  let stateRef: CityState | null = null

  function ownedTile(tx: number, tz: number): boolean {
    if (!inBounds(tx, tz)) return false
    return !!stateRef && !!stateRef.ownedParcels[parcelOfTile(tileIndex(tx, tz))]
  }

  /** Axis-aligned quad in the XZ plane, wound so its normal points up. */
  function addQuad(ax: number, az: number, bx: number, bz: number, y: number, c: Color): void {
    const x0 = Math.min(ax, bx)
    const x1 = Math.max(ax, bx)
    const z0 = Math.min(az, bz)
    const z1 = Math.max(az, bz)
    if (x1 - x0 < 1e-6 || z1 - z0 < 1e-6) return
    positions.push(x0, y, z1, x1, y, z1, x1, y, z0)
    positions.push(x0, y, z1, x1, y, z0, x0, y, z0)
    for (let i = 0; i < 6; i++) colors.push(c.r, c.g, c.b)
  }

  function buildSurface(network: RoadNetwork): void {
    positions.length = 0
    colors.length = 0
    dirs.fill(0)

    // Which way the streets leave each corner. Junction pads and lamps both
    // need this, and it is cheaper to stamp it once than to walk adjacency.
    for (let s = 0; s < network.segmentCount; s++) {
      const a = network.segments[s * 2]
      const b = network.segments[s * 2 + 1]
      if (cornerZ(a) === cornerZ(b)) {
        const lo = cornerX(a) < cornerX(b) ? a : b
        const hi = lo === a ? b : a
        dirs[lo] |= PX
        dirs[hi] |= NX
      } else {
        const lo = cornerZ(a) < cornerZ(b) ? a : b
        const hi = lo === a ? b : a
        dirs[lo] |= PZ
        dirs[hi] |= NZ
      }
    }

    // --- ribbons, one half-quad per side ------------------------------------
    for (let s = 0; s < network.segmentCount; s++) {
      const a = network.segments[s * 2]
      const b = network.segments[s * 2 + 1]
      const ax = cornerX(a)
      const az = cornerZ(a)
      const horizontal = az === cornerZ(b)
      const cx = horizontal ? Math.min(ax, cornerX(b)) : ax
      const cz = horizontal ? az : Math.min(az, cornerZ(b))

      // A little deterministic wear, so a long straight run is not one flat slab.
      const wear = 0.975 + ((hash32(a * 31 + (horizontal ? 1 : 2)) % 1000) / 1000) * 0.05
      scratch.copy(tarmac).multiplyScalar(wear)

      const x0 = cx - half
      const z0 = cz - half
      let bothSides = false

      if (horizontal) {
        const start = x0 + HALF_PAD
        const end = x0 + 1 - HALF_PAD
        const plus = ownedTile(cx, cz)
        const minus = ownedTile(cx, cz - 1)
        if (plus) {
          addQuad(start, z0, end, z0 + HALF_W, ROAD_Y, scratch)
          addQuad(start, z0 + HALF_W, end, z0 + WALK_OUT, WALK_Y, sidewalk)
        }
        if (minus) {
          addQuad(start, z0 - HALF_W, end, z0, ROAD_Y, scratch)
          addQuad(start, z0 - WALK_OUT, end, z0 - HALF_W, WALK_Y, sidewalk)
        }
        bothSides = plus && minus
        if (CENTRE_LINE && bothSides) {
          const mid = x0 + 0.5
          for (const sign of [-1, 1]) {
            const d0 = mid + sign * 0.03
            const d1 = mid + sign * (0.03 + DASH)
            addQuad(d0, z0 - LINE_W / 2, d1, z0 + LINE_W / 2, LINE_Y, lineColor)
          }
        }
      } else {
        const start = z0 + HALF_PAD
        const end = z0 + 1 - HALF_PAD
        const plus = ownedTile(cx, cz)
        const minus = ownedTile(cx - 1, cz)
        if (plus) {
          addQuad(x0, start, x0 + HALF_W, end, ROAD_Y, scratch)
          addQuad(x0 + HALF_W, start, x0 + WALK_OUT, end, WALK_Y, sidewalk)
        }
        if (minus) {
          addQuad(x0 - HALF_W, start, x0, end, ROAD_Y, scratch)
          addQuad(x0 - WALK_OUT, start, x0 - HALF_W, end, WALK_Y, sidewalk)
        }
        bothSides = plus && minus
        if (CENTRE_LINE && bothSides) {
          const mid = z0 + 0.5
          for (const sign of [-1, 1]) {
            const d0 = mid + sign * 0.03
            const d1 = mid + sign * (0.03 + DASH)
            addQuad(x0 - LINE_W / 2, d0, x0 + LINE_W / 2, d1, LINE_Y, lineColor)
          }
        }
      }
    }

    // --- junction pads, one quadrant at a time ------------------------------
    // A quadrant is only laid where a street actually runs into it, so a dead
    // end gets a flush cap and an L-bend gets an L rather than a square blob
    // sticking out into the empty quarter.
    for (let c = 0; c < CORNER_COUNT; c++) {
      const d = dirs[c]
      if (d === 0) continue
      const cx = cornerX(c)
      const cz = cornerZ(c)
      const x = cx - half
      const z = cz - half
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const alongX = sx > 0 ? d & PX : d & NX
          const alongZ = sz > 0 ? d & PZ : d & NZ
          if (!alongX && !alongZ) continue
          if (!ownedTile(sx > 0 ? cx : cx - 1, sz > 0 ? cz : cz - 1)) continue
          addQuad(x, z, x + sx * HALF_PAD, z + sz * HALF_PAD, ROAD_Y, tarmacPad)
          // No sidewalk raccord here: the bands run to HALF_PAD from each
          // corner, so two perpendicular bands already cross in the outer
          // corner square [HALF_PAD, WALK_OUT]² — entirely past the tarmac
          // edge and outside the pad. Adding a piece on top would either
          // double-draw that square or stick out over the pad and the
          // crossing ribbon, which reads as a stub in the middle of the road.
        }
      }
    }

    surfaceGeom.dispose()
    surfaceGeom = new BufferGeometry()
    const count = positions.length / 3
    const pos = new Float32Array(positions)
    const col = new Float32Array(colors)
    const nrm = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) nrm[i * 3 + 1] = 1
    surfaceGeom.setAttribute('position', new BufferAttribute(pos, 3))
    surfaceGeom.setAttribute('normal', new BufferAttribute(nrm, 3))
    surfaceGeom.setAttribute('color', new BufferAttribute(col, 3))
    if (count > 0) surfaceGeom.computeBoundingSphere()
    surface.geometry = surfaceGeom
    surface.visible = count > 0
  }

  // --- lamp placement ------------------------------------------------------

  const pos3 = new Vector3()
  const quat = new Quaternion()
  const unit = new Vector3(1, 1, 1)
  const poolScale = new Vector3(POOL_R, 1, POOL_R)
  const yAxis = new Vector3(0, 1, 0)
  const matrix = new Matrix4()
  const DIR_BITS = [PX, NX, PZ, NZ]
  const DIR_X = [1, -1, 0, 0]
  const DIR_Z = [0, 0, 1, -1]

  function buildLamps(): void {
    lampCount = 0
    for (let c = 0; c < CORNER_COUNT; c++) {
      const d = dirs[c]
      if (d === 0) continue
      const cx = cornerX(c)
      const cz = cornerZ(c)
      // A checkerboard of corners can never put two lamps on adjacent corners,
      // so whatever the hash does the spacing stays at least two tiles.
      if (((cx + cz) & 1) !== 0) continue
      if (popcount4(d) < 2) continue
      const h = hash32(c)
      if (h % 3 !== 0) continue

      // Stand it beside a street that really exists at this corner, on a side
      // that really is owned ground.
      const start = (h >>> 8) & 3
      const preferred = (h >>> 10) & 1 ? 1 : -1
      let placed = false
      for (let k = 0; k < 4 && !placed; k++) {
        const dir = (start + k) & 3
        if ((d & DIR_BITS[dir]) === 0) continue
        const dx = DIR_X[dir]
        const dz = DIR_Z[dir]
        for (let attempt = 0; attempt < 2 && !placed; attempt++) {
          const side = attempt === 0 ? preferred : -preferred
          let tx: number
          let tz: number
          let px: number
          let pz: number
          if (dx !== 0) {
            tx = dx > 0 ? cx : cx - 1
            tz = side > 0 ? cz : cz - 1
            px = cx + dx * LAMP_ALONG
            pz = cz + side * LAMP_SIDE
          } else {
            tz = dz > 0 ? cz : cz - 1
            tx = side > 0 ? cx : cx - 1
            px = cx + side * LAMP_SIDE
            pz = cz + dz * LAMP_ALONG
          }
          if (!ownedTile(tx, tz)) continue

          // The arm reaches from the kerb out over the tarmac.
          const armX = dx !== 0 ? 0 : -side
          const armZ = dx !== 0 ? -side : 0
          const yaw = Math.atan2(-armZ, armX)

          const wx = px - half
          const wz = pz - half
          pos3.set(wx, 0, wz)
          quat.setFromAxisAngle(yAxis, yaw)
          matrix.compose(pos3, quat, unit)
          posts.setMatrixAt(lampCount, matrix)
          heads.setMatrixAt(lampCount, matrix)

          pos3.set(wx + armX * ARM_LEN, ROAD_Y + 0.008, wz + armZ * ARM_LEN)
          quat.identity()
          matrix.compose(pos3, quat, poolScale)
          pools.setMatrixAt(lampCount, matrix)

          lampPhase[lampCount] = ((h >>> 4) & 255) / 255 * Math.PI * 2
          lampCount++
          placed = true
        }
      }
    }
    posts.count = lampCount
    heads.count = lampCount
    pools.count = lampCount
    posts.instanceMatrix.needsUpdate = true
    heads.instanceMatrix.needsUpdate = true
    pools.instanceMatrix.needsUpdate = true
  }

  function sync(state: CityState, network: RoadNetwork): void {
    stateRef = state
    buildSurface(network)
    buildLamps()
  }

  // --- per frame -----------------------------------------------------------

  const headDark = setSrgb(new Color(), LAMP_HEAD_DARK)
  const glow = setSrgb(new Color(), LAMP_GLOW)
  const tmp = new Color()
  let clock = 0

  function frame(dt: number, night: number): void {
    clock += dt

    // Match the ground layer's night lift exactly, so the street keeps the same
    // tonal relationship to the tint it sits on at every hour of the cycle.
    const lift = 1 + 0.42 * night
    surfaceMaterial.color.setRGB(lift, lift, lift)

    // Street lighting is switched centrally: the whole city comes on together,
    // and a little ahead of the windows, which fade in per building.
    const lit = smoothstep(0.12, 0.5, night)
    pools.visible = lit > 0.02
    if (lampCount === 0) return

    for (let i = 0; i < lampCount; i++) {
      // Barely-there breathing, enough to stop a row of lamps looking stamped.
      const flick = 1 + 0.05 * Math.sin(clock * 1.7 + lampPhase[i])
      const k = lit * flick
      tmp.copy(headDark).lerp(glow, clamp01(k)).multiplyScalar(1 + 0.4 * k)
      heads.setColorAt(i, tmp)
      if (pools.visible) {
        tmp.copy(glow).multiplyScalar(k * 0.28)
        pools.setColorAt(i, tmp)
      }
    }
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true
    if (pools.instanceColor && pools.visible) pools.instanceColor.needsUpdate = true
  }

  function dispose(): void {
    group.parent?.remove(group)
    group.clear()
    surfaceGeom.dispose()
    surfaceMaterial.dispose()
    posts.dispose()
    heads.dispose()
    pools.dispose()
    postGeom.dispose()
    headGeom.dispose()
    poolGeom.dispose()
    postMaterial.dispose()
    headMaterial.dispose()
    poolMaterial.dispose()
    stateRef = null
    lampCount = 0
  }

  return { sync, frame, object: group, dispose }
}
