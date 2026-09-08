/**
 * The leaderboard metric: happiness x population x income.
 *
 * Pure, like everything else under sim/, so the exact same code can run in the
 * browser and on a server that wants to check a submission rather than trust
 * it. That is the whole reason this file imports nothing but the other pure
 * modules.
 *
 * A caveat worth keeping in the code rather than only in a design doc: because
 * all three factors grow with time, this metric rewards scale. Two players of
 * equal skill are separated by how long they left the tab open. It ranks
 * cities, not play.
 */

import { derive } from './economy'
import type { CityState } from './types'

export interface Score {
  /** happiness x population x income, rounded to a whole number. */
  value: number
  /** 0..1 mean happiness over occupied tiles. */
  happiness: number
  population: number
  /** Coins per second, multiplier already applied. */
  income: number
  /** Buildings standing, derelict included. Context for a board entry. */
  buildings: number
  /** Tiles owned. Also context: a big score on a small plot is the impressive one. */
  ownedTiles: number
}

export function scoreOf(state: CityState): Score {
  const derived = derive(state)

  let buildings = 0
  for (const cell of state.grid) if (cell) buildings++

  let ownedTiles = 0
  for (const owned of state.ownedParcels) if (owned) ownedTiles += 9

  return {
    value: Math.round(derived.cityHappiness * derived.population * derived.incomeRate),
    happiness: derived.cityHappiness,
    population: derived.population,
    income: derived.incomeRate,
    buildings,
    ownedTiles,
  }
}
