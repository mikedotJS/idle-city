/**
 * Spatial sound design: short one-shots for what the city just did, plus
 * looping ambience that lives at the tile of every factory, landfill, park,
 * harbour and station currently standing.
 *
 * Positional, not stereo-panned-by-hand: every voice is a Web Audio
 * PannerNode in HRTF mode, placed at the world coordinate of the tile (or
 * parcel) it belongs to, and the listener is moved every frame to the
 * orbiting camera's own position and facing. Orbit past a factory and its hum
 * genuinely sweeps across the stereo field; that is the entire point of doing
 * this in Web Audio instead of decorating an HTMLAudioElement with left/right
 * gain.
 *
 * One-shots ride the same event log the activity panel already reads —
 * `state.events` — rather than a second notification path bolted onto every
 * call site in main.ts. `built`/`upgraded`/`derelict`/`recovered`/`demolished`
 * /`land` already say exactly what happened and where; this module just
 * listens. The one placement the log does not carry is a manual one (factory,
 * park, school, harbour, station, landfill — the buildings the player places
 * by hand never call recordEvent), so main.ts calls playPlacement() itself
 * right after a successful placeManual().
 *
 * A shared convolution reverb gives the whole board one small, consistent
 * room rather than each voice sounding like it was recorded in a different
 * booth — and, like every geometry in render/buildings.ts, its impulse
 * response is generated in code rather than shipped as an asset.
 *
 * No decodeAudioData budget problem here the way music.ts has one: these
 * clips are all under three seconds, so the whole catalogue decoded stays
 * under a couple of megabytes of PCM and can simply live in memory for the
 * life of the tab.
 */

import { PARCELS_PER_SIDE, PARCEL_SIZE, WORLD_SIZE } from '../sim/config'
import type { CityEvent } from '../sim/events'
import { tileToWorld } from '../sim/grid'
import type { BuildingType, CityState } from '../sim/types'
import { clampDuration, silenceRange } from './trim'

const STORAGE_KEY = 'micro-city-sfx'

/**
 * A dev-only trace of what actually played, keyed on window rather than
 * exposed through the Sfx interface. There is no DOM node a Playwright check
 * can inspect the way audio-check.mjs inspects music's <audio> elements — a
 * PannerNode leaves no trace in the page — so this is scripts/sfx-check.mjs's
 * only window into whether a click actually triggered a voice. Capped so a
 * long dev session does not grow it forever.
 */
const DEV_LOG_LIMIT = 200
const devLog: string[] | null = import.meta.env.DEV ? [] : null
if (devLog) (window as unknown as { __sfxPlayed: string[] }).__sfxPlayed = devLog
function logPlay(entry: string): void {
  if (!devLog) return
  devLog.push(entry)
  if (devLog.length > DEV_LOG_LIMIT) devLog.splice(0, devLog.length - DEV_LOG_LIMIT)
}

/** Nominal height a tile's emitter sits at — a building, not the ground plate. */
const EMITTER_Y = 0.3

/** How long the shared room's tail rings for. A toy city, not a cathedral. */
const REVERB_SECONDS = 0.9
const REVERB_SEND = 0.16

/** Fade in/out for an ambient loop starting or stopping, so nothing clicks. */
const AMBIENT_FADE = 0.5

type OneShotKey =
  | 'ui_click'
  | 'build_pop'
  | 'level_up'
  | 'place_industrial'
  | 'place_amenity'
  | 'place_harbour'
  | 'place_station'
  | 'demolish'
  | 'buy_land'
  | 'dereliction_onset'
  | 'dereliction_recover'
  | 'toast'
  | 'prestige'

type AmbientKey = 'amb_factory' | 'amb_park' | 'amb_water' | 'amb_station'

type SoundKey = OneShotKey | AmbientKey

interface SoundDef {
  src: string
  /**
   * Linear gain at 1x sfx volume, chosen to bring this specific clip's own
   * peak level up (or down) to a common target for its category — see the
   * measurement note below. Not a hand-picked "sounds about right": ElevenLabs
   * generated these seventeen clips independently, with no shared mastering
   * pass, and their peaks alone span -24 dB to 0 dB — a raw 16x range before
   * anything here even runs.
   */
  gain: number
  /** Positional (HRTF, at a tile/parcel) or fixed at the listener (UI, toasts). */
  spatial: boolean
  /** Cap on playable length after silence is trimmed. Ambient loops play whole. */
  maxDurationSec?: number
  /** +/- fraction of playbackRate jittered per play, so a repeated cue is not identical every time. */
  rateJitter?: number
}

