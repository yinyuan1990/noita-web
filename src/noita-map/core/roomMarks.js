// ── 整图布景 / spliced 大图里的标记像素 → 实体生成点(各房间 lua 的 RegisterSpawnFunction 逐条照抄)──
// 规则和原版一样:一个标记像素由**它落在的那个 chunk 的群系** lua 处理(spliced 的 boss_arena.png / lake_statue.png 横跨几个群系,
// 每个像素查自己脚下的群系表;整图房间(orbroom / essenceroom …)整张都在自己的 chunk 里)。
// 表项:色 → handler(x, y, c);c = { out:{spawns,lights,extra}, prng, ws, ng, globals, biome, func }
// 生成表掷骰走 scenes.js 的 rollSpawn(director_helpers spawn():PR(x,y) 选行、(x+5,y+5) 掷数量 / 抖动)。
// 实体键 = xml 文件名(和 noita-prepare-entities 一致;boss 用短键 boss_meat / boss_robot …);这边不认识的键(传送门 / 检查器 / 书)Entities 会记进 skipped,不报错。

import { rollSpawn } from './scenes.js'
import { TEMPLE_MARKS, TEMPLE_MARK_BIOMES, templeMark } from './templeMarks.js'
import { NollaPrng } from './NollaPrng.js'

const E = (entity, dx = 0, dy = 0, extra = null) => (x, y, c) => { c.out.spawns.push({ entity, x: x + dx, y: y + dy, func: c.func, ...(extra || {}) }) }
const MANY = (...hs) => (x, y, c) => { for (const h of hs) h(x, y, c) }
/** spawn(g_table, x+dx, y+dy, rx, ry);tb = 用哪个群系的 SPAWN_TABLES(friend_1~6 共用 friend) */
const ROLL = (table, dx = 0, dy = 0, rx = 4, ry = 4, tb = null) => (x, y, c) => {
  for (const s of rollSpawn(tb || c.biome, table, x + dx, y + dy, c.ws, rx, ry, c.ng)) c.out.spawns.push({ ...s, func: c.func })
}
const TEMPLE = Object.fromEntries(Object.entries(TEMPLE_MARKS).map(([col, f]) => [col, (x, y, c) => templeMark(f, x, y, { ...c, func: f })]))

// wang_scripts.csv 默认色里房间会用到的:spawn_wands 50a0f0 → biome_scripts.lua spawn(g_items, x-5, y, 0, 0);spawn_items 00ff00 / spawn_props c88d1a / 小怪 ff0000 / 大怪 800000 / spawn_orb ffd171
const WANDS = ROLL('g_items', -5, 0, 0, 0)

/** orbroom_NN.lua spawn_orb(默认色 ffd171 @ (255,336)):宝珠 + 书(x−30, y+40);金尘粒子 / 音乐能量 / 材质检查器不做 */
const ORB = (n) => ({ 0xffd171: MANY(E(`orb_${n}`), E(`book_${n}`, -30, 40)) })
/** 精华室系(essenceroom*.lua / rock_room / gun_room / moon_room …):31d0b4 一个点放几件东西 */
const ESSENCE = (...hs) => ({ 0x31d0b4: MANY(...hs) })
/** 雪窟密室 / 沙漏室 / 立方体室共用一套(snowcave_secret_chamber.lua 等三份一样):366178 回程传送门、50a0f0 spawn_wands、55af8c 头骨表 */
const CHAMBER = (tele, extra = {}) => ({ 0x366178: E(tele), 0x50a0f0: (x, y, c) => WANDS(x, y, { ...c, biome: 'chamber' }), 0x55af8c: ROLL('g_skulls', 0, 0, 0, 0, 'chamber'), ...extra })
/** friend_1~6.lua(cavern.png 才有标记;friendroom.png 没有):杀手 ×8、友人、葫芦、树表;藤蔓(g_vines 含 hanging_root)先不做 */
const FRIEND = { 0x9dd0b0: E('ultimate_killer'), 0x9dd0c0: E('friend'), 0x31d0b0: E('gourd'), 0x9dd0d0: ROLL('g_trees', 0, 0, 0, 0, 'friend') }
/** ocarina.lua spawn_secret:8 张陶笛音符卡两排(间距 20,第二排 y−48)+ 长笛 (x, y−64) */
const OCARINA_CARDS = ['OCARINA_A', 'OCARINA_B', 'OCARINA_C', 'OCARINA_D', 'OCARINA_E', 'OCARINA_F', 'OCARINA_GSHARP', 'OCARINA_A2']
const ocarina = (x, y, c) => {
  for (const row of [0, -48]) OCARINA_CARDS.forEach((id, i) => c.out.spawns.push({ entity: 'spell', action: id, x: x - OCARINA_CARDS.length * 10 + (i + 0.5) * 20, y: y + row, func: c.func }))
  c.out.spawns.push({ entity: 'flute', x, y: y - 64, func: c.func })
}
/** mountain_tree.lua spawn_ocarina:5 张康特勒琴音符卡两排(x − 50 + i×20,第二排 y+20)+ 琴 (x, y−32);圣诞 workshop_tree_holiday 不做 */
const KANTELE_CARDS = ['KANTELE_A', 'KANTELE_D', 'KANTELE_DIS', 'KANTELE_E', 'KANTELE_G']
const kantele = (x, y, c) => {
  for (const row of [0, 20]) KANTELE_CARDS.forEach((id, i) => c.out.spawns.push({ entity: 'spell', action: id, x: x - KANTELE_CARDS.length * 10 + (i + 1) * 20, y: y + row, func: c.func }))
  c.out.spawns.push({ entity: 'kantele', x, y: y - 32, func: c.func })
}

