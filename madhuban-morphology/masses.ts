// The mass-construction system: a skeleton (+ measured thickness) becomes a body out of simple shape
// SDFs — exactly the artist's doctrine (three universal masses + tapered limb capsules), no manual
// muscle definition. This is the derivation program that turns a decoded morphology into geometry.

import { sdfClass, type Prim } from './species.ts'
import type { Thickness } from './canonical.ts'

const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]
const len = (a: number[]) => Math.hypot(a[0]!, a[1]!, a[2]!)
const norm = (a: number[]) => {
  const l = len(a) || 1
  return [a[0]! / l, a[1]! / l, a[2]! / l]
}
const mid = (a: number[], b: number[]) => [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2, (a[2]! + b[2]!) / 2]
const lerp = (a: number[], b: number[], t: number) => [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t]
const dist = (a: number[], b: number[]) => len(sub(a, b))
const mirror = (p: number[]) => [-p[0]!, p[1]!, p[2]!]

export async function buildMasses(J: Record<string, number[]>, T: Thickness, size: number): Promise<Prim[]> {
  const M = await sdfClass()
  const m = new M()
  const headLen = dist(J.occiput!, J.nose!) || size * 0.2
  const kT = size * 0.032
  const kL = size * 0.016
  const spineDir = norm(sub(J.tailBase!, J.neckBase!))
  const headDir = norm(sub(J.nose!, J.occiput!))

  const t = (name: string) => T[name] ?? [size * 0.05, size * 0.05]
  const tx = (name: string) => Math.max(size * 0.012, t(name)![0]!)
  const ty = (name: string) => Math.max(size * 0.012, t(name)![1]!)

  const cone = (a: number[], b: number[], ra: number, rb: number, k: number, group: string, bone?: string) => {
    if (dist(a, b) < 1e-5) return
    m.cone({ a, b, ra: Math.max(ra, 1e-4), rb: Math.max(rb, 1e-4), k, group, part: 'body', bone })
  }
  const ell = (c: number[], axis: number[], r: number[], k: number, group: string, bone?: string) =>
    m.ell({ c, axis, up: [0, 1, 0], r: [Math.max(r[0]!, 1e-4), Math.max(r[1]!, 1e-4), Math.max(r[2]!, 1e-4)], k, group, part: 'body', bone })

  // ── Three universal masses: cranium, ribcage, pelvis ─────────────────────────────────────────────
  ell(lerp(J.occiput!, J.nose!, 0.42), headDir, [tx('head'), ty('head'), 0.62 * headLen], kT, 'head', 'head')
  cone(lerp(J.occiput!, J.nose!, 0.72), J.nose!, tx('muzzle'), tx('muzzle') * 0.55, kT, 'head')
  // neck
  cone(J.neckBase!, J.neckMid!, tx('neck') * 1.08, tx('neck') * 0.95, kL, 'neck')
  cone(J.neckMid!, J.occiput!, tx('neck') * 0.95, tx('head') * 0.7, kL, 'neck')
  // ribcage + pelvis, bridged along the spine so the torso reads as one
  ell(mid(J.chestMid!, J.thoraxRear!), spineDir, [tx('chest') * 1.18, ty('chest') * 1.12, 0.82 * dist(J.chestMid!, J.thoraxRear!)], kT, 'ribcage')
  ell(mid(J.lumbosacral!, J.tailBase!), spineDir, [tx('pelvis') * 1.12, ty('pelvis') * 1.08, 0.9 * dist(J.lumbosacral!, J.tailBase!)], kT, 'pelvis')
  cone(J.neckBase!, J.tailBase!, tx('chest') * 0.92, tx('pelvis') * 0.88, kT, 'torso')

  // ── Limbs ────────────────────────────────────────────────────────────────────────────────────────
  for (const s of [1, -1]) {
    const mm = (p: number[]) => (s === 1 ? p : mirror(p))
    // front
    cone(mm(J.scapTopL!), mm(J.shoulderL!), tx('upperarm') * 1.05, tx('upperarm') * 1.2, kL, 'FL')
    cone(mm(J.shoulderL!), mm(J.elbowL!), tx('upperarm') * 1.2, tx('forearm') * 1.0, kL, 'FL')
    cone(mm(J.elbowL!), mm(J.wristL!), tx('forearm') * 1.0, tx('forearm') * 0.72, kL, 'FL')
    cone(mm(J.wristL!), mm(J.mcpL!), tx('forearm') * 0.72, tx('forearm') * 0.5, kL, 'FL')
    cone(mm(J.mcpL!), mm(J.ftoeL!), tx('forearm') * 0.5, tx('forearm') * 0.42, kL, 'FL')
    // hind
    cone(mm(J.hipL!), mm(J.kneeL!), tx('thigh') * 1.24, tx('thigh') * 1.06, kL, 'HL')
    cone(mm(J.kneeL!), mm(J.hockL!), tx('thigh') * 1.06, tx('shank') * 1.0, kL, 'HL')
    cone(mm(J.hockL!), mm(J.mtpL!), tx('shank') * 1.0, tx('shank') * 0.7, kL, 'HL')
    cone(mm(J.mtpL!), mm(J.htoeL!), tx('shank') * 0.7, tx('shank') * 0.6, kL, 'HL')
    // ear
    if (dist(J.earBaseL!, J.earTipL!) > 0.03 * size)
      cone(mm(J.earBaseL!), mm(J.earTipL!), tx('head') * 0.38, tx('head') * 0.22, kL, 'ear')
  }

  // ── Tail ─────────────────────────────────────────────────────────────────────────────────────────
  const r0 = Math.max(tx('tail'), size * 0.018)
  for (let i = 0; i < 6; i++) {
    const a = i === 0 ? J.tailBase! : J['tail' + i]
    const b = J['tail' + (i + 1)]
    if (!a || !b) continue
    cone(a, b, r0 * (1 - i / 7), r0 * (1 - (i + 1) / 7), kL, 'tail')
  }
  return m.prims as Prim[]
}
