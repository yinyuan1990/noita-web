// ── 实体层(第 1 步):敌人 / 动物,定义全部来自 entities.json(data/entities/animals/*.xml 经 Base 合并)──
// 生成点由 Worker 按 lua 的 spawn() 掷骰算好挂在 chunk.spawns(种子确定),主线程首次拿到该 chunk 时实例化一次。
// 行走 = CharacterPlatformingComponent(pixel_gravity / run_velocity / accel_x / climb_over_y,与玩家同一个模型);
// 精灵 = SpriteComponent 的 Sprite xml(RectAnimation 按名字播:stand/walk/jump_up/jump_fall/attack/swim_*);
// AI = AnimalAIComponent 的简化版:sense_creatures + creature_detection_range 发现玩家 → 追 → attack_melee_max_distance 内近战
//      (attack_melee_damage_min/max、frames_between、impulse);helpless 阵营见人就跑;没人时闲逛/站着。
// 伤害 = DamageModelComponent:hp;被弹丸/爆炸打到掉血,喷 blood_material;死亡按 KillMe 的 RAGDOLL_FX 分支出尸体(Ragdoll.js:关节连着的一具)/ 冻块 / 化尘,掉金走 drop_money。
// 物理道具(prop)在这一步只登记,不实例化——像素刚体是第 2 步。

import { RigidBody } from './RigidBody.js'
import { Physics } from './Physics.js'
import { Ragdoll } from './Ragdoll.js'
import { NollaPrng } from './core/NollaPrng.js'
import { CHUNK, WORLD_CENTER_CHUNK_X as WCX, WORLD_CENTER_CHUNK_Y as WCY } from './core/coords.js'

const K_LIQUID = 3
const MAX_SWAY = 4 // 同时在摆的物理蘑菇上限(见 _updateMultis;真菌洞 6 株 ≈ 45 个部件 2.5~5ms)
const MAX_RAGDOLL_PARTS = 96 // 同时活着的尸块上限(≈8 具僵尸;见 _capRagdolls)
const BODY_GRAVITY = 72 // Box2D 世界重力:反 exe b2World 构造的重力向量 (0, 12) m/s² = 72 px/s²,见 Physics.js;原版箱子 / 尸体确实比角色(pixel_gravity 350)落得慢得多

export class Entities {
  /**
   * @param {object} o
   * @param {string} o.res
   * @param {(url:string)=>Promise<{width:number,height:number,data:Uint8Array,image:ImageBitmap}>} o.decodePng
   * @param {object} o.mats  assets.materials
   * @param {object} o.sim   CellSim(bind 后可 get/set)
   * @param {(wx:number,wy:number)=>number} o.matAt  世界坐标 → 材质 id(-1 未加载)
   * @param {object} o.player  {x,y,vx,vy,hp}
   * @param {object} o.hooks  {debris(x,y,vx,vy,m,col), sfx(name,opt), damagePlayer(dmg, ix, iy, src), shake(t)}
   */
  constructor({ res, decodePng, mats, sim, matAt, player, projectiles = null, seed = 0, hooks = {}, physics = null }) {
    this.res = res; this.decodePng = decodePng; this.mats = mats; this.sim = sim; this.matAt = matAt; this.player = player; this.hooks = hooks
    this.physics = physics // Box2D(planck)世界;null = 全走手写求解器
    this.seed = seed >>> 0
    this.projectiles = projectiles
    this.defs = null
    this.images = new Map()
    this.list = []
    this.worms = []        // 虫(WormComponent 节链)
    this.bodies = []       // 像素刚体(物理道具)
    this.pendingProps = [] // 形状图还没到的道具
    this.ragdolls = []     // 布娃娃组(Ragdoll:部件刚体 + 关节)
    this._bornSeq = 0      // 尸块出生序号(超上限先收最老的)
    this.pendingRagdolls = [] // 部件图还没全到的布娃娃
    this.spawnedChunks = new Set() // 放过道具 / 物品的 chunk(只放一次)
    this.liveChunks = new Set()    // 当前有怪在世界里的 chunk(卸载时清)
    this.pendingImages = new Map()
    this.stats = { spawned: 0, skipped: {}, killed: 0, bodies: 0, broken: 0 }
    this.time = 0
    this._solid = this._solid.bind(this)
    this._solidB = this._solidB.bind(this)
    this._liqDensity = (x, y) => { const m = this.matAt(x, y); return m > 0 && this.mats.kind[m] === 'liquid' ? (this.mats.list[m]?.density ?? 3) : 0 }
  }

  async init() {
    this.defs = await (await fetch(`${this.res}/entities.json`)).json()
    // 道具爆炸用的爆炸精灵借投射物的(explosion_032 = rocket 的那张)
    if (this.projectiles?.load) await this.projectiles.load(['rocket', 'grenade']).catch(() => {})
    return this
  }

  _img(name) {
    if (!name) return null
    if (this.images.has(name)) return this.images.get(name)
    if (!this.pendingImages.has(name)) {
      this.pendingImages.set(name, this.decodePng(`${this.res}/ent/${name}`).then((p) => { this.images.set(name, p); this.pendingImages.delete(name); return p }).catch(() => { this.images.set(name, null); this.pendingImages.delete(name) }))
    }
    return null
  }

  /**
   * streamer 里某 chunk 就位 → 把它的生成点实例化。道具 / 物品 / 圣山特殊物只在第一次就位时放(spawnedChunks,睡着的刚体已写进 chunk.mat,重放会重复);
   * 怪 / 虫跟着区块走(liveChunks):区块被 LRU 卸载时 unloadChunk 收掉里面的怪,回来时按生成表重刷 —— 和原版"卸载区块不存活物"一致。
   */
  spawnChunk(entry) {
    if (!entry?.ready || !entry.spawns || this.liveChunks.has(entry.key)) return
    const first = !this.spawnedChunks.has(entry.key)
    this.spawnedChunks.add(entry.key); this.liveChunks.add(entry.key)
    // spawn_lamp 掷出来的灯笼是真道具(g_lamp:physics/lantern_small 等,见 scenes.js LAMP.ent):按标记点放成刚体,钉在最近的墙上,能打下来 / 碎 / 漏油;
    // lights 表带 64px 边距会在相邻 chunk 里重复出现,只在标记点落在本 chunk 里时放一次
    if (first && entry.lights) {
      const x0 = (entry.cx - WCX) * CHUNK, y0 = (entry.cy - WCY) * CHUNK
      for (const l of entry.lights) {
        if (!l.ent || l.x < x0 || l.x >= x0 + CHUNK || l.y < y0 || l.y >= y0 + CHUNK) continue
        const d = this.defs[l.ent]
        if (!d?.shape?.image) continue
        this._img(d.shape.image); if (d.sprite?.image) this._img(d.sprite.image)
        if (this._isMulti(d)) for (const s of d.shapes) this._img(s.image)
        this.pendingProps.push({ name: l.ent, d, x: l.x + (d.body?.rootOffX || 0), y: l.y + (d.body?.rootOffY || 0) })
      }
    }
    for (const s of entry.spawns) {
      const d = this.defs[s.entity]
      const creature = d && (d.worm && d.parts?.length || d.kind === 'creature')
      if (!creature && !first) continue
      if (/^wand_/.test(s.entity)) { this.hooks.spawnWand?.(s.entity, s.x, s.y); continue } // 法杖:交给 WandSystem 造,再当物品放回来
      // 圣山的特殊物:商店货 / 特权 / 传送门(temple_altar.lua),由 noitaPlay 按各自 lua 掷
      if (s.entity === 'shop_item' || s.entity === 'shop_wand' || s.entity === 'perks' || s.entity === 'portal' || s.entity === 'shop_area' || s.entity === 'areacheck' || s.entity === 'workshop_exit') { this.hooks.spawnSpecial?.(s); continue }
      if (!d) { this.stats.skipped[s.entity] = (this.stats.skipped[s.entity] || 0) + 1; continue }
      if (d.kind === 'prop' && d.shape?.image) {
        // 像素刚体:形状图到了再建(见 update 里的 pendingProps)
        this._img(d.shape.image)
        if (d.sprite?.image) this._img(d.sprite.image) // 皮肤图(灯笼火苗)不请求的话 pendingProps 永远等不到 → 矿里的灯笼一直没出来过
        if (this._isMulti(d)) for (const sh of d.shapes) this._img(sh.image)
        this.pendingProps.push({ name: s.entity, d, x: s.x, y: s.y })
        continue
      }
      if (d.kind === 'item') { this.spawnItem(s.entity, s.x, s.y); continue }
      if (d.worm && d.parts?.length) { for (const p of d.parts) this._img(p.image); this.worms.push(this._makeWorm(s.entity, d, s.x, s.y)); this.stats.spawned++; continue }
      if (d.kind !== 'creature' || !d.sprite?.image || !d.platforming || !d.character) { this.stats.skipped[s.entity] = (this.stats.skipped[s.entity] || 0) + 1; continue }
      this._preload(d)
      const e = this._make(s.entity, d, s.x, s.y)
      this._settle(e)
      if (e.dead) continue // 生成点在我们的地形里是实心的,放不下
      this.list.push(e)
      this.stats.spawned++
    }
    // 安全上限:超了先删离玩家最远的(正常情况下 unloadChunk 已把卸载区块的怪收走,到不了这里)
    if (this.list.length > 600) {
      const p = this.player
      this.list.sort((a, b) => (Math.abs(a.x - p.x) + Math.abs(a.y - p.y)) - (Math.abs(b.x - p.x) + Math.abs(b.y - p.y)))
      this.list.length = 600
    }
  }

  /**
   * 区块被卸载:收掉落在这块里的怪 / 虫,下次这块回来 spawnChunk 会重刷怪;
   * 刚体(道具 / 尸块 / 崩塌块)也收 —— 原版的 b2body 是 camera bound 的,离相机远了就销毁(on_death_really_leave_body 那条注释说的就是这事),
   * 不收的话走过的每个区块的灯笼 / 尸块全攒在 bodies 里,几百个之后每帧白跑一遍。睡进格子的像素本来就在 chunk.mat 里(灯笼变成一堆钉在墙上的像素),
   * 醒着 / 冻着的散掉。物品(金块 / 药水 / 心 / 箔子)留着 —— 玩家走开再回来东西还得在(道具只在第一次就位时放,回来不会补)
   */
  unloadChunk(entry) {
    this.liveChunks.delete(entry.key)
    const x0 = (entry.cx - WCX) * CHUNK, y0 = (entry.cy - WCY) * CHUNK
    const inside = (e) => e.x >= x0 && e.x < x0 + CHUNK && e.y >= y0 && e.y < y0 + CHUNK
    for (let i = this.list.length - 1; i >= 0; i--) if (inside(this.list[i])) this.list.splice(i, 1)
    for (let i = this.worms.length - 1; i >= 0; i--) if (inside(this.worms[i])) this.worms.splice(i, 1)
    for (const b of this.bodies) if (!b.dead && !b.isItem && !b.nailed && inside(b)) { b.dead = true; this.stats.evicted = (this.stats.evicted || 0) + 1 }
  }

  /**
   * 尸块到期(睡够 8s / 超出上限):干的、歇下的写成肉像素留在世界里(原版尸体最后也就是一堆 meat),泡在水里 / 还在动的直接散掉;
   * 上限 MAX_RAGDOLL_PARTS(≈8 具):原版靠 C++ Box2D 扛几十具挤在一起,我们手机上 60 块 600 对接触就 4~5ms,超了先收最老的、睡着的
   */
  _expireRagdollPart(b) {
    if (b.dead) return
    if (b.asleep && b.floatSleep) { this._reclaimPixels(b); b.dead = true; return } // 漂着睡的收回像素
    if (!b.asleep && (b.wetF || 0) < 0.3 && (!b.pb || !b.pb.isAwake())) b.sleep(this.sim) // 干的、歇下的留肉像素
    b.dead = true
  }
  /** 把睡着的刚体像素从格子收回但不连累多体兄弟(wake 会把整具叫醒;到期收尸只想拿走自己那块) */
  _reclaimPixels(b) { const M = b.multi; b.multi = null; b.wake(this.sim); b.multi = M }
  _capRagdolls(extra) {
    const live = this.bodies.filter((b) => b.isRagdoll && !b.dead)
    let over = live.length + extra - MAX_RAGDOLL_PARTS
    if (over <= 0) return
    const resting = (b) => b.asleep || (b.pb && !b.pb.isAwake())
    live.sort((a, b) => (resting(b) - resting(a)) || (a.born - b.born))
    for (const b of live) { if (over-- <= 0) break; this._expireRagdollPart(b) }
  }

  /** 一只怪要用到的全部贴图先排队解码(主精灵 / PhysicsAI 本体图 / lukki 的腿与叠层) */
  _preload(d) {
    this._img(d.sprite.image)
    if (d.bodyImage) this._img(d.bodyImage)
    if (d.overlays) for (const o of d.overlays) this._img(o.image)
    if (d.limbs) for (const L of d.limbs) { if (L.a) this._img(L.a.img); if (L.b) this._img(L.b.img); if (L.knee) this._img(L.knee.img) }
    if (d.tentacles) for (const T of d.tentacles) for (const p of T.pieces) this._img(p.img)
    if (d.ragdoll) for (const img of d.ragdoll) this._img(img) // 尸体部件图提前要,死的那一刻整具一起出来
  }

  /** 直接放一只怪(巢吐虫 / 蜘蛛卵出小蜘蛛 / 探针用) */
  spawnCreature(name, x, y) {
    const d = this.defs[name]
    if (!d?.sprite?.image || !d.platforming || !d.character) return null
    this._preload(d)
    const e = this._make(name, d, x, y)
    this._settle(e)
    if (e.dead) return null
    this.list.push(e); this.stats.spawned++
    return e
  }

  /**
   * 物品(药水 / 宝箱 / 心 / 法术刷新 / 金块):有形状图用形状图,没有就用精灵图当形状;药水按 potion.lua 掷内容
   * @param {object} [extra]  {potion:{mat,left}} 已有内容(扔出去的药水)/ vx,vy 初速
   */
  spawnItem(name, x, y, extra = {}) {
    const d = this.defs[name]
    if (!d) return null
    const image = d.shape?.image || d.sprite?.image
    if (!image) return null
    this._img(image)
    if (d.sprite?.image && d.sprite.image !== image) this._img(d.sprite.image)
    const p = { name, d, x, y, item: true, vx: extra.vx || 0, vy: extra.vy || 0, w: extra.w || 0, pickCool: extra.pickCool || 0, nailed: name === 'perk_reroll' } // 重掷机是固定在地上的机器
    const gv = /^goldnugget_(\d+)$/.exec(name); if (gv) p.gold = +gv[1] // VariableStorage gold_value
    if (name === 'potion') p.potion = extra.potion || this._rollPotion(x, y)
    this.pendingProps.push(p)
    return p
  }

  /** potion.lua init():SetRandomSeed(x,y);Random(0,100)≤75 → 魔法液体(极小概率回血/净化粉/虚弱),否则 standard 表 */
  _rollPotion(x, y) {
    const prng = new NollaPrng(0); prng.SetRandomSeed(this.seed, Math.floor(x), Math.floor(y))
    const R = (a, b) => prng.Random(a, b)
    const MAGIC = ['magic_liquid_unstable_teleportation', 'magic_liquid_polymorph', 'magic_liquid_random_polymorph', 'magic_liquid_berserk', 'magic_liquid_charm', 'magic_liquid_invisibility', 'magic_liquid_movement_faster', 'magic_liquid_faster_levitation', 'magic_liquid_worm_attractor', 'magic_liquid_protection_all', 'magic_liquid_mana_regeneration']
    const STD = ['lava', 'water', 'blood', 'alcohol', 'oil', 'slime', 'acid', 'radioactive_liquid', 'gunpowder_unstable', 'liquid_fire', 'blood_cold']
    let mat
    if (R(0, 100) <= 75) {
      if (R(0, 100000) <= 50) mat = 'magic_liquid_hp_regeneration'
      else if (R(200, 100000) <= 250) mat = 'purifying_powder'
      else if (R(250, 100000) <= 500) mat = 'magic_liquid_weakness'
      else mat = MAGIC[R(1, MAGIC.length) - 1]
    } else mat = STD[R(1, STD.length) - 1]
    if (!this.mats.byName.has(mat)) mat = 'water'
    return { mat, left: 1000 }
  }

  /** 扔药水(PhysicsThrowable:max_throw_speed 180):从手里飞出去,砸到东西就碎 */
  throwItem(name, x, y, vx, vy, extra) { return this.spawnItem(name, x, y, { ...extra, vx, vy, w: (Math.random() - 0.5) * 10, pickCool: 0.6, thrown: true }) }

  /**
   * 宝箱(chest_random.lua drop_random_reward 主干):7% 小炸弹 · 33% 金 · 10% 药水 · 4% 法术刷新 · 6% 杂项(先给药水)· 5% 法术卡(先给金)·
   * 19% 法杖 · 11% 心 · 3% 整箱变金 · 2% 骰子(再掷 2~3 次)
   */
  openChest(b) {
    const x = b.x, y = b.y
    const R = (a, c) => a + Math.floor(Math.random() * (c - a + 1))
    const gold = (name, v, n = 1) => { for (let i = 0; i < n; i++) { this._img(this.defs[name].shape.image); this.pendingProps.push({ name, d: this.defs[name], x: x + R(-10, 10), y: y - 4 + R(-10, 5), vx: R(-40, 40), vy: -R(40, 90), item: true, gold: v, pickCool: 0.5 }) } }
    let count = 1
    while (count-- > 0) {
      const rnd = R(1, 100)
      if (rnd <= 7) { this.projectiles?.spawn?.('bomb_small', x, y - 6, -Math.PI / 2, {}) }
      else if (rnd <= 40) {
        let amount = 5; const r1 = R(0, 100); if (r1 <= 80) amount = 7; else if (r1 <= 95) amount = 10; else amount = 20
        const r2 = R(0, 100)
        if (r2 > 30 && r2 <= 80) gold('goldnugget_50', 50)
        else if (r2 <= 95) gold('goldnugget_200', 200)
        else if (r2 <= 99) gold('goldnugget_1000', 1000)
        else { gold('goldnugget_50', 50, R(1, 3)); if (R(0, 100) > 50) gold('goldnugget_200', 200, R(1, 3)); if (R(0, 100) > 80) gold('goldnugget_1000', 1000, R(1, 3)) }
        gold('goldnugget_10', 10, amount)
      } else if (rnd <= 50) this.spawnItem('potion', x + R(-10, 10), y - 6, { vy: -60, pickCool: 0.5 })
      else if (rnd <= 54) this.spawnItem('spell_refresh', x + R(-10, 10), y - 6, { vy: -60, pickCool: 0.5 })
      else if (rnd <= 60) this.spawnItem('potion', x, y - 10, { vy: -60, pickCool: 0.5 })
      else if (rnd <= 65) gold('goldnugget_10', 10, R(1, 5))
      else if (rnd <= 84) this.hooks.spawnWand?.('wand_level_01', x, y - 8)
      else if (rnd <= 95) this.spawnItem('heart', x + R(-10, 10), y - 6, { vy: -60, pickCool: 0.5 })
      else if (rnd <= 98) gold('goldnugget_50', 50, 6)
      else if (rnd <= 99) count += 2
      else count += 3
    }
    this.hooks.sfx?.('magic', { vol: 0.6, rate: 0.8 })
  }

  /** 世界里的法杖(物品):法杖图当形状,碰到玩家捡起(pickup 钩子拿到 b.wand);shop = {cost, sale} 是商店货 */
  spawnWandItem(imageName, x, y, wand, shop = null) {
    this._img(imageName)
    this.pendingProps.push({ name: 'wand', d: { kind: 'prop', shape: { image: imageName, material: 'wood_prop' }, body: { friction: 0.7, restitution: 0.05, linear_damping: 0.2, angular_damping: 0.5 } }, x, y, item: true, wand, shop })
  }

  /** 圣山特权(perk_spawn):图标当形状摆在祭坛上,碰到即拿;同一祭坛的其余几个由 pickup 钩子撤掉(killOthers) */
  spawnPerkItem(iconName, x, y, perkId, group) {
    this._img(iconName)
    this.pendingProps.push({ name: 'perk', d: { kind: 'prop', shape: { image: iconName, material: 'wood_prop' }, body: {} }, x, y, item: true, perk: perkId, group, nailed: true })
  }
  /** 撤掉同组(同一祭坛)其他还没拿的特权 */
  killGroup(group, except) { for (const b of this.bodies) if (b.group === group && b !== except) b.dead = true }

  /** 商店里的法术卡(CreateItemActionEntity):卡图当形状,碰到 = 买(pickup 钩子看 b.shop.cost 够不够钱) */
  spawnSpellItem(iconName, x, y, shop, spell = shop?.spell || null, extra = {}) {
    this._img(iconName)
    this.pendingProps.push({ name: 'spell_card', d: { kind: 'prop', shape: { image: iconName, material: 'wood_prop' }, body: { friction: 0.8, restitution: 0.02, linear_damping: 0.3, angular_damping: 0.8 } }, x, y, item: true, shop, spell, nailed: !!shop, ...extra })
  }

  /**
   * 工具箱(utility_box.lua drop_random_reward):Random(1,100) ≤2 小炸弹 · ≤5 法术刷新 · ≤11 杂项(先给药水)· ≤97 抽 2~6 张 UTILITY / MODIFIER 卡(make_random_utility_card)· ≤99 再掷两次 · 100 再掷三次
   */
  openUtilityBox(b) {
    const x = b.x, y = b.y
    const R = (a, c) => a + Math.floor(Math.random() * (c - a + 1))
    let count = 1
    while (count-- > 0) {
      const rnd = R(1, 100)
      if (rnd <= 2) this.projectiles?.spawn?.('bomb_small', x, y - 6, -Math.PI / 2, {})
      else if (rnd <= 5) this.spawnItem('spell_refresh', x + R(-10, 10), y - 6, { vy: -60, pickCool: 0.5 })
      else if (rnd <= 11) this.spawnItem('potion', x, y - 10, { vy: -60, pickCool: 0.5 })
      else if (rnd <= 97) {
        const r2 = R(0, 100), amount = r2 <= 40 ? 2 : r2 <= 60 ? 3 : r2 <= 77 ? 4 : r2 <= 90 ? 5 : 6
        for (let i = 1; i <= amount; i++) {
          const card = this.hooks.utilityCard?.()
          if (card?.icon) this.spawnSpellItem(card.icon, x + (i - amount / 2) * 8, y - 4 + R(-5, 5), null, card.id, { vx: (i - amount / 2) * 12, vy: -50 - R(0, 30), pickCool: 0.6 })
        }
      } else if (rnd <= 99) count += 2
      else count += 3
    }
    this.hooks.sfx?.('magic', { vol: 0.6, rate: 0.9 })
  }

  /** 直接放一个道具(调试 / 布景脚本用) */
  spawnProp(name, x, y) {
    const d = this.defs[name]
    if (!d?.shape?.image) return null
    this._img(d.shape.image)
    if (d.sprite?.image) this._img(d.sprite.image) // 有皮肤图(灯笼的火苗)也得先到,不然 pendingProps 一直等
    if (this._isMulti(d)) for (const s of d.shapes) this._img(s.image)
    const p = { name, d, x, y }
    this.pendingProps.push(p)
    return p
  }

  _shapeImage(d) { return d.shape?.image || d.sprite?.image || null }
  /**
   * 走 Box2D 多体路径的道具(第 29 条 ④):有关节的 / 多张形状图的(矿车 / 木车 / 滑板 / 轮架 / 物理蘑菇 / 家具 / 钉墙轮 / 齿轮门)。
   * 单张图 + ATTACH_TO_NEARBY_SURFACE(小灯笼 lantern_small)暂仍走 ropes(它有找墙 / 挂直 / 像素掉了就断的一套细节);chain_to_ceiling 的吊链也是 ropes
   */
  _isMulti(d) {
    if (!this.physics || !d.shapes?.length) return false
    if (d.chains) return false // chain_to_ceiling 的吊链是 verlet 绳(原版也不是 Box2D 体),仍走 ropes
    return d.shapes.length > 1 || (d.joints?.length > 0)
  }
  _shapesReady(d) { return !this._isMulti(d) || d.shapes.every((s) => this.images.has(s.image)) }

  /**
   * LooseGroundComponent 的一块:从世界里抠出一团地面(mask 由调用方给,1 = 该格属于这块),变成 chunk_material 的像素刚体落下来。
   * 像素色 = 该格原材质色(抠出来的砖还是砖的花色),材质(睡着写回世界 / 可挖 / 可炸)= matName。
   * @param {Uint8Array} mask  w×h,0/1
   * @param {Uint32Array|number[]} colors  w×h 原材质 rgb(0 = 取材质基色)
   */
  spawnLooseChunk(x, y, w, h, mask, colors, matName = 'concrete_collapsed') {
    const matId = this.mats.byName.get(matName); if (!(matId > 0)) return null
    const base = this.mats.color[matId]
    const data = new Uint8ClampedArray(w * h * 4)
    let n = 0
    for (let i = 0; i < w * h; i++) {
      if (!mask[i]) continue
      const c = colors?.[i] || base, jt = 0.9 + ((i * 7919) % 23) / 115
      data[i * 4] = Math.min(255, ((c >> 16) & 255) * jt); data[i * 4 + 1] = Math.min(255, ((c >> 8) & 255) * jt); data[i * 4 + 2] = Math.min(255, (c & 255) * jt); data[i * 4 + 3] = 255; n++
    }
    if (n < 4) return null
    const d = { kind: 'prop', shape: { material: matName }, body: { friction: 0.7, restitution: 0.05, linear_damping: 0.1, angular_damping: 0.3 } }
    const b = new RigidBody(d, { width: w, height: h, data }, x, y, matId)
    b.name = 'loose_chunk'; b.isBody = true; b.density = this.mats.list[matId]?.density ?? 10; b.life = Infinity
    this.bodies.push(b); this.stats.bodies++
    return b
  }

  /**
   * 没有形状图、只有带动画的精灵表的道具(heart / heart_fullhp / spell_refresh:原版是 SimplePhysics + SpriteComponent 播帧):
   * 形状用第一帧(不然整张 4 帧的表都当成实体,地上躺着"四颗心连成一排"),显示按帧播
   */
  _spriteFrames(d) {
    const sp = d.sprite, an = sp?.anims?.[sp.def || 'default']
    const sheet = this.images.get(sp?.image)
    if (!an?.fw || !sheet?.image) return null
    const key = `${sp.image}#${sp.def || 'default'}`
    let fr = this._frameCache?.get(key)
    if (fr) return fr
    const n = Math.max(1, an.frames || 1), per = an.perRow || n, frames = []
    let png = null
    for (let i = 0; i < n; i++) {
      const sx = an.x + (i % per) * an.fw, sy = an.y + Math.floor(i / per) * an.fh
      const cv = new OffscreenCanvas(an.fw, an.fh), c = cv.getContext('2d')
      c.drawImage(sheet.image, sx, sy, an.fw, an.fh, 0, 0, an.fw, an.fh)
      frames.push(cv)
      if (i === 0) png = { width: an.fw, height: an.fh, data: c.getImageData(0, 0, an.fw, an.fh).data }
    }
    fr = { png, frames, wait: an.wait || 0.12 }
    ;(this._frameCache ||= new Map()).set(key, fr)
    return fr
  }

