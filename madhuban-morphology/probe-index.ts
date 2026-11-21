// probe: can every species' index.js be loaded headlessly (no `three`), and does
// variation() -> rig(params) -> sculpt(m, rig, params) work for all of them?
import { pathToFileURL } from 'node:url'

const SRC = 'C:/Users/mehul/OneDrive/Desktop/Studio/KnowledgeBase/experiments/madhubani-animals/src'
const load = (p: string) => import(pathToFileURL(p).href)
const SPECIES = [
  'boar', 'bear', 'cat', 'cheetah', 'cow', 'deer', 'dog', 'fox', 'frog', 'goat',
  'horse', 'rabbit', 'lion', 'pig', 'rat', 'wolf', 'sheep',
  'chicken', 'crow', 'eagle', 'fish', 'shark', 'snake', 'spider', 'elephant',
]

const SDFModel = (await load(`${SRC}/core/sdf/sdf.js`)).SDFModel

function rng(seed = 12345) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

for (const sp of SPECIES) {
  const line = `${sp.padEnd(10)}`
  try {
    const mod: any = await load(`${SRC}/species/${sp}/index.js`)
    const d = mod.default
    const R = rng(7)
    const params = d.variation ? d.variation(R, {}) : {}
    const rig = d.rig(params)
    const m = new SDFModel()
    d.sculpt(m, rig, params)
    console.log(`${line} OK   prims=${String(m.prims.length).padStart(4)}  plan=${d.plan}  joints=${Object.keys(rig.J ?? {}).length}`)
  } catch (e) {
    console.log(`${line} FAIL ${String((e as Error).message).slice(0, 110)}`)
  }
}
