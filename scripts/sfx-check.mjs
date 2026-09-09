/**
 * Verifies the spatial sound design end to end in a real browser: silent
 * before a gesture, unlocked by one, a manual placement actually starts a
 * voice, an ambient loop starts for a standing park and stops once it is
 * demolished, and muting genuinely stops further playback.
 *
 * There is no DOM trace of a PannerNode the way there is an <audio> element
 * for music, so this reads src/audio/sfx.ts's dev-only window.__sfxPlayed
 * log instead — see the comment above it.
 *
 *   npm run dev          # in one shell
 *   npm run sfx-check    # in another
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

const failures = []
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

const played = () => page.evaluate(() => window.__sfxPlayed ?? [])
const clearLog = () => page.evaluate(() => window.__sfxPlayed?.splice(0))
// playOneShot's own logging happens inside an async decode; a click's log
// entry can land a beat after the click itself resolves.
const settle = () => page.waitForTimeout(250)

await page.goto(URL, { waitUntil: 'load' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(1500)

check('the dev sfx trace is present', Array.isArray(await played()))
check('nothing played before any gesture', (await played()).length === 0, JSON.stringify(await played()))

// A click anywhere is the same gesture that unlocks the music.
const board = await page.locator('#scene').boundingBox()
await page.mouse.click(board.x + board.width * 0.5, board.y + board.height * 0.5)
await settle()

// Select the park tool (a manual placement — the one thing sound design
// cannot pick up from the event log, so main.ts calls playPlacement() itself
// right after a successful placement). The auto-builder plants its very
// first house at sim time zero, at the tile nearest the plot's centre, so
// the centre itself cannot be trusted empty — try a spread of points across
// the owned plot until one lands on open ground.
const parkButton = page.getByRole('button', { name: /Park/ })
await parkButton.click()
await settle()

const candidates = [
  [0.5, 0.32],
  [0.5, 0.62],
  [0.32, 0.5],
  [0.66, 0.5],
  [0.34, 0.34],
  [0.66, 0.66],
  [0.34, 0.66],
  [0.66, 0.34],
]

let placedTile = null
for (const [fx, fy] of candidates) {
  await clearLog()
  await page.mouse.click(board.x + board.width * fx, board.y + board.height * fy)
  await settle()
  const entry = (await played()).find((e) => e.startsWith('oneshot:place_amenity@'))
  if (entry) {
    placedTile = [fx, fy]
    break
  }
}
check('placing a park plays a positioned one-shot', placedTile !== null, JSON.stringify(await played()))

// The ambient bed is a much larger file than a one-shot click, so its first
// fetch + decode can genuinely take longer than one settle() — poll rather
// than fix a single wait long enough to cover the slowest possible run.
let ambientStarted = null
for (let i = 0; i < 8 && !ambientStarted; i++) {
  await page.waitForTimeout(250)
  ambientStarted = (await played()).find((e) => e.startsWith('ambient-start:amb_park@'))
}
check("the park's ambient loop starts", ambientStarted !== null && ambientStarted !== undefined, JSON.stringify(await played()))

// Demolish the very tile that just succeeded.
const demolishButton = page.getByRole('button', { name: /Demolish/ })
await demolishButton.click()
await settle()
await clearLog()
if (placedTile) {
  const [fx, fy] = placedTile
  await page.mouse.click(board.x + board.width * fx, board.y + board.height * fy)
}
await settle()

const afterDemolish = await played()
check(
  'demolishing it plays the demolish one-shot',
  afterDemolish.some((e) => e.startsWith('oneshot:demolish@')),
  JSON.stringify(afterDemolish),
)
check(
  'and stops its ambient loop',
  afterDemolish.some((e) => e.startsWith('ambient-stop:amb_park@')),
  JSON.stringify(afterDemolish),
)

// The demolish tool is still selected and the tile it just cleared is now
// empty: pressing the same spot again finds nothing to demolish, which
// should still chime — a toast is a toast no matter why it was shown.
if (placedTile) {
  const [fx, fy] = placedTile
  await clearLog()
  await page.mouse.click(board.x + board.width * fx, board.y + board.height * fy)
  await settle()
  check('a toast (here: nothing to demolish) plays its own chime', (await played()).includes('oneshot:toast'))
}

// Mute actually mutes: nothing should log a play even though the player
// keeps placing things, on ground never touched by the steps above.
await page.locator('.sound__toggle').click()
await settle()
await clearLog()
await parkButton.click()
await page.mouse.click(board.x + board.width * 0.22, board.y + board.height * 0.5)
await settle()
check('muting sound stops further playback', (await played()).length === 0, JSON.stringify(await played()))

await browser.close()
if (errors.length) console.log(`\nconsole errors:\n${errors.slice(0, 6).join('\n')}`)
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nall sfx checks passed')
}
