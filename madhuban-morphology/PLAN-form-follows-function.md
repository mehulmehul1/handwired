# PLAN — form follows function

**The program this plans:** make the machine *derive* a body part from a statement of what that part must
**do**, instead of copying one — and then compose derived parts onto a body to get the tradition's hybrids
(griffin, Ganesha, Hanuman, Garuda).

**Written after an adversarial review of the current work.** The review's verdict is load-bearing for the
plan's ordering: the measurement layer, which every later rung depends on, is one untracked, untested,
statics-only file, while the expensive commitments were being proposed first. The plan therefore front-loads
truth and the ruler, and defers every conversion until something needs it.

---

## 0. The target, stated so it can fail

**The claim to test.** A program can take a part's *job* — a specification of what it must do, in physical
quantities — and return a shape that does that job, without being shown the shape.

**The falsification (the acceptance test).** *Hide the answer, give the job.*

1. Take the **eagle**. Delete its wing from the data.
2. Hand the solver only what the eagle's wing must satisfy: body mass, cruise speed, the lift required, the
   joint positions it must attach to, the joint limits, and the material assumptions.
3. Let it search.
4. Compare the result to the real wing **on the measured criteria, never on appearance** (wing area, span,
   aspect ratio, wing loading, bone radius, section moments).

**Pass:** the derived wing satisfies the same criteria and lands within a stated tolerance of the real
eagle's numbers. **Fail:** it does not, or it only reproduces a stored wing. Both outcomes get written up.

This is the only test in this plan that can distinguish *understanding* from a lookup table, and it is
deliberately the cheapest rung that produces a real answer.

**Non-goals**, stated so they are not quietly smuggled in: bit-exact equality with `sdf.js` (impossible and
already measured); aesthetic judgement of the output; a fully certified aerodynamic design (the target is
*plausibility*, which is the tier evolution works at).

---

## Phase 0 — Make the ground true

Nothing later can be trusted while the foundation is untracked and unchecked. This phase is unglamorous and
is the one that pays for all of it.

- **Resolve every contradiction the review found**, in the folder that contains them: the 127-vs-131 prim
  count, the 33-vs-48 builder count, and the `elephant.ts` "LLM loop" framing (it is a hardcoded list and
  the file says "Nothing here is a neural net" — the README must say the same).
- **Commit `madhuban-morphology/` and `madhubani-probe/`.** They are currently `??`.
- **Bring both folders inside `bun run check`** (add them to the scope in `scripts/check.ts`) and inside
  `bun test`.
- **Write the tests that pin every published number**: the port's three-column deviation table, the
  determinism pair, the PCA-vs-circuit difference, the autoencoder forward-pass difference, and the mass
  figures. A table in a report that no test reproduces is a claim, not a measurement.
- **State in `out/` what is record and what is byproduct.**

**Exit criterion:** `bun run check` and `bun test` are green including the POC, and re-running the tests
reproduces the report's tables. Nothing in this plan starts before that.

---

## Phase 1 — The ruler

### What the audit already settled, before anything is built on the cast

`AUDIT.md` measured all 25 bodies (24 inherited + the authored elephant) from their signed distance
fields. Read it first. The short version, because it changes what Phase 1 is allowed to assume:

- **20 of 21 animals with feet stand inside their own footprint.** The crow misses by 3 cm. So statics
  is a real, already-satisfied constraint for this cast, not an aspiration.
- **Sculpt units are roughly metres** — 18 of 25 within 2× of a real adult's mass.
- **The centre of mass is one template**: 60.0% of body height, spread 8.6%, across 13 species. The cast
  is a *family*, parameterised, not a set of derived bodies.
- **The fore/hind load split is wrong in 6 of 7** animals that have a force-plate reference. The cause is
  *unresolved* — it could be where the mass sits or where the feet are — and item 3 (kinematics) is what
  separates them. Do not spend a solver on this until it is separated.
- **The allometric exponent is 0.75 with the elephant and 0.65 without it**, at r² 0.76 over the 12
  inherited bodies. That is consistent with load-driven limbs; it does not demonstrate them.

**The consequence for this phase:** the ruler is validated *against* the cast, which means the cast
cannot also be its ground truth. Where the audit found the cast wrong (load split, flight geometry), the
criterion has to be validated against **literature**, not against the animals.

### Measurement resolution is part of the result

