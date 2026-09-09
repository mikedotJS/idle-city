/**
 * The cloud copy of the running city: one row per signed-in player, so a
 * city started on one device shows up on the next one that signs into the
 * same account.
 *
 * The `cities` table carries Based's `owner-scoped` policy — unlike the
 * leaderboard and friends tables, nobody else has any business reading or
 * writing this, so there is no need for `shared`'s "everyone reads, only
 * your own row writes" shape. The row's id is the player's own user id:
 * one player, one row, no lookup needed to find it.
 *
 * The city itself is stored exactly as the existing "Export city" feature
 * already serializes one (see sim/transfer.ts's `exportCity`/`cityFromJson`)
 * — a plain JSON blob in a text column, not a second, parallel encoding of
 * the same city.
 *
 * When no backend is configured, or nobody is signed in, every call here is
 * a no-op: the game is unaffected, exactly like the leaderboard and friends
 * panels today.
 */

import { cityFromJson } from '../sim/save'
import { exportCity } from '../sim/transfer'
import type { CityState } from '../sim/types'
import type { BasedClient, BasedUser } from './based'

export const CITY_TABLE = 'cities'

interface CityRow {
  id: string
  city: string
}

export interface CitySync {
  readonly configured: boolean
  getUser(): BasedUser | null
  onChange(listener: (user: BasedUser | null) => void): void
  /** The signed-in caller's cloud city, or null if they have none yet. */
  pull(): Promise<CityState | null>
  /** Upserts the caller's own city row. Silent on failure — a missed push
   * just retries on the next save, same as the leaderboard's autopublish. */
  push(state: CityState): Promise<void>
}

export function createCitySync(client: BasedClient): CitySync {
  return {
    configured: client.configured,
    getUser: () => client.getUser(),
    onChange: (listener) => client.onChange(listener),

    async pull() {
      const user = client.getUser()
      if (!client.configured || !user) return null
      try {
        const { data } = await client.list<CityRow>(CITY_TABLE, { id: user.id, limit: 1 })
        const row = data[0]
        if (!row) return null
        return cityFromJson(JSON.parse(row.city))
      } catch {
        // A city that failed to load from the cloud is not a corrupt local
        // city — keep whatever is already running.
        return null
      }
    },

    async push(state) {
      const user = client.getUser()
      if (!client.configured || !user) return
      try {
        await client.upsert<CityRow>(CITY_TABLE, user.id, { city: exportCity(state) })
      } catch {
        // See above — a background miss isn't worth surfacing.
      }
    },
  }
}
