// ── 区块流(Chunk Streaming):无缝大地图的调度器 ──
// 每帧 update(视口):
//   1. 需要集 = 可见区块 + 预取环(朝移动方向多取 ahead 格,背后 behind 格)
//   2. 缺的按优先级(可见 > 前方 > 其他;离相机近优先)排队,同时在途 ≤ maxInFlight
//   3. 本帧最多接收 maxAcceptPerFrame 个完成的结果(位图上传有代价,分帧做 = 帧预算)
//   4. 超过 cache 的按 LRU 卸载;dirty(被挖过)的卸载前 put 进 ChunkStore,下次进来直接用存档材质
// 主线程侧,只依赖 WorldClient(Worker)与可选的 ChunkStore;无 DOM。

import { CHUNK, WORLD_CENTER_CHUNK_X as WCX, WORLD_CENTER_CHUNK_Y as WCY } from '../core/coords.js'

export class ChunkStreamer {
  /**
   * @param {import('./WorldClient.js').WorldClient} client
   * @param {object} [o]
   * @param {import('../store/ChunkStore.js').ChunkStore|null} [o.store]
   * @param {number} [o.cache=48]            常驻区块上限(每块 ≈ 材质 512KB + 位图 1MB)
   * @param {number} [o.ahead=2]             移动方向预取格数
   * @param {number} [o.behind=0]            背后预取格数
   * @param {number} [o.side=1]              垂直于移动方向预取格数
   * @param {number} [o.maxInFlight=2]       同时在 Worker 里的请求数
   * @param {number} [o.maxAcceptPerFrame=2] 每帧最多接收几个结果(帧预算)
   */
  constructor(client, o = {}) {
    this.client = client
    this.store = o.store || null
    this.cache = o.cache ?? 48
    this.ahead = o.ahead ?? 2
    this.behind = o.behind ?? 0
    this.side = o.side ?? 1
    this.maxInFlight = o.maxInFlight ?? 2
    this.maxAcceptPerFrame = o.maxAcceptPerFrame ?? 2
    this.maxRepaintPerFrame = o.maxRepaintPerFrame ?? Infinity // 每帧最多换几张重画好的位图(Infinity = 到了就换);新位图第一次画要上传 1MB 纹理,手机上一帧换好几张就是尖峰
    // resident:区块位图落到主线程常驻 canvas(GPU 上一直有),重画只把脏的 32×32 块 putImageData 进去,不再整张 1MB 换;e.bitmap 就是那个 canvas
    this.resident = !!o.resident
    // gl:位图交给 WebGL 当纹理(GLComposite.chunk 第一次画时上传 ImageBitmap),重画的裸像素按脏块切成小块挂在 e.glPatches,由它 texSubImage2D 补上;不建常驻 canvas
    this.gl = !!o.gl
    this.cvPool = []
    this.entries = new Map()   // key → {cx,cy,bitmap,mat,scenes,biome,dirty,t,ready,sdirty}
    this.inFlight = new Map()  // key → promise
    this.done = []             // 完成待接收
    this.repainted = []        // 重画完成待换入的 {e, bitmap|pixels, blocks}
    this.tick = 0
    this.vel = { x: 0, y: 0 }
    this.lastCenter = null
    this.stats = { requested: 0, accepted: 0, fromStore: 0, persisted: 0, evicted: 0, holeFrames: 0, repainted: 0, patchPx: 0 }
    this.seed = client.seed
    this.onEvict = null        // (entry) => void:区块被卸载(实体层据此收掉该块的怪)
  }

  static key(cx, cy) { return cx + ',' + cy }

  get(cx, cy) {
    const e = this.entries.get(ChunkStreamer.key(cx, cy))
    if (e && e.ready) { e.t = ++this.tick; return e }
    return null
  }

