// ── 布景(pixel scene)放置:wang 标记像素 → spawn 函数 → LoadRandomPixelScene ──
// 对应 data/scripts/biomes/<biome>.lua + wang_scripts.csv;随机全部走 ProceduralRandom(x,y)(位置派生,与游戏一致)。
// 颜色表/池来自 telescope spawn_function_config.js / pixel_scene_config.js(它们又是从 lua 抄的,已核对 coalmine.lua)。
// 输出:[{name, biome, x, y(世界坐标,左上), material(f0bbee 替换材质名)|null}]
// v1 覆盖 coalmine / coalmine_alt / excavationsite;其他群系只放通用池(wand_altar / potion_altar)。

import { NollaPrng } from './NollaPrng.js'
import { tileToWorld, CHUNK, WORLD_CENTER_CHUNK_Y } from './coords.js'
import { wangAt } from './wangLayer.js'

// wang_scripts.csv 全局默认色 → 函数名(顺序 = 函数下标,别动)
const DEFAULT_SPAWNS = [
  [0xff0000, 'spawn_small_enemies'], [0x800000, 'spawn_big_enemies'], [0x00ff00, 'spawn_items'],
  [0xc88d1a, 'spawn_props'], [0xc88000, 'spawn_props2'], [0xc80040, 'spawn_props3'], [0xffff00, 'spawn_lamp'],
  [0xff0aff, 'load_pixel_scene'], [0xff0080, 'load_pixel_scene2'], [0xff8000, 'spawn_unique_enemy'],
  [0xc84040, 'spawn_unique_enemy2'], [0x804040, 'spawn_unique_enemy3'], [0x96c850, 'spawn_ghostlamp'],
  [0x60a064, 'spawn_candles'], [0x50a000, 'spawn_potion_altar'], [0xbca0f0, 'spawn_potions'],
  [0x00ff5a, 'spawn_apparition'], [0x78ffff, 'spawn_heart'], [0x50a0f0, 'spawn_wands'], [0xbf26a6, 'spawn_portal'],
  [0x04a977, 'spawn_end_portal'], [0xffd171, 'spawn_orb'], [0xffd181, 'spawn_perk'], [0xffff81, 'spawn_all_perks'],
  [0xc7eb28, 'spawn_wand_trap'], [0xe8ff80, 'spawn_wand_trap_ignite'], [0x2768de, 'spawn_wand_trap_electricity_source'],
  [0x2768df, 'spawn_wand_trap_electricity'], [0x6b4f9b, 'spawn_moon'], [0xd7b3e8, 'spawn_collapse'],
]
const COALMINE_SPAWNS = [
  [0x0000ff, 'spawn_nest'], [0xb40000, 'spawn_fungi'], [0x969678, 'load_structures'], [0x967878, 'load_large_structures'],
  [0x967896, 'load_i_structures'], [0x80ff5a, 'spawn_vines'], [0xc35700, 'load_oiltank'], [0x55af4b, 'load_altar'],
  [0x23b9c3, 'spawn_altar_torch'], [0x55af8c, 'spawn_skulls'], [0x55ff8c, 'spawn_chest'], [0x4e175e, 'load_oiltank_alt'],
  [0x33934c, 'spawn_shopitem'], [0x50fafa, 'spawn_trapwand'], [0xf12ab5, 'spawn_bbqbox'], [0x005cfd, 'spawn_swing_puzzle_box'],
  [0x00b5fc, 'spawn_swing_puzzle_target'], [0x93ca00, 'spawn_oiltank_puzzle'], [0xb97300, 'spawn_receptacle_oil'],
]
const COALMINE_ALT_SPAWNS = [
  [0x0000ff, 'spawn_nest'], [0xb40000, 'spawn_fungi'], [0x969678, 'load_structures'], [0x967878, 'load_large_structures'],
  [0x80ff5a, 'spawn_vines'], [0x33934c, 'spawn_shopitem'],
]
const EXCAVATIONSITE_SPAWNS = [
  [0x0000ff, 'spawn_nest'], [0xff50ff, 'spawn_hanger'], [0x00ac64, 'load_pixel_scene4'], [0x00ac6e, 'load_pixel_scene4_alt'],
  [0x0050ff, 'spawn_wheel'], [0x0150ff, 'spawn_wheel_small'], [0x0250ff, 'spawn_wheel_tiny'], [0x2d2eac, 'spawn_rock'],
  [0x0a50ff, 'spawn_physicsstructure'], [0xc999ff, 'spawn_hanging_prop'], [0x7868ff, 'load_puzzleroom'],
  [0x70d79e, 'load_gunpowderpool_01'], [0x70d79f, 'load_gunpowderpool_02'], [0x70d7a0, 'load_gunpowderpool_03'],
  [0x70d7a1, 'load_gunpowderpool_04'], [0x33934c, 'spawn_shopitem'], [0xb09016, 'spawn_meditation_cube'],
  [0x00855c, 'spawn_receptacle'], [0xb1ff99, 'spawn_tower_short'], [0x5c8550, 'spawn_tower_tall'],
  [0x227fff, 'spawn_beam_low'], [0x8228ff, 'spawn_beam_low_flipped'], [0x0098ba, 'spawn_beam_steep'], [0x7600a9, 'spawn_beam_steep_flipped'],
]
// snowcave.lua RegisterSpawnFunction(0xffffeedd, "init") 是 init 钩子色,不是标记
const SNOWCAVE_SPAWNS = [
  [0x00ac33, 'load_pixel_scene3'], [0x00ac64, 'load_pixel_scene4'], [0x4691c7, 'load_puzzle_capsule'], [0x3691d7, 'load_puzzle_capsule_b'],
  [0x55af4b, 'load_altar'], [0x23b9c3, 'spawn_altar_torch'], [0x55af8c, 'spawn_skulls'], [0xf516e3, 'spawn_scavenger_party'],
  [0xffc84e, 'spawn_acid'], [0x7285c4, 'load_acidtank_right'], [0x9472c4, 'load_acidtank_left'], [0x504600, 'spawn_stones'],
  [0xc800ff, 'load_pixel_scene_alt'], [0x33934c, 'spawn_shopitem'], [0x80ff5a, 'spawn_vines'], [0x434040, 'spawn_burning_barrel'],
  [0xb4a00a, 'spawn_fish'], [0xaa42ff, 'spawn_electricity_trap'], [0x366178, 'spawn_buried_eye_teleporter'], [0x876543, 'spawn_statue_hand'],
  [0x00855c, 'spawn_receptacle'],
]
const SNOWCASTLE_SPAWNS = [
  [0xc8c800, 'spawn_lamp2'], [0x01a1fa, 'spawn_turret'], [0x80ff5a, 'spawn_vines'], [0xc78f20, 'spawn_barricade'], [0xc022f5, 'spawn_forcefield_generator'],
  [0xa3d900, 'spawn_brimstone'], [0x00d982, 'spawn_vasta_or_vihta'], [0x932020, 'spawn_cook'],
  [0x614630, 'load_panel_01'], [0x614635, 'load_panel_02'], [0x61463e, 'load_panel_03'], [0x614638, 'load_panel_04'], [0x614646, 'load_panel_07'], [0x614650, 'load_panel_08'], [0x614658, 'load_panel_09'],
  [0xc133ff, 'load_chamfer_top_r'], [0x8b33ff, 'load_chamfer_top_l'], [0x8824b3, 'load_chamfer_bottom_r'], [0x5f23ad, 'load_chamfer_bottom_l'],
  [0x73ffa7, 'load_chamfer_inner_top_r'], [0xd5ff7f, 'load_chamfer_inner_top_l'], [0x387d51, 'load_chamfer_inner_bottom_r'], [0x97b55b, 'load_chamfer_inner_bottom_l'],
  [0x44609c, 'load_pillar_filler'], [0x44449c, 'load_pillar_filler_tall'], [0xb03058, 'load_pod_large'], [0xb05830, 'load_pod_small_l'], [0xb09030, 'load_pod_small_r'],
  [0xffa659, 'load_furniture'], [0xfec390, 'load_furniture_bunk'], [0x4c63e0, 'spawn_root_grower'], [0x4cacab, 'spawn_forge_check'], [0x2a78ff, 'spawn_drill_laser'],
]
export const BIOME_SPAWN_FUNCS = {
  coalmine: [...DEFAULT_SPAWNS, ...COALMINE_SPAWNS],
  coalmine_alt: [...DEFAULT_SPAWNS, ...COALMINE_ALT_SPAWNS],
  excavationsite: [...DEFAULT_SPAWNS, ...EXCAVATIONSITE_SPAWNS],
  snowcave: [...DEFAULT_SPAWNS, ...SNOWCAVE_SPAWNS],
  snowcastle: [...DEFAULT_SPAWNS, ...SNOWCASTLE_SPAWNS],
  // fungicave.lua:只多三个色(init 色 0xffeedd 是钩子);spawn_lamp / load_pixel_scene* / props2/3 / unique / ghostlamp / candles 全是空函数
  fungicave: [...DEFAULT_SPAWNS, [0x400000, 'spawn_robots'], [0x0000ff, 'spawn_nest'], [0x30b3b0, 'spawn_physics_fungus']],
  rainforest: [...DEFAULT_SPAWNS, [0x400000, 'spawn_scavengers'], [0x400080, 'spawn_large_enemies'], [0xc8c800, 'spawn_lamp2'], [0x00ac64, 'load_pixel_scene4'], [0x80ff5a, 'spawn_vines'], [0x943030, 'spawn_dragonspot'], [0x4c63e0, 'spawn_root_grower'], [0x806326, 'spawn_tree']],
  vault: [...DEFAULT_SPAWNS,
    [0x692e94, 'load_pixel_scene_wide'], [0x822e5b, 'load_pixel_scene_tall'], [0x00ac64, 'load_warning_strip'], [0x01a1fa, 'spawn_turret'], [0x80ff5a, 'spawn_vines'],
    [0x504b64, 'spawn_machines'], [0xc999ff, 'spawn_hanging_prop'],
    [0xbe8246, 'spawn_pipes_hor'], [0xbe8264, 'spawn_pipes_turn_right'], [0xbe8282, 'spawn_pipes_turn_left'], [0xbe82a0, 'spawn_pipes_ver'], [0xbe82be, 'spawn_pipes_cross'],
    [0x2e8246, 'spawn_pipes_big_hor'], [0x2e8264, 'spawn_pipes_big_turn_right'], [0x2e8282, 'spawn_pipes_big_turn_left'], [0x2e82a0, 'spawn_pipes_big_ver'],
    [0x5c73da, 'spawn_stains'], [0x5c73db, 'spawn_stains_ceiling'], [0xc78f20, 'spawn_barricade'], [0x4a107d, 'load_pillar'], [0x7b59ab, 'load_pillar_base'], [0x40ffce, 'load_catwalk'],
    [0xbf4c86, 'spawn_apparatus'], [0xaa42ff, 'spawn_electricity_trap'], [0x33934c, 'spawn_shopitem'], [0xacf14b, 'spawn_laser_trap'], [0xa45aff, 'spawn_lab_puzzle'],
  ],
  // liquidcave.lua(古代实验室,煤矿左边 x −4608..−3072):只多四个色;spawn_items / props3 / pixel_scene2 / unique / ghostlamp / candles 全是空函数(spawn_bottle 没注册色,死表)
  liquidcave: [...DEFAULT_SPAWNS, [0x00ac64, 'load_background_panel_big'], [0x967878, 'spawn_lasergun'], [0x80ff5a, 'spawn_vines'], [0xc88dab, 'spawn_statues']],
  // wandcave.lua(魔法神殿,最左边 x −15872..−12800 / y 1024..12800):4 个新色;props2/3 / pixel_scene* / unique / ghostlamp / candles / potions / wands 空函数
  wandcave: [...DEFAULT_SPAWNS, [0x805000, 'spawn_cloud_trap'], [0x397780, 'load_floor_rubble'], [0x00ffa0, 'load_floor_rubble_l'], [0x1ca7ff, 'load_floor_rubble_r']],
  // pyramid.lua(金字塔内部 x 8704..11264 / y −1024..512,外壳 pyramid_* 是整图):色表基本同 crypt;spawn_items / chest / save / stash / crawlers 空;init 空
  pyramid: [...DEFAULT_SPAWNS,
    [0x808000, 'spawn_statues'], [0x00ac64, 'load_pixel_scene4'], [0xc8c800, 'spawn_lamp2'], [0x400080, 'spawn_large_enemies'], [0xc8001a, 'spawn_ghost_crystal'], [0x82ff5a, 'spawn_crawlers'],
    [0x647d7d, 'spawn_pressureplates'], [0x649b7d, 'spawn_doors'], [0xa07864, 'spawn_scavengers'], [0x00ac33, 'load_pixel_scene3'], [0xffcd2a, 'spawn_scorpions'], [0x905ecb, 'spawn_reward_wands'], [0x905ecc, 'spawn_boss_limbs_trigger'],
  ],
  // sandcave.lua(沙洞,金字塔下方 x 8192..15872 / y 512..8192):只多两个色;拾荒者营地风格(布景池借 snowcastle 的 shaft / bridge / cargobay / bar / bedroom)
  sandcave: [...DEFAULT_SPAWNS, [0xc8c800, 'spawn_lamp2'], [0xdc0060, 'spawn_props4']],
  // meat.lua(肉界 x 6144..15872 / y 5632..16384):头骨 / 肉囊 / 肉藤 / 墙上的嘴和眼 / 吊笼;pixel_scene* / shopitem / fish 空函数;spawn_items:<0.3 祭坛(x−15) / <0.55 utility_box(没做)
  meat: [...DEFAULT_SPAWNS, [0x55af8c, 'spawn_skulls'], [0x4c63e1, 'spawn_cyst'], [0x80ff5a, 'spawn_vines'], [0xd97f7f, 'spawn_mouth'], [0xc999ff, 'spawn_hanging_prop']],
  // robobase.lua(发电站,最底层 y 7680..17408):金库式(管灯 / 警示条 / 炮塔 / 吊挂 / 路障);g_pixel_scene_01/02 在 lua 里根本没定义 → 空;lasergate_ver(激光门)没做
  robobase: [...DEFAULT_SPAWNS, [0x00ac64, 'load_warning_strip'], [0x01a1fa, 'spawn_turret'], [0x80ff5a, 'spawn_vines'], [0xc999ff, 'spawn_hanging_prop'], [0xc78f20, 'spawn_barricade'], [0x33934c, 'spawn_shopitem'], [0x39a760, 'spawn_lasergate_ver']],
  // the_end.lua(地狱 x −5120..4096 / y 14848..17408):默认色为主;shopitem / specialshop 只在 y∈(−3000,1000) 的天空段出、spawn_moon 只在 y≤0,这里都不到;pixel_scene_02 是空池
  the_end: [...DEFAULT_SPAWNS, [0x33934c, 'spawn_shopitem'], [0xbe704d, 'spawn_specialshop']], // spawn_large_enemies 定义了但没注册色
  // wizardcave.lua(巫师洞,散段 x −6144..−4608 / y 5632..6656 等):色表同 crypt,但 load_pixel_scene* / beam / cavein / statues / background_scene 在 lua 里全是空函数,
  // 只剩 load_small_background_scene 的三张帷幔(drape)背景贴图;敌人全是各路巫师
  wizardcave: [...DEFAULT_SPAWNS,
    [0x808000, 'spawn_statues'], [0x00ac33, 'load_pixel_scene3'], [0x00ac64, 'load_pixel_scene4'], [0x97ab00, 'load_pixel_scene5'], [0xc9d959, 'load_pixel_scene5b'], [0xc8c800, 'spawn_lamp2'],
    [0x400080, 'spawn_large_enemies'], [0xc8001a, 'spawn_ghost_crystal'], [0x82ff5a, 'spawn_crawlers'], [0x647d7d, 'spawn_pressureplates'], [0x649b7d, 'spawn_doors'], [0xa07864, 'spawn_scavengers'],
    [0xffcd2a, 'spawn_scorpions'], [0x2d1e5a, 'spawn_bones'], [0x782060, 'load_beam'], [0x783060, 'load_background_scene'], [0x378ec4, 'load_small_background_scene'], [0x786460, 'load_cavein'],
    [0x80ff5a, 'spawn_vines'], [0x535988, 'spawn_statue_back'], [0x33934c, 'spawn_shopitem'],
  ],
  crypt: [...DEFAULT_SPAWNS,
    [0x808000, 'spawn_statues'], [0x00ac33, 'load_pixel_scene3'], [0x00ac64, 'load_pixel_scene4'], [0x97ab00, 'load_pixel_scene5'], [0xc9d959, 'load_pixel_scene5b'], [0xc8c800, 'spawn_lamp2'],
    [0x400080, 'spawn_large_enemies'], [0xc8001a, 'spawn_ghost_crystal'], [0x82ff5a, 'spawn_crawlers'], [0x647d7d, 'spawn_pressureplates'], [0x649b7d, 'spawn_doors'], [0xa07864, 'spawn_scavengers'],
    [0xffcd2a, 'spawn_scorpions'], [0x2d1e5a, 'spawn_bones'], [0x782060, 'load_beam'], [0x783060, 'load_background_scene'], [0x378ec4, 'load_small_background_scene'], [0x786460, 'load_cavein'],
    [0x80ff5a, 'spawn_vines'], [0x535988, 'spawn_statue_back'], [0x33934c, 'spawn_shopitem'],
  ],
}
/** 该群系 lua 里定义成空函数的默认色(fungicave):标记照旧算标记色,但什么都不出 */
const EMPTY_FUNCS = {
  fungicave: new Set(['spawn_lamp', 'load_pixel_scene', 'load_pixel_scene2', 'spawn_props2', 'spawn_props3', 'spawn_unique_enemy', 'spawn_unique_enemy2', 'spawn_unique_enemy3', 'spawn_ghostlamp', 'spawn_candles']),
  crypt: new Set(['spawn_crawlers', 'spawn_doors']), // 门:原版注释掉了(关节没做)
  liquidcave: new Set(['spawn_items', 'spawn_props3', 'load_pixel_scene2', 'spawn_unique_enemy', 'spawn_unique_enemy2', 'spawn_unique_enemy3', 'spawn_ghostlamp', 'spawn_candles']),
  wandcave: new Set(['spawn_props2', 'spawn_props3', 'load_pixel_scene', 'load_pixel_scene2', 'spawn_unique_enemy', 'spawn_unique_enemy2', 'spawn_unique_enemy3', 'spawn_ghostlamp', 'spawn_candles', 'spawn_potions', 'spawn_wands']),
  pyramid: new Set(['spawn_items', 'spawn_crawlers', 'spawn_ghost_crystal', 'spawn_doors', 'spawn_boss_limbs_trigger']),
  meat: new Set(['load_pixel_scene', 'load_pixel_scene2', 'spawn_props2', 'spawn_props3', 'spawn_unique_enemy3']),
  robobase: new Set(['load_pixel_scene', 'load_pixel_scene2', 'spawn_props2', 'spawn_props3', 'spawn_unique_enemy', 'spawn_unique_enemy2', 'spawn_unique_enemy3', 'spawn_shopitem']),
  wizardcave: new Set(['spawn_statues', 'spawn_statue_back', 'load_pixel_scene', 'load_pixel_scene2', 'load_pixel_scene3', 'load_pixel_scene4', 'load_pixel_scene5', 'load_pixel_scene5b', 'load_beam', 'load_cavein', 'load_background_scene', 'spawn_crawlers', 'spawn_doors', 'spawn_shopitem', 'spawn_props2', 'spawn_props3', 'spawn_unique_enemy2', 'spawn_unique_enemy3']),
  the_end: new Set(['load_pixel_scene2', 'spawn_props', 'spawn_props2', 'spawn_props3', 'spawn_unique_enemy2', 'spawn_unique_enemy3', 'spawn_apparition', 'spawn_potions', 'spawn_heart', 'spawn_moon', 'spawn_wands', 'spawn_potion_altar', 'spawn_shopitem', 'spawn_specialshop']), // g_ghost_crystal 全空;门是关节;boss_limbs 触发器(Kolmisilmän koipi 战)没做
}
// 色 → 函数名(每群系一张 Map,查得快)
const FUNC_BY_COLOR = Object.fromEntries(Object.entries(BIOME_SPAWN_FUNCS).map(([b, l]) => [b, new Map(l.filter(([, f]) => !EMPTY_FUNCS[b]?.has(f)).map(([c, f]) => [c, f]))]))
export function spawnFuncOf(biome, color) { return FUNC_BY_COLOR[biome]?.get(color) || null }
/** 任一群系认识的标记色(用来判断"这个像素不是材质而是标记") */
export const ALL_MARK_COLORS = new Set(Object.values(BIOME_SPAWN_FUNCS).flat().map(([c]) => c))

