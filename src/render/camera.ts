/**
 * Orbit rig. ~35 degree FOV, damped, pitch clamped to 25..65 degrees above the
 * ground, and the target leashed to the world origin so the diorama can never
 * be panned off screen.
 *
 * The rig frames the land you OWN, not the whole world. A new city owns a 6x6
 * plot inside a 12x12 board, so fitting the board leaves the city a stamp in
 * the middle of a large empty table. frameOwned() re-fits as parcels are
 * bought, easing rather than cutting so the purchase reads as the city opening
 * up.
 */

import { PerspectiveCamera, Vector3 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { WORLD_SIZE } from '../sim/config'

const DEG = Math.PI / 180

export interface CameraRig {
  camera: PerspectiveCamera
  controls: OrbitControls
  update(dt: number): void
  resize(width: number, height: number): void
  /** Ease the dolly out to frame a plot this many tiles across. */
  frameOwned(tilesAcross: number): void
  dispose(): void
}

export function createCameraRig(canvas: HTMLCanvasElement): CameraRig {
  const camera = new PerspectiveCamera(35, 1, 0.5, 200)

  // Distance at which a plot `tiles` across fills the frame, plus a margin so
  // the buyable ring stays visible as a hint that the board is bigger.
  const distanceFor = (tiles: number) =>
    ((tiles + 3.4) / 2 / Math.tan((35 * DEG) / 2)) * 1.02

  let desired = distanceFor(6)
  const start = desired
  camera.position.set(start * 0.62, start * 0.72, start * 0.62)

  const controls = new OrbitControls(camera, canvas)
  controls.target.set(0, 0.4, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.075
  controls.rotateSpeed = 0.75
  controls.zoomSpeed = 0.8
  controls.panSpeed = 0.6
  controls.screenSpacePanning = false
  // Pitch above the ground plane, so polar angle is measured the other way.
  controls.minPolarAngle = (90 - 65) * DEG
  controls.maxPolarAngle = (90 - 25) * DEG
  controls.minDistance = 5
  controls.maxDistance = WORLD_SIZE * 2.4
  controls.update()

  // The leash constrains how far the camera target can pan from the origin.
  // The board extends from -WORLD_SIZE/2 to +WORLD_SIZE/2 on both X and Z axes.
  // The farthest points (the four corners) are at distance (WORLD_SIZE/2)*sqrt(2)
  // from the origin. We add a 5% margin so the player can pan slightly beyond
  // the corners, giving comfortable breathing room at the board edges.
  const LEASH = (WORLD_SIZE / 2) * Math.SQRT2 * 1.05
  const flat = new Vector3()
  const toCamera = new Vector3()
  /** Cleared the moment the player touches the controls; their framing wins. */
  let autoFrame = true
  controls.addEventListener('start', () => {
    autoFrame = false
  })

  function frameOwned(tilesAcross: number): void {
    desired = Math.min(distanceFor(tilesAcross), controls.maxDistance)
  }

  function update(dt: number): void {
    if (autoFrame) {
      toCamera.subVectors(camera.position, controls.target)
      const current = toCamera.length()
      if (Math.abs(current - desired) > 0.01) {
        // Exponential ease, framerate independent.
        const next = current + (desired - current) * (1 - Math.exp(-dt * 2.2))
        camera.position.copy(controls.target).addScaledVector(toCamera.setLength(1), next)
      }
    }

    // Keep the target near the origin however the player pans.
    flat.set(controls.target.x, 0, controls.target.z)
    if (flat.lengthSq() > LEASH * LEASH) {
      flat.setLength(LEASH)
      controls.target.x = flat.x
      controls.target.z = flat.z
    }
    controls.target.y = 0.4
    controls.update(dt)
  }

  function resize(width: number, height: number): void {
    camera.aspect = height > 0 ? width / height : 1
    camera.updateProjectionMatrix()
  }

  function dispose(): void {
    controls.dispose()
  }

  return { camera, controls, update, resize, frameOwned, dispose }
}
