// ── 地表视差天空:照 Noita 的 weather_gfx/parallax_* 复刻 ──
// 原作(magic_numbers:DRAW_PARALLAX_BACKGROUND=1,RENDER_PARALLAX_BACKGROUND_SHADER_GRADIENT=1)在相机深度 < 512 时
// 先画视差背景再画世界。全部素材是白色蒙版,颜色来自 parallax_colors.bmp 色板(x = 一天的时刻,一条带一层):
//   天空 Background(sky_gradient.frag:顶部乘 (0.5,0.55,0.7) 往下渐亮)
//   Background 细线 = 地平线光带(parallax_sunset_line.png 横带蒙版)
//   Clouds #1/#2(parallax_clounds_01/02.png,自带 alpha,慢慢横移)
//   Mountain #2(parallax_mountains_02.png 白蒙版,远)  Mountain #1(parallax_mountains_01.png 双色:back / highlight,近)
//   Stars alpha(夜里撒星)
// 时刻:DESIGN_DAY_CYCLE_SPEED=0.0015 → 一天 ≈ 667s;开局在黄昏段(橙天,与原版开局截图一致)。
// 层位按原版开局截图(远山峰顶 ≈ 地平线上 90px,近山双色)标定;垂直也随相机做视差,飞高会看到云和更暗的天。

const TAU = Math.PI * 2
/** 色板 → 屏幕的整体校色(对照原版截图:天 (227,153,79)→(182,131,86),远山 (148,110,72)→(121,97,69)) */
const GRADE = [0.8, 0.86, 1.0]
const ROW = { sky: 0, horizon: 1, cloud1: 2, cloud2: 3, m1hi: 4, m1back: 5, m2: 6, stars: 10 }

export class ParallaxSky {
  /**
   * @param {string} res  res/noita 根
   * @param {(url:string)=>Promise<{width:number,height:number,data:Uint8Array,image:ImageBitmap}>} decodePng
   * @param {{phase?:number, daySeconds?:number}} [opt]
   */
  constructor(res, decodePng, opt = {}) {
    this.res = res
    this.decodePng = decodePng
    this.phase = opt.phase ?? 0.31 // 0..1 一天;0.25~0.5 黄昏段
    this.daySeconds = opt.daySeconds ?? 1 / 0.0015
    this.t = 0
    this.layers = {}
    this.colors = null
    this._col = -1
    this.ready = false
  }

  async init() {
    const L = (n) => this.decodePng(`${this.res}/sky/${n}.png`)
    const [colors, c1, c2, m1, m2, line] = await Promise.all([
      L('parallax_colors'), L('parallax_clounds_01'), L('parallax_clounds_02'), L('parallax_mountains_01'), L('parallax_mountains_02'), L('parallax_sunset_line'),
    ])
    this.colors = colors
    this.layers.cloud1 = this._maskLayer(c1)
    this.layers.cloud2 = this._maskLayer(c2)
    this.layers.m2 = this._maskLayer(m2)
    this.layers.line = this._maskLayer(line)
    // 双色山:按像素拆成 back / highlight 两张 alpha 蒙版(back 95,72,139;highlight 128,104,176)
    const back = new Uint8ClampedArray(m1.width * m1.height * 4), hi = new Uint8ClampedArray(m1.width * m1.height * 4)
    for (let i = 0; i < m1.data.length; i += 4) {
      if (!m1.data[i + 3]) continue
      const isHi = m1.data[i] > 110
      const d = isHi ? hi : back
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = m1.data[i + 3]
    }
    this.layers.m1back = this._maskLayer({ width: m1.width, height: m1.height, image: await createImageBitmap(new ImageData(back, m1.width, m1.height)) })
    this.layers.m1hi = this._maskLayer({ width: m1.width, height: m1.height, image: await createImageBitmap(new ImageData(hi, m1.width, m1.height)) })
    // 星星:固定哈希撒在 1024×512 的一片天上
    this.stars = []
    let h = 12345
    for (let i = 0; i < 90; i++) { h = (h * 1103515245 + 12345) >>> 0; const x = h % 1024; h = (h * 1103515245 + 12345) >>> 0; const y = (h % 380); h = (h * 1103515245 + 12345) >>> 0; this.stars.push(x, y, 0.4 + (h % 60) / 100) }
    this.ready = true
    return this
  }

  _maskLayer(png) {
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(png.width, png.height) : Object.assign(document.createElement('canvas'), { width: png.width, height: png.height })
    return { mask: png.image, w: png.width, h: png.height, cv, ctx: cv.getContext('2d'), tint: '' }
  }

  tick(dt) { this.t += dt; this.phase = (this.phase + dt / this.daySeconds) % 1 }

  /** 色板某带在当前时刻的颜色(按列线性插值)→ [r,g,b] 已校色 */
  color(row, grade = true) {
    const W = this.colors.width, d = this.colors.data
    const fx = this.phase * W, x0 = Math.floor(fx) % W, x1 = (x0 + 1) % W, f = fx - Math.floor(fx)
    const o0 = (row * W + x0) * 4, o1 = (row * W + x1) * 4
    const out = [0, 0, 0]
    for (let k = 0; k < 3; k++) { const v = d[o0 + k] * (1 - f) + d[o1 + k] * f; out[k] = grade ? v * GRADE[k] : v }
    return out
  }

