/**
 * Landforms: scalar field primitives, and the two libraries of concrete shapes
 * (one per water, one per rock) that terrain.ts draws from.
 *
 * Pure module: no rendering import, no side effect, nothing but arithmetic
 * over tile coordinates. Everything a field produces is 0..1-ish BEFORE the
 * caller applies startMask/noise/budget — this module knows nothing about the
 * starting plot, the coastline wobble, or how many tiles get kept. That split
 * is deliberate: terrain.ts owns "how much of the board is unbuildable and
 * where the safe zone is", landforms.ts owns "what silhouette the eligible
 * area traces before that budget is applied".
 *
 * All distances/radii the shape tables use are expressed as a FRACTION of the
 * board size, not an absolute tile count, so a future change to WORLD_SIZE
 * does not silently shrink or balloon every shape relative to the plate.
 */

export type Field = (x: number, z: number) => number
export type Rnd = () => number

/** Which edge of the board: 0 = north (z=0), 1 = east (x=last), 2 = south (z=last), 3 = west (x=0). */
export type Side = 0 | 1 | 2 | 3

/**
 * The ramp terrain.ts used to compute inline as `edgeCloseness`, moved here
 * unchanged so it can sit in the shape library as `bay`/`range` rather than
 * living apart from every other shape. terrain.ts no longer has its own copy;
 * it imports this one. Cubed so it collapses quickly inland instead of making
 * the outer third of the board eligible (see the coverage note this carried
 * in terrain.ts before the move).
 */
export function edgeField(x: number, z: number, side: Side, size: number): number {
  const last = size - 1
  const distance = side === 0 ? z : side === 1 ? last - x : side === 2 ? last - z : x
  const closeness = 1 - distance / last
  return closeness * closeness * closeness
}

/** 1 at the centre, 0 at or beyond `radius`, linear in between. */
export function blobField(x: number, z: number, cx: number, cz: number, radius: number): number {
  if (radius <= 0) return 0
  const d = Math.hypot(x - cx, z - cz)
  return Math.max(0, 1 - d / radius)
}

/** 1 on the segment from (ax,az) to (bx,bz), 0 at or beyond `width` away from it. */
export function segField(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  width: number,
): number {
  if (width <= 0) return 0
  const abx = bx - ax
  const abz = bz - az
  const abLenSq = abx * abx + abz * abz
  let t = abLenSq > 0 ? ((x - ax) * abx + (z - az) * abz) / abLenSq : 0
  t = Math.max(0, Math.min(1, t))
  const px = ax + abx * t
  const pz = az + abz * t
  const d = Math.hypot(x - px, z - pz)
  return Math.max(0, 1 - d / width)
}

/** Combine several blobs/segments into one shape: the strongest field wins at every tile. */
export function maxOf(...fields: Field[]): Field {
  return (x, z) => {
    let m = 0
    for (const f of fields) m = Math.max(m, f(x, z))
    return m
  }
}

/**
 * A point on the given edge of a `size`-tile board. `along` is 0..1 along
 * that edge, in the same direction for all four sides (increasing x, or
 * increasing z when the edge runs along z) so "along=0.5" always means the
 * middle of whichever edge was picked.
 */
export function pointOnSide(side: Side, along: number, size: number): { x: number; z: number } {
  const last = size - 1
  const t = Math.max(0, Math.min(1, along)) * last
  switch (side) {
    case 0:
      return { x: t, z: 0 }
    case 1:
      return { x: last, z: t }
    case 2:
      return { x: t, z: last }
    default:
      return { x: 0, z: t }
  }
}

const opposite = (side: Side): Side => ((side + 2) % 4) as Side

