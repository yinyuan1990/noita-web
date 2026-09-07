// ── 材质模拟(落沙元胞自动机),全部规则由 materials.xml 的属性驱动,对标 Noita ──
// 直接在 ChunkStreamer 的 chunk.mat 上原地模拟(激活窗口 = 视口 + 边距,最多 3×3 个 chunk),不拷贝:
//   坐标 → (chunk 表下标, 局部下标) 是纯算术,没有 Map 查找。改过的 chunk 标 dirty(卸载时落盘)。
// 材质分类(materials.json 的 kind,由 cell_type/liquid_static/liquid_sand 推出):
//   static/solid 不动;sand 落沙(liquid_sand);liquid 液体(density 决定谁浮谁沉,liquid_viscosity 决定摊开速度,
//   liquid_gravity 决定下落概率);gas 上浮并按 lifetime 消散;fire 有寿命、需要氧气、点燃 burnable 邻居
//   (autoignition_temperature ≤ 火的 temperature_of_fire 才点得着,fire_hp 决定烧多久,generates_smoke 出烟)。
// 反应表 reactions.json(328 条,含 [tag] 展开):相邻两格按 probability%/帧 变成输出材质——熔岩+水=岩+蒸汽 等全部来自原表。
// 每格附带 1 字节 aux:火/气 = 剩余寿命(帧/4);可燃材质 = 燃烧进度(0 未燃)。

import { CHUNK, WORLD_CENTER_CHUNK_X as WCX, WORLD_CENTER_CHUNK_Y as WCY } from '../core/coords.js'

const K_AIR = 0, K_STATIC = 1, K_SAND = 2, K_LIQUID = 3, K_GAS = 4, K_FIRE = 5
// cell_type=solid(wood_prop / rock_box2d / metal_rust_barrel / rock_loose …)= box2d 刚体材质:在世界格里是不动的,
// 动的是刚体本身(RigidBody 醒着时把像素带走,睡着时写回来)。之前当落沙处理会把煤矿的木支架、睡着的箱子全冲塌。
const KIND_ID = { air: K_AIR, static: K_STATIC, solid: K_STATIC, sand: K_SAND, liquid: K_LIQUID, gas: K_GAS, fire: K_FIRE }
const N = CHUNK * CHUNK
// 睡眠:chunk 切成 32×32 的块,只步进"脏"块(原作也只更新被碰过的格子;新生成的 chunk 是静止的,>45° 的落沙布景不会自己塌)。
// 写格子 / 交换 / 点燃 / 障碍盒移动都会把所在块(贴边时连邻块)标脏 WAKE 帧;块里这一帧有东西动了就续命,没动就倒计时到睡
const BS = 32, BSH = 5, BN = CHUNK >> BSH, NB = BN * BN
const WAKE = 3
const SIM_BLOCK_BUDGET = 160 // 活跃块超过这个数就对外围块隔帧步进(见 step)
// 按耗时自适应的降档:一步的平滑耗时 > SIM_BUDGET_MS 就把"每块几帧走一次"的档位 +1(最多 1/4 帧率),< SIM_RELAX_MS 再回来;
// 每次换档至少隔 LOD_DWELL 帧,免得抖。iPhone 上火海 1700 个活跃块光靠"> 320 块隔帧"还是 25~45ms(整机 20fps),
// 按机器实际速度限时才有意义 —— 反正掉到 20fps 整个世界也是 1/3 速,不如让模拟自己降速、操作和画面保持 60
const SIM_BUDGET_MS = 7, SIM_RELAX_MS = 3, LOD_MAX = 4, LOD_DWELL = 20
const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now()
// 八邻偏移(前 4 个是四邻):右 左 下 上 右下 左下 右上 左上;N8_OFF 是同 chunk 内的数组下标偏移
const N8_DX = [1, -1, 0, 0, 1, -1, 1, -1], N8_DY = [0, 0, 1, -1, 1, 1, -1, -1]
const N8_OFF = N8_DX.map((dx, k) => N8_DY[k] * CHUNK + dx)

export class CellSim {
  /**
   * WASM 内核(wasm/lib.rs,和下面的 JS 逐行对应):step 主循环跑 WASM,区块数据放在它的线性内存里(区块槽),JS 的 get / set / mark 在同一块内存的视图上做。
   * 拿不到(加载失败 / ?wasm=0)返回 null → 全 JS
   * @param {string|URL} url
   */
  static async loadWasm(url) {
    try {
      const r = await fetch(url)
      const { instance } = await WebAssembly.instantiate(await r.arrayBuffer(), {})
      return instance.exports
    } catch (e) { console.warn('cellsim.wasm', e); return null }
  }

