/**
 * 元素反应实验场 · Noita 化验证 demo（v2:弹道 × 元素 自由拼装）
 *
 * 目的：在把元素反应系统搬进 airCombat.js 之前，用这个小沙盒验证
 * 「哪些组合反应真的好玩」。v2 把技能拆成两个正交层——
 *   弹道行为：速射 / 追踪(重击) / 抛雾(落点铺元素云) / 光束
 *   元素涂层：冰 / 火 / 油 / 电
 * 三个装配槽任意拼装 = 4×4=16 种技能，可同时多开互相连锁。
 * 反应矩阵：油+火=爆燃 / 火焰传染 / 冰冻+重击=碎冰处决 / 电+冰=超导
 *   火+冰=急冷碎裂 / 燃气星云轰燃 / 电离星云引弧 / 油雾殉爆
 * 自包含：不加载任何游戏资源，全部贴图由 canvas 程序化生成。
 */
import * as PIXI from 'pixi.js'

const stageEl = document.getElementById('stage')
const app = new PIXI.Application({
  resizeTo: stageEl,
  backgroundColor: 0x070a12,
  antialias: true,
  resolution: Math.min(2, window.devicePixelRatio || 1),
  autoDensity: true,
})
stageEl.appendChild(app.view)

// ── 世界容器（shake 用 world 偏移） ─────────────────────
const world = new PIXI.Container()
app.stage.addChild(world)
const bgC = new PIXI.Container()      // 星空背景
const cloudC = new PIXI.Container()   // 星云 / 油雾 / 火场 / 冻雾 / 静电云
const enemyC = new PIXI.Container()
const bulletC = new PIXI.Container()
const fxC = new PIXI.Container()      // 粒子 / 环 / 电弧
const uiC = new PIXI.Container()      // 漂浮文字 / 发现横幅
world.addChild(bgC, cloudC, enemyC, bulletC, fxC)
app.stage.addChild(uiC)

const SW = () => app.screen.width
const SH = () => app.screen.height

// ── 程序化贴图 ──────────────────────────────────────
function makeOrbTex(size = 128, inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)') {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grd.addColorStop(0, inner)
  grd.addColorStop(0.4, mid)
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  return PIXI.Texture.from(c)
}
const orbTex = makeOrbTex()
const softTex = makeOrbTex(128, 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.18)')

function makeRingTex(size = 128) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  g.strokeStyle = 'rgba(255,255,255,1)'
  g.lineWidth = size * 0.05
  g.beginPath()
  g.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2)
  g.stroke()
  return PIXI.Texture.from(c)
}
const ringTex = makeRingTex()

function texFromGraphics(g) {
  return app.renderer.generateTexture(g, PIXI.SCALE_MODES.LINEAR, 2)
}
// 敌机三种材质外形
function makeShipTex(kind) {
  const g = new PIXI.Graphics()
  if (kind === 'normal') {
    g.beginFill(0x5a6a7e)
    g.moveTo(0, -16); g.lineTo(13, 12); g.lineTo(0, 6); g.lineTo(-13, 12); g.closePath()
    g.endFill()
    g.beginFill(0x9fb4c8); g.drawCircle(0, -3, 3.4); g.endFill()
  } else if (kind === 'tanker') {
    g.beginFill(0x6e5a36)
    g.drawEllipse(0, 0, 13, 17)
    g.endFill()
    g.beginFill(0x4a3c22); g.drawRect(-13, -4, 26, 8); g.endFill()
    g.beginFill(0xc9a86a); g.drawCircle(0, 0, 4); g.endFill()
  } else { // armored
    g.beginFill(0x37475e)
    g.moveTo(0, -18); g.lineTo(15, -7); g.lineTo(15, 9); g.lineTo(0, 17); g.lineTo(-15, 9); g.lineTo(-15, -7); g.closePath()
    g.endFill()
    g.lineStyle(2.5, 0x7d94b4, 1)
    g.moveTo(-10, -5); g.lineTo(10, -5); g.moveTo(-10, 3); g.lineTo(10, 3)
    g.lineStyle(0)
    g.beginFill(0xaad0ff); g.drawCircle(0, -9, 3); g.endFill()
  }
  return texFromGraphics(g)
}
const SHIP_TEX = { normal: makeShipTex('normal'), tanker: makeShipTex('tanker'), armored: makeShipTex('armored') }
// 玩家机
const playerTex = (() => {
  const g = new PIXI.Graphics()
  g.beginFill(0x8dd8cf)
  g.moveTo(0, -22); g.lineTo(16, 16); g.lineTo(0, 8); g.lineTo(-16, 16); g.closePath()
  g.endFill()
  g.beginFill(0xe8fff8); g.drawCircle(0, -6, 4); g.endFill()
  return texFromGraphics(g)
})()
// 碎冰渣
const shardTex = (() => {
  const g = new PIXI.Graphics()
  g.beginFill(0xd8f4ff)
  g.moveTo(0, -6); g.lineTo(5, 3); g.lineTo(-3, 5); g.closePath()
  g.endFill()
  return texFromGraphics(g)
})()

// ── 背景星星 ────────────────────────────────────────
function buildBg() {
  bgC.removeChildren()
  for (let i = 0; i < 90; i++) {
    const s = new PIXI.Sprite(orbTex)
    s.anchor.set(0.5)
    s.blendMode = PIXI.BLEND_MODES.ADD
    s.scale.set(0.015 + Math.random() * 0.035)
    s.alpha = 0.25 + Math.random() * 0.5
    s.tint = [0xffffff, 0xaecbff, 0xffd9a8][(Math.random() * 3) | 0]
    s.x = Math.random() * SW()
    s.y = Math.random() * SH()
    bgC.addChild(s)
  }
}
buildBg()

// ── 状态与实体 ──────────────────────────────────────
const enemies = []
const bullets = []
const clouds = []   // { kind, x, y, r, view, burnt, t, zapT, effT, life, vy }
const particles = []
const floaters = []
const arcs = []     // { pts, t, life, color, w }
const timers = []
let shake = 0
let killCount = 0

const ship = {
  x: 0, y: 0, tx: 0, ty: 0, spr: null, trailT: 0,
  hp: 100, maxHp: 100, iframe: 0, burnT: 0, burnTick: 0, deadT: 0, crashes: 0,
}
ship.spr = new PIXI.Sprite(playerTex)
ship.spr.anchor.set(0.5)
world.addChild(ship.spr)
ship.x = ship.tx = 400
ship.y = ship.ty = 700
// 机体血条(跟随机身) + 右上角状态文字
const shipHpG = new PIXI.Graphics()
uiC.addChild(shipHpG)
const statsText = new PIXI.Text('', {
  fontFamily: 'Georgia, "Noto Serif SC", serif', fontSize: 14, fontWeight: '700',
  fill: 0x9fd8cf, stroke: 0x101418, strokeThickness: 3,
})
statsText.anchor.set(1, 0)
uiC.addChild(statsText)

/** 玩家与敌人吃同一套规则(Noita 铁律):火场/轰燃/残骸都会伤到自己 */
function hurtShip(d) {
  if (ship.deadT > 0) return
  ship.hp -= d
  shake = Math.max(shake, 3)
  if (ship.hp <= 0) crashShip()
}
function damagePlayer(d) {
  if (ship.iframe > 0 || ship.deadT > 0) return
  ship.iframe = 0.3
  hurtShip(d)
}
function burnShip(dur) {
  if (ship.deadT > 0) return
  if (ship.burnT <= 0) countRx('引火烧身', ship.x, ship.y - 34, 0xff8030)
  ship.burnT = Math.max(ship.burnT, dur)
}
function crashShip() {
  ship.crashes++
  boomFx(ship.x, ship.y, 1.4, 0xff9040)
  addFloater('坠机!!', ship.x, ship.y - 30, 0xff7050, 26)
  ship.deadT = 1.6
  ship.burnT = 0
  ship.spr.visible = false
  shake = Math.max(shake, 14)
}

// 指针驾驶
stageEl.addEventListener('pointermove', (e) => {
  const r = stageEl.getBoundingClientRect()
  ship.tx = e.clientX - r.left
  ship.ty = e.clientY - r.top
})
stageEl.addEventListener('pointerdown', (e) => {
  const r = stageEl.getBoundingClientRect()
  ship.tx = e.clientX - r.left
  ship.ty = e.clientY - r.top
})

