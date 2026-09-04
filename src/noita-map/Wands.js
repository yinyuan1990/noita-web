// ── 法杖与法术(gun.lua 的施法模型 + level_1_wand.lua 的掷卡)──
// 数据 wands.json(scripts/noita-prepare-wands.mjs):spells = gun_actions.lua 全表(id/中文名/图标/类型/mana/max_uses/弹丸/施法延迟增量/散射增量),
// wands = 煤矿祭坛的 17 根固定法杖(AbilityComponent + gun_config)+ 初始 Bolt staff / Bomb wand。
// 施法(gun.lua 简化):牌库 = cards;每次施法抽 actions_per_round 张 → 每张 PROJECTILE 卡按其弹丸开火;
//   施法延迟 = 法杖 fire_rate_wait + Σ卡 fire_rate_wait(帧);法力 = Σ卡 mana,不够就放不出;牌库抽空 → 充能 reload_time(帧),
//   shuffle_deck_when_empty=1 的洗牌;max_uses 有限次的卡用完消失。散射 = 法杖 spread_degrees + Σ卡 spread。
// 修饰卡 / DRAW_MANY / 触发弹先不实现(掷到就跳过,记在 README)。

import { NollaPrng } from './core/NollaPrng.js'

const LEVEL1_CARDS = ['LIGHT_BULLET', 'RUBBER_BALL', 'ARROW', 'DISC_BULLET', 'BOUNCY_ORB', 'BULLET', 'AIR_BULLET', 'SLIMEBALL']

export class WandSystem {
  /** @param {{res:string, seed:number, projectiles:object}} o */
  constructor({ res, seed, projectiles }) {
    this.res = res; this.seed = seed >>> 0; this.projectiles = projectiles
    this.spells = null; this.defs = null
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
   * 施一次法。fire(projName, angleOffsetRad, speedMul) 由调用方提供(带杖尖坐标);返回 {shots, wait} 或 null(放不出:冷却/充能/没蓝)
   */
  cast(w, angle, fire) {
    if (!w || w.cd > 0 || w.reloadT > 0) return null
    // 有限次数的卡用光后留在杖里(次数 0,原版也这样显示),只是抽不到;整根杖没有能放的卡 = 空杖
    if (!w.deck.length) { if (!w.cards.some((c) => !(c in w.uses) || w.uses[c] > 0)) return { shots: 0, wait: 0, empty: true }; w.reloadT = Math.max(1, w.reloadTime) / 60; return null }
    const hand = w.deck.splice(0, Math.max(1, w.actionsPerRound))
    // DRAW_MANY(双重/三重施放…):再抽 N 张进这一手
    for (let i = 0; i < hand.length; i++) { const s = this.spells[hand[i]]; if (s?.type === 'DRAW_MANY' && w.deck.length) hand.push(...w.deck.splice(0, Math.max(1, +s.drawMany || 2))) }
    let mana = 0, wait = w.fireRateWait, spread = w.spread, shots = 0, reloadExtra = 0
    for (const c of hand) { const s = this.spells[c]; if (s) { mana += s.mana; wait += s.fireRateWait; spread += s.spread; reloadExtra += s.reload } }
    if (w.mana < mana) { w.deck.unshift(...hand); w.cd = 0.1; return { shots: 0, wait: 0, noMana: true } }
    w.mana -= mana
    // 修饰卡(MODIFIER):速度 / 散射增量叠给这一手后面的弹
    let speedMod = 0
    for (const c of hand) {
      const s = this.spells[c]
      if (!s) continue
      if (c in w.uses) { w.uses[c]--; if (w.uses[c] <= 0) w.lastEmptied = s.name }
      if (s.type === 'MODIFIER') { speedMod += s.speed || 0; continue }
      for (const p of s.projectiles) {
        const name = this.projectiles.defs[p] ? p : null
        if (!name) continue
        fire(name, (spread * Math.PI / 180) * (Math.random() - 0.5) * 2, w.speedMul * (1 + (s.speed || 0) + speedMod))
        shots++
      }
    }
    w.cd = Math.max(1, wait) / 60
    if (!w.deck.length) { w.reloadT = Math.max(1, w.reloadTime + reloadExtra) / 60 }
    return { shots, wait }
  }

  /** 卡的显示名 / 图标 */
  spell(id) { return this.spells[id] || null }

  /** 某法术在某层的 spawn_probability(spawn_level 里没这一层 = 0);带 spawn_requires_flag 的默认没解锁,不进池 */
  _spawnProb(s, level) {
    if (s.flag) return 0
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
