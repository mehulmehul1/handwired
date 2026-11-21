// The learned part. Two Handwired programs over the canonical morphology vectors:
//
//   A. Equipped — PCA (classical linear algebra) loaded into a Handwired affine program. Zero training;
//      the Handwired evaluator must reproduce the JS PCA reconstruction exactly.
//   B. Unfrozen — a ReGLU autoencoder trained by backprop inside Handwired. It has to beat (or match)
//      the linear baseline using a *nonlinear* manifold.
//
// Both expose encode(x) -> z (the latent) and decode(z) -> x̂. Sampling and interpolation happen in
// JS with the trained weights, then get cross-checked against the Handwired evaluator.

import { Circuit, type Wire, emitMultiply, validateCircuit } from '../src/runtime/numeric-ui-core.ts'

export type Mat = Float64Array // row-major

// ── PCA ─────────────────────────────────────────────────────────────────────────────────────────
function jacobiEigen(A0: Float64Array, n: number, sweeps = 60): { values: Float64Array; vectors: Float64Array } {
  const A = A0.slice()
  const V = new Float64Array(n * n)
  for (let i = 0; i < n; i++) V[i * n + i] = 1
  for (let s = 0; s < sweeps; s++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q]! * A[p * n + q]!
    if (off < 1e-20) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q]!
        if (Math.abs(apq) < 1e-18) continue
        const app = A[p * n + p]!
        const aqq = A[q * n + q]!
        const theta = (aqq - app) / (2 * apq)
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const sn = t * c
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p]!
          const akq = A[k * n + q]!
          A[k * n + p] = c * akp - sn * akq
          A[k * n + q] = sn * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k]!
          const aqk = A[q * n + k]!
          A[p * n + k] = c * apk - sn * aqk
          A[q * n + k] = sn * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p]!
          const vkq = V[k * n + q]!
          V[k * n + p] = c * vkp - sn * vkq
          V[k * n + q] = sn * vkp + c * vkq
        }
      }
    }
  }
  const values = new Float64Array(n)
  for (let i = 0; i < n; i++) values[i] = A[i * n + i]!
  return { values, vectors: V }
}

export type PCA = { mean: Float64Array; W: Mat; L: number; D: number; explained: number; eigenvalues: Float64Array }

export function fitPCA(X: Float32Array[], L: number): PCA {
  const N = X.length
  const D = X[0]!.length
  const mean = new Float64Array(D)
  for (const x of X) for (let i = 0; i < D; i++) mean[i] += x[i]! / N
  const C = new Float64Array(D * D)
  for (const x of X) {
    for (let i = 0; i < D; i++) {
      const xi = x[i]! - mean[i]!
      for (let j = i; j < D; j++) C[i * D + j] += (xi * (x[j]! - mean[j]!)) / N
    }
  }
  for (let i = 0; i < D; i++) for (let j = 0; j < i; j++) C[i * D + j] = C[j * D + i]!
  const { values, vectors } = jacobiEigen(C, D)
  const order = Array.from({ length: D }, (_, i) => i).sort((a, b) => values[b]! - values[a]!)
  const total = values.reduce((s, v) => s + Math.max(0, v), 0) || 1
  const W = new Float64Array(L * D)
  for (let k = 0; k < L; k++) for (let i = 0; i < D; i++) W[k * D + i] = vectors[i * D + order[k]!]!
  const eigenvalues = new Float64Array(L)
  for (let k = 0; k < L; k++) eigenvalues[k] = Math.max(0, values[order[k]!]!)
  const explained = (Array.from({ length: L }, (_, k) => eigenvalues[k]!).reduce((s, v) => s + v, 0) || 0) / total
  return { mean, W, L, D, explained, eigenvalues }
}

export function pcaEncode(x: ArrayLike<number>, p: PCA): Float32Array {
  const z = new Float32Array(p.L)
  for (let k = 0; k < p.L; k++) {
    let s = 0
    for (let i = 0; i < p.D; i++) s += p.W[k * p.D + i]! * (x[i]! - p.mean[i]!)
    z[k] = s
  }
  return z
}
export function pcaDecode(z: ArrayLike<number>, p: PCA): Float32Array {
  const x = new Float32Array(p.D)
  for (let i = 0; i < p.D; i++) {
    let s = p.mean[i]!
    for (let k = 0; k < p.L; k++) s += p.W[k * p.D + i]! * z[k]!
    x[i] = s
  }
  return x
}

