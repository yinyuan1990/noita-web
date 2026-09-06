// 反 noita_dev.exe procedural_utils/noise_utils.cpp 的三个噪声(置换表直接从 exe .rdata 抠出来,和游戏逐位一致):
//   valueNoise2(0x8fc900):自带 256 置换表 PERM_A(0x114d700),格点值 = perm[perm[xi]+yi]/255,fade(6t⁵−15t⁴+10t³) 双线性,(v−0.5)×2 → [−1,1]
//   gradNoise2 (0x8fc740):同一张表,hash&7 → 8 个梯度 (±1,0)(0,±1)(±1,±1),fade 双线性(经典 improved perlin 2D)
//   simplex2   (0x8fca60):Gustavson simplexnoise1234 2D,标准 Ken Perlin 表(0x114ced0),grad = h<4?(x,2y):(y,2x) 带符号,×40
// 世界生成里怎么用它们见 bands.js(WangJitter / materialValue / GetMaterial)。

export const PERM_A = new Uint8Array([23, 125, 161, 52, 103, 117, 70, 37, 247, 101, 203, 169, 124, 126, 44, 123, 152, 238, 145, 45, 171, 114, 253, 10, 192, 136, 4, 157, 249, 30, 35, 72, 175, 63, 77, 90, 181, 16, 96, 111, 133, 104, 75, 162, 93, 56, 66, 240, 8, 50, 84, 229, 49, 210, 173, 239, 141, 1, 87, 18, 2, 198, 143, 57, 225, 160, 58, 217, 168, 206, 245, 204, 199, 6, 73, 60, 20, 230, 211, 233, 94, 200, 88, 9, 74, 155, 33, 15, 219, 130, 226, 202, 83, 236, 42, 172, 165, 218, 55, 222, 46, 107, 98, 154, 109, 67, 196, 178, 127, 158, 13, 243, 65, 79, 166, 248, 25, 224, 115, 80, 68, 51, 184, 128, 232, 208, 151, 122, 26, 212, 105, 43, 179, 213, 235, 148, 146, 89, 14, 195, 28, 78, 112, 76, 250, 47, 24, 251, 140, 108, 186, 190, 228, 170, 183, 139, 39, 188, 244, 246, 132, 48, 119, 144, 180, 138, 134, 193, 82, 182, 120, 121, 86, 220, 209, 3, 91, 241, 149, 85, 205, 150, 113, 216, 31, 100, 41, 164, 177, 214, 153, 231, 38, 71, 185, 174, 97, 201, 29, 95, 7, 92, 54, 254, 191, 118, 34, 221, 131, 11, 163, 99, 234, 81, 227, 147, 156, 176, 17, 142, 69, 12, 110, 62, 27, 255, 0, 194, 59, 116, 242, 252, 19, 21, 187, 53, 207, 129, 64, 135, 61, 40, 167, 237, 102, 223, 106, 159, 197, 189, 215, 137, 36, 32, 22, 5])
export const PERM_KP = new Uint8Array([151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180])
// 两张表都按 exe 那样复制成 512 长,perm[A + yi] 不用再取模
const PA = new Uint8Array(512); PA.set(PERM_A); PA.set(PERM_A, 256)
const PK = new Uint8Array(512); PK.set(PERM_KP); PK.set(PERM_KP, 256)
const GRAD8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]

const fade = (t) => ((6 * t - 15) * t + 10) * t * t * t
const floorf = (v) => { const i = Math.trunc(v); return i > v ? i - 1 : i } // cvttss2si + 修正 = floor

/** 0x8fc900:值噪声 → [−1, 1] */
export function valueNoise2(x, y) {
  const xi = floorf(x), yi = floorf(y), fx = x - xi, fy = y - yi
  const A = PA[xi & 255], B = PA[(xi + 1) & 255], yl = yi & 255, yh = (yi + 1) & 255
  const v00 = PA[A + yl] / 255, v01 = PA[A + yh] / 255, v10 = PA[B + yl] / 255, v11 = PA[B + yh] / 255
  const uy = fade(fy), ux = fade(fx)
  const a = v00 + (v01 - v00) * uy, b = v10 + (v11 - v10) * uy
  return (a + (b - a) * ux - 0.5) * 2
}

