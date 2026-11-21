// Can madhubani-animals be rewritten 1:1 in Handwired?
//
// The answer is not an opinion, it is a diff. This file takes the numeric heart of the whole
// animal system — `SDFModel.dist` + `SDFModel.evalList`, the function that every one of the 24
// animals' 96..956 primitives is evaluated through, millions of times per render — and rebuilds it
// as one Handwired numeric program, then compares the two on the real elephant, point by point.
//
// Three columns:
//   original   the real SDFModel.dist, float64, unmodified, what the animals actually use
//   f32        the same formula hand-written in float32 (Math.fround after every operation) —
//              what a faithful single-precision rewrite would compute
//   handwired  the same program as a Circuit, evaluated by the Handwired runtime
//
//   handwired vs f32        the port's arithmetic fidelity
//   f32 vs original         the price of float32 itself
//   handwired vs original   the total, the only number a render cares about
//
// Run: bun run madhuban-morphology/port.ts [species]

import { pathToFileURL } from 'node:url'
import {
  type Circuit,
  type Wire,
  emitCompare,
  emitMaximumExact,
  emitMinimumExact,
  emitSelect,
} from '../src/runtime/numeric-ui-core.ts'
import { createEvaluator, createSourceTable, input } from '../src/runtime/cells.ts'
import { emitDivide, emitReciprocal, emitSqrt } from '../lab/ui-exploration/numeric-library/arithmetic.ts'

const SRC = 'C:/Users/mehul/OneDrive/Desktop/Studio/KnowledgeBase/experiments/madhubani-animals/src'
const T_ELL = 0
const T_CONE = 1
const T_LENS = 2
const T_FIN = 3

export type Prim = {
  type: number
  P: Float64Array
  k: number
  carve: boolean
  tag: string
  group: string
  part: string
}

async function loadSpecies(sp: string) {
  const cap = sp[0]!.toUpperCase() + sp.slice(1)
  const rigMod: any = await import(pathToFileURL(`${SRC}/species/${sp}/rig.js`).href)
  const rig = rigMod[`${sp}Rig`]()
  const sculptMod: any = await import(pathToFileURL(`${SRC}/species/${sp}/sculpt.js`).href)
  const sculpt = sculptMod[`sculpt${cap}`]
  const { SDFModel } = await import(pathToFileURL(`${SRC}/core/sdf/sdf.js`).href)
  const m = new SDFModel()
  sculpt(m, rig)
  return { rig, prims: m.prims as Prim[], SDFModel }
}

// ─────────────────────────────────────────────────────────────────────────────
// Column 1 — the original, float64, called through the real class.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Column 2 — the same program with float32 rounding after every operation.
// ─────────────────────────────────────────────────────────────────────────────

const f = Math.fround
const mn = (a: number, b: number) => (a < b ? a : b)
const mx = (a: number, b: number) => (a > b ? a : b)
const abs32 = (a: number) => mx(a, -a)

function smin32(a: number, b: number, k: number) {
  if (k <= 0) return mn(a, b)
  const d = f(a - b)
  const h = f(mx(k - abs32(d), 0) / k)
  return f(mn(a, b) - f(f(f(h * h) * k) * f(0.25)))
}

function dot32(a: number, b: number, c: number) {
  return f(f(f(a * a) + f(b * b)) + f(c * c))
}

function polySD32(P: Float64Array, px: number, py: number) {
  const n = P[14]!
  let d = f(f(f(px - P[15]!) * f(px - P[15]!)) + f(f(py - P[16]!) * f(py - P[16]!)))
  let s = 1
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ix = P[15 + i * 2]!, iy = P[16 + i * 2]!, jx = P[15 + j * 2]!, jy = P[16 + j * 2]!
    const ex = f(jx - ix), ey = f(jy - iy), wx = f(px - ix), wy = f(py - iy)
    const den = f(f(ex * ex) + f(ey * ey)) || 1e-18
    const t = f(mx(0, mn(1, f(f(f(wx * ex) + f(wy * ey)) / den))))
    const bx = f(wx - f(ex * t)), by = f(wy - f(ey * t))
    const dd = f(f(bx * bx) + f(by * by))
    if (dd < d) d = dd
    const c1 = py >= iy, c2 = py < jy, c3 = f(ex * wy) > f(ey * wx)
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s
  }
  return f(s * f(Math.sqrt(d)))
}

function dist32(pr: Prim, x: number, y: number, z: number): number {
  const P = pr.P
  if (pr.type === T_ELL) {
    const dx = f(x - P[0]!), dy = f(y - P[1]!), dz = f(z - P[2]!)
    const lx = f(f(f(dx * P[3]!) + f(dy * P[4]!)) + f(dz * P[5]!))
    const ly = f(f(f(dx * P[6]!) + f(dy * P[7]!)) + f(dz * P[8]!))
    const lz = f(f(f(dx * P[9]!) + f(dy * P[10]!)) + f(dz * P[11]!))
    const rx = f(P[12]!), ry = f(P[13]!), rz = f(P[14]!)
    const qx = f(lx / rx), qy = f(ly / ry), qz = f(lz / rz)
    const k0 = f(Math.sqrt(dot32(qx, qy, qz)))
    const sx = f(qx / rx), sy = f(qy / ry), sz = f(qz / rz)
    const k1 = f(Math.sqrt(dot32(sx, sy, sz)))
    if (k1 < 1e-12) return f(-mn(rx, mn(ry, rz)))
    return f(f(k0 * f(k0 - 1)) / k1)
  }
  if (pr.type === T_LENS) {
    const dx = f(x - P[0]!), dy = f(y - P[1]!), dz = f(z - P[2]!)
    const lx = f(f(f(dx * P[3]!) + f(dy * P[4]!)) + f(dz * P[5]!))
    const ly = f(f(f(dx * P[6]!) + f(dy * P[7]!)) + f(dz * P[8]!))
    const lz = f(f(f(dx * P[9]!) + f(dy * P[10]!)) + f(dz * P[11]!))
    const R = f(P[12]!), d = f(P[13]!)
    const h1 = f(Math.sqrt(f(f(lx * lx) + f(f(ly + d) * f(ly + d)))))
    const h2 = f(Math.sqrt(f(f(lx * lx) + f(f(ly - d) * f(ly - d)))))
    return mx(f(mx(f(h1 - R), f(h2 - R)), f(P[14]! - lz)), f(lz - P[15]!))
  }
  if (pr.type === T_FIN) {
    const dx = f(x - P[0]!), dy = f(y - P[1]!), dz = f(z - P[2]!)
    const pu = f(f(f(dx * P[3]!) + f(dy * P[4]!)) + f(dz * P[5]!))
    const pv = f(f(f(dx * P[6]!) + f(dy * P[7]!)) + f(dz * P[8]!))
    const pn = f(f(f(dx * P[9]!) + f(dy * P[10]!)) + f(dz * P[11]!))
    const gi = 15 + 2 * P[14]!
    const poly = polySD32(P, pu, pv)
    if (P.length > gi) {
      const gu = f(P[gi]!), gv = f(P[gi + 1]!)
      const hh = mx(f(0.2 * P[12]!), f(f(P[12]! + f(gu * pu)) + f(gv * pv)))
      const rho = mn(hh, f(f(P[13]! * hh) / f(P[12]!)))
      let q = pn
      let sl = 0
      if (P.length > gi + 2) {
        const su = f(f(P[gi + 3]! + f(P[gi + 5]! * pu)) + f(P[gi + 6]! * pv))
        const sv = f(f(P[gi + 4]! + f(P[gi + 6]! * pu)) + f(P[gi + 7]! * pv))
        const tA = f(f(P[gi + 5]! * pu) * pu)
        const tB = f(f(f(2 * P[gi + 6]!) * pu) * pv)
        const tC = f(f(P[gi + 7]! * pv) * pv)
        const quadratic = f(0.5 * f(f(tA + tB) + tC))
        q = f(pn - f(f(f(f(P[gi + 2]! + f(P[gi + 3]! * pu)) + f(P[gi + 4]! * pv)) + quadratic)))
        sl = f(Math.sqrt(f(f(su * su) + f(sv * sv))))
      }
      const ex = f(poly + rho)
      const ey = f(abs32(q) - f(hh - rho))
      const ox = ex > 0 ? ex : 0
      const oy = ey > 0 ? ey : 0
      const L = f(f(Math.sqrt(f(f(gu * gu) + f(gv * gv)))) + sl)
      const inner = f(f(mn(mx(ex, ey), 0) + f(Math.sqrt(f(f(ox * ox) + f(oy * oy))))) - rho)
      return f(inner / f(Math.sqrt(f(1 + f(L * L)))))
    }
    const rho = f(P[13]!)
    const ex = f(poly + rho)
    const ey = f(abs32(pn) - f(P[12]! - rho))
    const ox = ex > 0 ? ex : 0
    const oy = ey > 0 ? ey : 0
    return f(f(mn(mx(ex, ey), 0) + f(Math.sqrt(f(f(ox * ox) + f(oy * oy))))) - rho)
  }
  const pax = f(x - P[0]!), pay = f(y - P[1]!), paz = f(z - P[2]!)
  const bax = f(P[3]!), bay = f(P[4]!), baz = f(P[5]!)
  const l2 = f(P[6]!), rr = f(P[7]!), a2 = f(P[8]!), il2 = f(P[9]!), r1 = f(P[10]!), r2 = f(P[11]!)
  const yy = f(f(f(pax * bax) + f(pay * bay)) + f(paz * baz))
  const zz = f(yy - l2)
  const vx = f(f(pax * l2) - f(bax * yy)), vy = f(f(pay * l2) - f(bay * yy)), vz = f(f(paz * l2) - f(baz * yy))
  const x2 = f(f(f(vx * vx) + f(vy * vy)) + f(vz * vz))
  const y2 = f(f(yy * yy) * l2)
  const z2 = f(f(zz * zz) * l2)
  const k = f(f(f(Math.sign(rr) * rr) * rr) * x2)
  if (f(f(f(Math.sign(zz) * a2) * z2) - k) > 0) return f(f(f(Math.sqrt(f(x2 + z2))) * il2) - r2)
  if (f(f(f(Math.sign(yy) * a2) * y2) - k) < 0) return f(f(f(Math.sqrt(f(x2 + y2))) * il2) - r1)
  return f(f(f(f(Math.sqrt(f(f(x2 * a2) * il2))) + f(yy * rr)) * il2) - r1)
}