// ── 工具 ───────────────────────────────────────────
const dist2 = (x0, y0, x1, y1) => (x0 - x1) ** 2 + (y0 - y1) ** 2
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function spawnParticle(tex, x, y, o = {}) {
  if (particles.length > 500) return
  const s = new PIXI.Sprite(tex)
  s.anchor.set(0.5)
  s.x = x; s.y = y
  s.scale.set(o.scale ?? 0.1)
  if (o.tint != null) s.tint = o.tint
  s.alpha = o.alpha ?? 1
  if (o.add) s.blendMode = PIXI.BLEND_MODES.ADD
  s.rotation = o.rot ?? 0
  fxC.addChild(s)
  particles.push({
    spr: s, vx: o.vx || 0, vy: o.vy || 0, life: o.life ?? 0.4, age: 0,
    drag: o.drag ?? 1, grow: o.grow ?? 0, spin: o.spin || 0, a0: s.alpha,
  })
}
// 简易逐帧插值器
const lerps = []
function timersEvery(obj, dur, fn, done) {
  lerps.push({ t: 0, dur, fn, done })
}
function spawnRing(x, y, o = {}) {
  const s = new PIXI.Sprite(ringTex)
  s.anchor.set(0.5)
  s.blendMode = PIXI.BLEND_MODES.ADD
  s.x = x; s.y = y
  s.tint = o.tint ?? 0xffffff
  fxC.addChild(s)
  const r0 = o.r0 ?? 10, r1 = o.r1 ?? 120, life = o.life ?? 0.3, a0 = o.alpha ?? 0.9
  timersEvery(s, life, (k) => {
    const r = r0 + (r1 - r0) * k
    s.width = s.height = r * 2
    s.alpha = a0 * (1 - k)
  }, () => { fxC.removeChild(s); s.destroy() })
}
function spawnArc(x0, y0, x1, y1, color = 0xaaddff, w = 3, life = 0.14) {
  const pts = [{ x: x0, y: y0 }]
  const segs = 7
  const dx = x1 - x0, dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len, ny = dx / len
  for (let i = 1; i < segs; i++) {
    const t = i / segs
    const off = (Math.random() - 0.5) * len * 0.16
    pts.push({ x: x0 + dx * t + nx * off, y: y0 + dy * t + ny * off })
  }
  pts.push({ x: x1, y: y1 })
  arcs.push({ pts, t: 0, life, color, w })
}
const arcG = new PIXI.Graphics()
arcG.blendMode = PIXI.BLEND_MODES.ADD
fxC.addChild(arcG)

function addFloater(str, x, y, color = 0xffe9a0, size = 18) {
  const t = new PIXI.Text(str, {
    fontFamily: 'Georgia, "Noto Serif SC", serif', fontSize: size, fontWeight: '900',
    fill: color, stroke: 0x101418, strokeThickness: 4,
  })
  t.anchor.set(0.5)
  t.x = x; t.y = y
  uiC.addChild(t)
  floaters.push({ spr: t, t: 0, life: 0.9, vy: -46 })
}

// ── 反应统计 + 发现横幅 ──────────────────────────────
const rxCount = {}
const rxSeen = new Set()
const RX_DESC = {
  '爆燃': '油 + 火 = 殉爆并点燃周围',
  '闪燃': '油 + 电 = 电火花引燃油层',
  '火焰传染': '燃烧的敌机点燃邻近油层',
  '碎冰处决': '冰冻/脆壳 + 重击 = 整机爆碎',
  '超导': '电击冰冻目标 = 电弧暴走',
  '急冷碎裂': '火与冰相遇 = 温差爆碎',
  '凝油脆壳': '油 + 冰 = 凝固,任何直击可处决',
  '等离子引爆': '电击燃烧目标 = 结算燃烧成爆伤',
  '星云轰燃': '火种点燃燃气星云',
  '电离风暴': '电击引爆电离星云',
  '油雾殉爆': '火种点燃油雾 = 持续火场',
  '燃烧残骸': '燃烧中被击毁 = 火种四散漂流',
  '冰晶弹片': '碎冰反应崩出弹片,冻结命中者',
  '机油泄漏': '装甲机坠毁漏油 = 战场积累燃料',
  '引火烧身': '火场与爆炸对玩家同样生效!',
}
/** 效果图鉴：全部效果一览。rx=true 的条目灰显,触发后点亮并计数 */
const CODEX = [
  ['基础元素(单独命中)', [
    ['冻结', '冰:定身 1~2 秒'],
    ['燃烧', '火:持续掉血'],
    ['麻痹链电', '电:定身 + 跳 1~3 个目标'],
    ['油涂层', '油:无伤害,纯燃料投资'],
  ], false],
  ['元素 × 元素', [
    ['爆燃', '油+火'], ['闪燃', '油+电'], ['急冷碎裂', '冰+火'], ['超导', '冰+电'],
    ['凝油脆壳', '油+冰'], ['等离子引爆', '火+电'], ['火焰传染', '燃烧→邻近油'],
  ], true],
  ['状态 × 重击', [['碎冰处决', '冻结/脆壳+重击']], true],
  ['元素 × 环境', [
    ['星云轰燃', '火×燃气星云'], ['电离风暴', '电×电离星云'], ['油雾殉爆', '火×油雾'],
  ], true],
  ['元素 × 材质', [
    ['装甲机', '直击 -55%,状态伤害全额'],
    ['油罐机', '自带油,死亡漏油,火中殉爆'],
  ], false],
  ['循环 · 效果产生效果', [
    ['燃烧残骸', '燃烧中被毁→火种漂散'],
    ['冰晶弹片', '碎冰反应→弹片再冻结'],
    ['机油泄漏', '装甲机坠毁→漏油'],
    ['引火烧身', '玩家也吃同一套规则'],
  ], true],
]
const logEl = document.getElementById('log')
function renderCodex() {
  let total = 0
  let lit = 0
  let html = ''
  for (const [group, items, isRx] of CODEX) {
    html += `<div class="cx-h">${group}</div>`
    for (const [name, desc] of items) {
      total++
      const n = rxCount[name] || 0
      const on = !isRx || n > 0
      if (on) lit++
      html += `<div class="rx ${on ? '' : 'dim'}"><b>${name}</b><span>${desc}</span>${isRx ? `<span class="n">${n > 0 ? '×' + n : '未触发'}</span>` : ''}</div>`
    }
  }
  document.getElementById('codex-title').textContent = `效果图鉴 · ${lit}/${total} 已见`
  logEl.innerHTML = html
}
function countRx(name, x, y, color = 0xffd24a) {
  rxCount[name] = (rxCount[name] || 0) + 1
  if (x != null) addFloater(name + '!!', x, y, color, name.length > 3 ? 20 : 24)
  if (!rxSeen.has(name)) {
    rxSeen.add(name)
    showDiscover(name)
  }
  renderCodex()
}
renderCodex()
// 发现横幅排队逐条播,避免连锁时多条叠字
const bannerQueue = []
let bannerActive = false
function showDiscover(name) {
  bannerQueue.push(name)
  pumpBanner()
}
function pumpBanner() {
  if (bannerActive || !bannerQueue.length) return
  bannerActive = true
  const name = bannerQueue.shift()
  const t = new PIXI.Text(`✦ 发现反应 ✦\n${RX_DESC[name] || name}`, {
    fontFamily: 'Georgia, "Noto Serif SC", serif', fontSize: 30, fontWeight: '900',
    fill: 0xffe9a0, stroke: 0x2a1a05, strokeThickness: 6, align: 'center', lineHeight: 40,
  })
  t.anchor.set(0.5)
  t.x = SW() / 2
  t.y = SH() * 0.24
  t.alpha = 0
  t.scale.set(0.6)
  uiC.addChild(t)
  timersEvery(t, 2.0, (k) => {
    const inK = clamp(k / 0.14, 0, 1)
    const outK = clamp((k - 0.8) / 0.2, 0, 1)
    t.alpha = inK * (1 - outK)
    t.scale.set(0.6 + 0.4 * Math.min(1, inK * 1.2))
  }, () => { uiC.removeChild(t); t.destroy(); bannerActive = false; pumpBanner() })
}

