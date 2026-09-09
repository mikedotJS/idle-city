import {
  DERELICT_DELAY,
  DERELICT_HAPPINESS,
  RECOVER_DELAY,
  RECOVER_HAPPINESS,
} from './config'
import { BUILDINGS } from './buildings'
import { recordEvent } from './events'
import { derive } from './economy'
import { tryAutoBuild } from './builder'
import type { CityState, Derived } from './types'

/** Guards the >= comparisons against accumulated float error in state.time. */
const EPS = 1e-9

export interface TickResult {
  derived: Derived
  structureChanged: boolean
}

/**
 * Hysteresis: a standing building needs DERELICT_DELAY continuous seconds below
 * DERELICT_HAPPINESS to fall, a derelict one needs RECOVER_DELAY continuous
 * seconds above RECOVER_HAPPINESS to come back. Between the two thresholds
 * neither timer runs, so nothing flickers on the boundary. Only derelictable
 * types are considered; see BuildingDef.derelictable.
 * Returns true if any building changed state.
 */
function updateDereliction(state: CityState, field: Float32Array): boolean {
  let changed = false

  for (let i = 0; i < state.grid.length; i++) {
    const b = state.grid[i]
    if (!b || !BUILDINGS[b.type].derelictable) continue
    const h = field[i]

    if (b.derelict) {
      b.lowSince = null
      if (h > RECOVER_HAPPINESS) {
        if (b.highSince === null) {
          b.highSince = state.time
        } else if (state.time - b.highSince >= RECOVER_DELAY - EPS) {
          b.derelict = false
          b.highSince = null
          recordEvent(state, { kind: 'recovered', at: state.time, where: i, type: b.type })
          changed = true
        }
      } else {
        b.highSince = null
      }
    } else {
      b.highSince = null
      if (h < DERELICT_HAPPINESS) {
        if (b.lowSince === null) {
          b.lowSince = state.time
        } else if (state.time - b.lowSince >= DERELICT_DELAY - EPS) {
          b.derelict = true
          b.lowSince = null
          recordEvent(state, { kind: 'derelict', at: state.time, where: i, type: b.type })
          changed = true
        }
      } else {
        b.lowSince = null
      }
    }
  }

  return changed
}

/** Advance the sim by dt seconds. Callers pass fixed SIM_DT steps. */
export function step(state: CityState, dt: number, friendCount = 0): TickResult {
  state.time += dt

  let derived = derive(state, friendCount)
  let structureChanged = false

  // Earn at the rate the layout had over this step, before anything changes it.
  state.coins += derived.incomeRate * dt

  if (updateDereliction(state, derived.field)) {
    structureChanged = true
    derived = derive(state, friendCount)
  }

  if (state.time >= state.nextBuildAt) {
    if (tryAutoBuild(state, derived)) {
      structureChanged = true
      derived = derive(state, friendCount)
    }
  }

  return { derived, structureChanged }
}
