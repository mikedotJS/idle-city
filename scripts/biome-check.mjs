/**
 * Forces the things a naturally growing city takes an hour to reach: buildings
 * on coastal and alpine tiles at every level, and two stations far enough apart
 * to lay a real line. Builds the save in the page, reloads, screenshots.
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
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
// One context so both pages share localStorage.
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await context.newPage()
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

await page.goto('http://localhost:5173/', { waitUntil: 'load' })
await page.waitForTimeout(2500)

const report = await page.evaluate(async () => {
  const sim = await import('/src/sim/actions.ts')
  const terrain = await import('/src/sim/terrain.ts')
  const cfg = await import('/src/sim/config.ts')
  const save = await import('/src/sim/save.ts')

  // Hunt for a seed whose coast and ridge are both reachable and roomy.
  let picked = null
  for (let seed = 1; seed < 400 && !picked; seed++) {
    const state = sim.createCity(seed)
    const map = terrain.terrainFor(state)
    const coast = []
    const alpine = []
    for (let i = 0; i < cfg.TILE_COUNT; i++) {
      if (map.terrain[i] !== 0) continue
      if (map.biome[i] === 1) coast.push(i)
      else if (map.biome[i] === 2) alpine.push(i)
    }
    if (coast.length >= 6 && alpine.length >= 6) picked = { seed, state, coast, alpine }
  }
  if (!picked) return { ok: false, why: 'no seed had both biomes with room' }

  const { seed, state, coast, alpine } = picked
  state.ownedParcels.fill(true)
  state.coins = 1e9
  state.queue.length = 0
  // A large finite time, not Infinity: JSON.stringify turns Infinity into null
  // and the save validator rightly rejects it, silently giving a fresh city.
  state.nextBuildAt = 1e9

  const types = ['house', 'shop', 'park', 'factory']
  const place = (tiles, offset) =>
    tiles.slice(0, 6).forEach((tile, n) => {
      const b = sim.spawnBuilding(state, types[(n + offset) % types.length], tile)
      b.level = (n % 3) + 1
      b.bornAt = -100
    })
  place(coast, 0)
  place(alpine, 2)

  // Two stations far apart, so the line is long enough to see a train on it.
  const plain = []
  const map = terrain.terrainFor(state)
  for (let i = 0; i < cfg.TILE_COUNT; i++) {
    if (map.terrain[i] === 0 && map.biome[i] === 0 && !state.grid[i]) plain.push(i)
  }
  for (const tile of [plain[0], plain[plain.length - 1]]) {
    const b = sim.spawnBuilding(state, 'station', tile)
    b.bornAt = -100
  }

  save.save(state)
  return { ok: true, seed, coast: coast.length, alpine: alpine.length, stations: 2 }
})
console.log('SETUP:', JSON.stringify(report))

// A SECOND PAGE rather than a reload. main.ts saves on beforeunload, so
// reloading writes the live (fresh) city over the injected one before reading
// it back — the injection silently loses every time.
const view = await context.newPage()
view.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
view.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await view.goto('http://localhost:5173/', { waitUntil: 'load' })
await view.waitForTimeout(5000)

const loaded = await view.evaluate(() => ({
  people: document.querySelector('.stat__value')?.textContent ?? '?',
}))
console.log('LOADED CITY:', JSON.stringify(loaded))

const box = await view.locator('#scene').boundingBox()
await view.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
for (let i = 0; i < 6; i++) {
  await view.mouse.wheel(0, -120)
  await view.waitForTimeout(90)
}
await view.waitForTimeout(3000)
await view.screenshot({ path: `${OUT}/themes.png` })

await browser.close()
console.log(errors.length ? `ERRORS:\n${errors.slice(0, 6).join('\n')}` : 'no console errors')
