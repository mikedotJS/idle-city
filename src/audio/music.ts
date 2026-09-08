/**
 * Continuous background music: four generated tracks played in a shuffled
 * cycle, each crossfading into the next.
 *
 * Crossfading rather than looping one track is not decoration. A generated
 * track has an ending, not a loop point, so looping one would put an audible
 * seam in the room every three minutes. Overlapping two different takes hides
 * the seam completely and stops the ear from learning the pattern.
 *
 * Audio streams through HTMLAudioElement rather than decodeAudioData: a
 * decoded three-minute stereo track is roughly 30 MB of PCM, and four of them
 * would cost more memory than the entire rest of the game.
 */

const CROSSFADE_SECONDS = 8

/** How far before the crossfade the next track starts buffering. */
const PRELOAD_LEAD_SECONDS = 25

/** Shape of the equal-power crossfade curve. */
const CURVE_POINTS = 64

const STORAGE_KEY = 'micro-city-music'

export interface Track {
  src: string
  title: string
}

export const TRACKS: Track[] = [
  { src: 'music/take-1.mp3', title: 'Morning Errands' },
  { src: 'music/take-2.mp3', title: 'Tidy Streets' },
  { src: 'music/take-3.mp3', title: 'Long Afternoon' },
  { src: 'music/take-4.mp3', title: 'Low Sun' },
]

export interface MusicState {
  enabled: boolean
  /** 0..1, independent of the enabled flag. */
  volume: number
  nowPlaying: string | null
  /**
   * True when playback is wanted but the browser has not yet allowed it.
   * Every browser blocks audio until the page has been interacted with, so
   * this is the normal state on load, not an error.
   */
  waitingForGesture: boolean
}

export interface Music {
  setEnabled(enabled: boolean): void
  setVolume(volume: number): void
  /** Call from any real user gesture. Safe to call repeatedly. */
  unlock(): void
  subscribe(listener: (state: MusicState) => void): void
  getState(): MusicState
  dispose(): void
}

interface Voice {
  element: HTMLAudioElement
  gain: GainNode
  loaded: boolean
}

/** Equal power, so the perceived loudness holds steady through the overlap. */
function crossfadeCurve(rising: boolean): Float32Array {
  const curve = new Float32Array(CURVE_POINTS)
  for (let i = 0; i < CURVE_POINTS; i++) {
    const t = i / (CURVE_POINTS - 1)
    curve[i] = rising ? Math.sin((t * Math.PI) / 2) : Math.cos((t * Math.PI) / 2)
  }
  return curve
}

const RISING = crossfadeCurve(true)
const FALLING = crossfadeCurve(false)

function shuffled<T>(items: T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function loadPreference(): { enabled: boolean; volume: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as { enabled?: unknown; volume?: unknown }
      return {
        enabled: typeof saved.enabled === 'boolean' ? saved.enabled : true,
        volume: typeof saved.volume === 'number' ? Math.min(1, Math.max(0, saved.volume)) : 0.55,
      }
    }
  } catch {
    // A blocked or unavailable localStorage is not a reason to have no music.
  }
  return { enabled: true, volume: 0.55 }
}

