/**
 * Ambient street furniture and yard props, placed on the anchors
 * sim/decor.ts derives from the road network and ownership. Seven kerb props
 * live here so far:
 *  - a bollard light — a short, squat ground-level lamp, distinct from the
 *    taller post-and-arm street lamp in render/roads.ts (which this file
 *    does not touch)
 *  - a trash can — a static ribbed cylinder with a lid
 *  - a fire hydrant — a static stubby body with side nozzle caps
 *  - a mailbox — a thin post topped with a boxy, domed red postbox head
 *  - a parking meter — the same thin post topped with a small dark-grey
 *    rectangular meter head; the two share thinPost() as their common base
 *  - a park bench — slats and legs in DECOR_WOOD_BROWN. The first ORIENTED
 *    kerb prop: its backrest is built along local +X, and sync() rotates it
 *    by the NEGATED anchor yaw (see the comment above benchAnchors below) so
 *    the back consistently faces the building and the seat faces the street
 *    on every street orientation, not just some of them.
 *  - a recycling bin — a green wheelie-bin body with a hinge nub suggesting
 *    a hinged lid, and two wheel bumps at the back. Static like the trash
 *    can/hydrant, and left unrotated-corrected since its silhouette reads
 *    fine either way round.
 *  - a blank signboard — a thin post (thinPost(), shared with the mailbox
 *    and parking meter) topped with a blank rectangular panel. Static, no
 *    emissive part.
 *  - a traffic cone — an orange-and-white striped cone, built as three
 *    stacked frusta so the middle band can carry the white stripe colour.
 *  - a garbage bag — a slumped black blob() shape (main lobe plus a smaller
 *    offset lobe, like the fire hydrant's own dome reuse of blob()).
 *  - a wooden pallet — a flat stack of DECOR_WOOD_BROWN slats on bearers, in
 *    the same wood tone as the bench.
 *  - a bicycle — leant against the kerb: two flat-disc tyres (thin cylinders,
 *    not toroidal rims — a true spoked wheel is sub-pixel at this scale), a
 *    frame reduced to a couple of angled bars via box(), and a small saddle
 *    and handlebar nub for silhouette.
 *  - a scooter/moped — the same flat-disc-wheel simplification, with a boxy
 *    body/seat block and a small handlebar/windscreen stub standing in for
 *    the front end. Background clutter, not a hero asset, so it stays this
 *    plain on purpose.
 *
 *  The signboard, cone, bag, pallet, bicycle and scooter are the eighth
 *  through thirteenth (and last) members of the shared KERB_PROP_SALT band
 *  chain. Unlike every prop before them, the cone/bag/pallet/bike/scooter
 *  quintet ignores the anchor's own yaw (which always points "outward",
 *  matching the kerb line) and instead each draws its own independent random
 *  yaw from the anchor's seed (see randomYaw() and the
 *  CONE_YAW_SALT/BAG_YAW_SALT/PALLET_YAW_SALT/BIKE_YAW_SALT/SCOOTER_YAW_SALT
 *  constants), so loose junk reads as haphazardly dropped rather than aligned
 *  to the street like the rest of the layer. The bike and scooter go one step
 *  further: on top of that random yaw, each is built standing upright with
 *  its wheelbase along local +X, then tilted a few degrees about that same
 *  local axis BEFORE the yaw is applied (see BIKE_LEAN and SCOOTER_LEAN),
 *  so every instance leans over "against the kerb" by the same fixed amount
 *  regardless of which way it happens to be facing, rather than standing
 *  perfectly — and implausibly — vertical.
 *
 * A fourteenth prop, a traffic light, is drawn from a SEPARATE anchor pool: the
 * `corner` anchors sim/decor.ts derives for junction aprons, not the `kerb`
 * anchors the eight props above share. Corners are a disjoint pool from kerb
 * slots (no collision risk between the two), so the traffic light gets its
 * own hash roll (CORNER_PROP_SALT) and its own single-band density check
 * rather than joining the kerb chain. Unlike the trash can/hydrant/bench/
 * bin/signboard/cone/bag/pallet, it has an emissive part: its signal-head lens reuses the
 * bollard's exact glow technique (a small MeshBasicMaterial part, coloured
 * per-instance in frame() from the same WINDOW_GLOW tone on the same
 * night-gated smoothstep curve), because it is meant to read as a working
 * light after dark, not a piece of static furniture.
 *
 * Same shape as every other scenery layer (see ambient-api.ts): one merged
 * rebuild in sync(), nothing but colour touched in frame(). Instancing and
 * night-gating copy the technique roads.ts already proved for its lamp —
 * an unlit metal body plus a small emissive cap and a soft additive pool,
 * all switched on together by the same smoothstep curve — but the geometry
 * itself is deliberately different: shorter, squatter, a single glowing cap
 * instead of a post-mounted arm and head. The trash can, fire hydrant, bench,
 * recycling bin, signboard, cone, garbage bag, pallet, bicycle and scooter
 * are static street furniture instead: no emissive parts, no night gate,
 * each a single merged vertex-coloured geometry in its own InstancedMesh.
 * The traffic light sits in between: a
 * static vertex-coloured body (post + housing) plus a separate emissive lens
 * mesh, like the bollard, but with no additive ground pool — a chest-height
 * fixture's glow reads fine from the lens alone, so no pool was added.
 *
 * A prop this thin never casts a shadow: at the shadow map's resolution a
 * few-centimetre-wide post smears into a dotted streak rather than reading
 * as a shadow, exactly the reasoning roads.ts already documents for its own
 * lamp post — and it applies even more directly to the can, hydrant, bench,
 * bin, signboard, bicycle, scooter and traffic light.
 *
 * A fifteenth and sixteenth prop, a hedge/bush and a small tree, draw from a
 * THIRD, separate anchor pool: `yard` anchors (the centre of an owned,
 * buildable, currently-empty tile), not the `kerb`/`corner` pools above. Like
 * the traffic light they get their own salt (YARD_PROP_SALT) and disjoint
 * band split, sized looser than the kerb chain's since a whole empty plot is
 * rarer and more prominent than a kerb slot. The hedge clusters a few
 * blob() lobes together, the same trick buildings.ts's own deciduous park
 * canopy uses. The tree reuses buildings.ts's palm()/conifer() builders
 * outright (both exported for this purpose) at the same scale that file
 * already draws them at, picking palm on Coast tiles and conifer everywhere
 * else via a biome lookup on the tile the anchor resolves to — the same
 * palm/conifer split a park building already makes by biome. Both are
 * static like most props above (no emissive part, no night gate), but
 * UNLIKE every prop above, both cast (and receive) a shadow: a hedge clump
 * and a tree canopy are real, wide 3D volumes at building-canopy scale, the
 * same class of geometry buildings.ts already shadow-casts for its own roof/
 * foliage meshes, not a smeared sub-pixel post.
 *
 * A seventeenth prop, a flower planter box, is the sixteenth (and last) member
 * of the KERB_PROP_SALT chain: a terracotta box() topped with a small
 * blob()-lobe foliage cluster and two small warm-accent blobs standing in for
 * flowers (DECOR_SIGNAL_RED and DECOR_SAFETY_ORANGE, reused rather than
 * adding new palette entries). Static, no emissive part, no shadow — same
 * scale class as the trash can/bin, not the hedge/tree.
 *
 * An eighteenth prop, a potted plant, draws from `yard` anchors like the
 * hedge/tree, but is the odd one out there: it is a SMALL standalone accent,
 * physically closer in scale to the kerb props (a terracotta cyl() pot with a
 * single blob() canopy) than to the hedge/tree's building-canopy scale, so it
 * uses the same no-shadow configureMesh() treatment every kerb prop gets
 * instead of configureYardMesh().
 *
 * A nineteenth and twentieth prop, a wooden fence run and a stone wall run,
 * draw from a FOURTH pool: `edge-run` anchors (see sim/decor.ts's
 * edgeRunAnchors() — one point per side of every yard tile, four per tile,
 * offset almost to the tile boundary and already yawed so a prop's local Z
 * axis runs ALONG the edge and local X points inward). Rather than each
 * anchor spawning a single small object, each is ONE INSTANCE of a
 * multi-part geometry that already reads as a short run of fence/wall on its
 * own (a handful of posts and rails, or a handful of stacked stone blocks,
 * spanning most of the tile edge's length) — the "repeating unit" the task
 * calls for is baked into the geometry itself, not built out of several
 * anchors per edge, because sim/decor.ts only ever hands out one anchor per
 * side.
 *
 * Consuming this pool needs a new trick none of `kerb`/`corner`/`yard` needed:
 * a WHOLE TILE has to read as consistently fenced or consistently walled (or
 * neither) around its full perimeter, never fence on one side and wall on the
 * next. The four edge-run anchors of one tile carry four DIFFERENT seeds
 * (sim/decor.ts hashes in a per-side direction index), so rolling per-anchor
 * the way every earlier pool does would mix treatments across one tile's own
 * sides. Instead EDGE_PROP_SALT is rolled against the TILE the anchor stands
 * on (recovered via worldToTile() on the anchor's own position — every
 * edge-run point sits within 0.49 tiles of its tile's centre, so it always
 * rounds back to that same tile), which is identical for all four of a
 * tile's anchors, giving one shared roll per yard and so one consistent
 * verdict for its whole boundary.
 *
 * Corners are not specially handled: two adjacent edges' runs both extend
 * most of the way to the shared corner, so their end posts/blocks can overlap
 * there. Cheapest option per the task brief — a few centimetres of clipped
 * geometry at a corner is not worth tracking shared corner state for.
 *
 * Both are static like most props above (no emissive part, no night gate, no
 * shadow — thin/low like the kerb chain's furniture, not the hedge/tree's
 * real canopy volume).
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three'
import { computeDecorAnchors } from '../sim/decor'
import { worldToTile } from '../sim/grid'
import { hash32 } from '../sim/sidewalks'
import { Biome, terrainFor } from '../sim/terrain'
import type { CityState } from '../sim/types'
import type { DecorView } from './ambient-api'
import { conifer, palm } from './buildings'
import {
  clamp01,
  DECOR_GALVANISED_GREY,
  DECOR_LEAF_GREEN,
  DECOR_SAFETY_ORANGE,
  DECOR_SIGN_CREAM,
  DECOR_SIGNAL_RED,
  DECOR_STONE_GREY,
  DECOR_TERRACOTTA,
  DECOR_WOOD_BROWN,
  hexToRgb,
  setSrgb,
  smoothstep,
  WINDOW_GLOW,
} from './palette'
import { blob, box, cyl, mergeParts, tint } from './shapes'

// ---------------------------------------------------------------------------
// Dimensions — squat on purpose: about a third of the street lamp's post
// height (POST_H = 0.3 in roads.ts), with no arm at all.
// ---------------------------------------------------------------------------

const BOLLARD_H = 0.1
const BOLLARD_TOP_R = 0.026
const BOLLARD_BOTTOM_R = 0.033
/** The glowing cap: a squashed dome sitting on top of the post. */
const CAP_R = 0.03
const CAP_SQUASH = 0.62
const POOL_R = 0.16

/**
 * Every kerb-mounted prop type (bollard light, trash can, fire hydrant,
 * mailbox, parking meter, park bench, recycling bin) is drawn from ONE shared
 * hash per anchor, split into disjoint, non-overlapping bands. This
 * guarantees a kerb slot hosts at most one prop — no two props can ever land
 * on the same spot and clip through each other. Each band's width is that
 * prop's spawn share; a kerb slot that lands past the last band gets
 * nothing, which is most of them.
 */
const KERB_PROP_SALT = 0xb0117a2d
const BOLLARD_CHANCE = 0.1
const TRASH_CHANCE = 0.1
const HYDRANT_CHANCE = 0.1
const MAILBOX_CHANCE = 0.1
const METER_CHANCE = 0.1
const BENCH_CHANCE = 0.1
const RECYCLE_CHANCE = 0.1
const SIGN_CHANCE = 0.1
const CONE_CHANCE = 0.1
const BAG_CHANCE = 0.1
const PALLET_CHANCE = 0.1
/** Rarer than the loose clutter: a parked bike or scooter is a bigger visual
 *  statement than a dropped cone or bag, so each gets a smaller band. */
const BIKE_CHANCE = 0.08
const SCOOTER_CHANCE = 0.08
/** A flower planter box — the fifteenth (and last) member of the
 *  KERB_PROP_SALT chain, sized the same sparse share as a parked bike or
 *  scooter: a planter is as much of a visual statement as either, not
 *  background clutter like a cone or bag. */
const PLANTER_CHANCE = 0.08

const BOLLARD_BAND_START = 0
const TRASH_BAND_START = BOLLARD_BAND_START + BOLLARD_CHANCE
const HYDRANT_BAND_START = TRASH_BAND_START + TRASH_CHANCE
const MAILBOX_BAND_START = HYDRANT_BAND_START + HYDRANT_CHANCE
const METER_BAND_START = MAILBOX_BAND_START + MAILBOX_CHANCE
const METER_BAND_END = METER_BAND_START + METER_CHANCE
const BENCH_BAND_START = METER_BAND_END
const BENCH_BAND_END = BENCH_BAND_START + BENCH_CHANCE
const RECYCLE_BAND_START = BENCH_BAND_END
const RECYCLE_BAND_END = RECYCLE_BAND_START + RECYCLE_CHANCE
const SIGN_BAND_START = RECYCLE_BAND_END
const SIGN_BAND_END = SIGN_BAND_START + SIGN_CHANCE
// Three loose-clutter props — a traffic cone, a dropped garbage bag and a
// leant wooden pallet — extend the same disjoint chain. Unlike every prop
// above, each of these ignores the anchor's own yaw (which always points
// "outward" toward the street, matching the kerb line) and instead draws its
// own independent random yaw per prop type (see CONE_YAW_SALT etc. below),
// so loose junk reads as haphazardly dropped rather than aligned to the
// street like every oriented/unoriented-but-still-anchor-yawed prop before it.
const CONE_BAND_START = SIGN_BAND_END
const CONE_BAND_END = CONE_BAND_START + CONE_CHANCE
const BAG_BAND_START = CONE_BAND_END
const BAG_BAND_END = BAG_BAND_START + BAG_CHANCE
const PALLET_BAND_START = BAG_BAND_END
const PALLET_BAND_END = PALLET_BAND_START + PALLET_CHANCE
// Bicycle and scooter — the thirteenth and fourteenth (and last) members of
// the KERB_PROP_SALT chain. Like the loose-clutter trio above they draw an
// independent random yaw rather than the anchor's own; unlike that trio they
// also carry a fixed "leaning against the kerb" tilt — see the file header
// and BIKE_LEAN/SCOOTER_LEAN below.
const BIKE_BAND_START = PALLET_BAND_END
const BIKE_BAND_END = BIKE_BAND_START + BIKE_CHANCE
const SCOOTER_BAND_START = BIKE_BAND_END
const SCOOTER_BAND_END = SCOOTER_BAND_START + SCOOTER_CHANCE
// Flower planter box — the fifteenth and last member of the KERB_PROP_SALT
// chain. Placed with the anchor's own yaw, like the trash can/hydrant/bin
// before it (it is not loose clutter, so it does not need an independent
// random yaw the way the cone/bag/pallet/bike/scooter quintet does).
const PLANTER_BAND_START = SCOOTER_BAND_END
const PLANTER_BAND_END = PLANTER_BAND_START + PLANTER_CHANCE

