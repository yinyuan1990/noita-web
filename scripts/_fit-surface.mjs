// 临时:用存档真值(seed 1674172626)的丘陵地表剖面,拟合 _fillSurface 的噪声参数(seed / 格距 / 相位 / 幅度)
// 真值只覆盖 x∈[-1024,0] 与 [1536,2048] 的地表;中间是山体布景。
import fs from 'node:fs'
import { valueNoise } from '../src/noita-map/core/noise.js'

const names = JSON.parse(fs.readFileSync('noita-ref/save-truth/materials.json', 'utf8'))
const load = (wx, wy) => { const f = `noita-ref/save-truth/chunk_${wx}_${wy}.mat.bin`; if (!fs.existsSync(f)) return null; const b = fs.readFileSync(f); return new Uint16Array(b.buffer, b.byteOffset, b.length / 2) }
const isSolid = (n) => n && !/^(air|water|smoke|fire|steam|cloud|grass|spark|blood|oil|plant|moss)/.test(n)
const pts = [] // [x, y] 地表高度;gap 段记 [x, null](地表在 y>0 的未知处,要求 surf(x) > 8)
for (let wx = -1024; wx < 0; wx += 8) {
  let found = null
  for (const wy0 of [-1024, -512]) {
    const m = load(Math.floor(wx / 512) * 512, wy0); if (!m) continue
    const lx = wx - Math.floor(wx / 512) * 512
    for (let ly = 0; ly < 512; ly++) if (isSolid(names[m[ly * 512 + lx]])) { found = wy0 + ly; break }
    if (found !== null) break
  }
  pts.push([wx, found])
}
for (let wx = 1536; wx < 2048; wx += 8) {
  let found = null
  for (const wy0 of [-512, 0]) {
    const m = load(Math.floor(wx / 512) * 512, wy0); if (!m) continue
    const lx = wx - Math.floor(wx / 512) * 512
    for (let ly = 0; ly < 512; ly++) if (isSolid(names[m[ly * 512 + lx]])) { found = wy0 + ly; break }
    if (found !== null) break
  }
  pts.push([wx, found])
}
console.log('样本', pts.length, '其中未知', pts.filter((p) => p[1] === null).length)

const noise = (x, L, phi, s) => 0.85 * valueNoise(x / L + phi, 0.37, s) + 0.15 * valueNoise(x / (L / 2) + phi * 1.7 + 3.3, 0.37, s + 17)
const MAX_SLOPE = +(process.argv[2] || 0.85)
let best = null
for (let s = 1; s < 12000; s++) {
  for (let L = 250; L <= 500; L += 10) {
    for (let phi = 0; phi < 1; phi += 0.025) {
      // 线性最小二乘解 C + A·(n-0.5)·2 = y
      let sxx = 0, sx = 0, sxy = 0, sy = 0, n = 0
      const ns = []
      for (const [x, y] of pts) { const v = (noise(x, L, phi, s) - 0.5) * 2; ns.push(v); if (y === null) continue; sxx += v * v; sx += v; sxy += v * y; sy += y; n++ }
      const det = n * sxx - sx * sx; if (Math.abs(det) < 1e-9) continue
      const A = (n * sxy - sx * sy) / det, C = (sy - A * sx) / n
      if (A < 60 || A > 260) continue
      let err = 0
      pts.forEach(([, y], i) => { const p = C + A * ns[i]; if (y === null) { if (p < 8) err += (8 - p) ** 2 } else err += (p - y) ** 2 })
      if (best && err >= best.err) continue
      // 坡度约束:真值最陡 ≈0.9(41°);落沙 CA 45° 以上会塌成三角堆,所以全域(±8000px)最陡不得超过 0.85
      let maxSlope = 0, prev = null
      for (let x = -8000; x <= 8000; x += 4) { const h = C + A * (noise(x, L, phi, s) - 0.5) * 2; if (prev !== null) maxSlope = Math.max(maxSlope, Math.abs(h - prev) / 4); prev = h }
      if (maxSlope > MAX_SLOPE) continue
      best = { err, s, L, phi: +phi.toFixed(3), A: +A.toFixed(1), C: +C.toFixed(1), maxSlope: +maxSlope.toFixed(2) }
    }
  }
}
console.log('best', best, 'rms', Math.sqrt(best.err / pts.length).toFixed(1))
// 打印拟合剖面对照
const { s, L, phi, A, C } = best
let line = ''
for (const [x, y] of pts) if (x % 64 === 0) line += `${x}:${y ?? '--'}/${(C + A * (noise(x, L, phi, s) - 0.5) * 2) | 0} `
console.log(line)
