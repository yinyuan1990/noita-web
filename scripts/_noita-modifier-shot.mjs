// 探针:修饰卡(gun.lua 的 c 回放)—— 追踪 / 后座力 / 瞬移弹 / 瞬移施法 / 加速 / 反弹 / 重力 / 高爆 / 穿透
// 用法:node scripts/_noita-modifier-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForFunction(() => { const np = window.__np; for (let cx = 34; cx <= 36; cx++) for (let cy = 13; cy <= 14; cy++) if (!np.streamer.get(cx, cy)) return false; return true }, null, { timeout: 120000 })
await page.waitForFunction(() => window.__np.player.onGround, null, { timeout: 30000 })
await page.waitForTimeout(500)
const r = await page.evaluate(async () => {
  const np = window.__np, pl = np.player, W = np.wands, P = np.projectiles
  W.infinite = true
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const mk = (cards) => ({ name: 't', cards: cards.slice(), deck: cards.slice(), uses: {}, mana: 1000, manaMax: 1000, cd: 0, reloadT: 0, fireRateWait: 5, spread: 0, speedMul: 1, reloadTime: 10, actionsPerRound: 1, shuffle: false, deckCapacity: 10 })
  const castAt = (cards, ang, x = pl.x, y = pl.y - 4) => { const out = []; const r = W.cast(mk(cards), ang, (name, off, c, payload) => { const p = P.spawn(name, x, y, ang + off, { c, payload }); out.push(p); return p }); return { r, ps: out } }
  const res = {}
  // 清一块空地
  const ox = Math.round(pl.x), oy = Math.round(pl.y) - 120
  for (let y = oy - 60; y < oy + 60; y++) for (let x = ox - 200; x < ox + 200; x++) np.sim.set(x, y, 0)
  // 1. 追踪:僵尸在右上 80px,弹朝正右打;1s 内应转向僵尸(离僵尸距离变小)且 c 里 extra_entities 带 homing
  const z = np.entities.spawnCreature('zombie', ox + 80, oy - 40); z.vx = 0; z.vy = 0; z.stunT = 99
  let { r: r1, ps: p1 } = castAt(['HOMING', 'LIGHT_BULLET'], 0, ox, oy)
  const d0 = Math.hypot(p1[0].x - z.x, p1[0].y - z.y)
  const track = []
  for (let i = 0; i < 12; i++) { await wait(50); if (!p1[0].dead) track.push([p1[0].x - ox | 0, p1[0].y - oy | 0]) }
  res.homing = { c_extra: p1[0].c.extra_entities, homing: p1[0].homing, d0: d0 | 0, dEnd: p1[0].dead ? 'dead' : Math.hypot(p1[0].x - z.x, p1[0].y - z.y) | 0, track }
  // 2. 后座力:朝下打,recoil 200 → 玩家 vy ≈ −200(加上原来的)
  pl.vy = 0; pl.x = ox; pl.y = oy
  const { r: r2 } = castAt(['RECOIL', 'LIGHT_BULLET'], Math.PI / 2, ox, oy)
  res.recoil = { recoil: r2.recoil, vy: pl.vy | 0 }
  await wait(120); pl.vx = 0; pl.vy = 0
  // 3. 加速 / 反弹 / 重力 / 穿透 / 高爆:看弹上的 c 与派生字段
  const one = (cards) => { const { ps } = castAt(cards, 0, ox, oy + 20); const p = ps[0]; const o = { speed: Math.hypot(p.vx, p.vy) | 0, bounces: p.bounces, gAdd: p.gAdd, exR: p.exR, exD: p.exD, pierce: !!p.beh?.pierce, life: +p.life.toFixed(2), dmgAdd: p.dmgAdd, kbAdd: p.kbAdd }; p.dead = true; P.list.splice(P.list.indexOf(p), 1); return o }
  res.plain = one(['LIGHT_BULLET'])
  res.speed = one(['SPEED', 'LIGHT_BULLET'])
  res.bounce = one(['BOUNCE', 'LIGHT_BULLET'])
  res.gravity = one(['GRAVITY', 'LIGHT_BULLET'])
  res.pierce = one(['PIERCING_SHOT', 'LIGHT_BULLET'])
  res.highExp = one(['HIGH_EXPLOSIVE', 'LIGHT_BULLET'])
  res.lifetime = one(['LIFETIME', 'LIGHT_BULLET'])
  res.dmgKb = one(['DAMAGE', 'KNOCKBACK', 'LIGHT_BULLET'])
  res.after = one(['LIGHT_BULLET', 'SPEED']) // 同一 shot 里修饰卡在弹后面也生效(c 共享)——但单张 actions_per_round=1 抽不到第二张,所以这里应该和 plain 一样
  // 4. 瞬移弹:朝右打,撞墙 / 到寿命后玩家应到弹死的位置
  for (let y = oy - 20; y < oy + 40; y++) for (let x = ox + 150; x < ox + 160; x++) np.sim.set(x, y, np.mats.byName.get('rock_static'), 0)
  pl.x = ox; pl.y = oy + 20; pl.vx = 0; pl.vy = 0
  const { ps: p4 } = castAt(['TELEPORT_PROJECTILE'], 0, ox, oy + 20)
  await wait(700)
  res.teleport = { def: !!P.defs.teleport_projectile.teleport, projDead: p4[0].dead, projX: p4[0].x - ox | 0, playerDx: pl.x - ox | 0, playerDy: pl.y - (oy + 20) | 0 }
  // 5. 瞬移施法:TELEPORT_CAST + LIGHT_BULLET,僵尸在 60px 内 → teleport_cast 出生就跳到僵尸身上,2 帧后载荷(火花弹)从那儿放出
  pl.x = ox - 100; pl.y = oy + 20
  const z2 = np.entities.spawnCreature('zombie', ox - 40, oy + 10); z2.stunT = 99
  const { ps: p5 } = castAt(['TELEPORT_CAST', 'LIGHT_BULLET'], 0, ox - 100, oy + 20)
  const spawnAt = { x: p5[0].x - z2.x | 0, y: p5[0].y - z2.y | 0, payload: p5[0].payload?.map((s) => s.name) }
  await wait(200)
  const bolts = P.list.filter((q) => q.name === 'light_bullet' && !q.dead)
  res.teleportCast = { castTo: P.defs.teleport_cast.castTo, spawnAt, boltsAlive: bolts.length }
  // 6. 法术库里现在有多少修饰卡可用
  res.usableMods = W.usableSpells().filter((s) => s.type === 'MODIFIER').map((s) => s.id).length
  return res
})
console.log(JSON.stringify(r, null, 1))
await browser.close()
