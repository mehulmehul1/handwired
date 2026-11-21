// Load every quadruped's real rig + sculpt, headlessly. Nothing here needs `three`: the rig and
// sculpt modules import only vec.js / eyeSocket.js / sdf.js, which are pure.

import { pathToFileURL } from 'node:url'

export const SRC = 'C:/Users/mehul/OneDrive/Desktop/Studio/KnowledgeBase/experiments/madhubani-animals/src'

// Every species whose `index.js` declares plan: 'quadruped' — they all share quadrupedBones().
export const SPECIES = [
  'boar', 'bear', 'cat', 'cheetah', 'cow', 'deer', 'dog', 'fox', 'frog', 'goat',
  'horse', 'rabbit', 'lion', 'pig', 'rat', 'wolf', 'sheep',
] as const
export type SpeciesId = (typeof SPECIES)[number]

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)
const load = (p: string) => import(pathToFileURL(p).href)

export type Prim = {
  type: number
  P: Float64Array
  k: number
  bone?: string
  group: string
  part: string
  carve: boolean
  tag: string
  bias: number
  id: number
}

export type Rig = {
  J: Record<string, number[]>
  unit: number
  headOrigin: number[] | null
  BONES: any[]
}

let SDFClass: any
export async function sdfClass(): Promise<any> {
  if (!SDFClass) SDFClass = (await load(`${SRC}/core/sdf/sdf.js`)).SDFModel
  return SDFClass
}

export type Loaded = { sp: SpeciesId; rig: Rig; J: Record<string, number[]>; prims: Prim[] }

export async function loadSpecies(sp: SpeciesId): Promise<Loaded> {
  const rigMod: any = await load(`${SRC}/species/${sp}/rig.js`)
  const rig: Rig = rigMod[`${sp}Rig`]()
  if (!rig?.J) throw new Error(`${sp}: ${sp}Rig() returned no joints`)
  const sculptMod: any = await load(`${SRC}/species/${sp}/sculpt.js`)
  const sculpt = sculptMod[`sculpt${cap(sp)}`]
  if (!sculpt) throw new Error(`${sp}: no sculpt${cap(sp)} export`)
  const M = await sdfClass()
  const m = new M()
  sculpt(m, rig)
  return { sp, rig, J: rig.J, prims: m.prims as Prim[] }
}

export async function loadAll(): Promise<Loaded[]> {
  const out: Loaded[] = []
  for (const sp of SPECIES) out.push(await loadSpecies(sp))
  return out
}
