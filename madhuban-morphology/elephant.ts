// THE LOOP, WITH AN ELEPHANT.
//
//   bun run madhuban-morphology/elephant.ts
//
// Propose -> grow -> verify -> render -> (reject, revise)
//
//   REASONER   an LLM says what an elephant IS, and writes it as a SPEC of numbers
//   EXECUTOR   grow() turns the spec into joints + masses (the same mass-construction system
//              every other animal uses) plus the two parts no other animal here has: a TRUNK and TUSKS
//   VERIFIER   checks the grown body against what an elephant must satisfy: does it stand on the
//              ground, is the trunk attached, does it drag, is it elephant-shaped at all
//   EYES       the raymarcher renders only what survives
//
// Nothing here is a neural net. The "reasoning" is the loop: propose, test, revise. The elephant
// only exists because the reasoner wrote a trunk into the spec AND the executor has a trunk slot
// to grow it in. That is the whole lesson of this file.

import { mkdirSync } from 'node:fs'
import { sdfClass, type Prim } from './species.ts'
import type { Thickness } from './canonical.ts'
import { buildMasses } from './masses.ts'
import { initRaymarch, renderOne, makeCamera, sheet, encodePNG } from './raymarch.ts'
import { drawTextCentered } from './text.ts'

const OUT = 'madhuban-morphology/out'
const W = 300, Hh = 220
const D2R = Math.PI / 180
const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]
const len = (a: number[]) => Math.hypot(a[0]!, a[1]!, a[2]!)
const line = (s = '') => console.log(s)

// ── THE SPEC the reasoner writes ────────────────────────────────────────────────────────────────
// An elephant, in ~18 numbers. Every one is a thing an artist would say out loud.
export type Spec = {
  H: number          // shoulder height, metres (the withers)
  bodyLen: number    // point of shoulder -> rump
  bodyDepth: number  // ribcage depth
  bodyWidth: number  // ribcage width
  legThick: number   // pillar radius
  foreLeg: number    // foreleg length (metres) — must REACH the ground
  hindLeg: number    // hindleg length (metres)
  headLen: number    // poll -> muzzle
  headW: number      // skull width
  earDrop: number    // how far the ear hangs
  earOut: number     // how far the ear sweeps back/out
  trunkLen: number
  trunkSegs: number
  trunkDroop: number // degrees the trunk falls from horizontal at the tip
  trunkGap: number   // 0 = attached at the nose; > 0 = floats off the face
  tuskLen: number
  arch: number       // a hump, as a fraction of H
}

export const ELEPHANT: Spec = {
  H: 3.0, bodyLen: 4.2, bodyDepth: 1.95, bodyWidth: 1.40,
  legThick: 0.26, foreLeg: 1.80, hindLeg: 2.04,
  headLen: 1.05, headW: 0.58,
  earDrop: 1.15, earOut: 0.85,
  trunkLen: 1.45, trunkSegs: 9, trunkDroop: 62, trunkGap: 0,
  tuskLen: 0.95, arch: 0.05,
}

// ── EXECUTOR: spec -> joints + masses ───────────────────────────────────────────────────────────
type Grown = { J: Record<string, number[]>; prims: Prim[]; body: Prim[]; feet: number[][]; trunkBase: number[]; trunkTip: number[]; shoulderY: number }