function kerbPropRoll(seed: number): number {
  return hash32(seed ^ KERB_PROP_SALT) / 0xffffffff
}

/** Salts for the loose-clutter and leaning props' independent random yaw,
 *  distinct from KERB_PROP_SALT (which decides WHETHER a prop spawns) and
 *  from each other (so a cone, a bag, a pallet, a bike and a scooter that
 *  happened to land on different anchors don't all face the same direction
 *  by sharing one roll). */
const CONE_YAW_SALT = 0x1a2f6d43
const BAG_YAW_SALT = 0x7e94c108
const PALLET_YAW_SALT = 0x3d5b8f27
const BIKE_YAW_SALT = 0x60c4a915
const SCOOTER_YAW_SALT = 0x2b8e17d6

function randomYaw(seed: number, salt: number): number {
  return (hash32(seed ^ salt) / 0xffffffff) * Math.PI * 2
}

/**
 * The traffic light draws from a SEPARATE pool — `corner` anchors, not
 * `kerb` ones — so it gets its own salt rather than joining the kerb chain
 * above: there is no shared-slot collision to guard against between the two
 * anchor kinds, but the roll still has to stay deterministic per anchor seed,
 * so it is hashed the same way. A single band (no chain needed, since this
 * is the only corner-anchor prop so far) sized a bit more generously than a
 * kerb prop's share: corners are rarer than kerb slots, so a higher hit rate
 * still keeps traffic lights looking sparse rather than on every corner.
 */
const CORNER_PROP_SALT = 0x5f3c9e11
const TRAFFIC_LIGHT_CHANCE = 0.4

function cornerPropRoll(seed: number): number {
  return hash32(seed ^ CORNER_PROP_SALT) / 0xffffffff
}

/**
 * A fifteenth and sixteenth prop draw from a THIRD pool: `yard` anchors — the
 * centre of an owned, buildable tile that is currently empty (see
 * sim/decor.ts's doc comment). Disjoint from both `kerb` and `corner`, so it
 * gets its own salt and its own two-way disjoint band split, the same
 * one-slot-one-prop guarantee the kerb chain gives its own props. Yard tiles
 * are sparser and more visually prominent than a kerb slot (an empty plot is
 * a much bigger piece of real estate than a stretch of pavement), so each
 * band is sized to read as "some empty yards have greenery, not all" rather
 * than matching the kerb chain's tight per-item shares.
 */
const YARD_PROP_SALT = 0x4c8d21f6
const HEDGE_CHANCE = 0.2
const TREE_CHANCE = 0.2
/** A potted plant — the third member of the YARD_PROP_SALT chain,
 *  sized a touch sparser than the hedge/tree bands: it is a small standalone
 *  accent rather than the yard's own headline greenery. */
const POTTED_CHANCE = 0.18
/** Stacked wooden crates — a minor background accent, sized the same sparse
 *  share as the potted plant: a casual pile of boxes reads as yard clutter
 *  rather than a deliberate visual statement. */
const CRATE_CHANCE = 0.12

const HEDGE_BAND_START = 0
const HEDGE_BAND_END = HEDGE_BAND_START + HEDGE_CHANCE
const TREE_BAND_START = HEDGE_BAND_END
const TREE_BAND_END = TREE_BAND_START + TREE_CHANCE
const POTTED_BAND_START = TREE_BAND_END
const POTTED_BAND_END = POTTED_BAND_START + POTTED_CHANCE
const CRATE_BAND_START = POTTED_BAND_END
const CRATE_BAND_END = CRATE_BAND_START + CRATE_CHANCE

function yardPropRoll(seed: number): number {
  return hash32(seed ^ YARD_PROP_SALT) / 0xffffffff
}

/**
 * A fourth pool, `edge-run` anchors (see the file header), draws a wooden
 * fence run and a stone wall run. Unlike every roll above, this one is NOT
 * hashed against the anchor's own seed (each of a tile's four edges carries a
 * different one) but against the TILE the anchor stands on, so all four
 * sides of one yard share a single verdict — see the file header for why.
 */
const EDGE_PROP_SALT = 0x9a6e1f3c
const FENCE_CHANCE = 0.12
const WALL_CHANCE = 0.1

const FENCE_BAND_START = 0
const FENCE_BAND_END = FENCE_BAND_START + FENCE_CHANCE
const WALL_BAND_START = FENCE_BAND_END
const WALL_BAND_END = WALL_BAND_START + WALL_CHANCE

/** Rolls EDGE_PROP_SALT against the tile a world point sits on, not against a
 *  per-anchor seed — see the comment above EDGE_PROP_SALT. Returns null if
 *  the point somehow resolves outside the map (should not happen for a valid
 *  edge-run anchor, but guards the lookup rather than assuming). */
