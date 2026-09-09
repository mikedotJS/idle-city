import { describe, expect, it } from 'vitest'
import { derive, populationNear } from '../economy'
import { computeField } from '../field'
import {
  BASE_HAPPINESS,
  FACTORY_COINS,
  FRIEND_INCOME_BONUS,
  INCOME_FLOOR,
  POP_PER_HOUSE,
  SHOP_COINS_PER_POP,
  SHOP_POP_CAP,
  SHOP_RADIUS,
} from '../config'
import { tileIndex } from '../grid'
import { put, quietCity } from './helpers'

describe('derive', () => {
  it('reports BASE_HAPPINESS and no income for an empty city', () => {
    const d = derive(quietCity())
    expect(d.cityHappiness).toBe(BASE_HAPPINESS)
    expect(d.population).toBe(0)
    expect(d.incomeRate).toBe(0)
  })

  it('houses population only where the tile is habitable', () => {
    const state = quietCity()
    put(state, 'house', 2, 2)
    expect(derive(state).population).toBe(POP_PER_HOUSE)

    // Drop a factory on top of it: happiness falls under HABITABLE_HAPPINESS.
    put(state, 'factory', 3, 2)
    expect(derive(state).population).toBe(0)
  })

  it('houses nobody while derelict, even on a pleasant tile', () => {
    const state = quietCity()
    const house = put(state, 'house', 2, 2)
    house.derelict = true
    expect(derive(state).population).toBe(0)
  })

  it('pays factories a flat rate and derelict buildings nothing', () => {
    const state = quietCity()
    put(state, 'factory', 5, 5)
    const d = derive(state)
    expect(d.incomeRate).toBeCloseTo(FACTORY_COINS * (INCOME_FLOOR + d.cityHappiness), 6)

    state.grid[tileIndex(5, 5)]!.derelict = true
    expect(derive(state).incomeRate).toBe(0)
  })

  it('pays shops per nearby head, capped', () => {
    const state = quietCity()
    put(state, 'shop', 5, 5)
    put(state, 'house', 5, 6)
    put(state, 'house', 6, 5)

    const field = computeField(state)
    expect(populationNear(state, field, tileIndex(5, 5), SHOP_RADIUS)).toBe(2 * POP_PER_HOUSE)

    const d = derive(state)
    expect(d.incomeRate).toBeCloseTo(
      2 * POP_PER_HOUSE * SHOP_COINS_PER_POP * (INCOME_FLOOR + d.cityHappiness),
      6,
    )

    // Ten houses is 40 people, more than the cap allows a shop to serve.
    const packed = quietCity()
    put(packed, 'shop', 5, 5)
    let placed = 0
    for (let z = 3; z <= 7 && placed < 10; z++) {
      for (let x = 3; x <= 7 && placed < 10; x++) {
        if (x === 5 && z === 5) continue
        put(packed, 'house', x, z)
        placed++
      }
    }
    const pd = derive(packed)
    expect(pd.population).toBe(10 * POP_PER_HOUSE)
    expect(pd.incomeRate).toBeCloseTo(
      SHOP_POP_CAP * SHOP_COINS_PER_POP * (INCOME_FLOOR + pd.cityHappiness),
      6,
    )
  })

  it('ignores population outside the shop radius', () => {
    const state = quietCity()
    put(state, 'shop', 1, 1)
    put(state, 'house', 9, 9)
    const field = computeField(state)
    expect(populationNear(state, field, tileIndex(1, 1), SHOP_RADIUS)).toBe(0)
    expect(derive(state).incomeRate).toBe(0)
  })

  it('averages city happiness over occupied tiles only', () => {
    const state = quietCity()
    put(state, 'house', 0, 0)
    put(state, 'factory', 11, 11)
    const field = computeField(state)
    const expected = (field[tileIndex(0, 0)] + field[tileIndex(11, 11)]) / 2
    expect(derive(state).cityHappiness).toBeCloseTo(expected, 6)
    // The empty tiles between them sit at BASE_HAPPINESS and must not dilute it.
    expect(derive(state).cityHappiness).not.toBeCloseTo(BASE_HAPPINESS, 6)
  })

  it('defaults friendCount to 0, so an omitted argument changes nothing', () => {
    const state = quietCity()
    put(state, 'factory', 5, 5)
    expect(derive(state).incomeRate).toBeCloseTo(derive(state, 0).incomeRate, 9)
  })

  it('scales income up by FRIEND_INCOME_BONUS per confirmed friend', () => {
    const state = quietCity()
    put(state, 'factory', 5, 5)
    const base = derive(state).incomeRate

    expect(derive(state, 3).incomeRate).toBeCloseTo(base * (1 + FRIEND_INCOME_BONUS * 3), 6)
    expect(derive(state, 10).incomeRate).toBeCloseTo(base * (1 + FRIEND_INCOME_BONUS * 10), 6)
  })

  it('leaves an already-zero income at zero no matter how many friends', () => {
    // An empty city earns nothing to begin with; friends multiply that, not add to it.
    expect(derive(quietCity(), 50).incomeRate).toBe(0)
  })
})
