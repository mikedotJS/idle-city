import { beforeEach, describe, expect, it } from 'vitest'
import { createCity } from '../actions'
import { LEVEL_COST, STARTING_COINS, STARTING_PARCELS } from '../config'
import {
  MIN_UPGRADE_DISCOUNT,
  UPGRADES,
  UPGRADE_KEYS,
  buyUpgrade,
  canRetire,
  charterFor,
  emptyPrestige,
  retire,
  startingCoins,
  upgradeCost,
  upgradeDiscount,
} from '../prestige'
import { loadPrestige, savePrestige } from '../save'
import { exportCity, importCity } from '../transfer'
import { upgradeCost as buildingUpgradeCost } from '../builder'
import { MemoryStorage, flatten, put, quietCity } from './helpers'

/** A city of `houses` houses at roughly the given happiness. */
function city(houses: number, parks: number) {
  const state = quietCity()
  let placed = 0
  for (let z = 3; z < 9 && placed < houses; z++) {
    for (let x = 3; x < 9 && placed < houses; x++) {
      put(state, 'house', x, z)
      placed++
    }
  }
  for (let i = 0; i < parks; i++) put(state, 'park', 3 + (i % 6), 9 + Math.floor(i / 6))
  return state
}

describe('what a city is worth when you retire it', () => {
  it('pays nothing for an empty city', () => {
    expect(charterFor(quietCity())).toBe(0)
    expect(canRetire(quietCity())).toBe(false)
  })

  it('pays more for a well-kept city than for a bigger neglected one', () => {
    // The whole point of the formula. The leaderboard ranks the biggest city;
    // this has to rank the best-kept one, or it is the same race twice.
    const neglected = quietCity()
    for (let z = 3; z < 9; z++) for (let x = 3; x < 9; x++) put(neglected, 'house', x, z)
    put(neglected, 'factory', 5, 5)
    put(neglected, 'factory', 6, 6)
    put(neglected, 'landfill', 4, 4)

    const kept = quietCity()
    for (let z = 3; z < 7; z++) for (let x = 3; x < 7; x++) put(kept, 'house', x, z)
    for (let x = 3; x < 7; x++) put(kept, 'park', x, 7)

    expect(charterFor(kept)).toBeGreaterThan(charterFor(neglected))
  })

  it('grows with the square root of population, not with it', () => {
    // Population must count for something and must not become the whole
    // answer, or scale wins again by another route.
    const small = city(9, 6)
    const big = city(36, 6)
    const ratio = charterFor(big) / Math.max(charterFor(small), 1)
    expect(charterFor(big)).toBeGreaterThan(charterFor(small))
    expect(ratio).toBeLessThan(4) // linear in population would be 4x
  })

  it('collapses on unhappiness rather than tapering', () => {
    const happy = city(16, 8)
    const miserable = city(16, 0)
    put(miserable, 'factory', 5, 5)
    put(miserable, 'landfill', 6, 6)
    expect(charterFor(miserable)).toBeLessThan(charterFor(happy) / 2)
  })
})

describe('spending charter', () => {
  it('refuses what it cannot pay for, and changes nothing when it does', () => {
    const p = emptyPrestige()
    const before = JSON.parse(JSON.stringify(p))
    const result = buyUpgrade(p, 'seedMoney')
    expect(result.ok).toBe(false)
    expect(p).toEqual(before)
  })

  it('walks up the price ladder and then stops', () => {
    const p = emptyPrestige()
    p.charter = 1000
    const costs = UPGRADES.seedMoney.costs
    for (const cost of costs) {
      expect(upgradeCost(p, 'seedMoney')).toBe(cost)
      expect(buyUpgrade(p, 'seedMoney').ok).toBe(true)
    }
    expect(upgradeCost(p, 'seedMoney')).toBeNull()
    expect(buyUpgrade(p, 'seedMoney').ok).toBe(false)
    expect(p.levels.seedMoney).toBe(costs.length)
    expect(p.charter).toBe(1000 - costs.reduce((a, b) => a + b, 0))
  })

  it('banks a retirement once and counts it', () => {
    const p = emptyPrestige()
    const state = city(16, 8)
    const worth = charterFor(state)
    expect(worth).toBeGreaterThan(0)
    expect(retire(p, state)).toBe(worth)
    expect(p.charter).toBe(worth)
    expect(p.retired).toBe(1)
  })

  it('will not bank a city worth nothing', () => {
    const p = emptyPrestige()
    expect(retire(p, quietCity())).toBe(0)
    expect(p.retired).toBe(0)
  })
})

