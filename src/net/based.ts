/**
 * A thin adapter over `@weirdscience/based-client/core` — the project's own
 * hand-rolled REST client used to live here instead, because the package's
 * main entry point carries React at the top of its bundle, which a
 * three.js game with no React has no business pulling in. As of 0.6.1 the
 * package ships a dependency-free `/core` subpath (verified: zero `react`
 * references in its output), so the two wire-protocol details that used to be
 * hand-enforced here — the `apikey`/`Authorization` mutual exclusivity, and
 * the PUT-based upsert semantics — are now the SDK's problem, not this
 * file's.
 *
 * This file exists at all because the app's `BasedClient` shape is narrower
 * than the SDK's: a flat `list(table, params)` bag instead of `{filter,
 * limit, offset, order}`, a synchronous `getUser()`, and an `onChange`
 * that (unlike the SDK's own `subscribe`) calls the listener immediately
 * with the current user on registration. Keeping that shape means
 * `leaderboard.ts` and `ui/leaderboard.ts` don't need to change at all.
 */

import { createClient, BasedError } from '@weirdscience/based-client/core'
import type { AuthUser } from '@weirdscience/based-client/core'

export { BasedError }

const SESSION_KEY = 'micro-city-based-session'

export interface BasedConfig {
  url: string
  anonKey: string
}

export interface BasedUser {
  id: string
  email: string
}

export interface ListResult<T> {
  data: T[]
  total: number
}

export interface BasedClient {
  /** False when no backend is configured; every call then fails fast. */
  readonly configured: boolean
  getUser(): BasedUser | null
  /** Resolves once a stored session has been restored and validated. */
  ready(): Promise<void>
  signUp(email: string, password: string): Promise<BasedUser>
  signIn(email: string, password: string): Promise<BasedUser>
  signOut(): Promise<void>
  list<T>(table: string, params?: Record<string, string | number>): Promise<ListResult<T>>
  create<T>(table: string, row: Record<string, unknown>): Promise<T>
  /** PUT /api/:table/:id — creates when missing, updates when present. */
  upsert<T>(table: string, id: string, row: Record<string, unknown>): Promise<T>
  onChange(listener: (user: BasedUser | null) => void): void
}

function toBasedUser(user: AuthUser | null): BasedUser | null {
  return user ? { id: user.id, email: user.email } : null
}

/**
 * The app's `list()` takes a flat params bag (it grew that way to cover two
 * call sites: `{limit}` and `{userId, limit}`), while the SDK wants
 * `{filter, limit, offset, order}`. `limit`/`offset`/`order` are pulled out
 * by name; everything else becomes a filter clause.
 */
function splitParams(params: Record<string, string | number>) {
  const filter: Record<string, string | number> = {}
  let limit: number | undefined
  let offset: number | undefined
  let order: string | undefined
  for (const [key, value] of Object.entries(params)) {
    if (key === 'limit') limit = Number(value)
    else if (key === 'offset') offset = Number(value)
    else if (key === 'order') order = String(value)
    else filter[key] = value
  }
  return { filter, limit, offset, order }
}

function notConfigured(): never {
  throw new BasedError('NOT_CONFIGURED', 'No backend configured', 0)
}

export function createBasedClient(config: Partial<BasedConfig>): BasedClient {
  const url = (config.url ?? '').replace(/\/+$/, '')
  const anonKey = config.anonKey ?? ''
  const configured = url.length > 0 && anonKey.length > 0

  if (!configured) {
    return {
      configured: false,
      getUser: () => null,
      ready: () => Promise.resolve(),
      async signUp() {
        return notConfigured()
      },
      async signIn() {
        return notConfigured()
      },
      async signOut() {},
      async list<T>() {
        return notConfigured() as ListResult<T>
      },
      async create<T>() {
        return notConfigured() as T
      },
      async upsert<T>() {
        return notConfigured() as T
      },
      onChange: (listener) => listener(null),
    }
  }

  const sdk = createClient({ url, anonKey, storageKey: SESSION_KEY })

  return {
    configured: true,
    getUser: () => toBasedUser(sdk.getState().user),
    ready: () => sdk.ready(),

    async signUp(email, password) {
      return toBasedUser(await sdk.auth.signUp(email, password)) as BasedUser
    },

    async signIn(email, password) {
      return toBasedUser(await sdk.auth.signIn(email, password)) as BasedUser
    },

    signOut: () => sdk.auth.signOut(),

    async list<T>(table: string, params: Record<string, string | number> = {}) {
      const { filter, limit, offset, order } = splitParams(params)
      const result = await sdk.from(table).select({ filter, limit, offset, order } as never)
      return result as unknown as ListResult<T>
    },

    async create<T>(table: string, row: Record<string, unknown>) {
      const result = await sdk.from(table).insert(row)
      return result as unknown as T
    },

    async upsert<T>(table: string, id: string, row: Record<string, unknown>) {
      const result = await sdk.from(table).update(id, row)
      return result as unknown as T
    },

    onChange(listener) {
      listener(toBasedUser(sdk.getState().user))
      sdk.subscribe(() => listener(toBasedUser(sdk.getState().user)))
    },
  }
}
