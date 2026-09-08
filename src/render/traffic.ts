/**
 * Ambient life: cars, buses and pedestrians walking the street network.
 *
 * Sized against the camera rather than against the tiles. The rig frames the
 * owned plot, so a new 6x6 city sits 15.2 units out and a full board 24.9; at
 * 1440x900 with a 35 degree vertical FOV that is 94 and 57 pixels per world
 * unit. A 0.18 car was 17 x 6 px on a new city and 10 x 3.5 px on a grown one,
 * which is not a car, it is a smudge. So: a car is 0.24 x 0.08 x 0.10 and a
 * person 0.16 tall — still toy-scale against a 0.55 house, still nothing like
 * real proportions against a 1.0 tile, but half again the silhouette.
 *
 * Size alone does not save it, because 1.4x of nothing is nothing. Two other
 * things carry the readability at distance: colours deep enough to separate
 * from pale tarmac in *value* rather than pastels that sit on top of it, and a
 * soft contact shadow under every agent. The shadow is the single biggest win —
 * 14 x 9 px of dark under a car whose own body is 61 px of mid-tone — and it
 * doubles as the ground anchor that castShadow being off would otherwise cost.
 *
 * The cost of the size is paid entirely in the lane maths below, which is why
 * the width of a car is a load-bearing constant and its length is not.
 *
 * Three fixed-capacity agent pools carry the whole system: 24 cars, 8 buses
 * and 48 people, allocated once at construction with `count` set to however
 * many are currently live. Population and building count drive that number, so
 * an empty plot is silent, a young city has one car pottering about, and a full
 * one is busy. Nothing is allocated per frame — every matrix, quaternion and
 * colour is a hoisted scratch object.
 *
 * Buses are the third pool and share every line of the machinery below: same
 * corner walk, same lane picker, same clearance table, same turn blend. What
 * makes them read as public transport rather than as large cars is entirely in
 * the constants — half a car again in length, half again in height, a flat roof
 * where a car has a stepped cabin, a pale near-uniform livery where the cars
 * are a box of painted tin toys, and two thirds the speed. Nothing about them
 * needed new behaviour, and giving them any would have been a way to get them
 * floating through a park lawn that the cars already know to avoid.
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
  MultiplyBlending,
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
const BUS_CAPACITY = 8
const PERSON_CAPACITY = 48

/** Tiles per second. A segment is one tile, so this is also segments/second. */
const CAR_SPEED = 1.6
/**
 * Two thirds of a car. Speed is the cheapest of the three signals that say
 * "bus" — a vehicle being overtaken is legible at ten pixels where a roofline
 * is not — and it is also the one that keeps a 0.36 body from looking like it
 * is being flung round the corners the lane blend rounds off for it.
 */
const BUS_SPEED = 1.1
const PERSON_SPEED = 0.5
/** Multiplicative spread either side of the base speed, so nothing convoys. */
const SPEED_JITTER = 0.22

/** Cars per building, people per head of population. Both clamp to capacity. */
const CARS_PER_BUILDING = 0.3
const PEOPLE_PER_POP = 0.26
/**
 * Buses per head of population. A tenth of the pedestrian rate and an order
 * below the cars: the first bus arrives at about seventeen population, which is
 * four or five houses, and a full plot runs five or six. Buses are the rarest
 * thing on the street on purpose — a bus every few seconds reads as a city, and
 * a bus every few tiles reads as a depot.
 */
const BUSES_PER_POP = 0.03

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
 * How long an agent takes to step across when the ground beside it changes.
 * Tuned against render/buildings, which grows a new building from nothing over
 * 400ms and is most of the way there by 260: the pedestrian is out of the way
 * at about the moment the lawn arrives under him, so what reads is somebody
 * stepping aside for it rather than either a teleport or a burial.
 */
const LANE_FIX_SECONDS = 0.28

