/**
 * The whole visual identity of the diorama lives here: colour ramps, the
 * day/night keyframes and a handful of easing helpers.
 *
 * Everything in this file is authored in sRGB (the space the hex literals in
 * sim/buildings.ts are written in) and only converted to the renderer's linear
 * working space at the last moment, via `setSrgb`. Interpolating in sRGB keeps
 * the ramp looking the way it was picked; interpolating in linear space would
 * pull the midpoints darker and muddy the sage-to-taupe transition, which is
 * exactly the part of the picture that has to stay readable.
 */

import { Color, SRGBColorSpace } from 'three'

export type RGB = [number, number, number]

export function hexToRgb(hex: number): RGB {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255]
}

/** Write an sRGB triple into a Color, converting to the working colour space. */
export function setSrgb(out: Color, rgb: RGB): Color {
  return out.setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace)
}

export function mixRgb(a: RGB, b: RGB, t: number, out: RGB): RGB {
  out[0] = a[0] + (b[0] - a[0]) * t
  out[1] = a[1] + (b[1] - a[1]) * t
  out[2] = a[2] + (b[2] - a[2]) * t
  return out
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** Frame-rate independent exponential approach. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt)
}

const BACK_C1 = 1.70158
const BACK_C3 = BACK_C1 + 1

/** Overshoots slightly past 1 near the end, then settles. x is clamped to 0..1. */
export function easeOutBack(x: number): number {
  const t = clamp01(x)
  const u = t - 1
  return 1 + BACK_C3 * u * u * u + BACK_C1 * u * u
}

// ---------------------------------------------------------------------------
// Ground: the happiness ramp. This is the primary UI of the whole game.
// ---------------------------------------------------------------------------

/**
 * Five stops rather than two, so the ramp has a genuine neutral at the base
 * happiness of 0.5. A straight brown-to-green lerp puts an ambiguous olive at
 * the middle and the player cannot tell "untouched" from "slightly poisoned".
 * With a warm sand pinned at 0.5, any tile that has drifted reads immediately
 * as either warmer-green (a park is reaching it) or greyer (a factory is).
 */
const HAPPINESS_STOPS: { t: number; rgb: RGB }[] = [
  { t: 0.0, rgb: hexToRgb(0x6a615a) }, // dead grey-brown
  { t: 0.25, rgb: hexToRgb(0x8f8477) }, // taupe — the dereliction threshold
  { t: 0.5, rgb: hexToRgb(0xc2bda4) }, // warm sand — untouched ground
  { t: 0.75, rgb: hexToRgb(0xb0c497) }, // pale sage
  { t: 1.0, rgb: hexToRgb(0x9cbe86) }, // warm sage
]

const rampScratch: RGB = [0, 0, 0]

/** Happiness 0..1 to an sRGB triple. Writes into (and returns) a shared scratch. */
export function happinessRgb(h: number): RGB {
  const v = clamp01(h)
  let i = 0
  while (i < HAPPINESS_STOPS.length - 2 && v > HAPPINESS_STOPS[i + 1].t) i++
  const a = HAPPINESS_STOPS[i]
  const b = HAPPINESS_STOPS[i + 1]
  const t = (v - a.t) / (b.t - a.t)
  return mixRgb(a.rgb, b.rgb, clamp01(t), rampScratch)
}

/** Ground that has not been bought: flat, obviously inert. */
export const UNOWNED_GROUND = hexToRgb(0x7d7871)
/** The faint frame drawn around every unowned parcel. */
export const PARCEL_BORDER = 0xe8ddc8
/** The table the diorama sits on. Dark enough that tile seams read as lines. */
export const TABLE_COLOR = 0x5c554d
/** Hover frame. */
export const HIGHLIGHT_COLOR = 0xfff2d4
/** Blocked placement / demolish target. Muted terracotta, not a UI red. */
export const DANGER_COLOR = 0xd06a5c
/** Emission preview rings. */
export const RING_BAD = 0xc97a63
export const RING_GOOD = 0x86b48a
/** Lit windows after dark. */
export const WINDOW_GLOW = hexToRgb(0xffd9a0)
/** Derelict buildings are pulled towards this. */
export const DERELICT_TINT = hexToRgb(0x6f675f)

// ---------------------------------------------------------------------------
// Day / night
// ---------------------------------------------------------------------------

/** Seconds for a full dawn-to-dawn loop. */
export const DAY_LENGTH = 240
/** A brand new city (time 0) should open in mid-morning light, not at 3am. */
export const DAY_START = 0.34

export interface SkyKey {
  t: number
  sky: RGB
  sun: RGB
  sunIntensity: number
  hemiSky: RGB
  hemiGround: RGB
  hemiIntensity: number
  ambient: RGB
  ambientIntensity: number
  /** 0 in full day, 1 in full night. Drives window glow and the ground lift. */
  night: number
}

