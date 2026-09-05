// ── 实心植被(树 / 大蘑菇 / 仙人掌)—— 原作 entities/vegetation/*.xml:PixelSpriteComponent + SimplePhysicsComponent(can_go_up=0)+ VelocityComponent ──
// 像素在 Worker 生成时已烙进材质格(World._stampVeg,tree_material = wood_loose / fungus_loose / cactus),所以子弹打得中、火烧得着、爆炸挖掉一块就少一块;
// 这里只做 SimplePhysics:整株脚下没有一格实心 → 把还活着的像素从格子里抬起来,按 VelocityComponent 默认重力 400 往下掉,碰到实心就落地、重新烙回去。
// 掉的时候按精灵画(材质格里先拿掉,不然位图重画跟不上会闪);落点(decor.x/y)是主线程的唯一真相,重画 / 存档都带它。

const CHUNK = 512, WCX = 35, WCY = 14
// decor 的 x/y 是 chunk 绝对像素(cx×512 系,cx 含中心偏移),世界坐标 = 绝对 − 中心 chunk 偏移
const OX = WCX * CHUNK, OY = WCY * CHUNK
const K_STATIC = 1, K_SAND = 2

export class Vegetation {
  /** @param {{sim:object, mats:object, streamer:object, decodePng:(url:string)=>Promise<{width:number,height:number,data:Uint8Array,image:ImageBitmap}>, res:string}} o */
  constructor({ sim, mats, streamer, decodePng, res }) {
    this.sim = sim; this.mats = mats; this.streamer = streamer; this.decodePng = decodePng; this.res = res
    this.images = new Map()   // name → {width,height,data,image} | null(加载中)
    this.inst = new Map()     // id → 实例
    this.frame = 0
    this.stats = { fell: 0, landed: 0, gone: 0 }
  }

  _img(name) {
    if (this.images.has(name)) return this.images.get(name)
    this.images.set(name, null)
    this.decodePng(`${this.res}/veg/${name}`).then((im) => this.images.set(name, im)).catch(() => this.images.set(name, false))
    return null
  }

  /** 把就位 chunk 里的实心植被落点收成实例(每株一次;同一株跨两块 chunk 只收一份) */
  sync() {
    for (const e of this.streamer.entries.values()) {
      if (!e.ready || !e.decor) continue
      for (const d of e.decor) {
        if (d.kind !== 'veg' || !d.solid || this.inst.has(d.id)) continue
        this.inst.set(d.id, { d, name: d.name, falling: false, vy: 0, fy: d.y, mask: null, cv: null, checkT: Math.random() * 10 })
      }
    }
  }

  /** chunk 被卸载:它上面的株(以锚点所在 chunk 为准)也丢掉;正在掉的先落回格子(不然材质里没它、存档也没它) */
  unloadChunk(e) {
    for (const [id, it] of this.inst) {
      const cx = Math.floor(it.d.x / CHUNK), cy = Math.floor(it.d.y / CHUNK)
      if (cx === e.cx && cy === e.cy) { if (it.falling) this._land(it, Math.round(it.fy)); this.inst.delete(id) }
    }
  }

  update(dt, rect) {
    this.frame++
    const sim = this.sim
    for (const [id, it] of this.inst) {
      const d = it.d
      const wx = d.x - OX, wy = d.y - OY
      if (wx + d.fw < rect.x0 || wx > rect.x1 || wy + d.fh < rect.y0 || wy > rect.y1) continue
      const img = this._img(d.name)
      if (!img) continue
      if (!it.falling) {
        it.checkT -= dt * 60
        if (it.checkT > 0) continue
        it.checkT = 10 // 每 10 帧看一次脚下
        const s = this._support(it, img)
        if (s === 'gone') { this._remove(id, it); continue }
        if (s === 'ok' || s === 'unknown') continue
        // 脚下全空:抬起来开始掉
        this._lift(it, img)
      } else {
        it.vy = Math.min(600, it.vy + 400 * dt)
        let ny = it.fy + it.vy * dt
        // 1px 一步试落点,碰到实心就停
        let y = Math.round(it.fy)
        const target = Math.round(ny)
        let landed = false
        while (y < target) {
          if (this._blockedAt(it, y + 1)) { landed = true; break }
          y++
        }
        if (landed) { this._land(it, y); continue }
        it.fy = ny
      }
    }
  }

  /**
   * 脚下检查:每列最低的活像素(材质格里还是 d.mat),看它正下方是不是实心。
   * 'ok' 有列撑着;'fall' 全空;'gone' 一个活像素都没了(整株被打光,实体消失);'unknown' 下面 chunk 没加载,先别动
   */
  _support(it, img) {
    const d = it.d, sim = this.sim, K = sim.kind, W = img.width, wx = d.x - OX, wy = d.y - OY
    let alive = 0, supported = false, unknown = false
    for (let i = 0; i < d.fw; i++) {
      let low = -1
      for (let j = d.fh - 1; j >= 0; j--) {
        if (img.data[((j * W) + d.sx + i) * 4 + 3] < 128) continue
        if (sim.get(wx + i, wy + j) === d.mat) { low = j; break }
      }
      if (low < 0) continue
      alive++
      const m = sim.get(wx + i, wy + low + 1)
      if (m < 0) unknown = true
      else if (m > 0 && m !== d.mat && (K[m] === K_STATIC || K[m] === K_SAND)) supported = true // 同材质 = 旁边那棵树的像素,不算撑着(树叠树很常见)
    }
    if (!alive) return 'gone'
    if (supported) return 'ok'
    return unknown ? 'unknown' : 'fall'
  }

