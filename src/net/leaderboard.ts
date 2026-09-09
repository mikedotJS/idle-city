/**
 * Reads and writes the global board.
 *
 * The `leaderboard` table on the Based project carries the `shared` access
 * policy: every signed-in caller reads every row, but each caller can only
 * create, update or delete the row `user_id` forces to be their own. Neither
 * of Based's other two policies can do this — `owner-scoped` also scopes
 * *reads* to the caller's own row (nobody could see the board), and
 * `public-read` restricts writes to the project's single owner account (no
 * player could publish their own score). `shared` was added to Based
 * specifically for this table.
 */

import { scoreOf } from '../sim/score'
import type { CityState } from '../sim/types'
import type { BasedClient, BasedUser } from './based'

export const BOARD_TABLE = 'leaderboard'

/** Column names arrive camelCased: Based derives them from the SQLite schema. */
export interface BoardEntry {
  id: string
  userId: string
  cityName: string
  score: number
  happiness: number
  population: number
  income: number
  buildings: number
  ownedTiles: number
  updatedAt?: number
}

export interface Leaderboard {
  readonly configured: boolean
  getUser(): BasedUser | null
  onChange(listener: (user: BasedUser | null) => void): void
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  ready(): Promise<void>
  top(limit?: number): Promise<BoardEntry[]>
  /** Publishes the city's current score, replacing this player's entry. */
  publish(state: CityState, cityName: string): Promise<BoardEntry>
}

export function createLeaderboard(client: BasedClient): Leaderboard {
  return {
    configured: client.configured,
    getUser: () => client.getUser(),
    onChange: (listener) => client.onChange(listener),
    ready: () => client.ready(),
    signIn: async (email, password) => {
      await client.signIn(email, password)
    },
    signUp: async (email, password) => {
      await client.signUp(email, password)
    },
    signOut: () => client.signOut(),

    async top(limit = 20) {
      const { data } = await client.list<BoardEntry>(BOARD_TABLE, { limit })
      return data.slice().sort((a, b) => b.score - a.score)
    },

    async publish(state: CityState, cityName: string) {
      const user = client.getUser()
      if (!user) throw new Error('Sign in to publish a score')

      const score = scoreOf(state)
      const row = {
        cityName: cityName.trim().slice(0, 24) || 'Unnamed city',
        score: score.value,
        happiness: score.happiness,
        population: score.population,
        income: score.income,
        buildings: score.buildings,
        ownedTiles: score.ownedTiles,
      }

      // One row per player. The id is asked of the server rather than derived
      // from the user id, because PUT creates when missing: a deterministic id
      // would let anyone claim another player's row before they first publish,
      // and ownership would then lock the rightful owner out permanently.
      const mine = await client.list<BoardEntry>(BOARD_TABLE, { userId: user.id, limit: 1 })
      const existing = mine.data[0]

      return existing
        ? client.upsert<BoardEntry>(BOARD_TABLE, existing.id, row)
        : client.create<BoardEntry>(BOARD_TABLE, row)
    },
  }
}
