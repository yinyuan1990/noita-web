// ── 主线程侧客户端:把区块请求分发给 1~N 个 mapWorker,返回 Promise ──
// 用法:
//   const client = await new WorldClient({ base: '/res/noita', seed, workers: 1 }).init()
//   const { bitmap, mat, scenes, timing } = await client.requestChunk(cx, cy)
// 每个 worker 各持一份 World(wang 层是确定性的,多份结果一致);手机建议 1 个,桌面 2 个。

export class WorldClient {
  constructor({ base = '/res/noita', seed = 0, workers = 1, chunkCache = 32, paint = {} } = {}) {
    this.base = base
    this.seed = seed
    this.chunkCache = chunkCache
    this.paint = paint
    this.n = Math.max(1, workers)
    this.workers = []
    this.pending = new Map()
    this.nextId = 1
    this.rr = 0
    this.offscreen = false
  }

  async init() {
    for (let i = 0; i < this.n; i++) {
      const w = new Worker(new URL('./mapWorker.js', import.meta.url), { type: 'module' })
      w.onmessage = (e) => this._onMessage(e.data)
      w.onerror = (e) => console.error('mapWorker error', e.message || e)
      this.workers.push(w)
    }
    const rs = await Promise.all(this.workers.map((w) => this._call(w, { cmd: 'init', base: this.base, seed: this.seed, chunkCache: this.chunkCache, paint: this.paint })))
    this.offscreen = !!rs[0]?.offscreen
    return this
  }

  async setSeed(seed) {
    this.seed = seed
    // 换种子时丢掉所有在途请求(结果已过期)
    for (const p of this.pending.values()) p.reject(new Error('seed changed'))
    this.pending.clear()
    await Promise.all(this.workers.map((w) => this._call(w, { cmd: 'seed', seed, chunkCache: this.chunkCache })))
  }

  async setPaint(paint) {
    Object.assign(this.paint, paint)
    await Promise.all(this.workers.map((w) => this._call(w, { cmd: 'paint', paint })))
  }

  /** 游戏内全局(GlobalsSetValue 那类:TEMPLE_SHOP_ITEM_COUNT …)→ 每个 Worker 的 world.globals,生成时读 */
  async setGlobals(globals) {
    await Promise.all(this.workers.map((w) => this._call(w, { cmd: 'globals', globals })))
  }

  /**
   * @param {{wantMat?:boolean, wantBitmap?:boolean, raw?:boolean, mat?:Uint16Array}} [o]  mat = 存档里的材质(改过的区块),给了就不用生成的;raw = 要裸像素(pixels)而不是 ImageBitmap
   * @returns {Promise<{cx,cy,biome,scenes,mat:Uint16Array|null,bitmap:ImageBitmap|null,pixels:Uint8ClampedArray|null,timing,layerInfo}>}
   */
  requestChunk(cx, cy, { wantMat = true, wantBitmap = true, raw = false, mat = null, veg = null } = {}) {
    const w = this.workers[this.rr++ % this.workers.length]
    return this._call(w, { cmd: 'chunk', cx, cy, wantMat, wantBitmap, raw, mat, veg }, mat ? [mat.buffer] : []) // veg = 植被落点(重画 / 读档时带回去,别重算)
  }

  _call(w, msg, transfer = []) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      w.postMessage({ ...msg, id }, transfer)
    })
  }

  _onMessage(m) {
    const p = this.pending.get(m.id)
    if (!p) return
    this.pending.delete(m.id)
    if (m.type === 'error') p.reject(new Error(m.message))
    else p.resolve(m)
  }

  terminate() {
    for (const w of this.workers) w.terminate()
    this.workers = []
    this.pending.clear()
  }
}