export async function grow(s: Spec): Promise<Grown> {
  const M = await sdfClass()
  const H = s.H
  const zF = s.bodyLen * 0.30    // fore feet under the shoulder
  const zH = -s.bodyLen * 0.42   // hind feet under the pelvis
  const x = s.bodyWidth * 0.46   // leg track
  const shoulderY = H * 0.60
  const hipY = H * 0.68

  const J: Record<string, number[]> = {
    // ── spine, withers highest, tail head low at the back ──
    tailBase:     [0, H * 0.94, -s.bodyLen * 0.60],
    lumbosacral:  [0, H * 0.97, -s.bodyLen * 0.42],
    lumbarMid:    [0, H * 0.99, -s.bodyLen * 0.25],
    thoraxRear:   [0, H * (1.00 + s.arch), -s.bodyLen * 0.05],
    chestMid:     [0, H * 0.97, s.bodyLen * 0.16],
    neckBase:     [0, H * 0.92, s.bodyLen * 0.50],
    // ── the head hangs low and forward: a domed skull with the mouth near the ground ──
    neckMid:      [0, H * 0.87, s.bodyLen * 0.58],
    occiput:      [0, H * 0.80, s.bodyLen * 0.66],
    nose:         [0, H * 0.55, s.bodyLen * 0.66 + s.headLen * 0.60],
    jawHinge:     [0, H * 0.66, s.bodyLen * 0.70],
    jawTip:       [0, H * 0.56, s.bodyLen * 0.66 + s.headLen * 0.35],
    earBaseL:     [s.headW * 0.5, H * 0.79, s.bodyLen * 0.62],
  }
  J.earTipL = J.earBaseL!.slice() // no default ear cone — the elephant grows its own fans

  // ── forelimb: a column. Toe y = shoulderY - foreLeg, so a short leg FLOATS. ──
  const fL = s.foreLeg
  J.scapTopL = [x * 0.55, shoulderY + fL * 0.30, zF - 0.06]
  J.shoulderL = [x, shoulderY, zF]
  J.elbowL = [x, shoulderY - fL * 0.45, zF + 0.03]
  J.wristL = [x, shoulderY - fL * 0.78, zF + 0.05]
  J.mcpL = [x, shoulderY - fL * 0.93, zF + 0.06]
  J.ftoeL = [x, shoulderY - fL, zF + 0.07]
  // ── hindlimb ──
  const hL = s.hindLeg
  J.hipL = [x, hipY, zH + 0.12]
  J.kneeL = [x, hipY - hL * 0.48, zH + 0.16]
  J.hockL = [x, hipY - hL * 0.80, zH + 0.02]
  J.mtpL = [x, hipY - hL * 0.93, zH - 0.01]
  J.htoeL = [x, hipY - hL, zH - 0.02]

  // tail: a short rope, hanging
  const seg = s.bodyLen * 0.10
  for (let i = 0; i <= 6; i++) J['tail' + i] = [0, H * 0.92 - i * seg * 1.75, -s.bodyLen * 0.60 - i * seg * 0.30]

  const T: Thickness = {
    head: [s.headW * 0.34, s.headW * 0.36], muzzle: [s.headW * 0.24, s.headW * 0.22],
    neck: [s.bodyWidth * 0.40, s.bodyDepth * 0.34],
    chest: [s.bodyWidth * 0.50, s.bodyDepth * 0.50], pelvis: [s.bodyWidth * 0.46, s.bodyDepth * 0.46],
    upperarm: [s.legThick, s.legThick], forearm: [s.legThick * 0.96, s.legThick * 0.96],
    thigh: [s.legThick * 1.06, s.legThick * 1.06], shank: [s.legThick * 0.96, s.legThick * 0.96],
    tail: [0.10, 0.10],
  }

  const body = await buildMasses(J, T, H)

  // ── the parts NO other animal in the project has: trunk, tusks, fan ears ──
  const m = new M()
  const kL = H * 0.016
  // trunk: a tapering chain that walks forward and falls
  const base = [J.nose![0]!, J.nose![1]! + 0.02, J.nose![2]! + s.trunkGap]
  const step = s.trunkLen / s.trunkSegs
  const p: number[][] = [base]
  // start by meeting the muzzle, then curl: even a detached base still traces the trunk's path
  const anchor = [J.nose![0]!, J.nose![1]!, J.nose![2]!]
  let cur = [anchor[0]!, anchor[1]! + 0.02, anchor[2]!]
  for (let i = 0; i < s.trunkSegs; i++) {
    const t = i / Math.max(1, s.trunkSegs - 1)
    const a = -(16 + (s.trunkDroop - 16) * t) * D2R
    cur = [cur[0]!, cur[1]! + Math.sin(a) * step, cur[2]! + Math.cos(a) * step]
    p.push(cur.slice())
  }
  // if the reasoner detached the trunk, shift the whole chain off the face so the gap is real
  for (let i = 0; i < p.length; i++) p[i] = [p[i]![0]!, p[i]![1]!, p[i]![2]! + s.trunkGap]
  const r0 = s.headW * 0.24
  if (s.trunkLen > 0.01) for (let i = 0; i < p.length - 1; i++) {
    const ra = r0 * (1 - (i / p.length) * 0.72), rb = r0 * (1 - ((i + 1) / p.length) * 0.72)
    m.cone({ a: p[i]!, b: p[i + 1]!, ra: Math.max(ra, 1e-3), rb: Math.max(rb, 1e-3), k: kL, group: 'trunk', part: 'body' })
  }
  // tusks: ivory, forward and up
  for (const sgn of [1, -1]) {
    const a = [sgn * s.headW * 0.26, J.nose![1]! - 0.02, J.nose![2]! - 0.06]
    const b = [sgn * s.headW * 0.34, J.nose![1]! + 0.14 + s.tuskLen * 0.18, J.nose![2]! + s.tuskLen * 0.92]
    m.cone({ a, b, ra: s.headW * 0.10, rb: s.headW * 0.028, k: kL, group: 'tusk', part: 'body' })
  }
  // fan ears: two great flat plates on the sides of the skull
  for (const sgn of [1, -1]) {
    const c = [sgn * (s.headW * 0.42 + 0.10), J.occiput![1]! - s.earDrop * 0.30, J.occiput![2]! - s.earOut * 0.28]
    m.ell({ c, axis: [sgn, 0, -0.25], up: [0, 1, 0], r: [s.earOut, s.earDrop * 0.55, 0.055], k: kL, group: 'ear', part: 'body' })
  }

  // flat load-bearing pads, not the tapered cone tip the mass system leaves
  for (const fp of [J.ftoeL!, J.htoeL!]) {
    for (const sgn of [1, -1]) {
      m.ell({ c: [sgn * fp[0]!, 0.06, fp[2]!], axis: [0, 1, 0], up: [0, 0, 1], r: [s.legThick * 1.15, 0.075, s.legThick * 1.25], k: kL, group: 'foot', part: 'body' })
    }
  }

  const feet = [J.ftoeL!, [-J.ftoeL![0]!, J.ftoeL![1]!, J.ftoeL![2]!], J.htoeL!, [-J.htoeL![0]!, J.htoeL![1]!, J.htoeL![2]!]]
  return { J, prims: [...body, ...(m.prims as Prim[])], body, feet, trunkBase: base, trunkTip: p[p.length - 1]!, shoulderY }
}