  /** 把活着的像素从格子里抬出来,记进 mask 并画成一张小图 */
  _lift(it, img) {
    const d = it.d, sim = this.sim, W = img.width, wx = d.x - OX, wy = d.y - OY
    const mask = new Uint8Array(d.fw * d.fh)
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(d.fw, d.fh) : Object.assign(document.createElement('canvas'), { width: d.fw, height: d.fh })
    const ctx = cv.getContext('2d'), px = ctx.createImageData(d.fw, d.fh)
    let n = 0
    for (let j = 0; j < d.fh; j++) for (let i = 0; i < d.fw; i++) {
      const si = ((j * W) + d.sx + i) * 4
      if (img.data[si + 3] < 128) continue
      if (sim.get(wx + i, wy + j) !== d.mat) continue
      mask[j * d.fw + i] = 1; n++
      sim.set(wx + i, wy + j, 0)
      const oi = (j * d.fw + i) * 4
      px.data[oi] = img.data[si]; px.data[oi + 1] = img.data[si + 1]; px.data[oi + 2] = img.data[si + 2]; px.data[oi + 3] = 255
    }
    ctx.putImageData(px, 0, 0)
    it.mask = mask; it.cv = cv; it.alive = n; it.falling = true; it.vy = 0; it.fy = d.y
    this.stats.fell++
  }

  /** 若整株挪到 y,活像素正下方有没有实心(用 mask 每列最低点) */
  _blockedAt(it, y) {
    const d = it.d, sim = this.sim, K = sim.kind, m = it.mask, wx = d.x - OX
    for (let i = 0; i < d.fw; i++) {
      let low = -1
      for (let j = d.fh - 1; j >= 0; j--) if (m[j * d.fw + i]) { low = j; break }
      if (low < 0) continue
      const c = sim.get(wx + i, y - OY + low + 1)
      if (c < 0) return true // 下面没加载:当墙,别掉进虚空
      if (c > 0 && c !== d.mat && (K[c] === K_STATIC || K[c] === K_SAND)) return true
    }
    return false
  }

  /** 落地:烙回格子(只写空气格),更新落点,挂回所有碰到的 chunk 的 decor */
  _land(it, y) {
    const d = it.d, sim = this.sim, m = it.mask
    const oldChunks = this._chunksOf(d)
    d.y = y
    const wx = d.x - OX, wy = d.y - OY
    // 烙回去:空气 / 沙 / 液体 / 气都让位(静态格才挡),不然每次落在流动的沙上再抬起来就少一批像素
    const K = sim.kind
    for (let j = 0; j < d.fh; j++) for (let i = 0; i < d.fw; i++) {
      if (!m[j * d.fw + i]) continue
      const c = sim.get(wx + i, wy + j)
      if (c === 0 || (c > 0 && K[c] !== K_STATIC)) sim.set(wx + i, wy + j, d.mat)
    }
    // decor 归属:从原来的 chunk 里摘掉,挂到现在碰到的 chunk 上(位图重画由 sim.set 的 staticChanged 触发)
    for (const e of oldChunks) { const k = e.decor.indexOf(d); if (k >= 0) e.decor.splice(k, 1); e.dirty = true }
    for (const e of this._chunksOf(d)) { if (!e.decor.includes(d)) e.decor.push(d); e.dirty = true }
    it.falling = false; it.mask = null; it.cv = null; it.vy = 0; it.checkT = 30 // 落地半秒后再看脚下(落在流沙上会再掉)
    this.stats.landed++
  }

  _chunksOf(d) {
    const out = []
    const cx0 = Math.floor(d.x / CHUNK), cx1 = Math.floor((d.x + d.fw - 1) / CHUNK), cy0 = Math.floor(d.y / CHUNK), cy1 = Math.floor((d.y + d.fh - 1) / CHUNK)
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) { const e = this.streamer.get(cx, cy); if (e?.ready && e.decor) out.push(e) }
    return out
  }

  _remove(id, it) {
    for (const e of this._chunksOf(it.d)) { const k = e.decor.indexOf(it.d); if (k >= 0) { e.decor.splice(k, 1); e.dirty = true } }
    this.inst.delete(id)
    this.stats.gone++
  }

  /** 正在掉的株按精灵画(落地的都在位图里) */
  render(ctx, ox, oy) {
    for (const it of this.inst.values()) if (it.falling && it.cv) ctx.drawImage(it.cv, Math.round(it.d.x - OX - ox), Math.round(it.fy - OY - oy))
  }
}
