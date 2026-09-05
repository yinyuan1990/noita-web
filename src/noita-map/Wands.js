// ── 法杖与法术(gun.lua 的施法模型 + level_1_wand.lua 的掷卡)──
// 数据 wands.json(scripts/noita-prepare-wands.mjs):spells = gun_actions.lua 全表(id/中文名/图标/类型/mana/max_uses/弹丸/施法延迟增量/散射增量),
// wands = 煤矿祭坛的 17 根固定法杖(AbilityComponent + gun_config)+ 初始 Bolt staff / Bomb wand。
// 施法(gun.lua 简化):牌库 = cards;每次施法抽 actions_per_round 张 → 每张 PROJECTILE 卡按其弹丸开火;
//   施法延迟 = 法杖 fire_rate_wait + Σ卡 fire_rate_wait(帧);法力 = Σ卡 mana,不够就放不出;牌库抽空 → 充能 reload_time(帧),
//   shuffle_deck_when_empty=1 的洗牌;max_uses 有限次的卡用完消失。散射 = 法杖 spread_degrees + Σ卡 spread。
// 修饰卡:gun_actions.lua 每张卡的 action 体被 prepare 抠成 ops(对 c.* / shot_effects.* 的 add / mul / set / append / cap / floor),
//   施法时按 gun.lua 的语义回放:c 是**每个 shot 一份**(create_shot → ConfigGunActionInfo_Init 默认值;根 shot 从法杖的 gunaction_config 拷),
//   同一 shot 里所有卡(弹丸卡自己也会改 c:火球 +20 后座、火花弹 +5 暴击)的 ops 都作用到同一个 c,shot 放出时 register_action(c) 一次 → shot 里所有弹共享最终 c;
//   触发弹的载荷是新 shot(新 c)。shot_effects.recoil_knockback 是整次施法共享,射手 mVelocity −= 瞄准方向 × recoil(反 exe GunSystem::ShootShot)。

import { NollaPrng } from './core/NollaPrng.js'

export const FREE_CAPACITY = 20 // 自由模式每根杖的最少格数(原版法杖最多 26)
const LEVEL1_CARDS = ['LIGHT_BULLET', 'RUBBER_BALL', 'ARROW', 'DISC_BULLET', 'BOUNCY_ORB', 'BULLET', 'AIR_BULLET', 'SLIMEBALL']

/** ConfigGunActionInfo_Init(gunaction_generated.lua)的默认值 —— 每个 shot 的起点 */
export const C_DEFAULTS = {
  fire_rate_wait: 0, speed_multiplier: 1, child_speed_multiplier: 1, dampening: 1, explosion_radius: 0, spread_degrees: 0, pattern_degrees: 0, screenshake: 0, recoil: 0,
  damage_melee_add: 0, damage_projectile_add: 0, damage_electricity_add: 0, damage_fire_add: 0, damage_explosion_add: 0, damage_ice_add: 0, damage_slice_add: 0, damage_healing_add: 0, damage_curse_add: 0, damage_drill_add: 0, damage_null_all: 0,
  damage_explosion: 0, damage_projectile: 0, damage_critical_chance: 0, damage_critical_multiplier: 0, explosion_damage_to_materials: 0, knockback_force: 0, reload_time: 0, lightning_count: 0,
  material: '', material_amount: 0, trail_material: '', trail_material_amount: 0, bounces: 0, gravity: 0, light: 0, blood_count_multiplier: 1, gore_particles: 0, ragdoll_fx: 0, friendly_fire: 0, physics_impulse_coeff: 0, lifetime_add: 0,
  sprite: '', extra_entities: '', game_effect_entities: '', sound_loop_tag: '', projectile_file: '',
}
/** 会真正影响弹丸的 c 字段(usableSpells 用它判断修饰卡有没有效果) */
const C_FIELDS = new Set(['fire_rate_wait', 'speed_multiplier', 'explosion_radius', 'spread_degrees', 'damage_projectile_add', 'damage_explosion_add', 'damage_explosion', 'damage_electricity_add', 'damage_fire_add', 'damage_ice_add', 'knockback_force', 'reload_time', 'bounces', 'gravity', 'friendly_fire', 'lifetime_add', 'recoil_knockback', 'trail_material'])
/**
 * extra_entities 附加实体 → 行为(文件内容见 noita-ref/unpacked/entities/misc/*.xml + scripts/projectiles/*.lua,数值原样抄):
 *   homing*:HomingComponent(反 exe HomingSystem:v = v × velocity_multiplier + 朝目标方向 × targeting_coeff × dt × (1 − d/detect_distance),detect 默认 150;
 *            just_rotate 模式只把速度方向按 max_turn_rate 每帧转向目标)
 */
