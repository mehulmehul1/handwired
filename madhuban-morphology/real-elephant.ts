// The scaffold vs the sculpt.
//
//   bun run madhuban-morphology/real-elephant.ts
//
// Left: the elephant the LOOP produced — a generic body from buildMasses() (three universal
// ellipsoids + tapered cones) driven by a hand-guessed skeleton. Right: a HAND-SCULPTED elephant,
// authored in the same idiom as cow/sculpt.js — domed skull, fan ears, a real trunk, tusks, flat
// feet — rendered by the same raymarcher that draws the artist's real animals. Next to them, a real
// cow from the project, so you can judge whether the new one is in the same register.
//
// The point: the loop's elephant was not "the morphology being a blur of all skeletons". The
// skeleton data is real; the BUILDER (buildMasses) is generic by design. The nuance lives in the
// per-species sculpt, and that is a hand-authored thing.

import { pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import { sdfClass, loadSpecies, SRC, type Prim } from './species.ts'
import { initRaymarch, renderOne, makeCamera, sheet, encodePNG } from './raymarch.ts'
import { drawTextCentered } from './text.ts'
import { grow, ELEPHANT } from './elephant.ts'

const OUT = 'madhuban-morphology/out'
const W = 440, Hh = 330
const load = (p: string) => import(pathToFileURL(p).href)
const line = (s = '') => console.log(s)

async function loadElephantSculpt(): Promise<Prim[]> {
  const rigMod: any = await load(`${SRC}/species/elephant/rig.js`)
  const sculptMod: any = await load(`${SRC}/species/elephant/sculpt.js`)
  const rig = rigMod.elephantRig()
  const M = await sdfClass()
  const m = new M()
  sculptMod.sculptElephant(m, rig)
  return m.prims as Prim[]
}

function captioned(t: { rgba: Uint8Array; w: number; h: number }, text: string, capH = 18) {
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
const tileOf = (prims: Prim[], label: string, az: number, el = 0.14, zoom = 1.0) =>
  captioned(renderOne(prims, makeCamera(prims, { az, el, w: W, h: Hh, zoom }), W, Hh, { light: [0.44, 0.60, 0.66] }), label)

async function main() {
  await initRaymarch()
  mkdirSync(OUT, { recursive: true })

  const scaffold = await grow(ELEPHANT)
  const sculpt = await loadElephantSculpt()
  const cow = await loadSpecies('cow')

  line(`scaffold (buildMasses) prims: ${scaffold.prims.length}`)
  line(`hand sculpt (elephant) prims: ${sculpt.length}`)
  line(`artist cow prims:              ${cow.prims.length}`)
  line()

  const tiles = [
    tileOf(scaffold.prims, 'the loop: generic scaffold', -0.52),
    tileOf(sculpt, 'hand sculpt: elephant 3/4', -0.52),
    tileOf(sculpt, 'hand sculpt: elephant side', 0.02),
    tileOf(cow.prims, 'artist: cow (for register)', 0.02),
  ]
  const sh = sheet(tiles, 4)
  await Bun.write(`${OUT}/14-real-elephant.png`, encodePNG(sh.w, sh.h, sh.rgba))
  line(`  14-real-elephant.png (${sh.w}x${sh.h})`)

  // the elephant in the round, to judge the head, ears, trunk, feet
  const views = [
    tileOf(sculpt, 'side', 0.02),
    tileOf(sculpt, 'front 3/4', -0.72),
    tileOf(sculpt, 'front', -1.50),
    tileOf(sculpt, 'rear 3/4', 2.30),
  ]
  const sh2 = sheet(views, 4)
  await Bun.write(`${OUT}/15-elephant-views.png`, encodePNG(sh2.w, sh2.h, sh2.rgba))
  line(`  15-elephant-views.png (${sh2.w}x${sh2.h})`)
}

await main()
