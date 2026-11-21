# Can `experiments/madhubani-animals` be ported to Handwired, line for line?

**Short answer: no — and the question that matters has a different answer, which is yes.**

No literal line-for-line port is possible: Handwired has **no tool that converts JavaScript source into a
program** (`docs/README.md`), and most of the repository is not arithmetic at all — it is data
constructors, palettes, string tables, a mesh builder, a three.js/TSL renderer and five motion engines.

But the part that *is* a computation — **the numeric spine, `SDFModel.dist` + `evalList` and the four
primitive types** — ports **exactly**, and this folder now contains the proof: the elephant's full
**127-primitive** sculpt ported 1:1 into one Handwired circuit, evaluated end-to-end, and diffed against
the original over 1 600 seeded points plus a per-primitive sweep of all 127.

| | |
|---|---|
| the port | 127 prims (82 ell, 43 cone, 2 fin, 0 carvers) in **one circuit** |
| program | **84 582 operations**, depth 5 317, built in **0.45–0.68 s** |
| speed | **1.2–2.1 ms per evaluation** (CPU, in JS) |
| sign of the field | **0 disagreements of 1 600** — inside/outside never flips |
| on the surface | **max 1.6 × 10⁻⁷ m**, mean 3.4 × 10⁻⁸ m |
| everywhere | max **6.0 × 10⁻⁷ m** = **5.1 float32 quanta**, mean 0.66 quanta |
| the `d = 1e9` seed | dropped in the circuit, and **verified** a no-op rather than assumed |

Repeat it with:

```
bun run madhuban-morphology/port.ts elephant          # → out/port-elephant.json, out/port-log.txt
bun run madhuban-morphology/port.ts debug elephant     # per-primitive sweep of all 127
bun run madhuban-morphology/port.ts debug-bands        # the banded sqrt on its own, no primitive near it
bun run madhuban-morphology/port.ts elephant --no-floor # the pre-fix floor, for the before/after below
```

The sweep is **seeded** and the references are evaluated at the same float32 coordinates the circuit
receives. Both matter, and both were earlier mistakes: an unseeded sweep made `max` a random variable
that moved by an order of magnitude between runs of the *same* build, and comparing a float32 circuit
against a reference at exact float64 coordinates charges the port for the input format.

---

## What "port a line" can mean

Handwired is a dataflow circuit over float32 wires. Its **exact** operations are `+`, `−`, `×` (with a
non-negative factor), `min`/`max`, compare, select and hash. Its **inexact** operations are division,
square root and reciprocal, each roughly 1.5 × 10⁻⁷ relative. It has no early return, and every wire is
evaluated on every run.

That produces three categories, and every line of the repository falls into one:

1. **Arithmetic** — ports, and this is what `port.ts` does.
2. **Data** — a number, a colour, a name, a primitive layout. A port means *quoting it*, not translating
   it. `sculpt.js` and `rig.js` are already data; the circuit consumes them as such, and the circuit for
   the elephant is built from the artist's own arrays with nothing edited.
3. **Host-side code** — object construction, the mesh builder, the renderer, animation. This is outside
   the circuit *by design*, not by limitation. Rendering deliberately stays three.js/TSL.

So "1:1" is a well-formed demand for category 1, a category error for category 2, and the wrong frame for
category 3.

---

## Module by module

