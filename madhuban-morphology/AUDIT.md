# AUDIT — do the inherited animals hold up as animals, or are they decoration?

**Short answer: they are a coherent, consistent body family — not a simulation.** The cast is real
geometry at roughly animal scale, and every one of them that has feet stands up. But nothing in it was
designed to carry a load, and four specific things a creature system needs are simply not there: the
fore/hind weight split is wrong, the limb sizes are not load-driven, the birds have no wing, and there
is no material. They are excellent to use as a rig, a silhouette, a set of proportions, and a surface.
They are not usable as ground truth for physics.

Run it yourself:

```
bun run madhuban-morphology/audit.ts          # the measurements  -> out/audit.json, out/audit-log.txt
bun run madhuban-morphology/converge.ts       # the instrument check
bun run madhuban-morphology/aabb-test.ts      # the bounding-box check
```

---

## 1. What is actually being measured

The sculpt is a signed distance field, which is an exact inside/outside oracle. So volume, the centre of
mass, the footprint, the support polygon and the load split are **integrals of the geometry**, not
guesses. One density (1000 kg/m³) converts volume to a mass, and that is the only estimated number in
the whole table.

Two things follow, and they are worth being precise about:

- **"Does it stand" is a fact about the shape.** The centre of mass either projects inside the polygon
  made by the feet or it does not. No artist intent is required for that to be true or false.
- **"Is the weight split right" is a fact about the shape too**, and it can be compared against
  force-plate measurements of real animals.

Nothing here can tell you anything about **material, gait, or flight**, because those criteria do not
exist yet. Absent is not the same as failing, and every section below says which of the two it is.

---

## 2. What holds up

**Every animal with feet stands inside its own footprint. 20 of 21.** The only failure is the crow, at a
margin of −0.030 m — it leans 3 cm past its toes. The snake, spider, fish and shark have no stance to
test, so they are reported as n/a rather than as failures.

**The scale is animal scale.** 18 of 25 fall within 2× of a real adult's body mass. Sculpt units are
roughly metres. The three that are wildly off are the sheep (3.0× heavy — it is wearing a fleece of 846
primitives), the frog (10× heavy) and the crow (4.7× heavy).

**The centre of mass is one template.** Across 13 resolved quadrupeds it sits at **60.0% of body height,
spread 8.6%, range 0.478–0.684.** That is the single strongest piece of evidence in this audit about how
the cast was made: it is one body plan, parameterised.

Read against the alternative, that is exactly what you want from a *family* — a shared skeleton with
authored surfaces — and exactly what you do **not** want from a *derivation*. A body derived from load
would have a centre of mass that moves with the animal's mass distribution. This one does not move.

**The authored elephant checks out, and it is the only one that does.** 5939 kg against a real bull's
4000–6300 kg, 62% of the weight on the forelimbs against a real ~60%, a stability margin of 0.600 m,
and 82 kPa under the feet. It is the only body in the collection that was built from anatomy, and it is
the only body that agrees with the anatomy.

---

## 3. What does not hold up

### 3.1 The fore/hind weight split is wrong — 1 of 7 agrees

| animal | measured fore | real fore | error |
|---|---|---|---|
| cat | 68% | 60% | +8.3 pts |
| lion | 70% | 60% | +10.3 pts |
| dog | 67% | 60% | +6.8 pts |
| horse | 50% | 57% | −6.7 pts |
| cow | 47% | 55% | −7.9 pts |
| sheep | 49% | 55% | −6.3 pts |
| rabbit | 36% | 40% | −3.8 pts (agrees) |

The pattern is not random. **Every short-backed, front-heavy animal carries too much on its nose; every
long-backed animal carries too much on its rump.** That is the signature of a mass distribution copied
from a template rather than from the animal.

**But this is a hypothesis, not a verdict, and the audit cannot separate two explanations:**

1. **The mass is in the wrong place** — the torso sits too far forward or back over the feet.
2. **The feet are in the wrong place** — the sculpt's contact points are not where the real animal puts
   its feet, and the mass distribution is fine.

Both produce the same wrong number, because the number is a lever ratio about the centre of mass and it
depends on both. Separating them needs the joints: measure the limb attachment points from the rig and
compare the load path against the feet. That is Phase 1, item 3. Until then, the correct claim is
*"the load path through this body does not match a real one"*, not *"the artist put the mass wrong"*.

### 3.2 The limb sizes are consistent with load — which is not the same as load-driven

```
limb area ~ mass^0.749   r² 0.891   n = 13
limb load ~ mass^0.251   r² 0.477
constant-stress scaling predicts 0.667 and 0.333
```

The first fit lands near the law and the second does not. Two reasons to distrust the flattering one:

- **The elephant owns the fit.** It is the biggest lever by a factor of 7 in mass, and removing it (it
  is the one body that was authored, not inherited) drops the exponent to **0.65** with r² 0.76.
- **The load exponent is barely correlated (r² 0.48).** Bone stress is supposed to be near-constant
  across mammals. It is not constant here.

So the honest statement is: *the cast is consistent with limbs sized by load, and a single exponent
cannot tell you whether that was intended or whether it fell out of one body plan drawn at different
sizes.* Anyone who wants the stronger claim has to show it a different way — by perturbing a body and
watching whether the limbs respond, which is what the solver in the plan is for.

### 3.3 The birds have no wing in the data at all

