/**
 * The global board: a button in the corner, and a modal holding either a sign-in
 * form or the standings.
 *
 * It lives outside hud.ts on purpose. The HUD is the readout for a city that is
 * always there; this is an occasional overlay that talks to a network, and
 * folding it in would have meant a fourth round of widening `HudCallbacks` for
 * something the board can own entirely by itself.
 *
 * When no backend is configured the whole thing stays out of the DOM, so the
 * static build on GitHub Pages is unaffected by a server it cannot reach.
 */

import type { Leaderboard, BoardEntry } from '../net/leaderboard'
import type { BasedUser } from '../net/based'
import type { CityState } from '../sim/types'
import { scoreOf } from '../sim/score'
import { formatCoins } from './format'

const CITY_NAME_KEY = 'micro-city-name'

export interface LeaderboardUI {
  dispose(): void
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function savedCityName(): string {
  try {
    return localStorage.getItem(CITY_NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

export function createLeaderboardUI(
  root: HTMLElement,
  board: Leaderboard,
  getState: () => CityState,
): LeaderboardUI {
  if (!board.configured) {
    return { dispose: () => {} }
  }

  // ------------------------------------------------------------------ button

  const launcher = el('section', 'panel panel--board-launch')
  const openButton = el('button', 'btn btn--primary', 'Leaderboard')
  openButton.type = 'button'
  const launcherNote = el('p', 'hint', 'Sign in to publish your city.')
  launcher.append(openButton, launcherNote)

  // ------------------------------------------------------------------- modal

  const overlay = el('div', 'overlay')
  overlay.hidden = true
  const card = el('section', 'panel panel--board')

  const headingRow = el('div', 'board__heading')
  const heading = el('h2', 'board__title', 'World leaderboard')
  const infoBadge = el('span', 'board__info', 'i')
  infoBadge.title =
    'Ranked by happiness x population x income. Every factor grows with time, so a long session outranks a tidy plan.'
  infoBadge.tabIndex = 0
  headingRow.append(heading, infoBadge)

  // Auth form
  const form = el('form', 'board__auth')
  const email = document.createElement('input')
  email.type = 'email'
  email.required = true
  email.placeholder = 'you@example.com'
  email.autocomplete = 'email'
  email.className = 'board__input'
  const password = document.createElement('input')
  password.type = 'password'
  password.required = true
  password.minLength = 8
  password.placeholder = 'Password (8+ characters)'
  password.autocomplete = 'current-password'
  password.className = 'board__input'

  const submitButton = el('button', 'btn btn--primary', 'Sign in')
  submitButton.type = 'submit'
  const switchButton = el('button', 'btn btn--ghost', 'Create an account instead')
  switchButton.type = 'button'
  const authError = el('p', 'board__error')
  authError.hidden = true

  form.append(email, password, submitButton, switchButton, authError)

  // Signed-in area
  const account = el('div', 'board__account')
  account.hidden = true
  const accountWho = el('span', 'board__who')
  const signOutButton = el('button', 'btn btn--ghost', 'Sign out')
  signOutButton.type = 'button'
  account.append(accountWho, signOutButton)

  const publishRow = el('div', 'board__publish')
  publishRow.hidden = true
  const cityName = document.createElement('input')
  cityName.type = 'text'
  cityName.maxLength = 24
  cityName.placeholder = 'Name your city'
  cityName.className = 'board__input'
  cityName.value = savedCityName()
  const publishButton = el('button', 'btn btn--primary', 'Publish my score')
  publishButton.type = 'button'
  const publishNote = el('p', 'hint')
  publishRow.append(cityName, publishButton, publishNote)

  const list = el('ol', 'board__list')
  const status = el('p', 'board__status', 'Sign in to see the board.')

  const closeButton = el('button', 'btn btn--ghost', 'Back to the city')
  closeButton.type = 'button'

  card.append(headingRow, form, account, publishRow, status, list, closeButton)
  overlay.append(card)
  root.append(launcher, overlay)

  // ------------------------------------------------------------------- state

  let mode: 'signin' | 'signup' = 'signin'
  let user: BasedUser | null = null
  let busy = false

  function setError(message: string | null): void {
    authError.textContent = message ?? ''
    authError.hidden = !message
  }

  function paintAuth(): void {
    const signedIn = user !== null
    form.hidden = signedIn
    account.hidden = !signedIn
    publishRow.hidden = !signedIn
    if (signedIn) accountWho.textContent = user!.email
    submitButton.textContent = mode === 'signin' ? 'Sign in' : 'Create account'
    switchButton.textContent =
      mode === 'signin' ? 'Create an account instead' : 'I already have an account'
    password.autocomplete = mode === 'signin' ? 'current-password' : 'new-password'
    launcherNote.textContent = signedIn
      ? `Signed in as ${user!.email}`
      : 'Sign in to publish your city.'
  }

  function renderRows(entries: BoardEntry[]): void {
    list.replaceChildren()
    if (entries.length === 0) {
      status.textContent = 'Nobody has published a city yet. Be first.'
      return
    }
    status.textContent = ''
    for (const [index, entry] of entries.entries()) {
      const row = el('li', 'board__row')
      if (user && entry.userId === user.id) row.classList.add('is-me')
      row.append(
        el('span', 'board__rank', String(index + 1)),
        el('span', 'board__city', entry.cityName),
        el('span', 'board__score', formatCoins(entry.score)),
        el(
          'span',
          'board__detail',
          `${Math.round(entry.happiness * 100)}% · ${entry.population} people · ${entry.income.toFixed(1)}/s`,
        ),
      )
      list.append(row)
    }
  }

  async function refresh(): Promise<void> {
    if (!user) {
      list.replaceChildren()
      status.textContent = 'Sign in to see the board.'
      return
    }
    status.textContent = 'Loading the board...'
    try {
      renderRows(await board.top(20))
    } catch (error) {
      status.textContent = `Could not load the board: ${(error as Error).message}`
    }
  }

  function previewScore(): string {
    const score = scoreOf(getState())
    return `Your city scores ${formatCoins(score.value)} right now.`
  }

  // ----------------------------------------------------------------- wiring

  openButton.addEventListener('click', () => {
    overlay.hidden = false
    setError(null)
    publishNote.textContent = previewScore()
    void refresh()
  })

  function close(): void {
    overlay.hidden = true
  }
  closeButton.addEventListener('click', close)
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close()
  })

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !overlay.hidden) {
      event.stopPropagation()
      close()
    }
  }
  // Capture, so Escape closes the modal before the game clears the held tool.
  window.addEventListener('keydown', onKey, true)

