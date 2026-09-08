/**
 * Ambient life: cars and pedestrians walking the street network.
 *
 * This is decoration at the edge of vision, and it is sized like it. The tile
 * pitch is 1.0 and a house is 0.55 tall, so a car is 0.18 long and a person is
 * 0.12 — small enough that what you read is movement and colour, not a vehicle.
 * Anything built at a plausible real-world scale against a 1-unit tile would
 * stomp through the diorama like a monster.
 *
 * Two fixed-capacity InstancedMeshes carry the whole system: 24 cars, 48
 * people, allocated once at construction with `count` set to however many are
 * currently live. Population and building count drive that number, so an empty
 * plot is silent, a young city has one car pottering about, and a full one is
 * busy. Nothing is allocated per frame — every matrix, quaternion and colour is
 * a hoisted scratch object.
 *
 * Agents walk corner to corner along `sim/roads`. Segments are axis-aligned and
 * exactly one tile long, so progress along one is a single scalar and speed is
 * literally tiles per second. At each corner an agent picks a random neighbour
 * and refuses to double back unless the corner is a dead end, where reversing
 * is the only legal move.
 *
 * The one piece of finesse: each agent holds a fixed lateral offset from the
 * centre line — cars a little to one side, which reads as driving on the right;
 * people further out towards the kerb. That offset is expressed relative to the
 * direction of travel, so it would snap across the street at every junction.
 * Instead each agent knows one segment ahead, and the offset and the heading
 * are blended across a window straddling the corner. Two lerps buy a rounded
 * turn, a path that never jumps, and — the reason it is worth doing at all —
 * lane changes that finish before the junction rather than after it.
 *
 * That last point is what most of the lane code is about. The corridor either
 * side of a seam is narrow and every building type takes a different bite out
 * of it — a park's lawn plate is 0.92 across and 0.12 tall, so it stops 0.04
 * from the seam and is taller than a pedestrian, and a factory's wall stops at
 * 0.13. So each agent picks its lane per segment from what the two flanking
 * tiles actually leave it, swaps to the roomier side when its own is blocked,
 * and starts the swap early enough to have finished before the corner.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TILE_COUNT, WORLD_SIZE } from '../sim/config'
import { tileIndex } from '../sim/grid'
import { cornerToWorld, cornerX, cornerZ, neighboursOf } from '../sim/roads'
import type { RoadNetwork } from '../sim/roads'
import type { BuildingType, CityState, Derived } from '../sim/types'
import type { Traffic } from './ambient-api'
import { clamp01, smoothstep } from './palette'

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const CAR_CAPACITY = 24
const PERSON_CAPACITY = 48

/** Tiles per second. A segment is one tile, so this is also segments/second. */
const CAR_SPEED = 1.6
const PERSON_SPEED = 0.5
/** Multiplicative spread either side of the base speed, so nothing convoys. */
const SPEED_JITTER = 0.22

/** Cars per building, people per head of population. Both clamp to capacity. */
const CARS_PER_BUILDING = 0.3
const PEOPLE_PER_POP = 0.26

/**
 * Wheels and feet on the tarmac. render/roads lays its surface at 0.012, so
 * this is that plus two thousandths of clearance: enough that nothing sinks
 * into the road, far too little to read as hovering above it.
 */
const SURFACE_Y = 0.014

/**
 * Length of the turn, as a fraction of a segment. Half of it is spent on the
 * approach and half on the exit, so the arc is centred on the junction: at the
 * corner itself an agent is halfway between the two lanes and halfway round to
 * the new heading, which is where a real turn puts it.
 */
const TURN = 0.3

/**
 * Lateral offset from the centre line, in tiles. Measured against what is
 * actually there rather than chosen by taste: render/roads lays 0.2 of tarmac,
 * so the road runs to 0.1 either side of the seam, and a car is 0.086 wide. At
 * 0.05 a car sits wholly on its own half of the tarmac and never crosses the
 * centre line, so oncoming traffic passes clean.
 *
 * That uses the road up. Pedestrians therefore walk the kerb strip beyond it,
 * from 0.115 to 0.14, which keeps them off the tarmac and — via the clearance
 * table below — out of the walls behind them. The one thing sharing that strip
 * is render/roads' lamp posts at 0.105; a pedestrian will occasionally clip one,
 * which is a graze against a 0.034-wide stick and the cheapest of the things
 * that could have given here.
 */
