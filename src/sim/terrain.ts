/**
 * Terrain: water, mountain, and the biome a building takes from its
 * surroundings.
 *
 * Derived from a stable seed rather than stored tile by tile. A 144-entry map
 * in every save would grow the format for something that never changes, and
 * the seed reproduces it exactly — the same trick the auto-builder already
 * relies on to rebuild an identical city from a reloaded save.
 *
 * Water and mountain are NOT buildable, so terrain removes land from the
 * economy. That is why the centre of the board is guaranteed plain: a new city
 * that opened onto a lake would have nowhere to grow and no way to earn.
 * Terrain starts beyond the starting plot, which also means the coast and the
 * peaks are something you discover by buying land.
 */

import { PARCEL_SIZE, STARTING_PARCELS, WORLD_SIZE } from './config'
import { tileIndex, tileX, tileZ } from './grid'

export const enum Terrain {
  Plain = 0,
  Water = 1,
  Mountain = 2,
}

/** What a building on this tile looks like. Beaches are the coast ground. */
export const enum Biome {
  Plain = 0,
  Coast = 1,
  Alpine = 2,
}

export interface TerrainMap {
  /** Terrain per tile, length TILE_COUNT. */
  terrain: Uint8Array
  /** Biome per tile, length TILE_COUNT. Water and mountain tiles keep their own. */
  biome: Uint8Array
  /** 1 where a land tile touches water: the sand strip. */
  beach: Uint8Array
  /** Height in world units, 0 on the plain, negative in water, positive on peaks. */
  height: Float32Array
}

/**
 * The starting plot always stays plain, so a new city can always grow. Derived
 * from STARTING_PARCELS rather than a hardcoded radius: move the starting
 * parcels and the protected area follows instead of silently drifting off them.
 */
const SAFE = (() => {
  const perSide = WORLD_SIZE / PARCEL_SIZE
  let minX = WORLD_SIZE
  let maxX = -1
  let minZ = WORLD_SIZE
  let maxZ = -1
  for (const parcel of STARTING_PARCELS) {
    const px = (parcel % perSide) * PARCEL_SIZE
    const pz = Math.floor(parcel / perSide) * PARCEL_SIZE
    minX = Math.min(minX, px)
    maxX = Math.max(maxX, px + PARCEL_SIZE - 1)
    minZ = Math.min(minZ, pz)
    maxZ = Math.max(maxZ, pz + PARCEL_SIZE - 1)
  }
  return { minX, maxX, minZ, maxZ }
})()

/** How ragged the coastline and the ridge are. */
const COAST_WOBBLE = 0.18

/** Above this, a tile is water or rock. Tuned by measurement, not by eye. */
const TERRAIN_THRESHOLD = 0.8

/** How fast a peak rises inland. See the note where it is used. */
const MOUNTAIN_GAIN = 2.4

