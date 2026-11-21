// A small CPU SDF raymarcher, in the Madhubani register: cream paper, a warm three-tone body and a
// black ink outline. It renders any list of SDFModel primitives, so the same code draws the artist's
// real sculpt and the mass-construction bodies a decoded morphology produces.

import zlib from 'node:zlib'
import { Buffer } from 'node:buffer'
import { sdfClass, type Prim } from './species.ts'

export type Vec3 = [number, number, number]

const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]
const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!]
const norm = (a: number[]) => {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!) || 1
  return [a[0]! / l, a[1]! / l, a[2]! / l]
}

const PAPER: Vec3 = [243, 234, 214]
const TONES: Vec3[] = [
  [150, 58, 38],
  [196, 96, 58],
  [232, 156, 104],
]
const INK: Vec3 = [38, 28, 22]

// Bounding sphere of a primitive, read from P (T_ELL=0, T_CONE=1, T_LENS=2, T_FIN=3).
export function bounds(p: Prim): { c: number[]; r: number } {
  const P = p.P
  if (p.type === 0) return { c: [P[0]!, P[1]!, P[2]!], r: Math.max(P[12]!, P[13]!, P[14]!) }
  if (p.type === 1) {
    const a = [P[0]!, P[1]!, P[2]!]
    const ba = [P[3]!, P[4]!, P[5]!]
    return { c: [a[0]! + ba[0]! / 2, a[1]! + ba[1]! / 2, a[2]! + ba[2]! / 2], r: Math.hypot(ba[0]!, ba[1]!, ba[2]!) / 2 + Math.max(P[10]!, P[11]!) }
  }
  if (p.type === 2) {
    // lens: origin, frame, R, d, zMin, zMax
    return { c: [P[0]!, P[1]!, P[2]!], r: Math.max(Math.abs(P[14]!), Math.abs(P[15]!)) + P[12]! + Math.abs(P[13]!) }
  }
  // fin slab: origin, u, v, n, t/2, round, npts, then the polygon, then optional grad / curve
  const o = [P[0]!, P[1]!, P[2]!]
  const u = [P[3]!, P[4]!, P[5]!]
  const v = [P[6]!, P[7]!, P[8]!]
  const npts = P[14]!
  let cu = 0, cv = 0
  for (let i = 0; i < npts; i++) { cu += P[15 + i * 2]!; cv += P[16 + i * 2]! }
  cu /= npts; cv /= npts
  let r = 0
  for (let i = 0; i < npts; i++) r = Math.max(r, Math.hypot(P[15 + i * 2]! - cu, P[16 + i * 2]! - cv))
  const hasCurve = P.length >= 17 + npts * 2 + 6
  return {
    c: [o[0]! + u[0]! * cu + v[0]! * cv, o[1]! + u[1]! * cu + v[1]! * cv, o[2]! + u[2]! * cu + v[2]! * cv],
    r: r + P[12]! + (hasCurve ? 0.35 : 0.02),
  }
}

export function sceneBounds(prims: Prim[]): { center: number[]; radius: number } {
  const bs = prims.map(bounds)
  const center = [0, 0, 0]
  for (const b of bs) {
    center[0]! += b.c[0]! / bs.length
    center[1]! += b.c[1]! / bs.length
    center[2]! += b.c[2]! / bs.length
  }
  let radius = 1e-6
  for (const b of bs) radius = Math.max(radius, Math.hypot(b.c[0]! - center[0]!, b.c[1]! - center[1]!, b.c[2]! - center[2]!) + b.r)
  return { center, radius: radius * 1.06 }
}

export type Cam = { eye: number[]; fwd: number[]; right: number[]; up: number[]; tanHalf: number; aspect: number }

export function makeCamera(prims: Prim[], opt: { az?: number; el?: number; zoom?: number; w: number; h: number; fov?: number; fixedRadius?: number }): Cam {
  const { az = 0.1, el = 0.12, zoom = 1, w, h, fov = 0.62, fixedRadius } = opt
  const b = sceneBounds(prims)
  const center = b.center
  const radius = fixedRadius ?? b.radius
  const dir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)]
  const dist = (radius / Math.sin(fov / 2)) / zoom
  const eye = [center[0]! + dir[0]! * dist, center[1]! + dir[1]! * dist, center[2]! + dir[2]! * dist]
  const fwd = norm(sub(center, eye))
  const worldUp = Math.abs(fwd[1]!) > 0.98 ? [0, 0, 1] : [0, 1, 0]
  const right = norm(cross(fwd, worldUp))
  const up = norm(cross(right, fwd))
  return { eye, fwd, right, up, tanHalf: Math.tan(fov / 2), aspect: w / h }
}

export type RenderOpt = { minStep?: number; maxSteps?: number; light?: number[] }

