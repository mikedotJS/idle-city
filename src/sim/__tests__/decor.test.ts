import { describe, expect, it } from 'vitest'
import { createCity } from '../actions'
import { WORLD_SIZE } from '../config'
import { CLEARANCE, computeDecorAnchors } from '../decor'
import { parcelOfTile, tileIndex, worldToTile } from '../grid'
import { blockCells } from '../merge'
import { isBuildable, terrainFor, type TerrainMap } from '../terrain'
import { flatten, put } from './helpers'
import type { CityState } from '../types'

/** A flat, fully owned city with a scattering of buildings — enough streets
 *  to exercise kerb and corner anchors, and plenty of bare yard tiles too. */
function scatteredCity(): CityState {
  const state = flatten(createCity(11))
  state.ownedParcels.fill(true)
  for (let z = 0; z < WORLD_SIZE; z += 2) {
    for (let x = 0; x < WORLD_SIZE; x += 2) {
      put(state, x % 4 === 0 ? 'house' : 'shop', x, z)
    }
  }
  return state
}

/** A real (non-flat) terrain seed, fully owned and built solid wherever
 *  buildable, so kerb/corner anchors get exercised right up against the
 *  coast and the peaks. */
function terrainCity(): CityState {
  const state = createCity(1234)
  state.ownedParcels.fill(true)
  const map = terrainFor(state)
  for (let z = 0; z < WORLD_SIZE; z++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const tile = tileIndex(x, z)
      if (isBuildable(map, tile)) put(state, 'house', x, z)
    }
  }
  return state
}

function tileOf(anchor: { x: number; z: number }): number {
  const t = worldToTile(anchor.x, anchor.z)
  if (t === null) throw new Error(`decor anchor at (${anchor.x}, ${anchor.z}) falls outside the world`)
  return t
}

describe('computeDecorAnchors', () => {
  it('never places an anchor on water or sand', () => {
    const state = terrainCity()
    const map: TerrainMap = terrainFor(state)
    const anchors = computeDecorAnchors(state, 42)
    expect(anchors.length).toBeGreaterThan(0)
    for (const a of anchors) {
      expect(isBuildable(map, tileOf(a))).toBe(true)
    }
  })

  it('never places an anchor on an unowned tile', () => {
    const state = scatteredCity()
    // Strip ownership from one whole parcel in the middle of the built area.
    const strippedTile = tileIndex(15, 15)
    state.ownedParcels[parcelOfTile(strippedTile)] = false
    const anchors = computeDecorAnchors(state, 7)
    for (const a of anchors) {
      const tile = tileOf(a)
      expect(state.ownedParcels[parcelOfTile(tile)]).toBe(true)
    }
  })

  it('never falls inside a merged 2x2 building block footprint', () => {
    const state = flatten(createCity(11))
    state.ownedParcels.fill(true)
    // A plain scatter of streets around the block, so kerb/corner anchors
    // have real segments to work with near it.
    for (let z = 2; z < WORLD_SIZE; z += 2) {
      for (let x = 2; x < WORLD_SIZE; x += 2) put(state, 'shop', x, z)
    }
    const anchor = tileIndex(10, 10)
    for (const cell of blockCells(anchor)) {
      const b = put(state, 'house', cell % WORLD_SIZE, Math.floor(cell / WORLD_SIZE))
      b.mergeAnchor = anchor
    }
    const merged = new Set(blockCells(anchor))

    const anchors = computeDecorAnchors(state, 3)
    for (const a of anchors) {
      expect(merged.has(tileOf(a))).toBe(false)
    }
  })

  it('is fully deterministic for the same state and seed', () => {
    const state = terrainCity()
    const a = computeDecorAnchors(state, 99)
    const b = computeDecorAnchors(state, 99)
    expect(a).toEqual(b)
  })

  it('respects the building clearance table for kerb and corner anchors', () => {
    // A park (clearance 0.04) sits well below the 0.105 kerb offset, so no
    // kerb or corner anchor should ever be placed flanking one. A house
    // (clearance 0.19) clears it easily and should get anchors.
    const state = flatten(createCity(11))
    state.ownedParcels.fill(true)
    put(state, 'park', 10, 10)
    put(state, 'house', 11, 10)
    put(state, 'house', 10, 11)
    put(state, 'house', 11, 11)

    const anchors = computeDecorAnchors(state, 5)
    const parkTile = tileIndex(10, 10)
    for (const a of anchors) {
      if (a.kind !== 'kerb' && a.kind !== 'corner') continue
      expect(tileOf(a)).not.toBe(parkTile)
    }
    // And the rule really bit: some kerb/corner anchor exists near the houses.
    const nearHouses = anchors.some(
      (a) => (a.kind === 'kerb' || a.kind === 'corner') && [tileIndex(11, 10), tileIndex(10, 11), tileIndex(11, 11)].includes(tileOf(a)),
    )
    expect(nearHouses).toBe(true)
  })

  it('every building type in CLEARANCE stays within the pedestrian lane bounds', () => {
    // Sanity check on the duplicated table itself: every clearance value is a
    // real, finite number between 0 and half a tile.
    for (const v of Object.values(CLEARANCE)) {
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThanOrEqual(0.5)
    }
  })

  it('places yard anchors only on owned, buildable, empty tiles', () => {
    const state = scatteredCity()
    const anchors = computeDecorAnchors(state, 1).filter((a) => a.kind === 'yard')
    expect(anchors.length).toBeGreaterThan(0)
    for (const a of anchors) {
      const tile = tileOf(a)
      expect(state.grid[tile]).toBeNull()
      expect(state.ownedParcels[parcelOfTile(tile)]).toBe(true)
    }
  })

  it('places edge-run anchors only around yard tiles, four per tile', () => {
    const state = scatteredCity()
    const all = computeDecorAnchors(state, 1)
    const yardTiles = new Set(all.filter((a) => a.kind === 'yard').map(tileOf))
    const edgeRuns = all.filter((a) => a.kind === 'edge-run')
    expect(edgeRuns.length).toBe(yardTiles.size * 4)
    for (const a of edgeRuns) {
      expect(yardTiles.has(tileOf(a))).toBe(true)
    }
  })
})
