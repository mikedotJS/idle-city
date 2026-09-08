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
 * every part at once. Ratios are constants, so a "band 18% lighter than the
 * wall" is literally `new Color(1.18, 1.18, 1.18)` and follows every theme.
 *
 * Levels and biomes: a building now has 9 looks (3 biomes x 3 levels) and there
 * are 5 types, so 45 geometries. They are NOT 45 meshes. All 9 looks of one
 * part are merged into a single geometry, each look tagged with a `variantId`
 * vertex attribute, and an instanced `aLook` attribute says which one an
 * instance is. A three-line injection into the vertex shader collapses every
 * triangle whose `variantId` does not match to a point, so it never rasterises.
 * The mesh count therefore stays at exactly what it was — three per type, body
 * / roof / windows — instead of growing 15-fold, and the cost is vertex
 * shading, which is the cheap end for a 144-instance diorama.
 *
 * Three things follow from that and are easy to forget:
 *   - the shadow pass uses its own depth material, which would happily cast the
 *     shadow of all nine looks at once, so every mesh gets a `customDepthMaterial`
 *     carrying the same injection;
 *   - picking is CPU-side and knows nothing about the shader, so the raycast is
 *     overridden to test only the vertex range of the look an instance actually
 *     wears (cheap box reject first, exact triangles second);
 *   - the ghost preview is a plain Mesh, so it swaps between per-biome
 *     geometries rather than using the merged one.
 *
 * Footprints never grow with level. Traffic measures its clearances off the
 * ground-level width of each type, so levels are spent on height and detail;
 * anything wider than the body sits at y >= 0.34, which is where the shop's
 * existing awning already lives, and never exceeds a half-extent of 0.43.
 */

import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RGBADepthPacking,
  Ray,
  SRGBColorSpace,
  Scene,
  Vector3,
  AdditiveBlending,
} from 'three'
import type { Intersection, Raycaster } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BUILDINGS, BUILDING_TYPES } from '../sim/buildings'
import { MAX_LEVEL, TILE_COUNT } from '../sim/config'
import { tileToWorld } from '../sim/grid'
import { Biome, terrainFor } from '../sim/terrain'
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

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): BufferGeometry {
  const g = new BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

function cyl(
  rTop: number,
  rBottom: number,
  h: number,
  seg: number,
  x = 0,
  y = 0,
  z = 0,
): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBottom, h, seg)
  g.translate(x, y, z)
  return g
}

function cone(r: number, h: number, seg: number, x = 0, y = 0, z = 0): BufferGeometry {
  const g = new ConeGeometry(r, h, seg)
  g.translate(x, y, z)
  return g
}

function blob(r: number, x = 0, y = 0, z = 0): BufferGeometry {
  const g = new IcosahedronGeometry(r, 0)
  g.translate(x, y, z)
  return g
}

/**
 * A snow cap that lies exactly on the upper part of a gable roof.
 *
 * A prism of width `w` and rise `r` has half-width `(w/2)(1-s)` at height `r*s`,
 * so a prism of width `w(1-s)` and rise `r(1-s)` started at that height is
 * flush with the slopes. Scaled up a few percent it sits just proud of them,
 * which is what settled snow looks like from across the table.
 */
function snowCap(w: number, d: number, rise: number, baseY: number): BufferGeometry {
  const s = 0.4
  const k = 1.07
  const g = gableGeometry(w * (1 - s) * k, d * 1.02, rise * (1 - s) * k)
  g.translate(0, baseY + rise * s - 0.004, 0)
  return g
}

