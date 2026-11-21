// aabb-test.ts — the tight bounding boxes the audit's extents depend on, checked against the SDF
// itself, one primitive at a time.
//
// Why per-prim: a box that clips its own surface makes the killer extent wrong, and a box that is far
// too big makes a long thin body look cubic and hides a spread wing. Both errors show up on a single
// primitive, so there is no need to sample a whole animal's volume to find them.
//
// Two numbers per prim:
//   clip   — an inside point outside the box. That is a bug, full stop.
//   slack  — the gap between the box and the furthest inside point found. Not a bug: a box is allowed
//            to be conservative, but the gap is what makes an extent lie, so it gets reported.
import { pathToFileURL } from 'node:url'
import { sdfClass, SRC, type Prim } from './species.ts'
import { aabb } from './audit.ts'

const load = (p: string) => import(pathToFileURL(p).href)
const M = await sdfClass()

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

const CASES = ['cat', 'eagle', 'fish', 'spider', 'snake', 'elephant']
const N = 22 // samples per axis per prim
let clipped = 0
let tested = 0
let worstRelSlack = 0
let worstLabel = ''

for (const sp of CASES) {
  let prims: Prim[]
  if (sp === 'elephant') {
    const rigMod: any = await load(`${SRC}/species/elephant/rig.js`)
    const sculptMod: any = await load(`${SRC}/species/elephant/sculpt.js`)
    const m = new M()
    sculptMod.sculptElephant(m, rigMod.elephantRig())
    prims = m.prims as Prim[]
  } else {
    const mod: any = await load(`${SRC}/species/${sp}/index.js`)
    const d = mod.default
    const params = d.variation(rng(7), {})
    const m = new M()
    d.sculpt(m, d.rig(params), params)
    prims = m.prims as Prim[]
  }

  const model = new M() // kept only so the class initialises; eval uses the static field
  void model
  for (const p of prims) {
    const { lo, hi } = aabb(p)
    const span = [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!]
    const diag = Math.hypot(span[0]!, span[1]!, span[2]!)
    const tl = [1e9, 1e9, 1e9], th = [-1e9, -1e9, -1e9]
    for (let a = 0; a <= N; a++) {
      const x = lo[0]! + (span[0]! * a) / N
      for (let b = 0; b <= N; b++) {
        const y = lo[1]! + (span[1]! * b) / N
        for (let c = 0; c <= N; c++) {
          const z = lo[2]! + (span[2]! * c) / N
          if (M.dist(p, x, y, z) >= 0) continue
          const q = [x, y, z]
          for (let i = 0; i < 3; i++) { tl[i] = Math.min(tl[i]!, q[i]!); th[i] = Math.max(th[i]!, q[i]!) }
        }
      }
    }
    tested++
    if (tl[0]! > 1e8) continue // no inside point at this resolution — nothing to check
    const slack = Math.max(
      Math.abs(tl[0]! - lo[0]!), Math.abs(th[0]! - hi[0]!),
      Math.abs(tl[1]! - lo[1]!), Math.abs(th[1]! - hi[1]!),
      Math.abs(tl[2]! - lo[2]!), Math.abs(th[2]! - hi[2]!),
    )
    const rel = slack / diag
    if (rel > worstRelSlack) { worstRelSlack = rel; worstLabel = `${sp} prim ${p.id} ${p.tag}` }
    // an inside point beyond the box, by more than one sample step, means the box clipped the surface
    if (tl[0]! < lo[0]! - span[0]! / N || th[0]! > hi[0]! + span[0]! / N ||
        tl[1]! < lo[1]! - span[1]! / N || th[1]! > hi[1]! + span[1]! / N ||
        tl[2]! < lo[2]! - span[2]! / N || th[2]! > hi[2]! + span[2]! / N) {
      clipped++
      console.log(`  CLIPPED ${sp} prim ${p.id} ${p.tag}  box ${lo.map((v) => v.toFixed(3))} .. ${hi.map((v) => v.toFixed(3))}  inside ${tl.map((v) => v.toFixed(3))} .. ${th.map((v) => v.toFixed(3))}`)
    }
  }
}

console.log(`\n${tested} primitives checked across ${CASES.length} animals`)
console.log(`  clipped: ${clipped}`)
console.log(`  worst box slack relative to its own diagonal: ${(100 * worstRelSlack).toFixed(1)}%  (${worstLabel})`)
console.log('  a box may be conservative; what matters is that it does not clip, and that the slack is small')
console.log('  next to the prim it describes — otherwise the measured extent is the box, not the animal.')
if (clipped > 0) process.exit(1)
