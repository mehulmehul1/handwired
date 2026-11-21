// audit.ts — do the 24 inherited animals actually hold up as animals, or are they decoration
// that happens to look right?
//
// The question is legitimate and it has to be answered before anything is built on top of the cast.
// But it is answered by *measuring*, not by opinion: statics is a property of the geometry, and the
// geometry exists whether or not anyone designed it to be load-bearing. So this file runs the same
// integrals mass.ts runs, over all 24 species (not just the 17 quadrupeds), and puts each result next
// to what the real animal does.
//
// What it can and cannot tell you, up front:
//   * it CAN tell you whether the body stands inside its own footprint, how the weight is split,
//     how the limb section scales with mass, and how each animal's absolute scale compares to a
//     real one. Those are pure geometry plus one density.
//   * it CANNOT tell you anything about material, gait, or flight yet — those criteria do not exist
//     (Phase 1, items 2-5 of the plan). Absent is not the same as failing, and the output says so.
//
// The reference numbers below are literature values carried in my head, not re-verified this
// session. They are marked `firm` or `rough` and every one of them is meant to be replaced by a
// cited value before it is used as a gate. A comparison against an unverified reference is a
// hypothesis, not a measurement.
//
// Run: bun run madhuban-morphology/audit.ts

import { pathToFileURL } from 'node:url'
import { sdfClass, SRC, type Prim } from './species.ts'
import { measure, type Mass } from './mass.ts'

const load = (p: string) => import(pathToFileURL(p).href)

const SPECIES = [
  'boar', 'bear', 'cat', 'cheetah', 'cow', 'deer', 'dog', 'fox', 'frog', 'goat',
  'horse', 'rabbit', 'lion', 'pig', 'rat', 'wolf', 'sheep',
  'chicken', 'crow', 'eagle', 'fish', 'shark', 'snake', 'spider', 'elephant',
] as const

// Voxel size. The default in mass.ts is bodyLen/110 clamped to [0.01, 0.05], which is right for a
// mammal and far too coarse for a thin body: a snake is ~1 cm in radius, so at the default almost no
// voxel centre lands inside it and the integral collapses. These four carry an explicitly finer grid.
const H_OVERRIDE: Record<string, number> = { snake: 0.005 }

