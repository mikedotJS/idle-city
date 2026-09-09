/**
 * Friend codes: a launcher button, and a small panel to see your own code,
 * add someone else's, and see who you've confirmed, who added you, and who
 * you're still waiting on.
 *
 * Shares its sign-in state with the leaderboard rather than asking again —
 * both wrap the same Based session (see main.ts). Signed out, the panel
 * just points at the Leaderboard button instead of duplicating a sign-in
 * form nobody wants to fill in twice.
 */

import type { Friends } from '../net/friends'
import type { BasedUser } from '../net/based'

export interface FriendsUI {
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

export function createFriendsUI(
  root: HTMLElement,
  friends: Friends,
  onCountChange: (confirmedCount: number) => void,
): FriendsUI {
  if (!friends.configured) {
    return { dispose: () => {} }
  }

  // ------------------------------------------------------------------ button

  const launcher = el('section', 'panel panel--friends-launch')
  const openButton = el('button', 'btn btn--ghost', 'Friends')
  openButton.type = 'button'
  launcher.append(openButton)

  // ------------------------------------------------------------------- modal

  const overlay = el('div', 'overlay')
  overlay.hidden = true
  const card = el('section', 'panel panel--board')

  const headingRow = el('div', 'board__heading')
  const heading = el('h2', 'board__title', 'Friends')
  const infoBadge = el('span', 'board__info', 'i')
  infoBadge.title =
    'Each confirmed friend nudges your income up a little. Add someone by their code, and they need to add yours back before it counts.'
  infoBadge.tabIndex = 0
  headingRow.append(heading, infoBadge)

  const signedOutNote = el(
    'p',
    'board__status',
    'Sign in from the Leaderboard panel first — friends use the same account.',
  )

  const codeRow = el('div', 'board__account')
  const codeLabel = el('span', 'board__who', '')
  const copyButton = el('button', 'btn btn--ghost', 'Copy my code')
  copyButton.type = 'button'
  codeRow.append(codeLabel, copyButton)

  const addRow = el('form', 'board__publish')
  const codeInput = document.createElement('input')
  codeInput.type = 'text'
  codeInput.placeholder = 'Paste a friend code'
  codeInput.className = 'board__input'
  const addButton = el('button', 'btn btn--primary', 'Add friend')
  addButton.type = 'submit'
  const addNote = el('p', 'hint')
  addRow.append(codeInput, addButton, addNote)

  const incomingHeading = el('p', 'board__status', '')
  const incomingList = el('ol', 'board__list')
  const confirmedHeading = el('p', 'board__status', '')
  const confirmedList = el('ol', 'board__list')

  const closeButton = el('button', 'btn btn--ghost', 'Back to the city')
  closeButton.type = 'button'

  card.append(
    headingRow,
    signedOutNote,
    codeRow,
    addRow,
    incomingHeading,
    incomingList,
    confirmedHeading,
    confirmedList,
    closeButton,
  )
  overlay.append(card)
  root.append(launcher, overlay)

  // ------------------------------------------------------------------- state

  let user: BasedUser | null = null
  let busy = false

  function paint(): void {
    const signedIn = user !== null
    signedOutNote.hidden = signedIn
    codeRow.hidden = !signedIn
    addRow.hidden = !signedIn
    incomingHeading.hidden = !signedIn
    incomingList.hidden = !signedIn
    confirmedHeading.hidden = !signedIn
    confirmedList.hidden = !signedIn
    if (signedIn) codeLabel.textContent = `Your code: ${friends.myCode()}`
  }

  function renderIds(list: HTMLOListElement, ids: string[]): void {
    list.replaceChildren()
    for (const id of ids) {
      // No directory to turn an id into a name, so the code itself is the
      // label — the same one its owner copied out of their own panel.
      list.append(el('li', 'board__row', id))
    }
  }

  async function refresh(): Promise<void> {
    if (!user) {
      onCountChange(0)
      return
    }
    try {
      const { confirmed, incoming } = await friends.list()
      confirmedHeading.textContent = confirmed.length
        ? `Friends (${confirmed.length})`
        : 'No confirmed friends yet.'
      renderIds(confirmedList, confirmed)
      incomingHeading.textContent = incoming.length
        ? `Added you — add them back to confirm (${incoming.length})`
        : ''
      renderIds(incomingList, incoming)
      onCountChange(confirmed.length)
    } catch (error) {
      confirmedHeading.textContent = `Could not load friends: ${(error as Error).message}`
    }
  }

  // ----------------------------------------------------------------- wiring

  openButton.addEventListener('click', () => {
    overlay.hidden = false
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
  window.addEventListener('keydown', onKey, true)

  copyButton.addEventListener('click', () => {
    const code = friends.myCode()
    if (!code) return
    navigator.clipboard?.writeText(code).catch(() => {
      // Clipboard access can be denied; the code is selectable text either way.
    })
  })

  addRow.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy) return
    busy = true
    addButton.disabled = true
    addNote.textContent = 'Adding...'
    try {
      await friends.add(codeInput.value)
      codeInput.value = ''
      addNote.textContent = 'Added. If they add you back too, they’ll show up as confirmed.'
      await refresh()
    } catch (error) {
      addNote.textContent = `Could not add: ${(error as Error).message}`
    } finally {
      busy = false
      addButton.disabled = false
    }
  })

  friends.onChange((next) => {
    user = next
    paint()
    // Always refresh, not just while the panel is open — the confirmed count
    // drives the income bonus even when nobody's looking at this panel.
    void refresh()
  })

  paint()

  return {
    dispose(): void {
      window.removeEventListener('keydown', onKey, true)
      launcher.remove()
      overlay.remove()
    },
  }
}
