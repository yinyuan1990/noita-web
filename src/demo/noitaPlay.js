// ── 横版可玩原型:小巫师在原版精度的 Noita 地图里走 / 飞 / 打洞 ──
// 地图全部来自 src/noita-map(Worker 生成 + ChunkStreamer 方向预取 + IndexedDB 落盘),这里只做:
//   相机 / 玩家身体(重力·行走·1px 上台阶·喷气·液体浮力)/ 弹丸打洞(改材质 → Worker 重画)/ 触屏双区 / 简易光照。
// 尺度:Noita 一屏 ≈ 427×240 世界像素,玩家碰撞盒 ≈ 7×15;这里 1 世界像素 = 1 材质格,与地图模块同尺度。
// 落沙模拟不在本页(下一步:把 pixelDemo 的元胞自动机接到激活窗口内的 chunk.mat 上)。

import { NoitaAssets, WorldClient, ChunkStreamer, ChunkStore, CellSim, coords, biomeNameOf } from '../noita-map/index.js'
import { OpLog } from '../noita-map/OpLog.js'
import { Sfx } from '../noita-map/Sfx.js'
import { ProjectileSystem } from '../noita-map/ProjectileSystem.js'
import { PlayerSprite } from '../noita-map/PlayerSprite.js'
import { ParallaxSky } from '../noita-map/Sky.js'
import { Entities } from '../noita-map/Entities.js'
import { Ragdoll } from '../noita-map/Ragdoll.js'
import { LiquidRefraction } from '../noita-map/render/Refraction.js'
import { Vegetation } from '../noita-map/Vegetation.js'
import { WandSystem, FREE_CAPACITY } from '../noita-map/Wands.js'
import { PerkSystem } from '../noita-map/Perks.js'
import { decodePngBrowser } from '../noita-map/assets.js'

const { CHUNK, WORLD_CENTER_CHUNK_X: WCX, WORLD_CENTER_CHUNK_Y: WCY } = coords
const $ = (id) => document.getElementById(id)
const Q = new URLSearchParams(location.search)
const BASE = import.meta.env.BASE_URL || '/'
const RES = BASE + 'res/noita'
const SEED = parseInt(Q.get('seed') || '1674172626', 10) >>> 0
const VIEW_W = 427 // Noita 一屏世界像素宽;高按屏幕比例派生
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
if (IS_TOUCH) document.body.classList.add('touch')

// ── 地图 ──
const assets = await new NoitaAssets({ base: RES }).init()
const mats = assets.materials
const KIND = mats.kind
// 位图只画静态材质(skipDynamic),液体/沙/气/火每帧由主线程按模拟状态叠上去
const client = await new WorldClient({ base: RES, seed: SEED, workers: 1, chunkCache: 24, paint: { skipDynamic: true } }).init()
// 世界生成版本:改了生成 / 群系 / 植被烙格子就 +1,老存档里的旧区块自动作废重生成(不然手机上"看着没变化")
const WORLD_REV = 2
let store = null
try { store = await new ChunkStore().open(); const n = await store.ensureRev(SEED, WORLD_REV); if (n) console.info(`[world] 生成版本变了,作废旧区块 ${n} 块`) } catch (e) { void e }
const streamer = new ChunkStreamer(client, { store, cache: 40, ahead: 2, behind: 1, side: 1, maxInFlight: 2, maxAcceptPerFrame: 2 })
streamer.seed = SEED
document.addEventListener('visibilitychange', () => { if (document.hidden) streamer.flush() })
window.addEventListener('pagehide', () => streamer.flush())

// ── 材质模拟(materials.xml 属性驱动 + 328 条反应表)──
const reactions = await (await fetch(`${RES}/reactions.json`)).json()
const repaintDue = new Map() // chunk key → 最早可重画时刻(静态变化节流 150ms)
const sim = new CellSim(mats, reactions, {
  getChunk: (cx, cy) => streamer.get(cx, cy),
  onStaticChanged: (cx, cy) => { const k = cx + ',' + cy; if (!repaintDue.has(k)) repaintDue.set(k, performance.now() + 150) },
})
let simBound = false

// ── 操作日志 + 音效 ──
const LOG_URL = Q.get('log') === '0' ? '' : (location.hostname === 'localhost' || location.hostname.startsWith('192.168.') || location.hostname.startsWith('10.')) ? 'https://update.cocoaihj.com/updatesoft/noita-log/' : BASE.replace(/noita\/$/, 'noita-log/')
const oplog = new OpLog({ url: LOG_URL, meta: { seed: SEED, build: import.meta.env.MODE } })
const sfx = new Sfx(RES)
sfx.load(['impact', 'fire', 'wind', 'clash', 'electric', 'water', 'magic', 'explosion'])
let stuckT = 0, stuckLogged = false, footT = 0, lastInState = '', posLogT = 0, spraying = false, hopT = 0
/** 玩家周围材质快照(卡住时上传):'#'实心 '~'液体 ':'沙 '.'空 '?'未加载,一行一串 */
function sampleAround(wx, wy, rx, ry) {
  const rows = []
  for (let y = -ry; y <= ry; y++) {
    let s = ''
    for (let x = -rx; x <= rx; x++) {
      const m = matAt(Math.floor(wx) + x, Math.floor(wy) + y)
      const k = m < 0 ? '?' : m === 0 ? '.' : KIND[m]
      s += k === '?' ? '?' : k === '.' ? '.' : k === 'liquid' ? '~' : k === 'sand' ? ':' : k === 'gas' || k === 'fire' ? '*' : '#'
    }
    rows.push(s)
  }
  return rows
}

/** 世界坐标 → 材质 id;区块未就位返回 -1(优先走模拟窗口,窗口外走 streamer) */
function matAt(wx, wy) {
  if (simBound) { const m = sim.get(Math.floor(wx), Math.floor(wy)); if (m >= 0) return m }
  const cx = Math.floor(wx / CHUNK) + WCX, cy = Math.floor(wy / CHUNK) + WCY
  const e = streamer.get(cx, cy)
  if (!e || !e.mat) return -1
  const lx = (Math.floor(wx) - (cx - WCX) * CHUNK), ly = (Math.floor(wy) - (cy - WCY) * CHUNK)
  return e.mat[ly * CHUNK + lx]
}
let entities = null // 实体层(后面 init;醒着的像素刚体也算实心)
// 挡人的格子:看材质 platform_type(materials.xml:0 = 角色穿过去 —— grass / moss / plant_material / mushroom / wood_loose(树)/ rock_loose / meat(尸块)/ item_box2d / wood_prop_noplayerhit;
// 1 = 站得住 —— rock_static / sand_static / wood / steel / concrete_collapsed / wood_prop…;2 = templebrick_box2d;没写 = 1)。原版人就是穿树走、踩不到尸块;子弹照样打得中(弹丸碰撞另算)。
// 之前按 solid_static_type 判会把 wood / steel / brick / meteorite 这些 cell_type=solid 的真地形当成可穿(它们 solid_static_type≠1 但 platform_type=1)。
// 醒着的刚体像素另算(bodySolidAt);没加载 = 当墙,别掉进虚空
const solidAt = (wx, wy) => {
  const m = matAt(wx, wy); if (m < 0) return true
  const k = KIND[m]
  if (k === 'static' || k === 'sand' || k === 'solid') return (mats.list[m]?.platformType ?? 1) !== 0
  return !!(entities && entities.bodySolidAt(wx, wy))
}
const liquidAt = (wx, wy) => { const m = matAt(wx, wy); return m > 0 && KIND[m] === 'liquid' }

// ── 玩家:数值全部来自 data/entities/player_base.xml(CharacterPlatformingComponent / CharacterDataComponent)──
// 碰撞盒 collision_aabb x -2..2, y -4.5..2.1(4×6.6,比精灵小得多,这就是能钻窄缝的原因);climb_over_y=4 自动上 4px 台阶
// pixel_gravity 350;velocity_max_x 57(走);accel_x 0.15/帧;jump_velocity_y -95;fly_speed_max_up 95 / fly_speed_mult 20;
// fly_time_max 3s,地面回充 6/s,空中 0.4/s(悬空 38 帧后才开始回);velocity_min_y -200 / max_y 350
const P = {
  gravity: 350, runMax: 57, accelX: 0.15, jumpVy: -95, jumpVx: 56, flyVx: 52, flyUpMax: 95, flyDownMax: 85, flySpeedMult: 20, flyChange: 0.25,
  flyTimeMax: 3.0, flyRechargeAir: 0.4, flyRechargeGround: 6, flyAirWaitFrames: 38, vyMin: -200, vyMax: 350,
  // climb_over_y 原值 4;真机日志里 5px 的小坎(砖边扰动造成)肉眼像能走却卡住,放宽到 6(≈ 精灵膝盖高),再高才需要跳
  climb: 6,
  boxL: -2, boxR: 2, boxT: -4.5, boxB: 2.1,
  buoyancyOffsetY: -7, // buoyancy_check_offset_y:身体这个高度还在液体里才算"在游泳",脚踩水洼不算
}
// hp 用 Noita 内部单位(player_base max_hp=4,界面显示 ×25 = 100)
const player = {
  x: 227, y: -120, vx: 0, vy: 0, onGround: false, thrusting: false, fuel: 100, hp: 4, maxHp: 4, face: 1, walkT: 0, iframe: 0,
  aimX: 300, aimY: -120, fireCd: 0, fly: P.flyTimeMax, airFrames: 0, sinceFly: 999, flyExhausted: false, upHeld: false,
  // 水:wasWet 上一帧碰着液体(入水一刻掀水花);stains = 身上每种沾污各自的量(见 STAIN_THRESHOLD 注释);headInLiq 头没在液体里
  wasWet: false, stains: [], headInLiq: false, dripT: 0, fireT: 0, fireDur: 4, fireTick: 0, gold: 0,
  air: 7, dead: false, kills: 0, // air_in_lungs(秒);dead = 死亡画面挂着
  // 旧接口(探针 / 日志用):wet = 沾污总量 0~10,stain = 量最大的那种,wetMat = 它的材质
  get wet() { return this.stains.reduce((a, s) => a + s.amt, 0) },
  get stain() { const s = this.stains.slice().sort((a, b) => b.amt - a.amt)[0]; return s ? s.kind : '' },
  get wetMat() { const s = this.stains.slice().sort((a, b) => b.amt - a.amt)[0]; return s ? s.mat : 0 },
  kickCd: 0, kickT: 0, // 踢:冷却 / 出脚动画剩余
}
// 自由模式(FREE,默认开,?free=0 关):法术全开(背包里有整个法术库、随处改法杖)、法力 / 次数无限 —— 玩家要的是玩材质效果,不是攒资源
const FREE = Q.get('free') !== '0'
const flags = { editAnywhere: FREE, wandSlots: FREE ? 8 : 4 } // 特权开的开关 / 倍率(Perks.js EFFECTS 写,各处读);自由模式 8 根杖 / 每杖 20 格
const bubbles = [] // 水下呼吸气泡(particles/gas_bubble:向上加速 -200、最快 90,出水面即破)
// 碰撞盒采样点:两侧竖线各取 4 个高度(含顶/底);顶 / 底两行整行采样 —— 只测两个角的话,树尖 / 一根细枝正好落在两角之间会穿下去(用户:站树顶往下陷)
const BOX_YS = [P.boxT, P.boxT + 2.2, P.boxT + 4.4, P.boxB]
function bodyBlocked(cx, cy) {
  const xl = Math.floor(cx + P.boxL), xr = Math.floor(cx + P.boxR - 0.01)
  for (const oy of BOX_YS) { const y = Math.floor(cy + oy); if (solidAt(xl, y) || solidAt(xr, y)) return true }
  const yt = Math.floor(cy + P.boxT), yb = Math.floor(cy + P.boxB)
  for (let x = xl + 1; x < xr; x++) if (solidAt(x, yb) || solidAt(x, yt)) return true
  return false
}
/** 脚下整行任一格实心即站着 */
function groundUnder(cx, cy) {
  const xl = Math.floor(cx + P.boxL), xr = Math.floor(cx + P.boxR - 0.01), y = Math.floor(cy + P.boxB + 1)
  for (let x = xl; x <= xr; x++) if (solidAt(x, y)) return true
  return false
}
const HEAD = Math.round(P.boxT) - 4, FEET = Math.ceil(P.boxB) // 精灵绘制用(精灵 7×14,碰撞盒在其下半)
/**
 * 趟沙:Noita 里角色走进松散的沙 / 粉末会把它们推开慢慢过去,不会被一堆落沙埴死。
 * 目标位置的碰撞盒里挡路的格子如果**全是** sand 类(不是石头 / 刚体),把它们挪到该列上方最近的空格,返回 true(可以过去);挪不开 / 有硬东西返回 false。
 */
let wadeCells = 0
function wadeSand(cx, cy) {
  if (!simBound) return false
  const xl = Math.floor(cx + P.boxL), xr = Math.floor(cx + P.boxR - 0.01)
  const cells = []
  for (let x = xl; x <= xr; x++) for (const oy of BOX_YS) {
    const y = Math.floor(cy + oy)
    if (!solidAt(x, y)) continue
    const m = sim.get(x, y)
    if (m <= 0 || KIND[m] !== 'sand') return false
    if (!cells.some(([a, b]) => a === x && b === y)) cells.push([x, y])
  }
  if (!cells.length || cells.length > 10) return false
  const top = Math.floor(cy + P.boxT)
  for (const [x, y] of cells) {
    let tx = -1, ty = -1
    for (let k = 1; k <= 16 && tx < 0; k++) if (sim.get(x, top - k) === 0) { tx = x; ty = top - k } // 先往头顶上方堆
    for (const dx of [-3, 3, -4, 4, -5, 5]) { if (tx >= 0) break; if (sim.get(x + dx, top - 1) === 0) { tx = x + dx; ty = top - 1 } } // 再往两侧
    if (tx < 0) return false
    sim.set(tx, ty, sim.get(x, y), sim.aux(x, y)); sim.set(x, y, 0, 0)
  }
  wadeCells += cells.length
  return true
}

const keys = new Set()
window.addEventListener('keydown', (e) => { keys.add(e.key.toLowerCase()); if (e.key === ' ') e.preventDefault() })
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))

// 触屏(手游布局):左半屏浮动摇杆(x 走,上推也能跳/悬浮),右半屏瞄准摇杆=瞄准并开火;
// 右下角动作键:跳/飞(按住飞)· 踢 · 喝 · 背包;底栏物品格点选切换。按键都 stopPropagation,不会当成摇杆
const touch = { joy: null, mx: 0, my: 0, aim: null, jump: false }
const joyEl = $('joy'), knobEl = $('knob'), aimEl = $('aim')
function touchStart(e) {
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth / 2 && !touch.joy) {
      touch.joy = { id: t.identifier, x0: t.clientX, y0: t.clientY }
      joyEl.style.display = 'block'; joyEl.style.left = t.clientX - 48 + 'px'; joyEl.style.top = t.clientY - 48 + 'px'
      knobEl.style.left = '32px'; knobEl.style.top = '32px'
    } else if (t.clientX >= innerWidth / 2 && !touch.aim) {
      // 右半屏 = 瞄准摇杆:按下的点是原点,拖的方向就是瞄准方向;只点不拖 = 朝当前面向开火。
      // 之前是"瞄向手指所在的屏幕点",而右半屏永远在人物右边 → 一开火人就被拧到右边,永远瞄不了左
      touch.aim = { id: t.identifier, x0: t.clientX, y0: t.clientY, dx: 0, dy: 0 }
      aimEl.style.display = 'block'
    }
  }
}
function touchMove(e) {
  for (const t of e.changedTouches) {
    if (touch.joy && t.identifier === touch.joy.id) {
      const dx = t.clientX - touch.joy.x0, dy = t.clientY - touch.joy.y0
      const d = Math.hypot(dx, dy), r = Math.min(d, 40)
      touch.mx = d ? (dx / d) * (r / 40) : 0; touch.my = d ? (dy / d) * (r / 40) : 0
      knobEl.style.left = 32 + (d ? (dx / d) * r : 0) + 'px'; knobEl.style.top = 32 + (d ? (dy / d) * r : 0) + 'px'
    } else if (touch.aim && t.identifier === touch.aim.id) { touch.aim.dx = t.clientX - touch.aim.x0; touch.aim.dy = t.clientY - touch.aim.y0 }
  }
}
function touchEnd(e) {
  for (const t of e.changedTouches) {
    if (touch.joy && t.identifier === touch.joy.id) { touch.joy = null; touch.mx = 0; touch.my = 0; joyEl.style.display = 'none' }
    if (touch.aim && t.identifier === touch.aim.id) { touch.aim = null; aimEl.style.display = 'none' }
  }
}
window.addEventListener('touchstart', (e) => { e.preventDefault(); touchStart(e); screen.orientation?.lock?.('landscape').catch(() => {}) }, { passive: false })
window.addEventListener('touchmove', (e) => { e.preventDefault(); touchMove(e) }, { passive: false })
window.addEventListener('touchend', touchEnd); window.addEventListener('touchcancel', touchEnd)
const mouse = { x: 0, y: 0, down: false }
window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY })
window.addEventListener('mousedown', (e) => { if (e.button === 0) mouse.down = true; else if (e.button === 2) kick() }) // 右键 = 踢(原版默认键位)
window.addEventListener('mouseup', () => { mouse.down = false })
window.addEventListener('contextmenu', (e) => e.preventDefault())
// 手机动作键:跳/飞按住生效;踢 / 喝 / 背包点一下
const holdBtn = (id, on, off) => {
  const el = $(id)
  el.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); el.classList.add('held'); on() }, { passive: false })
  for (const ev of ['touchend', 'touchcancel']) el.addEventListener(ev, (e) => { e.stopPropagation(); el.classList.remove('held'); off?.() })
}
holdBtn('btnJump', () => { touch.jump = true }, () => { touch.jump = false })
holdBtn('btnKick', () => kick())
holdBtn('btnBag', () => editor.toggle())
$('acts').addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })

// ── 相机 / 画布 ──
const game = $('game'), gctx = game.getContext('2d')
const view = document.createElement('canvas'), vctx = view.getContext('2d') // 世界像素分辨率的中间画布
const cam = { x: player.x, y: player.y }
let VW = VIEW_W, VH = 240, SCALE = 1
let overlay = null, overlayCv = document.createElement('canvas'), lightCv = document.createElement('canvas')
const glowPts = [] // 本帧发光格 [x,y,glow,color,...](视口坐标)
let fireCells = 0
// 液体折射(post_final.frag ENABLE_REFRACTION):有 WebGL 就在放大那一步按屏幕分辩率做(render/Refraction.js,原式 + 亚像素采样,和原版一样);
// 没有 WebGL 退回世界分辨率的整像素版:wobX/wobY = 本帧每列的 dx / 每行的 dy,wobOx/wobOy = 本帧视口左上世界坐标
const refr = (() => { try { const r = new LiquidRefraction(); return r.ok ? r : null } catch (e) { console.warn('refraction shader', e); return null } })()
let liqMask = new Uint8Array(1) // VW×VH 液体掩码(给 shader)
let wobX = new Int8Array(1), wobY = new Int8Array(1), wobOx = 0, wobOy = 0
/** 世界点 (wx,wy) 落在液体格里 → 这一格的折射偏移 [dx,dy](采样到的那格也得是液体),否则 null。弹丸 / 人 / 怪在水里画的时候用(只在没 WebGL 的退路里) */
function liquidWobble(wx, wy) {
  if (refr) return null
  const i = Math.floor(wx) - wobOx, j = Math.floor(wy) - wobOy
  if (i < 0 || j < 0 || i >= VW || j >= VH) return null
  const m = sim.get(Math.floor(wx), Math.floor(wy))
  if (!(m > 0 && sim.kind[m] === 3)) return null
  const dx = wobX[i], dy = wobY[j]
  if (!dx && !dy) return null
  const m2 = sim.get(Math.floor(wx) + dx, Math.floor(wy) + dy)
  return m2 > 0 && sim.kind[m2] === 3 ? [dx, dy] : null
}
function resize() {
  game.width = innerWidth; game.height = innerHeight
  SCALE = innerWidth / VIEW_W
  VW = VIEW_W; VH = Math.ceil(innerHeight / SCALE)
  view.width = VW; view.height = VH
  overlayCv.width = VW; overlayCv.height = VH
  overlay = new ImageData(VW, VH)
  lightCv.width = Math.ceil(VW / 4); lightCv.height = Math.ceil(VH / 4)
  wobX = new Int8Array(VW); wobY = new Int8Array(VH); liqMask = new Uint8Array(VW * VH)
  if (refr) refr.resize(game.width, game.height)
}
window.addEventListener('resize', resize); resize()
const toWorld = (sx, sy) => [cam.x - VW / 2 + sx / SCALE, cam.y - VH / 2 + sy / SCALE]
const toScreen = (wx, wy) => [(wx - cam.x + VW / 2) * SCALE, (wy - cam.y + VH / 2) * SCALE]