| Module | What it is | Portable? | Status |
|---|---|---|---|
| `core/sdf/sdf.js` | `dist`, `polySD`, `evalList`, the four prim types | **Yes — arithmetic** | **Ported 1:1.** 127/127 prims, one circuit, end-to-end. The subject of this report. |
| `species/*/sculpt.js` | the artist's hand-authored prim lists, 96–956 per animal | **As data** | **Consumed directly.** Both the elephant's sculpt and its rig are loaded and quoted into the circuit unmodified. |
| `species/*/rig.js` | the skeleton, per species, measured from photographs | **As data** | **Consumed directly.** Real numbers, not an estimate. |
| `species/*/variation(R,o)` | a per-species random transform | **Yes — arithmetic** | All 24 species have one. Trivially portable; not yet wired in. |
| `core/build/pipeline.js` | the build chain; `pipeline.js:143` is the only size knob | **Partly** | The arithmetic is trivial; the rest is orchestration and object construction, which belongs in JS. |
| `core/build/*` | the generic mass builder (three masses + tapered limb capsules, ~48 prims) | **Yes — arithmetic** | Portable, but it is *not* what this POC needs: the elephant is authored, and `masses.ts` already mirrors it. |
| `core/motion/*` | **5 motion engines** | **Probably — untried** | Pose/matrix arithmetic: a new surface, not yet attempted. This is the next real question. |
| `core/render/*` + three.js/TSL | the renderer | **No — by design** | Stays where it is. Handwired is the decision layer, never the renderer. |
| palettes, names, string tables | pure data | **Not applicable** | Quoted if needed, never translated. |

The gap between "the repo is 24 species" and "the port is one species" is therefore **not** a gap in
portability — it is repetition. The loader and all four prim types are generic, so each further animal is
a run and a spot-check. The real variance is whether another species hides a construct like the tapered
`fin`, which is what cost a whole session on the elephant.

---

## The deviation table

Every column below is measured, on the same seeded 1 600-point sweep, with all references evaluated at
the same float32 coordinates the circuit is given. Splitting the columns is the whole point: summing them
into one number charges the port for the input format.

| what is being measured | max | mean | p99 |
|---|---|---|---|
| **port arithmetic** — `handwired − float64`, same inputs | 5.03 × 10⁻⁷ | 6.96 × 10⁻⁸ | 3.38 × 10⁻⁷ |
| **float32 arithmetic** — `float32 − float64`, same inputs | 3.41 × 10⁻⁷ | 4.95 × 10⁻⁸ | 2.43 × 10⁻⁷ |
| **input quantisation** — `float64@f32 − float64` | 2.20 × 10⁻⁷ | 3.46 × 10⁻⁸ | 1.89 × 10⁻⁷ |
| **the total a render sees** — `handwired − original` | **6.05 × 10⁻⁷** | 7.92 × 10⁻⁸ | 3.85 × 10⁻⁷ |

Read against float32's own quantum (2⁻²³ = 1.19 × 10⁻⁷ m, its spacing at 1 m): **max 5.1 quanta, mean
0.66, p99 3.2.** Relative error above |d| > 0.1 m: max 8.06 × 10⁻⁷.

**On the surface** — the only region a raymarcher resolves — **max 1.61 × 10⁻⁷ m, mean 3.39 × 10⁻⁸ m**,
which is 1.4 and 0.28 quanta.

**And the port's arithmetic sits between a plain float32 re-implementation and the float64 truth:**
5.03 × 10⁻⁷ against the reference's 3.41 × 10⁻⁷. Both are 1–4 quanta. The port is not
*more* accurate than a hand-written float32 implementation, and it is not meaningfully less.

### The four sources of deviation

1. **float32 instead of the original's float64.** Irreducible, and the largest single term. Measured: the
   float32-arithmetic column, 3.41 × 10⁻⁷ max.
2. **float32 input coordinates.** The circuit's input is a `Float32Array`, so it *cannot* be handed more
   precision than float32 — while a reference written in JavaScript gets the exact float64 coordinates.
   At a point 10⁻⁴ from a primitive's own centre, float32's grid at that magnitude is a 10⁻³ relative
   perturbation of the offset. Measured: up to 2.69 × 10⁻⁴ per primitive near a centre; 2.20 × 10⁻⁷
   aggregate. **No float32 circuit can avoid this**, and a float32 re-implementation carries exactly the
   same term.