function eval32(prims: Prim[], x: number, y: number, z: number) {
  let d = f(1e9)
  for (const pr of prims) {
    const di = dist32(pr, x, y, z)
    if (!pr.carve) d = smin32(d, di, pr.k)
    else d = f(-smin32(f(-d), di, pr.k))
  }
  return d
}

// ─────────────────────────────────────────────────────────────────────────────
// Column 3 — the same program as one Handwired Circuit.
//
// Four things a source-to-source port has to get right, each learned the hard way here:
//
//  1. Handwired rewrites algebra. An affine with a few terms is normally composed into its
//     consumer and constants are folded, which moves where a value rounds. Every operation in the
//     original rounds, so every operation here has to be its own wire: roundAffine, not affine.
//  2. multiply is exact only when one operand is *provably* non-negative from its declared range;
//     otherwise it silently uses relu(left) * right, which is wrong for a negative left. So
//     products go through `mul`, which keeps a non-negative factor in the gate slot, and squares
//     go through `mul(a, a)`.
//  3. sqrt and reciprocal cover at most 22 octaves (2^22) between their range endpoints. An SDF
//     queries sqrt over a far wider span, so the port has to *add* band selection that the
//     original does not have — and each band needs its argument clamped into the band, or the
//     Newton iteration diverges past it.
//  4. A dataflow program cannot return early. The original's `if (k1 < 1e-12)` guard becomes a
//     select, and both branches have to stay finite.
// ─────────────────────────────────────────────────────────────────────────────

const FIELD = 1e5
const POS = 20
// One band covers 2^22, the hard limit in emitSqrt. Shifts are multiples of 22 (even) so every
// power-of-two scale factor is exact and costs no accuracy at all.
const SQRT_MIN = 2 ** -20
const SQRT_MAX = 2 ** 2
const BAND = 22
const BAND_HALF = BAND / 2

// Diagnostic switch, off by default: `--no-floor` makes band 0 promise the global SQRT_MIN again,
// reproducing the pre-fix behaviour on the *same* seeded sweep so the improvement is a measurement
// rather than a memory of an unseeded run.
const FLOOR = !process.argv.includes('--no-floor')

const bandsFor = (maxArg: number) =>
  Math.max(1, Math.min(4, Math.ceil(Math.log2(Math.max(maxArg, SQRT_MIN * 2) / SQRT_MIN) / BAND)))

// The three branches of the original's round cone, evaluated in float64. The port decides between
// them with a fixed-point comparison; when the two sides of a branch test sit inside the
// comparison's resolution the port can pick a different arm than float64 does, and the resulting
// distance error is exactly the gap between the arms. Printing them at the worst point separates
// "the port miscalculated" from "the kernel's own decision boundary is a coin flip".
function coneArms(P: Float64Array, x: number, y: number, z: number) {
  const pax = x - P[0]!, pay = y - P[1]!, paz = z - P[2]!
  const yy = pax * P[3]! + pay * P[4]! + paz * P[5]!
  const zz = yy - P[6]!
  const vx = pax * P[6]! - P[3]! * yy
  const vy = pay * P[6]! - P[4]! * yy
  const vz = paz * P[6]! - P[5]! * yy
  const x2 = vx * vx + vy * vy + vz * vz
  const y2 = yy * yy * P[6]!
  const z2 = zz * zz * P[6]!
  const k = Math.sign(P[7]!) * P[7]! * P[7]! * x2
  const lhsZ = Math.sign(zz) * P[8]! * z2
  const lhsY = Math.sign(yy) * P[8]! * y2
  const armZ = Math.sqrt(x2 + z2) * P[9]! - P[11]!
  const armY = Math.sqrt(x2 + y2) * P[9]! - P[10]!
  const armM = (Math.sqrt(x2 * P[8]! * P[9]!) + yy * P[7]!) * P[9]! - P[10]!
  const picked = lhsZ > k ? 'Z' : lhsY < k ? 'Y' : 'M'
  return { armZ, armY, armM, picked, lhsZ, lhsY, k, x2, y2, z2, yy, zz }
}

// The ellipsoid's intermediates in float64, next to the port's tapped wires. The port's k0 and k1
// come from two different banded square roots, so if their *ratio* drifts the error appears as a
// constant relative offset across the whole interior — which is what the near-centre failure looks
// like, and it is invisible unless the two are printed side by side.
function ellParts(P: readonly number[], x: number, y: number, z: number) {
  const dx = x - P[0]!
  const dy = y - P[1]!
  const dz = z - P[2]!
  const lx = P[3]! * dx + P[4]! * dy + P[5]! * dz
  const ly = P[6]! * dx + P[7]! * dy + P[8]! * dz
  const lz = P[9]! * dx + P[10]! * dy + P[11]! * dz
  const rx = P[12]!
  const ry = P[13]!
  const rz = P[14]!
  const qx = lx / rx
  const qy = ly / ry
  const qz = lz / rz
  const arg0 = qx * qx + qy * qy + qz * qz
  const k0 = Math.sqrt(arg0)
  const arg1 = (qx / rx) ** 2 + (qy / ry) ** 2 + (qz / rz) ** 2
  const k1 = Math.sqrt(arg1)
  return { arg0, k0, arg1, k1, invK1: 1 / k1, main: (k0 * (k0 - 1)) / k1 }
}

function cornerReach(centre: readonly number[], lo: readonly number[], hi: readonly number[]) {
  let reach = 0
  for (let i = 0; i < 8; i++) {
    const dx = ((i & 1 ? hi[0]! : lo[0]!) - centre[0]!) as number
    const dy = ((i & 2 ? hi[1]! : lo[1]!) - centre[1]!) as number
    const dz = ((i & 4 ? hi[2]! : lo[2]!) - centre[2]!) as number
    reach = Math.max(reach, Math.hypot(dx, dy, dz))
  }
  return reach
}