/** 0x8fc740:梯度噪声(improved perlin 2D,8 方向) */
export function gradNoise2(x, y) {
  const xi = floorf(x), yi = floorf(y), fx = x - xi, fy = y - yi
  const A = PA[xi & 255], B = PA[(xi + 1) & 255], yl = yi & 255, yh = (yi + 1) & 255
  const g00 = GRAD8[PA[A + yl] & 7], g01 = GRAD8[PA[A + yh] & 7], g10 = GRAD8[PA[B + yl] & 7], g11 = GRAD8[PA[B + yh] & 7]
  const n00 = g00[0] * fx + g00[1] * fy, n01 = g01[0] * fx + g01[1] * (fy - 1)
  const n10 = g10[0] * (fx - 1) + g10[1] * fy, n11 = g11[0] * (fx - 1) + g11[1] * (fy - 1)
  const v = fade(fy), u = fade(fx)
  const a = n00 + (n01 - n00) * v, b = n10 + (n11 - n10) * v
  return a + (b - a) * u
}

const F2 = 0.3660253882408142, G2 = 0.21132487058639526
const sgrad = (h, x, y) => { h &= 7; const u = h < 4 ? x : y, v = h < 4 ? y : x; return (h & 1 ? -u : u) + (h & 2 ? -2 * v : 2 * v) }
/** 0x8fca60:Gustavson simplexnoise1234 2D,×40 */
export function simplex2(x, y) {
  const s = (x + y) * F2, xs = x + s, ys = y + s
  const i = floorf(xs), j = floorf(ys)
  const t = (i + j) * G2, x0 = x - (i - t), y0 = y - (j - t)
  const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2
  const ii = i & 255, jj = j & 255
  let n0 = 0, n1 = 0, n2 = 0
  let t0 = 0.5 - x0 * x0 - y0 * y0
  if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * sgrad(PK[ii + PK[jj]], x0, y0) }
  let t1 = 0.5 - x1 * x1 - y1 * y1
  if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * sgrad(PK[ii + i1 + PK[jj + j1]], x1, y1) }
  let t2 = 0.5 - x2 * x2 - y2 * y2
  if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * sgrad(PK[ii + 1 + PK[jj + 1]], x2, y2) }
  return 40 * (n0 + n1 + n2)
}

// ── 稀有材质的门:polka 圆点(0x8fbe60)与双精度 simplex(0x8fc020,Gustavson SimplexNoise.java 版:grad3 12 向量、×70)──
const fr = Math.fround
/** 0x8f9200:格哈希 → [0,1)。全 float32 运算(数值很大,frac 的粗糙度要和游戏一样) */
function cellHash1(cx, cy) {
  const ax = fr(fr(cx - fr(floorf(fr(cx * 0.014084506779909134)) * 71)) + 26)
  const ay = fr(fr(cy - fr(floorf(fr(cy * 0.014084506779909134)) * 71)) + 161)
  const s = fr(fr(fr(ax * ax) * fr(ay * ay)) * 0.00101319863460958)
  return fr(s - floorf(s))
}
/** 0x8f92f0:格哈希 → 三个 [0,1)(圆心偏移 x / y、半径插值) */
function cellHash3(cx, cy) {
  const ax = fr(fr(cx - fr(floorf(fr(cx * 0.014084506779909134)) * 71)) + 26)
  const ay = fr(fr(cy - fr(floorf(fr(cy * 0.014084506779909134)) * 71)) + 161)
  const s = fr(fr(ax * ax) * fr(ay * ay))
  const a = fr(s * 0.0010513747110962868), b = fr(s * 0.0015553311677649617), c = fr(s * 0.0012450161157175899)
  return [fr(a - floorf(a)), fr(b - floorf(b)), fr(c - floorf(c))]
}
/**
 * 0x8fbe60:polka。格 = floor(px,py);格哈希 < probability 才有一个点;点半径 r = lerp(radLow, radHigh, h3[2])(格为 1),
 * 圆心在格内随 h3[0..1] 偏移;返回 (1 − d)³,d = u²+v²(boxed 时 u⁴+v⁴,>1 直接 0)
 */
