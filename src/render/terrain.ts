/**
 * Terrain: the lake surface, the peaks, and nothing else.
 *
 * Two rules shape this file, and the first one outranks the second.
 *
 * The ground tint is the game's user interface: every plate is coloured by its
 * tile happiness and the player reads the health of the whole city off it
 * without clicking. So water and rock are drawn in colours that the happiness
 * ramp cannot produce. The ramp runs grey-brown to warm sand to sage, all of
 * it warm and low in chroma; the lake is a dusty blue-green and the rock is a
 * cool slate that leans violet. Neither can be misread as a happiness reading
 * whatever the light does to it. The sand strip along the shore is not drawn
 * here at all — a beach tile is still buildable and still has to show its
 * happiness, so it stays a tinted ground plate and only shifts warm, which is
 * ground.ts's job.
 *
 * The second rule is that this is a calm game. The lake ripples, slowly, at an
 * amplitude of 0.014 against a tile pitch of 1.0 — enough that the specular
 * highlight crawls and the surface reads as water rather than as a sheet of
 * blue plastic, small enough that nothing appears to be happening.
 *
 * Everything is built in sync() and only when the terrain seed actually
 * changed: terrain is a pure function of that one number, so buying a parcel
 * cannot alter a vertex. frame() writes into two attribute buffers and two
 * material colours, and allocates nothing.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three'
import { WORLD_SIZE } from '../sim/config'
import { tileIndex, tileToWorld } from '../sim/grid'
import { Terrain, terrainFor } from '../sim/terrain'
import type { TerrainMap } from '../sim/terrain'
import type { CityState } from '../sim/types'
import type { TerrainView } from './ambient-api'
import type { RGB } from './palette'
import { hexToRgb, mixRgb, setSrgb, smoothstep } from './palette'

// ---------------------------------------------------------------------------
// Heights
// ---------------------------------------------------------------------------

/**
 * The still surface of the lake. The sim puts water tiles at -0.16 and
 * ground.ts drops their plates to exactly that, so there is 0.11 of water
 * between the surface and the bed: enough depth for the translucency to read,
 * far more than the depth buffer needs at this camera range.
 */
const WATER_Y = -0.05

/** Ripple amplitudes and rates. Two crossed waves, both slow. */
const WAVE_A1 = 0.0085
const WAVE_K1 = 1.9
const WAVE_S1 = 0.55
const WAVE_A2 = 0.0055
const WAVE_K2 = 1.15
const WAVE_K3 = 2.4
const WAVE_S2 = -0.42

/** Lattice points per tile edge on the water surface. */
const WATER_RES = 3

/**
 * Water covers whole tiles, but the ground plates are inset by half of the
 * 0.045 plate gap, which would leave a hairline of dark table showing at every
 * shoreline. Shore vertices are pushed this far out over the neighbouring
 * plate to close it. Shore vertices are also damped, so the ripple never lifts
 * the surface over the sand.
 */
const SHORE_PUSH = 0.035
const SHORE_DAMP = 0.28

/** Where the skirt around the edge of the massif ends: under its own plate. */
const MOUNTAIN_SKIRT_Y = -0.07

/**
 * How much of the peak height a shared corner takes, by how many of its four
 * neighbouring tiles are mountain. A corner with one mountain neighbour is the
 * outside of the range and drops most of the way to the ground; a corner with
 * four sits at the mean of them. Without this the fringe of the massif would
 * meet the plain as a cliff and the whole thing would read as one extruded
 * block rather than as a ridge.
 */
const CORNER_SHAPE = [0, 0.4, 0.72, 0.9, 1]

// ---------------------------------------------------------------------------
// Colours. Authored in sRGB, deliberately outside the happiness ramp.
// ---------------------------------------------------------------------------

