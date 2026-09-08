/**
 * Verifies the background music end to end in a real browser, because a
 * silent AudioContext failure looks exactly like working code.
 *
 * The crossfade only happens once every three minutes, so rather than waiting
 * for it, this seeks the playhead to just before the end of the track and
 * asserts that two tracks are audible at once.
 *
 *   npm run dev          # in one shell
 *   npm run audio-check  # in another
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const URL = process.env.SHOT_URL ?? 'http://localhost:5173/'

function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'))
  return dir ? join(root, dir, 'chrome-linux', 'chrome') : undefined
}

const errors = []
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    // Match a real browser: nothing may play before a gesture.
    '--autoplay-policy=user-gesture-required',
  ],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`))

const playing = () =>
  page.evaluate(() => ({
    tracks: [...document.querySelectorAll('audio')]
      .filter((a) => !a.paused)
      .map((a) => `${a.src.split('/').pop()}@${a.currentTime.toFixed(0)}s`),
    label: document.querySelector('.music__title')?.textContent ?? null,
  }))

const failures = []
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

await page.goto(URL, { waitUntil: 'load' })
await page.waitForTimeout(3000)

const before = await playing()
check('silent before any gesture', before.tracks.length === 0, JSON.stringify(before))

const box = await page.locator('#scene').boundingBox()
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.78)
await page.waitForTimeout(5000)

const started = await playing()
check('plays after a gesture', started.tracks.length === 1, JSON.stringify(started))

await page.evaluate(() => {
  const a = [...document.querySelectorAll('audio')].find((el) => !el.paused)
  if (a && Number.isFinite(a.duration)) a.currentTime = a.duration - 10
})
await page.waitForTimeout(4500)
const during = await playing()
check('two tracks overlap mid-crossfade', during.tracks.length === 2, JSON.stringify(during))

await page.waitForTimeout(9000)
const after = await playing()
check('one track left once the fade ends', after.tracks.length === 1, JSON.stringify(after))
check('advanced to a different track', after.tracks[0] !== started.tracks[0], `${started.tracks[0]} -> ${after.tracks[0]}`)

await page.locator('.music__toggle').click()
await page.waitForTimeout(1200)
const muted = await playing()
check('toggle actually stops playback', muted.tracks.length === 0, JSON.stringify(muted))

await browser.close()
if (errors.length) console.log(`\nconsole errors:\n${errors.slice(0, 6).join('\n')}`)
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nall audio checks passed')
}
