// ── 区块渲染:材质 id → 像素(Canvas2D,手机可跑)──
// 原作观感四件事(MAP-INVENTORY.md §D):① 材质贴图按世界坐标取模 ② 群系背景图垫在空气后面
// ③ 布景 _visual 手绘层叠在材质上 ④ 边缘明暗(EdgeGraphics 近似)。光照不在这里做(运行时系统)。

import { CHUNK } from '../core/coords.js'
import { BIOMES } from '../core/biomes.js'

export class ChunkPainter {
  /**
   * @param {import('../assets.js').NoitaAssets} assets
   * @param {{bgDim?:number, edges?:boolean, visual?:boolean}} [opt]
   */
  constructor(assets, opt = {}) {
    this.assets = assets
    this.mats = assets.materials
    this.bgDim = opt.bgDim ?? 0.45
    this.edges = opt.edges ?? true
    this.visual = opt.visual ?? true
    // 跑模拟时位图只画静态材质,液体/沙/气/火每帧由主线程按当前状态叠上去(否则位图会是过时的一帧)
    this.skipDynamic = opt.skipDynamic ?? false
    this.texOf = new Map() // 材质 id → texture 名
    for (const m of this.mats.list) if (m.texture) this.texOf.set(m.id, m.texture)
    // materials.xml <EdgeGraphics color percent>:材质与空气交界处的描边色(煤矿湿岩/砂岩是深绿 #233112 苔边)
    const n = this.mats.list.length
    this.edgeColor = new Int32Array(n).fill(-1)
    this.edgePct = new Float32Array(n)
    for (const m of this.mats.list) if (m.edgeColor) { this.edgeColor[m.id] = parseInt(m.edgeColor.slice(-6), 16); this.edgePct[m.id] = m.edgePercent ?? 1 }
    this.vegetation = opt.vegetation ?? true
    this.edgeStamps = opt.edgeStamps ?? true
    // 只取可随机旋转的斑块印章;hor/ver 条纹图(木板/神殿砖线)要按边法向铺,另做
    this.edgeImgs = this.mats.list.map((m) => { const l = m.edgeImages ? m.edgeImages.filter((e) => !e.hor && !e.ver).map((e) => e.f) : []; return l.length ? l : null })
    this.imgData = new ImageData(CHUNK, CHUNK)
    // 材质层先画进临时画布再叠到背景上(putImageData 不走合成)
    this.tmp = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(CHUNK, CHUNK) : Object.assign(document.createElement('canvas'), { width: CHUNK, height: CHUNK })
  }

  /** 预加载该 chunk 会用到的贴图/背景/植被/边缘印章 */
  async prepare(chunk) {
    const need = new Set(), edges = new Set()
    const seen = new Uint8Array(this.mats.list.length)
    const mat = chunk.mat
    for (let i = 0; i < mat.length; i += 7) {
      const m = mat[i]
      if (seen[m]) continue
      seen[m] = 1
      const t = this.texOf.get(m); if (t) need.add(t)
      if (this.edgeImgs[m]) for (const f of this.edgeImgs[m]) edges.add(f)
    }
    const jobs = [...need].map((t) => this.assets.loadTexture(t))
    for (const f of edges) jobs.push(this.assets.loadTexture('edge/' + f))
    const bg = BIOMES[chunk.biome]?.bg
    if (bg) jobs.push(this.assets.loadBackground(bg))
    for (const d of chunk.decor || []) {
      if (d.kind === 'vine') jobs.push(this.assets.loadVeg('vine_a.png'))
      else if (d.kind === 'veg') jobs.push(this.assets.loadVeg(d.name))
      else if (d.kind === 'sprite') jobs.push(this.assets.loadScene(d.dir, d.name))
    }
    await Promise.all(jobs)
  }

