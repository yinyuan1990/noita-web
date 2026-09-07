// ── 光照 / 雾 / 天光(原版 post_final.frag + data/temp/light_mask_inv_pow22_smoothed_center.png + WorldLightAndFog)──
//
// 原版画面的"黑"由三样东西决定,shader 里合成顺序(post_final.frag 296~410 行):
//   lights = tex_lights.rgb × 0.8;  lights = pow(lights, 1.5);  lights += glow
//   sky_light = sky_light_color × sky_ambient²(tex_skylight:天光从地表一格格往下渗)
//   lights = max(lights − sky_light, 0) + sky_light;  lights = min(lights, 1);  lights = pow(lights, 1/2.2)
//   fog_of_war = min(1, max( 2 × 1.4 × (0.6,0.5,0.45) × max(0, 1 − fog − √sky), sky ))      ← 未探索 = 0(全黑),探索过 = 1
//   lights *= fog_of_war;  lights += max(0.35 − sky, 0) × 1.4 × (0.6,0.5,0.45) × (1 − fog − √sky)   ← 探索过但没光的地方留 ≈0.29 的暖灰
//   color_fg *= lights
// 光源本身是一张 64×64 的径向蒙版(light_mask_inv_pow22_smoothed_center.png,中心只有 143/255)按 LightComponent.radius 缩放、乘颜色,加进 tex_lights。
// 雾:FogOfWarRadiusComponent radius 256("256 is the default player has"),格子 32px(WorldLightAndFog 0x7a2430 / 0x7a30f0 的 ×1/32),双线性采样。
// 天光:RENDER_SKYLIGHT_ABOVE_WEIGHT 1.0 / SIDES_WEIGHT 0.75 / TOTAL_WEIGHT 0.9 / MAX_REDUCTION_AMOUNT 96(magic_numbers):
//   每格 = (上 ×1 + 左上 ×0.75 + 右上 ×0.75) / 2.5 × 0.9 − 实心占比 × 96/255,从天空(=1)一行行往下算;格子 64px(0x7a2846 的 ×1/64),
//   这里用 32px 一行(衰减开平方 0.9487、扣减减半 48/255)更细一点。敞开的竖井 640px 深还剩 0.35 的天光,实心 2 格(128px)就挡光。
// 没反出来的:雾的 fog_of_war_delta(渐显速度,这里立刻显)、雾开孔的径向形状(这里 fog = d/r 线性,shader 的 ×1.68 让 d < 0.6r 就全亮)。

/** light_mask_inv_pow22_smoothed_center.png 从中心到边的径向剖面(/255),t = d/r 每 1/16 一档 */
export const LIGHT_MASK = [143, 142, 133, 121, 107, 92, 76, 62, 49, 43, 32, 22, 14, 8, 4, 1, 0]

const FOG_CELL = 32, FOG_N = 512 / FOG_CELL // 每 chunk 16×16 格
const SKY_CELL = 32, SKY_N = 512 / SKY_CELL
const SKY_TOP_ROW = Math.floor(-768 / SKY_CELL) // 这行以上一律当天空(最高的山顶 ≈ −600)
const FOG_WARM = [1.4 * 0.6, 1.4 * 0.5, 1.4 * 0.45]

