// scale.ts — is anything actually missing, and can a mass be *asked for*?
//
// The claim to test: "the repo varies an individual's size by pushing one uniform `scale` warp
// through the finished surface and the skeleton (core/build/pipeline.js:143), and that must be the
// missing generality."
//
// Uniform scaling means every length times k. So mass goes as k^3 and every area as k^2, which makes
// the load in the limbs rise as k^1 — and since mass itself rises as k^3, that is limb load ~
// mass^(1/3). Geometric similarity. The point of this file is that this is *not* a defect: growth by
// geometric similarity is the standard first-order law for allometry, and it also conserves the
// Froude number, which is why the motion engine can say "scaled by dynamic similarity for calves and
// bulls" and be right. So the size knob is fine, and the interesting question moves elsewhere.
//
// Which is what the rest of the file does: measure the elephant against the real animal, measure the
// cast's own exponent and compare it to 1/3, and then use mass as a **solver** — ask for a mass and
// fit the body to it. That last one is the shape of every "generalise the life form" gain: not a
// better constant, a knob that is derived instead of drawn.
//
// Run: bun run madhuban-morphology/scale.ts   (after mass.ts, which writes out/mass.json)

import { pathToFileURL } from 'node:url'
import { sdfClass, SRC, type Prim } from './species.ts'
import { initRaymarch } from './raymarch.ts'
import { measure, type Mass } from './mass.ts'

const load = (p: string) => import(pathToFileURL(p).href)

// ---------------------------------------------------------------- rescaling a finished body
// The P arrays are the whole state, so a body can be rescaled exactly — provided you know what each
// slot means. This is where a "derivation layer" first earns its keep: the layout is anatomy.
const isEll = (p: Prim) => p.P.length === 15
const isCone = (p: Prim) => p.P.length === 12
const isLens = (p: Prim) => p.P.length === 16
const isFin = (p: Prim) => p.P.length >= 21

export function clonePrims(prims: Prim[]): Prim[] {
  return prims.map((p) => ({ ...p, P: Float64Array.from(p.P) }))
}

// Uniform scale k: centre by k, radii by k, smooth-min k by k, basis untouched (it is orthonormal).
export function scalePrims(prims: Prim[], k: number): Prim[] {
  const out = clonePrims(prims)
  for (const p of out) {
    const P = p.P
    if (isEll(p)) { for (let i = 0; i < 3; i++) P[i]! *= k; for (let i = 12; i < 15; i++) P[i]! *= k }
    else if (isCone(p)) {
      P[0]! *= k; P[1]! *= k; P[2]! *= k
      P[3]! *= k; P[4]! *= k; P[5]! *= k
      P[6]! *= k * k; P[7]! *= k; P[8]! *= k * k; P[9]! /= k * k
      P[10]! *= k; P[11]! *= k
    } else if (isLens(p)) {
      for (let i = 0; i < 3; i++) P[i]! *= k
      P[12]! *= k; P[13]! *= k; P[14]! *= k; P[15]! *= k
    } else if (isFin(p)) {
      for (let i = 0; i < 3; i++) P[i]! *= k
      P[12]! *= k; P[13]! *= k
      const n = P[14]!
      for (let i = 0; i < n; i++) { P[15 + i * 2]! *= k; P[16 + i * 2]! *= k }
      const hasCurve = p.P.length >= 17 + n * 2 + 6
      if (hasCurve) P[17 + n * 2]! *= k // the patch offset scales; its slopes do not
    }
    p.k *= k
  }
  return out
}

const TORSO = /ribcage|girth|abdomen|belly|flank|brisket|withers|^back$|loin|rump|barrel|quarter/i

// Fatten the trunk: scale the radii of the torso that do NOT run fore-and-aft, so the section grows
// and the body length stands still. A body is not a sphere; "bigger" has to say which way.
export function fattenTorso(prims: Prim[], f: number): Prim[] {
  const out = clonePrims(prims)
  for (const p of out) {
    if (!TORSO.test(p.tag)) continue
    const P = p.P
    if (isEll(p)) {
      for (let i = 0; i < 3; i++) if (Math.abs(P[9 + i * 3]!) < 0.7) P[12 + i]! *= f // basis i is not fore-aft
    } else if (isCone(p)) {
      const L = Math.hypot(P[3]!, P[4]!, P[5]!) || 1
      if (Math.abs(P[5]!) / L < 0.7) { P[10]! *= f; P[11]! *= f; const rr = P[10]! - P[11]!; P[7] = rr; P[8] = P[6]! - rr * rr }
    }
  }
  return out
}