/**
 * Every `gain` below is `10^((target - measuredPeakDb) / 20)`, not a guess:
 * decode each clip in a real AudioContext and read its peak sample, then
 * solve for the multiplier that puts it at the category's target. The first
 * pass here used flat multipliers close to 1 on the assumption the clips
 * were already roughly comparable, and they were not — the factory ambience
 * measured -0.8 dBFS peak against the park's -21.8 dBFS, a 21 dB gap that no
 * plausible per-building "narrative" multiplier was ever going to close, and
 * the factory drowned everything else out. Peak rather than RMS, because RMS
 * penalises a clip like the park's for having silence between birdsong the
 * way a continuous machinery drone does not, and boosting to match a
 * continuous clip's RMS would have driven the sparse one's noise floor up
 * along with it.
 *
 * Two targets, not one: -14 dBFS for anything meant to sit in the
 * background (a toast chime, the ambient beds — several of which can play
 * at once if the player builds several factories), -6 dBFS for a one-shot
 * that has to read as a distinct event, and -3 dBFS for the one moment the
 * game treats as a fanfare.
 */
const SOUNDS: Record<SoundKey, SoundDef> = {
  ui_click: { src: 'sfx/ui_click.mp3', gain: 3.16, spatial: false, maxDurationSec: 0.35, rateJitter: 0.06 },
  build_pop: { src: 'sfx/build_pop.mp3', gain: 5.96, spatial: true, maxDurationSec: 0.6, rateJitter: 0.08 },
  level_up: { src: 'sfx/level_up.mp3', gain: 0.56, spatial: true, maxDurationSec: 1.4 },
  place_industrial: { src: 'sfx/place_industrial.mp3', gain: 0.5, spatial: true, maxDurationSec: 1.3 },
  place_amenity: { src: 'sfx/place_amenity.mp3', gain: 1.06, spatial: true, maxDurationSec: 1.1 },
  place_harbour: { src: 'sfx/place_harbour.mp3', gain: 0.5, spatial: true, maxDurationSec: 1.6 },
  place_station: { src: 'sfx/place_station.mp3', gain: 0.51, spatial: true, maxDurationSec: 1.6 },
  demolish: { src: 'sfx/demolish.mp3', gain: 0.56, spatial: true, maxDurationSec: 1.0 },
  buy_land: { src: 'sfx/buy_land.mp3', gain: 0.58, spatial: true, maxDurationSec: 1.3 },
  dereliction_onset: { src: 'sfx/dereliction_onset.mp3', gain: 0.58, spatial: true, maxDurationSec: 1.1 },
  dereliction_recover: { src: 'sfx/dereliction_recover.mp3', gain: 1.8, spatial: true, maxDurationSec: 1.1 },
  toast: { src: 'sfx/toast.mp3', gain: 0.68, spatial: false, maxDurationSec: 0.6 },
  prestige: { src: 'sfx/prestige.mp3', gain: 0.77, spatial: false, maxDurationSec: 2.4 },
  amb_factory: { src: 'sfx/amb_factory.mp3', gain: 0.22, spatial: true },
  amb_park: { src: 'sfx/amb_park.mp3', gain: 2.45, spatial: true },
  amb_water: { src: 'sfx/amb_water.mp3', gain: 0.84, spatial: true },
  amb_station: { src: 'sfx/amb_station.mp3', gain: 0.2, spatial: true },
}

/** Which one-shot a manual placement plays. House/shop never reach this — they are queue-placed and get build_pop off the event log instead. */
function placementSoundFor(type: BuildingType): OneShotKey {
  switch (type) {
    case 'factory':
    case 'landfill':
      return 'place_industrial'
    case 'harbour':
      return 'place_harbour'
    case 'station':
      return 'place_station'
    default:
      return 'place_amenity' // park, school
  }
}

/**
 * Ambient bed per building type, and a small narrative adjustment on top of
 * the measured, already-levelled gain in SOUNDS — this is deliberately a
 * modest multiplier around 1.0, not a second loudness pass. A landfill's
 * reach is 1.8 tiles against a factory's 3.5, so it should not carry as far
 * either; nothing else here has a reason to differ much from the others.
 */
