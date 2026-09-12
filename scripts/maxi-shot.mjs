/**
 * Proves the merged-block maxi looks: spawns a 2x2 of one type at MAX_LEVEL
 * (plus schools to push the happiness field to its ceiling, which is what a
 * merge requires), waits for the sim to fuse the block and regrow the anchor,
 * then screenshots. Reports any console or page error — see shot.mjs for why.
 *
 * Factories emit so much misery that four level 3 factories can never sit in
 * a field at its ceiling, so the factory scenario pokes mergeAnchor directly
 * after the wait — the documented console-poke path revalidateBlocks exists
 * for — purely to prove the maxi fallback geometry draws.
 *
 *   npm run dev            # in one shell
 *   npm run maxi-shot      # in another
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const URL = process.env.SHOT_URL ?? 'http://localhost:5173/'
const OUT = process.env.SHOT_OUT ?? '/tmp/idle-city-shots'

const WORLD_SIZE = 36
const ANCHOR_TILE = 629 // Tile at (17, 17) on a 36-wide board; the block spills to +x/+z.

/** Playwright's own browser, wherever this environment happens to keep it. */
function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'))
  return dir ? join(root, dir, 'chrome-linux', 'chrome') : undefined
}
const SCENARIOS = [
  {
    name: 'maxi-food-court',
    spawns: [
      ['shop', 17, 17, 3, 'restaurant'],
      ['shop', 18, 17, 3, 'konbini'],
      ['shop', 17, 18, 3, 'clothing'],
      ['shop', 18, 18, 3, 'general'],
      ['school', 17, 16, 3],
      ['school', 18, 19, 3],
    ],
  },
  {
    name: 'maxi-apartment',
    spawns: [
      ['house', 17, 17, 3],
      ['house', 18, 17, 3],
      ['house', 17, 18, 3],
      ['house', 18, 18, 3],
      ['school', 17, 16, 3],
      ['school', 18, 19, 3],
    ],
  },
  {
    name: 'maxi-industrial',
    spawns: [
      ['factory', 17, 17, 3],
      ['factory', 18, 17, 3],
      ['factory', 17, 18, 3],
      ['factory', 18, 18, 3],
      ['school', 17, 16, 3],
      ['school', 18, 19, 3],
    ],
    // See the header: factories can never merge on their own.
    force: true,
  },
  // No restaurant in the block, at least one clothing -> department_store.
  {
    name: 'maxi-department-store',
    spawns: [
      ['shop', 17, 17, 3, 'clothing'],
      ['shop', 18, 17, 3, 'clothing'],
      ['shop', 17, 18, 3, 'clothing'],
      ['shop', 18, 18, 3, 'clothing'],
      ['school', 17, 16, 3],
      ['school', 18, 19, 3],
    ],
  },
  // Four general stores grow into the galleria: the arcade.
  {
    name: 'maxi-arcade',
    spawns: [
      ['shop', 17, 17, 3, 'general'],
      ['shop', 18, 17, 3, 'general'],
      ['shop', 17, 18, 3, 'general'],
      ['shop', 18, 18, 3, 'general'],
      ['school', 17, 16, 3],
      ['school', 18, 19, 3],
    ],
  },
  // No restaurant, no clothing, at least one konbini -> supermarket.
  {
    name: 'maxi-supermarket',
    spawns: [
      ['shop', 17, 17, 3, 'konbini'],
      ['shop', 18, 17, 3, 'konbini'],
      ['shop', 17, 18, 3, 'konbini'],
      ['shop', 18, 18, 3, 'general'],
      ['school', 17, 16, 3],
      ['school', 18, 19, 3],
    ],
  },
  // Parks feed the happiness field instead of draining it, so four level 3
  // parks next to two schools should fuse on their own; if a future balance
  // change breaks that, give this scenario `force: true` like the factory.
  {
    name: 'maxi-botanical',
    spawns: [
      ['park', 17, 17, 3],
      ['park', 18, 17, 3],
      ['park', 17, 18, 3],
      ['park', 18, 18, 3],
      ['school', 17, 16, 3],
      ['school', 18, 19, 3],
    ],
  },
  // Schools feed the happiness field like parks do, so four of them beside
  // two helper houses should fuse on their own; if not, give this scenario
  // `force: true` like the factory.
  {
    name: 'maxi-campus',
    spawns: [
      ['school', 17, 17, 3],
      ['school', 18, 17, 3],
      ['school', 17, 18, 3],
      ['school', 18, 18, 3],
      ['house', 17, 16, 3],
      ['house', 18, 19, 3],
    ],
  },
  {
    name: 'maxi-port',
    spawns: [
      ['harbour', 17, 17, 3],
      ['harbour', 18, 17, 3],
      ['harbour', 17, 18, 3],
      ['harbour', 18, 18, 3],
      ['school', 17, 16, 3],
      ['school', 18, 19, 3],
    ],
  },
  {
    name: 'maxi-terminal',
    spawns: [
      ['station', 17, 17, 3],
      ['station', 18, 17, 3],
      ['station', 17, 18, 3],
      ['station', 18, 18, 3],
      ['school', 17, 16, 3],
      ['school', 18, 19, 3],
    ],
  },
  // The landfill has NO dedicated maxi piece on purpose: a merged block must
  // still draw the standard heap scaled up (the documented fallback). This
  // scenario only proves that path still renders without errors — no shot.
  {
    name: 'maxi-landfill-fallback',
    spawns: [
      ['landfill', 17, 17, 3],
      ['landfill', 18, 17, 3],
      ['landfill', 17, 18, 3],
      ['landfill', 18, 18, 3],
      ['school', 17, 16, 3],
      ['school', 18, 19, 3],
    ],
    force: true,
    shot: false,
  },
]

