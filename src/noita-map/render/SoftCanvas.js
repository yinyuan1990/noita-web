// ── 软 2D 上下文:把 Canvas2D 的 drawImage / fillRect(带 save/restore/translate/rotate/scale/globalAlpha/lighter)在 JS 里最近邻光栅进预乘 RGBA 缓冲 ──
// 给 Entities.render / drawPlayer / RigidBody.draw / 灯 这些按 Canvas2D 写的绘制代码直接用,一行不改:
//   它们画的精灵不再进 2D 画布(iPhone 上那张画布每帧要 CoreGraphics 光栅一两百张带旋转的小图,再作为纹理上传 —— "贴屏"里最大的一块),
//   而是和弹丸精灵 / 粒子一样写进 ProjectileSystem.L(d = 预乘 over 层,add = additive 累加层),由 GLComposite 一次合成。
// 拿不到像素的源(HTMLImageElement、没登记的动态 canvas)和不支持的操作(线 / 弧 / 文字 / 渐变 / clip)透传给真 2D 画布(fb),并标 used —— 调用方据此决定这帧要不要把真画布上传成纹理。
// 像素来源:assets.PIXELS(decodePngBrowser 的位图自动登记;RigidBody._canvas 等自己画的 canvas 用 tagPixels 登记);没登记的静态 canvas 第一次 getImageData 一次缓存(动态的标 canvas.__dynamic 走透传)。
import { PIXELS } from '../assets.js'

const GOT = new WeakMap() // 没登记的 canvas → 读回一次的像素

export class SoftCanvas {
  /** @param {CanvasRenderingContext2D} fb  兜底的真 2D 上下文(线 / 文字 / 未知源) */
  constructor(fb) {
    this.fb = fb
    this.canvas = { width: 0, height: 0 }
    this.L = null
    this.used = false
    this.imageSmoothingEnabled = false
    this._st = [] // save 栈:[a,b,c,d,e,f,alpha,op,fill]
    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0
    this._alpha = 1; this._op = 'source-over'; this._fill = '#000'
    this.cssCache = new Map()
    this.drawn = 0
    this._raw = this // 方法里 this 是 Proxy(每次属性访问都过一遍 get 陷阱),热路径先取回裸对象
    // 兜底透传:没实现的方法 → 同步变换 / alpha / 合成后调真画布;没实现的属性(strokeStyle / lineWidth / font …)直接落到真画布
    return new Proxy(this, {
      get(t, k) {
        if (k in t) return t[k]
        const v = t.fb[k]
        if (typeof v === 'function') return (...args) => { t._sync(); t.used = true; return v.apply(t.fb, args) }
        return v
      },
      set(t, k, v) { if (k in t) t[k] = v; else t.fb[k] = v; return true },
    })
  }

  /** 一帧开始:L = ProjectileSystem.L({d, add, VW, VH, pm:true, 脏矩形 x0..y1}) */
  begin(L) {
    this.L = L; this.canvas.width = L.VW; this.canvas.height = L.VH
    this.used = false; this.drawn = 0
    this._st.length = 0
    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0
    this._alpha = 1; this._op = 'source-over'
  }

  // ── 状态 ──
  get globalAlpha() { return this._alpha }
  set globalAlpha(v) { this._alpha = v; this.fb.globalAlpha = v }
  get globalCompositeOperation() { return this._op }
  set globalCompositeOperation(v) { this._op = v; this.fb.globalCompositeOperation = v }
  get fillStyle() { return this._fill }
  set fillStyle(v) { this._fill = v; this.fb.fillStyle = v }
  save() { this._st.push(this.a, this.b, this.c, this.d, this.e, this.f, this._alpha, this._op, this._fill); this.fb.save() }
  restore() {
    const s = this._st; if (s.length < 9) return
    this._fill = s.pop(); this._op = s.pop(); this._alpha = s.pop(); this.f = s.pop(); this.e = s.pop(); this.d = s.pop(); this.c = s.pop(); this.b = s.pop(); this.a = s.pop()
    this.fb.restore()
  }
  translate(x, y) { this.e += this.a * x + this.c * y; this.f += this.b * x + this.d * y }
  rotate(r) { const cs = Math.cos(r), sn = Math.sin(r); this.transform(cs, sn, -sn, cs, 0, 0) }
  scale(x, y) { this.a *= x; this.b *= x; this.c *= y; this.d *= y }
  transform(a, b, c, d, e, f) {
    const A = this.a, B = this.b, C = this.c, D = this.d
    this.a = A * a + C * b; this.b = B * a + D * b; this.c = A * c + C * d; this.d = B * c + D * d
    this.e += A * e + C * f; this.f += B * e + D * f
  }
  setTransform(a, b, c, d, e, f) { if (typeof a === 'object') { const m = a; a = m.a; b = m.b; c = m.c; d = m.d; e = m.e; f = m.f } this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f }
  resetTransform() { this.setTransform(1, 0, 0, 1, 0, 0) }
  getTransform() { const t = this; return { a: t.a, b: t.b, c: t.c, d: t.d, e: t.e, f: t.f, isIdentity: t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1 && t.e === 0 && t.f === 0 } }
  /** 透传前把变换 / alpha / 合成同步到真画布(属性型状态 strokeStyle 等已经直接落在真画布上) */
  _sync() { this.fb.setTransform(this.a, this.b, this.c, this.d, this.e, this.f); this.fb.globalAlpha = this._alpha; this.fb.globalCompositeOperation = this._op }
  clearRect() {} // 叠层每帧整张清过