export const ROOM_MARKS = {
  ...Object.fromEntries([...TEMPLE_MARK_BIOMES].map((b) => [b, TEMPLE])),
  // 宝珠室(orbrooms/orbroom_NN.lua):orbroom.png 一张图共用;07 的 init 还放 orb_07_pitcheck_b(x−64, y+256),是检查器不做
  orbroom_02: ORB('02'), orbroom_04: ORB('04'), orbroom_05: ORB('05'), orbroom_06: ORB('06'), orbroom_07: ORB('07'), orbroom_08: ORB('08'), orbroom_09: ORB('09'), orbroom_10: ORB('10'),
  // 精华室 ×4 + 同图的几个密室(essenceroom*.lua / rock_room / gun_room / moon_room / solid_wall_tower_10)
  essenceroom: ESSENCE(E('essence_laser')), essenceroom_hell: ESSENCE(E('essence_water')), essenceroom_alc: ESSENCE(E('essence_alcohol')), essenceroom_air: ESSENCE(E('essence_air')),
  mystery_teleport: ESSENCE(E('mystery_teleport')),
  rock_room: ESSENCE(E('musicstone', -24, 0), E('book_moon', 24, -16)),
  gun_room: ESSENCE(E('experimental_wand_3', -8, 12), E('book_robot', 8, 0)),
  moon_room: ESSENCE(E('perk_pickup', -8, 0, { perk: 'MOON_RADAR' }), E('book_music_a', 8, 0)), // perk_spawn(x−8, y, "MOON_RADAR")
  solid_wall_tower_10: ESSENCE(E('wand_good_1', -20, 12), E('wand_good_2', 0, 12), E('wand_good_3', 20, 12), E('mystery_teleport_back', 0, -200)),
  // 炼金术士的几间密室(song_room / ocarina / alchemist_secret:spawn_secret 31d0b4)
  song_room: ESSENCE(E('chest_light'), E('book_essences', 24, -16)),
  ocarina: { 0x31d0b4: ocarina },
  alchemist_secret: ESSENCE(E('chest_dark'), E('book_diamond', -24, -16)),
  // secret_lab.png 三间(spawn_orb 默认色 ffd171 @ (255,336)):Ylialkemisti / Mestarien mestari / Unohdettu(ghost_spawn_check.xml 出 boss_ghost)+ 两颗回血水晶 + 雪水晶
  secret_lab: { 0xffd171: E('boss_alchemist', 20, 0) },
  mestari_secret: { 0xffd171: E('boss_wizard', 20, 0) },
  ghost_secret: { 0xffd171: MANY(E('boss_ghost'), E('hpcrystal', -64, 0), E('hpcrystal', 64, 0), E('snowcrystal')) },
  // 肉室 / 机器人室(spawn_essence 31d0b4 就是 boss 位)
  meatroom: ESSENCE(E('boss_meat')), roboroom: ESSENCE(E('boss_robot')),
  // 机器蛋室(robot_egg.lua):回程传送门、钢箱、g_items 法杖、小怪(roboguard / assassin / monk)、大怪(spearbot);spawn() 缺省 rand 4
  robot_egg: { 0x548f77: E('teleport_robot_egg_return'), 0x709615: E('chest_steel'), 0x00ff00: ROLL('g_items'), 0xff0000: ROLL('g_small_enemies'), 0x800000: ROLL('g_big_enemies') },
  funroom: { 0x00ffaa: E('funroom_check') },
  null_room: { 0xbbcc00: E('null_room_check1'), 0xbbcc01: E('null_room_check2'), 0xbbcc02: E('null_room_check3') },
  teleroom: Object.fromEntries([0xa9d024, 0xb9d024, 0xc9d024, 0xd9d024, 0xe9d024, 0xf9d024].map((col, i) => [col, E(`teleport_teleroom_${i + 1}`)])),
  friend_1: FRIEND, friend_2: FRIEND, friend_3: FRIEND, friend_4: FRIEND, friend_5: FRIEND, friend_6: FRIEND,
  snowcave_secret_chamber: CHAMBER('teleport_snowcave_buried_eye_return'),
  // 沙漏室的 spawn_items(00ff00 ×8):SetRandomSeed(x,y) make_random_card → 随机法术卡一张
  snowcastle_hourglass_chamber: CHAMBER('teleport_hourglass_return', { 0x00ff00: E('spell', 0, 0, { action: null }) }),
  excavationsite_cube_chamber: CHAMBER('teleport_meditation_cube_return'),
  // 雪城堡侧洞(snowcastle_cavern.lua):沙漏三件 + 商店 4 件(generate_shop_item 非打折)+ 鱼 2~5 条;藤蔓不做
  snowcastle_cavern: {
    0xff2974: E('hourglass_blood'), 0xff9122: MANY(E('hourglass_master'), E('teleport_hourglass')), 0x216bff: E('hourglass_music'),
    0x33934c: E('shop_item', 0, 0, { sale: false }), 0x03deaf: ROLL('g_fish', 0, 0, 0, 0),
  },
  // 巫师洞入口(wizardcave_entrance.lua):门怪 wizardcave_gate (x, y+55) —— boss_gate 四只 gate_monster 由 Bosses 按 wizardcave_gate.xml 摆
  wizardcave_entrance: { 0xc29e29: E('wizardcave_gate', 0, 55) },
  // 龙穴(dragoncave.lua):spawn_dragonspot → buildings/dragonspot.xml(Suomuhauki 的巢,人靠近出 boss_dragon)
  dragoncave: { 0x943030: E('dragonspot') },
  // 岩浆赛道(lavalake_racing.lua):检查点 / 终点 / 赛车 / 三块秒表 / 头骨表(spawn(g_skulls, x, y−5) 缺省 rand 4)
  lavalake_racing: {
    0xff6630: E('racing_checkpoint', 0, 0, { tag: 'checkpoint_1' }), 0x52f100: E('racing_checkpoint', 0, 0, { tag: 'checkpoint_2' }), 0x9e33ff: E('racing_checkpoint', 0, 0, { tag: 'finish_line' }),
    0x679c00: E('racing_cart'), 0xcaca00: MANY(E('racing_stopwatch', 0, 0.5), E('racing_stopwatch', 26, 0.5), E('racing_stopwatch', 52, 0.5)), 0xb8ffe1: ROLL('g_skulls', 0, -5),
  },
  // 岩浆湖竖井(lavalake_pit.lua):spawn_metportal(标记在 spliced/lavalake2.png 里,落在 lavalake_pit 群系)→ teleport_lavalake
  lavalake_pit: { 0xbf262b: E('teleport_lavalake') },
  // 胜利室(boss_victoryroom.lua):sampo 落点 + 机关;spawn_items → spawn_rewards.lua(打完 boss 的奖励,不做)
  boss_victoryroom: { 0xffd1a1: E('ending_sampo_spot_underground') },
  // 葫芦室(gourd_room.lua,标记在 spliced/gourd_room.png):灯 g_lamp(lantern_small 必出)、书 + 头骨 + 骨头、葫芦 ×5 + 一个霰弹手
  gourd_room: {
    0xffff00: ROLL('g_lamp', 0, 0, 0, 0), 0x9dd0b0: MANY(E('book_music_c'), E('physics_skull_01', 8, 0), E('physics_bone_02', 12, -16)),
    0x31d0b0: MANY(E('gourd'), E('gourd', -12, 0), E('gourd', 12, 0), E('gourd', 0, -12), E('gourd', -12, 0), E('shotgunner', 24, -24)),
  },
  // 水洞(watercave.lua,标记在 spliced/watercave.png 与 watercave_layout_N.png):random_layout 放一张随机布局图(见 roomMarksExtra);心 / 满血心
  watercave: { 0xffb539: (x, y, c) => { const r = Math.floor(c.prng.ProceduralRandom(c.ws, x, y) * 5 + 1); c.out.extra.push({ dir: 'general', name: `watercave_layout_${r}`, x, y, visual: '' }) }, 0x00ff00: E('heart'), 0xc88d1a: E('heart_fullhp') },
  // 湖心岛(lake_statue.lua,标记在 spliced/lake_statue.png):Kolmisilmän koipi 的召唤器、宝珠 + 书、鳗鱼、小动物、鱼、火精华、灯(0.7 lantern_small)
  lake_statue: {
    0x57ac68: E('boss_spirit_spawner'), 0xffd171: MANY(E('orb_01', -16, 0), E('book_02', 16, 0)), 0xb40b76: E('eel'), 0x3ae124: ROLL('g_small_animals'), 0xb4a00a: ROLL('g_fish'),
    0x31d0b4: E('essence_fire'), 0xffff00: ROLL('g_lamp', 0, 0, 0, 0), 0x30d14e: E('lake_statue_materialchecker'),
  },
  // 山顶浮岛(mountain_floating_island.lua):orb_00 + book_00(x+18)+ sampo 落点
  mountain_floating_island: { 0xffd171: MANY(E('orb_00'), E('book_00', 18, 0)), 0xffd1a1: E('ending_sampo_spot_mountain') },
  // 巨树(mountain_tree.lua,标记在 spliced/tree.png):书 / 蛋 / 陶笛(kantele)/ 秘密(workshop_tree_holiday + 贪婪诅咒)/ 石柱(spawn_pillars 一串 LoadPixelScene,不做)
  mountain_tree: { 0x3461c7: E('book_tree'), 0x9393d2: ROLL('g_egg'), 0x3482c7: kantele, 0x31d0b4: E('greed_curse') },
  // 天平(scale.lua):两块日石 + 奖品位
  scale: { 0x31d0b4: E('physics_sun_rock'), 0xadd0b4: E('physics_darksun_rock'), 0xad5cb4: E('scale_prize') },
  // 月亮(the_sky.lua / the_end.lua 的 spawn_moon 默认色):biome_scripts.lua spawn_moon → buildings/moon.xml
  the_sky: { 0x6b4f9b: E('moon_altar') }, the_end: { 0x6b4f9b: E('moon_altar') },
  // 沙漠骷髅(desert.lua spawn_secret_checker):orb_room_materialchecker → 成功放 teleport_lake(x, y−200);检查器不做
  desert: { 0x30d14e: E('orb_room_materialchecker') },
  // 实验室(终)boss_arena.lua:圣山那套 + 自己的几项(33934c 被后注册的空 spawn_shopitem 覆盖 → 不出货;03dead/dedead 是左右两组检查器;a85454 → workshop_exit_final)
  boss_arena: {
    ...TEMPLE, 0x33934c: () => {}, 0x03dead: E('areacheck_left'), 0xdedead: E('areacheck_right'), 0xa85454: E('workshop_exit_final'),
    // spawn_items:Kolmisilmä 本体 + sampo(x, y+80)+ 参考点
    0x00ff00: MANY(E('boss_centipede'), E('sampo', 0, 80)),
    0x845454: E('boss_arena_statues', -30, -30), 0x784dd2: MANY(E('physics_worm_deflector_crystal', 0, 5), E('physics_worm_deflector_base', 0, 5)),
    0xffb870: E('workshop_spell_visualizer'), 0x5a822d: E('workshop_allow_mods'), 0x10822d: E('workshop'),
  },
}

