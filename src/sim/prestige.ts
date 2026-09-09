/**
 * Retiring a city for something that outlives it.
 *
 * Two rules shape everything here, and both are choices rather than
 * conveniences.
 *
 * FIRST: charter rewards care, not scale. The leaderboard already measures
 * scale — happiness x population x income, every factor growing with time, so
 * two players of equal skill are separated by how long they left the tab open.
 * A prestige currency built the same way would be that same race a second
 * time. So this one is `sqrt(population) x happiness^3`: population still
 * counts, with diminishing returns, and happiness dominates. Measured over
 * three simulated hours, a city left to grow itself sits at 33-36% happiness
 * and earns nothing here at all; a city whose owner keeps planting amenities
 * where the field is worst reaches 100% and earns around twenty. That gap is
 * the whole point. The board ranks the biggest city; this ranks the best-kept
 * one, and a player can chase either.
 *
 * SECOND: charter never touches the tension between what pays and what people
 * want to live near. That is the entire game, and a permanent upgrade that
 * softened it — an income multiplier, a happiness floor, cheaper pollution —
 * would be buying your way out of playing. Everything prestige grants is fixed
 * at founding and carried on the city itself, so the sim stays pure and a
 * saved city remembers what it was founded with.
 *
 * The two tracks were chosen by measuring, and the first list was wrong. It
 * paired seed money with a wider starting plot, and a wider plot turned out to
 * be a HANDICAP: the auto-builder only upgrades when it has nowhere left to
 * spread, so more land means more sprawl, later density, and a smaller city.
 * Over a tended hour, three extra parcels took a city from 312 population to
 * 168. Cheaper land measured the same way, and so did opening with buildings
 * already standing. What actually helps is money at the start and cheaper
 * density later — 30% off upgrades takes the same hour from 312 to 354, and
 * from 25 level-three buildings to 31. One lever for the opening, one for the
 * part where the opening stops mattering.
 *
 * Pure, like everything under sim/. Persistence lives in save.ts, which is the
 * one place allowed to touch storage.
 */

import { STARTING_COINS } from './config'
import { derive } from './economy'
import type { CityState } from './types'

export type UpgradeKey = 'seedMoney' | 'buildingTrade'

export interface UpgradeDef {
  key: UpgradeKey
  label: string
  /** What one more level does, in the player's words. */
  blurb: string
  /** Charter price of each level, in order. Length is the cap. */
  costs: number[]
}

export const UPGRADES: Record<UpgradeKey, UpgradeDef> = {
  seedMoney: {
    key: 'seedMoney',
    label: 'Seed money',
    blurb: 'Every new city opens with 150 more coins in the account.',
    costs: [2, 4, 7, 11],
  },
  buildingTrade: {
    key: 'buildingTrade',
    label: 'Building trade',
    blurb: 'Every new city upgrades its buildings 7.5% cheaper, for good.',
    costs: [4, 7, 11, 16],
  },
}

export const UPGRADE_KEYS = Object.keys(UPGRADES) as UpgradeKey[]

/** Coins one level of seedMoney adds to a new city. */
const COINS_PER_LEVEL = 150

/**
 * Fraction knocked off upgrade costs per level of buildingTrade. Four levels
 * reach 30%, which measurement puts at a clear improvement without making
 * density free — at 50% off the city stops having to choose at all.
 */
const TRADE_DISCOUNT_PER_LEVEL = 0.075

/** The cheapest upgrades can ever get, i.e. buildingTrade fully bought. */
export const MIN_UPGRADE_DISCOUNT = 1 - 4 * TRADE_DISCOUNT_PER_LEVEL

export interface PrestigeState {
  /** Unspent charter. */
  charter: number
  /** Levels bought, per upgrade. */
  levels: Record<UpgradeKey, number>
  /** How many cities have been retired. Shown, never spent. */
  retired: number
}

export function emptyPrestige(): PrestigeState {
  const levels = {} as Record<UpgradeKey, number>
  for (const key of UPGRADE_KEYS) levels[key] = 0
  return { charter: 0, levels, retired: 0 }
}

/**
 * What retiring this city right now would pay. Deliberately steep in
 * happiness and gentle in population; see the header.
 */
export function charterFor(state: CityState): number {
  const d = derive(state)
  if (d.population <= 0) return 0
  return Math.floor(Math.sqrt(d.population) * Math.pow(d.cityHappiness, 3))
}

/** A city worth nothing is not worth the ceremony of retiring it. */
export function canRetire(state: CityState): boolean {
  return charterFor(state) >= 1
}

/** Price of the next level of an upgrade, or null when it is maxed. */
export function upgradeCost(prestige: PrestigeState, key: UpgradeKey): number | null {
  const level = prestige.levels[key]
  const costs = UPGRADES[key].costs
  return level >= costs.length ? null : costs[level]
}

export type PrestigeResult = { ok: true } | { ok: false; reason: string }

export function buyUpgrade(prestige: PrestigeState, key: UpgradeKey): PrestigeResult {
  const cost = upgradeCost(prestige, key)
  if (cost === null) return { ok: false, reason: `${UPGRADES[key].label} is already at its best` }
  if (prestige.charter < cost) return { ok: false, reason: 'Not enough charter' }
  prestige.charter -= cost
  prestige.levels[key]++
  return { ok: true }
}

/** Bank what this city was worth. Returns the charter gained. */
export function retire(prestige: PrestigeState, state: CityState): number {
  const gained = charterFor(state)
  if (gained < 1) return 0
  prestige.charter += gained
  prestige.retired++
  return gained
}

export function startingCoins(prestige: PrestigeState): number {
  return STARTING_COINS + prestige.levels.seedMoney * COINS_PER_LEVEL
}

/**
 * Multiplier on what it costs to take a building up a level, 1.0 down to 0.7.
 * Stamped onto the city at founding rather than consulted during play, so the
 * builder never has to know prestige exists and a saved city keeps the terms
 * it was founded on.
 */
export function upgradeDiscount(prestige: PrestigeState): number {
  return 1 - prestige.levels.buildingTrade * TRADE_DISCOUNT_PER_LEVEL
}