// ── 布景池(lua g_* 表) ──
const OIL_A = ['water', 'oil', 'water', 'oil', 'alcohol', 'sand', 'coal', 'radioactive_liquid']
const COALMINE_SCENES = {
  g_pixel_scene_01: ['coalpit01', 'coalpit02', 'carthill', 'coalpit03', 'coalpit04', 'coalpit05'].map((n) => ({ prob: 0.5, name: n })),
  g_pixel_scene_02: [
    ...['shrine01', 'shrine02', 'slimepit', 'laboratory', 'swarm', 'symbolroom', 'physics_01', 'physics_02', 'physics_03'].map((n) => ({ prob: 0.5, name: n })),
    { prob: 1.5, name: 'shop' }, { prob: 0.5, name: 'radioactivecave' }, { prob: 0.75, name: 'wandtrap_h_02' },
    { prob: 0.75, name: 'wandtrap_h_04', cm: { f0bbee: ['oil', 'alcohol', 'gunpowder_explosive'] } },
    { prob: 0.75, name: 'wandtrap_h_06', cm: { f0bbee: ['magic_liquid_teleportation', 'magic_liquid_polymorph', 'magic_liquid_random_polymorph', 'radioactive_liquid'] } },
    { prob: 0.75, name: 'wandtrap_h_07', cm: { f0bbee: ['water', 'oil', 'alcohol', 'radioactive_liquid'] } },
    { prob: 0.5, name: 'physics_swing_puzzle' }, { prob: 0.5, name: 'receptacle_oil' },
  ],
  g_oiltank: [
    { prob: 1.0, name: 'oiltank_1', cm: { f0bbee: OIL_A } },
    { prob: 0.0004, name: 'oiltank_1', cm: { f0bbee: ['magic_liquid_teleportation', 'magic_liquid_polymorph', 'magic_liquid_random_polymorph', 'magic_liquid_berserk', 'magic_liquid_charm', 'magic_liquid_invisibility', 'magic_liquid_hp_regeneration', 'salt', 'blood', 'gold', 'honey'] } },
    { prob: 0.01, name: 'oiltank_2', cm: { f0bbee: ['blood_fungi', 'blood_cold', 'lava', 'poison', 'slime', 'gunpowder_explosive', 'soil', 'salt', 'blood', 'cement'] } },
    { prob: 1.0, name: 'oiltank_2', cm: { f0bbee: ['water', 'oil', 'water', 'oil', 'alcohol', 'oil', 'coal', 'radioactive_liquid'] } },
    { prob: 1.0, name: 'oiltank_3', cm: { f0bbee: ['water', 'oil', 'water', 'oil', 'alcohol', 'water', 'coal', 'radioactive_liquid', 'magic_liquid_teleportation'] } },
    { prob: 1.0, name: 'oiltank_4', cm: { f0bbee: ['water', 'oil', 'water', 'oil', 'alcohol', 'sand', 'coal', 'radioactive_liquid', 'magic_liquid_polymorph'] } },
    { prob: 1.0, name: 'oiltank_5', cm: { f0bbee: ['water', 'oil', 'water', 'oil', 'alcohol', 'radioactive_liquid', 'coal', 'radioactive_liquid'] } },
    { prob: 0.05, name: 'oiltank_puzzle' },
  ],
  g_oiltank_alt: [{ prob: 1.0, name: 'oiltank_alt', cm: { f0bbee: ['water', 'oil', 'water', 'oil', 'alcohol', 'sand', 'radioactive_liquid', 'radioactive_liquid', 'magic_liquid_berserk'] } }],
}
const COALMINE_ALT_SCENES = {
  g_pixel_scene_01: COALMINE_SCENES.g_pixel_scene_01,
  g_pixel_scene_02: [
    { prob: 0.5, name: 'shrine01_alt' }, { prob: 0.5, name: 'shrine02_alt' }, { prob: 0.5, name: 'swarm_alt' },
    { prob: 1.2, name: 'symbolroom_alt' }, { prob: 1.2, name: 'physics_01_alt' }, { prob: 1.2, name: 'physics_02_alt' },
    { prob: 1.2, name: 'physics_03_alt' }, { prob: 0.75, name: 'shop_alt' }, { prob: 0.5, name: 'radioactivecave' },
  ],
}
// visual / bg:手绘层 / 背景层文件名与材质图不同名时显式给(machine_7 借 machine_5 的;_alt 变体借原版的)
// bg:true 的条目是 LoadBackgroundSprite(只画在背景层、不进材质),z 越大越靠后
const EXCAVATIONSITE_SCENES = {
  g_pixel_scene_04: [
    ...['machine_1', 'machine_2', 'machine_3b', 'machine_4', 'machine_5', 'machine_6'].map((n) => ({ prob: 0.5, name: n })),
    { prob: 0.3, name: 'machine_7', visual: 'machine_5_visual', bgName: 'machine_5_background' }, { prob: 3.0, name: 'shop' }, { prob: 0.8, name: 'oiltank_1' }, { prob: 0.8, name: 'lake' },
  ],
  g_pixel_scene_04_alt: [
    ...['machine_1', 'machine_2', 'machine_3b', 'machine_4', 'machine_5', 'machine_6'].map((n) => ({ prob: 0.5, name: n + '_alt', visual: n + '_visual', bgName: n + '_background' })),
    { prob: 0.3, name: 'machine_7_alt', visual: 'machine_5_visual', bgName: 'machine_5_background' }, { prob: 3.0, name: 'shop_alt', visual: 'shop_visual' }, { prob: 0.7, name: 'receptacle_steam' }, { prob: 0.8, name: 'lake_alt' },
  ],
  g_puzzleroom: ['puzzleroom_01', 'puzzleroom_02', 'puzzleroom_03'].map((n) => ({ prob: 1.5, name: n })),
  g_gunpowderpool_01: [{ prob: 1.5, name: 'gunpowderpool_01' }],
  g_gunpowderpool_02: [{ prob: 1.5, name: 'gunpowderpool_02' }],
  g_gunpowderpool_03: [{ prob: 1.5, name: 'gunpowderpool_03' }],
  g_gunpowderpool_04: [{ prob: 1.5, name: 'gunpowderpool_04' }],
  // 背景贴图池(load_random_background_sprite)
  g_mechanism_background: ['mechanism_background', 'mechanism_background2', 'mechanism_background3'].map((n) => ({ prob: 1.0, name: n, bg: true, z: 50 })),
  g_tower_mids: [{ prob: 1.0, name: 'tower_mid_1', bg: true, z: 40 }, { prob: 1.0, name: 'tower_mid_2', bg: true, z: 40 }, { prob: 0.5, name: 'tower_mid_3', bg: true, z: 40 }, { prob: 0.5, name: 'tower_mid_4', bg: true, z: 40 }],
  g_tower_tops: [{ prob: 1.0, name: 'tower_top_1', bg: true, z: 20 }, { prob: 1.0, name: 'tower_top_2', bg: true, z: 20 }, { prob: 1.0, name: 'tower_top_3', bg: true, z: 20 }, { prob: 2.0, name: 'tower_top_4', bg: true, z: 20 }, { prob: 1.0, name: 'tower_top_5', bg: true, z: 20 }],
}
const SNOWCAVE_SCENES = {
  g_pixel_scene_01: [
    { prob: 0.5, name: 'verticalobservatory' }, { prob: 0.5, name: 'verticalobservatory2' }, { prob: 0.5, name: 'icebridge2' }, { prob: 0.5, name: 'pipe' }, { prob: 0.25, name: 'receptacle_water' },
  ],
  g_pixel_scene_01_alt: [
    { prob: 0.5, name: 'verticalobservatory_alt', visual: 'verticalobservatory_visual', bgName: 'verticalobservatory_background' },
    { prob: 0.5, name: 'verticalobservatory2_alt', visual: 'verticalobservatory2_visual', bgName: 'verticalobservatory2_background' },
    { prob: 0.5, name: 'icebridge2_alt' }, { prob: 0.5, name: 'pipe_alt', visual: 'pipe_visual' },
  ],
  g_pixel_scene_02: [
    { prob: 0.4, name: 'crater' }, { prob: 0.5, name: 'horizontalobservatory' }, { prob: 0.5, name: 'horizontalobservatory2' }, { prob: 0.3, name: 'horizontalobservatory3' },
    { prob: 0.4, name: 'icebridge' }, { prob: 0.4, name: 'snowcastle' }, { prob: 0, name: 'symbolroom' }, { prob: 0.5, name: 'icepillar' }, { prob: 1.5, name: 'shop' }, { prob: 0.5, name: 'camp' },
  ],
  g_pixel_scene_03: [{ prob: 0.9, name: '' }, { prob: 0.5, name: 'tinyobservatory' }, { prob: 0.5, name: 'tinyobservatory2' }, { prob: 0.2, name: 'buried_eye' }],
  g_acidtank_right: [{ prob: 1.7, name: '' }, { prob: 0.2, name: 'acidtank_2', dir: 'general' }],
  g_acidtank_left: [{ prob: 1.7, name: '' }, { prob: 0.2, name: 'acidtank', dir: 'general' }],
  g_pixel_scene_04: [{ prob: 0.5, name: '' }, { prob: 0.5, name: 'icicles' }, { prob: 0.5, name: 'icicles2' }, { prob: 0.5, name: 'icicles3' }, { prob: 0.5, name: 'icicles4' }],
  g_puzzle_capsule: [{ prob: 9.0, name: '' }, { prob: 1.0, name: 'puzzle_capsule' }],
  g_puzzle_capsule_b: [{ prob: 9.0, name: '' }, { prob: 1.0, name: 'puzzle_capsule_b' }],
}
// 雪城堡:load_paneling 是同一张材质图 paneling_wall 配不同背景图 paneling_XX(matName 指材质图,name 只是缓存键)
const PANEL = (id) => ({ name: 'paneling_' + id, matName: 'paneling_wall', bgName: 'paneling_' + id, visual: '' })
const SNOWCASTLE_SCENES = {
  g_pixel_scene_01: [{ prob: 0.5, name: 'shaft' }, { prob: 0.5, name: 'bridge' }, { prob: 0.5, name: 'drill' }, { prob: 0.5, name: 'greenhouse' }],
  g_pixel_scene_02: [
    { prob: 0.4, name: 'cargobay' }, { prob: 0.8, name: 'bar' }, { prob: 0.8, name: 'bedroom' }, { prob: 0.4, name: 'acidpool' }, { prob: 0.4, name: 'polymorphroom' },
    { prob: 0.2, name: 'teleroom' }, { prob: 0.3, name: 'sauna' }, { prob: 0.3, name: 'kitchen' },
  ],
  g_pods_large: [{ prob: 1.0, name: 'pod_large_blank_01' }, { prob: 1.0, name: 'pod_large_01' }, { prob: 1.0, name: 'pod_large_01_b', matName: 'pod_large_01', bgName: 'pod_large_01_background_b' }, { prob: 1.0, name: 'pod_large_01_c', matName: 'pod_large_01', bgName: 'pod_large_01_background_c' }],
  g_pods_small_l: [{ prob: 1.0, name: 'pod_small_l_blank_01' }, { prob: 1.0, name: 'pod_small_l_01' }, { prob: 1.0, name: 'pod_small_l_01_b', matName: 'pod_small_l_01', bgName: 'pod_small_l_01_background_b' }],
  g_pods_small_r: [{ prob: 1.0, name: 'pod_small_r_blank_01' }, { prob: 1.0, name: 'pod_small_r_01' }, { prob: 1.0, name: 'pod_small_r_01_b', matName: 'pod_small_r_01', bgName: 'pod_small_r_01_background_b' }],
  g_panels: ['01', '02', '03', '04', '07', '08', '09'].map((id) => ({ prob: 1, ...PANEL(id) })),
}
const RAINFOREST_SCENES = {
  g_pixel_scene_01: [{ prob: 0.5, name: 'pit01' }, { prob: 0.5, name: 'pit02' }, { prob: 0.5, name: 'pit03' }, { prob: 0.8, name: 'oiltank_01' }],
  g_pixel_scene_02: [{ prob: 0.5, name: 'hut01' }, { prob: 0.5, name: 'hut02' }, { prob: 0.4, name: 'base' }, { prob: 0.5, name: 'hut03' }, { prob: 1.2, name: 'symbolroom' }],
  // 12 种植物墙:同一张材质图 plantlife 配不同背景
  g_pixel_scene_04: Array.from({ length: 12 }, (_, i) => ({ prob: 0.5, name: i === 0 ? 'plantlife' : `plantlife${i + 1}`, matName: 'plantlife', bgName: i === 0 ? 'plantlife_background' : `plantlife${i + 1}_background`, visual: '' })),
}
const LAB_LIQUIDS = ['radioactive_liquid', 'radioactive_liquid', 'acid', 'acid', 'acid', 'alcohol']
const VAULT_SCENES = {
  g_pixel_scene_01: [{ prob: 0.5, name: 'acidtank' }],
  g_pixel_scene_02: [
    { prob: 0.5, name: 'lab', cm: { f0bbee: LAB_LIQUIDS, a4dbd5: LAB_LIQUIDS } }, { prob: 0.5, name: 'lab2', cm: { f0bbee: LAB_LIQUIDS, a4dbd5: LAB_LIQUIDS } }, { prob: 0.5, name: 'lab3', cm: { f0bbee: LAB_LIQUIDS, a4dbd5: LAB_LIQUIDS } },
    { prob: 1.2, name: 'symbolroom' }, { prob: 0.3, name: 'lab_puzzle' },
  ],
  g_pixel_scene_wide: [{ prob: 0.5, name: 'brain_room' }, { prob: 0.5, name: 'shop' }],
  g_pixel_scene_tall: [{ prob: 0.5, name: 'electric_tunnel_room' }],
  g_pipes_hor: [{ prob: 0.5, name: 'pipe_hor_1' }, { prob: 0.5, name: 'pipe_hor_2' }, { prob: 0.05, name: 'pipe_hor_3' }],
  g_pipes_ver: [{ prob: 0.5, name: 'pipe_ver_1' }, { prob: 0.5, name: 'pipe_ver_2' }, { prob: 0.05, name: 'pipe_ver_3' }, { prob: 0.1, name: 'pipe_ver_4' }],
  g_pipes_turn_right: [{ prob: 0.5, name: 'pipe_turn_right' }], g_pipes_turn_left: [{ prob: 0.5, name: 'pipe_turn_left' }], g_pipes_cross: [{ prob: 0.5, name: 'pipe_cross' }],
  g_pipes_big_hor: [{ prob: 0.5, name: 'pipe_big_hor_1' }, { prob: 0.5, name: 'pipe_big_hor_2' }], g_pipes_big_ver: [{ prob: 0.5, name: 'pipe_big_ver_1' }, { prob: 0.5, name: 'pipe_big_ver_2' }],
  g_pipes_big_turn_right: [{ prob: 0.5, name: 'pipe_big_turn_right' }], g_pipes_big_turn_left: [{ prob: 0.5, name: 'pipe_big_turn_left' }],
  // 污渍:同一张材质图 stain 配不同手绘层
  g_stains: [{ prob: 0.5, name: '' }, { prob: 0.5, name: 'stain_01', matName: 'stain', visual: 'stain_01_visual' }, { prob: 0.5, name: 'stain_02', matName: 'stain', visual: 'stain_02_visual' }, { prob: 0.5, name: 'stain_03', matName: 'stain', visual: 'stain_03_visual' }],
  g_stains_ceiling: [{ prob: 0.5, name: '' }, { prob: 0.5, name: 'stain_ceiling_01', matName: 'stain_ceiling', visual: 'stain_ceiling_01_visual' }, { prob: 0.5, name: 'stain_ceiling_02', matName: 'stain_ceiling', visual: 'stain_ceiling_02_visual' }],
  g_catwalks: [{ prob: 1.0, name: 'catwalk_01' }, { prob: 0.1, name: 'catwalk_02' }, { prob: 0.1, name: 'catwalk_02b' }, { prob: 0.1, name: 'catwalk_03' }, { prob: 0.1, name: 'catwalk_04' }],
  g_pillars: [{ prob: 1.0, name: 'pillar_01_background', bg: true, z: 40 }, { prob: 0.2, name: 'pillar_02_background', bg: true, z: 40 }, { prob: 0.2, name: 'pillar_03_background', bg: true, z: 40 }, { prob: 0.3, name: 'pillar_04_background', bg: true, z: 40 }, { prob: 0.2, name: 'pillar_05_background', bg: true, z: 40 }],
  g_pillar_bases: [{ prob: 1.0, name: 'pillar_base_01_background', bg: true, z: 40 }, { prob: 1.0, name: 'pillar_base_02_background', bg: true, z: 40 }],
}
const CRYPT_SCENES = {
  g_pixel_scene_01: [{ prob: 1, name: 'cathedral' }, { prob: 1, name: 'mining' }, { prob: 1, name: 'polymorphroom' }],
  g_pixel_scene_02: [{ prob: 0.5, name: 'stairs_right' }],
  g_pixel_scene_03: [{ prob: 1, name: 'lavaroom' }, { prob: 1, name: 'pit' }, { prob: 1, name: 'symbolroom' }, { prob: 1, name: 'water_lava' }],
  g_pixel_scene_04: [{ prob: 0.5, name: 'stairs_left' }],
  g_pixel_scene_05: [{ prob: 1, name: 'room_liquid_funnel' }, { prob: 1, name: 'room_gate_drop' }, { prob: 1, name: 'shop' }],
  g_pixel_scene_05b: [{ prob: 1, name: 'room_liquid_funnel_b', visual: 'room_liquid_funnel_visual' }, { prob: 1, name: 'room_gate_drop_b', visual: 'room_gate_drop_visual' }, { prob: 1, name: 'shop_b', visual: 'shop_visual' }],
  g_beam: [{ prob: 5, name: '' }, ...Array.from({ length: 8 }, (_, i) => ({ prob: 1, name: `beam_0${i + 1}` }))],
  g_caveins: [{ prob: 5, name: '' }, { prob: 1, name: 'cavein_01' }, { prob: 1, name: 'cavein_02' }, { prob: 1, name: 'cavein_03' }, { prob: 1, name: 'cavein_04' }],
  g_background_scenes: [{ prob: 3, name: '' }, ...['pillars_01', 'pillars_02', 'pillars_03', 'alcove_01'].map((n) => ({ prob: 1, name: n + '_background', bg: true, z: 40 })), { prob: 2, name: 'alcove_02_background', bg: true, z: 40 }, { prob: 2, name: 'alcove_03_background', bg: true, z: 40 }, ...['alcove_04', 'alcove_05', 'alcove_06'].map((n) => ({ prob: 1, name: n + '_background', bg: true, z: 40 }))],
  g_small_background_scenes: [{ prob: 4, name: '' }, { prob: 1, name: 'slab_01_background', bg: true, z: 40 }, { prob: 0.5, name: 'slab_02_background', bg: true, z: 40 }, { prob: 0.5, name: 'slab_03_background', bg: true, z: 40 }, ...['slab_04', 'slab_05', 'slab_06', 'slab_07'].map((n) => ({ prob: 1, name: n + '_background', bg: true, z: 40 }))],
}
// liquidcave.lua:container_01(f0bbee 掷 8 种液体);背景板 = 同一张材质图 background_panel_big_material 配 8 张背景(第一行 0.2 只有材质图没背景)
const LIQUIDCAVE_SCENES = {
  g_pixel_scene_01: [{ prob: 0.5, name: 'container_01', cm: { f0bbee: ['oil', 'alcohol', 'lava', 'magic_liquid_teleportation', 'magic_liquid_protection_all', 'material_confusion', 'liquid_fire', 'magic_liquid_weakness'] } }],
  g_background_panel_big: [
    { prob: 0.2, name: 'background_panel_big_material', visual: '', bgName: '' },
    ...Array.from({ length: 8 }, (_, i) => ({ prob: 0.5, name: `background_panel_big_0${i + 1}`, matName: 'background_panel_big_material', bgName: `background_panel_big_0${i + 1}`, visual: '' })),
  ],
}
// wandcave.lua:地面碎石三池(通用 / 靠左 / 靠右),大半掷空
const RUB = (n, p) => ({ prob: p, name: n })
const WANDCAVE_SCENES = {
  g_floor_rubble: [{ prob: 15, name: '' }, RUB('floor_rubble_dynamic_01', 1), RUB('floor_rubble_dynamic_02', 1), RUB('floor_rubble_small_01', 0.5), RUB('floor_rubble_small_02', 0.5), RUB('floor_rubble_small_03', 0.5), RUB('floor_rubble_l_01', 0.05), RUB('floor_rubble_l_02', 0.05), RUB('floor_rubble_r_01', 0.05), RUB('floor_rubble_r_02', 0.05)],
  g_floor_rubble_l: [{ prob: 2, name: '' }, RUB('floor_rubble_l_01', 1), RUB('floor_rubble_l_02', 1), RUB('floor_rubble_small_01', 1), RUB('floor_rubble_small_02', 1), RUB('floor_rubble_small_03', 1), RUB('floor_rubble_dynamic_01', 0.5), RUB('floor_rubble_dynamic_02', 0.5)],
  g_floor_rubble_r: [{ prob: 2, name: '' }, RUB('floor_rubble_r_01', 1), RUB('floor_rubble_r_02', 1), RUB('floor_rubble_small_01', 1), RUB('floor_rubble_small_02', 1), RUB('floor_rubble_small_03', 1), RUB('floor_rubble_dynamic_01', 0.5), RUB('floor_rubble_dynamic_02', 0.5)],
}
// pyramid.lua:布景池全借 biome_impl/crypt 的图(dir: 'crypt')
const PY = (name, prob = 1) => ({ prob, name, dir: 'crypt' })
const PYRAMID_SCENES = {
  g_pixel_scene_01: [PY('cathedral'), PY('mining')],
  g_pixel_scene_02: [PY('stairs_right', 0.5)],
  g_pixel_scene_03: [PY('lavaroom'), PY('pit'), PY('symbolroom')],
  g_pixel_scene_04: [PY('stairs_left', 0.5)],
}
// sandcave.lua:布景全借 biome_impl/snowcastle 的图
const SC = (name, prob, extra = {}) => ({ prob, name, dir: 'snowcastle', ...extra })
const SANDCAVE_SCENES = {
  g_pixel_scene_01: [SC('shaft', 0.6), SC('bridge', 0.4, { visual: '' })],
  g_pixel_scene_02: [SC('cargobay', 0.4, { visual: '' }), SC('bar', 0.4, { visual: '' }), SC('bedroom', 0.4, { visual: '' })],
}
const THE_END_SCENES = { g_pixel_scene_01: [PY('cathedral'), PY('mining')] } // the_end.lua 也借 crypt 的图
const WIZARDCAVE_SCENES = { g_background_scenes: [{ prob: 4, name: '' }, { prob: 1, name: 'drape_1', bg: true, z: 40 }, { prob: 0.66, name: 'drape_2', bg: true, z: 40 }, { prob: 0.33, name: 'drape_3', bg: true, z: 40 }] }
export const BIOME_SCENES = { coalmine: COALMINE_SCENES, coalmine_alt: COALMINE_ALT_SCENES, excavationsite: EXCAVATIONSITE_SCENES, snowcave: SNOWCAVE_SCENES, snowcastle: SNOWCASTLE_SCENES, rainforest: RAINFOREST_SCENES, vault: VAULT_SCENES, crypt: CRYPT_SCENES, liquidcave: LIQUIDCAVE_SCENES, wandcave: WANDCAVE_SCENES, pyramid: PYRAMID_SCENES, sandcave: SANDCAVE_SCENES, the_end: THE_END_SCENES, wizardcave: WIZARDCAVE_SCENES }
/**
 * PixelSpriteComponent 的 props(煤矿木架 / 丛林树 / 金库机器):一张图钉在世界里,anchor 像素对齐实体位置。
 * 原作里是可打可烧的像素(create_box2d_bodies),人能穿过;这里先当背景贴图放(World._buildChunk 把这些生成点换成 bgSprite 布景),不进材质。
 */