// ── 投射物:定义来自 projectiles.json(Noita 原 xml),法杖 = 选哪种弹 + 施法延迟 ──
const sparks = []
const debris = []    // 材质碎屑(pixelDemo 的 parts):带真材质飞出去,落地沉积回世界
let shakeT = 0
const projDefs = await (await fetch(`${RES}/projectiles.json`)).json()
const PLAYER_TARGET = { isPlayer: true, name: 'player' }
// 黑洞每次命中的伤害 = BlackHoleComponent damage_amount(component_documentation 默认 0.1,prepare 已抽进 d.blackHole.damageAmount);其余常量见 hooks.blackHole 注释(反 exe 得来)
// 电流碰到活物一次的伤害也是引擎常量;取 wiki Damage Types 页电伤害示例 AreaDamageComponent damage_per_frame=0.4 —— 泡在电水里 10 帧一次 = 2.4/s(60 显示血/s),
// 满血玩家 1.7s 死,和原版"电水几乎必死"的手感一致;僵尸(0.5)两下
const ELEC_DMG = 0.4
// 弹丸 AudioLoopComponent(event_name)→ 合成音色:黑洞 = 低沉轰鸣,场 = 中频嗡鸣,雷霆之环 = 高频滋滋;zap 是正在液体里窜的电流(game_effect/electrocution/loop)
const PROJ_LOOPS = { black_hole_big: { vol: 0.5, freq: 70, q: 0.9 }, black_hole: { vol: 0.3, freq: 110, q: 0.9 }, field: { vol: 0.12, freq: 520, q: 3 }, field_electric: { vol: 0.2, freq: 3200, q: 1.5 }, zap: { vol: 0.3, freq: 4200, q: 1.2 } }
const projectiles = new ProjectileSystem({
  defs: projDefs, mats, sim, res: RES, decodePng: (u) => decodePngBrowser(u),
  hooks: {
    // Noita 规则:静态材质(石头/砂岩/木头)被打碎只出"尘"——飞一下就没,不会在墙上/地上结成新像素;
    // 沙/土/煤/液体这类本来就会动的材质,碎屑落地照旧沉积回去;real = 原版"真粒子"(LooseGround 松脱的砖 / 石),静态材质也要落地沉积回去
    debris: (x, y, vx, vy, m, col, real = false) => { const k = mats.kind[m]; if (debris.length < (real ? 3000 : 900)) debris.push({ x, y, vx, vy, m, col, dust: !real && (k === 'static' || k === 'solid') }) },
    shake: (t) => { shakeT = Math.max(shakeT, t) },
    sfx: (n, o) => sfx.play(n, o),
    wobble: (x, y) => liquidWobble(x, y), // 水里的弹跟液体一起晃(折射)
    // 命中实体(HitboxComponent)/ 爆炸伤害 → 实体层
    // 玩家的弹打怪 + 刚体;敌人的弹打玩家(player_base Hitbox ≈ x −3..3, y −12..4)+ 刚体,不打自己人
    hitTest: (x, y, p) => p.owner === 'enemy'
      ? (x >= player.x - 3 && x <= player.x + 3 && y >= player.y - 12 && y <= player.y + 3 ? PLAYER_TARGET : entities.hitTestBodies(x, y))
      : entities.hitTest(x, y),
    // 击退(文档):final_knockback = knockback_force × 弹速 × 弹 mass / 目标 mass —— 目标 mass 我们没有,取 ×0.15 让 bullet(kb 1.8 / 500px/s)≈ 135 px/s;knockback_force 0 的(火花弹)不推人
    hitEntity: (t, p, dmg) => {
      const kb = ((p.d.knockback || 0) + (p.kbAdd || 0)) * 0.15
      if (t === PLAYER_TARGET) { damagePlayer(dmg, p.vx * kb, p.vy * kb - (kb ? 10 : 0), p.name); return }
      // 尸体效果:弹丸 ragdoll_fx_on_collision(激光 / 狙击 BLOOD_SPRAY,霰弹 / 锯片 BLOOD_EXPLOSION)或卡的 c.ragdoll_fx(火箭 2 / GORE 3);命中同时给的状态(冻 / 化尘)也决定尸体
      entities.hurt(t, dmg * (p.owner === 'enemy' ? 1 : (flags.damageMul || 1) * effectMul.dmgOut), p.vx * kb, p.vy * kb - (kb ? 15 : 0), 'proj', p.hitX ?? p.x, p.hitY ?? p.y, { ragdollFx: p.ragdollFx || p.d.ragdollFx || null, effects: p.effects })
      // damage_game_effect_entities(修饰卡 game_effect_entities 或弹自带):命中时给目标状态
      if (p.effects && !t.isBody && !t.dead) for (const f of p.effects) {
        if (f === 'frozen') { t.stunT = Math.max(t.stunT || 0, 120 / 60); t.frozenT = 120 / 60 } // effect_frozen frames=120,期间死了走 FROZEN 尸体
        else if (f === 'electricity') { t.stunT = Math.max(t.stunT || 0, 40 / 60); for (let k = 0; k < 4 && sparks.length < 600; k++) sparks.push({ x: t.x + (Math.random() - 0.5) * 8, y: t.y - 4 + (Math.random() - 0.5) * 10, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, c: '#80c0ff', life: 0.2 }) }
        else if (f === 'apply_on_fire') entities.ignite(t)
      }
    },
    // 追踪 / 自动瞄准 / 瞬移施法 要找目标:玩家的弹找怪,怪的弹找玩家;shooter=true(homing_shooter)找射手自己
    nearestTarget: (x, y, range, owner, { random = false, los = false, shooter = false } = {}) => {
      if (shooter) return owner === 'player' ? { x: player.x, y: player.y - 4 } : null
      if (owner === 'enemy') { const cy = player.y - 4; return Math.hypot(player.x - x, cy - y) <= range ? { x: player.x, y: cy } : null }
      return entities.nearest(x, y, range, { random, los })
    },
    aimAngle: () => Math.atan2(player.aimY - (player.y - 2), player.aimX - player.x),
    // TeleportProjectileComponent:玩家传到弹死的位置(reset_shooter_y_vel:y 速度归零)
    teleport: (x, y, tp) => {
      if (player.dead) return
      // 落点是实心就往上找空位(min_distance_from_wall 已在弹层退过一步)
      let ty = y; for (let k = 0; k < 24 && solidAt(Math.floor(x), Math.floor(ty)); k++) ty--
      player.x = x; player.y = ty; player.vx = 0; if (tp.resetY) player.vy = 0
      player.iframe = Math.max(player.iframe, 0.2)
      for (let k = 0; k < 12 && sparks.length < 600; k++) sparks.push({ x: player.x + (Math.random() - 0.5) * 10, y: player.y - 6 + (Math.random() - 0.5) * 14, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, c: '#c080ff', life: 0.3 })
      sfx.play('magic', { vol: 0.5, rate: 1.2, minGap: 100 }); oplog.ev('teleport_proj', { x: x | 0, y: ty | 0 })
    },
    // AreaDamageComponent(area_damage 修饰):每帧给 r 内的怪 dmg
    areaDamage: (x, y, r, dmg, p) => { for (const e of entities.list) { if (e.dead || e.isBody) continue; if (Math.hypot(e.x - x, (e.y + (e.hit.t + e.hit.b) / 2) - y) <= r) entities.hurt(e, dmg, 0, 0, 'proj') } },
    // 反 exe DamageMortals:中心在 r 内 + hitbox 能被射线够到 → 满额伤害(无衰减);击退 lerp(power) × knockback_force
    explosion: (x, y, r, dmg, reach2, power = [0, 0.2], kb = 1, ragdollFx = 0) => {
      entities.explosion(x, y, r, dmg, reach2, power, kb, ragdollFx)
      const cy = player.y - 4, d = Math.hypot(player.x - x, cy - y)
      if (d <= r && Entities.los(x, y, reach2, player.x, cy, 3, 8)) { const t = 1 - d / r, f = (power[0] + (power[1] - power[0]) * t) * kb * 120; damagePlayer(dmg, (player.x - x) / Math.max(1, d) * f, -f * 0.75, 'explosion') }
    },
    // 场(静止之环 / 雷霆之环):半径内的怪吃 effect_frozen(120 帧)/ effect_electricity(40 帧)—— 定住;电击顺带冒蓝火花
    areaEffect: (x, y, r, effects) => {
      for (const e of entities.list) {
        if (e.dead || Math.hypot(e.x - x, e.y - y) > r) continue
        for (const f of effects) {
          if (f === 'frozen') e.stunT = Math.max(e.stunT || 0, 120 / 60)
          else if (f === 'electricity') { e.stunT = Math.max(e.stunT || 0, 40 / 60); for (let k = 0; k < 4; k++) if (sparks.length < 600) sparks.push({ x: e.x + (Math.random() - 0.5) * 8, y: e.y - 4 + (Math.random() - 0.5) * 10, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, c: '#80c0ff', life: 0.2 }) }
        }
      }
    },
    spark: (x, y, vx, vy, c, life) => { if (sparks.length < 600) sparks.push({ x, y, vx, vy, c, life }) },
    // 巨大黑洞(BlackHoleComponent damage_probability 0.25 / damage_amount 0.1):圈内的怪 / 刚体 / 玩家每帧按概率吃一次伤害(玩家无视 0.5s 无敌帧,不然一秒只掉 0.5);
    // 吸力(attr = radius × 0.25 px/s 每帧,150px 内按距离衰减)拉怪、拉玩家、拉飞着的碎屑 —— wiki:"attracts enemies",玩家 "trying to resist its pull"
    // 反 noita_dev.exe BlackHoleSystem::Update:伤害每帧掷一次骰(rand < damage_probability)→ 半径内所有 mortal 扣 damage_amount;
    // 吸力:±radius 方框内的实体每帧 v += attractor × 1.5 × (径向 + 切向);飞着的碎屑按粒子吸引器(范围 3R,力 attractor × 0.025)拉
    blackHole: (x, y, r, prob, dmg, attr, dt, p) => {
      const roll = Math.random() < prob
      if (roll) entities.blackHole(x, y, r, dmg)
      entities.attract(x, y, r, attr, dt)
      const f60 = dt * 60
      if (!player.dead) {
        const dx = x - player.x, dy = y - (player.y - 4), d = Math.hypot(dx, dy)
        if (roll && d <= r + 3) damagePlayer(dmg, 0, 0, 'black_hole')
        if (Math.abs(dx) <= r && Math.abs(dy) <= r && d > 0.5) { const f = attr * 1.5 * f60, rx = dx / d, ry = dy / d; player.vx += (rx - ry) * f; player.vy += (ry + rx) * f; player.pullT = 0.1 }
      }
      const a = attr * 12 * dt, range = r * 3
      for (const q of debris) { const dx = x - q.x, dy = y - q.y, d = Math.hypot(dx, dy); if (d < range && d > 0.5) { q.vx += (dx / d) * a; q.vy += (dy / d) * a } }
    },
    // black_hole_gravity.lua:150px 内的刚体每帧 v += coeff × (1 − d/150) 朝黑洞(coeff 已 ×0.2);玩家 / 怪不是刚体,原版不吸(用户也要求自己别被吸进去)
    pull: (x, y, dist, coeff, dt) => entities.pull(x, y, dist, coeff, dt),
    // 电流走过的格(cells = [x,y,x,y,…]):碰到谁谁被电 —— 怪 / 玩家 都算(电水不认人),每个目标 10 帧最多电一次:
    //   ELECTROCUTION 40 帧定身(effect_electricity.xml)+ 电伤害 ELEC_DMG;玩家吃电不走 0.5s 无敌帧(wiki:湿身时电击没有无敌帧,泡在水里必然是湿的)
    shock: (cells) => {
      const now = performance.now()
      for (let i = 0; i < cells.length; i += 2) {
        const x = cells[i], y = cells[i + 1]
        const e = entities.hitTest(x, y)
        if (e && !e.dead && !(e.shockAt > now - 167)) {
          e.shockAt = now; e.stunT = Math.max(e.stunT || 0, 40 / 60)
          entities.hurt(e, ELEC_DMG, 0, 0, 'electricity', x, y)
          for (let k = 0; k < 6 && sparks.length < 600; k++) sparks.push({ x: e.x + (Math.random() - 0.5) * 8, y: e.y - 4 + (Math.random() - 0.5) * 10, vx: (Math.random() - 0.5) * 80, vy: (Math.random() - 0.5) * 80, c: Math.random() < 0.5 ? '#ffffff' : '#80c0ff', life: 0.25 })
        }
        if (!player.dead && !(player.shockAt > now - 167) && x >= player.x - 3 && x <= player.x + 3 && y >= player.y - 12 && y <= player.y + 3) {
          player.shockAt = now; player.stunT = Math.max(player.stunT || 0, 40 / 60)
          damagePlayer(ELEC_DMG, 0, 0, 'electricity')
          for (let k = 0; k < 6 && sparks.length < 600; k++) sparks.push({ x: player.x + (Math.random() - 0.5) * 6, y: player.y - 6 + (Math.random() - 0.5) * 10, vx: (Math.random() - 0.5) * 80, vy: (Math.random() - 0.5) * 80, c: Math.random() < 0.5 ? '#ffffff' : '#80c0ff', life: 0.25 })
        }
      }
    },
  },
})
// ── 实体层(敌人 / 动物):定义 entities.json,生成点由 Worker 按 lua 掷骰挂在 chunk.spawns ──
entities = await new Entities({
  res: RES, decodePng: decodePngBrowser, mats, sim, matAt, player, projectiles, seed: SEED,
  hooks: {
    wobble: (x, y) => liquidWobble(x, y), // 泡在液体里的怪跟液体一起晃(折射)
    // 血 / 油落地留下(真材质);箱子木屑 / 石块碎片(box2d 材质)是尘,飞一下就散
    debris: (x, y, vx, vy, m, col, real = false) => { const k = mats.kind[m]; if (debris.length < (real ? 3000 : 900)) debris.push({ x, y, vx, vy, m, col, dust: !real && (k === 'static' || k === 'solid') }) },
    sfx: (n, o) => sfx.play(n, o),
    shake: (t) => { shakeT = Math.max(shakeT, t) },
    glint: (x, y, life) => shine('08', x, y, { life }),
    damagePlayer: (dmg, ix, iy, src) => damagePlayer(dmg, ix, iy, src?.name || 'melee'),
    onDeath: (e) => {
      player.kills++; oplog.ev('kill', { e: e.name, x: e.x | 0, y: e.y | 0 })
      // necromancer_shop_death.lua:STEVARI_DEATHS +1(≥3 之后原作换 necromancer_super,这里只记数)
      if (e.name === 'necromancer_shop') { guard.deaths++; if (guard.deaths >= 3) { toast('众神的守卫愈发愤怒了…'); shakeT = Math.max(shakeT, 0.5) } }
    },
    spark: (x, y, vx, vy, c, life) => { if (sparks.length < 600) sparks.push({ x, y, vx, vy, c, life }) },
    pickup: (b) => {
      // 商店货(ItemCostComponent):钱不够拿不走(原版偷东西会惹怒神,这里先不给偷)
      if (b.shop) {
        const cost = flags.shopFree ? 0 : b.shop.cost
        if (player.gold < cost) { b.dead = false; b.pickCool = 0.8; sfx.play('clash', { vol: 0.15, rate: 2.2, minGap: 400 }); return }
        if (b.wand && player.wands.length >= (flags.wandSlots || 4) && !(FREE && player.wands.some((x) => !x.debug && !x.cards.length))) { b.dead = false; b.pickCool = 1; return }
        player.gold -= cost
        oplog.ev('buy', { what: b.shop.spell || b.wand?.key, cost: b.shop.cost, gold: player.gold })
        if (b.shop.spell) { player.spells.push(b.shop.spell); sfx.play('magic', { vol: 0.5, rate: 1.2 }); return }
      }
      if (b.wand) { if (!pickWand(b.wand)) { b.dead = false; b.pickCool = 1; toast(FREE ? `法杖 ${flags.wandSlots} 根都装了卡,没空杖可换(背包里取空一根再捡)` : '法杖背包满了(4 根)') } else tut.show('wand'); return } // 背包满:留在地上
      if (b.spell) { player.spells.push(b.spell); sfx.play('magic', { vol: 0.5, rate: 1.2 }); oplog.ev('pick_spell', { id: b.spell }); tut.show('spell'); return } // 散卡(工具箱掉的 / 偷来的商店卡)
      if (b.name === 'utility_box') { entities.openUtilityBox(b); oplog.ev('utility_box', { x: b.x | 0, y: b.y | 0 }); return }
      if (b.perk) { pickPerk(b); return }
      if (b.name === 'heart_fullhp_temple') { player.hp = player.maxHp; player.hpGrowT = 1.2; sfx.play('magic', { vol: 0.6, rate: 0.9 }); heartBurst(b.x, b.y - 12); printImportant('生命回满!', `${Math.round(player.maxHp * 25)} / ${Math.round(player.maxHp * 25)}`); oplog.ev('fullhp', {}); return } // 圣山回满血(heart_fullhp:heal_entity 到满 + 同一套心形特效)
      if (b.name === 'perk_reroll') {
        // 特权重掷机(perk_reroll.xml ItemCostComponent 400,每用一次翻倍):钱够 → 把摆着的特权全换一批(牌堆从尾往前发),机器留在原地
        const cost = perks.rerollCost()
        b.dead = false; b.pickCool = 1.2
        if (player.gold < cost) { toast(`重掷特权要 ${cost} 金`); sfx.play('clash', { vol: 0.15, rate: 2.2, minGap: 400 }); return }
        player.gold -= cost
        const cur = entities.bodies.filter((x) => x.perk && !x.dead)
        const fresh = perks.rerollMany(cur.map((x) => ({ x: x.x, y: x.y, group: x.group })))
        for (const x of cur) x.dead = true
        for (const p of fresh) { const d = perks.perk(p.id); if (d?.icon) entities.spawnPerkItem(d.icon, p.x, p.y, p.id, p.group) }
        sfx.play('magic', { vol: 0.6, rate: 1.4 }); oplog.ev('perk_reroll', { cost, ids: fresh.map((p) => p.id) })
        toast(`重掷特权(−${cost} 金):${fresh.map((p) => perks.perk(p.id)?.name || p.id).join(' / ')}`)
        return
      }
      if (b.potion) { if (player.items.length >= (flags.itemSlots || 4)) { b.dead = false; b.pickCool = 1; return } player.items.push({ potion: b.potion, name: '药水·' + (mats.list[mats.byName.get(b.potion.mat)]?.name || b.potion.mat) }); sfx.play('magic', { vol: 0.4, rate: 1.3 }); oplog.ev('pick_potion', { mat: b.potion.mat }); tut.show('potion'); return }
      if (b.name === 'chest_random') { entities.openChest(b); oplog.ev('chest', { x: b.x | 0, y: b.y | 0 }); return }
      if (b.name === 'heart') {
        // heart.lua:max_hp += 1×HEARTS_MORE_EXTRA_HP(封顶 max_hp_cap),引擎把加的量也补进 hp;heart_effect.xml 红火花描一颗心 + heart_out 动画;GamePrintImportant $log_heart
        const add = flags.heartMul || 1, capped = !!flags.hpCap
        if (!capped) player.maxHp += add
        player.hp = Math.min(player.maxHp, player.hp + add); player.hpGrowT = 1.2
        sfx.play('magic', { vol: 0.6, rate: 0.9 }); heartBurst(b.x, b.y - 12)
        printImportant('最大生命提升!', capped ? `最大生命已封顶(${Math.round(player.maxHp * 25)})` : `你的最大生命现在是 ${Math.round(player.maxHp * 25)}`)
        oplog.ev('heart', { maxHp: player.maxHp }); return
      }
      if (b.name === 'spell_refresh') { for (const w of player.wands) if (!w.debug) wands.refresh(w); sfx.play('magic', { vol: 0.5, rate: 1.5 }); shine('06', b.x, b.y - 6, { life: 0.56 }); for (let k = 0; k < 10; k++) shine('08', b.x, b.y - 6, { life: 0.2 + Math.random() * 0.4, vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.5) * 120 }); printImportant('法术刷新!', '所有法杖法力回满,有限次数的法术补满'); player.manaFlashT = 1; return }
      player.gold += Math.round((b.gold || 0) * (flags.goldMul || 1)); sfx.play('magic', { vol: 0.35, rate: 1.6 + Math.random() * 0.3, minGap: 60 }); oplog.ev('gold', { v: b.gold, total: player.gold })
      if (b.gold) { goldBurst(b.x, b.y, b.gold); tut.show('gold') }
    },
    // 煤矿祭坛的法杖(wand_001~017 固定数值 + level_1_wand.lua 掷卡 / wand_level_01 随机)→ 造好放在祭坛上
    spawnWand: (key, x, y) => { const w = wands.make(key, x, y); if (w) entities.spawnWandItem(w.def.sprite, x, y - 2, w) },
    // 法杖幽灵(wand_ghost.lua):出生捡一根 wand_level_03 拿着;死了掉出来
    ghostWand: (key, x, y) => { const w = wands.make(key, x, y); return w ? { image: w.def.sprite, wand: w } : null },
    dropWand: (w, x, y) => entities.spawnWandItem(w.def.sprite, x, y, w),
    // utility_box.lua make_random_utility_card:在全部法术里随机抽,直到抽到 UTILITY / MODIFIER 且没上锁(spawn_requires_flag)的
    utilityCard: () => { const all = Object.values(wands.spells).filter((s) => (s.type === 'UTILITY' || s.type === 'MODIFIER') && (!s.flag || wands.allUnlocked) && s.icon); const s = all[Math.floor(Math.random() * all.length)]; return s ? { id: s.id, icon: s.icon } : null },
    // 圣山:商店货(generate_shop_item / generate_shop_wand 掷法术与标价)、特权祭坛、传送门
    spawnSpecial: (s) => {
      const area = () => guard.areas.find((a) => s.x >= a.x0 && s.x <= a.x1 && s.y >= a.y0 && s.y <= a.y1) || null // shop_hitbox:出了这个框 = 偷
      if (s.entity === 'shop_item') {
        const it = wands.shopItem(s.x, s.y, s.sale), sp = wands.spell(it.spell)
        if (sp?.icon) entities.spawnSpellItem(sp.icon, s.x, s.y, { cost: it.cost, sale: it.sale, spell: it.spell, name: sp.name, area: area() })
      } else if (s.entity === 'shop_wand') {
        const it = wands.shopWand(s.x, s.y, s.sale), w = wands.make(it.key, s.x, s.y)
        if (w) entities.spawnWandItem(w.def.sprite, s.x, s.y - 2, w, { cost: it.cost, sale: it.sale, area: area() })
      } else if (s.entity === 'perks') { temple.spawnPerks?.(s.x, s.y); temple.guardPos?.(s.x + 30, s.y - 30) }
      else if (s.entity === 'portal') temple.spawnPortal?.(s.x, s.y)
      else if (s.entity === 'shop_area') temple.shopArea?.(s.x, s.y)
      else if (s.entity === 'areacheck') temple.areaCheck?.(s.x, s.y)
      else if (s.entity === 'workshop_exit') temple.exit?.(s.x, s.y)
    },
  },
}).init()
// 区块被 LRU 卸载 → 收掉里面的怪;回来时 spawnChunk 按生成表重刷(原版卸载区块也不保留活物)
// 实心植被(树 / 大蘑菇):像素在材质里,这里只管 SimplePhysics 整株下落
const veg = new Vegetation({ sim, mats, streamer, decodePng: decodePngBrowser, res: RES })
streamer.onEvict = (entry) => { entities.unloadChunk(entry); veg.unloadChunk(entry) }
const temple = {} // 特权 / 传送门在下面挂上
// ── 特权(perk.lua):牌堆 SetRandomSeed(1,2) 全世界一份,每座圣山按 TEMPLE_NEXT_PERK_INDEX 顺着发 3 个,拿一个其余消失 ──
const perks = await new PerkSystem({ res: RES, seed: SEED }).init()
player.perks = []
let perkGroup = 0
temple.spawnPerks = (x, y) => {
  const g = ++perkGroup
  // 图标 16px,标记点是祭坛面 → 图心抬 8px 坐在台面上
  for (const p of perks.spawnMany(x, y)) { const d = perks.perk(p.id); if (d?.icon) entities.spawnPerkItem(d.icon, p.x, p.y - 8, p.id, g) }
}
// ── 圣山守卫 Stevari(temple_shared.lua / temple_check_for_leaks.lua / generate_shop_item ItemCost stealable)──
//   shop_hitbox(±495 × −112..145,挂在 spawn_all_shopitems 点):标了价的货被弄出这个框 = 偷 → 变免费,惹怒众神
//   temple_areacheck_horizontal ×2((x+180, y−101) / (x+180, y+140)):aabb x −124..300、y 0..1 必须全是 templebrick(_noedge)_static,挖穿了 → 惹怒众神
//   惹怒:TEMPLE_SPAWN_GUARDIAN 还没设 → 在最近的 guardian_spawn_pos(特权祭坛 x+30, y−30)放 spawn_necromancer_shop(紫色漩涡 180 帧后出 Stevari);
//   之后每座新圣山 spawn_all_perks 时直接放守卫;"$logdesc_temple_spawn_guardian" + 摇镜 150;PEACE_WITH_GODS 特权 → 只提示不出
const guard = { areas: [], checks: [], guards: [], pending: [], angered: false, deaths: 0, t: 0 }
temple.shopArea = (x, y) => guard.areas.push({ x0: x - 495, x1: x + 490, y0: y - 112, y1: y + 145 })
temple.areaCheck = (x, y) => guard.checks.push({ x0: x - 124, x1: x + 300, y0: y, y1: y + 1, done: false })
temple.guardPos = (x, y) => { guard.guards.push({ x, y }); if (guard.angered && !flags.peaceWithGods) summonGuardian(x, y) }
const TEMPLE_BRICK = new Set(['templebrick_static', 'templebrick_noedge_static'].map((n) => mats.byName.get(n)).filter((v) => v > 0))
function summonGuardian(x, y) { guard.pending.push({ x, y, t: 3 }); sfx.play('magic', { vol: 0.8, rate: 0.5 }) }
function angerGods(x, y, why) {
  if (flags.peaceWithGods) { toast('众神对你的行为视而不见(与神和平)'); return }
  if (!guard.angered) {
    let best = null, bd = 800
    for (const g of guard.guards) { const d = Math.hypot(g.x - x, g.y - y); if (d < bd) { bd = d; best = g } }
    summonGuardian(best ? best.x : x, best ? best.y : y - 20)
  }
  guard.angered = true
  toast(guard.deaths < 3 ? '你惹怒了众神!' : '众神震怒!')
  shakeT = Math.max(shakeT, 1.2)
  oplog.ev('anger_gods', { why, x: x | 0, y: y | 0 })
}
function updateGuard(dt) {
  for (let i = guard.pending.length - 1; i >= 0; i--) {
    const p = guard.pending[i]
    p.t -= dt
    // 紫色漩涡(purple_whirl 粒子 + 紫光)
    for (let k = 0; k < 2; k++) { const a = Math.random() * 6.28, r = 4 + Math.random() * 14; if (sparks.length < 600) sparks.push({ x: p.x + Math.cos(a) * r, y: p.y - 16 + Math.sin(a) * r, vx: -Math.sin(a) * 40, vy: Math.cos(a) * 40, c: Math.random() < 0.5 ? '#a060ff' : '#e0a0ff', life: 0.5 }) }
    // necromancer_shop_spawn.lua:STEVARI_DEATHS < 3 出 Stevari,否则出强化版 necromancer_super
    if (p.t <= 0) { guard.pending.splice(i, 1); entities.spawnCreature(guard.deaths < 3 ? 'necromancer_shop' : 'necromancer_super', p.x, p.y); sfx.play('explosion', { vol: 0.5, rate: 1.6 }); oplog.ev('stevari', { x: p.x | 0, y: p.y | 0, super: guard.deaths >= 3 }) }
  }
  guard.t -= dt
  if (guard.t > 0) return
  guard.t = 0.5
  // 挖穿检查:两行砖有一格不是圣山砖 → 失败一次。第一次看全(区块都到了)时先对基线:本来就不全是砖的那行(altar_right 底行有 44 格 0x000042 标记像素)作废,不算
  for (const c of guard.checks) {
    if (c.done || Math.abs(c.x0 + 212 - player.x) > 700 || Math.abs(c.y0 - player.y) > 500) continue
    let bad = 0, unloaded = 0
    for (let y = c.y0; y <= c.y1 && !bad; y++) for (let x = c.x0; x <= c.x1; x++) { const m = matAt(x, y); if (m < 0) { unloaded++; continue } if (!TEMPLE_BRICK.has(m)) { bad++; break } }
    if (unloaded) continue
    if (!c.checked) { c.checked = true; if (bad) c.done = true; continue }
    if (bad) { c.done = true; angerGods(c.x0 + 212, c.y0, 'leak') }
  }
  // 偷:标价的货出了商店框
  for (const b of entities.bodies) {
    if (b.dead || !b.shop || !b.shop.area) continue
    const a = b.shop.area
    if (b.x < a.x0 || b.x > a.x1 || b.y < a.y0 || b.y > a.y1) { const what = b.shop.spell || b.wand?.key; b.shop = null; b.nailed = false; angerGods(b.x, b.y, 'steal:' + what) }
  }
}
// ── 圣山崩塌(workshop_exit.xml / workshop_exit.lua / workshop_collapse.lua / loose_chunks_workshop.xml)──
//   altar_right 里 0xa85454 放 workshop_exit:CollisionTrigger 52×52 只认玩家,踩到 →
//   workshop_collapse(x−144, y+82):摇镜 40 → 魔法符号粒子 → 40 帧后摇镜 + PhysicsRemoveJoints(±80)→ 20 帧后摇镜 + loose_chunks_workshop(x, y−12):
//     LooseGroundComponent max_distance 180 / probability 0.25 / chunk_probability 0.15 / chunk_material concrete_collapsed(box2d)—— 180px 内的地面成块松脱掉下来,砸满商店;
//   workshop_areadamage ×2(x−143 / x−543, y+47;aabb −391..63 × −99..78,1240 帧):留在圣山里的每 10 帧掉 0.01333(神山诅咒 DAMAGE_CURSE);
//   这一层的 temple_areachecker 全部杀掉(之后挖穿不再惹神);TEMPLE_COLLAPSED_<id>=1。
const collapsed = new Set() // 已崩的出口 "x,y"(存档)
const collapses = [] // 进行中:{ cx, cy, t, spawned, curse:[aabb], curseT }
temple.exits = []
temple.exit = (x, y) => temple.exits.push({ x, y })
/** 写一格材质:模拟窗口内走 sim(自动重画),窗口外直接改 chunk.mat 并排重画 */
function setCell(x, y, m) {
  if (simBound && sim.get(x, y) >= 0) { sim.set(x, y, m, 0); return true }
  const cx = Math.floor(x / CHUNK) + WCX, cy = Math.floor(y / CHUNK) + WCY, e = streamer.get(cx, cy)
  if (!e?.mat) return false
  e.mat[((y - (cy - WCY) * CHUNK) * CHUNK) + (x - (cx - WCX) * CHUNK)] = m
  const k = cx + ',' + cy; if (!repaintDue.has(k)) repaintDue.set(k, performance.now() + 150)
  return true
}
function startCollapse(ex, ey) {
  collapsed.add(ex + ',' + ey)
  const cx = ex - 144, cy = ey + 70 // workshop_collapse 落点 (x−144, y+82) 的 loose_chunks (·, y−12)
  collapses.push({ cx, cy, t: 0, spawned: 0, life: (320 + (Math.random() * 100 - 50)) / 60, curseT: 1240 / 60, curse: [[ex - 143 - 391, ey + 47 - 99, ex - 143 + 63, ey + 47 + 78], [ex - 543 - 391, ey + 47 - 99, ex - 543 + 63, ey + 47 + 78]] })
  shakeT = Math.max(shakeT, 0.7)
  // 魔法符号(magical_symbol 粒子):紫色一圈
  for (let k = 0; k < 60 && sparks.length < 600; k++) { const a = (k / 60) * 6.283; sparks.push({ x: cx + Math.cos(a) * 20, y: cy - 58 + Math.sin(a) * 20, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30 - 20, c: k & 1 ? '#c080ff' : '#ffffff', life: 0.9 }) }
  for (const c of guard.checks) if (Math.abs(c.y0 - ey) < 512) c.done = true // 杀掉这一层的 areachecker
  for (const b of entities.bodies) if (b.shop?.area && Math.abs(b.y - ey) < 512) b.shop.area = null // shop_hitbox 跟着圣山失效:被砸出去不算偷
  sfx.play('explosion', { vol: 0.7, rate: 0.5 })
  toast('圣山在你身后崩塌了 —— 众神的诅咒:别再回去', 8)
  oplog.ev('collapse', { x: ex | 0, y: ey | 0 })
}
/**
 * LooseGroundComponent 的 box2d 块(chunk_probability):形状取 procedural_gfx/collapse_big/0~14.png 之一(2×8 到 47×33 的不规则块),
 * 盖在射线打到的顶上,图里有像素且那格是静态地面的 → 抠掉,变 chunk_material = concrete_collapsed 的刚体(灰色 brick 纹理,不是砖色 —— 原版塌下来的是灰混凝土块)。
 * concrete_collapsed 材质:solid_on_collision_explode=1(砸到东西按它的 ExplosionConfig 炸一下:r4~20、震镜 15、concrete_sand 火花)、solid_on_sleep_convert=1 → 睡着变 concrete_static。
 */
