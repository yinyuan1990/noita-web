// ── Boss 行为(各 entities/animals/boss_*/*.lua 逐条移植)──
// 原版 boss 的 AI 全在 LuaComponent 里:execute_every_n_frame 的定时脚本 + coroutines.lua 的 async_loop/wait 时间线 + damage_received / death 回调。
// 这里用 JS 生成器复刻时间线:每个 boss 一个 controller,`*run(e, B)` 里 `yield 帧数` 等价于 lua 的 wait(帧数);每 N 帧一次的脚本用 `every: [[帧, fn], …]`。
// 引擎侧组件(LimbBossComponent 的移动状态 / HitboxComponent damage_multiplier / LaserEmitterComponent / PhysicsAI force_coeff)映射成实体上的字段,
// 由 Entities 的 _flyStep / hurt / render 读取:e.bossMove {mode, x, y, speed}、e.dmgMul、e.lasers、e.flySpeed。
// 数值只从 xml / lua 取(见每段注释);做不到的(存档 flag / 音乐 / 成就)略。

const TAU = Math.PI * 2
const R01 = () => Math.random()
const RI = (a, b) => a + Math.floor(Math.random() * (b - a + 1)) // lua Random(a, b) 整数闭区间
const RF = (a, b) => a + Math.random() * (b - a)

export class Bosses {
  /** @param {import('./Entities.js').Entities} E */
  constructor(E) { this.E = E }

  /** 实体生成时挂 controller(Entities._make) */
  attach(e) {
    const C = CONTROLLERS[e.d.boss]
    if (!C) return
    const s = { C, gen: null, wait: 0, timers: (C.every || []).map(([n]) => n), t: 0, vars: {} }
    e.boss = s
    // AnimalAI attack_ranged_entity_file 指到 boss 目录里的弹(boss_meat/orb_big.xml):键是 e_bossmeat_orb_big,不是 Entities 默认的 e_<文件名>
    if (e.d.ai?.attack_ranged_entity_file) { const k = this.projKey(e.d.ai.attack_ranged_entity_file); if (k) { e.rangedProj = k; e.ranged = !!e.d.ai.attack_ranged_enabled } }
    C.init?.(e, this)
  }

  /** data/entities/…/x.xml → projectiles.json 里的键(e_boss<dir>_<name> / e_<name>) */
  projKey(file) {
    const m = /animals\/(\w+?)\/(\w+)\.xml$/.exec(file) || /(?:projectiles\/(?:deck\/)?)?(\w+)\.xml$/.exec(file)
    const defs = this.E.projectiles?.defs || {}
    if (!m) return null
    const cands = m[2] ? [`e_${m[1].replace(/^boss_/, 'boss')}_${m[2]}`, `e_${m[1].replace(/^boss_/, 'boss')}_${m[2].replace(/^boss_\w+?_/, '')}`, `e_${m[1].split('_')[0]}_${m[2]}`, 'e_' + m[2]] : ['e_' + m[1], m[1]]
    return cands.find((k) => defs[k]) || null
  }

  /** 每帧(Entities.update 的感知块之后、身体模型之前) */
  step(e, dt) {
    const s = e.boss, C = s.C
    s.t += dt
    const f = dt * 60
    // execute_every_n_frame 的脚本
    if (C.every) for (let i = 0; i < C.every.length; i++) { s.timers[i] -= f; if (s.timers[i] <= 0) { s.timers[i] += C.every[i][0]; C.every[i][1](e, this) } }
    // async_loop 时间线
    if (C.run) {
      s.wait -= f
      let guard = 0
      while (s.wait <= 0 && guard++ < 32) {
        if (!s.gen) s.gen = C.run(e, this)
        const r = s.gen.next()
        if (r.done) { s.gen = null; s.wait += 1; break }
        s.wait += Math.max(1, r.value || 1)
      }
    }
    C.tick?.(e, this, dt)
    if (e.lasers) this._lasers(e, dt)
  }

  /** damage_received 回调;返回 false = 这次伤害不算,数字 = 改过的伤害 */
  hurt(e, dmg, src, proj) { return e.boss.C.hurt ? e.boss.C.hurt(e, this, dmg, src, proj) : undefined }
  died(e) { e.boss.C.death?.(e, this) }

  /**
   * LaserEmitterComponent:从实体沿 a 射到第一格挖不动的实心(max_cell_durability_to_destroy 以下的格子沿路烧掉)或 max_length;
   * 光束半径内的人每帧掉 damage_to_entities(noitaPlay 的 damagePlayer 有 0.5s 无敌帧)
   */
  _lasers(e, dt) {
    const E = this.E, pl = E.player
    for (const L of e.lasers) {
      if (!L.on) { L.len = 0; continue }
      const ca = Math.cos(L.a), sa = Math.sin(L.a), maxLen = L.maxLen ?? 240
      let len = 0
      for (; len < maxLen; len += 2) {
        const cx = Math.floor(e.x + ca * len), cy = Math.floor(e.y + sa * len), m = E.sim.get(cx, cy)
        if (m <= 0) continue
        const k = E.mats.kind[m]
        if (k !== 'static' && k !== 'solid' && k !== 'sand') continue
        const dur = E.mats.list[m]?.durability ?? 0
        if (dur > (L.maxDur ?? 0) || !(L.cellDmg ?? 1)) break
        // damage_to_cells 很大 = 挖穿;顺带把光束半径里的格子也清了
        const r = Math.max(1, Math.round((L.radius ?? 1.5) * 0.5))
        for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) { const mm = E.sim.get(cx + xx, cy + yy); if (mm > 0 && (E.mats.list[mm]?.durability ?? 0) <= (L.maxDur ?? 0)) E.sim.set(cx + xx, cy + yy, 0, 0) }
      }
      L.len = len
      if (L.dmg > 0) {
        const px = pl.x, py = pl.y - 4
        const t = Math.max(0, Math.min(len, (px - e.x) * ca + (py - e.y) * sa))
        const qx = e.x + ca * t, qy = e.y + sa * t
        if (Math.abs(px - qx) < 3 + L.radius && Math.abs(py - qy) < 8 + L.radius) E.hooks.damagePlayer?.(L.dmg, 0, 0, e)
      }
      if (R01() < 0.3) { const k = R01() * len; E.hooks.spark?.(e.x + ca * k, e.y + sa * k, (R01() - 0.5) * 20, (R01() - 0.5) * 20, L.dmg > 0 ? '#ff6060' : '#ff9090', 0.2) }
    }
  }
  render(ctx, e, ox, oy) {
    e.boss.C.render?.(ctx, e, this, ox, oy)
    if (!e.lasers) return
    for (const L of e.lasers) {
      if (!L.on || !(L.len > 0)) continue
      const x1 = e.x + Math.cos(L.a) * L.len, y1 = e.y + Math.sin(L.a) * L.len
      ctx.save(); ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = L.dmg > 0 ? 'rgba(255,60,60,0.45)' : 'rgba(255,120,120,0.3)'; ctx.lineWidth = Math.max(2, L.radius * 2); ctx.beginPath(); ctx.moveTo(e.x - ox, e.y - oy); ctx.lineTo(x1 - ox, y1 - oy); ctx.stroke()
      ctx.strokeStyle = '#ffd0d0'; ctx.lineWidth = Math.max(1, L.radius * 0.5); ctx.beginPath(); ctx.moveTo(e.x - ox, e.y - oy); ctx.lineTo(x1 - ox, y1 - oy); ctx.stroke()
      ctx.restore()
    }
  }

  // ── 工具 ──
  /** shoot_projectile(entity, file, x, y, vx, vy):按给定速度放一发(方向 = 速度方向,速度大小覆盖 xml 的 speed) */
  shoot(key, x, y, vx, vy, opts = {}) {
    const P = this.E.projectiles
    if (!P?.defs?.[key]) return null
    const p = P.spawn(key, x, y, Math.atan2(vy, vx), { owner: 'enemy', ...opts })
    if (p && (vx || vy)) { p.vx = vx; p.vy = vy; p.speed0 = Math.hypot(vx, vy); p.rot = Math.atan2(vy, vx) }
    if (p) p.shooter = opts.shooter || null
    return p
  }
  /** 玩家 hitbox 中心 */
  player() { const p = this.E.player; return { x: p.x, y: p.y - 4, vx: p.vx || 0, vy: p.vy || 0 } }
  dist(e) { const p = this.player(); return Math.hypot(p.x - e.x, p.y - e.y) }
  /** EntityGetInRadiusWithTag(x, y, r, "projectile") 里不是自己发的那些 */
  projNear(e, r) { return (this.E.projectiles?.list || []).filter((p) => !p.dead && p.shooter !== e && Math.hypot(p.x - e.x, p.y - e.y) < r) }
  killProj(p, explode = false) { this.E.projectiles?.kill(p, explode) }
  fx(x, y, n, color, spread = 40, life = 0.5) { for (let i = 0; i < n; i++) this.E.hooks.spark?.(x + (R01() - 0.5) * 8, y + (R01() - 0.5) * 8, (R01() - 0.5) * spread, (R01() - 0.5) * spread, color, life) }
  /** GameCreateParticle(material, x, y, count, vx, vy):真材质碎屑 */
  particle(mat, x, y, n, vx, vy) { const m = this.E.mats.byName.get(mat); if (!(m > 0)) return; for (let i = 0; i < n; i++) this.E.hooks.debris?.(x, y, vx + (R01() - 0.5) * 20, vy + (R01() - 0.5) * 20, m, this.E.mats.color[m]) }
  /** GamePlayAnimation(cur, next):Entities 的动画块看 bossAnim,cur 放完接 next,不自动换成走 / 站 */
  anim(e, name, next = null) { if (!e.d.sprite?.anims?.[name]) { if (next && e.d.sprite?.anims?.[next]) { this.E._setAnim(e, next, true); e.bossAnim = { name: next, next: null } } return } this.E._setAnim(e, name, true); e.bossAnim = { name, next } }
  /** LimbBossComponent state:0 MoveAroundNest 1 FollowPlayer 2 Escape 3 DontMove 4 MoveTo 5 MoveDirectlyTowardsPlayer */
  move(e, mode, x = 0, y = 0) { e.bossMove = { mode, x, y } }
  drop(name, x, y) { this.E.spawnItem?.(name, x, y) || this.E.hooks.spawnWand?.(name, x, y) }
  spell(id, x, y) { this.E.hooks.spawnSpecial?.({ entity: 'spell', action: id, x, y }) }
  perk(id, x, y) { this.E.hooks.spawnSpecial?.({ entity: 'perk_pickup', perk: id, x, y }) }
}

