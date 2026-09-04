// ── 已改动区块落盘(IndexedDB)──
// Noita 的做法:没动过的区块不存(卸载后重新生成,确定性算法保证一样),玩家挖过/炸过的区块卸载时写 world_X_Y.png_petri。
// 这里对应:只有 dirty 的区块 put;加载时先 get,命中就用存的材质代替生成。
// 材质数组 512×512×u16 = 512KB,RLE 后通常几十 KB(地图大片同材质)。
// 接口极简(get/put/delete/clear),Cocos / 小游戏换成文件系统实现同样四个方法即可。

const DB_NAME = 'noita-map'
const STORE = 'chunks'

export class ChunkStore {
  constructor({ dbName = DB_NAME } = {}) {
    this.dbName = dbName
    this.db = null
  }

  async open() {
    if (this.db) return this
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return this
  }

  static key(seed, cx, cy) { return `${seed}:${cx},${cy}` }

  _tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  /** @returns {Promise<Uint16Array|null>} */
  async get(seed, cx, cy) {
    const rec = await this._tx('readonly', (s) => s.get(ChunkStore.key(seed, cx, cy)))
    return rec ? rleDecode(new Uint16Array(rec.rle), rec.n) : null
  }

  async put(seed, cx, cy, mat) {
    const rle = rleEncode(mat)
    await this._tx('readwrite', (s) => s.put({ rle: rle.buffer, n: mat.length, t: Date.now() }, ChunkStore.key(seed, cx, cy)))
    return rle.byteLength
  }

  async delete(seed, cx, cy) { await this._tx('readwrite', (s) => s.delete(ChunkStore.key(seed, cx, cy))) }

  /** 只清某个种子的存档 */
  async clear(seed) {
    const keys = await this._tx('readonly', (s) => s.getAllKeys())
    const mine = seed === undefined ? keys : keys.filter((k) => k.startsWith(seed + ':'))
    await Promise.all(mine.map((k) => this._tx('readwrite', (s) => s.delete(k))))
    return mine.length
  }

  async count(seed) {
    const keys = await this._tx('readonly', (s) => s.getAllKeys())
    return seed === undefined ? keys.length : keys.filter((k) => k.startsWith(seed + ':')).length
  }
}

/** RLE:(材质, 连续个数) 对,个数 ≤ 65535 */
export function rleEncode(mat) {
  const out = []
  let i = 0
  while (i < mat.length) {
    const v = mat[i]
    let n = 1
    while (i + n < mat.length && mat[i + n] === v && n < 65535) n++
    out.push(v, n)
    i += n
  }
  return Uint16Array.from(out)
}

export function rleDecode(rle, n) {
  const out = new Uint16Array(n)
  let p = 0
  for (let i = 0; i < rle.length; i += 2) {
    out.fill(rle[i], p, p + rle[i + 1])
    p += rle[i + 1]
  }
  return out
}