export const EXTRA_BEHAVIOR = {
  homing: { homing: { coeff: 130, mult: 0.86, detect: 150 } },
  homing_short: { homing: { coeff: 480, mult: 0.83, detect: 60 } },
  homing_shooter: { homing: { coeff: 30, mult: 0.99, detect: 300, shooter: true } },
  anti_homing: { homing: { coeff: -130, mult: 0.86, detect: 150 } },
  homing_rotate: { homing: { rotate: true, turn: 0.2, detect: 150 } },
  homing_accelerating: { homing: { coeff: 20, mult: 0.4, detect: 200, accel: { coeffAdd: 2, coeffMax: 800, multAdd: 0.01, multMax: 2 } } },
  homing_cursor: { cursor: 0.2 },            // homing_cursor.lua:每帧朝法杖朝向转 20%
  autoaim: { autoaim: { range: 200, steer: 0.8, scatter: 0.1 } }, // autoaim.lua:出生那帧朝 200px 内最近敌人(有视线)lerp 0.8
  piercing_shot: { pierce: true },            // piercing_shot.lua:on_collision_die = 0
  clipping_shot: { clip: 0.1 },              // clipping_shot.lua:penetrate_world = 1,地里速度 ×0.1
  fly_upwards: { flyAt: { frame: 20, dir: -1 } }, // fly_upwards.lua:第 20 帧速度变成 (0, −2|v|)
  fly_downwards: { flyAt: { frame: 20, dir: 1 } },
  sinewave: { sine: { freq: 1.0, m: 0.6 } },  // SineWaveComponent sinewave_m × sin(freq × lifetime)
  chaotic_arc: { chaos: { every: 2, scale: 0.4 } }, // chaotic_arc.lua:每 2 帧 v += Random(−0.4·max|v|, +…)(x y 同一个随机数)
  floating_arc: { float: { ray: 30, targetY: 12, maxVy: 240 } }, // floating_arc.lua:向下探 30px,悬在地面上方 12px
  avoiding_arc: { avoid: { every: 3, ray: 20, strength: 0.3 } }, // avoiding_arc.lua:四向探 20px,按 (20² − d²)×0.3 推开
  lifetime_infinite: { lifetimeInfinite: true },
  remove_bounce: { noBounce: true },
  nolla: { nolla: true },                    // nolla.lua:lifetime = 1 帧
  accelerating_shot: { airFrictionAdd: -3 }, // accelerating_shot.lua:air_friction −3
  decelerating_shot: { airFrictionAdd: 6 },
  area_damage: { areaDamage: { r: 16, perFrame: 0.14 } }, // AreaDamageComponent circle_radius 16 damage_per_frame 0.14
  light_shot: {}, heavy_shot: {}, tinyspark_white: {}, tinyspark_white_small: {}, tinyspark_white_weak: {}, tinyspark_yellow: {}, tinyspark_red: {}, // 纯粒子装饰
}
/** game_effect_entities 里我们能施加的状态(damage_game_effect_entities:命中时给目标) */
const GAME_EFFECTS = new Set(['effect_frozen', 'effect_electricity', 'effect_apply_on_fire', 'effect_apply_wet', 'effect_apply_oiled', 'effect_disintegrated'])

export class WandSystem {
  /** @param {{res:string, seed:number, projectiles:object}} o */
  constructor({ res, seed, projectiles }) {
    this.res = res; this.seed = seed >>> 0; this.projectiles = projectiles
    this.spells = null; this.defs = null
    this.infinite = false     // 自由模式:不扣法力、有限次数的卡不减
    this.allUnlocked = false  // 带 spawn_requires_flag 的法术也进池(当作全部解锁)
  }

  /** 能真正放出东西的法术(弹丸都在 projectiles.json 里,或有我们实现了效果的修饰 / 多重施放卡)—— 法术库 UI 用 */
  usableSpells() {
    const defs = this.projectiles?.defs || {}
    return Object.values(this.spells).filter((s) => s.icon && (
      (s.projectiles?.length && s.projectiles.every((p) => defs[p])) ||
      (s.type === 'MODIFIER' && (s.ops || []).some((o) => WandSystem.opSupported(o))) ||
      s.type === 'DRAW_MANY'))
  }