// ─────────────────────────────────────────────────────────────────────────────
// 各 boss
// ─────────────────────────────────────────────────────────────────────────────
export const CONTROLLERS = {}

/**
 * Kolmisilmän silmä(boss_meat):PhysicsAI 飞行体 + LimbBoss FollowPlayer;eye.lua 每 80 帧走 4 步:
 *   1 → 播 open→opened、Hitbox damage_multiplier 1、开 vacuum(BlackHole 吸尘 + vacuum.lua 吸弹 / 吸刚体)、关 shot;
 *   3 → 播 close→stand、damage_multiplier 0、关 vacuum、开 shot、朝 (0,0) 放一发 orb_big(原地炸开的大球)
 * shot.lua(vacuum_NOT 时)每 20 帧:随机角度 acidshot_slow 速度 90。vacuum.lua 每帧:128 内非刚体弹 v += 80×(1−d/128) 朝自己;刚体受力 ×0.2×质量。
 * death.lua:掉 experimental_wand_4(x, y−12)。闭眼时 damage_multiplier 0 = 打不动。
 */
CONTROLLERS.boss_meat = {
  init(e, B) { e.dmgMul = 0; e.boss.vars.status = 0; e.boss.vars.vacuum = false; B.move(e, 'follow'); e.flySpeed = (e.d.physicsAI?.force_coeff ?? 17) * 4.5 },
  every: [
    [80, (e, B) => {
      const v = e.boss.vars
      if (v.status === 1) { B.anim(e, 'open', 'opened'); e.dmgMul = 1; v.vacuum = true }
      else if (v.status === 3) { B.anim(e, 'close', 'stand'); e.dmgMul = 0; v.vacuum = false; B.shoot('e_bossmeat_orb_big', e.x, e.y, 0, 0, { shooter: e }) }
      v.status = (v.status + 1) % 4
    }],
    [20, (e, B) => {
      if (e.boss.vars.vacuum) return
      const a = TAU * (RI(0, 99) * 0.01)
      B.shoot('e_bossmeat_acidshot_slow', e.x, e.y, Math.cos(a) * 90, -Math.sin(a) * 90, { shooter: e })
    }],
  ],
  tick(e, B, dt) {
    if (!e.boss.vars.vacuum) return
    const R = 128, f = dt * 60
    for (const p of B.projNear(e, R)) {
      if (p.d.blackHole || p.d.type === 'PHYSICS') continue
      const d = Math.hypot(e.x - p.x, e.y - p.y), k = 80 * ((R - d) / R) * f
      if (d < 1) continue
      p.vx += ((e.x - p.x) / d) * k; p.vy += ((e.y - p.y) / d) * k
    }
    for (const b of B.E.bodies) {
      if (b.dead || b.isStatic) continue
      const d = Math.hypot(e.x - b.x, e.y - b.y); if (d >= R * 0.5 || d < 1) continue
      const k = 80 * ((R - d) / R) * 0.2 * dt * 6
      if (b.asleep) b.wake?.(B.E.sim)
      b.vx += ((e.x - b.x) / d) * k; b.vy += ((e.y - b.y) / d) * k; b.restT = 0; B.E.physics?.pushToPhysics(b)
    }
    // BlackHoleComponent(_tags vacuum,radius 128 attractor −3):把身边 128 内的沙 / 液体格吸过来
    if (e.d.blackHole && R01() < 0.5) { const a = R01() * TAU, r = 20 + R01() * 100, cx = Math.floor(e.x + Math.cos(a) * r), cy = Math.floor(e.y + Math.sin(a) * r), m = B.E.sim.get(cx, cy); const k = m > 0 ? B.E.mats.kind[m] : ''; if (k === 'sand' || k === 'liquid') { B.E.sim.set(cx, cy, 0, 0); B.E.hooks.debris?.(cx, cy, (e.x - cx) * 2, (e.y - cy) * 2, m, B.E.mats.color[m]) } }
  },
  death(e, B) { B.drop('experimental_wand_4', e.x, e.y - 12) },
}