/** Ratio of `target` to `base`, per channel, in the linear working space. */
function ratioOf(base: Color, target: Color): Color {
  return new Color(
    Math.min(6, target.r / Math.max(base.r, 1e-3)),
    Math.min(6, target.g / Math.max(base.g, 1e-3)),
    Math.min(6, target.b / Math.max(base.b, 1e-3)),
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

/**
 * A window quad on each of the four faces of a box, `offsets.length` per face.
 * `hw`/`hd` are the box half-extents and `cx`/`cz` its centre, so a hut sitting
 * off to one side of a platform gets its windows on its own walls.
 */
function windowQuads(
  hw: number,
  hd: number,
  y: number,
  w: number,
  h: number,
  offsets: number[],
  cx = 0,
  cz = 0,
): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const eps = 0.004
  for (const o of offsets) {
    const north = new PlaneGeometry(w, h)
    north.translate(cx + o, y, cz + hd + eps)
    out.push(north)
    const south = new PlaneGeometry(w, h)
    south.rotateY(Math.PI)
    south.translate(cx - o, y, cz - hd - eps)
    out.push(south)
    const east = new PlaneGeometry(w, h)
    east.rotateY(Math.PI / 2)
    east.translate(cx + hw + eps, y, cz - o)
    out.push(east)
    const west = new PlaneGeometry(w, h)
    west.rotateY(-Math.PI / 2)
    west.translate(cx - hw - eps, y, cz + o)
    out.push(west)
  }
  return out
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

interface Theme {
  /** Body colour. Everything else is a ratio against this. */
  wall: number
  roof: number
  /** Trim, sills, paths, platform stone. */
  trim: number
  /** Planting, for parks. */
  foliage: number
  /** Multiplier on the base roof rise. Coast flattens, alpine steepens. */
  pitch: number
  /** Deep eaves plus a snow cap on the roof. */
  snow: boolean
}

const SNOW_COLOR = 0xf2f6fb

function theme(
  wall: number,
  roof: number,
  trim: number,
  foliage: number,
  pitch: number,
  snow: boolean,
): Theme {
  return { wall, roof, trim, foliage, pitch, snow }
}

/**
 * The plain look stays the sim's own palette, so a plain city looks exactly as
 * it did and sim/buildings.ts remains the one place the base colours live.
 */
function plainTheme(type: BuildingType, trim: number, foliage: number): Theme {
  const def = BUILDINGS[type]
  return theme(def.color, def.roofColor, trim, foliage, 1.0, false)
}

/**
 * Indexed by Biome. Coast bleaches and flattens, alpine darkens the timber and
 * steepens the pitch. The wall lightness is the part that carries at camera
 * distance — the roof pitch is the confirmation once you look, not the signal.
 */
const THEMES: Record<BuildingType, Theme[]> = {
  house: [
    plainTheme('house', 0xf7f0e6, 0x6fa473),
    theme(0xf6f1e4, 0x9cc3c8, 0xffffff, 0x8fb87c, 0.45, false),
    theme(0x9d7a5b, 0x6b5a50, 0xdcc9ad, 0x4c7a5a, 1.55, true),
  ],
  shop: [
    plainTheme('shop', 0xfaf3dd, 0x6fa473),
    theme(0xfaf4e2, 0x82bcc2, 0xffffff, 0x8fb87c, 0.45, false),
    theme(0xb9906a, 0x62645c, 0xe3d3b4, 0x4c7a5a, 1.55, true),
  ],
  factory: [
    plainTheme('factory', 0xd6d0c8, 0x6fa473),
    theme(0xd5cfc5, 0x94a4a5, 0xefeae0, 0x8fb87c, 0.45, false),
    theme(0x8e877f, 0x5a544e, 0xc5bdb2, 0x4c7a5a, 1.55, true),
  ],
  station: [
    plainTheme('station', 0xf1e7d4, 0x6fa473),
    theme(0xefe6d2, 0x8bb7bd, 0xfdf8ec, 0x8fb87c, 0.45, false),
    theme(0xa6845e, 0x5f544a, 0xd9c8ac, 0x4c7a5a, 1.55, true),
  ],
  park: [
    plainTheme('park', 0xd9cdb4, BUILDINGS.park.roofColor),
    theme(0xdccca6, 0x86ae74, 0xf0e6cd, 0x86ae74, 1.0, false),
    theme(0x86a887, 0x49775a, 0xc4c1b8, 0x49775a, 1.0, true),
  ],
}

// ---------------------------------------------------------------------------
// Parts, per type x biome x level
// ---------------------------------------------------------------------------

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
/** Ratios used as shades of whatever the body colour happens to be. */
const LIGHTEN = new Color(1.2, 1.2, 1.2)
const DARKEN = new Color(0.62, 0.62, 0.62)

interface Ctx {
  theme: Theme
  biome: Biome
  level: number
  roof: Color
  trim: Color
  leaf: Color
  snow: Color
}

/** Per-level height jitter: the taller the building, the tidier the skyline. */
function jitterFor(level: number, base: number): number {
  return level === 1 ? base : level === 2 ? base * 0.6 : base * 0.34
}

function houseParts(c: Ctx): Parts {
  const L = c.level
  const H = L === 1 ? 0.55 : L === 2 ? 0.75 : 0.95
  const bw = 0.62
  const half = bw / 2

  const body: BufferGeometry[] = [tint(box(bw, H, bw, 0, H / 2, 0), WHITE)]
  if (L === 2) {
    // One string course marks the second storey without touching the footprint.
    body.push(tint(box(bw + 0.02, 0.045, bw + 0.02, 0, 0.42, 0), c.trim))
    body.push(tint(box(0.22, 0.3, 0.012, 0, 0.15, half - 0.002), DARKEN))
  }
  if (L === 3) {
    // A dark ground floor and two floor bands: the apartment-block read.
    body.push(tint(box(bw + 0.008, 0.19, bw + 0.008, 0, 0.095, 0), DARKEN))
    body.push(tint(box(bw + 0.02, 0.04, bw + 0.02, 0, 0.36, 0), c.trim))
    body.push(tint(box(bw + 0.02, 0.04, bw + 0.02, 0, 0.68, 0), c.trim))
    // Balconies, at 0.4 half-extent so they stay clear of the street.
    body.push(tint(box(0.34, 0.03, 0.1, 0, 0.38, half + 0.04), c.trim))
    body.push(tint(box(0.34, 0.03, 0.1, 0, 0.7, -half - 0.04), c.trim))
  }

  const rise = (L === 1 ? 0.3 : L === 2 ? 0.28 : 0.26) * c.theme.pitch
  const eaves = bw + (c.theme.snow ? 0.2 : c.theme.pitch < 0.8 ? 0.06 : 0.12)
  const prism = gableGeometry(eaves, eaves, rise)
  prism.translate(0, H, 0)
  const roof: BufferGeometry[] = [tint(prism, c.roof)]
  if (c.theme.snow) {
    // A pale fascia under the deep eaves, then the snow itself.
    roof.push(tint(box(eaves, 0.03, eaves, 0, H + 0.015, 0), c.trim))
    roof.push(tint(snowCap(eaves, eaves, rise, H), c.snow))
  }
  const chimH = L === 1 ? 0.3 : 0.36
  roof.push(tint(box(0.1, chimH, 0.1, 0.2, H + rise * 0.45, 0.15), c.roof))
  if (L === 3) {
    roof.push(tint(box(0.07, 0.06, eaves * 0.7, -0.05, H + rise, 0), c.trim))
  }

  const win: BufferGeometry[] = []
  if (L === 1) {
    win.push(...windowQuads(half, half, H * 0.42, 0.13, 0.16, [-0.14, 0.14]))
  } else if (L === 2) {
    win.push(...windowQuads(half, half, 0.24, 0.13, 0.16, [-0.14, 0.14]))
    win.push(...windowQuads(half, half, 0.6, 0.13, 0.16, [-0.14, 0.14]))
  } else {
    win.push(...windowQuads(half, half, 0.24, 0.1, 0.13, [-0.17, 0, 0.17]))
    win.push(...windowQuads(half, half, 0.53, 0.1, 0.13, [-0.17, 0, 0.17]))
    win.push(...windowQuads(half, half, 0.83, 0.1, 0.13, [-0.17, 0, 0.17]))
  }

  return {
    body: mergeParts(body),
    roof: mergeParts(roof),
    windows: mergeParts(win.map((g) => tint(g, WHITE))),
    roofPivotY: H,
    heightJitter: jitterFor(L, 0.3),
  }
}

function shopParts(c: Ctx): Parts {
  const L = c.level
  const H = L === 1 ? 0.75 : L === 2 ? 0.9 : 1.02
  const bw = 0.68
  const half = bw / 2

  const body: BufferGeometry[] = [tint(box(bw, H, bw, 0, H / 2, 0), WHITE)]
  // The awning is the shop's signature. It grows with the storefront but never
  // past 0.42 either side, which is where it already sat at level 1.
  const awnW = L === 1 ? 0.84 : 0.86
  const awnY = L === 1 ? H * 0.46 : L === 2 ? 0.42 : 0.46
  body.push(tint(box(awnW, 0.05, awnW, 0, awnY, 0), c.roof))
  // A glazed shopfront band all the way round: more frontage, same footprint.
  body.push(tint(box(bw + 0.006, 0.02, bw + 0.006, 0, awnY - 0.24, 0), c.trim))
  if (L === 2) {
    body.push(tint(box(bw + 0.02, 0.04, bw + 0.02, 0, 0.54, 0), c.trim))
    // A fascia sign over the door: shop frontage without any extra width.
    body.push(tint(box(0.44, 0.13, 0.012, 0, 0.82, half - 0.002), c.trim))
  }
  if (L === 3) {
    body.push(tint(box(bw + 0.006, 0.02, bw + 0.006, 0, awnY + 0.02, 0), c.trim))
    body.push(tint(box(bw + 0.02, 0.04, bw + 0.02, 0, 0.78, 0), c.trim))
    // Pilasters between the bays: flush with the wall, like the windows.
    for (const x of [-0.28, 0.28]) {
      body.push(tint(box(0.05, awnY - 0.05, 0.012, x, (awnY - 0.05) / 2, half - 0.002), c.trim))
      body.push(tint(box(0.012, awnY - 0.05, 0.05, half - 0.002, (awnY - 0.05) / 2, x), c.trim))
    }
  }

  const roof: BufferGeometry[] = []
  if (c.theme.snow) {
    // Alpine shops take a pitched roof instead of the flat parapet.
    const rise = 0.3 * c.theme.pitch
    const prism = gableGeometry(bw + 0.14, bw + 0.14, rise)
    prism.translate(0, H, 0)
    roof.push(tint(prism, c.roof))
    roof.push(tint(snowCap(bw + 0.14, bw + 0.14, rise, H), c.snow))
    roof.push(tint(box(0.14, 0.24, 0.14, -0.18, H + rise * 0.4, 0.14), c.roof))
  } else {
    roof.push(tint(box(0.76, 0.1, 0.76, 0, H + 0.05, 0), c.roof))
    roof.push(tint(box(0.24, 0.14, 0.24, 0.13, H + 0.17, -0.11), c.roof))
    if (L >= 2) roof.push(tint(box(0.18, 0.1, 0.3, -0.16, H + 0.15, 0.12), c.roof))
    if (L === 3) {
      roof.push(tint(box(0.14, 0.16, 0.14, 0.16, H + 0.18, 0.2), c.roof))
      // A rooftop sign is the cheapest way to say "this one is bigger".
      roof.push(tint(box(0.46, 0.18, 0.04, 0, H + 0.22, -0.06), c.trim))
    }
  }

  const win: BufferGeometry[] = []
  if (L === 1) {
    win.push(...windowQuads(half, half, H * 0.28, 0.4, 0.22, [0]))
  } else if (L === 2) {
    win.push(...windowQuads(half, half, 0.2, 0.42, 0.24, [0]))
    win.push(...windowQuads(half, half, 0.68, 0.14, 0.15, [-0.17, 0.17]))
  } else {
    win.push(...windowQuads(half, half, 0.2, 0.44, 0.26, [0]))
    win.push(...windowQuads(half, half, 0.62, 0.13, 0.15, [-0.18, 0.18]))
    win.push(...windowQuads(half, half, 0.9, 0.13, 0.15, [-0.18, 0.18]))
  }

  return {
    body: mergeParts(body),
    roof: mergeParts(roof),
    windows: mergeParts(win.map((g) => tint(g, WHITE))),
    roofPivotY: H,
    heightJitter: jitterFor(L, 0.28),
  }
}

function factoryParts(c: Ctx): Parts {
  const L = c.level
  const H = L === 1 ? 0.95 : L === 2 ? 1.0 : 1.06
  const bw = 0.74
  const half = bw / 2

  const body: BufferGeometry[] = [tint(box(bw, H, bw, 0, H / 2, 0), WHITE)]
  // Extra plant is a taller block and a silo, both inside the same footprint.
  const towerH = L === 2 ? H + 0.26 : H + 0.34
  if (L >= 2) {
    const tw = L === 2 ? 0.4 : 0.46
    body.push(tint(box(tw, towerH, tw, -0.13, towerH / 2, -0.13), WHITE))
    body.push(tint(box(tw + 0.02, 0.05, tw + 0.02, -0.13, towerH - 0.12, -0.13), DARKEN))
  }
  if (L === 3) {
    // A silo rising through the shed roof. Only the part above the walls is
    // ever seen, so it starts just inside them rather than at the ground.
    body.push(tint(cyl(0.15, 0.15, 0.8, 10, 0.2, 1.1, 0.2), c.trim))
    body.push(tint(cyl(0.16, 0.16, 0.05, 10, 0.2, 1.52, 0.2), c.roof))
  }

  const roof: BufferGeometry[] = [tint(box(0.8, 0.09, 0.8, 0, H + 0.045, 0), c.roof)]
  if (L >= 2) {
    const tw = L === 2 ? 0.44 : 0.5
    roof.push(tint(box(tw, 0.07, tw, -0.13, towerH + 0.035, -0.13), c.roof))
  }
  const stacks: [number, number, number, number][] = [
    // x, z, height, radius
    [0.2, 0.16, 0.44, 0.062],
    [-0.17, -0.18, 0.28, 0.052],
  ]
  if (L >= 2) stacks.push([0.02, -0.24, 0.56, 0.058])
  if (L === 3) {
    stacks.push([0.26, -0.06, 0.56, 0.055])
    stacks[0][2] = 0.54
  }
  for (const [x, z, h, r] of stacks) {
    const base = x < -0.05 && z < -0.05 && L >= 2 ? towerH + 0.07 : H + 0.09
    roof.push(tint(cyl(r * 0.84, r, h, 6, x, base + h / 2, z), c.roof))
    roof.push(tint(cyl(r * 1.15, r * 1.15, 0.04, 6, x, base + h - 0.02, z), c.trim))
  }
  if (L === 3) {
    // Sawtooth lights along the shed roof: the "bigger plant" silhouette.
    for (const z of [-0.22, 0.02, 0.26]) {
      const saw = gableGeometry(0.2, 0.64, 0.1)
      saw.rotateY(Math.PI / 2)
      saw.translate(0.03, H + 0.09, z)
      roof.push(tint(saw, c.trim))
    }
  }
  if (c.theme.snow) {
    roof.push(tint(box(0.82, 0.025, 0.82, 0, H + 0.1, 0), c.snow))
    if (L >= 2) {
      const tw = L === 2 ? 0.46 : 0.52
      roof.push(tint(box(tw, 0.025, tw, -0.13, towerH + 0.08, -0.13), c.snow))
    }
  }

  const win: BufferGeometry[] = []
  win.push(...windowQuads(half, half, H * 0.44, 0.1, 0.12, [-0.19, 0, 0.19]))
  if (L >= 2) win.push(...windowQuads(half, half, H * 0.16, 0.1, 0.12, [-0.19, 0, 0.19]))
  if (L === 3) {
    win.push(...windowQuads(0.23, 0.23, H + 0.2, 0.09, 0.11, [-0.09, 0.09], -0.13, -0.13))
  }

  return {
    body: mergeParts(body),
    roof: mergeParts(roof),
    windows: mergeParts(win.map((g) => tint(g, WHITE))),
    roofPivotY: H,
    heightJitter: jitterFor(L, 0.3),
  }
}

function stationParts(c: Ctx): Parts {
  const L = c.level
  const plate = 0.72
  const pHalf = plate / 2
  const hutW = L === 1 ? 0.44 : L === 2 ? 0.52 : 0.56
  const hutD = L === 1 ? 0.3 : L === 2 ? 0.32 : 0.34
  const hutH = L === 1 ? 0.34 : L === 2 ? 0.46 : 0.6
  const hutZ = -0.15
  const deck = 0.09

  const body: BufferGeometry[] = [
    // Platform: a stone plate with a painted edge strip along the track side.
    tint(box(plate, deck, plate, 0, deck / 2, 0), c.trim),
    tint(box(plate, 0.012, 0.1, 0, deck + 0.004, pHalf - 0.06), LIGHTEN),
    tint(box(hutW, hutH, hutD, 0, deck + hutH / 2, hutZ), WHITE),
  ]
  if (L >= 2) {
    body.push(tint(box(hutW + 0.02, 0.04, hutD + 0.02, 0, deck + hutH * 0.55, hutZ), c.trim))
    body.push(tint(box(0.3, 0.02, 0.24, 0, deck + 0.006, 0.16), LIGHTEN))
  }
  if (L === 3) {
    // A clock tower, which is what makes a station read as a station.
    body.push(tint(box(0.24, 0.3, 0.24, -0.16, deck + hutH + 0.15, hutZ), WHITE))
    body.push(tint(box(0.14, 0.14, 0.02, -0.16, deck + hutH + 0.19, hutZ + 0.13), c.trim))
  }

  const canY = L === 1 ? deck + 0.46 : L === 2 ? deck + 0.6 : deck + 0.78
  const canW = L === 1 ? 0.78 : 0.8
  const canD = L === 1 ? 0.56 : 0.62
  const roof: BufferGeometry[] = []
  const postH = canY - deck
  for (const x of [-0.3, 0.3]) {
    roof.push(tint(box(0.045, postH, 0.045, x, deck + postH / 2, 0.24), c.roof))
    if (L === 3) roof.push(tint(box(0.045, postH, 0.045, x, deck + postH / 2, -0.02), c.roof))
  }
  if (c.theme.snow) {
    const rise = 0.16 * c.theme.pitch
    const prism = gableGeometry(canW, canD, rise)
    prism.translate(0, canY, 0.04)
    roof.push(tint(prism, c.roof))
    roof.push(tint(snowCap(canW, canD, rise, canY), c.snow))
  } else {
    roof.push(tint(box(canW, 0.05, canD, 0, canY + 0.025, 0.04), c.roof))
    if (c.biome === Biome.Coast) {
      // Coast: a light fascia board, flat and bleached, like a pier shelter.
      roof.push(tint(box(canW, 0.05, 0.03, 0, canY + 0.05, 0.04 + canD / 2), c.trim))
    }
  }
  // Hut roof, so the building has a top even under the canopy.
  const hutRise = 0.12 * c.theme.pitch
  const hutPrism = gableGeometry(hutW + 0.08, hutD + 0.08, hutRise)
  hutPrism.translate(0, deck + hutH, hutZ)
  roof.push(tint(hutPrism, c.roof))
  if (L === 3) {
    const towerRise = 0.16 * c.theme.pitch
    const towerPrism = gableGeometry(0.3, 0.3, towerRise)
    towerPrism.translate(-0.16, deck + hutH + 0.3, hutZ)
    roof.push(tint(towerPrism, c.roof))
    if (c.theme.snow) roof.push(tint(snowCap(0.3, 0.3, towerRise, deck + hutH + 0.3), c.snow))
  }

  const win: BufferGeometry[] = []
  const wy = deck + hutH * 0.52
  win.push(...windowQuads(hutW / 2, hutD / 2, wy, 0.11, 0.14, L === 1 ? [-0.11, 0.11] : [-0.15, 0.15], 0, hutZ))
  if (L >= 2) {
    win.push(...windowQuads(hutW / 2, hutD / 2, deck + hutH * 0.82, 0.09, 0.1, [0], 0, hutZ))
  }
  if (L === 3) {
    win.push(...windowQuads(0.12, 0.12, deck + hutH + 0.19, 0.08, 0.08, [0], -0.16, hutZ))
  }

  return {
    body: mergeParts(body),
    roof: mergeParts(roof),
    windows: mergeParts(win.map((g) => tint(g, WHITE))),
    roofPivotY: deck,
    heightJitter: jitterFor(L, 0.18),
  }
}

/** A palm: a leaning trunk and four drooping fronds. */
function palm(x: number, z: number, h: number, lean: number, c: Ctx): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const ty = 0.12 + h / 2
  const trunk = cyl(0.022, 0.032, h, 5)
  trunk.rotateZ(lean)
  trunk.translate(x, ty, z)
  out.push(tint(trunk, c.trim))
  const topY = 0.12 + h * Math.cos(lean)
  const topX = x + Math.sin(-lean) * h * 0.5
  for (let i = 0; i < 4; i++) {
    const frond = box(0.2, 0.016, 0.06, 0.1, 0, 0)
    frond.rotateZ(-0.34)
    frond.rotateY((i * Math.PI) / 2 + 0.4)
    frond.translate(topX, topY, z)
    out.push(tint(frond, c.leaf))
  }
  return out
}

/** A conifer: two stacked cones on a short trunk. */
function conifer(x: number, z: number, s: number, c: Ctx): BufferGeometry[] {
  return [
    tint(cyl(0.024, 0.03, 0.1 * s, 5, x, 0.12 + 0.05 * s, z), c.trim),
    tint(cone(0.15 * s, 0.28 * s, 6, x, 0.12 + 0.24 * s, z), c.leaf),
    tint(cone(0.1 * s, 0.2 * s, 6, x, 0.12 + 0.44 * s, z), c.leaf),
  ]
}

function parkParts(c: Ctx): Parts {
  const L = c.level
  const body: BufferGeometry[] = [tint(box(0.92, 0.12, 0.92, 0, 0.06, 0), WHITE)]
  const foliage: BufferGeometry[] = []
  const coast = c.biome === Biome.Coast
  const alpine = c.biome === Biome.Alpine

  if (coast) {
    // A boardwalk over sand rather than a mown path.
    for (const z of [-0.09, 0.01, 0.11]) {
      body.push(tint(box(0.86, 0.02, 0.06, 0, 0.125, z), c.trim))
    }
    foliage.push(...palm(-0.2, 0.14, 0.34, 0.14, c))
    if (L >= 2) foliage.push(...palm(0.22, -0.18, 0.4, -0.1, c))
    if (L === 3) {
      foliage.push(...palm(0.0, 0.26, 0.3, 0.2, c))
      foliage.push(...palm(-0.24, -0.2, 0.44, -0.16, c))
    }
    // Grass tufts and a bleached log, so the sand is not empty.
    foliage.push(tint(cone(0.07, 0.13, 5, 0.3, 0.18, 0.26), c.leaf))
    if (L >= 2) foliage.push(tint(cone(0.06, 0.11, 5, -0.32, 0.17, -0.06), c.leaf))
    if (L === 3) {
      foliage.push(tint(cyl(0.035, 0.035, 0.3, 6, 0.14, 0.15, -0.32), c.trim))
      foliage.push(tint(cone(0.06, 0.11, 5, 0.34, 0.17, -0.3), c.leaf))
    }
  } else if (alpine) {
    body.push(tint(box(0.9, 0.02, 0.16, 0, 0.125, -0.02), c.trim))
    // Snow patches lying on the grass.
    body.push(tint(box(0.3, 0.016, 0.22, -0.26, 0.128, -0.28), c.snow))
    body.push(tint(box(0.22, 0.016, 0.18, 0.28, 0.128, 0.3), c.snow))
    foliage.push(...conifer(-0.22, 0.2, 1, c))
    foliage.push(...conifer(0.26, -0.2, 0.82, c))
    if (L >= 2) foliage.push(...conifer(0.08, 0.26, 1.1, c))
    if (L === 3) {
      foliage.push(...conifer(-0.26, -0.24, 1.15, c))
      foliage.push(...conifer(0.3, 0.26, 0.92, c))
    }
    foliage.push(tint(blob(0.09, 0.06, 0.17, -0.3), c.trim))
    if (L >= 2) foliage.push(tint(blob(0.07, -0.02, 0.16, 0.32), c.trim))
  } else {
    body.push(tint(box(0.9, 0.02, 0.18, 0, 0.125, -0.02), c.trim))
    if (L >= 2) body.push(tint(box(0.18, 0.02, 0.9, 0.12, 0.125, 0), c.trim))
    foliage.push(tint(blob(0.12, -0.24, 0.2, 0.2), c.leaf))
    foliage.push(tint(blob(0.095, -0.06, 0.185, 0.28), c.leaf))
    foliage.push(tint(blob(0.1, 0.28, 0.19, 0.24), c.leaf))
    foliage.push(tint(cone(0.16, 0.3, 6, 0.2, 0.35, -0.22), c.leaf))
    foliage.push(tint(cyl(0.028, 0.034, 0.12, 5, 0.2, 0.18, -0.22), c.trim))
    if (L >= 2) {
      foliage.push(tint(cone(0.17, 0.34, 6, -0.26, 0.39, -0.24), c.leaf))
      foliage.push(tint(cyl(0.028, 0.034, 0.14, 5, -0.26, 0.19, -0.24), c.trim))
      foliage.push(tint(blob(0.09, 0.32, 0.18, -0.02), c.leaf))
    }
    if (L === 3) {
      foliage.push(tint(cone(0.19, 0.38, 6, 0.02, 0.43, 0.24), c.leaf))
      foliage.push(tint(cyl(0.03, 0.036, 0.16, 5, 0.02, 0.2, 0.24), c.trim))
      // A clipped hedge and a bench: a garden rather than a green square.
      foliage.push(tint(box(0.56, 0.13, 0.1, -0.1, 0.185, 0.36), c.leaf))
      foliage.push(tint(box(0.2, 0.03, 0.08, 0.3, 0.19, 0.12), c.trim))
      foliage.push(tint(box(0.2, 0.06, 0.02, 0.3, 0.22, 0.16), c.trim))
    }
  }

  return {
    body: mergeParts(body),
    roof: mergeParts(foliage),
    windows: null,
    roofPivotY: 0.12,
    heightJitter: jitterFor(L, 0.12),
  }
}

function buildParts(type: BuildingType, biome: Biome, level: number): Parts {
  const t = THEMES[type][biome]
  const wall = new Color().setHex(t.wall, SRGBColorSpace)
  const c: Ctx = {
    theme: t,
    biome: biome as Biome,
    level,
    roof: ratioOf(wall, new Color().setHex(t.roof, SRGBColorSpace)),
    trim: ratioOf(wall, new Color().setHex(t.trim, SRGBColorSpace)),
    leaf: ratioOf(wall, new Color().setHex(t.foliage, SRGBColorSpace)),
    snow: ratioOf(wall, new Color().setHex(SNOW_COLOR, SRGBColorSpace)),
  }
  switch (type) {
    case 'park':
      return parkParts(c)
    case 'shop':
      return shopParts(c)
    case 'factory':
      return factoryParts(c)
    case 'station':
      return stationParts(c)
    default:
      return houseParts(c)
  }
}

// ---------------------------------------------------------------------------
// Merging the looks into one geometry per part
// ---------------------------------------------------------------------------

const BIOME_COUNT = 3
/** 3 biomes x 3 levels. Index: biome * MAX_LEVEL + (level - 1). */
const LOOK_COUNT = BIOME_COUNT * MAX_LEVEL

function lookIndex(biome: number, level: number): number {
  const b = biome >= 0 && biome < BIOME_COUNT ? Math.floor(biome) : 0
  const l = Number.isFinite(level)
    ? Math.min(MAX_LEVEL, Math.max(1, Math.round(level)))
    : 1
  return b * MAX_LEVEL + (l - 1)
}

interface PartSet {
  geometry: BufferGeometry
  /** Vertex range of each look inside the merged geometry. */
  ranges: { start: number; count: number }[]
  /** Local-space bounds of each look, for the cheap raycast reject. */
  boxes: Box3[]
  /** The instanced attribute selecting a look. Shared with nothing else. */
  look: InstancedBufferAttribute
}

/**
 * Merge the nine looks of one part into a single geometry, tagging each vertex
 * with the look it belongs to and remembering where it landed.
 */
function mergeLooks(geoms: BufferGeometry[]): PartSet {
  const ranges: { start: number; count: number }[] = []
  const boxes: Box3[] = []
  let start = 0
  for (const g of geoms) {
    const count = g.getAttribute('position').count
    g.computeBoundingBox()
    boxes.push(g.boundingBox ? g.boundingBox.clone() : new Box3())
    ranges.push({ start, count })
    start += count
    const ids = new Float32Array(count)
    ids.fill(ranges.length - 1)
    g.setAttribute('variantId', new BufferAttribute(ids, 1))
  }
  const merged = mergeGeometries(geoms, false)
  for (const g of geoms) g.dispose()
  if (!merged) throw new Error('render/buildings: look merge failed')
  const look = new InstancedBufferAttribute(new Float32Array(TILE_COUNT), 1)
  merged.setAttribute('aLook', look)
  return { geometry: merged, ranges, boxes, look }
}

/**
 * Collapse every triangle that does not belong to the instance's look. A
 * degenerate triangle is discarded before rasterisation, so nine looks cost one
 * mesh and one draw call rather than nine of each.
 */
function selectLooks(material: Material): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute float variantId;\nattribute float aLook;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nif (abs(variantId - aLook) > 0.5) transformed = vec3(0.0);',
      )
  }
  material.customProgramCacheKey = () => 'idle-city-look-select-' + material.type
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

