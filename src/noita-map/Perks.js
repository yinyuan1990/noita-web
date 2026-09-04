// ── 特权(perk.lua + perk_list.lua)──
// perks.json 由 scripts/noita-prepare-perks.mjs 抽自 perk_list.lua(106 条:id / 中文名 / 描述 / 图标 / 可叠属性)。
// perk_get_spawn_order 逐行复刻:SetRandomSeed(1,2) → 按表顺序建牌堆(可叠的 Random(1,2) 或 Random(1,max_in_perk_pool) 张,
// stackable_is_rare 只 1 张)→ 洗牌(从尾到头 Random(1,i))→ 剔掉 4 格内的重复(可叠的按 stackable_how_often_reappears)→
// 已拿过的不可叠 / 叠满的置空。perk_spawn_many:TEMPLE_NEXT_PERK_INDEX 从 1 起顺着牌堆发,空位补 LEGGY_FEET,宽 60 均分。
// 效果:只实现我们已有机制能承载的那部分(见 EFFECTS),其余拿到手记名不生效(HUD 会标"无效果")。

import { NollaPrng } from './core/NollaPrng.js'

const MIN_DISTANCE_BETWEEN_DUPLICATE_PERKS = 4
const DEFAULT_MAX_STACKABLE_PERK_COUNT = 128

export class PerkSystem {
  /** @param {{res:string, seed:number}} o */
  constructor({ res, seed }) {
    this.res = res; this.seed = seed >>> 0
    this.list = null; this.byId = null
    this.nextIndex = 1        // GlobalsGetValue("TEMPLE_NEXT_PERK_INDEX", "1")
    this.perkCount = 3        // TEMPLE_PERK_COUNT
    this.picked = {}          // id → 拿了几次(<flag>_PICKUP_COUNT)
  }

  async init() {
    this.list = await (await fetch(`${this.res}/perks.json`)).json()
    this.byId = Object.fromEntries(this.list.map((p) => [p.id, p]))
    return this
  }

  perk(id) { return this.byId?.[id] || null }

  /** perk_get_spawn_order(ignore_these):整个世界一份固定顺序;已拿过的位置置 '' */
  spawnOrder(ignore = []) {
    const prng = new NollaPrng(0)
    prng.SetRandomSeed(this.seed, 1, 2)
    const deck = [], dist = {}, count = {}
    for (const p of this.list) {
      if (ignore.includes(p.id) || p.notInPool) continue
      let times = 1
      dist[p.id] = -1; count[p.id] = -1
      if (p.stackable) {
        let max = prng.Random(1, 2)
        if (p.maxInPool !== undefined) max = prng.Random(1, p.maxInPool)
        count[p.id] = p.stackableMaximum !== undefined ? p.stackableMaximum : DEFAULT_MAX_STACKABLE_PERK_COUNT
        if (p.stackableIsRare) max = 1
        dist[p.id] = p.reappears ?? MIN_DISTANCE_BETWEEN_DUPLICATE_PERKS
        times = prng.Random(1, max)
      }
      for (let j = 0; j < times; j++) deck.push(p.id)
    }
    // shuffle_table:i = n..2, j = Random(1, i), swap(i, j)(1-based)
    for (let i = deck.length; i >= 2; i--) { const j = prng.Random(1, i); const t = deck[i - 1]; deck[i - 1] = deck[j - 1]; deck[j - 1] = t }
    // 太近的重复从后往前剔
    for (let i = deck.length; i >= 1; i--) {
      const id = deck[i - 1]
      if (dist[id] === -1) continue
      let remove = false
      for (let ri = i - dist[id]; ri <= i - 1; ri++) if (ri >= 1 && deck[ri - 1] === id) { remove = true; break }
      if (remove) deck.splice(i - 1, 1)
    }
    // 已拿过的
    for (let i = 0; i < deck.length; i++) {
      const n = this.picked[deck[i]] || 0
      if (n > 0) { const c = count[deck[i]] ?? -1; if (c === -1 || n >= c) deck[i] = '' }
    }
    return deck
  }