export const PIXEL_SPRITES = {
  coalmine_structure_01: { img: 'coalmine_structure_background_01', ax: 5, ay: 49 }, coalmine_structure_02: { img: 'coalmine_structure_background_02', ax: 5, ay: 49 },
  coalmine_large_structure_01: { img: 'coalmine_large_structure_background_01', ax: 5, ay: 49 }, coalmine_large_structure_02: { img: 'coalmine_large_structure_background_02', ax: 5, ay: 49 },
  coalmine_i_structure_01: { img: 'coalmine_i_structure_background_01', ax: 5, ay: 49 }, coalmine_i_structure_02: { img: 'coalmine_i_structure_background_02', ax: 5, ay: 49 },
  rainforest_tree_01: { img: 'swamp_cropped_01', ax: 15, ay: 118 }, rainforest_tree_02: { img: 'swamp_cropped_02', ax: 9, ay: 35 }, rainforest_tree_03: { img: 'swamp_cropped_03', ax: 12, ay: 37 },
  rainforest_tree_04: { img: 'swamp_cropped_04', ax: 36, ay: 98 }, rainforest_tree_05: { img: 'swamp_cropped_05', ax: 29, ay: 89 }, rainforest_tree_06: { img: 'swamp_cropped_06', ax: 8, ay: 89 },
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`vault_machine_${i}`, { img: `vault_machine_${i}`, ax: 10, ay: 29 }])),
  statue: { img: 'statue', ax: 8, ay: 38 }, // pyramid g_statues:props/statue 只有 Sprite(statue.xml offset 8,38)+ SimplePhysics,当背景贴图
  sarcophagus: { img: 'sarcophagus', ax: 7, ay: 28 }, sarcophagus_evil: { img: 'sarcophagus_evil', ax: 7, ay: 28 }, statue_back: { img: 'statue_back', ax: 8, ay: 39 },
}
/** 实体自带的 PixelSceneComponent(神殿陷阱的石框 trap_frame_left/right):是真材质布景,跟着生成点盖进 chunk.mat(offset 照各 xml) */
export const SCENE_PROPS = {
  arrowtrap_left: { dir: 'crypt', name: 'trap_frame_left', ox: -5, oy: -10 }, firetrap_left: { dir: 'crypt', name: 'trap_frame_left', ox: -4, oy: -10 },
  thundertrap_left: { dir: 'crypt', name: 'trap_frame_left', ox: -5, oy: -10 }, spittrap_left: { dir: 'crypt', name: 'trap_frame_left', ox: -4, oy: -10 },
  ...Object.fromEntries(['arrowtrap', 'firetrap', 'thundertrap', 'spittrap'].map((t) => [t + '_right', { dir: 'crypt', name: 'trap_frame_right', ox: -15, oy: -10 }])),
}
/** 不走池、spawn 函数里直接 LoadPixelScene / LoadBackgroundSprite 的图(预载用) */
export const BIOME_FIXED_SCENES = {
  excavationsite: ['tower_bottom_1', 'beam_low', 'beam_low_flipped', 'beam_steep', 'beam_steep_flipped', 'meditation_cube'],
  snowcave: ['statue_hand'],
  snowcastle: ['chamfer_top_r', 'chamfer_top_l', 'chamfer_bottom_r', 'chamfer_bottom_l', 'chamfer_inner_top_r', 'chamfer_inner_top_l', 'chamfer_inner_bottom_r', 'chamfer_inner_bottom_l', 'pillar_filler_01', 'pillar_filler_tall_01'],
  vault: ['hole', 'warningstrip_background'],
  crypt: ['trap_frame_left', 'trap_frame_right'],
}

/** 布景 PNG 所在目录(coalmine_alt 与 coalmine 共用;通用祭坛 / 酸罐 / 雪人在 general) */
export function sceneDir(biome, name) {
  if (/^(wand_altar|potion_altar|altar|snowperson|acidtank|acidtank_2|wand_altar_vault|potion_altar_vault)$/.test(name)) return 'general'
  if (biome === 'coalmine_alt') return 'coalmine'
  return biome
}

/**
 * lua load_random_pixel_scene:总权重 → ProceduralRandom(x,y) → 顺序扣减;
 * color_material 用 ProceduralRandom(x+11, y-21) 再掷一次。
 */
function loadRandomPixelScene(ctx, biome, list, x, y) {
  if (!list || !list.length) return null
  const prng = new NollaPrng(0)
  let total = 0
  for (const s of list) total += s.prob
  let r = prng.ProceduralRandom(ctx.seed + ctx.ng, x, y) * total
  for (const s of list) {
    if (s.prob <= 0) continue
    if (r <= s.prob) {
      if (!s.name) return null
      const out = { name: s.name, biome, dir: s.dir || sceneDir(biome, s.name), x, y, material: null, colorMaterial: null }
      if (s.visual !== undefined) out.visual = s.visual
      if (s.bgName) out.bgName = s.bgName
      if (s.matName) out.matName = s.matName
      if (s.bg) { out.bgSprite = true; out.z = s.z ?? 40 }
      if (s.cm) {
        for (const color of Object.keys(s.cm).sort((a, b) => parseInt(a, 16) - parseInt(b, 16))) {
          const mats = s.cm[color]
          const rr = prng.ProceduralRandom(ctx.seed + ctx.ng, x + 11, y - 21)
          const mi = Math.ceil(rr * mats.length) - 1
          out.material = mats[mi]
          out.colorMaterial = { ...(out.colorMaterial || {}), [parseInt(color, 16)]: mats[mi] }
        }
      }
      return out
    }
    r -= s.prob
  }
  return null
}

/** snowcave.lua safe():入口竖井附近不生成(x 125~249, y 3070~3187) */
const snowcaveSafe = (x, y) => !(x >= 125 && x <= 249 && y >= 3070 && y <= 3187)
/** snowcastle.lua safe():入口 (x 125~249, y 5118~5259) 与传送门附近(y > 6100)不生成 */
const snowcastleSafe = (x, y) => !(x >= 125 && x <= 249 && y >= 5118 && y <= 5259) && y <= 6100
/** vault.lua safe():入口 (x 125~249, y 8694~8860) */
const vaultSafe = (x, y) => !(x >= 125 && x <= 249 && y >= 8694 && y <= 8860)

/** 每个 spawn 函数对布景的处理(只做"放不放布景、放哪张、放哪儿",实体不管);可返回单个或数组 */
function spawnScene(ctx, biome, func, x, y) {
  const prng = new NollaPrng(0)
  prng.SetRandomSeed(ctx.seed + ctx.ng, x, y)
  const scenes = BIOME_SCENES[biome] || {}
  if (biome === 'coalmine') {
    if (func === 'load_pixel_scene') {
      return loadRandomPixelScene(ctx, biome, prng.Random(1, 100) > 50 ? scenes.g_oiltank : scenes.g_pixel_scene_01, x, y)
    }
    if (func === 'load_oiltank') {
      return loadRandomPixelScene(ctx, biome, prng.Random(1, 100) <= 50 ? scenes.g_oiltank : scenes.g_pixel_scene_01, x, y)
    }
    if (func === 'load_oiltank_alt') return loadRandomPixelScene(ctx, biome, scenes.g_oiltank_alt, x, y)
    if (func === 'load_altar') return { name: 'altar', biome, dir: 'general', x: x - 92, y: y - 96, material: null }
    if (func === 'spawn_items') {
      // coalmine.lua 特化版:r<0.47 空;第二掷 >=0.755 才放法杖祭坛,位置 (x-10+5, y-17+5)
      const p2 = new NollaPrng(0)
      if (p2.ProceduralRandom(ctx.seed + ctx.ng, x, y) < 0.47) return null
      if (p2.ProceduralRandom(ctx.seed + ctx.ng, x - 11.431, y + 10.5257) < 0.755) return null
      return { name: 'wand_altar', biome, dir: 'general', x: x - 5, y: y - 12, material: null }
    }
  }
  const ws = ctx.seed + ctx.ng
  const bgSprite = (name, sx, sy, z) => ({ name, biome, dir: biome, x: sx, y: sy, material: null, colorMaterial: null, bgSprite: true, z })
  if (biome === 'excavationsite') {
    if (func === 'load_gunpowderpool_03') return loadRandomPixelScene(ctx, biome, scenes.g_gunpowderpool_03, x - 3, y + 3)
    if (func === 'load_pixel_scene') return null // 原版注释掉了 g_cranes
    if (func === 'load_pixel_scene2') return loadRandomPixelScene(ctx, biome, scenes.g_mechanism_background, x, y)
    if (func === 'spawn_items') {
      // excavationsite.lua:第一掷不再用(注释掉了 r<0.47);第二掷 <0.725 空,否则法杖祭坛 (x-10, y-17)
      const p2 = new NollaPrng(0)
      if (p2.ProceduralRandom(ws, x - 11.431, y + 10.5257) < 0.725) return null
      return { name: 'wand_altar', biome, dir: 'general', x: x - 10, y: y - 17, material: null }
    }
    if (func === 'spawn_meditation_cube') {
      // SetRandomSeed(x,y); Random(1,100) > 96 才有(冥想立方间,传送实体先不做)
      if (prng.Random(1, 100) <= 96) return null
      return { name: 'meditation_cube', biome, dir: biome, x: x - 20, y: y - 29, material: null }
    }
    if (func === 'spawn_tower_short' || func === 'spawn_tower_tall') {
      // generate_tower(x, y, height):PR(x,y)>0.5 不建;底座 (x,y+15);中段每 60px 一节(y>1600 才叠);顶 (x-50, y)
      const p2 = new NollaPrng(0)
      const height = func === 'spawn_tower_short' ? p2.ProceduralRandomi(ws, x - 4, y + 3, 0, 2) : p2.ProceduralRandomi(ws, x + 7, y - 1, 2, 3)
      if (p2.ProceduralRandom(ws, x, y) > 0.5) return null
      let ty = y + 15
      const out = [bgSprite('tower_bottom_1', x, ty, 40)]
      ty -= 60
      for (let i = 1; i <= height; i++) {
        if (ty > 1600) { const m = loadRandomPixelScene(ctx, biome, scenes.g_tower_mids, x, ty); if (m) out.push(m); ty -= 60 }
      }
      const top = loadRandomPixelScene(ctx, biome, scenes.g_tower_tops, x - 50, ty)
      if (top) out.push(top)
      return out
    }
    if (func === 'spawn_beam_low') return bgSprite('beam_low', x - 60, y - 35, 60)
    if (func === 'spawn_beam_low_flipped') return bgSprite('beam_low_flipped', x - 60, y - 35, 60)
    if (func === 'spawn_beam_steep') return bgSprite('beam_steep', x - 35, y - 60, 60)
    if (func === 'spawn_beam_steep_flipped') return bgSprite('beam_steep_flipped', x - 35, y - 60, 60)
  }
  if (biome === 'snowcave') {
    if (func === 'spawn_items') {
      // snowcave.lua:PR(x-11.631, y+10.2257) < 0.45 才放法杖祭坛 (x-15, y-17)
      const p2 = new NollaPrng(0)
      if (p2.ProceduralRandom(ws, x - 11.631, y + 10.2257) >= 0.45) return null
      return { name: 'wand_altar', biome, dir: 'general', x: x - 15, y: y - 17, material: null }
    }
    if (func === 'spawn_props') {
      // safe() 外:PR(x-11.231, y+10.2157) ≥ 0.9 → 雪人布景 (x-12, y-38),否则走 g_props(collectSpawns 那边)
      if (!snowcaveSafe(x, y)) return null
      const p2 = new NollaPrng(0)
      if (p2.ProceduralRandom(ws, x - 11.231, y + 10.2157) < 0.9) return null
      return { name: 'snowperson', biome, dir: 'general', x: x - 12, y: y - 38, material: null }
    }
    if (func === 'load_altar') return { name: 'altar', biome, dir: 'general', x: x - 92, y: y - 96, material: null }
    if (func === 'load_pixel_scene_alt') return loadRandomPixelScene(ctx, biome, scenes.g_pixel_scene_01_alt, x, y)
    if (func === 'load_pixel_scene3') return loadRandomPixelScene(ctx, biome, scenes.g_pixel_scene_03, x, y)
    if (func === 'load_puzzle_capsule') return loadRandomPixelScene(ctx, biome, scenes.g_puzzle_capsule, x, y)
    if (func === 'load_puzzle_capsule_b') return loadRandomPixelScene(ctx, biome, scenes.g_puzzle_capsule_b, x - 50, y - 230)
    if (func === 'load_acidtank_right') return snowcaveSafe(x, y) ? loadRandomPixelScene(ctx, biome, scenes.g_acidtank_right, x - 12, y - 12) : null
    if (func === 'load_acidtank_left') return snowcaveSafe(x, y) ? loadRandomPixelScene(ctx, biome, scenes.g_acidtank_left, x - 252, y - 12) : null
  }
  if (biome === 'snowcastle') {
    const fixed = (name, sx, sy) => ({ name, biome, dir: biome, x: sx, y: sy, material: null, colorMaterial: null, visual: '' })
    if (func === 'spawn_items') {
      // snowcastle.lua:PR(x-11.631, y+10.2257) > 0.2 → 金库式法杖祭坛 (x-5, y-9)
      const p2 = new NollaPrng(0)
      if (p2.ProceduralRandom(ws, x - 11.631, y + 10.2257) <= 0.2) return null
      return { name: 'wand_altar_vault', biome, dir: 'general', x: x - 5, y: y - 9, material: null }
    }
    if (func === 'spawn_potion_altar') {
      const p2 = new NollaPrng(0)
      if (p2.ProceduralRandom(ws, x, y) <= 0.65) return null
      return { name: 'potion_altar_vault', biome, dir: 'general', x: x - 3, y: y - 9, material: null }
    }
    if (func === 'load_pixel_scene') return snowcastleSafe(x, y) ? loadRandomPixelScene(ctx, biome, scenes.g_pixel_scene_01, x, y) : null
    if (func === 'load_pixel_scene2') return snowcastleSafe(x, y) ? loadRandomPixelScene(ctx, biome, scenes.g_pixel_scene_02, x, y) : null
    // load_paneling:材质图 paneling_wall + 背景 paneling_XX,各自的偏移
    const panel = { load_panel_01: ['01', -15, -30], load_panel_02: ['02', -10, -20], load_panel_03: ['03', -60, -20], load_panel_04: ['04', -20, -20], load_panel_07: ['07', -40, -40], load_panel_08: ['08', -40, -20], load_panel_09: ['09', -20, -20] }[func]
    if (panel) return { ...PANEL(panel[0]), biome, dir: biome, x: x + panel[1], y: y + panel[2], material: null, colorMaterial: null }
    const chamfer = { load_chamfer_top_r: ['chamfer_top_r', -10, 0], load_chamfer_top_l: ['chamfer_top_l', -1, 0], load_chamfer_bottom_r: ['chamfer_bottom_r', -10, -20], load_chamfer_bottom_l: ['chamfer_bottom_l', -1, -20], load_chamfer_inner_top_r: ['chamfer_inner_top_r', -10, 0], load_chamfer_inner_top_l: ['chamfer_inner_top_l', 0, 0], load_chamfer_inner_bottom_r: ['chamfer_inner_bottom_r', -10, -20], load_chamfer_inner_bottom_l: ['chamfer_inner_bottom_l', 0, -20], load_pillar_filler: ['pillar_filler_01', 0, 0], load_pillar_filler_tall: ['pillar_filler_tall_01', 0, 0] }[func]
    if (chamfer) return snowcastleSafe(x, y) ? fixed(chamfer[0], x + chamfer[1], y + chamfer[2]) : null
    if (func === 'load_pod_large') return snowcastleSafe(x, y - 50) ? loadRandomPixelScene(ctx, biome, scenes.g_pods_large, x, y - 50) : null
    if (func === 'load_pod_small_l') return snowcastleSafe(x, y - 40) ? loadRandomPixelScene(ctx, biome, scenes.g_pods_small_l, x - 30, y - 40) : null
    if (func === 'load_pod_small_r') return snowcastleSafe(x, y - 40) ? loadRandomPixelScene(ctx, biome, scenes.g_pods_small_r, x - 10, y - 40) : null
  }
  if (biome === 'fungicave') {
    if (func === 'spawn_items') {
      const p2 = new NollaPrng(0)
      if (p2.ProceduralRandom(ws, x - 11.631, y + 10.2257) <= 0.06) return null
      return { name: 'wand_altar', biome, dir: 'general', x: x - 10, y: y - 17, material: null }
    }
    if (func === 'spawn_potion_altar') return { name: 'potion_altar', biome, dir: 'general', x: x - 10, y: y - 17, material: null }
  }
  if (biome === 'rainforest' && func === 'spawn_items') {
    const p2 = new NollaPrng(0)
    if (p2.ProceduralRandom(ws, x - 11.631, y + 10.2257) <= 0.27) return null
    return { name: 'wand_altar', biome, dir: 'general', x: x - 10, y: y - 17, material: null }
  }
  if (biome === 'vault') {
    if (func === 'spawn_items') {
      const p2 = new NollaPrng(0)
      if (p2.ProceduralRandom(ws, x - 11.631, y + 10.2257) >= 0.93) return null
      return { name: 'wand_altar_vault', biome, dir: 'general', x: x - 5, y: y - 10, material: null }
    }
    if (func === 'spawn_potion_altar') {
      const p2 = new NollaPrng(0)
      if (p2.ProceduralRandom(ws, x, y) <= 0.65) return null
      return { name: 'potion_altar_vault', biome, dir: 'general', x: x - 3, y: y - 10, material: null }
    }
    if (func === 'load_pixel_scene_wide') return loadRandomPixelScene(ctx, biome, scenes.g_pixel_scene_wide, x, y)
    if (func === 'load_pixel_scene_tall') return loadRandomPixelScene(ctx, biome, scenes.g_pixel_scene_tall, x, y)
    if (func === 'load_warning_strip') return bgSprite('warningstrip_background', x, y - 4, 40)
    if (func === 'spawn_stains') return loadRandomPixelScene(ctx, biome, scenes.g_stains, x - 10, y)
    if (func === 'spawn_stains_ceiling') return loadRandomPixelScene(ctx, biome, scenes.g_stains_ceiling, x - 20, y - 10)
    if (func === 'spawn_laser_trap') return { name: 'hole', biome, dir: biome, x, y, material: null, colorMaterial: null, visual: '' } // 1/3 概率的激光陷阱实体先不做
    const pipe = /^spawn_(pipes_\w+)$/.exec(func)
    if (pipe && scenes['g_' + pipe[1]]) return loadRandomPixelScene(ctx, biome, scenes['g_' + pipe[1]], x, y)
    if (func === 'load_catwalk') return loadRandomPixelScene(ctx, biome, scenes.g_catwalks, x, prng.Random(y, y + 1) - 20) // SetRandomSeed(x,y) 已在开头做
    if (func === 'load_pillar') return loadRandomPixelScene(ctx, biome, scenes.g_pillars, x, y + 3)
    if (func === 'load_pillar_base') return loadRandomPixelScene(ctx, biome, scenes.g_pillar_bases, x, y + 3)
  }
  if (biome === 'crypt') {
    if (func === 'spawn_items') {
      const p2 = new NollaPrng(0)
      if (p2.ProceduralRandom(ws, x - 11.631, y + 10.2257) <= 0.38) return null
      return { name: 'wand_altar', biome, dir: 'general', x: x - 10, y: y - 17, material: null }
    }
    if (func === 'load_pixel_scene2') return loadRandomPixelScene(ctx, biome, scenes.g_pixel_scene_02, x + 6, y)
    if (func === 'load_pixel_scene3') return loadRandomPixelScene(ctx, biome, scenes.g_pixel_scene_03, x, y)
    if (func === 'load_pixel_scene5') return loadRandomPixelScene(ctx, biome, scenes.g_pixel_scene_05, x, y)
    if (func === 'load_pixel_scene5b') return loadRandomPixelScene(ctx, biome, scenes.g_pixel_scene_05b, x, y)
    if (func === 'load_beam') return loadRandomPixelScene(ctx, biome, scenes.g_beam, x, y - 65)
    if (func === 'load_cavein') return loadRandomPixelScene(ctx, biome, scenes.g_caveins, x - 60, y - 10)
    if (func === 'load_background_scene') return loadRandomPixelScene(ctx, biome, scenes.g_background_scenes, x + 5, y)
    if (func === 'load_small_background_scene') return loadRandomPixelScene(ctx, biome, scenes.g_small_background_scenes, x, y)
    // load_pixel_scene4 在 lua 里定义了两次,后一个(不带 -5)生效 → 走通用映射
  }
  if (biome === 'robobase') {
    if (func === 'spawn_items') {
      const p2 = new NollaPrng(0)
      if (p2.ProceduralRandom(ws, x - 11.631, y + 10.2257) >= 0.93) return null
      return { name: 'wand_altar_vault', biome, dir: 'general', x: x - 5, y: y - 10, material: null }
    }
    if (func === 'spawn_potion_altar') {
      const p2 = new NollaPrng(0)
      if (p2.ProceduralRandom(ws, x, y) <= 0.65) return null
      return { name: 'potion_altar_vault', biome, dir: 'general', x: x - 3, y: y - 10, material: null }
    }
    if (func === 'load_warning_strip') return { ...bgSprite('warningstrip_background', x, y - 4, 40), dir: 'vault' }
  }
  if (biome === 'wizardcave') {
    if (func === 'spawn_items') {
      const p2 = new NollaPrng(0)
      if (p2.ProceduralRandom(ws, x - 11.631, y + 10.2257) <= 0.38) return null
      return { name: 'wand_altar', biome, dir: 'general', x: x - 10, y: y - 17, material: null }
    }
    if (func === 'load_small_background_scene') return loadRandomPixelScene(ctx, biome, scenes.g_background_scenes, x, y)
  }
  if (biome === 'the_end' && func === 'spawn_items') {
    const p2 = new NollaPrng(0)
    if (p2.ProceduralRandom(ws, x - 11.631, y + 10.2257) <= 0.38) return null
    return { name: 'wand_altar', biome, dir: 'general', x: x - 10, y: y - 17, material: null }
  }
  if (biome === 'meat' && func === 'spawn_items') {
    const p2 = new NollaPrng(0)
    if (p2.ProceduralRandom(ws, x - 11.631, y + 10.2257) >= 0.3) return null // 0.3~0.55 是 utility_box(没做)
    return { name: 'wand_altar', biome, dir: 'general', x: x - 15, y: y - 17, material: null }
  }
  if (biome === 'sandcave' && func === 'spawn_items') {
    const p2 = new NollaPrng(0)
    if (p2.ProceduralRandom(ws, x - 11.631, y + 10.2257) >= 0.94) return null
    return { name: 'wand_altar', biome, dir: 'general', x: x - 10, y: y - 17, material: null }
  }
  if (biome === 'pyramid') {
    if (func === 'load_pixel_scene2') return loadRandomPixelScene(ctx, biome, scenes.g_pixel_scene_02, x + 6, y)
    if (func === 'load_pixel_scene3') return loadRandomPixelScene(ctx, biome, scenes.g_pixel_scene_03, x, y)
    if (func === 'load_pixel_scene4') return loadRandomPixelScene(ctx, biome, scenes.g_pixel_scene_04, x - 5, y)
  }
  if (biome === 'wandcave') {
    if (func === 'spawn_items') {
      // wandcave.lua spawn_items:PR(x,y) < 0.47 空;PR(x−11.431, y+10.5257) ≥ 0.725 → wand_altar (x−10, y−17)
      const p2 = new NollaPrng(0)
      if (p2.ProceduralRandom(ws, x, y) < 0.47) return null
      if (p2.ProceduralRandom(ws, x - 11.431, y + 10.5257) < 0.725) return null
      return { name: 'wand_altar', biome, dir: 'general', x: x - 10, y: y - 17, material: null }
    }
    if (func === 'load_floor_rubble') return loadRandomPixelScene(ctx, biome, scenes.g_floor_rubble, x - 10, y - 15)
    if (func === 'load_floor_rubble_l') return loadRandomPixelScene(ctx, biome, scenes.g_floor_rubble_l, x - 10, y - 15)
    if (func === 'load_floor_rubble_r') return loadRandomPixelScene(ctx, biome, scenes.g_floor_rubble_r, x - 18, y - 17)
  }
  if (biome === 'liquidcave') {
    if (func === 'load_pixel_scene') return loadRandomPixelScene(ctx, biome, scenes.g_pixel_scene_01, x - 5, y - 3)
    if (func === 'load_background_panel_big') return loadRandomPixelScene(ctx, biome, scenes.g_background_panel_big, x, y)
  }
  // 通用映射 load_xxx → g_xxx
  const generic = {
    load_pixel_scene: 'g_pixel_scene_01', load_pixel_scene2: 'g_pixel_scene_02', load_pixel_scene4: 'g_pixel_scene_04',
    load_pixel_scene4_alt: 'g_pixel_scene_04_alt', load_puzzleroom: 'g_puzzleroom',
    load_gunpowderpool_01: 'g_gunpowderpool_01', load_gunpowderpool_02: 'g_gunpowderpool_02', load_gunpowderpool_04: 'g_gunpowderpool_04',
  }
  if (generic[func] && scenes[generic[func]]) return loadRandomPixelScene(ctx, biome, scenes[generic[func]], x, y)
  if (func === 'spawn_potion_altar') {
    const p2 = new NollaPrng(0)
    if (p2.ProceduralRandom(ctx.seed + ctx.ng, x, y) < 0.65) return null
    return { name: 'potion_altar', biome, dir: 'general', x: x - 5, y: y - 15, material: null }
  }
  return null
}

