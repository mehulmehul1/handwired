// Madhubani × Handwired probe — see ./README.md
//
// The Madhubani coat picks a motif (0..11) for each of 8 anatomy zones from a hand-authored table
// and a nested select() cascade in a TSL shader. This probe asks the Handwired question: what if
// that decision were a numeric program of affine / ReGLU / one-hot-argmax instead?
//
// Two checks, both on the real table from the artwork repo:
//   A. Equipped  — hand-set coefficients reproduce STYLE_ZONES.scallop exactly, no training.
//   B. Unfrozen  — random coefficients, trained by backprop toward a target table.
//
// Run from the handwired repo root:  bun run madhubani-probe/probe.ts

import {
  Circuit,
  type Wire,
  emitArgmax,
  emitMultiply,
  validateCircuit,
} from '../src/runtime/numeric-ui-core.ts'

// ── Real data, copied verbatim from
//    experiments/madhubani-animals/src/core/render/madhubani/zones.js ──────────────────────────────
const ZONE_NAMES = ['trunk', 'neck', 'head', 'legs', 'paws', 'tail', 'wing', 'fin'] as const
const STYLE_ZONES = {
  scallop: { tiles: [0, 7, 1, 3, 5, 11, 4, 2] as const, slots: [0, 1, 2, 3, 0, 1, 2, 3] as const },
  kohbar: { tiles: [0, 1, 3, 2, 6, 10, 4, 9] as const, slots: [0, 2, 1, 3, 0, 2, 1, 3] as const },
}

const ZONE_COUNT = ZONE_NAMES.length // 8
const MOTIF_COUNT = 12

type Placement = {
  circuit: Circuit
  source: Float32Array
  logits: Wire[]
  scores: Wire[]
  motifs: Wire[]
  paramIndices: number[]
  inputOffset: number
  hidden: number
  offsets: { hlw: number; hlb: number; hgw: number; hgb: number; ow: number; ob: number }
}

// Build the placement program:
//   zones (one-hot over 8) -> ReGLU hidden layer (hidden units) -> 12 motif logits
//   -> clamp01 scores -> one-hot motif selection by argmax.
function buildPlacement(hidden: number): Placement {
  const paramSize =
    hidden * ZONE_COUNT + hidden + // hidden left (weights, biases)
    hidden * ZONE_COUNT + hidden + // hidden gate (weights, biases)
    MOTIF_COUNT * hidden + MOTIF_COUNT // output (weights, biases)
  const inputOffset = paramSize
  const sourceSize = paramSize + ZONE_COUNT
  const circuit = new Circuit(sourceSize)

  const hlw = 0
  const hlb = hlw + hidden * ZONE_COUNT
  const hgw = hlb + hidden
  const hgb = hgw + hidden * ZONE_COUNT
  const ow = hgb + hidden
  const ob = ow + MOTIF_COUNT * hidden

  const paramIndices = Array.from({ length: paramSize }, (_, i) => i)
  const zones = Array.from({ length: ZONE_COUNT }, (_, i) => circuit.source(inputOffset + i))

  const relu = (x: Wire): Wire => circuit.reglu([], 1, [[x, 1]], 0)
  // sum of weight*input over pairs, plus a bias wire. Weights are source cells, so they train;
  // inputs are source cells too, so one program serves every zone.
  const weightedSum = (bias: Wire, pairs: Array<[Wire, Wire]>): Wire => {
    let acc = bias
    for (const [weight, input] of pairs)
      acc = circuit.affine([[emitMultiply(circuit, weight, input), 1], [acc, 1]], 0)
    return acc
  }

  const hiddenValues: Wire[] = []
  for (let j = 0; j < hidden; j++) {
    const leftPairs: Array<[Wire, Wire]> = []
    const gatePairs: Array<[Wire, Wire]> = []
    for (let i = 0; i < ZONE_COUNT; i++) {
      leftPairs.push([circuit.source(hlw + j * ZONE_COUNT + i), zones[i]])
      gatePairs.push([circuit.source(hgw + j * ZONE_COUNT + i), zones[i]])
    }
    const left = weightedSum(circuit.source(hlb + j), leftPairs)
    const gate = weightedSum(circuit.source(hgb + j), gatePairs)
    hiddenValues.push(emitMultiply(circuit, left, relu(gate)))
  }

  const logits: Wire[] = []
  const scores: Wire[] = []
  for (let k = 0; k < MOTIF_COUNT; k++) {
    const pairs: Array<[Wire, Wire]> = []
    for (let j = 0; j < hidden; j++)
      pairs.push([circuit.source(ow + k * hidden + j), hiddenValues[j]])
    const logit = weightedSum(circuit.source(ob + k), pairs)
    logits.push(logit)
    // clamp01(v) = relu(v) - relu(v - 1): exact 0..1, differentiable inside (0,1).
    const score = circuit.affine(
      [[relu(logit), 1], [relu(circuit.affine([[logit, 1]], -1)), -1]],
      0,
    )
    circuit.assumeRange(score, 0, 1)
    scores.push(score)
  }

  const unit = circuit.constant(1)
  const { selected } = emitArgmax(circuit, scores, unit)

  return {
    circuit,
    source: new Float32Array(sourceSize),
    logits,
    scores,
    motifs: selected,
    paramIndices,
    inputOffset,
    hidden,
    offsets: { hlw, hlb, hgw, hgb, ow, ob },
  }
}

