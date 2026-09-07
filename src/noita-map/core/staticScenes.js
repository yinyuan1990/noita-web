// ── 整图布景群系(pixel_scene="1",无 wang 砖):init(x, y) 里按 chunk 左上角固定放几张大图 ──
// 逐条抄自 data/scripts/biomes/mountain/*.lua 与 temple_*.lua(x, y = 该 chunk 的世界坐标左上)。
// 已用 seed 1674172626 存档 .world_pixel_scenes 核对:mountain 10 张、temple altar_top×5 / altar / altar_right / solid 位置全部一致。
// 返回 [{dir, name, visual?, x, y}](世界坐标)。随机只有圣山顶的 Random(1,50) 选变体。

import { NollaPrng } from './NollaPrng.js'

const M = (name, dx, dy, visual) => ({ dir: 'mountain', name, x: dx, y: dy, visual })
const T = (name, dx, dy, visual) => ({ dir: 'temple', name, x: dx, y: dy, visual })
const P = (name, dx, dy, visual) => ({ dir: 'pyramid', name, x: dx, y: dy, visual })
/**
 * biome_impl 根目录的整图(scenes/general/):o.visual / o.bgName 缺省 = <name>_visual / <name>_background,'' = 明确没有;
 * o.matName = 材质图另有其名(同一张 essenceroom.png 配不同背景时 name 只当缓存键)
 */
const G = (name, dx = 0, dy = 0, o = {}) => ({ dir: 'general', name, x: dx, y: dy, ...o })
const ESSENCE_WD = G('essenceroom_wd', 0, 0, { matName: 'essenceroom', visual: 'essenceroom_visual', bgName: 'essenceroom_background_with_diamond' })
const ESSENCE_D = G('essenceroom_d', 0, 0, { matName: 'essenceroom', visual: 'essenceroom_visual', bgName: 'essenceroom_background_diamond' })

/** temple_altar_top_shared.lua spawn_altar_top */
function altarTop(seed, x, y, isSolid) {
  const prng = new NollaPrng(0)
  prng.SetRandomSeed(seed, x, y)
  const r = prng.Random(1, 50)
  let top = 'altar_top'
  if (y > 12000) top = 'altar_top_boss_arena'
  else if (r === 5) top = 'altar_top_water'
  else if (r === 8) top = 'altar_top_blood'
  else if (r === 11) top = 'altar_top_oil'
  else if (r === 13) top = 'altar_top_radioactive'
  else if (r === 15) top = 'altar_top_lava'
  const out = [T(top, 0, -40, 'altar_top_visual')]
  if (isSolid) out.push(T('solid', 0, 260))
  return out
}