describe('what prestige actually does to a new city', () => {
  it('does nothing at all when nothing has been bought', () => {
    const p = emptyPrestige()
    expect(startingCoins(p)).toBe(STARTING_COINS)
    expect(upgradeDiscount(p)).toBe(1)
    expect(createCity(9, p).upgradeDiscount).toBe(1)
  })

  it('opens a city with more coins and cheaper upgrades', () => {
    const p = emptyPrestige()
    p.charter = 1000
    buyUpgrade(p, 'seedMoney')
    buyUpgrade(p, 'buildingTrade')
    expect(startingCoins(p)).toBeGreaterThan(STARTING_COINS)

    const city = createCity(4242, p)
    expect(city.coins).toBe(startingCoins(p))
    expect(city.upgradeDiscount).toBe(upgradeDiscount(p))
    // The plot is exactly what it always was; see the note on widerPlot.
    expect(city.ownedParcels.filter(Boolean).length).toBe(STARTING_PARCELS.length)
  })

  it('makes density cheaper, which is the half of a run seed money cannot reach', () => {
    // Seed money is spent in the opening. This is the other lever, and it is
    // the one measurement pointed at: population comes from level-three
    // buildings, so what a city can afford to upgrade decides how big it gets.
    const p = emptyPrestige()
    p.charter = 1000
    expect(upgradeDiscount(p)).toBe(1)
    for (let i = 0; i < UPGRADES.buildingTrade.costs.length; i++) buyUpgrade(p, 'buildingTrade')
    expect(upgradeDiscount(p)).toBeCloseTo(MIN_UPGRADE_DISCOUNT, 6)

    const plain = quietCity()
    const founded = flatten(createCity(88, p))
    const house = put(plain, 'house', 5, 5)
    const same = put(founded, 'house', 5, 5)
    expect(buildingUpgradeCost(founded, same)!).toBeLessThan(buildingUpgradeCost(plain, house)!)
    expect(buildingUpgradeCost(founded, same)! / buildingUpgradeCost(plain, house)!).toBeCloseTo(
      MIN_UPGRADE_DISCOUNT,
      2,
    )
  })

  it('never makes density free, or the city stops having to choose', () => {
    expect(MIN_UPGRADE_DISCOUNT).toBeGreaterThan(0.5)
    expect(LEVEL_COST[3]).toBeGreaterThan(LEVEL_COST[2])
  })

  it('carries the discount on the city, so the builder never learns about prestige', () => {
    // The point of stamping it in at founding: sim/builder.ts imports nothing
    // from sim/prestige.ts, and a saved city keeps the terms it was founded on
    // even if the player spends more charter afterwards.
    const p = emptyPrestige()
    p.charter = 1000
    buyUpgrade(p, 'buildingTrade')
    const city = createCity(88, p)
    const stamped = city.upgradeDiscount

    buyUpgrade(p, 'buildingTrade')
    buyUpgrade(p, 'buildingTrade')
    expect(city.upgradeDiscount).toBe(stamped)
    expect(upgradeDiscount(p)).toBeLessThan(stamped)
  })

  it('leaves every rule of a running city alone', () => {
    // The promise the design makes: prestige buys the opening, never the game.
    // A maxed city and a fresh one must be identical apart from what they
    // opened with.
    const rich = emptyPrestige()
    rich.charter = 1000
    for (const key of UPGRADE_KEYS) {
      for (let i = 0; i < UPGRADES[key].costs.length; i++) buyUpgrade(rich, key)
    }
    const a = flatten(createCity(77))
    const b = flatten(createCity(77, rich))
    // Only the two things it is allowed to touch may differ. Everything else —
    // the plot, the queue, the seed, the terrain — has to be identical, or
    // prestige has started changing the game rather than the founding.
    expect(a.ownedParcels).toEqual(b.ownedParcels)
    expect(a.queue).toEqual(b.queue)
    expect(a.terrainSeed).toBe(b.terrainSeed)
    a.coins = b.coins
    a.upgradeDiscount = b.upgradeDiscount
    expect(a).toEqual(b)
  })
})

