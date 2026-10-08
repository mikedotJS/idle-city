import { describe, expect, it } from 'vitest'
import { BUILDING_TYPES } from '../../sim/buildings'
import { MAX_LEVEL } from '../../sim/config'
import { Biome } from '../../sim/terrain'
import { attachmentFor } from '../attach'

const BIOMES = [Biome.Plain, Biome.Coast, Biome.Alpine]

describe('attachmentFor', () => {
  it('returns sane, positive placement numbers for every type/level/biome', () => {
    for (const type of BUILDING_TYPES) {
      for (let level = 1; level <= MAX_LEVEL; level++) {
        for (const biome of BIOMES) {
          const a = attachmentFor(type, level, biome, false)
          expect(a.wallTopY).toBeGreaterThan(0)
          expect(a.halfWidth).toBeGreaterThan(0)
          expect(a.halfDepth).toBeGreaterThan(0)
          expect(a.roofPivotY).toBeGreaterThan(0)
          expect(a.frontYaw).toBe(0)
        }
      }
    }
  })

  it('is deterministic: the same inputs return the same numbers', () => {
    const a = attachmentFor('shop', 2, Biome.Plain, false)
    const b = attachmentFor('shop', 2, Biome.Plain, false)
    expect(b).toEqual(a)
  })

  it('scales a merged (maxi) block up by MERGE_SCALE / MERGE_HEIGHT_SCALE', () => {
    for (const type of BUILDING_TYPES) {
      const single = attachmentFor(type, MAX_LEVEL, Biome.Plain, false)
      const maxi = attachmentFor(type, MAX_LEVEL, Biome.Plain, true)
      // A merged anchor renders at double footprint and 1.5x height (see
      // buildings.ts's MERGE_SCALE/MERGE_HEIGHT_SCALE), so its attachment
      // numbers should never be smaller than the single-tile look's.
      expect(maxi.halfWidth).toBeGreaterThanOrEqual(single.halfWidth)
      expect(maxi.halfDepth).toBeGreaterThanOrEqual(single.halfDepth)
      expect(maxi.wallTopY).toBeGreaterThan(0)
      expect(maxi.roofPivotY).toBeGreaterThan(0)
    }
  })

  it('lets a merged shop take an explicit maxi kind, defaulting sanely without one', () => {
    const defaulted = attachmentFor('shop', MAX_LEVEL, Biome.Plain, true)
    const supermarket = attachmentFor('shop', MAX_LEVEL, Biome.Plain, true, 'supermarket')
    expect(defaulted.halfWidth).toBeGreaterThan(0)
    expect(supermarket.halfWidth).toBeGreaterThan(0)
  })
})