The eagle's sculpt is 0.846 m across. Its wing arm reaches 0.381 m from shoulder to hand tip. A real
bald eagle's wingspan is **2.1–2.2 m**. The difference is not a modelling error — it is where the wings
are:

> *"contour feathers are part of the body shape; flight feathers are cards, see
> `core/build/featherCards.js`"* — `species/eagle/sculpt.js`

**The prim list is a body with a folded arm. The flight feathers are a separate card layer.** So span,
wing area, aspect ratio and wing loading — the four numbers any flight constraint needs — are not in the
sculpt, and no amount of measuring the sculpt will produce them. The eagle's mass is also 14 kg against
a real 5 kg, i.e. 2.8× heavy.

### 3.4 There is no material

Density is a tissue table keyed off primitive tags, and the tags are artist labels (`'ribcage'`,
`'trunk'`, `'hoof'`). That is a reasonable guess and it is the only guessed number in the audit. There
is no Young's modulus, no bone cross-section, no tendon, no muscle force, no joint limit. **Statics is
the entire physics content of the collection**, and it had to be built for this audit.

---

## 4. Where the instrument itself fails

This section exists because the first version of this audit was wrong, and the way it was wrong is
instructive.

Three defects were found and fixed while building it:

| defect | what it did | fix |
|---|---|---|
| Bounding **spheres** per primitive | every extent came out cubic — the fish read 0.77 m on all three axes | tight per-primitive boxes, checked against the SDF: **743 prims, 0 clipped** |
| Height counted only voxels *strictly inside* | the spider's height came back as −2,000,000,000 | count any occupied voxel |
| A coarse grid reported its numbers as data | the fish integrated to 0.05 kg and got printed as a finding | a per-body error bar, plus a refinement test |

The refinement test is the part worth trusting. The error bar is a worst case, and it turned out to be
**20–30× pessimistic**: it flagged the cat at 31% when re-measuring at half the step size moved the
volume by **0.9%**.

| body | bound said | actual change at h/2 |
|---|---|---|
| cat | 31% | +0.9% |
| fox | 26% | +1.9% |
| rabbit | 25% | +1.6% |
| crow | 34% | +1.4% |
| frog | 76% | +2.5% |
| cheetah | 24% | +0.9% |
| dog | 21% | +1.2% |
| wolf | 19% | +0.9% |
| **rat** | **54%** | **+5.2% — does not converge** |

So eight of nine are fine and the rat genuinely is not. The rows marked `~` in the log are approximate,
not junk; the rat's are junk.

Standing limits that remain:

- **Thin bodies are below the floor.** The default step is floored at 1 cm, and a fish's limbs are
  6 mm across. The fish and the snake are integrated at 1 cm and 3.3 cm; their limb and contact numbers
  mean nothing and are printed anyway, flagged.
- **An 8-million-cell budget coarsens extreme bodies.** A spider's bounding box is enormous next to its
  limb thickness. The budget keeps the run finite and reports the step it was forced to use — but a
  budgeted body cannot be refined, so its numbers are capped by the budget, not by the geometry.
- **The reference masses are literature values carried in memory, not cited this session.** Every
  comparison in section 3 is therefore a hypothesis until each number is replaced with a source. They
  are marked `firm` or `rough` in `audit.ts` to say how much weight they can carry, and none of them
  should become a gate before it is cited.

---

## 5. What this means for the plan

**Usable as:**

- a **rig** — real skeletons, 40–155 joints, per-species bone names
- a **silhouette and a set of proportions** — the shapes read as the animals they claim to be
- a **surface** — the authored sculpts carry the nuance the builder does not (limb section varies 70%
  around its mean, footprint 108%; that variation is the artists' work, not the skeleton's)
- a **coating** — 760 KB of motion and coat code, none of it physics
- a **test set** for anything that measures: 25 bodies, all of which load headlessly

**Not usable as ground truth for:**

- the load split between fore and hind (wrong 6 of 7, cause unresolved)
- limb sizing (the exponent cannot separate design from a template)
- flight geometry (the wing is not in the prim list)
- material, and therefore anything about strength, failure or gait

**The Phase 2 fork, decided here and not deferred:**

The cast eagle **cannot** be the wing reference for a wing-loading constraint. Its span is in a card
layer, its mass is 2.8× heavy, and its wing is in a perched fold. So Phase 2 does not start from the
cast's eagle. It starts from a **real eagle spec — 2.2 m span, real aspect ratio, wing loading
5–7 kg/m²** — parameterised directly, with the cast eagle kept as a rig and a visual target only.

That is the same move the plan already makes for the elephant, which was authored from anatomy rather
than inherited, and which is the only body in the audit that agreed with the animal it depicts. One
sample is thin evidence; it is also the only evidence available, and it points the same way both times.

---

## 6. Reproduction and honesty

`out/audit.json` holds every number, including the voxel step each one was taken at, the grid error
bound, the reference value and its confidence label. `out/audit-log.utf8.txt` is the console record.
`aabb-test.ts` and `converge.ts` are the two tests that make the instrument's claims checkable rather
than asserted.

What would change the conclusions:

- **Joint-based load paths** (Phase 1, item 3) would separate the two explanations for the fore/hind
  failure. Until then the section-3.1 verdict is one of two.
- **Cited reference masses** would turn section 3 from hypothesis into comparison.
- **A finer grid on the thin bodies** (or an analytic volume for cones and lenses) would recover the
  fish, snake and spider.
- **A posed wing** from the card layer would give a wing area, and only then would a flight constraint
  mean anything.