function key(
  t: number,
  sky: number,
  sun: number,
  sunIntensity: number,
  hemiSky: number,
  hemiGround: number,
  hemiIntensity: number,
  ambient: number,
  ambientIntensity: number,
  night: number,
): SkyKey {
  return {
    t,
    sky: hexToRgb(sky),
    sun: hexToRgb(sun),
    sunIntensity,
    hemiSky: hexToRgb(hemiSky),
    hemiGround: hexToRgb(hemiGround),
    hemiIntensity,
    ambient: hexToRgb(ambient),
    ambientIntensity,
    night,
  }
}

/**
 * t = 0 is midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
 *
 * The night entries are deliberately not dark. A literal night would drop the
 * ground tint below the point where sage and taupe are distinguishable, and the
 * tint is the game's only always-on readout. So night keeps a fairly generous
 * hemisphere + ambient floor and sells itself through hue (cool blue sky, warm
 * lit windows, long low moonlight) rather than through darkness.
 */
const SKY_KEYS: SkyKey[] = [
  //  t     sky       sun       sunI  hemiSky   hemiGnd   hemiI ambient   ambI  night
  key(0.0, 0x1c2338, 0xc9d0e2, 0.6, 0x5b6180, 0x2f2c33, 1.05, 0xa6a6ae, 0.8, 1.0),
  key(0.18, 0x2e3450, 0xccd2e2, 0.62, 0x646a8a, 0x33303a, 1.05, 0xa9a9b2, 0.78, 0.96),
  key(0.25, 0xd8a08a, 0xffc7a8, 1.7, 0xe9c8b6, 0x554b45, 1.05, 0xc0aea0, 0.55, 0.42),
  key(0.34, 0xd9e3e5, 0xfff0d6, 2.5, 0xdfeaee, 0x6d6558, 1.0, 0xf2ece2, 0.32, 0.04),
  key(0.5, 0xdfe9ec, 0xfff6e8, 2.8, 0xe4eef1, 0x6f6759, 1.05, 0xf6f1e6, 0.3, 0.0),
  key(0.66, 0xe6ded1, 0xffe9c4, 2.5, 0xeae0d2, 0x6c6252, 1.0, 0xf4ebdc, 0.32, 0.03),
  key(0.75, 0xeda87e, 0xffb894, 1.8, 0xf2c6ac, 0x594c44, 1.05, 0xc4b09c, 0.55, 0.4),
  key(0.84, 0x5a5070, 0xc0b4d0, 0.85, 0x76708e, 0x3a3541, 1.05, 0xaeaab8, 0.74, 0.86),
  key(1.0, 0x1c2338, 0xc9d0e2, 0.6, 0x5b6180, 0x2f2c33, 1.05, 0xa6a6ae, 0.8, 1.0),
]

export interface SkySample {
  sky: RGB
  sun: RGB
  sunIntensity: number
  hemiSky: RGB
  hemiGround: RGB
  hemiIntensity: number
  ambient: RGB
  ambientIntensity: number
  night: number
}

const sample: SkySample = {
  sky: [0, 0, 0],
  sun: [0, 0, 0],
  sunIntensity: 0,
  hemiSky: [0, 0, 0],
  hemiGround: [0, 0, 0],
  hemiIntensity: 0,
  ambient: [0, 0, 0],
  ambientIntensity: 0,
  night: 0,
}

/** Sim time in seconds to a normalised time of day, 0..1 with 0 = midnight. */
export function timeOfDay(simTime: number): number {
  const t = (simTime / DAY_LENGTH + DAY_START) % 1
  return t < 0 ? t + 1 : t
}

/** Interpolate the sky keyframes. Writes into (and returns) a shared scratch. */
export function sampleSky(dayT: number): SkySample {
  let i = 0
  while (i < SKY_KEYS.length - 2 && dayT > SKY_KEYS[i + 1].t) i++
  const a = SKY_KEYS[i]
  const b = SKY_KEYS[i + 1]
  const span = b.t - a.t
  const raw = span > 0 ? (dayT - a.t) / span : 0
  // Smoothstep between keys so dawn and dusk ease rather than ramp linearly.
  const t = smoothstep(0, 1, clamp01(raw))
  mixRgb(a.sky, b.sky, t, sample.sky)
  mixRgb(a.sun, b.sun, t, sample.sun)
  mixRgb(a.hemiSky, b.hemiSky, t, sample.hemiSky)
  mixRgb(a.hemiGround, b.hemiGround, t, sample.hemiGround)
  mixRgb(a.ambient, b.ambient, t, sample.ambient)
  sample.sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t
  sample.hemiIntensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t
  sample.ambientIntensity = a.ambientIntensity + (b.ambientIntensity - a.ambientIntensity) * t
  sample.night = a.night + (b.night - a.night) * t
  return sample
}
