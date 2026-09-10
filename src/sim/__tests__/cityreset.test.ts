import { describe, expect, it, vi } from 'vitest'
import { createCity } from '../actions'
import { reloadAfterCloudReset } from '../cityreset'

describe('reloadAfterCloudReset', () => {
  it('reloads only after the fresh city has been pushed to the cloud', async () => {
    let resolvePush: () => void = () => {}
    const push = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePush = resolve
        }),
    )
    const reload = vi.fn()

    const done = reloadAfterCloudReset(push, createCity(1), reload, 5000)
    await Promise.resolve()
    await Promise.resolve()
    expect(reload).not.toHaveBeenCalled()

    resolvePush()
    await done
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads anyway once the timeout elapses, so a stuck push never traps the player', async () => {
    vi.useFakeTimers()
    const push = vi.fn(() => new Promise<void>(() => {}))
    const reload = vi.fn()

    const done = reloadAfterCloudReset(push, createCity(1), reload, 3000)
    await vi.advanceTimersByTimeAsync(3000)
    await done
    expect(reload).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('pushes the given fresh city, not whatever city was running before', async () => {
    const fresh = createCity(7)
    const push = vi.fn(() => Promise.resolve())

    await reloadAfterCloudReset(push, fresh, () => {})

    expect(push).toHaveBeenCalledWith(fresh)
  })
})
