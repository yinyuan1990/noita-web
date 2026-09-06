// ── Box2D 世界(planck.js = Box2D 2.3 的 JS 重写;原版 Noita 内嵌的正是 Box2D 2.3.0)──
// 反 noita_dev.exe 得到的规则(docs/noita-entities-plan.md 2.4 第 29 条):
//   · 1 Box2D 米 = 6 游戏像素(PhysicsPosToGamePos = phys × 6 + 256;PhysicsVecToGameVec 只 ×6)
//   · GridWorld::UpdateBox2D 固定 dt = 1/60
//   · 地形 → 碰撞体:Box2DTerrain::ParseIntoPolygons_Threaded,marching squares(带洞)描轮廓,只在 Box2D_SetUpdateRect 定的更新区里做
//     (两个阈值 350² / 750²:近圈全更新、远圈只维持)
// 这里的地形碰撞:按 CellSim 的 32×32 块做 marching squares → Douglas-Peucker 简化 → 耳切三角化(洞桥接)→ 合并成 ≤8 顶点凸块 → planck Polygon
//   (和原版一样是多边形;chain 在 Box2D 2.3 里会让平放的箱子在顶点上永远抖,见 _buildTile);
//   只给动态刚体包围盒 ±TERRAIN_NEAR 内的块建;块里格子的实心性变了(CellSim.tver)就重建;久不用的块释放。
import { World, Vec2, Box, Circle, Polygon, Settings, RevoluteJoint, WeldJoint } from 'planck'

export const PPM = 6            // pixels per meter
export const FIXED_DT = 1 / 60
const TILE = 32                 // 地形碰撞块 = CellSim 的睡眠块(chunk 内 32×32 对齐)
const TERRAIN_NEAR = 24         // 醒着的刚体包围盒外扩多少 px 就要有地形(每帧最多走 12px = maxTranslation 2m)
const TILE_TTL = 120            // 块 N 帧没被任何刚体用到就释放
const MAX_BUILD_PER_FRAME = 2   // 每帧最多重建几块(单块 34×34 采样 + 描边 + 三角化 ≈ 0.45ms;真菌洞落沙不停,不限的话地形重建就 2.7ms/帧)
const MIN_REBUILD_GAP = 6       // 同一块两次重建至少隔几帧(落沙区每帧都在变;歇着的刚体不在乎 100ms 的滞后,掉下来的最多陷进新沙 1~2px)
const SIMPLIFY_EPS = 0.3        // Douglas-Peucker 容差(px):1:1 的 45° 台阶已经是直线;0.6 会把"平台上落了一粒土"拉成 1° 的斜线,整摞箱子跟着歪

// planck 的 maxPolygonVertices 默认 12,Box2D 2.3 是 8;地形用 chain 不受限。velocityThreshold 1 m/s = 6 px/s:比这慢的碰撞不弹
Settings.maxPolygonVertices = 8
// 入睡阈值:6px = 1m 下重力是 58 m/s²,Box2D 默认 0.01 m/s(0.06 px/s)对这个尺度太严 —— 一摞 5 箱会以 0.05 px/s 永远蠕动睡不着;
// 放到 0.03 m/s = 0.18 px/s(1px 要 5.5s,睡着后本来就冻住),角速度 2°/s 不动
Settings.linearSleepTolerance = 0.03

