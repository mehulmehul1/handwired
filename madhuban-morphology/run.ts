// THE MADHUBAN MORPHOLOGY LATENT — the whole run.
//
//   bun run madhuban-morphology/run.ts
//
// Reads all 17 quadruped rigs + sculpts from experiments/madhubani-animals, builds one canonical
// morphology vector per animal, learns a Handwired program over them (PCA equipped, then a ReGLU
// autoencoder trained by backprop), and renders: the real animals, their reconstructions, novel
// individuals, species blends, and ladders for size and muscle — every body drawn with the
// mass-construction SDF.

import { mkdirSync } from 'node:fs'
import { SPECIES, loadSpecies, type SpeciesId } from './species.ts'
import {
  vectorize, unvectorize, fitStandardizer, standardize, unstandardize,
  DIM, SHAPE_DIM, THICK_DIM,
} from './canonical.ts'
import { buildMasses } from './masses.ts'
import { initRaymarch, renderOne, makeCamera, sheet, encodePNG } from './raymarch.ts'
import { drawTextCentered } from './text.ts'
import * as L from './latent.ts'

await initRaymarch()
const OUT = 'madhuban-morphology/out'
mkdirSync(OUT, { recursive: true })
const W = 210, H = 158
const line = (s = '') => console.log(s)

// ── RNG ─────────────────────────────────────────────────────────────────────────────────────────
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

async function tileOfMasses(vec: Float32Array, fixedRadius?: number): Promise<Tile> {
  const u = unvectorize(vec)
  const prims = await buildMasses(u.J, u.thickness, u.size)
  return renderOne(prims, makeCamera(prims, { az: 0.14, el: 0.12, w: W, h: H, zoom: 1.06, fixedRadius }), W, H)
}
const tileOfPrims = (prims: any[], fixedRadius?: number): Tile =>
  renderOne(prims, makeCamera(prims, { az: 0.14, el: 0.12, w: W, h: H, zoom: 1.06, fixedRadius }), W, H)

const jointErrPct = (predStd: ArrayLike<number>, trueStd: ArrayLike<number>, z: { std: Float32Array }) => {
  let sum = 0, n = 0
  for (let i = 0; i < SHAPE_DIM; i += 3) {
    const dx = (predStd[i]! - trueStd[i]!) * z.std[i]!
    const dy = (predStd[i + 1]! - trueStd[i + 1]!) * z.std[i + 1]!
    const dz = (predStd[i + 2]! - trueStd[i + 2]!) * z.std[i + 2]!
    sum += Math.hypot(dx, dy, dz); n++
  }
  return (100 * sum) / n
}
const stdMSE = (pred: ArrayLike<number>, true_: ArrayLike<number>) => {
  let s = 0
  for (let i = 0; i < DIM; i++) s += (pred[i]! - true_[i]!) ** 2
  return s / DIM
}

// ── 1. Extract ──────────────────────────────────────────────────────────────────────────────────
line('THE MADHUBAN MORPHOLOGY LATENT')
line('===============================')
line()
line('1. Extraction — 17 quadruped rigs + real sculpted SDFs, from experiments/madhubani-animals')
const recs: { sp: SpeciesId; vec: Float32Array; bodyLen: number; prims: any[] }[] = []
for (const sp of SPECIES) {
  const { J, prims } = await loadSpecies(sp)
  const { vec, bodyLen } = await vectorize(J, prims)
  recs.push({ sp, vec, bodyLen, prims })
  line(`   ${sp.padEnd(8)} prims ${String(prims.length).padStart(4)}   body length ${bodyLen.toFixed(3)} m`)
}
line(`   canonical vector: ${DIM} numbers = ${SHAPE_DIM} shape + ${THICK_DIM} thickness (measured off the real SDF) + 1 size`)

const z = fitStandardizer(recs.map((r) => r.vec))
const realVec = recs.map((r) => r.vec)
const realStd = realVec.map((v) => standardize(v, z))
const bodyLenOf = new Map<SpeciesId, number>(recs.map((r) => [r.sp, r.bodyLen]))

