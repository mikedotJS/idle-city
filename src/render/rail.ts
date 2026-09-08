/**
 * The railway: track laid on the corner lattice, and one small train shuttling
 * each leg of the line.
 *
 * Track shares its coordinate system with the streets — `sim/rail` walks the
 * same corner lattice `sim/roads` does, one axis-aligned tile per segment — so
 * everything here is the road renderer's geometry problem read one layer up.
 * Three things are different, and each of them is the reason a rule exists:
 *
 * 1. Track is NARROWER than tarmac. render/roads lays 0.2 of a 1.0 tile and
 *    calls the ground tint the game's user interface; a railway that took the
 *    same bite would be a second ribbon competing with the readout. So the
 *    sleepers run 0.14 across and the rails sit on a 0.09 gauge inside them,
 *    which is a third less ink for a shape that still reads as track because
 *    the sleeper rhythm carries it at distance rather than the width.
 *
 * 2. Track is ABOVE tarmac rather than beside it. Rail and road use the same
 *    lattice, so a leg between two stations can and does run down a street.
 *    Sleepers sit 0..0.016 and rails 0.014..0.030 against the road surface at
 *    0.012, which puts the rail head a clear 18 thousandths proud of the
 *    tarmac: where the two coincide it reads as street-running tramway, which
 *    is a real thing that looks deliberate, and nowhere does it z-fight.
 *
 * 3. Track may cross water AND rock, which roads may not, and that permission
 *    is the whole reason `sim/rail` exists in the shape it does.
 *
 *    Over water: a segment with a water tile on either flank gets a deck under
 *    the sleepers and a pier down into the lake — a low bridge, flat, no ramps.
 *    render/terrain draws the still surface at -0.05 and ripples it by 0.014,
 *    so the deck soffit at -0.02 keeps daylight under it at a wave crest.
 *
 *    Over rock: the track CLIMBS. render/terrain builds its peaks as tents
 *    fanning from an off-centre summit to the four shared lattice corners, and
 *    the edge between two of those corners is a straight line — the boundary
 *    edge of the fan. That is the same lattice edge a rail segment runs along,
 *    so lifting each rail end to the corner height that file computes puts the
 *    track exactly on the rock rather than through it, with no interpolation
 *    error anywhere between. `cornerLift` below reproduces that rule; it must
 *    stay in step with render/terrain's `cornerHeight`, jitter included, or the
 *    track sinks in.
 *
 *    Measured over 200 seeds, running a line between the plain tiles nearest
 *    opposite board corners: a third of lines touch rock, and the segments that
 *    are actually on a grade rise a median 0.063 per tile (4 degrees), 0.284 at
 *    the 90th percentile (16 degrees) and 0.617 at the very worst (32 degrees).
 *    A 32-degree pitch is a rack railway, but it is one segment in a hundred
 *    and it is on the flank of a peak, where the eye expects the line to be
 *    working hard. Nothing here needs an embankment or a tunnel mouth.
 *
 * Trains run by ARC LENGTH along the leg's corner path rather than by segment.
 * Every vehicle is placed by sampling two bogie points on that path and sitting
 * the body on the chord between them, so a carriage entering a corner swings
 * exactly the way the one in front of it did, one carriage-length later. A
 * rigid offset from the engine would cut every corner and is the single most
 * obvious way for a toy train to look broken.
 *
 * A leg is a shuttle: the consist keeps its orientation and reverses, so the
 * engine leads one way and propels the other. Nothing teleports and nothing
 * turns on the spot.
 *
 * Everything is rebuilt in sync(). frame() moves matrices and touches four
 * material colours, and allocates nothing.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
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
import { WORLD_SIZE } from '../sim/config'
import { tileIndex } from '../sim/grid'
import { computeRail } from '../sim/rail'
import { CORNER_COUNT, CORNERS_PER_SIDE, cornerIndex, cornerToWorld, cornerX, cornerZ } from '../sim/roads'
import { Terrain, terrainFor } from '../sim/terrain'
import type { TerrainMap } from '../sim/terrain'
import type { CityState } from '../sim/types'
import type { RailView } from './ambient-api'
import { clamp01, smoothstep, WINDOW_GLOW } from './palette'

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

/** Every lattice edge that could ever carry track: 2 * 12 * 13. The buffers are
 *  sized to that, so no rebuild can overflow them however the sim retunes. */
const MAX_SEGMENTS = 2 * WORLD_SIZE * (WORLD_SIZE + 1)
const SLEEPERS_PER_SEGMENT = 4

/** Distance between rail centres. Narrow enough that a train body at 0.11 wide
 *  overhangs it the way a real one does. */
