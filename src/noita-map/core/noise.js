// ── 确定性 2D 值噪声 / fbm(材质带与地表近似用;与原作噪声不逐位一致,见 bands.js 说明)──

function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 1274126177) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0
  return (h >>> 8) / 16777216
}

/** 平滑值噪声,返回 [0,1) */
export function valueNoise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const fx = x - xi, fy = y - yi
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** 分形叠加,返回 [0,1) 附近 */
export function fbm(x, y, s = 0, octaves = 3) {
  let sum = 0, amp = 0.5, f = 1, norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * f, y * f, s + i * 17) * amp
    norm += amp
    amp *= 0.5; f *= 2
  }
  return sum / norm
}