/** 群系名 → (seed, x, y) → 布景列表(相对偏移,调用方加 x,y) */
export const STATIC_SCENE_INIT = {
  mountain_left_stub: () => [M('left_stub', 0, 0), M('left_entrance_below', 512, 0)],
  mountain_left_entrance: () => [M('left_entrance_bottom', 0, 512), M('left_stub_edge', 0, 512), M('left_entrance', 0, 0)],
  mountain_hall: () => [
    M('hall', 0, 0), M('hall_instructions', 0, 0), M('hall_b', 0, 512), M('hall_br', 512, 512), M('hall_r', 512, 0),
    M('hall_bottom', -512, 512), M('hall_bottom_2', 552, 512),
  ],
  mountain_right: () => [M('right_bottom', 512 - 192, 512), M('right', 0, 0)],
  mountain_right_stub: () => [M('right_stub', -38, 0)],
  mountain_top: () => [M('top', 0, 0)],
  mountain_floating_island: () => [M('floating_island', 0, 0)],
  temple_altar: (seed, x, y) => [...altarTop(seed, x, y, false), T('altar', 0, 260)],
  temple_altar_left: (seed, x, y) => [...altarTop(seed, x, y, false), T('altar_left', 0, 260)],
  temple_altar_right: (seed, x, y) => [...altarTop(seed, x, y, false), T('altar_right', 0, 260), T('altar_right_extra', 0, 542)],
  temple_wall: (seed, x, y) => altarTop(seed, x, y, true),
  temple_wall_ending: () => [T('altar_top_ending', 0, -40, 'altar_top_visual'), T('solid', 0, 260)],
  // pyramid_*.lua init(x, y):外壳整图 + 底座(left_bottom @ y+512 / right_bottom @ x+512−61, y+512);left/right 的 *_background 原作是 LoadBackgroundSprite,这里当布景背景层
  pyramid_entrance: () => [P('left_bottom', 0, 512, ''), P('entrance', 0, 0)],
  pyramid_hallway: () => [P('hallway', 0, 0)],
  pyramid_left: () => [P('left_bottom', 0, 512, ''), P('left', 0, 0, '')],
  pyramid_right: () => [P('right_bottom', 512 - 61, 512, ''), P('right', 0, 0, '')],
  pyramid_top: () => [P('right_bottom', 512 - 61, 512, ''), P('left_bottom', 0, 512, ''), P('top', 0, 0)],
  // snowcave.lua init(x, y, w, h):全群系 8 只雕像手,位置 ProceduralRandomi(109, i*53, -2350..2350) / (111, i*2.9, 3140..4500),落在本 chunk 的才放
  snowcave: statueHands,
  snowcave_tunnel: statueHands, // snowcave_tunnel.xml 的 lua_script 也是 snowcave.lua
  // ── 单 chunk 整图房间(各 biome lua 的 init(x, y):LoadPixelScene(材质图, 手绘图, x, y, 背景图)),2026-09-07 全境补齐 ──
  // 宝珠室 ×8:orbroom.png + orbroom_visual + orbroom_background
  ...Object.fromEntries(['02', '04', '05', '06', '07', '08', '09', '10'].map((n) => ['orbroom_' + n, () => [G('orbroom')]])),
  // 精华室:同一张 essenceroom.png,背景分 with_diamond / diamond 两种;essenceroom_alc 用 essenceroom_submerged.png(水淹)
  essenceroom: () => [ESSENCE_WD], essenceroom_hell: () => [ESSENCE_WD], gun_room: () => [ESSENCE_WD], solid_wall_tower_10: () => [ESSENCE_WD],
  essenceroom_alc: () => [G('essenceroom_submerged', 0, 0, { visual: 'essenceroom_visual', bgName: 'essenceroom_background_with_diamond' })],
  essenceroom_air: () => [ESSENCE_D], rock_room: () => [ESSENCE_D], moon_room: () => [ESSENCE_D],
  mystery_teleport: () => [G('mystery_teleport', 0, 0, { visual: '', bgName: 'essenceroom_background' })],
  song_room: () => [G('alchemist_secret_music', 0, 0, { bgName: '' })],
  ocarina: () => [G('ocarina', 0, 0, { visual: '', bgName: '' })],
  alchemist_secret: () => [G('alchemist_secret', 0, 0, { bgName: '' })],
  secret_lab: () => [G('secret_lab')], mestari_secret: () => [G('secret_lab')], ghost_secret: () => [G('secret_lab')],
  meatroom: () => [G('meatroom', 0, 0, { visual: '', bgName: '' })],
  roboroom: () => [G('roboroom', 0, 0, { visual: '', bgName: '' })],
  robot_egg: () => [G('robot_egg')],
  funroom: () => [G('funroom', 0, 0, { visual: '', bgName: '' })],
  null_room: () => [G('null_room', 0, 0, { bgName: '' })],
  teleroom: () => [G('teleroom', 0, 0, { visual: '', bgName: '' })],
  // friend_N.lua:SetRandomSeed(24, 32);Random(1, 6) == N 的那一间是 cavern.png(有标记:友人 / 杀手 / 葫芦 / 树),其余五间 friendroom.png(空屋)
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => ['friend_' + n, (seed) => {
    const prng = new NollaPrng(0); prng.SetRandomSeed(seed, 24, 32)
    return prng.Random(1, 6) === n ? [G('cavern', 0, 0, { visual: '' })] : [G('friendroom', 0, 0, { visual: '', bgName: '' })]
  }])),
  snowcave_secret_chamber: () => [{ dir: 'snowcave', name: 'secret_chamber', x: 0, y: 0, bgName: '' }],
  snowcastle_hourglass_chamber: () => [{ dir: 'snowcastle', name: 'hourglass_chamber', x: 0, y: 0, visual: '' }],
  excavationsite_cube_chamber: () => [{ dir: 'excavationsite', name: 'cube_chamber', x: 0, y: 0 }],
  // snowcastle_cavern.lua:is_right = ProceduralRandom(0,0) > 0.5;|x| > 10000 不放;右边那间 (x−50, y) / 左边那间 (x+50, y)
  snowcastle_cavern: (seed, x) => {
    if (x > 10000 || x < -10000) return []
    const isRight = new NollaPrng(0).ProceduralRandom(seed, 0, 0) > 0.5
    if (isRight && x > 0) return [{ dir: 'snowcastle', name: 'side_cavern_right', x: -50, y: 0 }]
    if (!isRight && x < 0) return [{ dir: 'snowcastle', name: 'side_cavern_left', x: 50, y: 0 }]
    return []
  },
  wizardcave_entrance: () => [G('wizardcave_entrance')],
  bridge: () => [{ dir: 'spliced', name: 'bridge', x: 0, y: 0, visual: '', bgName: '' }],
  // lavalake_pit.lua:y ∈ (2000, 2400) 的那一格用裂开的版本
  lavalake_pit: (seed, x, y) => [G(y > 2000 && y < 2400 ? 'lavalake_pit_cracked' : 'lavalake_pit', 0, 0, { visual: '', bgName: '' })],
  lavalake_racing: () => [G('lavalake_racing', 0, 0, { visual: '' })],
  dragoncave: () => [G('dragoncave')],
  boss_victoryroom: () => [G('boss_victoryroom')],
  // temple_altar_right_snowcastle.lua:spawn_altar_top + altar_right_snowcastle.png @ (x, y−40+300),手绘 / 背景借 altar_right 的
  temple_altar_right_snowcastle: (seed, x, y) => [...altarTop(seed, x, y, false), { dir: 'temple', name: 'altar_right_snowcastle', x: 0, y: 260, visual: 'altar_right_visual', bgName: 'altar_right_background' }],
}