  _makeBody(p) {
    const fr = !p.d.shape && p.d.sprite?.anims ? this._spriteFrames(p.d) : null
    const png = fr ? fr.png : this.images.get(this._shapeImage(p.d))
    if (!png?.data) return null
    const matId = this.mats.byName.get(p.d.shape?.material || '') ?? this.mats.byName.get('wood_prop')
    const b = new RigidBody(p.d, png, p.x, p.y, matId)
    b.name = p.name; b.isBody = true
    b.density = this.mats.list[matId]?.density ?? 6
    b.gravScale = this.mats.list[matId]?.solidGravityScale || 1 // materials.xml solid_gravity_scale(glass_box2d 1.3:灯笼掉得比木箱快,砸地更容易过 120 的碎裂阈值)
    if (this.mats.list[matId]?.normalMapped) b.baseColor = this.mats.color[matId] // 金块 / 宝石:png 是法线图,按材质色打光
    b.vx = p.vx || 0; b.vy = p.vy || 0; b.w = p.w || 0
    b.isItem = !!p.item; b.gold = p.gold || 0; b.isRagdoll = !!p.ragdoll; b.wand = p.wand || null; b.shop = p.shop || null; b.spell = p.spell || null
    b.pickCool = p.pickCool || 0; b.thrown = !!p.thrown
    if (p.nailed) { b.nailed = true; b.motor = 0 } // 货架上的法术卡 / 祭坛上的特权:摆着不动(原版是 ItemComponent 挂着,不是刚体)
    b.perk = p.perk || null; b.group = p.group || null
    this._attachRopes(b, p.d)
    b.life = p.d.lifetime && !(this.goldForever && p.gold) ? p.d.lifetime / 60 : Infinity // 特权 GOLD_IS_FOREVER:金块不消失
    // 药水:内容 + 瓶子按液体色染(PotionComponent 的着色)
    if (p.potion) {
      b.potion = p.potion
      b.inventory = [{ m: p.potion.mat, left: p.potion.left }]
      const sp = p.d.sprite?.image ? this.images.get(p.d.sprite.image) : null
      if (sp?.image) {
        const cv = new OffscreenCanvas(sp.width, sp.height), c = cv.getContext('2d')
        c.drawImage(sp.image, 0, 0)
        const m = this.mats.byName.get(p.potion.mat), col = m ? this.mats.color[m] : 0x4080ff
        c.globalCompositeOperation = 'source-atop'
        c.fillStyle = `rgba(${(col >> 16) & 255},${(col >> 8) & 255},${col & 255},0.7)`; c.fillRect(0, Math.floor(sp.height * 0.35), sp.width, sp.height)
        b.skin = cv
      }
    } else if (fr) { b.frames = fr.frames; b.animWait = fr.wait; b.skin = fr.frames[0]; b.fixedRot = true } // SimplePhysics 的东西不打滚
    else if (p.d.sprite?.image && p.d.sprite.image !== this._shapeImage(p.d)) {
      // 形状图之外还有精灵(灯笼的火苗 lantern_small_flame.xml:19 帧 9×13 的表,z_index −1 = 画在玻璃壳前面):按帧播,和形状图同心叠着画;单张图的直接当皮
      const fr = p.d.sprite.anims && Object.keys(p.d.sprite.anims).length ? this._spriteFrames(p.d) : null
      if (fr && fr.frames.length > 1) { b.over = fr.frames; b.animWait = fr.wait }
      else { const sp = this.images.get(p.d.sprite.image); if (sp?.image) b.skin = fr ? fr.frames[0] : sp.image }
    }
    this.stats.bodies++
    return b
  }

  /**
   * Box2D 多体道具(第 29 条 ④):每个 body_id 一个 RigidBody(各自的形状图 / 材质 / planck body),关节按 xml 建在 planck 里。
   * 老式(矿车 / 木车 / 滑板 / 轮架 / 齿轮门):几张图同一画布、centered,pos_x/pos_y 是图内像素坐标 → 世界锚点 = 实体位置 + (pos − 画布中心);nail_to_wall = 钉在地上
   * 新式(props/physics/minecart / 蘑菇 / 家具):PhysicsImageShape 各带 offset(centered → 图心在实体 + offset;否则左上角在实体 + offset),Joint2 offset 是实体坐标;
   *   REVOLUTE_ATTACH_TO_NEARBY_SURFACE 从锚点沿 ray 找第一格实心钉到地上(蘑菇的脚 ray (0,30));找不到就不钉(原版一样倒)
   * 整组共用 multi:{parts, joints};睡 / 醒 / 支撑按整组算(见 _updateBodies)
   */
  _makeMultiBody(p) {
    const d = p.d, PH = this.physics
    // 碰撞组:每个多体实体一个负组(部件互不碰);物理蘑菇全体共用 -1 —— 真菌洞里长得密、彼此挨着,在摆的会通过接触把整片邻居一直叫醒(Box2D 同一岛同醒),植物之间重叠也无妨
    const isFungus = d.scripts?.some((s) => s.endsWith('physics_fungus'))
    if (this._multiSeq === undefined) this._multiSeq = 1
    const M = { parts: [], joints: [], name: p.name, age: 0, group: isFungus ? -1 : -(++this._multiSeq) }
    const byId = new Map()
    const bodyOf = (id) => d.bodies?.find((b) => b.uid === id)
    // 调用方给的 (p.x, p.y) 是"图心"(和单图道具一致:spawnChunk 的灯按标记 + root_offset 放),实体原点 = 图心 − root_offset(lantern_small 5,7;矿车 0,0);
    // 形状 / 关节坐标系再减 PhysicsBody2 init_offset(蘑菇 40 / 小蘑菇 28:整株上移,脚落在地面标记上)
    const ox = p.x - (d.body?.rootOffX || 0) - (d.body?.initOffX || 0), oy = p.y - (d.body?.rootOffY || 0) - (d.body?.initOffY || 0)
    // 老式多体几张图共用一张画布:画布左上角由根图定 —— centered=1(矿车 / 轮架)画布中心在实体,centered=0(挖掘场机械机身,场景标记 −5 处放左上角)左上角在实体;
    // 轮子图哪怕写着 centered=1 也画在同一张画布里(机械 3b 三个轮子的包围盒中心正好落在关节 pos 上),关节 pos_x/pos_y 就是画布像素
    const oldStyle = (d.joints || []).some((j) => j.kind === 'old')
    let cvX = ox, cvY = oy
    if (oldStyle) {
      const rs = d.shapes.find((s) => s.isRoot) || d.shapes[0], rp = this.images.get(rs.image)
      if (rs.centered && rp) { cvX = ox - rp.width / 2; cvY = oy - rp.height / 2 }
    }
    for (const s of d.shapes) {
      const png = this.images.get(s.image)
      if (!png?.data || byId.has(s.bodyId)) continue
      const cx = oldStyle ? cvX + png.width / 2 : s.centered ? ox + s.offX : ox + s.offX + png.width / 2
      const cy = oldStyle ? cvY + png.height / 2 : s.centered ? oy + s.offY : oy + s.offY + png.height / 2
      const matId = this.mats.byName.get(s.material || '') ?? this.mats.byName.get('wood_prop')
      const b = new RigidBody(d, png, cx, cy, matId)
      b.name = p.name; b.isBody = true; b.multi = M; b.partId = s.bodyId; b.isCircle = s.isCircle; b.z = s.z; b.filterGroup = M.group
      b.density = this.mats.list[matId]?.density ?? 6
      b.gravScale = this.mats.list[matId]?.solidGravityScale || 1
      if (this.mats.list[matId]?.normalMapped) b.baseColor = this.mats.color[matId]
      const bd = bodyOf(s.bodyId) || d.body || {}
      b.linDamp = bd.linear_damping ?? 0; b.angDamp = bd.angular_damping ?? 0; b.fixedRot = !!bd.fixed_rotation
      // is_static(挖掘场机械 excavationsite_machine_3b/3c 的机身):Box2D 静态体,钉死在原地,轮子靠电机关节在上面转;整组不写格子(机身写进格子轮子就跟地形卡上了)
      b.isStatic = !!bd.is_static; if (b.isStatic) M.hasStatic = true
      b.canvasW = png.width; b.canvasH = png.height
      byId.set(s.bodyId, b); M.parts.push(b)
    }
    if (!M.parts.length) return null
    // 根部件(is_root,没标的取第一张图 = 老式的 uid 1):血 / 爆炸 / 库存记在它身上
    M.root = M.parts.find((b) => d.shapes.find((s) => s.bodyId === b.partId)?.isRoot) || M.parts[0]
    for (const b of M.parts) if (b !== M.root) { b.inventory = null; b.light = null } // 油桶那种"装东西 / 带光"的只算根一次
    // 根部件的精灵叠层 / 皮肤(和 _makeBody 一样:灯笼的火苗 lantern_small_flame.xml 19 帧按帧播,单张图当皮)
    if (d.sprite?.image && d.sprite.image !== d.shape?.image) {
      const fr = d.sprite.anims && Object.keys(d.sprite.anims).length ? this._spriteFrames(d) : null
      if (fr && fr.frames.length > 1) { M.root.over = fr.frames; M.root.animWait = fr.wait }
      else { const sp = this.images.get(d.sprite.image); if (sp?.image) M.root.skin = fr ? fr.frames[0] : sp.image }
    }
    // 画的顺序:z 大的先画(Noita z 越小越靠前,轮子 z=-1 画在车身前面)
    M.parts.sort((a, b) => b.z - a.z)
    for (const b of M.parts) { PH.attach(b); this.bodies.push(b); this.stats.bodies++ }
    for (const j of d.joints || []) {
      const A = byId.get(j.body1), B = byId.get(j.body2)
      if (!A) continue
      let ax, ay
      if (j.kind === 'old') { ax = cvX + j.px; ay = cvY + j.py } else { ax = ox + j.ox; ay = oy + j.oy }
      let toGround = j.kind === 'old' ? (j.nail || !B) : !B
      let anchorCell = null // 钉地关节钉在哪一格实心上:那格被挖 / 炸掉关节就断(老 ropes 的规则;PhysicsJoint grid_joint 也是这个意思)
      if (j.kind === 'new' && /ATTACH/.test(j.type)) {
        // 沿 ray 找地面:锚点挪到第一格实心(往回退 surface_attachment_offset_y);射线上没有就在锚点 12px 内找最近的实心(灯的标记点不一定正贴天花板);都没有就不钉(原版一样掉)
        const len = Math.hypot(j.rayX, j.rayY) || 10, dx = j.rayX / len, dy = j.rayY / len
        let hit = null
        for (let t = 0; t <= len; t++) { const x = Math.floor(ax + dx * t), y = Math.floor(ay + dy * t); if (this._solidB(x, y)) { anchorCell = [x, y]; hit = [ax + dx * Math.max(0, t - j.surfOffY), ay + dy * Math.max(0, t - j.surfOffY)]; break } }
        if (!hit) {
          let bd = Infinity
          for (let ry = -12; ry <= 12; ry++) for (let rx = -12; rx <= 12; rx++) { const dd = rx * rx + ry * ry; if (dd >= bd || dd > 144) continue; const x = Math.floor(ax) + rx, y = Math.floor(ay) + ry; if (this._solidB(x, y)) { bd = dd; anchorCell = [x, y]; hit = [x + 0.5, y + 0.5] } }
        }
        if (!hit) continue
        ax = hit[0]; ay = hit[1]; toGround = true
      } else if (toGround && this._solidB(Math.floor(ax), Math.floor(ay))) anchorCell = [Math.floor(ax), Math.floor(ay)]
      // 单件吊在地上(灯笼):平移到锚点正下方挂直再建关节,不然钩子偏一点就当钟摆晃几分钟(角阻尼 0.01),几十盏灯永远醒着
      if (toGround && M.parts.length === 1 && !j.motor && !/WELD/.test(j.type)) { const lx = ax - A.x; if (Math.abs(lx) > 0.01 && Math.abs(lx) < 8) { A.x += lx; PH.pushToPhysics(A) } }
      const other = toGround ? null : B
      const pj = /WELD/.test(j.type) ? PH.weld(A, other, ax, ay) : PH.revolute(A, other, ax, ay, { motor: j.motor, motorTorque: j.motorTorque })
      if (!pj) continue
      // break_distance 是 Box2D 米(1.4142 m = 8.5px;蘑菇 5 → 30px、脚 8 → 48px):按像素算的话矿车落地那一下就断了
      // break_force × (mA + mB) × 160 = 断裂阈值(N)(反 exe 0x76c0af:灯笼 0.5 × 11 kg × 160 = 900 N,自重 136 N;蘑菇茎 10 × 5.4 × 160 = 8600 N)
      const breakN = j.kind === 'new' && j.breakForce > 0 ? j.breakForce * Physics.jointForceScale(A.pb, other ? other.pb : PH.ground) : 0
      M.joints.push({ j: pj, A, B: other, anchorCell, breakDist: (j.kind === 'new' ? j.breakDistance : (j.breakable ? 1.4142 : 0)) * 6, breakN, breakOnModified: !!j.breakOnModified, aliveA: A.alive, aliveB: other ? other.alive : 0 })
    }
    // physics_fungus.lua:lift 浮力 + 电机正弦摆(speed_mult = ProceduralRandomf(entity_id, 4, 0.1, 0.75))
    if (d.lift) M.lift = d.lift
    if (isFungus) { M.seed = (Math.abs(Math.floor(p.x)) * 31 + Math.abs(Math.floor(p.y))) % 1000; M.sway = 0.1 + ((M.seed * 7919) % 1000) / 1000 * 0.65 }
    this.multis ||= []
    this.multis.push(M)
    return M
  }
  /**
   * 多体组每帧:断裂检查(拉开超过 break_distance / 约束力超过 break_force × PHYSICS_JOINT_MAX_FORCE_MULTIPLIER 160 / 关节所在的块像素掉了 break_on_body_modified);
   * 死掉的部件把它的关节拆掉;physics_fungus.lua:根体每帧受 lift 浮力、各节电机速度 = sin(t + joint×0.632) × speed_mult(第 1 节反向)
   */
  _updateMultis(dt) {
    if (!this.multis) return
    const PH = this.physics
    // 摆动的名额:lua 是 is_in_camera_bounds(x,y,50) 里的全摆,真菌洞一屏十几株 80 多个部件永远醒着要 3~4ms(倒成一堆时 26ms);
    // 这里只让离相机中心最近的 MAX_SWAY 株摆,其余静止 → 入睡写格子(玩家看不出远处那几株没在晃)
    const C = this.camRect
    let swayers = null
    if (C) {
      const cx = (C.cx0 + C.cx1) / 2, cy = (C.cy0 + C.cy1) / 2
      const cands = []
      for (const M of this.multis) { const r = M.root; if (M.sway && r && !r.dead && !r.asleep && r.pb && r.x > C.cx0 - 50 && r.x < C.cx1 + 50 && r.y > C.cy0 - 50 && r.y < C.cy1 + 50) cands.push([Math.hypot(r.x - cx, r.y - cy), M]) }
      cands.sort((a, b) => a[0] - b[0])
      swayers = new Set(cands.slice(0, MAX_SWAY).map((c) => c[1]))
    }
    for (let i = this.multis.length - 1; i >= 0; i--) {
      const M = this.multis[i]
      M.age += dt
      const root = M.root
      if (root && !root.dead && !root.asleep && root.pb) {
        // lift -25 = 向上 25 N(PhysicsApplyForce 不换算,反 exe 0x836f20 / 0xd00260):蘑菇 44 kg 重 524 N,这点浮力只是让它轻一点,立着靠茎关节的刹车;wake=false 别每帧把睡着的叫醒
        if (M.lift) root.pb.applyForceToCenter({ x: 0, y: M.lift }, false)
        const inCam = swayers ? swayers.has(M) : true
        if (M.sway && inCam) {
          const t = M.age * 60 * 0.02 + M.seed * 2.721
          let n = 0
          for (const J of M.joints) { if (J.B && J.j.isMotorEnabled?.()) { n++; const spd = Math.sin(t + n * 0.632) * M.sway; J.j.setMotorSpeed(n === 1 ? -spd : spd) } }
          M.swayOn = true
        } else if (M.swayOn) { for (const J of M.joints) if (J.B && J.j.isMotorEnabled?.()) J.j.setMotorSpeed(0); M.swayOn = false }
      }
      for (let k = M.joints.length - 1; k >= 0; k--) {
        const J = M.joints[k]
        const dead = J.A.dead || !J.A.pb || (J.B && (J.B.dead || !J.B.pb))
        let broken = dead
        // 钉着的那格墙没了(被挖 / 炸 / 烧)→ 断,醒着睡着都查(灯笼睡着挂在天花板上时把天花板挖掉也得掉下来)
        if (!broken && J.anchorCell && !this._solidB(J.anchorCell[0], J.anchorCell[1])) { broken = true; if (J.A.asleep) J.A.wake(this.sim) }
        if (!broken && !J.A.asleep) {
          if (J.breakDist > 0 && PH.jointGap(J.j) > J.breakDist) broken = true
          if (J.breakN > 0 && PH.jointForce(J.j) > J.breakN) broken = true
          if (J.breakOnModified && (J.A.alive !== J.aliveA || (J.B && J.B.alive !== J.aliveB))) broken = true
          // 尸体关节钉在像素上:两边的锚点像素被打掉 / 烧掉就断
          if (J.anchorPix && (J.A.alive !== J.aliveA || J.B.alive !== J.aliveB)) { const p = J.anchorPix; if (!J.A.hasPixelNear(p[0], p[1]) || !J.B.hasPixelNear(p[2], p[3])) broken = true; else { J.aliveA = J.A.alive; J.aliveB = J.B.alive } }
        }
        if (broken) { if (!dead) PH.destroyJoint(J.j); M.joints.splice(k, 1) }
      }
      M.parts = M.parts.filter((b) => !b.dead)
      if (!M.parts.length) this.multis.splice(i, 1)
    }
  }