// Render one image. Returns RGBA plus the hit mask (for outlines and sheets).
export function renderOne(prims: Prim[], cam: Cam, w: number, h: number, opt: RenderOpt = {}): { rgba: Uint8Array; hit: Uint8Array; w: number; h: number } {
  const M = evalListClass!
  const { center, radius } = sceneBounds(prims)
  const minStep = opt.minStep ?? radius / 900
  const maxSteps = opt.maxSteps ?? 220
  const eps = minStep * 0.5
  const light = norm(opt.light ?? [0.5, 0.75, 0.35])
  const bs = prims.map(bounds)
  const margin = minStep * 8

  const rgba = new Uint8Array(w * h * 4)
  const hit = new Uint8Array(w * h)
  const buf: any[] = []

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const sx = ((px + 0.5) / w) * 2 - 1
      const sy = 1 - ((py + 0.5) / h) * 2
      const dx = cam.fwd[0]! + cam.right[0]! * sx * cam.tanHalf * cam.aspect + cam.up[0]! * sy * cam.tanHalf
      const dy = cam.fwd[1]! + cam.right[1]! * sx * cam.tanHalf * cam.aspect + cam.up[1]! * sy * cam.tanHalf
      const dz = cam.fwd[2]! + cam.right[2]! * sx * cam.tanHalf * cam.aspect + cam.up[2]! * sy * cam.tanHalf
      const d = norm([dx, dy, dz])

      // ray vs scene sphere
      const oc = sub(center, cam.eye)
      const tca = dot(oc, d)
      const d2 = dot(oc, oc) - tca * tca
      let idx = (py * w + px) * 4
      if (d2 > radius * radius) {
        rgba[idx] = PAPER[0]; rgba[idx + 1] = PAPER[1]; rgba[idx + 2] = PAPER[2]; rgba[idx + 3] = 255
        continue
      }
      const thc = Math.sqrt(radius * radius - d2)
      const t0 = Math.max(0, tca - thc)
      const t1 = tca + thc

      // per-ray cull: keep prims whose bounding sphere is near the ray
      buf.length = 0
      for (let i = 0; i < prims.length; i++) {
        const b = bs[i]!
        const oci = [b.c[0]! - cam.eye[0]!, b.c[1]! - cam.eye[1]!, b.c[2]! - cam.eye[2]!]
        const tproj = dot(oci, d)
        const perp2 = dot(oci, oci) - tproj * tproj
        const reach = b.r + prims[i]!.k + margin
        if (perp2 < reach * reach) buf.push(prims[i])
      }

      let t = t0
      let isHit = false
      for (let s = 0; s < maxSteps; s++) {
        const x = cam.eye[0]! + d[0]! * t
        const y = cam.eye[1]! + d[1]! * t
        const z = cam.eye[2]! + d[2]! * t
        const dd = M.evalList(buf, x, y, z)
        if (dd < eps) {
          isHit = true
          break
        }
        t += Math.max(Math.abs(dd) * 0.85, minStep)
        if (t > t1) break
      }

      if (!isHit) {
        rgba[idx] = PAPER[0]; rgba[idx + 1] = PAPER[1]; rgba[idx + 2] = PAPER[2]; rgba[idx + 3] = 255
        continue
      }

      const hx = cam.eye[0]! + d[0]! * t
      const hy = cam.eye[1]! + d[1]! * t
      const hz = cam.eye[2]! + d[2]! * t
      const e = minStep * 0.6
      const f = (X: number, Y: number, Z: number) => M.evalList(buf, X, Y, Z)
      const nx = f(hx + e, hy, hz) - f(hx - e, hy, hz)
      const ny = f(hx, hy + e, hz) - f(hx, hy - e, hz)
      const nz = f(hx, hy, hz + e) - f(hx, hy, hz - e)
      const n = norm([nx, ny, nz])
      const lam = 0.22 + 0.78 * Math.max(0, dot(n, light))
      const tone = Math.min(2, Math.max(0, Math.floor(lam * 3)))
      const col = TONES[tone]!
      rgba[idx] = col[0]; rgba[idx + 1] = col[1]; rgba[idx + 2] = col[2]; rgba[idx + 3] = 255
      hit[py * w + px] = 1
    }
  }

  // Ink outline: any body pixel touching the background becomes black.
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      if (!hit[py * w + px]) continue
      const n =
        (px === 0 || !hit[py * w + px - 1]) ||
        (px === w - 1 || !hit[py * w + px + 1]) ||
        (py === 0 || !hit[(py - 1) * w + px]) ||
        (py === h - 1 || !hit[(py + 1) * w + px])
      if (n) {
        const idx = (py * w + px) * 4
        rgba[idx] = INK[0]; rgba[idx + 1] = INK[1]; rgba[idx + 2] = INK[2]; rgba[idx + 3] = 255
      }
    }
  }
  return { rgba, hit, w, h }
}

let evalListClass: any = null
export async function initRaymarch() {
  evalListClass = await sdfClass()
}

// ── Contact sheets ──────────────────────────────────────────────────────────────────────────────
export function sheet(tiles: { rgba: Uint8Array; w: number; h: number }[], cols: number, gap = 6, bg: Vec3 = [255, 252, 245]) {
  const rows = Math.ceil(tiles.length / cols)
  const tw = tiles[0]?.w ?? 0
  const th = tiles[0]?.h ?? 0
  const W = cols * tw + (cols + 1) * gap
  const H = rows * th + (rows + 1) * gap
  const out = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = bg[0]; out[i * 4 + 1] = bg[1]; out[i * 4 + 2] = bg[2]; out[i * 4 + 3] = 255
  }
  tiles.forEach((tl, i) => {
    const cx = (i % cols) * tw + (i % cols + 1) * gap
    const cy = Math.floor(i / cols) * th + (Math.floor(i / cols) + 1) * gap
    for (let y = 0; y < tl.h; y++) {
      for (let x = 0; x < tl.w; x++) {
        const s = (y * tl.w + x) * 4
        const dt = ((cy + y) * W + (cx + x)) * 4
        out[dt] = tl.rgba[s]!; out[dt + 1] = tl.rgba[s + 1]!; out[dt + 2] = tl.rgba[s + 2]!; out[dt + 3] = 255
      }
    }
  })
  return { rgba: out, w: W, h: H }
}

// ── PNG ──────────────────────────────────────────────────────────────────────────────────────────
let CRC: Uint32Array | null = null
function crc32(buf: Buffer): number {
  if (!CRC) {
    CRC = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}
export function encodePNG(w: number, h: number, rgba: Uint8Array): Buffer {
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    src.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}