/** snowcave.lua init(x, y, w, h):全群系 8 只雕像手,位置 ProceduralRandomi(109, i*53, -2350..2350) / (111, i*2.9, 3140..4500),落在本 chunk 的才放 */
function statueHands(seed, x, y) {
  const prng = new NollaPrng(0), out = []
  for (let i = 1; i <= 8; i++) {
    const px = prng.ProceduralRandomi(seed, 109, i * 53, -2350, 2350)
    const py = prng.ProceduralRandomi(seed, 111, i * 2.9, 3140, 4500)
    if (px >= x && px <= x + 512 && py >= y && py <= y + 512) out.push({ dir: 'snowcave', name: 'statue_hand', x: px - 22 - x, y: py - 22 - y })
  }
  return out
}

/**
 * 全局固定布景(biome/_pixel_scenes.xml <PixelSceneFiles> → biome_impl/spliced/*.xml,skip_biome_checks=1):
 * 原作把整图用 `_<名>.bat`(wizard_physics -splice_pixel_scene <png> -x -y)切成 .plz 小块,xml 里是小块坐标;
 * 我们直接用整图 + .bat 里的原点。不看群系,只要包围盒碰到 chunk 就盖。
 * 最左边那棵巨树 = tree.png 1024×2048 @ (-2048,-1324)(带 _visual / _background)。
 */
