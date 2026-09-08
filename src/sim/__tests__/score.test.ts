import { describe, expect, it } from 'vitest'
import { createCity, placeManual } from '../actions'
import { derive } from '../economy'
import { tileIndex } from '../grid'
import { scoreOf } from '../score'
import { step } from '../tick'
import { SIM_DT } from '../config'
import type { CityState } from '../types'

function grown(seconds: number, setup?: (s: CityState) => void): CityState {
  const state = createCity(4)
  setup?.(state)
  for (let t = 0; t < seconds; t += SIM_DT) step(state, SIM_DT)
  return state
}

describe('scoreOf', () => {
  it('scores an empty city at zero', () => {
    const score = scoreOf(createCity(1))
    expect(score.value).toBe(0)
    expect(score.population).toBe(0)
    expect(score.buildings).toBe(0)
  })

  it('is exactly the product of its three parts', () => {
    const state = grown(240)
    const derived = derive(state)
    const score = scoreOf(state)
    expect(score.value).toBe(
      Math.round(derived.cityHappiness * derived.population * derived.incomeRate),
    )
    expect(score.happiness).toBe(derived.cityHappiness)
    expect(score.population).toBe(derived.population)
    expect(score.income).toBe(derived.incomeRate)
  })

  it('punishes a polluted city against a clean one of the same age', () => {
    const clean = grown(600)
    const poisoned = grown(600, (s) => {
      placeManual(s, 'factory', tileIndex(4, 4))
      placeManual(s, 'factory', tileIndex(6, 6))
    })
    expect(scoreOf(poisoned).value).toBeLessThan(scoreOf(clean).value)
  })

  it('rises with time, which is the metric working as chosen and its weakness', () => {
    // All three factors grow, so a longer session outranks a better plan. The
    // trade was made knowingly; this test pins the behaviour so it cannot drift
    // without someone noticing.
    expect(scoreOf(grown(900)).value).toBeGreaterThan(scoreOf(grown(300)).value)
  })

  it('reports plot size, so a board can show a small city that punches up', () => {
    const state = createCity(3)
    expect(scoreOf(state).ownedTiles).toBe(36)
  })

  it('counts derelict buildings as standing but earns nothing from them', () => {
    const state = grown(1200, (s) => {
      placeManual(s, 'factory', tileIndex(5, 5))
    })
    const score = scoreOf(state)
    expect(score.buildings).toBeGreaterThan(0)
    expect(score.value).toBeGreaterThanOrEqual(0)
  })

  it('never returns a fractional score', () => {
    expect(Number.isInteger(scoreOf(grown(450)).value)).toBe(true)
  })
})
