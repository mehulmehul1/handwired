// fox-fullik.ts — fox rig mapped to FulliK IK, solved standing pose,
// validated against mass statics with real support polygon and margin.
// FulliK = geometry IK (FABRIK pose solver).

import { loadSpecies, type SpeciesId } from './species.ts'
import { measure, computeStabilityMargin, type Mass } from './mass.ts'
import * as FIK from './fullik/fik.module.js'

const { Bone3D, Chain3D, Joint3D, V3, J_BALL, J_GLOBAL } = FIK as any

export type LegSolved = {
  name: string
  bones: number
  solved: number
  distance: number
  footEnd: [number, number, number]
  groundDistMm: number
  converged: boolean
}

export type FoxIKSolution = {
  solved: Record<string, LegSolved>
  massData: Mass
  stance: {
    hull: number[][]
    area: number
    inside: boolean
    margin: number
  }
  converged: boolean
}

export function buildBone(J: Record<string, number[]>, name: string, headName: string, tailName: string): any {
  const h = J[headName] as number[]
  const t = J[tailName] as number[]
  if (!h || !t) throw new Error(`bone ${name}: missing ${!h ? headName : tailName}`)
  return new Bone3D(new V3(h[0]!, h[1]!, h[2]!), new V3(t[0]!, t[1]!, t[2]!))
}

export async function solveFoxIK(opt: { h?: number; maxIter?: number; tolMm?: number } = {}): Promise<FoxIKSolution> {
  const fox = await loadSpecies('fox' as SpeciesId)
  const J = fox.J
  const tolMm = opt.tolMm ?? 2.0

  const chainDefs = [
    { name: 'spine', bones: ['head', 'neck2', 'neck1', 'chest', 'spine3', 'spine2', 'spine1', 'pelvis'], isLeg: false },
    { name: 'FL', bones: ['scapulaL', 'humerusL', 'radiusL', 'metacarpusL', 'fpawL'], toe: 'ftoeL', isLeg: true },
    { name: 'FR', bones: ['scapulaR', 'humerusR', 'radiusR', 'metacarpusR', 'fpawR'], toe: 'ftoeR', isLeg: true },
    { name: 'HL', bones: ['femurL', 'tibiaL', 'metatarsusL', 'hpawL'], toe: 'htoeL', isLeg: true },
    { name: 'HR', bones: ['femurR', 'tibiaR', 'metatarsusR', 'hpawR'], toe: 'htoeR', isLeg: true },
    { name: 'earL', bones: ['earL'], isLeg: false },
    { name: 'earR', bones: ['earR'], isLeg: false },
    { name: 'jaw', bones: ['jaw'], isLeg: false },
  ]

  const chains: Record<string, any> = {}
  for (const def of chainDefs) {
    const c = new Chain3D()
    c.name = def.name
    for (const bName of def.bones) {
      const boneDef = fox.rig.BONE[bName as string]
      if (!boneDef) {
        console.warn(`SKIP bone ${bName}: not found in BONES`)
        continue
      }
      const b = buildBone(J, bName, boneDef.headJ, boneDef.tailJ)
      b.name = bName
      const dir = b.getDirectionUV()
      const rotAxis = new V3(1, 0, 0) // transverse / lateral flexion-extension axis
      const refAxis = dir.clone()
      refAxis.projectOnPlane(rotAxis)

      // Replace blanket 30° cone with realistic anatomical joint constraints:
      // Knee (tibia), hock (metatarsus), elbow (radius), carpus (metacarpus) are hinges
      if (bName.startsWith('tibia') || bName.startsWith('metatarsus') || bName.startsWith('radius') || bName.startsWith('metacarpus')) {
        b.joint.setHinge(J_GLOBAL, rotAxis, 75, 75, refAxis)
      } else {
        // Scapula, shoulder, hip, paws have ball joint freedom
        b.setBallJointConstraintDegs(60)
      }
      c.addBone(b)
    }
    chains[def.name] = c
  }

  // Ground targets on plane y = 0
  const legNames = ['FL', 'FR', 'HL', 'HR'] as const
  const targets: Record<string, [number, number, number]> = {
    FL: [J.ftoeL![0]!, 0.0, J.ftoeL![2]!],
    FR: [J.ftoeR![0]!, 0.0, J.ftoeR![2]!],
    HL: [J.htoeL![0]!, 0.0, J.htoeL![2]!],
    HR: [J.htoeR![0]!, 0.0, J.htoeR![2]!],
  }

  const solved: Record<string, LegSolved> = {}
  let allConverged = true

  for (const legName of legNames) {
    const c = chains[legName]
    const tgt = targets[legName]!
    const targetV3 = new V3(tgt[0], tgt[1], tgt[2])

    c.setSolveDistanceThreshold(0.0001)
    c.setMaxIterationAttempts(opt.maxIter ?? 50)
    const solveDist = c.solveForTarget(targetV3)
    const end = c.bones[c.bones.length - 1].end
    const groundDistMm = Math.abs(end.y) * 1000
    const converged = groundDistMm < tolMm
    if (!converged) allConverged = false

    solved[legName] = {
      name: legName,
      bones: c.bones.length,
      solved: c.numBones,
      distance: solveDist,
      footEnd: [end.x, end.y, end.z],
      groundDistMm,
      converged,
    }
  }

  // Real stability margin calculation:
  // Use the 4 solved feet contact points on ground (x, z)
  const contacts: number[][] = [
    [solved.FL!.footEnd[0], solved.FL!.footEnd[2]],
    [solved.FR!.footEnd[0], solved.FR!.footEnd[2]],
    [solved.HL!.footEnd[0], solved.HL!.footEnd[2]],
    [solved.HR!.footEnd[0], solved.HR!.footEnd[2]],
  ]

  const massData = await measure(fox.prims, { h: opt.h ?? 0.015 })
  const stance = computeStabilityMargin(contacts, massData.comTissue)

  return {
    solved,
    massData,
    stance,
    converged: allConverged,
  }
}

// ------------------------------------------------------------------ standalone runner
const fox = await loadSpecies('fox' as SpeciesId)
const { solved, massData, stance, converged } = await solveFoxIK({ h: 0.015 })

console.log('=== FOX FULLIK BILATERAL 4-LEG SOLVE ===')
for (const leg of Object.values(solved)) {
  console.log(`  ${leg.name}: end=[${leg.footEnd.map(v => v.toFixed(4)).join(', ')}] groundDist=${leg.groundDistMm.toFixed(3)} mm (converged: ${leg.converged})`)
}
console.log(`\nAll 4 feet converged (< 2.0 mm from ground): ${converged}`)
console.log(`Support polygon area: ${stance.area.toFixed(4)} m2 (${stance.hull.length} hull pts)`)
console.log(`Center of Mass (tissue): [${massData.comTissue.map(v => v.toFixed(3)).join(', ')}]`)
console.log(`Stability margin: ${stance.margin.toFixed(4)} m (${stance.inside ? 'STANDS' : 'FALLS'})`)

export { solved, massData, stance, converged, fox }