/** Linear interpolation between two points. */
function mixPoint(a: { x: number; z: number }, b: { x: number; z: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
}

const center = (size: number) => (size - 1) / 2

/**
 * Fraction of `size` kept completely clear of every non-edge shape, measured
 * from the board's exact centre. terrain.ts's own startMask already fades
 * water/rock to nothing near the starting plot, but it fades gradually over a
 * few tiles (START_RING), which is enough to suppress a ramp that is already
 * naturally weak near the centre (bay/range) but not enough to suppress a
 * blob whose CENTRE lands right next to the safe zone at full strength — that
 * blob's masked value can still outrank distant, weaker tiles and win a
 * budget slot one tile from the starting plot. 0.2 * size (7.2 tiles at
 * WORLD_SIZE=36) clears the starting plot's box (half-width 3) plus its
 * required 1-tile margin (Chebyshev corner at sqrt(4^2+4^2) ≈ 5.66 tiles from
 * centre) with room to spare, so no blob/segment shape can place strength
 * there regardless of where its centre lands. Bay and range are exempt: an
 * edge ramp is already near its minimum at the board's centre by
 * construction, and clipping it would just duplicate what startMask does.
 */
const CENTER_AVOID_FRACTION = 0.2

/** Zero out a field within CENTER_AVOID_FRACTION * size of the board's centre. */
function keepAwayFromCentre(field: Field, size: number): Field {
  const c = center(size)
  const avoidRadius = CENTER_AVOID_FRACTION * size
  return (x, z) => (Math.hypot(x - c, z - c) < avoidRadius ? 0 : field(x, z))
}

/**
 * A blob centre pulled toward `side` without being glued to it: mixes the
 * middle of that edge with a jittered point further inside the board. 0.55
 * weight toward the edge midpoint was picked so the blob visibly leans toward
 * its assigned side (the orientation the design calls for) while still
 * landing, most of the time, clearly off that edge — a "decentered" lake or
 * massif rather than a bay with a rounder outline.
 */
function biasedCenter(side: Side, rnd: Rnd, size: number): { x: number; z: number } {
  const edgeMid = pointOnSide(side, 0.5, size)
  const inner = { x: rnd() * (size - 1), z: rnd() * (size - 1) }
  return mixPoint(inner, edgeMid, 0.55)
}

// ---------------------------------------------------------------------------
// Water shapes
// ---------------------------------------------------------------------------

export type WaterKind = 'bay' | 'lake' | 'archipelago' | 'river'
export const WATER_KINDS: WaterKind[] = ['bay', 'lake', 'archipelago', 'river']

/**
 * One closed blob, decentered toward `side` rather than pinned to the edge.
 * Radius 0.30 * size: measured with terrain-stats, this is the smallest
 * radius that still lets the water budget (up to ~22% of the board on a
 * water-heavy seed) fit inside the blob's footprint without the budget
 * spilling onto near-zero field tiles far from the lake, which would read as
 * scattered puddles instead of one lake.
 */
function lakeField(side: Side, rnd: Rnd, size: number): Field {
  const c = biasedCenter(side, rnd, size)
  const radius = 0.3 * size
  return keepAwayFromCentre((x, z) => blobField(x, z, c.x, c.z, radius), size)
}

/**
 * 4-7 small ponds, denser toward `side`: every centre is drawn with the same
 * edge-ward bias as a lake, so the cluster still reads as belonging to that
 * side of the board even though individual ponds scatter. Per-pond radius
 * 0.12 * size — big enough that a couple of ponds alone can still meet a
 * modest water budget, small enough that 7 of them stay visually separate
 * islands rather than merging into one blob.
 */
function archipelagoField(side: Side, rnd: Rnd, size: number): Field {
  const count = 4 + Math.floor(rnd() * 4) // 4..7
  const radius = 0.12 * size
  const blobs: Field[] = []
  for (let i = 0; i < count; i++) {
    const c = biasedCenter(side, rnd, size)
    blobs.push((x, z) => blobField(x, z, c.x, c.z, radius))
  }
  return keepAwayFromCentre(maxOf(...blobs), size)
}

/**
 * A two-segment course from `side` to the opposite edge, bent around the
 * centre so it never sweeps through the starting plot the way a straight
 * diagonal would. The elbow point is offset perpendicular to the straight
 * entry-exit line by 0.38 * size — enough that, combined with startMask
 * already zeroing the centremost tiles, neither leg's closest approach to the
 * board's centre lands inside the safe zone (the starting plot plus its ring
 * is at most ~0.28 * size from centre at WORLD_SIZE=36; 0.38 leaves margin).
 * Width 0.05 * size reads as a river rather than a lake arm.
 */
function riverField(side: Side, rnd: Rnd, size: number): Field {
  const entry = pointOnSide(side, 0.25 + rnd() * 0.5, size)
  const exit = pointOnSide(opposite(side), 0.25 + rnd() * 0.5, size)
  const mid = center(size)

  // Perpendicular to the entry->exit direction, so the bend pushes the
  // course sideways off its straight line rather than lengthening it.
  const dx = exit.x - entry.x
  const dz = exit.z - entry.z
  const len = Math.hypot(dx, dz) || 1
  const perpX = -dz / len
  const perpZ = dx / len
  const sign = rnd() < 0.5 ? -1 : 1
  const offset = 0.38 * size * sign

  const bend = { x: mid + perpX * offset, z: mid + perpZ * offset }
  const width = 0.05 * size

  return keepAwayFromCentre(
    maxOf(
      (x, z) => segField(x, z, entry.x, entry.z, bend.x, bend.z, width),
      (x, z) => segField(x, z, bend.x, bend.z, exit.x, exit.z, width),
    ),
    size,
  )
}

export function waterField(kind: WaterKind, side: Side, rnd: Rnd, size: number): Field {
  switch (kind) {
    case 'lake':
      return lakeField(side, rnd, size)
    case 'archipelago':
      return archipelagoField(side, rnd, size)
    case 'river':
      return riverField(side, rnd, size)
    default:
      return (x, z) => edgeField(x, z, side, size)
  }
}

// ---------------------------------------------------------------------------
// Rock shapes
// ---------------------------------------------------------------------------

export type RockKind = 'range' | 'ridge' | 'massif' | 'buttes'
export const ROCK_KINDS: RockKind[] = ['range', 'ridge', 'massif', 'buttes']

/**
 * One round massif, same construction as a lake (a single decentered blob)
 * but slightly smaller (0.26 * size vs 0.30): measured with terrain-stats,
 * rock's budget share can run as low as ~5.5% of the board, and a massif this
 * size still comfortably covers that without oversizing the common case.
 */
function massifField(side: Side, rnd: Rnd, size: number): Field {
  const c = biasedCenter(side, rnd, size)
  const radius = 0.26 * size
  return keepAwayFromCentre((x, z) => blobField(x, z, c.x, c.z, radius), size)
}

/**
 * 3-6 isolated peaks — fewer and further apart than an archipelago's ponds,
 * which is the visual difference between "scattered buttes" and "a cluster of
 * islands". Radius 0.13 * size, centres drawn from the full board (not just
 * biased toward `side`'s near half) so the buttes read as sparse outliers
 * rather than a second little massif.
 */
function buttesField(side: Side, rnd: Rnd, size: number): Field {
  const count = 3 + Math.floor(rnd() * 4) // 3..6
  const radius = 0.13 * size
  const blobs: Field[] = []
  for (let i = 0; i < count; i++) {
    // Half the pull of biasedCenter's usual 0.55: still leans toward `side`
    // on average, but spreads far enough that individual buttes stay isolated.
    const edgeMid = pointOnSide(side, 0.5, size)
    const inner = { x: rnd() * (size - 1), z: rnd() * (size - 1) }
    const c = mixPoint(inner, edgeMid, 0.25)
    blobs.push((x, z) => blobField(x, z, c.x, c.z, radius))
  }
  return keepAwayFromCentre(maxOf(...blobs), size)
}

/**
 * A diagonal ridge: one segment running corner-to-corner-ish across 40% of
 * the board, anchored near `side` so the "which edge is rock's home side"
 * intent still shows. Endpoints are jittered off a pure 45-degree diagonal so
 * every seed doesn't draw the same line. Width 0.10 * size — narrower than a
 * massif's blob so it reads as a ridge, wide enough that the topmost budget
 * share (~22%) still fits along its length without spilling far past the line.
 */
function ridgeField(side: Side, rnd: Rnd, size: number): Field {
  const anchor = pointOnSide(side, 0.2 + rnd() * 0.6, size)
  const angle = (Math.PI / 4) * (rnd() < 0.5 ? 1 : -1) + (rnd() - 0.5) * 0.6
  const length = 0.4 * size
  const other = { x: anchor.x + Math.cos(angle) * length, z: anchor.z + Math.sin(angle) * length }
  const width = 0.1 * size
  return keepAwayFromCentre((x, z) => segField(x, z, anchor.x, anchor.z, other.x, other.z, width), size)
}

export function rockField(kind: RockKind, side: Side, rnd: Rnd, size: number): Field {
  switch (kind) {
    case 'ridge':
      return ridgeField(side, rnd, size)
    case 'massif':
      return massifField(side, rnd, size)
    case 'buttes':
      return buttesField(side, rnd, size)
    default:
      return (x, z) => edgeField(x, z, side, size)
  }
}