// ── VERIFIER: what an elephant must be true of ──────────────────────────────────────────────────
type Fault = { rule: string; ok: boolean; detail: string }

async function verify(s: Spec, g: Grown): Promise<Fault[]> {
  const M = await sdfClass()
  const f: Fault[] = []
  const add = (rule: string, ok: boolean, detail: string) => f.push({ rule, ok, detail })

  // 1 · it stands. Every foot meets the ground.
  const worst = g.feet.reduce((a, p) => (Math.abs(p[1]!) > Math.abs(a[1]!) ? p : a), [0, 0, 0])
  add('feet-ground', Math.abs(worst[1]!) <= 0.03,
    Math.abs(worst[1]!) <= 0.03 ? 'all four feet meet the ground' : `a foot floats ${Math.abs(worst[1]!).toFixed(2)} m above the ground`)

  // 2 · it balances. The centre of mass sits inside the feet.
  let cx = 0, cy = 0, cz = 0, wsum = 0
  for (const pr of g.prims) {
    let c: number[], r: number
    const P = pr.P
    if (pr.type === 0) { c = [P[0]!, P[1]!, P[2]!]; r = Math.max(P[12]!, P[13]!, P[14]!) }
    else { c = [P[0]! + P[3]! / 2, P[1]! + P[4]! / 2, P[2]! + P[5]! / 2]; r = len([P[3]!, P[4]!, P[5]!]) / 2 + Math.max(P[10]!, P[11]!) }
    const w = r * r * r; wsum += w; cx += c[0]! * w; cy += c[1]! * w; cz += c[2]! * w
  }
  cx /= wsum; cy /= wsum; cz /= wsum
  const stable = inPoly(cx, cz, g.feet.map((p) => [p[0]!, p[2]!]))
  add('stability', stable, stable ? 'the centre of mass sits inside the feet' : `it would topple: mass at z=${cz.toFixed(2)} is outside the feet`)

  // 3 · the trunk is attached to the face, not floating in front of it
  const gap = len(sub(g.trunkBase, g.J.nose!))
  add('trunk-attach', gap <= 0.05, gap <= 0.05 ? 'the trunk grows from the nose' : `the trunk starts ${gap.toFixed(2)} m off the face — it would fall off`)

  // 4 · the trunk is solid: outside the body, above the ground
  const tip = g.trunkTip
  const inBody = M.evalList(g.body, tip[0]!, tip[1]!, tip[2]!) <= 0
  const under = tip[1]! <= 0.05
  add('trunk-clear', !inBody && !under,
    under ? `the trunk tip drags ${(0.05 - tip[1]!).toFixed(2)} m under the ground`
      : inBody ? 'the trunk passes back through the body' : 'the trunk hangs free, clear of body and ground')

  // 5 · the pillars can carry the mass
  const stock = s.legThick / g.shoulderY
  add('limb-stock', stock >= 0.09 && stock <= 0.30,
    stock < 0.09 ? `legs ${s.legThick.toFixed(2)} m thick under a ${(s.H).toFixed(1)} m animal — too slender to carry it`
      : stock > 0.30 ? 'legs impossibly thick' : 'pillar diameter in proportion to the body')

  // 6 · it is elephant-shaped at all (the ratios)
  const rt = s.trunkLen / s.headLen
  add('proportion-trunk', rt >= 0.8 && rt <= 1.7, rt < 0.8 ? `trunk is a stub (${rt.toFixed(1)}x the head)` : rt > 1.7 ? `trunk is ${rt.toFixed(1)}x the head — too long even for an elephant` : `trunk is ${rt.toFixed(1)}x the head`)
  const rb = s.bodyLen / s.H
  add('proportion-body', rb >= 1.0 && rb <= 1.6, `body is ${rb.toFixed(2)}x the shoulder height`)
  return f
}