  /**
   * @param {{x0:number,y0:number,x1:number,y1:number}} view  可见世界范围(玩家坐标)
   * @param {number} dtMs
   * @returns {boolean} 是否有新内容(需要重绘)
   */
  update(view, dtMs = 16, simRect = null) {
    // 速度(世界 px/s),平滑一下
    const cxm = (view.x0 + view.x1) / 2, cym = (view.y0 + view.y1) / 2
    if (this.lastCenter && dtMs > 0) {
      const vx = (cxm - this.lastCenter.x) / dtMs * 1000, vy = (cym - this.lastCenter.y) / dtMs * 1000
      this.vel.x = this.vel.x * 0.8 + vx * 0.2
      this.vel.y = this.vel.y * 0.8 + vy * 0.2
    }
    this.lastCenter = { x: cxm, y: cym }

    // 可见区块
    const cx0 = Math.floor(view.x0 / CHUNK) + WCX, cx1 = Math.floor(view.x1 / CHUNK) + WCX
    const cy0 = Math.floor(view.y0 / CHUNK) + WCY, cy1 = Math.floor(view.y1 / CHUNK) + WCY
    // 方向:速度够大才算“在朝某边走”,否则四周均匀取 side 格
    const sp = Math.hypot(this.vel.x, this.vel.y)
    const dirX = sp > 40 ? Math.sign(Math.round(this.vel.x / Math.max(1, sp) * 1.2)) : 0
    const dirY = sp > 40 ? Math.sign(Math.round(this.vel.y / Math.max(1, sp) * 1.2)) : 0
    let left = dirX < 0 ? this.ahead : dirX > 0 ? this.behind : this.side
    let right = dirX > 0 ? this.ahead : dirX < 0 ? this.behind : this.side
    let up = dirY < 0 ? this.ahead : dirY > 0 ? this.behind : this.side
    let down = dirY > 0 ? this.ahead : dirY < 0 ? this.behind : this.side
    // 安全阀:需要集不能超过 cache(否则必然抖动),视口太大(缩得很远)时先砍预取,再只保留可见
    const visW = cx1 - cx0 + 1, visH = cy1 - cy0 + 1
    if ((visW + left + right) * (visH + up + down) > this.cache) {
      left = right = up = down = 0
      this.stats.shrunk = (this.stats.shrunk || 0) + 1
    }

    // 模拟窗口(屏幕外一圈,CellSim 在跑的范围):这些 chunk 也要在(优先级排在可见 / 前方之后),否则屏幕外的爆炸 / 流水就"冻"住了
    let sx0 = cx0 - left, sx1 = cx1 + right, sy0 = cy0 - up, sy1 = cy1 + down
    if (simRect) {
      const a = Math.floor(simRect.x0 / CHUNK) + WCX, b = Math.floor(simRect.x1 / CHUNK) + WCX, c = Math.floor(simRect.y0 / CHUNK) + WCY, d = Math.floor(simRect.y1 / CHUNK) + WCY
      if ((Math.max(sx1, b) - Math.min(sx0, a) + 1) * (Math.max(sy1, d) - Math.min(sy0, c) + 1) <= this.cache) { sx0 = Math.min(sx0, a); sx1 = Math.max(sx1, b); sy0 = Math.min(sy0, c); sy1 = Math.max(sy1, d) }
    }
    const wanted = []
    let holes = 0
    this.frame = (this.frame || 0) + 1
    let wantedCount = 0
    for (let cy = sy0; cy <= sy1; cy++) {
      for (let cx = sx0; cx <= sx1; cx++) {
        wantedCount++
        const key = ChunkStreamer.key(cx, cy)
        const visible = cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1
        const e = this.entries.get(key)
        if (e) { e.t = ++this.tick; e.wantedFrame = this.frame; if (visible && !e.ready) holes++; continue }
        if (visible) holes++
        // 优先级:可见 0;前方按距离;预取圈 / 模拟圈按距离靠后
        const dx = cx < cx0 ? cx0 - cx : cx > cx1 ? cx - cx1 : 0
        const dy = cy < cy0 ? cy0 - cy : cy > cy1 ? cy - cy1 : 0
        const forward = (dirX && Math.sign(cx - (dirX > 0 ? cx1 : cx0)) === dirX) || (dirY && Math.sign(cy - (dirY > 0 ? cy1 : cy0)) === dirY)
        const pri = visible ? 0 : (forward ? 1 : 3) + dx + dy
        wanted.push({ cx, cy, key, pri, d: Math.hypot(cx - (cx0 + cx1) / 2, cy - (cy0 + cy1) / 2) })
      }
    }
    if (holes) this.stats.holeFrames++
    // 诊断:需要集/常驻集峰值(排查真机上"请求数远超区块数"的抖动)
    if (wantedCount > (this.stats.maxWanted || 0)) {
      this.stats.maxWanted = wantedCount
      this.stats.maxWantedAt = { cx0, cx1, cy0, cy1, left, right, up, down, view: [view.x0 | 0, view.y0 | 0, view.x1 | 0, view.y1 | 0] }
    }
    if (this.entries.size > (this.stats.maxEntries || 0)) this.stats.maxEntries = this.entries.size
    wanted.sort((a, b) => a.pri - b.pri || a.d - b.d)
    for (const w of wanted) {
      if (this.inFlight.size >= this.maxInFlight) break
      this._request(w.cx, w.cy, w.key)
    }

    // 帧预算:本帧只接收前 N 个
    let changed = false
    let n = 0
    while (this.done.length && n < this.maxAcceptPerFrame) {
      const r = this.done.shift()
      const e = this.entries.get(r.key)
      if (!e) continue
      Object.assign(e, { bitmap: this.resident ? this._toCanvas(r.bitmap) : r.bitmap, mat: r.mat, scenes: r.scenes, lights: r.lights || [], decor: r.decor || [], spawns: e.spawns || r.spawns || [], biome: r.biome, ready: true, timing: r.timing, layerInfo: r.layerInfo, wait: r.wait })
      this.stats.accepted++
      // 这块的植被(树/蘑菇)伸进上一块:上一块若已画好且当时还不知道这块的地表,补画一次,别让树在缝上少半截
      if (r.spillUp) { const up = this.get(e.cx, e.cy - 1); if (up?.ready && up.mat) this.repaint(e.cx, e.cy - 1) }
      changed = true
      n++
    }
    // 重画好的位图按帧预算换入(换入的那帧第一次 drawImage 才真正上传纹理)
    for (let m = 0; this.repainted.length && m < this.maxRepaintPerFrame; m++) {
      const { e, bitmap, pixels, blocks } = this.repainted.shift()
      if (this.entries.get(e.key) !== e) { bitmap?.close?.(); continue }
      if (pixels) this._patch(e, pixels, blocks)
      else { e.bitmap?.close?.(); e.bitmap = bitmap }
      changed = true; this.stats.repainted++
    }
    this._evict()
    return changed
  }