// ── 敌人 ───────────────────────────────────────────
const E_DEF = {
  normal: { hp: 6, spd: 55, size: 1.35 },
  tanker: { hp: 10, spd: 42, size: 1.5 },
  armored: { hp: 30, spd: 30, size: 1.6 },
}
function spawnEnemy(type, x, y) {
  const d = E_DEF[type]
  const view = new PIXI.Container()
  const body = new PIXI.Sprite(SHIP_TEX[type])
  body.anchor.set(0.5)
  body.rotation = Math.PI // 机头朝下
  view.addChild(body)
  view.scale.set(d.size)
  view.x = x; view.y = y
  enemyC.addChild(view)
  const e = {
    type, x, y, vx: (Math.random() - 0.5) * 30, vy: d.spd * (0.8 + Math.random() * 0.4),
    kx: 0, ky: 0, // 爆炸冲击波击退速度(快速衰减)
    hp: d.hp, maxHp: d.hp, view, body,
    wob: Math.random() * 10, wobA: 20 + Math.random() * 30,
    oilT: 0, burnT: 0, burnTick: 0, spreadT: 0, frozenT: 0, shockT: 0, brittle: false,
    oilSpr: null, iceSpr: null, flashT: 0,
  }
  if (type === 'tanker') applyOil(e, 999) // 油罐机出厂自带油涂层
  enemies.push(e)
  return e
}
function removeEnemy(e) {
  const i = enemies.indexOf(e)
  if (i >= 0) enemies.splice(i, 1)
  enemyC.removeChild(e.view)
  e.view.destroy({ children: true })
}
function killEnemy(e, opt = {}) {
  killCount++
  boomFx(e.x, e.y, opt.big ? 1.2 : 0.7, opt.tint ?? 0xffa050)
  for (let i = 0; i < (opt.big ? 10 : 6); i++) {
    const a = Math.random() * Math.PI * 2
    const v = 120 + Math.random() * 260
    spawnParticle(opt.ice ? shardTex : orbTex, e.x, e.y, {
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      scale: opt.ice ? 0.9 + Math.random() * 0.7 : 0.05,
      tint: opt.ice ? 0xd8f4ff : 0xffc890, add: !opt.ice,
      life: 0.5 + Math.random() * 0.3, drag: 0.92, spin: (Math.random() - 0.5) * 18,
    })
  }
  // 油罐机殉爆：留下一团油雾（若还带着油）
  if (e.type === 'tanker' && e.oilT > 0) {
    spawnCloud('oil', e.x, e.y, 90 + Math.random() * 40)
    if (e.burnT > 0) timers.push({ t: 0.08, fn: () => igniteCloudsAt(e.x, e.y) })
  }
  // 闭环产物①:燃烧中被击毁 → 火种残骸四散漂流,点燃碰到的一切
  if (e.burnT > 0) {
    countRx('燃烧残骸', null)
    const n = 2 + ((Math.random() * 2) | 0)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      spawnEmber(e.x, e.y, e.vx * 0.3 + Math.cos(a) * (60 + Math.random() * 90), e.vy * 0.3 + Math.sin(a) * (60 + Math.random() * 90))
    }
  }
  // 闭环产物②:装甲机坠毁概率漏机油(战场自动积累燃料)
  if (e.type === 'armored' && Math.random() < 0.5) {
    countRx('机油泄漏', e.x, e.y - 26, 0xc9a86a)
    spawnCloud('oil', e.x, e.y, 55 + Math.random() * 25)
  }
  removeEnemy(e)
  shake = Math.max(shake, opt.big ? 9 : 4)
}
/** 直击伤害（装甲机减伤 55%）；状态/反应伤害走 statusDamage 不减 */
function hitDamage(e, dmg, hx, hy) {
  const real = e.type === 'armored' ? dmg * 0.45 : dmg
  e.hp -= real
  e.flashT = 0.08
  if (hx != null) spawnParticle(orbTex, hx, hy, { scale: 0.07, life: 0.12, tint: 0xffffff, add: true })
  if (e.hp <= 0) killEnemy(e)
}
function statusDamage(e, dmg, tint = 0xffa050) {
  e.hp -= dmg
  e.flashT = 0.06
  if (e.hp <= 0) killEnemy(e, { tint })
}

// ── 元素状态 ────────────────────────────────────────
function applyOil(e, dur = 8) {
  if (e.burnT > 0) return igniteOil(e) // 已在燃烧的目标泼油 = 立即爆燃
  e.oilT = Math.max(e.oilT, dur)
  if (!e.oilSpr) {
    const s = new PIXI.Sprite(orbTex)
    s.anchor.set(0.5)
    s.width = s.height = 44
    s.tint = 0x201608
    s.alpha = 0.62
    e.view.addChildAt(s, 0)
    const sheen = new PIXI.Sprite(softTex)
    sheen.anchor.set(0.5)
    sheen.width = sheen.height = 30
    sheen.tint = 0x8a7a30
    sheen.alpha = 0.4
    sheen.blendMode = PIXI.BLEND_MODES.ADD
    e.view.addChild(sheen)
    e.oilSpr = [s, sheen]
  }
}
function clearOil(e) {
  e.oilT = 0
  if (e.oilSpr) {
    for (const s of e.oilSpr) { e.view.removeChild(s); s.destroy() }
    e.oilSpr = null
  }
}
function applyBurn(e, dur = 3) {
  if (e.frozenT > 0) return thermalShock(e) // 火遇冰 → 急冷
  if (e.oilT > 0) return igniteOil(e)       // 火遇油 → 爆燃
  e.burnT = Math.max(e.burnT, dur)
}
function applyFreeze(e, dur = 1.2) {
  if (e.burnT > 0) return thermalShock(e) // 冰遇火 → 急冷
  if (e.oilT > 0 && !e.brittle) {
    // 油+冰 = 凝油脆壳:油凝固,冻得更久,且任何直击都能触发碎冰处决
    clearOil(e)
    e.brittle = true
    countRx('凝油脆壳', e.x, e.y - 26, 0xffd9a8)
    dur = Math.max(dur * 1.8, 1.6)
  }
  e.frozenT = Math.min(2.8, Math.max(e.frozenT, dur))
  if (!e.iceSpr) {
    const s = new PIXI.Sprite(orbTex)
    s.anchor.set(0.5)
    s.width = s.height = 52
    s.tint = 0xbfe8ff
    s.alpha = 0.5
    const rim = new PIXI.Sprite(ringTex)
    rim.anchor.set(0.5)
    rim.width = rim.height = 54
    rim.tint = 0xe8f8ff
    rim.alpha = 0.55
    e.view.addChild(s, rim)
    e.iceSpr = [s, rim]
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2
      spawnParticle(shardTex, e.x, e.y, {
        vx: Math.cos(a) * 120, vy: Math.sin(a) * 120,
        scale: 0.6, life: 0.3, tint: 0xd8f4ff, drag: 0.9, spin: 8,
      })
    }
  }
  // 凝油脆壳:冰壳染琥珀色以示区分
  if (e.brittle && e.iceSpr) e.iceSpr[0].tint = 0xe8cf9a
}
function thawEnemy(e) {
  e.frozenT = 0
  e.brittle = false
  if (e.iceSpr) {
    for (const s of e.iceSpr) { e.view.removeChild(s); s.destroy() }
    e.iceSpr = null
  }
}
function applyShock(e, dur = 0.5) {
  if (e.oilT > 0) { igniteOil(e, '闪燃'); return } // 油+电 = 闪燃
  if (e.burnT > 0) return plasmaBurst(e)           // 火+电 = 等离子引爆
  e.shockT = Math.max(e.shockT, dur)
}
/** 等离子引爆：电击燃烧目标，把剩余燃烧时间一次性结算成爆伤（烧得越旺炸得越狠） */
function plasmaBurst(e) {
  const bonus = 4 + e.burnT * 2
  e.burnT = 0
  countRx('等离子引爆', e.x, e.y - 26, 0xd0a0ff)
  boomFx(e.x, e.y, 0.9, 0xb080ff)
  for (let i = 0; i < 4; i++) {
    const a = Math.random() * Math.PI * 2
    spawnArc(e.x, e.y, e.x + Math.cos(a) * 70, e.y + Math.sin(a) * 70, 0xd0a0ff, 3, 0.18)
  }
  // 小范围电浆飞溅:波及的燃烧者会连锁引爆(各自消耗自己的燃烧,天然终止)
  for (const o of enemies) {
    if (o !== e && dist2(o.x, o.y, e.x, e.y) < 90 * 90) {
      statusDamage(o, 2, 0xb080ff)
      if (enemies.includes(o)) applyShock(o, 0.3)
    }
  }
  applyKnock(e.x, e.y, 110, 200)
  if (ship.deadT <= 0 && dist2(ship.x, ship.y, e.x, e.y) < 90 * 90) damagePlayer(3)
  statusDamage(e, bonus, 0xb080ff)
  shake = Math.max(shake, 5)
}