const COLLAPSE_IMGS = []
for (let i = 0; i < 15; i++) decodePngBrowser(`${RES}/ent/collapse_big/${i}.png`).then((im) => { COLLAPSE_IMGS.push(im) }).catch(() => {})
function looseChunk(x, y) {
  if (!COLLAPSE_IMGS.length) return null
  const img = COLLAPSE_IMGS[(Math.random() * COLLAPSE_IMGS.length) | 0], w = img.width, h = img.height
  const mask = new Uint8Array(w * h)
  const x0 = Math.floor(x - w / 2), y0 = Math.floor(y - h / 2)
  let n = 0
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (img.data[(j * w + i) * 4 + 3] < 128) continue
    const m = matAt(x0 + i, y0 + j)
    if (!(m > 0 && KIND[m] === 'static')) continue
    mask[j * w + i] = 1; n++
  }
  if (n < 12) return null
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (mask[j * w + i]) setCell(x0 + i, y0 + j, 0)
  const b = entities.spawnLooseChunk(x0 + w / 2, y0 + h / 2, w, h, mask, null, 'concrete_collapsed')
  if (b) { b.vy = 10 + Math.random() * 20; b.w = (Math.random() - 0.5) * 2; b.collideExplode = true; b.sleepConvert = mats.byName.get('concrete_static') }
  return b
}
/** LooseGround 的射线:从 (cx,cy) 绕上方向 ±maxAngle 射 ≤180px,返回打到的第一块静态地面 */
function looseRay(cx, cy, maxAngle) {
  const a = -Math.PI / 2 + (Math.random() * 2 - 1) * maxAngle, ca = Math.cos(a), sa = Math.sin(a)
  for (let t = 1; t <= 180; t++) { const x = Math.floor(cx + ca * t), y = Math.floor(cy + sa * t), m = matAt(x, y); if (m < 0) return null; if (m > 0 && KIND[m] === 'static') return [x, y] }
  return null
}
function updateCollapse(dt) {
  // 踩到出口触发器(52×52,只认玩家)
  if (!player.dead) for (const e of temple.exits) {
    if (collapsed.has(e.x + ',' + e.y)) continue
    if (Math.abs(player.x - e.x) <= 26 && Math.abs(player.y - 4 - e.y) <= 26) startCollapse(e.x, e.y)
  }
  for (let i = collapses.length - 1; i >= 0; i--) {
    const c = collapses[i]
    c.t += dt
    if (c.t >= 0.67 && !c.shook1) { c.shook1 = true; shakeT = Math.max(shakeT, 0.7); for (const b of entities.bodies) if (b.nailed && !b.motor && Math.abs(b.x - c.cx) < 80 && Math.abs(b.y - c.cy) < 80) { b.nailed = false; b.restT = 0 } } // PhysicsRemoveJoints
    if (c.t >= 1.0 && !c.shook2) { c.shook2 = true; shakeT = Math.max(shakeT, 0.9); sfx.play('explosion', { vol: 0.9, rate: 0.4 }) }
    // loose_chunks_workshop.xml(1.0s 时 EntityLoad,LifetimeComponent 320±50 帧):LooseGroundComponent 每帧
    //   probability 0.25 → 绕上方向 ±2.1 rad 射一条 ≤180px 的线,打到的地面 3~8px 一团松脱成同材质的飞行像素(落地堆成砖色的渣);
    //   chunk_probability 0.15 → 绕上方向 ±0.7 rad(只打顶)射线,打到的顶按 collapse_big 形状抠一块 concrete_collapsed 灰混凝土刚体掉下来(砸地炸一下,睡着变 concrete_static)
    if (c.t >= 1.0 && c.t < 1.0 + c.life && simBound) {
      const f60 = dt * 60
      if (Math.random() < 0.25 * f60) projectiles._loosen(c.cx, c.cy, { prob: 1, maxAngle: 2.1, maxDist: 180, minR: 3, maxR: 8, particles: true }, 1)
      if (Math.random() < 0.15 * f60) { const hit = looseRay(c.cx, c.cy, 0.7); if (hit && looseChunk(hit[0], hit[1])) { c.spawned++; if (Math.random() < 0.5) sfx.play('impact', { vol: 0.5, rate: 0.6 + Math.random() * 0.3, minGap: 80 }) } }
    }
    // 神山诅咒:留在两块区域里掉血 + 红火星
    if (c.curseT > 0) {
      c.curseT -= dt
      const inCurse = c.curse.some(([x0, y0, x1, y1]) => player.x >= x0 && player.x <= x1 && player.y >= y0 && player.y <= y1)
      if (inCurse && !player.dead) {
        player.hp -= 0.01333 * 6 * dt; player.hurtFlash = Math.max(player.hurtFlash || 0, 0.06)
        if (player.hp <= 0) { player.iframe = 0; damagePlayer(0.001, 0, 0, 'curse') }
        if (Math.random() < dt * 2) toast('众神的诅咒在灼烧你 —— 离开圣山!', 2)
      }
      for (let k = 0; k < 3 && sparks.length < 600; k++) { const [x0, y0, x1, y1] = c.curse[k & 1]; const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0); if (Math.abs(x - cam.x) < VW && Math.abs(y - cam.y) < VH) sparks.push({ x, y, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4, c: '#ff3030', life: 0.5 + Math.random() * 1.5 }) }
    }
    if (c.t >= 1.0 + c.life && c.curseT <= 0) collapses.splice(i, 1)
  }
}
// ── 圣山入口:顶部漏斗底的传送门(altar_top.png 0xbf26a6 → teleport_liquid_powered.xml)──
//   TeleportComponent target_x_is_absolute_position=1 target (−677, +280):x 绝对 −677(altar_left 的入口洞),y 相对 +280;Hitbox ±15;
//   MaterialAreaChecker (x±2, y+136..140) 每 60 帧查 magic_liquid_teleportation / unstable:漏斗下的"眼睛"里有传送液才通电(enabled_by_liquid),抽干就灭;
//   灭 / 亮:LightComponent (64,100,255) r255 + r64,spark_purple 粒子环 r15(115 颗 / 12 帧,velocity_always_away_from_center 11)。
//   这就是原版进圣山的正规路:从上一层掉进漏斗,碰到传送门 → 落到圣山左侧入口洞。(圣山砖不可挖,漏斗底下 190px 是实心的)
temple.portals = []
temple.spawnPortal = (x, y) => temple.portals.push({ x, y, on: true, t: Math.random(), cd: 0 })
const TELE_LIQ = new Set(['magic_liquid_teleportation', 'magic_liquid_unstable_teleportation'].map((n) => mats.byName.get(n)).filter((v) => v > 0))
function updatePortals(dt) {
  for (const p of temple.portals) {
    if (Math.abs(p.x - player.x) > 600 || Math.abs(p.y - player.y) > 500) continue
    p.t -= dt
    if (p.t <= 0) {
      p.t = 1
      let n = 0, unloaded = 0
      for (let y = p.y + 136; y <= p.y + 140; y++) for (let x = p.x - 2; x <= p.x + 2; x++) { const m = matAt(x, y); if (m < 0) unloaded++; else if (TELE_LIQ.has(m)) n++ }
      if (!unloaded) { const was = p.on; p.on = n > 0; if (was && !p.on) toast('传送门熄灭了:下面眼睛里的传送液没了', 5) }
    }
    p.cd = Math.max(0, p.cd - dt)
    if (!p.on || player.dead || p.cd > 0) continue
    // Hitbox ±15 与玩家 Hitbox(x −3..3, y −12..4)相交即触发
    if (player.x + 3 >= p.x - 15 && player.x - 3 <= p.x + 15 && player.y + 4 >= p.y - 15 && player.y - 12 <= p.y + 15) {
      const tx = -677, ty = p.y + 280
      for (let k = 0; k < 40 && sparks.length < 600; k++) { const a = Math.random() * 6.283; sparks.push({ x: player.x, y: player.y - 4, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, c: '#b080ff', life: 0.5 }) }
      player.x = tx; player.y = ty; player.vx = 0; player.vy = 0; player.iframe = 1
      cam.x = tx; cam.y = ty
      p.cd = 2
      sfx.play('magic', { vol: 0.9, rate: 0.6 })
      shakeT = Math.max(shakeT, 0.2)
      toast('进入圣山:这里安全。货架碰一下 = 买 · 祭坛 3 选 1 天赋 · 改法杖 · 出口在右侧竖井', 8)
      oplog.ev('portal', { from: [p.x | 0, p.y | 0], to: [tx | 0, ty | 0] })
      tut.show('temple')
    }
  }
}
/** 传送门画法:紫色粒子环 + 中心亮点;灭了只剩暗环 */
function renderPortals(ctx, ox, oy) {
  const t = performance.now() / 1000
  for (const p of temple.portals) {
    const sx = p.x - ox, sy = p.y - oy
    if (sx < -30 || sy < -30 || sx > VW + 30 || sy > VH + 30) continue
    if (!p.on) { ctx.strokeStyle = 'rgba(80,60,120,0.5)'; ctx.beginPath(); ctx.arc(sx, sy, 15, 0, 7); ctx.stroke(); continue }
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * 6.283 + t * 1.6, r = 15 + Math.sin(t * 5 + k) * 1.5
      ctx.fillStyle = k % 3 ? 'rgba(160,120,255,0.9)' : 'rgba(230,210,255,0.95)'
      ctx.fillRect(Math.round(sx + Math.cos(a) * r), Math.round(sy + Math.sin(a) * r), 1, 1)
    }
    for (let k = 0; k < 6; k++) { const a = t * 3 + k * 1.05, r = 4 + ((t * 9 + k * 2.5) % 11); ctx.fillStyle = 'rgba(200,170,255,0.8)'; ctx.fillRect(Math.round(sx + Math.cos(a) * r), Math.round(sy + Math.sin(a) * r), 1, 1) }
    ctx.fillStyle = `rgba(120,140,255,${(0.35 + 0.15 * Math.sin(t * 6)).toFixed(2)})`; ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 7); ctx.fill()
    if (Math.random() < 0.4 && sparks.length < 600) { const a = Math.random() * 6.283; sparks.push({ x: p.x + Math.cos(a) * 15, y: p.y + Math.sin(a) * 15, vx: Math.cos(a) * 11, vy: Math.sin(a) * 11 - 8, c: '#a070ff', life: 2 + Math.random() }) }
  }
}
function pickPerk(b) {
  const d = perks.perk(b.perk)
  const had = perks.pickup(b.perk, { player, P, flags, R: (a, c) => a + Math.floor(Math.random() * (c - a + 1)) })
  player.perks.push(b.perk)
  entities.goldForever = !!flags.goldForever
  if (flags.shopCount) client.setGlobals({ shopCount: flags.shopCount }) // TEMPLE_SHOP_ITEM_COUNT → Worker(下一座圣山的商店按新件数掷)
  // perk_pickup:TEMPLE_PERK_DESTROY_CHANCE 100 → 同一祭坛其他特权撤掉
  if (b.group) entities.killGroup(b.group, b)
  sfx.play('magic', { vol: 0.7, rate: 0.8 })
  oplog.ev('perk', { id: b.perk, fx: had })
  toast(`特权:${d?.name || b.perk}${had ? '' : '(尚无效果)'} — ${d?.desc || ''}`)
}
let toastT = 0
const TIP0 = $('tip').textContent
function toast(msg, sec = 6) { $('tip').textContent = msg; toastT = sec }
// ── 沾污状态(SpriteStainsComponent → status_list.lua):按沾到的液体的材质 tag 定 ──
//   [water] WET(灭火、不着火) · [burnable] 液体 OILED(碰火即燃) · [blood] BLOODY · [slime] SLIMY(变慢) · [radioactive] RADIOACTIVE(掉血)
function stainKindOf(m) {
  const t = mats.list[m]?.tags || ''
  if (t.includes('[burnable]')) return 'OILED'
  if (t.includes('[slime]')) return 'SLIMY'
  if (t.includes('[radioactive]')) return 'RADIOACTIVE'
  if (t.includes('[blood]')) return 'BLOODY'
  return 'WET'
}
// ── GamePrintImportant(原版捡心 / 法术刷新 / 拿特权:屏幕中上方一行大字 + 一行说明,几秒淡出;heart.lua:"$log_heart" / "$logdesc_heart"(你的最大生命现在是 N))──
let importantT = 0
function printImportant(title, desc = '') {
  const el = $('important'); el.firstElementChild.textContent = title; el.lastElementChild.textContent = desc
  el.classList.add('on'); importantT = 3.5
}
// ── 闪光精灵粒子(particles/shine_08.xml 5×5×6 帧 0.09s 循环;shine_06.xml 13×13×8 帧 0.08s):金块的 SpriteParticleEmitter 用它 ──
const SHINE = { '08': { fw: 5, fh: 5, frames: 6, wait: 0.09, off: 2.5 }, '06': { fw: 13, fh: 13, frames: 8, wait: 0.08, off: 6.5 } }
for (const k of Object.keys(SHINE)) decodePngBrowser(`${RES}/proj/particles_shine_${k}.png`).then((im) => { SHINE[k].img = im }).catch(() => {})
function shine(kind, x, y, { life = 0.3, vx = 0, vy = 0, slow = 6, emissive = false } = {}) {
  const s = SHINE[kind]
  if (!s?.img) return
  projectiles.anims.push({ img: s.img, fw: s.fw, fh: s.fh, frames: s.frames, wait: s.wait * (0.667 + Math.random() * 0.333), loop: true, life, x, y, vx, vy, slow, angle: Math.random() * Math.PI * 2, offX: s.off, offY: s.off, t: 0, additive: true })
}
/** 捡金特效(gold_pickup.lua → particles/gold_pickup(_large/_huge).xml):6 帧内每帧一颗 shine_08 朝 ±50 飞出并减速,外加一颗 shine_06 的大闪(0.56s);>40 金 / >500 金的版本更多更大 */
function goldBurst(x, y, value) {
  const n = value > 500 ? 18 : value > 40 ? 10 : 6, sp = value > 500 ? 90 : value > 40 ? 70 : 50
  for (let i = 0; i < n; i++) shine('08', x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2, { life: 0.1 + Math.random() * 0.4, vx: (Math.random() - 0.5) * 2 * sp, vy: (Math.random() - 0.5) * 2 * sp })
  shine('06', x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 4, { life: 0.56, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20, emissive: true })
}
/**
 * 捡心特效(particles/image_emitters/heart_effect.xml):spark_red 沿 heart_effect.png 的心形从中心往外描(image_animation_raytrace_from_center,
 * 速度 5、每帧 8 颗、寿命 8~15 帧、按寿命淡出),这里用心形曲线代替描图:0.5s 内分批往外飞出一颗 ~24px 的红心
 */
function heartBurst(x, y) {
  const N = 72
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2
    // 心形参数方程(缩到 ±12px)
    const hx = 16 * Math.sin(t) ** 3, hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))
    const r = Math.hypot(hx, hy) * 0.75, ang = Math.atan2(hy, hx)
    const SPEED = 40, reach = r / SPEED // 从中心以同一速度往外飞,到心形轮廓就停(离中心越远越晚到)
    sparks.push({ x, y, vx: Math.cos(ang) * SPEED, vy: Math.sin(ang) * SPEED, c: i & 1 ? '#ff4060' : '#ff8090', life: reach + 0.2 + Math.random() * 0.12, stopAt: reach })
  }
}
const FIRE_PROTECT = new Set(['WET', 'BLOODY', 'SLIMY', 'RADIOACTIVE']) // status_list.lua protects_from_fire=true(OILED 表里也是 true,但实际是"更易燃、烧更久",按 wiki 处理)
/**
 * 沾污是"每种状态各一个量"(StatusEffectDataComponent.stain_effects 是 VECTOR_FLOAT,一项一种状态):精灵的每个像素只能被一种液体染色(SpriteStainsComponent),
 * 某状态的量 = 被给这种状态的液体染色的像素占比,所以水 + 毒液可以同时在身上、头顶两个图标一起亮(用户在原版看到的);新液体覆盖像素时旧的按比例被顶掉,总量 ≤ 100%。
 * 材质 liquid_sprite_stains_status_threshold(油 / 毒液 0.2):占比不到 20% 状态不生效(图标不出);水 / 血 / 黏液没写 = 0,沾一点就算。
 * player.stains = [{ mat, kind, amt(0~10 = 0~100%) }]
 */