Any criterion built on voxel integrals must carry the step size and the grid's own error bound with the
number. `converge.ts` shows why this matters in both directions: the error bound is 20–30× pessimistic
(the cat's bound said 31%, refinement moved it 0.9%), while the rat genuinely fails to converge at 5.2%.
Thin bodies (fish, snake, spider) are below the 1 cm floor and their limb numbers are junk. **A criterion
that cannot state its own uncertainty is not allowed to score a body.**

The plan needs a score function that is wider than statics. Build it first, because everything downstream is
a search against it.

Promote `mass.ts` to a first-class, tested measurement module, then add criteria **in order of cost**, each
one validated against the 25 real animals before it is trusted:

1. **Statics** — volume, mass, CoM, support polygon, limb load. *(exists; needs tests)*
2. **Structure** — strut stress under the measured load, buckling, a material assumption. Cheap, and it is
   where the bone-scaling laws first appear.
3. **Kinematics** — reachability, joint limits, range of motion, read from the rig that already declares
   them.
4. **Dynamics** — gait feasibility (duty factor, Froude number), landing and take-off loads.
5. **Aerodynamics** — quasi-steady flapping-wing lift/thrust (blade-element, textbook form), wing loading,
   **power available vs power required**. This is the criterion the flight questions actually need, and it
   is deliberately the reduced-model tier, not CFD.

**The validation that makes the ruler trustworthy:** every criterion must reproduce something already known
about the real animals — the eagle's wing loading, the fitted limb-load exponent near 1/3, which of the cast
can fly, and the size ceiling on flight. **A criterion that cannot rank the real animals correctly is not
allowed to score a derived one.**

**Exit criterion:** `out/criteria.json` for all 25 animals, plus a test asserting the known rankings.

---

## Phase 2 — The parameterisation (the real blocker)

The review is blunt about this and it is the single most important line in the plan: **there is no anatomy
space that reaches the sculpt.** The canonical vector covers joints and thickness for quadrupeds; the
`Spec` covers the scaffold. Neither parameterises the artist's 127 prims.

**Handwire the authors, not the outputs.** Convert the sculpt *functions* into parameterised circuits: a
`sculpt(params) → prims` where `params` are quantities an anatomist would name — segment lengths, joint
radii, muscle depth, bone radius, and for a wing: span, chord, camber, taper, feather count, sweep. The
current code bakes these as constants; they become inputs.

**Start with one part: the eagle's wing.** It is the right first part because the rig already names its
bones (`humerus{S} / ulna{S} / hand{S}`, group `wing{S}`) and the sculpt attaches by bone name, so the part
is already isolated structurally.

**Decision, taken in the audit and not deferred: the cast eagle is not the wing reference.** Its prim list
is a body with an arm folded along it — 0.846 m across, 0.381 m from shoulder to hand tip — while its flight
feathers live in a *separate card layer* (`core/build/featherCards.js`), by the source's own comment. Its
mass is 14 kg against a real 5. So span, area, aspect ratio and wing loading are not in the cast at all, and
measuring it harder will not produce them.

Therefore Phase 2 parameterises the wing from a **real eagle spec — 2.2 m span, real aspect ratio, wing
loading 5–7 kg/m²** — and keeps the cast eagle as a *rig and visual target*. The parameterisation is judged
against the real bird, not against the sculpture. This is the same move the elephant already made, and the
elephant is the one body in the audit that agreed with the animal it depicts.

**Exit criterion:** the parameterised wing reproduces the real eagle's wing inside the port's deviation
budget; a parameter sweep produces a measurable family; each instance passes Phase 1.

---

## Phase 3 — The solver

Search the Phase-2 parameters against the Phase-1 criteria.

- **Search: evolutionary / CEM first.** It matches the evolution analogy, it is robust to the dead gradients
  the review identified in the banded-sqrt ReLU clamps, and it needs no gradient contract.
- **Gradients: only where earned.** Handwired's autodiff exists and works (it is the house pattern in
  `src/learned-gallery/trainable-geometry.ts`), but the review's finding stands: the circuit's gradient is
  not the original function's gradient. Use it as a refiner with a measured check, never as the primary
  engine until ∂error/∂shape is measured.
- **Manufacture the evidence.** Vary the parameterised body thousands of times, measure each variant, and
  keep the scored set. This is the training data, and it comes from the ruler, not from more animals.