export const SPLICED_SCENES = [
  { name: 'tree', x: -2048, y: -1324, w: 1024, h: 2048 },
  { name: 'watercave', x: -2048, y: 0, w: 512, h: 1139 },
  { name: 'lavalake2', x: 2048, y: 0, w: 2560, h: 2392 },
  { name: 'mountain_lake', x: 2560, y: 0, w: 512, h: 512 },
  { name: 'lavalake_pit_bottom', x: 2560, y: 3072, w: 1536, h: 512 },
  { name: 'skull_in_desert', x: 7100, y: -100, w: 512, h: 350 },
  { name: 'boss_arena', x: 1536, y: 12288, w: 2600, h: 1600 },
  { name: 'skull', x: 14645, y: 18395, w: 512, h: 512 },
  { name: 'lake_statue', x: -14848, y: 0, w: 1536, h: 512 },
  { name: 'gourd_room', x: -16896, y: -7168, w: 1536, h: 1536 },
  { name: 'moon', x: 0, y: -26112, w: 512, h: 512 },
  { name: 'moon_dark', x: 0, y: 37512, w: 512, h: 512 },
  // _pixel_scenes.xml <mBufferedPixelScenes>(skip_biome_checks=1 的整图):圣山胶囊(雪窟 / 雪城堡 / 金库入口那截)、雪城堡熔炉、眼斑、塔起点、金字塔奖励
  { dir: 'temple', name: 'altar_snowcave_capsule', x: 127, y: 3072, w: 128, h: 147, visual: '' },
  { dir: 'temple', name: 'altar_snowcastle_capsule', x: 143, y: 5112, w: 96, h: 147, visual: '' },
  { dir: 'temple', name: 'altar_vault_capsule', x: 143, y: 8704, w: 96, h: 147, visual: '' },
  { dir: 'snowcastle', name: 'forge', x: 1464, y: 5976, w: 128, h: 128 },
  { dir: 'general', name: 'eyespot', x: -3408, y: 1712, w: 160, h: 160 }, { dir: 'general', name: 'eyespot', x: 5852, y: -4944, w: 160, h: 160 }, { dir: 'general', name: 'eyespot', x: 15024, y: 1712, w: 160, h: 160 },
  { dir: 'general', name: 'eyespot', x: -1360, y: 9904, w: 160, h: 160 }, { dir: 'general', name: 'eyespot', x: 12976, y: 9904, w: 160, h: 160 },
  { dir: 'general', name: 'tower_start', x: 9676, y: 9086, w: 128, h: 128, visual: '' },
  // <BackgroundImages>:纯背景贴图(藏在墙后的提示文字条 / 古代实验室顶盖),位置写死,不进材质
  { dir: 'hidden', name: 'holy_mountain_1', x: 1785, y: 1325, w: 195, h: 21, bgSprite: true, z: 40 },
  { dir: 'hidden', name: 'fungal_caverns_1', x: 3419, y: 2652, w: 165, h: 21, bgSprite: true, z: 40 },
  { dir: 'hidden', name: 'jungle_right', x: 2806, y: 6614, w: 245, h: 28, bgSprite: true, z: 40 },
  { dir: 'hidden', name: 'mountain_text', x: 700, y: -440, w: 165, h: 21, bgSprite: true, z: 40 },
  { dir: 'hidden', name: 'under_the_wand_cave', x: -4448, y: 4487, w: 245, h: 28, bgSprite: true, z: 40 },
  { dir: 'hidden', name: 'vault_inside', x: -2120, y: 8446, w: 245, h: 35, bgSprite: true, z: 40 },
  { dir: 'hidden', name: 'crypt_left', x: -4129, y: 10533, w: 325, h: 35, bgSprite: true, z: 40 },
  { dir: 'hidden', name: 'boss_arena', x: 3425, y: 12650, w: 325, h: 105, bgSprite: true, z: 40 },
  { dir: 'liquidcave', name: 'liquidcave_corner', x: -3072, y: -32, w: 512, h: 544, bgSprite: true, z: 40 },
  { dir: 'liquidcave', name: 'liquidcave_top', x: -3584, y: -64, w: 512, h: 64, bgSprite: true, z: 40 },
  { dir: 'liquidcave', name: 'liquidcave_top', x: -4096, y: -64, w: 512, h: 64, bgSprite: true, z: 40 },
  { dir: 'liquidcave', name: 'liquidcave_top', x: -4608, y: -64, w: 512, h: 64, bgSprite: true, z: 40 },
  { dir: 'liquidcave', name: 'liquidcave_corner2', x: -5120, y: -32, w: 512, h: 512, bgSprite: true, z: 40 },
].map((s) => ({ dir: 'spliced', ...s, biome: 'spliced', material: null, colorMaterial: null, func: 'spliced' }))