  /** resident:新区块位图画进一张常驻 canvas(池里复用),之后重画只补脏块 */
  _toCanvas(bitmap) {
    let cv = this.cvPool.pop()
    if (!cv) { cv = document.createElement('canvas'); cv.width = CHUNK; cv.height = CHUNK }
    const c = cv.getContext('2d')
    c.clearRect(0, 0, CHUNK, CHUNK)
    if (bitmap) { c.drawImage(bitmap, 0, 0); bitmap.close?.() }
    return cv
  }

  /** 把 Worker 重画的裸像素按脏块(16×16 个 32px 块的位图;null = 整张)putImageData 进常驻 canvas;同一行连着的脏块合成一条 */
  _patch(e, pixels, blocks) {
    if (this.gl) return this._glPatch(e, pixels, blocks)
    if (!e.bitmap || !e.bitmap.getContext) e.bitmap = this._toCanvas(null)
    const c = e.bitmap.getContext('2d'), img = new ImageData(pixels, CHUNK, CHUNK)
    if (!blocks) { c.putImageData(img, 0, 0); this.stats.patchPx += CHUNK * CHUNK; return }
    for (let by = 0; by < 16; by++) {
      for (let bx = 0; bx < 16; bx++) {
        if (!blocks[by * 16 + bx]) continue
        let bx1 = bx
        while (bx1 + 1 < 16 && blocks[by * 16 + bx1 + 1]) bx1++
        c.putImageData(img, 0, 0, bx * 32, by * 32, (bx1 - bx + 1) * 32, 32)
        this.stats.patchPx += (bx1 - bx + 1) * 32 * 32
        bx = bx1
      }
    }
  }