mkdirSync(OUT, { recursive: true })
const errors = []
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})

for (const scenario of SCENARIOS) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('console', (m) => m.type() === 'error' && errors.push(`${scenario.name}: ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`${scenario.name} PAGEERROR: ${e.message}`))
  await page.goto(URL, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__idleCity !== undefined)

  await page.evaluate((spawns) => {
    for (const [type, x, z, level, kind] of spawns) {
      window.__idleCity.spawn(type, x, z, level, kind)
    }
  }, scenario.spawns)

  await page.waitForTimeout(2500)
  if (scenario.force || (await page.evaluate((anchorTile) => window.__idleCity.state.grid[anchorTile]?.mergeAnchor !== anchorTile, ANCHOR_TILE))) {
    // Natural fusion did not happen: poke mergeAnchor directly, the documented
    // console-poke path revalidateBlocks exists for, purely to prove the maxi
    // geometry draws.
    await page.evaluate(({ worldSize, anchorTile }) => {
      const { state, redraw } = window.__idleCity
      for (const [x, z] of [
        [17, 17],
        [18, 17],
        [17, 18],
        [18, 18],
      ]) {
        const b = state.grid[z * worldSize + x]
        if (b) b.mergeAnchor = anchorTile
      }
      redraw()
    }, { worldSize: WORLD_SIZE, anchorTile: ANCHOR_TILE })
    await page.waitForTimeout(1800)
  }

  const merged = await page.evaluate((anchorTile) => window.__idleCity.state.grid[anchorTile]?.mergeAnchor === anchorTile, ANCHOR_TILE)
  console.log(`${scenario.name}: mergeAnchor === ${ANCHOR_TILE} -> ${merged}`)
  if (!merged) errors.push(`${scenario.name}: block did not merge (mergeAnchor !== ${ANCHOR_TILE})`)

  if (scenario.shot !== false) await page.screenshot({ path: `${OUT}/${scenario.name}.png` })
  await page.close()
}

await browser.close()
console.log(`shots in ${OUT}`)
console.log(errors.length ? `ERRORS:\n${errors.slice(0, 10).join('\n')}` : 'no console errors')