export class Physics {
  /**
   * @param {import('./sim/CellSim.js').CellSim} sim
   * @param {{gravity?:number, friction?:number}} [opt]  gravity 是 px/s²(b2World 的重力还没从 exe 反出来,先用刚体一直在用的 350)
   */
  constructor(sim, opt = {}) {
    this.sim = sim
    // Box2D 世界重力:反 exe GridWorld 建 b2World(0x760b1c new 0x192b8 字节,ctor 0xabb6c0)的重力向量 = .rdata 0x11e0b70 两个 double (0, 12) → **12 m/s² = 72 px/s²**
    // (比角色的 pixel_gravity 350 慢得多 —— 原版尸体 / 箱子确实"飘着"落,药水能扔出平飞的远弧;粒子系统另有 global_gravity = 6×10 = 60 px/s²)
    this.gravity = opt.gravity ?? 72
    this.terrainFriction = opt.friction ?? 0.75 // PhysicsShapeComponent 默认 friction
    // 材质 id → solid_friction / solid_restitution(materials.json;0 = 没写)
    const L = opt.mats?.list
    if (L) {
      this.matFriction = new Float32Array(L.length); this.matRestitution = new Float32Array(L.length)
      for (const m of L) { this.matFriction[m.id] = m.solidFriction || 0; this.matRestitution[m.id] = m.solidRestitution || 0 }
    }
    this.world = new World({ gravity: new Vec2(0, this.gravity / PPM), allowSleep: true })
    this.ground = this.world.createBody({ type: 'static' })
    // 碰撞速度(PhysicsBodyCollisionDamageComponent speed_threshold 用):pre-solve 里接触法向上的相对接近速度,记到 rb._impact(px/s,每步取最大;_syncAll 里清)
    this.world.on('pre-solve', (c) => {
      const fa = c.getFixtureA(), fb = c.getFixtureB(), ba = fa.getBody(), bb = fb.getBody()
      const ra = ba.getUserData()?.rb, rbB = bb.getUserData()?.rb
      if (!ra && !rbB) return
      const wm = c.getWorldManifold(null)
      if (!wm || !wm.points.length) return
      const n = wm.normal, p = wm.points[0]
      const va = ba.getLinearVelocityFromWorldPoint(p), vb = bb.getLinearVelocityFromWorldPoint(p)
      const dvx = vb.x - va.x, dvy = vb.y - va.y
      const rel = (dvx * n.x + dvy * n.y) * PPM // 沿法线的接近速度(负 = 正在靠近);贴着滑 / 滚不算撞
      if (rel > -3) return
      const sp = Math.hypot(dvx, dvy) * PPM // 撞击速度取相对速度大小(扔出去贴地滑着落地也算撞)
      if (ra && sp > ra._impact) ra._impact = sp
      if (rbB && sp > rbB._impact) rbB._impact = sp
    })
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
    let tT = 0, tS = 0, tY = 0
    while (this.acc >= FIXED_DT - 1e-9) {
      this.acc -= FIXED_DT
      this.frame++
      const a = performance.now(); this._refreshTerrain()
      const b = performance.now(); this.world.step(FIXED_DT, 8, 3)
      const c = performance.now(); this._syncAll()
      const d = performance.now(); tT += b - a; tS += c - b; tY += d - c
    }
    this.stats.ms = performance.now() - t0; this.stats.msTerrain = tT; this.stats.msStep = tS; this.stats.msSync = tY
  }

