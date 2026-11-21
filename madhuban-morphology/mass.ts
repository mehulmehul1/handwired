// mass.ts — can the body carry itself?
//
// The sculpt is a signed distance field, and a signed distance field is an exact inside/outside
// oracle. So the quantities a creature system *should* reason about but almost always fakes —
// volume, mass, the distribution of that mass, the centre of mass, which feet carry the load, and
// whether the thing can stand at all — are not estimates here. They are integrals of the geometry.
//
// This is the first rung of "generalise the life form". Mass and support are **constraints**, and a
// constraint is the thing that lets a solver *derive* a body instead of an artist drawing it.
//
// Two numbers in this file are exact and two are not, and it matters which is which:
//   exact        volume, centre of mass, support polygon, load split  (all pure geometry)
//   a knob       density  (geometry x a tissue table; the table is a coarse estimate)
// Run `bun run madhuban-morphology/mass.ts` for the self-test first, then the cast.

import { pathToFileURL } from 'node:url'
import { sdfClass, loadSpecies, SRC, SPECIES, type Prim, type SpeciesId } from './species.ts'
import { initRaymarch, renderOne, makeCamera, encodePNG, bounds } from './raymarch.ts'
import { drawTextCentered } from './text.ts'

const load = (p: string) => import(pathToFileURL(p).href)
const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!

// ---------------------------------------------------------------- tissue table (the one knob)
// Denser tissue low in a limb pulls the centre of mass down; lungs and gut pull it up. Rough but
// ordered correctly: ivory/bone > hoof > muscle > skin/membrane > fat/viscera.
const TISSUE: Array<[RegExp, number, string]> = [
  [/tusk|horn|ivory/i, 1900, 'ivory'],
  [/nail|sole|hoof/i, 1300, 'hoof'],
  [/cranium|forehead|lowerjaw|chin|brow|temple|cannon|carpus|hock|calcaneus|elbow|shoulderpoint|hook|pin/i, 1550, 'bone'],
  [/trunk|triceps|forearmmuscle|scapmuscle|gaskin|thigh|upperarm|forearm|shin|quarter|neck|throat/i, 1060, 'muscle'],
  [/ribcage|lung|thorax/i, 350, 'ribcage-lungs'],
  [/abdomen|belly|flank|girth|brisket|withers|back|loin|rump|cardiac/i, 1000, 'viscera'],
  [/ear|eye|muzzle|face|midface|foot|tail|tuft|skin|fur|beak|fin|feather/i, 1050, 'skin'],
]
function tissue(tag: string): { rho: number; name: string } {
  for (const [re, rho, name] of TISSUE) if (re.test(tag)) return { rho, name }
  return { rho: 1050, name: 'skin' }
}

// ---------------------------------------------------------------- the integral
export type Mass = {
  h: number // the voxel step this measurement was taken at — part of the result, not a detail
  hRequested: number // voxel step requested before budget coarsening
  minY: number // lowest occupied voxel y coordinate
  maxY: number // highest occupied voxel y coordinate
  voxels: number
  volume: number
  volError: number // first-order bound on the volume error from surface-straddling voxels (m^3)
  height: number
  massAt: (rho: number) => number
  totalMassKg: number // tissue-weighted total mass (kg)
  com: number[] // uniform density (exact)
  comTissue: number[] // tissue-weighted (depends on the table)
  inertia: number[][] // 3x3 uniform inertia tensor about com (SPD)
  inertiaTissue: number[][] // 3x3 tissue-weighted inertia tensor about comTissue (SPD)
  support: number[][] // convex hull of the ground contacts, (x,z)
  supportArea: number
  contactArea: number // ground footprint (feet only, tails rejected)
  limbArea: number // limb cross-section below the belly line (legs alone, before merging into torso)
  limbLoad: number // Pa, at density 1000: mass*g / limbArea
  bellyHeight: number // clearance at the belly line — the height where legs become torso
  margin: number // signed distance from the (x,z) of the CoM to the hull boundary
  loadFore: number // fraction of weight on the forefeet
  contactFore: number[]
  contactHind: number[]
  tissues: Array<{ name: string; volume: number }>
}

