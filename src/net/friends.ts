/**
 * Friend codes and the mutual friends list.
 *
 * The `friends` table carries the same `shared` policy as the leaderboard:
 * every signed-in caller reads every row, but each caller can only create
 * rows `user_id` forces to be their own. A row (userId: A, friendId: B) means
 * "A added B" — nothing more. Friendship is symmetric by construction rather
 * than by a status column: B only counts as a *confirmed* friend of A once B
 * has also added A, i.e. once both rows exist. That's what keeps a friendship
 * mutual without needing to let A write to B's row, which `shared` doesn't
 * allow — the same constraint the leaderboard's design comment explains.
 *
 * There's no directory to look someone up by email — Based doesn't expose
 * one, and building one is a bigger, privacy-sensitive change. Instead each
 * player's own user id doubles as their "friend code": share it out of band,
 * and whoever has it can add you.
 */

import type { BasedClient, BasedUser } from './based'

export const FRIENDS_TABLE = 'friends'

/** Column names arrive camelCased: Based derives them from the SQLite schema. */
export interface FriendRow {
  id: string
  userId: string
  friendId: string
}

export interface FriendsList {
  /** Both sides have added each other. */
  confirmed: string[]
  /** They added you; you haven't added them back yet. */
  incoming: string[]
  /** You added them; they haven't added you back yet. */
  outgoing: string[]
}

export interface Friends {
  readonly configured: boolean
  getUser(): BasedUser | null
  onChange(listener: (user: BasedUser | null) => void): void
  /** The code to share so someone else can add you. Null when signed out. */
  myCode(): string | null
  list(): Promise<FriendsList>
  /** Adds (or accepts) a friend by their code. A no-op if already added. */
  add(code: string): Promise<void>
}

export function createFriends(client: BasedClient): Friends {
  return {
    configured: client.configured,
    getUser: () => client.getUser(),
    onChange: (listener) => client.onChange(listener),
    myCode: () => client.getUser()?.id ?? null,

    async list() {
      const user = client.getUser()
      if (!user) return { confirmed: [], incoming: [], outgoing: [] }

      const [mine, theirs] = await Promise.all([
        client.list<FriendRow>(FRIENDS_TABLE, { userId: user.id, limit: 100 }),
        client.list<FriendRow>(FRIENDS_TABLE, { friendId: user.id, limit: 100 }),
      ])
      const added = new Set(mine.data.map((row) => row.friendId))
      const addedBy = new Set(theirs.data.map((row) => row.userId))

      const confirmed: string[] = []
      const outgoing: string[] = []
      for (const id of added) {
        ;(addedBy.has(id) ? confirmed : outgoing).push(id)
      }
      const incoming = [...addedBy].filter((id) => !added.has(id))

      return { confirmed, incoming, outgoing }
    },

    async add(code) {
      const user = client.getUser()
      if (!user) throw new Error('Sign in to add a friend')

      const friendId = code.trim()
      if (!friendId) throw new Error('Enter a friend code')
      if (friendId === user.id) throw new Error('That’s your own code')

      const mine = await client.list<FriendRow>(FRIENDS_TABLE, {
        userId: user.id,
        friendId,
        limit: 1,
      })
      if (mine.data.length > 0) return // already added — treat it as success

      await client.create<FriendRow>(FRIENDS_TABLE, { friendId })
    },
  }
}
