import type { CityState } from './types'

/**
 * Restart and retire both clear the local save and reload the page — see
 * main.ts's onRestart/onRetire. Left at that, the cloud still holds
 * whatever this device pushed before the reset, and citySync.remoteIsNewer
 * always prefers a real cloud city over the save-time-zero a fresh boot
 * starts from (see citysync.ts) — so the very next reconciliation pulls
 * the discarded city right back. "New city" and "Retire this city" never
 * actually stick for anyone signed in with a city already on the cloud.
 *
 * Pushing a freshly created city to the cloud before reloading closes that
 * window: whatever reconciliation does after the reload, it's reconciling
 * against a real fresh city, never the one just thrown away. The timeout is
 * a safety valve, not the fix — a push that never resolves must not trap
 * the player on a blank screen forever.
 */
export function reloadAfterCloudReset(
  push: (state: CityState) => Promise<void>,
  freshCity: CityState,
  reload: () => void,
  timeoutMs = 3000,
): Promise<void> {
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
  return Promise.race([push(freshCity), timeout]).then(() => {
    reload()
  })
}