  /**
   * @param {import('../core/materials.js').MaterialTable} mats
   * @param {Array} reactions  reactions.json
   * @param {{getChunk:(cx:number,cy:number)=>{mat:Uint16Array,aux?:Uint8Array,dirty:boolean}|null, onStaticChanged?:(cx:number,cy:number)=>void}} io
   * @param {object|null} [wasm]  CellSim.loadWasm 的返回
   */
  constructor(mats, reactions, io, wasm = null) {
    this.mats = mats
    this.io = io
    this.obst = null
    this.wasm = wasm
    const L = mats.list
    const n = L.length
    this.kind = new Uint8Array(n)
    this.density = new Float32Array(n)
    this.gravity = new Float32Array(n)     // liquid_gravity
    this.spread = new Uint8Array(n)        // 液体每步横向摊开格数(由 viscosity 推)
    this.burnable = new Uint8Array(n)
    this.autoign = new Float32Array(n)
    this.fireTemp = new Float32Array(n)
    this.fireHp = new Float32Array(n)
    this.smoke = new Uint8Array(n)
    this.lifetime = new Uint16Array(n)
    this.needsO2 = new Uint8Array(n)
    this.glow = new Uint8Array(n)
    for (const m of L) {
      const i = m.id
      this.kind[i] = KIND_ID[m.kind] ?? K_STATIC
      this.density[i] = m.density
      this.gravity[i] = m.liquidGravity
      this.spread[i] = Math.max(1, 5 - ((m.liquidViscosity || 0) / 20) | 0)
      this.burnable[i] = m.burnable ? 1 : 0
      this.autoign[i] = m.autoignitionTemperature
      this.fireTemp[i] = m.temperatureOfFire
      this.fireHp[i] = m.fireHp || 100
      this.smoke[i] = m.generatesSmoke ? 1 : 0
      this.lifetime[i] = m.lifetime
      this.needsO2[i] = m.requiresOxygen ? 1 : 0
      this.glow[i] = m.gfxGlow
    }
    this.M_FIRE = mats.byName.get('fire') ?? 1
    this.M_SMOKE = mats.byName.get('smoke') ?? 0
    this.M_STEAM = mats.byName.get('steam') ?? 0
    this._buildReactions(reactions)
    if (wasm) this._initWasm()
    // 窗口 chunk 表(最多 4×4)
    this.cx0 = 0; this.cy0 = 0; this.cw = 0; this.ch = 0
    this.tbl = new Array(16).fill(null)
    this.frame = 0
    this.stepped = 0
    this.activeBlocks = 0
    this.lod = 1; this.lodDwell = 0; this.stepMs = 0 // 当前降档档位(1 = 每帧全走)/ 距上次换档的帧数 / 一步耗时的平滑值
  }

  // ── WASM 内核:材质表 / 反应表写进它的内存,区块槽分配器 ──
  _initWasm() {
    const W = this.wasm, buf = W.memory.buffer, A = W.arena(), L = (k) => W.layout(k)
    const u8 = (off, n) => new Uint8Array(buf, A + off, n), u16 = (off, n) => new Uint16Array(buf, A + off, n), f32 = (off, n) => new Float32Array(buf, A + off, n)
    const n = this.kind.length
    u8(L(10), n).set(this.kind); u8(L(11), n).set(this.burnable); u8(L(12), n).set(this.smoke); u8(L(13), n).set(this.needsO2); u8(L(14), n).set(this.spread)
    u8(L(15), 1024).set(this.rxAny); u8(L(16), 1024).set(this.airRx); u16(L(17), n).set(this.lifetime)
    f32(L(18), n).set(this.density); f32(L(19), n).set(this.gravity); f32(L(20), n).set(this.autoign); f32(L(21), n).set(this.fireTemp); f32(L(22), n).set(this.fireHp)
    // 反应表:rxIdx[a*1024+b] = 链表头(1 起);rxList 每条 12 字节 {p f32, ox u16, oy u16, next u16}
    const idx = u16(L(23), 1024 * 1024), cap = L(25), list = new DataView(buf, A + L(24), cap * 12)
    let ni = 0
    for (const [k, l] of this.rx) {
      let head = 0
      for (let q = l.length - 1; q >= 0 && ni < cap; q--) { // 倒着插,链表顺序 = 原数组顺序
        const r = l[q], o = ni * 12
        list.setFloat32(o, r.p, true); list.setUint16(o + 4, r.ox, true); list.setUint16(o + 6, r.oy, true); list.setUint16(o + 8, head, true)
        head = ++ni
      }
      idx[k] = head
    }
    if (ni >= cap) console.warn('cellsim.wasm 反应表溢出', this.rxCount, cap)
    W.set_mats(this.M_FIRE, this.M_SMOKE)
    // 区块槽:每槽 mat u16 / aux u8 / act(块 TTL)/ tver(实心版本)/ sblk(静态变化块)/ flags([0] dirty [1] staticChanged);ChunkStreamer 收到区块时 alloc + 拷 mat
    const base = A + L(0), stride = L(1), count = L(2), oM = L(3), oA = L(4), oAct = L(5), oT = L(6), oS = L(7), oF = L(8)
    const free = []
    for (let i = count - 1; i >= 0; i--) free.push(i)
    const mk = (i) => { const b = base + i * stride; return { i, mat: new Uint16Array(buf, b + oM, N), aux: new Uint8Array(buf, b + oA, N), act: new Uint8Array(buf, b + oAct, NB), tver: new Uint16Array(buf, b + oT, NB), sblk: new Uint8Array(buf, b + oS, NB), flags: new Uint8Array(buf, b + oF, 16) } }
    const pool = new Map()
    this.slots = {
      alloc: () => { const i = free.pop(); if (i === undefined) { console.warn('cellsim.wasm 区块槽用完'); return null } W.clear_slot(i); let s = pool.get(i); if (!s) { s = mk(i); pool.set(i, s) } return s },
      free: (s) => { free.push(s.i) },
    }
  }