const CAR_LANE = 0.05
const PERSON_LANE_MIN = 0.115
const PERSON_LANE_MAX = 0.14
/**
 * How much room each building type leaves between the seam and its own bulk,
 * measured off the geometry in render/buildings: half the widest part that
 * stands below an agent's head, subtracted from the half-tile. The park is the
 * cruel one — its lawn plate is 0.92 across and 0.12 tall, so it leaves 0.04
 * and is taller than the pedestrian who would walk through it. Roofs, canopies
 * and factory slabs are all overhead and do not count.
 */
const CLEARANCE: Record<BuildingType, number> = {
  house: 0.19, // body 0.62
  shop: 0.16, // body 0.68, canopy is at 0.35 and clears everyone
  factory: 0.13, // body 0.74
  park: 0.04, // lawn plate 0.92, and only 0.12 tall
}
/** An empty tile takes nothing; an agent may hang over bare ground. */
const OPEN_CLEARANCE = 0.5

/** Half-widths, taken at the largest per-instance scale rather than the mean. */
const CAR_HALF = 0.047
const PERSON_HALF = 0.032

const CAR_LENGTH = 0.18
const CAR_WIDTH = 0.086
const PERSON_HEIGHT = 0.118

// ---------------------------------------------------------------------------
// Colour. palette.ts owns the city's identity; these are the two small sets it
// has no reason to know about, so they live here rather than in the contract.
// ---------------------------------------------------------------------------

/** Pastel, muted, low saturation — paintwork on a wooden toy, not car paint. */
const CAR_COLORS = [
  0xd8a9a1, // dusty rose
  0xa9bdd0, // pale blue
  0xe3cf9f, // butter
  0x9fc0a7, // sage
  0xc7b3d2, // lilac
  0xdfb894, // apricot
  0xd9d3c7, // bone
  0x91b0b7, // teal grey
]

/** A touch greyer than the cars: a person is a speck and must not shout. */
const PERSON_COLORS = [
  0xc7a3a2, 0x9fb4c8, 0xd6c69c, 0xa8c1a4,
  0xb8a9c3, 0xd1b79d, 0xcdc7bb, 0x8ca5ac,
]

/** Headlights after dark. Warm, to sit against the cool night sky. */
const HEADLIGHT_COLOR = 0xffe2ae
/** Tail lamps, as a ratio applied to the headlight colour. Muted, never a UI red. */
const TAILLIGHT_RATIO = new Color(0.55, 0.18, 0.14)
/** The wash the beam throws on the tarmac. */
const BEAM_STRENGTH = 0.34

/** Darker parts, as a plain multiplier on whatever body colour an instance has. */
const CABIN_RATIO = 0.62
const WHEEL_RATIO = 0.3
/** A person's head: slightly lighter and warmer than their shirt. */
const HEAD_RATIO = new Color(1.16, 1.06, 0.97)

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Stamp a flat vertex colour on a part and strip everything that would stop it
 * merging. The colour is a *ratio*: the per-instance colour carries the body
 * paint, and body x ratio gives the darker cabin or the lighter head, so one
 * instanced colour drives the whole agent whatever pastel it was dealt.
 */
function paint(geom: BufferGeometry, r: number, g: number, b: number): BufferGeometry {
  const flat = geom.index ? geom.toNonIndexed() : geom
  if (flat !== geom) geom.dispose()
  const n = flat.getAttribute('position').count
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3))
  for (const name of Object.keys(flat.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') {
      flat.deleteAttribute(name)
    }
  }
  return flat
}

function grey(geom: BufferGeometry, v: number): BufferGeometry {
  return paint(geom, v, v, v)
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  if (!merged) throw new Error('render/traffic: geometry merge failed')
  return merged
}

/**
 * A toy car: forward is +x, base at y = 0. Three stacked boxes rather than a
 * literal rounded box — the chamfer between hull and shoulder is what reads as
 * roundness at this size, and it costs twelve triangles instead of a shader.
 */
function buildCarGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []

  const hull = new BoxGeometry(CAR_LENGTH, 0.028, CAR_WIDTH)
  hull.translate(0, 0.03, 0)
  parts.push(grey(hull, 1))

  const shoulder = new BoxGeometry(CAR_LENGTH - 0.014, 0.014, CAR_WIDTH - 0.01)
  shoulder.translate(-0.002, 0.051, 0)
  parts.push(grey(shoulder, 1))

  const cabin = new BoxGeometry(0.076, 0.022, CAR_WIDTH - 0.02)
  cabin.translate(-0.014, 0.069, 0)
  parts.push(grey(cabin, CABIN_RATIO))

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = new CylinderGeometry(0.016, 0.016, 0.013, 6)
      wheel.rotateX(Math.PI / 2)
      wheel.translate(sx * 0.056, 0.016, sz * 0.042)
      parts.push(grey(wheel, WHEEL_RATIO))
    }
  }

  return merge(parts)
}

/**
 * Lamps and the wash they throw, drawn additively so they are light rather than
 * paint. Separate from the body because they must not take the car's colour.
 */
function buildLightGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []

  for (const sz of [-1, 1]) {
    const head = new PlaneGeometry(0.03, 0.02)
    head.rotateY(Math.PI / 2)
    head.translate(CAR_LENGTH / 2 + 0.002, 0.044, sz * 0.026)
    parts.push(grey(head, 1))

    const tail = new PlaneGeometry(0.026, 0.016)
    tail.rotateY(-Math.PI / 2)
    tail.translate(-CAR_LENGTH / 2 - 0.002, 0.044, sz * 0.028)
    parts.push(paint(tail, TAILLIGHT_RATIO.r, TAILLIGHT_RATIO.g, TAILLIGHT_RATIO.b))
  }

  // The beam on the road: a flat disc whose vertex colour falls off to nothing
  // at the rim, which is a radial gradient for free and with no texture. It
  // rides just clear of the tarmac and its lane markings, and is biased forward
  // in the depth buffer besides, so it lies on the road rather than fighting it.
  const beam = new CircleGeometry(0.062, 12)
  const flat = beam.toNonIndexed()
  beam.dispose()
  const pos = flat.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i)) / 0.062
    const v = BEAM_STRENGTH * (1 - clamp01(r)) ** 1.5
    colors[i * 3] = v
    colors[i * 3 + 1] = v
    colors[i * 3 + 2] = v
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3))
  for (const name of Object.keys(flat.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') flat.deleteAttribute(name)
  }
  flat.rotateX(-Math.PI / 2)
  flat.scale(1.7, 1, 1)
  flat.translate(0.135, -SURFACE_Y + 0.021, 0)
  parts.push(flat)

  return merge(parts)
}

/** A person: a tapered six-sided body with a faceted head. Forward is +x. */
function buildPersonGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []

  const body = new CylinderGeometry(0.019, 0.026, 0.076, 6)
  body.translate(0, 0.038, 0)
  parts.push(grey(body, 1))

  const head = new IcosahedronGeometry(0.021, 0)
  head.translate(0, PERSON_HEIGHT - 0.021, 0)
  parts.push(paint(head, HEAD_RATIO.r, HEAD_RATIO.g, HEAD_RATIO.b))

  return merge(parts)
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/**
 * One walker. Everything is a flat scalar: this is a struct in an array walked
 * sixty times a second, and a Vector3 per field would be sixty times the churn
 * for no clarity.
 *
 * Three segments are held at once — the one behind, the one being walked, and
 * the one about to be walked. The lookahead is what lets a lane change start
 * *before* the junction instead of after it: a pedestrian who has to swap
 * pavements because a park is coming up must already be across by the time he
 * reaches the corner, or he spends half a second inside a lawn plate that is
 * taller than he is.
 */
interface Agent {
  /** Corner being walked from, or -1 when the agent has never been seeded. */
  from: number
  to: number
  /** Corner after `to`, already chosen. -1 when the street ran out. */
  next: number
  /** Progress along the current segment, 0..1. */
  t: number
  /** Segments (= tiles) per second. Fixed per slot. */
  speed: number

  /** Lane magnitude and preferred side. Both fixed per slot. */
  laneMag: number
  laneSign: number
  /** Half the agent's width, for deciding what it fits past. */
  halfWidth: number
  scale: number
  /** Walk cycle phase. Unused by cars. */
  phase: number

  /** Current segment: origin, unit direction, length, right-hand normal, lane. */
  fx: number
  fz: number
  len: number
  dirX: number
  dirZ: number
  rx: number
  rz: number
  yaw: number
  lateral: number

