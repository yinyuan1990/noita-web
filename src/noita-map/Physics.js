// ── Box2D 世界(planck.js = Box2D 2.3 的 JS 重写;原版 Noita 内嵌的正是 Box2D 2.3.0)──
// 反 noita_dev.exe 得到的规则(docs/noita-entities-plan.md 2.4 第 29 条):
//   · 1 Box2D 米 = 6 游戏像素(PhysicsPosToGamePos = phys × 6 + 256;PhysicsVecToGameVec 只 ×6)
//   · GridWorld::UpdateBox2D 固定 dt = 1/60
//   · 地形 → 碰撞体:Box2DTerrain::ParseIntoPolygons_Threaded,marching squares(带洞)描轮廓,只在 Box2D_SetUpdateRect 定的更新区里做
//     (两个阈值 350² / 750²:近圈全更新、远圈只维持)
// 这里的地形碰撞:按 CellSim 的 32×32 块做 marching squares → Douglas-Peucker 简化 → planck Chain(地形不需要三角化,edge 两面都碰);
//   只给"醒着的动态刚体"包围盒 ±TERRAIN_NEAR 内的块建;块里格子的实心性变了(CellSim.tver)就重建;久不用的块释放。
import { World, Vec2, Chain, Box, Circle, Settings, AABB } from 'planck'

export const PPM = 6            // pixels per meter
export const FIXED_DT = 1 / 60
const TILE = 32                 // 地形碰撞块 = CellSim 的睡眠块(chunk 内 32×32 对齐)
const TERRAIN_NEAR = 24         // 醒着的刚体包围盒外扩多少 px 就要有地形(每帧最多走 12px = maxTranslation 2m)
const TILE_TTL = 120            // 块 N 帧没被任何刚体用到就释放
const MAX_BUILD_PER_FRAME = 6   // 每帧最多重建几块(单块 33×33 采样 + 描边 ≈ 0.05ms)
const SIMPLIFY_EPS = 0.6        // Douglas-Peucker 容差(px):1:1 的 45° 台阶已经是直线,1:2 / 1:3 的斜坡会被拉直

// planck 的 maxPolygonVertices 默认 12,Box2D 2.3 是 8;地形用 chain 不受限。velocityThreshold 1 m/s = 6 px/s:比这慢的碰撞不弹
Settings.maxPolygonVertices = 8

export class Physics {
  /**
   * @param {import('./sim/CellSim.js').CellSim} sim
   * @param {{gravity?:number, friction?:number}} [opt]  gravity 是 px/s²(b2World 的重力还没从 exe 反出来,先用刚体一直在用的 350)
   */
  constructor(sim, opt = {}) {
    this.sim = sim
    this.gravity = opt.gravity ?? 350
    this.terrainFriction = opt.friction ?? 0.6
    this.world = new World({ gravity: new Vec2(0, this.gravity / PPM), allowSleep: true })
    this.ground = this.world.createBody({ type: 'static' })
    this.tiles = new Map() // "tx,ty" → { fixtures: Fixture[], ver, last, verts }
    this.frame = 0
    this.acc = 0
    this.stats = { tiles: 0, built: 0, bodies: 0, awake: 0, ms: 0 }
    this.testBodies = []
  }

  // ── 单位 ──
  static toM(px) { return px / PPM }
  static toPx(m) { return m * PPM }

  /** 每帧调用:按固定 1/60 步进(dt 大于一帧就多步,最多 3 步,别在掉帧时越追越慢) */
  step(dt) {
    this.acc = Math.min(this.acc + dt, FIXED_DT * 3)
    const t0 = performance.now()
    while (this.acc >= FIXED_DT - 1e-9) {
      this.acc -= FIXED_DT
      this.frame++
      this._refreshTerrain()
      this.world.step(FIXED_DT, 8, 3)
    }
    this.stats.ms = performance.now() - t0
  }

