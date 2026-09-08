/**
 * Display formatting for the HUD. Pure functions over numbers, no DOM, so the
 * hot path in `update()` can call them freely and compare the resulting string
 * against what is already on screen.
 */

/** 1234567 -> "1,234,567". Manual grouping so the output never varies by locale. */
function group(value: number): string {
  const digits = Math.abs(value).toFixed(0)
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return (value < 0 ? '-' : '') + out
}

/**
 * Coins. Grouped below 10k, compacted above it, so the counter keeps ticking
 * visibly but the panel never reflows as the city gets rich.
 */
export function formatCoins(n: number): string {
  const v = Math.floor(n)
  const a = Math.abs(v)
  if (a < 10_000) return group(v)
  const sign = v < 0 ? '-' : ''
  if (a < 1e6) return sign + (a / 1e3).toFixed(1) + 'k'
  if (a < 1e9) return sign + (a / 1e6).toFixed(2) + 'M'
  return sign + (a / 1e9).toFixed(2) + 'B'
}

/** Coins per second. Keeps a decimal while the numbers are small enough to matter. */
export function formatRate(n: number): string {
  const a = Math.abs(n)
  if (a < 100) return n.toFixed(1)
  if (a < 10_000) return group(n)
  return formatCoins(n)
}

/** 0.72 -> "72%". */
export function formatPercent(fraction: number): string {
  return Math.round(fraction * 100) + '%'
}

/** 1.22 -> "x1.22", with a real multiplication sign. */
export function formatMultiplier(x: number): string {
  return '×' + x.toFixed(2)
}

/** Seconds -> "2h 14m", "14m 3s", "45s". Humanised, never zero-padded. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  if (total < 60) return total + 's'
  const minutes = Math.floor(total / 60)
  if (minutes < 60) {
    const rest = total % 60
    return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`
}

export type HappinessKey = 'thriving' | 'content' | 'strained' | 'rotting'

export interface HappinessBand {
  key: HappinessKey
  /** One word, readable from across a desk. */
  label: string
  /** One line saying what that word means for the city. */
  note: string
}

/**
 * City happiness as a state rather than a number. Bands are chosen around the
 * sim's own thresholds: 0.5 is an untouched tile, and houses stop holding
 * anyone below 0.3.
 */
export function happinessBand(happiness: number): HappinessBand {
  if (happiness >= 0.7) {
    return { key: 'thriving', label: 'thriving', note: 'People are glad to live here.' }
  }
  if (happiness >= 0.5) {
    return { key: 'content', label: 'content', note: 'Liveable. Parks would push it higher.' }
  }
  if (happiness >= 0.3) {
    return { key: 'strained', label: 'strained', note: 'Smog is reaching the houses.' }
  }
  return { key: 'rotting', label: 'rotting', note: 'Houses are emptying out and going derelict.' }
}