/**
 * Lateral offset from the centre line, in tiles. Measured against what is
 * actually there rather than chosen by taste: render/roads lays 0.2 of tarmac,
 * so the road runs to 0.1 either side of the seam, and a car is 0.086 wide. At
 * 0.05 a car sits wholly on its own half of the tarmac and never crosses the
 * centre line, so oncoming traffic passes clean.
 *
 * That uses the road up. Pedestrians therefore walk the kerb strip beyond it,
 * from 0.125 to 0.145, which clears the car's flank and — via the clearance
 * table below — out of the walls behind them. The one thing sharing that strip
 * is render/roads' lamp posts at 0.105; a pedestrian will occasionally clip one,
 * which is a graze against a 0.034-wide stick and the cheapest of the things
 * that could have given here.
 */
const CAR_LANE = 0.05
const PERSON_LANE_MIN = 0.125
const PERSON_LANE_MAX = 0.145
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
  station: 0.14, // platform runs wide, but the canopy is overhead
}
/** An empty tile takes nothing; an agent may hang over bare ground. */
const OPEN_CLEARANCE = 0.5

/** Half-widths, taken at the largest per-instance scale rather than the mean. */
const CAR_HALF = 0.042
const BUS_HALF = 0.048
const PERSON_HALF = 0.032

const CAR_LENGTH = 0.24
/**
 * The one dimension that is not free. Length and height cost nothing in the
 * street corridor, but width is spent against the clearance table: a park's
 * lawn leaves 0.04 either side of the seam, so a car wider than 0.08 could not
 * be kept out of one where parks face each other across a street. Length and
 * height took the whole increase instead, which is also where the silhouette
 * is, and the car ends up a shade narrow at 3:1 — invisible at 15 pixels.
 */
const CAR_WIDTH = 0.08

/**
 * A bus is half a car again in every direction that is free, and a hair more
 * in the one that is not.
 *
 * Length and height cost nothing in the street corridor, so they take the whole
 * difference: 0.36 against the car's 0.24, and 0.146 tall against 0.10, which
 * is what a flat roof half again the height of a car's is for. Width is the
 * expensive one. The tarmac runs to 0.1 either side of the seam and a bus rides
 * the same 0.05 lane the cars do. The body is 0.09, the glazing band stands two
 * thousandths proud of it either side, and the largest instance is 1.02 of
 * that: 0.048 of half-width, so the flank lands at 0.098 — two thousandths
 * inside the kerb, and still clear of the oncoming lane. A millimetre more and
 * buses would be straddling the centre line on every street in the city rather
 * than only beside the parks, where the clearance table pulls everything to the
 * middle anyway.
 */
const BUS_LENGTH = 0.36
const BUS_WIDTH = 0.09
const BUS_HEIGHT = 0.146

const PERSON_HEIGHT = 0.16
const PERSON_WIDTH = 0.056

/** Contact shadows: half-extents, and how dark the centre goes. */
const CAR_SHADOW_R = 0.062
const CAR_SHADOW_STRETCH = 2
const BUS_SHADOW_R = 0.056
const BUS_SHADOW_STRETCH = 3.3
const PERSON_SHADOW_R = 0.042
const CAR_SHADOW_DARK = 0.55
const BUS_SHADOW_DARK = 0.5
const PERSON_SHADOW_DARK = 0.6
/** Just clear of the tarmac at 0.012, and biased forward besides. */
const SHADOW_Y = 0.016

// ---------------------------------------------------------------------------
// Colour. palette.ts owns the city's identity; these are the two small sets it
// has no reason to know about, so they live here rather than in the contract.
// ---------------------------------------------------------------------------

/**
 * Painted tin toys, not car paint and not pastels either. The pastels these
 * replaced were the real reason the traffic vanished at distance: render/roads
 * lays tarmac at 0x9d978d, and a 0xd8a9a1 car against it differs by about four
 * percent of value. At ten pixels, value separation is the only thing the eye
 * has left, so every entry here is pushed well clear of the tarmac — and
 * deliberately in both directions, some darker and some lighter, so the traffic
 * never reads as one uniform band of dark specks.
 */