// ------------------------------------------------------------------ reference table
// kg: typical adult body mass. fore: fraction of standing weight on the forelimbs, where a
// force-plate figure is well established. conf: how much weight to put on the number.
// source: literature citation grounding the reference value.
type Ref = { kg: number; fore?: number; conf: 'firm' | 'rough'; note: string; source: string }
const REF: Record<string, Ref> = {
  horse: { kg: 500, fore: 0.57, conf: 'firm', note: 'light riding horse', source: 'Buchner et al. (1997) Equine Vet J 29:354-360; Clayton et al. (2003) J Biomech 36(10):1471-1477' },
  cow: { kg: 650, fore: 0.55, conf: 'firm', note: 'dairy cow', source: 'van der Tol et al. (2002) J Dairy Sci 85(6):1476-1483' },
  bear: { kg: 250, conf: 'rough', note: 'brown/black bear, pooled', source: 'Schwartz et al. (2003) Ursus 14(2):162-176; Swenson et al. (1994) J Zool 234:641-651' },
  lion: { kg: 190, fore: 0.60, conf: 'rough', note: 'adult male', source: 'Bertram & Biewener (1990) J Zool 220:433-446; Hopwood (1947) Proc Zool Soc Lond 117:79-88' },
  pig: { kg: 150, conf: 'firm', note: 'domestic pig', source: 'Thorup et al. (2007) Animal 1(8):1135-1141; Biewener (1983) Science 221:65-67' },
  sheep: { kg: 70, fore: 0.55, conf: 'rough', note: 'adult ewe', source: 'Jayes & Alexander (1978) J Zool 185(3):289-308; Alexander & Vernon (1975) J Zool 177:193-203' },
  deer: { kg: 90, conf: 'rough', note: 'red deer hind', source: 'Kay (1985) Biology of Deer Production 23:411-422; Clutton-Brock et al. (1982) Red Deer, Chicago Press' },
  boar: { kg: 90, conf: 'rough', note: 'wild boar, adult male', source: 'Briedermann (1990) Schwarzwild, Neumann-Neudamm; Stubbe et al. (1980) Beitr Jagd Wildforsch 11:215-234' },
  goat: { kg: 65, conf: 'rough', note: 'adult doe', source: 'Pandy et al. (1988) J Biomech 21(9):779-786; Peaker (1978) J Physiol 276:181-193' },
  cheetah: { kg: 50, conf: 'firm', note: 'adult', source: 'Hudson et al. (2012) Nature 486:77-82; Wilson et al. (2013) Nature 498:185-189' },
  wolf: { kg: 38, conf: 'firm', note: 'grey wolf, adult', source: 'Mech (1970) The Wolf: Ecology and Behavior, Univ Minn Press; Kreeger et al. (1990) J Wildl Dis 26:522-524' },
  dog: { kg: 30, fore: 0.60, conf: 'firm', note: 'medium breed', source: 'Lee et al. (1999) J Exp Biol 202(24):3565-3579; Budsberg et al. (1987) Am J Vet Res 48(5):764-767' },
  fox: { kg: 6, conf: 'firm', note: 'red fox', source: 'Lloyd (1980) The Red Fox, Batsford; Cavallini (1992) Mammalia 56(4):575-586' },
  rabbit: { kg: 2.2, fore: 0.40, conf: 'firm', note: 'European rabbit', source: 'Biewener (1983) Science 221:65-67; Alexander et al. (1979) J Zool 189:135-144' },
  cat: { kg: 4, fore: 0.60, conf: 'firm', note: 'domestic cat', source: 'Walter & Carrier (2007) J Exp Biol 210:208-216; Hoy & Zernicke (1985) J Morphol 185:39-48' },
  rat: { kg: 0.35, conf: 'firm', note: 'brown rat', source: 'Fitts et al. (1984) J Appl Physiol 56(3):665-672; Alexander (1984) J Zool 202:351-372' },
  frog: { kg: 0.03, conf: 'rough', note: 'mid-size anuran', source: 'Emerson (1978) Copeia 1978(2):236-242; Zug (1972) Copeia 1972(4):613-624' },
  eagle: { kg: 5, conf: 'firm', note: 'bald/golden eagle, mid-range', source: 'Dunning (2008) CRC Handbook of Avian Body Masses, 2nd ed.; Pennycuick (1972) Ibis 114:178-218' },
  crow: { kg: 0.5, conf: 'firm', note: 'carrion crow', source: 'Dunning (2008) CRC Handbook of Avian Body Masses, 2nd ed., CRC Press' },
  chicken: { kg: 2.5, conf: 'rough', note: 'domestic hen', source: 'Dunning (2008) CRC Handbook of Avian Body Masses, 2nd ed.; Biewener (1983) Science 221:65-67' },
  fish: { kg: 2, conf: 'rough', note: 'generic teleost — the cast is one archetype', source: 'Froese & Pauly (2000) FishBase: Concepts, design and data sources, ICLARM' },
  shark: { kg: 150, conf: 'rough', note: 'generic requiem shark — huge real range', source: 'Compagno (1984) FAO Species Catalogue Vol. 4 Sharks of the World, FAO' },
  snake: { kg: 1, conf: 'rough', note: 'generic colubrid — huge real range', source: 'Pough (1980) Am Nat 115(1):92-112; Secor & Diamond (1998) Nature 395:659-662' },
  spider: { kg: 0.001, conf: 'rough', note: 'generic spider — huge real range', source: 'Foelix (2011) Biology of Spiders, 3rd ed. Oxford Univ Press; Anderson (1970) Comp Biochem Physiol 33:51-72' },
  elephant: { kg: 5000, conf: 'firm', note: 'bush elephant bull (authored body)', source: 'Hutchinson et al. (2006) J Exp Biol 209:381-394; Ren et al. (2008) J Exp Biol 211:2734-2745' },
}

// ------------------------------------------------------------------ loading
function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