interface Record_ {
  tile: number
  variant: number
  /** Which of the nine biome x level looks this instance wears. */
  look: number
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

interface LookInfo {
  roofPivotY: number
  heightJitter: number
}

interface TypeEntry {
  type: BuildingType
  looks: LookInfo[]
  bodyPart: PartSet
  roofPart: PartSet
  windowPart: PartSet | null
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
  // The shadow pass never sees bodyMaterial, so it needs its own copy of the
  // look selection or every building would cast its level 3 shadow.
  const depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
  selectLooks(bodyMaterial)
  selectLooks(windowMaterial)
  selectLooks(depthMaterial)

  const entries = new Map<BuildingType, TypeEntry>()
  const byMesh = new Map<Object3D, TypeEntry>()
  const pickables: Object3D[] = []

  // Picking: the merged geometry holds all nine looks, so the default instanced
  // raycast would let you click the silhouette of a building that is not there.
  // Reject on the look's own bounds, then test only its slice of the geometry.
  const emptyGeometry = new BufferGeometry()
  const scratchMesh = new Mesh(emptyGeometry)
  const instMatrix = new Matrix4()
  const worldMatrix = new Matrix4()
  const invMatrix = new Matrix4()
  const localRay = new Ray()
  const subHits: Intersection[] = []