  /** Previous segment, and the one coming up. Normal, heading and lane only. */
  prx: number
  prz: number
  pyaw: number
  plat: number
  nrx: number
  nrz: number
  nyaw: number
  nlat: number

  /**
   * How tightly to cut the junction behind and the junction ahead. 1 is the
   * natural arc; less pulls the apex in towards the junction point, which is
   * how an agent gets past the corner of a park lawn that neither of its two
   * segments is adjacent to.
   */
  cutIn: number
  cutOut: number
}

function makeAgent(): Agent {
  return {
    from: -1,
    to: -1,
    next: -1,
    t: 0,
    speed: 1,
    laneMag: 0,
    laneSign: 1,
    halfWidth: 0,
    scale: 1,
    phase: 0,
    fx: 0,
    fz: 0,
    len: 1,
    dirX: 1,
    dirZ: 0,
    rx: 0,
    rz: 1,
    yaw: 0,
    lateral: 0,
    prx: 0,
    prz: 1,
    pyaw: 0,
    plat: 0,
    nrx: 0,
    nrz: 1,
    nyaw: 0,
    nlat: 0,
    cutIn: 1,
    cutOut: 1,
  }
}

/** Deterministic 0..1 from a slot index, so nothing churns between syncs. */
function hash01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

function degreeOf(net: RoadNetwork, corner: number): number {
  if (corner < 0 || corner >= net.adjacencyStart.length - 1) return 0
  return net.adjacencyStart[corner + 1] - net.adjacencyStart[corner]
}

/** Is this agent still standing on a segment the network actually has? */
function onLiveSegment(net: RoadNetwork, a: Agent): boolean {
  if (degreeOf(net, a.from) === 0) return false
  const nb = neighboursOf(net, a.from)
  for (let i = 0; i < nb.length; i++) if (nb[i] === a.to) return true
  return false
}

/**
 * A random neighbour of `at`, never the corner we just came from — unless that
 * is the only way out, because a dead end has no other legal move.
 */
function pickNext(net: RoadNetwork, at: number, cameFrom: number): number {
  const nb = neighboursOf(net, at)
  if (nb.length === 0) return -1
  if (nb.length === 1) return nb[0]
  let choices = 0
  for (let i = 0; i < nb.length; i++) if (nb[i] !== cameFrom) choices++
  if (choices === 0) return nb[0]
  let k = Math.min(choices - 1, Math.floor(Math.random() * choices))
  for (let i = 0; i < nb.length; i++) {
    if (nb[i] === cameFrom) continue
    if (k === 0) return nb[i]
    k--
  }
  return nb[0]
}

/**
 * How much room the tile flanking this segment on the given side leaves.
 *
 * The midpoint of the segment stepped half a tile along the normal lands inside
 * the flanking tile, and every term is an exact half, so the floor is not a
 * rounding gamble. Off the board is open ground.
 */
function sideClearance(
  from: number,
  to: number,
  nx: number,
  nz: number,
  clear: Float32Array,
): number {
  const tx = Math.floor((cornerX(from) + cornerX(to)) * 0.5 + nx * 0.5)
  const tz = Math.floor((cornerZ(from) + cornerZ(to)) * 0.5 + nz * 0.5)
  if (tx < 0 || tz < 0 || tx >= WORLD_SIZE || tz >= WORLD_SIZE) return OPEN_CLEARANCE
  return clear[tileIndex(tx, tz)]
}

/** The same, for the tile diagonally off a corner. */
function cornerClearance(corner: number, sx: number, sz: number, clear: Float32Array): number {
  const tx = Math.floor(cornerX(corner) + sx * 0.5)
  const tz = Math.floor(cornerZ(corner) + sz * 0.5)
  if (tx < 0 || tz < 0 || tx >= WORLD_SIZE || tz >= WORLD_SIZE) return OPEN_CLEARANCE
  return clear[tileIndex(tx, tz)]
}

/** Geometry of one segment as an agent will walk it. */
interface Lane {
  fx: number
  fz: number
  len: number
  dirX: number
  dirZ: number
  rx: number
  rz: number
  yaw: number
  lateral: number
}

const laneScratch: Lane = {
  fx: 0, fz: 0, len: 1, dirX: 1, dirZ: 0, rx: 0, rz: 1, yaw: 0, lateral: 0,
}

