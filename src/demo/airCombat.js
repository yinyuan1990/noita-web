/**
 * 森林空战 · Forest Air Combat
 *
 * 基于 forest-demo 的无限分块地图，现统一为星空主题：
 * 地表为无缝星云图切成 8×8 子瓦片按世界坐标拼接（保留逐 tile 分块模式），
 * 旧版 LPC 地面 10 景定义保留在注释中，可随时切回。
 *
 * 素材：
 * - 星空地表：Screaming Brain Studios Seamless Space Backgrounds（CC0）/res/tiles/space/
 * - 地表图集（停用备用）：bluecarrot16 [LPC] Terrains（CC-BY-SA）/res/tiles/lpc_terrain/
 * - 树木图集（停用备用）：bluecarrot16 [LPC] Trees / Conifers（CC-BY-SA）/res/tiles/lpc_trees/ lpc_conifers/
 * - 飞机/子弹：Kenney Pixel Shmup（CC0）/res/shmup/ships/
 * - 爆炸序列帧：elnineo Explosion Tilesets（CC0）/res/shmup/explosions/
 * - 粒子：Kenney Particle Pack（CC0）/res/particles/textures/
 * - Cocos plist 粒子（爆炸增强层）：/res/cocos-particles/，对接文档 docs/cocos-particles-2d.md
 * - 音效：/res/sfx/（CC0）+ elnineo Big Explosion（CC0）
 *
 * 策划要点（借鉴 Claude-Code-Game-Studios 的 GDD 流程）：
 * 1. 四种武器 → 四种截然不同的爆炸语言（重点）
 *    机炮=火花迸溅 / 导弹=火球+烟柱+焦痕 / 集束炸弹=主爆+串联子爆+冲击波 / 电浆=闪电链+电磁环
 * 2. 敌人 AI 状态机：巡逻→警戒→呼叫增援→编队进攻→预判射击→子弹躲避→残血遁入密林（利用地图树木密度）
 * 3. 地面防空营地：复用森林营地生成，茅屋旁架防空炮，炸毁留下永久焦痕
 */
import * as PIXI from 'pixi.js'
import { playCocosEffect, COCOS_EFFECTS } from '../fx/cocosParticles.js'
import { loadSpineEnemies, loadSpineBinary, makeSpineEnemy, spinePlayHit, collectSpineTextures } from '../fx/spineEnemies.js'
import { SkeletonPlayer } from './skeleton_player.js'
import PLAYER_DATA from './player_data.json'

// 竖版设计分辨率（9:16），手机/桌面统一按此渲染再由 CSS 缩放铺满
const W = 1080
const H = 1920
// 触屏 / 移动端判定：降配渲染分辨率、减装饰粒子密度
const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent) || (IS_TOUCH && Math.min(window.innerWidth, window.innerHeight) < 820)
// 装饰性环境粒子密度系数（移动端减负，不影响战斗特效）
const PFX = IS_MOBILE ? 0.5 : 1
// 相机基准缩放：手机竖版拉近镜头（原 0.66 机体太小看不清，×2 放大；世界可视宽度 1080/1.32≈818）
const ZOOM_N = IS_MOBILE ? 1.32 : 0.82
const ZOOM_B = IS_MOBILE ? 1.16 : 0.72
// 诊断浮层：URL 加 ?debug=1 显示 FPS/绘制/精灵/画布尺寸等，用于真机性能排查
const DEBUG = new URLSearchParams(location.search).has('debug')
// 粒子/碎片预算：火力全开时短暂特效会爆到 200+，手机填充率扛不住，超额直接丢弃
const FX_BUDGET = IS_MOBILE ? 120 : 600
const DEBRIS_CAP = IS_MOBILE ? 40 : 110
// Spine 骨骼动画是移动端最大 CPU 开销：同屏封顶，超出回退静态贴图。
// 每关敌种主题集中（骨骼种类少、纹理复用好），故手机上限放宽到 20，让妖魔素材真正露脸。
const SPINE_CAP = IS_MOBILE ? 20 : 999
// 敌机视觉缩放系数（只缩放敌机贴图/骨骼，不动镜头视野）——在 2.5 基础上收到 0.8 倍 = 2.0
const ENEMY_VIEW_MUL = 2.5 * 0.8
const SCALE = 3
const TILE = 32 * SCALE

/** LPC forest_tiles.png 裁切（与 forestDemo.js 同源，保证是"我们的地图"） */
const RECTS = {
  grass: new PIXI.Rectangle(0, 0, 32, 32),
  grassF1: new PIXI.Rectangle(32, 0, 32, 32),
  grassF2: new PIXI.Rectangle(96, 32, 32, 32),
  grassF3: new PIXI.Rectangle(64, 64, 32, 32),
  treeRound: new PIXI.Rectangle(0, 256, 64, 64),
  pine: new PIXI.Rectangle(0, 192, 64, 64),
  pineSmall: new PIXI.Rectangle(320, 32, 32, 64),
  pond: new PIXI.Rectangle(128, 226, 192, 92),
  plantTuft: new PIXI.Rectangle(0, 97, 32, 26),
  plantFern: new PIXI.Rectangle(32, 97, 32, 26),
  plantLeaf: new PIXI.Rectangle(64, 97, 32, 26),
  plantRed: new PIXI.Rectangle(160, 97, 32, 26),
  tuftGreen: new PIXI.Rectangle(416, 64, 32, 32),
  stonesSmall: new PIXI.Rectangle(384, 32, 32, 32),
  stump: new PIXI.Rectangle(192, 96, 32, 32),
  logMoss: new PIXI.Rectangle(224, 96, 64, 32),
  boulder: new PIXI.Rectangle(352, 32, 32, 32),
  mushroom: new PIXI.Rectangle(416, 0, 32, 32),
  redFlower: new PIXI.Rectangle(416, 32, 32, 32),
  hut: new PIXI.Rectangle(448, 64, 64, 64),
  logPile: new PIXI.Rectangle(352, 64, 64, 32),
  cauldron: new PIXI.Rectangle(64, 159, 32, 32),
}

const PROP_TABLE = [
  'treeRound', 'treeRound', 'treeRound',
  'pine', 'pine', 'pine',
  'pineSmall', 'stump', 'boulder', 'logMoss',
  'mushroom', 'redFlower',
]

const WEAPONS = [
  { name: '机炮 VULCAN', desc: '高射速 · 火花迸溅', cd: 0.085, color: 0xffd24a },
  { name: '导弹 MISSILE', desc: '追踪 · 火球爆炸+焦痕', cd: 0.55, color: 0xff8844 },
  { name: '集束炸弹 CLUSTER', desc: '范围 · 主爆+串联子爆', cd: 1.35, color: 0xff5533 },
  { name: '电浆炮 TESLA', desc: '闪电链 · 电磁爆', cd: 0.38, color: 0x66ccff },
  { name: '极光 AURORA', desc: '气功光束 · 贯穿灼烧', cd: 0.72, color: 0x8dffcf },
]

/** 机炮 10 级弹幕表：par 平行弹道数 / fan 扇形对数+张角 / 弹体逐级变大，金→白热→冷光电浆弹 */
const VULCAN_TABLE = [
  { par: 1, fan: 0, ang: 0, scl: 2.2, tint: 0xffd24a, dmg: 1 },
  { par: 2, fan: 0, ang: 0, scl: 2.2, tint: 0xffd24a, dmg: 1 },
  { par: 2, fan: 1, ang: 0.14, scl: 2.5, tint: 0xfff2c0, dmg: 1 },
  { par: 2, fan: 2, ang: 0.15, scl: 2.7, tint: 0xfff2c0, dmg: 1 },
  { par: 3, fan: 2, ang: 0.16, scl: 2.9, tint: 0xd8f4ff, dmg: 2 },
  { par: 3, fan: 3, ang: 0.17, scl: 3.0, tint: 0xd8f4ff, dmg: 2 },
  { par: 4, fan: 3, ang: 0.18, scl: 3.2, tint: 0xaee6ff, dmg: 2 },
  { par: 4, fan: 4, ang: 0.19, scl: 3.4, tint: 0xaee6ff, dmg: 3 },
  { par: 5, fan: 4, ang: 0.2, scl: 3.6, tint: 0x99ddff, dmg: 3 },
  { par: 5, fan: 5, ang: 0.22, scl: 3.8, tint: 0x88d4ff, dmg: 4 },
]

/**
 * 养成/战斗数值（表数据来自 memberlevel.tbl → player_data.json）
 * 手游绝对值是亿级放置曲线，demo 只借骨架：等级曲线 + 档位倍率 + TTK 反推血量。
 * 最终属性映射：生命→maxHp（Lv1=100），攻击→出伤倍率，防御→减伤。
 */
const HP_SCALE = 100 / 15 // 表生命 15 → 局内 100
const TTK_MOB = 0.7 // 小怪目标击杀秒数；其余档位 = 此值 × 倍率
const TIER_RATIO = { chongsi: 0.02, xiaoguai: 1, duizhang: 2, jingying: 7, boss: 30, chaojiboss: 80 }
const TIER_CAP = { chongsi: 1, xiaoguai: 1, duizhang: 1, jingying: 1, boss: 1, chaojiboss: 0.5 }
const E_TIER = {
  drone: 'chongsi', imp: 'chongsi',
  scout: 'xiaoguai', fighter: 'xiaoguai', wingman: 'xiaoguai',
  interceptor: 'xiaoguai', sniper: 'xiaoguai', phantom: 'xiaoguai',
  mender: 'xiaoguai', shielder: 'xiaoguai',
  wolf: 'xiaoguai', foxfire: 'xiaoguai', jiangshi: 'xiaoguai', wsnake: 'xiaoguai',
  bomber: 'duizhang', miner: 'duizhang', artillery: 'duizhang',
  kappa: 'duizhang', serpent: 'duizhang',
  gunship: 'jingying', carrier: 'jingying',
}

/**
 * 关卡敌阵主题（一关一套面貌，10 关循环，把全部编队 + 妖魔敌种铺开轮播）。
 * `formations` = 本关精英波编队池；`horde` = 本关敌潮杂兵敌种。按 (level-1)%10 取。
 */
const LEVEL_THEMES = [
  { name: '试炼空域', formations: ['v3', 'line', 'snake'], horde: ['drone', 'scout'] },
  { name: '狼啸旷野', formations: ['wolfpack', 'foxes', 'pincer'], horde: ['wolf', 'imp'] },
  { name: '狐火迷踪', formations: ['foxes', 'shrine', 'column'], horde: ['foxfire', 'wsnake'] },
  { name: '百鬼夜行', formations: ['shrine', 'ring', 'snake'], horde: ['jiangshi', 'imp'] },
  { name: '蟒渊巨兽', formations: ['serpents', 'battery', 'gunship'], horde: ['kappa', 'serpent'] },
  { name: '钢铁洪流', formations: ['wall', 'carrier', 'wolfpack'], horde: ['wolf', 'imp'] },
  { name: '影袭杀阵', formations: ['snipers', 'ambush', 'foxes'], horde: ['wsnake', 'foxfire'] },
  { name: '疾风拦截', formations: ['interceptors', 'v5', 'serpents'], horde: ['interceptor', 'wolf'] },
  { name: '天罗地网', formations: ['ring', 'shrine', 'wolfpack'], horde: ['jiangshi', 'foxfire'] },
  { name: '万妖来朝', formations: ['carrier', 'wall', 'serpents', 'ambush', 'snake'], horde: ['imp', 'wolf', 'foxfire', 'jiangshi'] },
]

/**
 * 关卡花名册（一关一批 C1863 模型，按关按需加载，10 关铺开约 70 个模型）。
 * `skin` = 本关把 6 个通用敌种原型换成的 C1863 模型（换皮，行为不变，编队系统零改动）；
 * `boss` = 本关 Boss 的 C1863 骨骼模型。开局只加载第 1 关，打完 Boss 关间加载下一关。
 * 其余精英/特种（bomber/carrier/sniper/mender/shielder/phantom/artillery/miner）与 7 种妖魔敌种
 * 保留固定骨骼，随 BASE_ENEMY_MODELS 常驻加载。
 */
const BOSS_NAME = {
  colaboss: '钢罐暴君', horseboss: '夜煞魔驹', fireboss: '炎狱魔主', hellboss: '幽冥判官', waterboss: '沧澜水君',
  ironbss: '铁壁将军', woodboss: '古木妖王', wingboss: '苍穹翼魔', rockboss: '磐岩巨灵', godboss: '神像守卫',
}
const LEVEL_PACKS = [
  { skin: { drone: '1sq', scout: '2fr', fighter: '3chi', wingman: '4ra', interceptor: '5bw', gunship: '6bgg' }, boss: 'colaboss' },
  { skin: { drone: 'jindo_dog', scout: 'black_cat', fighter: 'sam_fox', wingman: 'sam_crow', interceptor: 'fire_fox', gunship: 'haetae' }, boss: 'horseboss' },
  { skin: { drone: 'letter_hawk', scout: 'masco', fighter: 'scarf_monkey', wingman: 'moon_rabbit', interceptor: 'ninetail_fox', gunship: 'kirin' }, boss: 'fireboss' },
  { skin: { drone: '7bdbd', scout: '8bhhh', fighter: 'hojosa', wingman: 'iced', interceptor: 'orochi', gunship: 'legend_bird' }, boss: 'hellboss' },
  { skin: { drone: 'watdr', scout: 'firdr', fighter: 'gdr', wingman: 'wing_dragon', interceptor: 'thundr', gunship: 'tih' }, boss: 'waterboss' },
  { skin: { drone: 'chung2', scout: 'chung3', fighter: 'chung4', wingman: 'hyun3', interceptor: 'hyun4', gunship: 'kma1' }, boss: 'ironbss' },
  { skin: { drone: 'juzak3', scout: 'juzak4', fighter: 'ninja', wingman: 'ninja2', interceptor: 'snakeninja', gunship: 'kma2' }, boss: 'woodboss' },
  { skin: { drone: 'wtiger2', scout: 'wtiger3', fighter: 'wtiger4', wingman: 'birmong', interceptor: 'timong', gunship: 'baekjak' }, boss: 'wingboss' },
  { skin: { drone: 'soldier_0', scout: 'soldier_1', fighter: 'soldier_2', wingman: 'soldier_3', interceptor: 'red_black_soldier_0', gunship: 'red_black_soldier_1' }, boss: 'rockboss' },
  { skin: { drone: 'redok', scout: 'musa', fighter: 'smith', wingman: 'noin', interceptor: 'bmonk', gunship: 'costume1' }, boss: 'godboss' },
]
// 本关花名册要加载的全部模型（6 皮肤 + boss）
function packModels(i) {
  const p = LEVEL_PACKS[((i % LEVEL_PACKS.length) + LEVEL_PACKS.length) % LEVEL_PACKS.length]
  return [...Object.values(p.skin), p.boss]
}
/**
 * Boss 子弹主题：每关 Boss 一套弹色 + 弹幕特效分配（扇/环/瞄准各用哪种序列帧）。
 * 让 14 套 Boss 的弹幕在颜色与形状上都有区分，不再千篇一律。按 defId 取，挂到 boss.bul。
 */