describe('prestige is not part of the city', () => {
  beforeEach(() => {
    globalThis.localStorage = new MemoryStorage() as unknown as Storage
  })

  it('round-trips through its own key', () => {
    const p = emptyPrestige()
    p.charter = 12
    p.retired = 3
    buyUpgrade(p, 'seedMoney')
    savePrestige(p)
    expect(loadPrestige()).toEqual(p)
  })

  it('is an empty record when there is nothing stored or it is nonsense', () => {
    expect(loadPrestige()).toEqual(emptyPrestige())
    localStorage.setItem('micro-city-prestige', 'not json')
    expect(loadPrestige()).toEqual(emptyPrestige())
    localStorage.setItem('micro-city-prestige', '[]')
    expect(loadPrestige()).toEqual(emptyPrestige())
  })

  it('clamps a hand-edited record to levels that exist', () => {
    localStorage.setItem(
      'micro-city-prestige',
      JSON.stringify({ charter: -5, retired: -2, levels: { seedMoney: 99, buildingTrade: -3 } }),
    )
    const p = loadPrestige()
    expect(p.charter).toBe(0)
    expect(p.retired).toBe(0)
    expect(p.levels.seedMoney).toBe(UPGRADES.seedMoney.costs.length)
    expect(p.levels.buildingTrade).toBe(0)
  })

  it('does not ride in the exported city, which would make it a charter printer', () => {
    // Export, retire, import, retire again is the exploit this closes.
    const state = city(16, 8)
    const text = exportCity(state)
    expect(text).not.toContain('charter')
    const result = importCity(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect('charter' in result.state).toBe(false)
  })

  it('survives the save being cleared, which is the whole point of it', () => {
    const p = emptyPrestige()
    p.charter = 9
    savePrestige(p)
    localStorage.removeItem('micro-city-save')
    expect(loadPrestige().charter).toBe(9)
  })
})

describe('the upgrade table is coherent', () => {
  it('prices every level higher than the last', () => {
    for (const key of UPGRADE_KEYS) {
      const costs = UPGRADES[key].costs
      expect(costs.length).toBeGreaterThan(0)
      for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThan(costs[i - 1])
    }
  })

  it('costs more to max out than one good city pays', () => {
    // Prestige has to take several cities, or it is a one-off bonus rather
    // than a progression. A very well-kept city measures around 20 charter.
    let total = 0
    for (const key of UPGRADE_KEYS) total += UPGRADES[key].costs.reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThan(40)
  })

  it('discounts by an even step per level, all the way to the floor', () => {
    const p = emptyPrestige()
    p.charter = 1000
    const seen = [upgradeDiscount(p)]
    for (let i = 0; i < UPGRADES.buildingTrade.costs.length; i++) {
      buyUpgrade(p, 'buildingTrade')
      seen.push(upgradeDiscount(p))
    }
    const step = seen[0] - seen[1]
    for (let i = 1; i < seen.length; i++) expect(seen[i - 1] - seen[i]).toBeCloseTo(step, 6)
    expect(seen[seen.length - 1]).toBeCloseTo(MIN_UPGRADE_DISCOUNT, 6)
  })
})