const stainAmt = (kind) => { const s = player.stains.find((x) => x.kind === kind); return s ? s.amt : 0 }
const stainActive = (kind) => { const s = player.stains.find((x) => x.kind === kind); return !!s && s.amt >= (mats.list[s.mat]?.liquidSpriteStainsStatusThreshold || 0) * 10 }
/** 生效中的沾污状态(按量从大到小) */
const activeStains = () => player.stains.filter((s) => s.amt > 0 && stainActive(s.kind)).sort((a, b) => b.amt - a.amt)
/**
 * 着火(DamageModel fire_probability_of_ignition=1):碰到火时先看身上的沾污 —— 防火沾污被火烤掉(updateWet 里每秒 4 成),烤光才点着;
 * 点着后 mFireDurationFrames:4s(OILED ×3,"烧得久得多"),每 0.5s 一跳伤害 = 2% 最大血(wiki:2% of max HP per second),泡进任何液体立刻灭
 */
function ignitePlayer() {
  if (player.fireT > 0 || flags.protFire) return
  if (activeStains().some((s) => FIRE_PROTECT.has(s.kind))) return
  player.fireDur = stainActive('OILED') ? 12 : 4
  player.fireT = player.fireDur; player.fireTick = 0
  sfx.play('fire', { vol: 0.5, rate: 1.2, minGap: 200 })
  oplog.ev('ignite', { x: player.x | 0, y: player.y | 0 })
}
/** 玩家掉血(DamageModel):0.5s 无敌帧;死了回出生点(先这么处理,死亡画面后补) */
function damagePlayer(dmg, ix = 0, iy = 0, src = '') {
  const noIframe = src === 'black_hole' || src === 'electricity' // 黑洞是每帧按概率的持续伤害;电击(湿身)原版也没有无敌帧 —— 都不吃 0.5s 无敌
  if ((player.iframe > 0 && !noIframe) || dmg <= 0) return
  // 特权免伤:PROTECTION_MELEE / PROTECTION_EXPLOSION / PROTECTION_FIRE / PROTECTION_RADIOACTIVITY
  if ((flags.protMelee && src === 'melee') || (flags.protExplosion && src === 'explosion') || (flags.protFire && src === 'fire') || (flags.protRadioactive && /radioactive/.test(src))) return
  dmg *= effectMul.dmgIn // 喝了无敌药 0 / 虚弱药 ×2
  if (dmg <= 0) return
  if (flags.savingGrace && player.hp - dmg <= 0 && player.hp > 1 / 25) { flags.savingGrace--; dmg = player.hp - 1 / 25; toast('特权:垂死一搏 —— 保住了 1 点血') } // SAVING_GRACE:致命一击留 1 血,用一次
  player.hp -= dmg
  player.vx += ix; player.vy += iy
  if (!noIframe) player.iframe = 0.5
  player.hurtFlash = 0.25
  shakeT = Math.max(shakeT, 0.15)
  sfx.play(src === 'electricity' ? 'electric' : 'clash', { vol: 0.5, rate: 1.1, minGap: noIframe ? 300 : 80 })
  oplog.ev('hurt', { dmg: +dmg.toFixed(3), src, hp: +player.hp.toFixed(2) })
  if (player.hp <= 0) {
    oplog.ev('death', { x: player.x | 0, y: player.y | 0, src }); oplog.flush('death')
    // RESPAWN 特权:原地满血复活一次
    if (flags.respawn) { flags.respawn--; player.hp = player.maxHp; player.iframe = 2; toast('特权:额外生命 —— 原地复活'); return }
    showDeath(src)
  }
}
// ── 死亡画面:停掉玩家,显示这一局(深度 / 金 / 击杀 / 死因),"回出生点"保留身上东西继续,"重开一局"刷新 ──
const DEATH_SRC = { melee: '被近战打死', explosion: '被炸死', fire: '烧死', drown: '淹死', acid: '被酸腐蚀', lava: '被熔岩烧死', black_hole: '被黑洞吞了', electricity: '被电死' }
function showDeath(src) {
  player.dead = true; player.hp = 0
  $('deathInfo').textContent = `死因:${DEATH_SRC[src] || src || '未知'} · 深度 ${Math.max(0, player.y | 0)} · 金 ${player.gold} · 击杀 ${player.kills} · 特权 ${player.perks.length}`
  $('death').classList.add('on')
  sfx.play('clash', { vol: 0.8, rate: 0.6 })
  saveGame('death')
}
/**
 * 回出生点 = 原版的"新一局":Noita 死亡后世界整个重新生成(没有"接着上一局的地形"这回事),上一局炸开的坑 / 还在烧的火 / 连锁反应全没了。
 * 我们保留身上的东西(法杖 / 特权 / 金 —— 手机自由模式要的),但世界重置:清掉本种子的地形存档(IndexedDB)+ 圣山崩塌 / 守卫状态,然后整页重载,
 * 材质模拟 / 实体 / 弹丸全部从零起。不整页重载的话 streamer / sim / entities 里的旧 chunk 引用清不干净。
 */
let respawning = false
async function respawn() {
  if (respawning) return
  respawning = true
  player.dead = false; player.hp = player.maxHp; player.air = 7; player.fireT = 0; player.stains = []; player.iframe = 1.5
  player.x = 227; player.y = -120; player.vx = 0; player.vy = 0; player.fly = P.flyTimeMax
  cam.x = player.x; cam.y = player.y
  collapsed.clear(); guard.angered = false; guard.deaths = 0
  $('death').classList.remove('on')
  $('deathInfo').textContent = '重新生成世界…'
  oplog.ev('respawn', { worldReset: true })
  lastSave = ''; saveGame('respawn')
  streamer.store = null // 别让卸载 / flush 把上一局的脏 chunk 又写回去
  try { if (store) await store.clear(SEED) } catch (err) { console.warn('store.clear', err) }
  location.reload()
}
$('btnRespawn').addEventListener('click', (e) => { e.stopPropagation(); respawn() })
$('btnRestart').addEventListener('click', (e) => { e.stopPropagation(); clearSave(); location.replace(location.pathname + location.search.replace(/[?&]new=1/, '')) })
$('death').addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })
// 材质伤害(player_base DamageModel materials_that_damage / materials_how_much_damage,每帧)
const PLAYER_MAT_DMG = { acid: 0.005, lava: 0.003, blood_cold_vapour: 0.0006, blood_cold: 0.0009, poison: 0.001, radioactive_gas: 0.001, radioactive_gas_static: 0.001, rock_static_radioactive: 0.001, rock_static_poison: 0.001, ice_radioactive_static: 0.001, ice_radioactive_glass: 0.001, ice_acid_static: 0.001, ice_acid_glass: 0.001, rock_static_cursed: 0.005, magic_gas_hp_regeneration: -0.005, gold_radioactive: 0.0002, gold_static_radioactive: 0.0002, rock_static_cursed_green: 0.004, cursed_liquid: 0.0005, poo_gas: 0.00001 }
// 法杖池(名字对应 Noita 法术):施法延迟 cd 秒;count = 一次几颗(材质喷射类)
const WANDS = [
  { name: '火花弹', proj: 'light_bullet', cd: 0.08 },
  { name: '魔法箭', proj: 'bullet', cd: 0.15 },
  { name: '重型箭', proj: 'bullet_heavy', cd: 0.35 },
  { name: '火球', proj: 'fireball', cd: 0.6 },
  { name: '火焰弹', proj: 'grenade', cd: 0.5 },
  { name: '挖掘弹', proj: 'digger', cd: 0.05 },
  { name: '强力挖掘', proj: 'powerdigger', cd: 0.06 },
  { name: '酸液', proj: 'acidshot', cd: 0.35 },
  // 材质法术(ACTION_TYPE_MATERIAL):gun_actions.lua 里 fire_rate_wait -= 15 → 按住每帧一滴,是"喷雾",不是一团团糊
  { name: '水', proj: 'material_water', cd: 1 / 60, count: 1, spread: 0.06 },
  { name: '油', proj: 'material_oil', cd: 1 / 60, count: 1, spread: 0.06 },
  { name: '熔岩', proj: 'material_lava', cd: 1 / 60, count: 1, spread: 0.06 },
  { name: '火药', proj: 'material_gunpowder_explosive', cd: 1 / 60, count: 1, spread: 0.08 },
  { name: '弹力球', proj: 'rubber_ball', cd: 0.2 },
  { name: '锯刃', proj: 'disc_bullet', cd: 0.35 },
  { name: '箭', proj: 'arrow', cd: 0.3 },
  { name: '泡泡火花', proj: 'bubbleshot', cd: 0.08 },
  { name: '弹跳能量球', proj: 'bouncy_orb', cd: 0.3 },
  { name: '喷吐弹', proj: 'spitter', cd: 0.08 },
  { name: '冰球', proj: 'iceball', cd: 0.6 },
  { name: '火圈', proj: 'circle_fire', cd: 0.8 },
  { name: '水圈', proj: 'circle_water', cd: 0.8 },
  { name: '触水', proj: 'touch_water', cd: 0.5 },
  { name: '触金', proj: 'touch_gold', cd: 0.8 },
  { name: '发光弹', proj: 'glowing_bolt', cd: 0.4 },
  { name: '能量球', proj: 'bullet_slow', cd: 0.4 },
  { name: '长枪', proj: 'lance', cd: 0.5 },
  { name: '大锯刃', proj: 'disc_bullet_big', cd: 0.5 },
  { name: '崩塌大地', proj: 'crumbling_earth', cd: 1 },
  { name: '炸弹', proj: 'bomb', cd: 1.7 },        // gun_actions: fire_rate_wait +100 帧;3 秒引信,半径 60
  { name: '小炸弹', proj: 'bomb_small', cd: 1.2 },
]
let payload = 0
await projectiles.load(Object.keys(projDefs)) // 全部弹(法术表会掷到的 + 敌人的 e_*)
// Noita 原版玩家精灵(身体帧动画 + 手臂 + 法杖),发射点 = 杖尖
const sprite = await new PlayerSprite(RES, decodePngBrowser).load()
// 地表视差天空(?tod=0..1 指定一天的时刻,默认黄昏;?day=秒 一天的长度)
const sky = await new ParallaxSky(RES, decodePngBrowser, { phase: Q.has('tod') ? parseFloat(Q.get('tod')) : undefined, daySeconds: Q.has('day') ? parseFloat(Q.get('day')) : undefined }).init()
// ── 真法杖(gun.lua 施法模型):开局 Bolt staff + Bomb wand(player.xml),煤矿祭坛捡到的加进背包(最多 4 根)──
// ?debugwands=1 用上面那张每弹一根的测试表
const wands = await new WandSystem({ res: RES, seed: SEED, projectiles }).init()
wands.infinite = FREE; wands.allUnlocked = FREE
const DEBUG_WANDS = Q.get('debugwands') === '1'
WANDS.forEach((w, i) => { w.wandIdx = [6, 1, 12, 20, 33, 3, 9, 41, 14, 15, 27, 2, 50, 61, 17, 44, 55, 38, 70, 22, 23, 8, 31, 66, 47, 73, 60, 80][i] ?? (i * 7); w.debug = true })
player.wands = DEBUG_WANDS ? WANDS : [wands.make('starting_wand', 227, -120), wands.make('starting_bomb_wand', 227, -120)]
player.items = [] // 药水(原版 4 个物品格),排在法杖后面,选中后"开火"= 扔
player.spells = [] // 买到 / 捡到还没装进法杖的法术卡(原版背包里的散卡),圣山里可以编辑法杖
// ── 存档(localStorage,按种子一份):人 / 法杖 / 药水 / 散卡 / 特权 / 守卫 / 已崩的圣山;地形改动由 ChunkStore(IndexedDB)另存 ──
//   每 5s 有变化就存,切后台 / 关页立刻存;死亡画面"重开一局"清档;?new=1 忽略存档开新局
const SAVE_KEY = `noita_save_${SEED}`
const serWand = (w) => ({ key: w.key, x: w.x, y: w.y, name: w.name, cards: w.cards, uses: w.uses, deckCapacity: w.deckCapacity, actionsPerRound: w.actionsPerRound, reloadTime: w.reloadTime, shuffle: w.shuffle, fireRateWait: w.fireRateWait, spread: w.spread, speedMul: w.speedMul, manaMax: w.manaMax, manaCharge: w.manaCharge, mana: w.mana })
let lastSave = ''
function saveGame(why = 'tick') {
  if (DEBUG_WANDS) return
  const s = {
    v: 1, t: Date.now(),
    player: { x: player.x, y: player.y, hp: player.hp, maxHp: player.maxHp, gold: player.gold, kills: player.kills },
    perks: player.perks, perkState: { nextIndex: perks.nextIndex, picked: perks.picked, rerollCount: perks.rerollCount || 0, rerollIndex: perks.rerollIndex ?? null },
    wands: player.wands.map(serWand), items: player.items.map((i) => ({ potion: i.potion, name: i.name })), spells: player.spells, payload,
    guard: { angered: guard.angered, deaths: guard.deaths }, collapsed: [...collapsed],
  }
  const json = JSON.stringify(s)
  if (json === lastSave) return false
  lastSave = json
  try { localStorage.setItem(SAVE_KEY, json) } catch { return false }
  if (why !== 'tick') oplog.ev('save', { why })
  return true
}
function loadGame() {
  if (DEBUG_WANDS || Q.get('new') === '1') return false
  let s = null
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') } catch { return false }
  if (!s || s.v !== 1 || !s.player) return false
  // 特权:按拿的顺序重放效果(改 player.maxHp / P / flags),再用存档覆盖血量;牌堆指针照存档
  for (const id of s.perks || []) perks.pickup(id, { player, P, flags, R: (a, c) => a + Math.floor(Math.random() * (c - a + 1)) })
  player.perks = [...(s.perks || [])]
  if (s.perkState) { perks.nextIndex = s.perkState.nextIndex || 1; perks.picked = s.perkState.picked || {}; perks.rerollCount = s.perkState.rerollCount || 0; if (s.perkState.rerollIndex != null) perks.rerollIndex = s.perkState.rerollIndex }
  entities.goldForever = !!flags.goldForever
  if (flags.shopCount) client.setGlobals({ shopCount: flags.shopCount })
  const ws = []
  for (const sw of s.wands || []) {
    const w = wands.make(sw.key, sw.x, sw.y) || wands.make('starting_wand', 227, -120)
    if (!w) continue
    Object.assign(w, { name: sw.name, cards: sw.cards || [], uses: sw.uses || {}, deckCapacity: FREE ? Math.max(FREE_CAPACITY, sw.deckCapacity || 0) : sw.deckCapacity, actionsPerRound: sw.actionsPerRound, reloadTime: sw.reloadTime, shuffle: sw.shuffle, fireRateWait: sw.fireRateWait, spread: sw.spread, speedMul: sw.speedMul, manaMax: sw.manaMax, manaCharge: sw.manaCharge, mana: sw.mana ?? sw.manaMax })
    w.deck = w.cards.slice(); w.reloadT = 0
    ws.push(w)
  }
  if (ws.length) player.wands = ws
  player.items = (s.items || []).filter((i) => i?.potion).map((i) => ({ potion: i.potion, name: i.name }))
  player.spells = [...(s.spells || [])]
  const died = !(s.player.hp > 0) // 死在那儿没点"回出生点"就关了页:回出生点满血继续(和按钮一样保留东西)
  Object.assign(player, { x: died ? 227 : s.player.x, y: died ? -120 : s.player.y, hp: died ? s.player.maxHp : s.player.hp, maxHp: s.player.maxHp, gold: s.player.gold || 0, kills: s.player.kills || 0, vx: 0, vy: 0 })
  cam.x = player.x; cam.y = player.y
  payload = Math.min(s.payload || 0, player.wands.length + player.items.length - 1)
  if (s.guard) { guard.angered = !!s.guard.angered; guard.deaths = s.guard.deaths || 0 }
  for (const k of s.collapsed || []) collapsed.add(k)
  lastSave = JSON.stringify(s)
  oplog.ev('load', { x: player.x | 0, y: player.y | 0, wands: player.wands.length, perks: player.perks.length })
  return true
}
const loaded = loadGame()
if (loaded) setTimeout(() => toast(`继续上次:深度 ${Math.max(0, player.y | 0)} · 金 ${player.gold} · ${player.wands.length} 根法杖(重开一局请死亡后选"重开")`, 6), 900)
function clearSave() { try { localStorage.removeItem(SAVE_KEY) } catch { /* */ } lastSave = '' }
let saveT = 0
window.addEventListener('pagehide', () => saveGame('pagehide'))
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame('hidden') })
const slots = () => [...player.wands, ...player.items]
const curWand = () => { const s = slots(); return s[payload % s.length] }
let shownWand = null
async function syncWand() {
  const w = curWand()
  if (shownWand === w) return
  shownWand = w
  if (w.debug) await sprite.setWand(w.wandIdx)
  else if (w.potion) await sprite.setWandUrl(`${RES}/ent/items_gfx_potion.png`)
  else { const u = wands.spriteUrl(w); if (u) await sprite.setWandUrl(u) }
}
syncWand()
// ── 物品栏底栏:每格一根法杖 / 一瓶药水,当前格高亮,底边蓝线 = 法力;点格子切换(手机主要靠这个换杖)──
const slotsEl = $('slots')
let slotsSig = ''
function renderSlots() {
  const s = slots(), cap = Math.max(s.length, DEBUG_WANDS ? 0 : (flags.wandSlots || 4))
  const sig = s.map((w, i) => (w.debug ? w.name : w.potion ? 'p' + w.potion.mat : w.key + w.cards.length + JSON.stringify(w.uses)) + (i === payload ? '*' : '')).join('|') + cap
  if (sig !== slotsSig) {
    slotsSig = sig; slotsEl.innerHTML = ''
    for (let i = 0; i < cap; i++) {
      const w = s[i], el = document.createElement('div')
      el.className = 'slot' + (w ? '' : ' empty') + (i === payload ? ' cur' : '') + (w?.potion ? ' potion' : '')
      if (w) {
        const u = w.debug ? null : w.potion ? `${RES}/ent/items_gfx_potion.png` : wands.spriteUrl(w)
        if (u) el.style.backgroundImage = `url(${u})`
        el.title = w.name
        const m = document.createElement('i'); el.appendChild(m)
        // 有限次数的卡:右下角标剩余次数;用光了整格变暗
        if (!w.debug && !w.potion) {
          const lim = Object.values(w.uses || {})
          if (lim.length) { const u = document.createElement('u'); u.textContent = '×' + lim.reduce((a, b) => a + b, 0); el.appendChild(u) }
          if (!w.cards.some((c) => !(c in w.uses) || w.uses[c] > 0)) el.classList.add('spent')
        }
        el.addEventListener('click', (e) => { e.stopPropagation(); payload = i; oplog.ev('wand', { payload }) })
        el.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); payload = i; oplog.ev('wand', { payload }) }, { passive: false })
      }
      const b = document.createElement('b'); b.textContent = i < 9 ? i + 1 : i === 9 ? '0' : i === 10 ? '-' : '='; el.appendChild(b)
      slotsEl.appendChild(el)
    }
  }
  // 法力条实时
  const els = slotsEl.children
  for (let i = 0; i < s.length && i < els.length; i++) { const w = s[i], m = els[i].firstElementChild; if (!m) continue; m.style.transform = `scaleX(${w.potion ? Math.min(1, w.potion.left / 1000) : w.debug ? 1 : Math.max(0, w.mana / w.manaMax)})`; m.style.background = w.potion ? '#a0e0ff' : w.reloadT > 0 ? '#e0a040' : player.manaFlashT > 0 && (player.manaFlashT * 8 | 0) % 2 ? '#ffffff' : '#7fd4ff' } // 法术刷新后法力条闪白
}
let wandTip = { x: 0, y: 0 }
function fire() {
  const w = curWand()
  const a = Math.atan2(player.aimY - (player.y - 2), player.aimX - player.x)
  if (w.potion) {
    // PhysicsThrowable:max_throw_speed 180,朝瞄准方向扔出去
    const sp = 180
    entities.throwItem('potion', player.x + Math.cos(a) * 6, player.y - 4 + Math.sin(a) * 6, Math.cos(a) * sp + player.vx * 0.3, Math.sin(a) * sp - 20, { potion: w.potion })
    player.items.splice(player.items.indexOf(w), 1)
    payload = Math.min(payload, slots().length - 1)
    player.fireCd = 0.4
    sfx.play('wind', { vol: 0.3, rate: 1.4 })
    oplog.ev('throw_potion', { mat: w.potion.mat })
    return
  }
  if (w.debug) {
    for (let k = 0; k < (w.count || 1); k++) projectiles.spawn(w.proj, wandTip.x, wandTip.y, a, { spreadRad: w.spread || 0 })
    player.fireCd = w.cd
    return
  }
  const r = wands.cast(w, a, (name, off, c, payload) => projectiles.spawn(name, wandTip.x, wandTip.y, a + off, { c, payload }))
  // shot_effects.recoil_knockback(反 exe GunSystem::ShootShot):射手 mVelocity −= 瞄准方向 × recoil —— 后座力卡 +200,朝下打就能一直浮着
  if (r?.recoil > 0) { player.vx -= Math.cos(a) * r.recoil; player.vy -= Math.sin(a) * r.recoil; player.pullT = 0.1 }
  if (r?.noMana) sfx.play('clash', { vol: 0.12, rate: 2.4, minGap: 250 })
  if (r?.empty) {
    // 有限次数的法术(炸弹 3 次 / 黑洞 …)用光了,杖是空的:原版就是这样,圣山的"法术刷新"补满,或者装别的卡
    sfx.play('clash', { vol: 0.12, rate: 2.0, minGap: 600 })
    if (toastT <= 0 || !/用完了/.test($('tip').textContent)) toast(`${w.name} 里的${w.lastEmptied || '法术'}用完了(有限次数的卡,用光就没了)—— 圣山的"法术刷新"能补满,或在圣山把别的卡装进去`, 5)
    player.fireCd = 0.3
    return
  }
  player.fireCd = 0
}
// ── 喝药水(IngestionComponent + materials.xml status_effects + status_list.lua):一口 250 单位,液体的 status_effects 按 effect_*.xml 的 frames 给时长 ──
// 数值来自 data/entities/misc/effect_*.xml 的 GameEffectComponent frames(600 = 10s);没有效果实体的(HP_REGENERATION / POISONED)按材质伤害表口径给
const EFFECT_DEFS = {
  WET: { dur: 10, name: '湿' }, OILED: { dur: 10, name: '沾油' }, BLOODY: { dur: 10, name: '沾血' }, SLIMY: { dur: 10, name: '黏液' }, RADIOACTIVE: { dur: 10, name: '辐射' },
  ALCOHOLIC: { dur: 20, name: '醉了' }, POISONED: { dur: 20, name: '中毒' }, TELEPORTATION: { dur: 5 + Math.random() * 5, name: '传送病' }, UNSTABLE_TELEPORTATION: { dur: 6, name: '乱传送' },
  HP_REGENERATION: { dur: 6, name: '回血' }, MANA_REGENERATION: { dur: 2.5, name: '回法力' }, MOVEMENT_FASTER_2X: { dur: 10, name: '疾跑' }, FASTER_LEVITATION: { dur: 10, name: '快浮' },
  PROTECTION_ALL: { dur: 120, name: '无敌' }, INVISIBILITY: { dur: 120, name: '隐身' }, BERSERK: { dur: 12, name: '狂暴' }, CONFUSION: { dur: 16.7, name: '混乱' }, WEAKNESS: { dur: 10, name: '虚弱' },
  NIGHTVISION: { dur: 10, name: '夜视' }, WORM_ATTRACTOR: { dur: 10, name: '引虫' }, POLYMORPH: { dur: 0, name: '变形(未做)' }, POLYMORPH_RANDOM: { dur: 0, name: '变形(未做)' }, TRIP: { dur: 0, name: '幻觉(未做)' }, CHARM: { dur: 0, name: '魅惑' },
}
const effects = {} // id → 剩余秒
const hasEffect = (id) => (effects[id] || 0) > 0
function addEffect(id, mul = 1) {
  const d = EFFECT_DEFS[id]
  if (!d || d.dur <= 0) { toast(`喝下去:${d?.name || id}`); return }
  effects[id] = Math.max(effects[id] || 0, d.dur * mul)
  if (['WET', 'OILED', 'BLOODY', 'SLIMY', 'RADIOACTIVE'].includes(id)) addStain(mats.byName.get({ WET: 'water', OILED: 'oil', BLOODY: 'blood', SLIMY: 'slime', RADIOACTIVE: 'radioactive_liquid' }[id]) || 0, id, 10)
  toast(`${d.name} ${Math.round(d.dur * mul)}s`)
}
/** 喝一口手里的药水 */
function drink() {
  const w = curWand()
  if (!w?.potion || w.potion.left <= 0) return
  const gulp = Math.min(250, w.potion.left)
  w.potion.left -= gulp
  const m = mats.list[mats.byName.get(w.potion.mat)]
  const fx = (m?.statusEffects || '').split(',').map((s) => s.trim()).filter(Boolean)
  for (const id of fx) addEffect(id, gulp / 250)
  // 本身就伤人的液体(酸 / 熔岩 / 毒)喝下去按材质伤害表 ×60 帧的量掉血
  const dmg = PLAYER_MAT_DMG[w.potion.mat]
  if (dmg > 0) damagePlayer(dmg * 60 * 0.5, 0, 0, w.potion.mat)
  if (!fx.length && !dmg) toast(`喝了一口${m?.name || w.potion.mat}…没什么感觉`)
  sfx.play('water', { vol: 0.4, rate: 1.4 })
  oplog.ev('drink', { mat: w.potion.mat, left: w.potion.left, fx })
  if (w.potion.left <= 0) { player.items.splice(player.items.indexOf(w), 1); payload = Math.min(payload, slots().length - 1) } // 喝空了瓶子没了(原版空瓶还留着,先简化)
}
/** 效果每帧:回血 / 中毒 / 传送 / 回法力;倒计时 */
function tickEffects(dt) {
  for (const id in effects) {
    if (effects[id] <= 0) continue
    effects[id] -= dt
    if (id === 'INVISIBILITY') player.invisible = effects[id] > 0
    if (id === 'HP_REGENERATION') player.hp = Math.min(player.maxHp, player.hp + 0.4 * dt)
    else if (id === 'POISONED') { player.hp -= 0.03 * dt; if (player.hp <= 0) { player.iframe = 0; damagePlayer(0.001, 0, 0, 'poison') } }
    else if (id === 'MANA_REGENERATION') for (const w of player.wands) if (!w.debug) w.mana = w.manaMax
    else if (id === 'TELEPORTATION' || id === 'UNSTABLE_TELEPORTATION') {
      effects._tpT = (effects._tpT || 0) - dt
      if (effects._tpT <= 0) { effects._tpT = id === 'UNSTABLE_TELEPORTATION' ? 0.8 + Math.random() : 1.5 + Math.random() * 2; teleportRandom(id === 'UNSTABLE_TELEPORTATION' ? 120 : 200) }
    }
  }
}
/** 传送病:附近随机一个能站人的空位 */
function teleportRandom(r) {
  for (let k = 0; k < 40; k++) {
    const x = Math.floor(player.x + (Math.random() - 0.5) * 2 * r), y = Math.floor(player.y + (Math.random() - 0.5) * 2 * r)
    let ok = true
    for (let dy = -12; dy <= 2 && ok; dy += 2) for (let dx = -2; dx <= 2 && ok; dx += 2) if (solidAt(x + dx, y + dy) || matAt(x + dx, y + dy) < 0) ok = false
    if (!ok) continue
    player.x = x; player.y = y; player.vx = 0; player.vy = 0
    sfx.play('magic', { vol: 0.5, rate: 0.7 }); return
  }
}
const effectMul = {
  get move() { return hasEffect('MOVEMENT_FASTER_2X') ? 2 : 1 },
  get fly() { return hasEffect('FASTER_LEVITATION') ? 1.5 : 1 },
  get dmgOut() { return hasEffect('BERSERK') ? 2 : 1 },
  get dmgIn() { return hasEffect('PROTECTION_ALL') ? 0 : hasEffect('WEAKNESS') ? 2 : 1 },
  get dir() { return hasEffect('CONFUSION') ? -1 : 1 },
}
window.addEventListener('keydown', (e) => { if (e.key === 'f' && !editor.open) drink() })
$('btnDrink').addEventListener('click', (e) => { e.stopPropagation(); drink() })
$('btnDrink').addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })

/** 自由模式:空法杖(借 17 根固定杖之一的外形,清空卡 / 不洗牌 / 20 格 / 施法延迟 5f),把背包补满到 wandSlots 根 —— 底栏每一格都是一根能装卡的杖,不然玩家看到 8 个格子却只有 2 根杖能装 */
const BLANK_KEYS = ['wand_006', 'wand_010', 'wand_013', 'wand_003', 'wand_009', 'wand_001', 'wand_016', 'wand_008']
function blankWand(i) {
  const w = wands.make(BLANK_KEYS[i % BLANK_KEYS.length], 0, 0)
  if (!w) return null
  Object.assign(w, { name: `空法杖 ${i + 1}`, cards: [], uses: {}, deck: [], shuffle: false, actionsPerRound: 1, deckCapacity: FREE_CAPACITY, fireRateWait: 5, spread: 0, reloadTime: 0 })
  return w
}
function fillWands() {
  if (!FREE || DEBUG_WANDS) return
  while (player.wands.length < (flags.wandSlots || 4)) { const w = blankWand(player.wands.length); if (!w) break; player.wands.push(w) }
}
fillWands() // 新局 / 读档之后都补满(老存档只有 2 根也补到 8)
/** 捡法杖:背包没满就收(原版 4 格),满了不捡;自由模式满了就顶掉一根还没装卡的空杖 */
function pickWand(w) {
  if (DEBUG_WANDS) return false
  if (player.wands.length >= (flags.wandSlots || 4)) {
    const k = FREE ? player.wands.findIndex((x) => !x.debug && !x.cards.length) : -1
    if (k < 0) return false
    if (flags.noShuffle) w.shuffle = false
    player.wands[k] = w; payload = k
    sfx.play('magic', { vol: 0.5, rate: 1.1 })
    oplog.ev('pick_wand', { key: w.key, cards: w.cards, replaced: k })
    return true
  }
  if (flags.noShuffle) w.shuffle = false
  if (flags.fasterWands) for (let i = 0; i < flags.fasterWands; i++) { w.reloadTime = w.reloadTime * 0.8 - 5; w.fireRateWait = w.fireRateWait * 0.8 - 5; w.manaCharge += 30 }
  player.wands.push(w); payload = player.wands.length - 1
  sfx.play('magic', { vol: 0.5, rate: 1.1 })
  oplog.ev('pick_wand', { key: w.key, cards: w.cards })
  return true
}
// ── 圣山法杖编辑(原版:只在圣山 workshop 区域里允许改牌;这里 = 玩家所在 chunk 是 temple_altar*)──
// 圣山行的上 260px 是屋顶(漏斗 + 砖),站在漏斗里不算进了圣山
const inTemple = () => !!flags.editAnywhere || (/^temple_altar/.test(streamer.get(Math.floor(player.x / 512) + 35, Math.floor(player.y / 512) + 14)?.biome || '') && player.y > Math.floor(player.y / 512) * 512 + 260)
let edSel = 0
const editor = {
  open: false,
  canEdit: false, // 圣山里(或 EDIT_WANDS_EVERYWHERE)才能改;别处只能看
  toggle(on) {
    this.open = on ?? !this.open
    $('editor').classList.toggle('on', this.open); $('btnBag').classList.toggle('on', this.open)
    if (this.open) { if (payload < player.wands.length && !player.wands[payload].debug) edSel = payload; this._scrollSel = true; this.canEdit = inTemple(); $('editor').classList.toggle('readonly', !this.canEdit); $('edTitle').textContent = FREE ? '法杖编辑' : this.canEdit ? '圣山 · 法杖编辑' : '背包'; this.render(); if (!this.canEdit) tut.show('bagRO') }
  },
  /** 自由模式的法术库:所有能放出东西的法术(按类型分组),点一张装进选中法杖;只建一次 DOM */
  renderLib() {
    const L = $('edLib'); if (!L || L.childElementCount) return
    const all = wands.usableSpells()
    for (const type of ['PROJECTILE', 'STATIC_PROJECTILE', 'MATERIAL', 'DRAW_MANY', 'MODIFIER', 'UTILITY', 'OTHER']) {
      const list = all.filter((s) => s.type === type)
      if (!list.length) continue
      const T = this.TYPES[type]
      const h = document.createElement('div'); h.className = 'libh'; h.innerHTML = `<i style="background:${T[1]}"></i>${T[0]} ${list.length}${T[2] ? ` <span>— ${T[2]}</span>` : ''}`; L.appendChild(h)
      const grid = document.createElement('div'); grid.className = 'inv'
      for (const s of list) grid.appendChild(this.cardEl(s.id, () => this.addLib(s.id)))
      L.appendChild(grid)
    }
  },
  addLib(id) {
    const w = player.wands[edSel]
    if (!w || w.debug) { this.msg('先点选上面的一根法杖'); return }
    if (w.cards.length >= w.deckCapacity) { this.msg(`${w.name} 满了(容量 ${w.deckCapacity}):点杖里的卡取下,或把「容量」+`); sfx.play('clash', { vol: 0.15, rate: 2.2 }); return }
    w.cards.push(id)
    this.msg(`${wands.spell(id)?.name || id} → ${w.name}(第 ${w.cards.length} 张)`)
    this.after(w)
  },
  /** 编辑器里的提示(#tip 在遮罩下面看不见,单独一行) */
  msg(s) { const el = $('edMsg'); if (!el) return; el.textContent = s; clearTimeout(this._msgT); this._msgT = setTimeout(() => { el.textContent = '' }, 4000) },
  // 法术类型(gun_actions.lua ACTION_TYPE_*)→ 卡框颜色 / 中文 / 一句话规则
  TYPES: {
    PROJECTILE: ['弹丸', '#d86a6a', '飞出去的弹'], STATIC_PROJECTILE: ['场', '#d8a24a', '在杖尖原地生成、停留一段时间的场'], MATERIAL: ['材质', '#5ab0d8', '喷出 / 生成真材质'],
    MODIFIER: ['修饰', '#7c7ce8', '改同一次放出的弹(和它一起抽到的那一组)'], DRAW_MANY: ['多重', '#5ac86a', '再多抽 N 张,和它一起同一下放出'], UTILITY: ['工具', '#bdbdbd', ''], OTHER: ['其他', '#b070c8', ''], PASSIVE: ['被动', '#888', ''],
  },
  // gun_actions.lua 里这张卡对 c 的改动 → 人话
  opsText(s) {
    const F = { fire_rate_wait: ['施法延迟', 'f'], speed_multiplier: ['速度', '×'], spread_degrees: ['散射', '°'], damage_projectile_add: ['伤害', ''], damage_explosion_add: ['爆炸伤害', ''], damage_explosion: ['爆炸伤害', ''], explosion_radius: ['爆炸半径', 'px'], lifetime_add: ['寿命', 'f'], bounces: ['反弹', '次'], gravity: ['重力', ''], knockback_force: ['击退', ''], recoil_knockback: ['后座力', ''], reload_time: ['充能', 'f'], damage_critical_chance: ['暴击率', '%'], friendly_fire: ['友伤', ''], damage_electricity_add: ['电伤害', ''], damage_fire_add: ['火伤害', ''], damage_ice_add: ['冰伤害', ''] }
    const EX = { homing: '追踪敌人', homing_short: '短距追踪', homing_shooter: '绕着自己转', anti_homing: '躲开敌人', homing_rotate: '缓慢转向敌人', homing_accelerating: '越追越快', homing_cursor: '跟着法杖朝向', autoaim: '出手就瞄向最近敌人', piercing_shot: '穿过敌人', clipping_shot: '穿墙(墙里变慢)', fly_upwards: '20 帧后竖直向上', fly_downwards: '20 帧后竖直向下', sinewave: '走波浪线', chaotic_arc: '乱抖', floating_arc: '贴地面漂', avoiding_arc: '避开墙', lifetime_infinite: '永不消失', remove_bounce: '不反弹', nolla: '立刻消失', accelerating_shot: '越飞越快', decelerating_shot: '越飞越慢', area_damage: '周围 16px 持续伤害', effect_frozen: '命中冻住', effect_electricity: '命中电击', effect_apply_on_fire: '命中点燃', effect_disintegrated: '命中尸体化灰' }
    const out = []
    for (const o of s.ops || []) {
      if (o.op === 'append') { for (const f of o.v.split(',')) { const k = f.trim().split('/').pop().replace('.xml', ''); if (EX[k]) out.push(EX[k]) } continue }
      const d = F[o.f]; if (!d) continue
      const v = o.f === 'damage_projectile_add' || /damage_/.test(o.f) ? Math.round(o.v * 25) : o.v
      out.push(o.op === 'mul' ? `${d[0]} ×${o.v}` : o.op === 'add' ? `${d[0]} ${v > 0 ? '+' : ''}${v}${d[1] === '×' ? '' : d[1]}` : o.op === 'set' ? `${d[0]} = ${o.v}` : '')
    }
    return out.filter(Boolean).join(' · ')
  },
  cardEl(id, onClick, badge) {
    const s = wands.spell(id), el = document.createElement('div')
    const T = s ? this.TYPES[s.type] || this.TYPES.OTHER : null
    el.className = 'card'
    const ops = s ? this.opsText(s) : ''
    el.title = s ? `${s.name}(${T[0]})\n法力 ${s.mana}${s.maxUses > 0 ? ' · 次数 ' + s.maxUses : ''}${ops ? '\n' + ops : ''}${s.trigger ? '\n触发弹:带着右边一张卡,' + (s.trigger === 'timer' ? '到时' : s.trigger === 'death' ? '消失时' : '撞到东西时') + '放出' : ''}${s.drawMany > 0 ? '\n再抽 ' + s.drawMany + ' 张一起放' : s.type === 'DRAW_MANY' ? '\n把剩下的全抽出来一起放' : ''}${s.desc ? '\n' + s.desc : ''}` : id
    if (T) el.style.borderColor = T[1]
    if (s?.icon) el.style.backgroundImage = `url(${RES}/ent/${s.icon})`
    if (badge) { const i = document.createElement('i'); i.textContent = badge; el.appendChild(i) }
    el.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
    return el
  },
  /** 法杖属性面板(原版法杖提示框那几行):洗牌 / 每次施放 / 施法延迟 / 充能时间 / 法力上限 / 法力恢复 / 容量 / 散射;自由模式可以 −/+ 调 */
  statsEl(w) {
    const box = document.createElement('div'); box.className = 'wstats'
    const f = (n) => (n / 60).toFixed(2) + 's'
    const rows = [
      ['洗牌', w.shuffle ? '是' : '否', FREE ? () => { w.shuffle = !w.shuffle } : null, FREE ? () => { w.shuffle = !w.shuffle } : null],
      ['每次施放', `${w.actionsPerRound} 张`, () => { w.actionsPerRound = Math.max(1, w.actionsPerRound - 1) }, () => { w.actionsPerRound = Math.min(w.deckCapacity, w.actionsPerRound + 1) }],
      ['施法延迟', `${w.fireRateWait}f ${f(w.fireRateWait)}`, () => { w.fireRateWait = Math.max(0, w.fireRateWait - 5) }, () => { w.fireRateWait = Math.min(180, w.fireRateWait + 5) }],
      ...(FREE ? [] : [['充能时间', `${w.reloadTime}f ${f(w.reloadTime)}`, null, null], ['法力上限', `${w.manaMax}`, null, null], ['法力恢复', `${w.manaCharge}/s`, null, null]]),
      ['容量', `${w.deckCapacity}`, () => { w.deckCapacity = Math.max(Math.max(1, w.cards.length), w.deckCapacity - 1); w.actionsPerRound = Math.min(w.actionsPerRound, w.deckCapacity) }, () => { w.deckCapacity = Math.min(26, w.deckCapacity + 1) }],
      ['散射', `${w.spread}°`, () => { w.spread = Math.max(-30, w.spread - 1) }, () => { w.spread = Math.min(60, w.spread + 1) }],
    ]
    for (const [label, val, dec, inc] of rows) {
      const r = document.createElement('div'); r.className = 'stat'
      const l = document.createElement('span'); l.className = 'k'; l.textContent = label
      const v = document.createElement('span'); v.className = 'v'; v.textContent = val
      r.append(l, v)
      if (FREE && dec && inc) {
        const b1 = document.createElement('button'); b1.textContent = '−'; b1.addEventListener('click', (e) => { e.stopPropagation(); dec(); this.after(w) })
        const b2 = document.createElement('button'); b2.textContent = '+'; b2.addEventListener('click', (e) => { e.stopPropagation(); inc(); this.after(w) })
        r.append(b1, b2)
      }
      box.appendChild(r)
    }
    return box
  },
  render() {
    const W = $('edWands'); W.innerHTML = ''
    $('edGold').textContent = `金 ${player.gold} · 散卡 ${player.spells.length} · 法杖 ${player.wands.filter((w) => !w.debug).length}/${flags.wandSlots || 4}`
    player.wands.forEach((w, i) => {
      if (w.debug) return
      const row = document.createElement('div'); row.className = 'wand' + (i === edSel ? ' sel' : '')
      row.addEventListener('click', () => { if (edSel !== i) { edSel = i; this.msg(`选中 ${w.name}:点法术库的卡装进去`); this.render() } })
      const nm = document.createElement('div'); nm.className = 'wname'
      const u = wands.spriteUrl(w)
      nm.innerHTML = `${u ? `<img src="${u}" alt="">` : ''}<b>${i < 9 ? i + 1 : i === 9 ? '0' : ''}. ${w.name}</b>${i === edSel ? '<small>← 选中:点下面法术库的卡装进这根</small>' : `<small class="dim">${w.cards.length}/${w.deckCapacity} 张 · 点这行选中</small>`}`
      const body = document.createElement('div'); body.className = 'wbody'
      const cards = document.createElement('div'); cards.className = 'cards'
      w.cards.forEach((c, k) => cards.appendChild(this.cardEl(c, () => { this.removeCard(w, k) }, c in w.uses ? String(w.uses[c]) : '')))
      // 空格:选中的杖全画出来(点了也是选中这根);没选中的只画前几个,省屏幕
      const emptyN = i === edSel ? w.deckCapacity - w.cards.length : Math.min(3, w.deckCapacity - w.cards.length)
      for (let k = 0; k < emptyN; k++) { const e = document.createElement('div'); e.className = 'card empty'; cards.appendChild(e) }
      // 只有选中的那根展开属性面板(8 根杖全展开手机上要翻好几屏)
      if (i === edSel) body.append(this.statsEl(w), cards); else body.append(cards)
      row.append(nm, body); W.appendChild(row)
    })
    if (this._scrollSel) { this._scrollSel = false; W.querySelector('.wand.sel')?.scrollIntoView({ block: 'nearest' }) }
    const I = $('edInv'); I.innerHTML = ''
    player.spells.forEach((c, k) => I.appendChild(this.cardEl(c, () => { this.addCard(k) })))
    if (FREE) this.renderLib()
  },
  /** 取下第 k 张:回背包(自由模式直接丢掉,法术库里无限);有限次数的卡把剩余次数一起带走(按张均分) */
  removeCard(w, k) {
    if (!this.canEdit) { this.msg('只能在圣山里改法杖'); sfx.play('clash', { vol: 0.15, rate: 2.2 }); return }
    const c = w.cards[k]
    edSel = player.wands.indexOf(w)
    w.cards.splice(k, 1)
    this.msg(`取下 ${wands.spell(c)?.name || c}`)
    if (c in w.uses) { const left = w.cards.filter((x) => x === c).length; if (!left) delete w.uses[c]; else w.uses[c] = Math.round((w.uses[c] * left) / (left + 1)) }
    if (!FREE) player.spells.push(c)
    this.after(w)
  },
  addCard(k) {
    if (!this.canEdit) { this.msg('只能在圣山里改法杖'); sfx.play('clash', { vol: 0.15, rate: 2.2 }); return }
    const w = player.wands[edSel]
    if (!w || w.debug) { this.msg('先点选上面的一根法杖'); return }
    if (w.cards.length >= w.deckCapacity) { this.msg(`${w.name} 满了(容量 ${w.deckCapacity})`); sfx.play('clash', { vol: 0.15, rate: 2.2 }); return }
    const c = player.spells.splice(k, 1)[0]
    w.cards.push(c)
    const s = wands.spell(c); if (s && s.maxUses > 0) w.uses[c] = (w.uses[c] ?? 0) + s.maxUses
    this.after(w)
  },
  after(w) { w.deck = w.cards.slice(); w.reloadT = 0; oplog.ev('edit_wand', { key: w.key, cards: w.cards }); sfx.play('magic', { vol: 0.35, rate: 1.5 }); this.render() },
}
$('edClose').addEventListener('click', (e) => { e.stopPropagation(); editor.toggle(false) })
$('btnEdit').addEventListener('click', (e) => { e.stopPropagation(); editor.toggle() })
for (const id of ['editor', 'btnEdit']) $(id).addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })
// 背包里的手指拖动要让浏览器自己滚(#editor overflow:auto):touchmove 也拦住,否则冒泡到 window 的 touchmove 会 preventDefault 把滚动吃掉
$('editor').addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true })
$('editor').addEventListener('touchend', (e) => e.stopPropagation(), { passive: true })
window.addEventListener('keydown', (e) => { if (e.key === 'i' || e.key === 'I' || e.key === 'Tab') { e.preventDefault(); editor.toggle() } })

// ── 踢(原版右键 kick:踢飞近处的道具 / 尸体,踢到怪掉一点血并击退)──
function kick() {
  if (player.dead || paused || player.kickCd > 0) return
  player.kickCd = 0.4; player.kickT = 0.18
  const dir = player.face, cx = player.x + dir * 7, cy = player.y - 1
  let hit = null
  for (const e of entities.list) {
    if (e.dead) continue
    const ex = e.x + (e.hit.l + e.hit.r) / 2, ey = e.y + (e.hit.t + e.hit.b) / 2
    if (Math.sign(ex - player.x) !== dir && Math.abs(ex - player.x) > 4) continue
    if (Math.abs(ex - cx) < 12 + (e.hit.r - e.hit.l) / 2 && Math.abs(ey - cy) < 14) { hit = e; break }
  }
  if (hit) { entities.hurt(hit, 0.3 * (flags.damageMul || 1), dir * 140, -70, 'melee', cx, cy); sfx.play('impact', { vol: 0.5, rate: 1.3 }); shakeT = Math.max(shakeT, 0.08) }
  else {
    // 道具:踢中心附近的刚体,给一脚速度
    let b = null
    for (const [dx, dy] of [[0, 0], [4, 0], [0, -6], [4, -6], [0, 4]]) { b = entities.bodyAt(Math.floor(cx + dir * dx), Math.floor(cy + dy)); if (b) break }
    if (b) { if (b.asleep) b.wake(sim); b.vx += dir * 160 * Math.min(1, 300 / Math.max(1, b.m)); b.vy -= 90 * Math.min(1, 300 / Math.max(1, b.m)); b.restT = 0; b.w = (b.w || 0) + dir * 6; hit = b; sfx.play('impact', { vol: 0.4, rate: 1.1 }) }
    else sfx.play('wind', { vol: 0.2, rate: 1.8 })
  }
  for (let k = 0; k < 4 && sparks.length < 600; k++) sparks.push({ x: cx + (Math.random() - 0.5) * 4, y: cy + (Math.random() - 0.5) * 6, vx: dir * (40 + Math.random() * 60), vy: (Math.random() - 0.5) * 40, c: '#ffe0a0', life: 0.15 })
  oplog.ev('kick', { hit: hit ? hit.name : null })
}
window.addEventListener('keydown', (e) => { if ((e.key === 'x' || e.key === 'X') && !editor.open) kick() })