export class FogOfWar {
  constructor() { this.cells = new Map() } // key "cx,cy"(chunk)→ Uint8Array 256,255 = 全遮
  _arr(cx, cy, create) {
    const k = cx + ',' + cy
    let a = this.cells.get(k)
    if (!a && create) { a = new Uint8Array(FOG_N * FOG_N).fill(255); this.cells.set(k, a) }
    return a
  }
  /** 格中心值(0..1 遮盖) */
  cell(gx, gy) {
    const a = this._arr(Math.floor(gx / FOG_N), Math.floor(gy / FOG_N), false)
    return a ? a[(gy & (FOG_N - 1)) * FOG_N + (gx & (FOG_N - 1))] / 255 : 1
  }
  /** 世界坐标双线性采样(GameGetFogOfWarBilinear) */
  sample(wx, wy) {
    const fx = wx / FOG_CELL - 0.5, fy = wy / FOG_CELL - 0.5
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0
    const a = this.cell(x0, y0), b = this.cell(x0 + 1, y0), c = this.cell(x0, y0 + 1), d = this.cell(x0 + 1, y0 + 1)
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
  }
  /** 以 (x,y) 为心开半径 r 的孔:格心距离 d → 遮盖 min(旧, d/r) */
  reveal(x, y, r) {
    const g0x = Math.floor((x - r) / FOG_CELL), g1x = Math.floor((x + r) / FOG_CELL), g0y = Math.floor((y - r) / FOG_CELL), g1y = Math.floor((y + r) / FOG_CELL)
    for (let gy = g0y; gy <= g1y; gy++) for (let gx = g0x; gx <= g1x; gx++) {
      const cxw = (gx + 0.5) * FOG_CELL, cyw = (gy + 0.5) * FOG_CELL
      const d = Math.hypot(cxw - x, cyw - y)
      if (d >= r) continue
      const v = Math.round((d / r) * 255)
      const a = this._arr(Math.floor(gx / FOG_N), Math.floor(gy / FOG_N), true)
      const i = (gy & (FOG_N - 1)) * FOG_N + (gx & (FOG_N - 1))
      if (v < a[i]) a[i] = v
    }
  }
  /** 存档:只存有格子被揭开的 chunk,每块 256 字节 base64 */
  serialize() {
    const o = {}
    for (const [k, a] of this.cells) { let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); o[k] = btoa(s) }
    return o
  }
  restore(o) {
    if (!o) return
    for (const k in o) { const s = atob(o[k]); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); this.cells.set(k, a) }
  }
}

export class Skylight {
  /**
   * @param {(wx:number, wy:number) => number} opacity  世界格的遮光度 0..1(空气 0 / 实心 1 / 液体 0.5),chunk 没加载给 1
   */
  constructor(opacity) { this.opacity = opacity; this.memo = new Map(); this.age = 0 }
  /** 世界变了(挖 / 炸)每 0.5s 重算一遍 */
  tick(dt) { this.age += dt; if (this.age > 0.5) { this.age = 0; this.memo.clear() } }
  _opacityCell(gx, gy) {
    let n = 0, s = 0
    for (let j = 2; j < SKY_CELL; j += 4) for (let i = 2; i < SKY_CELL; i += 4) { s += this.opacity(gx * SKY_CELL + i, gy * SKY_CELL + j); n++ }
    return s / n
  }
  cell(gx, gy) {
    if (gy <= SKY_TOP_ROW) return 1
    const k = gx * 65536 + gy
    let v = this.memo.get(k)
    if (v !== undefined) return v
    // 迭代而不是递归:把这一列连同左右各 3 列从天空一行行算下来(两侧权重 0.27/步,3 列外的影响可忽略);
    // 上一行全 0 就直接 0 不再采样 —— 深处的格子一列扫下来几乎不花时间
    for (let y = SKY_TOP_ROW + 1; y <= gy; y++) for (let x = gx - 3; x <= gx + 3; x++) {
      const kk = x * 65536 + y
      if (this.memo.has(kk)) continue
      const top = y - 1 <= SKY_TOP_ROW
      const up = top ? 1 : (this.memo.get(x * 65536 + y - 1) ?? 0)
      const ul = top ? 1 : (this.memo.get((x - 1) * 65536 + y - 1) ?? up)
      const ur = top ? 1 : (this.memo.get((x + 1) * 65536 + y - 1) ?? up)
      // 三格加权平均 × TOTAL_WEIGHT 0.9:敞开的竖井每 64px 剩 9 成(原版格 64px,这里 32px 一行 → 开 √);实心每 64px 再扣 96/255
      const base = ((up * 1.0 + ul * 0.75 + ur * 0.75) / 2.5) * 0.9487
      const s = base <= 0.002 ? 0 : Math.max(0, base - this._opacityCell(x, y) * (48 / 255))
      this.memo.set(kk, s)
    }
    v = this.memo.get(k) ?? 0
    return v
  }
  sample(wx, wy) {
    const fx = wx / SKY_CELL - 0.5, fy = wy / SKY_CELL - 0.5
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0
    const a = this.cell(x0, y0), b = this.cell(x0 + 1, y0), c = this.cell(x0, y0 + 1), d = this.cell(x0 + 1, y0 + 1)
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
  }
}