const BOSS_BULLET = {
  1: { tint: 0x9ed48a, fan: 'poison', ring: 'thunder', aim: 'fire' },
  2: { tint: 0xe0b060, fan: 'fire', ring: 'fire', aim: 'arrow' },
  3: { tint: 0x9fd8ff, fan: 'thunder', ring: 'arrow', aim: 'thunder' },
  4: { tint: 0xff6a99, fan: 'poison', ring: 'poison', aim: 'fire' },
  5: { tint: 0xb090ff, fan: 'thunder', ring: 'poison', aim: 'arrow' },
  6: { tint: 0x66e0c0, fan: 'poison', ring: 'thunder', aim: 'fire' },
  7: { tint: 0xffa04a, fan: 'fire', ring: 'poison', aim: 'arrow' },
  8: { tint: 0xff5555, fan: 'fire', ring: 'fire', aim: 'fire' },
  9: { tint: 0xc8a0ff, fan: 'thunder', ring: 'poison', aim: 'thunder' },
  10: { tint: 0xd8d8ff, fan: 'thunder', ring: 'poison', aim: 'arrow' },
  11: { tint: 0x9fd0ff, fan: 'thunder', ring: 'thunder', aim: 'arrow' },
  12: { tint: 0xff9a5a, fan: 'fire', ring: 'fire', aim: 'arrow' },
  13: { tint: 0xb8e078, fan: 'poison', ring: 'poison', aim: 'fire' },
  14: { tint: 0xb090e0, fan: 'thunder', ring: 'poison', aim: 'arrow' },
}
// 常驻加载：C1920 原型（fallback 用）+ 7 种妖魔敌种（多关复用）
const BASE_ENEMY_MODELS = [
  'Alien', 'Bomber', 'Cruiser', 'Cylone', 'DarkEye', 'Bee', 'Phoenix', 'Zombie', 'red_bug', 'Thunder', 'BigBoy', 'God', 'bagonfly',
  'black_wolf', 'fire_fox', 'dokkaebi', 'kappa', 'emugi', 'kangsi', 'white_snake',
]

// ── 小工具 ────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const lerp = (a, b, t) => a + (b - a) * t
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by)
/** 角度插值（走最短弧） */
function turnToward(cur, target, maxStep) {
  let d = target - cur
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return cur + clamp(d, -maxStep, maxStep)
}

// ── canvas 烘焙纹理（冲击波环 / 光球 / 曳光弹） ──────────
function bakeRing() {
  const s = 256
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(s / 2, s / 2, s * 0.28, s / 2, s / 2, s * 0.5)
  grd.addColorStop(0, 'rgba(255,255,255,0)')
  grd.addColorStop(0.6, 'rgba(255,255,255,0)')
  grd.addColorStop(0.74, 'rgba(255,255,255,1)')
  grd.addColorStop(0.84, 'rgba(255,255,255,0.3)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, s, s)
  return PIXI.Texture.from(c)
}
function bakeOrb() {
  const s = 64
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.35, 'rgba(255,255,255,0.85)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, s, s)
  return PIXI.Texture.from(c)
}
function bakeTracer() {
  const c = document.createElement('canvas')
  c.width = 6
  c.height = 22
  const g = c.getContext('2d')
  const grd = g.createLinearGradient(0, 0, 0, 22)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.4, 'rgba(255,255,255,0.95)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.beginPath()
  if (g.roundRect) g.roundRect(0, 0, 6, 22, 3)
  else g.rect(0, 0, 6, 22)
  g.fill()
  return PIXI.Texture.from(c)
}
function bakeMissile() {
  const c = document.createElement('canvas')
  c.width = 10
  c.height = 26
  const g = c.getContext('2d')
  g.fillStyle = '#cdd6e0'
  g.fillRect(3, 2, 4, 18)
  g.fillStyle = '#ff5533'
  g.beginPath()
  g.moveTo(5, 0)
  g.lineTo(9, 6)
  g.lineTo(1, 6)
  g.closePath()
  g.fill()
  g.fillStyle = '#8a95a3'
  g.fillRect(0, 16, 10, 4)
  return PIXI.Texture.from(c)
}
function bakeBomb() {
  const c = document.createElement('canvas')
  c.width = c.height = 18
  const g = c.getContext('2d')
  g.fillStyle = '#38404c'
  g.beginPath()
  g.arc(9, 9, 7, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#ffd24a'
  g.fillRect(7, 2, 4, 3)
  g.strokeStyle = '#1c2129'
  g.lineWidth = 2
  g.beginPath()
  g.arc(9, 9, 7, 0, Math.PI * 2)
  g.stroke()
  return PIXI.Texture.from(c)
}

// ── 资源基址 ────────────────────────────────────────
// 支持部署到子路径（如 https://域名/updatesoft/fj/）：所有运行时 /res 路径统一加
// Vite 注入的 base 前缀。开发时 BASE_URL='/'，构建时取 vite.config 的 base。
const ASSET = (p) => (import.meta.env.BASE_URL || '/') + String(p).replace(/^\//, '')

// ── 音效 ────────────────────────────────────────────
// 战斗音效来自 资源.apk（assets/audio/battle/effect，未加密 MP3），与游戏原版一致
const SFX = {
  impact: '/res/sfx/impact.mp3', // ogg→mp3：iOS 不支持 ogg 解码
  explosion: '/res/sfx/apk/explode_small.mp3', // 敌机爆炸
  big: '/res/sfx/apk/explode_elite.mp3', // 大型机爆炸
  electric: '/res/sfx/electric.mp3',
  fire: '/res/sfx/fire.mp3',
  clash: '/res/sfx/clash.mp3',
  powerup: '/res/sfx/apk/weapon_up.mp3', // 武器升级
  nitro: '/res/sfx/wind.mp3',
  nukeLaunch: '/res/sfx/apk/nuclearLaunch.mp3', // 核弹发射
  bossCome: '/res/sfx/apk/boss_come.mp3', // Boss 登场
  win: '/res/sfx/apk/battle_win.mp3', // 过关
  lose: '/res/sfx/apk/battle_lose.mp3', // 坠机
  baozou: '/res/sfx/apk/baozou.mp3', // 机体进化（暴走）
  shield: '/res/sfx/apk/protective_cover.mp3', // 护盾展开
  // 分类爆炸：apk 实录优先，机炮/极光/高射炮保留合成音（短促高频不适合长采样）
  xVulcan: '/res/sfx/gen/boom_vulcan.wav',
  xFire: '/res/sfx/apk/explode_small.mp3',
  xCluster: '/res/sfx/apk/explode_skill.mp3',
  xTesla: '/res/sfx/apk/thunder_throw.mp3',
  // xAurora 已移除：boom_aurora.wav 合成音刺耳，极光改为无独立音效
  xFlak: '/res/sfx/gen/boom_flak.wav',
  xGround: '/res/sfx/apk/explode_captain.mp3',
  xNuke: '/res/sfx/apk/nuclearExplode.mp3', // 核爆（apk 原版）
  xBossDie: '/res/sfx/apk/explode_boss.mp3',
}
// 音效走 Web Audio（AudioContext + 解码缓冲），而非 <audio> 元素池：
// iOS Safari 对并发媒体元素有硬限制，大量 new Audio() 会抢占并掐断循环 bgm——这是
// “音乐莫名其妙没了”的根因。Web Audio 与单个 bgm 元素互不干扰，且支持无限并发、低延迟。
let actx = null
let sfxMaster = null
const sfxBuf = new Map() // name -> AudioBuffer
const sfxLoading = new Set()
const sfxFailed = new Set() // 解码失败（如 iOS 不支持的 ogg）：记下不再重复拉取
const sfxLast = new Map()
function ensureAudioCtx() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    actx = new AC()
    sfxMaster = actx.createGain()
    sfxMaster.gain.value = 1
    sfxMaster.connect(actx.destination)
  }
  if (actx.state === 'suspended') actx.resume().catch(() => {})
  return actx
}
function loadSfxBuf(name) {
  if (!actx || sfxBuf.has(name) || sfxLoading.has(name) || sfxFailed.has(name) || !SFX[name]) return
  sfxLoading.add(name)
  fetch(ASSET(SFX[name]))
    .then((r) => r.arrayBuffer())
    .then((buf) => new Promise((res, rej) => actx.decodeAudioData(buf, res, rej)))
    .then((ab) => sfxBuf.set(name, ab))
    .catch(() => sfxFailed.add(name)) // 格式不支持/解码失败：静音但不影响音乐
    .finally(() => sfxLoading.delete(name))
}
function preloadAllSfx() {
  if (!ensureAudioCtx()) return
  for (const name of Object.keys(SFX)) loadSfxBuf(name)
}
function playSfx(name, vol = 0.5, rateJitter = 0.15) {
  const now = performance.now()
  if (now - (sfxLast.get(name) || 0) < 50) return // 同音效 50ms 节流
  sfxLast.set(name, now)
  const ctx = ensureAudioCtx()
  if (!ctx) return
  const ab = sfxBuf.get(name)
  if (!ab) { loadSfxBuf(name); return } // 首次触发懒加载，本次略过（解码完成后即可发声）
  const src = ctx.createBufferSource()
  src.buffer = ab
  src.playbackRate.value = 1 + (Math.random() * 2 - 1) * rateJitter
  const g = ctx.createGain()
  g.gain.value = vol
  src.connect(g)
  g.connect(sfxMaster)
  src.start()
}

// ── 背景音乐（apk 原版）：战斗 BGM 三选一循环，Boss 战切 Boss_Room ──
const MUSIC_BATTLE = ['/res/music/battle_bk0.mp3', '/res/music/battle_bk1.mp3', '/res/music/battle_bk2.mp3']
const MUSIC_BOSS = '/res/music/Boss_Room.mp3'
let bgm = null
let bgmSrc = ''
function playMusic(src, vol = 0.3) {
  if (bgmSrc === src) return
  if (bgm) bgm.pause()
  bgm = new Audio(ASSET(src))
  bgmSrc = src
  bgm.loop = true
  bgm.volume = vol
  bgm.play().catch(() => {})
}
function playBattleMusic() {
  playMusic(MUSIC_BATTLE[(Math.random() * MUSIC_BATTLE.length) | 0])
}
function stopMusic() {
  if (bgm) bgm.pause()
  bgmSrc = ''
}
// 浏览器自动播放限制：首次交互时补一次播放
const unlockAudio = () => {
  ensureAudioCtx() // 在用户手势内创建/恢复 AudioContext（iOS 要求）
  preloadAllSfx() // 首次手势后后台解码全部音效缓冲，避免首次发声延迟/静音
  if (bgm && bgm.paused) bgm.play().catch(() => {})
  window.removeEventListener('keydown', unlockAudio)
  window.removeEventListener('pointerdown', unlockAudio)
  window.removeEventListener('touchend', unlockAudio)
}
window.addEventListener('keydown', unlockAudio)
window.addEventListener('pointerdown', unlockAudio)
window.addEventListener('touchend', unlockAudio)
// 切回前台时恢复音频（iOS 息屏/切后台会挂起 AudioContext 并暂停 bgm）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {})
  if (bgm && bgm.paused && bgmSrc) bgm.play().catch(() => {})
})

// ── 加载进度界面 ────────────────────────────────────
// 资源在进入战场前全部预载完毕（main 全程 await）；这里驱动可视化进度条，
// 让玩家在加载期看到进度而非白屏，手机首屏体验也更稳。
let _assetsDone = 0
const _loadUI = {
  bar: null, pct: null, box: null,
  init() {
    this.bar = document.getElementById('load-bar')
    this.pct = document.getElementById('load-pct')
    this.box = document.getElementById('loading')
  },
  // 无法预知精确总数，用平滑函数逼近 92%，全部就绪后再补满
  tick() {
    if (!this.bar) return
    const p = Math.min(92, 100 * (1 - Math.pow(0.972, _assetsDone)))
    this.bar.style.width = p.toFixed(0) + '%'
    if (this.pct) this.pct.textContent = p.toFixed(0) + '%'
  },
  done() {
    if (this.bar) this.bar.style.width = '100%'
    if (this.pct) this.pct.textContent = '100%'
    if (this.box) {
      this.box.style.transition = 'opacity .45s'
      this.box.style.opacity = '0'
      setTimeout(() => this.box && (this.box.style.display = 'none'), 480)
    }
  },
}

main()