const GAUGE = 0.09
const RAIL_W = 0.015
/** Rail foot and head. The foot overlaps the sleeper top by 2 thousandths so
 *  the rail sits ON the tie rather than hovering a hair above it. */
const RAIL_Y0 = 0.014
const RAIL_Y1 = 0.03

/** Sleeper: wider than the gauge, so the ties read as ties from above, and
 *  0.14 against the road's 0.2 keeps the whole track narrower than a street. */
const TIE_ACROSS = 0.14
const TIE_ALONG = 0.055
const TIE_H = 0.016

/**
 * Bridge deck over water. Proud of the plate tops by 8 thousandths, so it still
 * reads as a structure where it runs onto the land at either abutment, and its
 * soffit at -0.02 clears the lake with room to spare: render/terrain draws the
 * still surface at -0.05 and ripples it by 0.014, so there is 0.016 of daylight
 * under the deck even at the crest of a wave. Any lower and the bridge would
 * read as a causeway floating on the water, with the ripple poking through it.
 */
const DECK_W = 0.2
const DECK_Y1 = 0.008
const DECK_Y0 = -0.02
/**
 * One pier per segment, at its middle. It has to break the surface to read as a
 * pier rather than as a deck resting on nothing, and it has to end well below
 * it: the lake bed is the plate at -0.16, and a foot at -0.22 is buried in it
 * rather than stopping short in open water.
 *
 * Its geometry hangs from its own top rather than standing on its foot, so a
 * deck that has been lifted only has to scale the pier to reach back down to
 * the same absolute lake bed. Water and rock sit on opposite edges of the board
 * so a lifted bridge is close to impossible, but "close to" is not a reason for
 * the pier to detach from the deck if it ever happens.
 */
const PIER_W = 0.055
const PIER_Y0 = -0.22
const PIER_LEN = DECK_Y0 - PIER_Y0

/**
 * How much of a peak a shared lattice corner takes, by how many of its four
 * neighbouring tiles are mountain. Copied from render/terrain's CORNER_SHAPE,
 * because the track has to land on the rock that file actually draws and not on
 * a plausible reconstruction of it.
 */
const CORNER_SHAPE = [0, 0.4, 0.72, 0.9, 1]
/** The same file's per-corner jitter, reproduced bit for bit. */
const CORNER_JITTER = 0.045

// Trains --------------------------------------------------------------------

/** Tiles per second. A segment is one tile, so this is also segments/second —
 *  and it is deliberately 1.4x the cars at 1.6, which is what makes a train
 *  passing a street read as a train rather than as a long car. */
const TRAIN_SPEED = 2.2
const SPEED_JITTER = 0.06
/** Seconds standing at each terminus. The legs end on stations, so the pause is
 *  where the pause belongs, and it stops a short leg reading as a metronome. */
const DWELL = 1.6

const MAX_TRAINS = 16
const MAX_CARS_PER_TRAIN = 4
const VEHICLE_CAPACITY = MAX_TRAINS * MAX_CARS_PER_TRAIN

/**
 * One vehicle. The brief's 0.3 was set against a 0.18 car; render/traffic has
 * since taken the car to 0.24 for the same reason (a 0.18 body is ten pixels on
 * a grown city and stops being a shape at all), so the carriage follows it up
 * to 0.34 to keep the proportion that made 0.3 the right answer. Four of them
 * at a 0.38 pitch is 1.48 of train, which is a tile and a half — long enough
 * to be reading through a corner while its engine is already round it.
 */
const CAR_LEN = 0.34
const CAR_W = 0.11
const CAR_PITCH = 0.38
/** Half the bogie spacing. The body sits on the chord between the two bogies,
 *  so this also sets how much a vehicle cuts the inside of a corner: at 0.11 a
 *  vehicle on a right-angle bend leans into it by about 15 thousandths, which
 *  is the amount a real bogie vehicle does. */
const BOGIE_HALF = 0.11

/** Contact shadow, exactly the trick render/traffic uses: at this range a real
 *  shadow map would spend a pass to draw four texels of smudge. */
const SHADOW_R = 0.075
const SHADOW_STRETCH = 2.6
const SHADOW_DARK = 0.5
const SHADOW_Y = 0.017

/** How high the body rides. The underframe is authored from 0.026, so this puts
 *  it four thousandths onto the 0.030 rail head: the train sits on the track
 *  rather than hovering over it or sinking between the rails. */
const VEHICLE_Y = 0.004

// ---------------------------------------------------------------------------
// Colour. Muted and warm, and chosen for VALUE separation rather than hue:
// the ground ramp runs 0x6a615a to 0x9cbe86 and the tarmac sits at 0x9d978d,
// so anything in that band vanishes at fifteen pixels however pretty it is.
// ---------------------------------------------------------------------------