/**
 * 光源标记:spawn_lamp(g_lamp:0.4 空 / 0.7 小灯笼)、spawn_candles(蜡烛必出)、spawn_altar_torch / spawn_ghostlamp。
 * 只做"这里有没有光、什么光",实体本身不管。返回 [{x,y,kind}](世界坐标)。
 */
// spawn_lamp:spawn(g_lamp, x+dx, y+dy, 0, 0);g_lamp = [空 prob, 灯 prob] → PR·Σ ≤ 空 就没灯。coalmine/excavationsite/snowcave 0.4/0.7 小灯笼,snowcastle 1/1 管灯
// lampMax:灯那一行的累计上限(rainforest g_lamp 第三行是地雷 0.1,不算灯)
// ent:kind=lantern 的灯是真道具(g_lamp 里的实体:coalmine/excavationsite = props/physics/lantern_small.xml,snowcave/sandcave/meat = physics_lantern_small.xml,liquidcave = physics_lantern.xml),
//     主线程按标记点放成刚体(能打、掉、碎、漏油、起火),光和火苗由道具自己出;没有 ent 的(圣山 temple_lantern / 蜡烛 / 火把)还是只画光
const LAMP = {
  coalmine: { dx: 0, dy: 0, empty: 0.4, total: 1.1, kind: 'lantern', ent: 'lantern_small' }, coalmine_alt: { dx: 0, dy: 0, empty: 0.3, total: 1.0, kind: 'lantern', lampFirst: true, ent: 'lantern_small' },
  excavationsite: { dx: 0, dy: 2, empty: 0.4, total: 1.1, kind: 'lantern', ent: 'lantern_small' }, snowcave: { dx: 5, dy: 10, empty: 0.4, total: 1.1, kind: 'lantern', safe: snowcaveSafe, ent: 'physics_lantern_small' },
  snowcastle: { dx: 5, dy: 0, empty: 1, total: 2, kind: 'tubelamp', safe: snowcastleSafe },
  rainforest: { dx: 0, dy: -10, empty: 0.3, total: 1.0, lampMax: 0.9, kind: 'torchstand', lamp2: { dx: -8, dy: -4, empty: 0, total: 1, kind: 'tubelamp' } },
  vault: { dx: 0, dy: 0, empty: 0.4, total: 1.72, lampMax: 1.4, kind: 'tubelamp', safe: vaultSafe }, // 剩下 0.32 是滴水/滴油/滴放射液(dripping_*,先不做)
  crypt: { dx: 4, dy: -8, empty: 0.3, total: 1.3, lampMax: 0.9, kind: 'torchstand', lamp2: { dx: -1, dy: 0, empty: 0.2, total: 1.2, kind: 'torch' } }, // g_lamp 剩下 0.3 是三种头骨道具
  liquidcave: { dx: 0, dy: 4, empty: 0.5, total: 2.0, kind: 'lantern', ent: 'physics_lantern' }, // spawn(g_lamp, x, y+4):[空 0.5, physics_lantern 1.5 ×1~2]
  wandcave: { dx: 0, dy: 0, empty: 0, total: 1, kind: 'torch' }, // g_lamp = chain_torch_ghostly 必出(幽绿火把)
  pyramid: { dx: 4, dy: -8, empty: 0.3, total: 1.3, lampMax: 1.0, kind: 'torchstand', lamp2: { dx: 0, dy: 0, empty: 0, total: 1, kind: 'torch' } }, // 蓝火炬座 0.7(剩 0.3 头骨);lamp2 = chain_torch_blue 必出
  sandcave: { dx: 5, dy: 10, empty: 0.4, total: 1.1, kind: 'lantern', ent: 'physics_lantern_small', lamp2: { dx: 0, dy: 0, empty: 0, total: 1, kind: 'tubelamp' } },
  meat: { dx: 5, dy: 10, empty: 0.4, total: 1.1, kind: 'lantern', ent: 'physics_lantern_small' },
  robobase: { dx: 0, dy: 0, empty: 0.4, total: 1.72, lampMax: 1.4, kind: 'tubelamp' }, // 同 vault:剩下 0.32 是滴水 / 滴油 / 滴放射液
  the_end: { dx: 4, dy: 0, empty: 0.3, total: 0.9, kind: 'torchstand' },
  wizardcave: { dx: 4, dy: -8, empty: 0.3, total: 1.2, lampMax: 0.9, kind: 'torchstand', lamp2: { dx: -1, dy: 0, empty: 0.2, total: 1.2, kind: 'torch' } },
}
export function collectLights(layer, ctx) {
  const out = []
  const funcs = FUNC_BY_COLOR[layer.biome]
  if (!funcs) return out
  const prng = new NollaPrng(0)
  const lamp = LAMP[layer.biome] || LAMP.coalmine
  for (let ty = 0; ty < layer.mapH; ty++) {
    for (let tx = 0; tx < layer.mapW; tx++) {
      const c = wangAt(layer, tx, ty)
      if (c === 0 || c === 0xffffff) continue
      const func = funcs.get(c)
      if (!func) continue
      const { x, y } = tileToWorld(layer.minChunkX, layer.minChunkY, tx, ty)
      if (func === 'spawn_lamp' || func === 'spawn_lamp2') {
        if (lamp.safe && !lamp.safe(x, y)) continue
        // spawn_lamp2:rainforest 有自己的 g_lamp2 表;snowcastle 是同一张表不带偏移
        const L = func === 'spawn_lamp2' ? (lamp.lamp2 || { ...lamp, dx: 0, dy: 0 }) : lamp
        const r = prng.ProceduralRandom(ctx.seed + ctx.ng, x + L.dx, y + L.dy) * L.total
        // coalmine_alt 的表是 [灯 0.7, 空 0.3](灯在前)
        const hit = L.lampFirst ? r <= L.total - L.empty : r > L.empty && r <= (L.lampMax ?? L.total)
        if (hit) out.push({ x: x + L.dx, y: y + L.dy, kind: L.kind, ent: L.ent || null })
      } else if (func === 'spawn_candles') out.push({ x, y, kind: 'candle' })
      else if (func === 'spawn_altar_torch') out.push({ x, y, kind: 'torch' })
      else if (func === 'spawn_ghostlamp') out.push({ x, y, kind: 'ghost' })
    }
  }
  return out
}