  // ── 脏块 ──
  /** 标脏 (wx,wy) 所在块;贴块边的格子连邻块一起标(邻块里压着的沙 / 挨着的液体才知道下面空了) */
  mark(wx, wy) {
    const e = this._entry(wx, wy)
    if (e) { if (!e.act) e.act = new Uint8Array(NB); e.act[((wy & 511) >> BSH) * BN + ((wx & 511) >> BSH)] = WAKE }
    const lx = wx & (BS - 1), ly = wy & (BS - 1)
    if (lx === 0) this._markOne(wx - 1, wy); else if (lx === BS - 1) this._markOne(wx + 1, wy)
    if (ly === 0) this._markOne(wx, wy - 1); else if (ly === BS - 1) this._markOne(wx, wy + 1)
  }
  _markOne(wx, wy) {
    const e = this._entry(wx, wy)
    if (!e) return
    if (!e.act) e.act = new Uint8Array(NB)
    e.act[((wy & 511) >> BSH) * BN + ((wx & 511) >> BSH)] = WAKE
  }
  /** 标脏一个世界矩形(爆炸 / 大范围改材质后) */
  markRect(x0, y0, x1, y1) {
    const bx0 = Math.floor(x0) >> BSH, bx1 = Math.floor(x1) >> BSH, by0 = Math.floor(y0) >> BSH, by1 = Math.floor(y1) >> BSH
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) this._markOne(bx * BS + 1, by * BS + 1)
  }

  _tagSets() {
    const sets = new Map()
    for (const m of this.mats.list) {
      for (const t of (m.tags || '').match(/\[[^\]]+\]/g) || []) {
        if (!sets.has(t)) sets.set(t, [])
        sets.get(t).push(m.id)
      }
    }
    sets.set('[any_liquid]', this.mats.list.filter((m) => m.kind === 'liquid').map((m) => m.id))
    return sets
  }

  /** 反应表展开成 (a,b) → [{p, outA, outB}];[tag] 输出 = 匹配到的那个输入;[tag]_xxx = 输入名+后缀 */
  _buildReactions(reactions) {
    const tags = this._tagSets()
    const byName = this.mats.byName
    const expand = (s) => (s.startsWith('[') ? tags.get(s) || [] : byName.has(s) ? [byName.get(s)] : [])
    const resolveOut = (spec, a, b, in1, in2) => {
      if (!spec) return -1
      if (spec.startsWith('[')) {
        const m = /^(\[[^\]]+\])(.*)$/.exec(spec)
        const src = m[1] === in1 ? a : m[1] === in2 ? b : -1
        if (src < 0) return -1
        if (!m[2]) return src
        const nm = this.mats.name(src) + m[2]
        return byName.has(nm) ? byName.get(nm) : -1
      }
      return byName.has(spec) ? byName.get(spec) : -1
    }
    this.rx = new Map()
    let n = 0
    for (const r of reactions) {
      if (r.in3 || r.reqLifetime > 200) continue // 三元/需长时接触的先不做
      const A = expand(r.in1), B = expand(r.in2)
      if (A.length * B.length > 40000) continue
      for (const a of A) for (const b of B) {
        if (a === b) continue
        const oa = resolveOut(r.out1, a, b, r.in1, r.in2), ob = resolveOut(r.out2, a, b, r.in1, r.in2)
        if (oa < 0 && ob < 0) continue
        const add = (x, y, ox, oy) => {
          const k = x * 1024 + y
          let l = this.rx.get(k)
          if (!l) { l = []; this.rx.set(k, l) }
          l.push({ p: r.p / 100, ox: ox < 0 ? x : ox, oy: oy < 0 ? y : oy, fast: r.fast })
          n++
        }
        add(a, b, oa, ob)
        add(b, a, ob, oa)
      }
    }
    this.rxCount = n
    // 会和空气反应的材质(蒸发类):这些格子不能睡
    this.airRx = new Uint8Array(1024)
    for (const k of this.rx.keys()) if ((k % 1024) === 0 && k > 0) this.airRx[k / 1024] = 1
    // 哪些材质作为反应的一方出现过:没出现过的(烟 / 大多数沙土)在 step 里直接跳过 _react 的 4 次邻格 + Map 查表
    this.rxAny = new Uint8Array(1024)
    for (const k of this.rx.keys()) this.rxAny[(k / 1024) | 0] = 1
  }

  // ── 窗口绑定 ──
  /**
   * 以世界矩形绑定激活窗口(最多 4×4 chunk);inner 是"必须就位"的子矩形(视口一圈),返回 false 表示 inner 里有 chunk 未就位。
   * 窗口比屏幕大一圈(Noita 也是模拟玩家周围一整片加载区,不只屏幕):外圈没到的 chunk 当 -1,不拦着模拟跑
   */
  bind(x0, y0, x1, y1, inner = null) {
    this.cx0 = Math.floor(x0 / CHUNK) + WCX; this.cy0 = Math.floor(y0 / CHUNK) + WCY
    const cx1 = Math.floor(x1 / CHUNK) + WCX, cy1 = Math.floor(y1 / CHUNK) + WCY
    this.cw = Math.min(4, cx1 - this.cx0 + 1); this.ch = Math.min(4, cy1 - this.cy0 + 1)
    this.wx0 = Math.floor(x0); this.wy0 = Math.floor(y0); this.wx1 = Math.floor(x1); this.wy1 = Math.floor(y1)
    // 视口矩形(inner):step 的 LOD 用 —— 看得见的块优先,窗口外圈(面积是视口的 3~4 倍)降更多
    this.ix0 = inner ? Math.floor(inner.x0) : this.wx0; this.iy0 = inner ? Math.floor(inner.y0) : this.wy0
    this.ix1 = inner ? Math.floor(inner.x1) : this.wx1; this.iy1 = inner ? Math.floor(inner.y1) : this.wy1
    const ix0 = inner ? Math.floor(inner.x0 / CHUNK) + WCX : this.cx0, ix1 = inner ? Math.floor(inner.x1 / CHUNK) + WCX : cx1
    const iy0 = inner ? Math.floor(inner.y0 / CHUNK) + WCY : this.cy0, iy1 = inner ? Math.floor(inner.y1 / CHUNK) + WCY : cy1
    let ok = true
    const W = this.wasm
    for (let j = 0; j < this.ch; j++) for (let i = 0; i < this.cw; i++) {
      const cx = this.cx0 + i, cy = this.cy0 + j
      const e = this.io.getChunk(cx, cy)
      if (e && !e.aux) e.aux = new Uint8Array(N)
      this.tbl[j * 4 + i] = e || null
      if (W) W.set_tbl(j * 4 + i, e?.slot ? e.slot.i : -1) // 没槽的区块(槽用完)WASM 不模拟,JS 的 get / set 照常
      if (!e && cx >= ix0 && cx <= ix1 && cy >= iy0 && cy <= iy1) ok = false
    }
    if (W) {
      for (let k = this.ch * 4; k < 16; k++) W.set_tbl(k, -1)
      for (let j = 0; j < this.ch; j++) for (let i = this.cw; i < 4; i++) W.set_tbl(j * 4 + i, -1)
      W.set_window(this.cx0 - WCX, this.cy0 - WCY, this.cw, this.ch, this.wx0, this.wy0, this.wx1, this.wy1, this.ix0, this.iy0, this.ix1, this.iy1)
    }
    return ok
  }

  _entry(wx, wy) {
    const i = (wx >> 9) + WCX - this.cx0, j = (wy >> 9) + WCY - this.cy0
    if (i < 0 || i >= this.cw || j < 0 || j >= this.ch) return null
    return this.tbl[j * 4 + i]
  }
  /** 世界坐标 → 材质 id;窗口外/未就位返回 -1 */
  get(wx, wy) {
    const e = this._entry(wx, wy)
    return e ? e.mat[(wy & 511) * CHUNK + (wx & 511)] : -1
  }
  aux(wx, wy) { const e = this._entry(wx, wy); return e ? e.aux[(wy & 511) * CHUNK + (wx & 511)] : 0 }
  /** 写材质(标 dirty;静态材质变化通知重画) */
  set(wx, wy, m, a = 0) {
    const e = this._entry(wx, wy)
    if (!e) return false
    const li = (wy & 511) * CHUNK + (wx & 511)
    const old = e.mat[li]
    if (old === m && e.aux[li] === a) return true
    if (this.kind[old] === K_STATIC || this.kind[m] === K_STATIC) {
      e.staticChanged = true
      ;(e.sdirty || (e.sdirty = new Uint8Array(256)))[((wy & 511) >> 5) * 16 + ((wx & 511) >> 5)] = 1 // 脏 32×32 块:重画只补这些块(ChunkStreamer._patch)
    }
    e.mat[li] = m; e.aux[li] = a; e.dirty = true
    this.mark(wx, wy)
    if ((this.kind[old] > 0 && this.kind[old] <= K_SAND) !== (this.kind[m] > 0 && this.kind[m] <= K_SAND)) this._bumpTver(e, wx, wy)
    return true
  }
  _swap(x1, y1, e1, i1, x2, y2) {
    // 绝大多数交换都在同一个 chunk 里(邻格),省掉一次 _entry;跨 chunk 边才查表
    const e2 = (x1 >> 9) === (x2 >> 9) && (y1 >> 9) === (y2 >> 9) ? e1 : this._entry(x2, y2)
    if (!e2) return false
    const i2 = (y2 & 511) * CHUNK + (x2 & 511)
    const m1 = e1.mat[i1], a1 = e1.aux[i1]
    e1.mat[i1] = e2.mat[i2]; e1.aux[i1] = e2.aux[i2]
    e2.mat[i2] = m1; e2.aux[i2] = a1
    e1.dirty = true; e2.dirty = true
    this._markL(e1, x1, y1); this._markL(e2, x2, y2)
    const s1 = this.kind[m1] > 0 && this.kind[m1] <= K_SAND, s2 = this.kind[e1.mat[i1]] > 0 && this.kind[e1.mat[i1]] <= K_SAND
    if (s1 !== s2) { this._bumpTver(e1, x1, y1); this._bumpTver(e2, x2, y2) }
    return true
  }
  /** 同 mark(),但调用方已知 (wx,wy) 所在 chunk 表项 e */
  _markL(e, wx, wy) {
    const lx = wx & 511, ly = wy & 511
    if (!e.act) e.act = new Uint8Array(NB)
    e.act[(ly >> BSH) * BN + (lx >> BSH)] = WAKE
    const bx = lx & (BS - 1), by = ly & (BS - 1)
    if (bx === 0) this._markOne(wx - 1, wy); else if (bx === BS - 1) this._markOne(wx + 1, wy)
    if (by === 0) this._markOne(wx, wy - 1); else if (by === BS - 1) this._markOne(wx, wy + 1)
  }
  // ── 实心版本号(给 Box2D 地形碰撞块判脏):每个 32×32 块一个计数,只在某格在"实心(static / solid / sand)↔ 非实心"之间变化时 +1;
  // 液体流动 / 气体飘 / 火烧(材质变但仍是实心 → 不算)都不碰它,所以碰撞块不会跟着水面每帧重建
  _bumpTver(e, wx, wy) {
    if (!e.tver) e.tver = new Uint16Array(NB)
    e.tver[((wy & 511) >> BSH) * BN + ((wx & 511) >> BSH)]++
  }
  /** (wx,wy) 所在 32×32 块的实心版本号;chunk 未就位返回 -1 */
  tver(wx, wy) {
    const e = this._entry(wx, wy)
    if (!e) return -1
    return e.tver ? e.tver[((wy & 511) >> BSH) * BN + ((wx & 511) >> BSH)] : 0
  }
  /** 刚体撞的实心(static / solid / sand;窗口外当实心) */
  solidB(wx, wy) {
    const m = this.get(wx, wy)
    if (m < 0) return true
    const k = this.kind[m]
    return k > 0 && k <= K_SAND
  }

  // ── 一步:只步进脏块(块内自下而上、交替左右;块之间也自下而上,和整窗口扫的顺序一致)──
  step() {
    const t0 = now()
    this.frame++
    const dirR = this.frame & 1 // 交替扫描方向,消除横向偏置
    const K = this.kind, LIFE = this.lifetime, RXA = this.rxAny
    let moved = 0, active = 0
    // 过载 LOD:上一帧活跃块超过 SIM_BLOCK_BUDGET(连开陨石一屏 300 个火坑块、6 万格在动,手机上模拟 60~100ms)时,视口外的块隔帧步进 ——
    // 屏幕外坑里的火慢一倍看不出来;正常一屏 80~150 块不触发。跳过的块 ttl 不减(别把它们提前睡掉)
    // 再翻一倍(> 2×预算)视口内也隔帧;之上再按实测耗时升档(this.lod,见文件头常数):视口内每 lvlIn 帧走一块,视口外 2 倍(最多 1/8)——
    // iPhone 上报的火海 1700 个活跃块里看得见的只有 130 个左右(模拟窗口 = 视口 + 512 边距,面积是视口的十几倍),外圈才是大头
    const lvlIn = Math.max(this.lod, this.activeBlocks > SIM_BLOCK_BUDGET * 2 ? 2 : 1)
    const lvlOut = this.activeBlocks > SIM_BLOCK_BUDGET ? Math.min(8, Math.max(2, lvlIn * 2)) : lvlIn
    const ix0 = this.ix0, iy0 = this.iy0, ix1 = this.ix1, iy1 = this.iy1
    if (this.wasm) {
      // 主循环在 WASM 里(同样的规则);跑完把每个槽的 dirty / staticChanged / 静态变化块 收回到 entry 上(JS 侧的 set 也写这些字段,两边合并)
      moved = this.wasm.step(this.frame, lvlIn, lvlOut, (Math.random() * 0x7fffffff) | 0)
      active = this.wasm.active()
      for (let j = 0; j < this.ch; j++) for (let i = 0; i < this.cw; i++) {
        const e = this.tbl[j * 4 + i], s = e?.slot
        if (!s) continue
        const F = s.flags
        if (F[0]) { F[0] = 0; e.dirty = true }
        if (F[1]) {
          F[1] = 0; e.staticChanged = true
          const sd = e.sdirty || (e.sdirty = new Uint8Array(256)), sb = s.sblk
          for (let b = 0; b < 256; b++) if (sb[b]) { sd[b] = 1; sb[b] = 0 }
        }
      }
    } else
    for (let j = this.ch - 1; j >= 0; j--) {
      for (let by = BN - 1; by >= 0; by--) {
        for (let i = 0; i < this.cw; i++) {
          const e = this.tbl[j * 4 + i]
          if (!e || !e.act) continue
          const ax0 = (this.cx0 + i - WCX) * CHUNK, ay0 = (this.cy0 + j - WCY) * CHUNK
          for (let bx = 0; bx < BN; bx++) {
            const b = by * BN + bx
            const ttl = e.act[b]
            if (!ttl) continue
            active++
            const x0 = Math.max(this.wx0, ax0 + bx * BS), x1 = Math.min(this.wx1, ax0 + bx * BS + BS - 1)
            const y0 = Math.max(this.wy0, ay0 + by * BS), y1 = Math.min(this.wy1, ay0 + by * BS + BS - 1)
            if (x0 > x1 || y0 > y1) continue
            const lvl = x1 < ix0 || x0 > ix1 || y1 < iy0 || y0 > iy1 ? lvlOut : lvlIn // 块和视口不相交 → 外圈档位
            if (lvl > 1 && (bx + by + this.frame) % lvl) continue
            e.act[b] = ttl - 1 // 这一帧里有格子动了会被 mark() 重新续成 WAKE
            let keep = 0 // 块里有火 / 有寿命的气 / 正在烧的格 → 块要一直醒着(块结束时一次续命,不再每格调 _markOne)
            for (let wy = y1; wy >= y0; wy--) {
              const row = (wy & 511) * CHUNK
              for (let k = 0; k <= x1 - x0; k++) {
                const wx = dirR ? x0 + k : x1 - k
                const li = row + (wx & 511)
                const m = e.mat[li]
                if (m === 0) continue
                const k0 = K[m]
                if (k0 === K_STATIC) { if (e.aux[li]) { this._burnStatic(wx, wy, e, li, m); keep = 1 } continue }
                if (k0 === K_SAND) moved += this._sand(wx, wy, e, li, m)
                else if (k0 === K_LIQUID) moved += this._liquid(wx, wy, e, li, m)
                else if (k0 === K_GAS) { moved += this._gas(wx, wy, e, li, m); if (LIFE[m]) keep = 1 } // 有寿命的气要一直走时钟
                else if (k0 === K_FIRE) { moved += this._fire(wx, wy, e, li, m); keep = 1 }
                const m2 = e.mat[li] // 动过之后这格可能换了东西(换进来的液体 / 空气)
                if (m2 === 0) continue
                if (e.aux[li]) { const k2 = K[m2]; if (k2 !== K_FIRE && k2 !== K_GAS) { this._burnStatic(wx, wy, e, li, m2); keep = 1 } }
                if (RXA[m2] && ((this.frame + wx) & 1)) this._react(wx, wy, e, li)
              }
            }
            if (keep) e.act[b] = WAKE
          }
        }
      }
    }
    this.stepped = moved
    this.activeBlocks = active
    // 按耗时换档(见 SIM_BUDGET_MS 注释):平滑后 > 预算升一档,< 松弛线降一档,两次换档间至少隔 LOD_DWELL 帧
    this.stepMs = this.stepMs * 0.9 + (now() - t0) * 0.1 // 平滑慢一点:一次爆炸把几百个块一起标醒的单帧尖峰不该直接把档位推上去
    if (++this.lodDwell >= LOD_DWELL) {
      if (this.stepMs > SIM_BUDGET_MS && this.lod < LOD_MAX) { this.lod++; this.lodDwell = 0 }
      else if (this.stepMs < SIM_RELAX_MS && this.lod > 1) { this.lod--; this.lodDwell = 0 }
    }
    // 静态材质有变化的 chunk 通知外面重画位图
    for (let j = 0; j < this.ch; j++) for (let i = 0; i < this.cw; i++) {
      const e = this.tbl[j * 4 + i]
      if (e && e.staticChanged) { e.staticChanged = false; this.io.onStaticChanged?.(this.cx0 + i, this.cy0 + j) }
    }
  }

  /**
   * 障碍盒(玩家身体):液体/沙不流进去(Noita 里角色对液体是实体,LiquidDisplacerComponent 再把重叠的挤出去)。
   * 传 null 清除。整数世界坐标,闭区间。
   */
  setObstacle(x0, y0, x1, y1) {
    this.obst = x0 == null ? null : { x0, y0, x1, y1 }
    if (this.wasm) this.wasm.set_obst(this.obst ? 1 : 0, x0 | 0, y0 | 0, x1 | 0, y1 | 0)
    // 玩家周围要一直醒着(踩进水洼 / 挤开液体 / 走在沙上),盒子外扩 8px
    if (this.obst) this.markRect(x0 - 8, y0 - 8, x1 + 8, y1 + 8)
  }
  _blocked(tx, ty) { const o = this.obst; return o !== null && o !== undefined && tx >= o.x0 && tx <= o.x1 && ty >= o.y0 && ty <= o.y1 }

  /** 目标格能否被 m 占据(交换):空/气,或更轻的液体 */
  _canSink(m, tx, ty) {
    const t = this.get(tx, ty)
    if (t < 0) return false
    if (this.obst && this._blocked(tx, ty)) return false
    if (t === 0) return true
    const kt = this.kind[t]
    if (kt === K_GAS || kt === K_FIRE) return true
    if (kt === K_LIQUID) return this.density[t] < this.density[m]
    return false
  }

  _sand(x, y, e, li, m) {
    // liquid_gravity 大的下落更快(每帧多试一格),小的偶尔停一帧
    const g = this.gravity[m]
    if (g < 1 && Math.random() > g + 0.3) return 0
    if (this._canSink(m, x, y + 1)) { this._swap(x, y, e, li, x, y + 1); if (g > 1.5 && this._canSink(m, x, y + 2)) this._swap(x, y + 1, this._entry(x, y + 1), ((y + 1) & 511) * CHUNK + (x & 511), x, y + 2); return 1 }
    const d = Math.random() < 0.5 ? -1 : 1
    if (this._canSink(m, x + d, y + 1) && this._canSink(m, x + d, y)) { this._swap(x, y, e, li, x + d, y + 1); return 1 }
    if (this._canSink(m, x - d, y + 1) && this._canSink(m, x - d, y)) { this._swap(x, y, e, li, x - d, y + 1); return 1 }
    return 0
  }

  _liquid(x, y, e, li, m) {
    const g = this.gravity[m]
    if (this._canSink(m, x, y + 1)) { if (Math.random() < Math.min(1, 0.35 + g * 0.5)) this._swap(x, y, e, li, x, y + 1); return 1 }
    const d = Math.random() < 0.5 ? -1 : 1
    if (this._canSink(m, x + d, y + 1)) { this._swap(x, y, e, li, x + d, y + 1); return 1 }
    if (this._canSink(m, x - d, y + 1)) { this._swap(x, y, e, li, x - d, y + 1); return 1 }
    // 横向摊开:黏度越低跑得越远
    const sp = this.spread[m]
    let tx = x
    for (let k = 1; k <= sp; k++) {
      const t = this.get(x + d * k, y)
      if ((t === 0 || (t > 0 && this.kind[t] === K_GAS)) && !(this.obst && this._blocked(x + d * k, y))) tx = x + d * k
      else break
    }
    if (tx !== x) { this._swap(x, y, e, li, tx, y); return 1 }
    return 0
  }

  _gas(x, y, e, li, m) {
    // lifetime=0 的 *_static 气(真菌洞的 acid_gas_static / smoke_static):不散、不飘,原地待着直到被烧/被挖
    if (this.lifetime[m] === 0) return 0
    // 寿命:aux 存 剩余/4;0 = 刚生成 → 初始化
    let a = e.aux[li]
    if (a === 0) a = Math.max(1, Math.min(255, ((this.lifetime[m] || 240) / 4 + Math.random() * 20) | 0))
    if ((this.frame & 3) === 0) a--
    if (a <= 0) { this.set(x, y, 0); return 1 }
    e.aux[li] = a
    // 不贴 chunk 边的格子直接读本 chunk 数组(烟是火海里数量最多的动格,省掉 3 次 get → _entry)
    const lx = x & 511, inner = lx > 0 && lx < 511 && (y & 511) > 0
    const up = inner ? e.mat[li - CHUNK] : this.get(x, y - 1)
    const canUp = up === 0 || (up > 0 && (this.kind[up] === K_LIQUID || (this.kind[up] === K_GAS && this.density[up] > this.density[m])))
    const r = Math.random()
    if (canUp && r < 0.7) { this._swap(x, y, e, li, x, y - 1); return 1 }
    const d = r < 0.85 ? -1 : 1
    const side = inner ? e.mat[li + d] : this.get(x + d, y)
    if (side === 0) { this._swap(x, y, e, li, x + d, y); return 1 }
    const diag = inner ? e.mat[li + d - CHUNK] : this.get(x + d, y - 1)
    if (diag === 0) { this._swap(x, y, e, li, x + d, y - 1); return 1 }
    return 0
  }

  _fire(x, y, e, li, m) {
    let a = e.aux[li]
    if (a === 0) a = 6 + ((Math.random() * 10) | 0)
    a--
    const K = this.kind, lx = x & 511, ly = y & 511, inner = lx > 0 && lx < 511 && ly > 0 && ly < 511 // 八邻都在本 chunk 里 → 直接读数组
    // 需要氧气:四邻一个空格都没有就熄
    let air = 0
    for (let k = 0; k < 4; k++) {
      const t = inner ? e.mat[li + N8_OFF[k]] : this.get(x + N8_DX[k], y + N8_DY[k])
      if (t === 0 || (t > 0 && K[t] === K_GAS)) air++
    }
    if (a <= 0 || (this.needsO2[m] && air === 0)) { this.set(x, y, this.M_SMOKE && Math.random() < 0.25 ? this.M_SMOKE : 0); return 1 }
    e.aux[li] = a
    // 点燃邻居
    const T = this.fireTemp[m]
    for (let k = 0; k < 8; k++) {
      const t = inner ? e.mat[li + N8_OFF[k]] : this.get(x + N8_DX[k], y + N8_DY[k])
      if (t <= 0 || !this.burnable[t] || this.autoign[t] > T) continue
      const ne = inner ? e : this._entry(x + N8_DX[k], y + N8_DY[k]), ni = inner ? li + N8_OFF[k] : ((y + N8_DY[k]) & 511) * CHUNK + ((x + N8_DX[k]) & 511)
      if (ne.aux[ni] === 0 && Math.random() < 0.12) { ne.aux[ni] = 1; ne.dirty = true }
    }
    // 火苗上飘
    if (Math.random() < 0.55) {
      const up = inner ? e.mat[li - CHUNK] : this.get(x, y - 1)
      if (up === 0) { this._swap(x, y, e, li, x, y - 1); return 1 }
      const d = Math.random() < 0.5 ? -1 : 1
      if ((inner ? e.mat[li + d - CHUNK] : this.get(x + d, y - 1)) === 0) { this._swap(x, y, e, li, x + d, y - 1); return 1 }
    }
    return 0
  }

  /** 正在燃烧的材质(aux>0):往上方空格吐火,按 fire_hp 消耗,烧完变空气/烟 */
  _burnStatic(x, y, e, li, m) {
    if (!this.burnable[m]) { e.aux[li] = 0; return }
    let a = e.aux[li]
    // 消耗速度 ∝ 1/fire_hp:oil 500 烧得久,gunpowder 0(→100)瞬燃
    const rate = Math.max(1, Math.min(60, (6000 / this.fireHp[m]) | 0))
    a = Math.min(255, a + rate)
    e.aux[li] = a; e.dirty = true
    for (let k = 0; k < 3; k++) {
      const nx = x + (k === 0 ? 0 : k === 1 ? -1 : 1), ny = y - 1
      if (this.get(nx, ny) === 0 && Math.random() < 0.3) this.set(nx, ny, this.M_FIRE, 4 + ((Math.random() * 8) | 0))
    }
    // 把火传给相邻可燃格(液体里火会蔓延)
    if (Math.random() < 0.2) {
      const nx = x + (Math.random() < 0.5 ? -1 : 1), ny = y + ((Math.random() * 3) | 0) - 1
      const t = this.get(nx, ny)
      if (t > 0 && this.burnable[t] && this.autoign[t] <= this.fireTemp[this.M_FIRE]) { const ne = this._entry(nx, ny), ni = (ny & 511) * CHUNK + (nx & 511); if (ne.aux[ni] === 0) { ne.aux[ni] = 1; ne.dirty = true } }
    }
    if (a >= 255) this.set(x, y, this.smoke[m] && this.M_SMOKE && Math.random() < 0.5 ? this.M_SMOKE : (Math.random() < 0.5 ? this.M_FIRE : 0), 0)
  }

  _react(x, y, e, li) {
    const m = e.mat[li]
    if (!m) return
    // 和空气也会反应:[evaporable_fast] + air → air(45%,激光 / 等离子的 plasma_fading 落地几帧就没)、[evaporable] + air(15%,血 / 泥浆的水渍慢慢干掉);
    // 这类格子要一直醒着,不然停在地上块睡了就永远留一片痕迹(用户:子弹和地图接触后物质不消失)
    if (this.airRx[m]) this._markOne(x, y)
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0)
      const t = this.get(nx, ny)
      if (t < 0) continue
      const list = this.rx.get(m * 1024 + t)
      if (!list) continue
      for (const r of list) {
        if (Math.random() >= r.p * 0.5) continue // probability 是"每帧%",这里隔格隔帧检查 → 乘 0.5 等效
        this.set(x, y, r.ox, 0)
        this.set(nx, ny, r.oy, 0)
        return
      }
    }
  }

  /** 世界坐标圆形写材质(挖洞 / 倒液体) */
  paintCircle(wx, wy, r, m, aux = 0) {
    for (let y = Math.floor(wy - r); y <= Math.ceil(wy + r); y++)
      for (let x = Math.floor(wx - r); x <= Math.ceil(wx + r); x++)
        if ((x - wx) ** 2 + (y - wy) ** 2 <= r * r) this.set(x, y, m, aux)
  }
}

export { K_AIR, K_STATIC, K_SAND, K_LIQUID, K_GAS, K_FIRE }