/** Worn steel, a touch lighter than the ties so the rails read as two lines. */
const RAIL_STEEL = 0x94908a
/** Creosoted timber. The darkest thing on the board at ground level, which is
 *  what gives the sleeper rhythm its contrast against sand and sage alike. */
const TIE_WOOD = 0x6a5c50
/** Bridge stonework: pale, warm, and lighter than the water it stands in. */
const BRIDGE_STONE = 0xada593

/** Engine: muted brick. Dark enough to hold against pale sand. */
const LOCO_BODY = 0x9a584c
/** Carriages: a dusty green that is cooler than everything on the ground ramp
 *  without being a saturated colour anywhere on the board. */
const CARRIAGE_BODY = 0x6f8a84

/** Darker parts, as plain multipliers on whatever livery an instance carries.
 *  One instance colour therefore paints a whole vehicle. */
const ROOF_RATIO = 0.66
const GLAZING_RATIO = 0.44
const UNDERFRAME_RATIO = 0.3

// ---------------------------------------------------------------------------
// Geometry helpers. Same shape as render/traffic's: a flat vertex colour that
// is a RATIO of the instance colour, so every part merges into one draw.
// ---------------------------------------------------------------------------

function paint(geom: BufferGeometry, v: number): BufferGeometry {
  const flat = geom.index ? geom.toNonIndexed() : geom
  if (flat !== geom) geom.dispose()
  const n = flat.getAttribute('position').count
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    colors[i * 3] = v
    colors[i * 3 + 1] = v
    colors[i * 3 + 2] = v
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3))
  for (const name of Object.keys(flat.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') flat.deleteAttribute(name)
  }
  return flat
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  if (!merged) throw new Error('render/rail: geometry merge failed')
  return merged
}

/** A box of the given size, centred in x and z and resting between y0 and y1. */
function slab(len: number, across: number, y0: number, y1: number): BufferGeometry {
  const box = new BoxGeometry(len, y1 - y0, across)
  box.translate(0, (y0 + y1) / 2, 0)
  return box
}

/**
 * A flat disc fading from `centre` at the middle to `rim` at the edge. The same
 * primitive render/traffic uses for its contact shadows, kept local rather than
 * imported so the two ambient layers stay independent of one another.
 */
function fadedDisc(radius: number, centre: number, rim: number): BufferGeometry {
  const disc = new CircleGeometry(radius, 14)
  const flat = disc.toNonIndexed()
  disc.dispose()
  const pos = flat.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const r = clamp01(Math.hypot(pos.getX(i), pos.getY(i)) / radius)
    const v = rim + (centre - rim) * (1 - r) ** 1.3
    colors[i * 3] = v
    colors[i * 3 + 1] = v
    colors[i * 3 + 2] = v
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3))
  for (const name of Object.keys(flat.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') flat.deleteAttribute(name)
  }
  flat.rotateX(-Math.PI / 2)
  return flat
}

/**
 * One vehicle. Forward is +x, ground at y = 0. Underframe, body, a painted
 * glazing band and a darker roof — four boxes, because at this size the band
 * between body and roof is most of what says "carriage" rather than "box".
 */
function buildVehicleGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []
  parts.push(paint(slab(CAR_LEN - 0.05, CAR_W - 0.03, 0.026, 0.04), UNDERFRAME_RATIO))
  parts.push(paint(slab(CAR_LEN, CAR_W, 0.038, 0.139), 1))
  // Proud of the flanks by two thousandths, so the band never z-fights the body.
  parts.push(paint(slab(CAR_LEN - 0.07, CAR_W + 0.004, 0.086, 0.116), GLAZING_RATIO))
  parts.push(paint(slab(CAR_LEN - 0.03, CAR_W - 0.012, 0.139, 0.153), ROOF_RATIO))
  return merge(parts)
}

/** The engine's cab, sat on top of an otherwise identical vehicle. */
function buildCabGeometry(): BufferGeometry {
  return paint(slab(0.12, CAR_W - 0.02, 0.153, 0.188), ROOF_RATIO * 1.25)
}

/**
 * Lit windows, drawn additively so they are light rather than paint — the same
 * treatment render/buildings gives its windows, and for the same reason: fog
 * would add its colour instead of fading towards it, and tone mapping would
 * flatten the one thing meant to read as a light source.
 */
function buildGlassGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []
  for (const sz of [-1, 1]) {
    const pane = new PlaneGeometry(CAR_LEN - 0.08, 0.03)
    if (sz < 0) pane.rotateY(Math.PI)
    pane.translate(0, 0.101, sz * (CAR_W / 2 + 0.004))
    parts.push(paint(pane, 1))
  }
  return merge(parts)
}