/** Dusty blue-green. Muted enough to sit beside pale sand without a fight. */
const WATER_TINT = hexToRgb(0x7fa9a6)
/** After dark the lake keeps its hue and cools slightly; it never goes black. */
const WATER_NIGHT = hexToRgb(0x74a0ac)
/** Low rock. Cool and slightly violet: the ramp has no cool anywhere in it. */
const ROCK_LOW = hexToRgb(0x7f7d88)
/** Upper faces, one step lighter so a slope reads before the cap does. */
const ROCK_HIGH = hexToRgb(0x9a97a3)
/** The cap. Pale, cool, and reached only by the true peaks. */
const ROCK_CAP = hexToRgb(0xe2dfe6)

/**
 * The pale cap, ramped on world height.
 *
 * Both numbers are read off the shape of the sim's own distribution rather
 * than picked by eye. Peak heights are bimodal — measured over 200 seeds, a
 * fringe fills 0.50 to 0.80, the massif fills 1.00 to 1.41, and between 0.80
 * and 0.95 there is essentially nothing. Starting the ramp at 1.05 puts it
 * above every fringe tile and above the massif's own lowest corners, so no
 * amount of light can leave a wash of cap on the low rock; saturating at 1.32,
 * the 90th percentile, means the ramp actually finishes on peaks that exist
 * instead of on a height nothing on the board reaches.
 *
 * The ramp is evaluated per vertex, and a tent's corners sit below its peak,
 * so the cap lands on the tips and washes down the flanks. About half the
 * massif carries a clearly visible one, which is what makes a ridge read as a
 * ridge rather than as a single pale lump.
 */
const CAP_START = 1.05
const CAP_FULL = 1.32

/** Matches the ground layer's night lift, so terrain and tint move together. */
const NIGHT_LIFT = 0.42

const WATER_OPACITY = 0.78

// ---------------------------------------------------------------------------

const OFFSET = (WORLD_SIZE - 1) / 2

/** Deterministic per-corner jitter, so a reloaded save gets the same skyline. */
function jitter(x: number, z: number, seed: number): number {
  let h = (x * 73856093 + z * 19349663 + seed * 83492791) | 0
  h = (h ^ (h >>> 13)) | 0
  h = Math.imul(h, 1274126177) | 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 - 0.5
}