// ── 2. Dataset (reals + jitter) ──────────────────────────────────────────────────────────────────
const rng = mulberry32(12345)
const K = 5
const allVec: Float32Array[] = [...realVec]
for (const v of realVec) {
  for (let k = 0; k < K; k++) {
    const j = Float32Array.from(v)
    for (let i = 0; i < SHAPE_DIM; i++) j[i] += gauss(rng) * 0.02
    for (let i = SHAPE_DIM; i < SHAPE_DIM + THICK_DIM; i++) j[i] = Math.max(0.005, j[i]! + gauss(rng) * 0.02)
    j[DIM - 1] += gauss(rng) * 0.07
    allVec.push(j)
  }
}
const X = allVec.map((v) => standardize(v, z))
line(`   dataset: ${realVec.length} real animals + ${allVec.length - realVec.length} jittered variants = ${X.length} samples`)

// ── 3. Experiment A: PCA, equipped as a Handwired program ────────────────────────────────────────
line()
line('2. A. Equipped — PCA loaded into a Handwired affine program (no training, exact)')
for (const Ld of [4, 8, 12, 16]) {
  const p = L.fitPCA(X, Ld)
  line(`   latent ${String(Ld).padStart(2)}  ->  variance explained ${(p.explained * 100).toFixed(1)}%`)
}
const pca = L.fitPCA(X, 8)
const eqMax = L.verifyEquipped(pca, X)
line(`   Handwired evaluator vs JS PCA: max abs diff ${eqMax.toExponential(1)}  (exact)`)
line(`   ${DIM} numbers -> 8 numbers -> ${DIM} numbers,  variance kept ${(pca.explained * 100).toFixed(1)}%`)
line(`   the manifold is nearly LINEAR: 4 numbers already keep 96.7% of the variance.`)

const pcaHat = realStd.map((x) => L.pcaDecode(L.pcaEncode(x, pca), pca))

// ── 4. Experiment B: ReGLU autoencoder trained by backprop ───────────────────────────────────────
line()
line('3. B. Unfrozen — a ReGLU autoencoder trained inside Handwired by backprop')
const HID = 40, LAT = 8
const mlp = L.buildMLP(DIM, HID, LAT, 99)
const prog = mlp.circuit.compileTensorProgram(mlp.out)
line(`   program: ${mlp.paramSize} parameters, ${prog.valueCount - prog.sourceSize} live ops, latent ${LAT}`)
const t0 = performance.now()
const losses = L.trainMLP(mlp, X, { steps: 400, lr: 0.02, seed: 7 })
const trainMs = performance.now() - t0
const w = L.readWeights(mlp)
line(`   training loss ${losses[0]!.toFixed(4)} -> ${losses[losses.length - 1]!.toFixed(4)}   (${(trainMs / 1000).toFixed(1)}s, ${X.length} samples)`)
line(`   Handwired evaluator vs JS forward: max abs diff ${L.verifyMLP(mlp, X).toExponential(1)}  (exact)`)

const aeRecon = (xStd: Float32Array): Float32Array => {
  L.mlpSetInput(mlp, xStd)
  const vals = mlp.circuit.evaluateReference(mlp.source)
  const out = new Float32Array(DIM)
  for (let k = 0; k < DIM; k++) out[k] = vals[mlp.out[k]!]!
  return out
}
const aeHat = realStd.map((x) => aeRecon(x))