function writeEquipped(p: Placement, table: readonly number[]) {
  const { hidden, source, offsets } = p
  source.fill(0)
  for (let j = 0; j < hidden; j++) {
    source[offsets.hlb + j] = 0
    source[offsets.hgb + j] = j < ZONE_COUNT ? 1 : -1 // gate open on the first 8 units
    if (j < ZONE_COUNT) source[offsets.hlw + j * ZONE_COUNT + j] = 1 // one unit per zone, pass-through
  }
  for (let k = 0; k < MOTIF_COUNT; k++) {
    source[offsets.ob + k] = 0
    for (let j = 0; j < ZONE_COUNT; j++)
      source[offsets.ow + k * hidden + j] = table[j] === k ? 0.9 : 0.1
  }
}

function setZone(p: Placement, zone: number) {
  for (let i = 0; i < ZONE_COUNT; i++)
    p.source[p.inputOffset + i] = i === zone ? 1 : 0
}

function forward(p: Placement) {
  const values = p.circuit.evaluateReference(p.source)
  return {
    values,
    logits: p.logits.map((w) => values[w]!),
    scores: p.scores.map((w) => values[w]!),
    motifs: p.motifs.map((w) => values[w]!),
  }
}

// A plain-JS mirror of the built program, for cross-checking the Handwired evaluator.
function referenceJS(p: Placement, table: readonly number[]) {
  const { hidden, source, offsets } = p
  const zone = source.slice(p.inputOffset, p.inputOffset + ZONE_COUNT)
  const relu = (x: number) => Math.max(0, x)
  const h: number[] = []
  for (let j = 0; j < hidden; j++) {
    let left = source[offsets.hlb + j]!
    let gate = source[offsets.hgb + j]!
    for (let i = 0; i < ZONE_COUNT; i++) {
      left += source[offsets.hlw + j * ZONE_COUNT + i]! * zone[i]!
      gate += source[offsets.hgw + j * ZONE_COUNT + i]! * zone[i]!
    }
    h.push(left * relu(gate))
  }
  const logits: number[] = []
  for (let k = 0; k < MOTIF_COUNT; k++) {
    let acc = source[offsets.ob + k]!
    for (let j = 0; j < hidden; j++) acc += source[offsets.ow + k * hidden + j]! * h[j]!
    logits.push(acc)
  }
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
  const scores = logits.map(clamp01)
  const picked = scores.indexOf(Math.max(...scores))
  return { logits, scores, picked }
}