function edgeTileRoll(x: number, z: number): number | null {
  const tile = worldToTile(x, z)
  if (tile === null) return null
  return hash32(tile ^ EDGE_PROP_SALT) / 0xffffffff
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

const BODY_COLOR = hexToRgb(DECOR_GALVANISED_GREY)
/** Unlit cap in daylight: a shade darker than the body, like weathered plastic. */
const CAP_DARK = hexToRgb(0x8a8580)
/** Reuses the window-glow warm tone rather than inventing a new one, so every
 *  light source in the city (windows, street lamps, bollards) sits on the
 *  same warm family after dark. */
const CAP_GLOW = WINDOW_GLOW

/** A shade darker than the trash can body, for the lid and ribs — same trick
 *  the bollard cap uses for its own unlit daytime colour. */
const TRASH_DARK = hexToRgb(0x74706a)
const HYDRANT_COLOR = hexToRgb(DECOR_SIGNAL_RED)
/** The nozzle caps read as threaded metal, not painted body — same grey the
 *  bollard post uses, so every unpainted-metal detail in the layer agrees. */
const HYDRANT_CAP_COLOR = hexToRgb(DECOR_GALVANISED_GREY)

const MAILBOX_COLOR = hexToRgb(DECOR_SIGNAL_RED)
/** A darker charcoal grey than DECOR_GALVANISED_GREY, so the meter reads as
 *  its own dark-metal fixture rather than repeating the bollard/trash-can
 *  body tone. */
const METER_COLOR = hexToRgb(0x5c5f61)

const BENCH_COLOR = hexToRgb(DECOR_WOOD_BROWN)
const BIN_COLOR = hexToRgb(DECOR_LEAF_GREEN)
/** A shade darker than the bin body, for the lid, hinge nub and wheels —
 *  same trick TRASH_DARK uses against the trash can body. */
const BIN_DARK = hexToRgb(0x5a9138)

/** The signboard's post reuses the same galvanised grey as the bollard/trash
 *  can body, so it reads as the same unpainted-metal family; the panel is a
 *  blank light cream face, matching the moodboard reference. */
const SIGN_POST_COLOR = hexToRgb(DECOR_GALVANISED_GREY)
const SIGN_PANEL_COLOR = hexToRgb(DECOR_SIGN_CREAM)

/** Safety-orange cone body, striped with the same sign-cream white used by
 *  the signboard's panel so the layer does not invent a second "white". */
const CONE_COLOR = hexToRgb(DECOR_SAFETY_ORANGE)
const CONE_STRIPE_COLOR = hexToRgb(DECOR_SIGN_CREAM)
/** Near-black plastic for a slumped, full garbage bag. */
const BAG_COLOR = hexToRgb(0x1c1c1e)
/** Reuses DECOR_WOOD_BROWN, same as the bench, so every wooden prop in the
 *  layer agrees on one wood tone. */
const PALLET_COLOR = hexToRgb(DECOR_WOOD_BROWN)

/** The bicycle's frame reuses the galvanised grey the bollard/trash-can body
 *  already carries, so it reads as unpainted tube steel rather than
 *  inventing a second metal. */
const BIKE_FRAME_COLOR = hexToRgb(DECOR_GALVANISED_GREY)
/** Near-black rubber, shared between the bike's and the scooter's tyres —
 *  same near-black the garbage bag uses for plastic, reused here for rubber
 *  since both read as "dark and matte" at this scale. */
const TIRE_COLOR = hexToRgb(0x232323)
/** A muted teal-plastic moped body, distinct from every other prop's palette
 *  (metal, wood, safety orange, signal red) so parked scooters read as their
 *  own thing rather than a repaint of an existing prop. */
const SCOOTER_BODY_COLOR = hexToRgb(0x5f8a99)

/** The hedge reuses the same leaf green as the recycling bin body rather than
 *  inventing a second green — both read as "clipped/living plant matter". */
const HEDGE_COLOR = hexToRgb(DECOR_LEAF_GREEN)
/** The yard tree's trunk/fronds and canopy reuse the bench/pallet wood tone
 *  and the hedge's leaf green respectively, so the two new yard props share
 *  their palette with the rest of the layer instead of inventing new tones —
 *  the same trick every prop above this one already follows. */
const TREE_TRUNK_COLOR = hexToRgb(DECOR_WOOD_BROWN)
const TREE_LEAF_COLOR = hexToRgb(DECOR_LEAF_GREEN)

/** Terracotta for both the planter box and the potted plant's pot — the same
 *  clay-fixture tone DECOR_TERRACOTTA's own palette comment already calls
 *  out for "planter pots and clay fixtures", reused rather than invented. */
const PLANTER_BOX_COLOR = hexToRgb(DECOR_TERRACOTTA)
/** Foliage reuses the hedge/tree leaf green, so every living plant in the
 *  layer agrees on one green. */
const PLANTER_FOLIAGE_COLOR = hexToRgb(DECOR_LEAF_GREEN)
/** Two small warm accents scattered sparingly through the foliage to read as
 *  flowers, reusing existing palette tones (signal red, safety orange)
 *  rather than adding new ones purely for this prop, per the file's "favour
 *  reuse over new palette entries" convention. */
const PLANTER_FLOWER_COLOR_A = hexToRgb(DECOR_SIGNAL_RED)
const PLANTER_FLOWER_COLOR_B = hexToRgb(DECOR_SAFETY_ORANGE)

/** The potted plant's pot reuses the same terracotta as the planter box; its
 *  canopy reuses the same leaf green as every other piece of greenery here. */
const POT_COLOR = hexToRgb(DECOR_TERRACOTTA)
const POT_CANOPY_COLOR = hexToRgb(DECOR_LEAF_GREEN)

/** Stacked wooden crate boxes — reuse the same wood tone as the bench/pallet,
 *  so every wooden prop in the layer agrees on one wood. */
const CRATE_BOX_COLOR = hexToRgb(DECOR_WOOD_BROWN)

/** The fence reuses the same wood tone as the bench/pallet, so every wooden
 *  prop in the layer agrees on one wood. */
const FENCE_COLOR = hexToRgb(DECOR_WOOD_BROWN)
/** The wall's stacked-stone blocks — see DECOR_STONE_GREY's own palette
 *  comment for why this is a new tone rather than a reuse of the galvanised
 *  metal grey every other grey fixture in this file shares. */
const WALL_COLOR = hexToRgb(DECOR_STONE_GREY)
/** A shade darker than WALL_COLOR, alternated across blocks so the wall reads
 *  as irregular stacked stone rather than a single flat-toned slab — same
 *  trick TRASH_DARK/BIN_DARK use against their own base colour. */
const WALL_DARK = hexToRgb(0x716e67)

/** Dark grey/near-black post and housing — a standard traffic-signal look,
 *  distinct from every other prop's unpainted-metal or wood-brown palette. */
const TRAFFIC_LIGHT_BODY_COLOR = hexToRgb(0x2b2b2e)
/** Unlit lens in daylight: dark smoked glass, a shade lighter than the
 *  housing so it still reads as a separate part — same trick the bollard
 *  cap uses against its own post. */
const TRAFFIC_LENS_DARK = hexToRgb(0x3c3c40)

function poolGeometry(): BufferGeometry {
  const geom = new RingGeometry(0, 1, 20, 1)
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

// ---------------------------------------------------------------------------
// Trash can — a squat ribbed cylinder with a lid, scaled against
// render/traffic.ts's PERSON_HEIGHT (0.16) the way a bin sits about
// waist-high on a person.
// ---------------------------------------------------------------------------

const TRASH_H = 0.085
const TRASH_TOP_R = 0.032
const TRASH_BOTTOM_R = 0.027
const TRASH_RIB_H = 0.008
const TRASH_LID_R = 0.037
const TRASH_LID_H = 0.012

function trashCanGeometry(): BufferGeometry {
  const bodyColor = setSrgb(new Color(), BODY_COLOR)
  const darkColor = setSrgb(new Color(), TRASH_DARK)
  const body = tint(cyl(TRASH_TOP_R, TRASH_BOTTOM_R, TRASH_H, 8, 0, TRASH_H / 2, 0), bodyColor)
  // Two ribs, slightly proud of the body radius they sit at, to read as
  // pressed-metal banding rather than a bare tube.
  const rib1 = tint(cyl(0.0335, 0.0335, TRASH_RIB_H, 8, 0, TRASH_H * 0.32, 0), darkColor)
  const rib2 = tint(cyl(0.0355, 0.0355, TRASH_RIB_H, 8, 0, TRASH_H * 0.68, 0), darkColor)
  const lid = tint(cyl(TRASH_LID_R, TRASH_LID_R, TRASH_LID_H, 8, 0, TRASH_H + TRASH_LID_H / 2, 0), darkColor)
  return mergeParts([body, rib1, rib2, lid])
}

// ---------------------------------------------------------------------------
// Fire hydrant — a stubby domed body with two side nozzle caps, sized against
// the same person-height reference (a real hydrant sits well under waist
// height, shorter than the trash can).
// ---------------------------------------------------------------------------

const HYDRANT_H = 0.05
const HYDRANT_TOP_R = 0.02
const HYDRANT_BOTTOM_R = 0.024
const HYDRANT_COLLAR_R = 0.026
const HYDRANT_COLLAR_H = 0.012
const HYDRANT_DOME_R = 0.02
const HYDRANT_NOZZLE_R = 0.011
const HYDRANT_NOZZLE_LEN = 0.02

function fireHydrantGeometry(): BufferGeometry {
  const bodyColor = setSrgb(new Color(), HYDRANT_COLOR)
  const capColor = setSrgb(new Color(), HYDRANT_CAP_COLOR)
  const body = tint(cyl(HYDRANT_TOP_R, HYDRANT_BOTTOM_R, HYDRANT_H, 8, 0, HYDRANT_H / 2, 0), bodyColor)
  const collar = tint(
    cyl(HYDRANT_COLLAR_R, HYDRANT_TOP_R, HYDRANT_COLLAR_H, 8, 0, HYDRANT_H + HYDRANT_COLLAR_H / 2, 0),
    bodyColor,
  )
  const domeY = HYDRANT_H + HYDRANT_COLLAR_H + HYDRANT_DOME_R * 0.7
  const dome = tint(blob(HYDRANT_DOME_R, 0, domeY, 0, 0.85), bodyColor)
  // Two side nozzle caps, one either side, stubbing out at mid-body height.
  // cyl()'s axis runs along y, so each nozzle is rotated onto x before it is
  // offset out from the body.
  const nozzleY = HYDRANT_H * 0.5
  const nozzleOffset = HYDRANT_BOTTOM_R + HYDRANT_NOZZLE_LEN / 2
  const nozzleLeft = cyl(HYDRANT_NOZZLE_R, HYDRANT_NOZZLE_R, HYDRANT_NOZZLE_LEN, 6)
    .rotateZ(Math.PI / 2)
    .translate(-nozzleOffset, nozzleY, 0)
  const nozzleRight = cyl(HYDRANT_NOZZLE_R, HYDRANT_NOZZLE_R, HYDRANT_NOZZLE_LEN, 6)
    .rotateZ(Math.PI / 2)
    .translate(nozzleOffset, nozzleY, 0)
  return mergeParts([body, collar, dome, tint(nozzleLeft, capColor), tint(nozzleRight, capColor)])
}

// ---------------------------------------------------------------------------
// Mailbox and parking meter — two more static, post-mounted kerb props.
// Both share the same thin-pole base (thinPost()) and differ only in head
// shape and colour, so the base is factored out once rather than duplicated.
// ---------------------------------------------------------------------------

const POST_H = 0.075
const POST_TOP_R = 0.008
const POST_BOTTOM_R = 0.011

/** The shared thin-pole base both props stand on. */
function thinPost(): BufferGeometry {
  return cyl(POST_TOP_R, POST_BOTTOM_R, POST_H, 8, 0, POST_H / 2, 0)
}

const MAILBOX_BODY_W = 0.034
const MAILBOX_BODY_H = 0.026
const MAILBOX_BODY_D = 0.026
const MAILBOX_DOME_R = 0.018

/** A boxy body with a rounded dome lid — a French/European roadside postbox. */
function mailboxGeometry(): BufferGeometry {
  const color = setSrgb(new Color(), MAILBOX_COLOR)
  const post = tint(thinPost(), color)
  const bodyY = POST_H + MAILBOX_BODY_H / 2
  const body = tint(box(MAILBOX_BODY_W, MAILBOX_BODY_H, MAILBOX_BODY_D, 0, bodyY, 0), color)
  const domeY = POST_H + MAILBOX_BODY_H + MAILBOX_DOME_R * 0.45
  const dome = tint(blob(MAILBOX_DOME_R, 0, domeY, 0, 0.55), color)
  return mergeParts([post, body, dome])
}

const METER_HEAD_W = 0.02
const METER_HEAD_H = 0.03
const METER_HEAD_D = 0.014
const METER_DOME_R = 0.011

/** A small rectangular meter head with a shallow domed top. */
function parkingMeterGeometry(): BufferGeometry {
  const color = setSrgb(new Color(), METER_COLOR)
  const post = tint(thinPost(), color)
  const bodyY = POST_H + METER_HEAD_H / 2
  const body = tint(box(METER_HEAD_W, METER_HEAD_H, METER_HEAD_D, 0, bodyY, 0), color)
  const domeY = POST_H + METER_HEAD_H + METER_DOME_R * 0.4
  const dome = tint(blob(METER_DOME_R, 0, domeY, 0, 0.45), color)
  return mergeParts([post, body, dome])
}

// ---------------------------------------------------------------------------
// Park bench — the first ORIENTED kerb prop: two seat slats, a two-slat
// backrest and two end legs, all DECOR_WOOD_BROWN. Built along local +X =
// depth (front-to-back) and local Z = width (the bench's length), with the
// backrest at +X, so a consumer that rotates it by -yaw (see the comment on
// BENCH_YAW_CORRECTION in createDecorView()) ends up with the back toward
// the building and the seat facing the street.
// ---------------------------------------------------------------------------

const BENCH_WIDTH = 0.1
const BENCH_SLAT_DEPTH = 0.014
const BENCH_SLAT_THICK = 0.006
const BENCH_SLAT_GAP = 0.006
const BENCH_SEAT_DEPTH = BENCH_SLAT_DEPTH * 2 + BENCH_SLAT_GAP
const BENCH_SEAT_H = 0.042
const BENCH_BACK_SLAT_H = 0.013
const BENCH_BACK_SLAT_GAP = 0.005
const BENCH_BACK_THICK = 0.007
const BENCH_LEG_W = 0.007
const BENCH_LEG_D = 0.007
const BENCH_LEG_INSET = 0.01

/** A slatted seat, two-slat backrest and two end legs — a plain park bench. */
function benchGeometry(): BufferGeometry {
  const color = setSrgb(new Color(), BENCH_COLOR)
  const seatSlatX = BENCH_SLAT_DEPTH / 2 + BENCH_SLAT_GAP / 2
  const seatSlat1 = tint(box(BENCH_SLAT_DEPTH, BENCH_SLAT_THICK, BENCH_WIDTH, -seatSlatX, BENCH_SEAT_H, 0), color)
  const seatSlat2 = tint(box(BENCH_SLAT_DEPTH, BENCH_SLAT_THICK, BENCH_WIDTH, seatSlatX, BENCH_SEAT_H, 0), color)

  const backX = BENCH_SEAT_DEPTH / 2 + BENCH_BACK_THICK / 2
  const backSlat1Y = BENCH_SEAT_H + BENCH_SLAT_THICK / 2 + BENCH_BACK_SLAT_H / 2
  const backSlat2Y = backSlat1Y + BENCH_BACK_SLAT_H + BENCH_BACK_SLAT_GAP
  const backSlat1 = tint(box(BENCH_BACK_THICK, BENCH_BACK_SLAT_H, BENCH_WIDTH, backX, backSlat1Y, 0), color)
  const backSlat2 = tint(box(BENCH_BACK_THICK, BENCH_BACK_SLAT_H, BENCH_WIDTH, backX, backSlat2Y, 0), color)

  const legZ = BENCH_WIDTH / 2 - BENCH_LEG_INSET
  const leg1 = tint(box(BENCH_LEG_W, BENCH_SEAT_H, BENCH_LEG_D, 0, BENCH_SEAT_H / 2, -legZ), color)
  const leg2 = tint(box(BENCH_LEG_W, BENCH_SEAT_H, BENCH_LEG_D, 0, BENCH_SEAT_H / 2, legZ), color)

  return mergeParts([seatSlat1, seatSlat2, backSlat1, backSlat2, leg1, leg2])
}

// ---------------------------------------------------------------------------
// Recycling bin — a green wheelie-bin body with a hinge nub suggesting a
// hinged lid and two small wheel bumps at the back, sized a touch taller
// than the trash can (a wheelie bin reads bigger than a street litter bin).
// ---------------------------------------------------------------------------

const BIN_W = 0.048
const BIN_D = 0.042
const BIN_H = 0.07
const BIN_LID_H = 0.01
const BIN_LID_OVERHANG = 0.004
const BIN_HINGE_R = 0.006
const BIN_WHEEL_R = 0.009
const BIN_WHEEL_LEN = 0.01

function recycleBinGeometry(): BufferGeometry {
  const bodyColor = setSrgb(new Color(), BIN_COLOR)
  const darkColor = setSrgb(new Color(), BIN_DARK)
  const body = tint(box(BIN_W, BIN_H, BIN_D, 0, BIN_H / 2, 0), bodyColor)
  const lid = tint(
    box(BIN_W + BIN_LID_OVERHANG * 2, BIN_LID_H, BIN_D + BIN_LID_OVERHANG * 2, 0, BIN_H + BIN_LID_H / 2, 0),
    darkColor,
  )
  // The hinge nub runs along the bin's width at the back top edge, where the
  // lid meets the body — cyl()'s axis runs along y, so it is rotated onto x
  // before it is placed, the same trick the hydrant uses for its nozzles.
  const hinge = tint(
    cyl(BIN_HINGE_R, BIN_HINGE_R, BIN_W * 0.7, 6)
      .rotateZ(Math.PI / 2)
      .translate(0, BIN_H + BIN_HINGE_R * 0.4, BIN_D / 2 - BIN_HINGE_R * 0.5),
    darkColor,
  )
  // Two wheel bumps at the base of the back edge.
  const wheelY = BIN_WHEEL_R * 0.7
  const wheelZ = BIN_D / 2 + BIN_WHEEL_R * 0.4
  const wheel1 = tint(
    cyl(BIN_WHEEL_R, BIN_WHEEL_R, BIN_WHEEL_LEN, 6)
      .rotateZ(Math.PI / 2)
      .translate(-BIN_W * 0.28, wheelY, wheelZ),
    darkColor,
  )
  const wheel2 = tint(
    cyl(BIN_WHEEL_R, BIN_WHEEL_R, BIN_WHEEL_LEN, 6)
      .rotateZ(Math.PI / 2)
      .translate(BIN_W * 0.28, wheelY, wheelZ),
    darkColor,
  )
  return mergeParts([body, lid, hinge, wheel1, wheel2])
}

// ---------------------------------------------------------------------------
// Blank signboard — the eighth and last kerb prop in the KERB_PROP_SALT
// chain: thinPost() (shared with the mailbox/meter) topped with a blank
// rectangular panel. Static, no emissive part.
// ---------------------------------------------------------------------------

const SIGN_PANEL_W = 0.055
const SIGN_PANEL_H = 0.034
const SIGN_PANEL_T = 0.006

function signboardGeometry(): BufferGeometry {
  const postColor = setSrgb(new Color(), SIGN_POST_COLOR)
  const panelColor = setSrgb(new Color(), SIGN_PANEL_COLOR)
  const post = tint(thinPost(), postColor)
  const panelY = POST_H + SIGN_PANEL_H / 2
  const panel = tint(box(SIGN_PANEL_W, SIGN_PANEL_H, SIGN_PANEL_T, 0, panelY, 0), panelColor)
  return mergeParts([post, panel])
}

// ---------------------------------------------------------------------------
// Traffic cone, garbage bag and wooden pallet — three loose-clutter props,
// the tenth through twelfth (and last) members of the KERB_PROP_SALT chain.
// All three are static (no emissive part, no night gate, no shadow) like the
// trash can/hydrant/bench/bin/signboard before them, but unlike every prop
// above they are placed with their OWN independent random yaw rather than
// the anchor's yaw — see randomYaw()/CONE_YAW_SALT etc. above.
// ---------------------------------------------------------------------------

const CONE_BASE_R = 0.021
const CONE_TIP_R = 0.0
const CONE_H = 0.05
/** Where the white stripe band sits, as a fraction of the cone's height from
 *  the base — a real traffic cone's reflective band sits roughly a third of
 *  the way up, not centred. */
const CONE_STRIPE_START = 0.34
const CONE_STRIPE_END = 0.52

/** Linear taper radius at height h (0 = base, CONE_H = tip). */
function coneRadiusAt(h: number): number {
  const t = clamp01(h / CONE_H)
  return CONE_BASE_R + (CONE_TIP_R - CONE_BASE_R) * t
}

/** A true cone built as three stacked frusta (via cyl(), which already
 *  supports differing top/bottom radii) so the middle band can be tinted a
 *  different colour without a decal or a second material — orange, then a
 *  white stripe, then orange again up to the tip. */
function trafficConeGeometry(): BufferGeometry {
  const bodyColor = setSrgb(new Color(), CONE_COLOR)
  const stripeColor = setSrgb(new Color(), CONE_STRIPE_COLOR)
  const stripeLoY = CONE_H * CONE_STRIPE_START
  const stripeHiY = CONE_H * CONE_STRIPE_END

  const lower = tint(
    cyl(coneRadiusAt(stripeLoY), coneRadiusAt(0), stripeLoY, 8, 0, stripeLoY / 2, 0),
    bodyColor,
  )
  const stripe = tint(
    cyl(
      coneRadiusAt(stripeHiY),
      coneRadiusAt(stripeLoY),
      stripeHiY - stripeLoY,
      8,
      0,
      (stripeLoY + stripeHiY) / 2,
      0,
    ),
    stripeColor,
  )
  const upper = tint(
    cyl(coneRadiusAt(CONE_H), coneRadiusAt(stripeHiY), CONE_H - stripeHiY, 8, 0, (stripeHiY + CONE_H) / 2, 0),
    bodyColor,
  )
  return mergeParts([lower, stripe, upper])
}

const BAG_MAIN_R = 0.024
const BAG_MAIN_SQUASH = 0.62
const BAG_LOBE_R = 0.016
const BAG_LOBE_SQUASH = 0.5

/** A slumped, lumpy silhouette: one squashed main blob plus a smaller
 *  offset lobe, both black, reusing blob() the way the hydrant reuses it for
 *  its dome — the asymmetry between the two lobes is what sells "propped and
 *  sagging" instead of "neat sphere". */
function garbageBagGeometry(): BufferGeometry {
  const color = setSrgb(new Color(), BAG_COLOR)
  const main = tint(blob(BAG_MAIN_R, 0, BAG_MAIN_R * BAG_MAIN_SQUASH * 0.55, 0, BAG_MAIN_SQUASH), color)
  const lobe = tint(
    blob(BAG_LOBE_R, BAG_MAIN_R * 0.55, BAG_LOBE_R * BAG_LOBE_SQUASH * 0.5, BAG_LOBE_R * 0.2, BAG_LOBE_SQUASH),
    color,
  )
  return mergeParts([main, lobe])
}

const PALLET_LEN = 0.09
const PALLET_WIDTH = 0.07
const PALLET_SLAT_THICK = 0.006
const PALLET_SLAT_W = 0.012
const PALLET_SLAT_GAP = 0.008
const PALLET_SLAT_COUNT = 5
const PALLET_BEARER_THICK = 0.01
const PALLET_BEARER_W = 0.014

/** A flat stacked-slat deck: PALLET_SLAT_COUNT top boards running along local
 *  Z, spaced out across local X, resting on three bearers running along
 *  local X (perpendicular to the boards, two at the ends and one down the
 *  middle) — the same top-boards-on-bearers structure a real shipping
 *  pallet has.
 *  Built lying flat rather than propped up on edge: with a randomized yaw
 *  already making its footprint read as scattered junk rather than aligned
 *  street furniture, a flat pallet keeps the silhouette legible at this
 *  scale without needing a tilt pivot a leaning version would require. */
function palletGeometry(): BufferGeometry {
  const color = setSrgb(new Color(), PALLET_COLOR)
  const bearerY = PALLET_BEARER_THICK / 2
  const bearerZ = PALLET_WIDTH / 2 - PALLET_BEARER_W / 2
  const bearer1 = tint(box(PALLET_LEN, PALLET_BEARER_THICK, PALLET_BEARER_W, 0, bearerY, -bearerZ), color)
  const bearer2 = tint(box(PALLET_LEN, PALLET_BEARER_THICK, PALLET_BEARER_W, 0, bearerY, bearerZ), color)
  const bearer3 = tint(box(PALLET_LEN, PALLET_BEARER_THICK, PALLET_BEARER_W, 0, bearerY, 0), color)

  const slatY = PALLET_BEARER_THICK + PALLET_SLAT_THICK / 2
  const slatPitch = PALLET_SLAT_W + PALLET_SLAT_GAP
  const slatSpan = (PALLET_SLAT_COUNT - 1) * slatPitch
  const slats: BufferGeometry[] = []
  for (let i = 0; i < PALLET_SLAT_COUNT; i++) {
    const slatX = -slatSpan / 2 + i * slatPitch
    slats.push(tint(box(PALLET_SLAT_W, PALLET_SLAT_THICK, PALLET_WIDTH, slatX, slatY, 0), color))
  }
  return mergeParts([bearer1, bearer2, bearer3, ...slats])
}

// ---------------------------------------------------------------------------
// Bicycle and scooter — the highest geometry-risk props in the set at this
// scale: a true spoked wheel is sub-pixel here, so both fake their wheels as
// flat discs (thin cylinders, exactly the trick render/traffic.ts's cars use
// for theirs — cyl().rotateX(PI/2) turns the cylinder's axis from y onto z,
// so the disc stands upright facing sideways instead of lying flat) and lean
// their frame against the kerb instead of modelling a real one.
//
// Scale is taken off render/traffic.ts, not off the tiles: that file's own
// header derives a person at 0.16 tall and a car at 0.24 long/0.08 wide from
// the camera's actual pixel coverage, so reusing its ratios is what keeps a
// parked bike or scooter reading as a plausibly-sized vehicle next to that
// traffic rather than as a toy or a giant. A bike's wheel is taken at a
// little under a person's knee height and its wheelbase a shade under a
// car's length; a scooter's body sits low like a car's hull with its own
// wheels tucked in the same "inside the flanks" way traffic.ts's are.
// ---------------------------------------------------------------------------

const BIKE_WHEEL_R = 0.034
const BIKE_WHEEL_THICK = 0.006
const BIKE_WHEELBASE = 0.15
const BIKE_FRAME_THICK = 0.007
/** Where the two frame bars meet: roughly saddle/handlebar height, a touch
 *  over twice the wheel radius above the ground. */
const BIKE_FRAME_APEX_X = 0
const BIKE_FRAME_APEX_Y = 0.078
const BIKE_SADDLE_W = 0.022
const BIKE_SADDLE_H = 0.007
const BIKE_SADDLE_D = 0.01
const BIKE_HANDLEBAR_W = 0.006
const BIKE_HANDLEBAR_H = 0.018
const BIKE_HANDLEBAR_D = 0.03
/** A few degrees of tilt about the wheelbase axis (local +X) — see the file
 *  header. Applied at placement time, not baked into the geometry, so it
 *  combines with the per-instance random yaw the same way for every prop. */
const BIKE_LEAN = (8 * Math.PI) / 180

/** A single angled bar between two points in the local x/y plane, built along
 *  local x and rotated/translated onto the segment it represents — the "a
 *  couple of angled bars via box()" the frame is reduced to. */
function angledBar(x0: number, y0: number, x1: number, y1: number, thick: number): BufferGeometry {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy) || thick
  const angle = Math.atan2(dy, dx)
  return box(len, thick, thick)
    .rotateZ(angle)
    .translate((x0 + x1) / 2, (y0 + y1) / 2, 0)
}

/**
 * A bicycle leant against the kerb: two flat-disc tyres, a frame reduced to
 * two angled bars (rear wheel to the frame apex, apex to the front wheel —
 * standing in for the down/seat tube and the top tube/fork of a real
 * diamond frame), a small saddle nub and a handlebar stub. Built upright,
 * wheelbase along local +x, wheels touching y = 0; the "leaning" tilt is
 * applied in sync(), not here (see BIKE_LEAN above).
 */
function bicycleGeometry(): BufferGeometry {
  const frameColor = setSrgb(new Color(), BIKE_FRAME_COLOR)
  const tireColor = setSrgb(new Color(), TIRE_COLOR)

  const rearX = -BIKE_WHEELBASE / 2
  const frontX = BIKE_WHEELBASE / 2

  const rearWheel = tint(
    cyl(BIKE_WHEEL_R, BIKE_WHEEL_R, BIKE_WHEEL_THICK, 12)
      .rotateX(Math.PI / 2)
      .translate(rearX, BIKE_WHEEL_R, 0),
    tireColor,
  )
  const frontWheel = tint(
    cyl(BIKE_WHEEL_R, BIKE_WHEEL_R, BIKE_WHEEL_THICK, 12)
      .rotateX(Math.PI / 2)
      .translate(frontX, BIKE_WHEEL_R, 0),
    tireColor,
  )

  const rearBar = tint(
    angledBar(rearX, BIKE_WHEEL_R, BIKE_FRAME_APEX_X, BIKE_FRAME_APEX_Y, BIKE_FRAME_THICK),
    frameColor,
  )
  const frontBar = tint(
    angledBar(BIKE_FRAME_APEX_X, BIKE_FRAME_APEX_Y, frontX, BIKE_WHEEL_R, BIKE_FRAME_THICK),
    frameColor,
  )

  const saddle = tint(
    box(BIKE_SADDLE_D, BIKE_SADDLE_H, BIKE_SADDLE_W, -BIKE_WHEELBASE * 0.08, BIKE_FRAME_APEX_Y + BIKE_SADDLE_H / 2, 0),
    tireColor,
  )
  const handlebar = tint(
    box(BIKE_HANDLEBAR_W, BIKE_HANDLEBAR_H, BIKE_HANDLEBAR_D, frontX - BIKE_WHEELBASE * 0.06, BIKE_FRAME_APEX_Y + BIKE_HANDLEBAR_H / 2, 0),
    frameColor,
  )

  return mergeParts([rearWheel, frontWheel, rearBar, frontBar, saddle, handlebar])
}

const SCOOTER_WHEEL_R = 0.03
const SCOOTER_WHEEL_THICK = 0.006
const SCOOTER_WHEELBASE = 0.13
const SCOOTER_BODY_LEN = 0.11
const SCOOTER_BODY_H = 0.03
const SCOOTER_BODY_W = 0.032
const SCOOTER_SEAT_LEN = 0.05
const SCOOTER_SEAT_H = 0.012
const SCOOTER_SEAT_W = 0.03
const SCOOTER_SCREEN_W = 0.006
const SCOOTER_SCREEN_H = 0.032
const SCOOTER_SCREEN_D = 0.026
/** A shallower lean than the bike's: a scooter's flatter, boxier footprint
 *  reads as "propped over" with less tilt than a bike's tall, narrow one
 *  needs to sell the same thing. */
const SCOOTER_LEAN = (6 * Math.PI) / 180

/**
 * A scooter/moped: the same flat-disc wheels as the bicycle, a boxy
 * body/footboard block, a low seat block and a small windscreen/handlebar
 * stub standing in for the front end — simplified aggressively on purpose,
 * this is background clutter rather than a hero asset. Built upright,
 * wheelbase along local +x, wheels touching y = 0; SCOOTER_LEAN is applied
 * in sync(), same as the bicycle.
 */
function scooterGeometry(): BufferGeometry {
  const bodyColor = setSrgb(new Color(), SCOOTER_BODY_COLOR)
  const tireColor = setSrgb(new Color(), TIRE_COLOR)
  const frameColor = setSrgb(new Color(), BIKE_FRAME_COLOR)

  const rearX = -SCOOTER_WHEELBASE / 2
  const frontX = SCOOTER_WHEELBASE / 2

  const rearWheel = tint(
    cyl(SCOOTER_WHEEL_R, SCOOTER_WHEEL_R, SCOOTER_WHEEL_THICK, 12)
      .rotateX(Math.PI / 2)
      .translate(rearX, SCOOTER_WHEEL_R, 0),
    tireColor,
  )
  const frontWheel = tint(
    cyl(SCOOTER_WHEEL_R, SCOOTER_WHEEL_R, SCOOTER_WHEEL_THICK, 12)
      .rotateX(Math.PI / 2)
      .translate(frontX, SCOOTER_WHEEL_R, 0),
    tireColor,
  )

  const bodyY = SCOOTER_WHEEL_R * 0.8 + SCOOTER_BODY_H / 2
  const body = tint(box(SCOOTER_BODY_LEN, SCOOTER_BODY_H, SCOOTER_BODY_W, -SCOOTER_WHEELBASE * 0.04, bodyY, 0), bodyColor)

  const seatY = SCOOTER_WHEEL_R * 0.8 + SCOOTER_BODY_H + SCOOTER_SEAT_H / 2
  const seat = tint(
    box(SCOOTER_SEAT_LEN, SCOOTER_SEAT_H, SCOOTER_SEAT_W, -SCOOTER_WHEELBASE * 0.1, seatY, 0),
    tireColor,
  )

  // A small vertical stub at the front standing in for a windscreen and
  // handlebar together — cheap enough to read at this scale without adding
  // real complexity.
  const screenY = bodyY + SCOOTER_BODY_H / 2 + SCOOTER_SCREEN_H / 2
  const screen = tint(
    box(SCOOTER_SCREEN_W, SCOOTER_SCREEN_H, SCOOTER_SCREEN_D, frontX - SCOOTER_WHEELBASE * 0.05, screenY, 0),
    frameColor,
  )

  return mergeParts([rearWheel, frontWheel, body, seat, screen])
}

// ---------------------------------------------------------------------------
// Flower planter box — the fifteenth and last member of the KERB_PROP_SALT
// chain: a terracotta box topped with a small cluster of blob() foliage
// lobes and two smaller warm-accent blobs standing in for flowers. Static
// like the trash can/hydrant/bin before it, placed with the anchor's own yaw
// (not an independent random one — a planter reads as deliberately set kerb
// furniture, not loose clutter).
// ---------------------------------------------------------------------------

const PLANTER_BOX_W = 0.046
const PLANTER_BOX_H = 0.026
const PLANTER_BOX_D = 0.032
const PLANTER_LOBE_R = 0.017
const PLANTER_LOBE_SQUASH = 0.7
const PLANTER_FLOWER_R = 0.007

/** A rectangular terracotta box with three green foliage lobes clustered on
 *  top and two small flower-coloured blobs peeking through — the same
 *  "cluster a few blob() lobes together" trick the hedge uses, just tighter
 *  and with a splash of warm accent colour mixed in. */
function flowerPlanterGeometry(): BufferGeometry {
  const boxColor = setSrgb(new Color(), PLANTER_BOX_COLOR)
  const foliageColor = setSrgb(new Color(), PLANTER_FOLIAGE_COLOR)
  const flowerColorA = setSrgb(new Color(), PLANTER_FLOWER_COLOR_A)
  const flowerColorB = setSrgb(new Color(), PLANTER_FLOWER_COLOR_B)

  const boxY = PLANTER_BOX_H / 2
  const body = tint(box(PLANTER_BOX_W, PLANTER_BOX_H, PLANTER_BOX_D, 0, boxY, 0), boxColor)

  const lobeY = PLANTER_BOX_H + PLANTER_LOBE_R * PLANTER_LOBE_SQUASH * 0.7
  const lobeX = PLANTER_BOX_W * 0.26
  const lobeCenter = tint(blob(PLANTER_LOBE_R, 0, lobeY, 0, PLANTER_LOBE_SQUASH), foliageColor)
  const lobeLeft = tint(
    blob(PLANTER_LOBE_R * 0.85, -lobeX, lobeY * 0.92, PLANTER_LOBE_R * 0.2, PLANTER_LOBE_SQUASH),
    foliageColor,
  )
  const lobeRight = tint(
    blob(PLANTER_LOBE_R * 0.85, lobeX, lobeY * 0.92, -PLANTER_LOBE_R * 0.2, PLANTER_LOBE_SQUASH),
    foliageColor,
  )

  // Two small flower accents, offset so they read as poking out of the
  // foliage rather than floating above it.
  const flower1 = tint(
    blob(PLANTER_FLOWER_R, -lobeX * 0.6, lobeY + PLANTER_LOBE_R * 0.35, PLANTER_LOBE_R * 0.5, 0.9),
    flowerColorA,
  )
  const flower2 = tint(
    blob(PLANTER_FLOWER_R, lobeX * 0.7, lobeY + PLANTER_LOBE_R * 0.3, -PLANTER_LOBE_R * 0.4, 0.9),
    flowerColorB,
  )

  return mergeParts([body, lobeCenter, lobeLeft, lobeRight, flower1, flower2])
}

// ---------------------------------------------------------------------------
// Traffic light — a tall post and signal-head housing, placed on `corner`
// anchors rather than `kerb` ones (see CORNER_PROP_SALT above). Unlike every
// other prop in this file bar the bollard light, it has an emissive part:
// the lens on the housing's front face, built and instanced separately so it
// can be coloured per-instance in frame() the same way the bollard's cap is.
// ---------------------------------------------------------------------------

const TL_POST_H = 0.15
const TL_POST_TOP_R = 0.011
const TL_POST_BOTTOM_R = 0.015
const TL_HEAD_W = 0.026
const TL_HEAD_H = 0.055
const TL_HEAD_D = 0.022
const TL_LENS_R = 0.009
/** How far up the housing the lens sits — a touch above the vertical centre,
 *  since a real signal head reads top-heavy with its lenses stacked. */
const TL_LENS_Y = TL_POST_H + TL_HEAD_H * 0.6

/** The static post + housing, merged and vertex-coloured like the other
 *  static props — no emissive part lives in this geometry. */
function trafficLightBodyGeometry(): BufferGeometry {
  const color = setSrgb(new Color(), TRAFFIC_LIGHT_BODY_COLOR)
  const post = tint(cyl(TL_POST_TOP_R, TL_POST_BOTTOM_R, TL_POST_H, 8, 0, TL_POST_H / 2, 0), color)
  const headY = TL_POST_H + TL_HEAD_H / 2
  const head = tint(box(TL_HEAD_W, TL_HEAD_H, TL_HEAD_D, 0, headY, 0), color)
  return mergeParts([post, head])
}

/** The glowing lens, on the housing's front face (local +X, the same
 *  "outward" direction a.yaw rotates onto for every other kerb/corner prop).
 *  Left untinted like the bollard's own capGeom: colour is set per-instance
 *  in frame() instead of baked into the geometry. */
function trafficLightLensGeometry(): BufferGeometry {
  return blob(TL_LENS_R, TL_HEAD_D / 2 + TL_LENS_R * 0.5, TL_LENS_Y, 0, 0.85)
}

// ---------------------------------------------------------------------------
// Hedge/bush and yard tree — the fifteenth and sixteenth props, and the first
// two drawn from `yard` anchors rather than `kerb`/`corner` ones (see
// YARD_PROP_SALT above). Both static: no emissive part, no night gate, same
// as every prop above bar the bollard and traffic light. Unlike every prop
// above, though, both DO cast a shadow — see the note by configureYardMesh()
// in createDecorView() for why.
// ---------------------------------------------------------------------------

const HEDGE_MAIN_R = 0.15
const HEDGE_MAIN_SQUASH = 0.6
const HEDGE_LOBE_R = 0.11
const HEDGE_LOBE_SQUASH = 0.55

/** A rounded hedge/bush clump: a main blob() lobe flanked by two smaller
 *  ones, the same "cluster a few blob() lobes together" trick the deciduous
 *  park canopy in buildings.ts uses for its own bushes, just squashed flatter
 *  and wider so it reads as a clipped hedge rather than a single round shrub. */
function hedgeGeometry(): BufferGeometry {
  const color = setSrgb(new Color(), HEDGE_COLOR)
  const mainY = HEDGE_MAIN_R * HEDGE_MAIN_SQUASH * 0.6
  const main = tint(blob(HEDGE_MAIN_R, 0, mainY, 0, HEDGE_MAIN_SQUASH), color)
  const lobeY = HEDGE_LOBE_R * HEDGE_LOBE_SQUASH * 0.6
  const lobeX = HEDGE_MAIN_R * 0.78
  const lobeLeft = tint(blob(HEDGE_LOBE_R, -lobeX, lobeY, HEDGE_LOBE_R * 0.2, HEDGE_LOBE_SQUASH), color)
  const lobeRight = tint(blob(HEDGE_LOBE_R, lobeX, lobeY, -HEDGE_LOBE_R * 0.15, HEDGE_LOBE_SQUASH), color)
  return mergeParts([main, lobeLeft, lobeRight])
}

/** How far palm()/conifer() plant their trunk base above y = 0 — the height
 *  of the park tile's own base box in buildings.ts (see parkParts()). A yard
 *  anchor has no such base underfoot (it stands on bare ground), so every
 *  part built by those two helpers is shifted back down by this amount once
 *  merged, planting the trunk at y = 0 instead of floating above it. */
const TREE_GROUND_OFFSET = 0.12

/** A single palm, at the same height/lean buildings.ts's own coastal park
 *  canopy uses for its first (always-present, level-1) tree, so a yard palm
 *  reads as the same species and scale as any park's. */
function yardPalmGeometry(): BufferGeometry {
  const trim = setSrgb(new Color(), TREE_TRUNK_COLOR)
  const leaf = setSrgb(new Color(), TREE_LEAF_COLOR)
  const geom = mergeParts(palm(0, 0, 0.34, 0.14, trim, leaf))
  geom.translate(0, -TREE_GROUND_OFFSET, 0)
  return geom
}

/** A single conifer, at the same scale (s = 1) buildings.ts's own alpine park
 *  canopy uses for its first (always-present, level-1) tree. */
function yardConiferGeometry(): BufferGeometry {
  const trim = setSrgb(new Color(), TREE_TRUNK_COLOR)
  const leaf = setSrgb(new Color(), TREE_LEAF_COLOR)
  const geom = mergeParts(conifer(0, 0, 1, trim, leaf))
  geom.translate(0, -TREE_GROUND_OFFSET, 0)
  return geom
}

// ---------------------------------------------------------------------------
// Potted plant — the third member of the YARD_PROP_SALT chain: a
// tapered terracotta pot (cyl(), wider at the rim than the base) topped with
// a single leaf-green blob() canopy. Small enough to sit closer to the kerb
// props' scale than the hedge/tree's — see the note by configureMesh() in
// createDecorView() for why it does not cast a shadow like they do.
// ---------------------------------------------------------------------------

const POT_TOP_R = 0.022
const POT_BOTTOM_R = 0.015
const POT_H = 0.026
const POT_CANOPY_R = 0.03
const POT_CANOPY_SQUASH = 0.85

function pottedPlantGeometry(): BufferGeometry {
  const potColor = setSrgb(new Color(), POT_COLOR)
  const canopyColor = setSrgb(new Color(), POT_CANOPY_COLOR)
  const pot = tint(cyl(POT_TOP_R, POT_BOTTOM_R, POT_H, 8, 0, POT_H / 2, 0), potColor)
  const canopyY = POT_H + POT_CANOPY_R * POT_CANOPY_SQUASH * 0.65
  const canopy = tint(blob(POT_CANOPY_R, 0, canopyY, 0, POT_CANOPY_SQUASH), canopyColor)
  return mergeParts([pot, canopy])
}

// ---------------------------------------------------------------------------
// Stacked wooden crates — the fourth and last member of the YARD_PROP_SALT
// chain: a casual stack of 3 wooden boxes (box() primitives in
// DECOR_WOOD_BROWN), each tilted a few degrees differently via per-box yaw
// jitter so the stack reads as casually piled rather than neatly aligned.
// Small enough to sit at kerb-prop scale rather than hedge/tree scale, so it
// uses the static configureMesh() (no shadow) treatment.
// ---------------------------------------------------------------------------

const CRATE_BOX_W = 0.03
const CRATE_BOX_H = 0.025
const CRATE_BOX_D = 0.03
const CRATE_BOX_COUNT = 3

function crateStackGeometry(): BufferGeometry {
  const color = setSrgb(new Color(), CRATE_BOX_COLOR)
  const parts: BufferGeometry[] = []

  // Each box in the stack has a slight yaw jitter (4, -3 degrees) so the
  // stack reads as casually piled rather than perfectly aligned — the first
  // box sits straight, the others tilt a bit. These fixed angles are baked
  // into the geometry so every instance gets the same casual look without
  // needing per-instance variant management.
  const jitterAngles = [0, (4 * Math.PI) / 180, (-3 * Math.PI) / 180]

  for (let boxIdx = 0; boxIdx < CRATE_BOX_COUNT; boxIdx++) {
    const boxY = CRATE_BOX_H * (boxIdx + 0.5)
    const boxGeom = box(CRATE_BOX_W, CRATE_BOX_H, CRATE_BOX_D, 0, boxY, 0)
    boxGeom.rotateY(jitterAngles[boxIdx])
    parts.push(tint(boxGeom, color))
  }

  return mergeParts(parts)
}

// ---------------------------------------------------------------------------
// Wooden fence run and stone wall run — the nineteenth and twentieth props,
// and the first two drawn from `edge-run` anchors (see the file header and
// EDGE_PROP_SALT above). Each anchor's local Z axis runs ALONG the tile edge
// it sits on and local X points inward, so both geometries are built as a
// short repeating run spanning local Z, at x = 0.
// ---------------------------------------------------------------------------

/** How much of a tile edge's length (1 world unit) the run spans — just
 *  short of the full edge so two tiles' worth of run does not double up too
 *  badly at a shared corner (see the file header on corner handling). */
const EDGE_RUN_LEN = 0.92

const FENCE_POST_W = 0.014
const FENCE_POST_D = 0.014
const FENCE_POST_H = 0.05
const FENCE_POST_COUNT = 4
const FENCE_RAIL_H = 0.007
const FENCE_RAIL_D = 0.009
/** Two rails, a lower and an upper one, as fractions of FENCE_POST_H. */
const FENCE_RAIL_Y_LO = 0.5
const FENCE_RAIL_Y_HI = 0.88

/** A repeating post-and-rail fence unit: FENCE_POST_COUNT evenly spaced
 *  vertical posts along local Z, threaded by two horizontal rails running
 *  the run's full length, all in DECOR_WOOD_BROWN — the same "box() posts,
 *  box() rails" vocabulary the bench already uses for its own slats/legs. */
function fenceRunGeometry(): BufferGeometry {
  const color = setSrgb(new Color(), FENCE_COLOR)
  const parts: BufferGeometry[] = []

  const railLo = tint(
    box(FENCE_RAIL_D, FENCE_RAIL_H, EDGE_RUN_LEN, 0, FENCE_POST_H * FENCE_RAIL_Y_LO, 0),
    color,
  )
  const railHi = tint(
    box(FENCE_RAIL_D, FENCE_RAIL_H, EDGE_RUN_LEN, 0, FENCE_POST_H * FENCE_RAIL_Y_HI, 0),
    color,
  )
  parts.push(railLo, railHi)

  const span = EDGE_RUN_LEN - FENCE_POST_D
  for (let i = 0; i < FENCE_POST_COUNT; i++) {
    const z = -span / 2 + (span * i) / (FENCE_POST_COUNT - 1)
    parts.push(tint(box(FENCE_POST_W, FENCE_POST_H, FENCE_POST_D, 0, FENCE_POST_H / 2, z), color))
  }

  return mergeParts(parts)
}

const WALL_COURSE_H = 0.028
const WALL_COURSE_COUNT = 2
const WALL_D = 0.03
const WALL_BLOCKS_PER_COURSE = 4
/** A small gap between neighbouring blocks so each stone reads as its own
 *  piece rather than one continuous slab. */
const WALL_BLOCK_GAP = 0.006

/** A repeating stacked-stone wall unit: WALL_COURSE_COUNT courses of blocky
 *  stones along local Z, the second course offset by half a block (a
 *  brick/masonry stagger) and alternately shaded WALL_COLOR/WALL_DARK so the
 *  run reads as irregular stacked stone rather than a smooth slab — the same
 *  "alternate a base tone and a darker shade" trick TRASH_DARK/BIN_DARK use. */
function stoneWallRunGeometry(): BufferGeometry {
  const baseColor = setSrgb(new Color(), WALL_COLOR)
  const darkColor = setSrgb(new Color(), WALL_DARK)
  const parts: BufferGeometry[] = []

  const blockW = (EDGE_RUN_LEN - WALL_BLOCK_GAP * (WALL_BLOCKS_PER_COURSE - 1)) / WALL_BLOCKS_PER_COURSE
  const pitch = blockW + WALL_BLOCK_GAP

  for (let c = 0; c < WALL_COURSE_COUNT; c++) {
    const y = WALL_COURSE_H * c + WALL_COURSE_H / 2
    // Every other course is staggered by half a block, like real masonry
    // coursing, so joints in one row do not line up with the row below.
    const stagger = c % 2 === 1 ? pitch / 2 : 0
    for (let i = 0; i < WALL_BLOCKS_PER_COURSE; i++) {
      const z = -EDGE_RUN_LEN / 2 + blockW / 2 + i * pitch + stagger
      if (z - blockW / 2 < -EDGE_RUN_LEN / 2 - 0.001 || z + blockW / 2 > EDGE_RUN_LEN / 2 + 0.001) continue
      const color = (c + i) % 2 === 0 ? baseColor : darkColor
      parts.push(tint(box(WALL_D, WALL_COURSE_H, blockW, 0, y, z), color))
    }
  }

  return mergeParts(parts)
}

export function createDecorView(): DecorView {
  const group = new Group()
  group.name = 'decor'

  const bodyGeom = cyl(BOLLARD_TOP_R, BOLLARD_BOTTOM_R, BOLLARD_H, 8, 0, BOLLARD_H / 2, 0)
  const capGeom = blob(CAP_R, 0, BOLLARD_H + CAP_R * CAP_SQUASH * 0.5, 0, CAP_SQUASH)
  const poolGeom = poolGeometry()

  const bodyMaterial = new MeshStandardMaterial({
    color: setSrgb(new Color(), BODY_COLOR),
    roughness: 0.8,
    metalness: 0.1,
    flatShading: true,
  })
  const capMaterial = new MeshBasicMaterial({
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

  // Trash can and fire hydrant: single merged, vertex-coloured geometry each
  // (matching buildings.ts's own multi-part-merge style), since neither has
  // an emissive part or a per-instance colour to drive.
  const trashGeom = trashCanGeometry()
  const hydrantGeom = fireHydrantGeometry()
  const trashMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.15,
    flatShading: true,
  })
  const hydrantMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.05,
    flatShading: true,
  })

  // Mailbox and parking meter: same static, single-merged-geometry treatment
  // as the trash can and hydrant above.
  const mailboxGeom = mailboxGeometry()
  const meterGeom = parkingMeterGeometry()
  const mailboxMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    metalness: 0.15,
    flatShading: true,
  })
  const meterMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.6,
    metalness: 0.2,
    flatShading: true,
  })

  // Bench and recycling bin: same static, single-merged-geometry treatment
  // as the props above.
  const benchGeom = benchGeometry()
  const binGeom = recycleBinGeometry()
  const benchMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.0,
    flatShading: true,
  })
  const binMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    metalness: 0.05,
    flatShading: true,
  })

  // Signboard: same static, single-merged-geometry treatment as the props
  // above — the last member of the KERB_PROP_SALT chain.
  const signGeom = signboardGeometry()
  const signMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.75,
    metalness: 0.1,
    flatShading: true,
  })

  // Traffic cone, garbage bag and wooden pallet: same static, single-merged-
  // geometry treatment as the props above — the last three members of the
  // KERB_PROP_SALT chain.
  const coneGeom = trafficConeGeometry()
  const bagGeom = garbageBagGeometry()
  const palletGeom = palletGeometry()
  const coneMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.6,
    metalness: 0.0,
    flatShading: true,
  })
  const bagMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.75,
    metalness: 0.0,
    flatShading: true,
  })
  const palletMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.0,
    flatShading: true,
  })

  // Bicycle and scooter: same static, single-merged-geometry treatment as
  // the props above — the last two members of the KERB_PROP_SALT chain.
  const bikeGeom = bicycleGeometry()
  const scooterGeom = scooterGeometry()
  const bikeMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.6,
    metalness: 0.25,
    flatShading: true,
  })
  const scooterMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.1,
    flatShading: true,
  })

  // Traffic light: drawn from `corner` anchors, not the kerb chain above.
  // Static body plus a separate emissive lens, the same split the bollard
  // uses for its own body/cap pair.
  const tlBodyGeom = trafficLightBodyGeometry()
  const tlLensGeom = trafficLightLensGeometry()
  const tlBodyMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0.3,
    flatShading: true,
  })
  const tlLensMaterial = new MeshBasicMaterial({
    fog: false,
    toneMapped: false,
  })

  // Hedge and yard tree: drawn from `yard` anchors, not the kerb/corner pools
  // above (see YARD_PROP_SALT). The tree splits into two geometries/meshes,
  // one per biome-appropriate species (palm on Coast, conifer everywhere
  // else — see the biome lookup in sync() below), the same "one InstancedMesh
  // per variant" pattern the cone/bag/pallet and bike/scooter groups already
  // use for their own disjoint variants.
  const hedgeGeom = hedgeGeometry()
  const palmTreeGeom = yardPalmGeometry()
  const coniferTreeGeom = yardConiferGeometry()
  const hedgeMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
    flatShading: true,
  })
  const treeMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
    flatShading: true,
  })

  // Instanced meshes start empty; sync() rebuilds them to the anchor count
  // discovered that call, exactly like roads.ts rebuilds surfaceGeom. Capacity
  // only ever needs to fit one sync's worth of kerb anchors, so the meshes are
  // recreated (not just re-counted) whenever that number grows.
  let bodies = new InstancedMesh(bodyGeom, bodyMaterial, 0)
  let caps = new InstancedMesh(capGeom, capMaterial, 0)
  let pools = new InstancedMesh(poolGeom, poolMaterial, 0)
  let capacity = 0

  function configureMesh(mesh: InstancedMesh): void {
    mesh.frustumCulled = false
    // See file header: a prop this thin never casts a legible shadow. The
    // same reasoning covers the trash can and fire hydrant below, which are
    // thinner still.
    mesh.castShadow = false
    mesh.receiveShadow = false
  }
  /** The hedge and yard tree are real 3D volumes at a real scale — the same
   *  shape and size class buildings.ts's own park foliage (which this tree
   *  reuses, via palm()/conifer()) is instanced and shadow-cast as part of
   *  that building's roof mesh (see makeMesh(..., true) in buildings.ts).
   *  Unlike every prop above (all thin enough that a shadow map smears them
   *  into an illegible streak), a hedge clump and especially a tree canopy
   *  are wide and tall enough to read as real shadow-casting scenery, so
   *  the "no shadow" convention this file otherwise follows does not apply
   *  here — they cast (and receive) shadows like any other piece of greenery. */
  function configureYardMesh(mesh: InstancedMesh): void {
    mesh.frustumCulled = false
    mesh.castShadow = true
    mesh.receiveShadow = true
  }
  configureMesh(bodies)
  configureMesh(caps)
  configureMesh(pools)
  pools.renderOrder = 1
  pools.visible = false
  group.add(bodies, caps, pools)

  let trashCans = new InstancedMesh(trashGeom, trashMaterial, 0)
  let hydrants = new InstancedMesh(hydrantGeom, hydrantMaterial, 0)
  let trashCapacity = 0
  let hydrantCapacity = 0
  configureMesh(trashCans)
  configureMesh(hydrants)
  group.add(trashCans, hydrants)

  let mailboxes = new InstancedMesh(mailboxGeom, mailboxMaterial, 0)
  let meters = new InstancedMesh(meterGeom, meterMaterial, 0)
  let mailboxCapacity = 0
  let meterCapacity = 0
  configureMesh(mailboxes)
  configureMesh(meters)
  group.add(mailboxes, meters)

  let benches = new InstancedMesh(benchGeom, benchMaterial, 0)
  let bins = new InstancedMesh(binGeom, binMaterial, 0)
  let benchCapacity = 0
  let binCapacity = 0
  configureMesh(benches)
  configureMesh(bins)
  group.add(benches, bins)

  let signs = new InstancedMesh(signGeom, signMaterial, 0)
  let signCapacity = 0
  configureMesh(signs)
  group.add(signs)

  let cones = new InstancedMesh(coneGeom, coneMaterial, 0)
  let bags = new InstancedMesh(bagGeom, bagMaterial, 0)
  let pallets = new InstancedMesh(palletGeom, palletMaterial, 0)
  let coneCapacity = 0
  let bagCapacity = 0
  let palletCapacity = 0
  configureMesh(cones)
  configureMesh(bags)
  configureMesh(pallets)
  group.add(cones, bags, pallets)

  let bikes = new InstancedMesh(bikeGeom, bikeMaterial, 0)
  let scooters = new InstancedMesh(scooterGeom, scooterMaterial, 0)
  let bikeCapacity = 0
  let scooterCapacity = 0
  configureMesh(bikes)
  configureMesh(scooters)
  group.add(bikes, scooters)

  // Flower planter box: same static, single-merged-geometry treatment as the
  // props above — the last member of the KERB_PROP_SALT chain.
  const planterGeom = flowerPlanterGeometry()
  const planterMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0.0,
    flatShading: true,
  })
  let planters = new InstancedMesh(planterGeom, planterMaterial, 0)
  let planterCapacity = 0
  configureMesh(planters)
  group.add(planters)

  let tlBodies = new InstancedMesh(tlBodyGeom, tlBodyMaterial, 0)
  let tlLenses = new InstancedMesh(tlLensGeom, tlLensMaterial, 0)
  let tlCapacity = 0
  configureMesh(tlBodies)
  configureMesh(tlLenses)
  group.add(tlBodies, tlLenses)

  // Hedge and yard tree: the fifteenth and sixteenth (and last) props, drawn
  // from `yard` anchors. Two geometries share the "tree" role (palmTrees on
  // Coast tiles, coniferTrees elsewhere), each with its own InstancedMesh —
  // see the note above hedgeGeom/palmTreeGeom/coniferTreeGeom.
  let hedges = new InstancedMesh(hedgeGeom, hedgeMaterial, 0)
  let palmTrees = new InstancedMesh(palmTreeGeom, treeMaterial, 0)
  let coniferTrees = new InstancedMesh(coniferTreeGeom, treeMaterial, 0)
  let hedgeCapacity = 0
  let palmTreeCapacity = 0
  let coniferTreeCapacity = 0
  configureYardMesh(hedges)
  configureYardMesh(palmTrees)
  configureYardMesh(coniferTrees)
  group.add(hedges, palmTrees, coniferTrees)

  // Potted plant: the third member of the YARD_PROP_SALT chain.
  // Small enough to sit at kerb-prop scale rather than hedge/tree scale, so
  // it uses the static configureMesh() (no shadow) treatment instead of
  // configureYardMesh() — see the note above configureMesh() below.
  const potGeom = pottedPlantGeometry()
  const potMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0.0,
    flatShading: true,
  })
  let pots = new InstancedMesh(potGeom, potMaterial, 0)
  let potCapacity = 0
  configureMesh(pots)
  group.add(pots)

  // Stacked wooden crates: the fourth and last member of the YARD_PROP_SALT
  // chain. Same static, single-merged-geometry treatment as the potted plant
  // above (no shadow, kerb-prop scale).
  const crateGeom = crateStackGeometry()
  const crateMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.0,
    flatShading: true,
  })
  let crates = new InstancedMesh(crateGeom, crateMaterial, 0)
  let crateCapacity = 0
  configureMesh(crates)
  group.add(crates)

  // Wooden fence run and stone wall run: drawn from `edge-run` anchors, the
  // fourth and last anchor pool (see EDGE_PROP_SALT above). Static like the
  // kerb chain's furniture — no shadow, thin/low geometry — not the
  // hedge/tree's real canopy volume.
  const fenceGeom = fenceRunGeometry()
  const wallGeom = stoneWallRunGeometry()
  const fenceMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.0,
    flatShading: true,
  })
  const wallMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
  })
  let fences = new InstancedMesh(fenceGeom, fenceMaterial, 0)
  let walls = new InstancedMesh(wallGeom, wallMaterial, 0)
  let fenceCapacity = 0
  let wallCapacity = 0
  configureMesh(fences)
  configureMesh(walls)
  group.add(fences, walls)

  /** Per-bollard phase for the slow breathe, parallel to the instance indices. */
  let phase = new Float32Array(0)
  /** Same idea as `phase` above, for the traffic light's lens flicker. */
  let tlPhase = new Float32Array(0)
  let count = 0
  let trashCount = 0
  let hydrantCount = 0
  let mailboxCount = 0
  let meterCount = 0
  let benchCount = 0
  let binCount = 0
  let signCount = 0
  let coneCount = 0
  let bagCount = 0
  let palletCount = 0
  let bikeCount = 0
  let scooterCount = 0
  let planterCount = 0
  let tlCount = 0
  let hedgeCount = 0
  let palmTreeCount = 0
  let coniferTreeCount = 0
  let potCount = 0
  let crateCount = 0
  let fenceCount = 0
  let wallCount = 0

  /**
   * Swap a regrown InstancedMesh into the group at the SAME child index its
   * predecessor held, instead of group.remove() + group.add(), which always
   * re-appends at the end. A capacity-0 mesh whose count stays at 0 across a
   * sync (nothing spawned this call) never gets swapped, so plain
   * remove+append would otherwise leave it stranded at the front of
   * group.children while every other, busier prop type marches to the back —
   * an implementation detail with no visual effect, but one a test or any
   * other consumer indexing into group.children by position should not have
   * to know about.
   */
  function replaceInGroup(oldMesh: InstancedMesh, newMesh: InstancedMesh): void {
    const idx = group.children.indexOf(oldMesh)
    oldMesh.dispose()
    if (idx === -1) {
      group.add(newMesh)
      return
    }
    newMesh.parent = group
    group.children[idx] = newMesh
  }

  function ensureCapacity(next: number): void {
    if (next <= capacity) return
    const nextBodies = new InstancedMesh(bodyGeom, bodyMaterial, next)
    const nextCaps = new InstancedMesh(capGeom, capMaterial, next)
    const nextPools = new InstancedMesh(poolGeom, poolMaterial, next)
    configureMesh(nextBodies)
    configureMesh(nextCaps)
    configureMesh(nextPools)
    nextPools.renderOrder = 1
    nextPools.visible = false
    replaceInGroup(bodies, nextBodies)
    replaceInGroup(caps, nextCaps)
    replaceInGroup(pools, nextPools)
    bodies = nextBodies
    caps = nextCaps
    pools = nextPools
    capacity = next
    phase = new Float32Array(next)
  }

  function ensureTrashCapacity(next: number): void {
    if (next <= trashCapacity) return
    const nextTrashCans = new InstancedMesh(trashGeom, trashMaterial, next)
    configureMesh(nextTrashCans)
    replaceInGroup(trashCans, nextTrashCans)
    trashCans = nextTrashCans
    trashCapacity = next
  }

  function ensureHydrantCapacity(next: number): void {
    if (next <= hydrantCapacity) return
    const nextHydrants = new InstancedMesh(hydrantGeom, hydrantMaterial, next)
    configureMesh(nextHydrants)
    replaceInGroup(hydrants, nextHydrants)
    hydrants = nextHydrants
    hydrantCapacity = next
  }

  function ensureMailboxCapacity(next: number): void {
    if (next <= mailboxCapacity) return
    const nextMailboxes = new InstancedMesh(mailboxGeom, mailboxMaterial, next)
    configureMesh(nextMailboxes)
    replaceInGroup(mailboxes, nextMailboxes)
    mailboxes = nextMailboxes
    mailboxCapacity = next
  }

  function ensureMeterCapacity(next: number): void {
    if (next <= meterCapacity) return
    const nextMeters = new InstancedMesh(meterGeom, meterMaterial, next)
    configureMesh(nextMeters)
    replaceInGroup(meters, nextMeters)
    meters = nextMeters
    meterCapacity = next
  }

  function ensureBenchCapacity(next: number): void {
    if (next <= benchCapacity) return
    const nextBenches = new InstancedMesh(benchGeom, benchMaterial, next)
    configureMesh(nextBenches)
    replaceInGroup(benches, nextBenches)
    benches = nextBenches
    benchCapacity = next
  }

  function ensureBinCapacity(next: number): void {
    if (next <= binCapacity) return
    const nextBins = new InstancedMesh(binGeom, binMaterial, next)
    configureMesh(nextBins)
    replaceInGroup(bins, nextBins)
    bins = nextBins
    binCapacity = next
  }

  function ensureSignCapacity(next: number): void {
    if (next <= signCapacity) return
    const nextSigns = new InstancedMesh(signGeom, signMaterial, next)
    configureMesh(nextSigns)
    replaceInGroup(signs, nextSigns)
    signs = nextSigns
    signCapacity = next
  }

  function ensureConeCapacity(next: number): void {
    if (next <= coneCapacity) return
    const nextCones = new InstancedMesh(coneGeom, coneMaterial, next)
    configureMesh(nextCones)
    replaceInGroup(cones, nextCones)
    cones = nextCones
    coneCapacity = next
  }

  function ensureBagCapacity(next: number): void {
    if (next <= bagCapacity) return
    const nextBags = new InstancedMesh(bagGeom, bagMaterial, next)
    configureMesh(nextBags)
    replaceInGroup(bags, nextBags)
    bags = nextBags
    bagCapacity = next
  }

  function ensurePalletCapacity(next: number): void {
    if (next <= palletCapacity) return
    const nextPallets = new InstancedMesh(palletGeom, palletMaterial, next)
    configureMesh(nextPallets)
    replaceInGroup(pallets, nextPallets)
    pallets = nextPallets
    palletCapacity = next
  }

  function ensureBikeCapacity(next: number): void {
    if (next <= bikeCapacity) return
    const nextBikes = new InstancedMesh(bikeGeom, bikeMaterial, next)
    configureMesh(nextBikes)
    replaceInGroup(bikes, nextBikes)
    bikes = nextBikes
    bikeCapacity = next
  }

  function ensureScooterCapacity(next: number): void {
    if (next <= scooterCapacity) return
    const nextScooters = new InstancedMesh(scooterGeom, scooterMaterial, next)
    configureMesh(nextScooters)
    replaceInGroup(scooters, nextScooters)
    scooters = nextScooters
    scooterCapacity = next
  }

  function ensurePlanterCapacity(next: number): void {
    if (next <= planterCapacity) return
    const nextPlanters = new InstancedMesh(planterGeom, planterMaterial, next)
    configureMesh(nextPlanters)
    replaceInGroup(planters, nextPlanters)
    planters = nextPlanters
    planterCapacity = next
  }

  function ensureTlCapacity(next: number): void {
    if (next <= tlCapacity) return
    const nextTlBodies = new InstancedMesh(tlBodyGeom, tlBodyMaterial, next)
    const nextTlLenses = new InstancedMesh(tlLensGeom, tlLensMaterial, next)
    configureMesh(nextTlBodies)
    configureMesh(nextTlLenses)
    replaceInGroup(tlBodies, nextTlBodies)
    replaceInGroup(tlLenses, nextTlLenses)
    tlBodies = nextTlBodies
    tlLenses = nextTlLenses
    tlCapacity = next
    tlPhase = new Float32Array(next)
  }

  function ensureHedgeCapacity(next: number): void {
    if (next <= hedgeCapacity) return
    const nextHedges = new InstancedMesh(hedgeGeom, hedgeMaterial, next)
    configureYardMesh(nextHedges)
    replaceInGroup(hedges, nextHedges)
    hedges = nextHedges
    hedgeCapacity = next
  }

  function ensurePalmTreeCapacity(next: number): void {
    if (next <= palmTreeCapacity) return
    const nextPalmTrees = new InstancedMesh(palmTreeGeom, treeMaterial, next)
    configureYardMesh(nextPalmTrees)
    replaceInGroup(palmTrees, nextPalmTrees)
    palmTrees = nextPalmTrees
    palmTreeCapacity = next
  }

  function ensureConiferTreeCapacity(next: number): void {
    if (next <= coniferTreeCapacity) return
    const nextConiferTrees = new InstancedMesh(coniferTreeGeom, treeMaterial, next)
    configureYardMesh(nextConiferTrees)
    replaceInGroup(coniferTrees, nextConiferTrees)
    coniferTrees = nextConiferTrees
    coniferTreeCapacity = next
  }

  function ensurePotCapacity(next: number): void {
    if (next <= potCapacity) return
    const nextPots = new InstancedMesh(potGeom, potMaterial, next)
    configureMesh(nextPots)
    replaceInGroup(pots, nextPots)
    pots = nextPots
    potCapacity = next
  }

  function ensureCrateCapacity(next: number): void {
    if (next <= crateCapacity) return
    const nextCrates = new InstancedMesh(crateGeom, crateMaterial, next)
    configureMesh(nextCrates)
    replaceInGroup(crates, nextCrates)
    crates = nextCrates
    crateCapacity = next
  }

  function ensureFenceCapacity(next: number): void {
    if (next <= fenceCapacity) return
    const nextFences = new InstancedMesh(fenceGeom, fenceMaterial, next)
    configureMesh(nextFences)
    replaceInGroup(fences, nextFences)
    fences = nextFences
    fenceCapacity = next
  }

  function ensureWallCapacity(next: number): void {
    if (next <= wallCapacity) return
    const nextWalls = new InstancedMesh(wallGeom, wallMaterial, next)
    configureMesh(nextWalls)
    replaceInGroup(walls, nextWalls)
    walls = nextWalls
    wallCapacity = next
  }

  const pos3 = new Vector3()
  const quat = new Quaternion()
  const unit = new Vector3(1, 1, 1)
  const poolScale = new Vector3(POOL_R, 1, POOL_R)
  const yAxis = new Vector3(0, 1, 0)
  const xAxis = new Vector3(1, 0, 0)
  const matrix = new Matrix4()
  const white = new Color(1, 1, 1)
  /** Scratch for the bike/scooter lean: applied in local space (about the
   *  wheelbase axis) before the random yaw, so the combined quat leans "into
   *  the kerb" the same amount whichever way the prop ends up facing. */
  const leanQuat = new Quaternion()

  function sync(state: CityState): void {
    // Deterministic per-city, not per-frame: same convention as every other
    // derived-from-state module (roads, crosswalks, the happiness field).
    const kerbAnchors = computeDecorAnchors(state, 1).filter((a) => a.kind === 'kerb')
    const anchors = kerbAnchors.filter((a) => {
      const r = kerbPropRoll(a.seed)
      return r >= BOLLARD_BAND_START && r < TRASH_BAND_START
    })
    ensureCapacity(anchors.length)

    count = anchors.length
    for (let i = 0; i < count; i++) {
      const a = anchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, a.yaw)
      matrix.compose(pos3, quat, unit)
      bodies.setMatrixAt(i, matrix)
      caps.setMatrixAt(i, matrix)

      pos3.set(a.x, 0.006, a.z)
      quat.identity()
      matrix.compose(pos3, quat, poolScale)
      pools.setMatrixAt(i, matrix)

      caps.setColorAt(i, white)
      pools.setColorAt(i, white)
      phase[i] = (a.seed % 1000) / 1000 * Math.PI * 2
    }
    bodies.count = count
    caps.count = count
    pools.count = count
    bodies.instanceMatrix.needsUpdate = true
    caps.instanceMatrix.needsUpdate = true
    pools.instanceMatrix.needsUpdate = true
    if (caps.instanceColor) caps.instanceColor.needsUpdate = true
    if (pools.instanceColor) pools.instanceColor.needsUpdate = true

    // All eight kerb prop types share one KERB_PROP_SALT roll per anchor,
    // split into disjoint bands, so a slot hosts at most one prop.
    const trashAnchors: typeof kerbAnchors = []
    const hydrantAnchors: typeof kerbAnchors = []
    for (const a of kerbAnchors) {
      const r = kerbPropRoll(a.seed)
      if (r >= TRASH_BAND_START && r < HYDRANT_BAND_START) trashAnchors.push(a)
      else if (r >= HYDRANT_BAND_START && r < MAILBOX_BAND_START) hydrantAnchors.push(a)
    }

    ensureTrashCapacity(trashAnchors.length)
    trashCount = trashAnchors.length
    for (let i = 0; i < trashCount; i++) {
      const a = trashAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, a.yaw)
      matrix.compose(pos3, quat, unit)
      trashCans.setMatrixAt(i, matrix)
    }
    trashCans.count = trashCount
    trashCans.instanceMatrix.needsUpdate = true

    ensureHydrantCapacity(hydrantAnchors.length)
    hydrantCount = hydrantAnchors.length
    for (let i = 0; i < hydrantCount; i++) {
      const a = hydrantAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, a.yaw)
      matrix.compose(pos3, quat, unit)
      hydrants.setMatrixAt(i, matrix)
    }
    hydrants.count = hydrantCount
    hydrants.instanceMatrix.needsUpdate = true

    // Mailbox and parking meter take the two remaining disjoint bands.
    // Mailboxes only ever stand in front of a house.
    const mailboxAnchors = kerbAnchors.filter((a) => {
      if (a.buildingType !== 'house') return false
      const r = kerbPropRoll(a.seed)
      return r >= MAILBOX_BAND_START && r < METER_BAND_START
    })
    const meterAnchors = kerbAnchors.filter((a) => {
      const r = kerbPropRoll(a.seed)
      return r >= METER_BAND_START && r < METER_BAND_END
    })

    ensureMailboxCapacity(mailboxAnchors.length)
    mailboxCount = mailboxAnchors.length
    for (let i = 0; i < mailboxCount; i++) {
      const a = mailboxAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, a.yaw)
      matrix.compose(pos3, quat, unit)
      mailboxes.setMatrixAt(i, matrix)
    }
    mailboxes.count = mailboxCount
    mailboxes.instanceMatrix.needsUpdate = true

    ensureMeterCapacity(meterAnchors.length)
    meterCount = meterAnchors.length
    for (let i = 0; i < meterCount; i++) {
      const a = meterAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, a.yaw)
      matrix.compose(pos3, quat, unit)
      meters.setMatrixAt(i, matrix)
    }
    meters.count = meterCount
    meters.instanceMatrix.needsUpdate = true

    // Bench and recycling bin take the last two disjoint bands.
    const benchAnchors = kerbAnchors.filter((a) => {
      const r = kerbPropRoll(a.seed)
      return r >= BENCH_BAND_START && r < BENCH_BAND_END
    })
    const binAnchors = kerbAnchors.filter((a) => {
      const r = kerbPropRoll(a.seed)
      return r >= RECYCLE_BAND_START && r < RECYCLE_BAND_END
    })

    ensureBenchCapacity(benchAnchors.length)
    benchCount = benchAnchors.length
    for (let i = 0; i < benchCount; i++) {
      const a = benchAnchors[i]
      pos3.set(a.x, 0, a.z)
      // The bench is the first oriented prop: its backrest is modelled along
      // local +X (see benchGeometry()), but a.yaw is the angle of the raw
      // kerb-normal vector (atan2(nz, nx) in sim/decor.ts), not the
      // render-side "rotate local +X onto (dx, dz)" convention roads.ts's
      // lamp arm and traffic.ts's headings use (atan2(-dz, dx) — see their
      // own comments). Those two conventions are mirror images of each
      // other, so negating the yaw here is what actually turns the back
      // consistently toward the building on every street orientation,
      // instead of matching on north-south streets and facing backwards on
      // east-west ones.
      quat.setFromAxisAngle(yAxis, -a.yaw)
      matrix.compose(pos3, quat, unit)
      benches.setMatrixAt(i, matrix)
    }
    benches.count = benchCount
    benches.instanceMatrix.needsUpdate = true

    ensureBinCapacity(binAnchors.length)
    binCount = binAnchors.length
    for (let i = 0; i < binCount; i++) {
      const a = binAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, a.yaw)
      matrix.compose(pos3, quat, unit)
      bins.setMatrixAt(i, matrix)
    }
    bins.count = binCount
    bins.instanceMatrix.needsUpdate = true

    // Signboard takes the ninth and last kerb band.
    const signAnchors = kerbAnchors.filter((a) => {
      const r = kerbPropRoll(a.seed)
      return r >= SIGN_BAND_START && r < SIGN_BAND_END
    })

    ensureSignCapacity(signAnchors.length)
    signCount = signAnchors.length
    for (let i = 0; i < signCount; i++) {
      const a = signAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, a.yaw)
      matrix.compose(pos3, quat, unit)
      signs.setMatrixAt(i, matrix)
    }
    signs.count = signCount
    signs.instanceMatrix.needsUpdate = true

    // Traffic cone, garbage bag and wooden pallet take the tenth, eleventh
    // and twelfth (and last) kerb bands. Each is placed with its own
    // independent random yaw (see randomYaw() above) instead of a.yaw, so
    // loose clutter does not all face the anchor's own "outward" direction.
    const coneAnchors = kerbAnchors.filter((a) => {
      const r = kerbPropRoll(a.seed)
      return r >= CONE_BAND_START && r < CONE_BAND_END
    })
    const bagAnchors = kerbAnchors.filter((a) => {
      const r = kerbPropRoll(a.seed)
      return r >= BAG_BAND_START && r < BAG_BAND_END
    })
    const palletAnchors = kerbAnchors.filter((a) => {
      const r = kerbPropRoll(a.seed)
      return r >= PALLET_BAND_START && r < PALLET_BAND_END
    })

    ensureConeCapacity(coneAnchors.length)
    coneCount = coneAnchors.length
    for (let i = 0; i < coneCount; i++) {
      const a = coneAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, randomYaw(a.seed, CONE_YAW_SALT))
      matrix.compose(pos3, quat, unit)
      cones.setMatrixAt(i, matrix)
    }
    cones.count = coneCount
    cones.instanceMatrix.needsUpdate = true

    ensureBagCapacity(bagAnchors.length)
    bagCount = bagAnchors.length
    for (let i = 0; i < bagCount; i++) {
      const a = bagAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, randomYaw(a.seed, BAG_YAW_SALT))
      matrix.compose(pos3, quat, unit)
      bags.setMatrixAt(i, matrix)
    }
    bags.count = bagCount
    bags.instanceMatrix.needsUpdate = true

    ensurePalletCapacity(palletAnchors.length)
    palletCount = palletAnchors.length
    for (let i = 0; i < palletCount; i++) {
      const a = palletAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, randomYaw(a.seed, PALLET_YAW_SALT))
      matrix.compose(pos3, quat, unit)
      pallets.setMatrixAt(i, matrix)
    }
    pallets.count = palletCount
    pallets.instanceMatrix.needsUpdate = true

    // Bicycle and scooter take the thirteenth and fourteenth (and last)
    // kerb bands. Like the cone/bag/pallet trio they get their own
    // independent random yaw; unlike them, that yaw is combined with a
    // fixed local lean about the wheelbase axis (see the file header and
    // BIKE_LEAN/SCOOTER_LEAN) so every instance reads as leant against the
    // kerb regardless of which way it faces.
    const bikeAnchors = kerbAnchors.filter((a) => {
      const r = kerbPropRoll(a.seed)
      return r >= BIKE_BAND_START && r < BIKE_BAND_END
    })
    const scooterAnchors = kerbAnchors.filter((a) => {
      const r = kerbPropRoll(a.seed)
      return r >= SCOOTER_BAND_START && r < SCOOTER_BAND_END
    })

    ensureBikeCapacity(bikeAnchors.length)
    bikeCount = bikeAnchors.length
    for (let i = 0; i < bikeCount; i++) {
      const a = bikeAnchors[i]
      pos3.set(a.x, 0, a.z)
      leanQuat.setFromAxisAngle(xAxis, BIKE_LEAN)
      quat.setFromAxisAngle(yAxis, randomYaw(a.seed, BIKE_YAW_SALT))
      quat.multiply(leanQuat)
      matrix.compose(pos3, quat, unit)
      bikes.setMatrixAt(i, matrix)
    }
    bikes.count = bikeCount
    bikes.instanceMatrix.needsUpdate = true

    ensureScooterCapacity(scooterAnchors.length)
    scooterCount = scooterAnchors.length
    for (let i = 0; i < scooterCount; i++) {
      const a = scooterAnchors[i]
      pos3.set(a.x, 0, a.z)
      leanQuat.setFromAxisAngle(xAxis, SCOOTER_LEAN)
      quat.setFromAxisAngle(yAxis, randomYaw(a.seed, SCOOTER_YAW_SALT))
      quat.multiply(leanQuat)
      matrix.compose(pos3, quat, unit)
      scooters.setMatrixAt(i, matrix)
    }
    scooters.count = scooterCount
    scooters.instanceMatrix.needsUpdate = true

    // Flower planter box takes the fifteenth and last kerb band. Placed with
    // the anchor's own yaw, like the trash can/hydrant/bin, not an
    // independent random one.
    const planterAnchors = kerbAnchors.filter((a) => {
      const r = kerbPropRoll(a.seed)
      return r >= PLANTER_BAND_START && r < PLANTER_BAND_END
    })

    ensurePlanterCapacity(planterAnchors.length)
    planterCount = planterAnchors.length
    for (let i = 0; i < planterCount; i++) {
      const a = planterAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, a.yaw)
      matrix.compose(pos3, quat, unit)
      planters.setMatrixAt(i, matrix)
    }
    planters.count = planterCount
    planters.instanceMatrix.needsUpdate = true

    // Traffic light: a SEPARATE anchor pool (`corner`, not `kerb`), its own
    // salt and its own single-band density check — see CORNER_PROP_SALT
    // above for why this does not join the kerb chain.
    const cornerAnchorList = computeDecorAnchors(state, 1).filter((a) => a.kind === 'corner')
    const trafficLightAnchors = cornerAnchorList.filter((a) => cornerPropRoll(a.seed) < TRAFFIC_LIGHT_CHANCE)

    ensureTlCapacity(trafficLightAnchors.length)
    tlCount = trafficLightAnchors.length
    for (let i = 0; i < tlCount; i++) {
      const a = trafficLightAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, a.yaw)
      matrix.compose(pos3, quat, unit)
      tlBodies.setMatrixAt(i, matrix)
      tlLenses.setMatrixAt(i, matrix)
      tlLenses.setColorAt(i, white)
      tlPhase[i] = (a.seed % 1000) / 1000 * Math.PI * 2
    }
    tlBodies.count = tlCount
    tlLenses.count = tlCount
    tlBodies.instanceMatrix.needsUpdate = true
    tlLenses.instanceMatrix.needsUpdate = true
    if (tlLenses.instanceColor) tlLenses.instanceColor.needsUpdate = true

    // Hedge and yard tree: a THIRD, separate anchor pool (`yard`), its own
    // salt and its own two-way disjoint band split — see YARD_PROP_SALT
    // above for why this does not join the kerb chain either.
    const yardAnchorList = computeDecorAnchors(state, 1).filter((a) => a.kind === 'yard')
    const hedgeAnchors = yardAnchorList.filter((a) => {
      const r = yardPropRoll(a.seed)
      return r >= HEDGE_BAND_START && r < HEDGE_BAND_END
    })
    const treeAnchors = yardAnchorList.filter((a) => {
      const r = yardPropRoll(a.seed)
      return r >= TREE_BAND_START && r < TREE_BAND_END
    })

    ensureHedgeCapacity(hedgeAnchors.length)
    hedgeCount = hedgeAnchors.length
    for (let i = 0; i < hedgeCount; i++) {
      const a = hedgeAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, a.yaw)
      matrix.compose(pos3, quat, unit)
      hedges.setMatrixAt(i, matrix)
    }
    hedges.count = hedgeCount
    hedges.instanceMatrix.needsUpdate = true

    // Tree species by biome: palm on Coast tiles, conifer everywhere else
    // (Plain and Alpine both), matching the palm/conifer split buildings.ts's
    // own park canopy already makes — see the file header on why a third,
    // deciduous style was not added here. A yard anchor carries no biome of
    // its own, so it is looked up the same way buildings.ts looks up its
    // ghost preview's biome: from the terrain map, via the tile the anchor's
    // world position resolves to.
    const terrain = terrainFor(state)
    const palmAnchors: typeof treeAnchors = []
    const coniferAnchors: typeof treeAnchors = []
    for (const a of treeAnchors) {
      const tile = worldToTile(a.x, a.z)
      const biome = tile !== null ? (terrain.biome[tile] as Biome) : Biome.Plain
      if (biome === Biome.Coast) palmAnchors.push(a)
      else coniferAnchors.push(a)
    }

    ensurePalmTreeCapacity(palmAnchors.length)
    palmTreeCount = palmAnchors.length
    for (let i = 0; i < palmTreeCount; i++) {
      const a = palmAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, a.yaw)
      matrix.compose(pos3, quat, unit)
      palmTrees.setMatrixAt(i, matrix)
    }
    palmTrees.count = palmTreeCount
    palmTrees.instanceMatrix.needsUpdate = true

    ensureConiferTreeCapacity(coniferAnchors.length)
    coniferTreeCount = coniferAnchors.length
    for (let i = 0; i < coniferTreeCount; i++) {
      const a = coniferAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, a.yaw)
      matrix.compose(pos3, quat, unit)
      coniferTrees.setMatrixAt(i, matrix)
    }
    coniferTrees.count = coniferTreeCount
    coniferTrees.instanceMatrix.needsUpdate = true

    // Potted plant takes the third yard band.
    const potAnchors = yardAnchorList.filter((a) => {
      const r = yardPropRoll(a.seed)
      return r >= POTTED_BAND_START && r < POTTED_BAND_END
    })

    ensurePotCapacity(potAnchors.length)
    potCount = potAnchors.length
    for (let i = 0; i < potCount; i++) {
      const a = potAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, a.yaw)
      matrix.compose(pos3, quat, unit)
      pots.setMatrixAt(i, matrix)
    }
    pots.count = potCount
    pots.instanceMatrix.needsUpdate = true

    // Stacked wooden crates take the fourth and last yard band.
    const crateAnchors = yardAnchorList.filter((a) => {
      const r = yardPropRoll(a.seed)
      return r >= CRATE_BAND_START && r < CRATE_BAND_END
    })

    ensureCrateCapacity(crateAnchors.length)
    crateCount = crateAnchors.length
    for (let i = 0; i < crateCount; i++) {
      const a = crateAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, a.yaw)
      matrix.compose(pos3, quat, unit)
      crates.setMatrixAt(i, matrix)
    }
    crates.count = crateCount
    crates.instanceMatrix.needsUpdate = true

    // Wooden fence run and stone wall run: a FOURTH, separate anchor pool
    // (`edge-run`), rolled per TILE rather than per anchor — see the file
    // header and EDGE_PROP_SALT above for why. Each of a tile's four edges
    // shares the same roll, so a yard reads as consistently fenced,
    // consistently walled, or left open around its whole boundary.
    const edgeRunAnchorList = computeDecorAnchors(state, 1).filter((a) => a.kind === 'edge-run')
    const fenceAnchors: typeof edgeRunAnchorList = []
    const wallAnchors: typeof edgeRunAnchorList = []
    for (const a of edgeRunAnchorList) {
      const r = edgeTileRoll(a.x, a.z)
      if (r === null) continue
      if (r >= FENCE_BAND_START && r < FENCE_BAND_END) fenceAnchors.push(a)
      else if (r >= WALL_BAND_START && r < WALL_BAND_END) wallAnchors.push(a)
    }

    ensureFenceCapacity(fenceAnchors.length)
    fenceCount = fenceAnchors.length
    for (let i = 0; i < fenceCount; i++) {
      const a = fenceAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, a.yaw)
      matrix.compose(pos3, quat, unit)
      fences.setMatrixAt(i, matrix)
    }
    fences.count = fenceCount
    fences.instanceMatrix.needsUpdate = true

    ensureWallCapacity(wallAnchors.length)
    wallCount = wallAnchors.length
    for (let i = 0; i < wallCount; i++) {
      const a = wallAnchors[i]
      pos3.set(a.x, 0, a.z)
      quat.setFromAxisAngle(yAxis, a.yaw)
      matrix.compose(pos3, quat, unit)
      walls.setMatrixAt(i, matrix)
    }
    walls.count = wallCount
    walls.instanceMatrix.needsUpdate = true
  }

  // --- per frame -----------------------------------------------------------

  const capDark = setSrgb(new Color(), CAP_DARK)
  const glow = setSrgb(new Color(), CAP_GLOW)
  const tlLensDark = setSrgb(new Color(), TRAFFIC_LENS_DARK)
  const tmp = new Color()
  let clock = 0

  function frame(dt: number, night: number): void {
    clock += dt

    // Same gate roads.ts uses for its lamps, so every light in the city comes
    // on together and a little ahead of window glow.
    const lit = smoothstep(0.12, 0.5, night)
    pools.visible = lit > 0.02

    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const flick = 1 + 0.05 * Math.sin(clock * 1.7 + phase[i])
        const k = lit * flick
        tmp.copy(capDark).lerp(glow, clamp01(k)).multiplyScalar(1 + 0.4 * k)
        caps.setColorAt(i, tmp)
        if (pools.visible) {
          tmp.copy(glow).multiplyScalar(k * 0.24)
          pools.setColorAt(i, tmp)
        }
      }
      if (caps.instanceColor) caps.instanceColor.needsUpdate = true
      if (pools.instanceColor && pools.visible) pools.instanceColor.needsUpdate = true
    }

    // Traffic light lens: the bollard's exact technique (same glow tone, same
    // night gate), just with no ground pool to drive alongside it.
    if (tlCount > 0) {
      for (let i = 0; i < tlCount; i++) {
        const flick = 1 + 0.05 * Math.sin(clock * 1.7 + tlPhase[i])
        const k = lit * flick
        tmp.copy(tlLensDark).lerp(glow, clamp01(k)).multiplyScalar(1 + 0.4 * k)
        tlLenses.setColorAt(i, tmp)
      }
      if (tlLenses.instanceColor) tlLenses.instanceColor.needsUpdate = true
    }
  }

  function dispose(): void {
    group.parent?.remove(group)
    group.clear()
    bodies.dispose()
    caps.dispose()
    pools.dispose()
    trashCans.dispose()
    hydrants.dispose()
    mailboxes.dispose()
    meters.dispose()
    benches.dispose()
    bins.dispose()
    signs.dispose()
    cones.dispose()
    bags.dispose()
    pallets.dispose()
    bikes.dispose()
    scooters.dispose()
    planters.dispose()
    tlBodies.dispose()
    tlLenses.dispose()
    hedges.dispose()
    palmTrees.dispose()
    coniferTrees.dispose()
    pots.dispose()
    crates.dispose()
    fences.dispose()
    walls.dispose()
    bodyGeom.dispose()
    capGeom.dispose()
    poolGeom.dispose()
    trashGeom.dispose()
    hydrantGeom.dispose()
    mailboxGeom.dispose()
    meterGeom.dispose()
    benchGeom.dispose()
    binGeom.dispose()
    signGeom.dispose()
    coneGeom.dispose()
    bagGeom.dispose()
    palletGeom.dispose()
    bikeGeom.dispose()
    scooterGeom.dispose()
    planterGeom.dispose()
    tlBodyGeom.dispose()
    tlLensGeom.dispose()
    hedgeGeom.dispose()
    palmTreeGeom.dispose()
    coniferTreeGeom.dispose()
    potGeom.dispose()
    crateGeom.dispose()
    fenceGeom.dispose()
    wallGeom.dispose()
    bodyMaterial.dispose()
    capMaterial.dispose()
    poolMaterial.dispose()
    trashMaterial.dispose()
    hydrantMaterial.dispose()
    mailboxMaterial.dispose()
    meterMaterial.dispose()
    benchMaterial.dispose()
    binMaterial.dispose()
    signMaterial.dispose()
    coneMaterial.dispose()
    bagMaterial.dispose()
    palletMaterial.dispose()
    bikeMaterial.dispose()
    scooterMaterial.dispose()
    planterMaterial.dispose()
    tlBodyMaterial.dispose()
    tlLensMaterial.dispose()
    hedgeMaterial.dispose()
    treeMaterial.dispose()
    potMaterial.dispose()
    crateMaterial.dispose()
    fenceMaterial.dispose()
    wallMaterial.dispose()
    count = 0
    capacity = 0
    trashCount = 0
    trashCapacity = 0
    hydrantCount = 0
    hydrantCapacity = 0
    mailboxCount = 0
    mailboxCapacity = 0
    meterCount = 0
    meterCapacity = 0
    benchCount = 0
    benchCapacity = 0
    binCount = 0
    binCapacity = 0
    signCount = 0
    signCapacity = 0
    coneCount = 0
    coneCapacity = 0
    bagCount = 0
    bagCapacity = 0
    palletCount = 0
    palletCapacity = 0
    bikeCount = 0
    bikeCapacity = 0
    scooterCount = 0
    scooterCapacity = 0
    planterCount = 0
    planterCapacity = 0
    tlCount = 0
    tlCapacity = 0
    hedgeCount = 0
    hedgeCapacity = 0
    palmTreeCount = 0
    palmTreeCapacity = 0
    coniferTreeCount = 0
    coniferTreeCapacity = 0
    potCount = 0
    potCapacity = 0
    crateCount = 0
    crateCapacity = 0
    fenceCount = 0
    fenceCapacity = 0
    wallCount = 0
    wallCapacity = 0
  }

  return { sync, frame, object: group, dispose }
}