/** 有标记表的群系(World 只对这些群系里的布景 / 像素扫标记) */
export const ROOM_MARK_BIOMES = new Set(Object.keys(ROOM_MARKS))
/** 全部标记色(_stampScene 把它们当空气) */
export const ROOM_MARK_COLORS = new Set(Object.values(ROOM_MARKS).flatMap((t) => Object.keys(t).map(Number)))

/**
 * 扫一张布景图的标记像素。
 * @param {{width:number,height:number,data:Uint8Array}} png
 * @param {{x:number,y:number,dir:string,name:string}} sc  布景(世界坐标左上)
 * @param {{ws:number, ng:number, globals?:object, biomeAtWorld:(x:number,y:number)=>string|null}} ctx
 * @returns {{spawns:Array, lights:Array, extra:Array}}
 */
export function scanSceneMarks(png, sc, ctx) {
  const out = { spawns: [], lights: [], extra: [] }
  const prng = new NollaPrng(0)
  const d = png.data, W = png.width, H = png.height
  let lastBiome = null, table = null, lastCx = NaN, lastCy = NaN
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const o = (py * W + px) * 4
      if (d[o + 3] === 0) continue
      const r = d[o], g = d[o + 1], b = d[o + 2]
      if (r === g && g === b) continue
      const c = (r << 16) | (g << 8) | b
      if (!ROOM_MARK_COLORS.has(c)) continue
      const x = sc.x + px, y = sc.y + py
      const cx = Math.floor(x / 512), cy = Math.floor(y / 512)
      if (cx !== lastCx || cy !== lastCy) { lastCx = cx; lastCy = cy; lastBiome = ctx.biomeAtWorld(x, y); table = ROOM_MARKS[lastBiome] || null }
      const h = table?.[c]
      if (!h) continue
      h(x, y, { out, prng, ws: ctx.ws, ng: ctx.ng || 0, globals: ctx.globals || {}, biome: lastBiome, func: c.toString(16) })
    }
  }
  return out
}