  /** perk_spawn_many(x, y):返回 [{id, x, y}],推进 TEMPLE_NEXT_PERK_INDEX */
  spawnMany(x, y) {
    const count = this.perkCount, itemWidth = 60 / count
    const perks = this.spawnOrder()
    const out = []
    for (let i = 1; i <= count; i++) {
      let idx = this.nextIndex, id = perks[idx - 1]
      while (id === undefined || id === '') {
        perks[idx - 1] = 'LEGGY_FEET'
        idx++; if (idx > perks.length) idx = 1
        id = perks[idx - 1]
      }
      idx++; if (idx > perks.length) idx = 1
      this.nextIndex = idx
      out.push({ id, x: x + (i - 0.5) * itemWidth, y })
    }
    return out
  }

  /** perk_reroll_perks:把当前世界里所有摆着的特权换掉,新特权从牌堆**末尾往前**发(TEMPLE_REROLL_PERK_INDEX);机器标价 400,每用一次翻倍 */
  rerollCost() { return 400 * Math.pow(2, this.rerollCount || 0) }
  rerollMany(positions) {
    this.rerollCount = (this.rerollCount || 0) + 1
    const perks = this.spawnOrder()
    const out = []
    for (const p of positions) {
      let idx = this.rerollIndex ?? perks.length, id = perks[idx - 1]
      while (id === undefined || id === '') {
        perks[idx - 1] = 'LEGGY_FEET'
        idx--; if (idx <= 0) idx = perks.length
        id = perks[idx - 1]
      }
      idx--; if (idx <= 0) idx = perks.length
      this.rerollIndex = idx
      out.push({ id, x: p.x, y: p.y, group: p.group })
    }
    return out
  }

  /** 拿到特权:记次数;效果交给调用方的 ctx(player / wands / flags),返回是否有实现的效果 */
  pickup(id, ctx) {
    this.picked[id] = (this.picked[id] || 0) + 1
    const fx = EFFECTS[id]
    if (fx) fx(ctx, this)
    return !!fx
  }
}

