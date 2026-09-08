import { PARCELS_PER_SIDE, PARCEL_SIZE, WORLD_SIZE } from './config'

export function tileIndex(x: number, z: number): number {
  return z * WORLD_SIZE + x
}

export function tileX(index: number): number {
  return index % WORLD_SIZE
}

export function tileZ(index: number): number {
  return Math.floor(index / WORLD_SIZE)
}

export function inBounds(x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < WORLD_SIZE && z < WORLD_SIZE
}

export function parcelIndex(px: number, pz: number): number {
  return pz * PARCELS_PER_SIDE + px
}

/** Which parcel a tile belongs to. */
export function parcelOfTile(index: number): number {
  const px = Math.floor(tileX(index) / PARCEL_SIZE)
  const pz = Math.floor(tileZ(index) / PARCEL_SIZE)
  return parcelIndex(px, pz)
}

/** Parcel indices orthogonally adjacent to the given parcel. */
export function parcelNeighbours(parcel: number): number[] {
  const px = parcel % PARCELS_PER_SIDE
  const pz = Math.floor(parcel / PARCELS_PER_SIDE)
  const out: number[] = []
  if (px > 0) out.push(parcelIndex(px - 1, pz))
  if (px < PARCELS_PER_SIDE - 1) out.push(parcelIndex(px + 1, pz))
  if (pz > 0) out.push(parcelIndex(px, pz - 1))
  if (pz < PARCELS_PER_SIDE - 1) out.push(parcelIndex(px, pz + 1))
  return out
}

export function tileDistance(a: number, b: number): number {
  const dx = tileX(a) - tileX(b)
  const dz = tileZ(a) - tileZ(b)
  return Math.hypot(dx, dz)
}

/** World-space centre of a tile. The plot is centred on the origin. */
export function tileToWorld(index: number): { x: number; z: number } {
  const offset = (WORLD_SIZE - 1) / 2
  return { x: tileX(index) - offset, z: tileZ(index) - offset }
}

/** Nearest tile index to a world-space point, or null if outside the world. */
export function worldToTile(x: number, z: number): number | null {
  const offset = (WORLD_SIZE - 1) / 2
  const tx = Math.round(x + offset)
  const tz = Math.round(z + offset)
  return inBounds(tx, tz) ? tileIndex(tx, tz) : null
}

/** Deterministic RNG. Returns [value in 0..1, next seed]. */
export function nextRandom(seed: number): [number, number] {
  let s = (seed | 0) || 1
  s ^= s << 13
  s ^= s >>> 17
  s ^= s << 5
  s |= 0
  return [(s >>> 0) / 4294967296, s]
}