type Check = { zone: string; want: number; got: number; ok: boolean }

function experimentEquipped(): { checks: Check[]; placement: Placement } {
  const placement = buildPlacement(16)
  writeEquipped(placement, STYLE_ZONES.scallop.tiles)
  const checks: Check[] = []
  for (let z = 0; z < ZONE_COUNT; z++) {
    setZone(placement, z)
    const { motifs, logits, scores } = forward(placement)
    const got = motifs.indexOf(1)
    const ref = referenceJS(placement, STYLE_ZONES.scallop.tiles)
    // Cross-check the Handwired evaluator against plain JS on this zone.
    const logitDelta = Math.max(...logits.map((v, k) => Math.abs(v - ref.logits[k]!)))
    if (logitDelta > 1e-6)
      throw new Error(`Handwired vs JS logit mismatch on ${ZONE_NAMES[z]}: ${logitDelta}`)
    if (ref.picked !== got)
      throw new Error(`Handwired vs JS argmax mismatch on ${ZONE_NAMES[z]}`)
    void scores
    checks.push({ zone: ZONE_NAMES[z], want: STYLE_ZONES.scallop.tiles[z]!, got, ok: got === STYLE_ZONES.scallop.tiles[z]! })
  }
  return { checks, placement }
}

function experimentTrained(
  targetTable: readonly number[],
  steps: number,
  lr: number,
): { checks: Check[]; losses: number[]; placement: Placement } {
  const placement = buildPlacement(16)
  const { source, circuit, logits, paramIndices } = placement
  for (const i of paramIndices) source[i] = (Math.random() * 2 - 1) * 0.3

  const m = new Float32Array(paramIndices.length)
  const v = new Float32Array(paramIndices.length)
  const b1 = 0.9
  const b2 = 0.999
  const eps = 1e-8
  const losses: number[] = []

  for (let step = 1; step <= steps; step++) {
    const grads = new Float32Array(paramIndices.length)
    let loss = 0
    for (let z = 0; z < ZONE_COUNT; z++) {
      setZone(placement, z)
      const values = circuit.evaluateReference(source)
      const outGrad = new Float32Array(values.length)
      for (let k = 0; k < MOTIF_COUNT; k++) {
        const target = targetTable[z] === k ? 1 : -1
        const diff = values[logits[k]!]! - target
        loss += diff * diff
        outGrad[logits[k]!] += (2 * diff) / (ZONE_COUNT * MOTIF_COUNT)
      }
      // No gradient is placed on the clamp/argmax path, so its boolean atoms are skipped.
      const g = circuit.backpropagateReference(values, outGrad)
      for (let p = 0; p < paramIndices.length; p++) grads[p] += g[paramIndices[p]!]!
    }
    loss /= ZONE_COUNT * MOTIF_COUNT
    const bc1 = 1 - Math.pow(b1, step)
    const bc2 = 1 - Math.pow(b2, step)
    for (let p = 0; p < paramIndices.length; p++) {
      const grad = grads[p]!
      m[p] = b1 * m[p]! + (1 - b1) * grad
      v[p] = b2 * v[p]! + (1 - b2) * grad * grad
      source[paramIndices[p]!]! -= (lr * (m[p]! / bc1)) / (Math.sqrt(v[p]! / bc2) + eps)
    }
    losses.push(loss)
  }

  const checks: Check[] = []
  for (let z = 0; z < ZONE_COUNT; z++) {
    setZone(placement, z)
    const { motifs } = forward(placement)
    const got = motifs.indexOf(1)
    checks.push({ zone: ZONE_NAMES[z], want: targetTable[z]!, got, ok: got === targetTable[z]! })
  }
  return { checks, losses, placement }
}

function countOps(p: Placement) {
  const program = p.circuit.compileTensorProgram(p.scores)
  return { live: program.valueCount - program.sourceSize, layers: program.layers.length, source: p.circuit.sourceSize }
}

