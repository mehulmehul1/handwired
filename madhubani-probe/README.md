# Madhubani × Handwired probe

Answers one question with running code: **what happens if the Madhubani placement/material decisions are
made by a Handwired program instead of hand-written tables and `select()` cascades?**

Run it from the handwired repo root:

```
bun run madhubani-probe/probe.ts
```

## What the probe does

It builds a small numeric program with Handwired's four primitives (affine, ReGLU, clamp01, one-hot
argmax) that maps **anatomy → motif**, then checks two claims and one extension:

- **A. Equipped.** Hand-set coefficients reproduce `STYLE_ZONES.scallop.tiles` from
  `experiments/madhubani-animals/src/core/render/madhubani/zones.js` **exactly**, with no training.
  The Handwired evaluator is cross-checked against a plain-JS mirror of the same net on every logit.
- **B. Unfrozen.** Random coefficients, trained by `backpropagateReference` (+ Adam) toward a different
  target table (`kohbar`). Placement is *learnable*, not just writable.
- **C. Continuous field.** `spineT` (the 0..1 arc-length parameter already baked per vertex as
  `aMad1.w`) → four motif bands + one scale. Trained on a coarse grid, queried *between* the training
  points. This is a function of a body coordinate — something neither the table nor the cascade can
  express.

## Results (Bun 1.3.12, this machine)

```
source cells: 500 (492 params + 8 zone inputs)
scores program: 1552 live ops, 15 layers

A. Equipped  ->  8/8 zones exact, Handwired evaluator == plain JS on every logit
B. Unfrozen  ->  loss 1.13 -> 0.0000 in ~100 steps, 8/8 zones exact
C. Continuous -> 45 params, 60 live ops; mean scale error 0.0089 (0.9%);
                 off-grid band match 7/10
```

The three off-grid band misses in C are at the `floor(spineT*4)` step boundaries (0.25 and 0.45): a
piecewise-linear interpolation of a step function softens the step by one band exactly at the edge.
That is the honest limit, not a bug.

## Where Handwired actually fits Madhuban, and where it does not

### Fits (ranked by value)

1. **Placement as a differentiable program — the strongest fit.** The artist's own day-1 hypothesis
   (`Daily-Code/Madhuban/Madhuban.md`, 25 Sep) was *"train a neural net on not the images but the code
   output ... assign our coded elements to those categories."* Handwired is exactly that tool: it makes
   the placement program differentiable, so coefficients (zone→motif, band→filler, path→palette,
   per-species scale, per-seed variety) can be trained from a curated target or a story, then evaluated
   exactly. Experiment A proves the hand table *is* such a program; B proves it trains.

2. **Composition logic as a node graph.** The engine the log describes — frames, border decorators,
   fillers, meta operators (`selector`, `stagger`, `conditional`, `inherit`, `mask`), model synthesis /
   graph grammar, WFC tile choice, collision packing with grid lookup — is a graph of numeric decisions.
   Handwired's `emitArgmax` / one-hot / `indexRead` are built for tile selection and masked gathers, and
   the JSON-search demo is the pattern for "run a loop program over 100k items on the GPU" (packing).

3. **Recursive subdivision / frame layout / choreography.** HandwiredOS already demonstrates layout and
   frame-rate-independent motion computed by one program — the same shape as "recursive frames" and
   "instances move in rhythm on designated paths."

### Does not fit (say it out loud)

- **Do not rewrite the coat fragment shader.** It needs mipmapped texture filtering, screen-space
  derivatives (`fwidth`, for the ink line / band AA / seam), and the texture-unit gather. Handwired has
  index reads but no filtering and no derivatives. The atlas sampling, `ln()`, band and ink code must
  stay TSL.
- **Exactness is mostly irrelevant here.** A Madhubani painting tolerates approximation; Handwired's
  bit-exact FP32 selling point buys little. The relevant properties are **differentiability** and
  **GPU-parallelism**.
- **Overkill for a static table.** 1552 ops / 15 layers to replace an 8-entry lookup is absurd *unless*
  the target is not a table — i.e. learned from references, driven by a continuous body/story
  parameter, or varied per seed. That is exactly when it earns its keep.