// ── 反应 ───────────────────────────────────────────
/** 爆炸冲击波:把敌群物理推飞(被推进别的云里 = 新连锁) */
function applyKnock(x, y, r, pow) {
  for (const e of enemies) {
    const d2 = dist2(e.x, e.y, x, y)
    if (d2 < r * r && d2 > 1) {
      const d = Math.sqrt(d2)
      const f = pow * (1 - d / r)
      e.kx += ((e.x - x) / d) * f
      e.ky += ((e.y - y) / d) * f
    }
  }
}
// 燃烧残骸:漂流的火种,点燃碰到的敌机/云层/玩家
const embers = []
function spawnEmber(x, y, vx, vy) {
  if (embers.length > 40) return
  const s = new PIXI.Sprite(orbTex)
  s.anchor.set(0.5)
  s.blendMode = PIXI.BLEND_MODES.ADD
  s.tint = 0xff8030
  s.scale.set(0.09)
  fxC.addChild(s)
  embers.push({ x, y, vx, vy, life: 1.6 + Math.random(), igT: 0.2, spr: s })
}
// 冰晶弹片:碎冰系反应崩出的弹片,冻结命中者(可能引发连环处决)
function spawnIceShards(x, y, n = 4) {
  countRx('冰晶弹片', null)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const sp = 300 + Math.random() * 200
    const s = new PIXI.Sprite(shardTex)
    s.anchor.set(0.5)
    s.scale.set(1.1)
    s.tint = 0xd8f4ff
    bulletC.addChild(s)
    bullets.push({ beh: 'shard', elem: 'ice', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, spr: s, life: 0.55, target: null })
  }
}
function boomFx(x, y, mul = 1, tint = 0xffa050) {
  spawnRing(x, y, { r0: 8, r1: 110 * mul, life: 0.32, tint })
  spawnParticle(orbTex, x, y, { scale: 0.5 * mul, life: 0.16, tint: 0xffffff, add: true, grow: 3 })
  for (let i = 0; i < 8 * mul; i++) {
    const a = Math.random() * Math.PI * 2
    const v = 90 + Math.random() * 220 * mul
    spawnParticle(orbTex, x, y, {
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      scale: 0.05 + Math.random() * 0.07, life: 0.35 + Math.random() * 0.25,
      tint, add: true, drag: 0.9,
    })
  }
}
/** 爆燃：消耗油层，AoE + 给周围敌机点火（连锁的起点）；label 区分火引燃/电闪燃 */
function igniteOil(e, label = '爆燃') {
  clearOil(e)
  countRx(label, e.x, e.y - 26, 0xffb055)
  boomFx(e.x, e.y, 1.1, 0xff9040)
  const ex = e.x
  const ey = e.y
  statusDamage(e, 6)
  if (e.hp > 0) e.burnT = Math.max(e.burnT, 2.6)
  igniteCloudsAt(ex, ey)
  const R2 = 130 * 130
  for (const o of enemies) {
    if (o === e) continue
    if (dist2(o.x, o.y, ex, ey) < R2) {
      statusDamage(o, 3)
      if (o.hp > 0) applyBurn(o, 2.2)
    }
  }
  applyKnock(ex, ey, 150, 260)
  spawnCloud('fire', ex, ey, 46) // 爆燃留一小片火场(闭环:反应产出环境)
  if (ship.deadT <= 0 && dist2(ship.x, ship.y, ex, ey) < R2) damagePlayer(4)
  shake = Math.max(shake, 6)
}
/** 急冷（温差碎裂）：火冰相遇，双状态清除 + 崩伤 */
function thermalShock(e) {
  thawEnemy(e)
  e.burnT = 0
  countRx('急冷碎裂', e.x, e.y - 26, 0xbfe8ff)
  spawnRing(e.x, e.y, { r0: 6, r1: 90, life: 0.3, tint: 0xd8f4ff })
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2
    spawnParticle(shardTex, e.x, e.y, {
      vx: Math.cos(a) * 200, vy: Math.sin(a) * 200,
      scale: 0.8, life: 0.4, tint: 0xe8f8ff, drag: 0.9, spin: 12,
    })
  }
  spawnIceShards(e.x, e.y, 3)
  statusDamage(e, 5, 0xbfe8ff)
}
/** 碎冰处决：冰冻中吃重击 → 小怪整机爆碎，装甲机重创 */
function iceShatter(e) {
  countRx('碎冰处决', e.x, e.y - 26, 0x9fe0ff)
  spawnIceShards(e.x, e.y, 4)
  if (e.type === 'armored') {
    thawEnemy(e)
    statusDamage(e, 12, 0x9fe0ff)
    spawnRing(e.x, e.y, { r0: 10, r1: 110, life: 0.3, tint: 0xd8f4ff })
  } else {
    killEnemy(e, { ice: true, big: true, tint: 0xbfe8ff })
  }
}
/** 电浆链电：命中冰冻目标 → 超导（跳数翻倍+冻结传染+伤害↑） */
function teslaChain(from, baseDmg, jumps = 2) {
  const superc = from.frozenT > 0
  let left = superc ? jumps * 2 + 1 : jumps
  if (superc) countRx('超导', from.x, from.y - 26, 0xd8f0ff)
  const hitSet = new Set([from])
  let cur = from
  while (left > 0) {
    let best = null, bd = 260 * 260
    for (const e of enemies) {
      if (hitSet.has(e)) continue
      const d = dist2(e.x, e.y, cur.x, cur.y)
      if (d < bd) { bd = d; best = e }
    }
    if (!best) break
    spawnArc(cur.x, cur.y, best.x, best.y, superc ? 0xe8f8ff : 0x99ccff, superc ? 5 : 3)
    statusDamage(best, superc ? baseDmg * 1.5 : baseDmg, 0xaaddff)
    if (enemies.includes(best)) {
      if (superc) applyFreeze(best, 0.7)
      else applyShock(best, 0.35)
    }
    hitSet.add(best)
    cur = best
    left--
  }
}