const AMBIENT_FOR: Partial<Record<BuildingType, { key: AmbientKey; gain: number; detune: number }>> = {
  factory: { key: 'amb_factory', gain: 1, detune: 0 },
  // Shares the factory drone rather than a dedicated asset — it is the same
  // family of machinery sound — but pitched down and quieter so it reads as
  // duller, smaller plant, not a second factory standing on the same tile.
  landfill: { key: 'amb_factory', gain: 0.6, detune: -320 },
  park: { key: 'amb_park', gain: 0.85, detune: 0 },
  harbour: { key: 'amb_water', gain: 0.9, detune: 0 },
  station: { key: 'amb_station', gain: 0.85, detune: 0 },
}

export interface SfxState {
  enabled: boolean
  /** 0..1, independent of the enabled flag. */
  volume: number
  waitingForGesture: boolean
}

export interface Sfx {
  setEnabled(enabled: boolean): void
  setVolume(volume: number): void
  /** Call from any real user gesture. Safe to call repeatedly. */
  unlock(): void
  subscribe(listener: (state: SfxState) => void): void
  getState(): SfxState
  /**
   * Call every frame: advances the event log, keeps ambient loops matched to
   * whatever is currently standing, and moves the listener to the camera.
   */
  update(state: CityState, pose: ListenerPoseLike): void
  /** Manual placement never appears in the event log; called right after a successful placeManual(). */
  playPlacement(type: BuildingType, tile: number): void
  playToast(): void
  playPrestige(): void
  playClick(): void
  dispose(): void
}

/**
 * Duplicated rather than imported from render/api.ts: audio/ has no business
 * depending on render/, even for a type. Structurally identical, so
 * main.ts's ListenerPose satisfies this without a cast.
 */
export interface ListenerPoseLike {
  x: number
  y: number
  z: number
  fx: number
  fy: number
  fz: number
  ux: number
  uy: number
  uz: number
}

interface Voice {
  source: AudioBufferSourceNode
  gain: GainNode
}

function loadPreference(): { enabled: boolean; volume: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as { enabled?: unknown; volume?: unknown }
      return {
        enabled: typeof saved.enabled === 'boolean' ? saved.enabled : true,
        volume: typeof saved.volume === 'number' ? Math.min(1, Math.max(0, saved.volume)) : 0.6,
      }
    }
  } catch {
    // A blocked or unavailable localStorage is not a reason to have no sound.
  }
  return { enabled: true, volume: 0.6 }
}

/** World-space centre of a parcel, by the same offset tileToWorld uses for a tile. */
function parcelToWorld(parcel: number): { x: number; z: number } {
  const px = parcel % PARCELS_PER_SIDE
  const pz = Math.floor(parcel / PARCELS_PER_SIDE)
  const offset = (WORLD_SIZE - 1) / 2
  return {
    x: px * PARCEL_SIZE + (PARCEL_SIZE - 1) / 2 - offset,
    z: pz * PARCEL_SIZE + (PARCEL_SIZE - 1) / 2 - offset,
  }
}

/**
 * A small synthesised room: white noise through an exponential amplitude
 * decay. No file, no fetch — generated once at startup exactly the way every
 * building in render/buildings.ts is generated geometry rather than an asset.
 */
function makeReverbImpulse(ctx: AudioContext): AudioBuffer {
  const length = Math.max(1, Math.round(ctx.sampleRate * REVERB_SECONDS))
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      const decay = Math.pow(1 - i / length, 2.6)
      data[i] = (Math.random() * 2 - 1) * decay
    }
  }
  return buffer
}