// PCA as a Handwired program: z = W (x - mean), x̂ = Wᵀ z + mean. All coefficients are constants.
export function buildEquippedLinear(p: PCA): { circuit: Circuit; inputOffset: number; out: Wire[]; zWire: Wire[] } {
  const { D, L } = p
  const inputOffset = 0
  const circuit = new Circuit(D)
  const xs = Array.from({ length: D }, (_, i) => circuit.source(inputOffset + i))
  const zWire: Wire[] = []
  for (let k = 0; k < L; k++) {
    const terms: [Wire, number][] = []
    let bias = 0
    for (let i = 0; i < D; i++) {
      const w = p.W[k * D + i]!
      terms.push([xs[i]!, w])
      bias -= w * p.mean[i]!
    }
    zWire.push(circuit.affine(terms, bias))
  }
  const out: Wire[] = []
  for (let i = 0; i < D; i++) {
    const terms: [Wire, number][] = []
    for (let k = 0; k < L; k++) terms.push([zWire[k]!, p.W[k * D + i]!])
    out.push(circuit.affine(terms, p.mean[i]!))
  }
  return { circuit, inputOffset, out, zWire }
}

// ── MLP autoencoder (trained) ────────────────────────────────────────────────────────────────────
export type MLP = {
  circuit: Circuit
  source: Float32Array
  inputOffset: number
  out: Wire[]
  z: Wire[]
  paramIndices: number[]
  paramSize: number
  D: number
  H: number
  L: number
  offsets: { W1: number; b1: number; W2: number; b2: number; W3: number; b3: number; W4: number; b4: number }
}

export function buildMLP(D: number, H: number, L: number, seed = 1): MLP {
  const W1 = 0
  const b1 = W1 + H * D
  const W2 = b1 + H
  const b2 = W2 + L * H
  const W3 = b2 + L
  const b3 = W3 + H * L
  const W4 = b3 + H
  const b4 = W4 + D * H
  const paramSize = b4 + D
  const inputOffset = paramSize
  const circuit = new Circuit(paramSize + D)

  const relu = (x: Wire): Wire => circuit.reglu([], 1, [[x, 1]], 0)
  const sum = (bias: Wire, pairs: Array<[Wire, Wire]>): Wire => {
    let acc = bias
    for (const [w, x] of pairs) acc = circuit.affine([[emitMultiply(circuit, w, x), 1], [acc, 1]], 0)
    return acc
  }

  const xs = Array.from({ length: D }, (_, i) => circuit.source(inputOffset + i))
  const h: Wire[] = []
  for (let j = 0; j < H; j++) {
    const pairs = xs.map((x, i) => [circuit.source(W1 + j * D + i), x] as [Wire, Wire])
    h.push(relu(sum(circuit.source(b1 + j), pairs)))
  }
  const z: Wire[] = []
  for (let k = 0; k < L; k++) {
    const pairs = h.map((hv, j) => [circuit.source(W2 + k * H + j), hv] as [Wire, Wire])
    z.push(sum(circuit.source(b2 + k), pairs))
  }
  const g: Wire[] = []
  for (let j = 0; j < H; j++) {
    const pairs = z.map((zv, k) => [circuit.source(W3 + j * L + k), zv] as [Wire, Wire])
    g.push(relu(sum(circuit.source(b3 + j), pairs)))
  }
  const out: Wire[] = []
  for (let k = 0; k < D; k++) {
    const pairs = g.map((gv, j) => [circuit.source(W4 + k * H + j), gv] as [Wire, Wire])
    out.push(sum(circuit.source(b4 + k), pairs))
  }

  const source = new Float32Array(paramSize + D)
  // seedable init
  let s = seed >>> 0
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
  const fill = (off: number, count: number, scale: number) => { for (let i = 0; i < count; i++) source[off + i]! = 0; for (let i = 0; i < count; i++) source[off + i] = rnd() * scale }
  fill(W1, H * D, Math.sqrt(2 / D))
  fill(W2, L * H, Math.sqrt(2 / H))
  fill(W3, H * L, Math.sqrt(2 / L))
  fill(W4, D * H, Math.sqrt(2 / H))
  fill(b1, H, 0.02)
  fill(b2, L, 0.02)
  fill(b3, H, 0.02)
  fill(b4, D, 0.02)

  return { circuit, source, inputOffset, out, z, paramIndices: Array.from({ length: paramSize }, (_, i) => i), paramSize, D, H, L, offsets: { W1, b1, W2, b2, W3, b3, W4, b4 } }
}

export function mlpSetInput(m: MLP, x: ArrayLike<number>) {
  for (let i = 0; i < m.D; i++) m.source[m.inputOffset + i] = x[i]!
}

