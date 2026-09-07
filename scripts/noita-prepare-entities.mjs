// ── 实体定义 data/entities/{animals,props}/*.xml → public/res/noita/entities.json + 贴图 ent/ ──
// <Base file> 递归合并(基文件打底 → Base 块内覆盖 → 本文件覆盖),所有数值照抄 xml,代码里不出现魔法数。
// 每条:sprite(Sprite xml:图/偏移/全部 RectAnimation)、hitbox、CharacterData/Platforming(行走模型)、DamageModel(hp/血/布娃娃)、
// AnimalAI、GenomeData(阵营)、PhysicsImageShape(道具形状图 + 材质)、PhysicsBody、ExplodeOnDamage+config_explosion、MaterialInventory、Light。
// 用法:node scripts/noita-prepare-entities.mjs
import fs from 'fs'
import path from 'path'

const UNPACKED = 'noita-ref/unpacked'
const OUT = 'public/res/noita'
const ANIMALS = [
  // 煤矿 / 塌矿
  'zombie_weak', 'zombie', 'miner_weak', 'miner', 'miner_santa', 'miner_fire', 'shotgunner_weak', 'shotgunner', 'slimeshooter_weak', 'slimeshooter', 'longleg', 'firemage_weak', 'acidshooter_weak', 'giantshooter_weak', 'fungus', 'fungus_big', 'rat', 'sheep', 'deer', 'duck', 'frog', 'frog_big', 'worm', 'worm_tiny', 'bat', 'fireskull', 'drone_shield', 'shaman', 'alchemist', 'thundermage', 'fly',
  // 挖掘场(excavationsite.lua)
  'firebug', 'bigfirebug', 'goblin_bomb', 'bigbat', 'scavenger_mine', 'slimespirit', 'acidshooter', 'giantshooter', 'firemage', 'wizard_hearty', 'tank_super',
  // 雪窟(snowcave.lua)
  'iceskull', 'scavenger_grenade', 'scavenger_smg', 'scavenger_leader', 'coward', 'sniper', 'tank', 'tank_rocket', 'thundermage_big', 'worm_big', 'giant', 'icemage', 'monk', 'wizard_neutral', 'wizard_tele', 'wizard_dark', 'wizard_swapper', 'necromancer', 'thunderskull', 'scavenger_glue', 'fish_large',
  // 雪城堡(snowcastle.lua)
  'scavenger_heal', 'scavenger_clusterbomb', 'drone_lasership', 'healerdrone_physics', 'turret_right', 'turret_left', 'miner_chef',
  // 真菌洞(fungicave.lua)
  'ant', 'blob', 'tentacler', 'tentacler_small', 'scavenger_invis', 'bigzombie', 'wizard_poly', 'maggot', 'wizard_twitchy', 'confusespirit', 'roboguard', 'drone_physics', 'assassin',
  // 丛林(rainforest.lua;shooterflower 没有 CharacterPlatforming → stationary)
  'rainforest/fly', 'rainforest/shooterflower', 'rainforest/scavenger_poison', 'rainforest/scavenger_clusterbomb', 'rainforest/bloom', 'rainforest/scavenger_smg', 'rainforest/scavenger_grenade', 'rainforest/coward',
  'rainforest/fungus', 'rainforest/scavenger_mine', 'rainforest/scavenger_heal', 'rainforest/flamer', 'rainforest/sniper', 'rainforest/scavenger_leader', 'spearbot',
  // lukki 蜘蛛(animals/lukki/*:PhysicsBody 圆 + PhysicsAI + LimbBoss FollowPlayer + IKLimb 子实体;lukki_tiny 从 lukki_eggs 里打出来)
  'lukki/lukki', 'lukki/lukki_longleg', 'lukki/lukki_tiny',
  // 金库(vault.lua,animals/vault/* 强化版)
  'vault/drone_physics', 'vault/lasershooter', 'vault/roboguard', 'vault/assassin', 'vault/tentacler', 'vault/tentacler_small', 'vault/acidshooter', 'vault/blob', 'vault/bigzombie', 'vault/scavenger_mine',
  'vault/sniper', 'vault/flamer', 'vault/thunderskull', 'vault/coward', 'vault/scavenger_glue', 'vault/firemage', 'vault/thundermage', 'vault/wizard_dark', 'vault/maggot', 'vault/scavenger_smg', 'vault/scavenger_grenade',
  'vault/scavenger_leader', 'vault/scavenger_heal', 'vault/tank', 'vault/tank_rocket', 'vault/tank_super', 'vault/missilecrab', 'vault/icer', 'vault/healerdrone_physics', 'vault/turret_right', 'vault/turret_left', 'scavenger_shield',
  // 艺术神殿(crypt.lua,animals/crypt/*;陷阱 buildings/*trap 与 ghost_crystal 是建筑,不在这里)
  'crypt/phantom_a', 'crypt/phantom_b', 'crypt/skullrat', 'crypt/skullfly', 'crypt/tentacler', 'crypt/tentacler_small', 'crypt/necromancer', 'crypt/acidshooter', 'crypt/crystal_physics', 'crypt/maggot', 'crypt/failed_alchemist',
  'crypt/thundermage', 'crypt/worm', 'crypt/worm_skull', 'crypt/wizard_tele', 'crypt/wizard_dark', 'crypt/wizard_poly', 'crypt/wizard_returner', 'crypt/wizard_neutral', 'crypt/barfer', 'crypt/enlightened_alchemist',
  'wraith', 'wraith_glowing', 'failed_alchemist_b', 'scorpion', 'mimic_physics', 'ghost', 'scavenger_poison',
  // 圣山守卫 Stevari(temple_shared.lua temple_spawn_guardian:偷商店货 / 挖穿圣山墙 → spawn_necromancer_shop.xml 3s 后出现;STEVARI_DEATHS ≥3 换 necromancer_super)
  'necromancer_shop', 'necromancer_super',
  // 古代实验室 liquidcave.lua(普通版炼金术士 / 巫师;crypt/ 下的是强化版)
  'failed_alchemist', 'enlightened_alchemist', 'wizard_returner',
  // 魔法神殿 wandcave.lua(法杖幽灵 / 石像(PhysicsAI)/ 幻影 / 死灵法师)
  'wand_ghost', 'statue_physics', 'phantom_a', 'phantom_b', 'necromancer',
  // 金字塔 pyramid.lua(普通版骷髅鼠 / 骷髅蝇 + 弱化巫师 / 灵体)
  'skullrat', 'skullfly', 'wizard_weaken', 'ethereal_being', 'berserkspirit', 'weakspirit',
  // 沙洞 sandcave.lua(普通版喷火兵;shotgunner_hell / sniper_hell 是 NG+ 行)
  'flamer',
  // 肉界 meat.lua(地狱版矿工 / 霰弹手 / 狙击手、肉蛆、血晶(PhysicsAI)、死灵机器人)
  'shotgunner_hell', 'miner_hell', 'sniper_hell', 'meatmaggot', 'bloodcrystal_physics', 'necrobot',
  // 发电站 robobase.lua(基地机器人 + robobase/ 强化版)
  'roboguard_big', 'basebot_sentry', 'basebot_hidden', 'basebot_neutralizer', 'basebot_soldier', 'necrobot_super', 'robobase/healerdrone_physics', 'robobase/drone_shield', 'robobase/tank_super',
  // 地狱 the_end.lua(animals/the_end/* 强化版)
  'the_end/gazer', 'the_end/spitmonster', 'the_end/bloodcrystal_physics', 'the_end/worm_end',
  // 巫师洞 wizardcave.lua(追踪巫师 / 呕吐者普通版)
  'wizard_homing', 'barfer',
  // 雕像陷阱活化出来的会飞雕像(statue_trap.lua → animals/statue.xml,键 statue_animal)
  'statue',
  // 菌林巨蘑菇(fungiforest.lua)/ 瞭望塔蝎子(temples_common.lua spawn_scorpion)/ 天空神殿药水拟态 / 友人洞(friend_N.lua:Toveri + 终极杀手)
  'fungus_giga', 'scorpion_watchtower', 'mimic_potion', 'chest_mimic', 'friend', 'ultimate_killer',
  // 门怪(wizardcave_gate_monster_spawner.xml,四只 PhysicsAI 石像,巫师洞入口三蛋祭门)
  'boss_gate/gate_monster_a', 'boss_gate/gate_monster_b', 'boss_gate/gate_monster_c', 'boss_gate/gate_monster_d',
  // ── Boss(docs/noita-bosses.md)——键在 BOSS_KEYS 里缩短 ──
  'boss_dragon', 'maggot_tiny/maggot_tiny', 'boss_meat/boss_meat', 'boss_robot/boss_robot', 'boss_pit/boss_pit', 'boss_ghost/boss_ghost', 'boss_wizard/boss_wizard', 'boss_alchemist/boss_alchemist',
  'boss_spirit/islandspirit', 'boss_spirit/wisp', 'boss_fish/fish_giga', 'boss_sky/boss_sky', 'boss_limbs/boss_limbs', 'boss_limbs/slimeshooter_boss_limbs', 'boss_centipede/boss_centipede', 'boss_centipede/boss_centipede_minion',
  'boss_wizard/wizard_orb_blood', 'boss_wizard/wizard_orb_death', 'ethereal_being',
]
/** animals 子目录里的 boss 主体用短键(scenes.js / Bosses.js 按这个名字找) */
const BOSS_KEYS = {
  'maggot_tiny/maggot_tiny': 'maggot_tiny', 'boss_meat/boss_meat': 'boss_meat', 'boss_robot/boss_robot': 'boss_robot', 'boss_pit/boss_pit': 'boss_pit', 'boss_ghost/boss_ghost': 'boss_ghost',
  'boss_wizard/boss_wizard': 'boss_wizard', 'boss_alchemist/boss_alchemist': 'boss_alchemist', 'boss_spirit/islandspirit': 'islandspirit', 'boss_spirit/wisp': 'wisp', 'boss_fish/fish_giga': 'fish_giga',
  'boss_sky/boss_sky': 'boss_sky', 'boss_limbs/boss_limbs': 'boss_limbs', 'boss_limbs/slimeshooter_boss_limbs': 'slimeshooter_boss_limbs', 'boss_centipede/boss_centipede': 'boss_centipede',
  'boss_centipede/boss_centipede_minion': 'boss_centipede_minion', 'boss_wizard/wizard_orb_blood': 'wizard_orb_blood', 'boss_wizard/wizard_orb_death': 'wizard_orb_death',
  'boss_gate/gate_monster_a': 'gate_monster_a', 'boss_gate/gate_monster_b': 'gate_monster_b', 'boss_gate/gate_monster_c': 'gate_monster_c', 'boss_gate/gate_monster_d': 'gate_monster_d',
}
const BOSS_SET = new Set(['boss_dragon', 'maggot_tiny', 'boss_meat', 'boss_robot', 'boss_pit', 'boss_ghost', 'boss_wizard', 'boss_alchemist', 'islandspirit', 'fish_giga', 'boss_sky', 'boss_limbs', 'boss_centipede', 'friend', 'gate_monster_a', 'gate_monster_b', 'gate_monster_c', 'gate_monster_d'])
const ITEMS = ['goldnugget_10', 'goldnugget_50', 'goldnugget_200', 'goldnugget_1000', 'heart', 'potion', 'chest_random', 'spell_refresh', 'heart_fullhp_temple', 'perk_reroll', 'utility_box',
  // ── 房间里的可捡物(09-07 第 32 条):路径相对 items/,键 = 文件名 ──
  'heart_fullhp', 'heart_better', 'heart_evil', 'random_card',
  ...['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '13'].map((n) => `../orbs/orb_${n}`), // 宝珠(ItemComponent auto_pickup=0 → 走过去捡;第一次捡给 card_name 那张卡)
  ...['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', 'barren', 'bunker', 'corpse', 'diamond', 'essences', 'hint', 'mestari', 'moon', 'music_a', 'music_b', 'music_c', 'robot', 'tree', 'all_spells'].map((n) => `../books/book_${n}`), // 书(石板刚体 rock_box2d_hard)
  'essence_air', 'essence_alcohol', 'essence_fire', 'essence_laser', 'essence_water', // 精华(碰到就吃,永久效果)
  'egg_worm', 'egg_purple', 'egg_fire', 'egg_hollow', 'egg_monster', 'egg_red', 'egg_slime', 'egg_spiders', // 蛋(bone_box2d 刚体,摔碎出东西)
  'gourd', 'greed_curse', 'musicstone', 'potion_beer', 'potion_milk', 'sun/sunseed', 'evil_eye', 'wandstone', '../flute', '../kantele', '../../animals/boss_alchemist/key',
  '../../animals/boss_centipede/sampo'] // 三宝(拿起来 Kolmisilmä 开打;带到结局点变一切为金)
// 翻译 $key → 中文(缺就英文):books 的 $booktitleNN、$item_orb 等
const zh = new Map()
{
  const csvPath = 'E:/soft/xiaoshuodongtai/silu/XD220/Noita.v20250125-P2P/data/translations/common.csv'
  if (fs.existsSync(csvPath)) for (const line of fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).slice(1)) { const cols = line.split(','); if (cols[0]) zh.set(cols[0], { en: cols[1] || '', zh: cols[9] || '' }) }
}
const tr = (key) => { const k = String(key || '').replace(/^\$/, ''); const t = zh.get(k); return t ? (t.zh && /[\u4e00-\u9fff]/.test(t.zh) ? t.zh : t.en) : k }
// 书的正文 bookdesc*(英文列,带引号 / \n,"doesn't need to be translated"):单独按带引号的 CSV 字段抠
const BOOKDESC = new Map()
{
  const csvPath = 'E:/soft/xiaoshuodongtai/silu/XD220/Noita.v20250125-P2P/data/translations/common.csv'
  if (fs.existsSync(csvPath)) for (const m of fs.readFileSync(csvPath, 'utf8').matchAll(/^(bookdesc\w*),(?:"((?:[^"]|"")*)"|([^,\n]*))/gm)) BOOKDESC.set(m[1], (m[2] ?? m[3] ?? '').replace(/""/g, '"').replace(/\\n/g, '\n'))
}
const PROPS = [
  'physics_box_explosive', 'physics_barrel_oil', 'physics_barrel_radioactive', 'physics_crate', 'physics/minecart', 'physics_cart', 'physics_stone_01', 'physics_stone_02', 'physics_stone_03', 'physics_stone_04', 'physics/lantern_small', 'physics_skateboard', 'physics_brewing_stand', 'physics_bottle_green', 'physics_bottle_red', 'physics_bottle_blue', 'physics_bottle_yellow', 'physics_candle_1', 'physics_candle_2', 'physics_candle_3', 'physics_mining_lamp',
  // 挖掘场(吊桶 physics_bucket 挂钉子上摆、吊罐 suspended_* 拴链子到顶:RigidBody.ropes;多体机械 excavationsite_machine_3b/3c 走 Box2D 多体:机身 + 带电机的轮)
  'physics_seamine', 'physics_wheel', 'physics_wheel_small', 'physics_wheel_tiny', 'physics_bucket', 'suspended_container', 'suspended_tank_radioactive', 'suspended_seamine', 'suspended_tank_acid', 'excavationsite_machine_3b', 'excavationsite_machine_3c',
  // Box2D 多体(第 29 条 ④):轮架(架 + 带电机的轮)、物理蘑菇(帽 + 茎链 + 脚钉地)、齿轮门
  'physics_wheel_stand_01', 'physics_wheel_stand_02', 'physics_wheel_stand_03',
  'physics_fungus', 'physics_fungus_small', 'physics_fungus_big', 'physics_fungus_hugeish', 'physics_fungus_huge', 'physics_fungus_acid', 'physics_fungus_acid_small', 'physics_fungus_acid_big', 'physics_fungus_acid_hugeish', 'physics_fungus_acid_huge', 'physics_fungus_trap', 'physics_templedoor2',
  // 雪窟
  'physics_propane_tank', 'physics_trap_electricity_enabled', 'physics_skull_01', 'physics_skull_02', 'physics_skull_03', 'physics_bone_01', 'physics_bone_02', 'physics_bone_03', 'physics_bone_04', 'physics_bone_05', 'physics_bone_06', 'stonepile', 'physics_barrel_burning', 'physics_lantern_small',
  // 雪城堡(家具是多体 + 关节,先只取第一块形状图当整块;forcefield_generator 的护盾子实体不做)
  'physics_box_harmless', 'forcefield_generator', 'furniture_bunk', 'furniture_table', 'furniture_locker', 'furniture_footlocker', 'furniture_stool', 'furniture_cryopod',
  // 金库(vault_machine_* 是 PixelSprite 像素贴图 → World 当背景贴图;apparatus 是装气/装液的真刚体)
  'physics_pressure_tank', 'vault_apparatus_01', 'vault_apparatus_02',
  // 艺术神殿
  'crystal_red', 'crystal_pink', 'crystal_green', 'physics_vase', 'physics_vase_longleg', 'pressure_plate', 'physics_torch_stand', // 石棺 / 背景雕像是 PixelSprite → 背景贴图
  // 圣山碎石
  'physics_temple_rubble_01', 'physics_temple_rubble_02', 'physics_temple_rubble_03', 'physics_temple_rubble_04', 'physics_temple_rubble_05', 'physics_temple_rubble_06',
  // 古代实验室(liquidcave.lua):吊灯 / 床 / 旗 / 12 座石像
  'physics_lantern', 'physics_bed', 'banner', ...Array.from({ length: 12 }, (_, i) => `statues/statue_rock_${String(i + 1).padStart(2, '0')}`),
  // 魔法神殿:幽绿吊链火把(g_lamp 必出,光源走 collectLights,这里备着当道具)
  'physics/chain_torch_ghostly',
  // 金字塔:石像 / 蓝火炬座 / 蓝吊链火把 / 神殿门(单体形状图,关节没做)
  'statue', 'physics_torch_stand_blue', 'physics/chain_torch_blue', 'physics_templedoor',
  // 沙洞 / 发电站:管灯
  'physics_tubelamp',
  // 肉界:吊笼 / 吊链(拴链到顶)、肉囊
  'suspended_cage', 'suspended_cage_broken', 'suspended_chain', 'meat_cyst',
  // 发电站:吊线
  'physics_hanging_wire',
  // 巫师洞 / 地狱:普通吊链火把
  'physics/chain_torch',
]

