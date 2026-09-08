/**
 * Orbit rig. ~35 degree FOV, damped, pitch clamped to 25..65 degrees above the
 * ground, dolly limits chosen so the whole 12x12 plot stays roughly framed at
 * either end, and the target leashed to the world origin so the diorama can
 * never be panned off screen.
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
  dispose(): void
}

export function createCameraRig(canvas: HTMLCanvasElement): CameraRig {
  const camera = new PerspectiveCamera(35, 1, 0.5, 200)

  // Far enough back that the plot plus a ring of unowned parcels is in frame.
  const fit = WORLD_SIZE / 2 / Math.tan((35 * DEG) / 2)
  camera.position.set(fit * 0.62, fit * 0.72, fit * 0.62)

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
  controls.minDistance = WORLD_SIZE * 0.62
  controls.maxDistance = WORLD_SIZE * 2.4
  controls.update()

  const LEASH = 2.5
  const flat = new Vector3()

  function update(dt: number): void {
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

  return { camera, controls, update, resize, dispose }
}
