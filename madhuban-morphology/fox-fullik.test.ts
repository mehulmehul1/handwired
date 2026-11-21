// fox-fullik.test.ts — unit tests for Task 2.2: bilateral 4-leg FulliK IK solver & real stability margin

import { describe, it, expect } from 'bun:test'
import { solveFoxIK } from './fox-fullik.ts'
import { computeStabilityMargin } from './mass.ts'

describe('fox-fullik.ts IK solver & stability margin', () => {
  it('solves all 4 legs to ground plane y=0 with realistic hinge constraints', async () => {
    const result = await solveFoxIK({ h: 0.02, maxIter: 50, tolMm: 2.0 })

    expect(result.converged).toBe(true)
    const legNames = ['FL', 'FR', 'HL', 'HR'] as const

    for (const name of legNames) {
      const leg = result.solved[name]
      expect(leg).toBeDefined()
      expect(leg.bones).toBeGreaterThan(3)
      // Check convergence: each foot must be < 2.0 mm from the ground (y = 0)
      expect(leg.groundDistMm).toBeLessThan(2.0)
      expect(leg.converged).toBe(true)
      // End coordinates [x, y, z]: y must be within 2 mm of 0
      expect(Math.abs(leg.footEnd[1])).toBeLessThan(0.002)
    }
  })

  it('computes real stability margin from solved foot contact polygon', async () => {
    const result = await solveFoxIK({ h: 0.02, maxIter: 50 })

    const stance = result.stance
    expect(stance.hull.length).toBe(4) // 4 feet form a quad
    expect(stance.area).toBeGreaterThan(0.01) // > 100 cm² support polygon
    expect(stance.inside).toBe(true) // Center of mass projects inside hull
    expect(stance.margin).toBeGreaterThan(0.02) // At least 2 cm margin inside perimeter
    expect(Number.isFinite(stance.margin)).toBe(true)
  })

  it('real stability margin helper correctly separates standing from falling poses', () => {
    // 4 feet forming a 0.2m x 0.4m rectangle centered at [0, 0]
    const contacts = [
      [-0.1, -0.2],
      [0.1, -0.2],
      [0.1, 0.2],
      [-0.1, 0.2],
    ]
    // CoM at origin [0, 0.3, 0] is inside
    const insideRes = computeStabilityMargin(contacts, [0, 0.3, 0])
    expect(insideRes.inside).toBe(true)
    expect(insideRes.margin).toBeCloseTo(0.1, 3)

    // CoM outside at [0.15, 0.3, 0]
    const outsideRes = computeStabilityMargin(contacts, [0.15, 0.3, 0])
    expect(outsideRes.inside).toBe(false)
    expect(outsideRes.margin).toBeCloseTo(-0.05, 3)
  })
})