/** 世界像素包围盒碰到 [x0,y0,x1,y1) 的全局布景 */
export function splicedScenesIn(x0, y0, x1, y1) {
  return SPLICED_SCENES.filter((s) => s.x < x1 && s.x + s.w > x0 && s.y < y1 && s.y + s.h > y0)
}

/**
 * 静态布景图里的标记色 → 近景散件(对应 lua 的 RegisterSpawnFunction;只有该 lua 注册了的色才生效,
 * 例:left_stub.png 里有一粒 spawn_trees 色,但 mountain_left_stub.lua 没注册 → 原版也不长树)。
 *   sprite:PixelSpriteComponent 整图贴上去(anchor = 图内锚点),只是画面,不进材质
 *   vine:  verlet 藤蔓(15 节 × 4px,挂在标记点),g_vines 表里 ~47% 掷空
 * 抄自 data/scripts/biomes/mountain/mountain_left_entrance.lua
 */
export const STATIC_DECOR_MARKS = {
  mountain_left_entrance: {
    0xc4187c: { kind: 'sprite', dir: 'mountain', name: 'left_entrance_grass', ax: 198, ay: 40 }, // spawn_grass → props/mountain_left_entrance_grass.xml
    0xc41860: { kind: 'vine', pool: 'g_vines' },  // spawn_vines
    0x80ff5a: { kind: 'vine', pool: 'g_vines' },  // spawn_vines_b
  },
}
/** g_vines(mountain_left_entrance.lua):prob 权重 → 节数(verlet_vine 15 / long 17 / short 8 / shorter 6);"" = 不生成 */
export const VINE_POOL = [[0.4, 15], [0.3, 17], [1.5, 0], [0.5, 8], [0.5, 6]]

/** init() 里显式挂的藤蔓(load_verlet_rope_with_two_joints / one_joint),相对 chunk 左上;pts = num_points(*_pixelscene.xml) */
export const STATIC_VINES = {
  mountain_hall: [
    { x1: 139, y1: 300, x2: 175, y2: 281, pts: 15 }, { x1: 302, y1: 341, x2: 348, y2: 345, pts: 15 }, { x1: 325, y1: 342, x2: 374, y2: 371, pts: 15 }, { x1: 216, y1: 278, x2: 272, y2: 314, pts: 21 },
    { x1: 243, y1: 285, pts: 6 }, { x1: 281, y1: 325, pts: 6 }, { x1: 356, y1: 354, pts: 6 }, { x1: 184, y1: 276, pts: 4 }, { x1: 286, y1: 331, pts: 4 },
  ],
}

/**
 * @returns {Array<{dir:string,name:string,visual?:string,x:number,y:number,biome:string,material:null}>}
 */
export function staticScenesFor(biome, seed, worldX, worldY) {
  const f = STATIC_SCENE_INIT[biome]
  if (!f) return []
  return f(seed, worldX, worldY).map((s) => ({ ...s, x: worldX + s.x, y: worldY + s.y, biome, material: null, colorMaterial: null, func: 'init' }))
}
