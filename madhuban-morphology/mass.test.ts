// mass.test.ts — unit tests pinning mass.ts ruler fixes (M-B1 to M-B6) & segmental mass properties

import { describe, it, expect } from 'bun:test'
import { measure, centroid, computeStabilityMargin, computeInertiaFromMoments, computeSegmentalMassProperties, type Mass } from './mass.ts'
import { sdfClass, loadSpecies, type Prim } from './species.ts'

describe('mass.ts ruler fixes', () => {
  it('M-B1: AABB origin-offset index shifting respects safety padding', async () => {
    const M = await sdfClass()
    const m = new M()
    // Sphere at origin
    m.sphere({ tag: 'ball', c: [0, 0, 0], rad: 0.5, k: 0 })
    const res = await measure(m.prims as Prim[], { h: 0.04 })
    const exactVol = (4 / 3) * Math.PI * (0.5 ** 3)
    // Should resolve with < 2% volume error
    expect(Math.abs(res.volume - exactVol) / exactVol).toBeLessThan(0.02)
    expect(res.voxels).toBeGreaterThan(0)
  })

  it('M-B2: TypeScript contract includes hRequested', async () => {
    const M = await sdfClass()
    const m = new M()
    m.sphere({ tag: 'ball', c: [0, 0, 0], rad: 0.2, k: 0 })
    const res: Mass = await measure(m.prims as Prim[], { h: 0.03 })
    expect(res.hRequested).toBe(0.03)
    expect(typeof res.hRequested).toBe('number')
  })

  it('M-B3 & M-B4: Up/down sign and minY offset in CoM reporting', async () => {
    const M = await sdfClass()
    const m = new M()
    // Place a sphere elevated at y = 1.0 (minY ~ 0.8, maxY ~ 1.2)
    m.sphere({ tag: 'bone', c: [0, 1.0, 0], rad: 0.2, k: 0 })
    const res = await measure(m.prims as Prim[], { h: 0.02 })
    expect(res.minY).toBeGreaterThan(0.7)
    expect(res.height).toBeCloseTo(0.4, 1)
    // Normalized height fraction with offset: (com[1] - minY) / height should be ~0.5
    const normH = (res.com[1]! - res.minY) / res.height
    expect(normH).toBeCloseTo(0.5, 1)
  })

  it('M-B5: Guard empty fore/hind centroid against NaN pollution or bogus numbers', () => {
    // Empty array must return [NaN, NaN]
    const cEmpty = centroid([])
    expect(Number.isNaN(cEmpty[0])).toBe(true)
    expect(Number.isNaN(cEmpty[1])).toBe(true)

    // Non-empty array returns accurate centroid
    const cNonEmpty = centroid([[1, 2], [3, 4]])
    expect(cNonEmpty[0]).toBeCloseTo(2, 5)
    expect(cNonEmpty[1]).toBeCloseTo(3, 5)
  })

  it('M-B6a: Ribcage tissue density accounts for air-filled lungs (350 kg/m³)', async () => {
    const M = await sdfClass()
    const m = new M()
    m.sphere({ tag: 'ribcage', c: [0, 0, 0], rad: 0.3, k: 0 })
    const res = await measure(m.prims as Prim[], { h: 0.02 })
    const ribcageTissue = res.tissues.find((t) => t.name === 'ribcage-lungs')
    expect(ribcageTissue).toBeDefined()
    // Mass should be based on 350 kg/m³, so totalMassKg = volume * 350
    expect(res.totalMassKg).toBeCloseTo(res.volume * 350, 1)
  })

  it('M-B6b: Second-moment inertia tensor satisfies SPD and triangle inequality', () => {
    const mass = 10.0
    const com = [0.1, 0.2, 0.3]
    const h = 0.01
    // Sample moment accumulators for a solid distribution
    const sxx = 1.5, syy = 2.0, szz = 2.5
    const sxy = 0.1, sxz = -0.05, syz = 0.08
    const I = computeInertiaFromMoments(mass, com, sxx, syy, szz, sxy, sxz, syz, h, 1000)

    // 1. Symmetry
    expect(I[0]![1]).toBeCloseTo(I[1]![0]!, 6)
    expect(I[0]![2]).toBeCloseTo(I[2]![0]!, 6)
    expect(I[1]![2]).toBeCloseTo(I[2]![1]!, 6)

    // 2. Positive-definite diagonal elements
    const [Ixx, Iyy, Izz] = [I[0]![0]!, I[1]![1]!, I[2]![2]!]
    expect(Ixx).toBeGreaterThan(0)
    expect(Iyy).toBeGreaterThan(0)
    expect(Izz).toBeGreaterThan(0)

    // 3. Triangle inequality
    expect(Ixx + Iyy).toBeGreaterThanOrEqual(Izz)
    expect(Ixx + Izz).toBeGreaterThanOrEqual(Iyy)
    expect(Iyy + Izz).toBeGreaterThanOrEqual(Ixx)

    // 4. Principal minors (Sylvester's criterion for SPD)
    const det2 = Ixx * Iyy - (I[0]![1]!) ** 2
    expect(det2).toBeGreaterThan(0)
    const det3 =
      Ixx * (Iyy * Izz - (I[1]![2]!) ** 2) -
      I[0]![1]! * (I[0]![1]! * Izz - I[0]![2]! * I[1]![2]!) +
      I[0]![2]! * (I[0]![1]! * I[1]![2]! - I[0]![2]! * Iyy)
    expect(det3).toBeGreaterThan(0)
  })

  it('M-B6c: Small animal adaptive voxel step allows h < 0.01m', async () => {
    const M = await sdfClass()
    const m = new M()
    // Rat-scale creature: 0.15m length
    m.sphere({ tag: 'skin', c: [0, 0, 0], rad: 0.075, k: 0 })
    // bodyLen = 0.15, bodyLen / 110 = ~0.00136 -> clamped to 0.0025 m
    const res = await measure(m.prims as Prim[])
    expect(res.hRequested).toBeLessThan(0.01)
  })

  it('computeSegmentalMassProperties exports valid segmental mass and SPD inertia per bone', async () => {
    const fox = await loadSpecies('fox')
    const segProps = await computeSegmentalMassProperties(fox, fox.rig, { h: 0.02 })

    expect(segProps.totalMassKg).toBeGreaterThan(5)
    expect(segProps.totalMassKg).toBeLessThan(20)
    expect(segProps.com.length).toBe(3)
    expect(segProps.segments.length).toBeGreaterThan(10)
    expect(Number.isFinite(segProps.restingForeHindSplit)).toBe(true)

    // Verify every segment
    for (const seg of segProps.segments) {
      expect(seg.boneName.length).toBeGreaterThan(0)
      expect(seg.massKg).toBeGreaterThan(0)
      expect(seg.localCom.length).toBe(3)
      const I = seg.inertia3x3
      const [Ixx, Iyy, Izz] = [I[0]![0]!, I[1]![1]!, I[2]![2]!]

      // Symmetry
      expect(Math.abs(I[0]![1]! - I[1]![0]!)).toBeLessThan(1e-7)
      expect(Math.abs(I[0]![2]! - I[2]![0]!)).toBeLessThan(1e-7)
      expect(Math.abs(I[1]![2]! - I[2]![1]!)).toBeLessThan(1e-7)

      // Positive definite
      expect(Ixx).toBeGreaterThan(0)
      expect(Iyy).toBeGreaterThan(0)
      expect(Izz).toBeGreaterThan(0)

      // Triangle inequality
      expect(Ixx + Iyy + 1e-9).toBeGreaterThanOrEqual(Izz)
      expect(Ixx + Izz + 1e-9).toBeGreaterThanOrEqual(Iyy)
      expect(Iyy + Izz + 1e-9).toBeGreaterThanOrEqual(Ixx)
    }
  })
})