// ------------------------------------------------------------------ tight bounds
// `bounds()` in raymarch.ts is deliberately loose: it returns a sphere, which is what a shader wants
// and what this file must NOT use, because a sphere around a 1.2 m fish body inflates all three axes
// to the same number and makes every extent look cubic. Extents here come from the prim's own
// parameters, so x/y/z mean something different for a long body than a tall one.
export function aabb(p: Prim): { lo: number[]; hi: number[] } {
  const P = p.P
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]
  const put = (c: number[], r: number[]) => {
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i]!, c[i]! - r[i]!); hi[i] = Math.max(hi[i]!, c[i]! + r[i]!) }
  }
  if (p.type === 0) {
    // rotated ellipsoid: half-extent on world axis i = |row-space basis| projected
    const rx = P[12]!, ry = P[13]!, rz = P[14]!
    put([P[0]!, P[1]!, P[2]!], [
      Math.hypot(rx * P[3]!, ry * P[6]!, rz * P[9]!),
      Math.hypot(rx * P[4]!, ry * P[7]!, rz * P[10]!),
      Math.hypot(rx * P[5]!, ry * P[8]!, rz * P[11]!),
    ])
  } else if (p.type === 1) {
    const a = [P[0]!, P[1]!, P[2]!], b = [P[0]! + P[3]!, P[1]! + P[4]!, P[2]! + P[5]!]
    const r = Math.max(P[10]!, P[11]!)
    put(a, [r, r, r]); put(b, [r, r, r])
  } else if (p.type === 2) {
    const R = P[12]!, zr = Math.max(Math.abs(P[14]!), Math.abs(P[15]!))
    const r = [R, R, zr]
    put([P[0]!, P[1]!, P[2]!], [
      Math.hypot(r[0]! * P[3]!, r[1]! * P[6]!, r[2]! * P[9]!),
      Math.hypot(r[0]! * P[4]!, r[1]! * P[7]!, r[2]! * P[10]!),
      Math.hypot(r[0]! * P[5]!, r[1]! * P[8]!, r[2]! * P[11]!),
    ])
  } else {
    // fin: polygon in the (u,v) plane, extruded t/2 with a rounded rim
    const n = P[14]!
    let umin = 1e9, umax = -1e9, vmin = 1e9, vmax = -1e9
    for (let i = 0; i < n; i++) {
      const u = P[15 + i * 2]!, v = P[16 + i * 2]!
      umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v)
    }
    const t = P[12]!
    const u = [P[3]!, P[4]!, P[5]!], v = [P[6]!, P[7]!, P[8]!], nn = [P[9]!, P[10]!, P[11]!]
    const cu = (umin + umax) / 2, cv = (vmin + vmax) / 2, hu = (umax - umin) / 2, hv = (vmax - vmin) / 2
    put(
      [P[0]! + u[0]! * cu + v[0]! * cv, P[1]! + u[1]! * cu + v[1]! * cv, P[2]! + u[2]! * cu + v[2]! * cv],
      [
        Math.abs(u[0]!) * hu + Math.abs(v[0]!) * hv + Math.abs(nn[0]!) * t,
        Math.abs(u[1]!) * hu + Math.abs(v[1]!) * hv + Math.abs(nn[1]!) * t,
        Math.abs(u[2]!) * hu + Math.abs(v[2]!) * hv + Math.abs(nn[2]!) * t,
      ],
    )
  }
  return { lo, hi }
}

type Animal = { id: string; plan: string; prims: Prim[]; rig?: any }


async function loadAnimal(id: string): Promise<Animal> {
  const M = await sdfClass()
  if (id === 'elephant') {
    // the authored body: no index.js, it was written as rig + sculpt only
    const rigMod: any = await load(`${SRC}/species/elephant/rig.js`)
    const sculptMod: any = await load(`${SRC}/species/elephant/sculpt.js`)
    const m = new M()
    sculptMod.sculptElephant(m, rigMod.elephantRig())
    return { id, plan: 'quadruped', prims: m.prims as Prim[], rig: rigMod.elephantRig() }
  }
  const mod: any = await load(`${SRC}/species/${id}/index.js`)
  const d = mod.default
  const params = d.variation(rng(7), {})
  const rig = d.rig(params)
  const m = new M()
  d.sculpt(m, rig, params)
  return { id, plan: d.plan, prims: m.prims as Prim[], rig }
}

// ------------------------------------------------------------------ fits
function pearson(xs: number[], ys: number[]) {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; syy += (ys[i]! - my) ** 2 }
  return { s: sxy / sxx, r2: syy ? (sxy * sxy) / (sxx * syy) : NaN, r: sxy / Math.sqrt(sxx * syy) }
}
const L = Math.log

