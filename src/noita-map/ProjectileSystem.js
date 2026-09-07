// ── 投射物系统:定义全部来自 data/entities/projectiles/deck/*.xml(projectiles.json),对标 Noita ──
// 每颗弹:VelocityComponent(重力/空气阻力)→ ProjectileComponent(速度/寿命/碰撞死/爆炸配置)→ SpriteComponent(帧动画,朝速度方向,additive)
// → ParticleEmitterComponent×N(拖尾:材质色化妆粒子,或 create_real_particles 往世界注入真材质)→ LightComponent(彩色光)。
// 爆炸 config_explosion(反 exe ExplosionFactory):360 条射线按 ray_energy 扣材质 hp 决定每个角度挖多深(火球挖不动岩石只挖土),durability > max_durability_to_destroy 的材质挡住射线(炸弹挖不动钢),
// material_sparks 出真材质碎屑,sparks 出白热火花,create_cell 在坑里生成材质(火球→火),explosion_sprite 播爆炸帧,camera_shake 震屏。

import { EXTRA_BEHAVIOR } from './Wands.js'

const K_STATIC = 1, K_SAND = 2, K_LIQUID = 3, K_GAS = 4, K_FIRE = 5
const EXPLODE_BIG_PER_FRAME = 2 // 半径 ≥ 20 的爆炸每帧最多处理几个,多的排到下一帧(见 _die)
const DX8 = [1, 1, 0, -1, -1, -1, 0, 1], DY8 = [0, 1, 1, 1, 0, -1, -1, -1]
// 世界格坐标 → Map 键(坐标可负:各偏移 2^19,再拼成一个 ≤ 2^40 的整数,double 精确)
const KOFF = 1 << 19, KMUL = 1 << 20
const ckey = (x, y) => (x + KOFF) * KMUL + (y + KOFF)

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
  constructor({ defs, mats, sim, decodePng, res, hooks = {}, maxSfx = 400 }) {
    this.defs = defs
    this.mats = mats
    this.sim = sim
    this.decodePng = decodePng
    this.res = res
    this.hooks = hooks
    this.maxSfx = maxSfx // 贴图粒子上限(每个都是一次 save/rotate/scale/lighter drawImage;手机上调低)
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
    // 电(ElectricityComponent):导电材质表(materials.xml electrical_conductivity:液体缺省导电、油 / 胶水 0、金属 1)+ 正在窜的电流 + 亮着的格子
    this.conductive = new Uint8Array(mats.list.length)
    for (const m of mats.list) this.conductive[m.id] = m.electricalConductivity ? 1 : 0
    this.warmTo = new Uint16Array(mats.list.length) // warmth_melts_to_material(水 → 蒸汽):电流加热用
    for (const m of mats.list) if (m.kind === 'liquid' && m.warmthMeltsToMaterial) this.warmTo[m.id] = mats.byName.get(m.warmthMeltsToMaterial) || 0
    this._exQueue = []; this._exBig = 0 // 大爆炸限额(见 _die / _flushExplosions)
    this.bhParts = []         // 黑洞崩出来的飞行像素 {x,y,vx,vy,col,p}
    this.zaps = []            // {x,y,dx,dy,energy,speed,heat,owner}
    this.elec = new Map()     // key(x,y) → 熄灭时刻(秒,以 this.time 计);渲染成闪的亮蓝格,活物碰到就被电
    this.time = 0
    this.loops = new Map()    // AudioLoopComponent:本帧还活着的循环声名 → 数量
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

  /**
   * 发射:x,y 杖尖,angle 弧度。c = 这颗弹所属 shot 的最终 ConfigGunActionInfo(Wands.cast 回放修饰卡 ops 得到),按引擎语义作用到弹上:
   *   speed_multiplier 乘初速;damage_projectile_add 加伤;lifetime_add 加寿命(帧);bounces 加反弹次数;gravity 加到 VelocityComponent.gravity_y;
   *   knockback_force 加击退;explosion_radius / damage_explosion(_add) 加到 config_explosion;friendly_fire;extra_entities → 行为(见 Wands.EXTRA_BEHAVIOR);
   *   game_effect_entities → 命中时给目标的状态
   */
  spawn(name, x, y, angle, { spreadRad = 0, owner = 'player', speedMul = 1, payload = null, dmgAdd = 0, c = null } = {}) {
    const d = this.defs[name]
    if (!d) return null
    if (c) { speedMul *= c.speed_multiplier; dmgAdd += c.damage_projectile_add || 0 }
    const a = angle + (Math.random() - 0.5) * (d.dirRandom + spreadRad)
    const spd = (d.speed[0] + Math.random() * (d.speed[1] - d.speed[0])) * speedMul
    let life = (d.lifetime + (Math.random() * 2 - 1) * d.lifetimeRandom) / 60
    if (c?.lifetime_add) life += c.lifetime_add / 60
    // cloud_position.lua:雨云出生时往上找 40px 内的天花板,挂在下面
    if (d.riseTo) { const sim = this.sim; let k = 0; while (k < d.riseTo) { const m = sim.get(Math.floor(x), Math.floor(y - k - 1)); if (m > 0 && (sim.kind[m] === K_STATIC || sim.kind[m] === K_SAND)) break; k++ } y -= k }
    // teleport_cast.lua:出生就跳到 range 内随机一个敌人身上(载荷会在那儿放)
    if (d.castTo && this.hooks.nearestTarget) { const t = this.hooks.nearestTarget(x, y, d.castTo.range, owner, { random: true }); if (t) { x = t.x; y = t.y } }
    const p = {
      name, d, x, y, owner, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, speed0: spd, life: life > 0 ? life : 30, age: 0, frame: 0, ft: 0,
      emit: d.emitters.map(() => ({ t: 0, dist: 0, ring: 0 })), sEmit: (d.sprEmitters || []).map(() => ({ t: 0 })), lastX: x, lastY: y, dead: false,
      bounces: d.bounces, rot: a, spin: d.angularVelocity || 0, frames: 0,
      payload: payload && payload.length ? payload : null, // 触发弹(gun.lua BeginTriggerHitWorld / Timer / Death)的载荷:死的时候在原地朝原方向放出
      dmgAdd, // 修饰卡 damage_projectile_add 累加的加伤
      conv: (d.converters || []).map(() => ({ r: 0, done: false })), // MagicConvertMaterialComponent 扫环进度
      c, gAdd: 0, afAdd: 0, kbAdd: 0, exR: 0, exD: 0, beh: null, effects: null, friendly: false,
    }
    if (c) this._applyC(p, c)
    this.list.push(p)
    // 材质转换从出生这一帧就开始扫(触摸系法术只活 4 帧,不能等下一帧)
    ;(d.converters || []).forEach((c, k) => this._convert(p, c, k, 1 / 60))
    // 枪口火焰 + 发射闪光
    if (d.muzzle?.variants.length) {
      const img = this.images.get(d.muzzle.variants[(Math.random() * d.muzzle.variants.length) | 0])
      if (img) this.anims.push({ img, fw: img.width, fh: img.height, frames: 1, wait: 0.06, x, y, angle: a, offX: d.muzzle.offX, offY: d.muzzle.offY, t: 0, additive: d.muzzle.additive })
    }
    if (d.shootFlash) this.flashes.push({ x, y, r: d.shootFlash.radius, rgb: `${d.shootFlash.r},${d.shootFlash.g},${d.shootFlash.b}`, life: 0.06, max: 0.06 })
    if (d.shakeWhenShot) this.hooks.shake?.(d.shakeWhenShot * 0.08)
    // AudioComponent event_root:黑洞出生一声低沉的"咚",其余按弹种给个近似
    if (d.blackHole) this.hooks.sfx?.('explosion', { vol: 0.7, rate: 0.35, minGap: 100 })
    else this.hooks.sfx?.(d.type === 'MATERIAL_PARTICLE' ? 'water' : d.explosion && d.explosion.radius >= 10 ? 'fire' : 'electric', { vol: 0.3, rate: d.type === 'MATERIAL_PARTICLE' ? 1.3 : 1.2 + Math.random() * 0.2, minGap: 40 })
    return p
  }

  update(dt) {
    const sim = this.sim
    this.time += dt
    this.loops.clear()
    this._flushExplosions()
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]
      const d = p.d
      p.age += dt
      if (d.loop) this.loops.set(d.loop, (this.loops.get(d.loop) || 0) + 1)
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
      if (p.beh || p.homing) this._behave(p, dt)
      // 反 exe VelocitySystem::Update:v += g·dt;v −= v·air_friction·dt;液体里再 −= v·liquid_drag·dt(按碰到的液体格数,这里取 1);|v| ≤ terminal_velocity
      p.vy += (isMat ? 150 : d.gravity + p.gAdd) * dt
      const af = isMat ? d.friction * 0.25 : d.airFriction + p.afAdd
      if (af) { const f = 1 - af * dt; p.vx *= f; p.vy *= f }
      // VelocitySystem:液体里 v −= v·liquid_drag·dt·液体格数(格数 = 位置周围 3×3 里的液体格,_displaceLiquid 数的 mLatestLiquidHitCount)
      if (!isMat && p.wasLiq && d.liquidDrag) { const f = Math.max(0, 1 - d.liquidDrag * dt * Math.max(1, p.liqHits || 0)); p.vx *= f; p.vy *= f }
      // 子步进碰撞;撞上实心:先看 bounces_left —— 有次数就反弹(bounce_always 任何角度都弹,否则只有擦着弹;
      // bounce_at_any_angle 按真实法线反射),没了才 on_collision_die;ground_penetration 允许穿进地里一段
      const sp = Math.hypot(p.vx, p.vy)
      // 穿地弹按 1px 步进(每格都要过一遍能量判定),其余 2px;步长按当前速度算——穿地时速度被削,后面的步子随之变短
      const sub = Math.max(1, Math.ceil(sp * dt / (d.groundPenetration > 0 ? 1 : 2)))
      let hit = false, hitLiquid = false
      // 实体命中先粗筛一次(Entities.anyNear):这一帧的位移包围盒再外扩一个位移长度(反弹后也不会跑出去)里没怪没刚体就整帧不做 hitTest
      const testHit = this.hooks.hitTest && p.age > 0.02 && d.type !== 'MATERIAL_PARTICLE' && d.type !== 'STATIC'
        && (!this.hooks.hitNear || this.hooks.hitNear(p.x - sp * dt, p.y - sp * dt, p.x + p.vx * dt + sp * dt, p.y + p.vy * dt + sp * dt, p))
      for (let s = 0; s < sub && !hit; s++) {
        const nx = p.x + (p.vx * dt) / sub, ny = p.y + (p.vy * dt) / sub
        // 命中实体(HitboxComponent):ProjectileComponent.damage 交给实体层;on_collision_die 的弹在这里死
        if (testHit) {
          // 2px 子步只采终点会从刚体上被前几发抠出的 3px 洞里穿过去(灯笼打两发后面全 miss):步子 >1px 时补采一次中点
          const t = this.hooks.hitTest(nx, ny, p) || (sub < sp * dt ? this.hooks.hitTest((p.x + nx) / 2, (p.y + ny) / 2, p) : null)
          if (t && t !== p.lastHit) {
            p.lastHit = t
            // damage_scaled_by_speed:伤害 × min(1, 当前速度 / (damage_scale_max_speed || 初速))(箭 / 飞盘慢下来就软)
            const scale = d.dmgBySpeed ? Math.min(1, sp / ((d.dmgMaxSpeed || p.speed0) || 1)) : 1
            p.hitX = nx; p.hitY = ny // 真正打中的那个点(p.x/p.y 还是子步前的位置,差 1~2px 就抠不到刚体像素)
            this.hooks.hitEntity?.(t, p, ((d.damage || 0) + (p.dmgAdd || 0)) * scale)
            if (d.collisionDie && !d.penetrateEntities && !p.beh?.pierce) { p.x = nx; p.y = ny; hit = true; break } // penetrate_entities / 穿透射击:穿过去,每个实体只伤一次
          }
        }
        const m = sim.get(Math.floor(nx), Math.floor(ny))
        const k = m > 0 ? sim.kind[m] : 0
        const solid = k === K_STATIC || k === K_SAND
        const liquid = k === K_LIQUID
        if (m >= 0 && liquid && (d.dieOnLiquid || d.type === 'MATERIAL_PARTICLE')) { hitLiquid = true; hit = true; break }
        // 穿水的弹丸(多数弹默认 die_on_liquid_collision=0):VelocityComponent.displace_liquid —— 每到一个新格把周围 3×3 的液体格以一成弹速顶回去(见 _displaceLiquid)
        if (m >= 0 && liquid && d.type !== 'MATERIAL_PARTICLE') p.inLiq = true
        else if (m >= 0 && !liquid) p.inLiq = false
        // clipping_shot:penetrate_world,在地里以 penetrate_world_velocity_coeff(0.1)的速度挪
        if (m >= 0 && solid && p.beh?.clip) { p.x += (nx - p.x) * p.beh.clip; p.y += (ny - p.y) * p.beh.clip; continue }
        if (m >= 0 && solid && d.collideWorld) {
          if (p.noHit > 0) { p.x = nx; p.y = ny; continue }
          // ground_penetration(反 exe ProjectileSystem 0xd32970):E = coeff × mass × ½|v|²;这格 take = min(hp, E),v ×= (1 − take/E);
          // 吃得下整格 hp 就把格挖掉继续钻(光明穿凿 coeff 4 / 1400px/s:E 6.5e6,岩石 1e5 一格掉 1.5% 速度,神殿砖 1e6 一格掉 15%),
          // 吃不下就停在这格(长枪扎进土里);ground_penetration_max_durability_to_destroy > 0 时耐久更高的格直接挡住;|v| ≤ 10 也停
          if (d.groundPenetration > 0) {
            const sp2 = p.vx * p.vx + p.vy * p.vy
            const hpT = this.matHp ||= (() => { const a = new Float32Array(this.mats.list.length); for (const q of this.mats.list) a[q.id] = q.hp || 0; return a })()
            if (sp2 > 100 && !(d.groundPenMaxDur > 0 && this.durability[m] > d.groundPenMaxDur)) {
              const E = d.groundPenetration * (d.mass || 1) * 0.5 * sp2, hpc = hpT[m] || 1, take = Math.min(hpc, E)
              const f = 1 - take / E; p.vx *= f; p.vy *= f
              if (take >= hpc) {
                sim.set(Math.floor(nx), Math.floor(ny), 0, 0)
                if (Math.random() < 0.3) this.hooks.debris?.(nx, ny, -p.vx * 0.05 + (Math.random() - 0.5) * 40, -p.vy * 0.05 - 20 - Math.random() * 30, m, this.mats.color[m])
                p.x = nx; p.y = ny; continue
              }
            }
          }
          if (p.bounces > 0 && this._tryBounce(p, nx, ny)) { p.bounces--; continue }
          hit = true; break
        }
        p.x = nx; p.y = ny
      }
      // VelocitySystem::Update 0xd67cf7:apply_terminal_velocity 时 |v| > terminal_velocity → v = v̂·terminal;在位置积分之后才夹,
      // 所以初速 1400 的光明穿凿第一帧仍跑满 23px,第二帧才被夹到 1000
      if (d.terminal > 0) { const sp0 = Math.hypot(p.vx, p.vy); if (sp0 > d.terminal) { p.vx *= d.terminal / sp0; p.vy *= d.terminal / sp0 } }
      if (p.spin) p.rot += p.spin * dt
      else if (d.velRotation) p.rot = Math.atan2(p.vy, p.vx)
      p.frames += dt * 60
      // 场(GameAreaEffectComponent radius / frame_length):半径内的活物每 frame_length 帧吃一次 damage_game_effect_entities 的状态(冻结 / 电击)
      const AE = d.areaEffect
      if (AE) {
        p.areaT = (p.areaT ?? 0) - dt
        if (p.areaT <= 0) { p.areaT = AE.every / 60; if (AE.effects.length) this.hooks.areaEffect?.(p.x, p.y, AE.radius, AE.effects, p) }
        // EnergyShieldComponent(遮蔽之环 radius 28):进圈的敌方弹被弹开
        if (d.shield) for (const q of this.list) if (q !== p && q.owner !== p.owner && !q.d.areaEffect && q.d.type !== 'STATIC') {
          const ddx = q.x - p.x, ddy = q.y - p.y, dist = Math.hypot(ddx, ddy)
          if (dist < d.shield.radius && dist > 0.1 && (q.vx * ddx + q.vy * ddy) < 0) { const sp2 = Math.hypot(q.vx, q.vy); q.vx = (ddx / dist) * sp2; q.vy = (ddy / dist) * sp2; q.rot = Math.atan2(q.vy, q.vx); q.lastHit = null; this.hooks.spark?.(q.x, q.y, -q.vx * 0.1, -q.vy * 0.1, '#80c0ff', 0.2) }
        }
      }
      // 雷霆之环 electrocution_blast.lua:每 10 帧从圈内(±28)随机一点朝随机方向射一道电(misc/electricity.xml,速度 5000)——碰到导电材质就钻进去窜
      const EL = d.electricity
      if (EL) { p.elT = (p.elT ?? 0) + dt * 60; while (p.elT >= EL.every) { p.elT -= EL.every; this._shootElectricity(p, EL) } }
      // BlackHoleComponent(巨大黑洞,引擎内置;对着 wiki 演示 gif 反的):半径每 3 帧 +1 长到 64。它**不是一口吞掉圈内所有格子**,
      // 而是把圈内的格子一点点崩成飞行像素(wiki:"crumbles any Materials that come into contact with it"),这些像素被 particle_attractor(= radius × 0.25,lua 每 3 帧改)
      // 拉着绕中心打转、最后在中心湮灭 —— 画面就是一圈淡淡的紫环里满是旋进去的碎屑和粉色长条流光;圈内活物按 damage_probability 每帧吃一次 damage_amount(文档默认 0.1),并被吸向中心
      const BH = d.blackHole
      if (BH) {
        if (p.bhR === undefined) { p.bhR = BH.radius; p.bhT = 0; p.bhAttr = BH.attractor }
        if (BH.grow) { p.bhT += dt * 60; while (p.bhT >= BH.grow.every) { p.bhT -= BH.grow.every; p.bhR = Math.min(BH.grow.max, p.bhR + BH.grow.step); p.bhAttr = p.bhR * BH.grow.attrPerR } }
        this._bhCrumble(p, dt)
        if (BH.damageProb > 0) this.hooks.blackHole?.(p.x, p.y, p.bhR, BH.damageProb, BH.damageAmount, p.bhAttr, dt, p)
        // 子实体 LooseGroundComponent(probability 0.2 / chunk_probability 0.03 / max_angle π,lua 每次 max_distance = radius + 20):
        // 从中心朝随机方向射线,碰到的第一块地面(圈里圈外都算)崩成松散材质掉下来 —— 掉进圈里再被崩成飞行像素
        const L = BH.loose
        if (L) {
          const lg = { prob: 1, maxDist: p.bhR + L.distAdd, minR: L.minR, maxR: L.maxR, maxAngle: L.maxAngle }
          let n = 0
          if (Math.random() < L.prob * dt * 60) n += this._loosen(p.x, p.y, lg, 1)
          if (Math.random() < L.chunkProb * dt * 60) n += this._loosen(p.x, p.y, { ...lg, minR: L.maxR, maxR: L.maxR * 2, maxAngle: L.chunkMaxAngle }, 1)
          if (n > 40) { this.hooks.shake?.(0.06); this.hooks.sfx?.('impact', { vol: 0.25, rate: 0.6, minGap: 250 }) }
        }
      }
      // black_hole_gravity.lua:150px 内的其他弹丸每帧 v += 196 × (1 − d/150) 朝中心(黑洞之间互不吸);刚体(PhysicsApplyForceOnArea)×0.2 交给实体层。
      // 玩家和普通怪不是刚体,原版不吸(只在圈里吃伤害)
      const GW = d.gravityWell
      if (GW) {
        const f60 = dt * 60
        for (const q of this.list) {
          if (q === p || q.d.gravityWell || q.d.blackHole || q.d.type === 'STATIC' || /black_hole/.test(q.d.tags)) continue
          const ddx = p.x - q.x, ddy = p.y - q.y, dist = Math.hypot(ddx, ddy)
          if (dist >= GW.dist || dist < 0.5) continue
          const f = GW.coeff * (1 - dist / GW.dist) * f60
          q.vx += (ddx / dist) * f; q.vy += (ddy / dist) * f
        }
        this.hooks.pull?.(p.x, p.y, GW.dist, GW.coeff * GW.bodyMul, dt)
      }
      // 材质转换扫环(冰球一路冻水/灭火、火球点燃周围可燃物、静止之环冻住 72px 内的液体)/ 吃格子(大锯刃、黑洞)
      if (p.conv.length) for (let k = 0; k < d.converters.length; k++) this._convert(p, d.converters[k], k, dt)
      if (d.cellEater) this._eat(p, d.cellEater)
      // 拖尾发射器 / 贴图粒子发射器
      this._emit(p, dt)
      this._emitSprites(p, dt)
      // 精灵帧
      // 精灵帧:loop=0 播到头 → 有 next_animation 就切过去(场类 blast:spawn → fireball 脉动),没有就停在最后一帧
      const SPR = p.spr || d.sprite
      if (SPR && SPR.frames > 1) {
        p.ft += dt
        if (p.ft >= SPR.wait) {
          p.ft = 0
          if (p.frame + 1 < SPR.frames || SPR.loop) p.frame = (p.frame + 1) % SPR.frames
          else if (SPR.next) { p.spr = SPR.next; p.frame = 0 }
        }
      }
      // 液体位移一帧一次(原版按帧末位置,不是每个子步):这一帧落在液体里 → 周围 3×3 顶一次;入水那一下响一声
      if (p.inLiq && !hit && d.type !== 'MATERIAL_PARTICLE') { this._displaceLiquid(p); if (!p.wasLiq && sp > 120) this.hooks.sfx?.('water', { vol: Math.min(0.6, 0.15 + sp / 900), rate: 1.1 + Math.random() * 0.3, minGap: 90 }); p.wasLiq = true }
      else if (!p.inLiq && !hit) p.wasLiq = false
      if (hit && hitLiquid && d.type !== 'MATERIAL_PARTICLE') { this._displaceLiquid(p); this.hooks.sfx?.('water', { vol: Math.min(0.6, 0.15 + sp / 900), rate: 1.1 + Math.random() * 0.3, minGap: 90 }) }
      if (hit && (d.collisionDie || hitLiquid)) { this._die(p, true); this.list.splice(i, 1); continue }
      if (d.dieLowVel && p.age > 0.1 && Math.hypot(p.vx, p.vy) < d.dieLowVel) { this._die(p, true); this.list.splice(i, 1); continue }
      if (p.age >= p.life) { this._die(p, false); this.list.splice(i, 1); continue }
      if (p.age > 30) this.list.splice(i, 1)
    }
    this._stepZaps(dt)
    if (this.bhParts.length) this._stepBhParts(dt)
    for (let i = this.stuck.length - 1; i >= 0; i--) { const s = this.stuck[i]; s.life -= dt; if (s.life <= 0 || this.sim.get(Math.floor(s.ax), Math.floor(s.ay)) === 0) this.stuck.splice(i, 1) }
    // 化妆粒子
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]
      f.life -= dt
      if (f.life <= 0) { this.fx.splice(i, 1); continue }
      f.vy += f.g * dt
      if (f.air) { f.vx += (Math.random() - 0.5) * f.air * dt * 60; f.vy += (Math.random() - 0.5) * f.air * dt * 60 }
      // attractor_force(黑洞的粉色流光):每帧朝发射源加 force(px/s),越近越快 → 长条流光全朝洞心飞
      if (f.att) { const dx = f.ax - f.x, dy = f.ay - f.y, dd = Math.hypot(dx, dy) || 1; if (dd < 2) { this.fx.splice(i, 1); continue } f.vx += (dx / dd) * f.att * dt * 60; f.vy += (dy / dd) * f.att * dt * 60 }
      f.x += f.vx * dt; f.y += f.vy * dt
    }
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i]; a.t += dt
      // SpriteParticleEmitter 出来的会飞的火花(金块闪光):带速度 + velocity_slowdown
      if (a.vx || a.vy) { a.x += a.vx * dt; a.y += a.vy * dt; const f = Math.exp(-(a.slow || 0) * dt); a.vx *= f; a.vy *= f }
      if (a.t >= (a.life ?? a.wait * a.frames)) this.anims.splice(i, 1)
    }
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

  /**
   * 弹丸在液体里(反 exe VelocitySystem::Update 0xd67458,VelocityComponent.displace_liquid 默认 1):
   * 这一帧所在格变了 → 看位置周围 3×3 格,每个液体格计入 mLatestLiquidHitCount(liquid_drag 用),并以 rand%100 < 75 的概率
   * 把那格抛成飞行粒子,速度 = −(mVelocity × 0.1) 再转 Random(−0.3, 0.3) rad —— 水沿着弹的来向以一成弹速被顶回去,水面就是这样"鼓"起来的;
   * 没有别的溅射。返回抛了几格(入水那一下响一声)
   */
  _displaceLiquid(p) {
    const sim = this.sim, cx = Math.floor(p.x), cy = Math.floor(p.y)
    if (p.dispX === cx && p.dispY === cy) return 0
    p.dispX = cx; p.dispY = cy
    let n = 0, hits = 0
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      const m = sim.get(x, y)
      if (m <= 0 || sim.kind[m] !== K_LIQUID) continue
      hits++
      if (Math.random() * 100 >= 75) continue
      const a = (Math.random() - 0.5) * 0.6, ca = Math.cos(a), sa = Math.sin(a)
      const vx = -p.vx * 0.1, vy = -p.vy * 0.1
      sim.set(x, y, 0, 0)
      this.hooks.debris?.(x + 0.5, y + 0.5, vx * ca - vy * sa, vx * sa + vy * ca, m, this.mats.color[m], true)
      n++
    }
    p.liqHits = hits
    return n
  }

  _tryBounce(p, hx, hy) {
    const d = p.d
    const [nx, ny] = this._normalAt(Math.floor(hx), Math.floor(hy))
    const sp = Math.hypot(p.vx, p.vy) || 1
    const cosIn = -(p.vx * nx + p.vy * ny) / sp // 1 = 正撞,0 = 擦边
    // 反 exe ProjectileSystem::Update:反射向量 r = v − 2(v·n)n,只有 r̂·v̂ > 0.75(即 1 − 2cos²θ > 0.75,入射角离表面 < 20.7°)才弹,否则要 bounce_always
    if (p.noBounce) return false // remove_bounce.lua:bounce_always = false, bounces_left = 0
    if (!d.bounceAlways && !d.bounceAnyAngle && 1 - 2 * cosIn * cosIn <= 0.75) return false
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

  /** 把 shot 的 c 作用到弹上(引擎 GunSystem 在 RegisterGunAction 后做的事;数值语义见 spawn 注释) */
  _applyC(p, c) {
    p.bounces += c.bounces || 0
    p.gAdd = c.gravity || 0
    p.kbAdd = c.knockback_force || 0
    p.ragdollFx = c.ragdoll_fx || 0 // 1 NORMAL / 2 BLOOD_EXPLOSION(火箭 / 核弹 / 高爆)/ 3 BLOOD_SPRAY(GORE 卡),和引擎 RAGDOLL_FX 枚举同序
    p.exR = c.explosion_radius || 0
    p.exD = (c.damage_explosion || 0) + (c.damage_explosion_add || 0)
    p.friendly = !!c.friendly_fire
    const beh = {}
    for (const f of String(c.extra_entities || '').split(',')) {
      const key = f.trim().split('/').pop().replace('.xml', '')
      if (!key) continue
      const b = EXTRA_BEHAVIOR[key]
      if (b) Object.assign(beh, b)
    }
    if (Object.keys(beh).length) {
      p.beh = beh
      if (beh.homing) p.homing = { ...beh.homing }
      if (beh.noBounce) { p.bounces = 0; p.noBounce = true }
      if (beh.nolla) p.life = 1 / 60
      if (beh.lifetimeInfinite) { p.life = 1e9; p.friendly = true }
      if (beh.airFrictionAdd) p.afAdd = beh.airFrictionAdd
      if (beh.autoaim && this.hooks.nearestTarget) {
        // autoaim.lua:出生那帧朝 range 内最近的敌人(要有视线)把方向 lerp 过去(steer 0.8),再抖 ±scatter 弧度
        const t = this.hooks.nearestTarget(p.x, p.y, beh.autoaim.range, p.owner, { los: true })
        if (t) {
          const sp = Math.hypot(p.vx, p.vy) || 1, dx = t.x - p.x, dy = t.y - p.y, dl = Math.hypot(dx, dy) || 1
          let nx = (dx / dl) * (1 - beh.autoaim.steer) + (p.vx / sp) * beh.autoaim.steer, ny = (dy / dl) * (1 - beh.autoaim.steer) + (p.vy / sp) * beh.autoaim.steer
          const nl = Math.hypot(nx, ny) || 1, rot = (Math.random() * 2 - 1) * beh.autoaim.scatter, cr = Math.cos(rot), sr = Math.sin(rot)
          nx /= nl; ny /= nl
          p.vx = (nx * cr - ny * sr) * sp; p.vy = (nx * sr + ny * cr) * sp
        }
      }
    }
    const fx = String(c.game_effect_entities || '').split(',').map((f) => f.trim().split('/').pop().replace('.xml', '').replace(/^effect_/, '')).filter(Boolean)
    if (fx.length) p.effects = fx
  }

  /** 每帧的附加行为(extra_entities 的 lua / 组件),在速度积分前调 */
  _behave(p, dt) {
    const b = p.beh, f60 = dt * 60
    // HomingComponent(反 exe HomingSystem::Update):detect 内最近目标;accelerate 模式 v = v×mult + dir×coeff×dt×(1 − d/detect);rotate 模式只转向,每帧最多 turn 弧度
    if (p.homing && this.hooks.nearestTarget) {
      const h = p.homing
      const t = this.hooks.nearestTarget(p.x, p.y, h.detect, p.owner, { shooter: !!h.shooter })
      if (t) {
        const dx = t.x - p.x, dy = t.y - p.y, dist = Math.hypot(dx, dy) || 1
        if (h.rotate) {
          const sp = Math.hypot(p.vx, p.vy) || 1, cur = Math.atan2(p.vy, p.vx), want = Math.atan2(dy, dx)
          let da = Math.atan2(Math.sin(want - cur), Math.cos(want - cur))
          da = Math.max(-h.turn, Math.min(h.turn, da))
          p.vx = Math.cos(cur + da) * sp; p.vy = Math.sin(cur + da) * sp
        } else {
          const f = Math.max(0, 1 - dist / h.detect), m = Math.pow(h.mult, f60), k = h.coeff * dt * f
          p.vx = p.vx * m + (dx / dist) * k; p.vy = p.vy * m + (dy / dist) * k
        }
      }
      if (h.accel) { h.coeff = Math.min(h.accel.coeffMax, h.coeff + h.accel.coeffAdd * f60); h.mult = Math.min(h.accel.multMax, h.mult + h.accel.multAdd * f60) }
    }
    if (!b) return
    // homing_cursor.lua:每帧把速度方向朝法杖朝向转 20%
    if (b.cursor && this.hooks.aimAngle && p.owner === 'player') {
      const sp = Math.hypot(p.vx, p.vy) || 1, cur = Math.atan2(p.vy, p.vx), want = this.hooks.aimAngle()
      const da = Math.atan2(Math.sin(want - cur), Math.cos(want - cur)) * b.cursor
      p.vx = Math.cos(cur + da) * sp; p.vy = Math.sin(cur + da) * sp
    }
    // fly_upwards / fly_downwards.lua:第 20 帧那一下,速度变成竖直的 2|v|
    if (b.flyAt && !p.flew && p.frames >= b.flyAt.frame) { p.flew = true; const sp = Math.hypot(p.vx, p.vy); p.vx = 0; p.vy = b.flyAt.dir * sp * 2 }
    // SineWaveComponent:方向按 m × sin(freq × 帧数) 摆
    if (b.sine) {
      const t = p.frames, prev = (p.sineT ?? t), ang = b.sine.m * (Math.sin(b.sine.freq * t) - Math.sin(b.sine.freq * prev))
      p.sineT = t
      if (ang) { const cr = Math.cos(ang), sr = Math.sin(ang), vx = p.vx; p.vx = vx * cr - p.vy * sr; p.vy = vx * sr + p.vy * cr }
    }
    // chaotic_arc.lua:每 2 帧 v += Random(−0.4·max|v|, +0.4·max|v|)(x y 用同一个随机数)
    if (b.chaos) { p.chaosT = (p.chaosT || 0) + f60; if (p.chaosT >= b.chaos.every) { p.chaosT -= b.chaos.every; const s = Math.max(Math.abs(p.vx), Math.abs(p.vy)) * b.chaos.scale, r = (Math.random() * 2 - 1) * s; p.vx += r; p.vy += r } }
    // floating_arc.lua:往下探 ray px,有地面就把 vy 拉向 (dy − targetY)×60(限 ±maxVy),再和原 vy 各一半;vx ×0.98
    if (b.float) {
      const sim = this.sim; let hit = -1
      for (let k = 1; k <= b.float.ray; k++) { const m = sim.get(Math.floor(p.x), Math.floor(p.y + k)); if (m > 0 && sim.kind[m] !== K_GAS && sim.kind[m] !== K_FIRE) { hit = k; break } }
      if (hit > 0) { let vy = (hit - b.float.targetY) * 60; vy = Math.max(-b.float.maxVy, Math.min(b.float.maxVy, vy)); p.vy = (vy + p.vy) * 0.5; p.vx *= Math.pow(0.98, f60) }
    }
    // avoiding_arc.lua:每 3 帧四向探 ray px,碰到就按 (ray² − d²)×strength 推开
    if (b.avoid) {
      p.avoidT = (p.avoidT || 0) + f60
      if (p.avoidT >= b.avoid.every) {
        p.avoidT -= b.avoid.every
        const sim = this.sim, R = b.avoid.ray
        for (const [dx, dy] of [[1, 0], [0, -1], [-1, 0], [0, 1]]) {
          for (let k = 1; k <= R; k++) { const m = sim.get(Math.floor(p.x + dx * k), Math.floor(p.y + dy * k)); if (m > 0 && sim.kind[m] !== K_GAS && sim.kind[m] !== K_FIRE) { const push = (R * R - k * k) * b.avoid.strength; p.vx -= push * dx; p.vy -= push * dy; break } }
        }
      }
    }
    // AreaDamageComponent:每帧给 r 内的敌人 perFrame 伤害
    if (b.areaDamage) this.hooks.areaDamage?.(p.x, p.y, b.areaDamage.r, b.areaDamage.perFrame * f60, p)
  }

  /**
   * 射一道电(shoot_projectile misc/electricity.xml):ElectricityComponent 实体没有碰撞,从起点朝方向飞一帧的路程(speed/60 ≈ 83px),
   * 路上第一个导电格就是电流的入口;没碰到导电格就白射。
   */
  _shootElectricity(p, EL) {
    const sim = this.sim, C = this.conductive
    const a = Math.random() * Math.PI * 2, cx = Math.cos(a), sy = Math.sin(a)
    let x = p.x + (Math.random() * 2 - 1) * EL.spread, y = p.y + (Math.random() * 2 - 1) * EL.spread
    const len = Math.ceil(EL.shotSpeed / 60)
    for (let i = 0; i < len; i++) {
      const m = sim.get(Math.floor(x), Math.floor(y))
      if (m < 0) return
      if (m > 0 && C[m]) { this.zap(Math.floor(x), Math.floor(y), cx, sy, EL, p.owner); return }
      x += cx; y += sy
    }
  }

  /** 电流入口:从导电格 (x,y) 开始一条电流,energy 步、每帧 speed 步 */
  zap(x, y, dx, dy, EL = { energy: 1000, speed: 32, heat: 0 }, owner = 'player') {
    if (this.zaps.length > 24) return null
    const z = { x, y, dx, dy, energy: EL.energy, speed: EL.speed, heat: EL.heat, owner }
    this.zaps.push(z)
    this.hooks.sfx?.('electric', { vol: 0.3, rate: 1.0 + Math.random() * 0.3, minGap: 120 })
    return z
  }

  /**
   * ElectricityComponent(引擎内置,文档默认 energy 1000 / speed 32):电流每帧在导电材质里顺着惯性方向窜 speed 格,走一格耗 1 energy,
   * 走出导电材质就断;走过的格亮 0.15s(渲染成闪的亮蓝),活物碰到亮着的格就被电(交给 hooks.shock);probability_to_heat 每帧按概率把头上那格烧热(水 → 蒸汽)
   */
  _stepZaps(dt) {
    if (!this.zaps.length && !this.elec.size) return
    const sim = this.sim, C = this.conductive, now = this.time
    const touched = (this.elecNew ||= []); touched.length = 0
    for (let i = this.zaps.length - 1; i >= 0; i--) {
      const z = this.zaps[i]
      // 反 exe ElectricitySystem::Update:每步最多试 16 次 —— 在 mAvgDir 两侧 ±135°(rand × 3π/2 − 3π/4)随机取角,步长 2px(方向 × 2 取整),
      // 目标格必须非空、导电,且 10 帧内没被电过(避免原地打转);16 次都不行电流就断
      let n = Math.max(1, Math.round(z.speed * dt * 60)), alive = true
      while (n-- > 0 && z.energy > 0) {
        let nx = 0, ny = 0, ok = false
        for (let t = 0; t < 16; t++) {
          const a = Math.random() * (Math.PI * 1.5) - Math.PI * 0.75, ca = Math.cos(a), sa = Math.sin(a)
          const sx = Math.trunc((z.dx * ca - z.dy * sa) * 2), sy = Math.trunc((z.dx * sa + z.dy * ca) * 2)
          if (!sx && !sy) continue
          nx = z.x + sx; ny = z.y + sy
          const m = sim.get(nx, ny)
          if (m <= 0 || !C[m]) continue
          if (this.elec.has(ckey(nx, ny))) continue // 亮着 = 0.15s(9 帧)内电过
          ok = true; break
        }
        // 16 次都撞空(浅水坑 2px 一跳容易跳出水面 / 周围都亮着):退回 1px 邻格 —— 先挑没亮的导电格,再挑任何导电格;一个导电邻格都没有才断(电流留在水坑里持续闪)
        if (!ok) for (let pass = 0; pass < 2 && !ok; pass++) for (let k = 0; k < 8 && !ok; k++) { const tx = z.x + DX8[k], ty = z.y + DY8[k], m = sim.get(tx, ty); if (m > 0 && C[m] && (pass === 1 || !this.elec.has(ckey(tx, ty)))) { nx = tx; ny = ty; ok = true } }
        if (!ok) { alive = false; break }
        const sx = nx - z.x, sy = ny - z.y, sl = Math.hypot(sx, sy) || 1
        z.x = nx; z.y = ny; z.energy--
        const ndx = z.dx * 0.7 + (sx / sl) * 0.3, ndy = z.dy * 0.7 + (sy / sl) * 0.3, nl = Math.hypot(ndx, ndy) || 1
        z.dx = ndx / nl; z.dy = ndy / nl
        this.elec.set(ckey(z.x, z.y), now + 0.15); touched.push(z.x, z.y)
      }
      if (alive && z.heat && Math.random() < z.heat) { const m = sim.get(z.x, z.y), to = m > 0 ? this.warmTo[m] : 0; if (to) sim.set(z.x, z.y, to, 0) }
      if (!alive || z.energy <= 0) this.zaps.splice(i, 1)
    }
    for (const [k, t] of this.elec) if (t <= now) this.elec.delete(k)
    if (touched.length) this.hooks.shock?.(touched)
  }

  /**
   * MagicConvertMaterialComponent:从中心一圈圈往外扫(每帧 steps_per_frame 圈,1 圈 = 1px 环),扫到的格做 from→to / 任意→to / 灭火 / 点燃;
   * 扫到 radius 就完(loop=0:触摸系 4 帧扫完 20~30px、静止之环 15 帧冻完 72px)或从头再来(loop=1:冰球 / 火球一路飞一路转)。
   * 之前是每帧随机抽 steps×60 个点 —— 72px 的圈 1.6 万格只抽 300 个,静止之环基本冻不住水。
   */
  _convert(p, c, ci, dt) {
    const st = p.conv[ci]
    if (st.done) return
    if (!st.map && !st.init) {
      const mats = this.mats
      st.init = true
      if (c.fromArray && c.toArray) { st.map = new Map(); c.fromArray.forEach((f, i) => { const a = mats.byName.get(f), b = mats.byName.get(c.toArray[i] || c.toArray[c.toArray.length - 1]); if (a !== undefined && b !== undefined) st.map.set(a, b) }) }
      else if (c.from && c.to) { const a = mats.byName.get(c.from), b = mats.byName.get(c.to); if (a !== undefined && b !== undefined) st.map = new Map([[a, b]]) }
      st.toAny = c.fromAny && c.to ? mats.byName.get(c.to) : undefined
    }
    let rings = Math.max(1, Math.round(c.steps * dt * 60))
    while (rings-- > 0) {
      if (st.r > c.radius) { if (c.loop) st.r = 0; else { st.done = true; return } }
      this._convertRing(p, c, st, st.r)
      st.r++
    }
  }

  _convertRing(p, c, st, r) {
    const sim = this.sim, map = st.map, toAny = st.toAny
    const n = r === 0 ? 1 : Math.ceil(Math.PI * 2 * r * 1.5)
    let lx = NaN, ly = NaN
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const x = Math.round(p.x + Math.cos(a) * r), y = Math.round(p.y + Math.sin(a) * r)
      if (x === lx && y === ly) continue
      lx = x; ly = y
      const m = sim.get(x, y)
      if (m < 0) continue
      const k = sim.kind[m]
      if (c.extinguish && k === K_FIRE) { sim.set(x, y, 0); continue }
      if (c.ignite && m > 0 && this.burnable[m] && sim.aux(x, y) === 0 && Math.random() < c.ignite / 100) { sim.set(x, y, m, 1); continue }
      if (map && map.has(m)) { sim.set(x, y, map.get(m), 0); continue }
      if (toAny !== undefined && m > 0 && k !== K_FIRE) sim.set(x, y, toAny, 0)
    }
  }

  /**
   * BlackHoleComponent 的"崩":每帧在圈内随机抽若干点,抽到的格子(气 / 火 / [indestructible] 除外)从世界里拿掉、变成一颗飞行像素(bhParts),
   * 被 attractor 拉着往中心掉 —— 有横向初速的就绕着转几圈再进去,到中心 3px 内湮灭。抽样数 40 + R:小圈时几乎抽一遍就空,r64 时 500 帧能清掉九成。
   */
  _bhCrumble(p, dt) {
    // 反 noita_dev.exe BlackHoleSystem::Update(component_updators/blackhole_system.cpp):
    //   最多试 100 次:随机角 → 从中心射到 radius(BlackHoleSystem_Raytrace),第一条打到格子的射线吃掉命中格;
    //   再以命中点为基准沿垂直方向偏移 ±1..8 px 各射一条(目标点 = 命中点 ± k·perp,再归一化到 radius)→ 一帧最多 17 格,一条"扇面"
    //   吃掉的格子 CreateParticle(原材质):速度 = 径向方向旋转 π/2 × attractor × 4(切向甩出),再叠 ±10 随机 → 被吸引器拉回来就绕圈
    let frames = (p.bhAcc = (p.bhAcc || 0) + dt * 60)
    while (frames >= 1) {
      frames--; p.bhAcc--
      let hit = null, hx = 0, hy = 0
      for (let t = 0; t < 100 && !hit; t++) {
        const a = Math.random() * Math.PI * 2
        hit = this._bhRay(p, Math.cos(a), Math.sin(a))
        if (hit) { hx = hit[0]; hy = hit[1]; this._bhEatCell(p, hx, hy) }
      }
      if (!hit) continue
      const dx = hx + 0.5 - p.x, dy = hy + 0.5 - p.y
      const px = Math.abs(dx) > Math.abs(dy) ? 0 : 1, py = 1 - px // 垂直偏移方向:|dx|>|dy| 时沿 y 偏,否则沿 x
      for (let k = 1; k <= 8; k++) for (const s of [1, -1]) {
        const tx = hx + 0.5 + px * k * s - p.x, ty = hy + 0.5 + py * k * s - p.y, l = Math.hypot(tx, ty) || 1
        const h = this._bhRay(p, tx / l, ty / l)
        if (h) this._bhEatCell(p, h[0], h[1])
      }
    }
  }

  /** 从洞心沿 (cx,cy) 走到 radius,返回第一个非空格 [x,y];没打到返回 null */
  _bhRay(p, cx, cy) {
    const sim = this.sim, R = p.bhR
    let lx = NaN, ly = NaN
    for (let t = 1; t <= R; t++) {
      const x = Math.floor(p.x + cx * t), y = Math.floor(p.y + cy * t)
      if (x === lx && y === ly) continue
      lx = x; ly = y
      const m = sim.get(x, y)
      if (m < 0) return null
      if (m > 0) return [x, y]
    }
    return null
  }

  _bhEatCell(p, x, y) {
    const sim = this.sim, m = sim.get(x, y)
    if (m <= 0) return
    const indId = this._indestructible ||= (() => { const s = new Uint8Array(this.mats.list.length); for (const mm of this.mats.list) if (/\[indestructible\]/.test(mm.tags || '')) s[mm.id] = 1; return s })()
    if (indId[m]) return
    const k = sim.kind[m]
    sim.set(x, y, 0)
    if (k === K_GAS || k === K_FIRE || this.bhParts.length >= 4000) return
    const dx = x + 0.5 - p.x, dy = y + 0.5 - p.y, d = Math.hypot(dx, dy) || 1
    const sp = p.bhAttr * 4 // 4 × attractor_force(exe 常量 4.0)
    // 旋转 π/2:(dx,dy) → (−dy, dx),切向
    this.bhParts.push({ x: x + 0.5, y: y + 0.5, vx: (-dy / d) * sp + (Math.random() * 20 - 10), vy: (dx / d) * sp + (Math.random() * 20 - 10), col: this.mats.color[m], p })
  }

  /**
   * 黑洞飞行像素(engine particle + 粒子吸引器:范围 radius × 3,力 attractor × 0.025):切向出生、被拉回洞心 → 绕圈收进去。
   * 吸引器的加速度单位反不出来,按"切向速度 4×attr 时轨道半径 ≈ 洞半径的 1/3"取 12 × attr px/s²,再配轻阻尼让轨道慢慢收;到中心 3px 内消失
   */
  _stepBhParts(dt) {
    const f60 = dt * 60, damp = Math.pow(0.988, f60)
    for (let i = this.bhParts.length - 1; i >= 0; i--) {
      const q = this.bhParts[i], p = q.p
      if (p.dead || p.age > 30) { this.bhParts.splice(i, 1); continue }
      const dx = p.x - q.x, dy = p.y - q.y, dist = Math.hypot(dx, dy)
      if (dist < 3 || dist > p.bhR * 3) { this.bhParts.splice(i, 1); continue }
      const a = p.bhAttr * 12 * dt
      q.vx = (q.vx + (dx / dist) * a) * damp; q.vy = (q.vy + (dy / dist) * a) * damp
      q.x += q.vx * dt; q.y += q.vy * dt
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
      if (Math.random() < (ce.quiet ? 0.01 : 0.15)) this.hooks.debris?.(x + 0.5, y + 0.5, (Math.random() - 0.5) * 60, -Math.random() * 60, m, this.mats.color[m])
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
      for (let j = 0; j < n && this.sfx.length < this.maxSfx; j++) {
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
        } else if (p.bhR !== undefined) {
          // black_hole_big.lua 每 3 帧把发射器的 x/y_pos_offset 改成 ±radius:流光在整个圈里随机出生
          x = p.x + (Math.random() * 2 - 1) * p.bhR; y = p.y + (Math.random() * 2 - 1) * p.bhR
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
        this.fx.push({ x, y, vx, vy, life, max: life, col, g: e.g, fade: e.fade, air: e.airflow, long: e.long, att: e.attractor || 0, ax: p.x, ay: p.y })
      }
    }
    p.lastX = p.x; p.lastY = p.y
  }

  _die(p, byHit) {
    const d = p.d
    p.dead = true
    const x = Math.floor(p.x), y = Math.floor(p.y)
    // 触发载荷:撞墙 / 到时 / 死亡 → 在撞点(往回退 2px 别生在墙里)沿原飞行方向放出载荷里的弹(载荷自己也可以再带载荷)
    if (p.payload) {
      const pl = p.payload; p.payload = null
      const sp = Math.hypot(p.vx, p.vy), dir = sp > 1 ? Math.atan2(p.vy, p.vx) : p.rot
      const bx = byHit ? p.x - Math.cos(dir) * 2 : p.x, by = byHit ? p.y - Math.sin(dir) * 2 : p.y
      for (const s of pl) this.spawn(s.name, bx, by, dir, { owner: p.owner, c: s.c || null, speedMul: s.speedMul || 1, payload: s.payload, dmgAdd: s.dmgAdd || 0 })
    }
    // TeleportProjectileComponent:弹死在哪,射手就传到哪(离墙 min_distance_from_wall,y 速度归零)
    if (d.teleport && p.owner === 'player') this.hooks.teleport?.(p.x - (byHit ? Math.cos(p.rot) * d.teleport.minWall : 0), p.y - (byHit ? Math.sin(p.rot) * d.teleport.minWall : 0), d.teleport)
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
    let ex = d.explosion
    // c.explosion_radius / damage_explosion(_add):加到 config_explosion 上(高爆 +64 半径 +3.2 伤害;没有爆炸配置的弹加了半径也会炸)
    if ((p.exR || p.exD) && (ex || p.exR > 0)) ex = { ...(ex || { radius: 0, damage: 0, shake: 0, hole: true, holeLiquid: false, rayEnergy: 0, maxDurability: 0, sprite: null, sparks: null, matSparks: null, light: null, createCell: null, power: [0, 0.2], knockback: 1 }), radius: Math.max(0, (ex?.radius || 0) + p.exR), damage: (ex?.damage || 0) + p.exD }
    // explosion_tiny.lua(聚爆卡的附加实体):不管加减多少,半径直接设成 5
    if (p.beh?.explosionRadiusSet !== undefined && ex) ex = { ...ex, radius: p.beh.explosionRadiusSet }
    if (!ex || !(byHit ? d.deathExplode : d.lifetimeExplode) && !(p.exR > 0)) return
    // 大爆炸限额:半径 ≥ 20 的每帧最多 EXPLODE_BIG_PER_FRAME 个,多的排到下一帧 —— 自由模式无限法力连开陨石(r45,360 条射线 × 45 步 + 8000 格坑 + 100% 生火)一秒 28 发,
    // 手机上一帧几十毫秒、物理再补 3 步就滚雪球到"暂停";延后一两帧看不出来
    const lg = d.looseGround || null, exFx = p.ragdollFx || p.d.ragdollFx || 0 // 火箭类 c.ragdoll_fx=2:被爆炸炸死的尸体 BLOOD_EXPLOSION 散块
    if (ex.radius >= 20 && this._exBig >= EXPLODE_BIG_PER_FRAME) { this._exQueue.push({ x: p.x, y: p.y, ex, back: Math.atan2(-p.vy, -p.vx), lg, exFx }); return }
    this._runExplode(p.x, p.y, ex, Math.atan2(-p.vy, -p.vx), lg, exFx)
  }
  _runExplode(x, y, ex, back, lg, exFx) {
    if (ex.radius >= 20) this._exBig++
    this._lg = lg; this._exFx = exFx
    this.explode(x, y, ex, back)
    this._lg = null; this._exFx = 0
  }
  /** 每帧开头:大爆炸限额归零,把上一帧排队的先放(仍受限额) */
  _flushExplosions() {
    this._exBig = 0
    while (this._exQueue.length && this._exBig < EXPLODE_BIG_PER_FRAME) { const q = this._exQueue.shift(); this._runExplode(q.x, q.y, q.ex, q.back, q.lg, q.exFx) }
  }

  /**
   * LooseGroundComponent(文档:"shoots a ray in random direction and does the loosening"):试 tries 次,每次按 prob 从 (x,y) 绕上方向 ±max_angle 射一条 max_distance 长的射线,
   * 碰到的第一块静态地面上 minR~maxR 的一圈变成同类的松散材质(会掉)。静态 → 松散:sand_static→sand / soil→soil / coal→coal / gold→gold / snow,ice→snow / *wood*→wood / 其他→rock_loose
   */
  _loosen(x, y, lg, tries) {
    const sim = this.sim, mats = this.mats
    const loose = (m) => { const n = mats.name(m); const t = /^sand_static/.test(n) ? 'sand' : /^soil/.test(n) ? 'soil' : /^coal/.test(n) ? 'coal' : /^gold/.test(n) ? 'gold' : /^snow|^ice/.test(n) ? 'snow' : /wood/.test(n) ? 'wood' : 'rock_loose'; return mats.byName.get(t) }
    let n = 0
    for (let k = 0; k < tries; k++) {
      if (Math.random() > lg.prob) continue
      const a = -Math.PI / 2 + (Math.random() * 2 - 1) * lg.maxAngle, ca = Math.cos(a), sa = Math.sin(a)
      let cx = NaN, cy = NaN
      for (let t = 1; t <= lg.maxDist; t++) {
        const m = sim.get(Math.floor(x + ca * t), Math.floor(y + sa * t))
        if (m < 0) break
        if (m > 0 && sim.kind[m] === K_STATIC) { cx = x + ca * t; cy = y + sa * t; break }
      }
      if (Number.isNaN(cx)) continue
      const rr = lg.minR + Math.random() * (lg.maxR - lg.minR)
      for (let yy = Math.floor(cy - rr); yy <= Math.ceil(cy + rr); yy++) for (let xx = Math.floor(cx - rr); xx <= Math.ceil(cx + rr); xx++) {
        if ((xx - cx) ** 2 + (yy - cy) ** 2 > rr * rr) continue
        const m = sim.get(xx, yy)
        if (!(m > 0 && sim.kind[m] === K_STATIC)) continue
        if (lg.particles) {
          // 松脱成"真粒子"(原版 loosening 出来的是同材质的飞行像素,落地又变回那个材质的格子 —— 崩塌的圣山地上堆的是砖色的渣):抠掉 → 碎屑,落地沉积回世界
          sim.set(xx, yy, 0, 0); n++
          this.hooks.debris?.(xx, yy, (Math.random() - 0.5) * 30, -10 - Math.random() * 30, m, mats.color[m], true)
        } else { const l = loose(m); if (l !== undefined) { sim.set(xx, yy, l, 0); n++ } }
      }
      if (lg.onHit) lg.onHit(cx, cy)
    }
    return n
  }

  /** config_explosion 落地 */
  /**
   * 反 noita_dev.exe ExplosionFactory::IMPL_DoExplosion(gameplay_utils/explosion_factory.cpp):
   *   CastRays:360 条射线(1°/条)从中心走 1px 步到 radius,碰到的每个实心 / 液体格扣掉材质 hp(min(energy, hp)),energy 耗尽或撞上 durability > max_durability_to_destroy 就停,
   *     记下每条射线的到达距离²;所以火球(ray_energy 5 万)挖不动岩石(hp 10 万),炸弹(600 万)能穿 60 格岩石但被钢(durability 12)挡住
   *   格子循环:半径内、且离中心距离² ≤ 自己角度那条射线到达距离² 的格子才被摧毁;液体默认(hole_destroy_liquid=0)是被抛飞不是留着;坑内空格按 create_cell_probability% 各自掷骰生成 create_cell_material
   *   DamageMortals:见 hooks.explosion —— 满额伤害、无距离衰减,但要求 hitbox 能被射线够到(墙挡住就没伤害)
   */
  explode(x, y, ex, back = -Math.PI / 2) {
    const sim = this.sim, mats = this.mats
    const r = Math.max(0, ex.radius || 0) // 修饰卡减出来的负半径:不挖不伤,只剩闪光 / 声音(负数会让 createRadialGradient 抛错把整个渲染循环卡死)
    const maxDur = ex.maxDurability || 10
    let dug = 0
    // CastRays
    const reach2 = this._reach2 ||= new Float32Array(360)
    const energy0 = ex.rayEnergy || 20000
    const hp = this.matHp ||= (() => { const a = new Float32Array(mats.list.length); for (const m of mats.list) a[m.id] = m.hp || 0; return a })()
    for (let i = 0; i < 360; i++) {
      const a = (i / 360) * Math.PI * 2, cx = Math.cos(a), sy = Math.sin(a)
      let energy = energy0, t = 0, lx = NaN, ly = NaN, stop = false
      for (t = 1; t <= r && !stop; t++) {
        const xx = Math.floor(x + cx * t), yy = Math.floor(y + sy * t)
        if (xx === lx && yy === ly) continue
        lx = xx; ly = yy
        const m = sim.get(xx, yy)
        if (m <= 0) continue
        const k = sim.kind[m]
        if (k === K_GAS || k === K_FIRE) continue
        if (this.durability[m] > maxDur) { t--; stop = true; break } // 挡住:这格不算
        const take = Math.min(energy, hp[m])
        energy -= take
        if (energy <= 0) { if (take < hp[m]) t--; stop = true; break } // 没吃完这格的 hp 就停在它前面
      }
      reach2[i] = Math.min(t, r) ** 2
    }
    const angIdx = (dx, dy) => { let d = Math.round(Math.atan2(dy, dx) * 180 / Math.PI); d %= 360; if (d < 0) d += 360; return d }
    // config_explosion.damage 打到范围内的实体(damage_mortals):把射线表交给实体层做遮挡判定
    if (ex.damage > 0 && r > 0) this.hooks.explosion?.(x, y, r, ex.damage, reach2, ex.power, ex.knockback, this._exFx || 0)
    const ms = ex.matSparks ? ex.matSparks[0] + Math.random() * (ex.matSparks[1] - ex.matSparks[0]) : 0
    const ccId = ex.createCell?.mat ? mats.byName.get(ex.createCell.mat) : undefined
    if (ex.hole && r > 0) {
      for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
        const dx = xx + 0.5 - x, dy = yy + 0.5 - y, d2 = dx * dx + dy * dy
        if (d2 > r * r) continue
        if (d2 > reach2[angIdx(dx, dy)]) continue
        const m = sim.get(xx, yy)
        if (m < 0) continue
        if (m === 0) {
          // 坑内空格:create_cell_probability% 生成 create_cell_material(火球 → 火)
          if (ccId !== undefined && Math.random() * 100 < ex.createCell.p) sim.set(xx, yy, ccId, sim.kind[ccId] === K_FIRE ? 10 + ((Math.random() * 14) | 0) : 0)
          continue
        }
        const k = sim.kind[m]
        if (k === K_GAS || k === K_FIRE) continue
        if (this.durability[m] > maxDur) continue
        sim.set(xx, yy, 0)
        dug++
        // 液体:抛飞(落回来还是液体);material_sparks:真材质碎屑沿反射向喷回
        if (k === K_LIQUID) {
          // 反 exe IMPL_DoExplosion 0x687d7a:CreateParticle 速度 = (格子相对爆心的偏移) × 0.1 × (1 + Random(−0.35, 0.35)) px/帧(×60 换 px/s)——
          // 火花弹 r2 的爆炸只把水挪 ~12 px/s(几乎看不出),炸弹 r60 边上的水 ~360 px/s 才是大浪;之前一律 60~180 px/s 往上喷,子弹一死水里就一团水花
          if (!ex.destroyLiquid) { const jx = 1 + (Math.random() - 0.5) * 0.7, jy = 1 + (Math.random() - 0.5) * 0.7; this.hooks.debris?.(xx + 0.5, yy + 0.5, dx * 0.1 * jx * 60, dy * 0.1 * jy * 60, m, mats.color[m]) }
        } else if (ms > 0 && Math.random() < Math.min(0.6, ms / Math.max(4, r * r))) {
          const a2 = back + (Math.random() - 0.5) * 1.6, s = 50 + Math.random() * 120
          this.hooks.debris?.(xx + 0.5, yy + 0.5, Math.cos(a2) * s, Math.sin(a2) * s - 30, m, mats.color[m])
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
    if (this._lg) { this._loosen(x, y, this._lg, 24); this.hooks.shake?.(0.25) }
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

  /**
   * 化妆粒子(1px)直接写进叠层 ImageData(alpha-over),代替一格一个 fillRect —— 上限 2500 个,手机上每个带 fillStyle / globalAlpha 的 fillRect 都是一次独立提交。
   * 调用方在 putImageData 之前调;调了这个 render() 里就不再画 fx
   */
  blitFx(d, ox, oy, VW, VH) {
    this.fxBlitted = true
    for (const f of this.fx) {
      if (f.att) continue // 被吸的流光压在黑洞的雾和环上面画(render 里)
      const al = f.fade ? Math.max(0, Math.min(1, f.life / f.max)) : 1
      if (al <= 0) continue
      const r = (f.col >> 16) & 255, g = (f.col >> 8) & 255, b = f.col & 255
      let n = 0, nx = 0, ny = 0
      if (f.long) { const sp = Math.hypot(f.vx, f.vy) || 1; n = Math.min(6, sp / 60); nx = f.vx / sp; ny = f.vy / sp }
      for (let k = 0; k <= n; k++) {
        const i = Math.round(f.x - ox - nx * k), j = Math.round(f.y - oy - ny * k)
        if (i < 0 || j < 0 || i >= VW || j >= VH) continue
        const o = (j * VW + i) * 4, a0 = d[o + 3] / 255, outA = al + a0 * (1 - al)
        if (outA <= 0) continue
        const w0 = a0 * (1 - al)
        d[o] = (r * al + d[o] * w0) / outA; d[o + 1] = (g * al + d[o + 1] * w0) / outA; d[o + 2] = (b * al + d[o + 2] * w0) / outA; d[o + 3] = outA * 255
      }
    }
  }

  /** 画:精灵(朝速度方向,additive)、化妆粒子、爆炸帧 */
  render(ctx, ox, oy) {
    ctx.imageSmoothingEnabled = false
    const VW = ctx.canvas.width, VH = ctx.canvas.height
    if (!this.fxBlitted) {
      for (const f of this.fx) {
        const a = f.fade ? Math.max(0, f.life / f.max) : 1
        ctx.globalAlpha = a
        ctx.fillStyle = `rgb(${(f.col >> 16) & 255},${(f.col >> 8) & 255},${f.col & 255})`
        if (f.att) continue // 被吸的流光压在黑洞的雾和环上面画(见下)
        if (f.long) { // draw_as_long:按速度拉成一小段
          const l = Math.min(6, Math.hypot(f.vx, f.vy) / 60)
          const nx = f.vx / (Math.hypot(f.vx, f.vy) || 1), ny = f.vy / (Math.hypot(f.vx, f.vy) || 1)
          for (let k = 0; k <= l; k++) ctx.fillRect(Math.round(f.x - ox - nx * k), Math.round(f.y - oy - ny * k), 1, 1)
        } else ctx.fillRect(Math.round(f.x - ox), Math.round(f.y - oy), 1, 1)
      }
      ctx.globalAlpha = 1
    }
    this.fxBlitted = false
    // 贴图粒子(烟团/光斑):按 color 染色 + alpha,帧按寿命推进;屏幕外的不画(拉帕往上打的弹带的烟大半在屏外,每张都是 save/rotate/scale/drawImage 一次提交)
    this.drawn = 0
    for (const s of this.sfx) {
      const spr = s.spr, fw = spr.fw || s.img.width, fh = spr.fh || s.img.height
      const m = Math.max(fw * Math.abs(s.sx), fh * Math.abs(s.sy)) + 2
      if (s.x - ox < -m || s.x - ox > VW + m || s.y - oy < -m || s.y - oy > VH + m) continue
      this.drawn++
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
    const drawSprite = (d, x, y, rot, frame, speed = 0, anim = null) => {
      if (x < -96 || x > VW + 96 || y < -96 || y > VH + 96) return // 屏外的弹不画(激光 / 拉帕一屏几十上百发,大半飞在屏外);96 给最长的拉伸精灵
      this.drawn++
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
      if (!img?.image) { if (!d.areaEffect) { ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2) } return } // 场类没精灵(雷霆之环 image_file="")就什么都不画,别在圈心留个白点
      const a = anim || s // 当前动画(next_animation 切过去之后帧行不同)
      const fw = a.fw || img.width, fh = a.fh || img.height
      ctx.save()
      ctx.globalCompositeOperation = d.additive || d.emissive ? 'lighter' : 'source-over'
      ctx.globalAlpha = d.spriteAlpha ?? 1
      ctx.translate(Math.round(x), Math.round(y))
      ctx.rotate(rot)
      // velocity_sets_scale(组件文档:"the sprite width is made equal to the distance traveled since last frame",coeff 放大):
      // 精灵横向拉到"一帧(1/60s)飞过的像素 / 帧宽",只拉长不压扁(rocket 85px/s 也开着这个,原版火箭没被压成 1px 的点)——
      // 快弹补出运动模糊:狙击弹 1550 → 26px/4px 拉 6.5 倍成一道长线;分裂弹 400~600 → 7~10px < 12px 帧宽 → 原大小
      if (d.velocitySetsScale && speed) ctx.scale(Math.max(1, Math.min(8, ((speed / 60) * (d.velocitySetsScaleCoeff || 1)) / fw)), 1)
      if (s.tint) ctx.drawImage(this._tint(img, { image: s.image, posX: a.posX, posY: a.posY }, frame, fw, fh, s.tint), -s.offX, -s.offY)
      else ctx.drawImage(img.image, (a.posX || 0) + frame * fw, a.posY || 0, fw, fh, -s.offX, -s.offY, fw, fh)
      ctx.restore()
    }
    for (const s of this.stuck) drawSprite(s.d, s.x - ox, s.y - oy, s.rot, s.frame)
    // 带电的格子(电流走过的液体 / 金属):亮蓝白闪;电流头带一团蓝光(electricity.xml LightComponent r60 rgb 0/40/80)
    if (this.elec.size) {
      const now = this.time
      for (const [k, t] of this.elec) {
        const xo = Math.floor(k / KMUL), x = xo - KOFF, y = k - xo * KMUL - KOFF
        const a = Math.min(1, (t - now) / 0.15)
        ctx.globalAlpha = 0.4 + 0.6 * a
        ctx.fillStyle = Math.random() < 0.35 ? '#ffffff' : '#8fd8ff'
        ctx.fillRect(x - ox, y - oy, 1, 1)
      }
      ctx.globalAlpha = 1
      ctx.save(); ctx.globalCompositeOperation = 'lighter'
      for (const z of this.zaps) {
        const x = z.x - ox, y = z.y - oy
        const g = ctx.createRadialGradient(x, y, 0, x, y, 14)
        g.addColorStop(0, 'rgba(120,200,255,0.5)'); g.addColorStop(1, 'rgba(0,40,80,0)')
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill()
      }
      ctx.restore()
    }
    // 巨大黑洞:原版 sprite 是 black_hole_big_circle(暗紫圆盘 64 帧长大,alpha 0.1 additive emissive)—— 画面上就是一圈淡淡的紫环、里面稍微发亮,
    // 洞本身不是黑的:看到的是被崩掉的地面后面的背景;真正的"黑"是中心那团正在湮灭的碎屑。这里按 wiki 演示 gif 的观感画:淡紫圆盘 + 1px 亮边
    // 本体按 wiki 尺寸对比图取色:sprite black_hole_big_circle 是一个**暗紫黑、接近不透明**的圆盘(白底上呈 rgb≈70,60,80 → 底色 (20,14,30) 约 78% 不透明),
    // 边上一圈 1px 细粉线;LightComponent(r128, 255/40/255)只是在圆盘外面给周围一点洋红光晕。黑洞是黑的,粉色只在细边 / 流光 / 光晕上
    for (const p of this.list) {
      if (p.bhR === undefined) continue
      const x = p.x - ox, y = p.y - oy, r = p.bhR
      ctx.save()
      ctx.fillStyle = 'rgba(20,14,30,0.78)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
      // 圆盘外的洋红光晕(我们的光照图是 multiply,白天彩光没效果,所以在这儿 lighter 叠一层,只在盘外)
      ctx.globalCompositeOperation = 'lighter'
      const lr = r + 64
      const g = ctx.createRadialGradient(x, y, r, x, y, lr)
      g.addColorStop(0, 'rgba(255,40,255,0.16)'); g.addColorStop(1, 'rgba(255,40,255,0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, lr, 0, Math.PI * 2); ctx.arc(x, y, r, 0, Math.PI * 2, true); ctx.fill()
      ctx.restore()
    }
    // 黑洞崩出来的飞行像素(材质原色,绕着洞心旋进去;上面的洋红光会把它们染粉)
    if (this.bhParts.length) {
      let last = -1
      for (const q of this.bhParts) {
        if (q.col !== last) { last = q.col; ctx.fillStyle = `rgb(${(q.col >> 16) & 255},${(q.col >> 8) & 255},${q.col & 255})` }
        ctx.fillRect(Math.floor(q.x - ox), Math.floor(q.y - oy), 1, 1)
      }
    }
    // 细粉边压在碎屑上面(对比图:1px,≈ rgb 225,140,235)
    for (const p of this.list) {
      if (p.bhR === undefined) continue
      const x = p.x - ox, y = p.y - oy, r = p.bhR
      ctx.save()
      ctx.strokeStyle = 'rgba(225,140,235,0.9)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    }
    // 被吸的流光(黑洞 plasma_fading_pink,材质 gfx_glow 254):原版是 2px 粗、6~14px 长、发亮的粉紫条 —— lighter 画两层:粗的洋红 + 细的亮粉芯
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'
    for (const f of this.fx) {
      if (!f.att) continue
      const a = f.fade ? Math.max(0, f.life / f.max) : 1
      const sp = Math.hypot(f.vx, f.vy) || 1, l = Math.min(14, 3 + sp / 50), nx = f.vx / sp, ny = f.vy / sp
      const x0 = f.x - ox, y0 = f.y - oy
      ctx.globalAlpha = 0.85 * a
      ctx.strokeStyle = 'rgb(255,70,230)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 - nx * l, y0 - ny * l); ctx.stroke()
      ctx.strokeStyle = 'rgb(255,170,255)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 - nx * l * 0.6, y0 - ny * l * 0.6); ctx.stroke()
    }
    ctx.restore()
    // 液体折射(post_final.frag ENABLE_REFRACTION):落在液体格里的弹,采样坐标跟着液体一起晃 → hooks.wobble 给出这一格的 (dx,dy)
    const wob = this.hooks.wobble
    for (const p of this.list) {
      if (p.bhR !== undefined) continue // 黑洞本体上面画过了
      const w = wob ? wob(p.x, p.y) : null
      drawSprite(p.d, p.x - ox + (w ? w[0] : 0), p.y - oy + (w ? w[1] : 0), p.rot, p.frame, Math.hypot(p.vx, p.vy), p.spr || null)
    }
    for (const a of this.anims) {
      if (a.x - ox < -a.fw || a.x - ox > VW + a.fw || a.y - oy < -a.fh || a.y - oy > VH + a.fh) continue
      this.drawn++
      const frame = a.loop ? Math.floor(a.t / a.wait) % a.frames : Math.min(a.frames - 1, Math.floor(a.t / a.wait))
      ctx.save()
      ctx.globalCompositeOperation = a.additive ? 'lighter' : 'source-over'
      ctx.translate(Math.round(a.x - ox), Math.round(a.y - oy))
      if (a.angle) ctx.rotate(a.angle)
      ctx.drawImage(a.img.image, (a.posX || 0) + frame * a.fw, a.posY || 0, a.fw, a.fh, -a.offX, -a.offY, a.fw, a.fh)
      ctx.restore()
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  /**
   * 贴图染色缓存:同一帧同一色只算一次。LRU(Map 插入序,命中就挪到最后)+ 画布回池复用 ——
   * 之前满 300 就整个 clear:烟 / 光斑粒子带 color_change 每帧变色,几百个粒子 × 几帧就把 300 撑爆,于是每帧全部重新 new OffscreenCanvas + 三次合成,
   * 手机上每个新画布都是一块 GPU 表面分配,这就是站着开火时"贴屏" 20~27ms 的来源
   */
  _tint(img, spr, frame, fw, fh, col) {
    const key = `${spr.image || img.src || ''}|${spr.posX || 0},${spr.posY || 0}|${frame}|${(col[0] * 15) | 0},${(col[1] * 15) | 0},${(col[2] * 15) | 0}`
    const cache = (this.tintCache ||= new Map())
    let cv = cache.get(key)
    if (cv) { cache.delete(key); cache.set(key, cv); return cv }
    const pool = (this.tintPool ||= [])
    if (cache.size >= 512) { // 淘汰最久没用的那张,画布回池
      const [k0, v0] = cache.entries().next().value
      cache.delete(k0)
      if (pool.length < 64) pool.push(v0)
    }
    const pi = pool.findIndex((p) => p.width === fw && p.height === fh)
    if (pi >= 0) { cv = pool[pi]; pool[pi] = pool[pool.length - 1]; pool.pop() }
    else cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(fw, fh) : Object.assign(document.createElement('canvas'), { width: fw, height: fh })
    const c = cv.getContext('2d')
    c.globalCompositeOperation = 'source-over'
    c.clearRect(0, 0, fw, fh)
    c.drawImage(img.image, (spr.posX || 0) + frame * fw, spr.posY || 0, fw, fh, 0, 0, fw, fh)
    c.globalCompositeOperation = 'multiply'
    c.fillStyle = `rgb(${(col[0] * 255) | 0},${(col[1] * 255) | 0},${(col[2] * 255) | 0})`
    c.fillRect(0, 0, fw, fh)
    c.globalCompositeOperation = 'destination-in'
    c.drawImage(img.image, (spr.posX || 0) + frame * fw, spr.posY || 0, fw, fh, 0, 0, fw, fh)
    cache.set(key, cv)
    this.tintNew = (this.tintNew || 0) + 1 // 累计新染了几张(上报里 tn = 每秒增量;正常应是个位数)
    return cv
  }

  /** 光源:cb(x, y, radius, 'r,g,b', alpha) */
  lights(cb, ox, oy) {
    for (const p of this.list) if (p.d.light) cb(p.x - ox, p.y - oy, p.d.light.radius, `${p.d.light.r},${p.d.light.g},${p.d.light.b}`, 0.7)
    for (const f of this.flashes) cb(f.x - ox, f.y - oy, f.r, f.rgb, 0.9 * (f.life / f.max))
  }
}