  /**
   * @param {{cx:number,cy:number,biome:string,mat:Uint16Array,scenes:Array}} chunk
   * @param {HTMLCanvasElement|OffscreenCanvas} canvas  512×512
   */
  paint(chunk, canvas) {
    const { mat, cx, cy } = chunk
    const d = this.imgData.data
    const color = this.mats.color, alpha = this.mats.alpha, kind = this.mats.kind
    const bg = BIOMES[chunk.biome]?.bg ? this.assets.background(BIOMES[chunk.biome].bg) : null
    const dim = this.bgDim
    const ax0 = cx * CHUNK, ay0 = cy * CHUNK
    const skipDyn = this.skipDynamic
    const isDyn = (k) => k === 'liquid' || k === 'gas' || k === 'fire' || k === 'sand'
    // 地表群系(丘陵/山体)的空气透明,露出天空;地下群系的空气后面是群系背景墙
    const bk = BIOMES[chunk.biome]?.kind
    const openSky = bk === 'surface' || bk === 'air' || (chunk.cy < 14 && !bg)
    const texCache = new Map()
    const texFor = (m) => {
      let t = texCache.get(m)
      if (t === undefined) { const n = this.texOf.get(m); t = n ? this.assets.texture(n) : null; texCache.set(m, t) }
      return t
    }
    for (let j = 0; j < CHUNK; j++) {
      const ay = ay0 + j
      for (let i = 0; i < CHUNK; i++) {
        const idx = j * CHUNK + i
        const m = mat[idx]
        const ax = ax0 + i
        let r, g, b
        // 背景(空气后面的墙)
        let br = 22, bgg = 18, bb = 16
        if (bg) {
          const o = (((ay % bg.height) + bg.height) % bg.height * bg.width + ((ax % bg.width) + bg.width) % bg.width) * 4
          br = bg.data[o] * dim; bgg = bg.data[o + 1] * dim; bb = bg.data[o + 2] * dim
        }
        if (m === 0 || (skipDyn && isDyn(kind[m]))) {
          // 空气:材质层透明,背景(群系墙 / 布景 _background / 天空)在下面那层
          d[idx * 4 + 3] = 0; continue
        } else {
          const k = kind[m]
          const t = texFor(m)
          if (t && (k === 'static' || k === 'solid' || k === 'sand')) {
            const o = (((ay % t.height) + t.height) % t.height * t.width + ((ax % t.width) + t.width) % t.width) * 4
            r = t.data[o]; g = t.data[o + 1]; b = t.data[o + 2]
          } else {
            const c = color[m]
            r = (c >> 16) & 255; g = (c >> 8) & 255; b = c & 255
            if (k === 'liquid' || k === 'gas' || k === 'fire') {
              // 液体/气体半透明叠在背景上(materials.xml Graphics.color 的 alpha)
              const a = alpha[m] / 255
              r = br * (1 - a) + r * a; g = bgg * (1 - a) + g * a; b = bb * (1 - a) + b * a
            } else if (k === 'sand') {
              let h = (ax * 374761393 + ay * 668265263) >>> 0
              h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
              const jt = 0.86 + ((h >>> 16) % 100) / 100 * 0.28
              r *= jt; g *= jt; b *= jt
            }
          }
          if (this.edges && k !== 'liquid' && k !== 'gas' && k !== 'fire') {
            const isOpen = (x) => x === 0 || (skipDyn && isDyn(kind[x]))
            const up = j > 0 ? isOpen(mat[idx - CHUNK]) : false
            const up2 = j > 1 ? isOpen(mat[idx - 2 * CHUNK]) : false
            const dn = j < CHUNK - 1 ? isOpen(mat[idx + CHUNK]) : false
            const lf = i > 0 ? isOpen(mat[idx - 1]) : false
            const rt = i < CHUNK - 1 ? isOpen(mat[idx + 1]) : false
            const ec = this.edgeColor[m]
            if (ec >= 0 && (up || lf || rt || up2)) {
              // xml 描边:交界 1~2px 按 percent 概率换成描边色(哈希取代随机,重画一致)
              let h = (ax * 374761393 + ay * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
              const roll = ((h >>> 16) % 1000) / 1000
              const pct = this.edgePct[m] * (up ? 1.6 : up2 ? 0.7 : 1)
              if (roll < pct) { r = (ec >> 16) & 255; g = (ec >> 8) & 255; b = ec & 255 }
              else if (up) { r = r * 1.25 + 8; g = g * 1.25 + 8; b = b * 1.2 + 4 }
            } else if (up) { r = r * 1.45 + 14; g = g * 1.45 + 14; b = b * 1.35 + 8 }
            else if (lf || rt) { r = r * 1.22 + 6; g = g * 1.22 + 6; b = b * 1.18 + 4 }
            else if (dn) { r *= 0.66; g *= 0.66; b *= 0.66 }
          }
        }
        const o = idx * 4
        d[o] = r > 255 ? 255 : r; d[o + 1] = g > 255 ? 255 : g; d[o + 2] = b > 255 ? 255 : b; d[o + 3] = 255
      }
    }
    if (this.edgeStamps) this._stampEdges(chunk, d)
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, CHUNK, CHUNK)
    // ① 背景层:地下 = 群系背景墙(按世界坐标平铺,压暗);地表 = 透明露天空
    if (!openSky && bg?.image) {
      const bw = bg.width, bh = bg.height
      const offX = ((ax0 % bw) + bw) % bw, offY = ((ay0 % bh) + bh) % bh
      for (let y = -offY; y < CHUNK; y += bh) for (let x = -offX; x < CHUNK; x += bw) ctx.drawImage(bg.image, x, y)
      ctx.fillStyle = `rgba(0,0,0,${1 - dim})`; ctx.fillRect(0, 0, CHUNK, CHUNK)
      // static_tile 群系(天空神殿)的 static_tile_bg_mask:蒙版为黑的 8px 块把背景墙抠掉露天空(按行合并成条)
      if (chunk.bgMask) {
        const M = chunk.bgMask
        for (let bj = 0; bj < 64; bj++) for (let bi = 0; bi < 64;) {
          if (M[bj * 64 + bi]) { bi++; continue }
          let e = bi; while (e < 64 && !M[bj * 64 + e]) e++
          ctx.clearRect(bi * 8, bj * 8, (e - bi) * 8, 8); bi = e
        }
      }
    } else if (!openSky) { ctx.fillStyle = '#161210'; ctx.fillRect(0, 0, CHUNK, CHUNK) }
    // ② 背景贴图(LoadBackgroundSprite:挖掘场的塔 / 横梁 / 机械,z 大的先画在最后面)→ 布景 _background(圣山雕像柱廊 / 油罐后墙 / 山洞大厅),只在空气处露出来
    const bgSprites = chunk.scenes.filter((sc) => sc.bgSprite).sort((a, b) => (b.z || 0) - (a.z || 0))
    for (const sc of bgSprites) {
      const s = this.assets.scene(sc.dir, sc.name)
      if (s?.mat?.image) ctx.drawImage(s.mat.image, sc.ax - ax0, sc.ay - ay0)
    }
    for (const sc of chunk.scenes) {
      if (sc.bgSprite) continue
      const s = this.assets.scene(sc.dir, sc.name)
      if (s?.bg?.image) ctx.drawImage(s.bg.image, sc.ax - ax0, sc.ay - ay0)
    }
    // ③ 材质层(空气透明)
    const tctx = this.tmp.getContext('2d')
    tctx.putImageData(this.imgData, 0, 0)
    ctx.drawImage(this.tmp, 0, 0)
    // ④ 植被贴图(落点由 World 算,含从下一 chunk 伸上来的)⑤ 布景手绘层
    if (this.vegetation) this._paintVegetation(chunk, ctx)
    if (this.visual) {
      for (const sc of chunk.scenes) {
        const s = this.assets.scene(sc.dir, sc.name)
        if (s?.visual?.image) ctx.drawImage(s.visual.image, sc.ax - ax0, sc.ay - ay0)
      }
    }
    // ⑥ 近景散件:布景标记色生出来的草丛整图 / 藤蔓(原作是 PixelSprite / verlet 实体,这里烙进位图)
    if (chunk.decor?.length) this._paintDecor(chunk, ctx)
    return canvas
  }