/**
 * Kolmisilmän koipi? 不 —— boss_robot(Mestarien mestari 的机器人室那只):state.lua 每 40 帧 state+1:
 *   2 → 300 内有人:10 发 rocket_roll,角 π×rand、速 100~250 朝上半圆;spell_eater 关
 *   4 → spell_eater 开(spell_eater.lua 每帧:面朝人,前方 82° 内 36px 的敌弹直接吞掉不炸)
 *   6 → 三门 LaserEmitter 对准人,细线(半径 1.5、不伤人、只烧 durability ≤2 的格)
 *   8 → 激光全功率(半径 10.5、0.6 伤、挖 durability ≤14)
 *   10 → 激光关、spell_eater 开
 *   13 → healer 不足 3 个就放一只 healerdrone_physics,state 归 0
 * PROTECTION_PROJECTILE 是常驻效果(弹丸伤害 0)—— 只能靠爆炸 / 近战 / 材质打。death.lua:explosion_giga + 特权 MAP。
 */
CONTROLLERS.boss_robot = {
  init(e, B) {
    e.boss.vars.state = 0; e.boss.vars.eater = false; B.move(e, 'follow'); e.flySpeed = (e.d.physicsAI?.force_coeff ?? 10) * 4.5
    e.lasers = (e.d.lasers || []).map((L) => ({ ...L, on: false, a: L.angle, radius: 1.5, dmg: 0, maxDur: 2 }))
    e.projImmune = true // GameEffect PROTECTION_PROJECTILE
  },
  every: [[40, (e, B) => {
    const v = e.boss.vars
    v.state++
    const p = B.player()
    if (v.state === 2) {
      v.eater = false
      if (B.dist(e) < 300) for (let i = 0; i < 10; i++) { const a = Math.PI * (RI(0, 100) * 0.01), l = RI(100, 250); B.shoot('e_bossrobot_rocket_roll', e.x, e.y, Math.cos(a) * l, -Math.sin(a) * l, { shooter: e }) }
    } else if (v.state === 4) v.eater = true
    else if (v.state === 6) { v.eater = false; const a = Math.atan2(p.y - e.y, p.x - e.x); for (const L of e.lasers) { L.a = a; L.on = true; L.radius = 1.5; L.dmg = 0; L.maxDur = 2 } }
    else if (v.state === 8) { for (const L of e.lasers) { L.radius = 10.5; L.dmg = 0.6; L.maxDur = 14 } }
    else if (v.state === 10) { for (const L of e.lasers) { L.on = false; L.radius = 1.5; L.dmg = 0; L.maxDur = 2 } v.eater = true }
    else if (v.state === 13) { if (B.E.list.filter((o) => !o.dead && o.name === 'healerdrone_physics').length < 3) B.E.spawnCreature?.('healerdrone_physics', e.x, e.y); v.state = 0 }
  }]],
  tick(e, B) {
    if (!e.boss.vars.eater) return
    const p = B.player(), a = Math.atan2(p.y - e.y, p.x - e.x)
    e.face = Math.cos(a) < 0 ? -1 : 1
    for (const q of B.projNear(e, 36)) {
      const da = Math.abs(((Math.atan2(q.y - e.y, q.x - e.x) - a + Math.PI * 3) % TAU) - Math.PI)
      if (da < (82 * Math.PI) / 180) { B.killProj(q, false); B.fx(q.x, q.y, 3, '#80ffd0', 30, 0.3) }
    }
  },
  death(e, B) { const P = B.E.projectiles; if (P?.defs?.explosion_giga) P.spawn('explosion_giga', e.x, e.y, 0, { owner: 'enemy' }); B.perk('MAP', e.x, e.y) },
}

/**
 * Sauvojen tuntija(boss_pit):PhysicsAI 飞行体。boss_pit_logic.lua 每 40 帧:Hitbox damage_multiplier 每次 +0.35 回到 1;state = (state+1)%10
 *   state 1 → 放一发 wand.xml(会飞的法杖,HomingComponent coeff 30 / mult 0.16 追人),它每 20 帧朝人放 memory 里记住的弹(伤害 +0.2);
 *             memory 缺省 enlightened_laser_darkbeam;法杖弹自带 mult:火箭类 0.5 / 其他 1.2,速度 300×mult(有 homing)
 *   state 7 → 8 发环形 orb_poly / orb_neutral / orb_tele / orb_dark(随机一种),速 300,起始角 π×rand(0.1..1.0);卡住(寻路 >160 帧)时改放 remove_ground
 * boss_pit_memory.lua 每帧:64 内第一发带 projectile_file 的弹记进 memory(它会学玩家的法术)。
 * boss_pit_damage.lua:受伤 → damage_multiplier 0(无敌到下次 logic 回血 0.35),1/3 概率再放一根法杖。
 * death:WORM_RAIN / METEOR_RAIN 两张卡 + heart_fullhp + wand_unshuffle_05 / wand_level_06。
 */
CONTROLLERS.boss_pit = {
  init(e, B) { e.boss.vars.state = 0; e.boss.vars.memory = 'e_enlightened_laser_darkbeam'; e.boss.vars.stuck = 0; e.dmgMul = 1; B.move(e, 'follow'); e.flySpeed = (e.d.physicsAI?.force_coeff ?? 10) * 4.5 },
  every: [[40, (e, B) => {
    const v = e.boss.vars
    e.dmgMul = Math.min(1, (e.dmgMul ?? 1) + 0.35)
    v.state = (v.state + 1) % 10
    if (v.state === 1) CONTROLLERS.boss_pit._wand(e, B)
    else if (v.state === 7) {
      if (v.stuck > 160) { B.shoot('e_remove_ground', e.x, e.y, 0, 0, { shooter: e }); return }
      const key = ['e_orb_poly', 'e_orb_neutral', 'e_orb_tele', 'e_orb_dark'][RI(0, 3)], off = Math.PI * (RI(1, 10) * 0.1)
      for (let i = 0; i <= 7; i++) { const a = Math.PI * 0.25 * i + off; B.shoot(key, e.x, e.y, Math.cos(a) * 300, -Math.sin(a) * 300, { shooter: e }) }
    }
  }]],
  tick(e, B, dt) {
    const v = e.boss.vars
    // 卡住计数(PathFinding read_state ≤1):飞不动就累加
    v.stuck = Math.hypot(e.vx, e.vy) < 3 && e.state === 'chase' ? v.stuck + dt * 60 : 0
    for (const p of B.projNear(e, 64)) if (p.owner === 'player' && p.name && B.E.projectiles.defs[p.name]) { v.memory = p.name; break }
    // 飞着的法杖(wand.xml):每 20 帧朝人放 memory 弹
    for (const w of v.wands || []) {
      if (w.p.dead) continue
      w.t -= dt * 60
      if (w.t <= 0) {
        w.t = 20
        const P = B.player(), d = Math.atan2(P.y - w.p.y, P.x - w.p.x), l = (w.p.homing ? 300 : 500) * w.mult
        B.shoot(w.key, w.p.x, w.p.y, Math.cos(d) * l, Math.sin(d) * l, { shooter: e, dmgAdd: 0.2 })
      }
    }
    if (v.wands) v.wands = v.wands.filter((w) => !w.p.dead)
  },
  /** state 1:法杖装的是 7 种火箭 / 手雷 / 弹力球之一(tier_2/3 没抽进来的退回基础版)并带 homing;受伤放的那根装 memory 里的弹、不带 homing(速度 500) */
  _wand(e, B, fromHurt = false) {
    const v = e.boss.vars, defs = B.E.projectiles?.defs || {}
    const a = RI(1, 200) * Math.PI
    let key = v.memory, mult = 1
    if (!fromHurt) {
      const spells = ['rocket', 'rocket_tier_2', 'rocket_tier_3', 'grenade', 'grenade_tier_2', 'grenade_tier_3', 'rubber_ball']
      const pick = spells[RI(0, spells.length - 1)]
      key = defs[pick] ? pick : pick.replace(/_tier_\d$/, '')
      mult = /rocket/.test(pick) ? 0.5 : 1.2
    }
    if (!defs[key]) return
    const p = B.shoot('e_bosspit_wand', e.x, e.y, Math.cos(a) * 100, -Math.cos(a) * 100, { shooter: e })
    if (!p) return
    if (!fromHurt) p.homing = { detect: 1e9, coeff: 30, mult: 0.16, rotate: false, turn: 0.2, target: 'player_unit' }
    ;(v.wands ||= []).push({ p, key, mult, t: 20 })
  },
  hurt(e, B) {
    e.dmgMul = 0
    if (RI(1, 3) === 1) { e.boss.vars.state = (e.boss.vars.state + 1) % 10; CONTROLLERS.boss_pit._wand(e, B, true) }
  },
  death(e, B) { B.spell('WORM_RAIN', e.x - 16, e.y); B.spell('METEOR_RAIN', e.x + 16, e.y); B.drop('heart_fullhp', e.x, e.y); B.drop('wand_unshuffle_05', e.x - 24, e.y); B.drop('wand_level_06', e.x + 24, e.y) },
}