// ── 5. Metrics + reconstruct sheet ───────────────────────────────────────────────────────────────
line()
line('4. Reconstruction — how well do 8 numbers rebuild each animal?')
line('   species   AE joint%   PCA joint%   AE mse   PCA mse')
const tilesReal: Tile[] = [], tilesPCA: Tile[] = [], tilesAE: Tile[] = []
let aeMeanJ = 0, pcaMeanJ = 0, aeMeanM = 0, pcaMeanM = 0
const perSpecies: any[] = []
for (let i = 0; i < recs.length; i++) {
  const sp = recs[i]!.sp
  tilesReal.push(captioned(await tileOfPrims(recs[i]!.prims), sp))
  tilesPCA.push(captioned(await tileOfMasses(unstandardize(pcaHat[i]!, z)), `${sp} PCA`))
  tilesAE.push(captioned(await tileOfMasses(unstandardize(aeHat[i]!, z)), `${sp} AE`))
  const aeJ = jointErrPct(aeHat[i]!, realStd[i]!, z)
  const pcaJ = jointErrPct(pcaHat[i]!, realStd[i]!, z)
  const aeM = stdMSE(aeHat[i]!, realStd[i]!)
  const pcaM = stdMSE(pcaHat[i]!, realStd[i]!)
  aeMeanJ += aeJ / recs.length; pcaMeanJ += pcaJ / recs.length
  aeMeanM += aeM / recs.length; pcaMeanM += pcaM / recs.length
  perSpecies.push({ sp, aeJointPct: aeJ, pcaJointPct: pcaJ, aeMse: aeM, pcaMse: pcaM })
  line(`   ${sp.padEnd(8)}  ${aeJ.toFixed(2).padStart(7)}%   ${pcaJ.toFixed(2).padStart(8)}%   ${aeM.toFixed(4)}   ${pcaM.toFixed(4)}`)
}
line(`   MEAN      ${aeMeanJ.toFixed(2).padStart(7)}%   ${pcaMeanJ.toFixed(2).padStart(8)}%   ${aeMeanM.toFixed(4)}   ${pcaMeanM.toFixed(4)}`)
line(`   (joint% = mean per-joint error as % of body length; mse = standardized MSE over all ${DIM} dims)`)

// ── 6. Generalisation: hold out five species ─────────────────────────────────────────────────────
line()
line('5. Generalisation — train on 12 species, reconstruct 5 it never saw')
const HOLDOUT: SpeciesId[] = ['horse', 'cow', 'rat', 'frog', 'sheep']
const trainIdx = recs.map((r, i) => i).filter((i) => !HOLDOUT.includes(recs[i]!.sp))
const genX = [...trainIdx.map((i) => realStd[i]!), ...X.slice(realVec.length)]
const gen = L.buildMLP(DIM, HID, LAT, 55)
const genLosses = L.trainMLP(gen, genX, { steps: 400, lr: 0.02, seed: 11 })
const genRows: string[] = []
for (const sp of HOLDOUT) {
  const i = recs.findIndex((r) => r.sp === sp)
  const zz = L.mlpEncodeJS(w, DIM, HID, LAT, realStd[i]!)
  const xHat = L.mlpDecodeJS(w, DIM, HID, LAT, zz)
  const err = jointErrPct(xHat, realStd[i]!, z)
  const mb = (err / 100) * (bodyLenOf.get(sp) ?? 1)
  genRows.push(`${sp} ${err.toFixed(1)}%/${mb.toFixed(2)}m`)
}
line(`   training loss ${genLosses[0]!.toFixed(4)} -> ${genLosses[genLosses.length - 1]!.toFixed(4)}`)
line(`   held-out:  ${genRows.join('   ')}`)

// ── 7. Grow: novel individuals ───────────────────────────────────────────────────────────────────
line()
line('6. C. Grow — novel individuals sampled from the latent')
const codes = realStd.map((x) => L.mlpEncodeJS(w, DIM, HID, LAT, x))
const codeStd = new Float32Array(LAT)
for (let k = 0; k < LAT; k++) {
  let s = 0
  for (const c of codes) s += c[k]! * c[k]! / codes.length
  codeStd[k] = Math.sqrt(s) || 1
}
const sampleRng = mulberry32(2024)
const novelTiles: Tile[] = []
const novelties: number[] = []
for (let n = 0; n < 12; n++) {
  const zs = new Float32Array(LAT)
  for (let k = 0; k < LAT; k++) zs[k] = gauss(sampleRng) * codeStd[k]!
  const xHat = L.mlpDecodeJS(w, DIM, HID, LAT, zs)
  novelTiles.push(captioned(await tileOfMasses(unstandardize(xHat, z)), `NEW ${n + 1}`))
  let best = Infinity
  for (const c of codes) { let d = 0; for (let k = 0; k < LAT; k++) d += (c[k]! - zs[k]!) ** 2; best = Math.min(best, Math.sqrt(d)) }
  novelties.push(best)
}
let meanPairwise = 0, cnt = 0
for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) {
  let d = 0; for (let k = 0; k < LAT; k++) d += (codes[i]![k]! - codes[j]![k]!) ** 2
  meanPairwise += Math.sqrt(d); cnt++
}
meanPairwise /= cnt
const meanNovel = novelties.reduce((s, v) => s + v, 0) / novelties.length
line(`   distance to nearest real animal: mean ${meanNovel.toFixed(2)}  (real animals sit ${meanPairwise.toFixed(2)} apart)`)