const CAR_COLORS = [
  0xb5544a, // terracotta
  0x3f6f9c, // denim
  0xdcb84f, // mustard
  0x4a7f5e, // pine
  0x8a5f8e, // plum
  0xc55f2e, // burnt orange
  0xefe6d2, // cream, the light one
  0x39434f, // slate, the dark one
]

/**
 * Bus livery. The one place buses go the opposite way from everything else in
 * this file: pale, low-saturation and nearly uniform, where the cars are deep
 * and deliberately mismatched. That contrast is the point — a box of painted
 * tin toys with three pale fleet-liveried vehicles moving slowly through it
 * reads as public transport without a single decal — and the value separation
 * the cars had to fight for comes free here, because all three sit clearly
 * LIGHTER than the 0x9d978d tarmac rather than darker. The dark glazing band
 * and the dark wheels supply the internal contrast that keeps a pale body from
 * flattening into one blob.
 */
const BUS_COLORS = [
  0x9dc0b4, // pale sage-teal
  0xd9bd94, // pale caramel
  0xa8bad4, // pale periwinkle
]

/** A step gentler than the cars — there are twice as many of them. */
const PERSON_COLORS = [
  0xab5b53, 0x466a8e, 0xcfae57, 0x517f61,
  0x7f6288, 0xb96b42, 0xe6dcc8, 0x424b57,
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
 * A flat disc whose vertex colour fades from `centre` at the middle to `rim` at
 * the edge — a radial gradient for free, with no texture and no shader. Used
 * for the headlight pool (fading to nothing, added) and for contact shadows
 * (fading to white, multiplied), which are the same primitive read two ways.
 */
function fadedDisc(
  radius: number,
  segments: number,
  centre: number,
  rim: number,
  power: number,
): BufferGeometry {
  const disc = new CircleGeometry(radius, segments)
  const flat = disc.toNonIndexed()
  disc.dispose()
  const pos = flat.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const r = clamp01(Math.hypot(pos.getX(i), pos.getY(i)) / radius)
    const v = rim + (centre - rim) * (1 - r) ** power
    colors[i * 3] = v
    colors[i * 3 + 1] = v
    colors[i * 3 + 2] = v
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3))
  for (const name of Object.keys(flat.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') flat.deleteAttribute(name)
  }
  // Lay it on the ground, facing up.
  flat.rotateX(-Math.PI / 2)
  return flat
}

/**
 * The blob of shade an agent sits in. Not a shadow map — at this range a car
 * would be two texels of one — but the thing a shadow map would have bought:
 * a dark shape roughly the agent's footprint, which at ten pixels carries more
 * of the agent's presence than the agent does, and stops anything reading as
 * hovering now that castShadow is off.
 */
function buildShadowGeometry(radius: number, stretch: number, dark: number): BufferGeometry {
  const disc = fadedDisc(radius, 14, dark, 1, 1.3)
  if (stretch !== 1) disc.scale(stretch, 1, 1)
  return disc
}

/**
 * A toy car: forward is +x, base at y = 0. Three stacked boxes rather than a
 * literal rounded box — the chamfer between hull and shoulder is what reads as
 * roundness at this size, and it costs twelve triangles instead of a shader.
 */
function buildCarGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []

  const hull = new BoxGeometry(CAR_LENGTH, 0.036, CAR_WIDTH)
  hull.translate(0, 0.04, 0)
  parts.push(grey(hull, 1))

  const shoulder = new BoxGeometry(CAR_LENGTH - 0.018, 0.018, CAR_WIDTH - 0.01)
  shoulder.translate(-0.003, 0.067, 0)
  parts.push(grey(shoulder, 1))

  const cabin = new BoxGeometry(0.1, 0.024, CAR_WIDTH - 0.018)
  cabin.translate(-0.018, 0.088, 0)
  parts.push(grey(cabin, CABIN_RATIO))

  // Tucked inside the body: the wheels must not be what sets the car's width,
  // or the clearance table would be lying to the lane picker by 5 thousandths.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = new CylinderGeometry(0.02, 0.02, 0.013, 6)
      wheel.rotateX(Math.PI / 2)
      wheel.translate(sx * 0.074, 0.02, sz * 0.033)
      parts.push(grey(wheel, WHEEL_RATIO))
    }
  }

  return merge(parts)
}