  /** 修饰卡的哪些 c.* 操作我们真的会生效(其余的卡先不进法术库,免得"装上没反应") */
  static opSupported(o) {
    if (C_FIELDS.has(o.f)) return true
    if (o.op === 'append' && (o.f === 'extra_entities' || o.f === 'game_effect_entities')) return o.v.split(',').some((f) => EXTRA_BEHAVIOR[f.trim().split('/').pop().replace('.xml', '')] || GAME_EFFECTS.has(f.trim().split('/').pop().replace('.xml', '')))
    return false
  }

  async init() {
    const j = await (await fetch(`${this.res}/wands.json`)).json()
    this.spells = j.spells; this.defs = j.wands
    return this
  }

  spriteUrl(w) { return w.def.sprite ? `${this.res}/ent/${w.def.sprite}` : null }

  /** 造一根法杖实例;固定法杖(level1Cards)按 level_1_wand.lua 用 SetRandomSeed(x,y) 掷卡 */
  make(key, x = 0, y = 0) {
    let def = this.defs[key]
    if (!def && /^wand_(level_0\d(_better)?|unshuffle_0\d)$/.test(key)) {
      // 随机法杖(wand_level_01/02/02_better/unshuffle_01/02):gun_procedural 的完整复刻另做;这里用 17 根固定法杖里按位置掷一根的数值 + level_1 卡
      const prng = new NollaPrng(0); prng.SetRandomSeed(this.seed, x, y)
      const keys = Object.keys(this.defs).filter((k) => /^wand_\d+$/.test(k))
      def = this.defs[keys[prng.Random(0, keys.length - 1)]]
    }
    if (!def) return null
    const w = {
      def, key, name: def.name, cards: [...(def.cards || [])],
      deckCapacity: def.deckCapacity, actionsPerRound: def.actionsPerRound, reloadTime: def.reloadTime, shuffle: def.shuffle,
      fireRateWait: def.fireRateWait, spread: def.spread, speedMul: def.speedMul, manaMax: def.manaMax, manaCharge: def.manaCharge,
      mana: def.manaMax, cd: 0, reloadT: 0, deck: [], uses: {}, x, y,
    }
    const prng = new NollaPrng(0)
    if (def.rangeReload) {
      // starting_bomb_wand.lua:SetRandomSeed(x-1, y),各项在区间里掷
      prng.SetRandomSeed(this.seed, x - 1, y)
      w.reloadTime = prng.Random(...def.rangeReload); w.fireRateWait = prng.Random(...def.rangeFireRate)
      w.manaCharge = prng.Random(...def.rangeManaCharge); w.manaMax = prng.Random(...def.rangeManaMax); w.mana = w.manaMax
    }
    if (def.level1Cards) this._doLevel1(w, x, y)
    for (const c of w.cards) { const s = this.spells[c]; if (s && s.maxUses > 0) w.uses[c] = (w.uses[c] ?? 0) + s.maxUses }
    if (this.infinite) w.deckCapacity = Math.max(w.deckCapacity, FREE_CAPACITY) // 自由模式:每根杖至少 20 格
    w.deck = w.cards.slice()
    return w
  }

