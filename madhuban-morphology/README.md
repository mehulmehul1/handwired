# The Madhuban morphology latent

**Learn the anatomy of the animal cast, so the project can grow new creatures — and, one rung later,
the tradition's own hybrids (Ganesha, Garuda, Hanuman).**

This folder is a runnable proof that a **Handwired program can learn the morphology of all 17 quadruped
animals in `experiments/madhubani-animals`**, rebuild them from 8 numbers, generate *new* animals, and
blend two species into one. Every body is drawn as **mass-construction simple-shape SDFs** — a coarse
scaffold (three universal masses + tapered limb capsules), which is deliberately *not* the same thing as
the artist's hand-authored 96–956-prim sculpt. The muscle thickness is **measured off the artist's real
sculpted SDFs**, not invented. See *"The scaffold is not the animal"* below, which is the most important
paragraph in this file.

It runs headlessly in Bun. No browser, no three.js, no GPU needed to see the animals.

```
bun run madhuban-morphology/run.ts
```

---

## Why this is the right first rung

Handwired is the **decision / behaviour / placement layer**, never the renderer. Rendering stays
three.js + TSL. But "decide what a creature *is*" is exactly a decision-layer problem: it is a small,
exact, differentiable function from a **latent** to a **morphology**. That function is what this folder
builds and proves.

The load-bearing fact that makes it possible is already in the animal code: **every quadruped shares one
topology** (`quadrupedBones` in `src/core/rig/quadruped.js`). Wolf, cat, cheetah, dog, fox, lion,
horse, deer, goat, sheep, cow, pig, boar, bear, rabbit, rat and frog are the same bone list with
different joint numbers. So their skeletons live in one comparable space, and a latent over that space
is meaningful.

---

## What was built

| File | What it is |
|---|---|
| `species.ts` | Loads each species' **real** `rig.js` + `sculpt.js` headlessly (those modules import only `vec.js` / `eyeSocket.js` / `sdf.js` — no `three`). |
| `canonical.ts` | The **canonical morphology vector** and the thickness probe. |
| `masses.ts` | **Skeleton → body**: the mass-construction SDF (cranium, ribcage, pelvis, neck, four limbs, tail, ears). |
| `raymarch.ts` | A small **CPU SDF raymarcher** writing PNGs, in the Madhubani register (cream paper, warm 3-tone body, black ink outline). |
| `text.ts` | A 5×7 bitmap font, so contact sheets are labelled. |
| `latent.ts` | The two Handwired programs: **PCA equipped** and a **ReGLU autoencoder trained by backprop**. |
| `sample.ts` | The sampling-regime study (why wide Gaussians make monsters) → `out/07..10`. |
| `elephant.ts` | The **elephant loop**: propose a spec → grow a body → verify it → reject and revise. The three proposals are hand-written constants (`P1`, `P2`, `P3`); the reasoner is not code in this file. |
| `real-elephant.ts` | Renders the scaffold, the hand-sculpted elephant and the artist's cow together → `out/14`, `out/15`. |
| `look.ts` | Renders one large view of the sculpted elephant, for judging it up close. |
| `run.ts` | The whole run: extract → learn → generalise → grow → render → `out/report.json`. |
| `recon.ts`, `test-render.ts` | Reconnaissance and the geometric pipeline test. |

### The canonical vector — 115 numbers

```
| joints (30 × 3) | body thickness (12 stations × 2 axes) | log body length |  =  115 numbers
```

- **Joints** — one fixed list of joint names every quadruped has (`nose … tailBase`, jaw, one front
  limb, one hind limb, one ear, plus the tail resampled to 6 points). Left side only; the right mirrors.
- **Normalised by the animal's own body length**, so the shape dims are dimensionless and the *size*
  lives in the last number. The latent therefore learns **shape**, not scale.
- **Thickness** — at each of 12 skeletal stations we shoot a ray out from the medial axis until it
  leaves the body (`SDFModel.evalList`), in +X (lateral) and +Y (up). **This reads the artist's real
  muscles.** The mass model then uses those measured half-widths as the radii of its simple shapes.

### The mass-construction body

The three universal masses (cranium / ribcage / pelvis) plus a spine bridge give the torso; tapered
round cones give the neck, the four limbs, the tail and the ears. It is roughly 33 primitives per body
versus 96–956 in the artist's sculpt — a coarse but instantly recognisable creature. Thickness comes
from the latent (i.e. from the real SDF), and `06-muscle.png` shows it is fully controllable.

---

## Results (from `out/report.json`)