export async function measure(prims: Prim[], opt: { h?: number } = {}): Promise<Mass> {
  const M = await sdfClass()

  // bbox + per-prim integer voxel ranges
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]
  const bs = prims.map((p) => bounds(p))
  for (const b of bs) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i]!, b.c[i]! - b.r); hi[i] = Math.max(hi[i]!, b.c[i]! + b.r)
  }
  const span = [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!] as const
  const bodyLen = Math.max(span[0], span[1], span[2])
  let h = opt.h ?? Math.min(0.05, Math.max(0.001, bodyLen / 120))
  const hRequested = h

  // A voxel budget, because a bounding box is a poor model of a body. A spider's legs make an extent
  // that is huge next to its limb thickness, and the natural step asks for hundreds of millions of
  // cells. Coarsen until the grid fits, and return the step actually used: a coarse answer that says
  // it is coarse is worth more than a run that never returns.
  const BUDGET = 8_000_000
  let nx = 0, ny = 0, nz = 0
  for (let guard = 0; guard < 40; guard++) {
    nx = Math.ceil(span[0] / h) + 2
    ny = Math.ceil(span[1] / h) + 2
    nz = Math.ceil(span[2] / h) + 2
    if (nx * ny * nz <= BUDGET) break
    h *= Math.cbrt((nx * ny * nz) / BUDGET) * 1.02
  }
  const o = [lo[0]! - h, lo[1]! - h, lo[2]! - h]

  const cell = bs.map((b) => ({
    x0: Math.max(0, Math.floor((b.c[0]! - b.r - o[0]!) / h) - 1),
    x1: Math.min(nx - 1, Math.ceil((b.c[0]! + b.r - o[0]!) / h) + 1),
    y0: Math.max(0, Math.floor((b.c[1]! - b.r - o[1]!) / h) - 1),
    y1: Math.min(ny - 1, Math.ceil((b.c[1]! + b.r - o[1]!) / h) + 1),
    z0: Math.max(0, Math.floor((b.c[2]! - b.r - o[2]!) / h) - 1),
    z1: Math.min(nz - 1, Math.ceil((b.c[2]! + b.r - o[2]!) / h) + 1),
  }))

  const cellVol = h * h * h
  const layer = new Float64Array(ny) // horizontal cross-section, per height — the body's profile
  const cand: Prim[] = []
  const contacts: number[][] = []
  const tissueVol = new Map<string, number>()
  let vol = 0, wsum = 0, sx = 0, sy = 0, sz = 0
  let sr = 0, srx = 0, sry = 0, srz = 0
  let sxx = 0, syy = 0, szz = 0, sxy = 0, sxz = 0, syz = 0
  let srxx = 0, sryy = 0, srzz = 0, srxy = 0, srxz = 0, sryz = 0
  let voxels = 0
  // Surface-straddling voxels. Each one contributes a first-order volume estimate whose error is at
  // most h/2 times its own cross-section, so the count is a direct, honest error bar on the volume —
  // and the way to tell whether a thin body was resolved at all instead of quietly integrating to
  // almost nothing. `straddle` is that error bar; `notResolved` is what you get when it swamps `vol`.
  let straddle = 0
  let minY = 1e9, maxY = -1e9

  for (let ix = 0; ix < nx; ix++) {
    const x = o[0]! + (ix + 0.5) * h
    for (let iy = 0; iy < ny; iy++) {
      const y = o[1]! + (iy + 0.5) * h
      for (let iz = 0; iz < nz; iz++) {
        const z = o[2]! + (iz + 0.5) * h
        cand.length = 0
        for (let i = 0; i < prims.length; i++) {
          const c = cell[i]!
          if (ix < c.x0 || ix > c.x1 || iy < c.y0 || iy > c.y1 || iz < c.z0 || iz > c.z1) continue
          cand.push(prims[i]!)
        }
        if (cand.length === 0) continue
        const d = M.evalList(cand, x, y, z)
        // first-order partial volume: a voxel straddling the surface contributes its inside fraction
        const f = 0.5 - d / h
        if (f <= 0) continue
        const w = f > 1 ? 1 : f
        voxels++
        if (f < 1) straddle++
        vol += w * cellVol
        wsum += w
        layer[iy]! += w
        sx += w * x; sy += w * y; sz += w * z

        const dmU = w * cellVol * 1000
        sxx += dmU * x * x; syy += dmU * y * y; szz += dmU * z * z
        sxy += dmU * x * y; sxz += dmU * x * z; syz += dmU * y * z

        // nearest prim owns this voxel's tissue
        let bd = 1e9, bt = ''
        for (let i = 0; i < cand.length; i++) {
          const pr = cand[i]!
          if (pr.carve) continue
          const di = Math.abs(M.dist(pr, x, y, z))
          if (di < bd) { bd = di; bt = pr.tag }
        }
        const tk = tissue(bt)
        const rw = tk.rho * w
        sr += rw; srx += rw * x; sry += rw * y; srz += rw * z
        const dmT = rw * cellVol
        srxx += dmT * x * x; sryy += dmT * y * y; srzz += dmT * z * z
        srxy += dmT * x * y; srxz += dmT * x * z; sryz += dmT * y * z
        tissueVol.set(tk.name, (tissueVol.get(tk.name) || 0) + w * cellVol)
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  // ---- cross-sections -------------------------------------------------------
  // Two slices of the solid. Both are exact areas off the grid.
  //   limbArea — mean horizontal cross-section below the belly line (legs alone, before merging into torso).
  //     That is below the belly, so it is the limbs alone: the area that actually carries the animal,
  //     and the area the allometric law is about.
  //   contact  — the bottom slab, clustered into feet. Clustering matters: a cow's tail switch and a
  //     rat's tail drag near the ground and carry no weight.
  const H = maxY - minY
  const scan = (yLo: number, yHi: number): { occ: Uint8Array; n: number } => {
    const occ = new Uint8Array(nx * nz)
    let n = 0
    for (let ix = 0; ix < nx; ix++) {
      const x = o[0]! + (ix + 0.5) * h
      for (let iy = Math.max(0, Math.floor((yLo - o[1]!) / h)); iy < Math.min(ny, Math.ceil((yHi - o[1]!) / h)); iy++) {
        const y = o[1]! + (iy + 0.5) * h
        if (y < yLo || y > yHi) continue
        for (let iz = 0; iz < nz; iz++) {
          const z = o[2]! + (iz + 0.5) * h
          cand.length = 0
          for (let i = 0; i < prims.length; i++) {
            const c = cell[i]!
            if (ix < c.x0 || ix > c.x1 || iy < c.y0 || iy > c.y1 || iz < c.z0 || iz > c.z1) continue
            cand.push(prims[i]!)
          }
          if (cand.length === 0) continue
          if (M.evalList(cand, x, y, z) < 0 && !occ[ix * nz + iz]) { occ[ix * nz + iz] = 1; n++ }
        }
      }
    }
    return { occ, n }
  }

  // The limbs: the mean cross-section of everything below the belly line. The belly line is the
  // lowest height at which the horizontal cross-section passes half of the body's largest
  // cross-section — i.e. where the legs have merged into the torso. Taking an arbitrary fraction of
  // the height instead lands on the ankle for a long-legged animal and the thigh for a short one,
  // which is a confounder, not a measurement.
  const areaAt = (iy: number) => layer[iy]! * h * h
  let iyLo = 0
  while (iyLo < ny - 1 && layer[iyLo]! <= 0) iyLo++
  let maxArea = 0
  for (let iy = iyLo; iy < ny; iy++) maxArea = Math.max(maxArea, areaAt(iy))
  let iyB = ny - 1
  for (let iy = iyLo; iy < ny; iy++) if (areaAt(iy) > 0.5 * maxArea) { iyB = iy; break }
  let limbVol = 0
  for (let iy = iyLo; iy < iyB; iy++) limbVol += areaAt(iy) * h
  const bellyY = o[1]! + iyB * h
  const limbLen = Math.max(bellyY - minY, h)
  const limbArea = limbVol / limbLen

  const { occ, n: occCells } = scan(minY, minY + Math.max(2.5 * h, 0.02))
  const label = new Int32Array(nx * nz).fill(-1)
  const compSize: number[] = []
  const stack: number[] = []
  for (let s = 0; s < occ.length; s++) {
    if (!occ[s] || label[s]! >= 0) continue
    const id = compSize.length
    let n = 0
    stack.length = 0
    stack.push(s)
    label[s] = id
    while (stack.length) {
      const q = stack.pop()!
      n++
      const qx = (q / nz) | 0, qz = q % nz
      if (qx > 0) { const t = q - nz; if (occ[t] && label[t]! < 0) { label[t] = id; stack.push(t) } }
      if (qx < nx - 1) { const t = q + nz; if (occ[t] && label[t]! < 0) { label[t] = id; stack.push(t) } }
      if (qz > 0) { const t = q - 1; if (occ[t] && label[t]! < 0) { label[t] = id; stack.push(t) } }
      if (qz < nz - 1) { const t = q + 1; if (occ[t] && label[t]! < 0) { label[t] = id; stack.push(t) } }
    }
    compSize.push(n)
  }
  // Keep a ground-contact cluster if it is a real foot. The threshold must be scale-free: an absolute
  // cell count silently deletes a rat's feet (a foot is 3 cells at h=0.01) while keeping an elephant's.
  // So compare each cluster to the largest one instead — four feet are similar sizes, a tail is not.
  const maxComp = compSize.reduce((a, b) => Math.max(a, b), 0)
  const keep = new Set<number>()
  for (let i = 0; i < compSize.length; i++) if (compSize[i]! >= Math.max(2, 0.15 * maxComp)) keep.add(i)
  let contactCells = 0
  for (let s = 0; s < occ.length; s++) {
    if (!occ[s] || !keep.has(label[s]!)) continue
    contactCells++
    contacts.push([o[0]! + (((s / nz) | 0) + 0.5) * h, o[2]! + ((s % nz) + 0.5) * h])
  }
  const contactArea = contactCells * h * h

  const com = [sx / wsum, sy / wsum, sz / wsum]
  const comTissue = [srx / sr, sry / sr, srz / sr]
  const totalMassKg = sr * cellVol
  const inertia = computeInertiaFromMoments(vol * 1000, com, sxx, syy, szz, sxy, sxz, syz, h, voxels)
  const inertiaTissue = computeInertiaFromMoments(totalMassKg, comTissue, srxx, sryy, srzz, srxy, srxz, sryz, h, voxels)

  const areaFloor = Math.max(1e-8, 0.25 * h * h)
  const hullPts = hull(contacts)
  const hasSupport = hullPts.length >= 3 && Math.abs(polyArea(hullPts)) > areaFloor
  const inside = hasSupport && pointInHull(hullPts, com[0]!, com[2]!)
  const margin = !hasSupport ? NaN : (inside ? 1 : -1) * edgeDistance(hullPts, com[0]!, com[2]!)
  const supportArea = Math.abs(polyArea(hullPts))

  // lever rule about the centre of mass: fore feet in front of it, hind behind
  const fore = contacts.filter((p) => p[1] > com[2]!)
  const hind = contacts.filter((p) => p[1] <= com[2]!)
  const cf = fore.length > 0 ? centroid(fore) : [NaN, NaN]
  const ch = hind.length > 0 ? centroid(hind) : [NaN, NaN]
  const loadFore = (fore.length === 0 || hind.length === 0 || cf[1] === ch[1] || !Number.isFinite(cf[1]) || !Number.isFinite(ch[1]))
    ? NaN
    : (com[2]! - ch[1]!) / (cf[1]! - ch[1]!)

  return {
    voxels, volume: vol, height: maxY - minY, minY, maxY, h, hRequested,
    volError: 0.5 * straddle * cellVol,
    massAt: (rho) => vol * rho,
    totalMassKg,
    com, comTissue,
    inertia, inertiaTissue,
    support: hullPts, supportArea, margin, loadFore,
    contactArea, limbArea, limbLoad: (vol * 1000 * 9.81) / (limbArea || 1e-9), bellyHeight: bellyY - minY,
    contactFore: cf, contactHind: ch,
    tissues: [...tissueVol].map(([name, volume]) => ({ name, volume })).sort((a, b) => b.volume - a.volume),
  }
}

// ---------------------------------------------------------------- 2D geometry
export function centroid(ps: number[][]): number[] {
  if (!ps.length) return [NaN, NaN]
  let x = 0, z = 0
  for (const p of ps) { x += p[0]!; z += p[1]! }
  return [x / ps.length, z / ps.length]
}
export function hull(pts: number[][]): number[][] {
  if (pts.length < 3) return pts.slice()
  const p = pts.slice().sort((a, b) => (a[0]! - b[0]!) || (a[1]! - b[1]!))
  const cross2 = (o: number[], a: number[], b: number[]) => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!)
  const lower: number[][] = []
  for (const q of p) { while (lower.length >= 2 && cross2(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop(); lower.push(q) }
  const upper: number[][] = []
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]!; while (upper.length >= 2 && cross2(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop(); upper.push(q) }
  lower.pop(); upper.pop()
  return lower.concat(upper)
}
export function pointInHull(h: number[][], x: number, z: number): boolean {
  if (h.length < 3) return false
  let sign = 0
  for (let i = 0; i < h.length; i++) {
    const a = h[i]!, b = h[(i + 1) % h.length]!
    const c = (b[0]! - a[0]!) * (z - a[1]!) - (b[1]! - a[1]!) * (x - a[0]!)
    if (Math.abs(c) < 1e-9) continue
    const s = c > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}
export function edgeDistance(h: number[][], x: number, z: number): number {
  let best = 1e9
  for (let i = 0; i < h.length; i++) {
    const a = h[i]!, b = h[(i + 1) % h.length]!
    const vx = b[0]! - a[0]!, vz = b[1]! - a[1]!
    const L2 = vx * vx + vz * vz || 1
    let t = ((x - a[0]!) * vx + (z - a[1]!) * vz) / L2
    t = Math.max(0, Math.min(1, t))
    best = Math.min(best, Math.hypot(x - (a[0]! + vx * t), z - (a[1]! + vz * t)))
  }
  return best
}
export function polyArea(h: number[][]): number {
  let a = 0
  for (let i = 0; i < h.length; i++) { const p = h[i]!, q = h[(i + 1) % h.length]!; a += p[0]! * q[1]! - q[0]! * p[1]! }
  return a / 2
}

export function computeStabilityMargin(contacts: number[][], com: number[]): {
  hull: number[][]
  area: number
  inside: boolean
  margin: number
} {
  const hullPts = hull(contacts)
  const area = Math.abs(polyArea(hullPts))
  const hasSupport = hullPts.length >= 3 && area > 1e-8
  const zIdx = com.length === 3 ? 2 : 1
  const inside = hasSupport && pointInHull(hullPts, com[0]!, com[zIdx]!)
  const margin = !hasSupport ? NaN : (inside ? 1 : -1) * edgeDistance(hullPts, com[0]!, com[zIdx]!)
  return { hull: hullPts, area, inside, margin }
}

export function computeInertiaFromMoments(
  m: number,
  com: number[],
  sxx: number, syy: number, szz: number,
  sxy: number, sxz: number, syz: number,
  h: number, nVoxels: number
): number[][] {
  if (m <= 0) return [[0,0,0],[0,0,0],[0,0,0]]
  const cx = com[0]!, cy = com[1]!, cz = com[2]!
  const selfInertia = (1 / 6) * m * h * h
  const Ixx = Math.max(selfInertia, (syy - m * cy * cy) + (szz - m * cz * cz) + selfInertia)
  const Iyy = Math.max(selfInertia, (sxx - m * cx * cx) + (szz - m * cz * cz) + selfInertia)
  const Izz = Math.max(selfInertia, (sxx - m * cx * cx) + (syy - m * cy * cy) + selfInertia)
  const Ixy = -(sxy - m * cx * cy)
  const Ixz = -(sxz - m * cx * cz)
  const Iyz = -(syz - m * cy * cz)
  return [
    [Ixx, Ixy, Ixz],
    [Ixy, Iyy, Iyz],
    [Ixz, Iyz, Izz]
  ]
}

export type SegmentMassProperties = {
  boneName: string
  massKg: number
  localCom: number[]
  inertia3x3: number[][]
}

export type SegmentalMassProperties = {
  totalMassKg: number
  com: number[]
  supportPolygon: number[][]
  restingForeHindSplit: number
  segments: SegmentMassProperties[]
}

export async function computeSegmentalMassProperties(
  sdf: any,
  rigSpec?: any,
  opt: { h?: number } = {}
): Promise<SegmentalMassProperties> {
  const M = await sdfClass()
  let prims: Prim[]
  let rig: any = rigSpec
  if (Array.isArray(sdf)) {
    prims = sdf
  } else if (typeof sdf === 'string') {
    const loaded = await loadSpecies(sdf as SpeciesId)
    prims = loaded.prims
    if (!rig) rig = loaded.rig
  } else if (sdf && Array.isArray(sdf.prims)) {
    prims = sdf.prims
    if (!rig && sdf.rig) rig = sdf.rig
  } else {
    throw new Error('computeSegmentalMassProperties: invalid sdf argument')
  }

  const baseMass = await measure(prims, opt)
  const h = baseMass.h

  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]
  const bs = prims.map((p) => bounds(p))
  for (const b of bs) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i]!, b.c[i]! - b.r); hi[i] = Math.max(hi[i]!, b.c[i]! + b.r)
  }
  const span = [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!] as const
  const nx = Math.ceil(span[0] / h) + 2
  const ny = Math.ceil(span[1] / h) + 2
  const nz = Math.ceil(span[2] / h) + 2
  const o = [lo[0]! - h, lo[1]! - h, lo[2]! - h]

  const cell = bs.map((b) => ({
    x0: Math.max(0, Math.floor((b.c[0]! - b.r - o[0]!) / h) - 1),
    x1: Math.min(nx - 1, Math.ceil((b.c[0]! + b.r - o[0]!) / h) + 1),
    y0: Math.max(0, Math.floor((b.c[1]! - b.r - o[1]!) / h) - 1),
    y1: Math.min(ny - 1, Math.ceil((b.c[1]! + b.r - o[1]!) / h) + 1),
    z0: Math.max(0, Math.floor((b.c[2]! - b.r - o[2]!) / h) - 1),
    z1: Math.min(nz - 1, Math.ceil((b.c[2]! + b.r - o[2]!) / h) + 1),
  }))

  const cellVol = h * h * h
  const cand: Prim[] = []

  type SegmentAccum = {
    boneName: string
    mass: number
    sx: number; sy: number; sz: number
    sxx: number; syy: number; szz: number
    sxy: number; sxz: number; syz: number
    nVoxels: number
  }
  const boneMap = new Map<string, SegmentAccum>()

  for (let ix = 0; ix < nx; ix++) {
    const x = o[0]! + (ix + 0.5) * h
    for (let iy = 0; iy < ny; iy++) {
      const y = o[1]! + (iy + 0.5) * h
      for (let iz = 0; iz < nz; iz++) {
        const z = o[2]! + (iz + 0.5) * h
        cand.length = 0
        for (let i = 0; i < prims.length; i++) {
          const c = cell[i]!
          if (ix < c.x0 || ix > c.x1 || iy < c.y0 || iy > c.y1 || iz < c.z0 || iz > c.z1) continue
          cand.push(prims[i]!)
        }
        if (cand.length === 0) continue
        const d = M.evalList(cand, x, y, z)
        const f = 0.5 - d / h
        if (f <= 0) continue
        const w = f > 1 ? 1 : f

        let bd = 1e9, bt = '', bb = ''
        for (let i = 0; i < cand.length; i++) {
          const pr = cand[i]!
          if (pr.carve) continue
          const di = Math.abs(M.dist(pr, x, y, z))
          if (di < bd) { bd = di; bt = pr.tag; bb = pr.bone || pr.group || 'body' }
        }
        if (!bb) bb = 'body'
        const tk = tissue(bt)
        const dm = tk.rho * w * cellVol

        let seg = boneMap.get(bb)
        if (!seg) {
          seg = { boneName: bb, mass: 0, sx: 0, sy: 0, sz: 0, sxx: 0, syy: 0, szz: 0, sxy: 0, sxz: 0, syz: 0, nVoxels: 0 }
          boneMap.set(bb, seg)
        }
        seg.mass += dm
        seg.sx += dm * x; seg.sy += dm * y; seg.sz += dm * z
        seg.sxx += dm * x * x; seg.syy += dm * y * y; seg.szz += dm * z * z
        seg.sxy += dm * x * y; seg.sxz += dm * x * z; seg.syz += dm * y * z
        seg.nVoxels++
      }
    }
  }

  const segments: SegmentMassProperties[] = []
  let totalMassKg = 0
  let totSx = 0, totSy = 0, totSz = 0

  for (const seg of boneMap.values()) {
    if (seg.mass <= 0) continue
    totalMassKg += seg.mass
    totSx += seg.sx; totSy += seg.sy; totSz += seg.sz
    const segCom = [seg.sx / seg.mass, seg.sy / seg.mass, seg.sz / seg.mass]
    
    let head = [0, 0, 0]
    if (rig) {
      if (rig.BONE && rig.BONE[seg.boneName]) {
        const bdef = rig.BONE[seg.boneName]
        head = bdef.head || (rig.J && bdef.headJ ? rig.J[bdef.headJ] : [0, 0, 0]) || [0, 0, 0]
      } else if (Array.isArray(rig.BONES)) {
        const bdef = rig.BONES.find((b: any) => b.name === seg.boneName)
        if (bdef) head = bdef.head || (rig.J && bdef.headJ ? rig.J[bdef.headJ] : [0, 0, 0]) || [0, 0, 0]
      } else if (rig.J && rig.J[seg.boneName]) {
        head = rig.J[seg.boneName]
      }
    }
    const localCom = [segCom[0]! - head[0]!, segCom[1]! - head[1]!, segCom[2]! - head[2]!]
    const inertia3x3 = computeInertiaFromMoments(
      seg.mass, segCom,
      seg.sxx, seg.syy, seg.szz,
      seg.sxy, seg.sxz, seg.syz,
      h, seg.nVoxels
    )
    segments.push({
      boneName: seg.boneName,
      massKg: seg.mass,
      localCom,
      inertia3x3,
    })
  }

  const com = totalMassKg > 0 ? [totSx / totalMassKg, totSy / totalMassKg, totSz / totalMassKg] : baseMass.comTissue

  return {
    totalMassKg,
    com,
    supportPolygon: baseMass.support,
    restingForeHindSplit: baseMass.loadFore,
    segments,
  }
}

