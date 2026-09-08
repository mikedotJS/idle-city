/**
 * A tiny REST client for Based, written by hand rather than pulled from
 * `@weirdscience/based-client`: that package's React imports sit at the top
 * level of its bundle, so importing `createClient` would drag React into a
 * three.js game that has none.
 *
 * Two details of the wire protocol are easy to get wrong and silent when you
 * do, so they are enforced here rather than left to call sites:
 *
 * 1. `apikey` and `Authorization` are mutually exclusive. The server checks the
 *    anon key FIRST and short-circuits with `user = null`, so sending both
 *    downgrades a signed-in caller to anonymous with no error at all.
 * 2. Row fields travel in camelCase. Based discovers tables from SQLite and
 *    camelCases the column names, so a body with `city_name` is rejected for a
 *    missing `cityName` — a field you believe you just sent.
 */

const SESSION_KEY = 'micro-city-based-session'

export interface BasedConfig {
  url: string
  anonKey: string
}

export interface BasedUser {
  id: string
  email: string
}

interface StoredSession {
  accessToken: string
  refreshToken: string
  user: BasedUser
}

export interface ListResult<T> {
  data: T[]
  total: number
}

export class BasedError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'BasedError'
  }
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

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredSession>
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.user?.id) return null
    return parsed as StoredSession
  } catch {
    return null
  }
}

function writeStored(session: StoredSession | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // A blocked localStorage costs the player a re-login, nothing more.
  }
}

export function createBasedClient(config: Partial<BasedConfig>): BasedClient {
  const url = (config.url ?? '').replace(/\/+$/, '')
  const anonKey = config.anonKey ?? ''
  const configured = url.length > 0 && anonKey.length > 0

  let session: StoredSession | null = configured ? readStored() : null
  const listeners: ((user: BasedUser | null) => void)[] = []

  function emit(): void {
    const user = session?.user ?? null
    for (const listener of listeners) listener(user)
  }

  function setSession(next: StoredSession | null): void {
    session = next
    writeStored(next)
    emit()
  }

  async function parse(res: Response): Promise<unknown> {
    const body = (await res.json().catch(() => null)) as
      | { data?: unknown; total?: number; error?: { code?: string; message?: string } }
      | null

    if (!res.ok) {
      throw new BasedError(
        body?.error?.message ?? `Request failed (${res.status})`,
        body?.error?.code ?? 'UNKNOWN',
        res.status,
      )
    }
    return body
  }

  /** Exactly one credential header, never both. See the note at the top. */
  function headers(withBody: boolean): Headers {
    const h = new Headers()
    if (session) h.set('Authorization', `Bearer ${session.accessToken}`)
    else h.set('apikey', anonKey)
    if (withBody) h.set('Content-Type', 'application/json')
    return h
  }

  async function refresh(): Promise<boolean> {
    if (!session) return false
    const res = await fetch(`${url}/auth/refresh`, {
      method: 'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    }).catch(() => null)

    if (!res || !res.ok) {
      setSession(null)
      return false
    }
    const body = (await res.json()) as { data: { accessToken: string; refreshToken: string } }
    setSession({ ...session, ...body.data })
    return true
  }

  async function request(path: string, init: RequestInit = {}, retry = true): Promise<unknown> {
    if (!configured) {
      throw new BasedError('No backend configured', 'NOT_CONFIGURED', 0)
    }
    const res = await fetch(`${url}${path}`, {
      ...init,
      headers: headers(init.body !== undefined),
    })

    // One retry, and only when a session existed to refresh — otherwise a 401
    // on an anonymous call would loop.
    if (res.status === 401 && retry && session) {
      if (await refresh()) return request(path, init, false)
    }
    return parse(res)
  }

  async function authenticate(kind: 'signup' | 'signin', email: string, password: string) {
    if (!configured) throw new BasedError('No backend configured', 'NOT_CONFIGURED', 0)
    const res = await fetch(`${url}/auth/${kind}`, {
      method: 'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email, password }),
    })
    const body = (await parse(res)) as {
      data: { user: BasedUser; accessToken: string; refreshToken: string }
    }
    setSession(body.data)
    return body.data.user
  }

  /**
   * A stored session may have been revoked or expired while the tab was shut,
   * so it is validated against /auth/me before the UI trusts it.
   */
  const hydration: Promise<void> = (async () => {
    if (!configured || !session) return
    try {
      // /auth/me returns the user record directly under `data`, not wrapped.
      const body = (await request('/auth/me')) as { data: BasedUser }
      if (body.data?.id) setSession({ ...session, user: { id: body.data.id, email: body.data.email } })
      else setSession(null)
    } catch {
      setSession(null)
    }
  })()

  return {
    configured,
    getUser: () => session?.user ?? null,
    ready: () => hydration,
    signUp: (email, password) => authenticate('signup', email, password),
    signIn: (email, password) => authenticate('signin', email, password),

    async signOut() {
      const had = session
      setSession(null)
      if (!had) return
      await fetch(`${url}/auth/signout`, {
        method: 'POST',
        headers: new Headers({
          Authorization: `Bearer ${had.accessToken}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ refreshToken: had.refreshToken }),
      }).catch(() => {
        // The local session is already gone; a failed server call is cosmetic.
      })
    },

    async list<T>(table: string, params: Record<string, string | number> = {}) {
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) query.set(key, String(value))
      const suffix = query.toString() ? `?${query}` : ''
      const body = (await request(`/api/${table}${suffix}`)) as { data: T[]; total: number }
      return { data: body.data ?? [], total: body.total ?? 0 }
    },

    async create<T>(table: string, row: Record<string, unknown>) {
      const body = (await request(`/api/${table}`, {
        method: 'POST',
        body: JSON.stringify(row),
      })) as { data: T }
      return body.data
    },

    async upsert<T>(table: string, id: string, row: Record<string, unknown>) {
      const body = (await request(`/api/${table}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(row),
      })) as { data: T }
      return body.data
    },

    onChange(listener) {
      listeners.push(listener)
      listener(session?.user ?? null)
    },
  }
}