async function main() {
  const host = document.getElementById('host')
  _loadUI.init()
  PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST

  const app = new PIXI.Application({
    width: W,
    height: H,
    backgroundColor: 0x05070b,
    antialias: false,
    // 手机固定 1x（iPhone DPR=3 时后台缓冲 1620×2880→1080×1920，填充率砍半以上），桌面 2x
    resolution: IS_MOBILE ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    powerPreference: 'high-performance',
  })
  host.appendChild(app.view)
  app.view.style.width = '100%'
  app.view.style.height = '100%'
  app.view.style.imageRendering = 'pixelated'

  // ── 资源加载 ──────────────────────────────────────
  function loadBase(url, scaleMode = PIXI.SCALE_MODES.NEAREST) {
    const b = PIXI.BaseTexture.from(ASSET(url), { scaleMode })
    return new Promise((resolve) => {
      const fin = (v) => { _assetsDone++; _loadUI.tick(); resolve(v) }
      if (b.valid) return fin(b)
      b.once('loaded', () => fin(b))
      b.once('error', () => fin(b))
    })
  }
  const [tilesBase, terrainBase, treesGreenB, treesDeadB, treesOrangeB, treesPaleB, conifersB, expFireB, expFlakB, expBigB, spaceBase] = await Promise.all([
    loadBase('/res/tiles/lpc_forest/forest_tiles.png'),
    loadBase('/res/tiles/lpc_terrain/terrain-v7.png'),
    loadBase('/res/tiles/lpc_trees/trees-green.png'),
    loadBase('/res/tiles/lpc_trees/trees-dead.png'),
    loadBase('/res/tiles/lpc_trees/trees-orange.png'),
    loadBase('/res/tiles/lpc_trees/trees-pale.png'),
    loadBase('/res/tiles/lpc_conifers/conifers.png'),
    loadBase('/res/shmup/explosions/explosion_fire_8x8_256.png', PIXI.SCALE_MODES.LINEAR),
    loadBase('/res/shmup/explosions/explosion_flak_8x8_256.png', PIXI.SCALE_MODES.LINEAR),
    loadBase('/res/shmup/explosions/explosion_big_8x8_256.png', PIXI.SCALE_MODES.LINEAR),
    loadBase('/res/tiles/space/nebula_purple1.png', PIXI.SCALE_MODES.LINEAR),
  ])
  // 星空地面：一个区块（8×8 tile）正好铺一整张 512 无缝星云图，
  // 直接整图单精灵（等价于 64 子瓦片拼接但精灵数 1/64，消除跨区块生成的周期卡顿）
  const SPACE_FULL = new PIXI.Texture(spaceBase)
  // 行星/恒星装饰（SBS 2D Planet Pack 2，CC0）——打散星云平铺的重复感
  const PLANET_TEX = []
  const SUN_TEX = []
  await Promise.all([
    ...Array.from({ length: 14 }, (_, i) =>
      loadBase(`/res/tiles/space/planets/planet${String(i + 1).padStart(2, '0')}.png`, PIXI.SCALE_MODES.LINEAR)
        .then((b) => { PLANET_TEX[i] = new PIXI.Texture(b) })),
    ...Array.from({ length: 2 }, (_, i) =>
      loadBase(`/res/tiles/space/planets/sun0${i + 1}.png`, PIXI.SCALE_MODES.LINEAR)
        .then((b) => { SUN_TEX[i] = new PIXI.Texture(b) })),
  ])
  const shipTex = []
  for (let i = 0; i < 8; i++) {
    const b = await loadBase(`/res/shmup/ships/ship_000${i}.png`)
    shipTex.push(new PIXI.Texture(b))
  }
  // 水系挂载贴图（AI 生成素材，机头朝上；高清图用线性采样，缩小不糊颗粒）
  const waterPodTex = new PIXI.Texture(await loadBase('/res/shmup/water_pod.png', PIXI.SCALE_MODES.LINEAR))

  // ── 玩家战机 = 风暴雷神（DragonBones 骨骼），僚机挂载 = L_15（CocoStudio） ──
  // 为不牺牲移动端帧率：加载时把动画“预烘焙”成序列帧纹理，运行时只切帧（零逐帧骨骼渲染）。
  // putong=常态（火力未满级），BaoZou=爆走（火力全开）。
  const HERO = { on: false, fps: 24, putong: [], baozou: [], w: 0, h: 0 }
  const WING = { on: false, fps: 24, normal: [], baozou: [], w: 0, h: 0 }
  function bakeSkeleton(sp, name, cell) {
    sp.setAnimation(name)
    const a = sp.m.anims[name]
    const dur = Math.max(1, Math.round(sp.m.type === 'cs' ? a.dr : a.dur))
    const out = []
    for (let i = 0; i < dur; i++) {
      sp.render(i / sp.fps)
      const c = document.createElement('canvas')
      c.width = cell
      c.height = cell
      c.getContext('2d').drawImage(sp.canvas, 0, 0)
      const tx = PIXI.Texture.from(c)
      tx.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR
      out.push(tx)
    }
    return out
  }
  try {
    const MODELS = await fetch(ASSET('/res/skeleton_models.json')).then((r) => r.json())
    const HCELL = IS_MOBILE ? 200 : 256
    const hsp = new SkeletonPlayer(MODELS.fengbaoleishen, { width: HCELL, height: HCELL, fps: HERO.fps, scale: HCELL / 560, bloom: false })
    await hsp.load()
    HERO.putong = bakeSkeleton(hsp, 'putong', HCELL)
    HERO.baozou = bakeSkeleton(hsp, 'BaoZou', HCELL)
    HERO.w = HCELL
    HERO.h = HCELL
    HERO.on = HERO.putong.length > 0
    HERO.disp = 230 / HCELL // 机身目标屏幕高度 ≈230px（设计分辨率 1080 下约 21% 宽）
    const WCELL = IS_MOBILE ? 140 : 180
    const wsp = new SkeletonPlayer(MODELS.guazai_L15, { width: WCELL, height: WCELL, fps: WING.fps, scale: WCELL / 320, bloom: false })
    await wsp.load()
    WING.normal = bakeSkeleton(wsp, 'Normal', WCELL)
    WING.baozou = bakeSkeleton(wsp, 'BaoZou', WCELL)
    WING.w = WCELL
    WING.h = WCELL
    WING.on = WING.normal.length > 0
    WING.disp = 124 / WCELL
  } catch (e) {
    console.warn('[hero] skeleton load/bake failed, keep default plane', e)
  }
  // Spine 骨骼预热：实例化一次离屏渲染（触发纹理上传 + 包围盒缓存），消除首次出场卡顿
  function warmSpine(names) {
    const warm = new PIXI.Container()
    warm.x = -99999
    app.stage.addChild(warm)
    for (const n of names) {
      const sp = makeSpineEnemy(n, 90)
      if (sp) warm.addChild(sp)
    }
    app.renderer.render(app.stage)
    setTimeout(() => {
      app.stage.removeChild(warm)
      warm.destroy({ children: true })
    }, 200)
  }
  // 开局只加载「常驻原型 + 第 1 关花名册」，其余关卡打完 Boss 后关间按需加载（见 loadChapterAssets）
  try {
    const first = [...BASE_ENEMY_MODELS, ...packModels(0)]
    await loadSpineEnemies(first)
    warmSpine(first)
  } catch (e) {
    console.warn('[spine] enemies load failed, fallback to sprites', e)
  }
  // 飞行子弹特效序列帧（B044，素材朝左飞）——火球/电球/能量箭
  const BULLET_FX = {}
  for (const [k, n] of [['fire', 5], ['thunder', 5], ['poison', 5], ['arrow', 3]]) {
    const arr = []
    for (let i = 0; i < n; i++) {
      const b = await loadBase(`/res/bullets-fx/${k}/00${i}.png`, PIXI.SCALE_MODES.LINEAR)
      arr.push(new PIXI.Texture(b))
    }
    BULLET_FX[k] = arr
  }
  const P_TEX = {}
  const particleFiles = {
    smoke: 'smoke_05',
    smoke2: 'smoke_08',
    flame: 'flame_02',
    spark: 'spark_04',
    light: 'light_01',
    dirt: 'dirt_02',
    muzzle: 'muzzle_01',
    twirl: 'twirl_02',
    scorch1: 'scorch_01',
    scorch2: 'scorch_02',
    scorch3: 'scorch_03',
  }
  await Promise.all(
    Object.entries(particleFiles).map(async ([k, f]) => {
      const b = await loadBase(`/res/particles/textures/${f}.png`, PIXI.SCALE_MODES.LINEAR)
      P_TEX[k] = new PIXI.Texture(b)
    })
  )
  const tex = {}
  for (const k of Object.keys(RECTS)) tex[k] = new PIXI.Texture(tilesBase, RECTS[k])

  // ── 多套 tileset ──────────────────────────────────
  // terrain-v7.png：32 列 × 32px 网格，瓦片 id → 裁切坐标（id 来自官方 .tsx 元数据）
  const tTexCache = new Map()
  function tTex(id) {
    let t = tTexCache.get(id)
    if (!t) {
      t = new PIXI.Texture(terrainBase, new PIXI.Rectangle((id % 32) * 32, ((id / 32) | 0) * 32, 32, 32))
      tTexCache.set(id, t)
    }
    return t
  }
  const crop = (base, x, y, w, h) => new PIXI.Texture(base, new PIXI.Rectangle(x, y, w, h))
  /** 树木立牌定义：碰撞半径随视觉宽度走（树干占比约 1/9） */
  const mkTree = (base, x, y, w, h, s) => ({ tex: crop(base, x, y, w, h), s, r: Math.max(10, Math.round(w * s * 0.11)), tall: true })
  const TR = {
    // 枯树（trees-dead，沙漠/熔岩/废墟/风暴）
    dead1: mkTree(treesDeadB, 66, 243, 86, 107, 1.8),
    dead2: mkTree(treesDeadB, 165, 232, 82, 120, 1.8),
    dead3: mkTree(treesDeadB, 268, 233, 101, 119, 1.8),
    dead4: mkTree(treesDeadB, 384, 229, 93, 122, 1.8),
    dead5: mkTree(treesDeadB, 480, 225, 96, 125, 1.8),
    dead6: mkTree(treesDeadB, 576, 227, 123, 124, 1.7),
    dead7: mkTree(treesDeadB, 713, 241, 108, 111, 1.7),
    deadPoplar: mkTree(treesDeadB, 67, 353, 61, 150, 1.7),
    deadBig: mkTree(treesDeadB, 880, 369, 127, 142, 1.6),
    // 大绿树（trees-green，沼泽/暗夜密林）
    bigOakG: mkTree(treesGreenB, 301, 512, 165, 188, 1.5),
    denseOakG: mkTree(treesGreenB, 672, 515, 160, 189, 1.5),
    oakG: mkTree(treesGreenB, 321, 352, 93, 159, 1.6),
    willowG: mkTree(treesGreenB, 864, 354, 160, 156, 1.5),
    // 秋树（trees-orange，峡谷）
    oakO: mkTree(treesOrangeB, 321, 352, 93, 159, 1.6),
    spreadyO: mkTree(treesOrangeB, 681, 354, 172, 158, 1.5),
    domeO: mkTree(treesOrangeB, 224, 368, 94, 80, 1.9),
    // 淡绿树（trees-pale，海岸）
    spreadyP: mkTree(treesPaleB, 681, 354, 172, 158, 1.5),
    willowP: mkTree(treesPaleB, 864, 354, 160, 156, 1.5),
    domeP: mkTree(treesPaleB, 224, 368, 94, 80, 1.9),
    lollyP: mkTree(treesPaleB, 129, 352, 94, 137, 1.6),
    // 针叶树（conifers 上半绿色 / 下半积雪，y+224 对称）
    pineTallG: mkTree(conifersB, 389, 1, 84, 213, 1.6),
    pineMidG: mkTree(conifersB, 487, 2, 74, 158, 1.7),
    pineBigG: mkTree(conifersB, 641, 2, 127, 215, 1.5),
    snowTall: mkTree(conifersB, 389, 225, 84, 213, 1.6),
    snowMid: mkTree(conifersB, 487, 226, 74, 158, 1.7),
    snowSmall: mkTree(conifersB, 580, 235, 56, 78, 2.1),
    snowBig: mkTree(conifersB, 641, 226, 127, 215, 1.5),
  }

  /** 爆炸图集 → 64 帧序列 */
  function sliceAtlas(baseTexture) {
    const fw = baseTexture.width / 8
    const frames = []
    for (let j = 0; j < 8; j++)
      for (let i = 0; i < 8; i++)
        frames.push(new PIXI.Texture(baseTexture, new PIXI.Rectangle(i * fw, j * fw, fw, fw)))
    return frames
  }
  const EXP_FIRE = sliceAtlas(expFireB)
  const EXP_FLAK = sliceAtlas(expFlakB)
  const EXP_BIG = sliceAtlas(expBigB)

  const ringTex = bakeRing()
  const orbTex = bakeOrb()
  const tracerTex = bakeTracer()
  const missileTex = bakeMissile()
  const bombTex = bakeBomb()

  // ── 世界与图层 ────────────────────────────────────
  const world = new PIXI.Container()
  app.stage.addChild(world)
  const groundC = new PIXI.Container() // 草地分块
  const decalC = new PIXI.Container() // 焦痕（爆炸永久痕迹）
  const propC = new PIXI.Container() // 树木立牌（y 排序）
  propC.sortableChildren = true
  const gunC = new PIXI.Container() // 地面防空炮
  const shadowC = new PIXI.Container() // 飞机影子（投在树冠/地面上）
  const bulletC = new PIXI.Container()
  const planeC = new PIXI.Container()
  const fxC = new PIXI.Container() // 烟雾/尘土（在火光之下）
  const fxTop = new PIXI.Container() // 火球/冲击环/火花/闪电（最上层）
  world.addChild(groundC, decalC, propC, gunC, shadowC, bulletC, planeC, fxC, fxTop)

  // 屏幕空间层：闪光 / 波次标题 / 敌机指示
  const flashG = new PIXI.Graphics()
  flashG.beginFill(0xfff2d8, 1)
  flashG.drawRect(0, 0, W, H)
  flashG.endFill()
  flashG.alpha = 0
  // 场景氛围罩层（在指示箭头之下、世界之上）：
  // sceneOverlay = 普通混合的压暗色罩；sceneGlow = 加法混合的大气提亮层（雪原/沙漠等浅色景必需）
  const sceneOverlay = new PIXI.Graphics()
  const sceneGlow = new PIXI.Graphics()
  sceneGlow.blendMode = PIXI.BLEND_MODES.ADD
  const indicatorC = new PIXI.Container()
  const titleC = new PIXI.Container()
  app.stage.addChild(sceneOverlay, sceneGlow, indicatorC, flashG, titleC)

  // ── 相机 ─────────────────────────────────────────
  const cam = { cx: 0, cy: 0, zoom: ZOOM_N }
  let shake = 0
  function applyCamera() {
    world.scale.set(cam.zoom)
    world.pivot.set(cam.cx, cam.cy)
    const sx = shake > 0.2 ? (Math.random() * 2 - 1) * shake : 0
    const sy = shake > 0.2 ? (Math.random() * 2 - 1) * shake : 0
    world.position.set(W / 2 + sx, H / 2 + sy)
  }

  // ── 无限森林地图（与 forestDemo 同一套分块逻辑） ──────
  const CHUNK = TILE * 8
  const chunks = new Map()
  const allProps = []
  const aaGuns = []
  const destroyedCamps = new Set() // 被炸毁的营地（区块重生成时不复活）
  const PROP_R = { treeRound: 19, pine: 15, pineSmall: 12, stump: 16, boulder: 22, logMoss: 28, hut: 56, logPile: 28, cauldron: 15, mushroom: 0, redFlower: 0 }

  // ── 场景系统：统一星空主题（Screaming Brain Studios 无缝星云，CC0）──
  // 保留分块 tile 地图模式（爆炸焦痕/逐块生成不变），地表换成星空子瓦片拼接
  // tiles.space = true 时 genChunk 按世界坐标取 SPACE_TILES 子瓦片
  const SCENES = [
    { name: '浩瀚星空', ambient: 'sparkle', overlay: 0x000000, oAlpha: 0, glow: 0, gAlpha: 0, tiles: {
      space: true, ground: [], pond: null, decals: [], props: [], propN: [0, 0],
    } },
  ]
  /* 旧地面 10 景（LPC 地形）已停用，保留定义以便随时切回：
  const P_WATER = { tl: 515, t: 516, tr: 517, l: 547, c: [548, 566, 569, 572, 611, 612, 613], r: 549, bl: 579, b: 580, br: 581 }
  const P_SWAMP = { tl: 524, t: 525, tr: 526, l: 556, c: [557, 620, 621, 622], r: 558, bl: 588, b: 589, br: 590 }
  const P_LAVA = { tl: 527, t: 528, tr: 529, l: 559, c: [560, 623, 624, 625], r: 561, bl: 591, b: 592, br: 593 }
  const SCENES_GROUND = [
    { name: '翠绿林海', ambient: null, overlay: 0x000000, oAlpha: 0, glow: 0, gAlpha: 0, tiles: {
      ground: [[tex.grass, 82], [tex.grassF1, 6], [tex.grassF2, 6], [tex.grassF3, 6]],
      pond: { chance: 0.1 },
      decals: [tex.plantTuft, tex.plantTuft, tex.plantFern, tex.plantLeaf, tex.plantRed, tex.tuftGreen, tex.stonesSmall],
      props: null, propN: [2, 3],
    } },
    { name: '金色沙漠', ambient: 'sand', overlay: 0x3a2408, oAlpha: 0.08, glow: 0x8a5c18, gAlpha: 0.22, tiles: {
      ground: [[336, 76], [399, 8], [400, 8], [401, 8]],
      patch: { tiles: [[784, 60], [847, 20], [848, 20]], pct: 10 },
      pond: { chance: 0.06, P: P_WATER, w: [3, 4], h: [3, 3] },
      decals: [tex.stonesSmall],
      props: [[TR.dead2, 3], [TR.dead4, 3], [TR.dead7, 2], ['boulder', 2], [TR.deadPoplar, 1]],
      propN: [1, 2],
    } },
    { name: '寒霜苔原', ambient: 'snow', overlay: 0x0a1420, oAlpha: 0.1, glow: 0x3a4a5e, gAlpha: 0.12, tiles: {
      // 深色冻土为主，积雪只做小块斑驳（整片雪地太白，弹幕可读性差）
      ground: [[330, 56], [393, 10], [394, 10], [395, 8], [345, 10], [408, 3], [409, 3]],
      patch: { tiles: [[342, 60], [405, 14], [406, 13], [407, 13]], pct: 14 },
      pond: { chance: 0.16, P: P_WATER, w: [4, 6], h: [3, 4] },
      decals: [tex.stonesSmall],
      props: [[TR.snowTall, 3], [TR.snowMid, 3], [TR.snowBig, 2], [TR.snowSmall, 2], ['boulder', 1]],
      propN: [2, 3],
    } },
    { name: '幽暗沼泽', ambient: 'firefly', overlay: 0x42523a, oAlpha: 0.24, glow: 0, gAlpha: 0, tiles: {
      ground: [[124, 64], [187, 12], [188, 12], [189, 12]],
      patch: { tiles: [[327, 70], [390, 10], [391, 10], [392, 10]], pct: 40 },
      pond: { chance: 0.3, P: P_SWAMP, w: [3, 6], h: [3, 4] },
      decals: [tex.plantFern, tex.plantLeaf, tex.plantTuft],
      props: [[TR.willowG, 3], [TR.dead3, 2], [TR.dead5, 2], [TR.oakG, 1], ['mushroom', 1]],
      propN: [3, 3],
    } },
    { name: '熔岩火山', ambient: 'ember', overlay: 0x3a0f00, oAlpha: 0.18, glow: 0x881a00, gAlpha: 0.16, tiles: {
      ground: [[112, 64], [175, 12], [176, 12], [177, 6]],
      patch: { tiles: [[784, 60], [847, 14], [848, 14], [849, 12]], pct: 22 },
      pond: { chance: 0.24, P: P_LAVA, w: [3, 5], h: [3, 4] },
      decals: [tex.stonesSmall],
      props: [[TR.dead1, 3], [TR.dead5, 2], [TR.dead6, 2], ['boulder', 2]],
      propN: [1, 2], propTint: 0xb08878,
    } },
    { name: '蔚蓝海岸', ambient: 'sparkle', overlay: 0x003a4a, oAlpha: 0.08, glow: 0x1a6070, gAlpha: 0.2, tiles: {
      ground: [[336, 76], [399, 8], [400, 8], [401, 8]],
      pond: { chance: 0.42, P: P_WATER, w: [5, 8], h: [3, 5] },
      decals: [tex.stonesSmall, tex.plantLeaf],
      props: [[TR.spreadyP, 3], [TR.willowP, 2], [TR.domeP, 2], [TR.lollyP, 1]],
      propN: [2, 2],
    } },
    { name: '暗夜密林', ambient: 'firefly', overlay: 0x101a3a, oAlpha: 0.34, glow: 0, gAlpha: 0, tiles: {
      ground: [[327, 76], [390, 8], [391, 8], [392, 8]],
      pond: { chance: 0.08, P: P_WATER, w: [3, 4], h: [3, 3] },
      decals: [tex.plantTuft, tex.plantFern],
      props: [[TR.pineTallG, 3], [TR.pineBigG, 2], [TR.bigOakG, 2], [TR.denseOakG, 2], [TR.pineMidG, 2]],
      propN: [4, 3], propTint: 0x9fb2d8,
    } },
    { name: '废墟都市', ambient: 'ash', overlay: 0x50505a, oAlpha: 0.18, glow: 0x2c2c33, gAlpha: 0.1, tiles: {
      ground: [[345, 64], [408, 18], [409, 18]],
      patch: { tiles: [[790, 60], [853, 14], [854, 13], [855, 13]], pct: 32 },
      pond: { chance: 0.05, P: P_WATER, w: [3, 3], h: [3, 3] },
      decals: [tex.stonesSmall],
      props: [[TR.dead1, 2], [TR.dead7, 2], ['boulder', 2], [TR.deadPoplar, 1], ['logMoss', 1]],
      propN: [1, 2], propTint: 0xb4b4b8,
    } },
    { name: '峡谷天堑', ambient: 'sand', overlay: 0x3a2410, oAlpha: 0.14, glow: 0x5c3812, gAlpha: 0.16, tiles: {
      ground: [[97, 64], [160, 14], [161, 14], [162, 8]],
      patch: { tiles: [[796, 64], [859, 12], [860, 12], [861, 12]], pct: 16 },
      pond: null,
      decals: [tex.stonesSmall],
      props: [[TR.oakO, 3], [TR.spreadyO, 2], [TR.domeO, 2], ['boulder', 2]],
      propN: [2, 2],
    } },
    { name: '风暴天穹', ambient: 'rain', overlay: 0x181f30, oAlpha: 0.36, glow: 0, gAlpha: 0, lightning: true, tiles: {
      ground: [[330, 64], [393, 10], [394, 10], [395, 8], [427, 8]],
      patch: { tiles: [[124, 64], [187, 12], [188, 12], [189, 12]], pct: 12 },
      pond: { chance: 0.12, P: P_WATER, w: [3, 5], h: [3, 3] },
      decals: [tex.plantTuft],
      props: [[TR.dead4, 2], [TR.dead6, 2], [TR.deadBig, 2], [TR.deadPoplar, 1]],
      propN: [2, 2], propTint: 0xa8b0c0,
    } },
  ]
  */
  let sceneIdx = 0
  shadowC.visible = !SCENES[0].tiles.space

  /** 地表瓦片选取：hc（2×2 粗哈希）决定主地形还是补丁地形（聚块不噪点），hf（细哈希）选变体 */
  function tilePick(arr, h) {
    if (!arr.__tot) {
      let t = 0
      for (const g of arr) t += g[1]
      arr.__tot = t
    }
    let v = h % arr.__tot
    for (const g of arr) {
      v -= g[1]
      if (v < 0) return typeof g[0] === 'number' ? tTex(g[0]) : g[0]
    }
    return typeof arr[0][0] === 'number' ? tTex(arr[0][0]) : arr[0][0]
  }
  function groundPick(theme, hf, hc) {
    const p = theme.patch
    return tilePick(p && hc % 100 < p.pct ? p.tiles : theme.ground, hf)
  }

  function pickW(rng, arr) {
    let tot = 0
    for (const e of arr) tot += e[1]
    let v = rng() * tot
    for (const e of arr) {
      v -= e[1]
      if (v < 0) return e[0]
    }
    return arr[0][0]
  }

  /** 九宫格水面/熔岩：LPC terrain 过渡瓦片拼 tw×th 块（边缘 alpha 过渡叠在地表上） */
  function buildPond(P, tw, th, rng) {
    const c = new PIXI.Container()
    for (let j = 0; j < th; j++) {
      for (let i = 0; i < tw; i++) {
        const top = j === 0
        const bot = j === th - 1
        const lef = i === 0
        const rig = i === tw - 1
        let id
        if (top && lef) id = P.tl
        else if (top && rig) id = P.tr
        else if (bot && lef) id = P.bl
        else if (bot && rig) id = P.br
        else if (top) id = P.t
        else if (bot) id = P.b
        else if (lef) id = P.l
        else if (rig) id = P.r
        else id = P.c[(rng() * P.c.length) | 0]
        const s = new PIXI.Sprite(tTex(id))
        s.x = i * 32
        s.y = j * 32
        c.addChild(s)
      }
    }
    c.scale.set(SCALE)
    return c
  }

  function setScene(i) {
    sceneIdx = ((i % SCENES.length) + SCENES.length) % SCENES.length
    const s = SCENES[sceneIdx]
    // 真·换地图：丢弃全部地块，按新 tileset 立即重生成（区块种子不变，同景布局稳定）
    for (const key of [...chunks.keys()]) dropChunk(key)
    updateChunks()
    shadowC.visible = !s.tiles.space // 太空没有投影面，隐藏飞机影子
    sceneOverlay.clear()
    if (s.oAlpha > 0) {
      sceneOverlay.beginFill(s.overlay, s.oAlpha)
      sceneOverlay.drawRect(0, 0, W, H)
      sceneOverlay.endFill()
    }
    sceneGlow.clear()
    if (s.gAlpha > 0) {
      sceneGlow.beginFill(s.glow, s.gAlpha)
      sceneGlow.drawRect(0, 0, W, H)
      sceneGlow.endFill()
    }
  }

  // ── 流星：不定期划过背景的高速光痕（头部光点 + 拉长尾迹，在 decal 层不遮挡飞机） ──
  const meteors = []
  let meteorT = 2
  function spawnMeteor() {
    const hw = W / cam.zoom * 0.75
    const hh = H / cam.zoom * 0.75
    const ang = Math.PI / 2 + (Math.random() < 0.5 ? 1 : -1) * (0.3 + Math.random() * 0.35)
    const spd = 1500 + Math.random() * 800
    const vx = Math.cos(ang) * spd
    const vy = Math.sin(ang) * spd
    // 从上方入场，横向偏向速度反方向，保证划过可视区
    const x = cam.cx - Math.sign(vx) * hw * (0.2 + Math.random() * 0.8)
    const y = cam.cy - hh - 100
    const tint = Math.random() < 0.3 ? 0xaed4ff : 0xfff4d8
    const head = new PIXI.Sprite(P_TEX.light)
    head.anchor.set(0.5)
    head.blendMode = PIXI.BLEND_MODES.ADD
    head.scale.set(0.1 + Math.random() * 0.06)
    head.tint = tint
    const tail = new PIXI.Sprite(tracerTex)
    tail.anchor.set(0.5, 0)
    tail.blendMode = PIXI.BLEND_MODES.ADD
    tail.scale.set(0.9, 7 + Math.random() * 5)
    tail.tint = tint
    tail.rotation = Math.atan2(-vy, -vx) - Math.PI / 2 // 尾迹拖在速度反方向
    decalC.addChild(tail, head)
    const dur = 1.1 + Math.random() * 0.5
    meteors.push({ x, y, vx, vy, life: dur, dur, head, tail })
  }
  function updateSpaceFx(dt) {
    for (const o of spaceAnims) {
      o.t += dt
      o.up(o, dt)
    }
    if (SCENES[sceneIdx].tiles.space) {
      meteorT -= dt
      if (meteorT <= 0) {
        meteorT = 1.2 + Math.random() * 2.8
        spawnMeteor()
        if (Math.random() < 0.22) spawnMeteor() // 偶发双流星
      }
    }
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i]
      m.life -= dt
      m.x += m.vx * dt
      m.y += m.vy * dt
      const a = m.dur - m.life < 0.15 ? (m.dur - m.life) / 0.15 : Math.min(1, m.life / 0.35)
      m.head.x = m.x
      m.head.y = m.y
      m.head.alpha = a
      m.tail.x = m.x
      m.tail.y = m.y
      m.tail.alpha = a * 0.75
      if (m.life <= 0) {
        m.head.destroy()
        m.tail.destroy()
        meteors.splice(i, 1)
      }
    }
  }

  /** 环境粒子层：飘雪/沙尘/萤火/火星/雨幕/浮灰/浪光 + 风暴闪电 */
  let envT = 0
  let lightningT = 3
  function updateAmbient(dt) {
    const s = SCENES[sceneIdx]
    if (s.lightning) {
      lightningT -= dt
      if (lightningT <= 0) {
        lightningT = 3.5 + Math.random() * 4
        flashG.tint = 0xeaf2ff
        flashG.alpha = Math.max(flashG.alpha, 0.4)
        timers.push({ t: 0.3, fn: () => (flashG.tint = 0xffffff) })
        playSfx('xCluster', 0.22, 0.35)
      }
    }
    if (!s.ambient) return
    const rate = (s.ambient === 'rain' ? 90 : s.ambient === 'snow' ? 32 : s.ambient === 'sand' ? 42 : 12) * PFX
    envT += dt
    const n = Math.floor(envT * rate)
    if (n <= 0) return
    envT -= n / rate
    const hw = W / 2 / cam.zoom + 120
    const hh = H / 2 / cam.zoom + 120
    for (let i = 0; i < n; i++) {
      const x = cam.cx + (Math.random() * 2 - 1) * hw
      const y = cam.cy + (Math.random() * 2 - 1) * hh
      const r = Math.random()
      if (s.ambient === 'snow') {
        spawnParticle(P_TEX.light, x, y, {
          scale: 0.04 + r * 0.035, life: 2.2, tint: 0xffffff, alpha: 0.75,
          vx: 40 + r * 30, vy: 90 + r * 70, drag: 1, fadePow: 1.2,
        })
      } else if (s.ambient === 'sand') {
        spawnParticle(P_TEX.spark, x, y, {
          scale: 0.05 + r * 0.03, life: 0.75, tint: 0xe8c87e, alpha: 0.55,
          vx: -(520 + r * 320), vy: (Math.random() - 0.5) * 60, drag: 1,
        })
      } else if (s.ambient === 'firefly') {
        spawnParticle(P_TEX.light, x, y, {
          scale: 0.045, life: 2.4, tint: 0xb8ff6a, add: true, alpha: 0.8,
          vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, drag: 0.995, fadePow: 2,
        })
      } else if (s.ambient === 'ember') {
        spawnParticle(P_TEX.spark, x, y, {
          scale: 0.045 + r * 0.03, life: 1.6, tint: 0xff9a4a, add: true,
          vx: (Math.random() - 0.5) * 70, vy: -(120 + r * 90), drag: 0.995,
        })
      } else if (s.ambient === 'rain') {
        spawnParticle(P_TEX.spark, x, y, {
          scale: 0.07, life: 0.5, tint: 0x9ab8d8, alpha: 0.5,
          vx: -180, vy: 950, drag: 1,
        })
      } else if (s.ambient === 'ash') {
        spawnParticle(P_TEX.smoke, x, y, {
          scale: 0.05, life: 2.0, tint: 0x9a9a9a, alpha: 0.35,
          vx: (Math.random() - 0.5) * 40, vy: 55 + r * 40, drag: 1, fadePow: 1.4,
        })
      } else if (s.ambient === 'sparkle') {
        spawnParticle(P_TEX.light, x, y, {
          scale: 0.035, life: 1.2, tint: 0xbfffff, add: true, alpha: 0.7,
          vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, drag: 1, fadePow: 2,
        })
      }
    }
  }

  /** t 为字符串时取森林图集（营地/岩石等通用件），为对象时是各主题的树木定义（TR.*） */
  function addProp(chunk, t, x, y) {
    const def = typeof t === 'string'
      ? { tex: tex[t], s: SCALE, r: PROP_R[t] || 0, tall: t === 'treeRound' || t === 'pine' || t === 'pineSmall' }
      : t
    const spr = new PIXI.Sprite(def.tex)
    spr.anchor.set(0.5, 1)
    spr.scale.set(def.s)
    spr.x = x
    spr.y = y
    spr.zIndex = y
    spr.tint = SCENES[sceneIdx].tiles.propTint ?? 0xffffff
    propC.addChild(spr)
    const p = {
      view: spr, x, y,
      r: def.r,
      tall: !!def.tall,
      phase: Math.random() * Math.PI * 2,
      speed: 0.8 + Math.random() * 0.5,
      amp: def.tall ? 0.03 + Math.random() * 0.02 : 0,
      shock: 0,
    }
    allProps.push(p)
    chunk.props.push(p)
    return p
  }

  // 星空动态元素：区块持有的循环动画（星光闪烁/黑洞旋转/恒星脉动），随区块销毁
  const spaceAnims = []
  function addSpaceAnim(chunk, spr, up) {
    const o = { spr, up, t: Math.random() * 10 }
    spaceAnims.push(o)
    chunk.anims.push(o)
  }

  function genChunk(ci, cj) {
    const key = ci + ',' + cj
    if (chunks.has(key)) return
    const theme = SCENES[sceneIdx].tiles
    const chunk = { groundNode: new PIXI.Container(), props: [], guns: [], anims: [] }
    const rng = mulberry32(((Math.imul(ci, 668265263) ^ Math.imul(cj, 374761393)) >>> 0) || 7)
    const x0 = ci * CHUNK
    const y0 = cj * CHUNK

    if (theme.space) {
      // 星空景：一个区块正好一整张无缝星云图，单精灵铺满（原 64 瓦片会造成跨区块生成卡顿）
      const spr = new PIXI.Sprite(SPACE_FULL)
      spr.x = x0
      spr.y = y0
      spr.width = CHUNK
      spr.height = CHUNK
      chunk.groundNode.addChild(spr)
    } else {
      for (let ty = 0; ty < 8; ty++) {
        for (let tx = 0; tx < 8; tx++) {
          const gx = ci * 8 + tx
          const gy = cj * 8 + ty
          const h = (Math.imul(gx, 374761393) ^ Math.imul(gy, 668265263)) >>> 0
          const hc = (Math.imul(gx >> 1, 2246822519) ^ Math.imul(gy >> 1, 3266489917)) >>> 0
          const spr = new PIXI.Sprite(groundPick(theme, h, hc))
          spr.x = gx * TILE
          spr.y = gy * TILE
          spr.width = TILE
          spr.height = TILE
          chunk.groundNode.addChild(spr)
        }
      }
    }
    // 星空景装饰：闪烁亮星 + 黑洞/恒星/行星，让星空像「游戏星空」而不是纯壁纸
    if (theme.space) {
      const nStar = 3 + ((rng() * 4) | 0)
      for (let i = 0; i < nStar; i++) {
        const s = new PIXI.Sprite(P_TEX.light)
        s.anchor.set(0.5)
        s.blendMode = PIXI.BLEND_MODES.ADD
        s.scale.set(0.05 + rng() * 0.09)
        const base = 0.3 + rng() * 0.45
        s.alpha = base
        s.tint = [0xffffff, 0xaecbff, 0xffd9a8][(rng() * 3) | 0]
        s.x = x0 + rng() * CHUNK
        s.y = y0 + rng() * CHUNK
        chunk.groundNode.addChild(s)
        // 星光闪烁：亮度正弦脉动，速率各不相同
        const tw = 1.2 + rng() * 2.4
        addSpaceAnim(chunk, s, (o) => { o.spr.alpha = base * (0.6 + 0.4 * Math.sin(o.t * tw)) })
      }
      // 约 3.5% 区块出黑洞（旋转吸积盘），5% 恒星（光晕脉动），22% 行星（气态巨星缓慢自转）
      const roll = rng()
      const px = x0 + CHUNK * (0.2 + rng() * 0.6)
      const py = y0 + CHUNK * (0.2 + rng() * 0.6)
      if (roll < 0.035) {
        const sc = 1.1 + rng() * 0.7
        const halo = new PIXI.Sprite(P_TEX.light)
        halo.anchor.set(0.5)
        halo.blendMode = PIXI.BLEND_MODES.ADD
        halo.scale.set(sc * 1.5)
        halo.alpha = 0.3
        halo.tint = 0x8a5aff
        const disk = new PIXI.Sprite(P_TEX.twirl)
        disk.anchor.set(0.5)
        disk.blendMode = PIXI.BLEND_MODES.ADD
        disk.scale.set(sc)
        disk.alpha = 0.95
        disk.tint = 0xa070ff
        const disk2 = new PIXI.Sprite(P_TEX.twirl)
        disk2.anchor.set(0.5)
        disk2.blendMode = PIXI.BLEND_MODES.ADD
        disk2.scale.set(sc * 0.62)
        disk2.alpha = 0.8
        disk2.tint = 0x66aaff
        const core = new PIXI.Sprite(orbTex)
        core.anchor.set(0.5)
        core.scale.set(sc * 0.5)
        core.tint = 0x000000
        core.alpha = 0.96
        for (const s of [halo, disk, disk2, core]) { s.x = px; s.y = py }
        chunk.groundNode.addChild(halo, disk, disk2, core)
        addSpaceAnim(chunk, disk, (o, dt) => { o.spr.rotation += dt * 1.1 })
        addSpaceAnim(chunk, disk2, (o, dt) => { o.spr.rotation -= dt * 1.7 })
        addSpaceAnim(chunk, halo, (o) => { o.spr.alpha = 0.24 + 0.1 * Math.sin(o.t * 1.3) })
      } else if (roll < 0.085) {
        const sun = new PIXI.Sprite(SUN_TEX[(rng() * SUN_TEX.length) | 0])
        sun.anchor.set(0.5)
        sun.scale.set(1.0 + rng() * 0.8)
        sun.x = px
        sun.y = py
        const glow = new PIXI.Sprite(P_TEX.light)
        glow.anchor.set(0.5)
        glow.blendMode = PIXI.BLEND_MODES.ADD
        glow.scale.set(sun.scale.x * 1.4)
        glow.alpha = 0.55
        glow.tint = 0xffd9a0
        glow.x = px
        glow.y = py
        chunk.groundNode.addChild(glow, sun)
        // 恒星呼吸：光晕缓慢明暗脉动
        const gs = glow.scale.x
        addSpaceAnim(chunk, glow, (o) => {
          o.spr.alpha = 0.45 + 0.18 * Math.sin(o.t * 1.5)
          o.spr.scale.set(gs * (1 + 0.06 * Math.sin(o.t * 1.5)))
        })
      } else if (roll < 0.3) {
        const idx = (rng() * PLANET_TEX.length) | 0
        const pl = new PIXI.Sprite(PLANET_TEX[idx])
        pl.anchor.set(0.5)
        pl.scale.set(0.45 + rng() * 1.05)
        pl.x = px
        pl.y = py
        chunk.groundNode.addChild(pl)
        // 气态巨星（后 4 张）缓慢自转
        if (idx >= 10) addSpaceAnim(chunk, pl, (o, dt) => { o.spr.rotation += dt * 0.08 })
      }
    }
    // 水面（九宫格 terrain 水塘/熔岩湖；森林景用原水塘贴图。飞机从上空掠过）
    if (theme.pond && rng() < theme.pond.chance) {
      let pond
      if (theme.pond.P) {
        const pw = theme.pond.w[0] + ((rng() * (theme.pond.w[1] - theme.pond.w[0] + 1)) | 0)
        const ph = theme.pond.h[0] + ((rng() * (theme.pond.h[1] - theme.pond.h[0] + 1)) | 0)
        pond = buildPond(theme.pond.P, pw, ph, rng)
      } else {
        pond = new PIXI.Sprite(tex.pond)
        pond.scale.set(SCALE)
      }
      pond.x = x0 + CHUNK * (0.15 + rng() * 0.35)
      pond.y = y0 + CHUNK * (0.15 + rng() * 0.4)
      chunk.groundNode.addChild(pond)
    }
    const nDecal = 2 + ((rng() * 4) | 0)
    for (let i = 0; i < nDecal; i++) {
      const dt0 = theme.decals[(rng() * theme.decals.length) | 0]
      const dx = x0 + rng() * CHUNK
      const dy = y0 + rng() * CHUNK
      if (!dt0) continue
      const spr = new PIXI.Sprite(dt0)
      spr.anchor.set(0.5)
      spr.scale.set(SCALE)
      spr.x = dx
      spr.y = dy
      chunk.groundNode.addChild(spr)
    }
    groundC.addChild(chunk.groundNode)

    // 敌军防空营地：茅屋 + 柴堆 + 防空炮（约 8% 区块）
    if (rng() < 0.08 && !destroyedCamps.has(key)) {
      const hx = x0 + CHUNK * (0.3 + rng() * 0.4)
      const hy = y0 + CHUNK * (0.3 + rng() * 0.3)
      if (!theme.space) {
        // 星空景没有茅屋营地，只保留防空炮位（当作太空炮台）
        addProp(chunk, 'hut', hx, hy)
        addProp(chunk, 'logPile', hx + 50, hy + 90)
      }
      spawnAAGun(chunk, key, hx - 70, hy + 120)
    } else {
      rng() // 保持 rng 消耗一致
    }
    const nProp = theme.propN[0] + ((rng() * (theme.propN[1] + 1)) | 0)
    for (let i = 0; i < nProp; i++) {
      const t = theme.props ? pickW(rng, theme.props) : PROP_TABLE[(rng() * PROP_TABLE.length) | 0]
      addProp(chunk, t, x0 + 60 + rng() * (CHUNK - 120), y0 + 60 + rng() * (CHUNK - 120))
    }
    chunks.set(key, chunk)
  }

  function dropChunk(key) {
    const c = chunks.get(key)
    if (!c) return
    for (const a of c.anims) {
      const i = spaceAnims.indexOf(a)
      if (i >= 0) spaceAnims.splice(i, 1)
    }
    groundC.removeChild(c.groundNode)
    c.groundNode.destroy({ children: true })
    for (const p of c.props) {
      propC.removeChild(p.view)
      p.view.destroy()
      const i = allProps.indexOf(p)
      if (i >= 0) allProps.splice(i, 1)
    }
    for (const g of c.guns) {
      if (!g.dead) {
        gunC.removeChild(g.view)
        g.view.destroy({ children: true })
      }
      const i = aaGuns.indexOf(g)
      if (i >= 0) aaGuns.splice(i, 1)
    }
    chunks.delete(key)
  }

  function updateChunks() {
    const R = Math.hypot(W, H) * 0.5 / cam.zoom + CHUNK * 0.6
    const i0 = Math.floor((cam.cx - R) / CHUNK)
    const i1 = Math.floor((cam.cx + R) / CHUNK)
    const j0 = Math.floor((cam.cy - R) / CHUNK)
    const j1 = Math.floor((cam.cy + R) / CHUNK)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) genChunk(i, j)
    for (const key of chunks.keys()) {
      const [i, j] = key.split(',').map(Number)
      const cx = (i + 0.5) * CHUNK
      const cy = (j + 0.5) * CHUNK
      if (Math.abs(cx - cam.cx) > R + CHUNK * 1.5 || Math.abs(cy - cam.cy) > R + CHUNK * 1.5) dropChunk(key)
    }
  }

  /** 找树木最密的躲藏方向（敌机残血遁入密林用） */
  function treeCoverDir(x, y, awayX, awayY) {
    let best = Math.atan2(y - awayY, x - awayX)
    let bestScore = -1e9
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      const px = x + Math.cos(a) * 420
      const py = y + Math.sin(a) * 420
      let score = 0
      for (const p of allProps) {
        if (p.tall && dist2(p.x, p.y, px, py) < 260 * 260) score += 1
      }
      // 惩罚朝向威胁源的方向
      const toThreat = Math.atan2(awayY - y, awayX - x)
      let d = a - toThreat
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      score -= (1 - Math.abs(d) / Math.PI) * 6
      if (score > bestScore) {
        bestScore = score
        best = a
      }
    }
    return best
  }

  // ── 特效系统（爆炸是重点） ─────────────────────────
  const anims = [] // 序列帧爆炸
  const particles = [] // 通用粒子
  const rings = [] // 冲击波环
  const arcs = [] // 闪电弧
  const decals = [] // 焦痕
  const floaters = [] // 漂浮文字（得分等，屏幕空间跟随）

  function spawnAnim(frames, x, y, scale, fps = 50, stride = 1, tint = 0xffffff) {
    const spr = new PIXI.Sprite(frames[0])
    spr.anchor.set(0.5)
    spr.scale.set(scale)
    spr.x = x
    spr.y = y
    spr.tint = tint
    spr.blendMode = PIXI.BLEND_MODES.SCREEN // 白底噪点消隐，火光更亮
    fxTop.addChild(spr)
    anims.push({ spr, frames, age: 0, fps, stride, n: Math.floor(frames.length / stride) })
  }

  function spawnParticle(texture, x, y, opt = {}) {
    if (particles.length >= FX_BUDGET) return // 预算封顶：超额丢弃，控制填充率与 GC
    const spr = new PIXI.Sprite(texture)
    spr.anchor.set(0.5)
    spr.x = x
    spr.y = y
    spr.rotation = opt.rot ?? Math.random() * Math.PI * 2
    spr.alpha = opt.alpha ?? 1
    spr.tint = opt.tint ?? 0xffffff
    spr.blendMode = opt.add ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL
    const s = opt.scale ?? 0.3
    spr.scale.set(s)
    ;(opt.add ? fxTop : fxC).addChild(spr)
    particles.push({
      spr, age: 0,
      life: opt.life ?? 0.8,
      vx: opt.vx ?? 0, vy: opt.vy ?? 0,
      drag: opt.drag ?? 0.92,
      grow: opt.grow ?? 0,
      rotV: opt.rotV ?? (Math.random() - 0.5) * 2,
      fadePow: opt.fadePow ?? 1,
      a0: opt.alpha ?? 1,
    })
  }

  function spawnRing(x, y, opt = {}) {
    const spr = new PIXI.Sprite(ringTex)
    spr.anchor.set(0.5)
    spr.x = x
    spr.y = y
    spr.tint = opt.tint ?? 0xffe9c0
    spr.blendMode = PIXI.BLEND_MODES.ADD
    fxTop.addChild(spr)
    rings.push({ spr, age: 0, life: opt.life ?? 0.45, r0: opt.r0 ?? 20, r1: opt.r1 ?? 240, a0: opt.alpha ?? 0.9 })
  }

  function spawnArc(x0, y0, x1, y1, color = 0x99e6ff, width = 3) {
    const g = new PIXI.Graphics()
    const segs = 7
    g.lineStyle(width, color, 1)
    g.moveTo(x0, y0)
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    for (let i = 1; i <= segs; i++) {
      const t = i / segs
      const off = i === segs ? 0 : (Math.random() * 2 - 1) * len * 0.09
      g.lineTo(x0 + dx * t + nx * off, y0 + dy * t + ny * off)
    }
    g.blendMode = PIXI.BLEND_MODES.ADD
    fxTop.addChild(g)
    arcs.push({ g, age: 0, life: 0.2 })
  }

  function addScorch(x, y, scale) {
    const t = [P_TEX.scorch1, P_TEX.scorch2, P_TEX.scorch3][(Math.random() * 3) | 0]
    const spr = new PIXI.Sprite(t)
    spr.anchor.set(0.5)
    spr.rotation = Math.random() * Math.PI * 2
    spr.scale.set(scale)
    spr.alpha = 0.8
    spr.tint = 0x201810
    spr.x = x
    spr.y = y
    decalC.addChild(spr)
    decals.push({ spr, age: 0, life: 26 })
    if (decals.length > 60) {
      const d = decals.shift()
      decalC.removeChild(d.spr)
      d.spr.destroy()
    }
  }

  /** 冲击波推树：附近树木剧烈摇摆 */
  function shockProps(x, y, radius, power) {
    for (const p of allProps) {
      const d2 = dist2(p.x, p.y, x, y)
      if (d2 < radius * radius) p.shock = Math.max(p.shock, power * (1 - Math.sqrt(d2) / radius))
    }
  }

  // ── Cocos plist 粒子对接（对接文档：docs/cocos-particles-2d.md） ──
  // 自研粒子保留为基底，按爆炸分类叠加一层 cocos 组合特效增强质感。
  // 冷色武器（电浆/极光）没有现成配色，用 overrides 重着色注册两个专属组合。
  COCOS_EFFECTS.teslaBurst = () => [
    {
      src: 'implodingFlare', mod: 'implodingFlare',
      overrides: { startColor: [0.3, 0.7, 1, 1], startColorVar: [0, 0, 0, 0], endColor: [0.35, 0.4, 1, 0] },
    },
    {
      src: 'burstFlare',
      overrides: { startColor: [0.35, 0.75, 1, 1], startColorVar: [0.08, 0.08, 0, 0], endColor: [0.4, 0.45, 1, 0] },
    },
  ]
  COCOS_EFFECTS.auroraBloom = () => [
    {
      src: 'growingFlare', mod: 'growingFlare',
      overrides: { startColor: [0.28, 1, 0.62, 1], startColorVar: [0, 0, 0, 0], endColor: [0.55, 0.35, 1, 0] },
    },
    {
      // alignToDir：光痕贴图朝各自飞行方向放射（否则恒为水平角度、光束叠成一条横线，同核弹修复）
      src: 'sparkFlare', mod: 'sparkFlare',
      overrides: { startColor: [0.55, 0.35, 1, 1], startColorVar: [0.08, 0.08, 0, 0], endColor: [0.28, 1, 0.62, 0], alignToDir: true },
    },
    {
      src: 'blastWave', mod: 'blastWave',
      overrides: { startColor: [0.3, 1, 0.66, 0.8], startColorVar: [0, 0, 0, 0], endColor: [0.6, 0.42, 1, 0] },
    },
  ]
  /**
   * 爆炸分类 → cocos 特效映射
   * - vulcanHit 频率太高（机炮每秒十几发命中），不叠加，纯火花保帧率
   * - fire/flak 高频：轻量组合 + 节流（cd 秒内只叠一次）
   * - cluster 低频大爆：areaBang；mul≥1.1 的殉爆（炮舰/玩家坠机）升格 bigBang
   * - groundBoom 与 groundExplode（双色尘团+扬尘）天生对口
   */
  const COCOS_MAP = {
    fire: { fx: 'cartoonExplode', scale: 0.55, cd: 0.12 },
    flak: { fx: 'armExplode', scale: 0.5, cd: 0.15 },
    tesla: { fx: 'teslaBurst', scale: 0.6, cd: 0.12 },
    aurora: { fx: 'auroraBloom', scale: 0.6, cd: 0.12 },
    cluster: { fx: 'nukeBlast', scale: 0.85, cd: 0 },
    groundBoom: { fx: 'groundExplode', scale: 0.7, cd: 0.1 },
    // nuke 不走此表：bigBang 的 flatGlow 光带横贯全屏很突兀，核爆分支里显式播 nukeBlast
  }
  const cocosCdUntil = {}
  function cocosBoost(kind, x, y, mul) {
    const m = COCOS_MAP[kind]
    if (!m) return
    const now = performance.now()
    if (m.cd && now < (cocosCdUntil[kind] || 0)) return
    cocosCdUntil[kind] = now + m.cd * 1000
    // 集束炸弹殉爆（打中炮舰/玩家坠机）放大即可，不切 bigBang（水平光束比例别扭）
    const scale = kind === 'cluster' && mul >= 1.1 ? m.scale * 1.4 : m.scale
    playCocosEffect(fxTop, m.fx, { x, y, scale: scale * Math.min(mul, 1.6) })
  }
  // 预热：把用到的 plist/贴图提前拉进缓存，避免首爆卡顿（挂在离屏容器上放掉）
  {
    const warm = new PIXI.Container()
    for (const n of ['cartoonExplode', 'armExplode', 'teslaBurst', 'auroraBloom', 'areaBang', 'bigBang', 'groundExplode', 'nukeBlast']) {
      playCocosEffect(warm, n, { scale: 0.01 })
    }
  }

  /**
   * 爆炸总入口 —— 每种武器一种爆炸语言
   * kind: vulcanHit | fire | cluster | tesla | aurora | flak | groundBoom
   */
  function spawnExplosion(kind, x, y, mul = 1) {
    cocosBoost(kind, x, y, mul)
    if (kind === 'vulcanHit') {
      // 机炮命中：金色火花迸溅 + 微光斑
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2
        const v = 120 + Math.random() * 260
        spawnParticle(P_TEX.spark, x, y, {
          vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          scale: 0.05 + Math.random() * 0.06, life: 0.22 + Math.random() * 0.15,
          tint: 0xffd24a, add: true, drag: 0.86, fadePow: 1.5,
        })
      }
      spawnParticle(P_TEX.light, x, y, { scale: 0.16, life: 0.12, tint: 0xffe9a0, add: true, grow: 1.2 })
      playSfx('xVulcan', 0.13, 0.35)
      return
    }
    if (kind === 'fire') {
      // 导弹：火球序列帧 + 上升烟柱 + 火舌 + 焦痕 + 冲击环
      spawnAnim(EXP_FIRE, x, y, 0.62 * mul, 58, 2)
      spawnRing(x, y, { r0: 14, r1: 190 * mul, life: 0.42, tint: 0xffc890 })
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2
        const v = 60 + Math.random() * 160
        spawnParticle(P_TEX.flame, x, y, {
          vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40,
          scale: 0.18 + Math.random() * 0.14, life: 0.4 + Math.random() * 0.25,
          tint: 0xffa040, add: true, grow: 0.5, drag: 0.9,
        })
      }
      for (let i = 0; i < 6; i++) {
        spawnParticle(P_TEX.smoke, x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 30, {
          vx: (Math.random() - 0.5) * 40, vy: -60 - Math.random() * 70,
          scale: 0.16 + Math.random() * 0.12, life: 1.3 + Math.random() * 0.8,
          tint: 0x5a5148, alpha: 0.5, grow: 0.4, drag: 0.985, fadePow: 1.6,
        })
      }
      addScorch(x, y, 0.5 * mul)
      shockProps(x, y, 230 * mul, 0.6)
      shake = Math.max(shake, 5 * mul)
      playSfx('xFire', 0.55, 0.2)
      return
    }
    if (kind === 'cluster') {
      // 集束炸弹：巨型主爆 + 串联子爆 + 双冲击环 + 泥土飞溅 + 大焦痕
      spawnAnim(EXP_BIG, x, y, 1.15 * mul, 55, 1)
      spawnRing(x, y, { r0: 24, r1: 420 * mul, life: 0.55, tint: 0xffd8a0, alpha: 1 })
      spawnRing(x, y, { r0: 10, r1: 260 * mul, life: 0.75, tint: 0xff9860, alpha: 0.6 })
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2
        const v = 140 + Math.random() * 320
        spawnParticle(P_TEX.dirt, x, y, {
          vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          scale: 0.12 + Math.random() * 0.14, life: 0.5 + Math.random() * 0.35,
          tint: 0x54432e, drag: 0.88, fadePow: 1.4,
        })
      }
      for (let i = 0; i < 8; i++) {
        spawnParticle(P_TEX.smoke2, x + (Math.random() - 0.5) * 90, y + (Math.random() - 0.5) * 70, {
          vx: (Math.random() - 0.5) * 60, vy: -50 - Math.random() * 90,
          scale: 0.24 + Math.random() * 0.16, life: 1.5 + Math.random() * 0.9,
          tint: 0x574e44, alpha: 0.52, grow: 0.35, drag: 0.985, fadePow: 1.7,
        })
      }
      // 串联子爆：随机延时的小型 flak，随威力加量
      const nChild = Math.round((4 + Math.random() * 3) * Math.min(mul, 1.5))
      for (let i = 0; i < nChild; i++) {
        const a = Math.random() * Math.PI * 2
        const r = 70 + Math.random() * 130 * mul
        timers.push({
          t: 0.08 + Math.random() * 0.3,
          fn: () => spawnExplosion('flak', x + Math.cos(a) * r, y + Math.sin(a) * r, 0.8),
        })
      }
      addScorch(x, y, 0.95 * mul)
      shockProps(x, y, 480 * mul, 1)
      shake = Math.max(shake, 15 * mul)
      flashG.alpha = Math.max(flashG.alpha, 0.32)
      playSfx('xCluster', 0.75, 0.15)
      return
    }
    if (kind === 'tesla') {
      // 电浆：放射闪电 + 青紫双环 + 电光球，无火无烟
      spawnParticle(P_TEX.light, x, y, { scale: 0.4 * mul, life: 0.25, tint: 0x99e6ff, add: true, grow: 1.6 })
      spawnParticle(P_TEX.twirl, x, y, { scale: 0.3 * mul, life: 0.35, tint: 0x77bbff, add: true, grow: 1, rotV: 6 })
      spawnRing(x, y, { r0: 10, r1: 150 * mul, life: 0.32, tint: 0x88d8ff })
      spawnRing(x, y, { r0: 6, r1: 90 * mul, life: 0.45, tint: 0xbb88ff, alpha: 0.7 })
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2
        const r = 60 + Math.random() * 90 * mul
        spawnArc(x, y, x + Math.cos(a) * r, y + Math.sin(a) * r)
      }
      // 第二波余震电弧
      timers.push({
        t: 0.09,
        fn: () => {
          for (let i = 0; i < 3; i++) {
            const a = Math.random() * Math.PI * 2
            const r = 40 + Math.random() * 70 * mul
            spawnArc(x, y, x + Math.cos(a) * r, y + Math.sin(a) * r, 0xccaaff)
          }
        },
      })
      playSfx('xTesla', 0.5, 0.2)
      return
    }
    if (kind === 'aurora') {
      // 极光爆：青绿光爆 + 紫罗兰气旋 + 双色环，冷色系的空灵爆点
      spawnParticle(P_TEX.light, x, y, { scale: 0.4 * mul, life: 0.26, tint: 0x9dffd8, add: true, grow: 1.8 })
      spawnParticle(P_TEX.twirl, x, y, { scale: 0.28 * mul, life: 0.36, tint: 0xb08dff, add: true, grow: 1.1, rotV: 9 })
      spawnRing(x, y, { r0: 12, r1: 170 * mul, life: 0.32, tint: 0x8dffcf })
      spawnRing(x, y, { r0: 8, r1: 95 * mul, life: 0.45, tint: 0xc9a8ff, alpha: 0.6 })
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2
        const v = 120 + Math.random() * 220
        spawnParticle(P_TEX.spark, x, y, {
          vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          scale: 0.05, life: 0.28, tint: i % 2 ? 0xb08dff : 0x7dffc8, add: true, drag: 0.88,
        })
      }
      shake = Math.max(shake, 2.5 * mul)
      return
    }
    if (kind === 'flak') {
      // 炮团爆（子爆/敌机空中解体）：团簇烟火序列帧 + 火花
      spawnAnim(EXP_FLAK, x, y, 0.55 * mul, 60, 2)
      spawnRing(x, y, { r0: 12, r1: 130 * mul, life: 0.32, tint: 0xffd9b0, alpha: 0.7 })
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2
        const v = 90 + Math.random() * 200
        spawnParticle(P_TEX.spark, x, y, {
          vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          scale: 0.05 + Math.random() * 0.05, life: 0.3, tint: 0xffb060, add: true, drag: 0.88,
        })
      }
      shake = Math.max(shake, 3 * mul)
      playSfx('xFlak', 0.42, 0.25)
      return
    }
    if (kind === 'groundBoom') {
      // 飞机坠地/防空炮殉爆：火球 + 浓烟 + 焦痕
      spawnAnim(EXP_FIRE, x, y, 0.5 * mul, 52, 2)
      spawnRing(x, y, { r0: 12, r1: 160 * mul, life: 0.4, tint: 0xffc890 })
      for (let i = 0; i < 5; i++) {
        spawnParticle(P_TEX.smoke, x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30, {
          vx: (Math.random() - 0.5) * 30, vy: -50 - Math.random() * 60,
          scale: 0.15 + Math.random() * 0.1, life: 1.3 + Math.random() * 0.8,
          tint: 0x554c42, alpha: 0.5, grow: 0.4, drag: 0.985, fadePow: 1.6,
        })
      }
      addScorch(x, y, 0.45 * mul)
      shockProps(x, y, 200 * mul, 0.5)
      shake = Math.max(shake, 4 * mul)
      playSfx('xGround', 0.5, 0.2)
      return
    }
    if (kind === 'nuke') {
      // 核弹：白閃 → 巨型火球 + 三重冲击环 → 火柱升腾 → 蘑菇帽铺开（演出主体约 2.6s）
      // 中心光效用 nukeBlast（冲击波+聚能球+放射光痕，即集束未升级的普通爆炸），
      // 不用 bigBang——其 flatGlow 水平光束在游戏里比例别扭
      playCocosEffect(fxTop, 'nukeBlast', { x, y, scale: 1.6 })
      spawnAnim(EXP_BIG, x, y, 2.3, 42, 1)
      spawnRing(x, y, { r0: 30, r1: 900, life: 0.6, tint: 0xfff0c8, alpha: 1 })
      timers.push({ t: 0.12, fn: () => spawnRing(x, y, { r0: 20, r1: 1500, life: 0.8, tint: 0xffc890, alpha: 0.8 }) })
      timers.push({ t: 0.3, fn: () => spawnRing(x, y, { r0: 16, r1: 2200, life: 1.0, tint: 0xff9860, alpha: 0.55 }) })
      // 蘑菇柄：0.8 秒内持续喷火柱 + 浓烟升腾
      for (let i = 0; i < 16; i++) {
        timers.push({
          t: i * 0.05,
          fn: () => {
            spawnParticle(P_TEX.flame, x + (Math.random() - 0.5) * 70, y, {
              vx: (Math.random() - 0.5) * 50, vy: -420 - Math.random() * 160,
              scale: 0.35 + Math.random() * 0.2, life: 0.9, tint: 0xffa040, add: true, grow: 0.8, drag: 0.99,
            })
            spawnParticle(P_TEX.smoke2, x + (Math.random() - 0.5) * 110, y + 20, {
              vx: (Math.random() - 0.5) * 60, vy: -300 - Math.random() * 120,
              scale: 0.4 + Math.random() * 0.25, life: 2.2, tint: 0x6a5c4c, alpha: 0.72, grow: 0.8, drag: 0.995, fadePow: 1.8,
            })
          },
        })
      }
      // 蘑菇帽：0.9 秒后在高处横向铺开一圈浓烟 + 顶部余焰
      timers.push({
        t: 0.9,
        fn: () => {
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2
            spawnParticle(P_TEX.smoke2, x, y - 340, {
              vx: Math.cos(a) * (120 + Math.random() * 80), vy: Math.sin(a) * 40 - 30,
              scale: 0.5, life: 2.4, tint: 0x7a6a56, alpha: 0.8, grow: 0.7, drag: 0.97, fadePow: 1.8,
            })
          }
          spawnParticle(P_TEX.flame, x, y - 340, { scale: 0.6, life: 0.8, tint: 0xff8840, add: true, grow: 1.2 })
        },
      })
      // 地表泥土/碎屑横飞
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2
        const v = 260 + Math.random() * 480
        spawnParticle(P_TEX.dirt, x, y, {
          vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          scale: 0.14 + Math.random() * 0.16, life: 0.6 + Math.random() * 0.4,
          tint: 0x54432e, drag: 0.88, fadePow: 1.4,
        })
      }
      addScorch(x, y, 2.4)
      shockProps(x, y, 1400, 1)
      shake = Math.max(shake, 28)
      flashG.alpha = 1
      playSfx('xNuke', 0.95, 0.05)
      return
    }
  }

  const timers = [] // 延时回调 { t, fn }

  // ── 玩家 ─────────────────────────────────────────
  function makePlaneSprite(texture, scale = SCALE * 1.6) {
    const spr = new PIXI.Sprite(texture)
    spr.anchor.set(0.5)
    spr.scale.set(scale)
    return spr
  }
  function makeShadow(texture, scale = SCALE * 1.6) {
    const s = new PIXI.Sprite(texture)
    s.anchor.set(0.5)
    s.scale.set(scale * 0.9)
    s.tint = 0x000000
    s.alpha = 0.26
    return s
  }
  // Spine 敌机没有可 tint 的贴图，阴影用一个扁椭圆柔光斑代替
  function makeSpineShadow(scale = SCALE * 1.6) {
    const s = new PIXI.Sprite(orbTex)
    s.anchor.set(0.5)
    s.scale.set(scale * 0.22, scale * 0.12)
    s.tint = 0x000000
    s.alpha = 0.28
    return s
  }

  // ── 碎裂系统：击毁时 Spine 机拆成真实部件、静态机切 3×3 碎片飞散；被击中崩落小碎屑 ──
  const debris = []
  function spawnShard(tex, x, y, opt = {}) {
    if (debris.length > DEBRIS_CAP) return
    const spr = new PIXI.Sprite(tex)
    spr.anchor.set(0.5)
    spr.x = x
    spr.y = y
    spr.rotation = Math.random() * Math.PI * 2
    spr.scale.set(opt.scale ?? 1)
    if (opt.tint) spr.tint = opt.tint
    fxC.addChild(spr)
    const a = Math.random() * Math.PI * 2
    const spd = (opt.spd ?? 180) * (0.5 + Math.random())
    debris.push({
      spr,
      vx: Math.cos(a) * spd + (opt.vx || 0),
      vy: Math.sin(a) * spd + (opt.vy || 0),
      vr: (Math.random() - 0.5) * 16,
      t: 0,
      dur: opt.dur ?? 0.55 + Math.random() * 0.5,
    })
  }
  const _sliceCache = new Map()
  function sliceTexture(tex, n = 3) {
    const key = tex.frame.x + ',' + tex.frame.y + ',' + n + ',' + tex.baseTexture.uid
    let arr = _sliceCache.get(key)
    if (!arr) {
      arr = []
      const f = tex.frame
      const w = f.width / n
      const h = f.height / n
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++)
          arr.push(new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(f.x + i * w, f.y + j * h, w, h)))
      _sliceCache.set(key, arr)
    }
    return arr
  }
  /** 整机碎裂：spr 为 Spine 实例时拆部件贴图，静态 Sprite 时切碎片 */
  function shatterObject(spr, x, y, opt = {}) {
    if (!spr) return
    if (spr.__anims) {
      const texs = collectSpineTextures(spr)
      const s = Math.abs(spr.scale.x) * (opt.scaleMul ?? 1)
      for (const t of texs) {
        spawnShard(t, x + (Math.random() - 0.5) * 44, y + (Math.random() - 0.5) * 44, {
          scale: s, spd: opt.spd ?? 210, vx: opt.vx, vy: opt.vy,
        })
      }
    } else if (spr.texture && spr.texture.valid) {
      const shards = sliceTexture(spr.texture)
      const s = Math.abs(spr.scale.x)
      for (const t of shards) {
        spawnShard(t, x + (Math.random() - 0.5) * 24, y + (Math.random() - 0.5) * 24, {
          scale: s, spd: opt.spd ?? 190, vx: opt.vx, vy: opt.vy, tint: 0xc8c8c8,
        })
      }
    }
  }
  /** 受击碎屑：崩落 1~2 片小碎片（140ms 节流，防机炮刷屏） */
  function hitChips(o, hx, hy) {
    const now = performance.now()
    if (o.__chipAt && now - o.__chipAt < 140) return
    o.__chipAt = now
    let tex = null
    let s = 1
    if (o.isSpine || (o.spr && o.spr.__anims)) {
      const texs = collectSpineTextures(o.spr, 6)
      if (texs.length) {
        tex = texs[(Math.random() * texs.length) | 0]
        s = Math.abs(o.spr.scale.x) * 0.5
      }
    } else if (o.spr && o.spr.texture && o.spr.texture.valid) {
      const shards = sliceTexture(o.spr.texture, 4)
      tex = shards[(Math.random() * shards.length) | 0]
      s = Math.abs(o.spr.scale.x) * 0.85
    }
    if (!tex) return
    const n = 1 + (Math.random() < 0.4 ? 1 : 0)
    for (let i = 0; i < n; i++) spawnShard(tex, hx ?? o.x, hy ?? o.y, { scale: s, spd: 250, dur: 0.42, tint: 0xaaaaaa })
  }
  function updateDebris(dt) {
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i]
      d.t += dt
      d.vx *= 0.985
      d.vy *= 0.985
      d.spr.x += d.vx * dt
      d.spr.y += d.vy * dt
      d.spr.rotation += d.vr * dt
      const k = 1 - d.t / d.dur
      d.spr.alpha = Math.min(1, k * 2.5)
      if (d.t >= d.dur) {
        d.spr.destroy()
        debris.splice(i, 1)
      }
    }
  }

  // ── 极光龟派气功（移植 forest-demo 按 F 的气功波，FighterZ 风格） ──
  // 巨大枪口能量球 + 锥形四层翻滚束身 + 分形电弧 + 放射能量刺 + 命中爆炸
  // 相位：fire（束头 3400px/s 高速推进）→ hold（持续输出灼烧）→ fade（束宽收束到 0）
  const kiBeamG = new PIXI.Graphics()
  kiBeamG.blendMode = PIXI.BLEND_MODES.ADD
  const mkBeamGlow = (tint) => {
    const s = new PIXI.Sprite(P_TEX.light)
    s.anchor.set(0.5)
    s.blendMode = PIXI.BLEND_MODES.ADD
    s.tint = tint
    s.visible = false
    return s
  }
  const beamMuzzle = mkBeamGlow(0x4f9fff)
  const beamHeadGlow = mkBeamGlow(0x5fb4ff)
  const beamHeadCore = mkBeamGlow(0xffffff)
  fxTop.addChild(kiBeamG, beamMuzzle, beamHeadGlow, beamHeadCore)
  const auroraBeam = {
    on: false, phase: 'fire', t: 0, len: 0, width: 0, power: 1, lv: 1, maxLen: 1300,
    holdT: 0.6, tickT: 0, acc: 0, flick: -1, ph1: 0, ph2: 0,
    spikes: [], beamSpikes: [], arcs: [],
  }
  function beamHide() {
    kiBeamG.visible = beamMuzzle.visible = beamHeadGlow.visible = beamHeadCore.visible = false
    kiBeamG.clear()
  }
  /** 画龟派气功（forest-demo 原版算法，世界坐标）：能量球 + 四层翻滚束身 + 电弧 + 能量刺 */
  function drawKiBeam(b, x0, y0, x1, y1, tm) {
    const g = kiBeamG
    g.clear()
    const dx = x1 - x0
    const dy = y1 - y0
    const L = Math.hypot(dx, dy)
    if (L < 6 || b.width <= 0.01) return
    const ux = dx / L
    const uy = dy / L
    const nx = -uy
    const ny = ux
    const R = (34 + 52 * b.power) * b.width // 枪口能量球半径（满级比机体还大）
    const wBeam = R * 0.62 // 束身基准半宽

    // 闪烁帧：电弧/能量刺每 ~55ms 重新生成形状，帧间保持稳定（免得高频闪成噪点）
    const fl = (tm * 18) | 0
    if (b.flick !== fl) {
      b.flick = fl
      // 球上的放射长芒：细长、带折弯、长短不一（速度线）
      b.spikes = []
      const ns = 6 + ((Math.random() * 4) | 0)
      for (let i = 0; i < ns; i++) {
        b.spikes.push({
          ang: Math.random() * Math.PI * 2,
          len: R * (0.7 + Math.random() * 2.0),
          w: R * (0.04 + Math.random() * 0.08),
          bend: (Math.random() - 0.5) * R * 0.5,
          a: 0.3 + Math.random() * 0.35,
        })
      }
      // 束身外冒的斜芒
      b.beamSpikes = []
      const nb = 3 + ((Math.random() * 3) | 0)
      for (let i = 0; i < nb; i++) {
        b.beamSpikes.push({
          t: 0.12 + Math.random() * 0.68,
          side: Math.random() < 0.5 ? -1 : 1,
          len: wBeam * (0.7 + Math.random() * 1.6),
          w: wBeam * (0.1 + Math.random() * 0.12),
          skew: (Math.random() - 0.5) * 1.6,
          bend: (Math.random() - 0.5) * wBeam * 0.7,
          a: 0.25 + Math.random() * 0.3,
        })
      }
      // 电弧：中点位移法生成分形闪电，带 1~2 条分叉
      b.arcs = []
      const na = 2 + ((Math.random() * 2) | 0)
      for (let a = 0; a < na; a++) {
        let pts = [0, (Math.random() - 0.5) * 0.8, 0]
        let amp = 1
        for (let it = 0; it < 4; it++) {
          const next = [pts[0]]
          for (let i = 1; i < pts.length; i++) {
            next.push((pts[i - 1] + pts[i]) / 2 + (Math.random() - 0.5) * amp, pts[i])
          }
          pts = next
          amp *= 0.55
        }
        const branches = []
        const nbr = Math.random() < 0.65 ? 1 : 2
        for (let bi = 0; bi < nbr; bi++) {
          const i0 = 6 + ((Math.random() * (pts.length - 14)) | 0)
          const segsB = 5 + ((Math.random() * 4) | 0)
          const sign = Math.random() < 0.5 ? -1 : 1
          const bpts = []
          for (let s = 1; s <= segsB; s++) {
            bpts.push({
              dt: (s / segsB) * (0.05 + Math.random() * 0.09),
              off: pts[i0] + sign * s * (0.35 + Math.random() * 0.45) + (Math.random() - 0.5) * 0.5,
            })
          }
          branches.push({ i0, bpts })
        }
        b.arcs.push({ pts, branches, seed: Math.random() * 10 })
      }
    }

    // —— 束身：四层填充多边形，出球后向头部渐扩（锥形），每层边缘独立翻滚 ——
    const layers = [
      { k: 2.0, color: 0x1a50d8, alpha: 0.3 * b.width, amp: 0.5, fq: 1.0, sp: 1.0, ph: 0 },
      { k: 1.55, color: 0x2f7ff0, alpha: 0.4 * b.width, amp: 0.42, fq: 1.31, sp: 1.35, ph: 2.1 },
      { k: 1.15, color: 0x5fb8ff, alpha: 0.55 * b.width, amp: 0.34, fq: 1.73, sp: 0.8, ph: 4.4 },
      { k: 0.7, color: 0xffffff, alpha: 0.95, amp: 0.3, fq: 2.23, sp: 1.6, ph: 1.2 },
    ]
    const segs = Math.max(12, Math.ceil(L / 20))
    for (const ly of layers) {
      const top = []
      const bot = []
      for (let s = 0; s <= segs; s++) {
        const t = s / segs
        const prof = 0.5 + 0.8 * t
        // 头部收口：末端 14% 沿圆弧塌缩到 0，束身汇进爆心光球
        const tCap = Math.max(0, (t - 0.86) / 0.14)
        const cap = Math.sqrt(Math.max(0, 1 - tCap * tCap))
        const wobT =
          ly.amp *
          (0.55 * Math.sin(t * L * 0.019 * ly.fq - tm * 13 * ly.sp + b.ph1 + ly.ph) +
            0.3 * Math.sin(t * L * 0.0413 * ly.fq + tm * 21 * ly.sp + b.ph2 + ly.ph * 1.7) +
            0.15 * Math.sin(t * L * 0.0877 * ly.fq - tm * 31 * ly.sp + ly.ph * 2.3))
        const wobB =
          ly.amp *
          (0.55 * Math.sin(t * L * 0.019 * ly.fq - tm * 12 * ly.sp + b.ph2 + ly.ph * 2.9) +
            0.3 * Math.sin(t * L * 0.0413 * ly.fq + tm * 19 * ly.sp + b.ph1 + ly.ph * 0.6) +
            0.15 * Math.sin(t * L * 0.0877 * ly.fq - tm * 29 * ly.sp + ly.ph * 1.4))
        const bx = x0 + ux * L * t
        const by = y0 + uy * L * t
        const hwT = Math.max(wBeam * 0.02, wBeam * (ly.k + wobT) * prof * cap)
        const hwB = Math.max(wBeam * 0.02, wBeam * (ly.k + wobB) * prof * cap)
        top.push(bx + nx * hwT, by + ny * hwT)
        bot.push(bx - nx * hwB, by - ny * hwB)
      }
      for (let i = bot.length - 2; i >= 0; i -= 2) top.push(bot[i], bot[i + 1])
      g.beginFill(ly.color, ly.alpha)
      g.drawPolygon(top)
      g.endFill()
    }

    // —— 束身外冒的斜芒：细长四边形，中段折弯 ——
    for (const s of b.beamSpikes) {
      const prof = 0.5 + 0.8 * s.t
      const bx = x0 + ux * L * s.t
      const by = y0 + uy * L * s.t
      const base = wBeam * 1.5 * prof
      const dirx = nx * s.side
      const diry = ny * s.side
      const L2 = base + s.len * prof
      const midx = bx + dirx * (base + s.len * prof * 0.5) + ux * (s.skew * s.len * 0.4 + s.bend)
      const midy = by + diry * (base + s.len * prof * 0.5) + uy * (s.skew * s.len * 0.4 + s.bend)
      const tipx = bx + dirx * L2 + ux * s.skew * s.len
      const tipy = by + diry * L2 + uy * s.skew * s.len
      g.beginFill(0x9fd8ff, s.a * b.width)
      g.drawPolygon([bx - ux * s.w, by - uy * s.w, bx + ux * s.w, by + uy * s.w, midx, midy, tipx, tipy])
      g.endFill()
    }

    // —— 电弧：分形闪电，两遍描（宽青色辉光垫底 + 细白芯）——
    for (const arc of b.arcs) {
      const pts = arc.pts
      const n2 = pts.length - 1
      const flick = 0.5 + 0.5 * Math.sin(tm * 47 + arc.seed)
      const arcX = (t, v) => x0 + ux * L * t + nx * v * wBeam * 1.35 * (0.5 + 0.8 * t)
      const arcY = (t, v) => y0 + uy * L * t + ny * v * wBeam * 1.35 * (0.5 + 0.8 * t)
      const passes = [
        { w: 5 * b.width, color: 0x66c8ff, alpha: 0.22 + 0.14 * flick },
        { w: 1.6, color: 0xffffff, alpha: 0.45 + 0.45 * flick },
      ]
      for (const ps of passes) {
        g.lineStyle(ps.w, ps.color, ps.alpha)
        g.moveTo(arcX(0, pts[0]), arcY(0, pts[0]))
        for (let s = 1; s <= n2; s++) g.lineTo(arcX(s / n2, pts[s]), arcY(s / n2, pts[s]))
        for (const br of arc.branches) {
          const t0 = br.i0 / n2
          g.moveTo(arcX(t0, pts[br.i0]), arcY(t0, pts[br.i0]))
          for (const bp of br.bpts) g.lineTo(arcX(t0 + bp.dt, bp.off), arcY(t0 + bp.dt, bp.off))
        }
      }
    }
    g.lineStyle(0)

    // —— 枪口能量球：放射长芒 + 三层实心圆（画在束身之上）——
    for (const s of b.spikes) {
      const ca = Math.cos(s.ang)
      const sa = Math.sin(s.ang)
      const r0 = R * 0.5
      const midx = x0 + ca * (r0 + s.len * 0.5) - sa * s.bend
      const midy = y0 + sa * (r0 + s.len * 0.5) + ca * s.bend
      g.beginFill(0xbfe4ff, s.a * b.width)
      g.drawPolygon([
        x0 + ca * r0 - sa * s.w,
        y0 + sa * r0 + ca * s.w,
        x0 + ca * r0 + sa * s.w,
        y0 + sa * r0 - ca * s.w,
        midx,
        midy,
        x0 + ca * (r0 + s.len),
        y0 + sa * (r0 + s.len),
      ])
      g.endFill()
    }
    const bp = 1 + 0.07 * Math.sin(tm * 26)
    g.beginFill(0x2a66e8, 0.4 * b.width)
    g.drawCircle(x0, y0, R * 1.45 * bp)
    g.endFill()
    g.beginFill(0x66baff, 0.65 * b.width)
    g.drawCircle(x0, y0, R * bp)
    g.endFill()
    g.beginFill(0xffffff, 0.97)
    g.drawCircle(x0, y0, R * 0.62 * bp)
    g.endFill()
  }
  function updateAuroraBeam(dt) {
    const b = auroraBeam
    if (!b.on) {
      if (kiBeamG.visible) beamHide()
      return
    }
    if (!player.alive) {
      b.on = false
      beamHide()
      return
    }
    b.t += dt
    const tm = performance.now() / 1000
    const ang = player.face
    const ux = Math.cos(ang)
    const uy = Math.sin(ang)
    const x0 = player.x + ux * 46
    const y0 = player.y + uy * 46
    if (b.phase !== 'fade') b.width = Math.min(1, b.width + dt * 9)
    const R = (34 + 52 * b.power) * b.width
    const wBeam = R * 0.62
    // 走廊命中检测：束身半宽内最近目标的沿轴距离
    const corridor = (ex, ey, extra) => {
      const dx = ex - x0
      const dy = ey - y0
      const along = dx * ux + dy * uy
      const perp = Math.abs(-uy * dx + ux * dy)
      return along > 24 && perp < wBeam * 1.15 + extra ? along : Infinity
    }
    let hitL = Infinity
    for (const e of enemies) hitL = Math.min(hitL, corridor(e.x, e.y, 22))
    if (boss && !boss.dying && !boss.untouchable) {
      for (const bp of boss.parts) if (!bp.dead) hitL = Math.min(hitL, corridor(bp.wx, bp.wy, 44))
      hitL = Math.min(hitL, corridor(boss.x, boss.y, boss.def.r))
    }

    if (b.phase === 'fire') {
      // 束头高速推进，撞上目标或到达射程 → 转入持续输出并炸一发
      b.len = Math.min(b.maxLen, b.len + 3400 * dt)
      if (b.len >= hitL || b.len >= b.maxLen) {
        if (hitL < Infinity) b.len = Math.min(b.len, hitL)
        b.phase = 'hold'
        b.t = 0
        spawnExplosion('aurora', x0 + ux * b.len, y0 + uy * b.len, 0.8 + b.power * 0.4)
      }
    } else if (b.phase === 'hold') {
      // 持续输出：光束常驻（选着极光武器就一直喷），束头贴最近目标，烧穿后自动延伸到下一个
      b.len = Math.min(b.maxLen, hitL === Infinity ? b.maxLen : hitL)
      shake = Math.max(shake, 1.6 * b.power)
      if (player.weapon !== 4 || over) {
        // 切走武器/游戏结束才收束
        b.phase = 'fade'
        b.t = 0
      }
    } else {
      // 收束：束宽压到 0 后隐藏
      b.width = Math.max(0, 1 - b.t / 0.22)
      if (b.t >= 0.22) {
        b.on = false
        beamHide()
        return
      }
    }

    // 灼烧伤害 tick：走廊内所有目标穿透结算
    b.tickT -= dt
    if (b.tickT <= 0 && b.phase !== 'fade') {
      b.tickT = 0.07
      const dmg = 1 + (b.lv >> 1)
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i]
        if (corridor(e.x, e.y, 22) <= b.len + 40) damageEnemy(e, dmg, 4, e.x, e.y)
      }
      if (boss && !boss.dying && !boss.untouchable) {
        for (const bp of boss.parts) {
          if (!bp.dead && corridor(bp.wx, bp.wy, 44) <= b.len + 50) bossDamage(dmg, 4, bp, bp.wx, bp.wy)
        }
        if (corridor(boss.x, boss.y, boss.def.r) <= b.len + 50) bossDamage(dmg, 4, null, boss.x, boss.y)
      }
    }

    // —— 绘制：束身 + 枪口/头部软光晕 ——
    kiBeamG.visible = true
    const hx = x0 + ux * b.len
    const hy = y0 + uy * b.len
    drawKiBeam(b, x0, y0, hx, hy, tm)
    const pulse = 1 + 0.1 * Math.sin(tm * 24)
    beamMuzzle.visible = beamHeadGlow.visible = beamHeadCore.visible = b.width > 0.01
    beamMuzzle.x = x0
    beamMuzzle.y = y0
    beamMuzzle.width = beamMuzzle.height = R * 5.3 * pulse
    beamHeadGlow.x = hx
    beamHeadGlow.y = hy
    beamHeadGlow.width = beamHeadGlow.height = R * 7.6 * (1 + 0.16 * Math.sin(tm * 29))
    beamHeadCore.x = hx
    beamHeadCore.y = hy
    beamHeadCore.width = beamHeadCore.height = R * 2.9 * pulse
    // 头部能量飞溅：hold 阶段最猛
    if (b.phase !== 'fade') {
      b.acc += dt * (b.phase === 'hold' ? 42 : 16)
      while (b.acc >= 1) {
        b.acc -= 1
        const a = Math.random() * Math.PI * 2
        const spd = 120 + Math.random() * 280
        spawnParticle(P_TEX.light, hx, hy, {
          scale: (0.05 + Math.random() * 0.06) * (0.6 + b.power), life: 0.3 + Math.random() * 0.25,
          tint: Math.random() < 0.35 ? 0xffffff : 0x8fd0ff, add: true,
          vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, drag: 0.93,
        })
      }
    }
  }

  const PLANE_SCALE = SCALE * 1.7
  const player = {
    x: 0, y: 0, vx: 0, vy: -120,
    face: -Math.PI / 2,
    hp: 100, maxHp: 100,
    atk: 3, def: 3, combat: 800, evoHpBonus: 0,
    weapon: 0, cds: [0, 0, 0, 0, 0],
    alive: true, iframe: 0,
    nitroCd: 0, boostT: 0, ghostT: 0,
    nukes: 2, shieldHp: 0,
    evo: 0, scaleMul: 1, evoSpeedMul: 1, evoSubCd: 1, rbT: 0,
    spr: makePlaneSprite(shipTex[3], PLANE_SCALE),
    shadow: makeShadow(shipTex[3], PLANE_SCALE),
    trailT: 0,
  }
  shadowC.addChild(player.shadow)
  planeC.addChild(player.spr)

  // 风暴雷神动画计时 + 僚机挂载（L_15，左右各一，跟随机身）
  let heroT = 0
  let wingT = 0
  const wingSprs = []
  if (WING.on) {
    for (let i = 0; i < 2; i++) {
      const w = new PIXI.Sprite(WING.normal[0])
      w.anchor.set(0.5)
      w.__side = i === 0 ? -1 : 1
      planeC.addChild(w)
      wingSprs.push(w)
    }
  }
  if (HERO.on) {
    player.spr.texture = HERO.putong[0]
    player.shadow.texture = HERO.putong[0]
    player.shadow.tint = 0x000000
    player.shadow.alpha = 0.28
  }