3. **The banded square root and reciprocal the original does not have.** The library's `emitSqrt` is
   accurate on `[minimumPositive, maximum]` and caps `maximum/minimumPositive` at 2²², so the port builds
   sqrt from 22-octave bands, each handing the library an argument inside its own well-conditioned
   window. This is a disclosed substitution: it is *not* the original's arithmetic, and where a band's
   argument falls below its floor the result decays. Confined to the medial-axis tubes — see below.
4. **The ≤ 1 ulp clamp substitution** used to bound each band's argument (`a + relu(k − a)` rather than a
   full comparison cascade), and the fact that `min(a, k) = k − relu(k − a)` cancels catastrophically
   when `a ≪ k`, so every clamp is written from `a` outward. Disclosed at the definitions.

### Per primitive

A uniform box sweep is a poor instrument: it **almost never land on a primitive's medial axis**, which is
exactly where a banded square root is weakest, because its argument goes to zero there. The earlier
"all 127 primitives near the float32 floor" reading was an artefact of that — the sweep simply was not
looking. The debug sweep now probes the axis directly, on top of the uniform samples:

| kind | n | total max | port arithmetic max | input quantisation max |
|---|---|---|---|---|
| ell | 82 | 3.15 × 10⁻⁴ | 9.30 × 10⁻⁵ | **2.69 × 10⁻⁴** |
| cone | 43 | 1.06 × 10⁻⁴ | **1.06 × 10⁻⁴** | 9.1 × 10⁻⁸ |
| fin | 2 | 3.54 × 10⁻⁵ | 3.53 × 10⁻⁵ | 9.7 × 10⁻⁸ |

Two different failure modes, and the columns separate them:

- **The ellipsoid** is dominated by *input quantisation* (2.69 × 10⁻⁴ of its 3.15 × 10⁻⁴). At a point
  10⁻⁴ from an ellipsoid's centre the field is a 0/0-type ratio — `k0(k0−1)/k1` with both `k0` and `k1`
  going to zero — so it is exquisitely sensitive to the input. The float64 value at float32 coordinates
  differs from the value at exact coordinates by 2.69 × 10⁻⁴, and a float32 re-implementation carries
  **precisely the same term** (measured: its error against the exact-coordinate original is identical to
  the port's, to three digits). The port's own arithmetic share is 4.6 × 10⁻⁵.
- **The cone** is *pure arithmetic* (1.06 × 10⁻⁴, input quantisation only 9.1 × 10⁻⁸). At the apex
  `x2 = 5.1 × 10⁻¹¹`, far below the band floor — the sqrt argument genuinely reaches zero on the axis, so
  no floor derived from an upper bound over the box can cover it.

**How big is the region?** The argument falls below the floor only when `|v| < 1.25 × 10⁻⁴ m` — so the
failing set is a **0.125 mm-radius tube around each primitive's medial axis, inside the body**, where the
field reads ≈ −0.2. It does not touch the surface: the surface column above is the measurement of that
claim. For a raymarcher, which stops where `d ≈ 0`, the level set is displaced by at most
`error/|∇d| ≈ 10⁻⁴ m` — 0.1 mm on a 3 m animal — and the sign never flips.

### The fix that landed, measured

The port's remaining cone error was a **one-line contract violation**, not an algorithm problem.
`emitSqrt` is accurate only above the `minimumPositive` it is promised, and takes that from `options`
only when the band's declared range starts at zero — which band 0's does, deliberately, so a genuine zero
stays zero. The port was passing the **global** `SQRT_MIN = 2⁻²⁰` there, while the library allows
`maximum/2²²`. Band 0's declared maximum is `min(SQRT_MAX, maxArg)`, so deriving the floor from it lifts
the floor by up to 2²².

Same seeded sweep, same axis probes, one flag apart:

| kind | pre-fix total max | post-fix total max | pre-fix mean | post-fix mean |
|---|---|---|---|---|
| cone | 8.47 × 10⁻³ | **1.06 × 10⁻⁴** | 1.91 × 10⁻³ | **6.69 × 10⁻⁵** |
| ell | 3.15 × 10⁻⁴ | 3.15 × 10⁻⁴ | 2.48 × 10⁻⁵ | 2.48 × 10⁻⁵ |
| fin | 3.54 × 10⁻⁵ | 3.54 × 10⁻⁵ | 3.47 × 10⁻⁵ | 3.47 × 10⁻⁵ |

**80× better on the cone's worst case, 28× on its mean**, for +1 992 operations (2.4 %) and no measurable
speed cost. The ell and fin are unchanged, correctly: they do not take that path. On the full sweep it
also tightened the surface band from 5.43 × 10⁻⁷ to 1.61 × 10⁻⁷.

The earlier plan was to extend the ladder to negative band indices. The read of
`numeric-library/arithmetic.ts` showed that was both unnecessary and worse: extra bands need comparison
gates below the compare's resolution, where a mis-selected band costs a factor of 2²². Deriving the floor
from the band's own declared maximum needs no new gates at all.

---

## What this does and does not establish

**It establishes:** the numeric spine of the artist's own code runs as a Handwired circuit, exactly in
structure, at the float32 floor where it matters, with zero sign decisions changed, from the artist's
unmodified data. A 1:1 port of that spine is not a hypothesis — here it is, with its error measured.

**It does not establish** that the whole repository ports, and nothing here claims it. Specifically
untested: the **5 motion engines** (pose and matrix arithmetic — a new surface), the **other 23 species**
(mechanical, but each may hide a construct like the tapered `fin`), and the **build pipeline's**
orchestration, which is host-side code by design.

**It does not claim bit-exactness.** That is impossible by construction — float32 against the original's
float64, banded square roots and reciprocals the original does not have, and a disclosed ≤ 1 ulp clamp.
The deliverable is the measured table above, not an assertion of equality.

---

## Honest limits

- **One species, one body plan, static.** 127 prims of one sculpt. The remaining 23 species and all five
  motion engines are untried.
- **The circuit runs on the CPU, in JS.** 1.2–2.1 ms per evaluation for one animal is a real budget: fine
  for a few thousand samples, not for a real-time raymarch of a herd. The port's value is that the
  morphology becomes an exact, differentiable, *solvable* object — not that it is fast.
- **The medial-axis tubes are a known, disclosed defect**, not a closed issue. If it is ever worth
  closing, the fix is to stabilise the norm rather than add bands: `|v| = max(|vx|,|vy|,|vz|) ·
  sqrt(1 + (rest/max)²)` puts the sqrt argument in `[1, 2]`, a bounded and well-conditioned range, at the
  cost of a division and a compare. That is a change of algorithm, not of port, so it is a deliberate
  decision rather than a bug fix — and at 0.1 mm inside the body, it is currently below the threshold
  where it is worth making.
- **Everything in this report is uncommitted local work.**

---

## Reproducing the numbers

| file | what it holds |
|---|---|
| `port.ts` | the 1:1 port, the three-column diff harness, `debug` / `debug-bands` / `--no-floor` modes |
| `out/port-elephant.json` | the aggregate result, machine-readable |
| `out/port-log.txt` | the full run's console output |
| `out/port-debug.txt` | the per-primitive sweep of all 127, with the float64 intermediates at each worst point |
| `out/port-debug-nofloor.txt` | the same sweep with the pre-fix floor, for the before/after |
| `out/port-run-a.txt`, `out/port-run-b.txt` | two runs of the same build, byte-identical — the determinism check |

The three-column harness is the instrument that makes this answerable. `debug elephant <n>` prints, for
any primitive, the port's value, the float32 reference, the float64 original at both the exact and the
float32 coordinates, and every tapped intermediate — which is how the fin's index bug (`−2259` where a
radius belonged), the cone's arm decision, and the sqrt floor were each located rather than guessed at.