// ---------------------------------------------------------------- drawing
function line(t: { rgba: Uint8Array; w: number; h: number }, a: number[], b: number[], col: number[]) {
  const n = Math.ceil(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!)) + 1
  for (let i = 0; i <= n; i++) {
    const x = Math.round(a[0]! + ((b[0]! - a[0]!) * i) / n)
    const y = Math.round(a[1]! + ((b[1]! - a[1]!) * i) / n)
    if (x < 0 || y < 0 || x >= t.w || y >= t.h) continue
    const k = (y * t.w + x) * 4
    t.rgba[k] = col[0]!; t.rgba[k + 1] = col[1]!; t.rgba[k + 2] = col[2]!; t.rgba[k + 3] = 255
  }
}
function disc(t: { rgba: Uint8Array; w: number; h: number }, c: number[], r: number, col: number[]) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r) continue
    const x = Math.round(c[0]!) + dx, y = Math.round(c[1]!) + dy
    if (x < 0 || y < 0 || x >= t.w || y >= t.h) continue
    const k = (y * t.w + x) * 4
    t.rgba[k] = col[0]!; t.rgba[k + 1] = col[1]!; t.rgba[k + 2] = col[2]!; t.rgba[k + 3] = 255
  }
}
function project(cam: any, p: number[], w: number, h: number): number[] | null {
  const v = sub(p, cam.eye)
  const z = dot(v, cam.fwd)
  if (z <= 1e-6) return null
  const x = dot(v, cam.right), y = dot(v, cam.up)
  const sx = x / (z * cam.tanHalf * cam.aspect)
  const sy = y / (z * cam.tanHalf)
  return [((sx + 1) / 2) * w, ((1 - sy) / 2) * h]
}