export function polka(px, py, radLow, radHigh, boxed, prob) {
  const cx = floorf(px), cy = floorf(py)
  if (cellHash1(cx, cy) >= prob) return 0
  const [ox, oy, t] = cellHash3(cx, cy)
  const r = radLow + (radHigh - radLow) * t
  if (r <= 0) return 0
  const k = 2 / r
  const u = (px - cx) * k - (k - 1) + (k - 2) * ox, v = (py - cy) * k - (k - 1) + (k - 2) * oy
  let d
  if (boxed) { d = u * u * u * u + v * v * v * v; if (d > 1) return 0 } else { d = u * u + v * v; if (d > 1) d = 1 }
  const m = 1 - d
  return m * m * m
}

const PMOD12 = new Uint8Array(512); for (let i = 0; i < 512; i++) PMOD12[i] = PK[i] % 12
const GRAD3 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0, 1], [0, -1]]
const F2D = 0.5 * (Math.sqrt(3) - 1), G2D = (3 - Math.sqrt(3)) / 6
/** 0x8fc020:双精度 simplex 2D(标准 SimplexNoise.java),用在稀有材质的 rare_use_perlin 门 */
export function simplexD(x, y) {
  const s = (x + y) * F2D, i = Math.floor(x + s), j = Math.floor(y + s)
  const t = (i + j) * G2D, x0 = x - (i - t), y0 = y - (j - t)
  const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1
  const x1 = x0 - i1 + G2D, y1 = y0 - j1 + G2D, x2 = x0 - 1 + 2 * G2D, y2 = y0 - 1 + 2 * G2D
  const ii = i & 255, jj = j & 255
  let n = 0, tt
  tt = 0.5 - x0 * x0 - y0 * y0; if (tt >= 0) { const g = GRAD3[PMOD12[ii + PK[jj]]]; tt *= tt; n += tt * tt * (g[0] * x0 + g[1] * y0) }
  tt = 0.5 - x1 * x1 - y1 * y1; if (tt >= 0) { const g = GRAD3[PMOD12[ii + i1 + PK[jj + j1]]]; tt *= tt; n += tt * tt * (g[0] * x1 + g[1] * y1) }
  tt = 0.5 - x2 * x2 - y2 * y2; if (tt >= 0) { const g = GRAD3[PMOD12[ii + 1 + PK[jj + 1]]]; tt *= tt; n += tt * tt * (g[0] * x2 + g[1] * y2) }
  return 70 * n
}

/** 世界坐标 → wang 坐标(0x908cb0):Wang offset 4.5(实测 floor((x+5)/10)),再叠 amp 倍的噪声抖动(单位 wang px = 10 世界 px) */
export const WANG_OFF = 4.5
export function wangJitter(x, y, amp) {
  const X = x + WANG_OFF, Y = y + WANG_OFF
  let ox = (X + 0.5) * 0.1, oy = (Y + 0.5) * 0.1
  if (amp <= 0) return [ox, oy]
  const s = simplex2(X * 0.13715, Y * 0.13717)
  const w = s * 0.45 + 0.1
  const px = X * 0.1111111119389534, py = Y * 0.1111111119389534
  const n2 = gradNoise2(py, px), n3 = valueNoise2(px, py)
  ox += n3 * w * amp
  oy += n2 * ((1 - w) * 0.33 + 0.111) * amp
  return [ox, oy]
}

/** 0x908e70:材质带取值。c = 该格的 wang 灰度(0.5 边界,1 深处) */
export function materialValue(x, y, c) {
  const n1 = valueNoise2(x * 0.035, y * 0.07) * 15.5
  const t = (c - 0.5) * 0.5
  const k = 0.04892750084400177
  const n2 = simplex2((x + n1) * k, (y + n1) * k)
  const v = c + n2 * (t * t * 5.349999904632568 * 0.949999988079071)
  return v < 0.5 ? 0.5 : v
}
