// Recon: can we load every quadruped's real rig + sculpt headlessly, and how big is the data?
// Run from the handwired repo root:  bun run madhuban-morphology/recon.ts

import { pathToFileURL } from 'node:url'

const SRC = 'C:/Users/mehul/OneDrive/Desktop/Studio/KnowledgeBase/experiments/madhubani-animals/src'
const SPECIES = ['boar', 'bear', 'cat', 'cheetah', 'cow', 'deer', 'dog', 'fox', 'frog', 'goat', 'horse', 'rabbit', 'lion', 'pig', 'rat', 'wolf', 'sheep'] as const

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)
const load = async (p: string) => import(pathToFileURL(p).href)

const { SDFModel } = await load(`${SRC}/core/sdf/sdf.js`)

// Primitive centre + bounding radius, read straight out of P. T_ELL=0, T_CONE=1, T_LENS=2, T_FIN=3.
function centreRadius(p: any): { c: number[]; rad: number } {
  const P = p.P
  if (p.type === 0) return { c: [P[0], P[1], P[2]], rad: Math.max(P[12], P[13], P[14]) }
  if (p.type === 1) {
    const a = [P[0], P[1], P[2]], ba = [P[3], P[4], P[5]]
    const c = [a[0] + ba[0] / 2, a[1] + ba[1] / 2, a[2] + ba[2] / 2]
    return { c, rad: Math.hypot(ba[0], ba[1], ba[2]) / 2 + Math.max(P[10], P[11]) }
  }
  return { c: [P[0], P[1], P[2]], rad: 0.05 }
}

let ok = 0
let totalPrims = 0
for (const sp of SPECIES) {
  try {
    const rigMod = await load(`${SRC}/species/${sp}/rig.js`)
    const rigFn = (rigMod as any)[`${sp}Rig`]
    if (!rigFn) throw new Error(`no ${sp}Rig export`)
    const rig = rigFn()

    const sculptMod = await load(`${SRC}/species/${sp}/sculpt.js`)
    const sculptFn = (sculptMod as any)[`sculpt${cap(sp)}`]
    if (!sculptFn) throw new Error(`no sculpt${cap(sp)} export`)
    const m = new SDFModel()
    sculptFn(m, rig)

    const names = Object.keys(rig.J)
    const prims = m.prims as any[]
    const groups = [...new Set(prims.map((p) => p.group))]
    const xs: number[] = [], ys: number[] = [], zs: number[] = []
    for (const p of prims) { const { c } = centreRadius(p); xs.push(c[0]!), ys.push(c[1]!), zs.push(c[2]!) }
    const bb = (a: number[]) => `${Math.min(...a).toFixed(2)}..${Math.max(...a).toFixed(2)}`
    console.log(
      `${sp.padEnd(8)} joints ${String(names.length).padStart(2)}  prims ${String(prims.length).padStart(4)}  unit ${String(rig.unit).slice(0, 5)}  ` +
        `bbox X ${bb(xs)} Y ${bb(ys)} Z ${bb(zs)}`,
    )
    console.log(`         groups: ${groups.join(', ')}`)
    ok++
    totalPrims += prims.length
  } catch (e: any) {
    console.log(`${sp.padEnd(8)} FAIL: ${e?.message ?? e}`)
  }
}
console.log(`\nloaded ${ok}/${SPECIES.length}   total prims ${totalPrims}`)

// Field survey of one primitive so the mass model knows what it is reading.
const rigMod = await load(`${SRC}/species/wolf/rig.js`)
const rig = (rigMod as any).wolfRig()
const m = new SDFModel()
const sculptMod = await load(`${SRC}/species/wolf/sculpt.js`)
;(sculptMod as any).sculptWolf(m, rig)
console.log('\nsample prim keys:', Object.keys(m.prims[0] as object).join(', '))
console.log('types present:', [...new Set(m.prims.map((p: any) => p.type))].join(', '))
console.log('joint names:', Object.keys(rig.J).join(' '))