// Set to an object by the `debug` mode before a build; every primitive then drops its intermediate
// wires into it, and makeBuilder exposes them as extra outputs. Reading a value out of a circuit is
// the only way to tell a wrong formula from a wrong line about a range.
let taps: Record<string, Wire> | null = null

function makeBuilder(
  prims: Prim[],
  lo: readonly number[],
  hi: readonly number[],
  probe?: (env: Record<string, unknown>) => Record<string, Wire>,
) {
  const table = createSourceTable()
  // The declared input domain is the sample box, widened to contain the origin: createSourceTable's
  // finish() validates a default source of zeros against the declared ranges, so a box like
  // y in [1.03, 3.85] is rejected outright even though we never sample it.
  const span = (i: number): [number, number] => [Math.min(lo[i]!, 0), Math.max(hi[i]!, 0)]
  const cells = table.declare({
    x: input(span(0)),
    y: input(span(1)),
    z: input(span(2)),
  })
  const c = table.createCircuit()

  // The widest finite window. A bound is only ever a claim about the value, so the default never
  // contradicts the range the operation itself inferred — that matters because a band constant goes
  // up to 2^66, far outside any fixed window. Where a range has to be *exact* (the band clamp, the
  // sqrt promise), the caller passes explicit bounds.
  const declare = (w: Wire, lo2 = -Infinity, hi2 = Infinity) => {
    c.assumeRange(w, lo2, hi2, { allowExistingReaders: true })
    return w
  }

  // Wire arithmetic. Scalars are a different kind of thing: `minusScalar(a, k)` and
  // `scalarMinus(k, a)` take a *number*, and a `Wire` is a number at runtime (an index), so passing a
  // wire to them type-checks and silently subtracts its index. That bug cost a whole debugging
  // session on the tapered fin, so the names now say `scalar` out loud and wires use `sub`.
  const K = (v: number) => c.constant(v)
  const neg = (a: Wire) => declare(c.roundAffine([[a, -1]]))
  const add = (a: Wire, b: Wire) => declare(c.roundAffine([[a, 1], [b, 1]]))
  const sub = (a: Wire, b: Wire) => declare(c.roundAffine([[a, 1], [b, -1]]))
  const minusScalar = (a: Wire, k: number) => declare(c.roundAffine([[a, 1]], -k))
  const scalarMinus = (k: number, a: Wire) => declare(c.roundAffine([[a, -1]], k))

  // A product that is exact for any signs: Handwired's multiply only is when one operand is
  // provably non-negative, so keep such a factor in the gate slot, and fall back to
  // relu(a)*b + relu(-a)*(-b) when neither is.
  const mul = (a: Wire, b: Wire): Wire => {
    if (c.isNonNegative(b)) return declare(c.multiply(a, b))
    if (c.isNonNegative(a)) return declare(c.multiply(b, a))
    const na = neg(a)
    const nb = neg(b)
    const p = c.reglu([[a, 1]], 0, [[b, 1]], 0)
    const n = c.reglu([[na, 1]], 0, [[nb, 1]], 0)
    return declare(c.roundAffine([[p, 1], [n, 1]]))
  }
  const sq = (a: Wire) => mul(a, a)
  const dot3 = (a: Wire, b: Wire, d: Wire) => add(add(sq(a), sq(b)), sq(d))

  const min = (a: Wire, b: Wire) => declare(emitMinimumExact(c, a, b))
  const max = (a: Wire, b: Wire) => declare(emitMaximumExact(c, a, b))
  const abs = (a: Wire) => emitMaximumExact(c, a, neg(a))
  // reglu(leftTerms, gateTerms) is left * relu(gate) — the relu is on the *gate*, so a relu of `a`
  // is 1 * relu(a). Getting this backwards silently returns `a`.
  const relu = (a: Wire) => c.reglu([], 1, [[a, 1]], 0)
  // A one-ulp clamp, three operations instead of a full comparison cascade. Both forms are written
  // from `a` outward, which makes them *exact* on the side that is actually used and approximate
  // only on the side that gets discarded:
  //   a - relu(a - k) = a exactly when a <= k, so min(a, k) is exact when the clamp does nothing.
  //   a + relu(k - a) = a exactly when a >= k, likewise.
  // The obvious `k - relu(k - a)` instead cancels catastrophically when a << k: it returns a
  // quantized to ulp(k), so a genuine 11 came back as 11 +/- 1 against a band edge of 2^24.
  const atLeast = (a: Wire, k: number) => add(a, relu(scalarMinus(k, a)))
  const atMost = (a: Wire, k: number) => sub(a, relu(minusScalar(a, k)))

  const sign = (a: Wire) =>
    declare(
      emitSelect(
        c,
        emitCompare(c, a, '>', K(0)),
        emitSelect(c, emitCompare(c, a, '<', K(0)), K(0), K(-1)),
        K(1),
      ),
      -1,
      1,
    )

  const div = (a: Wire, b: Wire) => declare(emitDivide(c, a, b))

  // Band i covers sqrt arguments in [low, SQRT_MAX] * 2^(22 i). Clamping each band's input into its
  // own band keeps the unselected bands finite, and the clamp is exact inside the band.
  //
  // `low` matters. The library's sqrt covers `x = 0 or x in [minimumPositive, maximum]` and returns
  // exactly zero for zero — but only if the argument is *allowed* to reach zero. Clamping the low end
  // at SQRT_MIN instead floors every small argument at sqrt(2^-20) = 9.77e-4, which the cone's axis
  // (where x2 -> 0, then multiplied by il2 ~ 100) turns into a 0.1 m block of error. The reciprocal
  // path keeps the floor because a reciprocal needs a strictly positive range.
  const bandValue = (arg: Wire, i: number, low: number) => {
    const scaled = mul(atMost(atLeast(arg, low), SQRT_MAX * 2 ** (BAND * i)), K(2 ** (-BAND * i)))
    c.assumeRange(scaled, low === 0 ? 0 : SQRT_MIN, SQRT_MAX, { allowExistingReaders: true })
    return scaled
  }

  // sqrt over the full range, built from the library's own emitSqrt applied to band-clamped,
  // power-of-two-scaled arguments. emitSqrt is accurate on [minimumPositive, maximum] and requires
  // maximum/minimumPositive <= 2^22, so a band's accuracy floor is only as low as its declared
  // maximum allows. Bands i >= 1 satisfy maximum/minimumPositive = 2^22 exactly from the clamp and
  // declare a positive range.minimum, so emitSqrt reads that and ignores the option. Band 0 is the
  // one whose low clamp is 0 — deliberately, so a genuine zero stays zero, because clamping it at
  // SQRT_MIN floors the cone's axis at sqrt(2^-20) ~ 9.8e-4 and il2 ~ 60 turns that into ~0.06 m.
  // Band 0 therefore has to be told its floor. Passing the *global* SQRT_MIN there was the port's
  // remaining bug: emitSqrt falls back to options.minimumPositive, and the cone's apex has
  // x2 + q ~ 2e-8, far under SQRT_MIN = 9.5e-7, so the seed was for the wrong regime and the result
  // decayed linearly instead of as a square root (measured on the band machinery alone: ratio 0.99 at
  // 1e-7, 0.59 at 1e-8, 0.065 at 1e-10, floor exactly at SQRT_MIN). Deriving the floor from the
  // band's own declared maximum lifts that floor by up to 2^22. The 1.0001 keeps the ratio invariant
  // satisfied after the bound is rounded to float32.
  const sqrtWide = (arg: Wire, maxArg: number, label?: string) => {
    const bands = bandsFor(maxArg)
    const band = (i: number) => {
      const scaled = bandValue(arg, i, 0)
      const maximum = c.ranges[scaled]!.maximum
      const floor = i === 0 && FLOOR && maximum > 0 ? (maximum / 2 ** 22) * 1.0001 : SQRT_MIN
      return declare(mul(emitSqrt(c, scaled, { minimumPositive: floor }), K(2 ** (BAND_HALF * i))), 0, 1e8)
    }
    let root = band(0)
    if (taps && label !== undefined) Object.assign(taps, { [`${label}0`]: root, [`${label}A`]: arg, [`${label}N`]: c.constant(bands) })
    for (let i = 1; i < bands; i++) {
      const gate = emitCompare(c, arg, '>=', K(SQRT_MIN * 2 ** (BAND * i)))
      const bi = band(i)
      if (taps && label !== undefined) Object.assign(taps, { [`${label}g${i}`]: gate, [`${label}${i}`]: bi })
      root = emitSelect(c, gate, root, bi)
    }
    return root
  }

  // 1/sqrt, which the ellipsoid needs to divide by k1 = sqrt(|l|/r^2). emitDivide cannot span k1's
  // range, so the reciprocal is banded the same way: 1/sqrt(x) = 2^(11 i) / sqrt(x * 2^(-22 i)).
  // emitSqrt declares its own output as starting at zero, and a reciprocal needs a strictly
  // positive range, so the band's root is re-declared: the clamp already pins it to [2^-10, 2].
  const ROOT_LO = Math.sqrt(SQRT_MIN)
  const ROOT_HI = Math.sqrt(SQRT_MAX)
  const invSqrtWide = (arg: Wire, maxArg: number) => {
    const bands = bandsFor(maxArg)
    const band = (i: number) => {
      const root = emitSqrt(c, bandValue(arg, i, SQRT_MIN), { minimumPositive: SQRT_MIN })
      c.assumeRange(root, ROOT_LO * 0.99, ROOT_HI * 1.001, { allowExistingReaders: true })
      // The swap of the sign here is the whole trap: sqrt(x * 2^-22i) = sqrt(x) * 2^-11i, so the
      // root is scaled *up* by 2^+11i; but 1/sqrt(x * 2^-22i) = (1/sqrt(x)) * 2^+11i, so the
      // reciprocal is scaled *down* by 2^-11i. Using +11i on both is a factor of 2^22 per band.
      return declare(mul(emitReciprocal(c, root), K(2 ** (-BAND_HALF * i))), 0, 1e20)
    }
    let inv = band(0)
    for (let i = 1; i < bands; i++) {
      inv = emitSelect(c, emitCompare(c, arg, '>=', K(SQRT_MIN * 2 ** (BAND * i))), inv, band(i))
    }
    return inv
  }

  // ── one primitive, exactly SDFModel.dist ─────────────────────────────────
  const drawPrim = (pr: Prim, x: Wire, y: Wire, z: Wire): Wire => {
    const P = pr.P
    if (pr.type === T_ELL) {
      const dx = c.roundAffine([[x, 1]], -P[0]!)
      const dy = c.roundAffine([[y, 1]], -P[1]!)
      const dz = c.roundAffine([[z, 1]], -P[2]!)
      const lx = declare(c.roundAffine([[dx, P[3]!], [dy, P[4]!], [dz, P[5]!]]))
      const ly = declare(c.roundAffine([[dx, P[6]!], [dy, P[7]!], [dz, P[8]!]]))
      const lz = declare(c.roundAffine([[dx, P[9]!], [dy, P[10]!], [dz, P[11]!]]))
      const rx = K(P[12]!)
      const ry = K(P[13]!)
      const rz = K(P[14]!)
      const qx = div(lx, rx)
      const qy = div(ly, ry)
      const qz = div(lz, rz)
      const rmin = Math.min(P[12]!, P[13]!, P[14]!)
      const reach = cornerReach([P[0]!, P[1]!, P[2]!], lo, hi)
      const arg0 = declare(dot3(qx, qy, qz), 0, 3 * (reach / rmin) ** 2)
      const k0 = sqrtWide(arg0, 3 * (reach / rmin) ** 2)
      const sx = div(qx, rx)
      const sy = div(qy, ry)
      const sz = div(qz, rz)
      const arg1 = declare(dot3(sx, sy, sz), 0, 3 * (reach / rmin ** 2) ** 2)
      const invK1 = invSqrtWide(arg1, 3 * (reach / rmin ** 2) ** 2)
      const main = declare(mul(mul(k0, minusScalar(k0, 1)), invK1))
      // The original's dead guard, kept: `if (k1 < 1e-12) return -min(rx, ry, rz)`. Both sides are
      // non-negative, so k1 < 1e-12 is arg1 < 1e-24 and the square root never has to be built.
      const guard = neg(min(rx, min(ry, rz)))
      if (taps) Object.assign(taps, { arg0, k0, arg1, invK1, rmin: K(rmin) })
      return emitSelect(c, emitCompare(c, arg1, '<', K(1e-24)), main, guard)
    }
    if (pr.type === T_LENS) {
      const dx = c.roundAffine([[x, 1]], -P[0]!)
      const dy = c.roundAffine([[y, 1]], -P[1]!)
      const dz = c.roundAffine([[z, 1]], -P[2]!)
      const lx = declare(c.roundAffine([[dx, P[3]!], [dy, P[4]!], [dz, P[5]!]]))
      const ly = declare(c.roundAffine([[dx, P[6]!], [dy, P[7]!], [dz, P[8]!]]))
      const lz = declare(c.roundAffine([[dx, P[9]!], [dy, P[10]!], [dz, P[11]!]]))
      const reach = cornerReach([P[0]!, P[1]!, P[2]!], lo, hi)
      const hypMax = 2 * reach * reach + 2 * reach * Math.abs(P[13]!) + P[13]! * P[13]!
      const hyp = (a: Wire, b: Wire) => sqrtWide(declare(add(sq(a), sq(b)), 0, hypMax), hypMax)
      const R = K(P[12]!)
      const lens = max(sub(hyp(lx, add(ly, K(P[13]!))), R), sub(hyp(lx, minusScalar(ly, P[13]!)), R))
      return max(lens, max(sub(K(P[14]!), lz), minusScalar(lz, P[15]!)))
    }
    if (pr.type === T_FIN) return drawFin(P, x, y, z, lo, hi)

    // IQ exact round cone (the original's else branch)
    const px0 = P[0]!
    const py0 = P[1]!
    const pz0 = P[2]!
    const pax = c.roundAffine([[x, 1]], -px0)
    const pay = c.roundAffine([[y, 1]], -py0)
    const paz = c.roundAffine([[z, 1]], -pz0)
    const bax = K(P[3]!)
    const bay = K(P[4]!)
    const baz = K(P[5]!)
    const l2 = P[6]!
    const a2 = P[8]!
    const il2 = K(P[9]!)
    const yy = declare(c.roundAffine([[pax, P[3]!], [pay, P[4]!], [paz, P[5]!]]))
    const zz = minusScalar(yy, P[6]!)
    const vx = declare(c.roundAffine([[pax, l2], [mul(bax, yy), -1]]))
    const vy = declare(c.roundAffine([[pay, l2], [mul(bay, yy), -1]]))
    const vz = declare(c.roundAffine([[paz, l2], [mul(baz, yy), -1]]))
    const reach = cornerReach([px0, py0, pz0], lo, hi)
    const bNorm = Math.hypot(P[3]!, P[4]!, P[5]!)
    // Honest bounds. |yy| <= bNorm * reach, so `3 * reach * sqrt(l2) * sqrt(l2)` below was not one:
    // the declared range is what emitCompare normalises by, so an over-tight bound decides the band
    // selection wrongly and costs a factor of 2^22.
    const yMax = bNorm * reach
    const zMax = yMax + Math.abs(l2)
    const vMax = reach * Math.abs(l2) + yMax
    const x2Max = 3 * vMax * vMax
    const y2Max = yMax * yMax * Math.abs(l2)
    const z2Max = zMax * zMax * Math.abs(l2)
    const x2 = declare(dot3(vx, vy, vz), 0, x2Max)
    const y2 = declare(mul(sq(yy), K(l2)), 0, y2Max)
    const z2 = declare(mul(sq(zz), K(l2)), 0, z2Max)
    // k = Math.sign(rr) * rr * rr * x2, and rr = P[7] is a build-time constant.
    const k = declare(c.roundAffine([[x2, Math.sign(P[7]!) * P[7]! * P[7]!]]))
    const testZ = emitCompare(c, declare(mul(mul(sign(zz), K(a2)), z2)), '>', k)
    const testY = emitCompare(c, declare(mul(mul(sign(yy), K(a2)), y2)), '<', k)
    const cap = (q: Wire, r: number, qMax: number, label: string) => {
      const argW = declare(add(x2, q), 0, x2Max + qMax)
      const rootW = sqrtWide(argW, x2Max + qMax)
      const val = minusScalar(mul(rootW, il2), r)
      if (taps) Object.assign(taps, { [`${label}Arg`]: argW, [`${label}Root`]: rootW, [`${label}Val`]: val })
      return val
    }
    const armZ = cap(z2, P[11]!, z2Max, 'aZ')
    const armY = cap(y2, P[10]!, y2Max, 'aY')
    // A true upper bound, not padded up to 1. The pad was harmless while the sqrt floor was the
    // global SQRT_MIN, but it now *sets* the floor: sqrtWide derives band 0's floor from this bound,
    // so padding it to 1 puts the floor at 2.4e-7 while the apex argument is 5e-11 — which is exactly
    // the cone's remaining arithmetic error. x2Max is analytic and x2 <= x2Max, so this is safe.
    const mArgMax = x2Max * Math.abs(a2) * Math.abs(P[9]!)
    const armM = minusScalar(
      mul(add(sqrtWide(declare(mul(mul(x2, K(a2)), il2), 0, mArgMax), mArgMax), mul(yy, K(P[7]!))), il2),
      P[10]!,
    )
    if (taps) Object.assign(taps, { yy, zz, x2, y2, z2, k, armZ, armY, armM, testZ, testY })
    // emitSelect(gate, off, on) selects `on` when the gate holds, so the branches read backwards
    // from the original's early-return order: testZ -> armZ, else testY -> armY, else armM.
    return emitSelect(c, testZ, emitSelect(c, testY, armM, armY), armZ)
  }

  // ── T_FIN: a planar polygon extruded to a thickness, rim rounded ──────────
  // polySD is a loop over the polygon's vertices, but every loop bound, vertex and edge vector is
  // a build-time constant, so the loop unrolls exactly. The only wire-level state is `d` (a running
  // minimum) and `s` (the winding sign); `s = -s` becomes one select per crossing edge.
  const drawFin = (P: Float64Array, x: Wire, y: Wire, z: Wire, blo: readonly number[], bhi: readonly number[]): Wire => {
    const dx = c.roundAffine([[x, 1]], -P[0]!)
    const dy = c.roundAffine([[y, 1]], -P[1]!)
    const dz = c.roundAffine([[z, 1]], -P[2]!)
    const pu = declare(c.roundAffine([[dx, P[3]!], [dy, P[4]!], [dz, P[5]!]]))
    const pv = declare(c.roundAffine([[dx, P[6]!], [dy, P[7]!], [dz, P[8]!]]))
    const pn = declare(c.roundAffine([[dx, P[9]!], [dy, P[10]!], [dz, P[11]!]]))
    const reach = cornerReach([P[0]!, P[1]!, P[2]!], blo, bhi)
    const uNorm = Math.hypot(P[3]!, P[4]!, P[5]!)
    const vNorm = Math.hypot(P[6]!, P[7]!, P[8]!)
    const nNorm = Math.hypot(P[9]!, P[10]!, P[11]!)
    const puMax = reach * uNorm
    const pvMax = reach * vNorm
    const pnMax = reach * nNorm
    const gi = 15 + 2 * P[14]!
    const tapered = P.length > gi

    const n = P[14]!
    // Honest bounds: `3 * reach * reach` is not an upper bound on anything here, and a lying declared
    // range makes emitCompare mis-normalise and pick the wrong sqrt band — worth 2^22.
    let rv = 0
    for (let i = 0; i < n; i++) rv = Math.max(rv, Math.hypot(P[15 + i * 2]!, P[16 + i * 2]!))
    const rPlane = Math.hypot(puMax, pvMax) + rv
    const dMax = rPlane * rPlane
    let d = declare(add(sq(minusScalar(pu, P[15]!)), sq(minusScalar(pv, P[16]!))), 0, dMax)
    let s: Wire = K(1)
    for (let i = 0, j = n - 1; i < n; j = i, i++) {
      const ix = P[15 + i * 2]!
      const iy = P[16 + i * 2]!
      const jx = P[15 + j * 2]!
      const jy = P[16 + j * 2]!
      const ex = jx - ix
      const ey = jy - iy
      const wx = minusScalar(pu, ix)
      const wy = minusScalar(pv, iy)
      const den = ex * ex + ey * ey || 1e-18
      // t = max(0, min(1, (wx*ex + wy*ey) / den))
      const num = declare(add(mul(wx, K(ex)), mul(wy, K(ey))))
      const t = max(K(0), min(K(1), div(num, K(den))))
      const bx = declare(sub(wx, mul(K(ex), t)))
      const by = declare(sub(wy, mul(K(ey), t)))
      d = min(d, declare(add(sq(bx), sq(by))))
      // c1 = pv >= iy, c2 = pv < jy, c3 = ex*wy > ey*wx
      const c1 = emitCompare(c, pv, '>=', K(iy))
      const c2 = emitCompare(c, pv, '<', K(jy))
      const c3 = emitCompare(c, declare(sub(mul(K(ex), wy), mul(K(ey), wx))), '>', K(0))
      // The original flips the sign when all three hold or none of them do; the two cases are
      // mutually exclusive, so the flip is their sum and `s = -s` is a single select.
      const one = c.roundAffine([[c1, -1]], 1)
      const two = c.roundAffine([[c2, -1]], 1)
      const three = c.roundAffine([[c3, -1]], 1)
      const flip = add(min(c1, min(c2, c3)), min(one, min(two, three)))
      s = emitSelect(c, declare(flip, 0, 1), s, neg(s))
    }
    const polyMax = dMax
    const poly = declare(mul(s, sqrtWide(declare(c.roundAffine([[d, 1]]), 0, polyMax), polyMax, 'p')))

    if (!tapered) {
      const rho = P[13]!
      const ex = declare(add(poly, K(rho)))
      const ey = declare(minusScalar(abs(pn), P[12]! - rho))
      const ox = max(ex, K(0))
      const oy = max(ey, K(0))
      const exMax = Math.sqrt(dMax) + Math.abs(rho)
      const eyMax = pnMax + Math.abs(P[12]! - rho)
      const oMax = exMax * exMax + eyMax * eyMax
      const num = declare(minusScalar(add(min(max(ex, ey), K(0)), sqrtWide(declare(add(sq(ox), sq(oy)), 0, oMax), oMax)), rho))
      if (taps) Object.assign(taps, { pu, pv, pn, d, poly, ex, ey, ox, oy, num })
      return num
    }

    // tapered (fin({grad})) and curved (fin({curve})) slab: half thickness and rim radius vary
    // linearly in the plane, and the mid-surface is a quadric patch over it.
    const gu = P[gi]!
    const gv = P[gi + 1]!
    const guW = K(gu)
    const gvW = K(gv)
    const hh = max(K(0.2 * P[12]!), declare(c.roundAffine([[mul(guW, pu), 1], [mul(gvW, pv), 1]], P[12]!)))
    const rho = min(hh, declare(div(mul(K(P[13]!), hh), K(P[12]!))))
    // Honest bounds for the tapered slab, from how far pu/pv/pn can actually reach.
    const gAbs = Math.abs(gu) * puMax + Math.abs(gv) * pvMax
    const sMax = Math.max(0.2 * P[12]!, P[12]! + gAbs)
    let qMax = pnMax
    let slMax = 0
    let q = pn
    let sl: Wire = K(0)
    if (P.length > gi + 2) {
      const su = declare(c.roundAffine([[mul(K(P[gi + 5]!), pu), 1], [mul(K(P[gi + 6]!), pv), 1]], P[gi + 3]!))
      const sv = declare(c.roundAffine([[mul(K(P[gi + 6]!), pu), 1], [mul(K(P[gi + 7]!), pv), 1]], P[gi + 4]!))
      const tA = declare(mul(mul(K(P[gi + 5]!), pu), pu))
      const tB = declare(mul(mul(K(2 * P[gi + 6]!), pu), pv))
      const tC = declare(mul(mul(K(P[gi + 7]!), pv), pv))
      const quadratic = declare(mul(K(0.5), add(add(tA, tB), tC)))
      const inner = declare(
        c.roundAffine([[K(P[gi + 2]!), 1], [mul(K(P[gi + 3]!), pu), 1], [mul(K(P[gi + 4]!), pv), 1], [quadratic, 1]]),
      )
      q = declare(sub(pn, inner))
      const suMax = Math.abs(P[gi + 3]!) + Math.abs(P[gi + 5]!) * puMax + Math.abs(P[gi + 6]!) * pvMax
      const svMax = Math.abs(P[gi + 4]!) + Math.abs(P[gi + 6]!) * puMax + Math.abs(P[gi + 7]!) * pvMax
      slMax = suMax * suMax + svMax * svMax
      qMax =
        pnMax +
        Math.abs(P[gi + 2]!) +
        Math.abs(P[gi + 3]!) * puMax +
        Math.abs(P[gi + 4]!) * pvMax +
        0.5 *
          (Math.abs(P[gi + 5]!) * puMax * puMax +
            2 * Math.abs(P[gi + 6]!) * puMax * pvMax +
            Math.abs(P[gi + 7]!) * pvMax * pvMax)
      sl = sqrtWide(declare(add(sq(su), sq(sv)), 0, slMax), slMax, 's')
    }
    const ex = declare(add(poly, rho))
    const ey2 = declare(sub(abs(q), sub(hh, rho)))
    const ox = max(ex, K(0))
    const oy = max(ey2, K(0))
    const exMax = Math.sqrt(dMax) + sMax
    const eyMax = qMax + sMax
    const oMax = exMax * exMax + eyMax * eyMax
    const gMax = (gu * gu + gv * gv) * (1 + 1e-6) + 1e-30
    const LMax = Math.sqrt(gMax) + Math.sqrt(slMax)
    const lMax = 1 + LMax * LMax
    const L = add(sqrtWide(declare(add(sq(guW), sq(gvW)), 0, gMax), gMax, 'g'), sl)
    const denom = declare(sqrtWide(declare(add(K(1), sq(L)), 1, lMax), lMax, 'l'), 1, Math.sqrt(lMax))
    const mt = min(max(ex, ey2), K(0))
    const oRoot = sqrtWide(declare(add(sq(ox), sq(oy)), 0, oMax), oMax, 'o')
    const num = declare(sub(add(mt, oRoot), rho))
    if (taps) Object.assign(taps, { pu, pv, pn, dPoly: d, poly, hh, rho, q, sl, L, denom, num, ex, ey2, ox, oy, mt, oRoot })
    return declare(div(num, denom))
  }

  // ── the reducer, exactly evalList ────────────────────────────────────────
  // `d` starts at 1e9 in the original. That seed is provably a no-op — |1e9 - di| is far larger
  // than any k, so h = max(k - |d|, 0)/k = 0 exactly and the smooth min returns min(1e9, di) = di.
  // `port.ts` checks that numerically below rather than assuming it.
  const smoothMin = (a: Wire, b: Wire, k: number): Wire => {
    if (k <= 0) return min(a, b)
    const diff = sub(a, b)
    const h = div(max(sub(K(k), abs(diff)), K(0)), K(k))
    return declare(sub(min(a, b), mul(mul(h, h), K(0.25 * k))))
  }

  let d: Wire | undefined
  for (const pr of prims) {
    const di = drawPrim(pr, cells.x, cells.y, cells.z)
    if (!pr.carve) d = d === undefined ? di : smoothMin(d, di, pr.k)
    else d = neg(smoothMin(neg(d!), di, pr.k))
  }

  const probeOutputs = probe === undefined
    ? undefined
    : probe({ c, cells, sqrtWide, invSqrtWide, mul, add, sub, div, K, declare, atLeast, atMost, relu, abs, sq, min, max, sign })

  const namedTaps = taps === null ? undefined : { ...taps }
  taps = null
  const program = table.finish()
  const output = { ...(d === undefined ? {} : { d }), ...namedTaps, ...probeOutputs }
  const evaluate = createEvaluator({ ...program, output })
  return {
    evaluate,
    circuit: c,
    size: c.operations.length,
    depth: Math.max(...c.depths),
    tapped: namedTaps === undefined ? [] : Object.keys(namedTaps),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Run it
// ─────────────────────────────────────────────────────────────────────────────

function box(prims: Prim[]) {
  let lo = [1e9, 1e9, 1e9]
  let hi = [-1e9, -1e9, -1e9]
  for (const pr of prims) {
    const P = pr.P
    const reach =
      pr.type === T_CONE ? Math.max(P[10]!, P[11]!) : pr.type === T_ELL ? Math.max(P[12]!, P[13]!, P[14]!) : 1
    const ends =
      pr.type === T_CONE
        ? [
            [P[0]!, P[1]!, P[2]!],
            [P[0]! + P[3]!, P[1]! + P[4]!, P[2]! + P[5]!],
          ]
        : [[P[0]!, P[1]!, P[2]!]]
    for (const e of ends) {
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i]!, e[i]! - reach)
        hi[i] = Math.max(hi[i]!, e[i]! + reach)
      }
    }
  }
  const pad = 0.25
  const span = [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!]
  lo = lo.map((v, i) => v - span[i]! * pad)
  hi = hi.map((v, i) => v + span[i]! * pad)
  return { lo, hi }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