// ---------------------------------------------------------------- self-test
async function selfTest() {
  const M = await sdfClass()
  const out: string[] = []
  // 1. an analytic sphere: the integrator must recover 4/3 pi r^3
  for (const R of [0.5, 2]) {
    const m = new M()
    m.sphere({ tag: 'ball', c: [0, 0, 0], rad: R, k: 0 })
    const r = await measure(m.prims as Prim[], { h: 0.04 })
    const exact = (4 / 3) * Math.PI * R ** 3
    out.push(`  sphere R=${R}   exact ${exact.toFixed(4)}   integrated ${r.volume.toFixed(4)}   err ${(((r.volume - exact) / exact) * 100).toFixed(2)}%   CoM ${r.com.map((v) => v.toFixed(3)).join(',')}`)
  }
  // 2. a round cone with equal radii is a capsule: volume = pi r^2 L + 4/3 pi r^3.
  //    Its CoM must sit at half height, its support polygon must be its circular base.
  const c = new M()
  c.cone({ tag: 'leg', a: [0, 0, 0], b: [0, 1, 0], ra: 0.25, rb: 0.25, k: 0 })
  const cy = await measure(c.prims as Prim[], { h: 0.015 })
  const capV = Math.PI * 0.0625 * 1 + (4 / 3) * Math.PI * 0.015625
  out.push(`  capsule 0.25r x 1m   exact ${capV.toFixed(4)}   integrated ${cy.volume.toFixed(4)}   err ${(((cy.volume - capV) / capV) * 100).toFixed(2)}%   CoM y ${cy.com[1]!.toFixed(3)} (want 0.5)`)
  // 3. a table: four legs of radius r under a slab. The limb section must come out at 4 pi r^2, and
  //    the belly line at the underside of the slab.
  const t3 = new M()
  for (const [sx, sz] of [[0.4, 0.5], [-0.4, 0.5], [0.4, -0.5], [-0.4, -0.5]]) {
    t3.cone({ tag: 'leg', a: [sx, 0, sz], b: [sx, 1, sz], ra: 0.1, rb: 0.1, k: 0 })
  }
  t3.ell({ tag: 'body', c: [0, 1.15, 0], r: [0.6, 0.2, 0.8], axis: [0, 0, 1], up: [0, 1, 0], k: 0.02 })
  const tb = await measure(t3.prims as Prim[], { h: 0.02 })
  const wantLimb = 4 * Math.PI * 0.01
  out.push(`  table, 4 legs r=0.1   limb section ${tb.limbArea.toFixed(4)} (want ${wantLimb.toFixed(4)} = 4 pi r^2)   belly line ${tb.bellyHeight.toFixed(3)} m (want ~0.95)`)
  return out
}
// ---------------------------------------------------------------- main
const DENSITY_WHOLE = 1000 // kg/m3 — a mammal body averages ~1000 (elephant ~970, cat ~1050)