/**
 * 光图合成器:低分辨率(1/scale)画布上把所有光源按原版蒙版加起来(tex_lights),compose() 逐像素套 post_final 的公式,
 * 输出一张和视口同尺寸比例的光图,调用方 multiply 到前景上。
 */
export class Lighting {
  constructor(scale = 4) {
    this.scale = scale
    this.cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : document.createElement('canvas')
    this.ctx = this.cv.getContext('2d')
    this.fog = new FogOfWar()
    this.sky = null
    // tex_lights 不走 canvas:光斑在 JS 里加进一张 Float32 光图(w×h×3),compose 直接读它。
    // 之前是 'lighter' 叠 drawImage 再 getImageData 读回 —— 读回要等 GPU 把队里几百个 drawImage 画完,连开陨石头几秒 getImageData 占了整帧 73%(PC 5fps,iPhone 上"像暂停")
    this.buf = new Float32Array(3); this.w = 0; this.h = 0; this.img = null
    this.maskCache = new Map() // Rs → Float32Array (2Rs)²:光罩剖面 LIGHT_MASK 按 d/Rs 线性插值(和径向渐变一样)
    this.rgbCache = new Map()  // 'r,g,b' → [r,g,b]/255
    this.lut15 = new Float32Array(1024); this.lutG = new Float32Array(1024)
    for (let i = 0; i < 1024; i++) { const v = i / 1023; this.lut15[i] = Math.pow(v, 1.5); this.lutG[i] = Math.pow(v, 1 / 2.2) }
  }
  begin(VW, VH) {
    const w = Math.ceil(VW / this.scale), h = Math.ceil(VH / this.scale)
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h }
    if (this.w !== w || this.h !== h) { this.w = w; this.h = h; this.buf = new Float32Array(w * h * 3); this.img = new ImageData(w, h) }
    else this.buf.fill(0)
  }
  _mask(Rs) {
    let m = this.maskCache.get(Rs)
    if (m) return m
    const D = Rs * 2; m = new Float32Array(D * D)
    for (let j = 0; j < D; j++) for (let i = 0; i < D; i++) {
      const t = Math.hypot(i + 0.5 - Rs, j + 0.5 - Rs) / Rs * 16
      if (t >= 16) continue
      const k = t | 0, f = t - k
      m[j * D + i] = (LIGHT_MASK[k] * (1 - f) + LIGHT_MASK[k + 1] * f) / 255
    }
    this.maskCache.set(Rs, m)
    return m
  }
  /**
   * 一盏 LightComponent:视口坐标 (x,y)、radius(世界 px)、'r,g,b'、亮度倍率(mAlpha)。
   * 反 LightSystem 0xcb71d0:sprite.scale = radius / 贴图宽(64),即 64px 的光罩被拉到 **宽 = radius** —— radius 是光斑的直径,真正照到的半径只有一半
   *(玩家 350 → 175px,小灯笼 240 → 120px,蜡烛 64 → 32px);颜色 = (r,g,b)/255 × mAlpha
   */
  light(x, y, r, rgb, a = 1, cap = 1) {
    if (!(r > 0)) return
    const s = 1 / this.scale, Rs = Math.max(1, Math.round(r * 0.5 * s)), D = Rs * 2
    const x0 = Math.round(x * s) - Rs, y0 = Math.round(y * s) - Rs, w = this.w, h = this.h
    if (x0 >= w || y0 >= h || x0 + D <= 0 || y0 + D <= 0) return
    let col = this.rgbCache.get(rgb)
    if (!col) { col = rgb.split(',').map((v) => +v / 255); this.rgbCache.set(rgb, col) }
    const m = this._mask(Rs), B = this.buf, cr = col[0], cg = col[1], cb = col[2]
    const i0 = Math.max(0, -x0), i1 = Math.min(D, w - x0), j0 = Math.max(0, -y0), j1 = Math.min(D, h - y0)
    for (let j = j0; j < j1; j++) {
      let bo = ((y0 + j) * w + x0 + i0) * 3, mo = j * D + i0
      for (let i = i0; i < i1; i++, bo += 3, mo++) {
        const v = m[mo]
        if (v === 0) continue
        const al = v * a > cap ? cap : v * a // rgba 的 alpha 上限 1:亮度倍率再大也只能把中心 143/255 推到 1;cap>1 = 这盏灯代表 cap 盏叠在一起(发光格聚类)
        B[bo] += cr * al; B[bo + 1] += cg * al; B[bo + 2] += cb * al
      }
    }
  }
  /**
   * @param {object} p
   * @param {number} p.ox @param {number} p.oy   视口左上角世界坐标
   * @param {number[]} p.skyColor  sky_light_color(0..1)
   * @param {number} p.nightVision  夜视药(0..1):lights 至少这么亮、雾不遮
   */
  compose(p) {
    const c = this.ctx, w = this.w, h = this.h, S = this.scale
    const img = this.img, d = img.data, B = this.buf
    const L15 = this.lut15, LG = this.lutG
    const skyC = p.skyColor, nv = p.nightVision || 0
    // 雾 / 天光先按 32px 格取到视口大小的小数组,再逐光图像素双线性插值(比每像素查 Map 快一个量级)
    const CELL = FOG_CELL, gx0 = Math.floor(p.ox / CELL - 0.5), gy0 = Math.floor(p.oy / CELL - 0.5)
    const gw = Math.ceil(w * S / CELL) + 3, gh = Math.ceil(h * S / CELL) + 3
    const fogG = this._fogG?.length === gw * gh ? this._fogG : (this._fogG = new Float32Array(gw * gh))
    const skyG = this._skyG?.length === gw * gh ? this._skyG : (this._skyG = new Float32Array(gw * gh))
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) { fogG[gy * gw + gx] = this.fog.cell(gx0 + gx, gy0 + gy); skyG[gy * gw + gx] = this.sky ? this.sky.cell(gx0 + gx, gy0 + gy) : 0 }
    const bilin = (G, fx, fy) => {
      const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0, i0 = y0 * gw + x0
      return (G[i0] * (1 - tx) + G[i0 + 1] * tx) * (1 - ty) + (G[i0 + gw] * (1 - tx) + G[i0 + gw + 1] * tx) * ty
    }
    for (let j = 0; j < h; j++) {
      const wy = p.oy + (j + 0.5) * S, fy = wy / CELL - 0.5 - gy0
      for (let i = 0; i < w; i++) {
        const wx = p.ox + (i + 0.5) * S, o = (j * w + i) * 4, bo = (j * w + i) * 3, fx = wx / CELL - 0.5 - gx0
        const skyA0 = bilin(skyG, fx, fy)
        const skyA = skyA0 * skyA0 // shader:sky_ambient_amount *= sky_ambient_amount
        const fog = nv > 0 ? 0 : bilin(fogG, fx, fy)
        const fogSky = skyA, sqrtSky = Math.sqrt(fogSky)
        const fowBase = Math.max(0, 1 - fog - sqrtSky)
        const add = Math.max(0.35 - fogSky, 0)
        for (let k = 0; k < 3; k++) {
          const lt = B[bo + k] > 1 ? 1 : B[bo + k] // tex_lights 是 8 位贴图,叠加到 1 就饱和
          let l = L15[(lt * 0.8 * 1023) | 0]
          const sl = skyC[k] * skyA
          l = Math.max(l - sl, 0) + sl
          l = LG[Math.min(1023, (Math.min(1, l) * 1023) | 0)]
          const fow = Math.min(1, Math.max(2 * FOG_WARM[k] * fowBase, fogSky))
          l = l * fow + add * FOG_WARM[k] * fowBase
          if (nv > 0) l = Math.max(l, 0.55 * nv)
          d[o + k] = Math.min(255, l * 255) | 0
        }
        d[o + 3] = 255
      }
    }
    if (!this.gpu) c.putImageData(img, 0, 0) // gpu 模式(GLComposite)直接拿 this.img 上传纹理,不过画布
    return this.cv
  }
}