  /** level_1_wand.lua do_level1(1) 逐行:total = reload + fire_rate + spread (+ Random(-10,20)) 决定走弹/炸/工具三张表 */
  _doLevel1(w, x, y) {
    const prng = new NollaPrng(0); prng.SetRandomSeed(this.seed, x, y)
    const R = (a, b) => prng.Random(a, b)
    let total = w.reloadTime + w.fireRateWait + w.spread
    total += R(-10, 20)
    let cards = LEVEL1_CARDS.slice()
    let count = R(1, 5)
    if (R(1, 100) <= 85) {
      cards.push('BUBBLESHOT')
      if (R(1, 100) <= 70) {
        cards.push('SPITTER')
        if (R(1, 100) <= 40) {
          cards.push('LIGHT_BULLET_TRIGGER'); count = 1
          if (R(1, 100) <= 20) {
            cards.push('DISC_BULLET_BIG'); count = 1
            if (R(1, 100) <= 10) {
              cards.push('TENTACLE_PORTAL'); count = 1; if (w.manaMax < 140) w.manaMax = 140
              if (R(1, 100) <= 10) { cards.push('BLACK_HOLE_BIG'); count = 1; if (w.manaMax < 240) w.manaMax = 240 }
            }
          }
        }
      }
    }
    if (total > 50) {
      cards = ['GRENADE', 'BOMB', 'ROCKET']
      if (R(1, 100) <= 75) { cards.push('DYNAMITE'); if (R(1, 100) <= 50) { cards.push('FIREBALL'); if (R(1, 100) <= 40) { cards.push('ACIDSHOT'); if (R(1, 100) <= 30) { cards.push('GLITTER_BOMB'); if (R(1, 100) <= 30) cards.push('MINE') } } } }
      count = 1
    }
    if (R(0, 100) < 30) {
      cards = ['CLOUD_WATER', 'X_RAY', 'FREEZE_FIELD', 'BLACK_HOLE', 'TORCH', 'SHIELD_FIELD']
      if (R(1, 100) <= 75) { cards.push('ELECTROCUTION_FIELD'); if (R(1, 100) <= 50) { cards.push('DIGGER'); if (R(1, 100) <= 50) { cards.push('TORCH_ELECTRIC'); if (R(1, 100) <= 50) { cards.push('POWERDIGGER'); if (R(1, 100) <= 50) { cards.push('SOILBALL'); if (R(1, 100) <= 50) { cards.push('LUMINOUS_DRILL'); if (R(1, 100) <= 50) cards.push('CHAINSAW') } } } } } }
      count = 1
    }
    if (count > w.deckCapacity) count = w.deckCapacity
    const card = cards[R(1, cards.length) - 1]
    if (card === 'BLACK_HOLE' && w.manaMax < 180) w.manaMax = 180
    w.mana = w.manaMax
    for (let i = 0; i < count; i++) w.cards.push(card)
  }

  update(w, dt) {
    if (!w) return
    w.mana = Math.min(w.manaMax, w.mana + w.manaCharge * dt)
    w.cd = Math.max(0, w.cd - dt)
    if (w.reloadT > 0) { w.reloadT -= dt; if (w.reloadT <= 0) this._refill(w) }
  }

  /** heart_refresh.xml(圣山"法术刷新"):法力回满、充能归零、有限次数的卡补满(每张 maxUses) */
  refresh(w) {
    w.mana = w.manaMax; w.reloadT = 0; w.cd = 0
    for (const c of Object.keys(w.uses)) { const s = this.spells[c], n = w.cards.filter((k) => k === c).length; if (s && n) w.uses[c] = n * s.maxUses; else delete w.uses[c] }
    w.deck = w.cards.filter((c) => !(c in w.uses) || w.uses[c] > 0)
  }

  _refill(w) {
    w.deck = w.cards.filter((c) => !(c in w.uses) || w.uses[c] > 0)
    if (w.shuffle) for (let i = w.deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = w.deck[i]; w.deck[i] = w.deck[j]; w.deck[j] = t }
  }