  function raycastLooks(
    mesh: InstancedMesh,
    entry: TypeEntry,
    part: PartSet,
    raycaster: Raycaster,
    intersects: Intersection[],
  ): void {
    scratchMesh.geometry = part.geometry
    scratchMesh.material = mesh.material as Material
    for (let i = 0; i < mesh.count; i++) {
      const r = entry.records[i]
      if (!r) continue
      mesh.getMatrixAt(i, instMatrix)
      worldMatrix.multiplyMatrices(mesh.matrixWorld, instMatrix)
      // Mid-spawn an instance is scaled to nothing and cannot be inverted.
      if (Math.abs(worldMatrix.determinant()) < 1e-9) continue
      invMatrix.copy(worldMatrix).invert()
      localRay.copy(raycaster.ray).applyMatrix4(invMatrix)
      if (!localRay.intersectsBox(part.boxes[r.look])) continue
      const range = part.ranges[r.look]
      part.geometry.setDrawRange(range.start, range.count)
      scratchMesh.matrixWorld.copy(worldMatrix)
      scratchMesh.raycast(raycaster, subHits)
      for (const hit of subHits) {
        hit.object = mesh
        hit.instanceId = i
        intersects.push(hit)
      }
      subHits.length = 0
    }
    part.geometry.setDrawRange(0, Infinity)
  }