**Data.** 17 quadrupeds, 96–956 sculpt primitives each (the sheep's fleece is the 956).

**A. Equipped — PCA loaded into a Handwired affine program, zero training.**

| latent | variance explained |
|---|---|
| 4 | 96.7% |
| 8 | 98.2% |

Handwired evaluator vs the JS PCA reconstruction: **max abs diff 4.6 × 10⁻⁵** — the program *is* the
PCA, exactly. Mean per-joint reconstruction error: **4.88% of body length**.

**B. Unfrozen — a ReGLU autoencoder trained inside Handwired by backprop.**
10 043 parameters, 23 082 live ops, latent 8. Loss 27.5 → 0.26 in ~109 s on 102 samples. Handwired vs
the JS forward pass: **max abs diff 2.3 × 10⁻⁵**.

| program | mean joint error | standardised MSE |
|---|---|---|
| PCA (equipped) | **4.88%** | 0.231 |
| ReGLU AE (trained) | 5.62% | **0.149** |

**Honest reading of that table.** At 17 animals the manifold is **nearly linear** — 4 numbers already
keep 96.7% of the variance — so the optimal *linear* program (PCA) wins on per-joint error, while the
trained nonlinear program wins on standardised MSE (it spreads its capacity over thickness and size
too). Neither is a defeat: it says the shape space is low-dimensional and simple, which is *good news*
for a project that wants to sample it. The trained program matters because it is the substrate that
**scales and composes** — it is the same machinery that will later absorb a human, an elephant, and
extra heads.

**Generalisation — train on 12 species, reconstruct 5 it never saw.**

| held out | joint error | in metres |
|---|---|---|
| horse | 5.7% | 0.14 m |
| cow | 6.1% | 0.15 m |
| rat | 4.7% | 0.01 m |
| frog | 4.7% | 0.01 m |
| sheep | 6.6% | 0.08 m |

The program reconstructs a horse it was never shown to within ~6% of body length. That is the real
result: **the anatomy is learnable from the cast.**

**Novelty.** The 12 sampled "new individuals" sit a mean latent distance **4.33** from the nearest real
animal, while real animals sit **6.63** apart from each other — so the samples are genuinely new
morphologies *between* the training animals, not copies.

---

## The sheets (`out/`)

| Sheet | What it shows |
|---|---|
| `01-real.png` | All 17 quadruped species, rendered from the **artist's real sculpts**. |
| `02-reconstruct.png` | Columns: **real sculpt \| PCA reconstruction \| AE reconstruction**, 17 rows. |
| `03-novel.png` | 12 **new animals** sampled from the latent. |
| `04-blends.png` | 5 species pairs × 5 steps: dog↔cat, horse↔deer, **bear↔rat**, wolf↔fox, cow↔sheep. |
| `05-size.png` | Size ladder — size is latent (dog at −2σ…+2σ). |
| `06-muscle.png` | Muscle ladder — the SDF-derived thickness (dog at −2σ…+2σ: skeletal → stocky). |
| `07-sample-loose.png` | Why we saw "monsters": a wide Gaussian *off* the data manifold. |
| `08-sample-tight.png` | The same latent, sampled at ±1.5σ — real-looking individuals. |
| `09-litters.png` | 4 species × 4 litters: within-species variation, which is what a latent is *for*. |
| `10-extrapolate.png` | Pushing past ±2σ until it breaks — the edge of the manifold, made visible. |
| `11-elephant-loop.png` | The elephant **loop** as three hand-written proposals (`P1`, `P2`, `P3`): grown, verified, two rejected. The propose→grow→verify architecture is real; the proposer is not in the code. |
| `12-elephant-herd.png` | Six elephants from that loop, all passing the verifier. |
| `13-elephant-slot.png` | The elephant **slot**: adding the trunk chain + head frame to the bone list. |
| `14-real-elephant.png` | **Generic scaffold \| hand sculpt (3/4) \| hand sculpt (side) \| the artist's cow.** The whole point (see below). |
| `15-elephant-views.png` | The hand-sculpted elephant in the round: side, front-3/4, front, rear-3/4. |
| `look-side.png`, `look-front.png`, `look-q34.png` | Large single views (`bun run madhuban-morphology/look.ts side\|front\|q34`). |

`04-blends.png` is the point of the whole exercise: it is the **road to hybrids**. Slide wolf → fox and
the creature stays a canid; slide bear → rat and you cross a size and a body plan and get something in
between that still stands. A Ganesha is a morph between an elephant and a human, made with intent.

---

## The scaffold is not the animal

The single most useful thing this POC taught us, and it is worth stating plainly.

**The latent is a compression of real data. The mass builder is a generic estimate.** Those are two
different objects, and confusing them produces a wrong conclusion about the system's ceiling.

- The **skeleton data is real and per-species.** `quadrupedBones()` is a shared *topology*, but every
  species supplies its own joint numbers, measured from photographs. A horse's fetlock is not a cow's.
- The **latent** compresses *only* those 17 real skeletons (+ their thickness, measured by ray-casting
  the artist's actual sculpted SDFs). It is exact — it *is* a PCA/an autoencoder — and it can
  interpolate, individualise and morph **among the animals it was trained on**.
- The **builder** (`masses.ts`, mirroring `buildMasses`) is the coarse part: three universal ellipsoids,
  a spine bridge, tapered cones for limbs and ears. ~48 prims, and it has **no head anatomy, no real
  ears, no trunk, no hooves, legs that taper to a point**. The real animals are 96–956 prims of
  hand-placed, reference-measured sculpt.

So when an elephant grown by the loop "did not look like an elephant — wrong body, wrong head, no big
ears, tapering legs", that was **not** the latent failing and **not** a ceiling. It was the scaffold
doing exactly what it is: a generic quadruped estimate. The nuance lives in the sculpt.

### The proof: build the elephant properly, in the artist's own idiom

`experiments/madhubani-animals/src/species/elephant/{rig.js,sculpt.js}` is a real African bush elephant
(3.0 m at the shoulder) authored the same way as the cow/horse — not by a builder, by hand:

- a **real skeleton** — 10-joint trunk chain off the nose, a pitched head frame, ear landmarks, columnar
  fore/hind limbs;
- a **127-prim sculpt** — domed cranium, sloping face, heavy cheek, small deep-set eye, lower jaw;
  a tapering **trunk** column; four **tusks** arcing forward then up; legs that are **columns, not
  cones**, ending in broad flat pads ringed with toenails; a **big fan ear** as an exact slab (`m.fin`).

`14-real-elephant.png` puts it next to the scaffold and the artist's cow, all at matched scale in the
same renderer. The scaffold reads as "a generic quadruped". The sculpt reads as an elephant, in the same
register as the cow.

**The lesson for the project.** Handwired should carry the **decision** — *which* animal, *what*
proportions, *how* it is placed, *whether* it stands — and the **slot** (the bone list: add a trunk
chain, add hands, add a biped plan). The **nuance stays authored**, in `sculpt.js`, as the artist has
always done. When new anatomy is needed, the two honest moves are: author it (as above), or bring enough
real reference data that the latent can learn it. A latent cannot invent anatomy that is absent from
both its bone list and its data — and it should not be asked to.

---

## Honest limits

- **The mass body is a coarse renderer of the morphology, not the morphology itself.** The visual gap
  between the "real" and "reconstructed" columns is mostly the mass-construction stylisation (a long
  neck, chunky masses), not latent error. The latent error is the ~5% number; the look is the renderer.
  A real integration would feed the decoded joints back into the existing three.js/TSL `sculpt.js`, and
  the difference would shrink to the latent error alone.
- **17 data points.** The jitter variants are synthetic (small Gaussian warps), used only to define a
  local metric; they are not extra species. With more real animals (or `variation()` samples per
  species) the nonlinear program should pull ahead of PCA.
- **One body plan — 17 of the project's 24 species.** This covers `quadruped` only: cheetah, cat, deer,
  cow, boar, bear, dog, lion, rat, horse, goat, sheep, pig, fox, frog, rabbit, wolf. The other 7 are
  different bone lists — **bird** (crow, chicken, eagle), **swimmer** (fish, shark), **snake**,
  **spider** — and they need their own canonical vectors. This is the *same* reason an elephant, a
  monkey or a human isn't here: each is another bone list. A cross-plan latent needs a **growth
  grammar** (split a limb, add a segment, add a trunk) plus a plausibility loss.
- **No human yet, and the elephant is authored rather than learned.** The elephant now exists as a real
  hand-sculpted species (`species/elephant/`) — but it is *authored*, not yet absorbed into the latent,
  because the latent covers the `quadruped` bone list and an elephant needs a trunk chain on top of it.
  The human is a different body plan entirely (biped). Both are the two ingredients the tradition's
  hybrids need; the human's proportions are already researched (see the story doc §5.3).

---

## Next rungs

1. **Feed the decoded joints back into the real `sculpt.js`** → make the reconstruction gap pure latent
   error, in the actual three.js/TSL pipeline.
2. **Add the elephant's trunk chain and the human's biped plan to the bone list** (the *slots*), then
   search the latent *between* them → the first Ganesha. The elephant sculpt is now real, so the morph
   has a real body to land on.
3. **Train on `variation()` samples per species** instead of synthetic jitter, so "new individuals" are
   true to each species' own distribution.
4. **Determinism POC** — one seed → one creature → proven identical across runs/machines, edition-ready
   for fxhash.
5. Then the other rungs in `THE MADHUBAN STORY.md` §6: composition rules, behaviour, choreography,
   environment.

---

## Run it

From the `handwired` repo root:

```
bun run madhuban-morphology/recon.ts        # can we load the data? (fast)
bun run madhuban-morphology/test-render.ts  # geometry pipeline test → out/test-render.png
bun run madhuban-morphology/run.ts          # the whole thing → out/*.png + out/report.json
bun run madhuban-morphology/sample.ts       # the sampling-regime study → out/07..10
bun run madhuban-morphology/elephant.ts     # the elephant loop → out/11..13
bun run madhuban-morphology/real-elephant.ts # scaffold vs sculpt vs the artist's cow → out/14..15
bun run madhuban-morphology/look.ts side    # one large view of the sculpted elephant
```

No dependencies beyond Bun. The runtime imports are local TypeScript; the animal data is imported by
absolute path from `experiments/madhubani-animals/src`.