// ── 8. Grow: blends ──────────────────────────────────────────────────────────────────────────────
line()
line('7. C. Grow — blends between species (the road to hybrids)')
const PAIRS: [SpeciesId, SpeciesId][] = [['dog', 'cat'], ['horse', 'deer'], ['bear', 'rat'], ['wolf', 'fox'], ['cow', 'sheep']]
const blendTiles: Tile[] = []
for (const [a, b] of PAIRS) {
  const ia = recs.findIndex((r) => r.sp === a), ib = recs.findIndex((r) => r.sp === b)
  const za = codes[ia]!, zb = codes[ib]!
  for (let s = 0; s < 5; s++) {
    const t = s / 4
    const zm = new Float32Array(LAT)
    for (let k = 0; k < LAT; k++) zm[k] = za[k]! * (1 - t) + zb[k]! * t
    const xHat = L.mlpDecodeJS(w, DIM, HID, LAT, zm)
    blendTiles.push(captioned(await tileOfMasses(unstandardize(xHat, z)), `${a}-${b} ${Math.round(t * 100)}%`))
  }
}

// ── 9. Size and muscle ladders ───────────────────────────────────────────────────────────────────
const dogI = recs.findIndex((r) => r.sp === 'dog')
const FIXED_R = 0.95
const sizeTiles: Tile[] = []
const muscleTiles: Tile[] = []
for (const d of [-2, -1, 0, 1, 2]) {
  const xs = unstandardize(new Float32Array(realStd[dogI]!), z).slice()
  xs[DIM - 1] += d * z.std[DIM - 1]!
  sizeTiles.push(captioned(await tileOfMasses(xs, FIXED_R), `SIZE ${d > 0 ? '+' : ''}${d}S`))
  const xm = unstandardize(new Float32Array(realStd[dogI]!), z).slice()
  for (let i = SHAPE_DIM; i < SHAPE_DIM + THICK_DIM; i++) xm[i] = Math.max(0.005, xm[i]! + d * z.std[i]!)
  muscleTiles.push(captioned(await tileOfMasses(xm, FIXED_R), `MUSCLE ${d > 0 ? '+' : ''}${d}S`))
}

// ── 10. Write sheets + report ────────────────────────────────────────────────────────────────────
line()
line('8. Sheets')
const sheets = [
  await save('01-real.png', sheet(tilesReal, 6)),
  await save('02-reconstruct.png', sheet([...tilesReal, ...tilesPCA, ...tilesAE], 3)),
  await save('03-novel.png', sheet(novelTiles, 4)),
  await save('04-blends.png', sheet(blendTiles, 5)),
  await save('05-size.png', sheet(sizeTiles, 5)),
  await save('06-muscle.png', sheet(muscleTiles, 5)),
]
for (const s of sheets) line(`   ${s}`)

await Bun.write(`${OUT}/report.json`, JSON.stringify({
  generated: new Date().toISOString(),
  species: recs.map((r) => ({ sp: r.sp, prims: r.prims.length, bodyLen: r.bodyLen })),
  vector: { dim: DIM, shape: SHAPE_DIM, thickness: THICK_DIM, size: 1 },
  dataset: { real: realVec.length, jitter: allVec.length - realVec.length },
  pca: { latent: 8, explained: pca.explained, handwiredMaxDiff: eqMax, meanJointPct: pcaMeanJ, meanMse: pcaMeanM },
  mlp: { hidden: HID, latent: LAT, params: mlp.paramSize, liveOps: prog.valueCount - prog.sourceSize, lossStart: losses[0], lossEnd: losses[losses.length - 1], trainMs, meanJointPct: aeMeanJ, meanMse: aeMeanM, verifyDiff: L.verifyMLP(mlp, X) },
  perSpecies,
  generalisation: { holdout: HOLDOUT, rows: genRows },
  novelty: { meanNearest: meanNovel, meanPairwise },
}, null, 2))
line()
line(`report.json written.  ${DIM} numbers -> ${LAT} latent -> whole bodies.`)
