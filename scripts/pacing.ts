/**
 * Plays the city headlessly and prints the growth curve. The simulation never
 * imports three.js, so hours of play can be measured in seconds — which is the
 * only honest way to argue about BUILD_INTERVAL or shop income.
 *
 *   npm run pacing
 */
import { buyParcel, createCity, landCost, placeManual } from '../src/sim/actions'
import { step } from '../src/sim/tick'
import { derive } from '../src/sim/economy'
import { PARCEL_COUNT, SIM_DT, TILE_COUNT } from '../src/sim/config'
import { parcelNeighbours, tileIndex } from '../src/sim/grid'
import type { CityState } from '../src/sim/types'

const MARKS = [2, 5, 10, 20, 30, 45, 60, 90, 120, 180]

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

function play(label: string, setup: (s: CityState) => void, buysLand: boolean): void {
  const state = createCity()
  setup(state)
  console.log(`\n=== ${label} ===`)
  console.log('  min    coins   inc/s  built  owned  happy  derelict  nextLand')

  let next = 0
  for (let t = 0; t < 180 * 60 && next < MARKS.length; t += SIM_DT) {
    step(state, SIM_DT)
    if (buysLand) buyLandIfAffordable(state)
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