// ── 环境云层 ────────────────────────────────────────
const CLOUD_CONF = {
  gas: { tint: 0xff9040, alpha: 0.24, n: 3, life: Infinity, vy: 6 },
  ion: { tint: 0x6690ff, alpha: 0.22, n: 3, life: Infinity, vy: 6 },
  oil: { tint: 0x5a4618, alpha: 0.42, n: 2, life: Infinity, vy: 12 },
  fire: { tint: 0xff7020, alpha: 0.3, n: 3, life: 2.4, vy: 10 },
  frost: { tint: 0x9fd8ff, alpha: 0.3, n: 2, life: 3.4, vy: 10 },
  static: { tint: 0x9fc8ff, alpha: 0.26, n: 2, life: 4.2, vy: 10 },
}
function spawnCloud(kind, x, y, r) {
  const conf = CLOUD_CONF[kind]
  const view = new PIXI.Container()
  for (let i = 0; i < conf.n; i++) {
    const s = new PIXI.Sprite(kind === 'oil' ? orbTex : softTex)
    s.anchor.set(0.5)
    const rr = r * (0.9 + Math.random() * 0.5)
    s.width = s.height = rr * 2
    s.x = (Math.random() - 0.5) * r * 0.7
    s.y = (Math.random() - 0.5) * r * 0.7
    s.tint = conf.tint
    s.alpha = conf.alpha
    if (kind !== 'oil') s.blendMode = PIXI.BLEND_MODES.ADD
    view.addChild(s)
  }
  if (kind === 'gas' || kind === 'ion') {
    for (let i = 0; i < 5; i++) {
      const p = new PIXI.Sprite(orbTex)
      p.anchor.set(0.5)
      p.blendMode = PIXI.BLEND_MODES.ADD
      p.scale.set(0.03 + Math.random() * 0.04)
      p.x = (Math.random() - 0.5) * r * 1.3
      p.y = (Math.random() - 0.5) * r * 1.3
      p.tint = kind === 'gas' ? 0xffc890 : 0xaaccff
      view.addChild(p)
    }
  }
  view.x = x; view.y = y
  cloudC.addChild(view)
  const c = { kind, x, y, r, view, burnt: false, t: Math.random() * 10, zapT: 0, effT: 0, life: conf.life, vy: conf.vy }
  clouds.push(c)
  return c
}
function removeCloud(c) {
  const i = clouds.indexOf(c)
  if (i >= 0) clouds.splice(i, 1)
  cloudC.removeChild(c.view)
  c.view.destroy({ children: true })
}
/** 火种落点：点燃覆盖该点的燃气星云 / 油雾 */
function igniteCloudsAt(x, y) {
  for (const c of clouds) {
    if (c.burnt || (c.kind !== 'gas' && c.kind !== 'oil')) continue
    if (dist2(x, y, c.x, c.y) < c.r * c.r) {
      if (c.kind === 'gas') nebulaBoom(c)
      else oilCloudBurn(c)
    }
  }
}
/** 星云轰燃：整团分段殉爆 + 波及云内所有敌机，连锁点燃相邻云 */
function nebulaBoom(c) {
  c.burnt = true
  countRx('星云轰燃', c.x, c.y, 0xffb055)
  for (let i = 0; i < 6; i++) {
    timers.push({
      t: i * 0.09,
      fn: () => {
        const a = Math.random() * Math.PI * 2
        const rr = Math.random() * c.r * 0.8
        boomFx(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr, 1.3, 0xff9040)
      },
    })
  }
  timers.push({
    t: 0.16,
    fn: () => {
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i]
        if (!e) continue // 轰燃波及会连锁爆燃减员
        if (dist2(e.x, e.y, c.x, c.y) < c.r * c.r * 1.2) {
          statusDamage(e, 8)
          if (e.hp > 0) applyBurn(e, 2.5)
        }
      }
      applyKnock(c.x, c.y, c.r * 1.3, 380)
      // 玩家也在爆炸半径里就一起吃(自己点的星云自己躲)
      if (ship.deadT <= 0 && dist2(ship.x, ship.y, c.x, c.y) < c.r * c.r * 1.2) {
        damagePlayer(15)
        burnShip(1.2)
      }
    },
  })
  for (const o of clouds) {
    if (o === c || o.burnt) continue
    if ((o.kind === 'gas' || o.kind === 'oil') && dist2(o.x, o.y, c.x, c.y) < (o.r + c.r) ** 2) {
      timers.push({ t: 0.28, fn: () => { if (!o.burnt) (o.kind === 'gas' ? nebulaBoom(o) : oilCloudBurn(o)) } })
    }
  }
  for (const s of c.view.children) { s.tint = 0x3a3a3a; s.alpha *= 0.8 }
  timers.push({ t: 3.5, fn: () => removeCloud(c) })
  shake = Math.max(shake, 12)
}
/** 油雾殉爆：转为持续火场，期间点燃闯入者 */
function oilCloudBurn(c) {
  countRx('油雾殉爆', c.x, c.y, 0xff9040)
  const fc = spawnCloud('fire', c.x, c.y, c.r)
  fc.vy = c.vy
  removeCloud(c)
  boomFx(fc.x, fc.y, 1.1, 0xff8030)
  applyKnock(fc.x, fc.y, fc.r, 220)
  shake = Math.max(shake, 6)
}
/** 电离风暴：云内所有敌机被链式电弧洗一遍 */
function ionStorm(c, sx, sy) {
  if (c.zapT > 0) return
  c.zapT = 0.55
  let n = 0
  for (const e of enemies) {
    if (n >= 10) break
    if (dist2(e.x, e.y, c.x, c.y) < c.r * c.r * 1.2) {
      spawnArc(sx ?? c.x, sy ?? c.y, e.x, e.y, 0x99ccff, 3.5)
      statusDamage(e, 2, 0xaaddff)
      if (e.hp > 0 && enemies.includes(e)) applyShock(e, 0.4)
      n++
    }
  }
  if (n > 0) {
    countRx('电离风暴', c.x, c.y, 0x99ccff)
    for (const s of c.view.children) s.alpha = Math.min(0.5, s.alpha * 2.2)
    timers.push({ t: 0.12, fn: () => { for (const s of c.view.children) s.alpha *= 0.45 } })
  }
}

// ── 装配槽：弹道 × 元素 ──────────────────────────────
const ELEMS = {
  ice: { name: '冰', color: 0x9fe0ff, cloud: 'frost' },
  fire: { name: '火', color: 0xff8844, cloud: 'fire' },
  oil: { name: '油', color: 0xc9a86a, cloud: 'oil' },
  shock: { name: '电', color: 0xaaddff, cloud: 'static' },
}
const BEHS = {
  rapid: { name: '速射', cd: 0.16 },
  homing: { name: '追踪', cd: 0.85 },
  lob: { name: '抛雾', cd: 1.7 },
  beam: { name: '光束', cd: 0 },
}
const slots = [
  { id: 'A', on: true, beh: 'rapid', elem: 'ice', t: 0, beamTick: 0, chainT: 0 },
  { id: 'B', on: true, beh: 'homing', elem: 'fire', t: 0, beamTick: 0, chainT: 0 },
  { id: 'C', on: false, beh: 'lob', elem: 'oil', t: 0, beamTick: 0, chainT: 0 },
]

function nearestEnemy(x, y, maxR = 1e9) {
  let best = null, bd = maxR * maxR
  for (const e of enemies) {
    const d = dist2(e.x, e.y, x, y)
    if (d < bd) { bd = d; best = e }
  }
  return best
}
function makeBullet(beh, elem, x, y, vx, vy, scale) {
  const s = new PIXI.Sprite(orbTex)
  s.anchor.set(0.5)
  s.blendMode = PIXI.BLEND_MODES.ADD
  s.scale.set(scale)
  s.tint = ELEMS[elem].color
  bulletC.addChild(s)
  return { beh, elem, x, y, vx, vy, spr: s, life: 1.6, target: null }
}
function removeBullet(b, i) {
  bulletC.removeChild(b.spr)
  b.spr.destroy()
  bullets.splice(i, 1)
}
/** 元素上弹目标：统一入口（heavy=追踪弹重击，jumps=电元素链跳数） */
function applyElemHit(e, elem, opt = {}) {
  if (!enemies.includes(e)) return
  if (elem === 'ice') {
    applyFreeze(e, opt.heavy ? 1.6 : 1.0)
  } else if (elem === 'fire') {
    applyBurn(e, opt.heavy ? 2.8 : 1.8)
  } else if (elem === 'oil') {
    applyOil(e, 8)
    if (opt.heavy) {
      // 重型油弹：溅涂周围
      for (const o of enemies) {
        if (o !== e && dist2(o.x, o.y, e.x, e.y) < 90 * 90 && enemies.includes(o)) applyOil(o, 6)
      }
    }
  } else if (elem === 'shock') {
    teslaChain(e, opt.heavy ? 3 : 1.5, opt.jumps ?? 1)
    if (enemies.includes(e)) applyShock(e, 0.45)
  }
}
function fireSlots(dt) {
  for (const sl of slots) {
    if (!sl.on || sl.beh === 'beam') continue
    sl.t -= dt
    if (sl.t > 0) continue
    const tgt = nearestEnemy(ship.x, ship.y, 950)
    if (!tgt) continue
    sl.t = BEHS[sl.beh].cd
    const a = Math.atan2(tgt.y - ship.y, tgt.x - ship.x)
    if (sl.beh === 'rapid') {
      bullets.push(makeBullet('rapid', sl.elem, ship.x, ship.y, Math.cos(a) * 760, Math.sin(a) * 760, 0.07))
    } else if (sl.beh === 'homing') {
      const b = makeBullet('homing', sl.elem, ship.x, ship.y, Math.cos(a) * 300, Math.sin(a) * 300, 0.13)
      b.target = tgt
      bullets.push(b)
    } else if (sl.beh === 'lob') {
      const b = makeBullet('lob', sl.elem, ship.x, ship.y, Math.cos(a) * 420, Math.sin(a) * 420, 0.12)
      b.life = clamp(Math.sqrt(dist2(ship.x, ship.y, tgt.x, tgt.y)) / 420, 0.4, 1.6)
      bullets.push(b)
    }
  }
}

