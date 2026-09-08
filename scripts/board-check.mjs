/**
 * Drives the leaderboard against a real Based server in a real browser: two
 * accounts, a publish, a republish, a cross-account read, a reload and a sign
 * out. None of that can be proven by a typecheck.
 *
 *   npm run dev          # with VITE_BASED_URL / VITE_BASED_ANON_KEY set
 *   npm run board-check
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

const OUT = process.argv[2] ?? '/tmp'
const errors = []
const failures = []
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})

async function openGame() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  await page.goto('http://localhost:5173/', { waitUntil: 'load' })
  await page.waitForTimeout(3500)
  return page
}

async function signIn(page, email, mode) {
  await page.locator('.panel--board-launch button').click()
  await page.waitForTimeout(400)
  if (mode === 'signup') await page.locator('.board__auth .btn--ghost').click()
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill('correct-horse-battery')
  await page.locator('.board__auth button[type=submit]').click()
  await page.waitForTimeout(1800)
}

// --- player one ------------------------------------------------------------
const alice = await openGame()
check('launcher renders when a backend is configured',
  (await alice.locator('.panel--board-launch').count()) === 1)

await signIn(alice, 'alice@test.dev', 'signin')
const who = await alice.locator('.board__who').textContent()
check('signs in against the real server', who === 'alice@test.dev', who ?? 'none')

await alice.waitForTimeout(1200)
const rowsBefore = await alice.locator('.board__row').count()
check('reads the existing board', rowsBefore >= 2, `${rowsBefore} rows`)

await alice.locator('.board__publish input').fill('Pastelburg')
await alice.locator('.board__publish button').click()
await alice.waitForTimeout(2500)
const note = await alice.locator('.board__publish .hint').textContent()
check('publishes a score', /^Published Pastelburg/.test(note ?? ''), note ?? 'none')
check('highlights my own row', (await alice.locator('.board__row.is-me').count()) === 1)
await alice.screenshot({ path: `${OUT}/board.png` })

// Publishing twice must replace the row, not add a second one.
await alice.locator('.board__publish button').click()
await alice.waitForTimeout(2500)
check('republishing replaces my row rather than adding one',
  (await alice.locator('.board__row.is-me').count()) === 1)

// --- player two sees player one -------------------------------------------
const bob = await openGame()
await signIn(bob, 'bob@test.dev', 'signin')
await bob.waitForTimeout(1500)
const cities = await bob.locator('.board__city').allTextContents()
check('another player sees my city on the board', cities.includes('Pastelburg'), cities.join(', '))
check('and sees their own row highlighted, not mine',
  (await bob.locator('.board__row.is-me').count()) === 1)

// --- session survives a reload --------------------------------------------
await alice.reload({ waitUntil: 'load' })
await alice.waitForTimeout(3500)
await alice.locator('.panel--board-launch button').click()
await alice.waitForTimeout(1500)
const stillWho = await alice.locator('.board__who').textContent()
check('session survives a reload', stillWho === 'alice@test.dev', stillWho ?? 'signed out')

// --- sign out --------------------------------------------------------------
await alice.locator('.board__account .btn--ghost').click()
await alice.waitForTimeout(1200)
check('sign out returns to the form',
  await alice.locator('.board__auth').isVisible())

await browser.close()
if (errors.length) console.log(`\nconsole errors:\n${errors.slice(0, 6).join('\n')}`)
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall leaderboard checks passed')
if (failures.length) process.exitCode = 1