function inPoly(x: number, z: number, poly: number[][]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]![0]!, zi = poly[i]![1]!, xj = poly[j]![0]!, zj = poly[j]![1]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

// ── EYES ────────────────────────────────────────────────────────────────────────────────────────
function captioned(t: { rgba: Uint8Array; w: number; h: number }, text: string, capH = 16) {
  const nw = t.w, nh = t.h + capH
  const out = new Uint8Array(nw * nh * 4)
  for (let i = 0; i < nw * nh; i++) { out[i * 4] = 255; out[i * 4 + 1] = 252; out[i * 4 + 2] = 245; out[i * 4 + 3] = 255 }
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    const s = (y * t.w + x) * 4, d = ((y + capH) * nw + x) * 4
    out[d] = t.rgba[s]!; out[d + 1] = t.rgba[s + 1]!; out[d + 2] = t.rgba[s + 2]!; out[d + 3] = 255
  }
  drawTextCentered(out, nw, nh, nw / 2, 4, text, [40, 30, 24], 1)
  return { rgba: out, w: nw, h: nh }
}
async function tile(g: Grown, label: string) {
  const r = renderOne(g.prims, makeCamera(g.prims, { az: 0.52, el: 0.13, w: W, h: Hh, zoom: 1.0 }), W, Hh)
  return captioned(r, label)
}
const save = async (name: string, t: { rgba: Uint8Array; w: number; h: number }) => {
  await Bun.write(`${OUT}/${name}`, encodePNG(t.w, t.h, t.rgba))
  return `${name} (${t.w}x${t.h})`
}