  /** 源 → {data,width,height};拿不到返回 null(透传) */
  _pix(src) {
    let p = PIXELS.get(src)
    if (p) return p
    if (src.__dynamic || !src.getContext) return null // 动态画布 / <img>:透传
    p = GOT.get(src)
    if (!p) { const id = src.getContext('2d').getImageData(0, 0, src.width, src.height); p = { data: id.data, width: id.width, height: id.height }; GOT.set(src, p) }
    return p
  }

  drawImage(src, a1, a2, a3, a4, a5, a6, a7, a8) {
    const n = arguments.length, t = this._raw, p = t._pix(src)
    let sx = 0, sy = 0, sw = p ? p.width : src.width, sh = p ? p.height : src.height, dx, dy, dw, dh
    if (n >= 9) { sx = a1; sy = a2; sw = a3; sh = a4; dx = a5; dy = a6; dw = a7; dh = a8 }
    else if (n >= 5) { dx = a1; dy = a2; dw = a3; dh = a4 }
    else { dx = a1; dy = a2; dw = sw; dh = sh }
    // 拿不到像素,或目标太大(倒下的整棵树 6 万像素,JS 逐像素太贵)→ 透传给真画布
    if (!p || Math.abs(dw * dh) > 8192) { t._sync(); t.used = true; return n === 3 ? t.fb.drawImage(src, a1, a2) : n === 5 ? t.fb.drawImage(src, a1, a2, a3, a4) : t.fb.drawImage(src, a1, a2, a3, a4, a5, a6, a7, a8) }
    if (!(sw > 0 && sh > 0 && dw !== 0 && dh !== 0)) return
    // 目标矩形 → 局部像素 (u,v) ∈ [0,sw)×[0,sh):M ∘ [dw/sw, 0, 0, dh/sh, dx, dy]
    const kx = dw / sw, ky = dh / sh
    const a = t.a * kx, b = t.b * kx, c = t.c * ky, d = t.d * ky, e = t.a * dx + t.c * dy + t.e, f = t.b * dx + t.d * dy + t.f
    t._blit(p.data, p.width, sx | 0, sy | 0, sw | 0, sh | 0, a, b, c, d, e, f, t._alpha, t._op === 'lighter')
  }

  /** 纯色矩形(灯 / 绳 / 气泡 / 受伤红闪):fillStyle 必须是 CSS 颜色,渐变等透传 */
  fillRect(x, y, w, h) {
    const t = this._raw, rgb = t._css(t._fill)
    if (!rgb) { t._sync(); t.used = true; t.fb.fillRect(x, y, w, h); return }
    const al = rgb[3] * t._alpha
    if (al <= 0) return
    const L = t.L, W = L.VW, H = L.VH
    const ma = t.a, mb = t.b, mc = t.c, md = t.d, me = t.e, mf = t.f
    const add = t._op === 'lighter', dst = add ? L.add : L.d
    const r = rgb[0], g = rgb[1], bl = rgb[2], w0 = 1 - al, ra = r * al, ga = g * al, ba = bl * al, aa = al * 255
    let bx0, bx1, by0, by1, rot = false, ia = 0, ib = 0, ic = 0, id = 0
    if (mb === 0 && mc === 0) {
      // 轴对齐(绝大多数:灯 / 绳 / 气泡 / 全屏红闪):像素中心落在矩形内 ⇔ 整数区间,直接填行
      const X0 = ma * x + me, X1 = ma * (x + w) + me, Y0 = md * y + mf, Y1 = md * (y + h) + mf
      bx0 = Math.max(0, Math.ceil(Math.min(X0, X1) - 0.5)); bx1 = Math.min(W, Math.ceil(Math.max(X0, X1) - 0.5))
      by0 = Math.max(0, Math.ceil(Math.min(Y0, Y1) - 0.5)); by1 = Math.min(H, Math.ceil(Math.max(Y0, Y1) - 0.5))
    } else {
      const px = (lx, ly) => ma * lx + mc * ly + me, py = (lx, ly) => mb * lx + md * ly + mf
      const xs = [px(x, y), px(x + w, y), px(x, y + h), px(x + w, y + h)], ys = [py(x, y), py(x + w, y), py(x, y + h), py(x + w, y + h)]
      bx0 = Math.max(0, Math.floor(Math.min(...xs))); bx1 = Math.min(W, Math.ceil(Math.max(...xs))); by0 = Math.max(0, Math.floor(Math.min(...ys))); by1 = Math.min(H, Math.ceil(Math.max(...ys)))
      const det = ma * md - mb * mc
      if (!(Math.abs(det) > 1e-9)) return
      ia = md / det; ib = -mb / det; ic = -mc / det; id = ma / det; rot = true
    }
    if (bx1 <= bx0 || by1 <= by0) return
    if (add) { if (bx0 < L.x0) L.x0 = bx0; if (by0 < L.y0) L.y0 = by0; if (bx1 > L.x1) L.x1 = bx1; if (by1 > L.y1) L.y1 = by1 }
    t.drawn++
    for (let j = by0; j < by1; j++) {
      const cy = j + 0.5 - mf
      let o = (j * W + bx0) * 4
      for (let i = bx0; i < bx1; i++, o += 4) {
        if (rot) { const cx = i + 0.5 - me, lx = ia * cx + ic * cy, ly = ib * cx + id * cy; if (lx < x || lx >= x + w || ly < y || ly >= y + h) continue }
        if (add) { dst[o] += ra; dst[o + 1] += ga; dst[o + 2] += ba; dst[o + 3] += aa }
        else { dst[o] = ra + dst[o] * w0; dst[o + 1] = ga + dst[o + 1] * w0; dst[o + 2] = ba + dst[o + 2] * w0; dst[o + 3] = aa + dst[o + 3] * w0 }
      }
    }
  }