/** Deterministic 32-bit hash. Same seed, same island, every reload. */
function hash(x: number, z: number, seed: number): number {
  let h = (x * 374761393 + z * 668265263 + seed * 2246822519) | 0
  h = (h ^ (h >>> 13)) | 0
  h = Math.imul(h, 1274126177) | 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise over the tile lattice, enough for a coastline. */
function noise(x: number, z: number, seed: number, scale: number): number {
  const sx = x / scale
  const sz = z / scale
  const x0 = Math.floor(sx)
  const z0 = Math.floor(sz)
  const fx = sx - x0
  const fz = sz - z0
  const ease = (t: number) => t * t * (3 - 2 * t)
  const ex = ease(fx)
  const ez = ease(fz)

  const n00 = hash(x0, z0, seed)
  const n10 = hash(x0 + 1, z0, seed)
  const n01 = hash(x0, z0 + 1, seed)
  const n11 = hash(x0 + 1, z0 + 1, seed)

  const top = n00 + (n10 - n00) * ex
  const bottom = n01 + (n11 - n01) * ex
  return top + (bottom - top) * ez
}

function inSafeZone(x: number, z: number): boolean {
  return x >= SAFE.minX && x <= SAFE.maxX && z >= SAFE.minZ && z <= SAFE.maxZ
}

/**
 * Water rises from one edge of the board and mountains from the opposite one,
 * which side chosen by the seed. Putting them on opposite edges is deliberate:
 * a city that can reach both has to sprawl across the whole plot to do it, so
 * the two themes are a reward for expanding rather than a starting condition.
 */
export function generateTerrain(seed: number): TerrainMap {
  const count = WORLD_SIZE * WORLD_SIZE
  const terrain = new Uint8Array(count)
  const biome = new Uint8Array(count)
  const beach = new Uint8Array(count)
  const height = new Float32Array(count)

  // Seed 0 is the flat world: no water, no peaks, every tile buildable. Tests
  // that care about the economy rather than the geography use it, and it makes
  // "terrain is optional" a property of the code rather than a convention.
  if (seed === 0) return { terrain, biome, beach, height }

  // Which edge gets the water: 0 = north, 1 = east, 2 = south, 3 = west.
  const waterEdge = Math.floor(hash(7, 13, seed) * 4) % 4
  const mountainEdge = (waterEdge + 2) % 4

  /**
   * 0 at the far side of the board, 1 hard against the chosen edge — cubed, so
   * it collapses quickly inland. A linear ramp made the outer third of the
   * board eligible and the coverage swung between 23% and 50% depending on the
   * seed; cubed it sits at 31% with a range of 24-33%, measured over 300 seeds.
   */
  function edgeCloseness(x: number, z: number, edge: number): number {
    const last = WORLD_SIZE - 1
    const distance = edge === 0 ? z : edge === 1 ? last - x : edge === 2 ? last - z : x
    const closeness = 1 - distance / last
    return closeness * closeness * closeness
  }

  for (let z = 0; z < WORLD_SIZE; z++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const i = tileIndex(x, z)
      if (inSafeZone(x, z)) continue

      const wobble = noise(x, z, seed, 3.1) * COAST_WOBBLE
      if (edgeCloseness(x, z, waterEdge) + wobble > TERRAIN_THRESHOLD) {
        terrain[i] = Terrain.Water
        height[i] = -0.16
        continue
      }
      const peak = edgeCloseness(x, z, mountainEdge) + noise(x, z, seed ^ 0x9e37, 2.7) * COAST_WOBBLE
      if (peak > TERRAIN_THRESHOLD) {
        terrain[i] = Terrain.Mountain
        // Taller the further in, so a ridge reads as a ridge — but only just.
        // At a gain of 6 the median peak was 1.84 and the tallest 2.77 against
        // a 0.55 house and a 1.0 tile: not a mountain, a wall along one edge of
        // the board. 2.4 puts the median near 1.0 and the tallest near 1.4,
        // about twice a house, which reads as landscape rather than architecture.
        height[i] = 0.5 + (peak - TERRAIN_THRESHOLD) * MOUNTAIN_GAIN
      }
    }
  }

  // Second pass: biome and beaches both come from what a tile is next to, so
  // they can only be resolved once every tile's terrain is known.
  for (let z = 0; z < WORLD_SIZE; z++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const i = tileIndex(x, z)
      if (terrain[i] === Terrain.Water) {
        biome[i] = Biome.Coast
        continue
      }
      if (terrain[i] === Terrain.Mountain) {
        biome[i] = Biome.Alpine
        continue
      }

      let touchesWater = false
      let touchesMountain = false
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue
          const nx = x + dx
          const nz = z + dz
          if (nx < 0 || nz < 0 || nx >= WORLD_SIZE || nz >= WORLD_SIZE) continue
          const t = terrain[tileIndex(nx, nz)]
          if (t === Terrain.Water) touchesWater = true
          else if (t === Terrain.Mountain) touchesMountain = true
        }
      }

      // Water wins a tie: a beach is the more distinctive of the two, and a
      // tile squeezed between a lake and a ridge is rare enough not to matter.
      if (touchesWater) {
        biome[i] = Biome.Coast
        beach[i] = 1
      } else if (touchesMountain) {
        biome[i] = Biome.Alpine
      }
    }
  }

  return { terrain, biome, beach, height }
}

export function isBuildable(map: TerrainMap, tile: number): boolean {
  return map.terrain[tile] === Terrain.Plain
}

export function biomeOf(map: TerrainMap, tile: number): Biome {
  return map.biome[tile] as Biome
}

/** How much of a parcel is actually usable, for pricing and for the UI. */
export function buildableTilesInParcel(map: TerrainMap, parcel: number): number {
  const px = (parcel % (WORLD_SIZE / PARCEL_SIZE)) * PARCEL_SIZE
  const pz = Math.floor(parcel / (WORLD_SIZE / PARCEL_SIZE)) * PARCEL_SIZE
  let usable = 0
  for (let z = pz; z < pz + PARCEL_SIZE; z++) {
    for (let x = px; x < px + PARCEL_SIZE; x++) {
      if (isBuildable(map, tileIndex(x, z))) usable++
    }
  }
  return usable
}

/** Tiles of a given terrain, for tests and for the renderer's bookkeeping. */
export function countTerrain(map: TerrainMap, kind: Terrain): number {
  let n = 0
  for (const t of map.terrain) if (t === kind) n++
  return n
}

export { tileX, tileZ }

/**
 * Memoised by seed. Terrain is a pure function of one number, so every module
 * that needs it can ask for it directly instead of threading a map through
 * signatures that have nothing else to do with geography.
 */
let cached: { seed: number; map: TerrainMap } | null = null

export function terrainFor(state: { terrainSeed: number }): TerrainMap {
  if (cached && cached.seed === state.terrainSeed) return cached.map
  cached = { seed: state.terrainSeed, map: generateTerrain(state.terrainSeed) }
  return cached.map
}