  function makeMesh(geom: BufferGeometry, mat: Material, shadows: boolean): InstancedMesh {
    const mesh = new InstancedMesh(geom, mat, TILE_COUNT)
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.castShadow = shadows
    mesh.receiveShadow = shadows
    if (shadows) mesh.customDepthMaterial = depthMaterial
    // Allocate the instance colour buffer up front so it is never null later.
    for (let i = 0; i < TILE_COUNT; i++) mesh.setColorAt(i, WHITE)
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    return mesh
  }

  // Ghost preview geometry: one merged body+roof per type per biome, always at
  // level 1, since that is what a fresh placement builds.
  const ghostGeoms = new Map<string, BufferGeometry>()
  const ghosts = new Map<BuildingType, Mesh>()

  for (const type of BUILDING_TYPES) {
    const parts: Parts[] = []
    for (let biome = 0; biome < BIOME_COUNT; biome++) {
      for (let level = 1; level <= MAX_LEVEL; level++) {
        parts.push(buildParts(type, biome, level))
      }
    }

    for (let biome = 0; biome < BIOME_COUNT; biome++) {
      const p = parts[lookIndex(biome, 1)]
      const clones = [p.body.clone(), p.roof.clone()]
      const geom = mergeGeometries(clones, false)
      for (const c of clones) c.dispose()
      if (!geom) throw new Error('render/buildings: ghost merge failed')
      ghostGeoms.set(type + ':' + biome, geom)
    }

    const bodyPart = mergeLooks(parts.map((p) => p.body))
    const roofPart = mergeLooks(parts.map((p) => p.roof))
    const windowGeoms = parts.map((p) => p.windows).filter((g): g is BufferGeometry => !!g)
    const windowPart = windowGeoms.length === LOOK_COUNT ? mergeLooks(windowGeoms) : null
    if (!windowPart) for (const g of windowGeoms) g.dispose()

    const bodyMesh = makeMesh(bodyPart.geometry, bodyMaterial, true)
    const roofMesh = makeMesh(roofPart.geometry, bodyMaterial, true)
    let windowMesh: InstancedMesh | null = null
    if (windowPart) {
      windowMesh = new InstancedMesh(windowPart.geometry, windowMaterial, TILE_COUNT)
      windowMesh.count = 0
      windowMesh.frustumCulled = false
      windowMesh.castShadow = false
      windowMesh.receiveShadow = false
      for (let i = 0; i < TILE_COUNT; i++) windowMesh.setColorAt(i, WHITE)
      if (windowMesh.instanceColor) windowMesh.instanceColor.needsUpdate = true
      scene.add(windowMesh)
    }
    scene.add(bodyMesh, roofMesh)

    const entry: TypeEntry = {
      type,
      looks: parts.map((p) => ({ roofPivotY: p.roofPivotY, heightJitter: p.heightJitter })),
      bodyPart,
      roofPart,
      windowPart,
      bodyMesh,
      roofMesh,
      windowMesh,
      records: [],
    }
    bodyMesh.raycast = (raycaster, intersects) =>
      raycastLooks(bodyMesh, entry, bodyPart, raycaster, intersects)
    roofMesh.raycast = (raycaster, intersects) =>
      raycastLooks(roofMesh, entry, roofPart, raycaster, intersects)

    entries.set(type, entry)
    byMesh.set(bodyMesh, entry)
    byMesh.set(roofMesh, entry)
    pickables.push(bodyMesh, roofMesh)

    const ghost = new Mesh(ghostGeoms.get(type + ':0')!, ghostMaterial)
    ghost.visible = false
    ghost.castShadow = false
    ghost.receiveShadow = false
    ghost.renderOrder = 5
    scene.add(ghost)
    ghosts.set(type, ghost)
  }