// ── 实体生成表(lua g_*:[prob, min_count, max_count, entity, offset_x, offset_y, extra?];entity 空 = 掷空)──
// 由 scripts/_dump-spawn-tables.mjs 从各 biome lua 抽出,原样照抄(--[[ ]] 注释掉的行已剔除)。
//   extra.g    = entities 组(entity_load_camera_bound 的 load groups 分支:字符串 = 1 只;{e,min,max} = 掷数量)
//   extra.ng   = ngpluslevel(NG+ 等级不够时整行不存在,连 total_prob 也不算)
//   extra.xmas = spawn_check 圣诞限定(12/24~26),平时同样不存在
// 实体键:文件名;animals 下的子目录(rainforest/ lukki/)是另一套强化版,键带目录前缀(rainforest_scavenger_smg),和 noita-prepare-entities 一致
const entKey = (p) => { if (p === 'projectiles/mine') return 'mine_scavenger'; const m = /^animals\/(\w+)\/(\w+)$/.exec(p); return m ? m[1] + '_' + m[2] : p.split('/').pop() } // 表里直接放的地雷 = 落地后的 mine_scavenger
const T = (rows) => rows.map(([prob, min, max, entity, ox, oy, extra]) => ({
  prob, min, max, entity: entity ? entKey(entity) : '', ox, oy,
  ng: extra?.ng || 0, xmas: !!extra?.xmas,
  group: extra?.g ? extra.g.map((e) => (typeof e === 'string' ? { e: entKey(e), single: true } : { e: entKey(e.e), min: e.min, max: e.max, ox: e.ox || 0, oy: e.oy || 0 })) : null,
}))
const WANDS_L1 = (n) => Array.from({ length: n }, (_, i) => [1, 1, 1, `items/wands/level_01/wand_${String(i + 1).padStart(3, '0')}`, 0, 0])
const SPAWN_TABLES = {
  coalmine: {
    g_small_enemies: T([[0.1, 0, 0, '', 0, 0], [0.5, 1, 2, 'animals/zombie_weak', 0, 0], [0.1, 1, 1, 'animals/slimeshooter_weak', 0, 0], [0.2, 1, 3, 'animals/longleg', 0, 0], [0.25, 1, 2, 'animals/miner_weak', 0, 0], [0.1, 1, 1, 'animals/shotgunner_weak', 0, 0]]),
    g_big_enemies: T([[0.7, 0, 0, '', 0, 0], [0.2, 1, 1, 'animals/firemage_weak', 0, 0], [0.01, 1, 1, 'animals/worm', 0, 0], [0.2, 5, 10, 'animals/longleg', 0, 0], [0.1, 1, 1, '', 0, 0, { g: ['animals/miner_weak', 'animals/miner_weak', 'animals/shotgunner_weak'] }], [0.3, 1, 2, 'animals/miner_santa', 0, 0, { xmas: 1 }], [0.2, 1, 1, 'animals/shotgunner_weak', 0, 0], [0.1, 1, 1, 'animals/acidshooter_weak', 0, 0], [0.08, 1, 1, 'animals/giantshooter_weak', 0, 0], [0.09, 1, 1, 'animals/fireskull', 0, 0], [0.3, 1, 2, 'animals/miner_santa', 0, 0, { xmas: 1 }], [0.02, 1, 1, 'animals/shaman', 0, 0], [0.1, 1, 1, 'animals/drone_shield', 0, 0, { ng: 2 }]]),
    g_unique_enemy: T([[0, 0, 0, '', 0, 0], [0.5, 1, 3, 'animals/slimeshooter_weak', 0, 0], [0.3, 1, 2, 'animals/acidshooter_weak', 0, 0], [0.1, 1, 1, 'animals/giantshooter_weak', 0, 0]]),
    g_unique_enemy2: T([[1.5, 0, 0, '', 0, 0], [0.5, 1, 1, 'animals/miner_santa', 0, 0, { xmas: 1 }], [0.85, 1, 1, 'animals/shotgunner_weak', 0, 0], [0.5, 2, 2, 'animals/miner_weak', 0, 0], [0.5, 1, 1, 'animals/slimeshooter_weak', 0, 0]]),
    g_unique_enemy3: T([[0, 0, 0, '', 0, 0], [0.7, 1, 1, 'animals/firemage_weak', 0, 0], [0.3, 1, 1, 'animals/alchemist', 0, 0], [0.1, 1, 1, 'animals/thundermage', 0, 0]]),
    g_fungi: T([[0.5, 0, 0, '', 0, 0], [0.5, 1, 1, 'animals/fungus', 0, 0], [0.05, 1, 1, 'animals/fungus_big', 0, 0]]),
    g_props: T([[0.2, 0, 0, '', 0, 0], [0.5, 1, 1, 'props/physics_box_explosive', 0, 0], [0.25, 1, 1, 'props/physics/minecart', 0, -3], [0.25, 1, 1, 'props/physics_cart', 0, -5], [0.1, 1, 1, 'props/physics_barrel_radioactive', 0, 0], [0.3, 1, 1, 'props/physics_barrel_oil', 0, 0]]),
    g_props2: T([[0.5, 0, 0, '', 0, 0], [0.2, 1, 1, 'props/physics/minecart', 0, -3], [0.5, 1, 1, 'props/physics_brewing_stand', 0, -5]]),
    g_props3: T([[0.1, 0, 0, '', 0, 0], [0.3, 1, 1, 'items/pickup/potion', 0, -5]]),
    g_items: T([[0, 0, 0, '', 0, 0], ...WANDS_L1(17), [1.9, 1, 1, 'items/wand_level_01', 0, 0]]),
    g_candles: T([[0.33, 1, 1, 'props/physics_candle_1', 0, 0], [0.33, 1, 1, 'props/physics_candle_2', 0, 0], [0.33, 1, 1, 'props/physics_candle_3', 0, 0]]),
    g_structures: T([[0.1, 0, 0, '', 0, 0], [0.3, 1, 1, 'props/coalmine_structure_01', 0, -5], [0.3, 1, 1, 'props/coalmine_structure_01', 0, -5]]),
    g_large_structures: T([[0.1, 0, 0, '', 0, 0], [0.3, 1, 1, 'props/coalmine_large_structure_01', 0, -5], [0.3, 1, 1, 'props/coalmine_large_structure_02', 0, -5]]),
    g_i_structures: T([[0.1, 0, 0, '', 0, 0], [0.3, 1, 1, 'props/coalmine_i_structure_01', 0, -5], [0.3, 1, 1, 'props/coalmine_i_structure_02', 0, -5]]),
    g_nest: T([[0.5, 1, 1, 'buildings/flynest', 0, 0], [0.5, 1, 1, '', 0, 0]]),
  },
  coalmine_alt: {
    g_small_enemies: T([[1, 0, 0, '', 0, 0], [0.4, 1, 2, 'animals/zombie', 0, 0], [0.1, 1, 1, 'animals/slimeshooter', 0, 0], [0.2, 1, 3, 'animals/frog', 0, 0], [0.3, 2, 2, 'animals/miner_weak', 0, 0], [0.1, 2, 2, 'animals/miner_fire', 0, 0], [0.1, 1, 1, 'animals/shotgunner', 0, 0], [0.1, 1, 1, 'animals/wizard_dark', 0, 0, { ng: 1 }]]),
    g_big_enemies: T([[1.7, 0, 0, '', 0, 0], [0.2, 1, 1, 'animals/firemage_weak', 0, 0], [0.01, 1, 1, 'animals/worm', 0, 0], [0.1, 1, 1, '', 0, 0, { g: ['animals/miner', 'animals/miner', 'animals/shotgunner'] }], [0.12, 1, 1, 'animals/shotgunner', 0, 0], [0.1, 1, 1, 'animals/acidshooter', 0, 0], [0.08, 1, 1, 'animals/giantshooter', 0, 0], [0.09, 1, 1, 'animals/fireskull', 0, 0], [0.2, 3, 5, 'animals/frog', 0, 0], [0.13, 1, 1, 'animals/frog_big', 0, 0], [0.05, 1, 1, '', 0, 0, { g: ['animals/frog', 'animals/frog', 'animals/frog_big'] }], [0.3, 1, 2, 'animals/miner_santa', 0, 0, { xmas: 1 }], [0.1, 1, 1, 'animals/shaman', 0, 0], [0.02, 1, 1, 'animals/drone_shield', 0, 0, { ng: 2 }], [0.1, 1, 1, 'animals/scavenger_clusterbomb', 0, 0, { ng: 1 }]]),
    g_unique_enemy: T([[0, 0, 0, '', 0, 0], [0.5, 1, 3, 'animals/slimeshooter', 0, 0], [0.3, 1, 2, 'animals/acidshooter', 0, 0], [0.1, 1, 1, 'animals/giantshooter', 0, 0]]),
    g_unique_enemy2: T([[1.5, 0, 0, '', 0, 0], [0.5, 1, 1, 'animals/miner_santa', 0, 0, { xmas: 1 }], [0.5, 1, 1, 'animals/shotgunner', 0, 0], [0.5, 2, 2, 'animals/miner', 0, 0], [0.5, 1, 1, 'animals/slimeshooter', 0, 0]]),
    g_unique_enemy3: T([[0, 0, 0, '', 0, 0], [1, 1, 1, 'animals/firemage_weak', 0, 0], [0.1, 1, 1, 'animals/thundermage', 0, 0]]),
    g_fungi: T([[0.5, 0, 0, '', 0, 0], [0.5, 1, 1, 'animals/fungus', 0, 0]]),
    g_props: T([[0.2, 0, 0, '', 0, 0], [0.1, 1, 1, 'props/physics_box_explosive', 0, 0], [0.25, 1, 1, 'props/physics/minecart', 0, -3], [0.2, 1, 1, 'props/physics_barrel_radioactive', 0, 0], [0.5, 1, 1, 'props/physics_barrel_oil', 0, 0]]),
    g_props2: T([[0.5, 0, 0, '', 0, 0], [0.2, 1, 1, 'props/physics/minecart', 0, -3], [0.25, 1, 1, 'props/physics_cart', 0, -5], [0.5, 1, 1, 'props/physics_brewing_stand', 0, -5]]),
    g_props3: T([[0.1, 0, 0, '', 0, 0], [0.3, 1, 1, 'items/pickup/potion', 0, -5]]),
    g_items: T([[0, 0, 0, '', 0, 0], ...WANDS_L1(9)]),
    g_candles: T([[0.33, 1, 1, 'props/physics_candle_1', 0, 0], [0.33, 1, 1, 'props/physics_candle_2', 0, 0], [0.33, 1, 1, 'props/physics_candle_3', 0, 0]]),
    g_structures: T([[0.1, 0, 0, '', 0, 0], [0.3, 1, 1, 'props/coalmine_structure_01', 0, -5], [0.3, 1, 1, 'props/coalmine_structure_01', 0, -5]]),
    g_large_structures: T([[0.1, 0, 0, '', 0, 0], [0.3, 1, 1, 'props/coalmine_large_structure_01', 0, -5], [0.3, 1, 1, 'props/coalmine_large_structure_02', 0, -5]]),
    g_nest: T([[0.5, 1, 1, 'buildings/flynest', 0, 0], [0.5, 1, 1, '', 0, 0]]),
  },
  excavationsite: {
    g_small_enemies: T([[0.55, 0, 0, '', 0, 0], [0.2, 1, 3, 'animals/firebug', 0, 0], [0.2, 1, 4, 'animals/rat', 0, 0], [0.1, 1, 1, 'animals/slimeshooter', 0, 0], [0.3, 1, 2, 'animals/miner', 0, 0], [0.3, 1, 1, 'animals/shotgunner', 0, 0], [0.2, 2, 5, 'animals/bat', 0, 0], [0.08, 1, 1, 'animals/bigfirebug', 0, 0], [0.2, 1, 2, 'animals/goblin_bomb', 0, 0], [0.1, 1, 1, 'animals/wizard_hearty', 0, 0, { ng: 2 }], [0.01, 1, 1, 'animals/slimespirit', 0, 0]]),
    g_big_enemies: T([[0.98, 0, 0, '', 0, 0], [0.1, 1, 2, '', 0, 0, { g: ['animals/miner', 'animals/shotgunner'] }], [0.2, 1, 1, 'animals/shotgunner', 0, 0], [0.05, 1, 1, 'animals/miner_fire', 0, 0], [0.1, 1, 2, 'animals/slimeshooter', 0, 0], [0.09, 1, 1, 'animals/fireskull', 0, 0], [0.2, 1, 1, 'animals/bigbat', 0, 0], [0.02, 1, 1, 'animals/scavenger_mine', 0, 0], [0.3, 1, 2, 'animals/miner_santa', 0, 0, { xmas: 1 }], [0.2, 2, 4, 'animals/firebug', 0, 0], [0.08, 1, 1, 'animals/bigfirebug', 0, 0], [0.08, 1, 1, 'animals/alchemist', 0, 0], [0.1, 1, 1, 'animals/tank_super', 0, 0, { ng: 1 }]]),
    g_unique_enemy: T([[0, 0, 0, '', 0, 0], [0.5, 1, 3, 'animals/slimeshooter', 0, 0], [0.3, 1, 2, 'animals/acidshooter', 0, 0], [0.1, 1, 1, 'animals/giantshooter', 0, 0]]),
    g_unique_enemy2: T([[0.5, 0, 0, '', 0, 0], [0.5, 1, 1, 'animals/miner_santa', 0, 0, { xmas: 1 }], [0.5, 1, 1, 'animals/shotgunner', 0, 0]]),
    g_unique_enemy3: T([[0, 0, 0, '', 0, 0], [1, 1, 1, 'animals/firemage', 0, 0], [0.1, 1, 1, 'animals/thundermage', 0, 0]]),
    g_items: T([[0, 0, 0, '', 0, 0], [2, 1, 1, 'items/wand_unshuffle_01', 0, 0], [2, 1, 1, 'items/wand_level_02', 0, 0], [2, 1, 1, 'items/wand_level_02_better', 0, 0]]),
    g_props: T([[1, 0, 0, '', 0, 0], [0.2, 1, 1, 'props/physics_box_explosive', 0, 0], [0.25, 1, 1, 'props/physics/minecart', 0, -3], [0.25, 1, 1, 'props/physics_cart', 0, -5], [0.5, 1, 1, 'props/physics_barrel_radioactive', 0, 0], [0.07, 1, 1, 'props/physics_barrel_oil', 0, 0], [0.03, 1, 1, 'props/physics_seamine', 0, -8]]),
    g_props2: T([[0.5, 0, 0, '', 0, 0], [0.2, 1, 1, 'props/physics/minecart', 0, -3], [0.5, 1, 1, 'props/physics_brewing_stand', 0, -5]]),
    g_props3: T([[0.1, 0, 0, '', 0, 0], [0.3, 1, 1, 'props/physics_bottle_green', 0, -5], [0.3, 1, 1, 'props/physics_bottle_red', 0, -5], [0.3, 1, 1, 'props/physics_bottle_blue', 0, -5], [0.2, 1, 1, 'props/physics_bottle_yellow', 0, -5]]),
    g_nest: T([[0.5, 1, 1, 'buildings/firebugnest', 0, 0], [0.5, 1, 1, '', 0, 0]]),
    g_hanger: T([[1, 1, 1, '', 0, 0], [1, 1, 1, 'props/physics_bucket', 0, 0]]),
    g_physicsstructure: T([[1, 1, 1, 'props/excavationsite_machine_3b', 0, 0], [1, 1, 1, 'props/excavationsite_machine_3c', 0, 0]]),
    g_rock: T([[1.2, 1, 1, '', 0, 0], [0.2, 1, 1, 'props/physics_stone_01', 0, 0], [0.2, 1, 1, 'props/physics_stone_02', 0, 0], [0.2, 1, 1, 'props/physics_stone_03', 0, 0], [0.2, 1, 1, 'props/physics_stone_04', 0, 0]]),
    g_hanging_props: T([[1, 1, 1, '', 0, 0], [0.6, 1, 1, 'props/suspended_container', 0, 0], [0.4, 1, 1, 'props/suspended_tank_radioactive', 0, 0], [0.2, 1, 1, 'props/suspended_seamine', 0, 0]]),
    g_candles: T([[0.33, 1, 1, 'props/physics_candle_1', 0, 0], [0.33, 1, 1, 'props/physics_candle_2', 0, 0], [0.33, 1, 1, 'props/physics_candle_3', 0, 0]]),
    // spawn_wheel / _small / _tiny 是 EntityLoad 直放,用单行必出表表达
    g_wheel: T([[1, 1, 1, 'props/physics_wheel', 0, 0]]), g_wheel_small: T([[1, 1, 1, 'props/physics_wheel_small', 0, 0]]), g_wheel_tiny: T([[1, 1, 1, 'props/physics_wheel_tiny', 0, 0]]),
  },
  snowcave: {
    g_small_enemies: T([[0.1, 0, 0, '', 0, 0], [0.2, 1, 2, 'animals/shotgunner', 0, 0], [0.1, 1, 2, 'animals/slimeshooter', 0, 0], [0.5, 1, 4, 'animals/rat', 0, 0], [0.1, 1, 1, 'animals/iceskull', 0, 0], [0.07, 1, 2, 'animals/scavenger_grenade', 0, 0], [0.07, 1, 2, 'animals/scavenger_smg', 0, 0], [0.05, 1, 1, '', 0, 0, { g: ['animals/scavenger_smg', 'animals/scavenger_grenade'] }], [0.1, 1, 1, 'animals/sniper', 0, 0], [0.05, 1, 1, 'animals/tank', 0, 0], [0.01, 1, 1, 'animals/tank_rocket', 0, 0], [0.09, 1, 1, 'animals/thundermage', 0, 0, { ng: 1 }], [0.09, 1, 1, 'animals/thundermage_big', 0, 0, { ng: 2 }]]),
    g_big_enemies: T([[0.3, 0, 0, '', 0, 0], [0.15, 1, 1, 'animals/thundermage', 0, 0], [0.08, 1, 1, 'animals/thundermage_big', 0, 0, { ng: 1 }], [0.05, 1, 1, 'animals/worm_big', 0, 0], [0.01, 1, 1, 'animals/worm', 0, 0], [0.05, 1, 3, 'animals/worm_tiny', 0, 0], [0.4, 1, 3, 'animals/iceskull', 0, 0], [0.2, 1, 1, 'animals/giant', 0, 0], [0.04, 1, 1, 'animals/icemage', 0, 0], [0.2, 1, 1, '', 0, 0, { g: [{ e: 'animals/sniper', min: 1, max: 1 }, { e: 'animals/shotgunner', min: 0, max: 2 }] }], [0.2, 2, 3, 'animals/scavenger_grenade', 0, 0], [0.2, 2, 3, 'animals/scavenger_smg', 0, 0], [0.1, 1, 2, '', 0, 0, { g: [{ e: 'animals/scavenger_smg', min: 1, max: 2 }, { e: 'animals/scavenger_grenade', min: 1, max: 2 }] }], [0.02, 1, 1, '', 0, 0, { g: [{ e: 'animals/scavenger_smg', min: 1, max: 1 }, { e: 'animals/scavenger_grenade', min: 1, max: 2 }, { e: 'animals/coward', min: 0, max: 1 }], ng: 1 }], [0.1, 1, 1, 'animals/tank', 0, 0], [0.03, 1, 1, 'animals/tank_rocket', 0, 0], [0.05, 1, 1, '', 0, 0, { g: [{ e: 'animals/scavenger_smg', min: 1, max: 3 }, { e: 'animals/scavenger_grenade', min: 1, max: 3 }, 'animals/scavenger_leader'] }], [0.01, 1, 1, 'animals/monk', 0, 0], [0.01, 1, 1, 'animals/wizard_neutral', 0, 0], [0.05, 1, 1, 'animals/thunderskull', 0, 0], [0.1, 2, 4, 'animals/scavenger_glue', 0, 0], [0.05, 1, 1, 'animals/drone_shield', 0, 0, { ng: 2 }], [0.05, 1, 1, 'buildings/hpcrystal', 0, 0, { ng: 1 }], [0.01, 1, 2, 'animals/easter/sniper', 0, 0, { xmas: 1 }]]),
    g_scavenger_party: T([[1, 1, 1, '', 0, 0, { g: [{ e: 'animals/scavenger_smg', min: 1, max: 3 }, { e: 'animals/scavenger_grenade', min: 1, max: 3 }, { e: 'animals/coward', min: 0, max: 1 }, 'animals/scavenger_leader'] }]]),
    g_unique_enemy: T([[0, 0, 0, '', 0, 0], [1, 1, 1, 'animals/tank', 0, 0], [0.1, 1, 1, 'animals/tank_rocket', 0, 0], [0.001, 1, 1, 'animals/tank_super', 0, 0], [0.1, 1, 1, 'animals/wizard_tele', 0, 0], [0.1, 1, 1, 'animals/wizard_dark', 0, 0], [0.07, 1, 1, 'animals/wizard_swapper', 0, 0], [0.1, 1, 1, 'animals/necromancer', 0, 0]]),
    g_unique_enemy2: T([[0, 0, 0, '', 0, 0], [0.6, 1, 2, 'animals/scavenger_grenade', 0, 0], [0.6, 1, 2, 'animals/scavenger_smg', 0, 0], [0.5, 1, 1, 'animals/sniper', 0, 0]]),
    g_items: T([[0, 0, 0, '', 0, 0], [5, 1, 1, 'items/wand_level_02', 0, 0], [5, 1, 1, 'items/wand_level_02_better', 0, 0], [5, 1, 1, 'items/wand_unshuffle_02', 0, 0]]),
    g_props: T([[0.15, 0, 0, '', 0, 0], [0.5, 1, 1, 'props/physics_box_explosive', 0, 0], [0.2, 1, 1, 'props/physics_propane_tank', 0, 0], [0.3, 1, 1, 'props/physics_barrel_oil', 0, 0], [0.05, 1, 1, 'props/physics_trap_electricity_enabled', 0, 0]]),
    g_skulls: T([[1.5, 1, 1, 'props/physics_skull_01', 0, 0], [1.5, 1, 1, 'props/physics_skull_02', 0, 0], [1.5, 1, 1, 'props/physics_skull_03', 0, 0], [0.5, 1, 1, 'props/physics_bone_01', 0, 0], [0.5, 1, 1, 'props/physics_bone_02', 0, 0], [0.5, 1, 1, 'props/physics_bone_03', 0, 0], [0.5, 1, 1, 'props/physics_bone_04', 0, 0], [0.5, 1, 1, 'props/physics_bone_05', 0, 0], [0.5, 1, 1, 'props/physics_bone_06', 0, 0]]),
    g_stones: T([[2, 1, 1, 'props/stonepile', 0, 0], [1.5, 1, 1, 'props/physics_stone_01', 0, 0], [1.5, 1, 1, 'props/physics_stone_02', 0, 0], [1.5, 1, 1, 'props/physics_stone_03', 0, 0], [1.5, 1, 1, 'props/physics_stone_04', 0, 0], [4, 1, 1, '', 0, 0]]),
    g_candles: T([[0.33, 1, 1, 'props/physics_candle_1', 0, 0], [0.33, 1, 1, 'props/physics_candle_2', 0, 0], [0.33, 1, 1, 'props/physics_candle_3', 0, 0]]),
    g_fish: T([[1, 3, 4, 'animals/fish_large', 0, 0], [5, 1, 1, '', 0, 0]]),
    g_burning_barrel: T([[1, 1, 1, 'props/physics_barrel_burning', 0, 0]]), g_electricity_trap: T([[1, 1, 1, 'props/physics_trap_electricity_enabled', 0, 0]]),
  },
  snowcastle: {
    g_small_enemies: T([[0.2, 0, 0, '', 0, 0], [0.1, 1, 2, '', 0, 0, { g: ['animals/scavenger_grenade', 'animals/scavenger_smg'] }], [0.1, 1, 2, '', 0, 0, { g: [{ e: 'animals/scavenger_grenade', min: 1, max: 2 }, { e: 'animals/scavenger_smg', min: 0, max: 2 }] }], [0.1, 1, 1, 'animals/sniper', 0, 0], [0.1, 1, 2, 'animals/miner', 0, 0], [0.1, 1, 2, 'animals/shotgunner', 0, 0], [0.05, 1, 2, 'animals/tank', 0, 0], [0.01, 1, 2, 'animals/tank_rocket', 0, 0], [0.002, 1, 2, 'animals/tank_super', 0, 0], [0.04, 1, 1, 'animals/scavenger_heal', 0, 0], [0.05, 1, 1, 'animals/drone_lasership', 0, 0], [0.1, 1, 1, 'animals/tank_super', 0, 0, { ng: 1 }], [0.1, 1, 1, 'animals/scavenger_leader', 0, 0, { ng: 2 }], [0.1, 1, 1, '', 0, 0, { g: [{ e: 'animals/scavenger_grenade', min: 0, max: 1 }, { e: 'animals/scavenger_smg', min: 1, max: 2 }, { e: 'animals/coward', min: 0, max: 1 }] }], [0.1, 1, 1, 'animals/shotgunner_hell', 0, 0, { ng: 1 }], [0.1, 1, 1, 'animals/sniper_hell', 0, 0, { ng: 2 }], [1.1, 1, 2, '', 0, 0, { xmas: 1 }], [1.1, 1, 2, '', 0, 0, { xmas: 1 }], [1.1, 1, 1, '', 0, 0, { xmas: 1 }], [1.1, 1, 2, '', 0, 0, { xmas: 1 }], [1.1, 1, 2, '', 0, 0, { xmas: 1 }], [1.05, 1, 2, '', 0, 0, { xmas: 1 }], [1.01, 1, 2, '', 0, 0, { xmas: 1 }], [1.002, 1, 2, '', 0, 0, { xmas: 1 }], [1.04, 1, 1, '', 0, 0, { xmas: 1 }], [1.05, 1, 1, '', 0, 0, { xmas: 1 }], [1.1, 1, 1, '', 0, 0, { xmas: 1 }], [1.1, 1, 1, '', 0, 0, { xmas: 1 }]]),
    g_big_enemies: T([[0.3, 0, 0, '', 0, 0], [0.1, 1, 1, '', 0, 0, { g: ['animals/scavenger_leader', { e: 'animals/scavenger_grenade', min: 1, max: 3 }, { e: 'animals/scavenger_smg', min: 1, max: 3 }] }], [0.1, 1, 1, '', 0, 0, { g: ['animals/scavenger_leader', { e: 'animals/scavenger_grenade', min: 1, max: 2 }, { e: 'animals/scavenger_smg', min: 1, max: 2 }, { e: 'animals/coward', min: 1, max: 2 }], ng: 1 }], [0.1, 1, 1, 'animals/tank', 0, 0], [0.03, 1, 1, 'animals/tank_rocket', 0, 0], [0.04, 1, 1, 'animals/scavenger_heal', 0, 0], [0.005, 1, 1, 'animals/tank_super', 0, 0], [0.02, 1, 1, '', 0, 0, { g: ['animals/scavenger_clusterbomb', { e: 'animals/scavenger_grenade', min: 1, max: 3 }, { e: 'animals/scavenger_smg', min: 1, max: 3 }, { e: 'animals/scavenger_heal', min: 1, max: 1 }] }], [0.1, 1, 3, 'animals/drone_lasership', 0, 0], [0.04, 1, 1, 'animals/drone_shield', 0, 0, { ng: 1 }], [0.04, 1, 1, '', 0, 0, { g: ['animals/coward', { e: 'animals/scavenger_grenade', min: 1, max: 2 }, { e: 'animals/scavenger_smg', min: 1, max: 2 }] }], [0.05, 1, 1, 'buildings/hpcrystal', 0, 0, { ng: 1 }], [0.075, 1, 1, 'animals/necrobot', 0, 0, { ng: 2 }], [0.04, 1, 1, 'animals/necrobot_super', 0, 0, { ng: 3 }], [2.1, 1, 1, '', 0, 0, { xmas: 1 }], [2.1, 1, 1, '', 0, 0, { ng: 1, xmas: 1 }], [2.04, 1, 1, '', 0, 0, { xmas: 1 }], [2.02, 1, 1, '', 0, 0, { xmas: 1 }]]),
    g_unique_enemy: T([[0, 0, 0, '', 0, 0], [1, 1, 1, 'animals/tank', 0, 0], [0.1, 1, 1, 'animals/tank_rocket', 0, 0], [0.002, 1, 1, 'animals/tank_super', 0, 0], [0.08, 1, 1, 'animals/healerdrone_physics', 0, 0]]),
    g_unique_enemy2: T([[0, 0, 0, '', 0, 0], [0.6, 1, 3, 'animals/scavenger_grenade', 0, 0], [0.6, 1, 3, 'animals/scavenger_smg', 0, 0], [0.5, 1, 1, 'animals/sniper', 0, 0], [0.01, 1, 1, 'animals/scavenger_heal', 0, 0], [2.6, 1, 3, '', 0, 0, { xmas: 1 }], [2.6, 1, 3, '', 0, 0, { xmas: 1 }], [2.5, 1, 1, '', 0, 0, { xmas: 1 }], [2.01, 1, 1, '', 0, 0, { xmas: 1 }]]),
    g_items: T([[0, 0, 0, '', 0, 0], [5, 1, 1, 'items/wand_level_03', 0, 0], [5, 1, 1, 'items/wand_level_03_better', 0, 0], [5, 1, 1, 'items/wand_unshuffle_03', 0, 0], [5, 1, 3, '', 0, 0, { xmas: 1 }]]),
    g_props: T([[0.2, 0, 0, '', 0, 0], [0.5, 1, 1, 'props/physics_box_explosive', 0, 0], [0.5, 1, 1, 'props/physics_propane_tank', 0, 0], [0.1, 1, 1, 'props/physics_seamine', 0, -8], [0.5, 1, 3, '', 0, 0, { xmas: 1 }]]),
    g_props2: T([[0.3, 0, 0, '', 0, 0], [1, 1, 1, 'props/physics_crate', 0, 0], [0.1, 2, 3, 'props/physics_propane_tank', 0, 0], [0.5, 1, 3, '', 0, 0, { xmas: 1 }]]),
    g_props3: T([[0.1, 0, 0, '', 0, 0], [0.3, 1, 1, 'props/physics_bottle_green', 0, -5], [0.3, 1, 1, 'props/physics_bottle_red', 0, -5], [0.3, 1, 1, 'props/physics_bottle_blue', 0, -5], [0.2, 1, 1, 'props/physics_bottle_yellow', 0, -5], [0.1, 1, 1, 'items/pickup/potion_alcohol', 0, -5], [0.025, 1, 1, 'items/pickup/potion', 0, -5]]),
    g_turret: T([[0.5, 0, 0, '', 0, 0], [0.1, 1, 1, 'animals/turret_right', 0, 0], [0.1, 1, 1, 'animals/turret_left', 0, 0]]),
    g_barricade: T([[1, 1, 1, 'props/physics_box_harmless', 0, 0]]),
    g_forcefield_generator: T([[1, 1, 1, '', 0, 0], [0.5, 1, 1, 'props/forcefield_generator', 0, 0]]),
    g_furniture: T([[2, 1, 1, '', 0, 0], [1, 1, 1, 'props/furniture_bunk', 0, 0], [1, 1, 1, 'props/furniture_table', 0, 0], [1, 1, 1, 'props/furniture_locker', 0, 0], [1, 1, 1, 'props/furniture_footlocker', 0, 0], [1, 1, 1, 'props/furniture_stool', 0, 0], [0.5, 1, 1, 'props/furniture_cryopod', 0, 0]]),
    g_furniture_bunk: T([[1, 1, 1, 'props/furniture_bunk', 0, 0]]), g_cook: T([[1, 1, 1, 'animals/miner_chef', 0, 0]]),
  },
  fungicave: {
    g_small_enemies: T([[0.2, 0, 0, '', 0, 0], [0.3, 1, 3, 'animals/zombie', 0, 0], [0.1, 1, 2, 'animals/slimeshooter', 0, 0], [0.4, 1, 3, 'animals/rat', 0, 0], [0.3, 1, 3, 'animals/fungus', 0, 0], [0.05, 1, 2, 'animals/acidshooter', 0, 0], [0.1, 1, 2, 'animals/ant', 0, 0], [0.1, 2, 4, 'animals/blob', 0, 0], [0.09, 1, 2, 'animals/tentacler', 0, 0], [0.11, 1, 2, 'animals/tentacler_small', 0, 0], [0.08, 1, 1, '', 0, 0, { g: ['animals/tentacler_small', 'animals/tentacler'] }], [0.1, 1, 2, 'animals/wizard_tele', 0, 0], [0.1, 1, 1, 'animals/wizard_dark', 0, 0], [0.07, 1, 1, 'animals/wizard_swapper', 0, 0], [0.1, 1, 1, 'animals/scavenger_invis', 0, 0], [0.05, 1, 1, '', 0, 0, { g: ['animals/frog', 'animals/frog', 'animals/frog_big'] }]]),
    g_big_enemies: T([[0.7, 0, 0, '', 0, 0], [0.05, 1, 2, 'animals/thundermage', 0, 0], [0.4, 1, 3, 'animals/fungus', 0, 0], [0.2, 1, 2, 'animals/acidshooter', 0, 0], [0.1, 1, 1, 'animals/giantshooter', 0, 0], [0.1, 3, 5, 'animals/blob', 0, 0], [0.05, 1, 1, 'animals/bigzombie', 0, 0], [0.05, 1, 1, 'animals/wizard_poly', 0, 0], [0.1, 1, 1, 'animals/maggot', 0, 0], [0.2, 1, 1, 'animals/alchemist', 0, 0], [0.04, 1, 1, 'animals/fungus_big', 0, 0], [0.04, 1, 1, 'animals/wizard_neutral', 0, 0], [0.06, 1, 1, 'animals/wizard_twitchy', 0, 0], [0.01, 1, 1, '', 0, 0, { g: [{ e: 'animals/fungus', min: 1, max: 3 }, { e: 'animals/fungus_big', min: 1, max: 1 }] }], [0.1, 1, 1, 'animals/drone_shield', 0, 0, { ng: 2 }], [0.01, 1, 1, 'animals/slimespirit', 0, 0], [0.01, 1, 1, 'animals/confusespirit', 0, 0]]),
    g_items: T([[0, 0, 0, '', 0, 0], [5, 1, 1, 'items/wand_unshuffle_02', 0, 0], [5, 1, 1, 'items/wand_unshuffle_01', 0, 0]]),
    g_nest: T([[0.5, 1, 1, 'buildings/flynest', 0, 0], [0.5, 1, 1, 'buildings/spidernest', 0, 0]]),
    g_physics_fungi: T([[1, 0, 0, '', 0, 0], [1, 1, 1, 'props/physics_fungus_small', 0, 0], [1, 1, 1, 'props/physics_fungus', 0, 0], [0.5, 1, 1, 'props/physics_fungus_big', 0, 0]]),
    g_robots: T([[0.5, 0, 0, '', 0, 0], [0.5, 1, 1, 'animals/roboguard', 0, 0], [0.5, 1, 2, 'animals/drone_physics', 0, 0], [0.01, 1, 1, 'animals/assassin', 0, 0]]),
    g_props: T([[0.5, 0, 0, '', 0, 0], [0.5, 1, 1, 'props/physics_barrel_radioactive', 0, 0]]),
  },
  // rainforest:animals/rainforest/* 是丛林强化版(键 rainforest_xxx,和普通 scavenger_smg 不是一回事);projectiles/mine 是直接放地雷
  rainforest: {
    g_small_enemies: T([[0.5, 0, 0, '', 0, 0], [0.3, 2, 4, 'animals/rainforest/fly', 0, 0], [0.09, 1, 1, 'animals/lukki/lukki_longleg', 0, 0], [0.09, 1, 1, 'animals/lukki/lukki', 0, 0], [0.1, 1, 2, 'animals/rainforest/shooterflower', 0, 0], [0.09, 1, 1, 'animals/rainforest/scavenger_poison', 0, 0], [0.09, 1, 1, 'animals/rainforest/scavenger_clusterbomb', 0, 0], [0.2, 1, 1, 'projectiles/mine', 0, 0], [0.1, 1, 1, 'animals/rainforest/bloom', 0, 0], [0.01, 1, 3, 'animals/shaman', 0, 0], [0.06, 1, 3, 'animals/wizard_twitchy', 0, 0], [0.05, 1, 1, '', 0, 0, { g: ['animals/rainforest/scavenger_smg', 'animals/rainforest/scavenger_grenade', 'animals/rainforest/coward'] }]]),
    g_big_enemies: T([[0.6, 0, 0, '', 0, 0], [0.1, 2, 3, 'animals/rainforest/fungus', 0, 0], [0.09, 1, 1, 'animals/lukki/lukki_longleg', 0, 0], [0.1, 1, 1, 'animals/rainforest/bloom', 0, 0], [0.1, 1, 1, 'animals/rainforest/scavenger_mine', 0, 0], [0.05, 1, 1, '', 0, 0, { g: ['animals/rainforest/scavenger_poison', 'animals/rainforest/scavenger_clusterbomb'] }], [0.05, 1, 1, '', 0, 0, { g: ['animals/rainforest/scavenger_poison', 'animals/rainforest/scavenger_clusterbomb', 'animals/rainforest/scavenger_heal'] }], [0.1, 1, 1, 'projectiles/mine', 0, 0], [0.1, 1, 1, 'animals/rainforest/shooterflower', 0, 0], [0.09, 1, 1, 'animals/lukki/lukki', 0, 0], [0.03, 1, 1, 'animals/spearbot', 0, 0], [0.03, 1, 1, 'animals/wizard_hearty', 0, 0], [0.05, 1, 1, '', 0, 0, { g: ['animals/rainforest/scavenger_poison', 'animals/rainforest/scavenger_clusterbomb', 'animals/rainforest/scavenger_leader', 'animals/rainforest/coward'], ng: 1 }]]),
    g_unique_enemy: T([[1, 0, 0, '', 0, 0], [1, 1, 1, 'buildings/physics_cocoon', 0, 0], [0.1, 1, 1, 'projectiles/mine', 0, 0], [0.1, 1, 1, 'animals/rainforest/shooterflower', 0, 0]]),
    g_unique_enemy2: T([[1, 0, 0, '', 0, 0], [1, 1, 1, 'buildings/lukki_eggs', 0, 0]]),
    g_items: T([[0, 0, 0, '', 0, 0], [5, 1, 1, 'items/wand_level_04', 0, 0], [3, 1, 1, 'items/wand_level_05', 0, 0], [3, 1, 1, 'items/wand_unshuffle_02', 0, 0], [3, 1, 1, 'items/wand_unshuffle_03', 0, 0], [5, 1, 1, 'items/wand_level_04_better', 0, 0]]),
    g_nest: T([[0.5, 1, 1, 'buildings/flynest', 0, 0], [0.5, 1, 1, 'buildings/spidernest', 0, 0]]),
    g_large_enemies: T([[0.4, 0, 0, '', 0, 0], [0.1, 1, 1, 'animals/rainforest/shooterflower', 0, 0], [0.1, 1, 2, 'animals/rainforest/fungus', 0, 0], [0.5, 1, 2, 'animals/rainforest/bloom', 0, 0], [0.09, 1, 1, 'animals/lukki/lukki_longleg', 0, 0], [0.09, 1, 1, 'animals/lukki/lukki', 0, 0], [0.05, 1, 1, '', 0, 0, { g: [{ e: 'animals/rainforest/scavenger_clusterbomb', min: 1, max: 2 }, { e: 'animals/rainforest/scavenger_poison', min: 1, max: 2 }, 'animals/rainforest/scavenger_leader'] }], [0.1, 1, 1, 'projectiles/mine', 0, 0]]),
    g_scavengers: T([[0.5, 0, 0, '', 0, 0], [0.5, 1, 2, '', 0, 0, { g: ['animals/rainforest/scavenger_smg', 'animals/rainforest/scavenger_grenade'] }], [0.3, 1, 1, 'animals/rainforest/flamer', 0, 0], [0.4, 1, 1, 'animals/rainforest/sniper', 0, 0], [0.2, 1, 1, 'animals/rainforest/scavenger_leader', 0, 0], [0.2, 1, 1, 'projectiles/mine', 0, 0], [0.1, 1, 1, 'animals/rainforest/scavenger_mine', 0, 0]]),
    g_props: T([[0.5, 0, 0, '', 0, 0], [0.5, 1, 1, 'props/physics_barrel_radioactive', 0, 0], [0.2, 1, 1, 'props/physics_barrel_oil', 0, 0], [0.5, 1, 1, 'props/physics_box_explosive', 0, 0], [0.2, 1, 1, 'projectiles/mine', 0, 0], [0.2, 1, 1, 'props/physics_seamine', 0, -2]]),
    g_trees: T([[1.5, 1, 1, '', 0, 0], [0.4, 1, 1, 'props/rainforest_tree_01', -10, -113], [0.4, 1, 1, 'props/rainforest_tree_02', 0, 0], [0.4, 1, 1, 'props/rainforest_tree_03', 0, 0], [0.4, 1, 1, 'props/rainforest_tree_04', 0, 0], [0.4, 1, 1, 'props/rainforest_tree_05', 0, 0], [0.4, 1, 1, 'props/rainforest_tree_06', 0, 0]]),
  },
  vault: {
    g_small_enemies: T([[0.8, 0, 0, '', 0, 0], [0.3, 1, 2, 'animals/vault/drone_physics', 0, 0], [0.1, 1, 1, 'animals/vault/lasershooter', 0, 0], [0.1, 1, 1, 'animals/vault/roboguard', 0, 0], [0.1, 1, 1, 'animals/vault/assassin', 0, 0], [0.1, 1, 1, 'animals/vault/tentacler', 0, 0], [0.12, 1, 2, 'animals/vault/tentacler_small', 0, 0], [0.08, 1, 1, '', 0, 0, { g: ['animals/vault/tentacler_small', 'animals/vault/tentacler'] }], [0.3, 1, 1, 'animals/vault/acidshooter', 0, 0], [0.18, 3, 5, 'animals/vault/blob', 0, 0], [0.3, 1, 2, 'animals/vault/bigzombie', 0, 0], [0.1, 1, 1, 'animals/vault/scavenger_mine', 0, 0], [0.08, 1, 2, '', 0, 0, { g: ['animals/vault/sniper', 'animals/vault/flamer'] }], [0.2, 1, 3, 'animals/drone_lasership', 0, 0], [0.1, 1, 1, 'animals/monk', 0, 0], [0.1, 1, 1, 'animals/vault/thunderskull', 0, 0], [0.1, 1, 1, 'animals/drone_shield', 0, 0, { ng: 1 }], [0.1, 1, 1, 'animals/tank_super', 0, 0, { ng: 2 }], [0.08, 1, 1, '', 0, 0, { g: ['animals/vault/sniper', 'animals/vault/coward'] }], [0.1, 1, 3, 'animals/vault/scavenger_glue', 0, 0]]),
    g_big_enemies: T([[0.8, 0, 0, '', 0, 0], [0.2, 1, 2, 'animals/vault/firemage', 0, 0], [0.2, 1, 1, 'animals/vault/thundermage', 0, 0], [0.02, 1, 1, 'animals/scavenger_invis', 0, 0], [0.02, 1, 1, 'animals/scavenger_shield', 0, 0], [0.1, 1, 1, '', 0, 0, { g: ['animals/vault/roboguard', 'animals/vault/healerdrone_physics'] }], [0.1, 1, 1, 'animals/vault/wizard_dark', 0, 0], [0.07, 1, 1, 'animals/wizard_swapper', 0, 0], [0.07, 1, 1, 'animals/wizard_twitchy', 0, 0], [0.1, 1, 1, 'animals/vault/maggot', 0, 0], [0.2, 1, 2, '', 0, 0, { g: [{ e: 'animals/vault/scavenger_smg', min: 1, max: 3 }, { e: 'animals/vault/scavenger_grenade', min: 1, max: 3 }, { e: 'animals/vault/scavenger_glue', min: 0, max: 3 }, 'animals/vault/scavenger_leader', 'animals/vault/scavenger_heal'] }], [0.1, 1, 1, 'animals/vault/tank', 0, 0], [0.1, 1, 1, 'animals/vault/tank_rocket', 0, 0], [0.02, 1, 1, 'animals/vault/tank_super', 0, 0], [0.2, 1, 1, 'animals/vault/missilecrab', 0, 0], [0.05, 1, 1, 'animals/spearbot', 0, 0], [0.05, 1, 1, '', 0, 0, { g: ['animals/vault/flamer', 'animals/vault/icer', 'animals/vault/healerdrone_physics'] }], [0.05, 1, 1, '', 0, 0, { g: ['animals/vault/roboguard', 'animals/vault/healerdrone_physics', 'animals/vault/coward'] }], [0.075, 1, 1, 'animals/necrobot', 0, 0, { ng: 1 }], [0.05, 1, 1, 'animals/necrobot_super', 0, 0, { ng: 2 }]]),
    g_items: T([[0, 0, 0, '', 0, 0], [5, 1, 1, 'items/wand_level_05', 0, 0], [5, 1, 1, 'items/wand_level_05_better', 0, 0], [3, 1, 1, 'items/wand_unshuffle_03', 0, 0], [2, 1, 1, 'items/wand_unshuffle_04', 0, 0]]),
    g_props: T([[0.4, 0, 0, '', 0, 0], [0.3, 1, 1, 'props/physics_box_explosive', 0, 0], [0.3, 1, 1, 'props/physics_barrel_radioactive', 0, 0], [0.4, 1, 1, 'props/physics_barrel_oil', 0, 0], [0.1, 1, 1, 'props/physics_pressure_tank', 0, 0], [0.1, 1, 1, 'props/physics_propane_tank', 0, 0], [0.2, 1, 1, 'props/physics_seamine', 0, -8]]),
    g_hanging_props: T([[1, 1, 1, '', 0, 0], [0.2, 1, 1, 'props/suspended_container', 0, 0], [0.5, 1, 1, 'props/suspended_tank_radioactive', 0, 0], [0.6, 1, 1, 'props/suspended_tank_acid', 0, 0], [0.4, 1, 1, 'props/suspended_seamine', 0, 0]]),
    g_turret: T([[0.5, 0, 0, '', 0, 0], [0.1, 1, 1, 'animals/vault/turret_right', 0, 0], [0.1, 1, 1, 'animals/vault/turret_left', 0, 0]]),
    g_machines: T([[0.4, 1, 1, 'props/vault_machine_1', 0, 0], [0.4, 1, 1, 'props/vault_machine_2', 0, 0], [0.4, 1, 1, 'props/vault_machine_3', 0, 0], [0.4, 1, 1, 'props/vault_machine_4', 0, 0], [0.4, 1, 1, 'props/vault_machine_5', 0, 0], [0.4, 1, 1, 'props/vault_machine_6', 0, 0], [1.4, 1, 1, '', 0, 0]]),
    g_apparatus: T([[1, 1, 1, 'props/vault_apparatus_01', 0, 0], [1, 1, 1, 'props/vault_apparatus_02', 0, 0]]),
    g_barricade: T([[1, 1, 1, 'props/physics_box_harmless', 0, 0]]), g_electricity_trap: T([[1, 1, 1, 'props/physics_trap_electricity_enabled', 0, 0]]),
  },
  crypt: {
    g_small_enemies: T([[0.4, 0, 0, '', 0, 0], [0.1, 1, 1, 'animals/crypt/phantom_a', 0, 0], [0.3, 3, 4, 'animals/crypt/skullrat', 0, 0], [0.1, 1, 1, 'animals/crypt/phantom_b', 0, 0], [0.2, 1, 1, 'animals/crypt/skullfly', 0, 0], [0.1, 1, 2, 'animals/crypt/tentacler', 0, 0], [0.15, 1, 2, 'animals/crypt/tentacler_small', 0, 0], [0.1, 1, 1, '', 0, 0, { g: ['animals/crypt/tentacler_small', 'animals/crypt/tentacler'] }], [0.09, 1, 1, 'animals/crypt/necromancer', 0, 0], [0.1, 1, 1, 'animals/crypt/acidshooter', 0, 0], [0.1, 1, 1, 'animals/crypt/crystal_physics', 0, 0], [0.05, 1, 1, 'animals/crypt/maggot', 0, 0], [0.05, 1, 1, 'animals/crypt/failed_alchemist', 0, 0], [0.1, 1, 1, 'animals/wizard_homing', 0, 0, { ng: 1 }], [0.1, 1, 1, 'animals/wizard_weaken', 0, 0, { ng: 1 }], [0.01, 1, 1, 'animals/weakspirit', 0, 0, { ng: 1 }]]),
    g_big_enemies: T([[0.4, 0, 0, '', 0, 0], [0.01, 1, 1, 'animals/crypt/thundermage', 0, 0], [0.01, 1, 1, 'animals/crypt/worm', 0, 0], [0.1, 1, 1, 'animals/crypt/acidshooter', 0, 0], [0.1, 1, 1, 'animals/crypt/phantom_a', 0, 0], [0.05, 1, 1, 'animals/crypt/worm_skull', 0, 0], [0.2, 1, 1, 'animals/crypt/skullfly', 0, 0], [0.3, 2, 3, 'animals/crypt/skullrat', 0, 0], [0.1, 1, 1, 'animals/crypt/phantom_b', 0, 0], [0.1, 1, 1, '', 0, 0, { g: ['animals/crypt/phantom_b', 'animals/crypt/phantom_a'] }], [0.1, 1, 1, 'animals/crypt/crystal_physics', 0, 0], [0.1, 1, 2, 'animals/crypt/wizard_tele', 0, 0], [0.1, 1, 1, 'animals/crypt/wizard_dark', 0, 0], [0.1, 1, 1, 'animals/crypt/wizard_poly', 0, 0], [0.1, 1, 1, 'animals/crypt/wizard_returner', 0, 0], [0.07, 1, 1, 'animals/crypt/wizard_neutral', 0, 0], [0.05, 1, 1, 'animals/wizard_hearty', 0, 0], [0.07, 1, 1, 'animals/wizard_swapper', 0, 0], [0.07, 1, 1, 'animals/crypt/barfer', 0, 0], [0.07, 1, 1, 'animals/wraith', 0, 0], [0.07, 1, 1, 'animals/wraith_glowing', 0, 0], [0.07, 1, 1, 'animals/crypt/enlightened_alchemist', 0, 0], [0.1, 1, 1, 'animals/failed_alchemist_b', 0, 0], [0.02, 1, 1, 'animals/necromancer_shop', 0, 0, { ng: 2 }], [0.1, 2, 3, 'animals/ghoul', 0, 0, { ng: 1 }]]),
    g_items: T([[0, 0, 0, '', 0, 0], [5, 1, 1, 'items/wand_level_06', 0, 0], [5, 1, 1, 'items/wand_level_06_better', 0, 0], [3, 1, 1, 'items/wand_unshuffle_05', 0, 0], [2, 1, 1, 'items/wand_unshuffle_06', 0, 0]]),
    g_statues: T([[3, 0, 0, '', 0, 0], [1, 1, 1, 'props/sarcophagus', 0, 0], [0.1, 1, 1, 'props/sarcophagus_evil', 0, 0]]),
    g_statue_back: T([[1, 1, 1, '', 0, 0], [1, 1, 1, 'props/statue_back', 0, 0]]),
    g_scorpions: T([[0.7, 1, 1, '', 0, 0], [0.3, 1, 1, 'animals/scorpion', 0, 0]]),
    g_props: T([[0.2, 0, 0, '', 0, 0], [0.3, 1, 1, 'props/crystal_red', 0, -4], [0.3, 1, 1, 'props/crystal_pink', 0, -4], [0.3, 1, 1, 'props/crystal_green', 0, -4], [0.5, 1, 1, 'props/physics_vase', 0, -4], [0.3, 1, 1, 'props/physics_vase_longleg', 0, -4], [0.1, 1, 1, 'animals/mimic_physics', 0, -4], [0.1, 1, 1, 'props/physics_skull_01', 0, 0], [0.1, 1, 1, 'props/physics_skull_02', 0, 0], [0.1, 1, 1, 'props/physics_skull_03', 0, 0]]),
    g_unique_enemy: T([[0.5, 0, 0, '', 0, 0], [1.5, 1, 1, 'buildings/arrowtrap_right', 2, 0], [0.5, 1, 1, 'buildings/firetrap_right', 2, 0], [0.2, 1, 1, 'buildings/thundertrap_right', 2, 0], [0.2, 1, 1, 'buildings/spittrap_right', 2, 0]]),
    g_large_enemies: T([[0.5, 0, 0, '', 0, 0], [1.5, 1, 1, 'buildings/arrowtrap_left', 1, 0], [0.5, 1, 1, 'buildings/firetrap_left', 1, 0], [0.2, 1, 1, 'buildings/thundertrap_left', 1, 0], [0.2, 1, 1, 'buildings/spittrap_left', 1, 0]]),
    g_ghost_crystal: T([[0.5, 0, 0, '', 0, 0], [1, 1, 1, '', 0, 0, { g: [{ e: 'animals/ghost', min: 1, max: 3 }, 'buildings/ghost_crystal'] }]]),
    g_pressureplates: T([[1, 1, 1, 'props/pressure_plate', 0, 0]]),
    g_scavengers: T([[0.5, 0, 0, '', 0, 0], [0.2, 1, 3, '', 0, 0, { g: ['animals/scavenger_smg', 'animals/scavenger_grenade'] }], [0.1, 1, 1, 'animals/scavenger_leader', 0, 0], [0.1, 1, 1, 'animals/scavenger_clusterbomb', 0, 0], [0.05, 1, 1, 'animals/scavenger_poison', 0, 0]]),
    g_bones: T([[2.4, 1, 1, '', 0, 0], [0.6, 1, 1, 'props/physics_bone_01', 0, 0], [0.6, 1, 1, 'props/physics_bone_02', 0, 0], [0.6, 1, 1, 'props/physics_bone_03', 0, 0], [0.6, 1, 1, 'props/physics_bone_04', 0, 0], [0.6, 1, 1, 'props/physics_bone_05', 0, 0], [0.6, 1, 1, 'props/physics_bone_06', 0, 0]]),
  },
  // liquidcave(_dump-spawn-tables.mjs liquidcave):炼金术士 / 巫师为主;hpcrystal / necrobot_super 是 NG+ 行;items/chest 不存在(死行);lasergun 是 EntityLoad(x+5,y+5) → 单行表
  liquidcave: {
    g_small_enemies: T([[0.2, 0, 0, '', 0, 0], [0.1, 1, 1, 'animals/failed_alchemist', 0, 0], [0.1, 1, 1, 'animals/enlightened_alchemist', 0, 0], [0.1, 1, 1, 'animals/wizard_returner', 0, 0], [0.1, 1, 1, 'animals/wizard_neutral', 0, 0], [0.1, 1, 1, '', 0, 0, { g: ['animals/wizard_tele', 'animals/wizard_dark'], ng: 1 }], [0.1, 1, 1, '', 0, 0, { g: ['animals/wizard_hearty', 'animals/wizard_swapper'], ng: 1 }]]),
    g_big_enemies: T([[0.2, 0, 0, '', 0, 0], [0.1, 1, 1, 'animals/failed_alchemist', 0, 0], [0.1, 1, 2, 'animals/enlightened_alchemist', 0, 0], [0.08, 1, 1, 'animals/shaman', 0, 0], [0.1, 1, 1, 'animals/failed_alchemist_b', 0, 0], [0.1, 1, 1, 'animals/wizard_neutral', 0, 0], [0.1, 1, 1, '', 0, 0, { g: ['animals/wizard_twitchy', 'animals/wizard_poly'], ng: 2 }], [0.05, 1, 1, 'buildings/hpcrystal', 0, 0, { ng: 1 }], [0.05, 1, 1, 'animals/necrobot_super', 0, 0, { ng: 2 }]]),
    g_props: T([[0.5, 0, 0, '', 0, 0], [0.8, 1, 1, 'props/physics_bed', 0, 5], [0.1, 1, 1, 'props/physics_crate', 0, 0]]),
    g_props2: T([[1, 1, 1, 'props/banner', 0, 5]]),
    g_statues: T([[0.4, 1, 1, '', 0, 0], ...Array.from({ length: 12 }, (_, i) => [0.2, 1, 1, `props/statues/statue_rock_${String(i + 1).padStart(2, '0')}`, 0, 0]), [0.1, 1, 1, 'buildings/statue_trap_right', 0, 0], [0.1, 1, 1, 'buildings/statue_trap_left', 0, 0]]),
    g_lasergun: T([[1, 1, 1, 'buildings/lasergun', 0, 0]]),
  },
  // wandcave(_dump-spawn-tables.mjs wandcave):法杖幽灵 / 石像 / 幻影 / 死灵法师;cloud_trap 只有粒子发射器(下雨云),没做
  wandcave: {
    g_small_enemies: T([[0.3, 0, 0, '', 0, 0], [0.1, 1, 2, 'animals/wand_ghost', 0, 0]]),
    g_big_enemies: T([[0.3, 0, 0, '', 0, 0], [0.1, 1, 1, 'animals/statue_physics', 0, 0], [0.2, 1, 1, 'animals/phantom_a', 0, 0], [0.2, 1, 1, 'animals/phantom_b', 0, 0], [0.09, 1, 1, 'animals/necromancer', 0, 0], [0.09, 1, 1, 'animals/wizard_returner', 0, 0], [0.08, 1, 1, 'animals/wizard_neutral', 0, 0], [0.04, 1, 1, 'animals/wizard_hearty', 0, 0], [0.01, 1, 1, 'animals/wraith_glowing', 0, 0], [0.02, 1, 1, 'animals/enlightened_alchemist', 0, 0], [0.02, 1, 1, 'animals/failed_alchemist', 0, 0], [0.01, 1, 1, 'animals/weakspirit', 0, 0, { ng: 1 }]]),
    g_props: T([[0.33, 1, 1, 'props/physics_candle_1', 0, 0], [0.33, 1, 1, 'props/physics_candle_2', 0, 0], [0.33, 1, 1, 'props/physics_candle_3', 0, 0], [5.4, 1, 1, '', 0, 0], ...[1, 2, 3, 4, 5, 6].map((i) => [0.6, 1, 1, `props/physics_bone_0${i}`, 0, 0]), [1.5, 1, 1, 'props/physics_skull_01', 0, 0], [1.5, 1, 1, 'props/physics_skull_02', 0, 0], [1.5, 1, 1, 'props/physics_skull_03', 0, 0]]),
    g_cloud_trap: T([[0.2, 0, 0, '', 0, 0], [0.3, 1, 1, 'buildings/cloud_trap', 0, 0]]),
  },
  // pyramid(_dump-spawn-tables.mjs pyramid):骷髅鼠 / 骷髅蝇 / 蝎子 / 各路巫师;g_reward_items 三种法杖(spawn_reward_wands);statue 是 props/statue
  pyramid: {
    g_small_enemies: T([[2.5, 0, 0, '', 0, 0], [0.3, 1, 1, 'animals/skullrat', 0, 0], [0.2, 1, 1, 'animals/skullfly', 0, 0], [0.1, 1, 1, 'animals/acidshooter', 0, 0], [0.3, 1, 1, 'animals/scorpion', 0, 0], [0.2, 1, 1, 'animals/alchemist', 0, 0], [0.005, 1, 1, 'animals/thundermage_big', 0, 0], [0.1, 1, 1, 'animals/wizard_neutral', 0, 0], [0.1, 1, 2, 'animals/thunderskull', 0, 0], [0.1, 1, 2, 'animals/wizard_twitchy', 0, 0], [0.05, 1, 2, 'animals/wizard_hearty', 0, 0], [0.05, 1, 2, 'animals/wizard_weaken', 0, 0], [0.05, 1, 2, 'animals/ethereal_being', 0, 0], [0.05, 1, 1, 'buildings/hpcrystal', 0, 0, { ng: 1 }], [0.05, 1, 1, 'animals/confusespirit', 0, 0], [0.05, 1, 1, 'animals/berserkspirit', 0, 0], [0.01, 1, 1, 'animals/weakspirit', 0, 0]]),
    g_big_enemies: T([[2.5, 0, 0, '', 0, 0], [0.1, 1, 1, 'animals/acidshooter', 0, 0], [0.07, 1, 1, 'animals/phantom_a', 0, 0], [0.2, 1, 1, 'animals/skullfly', 0, 0], [0.3, 1, 1, 'animals/skullrat', 0, 0], [0.07, 1, 1, 'animals/phantom_b', 0, 0], [0.3, 1, 1, 'animals/scorpion', 0, 0]]),
    g_statues: T([[1, 1, 1, 'props/statue', 0, 0]]),
    g_scorpions: T([[0.2, 1, 1, '', 0, 0], [0.3, 1, 1, 'animals/scorpion', 0, 0]]),
    g_props: T([[0.2, 0, 0, '', 0, 0], [0.5, 1, 1, 'props/physics_vase', 0, -4], [0.3, 1, 1, 'props/physics_vase_longleg', 0, -4], [0.1, 1, 1, 'props/physics_skull_01', 0, 0], [0.1, 1, 1, 'props/physics_skull_02', 0, 0], [0.1, 1, 1, 'props/physics_skull_03', 0, 0]]),
    g_unique_enemy: T([[0.1, 0, 0, '', 0, 0], [1, 1, 1, 'buildings/arrowtrap_right', 2, 0]]),
    g_large_enemies: T([[0.1, 0, 0, '', 0, 0], [1, 1, 1, 'buildings/arrowtrap_left', 1, 0]]),
    g_pressureplates: T([[1, 1, 1, 'props/pressure_plate', 0, 0]]),
    g_candles: T([[0.33, 1, 1, 'props/physics_candle_1', 0, 0], [0.33, 1, 1, 'props/physics_candle_2', 0, 0], [0.33, 1, 1, 'props/physics_candle_3', 0, 0]]),
    g_scavengers: T([[0.9, 0, 0, '', 0, 0], [0.2, 1, 3, '', 0, 0, { g: ['animals/scavenger_smg', 'animals/scavenger_grenade'] }], [0.1, 1, 1, 'animals/scavenger_leader', 0, 0], [0.1, 1, 1, 'animals/scavenger_clusterbomb', 0, 0], [0.05, 1, 1, 'animals/scavenger_poison', 0, 0]]),
    g_reward_items: T([[0, 0, 0, '', 0, 0], [5, 1, 1, 'items/wand_level_03', 0, 0], [3, 1, 1, 'items/wand_unshuffle_01', 0, 0], [1, 1, 1, 'items/wand_unshuffle_02', 0, 0]]),
  },
  // sandcave(_dump-spawn-tables.mjs sandcave):拾荒者小队(组行带 min/max)、坦克、巫师;g_items 两种高阶法杖
  sandcave: {
    g_small_enemies: T([[0.4, 0, 0, '', 0, 0], [0.1, 1, 2, '', 0, 0, { g: ['animals/scavenger_grenade', 'animals/scavenger_smg'] }], [0.1, 1, 2, '', 0, 0, { g: [{ e: 'animals/scavenger_grenade', min: 1, max: 2 }, { e: 'animals/scavenger_smg', min: 1, max: 2 }, { e: 'animals/scavenger_heal', min: 0, max: 1 }] }], [0.05, 1, 2, 'animals/tank_rocket', 0, 0], [0.2, 1, 1, 'animals/scavenger_clusterbomb', 0, 0], [0.1, 1, 1, 'animals/scavenger_mine', 0, 0], [0.2, 1, 1, 'animals/scavenger_poison', 0, 0], [0.09, 1, 1, 'animals/scavenger_leader', 0, 0], [0.05, 1, 1, 'animals/scavenger_invis', 0, 0], [0.1, 1, 1, 'animals/shotgunner_hell', 0, 0, { ng: 1 }], [0.1, 1, 1, 'animals/sniper_hell', 0, 0, { ng: 2 }]]),
    g_big_enemies: T([[0.3, 0, 0, '', 0, 0], [0.1, 1, 1, '', 0, 0, { g: ['animals/scavenger_leader', { e: 'animals/scavenger_grenade', min: 1, max: 3 }, { e: 'animals/scavenger_smg', min: 1, max: 3 }, { e: 'animals/scavenger_heal', min: 0, max: 1 }] }], [0.1, 1, 1, 'animals/tank', 0, 0], [0.03, 1, 1, 'animals/tank_rocket', 0, 0], [0.01, 1, 1, 'animals/tank_super', 0, 0], [0.05, 1, 1, 'animals/flamer', 0, 0], [0.07, 1, 2, 'animals/wizard_tele', 0, 0], [0.07, 1, 2, 'animals/wizard_dark', 0, 0], [0.07, 1, 2, 'animals/wizard_swapper', 0, 0], [0.02, 1, 1, '', 0, 0, { g: ['animals/scavenger_clusterbomb', { e: 'animals/scavenger_grenade', min: 1, max: 2 }, { e: 'animals/scavenger_smg', min: 1, max: 2 }, { e: 'animals/scavenger_heal', min: 0, max: 1 }] }]]),
    g_unique_enemy: T([[0, 0, 0, '', 0, 0], [1, 1, 1, 'animals/tank', 0, 0], [0.1, 1, 1, 'animals/tank_rocket', 0, 0], [0.02, 1, 1, 'animals/tank_super', 0, 0], [0.1, 1, 1, '', 0, 0, { g: ['animals/tank', 'animals/healerdrone_physics'] }]]),
    g_unique_enemy2: T([[0, 0, 0, '', 0, 0], [0.6, 1, 2, 'animals/scavenger_grenade', 0, 0], [0.6, 1, 2, 'animals/scavenger_smg', 0, 0], [0.5, 1, 1, 'animals/sniper', 0, 0]]),
    g_items: T([[0, 0, 0, '', 0, 0], [5, 1, 1, 'items/wand_level_04', 0, 0], [5, 1, 1, 'items/wand_unshuffle_02', 0, 0]]),
    g_props: T([[0.2, 0, 0, '', 0, 0], [0.5, 1, 1, 'props/physics_seamine', 0, -8]]),
    g_props2: T([[0.3, 0, 0, '', 0, 0], [1, 1, 1, 'props/physics_crate', 0, 0], [0.1, 2, 3, 'props/physics_propane_tank', 0, 0]]),
    g_props3: T([[0.1, 0, 0, '', 0, 0], [0.3, 1, 1, 'props/physics_bottle_green', 0, -5], [0.3, 1, 1, 'props/physics_bottle_red', 0, -5], [0.3, 1, 1, 'props/physics_bottle_blue', 0, -5], [0.2, 1, 1, 'props/physics_bottle_yellow', 0, -5]]),
    g_props4: T([[0.1, 0, 0, '', 0, 0], [0.8, 1, 1, 'props/physics_bed', 0, 5], [0.5, 1, 1, 'props/physics_crate', 0, 0]]),
  },
  // meat(_dump-spawn-tables.mjs meat):地狱版矿工 / 霰弹手 / 狙击手、肉蛆、血晶;easter/sniper 圣诞行、necrobot_super NG+
  meat: {
    g_small_enemies: T([[0.1, 0, 0, '', 0, 0], [0.3, 1, 2, 'animals/shotgunner_hell', 0, 0], [0.3, 1, 2, 'animals/miner_hell', 0, 0], [0.5, 1, 4, 'animals/rat', 0, 0], [0.2, 1, 1, 'animals/sniper_hell', 0, 0], [0.1, 1, 1, 'animals/meatmaggot', 0, 0]]),
    g_big_enemies: T([[0.3, 0, 0, '', 0, 0], [0.05, 1, 1, 'animals/worm_big', 0, 0], [0.01, 1, 1, 'animals/worm', 0, 0], [0.1, 2, 3, 'animals/meatmaggot', 0, 0], [0.2, 1, 1, 'animals/wizard_hearty', 0, 0], [0.1, 1, 1, 'animals/slimespirit', 0, 0], [0.05, 1, 1, 'buildings/hpcrystal', 0, 0], [0.01, 1, 2, 'animals/easter/sniper', 0, 0, { xmas: 1 }], [0.2, 1, 1, 'animals/bloodcrystal_physics', 0, 0], [0.1, 1, 1, 'animals/necrobot', 0, 0], [0.06, 1, 1, 'animals/necrobot_super', 0, 0, { ng: 1 }], [0.1, 1, 1, 'animals/failed_alchemist', 0, 0]]),
    g_unique_enemy: T([[0, 0, 0, '', 0, 0], [0.1, 1, 1, 'animals/wizard_tele', 0, 0], [0.1, 1, 1, 'animals/wizard_dark', 0, 0], [0.07, 1, 1, 'animals/wizard_swapper', 0, 0], [0.1, 1, 1, 'animals/necromancer', 0, 0]]),
    g_unique_enemy2: T([[0, 0, 0, '', 0, 0], [0.5, 3, 4, 'animals/sniper_hell', 0, 0]]),
    g_items: T([[0, 0, 0, '', 0, 0], [5, 1, 1, 'items/wand_level_05', 0, 0], [5, 1, 1, 'items/wand_level_06', 0, 0], [5, 1, 1, 'items/wand_unshuffle_04', 0, 0], [5, 1, 1, 'items/wand_unshuffle_05', 0, 0]]),
    g_props: T([[0.15, 0, 0, '', 0, 0], [0.5, 1, 1, 'props/physics_box_explosive', 0, 0], [0.2, 1, 1, 'props/physics_propane_tank', 0, 0], [0.3, 1, 1, 'props/physics_barrel_oil', 0, 0], [0.05, 1, 1, 'props/physics_trap_electricity_enabled', 0, 0]]),
    g_skulls: T([[1.5, 1, 1, 'props/physics_skull_01', 0, 0], [1.5, 1, 1, 'props/physics_skull_02', 0, 0], [1.5, 1, 1, 'props/physics_skull_03', 0, 0], ...[1, 2, 3, 4, 5, 6].map((i) => [0.5, 1, 1, `props/physics_bone_0${i}`, 0, 0])]),
    g_mouth: T([[0.4, 1, 1, 'buildings/wallmouth', 0, 0], [0.3, 1, 1, 'buildings/walleye', 0, 0], [1.5, 1, 1, '', 0, 0]]),
    g_hanging_props: T([[0.7, 1, 1, '', 0, 0], [0.6, 1, 1, 'props/suspended_cage', 0, 0], [0.6, 1, 1, 'props/suspended_cage_broken', 0, 0], [0.6, 1, 1, 'props/suspended_chain', 0, 0], [0.1, 1, 1, 'props/suspended_seamine', 0, 0]]),
    g_cyst: T([[1, 1, 1, 'props/meat_cyst', 0, 0]]),
  },
  // robobase(_dump-spawn-tables.mjs robobase):基地机器人 / 死灵机器人 / robobase 强化版无人机与坦克;g_vines 是吊线 physics_hanging_wire(道具)
  robobase: {
    g_small_enemies: T([[0.8, 0, 0, '', 0, 0], [0.2, 1, 1, 'animals/roboguard_big', 0, 0], [0.2, 1, 1, 'animals/basebot_sentry', 0, 0], [0.08, 1, 1, 'animals/basebot_hidden', 0, 0], [0.12, 1, 1, 'animals/basebot_neutralizer', 0, 0], [0.12, 1, 1, 'animals/basebot_soldier', 0, 0], [0.2, 1, 2, 'animals/vault/scavenger_glue', 0, 0], [0.1, 1, 1, 'animals/robobase/healerdrone_physics', 0, 0]]),
    g_big_enemies: T([[0.8, 0, 0, '', 0, 0], [0.1, 1, 1, 'animals/robobase/drone_shield', 0, 0], [0.1, 1, 1, 'animals/basebot_hidden', 0, 0], [0.1, 1, 1, 'animals/basebot_neutralizer', 0, 0], [0.1, 1, 1, 'animals/basebot_sentry', 0, 0], [0.1, 1, 1, 'animals/basebot_soldier', 0, 0], [0.2, 1, 1, 'animals/robobase/tank_super', 0, 0], [0.1, 1, 1, 'animals/necrobot', 0, 0], [0.08, 1, 1, 'animals/necrobot_super', 0, 0]]),
    g_items: T([[0, 0, 0, '', 0, 0], [5, 1, 1, 'items/wand_level_05', 0, 0], [5, 1, 1, 'items/wand_level_05_better', 0, 0], [3, 1, 1, 'items/wand_unshuffle_03', 0, 0], [2, 1, 1, 'items/wand_unshuffle_04', 0, 0]]),
    g_props: T([[0.4, 0, 0, '', 0, 0], [0.3, 1, 1, 'props/physics_box_explosive', 0, 0], [0.3, 1, 1, 'props/physics_barrel_radioactive', 0, 0], [0.4, 1, 1, 'props/physics_barrel_oil', 0, 0], [0.1, 1, 1, 'props/physics_pressure_tank', 0, 0], [0.1, 1, 1, 'props/physics_propane_tank', 0, 0], [0.2, 1, 1, 'props/physics_seamine', 0, -8]]),
    g_hanging_props: T([[1, 1, 1, '', 0, 0], [0.2, 1, 1, 'props/suspended_container', 0, 0], [0.5, 1, 1, 'props/suspended_tank_radioactive', 0, 0], [0.6, 1, 1, 'props/suspended_tank_acid', 0, 0], [0.4, 1, 1, 'props/suspended_seamine', 0, 0]]),
    g_turret: T([[0.5, 0, 0, '', 0, 0], [0.1, 1, 1, 'animals/vault/turret_right', 0, 0], [0.1, 1, 1, 'animals/vault/turret_left', 0, 0]]),
    g_vines: T([[0.5, 1, 1, '', 0, 0], [2, 1, 1, 'props/physics_hanging_wire', 0, 0]]),
    g_barricade: T([[1, 1, 1, 'props/physics_box_harmless', 0, 0]]),
    g_lasergate: T([[1, 1, 1, 'buildings/lasergate_down', 0, 0]]), // spawn_lasergate_ver:EntityLoad(x+5, y+3)
  },
  // the_end(_dump-spawn-tables.mjs the_end):地面段(y > −7000)表;animals/the_end/* 强化版(键 the_end_xxx);g_big_enemies 全空
  the_end: {
    g_small_enemies: T([[0.4, 0, 0, '', 0, 0], [0.2, 1, 1, 'animals/the_end/gazer', 0, 0], [0.2, 1, 1, 'animals/the_end/spitmonster', 0, 0], [0.2, 1, 1, 'animals/the_end/bloodcrystal_physics', 0, 0], [0.01, 1, 1, 'animals/the_end/worm_end', 0, 0], [0.004, 1, 1, 'animals/wraith', 0, 0], [0.001, 1, 1, 'animals/wraith_glowing', 0, 0], [0.1, 1, 2, 'animals/thunderskull', 0, 0]]),
    g_big_enemies: T([[0.4, 0, 0, '', 0, 0]]),
    g_items: T([[0, 0, 0, '', 0, 0], [5, 1, 1, 'items/wand_level_04', 0, 0]]),
    g_unique_enemy: T([[0.1, 0, 0, '', 0, 0], [1, 1, 1, 'buildings/arrowtrap_right', 2, 0]]),
    g_candles: T([[0.33, 1, 1, 'props/physics_candle_1', 0, 0], [0.33, 1, 1, 'props/physics_candle_2', 0, 0], [0.33, 1, 1, 'props/physics_candle_3', 0, 0]]),
  },
  // wizardcave(_dump-spawn-tables.mjs wizardcave):全是巫师,大怪表是成对的组行
  wizardcave: (() => {
    const W = ['tele', 'dark', 'poly', 'swapper', 'hearty', 'twitchy', 'neutral', 'returner', 'weaken', 'homing'].map((n) => 'animals/wizard_' + n)
    return {
      g_small_enemies: T([[0.4, 0, 0, '', 0, 0], [0.2, 2, 3, 'animals/firemage', 0, 0], [0.2, 2, 3, 'animals/thundermage', 0, 0], [0.05, 1, 1, 'animals/icemage', 0, 0], [0.1, 1, 1, 'animals/wizard_tele', 0, 0], [0.1, 1, 1, 'animals/wizard_poly', 0, 0], [0.1, 1, 1, 'animals/wizard_dark', 0, 0], [0.1, 1, 1, 'animals/wizard_swapper', 0, 0], [0.1, 1, 1, 'animals/wizard_neutral', 0, 0], [0.1, 2, 3, 'animals/wizard_returner', 0, 0], [0.1, 1, 1, 'animals/wizard_hearty', 0, 0], [0.1, 1, 1, 'animals/wizard_twitchy', 0, 0], [0.1, 1, 1, 'animals/wizard_weaken', 0, 0], [0.1, 1, 1, 'animals/wizard_homing', 0, 0], [0.1, 1, 1, 'animals/barfer', 0, 0], [0.1, 1, 1, 'animals/failed_alchemist', 0, 0]]),
      g_big_enemies: T([[0.4, 0, 0, '', 0, 0], [0.2, 2, 3, 'animals/thundermage', 0, 0], ...W.map((w, i) => [0.1, 1, 1, '', 0, 0, { g: [w, W[(i + 1) % W.length]] }]), [0.02, 1, 1, '', 0, 0, { g: W }]]),
      g_items: T([[0, 0, 0, '', 0, 0], [5, 1, 1, 'items/wand_level_06', 0, 0], [5, 1, 1, 'items/wand_level_06_better', 0, 0], [3, 1, 1, 'items/wand_unshuffle_05', 0, 0], [2, 1, 1, 'items/wand_unshuffle_06', 0, 0]]),
      g_scorpions: T([[0.7, 1, 1, '', 0, 0], [0.3, 1, 1, 'animals/scorpion', 0, 0]]),
      g_props: T([[0.2, 0, 0, '', 0, 0], [0.5, 1, 1, 'props/physics_vase', 0, -4], [0.3, 1, 1, 'props/physics_vase_longleg', 0, -4], [0.1, 1, 1, 'animals/mimic_physics', 0, -4], [0.1, 1, 1, 'props/physics_skull_01', 0, 0], [0.1, 1, 1, 'props/physics_skull_02', 0, 0], [0.1, 1, 1, 'props/physics_skull_03', 0, 0]]),
      g_unique_enemy: T([[0.5, 0, 0, '', 0, 0], [1.5, 1, 1, 'buildings/arrowtrap_right', 2, 0], [0.5, 1, 1, 'buildings/firetrap_right', 2, 0], [0.2, 1, 1, 'buildings/thundertrap_right', 2, 0], [0.2, 1, 1, 'buildings/spittrap_right', 2, 0]]),
      g_large_enemies: T([[0.5, 0, 0, '', 0, 0], [1.5, 1, 1, 'buildings/arrowtrap_left', 1, 0], [0.5, 1, 1, 'buildings/firetrap_left', 1, 0], [0.2, 1, 1, 'buildings/thundertrap_left', 1, 0], [0.2, 1, 1, 'buildings/spittrap_left', 1, 0]]),
      g_ghost_crystal: T([[0.5, 0, 0, '', 0, 0], [1, 1, 1, '', 0, 0, { g: [{ e: 'animals/ghost', min: 1, max: 3 }, 'buildings/ghost_crystal'] }]]),
      g_pressureplates: T([[1, 1, 1, 'props/pressure_plate', 0, 0]]),
      g_scavengers: T([[0.5, 0, 0, '', 0, 0], [0.2, 1, 3, '', 0, 0, { g: ['animals/scavenger_smg', 'animals/scavenger_grenade'] }], [0.1, 1, 1, 'animals/scavenger_leader', 0, 0], [0.1, 1, 1, 'animals/scavenger_clusterbomb', 0, 0], [0.05, 1, 1, 'animals/scavenger_poison', 0, 0]]),
      g_bones: T([[2.4, 1, 1, '', 0, 0], ...[1, 2, 3, 4, 5, 6].map((i) => [0.6, 1, 1, `props/physics_bone_0${i}`, 0, 0])]),
      g_candles: T([[0.33, 1, 1, 'props/physics_candle_1', 0, 0], [0.33, 1, 1, 'props/physics_candle_2', 0, 0], [0.33, 1, 1, 'props/physics_candle_3', 0, 0]]),
    }
  })(),
}

