import { beforeEach, describe, expect, it } from 'vitest'
import { buyParcel, createCity, demolish, placeManual } from '../actions'
import { SIM_DT, TILE_COUNT } from '../config'
import { EVENT_LIMIT, recordEvent, summarise, worthReporting } from '../events'
import { tileIndex } from '../grid'
import { load, save } from '../save'
import { step } from '../tick'
import { MemoryStorage, earning, flatten, put, quietCity } from './helpers'

describe('the city records what it did', () => {
  it('logs a building the city put up by itself', () => {
    const state = flatten(createCity(5))
    state.coins = 1e6
    for (let t = 0; t < 200; t += SIM_DT) step(state, SIM_DT)
    expect(state.events.some((e) => e.kind === 'built')).toBe(true)
  })

  it('logs rot and recovery', () => {
    const state = quietCity()
    state.coins = 1e6
    put(state, 'house', 5, 5)
    placeManual(state, 'factory', tileIndex(5, 6))
    for (let t = 0; t < 90; t += SIM_DT) step(state, SIM_DT)
    expect(state.events.some((e) => e.kind === 'derelict')).toBe(true)

    demolish(state, tileIndex(5, 6))
    for (let t = 0; t < 60; t += SIM_DT) step(state, SIM_DT)
    expect(state.events.some((e) => e.kind === 'recovered')).toBe(true)
  })

  it('logs land and demolition', () => {
    const state = flatten(createCity(5))
    state.coins = 1e6
    put(state, 'house', 5, 5)
    demolish(state, tileIndex(5, 5))
    expect(state.events.some((e) => e.kind === 'demolished')).toBe(true)

    // Any parcel bordering the starting plot. The city needs something paying
    // first: buyParcel refuses outright while it earns nothing.
    earning(state)
    for (let p = 0; p < 16; p++) if (buyParcel(state, p).ok) break
    expect(state.events.some((e) => e.kind === 'land')).toBe(true)
  })

  it('never grows past the cap, because it rides in every save', () => {
    const state = quietCity()
    for (let i = 0; i < EVENT_LIMIT * 3; i++) {
      recordEvent(state, { kind: 'built', at: i, where: i % TILE_COUNT, type: 'house' })
    }
    expect(state.events.length).toBe(EVENT_LIMIT)
    // The newest survive, not the oldest.
    expect(state.events[state.events.length - 1].at).toBe(EVENT_LIMIT * 3 - 1)
  })
})

describe('what counts as news', () => {
  it('does not report your own actions back to you', () => {
    // Placing a factory is not something to be told about; you were looking.
    const state = quietCity()
    state.coins = 1e6
    state.time = 100
    placeManual(state, 'factory', tileIndex(5, 5))
    expect(summarise(state).built).toBe(0)
    expect(summarise(state).span).toBe(0)
  })

  it('counts only what happened since you last touched the city', () => {
    const state = quietCity()
    state.time = 10
    recordEvent(state, { kind: 'built', at: 5, where: 0, type: 'house' })
    state.lastSeenAt = 8
    recordEvent(state, { kind: 'built', at: 9, where: 1, type: 'house' })
    expect(summarise(state).built).toBe(1)
  })

  it('points at where the rot is worst, not just how much there is', () => {
    const state = quietCity()
    state.time = 100
    // A cluster of four around (9,9), and one stray far away.
    for (const [x, z] of [
      [9, 9],
      [9, 10],
      [10, 9],
      [10, 10],
    ] as const) {
      recordEvent(state, { kind: 'derelict', at: 50, where: tileIndex(x, z), type: 'house' })
    }
    recordEvent(state, { kind: 'derelict', at: 50, where: tileIndex(1, 1), type: 'house' })

    const summary = summarise(state)
    expect(summary.derelict).toBe(5)
    expect(summary.troubleCount).toBe(4)
    expect([tileIndex(9, 9), tileIndex(9, 10), tileIndex(10, 9), tileIndex(10, 10)]).toContain(
      summary.trouble,
    )
  })

  it('stays quiet about nothing much and speaks up about rot', () => {
    const quiet = quietCity()
    quiet.time = 100
    recordEvent(quiet, { kind: 'built', at: 50, where: 0, type: 'house' })
    expect(worthReporting(summarise(quiet))).toBe(false)

    const bad = quietCity()
    bad.time = 100
    recordEvent(bad, { kind: 'derelict', at: 50, where: 0, type: 'house' })
    expect(worthReporting(summarise(bad))).toBe(true)
  })
})

describe('the log survives a save', () => {
  beforeEach(() => {
    globalThis.localStorage = new MemoryStorage() as unknown as Storage
  })

  it('round-trips events and the seen marker', () => {
    const state = quietCity()
    state.time = 60
    state.lastSeenAt = 20
    recordEvent(state, { kind: 'derelict', at: 40, where: 12, type: 'shop' })
    save(state)

    const result = load()
    expect(result).not.toBeNull()
    expect(result!.state.events).toHaveLength(1)
    expect(result!.state.events[0].kind).toBe('derelict')
    expect(result!.state.lastSeenAt).toBe(20)
  })

  it('opens an older save without inventing news', () => {
    // A save from before the log existed must not greet its owner with a
    // summary of a history it never recorded.
    const state = quietCity()
    state.time = 500
    save(state)
    const raw = JSON.parse(localStorage.getItem('micro-city-save')!)
    delete raw.events
    delete raw.lastSeenAt
    raw.version = 2
    localStorage.setItem('micro-city-save', JSON.stringify(raw))

    const result = load()
    expect(result).not.toBeNull()
    expect(result!.state.events).toEqual([])
    expect(summarise(result!.state).span).toBe(0)
  })

  it('drops a malformed entry rather than losing the city', () => {
    const state = quietCity()
    recordEvent(state, { kind: 'built', at: 1, where: 2, type: 'house' })
    save(state)
    const raw = JSON.parse(localStorage.getItem('micro-city-save')!)
    raw.events.push({ kind: 'nonsense', at: 'soon', where: null })
    raw.events.push(null)
    localStorage.setItem('micro-city-save', JSON.stringify(raw))

    const result = load()
    expect(result).not.toBeNull()
    expect(result!.state.events).toHaveLength(1)
  })
})