// Plain-JS forward of the same MLP, from the trained weights. Used for encode/decode and to
// cross-check the Handwired evaluator.
export type Weights = { W1: Float32Array; b1: Float32Array; W2: Float32Array; b2: Float32Array; W3: Float32Array; b3: Float32Array; W4: Float32Array; b4: Float32Array }
export function readWeights(m: MLP): Weights {
  const { W1, b1, W2, b2, W3, b3, W4, b4 } = m.offsets
  return {
    W1: m.source.slice(W1, W1 + m.H * m.D),
    b1: m.source.slice(b1, b1 + m.H),
    W2: m.source.slice(W2, W2 + m.L * m.H),
    b2: m.source.slice(b2, b2 + m.L),
    W3: m.source.slice(W3, W3 + m.H * m.L),
    b3: m.source.slice(b3, b3 + m.H),
    W4: m.source.slice(W4, W4 + m.D * m.H),
    b4: m.source.slice(b4, b4 + m.D),
  }
}
export function mlpEncodeJS(w: Weights, D: number, H: number, L: number, x: ArrayLike<number>): Float32Array {
  const h = new Float32Array(H)
  for (let j = 0; j < H; j++) {
    let a = w.b1[j]!
    for (let i = 0; i < D; i++) a += w.W1[j * D + i]! * x[i]!
    h[j] = a > 0 ? a : 0
  }
  const z = new Float32Array(L)
  for (let k = 0; k < L; k++) {
    let a = w.b2[k]!
    for (let j = 0; j < H; j++) a += w.W2[k * H + j]! * h[j]!
    z[k] = a
  }
  return z
}
export function mlpDecodeJS(w: Weights, D: number, H: number, L: number, z: ArrayLike<number>): Float32Array {
  const g = new Float32Array(H)
  for (let j = 0; j < H; j++) {
    let a = w.b3[j]!
    for (let k = 0; k < L; k++) a += w.W3[j * L + k]! * z[k]!
    g[j] = a > 0 ? a : 0
  }
  const x = new Float32Array(D)
  for (let i = 0; i < D; i++) {
    let a = w.b4[i]!
    for (let j = 0; j < H; j++) a += w.W4[i * H + j]! * g[j]!
    x[i] = a
  }
  return x
}
export const mlpForwardJS = (w: Weights, D: number, H: number, L: number, x: ArrayLike<number>) => mlpDecodeJS(w, D, H, L, mlpEncodeJS(w, D, H, L, x))

export function trainMLP(m: MLP, X: Float32Array[], opt: { steps: number; lr: number; seed?: number }): number[] {
  const { D, H, L } = m
  const { steps, lr } = opt
  let s = (opt.seed ?? 7) >>> 0
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const m1 = new Float32Array(m.paramSize)
  const v1 = new Float32Array(m.paramSize)
  const b1 = 0.9, b2 = 0.999, eps = 1e-8
  const losses: number[] = []
  for (let step = 1; step <= steps; step++) {
    const grads = new Float32Array(m.paramSize)
    let loss = 0
    for (const x of X) {
      mlpSetInput(m, x)
      const values = m.circuit.evaluateReference(m.source)
      const outGrad = new Float32Array(values.length)
      for (let k = 0; k < D; k++) {
        const diff = values[m.out[k]!]! - x[k]!
        loss += (diff * diff) / (X.length * D)
        outGrad[m.out[k]!] += (2 * diff) / (X.length * D)
      }
      const g = m.circuit.backpropagateReference(values, outGrad)
      for (let p = 0; p < m.paramSize; p++) grads[p] += g[p]!
    }
    const bc1 = 1 - Math.pow(b1, step)
    const bc2 = 1 - Math.pow(b2, step)
    for (let p = 0; p < m.paramSize; p++) {
      const grad = grads[p]!
      m1[p] = b1 * m1[p]! + (1 - b1) * grad
      v1[p] = b2 * v1[p]! + (1 - b2) * grad * grad
      m.source[p]! -= ((lr * (m1[p]! / bc1)) / (Math.sqrt(v1[p]! / bc2) + eps))
    }
    if (step % 10 === 0 || step === 1) losses.push(loss)
    void rnd
  }
  return losses
}

export function verifyMLP(m: MLP, X: Float32Array[]): number {
  const w = readWeights(m)
  let maxd = 0
  for (const x of X) {
    mlpSetInput(m, x)
    const values = m.circuit.evaluateReference(m.source)
    const ref = mlpForwardJS(w, m.D, m.H, m.L, x)
    for (let k = 0; k < m.D; k++) maxd = Math.max(maxd, Math.abs(values[m.out[k]!]! - ref[k]!))
  }
  return maxd
}

export function verifyEquipped(p: PCA, X: Float32Array[]): number {
  const eq = buildEquippedLinear(p)
  validateCircuit(eq.circuit)
  let maxd = 0
  for (const x of X) {
    const values = eq.circuit.evaluateReference(Float32Array.from(x))
    const ref = pcaDecode(pcaEncode(x, p), p)
    for (let i = 0; i < p.D; i++) maxd = Math.max(maxd, Math.abs(values[eq.out[i]!]! - ref[i]!))
  }
  return maxd
}