/**
 * Kolmisilmän koipi(boss_limbs,金字塔 spawn_boss_limbs_trigger):boss_limbs_update.lua 的 async_loop 时间线。
 * 三块 hitbox_default(damage_multiplier 0 的壳)+ 一块 hitbox_weak_spot(1.0):只有 expose_weak_spot 打开时才吃伤害(这里用 dmgMul 0/1)。
 *   phase0 FollowPlayer 5s → 随机;phase1 DontMove、露弱点、3 轮 circleshot(8 发 orb_boss_limbs 速 230,间隔 50)、开 240 帧、关;
 *   phase2 两只 slimeshooter_boss_limbs(上限 2,初速 x ±90 / y −150~25),间隔 30,再 100;phase3 charge 40 → force_coeff ×5 + CellEater 100% 冲 80 帧 → phase1;
 *   phase4 DontMove 露弱点、2 发 orb_pink_big(0,−30)间隔 40、开 120 帧、关 → phase0。
 * damage: 弱点开着时播 hurt→opened。death:heart(x−16)+ wand_unshuffle_04 + 4 张随机卡(NOLLA / DAMAGE_RANDOM / …)+ heart_fullhp。
 */
CONTROLLERS.boss_limbs = {
  init(e, B) { e.dmgMul = 0; e.flySpeed = (e.d.physicsAI?.force_coeff ?? 10) * 4.5; e.boss.vars.speed0 = e.flySpeed; B.move(e, 'follow') },
  *run(e, B) {
    const v = e.boss.vars
    const circleshot = function* () {
      B.anim(e, 'attack_ranged', 'opened'); yield 15
      for (let i = 0; i < 8; i++) { const a = (i * 45 * Math.PI) / 180; B.shoot('e_bosslimbs_orb', e.x, e.y, Math.cos(a) * 230, Math.sin(a) * 230, { shooter: e }) }
    }
    const expose = function* () { B.anim(e, 'open', 'opened'); yield 10; e.dmgMul = 1; yield 20 }
    const hide = function* () { B.anim(e, 'close', 'stand'); yield 10; e.dmgMul = 0; yield 30 }
    const minion = () => {
      if (B.E.list.filter((o) => !o.dead && o.name === 'slimeshooter_boss_limbs').length >= 2) return
      const s = B.E.spawnCreature?.('slimeshooter_boss_limbs', e.x, e.y)
      if (s) { s.vx = RI(-90, 90); s.vy = RI(-150, 25); s.state = 'chase'; s.stateT = 4 }
    }
    let phase = 0
    for (;;) {
      if (phase === 0) { B.move(e, 'follow'); yield 300; phase = RI(0, 4) }
      else if (phase === 1) {
        B.move(e, 'hold'); yield* expose()
        for (let k = 0; k < 3; k++) { yield* circleshot(); yield 50 }
        yield 240; yield* hide(); yield 10; phase = RI(0, 4)
      } else if (phase === 2) { B.move(e, 'follow'); minion(); yield 30; minion(); yield 100; phase = RI(0, 4) }
      else if (phase === 3) {
        B.move(e, 'follow'); B.anim(e, 'charge', 'stand'); yield 40
        e.flySpeed = v.speed0 * 5; e.eatR = e.d.cellEater?.radius || 8; yield 80
        e.flySpeed = v.speed0; e.eatR = 0; phase = 1
      } else {
        B.move(e, 'hold'); yield* expose()
        for (let k = 0; k < 2; k++) { B.anim(e, 'attack_ranged', 'opened'); yield 15; B.shoot('e_bosslimbs_orb_pink_big', e.x, e.y, 0, -30, { shooter: e }); yield 40 }
        yield 120; yield* hide(); yield 10; phase = 0
      }
    }
  },
  hurt(e, B) { if (e.dmgMul > 0) B.anim(e, 'hurt', 'opened') },
  death(e, B) {
    B.drop('heart', e.x - 16, e.y); B.drop('wand_unshuffle_04', e.x, e.y); B.drop('heart_fullhp', e.x, e.y)
    const opts = ['NOLLA', 'DAMAGE_RANDOM', 'RANDOM_SPELL', 'RANDOM_PROJECTILE', 'RANDOM_MODIFIER', 'RANDOM_STATIC_PROJECTILE', 'DRAW_RANDOM', 'DRAW_RANDOM_X3', 'DRAW_3_RANDOM']
    for (let i = 0; i < 4; i++) { const k = RI(0, opts.length - 1); B.spell(opts[k], e.x - 32 + i * 16, e.y); opts.splice(k, 1) }
    for (let i = 0; i < 40; i++) B.particle('slime_green', e.x + RI(-10, 10), e.y + RI(-10, 10), 1, 0, -20)
  },
}

/**
 * Kolmisilmä(boss_centipede,实验室(终)):boss_centipede_update.lua。orbcount = 拿到的宝珠数(这里 0):hp = 46 + 2^1.3 + 0 = 48.5(xml 56.5 被 init 覆盖),
 * 弱盾(shield_weak:60px 内的敌弹被吸进来变成自己的)。next_phase:dist < 65 → melee;< 700 → subphase 0~5 从 {chase_slow, circleshot×2, spawn_minion, firepillar×3} 掷,第 6 次 clean_materials;≥700 → chase_direct;
 * 血量 ≤ clamp(max×0.1, 9, 40) 进 aggro(只剩 phase_aggro:force ×5、12 发随机方向 circleshot_aggro 速 120、melee 爆)。
 *   circleshot:6−repeats 支、速 80、每 12 帧一轮共 10 轮(螺旋转速 25×(2r−1));firepillar:10−2×repeats 发上半圆 150、vy−200;spawn_minion 上限 3;melee = melee.xml 原地爆 + 往上 70 冲
 * 死:body_chunks + 40 帧抖屏 + 传送门(不做),掉 sampo(不做)。
 */
