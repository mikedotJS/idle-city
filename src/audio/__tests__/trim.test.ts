import { describe, expect, it } from 'vitest'
import { clampDuration, silenceRange } from '../trim'

function tone(length: number, amp: number): Float32Array {
  return new Float32Array(length).fill(amp)
}

describe('silenceRange', () => {
  it('trims nothing from a buffer that is loud start to end', () => {
    const channel = tone(10, 0.5)
    expect(silenceRange([channel])).toEqual([0, 10])
  })

  it('trims leading and trailing near-silence', () => {
    const channel = tone(20, 0)
    for (let i = 5; i < 14; i++) channel[i] = 0.4
    expect(silenceRange([channel])).toEqual([5, 14])
  })

  it('keeps a sample loud in any one channel', () => {
    const left = tone(6, 0)
    const right = tone(6, 0)
    left[2] = 0.9
    right[4] = 0.9
    expect(silenceRange([left, right])).toEqual([2, 5])
  })

  it('falls back to the whole buffer when nothing crosses the threshold', () => {
    const channel = tone(8, 0.0001)
    expect(silenceRange([channel])).toEqual([0, 8])
  })

  it('treats a value just above the threshold as audible', () => {
    const channel = tone(4, 0)
    // Nudged past the threshold rather than sitting exactly on it: the
    // Float32Array storing the sample and the Float64 threshold computation
    // round differently enough that an exact boundary value is not a
    // meaningful case to pin down.
    channel[1] = Math.pow(10, -42 / 20) * 1.5
    expect(silenceRange([channel], -42)).toEqual([1, 2])
  })
})

describe('clampDuration', () => {
  it('leaves a range under the cap untouched', () => {
    expect(clampDuration([0, 100], 200, 20)).toEqual({ start: 0, end: 100, fadeStart: 80 })
  })

  it('cuts the tail once the range exceeds the cap, fading into the cut', () => {
    expect(clampDuration([0, 1000], 200, 20)).toEqual({ start: 0, end: 200, fadeStart: 180 })
  })

  it('never fades from before the trimmed start', () => {
    expect(clampDuration([50, 60], 200, 20)).toEqual({ start: 50, end: 60, fadeStart: 50 })
  })
})