// ── 暂停(Esc / 手机"暂停"):停模拟,显示按键帮助 ──
let paused = false
function setPaused(on) {
  paused = on
  $('pause').classList.toggle('on', on)
  if (on) { keys.clear(); mouse.down = false; touch.jump = false; oplog.ev('pause', {}) }
}
$('pauseHelp').innerHTML = IS_TOUCH
  ? '<b>左半屏</b> 摇杆走,上推也能跳 · <b>右半屏</b> 按住开火,拖动改瞄准方向<br><b>跳/飞</b> 按一下跳,按住悬浮(蓝条是燃料)· <b>踢</b> 踢飞箱子/敌人 · <b>喝</b> 选中药水时喝一口(选中药水后开火 = 扔)<br><b>背包</b> 看法杖和法术卡;只有在<b>圣山</b>里才能改法杖 · <b>底栏格子</b> 点一下切换法杖/药水<br><br>怎么玩:一路<b>往下</b>挖 / 飞,金块碰一下就捡。到底是个砖砌的<b>漏斗</b>(顶部箭头会指过去),跳进漏斗底的<b>紫色传送门</b>就进了圣山:用金币买法杖法术、拿 3 选 1 天赋、回满血、改法杖;出口在圣山<b>右侧竖井</b>,往下就是下一层。'
  : '<b>A / D</b> 走 · <b>W / 空格</b> 按一下跳,按住悬浮(蓝条是燃料)· <b>鼠标</b> 瞄准,<b>左键</b> 开火,<b>右键 / X</b> 踢<br><b>滚轮 / 1~9 / Q / E</b> 或点底栏格子切换法杖、药水 · <b>F</b> 喝一口药(选中药水后左键 = 扔)<br><b>I / Tab</b> 背包(只有在<b>圣山</b>里才能改法杖)· <b>Esc</b> 暂停<br><br>怎么玩:一路<b>往下</b>挖 / 飞,金块碰一下就捡。到底是个砖砌的<b>漏斗</b>(顶部箭头会指过去),跳进漏斗底的<b>紫色传送门</b>就进了圣山:用金币买法杖法术、拿 3 选 1 天赋、回满血、改法杖;出口在圣山<b>右侧竖井</b>,往下就是下一层。'
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (editor.open) editor.toggle(false); else setPaused(!paused) } })
$('btnPause').addEventListener('click', (e) => { e.stopPropagation(); setPaused(!paused) })
$('btnResume').addEventListener('click', (e) => { e.stopPropagation(); setPaused(false) })
$('pause').addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })
$('pause').addEventListener('click', (e) => { if (e.target === $('pause')) setPaused(false) })

// ── 新手引导:每条只提示一次(localStorage 记住;?tut=1 重看)──
const TUT = {
  start: IS_TOUCH ? '目标:一路往下,找到圣山(顶部有指引)。左摇杆走 · 右半屏按住开火 · 右下"跳/飞"按住悬浮' : '目标:一路往下,找到圣山(顶部有指引)。A/D 走 · W 跳/按住悬浮 · 左键开火 · Esc 看全部按键',
  gold: '捡到金块!金币在圣山可以买法杖和法术',
  wand: IS_TOUCH ? '捡到法杖:点底栏格子切换' : '捡到法杖:按 1~9 / Q / E 或点底栏格子切换',
  potion: IS_TOUCH ? '捡到药水:切到它按"喝",选中时开火 = 扔出去' : '捡到药水:切到它按 F 喝一口,选中时左键 = 扔出去',
  temple: IS_TOUCH ? '圣山:货架上的东西碰一下 = 用金币买 · 祭坛 3 选 1 天赋 · 点"背包"改法杖 · 出口在右侧竖井往下' : '圣山:货架上的东西碰一下 = 用金币买 · 祭坛 3 选 1 天赋 · I 改法杖 · 出口在右侧竖井往下',
  bagRO: '这是背包(只能看)。到圣山里打开才能把法术卡装进法杖',
  spell: '捡到法术卡:到圣山打开背包装进法杖',
  fly: '悬浮燃料用完了(蓝条变红):落地 0.5s 回满',
}
const tut = {
  seen: new Set(Q.get('tut') === '1' ? [] : (() => { try { return JSON.parse(localStorage.getItem('noita_tut') || '[]') } catch { return [] } })()),
  show(id) {
    if (this.seen.has(id) || !TUT[id]) return
    this.seen.add(id); try { localStorage.setItem('noita_tut', JSON.stringify([...this.seen])) } catch { /* 私密模式 */ }
    toast(TUT[id], 9); oplog.ev('tut', { id })
  },
}
setTimeout(() => tut.show('start'), 800)

// ── 目标指引:不在圣山 → 指向下一座圣山(群系图往下找 temple_altar 行);在圣山 → 指向出口竖井(altar_right 布景 x+195)──
const questEl = $('quest')
let quest = null // { x, y, label }
let questT = 0
function updateQuest(dt) {
  questT -= dt
  if (questT > 0) return
  questT = 0.3
  const pcx = Math.floor(player.x / CHUNK) + WCX, pcy = Math.floor(player.y / CHUNK) + WCY
  const bm = assets.biomeMap
  const nameAt = (cx, cy) => { if (cy < 0 || cy >= bm.h) return null; const x = ((cx % bm.w) + bm.w) % bm.w; return biomeNameOf(bm.pixels[cy * bm.w + x]) }
  const here = nameAt(pcx, pcy) || ''
  quest = null
  // 圣山行的上 260px 是屋顶(altar_top:漏斗 + 实心砖),人在漏斗里还没进屋,继续指传送门
  if (/^temple_altar/.test(here) && player.y > (pcy - WCY) * CHUNK + 260) {
    // 圣山里:找最近的 altar_right 布景,出口竖井在它 x+195
    let best = null, bd = 1e9
    for (const e of streamer.entries.values()) for (const s of e.scenes || []) if (s.name === 'altar_right' && s.dir !== 'props') { const d = Math.abs(s.x + 195 - player.x); if (d < bd) { bd = d; best = s } }
    if (best) quest = { x: best.x + 195, y: best.y + best.h, label: '圣山出口 ↓ 右侧竖井', short: '出口', hint: '跟着箭头走到竖井口,跳下去就是下一层(圣山会在你身后崩塌)' }
    else quest = { x: player.x + 400, y: player.y + 200, label: '圣山:出口在右侧竖井', short: '出口' }
    tut.show('temple')
    return
  }
  for (let cy = pcy; cy < bm.h; cy++) {
    if ((cy - WCY) * CHUNK - 40 + 86 < player.y - 40) continue // 这行的传送门已经在头顶上方(人在屋顶砖里 / 已过),找下一座
    let fx = -1, fd = 99
    for (let dx = -5; dx <= 5; dx++) { const n = nameAt(pcx + dx, cy); if (n && /^temple_altar/.test(n) && Math.abs(dx) < fd) { fd = Math.abs(dx); fx = pcx + dx } }
    if (fx < 0) continue
    // 入口 = 这行每个 altar_top 漏斗底的传送门:(列左沿 + 264, 行顶 − 40 + 90 − 4);离玩家最近的那个
    const px = (fx - WCX) * CHUNK + 264, py = (cy - WCY) * CHUNK - 40 + 86
    const dy = Math.max(0, (py - player.y) | 0)
    quest = {
      x: px, y: py, label: `圣山传送门 ↓ 还有 ${dy}`, short: '传送门',
      hint: IS_TOUCH ? '一路往下:找洞走,没洞就把右摇杆往下拖着开火打穿地面;到底是个漏斗,跳进漏斗底的紫色传送门' : '一路往下:找洞走,没洞就朝脚下开火打穿地面;到底是个漏斗,跳进漏斗底的紫色传送门',
    }
    break
  }
}
/** 指引:顶部横幅文字 + 屏边一枚小箭头(目标在屏内就画在目标上)。头顶不再放导航箭头 —— 原版头顶什么都没有,头顶那块留给状态图标 */
function drawQuest() {
  if (!quest || paused) { questEl.textContent = ''; return }
  const dist = Math.hypot(quest.x - player.x, quest.y - player.y) | 0
  questEl.textContent = `${quest.label.replace(/还有 \d+/, `还有 ${dist}`)}${quest.hint ? '\n' + quest.hint : ''}`
  let [sx, sy] = toScreen(quest.x, quest.y)
  const W = game.width, H = game.height, m = 26, mb = 76 // 下边距大一点,别压在物品栏上
  const dx = sx - W / 2, dy = sy - H / 2
  const inside = sx > m && sx < W - m && sy > m && sy < H - mb
  if (!inside) { const k = Math.min((W / 2 - m) / Math.max(1, Math.abs(dx)), (dy > 0 ? H / 2 - mb : H / 2 - m) / Math.max(1, Math.abs(dy))); sx = W / 2 + dx * k; sy = H / 2 + dy * k }
  const a = Math.atan2(dy, dx), pulse = 0.6 + 0.4 * Math.sin(performance.now() / 250)
  gctx.save(); gctx.translate(sx, sy); gctx.rotate(a)
  gctx.fillStyle = `rgba(255,220,120,${pulse.toFixed(2)})`; gctx.strokeStyle = 'rgba(0,0,0,0.7)'; gctx.lineWidth = 2
  gctx.beginPath(); gctx.moveTo(12, 0); gctx.lineTo(-8, -8); gctx.lineTo(-4, 0); gctx.lineTo(-8, 8); gctx.closePath(); gctx.fill(); gctx.stroke()
  gctx.restore()
}

/** 碎屑:重力下落,穿过空气/气体,撞到东西就在当前位置沉积回世界(尘不沉积;玩家身上是禁区) */
function updateDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const p = debris[i]
    p.t = (p.t || 0) + dt
    if (p.dust && p.t > 0.6) { debris.splice(i, 1); continue } // 尘飞一下就散
    p.vy += 350 * dt
    const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt
    const m = sim.get(Math.floor(nx), Math.floor(ny))
    if (m === 0 || (m > 0 && (sim.kind[m] === 4 || sim.kind[m] === 5)) || (p.vy < 0 && m > 0 && sim.kind[m] === 3)) { p.x = nx; p.y = ny; continue }
    if (m < 0) { debris.splice(i, 1); continue }
    const cx = Math.floor(p.x), cy = Math.floor(p.y)
    if (Math.abs(cx - player.x) < 4 && Math.abs(cy - player.y) < 7) { const d = cx >= player.x ? 1 : -1; p.x = player.x + d * 5; p.vx += d * 40; continue }
    if (!p.dust) { const here = sim.get(cx, cy); if (here === 0 || (here > 0 && sim.kind[here] === 4)) sim.set(cx, cy, p.m, 0) }
    debris.splice(i, 1)
  }
}
// ── 水:Noita 里角色对液体是实体(CellSim 障碍盒),LiquidDisplacerComponent 把身体挤到的液体推到最近的空格 ──
/** 碰撞盒整数范围 */
function bodyBox() {
  return { x0: Math.floor(player.x + P.boxL), x1: Math.floor(player.x + P.boxR - 0.01), y0: Math.floor(player.y + P.boxT), y1: Math.floor(player.y + P.boxB) }
}
/** 身体走进液体格 → 把这些液体格挪到盒外最近的空格(先两侧贴身,再上方);挪出来的水自己落回去 = 水面凹、涟漪 */
function displaceLiquid() {
  const b = bodyBox()
  let moved = 0
  for (let y = b.y1; y >= b.y0 && moved < 16; y--) {
    for (let x = b.x0; x <= b.x1 && moved < 16; x++) {
      const m = sim.get(x, y)
      if (m <= 0 || sim.kind[m] !== 3) continue
      let tx = -1, ty = -1
      for (let k = 1; k <= 6 && tx < 0; k++) {
        for (const sx of [b.x0 - k, b.x1 + k]) { if (sim.get(sx, y) === 0) { tx = sx; ty = y; break } }
      }
      for (let k = 1; k <= 10 && tx < 0; k++) { const yy = b.y0 - k; if (sim.get(x, yy) === 0) { tx = x; ty = yy } }
      if (tx < 0) continue
      const a = sim.aux(x, y)
      sim.set(x, y, 0, 0); sim.set(tx, ty, m, a); moved++
    }
  }
  return moved
}
/**
 * 人在液体里(VelocityComponent.displace_liquid,player_base 也带;反 exe VelocitySystem::Update 0xd67458):这一帧所在格变了 → 位置周围 3×3 的液体格
 * 各以 75% 概率抛成粒子,速度 = −(自身速度 × 0.1) 转 Random(−0.3, 0.3) rad —— 跳进水里只是把脚下几格水以一成速度顶回去(几十 px/s 的小鼓包),
 * 原版没有别的水花;之前我们按落速掀 8~45 粒 40~230 px/s 的水珠(自创)。响一声还留着(入水那一帧)
 */
let dispPX = NaN, dispPY = NaN
function splash(speed) {
  const cx = Math.floor(player.x), cy = Math.floor(player.y)
  if (cx === dispPX && cy === dispPY) return false
  dispPX = cx; dispPY = cy
  let done = 0
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
    const m = sim.get(x, y)
    if (m <= 0 || sim.kind[m] !== 3) continue
    if (Math.random() * 100 >= 75) continue
    const a = (Math.random() - 0.5) * 0.6, ca = Math.cos(a), sa = Math.sin(a), vx = -player.vx * 0.1, vy = -player.vy * 0.1
    sim.set(x, y, 0, 0)
    debris.push({ x: x + 0.5, y: y + 0.5, vx: vx * ca - vy * sa, vy: vx * sa + vy * ca, m, col: mats.color[m], dust: false })
    done++
  }
  if (done && speed > 40) sfx.play('water', { vol: Math.min(0.9, 0.25 + speed / 250), rate: 0.9 + Math.random() * 0.2, minGap: 120 })
  return done
}
/**
 * 沾污量(SpriteStainsComponent + StatusEffectDataComponent.stain_effects):每种沾污各自 0~10 的"沾了多少"(原作 = 精灵被该液体染色像素的占比),
 * 到材质的 status_threshold 就全额生效(水 0、油 / 毒液 0.2);泡进液体很快沾满、只湿脚最多沾四成;掉的方式是"晃掉"(stain_shaken_drop_chance:动得越快掉得越快,站着不动几乎不干),
 * 碰火时 WET / BLOODY / SLIMY / RADIOACTIVE 这些 protects_from_fire 的沾污被火"烤掉"(每秒烤掉 4 成)而不是直接着火 —— 烤完才点得着
 */
/**
 * 沾上 add(0~10)的液体 m(状态 kind):新染的像素均匀盖在身上,已有的每种沾污按比例被顶掉(SpriteStains 一个像素只存一种材质),总量 ≤ 10;
 * cap = 这种沾污最多到多少(只湿脚 4 成)
 */
function addStain(m, kind, add, cap = 10) {
  if (!kind || add <= 0) return
  let s = player.stains.find((x) => x.kind === kind)
  if (!s) { s = { mat: m, kind, amt: 0 }; player.stains.push(s) }
  s.mat = m
  add = Math.min(add, Math.max(0, cap - s.amt))
  if (add <= 0) return
  const f = add / 10
  for (const o of player.stains) if (o !== s) o.amt -= o.amt * f
  s.amt = Math.min(10, s.amt + add)
  const tot = player.stains.reduce((a, o) => a + o.amt, 0)
  if (tot > 10) s.amt -= tot - 10
  player.stains = player.stains.filter((o) => o.amt > 0.05)
}
function updateWet(dt, inLiq, feetWet = false) {
  if ((inLiq || feetWet) && !flags.stainless) {
    const m = inLiq ? matAt(player.x, player.y + P.boxB + P.buoyancyOffsetY) : matAt(player.x, player.y + P.boxB - 0.5)
    if (m > 0 && KIND[m] === 'liquid') addStain(m, stainKindOf(m), dt * (inLiq ? 40 : 12), inLiq ? 10 : 4)
    return
  }
  if (!player.stains.length) return
  const speed = Math.hypot(player.vx, player.vy)
  // 晃掉(stain_shaken_drop_chance × 材质 liquid_sprite_stain_shaken_drop_chance,瞬移液 5):站着 ~80s 才干,一路跑 ~10s;每种沾污各自掉
  for (const s of player.stains) s.amt -= dt * (0.12 + Math.min(1, speed / 90) * 0.9) * (mats.list[s.mat]?.liquidSpriteStainShakenDropChance || 1)
  player.stains = player.stains.filter((s) => s.amt > 0)
  if (!player.stains.length) return
  player.dripT -= dt
  const tot = player.stains.reduce((a, s) => a + s.amt, 0)
  if (player.dripT <= 0 && simBound) {
    player.dripT = 0.08 + (1 - tot / 10) * 0.6 + Math.random() * 0.15
    // 滴哪种:按量抽
    let r = Math.random() * tot, drip = player.stains[0]; for (const s of player.stains) { r -= s.amt; if (r <= 0) { drip = s; break } }
    const b = bodyBox()
    const x = b.x0 - 1 + Math.floor(Math.random() * (b.x1 - b.x0 + 3)), y = Math.floor(player.y - 8 + Math.random() * 12)
    // 滴落只是粒子(原作 stain 掉落也不成像素),落地即散,别把脚下的土全变成泥
    if (drip.mat > 0 && debris.length < 900) debris.push({ x, y, vx: (Math.random() - 0.5) * 12 + player.vx * 0.5, vy: 10, m: drip.mat, col: mats.color[drip.mat], dust: true })
  }
}
/** 水下气泡:嘴边冒出,向上加速,到空气就破 */
function updateBubbles(dt, headInLiq) {
  if (headInLiq && Math.random() < dt * 6) bubbles.push({ x: player.x + player.face * 2 + (Math.random() - 0.5) * 2, y: player.y - 6 + Math.random() * 2, vx: (Math.random() - 0.5) * 10, vy: -10, t: 0, f: Math.random() < 0.5 ? 0 : 1 })
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const p = bubbles[i]
    p.t += dt
    p.vy = Math.max(-90, p.vy - 200 * dt)
    p.x += p.vx * dt + Math.sin(p.t * 9) * 8 * dt; p.y += p.vy * dt
    const m = sim.get(Math.floor(p.x), Math.floor(p.y))
    if (p.t > 4 || m < 0 || m === 0 || sim.kind[m] !== 3) bubbles.splice(i, 1)
  }
}

window.addEventListener('keydown', (e) => {
  const n = +e.key
  const L = player.wands.length + (player.items?.length || 0)
  if (e.key >= '1' && e.key <= '9') payload = Math.min(L - 1, n - 1)
  else if (e.key === '0') payload = Math.min(L - 1, 9)
  else if (e.key === '-') payload = Math.min(L - 1, 10)
  else if (e.key === '=') payload = Math.min(L - 1, 11)
  else if (e.key === 'q') payload = (payload + L - 1) % L
  else if (e.key === 'e') payload = (payload + 1) % L
})
// 鼠标滚轮切格(原版默认键位):往下滚 = 下一格,往上滚 = 上一格;背包 / 暂停打开时不切
window.addEventListener('wheel', (e) => {
  if (editor.open || paused || player.dead) return
  const L = player.wands.length + (player.items?.length || 0)
  if (L < 2 || !e.deltaY) return
  payload = (payload + (e.deltaY > 0 ? 1 : L - 1)) % L
  oplog.ev('wand', { payload, wheel: 1 })
}, { passive: true })
$('btnMute').addEventListener('click', (e) => { e.stopPropagation(); sfx.ensure(); sfx.setMuted(!sfx.muted); $('btnMute').textContent = sfx.muted ? '🔇' : '🔊' })
$('btnReport').addEventListener('click', async (e) => {
  e.stopPropagation()
  oplog.ev('report', { x: player.x | 0, y: player.y | 0, box: sampleAround(player.x, player.y, 8, 12), note: 'manual' })
  const ok = await oplog.flush('manual')
  $('btnReport').textContent = ok ? '已上报 ✓' : '上报失败'
  setTimeout(() => { $('btnReport').textContent = '上报日志' }, 1500)
})
for (const id of ['tools', 'btnMute', 'btnReport']) $(id).addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })

// ── 主循环 ──
let last = performance.now(), fps = 60, fpsAcc = 0, fpsN = 0, simMs = 0
function step(dt) {
  // 输入
  // 混乱药:左右反;醉了:方向偶尔自己打漂
  let dir = ((keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0) + (Math.abs(touch.mx) > 0.25 ? Math.sign(touch.mx) : 0)) * effectMul.dir
  if (hasEffect('ALCOHOLIC') && Math.sin(performance.now() / 380) > 0.6) dir = -dir
  let wantUp = keys.has('w') || keys.has(' ') || keys.has('arrowup') || touch.my < -0.55 || touch.jump
  // 被电(effect_electricity ELECTROCUTION disable_movement=1):40 帧动不了、也开不了火
  player.stunT = Math.max(0, (player.stunT || 0) - dt)
  if (player.stunT > 0) { dir = 0; wantUp = false }
  tickEffects(dt)
  player.kickCd = Math.max(0, player.kickCd - dt); player.kickT = Math.max(0, player.kickT - dt)
  if (touch.aim) {
    // 瞄准摇杆:拖出 ≥8px 才改方向,否则保持当前方向(只点不拖 = 朝面向开火,不会把人拧过去)
    const d = Math.hypot(touch.aim.dx, touch.aim.dy)
    if (d >= 8) { const s = 60 / d; player.aimX = player.x + touch.aim.dx * s; player.aimY = player.y - 2 + touch.aim.dy * s; touch.aim.locked = true }
    else if (!touch.aim.locked) { player.aimX = player.x + player.face * 60; player.aimY = player.y - 2 }
    else { player.aimX = player.x + touch.aim.lx; player.aimY = player.y - 2 + touch.aim.ly }
    touch.aim.lx = player.aimX - player.x; touch.aim.ly = player.aimY - (player.y - 2)
  } else if (!IS_TOUCH) { const [wx, wy] = toWorld(mouse.x, mouse.y); player.aimX = wx; player.aimY = wy }
  else if (dir) { player.aimX = player.x + dir * 40; player.aimY = player.y - 2 } // 手机没按瞄准时:瞄准点跟着走的方向(PC 有鼠标常驻,手机没有)
  else { player.aimX = player.x + player.face * 40; player.aimY = player.y - 2 } // 站着不动:瞄准点跟着人走,别留在世界某个老位置
  const wantFire = (mouse.down || !!touch.aim) && player.stunT <= 0
  // Noita 规则:身体永远面朝瞄准方向,和走的方向无关(倒着走播 walk_backwards);之前按移动方向翻身,一边走一边瞄就来回抽
  player.face = player.aimX < player.x ? -1 : 1
  // 输入状态变化才记(不刷屏);位置每秒一条
  const inState = dir + (wantUp ? 'U' : '') + (wantFire ? 'F' : '')
  if (inState !== lastInState) { lastInState = inState; oplog.ev('input', { dir, up: wantUp ? 1 : 0, fire: wantFire ? 1 : 0, x: player.x | 0, y: player.y | 0, joy: touch.joy ? [+touch.mx.toFixed(2), +touch.my.toFixed(2)] : undefined }) }
  posLogT += dt
  if (posLogT >= 1) { posLogT = 0; oplog.ev('pos', { x: player.x | 0, y: player.y | 0, vx: player.vx | 0, vy: player.vy | 0, g: player.onGround ? 1 : 0, fly: +player.fly.toFixed(1), fps: fps | 0, sim: +simMs.toFixed(1) }) }

  // ── 身体:Noita CharacterPlatforming 模型 ──
  const f60 = dt * 60 // 以帧为单位的参数换算
  // 游泳判定用 buoyancy_check_offset_y(脚上 7px 处泡在液体里);脚踩水洼只轻微减速,别当成在水里
  const inLiq = liquidAt(player.x, player.y + P.boxB + P.buoyancyOffsetY)
  const feetWet = !inLiq && liquidAt(player.x, player.y + P.boxB - 0.5)
  // ── 入水:身体对液体是实体(障碍盒),挤开的水自己落回;入水一刻按落速掀水花;头没了冒气泡、声音闷掉;出水滴水 10s ──
  const headInLiq = liquidAt(player.x, player.y - 6)
  player.headInLiq = headInLiq
  if (simBound) {
    const b = bodyBox()
    sim.setObstacle(b.x0, b.y0, b.x1, b.y1)
    displaceLiquid()
    // 每帧(换格才算)把 3×3 里的液体顶回去;入水那一帧速度够快就响一声(splash 里按 speed 判)
    if (inLiq || feetWet) { splash(!player.wasWet ? Math.hypot(player.vx, player.vy) : 0); if (!player.wasWet && Math.abs(player.vy) > 40) oplog.ev('splash', { vy: player.vy | 0 }) }
  }
  player.wasWet = inLiq || feetWet
  player.iframe = Math.max(0, player.iframe - dt); player.hurtFlash = Math.max(0, (player.hurtFlash || 0) - dt)
  // 材质伤害:身体中心格是酸/熔岩/毒气… 按表每帧扣(无敌帧不挡材质伤害,原版也不挡)
  if (simBound) {
    const mc = matAt(player.x, player.y - 2)
    if (mc > 0) { let v = PLAYER_MAT_DMG[mats.list[mc]?.name]; if (v > 0 && flags.protRadioactive && /radioactive/.test(mats.list[mc].name)) v = 0; if (v) { player.hp = Math.min(player.maxHp, player.hp - v * dt * 60); if (player.hp <= 0) { player.iframe = 0; damagePlayer(0.001, 0, 0, mats.list[mc].name) } else if (v > 0 && Math.random() < dt * 3) { player.hurtFlash = 0.1; sfx.play('fire', { vol: 0.2, rate: 1.6, minGap: 300 }) } } }
  }
  updateWet(dt, inLiq, feetWet)
  // 火:身体格是火 → 点着(fire_probability_of_ignition=1;湿的不着,沾油的一碰就着);烧着时冒火、掉血、进水灭
  if (simBound) {
    const mc2 = matAt(player.x, player.y - 2), mf = matAt(player.x, player.y + P.boxB - 1)
    const nearFire = mc2 === sim.M_FIRE || mf === sim.M_FIRE
    if (nearFire) {
      // 防火沾污先被火烤(wiki:Wet "is depleted by contact with Fire"),烤干才着;冒一点蒸汽
      const prot = activeStains().filter((s) => FIRE_PROTECT.has(s.kind))
      if (prot.length && player.fireT <= 0) {
        // 每种防火沾污都被烤(每秒 4 成,第 12 条校的;水的 liquid_sprite_stain_ignited_drop_chance=10 是唯一写了这项的,其它液体引擎默认值没反出来,先一视同仁)
        for (const s of prot) s.amt -= dt * 4
        player.stains = player.stains.filter((s) => s.amt > 0)
        if (Math.random() < dt * 8 && simBound) { const x = Math.floor(player.x + (Math.random() - 0.5) * 5), y = Math.floor(player.y - 9); if (sim.get(x, y) === 0 && sim.M_STEAM) sim.set(x, y, sim.M_STEAM, 0) }
      } else ignitePlayer()
    }
    if (stainActive('OILED') && !nearFire && player.fireT <= 0) { for (const [dx, dy] of [[-3, 0], [3, 0], [0, -6], [0, 3]]) if (matAt(player.x + dx, player.y + dy) === sim.M_FIRE) { ignitePlayer(); break } }
    if (player.fireT > 0) {
      player.fireT -= dt
      if (inLiq) player.fireT = 0 // 泡进任何液体(包括油)都灭(wiki)
      player.fireTick += dt
      if (player.fireTick >= 0.5) { player.fireTick = 0; player.hp -= 0.01 * player.maxHp; player.hurtFlash = 0.15; if (player.hp <= 0) { player.iframe = 0; damagePlayer(0.001, 0, 0, 'fire') } }
      if (Math.random() < 0.7) { const x = Math.floor(player.x + (Math.random() - 0.5) * 5), y = Math.floor(player.y - 6 + Math.random() * 9); if (sim.get(x, y) === 0) sim.set(x, y, sim.M_FIRE, 0) }
      for (let k = 0; k < 2 && sparks.length < 600; k++) sparks.push({ x: player.x + (Math.random() - 0.5) * 6, y: player.y - 8 + Math.random() * 10, vx: (Math.random() - 0.5) * 24, vy: -50 - Math.random() * 70, c: Math.random() < 0.5 ? '#ffb040' : '#ff6a20', life: 0.3 + Math.random() * 0.2 })
    }
    // RADIOACTIVE 沾污:慢慢掉血
    if (stainActive('RADIOACTIVE') && !flags.protRadioactive) player.hp -= 0.02 * dt
  }
  if (simBound) updateBubbles(dt, headInLiq)
  // 憋气(DamageModel air_needed=1 / air_in_lungs_max=7 / air_lack_of_damage=0.6):头没在液体里 7 秒后开始掉血,出水很快回满;BREATH_UNDERWATER 特权免
  if (headInLiq && !flags.breathUnderwater) {
    player.air = Math.max(0, player.air - dt)
    if (player.air <= 0) { player.hp -= 0.6 * dt; if (Math.random() < dt * 2) player.hurtFlash = 0.12; if (player.hp <= 0) { player.iframe = 0; damagePlayer(0.001, 0, 0, 'drown') } }
  } else player.air = Math.min(7, player.air + dt * 3)
  sfx.setUnderwater(headInLiq)
  const wasGround = player.onGround
  player.onGround = groundUnder(player.x, player.y)
  const landed = player.onGround && !wasGround && player.vy > 60
  if (player.onGround && !wasGround && player.vy > 120) { sfx.play('impact', { vol: Math.min(1, player.vy / 300) }); oplog.ev('land', { vy: player.vy | 0 }) }
  player.landed = landed
  player.airFrames = player.onGround ? 0 : player.airFrames + f60
  // 重力
  player.vy += (inLiq ? P.gravity * 0.25 : P.gravity) * dt
  // 起跳:按下(非按住)且在地面 → jump_velocity_y;有水平输入再给 jump_velocity_x
  const upPressed = wantUp && !player.upHeld
  player.upHeld = wantUp
  if (upPressed && (player.onGround || inLiq)) {
    player.vy = P.jumpVy * (inLiq ? 0.6 : 1)
    if (dir) player.vx = dir * P.jumpVx
    if (!inLiq) { sfx.play('clash', { vol: 0.15, rate: 1.6 }); oplog.ev('jump', {}) }
  }
  // 悬浮:按住且不在地面 → 朝 fly_speed_max_up 逼近(fly_speed_change_spd 0.25/帧),烧 fly_time
  // flying_needs_recharge=1:烧空之后进入"耗尽"态,要等蓝条回满才能再飞(Noita 里蓝条变红那段);
  // flying_in_air_wait_frames=38:停止飞行 38 帧后空中才开始慢回(0.4/s),落地 6/s
  player.thrusting = false
  if (wantUp && !player.onGround && !inLiq && player.fly > 0 && !player.flyExhausted) {
    player.thrusting = true
    player.sinceFly = 0
    player.vy += (-P.flyUpMax * effectMul.fly - player.vy) * Math.min(1, P.flyChange * f60)
    player.fly = Math.max(0, player.fly - dt)
    if (player.fly <= 0) { player.flyExhausted = true; oplog.ev('fly_exhausted', { y: player.y | 0 }); tut.show('fly') }
    // 喷气(base_jetpack_nosound.xml ParticleEmitter jetpack,player_base 覆盖 offset (−2,5) / lifetime_min 0):材质 rocket_particles(66FFFFFE = 40% 白),
    // x_pos ±1,x_vel ±7,y_vel 80~180 向下,count 3~7,lifetime 0~0.2s,每 0~1 帧一次;cosmetic 粒子,collide_with_grid → 碰到地就没;不按寿命淡出 —— 是一股白色的"火箭尾气",不是橙色火星
    if (Math.random() < 0.75) {
      const n = 3 + ((Math.random() * 5) | 0)
      for (let k = 0; k < n; k++) sparks.push({ x: player.x - 2 * player.face + (Math.random() * 2 - 1), y: player.y + 5, vx: Math.random() * 14 - 7, vy: 80 + Math.random() * 100, life: Math.random() * 0.2, c: 'rgba(255,255,255,0.4)', noFade: true, grid: true })
    }
  } else if (inLiq && wantUp) player.vy -= 500 * dt
  if (!player.thrusting) {
    player.sinceFly += f60
    if (player.onGround) player.fly = Math.min(P.flyTimeMax, player.fly + P.flyRechargeGround * dt)
    else if (player.sinceFly > P.flyAirWaitFrames) player.fly = Math.min(P.flyTimeMax, player.fly + P.flyRechargeAir * dt)
    if (player.flyExhausted && player.fly >= P.flyTimeMax) player.flyExhausted = false
  }
  player.fuel = (player.fly / P.flyTimeMax) * 100
  // 水平:目标 ±57(地面)/ ±52(空中),accel_x 0.15 每帧向目标插值;松手也是同样的减速
  const target = dir * (player.onGround ? P.runMax : P.flyVx) * (stainActive('SLIMY') ? 0.6 : 1) * effectMul.move // SLIMY:动作变慢;疾跑药 ×2
  // 被黑洞吸着(pullT)且没按方向:不往 0 收速度,不然拉力被"松手减速"抵消掉;按着方向才是"trying to resist its pull"
  player.pullT = Math.max(0, (player.pullT || 0) - dt)
  if (!(player.pullT > 0 && !dir)) player.vx += (target - player.vx) * Math.min(1, P.accelX * f60)
  if (dir && player.onGround) player.walkT += dt
  if (inLiq) { player.vx *= Math.pow(0.2, dt); player.vy *= Math.pow(0.15, dt) }
  else if (feetWet) player.vx *= Math.pow(0.6, dt)
  player.vy = Math.max(P.vyMin, Math.min(P.vyMax, player.vy))
  // 子步进:水平碰墙时最多自动上 climb_over_y=4px 台阶
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(player.vx), Math.abs(player.vy)) * dt))
  let blockedX = false
  for (let s = 0; s < steps; s++) {
    const nx = player.x + (player.vx * dt) / steps
    if (!bodyBlocked(nx, player.y)) player.x = nx
    else {
      let climbed = false
      for (let c = 1; c <= P.climb; c++) if (!bodyBlocked(nx, player.y - c)) { player.x = nx; player.y -= c; climbed = true; break }
      if (!climbed) {
        // 顶着的是醒着的箱子/桶 → 推它走(原版角色能推 box2d 道具),不算被墙挡
        const sx = player.vx > 0 ? Math.floor(nx + P.boxR - 0.01) : Math.floor(nx + P.boxL)
        const rb = entities.bodyAt(sx, Math.floor(player.y)) || entities.bodyAt(sx, Math.floor(player.y + P.boxB - 1)) || entities.bodyAt(sx, Math.floor(player.y + P.boxT))
        if (rb) entities.pushBody(rb, player.vx) // 保持走速,箱子动了下一帧人就跟上
        else {
          // 挡路的只是落沙(可能还叠在台阶上):在能上的台阶高度里找一个只剩沙挡着的位置,把沙推开趟过去(慢)
          let waded = false
          for (let c = 0; c <= P.climb && !waded; c++) if (wadeSand(nx, player.y - c)) { player.x = nx; player.y -= c; waded = true }
          if (waded) player.vx *= 0.7
          else { blockedX = true; player.vx = 0 }
        }
      }
    }
    const ny = player.y + (player.vy * dt) / steps
    if (!bodyBlocked(player.x, ny)) player.y = ny
    else if (player.vy < 0 && wadeSand(player.x, ny)) { player.y = ny; player.vy *= 0.8 } // 头顶是沙:往上钻得出去
    else player.vy = 0
  }
  // 卡进墙里(比如布景刚盖上来 / 沙埋)→ 沙先推开,推不开再往上顶出去;被醒着的箱子挤到 → 先横着让开(别被顶到箱子顶上)
  if (bodyBlocked(player.x, player.y) && wadeSand(player.x, player.y)) { /* 埴住的沙推开了 */ }
  if (bodyBlocked(player.x, player.y)) {
    const rb = entities.bodyAt(Math.floor(player.x), Math.floor(player.y)) || entities.bodyAt(Math.floor(player.x), Math.floor(player.y + P.boxB - 1))
    if (rb && !rb.asleep) { const d = player.x < rb.x ? -1 : 1; const lim = Math.ceil(rb.r) + 3; for (let k = 0; k < lim && bodyBlocked(player.x, player.y); k++) player.x += d; if (!bodyBlocked(player.x, player.y)) player.vx = d * 20 }
    for (let k = 0; k < 24 && bodyBlocked(player.x, player.y); k++) player.y -= 1
  }
  // 手机辅助:贴着 ≤12px 的矮墙推摇杆 0.15s 还没过去 → 自动小跳一下(PC 有键盘随手跳,手机不给这个就会觉得"走不动")
  if (IS_TOUCH && blockedX && dir && player.onGround) {
    hopT += dt
    if (hopT > 0.15) {
      let h = 0
      for (; h <= 12; h++) if (!bodyBlocked(player.x + dir * 2, player.y - h)) break
      if (h <= 12) { player.vy = -Math.sqrt(2 * P.gravity * (h + 3)); player.vx = dir * P.jumpVx; oplog.ev('autohop', { h }) }
      hopT = 0
    }
  } else hopT = 0
  // 卡住检测:有输入、贴地、却动不了 → 0.5s 后记一条含周围材质的日志(立刻上传)
  if (dir && player.onGround && blockedX && Math.abs(player.vx) < 2) {
    stuckT += dt
    if (stuckT > 0.5 && !stuckLogged) {
      stuckLogged = true
      oplog.ev('stuck', { x: player.x, y: player.y, dir, box: sampleAround(player.x, player.y, 6, 10) })
      oplog.flush('stuck')
    }
  } else { stuckT = 0; stuckLogged = false }
  if (player.onGround && dir && Math.abs(player.vx) > 20) { footT += dt; if (footT > 0.28) { footT = 0; sfx.play('impact', { vol: 0.12, rate: 2.2, minGap: 200 }) } }

  // 开火
  player.fireCd -= dt
  syncWand()
  if (wantFire && player.fireCd <= 0 && simBound) fire()
  spraying = wantFire && !!curWand().debug && curWand().proj.startsWith('material_')
  for (const w of player.wands) if (!w.debug) wands.update(w, dt)
  if (simBound) projectiles.update(dt)
  if (simBound) entities.update(dt, simWindow())
  if (simBound) { if ((veg.frame & 15) === 0) veg.sync(); veg.update(dt, simWindow()) }
  if (simBound) { updateGuard(dt); updateCollapse(dt); updatePortals(dt) }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i]
    p.life -= dt; if (p.g) p.vy += 300 * dt
    if (p.stopAt !== undefined) { p.stopAt -= dt; if (p.stopAt <= 0) { p.vx = 0; p.vy = 0 } } // 描图形的火花:飞到轮廓就停
    p.x += p.vx * dt; p.y += p.vy * dt
    if (p.life <= 0 || (p.grid && solidAt(Math.floor(p.x), Math.floor(p.y)))) sparks.splice(i, 1) // collide_with_grid 的化妆粒子撞到实心就没
  }
  if (simBound) updateDebris(dt)
  shakeT = Math.max(0, shakeT - dt)
  sprite.update({ onGround: player.onGround, inLiq, thrusting: player.thrusting, vx: player.vx, vy: player.vy, dir, face: player.face, landed: player.landed }, dt)
  // 相机跟随(稍微朝瞄准方向偏)
  const tx = player.x + (player.aimX - player.x) * 0.12, ty = player.y + (player.aimY - player.y) * 0.12
  cam.x += (tx - cam.x) * Math.min(1, dt * 6); cam.y += (ty - cam.y) * Math.min(1, dt * 6)
}

/** Noita 原版精灵:身体按状态机播帧,手臂指向瞄准点,法杖在手上;返回杖尖(世界坐标)作发射点 */
const wetCv = document.createElement('canvas'); wetCv.width = 48; wetCv.height = 48
function drawPlayer(ctx, ox, oy) {
  const a = Math.atan2(player.aimY - (player.y - 2), player.aimX - player.x)
  let tip
  const stains = player.stains.filter((s) => s.amt > 0 && s.mat > 0)
  if (stains.length) {
    // SpriteStainsComponent:身上沾了液体 → 精灵按液体色染一层,出水后随滴落渐淡
    const wc = wetCv.getContext('2d')
    wc.globalCompositeOperation = 'source-over'; wc.clearRect(0, 0, 48, 48)
    const oxo = player.x - 24, oyo = player.y - 28
    tip = sprite.draw(wc, player.x, player.y, player.face, a, oxo, oyo)
    tip = { x: tip.x + oxo - ox, y: tip.y + oyo - oy }
    // SpriteStainsComponent:染的是精灵像素本身(材质色),fade_stains_towards_srite_top=1 → 越靠头顶越淡;量越大越深(原版是染色像素占比);
    // 几种液体同时在身上就一层层叠(原版是各占一部分像素)
    wc.globalCompositeOperation = 'source-atop'
    for (const s of stains) {
      const c = mats.color[s.mat], frac = Math.min(1, s.amt / 10)
      const g = wc.createLinearGradient(0, 28 + HEAD, 0, 28 + FEET)
      const rgb = `${(c >> 16) & 255},${(c >> 8) & 255},${c & 255}`
      g.addColorStop(0, `rgba(${rgb},${(0.05 + 0.15 * frac).toFixed(2)})`); g.addColorStop(1, `rgba(${rgb},${(0.15 + 0.5 * frac).toFixed(2)})`)
      wc.fillStyle = g
      wc.fillRect(0, 0, 48, 48)
    }
    ctx.drawImage(wetCv, Math.round(player.x - ox) - 24, Math.round(player.y - oy) - 28)
  } else tip = sprite.draw(ctx, player.x, player.y, player.face, a, ox, oy)
  wandTip = { x: tip.x + ox, y: tip.y + oy }
  // 水下气泡(gas_bubble 2×2 亮点)
  if (bubbles.length) {
    ctx.fillStyle = 'rgba(225,242,255,0.8)'
    for (const b of bubbles) ctx.fillRect(Math.round(b.x - ox) - 1, Math.round(b.y - oy) - 1, b.f ? 2 : 1, b.f ? 2 : 1)
  }
  drawStatusIcons(ctx, ox, oy)
}
// ── 状态图标(ui_gfx/status_indicators/*.png 12×12,原版画在 HUD 血条下;手机屏小,直接挂在头顶):图标 + 下面一条剩余量(stain_effects 的占比 / 着火剩余时间)──
const STATUS_ICONS = {}
for (const n of ['wet', 'oiled', 'bloody', 'slimy', 'radioactive', 'on_fire', 'poisoned', 'hp_regeneration', 'protection_all']) { const im = new Image(); im.src = `${RES}/ui/status/${n}.png`; STATUS_ICONS[n] = im }
const STAIN_NAME = { WET: '湿', OILED: '沾油', BLOODY: '沾血', SLIMY: '黏液', RADIOACTIVE: '辐射' }
const STAIN_COL = { WET: '#7fb8ff', OILED: '#c8a850', BLOODY: '#e04040', SLIMY: '#80e060', RADIOACTIVE: '#a0ff40' }
function activeStatuses() {
  const out = []
  // 原版状态区:着火显示剩余秒(release notes "Fire status duration displayed in the status area"),沾污显示量("Stain status amount is displayed next to icon")
  if (player.fireT > 0) out.push({ icon: 'on_fire', frac: player.fireT / (player.fireDur || 4), col: '#ff7a20', text: `着火 ${player.fireT.toFixed(1)}s` })
  // 每种生效中的沾污一个图标(stain_effects 一项一种,水 + 毒液可以同时亮),量 = 占比
  for (const s of activeStains()) out.push({ icon: s.kind.toLowerCase(), frac: Math.min(1, s.amt / 10), col: STAIN_COL[s.kind] || '#7fb8ff', text: `${STAIN_NAME[s.kind] || s.kind} ${Math.ceil(Math.min(1, s.amt / 10) * 100)}%` })
  // 喝药来的效果(effects: id → 剩余秒):有图标的显示剩余秒
  for (const [id, left] of Object.entries(effects)) {
    if (!(left > 0)) continue
    const icon = { HP_REGENERATION: 'hp_regeneration', PROTECTION_ALL: 'protection_all', POISONED: 'poisoned', FROZEN: 'frozen' }[id]
    if (!icon) continue
    const d = EFFECT_DEFS[id]
    out.push({ icon, frac: d?.dur ? Math.min(1, left / d.dur) : 1, col: '#ffe080', text: `${d?.name || id} ${Math.ceil(left)}s` })
  }
  return out
}
/** HUD 状态区(血条 / 悬浮条下面):图标 + 剩余量条 + 数字 */
const statusEl = $('status')
let statusHtml = ''
function updateStatusHud() {
  const list = activeStatuses()
  const html = list.map((s) => `<div class="st"><img src="${RES}/ui/status/${s.icon}.png" alt=""><i class="sb"><b style="width:${Math.round(Math.min(1, s.frac) * 100)}%;background:${s.col}"></b></i><span>${s.text}</span></div>`).join('')
  if (html !== statusHtml) { statusHtml = html; statusEl.innerHTML = html }
  statusEl.classList.toggle('air', $('air').style.display === 'block')
}
function drawStatusIcons(ctx, ox, oy) {
  const list = activeStatuses()
  if (!list.length) return
  const S = 12, gap = 2, x0 = Math.round(player.x - ox) - ((list.length * (S + gap) - gap) >> 1), y0 = Math.round(player.y - oy) + HEAD - 16 // 原图 12×12 原大小画,缩放会糊
  ctx.imageSmoothingEnabled = false
  list.forEach((s, i) => {
    const im = STATUS_ICONS[s.icon], x = x0 + i * (S + gap)
    // 原版头顶只有 ui_gfx/status_indicators 的图标本身,剩余量条 / 百分比只在 HUD 血条下面的状态区(updateStatusHud)
    if (im?.complete && im.naturalWidth) ctx.drawImage(im, x, y0, S, S)
    else { ctx.fillStyle = s.col; ctx.fillRect(x, y0, S, S) }
  })
}