/**
 * A bus: one long box with a flat cap on top, a dark glazing band running most
 * of its length and four wheels tucked inside the flanks.
 *
 * The silhouette is doing all the work. A car is three stacked boxes because a
 * stepped shoulder is what reads as a car at fifteen pixels; a bus is the
 * opposite shape and gets the opposite treatment — one unbroken slab and a flat
 * roof, so the two never resolve into the same blob at distance whatever
 * colours they happen to be wearing. The glazing band is the one detail that
 * survives the range, and it is the detail that says bus.
 */
function buildBusGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []

  const skirt = new BoxGeometry(BUS_LENGTH - 0.03, 0.02, BUS_WIDTH - 0.006)
  skirt.translate(0, 0.032, 0)
  parts.push(grey(skirt, 0.72))

  const body = new BoxGeometry(BUS_LENGTH, 0.094, BUS_WIDTH)
  body.translate(0, 0.085, 0)
  parts.push(grey(body, 1))

  // Two thousandths proud of the flanks, so the band never z-fights the body.
  const glazing = new BoxGeometry(BUS_LENGTH - 0.06, 0.034, BUS_WIDTH + 0.004)
  glazing.translate(0.004, 0.093, 0)
  parts.push(grey(glazing, 0.42))

  // Flat. A bus roof is the one surface this camera looks straight down on, so
  // it is also where the difference from a car is most visible.
  const roof = new BoxGeometry(BUS_LENGTH - 0.012, 0.014, BUS_WIDTH - 0.008)
  roof.translate(0, BUS_HEIGHT - 0.007, 0)
  parts.push(grey(roof, 0.88))

  // Inside the flanks, for the same reason the car's are: the clearance table
  // is checked against BUS_HALF, and a wheel sticking past it would make that
  // number a lie.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = new CylinderGeometry(0.021, 0.021, 0.013, 6)
      wheel.rotateX(Math.PI / 2)
      wheel.translate(sx * 0.115, 0.021, sz * 0.036)
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
    const head = new PlaneGeometry(0.036, 0.024)
    head.rotateY(Math.PI / 2)
    head.translate(CAR_LENGTH / 2 + 0.002, 0.056, sz * 0.024)
    parts.push(grey(head, 1))

    const tail = new PlaneGeometry(0.03, 0.02)
    tail.rotateY(-Math.PI / 2)
    tail.translate(-CAR_LENGTH / 2 - 0.002, 0.056, sz * 0.026)
    parts.push(paint(tail, TAILLIGHT_RATIO.r, TAILLIGHT_RATIO.g, TAILLIGHT_RATIO.b))
  }

  // The beam on the road. It rides just clear of the tarmac and its lane
  // markings, and is biased forward in the depth buffer besides, so it lies on
  // the road rather than fighting it.
  const beam = fadedDisc(0.075, 12, BEAM_STRENGTH, 0, 1.5)
  beam.scale(1.7, 1, 1)
  beam.translate(0.18, -SURFACE_Y + 0.021, 0)
  parts.push(beam)

  return merge(parts)
}

/**
 * The same for a bus, plus the thing a car does not get: a lit window band.
 * A bus after dark is a moving strip of warm light — it is the most recognisable
 * night-time silhouette on any street — and it costs two more planes on a mesh
 * that already exists. Dimmer than the lamps, so the headlights still lead.
 */
function buildBusLightGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []

  for (const sz of [-1, 1]) {
    const head = new PlaneGeometry(0.032, 0.022)
    head.rotateY(Math.PI / 2)
    head.translate(BUS_LENGTH / 2 + 0.002, 0.06, sz * 0.028)
    parts.push(grey(head, 1))

    const tail = new PlaneGeometry(0.028, 0.02)
    tail.rotateY(-Math.PI / 2)
    tail.translate(-BUS_LENGTH / 2 - 0.002, 0.06, sz * 0.03)
    parts.push(paint(tail, TAILLIGHT_RATIO.r, TAILLIGHT_RATIO.g, TAILLIGHT_RATIO.b))

    const windows = new PlaneGeometry(BUS_LENGTH - 0.07, 0.03)
    if (sz < 0) windows.rotateY(Math.PI)
    windows.translate(0.004, 0.093, sz * (BUS_WIDTH / 2 + 0.005))
    parts.push(grey(windows, 0.5))
  }

  const beam = fadedDisc(0.08, 12, BEAM_STRENGTH, 0, 1.5)
  beam.scale(1.7, 1, 1)
  beam.translate(0.24, -SURFACE_Y + 0.021, 0)
  parts.push(beam)

  return merge(parts)
}

/**
 * A person: a tapered six-sided body with a faceted head. Forward is +x.
 *
 * Taller than it has any business being — 0.16 against a 0.55 house is roughly
 * a real person against a real two-storey house, where the honest toy figure
 * this started as was 0.118. A tall thin silhouette is the only shape that
 * survives being seven pixels high, and the height is free: it is spent
 * upwards, where the street corridor charges nothing for it.
 */
function buildPersonGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []

  const half = PERSON_WIDTH / 2
  const body = new CylinderGeometry(half * 0.72, half, 0.108, 6)
  body.translate(0, 0.054, 0)
  parts.push(grey(body, 1))

  const head = new IcosahedronGeometry(0.024, 0)
  head.translate(0, PERSON_HEIGHT - 0.024, 0)
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

  /**
   * A lane the agent is easing onto, because the ground under it changed. The
   * rendered lane is `latFrom` moving to `lateral` as `latEase` runs 0 to 1.
   */
  latFrom: number
  latEase: number

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
    latFrom: 0,
    latEase: 1,
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

/** The lane actually being rendered, part-way through a correction. */
function shownLateral(a: Agent): number {
  if (a.latEase >= 1) return a.lateral
  return a.latFrom + (a.lateral - a.latFrom) * smoothstep(0, 1, a.latEase)
}

/**
 * The ground beside an agent changed under it. sync() only revalidates which
 * segment an agent is on, so without this a park dropped beside a street would
 * leave everyone already on that street walking through the new lawn until they
 * reached the next corner — two seconds for a pedestrian, and parks are placed
 * by hand, so it is the player who would watch it happen. Snapping to the new
 * lane instead would teleport them a quarter of a tile sideways, which at this
 * framing is twenty-six pixels. So: step across, over a third of a second.
 */