  _paintDecor(chunk, ctx) {
    const ax0 = chunk.cx * CHUNK, ay0 = chunk.cy * CHUNK
    const vine = this.assets.veg('vine_a.png')
    for (const d of chunk.decor) {
      if (d.kind === 'sprite') {
        const s = this.assets.scene(d.dir, d.name)
        if (s?.mat?.image) ctx.drawImage(s.mat.image, d.x - ax0, d.y - ay0)
      } else if (d.kind === 'wire') {
        // 吊线:锚点间下垂的暗灰细线(metal_wire_nohit 的颜色)
        const p = d.pts
        ctx.strokeStyle = '#3c3c44'; ctx.lineWidth = 1; ctx.beginPath()
        for (let i = 0; i < p.length; i += 2) { const x = Math.round(p[i] - ax0) + 0.5, y = Math.round(p[i + 1] - ay0) + 0.5; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y) }
        ctx.stroke()
      } else if (d.kind === 'vine' && vine?.image) {
        // 沿路径每节贴一帧 4×3 藤蔓精灵(茎沿帧的 x 轴),按段方向旋转
        const p = d.pts
        for (let i = 0; i + 3 < p.length; i += 2) {
          const x = p[i] - ax0, y = p[i + 1] - ay0, nx = p[i + 2] - ax0, ny = p[i + 3] - ay0
          const a = Math.atan2(ny - y, nx - x)
          ctx.save()
          ctx.translate(Math.round((x + nx) / 2), Math.round((y + ny) / 2))
          ctx.rotate(a)
          ctx.drawImage(vine.image, ((i >> 1) % 8) * 4, 0, 4, 3, -2, -1, 4, 3)
          ctx.restore()
        }
      }
    }
  }

  /**
   * EdgeGraphics 印章:materials.xml <Edge><Images> 的小图(20×16 苔藓斑,黑=透明)沿材质/空气交界随机旋转盖章,
   * 只落在同类实心像素上(require_same_material_type)。percent 控制交界上盖章的密度。这就是煤矿石头上的绿苔斑。
   */
  _stampEdges(chunk, d) {
    const { mat, cx, cy } = chunk
    const kind = this.mats.kind
    const ax0 = cx * CHUNK, ay0 = cy * CHUNK
    const solid = (m) => { const k = kind[m]; return k === 'static' || k === 'solid' || k === 'sand' }
    const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 1274126177) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return (h >>> 8) / 16777216 }
    for (let j = 1; j < CHUNK - 1; j++) {
      for (let i = 1; i < CHUNK - 1; i++) {
        const idx = j * CHUNK + i
        const m = mat[idx]
        const imgs = this.edgeImgs[m]
        if (!imgs || !solid(m)) continue
        // 交界像素:四邻有空气;每隔 ~5px 一个候选,再按 percent 掷
        if (mat[idx - CHUNK] !== 0 && mat[idx + CHUNK] !== 0 && mat[idx - 1] !== 0 && mat[idx + 1] !== 0) continue
        const ax = ax0 + i, ay = ay0 + j
        if (hash(ax, ay, 5) > this.edgePct[m] * 0.22) continue
        const img = this.assets.texture('edge/' + imgs[Math.floor(hash(ax, ay, 9) * imgs.length)])
        if (!img) continue
        const rot = Math.floor(hash(ax, ay, 13) * 4) // 0~3 × 90°
        const w = img.width, h = img.height, hw = w >> 1, hh = h >> 1
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4
          const r = img.data[o], g = img.data[o + 1], b = img.data[o + 2]
          if (r + g + b < 24) continue // 黑 = 透明
          let dx = x - hw, dy = y - hh
          if (rot === 1) [dx, dy] = [-dy, dx]; else if (rot === 2) [dx, dy] = [-dx, -dy]; else if (rot === 3) [dx, dy] = [dy, -dx]
          const px = i + dx, py = j + dy
          if (px < 0 || py < 0 || px >= CHUNK || py >= CHUNK) continue
          const ti = py * CHUNK + px
          if (mat[ti] !== m) continue // 只盖在同一种材质上(钢/木的印章别糊到石头上)
          const to = ti * 4
          d[to] = r; d[to + 1] = g; d[to + 2] = b
        }
      }
    }
  }

  /**
   * VegetationComponent(biome xml)贴图:落点由 World._vegAnchors 算好放在 chunk.decor(kind 'veg',含从下一 chunk
   * 地表长上来、伸进本 chunk 的那些),这里只负责贴;超出 chunk 的部分自然被画布裁掉,另一半在邻 chunk 里。
   */
  _paintVegetation(chunk, ctx) {
    if (!chunk.decor) return
    const ax0 = chunk.cx * CHUNK, ay0 = chunk.cy * CHUNK
    ctx.imageSmoothingEnabled = false
    let px = null
    for (const d of chunk.decor) {
      if (d.kind !== 'veg') continue
      const img = this.assets.veg(d.name)
      if (!img?.image) continue
      if (!d.solid || !chunk.mat || !img.data) { ctx.drawImage(img.image, d.sx, 0, d.fw, d.fh, d.x - ax0, d.y - ay0, d.fw, d.fh); continue }
      // 实心植被(PixelSprite):像素在材质格里,只画材质还在的那些像素 —— 被炸掉 / 挖掉 / 烧掉的部分就没了
      const x0 = Math.max(0, ax0 - d.x), x1 = Math.min(d.fw, ax0 + CHUNK - d.x), y0 = Math.max(0, ay0 - d.y), y1 = Math.min(d.fh, ay0 + CHUNK - d.y)
      if (x0 >= x1 || y0 >= y1) continue
      const w = x1 - x0, h = y1 - y0
      if (!px || px.width !== w || px.height !== h) px = new ImageData(w, h)
      const out = px.data, src = img.data, W = img.width, mat = chunk.mat
      out.fill(0)
      for (let j = y0; j < y1; j++) {
        const wy = d.y + j - ay0
        for (let i = x0; i < x1; i++) {
          const si = ((j * W) + d.sx + i) * 4
          if (src[si + 3] < 128) continue
          if (mat[wy * CHUNK + (d.x + i - ax0)] !== d.mat) continue
          const oi = ((j - y0) * w + (i - x0)) * 4
          out[oi] = src[si]; out[oi + 1] = src[si + 1]; out[oi + 2] = src[si + 2]; out[oi + 3] = 255
        }
      }
      // putImageData 会把透明像素也盖上去(抹掉背景),先放到小画布再 drawImage
      if (!this._vegCv || this._vegCv.width < w || this._vegCv.height < h) this._vegCv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(Math.max(w, 128), Math.max(h, 160)) : Object.assign(document.createElement('canvas'), { width: Math.max(w, 128), height: Math.max(h, 160) })
      const vc = this._vegCv.getContext('2d')
      vc.clearRect(0, 0, w, h); vc.putImageData(px, 0, 0)
      ctx.drawImage(this._vegCv, 0, 0, w, h, d.x + x0 - ax0, d.y + y0 - ay0, w, h)
    }
  }
}