CONTROLLERS.boss_centipede = {
  init(e, B) {
    const orb = B.E.player.orbs || 0 // GameGetOrbCountThisRun(+ NG+ 次数,这里 0)
    e.hp = e.maxHp = 46 + Math.pow(2, orb + 1.3) + orb * 15.5
    e.boss.vars.orb = orb
    e.flySpeed = 14 * 4.5; e.boss.vars.speed0 = e.flySpeed; e.boss.vars.aggro = false; e.boss.vars.subphase = 0; e.boss.vars.repeats = 0; e.boss.vars.shield = false
    // 开打之前(boss_centipede_before_fight.lua):不动、PROTECTION_ALL(打不动),腿随机摆;sampo_pickup.lua 拿起三宝 → FINAL_BOSS_ACTIVE → 换 update.lua
    B.move(e, 'hold'); e.dmgMul = 0
    e.boss.vars.ref = { x: e.x, y: e.y }
  },
  *run(e, B) {
    const v = e.boss.vars
    while (!B.E.finalBossActive) yield 10
    e.dmgMul = 1; B.move(e, 'follow')
    const R = 60
    const setShield = (on) => { if (v.shield !== on) { v.shield = on; B.fx(e.x, e.y, 20, on ? '#ff80c0' : '#ff40a0', 120, 0.4) } }
    const openEye = function* () { if (v.eye) return; B.anim(e, 'open', 'opened'); v.eye = true; yield 55 }
    const closeEye = function* () { if (!v.eye || v.repeats > 0) return; B.anim(e, 'close', 'stand'); v.eye = false; yield 50 }
    const orb = v.orb || 0
    const circleshot = (ang, speed = 80, branches = 6 + orb - v.repeats) => { const sp = Math.floor(360 / branches); for (let i = 0; i < branches; i++) { const a = (ang * Math.PI) / 180; B.shoot('e_bosscentipede_orb_circleshot', e.x, e.y, Math.cos(a) * speed, Math.sin(a) * speed, { shooter: e }); ang += sp } }
    const moveRef = () => B.move(e, 'to', v.ref.x, v.ref.y)
    const melee = () => B.shoot('e_bosscentipede_melee', e.x, e.y, 0, 0, { shooter: e })
    let phase = null
    const next = () => {
      setShield(false)
      const dist = B.dist(e)
      if (v.aggro && v.hp0 === undefined) v.hp0 = 1
      if (dist < 65 && !v.aggro) { phase = 'melee'; v.repeats = 0 }
      else if (dist < 700) {
        if (v.repeats > 0) { v.repeats--; return }
        if (v.subphase < 6) {
          const phases = v.aggro ? [['aggro', 0]] : [['chase_slow', 0], ['circleshot', 1], ['minion', 0], ['firepillar', 2]]
          if (!v.aggro && orb >= 2) phases.push(['homing', 0])
          if (orb >= 11) phases.push(['polymorph', 0])
          const pick = phases[RI(0, phases.length - 1)]; phase = pick[0]; v.repeats = pick[1]; v.subphase++
        } else { v.subphase = 0; v.repeats = 0; phase = 'clean' }
      } else phase = 'chase_direct'
      if (dist > 1300 && !v.chase) { v.chase = true; e.eatR = 64; e.flySpeed = v.speed0 * 5; phase = 'chase_direct' }
    }
    next()
    for (;;) {
      if (!phase) { yield 10; next(); continue }
      // check_death → aggro
      if (!v.aggro && e.hp <= Math.min(40, Math.max(9, e.maxHp * 0.1))) { v.aggro = true; B.anim(e, 'aggro', 'aggro'); e.flySpeed = v.speed0 * 5; B.particle('slime_green', e.x + 20, e.y, 60, 0, -20); v.repeats = 0; next(); continue }
      switch (phase) {
        case 'chase_slow': yield* closeEye(); B.move(e, 'follow'); yield 60; break
        case 'chase_direct': yield* closeEye(); B.move(e, 'direct'); yield 160; break
        case 'circleshot': {
          moveRef(); yield 50; setShield(true); yield 10; yield* openEye()
          const r = R01(), spiral = 25 * (r * 2 - 1)
          for (let i = 1; i <= 10 + Math.floor(orb / 3); i++) { circleshot(r * 180 + i * spiral); yield 12 }
          yield* closeEye(); setShield(false); yield 60; B.move(e, 'follow'); break
        }
        case 'minion': {
          B.move(e, 'follow')
          for (let i = 0; i < 1 + Math.floor(orb / 2); i++) if (B.E.list.filter((o) => !o.dead && o.name === 'boss_centipede_minion').length < 3 + orb) { yield* openEye(); B.E.spawnCreature?.('boss_centipede_minion', e.x, e.y); B.fx(e.x, e.y, 12, '#60a0ff', 80, 0.3); yield 30 }
          yield* closeEye(); break
        }
        case 'homing': {
          yield* openEye()
          for (let i = 0; i < 4 + Math.floor(orb * 0.5); i++) { B.shoot('e_bosscentipede_orb_homing', e.x, e.y, 0, RF(-200, 50), { shooter: e }); yield 20 }
          yield* closeEye(); break
        }
        case 'polymorph': {
          yield* openEye(); yield 30
          B.shoot('e_bosscentipede_orb_polymorph', e.x, e.y - 10, 0, -50, { shooter: e }); B.shoot('e_bosscentipede_orb_polymorph', e.x - 5, e.y, -30, 20, { shooter: e }); B.shoot('e_bosscentipede_orb_polymorph', e.x - 5, e.y, -30, 20, { shooter: e })
          yield 20; yield* closeEye(); break
        }
        case 'firepillar': {
          moveRef(); yield 50; setShield(true); yield 10; yield* openEye()
          const n = 10 + orb - v.repeats * 2, sp = Math.floor(180 / n); let ang = sp * 0.5
          for (let i = 0; i < n; i++) { const a = (ang * Math.PI) / 180; B.shoot('e_bosscentipede_firepillar', e.x, e.y, Math.cos(a) * 150, Math.sin(a) * 150 - 200, { shooter: e }); ang += sp }
          yield* closeEye(); yield 40; B.move(e, 'follow'); break
        }
        case 'melee': {
          yield* openEye(); melee()
          const a = RF(-Math.PI / 2, Math.PI / 2), dx = 70 * Math.sin(a), dy = -70 * Math.cos(a)
          e.flySpeed = v.speed0 * 20; B.move(e, 'to', e.x + dx, e.y + dy); yield 50; e.flySpeed = v.aggro ? v.speed0 * 5 : v.speed0
          yield* closeEye(); break
        }
        case 'clean': B.move(e, 'follow'); yield 25; for (const p of B.projNear(e, 400)) B.killProj(p, false); break
        case 'aggro': {
          e.flySpeed = v.speed0 * 5; B.anim(e, 'aggro', 'aggro'); yield 60
          for (let i = 0; i < 12 + Math.floor(orb / 3); i++) { for (let k = 0; k < 4 + orb; k++) { const a = R01() * TAU; B.shoot('e_bosscentipede_orb_circleshot', e.x, e.y, Math.cos(a) * 120, Math.sin(a) * 120, { shooter: e }) } B.particle('slime_green', e.x, e.y, 8, 0, -20); yield 12 }
          yield 20; melee(); yield 60; B.move(e, 'follow'); break
        }
      }
      next()
    }
  },
  tick(e, B, dt) {
    // boss_centipede_shield.lua(弱盾):60 内不是自己发的弹 v += 450×(1−d/60)×0.8 朝自己,进来的第一帧起归自己(不伤 boss,打人)、寿命续 2 帧
    if (!e.boss.vars.shield) return
    const R = 60, f = dt * 60
    for (const p of B.projNear(e, R)) {
      if (p.d.type === 'STATIC') continue
      const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < 1) continue
      const conv = p.shooter === e
      const k = 450 * ((R - d) / R) * (conv ? 1 : 0.8) * f
      p.vx += ((e.x - p.x) / d) * k; p.vy += ((e.y - p.y) / d) * k
      p.life += 2 / 60
      if (!conv) { p.shooter = e; p.owner = 'enemy'; p.noHit = 0; B.fx(p.x, p.y, 2, '#ff80c0', 20, 0.3) }
    }
  },
  // check_death 的死亡段:40 帧抖屏 + 绿浆,参考点 (ref.x, ref.y+50) 出 teleport_ending_victory_delay(通往胜利室 6220,15175);FINAL_BOSS_ACTIVE 归 0
  death(e, B) { for (let i = 0; i < 40; i++) B.particle('slime_green', e.x + RI(-10, 10), e.y + RI(-10, 10), 1, 0, -20); B.E.hooks.shake?.(1); B.E.finalBossActive = false; const r = e.boss.vars.ref; B.E.hooks.spawnSpecial?.({ entity: 'teleport_ending_victory', x: r.x, y: r.y + 50 }); B.E.hooks.runFlag?.('bossCentipedeDead') },
}