// 光束（每个装了光束的槽一条，颜色随元素）
const beamG = new PIXI.Graphics()
beamG.blendMode = PIXI.BLEND_MODES.ADD
fxC.addChild(beamG)
function updateBeams(dt) {
  beamG.clear()
  const tm = performance.now() / 1000
  for (const sl of slots) {
    if (!sl.on || sl.beh !== 'beam') continue
    const tgt = nearestEnemy(ship.x, ship.y, 780)
    if (!tgt) continue
    const col = ELEMS[sl.elem].color
    const w = 5 + Math.sin(tm * 22 + sl.id.charCodeAt(0)) * 1.6
    beamG.lineStyle(w + 6, col, 0.22)
    beamG.moveTo(ship.x, ship.y - 14)
    beamG.lineTo(tgt.x, tgt.y)
    beamG.lineStyle(w * 0.6, 0xffffff, 0.75)
    beamG.moveTo(ship.x, ship.y - 14)
    beamG.lineTo(tgt.x, tgt.y)
    spawnParticle(orbTex, tgt.x, tgt.y, { scale: 0.1, life: 0.1, tint: col, add: true, grow: 1.5 })
    sl.beamTick -= dt
    if (sl.beamTick <= 0) {
      sl.beamTick = 0.09
      hitDamage(tgt, 0.5, tgt.x, tgt.y)
      if (enemies.includes(tgt)) {
        if (tgt.frozenT > 0 && tgt.brittle) {
          iceShatter(tgt) // 光束持续照射也能敲碎脆壳
        } else if (sl.elem === 'fire') {
          // 持续热源：直接走火元素矩阵（冻→急冷 / 油→爆燃 / 否则概率点燃）
          if (tgt.frozenT > 0) thermalShock(tgt)
          else if (tgt.oilT > 0) igniteOil(tgt)
          else if (Math.random() < 0.3) applyBurn(tgt, 1.4)
          igniteCloudsAt(tgt.x, tgt.y)
        } else if (sl.elem === 'ice') {
          applyFreeze(tgt, 0.5) // 冷冻射线：持续照射 = 常驻冰冻
        } else if (sl.elem === 'oil') {
          applyOil(tgt, 5) // 喷油射线：持续涂层
        } else if (sl.elem === 'shock') {
          sl.chainT -= 0.09
          if (sl.chainT <= 0) {
            sl.chainT = 0.3
            teslaChain(tgt, 1, 2)
          }
          applyShock(tgt, 0.3)
        }
      }
    }
  }
}

// ── 面板接线：装配槽 UI ───────────────────────────────
const slotsEl = document.getElementById('slots')
function buildSlotUI(sl) {
  const box = document.createElement('div')
  box.className = 'slot ' + (sl.on ? 'on' : 'off')
  const head = document.createElement('div')
  head.className = 'head'
  const title = document.createElement('span')
  const pw = document.createElement('span')
  pw.className = 'pw'
  pw.textContent = sl.on ? '开' : '关'
  pw.dataset.slot = sl.id
  pw.onclick = () => {
    sl.on = !sl.on
    pw.textContent = sl.on ? '开' : '关'
    box.className = 'slot ' + (sl.on ? 'on' : 'off')
  }
  head.appendChild(title)
  head.appendChild(pw)
  box.appendChild(head)
  const behRow = document.createElement('div')
  behRow.className = 'minirow'
  const elemRow = document.createElement('div')
  elemRow.className = 'minirow'
  const sync = () => {
    title.textContent = `槽位${sl.id} · ${BEHS[sl.beh].name}+${ELEMS[sl.elem].name}`
    for (const b of behRow.children) b.classList.toggle('active', b.dataset.beh === sl.beh)
    for (const b of elemRow.children) {
      b.classList.toggle('active', b.dataset.elem === sl.elem)
      if (b.dataset.elem === sl.elem) b.style.color = '#' + ELEMS[sl.elem].color.toString(16).padStart(6, '0')
      else b.style.color = ''
    }
  }
  for (const key of Object.keys(BEHS)) {
    const b = document.createElement('button')
    b.textContent = BEHS[key].name
    b.dataset.beh = key
    b.dataset.slot = sl.id
    b.onclick = () => { sl.beh = key; sync() }
    behRow.appendChild(b)
  }
  for (const key of Object.keys(ELEMS)) {
    const b = document.createElement('button')
    b.textContent = ELEMS[key].name
    b.dataset.elem = key
    b.dataset.slot = sl.id
    b.onclick = () => { sl.elem = key; sync() }
    elemRow.appendChild(b)
  }
  box.appendChild(behRow)
  box.appendChild(elemRow)
  sync()
  slotsEl.appendChild(box)
}
for (const sl of slots) buildSlotUI(sl)

const envsEl = document.getElementById('envs')
const envBtns = [
  ['投放 · 燃气星云(橙)', () => spawnCloud('gas', SW() * (0.25 + Math.random() * 0.5), SH() * (0.15 + Math.random() * 0.3), 130 + Math.random() * 60)],
  ['投放 · 电离星云(蓝)', () => spawnCloud('ion', SW() * (0.25 + Math.random() * 0.5), SH() * (0.15 + Math.random() * 0.3), 130 + Math.random() * 60)],
  ['泼洒 · 油雾', () => spawnCloud('oil', SW() * (0.3 + Math.random() * 0.4), SH() * (0.2 + Math.random() * 0.3), 80 + Math.random() * 40)],
  ['清空环境', () => { while (clouds.length) removeCloud(clouds[0]) }],
]
for (const [label, fn] of envBtns) {
  const btn = document.createElement('button')
  btn.textContent = label
  btn.onclick = fn
  envsEl.appendChild(btn)
}
document.getElementById('clear').onclick = () => {
  while (enemies.length) removeEnemy(enemies[0])
  while (clouds.length) removeCloud(clouds[0])
}
const hordeEl = document.getElementById('horde')
const densityEl = document.getElementById('density')
const mixTankerEl = document.getElementById('mixTanker')
const mixArmorEl = document.getElementById('mixArmor')

// ── 敌潮 ───────────────────────────────────────────
let spawnT = 0.5
function updateSpawn(dt) {
  if (!hordeEl.checked || enemies.length > 42) return
  spawnT -= dt
  if (spawnT > 0) return
  const den = Number(densityEl.value)
  spawnT = 2.4 - den * 0.2
  const n = 1 + ((Math.random() * 2) | 0)
  for (let i = 0; i < n; i++) {
    let type = 'normal'
    const r = Math.random()
    if (mixTankerEl.checked && r < 0.18) type = 'tanker'
    else if (mixArmorEl.checked && r < 0.3) type = 'armored'
    spawnEnemy(type, SW() * (0.08 + Math.random() * 0.84), -30 - Math.random() * 60)
  }
}

