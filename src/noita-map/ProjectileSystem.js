// ── 投射物系统:定义全部来自 data/entities/projectiles/deck/*.xml(projectiles.json),对标 Noita ──
// 每颗弹:VelocityComponent(重力/空气阻力)→ ProjectileComponent(速度/寿命/碰撞死/爆炸配置)→ SpriteComponent(帧动画,朝速度方向,additive)
// → ParticleEmitterComponent×N(拖尾:材质色化妆粒子,或 create_real_particles 往世界注入真材质)→ LightComponent(彩色光)。
// 爆炸 config_explosion:explosion_radius 挖坑(只挖 durability ≤ max_durability_to_destroy 的材质——火花弹挖不动石头,挖掘弹挖不动钢),
// material_sparks 出真材质碎屑,sparks 出白热火花,create_cell 在坑里生成材质(火球→火),explosion_sprite 播爆炸帧,camera_shake 震屏。

const K_STATIC = 1, K_SAND = 2, K_LIQUID = 3, K_GAS = 4, K_FIRE = 5

export class ProjectileSystem {
  /**
   * @param {object} o
   * @param {object} o.defs        projectiles.json
   * @param {import('./core/materials.js').MaterialTable} o.mats
   * @param {import('./sim/CellSim.js').CellSim} o.sim
   * @param {(url:string)=>Promise<{width:number,height:number,data:Uint8Array,image:ImageBitmap|null}>} o.decodePng
   * @param {string} o.res         资源基址(…/res/noita)
   * @param {object} [o.hooks]     { debris(x,y,vx,vy,mat,col), shake(t), sfx(name,opt), spark(x,y,vx,vy,life,col) }
   */
  constructor({ defs, mats, sim, decodePng, res, hooks = {} }) {
    this.defs = defs
    this.mats = mats
    this.sim = sim
    this.decodePng = decodePng
    this.res = res
    this.hooks = hooks
    this.images = new Map()
    this.list = []       // 飞行中的弹
    this.fx = []         // 化妆粒子 {x,y,vx,vy,life,max,col,g,fade,grid}
    this.anims = []      // 爆炸/枪口 帧动画 {sprite,x,y,t,additive}
    this.flashes = []    // 光闪 {x,y,r,rgb,life,max}
    this.stuck = []      // on_death_gfx_leave_sprite:插在地里的箭/躺着的锯片 {d,x,y,rot,frame,life,ax,ay}
    this.sfx = []        // 贴图粒子(SpriteParticleEmitterComponent):烟团/光斑
    this.rings = new Map() // 图形发射器像素环
    this.burnable = sim.burnable
    this.durability = new Float32Array(mats.list.length)
    for (const m of mats.list) this.durability[m.id] = m.durability || 0
  }

