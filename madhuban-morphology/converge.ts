// converge.ts — is the audit's resolution warning real, or is the bound merely pessimistic?
//
// mass.ts reports a worst-case volume error of (h/2) x (surface area), approximated by counting the
// voxels that straddle the surface. That is a *bound*: a plane cutting a cube is integrated exactly by
// the first-order fraction, so the true error is usually far below it. The only way to know which is to
// re-measure the same body at a finer grid and watch the number move.
//
// A converging integral is the definition of a measurement here. If V(h) and V(h/2) agree, the number is
// real and the bound was pessimistic. If they do not, the audit is right to refuse to report it.
//
// Run: bun run madhuban-morphology/converge.ts
import { pathToFileURL } from 'node:url'
import { sdfClass, SRC, type Prim } from './species.ts'
import { measure } from './mass.ts'

const load = (p: string) => import(pathToFileURL(p).href)
const M = await sdfClass()

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

// the animals the audit flagged, worst first
const CASES: Array<[string, number]> = [
  ['cat', 0.0100], ['fox', 0.0100], ['rabbit', 0.0100], ['rat', 0.0100],
  ['crow', 0.0100], ['frog', 0.0100], ['cheetah', 0.0167], ['dog', 0.0122], ['wolf', 0.0134],
]

async function primsOf(id: string): Promise<Prim[]> {
  const mod: any = await load(`${SRC}/species/${id}/index.js`)
  const d = mod.default
  const params = d.variation(rng(7), {})
  const m = new M()
  d.sculpt(m, d.rig(params), params)
  return m.prims as Prim[]
}

const LOG: string[] = []
const emit = console.log.bind(console)
console.log = ((...a: unknown[]) => { const s = a.map(String).join(' '); LOG.push(s); emit(s) }) as typeof console.log
console.log('animal    h        volume      bound %   V(h/2)      V(h)/V(h/2)   change    verdict')
for (const [id, h0] of CASES) {
  const prims = await primsOf(id)
  const coarse = await measure(prims, { h: h0 })
  const fine = await measure(prims, { h: h0 / 2 })
  const change = 100 * (coarse.volume / fine.volume - 1)
  const bound = 100 * coarse.volError / coarse.volume
  const ok = Math.abs(change) < 5
  console.log(
    `${id.padEnd(9)} ${h0.toFixed(4)}  ${coarse.volume.toFixed(6).padStart(11)}  ${bound.toFixed(1).padStart(6)}   ` +
    `${fine.volume.toFixed(6).padStart(11)}  ${(coarse.volume / fine.volume).toFixed(4).padStart(11)}   ` +
    `${(change >= 0 ? '+' : '') + change.toFixed(1)}%`.padStart(10) + `   ${ok ? 'converged' : 'NOT CONVERGED'}`,
  )
}
await Bun.write('madhuban-morphology/out/converge.txt', LOG.join('\n') + '\n')
console.log('\n  wrote out/converge.txt')