const mode = process.argv[2] === 'debug' || process.argv[2] === 'debug-bands' ? process.argv[2] : 'port'
const species = (mode === 'port' ? process.argv[2] : process.argv[3]) ?? 'elephant'
const { prims, SDFModel } = await loadSpecies(species)
const original = (x: number, y: number, z: number) => SDFModel.evalList(prims, x, y, z)

const name = (t: number) => (t === T_ELL ? 'ell' : t === T_CONE ? 'cone' : t === T_LENS ? 'lens' : 'fin')
const counts: Record<string, number> = {}
for (const pr of prims) counts[name(pr.type)] = (counts[name(pr.type)] ?? 0) + 1

// `bun run port.ts debug-bands` — test the banded sqrt / 1-over-sqrt machinery on its own, with no
// primitive anywhere near it, over the full range the ellipsoid actually asks for.
if (mode === 'debug-bands') {
  const M = 1e4
  const built = makeBuilder([], [0, 0, 0], [M, 1, 1], ({ sqrtWide, invSqrtWide, cells }) => ({
    s: (sqrtWide as (a: Wire, m: number) => Wire)(cells.x as Wire, M),
    r: (invSqrtWide as (a: Wire, m: number) => Wire)(cells.x as Wire, M),
  }))
  console.log(`band machinery only: ${built.size} operations, depth ${built.depth}`)
  const src = new Float32Array(3)
  for (const v of [1e-14, 1e-12, 1e-10, 1e-9, 1e-8, 1e-7, 9.5e-7, 1e-6, 1e-5, 1e-4, 1e-3, 0.01, 0.5, 1, 3.9, 4.001, 10, 100, 1e3, 1e4]) {
    src[0] = v
    const o = built.evaluate(src)
    const exactRoot = Math.sqrt(v)
    const exactInv = 1 / exactRoot
    console.log(
      `x=${v.toExponential(3).padStart(9)}  sqrt hw=${o.output.s.toExponential(8)} ex=${exactRoot.toExponential(8)} ratio=${(o.output.s / exactRoot).toFixed(7)}` +
      `   inv hw=${o.output.r.toExponential(8)} ex=${exactInv.toExponential(8)} ratio=${(o.output.r / exactInv).toFixed(7)}`,
    )
  }
  process.exit(0)
}

