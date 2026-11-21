// The canonical morphology vector: one fixed-length numeric description every quadruped maps into,
// so a program can learn over them together.
//
//   | joints (30 × 3) | body thickness (12 stations × 2 axes) | log body length (1) |  = 115 numbers
//
// Joints are the left side only (the right mirrors), the tail is resampled to a fixed 6 points, and
// everything is divided by the animal's own body length — so the shape dims are dimensionless and the
// size lives in the final number. Thickness is *measured off the real sculpted SDF*, by shooting a ray
// outward from each station until it leaves the body: the mass model reads the artist's own muscles.

import { sdfClass, type Prim } from './species.ts'

export const AXIAL = ['nose', 'occiput', 'neckMid', 'neckBase', 'chestMid', 'thoraxRear', 'lumbarMid', 'lumbosacral', 'tailBase'] as const
export const JAW = ['jawHinge', 'jawTip'] as const
export const FRONT = ['scapTopL', 'shoulderL', 'elbowL', 'wristL', 'mcpL', 'ftoeL'] as const
export const HIND = ['hipL', 'kneeL', 'hockL', 'mtpL', 'htoeL'] as const
export const EAR = ['earBaseL', 'earTipL'] as const

export const JOINT_NAMES: readonly string[] = [...AXIAL, ...JAW, ...FRONT, ...HIND, ...EAR]
export const TAIL_K = 6

export const SHAPE_DIM = (JOINT_NAMES.length + TAIL_K) * 3 // 90

// Thickness stations, in body order. Each is a point on the medial axis; we probe +X (lateral) and
// +Y (vertical) outward from it.
export const STATION_NAMES = [
  'head', 'muzzle', 'neck', 'chest', 'ribrear', 'waist', 'pelvis',
  'upperarm', 'forearm', 'thigh', 'shank', 'tail',
] as const
export const THICK_DIM = STATION_NAMES.length * 2 // 24

export const DIM = SHAPE_DIM + THICK_DIM + 1 // 115

export type Thickness = Record<string, [number, number]>

const v3 = (a: number[], b: number[], t: number): number[] => [
  a[0]! + (b[0]! - a[0]!) * t,
  a[1]! + (b[1]! - a[1]!) * t,
  a[2]! + (b[2]! - a[2]!) * t,
]
export const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)

// ── Tail ────────────────────────────────────────────────────────────────────────────────────────
export function tailChain(J: Record<string, number[]>): number[][] {
  const pts: number[][] = []
  for (let i = 0; ; i++) {
    const k = 'tail' + i
    if (!J[k]) break
    pts.push(J[k]!)
  }
  return pts
}

// Resample the tail polyline to K points, evenly by arc length, from just past the base to the tip.
export function resampleTail(J: Record<string, number[]>, K: number): number[][] {
  const pts = tailChain(J)
  const base = J.tailBase!
  if (pts.length < 2) {
    // No tail chain: lay a short straight tail back along -Z.
    const len = 0.15
    return Array.from({ length: K }, (_, i) => [base[0]!, base[1]! - 0.02 * len, base[2]! - ((i + 1) / K) * len])
  }
  const seg: number[] = []
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1]!, pts[i]!)
    seg.push(d)
    cum.push(cum[i - 1]! + d)
  }
  const total = cum[cum.length - 1]! || 1e-6
  const out: number[][] = []
  for (let k = 1; k <= K; k++) {
    const target = (total * k) / K
    let i = 1
    while (i < cum.length - 1 && cum[i]! < target) i++
    const a = pts[i - 1]!
    const b = pts[i]!
    const t = (target - cum[i - 1]!) / (seg[i - 1]! || 1e-6)
    out.push(v3(a, b, t))
  }
  return out
}

// ── Missing joints (frog has no ears; not every species exposes a jaw) ────────────────────────────
function synthJoint(name: string, J: Record<string, number[]>): number[] {
  const o = J.occiput!
  const n = J.nose!
  const hl = dist(o, n) || 0.05
  if (name === 'jawHinge') return [o[0]!, o[1]! - 0.25 * hl, o[2]! + 0.15 * hl]
  if (name === 'jawTip') return [n[0]!, n[1]! - 0.18 * hl, n[2]! - 0.1 * hl]
  if (name === 'earBaseL') return [o[0]! + 0.35 * hl, o[1]! + 0.35 * hl, o[2]! - 0.15 * hl]
  if (name === 'earTipL') return [o[0]! + 0.35 * hl, o[1]! + 0.35 * hl, o[2]! - 0.15 * hl] // zero length = no ear
  const b = J.tailBase!
  return [b[0]!, b[1]!, b[2]!]
}