/** 效果实现(数值照 perk_list.lua 的 func / game_effect;ctx = {player, P, wands, flags, R}) */
const EFFECTS = {
  EXTRA_HP: ({ player }) => { const old = player.maxHp; player.maxHp = old * 1.5; player.hp = Math.min(player.maxHp, player.hp + Math.abs(player.maxHp - old)) },
  VAMPIRISM: ({ player, flags }) => { player.maxHp = Math.ceil(player.maxHp * 0.75 * 25) / 25; player.hp = Math.min(player.hp, player.maxHp); flags.vampirism = true },
  GLASS_CANNON: ({ player, flags }) => { player.maxHp = 50 / 25; player.hp = player.maxHp; flags.hpCap = player.maxHp; flags.damageMul = (flags.damageMul || 1) * 5 },
  HEARTS_MORE_EXTRA_HP: ({ flags }) => { flags.heartMul = flags.heartMul ? flags.heartMul + 0.25 : 2 },
  // 玩家参数表 P(noitaPlay:gravity / runMax / accelX / jumpVx / flyVx / flyUpMax / flySpeedMult)
  FASTER_LEVITATION: ({ P }) => { P.gravity = Math.min(P.gravity * 1.4, 588); P.flyUpMax *= 1.5; P.flyVx *= 1.5; P.flySpeedMult *= 1.5 }, // func 改重力 ×1.4;悬浮加速是 GameEffect FASTER_LEVITATION(近似 ×1.5)
  MOVEMENT_FASTER: ({ P }) => { P.runMax *= 1.5; P.jumpVx *= 1.5; P.accelX *= 1.5 }, // GameEffect MOVEMENT_FASTER(近似 ×1.5)
  LOW_GRAVITY: ({ P }) => { P.gravity *= 0.6 },
  HIGH_GRAVITY: ({ P }) => { P.gravity *= 1.5 },
  BREATH_UNDERWATER: ({ flags }) => { flags.breathUnderwater = true },
  PROTECTION_FIRE: ({ flags }) => { flags.protFire = true },
  PROTECTION_RADIOACTIVITY: ({ flags }) => { flags.protRadioactive = true },
  PROTECTION_EXPLOSION: ({ flags }) => { flags.protExplosion = true },
  PROTECTION_MELEE: ({ flags }) => { flags.protMelee = true },
  STAINLESS_ARMOUR: ({ flags }) => { flags.stainless = true },
  SHOP_IS_FREE: ({ flags }) => { flags.shopFree = true },
  // GlobalsSetValue TEMPLE_SHOP_ITEM_COUNT = min(n+1, 10):商店件数在 Worker 里掷(temple_altar.lua spawn_all_shopitems),由 noitaPlay 把 flags 同步过去;已生成的圣山不变
  EXTRA_SHOP_ITEM: ({ flags }) => { flags.shopCount = Math.min((flags.shopCount || 5) + 1, 10) },
  // GlobalsSetValue TEMPLE_PEACE_WITH_GODS = 1:偷东西 / 挖穿圣山不再出 Stevari(原作已在场的守卫会被 CHARM,这里不做)
  PEACE_WITH_GODS: ({ flags }) => { flags.peaceWithGods = true },
  GOLD_IS_FOREVER: ({ flags }) => { flags.goldForever = true },
  EXTRA_WAND_SLOT: ({ flags }) => { flags.wandSlots = (flags.wandSlots || 4) + 1 },
  EXTRA_POTION_SLOT: ({ flags }) => { flags.itemSlots = (flags.itemSlots || 4) + 1 },
  EDIT_WANDS_EVERYWHERE: ({ flags }) => { flags.editAnywhere = true },
  EXTRA_PERK: (_, sys) => { sys.perkCount += 1 },
  NO_MORE_SHUFFLE: ({ player, flags }) => { flags.noShuffle = true; for (const w of player.wands) if (!w.debug) w.shuffle = false },
  FASTER_WANDS: ({ player, flags }) => {
    flags.fasterWands = (flags.fasterWands || 0) + 1
    for (const w of player.wands) if (!w.debug) { w.reloadTime = w.reloadTime * 0.8 - 5; w.fireRateWait = w.fireRateWait * 0.8 - 5; w.manaCharge += 30 }
  },
  EXTRA_SLOTS: ({ player, R }) => { for (const w of player.wands) if (!w.debug) w.deckCapacity = Math.min(w.deckCapacity + R(1, 3), Math.max(25, w.deckCapacity)) },
  EXTRA_MANA: ({ player, R }) => {
    for (const w of player.wands) {
      if (w.debug) continue
      w.manaMax = Math.min(w.manaMax + R(10, 20) * R(10, 30), 20000)
      w.manaCharge = Math.min(Math.min(w.manaCharge * R(200, 350) * 0.01, w.manaCharge + R(100, 300)), 20000)
      w.deckCapacity = Math.max(1, Math.floor(w.deckCapacity * 0.5))
      if (w.cards.length > w.deckCapacity) { const dropped = w.cards.splice(w.deckCapacity); player.spells.push(...dropped) }
      w.deck = w.cards.slice(); w.mana = w.manaMax
    }
  },
  SAVING_GRACE: ({ flags }) => { flags.savingGrace = (flags.savingGrace || 0) + 1 },
  RESPAWN: ({ flags }) => { flags.respawn = (flags.respawn || 0) + 1 },
  EXTRA_MONEY: ({ flags }) => { flags.goldMul = (flags.goldMul || 1) * 1.5 },
}
export const IMPLEMENTED_PERKS = new Set(Object.keys(EFFECTS))
