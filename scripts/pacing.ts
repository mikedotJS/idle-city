/**
 * Plays the city headlessly and prints the growth curve. The simulation never
 * imports three.js, so hours of play can be measured in seconds — which is the
 * only honest way to argue about BUILD_INTERVAL or shop income.
 *
 *   npm run pacing
 */
import { buyParcel, createCity, landCost, placeManual } from '../src/sim/actions'
import { buildingCost } from '../src/sim/buildings'
import { step } from '../src/sim/tick'
import { derive } from '../src/sim/economy'
import { PARCEL_COUNT, SIM_DT, TILE_COUNT, WORLD_SIZE } from '../src/sim/config'
import { parcelNeighbours, parcelOfTile, tileIndex } from '../src/sim/grid'
import { isBuildable, terrainFor } from '../src/sim/terrain'
import type { CityState } from '../src/sim/types'

const MARKS = [2, 5, 10, 20, 30, 45, 60, 90, 120, 180]

/**
 * Fixed, so two runs are comparable. createCity() draws a fresh seed and that
 * seed decides the terrain, which decides how many of the 36 starting tiles
 * are buildable — comparing an opening against yesterday's run of the same
 * opening was comparing two different maps.
 */
const SEED = 20240607

/** Buys any affordable bordering parcel. The player's only automated habit. */
function buyLandIfAffordable(state: CityState): void {
  const cost = landCost(state)
  if (cost === null || state.coins < cost) return
  for (let p = 0; p < PARCEL_COUNT; p++) {
    if (state.ownedParcels[p]) continue
    if (!parcelNeighbours(p).some((n) => state.ownedParcels[n])) continue
    if (buyParcel(state, p).ok) return
  }
}

/**
 * Keeps buying one kind of polluter, always in the emptiest corner it can
 * reach. This is the scenario that actually answers "is one of them strictly
 * better": a single opening purchase left alone for three hours only ever
 * measures the opening.
 */
function keepBuying(type: 'factory' | 'landfill') {
  return (state: CityState): void => {
    const cost = buildingCost(type, state.builtCount[type])
    // Never spend the last of it; the city still has to buy its own land.
    if (state.coins < cost * 3) return
    // Corners first, so each new one lands as far from the housing as the
    // owned plot allows — the player's own instinct, played consistently.
    // Owned and buildable only: the first version of this scored every tile on
    // the board, always picked an unowned corner, and placed nothing at all
    // for three simulated hours while reporting a perfectly plausible curve.
    const map = terrainFor(state)
    let best = -1
    let bestScore = -Infinity
    for (let tile = 0; tile < TILE_COUNT; tile++) {
      if (state.grid[tile]) continue
      if (!state.ownedParcels[parcelOfTile(tile)]) continue
      if (!isBuildable(map, tile)) continue
      const x = tile % WORLD_SIZE
      const z = Math.floor(tile / WORLD_SIZE)
      const center = WORLD_SIZE / 2 - 0.5
      const score = Math.abs(x - center) + Math.abs(z - center)
      if (score > bestScore) {
        bestScore = score
        best = tile
      }
    }
    if (best < 0) return
    if (!placeManual(state, type, best).ok) return
  }
}

function play(
  label: string,
  setup: (s: CityState) => void,
  buysLand: boolean,
  each?: (s: CityState) => void,
): void {
  const state = createCity(SEED)
  setup(state)
  console.log(`\n=== ${label} ===`)
  console.log('  min    coins   inc/s  built  owned  happy  derelict  nextLand')

  let next = 0
  for (let t = 0; t < 180 * 60 && next < MARKS.length; t += SIM_DT) {
    step(state, SIM_DT)
    if (buysLand) buyLandIfAffordable(state)
    if (each) each(state)
    if (state.time < MARKS[next] * 60) continue

    const d = derive(state)
    let built = 0
    let derelict = 0
    for (let i = 0; i < TILE_COUNT; i++) {
      const b = state.grid[i]
      if (!b) continue
      built++
      if (b.derelict) derelict++
    }
    const owned = state.ownedParcels.filter(Boolean).length * 9
    console.log(
      [
        String(MARKS[next]).padStart(5),
        state.coins.toFixed(0).padStart(8),
        d.incomeRate.toFixed(1).padStart(7),
        String(built).padStart(6),
        String(owned).padStart(6),
        `${(d.cityHappiness * 100).toFixed(0)}%`.padStart(6),
        String(derelict).padStart(9),
        String(landCost(state) ?? '-').padStart(9),
      ].join(''),
    )
    next++
  }
}

play('left completely alone', () => {}, false)
play('one factory dropped in the middle, then ignored', (s) => {
  placeManual(s, 'factory', tileIndex(5, 5))
}, false)
play('factory in a corner, two parks buffering, land bought when affordable', (s) => {
  placeManual(s, 'factory', tileIndex(3, 3))
  placeManual(s, 'park', tileIndex(5, 4))
  placeManual(s, 'park', tileIndex(4, 5))
}, true)

play('buys a factory whenever it comfortably can', () => {}, true, keepBuying('factory'))
play('buys a landfill whenever it comfortably can', () => {}, true, keepBuying('landfill'))

// The question the landfill exists to pose: 300 starting coins buys one
// factory outright, or three landfills with change. If the cheap opening wins
// at three hours as well as at five minutes, the factory has no reason to be
// in the game.
play('one factory, bought outright at minute zero', (s) => {
  placeManual(s, 'factory', tileIndex(3, 3))
}, true)
play('three landfills for the same money, walled into a corner', (s) => {
  placeManual(s, 'landfill', tileIndex(3, 3))
  placeManual(s, 'landfill', tileIndex(4, 3))
  placeManual(s, 'landfill', tileIndex(3, 4))
}, true)