/**
 * Unohdettu(boss_ghost,ghost_secret 的 ghost_spawn_check 300 内出):AnimalAI 远程 polyp(boss_ghost_polyp 自带 homing)+ PhysicsAI 飘;
 * ethereal_check.lua 每 5 帧:200 内没有带 magic_eye_check 光的 evil_eye(邪眼道具)→ DamageModel 整个关掉 = 打不到(以太化);我们没有邪眼 → 按"眼睛"动画开着时可打,退一步用 hp 门:
 *   这里照 lasers.lua:子实体四门激光随帧转(angle = frame×0.01),laser_status 每受一次伤 +1、每帧 −0.02;status>0 才发光,伤 0.08+0.01×status、长 8+8×status、半径 3+0.1×status。
 * helpers.lua 每 180 帧:boss_ghost_helper(ethereal_being)不足 2 只补一只。death:heart_fullhp + sunseed(x+16)。
 * 以太化的替代:没有邪眼时弹丸伤害 ×0.25(注:原版是完全免疫;做成能打是为了没做邪眼也能过)。
 */
CONTROLLERS.boss_ghost = {
  init(e, B) { e.boss.vars.status = 0; e.lasers = [0, 1, 2, 3].map((i) => ({ a: (i * Math.PI) / 2, on: false, radius: 3, dmg: 0.08, maxLen: 8, maxDur: 14, cellDmg: 0 })); e.flySpeed = (e.d.physicsAI?.force_coeff ?? 14) * 4.5 },
  every: [[180, (e, B) => { if (B.E.list.filter((o) => !o.dead && o.name === 'ethereal_being').length < 2) B.E.spawnCreature?.('ethereal_being', e.x, e.y) }]],
  tick(e, B, dt) {
    const v = e.boss.vars, f = dt * 60
    v.status = Math.max(0, v.status - 0.02 * f)
    const base = B.E.time * 60 * 0.01
    e.lasers.forEach((L, i) => { L.a = base + (i * Math.PI) / 2; L.on = v.status > 0; L.dmg = 0.08 + v.status * 0.01; L.maxLen = 8 + v.status * 8; L.radius = 3 + v.status * 0.1 })
  },
  hurt(e, B, dmg, src) { e.boss.vars.status += 1; if (src === 'proj' && !B.E.hasEvilEye) return dmg * 0.25 },
  death(e, B) { B.drop('heart_fullhp', e.x, e.y); B.drop('sunseed', e.x + 16, e.y) },
}

/**
 * Mestarien mestari(boss_wizard,mestari_secret):走路巫师,AnimalAI 远程;init.lua 出生放 8 颗环绕球(奇 wizard_orb_death / 偶 wizard_orb_blood,
 * orb_rotation.lua:半径 50、y−20、角 = 2π/8×id + frame×0.01);state.lua 每开一枪换下一种弹(mode 0 顺序 / mode 1 随机):
 *   1 meteor(220 帧)2 laser(170)3 summon(300)4 statusburst(190,还有球时)/ laser  0 debuff_init(240);mode 1 多一种 bloodtentacle(80)
 * wizard_nullify.lua(受伤):36 内别的弹全灭不炸;hp<50% → mode 1(摘头盔);hp<20% → mode 2(远程关、bloodtentacle 每 16 帧两发速 150)
 * death:ADD_TRIGGER / ADD_TIMER / ADD_DEATH_TRIGGER / RESET / DUPLICATE 五张卡 + book_mestari + wandstone。
 */
CONTROLLERS.boss_wizard = {
  init(e, B) {
    const v = e.boss.vars; v.state = 0; v.mode = 0
    v.orbs = []
    for (let i = 1; i <= 8; i++) { const o = B.E.spawnCreature?.(i % 2 === 0 ? 'wizard_orb_blood' : 'wizard_orb_death', e.x, e.y); if (o) { o.orbId = i - 1; o.orbOf = e; o.state = 'idle'; v.orbs.push(o) } }
    CONTROLLERS.boss_wizard._pick(e, B, 0)
  },
  _set(e, B, file, frames) { const k = B.projKey(file); if (k) { e.rangedProj = k; e.ranged = true; e.rangedGap = frames / 60 } },
  _pick(e, B, state) {
    const S = CONTROLLERS.boss_wizard._set
    const orbs = e.boss.vars.orbs.filter((o) => !o.dead).length
    if (state === 1) S(e, B, 'boss_wizard/meteor.xml', 220)
    else if (state === 2) S(e, B, 'boss_wizard/laser.xml', 170)
    else if (state === 3) S(e, B, 'boss_wizard/summon.xml', 300)
    else if (state === 4) S(e, B, orbs > 0 && e.boss.vars.mode === 0 ? 'boss_wizard/statusburst.xml' : e.boss.vars.mode === 0 ? 'boss_wizard/laser.xml' : 'boss_wizard/bloodtentacle.xml', e.boss.vars.mode === 0 ? 190 : 80)
    else S(e, B, 'boss_wizard/debuff_init.xml', 240)
  },
  /** shot 回调:Entities._shoot 后调 */
  shot(e, B) {
    const v = e.boss.vars
    if (v.mode === 0) v.state = (v.state + 1) % 5
    else if (v.mode === 1) v.state = RI(0, 4)
    else { e.ranged = false; return }
    CONTROLLERS.boss_wizard._pick(e, B, v.state)
  },
  every: [[16, (e, B) => {
    if (e.boss.vars.mode !== 2) return
    for (let i = 0; i < 2; i++) { const a = RI(0, 100) * 0.01 * TAU; B.shoot('e_bosswizard_summon', e.x, e.y - 32, Math.cos(a) * 150, -Math.sin(a) * 150, { shooter: e }) }
  }]],
  tick(e, B) {
    const v = e.boss.vars, t = B.E.time * 60 * 0.01
    for (const o of v.orbs) { if (o.dead) continue; const a = (TAU / 8) * o.orbId + t; o.x = e.x + Math.cos(a) * 50; o.y = e.y - Math.sin(a) * 50 - 20; o.vx = o.vy = 0 }
  },
  hurt(e, B, dmg, src, proj) {
    for (const p of B.projNear(e, 36)) if (p !== proj) { B.killProj(p, false); B.fx(p.x, p.y, 2, '#c0c0ff', 20, 0.25) }
    const v = e.boss.vars, r = (e.hp - dmg) / e.maxHp
    if (r < 0.5 && v.mode === 0) { v.mode = 1; B.particle('blood', e.x, e.y - 40, 30, 0, -60) }
    else if (r < 0.2 && v.mode === 1) { v.mode = 2; e.ranged = false; B.particle('blood', e.x, e.y - 20, 30, 0, -60) }
  },
  death(e, B) {
    ;['ADD_TRIGGER', 'ADD_TIMER', 'ADD_DEATH_TRIGGER', 'RESET', 'DUPLICATE'].forEach((id, i) => B.spell(id, e.x - 32 + i * 16, e.y))
    B.drop('book_mestari', e.x - 16, e.y); B.drop('wandstone', e.x + 16, e.y)
    for (const o of e.boss.vars.orbs) if (!o.dead) o.dead = true
  },
}