const attrsOf = (s) => { const o = {}; for (const m of (s || '').matchAll(/([\w:.\-]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = m[2]; return o }
const num = (v, d) => (v === undefined || v === '' ? d : +v)
const readFile = (rel) => { const p = `${UNPACKED}/${rel.replace(/^data\//, '')}`; return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null }
fs.mkdirSync(`${OUT}/ent`, { recursive: true })
const copied = new Set()
const copyGfx = (rel) => {
  if (!rel) return null
  const src = `${UNPACKED}/${rel.replace(/^data\//, '')}`
  if (!fs.existsSync(src)) return null
  const name = rel.replace(/^data\//, '').replace(/\//g, '_')
  if (!copied.has(name)) { fs.copyFileSync(src, `${OUT}/ent/${name}`); copied.add(name) }
  return name
}

/**
 * 解析一个实体 xml(递归 Base)→ { tags, name, comps: Map<组件名, [attrs, ...]> , subs: {config_explosion, damage_multipliers, materials[]} }
 * 同名组件:Base 里的第 i 个被覆盖块 / 本文件里的第 i 个覆盖(属性合并)
 */
function parseEntity(xml, depth = 0) {
  const ent = { tags: '', name: '', comps: new Map(), subs: {} }
  if (!xml || depth > 6) return ent
  const headM = /<Entity\b([^>]*)>/.exec(xml)
  const head = attrsOf((headM || [])[1])
  ent.tags = head.tags || ''; ent.name = head.name || ''
  // 去掉子实体(触手 / 挂件 / 光效之类 <Entity>…</Entity> 嵌套块),只解析根实体
  if (headM) { const start = headM.index + headM[0].length; xml = xml.slice(0, start) + xml.slice(start).replace(/<Entity\b[^>]*>[\s\S]*?<\/Entity>/g, '') }
  // 先吃 Base 块(<Base file="…" [include_children="1"]> 覆盖块 </Base> 或自闭合)
  const bases = []
  for (const m of xml.matchAll(/<Base\s+file="([^"]+)"[^>]*?(\/?)>/g)) {
    if (m[2] === '/') { bases.push({ file: m[1], inner: '' }); continue }
    const close = xml.indexOf('</Base>', m.index)
    bases.push({ file: m[1], inner: close >= 0 ? xml.slice(m.index + m[0].length, close) : '' })
  }
  const rest = xml.replace(/<Base\s+file="[^"]+"[^>]*?\/>/g, '').replace(/<Base\b[^>]*>[\s\S]*?<\/Base>/g, '')
  // `_remove_from_base="1"`(boss_sky.xml 的 Base 块里):把 Base 带进来的该类组件全部删掉,这个标记组件自己也不算(真组件写在 Base 之前 / 之后)
  const stripRemoved = (src) => {
    for (const [k, list] of src.comps) {
      if (!list.some((a) => a._remove_from_base === '1')) continue
      ent.comps.delete(k)
      src.comps.set(k, list.filter((a) => a._remove_from_base !== '1'))
    }
    return src
  }
  for (const b of bases) {
    const base = parseEntity(readFile(b.file) || '', depth + 1)
    mergeInto(ent, base)
    mergeInto(ent, stripRemoved(parseComponents(b.inner)))
  }
  mergeInto(ent, stripRemoved(parseComponents(rest)), true) // Base 块外的组件是"追加",不是覆盖(僵尸的发光副精灵就是这么加的)
  if (!ent.tags && head.tags) ent.tags = head.tags
  return ent
}
function parseComponents(text) {
  const ent = { tags: '', name: '', comps: new Map(), subs: {} }
  for (const m of text.matchAll(/<([A-Z]\w*Component)\b([^>]*?)(\/?)>/g)) {
    const a = attrsOf(m[2])
    if (!ent.comps.has(m[1])) ent.comps.set(m[1], [])
    ent.comps.get(m[1]).push(a)
  }
  const ex = /<config_explosion\b([^>]*)>/.exec(text); if (ex) ent.subs.config_explosion = attrsOf(ex[1])
  const dm = /<damage_multipliers\b([^>]*)>/.exec(text); if (dm) ent.subs.damage_multipliers = attrsOf(dm[1])
  const mats = [...text.matchAll(/<Material\s+material="(\w+)"\s+count="(\d+)"/g)].map((x) => [x[1], +x[2]])
  if (mats.length) ent.subs.materials = mats
  return ent
}
function mergeInto(dst, src, append = false) {
  if (src.tags) dst.tags = dst.tags ? dst.tags + ',' + src.tags : src.tags
  if (src.name && !dst.name) dst.name = src.name
  for (const [k, list] of src.comps) {
    if (!dst.comps.has(k)) { dst.comps.set(k, list.map((a) => ({ ...a }))); continue }
    const d = dst.comps.get(k)
    if (append) { for (const a of list) d.push({ ...a }); continue }
    list.forEach((a, i) => { if (d[i]) Object.assign(d[i], a); else d.push({ ...a }) })
  }
  for (const [k, v] of Object.entries(src.subs)) dst.subs[k] = Array.isArray(v) ? v : { ...(dst.subs[k] || {}), ...v }
}
const first = (ent, name) => (ent.comps.get(name) || [])[0] || null

/** Sprite xml → {image, offX, offY, def, anims:{name:{x,y,fw,fh,frames,wait,perRow,loop}}} */
function spriteDef(rel) {
  if (!rel) return null
  if (rel.endsWith('.png')) {
    const image = copyGfx(rel), anims = {}
    if (image) { const sz = pngSize(`${OUT}/ent/${image}`); if (sz) anims.default = { x: 0, y: 0, fw: sz[0], fh: sz[1], frames: 1, wait: 1, perRow: 1, loop: true } }
    return { image, offX: 0, offY: 0, def: 'default', anims }
  }
  const s = readFile(rel)
  if (!s) return null
  const sp = attrsOf((/<Sprite\b([^>]*)>/.exec(s) || [])[1])
  const anims = {}
  for (const m of s.matchAll(/<RectAnimation\b([^>]*)>/g)) {
    const a = attrsOf(m[1])
    if (!a.name) continue
    anims[a.name] = { x: num(a.pos_x, 0), y: num(a.pos_y, 0), fw: num(a.frame_width, 0), fh: num(a.frame_height, 0), frames: num(a.frame_count, 1), wait: num(a.frame_wait, 0.1), perRow: num(a.frames_per_row, 8), loop: a.loop !== '0', shrink: a.shrink_by_one_pixel === '1' }
  }
  const image = copyGfx(sp.filename)
  // 没有 RectAnimation 的 Sprite xml(陷阱):整张图就是唯一一帧
  if (!Object.keys(anims).length && image) { const sz = pngSize(`${OUT}/ent/${image}`); if (sz) anims.default = { x: 0, y: 0, fw: sz[0], fh: sz[1], frames: 1, wait: 1, perRow: 1, loop: true } }
  return { image, offX: num(sp.offset_x, 0), offY: num(sp.offset_y, 0), def: sp.default_animation || Object.keys(anims)[0] || '', anims }
}

const out = {}
const pngSize = (p) => { if (!fs.existsSync(p)) return null; const b = fs.readFileSync(p); return [b.readUInt32BE(16), b.readUInt32BE(20)] }
const pick = (o, keys) => { const r = {}; for (const k of keys) if (o && o[k] !== undefined) r[k] = isNaN(+o[k]) || o[k] === '' ? o[k] : +o[k]; return r }

// buildings:巢(挂在顶上的静物,原版会定时吐虫,这里先只做能打碎的静物)、茧(钉着的刚体,打了炸)、蜘蛛卵(打破洒黏液)
const BUILDINGS = ['flynest', 'firebugnest', 'spidernest', 'physics_cocoon', 'lukki_eggs', 'ghost_crystal',
  ...['arrowtrap', 'firetrap', 'thundertrap', 'spittrap'].flatMap((t) => [t + '_left', t + '_right']), // 神殿陷阱:crypt_trap_check.lua 每 60 帧看人在不在正面 170px 内
  'lasergun', 'statue_trap_left', 'statue_trap_right',
  'wallmouth', 'walleye', 'hpcrystal', // 肉界墙上的嘴 / 眼(AnimalAI 站桩怪)、回血水晶(打碎回血,先当能打碎的静物)
  'lasergate_down', // 发电站激光门(LaserEmitter 朝下 160px,lasergate_ver.lua 按 cos(frame·0.03 + x·0.05) < 0 亮灭)
  'cloud_trap'] // 魔法神殿的放射云(ParticleEmitter 每 3 帧按 cloud_circle 图往世界写 cloud_radioactive 真格) // 古代实验室:激光炮(lasergun.lua 每 10 帧计一次,计到 11 朝下射 laser_lasergun)/ 雕像陷阱(人到 32px 内变活雕像 —— 只当雕像摆着)
// projectiles/mine 落地变成的 mine_scavenger:有血有 Hitbox 的地雷(CollisionTrigger 圈 + ON_DEATH 爆炸),丛林 / 金库表里直接放的就是它
const HAZARDS = ['mine_scavenger']
for (const kind of ['animals', 'props', 'items/pickup', 'buildings', 'projectiles']) {
  for (const n of kind === 'animals' ? ANIMALS : kind === 'props' ? PROPS : kind === 'buildings' ? BUILDINGS : kind === 'projectiles' ? HAZARDS : ITEMS) {
    const xml = readFile(`data/entities/${kind}/${n}.xml`)
    if (!xml) { console.warn('缺', kind, n); continue }
    const e = parseEntity(xml)
    // animals 下的子目录(rainforest/ lukki/)是另一套强化版,键带目录前缀(和 scenes.js entKey 一致);props/physics/x 仍取文件名
    // animals/statue(雕像陷阱活化出来的怪)和 props/statue(金字塔石像)同名,怪的键改 statue_animal
    const key = kind === 'animals' && n === 'statue' ? 'statue_animal' : kind === 'animals' && BOSS_KEYS[n] ? BOSS_KEYS[n] : kind === 'animals' && n.includes('/') ? n.replace(/\//g, '_') : path.basename(n)
    const d = { kind: kind === 'animals' ? 'creature' : kind === 'props' || kind === 'buildings' ? 'prop' : 'item', tags: [...new Set(e.tags.split(',').map((t) => t.trim()).filter(Boolean))], label: e.name }
    // 物品:金块面值(VariableStorage gold_value)、寿命(LifetimeComponent 帧)、自动拾取
    const vs = (e.comps.get('VariableStorageComponent') || []).find((v) => v.name === 'gold_value'); if (vs) d.gold = +vs.value_int
    const lt = first(e, 'LifetimeComponent'); if (lt?.lifetime) d.lifetime = +lt.lifetime
    const it = first(e, 'ItemComponent'); if (it) d.item = pick(it, ['auto_pickup', 'is_pickable', 'item_name'])
    d.label = tr(e.name || it?.item_name || key)
    // ── 房间可捡物的专属字段(第 32 条)──
    const vsv = (nm) => (e.comps.get('VariableStorageComponent') || []).find((v) => v.name === nm)
    const oc = first(e, 'OrbComponent'); if (oc) d.orb = { id: num(oc.orb_id, 0), card: vsv('card_name')?.value_string || 'LIGHT_BULLET' } // orb_pickup.lua:第一次捡 → 放 card_name 那张卡
    if (vsv('essence_id')) d.essence = vsv('essence_id').value_string // essence_pickup.lua:永久效果
    // 蛋:碎了 config_explosion.load_this_entity 放 projectiles/egg_*.xml,那个弹 19 帧后跑 egg_hatch.lua,按它的 entity_list 表出怪(除 worms 都 CHARM 友好、hp ×4、不掉金)
    if (/^egg_/.test(key)) { const pf = e.subs.config_explosion?.load_this_entity; const px = pf ? readFile(pf) || '' : ''; const lm = /name="entity_list"[\s\S]*?value_string="(\w+)"/.exec(px); d.egg = { list: lm ? lm[1] : 'monsters' } }
    if (vsv('potion_material')) d.potionMat = vsv('potion_material').value_string // potion_beer / potion_milk:固定内容的药水
    if (first(e, 'BookComponent')) { d.book = true; const k = String(first(e, 'UIInfoComponent')?.name || '').replace(/^\$/, '').replace('booktitle', 'bookdesc'); if (BOOKDESC.has(k)) d.bookText = BOOKDESC.get(k) }
    if (key === 'greed_curse') d.curse = 'greed'
    // 精灵:挑 enemies_gfx / props_gfx 下的主图(跳过 ui / 特效贴图)
    // 精灵:先挑非 emissive 的(僵尸的发光副精灵要跳过);全是 emissive 的(幽灵 / 骷髅虫本体就是发光的)再退回用 emissive
    // 宝珠三张精灵都 _enabled=0(orb_undiscovered / discovered / picked 按存档开一张):取 undiscovered 那张
    const allSprites = (e.comps.get('SpriteComponent') || []).filter((s) => s.image_file && !/ui_gfx|particles/.test(s.image_file) && !(s._tags || '').includes('ui') && (s._enabled !== '0' || (s._tags || '').includes('orb_undiscovered')))
    const sprites = allSprites.some((s) => s.emissive !== '1') ? allSprites.filter((s) => s.emissive !== '1') : allSprites
    const sc = sprites.find((s) => (s._tags || '').includes('character')) || sprites.find((s) => /enemies_gfx|props_gfx/.test(s.image_file)) || sprites[0]
    if (sc) { d.sprite = spriteDef(sc.image_file); if (d.sprite) { d.sprite.compOffX = num(sc.offset_x, 0); d.sprite.compOffY = num(sc.offset_y, 0); d.sprite.z = num(sc.z_index, 0); d.sprite.emissive = sc.emissive === '1' } }
    // 虫:头 + 若干身节 + 尾,每节一个 SpriteComponent,按顺序全留下
    // BossDragonComponent(Suomuhauki / Tapion vasalli maggot_tiny)= WormComponent 的引擎变体:同一组字段(speed / hunt / part_distance / hitbox_radius / target_kill_radius / hunt_box_radius …),当虫处理
    if (e.comps.has('WormComponent') || e.comps.has('BossDragonComponent')) d.parts = sprites.filter((s) => /enemies_gfx/.test(s.image_file)).map((s) => { const sp = spriteDef(s.image_file); if (sp) { sp.compOffX = num(s.offset_x, 0); sp.compOffY = num(s.offset_y, 0) } return sp }).filter(Boolean)
    const hb = first(e, 'HitboxComponent'); if (hb) d.hitbox = pick(hb, ['aabb_min_x', 'aabb_max_x', 'aabb_min_y', 'aabb_max_y', 'damage_multiplier'])
    const cd = first(e, 'CharacterDataComponent'); if (cd) d.character = pick(cd, ['collision_aabb_min_x', 'collision_aabb_max_x', 'collision_aabb_min_y', 'collision_aabb_max_y', 'climb_over_y', 'buoyancy_check_offset_y', 'check_collision_max_size_x', 'check_collision_max_size_y', 'fly_time_max', 'gravity'])
    const cp = first(e, 'CharacterPlatformingComponent'); if (cp) d.platforming = pick(cp, ['pixel_gravity', 'run_velocity', 'velocity_min_x', 'velocity_max_x', 'velocity_min_y', 'velocity_max_y', 'jump_velocity_x', 'jump_velocity_y', 'accel_x', 'accel_x_ground', 'turning_buffer', 'fly_velocity_x', 'fly_speed_max_up', 'fly_speed_max_down', 'fly_speed_change_spd', 'fly_speed_mult', 'jump_keydown_buffer'])
    const dm = first(e, 'DamageModelComponent'); if (dm) {
      d.damage = pick(dm, ['hp', 'max_hp', 'blood_material', 'blood_spray_material', 'blood_multiplier', 'ragdoll_blood_amount_absolute', 'ragdoll_material', 'ragdoll_filenames_file', 'ragdoll_offset_x', 'ragdoll_offset_y', 'ragdoll_fx_forced', 'create_ragdoll', 'ragdollify_child_entity_sprites', 'ragdollify_root_angular_damping', 'ragdollify_disintegrate_nonroot', 'fire_probability_of_ignition', 'fire_damage_amount', 'air_needed', 'air_in_lungs_max', 'falling_damages', 'falling_damage_height_min', 'falling_damage_height_max', 'falling_damage_damage_min', 'falling_damage_damage_max', 'materials_that_damage', 'materials_how_much_damage', 'critical_damage_resistance', 'physics_objects_damage', 'blood_sprite_directional', 'blood_sprite_large', 'drop_items_on_death'])
      if (e.subs.damage_multipliers) d.damage.multipliers = pick(e.subs.damage_multipliers, Object.keys(e.subs.damage_multipliers))
    }
    const ai = first(e, 'AnimalAIComponent'); if (ai) d.ai = pick(ai, ['sense_creatures', 'sense_creatures_through_walls', 'creature_detection_range_x', 'creature_detection_range_y', 'creature_detection_check_every_x_frames', 'attack_melee_enabled', 'attack_melee_max_distance', 'attack_melee_damage_min', 'attack_melee_damage_max', 'attack_melee_frames_between', 'attack_melee_action_frame', 'attack_melee_impulse_vector_x', 'attack_melee_impulse_vector_y', 'attack_melee_impulse_multiplier', 'attack_dash_enabled', 'attack_dash_distance', 'attack_dash_speed', 'attack_dash_damage', 'attack_dash_frames_between', 'attack_ranged_enabled', 'attack_ranged_entity_file', 'attack_ranged_entity_count_min', 'attack_ranged_entity_count_max', 'attack_ranged_min_distance', 'attack_ranged_max_distance', 'attack_ranged_frames_between', 'attack_ranged_predict', 'attack_ranged_offset_x', 'attack_ranged_offset_y', 'attack_ranged_action_frame', 'attack_ranged_aim_rotation_enabled', 'attack_ranged_aim_rotation_speed', 'attack_ranged_use_message', 'attack_only_if_attacked', 'can_fly', 'can_walk', 'escape_if_damaged_probability', 'path_distance_to_target_node_to_turn_around', 'eye_offset_x', 'eye_offset_y', 'needs_food', 'food_material', 'dont_counter_attack_own_herd', 'max_distance_to_cam_to_start_hunting', 'preferred_job', 'hide_from_prey', 'hide_from_prey_time', 'hide_from_prey_target_distance', 'tries_to_ranged_attack_friends', 'aggressiveness_min', 'aggressiveness_max'])
    // AIAttackComponent(Stevari 这类多段远程:按距离区间挑弹;attack_ranged_entity_file 留空时 AnimalAI 只负责追)
    const aas = (e.comps.get('AIAttackComponent') || []).filter((a) => a.attack_ranged_entity_file)
    if (aas.length) d.attacks = aas.map((a) => ({ min: num(a.min_distance, 0), max: num(a.max_distance, 300), gap: num(a.frames_between, 40), proj: path.basename(a.attack_ranged_entity_file, '.xml'), frame: num(a.attack_ranged_action_frame, 2), ox: num(a.attack_ranged_offset_x, 0), oy: num(a.attack_ranged_offset_y, -10), anim: a.animation_name || 'attack_ranged' }))
    const gd = first(e, 'GenomeDataComponent'); if (gd) d.genome = pick(gd, ['herd_id', 'food_chain_rank', 'is_predator', 'berserk_dont_attack_friends'])
    const pf = first(e, 'PathFindingComponent'); if (pf) d.path = pick(pf, ['can_jump', 'can_fly', 'can_swim_on_surface', 'can_dive', 'distance_to_reach_node_x', 'distance_to_reach_node_y', 'frames_to_get_stuck', 'jump_speed', 'initial_jump_lob', 'initial_jump_max_distance_x', 'initial_jump_max_distance_y', 'frames_between_searches'])
    const pa = first(e, 'PhysicsAIComponent'); if (pa) d.physicsAI = pick(pa, ['target_vec_max_len', 'force_coeff', 'force_balancing_coeff', 'force_max', 'torque_coeff', 'torque_balancing_coeff', 'torque_max', 'damping', 'torque_damping', 'rotation_speed', 'keep_upright', 'free_jump_min_x', 'free_jump_max_x', 'free_jump_min_y', 'free_jump_max_y', 'levitate'])
    const wc = first(e, 'WormComponent'); if (wc) d.worm = pick(wc, ['acceleration', 'gravity', 'tail_gravity', 'part_distance', 'ground_check_offset', 'hitbox_radius', 'target_kill_radius', 'target_kill_ragdoll_force', 'jump_cam_shake', 'speed', 'bite_damage', 'eat_anim_wait_mult'])
    const wa = first(e, 'WormAIComponent'); if (wa) d.wormAI = pick(wa, ['speed', 'speed_hunt', 'direction_adjust_speed', 'direction_adjust_speed_hunt', 'hunt_box_radius', 'random_target_box_radius', 'new_hunt_target_check_every', 'new_random_target_check_every', 'give_up_area_radius', 'give_up_time_frames'])
    // BossDragonComponent 把 Worm + WormAI 的字段合在一个组件里(speed/speed_hunt/acceleration/direction_adjust_speed(_hunt)/tail_gravity/part_distance/hitbox_radius/target_kill_radius/hunt_box_radius/random_target_box_radius/new_*_check_every/jump_cam_shake)
    const bd = first(e, 'BossDragonComponent')
    if (bd) {
      d.worm = { ...pick(bd, ['acceleration', 'tail_gravity', 'part_distance', 'ground_check_offset', 'hitbox_radius', 'target_kill_radius', 'target_kill_ragdoll_force', 'jump_cam_shake', 'speed', 'eat_anim_wait_mult']), gravity: 30, bite_damage: n.includes('maggot') ? 2.6 : 1.6 }
      d.wormAI = pick(bd, ['speed', 'speed_hunt', 'direction_adjust_speed', 'direction_adjust_speed_hunt', 'hunt_box_radius', 'random_target_box_radius', 'new_hunt_target_check_every', 'new_random_target_check_every'])
      d.dragon = true
    }
    const ce = first(e, 'CellEaterComponent'); if (ce) d.cellEater = pick(ce, ['radius', 'eat_probability', 'only_stain', 'limited_materials', 'ignored_material_tag', 'eat_dynamic_physics_bodies'])
    const ps = first(e, 'PhysicsImageShapeComponent'); if (ps) d.shape = { image: copyGfx(ps.image_file), material: ps.material || '', centered: ps.centered === '1', offX: num(ps.offset_x, 0), offY: num(ps.offset_y, 0), z: num(ps.z_index, 0) }
    const pb = first(e, 'PhysicsBodyComponent') || first(e, 'PhysicsBody2Component'); if (pb) d.body = pick(pb, ['friction', 'restitution', 'linear_damping', 'angular_damping', 'density', 'is_bullet', 'is_static', 'allow_sleep', 'hax_fix_going_through_ground', 'kill_entity_after_initialized', 'buoyancy', 'auto_clean'])
    // 钉在墙上的关节(挖掘场的轮子 nail_to_wall + 马达慢转 / 吊桶挂在钉子上摆)
    const pj = first(e, 'PhysicsJointComponent'); if (pj) d.joint = { nail: pj.nail_to_wall === '1', px: num(pj.pos_x, 0), py: num(pj.pos_y, 0), motor: pj.mMotorEnabled === '1' ? num(pj.mMotorSpeed, 0) : 0, breakable: pj.breakable === '1' }
    // 新格式 PhysicsJoint2Component(props/physics/lantern_small):REVOLUTE_JOINT_ATTACH_TO_NEARBY_SURFACE = 在 offset 处找最近的墙钉一个铰链,break_force 超了 / 像素被打掉(break_on_body_modified)就断
    const pj2 = first(e, 'PhysicsJoint2Component')
    if (pj2 && !d.joint) d.joint = { nail: true, attach: /ATTACH_TO_NEARBY_SURFACE/.test(pj2.type || ''), px: num(pj2.offset_x, 0), py: num(pj2.offset_y, 0), motor: 0, breakable: true, breakForce: num(pj2.break_force, 0), breakOnModified: pj2.break_on_body_modified === '1' }
    // ── Box2D 多体(第 29 条 ④):全部形状 / 刚体 / 关节 ──
    // 老式:每个 PhysicsBodyComponent(uid)配一张 PhysicsImageShape(body_id),几张图同一画布尺寸各画自己那块(矿车 18×15:车身 + 左右轮),
    //   PhysicsJointComponent pos_x/pos_y 是图内像素坐标(= 轮子像素中心),默认 revolute;nail_to_wall = 和地钉在一起
    // 新式:一个 PhysicsBody2Component,PhysicsImageShape 各带 body_id / is_root / offset(蘑菇:帽 + 4 节茎 + 脚),PhysicsJoint2Component offset 是实体坐标,
    //   type REVOLUTE / WELD / *_ATTACH_TO_NEARBY_SURFACE(沿 ray 找地面钉到地),break_force / break_distance / break_on_body_modified;Joint2Mutator 给电机
    const allShapes = (e.comps.get('PhysicsImageShapeComponent') || []).filter((s) => s.image_file && s._enabled !== '0')
    const allJoints = (e.comps.get('PhysicsJointComponent') || []).filter((j) => j._enabled !== '0')
    const allJoints2 = (e.comps.get('PhysicsJoint2Component') || []).filter((j) => j._enabled !== '0')
    if (allShapes.length > 1 || allJoints.length || allJoints2.length) {
      d.shapes = allShapes.map((s) => ({ image: copyGfx(s.image_file), material: s.material || '', bodyId: num(s.body_id, 0), isRoot: s.is_root === '1', isCircle: s.is_circle === '1', centered: s.centered === '1', offX: num(s.offset_x, 0), offY: num(s.offset_y, 0), z: num(s.z, 0) }))
      const bodies = (e.comps.get('PhysicsBodyComponent') || []).filter((b) => b._enabled !== '0')
      if (bodies.length) d.bodies = bodies.map((b) => ({ uid: num(b.uid, 0), linear_damping: num(b.linear_damping, 0), angular_damping: num(b.angular_damping, 0), auto_clean: b.auto_clean !== '0', fixed_rotation: b.fixed_rotation === '1', is_static: b.is_static === '1', update_entity_transform: b.update_entity_transform !== '0' }))
      const mut = new Map(); for (const m of e.comps.get('PhysicsJoint2MutatorComponent') || []) mut.set(num(m.joint_id, 0), { motorSpeed: num(m.motor_speed, 0), motorTorque: num(m.motor_max_torque, 1) })
      // physics_fungus.lua:VariableStorage lift = 每帧 PhysicsApplyForce(0, lift) 给根体的浮力(-25 = 向上 25 N),蘑菇靠它拉直、靠脚下地锚立着;各节电机按正弦摆
      const lift = (e.comps.get('VariableStorageComponent') || []).find((v) => v.name === 'lift'); if (lift) d.lift = num(lift.value_int, 0)
      d.joints = [
        ...allJoints.map((j) => ({ kind: 'old', type: 'REVOLUTE', body1: num(j.body1_id, 0), body2: num(j.body2_id, 0), px: num(j.pos_x, 0), py: num(j.pos_y, 0), nail: j.nail_to_wall === '1', grid: j.grid_joint === '1', breakable: j.breakable === '1', motor: j.mMotorEnabled === '1' ? num(j.mMotorSpeed, 0) : 0, motorTorque: num(j.mMaxMotorTorque, 1) })),
        ...allJoints2.map((j) => { const m = mut.get(num(j.joint_id, 0)); return { kind: 'new', type: (j.type || 'REVOLUTE_JOINT').replace(/_JOINT/, ''), body1: num(j.body1_id, 0), body2: num(j.body2_id, 0), ox: num(j.offset_x, 0), oy: num(j.offset_y, 0), rayX: num(j.ray_x, 0), rayY: num(j.ray_y, -10), surfOffY: num(j.surface_attachment_offset_y, 2.5), breakForce: num(j.break_force, 1.3), breakDistance: num(j.break_distance, 1.4142), breakOnModified: j.break_on_body_modified === '1', shearDeg: num(j.break_on_shear_angle_deg, 0), motor: m ? m.motorSpeed : 0, motorTorque: m ? m.motorTorque : 0 } }),
      ]
    }
    // PhysicsBody2Component root_offset:图的根(中心)相对实体位置的偏移(lantern_small 5,7 ≈ 9×13 图的中心)—— 按标记点放的时候用它对齐
    // init_offset:形状 / 关节的坐标系相对实体原点的偏移 —— 蘑菇 init_offset_y=40:形状从 −6 到 +41、脚在下、锚点 +41 往下射 30px 找地,
    // lua 把实体放在地面标记点上,整株要上移 40 脚才落在地面上(不减的话埔进地里 40px 被挤出来翻滚)
    const pb2 = first(e, 'PhysicsBody2Component'); if (pb2 && d.body) { d.body.rootOffX = num(pb2.root_offset_x, 0); d.body.rootOffY = num(pb2.root_offset_y, 0); d.body.initOffX = num(pb2.init_offset_x, 0); d.body.initOffY = num(pb2.init_offset_y, 0) }
    // chain_to_ceiling.lua:VariableStorage chain_N_x/y 是挂点(相对实体),没有就 (0,0);每根链往上找 200px 内的顶
    if ((e.comps.get('LuaComponent') || []).some((l) => /chain_to_ceiling/.test(l.script_source_file || ''))) {
      const vs = e.comps.get('VariableStorageComponent') || []
      const chains = []
      for (let i = 0; i < 10; i++) { const cx = vs.find((v) => v.name === `chain_${i}_x`), cy = vs.find((v) => v.name === `chain_${i}_y`); if (cx || cy) chains.push([num(cx?.value_int, 0), num(cy?.value_int, 0)]) }
      d.chains = chains.length ? chains : [[0, 0]]
    }
    const ex = first(e, 'ExplodeOnDamageComponent'); if (ex) d.explode = { ...pick(ex, ['explode_on_death_percent', 'explode_on_damage_percent', 'physics_body_modified_death_probability', 'physics_body_destruction_required']), config: e.subs.config_explosion ? pick(e.subs.config_explosion, Object.keys(e.subs.config_explosion)) : null }
    const mi = first(e, 'MaterialInventoryComponent'); if (mi) d.inventory = { ...pick(mi, ['leak_on_damage_percent', 'leak_pressure_min', 'leak_pressure_max', 'min_damage_to_leak', 'b2_force_on_leak', 'death_throw_particle_velocity_coeff', 'kill_when_empty', 'halftime_materials', 'do_reactions', 'do_reactions_explosions', 'do_reactions_entities', 'reaction_speed']), materials: e.subs.materials || [] }
    const li = (e.comps.get('LightComponent') || []).find((l) => l._enabled !== '0'); if (li) d.light = pick(li, ['radius', 'r', 'g', 'b', 'fade_out_time', 'blinking_freq', 'offset_x', 'offset_y'])
    const ic = first(e, 'ItemChestComponent'); if (ic) d.chest = pick(ic, ['level', 'other_entities_to_spawn'])
    // PhysicsBodyCollisionDamageComponent:刚体撞上东西速度超过 speed_threshold 就掉血(灯笼掉下来砸地 → 碎)
    const pbcd = first(e, 'PhysicsBodyCollisionDamageComponent'); if (pbcd) d.collisionDamage = { speed_threshold: num(pbcd.speed_threshold, 60), damage_multiplier: num(pbcd.damage_multiplier, 0.016667) }
    const luas = (e.comps.get('LuaComponent') || []).flatMap((l) => Object.entries(l).filter(([k]) => k.startsWith('script_')).map(([k, v]) => `${k.slice(7)}:${path.basename(v, '.lua')}`))
    if (luas.length) d.scripts = luas
    const pe = (e.comps.get('ParticleEmitterComponent') || []).filter((x) => x._enabled !== '0' && x.emitted_material_name)
    if (pe.length) d.emitters = pe.map((x) => ({ mat: x.emitted_material_name, count: [num(x.count_min, 1), num(x.count_max, 1)], life: [num(x.lifetime_min, 0.5), num(x.lifetime_max, 1)], vx: [num(x.x_vel_min, 0), num(x.x_vel_max, 0)], vy: [num(x.y_vel_min, 0), num(x.y_vel_max, 0)], interval: [num(x.emission_interval_min_frames, 1), num(x.emission_interval_max_frames, 1)], real: x.create_real_particles === '1', ox: num(x['offset.x'], 0), oy: num(x['offset.y'], 0) }))
    // PhysicsAI 飞行体(无人机 / 水晶 / 拟态箱):本体是 PhysicsImageShape 的图,Sprite 只有发光的眼(或干脆没有)→ 本体图另记,没精灵的用本体图拼一个单帧精灵
    if (kind === 'animals' && d.physicsAI && d.shape?.image) {
      d.bodyImage = d.shape.image
      if (!d.sprite?.image) { const sz = pngSize(`${OUT}/ent/${d.shape.image}`); if (sz) d.sprite = { image: d.shape.image, offX: sz[0] / 2, offY: sz[1] / 2, compOffX: 0, compOffY: 0, z: 0, emissive: false, def: 'default', anims: { default: { x: 0, y: 0, fw: sz[0], fh: sz[1], frames: 1, wait: 1, perRow: 1, loop: true } } }; d.bodyImage = null }
    }
    // 巢 / 卵这类带精灵动画的 building:当"站桩生物"(有血、会动画、打死掉金),不走不打
    if ((kind === 'buildings' || kind === 'projectiles') && !d.shape?.image && d.sprite?.image && d.hitbox) { d.kind = 'creature'; d.ai = d.ai || {} }
    // 巢的吐虫(flynest / firebugnest / spidernest .lua):每 121 帧 75% 概率、玩家 200px 内、总数上限 → 放一只
    const NESTS = { flynest: { max: 15, spawns: [['fly', 1]], oy: -4 }, firebugnest: { max: 10, spawns: [['firebug', 0.8], ['bigfirebug', 0.2]], oy: 0 }, spidernest: { max: 15, spawns: [['longleg', 1]], oy: -12 } }
    if (kind === 'buildings' && NESTS[n]) d.nest = { every: 121 / 60, chance: 0.75, dist: 200, ...NESTS[n] }
    // 神殿陷阱(crypt_trap_check.lua):朝向由精灵文件名 _left/_right 定;人在正面 170px、竖向 ydist(箭 18 / 火·吐 40 / 雷 25)内 → 每秒射一发,速度按弹种
    if ((e.comps.get('LuaComponent') || []).some((l) => /crypt_trap_check/.test(l.script_source_file || ''))) {
      const proj = path.basename(String(d.ai?.attack_ranged_entity_file || ''), '.xml')
      const dir = /right\.xml$/.test(sc?.image_file || '') ? 1 : -1
      d.trap = { proj, dir, ydist: /fire|spit/.test(proj) ? 40 : /arrow/.test(proj) ? 18 : 25, vel: /arrow/.test(proj) ? [300, 400] : /fire/.test(proj) ? [320, 320] : /thunder/.test(proj) ? [50, 50] : [360, 360], arrowLift: /arrow/.test(proj) ? -50 : 0 }
      const psc = first(e, 'PixelSceneComponent'); if (psc) d.pixelScene = { name: path.basename(psc.pixel_scene, '.png'), dir: psc.pixel_scene.split('/').slice(-2)[0], ox: num(psc.offset_x, 0), oy: num(psc.offset_y, 0) }
      d.stationary = true
      if (!d.character && d.hitbox) d.character = { collision_aabb_min_x: d.hitbox.aabb_min_x, collision_aabb_max_x: d.hitbox.aabb_max_x, collision_aabb_min_y: d.hitbox.aabb_min_y, collision_aabb_max_y: d.hitbox.aabb_max_y, climb_over_y: 0 }
    }
    // 激光炮(lasergun.lua):LuaComponent 每 execute_every_n_frame 帧计一次,timing 从 Random(0,10) 起,到 11 归零并朝下(vy 1000)射一发 laser_lasergun
    if ((e.comps.get('LuaComponent') || []).some((l) => /buildings\/lasergun\.lua/.test(l.script_source_file || ''))) {
      const every = num((e.comps.get('LuaComponent') || []).find((l) => /lasergun\.lua/.test(l.script_source_file || ''))?.execute_every_n_frame, 10)
      d.lasergun = { tick: every / 60, period: 11, proj: 'laser_lasergun', vy: 1000, oy: 8 }
      d.stationary = true; d.kind = 'creature'
      if (!d.character && d.hitbox) d.character = { collision_aabb_min_x: d.hitbox.aabb_min_x, collision_aabb_max_x: d.hitbox.aabb_max_x, collision_aabb_min_y: d.hitbox.aabb_min_y, collision_aabb_max_y: d.hitbox.aabb_max_y, climb_over_y: 0 }
      d.platforming = d.platforming || { pixel_gravity: 0, run_velocity: 0, velocity_max_x: 0 }
      d.ai = d.ai || {}
    }
    // 肉囊 meat_cyst:只有 5 帧精灵 + DamageModel(hp 1,血 = pus)→ 当能打破的站桩物
    if (n === 'meat_cyst') { d.kind = 'creature'; d.stationary = true; d.ai = d.ai || {}; d.hitbox = d.hitbox || { aabb_min_x: -8, aabb_max_x: 8, aabb_min_y: -8, aabb_max_y: 8 }; d.character = { collision_aabb_min_x: -8, collision_aabb_max_x: 8, collision_aabb_min_y: -8, collision_aabb_max_y: 8, climb_over_y: 0 }; d.platforming = { pixel_gravity: 0, run_velocity: 0, velocity_max_x: 0 } }
    // 激光门 lasergate_down:LaserEmitterComponent(朝下 laser_angle_add_rad 1.571,max_length 160,damage_to_entities 0.2,beam_radius 1.5),lasergate_ver.lua 按 cos 亮灭
    const le = first(e, 'LaserEmitterComponent')
    // Boss 身上的 LaserEmitterComponent 列表(Mestarien mestari 三门 / Unohdettu 四门,子实体里的另在 Bosses.js 里按 lua 写死):<laser> 子块的字段
    if (le && BOSS_SET.has(key)) {
      d.lasers = (e.comps.get('LaserEmitterComponent') || []).map((l, i) => {
        const blocks = [...xml.matchAll(/<laser\b([^>]*)>/g)].map((m) => attrsOf(m[1]))
        const L = blocks[i] || {}
        return { angle: num(l.laser_angle_add_rad, 0), dmg: num(L.damage_to_entities, 0.8), cellDmg: num(L.damage_to_cells, 50000), maxDur: num(L.max_cell_durability_to_destroy, 14), maxLen: num(L.max_length, 240), radius: num(L.beam_radius, 10.5), particle: L.beam_particle_type || 'spark_red' }
      })
    } else if (le) {
      d.lasergate = { maxLen: num(le.max_length, 160), dmg: num(le.damage_to_entities, 0.2), radius: num(le.beam_radius, 1.5), angle: num(le.laser_angle_add_rad, 1.571) }
      d.kind = 'creature'; d.stationary = true; d.invulnerable = true; d.ai = {}
      d.hitbox = d.hitbox || { aabb_min_x: -1, aabb_max_x: 1, aabb_min_y: -1, aabb_max_y: 1 }
      d.character = d.character || { collision_aabb_min_x: -1, collision_aabb_max_x: 1, collision_aabb_min_y: -1, collision_aabb_max_y: 1, climb_over_y: 0 }
      d.platforming = d.platforming || { pixel_gravity: 0, run_velocity: 0, velocity_max_x: 0 }
    }
    // 旗 banner:只有 7 帧飘动精灵(banner.xml offset 12,30)→ 打不坏的站桩物,只播动画
    if (n === 'banner') { d.kind = 'creature'; d.stationary = true; d.invulnerable = true; d.ai = {}; d.hitbox = { aabb_min_x: -1, aabb_max_x: 1, aabb_min_y: -1, aabb_max_y: 1 }; d.character = { collision_aabb_min_x: -1, collision_aabb_max_x: 1, collision_aabb_min_y: -1, collision_aabb_max_y: 1, climb_over_y: 0 }; d.platforming = { pixel_gravity: 0, run_velocity: 0, velocity_max_x: 0 } } // 盒子给 1px:子弹不被旗挡
    // 放射云陷阱 cloud_trap:没精灵没血,只有两个发射器 + 绿光 → 看不见的站桩物,每 3 帧往圆内写一格 cloud_radioactive(真气体)
    if (n === 'cloud_trap') {
      const pe0 = (e.comps.get('ParticleEmitterComponent') || []).find((p) => p.create_real_particles === '1')
      d.cloudTrap = { mat: pe0?.emitted_material_name || 'cloud_radioactive', every: num(pe0?.emission_interval_min_frames, 3) / 60, r: 14 }
      d.kind = 'creature'; d.stationary = true; d.invulnerable = true; d.ai = {}
      d.sprite = { image: 'ghost', offX: 0, offY: 0, compOffX: 0, compOffY: 0, z: 0, emissive: false, def: 'stand', anims: {} }
      d.hitbox = { aabb_min_x: -1, aabb_max_x: 1, aabb_min_y: -1, aabb_max_y: 1 }
      d.character = { collision_aabb_min_x: -1, collision_aabb_max_x: 1, collision_aabb_min_y: -1, collision_aabb_max_y: 1, climb_over_y: 0 }
      d.platforming = { pixel_gravity: 0, run_velocity: 0, velocity_max_x: 0 }
    }
    // 雕像陷阱(statue_trap.lua:人到 32px 内换成活雕像 animals/statue)—— 只当不动的雕像摆着,没有血
    if (/^statue_trap_/.test(n)) { d.statueTrap = { radius: 32, spawn: 'statue_animal' }; d.stationary = true; d.kind = 'creature'; d.ai = d.ai || {}; d.hitbox = d.hitbox || { aabb_min_x: -1, aabb_max_x: 1, aabb_min_y: -1, aabb_max_y: 1 }; d.character = d.character || { collision_aabb_min_x: -6, collision_aabb_max_x: 6, collision_aabb_min_y: -14, collision_aabb_max_y: 0, climb_over_y: 0 }; d.platforming = d.platforming || { pixel_gravity: 0, run_velocity: 0, velocity_max_x: 0 }; d.invulnerable = true }
    // 法杖幽灵(wand_ghost.lua):本体没有精灵(base 的 debug 圆被 image_file="" 盖掉),出生时捡一根 wand_level_03 拿在手里开火,死了法杖掉地上
    if (n === 'wand_ghost') { d.wandGhost = 'wand_level_03'; d.sprite = { image: d.sprite?.image || 'ghost', offX: 0, offY: 0, compOffX: 0, compOffY: 0, z: 0, emissive: false, def: 'stand', anims: {} } }
    // 幽灵(GhostComponent):穿墙飘、hunt_box_radius 内追人、DamageNearbyEntities 光环每 3s 一次;damage_multipliers 全 0 = 打不死,靶碎水晶
    const gc = first(e, 'GhostComponent')
    if (gc) {
      d.ghost = { huntR: num(gc.hunt_box_radius, 412), speed: num(gc.speed, 20) }
      d.ai = { can_fly: 1, sense_creatures: 1, creature_detection_range_x: d.ghost.huntR, creature_detection_range_y: d.ghost.huntR, attack_melee_enabled: 0 }
      d.platforming = { pixel_gravity: 0, run_velocity: 0, fly_velocity_x: d.ghost.speed }
      d.character = d.character || { collision_aabb_min_x: -4, collision_aabb_max_x: 4, collision_aabb_min_y: -6, collision_aabb_max_y: 6, climb_over_y: 0 }
      const mul = e.subs.damage_multipliers || {}
      if (Object.values(mul).length && Object.values(mul).every((v) => +v === 0)) d.invulnerable = true
    }
    const dn = first(e, 'DamageNearbyEntitiesComponent'); if (dn) d.aura = { radius: num(dn.radius, 16), every: num(dn.time_between_damaging, 3), dmg: num(dn.damage_min, 0.25) }
    // AreaDamageComponent(lukki_tiny:盒内的 player_unit 每 update_every_n_frame 帧掉 damage_per_frame)
    const ad = first(e, 'AreaDamageComponent'); if (ad) d.areaDamage = { l: num(ad['aabb_min.x'], -8), r: num(ad['aabb_max.x'], 8), t: num(ad['aabb_min.y'], -8), b: num(ad['aabb_max.y'], 8), dmg: num(ad.damage_per_frame, 0.1), every: num(ad.update_every_n_frame, 10) / 60 }
    // lukki 蜘蛛:PhysicsShapeComponent 圆身 + PhysicsAI(force_coeff 推向目标)+ LimbBossComponent state=1(FollowPlayer)+ 子实体腿(IKLimbComponent length,
    // IKLimbAttackerComponent radius 的那条是攻击腿,IKLimbWalkerComponent 的踩地);腿的三张图 limb_A(根→膝)/ limb_B(膝→脚)/ knee。子实体在 parseEntity 里被剔掉,这里从原文另抽
    const limbRefs = [...xml.matchAll(/<Entity\b[^>]*>\s*<Base\s+file="([^"]+)"\s*\/>\s*<\/Entity>/g)].map((m) => m[1]).filter((f) => /limb/.test(f) && !/limb_enemy_generic/.test(f))
    if (kind === 'animals' && limbRefs.length && (e.comps.has('LimbBossComponent') || e.comps.has('IKLimbsAnimatorComponent'))) {
      d.limbs = limbRefs.map((f) => {
        const lx = readFile(f) || ''
        const L = parseComponents(lx)
        const ik = first(L, 'IKLimbComponent'), at = first(L, 'IKLimbAttackerComponent')
        const imgs = (L.comps.get('SpriteComponent') || []).map((s) => ({ img: copyGfx(s.image_file), ox: num(s.offset_x, 0), oy: num(s.offset_y, 0), knee: /knee/i.test(s.image_file || ''), b: /limb_b/i.test(s.image_file || '') }))
        return { len: num(ik?.length, 40), attacker: at ? num(at.radius, 40) : 0, walker: L.comps.has('IKLimbWalkerComponent'), a: imgs.find((i) => !i.knee && !i.b) || null, b: imgs.find((i) => i.b) || null, knee: imgs.find((i) => i.knee) || null }
      })
      const sh = first(e, 'PhysicsShapeComponent'); const r = num(sh?.radius_x, 8)
      d.physShape = { r, friction: num(sh?.friction, 0), restitution: num(sh?.restitution, 0.3) }
      // 身体是 box2d 圆,没有 CharacterPlatforming:碰撞盒取圆的内接方(能钻的缝和圆一样宽),行走参数只留飞行(PathFinding can_fly + PhysicsAI 不受重力约束)
      const hr = Math.max(3, Math.round(r * 0.85))
      d.character = d.character || { collision_aabb_min_x: -hr, collision_aabb_max_x: hr, collision_aabb_min_y: -hr, collision_aabb_max_y: hr, climb_over_y: 0 }
      d.platforming = d.platforming || { pixel_gravity: 0, run_velocity: 0, velocity_max_x: 0 }
      d.ai = d.ai || { can_fly: 1, sense_creatures: 1 }
      // 身体的其余精灵(lukki_wiggle 4 帧抖动 / emissive 发光眼)叠在主精灵上画
      d.overlays = allSprites.filter((s) => s !== sc).map((s) => { const sp = spriteDef(s.image_file); if (!sp) return null; sp.compOffX = num(s.offset_x, 0); sp.compOffY = num(s.offset_y, 0); sp.emissive = s.emissive === '1' || s.additive === '1'; return sp }).filter(Boolean)
    }
    // lukki_eggs.lua damage_received:被打(>0.1 伤)致死或 10% → 出一只 lukki_tiny
    if ((e.comps.get('LuaComponent') || []).some((l) => /lukki_eggs/.test(l.script_damage_received || ''))) d.eggs = 'lukki_lukki_tiny'
    // giantshooter_death.lua damage_received:hp 从 ≥0.3 被打到 <0.3 那一下 → 出 3 只 slimeshooter(不是 weak),位置 ±10、速度 x −90~90 / y −150~25
    if ((e.comps.get('LuaComponent') || []).some((l) => /giantshooter_death/.test(l.script_damage_received || ''))) d.splitBelow = { hp: 0.3, spawn: 'slimeshooter', count: 3, offset: 10, vx: [-90, 90], vy: [-150, 25] }
    // 子实体 verlet 链(giantshooter 的 5 条黏液触手:<Entity><Base file="verlet_chains/…"><InheritTransformComponent><Transform position>):
    // VerletPhysicsComponent num_points / resting_distance / stiffness / velocity_dampening,每个点一张 2×2 / 2×1 的小精灵(piece xml 的 SpriteComponent,offset_y 是贴图锚点)
    // 只收触手类(悬挂物 props/suspended_* 的 verlet_chains/chain 是往上吊到天花板的链,另一回事)
    // boss_pit/tentacle.xml、boss_meat|boss_limbs/hair1~3.xml(verlet 触手 / 头发)、boss_centipede/verlet_chains/verlet_vine*.xml 同一套写法,一并收
    const chainRefs = [...xml.matchAll(/<Entity>\s*<Base\s+file="([^"]*(?:verlet_chains\/[^"]*(?:tentacle|vine)|\/tentacle|\/hair\d)[^"]*)"\s*>\s*<InheritTransformComponent>\s*<Transform\s+position\.x="([^"]+)"\s+position\.y="([^"]+)"/g)]
    if (kind === 'animals' && chainRefs.length) {
      d.tentacles = chainRefs.map((m) => {
        const cx = readFile(m[1]) || ''
        const C = parseComponents(cx), vp = first(C, 'VerletPhysicsComponent')
        const pieces = [...cx.matchAll(/<Base\s+file="([^"]+)"\s*\/>/g)].map((p) => { const px = readFile(p[1]) || ''; const s = first(parseComponents(px), 'SpriteComponent'); return s ? { img: copyGfx(s.image_file), oy: num(s.offset_y, 0) } : null }).filter(Boolean)
        return { x: num(m[2], 0), y: num(m[3], 0), points: num(vp?.num_points, 2), rest: num(vp?.resting_distance, 2), stiff: num(vp?.stiffness, 1), damp: num(vp?.velocity_dampening, 0.99), massMin: num(vp?.mass_min, 0.8), massMax: num(vp?.mass_max, 1), pieces }
      }).filter((c) => c.pieces.length)
    }
    // 地雷:CollisionTriggerComponent(触发半径 / 计时)+ ExplosionComponent trigger=ON_DEATH 的 config_explosion
    const ct = first(e, 'CollisionTriggerComponent'); if (ct) d.mine = { radius: num(ct.radius, 20), timer: num(ct.timer_for_destruction, 30) / 60 }
    const exc = first(e, 'ExplosionComponent'); if (exc && (exc.trigger || 'ON_DEATH') === 'ON_DEATH' && e.subs.config_explosion) d.explosionOnDeath = pick(e.subs.config_explosion, Object.keys(e.subs.config_explosion))
    // ── Boss(见 docs/noita-bosses.md):标记 + 引擎组件字段 ──
    if (kind === 'animals' && BOSS_SET.has(key)) {
      d.boss = key
      // LimbBossComponent state(0 MoveAroundNest 1 FollowPlayer 2 Escape 3 DontMove 4 MoveTo 5 MoveDirectlyTowardsPlayer)
      const lb = first(e, 'LimbBossComponent'); if (lb) d.limbBoss = { state: num(lb.state, 1) }
      // PhysicsBody 圆(boss_pit / boss_meat / boss_robot / boss_limbs / boss_centipede / boss_sky):没有 CharacterData 的按半径给碰撞盒,按飞行体走(PhysicsAI 不受重力)
      const sh = first(e, 'PhysicsShapeComponent')
      if (sh && !d.physShape) d.physShape = { r: num(sh.radius_x, 8), friction: num(sh.friction, 0), restitution: num(sh.restitution, 0.3) }
      if (!d.character && d.physShape) { const hr = Math.max(3, Math.round(d.physShape.r * 0.85)); d.character = { collision_aabb_min_x: -hr, collision_aabb_max_x: hr, collision_aabb_min_y: -hr, collision_aabb_max_y: hr, climb_over_y: 0 } }
      if (!d.character && d.hitbox) d.character = { collision_aabb_min_x: d.hitbox.aabb_min_x, collision_aabb_max_x: d.hitbox.aabb_max_x, collision_aabb_min_y: d.hitbox.aabb_min_y, collision_aabb_max_y: d.hitbox.aabb_max_y, climb_over_y: 0 }
      if (!d.platforming) d.platforming = { pixel_gravity: 0, run_velocity: 0, velocity_max_x: 0 }
      if (!d.ai) d.ai = { can_fly: 1, sense_creatures: 1 }
      if (!d.hitbox && d.physShape) d.hitbox = { aabb_min_x: -d.physShape.r, aabb_max_x: d.physShape.r, aabb_min_y: -d.physShape.r, aabb_max_y: d.physShape.r }
      // 多个 HitboxComponent(boss_limbs:三块 damage_multiplier 0 的壳 + 一块 hitbox_weak_spot 1.0 的弱点)
      const hbs = (e.comps.get('HitboxComponent') || []).map((h) => ({ ...pick(h, ['aabb_min_x', 'aabb_max_x', 'aabb_min_y', 'aabb_max_y', 'damage_multiplier']), tags: h._tags || '' }))
      if (hbs.length > 1) d.hitboxes = hbs
      // BlackHoleComponent(Kolmisilmän silmä 的吸尘:_tags vacuum,attractor −3 / r128,默认关)
      const bh = first(e, 'BlackHoleComponent'); if (bh) d.blackHole = { radius: num(bh.radius, 16), attractor: num(bh.particle_attractor_force, 2), damageProb: num(bh.damage_probability, 0), enabled: bh._enabled !== '0' }
      // 子实体 / 同体 GameEffectComponent(PROTECTION_PROJECTILE / STUN_PROTECTION_*):Bosses.js 按名处理
      d.effects = [...xml.matchAll(/<GameEffectComponent\b([^>]*)>/g)].map((m) => attrsOf(m[1]).effect).filter(Boolean)
      // 精灵表里有哪些动画(open / opened / close / aggro / charge / death1 …)—— Bosses.js 按名字播
      if (d.sprite?.anims) d.animNames = Object.keys(d.sprite.anims)
    }
    // Boss 的子实体(islandspirit 的 wisp / Sauvojen tuntija 的 8 颗环绕球):有血有 Hitbox 有精灵但没 AI —— 当飘着的生物,位置由 Bosses.js 按各自 lua 摆
    if (kind === 'animals' && /^(wisp|wizard_orb_blood|wizard_orb_death)$/.test(key)) {
      d.kind = 'creature'; d.bossChild = key
      d.ai = { can_fly: 1 }; d.platforming = { pixel_gravity: 0, run_velocity: 0, velocity_max_x: 0 }
      if (!d.character && d.hitbox) d.character = { collision_aabb_min_x: d.hitbox.aabb_min_x, collision_aabb_max_x: d.hitbox.aabb_max_x, collision_aabb_min_y: d.hitbox.aabb_min_y, collision_aabb_max_y: d.hitbox.aabb_max_y, climb_over_y: 0 }
      const mul = e.subs.damage_multipliers || {}
      if (Object.values(mul).length && Object.values(mul).every((v) => +v === 0)) d.invulnerable = true
    }
    // 有 CharacterPlatforming 没 CharacterDataComponent 的(ethereal_being):碰撞盒借 Hitbox
    if (kind === 'animals' && d.platforming && !d.character && d.hitbox) d.character = { collision_aabb_min_x: d.hitbox.aabb_min_x, collision_aabb_max_x: d.hitbox.aabb_max_x, collision_aabb_min_y: d.hitbox.aabb_min_y, collision_aabb_max_y: d.hitbox.aabb_max_y, climb_over_y: 4 }
    // 站桩怪(shooterflower:有 AnimalAI 没 CharacterPlatforming):补一份不动的行走参数,Entities 里 stationary 不走路只开火
    if ((kind === 'animals' || kind === 'buildings' || kind === 'projectiles') && d.ai && !d.platforming && d.hitbox && d.sprite?.image) {
      d.stationary = true
      d.platforming = { pixel_gravity: 0, run_velocity: 0, velocity_max_x: 0 }
      d.character = d.character || { collision_aabb_min_x: d.hitbox.aabb_min_x, collision_aabb_max_x: d.hitbox.aabb_max_x, collision_aabb_min_y: d.hitbox.aabb_min_y, collision_aabb_max_y: d.hitbox.aabb_max_y, climb_over_y: 0 }
    }
    // 布娃娃:filenames.txt 列的 png 全拷
    if (d.damage?.ragdoll_filenames_file) {
      const list = readFile(d.damage.ragdoll_filenames_file)
      if (list) d.ragdoll = list.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => copyGfx(l)).filter(Boolean)
    }
    out[key] = d
  }
}
// 巫师洞入口的门(wizardcave_gate.xml):两个 image_animation_file 粒子发射器按这张图的像素撒红火花 —— Entities 直接把图画出来再撒火花
copyGfx('data/particles/image_emitters/wizardcave_gate_ornaments.png')
// PixelSpriteComponent 的像素贴图 props(煤矿木架 / 丛林树 / 金库机器):World 当背景贴图放,图拷到 scenes/props/(Worker 走 assets.loadScene)
fs.mkdirSync(`${OUT}/scenes/props`, { recursive: true })
let nps = 0
for (const rel of ['props_gfx/coalmine_structure_background_01.png', 'props_gfx/coalmine_structure_background_02.png', 'props_gfx/coalmine_large_structure_background_01.png', 'props_gfx/coalmine_large_structure_background_02.png', 'props_gfx/coalmine_i_structure_background_01.png', 'props_gfx/coalmine_i_structure_background_02.png',
  ...[1, 2, 3, 4, 5, 6].map((i) => `vegetation/swamp_cropped_0${i}.png`), ...[1, 2, 3, 4, 5, 6].map((i) => `props_gfx/vault_machine_${i}.png`),
  'props_gfx/sarcophagus.png', 'props_gfx/sarcophagus_evil.png', 'props_gfx/statue_back.png', 'props_gfx/statue.png']) {
  const src = `${UNPACKED}/${rel}`
  if (fs.existsSync(src)) { fs.copyFileSync(src, `${OUT}/scenes/props/${path.basename(rel)}`); nps++ } else console.warn('缺 pixelsprite', rel)
}
console.log(`scenes/props: ${nps} 张像素贴图`)
fs.writeFileSync(`${OUT}/entities.json`, JSON.stringify(out))
console.log(`entities.json ${Object.keys(out).length} 条,贴图 ${copied.size} 张 → ${OUT}/ent/`)
for (const [k, d] of Object.entries(out)) console.log(`  ${k.padEnd(26)} ${d.kind.padEnd(8)} hp=${d.damage?.hp ?? '-'} sprite=${d.sprite?.image || d.shape?.image || '-'} anims=${Object.keys(d.sprite?.anims || {}).length} herd=${d.genome?.herd_id || '-'} box=${d.character ? `${d.character.collision_aabb_min_x}..${d.character.collision_aabb_max_x} × ${d.character.collision_aabb_min_y}..${d.character.collision_aabb_max_y}` : '-'} run=${d.platforming?.run_velocity ?? '-'} g=${d.platforming?.pixel_gravity ?? '-'} jump=${d.platforming?.jump_velocity_y ?? '-'}`)