  // ── 地形 ──
  /**
   * 需要的块 = 动态刚体包围盒外扩 TERRAIN_NEAR 覆盖到的块(睡着的也算:脚下被挖了要靠块重建来叫醒它);
   * 缺的 / 版本变了的重建,重建时把压在这块上的刚体叫醒(Box2D 换 fixture 不会自己唤醒别人);久不用的释放。
   * userData.noTerrain 的刚体(第 ③ 步以后睡着写进格子的)不算 —— 那时像素在格子里,由 audit 管
   */
  _refreshTerrain() {
    const need = new Set()
    let bodies = 0, awake = 0
    for (let b = this.world.getBodyList(); b; b = b.getNext()) {
      if (!b.isDynamic()) continue
      bodies++
      if (b.isAwake()) awake++
      else if (b.getUserData()?.noTerrain) continue
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (let f = b.getFixtureList(); f; f = f.getNext()) {
        const n = f.getShape().getChildCount()
        for (let i = 0; i < n; i++) {
          const a = f.getAABB(i)
          if (a.lowerBound.x < x0) x0 = a.lowerBound.x; if (a.lowerBound.y < y0) y0 = a.lowerBound.y
          if (a.upperBound.x > x1) x1 = a.upperBound.x; if (a.upperBound.y > y1) y1 = a.upperBound.y
        }
      }
      if (x0 === Infinity) continue
      const tx0 = Math.floor((x0 * PPM - TERRAIN_NEAR) / TILE), tx1 = Math.floor((x1 * PPM + TERRAIN_NEAR) / TILE)
      const ty0 = Math.floor((y0 * PPM - TERRAIN_NEAR) / TILE), ty1 = Math.floor((y1 * PPM + TERRAIN_NEAR) / TILE)
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) need.add(tx * 65536 + (ty & 65535))
    }
    this.stats.bodies = bodies; this.stats.awake = awake
    let built = 0
    for (const key of need) {
      const tx = Math.floor(key / 65536), ty = (key & 65535) << 16 >> 16 // 还原有符号的 ty
      let t = this.tiles.get(key)
      const ver = this._tileVersion(tx, ty)
      if (ver < 0) continue // chunk 没就位:先不建(刚体飞到没加载的地方是 Noita 也头疼的事,PhysicsKeepInWorld 那一套以后再说)
      if (t && t.ver === ver) { t.last = this.frame; continue }
      if (built >= MAX_BUILD_PER_FRAME) { if (t) t.last = this.frame; continue } // 这帧预算用完:老的先顶着,下帧再换
      const fresh = !t
      if (!t) { t = { fixtures: [], ver: -1, last: 0, verts: 0 }; this.tiles.set(key, t) }
      this._buildTile(t, tx, ty, ver)
      t.last = this.frame
      built++
      // 块内容变了(不是第一次建):压在上面 / 挨着的睡着刚体叫醒,让它重新落 / 重新找支撑(原版:支撑没了 PhysicsBridge 会唤醒)
      if (!fresh) {
        const aabb = new AABB(new Vec2((tx * TILE - 2) / PPM, (ty * TILE - 2) / PPM), new Vec2(((tx + 1) * TILE + 2) / PPM, ((ty + 1) * TILE + 2) / PPM))
        this.world.queryAABB(aabb, (f) => { const b = f.getBody(); if (b.isDynamic() && !b.isAwake()) b.setAwake(true); return true })
      }
    }
    if (built) this.stats.built += built
    // 释放久不用的
    if ((this.frame & 31) === 0) {
      for (const [key, t] of this.tiles) {
        if (this.frame - t.last <= TILE_TTL) continue
        for (const f of t.fixtures) this.ground.destroyFixture(f)
        this.tiles.delete(key)
      }
    }
    this.stats.tiles = this.tiles.size
  }

  /** 块的版本 = 自己 + 右 / 下 / 右下邻块(采样 33×33 要读邻块第一行/列);任一 chunk 未就位返回 -1 */
  _tileVersion(tx, ty) {
    const x = tx * TILE, y = ty * TILE
    const a = this.sim.tver(x, y), b = this.sim.tver(x + TILE, y), c = this.sim.tver(x, y + TILE), d = this.sim.tver(x + TILE, y + TILE)
    if (a < 0 || b < 0 || c < 0 || d < 0) return -1
    return a + b * 131 + c * 17161 + d * 2248091 // 任一变了组合就变(不需要唯一,只要不同步碰巧相等的概率够低)
  }

  /** 重建一块:33×33 采样 → marching squares 段 → 连成折线 → 简化 → Chain fixtures */
  _buildTile(t, tx, ty, ver) {
    for (const f of t.fixtures) this.ground.destroyFixture(f)
    t.fixtures.length = 0; t.ver = ver; t.verts = 0
    const x0 = tx * TILE, y0 = ty * TILE, S = TILE + 1
    const g = this._grid || (this._grid = new Uint8Array(S * S))
    const sim = this.sim
    let any = 0, all = 1
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const s = sim.solidB(x0 + i, y0 + j) ? 1 : 0; g[j * S + i] = s; any |= s; all &= s }
    if (!any || all) return // 全空 / 全实心:块内没有边界
    const lines = marchingSquares(g, S, S, x0, y0)
    for (const line of lines) {
      const pts = simplify(line, SIMPLIFY_EPS)
      if (pts.length < 2) continue
      const vs = pts.map((p) => new Vec2(p[0] / PPM, p[1] / PPM))
      const loop = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]
      if (loop) vs.pop()
      if (vs.length < (loop ? 3 : 2)) continue
      const f = this.ground.createFixture(new Chain(vs, loop), { friction: this.terrainFriction, restitution: 0 })
      f.setUserData({ terrain: true, tx, ty })
      t.fixtures.push(f)
      t.verts += vs.length
    }
  }

  // ── 测试刚体(第 ① 步验证用:`?physTest=1` 在出生点上方丢几个箱子 / 圆,看它们落到真实地形上停稳)──
  addTestBox(x, y, w = 8, h = 8, opt = {}) {
    const b = this.world.createBody({ type: 'dynamic', position: new Vec2(x / PPM, y / PPM), angle: opt.angle || 0, linearDamping: 0, angularDamping: 0 })
    b.createFixture(new Box(w / 2 / PPM, h / 2 / PPM), { density: opt.density ?? 1, friction: opt.friction ?? 0.5, restitution: opt.restitution ?? 0.1 })
    b.setUserData({ test: true, w, h })
    this.testBodies.push(b)
    return b
  }
  addTestCircle(x, y, r = 4, opt = {}) {
    const b = this.world.createBody({ type: 'dynamic', position: new Vec2(x / PPM, y / PPM) })
    b.createFixture(new Circle(r / PPM), { density: opt.density ?? 1, friction: opt.friction ?? 0.5, restitution: opt.restitution ?? 0.1 })
    b.setUserData({ test: true, r })
    this.testBodies.push(b)
    return b
  }
  /** 探针用:测试刚体的位置 / 速度 / 醒睡 */
  testState() {
    return this.testBodies.map((b) => { const p = b.getPosition(), v = b.getLinearVelocity(); return { x: +(p.x * PPM).toFixed(2), y: +(p.y * PPM).toFixed(2), vx: +(v.x * PPM).toFixed(1), vy: +(v.y * PPM).toFixed(1), rot: +b.getAngle().toFixed(3), awake: b.isAwake() } })
  }

  /** 调试画:地形 chain(绿)、测试刚体(黄) */
  debugDraw(ctx, ox, oy) {
    ctx.save()
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(80,255,120,0.7)'
    for (const t of this.tiles.values()) {
      for (const f of t.fixtures) {
        const sh = f.getShape()
        const vs = sh.m_vertices
        if (!vs || vs.length < 2) continue
        ctx.beginPath()
        ctx.moveTo(vs[0].x * PPM - ox, vs[0].y * PPM - oy)
        for (let i = 1; i < vs.length; i++) ctx.lineTo(vs[i].x * PPM - ox, vs[i].y * PPM - oy)
        if (sh.m_isLoop) ctx.closePath()
        ctx.stroke()
      }
    }
    for (let b = this.world.getBodyList(); b; b = b.getNext()) {
      if (!b.isDynamic()) continue
      ctx.strokeStyle = b.isAwake() ? 'rgba(255,220,80,0.9)' : 'rgba(255,220,80,0.4)'
      const p = b.getPosition(), a = b.getAngle()
      for (let f = b.getFixtureList(); f; f = f.getNext()) {
        const sh = f.getShape()
        ctx.save(); ctx.translate(p.x * PPM - ox, p.y * PPM - oy); ctx.rotate(a)
        if (sh.getType() === 'circle') { ctx.beginPath(); ctx.arc(sh.m_p.x * PPM, sh.m_p.y * PPM, sh.m_radius * PPM, 0, Math.PI * 2); ctx.stroke() }
        else if (sh.m_vertices) { ctx.beginPath(); const vs = sh.m_vertices; ctx.moveTo(vs[0].x * PPM, vs[0].y * PPM); for (let i = 1; i < vs.length; i++) ctx.lineTo(vs[i].x * PPM, vs[i].y * PPM); ctx.closePath(); ctx.stroke() }
        ctx.restore()
      }
    }
    ctx.restore()
  }
}