/** random_from_table:NG+ 不够 / 圣诞限定的行连 total 都不算 */
function rollTable(table, prng, ws, x, y, ng) {
  let total = 0
  for (const v of table) if (!v.xmas && v.ng <= ng) total += v.prob
  let r = prng.ProceduralRandom(ws, x, y) * total
  for (const v of table) {
    if (v.xmas || v.ng > ng) continue
    if (r <= v.prob) return v
    r -= v.prob
  }
  return null
}
/**
 * entity_load_camera_bound(v, X, Y, rand_x, rand_y) 逐行:
 *   entities 组:第 j 项 —— 表项 count = PR(X+j, Y, min, max),第 i 只在 (X + PR(X+j, Y+i, ±rx), Y + PR(X+j, Y+i, ±ry));字符串项 1 只在 (X + PR(X+j, Y, ±rx), …)
 *   单实体:how_many = PR(X, Y, min, max),第 i 只在 (X + PR(X+i, Y, ±rx), Y + PR(X+i, Y, ±ry)) + offset
 */
function loadCameraBound(pick, prng, ws, X, Y, rx, ry, func, out) {
  const jit = (ax, ay, r) => (r ? prng.ProceduralRandomi(ws, ax, ay, -r, r) : 0)
  if (pick.group) {
    pick.group.forEach((ev, j0) => {
      const j = j0 + 1
      if (ev.single) { out.push({ entity: ev.e, x: X + jit(X + j, Y, rx), y: Y + jit(X + j, Y, ry), func }); return }
      const count = ev.max === undefined ? ev.min : prng.ProceduralRandomi(ws, X + j, Y, ev.min, ev.max)
      for (let i = 1; i <= count; i++) out.push({ entity: ev.e, x: X + jit(X + j, Y + i, rx) + ev.ox, y: Y + jit(X + j, Y + i, ry) + ev.oy, func })
    })
  }
  if (!pick.entity) return
  const n = prng.ProceduralRandomi(ws, X, Y, pick.min, pick.max)
  for (let i = 1; i <= n; i++) out.push({ entity: pick.entity, x: X + jit(X + i, Y, rx) + pick.ox, y: Y + jit(X + i, Y, ry) + pick.oy, func })
}

