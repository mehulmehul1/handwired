import { pathToFileURL } from 'node:url'
import { sdfClass, SRC, type Prim } from './species.ts'
import { initRaymarch, renderOne, makeCamera, encodePNG } from './raymarch.ts'

const load = (p: string) => import(pathToFileURL(p).href)

async function elephant(): Promise<Prim[]> {
  const rigMod: any = await load(`${SRC}/species/elephant/rig.js`)
  const sculptMod: any = await load(`${SRC}/species/elephant/sculpt.js`)
  const m = new (await sdfClass())()
  sculptMod.sculptElephant(m, rigMod.elephantRig())
  return m.prims as Prim[]
}

await initRaymarch()
const prims = await elephant()
const W = 900, H = 700
const which = process.argv[2] ?? 'side'
const az = { side: 0.02, q34: -0.72, front: -1.5, rear: 2.3, top: 0.02 }[which] ?? 0.02
const el = which === 'top' ? 1.15 : 0.12
const t = renderOne(prims, makeCamera(prims, { az, el, w: W, h: H }), W, H, { light: [0.44, 0.60, 0.66] })
await Bun.write(`madhuban-morphology/out/look-${which}.png`, encodePNG(W, H, t.rgba))
console.log(`look-${which}.png`)
