/**
 * Verifies that "New city" actually starts a new city: that one press only
 * arms it, that moving away cancels, and that confirming lands on different
 * terrain rather than the same board again.
 *
 *   npm run dev
 *   npm run restart-check
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'))
  return dir ? join(root, dir, 'chrome-linux', 'chrome') : undefined
}

const failures = []
const errors = []
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

await page.goto('http://localhost:5173/', { waitUntil: 'load' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(4000)

const seedOf = () =>
  page.evaluate(() => {
    const raw = localStorage.getItem('micro-city-save')
    return raw ? JSON.parse(raw).terrainSeed : null
  })

// Target the class, not the label: the label changes when it arms, so a
// text-matching locator stops resolving exactly when it is needed.
const button = page.locator('.btn--danger')
check('the button exists at all', (await button.count()) === 1)

// Let it play long enough to have a city worth losing.
await page.waitForTimeout(9000)
const before = await seedOf()
const peopleBefore = await page.locator('.stat__value').first().textContent()
check('a city is running', before !== null, `terrainSeed ${before}, people ${peopleBefore}`)

await button.click()
await page.waitForTimeout(300)
const armedText = await page.locator('.btn--danger').textContent()
check('one press only arms it', /Really/.test(armedText ?? ''), JSON.stringify(armedText))

// Moving away must cancel: nobody loses hours to a stray click.
await page.mouse.move(10, 10)
await page.waitForTimeout(400)
check('moving away disarms it', /^New city$/.test((await page.locator('.btn--danger').textContent()) ?? ''))

await button.click()
await page.waitForTimeout(300)
await button.click()
await page.waitForTimeout(6000)

const after = await seedOf()
check('the city was actually replaced', after !== null && after !== before, `${before} -> ${after}`)

const peopleAfter = await page.locator('.stat__value').first().textContent()
check('and it started from nothing', Number(peopleAfter) < Number(peopleBefore), `${peopleBefore} -> ${peopleAfter}`)

await browser.close()
if (errors.length) console.log(`\nconsole errors:\n${errors.slice(0, 5).join('\n')}`)
console.log(failures.length ? `\n${failures.length} failed` : '\nall restart checks passed')
if (failures.length) process.exitCode = 1
