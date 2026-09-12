/** Tuning constants. Every number here is expected to change once the game is played. */

export const WORLD_SIZE = 36 // tiles per side of the whole world
export const PARCEL_SIZE = 3 // tiles per side of a purchasable parcel
export const PARCELS_PER_SIDE = WORLD_SIZE / PARCEL_SIZE // 12
export const TILE_COUNT = WORLD_SIZE * WORLD_SIZE // 1296
export const PARCEL_COUNT = PARCELS_PER_SIDE * PARCELS_PER_SIDE // 144

/** Parcels owned at the start: the centre 2x2 block, i.e. a 6x6 tile plot. */
export const STARTING_PARCELS = (() => {
  const c = PARCELS_PER_SIDE / 2
  return [
    (c - 1) * PARCELS_PER_SIDE + (c - 1),
    (c - 1) * PARCELS_PER_SIDE + c,
    c * PARCELS_PER_SIDE + (c - 1),
    c * PARCELS_PER_SIDE + c,
  ]
})()

/** Buildings upgrade 1 -> 2 -> 3 once there is nowhere left to build. */
export const MAX_LEVEL = 3

/** Output multiplier per level. Index 0 is unused so the level reads directly. */
export const LEVEL_OUTPUT = [0, 1, 2.4, 5.5]

/** A taller factory poisons more: upgrading one is a real trade, not free money. */
export const LEVEL_EMISSION = [0, 1, 1.35, 1.75]

/** Upgrade price as a multiple of what the next new building of that type costs. */
export const LEVEL_COST = [0, 0, 3, 9]

/** Enough to buy a first factory outright; below ~200 a new city can strand at zero income. */
export const STARTING_COINS = 300

export const LAND_BASE_COST = 400
/**
 * Escalates parcelCost() as more of the 144 parcels get bought (see
 * economy.ts). At 1.7 — the value that fit the old 16-parcel map — parcel
 * #144 priced out at ~2.6e34 coins, an unreachable wall once the map grew to
 * 144 parcels. Measured with `usable = 1` for the fully-buildable early/mid
 * parcels and the actual terrain-derived `usable` for #100/#144 (both landed
 * on real tiles at usable 0.78 and 0.00 respectively) against a played-out
 * `npm run pacing` curve, where income already tops 70-100 coins/s within
 * 1-3h off just the 4 starting parcels and keeps scaling with owned land:
 * parcel #10 ≈ 709 coins (a minute of play), #50 ≈ 32,072 (a few hours),
 * #100 ≈ 3,221,113 (roughly a working day of income once ~2/3 of the map is
 * built up), #144 ≈ 87,318,036 — a real end-of-run goal, tens of hours away,
 * not a wall.
 */
export const LAND_COST_GROWTH = 1.1

export const SIM_HZ = 10
export const SIM_DT = 1 / SIM_HZ

/** Happiness of a tile with no emitters in range. */
export const BASE_HAPPINESS = 0.5

/** A house only holds population at or above this tile happiness. */
export const HABITABLE_HAPPINESS = 0.3

/** Income multiplier is INCOME_FLOOR + cityHappiness, so 0.5x .. 1.5x. */
export const INCOME_FLOOR = 0.5

/**
 * A small, uncapped nudge to income per confirmed friend — a reason to add
 * people, not a strategy that outweighs actually building a city. 10 friends
 * is a 10% bump, roughly a third of what going from miserable to delighted
 * happiness alone is worth.
 */
export const FRIEND_INCOME_BONUS = 0.01

/** Shops earn per population within SHOP_RADIUS, up to SHOP_POP_CAP. */
export const SHOP_RADIUS = 3
export const SHOP_COINS_PER_POP = 0.06
export const SHOP_POP_CAP = 25

export const POP_PER_HOUSE = 4

/**
 * Output multiplier for each cell of a valid merged 2x2 block: the block
 * produces as much as six of its parts, so merging is worth real output, not
 * just a bigger sprite.
 */
export const MERGE_OUTPUT_BONUS = 1.5
export const FACTORY_COINS = 5
/**
 * Deliberately worse value than a factory per coin spent (0.018/coin against
 * 0.025), and it escalates faster. The landfill is the polluter you can afford
 * in the first five minutes, not the one you want in the twentieth.
 */
export const LANDFILL_COINS = 1.6

/**
 * What a parcel with nothing buildable in it still costs, as a fraction of a
 * full one. Not zero: an all-water parcel is the bridge to whatever is past it,
 * so it has to stay purchasable, and free land nobody wants is not a decision.
 */
export const LAND_BARREN_FLOOR = 0.35

/** Dereliction hysteresis, in seconds of sim time. */
export const DERELICT_HAPPINESS = 0.25
export const DERELICT_DELAY = 30
export const RECOVER_HAPPINESS = 0.35
export const RECOVER_DELAY = 15

/** Seconds between auto-build attempts, divided by (INCOME_FLOOR + cityHappiness). */
export const BUILD_INTERVAL = 8

/** Offline earnings are capped so a week away doesn't hand you the game. */
export const OFFLINE_CAP_SECONDS = 8 * 3600

export const SAVE_KEY = 'micro-city-save'
/**
 * Prestige lives under its own key, not inside the city. It has to survive the
 * two things that destroy a city — starting a new one, and retiring — and it
 * must NOT ride in the exported save, or the export box becomes a charter
 * printer: export, retire, import, retire again.
 */
export const PRESTIGE_KEY = 'micro-city-prestige'
export const SAVE_VERSION = 3
export const AUTOSAVE_INTERVAL = 5 // seconds of sim time