// ---------------------------------------------------------------------------
// Trains
// ---------------------------------------------------------------------------

/**
 * One shuttle. The path is held as flat coordinate arrays because sampling it
 * runs four times per vehicle per frame and a Vector3 per node would be pure
 * churn. Every segment on a corner path is exactly one tile long, so arc
 * distance and node index are the same number and sampling is a floor and a
 * lerp rather than a search.
 */
interface Train {
  px: Float32Array
  py: Float32Array
  pz: Float32Array
  /** Number of segments, i.e. the path's total arc length. */
  len: number
  vehicles: number
  /** First instance index this train owns in the vehicle meshes. */
  base: number
  /** Arc distance of the engine's centre. Carriages trail at lower distance. */
  u: number
  uMin: number
  uMax: number
  dir: number
  dwell: number
  speed: number
}

function makeTrain(): Train {
  return {
    px: new Float32Array(0),
    py: new Float32Array(0),
    pz: new Float32Array(0),
    len: 0,
    vehicles: 0,
    base: 0,
    u: 0,
    uMin: 0,
    uMax: 0,
    dir: 1,
    dwell: 0,
    speed: TRAIN_SPEED,
  }
}

/**
 * render/terrain's per-corner jitter, verbatim. Not the same hash as hash01
 * below and not interchangeable with it: this one has to agree with another
 * file's geometry to the millimetre, so it is copied rather than reinvented.
 */
function rockJitter(x: number, z: number, seed: number): number {
  let h = (x * 73856093 + z * 19349663 + seed * 83492791) | 0
  h = (h ^ (h >>> 13)) | 0
  h = Math.imul(h, 1274126177) | 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 - 0.5
}

/** Deterministic 0..1 from an index, so a rebuild does not reshuffle speeds. */
function hash01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

// Hoisted scratch: frame() runs sixty times a second and must not allocate.
const sampleAx = { x: 0, y: 0, z: 0 }
const sampleBx = { x: 0, y: 0, z: 0 }
const scratchPos = new Vector3()
const scratchQuat = new Quaternion()
const scratchScale = new Vector3(1, 1, 1)
/** Never written to. Track instances stretch their scale along the segment;
 *  vehicles must not accidentally inherit whatever the last one left behind. */
const UNIT_SCALE = new Vector3(1, 1, 1)
const scratchMatrix = new Matrix4()
const scratchShadow = new Matrix4()
const flatQuat = new Quaternion()
const pitchQuat = new Quaternion()
const Y_AXIS = new Vector3(0, 1, 0)
const Z_AXIS = new Vector3(0, 0, 1)

/**
 * Point a part's local +x along a 3D direction and return the length of that
 * direction. Yaw about world Y first, then pitch about the part's own local +z,
 * which after the yaw is the horizontal axis across the track — so the part
 * tilts along the grade and never rolls. Returns the 3D length, which is what a
 * rail spanning a climbing segment has to be scaled to; the horizontal length
 * is still 1, so everything measured in tiles stays measured in tiles.
 */
function orient(dx: number, dy: number, dz: number, out: Quaternion): number {
  const flat = Math.hypot(dx, dz)
  out.setFromAxisAngle(Y_AXIS, Math.atan2(-dz, dx))
  if (dy !== 0) {
    pitchQuat.setFromAxisAngle(Z_AXIS, Math.atan2(dy, flat))
    out.multiply(pitchQuat)
  }
  return Math.hypot(flat, dy)
}

/**
 * A point on the path by arc distance. Arc distance is measured in the XZ plane
 * — every corner segment is exactly one tile long there whatever the rock under
 * it does — so the index is a floor and the position is one lerp. Height rides
 * along as a third channel, which means a train on a grade covers its tiles at
 * the stated speed and its 3D speed runs a little ahead of it. At the median
 * four degrees that is a quarter of a percent, and at the worst thirty-two it
 * is eighteen; nobody is going to time it up a mountain.
 */
