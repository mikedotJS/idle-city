/**
 * Facade attachment points: where on a building a wall/roof-mounted prop
 * (an AC unit, an antenna, an awning bracket, a hanging sign, cafe furniture
 * out front) would sit. This is a pure lookup, derived from the exact same
 * numbers buildings.ts uses to build the real geometry — see `buildParts`
 * there, which now also returns `wallTopY`/`halfWidth`/`halfDepth` alongside
 * the `roofPivotY` it already tracked for the roof-tilt animation.
 *
 * Reusing `buildParts` (rather than re-deriving the numbers here) means a
 * facade prop can never drift out of sync with a change to a building's
 * actual dimensions — the two are computed by the same code. The cost is
 * that `buildParts` also builds the real BufferGeometry for the look, which
 * this module throws away; that is wasted CPU, but `attachmentFor` is meant
 * to be called per building placement, not per frame, so it is cheap enough
 * to leave alone rather than fork the dimension math into a second copy that
 * could quietly go stale.
 *
 * Approximations, spelled out so a later task does not have to rediscover
 * them by comparing renders:
 *   - A handful of looks (the park, the botanical garden, the landfill) have
 *     no real walls. `wallTopY`/`halfWidth`/`halfDepth` there stand in for
 *     "the flattest, most sign-friendly surface" rather than an actual wall.
 *   - A merged 2x2 "maxi" look is frequently a *cluster* of sub-volumes (the
 *     apartment block's four wings, the industrial complex's two halls, ...)
 *     rather than one box. `halfWidth`/`halfDepth` there are the bounding
 *     half-extent of the whole cluster, and `wallTopY` is the wall height of
 *     the cluster's main/tallest volume — good enough to keep a prop from
 *     floating off the block or clipping into it, not an exact per-wing
 *     surface.
 *   - `frontYaw` is always 0: every look's frontage details (a shopfront
 *     glazing band, a school's entrance recess, a restaurant's sidewalk
 *     board, a harbour's dockside edge, ...) consistently sit at local +z,
 *     so "front" is a fixed object-space direction here. The building's own
 *     per-instance yaw (`variant`-derived, applied only at render time — see
 *     buildings.ts) is not part of this lookup; a caller placing a prop in
 *     world space must add the instance's actual yaw on top of `frontYaw`.
 *   - A merged shop's real dimensions depend on its commerce kind (food
 *     court / department store / supermarket / arcade), which this lookup's
 *     signature does not take. The optional `kind` parameter covers that
 *     when known; left unset for a merged shop, it falls back to the food
 *     court's footprint as a representative "maxi shop" size (the four maxi
 *     shop kinds range roughly 0.6-0.92 world half-width; food court sits in
 *     the middle of that range).
 */

import type { Biome } from '../sim/terrain'
import type { BuildingType, CommerceKind } from '../sim/types'
import { buildParts, MERGE_HEIGHT_SCALE, MERGE_SCALE } from './buildings'

export interface AttachmentPoint {
  /** World-space y of the wall top, before any per-instance height jitter. */
  wallTopY: number
  /** Half-extent of the body along local x (pre-yaw), world units. */
  halfWidth: number
  /** Half-extent of the body along local z (pre-yaw), world units. */
  halfDepth: number
  /** World-space y the roof pivots about — see buildings.ts's `roofPivotY`. */
  roofPivotY: number
  /**
   * Object-space yaw (radians) the building's front faces, before the
   * instance's own per-building yaw is applied. Always 0 today — see the
   * module doc — kept as a field so a future look that breaks the pattern
   * does not need a signature change.
   */
  frontYaw: number
}

/** A representative maxi shop kind, used when a merged shop's kind is not
 * known to the caller. See the module doc for why food_court was picked. */
const DEFAULT_MAXI_SHOP_KIND: CommerceKind = 'food_court'

/**
 * Looks up where facade props attach for a given type/level/biome/merge
 * state. Pure: no geometry is built into the scene, no state is read or
 * written, and the same inputs always return the same numbers.
 *
 * `kind` only matters for a merged ('maxi') shop, whose dimensions vary by
 * commerce kind; every other type/level/biome combination ignores it.
 */
export function attachmentFor(
  type: BuildingType,
  level: number,
  biome: Biome,
  merged: boolean,
  kind?: CommerceKind,
): AttachmentPoint {
  const effectiveKind = kind ?? (type === 'shop' && merged ? DEFAULT_MAXI_SHOP_KIND : 'general')
  const parts = buildParts(type, biome, level, effectiveKind, merged)

  // buildParts authors every look in the same local +/-0.5 space; a merged
  // anchor is the one case rendered at MERGE_SCALE x MERGE_HEIGHT_SCALE x
  // MERGE_SCALE (see buildings.ts's render loop), so the world-space numbers
  // a facade prop needs must apply that same scale here.
  const scaleXZ = merged ? MERGE_SCALE : 1
  const scaleY = merged ? MERGE_HEIGHT_SCALE : 1

  return {
    wallTopY: parts.wallTopY * scaleY,
    halfWidth: parts.halfWidth * scaleXZ,
    halfDepth: parts.halfDepth * scaleXZ,
    roofPivotY: parts.roofPivotY * scaleY,
    frontYaw: 0,
  }
}