  switchButton.addEventListener('click', () => {
    mode = mode === 'signin' ? 'signup' : 'signin'
    setError(null)
    paintAuth()
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy) return
    busy = true
    setError(null)
    submitButton.disabled = true
    try {
      if (mode === 'signin') await board.signIn(email.value, password.value)
      else await board.signUp(email.value, password.value)
      password.value = ''
    } catch (error) {
      setError((error as Error).message)
    } finally {
      busy = false
      submitButton.disabled = false
    }
  })

  signOutButton.addEventListener('click', async () => {
    await board.signOut()
  })

  publishButton.addEventListener('click', async () => {
    if (busy) return
    busy = true
    publishButton.disabled = true
    publishNote.textContent = 'Publishing...'
    try {
      const entry = await board.publish(getState(), cityName.value)
      try {
        localStorage.setItem(CITY_NAME_KEY, entry.cityName)
      } catch {
        // Remembering the name is a convenience, not part of publishing.
      }
      cityName.value = entry.cityName
      publishNote.textContent = `Published ${entry.cityName} at ${formatCoins(entry.score)}.`
      await refresh()
    } catch (error) {
      publishNote.textContent = `Could not publish: ${(error as Error).message}`
    } finally {
      busy = false
      publishButton.disabled = false
    }
  })

  board.onChange((next) => {
    user = next
    paintAuth()
    if (!overlay.hidden) void refresh()
  })

  void board.ready().then(() => paintAuth())
  paintAuth()

  return {
    dispose(): void {
      window.removeEventListener('keydown', onKey, true)
      launcher.remove()
      overlay.remove()
    },
  }
}
