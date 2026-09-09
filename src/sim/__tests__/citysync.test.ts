import { describe, expect, it } from 'vitest'
import { createCity } from '../actions'
import { remoteIsNewer } from '../citysync'

describe('remoteIsNewer', () => {
  it('is true when the remote city was saved more recently', () => {
    const remote = createCity(2)
    remote.lastSavedAt = 2000

    expect(remoteIsNewer(1000, remote)).toBe(true)
  })

  it('is false when the local save is more recent', () => {
    const remote = createCity(2)
    remote.lastSavedAt = 1000

    expect(remoteIsNewer(2000, remote)).toBe(false)
  })

  it('is false on a tie, rather than swapping for an identical save', () => {
    const remote = createCity(2)
    remote.lastSavedAt = 1500

    expect(remoteIsNewer(1500, remote)).toBe(false)
  })

  it('is true against a local save time of 0 — a device with nothing saved yet always loses to a real cloud city', () => {
    const remote = createCity(2)
    remote.lastSavedAt = 1

    expect(remoteIsNewer(0, remote)).toBe(true)
  })
})