  /** CSS 颜色 → [r,g,b,a];渐变对象 / 认不出的返回 null */
  _css(c) {
    if (typeof c !== 'string') return null
    let v = this.cssCache.get(c)
    if (v !== undefined) return v
    v = null
    let m
    if ((m = /^#([0-9a-f]{3})$/i.exec(c))) v = [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16), 1]
    else if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c))) v = [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), m[2] ? parseInt(m[2], 16) / 255 : 1]
    else if ((m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c))) v = [+m[1], +m[2], +m[3], m[4] !== undefined ? +m[4] : 1]
    if (this.cssCache.size > 512) this.cssCache.clear()
    this.cssCache.set(c, v)
    return v
  }

  /** 同 ProjectileSystem._blit:目标像素中心反变换取最近的源像素;over 预乘写 d,lighter 累加 add */
  _blit(src, sw, fx0, fy0, fw, fh, a, b, c, d, e, f, alpha, additive) {
    const t = this._raw, L = t.L, W = L.VW, H = L.VH
    const det = a * d - b * c
    if (!(Math.abs(det) > 1e-9) || alpha <= 0) return
    const px0 = e, py0 = f, px1 = a * fw + e, py1 = b * fw + f, px2 = c * fh + e, py2 = d * fh + f, px3 = a * fw + c * fh + e, py3 = b * fw + d * fh + f
    const bx0 = Math.max(0, Math.floor(Math.min(px0, px1, px2, px3))), bx1 = Math.min(W, Math.ceil(Math.max(px0, px1, px2, px3)))
    const by0 = Math.max(0, Math.floor(Math.min(py0, py1, py2, py3))), by1 = Math.min(H, Math.ceil(Math.max(py0, py1, py2, py3)))
    if (bx1 <= bx0 || by1 <= by0) return
    const ia = d / det, ib = -b / det, ic = -c / det, id = a / det
    const dst = additive ? L.add : L.d
    t.drawn++
    if (additive) { if (bx0 < L.x0) L.x0 = bx0; if (by0 < L.y0) L.y0 = by0; if (bx1 > L.x1) L.x1 = bx1; if (by1 > L.y1) L.y1 = by1 }
    for (let y = by0; y < by1; y++) {
      const dy = y + 0.5 - f, dx0 = bx0 + 0.5 - e
      let lx = ia * dx0 + ic * dy, ly = ib * dx0 + id * dy
      let o = (y * W + bx0) * 4
      for (let x = bx0; x < bx1; x++, lx += ia, ly += ib, o += 4) {
        if (lx < 0 || ly < 0) continue
        const u = lx | 0, v = ly | 0
        if (u >= fw || v >= fh) continue
        const si = ((fy0 + v) * sw + fx0 + u) * 4, sa = src[si + 3]
        if (!sa) continue
        const al = (sa / 255) * alpha
        if (additive) { dst[o] += src[si] * al; dst[o + 1] += src[si + 1] * al; dst[o + 2] += src[si + 2] * al; dst[o + 3] += al * 255 }
        else { const w0 = 1 - al; dst[o] = src[si] * al + dst[o] * w0; dst[o + 1] = src[si + 1] * al + dst[o + 1] * w0; dst[o + 2] = src[si + 2] * al + dst[o + 2] * w0; dst[o + 3] = al * 255 + dst[o + 3] * w0 }
      }
    }
  }
}