async function main() {
  await initRaymarch()
  console.log('self-test (the integrator against closed-form volumes):')
  for (const s of await selfTest()) console.log(s)
  console.log('')

  type Row = { id: string; prims: Prim[]; m: Mass }
  const rows: Row[] = []

  const elephantMod: any = await load(`${SRC}/species/elephant/rig.js`)
  const elephantSculpt: any = await load(`${SRC}/species/elephant/sculpt.js`)
  {
    const m = new (await sdfClass())()
    elephantSculpt.sculptElephant(m, elephantMod.elephantRig())
    rows.push({ id: 'elephant', prims: m.prims as Prim[], m: await measure(m.prims as Prim[]) })
  }
  for (const sp of SPECIES) {
    const L = await loadSpecies(sp)
    rows.push({ id: sp, prims: L.prims, m: await measure(L.prims) })
  }

  // the scaffold elephant the loop grew — same skeleton class, generic builder
  {
    const { grow, ELEPHANT } = await import('./elephant.ts')
    const g = await grow(ELEPHANT)
    rows.push({ id: 'elephant(scaffold)', prims: g.prims as Prim[], m: await measure(g.prims as Prim[]) })
  }

  const pad = (s: string, n: number) => s.padEnd(n)
  const num = (v: number, n = 2) => v.toFixed(n).padStart(8)
  console.log(pad('animal', 20) + pad('prims', 6) + pad('vol m3', 9) + pad('mass kg', 9) + pad('h m', 7) + pad('CoM y', 7) + pad('margin', 8) + pad('foot m2', 9) + pad('limb m2', 9) + pad('load kPa', 9) + pad('', 1) + 'fore')
  for (const r of rows.sort((a, b) => b.m.volume - a.m.volume)) {
    const m = r.m
    const verdict = Number.isNaN(m.margin) ? 'NO SUPPORT' : m.margin >= 0 ? 'STANDS' : 'FALLS'
    console.log(
      pad(r.id, 20) + pad(String(r.prims.length), 6) + num(m.volume, 3) + pad('', 1) + num(m.massAt(DENSITY_WHOLE), 0) + pad('', 1) +
      num(m.height, 2) + pad('', 1) + num(m.com[1]!, 2) + pad('', 1) +
      (Number.isNaN(m.margin) ? pad('   —', 7) : num(m.margin, 3)) + pad('', 1) + num(m.contactArea, 3) + pad('', 1) +
      num(m.limbArea, 3) + pad('', 1) + num(m.limbLoad / 1000, 1) + pad('', 1) +
      pad(verdict, 11) + (Number.isNaN(m.loadFore) ? '—' : (100 * m.loadFore).toFixed(0) + '%'),
    )
  }

  console.log('\nthe elephant in detail')
  const el = rows.find((r) => r.id === 'elephant')!
  console.log(`  volume            ${el.m.volume.toFixed(3)} m3`)
  console.log(`  mass @1000        ${el.m.massAt(1000).toFixed(0)} kg      (a real 3.0 m bush elephant: 4000-6300 kg)`)
  console.log(`  CoM (uniform)     ${el.m.com.map((v) => v.toFixed(3)).join(', ')}   at ${(100 * (el.m.com[1]! - el.m.minY) / el.m.height).toFixed(0)}% of height`)
  console.log(`  CoM (tissue)      ${el.m.comTissue.map((v) => v.toFixed(3)).join(', ')}   tissue pulls it ${(100 * Math.abs(el.m.comTissue[1]! - el.m.com[1]!) / el.m.com[1]!).toFixed(1)}% ${el.m.comTissue[1]! > el.m.com[1]! ? 'up' : 'down'}`)
  console.log(`  support polygon   ${el.m.supportArea.toFixed(3)} m2 hull, ${el.m.support.length} hull points`)
  console.log(`  ground footprint  ${el.m.contactArea.toFixed(3)} m2 (the four feet, tails rejected)`)
  console.log(`  limb section      ${el.m.limbArea.toFixed(3)} m2 mean below the belly  ->  limb load ${(el.m.limbLoad / 1000).toFixed(1)} kPa (belly line at ${el.m.bellyHeight.toFixed(2)} m)`)
  console.log(`  stability margin  ${el.m.margin.toFixed(3)} m inside the front/hind edge`)
  console.log(`  fore/hind load    ${(100 * el.m.loadFore).toFixed(0)}% fore, ${(100 * (1 - el.m.loadFore)).toFixed(0)}% hind`)
  console.log(`  tissue volumes    ${el.m.tissues.slice(0, 5).map((t) => `${t.name} ${(100 * t.volume / el.m.volume).toFixed(0)}%`).join(', ')}`)

  const sc = rows.find((r) => r.id === 'elephant(scaffold)')!
  console.log(`\n  the scaffold, for comparison: volume ${sc.m.volume.toFixed(3)} m3, mass ${sc.m.massAt(1000).toFixed(0)} kg, margin ${sc.m.margin.toFixed(3)} m`)

  // ---- sheet: top view with the support polygon and the CoM, side view with the CoM line
  const W = 430, H = 340
  type Tile = { rgba: Uint8Array; w: number; h: number }
  const ink = [38, 28, 22], red = [176, 42, 32], teal = [22, 96, 108]
  const draw = (id: string, prims: Prim[], m: Mass, label: string): Tile => {
    const cam = makeCamera(prims, { az: 0.02, el: 1.35, w: W, h: H })
    const t: Tile = renderOne(prims, cam, W, H, { light: [0.4, 0.8, 0.3] })
    // ground-projected body outline: sample the contact slab points is noisy, so just the hull
    const hp = m.support.map((p) => project(cam, [p[0]!, 0, p[1]!], W, H)).filter(Boolean) as number[][]
    for (let i = 0; i < hp.length; i++) line(t, hp[i]!, hp[(i + 1) % hp.length]!, ink)
    const cf = project(cam, [m.contactFore[0]!, 0, m.contactFore[1]!], W, H)
    const ch = project(cam, [m.contactHind[0]!, 0, m.contactHind[1]!], W, H)
    if (cf) disc(t, cf, 3, teal)
    if (ch) disc(t, ch, 3, teal)
    const cp = project(cam, [m.com[0]!, 0, m.com[2]!], W, H)
    if (cp) { disc(t, cp, 5, red); line(t, [cp[0]! - 9, cp[1]!], [cp[0]! + 9, cp[1]!], red); line(t, [cp[0]!, cp[1]! - 9], [cp[0]!, cp[1]! + 9], red) }
    drawTextCentered(t.rgba, W, H, W / 2, 4, label, ink, 1)
    return t
  }
  const tiles: Tile[] = []
  for (const id of ['elephant', 'cow', 'horse', 'cat', 'rat', 'elephant(scaffold)']) {
    const r = rows.find((x) => x.id === id)!
    const lbl = `${id} — ${r.m.massAt(DENSITY_WHOLE).toFixed(0)}kg — ${Number.isNaN(r.m.margin) ? 'no support polygon' : (r.m.margin >= 0 ? 'stands' : 'FALLS') + ` (${r.m.margin.toFixed(2)}m)`}`
    tiles.push(draw(id, r.prims, r.m, lbl))
  }
  const cols = 3, rowsN = 2
  const sw = W * cols, sh = H * rowsN
  const rgba = new Uint8Array(sw * sh * 4)
  const PAPER = [243, 234, 214]
  for (let i = 0; i < sw * sh; i++) { rgba[i * 4] = PAPER[0]!; rgba[i * 4 + 1] = PAPER[1]!; rgba[i * 4 + 2] = PAPER[2]!; rgba[i * 4 + 3] = 255 }
  tiles.forEach((t, i) => {
    const cx = (i % cols) * W, cy = Math.floor(i / cols) * H
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4, d = ((cy + y) * sw + (cx + x)) * 4
      rgba[d] = t.rgba[s]!; rgba[d + 1] = t.rgba[s + 1]!; rgba[d + 2] = t.rgba[s + 2]!; rgba[d + 3] = 255
    }
  })
  await Bun.write('madhuban-morphology/out/17-mass.png', encodePNG(sw, sh, rgba))
  console.log(`\n  17-mass.png (${sw}x${sh}) — top view, from above: the ink polygon is the support polygon,\n  the teal dots are the fore and hind contact centroids, the red cross is the centre of mass at ground level.`)

  await Bun.write('madhuban-morphology/out/mass.json', JSON.stringify(rows.map((r) => ({
    id: r.id, prims: r.prims.length, volume: r.m.volume, massAt1000: r.m.massAt(1000),
    height: r.m.height, com: r.m.com, comTissue: r.m.comTissue, supportArea: r.m.supportArea,
    contactArea: r.m.contactArea, limbArea: r.m.limbArea, limbLoadKPa: r.m.limbLoad / 1000, bellyHeight: r.m.bellyHeight,
    margin: r.m.margin, loadFore: r.m.loadFore,
    stands: !Number.isNaN(r.m.margin) && r.m.margin >= 0, tissues: r.m.tissues,
  })), null, 2))
}

if (import.meta.main) await main()