/**
 * director_helpers.lua spawn(what, x, y, rand_x, rand_y) 单次掷骰(布景图里的标记像素调用:法杖祭坛 spawn_wands → spawn(g_items, x-5, y, 0, 0))
 * @returns {Array<{entity:string,x:number,y:number}>}
 */
export function rollSpawn(biome, tableName, x, y, ws, rx = 0, ry = 0, ng = 0) {
  const table = SPAWN_TABLES[biome]?.[tableName]
  if (!table) return []
  const prng = new NollaPrng(0)
  const pick = rollTable(table, prng, ws, x, y, ng)
  if (!pick) return []
  const out = []
  loadCameraBound(pick, prng, ws, x + 5, y + 5, rx, ry, tableName, out)
  return out
}
// spawn 函数 → [表名, dx, dy(lua 里 spawn(g, x+dx, y+dy) 的偏移), rand_x, rand_y](rand 缺省 4,spawn_with_limited_random / spawn_props 传 0)
const SPAWN_FUNCS_DEFAULT = {
  spawn_small_enemies: ['g_small_enemies', 0, 0, 4, 4], spawn_big_enemies: ['g_big_enemies', 0, 0, 4, 4],
  spawn_unique_enemy: ['g_unique_enemy', 0, 0, 4, 4], spawn_unique_enemy2: ['g_unique_enemy2', 0, 0, 4, 4], spawn_unique_enemy3: ['g_unique_enemy3', 0, 0, 4, 4],
  spawn_fungi: ['g_fungi', 0, 0, 4, 4], spawn_props: ['g_props', 0, -3, 0, 0], spawn_props2: ['g_props2', 0, -3, 0, 0], spawn_props3: ['g_props3', 0, 0, 0, 0],
  // spawn_candles / spawn_lamp 走 collectLights(光源 + 小图),不在这里再出实体
}
const SPAWN_FUNCS = {
  // coalmine / coalmine_alt 的小怪大怪走 spawn_with_limited_random(g, x, y, 0, 0, …):rand 0
  coalmine: {
    ...SPAWN_FUNCS_DEFAULT, spawn_small_enemies: ['g_small_enemies', 0, 0, 0, 0], spawn_big_enemies: ['g_big_enemies', 0, 0, 0, 0],
    load_structures: ['g_structures', 0, -30, 0, 0], load_large_structures: ['g_large_structures', 0, -30, 0, 0], load_i_structures: ['g_i_structures', 0, -30, 0, 0],
    spawn_nest: ['g_nest', 4, 0, 4, 4],
  },
  coalmine_alt: {
    ...SPAWN_FUNCS_DEFAULT, spawn_small_enemies: ['g_small_enemies', 0, 0, 0, 0], spawn_big_enemies: ['g_big_enemies', 0, 0, 0, 0],
    load_structures: ['g_structures', 0, -30, 0, 0], load_large_structures: ['g_large_structures', 0, -30, 0, 0], spawn_nest: ['g_nest', 4, 0, 4, 4],
  },
  excavationsite: {
    ...SPAWN_FUNCS_DEFAULT,
    spawn_nest: ['g_nest', 4, 8, 0, 0], spawn_hanger: ['g_hanger', 0, 0, 0, 0], spawn_physicsstructure: ['g_physicsstructure', -5, -5, 0, 0],
    spawn_rock: ['g_rock', 0, 0, 4, 4], spawn_hanging_prop: ['g_hanging_props', 0, 0, 4, 4],
    spawn_wheel: ['g_wheel', -5, -5, 0, 0], spawn_wheel_small: ['g_wheel_small', -5, -5, 0, 0], spawn_wheel_tiny: ['g_wheel_tiny', -5, -5, 0, 0], // EntityLoad 直放在 (x,y):抵消 spawn 的 +5
  },
  snowcave: {
    ...SPAWN_FUNCS_DEFAULT,
    spawn_scavenger_party: ['g_scavenger_party', 0, 0, 4, 4], spawn_skulls: ['g_skulls', 0, 0, 0, 0], spawn_stones: ['g_stones', 0, 0, 0, 0], spawn_fish: ['g_fish', 0, 0, 4, 4],
    spawn_burning_barrel: ['g_burning_barrel', -5, -5, 0, 0], spawn_electricity_trap: ['g_electricity_trap', -5, -5, 0, 0],
  },
  snowcastle: {
    ...SPAWN_FUNCS_DEFAULT,
    spawn_turret: ['g_turret', 0, 0, 0, 0], spawn_barricade: ['g_barricade', 0, 0, 0, 0], spawn_forcefield_generator: ['g_forcefield_generator', 0, -2, 0, 0],
    load_furniture: ['g_furniture', 0, 5, 0, 0], load_furniture_bunk: ['g_furniture_bunk', -5, 0, 0, 0], spawn_cook: ['g_cook', -5, -5, 0, 0],
  },
  fungicave: {
    ...SPAWN_FUNCS_DEFAULT,
    spawn_props: ['g_props', 0, 0, 4, 4], spawn_nest: ['g_nest', 0, 0, 4, 4], spawn_robots: ['g_robots', 0, 0, 4, 4], spawn_physics_fungus: ['g_physics_fungi', 0, 0, 4, 4],
  },
  rainforest: {
    ...SPAWN_FUNCS_DEFAULT,
    spawn_unique_enemy: ['g_unique_enemy', 0, 12, 4, 4], spawn_props: ['g_props', 0, 0, 4, 4], spawn_nest: ['g_nest', 0, 0, 4, 4],
    spawn_scavengers: ['g_scavengers', 0, 0, 4, 4], spawn_large_enemies: ['g_large_enemies', 0, 0, 4, 4], spawn_tree: ['g_trees', 5, 5, 4, 4],
  },
  vault: {
    ...SPAWN_FUNCS_DEFAULT,
    spawn_props: ['g_props', 0, 0, 4, 4], spawn_hanging_prop: ['g_hanging_props', 0, 0, 4, 4], spawn_turret: ['g_turret', 0, 0, 0, 0],
    spawn_machines: ['g_machines', 5, 5, 0, 0], spawn_apparatus: ['g_apparatus', -4, -5, 0, 0], spawn_barricade: ['g_barricade', 0, 0, 0, 0], spawn_electricity_trap: ['g_electricity_trap', -5, -5, 0, 0],
  },
  crypt: {
    ...SPAWN_FUNCS_DEFAULT,
    spawn_statues: ['g_statues', -4, 0, 4, 4], spawn_statue_back: ['g_statue_back', 5, 0, 4, 4], spawn_props: ['g_props', -4, -4, 0, 0],
    spawn_unique_enemy: ['g_unique_enemy', -1, 0, 0, 0], spawn_large_enemies: ['g_large_enemies', -1, 0, 0, 0], spawn_ghost_crystal: ['g_ghost_crystal', -1, 0, 0, 0],
    spawn_pressureplates: ['g_pressureplates', 0, 0, 0, 0], spawn_scavengers: ['g_scavengers', 0, 0, 0, 0], spawn_scorpions: ['g_scorpions', 0, 0, 4, 4], spawn_bones: ['g_bones', 0, -12, 4, 4],
  },
  liquidcave: {
    ...SPAWN_FUNCS_DEFAULT,
    spawn_props: ['g_props', 0, 0, 0, 0], spawn_props2: ['g_props2', 0, 0, 0, 0], spawn_statues: ['g_statues', 5, -10, 4, 4], spawn_lasergun: ['g_lasergun', 0, 0, 0, 0],
  },
  wandcave: {
    ...SPAWN_FUNCS_DEFAULT,
    spawn_props: ['g_props', 0, -3, 0, 0], spawn_cloud_trap: ['g_cloud_trap', -5, -10, 4, 4],
  },
  pyramid: {
    ...SPAWN_FUNCS_DEFAULT,
    spawn_statues: ['g_statues', -4, 0, 4, 4], spawn_props: ['g_props', -4, -4, 0, 0], spawn_unique_enemy: ['g_unique_enemy', -1, 0, 0, 0], spawn_large_enemies: ['g_large_enemies', -1, 0, 0, 0],
    spawn_pressureplates: ['g_pressureplates', 0, 0, 0, 0], spawn_scavengers: ['g_scavengers', 0, 0, 0, 0], spawn_scorpions: ['g_scorpions', 0, 0, 4, 4], spawn_reward_wands: ['g_reward_items', 0, 0, 0, 0],
  },
  sandcave: {
    ...SPAWN_FUNCS_DEFAULT,
    spawn_props: ['g_props', 0, -3, 0, 0], spawn_props2: ['g_props2', 0, -3, 0, 0], spawn_props3: ['g_props3', 0, 0, 0, 0], spawn_props4: ['g_props4', 0, 0, 0, 0],
  },
  meat: {
    ...SPAWN_FUNCS_DEFAULT,
    spawn_props: ['g_props', 0, -3, 0, 0], spawn_skulls: ['g_skulls', 0, 0, 0, 0], spawn_mouth: ['g_mouth', 5, 5, 4, 4, 10], spawn_hanging_prop: ['g_hanging_props', 0, 0, 4, 4], spawn_cyst: ['g_cyst', 0, 0, 0, 0],
  },
  robobase: {
    ...SPAWN_FUNCS_DEFAULT,
    spawn_props: ['g_props', 0, 0, 4, 4], spawn_hanging_prop: ['g_hanging_props', 0, 0, 4, 4], spawn_turret: ['g_turret', 0, 0, 0, 0], spawn_barricade: ['g_barricade', 0, 0, 0, 0], spawn_vines: ['g_vines', 5, 5, 4, 4],
    spawn_lasergate_ver: ['g_lasergate', 0, -2, 0, 0],
  },
  the_end: {
    ...SPAWN_FUNCS_DEFAULT,
    spawn_unique_enemy: ['g_unique_enemy', -1, 0, 0, 0],
  },
  wizardcave: {
    ...SPAWN_FUNCS_DEFAULT,
    spawn_props: ['g_props', -4, -4, 0, 0], spawn_unique_enemy: ['g_unique_enemy', -1, 0, 0, 0], spawn_large_enemies: ['g_large_enemies', -1, 0, 0, 0], spawn_ghost_crystal: ['g_ghost_crystal', -1, 0, 0, 0],
    spawn_pressureplates: ['g_pressureplates', 0, 0, 0, 0], spawn_scavengers: ['g_scavengers', 0, 0, 0, 0], spawn_scorpions: ['g_scorpions', 0, 0, 4, 4], spawn_bones: ['g_bones', 0, -12, 4, 4],
  },
}
/**
 * spawn 函数体里 spawn() 之前的门控(返回 false = 这个标记什么都不出):
 *   excavationsite 小怪/大怪:r = PR(x,y) 与 BiomeMapGetVerticalPositionInsideBiome(群系内纵向 0~1)比,越往下越多
 *   snowcave:safe() 入口竖井附近不出;spawn_props 另有 10% 换成雪人布景
 */