function render() {
  const shk = shakeT > 0 ? shakeT * 18 : 0
  const ox = Math.round(cam.x - VW / 2 + (Math.random() - 0.5) * shk), oy = Math.round(cam.y - VH / 2 + (Math.random() - 0.5) * shk)
  // 天空:Noita 原版视差背景(weather_gfx/parallax_* 蒙版 + 昼夜色板),原作只在相机深度 < 512 时画;
  // 地下露出的空气由 chunk 位图的背景墙负责
  vctx.fillStyle = '#06070a'
  vctx.fillRect(0, 0, VW, VH)
  if (cam.y < 512) sky.draw(vctx, ox + VW / 2, oy + VH / 2, VW, VH)
  vctx.imageSmoothingEnabled = false
  const cx0 = Math.floor(ox / CHUNK) + WCX, cx1 = Math.floor((ox + VW) / CHUNK) + WCX
  const cy0 = Math.floor(oy / CHUNK) + WCY, cy1 = Math.floor((oy + VH) / CHUNK) + WCY
  let missing = 0
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const e = streamer.get(cx, cy)
    if (!e || !e.bitmap) { missing++; continue }
    vctx.drawImage(e.bitmap, (cx - WCX) * CHUNK - ox, (cy - WCY) * CHUNK - oy)
  }
  // 动态材质叠层:液体(按 materials.xml 的 alpha 半透)/ 沙 / 气 / 火(闪烁)/ 正在燃烧的材质发红
  glowPts.length = 0
  fireCells = 0
  if (simBound) {
    const img = overlay
    const d = img.data
    d.fill(0)
    const KD = sim.kind, COL = mats.color, ALP = mats.alpha, GLOW = sim.glow
    const fireM = sim.M_FIRE
    // 液体折射(post_final.frag ENABLE_REFRACTION,原式):液体格的采样坐标偏
    //   dx = sin(time×DISTORTION_TIME_SPD(10) + (u + cam.x/VW)×DISTORTION_SCALE_MULT(50)) × DISTORTION_SCALE_MULT2(0.002)  → 世界 x 的函数,幅度 0.002×427 ≈ 0.85px
    //   dy = cos(time×10 + (v − cam.y/VH)×50) × 0.002                                                                        → 世界 y 的函数,幅度 0.002×242 ≈ 0.5px
    // 只有采样到的那格也是液体才偏。液体像素和落在液体里的东西(弹丸 / 人 / 怪,见 liquidWobble)都按这张表偏
    const tW = performance.now() / 1000 * 10
    wobOx = ox; wobOy = oy
    liqMask.fill(0)
    // 没 WebGL 的退路:世界分辨率上整像素偏(0.5px 以下四舍五入就没了 → y 向 0.48px 的幅度按 |cos|>0.5 量化成 ±1);有 WebGL 时这两张表全 0,折射在 shader 里做
    for (let i = 0; i < VW; i++) wobX[i] = refr ? 0 : Math.round(Math.sin(tW + (ox + i) * (50 / VW)) * 0.002 * VW)
    for (let j = 0; j < VH; j++) { const c = Math.cos(tW + (oy + j) * (50 / VH)); wobY[j] = refr ? 0 : c > 0.5 ? 1 : c < -0.5 ? -1 : 0 }
    for (let j = 0; j < VH; j++) {
      const wy = oy + j
      for (let i = 0; i < VW; i++) {
        const wx = ox + i
        const e = sim._entry(wx, wy)
        if (!e) continue
        let li = (wy & 511) * CHUNK + (wx & 511), src = e
        let m = e.mat[li]
        if (m === 0) continue
        const k = KD[m]
        const o = (j * VW + i) * 4
        // 折射是"采样"(gather):这一格是液体 → 颜色取偏移处那格(也得是液体)。不能反过来把自己写到偏移处(scatter):
        // 偏移量随 x 从 0 跳到 1 的那一列会被写两次、旁边一列没人写 → 水面上一条条黑线(用户截图)
        if (k === 3) {
          liqMask[j * VW + i] = 255
          const ii = i + wobX[i], jj = j + wobY[j]
          if ((ii !== i || jj !== j) && ii >= 0 && ii < VW && jj >= 0 && jj < VH) {
            const e2 = sim._entry(ox + ii, oy + jj)
            if (e2) { const li2 = ((oy + jj) & 511) * CHUNK + ((ox + ii) & 511), m2 = e2.mat[li2]; if (m2 > 0 && KD[m2] === 3) { m = m2; li = li2; src = e2 } }
          }
        }
        if (k >= 2) {
          const c = COL[m]
          let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, a = k === 2 ? 255 : ALP[m]
          // 发光材质(gfx_glow:火 255 / 熔岩 150 / 毒液 60 / 荧光岩…):post_final.frag 把 glow 贴图(材质色 × gfx_glow/255)加进 lights(自己不被黑暗压暗)
          // 再 screen 叠到画面上 —— 毒液 Graphics color 44B4FF10 只有 27% 的 alpha,靠 glow 才是原版那种亮黄绿。这里:alpha 加上 gfx_glow,再每 5 格采一点进光源表(halo + 不被压暗)
          if (GLOW[m]) { a = Math.min(255, a + GLOW[m]); if (glowPts.length < 1600 && ((wx + wy * 3) % 5) === 0) glowPts.push(i, j, GLOW[m], c) }
          if (m === fireM) { fireCells++; const f = 0.7 + Math.random() * 0.3; r = 255; g = (140 + Math.random() * 90) | 0; b = 40; a = (255 * f) | 0 }
          else if (k === 4) a = Math.min(a, 140) // 气体更透
          else if (k === 2) { const h = ((wx * 374761393 + wy * 668265263) >>> 0) % 100; const jt = 0.86 + h / 100 * 0.28; r *= jt; g *= jt; b *= jt }
          if (src.aux[li] && k !== 5 && k !== 4) { r = Math.min(255, r + 120); g = Math.min(255, g + 40) } // 燃烧中
          d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a
        } else if (k === 1 && e.aux[li]) { d[o] = 255; d[o + 1] = 120; d[o + 2] = 30; d[o + 3] = 150 } // 燃烧的木头
      }
    }
    overlayCv.getContext('2d').putImageData(img, 0, 0)
    vctx.drawImage(overlayCv, 0, 0)
  }
  // 碎屑:1px 真材质色
  for (const p of debris) { const c = p.col; vctx.fillStyle = `rgb(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255})`; vctx.fillRect(Math.round(p.x - ox), Math.round(p.y - oy), 1, 1) }
  projectiles.render(vctx, ox, oy)
  for (const p of sparks) { vctx.fillStyle = p.c; vctx.globalAlpha = p.noFade ? 1 : Math.min(1, p.life * 3); vctx.fillRect(Math.round(p.x - ox), Math.round(p.y - oy), 1, 1) }
  vctx.globalAlpha = 1
  // 灯:wang 标记 spawn_lamp/candles/torch 掷出来的光源,画个小灯笼/蜡烛
  const lamps = []
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const e = streamer.get(cx, cy)
    if (!e?.lights) continue
    // 带 ent 的灯(矿里的小灯笼)已经是真道具(Entities 按标记点放的刚体,自带火苗与光),这里不再画
    for (const l of e.lights) { if (!l.ent && l.x >= ox - 64 && l.x < ox + VW + 64 && l.y >= oy - 64 && l.y < oy + VH + 64 && !lamps.some((q) => q.x === l.x && q.y === l.y)) lamps.push(l) }
  }
  for (const l of lamps) {
    const lx = Math.round(l.x - ox), ly = Math.round(l.y - oy)
    if (l.kind === 'lantern') {
      vctx.fillStyle = '#3a3a40'; vctx.fillRect(lx, ly - 8, 1, 6)
      vctx.fillStyle = '#5a4a30'; vctx.fillRect(lx - 2, ly - 2, 5, 6)
      vctx.fillStyle = '#ffd070'; vctx.fillRect(lx - 1, ly - 1, 3, 4)
    } else if (l.kind === 'candle') { vctx.fillStyle = '#e8e0c0'; vctx.fillRect(lx, ly - 3, 2, 3); vctx.fillStyle = '#ffb040'; vctx.fillRect(lx, ly - 5, 2, 2) }
    else if (l.kind === 'tubelamp') {
      // 雪城堡管灯(physics_tubelamp:两根吊线 + 横管,光 200,230,255 r150)
      vctx.fillStyle = '#404850'; vctx.fillRect(lx - 5, ly - 10, 1, 8); vctx.fillRect(lx + 5, ly - 10, 1, 8)
      vctx.fillStyle = '#c8e8ff'; vctx.fillRect(lx - 7, ly - 2, 15, 2)
    } else if (l.kind === 'torchstand') {
      // 丛林火炬座(physics_torch_stand:座 + 杆 + 火,光 r96)
      vctx.fillStyle = '#4a4038'; vctx.fillRect(lx - 3, ly - 1, 7, 2); vctx.fillStyle = '#6a5030'; vctx.fillRect(lx, ly - 14, 2, 13)
      vctx.fillStyle = '#ff9030'; vctx.fillRect(lx - 1, ly - 18, 4, 5); vctx.fillStyle = '#ffe080'; vctx.fillRect(lx, ly - 17, 2, 2)
    } else { vctx.fillStyle = '#6a4a20'; vctx.fillRect(lx, ly - 6, 2, 6); vctx.fillStyle = '#ff9030'; vctx.fillRect(lx - 1, ly - 9, 4, 4) }
  }
  veg.render(vctx, ox, oy)
  entities.render(vctx, ox, oy)
  renderPortals(vctx, ox, oy)
  // 人在液体里:整个人跟着液体折射偏(post_final.frag 是对整张前景按液体格采样,人 / 弹在水里都跟着晃)
  const pw = liquidWobble(player.x, player.y - 4)
  drawPlayer(vctx, ox - (pw ? pw[0] : 0), oy - (pw ? pw[1] : 0))
  if (player.hurtFlash > 0) { vctx.fillStyle = `rgba(255,0,0,${(player.hurtFlash * 1.2).toFixed(2)})`; vctx.fillRect(0, 0, VW, VH) }
  // 光照:Noita 洞穴是黑的,画面由光源驱动。低分辨率光图(1/4)叠加所有光源 → multiply 回主画面
  const depth = Math.max(0, Math.min(1, (cam.y + 40) / 240)) // 地表 0 → 地下 1
  // 地表环境光跟着天色(夜里 sky_light 变暗,原作地表夜晚也是黑的);地下不受影响
  const ambient = Math.max((0.35 + 0.65 * sky.daylight()) * (1 - depth) + 0.1 * depth, hasEffect('NIGHTVISION') ? 0.55 : 0) // 夜视药:洞里也亮
  const L = lightCv.getContext('2d'), lw = lightCv.width, lh = lightCv.height, s = 0.25
  L.globalCompositeOperation = 'source-over'
  L.fillStyle = `rgb(${(ambient * 255) | 0},${(ambient * 255) | 0},${(ambient * 255 * 1.05) | 0})`
  L.fillRect(0, 0, lw, lh)
  L.globalCompositeOperation = 'lighter'
  const light = (x, y, r, rgb, a) => {
    if (!(r > 0)) return // 半径 ≤0 / NaN:createRadialGradient 会抛 IndexSizeError,一帧抛错整个循环就停了
    const g = L.createRadialGradient(x * s, y * s, 0, x * s, y * s, r * s)
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.5, `rgba(${rgb},${a * 0.35})`); g.addColorStop(1, 'rgba(0,0,0,0)')
    L.fillStyle = g; L.beginPath(); L.arc(x * s, y * s, r * s, 0, 7); L.fill()
  }
  light(player.x - ox, player.y - oy, 150, '255,240,210', 0.95)
  for (const l of lamps) light(l.x - ox, l.y - oy - (l.kind === 'torchstand' ? 16 : 2), l.kind === 'lantern' ? 120 : l.kind === 'candle' ? 55 : l.kind === 'tubelamp' ? 150 : l.kind === 'torchstand' ? 96 : 90, l.kind === 'candle' ? '255,200,120' : l.kind === 'tubelamp' ? '200,230,255' : '255,190,110', 0.9)
  // lights += glow:发光格照亮自己那一小圈(火 gl=1 → 0.65,熔岩 0.59 → 0.5,毒液 0.235 → 0.38),半径 14~36
  for (let k = 0; k < glowPts.length; k += 4) {
    const c = glowPts[k + 3], gl = glowPts[k + 2] / 255
    light(glowPts[k], glowPts[k + 1], 14 + gl * 22, `${(c >> 16) & 255},${(c >> 8) & 255},${c & 255}`, Math.min(0.8, 0.3 + 0.35 * gl))
  }
  // 投射物 LightComponent 彩色光 + 发射/爆炸闪光;道具的光(矿灯)
  projectiles.lights(light, ox, oy)
  entities.lights(light, ox, oy)
  for (const p of temple.portals) if (p.on && Math.abs(p.x - cam.x) < VW && Math.abs(p.y - cam.y) < VH) { light(p.x - ox, p.y - oy - 16, 255, '64,100,255', 0.55); light(p.x - ox, p.y - oy - 16, 64, '64,100,255', 0.9) }
  vctx.globalCompositeOperation = 'multiply'
  vctx.imageSmoothingEnabled = true
  vctx.drawImage(lightCv, 0, 0, VW, VH)
  vctx.globalCompositeOperation = 'source-over'
  vctx.imageSmoothingEnabled = false
  gctx.imageSmoothingEnabled = false
  // 放大到屏幕:有 WebGL 走液体折射 shader(post_final.frag 原式,屏幕分辩率亚像素采样),否则直接贴
  if (refr && simBound) gctx.drawImage(refr.render(view, liqMask, VW, VH, performance.now() / 1000, cam.x, cam.y), 0, 0)
  else gctx.drawImage(view, 0, 0, game.width, game.height)
  // 瞄准点
  if (touch.aim) {
    // 瞄准摇杆指示:原点小环 + 方向点(限制在 40px 内)
    const d = Math.hypot(touch.aim.dx, touch.aim.dy), r = Math.min(d, 40)
    aimEl.style.left = touch.aim.x0 + (d ? (touch.aim.dx / d) * r : 0) + 'px'; aimEl.style.top = touch.aim.y0 + (d ? (touch.aim.dy / d) * r : 0) + 'px'
    gctx.strokeStyle = 'rgba(255,220,120,0.35)'; gctx.beginPath(); gctx.arc(touch.aim.x0, touch.aim.y0, 40, 0, 7); gctx.stroke()
    // 世界里的瞄准线:从杖尖沿瞄准方向画一小段
    const [sx, sy] = toScreen(player.aimX, player.aimY)
    gctx.strokeStyle = 'rgba(255,220,120,0.8)'; gctx.beginPath(); gctx.arc(sx, sy, 4, 0, 7); gctx.stroke()
  }
  else if (!IS_TOUCH) { const [sx, sy] = toScreen(player.aimX, player.aimY); gctx.strokeStyle = 'rgba(255,220,120,0.9)'; gctx.beginPath(); gctx.arc(sx, sy, 5, 0, 7); gctx.stroke() }
  return missing
}

// 模拟窗口:视口外再各留 SIM_MARGIN(≈ 一个 chunk),但整窗跨度 < 1536 才能保证落在 CellSim 的 4×4 chunk 表里(跨度 S 最多碰 floor(S/512)+2 个 chunk)
const SIM_MARGIN = 512
function simWindow() {
  const mx = Math.min(SIM_MARGIN, Math.floor((1530 - VW) / 2)), my = Math.min(SIM_MARGIN, Math.floor((1530 - VH) / 2))
  return { x0: cam.x - VW / 2 - mx, y0: cam.y - VH / 2 - my, x1: cam.x + VW / 2 + mx, y1: cam.y + VH / 2 + my }
}
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now
  // 区块流:以相机为中心的一屏 + 边距;再加上模拟窗口那一圈
  const half = { x: VW / 2 + 32, y: VH / 2 + 32 }
  const simRect = simWindow()
  streamer.update({ x0: cam.x - half.x, y0: cam.y - half.y, x1: cam.x + half.x, y1: cam.y + half.y }, dt * 1000, simRect)
  // 新就位的 chunk:把它的生成点实例化(每 chunk 一次)
  for (const e of streamer.entries.values()) if (e.ready && e.spawns?.length && !entities.liveChunks.has(e.key)) entities.spawnChunk(e)
  // 材质模拟:激活窗口 = 视口 + SIM_MARGIN(Noita 模拟的是玩家周围一整片加载区,不只屏幕 —— 屏幕外的爆炸 / 崩塌 / 流水照常进行,走过去不会"忽然开始动");
  // 视口那一圈的 chunk 齐了就跑,外圈没到的先当 -1
  const t0 = performance.now()
  simBound = sim.bind(simRect.x0, simRect.y0, simRect.x1, simRect.y1, { x0: cam.x - VW / 2 - 24, y0: cam.y - VH / 2 - 24, x1: cam.x + VW / 2 + 24, y1: cam.y + VH / 2 + 24 })
  if (simBound && !paused) sim.step()
  simMs = simMs * 0.9 + (performance.now() - t0) * 0.1
  // 静态材质变了的 chunk,节流后让 Worker 重画位图
  for (const [k, due] of repaintDue) if (now >= due) { repaintDue.delete(k); const [cx, cy] = k.split(',').map(Number); streamer.repaint(cx, cy) }
  // 脚下区块没就位就先别动(开局那一下);暂停 / 背包打开时世界也停
  if (!player.dead && !paused && !editor.open && streamer.get(Math.floor(player.x / CHUNK) + WCX, Math.floor(player.y / CHUNK) + WCY)) { step(dt); updateQuest(dt) }
  if (!paused) sky.tick(dt)
  saveT += dt; if (saveT >= 5) { saveT = 0; if (!player.dead && simBound) saveGame() }
  const missing = render()
  drawQuest()
  renderSlots()
  // 声音:喷气噪声 / 火焰噼啪 / 洞穴环境音随深度
  sfx.tick()
  sfx.loop('jet', player.thrusting, { vol: 0.22, freq: 900, q: 0.6 })
  sfx.loop('spray', spraying, { vol: 0.14, freq: 1800, q: 0.5 }) // 材质喷射法术的 sound_spray 循环
  sfx.loop('fire', fireCells > 0, { vol: Math.min(0.3, 0.05 + fireCells / 400), freq: 2400, q: 0.4 })
  // 弹丸的 AudioLoopComponent(黑洞 / 场 / 雷霆之环 / 电水):原版是 FMOD 事件,这里按名字配合成噪声的音色;离得越远越小
  for (const [name, cfg] of Object.entries(PROJ_LOOPS)) {
    let near = 0
    if (projectiles.loops.get(name)) for (const p of projectiles.list) if (p.d.loop === name) near = Math.max(near, 1 - Math.min(1, Math.hypot(p.x - player.x, p.y - player.y) / 260))
    if (name === 'zap' && projectiles.zaps.length) for (const z of projectiles.zaps) near = Math.max(near, 1 - Math.min(1, Math.hypot(z.x - player.x, z.y - player.y) / 200))
    sfx.loop('pl_' + name, near > 0.02, { vol: cfg.vol * (0.3 + 0.7 * near), freq: cfg.freq, q: cfg.q })
  }
  sfx.setDepth(Math.max(0, Math.min(1, (player.y + 40) / 240)), dt)
  fpsAcc += dt; fpsN++
  if (fpsAcc >= 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0 }
  // 着火 / 沾污 / 有图标的药效走血条下面的状态区;剩下没图标的药效仍在文字行里
  const shown = new Set(['WET', 'OILED', 'BLOODY', 'SLIMY', 'RADIOACTIVE', 'HP_REGENERATION', 'PROTECTION_ALL', 'POISONED', 'FROZEN'])
  const status = Object.keys(effects).filter((k) => !k.startsWith('_') && effects[k] > 0 && !shown.has(k)).map((k) => `${EFFECT_DEFS[k]?.name || k} ${Math.ceil(effects[k])}s`).join(' ')
  updateStatusHud()
  if (IS_TOUCH) $('btnDrink').style.display = curWand()?.potion ? 'flex' : 'none'
  const cw = curWand()
  const nSlots = player.wands.length + player.items.length
  const wandLine = cw.debug ? `法杖 [${payload + 1}] ${cw.name}(${cw.proj})`
    : cw.potion ? `物品 [${payload + 1}/${nSlots}] ${cw.name} ${cw.potion.left}  (开火 = 扔)`
    : `法杖 [${payload + 1}/${nSlots}] ${cw.name}  法力 ${cw.mana | 0}/${cw.manaMax}${cw.reloadT > 0 ? ' 充能中' : ''}  ${[...new Set(cw.cards)].map((c) => (wands.spell(c)?.name || c) + (c in cw.uses ? `×${cw.uses[c]}` : cw.cards.filter((k) => k === c).length > 1 ? `×${cw.cards.filter((k) => k === c).length}` : '')).join('·')}${cw.cards.some((c) => !(c in cw.uses) || cw.uses[c] > 0) ? '' : '  (用完了:圣山法术刷新可补满)'}` // 容量 / 延迟 / 充能等细节在背包里看
  const atTemple = inTemple()
  $('btnEdit').classList.toggle('on', atTemple)
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('tip').textContent = TIP0 }
  const perkLine = player.perks.length ? '  特权 ' + player.perks.map((id) => perks.perk(id)?.name || id).join('·') : ''
  $('hud').textContent = `(${player.x | 0}, ${player.y | 0})  深度 ${Math.max(0, player.y | 0)}  HP ${Math.ceil(player.hp * 25)}/${Math.round(player.maxHp * 25)}  金 ${player.gold}${player.spells.length ? '  散卡 ' + player.spells.length : ''}${status ? '  [' + status + ']' : ''}${atTemple ? '  [圣山:I / 编辑法杖]' : ''}${perkLine}\n${wandLine}  怪 ${entities.list.length} 道具 ${entities.bodies.length}`
  $('hp').firstElementChild.style.width = (player.hp / player.maxHp * 100) + '%'
  // 捡心 / 回满:血条闪白(原版 max_hp_old / mLastMaxHpChangeFrame 让血条动一下);法术刷新:法杖法力条闪
  if (player.hpGrowT > 0) { player.hpGrowT -= dt; $('hp').firstElementChild.style.background = (player.hpGrowT * 8 | 0) % 2 ? '#fff0f0' : '#e0484f' } else if ($('hp').firstElementChild.style.background) $('hp').firstElementChild.style.background = ''
  if (player.manaFlashT > 0) player.manaFlashT -= dt
  if (importantT > 0) { importantT -= dt; if (importantT <= 0) $('important').classList.remove('on') }
  $('fuel').firstElementChild.style.width = player.fuel + '%'
  $('fuel').firstElementChild.style.background = player.flyExhausted ? '#e0484f' : '#7fd4ff'
  // 气条:只在憋着气时显示(原版 HUD 也是入水才出)
  $('air').style.display = player.air < 7 ? 'block' : 'none'
  $('air').firstElementChild.style.width = (player.air / 7 * 100) + '%'
  $('air').firstElementChild.style.background = player.air <= 0 ? '#e0484f' : '#d8f0ff'
  $('panel').textContent = `${fps.toFixed(0)} fps  ${VW}×${VH}@${SCALE.toFixed(2)}x\n模拟 ${simMs.toFixed(1)}ms 醒 ${sim.activeBlocks} 块 动了 ${sim.stepped} 格 · 反应表 ${sim.rxCount}\n区块 常驻 ${streamer.entries.size} 在途 ${streamer.inFlight.size}${missing ? ' 缺 ' + missing : ''}\nseed ${SEED} · 日志 ${oplog.session.slice(9)} 已传 ${oplog.sent}${oplog.failed ? ' 失败 ' + oplog.failed : ''}`
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
window.__np = { player, cam, streamer, client, sim, mats, oplog, sfx, P, projectiles, WANDS, wands, sky, bubbles, debris, sparks, liquidWobble, refr, entities, Ragdoll, veg, guard, solidAt, flags, matAt, setWand: (i) => { payload = i }, pickWand, payloadIdx: () => payload, quest: () => quest, touchState: () => touch, kick, setPaused, editor, tut, saveGame, loadGame, clearSave, temple, collapses, collapsed, loaded }