/**
 * Ylialkemisti(boss_alchemist,secret_lab):走路,AnimalAI 远程 wand_orb(create_wand.lua:260 内朝人放 init.lua 选定的四色激光 dark/elec/light/fire 之一);
 * projectile_counter_create.lua 每 10 帧(第一次后改 600 帧):放一个反制盾子实体(projectile_counter.xml 寿命 240 帧,每帧把 48 内非己方弹反向原速射回、伤害 +0.6、爆炸伤 ×2)并把自己 Hitbox damage_multiplier 置 0;
 * 盾消失(projectile_counter_away.lua)→ damage_multiplier 1。damage_received:单次 ≥2 或累计 ≥3 → 再起一个盾(累计 −3)。
 * death:ALPHA / OMEGA / GAMMA / MU / ZETA / PHI / TAU / SIGMA 里 4 张 + heart_fullhp + key(钥匙)。
 */
CONTROLLERS.boss_alchemist = {
  init(e, B) {
    const v = e.boss.vars; v.cum = 0; v.shield = 0; v.first = true
    const styles = ['e_enlightened_laser_dark_wand', 'e_enlightened_laser_elec_wand', 'e_enlightened_laser_light_wand', 'e_enlightened_laser_fire_wand']
    v.laser = styles[RI(0, 3)]
    e.boss.timers[0] = 10
  },
  every: [[600, (e, B) => { CONTROLLERS.boss_alchemist._shield(e, B) }]],
  _shield(e, B) { e.boss.vars.shield = 240; e.dmgMul = 0; B.fx(e.x, e.y - 10, 16, '#a0ffe0', 80, 0.5) },
  tick(e, B, dt) {
    const v = e.boss.vars
    if (v.shield > 0) {
      v.shield -= dt * 60
      if (v.shield <= 0) { e.dmgMul = 1 }
      for (const p of B.projNear(e, 48)) {
        if (p.owner !== 'player' || p.d.type === 'STATIC') continue
        const q = B.shoot(p.name, p.x, p.y, -p.vx, -p.vy, { shooter: e, dmgAdd: 0.6 })
        if (q) { q.exD = (q.exD || 0) + (p.d.explosion?.damage || 0) }
        B.killProj(p, false); B.fx(p.x, p.y, 3, '#a0ffe0', 30, 0.3)
      }
    }
    // wand_orb 弹本体(create_wand.lua):落地那一刻朝 260 内的人放本色激光;简化成开火时直接放激光
  },
  shot(e, B) { const P = B.player(), a = Math.atan2(P.y - e.y, P.x - e.x); B.shoot(e.boss.vars.laser, e.x, e.y - 10, Math.cos(a) * 2, Math.sin(a) * 2, { shooter: e }) },
  hurt(e, B, dmg) { const v = e.boss.vars; v.cum += dmg; if (dmg >= 2 || v.cum >= 3) { CONTROLLERS.boss_alchemist._shield(e, B); v.cum -= 3 } },
  death(e, B) {
    const opts = ['ALPHA', 'OMEGA', 'GAMMA', 'MU', 'ZETA', 'PHI', 'TAU', 'SIGMA']
    for (let i = 0; i < 4; i++) { const k = RI(0, opts.length - 1); B.spell(opts[k], e.x - 32 + i * 16, e.y); opts.splice(k, 1) }
    B.drop('heart_fullhp', e.x, e.y); B.drop('key', e.x, e.y)
  },
}

/**
 * Kolmisilmän koipi 不是它 —— islandspirit(湖心岛 Sielu / boss_spirit):spawner.lua 每 180 帧:200 内有人且 HELPLESS_KILLS ≥ 30 才出;
 * init.lua:hp = min(20 + kills×4, 2000),wisp 数 = min(ceil(kills/10), 20)(每只 y 偏 ±24);islandspirit.lua 受伤:反弹 damage×kills×0.1 诅咒伤害给玩家;
 * 每帧 VerletApplyCircularForce(80, 0.14)。wisp_move.lua:围着本体 lerp 0.975 飘,y−10 + sin 摆 96。death:MASS_POLYMORPH 卡。
 */
CONTROLLERS.islandspirit = {
  init(e, B) {
    const kills = Math.max(1, B.E.helplessKills || 1)
    e.hp = e.maxHp = Math.min(20 + kills * 4, 2000)
    e.boss.vars.kills = kills; e.boss.vars.wisps = []
    const n = Math.min(Math.ceil(kills / 10), 20)
    for (let i = 1; i <= n; i++) { const w = B.E.spawnCreature?.('wisp', e.x, e.y + RF(-1, 1) * 24); if (w) { w.wispOf = e; w.seed = R01() * 2 - 1; e.boss.vars.wisps.push(w) } }
  },
  tick(e, B) {
    const t = B.E.time * 60
    for (const w of e.boss.vars.wisps) {
      if (w.dead) continue
      const r = w.seed, tt = t + r * 10000
      const tx = e.x + Math.sin(tt * (0.00421 + r * 0.000421)) * 96, ty = e.y - 10 + Math.sin(tt * (0.025 + r * 0.0025)) * 96
      const k = 1 - (0.975 - r * 0.975 * 0.01)
      w.x += (tx - w.x) * k; w.y += (ty - w.y) * k; w.vx = w.vy = 0
      w.face = w.x - tx < 0 ? 1 : -1
    }
  },
  hurt(e, B, dmg) { B.E.hooks.damagePlayer?.(dmg * e.boss.vars.kills * 0.1, 0, 0, e) },
  death(e, B) { B.spell('MASS_POLYMORPH', e.x, e.y); for (const w of e.boss.vars.wisps) w.dead = true },
}

/**
 * Syväolento(fish_giga,深湖 −14000,10000):movement.lua 每帧 v = (cos((f−352)×0.0081)×25, cos((f+212)×0.006)×15) 在水里慢慢游;
 * eye.lua:160 内有人 → 眼睁开(open 36 帧 → opened),Hitbox 才启用;没人 → 闭上不可打;睁着满 360 帧 → 8 发 orb_big 环形速 80(起始角随机)
 * damage.lua:每次受伤从 (x, y+48) 朝打它的人放一发 orb_big 速 80。PROTECTION_PROJECTILE 常驻(弹丸伤害 0 —— 只能爆炸 / 材质);death:水全变烟 + heart_fullhp + 超级箱 + 传送门。
 */