// C. Continuous placement field: spineT (the 0..1 arc-length parameter along the body, already
// baked per vertex as aMad1.w) -> (4 motif bands, one scale). This is a FUNCTION of a continuous
// body coordinate, which neither the STYLE_ZONES table nor the select() cascade can express.
// Hand-wired ReLU basis over spineT (frozen) plus a trained readout. Trained on a coarse grid,
// queried on held-out spineT between the training points.
function experimentContinuous() {
  const centers = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]
  const basis = centers.length
  const bands = 4
  const paramSize = bands * basis + bands + basis + 1
  const inputOffset = paramSize
  const circuit = new Circuit(paramSize + 1)

  const bw = 0
  const bb = bw + bands * basis
  const sw = bb + bands
  const sb = sw + basis

  const spineT = circuit.source(inputOffset)
  const relu = (x: Wire): Wire => circuit.reglu([], 1, [[x, 1]], 0)
  const basisValues = centers.map((c) => circuit.reglu([], 1, [[spineT, 1]], -c))
  const sum = (bias: Wire, pairs: Array<[Wire, Wire]>): Wire => {
    let acc = bias
    for (const [w, x] of pairs) acc = circuit.affine([[emitMultiply(circuit, w, x), 1], [acc, 1]], 0)
    return acc
  }

  const logits: Wire[] = []
  const scores: Wire[] = []
  for (let b = 0; b < bands; b++) {
    const pairs = basisValues.map((h, t): [Wire, Wire] => [circuit.source(bw + b * basis + t), h])
    const logit = sum(circuit.source(bb + b), pairs)
    logits.push(logit)
    const score = circuit.affine([[relu(logit), 1], [relu(circuit.affine([[logit, 1]], -1)), -1]], 0)
    circuit.assumeRange(score, 0, 1)
    scores.push(score)
  }
  const scalePairs = basisValues.map((h, t): [Wire, Wire] => [circuit.source(sw + t), h])
  const scale = sum(circuit.source(sb), scalePairs)
  const { selected } = emitArgmax(circuit, scores, circuit.constant(1))

  const source = new Float32Array(paramSize + 1)
  const paramIndices = Array.from({ length: paramSize }, (_, i) => i)

  const bandTarget = (t: number) => Math.min(bands - 1, Math.floor(t * bands))
  const scaleTarget = (t: number) => 0.5 + t

  const setT = (t: number) => { source[inputOffset] = t }

  const trainPoints = Array.from({ length: 11 }, (_, i) => i / 10)
  const queryPoints = Array.from({ length: 10 }, (_, i) => i / 10 + 0.05)

  // init
  for (const i of paramIndices) source[i] = (Math.random() * 2 - 1) * 0.1

  const m = new Float32Array(paramSize)
  const v = new Float32Array(paramSize)
  const b1 = 0.9
  const b2 = 0.999
  const eps = 1e-8
  const steps = 400
  const lr = 0.05
  const N = trainPoints.length * (bands + 1)

  for (let step = 1; step <= steps; step++) {
    const grads = new Float32Array(paramSize)
    for (const t of trainPoints) {
      setT(t)
      const values = circuit.evaluateReference(source)
      const outGrad = new Float32Array(values.length)
      for (let b = 0; b < bands; b++) {
        const target = bandTarget(t) === b ? 1 : -1
        outGrad[logits[b]!] += (2 * (values[logits[b]!]! - target)) / N
      }
      outGrad[scale] += (2 * (values[scale]! - scaleTarget(t))) / N
      const g = circuit.backpropagateReference(values, outGrad)
      for (let p = 0; p < paramSize; p++) grads[p] += g[paramIndices[p]!]!
    }
    const bc1 = 1 - Math.pow(b1, step)
    const bc2 = 1 - Math.pow(b2, step)
    for (let p = 0; p < paramSize; p++) {
      const grad = grads[p]!
      m[p] = b1 * m[p]! + (1 - b1) * grad
      v[p] = b2 * v[p]! + (1 - b2) * grad * grad
      source[paramIndices[p]!]! -= (lr * (m[p]! / bc1)) / (Math.sqrt(v[p]! / bc2) + eps)
    }
  }

  const rows: Array<{ t: number; band: number; wantBand: number; scale: number; wantScale: number; bandErr: number; scaleErr: number }> = []
  for (const t of queryPoints) {
    setT(t)
    const values = circuit.evaluateReference(source)
    const picked = selected.findIndex((w) => values[w]! > 0.5)
    rows.push({
      t,
      band: picked,
      wantBand: bandTarget(t),
      scale: values[scale]!,
      wantScale: scaleTarget(t),
      bandErr: Math.abs(picked - bandTarget(t)),
      scaleErr: Math.abs(values[scale]! - scaleTarget(t)),
    })
  }
  return { rows, paramSize, live: (() => { const p = circuit.compileTensorProgram(scores); return p.valueCount - p.sourceSize })() }
}