  /** 天亮程度 0..1(供地表环境光用):夜里 ≈ 0.2,白天/黄昏 ≈ 1 */
  daylight() {
    const c = this.color(ROW.sky, false)
    const lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255
    return Math.max(0, Math.min(1, (lum - 0.12) / 0.45))
  }

  _tinted(layer, rgb) {
    const key = `${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0}`
    if (layer.tint !== key) {
      const c = layer.ctx
      c.globalCompositeOperation = 'source-over'
      c.clearRect(0, 0, layer.w, layer.h)
      c.fillStyle = `rgb(${key})`; c.fillRect(0, 0, layer.w, layer.h)
      c.globalCompositeOperation = 'destination-in'
      c.drawImage(layer.mask, 0, 0)
      c.globalCompositeOperation = 'source-over'
      layer.tint = key
    }
    return layer.cv
  }

  /** 横向平铺一层:屏幕 x 偏移 = -camX*pf + drift,y = 图顶所在屏幕 y */
  _tile(ctx, cv, w, h, camX, pf, drift, top, VW, alpha = 1) {
    const off = ((-camX * pf + drift) % w + w) % w
    ctx.globalAlpha = alpha
    for (let x = off - w; x < VW; x += w) ctx.drawImage(cv, Math.round(x), Math.round(top))
    ctx.globalAlpha = 1
  }

  /**
   * 画满整个视口(调用方随后把世界画在上面)。
   * @param {CanvasRenderingContext2D} ctx  世界像素分辩率画布
   */
  draw(ctx, camX, camY, VW, VH) {
    if (!this.ready) return
    // 各层的"地平线"屏幕 y:世界 y=0 处,按该层视差系数随相机移动
    const hz = (pf) => VH / 2 + (0 - camY) * pf
    // ① 天空:sky_gradient.frag —— 顶部 = 色 × (0.5,0.55,0.7),往下 7 个 256px 渐到原色
    const sky = this.color(ROW.sky)
    const h0 = hz(0.1)
    const g = ctx.createLinearGradient(0, h0 - 1700, 0, h0 + 90)
    g.addColorStop(0, `rgb(${sky[0] * 0.5 | 0},${sky[1] * 0.55 | 0},${sky[2] * 0.7 | 0})`)
    g.addColorStop(1, `rgb(${sky[0] | 0},${sky[1] | 0},${sky[2] | 0})`)
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH)
    // ② 星星(夜):色板 Stars alpha
    const starA = this.color(ROW.stars, false)[0] / 255
    if (starA > 0.01) {
      const hzS = hz(0.02), offX = ((-camX * 0.02) % 1024 + 1024) % 1024
      ctx.fillStyle = '#fff8e8'
      for (let i = 0; i < this.stars.length; i += 3) {
        const y = hzS - 420 + this.stars[i + 1]
        if (y < -1 || y > VH) continue
        const x = (this.stars[i] + offX) % 1024
        if (x > VW) continue
        ctx.globalAlpha = starA * this.stars[i + 2] * (0.75 + 0.25 * Math.sin(this.t * 3 + i))
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1)
      }
      ctx.globalAlpha = 1
    }
    // ③ 云两层(自带 alpha;云形在图的上半,下半是均匀薄雾)。慢慢横飘
    const c1 = this.layers.cloud1, c2 = this.layers.cloud2
    this._tile(ctx, this._tinted(c1, this.color(ROW.cloud1)), c1.w, c1.h, camX, 0.03, -this.t * 2.5, hz(0.03) - 60 - c1.h, VW, 0.35)
    this._tile(ctx, this._tinted(c2, this.color(ROW.cloud2)), c2.w, c2.h, camX, 0.05, -this.t * 4, hz(0.05) - 40 - c2.h, VW, 0.35)
    // ④ 地平线光带(黄昏橙 / 夜里暗红 / 清晨粉),横带中心 ≈ 地平线
    const ln = this.layers.line
    this._tile(ctx, this._tinted(ln, this.color(ROW.horizon)), ln.w, ln.h, camX, 0.08, 0, hz(0.08) - 168, VW, 0.6)
    // ⑤ 远山 Mountain #2:图内第 235 行起是实心底,峰顶到 ~20 行;底线放在地平线下 75
    //    (原版开局截图:远山脊线在出生地面上方 ~40px 横贯左半屏,峰顶再高 ~50px)
    const m2 = this.layers.m2
    this._tile(ctx, this._tinted(m2, this.color(ROW.m2)), m2.w, m2.h, camX, 0.08, 0, hz(0.08) + 75 - 235, VW)
    // ⑥ 近山 Mountain #1 双色:底线放在地平线下 30
    const mb = this.layers.m1back, mh = this.layers.m1hi
    const top1 = hz(0.15) + 30 - 235
    this._tile(ctx, this._tinted(mb, this.color(ROW.m1back)), mb.w, mb.h, camX, 0.15, 0, top1, VW)
    this._tile(ctx, this._tinted(mh, this.color(ROW.m1hi)), mh.w, mh.h, camX, 0.15, 0, top1, VW)
    // 山底以下(视口比山图更往下时)补近山底色,别露出天空
    const bottom1 = top1 + mb.h
    if (bottom1 < VH) { const c = this.color(ROW.m1back); ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; ctx.fillRect(0, Math.round(bottom1) - 1, VW, VH - bottom1 + 1) }
  }
}
