/**
 * Terrain statistics collector: measures the output of generateTerrain() across
 * a range of seeds to establish baseline distributions and detect regressions
 * before future terrain variety changes.
 *
 *   npm run terrain-stats                   # Default: 400 seeds, aggregate stats
 *   npm run terrain-stats -- --maps 3,11,17 # ASCII maps for seeds 3, 11, 17
 */

import {
  generateTerrain,
  SAFE_ZONE,
  countTerrain,
  Terrain,
} from '../src/sim/terrain'
import { WORLD_SIZE, TILE_COUNT } from '../src/sim/config'

/** Parse --maps argument if present. */
function parseMapSeeds(): number[] | null {
  const arg = process.argv.findIndex((a) => a === '--maps')
  if (arg < 0) return null
  const next = process.argv[arg + 1]
  if (!next) return null
  return next.split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n))
}

/** Helper: calculate percentiles from a sorted array. */
function percentile(sorted: number[], p: number): number {
  const idx = ((sorted.length - 1) * p) / 100
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  const weight = idx - lower
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

/** Format a number with consistent spacing. */
function fmt(n: number, width: number = 8, decimals: number = 2): string {
  return (typeof n === 'number' ? n.toFixed(decimals) : String(n)).padStart(
    width,
  )
}

/** Render a single map as ASCII. */
function renderMap(seed: number): string {
  const map = generateTerrain(seed)
  const lines: string[] = [`Map seed ${seed}:`]

  for (let z = 0; z < WORLD_SIZE; z++) {
    let line = ''
    for (let x = 0; x < WORLD_SIZE; x++) {
      const tile = z * WORLD_SIZE + x
      if (x >= SAFE_ZONE.minX && x <= SAFE_ZONE.maxX &&
          z >= SAFE_ZONE.minZ && z <= SAFE_ZONE.maxZ) {
        line += '+'
      } else if (map.terrain[tile] === Terrain.Water) {
        line += '~'
      } else if (map.terrain[tile] === Terrain.Mountain) {
        line += '#'
      } else {
        line += '.'
      }
    }
    lines.push(line)
  }

  return lines.join('\n')
}

/** Run the stats or map rendering mode. */
function main(): void {
  const mapSeeds = parseMapSeeds()

  if (mapSeeds) {
    // Map rendering mode.
    for (const seed of mapSeeds) {
      console.log(renderMap(seed))
      console.log()
    }
  } else {
    // Statistics aggregation mode over 400 seeds.
    const seedCount = 400
    const stats = {
      nonBuildable: [] as number[],
      water: [] as number[],
      mountain: [] as number[],
      peakHeights: [] as number[],
      beaches: [] as number[],
      generationTimes: [] as number[],
    }

    for (let seed = 1; seed <= seedCount; seed++) {
      const start = performance.now()
      const map = generateTerrain(seed)
      const elapsed = performance.now() - start

      stats.generationTimes.push(elapsed)

      // Count terrain types.
      const waterCount = countTerrain(map, Terrain.Water)
      const mountainCount = countTerrain(map, Terrain.Mountain)

      // Non-buildable fraction: (water + mountain) / total tiles.
      const nonBuildableFraction = (waterCount + mountainCount) / TILE_COUNT
      stats.nonBuildable.push(nonBuildableFraction)

      // Water and mountain fractions separately.
      stats.water.push(waterCount / TILE_COUNT)
      stats.mountain.push(mountainCount / TILE_COUNT)

      // Collect peak heights.
      for (let tile = 0; tile < TILE_COUNT; tile++) {
        if (map.terrain[tile] === Terrain.Mountain) {
          stats.peakHeights.push(map.height[tile])
        }
      }

      // Count beach tiles.
      let beachCount = 0
      for (let tile = 0; tile < TILE_COUNT; tile++) {
        if (map.beach[tile]) beachCount++
      }
      stats.beaches.push(beachCount)
    }

    // Sort arrays for percentile calculation.
    stats.nonBuildable.sort((a, b) => a - b)
    stats.water.sort((a, b) => a - b)
    stats.mountain.sort((a, b) => a - b)
    stats.peakHeights.sort((a, b) => a - b)
    stats.beaches.sort((a, b) => a - b)
    stats.generationTimes.sort((a, b) => a - b)

    // Print results.
    console.log('\n=== Terrain Statistics (400 seeds) ===\n')

    console.log('Non-buildable terrain (water + mountain) as fraction of all tiles:')
    console.log(
      '  min      p05      med      p95      max',
    )
    console.log(
      [
        fmt(stats.nonBuildable[0], 8, 3),
        fmt(percentile(stats.nonBuildable, 5), 8, 3),
        fmt(percentile(stats.nonBuildable, 50), 8, 3),
        fmt(percentile(stats.nonBuildable, 95), 8, 3),
        fmt(stats.nonBuildable[stats.nonBuildable.length - 1], 8, 3),
      ].join(''),
    )

    console.log('\nWater terrain only:')
    console.log('  min      med      max')
    console.log(
      [
        fmt(stats.water[0], 8, 3),
        fmt(percentile(stats.water, 50), 8, 3),
        fmt(stats.water[stats.water.length - 1], 8, 3),
      ].join(''),
    )

    console.log('\nMountain terrain only:')
    console.log('  min      med      max')
    console.log(
      [
        fmt(stats.mountain[0], 8, 3),
        fmt(percentile(stats.mountain, 50), 8, 3),
        fmt(stats.mountain[stats.mountain.length - 1], 8, 3),
      ].join(''),
    )

    console.log('\nPeak heights (mountain tiles only):')
    console.log('  med      p90      max')
    console.log(
      [
        fmt(percentile(stats.peakHeights, 50), 8, 3),
        fmt(percentile(stats.peakHeights, 90), 8, 3),
        fmt(stats.peakHeights[stats.peakHeights.length - 1], 8, 3),
      ].join(''),
    )

    console.log('\nMinimum beach tiles observed:')
    console.log(`  ${stats.beaches[0]}`)

    const avgGenTime = stats.generationTimes.reduce((a, b) => a + b) / stats.generationTimes.length
    console.log(`\nAverage generation time per seed: ${fmt(avgGenTime, 6, 3)} ms\n`)
  }
}

main()