// ── THE LOOP ────────────────────────────────────────────────────────────────────────────────────
async function main() {
  await initRaymarch()
  mkdirSync(OUT, { recursive: true })

  line()
  line('  REASONER  ·  in words')
  line('  ─────────────────────────────────────────────────────────────────────────')
  line('  "An elephant is a mountain on four columns. The back is a long ridge, highest')
  line('   at the withers. The skull is domed; two great fan ears sweep back from it.')
  line('   From the face falls a muscular trunk — it hangs, and curls, and can lift.')
  line('   Two ivory tusks arc forward. The legs are straight pillars on flat pads.')
  line('   They stand. So every foot must meet the ground."')
  line()

  const proposals: { name: string; spec: Spec }[] = [
    { name: 'P1', spec: { ...ELEPHANT, legThick: 0.07, foreLeg: 1.62, trunkGap: 0.20 } },
    { name: 'P2', spec: { ...ELEPHANT, trunkLen: 2.60, trunkDroop: 88 } },
    { name: 'P3', spec: { ...ELEPHANT } },
  ]

  const tiles: { rgba: Uint8Array; w: number; h: number }[] = []
  let accepted: Grown | null = null

  for (const pr of proposals) {
    line(`  PROPOSAL ${pr.name}  ·  spec ${specLine(pr.spec)}`)
    const g = await grow(pr.spec)
    const faults = await verify(pr.spec, g)
    const bad = faults.filter((x) => !x.ok)
    for (const x of faults) line(`     ${x.ok ? 'ok ' : 'X  '} ${x.rule.padEnd(17)} ${x.detail}`)
    if (bad.length === 0) {
      line('     -> ACCEPTED')
      accepted = g
      tiles.push(await tile(g, `${pr.name} · ACCEPTED`))
    } else {
      line(`     -> REJECTED (${bad.length} fault${bad.length > 1 ? 's' : ''})`)
      tiles.push(await tile(g, `${pr.name} · REJECTED`))
    }
    line()
  }

  line('  herding the accepted spec — the same elephant, re-parameterised')
  const at = (H: number, o: Partial<Spec>): Spec => ({ ...ELEPHANT, H, foreLeg: H * 0.60, hindLeg: H * 0.68, ...o })
  const herd: Spec[] = [
    at(3.3, { bodyLen: 4.6, legThick: 0.29, trunkLen: 1.70, earDrop: 1.10, earOut: 0.85, tuskLen: 1.25 }),
    at(2.8, { bodyLen: 3.9, legThick: 0.22, trunkLen: 1.30, earDrop: 0.82, earOut: 0.66, tuskLen: 0.45 }),
    at(1.9, { bodyLen: 2.4, legThick: 0.15, trunkLen: 0.85, earDrop: 0.58, earOut: 0.46, tuskLen: 0.05, headLen: 0.70, headW: 0.38 }),
    at(3.0, { bodyLen: 4.2, trunkLen: 1.75, trunkDroop: 26, headLen: 1.10, earDrop: 0.80, tuskLen: 0.70 }),
  ]
  const labels = ['BULL', 'COW', 'CALF', 'TRUNK HIGH']
  const herdTiles = []
  for (let i = 0; i < herd.length; i++) {
    const g = await grow(herd[i]!)
    const bad = (await verify(herd[i]!, g)).filter((x) => !x.ok)
    line(`   ${labels[i]!.padEnd(11)} ${bad.length ? 'REJECTED: ' + bad.map((b) => b.rule).join(', ') : 'verified'}`)
    herdTiles.push(await tile(g, `${labels[i]}${bad.length ? ' !' : ''}`))
  }

  line(`   ${await save('11-elephant-loop.png', sheet(tiles, 3))}`)
  line(`   ${await save('12-elephant-herd.png', sheet(herdTiles, 4))}`)

  // the control: the same elephant, with the trunk slot removed. This is what every other
  // animal in the project can be — and why none of them can ever grow a trunk.
  const noSlot = await tile(await grow({ ...ELEPHANT, trunkLen: 0, tuskLen: 0 }), 'the same spec, trunk slot removed')
  const withSlot = await tile(accepted!, 'trunk slot present')
  line(`   ${await save('13-elephant-slot.png', sheet([noSlot, withSlot], 2))}`)
  line()
  line('  the loop turned words into an elephant that stands. The trunk exists because the')
  line('  spec has a trunk field and the executor has a trunk slot — nothing else in the')
  line('  project does. Take either away and the trunk cannot happen, however good the words.')
  line()
}

const specLine = (s: Spec) =>
  `[H ${s.H.toFixed(1)}  body ${s.bodyLen.toFixed(1)}  leg r${s.legThick.toFixed(2)}  ` +
  `trunk ${s.trunkLen.toFixed(2)}@${s.trunkDroop.toFixed(0)}°  gap ${s.trunkGap.toFixed(2)}  tusk ${s.tuskLen.toFixed(2)}]`

if (import.meta.main) await main()