export function createMusic(tracks: Track[] = TRACKS): Music {
  const preference = loadPreference()
  let enabled = preference.enabled
  let volume = preference.volume
  let disposed = false

  const order = shuffled(tracks.map((_, i) => i))
  let position = 0
  let active: Voice | null = null
  let activeTitle: string | null = null
  let crossfading = false
  let preloadedNext: Voice | null = null

  let context: AudioContext | null = null
  let master: GainNode | null = null
  const voices = new Map<number, Voice>()
  const listeners: ((state: MusicState) => void)[] = []

  function state(): MusicState {
    return {
      enabled,
      volume,
      nowPlaying: enabled ? activeTitle : null,
      waitingForGesture: enabled && context?.state !== 'running',
    }
  }

  function emit(): void {
    const snapshot = state()
    for (const listener of listeners) listener(snapshot)
  }

  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, volume }))
    } catch {
      // Preference is a convenience; failing to store it changes nothing now.
    }
  }

  function ensureContext(): AudioContext | null {
    if (context) return context
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    context = new Ctor()
    master = context.createGain()
    master.gain.value = volume
    master.connect(context.destination)
    return context
  }

  function voiceFor(trackIndex: number): Voice | null {
    const ctx = ensureContext()
    if (!ctx || !master) return null

    const existing = voices.get(trackIndex)
    if (existing) return existing

    const element = new Audio()
    element.src = `${import.meta.env.BASE_URL}${tracks[trackIndex].src}`
    element.preload = 'none'
    element.crossOrigin = 'anonymous'
    element.hidden = true
    // Attached rather than detached: some engines will garbage-collect a
    // detached media element while it is still playing, which kills the track
    // mid-bar for no visible reason. Being in the DOM also makes playback
    // state inspectable from devtools.
    document.body.appendChild(element)

    const gain = ctx.createGain()
    gain.gain.value = 0
    // A MediaElementSource may only be created once per element, so the voice
    // is built once and reused for every time this track comes round again.
    ctx.createMediaElementSource(element).connect(gain)
    gain.connect(master)

    const voice: Voice = { element, gain, loaded: false }
    voices.set(trackIndex, voice)
    return voice
  }

  function startVoice(voice: Voice, gainValue: number): void {
    if (!context) return
    voice.gain.gain.cancelScheduledValues(context.currentTime)
    voice.gain.gain.setValueAtTime(gainValue, context.currentTime)
    voice.element.currentTime = 0
    void voice.element.play().catch(() => {
      // Rejected play means the gesture has not landed yet; unlock() retries.
    })
  }

  function beginCrossfade(): void {
    if (!context || !active || crossfading) return
    crossfading = true

    position = (position + 1) % order.length
    const nextVoice = preloadedNext ?? voiceFor(order[position])
    preloadedNext = null
    if (!nextVoice) return

    const now = context.currentTime
    active.gain.gain.cancelScheduledValues(now)
    active.gain.gain.setValueCurveAtTime(FALLING, now, CROSSFADE_SECONDS)

    startVoice(nextVoice, 0)
    nextVoice.gain.gain.setValueCurveAtTime(RISING, now, CROSSFADE_SECONDS)

    const outgoing = active
    window.setTimeout(() => {
      outgoing.element.pause()
      crossfading = false
    }, CROSSFADE_SECONDS * 1000)

    active = nextVoice
    activeTitle = tracks[order[position]].title
    emit()
  }

  /** Watches the playhead rather than scheduling ahead, because a streamed
   *  element's duration is not known until its metadata arrives. */
  const timer = window.setInterval(() => {
    if (disposed || !enabled || !active || crossfading) return
    const { duration, currentTime } = active.element
    if (!Number.isFinite(duration) || duration <= 0) return

    const remaining = duration - currentTime
    if (remaining <= CROSSFADE_SECONDS) {
      beginCrossfade()
      return
    }
    if (remaining <= CROSSFADE_SECONDS + PRELOAD_LEAD_SECONDS && !preloadedNext) {
      const upcoming = voiceFor(order[(position + 1) % order.length])
      if (upcoming && !upcoming.loaded) {
        upcoming.loaded = true
        upcoming.element.preload = 'auto'
        upcoming.element.load()
      }
      preloadedNext = upcoming
    }
  }, 250)

  function play(): void {
    const ctx = ensureContext()
    if (!ctx) return
    if (!active) {
      const voice = voiceFor(order[position])
      if (!voice) return
      voice.loaded = true
      voice.element.preload = 'auto'
      active = voice
      activeTitle = tracks[order[position]].title
      startVoice(voice, 1)
    } else {
      void active.element.play().catch(() => {})
    }
    emit()
  }

  function unlock(): void {
    if (disposed || !enabled) return
    const ctx = ensureContext()
    if (!ctx) return
    if (ctx.state !== 'running') void ctx.resume().then(play, () => {})
    else play()
  }

  return {
    setEnabled(next: boolean): void {
      if (enabled === next) return
      enabled = next
      persist()
      if (enabled) unlock()
      else {
        for (const voice of voices.values()) voice.element.pause()
        active = null
        activeTitle = null
        crossfading = false
        preloadedNext = null
      }
      emit()
    },

    setVolume(next: number): void {
      volume = Math.min(1, Math.max(0, next))
      persist()
      if (master && context) {
        master.gain.cancelScheduledValues(context.currentTime)
        master.gain.linearRampToValueAtTime(volume, context.currentTime + 0.08)
      }
      emit()
    },

    unlock,
    subscribe(listener) {
      listeners.push(listener)
      listener(state())
    },
    getState: state,

    dispose(): void {
      disposed = true
      window.clearInterval(timer)
      for (const voice of voices.values()) {
        voice.element.pause()
        voice.element.src = ''
        voice.element.remove()
      }
      voices.clear()
      void context?.close()
    },
  }
}