// ── marching squares(二值格 → 等值线段 → 折线)──
// 采样点 = 格中心 (x+0.5, y+0.5);每个 2×2 采样块按 16 种情况在边中点之间连线;鞍点(5 / 10)两段都连(方向随意,chain 两面都碰)。
// 返回 [[x,y],...] 折线数组(世界像素坐标,闭合的首尾同点)
export function marchingSquares(g, W, H, x0, y0) {
  // 边中点编号:0 上 (x+1, y+0.5) · 1 右 (x+1.5, y+1) · 2 下 (x+1, y+1.5) · 3 左 (x+0.5, y+1);块左上采样格 (x,y)
  const SEG = [
    [], [3, 0], [0, 1], [3, 1], [1, 2], [3, 0, 1, 2], [0, 2], [3, 2],
    [2, 3], [2, 0], [0, 3, 1, 2], [2, 1], [1, 3], [1, 0], [0, 3], [],
  ]
  // 端点用 2 倍整数坐标做 key(边中点都是 .5 / 整数)
  const adj = new Map() // key → [[key2,...]]
  const pt = new Map()  // key → [x,y]
  const keyOf = (x2, y2) => x2 * 262144 + (y2 & 262143)
  const mid = (x, y, e) => (e === 0 ? [2 * x + 2, 2 * y + 1] : e === 1 ? [2 * x + 3, 2 * y + 2] : e === 2 ? [2 * x + 2, 2 * y + 3] : [2 * x + 1, 2 * y + 2])
  const link = (a, b) => {
    const ka = keyOf(a[0], a[1]), kb = keyOf(b[0], b[1])
    if (!pt.has(ka)) pt.set(ka, a); if (!pt.has(kb)) pt.set(kb, b)
    let la = adj.get(ka); if (!la) adj.set(ka, (la = [])); la.push(kb)
    let lb = adj.get(kb); if (!lb) adj.set(kb, (lb = [])); lb.push(ka)
  }
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
    const c = g[j * W + i] | (g[j * W + i + 1] << 1) | (g[(j + 1) * W + i + 1] << 2) | (g[(j + 1) * W + i] << 3)
    const s = SEG[c]
    for (let k = 0; k < s.length; k += 2) link(mid(i, j, s[k]), mid(i, j, s[k + 1]))
  }
  // 连成折线:先从度 1 的端点(开口线)走,再收闭环
  const used = new Set()
  const lines = []
  const walk = (start) => {
    const line = []
    let prev = -1, cur = start
    for (;;) {
      const p = pt.get(cur); line.push([p[0] / 2 + x0, p[1] / 2 + y0]); used.add(cur)
      const nb = adj.get(cur)
      let next = -1
      for (const k of nb) { if (k !== prev && !used.has(k)) { next = k; break } }
      if (next < 0) {
        // 闭环回到起点
        if (line.length > 2 && nb.includes(start) && prev !== start) line.push(line[0].slice())
        break
      }
      prev = cur; cur = next
    }
    return line
  }
  for (const [k, nb] of adj) if (nb.length === 1 && !used.has(k)) lines.push(walk(k))
  for (const k of adj.keys()) if (!used.has(k)) lines.push(walk(k))
  return lines
}

/** Douglas-Peucker(迭代版) */
export function simplify(pts, eps) {
  if (pts.length <= 2) return pts
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  const e2 = eps * eps
  while (stack.length) {
    const [a, b] = stack.pop()
    if (b - a < 2) continue
    const ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1]
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy
    let best = -1, bd = e2
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] - ax, py = pts[i][1] - ay
      let d2
      if (L2 < 1e-9) d2 = px * px + py * py
      else { const t = Math.max(0, Math.min(1, (px * dx + py * dy) / L2)); const qx = px - t * dx, qy = py - t * dy; d2 = qx * qx + qy * qy }
      if (d2 > bd) { bd = d2; best = i }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]) }
  }
  const out = []
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i])
  return out
}
