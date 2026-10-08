import { InstancedMesh, Matrix4 } from 'three'
import { describe, expect, it } from 'vitest'
import { createCity } from '../../sim/actions'
import { WORLD_SIZE } from '../../sim/config'
import { computeDecorAnchors } from '../../sim/decor'
import type { CityState } from '../../sim/types'
import { flatten, put } from '../../sim/__tests__/helpers'
import { createDecorView } from '../decor'

/** A fully-owned city scattered with buildings, so real streets — and the
 *  kerb anchors that flank them — exist for the bollard layer to filter. */
function kerbCity(): CityState {
  const state = flatten(createCity(7))
  state.ownedParcels.fill(true)
  for (let z = 0; z < WORLD_SIZE; z += 2) {
    for (let x = 0; x < WORLD_SIZE; x += 2) {
      put(state, x % 4 === 0 ? 'house' : 'shop', x, z)
    }
  }
  return state
}

function bodyCount(view: ReturnType<typeof createDecorView>): number {
  const bodies = view.object.children[0] as InstancedMesh
  return bodies.count
}

function bodyMatrices(view: ReturnType<typeof createDecorView>): number[][] {
  const bodies = view.object.children[0] as InstancedMesh
  const out: number[][] = []
  const m = new Matrix4()
  for (let i = 0; i < bodies.count; i++) {
    bodies.getMatrixAt(i, m)
    out.push(m.toArray())
  }
  return out
}

describe('bollard light placement', () => {
  it('spawns a bollard at only a subset of kerb anchors, not every one', () => {
    const state = kerbCity()
    const kerbAnchorCount = computeDecorAnchors(state, 1).filter((a) => a.kind === 'kerb').length
    expect(kerbAnchorCount).toBeGreaterThan(0)

    const view = createDecorView()
    view.sync(state)
    const placed = bodyCount(view)
    view.dispose()

    expect(placed).toBeGreaterThan(0)
    expect(placed).toBeLessThan(kerbAnchorCount)
  })

  it('is fully deterministic: same city state produces the same bollard subset every time', () => {
    const state = kerbCity()

    const viewA = createDecorView()
    viewA.sync(state)
    const countA = bodyCount(viewA)
    const matricesA = bodyMatrices(viewA)
    viewA.dispose()

    const viewB = createDecorView()
    viewB.sync(state)
    const countB = bodyCount(viewB)
    const matricesB = bodyMatrices(viewB)
    viewB.dispose()

    expect(countB).toBe(countA)
    expect(matricesB).toEqual(matricesA)
  })
})