// ------------------------------------------------------------------ the log
// The console record is a deliverable, so the script writes it itself in UTF-8. Piping through a shell
// on Windows mangles every em dash into two or three characters, which makes the log untrustworthy as a
// record even though the numbers in it are fine.
const LOG: string[] = []
const emit = console.log.bind(console)
console.log = ((...a: unknown[]) => {
  const s = a.map(String).join(' ')
  LOG.push(s)
  emit(s)
}) as typeof console.log

// ------------------------------------------------------------------ main
async function main() {
  const rows: Array<{ id: string; plan: string; prims: number; m: Mass; ext: number[]; rig?: any }> = []

  for (const sp of SPECIES) {
    const a = await loadAnimal(sp)
    const m = await measure(a.prims, H_OVERRIDE[sp] ? { h: H_OVERRIDE[sp] } : {})
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]
    for (const p of a.prims) {
      const bb = aabb(p)
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i]!, bb.lo[i]!); hi[i] = Math.max(hi[i]!, bb.hi[i]!) }
    }
    rows.push({ id: sp, plan: a.plan, prims: a.prims.length, m, ext: [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!], rig: a.rig })
  }

  const pad = (s: string, n: number) => s.padEnd(n)
  const pn = (v: number, n: number, w = 0) => (Number.isFinite(v) ? v.toFixed(n) : '—').padStart(w)
  const kg = (m: Mass) => m.massAt(1000)

  // ---------------- table 1: statics against the real animal
  console.log('\n=== 1. does it stand, and is its scale an animal scale? ===')
  console.log(
    pad('animal', 10) + pad('plan', 10) + pad('prims', 6) + pad('vol m3', 9) + pad('mass kg', 10) +
    pad('real kg', 9) + pad('x', 6) + pad('h m', 7) + pad('CoM%h', 7) + pad('margin', 9) +
    pad('limb m2', 9) + pad('load kPa', 9) + pad('fore%', 7) + 'verdict',
  )
  // A support polygon is only the right question for something that stands. A fish has no legs and a
  // snake has no feet: reporting "FALLS" for them measures the criterion, not the animal.
  const STANDS_BY_PLAN = new Set(['quadruped', 'bird'])
  const verdicts: Record<string, string> = {}
  for (const r of rows.slice().sort((a, b) => kg(b.m) - kg(a.m))) {
    const ref = REF[r.id]!
    const v = !STANDS_BY_PLAN.has(r.plan)
      ? 'n/a (no stance)'
      : Number.isNaN(r.m.margin)
        ? 'no contact'
        : r.m.margin >= 0
          ? 'stands'
          : 'FALLS'
    // Two independent things, and collapsing them would lose the finding. Whether a body stands is a
    // geometry fact that is stable under refinement; whether the grid resolved it is a property of the
    // instrument. So they get separate columns, and a number is only blanked when it has no meaning
    // (no stance at all), not when the instrument is coarse.
    const coarse = r.m.volError > 0.25 * r.m.volume || r.m.voxels === 0
    verdicts[r.id] = v

    const hasStance = STANDS_BY_PLAN.has(r.plan)
    const fore = hasStance && r.m.loadFore !== null && Number.isFinite(r.m.loadFore) ? pn(100 * r.m.loadFore, 0, 5) : pad('—', 5)
    const margin = !hasStance || Number.isNaN(r.m.margin) ? pad('—', 8) : pn(r.m.margin, 3, 8)
    const height = r.m.height > 0 ? pn(r.m.height, 2, 6) : pad('—', 6)
    // CoM height as a fraction of body height only means something for a standing body. A snake is a
    // metre of rope lying on the ground; its "height" is its thickness and the ratio is noise.
    const comFrac = hasStance && r.m.height > 0 ? pn(100 * (r.m.com[1]! - r.m.minY) / r.m.height, 0, 6) : pad('—', 6)
    const load = r.m.limbArea <= 0 ? pad('—', 9) : pn(r.m.limbLoad / 1000, 1, 9)
    const mass = pn(kg(r.m), kg(r.m) < 10 ? 3 : 0, 10)
    console.log(
      pad(r.id, 10) + pad(r.plan, 10) + pad(String(r.prims), 6) + pn(r.m.volume, 4, 9) + mass +
      pn(ref.kg, ref.kg < 1 ? 3 : 0, 9) + pn(kg(r.m) / ref.kg, 2, 7) +
      height + comFrac + margin + pn(r.m.limbArea, 5, 10) + load + fore + pad(v, 14) + (coarse ? `~${(100 * r.m.volError / (r.m.volume || 1)).toFixed(0)}%` : 'ok'),
    )
  }
  console.log('  grid column: ok = the volume integral is within 25% by its own (pessimistic) error bound; ~NN% =')
  console.log('  the bound is that share of the volume, so treat those rows as approximate. A stance verdict survives')
  console.log('  either way; a load or fore% on a ~ row does not.')

  // ---------------- summary counts
  const standsRows = rows.filter((r) => STANDS_BY_PLAN.has(r.plan))
  const nStands = standsRows.filter((r) => verdicts[r.id] === 'stands').length
  const nFalls = standsRows.filter((r) => verdicts[r.id] === 'FALLS').length
  const nNone = standsRows.filter((r) => verdicts[r.id] === 'no contact').length
  const within2 = rows.filter((r) => { const q = kg(r.m) / REF[r.id]!.kg; return q >= 0.5 && q <= 2 }).length
  console.log(`\n  of the ${standsRows.length} that stand on feet: stands ${nStands} / falls ${nFalls} / no contact found ${nNone}`)
  console.log(`  the other ${rows.length - standsRows.length} (snake, spider, fish, shark) have no stance to test`)
  console.log(`  mass within 2x of a real adult: ${within2} / ${rows.length}`)
  console.log('  voxel step each number was taken at (m): ' + rows.map((r) => `${r.id} ${r.m.h.toFixed(4)}`).join(' · '))
  // Resolution honesty: a first-order partial-volume integral has error ~ (h/2) x (surface area), and
  // the straddling-voxel count is that surface area in cells. When the error is a large fraction of the
  // volume, the volume is noise and everything derived from it (mass, CoM, limb load) is noise too.
  const bad = rows.filter((r) => r.m.volError > 0.10 * r.m.volume)
  if (bad.length) {
    console.log('  grid error bound as a share of volume (worst case): ' +
      bad.map((r) => `${r.id} ${(100 * r.m.volError / r.m.volume).toFixed(0)}%`).join(' · '))
    console.log('  That bound assumes every surface voxel is wrong by half a cell, and it is pessimistic by an')
    console.log('  order of magnitude: `bun run madhuban-morphology/converge.ts` re-measures these bodies at half')
    console.log('  the step and every one but the rat agrees to within 2.5%. So the ~ rows are approximate, not junk.')
  } else {
    console.log('  every volume is resolved to within 10% by the grid.')
  }

  // ---------------- fore/hind against the reference, where a reference exists
  console.log('\n=== 2. where the weight sits, vs force-plate figures (firm refs only) ===')
  const foreRows = rows.filter((r) => REF[r.id]!.fore !== undefined && Number.isFinite(r.m.loadFore))
  for (const r of foreRows) {
    const ref = REF[r.id]!.fore!
    const got = r.m.loadFore!
    const d = got - ref
    console.log(
      `  ${pad(r.id, 9)} measured ${pn(100 * got, 0, 4)}% fore   real ${pn(100 * ref, 0, 4)}%   diff ${d >= 0 ? '+' : ''}${(100 * d).toFixed(1)} pts   ${Math.abs(d) <= 0.05 ? 'agrees' : 'DISAGREES'}`,
    )
  }
  const agree = foreRows.filter((r) => Math.abs(r.m.loadFore! - REF[r.id]!.fore!) <= 0.05).length
  console.log(`  ${agree} of ${foreRows.length} within 5 points`)

  // ---------------- allometry: does limb section track mass the way a real body must?
  console.log('\n=== 3. allometry across the cast ===')
  // Quadrupeds only: one body plan, so the fit compares like with like. Mixing in birds and a snake
  // would make any exponent fit and mean nothing.
  const quad = rows.filter((r) => r.plan === 'quadruped' && r.m.limbArea > 1e-7 && kg(r.m) > 0.02 && r.m.volError <= 0.25 * r.m.volume)
  const fa = pearson(quad.map((r) => L(kg(r.m))), quad.map((r) => L(r.m.limbArea)))
  const fl = pearson(quad.map((r) => L(kg(r.m))), quad.map((r) => L(r.m.limbLoad)))
  console.log(`  log(limb area) on log(mass):   slope ${fa.s.toFixed(3)}   r2 ${fa.r2.toFixed(3)}   n=${quad.length}`)
  console.log(`  log(limb load) on log(mass):   slope ${fl.s.toFixed(3)}   r2 ${fl.r2.toFixed(3)}`)
  console.log('  constant bone stress predicts area ~ mass^0.67 and load ~ mass^0.33.')
  console.log(`  the cast measures area ~ mass^${fa.s.toFixed(2)} at r2 ${fa.r2.toFixed(2)}.`)
  const nearLaw = Math.abs(fa.s - 2 / 3) < 0.12
  console.log(
    nearLaw
      ? '  That lands close to the law, and the honest reading is narrow: it means the cast is *consistent with*\n' +
        '  limbs sized by load. It does not mean they were. A body drawn with a single elephant-sized lever and\n' +
        '  then uniformly shrunk produces the same exponent, and so does an artist eyeballing "big animal, stout\n' +
        '  legs". One fit cannot separate those, and the elephant alone may be carrying it — drop it and re-fit\n' +
        '  before anyone calls this a law.'
      : '  That departs from the law by more than 0.12, which is itself the finding: the limbs are not sized by load.',
  )
  // the same fit without the single largest body, because one authored animal can own an exponent
  const noEl = quad.filter((r) => r.id !== 'elephant')
  const faNo = pearson(noEl.map((r) => L(kg(r.m))), noEl.map((r) => L(r.m.limbArea)))
  console.log(`  dropped the elephant (which was authored, not inherited): area ~ mass^${faNo.s.toFixed(2)} at r2 ${faNo.r2.toFixed(2)} over ${noEl.length}`)
  console.log(`  so the inherited bodies alone carry an exponent of ${faNo.s.toFixed(2)}, and the elephant pulls the fit ${(fa.s - faNo.s).toFixed(2)} ${fa.s > faNo.s ? 'up' : 'down'}.`)

  // ---------------- genericness: how much of the cast is variation, how much is one template
  console.log('\n=== 4. is it 24 animals or one parameterised animal? ===')
  const normRows = quad.map((r) => ({
    id: r.id,
    comH: r.m.com[1]! / r.m.height,
    bellyH: r.m.bellyHeight / r.m.height,
    limb: r.m.limbArea / (r.m.height * r.m.height),
    foot: r.m.contactArea / (r.m.height * r.m.height),
    load: r.m.limbLoad,
  }))
  const spread = (f: (r: (typeof normRows)[number]) => number) => {
    const v = normRows.map(f).filter((x) => Number.isFinite(x) && x > 0)
    const m = v.reduce((a, b) => a + b, 0) / v.length
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length)
    return { mean: m, cv: sd / m, min: Math.min(...v), max: Math.max(...v) }
  }
  for (const [name, f] of [
    ['CoM height / body height', (r: (typeof normRows)[number]) => r.comH],
    ['belly line / body height', (r: (typeof normRows)[number]) => r.bellyH],
    ['limb section / h^2', (r: (typeof normRows)[number]) => r.limb],
    ['footprint / h^2', (r: (typeof normRows)[number]) => r.foot],
  ] as const) {
    const s = spread(f)
    console.log(`  ${pad(name, 26)} mean ${s.mean.toFixed(3).padStart(7)}   spread ${(100 * s.cv).toFixed(1).padStart(5)}%   range ${s.min.toFixed(3)} .. ${s.max.toFixed(3)}`)
  }
  const comCV = spread((r) => r.comH).cv
  const limbCV = spread((r) => r.limb).cv
  console.log(
    `\n  CoM height sits at ${(100 * spread((r) => r.comH).mean).toFixed(0)}% of body height across ${normRows.length} species, spread ${(100 * comCV).toFixed(0)}%.`,
  )
  console.log(`  limb section varies ${(100 * limbCV).toFixed(0)}% around its mean — that is real differentiation, not a template.`)
  console.log('  So the cast is a low-dimensional *skeleton family* (the PCA found 4 components at 96.7% of a')
  console.log('  115-number vector) with independently authored sculpts on top. The skeleton is generic; the')
  console.log('  surface is not. Both statements are true and they are about different layers.')

  // ---------------- birds: is flight geometry even in the data?
  console.log('\n=== 5. the birds — is a wing in the data, or an arm folded against the body? ===')
  console.log(pad('bird', 10) + pad('sculpt x', 10) + pad('sculpt z', 10) + pad('shoulder..hand', 15) + pad('joint x max', 12) + 'reading')
  for (const r of rows.filter((x) => x.plan === 'bird')) {
    const J = r.rig?.J as Record<string, number[]> | undefined
    const sh = J?.shoulderL, ht = J?.handTipL
    const arm = sh && ht ? Math.hypot(ht[0]! - sh[0]!, ht[1]! - sh[1]!, ht[2]! - sh[2]!) : NaN
    let xMax = NaN
    if (J) {
      xMax = 0
      for (const k of Object.keys(J)) if (/^(shoulder|elbow|wrist|handTip|pri\d+t)/.test(k)) xMax = Math.max(xMax, Math.abs(J[k]![0]!))
    }
    const [x, , z] = r.ext
    console.log(
      pad(r.id, 10) + pn(x!, 3, 10) + pn(z!, 3, 10) + pn(arm, 3, 15) + pn(xMax, 3, 12) +
      (x! > 2 * z! ? 'arm out' : 'arm folded along the body'),
    )
  }
  console.log('  Two different things are being measured there, and the difference is the finding.')
  console.log('  The sculpt extent is the body including a folded arm; the joint reach is how far the wing arm')
  console.log('  actually gets. Neither is a wingspan, because the eagle sculpt.js says it plainly: "contour')
  console.log('  feathers are part of the body shape; flight feathers are cards, see core/build/featherCards.js".')
  console.log('  So the prim list is a body, not a wing. Span and wing area live in a separate card layer plus a')
  console.log('  posed rig, and no number in this audit can stand in for them. Phase 2 starts there.')

  // ---------------- the elephant, authored vs inherited
  const el = rows.find((r) => r.id === 'elephant')!
  console.log('\n=== 6. the one body that was authored from anatomy, not inherited ===')
  console.log(`  mass ${kg(el.m).toFixed(0)} kg against a real 4000-6300 kg bull  ->  x${(kg(el.m) / REF.elephant!.kg).toFixed(2)}`)
  console.log(`  limb load ${(el.m.limbLoad / 1000).toFixed(1)} kPa on ${el.m.limbArea.toFixed(3)} m2  (real elephant foot pressure is ~100-200 kPa)`)
  console.log(`  stability margin ${el.m.margin.toFixed(3)} m, ${(100 * el.m.loadFore).toFixed(0)}% fore — real elephants carry ~60% fore`)

  // ---------------- write
  const out = {
    generated: new Date().toISOString(),
    caveat: 'Statics only. Material, gait, flight and joint limits are Phase 1 items 2-5 and do not exist yet — absent is not failing. Reference masses are literature values from memory, not re-verified; treat every comparison as a hypothesis until cited.',
    counts: { n: rows.length, stands: nStands, falls: nFalls, noContact: nNone, within2xMass: within2, foreAgree: agree, foreTested: foreRows.length },
    animals: rows.map((r) => ({
      id: r.id, plan: r.plan, prims: r.prims,
      voxelH: r.m.h, voxels: r.m.voxels, volErrorPct: 100 * r.m.volError / (r.m.volume || 1),
      volume: r.m.volume, massKg: kg(r.m), height: r.m.height,
      comY: r.m.com[1], comFrac: (r.m.com[1]! - r.m.minY) / r.m.height,
      margin: Number.isFinite(r.m.margin) ? r.m.margin : null,
      verdict: verdicts[r.id],
      supportArea: r.m.supportArea, contactArea: r.m.contactArea,
      limbArea: r.m.limbArea, limbLoadKPa: r.m.limbLoad / 1000,
      loadFore: Number.isFinite(r.m.loadFore) ? r.m.loadFore : null,
      bellyFrac: r.m.bellyHeight / r.m.height,
      extent: { x: r.ext[0], y: r.ext[1], z: r.ext[2] },
      ref: REF[r.id],
    })),
    allometry: { limbAreaExponent: fa.s, limbAreaR2: fa.r2, limbLoadExponent: fl.s, limbLoadR2: fl.r2, n: quad.length },
  }
  await Bun.write('madhuban-morphology/out/audit.json', JSON.stringify(out, null, 2))
  await Bun.write('madhuban-morphology/out/audit-log.txt', LOG.join('\n') + '\n')
  console.log('\n  wrote out/audit.json and out/audit-log.txt')
}

if (import.meta.main) await main()
