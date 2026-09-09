/**
 * Pure PCM helpers for cleaning up a generated one-shot before it is used as
 * a Web Audio buffer.
 *
 * Split out of sfx.ts so it can be exercised by vitest without a real
 * AudioContext, which jsdom does not provide. Everything here operates on
 * plain Float32Array channel data — sfx.ts is the only place that touches an
 * actual AudioBuffer.
 */

function dbToAmplitude(db: number): number {
  return Math.pow(10, db / 20)
}

/**
 * The [start, end) sample range spanning everything at or above `thresholdDb`
 * across every channel. A generated clip routinely opens and closes on a beat
 * or two of near-silence — the model pads for phrasing, not for a game that
 * has to trigger the same instant every time — so trimming it is what makes a
 * "short UI click" prompt actually feel instant on the second play.
 *
 * Returns [0, length] (i.e. no trim) if every sample is below the threshold,
 * since a completely silent buffer is not this function's problem to flag.
 */
export function silenceRange(channels: Float32Array[], thresholdDb = -42): [number, number] {
  const length = channels[0]?.length ?? 0
  const threshold = dbToAmplitude(thresholdDb)

  let start = 0
  findStart: for (; start < length; start++) {
    for (const channel of channels) {
      if (Math.abs(channel[start]) >= threshold) break findStart
    }
  }
  if (start >= length) return [0, length]

  let end = length
  findEnd: for (; end > start; end--) {
    for (const channel of channels) {
      if (Math.abs(channel[end - 1]) >= threshold) break findEnd
    }
  }

  return [start, end]
}

/**
 * Clamp a trimmed range to at most `maxSamples`, keeping the start (the
 * attack, which is what a one-shot is recognised by) and cutting the tail.
 * `fadeSamples` is folded into the cut so the truncation is a fade, not a
 * click — cutting a sustained chime dead is more audible than the seam any
 * ambient loop leaves, because a one-shot is heard in isolation.
 */
export function clampDuration(
  [start, end]: [number, number],
  maxSamples: number,
  fadeSamples: number,
): { start: number; end: number; fadeStart: number } {
  const clampedEnd = Math.min(end, start + maxSamples)
  const fadeStart = Math.max(start, clampedEnd - fadeSamples)
  return { start, end: clampedEnd, fadeStart }
}