  /** gl 模式:脏块(同一行连着的并成一条)的像素切出来紧凑排好,挂到 e.glPatches,GLComposite.chunk 下次画时 texSubImage2D(WebGL1 没有 UNPACK_ROW_LENGTH,得自己切) */
  _glPatch(e, pixels, blocks) {
    const list = (e.glPatches ||= [])
    if (!blocks) { list.length = 0; list.push({ x: 0, y: 0, w: CHUNK, h: CHUNK, data: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength) }); this.stats.patchPx += CHUNK * CHUNK; return }
    for (let by = 0; by < 16; by++) {
      for (let bx = 0; bx < 16; bx++) {
        if (!blocks[by * 16 + bx]) continue
        let bx1 = bx
        while (bx1 + 1 < 16 && blocks[by * 16 + bx1 + 1]) bx1++
        const w = (bx1 - bx + 1) * 32, data = new Uint8Array(w * 32 * 4)
        for (let r = 0; r < 32; r++) { const so = ((by * 32 + r) * CHUNK + bx * 32) * 4; data.set(pixels.subarray(so, so + w * 4), r * w * 4) }
        list.push({ x: bx * 32, y: by * 32, w, h: 32, data })
        this.stats.patchPx += w * 32
        bx = bx1
      }
    }
  }

  /** 两份脏块位图并起来(null = 整张脏,并出来还是 null) */
  static _orBlocks(a, b) {
    if (!a || !b) return null
    for (let i = 0; i < 256; i++) if (b[i]) a[i] = 1
    return a
  }

  /** 标一格静态变化(区块本地坐标)→ 该 32×32 块下次重画要补;CellSim.set / setCell 调 */
  static markDirty(e, lx, ly) { (e.sdirty || (e.sdirty = new Uint8Array(256)))[(ly >> 5) * 16 + (lx >> 5)] = 1 }

  async _request(cx, cy, key) {
    const e = { cx, cy, key, ready: false, dirty: false, t: ++this.tick, wantedFrame: this.frame, requestedAt: performance.now() }
    this.entries.set(key, e)
    this.stats.requested++
    const p = (async () => {
      let saved = null
      if (this.store) { try { saved = this.store.getRec ? await this.store.getRec(this.seed, cx, cy) : await this.store.get(this.seed, cx, cy).then((m) => (m ? { mat: m, veg: null } : null)) } catch (err) { console.warn('store.get', err) } }
      if (saved) this.stats.fromStore++
      const r = await this.client.requestChunk(cx, cy, { wantMat: true, mat: saved?.mat || null, veg: saved?.veg || null })
      if (!this.entries.has(key)) { r.bitmap?.close?.(); return } // 期间被卸载了
      r.key = key
      r.wait = performance.now() - e.requestedAt
      e.fromStore = !!saved
      this.done.push(r)
    })().catch((err) => { if (!/seed changed/.test(String(err))) console.error('chunk', key, err); this.entries.delete(key) })
      .finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, p)
  }

  _evict() {
    if (this.entries.size <= this.cache) return
    // 本帧仍在需要集里的一律不卸(否则下一帧又要请求 → 抖动);cache 因此是软上限
    const sorted = [...this.entries.values()].filter((e) => e.ready && e.wantedFrame !== this.frame).sort((a, b) => a.t - b.t)
    let over = this.entries.size - this.cache
    for (const e of sorted) {
      if (over-- <= 0) break
      this.entries.delete(e.key)
      this.stats.evicted++
      this.onEvict?.(e)
      if (e.dirty && this.store) {
        this.store.put(this.seed, e.cx, e.cy, e.mat, ChunkStreamer.vegOf(e)).then(() => { this.stats.persisted++ }).catch((err) => console.warn('store.put', err))
      }
      this._free(e.bitmap); e.bitmap = null
    }
  }

  /** 释放位图:ImageBitmap 关掉,常驻 canvas 回池(最多留 8 张) */
  _free(b) {
    if (!b) return
    if (b.getContext) { if (this.cvPool.length < 8) this.cvPool.push(b) }
    else b.close?.() // ImageBitmap 关掉;gl 模式的 UPLOADED 标记没有 close,纹理由 onEvict 里的 GLComposite.freeChunk 删
  }

  /**
   * 改材质(挖洞/放液体):世界坐标圆形区域写 mat,标 dirty,并让 Worker 重画位图。
   * 返回改动到的区块 key 列表。
   */
  async paintCircle(wx, wy, r, matId) {
    const touched = new Map()
    for (let y = Math.floor(wy - r); y <= Math.ceil(wy + r); y++) {
      for (let x = Math.floor(wx - r); x <= Math.ceil(wx + r); x++) {
        if ((x - wx) ** 2 + (y - wy) ** 2 > r * r) continue
        const cx = Math.floor(x / CHUNK) + WCX, cy = Math.floor(y / CHUNK) + WCY
        const e = this.get(cx, cy)
        if (!e || !e.mat) continue
        const lx = x - (cx - WCX) * CHUNK, ly = y - (cy - WCY) * CHUNK
        e.mat[ly * CHUNK + lx] = matId
        e.dirty = true
        touched.set(e.key, e)
      }
    }
    // 重画:把改过的材质交给 Worker(复制一份,原件留在主线程)
    await Promise.all([...touched.values()].map(async (e) => {
      if (this.resident || this.gl) { e.sdirty = null; return this.repaint(e.cx, e.cy) } // 常驻 canvas / GL 纹理:整张按补丁走
      const r2 = await this.client.requestChunk(e.cx, e.cy, { wantMat: false, mat: e.mat.slice(), veg: ChunkStreamer.vegOf(e) })
      if (this.entries.get(e.key) === e) { e.bitmap?.close?.(); e.bitmap = r2.bitmap }
    }))
    return [...touched.keys()]
  }

  /** 这块的植被落点(主线程是唯一真相:树掉下来后 Vegetation.js 改的是这里) */
  static vegOf(e) { return (e.decor || []).filter((d) => d.kind === 'veg') }

  /** 材质已在主线程改过(模拟/挖掘)→ 让 Worker 用当前材质重画位图(同一 chunk 同时只跑一份) */
  async repaint(cx, cy) {
    const e = this.get(cx, cy)
    if (!e || !e.mat) return
    if (e.repainting) { e.repaintAgain = true; return } // 正在画:画完再来一次(脏块留在 e.sdirty 里)
    e.repainting = true
    // 这次要补的脏块:拿走当前的一份,期间新脏的记到新数组里(下次重画补);从没标过脏(null)= 整张补
    const blocks = e.sdirty; e.sdirty = null
    try {
      const r = await this.client.requestChunk(cx, cy, { wantMat: false, raw: this.resident || this.gl, mat: e.mat.slice(), veg: ChunkStreamer.vegOf(e) })
      if (this.entries.get(e.key) !== e || !(r.bitmap || r.pixels)) { r.bitmap?.close?.(); return }
      if (r.pixels && !(this.maxRepaintPerFrame < Infinity)) { this._patch(e, r.pixels, blocks); this.stats.repainted++; return }
      if (r.bitmap && !(this.maxRepaintPerFrame < Infinity)) { e.bitmap?.close?.(); e.bitmap = r.bitmap; this.stats.repainted++; return }
      // 排队到 update() 里按帧预算换入;同一块已排着一张旧的就顶掉(脏块并起来)
      const q = this.repainted.findIndex((x) => x.e === e), it = { e, bitmap: r.bitmap, pixels: r.pixels, blocks }
      if (q >= 0) {
        const old = this.repainted[q]; old.bitmap?.close?.()
        it.blocks = ChunkStreamer._orBlocks(blocks, old.blocks)
        this.repainted[q] = it
      } else this.repainted.push(it)
    } catch (err) {
      if (blocks) e.sdirty = ChunkStreamer._orBlocks(e.sdirty, blocks) // 失败:脏块还回去
      if (!/seed changed/.test(String(err))) console.warn('repaint', err)
    } finally {
      e.repainting = false
      if (e.repaintAgain) { e.repaintAgain = false; if (this.entries.get(e.key) === e) this.repaint(cx, cy) }
    }
  }

  /** 把所有 dirty 区块立刻落盘(切后台 / 退出前调) */
  async flush() {
    if (!this.store) return 0
    const dirty = [...this.entries.values()].filter((e) => e.dirty && e.ready)
    await Promise.all(dirty.map((e) => this.store.put(this.seed, e.cx, e.cy, e.mat, ChunkStreamer.vegOf(e))))
    this.stats.persisted += dirty.length
    return dirty.length
  }

  clear() {
    for (const e of this.entries.values()) this._free(e.bitmap)
    for (const r of this.repainted) r.bitmap?.close?.()
    this.entries.clear(); this.done.length = 0; this.repainted.length = 0
  }
}
