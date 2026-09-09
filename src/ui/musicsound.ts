/**
 * Music and sound-effect controls: two identical toggle+volume panels for
 * two independent decisions (hear the score, hear the city). Split out of
 * hud.ts so it can be placed by the new shell (ui/shell.ts) instead of
 * hud.ts's own hud__zone--tr.
 */

import './musicsound.css'

import type { MusicState } from '../audio/music'
import type { SfxState } from '../audio/sfx'

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

function setText(node: HTMLElement, value: string): void {
  if (node.textContent !== value) node.textContent = value
}

export interface MusicSoundCallbacks {
  onToggleMusic(): void
  onMusicVolume(volume: number): void
  onToggleSfx(): void
  onSfxVolume(volume: number): void
}

export interface MusicSoundControls {
  /** The whole music+sound block, ready to be placed by a caller. */
  element: HTMLElement
  setMusicState(state: MusicState): void
  setSfxState(state: SfxState): void
}

export function createMusicSoundControls(callbacks: MusicSoundCallbacks): MusicSoundControls {
  const wrap = el('div', 'musicsound-root')

  // ------------------------------------------------------------------- music

  const musicPanel = el('section', 'panel panel--music')
  const musicRow = el('div', 'music__row')
  const musicButton = el('button', 'music__toggle')
  musicButton.type = 'button'
  musicButton.addEventListener('click', () => callbacks.onToggleMusic())
  const musicTitle = el('span', 'music__title')
  musicRow.append(musicButton, musicTitle)

  const musicVolume = document.createElement('input')
  musicVolume.type = 'range'
  musicVolume.className = 'music__volume'
  musicVolume.min = '0'
  musicVolume.max = '100'
  musicVolume.step = '1'
  musicVolume.setAttribute('aria-label', 'Music volume')
  musicVolume.addEventListener('input', () => {
    callbacks.onMusicVolume(Number(musicVolume.value) / 100)
  })

  musicPanel.append(musicRow, musicVolume)
  wrap.append(musicPanel)

  // ------------------------------------------------------------------- sound

  const soundPanel = el('section', 'panel panel--sound')
  const soundRow = el('div', 'sound__row')
  const soundButton = el('button', 'sound__toggle')
  soundButton.type = 'button'
  soundButton.addEventListener('click', () => callbacks.onToggleSfx())
  const soundTitle = el('span', 'sound__title', 'Sound effects')
  soundRow.append(soundButton, soundTitle)

  const soundVolume = document.createElement('input')
  soundVolume.type = 'range'
  soundVolume.className = 'sound__volume'
  soundVolume.min = '0'
  soundVolume.max = '100'
  soundVolume.step = '1'
  soundVolume.setAttribute('aria-label', 'Sound effects volume')
  soundVolume.addEventListener('input', () => {
    callbacks.onSfxVolume(Number(soundVolume.value) / 100)
  })

  soundPanel.append(soundRow, soundVolume)
  wrap.append(soundPanel)

  // ------------------------------------------------------------------- state

  let musicSignature = ''
  let sfxSignature = ''

  function setMusicState(music: MusicState): void {
    // The waiting state is the normal state on load, not a failure: browsers
    // block audio until the page has been interacted with.
    const label = !music.enabled
      ? 'Music off'
      : music.waitingForGesture
        ? 'Click anywhere to start the music'
        : (music.nowPlaying ?? 'Music on')
    const signature = `${music.enabled}|${label}|${music.volume}`
    if (signature === musicSignature) return
    musicSignature = signature

    setText(musicButton, music.enabled ? 'Music on' : 'Music off')
    musicButton.className = music.enabled ? 'music__toggle is-on' : 'music__toggle'
    musicButton.setAttribute('aria-pressed', String(music.enabled))
    setText(musicTitle, music.enabled ? label : '')
    musicPanel.classList.toggle('is-muted', !music.enabled)
    if (document.activeElement !== musicVolume) {
      musicVolume.value = String(Math.round(music.volume * 100))
    }
  }

  function setSfxState(sfx: SfxState): void {
    const label = !sfx.enabled
      ? 'Sound off'
      : sfx.waitingForGesture
        ? 'Click anywhere to start'
        : 'Sound on'
    const signature = `${sfx.enabled}|${label}|${sfx.volume}`
    if (signature === sfxSignature) return
    sfxSignature = signature

    setText(soundButton, sfx.enabled ? 'Sound on' : 'Sound off')
    soundButton.className = sfx.enabled ? 'sound__toggle is-on' : 'sound__toggle'
    soundButton.setAttribute('aria-pressed', String(sfx.enabled))
    setText(soundTitle, sfx.enabled ? label : 'Sound effects')
    soundPanel.classList.toggle('is-muted', !sfx.enabled)
    if (document.activeElement !== soundVolume) {
      soundVolume.value = String(Math.round(sfx.volume * 100))
    }
  }

  return { element: wrap, setMusicState, setSfxState }
}
