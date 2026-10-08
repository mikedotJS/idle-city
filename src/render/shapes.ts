/**
 * Shared procedural-geometry vocabulary: the primitive helpers used to build
 * every generated shape (buildings, and later decor) out of boxes, cylinders,
 * cones and blobs, plus the merge/tint helpers that stamp vertex colours and
 * combine parts into a single geometry.
 *
 * Extracted from render/buildings.ts so a future decor-rendering layer can
 * reuse the exact same procedural-shape style as buildings. Pure move, no
 * behaviour change.
 */

import { BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, IcosahedronGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Flat-shaded triangular prism roof, base at y = 0, ridge running along z. */
export function gableGeometry(w: number, d: number, h: number): BufferGeometry {
  const hw = w / 2
  const hd = d / 2
  const L0 = [-hw, 0, -hd]
  const L1 = [-hw, 0, hd]
  const R0 = [hw, 0, -hd]
  const R1 = [hw, 0, hd]
  const A0 = [0, h, -hd]
  const A1 = [0, h, hd]
  const tris = [
    L0, L1, A1, L0, A1, A0, // left slope
    R1, R0, A0, R1, A0, A1, // right slope
    L0, A0, R0, // gable end, -z
    R1, A1, L1, // gable end, +z
  ]
  const pos = new Float32Array(tris.length * 3)
  for (let i = 0; i < tris.length; i++) {
    pos[i * 3] = tris[i][0]
    pos[i * 3 + 1] = tris[i][1]
    pos[i * 3 + 2] = tris[i][2]
  }
  const geom = new BufferGeometry()
  geom.setAttribute('position', new BufferAttribute(pos, 3))
  geom.setAttribute('uv', new BufferAttribute(new Float32Array(tris.length * 2), 2))
  geom.computeVertexNormals()
  return geom
}

export function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): BufferGeometry {
  const g = new BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

export function cyl(
  rTop: number,
  rBottom: number,
  h: number,
  seg: number,
  x = 0,
  y = 0,
  z = 0,
): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBottom, h, seg)
  g.translate(x, y, z)
  return g
}

export function cone(r: number, h: number, seg: number, x = 0, y = 0, z = 0): BufferGeometry {
  const g = new ConeGeometry(r, h, seg)
  g.translate(x, y, z)
  return g
}

/** `sy` flattens or stretches the blob vertically before it is placed — a
 * landfill heap is a squashed blob, not a round one, and the squash is what
 * sells it. */
export function blob(r: number, x = 0, y = 0, z = 0, sy = 1): BufferGeometry {
  const g = new IcosahedronGeometry(r, 0)
  if (sy !== 1) g.scale(1, sy, 1)
  g.translate(x, y, z)
  return g
}

/** Make every part non-indexed and stamp a flat vertex colour on it. */
export function tint(geom: BufferGeometry, color: Color): BufferGeometry {
  const flat = geom.index ? geom.toNonIndexed() : geom
  if (flat !== geom) geom.dispose()
  const n = flat.getAttribute('position').count
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3))
  // Drop anything we do not use so every part merges with every other part.
  for (const name of Object.keys(flat.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') {
      flat.deleteAttribute(name)
    }
  }
  return flat
}

export function mergeParts(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  if (!merged) throw new Error('render/buildings: geometry merge failed')
  return merged
}
