/**
 * Terrain: water, mountain, and the biome a building takes from its
 * surroundings.
 *
 * Derived from a stable seed rather than stored tile by tile. A 36×36 map
 * (1,296 tiles) in every save would grow the format for something that never
 * changes, and the seed reproduces it exactly — the same trick the auto-builder
 * already relies on to rebuild an identical city from a reloaded save.
 *
 * Water and rock shapes are drawn from libraries of landforms (bay/lake/archipelago/
 * river for water, range/ridge/massif/buttes for rock) picked by seed. Coverage
 * is controlled by a budget (21–30% of the board) rather than a fixed threshold,
 * so terrain variety is decoupled from the shape of the ramp.
 *
 * Water and mountain are NOT buildable, so terrain removes land from the
 * economy. That is why the centre of the board is guaranteed plain: a new city
 * that opened onto a lake would have nowhere to grow and no way to earn.
 * Terrain starts beyond the starting plot, which also means the coast and the
 * peaks are something you discover by buying land.
 */

import { PARCEL_SIZE, STARTING_PARCELS, WORLD_SIZE } from './config'
import { tileIndex, tileX, tileZ } from './grid'
import { ROCK_KINDS, WATER_KINDS, maxOf, rockField as rockShapeField, waterField as waterShapeField, type Side } from './landforms'

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
export const SAFE_ZONE = (() => {
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

/**
 * How ragged the coastline and the ridge are. Raised from 0.18 to 0.30 to
 * accommodate the steeper gradients of blob/segment fields (blobField,
 * segField) relative to the older edgeField ramp: where the old rampe
 * collapsed gently over many tiles, these new fields cut sharply, so wobble
 * needs more bite to visibly displace the contour rather than leaving
 * coastlines as perfect straight lines over 1–2 tiles. Two octaves of bruit
 * (broad + fine) replace a single octave to add natural variation at multiple
 * scales — otherwise a single octave at this strength left regular cranks at
 * constant interval.
 */
const COAST_WOBBLE = 0.30

/** Tiles de dégradé au-delà du plateau de départ. */
const START_RING = 3

/**
 * Une carte sur trois environ porte un second relief, plus petit, sur un côté
 * voisin du premier : un fleuve ET un étang, une crête ET des pitons. Pondéré
 * à 0.85 pour que le relief primaire reste celui qui tient la composition, et
 * jamais un second relief IDENTIQUE en position qui ferait doublon.
 */
const SECOND_LANDFORM_CHANCE = 0.35
const SECOND_LANDFORM_WEIGHT = 0.85

/**
 * Grain du littoral, en tuiles. Dérivé de WORLD_SIZE et non figé : à 12 tuiles
 * de côté cela vaut 3, ce que les deux appels codaient en dur (3.1 et 2.7), et
 * à 36 cela vaut 9, donc une baie garde la même taille RELATIVE au plateau au
 * lieu de se fragmenter en frange d'îlots.
 */
const NOISE_SCALE = WORLD_SIZE / 4

/** Deterministic 32-bit hash. Same seed, same island, every reload. */
function hash(x: number, z: number, seed: number): number {
  let h = (x * 374761393 + z * 668265263 + seed * 2246822519) | 0
  h = (h ^ (h >>> 13)) | 0
  h = Math.imul(h, 1274126177) | 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Suite de tirages 0..1 déterministes pour une graine. */
function stream(seed: number): () => number {
  let i = 0
  return () => hash(i++, 9911, seed)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

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

/**
 * 0 on the starting plot, 1 starting from START_RING + 1 tiles beyond.
 * Multiplied into water and mountain fields, this replaces sharp cutoff with a
 * smooth fade: the lake shore cannot follow the starting parcel boundary, and
 * no massif can wall in the newborn city.
 */
function startMask(x: number, z: number): number {
  const dx = Math.max(SAFE_ZONE.minX - x, x - SAFE_ZONE.maxX, 0)
  const dz = Math.max(SAFE_ZONE.minZ - z, z - SAFE_ZONE.maxZ, 0)
  const d = Math.max(dx, dz)
  const t = Math.min(1, d / (START_RING + 1))
  return t * t * (3 - 2 * t)
}

/**
 * Part du plateau rendue inconstructible, et comment elle se partage entre eau
 * et roche. Un budget remplace le seuil fixe d'avant pour une raison précise :
 * le seuil devait être recalibré à chaque nouvelle forme de relief, alors qu'un
 * budget rend la couverture indépendante de la forme. Mesuré via terrain-stats
 * avant ce changement : couverture médiane ~23.6%, min 21.1%, max 27.3% (sur
 * l'ancien mécanisme à seuil fixe) — ces bornes servent de référence pour viser
 * une fourchette au moins aussi large, si ce n'est légèrement plus. Mesuré
 * après ce changement sur 400 seeds : couverture min 21.0%, med 25.3%, max
 * 29.9%, avec eau et roche variant chacune de ~5.5% à ~22% du plateau selon la
 * seed (contre une fourchette étroite d'environ 9-14% chacune avant) — la
 * quantité, pas seulement le contour, varie maintenant avec la seed.
 */
const TOTAL_BUDGET: [number, number] = [0.21, 0.30]
const WATER_SHARE: [number, number] = [0.25, 0.75]

/**
 * Les `want` tuiles de plus fort champ parmi celles encore libres. Le tri porte
 * sur au plus WORLD_SIZE² indices et ne tourne qu'une fois par ville. Le tri de
 * V8 est stable, donc deux tuiles de champ identique se départagent par index
 * et la carte reste reproductible.
 */
function topTiles(values: Float32Array, taken: Uint8Array, want: number): number[] {
  const pool: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (taken[i] === 0 && values[i] > 0) pool.push(i)
  }
  pool.sort((a, b) => values[b] - values[a])
  return pool.slice(0, Math.min(pool.length, want))
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

  const draw = stream(seed)
  const totalBudget = lerp(TOTAL_BUDGET[0], TOTAL_BUDGET[1], draw())
  const waterShare = lerp(WATER_SHARE[0], WATER_SHARE[1], draw())

  // The silhouette itself — bay, lake, archipelago, river for water; range,
  // ridge, massif, buttes for rock — is drawn from landforms.ts and picked by
  // the seed, same as the edge and the budget above. `side` still orients
  // every shape (see waterField/rockField in landforms.ts for how each kind
  // uses it) even when the shape is not literally glued to that edge, so the
  // "water and rock sit on opposite sides of the board" intent survives the
  // move away from a single ramp shape.
  const waterKind = WATER_KINDS[Math.floor(draw() * WATER_KINDS.length)]
  const rockKind = ROCK_KINDS[Math.floor(draw() * ROCK_KINDS.length)]

  let waterShape = waterShapeField(waterKind, waterEdge as Side, draw, WORLD_SIZE)
  // About one map in three carries a smaller second water feature on a neighbouring side
  if (draw() < SECOND_LANDFORM_CHANCE) {
    const secondWaterSide = (waterEdge + (draw() < 0.5 ? 1 : 3)) % 4
    const secondWaterKind = WATER_KINDS[Math.floor(draw() * WATER_KINDS.length)]
    const secondWaterShape = waterShapeField(secondWaterKind, secondWaterSide as Side, draw, WORLD_SIZE)
    waterShape = maxOf(
      waterShape,
      (x, z) => secondWaterShape(x, z) * SECOND_LANDFORM_WEIGHT
    )
  }

  let rockShape = rockShapeField(rockKind, mountainEdge as Side, draw, WORLD_SIZE)
  // About one map in three carries a smaller second rock feature on a neighbouring side
  if (draw() < SECOND_LANDFORM_CHANCE) {
    const secondRockSide = (mountainEdge + (draw() < 0.5 ? 1 : 3)) % 4
    const secondRockKind = ROCK_KINDS[Math.floor(draw() * ROCK_KINDS.length)]
    const secondRockShape = rockShapeField(secondRockKind, secondRockSide as Side, draw, WORLD_SIZE)
    rockShape = maxOf(
      rockShape,
      (x, z) => secondRockShape(x, z) * SECOND_LANDFORM_WEIGHT
    )
  }

  // Water and rock are chosen by budget, not by a fixed threshold: instead of
  // slicing each tile the moment it is visited, both fields are built in full
  // first, then the strongest `count * share` tiles of each are taken. That
  // decouples "how much of the board is unbuildable" from the shape of the
  // ramp, so a future change to the ramp's shape does not also have to
  // re-tune a threshold to keep the coverage where it was.
  const waterField = new Float32Array(count)
  const rockField = new Float32Array(count)
  for (let z = 0; z < WORLD_SIZE; z++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const i = tileIndex(x, z)
      const mask = startMask(x, z)
      if (mask === 0) continue

      const waterShape_ = waterShape(x, z)
      // Broad octave always, fine octave only when field > 0 to avoid isolated puddles
      const broad = noise(x, z, seed, NOISE_SCALE) - 0.5
      const fine = waterShape_ > 0 ? noise(x, z, seed ^ 0x1d37, NOISE_SCALE / 2.5) - 0.5 : 0
      const wobbleWater = (broad * 0.65 + fine * 0.35) * 2 * COAST_WOBBLE
      waterField[i] = (waterShape_ + wobbleWater) * mask

      const rockShape_ = rockShape(x, z)
      // Broad octave always, fine octave only when field > 0 to avoid isolated peaks
      const broadRock = noise(x, z, seed ^ 0x9e37, NOISE_SCALE) - 0.5
      const fineRock = rockShape_ > 0 ? noise(x, z, (seed ^ 0x9e37) ^ 0x1d37, NOISE_SCALE / 2.5) - 0.5 : 0
      const wobbleRock = (broadRock * 0.65 + fineRock * 0.35) * 2 * COAST_WOBBLE
      const peak = rockShape_ + wobbleRock
      rockField[i] = peak * mask
    }
  }

  const waterWant = Math.round(count * totalBudget * waterShare)
  const waterTiles = topTiles(waterField, terrain, waterWant)

  // Water depth varies from the edge (shallower) to the centre (deeper).
  // Normalised the same way as mountain height: depth is 0 at the weakest
  // kept water tile and 1 at the strongest. This puts the shallow end at
  // -0.11 and the deep end at -0.20, which keeps piers at PIER_Y0 = -0.22
  // buried in the lakebed (margin 0.02 from -0.20 to -0.22) rather than
  // floating. The surface stays at WATER_Y = -0.05 in render/terrain.ts.
  let lowestKeptWater = Infinity
  let highestKeptWater = -Infinity
  for (const i of waterTiles) {
    lowestKeptWater = Math.min(lowestKeptWater, waterField[i])
    highestKeptWater = Math.max(highestKeptWater, waterField[i])
  }
  for (const i of waterTiles) {
    terrain[i] = Terrain.Water
    const span = highestKeptWater - lowestKeptWater
    const depth = span > 0 ? Math.min(1, Math.max(0, (waterField[i] - lowestKeptWater) / span)) : 1
    height[i] = -0.11 + (-0.20 - (-0.11)) * depth
  }

  // Water first, rock second, and rock is free to take whatever water's own
  // field could not fill: if the water field is too thin to reach its share
  // (a coastline seed with little room to grow), the total coverage should
  // not collapse — rock picks up the slack instead.
  const rockWant = Math.round(count * totalBudget) - waterTiles.length
  const rockTiles = topTiles(rockField, terrain, rockWant)

  let lowestKeptRock = Infinity
  let highestRock = 0
  for (const i of rockTiles) {
    lowestKeptRock = Math.min(lowestKeptRock, rockField[i])
    highestRock = Math.max(highestRock, rockField[i])
  }
  for (let i = 0; i < count; i++) highestRock = Math.max(highestRock, rockField[i])

  for (const i of rockTiles) {
    terrain[i] = Terrain.Mountain
    // Taller the further into the retained rock field, so a ridge reads as a
    // ridge — but only just. depth is 0 at the weakest kept rock tile and 1 at
    // the strongest field value on the board, so the ridge always spans the
    // same visual range regardless of how much rock the budget kept. Exponent
    // 0.8 and factor 0.95 were picked so the median peak height stays close to
    // the old fixed-threshold mechanism (was ~0.88, now ~0.9-1.0) and the max
    // stays near 1.4 rather than drifting with the budget.
    const span = highestRock - lowestKeptRock
    const depth = span > 0 ? Math.min(1, Math.max(0, (rockField[i] - lowestKeptRock) / span)) : 1
    height[i] = 0.5 + depth ** 0.8 * 0.95
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

/**
 * A land tile that touches water — the sand strip. Same array the renderer
 * draws the beach from, so "looks like it is on the shore" and "counts as the
 * shore" can never drift apart.
 */
export function isCoast(map: TerrainMap, tile: number): boolean {
  return map.beach[tile] === 1
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