  /**
   * 施一次法 —— gun.lua 逐条:
   *   _start_shot:根 shot 抽 actions_per_round 张(draw_actions(n, instant_reload=false):牌库抽空就停,reloading);
   *   draw_action:抽牌库第一张 → 法力不够 / 次数用完 → 弃掉换下一张(draw_actions 里 while #deck>0 再试);够 → 扣法力、执行 action:
   *     PROJECTILE / STATIC_PROJECTILE / MATERIAL → add_projectile(进当前 shot,带着此前修饰卡叠出来的 c.speed_multiplier / spread);
   *     带触发的(add_projectile_trigger_hit_world / _timer / _death)→ 先 BeginTrigger,再 draw_shot(create_shot(1), instant_reload=true) 抽 1 张当载荷(弹死时放出),EndTrigger;
   *     MODIFIER → 改 c(速度 / 散射 / 施法延迟),再 draw_actions(1, true) 让后面那张弹吃到它;
   *     DRAW_MANY(多重 / 散射 / 阵型)→ draw_actions(N, true):再抽 N 张进同一 shot,一起放出;抽到牌库尾就"绕回"(move_discarded_to_deck + start_reload);
   *   每张卡 c.fire_rate_wait += 卡的施法延迟、current_reload_time += 卡的充能增量;shot 里全部弹同一帧放出;
   *   _handle_reload:牌库空 / 绕回过 → StartReload(current_reload_time),shuffle_deck_when_empty 洗牌。
   * infinite(自由模式):不扣法力、有限次数不减、充能 0 帧。
   * fire(projName, angleOffsetRad, c, payload) 由调用方提供(带杖尖坐标);c 是这颗弹所属 shot 的最终 ConfigGunActionInfo;payload = [{name, c, payload, trigger}] 是触发弹的载荷。
   * 返回 {shots, wait, recoil, noMana?, empty?} 或 null(冷却 / 充能中);recoil = shot_effects.recoil_knockback,调用方给射手 v −= 瞄准方向 × recoil。
   */
  cast(w, angle, fire) {
    if (!w || w.cd > 0 || w.reloadT > 0) return null
    // 整根杖没有能放的卡 = 空杖(有限次数的卡用光后留在杖里,次数 0,原版也这样显示)
    if (!w.cards.some((c) => !(c in w.uses) || w.uses[c] > 0)) return { shots: 0, wait: 0, empty: true }
    if (!w.deck.length) this._refill(w)
    // st.wait 累计所有 shot 的 c.fire_rate_wait(触发载荷里的卡也算施法延迟);reload 是 current_reload_time,全局累加
    const st = { wait: 0, reload: w.reloadTime, noMana: false, startReload: false, reloading: false, drawn: 0, pulls: 0, recoil: 0 }
    const newShot = (fromWand) => ({ list: [], c: { ...C_DEFAULTS, ...(fromWand ? { fire_rate_wait: w.fireRateWait, spread_degrees: w.spread, speed_multiplier: w.speedMul } : {}) } })
    const root = newShot(true)
    const applyOps = (c, ops) => {
      for (const o of ops || []) {
        if (o.f === 'recoil_knockback') { if (o.op === 'add') st.recoil += o.v; continue }
        const cur = c[o.f]
        if (o.op === 'add') c[o.f] = (cur || 0) + o.v
        else if (o.op === 'mul') c[o.f] = (cur ?? 1) * o.v
        else if (o.op === 'set') c[o.f] = o.v
        else if (o.op === 'append') c[o.f] = (cur || '') + o.v
        else if (o.op === 'cap') c[o.f] = Math.min(cur, o.v)
        else if (o.op === 'floor') c[o.f] = Math.max(cur, o.v)
      }
    }
    const drawAction = (shot, instant) => {
      if (!w.deck.length) {
        // 绕回(只许一次,免得 无尽法术×2 之类转圈):弃牌堆回牌库,这一发之后要充能
        if (instant && !st.startReload) { this._refill(w); st.startReload = true }
        if (!w.deck.length || !instant) { st.reloading = true; return true }
      }
      if (++st.pulls > 64) { st.reloading = true; return true }
      const c = w.deck.shift(), s = this.spells[c]
      if (!s) return true
      if (!this.infinite) {
        if (s.mana > w.mana) { st.noMana = true; return false }          // OnNotEnoughManaForAction:这张弃掉
        if (c in w.uses && w.uses[c] <= 0) return false                    // uses_remaining == 0:弃掉
        w.mana -= s.mana
        if (c in w.uses) { w.uses[c]--; if (w.uses[c] <= 0) w.lastEmptied = s.name }
      }
      st.drawn++
      // 这张卡的 action 体:所有类型的卡都可能改 c(弹丸卡也会 +fire_rate_wait / +recoil / +crit);reload_time 走 current_reload_time
      const wait0 = shot.c.fire_rate_wait
      applyOps(shot.c, s.ops)
      st.wait += shot.c.fire_rate_wait - wait0
      st.reload += s.reload
      if (s.type === 'MODIFIER') { drawActions(shot, 1, true); return true }
      if (s.type === 'DRAW_MANY') { drawActions(shot, s.drawMany > 0 ? +s.drawMany : Math.max(1, w.deck.length), true); return true }
      for (const p of s.projectiles || []) {
        if (!this.projectiles.defs[p]) continue
        const proj = { name: p, payload: null, c: shot.c } // 同一 shot 的弹共享这个 c 对象,shot 抽完后它才定型
        if (s.trigger) { const sub = newShot(false); drawActions(sub, 1, true); proj.payload = sub.list; proj.trigger = s.trigger }
        shot.list.push(proj)
      }
      return true
    }
    const drawActions = (shot, n, instant) => {
      for (let i = 0; i < n; i++) {
        if (!drawAction(shot, instant)) { while (w.deck.length) if (drawAction(shot, instant)) break }
        if (st.reloading) return
      }
    }
    drawActions(root, Math.max(1, w.actionsPerRound), false)
    let shots = 0
    // 每颗弹带着自己 shot 的最终 c(speed_multiplier 已被 lua 的 clamp 0~20 管住)+ 散射 = c.spread_degrees
    for (const pr of root.list) { fire(pr.name, (pr.c.spread_degrees * Math.PI / 180) * (Math.random() - 0.5) * 2, pr.c, pr.payload); shots++ }
    if (!st.drawn && st.noMana) { w.cd = 0.1; return { shots: 0, wait: 0, noMana: true } }
    w.cd = Math.max(1, st.wait) / 60
    if (!w.deck.length || st.startReload) { if (this.infinite) this._refill(w); else w.reloadT = Math.max(1, st.reload) / 60 }
    return { shots, wait: st.wait, noMana: st.noMana, recoil: st.recoil }
  }