  /**
   * 链与钉(RigidBody.ropes):
   *   chain_to_ceiling.lua —— 每个挂点 (x+ox, y+oy) 往上找 200px 内的顶(RaytracePlatforms),够 16px 就拴一根链;链长 = 到顶的距离
   *   PhysicsJointComponent nail_to_wall —— 钉子在图的 (pos_x, pos_y)(左上为原点);钉在图心的(轮子)= 只转不动,钉在边上的(吊桶)= 绕钉子摆
   */
  _attachRopes(b, d) {
    const ropes = []
    if (d.chains) {
      for (const [ox, oy] of d.chains) {
        const x = Math.floor(b.x + ox), y0 = Math.floor(b.y + oy)
        let cy = -1
        for (let y = y0 - 1; y >= y0 - 200; y--) if (this._solid(x, y)) { cy = y; break }
        const dist = y0 - cy
        if (cy >= 0 && dist > 16) ropes.push({ ax: x + 0.5, ay: cy + 1, lx: ox, ly: oy, len: dist - 1, breakDist: 20 })
      }
    }
    if (d.joint?.nail && !b.motor) {
      const lx = d.joint.px - b.w0 / 2, ly = d.joint.py - b.h0 / 2
      if (Math.hypot(lx, ly) < 2 && !d.joint.attach) { b.nailed = true } // 钉在图心:等同轮子
      else if (d.joint.attach) {
        // PhysicsJoint2 REVOLUTE_JOINT_ATTACH_TO_NEARBY_SURFACE(矿里的小灯笼):从挂钩点找最近的实心格钉上去,挂钩到墙的距离就是"链"长;
        // 12px 内没有墙就不钉(原版一样掉下来)。break_force 0.5 很脆:拽 8px 就断;break_on_body_modified:任何像素被打掉关节就断
        const hx = b.x + lx, hy = b.y + ly
        let best = null, bd = Infinity
        for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
          const dd = dx * dx + dy * dy
          if (dd >= bd || dd > 144) continue
          if (this._solid(Math.floor(hx) + dx, Math.floor(hy) + dy)) { bd = dd; best = [Math.floor(hx) + dx + 0.5, Math.floor(hy) + dy + 0.5] }
        }
        b.nailed = false
        if (best) {
          const len = Math.max(0, Math.sqrt(bd) - 1)
          // 挂直:挂钩放到锚点正下方 len 处;钉在侧墙上的,身子还埝在墙里就横着挪开(≤6px),不然每帧被地形顶出来又被链拉回去,永远在墙上抖、永远睡不着
          const P = [0, 0]
          const overlaps = () => { for (let e = 0; e < b.edge.length; e++) { b.worldOf(b.edge[e], P); if (this._solidB(Math.floor(P[0]), Math.floor(P[1]))) return true } return false }
          b.rot = 0; b.x = best[0] - lx; b.y = best[1] + 0.5 + len - ly
          if (overlaps()) { const x0 = b.x; let ok = false; for (let k = 1; k <= 6 && !ok; k++) for (const s of [1, -1]) { b.x = x0 + s * k; if (!overlaps()) { ok = true; break } } if (!ok) b.x = x0 }
          const hx = b.x + lx, hy = b.y + ly
          ropes.push({ ax: best[0], ay: best[1], lx, ly, len: Math.max(len, Math.hypot(hx - best[0], hy - best[1])), breakDist: d.joint.breakForce > 0 && d.joint.breakForce < 1 ? 8 : 24, attach: true, breakOnModified: !!d.joint.breakOnModified })
        }
      } else { b.nailed = false; ropes.push({ ax: b.x + lx, ay: b.y + ly, lx, ly, len: 0, breakDist: d.joint.breakable ? 12 : 24 }) }
    }
    if (ropes.length) b.ropes = ropes
  }

  /**
   * 醒着刚体的空间格(32px):怪的碰撞查询 _solidC 一帧要问 7000 次"这格有没有醒着的刚体",按刚体表线性扫(矿里 50 多盏灯笼 + 尸块 = 140 个)
   * 一帧上百万次 contains,单这一项 16ms;按格子查一次只碰 0~2 个。每帧 _updateBodies 之后重建(刚体动过了)
   */
  _rebuildBodyGrid() {
    const g = this._bgrid ||= new Map()
    g.clear()
    for (const b of this.bodies) {
      if (b.dead || b.asleep) continue
      const r = b.r + 1, x0 = Math.floor((b.x - r) / 32), x1 = Math.floor((b.x + r) / 32), y0 = Math.floor((b.y - r) / 32), y1 = Math.floor((b.y + r) / 32)
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const k = ((cx & 0xffff) << 16) | (cy & 0xffff); const c = g.get(k); if (c) c.push(b); else g.set(k, [b]) }
    }
  }
  /** 醒着的刚体像素挡人(玩家碰撞 / 站上去);睡着的已经在 mat 里 */
  bodySolidAt(wx, wy) {
    const g = this._bgrid
    if (!g) { for (const b of this.bodies) if (!b.asleep && !b.dead && b.contains(wx + 0.5, wy + 0.5)) return b; return null }
    const c = g.get(((Math.floor(wx / 32) & 0xffff) << 16) | (Math.floor(wy / 32) & 0xffff))
    if (!c) return null
    for (const b of c) if (!b.asleep && !b.dead && b.contains(wx + 0.5, wy + 0.5)) return b
    return null
  }
  /** 这一格是哪个刚体的(醒着 / 睡着都算;推箱子时用:睡着的推一下就醒) */
  bodyAt(wx, wy) {
    for (const b of this.bodies) if (!b.dead && b.contains(wx + 0.5, wy + 0.5)) return b
    return null
  }

  /** 推刚体(玩家顶着走):给速度并唤醒 */
  pushBody(b, vx) {
    if (b.asleep) b.wake(this.sim)
    // 原版角色顶着箱子走,箱子大致跟着走的速度滑;太重的(矿车 / 大石头)慢一些
    const k = Math.min(1, 400 / Math.max(1, b.m))
    const want = vx * 0.8 * k
    if (Math.sign(want) === Math.sign(b.vx) ? Math.abs(b.vx) < Math.abs(want) : true) b.vx += (want - b.vx) * 0.5
    b.restT = 0
  }

  /**
   * planck 上的刚体一帧(重力 / 碰撞 / 摩擦 / 互撞都在 Box2D 里):这里只做 Box2D 没有的 —— 浮力(按淹没像素比例)和把外部改过的速度 / 位置 / 缺损写进 body;
   * 返回"有没有接触"(接触表里任一 touching)。位置 / 速度回读在 Physics.step 末尾统一做
   */
  _stepPhysBody(b, dt) {
    b.age += dt
    // 浮力走 Box2D 的力(wake=false)+ 液体里加阻尼,不改 rb 速度 —— 之前每帧改 vy 再 pushToPhysics 会 setAwake(true),泡在水里的尸块 / 箱子永远睡不着
    // (用户反馈:几具尸体挤在水坑里一直动、掉帧)
    const wetF = b.wetF = b.wetFraction(this._liqDensity)
    // 施力用平滑过的淹没比例:按边缘像素数的台阶式浮力在水面会来回跳(一个像素出水浮力少 1/N),一坑尸块互相顶着永远歇不下;低通一下起伏小得多
    const wetS = b.wetS = b.wetS === undefined ? wetF : b.wetS + (wetF - b.wetS) * 0.25
    this.physics.applyBuoyancy(b, wetS, wetS > 0 ? b.buoyFactor(this._liqDensity, b.density) : 0, BODY_GRAVITY)
    b.floatSleep = false
    this.physics.pushToPhysics(b)
    // 自己的静止计时:附近滴水 / 落沙让地形块重建,planck 拆 fixture 时会把压着的刚体叫醒,永远攒不够它的 0.5s —— 速度 ≈0 且贴着东西 0.5s 就算歇下了(写格子后就不受重建影响)
    // 阈值 1.5px/s / 0.06rad/s:一串铰链吊着浮力(蘑菇)会有 0.2~0.5px/s 的残留微抖,0.5s 内最多挪 0.75px,写格子就冻住了
    // 泡在水里的放宽到 4px/s / 0.25rad/s:浮力按边缘采样是台阶式的,漂着的东西在水面有 2~3px/s 的永久小起伏,按陆上阈值永远歇不下(浮睡把速度清零,4px/s 的一顿看不出来)
    // (阈值从沾水 15% 就放宽:露出水面一半的尸块被水里的邻居牵着晃,它一个不歇整具都睁着眼;全淹着的不放宽 —— 木箱在水底以 2.5px/s 往上浮,放宽了就在半水深停住不浮了)
    // (多体按整具算:躯干泡着、一条胳膊翘在水面上晃 2px/s,那条胳膊按陆上阈值永远歇不下,整具就永远醒着)
    const touching = this.physics.touching(b)
    const M = b.multi
    if (M && wetF > 0.15) M.wetT = this.time
    const inWater = wetF > 0.15 || (M && M.wetT !== undefined && this.time - M.wetT < 0.1)
    if (inWater) {
      // 水里:线速 <8、角速 <0.5 算歇着,但"还在往上浮"(vy < −1.5px/s,木箱从水底浮上来 2.5px/s)不算 —— 不然箱子 / 整具尸体在半水深就停住不浮了;
      // 偶尔一帧被邻居顶一下不清零,只往回扣(3 像素的小尸块转动惯量小,关节一拽角速就 0.3~0.8,按"一次超限就清零"整具永远凑不齐)
      if (Math.abs(b.vx) < 8 && b.vy > -1.5 && b.vy < 8 && Math.abs(b.w) < 0.5) b.restT += dt; else b.restT = Math.max(0, b.restT - 4 * dt)
    } else if (Math.abs(b.vx) < 1.5 && Math.abs(b.vy) < 1.5 && Math.abs(b.w) < 0.06) b.restT += dt; else b.restT = 0
    // 全埋进实心里的刚体(塌方 / 落沙压住、出生点在墙里)看不到 chain 的边会一直往下掉 —— 原版 hax_fix_going_through_ground:在地里就往上抬
    if (b.age > 0.5 && b.alive > 0 && !b.isStatic) {
      const P = [0, 0]
      let inside = 0
      for (let e = 0; e < b.edge.length; e += 2) { b.worldOf(b.edge[e], P); if (this._solidB(Math.floor(P[0]), Math.floor(P[1]))) inside++ }
      if (inside >= Math.ceil(b.edge.length / 2) * 0.9) { b.y -= 1; b.vy = Math.min(b.vy, 0); this.physics.pushToPhysics(b); b.restT = 0 }
    }
    return touching
  }

  _updateBodies(dt, x0, y0, x1, y1) {
    // 形状图到了 → 建刚体
    if (this.pendingProps.length) {
      for (let i = this.pendingProps.length - 1; i >= 0; i--) {
        const p = this.pendingProps[i]
        if (!this.images.has(this._shapeImage(p.d))) continue
        if (p.d.sprite?.image && !this.images.has(p.d.sprite.image)) continue
        if (!this._shapesReady(p.d)) continue
        this.pendingProps.splice(i, 1)
        if (this._isMulti(p.d) && !p.item && !p.ragdoll) { this._makeMultiBody(p); continue }
        const b = this._makeBody(p)
        if (b) this.bodies.push(b)
      }
    }
    if (this.pendingRagdolls.length) {
      for (let i = this.pendingRagdolls.length - 1; i >= 0; i--) {
        const r = this.pendingRagdolls[i]
        if (r.imgs.some((n) => !this.images.has(n))) continue
        this.pendingRagdolls.splice(i, 1)
        this._buildRagdoll(r)
      }
    }
    const sim = this.sim
    const pl = this.player
    const PH = this.physics
    // 物品之间互相挤开(原版金块 / 药水是 Box2D 刚体会互相碰撞、堆成一小堆;没接 Box2D 时的手工替代,不挤的话一箱金块全叠在一个点上,心和金块糊成一团)
    const items = []
    if (!PH) for (const b of this.bodies) if (b.isItem && !b.dead && !b.nailed && b.x >= x0 && b.x <= x1 && b.y >= y0 && b.y <= y1) items.push(b)
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], c = items[j]
      const dx = c.x - a.x, dy = c.y - a.y, minD = (a.w0 + c.w0) * 0.35
      if (Math.abs(dx) >= minD || Math.abs(dy) >= Math.max(a.h0, c.h0) * 0.6) continue
      const push = (minD - Math.abs(dx)) * 0.5, s = dx === 0 ? (i & 1 ? 1 : -1) : Math.sign(dx)
      if (a.asleep) a.asleep = false; if (c.asleep) c.asleep = false
      a.x -= s * push; c.x += s * push; a.vx -= s * 12; c.vx += s * 12; a.restT = 0; c.restT = 0
    }
    let restList = null
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i]
      if (b.dead) { if (b.pb) PH.detach(b); this.bodies.splice(i, 1); continue }
      if (b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1) {
        // 模拟窗口外:planck 会照样步进(world.step 不分窗口),那边没建地形块,醒着的道具会在虚空里一直掉 → 停用冻住,进窗口再启用
        if (b.pb && !b.asleep && !b.frozen) { b.frozen = true; PH.setFrozen(b, true) }
        continue
      }
      if (b.frozen) { b.frozen = false; PH.setFrozen(b, false) }
      // Box2D(planck):形状图刚体 / 物品 / 崩塌块挂到 planck 上;钉的 / 挂链的 / 布娃娃部件还走手写求解器(关节在第 ④ 步)
      if (PH && !b.pb && !b.nailed && !b.ropes && !b.group) { PH.attach(b); if (b.asleep) PH.setGridSleep(b, true) } // group = 手写求解器的布娃娃组(没 planck 时才有)
      // 像素被挖光(睡着时格子被爆炸 / 挖掘拿掉,醒来 wake() 发现全没了)的刚体:什么都不剩还挂着光和碰撞 —— 用户看到的"灯笼打掉后浮空",是一盏没有壳只剩光的空刚体在飘
      if (b.alive <= 0 || (b.destroyed > 0.6 && !b.isItem)) { this._destroyBody(b, b.x, b.y); continue }
      // 物品(金块):LifetimeComponent 到点消失;auto_pickup 碰到玩家就捡
      if (b.isItem) {
        b.life -= dt
        if (b.life <= 0) { b.dead = true; continue }
        // 金块的闪光(goldnugget_*.xml SpriteParticleEmitter shine_08:每 50~250 帧在 ±3px 内闪一颗 5×5 星,0.1~0.8s)—— 原版一眼认出是金子靠的就是这个
        if (b.gold) { b.glintT = (b.glintT ?? (50 + Math.random() * 200) / 60) - dt; if (b.glintT <= 0) { b.glintT = (50 + Math.random() * 200) / 60; this.hooks.glint?.(b.x + (Math.random() - 0.5) * 6, b.y + (Math.random() - 0.5) * 6, 0.1 + Math.random() * 0.7) } }
        if (b.pickCool > 0) b.pickCool -= dt
        else if (Math.abs(b.x - pl.x) < 7 && Math.abs(b.y - (pl.y - 1)) < (b.nailed ? 12 : 9)) { b.dead = true; this.hooks.pickup?.(b); if (b.dead) continue }
        if (b.pb) {
          // 物品在 planck 上:睡着 = Box2D 自己睡(body 留着,不写格子,金块堆互相压着);砸到东西看上一帧到这一帧的速度骤降
          b.age += dt
          b.asleep = !b.pb.isAwake()
          // planck 自己睡着的物品(现在浮力不再每帧叫醒,漂在水里的金块也会睡):定期看脚下 —— 没支撑又没泡在水里(水退了)就叫醒掉下去
          if (b.asleep) { b.checkT -= dt; if (b.checkT <= 0) { b.checkT = 0.4; if (!this.physics.touching(b) && b.wetFraction(this._liqDensity) < 0.3) b.pb.setAwake(true) } continue }
          const touching = this._stepPhysBody(b, dt)
          // 药水(potion.xml):PhysicsBodyCollisionDamageComponent speed_threshold 80、damage_multiplier 1/60,hp 0.5 → 撞击速度 >80 px/s 就碎
          // (从 44px 以上掉下来才到 80,手边掉地不碎;扔出去 180 必碎);手写求解器没有接触速度,仍看前后帧速度差
          const imp = b.pb ? b.impact : (touching && b._spPrev - Math.hypot(b.vx, b.vy) > 100 ? b._spPrev : 0); b.impact = 0
          const CDp = b.d.collisionDamage
          if (b.potion && CDp && imp > CDp.speed_threshold && imp * CDp.damage_multiplier >= (b.d.damage?.hp ?? 0.5)) { this._destroyBody(b, b.x, b.y); continue }
          continue
        }
        if (b.asleep) { b.age += dt; b.checkT -= dt; if (b.checkT <= 0) { b.checkT = 0.4; if (!b.supported(this._solidB)) b.asleep = false } continue }
        const before = Math.hypot(b.vx, b.vy)
        const touching = b.step(dt, BODY_GRAVITY, this._solidB, this._liqDensity, b.density)
        // 药水:砸到东西(速度骤降 >100)就碎,洒一地(ExplodeOnDamage explode_on_death + MaterialInventory)
        if (b.potion && touching && before > 165 && before - Math.hypot(b.vx, b.vy) > 100) { this._destroyBody(b, b.x, b.y); continue } // 扔出去(180)会碎,从手边掉下去(~140)不碎
        if (b.restT > 0.5 && b.supported(this._solidB)) { b.asleep = true; b.vx = b.vy = b.w = 0 } // 物品睡着不写进世界(捡的时候好认)
        continue
      }
      // 链的锚点被挖掉 / 炸掉 → 断链(醒着睡着都查,便宜)
      if (b.ropes) for (const r of b.ropes) if (!r.broken && !this._solid(Math.floor(r.ax), Math.floor(r.ay) - (r.attach ? 0 : 1))) { r.broken = true; if (b.asleep) b.wake(sim) }
      // 被打中的灯笼是移动的火源(fire.xml 的 set_fire):每帧往边缘像素旁的空气格放火,漏出来的油 / 落点的油跟着烧
      if (b.fireT > 0) {
        b.fireT -= dt
        const P = [0, 0], F = sim.M_FIRE
        for (let k = 0; k < 3; k++) {
          b.worldOf(b.edge[(Math.random() * b.edge.length) | 0], P)
          const fx = Math.floor(P[0]) + ((Math.random() * 3) | 0) - 1, fy = Math.floor(P[1]) + ((Math.random() * 3) | 0) - 1
          if (sim.get(fx, fy) === 0) sim.set(fx, fy, F, 8 + ((Math.random() * 10) | 0))
        }
      }
      // 尸块在 planck 里睡着(浮睡在水里 / 压在别的尸块上没格子可写)也算睡:睡够 8s 一样到期(干的写成肉像素,泡水的散掉),不然水坑里的尸体永远攒着
      if (b.isRagdoll && !b.asleep && b.pb && !b.pb.isAwake()) { b.sleptT = (b.sleptT || 0) + dt; if (b.sleptT > 8) { this._expireRagdollPart(b); continue } }
      if (b.asleep) {
        b.age += dt // 火苗这类垫底动画睡着也要走
        // 尸块睡够 8s 就"化"进世界:刚体对象撤掉,肉像素留着(原作尸体最后也就是一堆 meat);漂在水里睡的把像素收回(不留一筏子浮着的肉)
        if (b.isRagdoll) { b.sleptT = (b.sleptT || 0) + dt; if (b.sleptT > 8) { if (b.floatSleep) this._reclaimPixels(b); b.dead = true; continue } }
        // 睡着:定期清点缺损 / 支撑
        b.checkT -= dt
        if (b.checkT <= 0) {
          b.checkT = 0.4
          const lost = b.audit(sim)
          if (lost) this._bodyDamaged(b, 0, lost)
          // 布娃娃部件:关节钉在像素上,像素被烧 / 挖掉关节就断;支撑看整组(挂在躯干上的手臂自己不着地),没支撑整组醒
          if (lost && b.group) b.group.checkAnchors()
          if (!b.dead && b.group?.connected(b)) { if (!b.group.supported(this._solidB)) b.group.wakeAll(sim) }
          else if (!b.dead && b.multi) { if (!this._multiSupported(b.multi)) b.wake(sim) } // 多体:整组有一块着地 / 有钉在地上的关节就算有支撑(车身悬在轮子上不算没支撑)
          else if (!b.dead && !b.supported(this._solidB) && !(b.floatSleep && this._wetNear(b))) b.wake(sim) // 浮睡的:身边还有水就接着睡
        }
        continue
      }
      // 埋进实心太深(沙落上来 / 布景刚盖上)→ 顶出来;要在入睡前查,睡着后中心格是自己的像素。
      // 只在包围盒中心真有自己的像素时才查那一格:桌子 / 板凳的中心是两腿之间的空当,搁在斜坡上那格是地面 → 之前每帧被抬 1px 又落回去,看着就是"无外力左右晃"
      if (b.age > 1 && b.mask[(b.h0 >> 1) * b.w0 + (b.w0 >> 1)] && this._solidB(Math.floor(b.x), Math.floor(b.y))) { for (let k = 0; k < 12 && this._solidB(Math.floor(b.x), Math.floor(b.y)); k++) b.y -= 1 }
      const vyBefore = b.pb ? b._vyPrev : b.vy, spBefore = b.pb ? b._spPrev : Math.hypot(b.vx, b.vy)
      const touching = b.pb ? this._stepPhysBody(b, dt) : b.step(dt, BODY_GRAVITY, this._solidB, this._liqDensity, b.density)
      // PhysicsBodyCollisionDamageComponent:撞上东西时速度超过 speed_threshold(灯笼 120)→ 掉血 = 速度 × damage_multiplier(默认 1/60);灯笼掉下来砸地就碎、洒油、起火
      // 材质 solid_on_collision_explode(concrete_collapsed 崩塌块):砸到东西按材质的 ExplosionConfig 炸一下 —— r4~20、震镜、concrete_sand 火花,块本身留着
      // 撞击速度:planck 上用 pre-solve 记的接触法向接近速度(rb.impact),手写求解器仍看前后帧速度差
      const impact = b.pb ? b.impact : (touching ? spBefore : 0)
      if (b.pb) b.impact = 0
      if (b.collideExplode && impact > 60 && !b.exploded) {
        b.exploded = true
        const sand = this.mats.byName.get('concrete_sand')
        if (sand) for (let k = 0; k < 14; k++) this.hooks.debris?.(b.x + (Math.random() - 0.5) * b.w0, b.y + b.h0 / 2 - 1, (Math.random() - 0.5) * 120, -20 - Math.random() * 90, sand, this.mats.color[sand], true)
        this.hooks.shake?.(0.25); this.hooks.sfx?.('impact', { vol: 0.6, rate: 0.5 + Math.random() * 0.2, minGap: 60 })
      }
      const CD = b.d.collisionDamage
      const hanging = b.ropes?.some((r) => !r.broken)
      if (CD && !hanging && b.age > 0.3 && impact > CD.speed_threshold) { // 还挂着的不算(链子一拽速度会跳)
        // planck:接触接近速度就是撞击速度;手写:还要看速度确实掉了一半以上
        if (b.pb || spBefore - Math.hypot(b.vx, b.vy) > CD.speed_threshold * 0.5) { this._bodyDamaged(b, impact * CD.damage_multiplier, 0, b.x, b.y); if (b.dead) continue }
      }
      // 摔落伤害(DamageModel falling_damages:高度 70~250px 线性给 0.1~1.2 伤,矿灯 0.15 血摔一下就碎):记下开始下落的高度,落地时算落差
      const D = b.d.damage
      if (D?.falling_damages) {
        if (!touching && b.vy > 30) { if (b.fallY0 === undefined) b.fallY0 = b.y }
        else if (touching && b.fallY0 !== undefined) {
          const drop = b.y - b.fallY0
          b.fallY0 = undefined
          const h0 = D.falling_damage_height_min ?? 70, h1 = D.falling_damage_height_max ?? 250
          if (drop > h0 && vyBefore > 60) {
            const t = Math.min(1, (drop - h0) / Math.max(1, h1 - h0))
            this._bodyDamaged(b, (D.falling_damage_damage_min ?? 0.1) + t * ((D.falling_damage_damage_max ?? 1.2) - (D.falling_damage_damage_min ?? 0.1)))
            if (b.dead) continue
          }
        }
      }
      if (b.group?.connected(b)) continue // 布娃娃部件(还连着的):整组一起睡(下面);散开的块各自睡
      if (b.isStatic || b.multi?.hasStatic) continue // 静态机身的机械(挖掘场机械):一直留在 planck 里,电机轮子永远转
      // 入睡:planck 的睡眠判定(0.5s 线速 <0.03m/s 角速 <2°/s)/ 手写求解器 restT;脚下要真有格子 —— planck 上的先攒着,下面一起从低到高连锁写格子
      // 泡在液体里(淹没 >50%)漂着不动 0.5s 也算歇下:进 restList 后没支撑就"浮睡"(planck setAwake(false),水退 / 被撞再醒)
      const rest = b.pb ? (!b.pb.isAwake() || (b.restT > 0.5 && (touching || b.wetF > 0.15 || b.multi?.joints.some((J) => !J.B)))) : b.restT > 0.5 // 吊在地上的(灯笼)没接触也算歇下
      if (!rest) continue
      if (b.pb) { (restList ||= []).push(b); continue }
      if (b.supported(this._solidB)) this._gridSleep(b)
    }
    // planck 上一摞睡着的箱子是一个"岛"同时入睡:从最低的开始,脚下有格子的写进格子(写完上面那个的脚下就有格子了),一帧内整摞落定;
    // 不然只睡最下面一个 → 它停用后上面的接触断了被叫醒 → 再等 0.5s → 一个一个来
    if (restList) {
      restList.sort((a, b) => a.y - b.y) // 从数组尾(y 最大 = 最低)往前
      for (let pass = 0; pass < 3 && restList.length; pass++) {
        let n = 0
        for (let i = restList.length - 1; i >= 0; i--) {
          const b = restList[i]
          if (b.multi) {
            // 多体:全部部件都在 planck 里睡了 + 整组有支撑 → 整组一起写格子(部件之间的关节随 body 停用)
            const M = b.multi
            if (!M.parts.every((q) => q.dead || q.asleep || !q.pb?.isAwake() || q.restT > 0.5)) { restList.splice(i, 1); continue }
            if (this._multiSupported(M)) { for (const q of M.parts.slice().sort((a, b) => a.z - b.z)) if (!q.dead && !q.asleep) this._gridSleep(q) } // z 小(靠前)的先写格子:重叠处留前面那块的像素(轮子在车身前)
            else if (M.parts.some((q) => !q.dead && !q.asleep && (q.wetF || 0) > 0.15)) { for (const q of M.parts.slice().sort((a, b) => a.z - b.z)) if (!q.dead && !q.asleep) this._floatSleep(q) } // 整具尸体漂在水里(有一块泡着就行,露在水面上的手臂靠关节挂着;要求每块都湿 / 有接触的话一条翘着的胳膊让整具永远睡不着)
            else { restList.splice(i, 1); continue }
            restList = restList.filter((q) => !M.parts.includes(q)); n++
            i = restList.length // 数组换了,从尾重来
            continue
          }
          if (b.supported(this._solidB)) { this._gridSleep(b); restList.splice(i, 1); n++ }
          else if (b.wetF > 0.15) { this._floatSleep(b); restList.splice(i, 1); n++ }
        }
        if (!n) break
      }
    }
    this._updateMultis(dt)
    this._updateRagdolls(dt, x0, y0, x1, y1)
  }
  /** 多体的支撑:钉在地上的关节算;某部件脚下有实心且那格**不是兄弟部件睡进格子的像素**才算(车身压在自己睡着的轮子上不算有支撑,不然挖空脚下整组不醒) */
  _multiSupported(M) {
    if (M.hasStatic || M.joints.some((J) => !J.B)) return true
    const sets = []
    for (const p of M.parts) if (!p.dead && p.asleep && p.cellSet) sets.push(p.cellSet)
    const P = [0, 0]
    for (const p of M.parts) {
      if (p.dead) continue
      if (p.hanging) return true
      if (p.asleep && p.floatSleep && this._wetNear(p)) return true // 浮睡的整具尸体:哪块身边还有水就接着漂
      for (let e = 0; e < p.edge.length; e++) {
        p.worldOf(p.edge[e], P)
        const x = Math.floor(P[0]), y = Math.floor(P[1] + 1)
        if (!this._solidB(x, y)) continue
        const key = x * 65536 + (y & 65535)
        let own = false
        for (const s of sets) if (s.has(key)) { own = true; break }
        if (!own) return true
      }
    }
    return false
  }
  /**
   * 浮睡:漂在液体里歇下的刚体也写进格子(原版 Box2D 一睡像素就进世界,不管在不在水里;水从它旁边流)。
   * 试过只在 planck 里 setAwake(false) 不写格子:一个 body 睡了,下一步它所在的岛(接触 / 关节连着的一串)里只要有醒着的整岛又被拉醒,
   * 十具尸体挤一坑各自歇下的时刻对不上,睡 → 拉醒 → 再等 0.5s 循环不止(线上探针 floatS 0/12/36/0 抖);写进格子就停用了,岛断开,各睡各的。
   * 醒的条件换成 `_wetNear`:睡着时清点若脚下没实心且身边也没液体了(水退了)→ 醒,掉下去再正常入睡
   */
  _floatSleep(b) { this._gridSleep(b); b.floatSleep = true }
  /** 睡着的刚体身边还有液体吗(边缘像素的 4 邻格里有液体的比例 ≥ 15%):浮睡的支撑判定 */
  _wetNear(b) {
    let wet = 0, n = 0
    const P = [0, 0], L = this._liqDensity
    for (let k = 0; k < b.edge.length; k += 3) {
      b.worldOf(b.edge[k], P); const x = Math.floor(P[0]), y = Math.floor(P[1]); n++
      if (L(x, y + 1) > 0 || L(x, y - 1) > 0 || L(x + 1, y) > 0 || L(x - 1, y) > 0) wet++
    }
    return n > 0 && wet / n >= 0.15
  }
  /** 写进格子睡觉(+ 材质 solid_on_sleep_convert:concrete_collapsed → concrete_static,睡着就化成静态混凝土,刚体撤掉) */
  _gridSleep(b) {
    const sim = this.sim
    b.sleep(sim)
    if (b.sleepConvert && b.cells) { for (let k = 0; k < b.cells.length; k += 2) sim.set(b.cells[k], b.cells[k + 1], b.sleepConvert, 0); b.cells = null; b.dead = true }
  }

  /**
   * 布娃娃组:部件各自 step 完后解关节(pin joint 顺序冲量),整组慢下来 0.5s 且有一块着地 → 一起睡(像素进世界);
   * BLOOD_SPRAY / BLOOD_EXPLOSION 的部件按预算往外喷 blood_spray_material(真液体);火烧死的尸体几秒内在部件像素旁不断起火。
   */
  _updateRagdolls(dt, x0, y0, x1, y1) {
    const sim = this.sim
    for (let i = this.ragdolls.length - 1; i >= 0; i--) {
      const g = this.ragdolls[i]
      if (!g.alive) { this.ragdolls.splice(i, 1); continue }
      const root = g.parts.find((p) => !p.dead)
      if (root.x < x0 || root.x > x1 || root.y < y0 || root.y > y1) continue
      g.age += dt
      // 火烧死(KillMe:伤害类型 FIRE 或身上着火 → 尸体每 RAGDOLL_FIRE_DEATH_IGNITE_EVERY_N_PIXEL=5 个像素点一格火):
      // 醒着的刚体像素不在格子里,火放在像素上方的空气格;睡了以后像素就是世界里的 meat,火贴着它们放,meat 可燃就烧起来
      if (g.burn > 0) {
        g.burn -= dt
        const P = [0, 0], F = sim.M_FIRE
        for (const p of g.parts) {
          if (p.dead) continue
          if (p.asleep) {
            if (p.cells) for (let k = 0; k < p.cells.length; k += 10) { if (Math.random() > 0.15) continue; const fx = p.cells[k], fy = p.cells[k + 1] - 1; if (sim.get(fx, fy) === 0) sim.set(fx, fy, F, 8 + ((Math.random() * 10) | 0)) }
            continue
          }
          for (let k = 0; k < p.n; k += 5) {
            if (Math.random() > 0.15) continue
            p.worldOf(k, P)
            const fx = Math.floor(P[0]) + ((Math.random() * 3) | 0) - 1, fy = Math.floor(P[1]) - 1
            if (sim.get(fx, fy) === 0) sim.set(fx, fy, F, 6 + ((Math.random() * 8) | 0))
          }
        }
      }
      if (!g.anyAwake) continue
      if (g.planck) {
        // Box2D 版:关节 / 睡醒 / 支撑都在多体路径里(_updateBodies / _updateMultis),这里只剩血喷
        if (g.blood && g.blood.left > 0) this._ragdollBlood(g)
        continue
      }
      g.solve(3)
      if (g.blood && g.blood.left > 0) this._ragdollBlood(g)
      // 着地的尸体:关节每帧在块之间倒来倒去的动量会让整具慢慢蠕动 / 小块来回摆,按地面摩擦一起耗掉(box2d 里是接触摩擦 + 关节摩擦干的活)
      const sup = g.supported(this._solidB)
      if (sup) for (const p of g.parts) if (!p.dead && !p.asleep && g.connected(p)) { p.vx *= 0.9; p.w *= p.n < 12 ? 0.5 : 0.8 }
      // 整组入睡:相连的块半秒内都没挪窝 + 任一块有支撑;睡了以后关节不再解,像素进世界(meat)
      if (g.resting(dt) && sup) g.sleepAll(sim)
    }
  }

  /** 血喷(KillMe BLOOD_SPRAY 分支给每块挂 ParticleEmitter:沿伤害方向 ×(0.85~1.15),每 1~2 帧 1~3 粒,总量 ∝ 块的质量) */
  _ragdollBlood(g) {
    const B = g.blood, P = [0, 0]
    for (const p of g.parts) {
      if (p.dead || p.asleep || Math.random() > 0.6 || B.left <= 0) continue
      const n = 1 + ((Math.random() * 3) | 0)
      for (let k = 0; k < n && B.left > 0; k++) {
        p.worldOf((Math.random() * p.n) | 0, P)
        const sp = 30 + Math.random() * 60, jx = 0.85 + Math.random() * 0.3, jy = 0.85 + Math.random() * 0.3
        this.hooks.debris?.(P[0], P[1], B.dx * jx * sp + (Math.random() - 0.5) * 20, B.dy * jy * sp - 10 + (Math.random() - 0.5) * 20, B.mat, this.mats.color[B.mat], true)
        B.left--
      }
    }
  }

  /** xml 的 config_explosion → ProjectileSystem.explode(炸药箱 / 桶 / 地雷共用:坑 / 火 / 摇镜 / 伤害同一套) */
  explodeConfig(x, y, c) {
    const ref = Object.values(this.projectiles?.defs || {}).find((p) => p.explosion?.sprite?.image?.includes(String(c.explosion_sprite || '').replace(/^.*\/(explosion_\d+).*$/, '$1')))
    const ex = {
      radius: +c.explosion_radius || 0, damage: +c.damage || 0, shake: +c.camera_shake || 0, hole: c.hole_enabled !== 0 && c.hole_enabled !== '0',
      holeLiquid: c.hole_destroy_liquid === 1, destroyLiquid: c.hole_destroy_liquid === 1 || c.hole_destroy_liquid === '1', rayEnergy: +c.ray_energy || 0, maxDurability: +c.max_durability_to_destroy || 0,
      power: [+c['physics_explosion_power.min'] || 0, +(c['physics_explosion_power.max'] ?? 0.2)], knockback: +(c.knockback_force ?? 1),
      sprite: ref?.explosion?.sprite || null, spriteLife: +c.explosion_sprite_lifetime || 0,
      sparks: c.sparks_enabled === 1 || c.sparks_enabled === '1' ? [+c.sparks_count_min || 0, +c.sparks_count_max || 0] : null,
      matSparks: null, light: { fade: 0.15, r: 255, g: 200, b: 120, radius: 1 },
      createCell: +c.create_cell_probability ? { p: +c.create_cell_probability, mat: c.create_cell_material || 'fire' } : null,
      loadEntity: c.load_this_entity || null, stains: +c.stains_radius || 0,
    }
    this.projectiles?.explode?.(x, y, ex)
    this.hooks.sfx?.('explosion', { vol: Math.min(1, 0.4 + ex.radius / 80), rate: 1 })
  }

  /**
   * 刚体受伤:dmg(DamageModel hp)/ lost(缺损像素数)。
   * ExplodeOnDamageComponent:hp≤0 且 explode_on_death_percent → 炸;缺损比例 ≥ physics_body_destruction_required 按 modified_death_probability 炸;
   * MaterialInventoryComponent:打漏(leak_on_damage_percent)→ 从伤口漏液体;毁了 → 全洒出来。
   */
  _bodyDamaged(b, dmg, lost = 0, hx = b.x, hy = b.y) {
    if (b.dead) return
    const d = b.d
    // 多体(蘑菇 / 矿车):一个实体一条命,血 / 爆炸都记在根部件上;根死了整组一起撤
    if (b.multi) {
      const M = b.multi, root = M.root
      if (root && root !== b && !root.dead) {
        if (dmg > 0) root.hp -= dmg
        const live = M.parts.filter((q) => !q.dead)
        const avgDestroyed = live.reduce((s, q) => s + q.destroyed, 0) / Math.max(1, live.length)
        const req = d.explode?.physics_body_destruction_required
        if (root.hp <= 0 || (lost > 0 && req !== undefined && avgDestroyed >= req)) { this._destroyBody(root, hx, hy); return }
        if (b.destroyed > 0.6) this._destroyBody(b, hx, hy) // 这一块被打得剩不下什么了:只撤这一块,别的部件留着
        return
      }
    }
    if (dmg > 0) b.hp -= dmg
    const ex = d.explode
    let die = b.hp <= 0
    if (!die && ex && lost > 0 && ex.physics_body_destruction_required !== undefined && b.destroyed >= ex.physics_body_destruction_required) {
      if (Math.random() < (ex.physics_body_modified_death_probability ?? 1)) die = true
    }
    if (!die && ex && dmg > 0 && (ex.explode_on_damage_percent ?? 0) > 0 && Math.random() < ex.explode_on_damage_percent) die = true
    // 漏(MaterialInventory leak_on_damage_percent:"if higher than 0 then it might leak when projectile damage happens" = 漏的概率):桶 / 灯笼被打到 → 从伤口冒液体
    if (!die && b.inventory && dmg > 0 && (d.inventory?.leak_on_damage_percent ?? 0) > 0 && Math.random() < d.inventory.leak_on_damage_percent) this._leak(b, hx, hy, 6 + Math.round(Math.random() * 8))
    // script_physics_body_modified = physics_lantern_damaged.lua:像素被打掉就在原地 EntityLoad(misc/fire.xml)—— fire.xml 是 ElectricityComponent hack_is_set_fire=1:
    // 一帧内在周围乱窜一段点燃碰到的可燃物,比 3 格自己就灭的火靠谱得多。这里除了当场放火,再让灯笼自己烧 2.5s(每帧往身边空气格放火),掉下去一路点着漏出来的油
    if (lost > 0 && d.scripts?.some((s) => s.endsWith('physics_lantern_damaged'))) { this._fireAt(hx, hy, 3); b.fireT = Math.max(b.fireT || 0, 2.5) }
    // 钉子 / 链子挂着的像素被打掉 → 关节断,掉下来(Box2D 关节锚在像素上;大灯笼钉在墙里的走地形检查)
    if (lost > 0 && b.ropes) for (const r of b.ropes) if (!r.broken && (r.breakOnModified || !b.hasPixelNear(r.lx, r.ly))) { r.broken = true; if (b.asleep) b.wake(this.sim) }
    if (b.destroyed > 0.6) die = true
    if (die) this._destroyBody(b, hx, hy)
  }

  /** misc/fire.xml:在点上放几格火(空气格才放),旁边有油 / 木就烧起来 */
  _fireAt(x, y, n) {
    const sim = this.sim, F = sim.M_FIRE
    for (let i = 0; i < n; i++) {
      const px = Math.floor(x + (Math.random() - 0.5) * 4), py = Math.floor(y + (Math.random() - 0.5) * 4)
      if (sim.get(px, py) === 0) sim.set(px, py, F, 8 + ((Math.random() * 10) | 0))
    }
  }

  _leak(b, x, y, n) {
    if (!b.inventory) return
    for (const slot of b.inventory) {
      const m = this.mats.byName.get(slot.m)
      if (!m || slot.left <= 0) continue
      const k = Math.min(n, slot.left)
      for (let i = 0; i < k; i++) this.hooks.debris?.(x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 60, -10 - Math.random() * 40, m, this.mats.color[m])
      slot.left -= k
      return
    }
  }

  _destroyBody(b, hx, hy) {
    b.dead = true
    this.stats.broken++
    const sim = this.sim
    if (b.asleep) b.wake(sim) // 先把世界里的像素收回
    if (b.pb) this.physics.detach(b)
    // 多体的根死了(蘑菇炸了):整组撤掉(kill_entity_if_body_destroyed);部件死了根还在(轮子被打飞)→ 别的照旧
    if (b.multi && b.multi.root === b && !b.multi.isRagdoll) for (const q of b.multi.parts) if (q !== b && !q.dead) { if (q.asleep) q.wake(sim); q.dead = true }
    const d = b.d
    // 装的液体全洒出来(油桶 300 油 / 药水)
    if (b.inventory) for (const slot of b.inventory) {
      const m = this.mats.byName.get(slot.m)
      if (!m || slot.left <= 0) continue
      const n = Math.min(slot.left, 400)
      for (let i = 0; i < n; i++) this.hooks.debris?.(b.x + (Math.random() - 0.5) * b.w0, b.y + (Math.random() - 0.5) * b.h0, (Math.random() - 0.5) * 140, -Math.random() * 120, m, this.mats.color[m])
      slot.left = 0
    }
    // 碎块:剩下的像素按材质飞出去(box2d 材质是"尘",落地散;油/血落地留)
    const P = [0, 0]
    let n = 0
    for (let k = 0; k < b.n && n < 160; k += 2) {
      if (!b.mask[b._idx(k)]) continue
      b.worldOf(k, P)
      const px = b.png.data, ii = b._idx(k) * 4
      const col = b.baseColor !== undefined ? b.baseColor : (px[ii] << 16) | (px[ii + 1] << 8) | px[ii + 2]
      this.hooks.debris?.(P[0], P[1], (P[0] - b.x) * 6 + (Math.random() - 0.5) * 60, (P[1] - b.y) * 6 - 40 - Math.random() * 60, b.mat, col)
      n++
    }
    // 爆炸(炸药箱 / 桶):config_explosion 交给 ProjectileSystem.explode(同一套坑/火/摇镜/伤害)
    if (d.explode?.config && (d.explode.explode_on_death_percent ?? 1) > 0 && Math.random() < (d.explode.explode_on_death_percent ?? 1)) this.explodeConfig(b.x, b.y, d.explode.config)
    else this.hooks.sfx?.('clash', { vol: 0.5, rate: 0.6 + Math.random() * 0.3, minGap: 60 })
    this.hooks.onBreak?.(b)
  }

  _make(name, d, x, y) {
    const P = d.platforming, C = d.character, A = d.ai || {}
    const e = {
      name, d, x, y, vx: 0, vy: 0, face: Math.random() < 0.5 ? -1 : 1, onGround: false, inLiq: false,
      hp: d.damage?.hp ?? 1, maxHp: d.damage?.hp ?? 1, dead: false,
      box: { l: C.collision_aabb_min_x, r: C.collision_aabb_max_x, t: C.collision_aabb_min_y, b: C.collision_aabb_max_y },
      hit: d.hitbox ? { l: d.hitbox.aabb_min_x, r: d.hitbox.aabb_max_x, t: d.hitbox.aabb_min_y, b: d.hitbox.aabb_max_y } : { l: C.collision_aabb_min_x, r: C.collision_aabb_max_x, t: C.collision_aabb_min_y, b: C.collision_aabb_max_y },
      climb: C.climb_over_y ?? 4, buoyOff: C.buoyancy_check_offset_y ?? -4,
      gravity: P.pixel_gravity ?? 600, run: P.run_velocity ?? 18, accel: P.accel_x ?? 0.15,
      vmax: Math.abs(P.velocity_max_x ?? 50), vyMin: P.velocity_min_y ?? -200, vyMax: P.velocity_max_y ?? 350,
      // 跳:原版敌人的 jump_velocity_y 大多只有 -12(小跳),跨障碍靠 PathFindingComponent 的 can_jump + initial_jump_max_distance_x/y
      // (base_humanoid 100/60,miner 60/60),寻路里的跳边只在这个范围内找,起跳速度按 pixel_gravity 反算(_jumpTo)
      jumpV: (P.jump_velocity_y ?? -12) <= -60 ? P.jump_velocity_y : -125,
      canJump: !!(d.path?.can_jump ?? 1), jumpMaxX: d.path?.initial_jump_max_distance_x ?? 100, jumpMaxY: d.path?.initial_jump_max_distance_y ?? 60,
      reachX: Math.min(d.path?.distance_to_reach_node_x ?? 4, 6), reachY: Math.min(d.path?.distance_to_reach_node_y ?? 6, 8), stuckLimit: (d.path?.frames_to_get_stuck ?? 30) / 60, lobT: 0, stuckN: 0,
      helpless: d.genome?.herd_id === 'helpless', herd: d.genome?.herd_id || '',
      // 飞行(AnimalAI can_fly / PathFinding can_fly:蝙蝠、火骷髅、史莱姆射手、无人机):没有重力,朝目标点飞,悬在人上方
      flyer: !!(A.can_fly || d.path?.can_fly), flySpeed: d.ghost ? d.ghost.speed * 1.75 : Math.max(40, P.fly_velocity_x ?? 28) * 1.6, flyHover: -20 - Math.random() * 20, flySide: Math.random() < 0.5 ? -1 : 1,
      // 爬墙(longleg / 蜘蛛阵营):贴着地/墙/顶爬,surf = 实心在哪一侧
      crawler: d.genome?.herd_id === 'spider', surf: null,
      stationary: !!d.stationary,
      escapeP: A.escape_if_damaged_probability ?? 0,
      lastX: x, stuckT: 0,
      sense: !!A.sense_creatures, detX: A.creature_detection_range_x ?? 180, detY: A.creature_detection_range_y ?? 40,
      // 远程(attack_ranged_*):弹丸走 ProjectileSystem 的 e_<名>;min/max 距离、间隔、一次几发、预判
      ranged: !!A.attack_ranged_enabled && !!A.attack_ranged_entity_file && !!this.projectiles?.defs?.['e_' + String(A.attack_ranged_entity_file).split('/').pop().replace('.xml', '')],
      rangedProj: 'e_' + String(A.attack_ranged_entity_file || '').split('/').pop().replace('.xml', ''),
      rangedMin: A.attack_ranged_min_distance ?? 10, rangedMax: A.attack_ranged_max_distance ?? 180, rangedGap: (A.attack_ranged_frames_between ?? 60) / 60,
      rangedCount: [A.attack_ranged_entity_count_min ?? 1, A.attack_ranged_entity_count_max ?? 1], rangedPredict: !!A.attack_ranged_predict,
      rangedOff: [A.attack_ranged_offset_x ?? 0, A.attack_ranged_offset_y ?? -10], rangedFrame: A.attack_ranged_action_frame ?? 2, rangedCool: 1 + Math.random(),
      melee: !!A.attack_melee_enabled && (A.attack_melee_max_distance ?? 0) > 0, meleeDist: A.attack_melee_max_distance ?? 10,
      meleeDmg: [A.attack_melee_damage_min ?? 0.2, A.attack_melee_damage_max ?? 0.4], meleeGap: (A.attack_melee_frames_between ?? 20) / 60,
      meleeImp: [(A.attack_melee_impulse_vector_x ?? 1) * (A.attack_melee_impulse_multiplier ?? 50), (A.attack_melee_impulse_vector_y ?? 0.25) * (A.attack_melee_impulse_multiplier ?? 50)],
      meleeFrame: A.attack_melee_action_frame ?? 2,
      state: 'idle', stateT: 0.5 + Math.random() * 1.5, dir: 0, think: Math.random() * 0.5, cool: 0, attackT: -1, attackDone: false, hurtT: 0, fireT: 0, fireTick: 0,
      anim: d.sprite.def || 'stand', frame: 0, ft: 0, animLock: 0,
    }
    if (d.limbs) this._initLukki(e, d)
    // verlet 触手(giantshooter / slimeshooter / acidshooter / tentacler 的黏液触手):每条从挂点垂直垂下 num_points 个点,质量 mass_min~max
    if (d.tentacles) e.tents = d.tentacles.map((T) => ({ T, pts: Array.from({ length: T.points }, (_, i) => ({ x: x + T.x, y: y + T.y + i * T.rest, px: x + T.x, py: y + T.y + i * T.rest, m: T.massMin + Math.random() * (T.massMax - T.massMin) })) }))
    // MaterialInventoryComponent(giantshooter 400 酸 / slimeshooter 800 毒液):被弹丸打到按 leak_on_damage_percent 从伤口漏
    if (d.inventory?.materials?.length) e.inventory = d.inventory.materials.map(([m, n]) => ({ m, left: +n }))
    // 法杖幽灵:出生就拿一根 wand_level_03(wand_ghost.lua),画的就是这根法杖;死了掉下来
    if (d.wandGhost) { const h = this.hooks.ghostWand?.(d.wandGhost, x, y); if (h?.image) { e.held = h; this._img(h.image) } }
    if (d.attacks?.length) {
      e.attacks = d.attacks.filter((a) => this.projectiles?.defs?.['e_' + a.proj])
      if (e.attacks.length) { e.ranged = true; e.rangedMin = Math.min(...e.attacks.map((a) => a.min)); e.rangedMax = Math.max(...e.attacks.map((a) => a.max)) }
    }
    return e
  }

  /**
   * lukki 蜘蛛(PhysicsBody 圆 + PhysicsAIComponent + LimbBossComponent state=1 FollowPlayer + IKLimb 子实体):
   * 身体按飞行体走(PathFinding can_fly、原作靠腿撑着完全无视重力),速度由 PhysicsAI force_coeff 折算(10 → 45px/s,tiny 7 → 31;LimbBoss 的追人范围引擎内置,取 200×120);
   * 腿:每条 IKLimbComponent length 的两段式 IK,脚找 length 内的实心踩住,身体走远了换脚;IKLimbAttackerComponent radius 的那条是攻击腿——
   * 人进 radius 就抬腿瞄 0.45s 再刺出去(wiki:Melee 12.5 = 0.5,带击退);CellEaterComponent radius 的挖洞在 _flyStep 里(挡住了就吃)。
   * 腿的 z_index 1.1 在身体后面;死亡 ragdollify_child_entity_sprites=1 → 每段腿变一块 meat_slime_green 肉刚体。
   */
  _initLukki(e, d) {
    const n = d.limbs.length
    e.legs = d.limbs.map((L, i) => {
      const home = -Math.PI / 2 + ((i + 0.5) / n) * Math.PI * 2
      return { L, len: L.len, home, fx: e.x + Math.cos(home) * L.len * 0.6, fy: e.y + Math.sin(home) * L.len * 0.6, tx: 0, ty: 0, planted: false, moving: 0, cool: Math.random() * 0.2, t: 0, phase: 'idle', cd: 0.5 + Math.random(), hit: false }
    })
    const att = d.limbs.find((L) => L.attacker)
    e.keepDist = att ? att.attacker * 0.55 : 12
    e.flySpeed = (d.physicsAI?.force_coeff ?? 10) * 4.5
    e.detX = 200; e.detY = 120; e.sense = true
    e.escapeP = 20 // wiki:"if a spider takes too much damage, it will usually attempt to flee"(引擎内置,取 20%)
    e.eatR = d.cellEater?.radius || 0
    e.bodyR = d.physShape?.r ?? 8
  }

  // ── 虫(WormComponent + WormAIComponent + CellEaterComponent)──
  // 头带着节链在地里游(每帧把头周围 CellEater.radius 内的格吃成空气 = 打洞),出了地面靶重力抛物线再扎回去;
  // WormAI:hunt_box_radius 内发现玩家 → 追(speed_hunt,转向 direction_adjust_speed_hunt),否则每 120 帧在 128 盒里换个随机目标;
  // 头到玩家 target_kill_radius 内 = 一口(worm_tiny bite_damage 0.3;大虫 = 吞,给 1.6)。血 blood_worm,死了掉金(ItemChest level 2)。
  _makeWorm(name, d, x, y) {
    const W = d.worm, A = d.wormAI || {}
    const n = d.parts.length
    const segs = []
    for (let i = 0; i < n; i++) segs.push({ x: x - i * W.part_distance, y, a: 0 })
    return {
      name, d, isWorm: true, x, y, vx: 0, vy: 0, dead: false, hp: d.damage?.hp ?? 20, maxHp: d.damage?.hp ?? 20,
      segs, dist: W.part_distance, r: W.hitbox_radius ?? 5, eatR: d.cellEater?.radius ?? 6, killR: W.target_kill_radius ?? 7,
      bite: W.bite_damage ?? 1.6, speed: (A.speed ?? 2) * 60, speedHunt: (A.speed_hunt ?? 4) * 60,
      turn: (A.direction_adjust_speed ?? 0.012) * 60, turnHunt: (A.direction_adjust_speed_hunt ?? 0.06) * 60,
      huntR: A.hunt_box_radius ?? 256, wanderR: A.random_target_box_radius ?? 128, retarget: (A.new_random_target_check_every ?? 120) / 60,
      ang: Math.PI, tx: x - 100, ty: y, tT: 0, hunting: false, biteCool: 0, hurtT: 0, frame: 0, ft: 0, inGround: true, airT: 0,
      hit: { l: -6, r: 6, t: -6, b: 6 }, herd: 'worm',
    }
  }

  _updateWorm(w, dt, pl) {
    const sim = this.sim
    w.hurtT -= dt; w.biteCool -= dt; w.tT -= dt
    const dx = pl.x - w.x, dy = pl.y - 4 - w.y, dist = Math.hypot(dx, dy)
    // 目标:猎杀 / 漫游
    if (dist < w.huntR) { w.hunting = true; w.tx = pl.x; w.ty = pl.y - 4 }
    else if (w.hunting) { w.hunting = false; w.tT = 0 }
    if (!w.hunting && w.tT <= 0) { w.tT = w.retarget; w.tx = w.x + (Math.random() - 0.5) * 2 * w.wanderR; w.ty = w.y + (Math.random() - 0.5) * 2 * w.wanderR }
    // 头周围会被自己吃空,所以"在地里"看吃的半径之外:前方 / 下方 / 目标方向各探一格
    const pr = w.eatR + 2
    const probe = (a) => this._solid(Math.floor(w.x + Math.cos(a) * pr), Math.floor(w.y + Math.sin(a) * pr))
    const want = Math.atan2(w.ty - w.y, w.tx - w.x)
    const headSolid = probe(w.ang) || probe(Math.PI / 2) || probe(want) || probe(w.ang + 0.6) || probe(w.ang - 0.6)
    if (headSolid) {
      // 地里:恒速游,朝目标转向
      w.inGround = true; w.airT = 0
      let da = want - w.ang; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI
      const maxTurn = (w.hunting ? w.turnHunt : w.turn) * dt
      w.ang += Math.max(-maxTurn, Math.min(maxTurn, da))
      const sp = w.hunting ? w.speedHunt : w.speed
      w.vx = Math.cos(w.ang) * sp; w.vy = Math.sin(w.ang) * sp
    } else {
      // 空中:重力抛物线,只能微调
      if (w.inGround) { w.inGround = false; this.hooks.shake?.(0.25); this.hooks.sfx?.('impact', { vol: 0.6, rate: 0.6, minGap: 200 }) }
      w.airT += dt
      w.vy += BODY_GRAVITY * dt
      w.ang = Math.atan2(w.vy, w.vx)
    }
    const sp = Math.hypot(w.vx, w.vy)
    const sub = Math.max(1, Math.ceil(sp * dt / 3))
    for (let s = 0; s < sub; s++) {
      w.x += (w.vx * dt) / sub; w.y += (w.vy * dt) / sub
      // 吃:头周围 eatR 内非 box2d 的格全变空气(打出来的就是虫洞)
      const R = w.eatR, cx = Math.floor(w.x), cy = Math.floor(w.y)
      for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) {
        if (xx * xx + yy * yy > R * R) continue
        const m = sim.get(cx + xx, cy + yy)
        if (m > 0 && this.mats.kind[m] !== 'solid') sim.set(cx + xx, cy + yy, 0, 0)
      }
    }
    // 节链跟随:每节拉到前一节后方 part_distance 处
    w.segs[0].x = w.x; w.segs[0].y = w.y; w.segs[0].a = w.ang
    for (let i = 1; i < w.segs.length; i++) {
      const p = w.segs[i - 1], s = w.segs[i]
      let ddx = s.x - p.x, ddy = s.y - p.y, l = Math.hypot(ddx, ddy) || 1
      if (l > w.dist) { s.x = p.x + (ddx / l) * w.dist; s.y = p.y + (ddy / l) * w.dist }
      s.a = Math.atan2(p.y - s.y, p.x - s.x)
    }
    // 一口
    if (dist < w.killR + 3 && w.biteCool <= 0) { w.biteCool = 1.5; this.hooks.damagePlayer?.(w.bite, Math.sign(dx) * 80, -60, w) }
    // 动画
    const a = w.d.parts[0].anims.eat || w.d.parts[0].anims.stand
    if (a) { w.ft += dt; while (w.ft >= a.wait) { w.ft -= a.wait; w.frame = (w.frame + 1) % a.frames } }
  }

  _hitWorm(x, y) {
    for (const w of this.worms) { if (w.dead) continue; for (const s of w.segs) if ((x - s.x) ** 2 + (y - s.y) ** 2 <= (w.r + 1) ** 2) return w }
    return null
  }

  _renderWorm(ctx, w, ox, oy) {
    for (let i = w.segs.length - 1; i >= 0; i--) {
      const P = w.d.parts[Math.min(i, w.d.parts.length - 1)], img = this._img(P.image)
      if (!img?.image) continue
      const a = P.anims.eat || P.anims.stand || Object.values(P.anims)[0]
      if (!a) continue
      const f = i === 0 ? w.frame : 0
      const fx = a.x + (f % a.perRow) * a.fw, fy = a.y + Math.floor(f / a.perRow) * a.fh
      const s = w.segs[i]
      ctx.save()
      ctx.translate(Math.round(s.x - ox), Math.round(s.y - oy))
      ctx.rotate(s.a)
      if (w.hurtT > 0) ctx.globalAlpha = 0.7
      ctx.drawImage(img.image, fx, fy, a.fw, a.fh, -Math.round(a.fw / 2), -Math.round(a.fh / 2), a.fw, a.fh)
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }

  // ── 世界查询 ──
  /**
   * 挡怪的格子:按材质 platform_type(materials.xml):0 = 角色穿过去(grass / moss / plant_material / mushroom / wood_loose 树 / rock_loose / meat 尸块 / item_box2d / wood_prop_noplayerhit),
   * 1 = 站得住(rock_static / sand_static / wood / steel / concrete_collapsed / wood_prop…),2 = templebrick_box2d,没写 = 1。
   * 所以原版怪和人都**穿树走**、踩不到尸块(用户:树把路挡了 / 怪挂在半空)。不能按 solid_static_type 判:wood / steel / brick 这些 cell_type=solid 的真地形 sst≠1 但 pt=1。
   */
  _solid(x, y) {
    const m = this.matAt(x, y); if (m < 0) return true
    const k = this.mats.kind[m]
    if (k !== 'static' && k !== 'sand' && k !== 'solid') return false
    return (this.mats.list[m]?.platformType ?? 1) !== 0
  }
  /** 刚体(原版 Box2D)撞的格子:platform_type 只管角色,箱子 / 尸块 / 金块照样落在树上、堆在尸块上 —— 不然尸块堆互相"穿"着一直醒来掉、睡不安稳 */
  _solidB(x, y) {
    const m = this.matAt(x, y); if (m < 0) return true
    const k = this.mats.kind[m]
    return k === 'static' || k === 'sand' || k === 'solid'
  }
  /** 怪走路用:地形 + 醒着的刚体(物品 —— 货架上的法术卡 / 法杖 / 金块 —— 不挡怪) */
  _solidC(x, y) { if (this._solid(x, y)) return true; const b = this.bodySolidAt(x, y); return !!b && !b.isItem }
  _liquid(x, y) { const m = this.matAt(x, y); return m > 0 && this.mats.kind[m] === 'liquid' }
  /**
   * 碰撞盒放在 (cx,cy) 撞不撞:扫盒子的四条边(每格 1px)。移动都是 ≤1px 的子步,所以新碰到的格一定在边上;
   * 之前只采左右两列、竖向每 2.2px 一点,1px 厚的地板 / 竹竿会漏(掉穿 / 穿墙)。盒子内部(被落沙埴住)由 _unstick 另查。
   */
  _blocked(e, cx, cy) {
    const xl = Math.floor(cx + e.box.l), xr = Math.floor(cx + e.box.r - 0.01)
    const yt = Math.floor(cy + e.box.t), yb = Math.floor(cy + e.box.b - 0.01)
    for (let y = yt; y <= yb; y++) if (this._solidC(xl, y) || this._solidC(xr, y)) return true
    for (let x = xl + 1; x < xr; x++) if (this._solidC(x, yt) || this._solidC(x, yb)) return true
    return false
  }
  /** 盒子里(含内部)有没有实心:被落沙 / 塌方埴住时用 */
  _buried(e, cx, cy) {
    const xl = Math.floor(cx + e.box.l), xr = Math.floor(cx + e.box.r - 0.01)
    const yt = Math.floor(cy + e.box.t), yb = Math.floor(cy + e.box.b - 0.01)
    for (let y = yt; y <= yb; y++) for (let x = xl; x <= xr; x++) if (this._solidC(x, y)) return true
    return false
  }
  /**
   * 卡进实心里了:在 ±3px 内找最近的空位(先往上),挪过去;找不到 = 被埋住,原地不动(速度清零)。
   * 之前是"每帧往上顶最多 16px 直到不撞",被沙埴住 / 堵在坑里的怪会一帧穿过头顶的石头冒出来——就是"本来出不来的怪突然跳出来"。
   */
  _unstick(e) {
    if (!this._buried(e, e.x, e.y)) { e.buriedT = 0; return false }
    if (this._freeNear(e, 3)) { e.buriedT = 0; return false }
    e.vx = 0; e.vy = 0; e.lobT = 0
    // 埋在石头里(不是沙):原版怪只会在生成点的空气里出现,不存在"长在岩石里"的怪;我们的地形和原版有出入 / 布景后盖 / 塌方压过来都可能把怪封进石头。
    // 埋着超过 1s 就每秒往外找一次(±12px),3s 还在石头里就撤掉 —— 别让一只怪永远卡在墙里当靶子
    e.buriedT = (e.buriedT || 0) + 1 / 60
    const m = this.matAt(Math.floor(e.x), Math.floor(e.y + (e.box.t + e.box.b) / 2))
    const inRock = m > 0 && this.mats.kind[m] === 'static'
    if (e.buriedT > 1 && (e.buriedT * 60 | 0) % 60 === 0 && this._freeNear(e, 12)) { e.buriedT = 0; return false }
    if (inRock && e.buriedT > 3) { e.dead = true; e.vanished = true; this.stats.unstuckRemoved = (this.stats.unstuckRemoved || 0) + 1 }
    return true
  }
  /** 以当前位置为中心一圈圈往外找放得下盒子的空位(切比雪夫半径 ≤ R),找到就挪过去 */
  _freeNear(e, R) {
    for (let r = 1; r <= R; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        if (!this._buried(e, e.x + dx, e.y + dy)) { e.x += dx; e.y += dy; return true }
      }
    }
    return false
  }
  /** 出生 / 巢里吐出来那一下:落点被卡在实心里就往上找 ≤24px 的空位,再一圈圈找 ≤32px;都没有 = 这个生成点在我们的地形里是实心的,不出这只怪 */
  _settle(e) {
    if (e.stationary || !this._buried(e, e.x, e.y)) return
    if (!e.flyer) for (let k = 1; k <= 24; k++) if (!this._buried(e, e.x, e.y - k)) { e.y -= k; return }
    if (this._freeNear(e, 32)) return
    e.dead = true; e.vanished = true; this.stats.spawnSkipped = (this.stats.spawnSkipped || 0) + 1
  }
  /**
   * 起跳到脚下目标点(PathFinding can_jump / initial_jump_lob):按 pixel_gravity 算抛物线——竖向速度刚好越过目标高度 +4px,
   * 横向速度让落地时正好到 tx;空中(lobT)不再往 run_velocity 收,免得半空掉回来。
   */
  _jumpTo(e, tx, ty) {
    const feet = e.y + e.box.b, g = e.gravity
    const h = Math.max(6, feet - ty + 4)
    const vy = Math.max(e.vyMin, -Math.sqrt(2 * g * h))
    const dy = ty - feet // 落点相对起点(向下为正)
    const disc = vy * vy + 2 * g * dy
    const t = disc > 0 ? (-vy + Math.sqrt(disc)) / g : -vy / g
    e.vy = vy
    e.vx = Math.max(-140, Math.min(140, (tx - e.x) / Math.max(0.05, t)))
    e.lobT = t + 0.1
    e.onGround = false
  }

  /** 每帧:只更新激活窗口内的实体(rect = 模拟窗口,屏幕外一圈也在动;传 cam/VW/VH 的老写法照旧),窗口外冻结 */
  update(dt, cam, VW, VH) {
    this.time += dt
    const rect = cam && cam.x0 !== undefined ? cam : null
    const x0 = rect ? rect.x0 : cam.x - VW / 2 - 96, x1 = rect ? rect.x1 : cam.x + VW / 2 + 96, y0 = rect ? rect.y0 : cam.y - VH / 2 - 96, y1 = rect ? rect.y1 : cam.y + VH / 2 + 96
    this.camRect = rect && rect.cx0 !== undefined ? rect : null // 视口(is_in_camera_bounds 用)
    this._updateBodies(dt, x0, y0, x1, y1)
    this._rebuildBodyGrid()
    const pl = this.player
    for (let i = this.worms.length - 1; i >= 0; i--) {
      const w = this.worms[i]
      if (w.dead) { this.worms.splice(i, 1); continue }
      if (w.x < x0 - 200 || w.x > x1 + 200 || w.y < y0 - 200 || w.y > y1 + 200) continue // 虫的活动范围放宽(它在地里跑得远)
      if (this.sim.get(Math.floor(w.x), Math.floor(w.y)) < 0) continue // 头出了模拟窗口先冻着
      this._updateWorm(w, dt, pl)
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i]
      if (e.dead) { this.list.splice(i, 1); continue }
      if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue
      const f60 = dt * 60
      // GameEffect FROZEN(effect_frozen 120 帧)/ ELECTROCUTION(effect_electricity 40 帧):定在原地什么都不做(场类法术 GameAreaEffectComponent 给的)
      if (e.frozenT > 0) e.frozenT -= dt
      if (e.stunT > 0) { e.stunT -= dt; e.vx = 0; e.vy = 0; e.dir = 0; continue }
      // ── 感知 / 状态机 ──
      e.think -= dt; e.cool -= dt; e.hurtT -= dt; e.rangedCool -= dt
      const dx = pl.x - e.x, dy = pl.y - e.y, adx = Math.abs(dx), ady = Math.abs(dy)
      // 地雷(CollisionTriggerComponent radius 20, required_tag mortal, timer_for_destruction 30 帧):人或别的活物进圈 → 亮起 0.5s → 炸
      if (e.d.mine) {
        const M = e.d.mine
        if (e.armT === undefined) {
          let near = Math.hypot(dx, dy - 4) < M.radius
          if (!near) for (const o of this.list) if (o !== e && !o.dead && !o.d.mine && Math.abs(o.x - e.x) < M.radius && Math.abs(o.y - e.y) < M.radius) { near = true; break }
          if (near) { e.armT = M.timer; this._setAnim(e, e.d.sprite.anims.detonate ? 'detonate' : 'attack', true); this.hooks.sfx?.('clash', { vol: 0.3, rate: 3, minGap: 100 }) }
        } else { e.armT -= dt; if (e.armT <= 0) { e.hp = 0; this._die(e); continue } }
        // 没有别的行为,只走动画帧
        const a = e.d.sprite.anims[e.anim] || e.d.sprite.anims[e.d.sprite.def]
        if (a) { e.ft += dt; if (e.ft >= a.wait) { e.ft = 0; e.frame = (e.frame + 1) % Math.max(1, a.frames) } }
        continue
      }
      // 光环伤害(DamageNearbyEntitiesComponent:幽灵 radius 16 每 3s 一次诅咒伤害)
      if (e.d.aura) { e.auraT = (e.auraT ?? 0.5) - dt; if (e.auraT <= 0 && Math.hypot(dx, dy - 4) < e.d.aura.radius) { e.auraT = e.d.aura.every; this.hooks.damagePlayer?.(e.d.aura.dmg, 0, 0, e) } }
      if (e.think <= 0) {
        e.think = 0.5
        if (e.helpless) { if (adx < 70 && ady < 40) { e.state = 'flee'; e.stateT = 1.5 } }
        else if (e.sense && !pl.invisible && adx < e.detX && ady < e.detY && !(e.state === 'attack')) { e.state = 'chase'; e.stateT = 3 }
        else if (e.state === 'chase' && (adx > e.detX * 1.3 || ady > e.detY * 1.5 || pl.invisible)) { e.state = 'idle'; e.stateT = 1 } // 隐身药:看不见人
      }
      e.stateT -= dt
      if (e.state === 'idle') { e.dir = 0; if (e.stateT <= 0) { e.state = 'wander'; e.dir = Math.random() < 0.5 ? -1 : 1; e.stateT = 0.8 + Math.random() * 2 } }
      else if (e.state === 'wander') { if (e.stateT <= 0) { e.state = 'idle'; e.stateT = 0.5 + Math.random() * 2.5 } }
      else if (e.state === 'flee') { e.dir = dx > 0 ? -1 : 1; if (e.stateT <= 0) { e.state = 'wander'; e.stateT = 1 } }
      else if (e.state === 'chase') {
        e.dir = adx > 3 ? Math.sign(dx) : 0
        const dist = Math.hypot(dx, dy)
        if (e.melee && adx <= e.meleeDist && ady <= 12 && e.cool <= 0) { e.state = 'attack'; e.attackT = 0; e.attackDone = false; e.dir = 0; this._setAnim(e, 'attack', true) }
        else if (e.ranged && e.rangedCool <= 0 && dist >= e.rangedMin && dist <= e.rangedMax && this._sees(e, pl)) {
          // AIAttackComponent 多段(Stevari):按距离区间挑一段,弹 / 间隔 / 出手帧 / 动画都换成它的
          let anim = 'attack_ranged', ok = true
          if (e.attacks) {
            const a = e.attacks.find((k) => dist >= k.min && dist <= k.max)
            if (a) { e.rangedProj = 'e_' + a.proj; e.rangedGap = a.gap / 60; e.rangedFrame = a.frame; e.rangedOff = [a.ox, a.oy]; anim = a.anim; e.rangedAnim = anim } else ok = false
          }
          if (ok) { e.state = 'shoot'; e.attackT = 0; e.attackDone = false; e.dir = 0; e.face = Math.sign(dx) || e.face; this._setAnim(e, anim, true) }
        }
        else if (e.ranged && dist < e.rangedMin * 0.8 && !e.melee) e.dir = -Math.sign(dx) // 射手保持距离
      } else if (e.state === 'shoot') {
        e.dir = 0
        e.attackT += dt
        const a = e.d.sprite.anims[e.rangedAnim || 'attack_ranged'] || e.d.sprite.anims.attack_ranged
        const actT = a ? e.rangedFrame * a.wait : 0.2, endT = a ? a.frames * a.wait : 0.5
        if (!e.attackDone && e.attackT >= actT) { e.attackDone = true; this._shoot(e, pl) }
        if (e.attackT >= endT) { e.state = 'chase'; e.rangedCool = e.rangedGap; e.animLock = 0 }
      } else if (e.state === 'attack') {
        e.dir = 0
        e.attackT += dt
        const a = e.d.sprite.anims.attack
        const actT = a ? e.meleeFrame * a.wait : 0.15, endT = a ? a.frames * a.wait : 0.4
        if (!e.attackDone && e.attackT >= actT) {
          e.attackDone = true
          if (adx <= e.meleeDist + 3 && ady <= 14) {
            const dmg = e.meleeDmg[0] + Math.random() * (e.meleeDmg[1] - e.meleeDmg[0])
            this.hooks.damagePlayer?.(dmg, Math.sign(dx) * e.meleeImp[0], -Math.abs(e.meleeImp[1]), e)
          }
        }
        if (e.attackT >= endT) { e.state = 'chase'; e.cool = e.meleeGap; e.animLock = 0 }
      }
      if (e.dir) e.face = e.dir

      // ── 身体:三种模型 ──
      const inLiq = this._liquid(e.x, e.y + e.box.b + e.buoyOff)
      e.inLiq = inLiq
      if (e.stationary) {
        e.vx = e.vy = 0; e.dir = 0 // 站桩(shooterflower 那种没有 CharacterPlatforming 的):不动,只朝人开火
        // 神殿陷阱(crypt_trap_check.lua):每 60 帧查一次,人在正面 170px、竖向 ydist 内 → 朝人射一发(箭 300~400 + 上抬 50,火 320,雷 50,吐 360)
        const T = e.d.trap
        if (T) {
          e.face = T.dir
          e.trapT = (e.trapT ?? 1) - dt
          if (e.trapT <= 0) {
            e.trapT = 1
            if (adx < 170 && ady < T.ydist && Math.sign(dx) === T.dir) {
              const name = 'e_' + T.proj
              if (this.projectiles?.defs?.[name]) {
                const v = T.vel[0] + Math.random() * (T.vel[1] - T.vel[0]), a = Math.atan2(dy, dx)
                const p = this.projectiles.spawn(name, e.x, e.y + 2, a, { owner: 'enemy' })
                if (p) { p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v + T.arrowLift }
                this._setAnim(e, 'attack', true)
                this.hooks.sfx?.('wind', { vol: 0.3, rate: 1.3, minGap: 80 })
              }
            }
          }
        }
        // 激光门(lasergate_ver.lua):cos(frame·0.03 + x·0.05) < 0 时亮;光束沿 angle 方向到第一格实心 / max_length;人碰到光束掉 damage_to_entities
        const LZ = e.d.lasergate
        if (LZ) {
          e.laserOn = Math.cos(this.time * 60 * 0.03 + e.x * 0.05) < 0
          if (e.laserOn) {
            const ca = Math.cos(LZ.angle), sa = Math.sin(LZ.angle)
            let len = 0
            for (; len < LZ.maxLen; len += 2) if (this._solid(Math.floor(e.x + ca * len), Math.floor(e.y + sa * len))) break
            e.laserLen = len
            // 玩家盒(±3 × −12..3)与光束线段的距离
            const px = pl.x, py = pl.y - 4
            const t = Math.max(0, Math.min(len, (px - e.x) * ca + (py - e.y) * sa))
            const qx = e.x + ca * t, qy = e.y + sa * t
            if (Math.abs(px - qx) < 3 + LZ.radius && Math.abs(py - qy) < 8 + LZ.radius) this.hooks.damagePlayer?.(LZ.dmg, 0, 0, e)
            if (Math.random() < 0.3) { const k = Math.random() * len; this.hooks.spark?.(e.x + ca * k, e.y + sa * k, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, '#ff60c0', 0.25) }
          }
        }
        // 放射云(cloud_trap):每 every 秒往圆内随机一格写 cloud_radioactive 真气体(会飘、会下雨放射液)
        const CT = e.d.cloudTrap
        if (CT) {
          if (e.cloudMat === undefined) e.cloudMat = this.mats.byName.get(CT.mat) ?? 0
          e.cloudT = (e.cloudT ?? 0) - dt
          if (e.cloudT <= 0 && e.cloudMat > 0) {
            e.cloudT = CT.every
            const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * CT.r
            const cx = Math.floor(e.x + Math.cos(a) * r), cy = Math.floor(e.y + Math.sin(a) * r)
            if (this.sim.get(cx, cy) === 0) this.sim.set(cx, cy, e.cloudMat, 0)
          }
        }
        // 雕像陷阱(statue_trap.lua 每 40 帧):人到 32px 内 → 换成会飞的活雕像 animals/statue + 尘土,自己消失
        const ST = e.d.statueTrap
        if (ST) {
          e.stT = (e.stT ?? 40 / 60) - dt
          if (e.stT <= 0) {
            e.stT = 40 / 60
            if (Math.hypot(dx, dy - 4) < ST.radius) {
              e.dead = true
              const s = this.spawnCreature(ST.spawn, e.x, e.y - 6)
              if (s) { s.state = 'chase'; s.stateT = 4 }
              for (let k = 0; k < 14; k++) this.hooks.spark?.(e.x + (Math.random() - 0.5) * 12, e.y - Math.random() * 14, (Math.random() - 0.5) * 60, -20 - Math.random() * 40, '#a0988a', 0.5)
              this.hooks.sfx?.('clash', { vol: 0.6, rate: 0.6, minGap: 100 })
              continue
            }
          }
        }
        // 激光炮(lasergun.lua):每 tick 计一次,timing 从 Random(0,10) 起,到 period 归零并朝下射一发 laser_lasergun(vy 1000)
        const LG = e.d.lasergun
        if (LG) {
          if (e.lgTiming === undefined) { e.lgTiming = Math.floor(Math.random() * 11); e.lgT = LG.tick }
          e.lgT -= dt
          if (e.lgT <= 0) {
            e.lgT += LG.tick; e.lgTiming++
            if (e.lgTiming >= LG.period) {
              e.lgTiming = 0
              const name = 'e_' + LG.proj
              if (this.projectiles?.defs?.[name]) { const p = this.projectiles.spawn(name, e.x, e.y + LG.oy, Math.PI / 2, { owner: 'enemy' }); if (p) { p.vx = 0; p.vy = LG.vy } this.hooks.sfx?.('electric', { vol: 0.3, rate: 1.4, minGap: 80 }) }
            }
          }
        }
        // 巢吐虫(flynest.lua 等):每 121 帧掷一次,75% 且玩家在 200px 内且没到上限 → 在巢边放一只
        const N = e.d.nest
        if (N) {
          e.nestT = (e.nestT ?? N.every) - dt
          if (e.nestT <= 0) {
            e.nestT = N.every
            if (Math.random() < N.chance && (e.spawned || 0) < N.max && adx * adx + ady * ady < N.dist * N.dist) {
              let r = Math.random(), pick = N.spawns[N.spawns.length - 1][0]
              for (const [name, p] of N.spawns) { if (r < p) { pick = name; break } r -= p }
              if (this.spawnCreature(pick, e.x + (Math.random() * 8 - 4), e.y + N.oy + (Math.random() * 8 - 4))) e.spawned = (e.spawned || 0) + 1
            }
          }
        }
      }
      else if (e.flyer) this._flyStep(e, dt, dx, dy)
      else if (e.crawler) this._crawlStep(e, dt, dx, dy)
      else this._walkStep(e, dt, f60, inLiq, dy)
      if (e.legs) this._legsStep(e, dt)
      if (e.tents) this._tentaclesStep(e, dt)
      // AreaDamageComponent(lukki_tiny:盒里的人每 update_every_n_frame 帧掉 damage_per_frame)
      const AD = e.d.areaDamage
      if (AD) {
        e.areaT = (e.areaT ?? AD.every) - dt
        if (e.areaT <= 0) { e.areaT = AD.every; const px = pl.x, py = pl.y - 4; if (px > e.x + AD.l - 3 && px < e.x + AD.r + 3 && py > e.y + AD.t - 8 && py < e.y + AD.b + 4) this.hooks.damagePlayer?.(AD.dmg, 0, 0, e) }
      }

      // ── 动画 ──
      if (e.state !== 'attack' && e.state !== 'shoot') {
        let want
        const A = e.d.sprite.anims
        if (e.flyer) want = Math.hypot(e.vx, e.vy) > 6 ? (A.fly_move ? 'fly_move' : 'walk') : (A.fly_idle ? 'fly_idle' : 'stand')
        else if (inLiq) want = Math.abs(e.vx) > 4 ? 'swim_move' : 'swim_idle'
        else if (!e.onGround && !e.crawler) want = e.vy < 0 ? 'jump_up' : 'jump_fall'
        else want = Math.hypot(e.vx, e.vy) > 3 ? (A.walk ? 'walk' : 'run') : 'stand'
        if (e.hurtT > 0 && e.d.sprite.anims.hurt) want = 'hurt'
        if (e.fireT > 0 && e.d.sprite.anims.burn) want = 'burn'
        this._setAnim(e, want, false)
      }
      const a = e.d.sprite.anims[e.anim]
      if (a) { e.ft += dt; while (e.ft >= a.wait) { e.ft -= a.wait; e.frame = a.loop ? (e.frame + 1) % a.frames : Math.min(a.frames - 1, e.frame + 1) } }

      // ── 材质伤害(materials_that_damage)/ 火 ──
      const m = this.matAt(Math.floor(e.x), Math.floor(e.y + e.box.t / 2))
      if (m > 0) {
        const n = this.mats.list[m]?.name
        if (n && e.d.damage?.materials_that_damage) {
          const idx = e.d.damage.materials_that_damage.split(',').indexOf(n)
          if (idx >= 0) { const per = +(e.d.damage.materials_how_much_damage || '').split(',')[idx] || 0.001; this.hurt(e, per * f60, 0, 0, 'material') }
        }
        if (n === 'fire' && Math.random() < (e.d.damage?.fire_probability_of_ignition ?? 0) * dt * 8) this.ignite(e)
      }
      this._burn(e, dt)
    }
  }

  /** 走路(CharacterPlatforming):重力 / 目标速度插值 / 子步进 / 爬台阶 / 遇墙跳 / 卡住给放弃 */
  _walkStep(e, dt, f60, inLiq, dy) {
    const xl = Math.floor(e.x + e.box.l), xr = Math.floor(e.x + e.box.r - 0.01), fy = Math.floor(e.y + e.box.b - 0.01) + 1
    e.onGround = this._solidC(xl, fy) || this._solidC(xr, fy) || this._solidC((xl + xr) >> 1, fy)
    if (e.onGround) {
      // 抛物跳落地:没落到路点上(撞墙掉回来 / 跳短了)→ 从这儿重算路,别走回起跳点再来一遍
      if (e.lobT > 0 && e.path && e.path[1] && (Math.abs(e.path[1][0] * 8 + 4 - e.x) > e.reachX || Math.abs(e.path[1][1] * 8 + 8 - (e.y + e.box.b)) > e.reachY)) e.pathT = 0
      e.lobT = 0
    }
    if (e.lobT > 0) e.lobT -= dt
    e.vy += (inLiq ? e.gravity * 0.25 : e.gravity) * dt
    const target = e.dir * e.run
    // 被黑洞吸着(pullT):这帧不按 AI 目标速度插值、不限速 —— 拉力说了算
    const pulled = e.pullT > 0
    if (pulled) e.pullT -= dt
    else if (e.lobT <= 0 || e.onGround) e.vx += (target - e.vx) * Math.min(1, e.accel * f60) // 抛物跳(lob)途中保持水平速度
    if (inLiq) { e.vx *= Math.pow(0.2, dt); e.vy *= Math.pow(0.15, dt); if (e.state === 'chase' && dy < -4) e.vy -= 300 * dt }
    if (!pulled) {
      if (e.lobT <= 0) e.vx = Math.max(-e.vmax, Math.min(e.vmax, e.vx))
      e.vy = Math.max(e.vyMin, Math.min(e.vyMax, e.vy))
    }
    // 1px 子步:2px 一步会跨过 1px 厚的墙 / 地板
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(e.vx), Math.abs(e.vy)) * dt))
    let blocked = false
    for (let s = 0; s < steps; s++) {
      const nx = e.x + (e.vx * dt) / steps
      if (!this._blocked(e, nx, e.y)) e.x = nx
      else {
        let ok = false
        // 爬台阶:先竖直抬 c px(这一段在原地必须一路是空的,不然会从 1~2px 厚的地板 / 平台边缘"抬"上去 = 穿墙),再横移
        for (let c = 1; c <= e.climb; c++) {
          if (this._blocked(e, e.x, e.y - c)) break
          if (!this._blocked(e, nx, e.y - c)) { e.x = nx; e.y -= c; ok = true; break }
        }
        if (!ok) { blocked = true; if (e.lobT <= 0) e.vx = 0 } // 抛物跳途中贴着墙上升,过了墙顶还要继续往前
      }
      const ny = e.y + (e.vy * dt) / steps
      if (!this._blocked(e, e.x, ny)) e.y = ny
      else e.vy = 0
    }
    // 卡进实心里(落沙 / 塌方 / 刚体压过来):就近挪出 ≤3px,挪不出就是被埋住了,原地不动
    if (this._unstick(e)) { e.lastX = e.x; return }
    const chasing = e.state === 'chase' || e.state === 'flee'
    // PathFinding(粗网格,PathFindingComponent 的替身):追人时人不在同一层 / 被挡 / 卡住 → 每 frames_between_searches 算一条 8px 网格路,照路点走 / 起跳
    let onPath = false
    if (e.state === 'chase' && (Math.abs(dy) > 14 || blocked || e.stuckT > 0.2 || e.path)) {
      e.pathT = (e.pathT || 0) - dt
      if (e.pathT <= 0 && e.onGround) { e.pathT = 0.4; e.path = this._findPath(e, this.player) }
      const wp = e.path && e.path[1]
      if (wp) {
        onPath = true
        const wx = wp[0] * 8 + 4, wy = wp[1] * 8 + 8, feet = e.y + e.box.b
        if (wp[2]) {
          // 跳边:先走到起跳格中心,再按抛物线起跳;空中保持
          const ox = e.path[0][0] * 8 + 4
          if (e.onGround && e.lobT <= 0) {
            if (Math.abs(e.x - ox) > 2.5) e.dir = Math.sign(ox - e.x)
            else this._jumpTo(e, wx, wy)
          }
        } else if (Math.abs(wx - e.x) > 2) e.dir = Math.sign(wx - e.x)
        if (Math.abs(wx - e.x) <= e.reachX && Math.abs(wy - feet) <= e.reachY) e.path.shift()
      } else if (e.path && e.path.length <= 1) e.path = null
      // 找不到路又撞墙:别在墙根一直蹦,歇一下再看
      if (!e.path && blocked && e.onGround && e.pathT > 0.35) { e.state = 'idle'; e.stateT = 1; e.dir = 0 }
    } else e.path = null
    if (!onPath && e.lobT <= 0) {
      // 没有路可照着走的时候的本能:撞墙 → 追人 / 逃命就试着跳上墙顶(≤ jumpMaxY),闲逛就掉头
      if (blocked && e.onGround && e.dir) {
        if (chasing && e.canJump) {
          const nx = e.x + e.dir * 3
          for (let h = e.climb + 1; h <= e.jumpMaxY; h++) if (!this._blocked(e, nx, e.y - h)) { this._jumpTo(e, e.x + e.dir * 8, e.y + e.box.b - h); break }
        } else if (e.state === 'wander') e.dir = -e.dir
      }
      // 前方是坑:追人时窄坑(≤24px)跳过去(人在下面就直接掉);闲逛不往悬崖走
      if (e.onGround && e.dir && !blocked) {
        const fy2 = Math.floor(e.y + e.box.b - 0.01) + 1
        const groundAt = (px) => { const gx = Math.floor(px); for (let r = 0; r <= 12; r++) if (this._solid(gx, fy2 + r)) return true; return false }
        const gapAhead = !groundAt(e.x + e.dir * 6)
        if (gapAhead && e.state === 'wander') e.dir = -e.dir
        else if (gapAhead && chasing && e.canJump && dy <= 8) {
          for (let k = 8; k <= 24; k += 4) if (groundAt(e.x + e.dir * k)) { this._jumpTo(e, e.x + e.dir * (k + 4), e.y + e.box.b); break }
        }
      }
    }
    // frames_to_get_stuck:追人时原地没挪窝超过这么久 → 立刻重算路;连着几次还是卡 → 放弃一会儿
    if (e.state === 'chase' && e.dir && e.onGround) {
      if (Math.abs(e.x - e.lastX) < 0.3) {
        e.stuckT += dt
        if (e.stuckT > e.stuckLimit) { e.stuckT = 0; e.pathT = 0; e.stuckN++; if (e.stuckN > 3) { e.stuckN = 0; e.state = 'idle'; e.stateT = 1.5; e.path = null } }
      } else { e.stuckT = 0; if (Math.abs(e.x - e.lastX) > 2) e.stuckN = 0 }
    } else e.stuckT = 0
    e.lastX = e.x
  }

  /**
   * 粗网格寻路(8px 格,Dijkstra 桶队列):格 (gx,gy) 的意思是"脚踩在这格的底边、身体居中在这格",
   * "能站" = 整个碰撞盒放这里不撞(真正的 _blocked,不再只采格心那一个像素)且脚下一行有实心。
   * 边:平走(1)、掉下去(≤12 格,途中每格都得能容身)、跳(can_jump:先直上 j 格再横移 i 格、再落下;i ≤ initial_jump_max_distance_x/8、j ≤ initial_jump_max_distance_y/8,
   * 每格都得能容身,代价 2+i+j 所以能走就不跳)。范围 ±24×±16 格、最多 800 节点。返回 [[gx,gy,jump],…],jump=1 表示到这个点要起跳。
   */
  _findPath(e, pl) {
    const S = 8, RX = 24, RY = 16, FALL = 12
    const sx = Math.floor(e.x / S), sy = Math.floor((e.y + e.box.b - 1) / S)
    const tx = Math.floor(pl.x / S), ty = Math.floor((pl.y + 1) / S)
    if (Math.abs(tx - sx) > RX || Math.abs(ty - sy) > RY) return null
    // 网格缓存(以起点为中心,x ±(RX+12)、y −(RY+8)..+(RY+FALL)):0 没算 / 1 能 / 2 不能
    const GW = (RX + 12) * 2 + 1, GH = RY + 8 + RY + FALL + 1, OX = sx - RX - 12, OY = sy - RY - 8
    const G = this._pathGrid && this._pathGrid.length >= GW * GH * 2 ? this._pathGrid : (this._pathGrid = new Uint8Array(GW * GH * 2))
    G.fill(0)
    const idx = (gx, gy) => { const ix = gx - OX, iy = gy - OY; return ix < 0 || iy < 0 || ix >= GW || iy >= GH ? -1 : (iy * GW + ix) * 2 }
    const free = (gx, gy) => {
      const k = idx(gx, gy); if (k < 0) return false
      let v = G[k]; if (!v) { v = this._blocked(e, gx * S + 4, gy * S + 8 - e.box.b) ? 2 : 1; G[k] = v }
      return v === 1
    }
    const stand = (gx, gy) => {
      const k = idx(gx, gy); if (k < 0) return false
      let v = G[k + 1]
      if (!v) {
        v = 2
        if (free(gx, gy)) { const cx = gx * S + 4, fy = gy * S + 8, xl = Math.floor(cx + e.box.l), xr = Math.floor(cx + e.box.r - 0.01); if (this._solidC(xl, fy) || this._solidC(xr, fy) || this._solidC((xl + xr) >> 1, fy)) v = 1 }
        G[k + 1] = v
      }
      return v === 1
    }
    let sy2 = sy; for (let k = 0; k < 3 && !stand(sx, sy2); k++) sy2++
    if (!stand(sx, sy2)) return null
    let ty2 = ty; for (let k = 0; k < 8 && !stand(tx, ty2); k++) ty2++
    if (!stand(tx, ty2)) return null
    const jx = e.canJump ? Math.min(12, Math.floor(e.jumpMaxX / S)) : 0, jy = e.canJump ? Math.min(8, Math.floor(e.jumpMaxY / S)) : 0
    // 升 j 格再落回同高度的滞空时间 × 横向速度上限(_jumpTo 的 140)= 这一跳横向最远几格
    const reachX = []
    for (let j = 0; j <= jy; j++) { const h = Math.max(6, j * S + 4), vy = Math.min(-e.vyMin, Math.sqrt(2 * e.gravity * h)); const t = (vy + Math.sqrt(Math.max(0, vy * vy - 2 * e.gravity * j * S))) / e.gravity; reachX.push(Math.min(jx, Math.floor((140 * t) / S))) }
    const key = (x, y) => (x - OX) * GH + (y - OY)
    const prev = new Map([[key(sx, sy2), null]])
    const cost = new Map([[key(sx, sy2), 0]])
    const buckets = [[[sx, sy2]]]
    const push = (fx, fy, nx, ny, c, jump) => {
      if (Math.abs(nx - sx) > RX || Math.abs(ny - sy) > RY) return
      const k = key(nx, ny), old = cost.get(k)
      if (old !== undefined && old <= c) return
      cost.set(k, c); prev.set(k, [fx, fy, jump ? 1 : 0])
      ;(buckets[c] || (buckets[c] = [])).push([nx, ny])
    }
    let found = null, n = 0
    for (let c = 0; c < buckets.length && !found && n < 600; c++) {
      const b = buckets[c]; if (!b) continue
      for (let bi = 0; bi < b.length && n < 600; bi++) {
        const [x, y] = b[bi]
        if (cost.get(key(x, y)) !== c) continue // 过期项
        n++
        if (Math.abs(x - tx) <= 1 && Math.abs(y - ty2) <= 1) { found = [x, y]; break }
        for (let di = 0; di < 2; di++) {
          const d = di ? 1 : -1, nx = x + d
          let walked = false
          if (free(nx, y)) {
            if (stand(nx, y)) { push(x, y, nx, y, c + 1, false); walked = true }
            else for (let j = 1; j <= FALL; j++) { if (!free(nx, y + j)) break; if (stand(nx, y + j)) { push(x, y, nx, y + j, c + 1 + (j >> 1), false); walked = true; break } }
          }
          // 跳(只在这一侧走不通 / 人在上面时才枚举,省算):直上 j 格(0 = 平跳)再朝这侧横移 i 格,每格能容身;落在第一个能站的格,或者从那儿掉下去
          if (!jx || (walked && ty2 >= y)) continue
          for (let j = 0; j <= jy; j++) {
            if (j > 0 && !free(x, y - j)) break
            const ix = reachX[j]
            for (let i = 1; i <= ix; i++) {
              const jxg = x + d * i, jyg = y - j
              if (!free(jxg, jyg)) break
              if (j === 0 && i === 1) continue // 平走已经算过
              if (stand(jxg, jyg)) { push(x, y, jxg, jyg, c + 3 + i + j, true); break }
              if (!free(jxg, jyg + 1)) continue // 脚下是实心但站不住(半格)→ 继续往前
              for (let k = 1; k <= FALL; k++) { if (!free(jxg, jyg + k)) break; if (stand(jxg, jyg + k)) { push(x, y, jxg, jyg + k, c + 3 + i + j + (k >> 1), true); break } }
            }
          }
        }
      }
    }
    if (!found) return null
    const path = []
    let cur = found
    while (cur) { const p = prev.get(key(cur[0], cur[1])); path.push([cur[0], cur[1], p ? p[2] : 0]); cur = p ? [p[0], p[1]] : null }
    return path.reverse()
  }

  /**
   * 飞行体的粗网格寻路(8px 格 BFS,四邻):"能飞的格" = 格心与身高覆盖的上格都不是实心;范围 ±32×±20 格、最多 900 节点;
   * 起点 / 终点落到最近的能飞格(周围 1 格内找)。返回 [[gx,gy],…] 或 null。
   */
  _findFlyPath(e, pl) {
    const S = 8
    // "能飞的格" = 身体整个碰撞盒放在这格(脚在格心)不撞(和真正移动用同一套 _blocked,45° 斜顶下不会误判)
    const free = (gx, gy) => !this._blocked(e, gx * S + 4, gy * S + 4 - e.box.b)
    const snap = (gx, gy) => { for (let r = 0; r <= 2; r++) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) if ((Math.abs(ox) === r || Math.abs(oy) === r) && free(gx + ox, gy + oy)) return [gx + ox, gy + oy]; return null }
    const s0 = snap(Math.floor(e.x / S), Math.floor((e.y + e.box.b - 1) / S)), t0 = snap(Math.floor(pl.x / S), Math.floor((pl.y - 4) / S))
    if (!s0 || !t0 || Math.abs(t0[0] - s0[0]) > 32 || Math.abs(t0[1] - s0[1]) > 20) return null
    const key = (x, y) => (x + 4096) * 8192 + (y + 4096)
    const prev = new Map([[key(s0[0], s0[1]), null]])
    const q = [s0]
    let found = null, n = 0
    while (q.length && n++ < 900) {
      const [x, y] = q.shift()
      if (Math.abs(x - t0[0]) <= 1 && Math.abs(y - t0[1]) <= 1) { found = [x, y]; break }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny)
        if (prev.has(k) || Math.abs(nx - s0[0]) > 32 || Math.abs(ny - s0[1]) > 20 || !free(nx, ny)) continue
        prev.set(k, [x, y]); q.push([nx, ny])
      }
    }
    if (!found) return null
    const path = []
    for (let k = key(found[0], found[1]), cur = found; cur; cur = prev.get(k), k = cur ? key(cur[0], cur[1]) : 0) path.push(cur)
    return path.reverse()
  }

  /** 飞行(can_fly):没有重力,朝目标点加速,追人时悬在人斜上方,闲逛在附近飘 */
  _flyStep(e, dt, dx, dy) {
    e.onGround = false
    let tx, ty
    const pl = this.player
    if (e.state === 'chase' || e.state === 'shoot' || e.state === 'attack') {
      // 近战的直接扑;远程的悬在人斜上方
      const stand = e.ranged && !e.melee || (e.ranged && Math.hypot(dx, dy) > e.meleeDist * 2)
      tx = pl.x + (stand ? e.flySide * 40 : 0); ty = pl.y + (stand ? e.flyHover : -6)
      if (e.state === 'shoot' || e.state === 'attack') { tx = e.x; ty = e.y }
    } else if (e.state === 'flee') { tx = e.x - Math.sign(dx) * 80; ty = e.y - 30 }
    else {
      if (!e.wanderTo || e.stateT <= 0.2) { e.wanderTo = [e.x + (Math.random() - 0.5) * 120, e.y + (Math.random() - 0.5) * 60] }
      tx = e.wanderTo[0]; ty = e.wanderTo[1]
    }
    // 飞行寻路(PathFinding can_fly 的替身):追人时看不见人 / 撞了墙 → 每 0.4s 在 8px 空气格上 BFS 一条路,朝下一个路点飞(圣山里 Stevari 绕内墙、蝙蝠绕柱子)
    if (e.state === 'chase' && (e.flyBlockT > 0 || !this._sees(e, pl))) {
      e.pathT = (e.pathT || 0) - dt
      if (e.pathT <= 0) { e.pathT = 0.4; e.path = this._findFlyPath(e, pl) }
      const wp = e.path && e.path[1]
      if (wp) {
        tx = wp[0] * 8 + 4; ty = wp[1] * 8 + 4 - e.box.b // 路点是脚下那格
        if (Math.abs(tx - e.x) < 5 && Math.abs(ty - e.y) < 5) e.path.shift()
      }
    } else e.path = null
    if (e.flyBlockT > 0) e.flyBlockT -= dt
    const ddx = tx - e.x, ddy = ty - e.y, l = Math.hypot(ddx, ddy)
    const sp = e.flySpeed * (e.state === 'chase' ? 1 : 0.5)
    // lukki(PhysicsAI target_vec_max_len):到了腿够得着的距离就停下,靠攻击腿打人
    const stop = e.keepDist && e.state === 'chase' && l < e.keepDist
    const wvx = l > 4 && !stop ? (ddx / l) * sp : 0, wvy = l > 4 && !stop ? (ddy / l) * sp : 0
    e.vx += (wvx - e.vx) * Math.min(1, 4 * dt); e.vy += (wvy - e.vy) * Math.min(1, 4 * dt)
    // 一点上下浮动
    e.vy += Math.sin(this.time * 5 + e.x) * 12 * dt
    if (Math.abs(e.vx) > 2) e.face = Math.sign(e.vx)
    if (e.d.ghost) { e.x += e.vx * dt; e.y += e.vy * dt; return } // 幽灵(GhostComponent):穿墙
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(e.vx), Math.abs(e.vy)) * dt))
    // CellEaterComponent(lukki / lukki_tiny):挡住了就把前方 radius 内的格吃掉再过去(原作是一直吃身边 radius 内的格;这里只在被挡时吃,少挖些)。wiki:"要先在动才挖得动"
    const eat = e.eatR > 0 && Math.hypot(e.vx, e.vy) > 8 && e.state !== 'idle'
    for (let s = 0; s < steps; s++) {
      const nx = e.x + (e.vx * dt) / steps
      if (!this._blocked(e, nx, e.y)) e.x = nx
      else if (eat) { this._eatCells(nx, e.y, e.eatR); e.x = nx }
      else {
        // 斜坡 / 台阶:上下挪 ≤4px 能过就过(飞行体贴着 45° 斜顶滑),不行才弹回
        // 滑的那一段(原地竖着 / 横着挪 c px)必须一路是空的,只查终点会从 1~2px 厚的板子那边"滑"过去(穿墙)
        let slid = false, upOk = true, dnOk = true
        for (let c = 1; c <= 4 && !slid; c++) {
          if (upOk && this._blocked(e, e.x, e.y - c)) upOk = false
          if (dnOk && this._blocked(e, e.x, e.y + c)) dnOk = false
          if (upOk && !this._blocked(e, nx, e.y - c)) { e.x = nx; e.y -= c; slid = true } else if (dnOk && !this._blocked(e, nx, e.y + c)) { e.x = nx; e.y += c; slid = true }
        }
        if (!slid) { e.vx = -e.vx * 0.3; e.wanderTo = null; e.flyBlockT = 1.5 }
      }
      const ny = e.y + (e.vy * dt) / steps
      if (!this._blocked(e, e.x, ny)) e.y = ny
      else if (eat) { this._eatCells(e.x, ny, e.eatR); e.y = ny }
      else {
        let slid = false, lOk = true, rOk = true
        for (let c = 1; c <= 4 && !slid; c++) {
          if (lOk && this._blocked(e, e.x - c, e.y)) lOk = false
          if (rOk && this._blocked(e, e.x + c, e.y)) rOk = false
          if (lOk && !this._blocked(e, e.x - c, ny)) { e.y = ny; e.x -= c; slid = true } else if (rOk && !this._blocked(e, e.x + c, ny)) { e.y = ny; e.x += c; slid = true }
        }
        if (!slid) { e.vy = -e.vy * 0.3; e.wanderTo = null; e.flyBlockT = 1.5 }
      }
    }
    if (this._buried(e, e.x, e.y)) { if (eat) this._eatCells(e.x, e.y, e.eatR); else this._unstick(e) }
  }

  /** CellEater:圆内非 box2d 的格全变空气(虫 / lukki 共用) */
  _eatCells(x, y, R) {
    const sim = this.sim, cx = Math.floor(x), cy = Math.floor(y)
    for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) {
      if (xx * xx + yy * yy > R * R) continue
      const m = sim.get(cx + xx, cy + yy)
      if (m > 0 && this.mats.kind[m] !== 'solid') sim.set(cx + xx, cy + yy, 0, 0)
    }
  }

  /**
   * lukki 的腿(IKLimbComponent length,两段式 IK):脚踩住 length 内的实心,身体走远(>0.97 len)/ 太近 / 踩的格没了就换脚:
   * 沿腿的"本位角"(绕身体均分)±0.45 / ±0.9 rad 各射一条线,从体半径外到 0.92 len,第一格实心前的空格就是新落脚点;都没有就悬着晃(IKLimbsAnimator 的 wiggle)。
   * 攻击腿(IKLimbAttackerComponent radius):idle → 人进 radius 抬腿 aim 0.45s(脚跟着人)→ jab 0.15s 刺到人 → 0.5 伤 + 击退 → recover → 1.4s 冷却。隐身也照打(wiki)。
   */
  _legsStep(e, dt) {
    const pl = this.player, px = pl.x, py = pl.y - 4
    const speed = Math.hypot(e.vx, e.vy)
    for (let i = 0; i < e.legs.length; i++) {
      const g = e.legs[i]
      g.cool -= dt
      if (g.L.attacker) { this._attackLeg(e, g, dt, px, py); continue }
      if (g.planted) {
        const d = Math.hypot(g.fx - e.x, g.fy - e.y)
        if (d > g.len * 0.97 || d < g.len * 0.12 || !this._solidNear(g.fx, g.fy)) g.planted = false
        else if (speed > 3 && d > g.len * 0.8 && (g.fx - e.x) * e.vx + (g.fy - e.y) * e.vy < 0) g.planted = false // 拖在身后快到极限的腿先换,免得全部腿同时跳
      }
      if (!g.planted && g.cool <= 0) {
        const hit = this._legFindFoot(e, g)
        if (hit) { g.tx = hit[0]; g.ty = hit[1]; g.planted = true; g.moving = 1; g.cool = 0.12 + (i % 3) * 0.04 }
        else g.cool = 0.1
      }
      let tx, ty
      if (g.planted) { tx = g.tx; ty = g.ty }
      else { const a = g.home + Math.sin(this.time * 4 + i * 1.7) * 0.35; tx = e.x + Math.cos(a) * g.len * 0.7; ty = e.y + Math.sin(a) * g.len * 0.7 + g.len * 0.1 }
      const k = g.planted ? Math.min(1, 22 * dt) : Math.min(1, 8 * dt)
      g.fx += (tx - g.fx) * k; g.fy += (ty - g.fy) * k
    }
  }

  _solidNear(x, y) {
    const cx = Math.floor(x), cy = Math.floor(y)
    return this._solid(cx, cy) || this._solid(cx + 1, cy) || this._solid(cx - 1, cy) || this._solid(cx, cy + 1) || this._solid(cx, cy - 1)
  }

  _legFindFoot(e, g) {
    const speed = Math.hypot(e.vx, e.vy)
    let base = g.home
    if (speed > 3) { let da = Math.atan2(e.vy, e.vx) - g.home; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; base += Math.max(-0.5, Math.min(0.5, da * 0.3)) }
    const r0 = (e.bodyR || 8) + 2, r1 = g.len * 0.92
    for (const off of [0, 0.45, -0.45, 0.9, -0.9]) {
      const a = base + off, c = Math.cos(a), s = Math.sin(a)
      let lx = e.x + c * r0, ly = e.y + s * r0
      if (this._solid(Math.floor(lx), Math.floor(ly))) continue // 贴身就是实心(埋在土里):这条方向不用
      for (let t = r0 + 2; t <= r1; t += 2) {
        const x = e.x + c * t, y = e.y + s * t
        if (this._solid(Math.floor(x), Math.floor(y))) return [lx, ly]
        lx = x; ly = y
      }
    }
    return null
  }

  _attackLeg(e, g, dt, px, py) {
    const dx = px - e.x, dy = py - e.y, dist = Math.hypot(dx, dy) || 1
    g.cd -= dt; g.t += dt
    let tx, ty, k = 8
    const idleTarget = () => {
      if (dist < g.L.attacker * 1.5) { const r = Math.min(g.len * 0.6, dist * 0.5); tx = e.x + (dx / dist) * r; ty = e.y + (dy / dist) * r - 4 }
      else { const a = g.home + Math.sin(this.time * 4 + 3.1) * 0.35; tx = e.x + Math.cos(a) * g.len * 0.7; ty = e.y + Math.sin(a) * g.len * 0.7 + g.len * 0.1 }
    }
    if (g.phase === 'idle') {
      idleTarget()
      if (dist < g.L.attacker + 6 && g.cd <= 0) { g.phase = 'aim'; g.t = 0 }
    } else if (g.phase === 'aim') {
      tx = px - (dx / dist) * 10; ty = py - (dy / dist) * 10 - 8; k = 12
      if (g.t > 0.45) { g.phase = 'jab'; g.t = 0; g.hit = false; this.hooks.sfx?.('wind', { vol: 0.25, rate: 1.8, minGap: 100 }) }
    } else if (g.phase === 'jab') {
      tx = px; ty = py; k = 45
      if (!g.hit && Math.hypot(g.fx - px, g.fy - py) < 7 && dist < g.len + 6) { g.hit = true; this.hooks.damagePlayer?.(0.5, Math.sign(dx || 1) * 120, -70, e); this.hooks.sfx?.('impact', { vol: 0.5, rate: 1.1, minGap: 80 }) }
      if (g.t > 0.15) { g.phase = 'recover'; g.t = 0; g.cd = 1.4 }
    } else { idleTarget(); k = 6; if (g.t > 0.3) g.phase = 'idle' }
    // 脚够不到比腿长更远的地方
    const ex = tx - e.x, ey = ty - e.y, l = Math.hypot(ex, ey)
    if (l > g.len) { tx = e.x + (ex / l) * g.len; ty = e.y + (ey / l) * g.len }
    const kk = Math.min(1, k * dt)
    g.fx += (tx - g.fx) * kk; g.fy += (ty - g.fy) * kk
  }

  /** 画一条腿:根 → 膝 → 脚,两段各 len/2(limb_A / limb_B 图宽就是 len/2,offset_y 5 = 图的竖向中线在关节线上),膝盖图 8×8 盖在膝上;膝朝上 / 朝外弯 */
  _drawLeg(ctx, e, g, ox, oy) {
    const L = g.L, ia = L.a ? this._img(L.a.img) : null, ib = L.b ? this._img(L.b.img) : null
    if (!ia?.image || !ib?.image) return
    const rx = e.x, ry = e.y
    let dx = g.fx - rx, dy = g.fy - ry, d = Math.hypot(dx, dy) || 0.01
    const half = g.len / 2
    if (d > g.len - 0.5) { const s = (g.len - 0.5) / d; dx *= s; dy *= s; d = g.len - 0.5 }
    const h = Math.sqrt(Math.max(0, half * half - (d / 2) * (d / 2)))
    let nx = -dy / d, ny = dx / d
    if (nx * Math.sign(dx || 1) * 0.5 - ny < 0) { nx = -nx; ny = -ny } // 膝盖朝上偏外
    const kx = rx + dx / 2 + nx * h, ky = ry + dy / 2 + ny * h
    const seg = (img, x0, y0, x1, y1, oyy) => {
      const a = Math.atan2(y1 - y0, x1 - x0), len = Math.hypot(x1 - x0, y1 - y0)
      ctx.save(); ctx.translate(Math.round(x0 - ox), Math.round(y0 - oy)); ctx.rotate(a)
      ctx.drawImage(img.image, 0, 0, img.width, img.height, 0, -oyy, Math.max(1, len), img.height)
      ctx.restore()
    }
    seg(ia, rx, ry, kx, ky, L.a.oy)
    seg(ib, kx, ky, g.fx, g.fy, L.b.oy)
    const ik = L.knee ? this._img(L.knee.img) : null
    if (ik?.image) ctx.drawImage(ik.image, Math.round(kx - ox - L.knee.ox), Math.round(ky - oy - L.knee.oy))
  }

  /**
   * verlet 触手(VerletPhysicsComponent,giantshooter 的 5 条黏液触手):点 0 钉在 实体位置 + InheritTransform 偏移(x 随朝向翻),
   * 其余点 verlet 积分:v = (p − p_prev) × velocity_dampening(0.8/帧),重力 400(VelocityComponent 默认,verlet 自己的常数没反出来)× mass,
   * 再加一点 simulate_wind 的横向摆(exe 0xd67de0:sin(t×25)·sin(y×5)… 的叠加,这里只取一项);链约束 resting_distance,stiffness 1.25 → 满量修正,
   * 迭代 2 轮;collide_with_cells:进实心就退回上一帧位置。
   */
  _tentaclesStep(e, dt) {
    const sim = this.sim, face = e.face || 1, t = this.time
    const g = 400 * dt * dt
    for (const c of e.tents) {
      const T = c.T, P = c.pts, n = P.length
      const p0 = P[0]; p0.px = p0.x; p0.py = p0.y; p0.x = e.x + T.x * face; p0.y = e.y + T.y
      const wind = Math.sin(t * 5 + T.x) * Math.sin(t * 1.3) * 30 * dt * dt
      for (let i = 1; i < n; i++) {
        const p = P[i], vx = (p.x - p.px) * T.damp, vy = (p.y - p.py) * T.damp
        p.px = p.x; p.py = p.y
        p.x += vx + wind * p.m; p.y += vy + g * p.m
      }
      const k = Math.min(1, T.stiff)
      for (let it = 0; it < 2; it++) for (let i = 1; i < n; i++) {
        const a = P[i - 1], b = P[i]
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.001, diff = ((d - T.rest) / d) * k
        if (i === 1) { b.x -= dx * diff; b.y -= dy * diff } else { a.x += dx * diff * 0.5; a.y += dy * diff * 0.5; b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5 }
      }
      for (let i = 1; i < n; i++) {
        const p = P[i], m = sim.get(Math.floor(p.x), Math.floor(p.y))
        if (m > 0 && sim.kind[m] === 1) { p.x = p.px; p.y = p.py }
      }
    }
  }

  /** 触手:每个点一张 2×2 / 2×1 的小片(piece xml 的 SpriteComponent offset_y 是锚点),cloth z 在身体后面 → 先画 */
  _drawTentacles(ctx, e, ox, oy) {
    for (const c of e.tents) {
      const T = c.T
      for (let i = 1; i < c.pts.length; i++) {
        const pc = T.pieces[Math.min(i - 1, T.pieces.length - 1)], img = this._img(pc.img)
        if (!img?.image) continue
        const p = c.pts[i]
        ctx.drawImage(img.image, Math.round(p.x - ox - img.width / 2), Math.round(p.y - oy - pc.oy))
      }
    }
  }

  /**
   * 爬墙(longleg):surf = 实心贴在哪一侧('d' 地 / 'u' 顶 / 'l' 左墙 / 'r' 右墙),沿切向朝目标爬,
   * 撞到前方的墙就转上去,爬到边缘就绕过去,哪边都没有就掉。精灵按 surf 旋转(脚朝实心)。
   */
  _crawlStep(e, dt, dx, dy) {
    const xl = Math.floor(e.x + e.box.l), xr = Math.floor(e.x + e.box.r - 0.01), yt = Math.floor(e.y + e.box.t), yb = Math.floor(e.y + e.box.b)
    const ym = Math.floor((yt + yb) / 2), xm = Math.floor((xl + xr) / 2)
    const has = { d: this._solid(xl, yb + 1) || this._solid(xm, yb + 1) || this._solid(xr, yb + 1), u: this._solid(xl, yt - 1) || this._solid(xm, yt - 1) || this._solid(xr, yt - 1), l: this._solid(xl - 1, yt) || this._solid(xl - 1, ym) || this._solid(xl - 1, yb), r: this._solid(xr + 1, yt) || this._solid(xr + 1, ym) || this._solid(xr + 1, yb) }
    if (!e.surf || !has[e.surf]) e.surf = has.d ? 'd' : has.l ? 'l' : has.r ? 'r' : has.u ? 'u' : null
    e.onGround = !!e.surf
    if (!e.surf) {
      // 掉
      e.vy += e.gravity * dt; e.vx *= Math.pow(0.3, dt)
      const steps = Math.max(1, Math.ceil(Math.abs(e.vy) * dt / 2))
      for (let s = 0; s < steps; s++) { const ny = e.y + (e.vy * dt) / steps; if (!this._blocked(e, e.x, ny)) e.y = ny; else { e.vy = 0; break } const nx = e.x + (e.vx * dt) / steps; if (!this._blocked(e, nx, e.y)) e.x = nx }
      return
    }
    // 切向:地/顶沿 x,墙沿 y;方向朝目标(追)/ 闲逛方向
    const horiz = e.surf === 'd' || e.surf === 'u'
    let want = 0
    if (e.state === 'chase' || e.state === 'flee') {
      // 地/顶上朝目标的 x 走;墙上朝目标的 y 爬,目标在同一高度被墙挡着就往上翻
      want = horiz ? Math.sign(dx) : (Math.abs(dy) < 8 ? -1 : Math.sign(dy))
      if (e.state === 'flee') want = -want
    }
    else if (e.state === 'wander') want = e.dir || 1
    const sp = e.run
    let mvx = horiz ? want * sp : 0, mvy = horiz ? 0 : want * sp
    e.vx = mvx; e.vy = mvy
    if (horiz && want) e.face = want
    const stepN = Math.max(1, Math.ceil(sp * dt)) // 1px 一步(2px 会跨过 1px 厚的墙)
    for (let s = 0; s < stepN && want; s++) {
      const nx = e.x + (mvx * dt) / stepN, ny = e.y + (mvy * dt) / stepN
      if (!this._blocked(e, nx, ny)) {
        e.x = nx; e.y = ny
        // 走到边缘(贴着的那侧没了)→ 绕过拐角:往贴着的方向挪,surf 变成背向来路
        const xl2 = Math.floor(e.x + e.box.l), xr2 = Math.floor(e.x + e.box.r - 0.01), yt2 = Math.floor(e.y + e.box.t), yb2 = Math.floor(e.y + e.box.b)
        const adhere = () => {
          const a = Math.floor(e.x + e.box.l), b2 = Math.floor(e.x + e.box.r - 0.01), t = Math.floor(e.y + e.box.t), bb = Math.floor(e.y + e.box.b), m = Math.floor((a + b2) / 2), mm = Math.floor((t + bb) / 2)
          return e.surf === 'd' ? this._solid(a, bb + 1) || this._solid(m, bb + 1) || this._solid(b2, bb + 1) : e.surf === 'u' ? this._solid(a, t - 1) || this._solid(m, t - 1) || this._solid(b2, t - 1) : e.surf === 'l' ? this._solid(a - 1, t) || this._solid(a - 1, mm) || this._solid(a - 1, bb) : this._solid(b2 + 1, t) || this._solid(b2 + 1, mm) || this._solid(b2 + 1, bb)
        }
        if (!adhere()) {
          // 贴着的那侧没了:先当下坡,往贴着的方向贴回去(≤4px);还贴不上才是真拐角 → 绕过去
          const push = e.surf === 'd' ? [0, 1] : e.surf === 'u' ? [0, -1] : e.surf === 'l' ? [-1, 0] : [1, 0]
          let ok = false
          for (let k = 1; k <= 4 && !ok; k++) { const px = e.x + push[0], py = e.y + push[1]; if (this._blocked(e, px, py)) break; e.x = px; e.y = py; if (adhere()) ok = true }
          if (!ok) {
            let wrapped = false
            for (let k = 1; k <= 3; k++) { const px = e.x + push[0], py = e.y + push[1]; if (this._blocked(e, px, py)) break; e.x = px; e.y = py; wrapped = true } // 1px 一步一路查,别隔着板子挪过去
            e.surf = wrapped ? (horiz ? (want > 0 ? 'l' : 'r') : (want > 0 ? 'u' : 'd')) : null
            break
          }
        }
      } else {
        // 小坎(≤4px)直接跨;真墙才转上去(新 surf = 前方)
        let stepped = false
        const back = e.surf === 'd' ? [0, -1] : e.surf === 'u' ? [0, 1] : e.surf === 'l' ? [1, 0] : [-1, 0]
        for (let c = 1; c <= 4 && !stepped; c++) {
          if (this._blocked(e, e.x + back[0] * c, e.y + back[1] * c)) break // 原地先抬 c px 必须一路是空的(否则从薄板另一侧穿出去)
          const px = nx + back[0] * c, py = ny + back[1] * c
          if (!this._blocked(e, px, py)) { e.x = px; e.y = py; stepped = true }
        }
        if (stepped) continue
        e.surf = horiz ? (want > 0 ? 'r' : 'l') : (want > 0 ? 'd' : 'u')
        if (e.state === 'wander') e.dir = -e.dir
        break
      }
    }
    this._unstick(e)
  }

  /** 视线:从眼睛到目标每 4px 采一格,碰到实心就看不见(sense_creatures_through_walls 的除外) */
  _sees(e, pl) {
    if (e.d.ai?.sense_creatures_through_walls) return true
    const x0 = e.x, y0 = e.y + (e.d.ai?.eye_offset_y ?? -8), x1 = pl.x, y1 = pl.y - 4
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4))
    for (let i = 1; i < n; i++) { const t = i / n; if (this._solid(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t))) return false }
    return true
  }

  /** 远程开火:attack_ranged_entity_file → e_<名>;count_min~max 发;predict 提前量;抛物弹(TNT/火球)抬一点角度 */
  _shoot(e, pl) {
    const d = this.projectiles?.defs?.[e.rangedProj]
    if (!d) return
    const sx = e.x + e.face * e.rangedOff[0], sy = e.y + e.rangedOff[1]
    let tx = pl.x, ty = pl.y - 4
    const dist = Math.hypot(tx - sx, ty - sy)
    const spd = (d.speed[0] + d.speed[1]) / 2 || 200
    if (e.rangedPredict) { const t = dist / spd; tx += pl.vx * t; ty += pl.vy * t }
    let ang = Math.atan2(ty - sy, tx - sx)
    // 有重力的弹(TNT g=0? 但是刚体抛物 / 火球 g=100)抬角补落差
    const g = d.type === 'PHYSICS' ? 350 : (d.gravity || 0)
    if (g > 0) ang -= Math.min(0.6, (g * dist) / (2 * spd * spd))
    const n = e.rangedCount[0] + Math.floor(Math.random() * (e.rangedCount[1] - e.rangedCount[0] + 1))
    for (let i = 0; i < n; i++) this.projectiles.spawn(e.rangedProj, sx, sy, ang, { owner: 'enemy', spreadRad: n > 1 ? 0.25 : 0.04 })
    this.hooks.sfx?.(d.type === 'PHYSICS' ? 'clash' : 'electric', { vol: 0.3, rate: 0.9 + Math.random() * 0.3, minGap: 50 })
  }

  _setAnim(e, name, lock) {
    const anims = e.d.sprite.anims
    if (!anims[name]) { if (name === 'run' && anims.walk) name = 'walk'; else if (name.startsWith('swim') && anims.walk) name = 'walk'; else if (name.startsWith('jump') && anims.stand) name = 'stand'; else if (!anims[name]) return }
    if (e.anim === name) return
    e.anim = name; e.frame = 0; e.ft = 0; e.animLock = lock ? 1 : 0
  }

  /** 弹丸子步进命中测试:返回被打到的实体 */
  hitTest(x, y) {
    for (const e of this.list) {
      if (e.dead) continue
      if (x >= e.x + e.hit.l && x <= e.x + e.hit.r && y >= e.y + e.hit.t && y <= e.y + e.hit.b) return e
    }
    const w = this._hitWorm(x, y); if (w) return w
    for (const b of this.bodies) if (!b.dead && b.contains(x, y)) return b
    return null
  }
  /** range 内最近(或随机一个)活着的怪的 hitbox 中心;los=true 要求中间没实心格挡着(RaytraceSurfaces) */
  nearest(x, y, range, { random = false, los = false } = {}) {
    const cands = []
    let best = null, bd = Infinity
    for (const e of this.list) {
      if (e.dead || e.isBody) continue
      const cx = e.x, cy = e.y + (e.hit.t + e.hit.b) / 2, d = Math.hypot(cx - x, cy - y)
      if (d > range) continue
      if (los && this._blockedLine(x, y, cx, cy)) continue
      if (random) cands.push({ x: cx, y: cy, e })
      else if (d < bd) { bd = d; best = { x: cx, y: cy, e } }
    }
    if (random) return cands.length ? cands[(Math.random() * cands.length) | 0] : null
    return best
  }
  _blockedLine(x0, y0, x1, y1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0))
    for (let i = 1; i < n; i++) { const t = i / n, m = this.sim.get(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t)); if (m > 0 && this.sim.kind[m] === 1) return true }
    return false
  }
  /** 只测刚体(敌人的弹不打自己人) */
  hitTestBodies(x, y) {
    for (const b of this.bodies) if (!b.dead && b.contains(x, y)) return b
    return null
  }

  /**
   * 掉血:喷 blood_material(真材质碎屑),hp≤0 死亡 → 尸体按 RAGDOLL_FX 处理;刚体走 _bodyDamaged
   * @param {{ragdollFx?:string|number, effects?:string[]}} [opts]  伤害自带的尸体效果(弹丸 ragdoll_fx_on_collision / 卡 c.ragdoll_fx)与命中时给的状态
   */
  hurt(e, dmg, ix = 0, iy = 0, src = 'proj', hx = e.x, hy = e.y, opts = null) {
    if (e.dead || dmg <= 0) return
    if (e.isBody) {
      if (e.asleep && (Math.abs(ix) + Math.abs(iy) > 40 || src === 'explosion')) e.wake(this.sim)
      if (!e.asleep) { e.vx += ix * (10 / Math.max(10, e.m)); e.vy += iy * (10 / Math.max(10, e.m)); e.restT = 0 }
      // 弹丸命中刚体:原版弹丸自带的小爆炸会把 box2d 像素挖掉一块(玻璃 / 木头的 durability 低)→ physics_body_modified;命中点抠 1.5px
      let lost = 0
      if (src === 'proj' && !e.isItem) { lost = e.carve(hx, hy, 1.5); if (lost && e.asleep) e.wake(this.sim) }
      this._bodyDamaged(e, dmg, lost, hx, hy)
      if (src === 'proj') this.hooks.sfx?.('impact', { vol: 0.3, rate: 0.9, minGap: 60 })
      return
    }
    if (e.d.invulnerable) return // 幽灵:damage_multipliers 全 0,只能打碎它的水晶
    // DamageModel damage_multipliers(lukki:projectile 0.2 / explosion 0.8 / fire 1.2 / melee 2.0)
    const mul = e.d.damage?.multipliers
    if (mul) { const key = src === 'proj' ? 'projectile' : src; if (mul[key] !== undefined) dmg *= mul[key] }
    const hp0 = e.hp
    e.hp -= dmg
    e.vx += ix; e.vy += iy
    if (src === 'black_hole' || src === 'electricity') e.hurtT = 0.1
    // lukki_eggs.lua damage_received:伤 >0.1 且(致死 或 10%)→ 出一只小蜘蛛
    if (e.d.eggs && dmg > 0.1 && (e.hp <= 0 || Math.random() < 0.1)) { this.spawnCreature(e.d.eggs, e.x + (Math.random() - 0.5) * 6, e.y); this.hooks.sfx?.('clash', { vol: 0.4, rate: 1.6, minGap: 100 }) }
    // giantshooter_death.lua damage_received:hp 从 ≥0.3 被这一下打到 <0.3(致死那一下也算)→ 原地 ±10 出 3 只 slimeshooter,速度 x −90~90 / y −150~25
    const SB = e.d.splitBelow
    if (SB && hp0 > SB.hp && e.hp < SB.hp) {
      const R = (a, b) => a + Math.random() * (b - a)
      for (let i = 0; i < SB.count; i++) { const s = this.spawnCreature(SB.spawn, e.x + R(-SB.offset, SB.offset), e.y + R(-SB.offset, SB.offset)); if (s) { s.vx = R(SB.vx[0], SB.vx[1]); s.vy = R(SB.vy[0], SB.vy[1]); s.state = 'chase'; s.stateT = 3 } }
      this.hooks.sfx?.('clash', { vol: 0.5, rate: 0.9, minGap: 100 })
    }
    if (src === 'proj' || src === 'explosion') {
      e.hurtT = 0.25
      // MaterialInventory leak_on_damage_percent(giantshooter 400 酸 99.9%):被弹丸打到就从伤口漏一小股,漏光为止
      if (e.inventory && src === 'proj' && Math.random() < (e.d.inventory?.leak_on_damage_percent ?? 0)) this._leak(e, hx, hy, 6 + Math.round(Math.random() * 8))
      if (e.state !== 'attack' && !e.helpless) { e.state = 'chase'; e.stateT = 4 }
      if (e.helpless || (e.escapeP && Math.random() * 100 < e.escapeP)) { e.state = 'flee'; e.stateT = 2 } // escape_if_damaged_probability
      const spray = this.mats.byName.get(e.d.damage?.blood_spray_material || e.d.damage?.blood_material || '')
      if (spray > 0) { const n = Math.min(12, 3 + Math.round(dmg * 30)); for (let i = 0; i < n; i++) this.hooks.debris?.(e.x + (Math.random() - 0.5) * 4, e.y + e.hit.t + Math.random() * (e.hit.b - e.hit.t), ix * 0.6 + (Math.random() - 0.5) * 80, iy * 0.6 - Math.random() * 60, spray, this.mats.color[spray]) }
      this.hooks.sfx?.('impact', { vol: 0.35, rate: 1.4 + Math.random() * 0.3, minGap: 60 })
    }
    if (e.hp <= 0) this._die(e, ix, iy, src, opts)
  }

  /**
   * 反 exe DamageModelSystem::KillMe 里 ragdoll_fx 的决定顺序:
   *   伤害自带的 fx(弹丸 ragdoll_fx_on_collision / 法术卡 c.ragdoll_fx:火箭类 2=BLOOD_EXPLOSION、GORE 3=BLOOD_SPRAY)
   *   → 身上 GameEffect 的 ragdoll_effect 取最大(effect_frozen FROZEN + ragdoll_material ice_glass_b2、effect_disintegrated DISINTEGRATED + soil)
   *   → create_ragdoll=0 或 ragdoll_filenames_file 为空 → NO_RAGDOLL_FILE(整张精灵变一块刚体)
   *   → NORMAL 且弹丸 / 爆炸伤害:DAMAGE_BLOOD_SPRAY_CHANCE 20% 变 BLOOD_SPRAY
   *   → ragdoll_fx_forced 覆盖一切(幽灵 / 幻影 / 雕像 DISINTEGRATED = 化尘无尸)
   * 枚举顺序(exe 字符串表):0 NONE 1 NORMAL 2 BLOOD_EXPLOSION 3 BLOOD_SPRAY 4 FROZEN 5 CONVERT_TO_MATERIAL 6 CUSTOM_RAGDOLL_ENTITY 7 DISINTEGRATED 8 NO_RAGDOLL_FILE 9 PLAYER_RAGDOLL_CAMERA
   */
  static RAGDOLL_FX = ['NONE', 'NORMAL', 'BLOOD_EXPLOSION', 'BLOOD_SPRAY', 'FROZEN', 'CONVERT_TO_MATERIAL', 'CUSTOM_RAGDOLL_ENTITY', 'DISINTEGRATED', 'NO_RAGDOLL_FILE', 'PLAYER_RAGDOLL_CAMERA']
  _ragdollFx(e, src, opts) {
    const FX = Entities.RAGDOLL_FX
    const idx = (n) => Math.max(0, FX.indexOf(String(n || '').toUpperCase()))
    let fx = typeof opts?.ragdollFx === 'number' ? Math.min(9, Math.max(0, opts.ragdollFx | 0)) : idx(opts?.ragdollFx)
    let mat = null
    // 身上的 game effect(children 的 GameEffectComponent.ragdoll_effect,取最大;它的 ragdoll_material 顶掉 DamageModel 的)
    const eff = []
    if (e.frozenT > 0) eff.push(['FROZEN', 'ice_glass_b2'])
    if (opts?.effects?.includes('frozen')) eff.push(['FROZEN', 'ice_glass_b2'])
    if (opts?.effects?.includes('disintegrated')) eff.push(['DISINTEGRATED', 'soil'])
    for (const [n, m] of eff) { const k = idx(n); if (k > fx) { fx = k; mat = m } }
    const D = e.d.damage || {}
    if (D.create_ragdoll === 0 || !e.d.ragdoll?.length) fx = Math.max(fx, 8)
    if (fx <= 1 && (src === 'proj' || src === 'explosion') && Math.random() * 100 < 20) fx = 3 // DAMAGE_BLOOD_SPRAY_CHANCE(exe 默认 20)
    if (D.ragdoll_fx_forced) fx = idx(D.ragdoll_fx_forced)
    if (fx === 0) fx = 1 // NONE 和 NORMAL 走同一个分支(switch 表 0/1 → 同一块)
    return { fx: FX[fx] || 'NORMAL', mat }
  }

  _die(e, ix = 0, iy = 0, src = 'proj', opts = null) {
    e.dead = true
    this.stats.killed++
    // ExplosionComponent trigger=ON_DEATH(地雷 mine_scavenger:r30 伤 4 起火 80%)
    if (e.d.explosionOnDeath) this.explodeConfig(e.x, e.y, e.d.explosionOnDeath)
    // ExplodeOnDamageComponent explode_on_death_percent(giantshooter:r30 伤 3、坑里 70% 填酸;坦克 / 炮塔 / 无人机也是这样炸)
    if (e.d.explode?.config && Math.random() < (e.d.explode.explode_on_death_percent ?? 1)) this.explodeConfig(e.x, e.y, e.d.explode.config)
    // 法杖幽灵死了 → 手里的法杖掉在地上(原作是 ItemPickUpper 背包里的物品掉落)
    if (e.held?.wand) this.hooks.dropWand?.(e.held.wand, e.x, e.y)
    // 幽灵水晶碎了 → 附近的幽灵一起散掉(ghost_crystal.lua)
    if (e.name === 'ghost_crystal') for (const g of this.list) if (!g.dead && g.d.ghost && Math.hypot(g.x - e.x, g.y - e.y) < 500) { g.dead = true; this.hooks.spark?.(g.x, g.y, 0, -30, '#a0c0ff', 0.6) }
    const D = e.d.damage || {}
    const { fx, mat: fxMat } = this._ragdollFx(e, src, opts)
    e.ragdollFx = fx
    // 致命一击的血(DamageModelSystem 受伤:Random(DAMAGE_BLOOD_AMOUNT_MIN 20, MAX 40) × blood_multiplier 粒,沿伤害方向 ±0.6 rad,速度 ×(0.5~1.25));冻碎 / 化尘不出血
    const blood = this.mats.byName.get(D.blood_material || '')
    if (blood > 0 && fx !== 'FROZEN' && fx !== 'DISINTEGRATED') {
      const n = Math.round((20 + Math.random() * 20) * (D.blood_multiplier ?? 1))
      const il = Math.hypot(ix, iy), dx0 = il > 1 ? ix / il : (Math.random() - 0.5), dy0 = il > 1 ? iy / il : -0.7, sp0 = Math.max(60, Math.min(160, il))
      for (let i = 0; i < n; i++) {
        const a = (Math.random() - 0.5) * 1.2, c = Math.cos(a), s = Math.sin(a), sp = sp0 * (0.5 + Math.random() * 0.75)
        this.hooks.debris?.(e.x + (Math.random() - 0.5) * 6, e.y + e.hit.t + Math.random() * (e.hit.b - e.hit.t), (dx0 * c - dy0 * s) * sp, (dx0 * s + dy0 * c) * sp - 20, blood, this.mats.color[blood])
      }
    }
    this.hooks.sfx?.('clash', { vol: 0.4, rate: 0.7, minGap: 80 })
    // 尸体:布娃娃初速 = 自身速度 × RAGDOLL_OWN_VELOCITY_IMPULSE_MULTIPLIER(magic_numbers 3)+ 伤害冲量(hurt 已把 ix/iy 加进 e.vx/vy,先扣掉)
    const ovx = (e.vx - ix) * 3 + ix, ovy = (e.vy - iy) * 3 + iy
    const vl = Math.hypot(ovx, ovy), vk = vl > 420 ? 420 / vl : 1
    const rag = { e, x: e.x, y: e.y, face: e.face || 1, vx: ovx * vk, vy: ovy * vk, ix, iy, fx, mat: fxMat || D.ragdoll_material || 'meat', burn: src === 'fire' || e.fireT > 0, imgs: [] }
    const ragMat = this.mats.byName.get(rag.mat) ?? this.mats.byName.get('meat')
    if (fx === 'DISINTEGRATED') this._disintegrate(e, ragMat)
    else if (fx === 'FROZEN' || fx === 'CONVERT_TO_MATERIAL' || fx === 'NO_RAGDOLL_FILE') this._spriteBody(rag, ragMat)
    else if (e.d.ragdoll?.length && ragMat > 0) {
      rag.imgs = e.d.ragdoll.slice()
      for (const img of rag.imgs) this._img(img)
      if (rag.imgs.every((n) => this.images.has(n))) this._buildRagdoll(rag)
      else this.pendingRagdolls.push(rag)
    }
    // ragdollify_child_entity_sprites(lukki):每条腿的两段图各变一块肉刚体,从膝 / 脚的位置摔下去;身体没有布娃娃图,就洒血
    if (e.legs && ragMat > 0 && fx !== 'DISINTEGRATED') {
      const mat = D.ragdoll_material || 'meat'
      for (const g of e.legs) {
        for (const [img, x, y] of [[g.L.a?.img, (e.x + g.fx) / 2, (e.y + g.fy) / 2], [g.L.b?.img, g.fx, g.fy]]) {
          if (!img) continue
          this.pendingProps.push({ name: 'ragdoll', d: { kind: 'prop', shape: { image: img, material: mat }, body: { friction: 0.6, restitution: 0.1, linear_damping: 0.3, angular_damping: 0.5 } }, x, y, vx: ix * 0.3 + (Math.random() - 0.5) * 60, vy: iy * 0.3 - 20 - Math.random() * 40, w: (Math.random() - 0.5) * 10, ragdoll: true })
        }
      }
    }
    // 掉金(drop_money.lua):money = 10 × max(1, floor(max_hp));先掷 10 面值(最多 5 个),再 1000/200/50/10
    if (e.d.scripts?.some((s) => s.endsWith('drop_money')) || e.d.chest) {
      let money = 10 * Math.max(1, Math.floor(e.maxHp))
      const drop = (name, v) => { this._img(this.defs[name].shape.image); this.pendingProps.push({ name, d: this.defs[name], x: e.x + (Math.random() - 0.5) * 4, y: e.y - 8, vx: (Math.random() - 0.5) * 60, vy: -40 - Math.random() * 50, item: true, gold: v }) }
      for (let k = 0; k < 5 && money >= 10; k++) { drop('goldnugget_10', 10); money -= 10 }
      for (const [v, n] of [[1000, 'goldnugget_1000'], [200, 'goldnugget_200'], [50, 'goldnugget_50'], [10, 'goldnugget_10']]) while (money >= v) { drop(n, v); money -= v }
    }
    this.hooks.onDeath?.(e)
  }

  /** 怪当前显示的那一帧在精灵表里的矩形 + 帧左上角的世界坐标(和 draw 同一套:offset 取反、朝左绕 e.x 镜像) */
  _frameOf(e, x = e.x, y = e.y) {
    const S = e.d.sprite, a = S?.anims?.[e.anim] || S?.anims?.[S?.def]
    const sheet = S?.image ? this.images.get(S.image) : null
    if (!a?.fw || !sheet?.data) return null
    const sx = a.x + ((e.frame || 0) % a.perRow) * a.fw, sy = a.y + Math.floor((e.frame || 0) / a.perRow) * a.fh
    const ox = S.offX + S.compOffX, oy = S.offY + S.compOffY
    const face = (e.face || 1) < 0 ? -1 : 1
    const left = face > 0 ? x - ox : x - (a.fw - ox), top = y - oy
    return { sheet, sx, sy, w: a.fw, h: a.fh, left: Math.round(left), top: Math.round(top), face }
  }

  /**
   * 布娃娃(反 PhysicsRagdollSystem::LoadRagdoll):filenames.txt 的每张 png 都是整帧,整帧居中放在 实体位置 + ragdoll_offset(x 随朝向翻转,朝左整帧镜像);
   * 每张图裁到自己的包围盒做一块刚体;每一对图片"两张都有像素"的格子 = 一个 pin 关节(僵尸 12 块 11 个关节,一具骨架);
   * 初速全部件相同(±RAGDOLL_IMPULSE_RANDOMNESS 4%);BLOOD_EXPLOSION 不建关节 + 每块 ±RAGDOLL_FX_EXPLOSION_ROTATION(0.5)角速度
   * (原版散开还靠 box2d 块与块互撞,我们刚体不互撞,补一点离心初速)。
   */
  _buildRagdoll(r) {
    const e = r.e, D = e.d.damage || {}
    const pngs = r.imgs.map((n) => this.images.get(n))
    if (!pngs.length || pngs.some((p) => !p?.data)) return
    const matId = this.mats.byName.get(r.mat) ?? this.mats.byName.get('meat')
    const W = pngs[0].width, H = pngs[0].height, face = r.face
    const cx = Math.floor(r.x) + (D.ragdoll_offset_x ?? 0) * face, cy = Math.floor(r.y) + (D.ragdoll_offset_y ?? 0)
    const left = cx - W / 2, top = cy - H / 2
    const A = (p, x, y) => (x < 0 || y < 0 || x >= p.width || y >= p.height ? 0 : p.data[(y * p.width + x) * 4 + 3])
    const mx = (x) => (face < 0 ? W - 1 - x : x)
    const def = { kind: 'prop', shape: { image: 'ragdoll', material: r.mat }, body: { friction: 0.6, restitution: 0.1, linear_damping: 0.3, angular_damping: 0.5 } }
    const parts = [], boxes = []
    for (const p of pngs) {
      let minx = W, miny = H, maxx = -1, maxy = -1
      for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if (A(p, x, y)) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y }
      if (maxx < 0) { parts.push(null); boxes.push(null); continue }
      const w = maxx - minx + 1, h = maxy - miny + 1
      const data = new Uint8ClampedArray(w * h * 4)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const si = ((miny + y) * p.width + minx + x) * 4, di = (y * w + (face < 0 ? w - 1 - x : x)) * 4
        data[di] = p.data[si]; data[di + 1] = p.data[si + 1]; data[di + 2] = p.data[si + 2]; data[di + 3] = p.data[si + 3]
      }
      const bx0 = face < 0 ? W - 1 - maxx : minx
      const b = new RigidBody(def, { width: w, height: h, data }, left + bx0 + w / 2, top + miny + h / 2, matId)
      b.name = 'ragdoll'; b.isBody = true; b.isRagdoll = true
      b.density = this.mats.list[matId]?.density ?? 6
      const k = 1 + (Math.random() - 0.5) * 0.08
      b.vx = r.vx * k; b.vy = r.vy * k
      parts.push(b); boxes.push({ bx0, by0: miny, w, h })
      this.stats.bodies++
    }
    const joints = []
    const explode = r.fx === 'BLOOD_EXPLOSION'
    if (!explode) {
      for (let i = 0; i < pngs.length; i++) for (let j = i + 1; j < pngs.length; j++) {
        if (!parts[i] || !parts[j]) continue
        const a = pngs[i], b = pngs[j], w = Math.min(a.width, b.width), h = Math.min(a.height, b.height)
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (!A(a, x, y) || !A(b, x, y)) continue
          const fx = mx(x), bi = boxes[i], bj = boxes[j]
          joints.push({ a: i, b: j, ax: fx - bi.bx0 + 0.5 - bi.w / 2, ay: y - bi.by0 + 0.5 - bi.h / 2, bx: fx - bj.bx0 + 0.5 - bj.w / 2, by: y - bj.by0 + 0.5 - bj.h / 2 })
        }
      }
    }
    const live = parts.filter(Boolean)
    if (!live.length) return
    // 关节表里的下标要对应 live 数组
    const remap = new Map(); parts.forEach((p, i) => { if (p) remap.set(i, live.indexOf(p)) })
    for (const j of joints) { j.a = remap.get(j.a); j.b = remap.get(j.b) }
    // 整帧居中在 y−6 时脚那两行在地面里(原版 box2d 慢慢顶出来,我们的刚体埋住会一帧顶 24px 把关节撕开):整具先往上挪到没有像素埋在实心里(≤ 8px)
    const P = [0, 0]
    const buried = () => { for (const b of live) for (let k = 0; k < b.n; k++) { b.worldOf(k, P); if (this._solidB(Math.floor(P[0]), Math.floor(P[1]))) return true } return false }
    for (let k = 0; k < 8 && buried(); k++) for (const b of live) b.y -= 1
    for (const b of live) b.softPush = true // 还埋着的也只轻轻顶(≤ 3px / 帧),别把关节撕了
    const PH = this.physics
    // BLOOD_EXPLOSION 散开:原版靠 box2d 块互撞;手写求解器不互撞才补的离心初速,planck 上不用
    if (explode && !PH) for (const b of live) { const dx = b.x - cx, dy = b.y - cy, dl = Math.hypot(dx, dy) || 1; b.vx += (dx / dl) * (30 + Math.random() * 50); b.vy += (dy / dl) * (30 + Math.random() * 50) - 20 }
    if (explode) for (const b of live) b.w = (Math.random() - 0.5) * 1.0 // RAGDOLL_FX_EXPLOSION_ROTATION 0.5
    if (D.ragdollify_root_angular_damping > 0) live[0].angDamp = D.ragdollify_root_angular_damping
    const g = new Ragdoll(live, joints)
    g.fx = r.fx
    if (PH) {
      // Box2D 版(第 29 条 ⑥):部件挂成多体组,每个重叠像素一个 revolute(LoadRagdoll 0x76ad40);刚度 = 每具掷 rand<0.75 → VERY_STIFF 2 否则 0.05,当电机刹车(× 关节力基准);
      // 断裂 max(200, (mA+mB)×400)(0x76ac8d);锚点像素被打掉也断;BLOOD_EXPLOSION 不建关节、部件互撞散开(不设碰撞组)
      for (const p of live) p.group = null // 不走手写求解器的 group 路径
      if (this._multiSeq === undefined) this._multiSeq = 1
      const M = { parts: live, joints: [], name: 'ragdoll', age: 0, group: explode ? 0 : -(++this._multiSeq), root: live[0], isRagdoll: true }
      const stiff = Math.random() < 0.75 ? 2 : 0.05
      for (const b of live) { b.multi = M; b.filterGroup = M.group; PH.attach(b) }
      if (!explode) {
        for (const j of joints) {
          const A = live[j.a], B = live[j.b]
          const ax = A.x + j.ax, ay = A.y + j.ay // 出生时 rot=0,局部锚点直接加
          // 刹车扭矩按两端较轻那块算(× 关节力基准的口径 160):躯干 10 kg 对 3 像素的手 0.5 kg,按质量和算的刹车会把手甩成螺旋桨
          const mAB = A.pb.getMass() + B.pb.getMass(), mMin = Math.min(A.pb.getMass(), B.pb.getMass())
          const pj = PH.revolute(A, B, ax, ay, { motorTorque: stiff * mMin / Math.max(1e-6, mAB) }) // revolute 内部再 × (mA+mB)×160 → 实际 = stiff × mMin × 160
          if (!pj) continue
          M.joints.push({ j: pj, A, B, breakDist: 16, breakN: Math.max(200, mAB * 400), anchorPix: [j.ax, j.ay, j.bx, j.by], aliveA: A.alive, aliveB: B.alive })
        }
      }
      g.planck = true; g.multi = M
      ;(this.multis ||= []).push(M)
    }
    if (r.burn) g.burn = 3
    if (r.fx === 'BLOOD_SPRAY' || explode) {
      const sm = this.mats.byName.get(D.blood_spray_material || D.blood_material || '')
      if (sm > 0) {
        const il = Math.hypot(r.ix, r.iy)
        const total = live.reduce((s, b) => s + b.n, 0)
        // 每块的血量 ∝ 质量(ragdoll_blood_amount_absolute > -1 时按质量分摊这个总数)× RAGDOLL_BLOOD_MULTIPLIER 2 × (0.8~1.2)
        const amount = D.ragdoll_blood_amount_absolute > -1 && D.ragdoll_blood_amount_absolute !== undefined ? D.ragdoll_blood_amount_absolute : total
        g.blood = { mat: sm, left: Math.round(amount * 2 * (0.8 + Math.random() * 0.4)), dx: il > 1 ? r.ix / il : 0, dy: il > 1 ? r.iy / il : -1 }
      }
    }
    this._capRagdolls(live.length)
    for (const b of live) { b.born = ++this._bornSeq; this.bodies.push(b) }
    this.ragdolls.push(g)
  }

  /**
   * FROZEN / CONVERT_TO_MATERIAL / NO_RAGDOLL_FILE(KillMe 0xbd0480):没有部件图,整张当前精灵帧变成**一块**刚体,材质 = 效果的 ragdoll_material
   * (冻住 ice_glass_b2,精灵调成 (0,0.5,1) 的蓝),初速 = 冲量,角速度 Random(−4, 4)
   */
  _spriteBody(r, matId) {
    const e = r.e
    const F = this._frameOf(e, r.x, r.y)
    if (!F || !(matId > 0)) return
    const data = new Uint8ClampedArray(F.w * F.h * 4)
    const frozen = r.fx === 'FROZEN'
    for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) {
      const si = ((F.sy + y) * F.sheet.width + F.sx + x) * 4, di = (y * F.w + (F.face < 0 ? F.w - 1 - x : x)) * 4
      if (!F.sheet.data[si + 3]) continue
      if (frozen) { data[di] = F.sheet.data[si] * 0.35; data[di + 1] = F.sheet.data[si + 1] * 0.5 + 90; data[di + 2] = F.sheet.data[si + 2] * 0.4 + 150 }
      else { data[di] = F.sheet.data[si]; data[di + 1] = F.sheet.data[si + 1]; data[di + 2] = F.sheet.data[si + 2] }
      data[di + 3] = F.sheet.data[si + 3]
    }
    const def = { kind: 'prop', shape: { image: 'ragdoll', material: r.mat }, body: { friction: 0.6, restitution: 0.1, linear_damping: 0.3, angular_damping: 0.5 } }
    const b = new RigidBody(def, { width: F.w, height: F.h, data }, F.left + F.w / 2, F.top + F.h / 2, matId)
    b.name = 'ragdoll'; b.isBody = true; b.isRagdoll = true
    b.density = this.mats.list[matId]?.density ?? 6
    b.vx = r.vx; b.vy = r.vy; b.w = Math.random() * 8 - 4
    this._capRagdolls(1)
    b.born = ++this._bornSeq
    this.bodies.push(b); this.stats.bodies++
    const g = new Ragdoll([b], [])
    g.fx = r.fx
    if (r.burn) g.burn = 3
    if (this.physics) { b.group = null; g.planck = true } // 单块:普通 planck 刚体(下一帧 _updateBodies 挂上)
    this.ragdolls.push(g)
  }

  /** DISINTEGRATED(KillMe 0xbd0fd3 → 0xbc5a10):精灵每个像素变一粒该材质的真粒子,速度 Random(−100, 100) 两轴,颜色用像素自己的 —— 化尘,没有尸体 */
  _disintegrate(e, matId) {
    const F = this._frameOf(e)
    if (!F) return
    const col = (r, g, b) => (r << 16) | (g << 8) | b
    for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) {
      const si = ((F.sy + y) * F.sheet.width + F.sx + x) * 4
      if (!F.sheet.data[si + 3]) continue
      const wx = F.left + (F.face < 0 ? F.w - 1 - x : x) + 0.5, wy = F.top + y + 0.5
      this.hooks.debris?.(wx, wy, Math.random() * 200 - 100, Math.random() * 200 - 100, matId > 0 ? matId : 0, col(F.sheet.data[si], F.sheet.data[si + 1], F.sheet.data[si + 2]), matId > 0)
    }
  }

  /** 点着(fire_probability_of_ignition):烧 4s,期间 fire_damage_amount / 0.5s,身上往外冒火(会点燃旁边的油/木) */
  ignite(e) {
    if (e.dead || e.fireT > 0) return
    if ((e.d.damage?.fire_probability_of_ignition ?? 0) <= 0) return
    e.fireT = 4; e.fireTick = 0
  }
  _burn(e, dt) {
    if (!(e.fireT > 0)) return
    e.fireT -= dt
    if (e.inLiq) { e.fireT = 0; return } // 进水灭
    e.fireTick += dt
    if (e.fireTick >= 0.5) { e.fireTick = 0; this.hurt(e, e.d.damage?.fire_damage_amount ?? 0.2, 0, 0, 'fire') }
    // 身上冒火:随机往身体周围的空气格放火(玩家 / 怪着火在原作里就是行走的火源)
    if (Math.random() < 0.5) {
      const x = Math.floor(e.x + (Math.random() - 0.5) * (e.hit.r - e.hit.l)), y = Math.floor(e.y + e.hit.t + Math.random() * (e.hit.b - e.hit.t))
      if (this.sim.get(x, y) === 0) this.sim.set(x, y, this.sim.M_FIRE, 0)
    }
    for (let k = 0; k < 2; k++) this.hooks.spark?.(e.x + (Math.random() - 0.5) * 6, e.y + e.hit.t + Math.random() * (e.hit.b - e.hit.t), (Math.random() - 0.5) * 24, -50 - Math.random() * 70, Math.random() < 0.5 ? '#ffb040' : '#ff6a20', 0.3 + Math.random() * 0.2)
  }

  /**
   * 爆炸(反 exe ExplosionFactory::DamageMortals):实体中心在 radius 内、且 hitbox(中心 + 四角)有一点能被射线够到(reach2[角度] ≥ 距离²,墙挡住就没伤害)
   * → 吃满额 damage,没有距离衰减;击退 = 方向 × lerp(power.min, power.max, 1 − d/r) × knockback_force(× 600 换成我们的 px/s)
   */
  static los(x, y, reach2, px, py, w, h) {
    if (!reach2) return true
    const pts = [[px, py], [px - w, py - h], [px + w, py - h], [px - w, py + h], [px + w, py + h]]
    for (const [qx, qy] of pts) {
      const dx = qx - x, dy = qy - y
      let d = Math.round(Math.atan2(dy, dx) * 180 / Math.PI) % 360; if (d < 0) d += 360
      if (reach2[d] >= dx * dx + dy * dy) return true
    }
    return false
  }

  explosion(x, y, r, dmg, reach2 = null, power = [0, 0.2], kb = 1, ragdollFx = 0) {
    const kbOf = (t) => (power[0] + (power[1] - power[0]) * t) * kb * 120 // ×3600 是 box2d 冲量单位,换成我们的 px/s 取 ×120(炸弹 3.6 → 430 px/s)
    const opts = ragdollFx ? { ragdollFx } : null
    for (const e of this.list) {
      if (e.dead) continue
      const cy = e.y + (e.hit.t + e.hit.b) / 2, dx = e.x - x, dy = cy - y, d = Math.hypot(dx, dy)
      if (d > r) continue
      if (!Entities.los(x, y, reach2, e.x, cy, (e.hit.r - e.hit.l) / 2, (e.hit.b - e.hit.t) / 2)) continue
      const t = Math.max(0, 1 - d / r), n = Math.max(1, d), f = kbOf(t)
      this.hurt(e, dmg, (dx / n) * f, (dy / n) * f - f * 0.5, 'explosion', e.x, e.y, opts)
    }
    for (const w of this.worms) {
      if (w.dead) continue
      let best = Infinity, bx = 0, by = 0
      for (const s of w.segs) { const dd = Math.hypot(s.x - x, s.y - y); if (dd < best) { best = dd; bx = s.x; by = s.y } }
      if (best <= r + w.r && Entities.los(x, y, reach2, bx, by, w.r, w.r)) this.hurt(w, dmg, 0, 0, 'explosion')
    }
    // 刚体:physics_throw —— 范围内的(含睡着的)醒过来被抛飞,再吃伤害
    for (const b of this.bodies) {
      if (b.dead) continue
      const dx = b.x - x, dy = b.y - y, d = Math.hypot(dx, dy)
      if (d > r + b.r) continue
      if (!Entities.los(x, y, reach2, b.x, b.y, b.r, b.r)) continue
      const t = Math.max(0, 1 - Math.max(0, d - b.r) / r), n = Math.max(1, d)
      let lost = 0
      if (b.asleep) lost += b.wake(this.sim) // 睡着的格子已经被这次爆炸的坑挖掉一部分,醒来清点出来的缺损也算这次的伤
      const imp = kbOf(t) * 1.8 * (30 / Math.max(30, b.m))
      b.vx += (dx / n) * imp; b.vy += (dy / n) * imp - imp * 0.5; b.w += (Math.random() - 0.5) * 6 * t; b.restT = 0
      // 爆炸也挖 box2d 体的像素(原版坑里的刚体格一样被摧毁,physics_body_modified / break_on_body_modified 就是这么触发的):半径内、能被射线够到的像素抠掉
      lost += b.carve(x, y, r, reach2)
      this._bodyDamaged(b, dmg, lost, b.x, b.y)
    }
  }

  /**
   * black_hole_gravity.lua PhysicsApplyForceOnArea:dist 内的刚体(箱子 / 桶 / 尸体道具)每帧 v += coeff × (1 − d/dist) 朝中心(coeff 已含 ×0.2)。
   * 活物 / 玩家不是 box2d 刚体,原版不吸
   */
  pull(x, y, dist, coeff, dt) {
    const f60 = dt * 60
    for (const b of this.bodies) {
      if (b.dead) continue
      const dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy)
      if (d >= dist || d < 0.5) continue
      if (b.asleep) b.wake(this.sim)
      const f = coeff * (1 - d / dist) * f60
      b.vx += (dx / d) * f; b.vy += (dy / d) * f; b.restT = 0
    }
  }

  /**
   * BlackHoleComponent 的吸力(反 noita_dev.exe BlackHoleSystem::Update):中心 ±radius 方框内的实体,每帧 mVelocity += attractor × 1.5 × (径向 + 径向旋转 π/2),
   * 即一半拉向洞心、一半切向 —— 所以怪和玩家也是绕着掉进去的;走路怪这帧不按 AI 限速(pullT)。刚体走 black_hole_gravity.lua 的 pull(),这里不管
   */
  attract(x, y, R, attr, dt) {
    const f = attr * 1.5 * dt * 60
    for (const e of this.list) {
      if (e.dead || e.isBody) continue
      const ex = e.x, ey = e.y + (e.hit.t + e.hit.b) / 2
      const dx = x - ex, dy = y - ey
      if (Math.abs(dx) > R || Math.abs(dy) > R) continue
      const d = Math.hypot(dx, dy)
      if (d < 0.5) continue
      const rx = dx / d, ry = dy / d
      e.vx += (rx - ry) * f; e.vy += (ry + rx) * f
      e.pullT = 0.1
    }
  }

  /** BlackHoleComponent damage_probability:exe 里是每帧掷一次骰,中了就对半径内所有 mortal 实体扣 dmg(调用方掷好骰再来;黑洞伤害无视 damage_multipliers) */
  blackHole(x, y, r, dmg) {
    for (const e of this.list) {
      if (e.dead) continue
      if (Math.hypot(e.x - x, (e.y + (e.hit.t + e.hit.b) / 2) - y) > r + 2) continue
      this.hurt(e, dmg, 0, 0, 'black_hole')
    }
    for (const w of this.worms) {
      if (w.dead) continue
      let best = Infinity; for (const s of w.segs) best = Math.min(best, Math.hypot(s.x - x, s.y - y))
      if (best <= r + w.r) this.hurt(w, dmg, 0, 0, 'black_hole')
    }
    for (const b of this.bodies) {
      if (b.dead) continue
      if (Math.hypot(b.x - x, b.y - y) > r + b.r) continue
      if (b.asleep) b.wake(this.sim)
      this._bodyDamaged(b, dmg, 0, b.x, b.y)
    }
  }

  /** 醒着刚体的光(矿灯 LightComponent);睡着的也发光 */
  lights(cb, ox, oy) {
    // LightComponent 原值:radius 就是世界 px,颜色缺省 255,178,118(component_documentation),亮度 mAlpha 1;光罩衰减在 Lighting.light 里
    for (const b of this.bodies) if (!b.dead && b.light) cb(b.x - ox, b.y - oy, b.light.radius, `${b.light.r ?? 255},${b.light.g ?? 178},${b.light.b ?? 118}`, 1)
    // 怪身上的 LightComponent(lukki r32 / 矿工头灯 r50 / giantshooter r80 绿光 / 火法师 r100):只给玩家周围一屏内的
    const pl = this.player
    for (const e of this.list) if (!e.dead && e.d.light && Math.abs(e.x - pl.x) < 400 && Math.abs(e.y - pl.y) < 260) cb(e.x - ox, e.y - oy, e.d.light.radius, `${e.d.light.r ?? 255},${e.d.light.g ?? 178},${e.d.light.b ?? 118}`, 1)
  }

  render(ctx, ox, oy) {
    ctx.imageSmoothingEnabled = false
    // 链(chain_vertical_16 那种铁链,这里画成一节节的暗色链环):从顶上的锚点到刚体上的挂点
    for (const b of this.bodies) {
      if (b.dead || !b.ropes) continue
      const c = Math.cos(b.rot), s = Math.sin(b.rot)
      for (const r of b.ropes) {
        if (r.broken || r.len === 0) continue
        const px = b.x + r.lx * c - r.ly * s, py = b.y + r.lx * s + r.ly * c
        const n = Math.max(1, Math.round(r.len / 4))
        for (let k = 0; k <= n; k++) {
          const t = k / n, x = Math.round(r.ax + (px - r.ax) * t - ox), y = Math.round(r.ay + (py - r.ay) * t - oy)
          ctx.fillStyle = k & 1 ? '#3a3a40' : '#5a5a62'; ctx.fillRect(x - 1, y, 2, 4)
        }
      }
    }
    // 睡着的也画:世界里那些格子只是"材质",画上去才是箱子的图(原作物理像素带自己的颜色);被挖掉的像素由 audit 抠掉
    for (const b of this.bodies) if (!b.dead && b.x > ox - 40 && b.x < ox + ctx.canvas.width + 40 && b.y > oy - 40 && b.y < oy + ctx.canvas.height + 40) b.draw(ctx, ox, oy)
    // 商店标价(generate_shop_item.lua:font_pixel_white 文字挂在物品下方 25px;打折的画 sale_indicator)
    ctx.font = '7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    for (const b of this.bodies) {
      if (b.dead || !b.shop || b.x < ox - 40 || b.x > ox + ctx.canvas.width + 40 || b.y < oy - 40 || b.y > oy + ctx.canvas.height + 40) continue
      const px = Math.round(b.x - ox), py = Math.round(b.y - oy) + 10
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(px - 12, py - 1, 24, 8)
      ctx.fillStyle = b.shop.sale ? '#ffd050' : '#e8e8e8'
      ctx.fillText(String(b.shop.cost), px, py)
      if (b.shop.sale) { ctx.fillStyle = '#ffd050'; ctx.fillText('SALE', px, py - 22) }
    }
    ctx.textAlign = 'left'
    for (const w of this.worms) if (!w.dead) this._renderWorm(ctx, w, ox, oy)
    // 激光门的光束(粉红,beam_radius 1.5 → 3px 芯 + 淡晕)
    for (const e of this.list) {
      if (e.dead || !e.d.lasergate || !e.laserOn || !(e.laserLen > 0)) continue
      const LZ = e.d.lasergate, x1 = e.x + Math.cos(LZ.angle) * e.laserLen, y1 = e.y + Math.sin(LZ.angle) * e.laserLen
      ctx.save(); ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = 'rgba(255,80,180,0.35)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(e.x - ox, e.y - oy); ctx.lineTo(x1 - ox, y1 - oy); ctx.stroke()
      ctx.strokeStyle = '#ffc0e8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(e.x - ox, e.y - oy); ctx.lineTo(x1 - ox, y1 - oy); ctx.stroke()
      ctx.restore()
    }
    for (const e of this.list) {
      if (e.dead) continue
      // 法杖幽灵:只画手里那根法杖,杖尖朝着人(幽灵本体原作也是看不见的)
      if (e.held) {
        const wi = this._img(e.held.image)
        if (wi?.image) {
          const pl = this.player, ang = Math.atan2(pl.y - 4 - e.y, pl.x - e.x)
          ctx.save(); ctx.translate(Math.round(e.x - ox), Math.round(e.y - oy)); ctx.rotate(ang)
          if (Math.cos(ang) < 0) ctx.scale(1, -1)
          if (e.hurtT > 0) ctx.globalAlpha = 0.75
          ctx.drawImage(wi.image, -Math.round(wi.width * 0.3), -Math.round(wi.height / 2)); ctx.restore(); ctx.globalAlpha = 1
        }
        continue
      }
      const img = this._img(e.d.sprite.image)
      if (!img?.image) continue
      const S = e.d.sprite, a = S.anims[e.anim] || S.anims[S.def]
      if (!a) continue
      const fx = a.x + (e.frame % a.perRow) * a.fw, fy = a.y + Math.floor(e.frame / a.perRow) * a.fh
      // 液体折射(post_final.frag):怪泡在液体里时整只跟着液体格的采样偏移晃
      const wb = this.hooks.wobble?.(e.x, e.y + (e.hit.t + e.hit.b) / 2)
      const px = Math.round(e.x - ox) + (wb ? wb[0] : 0), py = Math.round(e.y - oy) + (wb ? wb[1] : 0)
      if (e.hurtT > 0) ctx.globalAlpha = 0.75
      if (e.legs) for (const g of e.legs) this._drawLeg(ctx, e, g, ox, oy) // 腿 z_index 1.1:在身体后面
      if (e.tents) this._drawTentacles(ctx, e, ox, oy)
      ctx.save()
      ctx.translate(px, py)
      // 爬墙的:脚朝实心那侧转过去(d 0 / r −90° / l +90° / u 180°)
      if (e.crawler && e.surf && e.surf !== 'd') { ctx.rotate(e.surf === 'r' ? -Math.PI / 2 : e.surf === 'l' ? Math.PI / 2 : Math.PI); ctx.translate(0, e.surf === 'u' ? 0 : 3) }
      ctx.scale(e.face, 1)
      // PhysicsAI 飞行体(无人机 / 水晶):本体是 PhysicsImageShape 那张图,Sprite 只是发光的眼 → 先画本体再叠精灵
      if (e.d.bodyImage) { const bi = this._img(e.d.bodyImage); if (bi?.image) ctx.drawImage(bi.image, Math.round(-bi.width / 2), Math.round(-bi.height / 2)) }
      ctx.drawImage(img.image, fx, fy, a.fw, a.fh, Math.round(-S.offX - S.compOffX), Math.round(-S.offY - S.compOffY), a.fw, a.fh)
      // 叠层精灵(lukki_wiggle 4 帧抖动、emissive 发光眼 additive)
      if (e.d.overlays) for (const o of e.d.overlays) {
        const oi = this._img(o.image), oa = o.anims[o.def] || Object.values(o.anims)[0]
        if (!oi?.image || !oa) continue
        const f = Math.floor(this.time / Math.max(0.02, oa.wait)) % Math.max(1, oa.frames)
        if (o.emissive) ctx.globalCompositeOperation = 'lighter'
        ctx.drawImage(oi.image, oa.x + (f % oa.perRow) * oa.fw, oa.y + Math.floor(f / oa.perRow) * oa.fh, oa.fw, oa.fh, Math.round(-o.offX - o.compOffX), Math.round(-o.offY - o.compOffY), oa.fw, oa.fh)
        if (o.emissive) ctx.globalCompositeOperation = 'source-over'
      }
      ctx.restore()
      ctx.globalAlpha = 1
    }
    ctx.globalAlpha = 1
  }
}
