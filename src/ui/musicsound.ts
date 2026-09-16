/**
 * Music and sound-effect controls: two identical toggle+volume rows for two
 * independent decisions (hear the score, hear the city). Split out of hud.ts
 * so it can be placed by the new shell (ui/shell.ts) instead of hud.ts's own
 * hud__zone--tr.
 *
 * Row shape follows the approved Design Canvas mockup (MoreSheet.dc.html):
 * a fixed-width toggle button beside a fixed-width volume slider, nothing
 * else in the row. No small text label explaining what the row does — the
 * section heading ("Sound") already says that, and a per-row label was
 * called out as clutter during mockup review. The toggle button's own text
 * names the control ("Music" / "Sound effects"); its enabled/disabled state
 * shows through color (`.is-on`) rather than through changing that text, so
 * both buttons keep one fixed width regardless of state. The richer status
 * ("Click anywhere to start the music", the current track name) still
 * exists — as the button's `title` tooltip and `aria-label`, not as visible
 * row furniture.
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

function buildVolumeSlider(ariaLabel: string): HTMLInputElement {
  const slider = document.createElement('input')
  slider.type = 'range'
  slider.className = 'toggle-row__slider'
  slider.min = '0'
  slider.max = '100'
  slider.step = '1'
  slider.setAttribute('aria-label', ariaLabel)
  return slider
}

export function createMusicSoundControls(callbacks: MusicSoundCallbacks): MusicSoundControls {
  const wrap = el('div', 'musicsound-root')

  // ------------------------------------------------------------------- music

  const musicPanel = el('section', 'panel panel--music')
  const musicRow = el('div', 'toggle-row')
  const musicButton = el('button', 'toggle-row__btn', 'Music')
  musicButton.type = 'button'
  musicButton.addEventListener('click', () => callbacks.onToggleMusic())

  const musicVolume = buildVolumeSlider('Music volume')
  musicVolume.addEventListener('input', () => {
    callbacks.onMusicVolume(Number(musicVolume.value) / 100)
  })

  musicRow.append(musicButton, musicVolume)
  musicPanel.append(musicRow)
  wrap.append(musicPanel)

  // ------------------------------------------------------------------- sound

  const soundPanel = el('section', 'panel panel--sound')
  const soundRow = el('div', 'toggle-row')
  const soundButton = el('button', 'toggle-row__btn', 'Sound effects')
  soundButton.type = 'button'
  soundButton.addEventListener('click', () => callbacks.onToggleSfx())

  const soundVolume = buildVolumeSlider('Sound effects volume')
  soundVolume.addEventListener('input', () => {
    callbacks.onSfxVolume(Number(soundVolume.value) / 100)
  })

  soundRow.append(soundButton, soundVolume)
  soundPanel.append(soundRow)
  wrap.append(soundPanel)

  // ------------------------------------------------------------------- state

  let musicSignature = ''
  let sfxSignature = ''

  function setMusicState(music: MusicState): void {
    // The waiting state is the normal state on load, not a failure: browsers
    // block audio until the page has been interacted with.
    const status = !music.enabled
      ? 'Music off'
      : music.waitingForGesture
        ? 'Click anywhere to start the music'
        : (music.nowPlaying ?? 'Music on')
    const signature = `${music.enabled}|${status}|${music.volume}`
    if (signature === musicSignature) return
    musicSignature = signature

    musicButton.classList.toggle('is-on', music.enabled)
    musicButton.setAttribute('aria-pressed', String(music.enabled))
    musicButton.title = status
    musicButton.setAttribute('aria-label', `Music: ${status}`)
    musicPanel.classList.toggle('is-muted', !music.enabled)
    if (document.activeElement !== musicVolume) {
      musicVolume.value = String(Math.round(music.volume * 100))
    }
  }

  function setSfxState(sfx: SfxState): void {
    const status = !sfx.enabled
      ? 'Sound off'
      : sfx.waitingForGesture
        ? 'Click anywhere to start'
        : 'Sound on'
    const signature = `${sfx.enabled}|${status}|${sfx.volume}`
    if (signature === sfxSignature) return
    sfxSignature = signature

    soundButton.classList.toggle('is-on', sfx.enabled)
    soundButton.setAttribute('aria-pressed', String(sfx.enabled))
    soundButton.title = status
    soundButton.setAttribute('aria-label', `Sound effects: ${status}`)
    soundPanel.classList.toggle('is-muted', !sfx.enabled)
    if (document.activeElement !== soundVolume) {
      soundVolume.value = String(Math.round(sfx.volume * 100))
    }
  }

  return { element: wrap, setMusicState, setSfxState }
}