  async load(names) {
    const imgs = new Set()
    for (const n of names) {
      const d = this.defs[n]
      if (!d) continue
      if (d.sprite?.image) imgs.add(d.sprite.image)
      if (d.physics?.image) imgs.add(d.physics.image)
      if (d.explosion?.sprite?.image) imgs.add(d.explosion.sprite.image)
      if (d.muzzle) for (const v of d.muzzle.variants) imgs.add(v)
      for (const e of d.sprEmitters || []) if (e.sprite?.image) imgs.add(e.sprite.image)
      for (const e of d.emitters) if (e.image?.file) imgs.add(e.image.file)
    }
    await Promise.all([...imgs].map(async (f) => { if (!this.images.has(f)) this.images.set(f, await this.decodePng(`${this.res}/proj/${f}`).catch(() => null)) }))
    // 图形发射器:预先把图片按"到中心的距离"分桶,发射时按帧取那一圈的像素
    for (const f of imgs) {
      const img = this.images.get(f)
      if (!img || this.rings.has(f) || !/image_emitters/.test(f)) continue
      const cx = img.width / 2, cy = img.height / 2, rings = []
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
        if (img.data[(y * img.width + x) * 4 + 3] < 64) continue
        const r = Math.round(Math.hypot(x - cx, y - cy))
        ;(rings[r] ||= []).push(x - cx, y - cy)
      }
      this.rings.set(f, rings)
    }
  }

  matColor(name) { const id = this.mats.byName.get(name); return id === undefined ? 0xffffff : this.mats.color[id] }

  /** 发射:x,y 杖尖,angle 弧度 */
  spawn(name, x, y, angle, { spreadRad = 0, owner = 'player', speedMul = 1 } = {}) {
    const d = this.defs[name]
    if (!d) return null
    const a = angle + (Math.random() - 0.5) * (d.dirRandom + spreadRad)
    const spd = (d.speed[0] + Math.random() * (d.speed[1] - d.speed[0])) * speedMul
    const life = (d.lifetime + (Math.random() * 2 - 1) * d.lifetimeRandom) / 60
    const p = {
      name, d, x, y, owner, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life: life > 0 ? life : 30, age: 0, frame: 0, ft: 0,
      emit: d.emitters.map(() => ({ t: 0, dist: 0, ring: 0 })), sEmit: (d.sprEmitters || []).map(() => ({ t: 0 })), lastX: x, lastY: y, dead: false,
      bounces: d.bounces, rot: a, spin: d.angularVelocity || 0, penetrate: d.groundPenetration > 0 ? d.groundPenetration * 8 : 0, frames: 0,
    }
    this.list.push(p)
    // 一次性材质转换(loop=0:触摸系法术在出生点直接变材质)
    for (const c of d.converters || []) if (!c.loop) this._convert(p, c, c.steps * 60)
    // 枪口火焰 + 发射闪光
    if (d.muzzle?.variants.length) {
      const img = this.images.get(d.muzzle.variants[(Math.random() * d.muzzle.variants.length) | 0])
      if (img) this.anims.push({ img, fw: img.width, fh: img.height, frames: 1, wait: 0.06, x, y, angle: a, offX: d.muzzle.offX, offY: d.muzzle.offY, t: 0, additive: d.muzzle.additive })
    }
    if (d.shootFlash) this.flashes.push({ x, y, r: d.shootFlash.radius, rgb: `${d.shootFlash.r},${d.shootFlash.g},${d.shootFlash.b}`, life: 0.06, max: 0.06 })
    if (d.shakeWhenShot) this.hooks.shake?.(d.shakeWhenShot * 0.08)
    this.hooks.sfx?.(d.type === 'MATERIAL_PARTICLE' ? 'water' : d.explosion && d.explosion.radius >= 10 ? 'fire' : 'electric', { vol: 0.3, rate: d.type === 'MATERIAL_PARTICLE' ? 1.3 : 1.2 + Math.random() * 0.2, minGap: 40 })
    return p
  }

  update(dt) {
    const sim = this.sim
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]
      const d = p.d
      p.age += dt
      if (p.noHit > 0) p.noHit -= dt
      // 速度:重力 + 空气阻力(负值 = 加速,如火箭/发光弹)
      // MATERIAL_PARTICLE(水/油喷射)没有 VelocityComponent 重力,是按材质粒子模拟的:会下坠,ProjectileComponent.friction 当空气阻力
      const isMat = d.type === 'MATERIAL_PARTICLE'
      if (d.type === 'PHYSICS') {
        // 刚体弹(炸弹):当小刚体模拟——重力 350、撞面弹一点(restitution 0.25)、地面滚动摩擦、按速度自转;引信到时爆炸
        this._physicsStep(p, dt)
        this._emit(p, dt); this._emitSprites(p, dt)
        if (p.age >= p.life) { this._die(p, false); this.list.splice(i, 1) }
        continue
      }
      p.vy += (isMat ? 150 : d.gravity) * dt
      const af = isMat ? d.friction * 0.25 : d.airFriction
      if (af) { const f = Math.exp(-af * dt); p.vx *= f; p.vy *= f }
      // 子步进碰撞;撞上实心:先看 bounces_left —— 有次数就反弹(bounce_always 任何角度都弹,否则只有擦着弹;
      // bounce_at_any_angle 按真实法线反射),没了才 on_collision_die;ground_penetration 允许穿进地里一段
      const sp = Math.hypot(p.vx, p.vy)
      const sub = Math.max(1, Math.ceil(sp * dt / 2))
      let hit = false, hitLiquid = false
      for (let s = 0; s < sub && !hit; s++) {
        const nx = p.x + (p.vx * dt) / sub, ny = p.y + (p.vy * dt) / sub
        // 命中实体(HitboxComponent):ProjectileComponent.damage 交给实体层;on_collision_die 的弹在这里死
        if (this.hooks.hitTest && p.age > 0.02 && d.type !== 'MATERIAL_PARTICLE' && d.type !== 'STATIC') {
          const t = this.hooks.hitTest(nx, ny, p)
          if (t && t !== p.lastHit) {
            p.lastHit = t
            this.hooks.hitEntity?.(t, p, d.damage || 0)
            if (d.collisionDie) { p.x = nx; p.y = ny; hit = true; break }
          }
        }
        const m = sim.get(Math.floor(nx), Math.floor(ny))
        const k = m > 0 ? sim.kind[m] : 0
        const solid = k === K_STATIC || k === K_SAND
        const liquid = k === K_LIQUID
        if (m >= 0 && liquid && (d.dieOnLiquid || d.type === 'MATERIAL_PARTICLE')) { hitLiquid = true; hit = true; break }
        // 穿水的弹丸(多数弹默认 die_on_liquid_collision=0)扎进水面那一下也溅水
        if (m >= 0 && liquid && !p.wasLiq && sp > 120 && d.type !== 'MATERIAL_PARTICLE') { p.wasLiq = true; this._splash(p, sp * 0.7) }
        else if (m >= 0 && !liquid) p.wasLiq = false
        if (m >= 0 && solid && d.collideWorld) {
          if (p.noHit > 0) { p.x = nx; p.y = ny; continue }
          if (p.penetrate > 0) { p.penetrate -= Math.hypot(nx - p.x, ny - p.y); p.x = nx; p.y = ny; continue }
          if (p.bounces > 0 && this._tryBounce(p, nx, ny)) { p.bounces--; continue }
          hit = true; break
        }
        p.x = nx; p.y = ny
      }
      if (p.spin) p.rot += p.spin * dt
      else if (d.velRotation) p.rot = Math.atan2(p.vy, p.vx)
      p.frames += dt * 60
      // 持续材质转换(冰球一路冻水/灭火、火球点燃周围可燃物)/ 吃格子(大锯刃、黑洞)
      for (const c of d.converters || []) if (c.loop) this._convert(p, c, c.steps * dt * 60)
      if (d.cellEater) this._eat(p, d.cellEater)
      // 拖尾发射器 / 贴图粒子发射器
      this._emit(p, dt)
      this._emitSprites(p, dt)
      // 精灵帧
      if (d.sprite && d.sprite.frames > 1) { p.ft += dt; if (p.ft >= d.sprite.wait) { p.ft = 0; p.frame = (p.frame + 1) % d.sprite.frames } }
      if (hit && hitLiquid && d.type !== 'MATERIAL_PARTICLE') this._splash(p, sp)
      if (hit && (d.collisionDie || hitLiquid)) { this._die(p, true); this.list.splice(i, 1); continue }
      if (d.dieLowVel && p.age > 0.1 && Math.hypot(p.vx, p.vy) < d.dieLowVel) { this._die(p, true); this.list.splice(i, 1); continue }
      if (p.age >= p.life) { this._die(p, false); this.list.splice(i, 1); continue }
      if (p.age > 30) this.list.splice(i, 1)
    }
    for (let i = this.stuck.length - 1; i >= 0; i--) { const s = this.stuck[i]; s.life -= dt; if (s.life <= 0 || this.sim.get(Math.floor(s.ax), Math.floor(s.ay)) === 0) this.stuck.splice(i, 1) }
    // 化妆粒子
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]
      f.life -= dt
      if (f.life <= 0) { this.fx.splice(i, 1); continue }
      f.vy += f.g * dt
      if (f.air) { f.vx += (Math.random() - 0.5) * f.air * dt * 60; f.vy += (Math.random() - 0.5) * f.air * dt * 60 }
      f.x += f.vx * dt; f.y += f.vy * dt
    }
    for (let i = this.anims.length - 1; i >= 0; i--) { const a = this.anims[i]; a.t += dt; if (a.t >= a.wait * a.frames) this.anims.splice(i, 1) }
    // 贴图粒子:颜色随时间变化(color_change 每秒),重力,减速,自转,缩放
    for (let i = this.sfx.length - 1; i >= 0; i--) {
      const s = this.sfx[i]
      s.age += dt
      for (let k = 0; k < 4; k++) s.col[k] = Math.max(0, Math.min(1, s.col[k] + s.cc[k] * dt))
      if (s.age >= s.life || s.col[3] <= 0) { this.sfx.splice(i, 1); continue }
      s.vx += s.g[0] * dt; s.vy += s.g[1] * dt
      if (s.slow) { const f = Math.exp(-s.slow * dt); s.vx *= f; s.vy *= f }
      s.x += s.vx * dt; s.y += s.vy * dt
      s.rot += s.av * dt
      s.sx += s.sv[0] * dt; s.sy += s.sv[1] * dt
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) { this.flashes[i].life -= dt; if (this.flashes[i].life <= 0) this.flashes.splice(i, 1) }
  }

  /** 刚体弹一步:圆形碰撞体(半径 = 图一半),子步进,撞面按法线反弹并衰减,贴地时摩擦滚动 */
  _physicsStep(p, dt) {
    const sim = this.sim
    const img = p.d.physics?.image ? this.images.get(p.d.physics.image) : null
    const R = img ? Math.max(2, Math.floor(Math.min(img.width, img.height) / 2) - 1) : 3
    p.vy += 350 * dt
    const sub = Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy) * dt / 2))
    const solidAt = (x, y) => { const m = sim.get(Math.floor(x), Math.floor(y)); const k = m > 0 ? sim.kind[m] : 0; return m >= 0 && (k === K_STATIC || k === K_SAND) }
    const blocked = (x, y) => solidAt(x, y + R) || solidAt(x, y - R) || solidAt(x - R, y) || solidAt(x + R, y) || solidAt(x - R * 0.7, y + R * 0.7) || solidAt(x + R * 0.7, y + R * 0.7)
    let onGround = false
    for (let s = 0; s < sub; s++) {
      const nx = p.x + (p.vx * dt) / sub
      if (!blocked(nx, p.y)) p.x = nx
      else { p.vx = -p.vx * 0.3 }
      const ny = p.y + (p.vy * dt) / sub
      if (!blocked(p.x, ny)) p.y = ny
      else {
        if (p.vy > 0) onGround = true
        if (Math.abs(p.vy) > 40) { p.vy = -p.vy * 0.25; this.hooks.sfx?.('clash', { vol: 0.15, rate: 0.9, minGap: 120 }) } else p.vy = 0
      }
    }
    if (onGround) { p.vx *= Math.pow(0.15, dt); if (Math.abs(p.vx) < 3) p.vx = 0 }
    // 被埋进去了(沙落上来)→ 往上顶
    for (let k = 0; k < 8 && blocked(p.x, p.y); k++) p.y -= 1
    p.rot += (p.vx / Math.max(1, R)) * dt // 滚动:角速度 = v / r
    p.lastX = p.lastX ?? p.x; p.lastY = p.lastY ?? p.y
  }

  /** 撞点法线:数周围 5×5 里实心格的分布,指向空气一侧 */
  _normalAt(x, y) {
    let nx = 0, ny = 0
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const m = this.sim.get(x + dx, y + dy)
      const k = m > 0 ? this.sim.kind[m] : 0
      if (k === K_STATIC || k === K_SAND) { nx -= dx; ny -= dy }
    }
    const l = Math.hypot(nx, ny)
    return l ? [nx / l, ny / l] : [0, -1]
  }

  /** 反弹:返回 true 表示弹开了(位置留在撞前一步) */
  /** 弹丸扎进液体:按速度掀几粒水珠(取真实液体格 → 碎屑,落回世界),响一声 */
  _splash(p, speed) {
    const sim = this.sim, x0 = Math.floor(p.x), y0 = Math.floor(p.y)
    const n = Math.min(16, Math.max(3, Math.round(speed / 35)))
    let done = 0
    for (let t = 0; t < n * 3 && done < n; t++) {
      const x = x0 - 3 + Math.floor(Math.random() * 7), y = y0 - 1 + Math.floor(Math.random() * 4)
      const m = sim.get(x, y)
      if (m <= 0 || sim.kind[m] !== K_LIQUID) continue
      sim.set(x, y, 0, 0)
      const c = this.mats.color[m], lt = ((Math.min(255, ((c >> 16) & 255) + 70) << 16) | (Math.min(255, ((c >> 8) & 255) + 70) << 8) | Math.min(255, (c & 255) + 70))
      this.hooks.debris?.(x, y - 1, (Math.random() - 0.5) * 90 + p.vx * 0.15, -(40 + Math.random() * 150), m, lt)
      done++
    }
    if (done) this.hooks.sfx?.('water', { vol: Math.min(0.6, 0.15 + speed / 900), rate: 1.1 + Math.random() * 0.3, minGap: 90 })
  }

  _tryBounce(p, hx, hy) {
    const d = p.d
    const [nx, ny] = this._normalAt(Math.floor(hx), Math.floor(hy))
    const sp = Math.hypot(p.vx, p.vy) || 1
    const cosIn = -(p.vx * nx + p.vy * ny) / sp // 1 = 正撞,0 = 擦边
    if (!d.bounceAlways && !d.bounceAnyAngle && cosIn > 0.55) return false // 普通弹只擦着弹,正撞就死(箭插进去)
    const dot = p.vx * nx + p.vy * ny
    p.vx = (p.vx - 2 * dot * nx) * d.bounceEnergy
    p.vy = (p.vy - 2 * dot * ny) * d.bounceEnergy
    // 沿法线退到空气里(最多 6px),并给 2 帧免碰撞,免得同一面墙连吃好几次反弹
    for (let k = 0; k < 6; k++) {
      const m = this.sim.get(Math.floor(p.x), Math.floor(p.y))
      const kk = m > 0 ? this.sim.kind[m] : 0
      if (m < 0 || !(kk === K_STATIC || kk === K_SAND)) break
      p.x += nx; p.y += ny
    }
    p.noHit = 0.035
    if (d.bounceFx) {
      const matId = this.mats.byName.get(d.bounceFx.mat)
      const col = matId === undefined ? 0xffffff : this.mats.color[matId]
      const n = d.bounceFx.count[0] + Math.random() * (d.bounceFx.count[1] - d.bounceFx.count[0])
      for (let k = 0; k < n && this.fx.length < 2500; k++) {
        const life = d.bounceFx.life[0] + Math.random() * (d.bounceFx.life[1] - d.bounceFx.life[0])
        this.fx.push({ x: p.x, y: p.y, vx: nx * 40 + d.bounceFx.vx[0] + Math.random() * (d.bounceFx.vx[1] - d.bounceFx.vx[0]), vy: ny * 40 + d.bounceFx.vy[0] + Math.random() * (d.bounceFx.vy[1] - d.bounceFx.vy[0]), life, max: life, col, g: 0, fade: true, air: 0 })
      }
    }
    this.hooks.sfx?.('clash', { vol: 0.2, rate: 1.6 + Math.random() * 0.4, minGap: 50 })
    return true
  }

  /** MagicConvertMaterialComponent:半径内随机抽 budget 个格子做 from→to / 任意→to / 灭火 / 点燃 */
  _convert(p, c, budget) {
    const sim = this.sim, mats = this.mats
    let map = null
    if (c.fromArray && c.toArray) { map = new Map(); c.fromArray.forEach((f, i) => { const a = mats.byName.get(f), b = mats.byName.get(c.toArray[i] || c.toArray[c.toArray.length - 1]); if (a !== undefined && b !== undefined) map.set(a, b) }) }
    else if (c.from && c.to) { const a = mats.byName.get(c.from), b = mats.byName.get(c.to); if (a !== undefined && b !== undefined) { map = new Map([[a, b]]) } }
    const toAny = c.fromAny && c.to ? mats.byName.get(c.to) : undefined
    const n = Math.ceil(budget)
    for (let i = 0; i < n; i++) {
      // 圆内均匀采样
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * c.radius
      const x = Math.floor(p.x + Math.cos(a) * r), y = Math.floor(p.y + Math.sin(a) * r)
      const m = sim.get(x, y)
      if (m < 0) continue
      const k = sim.kind[m]
      if (c.extinguish && k === K_FIRE) { sim.set(x, y, 0); continue }
      if (c.ignite && m > 0 && this.burnable[m] && sim.aux(x, y) === 0 && Math.random() < c.ignite / 100) { sim.set(x, y, m, 1); continue }
      if (map && map.has(m)) { sim.set(x, y, map.get(m), 0); continue }
      if (toAny !== undefined && m > 0 && k !== K_FIRE) sim.set(x, y, toAny, 0)
    }
  }

  /** CellEaterComponent:半径内按概率吞掉格子(锯刃啃地、黑洞) */
  _eat(p, ce) {
    const sim = this.sim
    const r = ce.radius
    const ignoreId = ce.ignoredMat ? this.mats.byName.get(ce.ignoredMat) : -1
    for (let y = Math.floor(p.y - r); y <= Math.ceil(p.y + r); y++) for (let x = Math.floor(p.x - r); x <= Math.ceil(p.x + r); x++) {
      if ((x - p.x) ** 2 + (y - p.y) ** 2 > r * r) continue
      const m = sim.get(x, y)
      if (m <= 0 || m === ignoreId) continue
      const k = sim.kind[m]
      if (k === K_GAS || k === K_FIRE) continue
      if (Math.random() * 100 >= ce.prob) continue
      if (ce.ignoredTag && (this.mats.list[m].tags || '').includes(ce.ignoredTag)) continue
      sim.set(x, y, 0)
      if (Math.random() < 0.15) this.hooks.debris?.(x + 0.5, y + 0.5, (Math.random() - 0.5) * 60, -Math.random() * 60, m, this.mats.color[m])
    }
  }

  /** SpriteParticleEmitterComponent:贴图粒子 */
  _emitSprites(p, dt) {
    const d = p.d
    for (let k = 0; k < (d.sprEmitters || []).length; k++) {
      const e = d.sprEmitters[k], st = p.sEmit[k]
      if (!e.isEmitting || !e.sprite?.image) continue
      if (p.frames < e.delay * 60) continue
      if (e.lifetime > 0 && p.age > e.delay + e.lifetime) continue
      st.t -= dt * 60
      if (st.t > 0) continue
      st.t = e.interval[0] + Math.random() * (e.interval[1] - e.interval[0])
      const img = this.images.get(e.sprite.image)
      if (!img?.image) continue
      const n = e.count[0] + Math.floor(Math.random() * (e.count[1] - e.count[0] + 1))
      for (let j = 0; j < n && this.sfx.length < 400; j++) {
        const life = (e.sprite.frames > 1 && e.sprite.loop === 0 ? e.sprite.frames * e.sprite.wait : 0.6) + e.rlife[0] + Math.random() * (e.rlife[1] - e.rlife[0])
        this.sfx.push({
          spr: e.sprite, img, x: p.x + e.rpos[0] + Math.random() * (e.rpos[1] - e.rpos[0]), y: p.y + e.rpos[2] + Math.random() * (e.rpos[3] - e.rpos[2]),
          vx: e.vel[0] + e.rvel[0] + Math.random() * (e.rvel[1] - e.rvel[0]), vy: e.vel[1] + e.rvel[2] + Math.random() * (e.rvel[3] - e.rvel[2]),
          g: e.g, slow: e.slow, rot: (e.randomRot ? Math.random() * Math.PI * 2 : e.rot) + e.rrot[0] + Math.random() * (e.rrot[1] - e.rrot[0]),
          av: e.angVel + e.rangVel[0] + Math.random() * (e.rangVel[1] - e.rangVel[0]), sx: e.scale[0], sy: e.scale[1], sv: e.scaleVel,
          col: [...e.color], cc: e.colorChange, life: Math.max(0.05, life), age: 0, additive: e.additive || e.emissive, useVelRot: e.useVelRot,
        })
      }
    }
  }

  _emit(p, dt) {
    const d = p.d
    const dx = p.x - p.lastX, dy = p.y - p.lastY
    const moved = Math.hypot(dx, dy)
    for (let k = 0; k < d.emitters.length; k++) {
      const e = d.emitters[k], st = p.emit[k]
      if (!e.isEmitting) continue
      if (e.delay && p.frames < e.delay) continue
      if (e.emitterLife && p.frames > e.delay + e.emitterLife) continue
      let n = 0
      if (e.trail) {
        st.dist += moved
        while (st.dist >= e.gap) { st.dist -= e.gap; n++ }
        n = Math.min(n, 12)
      } else {
        st.t -= dt * 60
        if (st.t <= 0) { st.t = e.interval[0] + Math.random() * (e.interval[1] - e.interval[0]); n = e.count[0] + Math.floor(Math.random() * (e.count[1] - e.count[0] + 1)) }
      }
      if (!n) continue
      const matId = e.mat ? this.mats.byName.get(e.mat) : undefined
      const col = matId === undefined ? 0xffffff : this.mats.color[matId]
      // 图形发射:按帧从中心向外取图片像素环(火圈/水圈:一圈圈往外长)
      let ringPts = null
      if (e.image?.file) {
        const rings = this.rings.get(e.image.file)
        if (rings) {
          const rIdx = Math.floor(st.ring)
          st.ring += e.image.speed * dt * 60
          if (rIdx >= rings.length) { if (e.image.loop) st.ring = 0; continue }
          ringPts = rings[rIdx] || []
          n = Math.max(n, Math.min(64, ringPts.length / 2))
        }
      }
      for (let j = 0; j < n; j++) {
        const t = e.trail ? (j + 1) / (n + 1) : 1
        let x, y
        if (ringPts) {
          const q = (Math.floor(Math.random() * (ringPts.length / 2))) * 2
          x = p.x + e.ox + ringPts[q] * 0.25; y = p.y + e.oy + ringPts[q + 1] * 0.25 // 256px 图对应约 64px 半径
        } else {
          x = p.lastX + dx * t + e.ox + e.offX[0] + Math.random() * (e.offX[1] - e.offX[0])
          y = p.lastY + dy * t + e.oy + e.offY[0] + Math.random() * (e.offY[1] - e.offY[0])
          if (e.areaR[1] > 0) { const a = Math.random() * Math.PI * 2, r = e.areaR[0] + Math.random() * (e.areaR[1] - e.areaR[0]); x += Math.cos(a) * r; y += Math.sin(a) * r }
        }
        let vx = e.vx[0] + Math.random() * (e.vx[1] - e.vx[0]), vy = e.vy[0] + Math.random() * (e.vy[1] - e.vy[0])
        if (e.awayFromCenter) { const a = Math.atan2(y - p.y, x - p.x), s = Math.hypot(vx, vy) || 30; vx = Math.cos(a) * s; vy = Math.sin(a) * s }
        if (e.real && matId !== undefined) {
          // 真材质:火球拖火、火圈生火 —— 直接写进世界(只写空气格)
          const m = this.sim.get(Math.floor(x), Math.floor(y))
          if (m === 0) this.sim.set(Math.floor(x), Math.floor(y), matId, this.sim.kind[matId] === K_FIRE ? 6 + ((Math.random() * 8) | 0) : 0)
          continue
        }
        if (this.fx.length > 2500) break
        const life = e.life[0] + Math.random() * (e.life[1] - e.life[0])
        this.fx.push({ x, y, vx, vy, life, max: life, col, g: e.g, fade: e.fade, air: e.airflow, long: e.long })
      }
    }
    p.lastX = p.x; p.lastY = p.y
  }

  _die(p, byHit) {
    const d = p.d
    const x = Math.floor(p.x), y = Math.floor(p.y)
    // 留下精灵(箭插在地里、锯片躺着),挂在撞到的那格上,那格被挖掉就消失
    if (d.leaveSprite && byHit && d.sprite?.image) {
      const dir = Math.atan2(p.vy, p.vx)
      this.stuck.push({ d, x: p.x, y: p.y, rot: p.rot, frame: p.frame, life: 60, ax: p.x + Math.cos(dir) * 2, ay: p.y + Math.sin(dir) * 2 })
      if (this.stuck.length > 60) this.stuck.shift()
    }
    // 材质弹:死在哪就在哪变成那种材质(往回退一格别写进墙里)
    if (d.deathMaterial) {
      const id = this.mats.byName.get(d.deathMaterial)
      if (id !== undefined) {
        // on_death_particle_check_concrete:落点是实心就往回/四周找最近的空格放(液体里落下也一样,补在液面旁)
        const bx = Math.floor(p.x), by = Math.floor(p.y)
        const px = Math.floor(p.x - Math.sign(p.vx) * 1.2), py = Math.floor(p.y - Math.sign(p.vy) * 1.2)
        let placed = false
        const tryPut = (x, y) => { if (placed) return; const m = this.sim.get(x, y); if (m === 0 || (m > 0 && this.sim.kind[m] === K_GAS)) { this.sim.set(x, y, id, 0); placed = true } }
        tryPut(px, py); tryPut(bx, by)
        for (let r = 1; r <= 2 && !placed; r++) for (let dy = -r; dy <= r && !placed; dy++) for (let dx = -r; dx <= r && !placed; dx++) tryPut(px + dx, py + dy)
        if (!placed) this.hooks.debris?.(p.x, p.y, -p.vx * 0.2 + (Math.random() - 0.5) * 30, -20 - Math.random() * 30, id, this.mats.color[id])
      }
    }
    const ex = d.explosion
    if (!ex || !(byHit ? d.deathExplode : d.lifetimeExplode)) return
    this._lg = d.looseGround || null
    this.explode(p.x, p.y, ex, Math.atan2(-p.vy, -p.vx))
    this._lg = null
  }

  /** config_explosion 落地 */
  explode(x, y, ex, back = -Math.PI / 2) {
    const sim = this.sim, mats = this.mats
    const r = ex.radius
    const maxDur = ex.maxDurability || 10
    let dug = 0
    // config_explosion.damage 打到范围内的实体(damage_mortals)
    if (ex.damage > 0 && r > 0) this.hooks.explosion?.(x, y, r, ex.damage)
    const ms = ex.matSparks ? ex.matSparks[0] + Math.random() * (ex.matSparks[1] - ex.matSparks[0]) : 0
    if (ex.hole && r > 0) {
      for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
        if ((xx - x) ** 2 + (yy - y) ** 2 > r * r) continue
        const m = sim.get(xx, yy)
        if (m <= 0) continue
        const k = sim.kind[m]
        if (k === K_GAS || k === K_FIRE) continue
        if (k === K_LIQUID && !ex.holeLiquid) continue
        if ((k === K_STATIC || k === K_SAND) && this.durability[m] > maxDur) continue
        sim.set(xx, yy, 0)
        dug++
        // 真材质碎屑(material_sparks):按数量上限,沿反射向喷回
        if (ms > 0 && Math.random() < Math.min(0.6, ms / Math.max(4, r * r))) {
          const a2 = back + (Math.random() - 0.5) * 1.6, s = 50 + Math.random() * 120
          this.hooks.debris?.(xx + 0.5, yy + 0.5, Math.cos(a2) * s, Math.sin(a2) * s - 30, m, mats.color[m])
        }
      }
    }
    // create_cell:坑里生成材质(火球 → 火)
    if (ex.createCell?.mat) {
      const id = mats.byName.get(ex.createCell.mat)
      if (id !== undefined) {
        const rr = Math.max(1, r * 0.8)
        for (let yy = Math.floor(y - rr); yy <= Math.ceil(y + rr); yy++) for (let xx = Math.floor(x - rr); xx <= Math.ceil(x + rr); xx++) {
          if ((xx - x) ** 2 + (yy - y) ** 2 > rr * rr) continue
          if (sim.get(xx, yy) === 0 && Math.random() < ex.createCell.p / 100 * 0.6) sim.set(xx, yy, id, sim.kind[id] === K_FIRE ? 10 + ((Math.random() * 14) | 0) : 0)
        }
      }
    }
    // 白热火花
    if (ex.sparks) {
      const n = ex.sparks[0] + Math.random() * (ex.sparks[1] - ex.sparks[0])
      for (let k = 0; k < n && this.fx.length < 2500; k++) {
        const a2 = Math.random() * Math.PI * 2, s = 40 + Math.random() * 160
        const life = 0.3 + Math.random() * 0.5
        this.fx.push({ x, y, vx: Math.cos(a2) * s, vy: Math.sin(a2) * s - 40, life, max: life, col: Math.random() < 0.5 ? 0xffe8a0 : 0xff9a40, g: 300, fade: true, air: 0 })
      }
    } else if (dug) {
      for (let k = 0; k < 6; k++) { const a2 = back + (Math.random() - 0.5) * 1; const s = 80 + Math.random() * 120; this.fx.push({ x, y, vx: Math.cos(a2) * s, vy: Math.sin(a2) * s, life: 0.25, max: 0.25, col: 0xffe8af, g: 300, fade: true, air: 0 }) }
    }
    // LooseGroundComponent(崩塌大地):max_distance 内随机撒 min~max_radius 的圆块,把静态地面变成会掉的松散材质
    if (this._lg) {
      const lg = this._lg
      const loose = (m) => { const n = mats.name(m); const t = /^sand_static/.test(n) ? 'sand' : /^soil/.test(n) ? 'soil' : /^coal/.test(n) ? 'coal' : /^gold/.test(n) ? 'gold' : /^snow|^ice/.test(n) ? 'snow' : /wood/.test(n) ? 'wood' : 'rock_loose'; return mats.byName.get(t) }
      for (let k = 0; k < 24; k++) {
        if (Math.random() > lg.prob) continue
        const a = (Math.random() * 2 - 1) * lg.maxAngle, dist = Math.random() * lg.maxDist
        const cx = x + Math.cos(a) * dist, cy = y + Math.sin(a) * dist
        const m0 = sim.get(Math.floor(cx), Math.floor(cy))
        if (m0 <= 0 || sim.kind[m0] !== K_STATIC) continue
        const rr = lg.minR + Math.random() * (lg.maxR - lg.minR)
        for (let yy = Math.floor(cy - rr); yy <= Math.ceil(cy + rr); yy++) for (let xx = Math.floor(cx - rr); xx <= Math.ceil(cx + rr); xx++) {
          if ((xx - cx) ** 2 + (yy - cy) ** 2 > rr * rr) continue
          const m = sim.get(xx, yy)
          if (m > 0 && sim.kind[m] === K_STATIC) { const l = loose(m); if (l !== undefined) sim.set(xx, yy, l, 0) }
        }
      }
      this.hooks.shake?.(0.25)
    }
    // 爆炸帧动画 / 闪光 / 震屏 / 声音
    if (ex.sprite?.image) {
      const img = this.images.get(ex.sprite.image)
      if (img) this.anims.push({ img, fw: ex.sprite.fw || img.width, fh: ex.sprite.fh || img.height, frames: ex.sprite.frames, wait: Math.max(0.02, ex.sprite.wait), posX: ex.sprite.posX, posY: ex.sprite.posY, x, y, angle: 0, offX: ex.sprite.offX, offY: ex.sprite.offY, t: 0, additive: true })
    }
    const lr = ex.light ? 40 * ex.light.radius + r * 4 : 30 + r * 3
    this.flashes.push({ x, y, r: lr, rgb: ex.light ? `${ex.light.r},${ex.light.g},${ex.light.b}` : '255,235,190', life: ex.light ? ex.light.fade : 0.08, max: ex.light ? ex.light.fade : 0.08 })
    this.hooks.shake?.(Math.min(0.6, 0.05 + ex.shake * 0.011)) // camera_shake 0.5(火花弹)~50(炸弹)
    this.hooks.sfx?.(r >= 10 ? 'explosion' : 'impact', { vol: Math.min(1, 0.3 + r / 20), rate: r >= 40 ? 0.6 : r >= 10 ? 0.9 : 1.6, minGap: 50 })
  }

  /** 画:精灵(朝速度方向,additive)、化妆粒子、爆炸帧 */
  render(ctx, ox, oy) {
    ctx.imageSmoothingEnabled = false
    for (const f of this.fx) {
      const a = f.fade ? Math.max(0, f.life / f.max) : 1
      ctx.globalAlpha = a
      ctx.fillStyle = `rgb(${(f.col >> 16) & 255},${(f.col >> 8) & 255},${f.col & 255})`
      if (f.long) { // draw_as_long:按速度拉成一小段
        const l = Math.min(6, Math.hypot(f.vx, f.vy) / 60)
        const nx = f.vx / (Math.hypot(f.vx, f.vy) || 1), ny = f.vy / (Math.hypot(f.vx, f.vy) || 1)
        for (let k = 0; k <= l; k++) ctx.fillRect(Math.round(f.x - ox - nx * k), Math.round(f.y - oy - ny * k), 1, 1)
      } else ctx.fillRect(Math.round(f.x - ox), Math.round(f.y - oy), 1, 1)
    }
    ctx.globalAlpha = 1
    // 贴图粒子(烟团/光斑):按 color 染色 + alpha,帧按寿命推进
    for (const s of this.sfx) {
      const spr = s.spr, fw = spr.fw || s.img.width, fh = spr.fh || s.img.height
      const frame = spr.frames > 1 ? Math.min(spr.frames - 1, Math.floor(s.age / Math.max(0.01, spr.wait))) : 0
      ctx.save()
      ctx.globalCompositeOperation = s.additive ? 'lighter' : 'source-over'
      ctx.globalAlpha = Math.max(0, Math.min(1, s.col[3]))
      ctx.translate(Math.round(s.x - ox), Math.round(s.y - oy))
      ctx.rotate(s.useVelRot ? Math.atan2(s.vy, s.vx) : s.rot)
      ctx.scale(s.sx, s.sy)
      if (s.col[0] < 0.98 || s.col[1] < 0.98 || s.col[2] < 0.98) {
        // 染色:先画图,再用 multiply 叠色(保留透明区靠 destination-in)
        const t = this._tint(s.img, spr, frame, fw, fh, s.col)
        ctx.drawImage(t, -spr.offX, -spr.offY)
      } else ctx.drawImage(s.img.image, (spr.posX || 0) + frame * fw, spr.posY || 0, fw, fh, -spr.offX, -spr.offY, fw, fh)
      ctx.restore()
    }
    ctx.globalAlpha = 1
    const drawSprite = (d, x, y, rot, frame, speed = 0) => {
      // 刚体弹:PhysicsImageShape 的图居中、按滚动角旋转
      if (d.type === 'PHYSICS' && d.physics?.image) {
        const img = this.images.get(d.physics.image)
        if (img?.image) {
          ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(rot)
          ctx.drawImage(img.image, -Math.floor(img.width / 2), -Math.floor(img.height / 2))
          ctx.restore(); return
        }
      }
      // 材质粒子弹:就是一个飞着的材质像素(水滴蓝、油滴棕),不用 dirt 精灵
      if (d.type === 'MATERIAL_PARTICLE' && d.deathMaterial) {
        const id = this.mats.byName.get(d.deathMaterial)
        const c = id === undefined ? 0xffffff : this.mats.color[id]
        ctx.fillStyle = `rgb(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255})`
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1)
        return
      }
      const s = d.sprite
      const img = s?.image ? this.images.get(s.image) : null
      if (!img?.image) { ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2); return }
      const fw = s.fw || img.width, fh = s.fh || img.height
      ctx.save()
      ctx.globalCompositeOperation = d.additive || d.emissive ? 'lighter' : 'source-over'
      ctx.globalAlpha = d.spriteAlpha ?? 1
      ctx.translate(Math.round(x), Math.round(y))
      ctx.rotate(rot)
      // velocity_sets_scale:沿飞行方向按速度拉长(Noita 的弹越快越"长")
      if (d.velocitySetsScale && speed) ctx.scale(Math.max(0.5, Math.min(2.5, 0.4 + (speed / 450) * d.velocitySetsScaleCoeff)), 1)
      ctx.drawImage(img.image, (s.posX || 0) + frame * fw, s.posY || 0, fw, fh, -s.offX, -s.offY, fw, fh)
      ctx.restore()
    }
    for (const s of this.stuck) drawSprite(s.d, s.x - ox, s.y - oy, s.rot, s.frame)
    for (const p of this.list) drawSprite(p.d, p.x - ox, p.y - oy, p.rot, p.frame, Math.hypot(p.vx, p.vy))
    for (const a of this.anims) {
      const frame = Math.min(a.frames - 1, Math.floor(a.t / a.wait))
      ctx.save()
      ctx.globalCompositeOperation = a.additive ? 'lighter' : 'source-over'
      ctx.translate(Math.round(a.x - ox), Math.round(a.y - oy))
      if (a.angle) ctx.rotate(a.angle)
      ctx.drawImage(a.img.image, (a.posX || 0) + frame * a.fw, a.posY || 0, a.fw, a.fh, -a.offX, -a.offY, a.fw, a.fh)
      ctx.restore()
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  /** 贴图染色缓存:同一帧同一色只算一次 */
  _tint(img, spr, frame, fw, fh, col) {
    const key = `${spr.image}|${frame}|${(col[0] * 15) | 0},${(col[1] * 15) | 0},${(col[2] * 15) | 0}`
    this.tintCache ||= new Map()
    let cv = this.tintCache.get(key)
    if (cv) return cv
    cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(fw, fh) : Object.assign(document.createElement('canvas'), { width: fw, height: fh })
    const c = cv.getContext('2d')
    c.drawImage(img.image, (spr.posX || 0) + frame * fw, spr.posY || 0, fw, fh, 0, 0, fw, fh)
    c.globalCompositeOperation = 'multiply'
    c.fillStyle = `rgb(${(col[0] * 255) | 0},${(col[1] * 255) | 0},${(col[2] * 255) | 0})`
    c.fillRect(0, 0, fw, fh)
    c.globalCompositeOperation = 'destination-in'
    c.drawImage(img.image, (spr.posX || 0) + frame * fw, spr.posY || 0, fw, fh, 0, 0, fw, fh)
    if (this.tintCache.size > 300) this.tintCache.clear()
    this.tintCache.set(key, cv)
    return cv
  }

  /** 光源:cb(x, y, radius, 'r,g,b', alpha) */
  lights(cb, ox, oy) {
    for (const p of this.list) if (p.d.light) cb(p.x - ox, p.y - oy, p.d.light.radius, `${p.d.light.r},${p.d.light.g},${p.d.light.b}`, 0.7)
    for (const f of this.flashes) cb(f.x - ox, f.y - oy, f.r, f.rgb, 0.9 * (f.life / f.max))
  }
}