  /** 卡的显示名 / 图标 */
  spell(id) { return this.spells[id] || null }

  /** 某法术在某层的 spawn_probability(spawn_level 里没这一层 = 0);带 spawn_requires_flag 的默认没解锁,不进池 */
  _spawnProb(s, level) {
    if (s.flag && !this.allUnlocked) return 0
    const i = s.levels.indexOf(level)
    return i < 0 ? 0 : s.probs[i] || 0
  }

  /**
   * 引擎函数 GetRandomAction(x, y, level, offset)(照 noitool 的反推):Σ(该层概率) × ProceduralRandom(seed+offset, x, y),
   * 按 gun_actions.lua 顺序累减,落到谁就是谁
   */
  getRandomAction(x, y, level, offset = 0) {
    const list = Object.values(this.spells)
    let sum = 0
    for (const s of list) sum += this._spawnProb(s, level)
    const prng = new NollaPrng(0)
    // 引擎侧坐标是 float(商店第 i 件在 x + i·26.4,小数位会影响种子),按 f32 取
    let acc = sum * prng.ProceduralRandom(this.seed + offset, Math.fround(x), Math.fround(y))
    for (const s of list) {
      const p = this._spawnProb(s, level)
      if (p === 0) continue
      if (p >= acc) return s.id
      acc -= p
    }
    return list[0].id
  }

  /** generate_shop_item.lua 的层数表:按 y/512 的 chunk 行 → 0~6(>35 行 = 7) */
  shopLevel(y) {
    const row = Math.floor(y / 512)
    const T = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6]
    if (row > 35) return 7
    return T[row] ?? 0
  }

  /** generate_shop_item(x, y, cheap):法术卡 + 标价 = max(⌊(price·0.3 + 70·level²)/10⌋·10, 10),打折半价,level² ≥ 10 再 ×5 */
  shopItem(x, y, cheap, level = this.shopLevel(y)) {
    const id = this.getRandomAction(x, y, level, 0)
    const s = this.spells[id]
    const sq = level * level
    let cost = Math.max(Math.floor(((s.price || 0) * 0.3 + 70 * sq) / 10) * 10, 10)
    if (cheap) cost *= 0.5
    if (sq >= 10) cost *= 5
    return { spell: id, cost, sale: !!cheap }
  }

  /** generate_shop_wand(x, y, cheap):SetRandomSeed(x,y);Random(0,100)≤50 洗牌杖 wand_level_0N 否则 wand_unshuffle_0N;价 50 + b·210 + Random(-15,15)·10,b = 0.5N + 0.5N² */
  shopWand(x, y, cheap, level = this.shopLevel(y)) {
    const N = Math.max(1, Math.min(6, level))
    const prng = new NollaPrng(0); prng.SetRandomSeed(this.seed, Math.fround(x), Math.fround(y))
    const key = (prng.Random(0, 100) <= 50 ? 'wand_level_0' : 'wand_unshuffle_0') + N
    const b = 0.5 * N + 0.5 * N * N
    let cost = 50 + b * 210 + prng.Random(-15, 15) * 10
    if (cheap) cost *= 0.5
    return { key, cost, sale: !!cheap }
  }
}
