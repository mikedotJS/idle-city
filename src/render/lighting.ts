/**
 * One directional light with a soft shadow map, a hemisphere fill, a small
 * ambient floor, and the four-minute day/night cycle that drives all of them
 * plus the sky and fog colour.
 *
 * The cycle is a function of sim time, never of wall clock or accumulated dt,
 * so a reloaded save resumes at the same hour of its own day.
 */

import {
  AmbientLight,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Object3D,
  PCFSoftShadowMap,
  Scene,
} from 'three'
import { WORLD_SIZE } from '../sim/config'
import { sampleSky, setSrgb, timeOfDay } from './palette'

export interface LightingRig {
  /** Advance the cycle. Returns the night factor, 0 in day, 1 at night. */
  update(simTime: number): number
  dispose(): void
}

export const SHADOW_MAP_TYPE = PCFSoftShadowMap

/**
 * Density tuned at WORLD_SIZE=12 (max view distance ~28.8) for ~74% visibility
 * at the farthest edge, a light haze rather than a wall. FogExp2's opacity
 * formula is exp(-(density * distance)²), so density must scale as 1/WORLD_SIZE
 * to keep that same edge visibility as the board — and therefore the maximum
 * useful view distance — grows.
 */
const FOG_DENSITY = 0.019 * (12 / WORLD_SIZE)

export function createLighting(scene: Scene): LightingRig {
  const sky = new Color()
  scene.background = sky
  const fog = new FogExp2(0x000000, FOG_DENSITY)
  scene.fog = fog

  const sun = new DirectionalLight(0xffffff, 2.5)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.radius = 3
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  // Corners of the board sit at (WORLD_SIZE/2)*sqrt(2) from the centre — the
  // frustum must reach at least that far, plus the existing +6 margin for how
  // long a shadow gets at dawn and dusk (that margin doesn't need to scale with
  // the board, it is about sun angle, not board size).
  const half = (WORLD_SIZE / 2) * Math.SQRT2 + 6
  sun.shadow.camera.left = -half
  sun.shadow.camera.right = half
  sun.shadow.camera.top = half
  sun.shadow.camera.bottom = -half
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 70
  sun.shadow.camera.updateProjectionMatrix()

  const target = new Object3D()
  scene.add(target)
  sun.target = target
  scene.add(sun)

  const hemi = new HemisphereLight(0xffffff, 0x444444, 1)
  scene.add(hemi)

  const ambient = new AmbientLight(0xffffff, 0.3)
  scene.add(ambient)

  const SUN_DISTANCE = 30

  function update(simTime: number): number {
    const dayT = timeOfDay(simTime)
    const s = sampleSky(dayT)

    setSrgb(sky, s.sky)
    fog.color.copy(sky)
    // Thin the fog out after dark; a dark fog colour otherwise eats the ground
    // tint at the far edge of the plot, which is the one thing that must stay.
    fog.density = FOG_DENSITY * (1 - 0.4 * s.night)

    // Sunrise at dayT 0.25, noon at 0.5, sunset at 0.75. Below the horizon the
    // same light becomes the moon: mirrored, flatter, and much dimmer.
    const angle = (dayT - 0.25) * Math.PI * 2
    let ex = Math.cos(angle)
    let ey = Math.sin(angle)
    if (ey < 0) {
      ex = -ex
      ey = -ey * 0.65
    }
    // A constant z tilt keeps shadows from ever collapsing to nothing at noon.
    const dx = ex
    const dy = ey * 0.95 + 0.12
    const dz = 0.45
    const len = Math.hypot(dx, dy, dz) || 1
    sun.position.set(
      (dx / len) * SUN_DISTANCE,
      (dy / len) * SUN_DISTANCE,
      (dz / len) * SUN_DISTANCE,
    )

    setSrgb(sun.color, s.sun)
    sun.intensity = s.sunIntensity
    sun.shadow.intensity = 0.82 - 0.4 * s.night

    setSrgb(hemi.color, s.hemiSky)
    setSrgb(hemi.groundColor, s.hemiGround)
    hemi.intensity = s.hemiIntensity

    setSrgb(ambient.color, s.ambient)
    ambient.intensity = s.ambientIntensity

    return s.night
  }

  function dispose(): void {
    scene.remove(sun, hemi, ambient, target)
    sun.dispose()
    hemi.dispose()
    ambient.dispose()
    scene.background = null
    scene.fog = null
  }

  return { update, dispose }
}