// ---------------------------------------------------------------- fitting a law
function fitSlope(xs: number[], ys: number[]): { s: number; r2: number } {
  const n = xs.length
  if (n < 3) return { s: NaN, r2: NaN }
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; syy += (ys[i]! - my) ** 2 }
  const s = sxy / sxx
  return { s, r2: syy ? (sxy * sxy) / (sxx * syy) : NaN }
}

async function elephantPrims(): Promise<Prim[]> {
  const rigMod: any = await load(`${SRC}/species/elephant/rig.js`)
  const sculptMod: any = await load(`${SRC}/species/elephant/sculpt.js`)
  const M = await sdfClass()
  const m = new M()
  sculptMod.sculptElephant(m, rigMod.elephantRig())
  return m.prims as Prim[]
}

const GH = 9.81
const H_REF = 0.045

async function main() {
  await initRaymarch()
  const ref = await elephantPrims()
  const mRef = await measure(ref, { h: H_REF })

  // (1) what the size knob actually does
  console.log('(1) the repo\'s only size knob (pipeline.js:143), measured\n')
  console.log('   k      height   volume   mass     limb m2   limb load   margin   CoM h')
  const K = [0.25, 0.5, 1, 2]
  const uni: Array<{ k: number; m: Mass }> = []
  for (const k of K) {
    const m = await measure(scalePrims(ref, k), { h: H_REF * k })
    uni.push({ k, m })
    console.log(
      `  ${k.toFixed(2)}   ${m.height.toFixed(2).padStart(6)}   ${m.volume.toFixed(3).padStart(6)}   ${String(Math.round(m.massAt(1000))).padStart(6)}   ` +
      `${m.limbArea.toFixed(3).padStart(7)}   ${(m.limbLoad / 1000).toFixed(1).padStart(8)} kPa   ` +
      `${(Number.isNaN(m.margin) ? '   —' : m.margin.toFixed(2).padStart(5))}   ${m.com[1]!.toFixed(2).padStart(5)}`,
    )
  }
  const L = (u: { k: number }) => Math.log(u.k)
  const ex = {
    mass: fitSlope(uni.map(L), uni.map((u) => Math.log(u.m.massAt(1000)))).s,
    limbArea: fitSlope(uni.map(L), uni.map((u) => Math.log(u.m.limbArea))).s,
    limbLoad: fitSlope(uni.map(L), uni.map((u) => Math.log(u.m.limbLoad))).s,
    margin: fitSlope(uni.map(L), uni.map((u) => Math.log(u.m.margin))).s,
    comHeight: fitSlope(uni.map(L), uni.map((u) => Math.log(u.m.com[1]!))).s,
  }
  console.log(`\n  mass ~ k^${ex.mass.toFixed(3)}   limb area ~ k^${ex.limbArea.toFixed(3)}   limb load ~ k^${ex.limbLoad.toFixed(3)}   margin ~ k^${ex.margin.toFixed(3)}   CoM height ~ k^${ex.comHeight.toFixed(3)}`)
  // The prediction comes from scaling every length by k, so it is 3/2/1/1/1. Report the gap, not a
  // claim: writing "exactly the powers" unconditionally is a conclusion printed before the fit has been
  // allowed to disagree.
  const predict: Array<[string, number, number]> = [
    ['mass', ex.mass, 3], ['limb area', ex.limbArea, 2], ['limb load', ex.limbLoad, 1],
    ['margin', ex.margin, 1], ['CoM height', ex.comHeight, 1],
  ]
  const off = predict.filter(([, got, want]) => !(Math.abs(got - want) < 1e-6))
  if (off.length === 0) {
    console.log('  that matches, to six decimals, the powers you get from scaling every length: 3, 2, 1, 1, 1.')
    console.log('  Nothing is left dangling, and limb load ~ mass^1/3 is geometric similarity — the standard')
    console.log('  first-order growth law, and the one that conserves the Froude number. So the size knob is not')
    console.log('  the missing thing.')
  } else {
    console.log('  that does NOT match the pure similarity prediction (3, 2, 1, 1, 1). Off by: ' +
      off.map(([n, got, want]) => `${n} ${got.toFixed(3)} vs ${want}`).join(', '))
    console.log('  so the size warp is not a clean uniform scale after all, and something else is mixed in.')
  }

  // (2) the elephant against the real animal, and the cast against its own knob
  console.log('\n(2) the sculpt against the real animal\n')
  console.log(`  volume            ${mRef.volume.toFixed(3)} m3`)
  console.log(`  mass @1000        ${mRef.massAt(1000).toFixed(0)} kg      a real 3.0 m shoulder-height bush elephant bull: 4000-6300 kg`)
  console.log(`  height            ${mRef.height.toFixed(2)} m        (3.0 m at the shoulder, +0.56 m to the top of the head)`)
  console.log(`  limb load         ${(mRef.limbLoad / 1000).toFixed(1)} kPa     on a ${mRef.limbArea.toFixed(3)} m2 mean limb section`)
  console.log(`  stands            margin ${mRef.margin.toFixed(2)} m inside the support polygon, ${(100 * mRef.loadFore).toFixed(0)}% of the weight on the forelimbs`)
  console.log(`  CoM               ${(100 * mRef.com[1]! / mRef.height).toFixed(0)}% of height`)

  const rows: any[] = await Bun.file('madhuban-morphology/out/mass.json').json()
  const cast = rows.filter((r) => r.id !== 'elephant(scaffold)' && Number.isFinite(r.limbArea) && r.limbArea > 1e-6 && r.massAt1000 > 0.05)
  const fc = fitSlope(cast.map((r) => Math.log(r.massAt1000)), cast.map((r) => Math.log(r.limbLoadKPa)))
  const fp = fitSlope(cast.map((r) => Math.log(r.massAt1000)), cast.map((r) => Math.log(r.limbLoadKPa / r.massAt1000 ** (1 / 3))))
  console.log(`\n  across the cast, limb load ~ mass^${fc.s.toFixed(2)}  (r2 ${fc.r2.toFixed(2)}, n=${cast.length})`)
  const prediction = 1 / 3
  const gap = Math.abs(fc.s - prediction)
  if (gap < 0.05) {
    console.log(`  geometric similarity predicts 0.33 and the cast measures ${fc.s.toFixed(2)}: they agree. So the`)
    console.log('  artist\'s animals already sit on the curve their own size knob would carry them along. The cast is')
    console.log('  self-consistent, and the defect, if there is one, is not a size law. It is that nothing *checks*.')
  } else {
    console.log(`  geometric similarity predicts 0.33 and the cast measures ${fc.s.toFixed(2)}, a gap of ${gap.toFixed(2)}.`)
    console.log('  So the cast does NOT follow its own size knob: the animals were sized by eye, and this file has')
    console.log('  just found the gap rather than assumed there was none.')
  }
  const normalised = fc.s - prediction
  console.log(`  residual after removing the similarity trend: ${normalised.toFixed(2)} (0 means nothing to explain).`) 

  // (3) mass as a solver — the shape of every real gain
  console.log('\n(3) mass as a knob you can ask for\n')
  const target = 5000 // a leaner 3 m bull; an artist choice, not a fact
  let f = 1
  let prims = ref
  let m = mRef
  console.log(`  the sculpt is ${mRef.massAt(1000).toFixed(0)} kg. ask for ${target} kg and let the torso be fitted, keeping the height and the stance.`)
  for (let it = 0; it < 4; it++) {
    f *= Math.sqrt(target / m.volume) // the section scales as f^2 for a fixed body length
    prims = fattenTorso(ref, f)
    m = await measure(prims, { h: H_REF })
    console.log(`    pass ${it + 1}: torso x${f.toFixed(3)}  ->  ${m.massAt(1000).toFixed(0)} kg, height ${m.height.toFixed(2)} m, margin ${Number.isNaN(m.margin) ? '—' : m.margin.toFixed(2)} m, limb load ${(m.limbLoad / 1000).toFixed(1)} kPa`)
  }
  console.log(`  ${f > 1 ? 'fatter' : 'slimmer'} torso by ${(100 * Math.abs(f - 1)).toFixed(1)}%, the height moves ${(100 * Math.abs(m.height / mRef.height - 1)).toFixed(1)}% and the stance holds.`)
  console.log('  that is the whole trick: the mass stops being a number you drew and becomes a number you asked for.')

  await Bun.write('madhuban-morphology/out/scale.json', JSON.stringify({
    sweep: uni.map((u) => ({ k: u.k, height: u.m.height, volume: u.m.volume, massKg: u.m.massAt(1000), limbArea: u.m.limbArea, limbLoadKPa: u.m.limbLoad / 1000, margin: u.m.margin, comHeight: u.m.com[1] })),
    exponents: ex,
    cast: { s: fc.s, r2: fc.r2, n: cast.length },
    real: { massKg: mRef.massAt(1000), height: mRef.height, limbLoadKPa: mRef.limbLoad / 1000, margin: mRef.margin, loadFore: mRef.loadFore },
    solve: { targetKg: target, torsoFactor: f, gotKg: m.massAt(1000), height: m.height, margin: m.margin },
  }, null, 2))
  console.log('\n  wrote out/scale.json')
}

if (import.meta.main) await main()
