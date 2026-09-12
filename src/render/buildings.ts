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
 *
 * The one exception is the merged 2x2 block: it draws as a single instance on
 * its anchor tile, centred on the block and scaled MERGE_SCALE x
 * MERGE_HEIGHT_SCALE x MERGE_SCALE, so its half-extent doubles — but the block
 * owns four whole tiles, and 2 x 0.43 still fits inside them with margin.
 * A merged anchor also swaps its look for a dedicated maxi one, indexed past
 * the standard looks (see mergedLookIndex / mergedShopLookIndex). Maxi looks
 * are authored in the same local +/-0.5 as everything else — which renders as
 * the full 2x2 block — so they are built as a cluster of sub-volumes the size
 * of an ordinary building, not as one stretched monolith. Every type and
 * maxi kind now has a dedicated maxi piece EXCEPT the landfill, whose merged
 * "scrap mountain" deliberately keeps the standard level 3 heap, just scaled
 * up — that fallback is its intended render path, not a gap to fill.
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
import { BUILDINGS, BUILDING_TYPES, COMMERCE_KINDS, MAXI_COMMERCE_KINDS } from '../sim/buildings'
import { MAX_LEVEL, TILE_COUNT, WORLD_SIZE } from '../sim/config'
import { tileToWorld, tileX, tileZ } from '../sim/grid'
import { isMergedBlock } from '../sim/merge'
import { Biome, terrainFor } from '../sim/terrain'
import type { BuildingType, CityState, CommerceKind } from '../sim/types'
import {
  DANGER_COLOR,
  DERELICT_TINT,
  RING_GOOD,
  WINDOW_GLOW,
  bouncePulse,
  clamp01,
  easeOutBack,
  pulseFade,
  setSrgb,
  smoothstep,
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

/** `sy` flattens or stretches the blob vertically before it is placed — a
 * landfill heap is a squashed blob, not a round one, and the squash is what
 * sells it. */
function blob(r: number, x = 0, y = 0, z = 0, sy = 1): BufferGeometry {
  const g = new IcosahedronGeometry(r, 0)
  if (sy !== 1) g.scale(1, sy, 1)
  g.translate(x, y, z)
  return g
}

/**
 * A small low-poly "up" arrow: a hexagonal shaft topped by a hexagonal cone,
 * pivoted at its own tail (y=0) rather than centred. That tail is what the
 * level-up/level-down floater positions and rotates about, so rotating this
 * one shape 180 degrees about X is all a "down" arrow needs — the cone ends
 * up at the bottom, pointing the other way, still anchored at the same point.
 */
function arrowGeometry(): BufferGeometry {
  const shaftH = 0.17
  const headH = 0.14
  const parts = [
    cyl(0.022, 0.022, shaftH, 6, 0, shaftH / 2, 0),
    cone(0.068, headH, 6, 0, shaftH + headH / 2, 0),
  ]
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  if (!merged) throw new Error('render/buildings: arrow merge failed')
  return merged
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
  school: [
    plainTheme('school', 0xf3e8d6, 0x6fa473),
    theme(0xf2ead9, 0x8fb9be, 0xfdf7ea, 0x8fb87c, 0.45, false),
    theme(0xa8825f, 0x64564b, 0xdccbb0, 0x4c7a5a, 1.55, true),
  ],
  harbour: [
    plainTheme('harbour', 0xeef2ee, 0x6fa473),
    theme(0xe6efee, 0x6f9aa2, 0xffffff, 0x8fb87c, 0.35, false),
    theme(0x8c9a97, 0x4d6469, 0xd3dcd8, 0x4c7a5a, 1.35, true),
  ],
  landfill: [
    plainTheme('landfill', 0xb7ad9a, 0x8a9a6e),
    theme(0xa9a893, 0x6e675c, 0xc8c2ac, 0x8a9a6e, 0.3, false),
    theme(0x7f7a6c, 0x565248, 0xa8a292, 0x60775a, 0.3, true),
  ],
  park: [
    plainTheme('park', 0xd9cdb4, BUILDINGS.park.roofColor),
    theme(0xdccca6, 0x86ae74, 0xf0e6cd, 0x86ae74, 1.0, false),
    theme(0x86a887, 0x49775a, 0xc4c1b8, 0x49775a, 1.0, true),
  ],
}

/**
 * Indexed by CommerceKind then Biome, in place of `THEMES.shop` for the shop
 * type specifically. `general` IS `THEMES.shop` — the plain, unbranded shop —
 * so a city with commerce kinds turned off (or a shop saved before they
 * existed) looks exactly as it always has.
 *
 * The four maxi kinds sit here too: a merged block gets its own palette, and
 * each of them has dedicated geometry (see shopParts when `c.merged`).
 */
const SHOP_THEMES: Record<CommerceKind, Theme[]> = {
  general: THEMES.shop,
  restaurant: [
    theme(0xf6e6d8, 0xb2483b, 0xffffff, 0x6fa473, 1.0, false),
    theme(0xf7ede1, 0xc97a68, 0xffffff, 0x8fb87c, 0.45, false),
    theme(0xa97a5e, 0x7a3b30, 0xe8c9a8, 0x4c7a5a, 1.55, true),
  ],
  clothing: [
    theme(0xf3e6ef, 0x8a6f95, 0xffffff, 0x6fa473, 1.0, false),
    theme(0xf6edf2, 0x9ab0c9, 0xffffff, 0x8fb87c, 0.45, false),
    theme(0xa78ba0, 0x5c4f63, 0xe0cfe0, 0x4c7a5a, 1.55, true),
  ],
  konbini: [
    theme(0xeaf2f0, 0x1f6f58, 0x3fa9dc, 0x6fa473, 1.0, false),
    theme(0xecf4f3, 0x4aa0a6, 0x5cc0e0, 0x8fb87c, 0.45, false),
    theme(0x7d8f8a, 0x203b34, 0x3fa9dc, 0x4c7a5a, 1.55, true),
  ],
  // Warm amber and cream: the food court keeps the restaurant's warmth but
  // trades its brick red for a food-hall orange.
  food_court: [
    theme(0xf7e2c6, 0xd4762a, 0xfff3e0, 0x6fa473, 1.0, false),
    theme(0xf8ecda, 0xdd9a62, 0xffffff, 0x8fb87c, 0.45, false),
    theme(0xb08258, 0x8a4a24, 0xeac9a0, 0x4c7a5a, 1.55, true),
  ],
  // Navy and brass: the department store reads grander than the boutique's mauve.
  department_store: [
    theme(0xe9e6ee, 0x3e5a78, 0xd8c28a, 0x6fa473, 1.0, false),
    theme(0xeef0f2, 0x6a89a8, 0xf2e6c8, 0x8fb87c, 0.45, false),
    theme(0x8d8578, 0x2f4257, 0xc9b58a, 0x4c7a5a, 1.55, true),
  ],
  // Big-box gold over dark slate: louder and plainer than the konbini's teal.
  supermarket: [
    theme(0xf2eedd, 0xd9a92c, 0x3a4350, 0x6fa473, 1.0, false),
    theme(0xf6f3e6, 0xe0bc60, 0x5a6675, 0x8fb87c, 0.45, false),
    theme(0xa08a64, 0x8a6d1e, 0x3c4654, 0x4c7a5a, 1.55, true),
  ],
  // Copper and brass, the galleria look: what four general stores grow into.
  arcade: [
    theme(0xead9c2, 0x8a5a3b, 0xd9b36a, 0x6fa473, 1.0, false),
    theme(0xf2e6d4, 0xa87f5e, 0xecd9a8, 0x8fb87c, 0.45, false),
    theme(0x9a7350, 0x5e3f2c, 0xc9a25e, 0x4c7a5a, 1.55, true),
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
/** A rust ratio for barrels and scrap: warmer and more saturated than the
 * wall, so the odd prop reads as "junk" against any of the nine looks. */
const RUST = new Color(1.5, 0.82, 0.5)

interface Ctx {
  theme: Theme
  biome: Biome
  level: number
  roof: Color
  trim: Color
  leaf: Color
  snow: Color
  /** Which commerce kind a shop is drawn as. Every other type ignores it. */
  kind: CommerceKind
  /**
   * True while building a maxi look — the dedicated geometry a merged 2x2
   * anchor wears. Always level 3; a type or kind without a dedicated maxi
   * piece simply falls through to its standard level 3 parts.
   */
  merged: boolean
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

/**
 * The apartment block: what a merged 2x2 of houses becomes. Authored in the
 * local +/-0.5 that MERGE_SCALE renders as the whole block, so each wing is
 * sized like one ordinary house (~0.26 local renders ~0.52 world) — the read
 * is "four houses that grew together", not one house stretched to twice its
 * size. Two things make that read work in close-up: a real gap between the
 * wings (0.18 local, wide enough to throw its own shadow, meeting in a
 * cross-shaped courtyard open to the ground) and no shared plinth — each
 * wing starts at the ground with its own dark ground floor, exactly the way
 * the L3 house does. Windows are mandatory: a type's windowPart only exists
 * if every look provides some, and this is one of the house's looks.
 */
function maxiHouseParts(c: Ctx): Parts {
  const wing = 0.26
  const half = wing / 2
  const wingH = 0.6
  const off = 0.22 // wing centres; a 0.18 gap between wings, visible to the ground

  const body: BufferGeometry[] = []
  const roof: BufferGeometry[] = []
  const win: BufferGeometry[] = []
  const rise = 0.12 * c.theme.pitch
  let i = 0
  for (const cx of [-off, off]) {
    for (const cz of [-off, off]) {
      body.push(tint(box(wing, wingH, wing, cx, wingH / 2, cz), WHITE))
      // Each wing gets its own dark ground floor — four ground floors, not a
      // shared slab, so the gaps between wings stay open all the way down.
      body.push(tint(box(wing + 0.008, 0.14, wing + 0.008, cx, 0.07, cz), DARKEN))
      // Balcony bands repeated up each wing, the same trim device the L3 house
      // uses, here wrapping the wing so every outward face gets them.
      body.push(tint(box(wing + 0.02, 0.03, wing + 0.02, cx, 0.32, cz), c.trim))
      body.push(tint(box(wing + 0.02, 0.03, wing + 0.02, cx, 0.5, cz), c.trim))
      // Each wing keeps its own little gable; alternating the ridge direction
      // keeps the cluster from reading as one roof sawn into quarters.
      const prism = gableGeometry(wing + 0.06, wing + 0.06, rise)
      if (i % 2 === 1) prism.rotateY(Math.PI / 2)
      prism.translate(cx, wingH, cz)
      roof.push(tint(prism, c.roof))
      if (c.theme.snow) {
        const cap = snowCap(wing + 0.06, wing + 0.06, rise, wingH)
        if (i % 2 === 1) cap.rotateY(Math.PI / 2)
        roof.push(tint(cap.translate(cx, 0, cz), c.snow))
      }
      win.push(...windowQuads(half, half, 0.26, 0.08, 0.1, [-0.06, 0.06], cx, cz))
      win.push(...windowQuads(half, half, 0.44, 0.08, 0.1, [-0.06, 0.06], cx, cz))
      i++
    }
  }

  return {
    body: mergeParts(body),
    roof: mergeParts(roof),
    windows: mergeParts(win.map((g) => tint(g, WHITE))),
    roofPivotY: wingH,
    heightJitter: jitterFor(MAX_LEVEL, 0.3),
  }
}

/**
 * The food court: the dedicated maxi piece a merged shop block wearing
 * 'food_court' draws. Four small counters at the corners of the block, each
 * under its own mini striped awning (a wink at the restaurant that seeds the
 * merge), around a low central hall beneath one big flat canopy. Same rule as
 * maxiHouseParts: sized like a cluster of ordinary pieces in the local
 * +/-0.5, and windows are mandatory so the shop type keeps its windowPart.
 */
function foodCourtParts(c: Ctx): Parts {
  const body: BufferGeometry[] = []
  const roof: BufferGeometry[] = []
  const win: BufferGeometry[] = []

  // The central hall, low and broad: a food hall, not a tower.
  const hall = 0.5
  const hallH = 0.3
  body.push(tint(box(hall, hallH, hall, 0, hallH / 2, 0), WHITE))

  // Four counters at the corners, each with a mini striped awning.
  const cw = 0.2
  const ch = 0.22
  const awn = cw + 0.08
  for (const cx of [-0.28, 0.28]) {
    for (const cz of [-0.28, 0.28]) {
      body.push(tint(box(cw, ch, cw, cx, ch / 2, cz), WHITE))
      body.push(tint(box(awn, 0.025, awn, cx, ch + 0.06, cz), c.roof))
      for (const sx of [-0.055, 0.055]) {
        body.push(tint(box(0.07, 0.02, awn - 0.02, cx + sx, ch + 0.085, cz), c.snow))
      }
      win.push(...windowQuads(cw / 2, cw / 2, 0.11, 0.12, 0.1, [0], cx, cz))
    }
  }

  // One big flat canopy over the whole court, on four slim posts. It sits in
  // the roof group so a derelict food court sags from the top like any shop.
  const awnY = 0.42
  for (const px of [-0.42, 0.42]) {
    for (const pz of [-0.42, 0.42]) {
      body.push(tint(box(0.03, awnY, 0.03, px, awnY / 2, pz), c.trim))
    }
  }
  roof.push(tint(box(0.92, 0.04, 0.92, 0, awnY + 0.02, 0), c.roof))

  // A continuous glazed band around the hall's ground floor: the "come in,
  // it's all food" read, wide the way a shopfront window already is.
  win.push(...windowQuads(hall / 2, hall / 2, 0.14, 0.44, 0.18, [0]))

  return {
    body: mergeParts(body),
    roof: mergeParts(roof),
    windows: mergeParts(win.map((g) => tint(g, WHITE))),
    roofPivotY: awnY,
    heightJitter: jitterFor(MAX_LEVEL, 0.2),
  }
}

/**
 * The department store: one grand block rather than a cluster, its grandeur
 * carried by the two full-width brass cornices that scan the facade and by a
 * colonnade entrance (three pilasters under a protruding marquee) rather than
 * by extra volumes. The double rooftop sign enlarges the L3 shop's single
 * panel into two leaves with a slit of daylight between them. Windows are
 * mandatory so the shop type keeps its windowPart.
 */
function departmentStoreParts(c: Ctx): Parts {
  const bw = 0.6
  const half = bw / 2
  const H = 0.52

  const body: BufferGeometry[] = [tint(box(bw, H, bw, 0, H / 2, 0), WHITE)]
  // A dark ground floor, the same device the L3 house and apartment use.
  body.push(tint(box(bw + 0.008, 0.16, bw + 0.008, 0, 0.08, 0), DARKEN))
  // Two brass cornices, full width, scanning the single body into storeys.
  body.push(tint(box(bw + 0.02, 0.035, bw + 0.02, 0, 0.24, 0), c.trim))
  body.push(tint(box(bw + 0.02, 0.035, bw + 0.02, 0, 0.42, 0), c.trim))
  // The colonnade entrance: three pilasters on the front face under a
  // marquee that juts past the wall at clearance height.
  for (const x of [-0.14, 0, 0.14]) {
    body.push(tint(box(0.05, 0.36, 0.04, x, 0.18, half + 0.012), c.trim))
  }
  body.push(tint(box(0.44, 0.035, 0.14, 0, 0.38, half + 0.05), c.roof))

  const roof: BufferGeometry[] = [tint(box(0.66, 0.07, 0.66, 0, H + 0.035, 0), c.roof)]
  // The rooftop sign in two leaves, the L3 panel doubled with a gap of sky.
  for (const x of [-0.19, 0.19]) {
    roof.push(tint(box(0.32, 0.2, 0.04, x, H + 0.17, -0.05), c.trim))
  }

  const win: BufferGeometry[] = []
  win.push(...windowQuads(half, half, 0.12, 0.44, 0.14, [0]))
  win.push(...windowQuads(half, half, 0.33, 0.1, 0.12, [-0.16, 0, 0.16]))
  win.push(...windowQuads(half, half, 0.47, 0.09, 0.09, [-0.16, 0, 0.16]))

  return {
    body: mergeParts(body),
    roof: mergeParts(roof),
    windows: mergeParts(win.map((g) => tint(g, WHITE))),
    roofPivotY: H,
    heightJitter: jitterFor(MAX_LEVEL, 0.2),
  }
}

/**
 * The supermarket: a low big-box under an overhanging parapet, one wide gold
 * fascia across the whole front, and a skylight box on the flat roof. Kept to
 * a single low volume on purpose — the read is "big shed, big sign" — with
 * the parapet up at clearance height so it never becomes a parking slab.
 * Windows are mandatory so the shop type keeps its windowPart.
 */
function supermarketParts(c: Ctx): Parts {
  const bw = 0.8
  const half = bw / 2
  const H = 0.34

  const body: BufferGeometry[] = [tint(box(bw, H, bw, 0, H / 2, 0), WHITE)]
  // The gold fascia, full front, nearly flush like the file's other bands.
  body.push(tint(box(bw + 0.03, 0.11, 0.03, 0, 0.26, half - 0.006), c.roof))

  const roof: BufferGeometry[] = []
  // The overhanging parapet caps the box; the skylight sits behind it.
  roof.push(tint(box(0.86, 0.07, 0.86, 0, H + 0.035, 0), c.roof))
  roof.push(tint(box(0.3, 0.07, 0.22, 0.1, H + 0.1, -0.08), c.snow))

  const win: BufferGeometry[] = []
  win.push(...windowQuads(half, half, 0.11, 0.52, 0.15, [0]))

  return {
    body: mergeParts(body),
    roof: mergeParts(roof),
    windows: mergeParts(win.map((g) => tint(g, WHITE))),
    roofPivotY: H,
    heightJitter: jitterFor(MAX_LEVEL, 0.15),
  }
}

/**
 * The shopping arcade: two narrow wings flanking a real open gallery (a 0.4
 * gap of daylight between them), the gallery roofed by one wide pale barrel
 * vault that rests on the wing tops. Darkened porticos framed in brass open
 * on the two opposite faces, and two small cupolas mark opposite corners.
 * Windows are mandatory so the shop type keeps its windowPart.
 */
function arcadeParts(c: Ctx): Parts {
  const wingW = 0.22
  const wingD = 0.66
  const wingH = 0.3
  const off = 0.31

  const body: BufferGeometry[] = []
  const roof: BufferGeometry[] = []
  const win: BufferGeometry[] = []
  for (const cx of [-off, off]) {
    body.push(tint(box(wingW, wingH, wingD, cx, wingH / 2, 0), WHITE))
    body.push(tint(box(wingW + 0.02, 0.03, wingD + 0.02, cx, wingH - 0.05, 0), c.trim))
    win.push(...windowQuads(wingW / 2, wingD / 2, 0.15, 0.08, 0.11, [-0.15, 0, 0.15], cx, 0))
  }
  // The gallery floor between the wings, open to the sky at both ends.
  body.push(tint(box(0.34, 0.02, 0.86, 0, 0.01, 0), c.trim))
  // The porticos: dark openings on the two opposite faces, brass-framed.
  for (const cz of [-0.345, 0.345]) {
    body.push(tint(box(0.18, 0.28, 0.05, 0, 0.14, cz), DARKEN))
    for (const x of [-0.11, 0.11]) {
      body.push(tint(box(0.03, 0.3, 0.03, x, 0.15, cz + Math.sign(cz) * 0.015), c.trim))
    }
    body.push(tint(box(0.26, 0.04, 0.04, 0, 0.32, cz + Math.sign(cz) * 0.015), c.trim))
  }

  // The barrel vault over the gallery, in the roof group so a derelict arcade
  // sags from the glass like any shop sags from its roof.
  const vault = gableGeometry(0.46, 0.7, 0.2)
  vault.translate(0, wingH, 0)
  roof.push(tint(vault, c.snow))
  // Two cupolas at opposite corners, on the wing tops.
  for (const [cx, cz] of [
    [off, 0.26],
    [-off, -0.26],
  ]) {
    roof.push(tint(cyl(0.055, 0.065, 0.08, 8, cx, wingH + 0.04, cz), c.trim))
    roof.push(tint(cone(0.07, 0.09, 8, cx, wingH + 0.125, cz), c.roof))
  }

  return {
    body: mergeParts(body),
    roof: mergeParts(roof),
    windows: mergeParts(win.map((g) => tint(g, WHITE))),
    roofPivotY: wingH,
    heightJitter: jitterFor(MAX_LEVEL, 0.2),
  }
}

function shopParts(c: Ctx): Parts {
  if (c.merged && c.kind === 'food_court') return foodCourtParts(c)
  if (c.merged && c.kind === 'department_store') return departmentStoreParts(c)
  if (c.merged && c.kind === 'supermarket') return supermarketParts(c)
  if (c.merged && c.kind === 'arcade') return arcadeParts(c)
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
  if (c.kind === 'restaurant') {
    // A striped awning reads at a glance, before the roof colour is even
    // checked. Sits a hair above the awning's own top surface so the two
    // never share a face.
    const stripeW = awnW / 6
    for (const x of [-stripeW * 2, 0, stripeW * 2]) {
      body.push(tint(box(stripeW * 0.9, 0.024, awnW - 0.02, x, awnY + 0.038, 0), c.snow))
    }
  }
  // A glazed shopfront band all the way round: more frontage, same footprint.
  body.push(tint(box(bw + 0.006, 0.02, bw + 0.006, 0, awnY - 0.24, 0), c.trim))
  if (c.kind === 'clothing') {
    // A rail behind the glass, low enough to clear the window at every level.
    body.push(tint(box(0.32, 0.035, 0.03, 0, 0.2, half - 0.02), DARKEN))
    for (const x of [-0.12, 0, 0.12]) {
      body.push(tint(box(0.045, 0.14, 0.03, x, 0.12, half - 0.02), c.trim))
    }
  } else if (c.kind === 'konbini') {
    // A lit sign over the door, brighter and taller with every level.
    const signH = L === 1 ? 0.14 : L === 2 ? 0.17 : 0.2
    body.push(tint(box(0.5, signH, 0.012, 0, awnY + 0.12, half - 0.002), c.trim))
    body.push(tint(box(0.44, signH - 0.05, 0.014, 0, awnY + 0.12, half - 0.001), c.snow))
  }
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
  if (L >= 2) {
    if (c.kind === 'restaurant') {
      // A small sidewalk-style board, flush with the wall like the fascia sign.
      body.push(tint(box(0.2, 0.15, 0.012, -half + 0.16, 0.19, half - 0.002), DARKEN))
      body.push(tint(box(0.16, 0.1, 0.014, -half + 0.16, 0.2, half - 0.001), c.snow))
    } else if (c.kind === 'clothing') {
      // A second rail: the boutique grew a floor of stock with the storefront.
      body.push(tint(box(0.32, 0.035, 0.03, 0, 0.36, half - 0.02), DARKEN))
      for (const x of [-0.12, 0, 0.12]) {
        body.push(tint(box(0.045, 0.12, 0.03, x, 0.29, half - 0.02), c.trim))
      }
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

/**
 * The industrial complex: what a merged 2x2 of factories becomes. Two
 * sawtooth halls face each other across an open yard (a 0.28 gap of daylight
 * between them, wide enough to throw its own shadow), with the big banded
 * chimney standing in that yard, a pair of grouped silos off one side and an
 * entrance gate off the other — a plant laid out like a plant, not one shed
 * stretched to fill the block. Windows are mandatory so the factory type
 * keeps its windowPart.
 */
function maxiFactoryParts(c: Ctx): Parts {
  const hallW = 0.44
  const hallD = 0.22
  const hallH = 0.32

  const body: BufferGeometry[] = []
  const roof: BufferGeometry[] = []
  const win: BufferGeometry[] = []
  for (const cz of [-0.25, 0.25]) {
    body.push(tint(box(hallW, hallH, hallD, 0, hallH / 2, cz), WHITE))
    body.push(tint(box(hallW + 0.008, 0.1, hallD + 0.008, 0, 0.05, cz), DARKEN))
    roof.push(tint(box(hallW + 0.02, 0.05, hallD + 0.02, 0, hallH + 0.025, cz), c.roof))
    // Sawtooth lights along each hall roof: the L3 motif, three teeth deep.
    for (const x of [-0.12, 0, 0.12]) {
      const saw = gableGeometry(0.13, hallD, 0.09)
      saw.translate(x, hallH + 0.05, cz)
      roof.push(tint(saw, c.trim))
    }
    if (c.theme.snow) {
      roof.push(tint(box(hallW + 0.04, 0.02, hallD + 0.04, 0, hallH + 0.06, cz), c.snow))
    }
    win.push(...windowQuads(hallW / 2, hallD / 2, 0.17, 0.08, 0.1, [-0.12, 0, 0.12], 0, cz))
  }

  // The central chimney in the yard between the halls, banded twice.
  body.push(tint(cyl(0.05, 0.07, 0.7, 8, 0, 0.35, 0), c.trim))
  body.push(tint(cyl(0.058, 0.058, 0.035, 8, 0, 0.52, 0), c.roof))
  body.push(tint(cyl(0.052, 0.052, 0.035, 8, 0, 0.66, 0), c.roof))

  // Two grouped silos off to one side, varied like the L3 stacks.
  body.push(tint(cyl(0.065, 0.065, 0.5, 10, 0.34, 0.25, -0.02), c.trim))
  body.push(tint(cyl(0.07, 0.07, 0.04, 10, 0.34, 0.52, -0.02), c.roof))
  body.push(tint(cyl(0.05, 0.05, 0.38, 10, 0.37, 0.19, 0.12), c.trim))
  body.push(tint(cyl(0.055, 0.055, 0.035, 10, 0.37, 0.395, 0.12), c.roof))

  // The entrance gate: two posts and a lintel, off to the other side.
  for (const z of [-0.1, 0.1]) {
    body.push(tint(box(0.045, 0.3, 0.045, -0.36, 0.15, z), DARKEN))
  }
  body.push(tint(box(0.05, 0.045, 0.26, -0.36, 0.32, 0), c.roof))

  return {
    body: mergeParts(body),
    roof: mergeParts(roof),
    windows: mergeParts(win.map((g) => tint(g, WHITE))),
    roofPivotY: hallH,
    heightJitter: jitterFor(MAX_LEVEL, 0.25),
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

/**
 * The botanical garden: what a merged 2x2 of parks becomes. One grand
 * central tree — a trunk and three stacked blobs, noticeably bigger than the
 * L3 park's cones — standing where the cross paths meet, a small glasshouse
 * (a pale prism on a trim base) in one corner, and bushes filling the rest.
 * Like the base park, all the greenery lives in the roof group and there are
 * no windows at all.
 */
function maxiParkParts(c: Ctx): Parts {
  const body: BufferGeometry[] = [tint(box(0.92, 0.1, 0.92, 0, 0.05, 0), WHITE)]
  // Cross paths meeting at the tree.
  body.push(tint(box(0.86, 0.02, 0.12, 0, 0.105, 0), c.trim))
  body.push(tint(box(0.12, 0.02, 0.86, 0, 0.105, 0), c.trim))
  // The glasshouse: a trim base with a pale prism roof, tucked in a corner.
  body.push(tint(box(0.22, 0.06, 0.18, 0.3, 0.13, 0.3), c.trim))
  const glass = gableGeometry(0.22, 0.18, 0.1)
  glass.translate(0.3, 0.16, 0.3)
  body.push(tint(glass, c.snow))

  const foliage: BufferGeometry[] = []
  // The grand tree at the centre.
  foliage.push(tint(cyl(0.045, 0.06, 0.3, 6, 0, 0.25, 0), c.trim))
  foliage.push(tint(blob(0.17, 0, 0.46, 0), c.leaf))
  foliage.push(tint(blob(0.135, 0, 0.58, 0), c.leaf))
  foliage.push(tint(blob(0.1, 0, 0.68, 0), c.leaf))
  // Bushes in the other corners, the park's own blob motif.
  foliage.push(tint(blob(0.09, -0.3, 0.16, 0.3), c.leaf))
  foliage.push(tint(blob(0.08, 0.31, 0.15, -0.29), c.leaf))
  foliage.push(tint(blob(0.09, -0.29, 0.16, -0.3), c.leaf))
  if (c.theme.snow) {
    // Snow settles on the path corners and the grand tree like it does on
    // the alpine park's own grass patches.
    body.push(tint(box(0.2, 0.016, 0.2, 0.31, 0.118, -0.31), c.snow))
    foliage.push(tint(blob(0.08, 0, 0.72, 0, 0.6), c.snow))
  }

  return {
    body: mergeParts(body),
    roof: mergeParts(foliage),
    windows: null,
    roofPivotY: 0.1,
    heightJitter: jitterFor(MAX_LEVEL, 0.12),
  }
}

function schoolParts(c: Ctx): Parts {
  const L = c.level
  // Broad and low on purpose: a school lifts a whole district a little, so it
  // should never dominate the block the way a house or shop does at the same
  // level. Growth reads through the window count and the cupola, not through
  // height — the opposite of every other building in this file.
  const H = L === 1 ? 0.34 : L === 2 ? 0.4 : 0.46
  const bw = 0.8
  const half = bw / 2

  const body: BufferGeometry[] = [tint(box(bw, H, bw, 0, H / 2, 0), WHITE)]
  // A dark doorway recess, flush with the wall: an entrance without spending
  // a single vertex on protruding past the footprint.
  body.push(tint(box(0.26, H * 0.55, 0.012, 0, H * 0.275, half - 0.002), DARKEN))
  if (L >= 2) {
    // A stone beltcourse, the same civic device the house uses one storey up,
    // here saying "institution" instead of "home". Kept up near the eaves
    // (>= 0.34) like every other wider-than-body band in this file, so it
    // never becomes a low ledge for traffic to catch on.
    body.push(tint(box(bw + 0.02, 0.035, bw + 0.02, 0, H - 0.05, 0), c.trim))
    // A flagpole beside the entrance. It stands on the ground regardless of
    // its height, so it belongs in body, not in the roof group that tilts.
    const poleH = L === 2 ? 0.34 : 0.5
    body.push(tint(cyl(0.012, 0.016, poleH, 5, 0.3, poleH / 2, half - 0.06), c.trim))
    const flag = new PlaneGeometry(0.09, 0.055)
    flag.translate(0.3 + 0.045, poleH - 0.03, half - 0.06)
    body.push(tint(flag, c.roof))
  }
  if (L === 3) {
    // Shallow steps, tucked inside the footprint rather than past its edge —
    // footprints do not grow with level, so even a 0.03-tall lip has to stay
    // inside the same half-extent every other level already claims.
    body.push(tint(box(0.46, 0.03, 0.1, 0, 0.015, half - 0.07), c.trim))
  }

  const roof: BufferGeometry[] = []
  const rise = (L === 1 ? 0.2 : 0.22) * c.theme.pitch
  if (c.theme.snow) {
    const eaves = bw + 0.2
    const prism = gableGeometry(eaves, eaves, rise)
    prism.translate(0, H, 0)
    roof.push(tint(prism, c.roof))
    roof.push(tint(box(eaves, 0.03, eaves, 0, H + 0.015, 0), c.trim))
    roof.push(tint(snowCap(eaves, eaves, rise, H), c.snow))
  } else {
    // A flat civic roof: this reads as a schoolhouse, not a cottage.
    roof.push(tint(box(bw + 0.04, 0.06, bw + 0.04, 0, H + 0.03, 0), c.roof))
  }
  if (L === 3) {
    // A bell cupola: one flourish that says "the important building", the
    // way the station's clock tower does for the platform.
    const cupolaBaseY = H + 0.09
    roof.push(tint(box(0.14, 0.13, 0.14, 0, cupolaBaseY + 0.065, 0.06), WHITE))
    roof.push(tint(cone(0.12, 0.13, 4, 0, cupolaBaseY + 0.13 + 0.065, 0.06), c.roof))
  }

  const win: BufferGeometry[] = []
  const wOff = [-0.26, 0, 0.26]
  if (L === 1) {
    win.push(...windowQuads(half, half, H * 0.52, 0.09, 0.1, wOff))
  } else if (L === 2) {
    win.push(...windowQuads(half, half, H * 0.3, 0.09, 0.1, wOff))
    win.push(...windowQuads(half, half, H * 0.78, 0.08, 0.09, wOff))
  } else {
    win.push(...windowQuads(half, half, H * 0.24, 0.08, 0.09, wOff))
    win.push(...windowQuads(half, half, H * 0.55, 0.08, 0.09, wOff))
    win.push(...windowQuads(half, half, H * 0.85, 0.07, 0.08, wOff))
  }

  return {
    body: mergeParts(body),
    roof: mergeParts(roof),
    windows: mergeParts(win.map((g) => tint(g, WHITE))),
    roofPivotY: H,
    heightJitter: jitterFor(L, 0.2),
  }
}

function harbourParts(c: Ctx): Parts {
  const L = c.level
  // The shed is the only thing that grows; the dock itself is finished the
  // day it is poured, the way a real quay does not widen with use.
  const shedH = L === 1 ? 0.26 : L === 2 ? 0.32 : 0.38
  const shedW = 0.46
  const shedD = 0.36
  const shedZ = -0.17
  const deckW = 0.8
  const deck = 0.045

  const body: BufferGeometry[] = [
    // A plank deck across the whole tile: this is dockside, not a lawn, and
    // it is the widest thing here below head height — see CLEARANCE.
    tint(box(deckW, deck, deckW, 0, deck / 2, 0), c.trim),
    tint(box(shedW, shedH, shedD, 0, deck + shedH / 2, shedZ), WHITE),
  ]
  // Mooring bollards on the water-facing edge. Small enough that the deck
  // still owns the clearance measurement.
  for (const x of [-0.28, 0.28]) {
    body.push(tint(cyl(0.014, 0.02, 0.055, 5, x, deck + 0.0275, 0.3), DARKEN))
  }
  // Cargo: the reward's one bit of visible wealth. It only ever grows.
  body.push(tint(box(0.09, 0.09, 0.09, -0.24, deck + 0.045, 0.14), RUST))
  if (L >= 2) {
    body.push(tint(box(0.08, 0.08, 0.08, -0.24, deck + 0.09 + 0.04, 0.14), RUST))
    body.push(tint(box(0.1, 0.1, 0.1, -0.13, deck + 0.05, 0.04), DARKEN))
  }
  if (L === 3) {
    body.push(tint(cyl(0.05, 0.055, 0.12, 7, 0.08, deck + 0.06, 0.06), DARKEN))
    body.push(tint(cyl(0.056, 0.056, 0.02, 7, 0.08, deck + 0.13, 0.06), RUST))
  }
  // A jib crane: the one thing on this tile taller than a person, so once it
  // leaves the vertical it lives above 0.34 like every other overhead part.
  if (L >= 2) {
    const mastH = L === 2 ? 0.4 : 0.5
    const mastX = 0.24
    const mastZ = 0.24
    body.push(tint(box(0.045, mastH, 0.045, mastX, deck + mastH / 2, mastZ), c.trim))
    const boomLen = 0.36
    body.push(
      tint(box(boomLen, 0.04, 0.04, mastX - boomLen / 2, deck + mastH - 0.02, mastZ), c.trim),
    )
    if (L === 3) {
      // A crate on the hook: the crane is working, not just standing there.
      const hookX = mastX - boomLen + 0.02
      body.push(tint(box(0.011, 0.09, 0.011, hookX, deck + mastH - 0.11, mastZ), DARKEN))
      body.push(tint(box(0.05, 0.05, 0.05, hookX, deck + mastH - 0.19, mastZ), RUST))
    }
  }

  const rise = 0.24 * c.theme.pitch
  const eaves = shedW + (c.theme.snow ? 0.16 : 0.08)
  const eavesD = shedD + (c.theme.snow ? 0.16 : 0.08)
  const prism = gableGeometry(eaves, eavesD, rise)
  prism.translate(0, deck + shedH, shedZ)
  const roof: BufferGeometry[] = [tint(prism, c.roof)]
  if (c.theme.snow) {
    roof.push(tint(box(eaves, 0.025, eavesD, 0, deck + shedH + 0.012, shedZ), c.trim))
    roof.push(tint(snowCap(eaves, eavesD, rise, deck + shedH), c.snow))
  }

  const win: BufferGeometry[] = []
  const halfW = shedW / 2
  const halfD = shedD / 2
  win.push(...windowQuads(halfW, halfD, deck + shedH * 0.55, 0.08, 0.09, [0], 0, shedZ))
  if (L >= 2) {
    win.push(...windowQuads(halfW, halfD, deck + shedH * 0.85, 0.07, 0.08, [-0.1, 0.1], 0, shedZ))
  }

  return {
    body: mergeParts(body),
    roof: mergeParts(roof),
    windows: mergeParts(win.map((g) => tint(g, WHITE))),
    roofPivotY: deck + shedH,
    heightJitter: jitterFor(L, 0.16),
  }
}

function landfillParts(c: Ctx): Parts {
  const L = c.level
  // Not a building: no walls, no roofline, just an uneven heap. The footprint
  // holds still like everything else's — a landfill that crept outward would
  // be a second, sneakier way to bury a neighbour — so growth is all height
  // and mess: the peak rises and the junk around its foot accumulates.
  const body: BufferGeometry[] = [
    // Two overlapping flattened blobs read as a heap; one round blob reads as
    // a hill, which is exactly the silhouette this building must not have.
    tint(blob(0.26, -0.04, 0.09, 0.02, 0.55), c.trim),
    tint(blob(0.22, 0.1, 0.1, -0.07, 0.5), DARKEN),
  ]
  // A rusted barrel, present at every level: the one prop that reads as
  // "dump" rather than "hill" from across the board.
  body.push(tint(cyl(0.045, 0.05, 0.11, 7, 0.19, 0.075, 0.17), RUST))
  body.push(tint(cyl(0.05, 0.05, 0.018, 7, 0.19, 0.14, 0.17), DARKEN))
  const sheet = box(0.22, 0.01, 0.14, 0, 0, 0)
  sheet.rotateZ(0.55)
  sheet.rotateY(0.3)
  sheet.translate(-0.2, 0.13, -0.13)
  body.push(tint(sheet, DARKEN))
  if (L >= 2) {
    body.push(tint(cyl(0.045, 0.05, 0.11, 7, -0.2, 0.075, 0.15), DARKEN))
  }
  if (L === 3) {
    body.push(tint(cyl(0.04, 0.045, 0.1, 7, 0.03, 0.07, -0.21), RUST))
    const sheet2 = box(0.16, 0.01, 0.11, 0, 0, 0)
    sheet2.rotateZ(-0.45)
    sheet2.translate(0.21, 0.1, -0.06)
    body.push(tint(sheet2, RUST))
  }
  if (c.theme.snow) {
    // Snow settles into the folds of a heap rather than capping it the way it
    // caps a ridge, so this is a low patch, not a cap.
    body.push(tint(blob(0.14, -0.1, 0.15, 0.11, 0.4), c.snow))
  }

  // The peak: same radius at every level, so the footprint never changes,
  // but it rises and un-squashes as the pile grows — taller, not wider.
  const topY = L === 1 ? 0.18 : L === 2 ? 0.24 : 0.3
  const topSquash = L === 1 ? 0.5 : L === 2 ? 0.65 : 0.8
  const roof: BufferGeometry[] = [tint(blob(0.17, 0.02, topY, 0.0, topSquash), c.trim)]

  return {
    body: mergeParts(body),
    roof: mergeParts(roof),
    windows: null,
    roofPivotY: 0.14,
    heightJitter: jitterFor(L, 0.08),
  }
}

/**
 * The campus: what a merged 2x2 of schools becomes. Two symmetrical
 * flat-roofed wings flank a courtyard open to the ground (a 0.4 gap of
 * daylight between them), the school's L3 bell cupola enlarged into a central
 * clocktower standing in that courtyard, and two flagpoles — the L2 motif,
 * doubled — planted on the courtyard's open side. Windows are mandatory so
 * the school type keeps its windowPart.
 */
function maxiSchoolParts(c: Ctx): Parts {
  const wingW = 0.26
  const wingD = 0.86
  const wingH = 0.34
  const off = 0.33 // wing centres; a 0.4 courtyard between the wings

  const body: BufferGeometry[] = []
  const roof: BufferGeometry[] = []
  const win: BufferGeometry[] = []
  for (const cx of [-off, off]) {
    body.push(tint(box(wingW, wingH, wingD, cx, wingH / 2, 0), WHITE))
    // The civic beltcourse, the school's own device, wrapping each wing.
    body.push(tint(box(wingW + 0.02, 0.03, wingD + 0.02, cx, wingH - 0.05, 0), c.trim))
    // Flat civic roofs with a shallow parapet, like the standard school.
    roof.push(tint(box(wingW + 0.04, 0.05, wingD + 0.04, cx, wingH + 0.025, 0), c.roof))
    if (c.theme.snow) {
      roof.push(tint(box(wingW + 0.06, 0.02, wingD + 0.06, cx, wingH + 0.055, 0), c.snow))
    }
    win.push(...windowQuads(wingW / 2, wingD / 2, 0.12, 0.07, 0.09, [-0.28, 0, 0.28], cx, 0))
    win.push(...windowQuads(wingW / 2, wingD / 2, 0.26, 0.07, 0.08, [-0.28, 0, 0.28], cx, 0))
  }

  // The clocktower: the L3 cupola grown into a full tower, centred in the
  // courtyard against the back of the block. It stands on the ground, so the
  // shaft lives in body; only its cap tilts with the roof group.
  const tw = 0.22
  const twH = 0.62
  const twZ = -0.28
  body.push(tint(box(tw, twH, tw, 0, twH / 2, twZ), WHITE))
  body.push(tint(box(tw + 0.02, 0.03, tw + 0.02, 0, twH - 0.16, twZ), c.trim))
  // Clock faces on all four sides, the station tower's device.
  body.push(tint(box(0.12, 0.12, 0.012, 0, twH - 0.08, twZ + tw / 2 + 0.002), c.trim))
  roof.push(tint(box(tw + 0.06, 0.04, tw + 0.06, 0, twH + 0.02, twZ), c.trim))
  roof.push(tint(cone(0.16, 0.16, 4, 0, twH + 0.12, twZ), c.roof))

  // Two flagpoles on the courtyard's open side, the L2 school's single pole
  // doubled. They stand on the ground, so they belong in body, not roof.
  for (const fx of [-0.1, 0.1]) {
    const poleH = 0.5
    body.push(tint(cyl(0.012, 0.016, poleH, 5, fx, poleH / 2, 0.34), c.trim))
    const flag = new PlaneGeometry(0.09, 0.055)
    flag.translate(fx + 0.045, poleH - 0.03, 0.34)
    body.push(tint(flag, c.roof))
  }

  return {
    body: mergeParts(body),
    roof: mergeParts(roof),
    windows: mergeParts(win.map((g) => tint(g, WHITE))),
    roofPivotY: wingH,
    heightJitter: jitterFor(MAX_LEVEL, 0.2),
  }
}

/**
 * The grand terminal: what a merged 2x2 of stations becomes. One broad glass
 * trainshed vault — the "grand terminus" signature — spans the platforms on
 * tall posts, the L3 clock tower enlarged and centred on the station house at
 * the back, and two elongated platform canopies running the length of the
 * block on either side. Windows are mandatory so the station type keeps its
 * windowPart.
 */
function maxiStationParts(c: Ctx): Parts {
  const deck = 0.06
  const plate = 0.92

  const body: BufferGeometry[] = [
    // The platform plate with its painted edge strip, the station's own base.
    tint(box(plate, deck, plate, 0, deck / 2, 0), c.trim),
    tint(box(plate, 0.012, 0.12, 0, deck + 0.004, plate / 2 - 0.07), LIGHTEN),
  ]
  const roof: BufferGeometry[] = []
  const win: BufferGeometry[] = []

  // The station house across the back of the block.
  const hutW = 0.6
  const hutD = 0.26
  const hutH = 0.3
  const hutZ = -0.31
  body.push(tint(box(hutW, hutH, hutD, 0, deck + hutH / 2, hutZ), WHITE))
  body.push(tint(box(hutW + 0.02, 0.035, hutD + 0.02, 0, deck + hutH * 0.6, hutZ), c.trim))
  win.push(...windowQuads(hutW / 2, hutD / 2, deck + hutH * 0.45, 0.09, 0.11, [-0.2, 0, 0.2], 0, hutZ))

  // The clock tower: the L3 motif, enlarged and centred on the station house.
  const tw = 0.2
  const twH = 0.44
  body.push(tint(box(tw, twH, tw, 0, deck + hutH + twH / 2, hutZ), WHITE))
  body.push(tint(box(0.13, 0.13, 0.012, 0, deck + hutH + twH * 0.68, hutZ + tw / 2 + 0.002), c.trim))
  const towerRise = 0.15 * c.theme.pitch
  const towerPrism = gableGeometry(tw + 0.08, tw + 0.08, towerRise)
  towerPrism.translate(0, deck + hutH + twH, hutZ)
  roof.push(tint(towerPrism, c.roof))
  if (c.theme.snow) roof.push(tint(snowCap(tw + 0.08, tw + 0.08, towerRise, deck + hutH + twH), c.snow))
  win.push(...windowQuads(tw / 2, tw / 2, deck + hutH + twH * 0.3, 0.07, 0.09, [0], 0, hutZ))

  // The trainshed: one wide pale vault covering the platforms, resting on
  // slim posts — glass, so it wears the same pale ratio the arcade vault and
  // glasshouse use. In the roof group, so a derelict terminal sags from it.
  const shedY = 0.4
  for (const px of [-0.4, 0, 0.4]) {
    for (const pz of [-0.1, 0.26]) {
      body.push(tint(box(0.035, shedY - deck, 0.035, px, deck + (shedY - deck) / 2, pz), c.roof))
    }
  }
  const vault = gableGeometry(0.92, 0.62, 0.18)
  vault.translate(0, shedY, 0.08)
  roof.push(tint(vault, c.snow))

  // Two elongated side canopies, the standard station's awning stretched to
  // the full depth of the block, on their own posts.
  const canY = 0.3
  for (const cx of [-0.36, 0.36]) {
    for (const pz of [-0.2, 0.3]) {
      body.push(tint(box(0.035, canY - deck, 0.035, cx, deck + (canY - deck) / 2, pz), c.roof))
    }
    roof.push(tint(box(0.18, 0.035, 0.84, cx, canY + 0.0175, 0.05), c.roof))
  }

  return {
    body: mergeParts(body),
    roof: mergeParts(roof),
    windows: mergeParts(win.map((g) => tint(g, WHITE))),
    roofPivotY: deck,
    heightJitter: jitterFor(MAX_LEVEL, 0.18),
  }
}

/**
 * The grand harbour: what a merged 2x2 of harbours becomes. The L3 jib crane
 * doubled — one larger, with a container on the hook — a row of containers
 * along the quay (rust, dark, and trim, the base harbour's cargo motifs), and
 * a double-gabled warehouse: two sheds standing side by side with a real gap
 * between them. Windows are mandatory so the harbour type keeps its
 * windowPart.
 */
function maxiHarbourParts(c: Ctx): Parts {
  const deck = 0.045
  const deckW = 0.92

  const body: BufferGeometry[] = [tint(box(deckW, deck, deckW, 0, deck / 2, 0), c.trim)]
  const roof: BufferGeometry[] = []
  const win: BufferGeometry[] = []

  // The warehouse: two sheds side by side, each with its own gable — a
  // double-pignon silhouette rather than one shed stretched wide.
  const shedW = 0.3
  const shedD = 0.28
  const shedH = 0.3
  const shedZ = -0.28
  for (const cx of [-0.18, 0.18]) {
    body.push(tint(box(shedW, shedH, shedD, cx, deck + shedH / 2, shedZ), WHITE))
    const rise = 0.13 * c.theme.pitch
    const eaves = shedW + 0.06
    const prism = gableGeometry(eaves, shedD + 0.06, rise)
    prism.translate(cx, deck + shedH, shedZ)
    roof.push(tint(prism, c.roof))
    if (c.theme.snow) {
      roof.push(tint(snowCap(eaves, shedD + 0.06, rise, deck + shedH).translate(cx, 0, shedZ), c.snow))
    }
    win.push(...windowQuads(shedW / 2, shedD / 2, deck + shedH * 0.55, 0.07, 0.09, [-0.07, 0.07], cx, shedZ))
  }

  // A row of containers along the quay, stacked like the base harbour's
  // growing cargo: rust, dark, and trim, one pair two high.
  const conts: [number, number, Color][] = [
    [-0.34, 0.08, RUST],
    [-0.18, 0.08, DARKEN],
    [-0.02, 0.08, c.trim],
    [-0.26, 0.17, c.trim],
  ]
  for (const [cx, cy, col] of conts) {
    body.push(tint(box(0.15, 0.09, 0.1, cx, deck + cy, 0.12), col))
  }
  // Mooring bollards on the water edge, the base harbour's own detail.
  for (const x of [-0.4, 0, 0.4]) {
    body.push(tint(cyl(0.014, 0.02, 0.055, 5, x, deck + 0.0275, 0.4), DARKEN))
  }

  // Two jib cranes, the base harbour's crane motif doubled: a large working
  // crane with a container on the hook, and a smaller one standing idle.
  const cranes: [number, number, number, number, boolean][] = [
    // x, z, mast height, boom length, loaded
    [0.3, 0.3, 0.62, 0.52, true],
    [-0.36, -0.05, 0.42, 0.3, false],
  ]
  for (const [mx, mz, mastH, boomLen, loaded] of cranes) {
    body.push(tint(box(0.05, mastH, 0.05, mx, deck + mastH / 2, mz), c.trim))
    body.push(tint(box(boomLen, 0.045, 0.045, mx - boomLen / 2, deck + mastH - 0.02, mz), c.trim))
    if (loaded) {
      const hookX = mx - boomLen + 0.03
      body.push(tint(box(0.012, 0.14, 0.012, hookX, deck + mastH - 0.13, mz), DARKEN))
      body.push(tint(box(0.14, 0.08, 0.09, hookX, deck + mastH - 0.24, mz), RUST))
    }
  }

  return {
    body: mergeParts(body),
    roof: mergeParts(roof),
    windows: mergeParts(win.map((g) => tint(g, WHITE))),
    roofPivotY: deck + shedH,
    heightJitter: jitterFor(MAX_LEVEL, 0.16),
  }
}

function buildParts(
  type: BuildingType,
  biome: Biome,
  level: number,
  kind: CommerceKind = 'general',
  merged = false,
): Parts {
  const t = type === 'shop' ? SHOP_THEMES[kind][biome] : THEMES[type][biome]
  const wall = new Color().setHex(t.wall, SRGBColorSpace)
  const c: Ctx = {
    theme: t,
    biome: biome as Biome,
    // A maxi look is always level 3, so a type or kind with no dedicated
    // maxi piece below simply falls through to its standard level 3 parts —
    // the render a merged block had before maxi pieces existed. The landfill
    // is the one type that takes this path ON PURPOSE: its merged "scrap
    // mountain" is the standard heap, just scaled up. Do not "fix" it.
    level: merged ? MAX_LEVEL : level,
    roof: ratioOf(wall, new Color().setHex(t.roof, SRGBColorSpace)),
    trim: ratioOf(wall, new Color().setHex(t.trim, SRGBColorSpace)),
    leaf: ratioOf(wall, new Color().setHex(t.foliage, SRGBColorSpace)),
    snow: ratioOf(wall, new Color().setHex(SNOW_COLOR, SRGBColorSpace)),
    kind,
    merged,
  }
  if (merged && type === 'house') return maxiHouseParts(c)
  if (merged && type === 'factory') return maxiFactoryParts(c)
  if (merged && type === 'park') return maxiParkParts(c)
  if (merged && type === 'school') return maxiSchoolParts(c)
  if (merged && type === 'station') return maxiStationParts(c)
  if (merged && type === 'harbour') return maxiHarbourParts(c)
  switch (type) {
    case 'park':
      return parkParts(c)
    case 'shop':
      return shopParts(c)
    case 'factory':
      return factoryParts(c)
    case 'station':
      return stationParts(c)
    case 'school':
      return schoolParts(c)
    case 'harbour':
      return harbourParts(c)
    case 'landfill':
      return landfillParts(c)
    default:
      return houseParts(c)
  }
}

// ---------------------------------------------------------------------------
// Merging the looks into one geometry per part
// ---------------------------------------------------------------------------

const BIOME_COUNT = 3
/**
 * 3 biomes x 3 levels, plus one maxi look per biome for merged blocks.
 * Index: biome * MAX_LEVEL + (level - 1) for the standard looks, then
 * BIOME_COUNT * MAX_LEVEL + biome for the maxi ones — the order the type
 * loop below pushes them, standard looks first, maxis after.
 */
const LOOK_COUNT = BIOME_COUNT * (MAX_LEVEL + 1)

function lookIndex(biome: number, level: number): number {
  const b = biome >= 0 && biome < BIOME_COUNT ? Math.floor(biome) : 0
  const l = Number.isFinite(level)
    ? Math.min(MAX_LEVEL, Math.max(1, Math.round(level)))
    : 1
  return b * MAX_LEVEL + (l - 1)
}

/** Maxi looks live past every standard look: one per biome, always level 3. */
function mergedLookIndex(biome: number): number {
  const b = biome >= 0 && biome < BIOME_COUNT ? Math.floor(biome) : 0
  return BIOME_COUNT * MAX_LEVEL + b
}

/**
 * Shops carry a fourth axis — commerce kind — on top of biome and level, so
 * they get their own indexing rather than stretching `lookIndex` for every
 * type. Order must match the nested biome/level/kind loop that builds a
 * shop's `parts` array below: kind innermost, then level, then biome.
 *
 * The kind count comes from COMMERCE_KINDS itself — maxi kinds included — so
 * adding a kind extends every shop look table (parts, colours, windows) in one
 * place rather than at each of them.
 */
const SHOP_KIND_COUNT = COMMERCE_KINDS.length
const MAXI_KIND_COUNT = MAXI_COMMERCE_KINDS.length
/**
 * Standard shop looks first (biome x level x kind), then the maxi looks:
 * one per biome per maxi kind, biome outermost — the order the shop loop
 * below pushes them, and the order mergedShopLookIndex encodes.
 */
const SHOP_LOOK_COUNT = BIOME_COUNT * MAX_LEVEL * SHOP_KIND_COUNT + BIOME_COUNT * MAXI_KIND_COUNT

function shopLookIndex(biome: number, level: number, kind: CommerceKind | null): number {
  const b = biome >= 0 && biome < BIOME_COUNT ? Math.floor(biome) : 0
  const l = Number.isFinite(level) ? Math.min(MAX_LEVEL, Math.max(1, Math.round(level))) : 1
  // Saves and ghosts with no kind yet read as 'general', the unbranded shop.
  const ki = COMMERCE_KINDS.indexOf(kind ?? 'general')
  const k = ki >= 0 ? ki : 0
  return (b * MAX_LEVEL + (l - 1)) * SHOP_KIND_COUNT + k
}

/**
 * Maxi shop looks, indexed past every standard look. Returns -1 for a kind
 * that is not a maxi kind — a merged anchor should always carry one (the sim
 * stamps it at merge time), so -1 is the console-poke case and the caller
 * falls back to the standard look rather than drawing nothing.
 */
function mergedShopLookIndex(biome: number, kind: CommerceKind | null): number {
  const b = biome >= 0 && biome < BIOME_COUNT ? Math.floor(biome) : 0
  const k = MAXI_COMMERCE_KINDS.indexOf(kind ?? 'general')
  if (k < 0) return -1
  return BIOME_COUNT * MAX_LEVEL * SHOP_KIND_COUNT + b * MAXI_KIND_COUNT + k
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
  /**
   * Sim time this building's level last changed. -Infinity if it never has
   * (or the record is fresh), which the pulse curves in update() simply read
   * as "long over" — no separate null check needed anywhere that uses it.
   */
  levelPulseAt: number
  /**
   * +1 grew a floor, -1 lost one; flips the bounce so a downgrade sinks
   * instead of popping. Only +1 happens today — the auto-builder never lowers
   * a level — but the pulse itself does not assume that stays true.
   */
  levelPulseSign: number
  /** Static per-instance body colour, hue/lightness jittered from the variant. */
  color: Color
  yaw: number
  heightScale: number
  lean: number
  /**
   * Offset from the tile's own centre, in world units: (0, 0) for everything
   * but a merged block's anchor, which is drawn on the block's centre half a
   * tile toward +x/+z.
   */
  offsetX: number
  offsetZ: number
  /** XZ multiplier on the whole look: MERGE_SCALE for a merged anchor, else 1. */
  scaleXZ: number
  /** Extra Y multiplier: MERGE_HEIGHT_SCALE for a merged anchor, else 1. */
  scaleY: number
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
/**
 * A merged 2x2 block draws as one building on its anchor: twice the footprint
 * of the single-tile look, one and a half times the height — clearly the
 * block's landmark without towering over the skyline.
 */
const MERGE_SCALE = 2
const MERGE_HEIGHT_SCALE = 1.5
/**
 * World-unit nudge from the anchor tile's centre to the block's centre. The
 * block always spills toward +x/+z (see blockCells), world axes run the same
 * way as tile axes, and a tile is one unit across.
 */
const MERGE_OFFSET = 0.5
const DERELICT_FADE = 1.4
/** How long a level-change bounce plays, from the moment it fires. */
const LEVEL_PULSE_SECONDS = 0.6
/** Peak vertical hop, in tile units. A storey is roughly 0.2-0.3 tall, so this reads as a bump, not a jump. */
const LEVEL_HOP = 0.05
/** Peak extra scale at the top of the bounce, on top of the resting size. */
const LEVEL_SQUASH = 0.1
/** How far the level-change arrow floats over its own life, in tile units. */
const ARROW_RISE = 0.26
/**
 * Gap left between roofPivotY and the arrow's resting height. Generous on
 * purpose: roofPivotY is where the roof STARTS, not its peak, and a first
 * pass at 0.14 left the arrow reading as a sliver wedged between two
 * neighbouring roofs in a dense block rather than a clearly floating arrow.
 */
const ARROW_CLEARANCE = 0.34

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

  // The level-up/level-down arrow. Plain meshes rather than an InstancedMesh:
  // at most a handful ever float at once (auto-builder upgrades happen one at
  // a time, and the pulse is over in well under a second), so a small fixed
  // pool is simpler than instancing and each slot needs its own opacity
  // anyway, which InstancedMesh has no per-instance channel for.
  const ARROW_POOL_SIZE = 6
  const arrowGeom = arrowGeometry()
  const arrowUpColor = new Color().setHex(RING_GOOD, SRGBColorSpace)
  const arrowDownColor = new Color().setHex(DANGER_COLOR, SRGBColorSpace)
  interface ArrowSlot {
    mesh: Mesh
    material: MeshBasicMaterial
  }
  const arrowPool: ArrowSlot[] = []
  for (let i = 0; i < ARROW_POOL_SIZE; i++) {
    const material = new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      // A flat, punchy indicator rather than another piece of shaded scenery —
      // the same reasoning windowMaterial disables tone mapping for, so the
      // green/red actually reads as green/red instead of the ambient tint.
      toneMapped: false,
    })
    const mesh = new Mesh(arrowGeom, material)
    mesh.visible = false
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.renderOrder = 6
    scene.add(mesh)
    arrowPool.push({ mesh, material })
  }

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
    if (type === 'shop') {
      // Order matches shopLookIndex: kind innermost, then level, then biome.
      for (let biome = 0; biome < BIOME_COUNT; biome++) {
        for (let level = 1; level <= MAX_LEVEL; level++) {
          for (const kind of COMMERCE_KINDS) {
            parts.push(buildParts(type, biome, level, kind))
          }
        }
      }
      // Maxi looks after every standard look, biome outermost then maxi
      // kinds — exactly the order mergedShopLookIndex encodes.
      for (let biome = 0; biome < BIOME_COUNT; biome++) {
        for (const kind of MAXI_COMMERCE_KINDS) {
          parts.push(buildParts(type, biome, MAX_LEVEL, kind, true))
        }
      }
    } else {
      for (let biome = 0; biome < BIOME_COUNT; biome++) {
        for (let level = 1; level <= MAX_LEVEL; level++) {
          parts.push(buildParts(type, biome, level))
        }
      }
      // One maxi look per biome, pushed after the standard looks — exactly
      // the slots mergedLookIndex points at.
      for (let biome = 0; biome < BIOME_COUNT; biome++) {
        parts.push(buildParts(type, biome, MAX_LEVEL, 'general', true))
      }
    }

    for (let biome = 0; biome < BIOME_COUNT; biome++) {
      // A shop's kind is drawn at spawn time, so the ghost preview — shown
      // before that happens — always wears the unbranded 'general' look.
      const idx =
        type === 'shop' ? shopLookIndex(biome, 1, 'general') : lookIndex(biome, 1)
      const p = parts[idx]
      const clones = [p.body.clone(), p.roof.clone()]
      const geom = mergeGeometries(clones, false)
      for (const c of clones) c.dispose()
      if (!geom) throw new Error('render/buildings: ghost merge failed')
      ghostGeoms.set(type + ':' + biome, geom)
    }

    const bodyPart = mergeLooks(parts.map((p) => p.body))
    const roofPart = mergeLooks(parts.map((p) => p.roof))
    const windowGeoms = parts.map((p) => p.windows).filter((g): g is BufferGeometry => !!g)
    const expectedLookCount = type === 'shop' ? SHOP_LOOK_COUNT : LOOK_COUNT
    const windowPart = windowGeoms.length === expectedLookCount ? mergeLooks(windowGeoms) : null
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
  const shopColorKey = (kind: CommerceKind, biome: number) => 'shop:' + kind + ':' + biome

  /** Body colour per type per biome (per commerce kind for shops): the divisor
   * every vertex ratio was built against. */
  const baseColors = new Map<string, Color>()
  for (const type of BUILDING_TYPES) {
    if (type === 'shop') {
      for (const kind of COMMERCE_KINDS) {
        for (let biome = 0; biome < BIOME_COUNT; biome++) {
          baseColors.set(
            shopColorKey(kind, biome),
            new Color().setHex(SHOP_THEMES[kind][biome].wall, SRGBColorSpace),
          )
        }
      }
    } else {
      for (let biome = 0; biome < BIOME_COUNT; biome++) {
        baseColors.set(
          type + ':' + biome,
          new Color().setHex(THEMES[type][biome].wall, SRGBColorSpace),
        )
      }
    }
  }

  function jitteredColor(
    type: BuildingType,
    biome: number,
    variant: number,
    kind: CommerceKind | null,
  ): Color {
    const key = type === 'shop' ? shopColorKey(kind ?? 'general', biome) : type + ':' + biome
    const base = baseColors.get(key)!
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
    // Carry the smoothed dereliction, and any level-change bounce still
    // playing, across a rebuild so neither restarts on every unrelated sync.
    const carry = new Map<
      number,
      { bornAt: number; amt: number; look: number; pulseAt: number; pulseSign: number }
    >()
    for (const entry of entries.values()) {
      for (const r of entry.records) {
        carry.set(r.tile, {
          bornAt: r.bornAt,
          amt: r.derelictAmt,
          look: r.look,
          pulseAt: r.levelPulseAt,
          pulseSign: r.levelPulseSign,
        })
      }
      entry.records.length = 0
    }

    const terrain = terrainFor(state)
    biomeMap = terrain.biome

    for (let tile = 0; tile < state.grid.length; tile++) {
      const b = state.grid[tile]
      if (!b) continue
      const entry = entries.get(b.type)
      if (!entry) continue
      // A merged 2x2 block draws as a single instance on its anchor, so its
      // three other cells produce no record at all. Anything pointing at an
      // anchor that does not head a complete block right now — a console
      // poke, a hand-edited save the sim has not cleaned up yet — falls
      // through and draws as an ordinary building rather than vanishing or
      // being deduped by mistake. The corner check mirrors revalidateBlocks:
      // isMergedBlock does pure arithmetic and would read past the map edge
      // for an anchor on the last row or column (or worse).
      let merged = false
      const anchor = b.mergeAnchor
      if (anchor !== null) {
        const validCorner =
          anchor >= 0 && tileX(anchor) < WORLD_SIZE - 1 && tileZ(anchor) < WORLD_SIZE - 1
        if (validCorner && isMergedBlock(state, anchor)) {
          if (anchor !== tile) continue
          merged = true
        }
      }
      const biome = terrain.biome[tile] as Biome
      // A merged anchor swaps its standard look for the maxi one. A merged
      // shop whose kind is somehow not a maxi kind (a console poke the sim
      // has not cleaned up) keeps its standard look rather than vanishing.
      let look: number
      if (b.type === 'shop') {
        look = merged ? mergedShopLookIndex(biome, b.commerceKind) : -1
        if (look < 0) look = shopLookIndex(biome, b.level, b.commerceKind)
      } else {
        look = merged ? mergedLookIndex(biome) : lookIndex(biome, b.level)
      }
      const prev = carry.get(tile)
      // Same tile AND the same bornAt: bornAt is stamped once at
      // spawnBuilding() and an upgrade never touches it, so this is the one
      // reliable way to tell "this building levelled" from "this building was
      // demolished and something else now stands here" — a bare tile match
      // cannot tell the two apart.
      const sameBuilding = prev !== undefined && prev.bornAt === b.bornAt
      const amt = sameBuilding ? prev!.amt : b.derelict ? 1 : 0
      // Biome never changes under a standing building, so a changed look at
      // the same tile and bornAt can only mean the level changed.
      const leveled = sameBuilding && prev!.look !== look
      entry.records.push({
        tile,
        variant: b.variant,
        look,
        bornAt: b.bornAt,
        derelict: b.derelict,
        derelictAmt: amt,
        levelPulseAt: leveled ? state.time : sameBuilding ? prev!.pulseAt : -Infinity,
        levelPulseSign: leveled ? Math.sign(look - prev!.look) : sameBuilding ? prev!.pulseSign : 1,
        color: jitteredColor(b.type, biome, b.variant, b.type === 'shop' ? b.commerceKind : null),
        // Four cardinal orientations plus a couple of degrees of slop, so a row
        // of identical houses does not read as a repeated stamp.
        yaw: Math.floor(b.variant * 4) * (Math.PI / 2) + (b.variant - 0.5) * 0.09,
        heightScale: 1 + (b.variant - 0.5) * entry.looks[look].heightJitter,
        lean: (b.variant - 0.5) * 2,
        offsetX: merged ? MERGE_OFFSET : 0,
        offsetZ: merged ? MERGE_OFFSET : 0,
        scaleXZ: merged ? MERGE_SCALE : 1,
        scaleY: merged ? MERGE_HEIGHT_SCALE : 1,
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
  // Same sage already used for a positive emission ring, reused rather than a
  // new colour, so "this got better" reads consistently across the game. A
  // downgrade flashes derelictColor instead — the taupe that already means
  // decline everywhere else.
  const levelUpColor = new Color().setHex(RING_GOOD, SRGBColorSpace)

  function update(u: BuildingsUpdate): void {
    // Filled as pulsing records turn up below, then any pool slot past what
    // got used this frame is hidden — see the end of this function.
    let arrowsUsed = 0

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

        // A level change gets its own brief bounce on top of everything else:
        // wobble drives the motion (signed, so a downgrade sinks instead of
        // popping), glow drives how hard the colour flashes. Both are simply
        // 0 once LEVEL_PULSE_SECONDS has passed, so nothing here needs an
        // "is a pulse playing" branch.
        const pulseX = (u.time - r.levelPulseAt) / LEVEL_PULSE_SECONDS
        const wobble = bouncePulse(pulseX) * r.levelPulseSign
        const glow = pulseFade(pulseX)
        const bounce = 1 + LEVEL_SQUASH * wobble

        const w = tileToWorld(r.tile)

        // The arrow: a separate, non-oscillating drift rather than the bounce
        // above, so it reads as "this went up/down" instead of jittering with
        // the building. Gated to the same 0..1 window as everything else here.
        if (pulseX >= 0 && pulseX < 1 && arrowsUsed < arrowPool.length) {
          const slot = arrowPool[arrowsUsed++]
          const drift = ARROW_RISE * smoothstep(0, 1, pulseX) * r.levelPulseSign
          const restY = looks[r.look].roofPivotY * r.heightScale * r.scaleY + ARROW_CLEARANCE
          slot.mesh.position.set(w.x + r.offsetX, restY + drift, w.z + r.offsetZ)
          // The geometry's cone points up from its own pivot; flipping it
          // about X for a downgrade puts the cone at the bottom instead, so it
          // still points the way the arrow is actually travelling.
          slot.mesh.rotation.set(r.levelPulseSign < 0 ? Math.PI : 0, 0, 0)
          slot.material.color.copy(r.levelPulseSign >= 0 ? arrowUpColor : arrowDownColor)
          // In fast, hold, then out — a flat fade-in/out would either pop in
          // sharply or spend the whole window fading, and this is meant to be
          // read at a glance, not stared at.
          slot.material.opacity = smoothstep(0, 0.12, pulseX) * (1 - smoothstep(0.5, 1, pulseX))
          slot.mesh.visible = true
        }

        pos.set(w.x + r.offsetX, -0.07 * d + LEVEL_HOP * wobble, w.z + r.offsetZ)
        euler.set(r.lean * 0.05 * d, r.yaw, r.lean * -0.07 * d)
        quat.setFromEuler(euler)
        // compose() is T·R·S: the look (authored in single-tile units, base at
        // y = 0) is scaled first — grow included, so a merged block sprouts
        // from the ground straight at its final MERGE_SCALE size, never at
        // 1x with a pop — then yawed about its own centre, then moved onto
        // the tile (or, offset included, onto the block's centre).
        scale.set(
          grow * bounce * r.scaleXZ,
          grow * r.heightScale * r.scaleY * (1 - 0.1 * d) * bounce,
          grow * bounce * r.scaleXZ,
        )
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
        if (glow > 0) tmpColor.lerp(r.levelPulseSign >= 0 ? levelUpColor : derelictColor, glow * 0.5)
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

    for (let i = arrowsUsed; i < arrowPool.length; i++) arrowPool[i].mesh.visible = false
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
    for (const slot of arrowPool) {
      scene.remove(slot.mesh)
      slot.material.dispose()
    }
    arrowGeom.dispose()
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