**Then run the Phase-0 acceptance test.** Hide the eagle's wing, give the job, and compare on criteria.

**Exit criterion:** the hide-the-answer result, pass or fail, committed with its numbers.

---

## Phase 4 — The griffin, derived

Only after Phase 3. This is where the answer to the question that started this stops being a prediction.

- Body: the lion (from the latent or the canonical vector). Wing: **re-derived at the lion's mass**, not the
  eagle's copied.
- Expected shape of the result, stated in advance so it can be contradicted: flight demands lightness, a
  keel, a rebuilt shoulder and a larger wing area than the eagle's; running demands sturdy legs and mass.
  The solver should return a **compromise**, and the interesting deliverable is the **trade-off curve** —
  how much lion survives as flight is demanded.
- **The honest framing, carried into any write-up:** evolution is not a clean optimiser, so a derived form is
  *plausible and functional*, not the true animal. The gap between derived and real is **information** about
  the pressures the original actually faced.

---

## Phase 5 — The negative control

**The insect wing on a lion.** Insect wings are membrane outgrowths with no bones, driven by thorax
deformation, in a viscous flow regime that exists only at tiny scale. If the ruler is real, the solver must
**refuse, or reinvent so completely that it is no longer an insect wing.** If it cheerfully produces one, the
criteria are wrong and Phase 3's result is worthless. **This phase is what makes the rest credible**, and it
is cheap.

---

## Phase 6 — Composition (the mosaic)

Cross-plan composition, and the first Ganesha.

- The **bone grammar**: variable structure, learned rules of assembly — add a limb, split a segment, choose
  wing-or-leg at the shoulder. The `extra` mechanism in `quadrupedBones` and the elephant's trunk chain are
  its seed: today a human writes the extra chain, tomorrow the model predicts it.
- **Sequence:** a hand-authored griffin **first**, as the worked example the grammar has to be able to
  express — the same move the elephant made for the trunk.
- **Distinguish the two honest options and pick deliberately:** a *superset skeleton with optional parts*
  gives hybrids from parts you already enumerated; a *grammar* learns the assembly rules. The first encodes
  the answer; the second learns it. The tradition is a composition system, so this is where the project's
  own goals actually live — griffin, Ganesha, Hanuman, Garuda, Narasimha, Matsya are all compositions of
  parts the cast already contains.

---

## Phase 7 — Unification, driven by need

**Convert the catalog to Handwired last, and only driven by what Phases 1–6 actually required.**

Handwired is **not required** for Phases 1–5: a solver can run in plain JS. What Handwired genuinely buys,
and the reason it is the right destination, is **unification** — one program, exact and deterministic, that
runs in the browser with the same numbers it was solved with, shipped as art. That is the argument for the
conversion; "it will make composition work" is not, and the review shows why.

---

## Cross-cutting: what the review forces us to keep honest

- **The measurement layer is the program.** If it is untracked and untested, nothing above it means
  anything. Phase 0 is not overhead.
- **The parameterisation is the blocker, not the architecture.** The architecture conversation was already
  resolved in the README before it was resolved in conversation. The thing that does not exist is the
  anatomy space.
- **Two bodies, one name.** Every result must say which body it is about: the artist's sculpt, or the generic
  scaffold. They are not interchangeable.
- **Predictions and results must not share a register.** Anything unmeasured is labelled unmeasured, in the
  doc as well as in the code.
- **Commit, test, then claim.** In that order, without exception.

## Decision gates — where to stop

- **If Phase 1's ruler cannot rank the real animals**, stop: no derived shape can be trusted.
- **If Phase 3's hide-the-answer test fails**, the honest report is that the ruler is insufficient — not a
  larger model. Do not proceed to Phase 4 on a failed acceptance test.
- **If Phase 5 produces a viable insect wing on a lion**, the criteria are wrong; return to Phase 1.
- **If Phase 0 is skipped**, none of the above is worth reading.

## What this plan deliberately does not do

- Does not promise novel organs. The cast, plus composition and variation of the cast, is the reachable
  band — and it happens to be exactly the band the tradition occupies.
- Does not port the motion layer, or the catalog, or the renderer.
- Does not claim bit-exactness with `sdf.js`.
- Does not treat the elephant as evidence for anything except that the measurement tool works and one
  authored sculpt is plausible.