export function createSfx(): Sfx {
  const preference = loadPreference()
  let enabled = preference.enabled
  let volume = preference.volume
  let disposed = false

  let context: AudioContext | null = null
  let master: GainNode | null = null
  let reverbSend: GainNode | null = null
  let reverbConvolver: ConvolverNode | null = null

  const buffers = new Map<SoundKey, AudioBuffer | Promise<AudioBuffer | null> | null>()
  const ambientVoices = new Map<number, { key: AmbientKey; voice: Voice }>()
  /** Tiles with an ambient load in flight, so reconcileAmbience — which runs
   *  every frame — does not start a second, third, fourth voice for the same
   *  tile while the first is still decoding. */
  const pendingAmbient = new Set<number>()
  /** The last event this module has already sounded out. See processEvents(). */
  let eventCursor: CityEvent | null = null
  /** True once the first live-context update() has run and baselined eventCursor/ambience. */
  let baselined = false

  const listeners: ((state: SfxState) => void)[] = []

  function state(): SfxState {
    return { enabled, volume, waitingForGesture: enabled && context?.state !== 'running' }
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

    reverbConvolver = context.createConvolver()
    reverbConvolver.buffer = makeReverbImpulse(context)
    reverbConvolver.normalize = true
    reverbSend = context.createGain()
    reverbSend.gain.value = REVERB_SEND
    reverbSend.connect(reverbConvolver)
    reverbConvolver.connect(master)

    return context
  }

  /** Decode once per sound key, cached; concurrent requests for the same key share one fetch. */
  async function loadBuffer(key: SoundKey): Promise<AudioBuffer | null> {
    const ctx = context
    if (!ctx) return null
    const existing = buffers.get(key)
    if (existing) return existing instanceof Promise ? existing : existing

    const def = SOUNDS[key]
    const promise = (async (): Promise<AudioBuffer | null> => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}${def.src}`)
        const raw = await response.arrayBuffer()
        const decoded = await ctx.decodeAudioData(raw)
        return trimmed(ctx, decoded, def.maxDurationSec)
      } catch {
        // A missing or undecodable clip should never break the game; it just
        // stays silent, the same way a blocked AudioContext does.
        return null
      }
    })()
    buffers.set(key, promise)
    const resolved = await promise
    buffers.set(key, resolved)
    return resolved
  }

  /**
   * Silence-trimmed at both ends, always — a generated clip routinely opens
   * and closes on a beat of near-nothing. One-shots additionally get a hard
   * duration cap with a short fade into the cut, because a "0.4 second pop"
   * prompt occasionally comes back several seconds long and a one-shot that
   * long stops feeling instant.
   *
   * Ambient loops (no maxDurationSec) get silence trimmed and nothing else:
   * a loop wraps back to its own start every cycle, and fading its tail to
   * zero would turn that wrap into an audible dip instead of removing one.
   */
  function trimmed(ctx: AudioContext, buffer: AudioBuffer, maxDurationSec?: number): AudioBuffer {
    const channels: Float32Array[] = []
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch))

    const range = silenceRange(channels, -42)
    const fadeSamples = maxDurationSec === undefined ? 0 : Math.round(0.06 * buffer.sampleRate)
    const { start, end, fadeStart } =
      maxDurationSec === undefined
        ? { start: range[0], end: range[1], fadeStart: range[1] }
        : clampDuration(range, Math.round(maxDurationSec * buffer.sampleRate), fadeSamples)

    const length = Math.max(1, end - start)
    const out = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate)
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = channels[ch]
      const dst = out.getChannelData(ch)
      for (let i = 0; i < length; i++) {
        const sample = i + start
        let value = src[sample] ?? 0
        if (sample >= fadeStart) {
          const t = (sample - fadeStart) / Math.max(1, end - fadeStart)
          value *= 1 - t
        }
        dst[i] = value
      }
    }
    return out
  }

  function makePanner(ctx: AudioContext, x: number, z: number): PannerNode {
    const panner = ctx.createPanner()
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'inverse'
    panner.refDistance = 2.2
    panner.rolloffFactor = 1.1
    panner.maxDistance = 60
    if (panner.positionX) {
      panner.positionX.value = x
      panner.positionY.value = EMITTER_Y
      panner.positionZ.value = z
    } else {
      // Older Safari: setPosition is the only API.
      ;(panner as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(
        x,
        EMITTER_Y,
        z,
      )
    }
    return panner
  }

  /** Play a one-shot; a no-op if muted, not yet unlocked, or the clip failed to load. */
  function playOneShot(key: OneShotKey, at: { x: number; z: number } | null): void {
    if (!enabled) return
    const ctx = ensureContext()
    if (!ctx || !master || !reverbSend) return
    if (ctx.state !== 'running') return // waiting for a gesture; unlock() retries nothing here on purpose — the next real gesture calls unlock()

    void loadBuffer(key).then((buffer) => {
      if (!buffer || disposed || !context || !master || !reverbSend) return
      const def = SOUNDS[key]
      const source = context.createBufferSource()
      source.buffer = buffer
      if (def.rateJitter) {
        source.playbackRate.value = 1 + (Math.random() * 2 - 1) * def.rateJitter
      }

      const gain = context.createGain()
      gain.gain.value = def.gain
      source.connect(gain)

      if (def.spatial && at) {
        const panner = makePanner(context, at.x, at.z)
        gain.connect(panner)
        panner.connect(master)
        panner.connect(reverbSend)
      } else {
        gain.connect(master)
      }

      source.start()
      source.addEventListener('ended', () => source.disconnect())
      logPlay(`oneshot:${key}${def.spatial && at ? `@${at.x.toFixed(1)},${at.z.toFixed(1)}` : ''}`)
    })
  }

  function tileWorld(tile: number): { x: number; z: number } {
    return tileToWorld(tile)
  }

  /** What happened, and where, translated into a one-shot. Mirrors ui/activity.ts's reading of the same log. */
  function soundForEvent(event: CityEvent): { key: OneShotKey; at: { x: number; z: number } } | null {
    switch (event.kind) {
      case 'built':
        return { key: 'build_pop', at: tileWorld(event.where) }
      case 'upgraded':
        return { key: 'level_up', at: tileWorld(event.where) }
      case 'derelict':
        return { key: 'dereliction_onset', at: tileWorld(event.where) }
      case 'recovered':
        return { key: 'dereliction_recover', at: tileWorld(event.where) }
      case 'demolished':
        return { key: 'demolish', at: tileWorld(event.where) }
      case 'land':
        return { key: 'buy_land', at: parcelToWorld(event.where) }
      default:
        return null
    }
  }

  /**
   * Walks state.events for anything since the last processed event, by
   * object identity rather than array index — the log is a bounded ring
   * (EVENT_LIMIT in sim/events.ts) that splices from the front, so an index
   * cursor would silently point at the wrong entry the moment it evicts. A
   * city replaced wholesale (restart, import, retire, or a fresh page load)
   * hands this a state.events array that never contains the old cursor by
   * reference, which this treats the same as "nothing has happened since the
   * last frame" rather than replaying a stranger's history as sound.
   */
  function processEvents(state: CityState): void {
    const events = state.events
    if (events.length === 0) {
      eventCursor = null
      return
    }
    if (eventCursor === null) {
      eventCursor = events[events.length - 1]
      return
    }
    let index = -1
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i] === eventCursor) {
        index = i
        break
      }
    }
    if (index === -1) {
      eventCursor = events[events.length - 1]
      return
    }
    for (let i = index + 1; i < events.length; i++) {
      const sound = soundForEvent(events[i])
      if (sound) playOneShot(sound.key, sound.at)
    }
    eventCursor = events[events.length - 1]
  }

  function stopAmbient(tile: number): void {
    const entry = ambientVoices.get(tile)
    if (!entry) return
    ambientVoices.delete(tile)
    logPlay(`ambient-stop:${entry.key}@tile${tile}`)
    const ctx = context
    if (!ctx) return
    const now = ctx.currentTime
    entry.voice.gain.gain.cancelScheduledValues(now)
    entry.voice.gain.gain.setValueAtTime(entry.voice.gain.gain.value, now)
    entry.voice.gain.gain.linearRampToValueAtTime(0, now + AMBIENT_FADE)
    const source = entry.voice.source
    window.setTimeout(() => {
      try {
        source.stop()
      } catch {
        // Already stopped.
      }
    }, AMBIENT_FADE * 1000 + 50)
  }

  function startAmbient(tile: number, ambient: { key: AmbientKey; gain: number; detune: number }): void {
    const ctx = context
    if (!ctx || !master || !reverbSend) return
    // reconcileAmbience calls this every frame for any wanted tile not yet in
    // ambientVoices, and the load below is async — without this guard, every
    // frame between "wanted" and "decoded" would start one more voice on the
    // same tile.
    if (pendingAmbient.has(tile)) return
    pendingAmbient.add(tile)
    const { x, z } = tileToWorld(tile)

    void loadBuffer(ambient.key).then((buffer) => {
      pendingAmbient.delete(tile)
      if (!buffer || disposed || !context || !master || !reverbSend) return
      // The building may have been demolished, or replaced, while this
      // decoded; reconcileAmbience will have already stopped a stale entry,
      // but it can only do that for a tile that made it into ambientVoices.
      if (ambientVoices.has(tile)) return

      const source = context.createBufferSource()
      source.buffer = buffer
      source.loop = true
      source.detune.value = ambient.detune

      const gain = context.createGain()
      const target = ambient.gain * SOUNDS[ambient.key].gain
      gain.gain.value = 0
      const now = context.currentTime
      gain.gain.linearRampToValueAtTime(target, now + AMBIENT_FADE)

      const panner = makePanner(context, x, z)
      source.connect(gain)
      gain.connect(panner)
      panner.connect(master)
      panner.connect(reverbSend)
      source.start()

      ambientVoices.set(tile, { key: ambient.key, voice: { source, gain } })
      logPlay(`ambient-start:${ambient.key}@tile${tile}`)
    })
  }

  /** Match the set of looping ambient voices to whatever factory/landfill/park/harbour/station tiles currently stand. */
  function reconcileAmbience(state: CityState): void {
    const wanted = new Map<number, { key: AmbientKey; gain: number; detune: number }>()
    for (let tile = 0; tile < state.grid.length; tile++) {
      const building = state.grid[tile]
      if (!building) continue
      const ambient = AMBIENT_FOR[building.type]
      if (ambient) wanted.set(tile, ambient)
    }

    for (const [tile, entry] of ambientVoices) {
      if (wanted.get(tile)?.key !== entry.key) stopAmbient(tile)
    }
    for (const [tile, ambient] of wanted) {
      if (!ambientVoices.has(tile)) startAmbient(tile, ambient)
    }
  }

  function updateListener(pose: ListenerPoseLike): void {
    const ctx = context
    if (!ctx) return
    const listener = ctx.listener
    if (listener.positionX) {
      listener.positionX.value = pose.x
      listener.positionY.value = pose.y
      listener.positionZ.value = pose.z
      listener.forwardX.value = pose.fx
      listener.forwardY.value = pose.fy
      listener.forwardZ.value = pose.fz
      listener.upX.value = pose.ux
      listener.upY.value = pose.uy
      listener.upZ.value = pose.uz
    } else {
      const legacy = listener as unknown as {
        setPosition(x: number, y: number, z: number): void
        setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void
      }
      legacy.setPosition(pose.x, pose.y, pose.z)
      legacy.setOrientation(pose.fx, pose.fy, pose.fz, pose.ux, pose.uy, pose.uz)
    }
  }

  // The sim freezes whenever the tab is hidden; a dozen looping ambient
  // sources have no reason to keep the audio thread busy while nobody can
  // hear them, so this suspends alongside it rather than inventing its own
  // separate idea of "away".
  function onVisibilityChange(): void {
    if (!context) return
    if (document.hidden) void context.suspend()
    else if (enabled) void context.resume().then(emit, () => {})
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  function unlock(): void {
    if (disposed || !enabled) return
    const ctx = ensureContext()
    if (!ctx) return
    if (ctx.state !== 'running') void ctx.resume().then(emit, () => {})
    else emit()
  }

  function update(cityState: CityState, pose: ListenerPoseLike): void {
    if (disposed) return
    const ctx = context
    // No context yet means sound has never been unlocked — nothing to track.
    // Deliberately not gated on ctx.state === 'running' beyond this: a muted
    // or backgrounded tab still needs its event cursor to keep pace with the
    // city, or the moment sound resumes it would replay everything the city
    // did while quiet as one burst of sound. playOneShot() is what actually
    // gates on being audible right now; this only gates on being trackable.
    if (!ctx) return

    if (!baselined) {
      // First live frame: adopt whatever is already on the board as ambience
      // and treat every event so far as already "heard" — sound starts now,
      // it does not replay the last several minutes the moment it unlocks.
      baselined = true
      eventCursor = cityState.events[cityState.events.length - 1] ?? null
    }

    processEvents(cityState)
    reconcileAmbience(cityState)
    updateListener(pose)
  }

  function playPlacement(type: BuildingType, tile: number): void {
    playOneShot(placementSoundFor(type), tileWorld(tile))
  }

  return {
    setEnabled(next: boolean): void {
      if (enabled === next) return
      enabled = next
      persist()
      if (enabled) {
        unlock()
      } else if (context) {
        for (const [tile] of ambientVoices) stopAmbient(tile)
        void context.suspend()
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
    update,
    playPlacement,
    playToast(): void {
      playOneShot('toast', null)
    },
    playPrestige(): void {
      playOneShot('prestige', null)
    },
    playClick(): void {
      playOneShot('ui_click', null)
    },

    dispose(): void {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      for (const [tile] of ambientVoices) stopAmbient(tile)
      pendingAmbient.clear()
      void context?.close()
    },
  }
}