function sampleAt(train: Train, d: number, out: { x: number; y: number; z: number }): void {
  const clamped = d < 0 ? 0 : d > train.len ? train.len : d
  let i = Math.floor(clamped)
  if (i >= train.len) i = train.len - 1
  const f = clamped - i
  const ax = train.px[i]
  const ay = train.py[i]
  const az = train.pz[i]
  out.x = ax + (train.px[i + 1] - ax) * f
  out.y = ay + (train.py[i + 1] - ay) * f
  out.z = az + (train.pz[i + 1] - az) * f
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export function createRailView(): RailView {
  const group = new Group()
  group.name = 'rail'

  // --- materials -----------------------------------------------------------

  const railMaterial = new MeshStandardMaterial({ roughness: 0.62, metalness: 0.1 })
  const tieMaterial = new MeshStandardMaterial({ roughness: 0.95, metalness: 0 })
  const stoneMaterial = new MeshStandardMaterial({ roughness: 0.9, metalness: 0 })
  const bodyMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    metalness: 0,
    flatShading: true,
  })
  const glassMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    toneMapped: false,
  })
  const shadowMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: MultiplyBlending,
    // Multiply blending expects source alpha already folded into the colour;
    // three warns every frame without this.
    premultipliedAlpha: true,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })

  const railBase = new Color().setHex(RAIL_STEEL, SRGBColorSpace)
  const tieBase = new Color().setHex(TIE_WOOD, SRGBColorSpace)
  const stoneBase = new Color().setHex(BRIDGE_STONE, SRGBColorSpace)
  const locoColor = new Color().setHex(LOCO_BODY, SRGBColorSpace)
  const carriageColor = new Color().setHex(CARRIAGE_BODY, SRGBColorSpace)
  const glowColor = new Color().setRGB(WINDOW_GLOW[0], WINDOW_GLOW[1], WINDOW_GLOW[2], SRGBColorSpace)

  // --- geometry ------------------------------------------------------------

  const railGeom = slab(1, RAIL_W, RAIL_Y0, RAIL_Y1)
  const tieGeom = slab(TIE_ALONG, TIE_ACROSS, 0, TIE_H)
  const deckGeom = slab(1, DECK_W, DECK_Y0, DECK_Y1)
  // Hangs from y = 0 down, so an instance sits its top on the deck soffit and
  // scales in y to reach the lake bed.
  const pierGeom = slab(PIER_W, PIER_W, -PIER_LEN, 0)
  const vehicleGeom = buildVehicleGeometry()
  const cabGeom = buildCabGeometry()
  const glassGeom = buildGlassGeometry()
  const shadowGeom = (() => {
    const disc = fadedDisc(SHADOW_R, SHADOW_DARK, 1)
    disc.scale(SHADOW_STRETCH, 1, 1)
    return disc
  })()

  // --- meshes --------------------------------------------------------------

  const rails = new InstancedMesh(railGeom, railMaterial, MAX_SEGMENTS * 2)
  const ties = new InstancedMesh(tieGeom, tieMaterial, MAX_SEGMENTS * SLEEPERS_PER_SEGMENT)
  const decks = new InstancedMesh(deckGeom, stoneMaterial, MAX_SEGMENTS)
  const piers = new InstancedMesh(pierGeom, stoneMaterial, MAX_SEGMENTS)
  const vehicles = new InstancedMesh(vehicleGeom, bodyMaterial, VEHICLE_CAPACITY)
  const cabs = new InstancedMesh(cabGeom, bodyMaterial, MAX_TRAINS)
  const glass = new InstancedMesh(glassGeom, glassMaterial, VEHICLE_CAPACITY)
  const shadows = new InstancedMesh(shadowGeom, shadowMaterial, VEHICLE_CAPACITY)

  const allMeshes = [rails, ties, decks, piers, vehicles, cabs, glass, shadows]
  for (const mesh of allMeshes) {
    mesh.count = 0
    // Instances range over the whole plot; the mesh's own bounds are one part.
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = true
  }
  glass.receiveShadow = false
  glass.renderOrder = 6
  glass.visible = false
  shadows.receiveShadow = false
  // Over the track, under the headlight beams render/traffic draws at 6.
  shadows.renderOrder = 3
  group.add(rails, ties, decks, piers, vehicles, cabs, glass, shadows)

  // Allocate the instance colour buffers up front so they are never null.
  for (let i = 0; i < VEHICLE_CAPACITY; i++) vehicles.setColorAt(i, carriageColor)
  for (let i = 0; i < MAX_TRAINS; i++) cabs.setColorAt(i, locoColor)
  if (vehicles.instanceColor) vehicles.instanceColor.needsUpdate = true
  if (cabs.instanceColor) cabs.instanceColor.needsUpdate = true

  const trains: Train[] = []
  for (let i = 0; i < MAX_TRAINS; i++) trains.push(makeTrain())
  let trainCount = 0
  let vehicleCount = 0

  // --- rebuild -------------------------------------------------------------

  /** Height of the rock at every lattice corner. Zero everywhere on the plain,
   *  which is why nothing below needs a special case for a flat board. */
  const cornerLift = new Float32Array(CORNER_COUNT)

  /**
   * Reproduce render/terrain's `cornerHeight` over the whole lattice: the mean
   * of a corner's mountain neighbours, scaled by how many of the four it has,
   * plus that file's jitter and its 0.04 floor. Computed once per sync over 169
   * corners, so there is no reason to be clever about it.
   */
  function buildCornerLift(map: TerrainMap, seed: number): void {
    for (let cz = 0; cz < CORNERS_PER_SIDE; cz++) {
      for (let cx = 0; cx < CORNERS_PER_SIDE; cx++) {
        let sum = 0
        let n = 0
        for (let tx = cx - 1; tx <= cx; tx++) {
          for (let tz = cz - 1; tz <= cz; tz++) {
            if (tx < 0 || tz < 0 || tx >= WORLD_SIZE || tz >= WORLD_SIZE) continue
            const tile = tileIndex(tx, tz)
            if (map.terrain[tile] !== Terrain.Mountain) continue
            sum += map.height[tile]
            n++
          }
        }
        let h = 0
        if (n > 0) {
          h = (sum / n) * CORNER_SHAPE[n] + rockJitter(cx, cz, seed) * CORNER_JITTER * n
          if (h < 0.04) h = 0.04
        }
        cornerLift[cornerIndex(cx, cz)] = h
      }
    }
  }

  /** Is the tile flanking this seam on the given side under water? */
  function flankIsWater(terrain: Uint8Array, tx: number, tz: number): boolean {
    if (tx < 0 || tz < 0 || tx >= WORLD_SIZE || tz >= WORLD_SIZE) return false
    return terrain[tileIndex(tx, tz)] === Terrain.Water
  }

  function buildTrack(segments: Int32Array, segmentCount: number, terrain: Uint8Array): void {
    let railIndex = 0
    let tieIndex = 0
    let deckIndex = 0

    for (let s = 0; s < segmentCount; s++) {
      const a = segments[s * 2]
      const b = segments[s * 2 + 1]
      const wa = cornerToWorld(a)
      const wb = cornerToWorld(b)
      const ya = cornerLift[a]
      const yb = cornerLift[b]
      const dxRaw = wb.x - wa.x
      const dzRaw = wb.z - wa.z
      const dy = yb - ya
      const len = Math.hypot(dxRaw, dzRaw) || 1
      const dx = dxRaw / len
      const dz = dzRaw / len
      // Right-hand normal. It stays horizontal on a grade, so the two rails
      // keep their gauge measured across the track rather than across the map,
      // and the track never banks.
      const rx = -dz
      const rz = dx
      // Yaw onto the segment, then pitch along its grade. On the plain dy is
      // zero and this is the flat case exactly, with no rounding introduced.
      const span = orient(dxRaw, dy, dzRaw, scratchQuat)
      flatQuat.setFromAxisAngle(Y_AXIS, Math.atan2(-dz, dx))

      const mx = wa.x + dxRaw * 0.5
      const my = ya + dy * 0.5
      const mz = wa.z + dzRaw * 0.5

      // Two rails, one either side of the centre line.
      for (const side of [-1, 1]) {
        scratchPos.set(mx + rx * side * (GAUGE / 2), my, mz + rz * side * (GAUGE / 2))
        scratchScale.set(span, 1, 1)
        scratchMatrix.compose(scratchPos, scratchQuat, scratchScale)
        rails.setMatrixAt(railIndex++, scratchMatrix)
      }
      scratchScale.set(1, 1, 1)

      // Sleepers, evenly spaced and never landing on a junction: a tie at the
      // corner would be shared by two segments and drawn twice. They take the
      // pitch too, so the whole assembly climbs as one thing.
      for (let k = 0; k < SLEEPERS_PER_SEGMENT; k++) {
        const f = (k + 0.5) / SLEEPERS_PER_SEGMENT
        scratchPos.set(wa.x + dxRaw * f, ya + dy * f, wa.z + dzRaw * f)
        scratchMatrix.compose(scratchPos, scratchQuat, scratchScale)
        ties.setMatrixAt(tieIndex++, scratchMatrix)
      }

      // A bridge wherever either flanking tile is lake. One flank is enough:
      // that is the shoreline segment, and an approach span is exactly what a
      // bridge needs there.
      const horizontal = cornerZ(a) === cornerZ(b)
      const cx = horizontal ? Math.min(cornerX(a), cornerX(b)) : cornerX(a)
      const cz = horizontal ? cornerZ(a) : Math.min(cornerZ(a), cornerZ(b))
      const wet = horizontal
        ? flankIsWater(terrain, cx, cz - 1) || flankIsWater(terrain, cx, cz)
        : flankIsWater(terrain, cx - 1, cz) || flankIsWater(terrain, cx, cz)
      if (wet) {
        scratchPos.set(mx, my, mz)
        scratchScale.set(span, 1, 1)
        scratchMatrix.compose(scratchPos, scratchQuat, scratchScale)
        decks.setMatrixAt(deckIndex, scratchMatrix)
        // The pier stays plumb whatever the deck above it is doing, and
        // stretches from the deck soffit back down to the same absolute lake
        // bed, so a lifted deck never leaves it hanging.
        scratchPos.set(mx, my + DECK_Y0, mz)
        scratchScale.set(1, (my + DECK_Y0 - PIER_Y0) / PIER_LEN, 1)
        scratchMatrix.compose(scratchPos, flatQuat, scratchScale)
        piers.setMatrixAt(deckIndex, scratchMatrix)
        scratchScale.set(1, 1, 1)
        deckIndex++
      }
    }

    rails.count = railIndex
    ties.count = tieIndex
    decks.count = deckIndex
    piers.count = deckIndex
    rails.instanceMatrix.needsUpdate = true
    ties.instanceMatrix.needsUpdate = true
    decks.instanceMatrix.needsUpdate = true
    piers.instanceMatrix.needsUpdate = true
  }

  /**
   * How many vehicles a leg can hold. A consist longer than its own line would
   * have to bunch up at the terminus, so short legs get short trains: a single
   * tile between two stations runs an engine and one carriage, and only a leg
   * of four tiles or more gets the full four.
   */
  function vehiclesFor(len: number): number {
    for (let n = MAX_CARS_PER_TRAIN; n > 2; n--) {
      if ((n - 1) * CAR_PITCH + 2 * BOGIE_HALF <= len) return n
    }
    return 2
  }

  function buildTrains(lines: Int32Array[]): void {
    trainCount = 0
    vehicleCount = 0
    for (let l = 0; l < lines.length && trainCount < MAX_TRAINS; l++) {
      const path = lines[l]
      if (path.length < 2) continue
      const segments = path.length - 1
      if (vehicleCount + MAX_CARS_PER_TRAIN > VEHICLE_CAPACITY) break

      const train = trains[trainCount]
      if (train.px.length !== path.length) {
        train.px = new Float32Array(path.length)
        train.py = new Float32Array(path.length)
        train.pz = new Float32Array(path.length)
      }
      for (let i = 0; i < path.length; i++) {
        const w = cornerToWorld(path[i])
        train.px[i] = w.x
        train.py[i] = cornerLift[path[i]]
        train.pz[i] = w.z
      }
      train.len = segments
      train.vehicles = vehiclesFor(segments)
      train.base = vehicleCount
      train.uMin = (train.vehicles - 1) * CAR_PITCH + BOGIE_HALF
      train.uMax = segments - BOGIE_HALF
      if (train.uMax < train.uMin) {
        // Only reachable if the sim ever emits a leg shorter than a tile. Park
        // the consist rather than letting it oscillate inside its own length.
        const mid = (train.uMin + train.uMax) / 2
        train.uMin = mid
        train.uMax = mid
      }
      // Spread the fleet along its legs so two lines are not in step, and keep
      // it deterministic so a rebuild does not jump every train.
      const h = hash01(l * 2654435761)
      train.u = train.uMin + (train.uMax - train.uMin) * h
      train.dir = h < 0.5 ? 1 : -1
      train.dwell = 0
      train.speed = TRAIN_SPEED * (1 - SPEED_JITTER + 2 * SPEED_JITTER * hash01(l + 7919))

      // The engine leads the consist and keeps its livery whichever way the
      // shuttle happens to be running.
      vehicles.setColorAt(train.base, locoColor)
      for (let v = 1; v < train.vehicles; v++) vehicles.setColorAt(train.base + v, carriageColor)
      cabs.setColorAt(trainCount, locoColor)

      vehicleCount += train.vehicles
      trainCount++
    }

    vehicles.count = vehicleCount
    glass.count = vehicleCount
    shadows.count = vehicleCount
    cabs.count = trainCount
    if (vehicles.instanceColor) vehicles.instanceColor.needsUpdate = true
    if (cabs.instanceColor) cabs.instanceColor.needsUpdate = true
  }

  function sync(state: CityState): void {
    const network = computeRail(state)
    const map = terrainFor(state)
    // The lift has to exist before either the track or the train paths are
    // laid out: both read it, and both have to agree on it to the millimetre or
    // a train floats above its own rails.
    buildCornerLift(map, state.terrainSeed)
    buildTrack(network.segments, network.segmentCount, map.terrain)
    buildTrains(network.lines)
  }

  // --- per frame -----------------------------------------------------------

  /** Place one vehicle from two bogie samples on the path. */
  function poseVehicle(train: Train, centre: number): void {
    sampleAt(train, centre + BOGIE_HALF, sampleAx)
    sampleAt(train, centre - BOGIE_HALF, sampleBx)
    const x = (sampleAx.x + sampleBx.x) * 0.5
    const y = (sampleAx.y + sampleBx.y) * 0.5
    const z = (sampleAx.z + sampleBx.z) * 0.5
    // The chord between the bogies is the body's axis, which is what makes a
    // carriage swing through a corner instead of pivoting on the spot — and,
    // now that the path has height, what makes it nose up onto a grade over the
    // length of its own wheelbase rather than at a hinge.
    orient(sampleAx.x - sampleBx.x, sampleAx.y - sampleBx.y, sampleAx.z - sampleBx.z, scratchQuat)

    scratchPos.set(x, y + VEHICLE_Y, z)
    scratchMatrix.compose(scratchPos, scratchQuat, UNIT_SCALE)
    // The blob keeps the vehicle's pitch, so on a climb it lies along the track
    // instead of cutting into the rock the train is standing on.
    scratchPos.set(x, y + SHADOW_Y, z)
    scratchShadow.compose(scratchPos, scratchQuat, UNIT_SCALE)
  }

  let appliedNight = -1
  let appliedGlow = -1

  function frame(dt: number, night: number): void {
    // A hidden tab hands back an enormous dt on the first frame back. Clamp it,
    // or a train crosses its whole line between two frames.
    const d = dt > 0 ? Math.min(dt, 0.1) : 0

    if (trainCount > 0 && d > 0) {
      for (let t = 0; t < trainCount; t++) {
        const train = trains[t]
        if (train.dwell > 0) {
          train.dwell -= d
        } else if (train.uMax > train.uMin) {
          train.u += train.dir * train.speed * d
          if (train.u >= train.uMax) {
            train.u = train.uMax
            train.dir = -1
            train.dwell = DWELL
          } else if (train.u <= train.uMin) {
            train.u = train.uMin
            train.dir = 1
            train.dwell = DWELL
          }
        }
      }
    }

    if (trainCount > 0) {
      for (let t = 0; t < trainCount; t++) {
        const train = trains[t]
        for (let v = 0; v < train.vehicles; v++) {
          // The consist never turns round: it reverses, so the carriages stay
          // on the same side of the engine and the engine propels them back.
          poseVehicle(train, train.u - v * CAR_PITCH)
          const i = train.base + v
          vehicles.setMatrixAt(i, scratchMatrix)
          glass.setMatrixAt(i, scratchMatrix)
          shadows.setMatrixAt(i, scratchShadow)
          if (v === 0) cabs.setMatrixAt(t, scratchMatrix)
        }
      }
      vehicles.instanceMatrix.needsUpdate = true
      cabs.instanceMatrix.needsUpdate = true
      glass.instanceMatrix.needsUpdate = true
      shadows.instanceMatrix.needsUpdate = true
    }

    if (Math.abs(night - appliedNight) > 0.004) {
      // Track takes the ground layer's night lift exactly, the way render/roads
      // does, so it keeps the same tonal relationship to the tint it lies on at
      // every hour. The trains take a smaller one: they are lit objects with
      // their own windows, and lifting them as hard as the ground would wash
      // the liveries out to two pale smudges.
      const groundLift = 1 + 0.42 * night
      railMaterial.color.copy(railBase).multiplyScalar(groundLift)
      tieMaterial.color.copy(tieBase).multiplyScalar(groundLift)
      stoneMaterial.color.copy(stoneBase).multiplyScalar(groundLift)
      const bodyLift = 1 + 0.2 * night
      bodyMaterial.color.setRGB(bodyLift, bodyLift, bodyLift)
      appliedNight = night
    }

    // Carriage lights come up through dusk rather than switching at a threshold,
    // a little behind the street lamps and alongside the buildings' windows.
    const lit = smoothstep(0.14, 0.52, night)
    if (Math.abs(lit - appliedGlow) > 0.004) {
      glassMaterial.color.copy(glowColor).multiplyScalar(lit)
      appliedGlow = lit
    }
    glass.visible = lit > 0.01 && vehicleCount > 0
  }

  function dispose(): void {
    group.parent?.remove(group)
    for (const mesh of allMeshes) mesh.dispose()
    group.clear()
    railGeom.dispose()
    tieGeom.dispose()
    deckGeom.dispose()
    pierGeom.dispose()
    vehicleGeom.dispose()
    cabGeom.dispose()
    glassGeom.dispose()
    shadowGeom.dispose()
    railMaterial.dispose()
    tieMaterial.dispose()
    stoneMaterial.dispose()
    bodyMaterial.dispose()
    glassMaterial.dispose()
    shadowMaterial.dispose()
    trainCount = 0
    vehicleCount = 0
  }

  return { sync, frame, object: group, dispose }
}