function refreshLane(a: Agent, clear: Float32Array): void {
  if (a.from < 0 || a.to < 0) return
  const shown = shownLateral(a)
  computeLane(a, a.from, a.to, clear, laneScratch)
  if (Math.abs(laneScratch.lateral - a.lateral) < 1e-6) return
  a.latFrom = shown
  a.lateral = laneScratch.lateral
  a.latEase = 0
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
    // The shown lane, not the target: a correction still in flight is where the
    // agent actually is, and that is what the junction blend has to start from.
    a.plat = shownLateral(a)
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
  a.latFrom = laneScratch.lateral
  a.latEase = 1

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
const scratchShadow = new Matrix4()
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

  // Multiplied rather than drawn: the blob darkens whatever ground it lies on,
  // so it works over tarmac, kerb and tinted plate alike without ever having to
  // know what colour that ground is. Fog is left on, which lifts distant
  // shadows towards the sky exactly as it lifts everything else.
  const shadowMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: MultiplyBlending,
    // three.js warns on every frame without this: a multiply blend expects its
    // source alpha already folded into the colour.
    premultipliedAlpha: true,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })

  const carGeometry = buildCarGeometry()
  const lightGeometry = buildLightGeometry()
  const busGeometry = buildBusGeometry()
  const busLightGeometry = buildBusLightGeometry()
  const personGeometry = buildPersonGeometry()
  const carShadowGeometry = buildShadowGeometry(CAR_SHADOW_R, CAR_SHADOW_STRETCH, CAR_SHADOW_DARK)
  const busShadowGeometry = buildShadowGeometry(BUS_SHADOW_R, BUS_SHADOW_STRETCH, BUS_SHADOW_DARK)
  const personShadowGeometry = buildShadowGeometry(PERSON_SHADOW_R, 1, PERSON_SHADOW_DARK)

  const carMesh = new InstancedMesh(carGeometry, bodyMaterial, CAR_CAPACITY)
  const lightMesh = new InstancedMesh(lightGeometry, lightMaterial, CAR_CAPACITY)
  const busMesh = new InstancedMesh(busGeometry, bodyMaterial, BUS_CAPACITY)
  const busLightMesh = new InstancedMesh(busLightGeometry, lightMaterial, BUS_CAPACITY)
  const personMesh = new InstancedMesh(personGeometry, bodyMaterial, PERSON_CAPACITY)
  const carShadowMesh = new InstancedMesh(carShadowGeometry, shadowMaterial, CAR_CAPACITY)
  const busShadowMesh = new InstancedMesh(busShadowGeometry, shadowMaterial, BUS_CAPACITY)
  const personShadowMesh = new InstancedMesh(personShadowGeometry, shadowMaterial, PERSON_CAPACITY)

  const meshes = [
    carMesh, lightMesh, busMesh, busLightMesh, personMesh,
    carShadowMesh, busShadowMesh, personShadowMesh,
  ]
  for (const mesh of meshes) {
    mesh.count = 0
    // Instances range over the whole plot; the meshes' own bounds are one agent.
    mesh.frustumCulled = false
    // Too small to resolve in a shadow map covering the plot, so they only
    // receive. A car casting a two-texel smudge costs a pass and buys nothing.
    mesh.castShadow = false
    mesh.receiveShadow = true
  }
  for (const mesh of [lightMesh, busLightMesh]) {
    mesh.receiveShadow = false
    mesh.renderOrder = 6
    mesh.visible = false
  }
  for (const mesh of [carShadowMesh, busShadowMesh, personShadowMesh]) {
    mesh.receiveShadow = false
    // Over the road, under the headlight beams.
    mesh.renderOrder = 3
  }
  group.add(...meshes)

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
    // Narrower band than the pedestrians get: CAR_HALF is the widest instance,
    // and the widest instance is what the park clearance is checked against.
    a.scale = 0.95 + 0.1 * hash01(i + 311)
    cars.push(a)
    carColors.push(
      new Color().setHex(CAR_COLORS[(i * 5 + 1) % CAR_COLORS.length], SRGBColorSpace),
    )
  }

  const buses: Agent[] = []
  const busColors: Color[] = []
  for (let i = 0; i < BUS_CAPACITY; i++) {
    const a = makeAgent()
    // A narrower speed band than the cars get. Buses that spread as widely as
    // the traffic does would have one crawling and one keeping up with a car,
    // and the whole point of the number is that a bus is the slow thing.
    a.speed = BUS_SPEED * (0.92 + 0.16 * hash01(i + 20011))
    // Same hand as the cars, and the same lane: a bus in the oncoming lane is
    // not a bus, it is a bug.
    a.laneMag = CAR_LANE
    a.laneSign = 1
    a.halfWidth = BUS_HALF
    // Barely any. BUS_HALF is quoted at the largest instance, and every extra
    // percent of scale is another percent of body hanging over the kerb.
    a.scale = 0.98 + 0.04 * hash01(i + 40009)
    buses.push(a)
    busColors.push(
      new Color().setHex(BUS_COLORS[(i * 2 + 1) % BUS_COLORS.length], SRGBColorSpace),
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
  let busCount = 0
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
    for (let i = 0; i < BUS_CAPACITY; i++) {
      // The smallest lift of the three. A bus livery is already pale, and
      // lifting it as hard as a car's would push it to white after dark and
      // take the glazing band with it.
      scratchColor.copy(busColors[i]).multiplyScalar(1 + 0.12 * night)
      busMesh.setColorAt(i, scratchColor)
    }
    for (let i = 0; i < PERSON_CAPACITY; i++) {
      scratchColor.copy(personColors[i]).multiplyScalar(1 + 0.36 * night)
      personMesh.setColorAt(i, scratchColor)
    }
    if (carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true
    if (busMesh.instanceColor) busMesh.instanceColor.needsUpdate = true
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
    // A quarter of the segment ceiling the cars get, and a hard zero with no
    // streets: a bus needs somewhere to be going, and four seams is the least
    // that reads as a route rather than as a vehicle circling one block.
    const wantBuses =
      segments === 0
        ? 0
        : Math.min(
            BUS_CAPACITY,
            Math.floor(segments / 4),
            Math.round(derived.population * BUSES_PER_POP),
          )
    const wantPeople =
      segments === 0
        ? 0
        : Math.min(PERSON_CAPACITY, segments * 2, Math.round(derived.population * PEOPLE_PER_POP))

    carCount = reseat(cars, wantCars)
    busCount = reseat(buses, wantBuses)
    personCount = reseat(people, wantPeople)

    carMesh.count = carCount
    lightMesh.count = carCount
    carShadowMesh.count = carCount
    busMesh.count = busCount
    busLightMesh.count = busCount
    busShadowMesh.count = busCount
    personMesh.count = personCount
    personShadowMesh.count = personCount
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
        // The segment survived, but the ground beside it may not have: the
        // corner it was heading for can have lost the street beyond it, and the
        // park it was giving way to can have been demolished, or just built.
        refreshLane(a, clearance)
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
    if (a.latEase < 1) a.latEase = Math.min(1, a.latEase + dt / LANE_FIX_SECONDS)
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
    const lateral = shownLateral(a)
    let w = 0
    let cut = 1
    let ax = a.rx * lateral
    let az = a.rz * lateral
    let ayaw = a.yaw
    let bx = ax
    let bz = az
    let byaw = ayaw
    // The segment on the other side of the blend, whichever side that is.
    let onx = a.rx
    let onz = a.rz
    let olat = lateral
    if (a.t < HALF_TURN) {
      // Just out of a junction: finish the swing that started before it.
      w = 0.5 + 0.5 * smoothstep(0, 1, a.t / HALF_TURN)
      ax = a.prx * a.plat
      az = a.prz * a.plat
      ayaw = a.pyaw
      cut = a.cutIn
      onx = a.prx
      onz = a.prz
      olat = a.plat
    } else if (a.t > 1 - HALF_TURN) {
      // Approaching one: start it.
      w = 0.5 * smoothstep(0, 1, (a.t - (1 - HALF_TURN)) / HALF_TURN)
      bx = a.nrx * a.nlat
      bz = a.nrz * a.nlat
      byaw = a.nyaw
      cut = a.cutOut
      onx = a.nrx
      onz = a.nrz
      olat = a.nlat
    }
    // Full at the edges of the window, tightest at the junction itself, so a
    // clamped apex never shows up as a kink where the blend starts.
    const k = cut < 1 ? 1 - (1 - cut) * (1 - Math.abs(2 * w - 1)) : 1

    let ox = (ax + (bx - ax) * w) * k
    let oz = (az + (bz - az) * w) * k

    // Blending two lanes is not automatically safe. Where the segments turn,
    // their normals are perpendicular and the blend only ever moves the agent
    // ALONG the street, which is the arc and is free. Where they run straight
    // on, both lanes are measured against the same axis, and easing from a wide
    // lane into a tight one would spend the first fifth of the tight segment
    // still out in the wide one — half a second of pedestrian inside a park
    // lawn, four pixels of it, which is exactly the artefact the lane picker
    // exists to prevent. So near a junction the shared axis is held to whatever
    // both segments allow: the tighter lane when they agree on a side, and the
    // centre line when they disagree. Both are symmetric about the junction, so
    // the path stays continuous through it.
    let lo = Math.min(0, lateral)
    let hi = Math.max(0, lateral)
    const dot = a.rx * onx + a.rz * onz
    if (dot !== 0) {
      // Weighted by nearness to the junction, exactly like the apex clamp: full
      // at the corner, gone by the edge of the window where the agent is alone
      // on its own segment again. Applying it flat across the window instead
      // would snap the offset back a whole lane the instant the window ended.
      const g = 1 - Math.abs(2 * w - 1)
      const other = dot * olat
      lo += (Math.max(lo, Math.min(0, other)) - lo) * g
      hi += (Math.min(hi, Math.max(0, other)) - hi) * g
    }
    const proj = ox * a.rx + oz * a.rz
    const held = proj < lo ? lo : proj > hi ? hi : proj
    if (held !== proj) {
      ox += a.rx * (held - proj)
      oz += a.rz * (held - proj)
    }

    const along = a.t * a.len
    scratchPos.set(a.fx + a.dirX * along + ox, SURFACE_Y + bobY, a.fz + a.dirZ * along + oz)

    const yaw = w > 0 ? ayaw + angleDelta(ayaw, byaw) * w : a.yaw
    scratchScale.setScalar(a.scale)

    // The shadow stays flat on the road and ignores the walk cycle: shade does
    // not bob, and a blob that did would undo the anchoring it is there for.
    scratchEuler.set(0, yaw, 0)
    scratchQuat.setFromEuler(scratchEuler)
    const y = scratchPos.y
    scratchPos.y = SHADOW_Y
    scratchShadow.compose(scratchPos, scratchQuat, scratchScale)

    scratchPos.y = y
    if (roll !== 0) {
      scratchEuler.set(roll, yaw, 0)
      scratchQuat.setFromEuler(scratchEuler)
    }
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
        carShadowMesh.setMatrixAt(i, scratchShadow)
      }
      carMesh.instanceMatrix.needsUpdate = true
      lightMesh.instanceMatrix.needsUpdate = true
      carShadowMesh.instanceMatrix.needsUpdate = true
    }

    if (network && busCount > 0) {
      for (let i = 0; i < busCount; i++) {
        const a = buses[i]
        advance(a, d)
        poseAgent(a, 0, 0)
        busMesh.setMatrixAt(i, scratchMatrix)
        busLightMesh.setMatrixAt(i, scratchMatrix)
        busShadowMesh.setMatrixAt(i, scratchShadow)
      }
      busMesh.instanceMatrix.needsUpdate = true
      busLightMesh.instanceMatrix.needsUpdate = true
      busShadowMesh.instanceMatrix.needsUpdate = true
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
        personShadowMesh.setMatrixAt(i, scratchShadow)
      }
      personMesh.instanceMatrix.needsUpdate = true
      personShadowMesh.instanceMatrix.needsUpdate = true
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
    busLightMesh.visible = beam > 0.01 && busCount > 0
  }

  function dispose(): void {
    group.remove(...meshes)
    group.clear()
    for (const mesh of meshes) mesh.dispose()
    carGeometry.dispose()
    lightGeometry.dispose()
    busGeometry.dispose()
    busLightGeometry.dispose()
    personGeometry.dispose()
    carShadowGeometry.dispose()
    busShadowGeometry.dispose()
    personShadowGeometry.dispose()
    bodyMaterial.dispose()
    lightMaterial.dispose()
    shadowMaterial.dispose()
    network = null
    carCount = 0
    busCount = 0
    personCount = 0
  }

  return { sync, frame, object: group, dispose }
}