/**
 * Work out how this agent would walk `from` -> `to`: heading, right-hand normal
 * and the lane it can actually use. It keeps its preferred side while that side
 * has room for it, takes the other one when the other is roomier, and tucks in
 * towards the centre line when neither will take a full lane. A car keeping
 * clear of a park reads as traffic giving the green a wide berth rather than as
 * a broken convention, which is the whole reason this is worth doing.
 */
function computeLane(a: Agent, from: number, to: number, clear: Float32Array, out: Lane): void {
  const w0 = cornerToWorld(from)
  const w1 = cornerToWorld(to)
  let dx = w1.x - w0.x
  let dz = w1.z - w0.z
  const len = Math.hypot(dx, dz) || 1
  dx /= len
  dz /= len

  out.fx = w0.x
  out.fz = w0.z
  out.len = len
  out.dirX = dx
  out.dirZ = dz
  out.rx = -dz
  out.rz = dx
  // Local +x is forward; a yaw of atan2(-dz, dx) maps it onto the segment.
  out.yaw = Math.atan2(-dz, dx)

  const sign = a.laneSign
  const near = sideClearance(from, to, out.rx * sign, out.rz * sign, clear) - a.halfWidth
  let bestSign = sign
  let best = Math.min(a.laneMag, near)
  // Strictly greater, so the preferred side wins every tie and traffic only
  // changes hands where it actually has to.
  const alt = Math.min(a.laneMag, sideClearance(from, to, -out.rx * sign, -out.rz * sign, clear) - a.halfWidth)
  if (alt > best) {
    bestSign = -sign
    best = alt
  }
  out.lateral = bestSign * Math.max(0, best)
}

/** Choose and pre-compute the segment after the current one. */
function planNext(a: Agent, net: RoadNetwork, clear: Float32Array): void {
  const n = pickNext(net, a.to, a.from)
  a.next = n
  if (n < 0) {
    // Nowhere to go. Hold the current lane so the pose blend stays still.
    a.nrx = a.rx
    a.nrz = a.rz
    a.nyaw = a.yaw
    a.nlat = a.lateral
    return
  }
  computeLane(a, a.to, n, clear, laneScratch)
  a.nrx = laneScratch.rx
  a.nrz = laneScratch.rz
  a.nyaw = laneScratch.yaw
  a.nlat = laneScratch.lateral

  // Where the two lanes point into different quadrants the turn cuts across the
  // tile diagonally opposite the corner — which neither segment flanks, so the
  // lane check above never sees it. Tuck the apex in against the junction point
  // when that tile would not have taken it. The agent clears the tile's corner
  // as long as one axis clears it, hence the min.
  a.cutOut = 1
  const ox = a.rx * a.lateral + a.nrx * a.nlat
  const oz = a.rz * a.lateral + a.nrz * a.nlat
  if (ox !== 0 && oz !== 0) {
    const room = cornerClearance(a.to, Math.sign(ox), Math.sign(oz), clear) - a.halfWidth
    const apex = Math.min(Math.abs(ox), Math.abs(oz)) * 0.5
    if (apex > room) a.cutOut = Math.max(0, room) / apex
  }
}

/**
 * Put an agent on a segment. `carry` keeps the old heading and lane so the turn
 * can be blended; a freshly seeded agent has no history and starts already
 * pointing the right way.
 */
function enterSegment(
  a: Agent,
  net: RoadNetwork,
  from: number,
  to: number,
  t: number,
  carry: boolean,
  clear: Float32Array,
): void {
  // The junction being left is the junction that was being approached, so its
  // apex clamp carries over unchanged.
  a.cutIn = carry ? a.cutOut : 1
  if (carry) {
    a.prx = a.rx
    a.prz = a.rz
    a.pyaw = a.yaw
    a.plat = a.lateral
  }

  computeLane(a, from, to, clear, laneScratch)
  a.from = from
  a.to = to
  a.t = t
  a.fx = laneScratch.fx
  a.fz = laneScratch.fz
  a.len = laneScratch.len
  a.dirX = laneScratch.dirX
  a.dirZ = laneScratch.dirZ
  a.rx = laneScratch.rx
  a.rz = laneScratch.rz
  a.yaw = laneScratch.yaw
  a.lateral = laneScratch.lateral

  if (!carry) {
    a.prx = a.rx
    a.prz = a.rz
    a.pyaw = a.yaw
    a.plat = a.lateral
  }

  planNext(a, net, clear)
}

