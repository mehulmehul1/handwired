// Pipeline test: for a few species, render the artist's real sculpt and, beside it, the
// mass-construction body rebuilt from the canonical vector (round-tripped through vectorize).
// If these match, the canonical vector and the mass system are sound.
//
//   bun run madhuban-morphology/test-render.ts

import { loadSpecies, type SpeciesId } from './species.ts'
import { vectorize, unvectorize, DIM } from './canonical.ts'
import { buildMasses } from './masses.ts'
import { initRaymarch, renderOne, makeCamera, sheet, encodePNG } from './raymarch.ts'

await initRaymarch()

const PICK: SpeciesId[] = ['wolf', 'horse', 'cow', 'frog', 'rat', 'sheep']
const W = 220
const H = 165
const tiles: { rgba: Uint8Array; w: number; h: number }[] = []

for (const sp of PICK) {
  const t0 = performance.now()
  const { J, prims } = await loadSpecies(sp)
  const { vec } = await vectorize(J, prims)
  const back = unvectorize(vec)
  // round-trip check: the canonical vector's joint block must reproduce the rig's joints exactly
  let rtErr = 0
  for (const name of Object.keys(back.J)) {
    if (!J[name]) continue
    for (let k = 0; k < 3; k++) rtErr = Math.max(rtErr, Math.abs((back.J[name]![k] ?? 0) - (J[name]![k] ?? 0)))
  }
  const massPrims = await buildMasses(back.J, back.thickness, back.size)

  // real sculpt
  const camReal = makeCamera(prims, { az: 0.08, el: 0.1, w: W, h: H, zoom: 1.02 })
  const rReal = renderOne(prims, camReal, W, H)
  // mass body
  const camMass = makeCamera(massPrims, { az: 0.08, el: 0.1, w: W, h: H, zoom: 1.02 })
  const rMass = renderOne(massPrims, camMass, W, H)

  tiles.push(rReal, rMass)
  console.log(
    `${sp.padEnd(8)} prims real ${String(prims.length).padStart(4)}  mass ${String(massPrims.length).padStart(3)}  ` +
      `bodyLen ${back.size.toFixed(3)}m  joint round-trip err ${rtErr.toExponential(1)}  ${(performance.now() - t0).toFixed(0)}ms`,
  )
}

const sh = sheet(tiles, 2)
await Bun.write('madhuban-morphology/out/test-render.png', encodePNG(sh.w, sh.h, sh.rgba))
console.log(`\nwrote madhuban-morphology/out/test-render.png  (${sh.w}×${sh.h})  columns: real | masses`)