function spawnGate(biome, func, x, y, prng, ws, vpos) {
  if (biome === 'excavationsite') {
    if (func === 'spawn_small_enemies') return prng.ProceduralRandom(ws, x, y) <= 2.5 * vpos + 0.35
    if (func === 'spawn_big_enemies') return prng.ProceduralRandom(ws, x, y) <= 2.1 * vpos
  } else if (biome === 'snowcave') {
    if (/^spawn_(small_enemies|big_enemies|unique_enemy2?|scavenger_party|props|acid|burning_barrel)$/.test(func) && !snowcaveSafe(x, y)) return false
    if (func === 'spawn_props') return prng.ProceduralRandom(ws, x - 11.231, y + 10.2157) < 0.9
  } else if (biome === 'snowcastle') {
    if (/^spawn_(small_enemies|big_enemies|unique_enemy2?|turret|props[23]?|forcefield_generator)$/.test(func) && !snowcastleSafe(x, y)) return false
  } else if (biome === 'vault') {
    if (/^spawn_(small_enemies|big_enemies|props|hanging_prop|turret)$/.test(func) && !vaultSafe(x, y)) return false
  } else if (biome === 'meat') {
    if (func === 'spawn_cyst') return prng.ProceduralRandom(ws, x, y) >= 0.3 // meat.lua spawn_cyst:<0.3 不出
  }
  return true
}

/**
 * 实体生成点(director_helpers.lua spawn → random_from_table → entity_load_camera_bound,逐行照抄):
 *   r = ProceduralRandom(x,y)·Σprob 落到哪项;实体位置 (x+5, y+5) 再掷 how_many = ProceduralRandom(X,Y,min,max),
 *   第 i 只在 (X + PR(X+i, Y, -rx, rx), Y + PR(X+i, Y, -ry, ry)) + offset。
 * 只算"哪、什么、几只",实体本体由主线程 Entities 实例化。返回 [{entity, x, y, func}](世界坐标)。
 */
export function collectSpawns(layer, ctx) {
  const out = []
  const funcs = FUNC_BY_COLOR[layer.biome], tables = SPAWN_TABLES[layer.biome], specs = SPAWN_FUNCS[layer.biome]
  if (!funcs || !tables || !specs) return out
  const prng = new NollaPrng(0)
  const ws = ctx.seed + ctx.ng, ng = ctx.ng || 0
  // BiomeMapGetVerticalPositionInsideBiome:该群系区域(群系图包围盒)纵向 0(顶)~1(底)
  const bTop = (layer.bbox[1] - WORLD_CENTER_CHUNK_Y) * CHUNK, bH = (layer.bbox[3] - layer.bbox[1] + 1) * CHUNK
  for (let ty = 0; ty < layer.mapH; ty++) {
    for (let tx = 0; tx < layer.mapW; tx++) {
      const c = wangAt(layer, tx, ty)
      if (c === 0 || c === 0xffffff) continue
      const func = funcs.get(c)
      const spec = func && specs[func]
      const meatBox = layer.biome === 'meat' && func === 'spawn_items'
      if (!spec && func !== 'spawn_heart' && func !== 'spawn_chest' && !meatBox) continue
      const { x: mx, y: my0 } = tileToWorld(layer.minChunkX, layer.minChunkY, tx, ty)
      const ox = ((mx % 512) + 512) % 512, oy = ((my0 % 512) + 512) % 512
      if (ox >= 507 || oy >= 507) continue
      if (ctx.biomeAtWorld && ctx.biomeAtWorld(mx, my0) !== layer.biome) continue
      // meat.lua spawn_items:PR(x−11.631, y+10.2257) 0.3~0.55 → utility_box(<0.3 的祭坛在 collectScenes 里)
      if (meatBox) { const r = prng.ProceduralRandom(ws, mx - 11.631, my0 + 10.2257); if (r >= 0.3 && r < 0.55) out.push({ entity: 'utility_box', x: mx, y: my0, func }); continue }
      // biome_scripts.lua spawn_heart:r > 0.7 心;0.3 < r ≤ 0.7 宝箱(chest_random,1/1000 超级箱先不分);其余空。coalmine spawn_chest 直接宝箱
      if (func === 'spawn_heart' || func === 'spawn_chest') {
        const r = func === 'spawn_chest' ? 0.5 : prng.ProceduralRandom(ws, mx, my0)
        if (r > 0.7) out.push({ entity: 'heart', x: mx, y: my0, func })
        else if (r > 0.3) out.push({ entity: 'chest_random', x: mx, y: my0, func })
        continue
      }
      const table = tables[spec[0]]
      if (!table) continue
      if (!spawnGate(layer.biome, func, mx, my0, prng, ws, (my0 - bTop) / bH)) continue
      let x = mx + spec[1], y = my0 + spec[2]
      // spec[5] = jitter:lua 里 SetRandomSeed(x,y) 后 Random(-j,j) 两次挪位(meat.lua spawn_mouth)
      if (spec[5]) { prng.SetRandomSeed(ws, mx, my0); x += prng.Random(-spec[5], spec[5]); y += prng.Random(-spec[5], spec[5]) }
      const pick = rollTable(table, prng, ws, x, y, ng)
      if (!pick) continue
      loadCameraBound(pick, prng, ws, x + 5, y + 5, spec[3], spec[4], func, out)
    }
  }
  return out
}

/**
 * 藤蔓标记(spawn_vines 0x80ff5a → spawn(g_vines, x+5, y+5)):g_vines 各群系同一张表 [verlet_vine 0.4 → 15 节, long 0.3 → 17, 空 1.5, short 0.5 → 8, shorter 0.5 → 6]
 * (meat 是 meatvine 同权重;robobase 的 g_vines 是吊线道具,走 SPAWN_FUNCS 不在这里)。只算"哪、几节",画法同静态布景的藤(World._collectDecor)。
 * 返回 [{x, y, pts}] 世界坐标(挂点)。
 */
const VINE_TABLE = [[0.4, 15], [0.3, 17], [1.5, 0], [0.5, 8], [0.5, 6]]
const VINE_BIOMES = new Set(['coalmine', 'coalmine_alt', 'excavationsite', 'snowcave', 'snowcastle', 'rainforest', 'vault', 'crypt', 'liquidcave', 'meat', 'wizardcave'])
export function collectVines(layer, ctx) {
  const out = []
  if (!VINE_BIOMES.has(layer.biome)) return out
  const funcs = FUNC_BY_COLOR[layer.biome]
  if (!funcs) return out
  const prng = new NollaPrng(0)
  const ws = ctx.seed + ctx.ng
  const total = VINE_TABLE.reduce((a, p) => a + p[0], 0)
  for (let ty = 0; ty < layer.mapH; ty++) {
    for (let tx = 0; tx < layer.mapW; tx++) {
      const c = wangAt(layer, tx, ty)
      if (c === 0 || c === 0xffffff || funcs.get(c) !== 'spawn_vines') continue
      const { x: mx, y: my0 } = tileToWorld(layer.minChunkX, layer.minChunkY, tx, ty)
      if (ctx.biomeAtWorld && ctx.biomeAtWorld(mx, my0) !== layer.biome) continue
      const x = mx + 5, y = my0 + 5
      // random_from_table:PR(x,y)·total 落到哪行;实体位置再 (X+5, Y+5)
      let r = prng.ProceduralRandom(ws, x, y) * total, pts = 0
      for (const [w, n] of VINE_TABLE) { if (r <= w) { pts = n; break } r -= w }
      if (pts) out.push({ x: x + 5, y: y + 5, pts })
    }
  }
  return out
}

/**
 * 扫描一层 wang 的所有标记像素,产出布景清单。
 * @param {object} layer  generateRegionLayer 的输出
 * @param {{seed:number, ng:number, biomeAtWorld:(x:number,y:number)=>string|null, sceneSize:(dir:string,name:string)=>{w:number,h:number}|null}} ctx
 */
export function collectScenes(layer, ctx) {
  const out = []
  const funcs = FUNC_BY_COLOR[layer.biome]
  if (!funcs) return out
  for (let ty = 0; ty < layer.mapH; ty++) {
    for (let tx = 0; tx < layer.mapW; tx++) {
      const c = wangAt(layer, tx, ty)
      if (c === 0 || c === 0xffffff) continue
      const func = funcs.get(c)
      if (!func) continue
      const { x, y } = tileToWorld(layer.minChunkX, layer.minChunkY, tx, ty)
      // 游戏不在 chunk 负侧边缘 5 px 内触发 spawn
      const ox = ((x % 512) + 512) % 512, oy = ((y % 512) + 512) % 512
      if (ox >= 507 || oy >= 507) continue
      // 标记所在 chunk 的群系必须就是本层群系(边缘噪声抖动这里不做)
      if (ctx.biomeAtWorld && ctx.biomeAtWorld(x, y) !== layer.biome) continue
      const res = spawnScene(ctx, layer.biome, func, x, y)
      if (!res) continue
      for (const sc of Array.isArray(res) ? res : [res]) {
        // 群系检查只看布景左上角(存档实证:seed 1674172626 的 oiltank_2@1425,467 右上角在 mountain_right_stub、
        // coalpit03@-265,857 下半截伸进 temple_altar,游戏照放不误;telescope 的"四角同群系"是过度约束)
        // 背景贴图(LoadBackgroundSprite)不做群系检查
        if (!sc.bgSprite && ctx.biomeAtWorld && ctx.biomeAtWorld(sc.x, sc.y) !== layer.biome) continue
        sc.func = func
        sc.markX = x; sc.markY = y
        out.push(sc)
      }
    }
  }
  return out
}
