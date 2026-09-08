/**
 * Drives the running dev server in Chromium and writes screenshots. Reports any
 * console or page error, because a three.js scene fails silently far more often
 * than it throws — a clean typecheck says nothing about whether anything drew.
 *
 *   npm run dev        # in one shell
 *   npm run shot       # in another
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const URL = process.env.SHOT_URL ?? 'http://localhost:5173/'
const OUT = process.env.SHOT_OUT ?? '/tmp/idle-city-shots'
const GROW_MS = Number(process.env.SHOT_GROW_MS ?? 25000)

/** Playwright's own browser, wherever this environment happens to keep it. */
function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'))
  return dir ? join(root, dir, 'chrome-linux', 'chrome') : undefined
}

mkdirSync(OUT, { recursive: true })
const errors = []
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`))

await page.goto(URL, { waitUntil: 'load' })
await page.waitForTimeout(6000)
await page.screenshot({ path: `${OUT}/01-boot.png` })

const box = await page.locator('#scene').boundingBox()
const factory = page.locator('button', { hasText: /Factory/i }).first()
if (await factory.count()) {
  await factory.click()
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/02-ghost-and-radius.png` })
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.62)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/03-factory-placed.png` })
}

await page.waitForTimeout(GROW_MS)
await page.screenshot({ path: `${OUT}/04-grown.png` })

await browser.close()
console.log(`shots in ${OUT}`)
console.log(errors.length ? `ERRORS:\n${errors.slice(0, 10).join('\n')}` : 'no console errors')
