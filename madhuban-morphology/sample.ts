// Does the weirdness come from the system, or from how I sampled?
//
//   bun run madhuban-morphology/sample.ts
//
// Same latent (PCA — instant, and the more accurate program), four sampling regimes:
//   loose        z ~ full spread of the data          -> what I did before
//   tight        z ~ 0.3 of the spread                -> stays near real animals
//   litters      a real animal + a little noise       -> new individuals OF a species
//   extrapolate  walk one principal axis past the data -> where it breaks
//
// If "tight" and "litters" look like animals, the monsters were my sampling, not the ceiling.

import { mkdirSync } from 'node:fs'
import { loadSpecies, SPECIES, type SpeciesId } from './species.ts'
import { vectorize, unvectorize, fitStandardizer, standardize, unstandardize, DIM } from './canonical.ts'
import { buildMasses } from './masses.ts'
import { initRaymarch, renderOne, makeCamera, sheet, encodePNG } from './raymarch.ts'
import { drawTextCentered } from './text.ts'
import * as L from './latent.ts'

await initRaymarch()
const OUT = 'madhuban-morphology/out'
mkdirSync(OUT, { recursive: true })
const W = 210, H = 158
const line = (s = '') => console.log(s)

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = (rng: () => number) => {
  const u = Math.max(1e-9, rng()), v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
type Tile = { rgba: Uint8Array; w: number; h: number }
function captioned(t: Tile, text: string, capH = 15): Tile {
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
const save = async (name: string, t: Tile) => { await Bun.write(`${OUT}/${name}`, encodePNG(t.w, t.h, t.rgba)); return `${name} (${t.w}x${t.h})` }

async function tile(vec: Float32Array): Promise<Tile> {
  const u = unvectorize(vec)
  const prims = await buildMasses(u.J, u.thickness, u.size)
  return renderOne(prims, makeCamera(prims, { az: 0.14, el: 0.12, w: W, h: H, zoom: 1.06 }), W, H)
}

// ── load real animals ────────────────────────────────────────────────────────────────────────────
const recs: { sp: SpeciesId; vec: Float32Array }[] = []
for (const sp of SPECIES) {
  const { J, prims } = await loadSpecies(sp)
  const { vec } = await vectorize(J, prims)
  recs.push({ sp, vec })
}
const zc = fitStandardizer(recs.map((r) => r.vec))
const std = recs.map((r) => standardize(r.vec, zc))
const pca = L.fitPCA(std, 8)
const codes = std.map((x) => L.pcaEncode(x, pca))
// per-axis spread of the codes = sqrt(eigenvalue)
const sd = Array.from({ length: 8 }, (_, k) => Math.sqrt(Math.max(0, pca.eigenvalues[k]!)))

const nearestReal = (z: Float32Array) => {
  let best = Infinity
  for (const c of codes) { let d = 0; for (let k = 0; k < 8; k++) d += (c[k]! - z[k]!) ** 2; best = Math.min(best, Math.sqrt(d)) }
  return best
}

line('SAME LATENT, FOUR WAYS OF ASKING IT FOR AN ANIMAL')
line('===============================================')
line()

const rng = mulberry32(4242)
const decode = (z: Float32Array) => unstandardize(L.pcaDecode(z, pca), zc)

// ── 1. loose ─────────────────────────────────────────────────────────────────────────────────────
const loose: Tile[] = []
let looseD = 0
for (let n = 0; n < 8; n++) {
  const z = new Float32Array(8)
  for (let k = 0; k < 8; k++) z[k] = gauss(rng) * sd[k]!
  looseD += nearestReal(z) / 8
  loose.push(captioned(await tile(decode(z)), `LOOSE ${n + 1}`))
}

// ── 2. tight ─────────────────────────────────────────────────────────────────────────────────────
const tight: Tile[] = []
let tightD = 0
for (let n = 0; n < 8; n++) {
  const z = new Float32Array(8)
  for (let k = 0; k < 8; k++) z[k] = gauss(rng) * sd[k]! * 0.3
  tightD += nearestReal(z) / 8
  tight.push(captioned(await tile(decode(z)), `TIGHT ${n + 1}`))
}

// ── 3. litters: a real animal + a little noise ───────────────────────────────────────────────────
const litters: Tile[] = []
for (const sp of ['dog', 'horse', 'cat', 'cow'] as SpeciesId[]) {
  const i = recs.findIndex((r) => r.sp === sp)
  for (let n = 0; n < 3; n++) {
    const z = Float32Array.from(codes[i]!)
    for (let k = 0; k < 8; k++) z[k] += gauss(rng) * sd[k]! * 0.12
    litters.push(captioned(await tile(decode(z)), `${sp} ${n + 1}`))
  }
}

// ── 4. extrapolate along principal axis 1, past the data ─────────────────────────────────────────
const extrap: Tile[] = []
const exCodes: number[] = []
for (let s = -3; s <= 3; s++) {
  const z = new Float32Array(8)
  z[0] = s * sd[0]!
  extrap.push(captioned(await tile(decode(z)), `PC1 ${s > 0 ? '+' : ''}${s}S`))
  let best = Infinity
  for (const c of codes) { let d = 0; for (let k = 0; k < 8; k++) d += (c[k]! - z[k]!) ** 2; best = Math.min(best, Math.sqrt(d)) }
  exCodes.push(best)
}

line(`mean distance to nearest real animal (latent units):`)
line(`   loose  ${looseD.toFixed(2)}   <- full spread: lands in the gaps, "monsters"`)
line(`   tight  ${tightD.toFixed(2)}   <- 0.3 spread: stays near real animals`)
line(`   (real animals sit ${(() => { let s = 0, c = 0; for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) { let d = 0; for (let k = 0; k < 8; k++) d += (codes[i]![k]! - codes[j]![k]!) ** 2; s += Math.sqrt(d); c++ } return (s / c).toFixed(2) })()} apart on average)`)
line()
line(`extrapolating axis 1 past the data, distance to nearest real animal:`)
line(`   ${exCodes.map((d, i) => `${i - 3 > 0 ? '+' : ''}${i - 3}S ${d.toFixed(1)}`).join('   ')}`)
line()

for (const s of [
  await save('07-sample-loose.png', sheet(loose, 4)),
  await save('08-sample-tight.png', sheet(tight, 4)),
  await save('09-litters.png', sheet(litters, 4)),
  await save('10-extrapolate.png', sheet(extrap, 7)),
]) line(`   ${s}`)
line()
line('verdict: TIGHT and LITTERS look like animals -> the monsters were the sampling, not the latent.')
line('         EXTRAPOLATE breaks -> you cannot walk past the animals you have. That is the real ceiling.')