  const hsl = { h: 0, s: 0, l: 0 }
  /** Body colour per type per biome: the divisor every vertex ratio was built against. */
  const baseColors = new Map<string, Color>()
  for (const type of BUILDING_TYPES) {
    for (let biome = 0; biome < BIOME_COUNT; biome++) {
      baseColors.set(
        type + ':' + biome,
        new Color().setHex(THEMES[type][biome].wall, SRGBColorSpace),
      )
    }
  }

  function jitteredColor(type: BuildingType, biome: number, variant: number): Color {
    const base = baseColors.get(type + ':' + biome)!
    base.getHSL(hsl, SRGBColorSpace)
    const j = variant - 0.5
    return new Color().setHSL(
      hsl.h + j * 0.05,
      clamp01(hsl.s * (1 + j * 0.4)),
      clamp01(hsl.l + j * 0.1),
      SRGBColorSpace,
    )
  }

  /** Biome per tile from the last sync, so the ghost can match its ground. */
  let biomeMap: Uint8Array | null = null

  function sync(state: CityState): void {
    // Carry the smoothed dereliction across a rebuild so it does not restart.
    const carry = new Map<number, { bornAt: number; amt: number }>()
    for (const entry of entries.values()) {
      for (const r of entry.records) carry.set(r.tile, { bornAt: r.bornAt, amt: r.derelictAmt })
      entry.records.length = 0
    }

    const terrain = terrainFor(state)
    biomeMap = terrain.biome

    for (let tile = 0; tile < state.grid.length; tile++) {
      const b = state.grid[tile]
      if (!b) continue
      const entry = entries.get(b.type)
      if (!entry) continue
      const biome = terrain.biome[tile] as Biome
      const look = lookIndex(biome, b.level)
      const prev = carry.get(tile)
      const amt =
        prev && prev.bornAt === b.bornAt ? prev.amt : b.derelict ? 1 : 0
      entry.records.push({
        tile,
        variant: b.variant,
        look,
        bornAt: b.bornAt,
        derelict: b.derelict,
        derelictAmt: amt,
        color: jitteredColor(b.type, biome, b.variant),
        // Four cardinal orientations plus a couple of degrees of slop, so a row
        // of identical houses does not read as a repeated stamp.
        yaw: Math.floor(b.variant * 4) * (Math.PI / 2) + (b.variant - 0.5) * 0.09,
        heightScale: 1 + (b.variant - 0.5) * entry.looks[look].heightJitter,
        lean: (b.variant - 0.5) * 2,
      })
    }

    for (const entry of entries.values()) {
      const n = entry.records.length
      entry.bodyMesh.count = n
      entry.roofMesh.count = n
      if (entry.windowMesh) entry.windowMesh.count = n
      for (let i = 0; i < n; i++) {
        const look = entry.records[i].look
        entry.bodyPart.look.setX(i, look)
        entry.roofPart.look.setX(i, look)
        if (entry.windowPart) entry.windowPart.look.setX(i, look)
      }
      entry.bodyPart.look.needsUpdate = true
      entry.roofPart.look.needsUpdate = true
      if (entry.windowPart) entry.windowPart.look.needsUpdate = true
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
      const { records, bodyMesh, roofMesh, windowMesh, looks } = entry
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
          pivotUp.makeTranslation(0, looks[r.look].roofPivotY, 0)
          pivotDown.makeTranslation(0, -looks[r.look].roofPivotY, 0)
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
    const biome = tile !== null && biomeMap ? biomeMap[tile] : 0
    for (const [t, mesh] of ghosts) {
      const on = type === t && tile !== null
      mesh.visible = on
      if (!on) continue
      const geom = ghostGeoms.get(t + ':' + biome)
      if (geom) mesh.geometry = geom
      const w = tileToWorld(tile!)
      mesh.position.set(w.x, 0.01, w.z)
      mesh.rotation.set(0, 0, 0)
      mesh.scale.set(1, 1, 1)
    }
    if (type) {
      ghostMaterial.color.copy(
        blocked ? dangerColor : baseColors.get(type + ':' + biome)!,
      )
      ghostMaterial.opacity = blocked ? 0.42 : 0.5
    }
  }

  function dispose(): void {
    for (const entry of entries.values()) {
      scene.remove(entry.bodyMesh, entry.roofMesh)
      entry.bodyMesh.dispose()
      entry.roofMesh.dispose()
      entry.bodyPart.geometry.dispose()
      entry.roofPart.geometry.dispose()
      if (entry.windowMesh) {
        scene.remove(entry.windowMesh)
        entry.windowMesh.dispose()
      }
      entry.windowPart?.geometry.dispose()
      entry.records.length = 0
    }
    for (const mesh of ghosts.values()) scene.remove(mesh)
    for (const geom of ghostGeoms.values()) geom.dispose()
    bodyMaterial.dispose()
    windowMaterial.dispose()
    ghostMaterial.dispose()
    depthMaterial.dispose()
    // Drop the layer's geometry from the picking scratch before it goes away.
    scratchMesh.geometry = emptyGeometry
    entries.clear()
    byMesh.clear()
    ghosts.clear()
    ghostGeoms.clear()
    baseColors.clear()
    pickables.length = 0
    biomeMap = null
  }

  return { pickables, sync, update, tileForHit, setGhost, dispose }
}