// ── Thickness probing ────────────────────────────────────────────────────────────────────────────
function stations(J: Record<string, number[]>): { name: string; p: number[] }[] {
  const tail1 = J.tail1 ?? J.tailBase!
  return [
    { name: 'head', p: v3(J.occiput!, J.nose!, 0.45) },
    { name: 'muzzle', p: v3(J.occiput!, J.nose!, 0.85) },
    { name: 'neck', p: J.neckMid! },
    { name: 'chest', p: v3(J.chestMid!, J.thoraxRear!, 0.3) },
    { name: 'ribrear', p: J.thoraxRear! },
    { name: 'waist', p: J.lumbarMid! },
    { name: 'pelvis', p: J.lumbosacral! },
    { name: 'upperarm', p: v3(J.shoulderL!, J.elbowL!, 0.4) },
    { name: 'forearm', p: v3(J.elbowL!, J.wristL!, 0.5) },
    { name: 'thigh', p: v3(J.hipL!, J.kneeL!, 0.4) },
    { name: 'shank', p: v3(J.kneeL!, J.hockL!, 0.5) },
    { name: 'tail', p: v3(J.tailBase!, tail1, 0.5) },
  ]
}

async function halfExtent(list: Prim[], p: number[], dir: number[], dt: number, maxT: number): Promise<number> {
  const M = await sdfClass()
  let prev = M.evalList(list, p[0]!, p[1]!, p[2]!)
  for (let t = dt; t <= maxT; t += dt) {
    const d = M.evalList(list, p[0]! + dir[0]! * t, p[1]! + dir[1]! * t, p[2]! + dir[2]! * t)
    if (d > 0) {
      // first crossing between t-dt and t: interpolate
      const f = prev / (prev - d)
      return Math.max(dt * 0.5, t - dt + f * dt)
    }
    prev = d
  }
  return maxT
}

// ── Vectorize / unvectorize ──────────────────────────────────────────────────────────────────────
export async function vectorize(J: Record<string, number[]>, prims: Prim[]): Promise<{ vec: Float32Array; bodyLen: number }> {
  const bodyLen = Math.max(1e-4, dist(J.nose!, J.tailBase!))
  const s = 1 / bodyLen
  const vec = new Float32Array(DIM)
  let o = 0
  for (const name of JOINT_NAMES) {
    const p = J[name] ?? synthJoint(name, J)
    vec[o++] = p[0]! * s
    vec[o++] = p[1]! * s
    vec[o++] = p[2]! * s
  }
  for (const p of resampleTail(J, TAIL_K)) {
    vec[o++] = p[0]! * s
    vec[o++] = p[1]! * s
    vec[o++] = p[2]! * s
  }
  const dt = bodyLen / 320
  const maxT = 0.5 * bodyLen
  for (const st of stations(J)) {
    const wx = await halfExtent(prims, st.p, [1, 0, 0], dt, maxT)
    const wy = await halfExtent(prims, st.p, [0, 1, 0], dt, maxT)
    vec[o++] = wx * s
    vec[o++] = wy * s
  }
  vec[o++] = Math.log(bodyLen)
  return { vec, bodyLen }
}

export function unvectorize(vec: ArrayLike<number>): { J: Record<string, number[]>; thickness: Thickness; size: number } {
  const size = Math.exp(vec[DIM - 1]!)
  const J: Record<string, number[]> = {}
  let o = 0
  for (const name of JOINT_NAMES) {
    J[name] = [vec[o++]! * size, vec[o++]! * size, vec[o++]! * size]
  }
  const tail: number[][] = []
  for (let k = 0; k < TAIL_K; k++) tail.push([vec[o++]! * size, vec[o++]! * size, vec[o++]! * size])
  J.tail0 = J.tailBase!.slice()
  for (let k = 0; k < TAIL_K; k++) J['tail' + (k + 1)] = tail[k]!
  const thickness: Thickness = {}
  for (const name of STATION_NAMES) thickness[name] = [vec[o++]! * size, vec[o++]! * size]
  return { J, thickness, size }
}

// Standardization over the whole corpus (reals + jitter): (x - mean) / std.
export function fitStandardizer(data: Float32Array[]): { mean: Float32Array; std: Float32Array } {
  const n = data.length
  const mean = new Float32Array(DIM)
  for (const v of data) for (let i = 0; i < DIM; i++) mean[i] += v[i]! / n
  const std = new Float32Array(DIM)
  for (const v of data) for (let i = 0; i < DIM; i++) std[i] += (v[i]! - mean[i]!) ** 2 / n
  for (let i = 0; i < DIM; i++) std[i] = Math.sqrt(std[i]!) || 1
  return { mean, std }
}

export const standardize = (vec: ArrayLike<number>, z: { mean: Float32Array; std: Float32Array }) => {
  const out = new Float32Array(DIM)
  for (let i = 0; i < DIM; i++) out[i] = (vec[i]! - z.mean[i]!) / z.std[i]!
  return out
}
export const unstandardize = (vec: ArrayLike<number>, z: { mean: Float32Array; std: Float32Array }) => {
  const out = new Float32Array(DIM)
  for (let i = 0; i < DIM; i++) out[i] = vec[i]! * z.std[i]! + z.mean[i]!
  return out
}