  // ── 地形 ──
  /**
   * 需要的块 = 动态刚体包围盒外扩 TERRAIN_NEAR 覆盖到的块(睡着的也算:脚下被挖了要靠块重建来叫醒它);
   * 缺的 / 版本变了的重建,重建时把压在这块上的刚体叫醒(Box2D 换 fixture 不会自己唤醒别人);久不用的释放。
   * userData.noTerrain 的刚体(第 ③ 步以后睡着写进格子的)不算 —— 那时像素在格子里,由 audit 管
   */
  _refreshTerrain() {
    const need = new Set(), needSleep = new Set()
    let bodies = 0, awake = 0
    for (let b = this.world.getBodyList(); b; b = b.getNext()) {
      if (!b.isDynamic() || !b.isActive()) continue
      bodies++
      const isAwake = b.isAwake()
      if (isAwake) awake++
      else if (b.getUserData()?.noTerrain) continue
      const set = isAwake ? need : needSleep
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
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) set.add(tx * 65536 + (ty & 65535))
    }
    this.stats.bodies = bodies; this.stats.awake = awake
    // 醒着刚体的块每帧查;只有睡着刚体的块每 20 帧查一次(它们只需要"脚下那条线还在不在":沙流走 / 被挖了才有事)
    if (this.frame % 20 === 0) for (const k of needSleep) need.add(k)
    else for (const k of needSleep) { const t = this.tiles.get(k); if (t) t.last = this.frame }
    let built = 0
    for (const key of need) {
      const tx = Math.floor(key / 65536), ty = (key & 65535) << 16 >> 16 // 还原有符号的 ty
      let t = this.tiles.get(key)
      const ver = this._tileVersion(tx, ty)
      if (ver < 0) continue // chunk 没就位:先不建(刚体飞到没加载的地方是 Noita 也头疼的事,PhysicsKeepInWorld 那一套以后再说)
      if (t && t.ver === ver) { t.last = this.frame; continue }
      if (t && this.frame - t.builtAt < MIN_REBUILD_GAP) { t.last = this.frame; continue } // 刚重建过:老的先顶着
      if (built >= MAX_BUILD_PER_FRAME) { if (t) t.last = this.frame; continue } // 这帧预算用完:老的先顶着,下帧再换
      if (!t) { t = { fixtures: new Map(), ver: -1, last: 0, verts: 0, builtAt: -99 }; this.tiles.set(key, t) }
      this._buildTile(t, tx, ty, ver)
      t.last = this.frame; t.builtAt = this.frame
      built++
    }
    if (built) this.stats.built += built
    // 释放久不用的
    if ((this.frame & 31) === 0) {
      for (const [key, t] of this.tiles) {
        if (this.frame - t.last <= TILE_TTL) continue
        for (const f of t.fixtures.values()) this.ground.destroyFixture(f)
        this.tiles.delete(key)
      }
    }
    this.stats.tiles = this.tiles.size
  }

  /** 块的版本(只看自己:采样外圈强制空气,不读邻块);chunk 未就位返回 -1 */
  _tileVersion(tx, ty) { return this.sim.tver(tx * TILE, ty * TILE) }

  /**
   * 重建一块:34×34 采样(外圈强制空气 → 所有轮廓闭合)→ marching squares → 简化 → 耳切三角化(洞桥接进外环)→ 合并成 ≤8 顶点凸块 → Polygon fixtures。
   * 用多边形不用 chain:Box2D 2.3 的 edge-polygon 碰撞在"箱子平放、底边正对 chain 顶点(接缝 / 中间点)"时会永远抖(node 复现:一摞 5 箱顶上 7px/s,睡不着),
   * 多边形对多边形在任何接缝位置都稳 —— 原版 Box2DTerrain 也是 TriangulatePixels 出多边形。
   * 逐块比对多边形:没变的原样留着(planck 在接触的 fixture 被拆时会唤醒刚体),只拆 / 建变了的
   */
  _buildTile(t, tx, ty, ver) {
    t.ver = ver
    const x0 = tx * TILE, y0 = ty * TILE, S = TILE + 2
    const g = this._grid || (this._grid = new Uint8Array(S * S))
    const sim = this.sim, FR = this.matFriction
    let any = 0, all = 1, frSum = 0, frN = 0
    g.fill(0)
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
      const m = sim.get(x0 + i, y0 + j)
      const s = m < 0 ? 1 : (sim.kind[m] > 0 && sim.kind[m] <= 2) ? 1 : 0
      g[(j + 1) * S + i + 1] = s; any |= s; all &= s
      if (s && m > 0 && FR && FR[m] > 0) { frSum += FR[m]; frN++ }
    }
    const fresh = new Map()
    if (any) {
      // 块的摩擦 = 块里实心格材质 solid_friction 的平均(materials.xml:rock 系 / sand / soil 都写了;没写的按 PhysicsShapeComponent 默认 0.75)
      const friction = frN ? frSum / frN : this.terrainFriction
      const polys = all
        ? [[[x0, y0], [x0 + TILE, y0], [x0 + TILE, y0 + TILE], [x0, y0 + TILE]]] // 全实心:一个方块
        : contourPolygons(marchingSquares(g, S, S, x0 - 1, y0 - 1), SIMPLIFY_EPS, false)
      for (const poly of polys) {
        let key = ''
        for (const p of poly) key += ptKey(p) + ';'
        fresh.set(key, { pts: poly, friction })
      }
    }
    // 拆掉不在新集合里的,建新出现的
    for (const [key, f] of t.fixtures) { if (!fresh.has(key)) { this.ground.destroyFixture(f); t.fixtures.delete(key); t.verts -= f.getShape().m_count } }
    for (const [key, d] of fresh) {
      if (t.fixtures.has(key)) continue
      const f = this.ground.createFixture(new Polygon(d.pts.map((p) => new Vec2(p[0] / PPM, p[1] / PPM))), { friction: d.friction, restitution: 0 })
      f.setUserData({ terrain: true, tx, ty })
      t.fixtures.set(key, f)
      t.verts += d.pts.length
    }
  }

  // ── 像素刚体 ↔ planck body(第 ② 步)──
  /**
   * 给 RigidBody 建 planck body:形状 = 像素 mask 的 marching squares 轮廓 → 简化 → 凸分解(≤8 顶点)→ Polygon fixtures;
   * density / friction / restitution 来自材质表(PhysicsImageShapeComponent 的 material)。位置 / 角度 / 速度取 rb 当前值。
   */
  attach(rb) {
    if (rb.pb) return rb.pb
    const b = this.world.createBody({
      type: rb.isStatic ? 'static' : 'dynamic', position: new Vec2(rb.x / PPM, rb.y / PPM), angle: rb.rot,
      linearVelocity: new Vec2(rb.vx / PPM, rb.vy / PPM), angularVelocity: rb.w,
      linearDamping: rb.linDamp || 0, angularDamping: rb.angDamp || 0,
      fixedRotation: !!rb.fixedRot, allowSleep: true, gravityScale: rb.gravScale || 1,
      // 小件(矿车 2.5px 的轮子 / 金粒)开连续碰撞:6px=1m 下落地速度 ≈ 24 m/s、一步走 2.4px,比轮子半径还大,离散碰撞会穿过 8px 的台面
      bullet: !!rb.isBullet || rb.alive <= 40,
    })
    b.setUserData({ rb, phys: this, noTerrain: false })
    rb.pb = b
    this._makeFixtures(rb)
    rb._px = rb.x; rb._py = rb.y; rb._prot = rb.rot; rb._sx = rb.vx; rb._sy = rb.vy; rb._sw = rb.w
    rb._spPrev = Math.hypot(rb.vx, rb.vy); rb._vyPrev = rb.vy; rb._impact = 0; rb.impact = 0
    rb.fixDirty = false
    return b
  }
  detach(rb) {
    if (!rb.pb) return
    this.world.destroyBody(rb.pb)
    rb.pb = null
  }
  /** 像素被挖 / 烧掉后重建 fixtures(质量 / 质心跟着变) */
  rebuild(rb) {
    if (!rb.pb) return
    for (let f = rb.pb.getFixtureList(); f;) { const n = f.getNext(); rb.pb.destroyFixture(f); f = n }
    this._makeFixtures(rb)
    rb.fixDirty = false
  }
  _makeFixtures(rb) {
    const b = rb.pb
    const fr = (this.matFriction && this.matFriction[rb.mat]) || rb.friction || 0.75
    const re = (this.matRestitution && this.matRestitution[rb.mat]) || 0
    // 密度 = 材质 density 原值(反 exe 0x9ec1e6 像素刚体 CreateFixture:density ← CellData+0x15c = "density",friction ← +0x198 solid_friction,restitution ← +0x19c solid_restitution;
    // 没材质时默认 1.0 / 0.3 / 0.2)。质量 = density × 面积(m²,1 m² = 36 px):24px 木箱 96 kg —— 和爆炸 physics_explosion_power ≈2 × 3600 N·s 打出 ~450 px/s 正好对上
    const opt = { density: rb.density || 1, friction: fr, restitution: re }
    if (rb.filterGroup) opt.filterGroupIndex = rb.filterGroup // 同一多体实体的部件互不碰撞(原版 Box2D_CreateFilterData 按实体分组;蘑菇帽和第二节茎、桌腿和桌面本来就重叠)
    if (rb.isCircle) {
      // PhysicsImageShapeComponent is_circle:"看像素的包围盒,圆心在盒中心,半径 = 到直边的距离"(轮子)
      const bb = maskBounds(rb.mask, rb.w0, rb.h0)
      if (!bb) return
      const cx = (bb.x0 + bb.x1 + 1) / 2 - rb.w0 / 2, cy = (bb.y0 + bb.y1 + 1) / 2 - rb.h0 / 2
      b.createFixture(new Circle(new Vec2(cx / PPM, cy / PPM), Math.max(0.5, Math.min(bb.x1 - bb.x0 + 1, bb.y1 - bb.y0 + 1) / 2) / PPM), opt)
      return
    }
    const polys = pixelPolygons(rb.mask, rb.w0, rb.h0)
    if (!polys.length) {
      // 太小 / 太细(1~3 像素的金粒、1px 宽的杆):用像素包围盒
      const bb = maskBounds(rb.mask, rb.w0, rb.h0)
      if (!bb) return
      const cx = (bb.x0 + bb.x1 + 1) / 2 - rb.w0 / 2, cy = (bb.y0 + bb.y1 + 1) / 2 - rb.h0 / 2
      b.createFixture(new Box(Math.max(0.5, (bb.x1 - bb.x0 + 1) / 2) / PPM, Math.max(0.5, (bb.y1 - bb.y0 + 1) / 2) / PPM, new Vec2(cx / PPM, cy / PPM), 0), opt)
      return
    }
    for (const poly of polys) b.createFixture(new Polygon(poly.map((p) => new Vec2(p[0] / PPM, p[1] / PPM))), opt)
    if (b.getMass() <= 0) b.setMassData({ mass: Math.max(1, rb.alive) * (rb.density || 1) / (PPM * PPM), center: new Vec2(0, 0), I: 0.01 })
  }
  /** 外部改了 rb 的位置 / 速度(爆炸冲量 / 玩家推 / 顶出实心 / 浮力)→ 写进 planck */
  pushToPhysics(rb) {
    const b = rb.pb
    if (!b) return
    if (rb.x !== rb._px || rb.y !== rb._py || rb.rot !== rb._prot) { b.setTransform(new Vec2(rb.x / PPM, rb.y / PPM), rb.rot); b.setAwake(true) }
    if (rb.vx !== rb._sx || rb.vy !== rb._sy) { b.setLinearVelocity(new Vec2(rb.vx / PPM, rb.vy / PPM)); b.setAwake(true) }
    if (rb.w !== rb._sw) { b.setAngularVelocity(rb.w); b.setAwake(true) }
    if (rb.fixDirty) this.rebuild(rb)
  }
  /**
   * 浮力:向上的力 = 重力 × buoy × 淹没比例(wake=false:睡着的浮体不被叫醒),液体阻尼叠在 xml 阻尼上
   * (线 3/s、角 4/s:比手写求解器的 35% / 30% 重得多,把水面起伏和一坑尸块的互相碰撞压下去让它们能歇下;Box2D 自带 b2BuoyancyController 的默认拖拽 2 / 1);出水后阻尼复原
   */
  applyBuoyancy(rb, wetF, buoy, gravity) {
    const b = rb.pb
    if (!b || b.isStatic()) return
    if (wetF > 0) {
      const m = b.getMass()
      b.applyForceToCenter(new Vec2(0, -(gravity / PPM) * (rb.gravScale || 1) * buoy * wetF * m), false)
      b.setLinearDamping((rb.linDamp || 0) + 3 * wetF); b.setAngularDamping((rb.angDamp || 0) + 4 * wetF)
      rb._wetDamp = true
    } else if (rb._wetDamp) { rb._wetDamp = false; b.setLinearDamping(rb.linDamp || 0); b.setAngularDamping(rb.angDamp || 0) }
  }
  /** step 之后:planck → rb(位置 / 角度 / 速度),记下"上一帧"的速度给碎裂 / 摔落判定 */
  _syncAll() {
    for (let b = this.world.getBodyList(); b; b = b.getNext()) {
      const rb = b.getUserData()?.rb
      if (!rb || !b.isActive()) continue
      rb._spPrev = Math.hypot(rb.vx, rb.vy); rb._vyPrev = rb.vy
      rb.impact = Math.max(rb.impact || 0, rb._impact || 0); rb._impact = 0 // 这一帧里最大的接触接近速度,Entities 用完清零
      const p = b.getPosition(), v = b.getLinearVelocity()
      rb.x = rb._px = p.x * PPM; rb.y = rb._py = p.y * PPM; rb.rot = rb._prot = b.getAngle()
      rb.vx = rb._sx = v.x * PPM; rb.vy = rb._sy = v.y * PPM; rb.w = rb._sw = b.getAngularVelocity()
    }
  }
  /** 有没有正在接触的东西(地形 / 别的刚体) */
  touching(rb) {
    if (!rb.pb) return false
    for (let ce = rb.pb.getContactList(); ce; ce = ce.next) if (ce.contact.isTouching()) return true
    return false
  }
  /** 模拟窗口外冻住(停用,位置速度原样留着)/ 进窗口解冻 */
  setFrozen(rb, frozen) {
    const b = rb.pb
    if (!b) return
    if (frozen) { b.setActive(false); return }
    b.setTransform(new Vec2(rb.x / PPM, rb.y / PPM), rb.rot); b.setLinearVelocity(new Vec2(rb.vx / PPM, rb.vy / PPM)); b.setAngularVelocity(rb.w)
    b.setActive(true); b.setAwake(true)
    rb._px = rb.x; rb._py = rb.y; rb._prot = rb.rot; rb._sx = rb.vx; rb._sy = rb.vy; rb._sw = rb.w
  }
  /** 睡着写进格子:body 停用(不再碰撞 / 不再要地形块);醒:重新启用 */
  setGridSleep(rb, asleep) {
    const b = rb.pb
    if (!b) return
    const ud = b.getUserData(); ud.noTerrain = asleep
    if (asleep) { b.setLinearVelocity(new Vec2(0, 0)); b.setAngularVelocity(0); b.setActive(false) }
    else { b.setTransform(new Vec2(rb.x / PPM, rb.y / PPM), rb.rot); b.setActive(true); b.setAwake(true); rb._px = rb.x; rb._py = rb.y; rb._prot = rb.rot }
  }

  // ── 关节(第 ④ 步)──
  /**
   * 铰链:PhysicsJointComponent(默认 revolute;nail_to_wall = 和地连)/ PhysicsJoint2Component REVOLUTE。bodyB 为空 = 钉在地(ground body)上。
   * motor:mMotorSpeed(rad/s)/ mMaxMotorTorque —— 轮架的轮子、挖掘场的钉墙轮
   */
  revolute(rbA, rbB, wx, wy, opt = {}) {
    const a = rbA.pb, b = rbB ? rbB.pb : this.ground
    if (!a || !b) return null
    // motor_speed 0 + motor_max_torque > 0(蘑菇茎的 Joint2Mutator)= 刹车:关节抵抗转动直到扭矩超过上限,一串铰链才立得住。
    // 扭矩按 xml 值 × 关节力基准(见 jointForceScale:两端质量和 × PHYSICS_JOINT_MAX_FORCE_MULTIPLIER 160)—— 反 exe 关节创建(0x76ac36 / 0x76c0af)里 break_force 就是这么乘的,10 N·m 裸值撑不住 44 kg 的蘑菇
    const k = Physics.jointForceScale(a, b)
    const j = new RevoluteJoint({ enableMotor: !!opt.motor || opt.motorTorque > 0, motorSpeed: opt.motor || 0, maxMotorTorque: (opt.motorTorque || 0) * k, collideConnected: false }, a, b, new Vec2(wx / PPM, wy / PPM))
    this.world.createJoint(j)
    return j
  }
  /** 关节力基准 = (mA + mB) × PHYSICS_JOINT_MAX_FORCE_MULTIPLIER(160;magic_numbers.xml,exe 0x12eb7c4):break_force / 电机扭矩都乘它(ragdoll 关节另算:max(200, (mA+mB)×400)) */
  static jointForceScale(a, b) { return (a.getMass() + b.getMass()) * 160 }
  /** 焊接:PhysicsJoint2Component WELD(家具的横梁和腿) */
  weld(rbA, rbB, wx, wy) {
    const a = rbA.pb, b = rbB ? rbB.pb : this.ground
    if (!a || !b) return null
    const j = new WeldJoint({ collideConnected: false }, a, b, new Vec2(wx / PPM, wy / PPM))
    this.world.createJoint(j)
    return j
  }
  destroyJoint(j) { if (j) this.world.destroyJoint(j) }
  /** 关节两端锚点被拉开多少 px(break_distance 用) */
  jointGap(j) { const a = j.getAnchorA(), b = j.getAnchorB(); return Math.hypot(a.x - b.x, a.y - b.y) * PPM }
  /** 关节上一步的约束力(Box2D 单位 N;break_force 用,换算关系还没反出来) */
  jointForce(j) { const f = j.getReactionForce(60); return Math.hypot(f.x, f.y) }

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
      for (const f of t.fixtures.values()) {
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
    // 关节:锚点画个洋红小圈
    ctx.strokeStyle = 'rgba(255,80,220,0.9)'
    for (let j = this.world.getJointList(); j; j = j.getNext()) {
      const a = j.getAnchorA()
      ctx.beginPath(); ctx.arc(a.x * PPM - ox, a.y * PPM - oy, 1.5, 0, Math.PI * 2); ctx.stroke()
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

// ── 像素 mask → 凸多边形组(相对图心的像素坐标)──
/** mask 的像素包围盒 */
export function maskBounds(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (mask[j * w + i]) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}
/**
 * mask(w×h,1 = 有像素)→ [[ [x,y],... ], ...] 凸多边形(顶点 ≤ MAX_VERTS,坐标相对图心);
 * 洞填实 —— Box2D 里桶的空心也是实心的;太细 / 太小的(面积 < 1px²)返回空,调用方用包围盒
 */
export function pixelPolygons(mask, w, h, eps = 0.3) { // 容差别大:0.5px 在 24px 的箱底上就是 1.2° 的斜,整摞箱子跟着歪
  const W = w + 2, H = h + 2
  const g = new Uint8Array(W * H)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) g[(j + 1) * W + i + 1] = mask[j * w + i] ? 1 : 0
  return contourPolygons(marchingSquares(g, W, H, -1 - w / 2, -1 - h / 2), eps, true)
}
/**
 * marching squares 的闭合轮廓 → 凸多边形组。内外靠包含关系判(走向是任意的,不能看面积符号):被奇数个环包着的是洞。
 * fillHoles=true 洞填实(刚体);false 时洞桥接进外环一起三角化(地形:子弹打出的气泡 / 块内的小洞都得留着)
 */
export function contourPolygons(lines, eps, fillHoles) {
  const loops = []
  for (const line of lines) {
    if (line.length < 4) continue
    const pts = simplify(line, eps)
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop()
    if (pts.length < 3) continue
    if (Math.abs(signedArea(pts)) < 1) continue
    loops.push(pts)
  }
  if (!loops.length) return []
  // 包含深度
  const depth = loops.map((l, i) => { let d = 0; for (let j = 0; j < loops.length; j++) if (j !== i && pointInPoly(l[0], loops[j])) d++; return d })
  const out = []
  for (let i = 0; i < loops.length; i++) {
    if (depth[i] & 1) continue // 洞
    let outer = signedArea(loops[i]) > 0 ? loops[i] : loops[i].slice().reverse()
    if (!fillHoles) {
      // 直接包在这个外环里的洞(深度 = 本环深度 + 1 且被本环包着)按 max-x 从大到小桥接进来
      const holes = []
      for (let j = 0; j < loops.length; j++) if (depth[j] === depth[i] + 1 && pointInPoly(loops[j][0], loops[i])) holes.push(signedArea(loops[j]) < 0 ? loops[j] : loops[j].slice().reverse())
      holes.sort((a, b) => maxX(b) - maxX(a))
      for (const hole of holes) outer = bridgeHole(outer, hole) || outer
    }
    const tris = earClip(outer)
    if (!tris) { out.push(convexHull(outer)); continue }
    for (const poly of mergeConvex(outer, tris, MAX_VERTS)) out.push(poly)
  }
  return out
}
const MAX_VERTS = 8
function maxX(p) { let m = -Infinity; for (const q of p) if (q[0] > m) m = q[0]; return m }
function pointInPoly(pt, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
function segsCross(a, b, c, d) {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}
/**
 * 把洞(反向环)桥接进外环:取洞的 max-x 顶点 m,找外环上一个从 m 看得见(连线不穿任何边)的顶点 v,
 * 新环 = outer[..v] + m 绕洞一圈回到 m + v + outer[v..]。找不到就返回 null(调用方把洞填实)
 */
function bridgeHole(outer, hole) {
  let mi = 0; for (let k = 1; k < hole.length; k++) if (hole[k][0] > hole[mi][0]) mi = k
  const m = hole[mi]
  let best = -1, bd = Infinity
  for (let vi = 0; vi < outer.length; vi++) {
    const v = outer[vi]
    if (v[0] < m[0]) continue
    const d = (v[0] - m[0]) ** 2 + (v[1] - m[1]) ** 2
    if (d >= bd) continue
    let ok = true
    for (let k = 0; k < outer.length && ok; k++) { const a = outer[k], b = outer[(k + 1) % outer.length]; if (a === v || b === v) continue; if (segsCross(m, v, a, b)) ok = false }
    for (let k = 0; k < hole.length && ok; k++) { const a = hole[k], b = hole[(k + 1) % hole.length]; if (a === m || b === m) continue; if (segsCross(m, v, a, b)) ok = false }
    if (ok) { best = vi; bd = d }
  }
  if (best < 0) return null
  const res = []
  for (let k = 0; k <= best; k++) res.push(outer[k])
  for (let k = 0; k <= hole.length; k++) res.push(hole[(mi + k) % hole.length]) // m … 绕一圈 … 回到 m
  for (let k = best; k < outer.length; k++) res.push(outer[k])
  return res
}
function signedArea(p) { let a = 0; for (let i = 0, n = p.length; i < n; i++) { const q = p[i], r = p[(i + 1) % n]; a += q[0] * r[1] - r[0] * q[1] } return a / 2 }
function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]) }
/** 耳切三角化(简单多边形,正向 = signedArea>0);返回三角形顶点索引数组,失败返回 null */
function earClip(pts) {
  const n = pts.length
  const idx = []; for (let i = 0; i < n; i++) idx.push(i)
  const tris = []
  const inTri = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0
  const same = (p, q) => p[0] === q[0] && p[1] === q[1]
  let guard = 0
  while (idx.length > 3 && guard++ < 10000) {
    let found = false
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length]
      const a = pts[i0], b = pts[i1], c = pts[i2]
      if (cross(a, b, c) <= 1e-9) continue // 凹角 / 共线不是耳
      let ok = true
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue
        const q = pts[j]
        if (same(q, a) || same(q, b) || same(q, c)) continue // 桥接洞时同一点出现两次:重合点不算"在里面"
        if (inTri(q, a, b, c)) { ok = false; break }
      }
      if (!ok) continue
      tris.push([i0, i1, i2]); idx.splice(k, 1); found = true; break
    }
    if (found) continue
    // 没有严格凸的耳:先剔一个共线 / 退化顶点(桥接两端的来回边就是这种),再找
    let k = -1
    for (let t = 0; t < idx.length; t++) { const a = pts[idx[(t + idx.length - 1) % idx.length]], b = pts[idx[t]], c = pts[idx[(t + 1) % idx.length]]; if (Math.abs(cross(a, b, c)) <= 1e-9) { k = t; break } }
    if (k < 0) return null
    idx.splice(k, 1)
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]])
  return tris
}
/** Hertel-Mehlhorn:相邻三角形 / 多边形共享一条边且合并后仍凸、顶点 ≤ max 就合并 */
function mergeConvex(pts, tris, max) {
  let polys = tris.map((t) => t.slice())
  const isConvex = (poly) => { const n = poly.length; for (let i = 0; i < n; i++) if (cross(pts[poly[i]], pts[poly[(i + 1) % n]], pts[poly[(i + 2) % n]]) < -1e-9) return false; return true }
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
      const A = polys[i], B = polys[j]
      if (A.length + B.length - 2 > max) continue
      // 找共享边 (A[a], A[a+1]) == (B[b+1], B[b])
      for (let a = 0; a < A.length; a++) {
        const u = A[a], v = A[(a + 1) % A.length]
        const b = B.indexOf(v)
        if (b < 0 || B[(b + 1) % B.length] !== u) continue
        // 合并:A 从 v 开始走到 u,再接 B 从 u 的下一个走到 v 的前一个
        const M = []
        for (let k = 0; k < A.length; k++) M.push(A[(a + 1 + k) % A.length])
        for (let k = 2; k < B.length; k++) M.push(B[(b + k) % B.length])
        if (!isConvex(M)) continue
        polys[i] = M; polys.splice(j, 1); merged = true
        break outer
      }
    }
  }
  return polys.map((poly) => poly.map((i) => pts[i]))
}
/** 兜底:凸包(Andrew 单调链) */
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const lo = [], hi = []
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q) }
  lo.pop(); hi.pop()
  const hull = lo.concat(hi)
  return hull.length > MAX_VERTS ? thin(hull, MAX_VERTS) : hull
}
function thin(poly, max) { const out = []; for (let i = 0; i < max; i++) out.push(poly[Math.floor(i * poly.length / max)]); return out }

/** 点的比对键(1/8 px 量化;marching squares 的点都是 .5 的倍数) */
function ptKey(p) { return Math.round(p[0] * 8) + ',' + Math.round(p[1] * 8) }

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