export function createTerrainView(): TerrainView {
  const group = new Group()
  group.name = 'terrain'

  const waterMaterial = new MeshStandardMaterial({
    transparent: true,
    opacity: WATER_OPACITY,
    // Low roughness is what sells it: the sun leaves a soft highlight and the
    // animated normals crawl it across the surface.
    roughness: 0.24,
    metalness: 0,
    depthWrite: false,
  })
  const rockMaterial = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.92,
    metalness: 0,
  })

  let waterGeom: BufferGeometry | null = null
  let waterMesh: Mesh | null = null
  let rockGeom: BufferGeometry | null = null
  let rockMesh: Mesh | null = null

  /** Rest positions of the water lattice, and the per-vertex ripple scale. */
  let waterX: Float32Array = new Float32Array(0)
  let waterZ: Float32Array = new Float32Array(0)
  let waterAmp: Float32Array = new Float32Array(0)

  let builtSeed: number | null = null
  let time = 0

  // --- water ---------------------------------------------------------------

  function buildWater(map: TerrainMap): void {
    const isWater = (tx: number, tz: number): boolean =>
      tx >= 0 && tz >= 0 && tx < WORLD_SIZE && tz < WORLD_SIZE &&
      map.terrain[tileIndex(tx, tz)] === Terrain.Water

    const side = WORLD_SIZE * WATER_RES + 1
    const vertexCount = side * side
    const positions = new Float32Array(vertexCount * 3)
    const normals = new Float32Array(vertexCount * 3)
    waterX = new Float32Array(vertexCount)
    waterZ = new Float32Array(vertexCount)
    waterAmp = new Float32Array(vertexCount)

    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const v = j * side + i
        const fx = i / WATER_RES
        const fz = j / WATER_RES
        // Which tiles this lattice point touches: two per axis on a tile
        // border, one in the interior of a tile.
        const x0 = i % WATER_RES === 0 ? fx - 1 : Math.floor(fx)
        const x1 = i % WATER_RES === 0 ? fx : Math.floor(fx)
        const z0 = j % WATER_RES === 0 ? fz - 1 : Math.floor(fz)
        const z1 = j % WATER_RES === 0 ? fz : Math.floor(fz)

        let dry = 0
        let pushX = 0
        let pushZ = 0
        for (let tx = x0; tx <= x1; tx++) {
          for (let tz = z0; tz <= z1; tz++) {
            if (isWater(tx, tz)) continue
            dry++
            // Push toward the dry side, so the surface runs under the lip of
            // the land plate. Only along an axis this vertex actually
            // straddles: a vertex inside a tile has no side to be on.
            if (i % WATER_RES === 0) pushX += tx + 0.5 > fx ? 1 : -1
            if (j % WATER_RES === 0) pushZ += tz + 0.5 > fz ? 1 : -1
          }
        }

        let wx = fx - 0.5 - OFFSET
        let wz = fz - 0.5 - OFFSET
        const pushLen = Math.hypot(pushX, pushZ)
        if (dry > 0 && pushLen > 0) {
          wx += (pushX / pushLen) * SHORE_PUSH
          wz += (pushZ / pushLen) * SHORE_PUSH
        }

        waterX[v] = wx
        waterZ[v] = wz
        waterAmp[v] = dry > 0 ? SHORE_DAMP : 1
        positions[v * 3] = wx
        positions[v * 3 + 1] = WATER_Y
        positions[v * 3 + 2] = wz
        normals[v * 3 + 1] = 1
      }
    }

    const indices: number[] = []
    for (let tz = 0; tz < WORLD_SIZE; tz++) {
      for (let tx = 0; tx < WORLD_SIZE; tx++) {
        if (!isWater(tx, tz)) continue
        for (let sz = 0; sz < WATER_RES; sz++) {
          for (let sx = 0; sx < WATER_RES; sx++) {
            const i = tx * WATER_RES + sx
            const j = tz * WATER_RES + sz
            const a = j * side + i
            const b = (j + 1) * side + i
            const c = (j + 1) * side + i + 1
            const d = j * side + i + 1
            // a-b-c-d walks the quad so that both triangles face up.
            indices.push(a, b, c, a, c, d)
          }
        }
      }
    }
    if (indices.length === 0) return

    waterGeom = new BufferGeometry()
    waterGeom.setAttribute('position', new BufferAttribute(positions, 3))
    waterGeom.setAttribute('normal', new BufferAttribute(normals, 3))
    waterGeom.setIndex(indices)
    waterGeom.computeBoundingSphere()
    waterMesh = new Mesh(waterGeom, waterMaterial)
    waterMesh.frustumCulled = false
    waterMesh.castShadow = false
    waterMesh.receiveShadow = false
    // Above the ground plates and the parcel frames, below the hover frames.
    waterMesh.renderOrder = 1
    group.add(waterMesh)
    rippleWater()
  }

  /** Rewrite the surface from the two crossed waves, normals analytically. */
  function rippleWater(): void {
    if (!waterGeom) return
    const position = waterGeom.getAttribute('position') as BufferAttribute
    const normal = waterGeom.getAttribute('normal') as BufferAttribute
    const pos = position.array as Float32Array
    const nrm = normal.array as Float32Array
    const t1 = time * WAVE_S1
    const t2 = time * WAVE_S2
    for (let v = 0; v < waterAmp.length; v++) {
      const x = waterX[v]
      const z = waterZ[v]
      const a = waterAmp[v]
      const p1 = x * WAVE_K1 + t1
      const p2 = x * WAVE_K2 + z * WAVE_K3 + t2
      pos[v * 3 + 1] = WATER_Y + a * (WAVE_A1 * Math.sin(p1) + WAVE_A2 * Math.sin(p2))
      const dx = a * (WAVE_A1 * WAVE_K1 * Math.cos(p1) + WAVE_A2 * WAVE_K2 * Math.cos(p2))
      const dz = a * (WAVE_A2 * WAVE_K3 * Math.cos(p2))
      const inv = 1 / Math.hypot(dx, 1, dz)
      nrm[v * 3] = -dx * inv
      nrm[v * 3 + 1] = inv
      nrm[v * 3 + 2] = -dz * inv
    }
    position.needsUpdate = true
    normal.needsUpdate = true
  }

  // --- mountains -----------------------------------------------------------

  function buildMountains(map: TerrainMap, seed: number): void {
    const isMountain = (tx: number, tz: number): boolean =>
      tx >= 0 && tz >= 0 && tx < WORLD_SIZE && tz < WORLD_SIZE &&
      map.terrain[tileIndex(tx, tz)] === Terrain.Mountain

    /**
     * Height of a lattice corner, shared by up to four tiles so neighbouring
     * peaks meet instead of intersecting. Corners are cached: every interior
     * one is asked for four times.
     */
    const cornerCache = new Float32Array((WORLD_SIZE + 1) * (WORLD_SIZE + 1)).fill(-1)
    function cornerHeight(cx: number, cz: number): number {
      const key = cz * (WORLD_SIZE + 1) + cx
      const cached = cornerCache[key]
      if (cached >= 0) return cached
      let sum = 0
      let n = 0
      for (let tx = cx - 1; tx <= cx; tx++) {
        for (let tz = cz - 1; tz <= cz; tz++) {
          if (!isMountain(tx, tz)) continue
          sum += map.height[tileIndex(tx, tz)]
          n++
        }
      }
      let h = 0
      if (n > 0) {
        h = (sum / n) * CORNER_SHAPE[n]
        // Break the lattice up a little, more where the rock is deep. Scaled
        // to the range the sim actually produces: at +-0.045 per neighbour
        // this is under a tenth of the tallest peak, which roughens the
        // silhouette without letting two corners of one tile disagree by
        // enough to bend the cap line.
        h += jitter(cx, cz, seed) * 0.045 * n
        if (h < 0.04) h = 0.04
      }
      cornerCache[key] = h
      return h
    }

    const positions: number[] = []
    const colors: number[] = []
    const scratch = new Color()
    const mixed: RGB = [0, 0, 0]
    const capped: RGB = [0, 0, 0]

    function push(x: number, y: number, z: number): void {
      positions.push(x, y, z)
      // Tone by absolute height, so a ridge shades from slate at the base to a
      // pale cap at the top and the silhouette reads even head-on. This lower
      // ramp is finished by 0.9 — the top of the fringe — so the fringe uses
      // the full slate-to-light-rock range on its own and the massif is
      // already at light rock before the cap starts at 1.05. Three bands,
      // none of them overlapping: dark base, rock, cap.
      mixRgb(ROCK_LOW, ROCK_HIGH, smoothstep(0.15, 0.9, y), mixed)
      mixRgb(mixed, ROCK_CAP, smoothstep(CAP_START, CAP_FULL, y), capped)
      setSrgb(scratch, capped)
      colors.push(scratch.r, scratch.g, scratch.b)
    }

    for (let tz = 0; tz < WORLD_SIZE; tz++) {
      for (let tx = 0; tx < WORLD_SIZE; tx++) {
        if (!isMountain(tx, tz)) continue
        const tile = tileIndex(tx, tz)
        const w = tileToWorld(tile)
        const h = map.height[tile]

        // The four corners of the tile, walked so that a fan from the centre
        // faces up: NW, SW, SE, NE.
        const ring: { x: number; y: number; z: number }[] = [
          { x: w.x - 0.5, y: cornerHeight(tx, tz), z: w.z - 0.5 },
          { x: w.x - 0.5, y: cornerHeight(tx, tz + 1), z: w.z + 0.5 },
          { x: w.x + 0.5, y: cornerHeight(tx + 1, tz + 1), z: w.z + 0.5 },
          { x: w.x + 0.5, y: cornerHeight(tx + 1, tz), z: w.z - 0.5 },
        ]
        // The peak sits off centre so a run of tiles does not read as a row of
        // identical tents.
        const px = w.x + jitter(tx, tz, seed ^ 0x51ed) * 0.28
        const pz = w.z + jitter(tx, tz, seed ^ 0x2b09) * 0.28
        const py = h * (1 + jitter(tx, tz, seed ^ 0x7c1d) * 0.07)

        for (let e = 0; e < 4; e++) {
          const a = ring[e]
          const b = ring[(e + 1) % 4]
          push(px, py, pz)
          push(a.x, a.y, a.z)
          push(b.x, b.y, b.z)
        }

        // Skirt: where the massif ends, drop the outer corners under the
        // ground plate so no slope is left hanging over the plain.
        const outward = [
          !isMountain(tx - 1, tz), // NW -> SW edge
          !isMountain(tx, tz + 1), // SW -> SE edge
          !isMountain(tx + 1, tz), // SE -> NE edge
          !isMountain(tx, tz - 1), // NE -> NW edge
        ]
        for (let e = 0; e < 4; e++) {
          if (!outward[e]) continue
          const a = ring[e]
          const b = ring[(e + 1) % 4]
          push(a.x, a.y, a.z)
          push(a.x, MOUNTAIN_SKIRT_Y, a.z)
          push(b.x, MOUNTAIN_SKIRT_Y, b.z)
          push(a.x, a.y, a.z)
          push(b.x, MOUNTAIN_SKIRT_Y, b.z)
          push(b.x, b.y, b.z)
        }
      }
    }

    if (positions.length === 0) return

    rockGeom = new BufferGeometry()
    rockGeom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    rockGeom.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
    rockGeom.computeVertexNormals()
    rockGeom.computeBoundingSphere()
    rockMesh = new Mesh(rockGeom, rockMaterial)
    rockMesh.frustumCulled = false
    rockMesh.castShadow = true
    rockMesh.receiveShadow = true
    group.add(rockMesh)
  }

  // --- contract ------------------------------------------------------------

  function clear(): void {
    if (waterMesh) {
      group.remove(waterMesh)
      waterMesh = null
    }
    if (waterGeom) {
      waterGeom.dispose()
      waterGeom = null
    }
    if (rockMesh) {
      group.remove(rockMesh)
      rockMesh = null
    }
    if (rockGeom) {
      rockGeom.dispose()
      rockGeom = null
    }
  }

  function sync(state: CityState): void {
    // Terrain is a pure function of the seed, so owning more of it changes
    // nothing. Rebuilding on every parcel purchase would throw away and
    // reallocate two buffers for a picture that cannot have changed.
    if (builtSeed === state.terrainSeed) return
    builtSeed = state.terrainSeed
    clear()
    const map = terrainFor(state)
    buildWater(map)
    buildMountains(map, state.terrainSeed)
  }

  const waterColor: RGB = [0, 0, 0]

  function frame(dt: number, night: number): void {
    time += dt
    rippleWater()
    // The ground layer lifts its plates as the light drops so the tint stays
    // readable after dark; water and rock are lifted by the same amount so the
    // shoreline does not separate into a bright band and a black one.
    const lift = 1 + NIGHT_LIFT * night
    mixRgb(WATER_TINT, WATER_NIGHT, night, waterColor)
    setSrgb(waterMaterial.color, waterColor).multiplyScalar(lift)
    waterMaterial.opacity = WATER_OPACITY + 0.06 * night
    rockMaterial.color.setRGB(lift, lift, lift)
  }

  function dispose(): void {
    clear()
    group.clear()
    waterMaterial.dispose()
    rockMaterial.dispose()
    waterX = new Float32Array(0)
    waterZ = new Float32Array(0)
    waterAmp = new Float32Array(0)
    builtSeed = null
  }

  return { sync, frame, object: group, dispose }
}