CONTROLLERS.fish_giga = {
  init(e, B) { e.dmgMul = 0; e.boss.vars.eye = 'closed'; e.boss.vars.timer = 0; e.projImmune = true; B.move(e, 'hold'); e.flySpeed = 0 },
  tick(e, B, dt) {
    const v = e.boss.vars, f = B.E.time * 60
    e.vx = Math.cos((f - 352) * 0.0081) * 25; e.vy = Math.cos((f + 212) * 0.006) * 15
    e.x += e.vx * dt; e.y += e.vy * dt
    v.timer += dt * 60
    const near = B.dist(e) < 160
    if (!near) { if (v.eye === 'opened') { v.eye = 'close'; v.timer = 0; e.dmgMul = 0 } else if (v.eye === 'close' && v.timer > 36) { v.eye = 'closed'; v.timer = 0 } else if (v.eye === 'open' && v.timer > 36) { v.eye = 'opened'; v.timer = 0; e.dmgMul = 1 } }
    else { if (v.eye === 'closed') { v.eye = 'open'; v.timer = 0 } else if (v.eye === 'open' && v.timer > 36) { v.eye = 'opened'; v.timer = 0; e.dmgMul = 1 } else if (v.eye === 'close' && v.timer > 36) { v.eye = 'closed'; v.timer = 0 } }
    if (v.eye === 'opened' && v.timer > 360) { v.timer = 0; const off = RI(1, 100) * 0.01 * Math.PI; for (let a = 0; a < 8; a++) { const ang = off + (TAU / 8) * a; B.shoot('e_bossfish_orb_big', e.x, e.y, Math.cos(ang) * 80, -Math.sin(ang) * 80, { shooter: e }) } }
  },
  hurt(e, B, dmg, src, proj) { const P = B.player(), a = Math.atan2(P.y - (e.y + 48), P.x - e.x); B.shoot('e_bossfish_orb_big', e.x, e.y + 48, Math.cos(a) * 80, Math.sin(a) * 80, { shooter: e }) },
  // death.lua:全世界的水变烟(ConvertMaterialEverywhere,没做)+ heart_fullhp + 超级箱 + 通往传送室的门;miniboss_fish flag 让传送室六扇门通电(teleroom.lua)
  death(e, B) { B.drop('heart_fullhp', e.x + 32, e.y); B.drop('chest_random', e.x - 32, e.y); B.E.hooks.spawnSpecial?.({ entity: 'teleport_teleroom', x: e.x, y: e.y }); B.E.hooks.runFlag?.('minibossFish') },
}

/**
 * Kolmisilmän sydän(boss_sky,天空神殿 boss 室):init hp = 玩家 max_hp;受伤把伤害按比例反射给玩家(boss_sky_damage.xml 挂在玩家斗篷上,圣伤 ×1.5);
 * 350 内洗掉玩家的 PROTECTION_ALL 并沾水;掉出出生点 500 以下就传回去。death:两处 phase2 标记出幻影(apparition)—— 幻影不做。
 * AnimalAI 远程 acidshot(xml)。
 */
CONTROLLERS.boss_sky = {
  init(e, B) { const p = B.E.player; e.hp = e.maxHp = Math.max(1, p.maxHp ?? 4); e.boss.vars.y0 = e.y; e.flySpeed = (e.d.physicsAI?.force_coeff ?? 20) * 4.5 }, // 玩家 maxHp 本来就是 Noita 单位(4 = 100 血)
  tick(e, B) { if (e.y > e.boss.vars.y0 + 500) { B.fx(e.x, e.y, 10, '#c0a0ff', 60, 0.4); e.y = e.boss.vars.y0; e.vy = 0 } },
  hurt(e, B, dmg) { B.E.hooks.damagePlayer?.(dmg * 1.5, 0, 0, e) },
  // death:两处 boss_phase2_marker 各出一只幻影(apparition_spawn_fx.xml → 引擎 SpawnApparition:随机一种怪的幽灵版,hp = 玩家 max_hp,当 miniboss)
  death(e, B) {
    const E = B.E, pool = Object.entries(E.defs).filter(([k, d]) => d.kind === 'creature' && d.ai && d.platforming && d.sprite?.image && !d.boss && !d.bossChild && !d.stationary && !/^(wisp|friend|ultimate_killer|mimic)/.test(k)).map(([k]) => k)
    for (const m of (E.markers || []).filter((m) => Math.hypot(m.x - e.x, m.y - e.y) < 600)) {
      const name = pool[RI(0, pool.length - 1)], a = E.spawnCreature(name, m.x, m.y)
      if (a) { a.apparition = true; a.hp = a.maxHp = Math.max(1, (E.player.maxHp ?? 4)); a.state = 'chase'; a.stateT = 5; a.d = { ...a.d, label: (a.d.label || name) + '的幻影', boss: 'apparition' }; a.boss = { C: {}, gen: null, wait: 0, timers: [], t: 0, vars: {} } }
      B.fx(m.x, m.y, 20, '#c0a0ff', 80, 0.6)
    }
  },
}

/** 门怪(boss_gate/gate_monster_a~d):gate_monster_push.lua 每 4 帧把 90 内别的门怪推开(力 800);AnimalAI 远程 acidshot;death 掷一张随机卡 */
for (const n of ['a', 'b', 'c', 'd']) {
  CONTROLLERS['gate_monster_' + n] = {
    init(e) { e.flySpeed = (e.d.physicsAI?.force_coeff ?? 18) * 4.5 },
    every: [[4, (e, B) => { for (const o of B.E.list) { if (o === e || o.dead || !/^gate_monster_/.test(o.name)) continue; const d = Math.hypot(o.x - e.x, o.y - e.y); if (d < 90 && d > 0.1) { o.vx += ((o.x - e.x) / d) * 800 * (4 / 60) * 0.1; o.vy += ((o.y - e.y) / d) * 800 * (4 / 60) * 0.1 } } }]],
    death(e, B) { B.E.hooks.spawnSpecial?.({ entity: 'spell', action: null, x: e.x, y: e.y }) },
  }
}

/** friend(友人洞的 Toveri):friend_status.lua 按 ULTIMATE_KILLER_KILLS 变强,我们没记 → 原样;ultimate_killer 死了 megabomb 炸(ultimate_killer_death.lua) */
CONTROLLERS.ultimate_killer = { death(e, B) { const P = B.E.projectiles; if (P?.defs?.e_ultimate_killer_megabomb) P.spawn('e_ultimate_killer_megabomb', e.x, e.y, 0, { owner: 'enemy' }) } }
CONTROLLERS.friend = {}

/**
 * 生成触发器(buildings/*.xml 的 CollisionTrigger / 定时脚本):不是怪,只是"人到 r 内 → 放 boss"
 *   dragonspot 256 → boss_dragon(Suomuhauki)  maggotspot 220(每 20 帧查)→ maggot_tiny(Tapion vasalli)  ghost_spawn_check 300 → boss_ghost
 *   boss_limbs_trigger 160 → boss_limbs + book_music_b  boss_spirit_spawner 200 且 helpless 杀 ≥30(每 180 帧查)→ islandspirit
 */
export const TRIGGERS = {
  dragonspot: { r: 256, spawn: 'boss_dragon' }, maggotspot: { r: 220, spawn: 'maggot_tiny', every: 20 }, ghost_spawn_check: { r: 300, spawn: 'boss_ghost' },
  boss_limbs_trigger: { r: 160, spawn: 'boss_limbs', also: 'book_music_b' }, boss_spirit_spawner: { r: 200, spawn: 'islandspirit', every: 180, need: (E) => (E.helplessKills || 0) >= 30 },
}