// ── 主循环 ─────────────────────────────────────────
app.ticker.add(() => {
  const dt = Math.min(0.05, app.ticker.deltaMS / 1000)

  // 玩家机(坠机期间停摆,重生带 2 秒无敌闪烁)
  const alive = ship.deadT <= 0
  if (!alive) {
    ship.deadT -= dt
    if (ship.deadT <= 0) {
      ship.hp = ship.maxHp
      ship.iframe = 2
      ship.spr.visible = true
      ship.x = ship.tx = SW() / 2
      ship.y = ship.ty = SH() * 0.8
    }
    beamG.clear()
  } else {
    ship.x += (ship.tx - ship.x) * (1 - Math.pow(0.002, dt))
    ship.y += (ship.ty - ship.y) * (1 - Math.pow(0.002, dt))
    ship.spr.x = ship.x
    ship.spr.y = ship.y
    ship.iframe -= dt
    ship.spr.alpha = ship.iframe > 0 ? (Math.sin(performance.now() * 0.03) > 0 ? 0.35 : 0.9) : 1
    // 机体燃烧:持续掉血 + 机身窜火苗
    if (ship.burnT > 0) {
      ship.burnT -= dt
      ship.burnTick -= dt
      if (ship.burnTick <= 0) {
        ship.burnTick = 0.35
        hurtShip(1.5)
      }
      if (Math.random() < 0.5) {
        spawnParticle(orbTex, ship.x + (Math.random() - 0.5) * 20, ship.y + (Math.random() - 0.5) * 20, {
          scale: 0.08, life: 0.3, tint: 0xff8030, add: true, vy: -60, drag: 0.95,
        })
      }
    }
    ship.trailT -= dt
    if (ship.trailT <= 0) {
      ship.trailT = 0.05
      spawnParticle(orbTex, ship.x, ship.y + 18, {
        scale: 0.06, life: 0.35, tint: 0x66c8b8, add: true, vy: 60, drag: 0.96, grow: -0.5,
      })
    }
  }
  // 机体血条 + 右上角状态
  shipHpG.clear()
  if (alive) {
    const frac = Math.max(0, ship.hp / ship.maxHp)
    shipHpG.beginFill(0x1a2430, 0.85)
    shipHpG.drawRect(ship.x - 24, ship.y - 42, 48, 5)
    shipHpG.endFill()
    shipHpG.beginFill(frac > 0.4 ? 0x7ec86a : frac > 0.2 ? 0xe0b040 : 0xe05540)
    shipHpG.drawRect(ship.x - 24, ship.y - 42, 48 * frac, 5)
    shipHpG.endFill()
  }
  statsText.x = SW() - 10
  statsText.y = 8
  statsText.text = `机体 ${Math.max(0, Math.ceil(ship.hp))}/${ship.maxHp}${ship.crashes ? `  坠机×${ship.crashes}` : ''}`

  if (alive) {
    fireSlots(dt)
    updateBeams(dt)
  }
  updateSpawn(dt)

  // 燃烧残骸:漂流火种
  for (let i = embers.length - 1; i >= 0; i--) {
    const m = embers[i]
    m.life -= dt
    m.x += m.vx * dt
    m.y += m.vy * dt
    m.vx *= Math.pow(0.6, dt)
    m.vy = m.vy * Math.pow(0.6, dt) + 22 * dt
    m.spr.x = m.x
    m.spr.y = m.y
    m.spr.alpha = 0.5 + Math.random() * 0.5
    if (Math.random() < 0.3) {
      spawnParticle(orbTex, m.x, m.y, { scale: 0.05, life: 0.25, tint: 0xffb060, add: true, vy: -30, drag: 0.95 })
    }
    m.igT -= dt
    if (m.igT <= 0) {
      m.igT = 0.25
      igniteCloudsAt(m.x, m.y)
    }
    let spent = m.life <= 0
    if (!spent) {
      for (const e of enemies) {
        if (dist2(e.x, e.y, m.x, m.y) < 26 * 26) {
          applyBurn(e, 1.6)
          spent = true
          break
        }
      }
    }
    if (!spent && ship.deadT <= 0 && dist2(ship.x, ship.y, m.x, m.y) < 26 * 26) {
      damagePlayer(2)
      burnShip(0.9)
      spent = true
    }
    if (spent) {
      fxC.removeChild(m.spr)
      m.spr.destroy()
      embers.splice(i, 1)
    }
  }

  // 定时器
  for (let i = timers.length - 1; i >= 0; i--) {
    timers[i].t -= dt
    if (timers[i].t <= 0) { const f = timers[i].fn; timers.splice(i, 1); f() }
  }
  // 插值器
  for (let i = lerps.length - 1; i >= 0; i--) {
    const L = lerps[i]
    L.t += dt
    const k = Math.min(1, L.t / L.dur)
    L.fn(k)
    if (k >= 1) { lerps.splice(i, 1); L.done && L.done() }
  }

  // 子弹
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]
    b.life -= dt
    if (b.beh === 'homing' && b.target && enemies.includes(b.target)) {
      const a = Math.atan2(b.target.y - b.y, b.target.x - b.x)
      const cur = Math.atan2(b.vy, b.vx)
      let d = a - cur
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      const na = cur + clamp(d, -4.5 * dt, 4.5 * dt)
      const sp = Math.min(620, Math.hypot(b.vx, b.vy) + 500 * dt)
      b.vx = Math.cos(na) * sp
      b.vy = Math.sin(na) * sp
      spawnParticle(orbTex, b.x, b.y, { scale: 0.05, life: 0.25, tint: ELEMS[b.elem].color, add: true, drag: 0.9 })
    }
    b.x += b.vx * dt
    b.y += b.vy * dt
    b.spr.x = b.x
    b.spr.y = b.y
    let hit = false
    for (const e of enemies) {
      const R = e.type === 'armored' ? 30 : 24
      if (dist2(e.x, e.y, b.x, b.y) < R * R) {
        hit = true
        const heavy = b.beh === 'homing'
        // 重击撞上冰冻目标 = 碎冰处决;凝油脆壳状态下任何直击都能处决
        if (e.frozenT > 0 && (heavy || e.brittle)) {
          iceShatter(e)
        } else {
          if (heavy) {
            boomFx(b.x, b.y, 0.8, ELEMS[b.elem].color)
            hitDamage(e, 4, b.x, b.y)
            for (const o of enemies) {
              if (o !== e && dist2(o.x, o.y, b.x, b.y) < 70 * 70) hitDamage(o, 1.5)
            }
          } else {
            hitDamage(e, b.beh === 'lob' ? 1.5 : 1, b.x, b.y)
          }
          applyElemHit(e, b.elem, { heavy, jumps: heavy ? 3 : 1 })
          if (b.elem === 'fire') igniteCloudsAt(b.x, b.y)
        }
        // 抛雾弹命中也铺云
        if (b.beh === 'lob') spawnCloud(ELEMS[b.elem].cloud, b.x, b.y, 70 + Math.random() * 30)
        // 电弹命中点在电离星云内 → 引弧
        if (b.elem === 'shock') {
          for (const c of clouds) {
            if (c.kind === 'ion' && dist2(b.x, b.y, c.x, c.y) < c.r * c.r) ionStorm(c, b.x, b.y)
          }
        }
        break
      }
    }
    if (!hit && b.elem === 'shock') {
      for (const c of clouds) {
        if (c.kind === 'ion' && dist2(b.x, b.y, c.x, c.y) < c.r * c.r * 0.5) { ionStorm(c, b.x, b.y); break }
      }
    }
    if (hit || b.life <= 0) {
      if (!hit) {
        // 寿命尽:抛雾弹落点铺元素云（预铺陷阱）；火追踪弹空爆点火
        if (b.beh === 'lob') spawnCloud(ELEMS[b.elem].cloud, b.x, b.y, 70 + Math.random() * 30)
        else if (b.beh === 'homing') {
          boomFx(b.x, b.y, 0.7, ELEMS[b.elem].color)
          if (b.elem === 'fire') igniteCloudsAt(b.x, b.y)
        }
      }
      removeBullet(b, i)
    }
  }

  // 敌人
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i]
    if (!e) continue // 火焰传染/爆燃可能在循环中连锁减员
    if (e.frozenT > 0) {
      e.frozenT -= dt
      if (e.frozenT <= 0) thawEnemy(e)
    } else if (e.shockT > 0) {
      e.shockT -= dt
      e.view.x = e.x + (Math.random() - 0.5) * 5
      e.view.y = e.y + (Math.random() - 0.5) * 5
      if (Math.random() < 0.3) {
        spawnParticle(orbTex, e.x + (Math.random() - 0.5) * 26, e.y + (Math.random() - 0.5) * 26, {
          scale: 0.05, life: 0.1, tint: 0xd8f0ff, add: true,
        })
      }
    } else {
      e.wob += dt
      e.x += (e.vx + e.kx + Math.sin(e.wob * 1.7) * e.wobA) * dt
      e.y += (e.vy + e.ky) * dt
      e.view.x = e.x
      e.view.y = e.y
    }
    // 冲击波击退衰减
    e.kx *= Math.pow(0.03, dt)
    e.ky *= Math.pow(0.03, dt)
    // 燃烧 DoT + 火焰传染 + 引燃云层
    if (e.burnT > 0) {
      e.burnT -= dt
      e.burnTick -= dt
      if (e.burnTick <= 0) {
        e.burnTick = 0.4
        statusDamage(e, 0.9)
        if (!enemies.includes(e)) continue
      }
      if (Math.random() < 0.45) {
        spawnParticle(orbTex, e.x + (Math.random() - 0.5) * 18, e.y + (Math.random() - 0.5) * 18, {
          scale: 0.07 + Math.random() * 0.05, life: 0.3, tint: 0xff8030, add: true, vy: -50, drag: 0.95,
        })
      }
      e.spreadT -= dt
      if (e.spreadT <= 0) {
        e.spreadT = 0.25
        for (const o of enemies) {
          if (o !== e && o.oilT > 0 && dist2(o.x, o.y, e.x, e.y) < 120 * 120) {
            countRx('火焰传染', o.x, o.y - 26, 0xffaa60)
            igniteOil(o)
          }
        }
        igniteCloudsAt(e.x, e.y)
      }
    }
    if (e.oilT > 0 && e.oilT < 900) e.oilT -= dt
    if (e.oilT <= 0 && e.oilSpr) clearOil(e)
    if (e.flashT > 0) {
      e.flashT -= dt
      e.body.tint = 0xffffff
    } else {
      e.body.tint = e.burnT > 0 ? 0xffb080 : e.frozenT > 0 ? 0xbfe8ff : 0xffffff
    }
    if (e.y > SH() + 60 || e.x < -80 || e.x > SW() + 80) removeEnemy(e)
  }

  // 云层
  for (let i = clouds.length - 1; i >= 0; i--) {
    const c = clouds[i]
    if (!c) continue // 轰燃连锁可能移除其它云
    c.t += dt
    c.zapT = Math.max(0, c.zapT - dt)
    c.effT -= dt
    c.y += c.vy * dt
    c.view.y = c.y
    if (c.kind === 'gas' || c.kind === 'ion') {
      c.view.alpha = 0.85 + 0.15 * Math.sin(c.t * 1.4)
    }
    if (c.kind === 'fire') {
      if (Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2
        const rr = Math.random() * c.r
        spawnParticle(orbTex, c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr, {
          scale: 0.1 + Math.random() * 0.1, life: 0.35, tint: 0xff7020, add: true, vy: -70, drag: 0.94,
        })
      }
      for (let k = enemies.length - 1; k >= 0; k--) {
        const e = enemies[k]
        if (!e) continue // 连锁反应可能在本轮循环中炸掉多个敌机,索引会越过缩短后的数组
        if (dist2(e.x, e.y, c.x, c.y) < c.r * c.r) applyBurn(e, 1.6)
      }
      // 玩家闯进火场同样会烧(与敌机同一套规则)
      if (ship.deadT <= 0 && dist2(ship.x, ship.y, c.x, c.y) < c.r * c.r) burnShip(1.2)
    } else if (c.kind === 'frost') {
      // 冷冻雾：闯入即冻（对燃烧者触发急冷）
      if (Math.random() < 0.4) {
        const a = Math.random() * Math.PI * 2
        const rr = Math.random() * c.r
        spawnParticle(shardTex, c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr, {
          scale: 0.5, life: 0.5, tint: 0xd8f4ff, vy: 20, drag: 0.97, spin: 4, alpha: 0.7,
        })
      }
      if (c.effT <= 0) {
        c.effT = 0.2
        for (let k = enemies.length - 1; k >= 0; k--) {
          const e = enemies[k]
          if (!e) continue // 急冷可能连锁减员,防索引越界
          if (dist2(e.x, e.y, c.x, c.y) < c.r * c.r) applyFreeze(e, 0.8)
        }
      }
    } else if (c.kind === 'oil') {
      // 油雾：穿过的敌机沾一身油（Noita 式:环境给单位上状态）
      if (c.effT <= 0) {
        c.effT = 0.3
        for (let k = enemies.length - 1; k >= 0; k--) {
          const e = enemies[k]
          if (!e) continue
          if (dist2(e.x, e.y, c.x, c.y) < c.r * c.r && enemies.includes(e)) applyOil(e, 6)
        }
      }
    } else if (c.kind === 'static') {
      // 静电云：周期性电击云内所有敌机
      if (c.effT <= 0) {
        c.effT = 0.55
        let n = 0
        for (let k = enemies.length - 1; k >= 0 && n < 8; k--) {
          const e = enemies[k]
          if (!e) continue // 电击引燃油层可能连锁减员
          if (dist2(e.x, e.y, c.x, c.y) < c.r * c.r) {
            spawnArc(c.x, c.y, e.x, e.y, 0x99ccff, 2.5)
            statusDamage(e, 1, 0xaaddff)
            if (enemies.includes(e)) applyShock(e, 0.35)
            n++
          }
        }
      }
    }
    if (c.life !== Infinity) {
      c.life -= dt
      if (c.life <= 0) { removeCloud(c); continue }
      c.view.alpha = Math.min(1, c.life)
    }
    // 感电敌机闯进电离星云 → 引弧
    if (c.kind === 'ion' && c.zapT <= 0) {
      for (const e of enemies) {
        if (e.shockT > 0 && dist2(e.x, e.y, c.x, c.y) < c.r * c.r) { ionStorm(c, e.x, e.y); break }
      }
    }
  }

  // 粒子
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    p.age += dt
    if (p.age >= p.life) {
      fxC.removeChild(p.spr)
      p.spr.destroy()
      particles.splice(i, 1)
      continue
    }
    p.vx *= Math.pow(p.drag, dt * 60)
    p.vy *= Math.pow(p.drag, dt * 60)
    p.spr.x += p.vx * dt
    p.spr.y += p.vy * dt
    p.spr.rotation += p.spin * dt
    if (p.grow) p.spr.scale.set(Math.max(0.001, p.spr.scale.x * (1 + p.grow * dt * 3)))
    p.spr.alpha = p.a0 * (1 - p.age / p.life)
  }

  // 电弧
  arcG.clear()
  for (let i = arcs.length - 1; i >= 0; i--) {
    const a = arcs[i]
    a.t += dt
    if (a.t >= a.life) { arcs.splice(i, 1); continue }
    const al = 1 - a.t / a.life
    arcG.lineStyle(a.w + 3, a.color, al * 0.3)
    arcG.moveTo(a.pts[0].x, a.pts[0].y)
    for (let k = 1; k < a.pts.length; k++) arcG.lineTo(a.pts[k].x, a.pts[k].y)
    arcG.lineStyle(a.w, 0xffffff, al * 0.8)
    arcG.moveTo(a.pts[0].x, a.pts[0].y)
    for (let k = 1; k < a.pts.length; k++) arcG.lineTo(a.pts[k].x, a.pts[k].y)
  }

  // 漂浮文字
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i]
    f.t += dt
    if (f.t >= f.life) {
      uiC.removeChild(f.spr)
      f.spr.destroy()
      floaters.splice(i, 1)
      continue
    }
    f.spr.y += f.vy * dt
    f.spr.alpha = 1 - Math.pow(f.t / f.life, 2)
  }

  // 震屏
  shake *= Math.pow(0.004, dt)
  world.x = (Math.random() - 0.5) * shake
  world.y = (Math.random() - 0.5) * shake
})

// 开场：预投放一组环境 + 少量敌机
spawnCloud('gas', 300, 260, 150)
spawnCloud('ion', 700, 380, 140)
for (let i = 0; i < 5; i++) spawnEnemy('normal', 150 + i * 120, 80 + Math.random() * 120)
spawnEnemy('tanker', 480, 60)

// 调试钩子
window.__elem = { enemies, clouds, spawnEnemy, spawnCloud, slots, BEHS, ELEMS, rxCount, ship, embers }