// `bun run port.ts debug <species> [primIndex]` — build a circuit for one primitive at a time and
// diff it against the f32 reference, to find which primitive's translation is wrong. Building 127
// tiny circuits is far faster than bisecting one 84k-operation program.
if (mode === 'debug') {
  const only = process.argv[4] === undefined || process.argv[4].startsWith('--') ? undefined : Number(process.argv[4])
  const list: [Prim, number][] = only === undefined ? prims.map((pr, i) => [pr, i]) : [[prims[only]!, only]]
  const src = new Float32Array(3)
  for (const [pr, index] of list) {
    const b = box([pr])
    taps = {}
    const built = makeBuilder([pr], b.lo, b.hi)
    let worst = 0
    let where: [number, number, number] = [0, 0, 0]
    let atHW = 0
    let atF32 = 0
    let at64 = 0
    let at64r = 0
    const check = (x: number, y: number, z: number) => {
      src[0] = x
      src[1] = y
      src[2] = z
      // `worst` deliberately spans the whole disagreement with the exact-coordinate original, so the
      // reported point is the worst the render sees. at64r is the float64 value at the *same* float32
      // coordinates the circuit was given, which isolates the port's own arithmetic.
      const fx = src[0]!
      const fy = src[1]!
      const fz = src[2]!
      const hw = built.evaluate(src).output.d
      const ref = dist32(pr, fx, fy, fz)
      const ref64r = SDFModel.evalList([pr], fx, fy, fz)
      const ref64 = SDFModel.evalList([pr], x, y, z)
      if (Math.abs(hw - ref64) > worst) {
        worst = Math.abs(hw - ref64)
        where = [x, y, z]
        atHW = hw
        atF32 = ref
        at64 = ref64
        at64r = ref64r
      }
    }
    // Seeded per primitive, so the table is the same every run and a change to the builder can be
    // attributed rather than guessed at.
    let rng = (index + 1) * 0x9e3779b9
    const rnd = () => {
      rng = (rng + 0x6d2b79f5) | 0
      let t = rng
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    for (let t = 0; t < 400; t++) {
      check(lerp(b.lo[0]!, b.hi[0]!, rnd()), lerp(b.lo[1]!, b.hi[1]!, rnd()), lerp(b.lo[2]!, b.hi[2]!, rnd()))
    }
    // A uniform sweep almost never lands on the medial axis, which is exactly where a banded sqrt is
    // weakest: the argument goes to zero there. Probe it directly — points on the axis, offset by
    // between 1/1000 and 1/10 of the prim's reach, so the argument is small without being exactly 0.
    // Without these the cone's worst case reads ~1e-7 and the apex regime goes unmeasured.
    const P = pr.P
    const reach = pr.type === T_CONE ? Math.max(P[10]!, P[11]!) : pr.type === T_ELL ? Math.max(P[12]!, P[13]!, P[14]!) : 0.05
    for (let t = 0; t < 200; t++) {
      const u = rnd()
      const ax = pr.type === T_CONE ? P[0]! + u * P[3]! : P[0]!
      const ay = pr.type === T_CONE ? P[1]! + u * P[4]! : P[1]!
      const az = pr.type === T_CONE ? P[2]! + u * P[5]! : P[2]!
      const ox = rnd() - 0.5
      const oy = rnd() - 0.5
      const oz = rnd() - 0.5
      const k = (reach * 1e-3 * (t % 2 === 0 ? 1 : 100)) / (Math.hypot(ox, oy, oz) || 1)
      check(ax + ox * k, ay + oy * k, az + oz * k)
    }
    const flag = worst > 1e-4 ? '  <-- WRONG' : ''
    console.log(
      `prim ${String(index).padStart(3)} ${name(pr.type).padEnd(4)} P=[${[...pr.P].map(v => v.toFixed(3)).join(', ')}]`.
        concat(`\n    ops ${built.size}  depth ${built.depth}  worst ${worst.toExponential(2)} at (${where.map(v => v.toFixed(2)).join(', ')})`) +
        `\n    handwired ${atHW.toExponential(4)}  f32 ${atF32.toExponential(4)}  f64 ${at64.toExponential(4)}  f64@f32coords ${at64r.toExponential(4)}` +
        `\n    err: total ${Math.abs(atHW - at64).toExponential(2)}` +
        `  |  port arithmetic ${Math.abs(atHW - at64r).toExponential(2)}` +
        `  |  input quantisation ${Math.abs(at64r - at64).toExponential(2)}` +
        `  |  f32 reference ${Math.abs(atF32 - at64).toExponential(2)}${flag}`,
    )
    if (built.tapped.length > 0) {
      src[0] = where[0]
      src[1] = where[1]
      src[2] = where[2]
      const out = built.evaluate(src).output as Record<string, number>
      const parts = built.tapped.filter(k => k !== 'd').map(k => `${k}=${out[k]!.toExponential(9)}`)
      console.log(`    taps: ${parts.join('  ')}`)
    }
    if (pr.type === T_CONE) {
      const a = coneArms(pr.P, where[0], where[1], where[2])
      const lo2 = Math.min(a.armZ, a.armY, a.armM)
      const hi2 = Math.max(a.armZ, a.armY, a.armM)
      const nearest = [Math.abs(atHW - a.armZ), Math.abs(atHW - a.armY), Math.abs(atHW - a.armM)]
      const portArm = ['Z', 'Y', 'M'][nearest.indexOf(Math.min(...nearest))]
      console.log(
        `    f64 arms: Z=${a.armZ.toExponential(3)} Y=${a.armY.toExponential(3)} M=${a.armM.toExponential(3)}` +
          ` picks ${a.picked}  port's ${atHW.toExponential(3)} is nearest arm ${portArm}` +
          `  spread=${(hi2 - lo2).toExponential(2)}` +
          `  Z-margin=${(a.lhsZ - a.k).toExponential(2)} Y-margin=${(a.lhsY - a.k).toExponential(2)}` +
          `\n    f64 pieces: yy=${a.yy.toExponential(9)} zz=${a.zz.toExponential(9)} x2=${a.x2.toExponential(9)} y2=${a.y2.toExponential(9)} z2=${a.z2.toExponential(9)} k=${a.k.toExponential(9)}`,
      )
    }
    if (pr.type === T_ELL) {
      const e = ellParts(pr.P, where[0], where[1], where[2])
      const out = built.evaluate(src).output as Record<string, number>
      const rel = (port: number | undefined, truth: number) => ((port! - truth) / truth).toExponential(2)
      console.log(
        `    f64 ell: arg0=${e.arg0.toExponential(9)} k0=${e.k0.toExponential(9)}` +
          `  arg1=${e.arg1.toExponential(9)} k1=${e.k1.toExponential(9)} invK1=${e.invK1.toExponential(9)} main=${e.main.toExponential(9)}`,
      )
      console.log(
        `    port f64-relative error: arg0 ${rel(out.arg0, e.arg0)}  k0 ${rel(out.k0, e.k0)}` +
          `  arg1 ${rel(out.arg1, e.arg1)}  invK1 ${rel(out.invK1, e.invK1)}`,
      )
    }
  }
  process.exit(0)
}

console.log(`\n=== a 1:1 port of madhubani-animals SDFModel.evalList — ${species} ===`)
console.log(`primitives: ${prims.length}  ${JSON.stringify(counts)}  carvers: ${prims.filter(p => p.carve).length}`)

const { lo, hi } = box(prims)
const t0build = performance.now()
const built = makeBuilder(prims, lo, hi)
const buildMs = performance.now() - t0build
console.log(`handwired program: ${built.size} operations, depth ${built.depth}, built in ${buildMs.toFixed(0)} ms`)
console.log(`sample box: ${lo.map(v => v.toFixed(2)).join(', ')} .. ${hi.map(v => v.toFixed(2)).join(', ')}`)

// The 1e9 seed is dropped in the circuit. Verify that claim rather than assume it.
let seedNoop = true
for (let i = 0; i < 2000 && seedNoop; i++) {
  const x = lerp(lo[0]!, hi[0]!, Math.random())
  const y = lerp(lo[1]!, hi[1]!, Math.random())
  const z = lerp(lo[2]!, hi[2]!, Math.random())
  let a = f(1e9)
  let b = 0
  let first = true
  for (const pr of prims) {
    const di = dist32(pr, x, y, z)
    if (!pr.carve) {
      a = smin32(a, di, pr.k)
      b = first ? di : smin32(b, di, pr.k)
    } else {
      a = f(-smin32(f(-a), di, pr.k))
      b = f(-smin32(f(-b), di, pr.k))
    }
    first = false
  }
  if (a !== b) seedNoop = false
}
console.log(`the 1e9 seed is a no-op: ${seedNoop}`)

// Half the points uniform in the box, half harvested from a 2 cm band around the surface, which is
// where a raymarcher actually spends its samples.
//
// Seeded, deliberately. An unseeded sweep makes `max` a random variable: two runs of the same build
// can differ by an order of magnitude, which makes every before/after comparison worthless. The seed
// is fixed so the same build always reports the same numbers and a change can be attributed.
const N_UNIFORM = 1200
const N_SURFACE = 400
let rngState = 0x9e3779b9
const random = () => {
  rngState = (rngState + 0x6d2b79f5) | 0
  let t = rngState
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const points: [number, number, number][] = []
for (let i = 0; i < N_UNIFORM; i++) {
  points.push([lerp(lo[0]!, hi[0]!, random()), lerp(lo[1]!, hi[1]!, random()), lerp(lo[2]!, hi[2]!, random())])
}
let tries = 0
while (points.length < N_UNIFORM + N_SURFACE && tries < 4_000_000) {
  tries++
  const x = lerp(lo[0]!, hi[0]!, random())
  const y = lerp(lo[1]!, hi[1]!, random())
  const z = lerp(lo[2]!, hi[2]!, random())
  if (Math.abs(original(x, y, z)) < 0.02) points.push([x, y, z])
}
console.log(`points: ${points.length} (${points.length - N_UNIFORM} within 2 cm of the surface, ${tries} probes)`)

const source = new Float32Array(3)
const t0 = performance.now()
const rows: { d0: number; d0r: number; d32: number; dhw: number; onSurface: boolean; x: number; y: number; z: number }[] = []
for (let i = 0; i < points.length; i++) {
  const [x, y, z] = points[i]!
  source[0] = x
  source[1] = y
  source[2] = z
  // The circuit's input is a Float32Array, so the port *cannot* be handed more precision than float32
  // — while a reference written in JavaScript gets the exact float64 coordinates. Comparing the port
  // against a reference at unrounded coordinates therefore charges the port for the input format as
  // well as for its own arithmetic. Reading the coordinates back out of the array and evaluating
  // every reference there separates the two, and the total is still reported.
  const fx = source[0]!
  const fy = source[1]!
  const fz = source[2]!
  const out = built.evaluate(source)
  rows.push({
    d0: original(x, y, z),
    d0r: original(fx, fy, fz),
    d32: eval32(prims, fx, fy, fz),
    dhw: out.output.d,
    onSurface: i >= N_UNIFORM,
    x,
    y,
    z,
  })
}
const ms = performance.now() - t0

type Stat = { max: number; mean: number; p99: number }
function stat(pick: (r: (typeof rows)[number]) => number): Stat {
  const v = rows.map(pick).map(Math.abs).sort((a, b) => a - b)
  return { max: v[v.length - 1]!, mean: v.reduce((s, t) => s + t, 0) / v.length, p99: v[Math.floor(v.length * 0.99)]! }
}
const fmt = (s: Stat) => `max ${s.max.toExponential(3)}  mean ${s.mean.toExponential(3)}  p99 ${s.p99.toExponential(3)}`

const arith = stat(r => r.dhw - r.d0r) // the port's arithmetic, both sides at float32 coordinates
const f32Arith = stat(r => r.d32 - r.d0r) // a plain float32 re-implementation, same inputs
const inputQuant = stat(r => r.d0r - r.d0) // the price of round-tripping the coordinates
const hwVsF32 = stat(r => r.dhw - r.d32)
const hwVsOrig = stat(r => r.dhw - r.d0) // the total a render actually sees
const surface = rows.filter(r => r.onSurface)
const surfErr = surface.map(r => Math.abs(r.dhw - r.d0))
const signFlips = (pair: (r: (typeof rows)[number]) => [number, number]) =>
  rows.filter(r => Math.sign(pair(r)[0]) !== Math.sign(pair(r)[1])).length

console.log(`\nabsolute distance error, in metres, over ${rows.length} points`)
console.log(`  all references evaluated at the same float32 coordinates the circuit receives:`)
console.log(`    port arithmetic      (handwired - float64)      : ${fmt(arith)}`)
console.log(`    float32 arithmetic   (float32   - float64)      : ${fmt(f32Arith)}`)
console.log(`    input quantisation   (float64@f32 - float64)    : ${fmt(inputQuant)}`)
console.log(`  the total a render sees (all three, at exact coordinates):`)
console.log(`    handwired - original                          : ${fmt(hwVsOrig)}`)
console.log(`    handwired - float32 reference                 : ${fmt(hwVsF32)}`)
console.log(`\n  on the surface (|d| < 2 cm, n = ${surface.length}):`)
console.log(`  handwired vs original          : max ${Math.max(...surfErr).toExponential(3)}  mean ${(surfErr.reduce((s, t) => s + t, 0) / surface.length).toExponential(3)}`)
// A deviation means nothing without the quantum it is measured in. 2^-23 is float32's spacing at
// 1.0, so "6.8e-7 m" becomes "under 6 float32 quanta" — which is the only form in which "this port
// costs nothing" is a checkable statement rather than a feeling.
const QUANTUM = 2 ** -23
const quanta = stat(r => (r.dhw - r.d0) / QUANTUM)
const REL_MIN = 0.1
const rel = rows.filter(r => Math.abs(r.d0) > REL_MIN).map(r => Math.abs((r.dhw - r.d0) / r.d0))
const relMax = Math.max(...rel)
console.log(`\nin float32 quanta (2^-23 = ${QUANTUM.toExponential(2)} m, the spacing of a float32 at 1 m)`)
console.log(`  handwired vs original          : max ${quanta.max.toFixed(1)}  mean ${quanta.mean.toFixed(2)}  p99 ${quanta.p99.toFixed(1)}`)
console.log(`  relative, at |d| > ${REL_MIN} m (n = ${rel.length}) : max ${relMax.toExponential(2)}`)

const worst = rows.reduce((a, b) => (Math.abs(b.dhw - b.d0) > Math.abs(a.dhw - a.d0) ? b : a))
console.log(`\nworst point: (${worst.x.toFixed(4)}, ${worst.y.toFixed(4)}, ${worst.z.toFixed(4)})${worst.onSurface ? ' on the surface' : ''}`)
console.log(`  original ${worst.d0.toExponential(6)}  float32 ${worst.d32.toExponential(6)}  handwired ${worst.dhw.toExponential(6)}`)
console.log(`  |handwired - original| = ${Math.abs(worst.dhw - worst.d0).toExponential(3)} m, which is ${(Math.abs(worst.dhw - worst.d0) / QUANTUM).toFixed(1)} quanta`)

console.log(`\nsign of the field (inside vs outside)`)
console.log(`  handwired vs original: ${signFlips(r => [r.dhw, r.d0])} disagreements of ${rows.length}`)
console.log(`  float32   vs original: ${signFlips(r => [r.d32, r.d0])} disagreements of ${rows.length}`)
console.log(`\ntime: ${ms.toFixed(0)} ms for ${rows.length} evaluations (${(ms / rows.length).toFixed(2)} ms each)`)

const { writeFileSync, mkdirSync } = await import('node:fs')
mkdirSync('madhuban-morphology/out', { recursive: true })
writeFileSync(
  `madhuban-morphology/out/port-${species}.json`,
  JSON.stringify(
    {
      species,
      prims: prims.length,
      counts,
      operations: built.size,
      depth: built.depth,
      buildMs,
      points: rows.length,
      msPerEval: ms / rows.length,
      seedNoop,
      arith,
      f32Arith,
      inputQuant,
      hwVsF32,
      hwVsOrig,
      quantaMax: quanta.max,
      relativeMax: relMax,
      surface: { max: Math.max(...surfErr), mean: surfErr.reduce((s, t) => s + t, 0) / surface.length, n: surface.length },
      signFlipsHW: signFlips(r => [r.dhw, r.d0]),
      signFlipsF32: signFlips(r => [r.d32, r.d0]),
    },
    null,
    1,
  ),
)
console.log(`wrote out/port-${species}.json`)
