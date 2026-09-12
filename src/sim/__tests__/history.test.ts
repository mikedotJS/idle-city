import { beforeEach, describe, expect, it } from 'vitest'
import { createCity, demolish, placeManual, spawnBuilding } from '../actions'
import { buildingCost } from '../buildings'
import { tileIndex, tileX, tileZ } from '../grid'
import { forgetDemolitions, peekDemolition, undoDemolition, undoDepth } from '../history'
import { blockCells, isMergedBlock } from '../merge'
import { save, load } from '../save'
import { MemoryStorage, put, quietCity } from './helpers'

describe('undoing a demolition', () => {
  beforeEach(forgetDemolitions)

  it('puts the building back exactly as it stood', () => {
    const state = quietCity()
    const tile = tileIndex(5, 5)
    const before = put(state, 'house', 5, 5)
    before.level = 3
    before.variant = 0.375

    demolish(state, tile)
    expect(state.grid[tile]).toBeNull()

    expect(undoDemolition(state)).toBe(true)
    const after = state.grid[tile]!
    expect(after.type).toBe('house')
    expect(after.level).toBe(3)
    expect(after.variant).toBe(0.375)
    expect(after.bornAt).toBe(before.bornAt)
  })

  it('does not make the next building of that type cheaper or dearer', () => {
    // builtCount is a lifetime tally that demolishing never decrements, so
    // restoring must not increment it — otherwise a demolish-and-undo would
    // quietly raise the price of the next factory.
    const state = quietCity()
    state.coins = 1e6
    const tile = tileIndex(5, 5)
    placeManual(state, 'factory', tile)
    const priced = buildingCost('factory', state.builtCount.factory)

    demolish(state, tile)
    undoDemolition(state)
    expect(buildingCost('factory', state.builtCount.factory)).toBe(priced)
  })

  it('refuses rather than destroying whatever took the tile', () => {
    const state = quietCity()
    const tile = tileIndex(5, 5)
    put(state, 'house', 5, 5)
    demolish(state, tile)
    spawnBuilding(state, 'shop', tile)

    expect(undoDemolition(state)).toBe(false)
    expect(state.grid[tile]!.type).toBe('shop')
    // And it does not sit there waiting to fire later on a tile it no longer owns.
    expect(undoDepth()).toBe(0)
  })

  it('walks back several demolitions, newest first', () => {
    const state = quietCity()
    put(state, 'house', 5, 5)
    put(state, 'shop', 6, 5)
    demolish(state, tileIndex(5, 5))
    demolish(state, tileIndex(6, 5))

    expect(peekDemolition()!.buildings[0].type).toBe('shop')
    undoDemolition(state)
    expect(peekDemolition()!.buildings[0].type).toBe('house')
    undoDemolition(state)
    expect(undoDemolition(state)).toBe(false)
  })

  it('is not part of the city, so it does not survive a save', () => {
    // An undo history belongs to whoever is sitting at the keyboard, not to
    // the city. Reloading a save must not offer to undo last week's mistake.
    globalThis.localStorage = new MemoryStorage() as unknown as Storage
    const state = quietCity()
    put(state, 'house', 5, 5)
    demolish(state, tileIndex(5, 5))
    save(state)

    // The demolished house is nowhere in the serialised city...
    const raw = JSON.parse(localStorage.getItem('micro-city-save')!)
    expect(raw.grid[tileIndex(5, 5)]).toBeNull()
    expect(Object.keys(raw)).not.toContain('history')

    // ...and a city loaded in a fresh session has nothing to undo, because the
    // stack lives in the module rather than in the save.
    forgetDemolitions()
    const reloaded = load()!
    expect(reloaded.state.grid[tileIndex(5, 5)]).toBeNull()
    expect(undoDepth()).toBe(0)
  })

  it('forgets everything when the city is replaced', () => {
    const state = createCity(1)
    put(state, 'house', 5, 5)
    demolish(state, tileIndex(5, 5))
    expect(undoDepth()).toBe(1)
    forgetDemolitions()
    expect(undoDepth()).toBe(0)
  })

  it('remembers a bounded number, so a long session cannot grow forever', () => {
    const state = quietCity()
    for (let i = 0; i < 40; i++) {
      const tile = tileIndex(i % 12, Math.floor(i / 12))
      put(state, 'house', i % 12, Math.floor(i / 12))
      demolish(state, tile)
    }
    expect(undoDepth()).toBeLessThanOrEqual(12)
    expect(undoDepth()).toBeGreaterThan(0)
  })
})

const ANCHOR = tileIndex(5, 5) // 65
const CELLS = blockCells(ANCHOR)

/** Four shops merged by hand into the block anchored at (5,5), like a tick merge. */
function mergedShops(state: ReturnType<typeof quietCity>): void {
  const kinds = ['restaurant', 'konbini', 'clothing', 'general'] as const
  CELLS.forEach((cell, i) => {
    const b = put(state, 'shop', tileX(cell), tileZ(cell))
    b.level = 3
    b.mergeAnchor = ANCHOR
    b.commerceKind = 'food_court'
    void kinds[i]
  })
}

describe('demolishing a merged block', () => {
  beforeEach(forgetDemolitions)

  it('clears all four cells in one action, with one event on the anchor', () => {
    const state = quietCity()
    mergedShops(state)
    expect(isMergedBlock(state, ANCHOR)).toBe(true)

    // Clicking any cell of the block — here a corner away from the anchor.
    expect(demolish(state, tileIndex(6, 6))).toEqual({ ok: true })
    for (const cell of CELLS) expect(state.grid[cell]).toBeNull()

    const events = state.events.filter((e) => e.kind === 'demolished')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ where: ANCHOR, type: 'shop' })
  })

  it('falls back to single-building demolition on a broken anchor', () => {
    const state = quietCity()
    mergedShops(state)
    // Break the block by hand — a stale mergeAnchor pointing at a non-block.
    state.grid[tileIndex(6, 6)] = null
    expect(isMergedBlock(state, ANCHOR)).toBe(false)

    expect(demolish(state, tileIndex(5, 6))).toEqual({ ok: true })
    expect(state.grid[tileIndex(5, 6)]).toBeNull()
    expect(state.grid[ANCHOR]).not.toBeNull()
    expect(peekDemolition()!.buildings).toHaveLength(1)
  })

  it('restores the block still merged, kinds and anchors intact', () => {
    const state = quietCity()
    mergedShops(state)
    demolish(state, tileIndex(5, 5))

    expect(undoDemolition(state)).toBe(true)
    expect(isMergedBlock(state, ANCHOR)).toBe(true)
    for (const cell of CELLS) {
      expect(state.grid[cell]!.mergeAnchor).toBe(ANCHOR)
      expect(state.grid[cell]!.commerceKind).toBe('food_court')
    }
  })

  it('refuses the undo if any one of the four tiles was rebuilt on', () => {
    const state = quietCity()
    mergedShops(state)
    demolish(state, tileIndex(5, 5))
    spawnBuilding(state, 'house', tileIndex(6, 6))

    expect(undoDemolition(state)).toBe(false)
    // Nothing was restored: the other three tiles stay empty, the house stays.
    expect(state.grid[tileIndex(6, 6)]!.type).toBe('house')
    for (const cell of [ANCHOR, tileIndex(6, 5), tileIndex(5, 6)]) {
      expect(state.grid[cell]).toBeNull()
    }
    expect(undoDepth()).toBe(0)
  })
})