/** Drop an agent somewhere legal. Returns false when there are no streets. */
function seed(net: RoadNetwork, a: Agent, clear: Float32Array): boolean {
  const corners = net.connectedCorners
  if (corners.length === 0) return false
  const c = corners[Math.floor(Math.random() * corners.length) % corners.length]
  const nb = neighboursOf(net, c)
  if (nb.length === 0) return false
  const n = nb[Math.floor(Math.random() * nb.length) % nb.length]
  enterSegment(a, net, c, n, Math.random(), false, clear)
  return true
}

// ---------------------------------------------------------------------------
// Scratch. Hoisted: frame() runs at 60fps and must not touch the allocator.
// ---------------------------------------------------------------------------

const scratchPos = new Vector3()
const scratchScale = new Vector3()
const scratchQuat = new Quaternion()
const scratchEuler = new Euler(0, 0, 0, 'YXZ')
const scratchMatrix = new Matrix4()
const scratchColor = new Color()

const TWO_PI = Math.PI * 2
const HALF_TURN = TURN * 0.5

/** Shortest signed angle from a to b. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % TWO_PI
  if (d > Math.PI) d -= TWO_PI
  if (d < -Math.PI) d += TWO_PI
  return d
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export function createTraffic(): Traffic {
  const group = new Group()
  group.name = 'traffic'

  const bodyMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.72,
    metalness: 0,
    flatShading: true,
  })
  // Additive, unfogged and untonemapped for the same reason the windows in
  // render/buildings are: fog would add its colour rather than fade towards it,
  // and tone mapping would flatten the one thing meant to read as light.
  const lightMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    toneMapped: false,
    // The beam lies almost flat on the tarmac and render/roads owns how thick
    // that tarmac is, so bias it forward rather than gamble on the z-buffer.
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })

  const carGeometry = buildCarGeometry()
  const lightGeometry = buildLightGeometry()
  const personGeometry = buildPersonGeometry()

  const carMesh = new InstancedMesh(carGeometry, bodyMaterial, CAR_CAPACITY)
  const lightMesh = new InstancedMesh(lightGeometry, lightMaterial, CAR_CAPACITY)
  const personMesh = new InstancedMesh(personGeometry, bodyMaterial, PERSON_CAPACITY)

  for (const mesh of [carMesh, lightMesh, personMesh]) {
    mesh.count = 0
    // Instances range over the whole plot; the meshes' own bounds are one agent.
    mesh.frustumCulled = false
    // Too small to resolve in a shadow map covering the plot, so they only
    // receive. A car casting a two-texel smudge costs a pass and buys nothing.
    mesh.castShadow = false
    mesh.receiveShadow = true
  }
  lightMesh.receiveShadow = false
  lightMesh.renderOrder = 6
  lightMesh.visible = false
  group.add(carMesh, lightMesh, personMesh)

  // Per-slot constants: colour, speed, lane and size are picked once from the
  // slot index and never change, so re-seeding an agent onto a new corner does
  // not make it change colour or swap lanes mid-city.
  const cars: Agent[] = []
  const carColors: Color[] = []
  for (let i = 0; i < CAR_CAPACITY; i++) {
    const a = makeAgent()
    const h = hash01(i)
    a.speed = CAR_SPEED * (1 - SPEED_JITTER + 2 * SPEED_JITTER * h)
    // Every car keeps to the same hand, which is what reads as traffic.
    a.laneMag = CAR_LANE * (0.94 + 0.12 * hash01(i + 977))
    a.laneSign = 1
    a.halfWidth = CAR_HALF
    a.scale = 0.92 + 0.16 * hash01(i + 311)
    cars.push(a)
    carColors.push(
      new Color().setHex(CAR_COLORS[(i * 5 + 1) % CAR_COLORS.length], SRGBColorSpace),
    )
  }

  const people: Agent[] = []
  const personColors: Color[] = []
  for (let i = 0; i < PERSON_CAPACITY; i++) {
    const a = makeAgent()
    const h = hash01(i + 4099)
    a.speed = PERSON_SPEED * (1 - SPEED_JITTER + 2 * SPEED_JITTER * h)
    // Pedestrians take both pavements: half of them walk on their left.
    a.laneSign = hash01(i + 733) < 0.5 ? -1 : 1
    a.laneMag =
      PERSON_LANE_MIN + (PERSON_LANE_MAX - PERSON_LANE_MIN) * hash01(i + 8191)
    a.halfWidth = PERSON_HALF
    a.scale = 0.88 + 0.24 * hash01(i + 1213)
    a.phase = hash01(i + 65537) * TWO_PI
    people.push(a)
    personColors.push(
      new Color().setHex(PERSON_COLORS[(i * 3 + 2) % PERSON_COLORS.length], SRGBColorSpace),
    )
  }

  const headlightColor = new Color().setHex(HEADLIGHT_COLOR, SRGBColorSpace)

  /** How much room each tile leaves beside its seams. Refreshed on every sync. */
  const clearance = new Float32Array(TILE_COUNT)

  let network: RoadNetwork | null = null
  let carCount = 0
  let personCount = 0
  /** Night level the instance colours were last written for. */
  let appliedNight = -1
  let appliedBeam = -1

  /**
   * Night lifts every agent's colour rather than letting them sink into it.
   * People get the bigger lift: they are the smaller silhouette and the brief
   * is that ambient life must still be legible after dark.
   */
  function writeColors(night: number): void {
    for (let i = 0; i < CAR_CAPACITY; i++) {
      scratchColor.copy(carColors[i]).multiplyScalar(1 + 0.18 * night)
      carMesh.setColorAt(i, scratchColor)
    }
    for (let i = 0; i < PERSON_CAPACITY; i++) {
      scratchColor.copy(personColors[i]).multiplyScalar(1 + 0.36 * night)
      personMesh.setColorAt(i, scratchColor)
    }
    if (carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true
    if (personMesh.instanceColor) personMesh.instanceColor.needsUpdate = true
  }

  // Allocate the instance colour buffers up front so they are never null later.
  writeColors(0)
  appliedNight = 0

  function sync(state: CityState, derived: Derived, net: RoadNetwork): void {
    network = net

    let buildings = 0
    for (let i = 0; i < TILE_COUNT; i++) {
      const b = state.grid[i]
      if (b) buildings++
      clearance[i] = b ? CLEARANCE[b.type] : OPEN_CLEARANCE
    }

    // An empty city has no streets at all, and shows nobody. Beyond that the
    // network's own size is a ceiling: three segments of road with a dozen cars
    // on them would read as a traffic jam, not as a quiet town.
    const segments = net.segmentCount
    const wantCars =
      segments === 0 ? 0 : Math.min(CAR_CAPACITY, segments, Math.round(buildings * CARS_PER_BUILDING))
    const wantPeople =
      segments === 0
        ? 0
        : Math.min(PERSON_CAPACITY, segments * 2, Math.round(derived.population * PEOPLE_PER_POP))

    carCount = reseat(cars, wantCars)
    personCount = reseat(people, wantPeople)

    carMesh.count = carCount
    lightMesh.count = carCount
    personMesh.count = personCount
  }

  /**
   * Bring the first `want` slots onto live segments. The network can change
   * under a moving agent — a demolished building takes its seams with it — so
   * an agent whose corner no longer carries a street is dropped somewhere that
   * does rather than left walking through empty ground.
   */
  function reseat(agents: Agent[], want: number): number {
    const net = network
    if (!net || want <= 0) return 0
    let live = 0
    for (let i = 0; i < want; i++) {
      const a = agents[i]
      if (onLiveSegment(net, a)) {
        // The segment survived, but the corner it was heading for may have lost
        // the street beyond it, and the park it was avoiding may be gone.
        planNext(a, net, clearance)
        live++
      } else if (seed(net, a, clearance)) live++
      else break // no streets at all; nothing after this can be seeded either
    }
    return live
  }

  function advance(a: Agent, dt: number): void {
    const net = network
    if (!net) return
    a.t += a.speed * dt
    let guard = 0
    while (a.t >= 1 && guard++ < 4) {
      if (a.next < 0) {
        // The corner lost its last street between syncs. Start over elsewhere.
        if (!seed(net, a, clearance)) a.t = 0
        return
      }
      enterSegment(a, net, a.to, a.next, a.t - 1, true, clearance)
    }
    if (a.t >= 1) a.t = a.t % 1
  }

  /** Compose one agent's matrix into scratchMatrix. */
  function poseAgent(a: Agent, bobY: number, roll: number): void {
    // The lane is an offset along the segment's normal, and both the normal and
    // the offset change at a junction. Blending them across a window straddling
    // the corner does three jobs at once: it rounds the turn, it keeps the path
    // continuous (at t = 0 the blend still reads exactly the previous lane's
    // position), and it gets a lane change finished before the corner rather
    // than after it. A half-turn blend also shortens the offset mid-corner,
    // which pulls the arc in towards the junction — free apex.
    let w = 0
    let cut = 1
    let ax = a.rx * a.lateral
    let az = a.rz * a.lateral
    let ayaw = a.yaw
    let bx = ax
    let bz = az
    let byaw = ayaw
    if (a.t < HALF_TURN) {
      // Just out of a junction: finish the swing that started before it.
      w = 0.5 + 0.5 * smoothstep(0, 1, a.t / HALF_TURN)
      ax = a.prx * a.plat
      az = a.prz * a.plat
      ayaw = a.pyaw
      cut = a.cutIn
    } else if (a.t > 1 - HALF_TURN) {
      // Approaching one: start it.
      w = 0.5 * smoothstep(0, 1, (a.t - (1 - HALF_TURN)) / HALF_TURN)
      bx = a.nrx * a.nlat
      bz = a.nrz * a.nlat
      byaw = a.nyaw
      cut = a.cutOut
    }
    // Full at the edges of the window, tightest at the junction itself, so a
    // clamped apex never shows up as a kink where the blend starts.
    const k = cut < 1 ? 1 - (1 - cut) * (1 - Math.abs(2 * w - 1)) : 1

    const along = a.t * a.len
    scratchPos.set(
      a.fx + a.dirX * along + (ax + (bx - ax) * w) * k,
      SURFACE_Y + bobY,
      a.fz + a.dirZ * along + (az + (bz - az) * w) * k,
    )

    const yaw = w > 0 ? ayaw + angleDelta(ayaw, byaw) * w : a.yaw
    scratchEuler.set(roll, yaw, 0)
    scratchQuat.setFromEuler(scratchEuler)
    scratchScale.setScalar(a.scale)
    scratchMatrix.compose(scratchPos, scratchQuat, scratchScale)
  }

  function frame(dt: number, night: number): void {
    // A hidden tab hands back an enormous dt on the first frame. Clamp it, or
    // every agent teleports several junctions at once.
    const d = dt > 0 ? Math.min(dt, 0.1) : 0

    if (network && carCount > 0) {
      for (let i = 0; i < carCount; i++) {
        const a = cars[i]
        advance(a, d)
        poseAgent(a, 0, 0)
        carMesh.setMatrixAt(i, scratchMatrix)
        lightMesh.setMatrixAt(i, scratchMatrix)
      }
      carMesh.instanceMatrix.needsUpdate = true
      lightMesh.instanceMatrix.needsUpdate = true
    }

    if (network && personCount > 0) {
      for (let i = 0; i < personCount; i++) {
        const a = people[i]
        advance(a, d)
        // A gait, not a bounce: 5 mm of rise on a 118 mm figure, and about
        // five degrees of sway. This is a calm game.
        a.phase += d * a.speed * 16
        if (a.phase > TWO_PI) a.phase -= TWO_PI
        const bob = 0.0028 * (1 - Math.cos(a.phase * 2))
        const roll = 0.09 * Math.sin(a.phase)
        poseAgent(a, bob, roll)
        personMesh.setMatrixAt(i, scratchMatrix)
      }
      personMesh.instanceMatrix.needsUpdate = true
    }

    if (Math.abs(night - appliedNight) > 0.004) {
      writeColors(night)
      appliedNight = night
    }

    // Headlights come up through dusk rather than switching on at a threshold.
    // Every car shares one intensity, so this is a material colour rather than
    // 24 identical instance colours.
    const beam = smoothstep(0.16, 0.55, night)
    if (Math.abs(beam - appliedBeam) > 0.004) {
      lightMaterial.color.copy(headlightColor).multiplyScalar(beam)
      appliedBeam = beam
    }
    lightMesh.visible = beam > 0.01 && carCount > 0
  }

  function dispose(): void {
    group.remove(carMesh, lightMesh, personMesh)
    group.clear()
    carMesh.dispose()
    lightMesh.dispose()
    personMesh.dispose()
    carGeometry.dispose()
    lightGeometry.dispose()
    personGeometry.dispose()
    bodyMaterial.dispose()
    lightMaterial.dispose()
    network = null
    carCount = 0
    personCount = 0
  }

  return { sync, frame, object: group, dispose }
}