// ── Run ───────────────────────────────────────────────────────────────────────────────────────────
const line = (s = '') => console.log(s)

line('Madhubani coat placement as a Handwired program')
line('===============================================')
line(`zones: ${ZONE_NAMES.join(' ')}`)
line(`source cells: ${buildPlacement(16).circuit.sourceSize} (parameters + 8 zone inputs)`)
line(`ops (scores program): ${JSON.stringify(countOps(buildPlacement(16)))}`)
line()

line('A. Equipped — hand-set coefficients, no training, target = STYLE_ZONES.scallop.tiles')
const equipped = experimentEquipped()
for (const c of equipped.checks) line(`   ${c.zone.padEnd(6)} want ${String(c.want).padStart(2)}  got ${String(c.got).padStart(2)}  ${c.ok ? 'ok' : 'MISS'}`)
line(`   match ${equipped.checks.filter((c) => c.ok).length}/${ZONE_COUNT}  (Handwired evaluator == plain JS on every logit)`)
line()

line('B. Unfrozen — random init, trained by backprop, target = STYLE_ZONES.kohbar.tiles')
const trained = experimentTrained(STYLE_ZONES.kohbar.tiles, 600, 0.05)
const first = trained.losses[0]!
const at = (i: number) => trained.losses[Math.min(i, trained.losses.length - 1)]!.toFixed(4)
line(`   loss  step0 ${first.toFixed(4)}  step10 ${at(10)}  step50 ${at(50)}  step100 ${at(100)}  step600 ${at(600)}`)
for (const c of trained.checks) line(`   ${c.zone.padEnd(6)} want ${String(c.want).padStart(2)}  got ${String(c.got).padStart(2)}  ${c.ok ? 'ok' : 'MISS'}`)
line(`   match ${trained.checks.filter((c) => c.ok).length}/${ZONE_COUNT}`)
line()

line('C. Continuous field — spineT -> (4 motif bands, one scale). A function of a body coordinate,')
line('   not a lookup. Trained on spineT = 0.0 .. 1.0 step 0.1, queried BETWEEN training points.')
const cont = experimentContinuous()
const bandHits = cont.rows.filter((r) => r.bandErr === 0).length
const meanScaleErr = cont.rows.reduce((s, r) => s + r.scaleErr, 0) / cont.rows.length
line(`   program: ${cont.paramSize} params, ${cont.live} live ops`)
line('   spineT   band/want   scale/want     scaleErr')
for (const r of cont.rows)
  line(`   ${r.t.toFixed(2)}     ${r.band}/${r.wantBand}         ${r.scale.toFixed(3)}/${r.wantScale.toFixed(3)}     ${r.scaleErr.toFixed(4)}`)
line(`   off-grid band match ${bandHits}/${cont.rows.length}   mean scale error ${meanScaleErr.toFixed(4)}`)
line()

const v = validateCircuit(equipped.placement.circuit)
line(`circuit validated (${v} wires checked)`)
