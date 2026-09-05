// 探针:光明穿凿(LUMINOUS_DRILL)穿地 —— 反 exe ProjectileSystem 0xd32970:E = coeff×mass×½v²,吃掉格 hp 就挖掉继续走
// 预期:朝右打 60px 厚岩墙,2 帧寿命内挖出一条 ~40px 的 1px 隧道;神殿砖(hp 1e6)每格掉 15% 速度,只能挖几格;长枪(coeff 6, 400px/s)扎进岩石 1~2 格就停
// 用法:node scripts/_noita-drill-shot.mjs [url]
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
  const castAt = (cards, ang, x, y) => { const out = []; W.cast(mk(cards), ang, (name, off, c, payload) => { const p = P.spawn(name, x, y, ang + off, { c, payload }); out.push(p); return p }); return out }
  const ox = Math.round(pl.x), oy = Math.round(pl.y) - 120
  for (let y = oy - 60; y < oy + 60; y++) for (let x = ox - 200; x < ox + 200; x++) np.sim.set(x, y, 0)
  pl.x = ox - 150; pl.y = oy; pl.vx = 0; pl.vy = 0; pl.noclip = true
  const res = { def: (({ groundPenetration, groundPenMaxDur, mass, speed, lifetime }) => ({ groundPenetration, groundPenMaxDur, mass, speed, lifetime }))(P.defs.luminous_drill) }
  const wall = (mat, x0, x1, y0, y1) => { const id = np.mats.byName.get(mat); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) np.sim.set(x, y, id, 0) }
  const tunnel = (x0, x1, y) => { let n = 0, maxX = x0 - 1; for (let x = x0; x < x1; x++) for (let dy = -2; dy <= 2; dy++) if (np.sim.get(x, y + dy) === 0) { n++; maxX = Math.max(maxX, x) } return { holes: n, depth: maxX - x0 + 1 } }
  // 1. 岩墙 60px 厚
  wall('rock_static', ox, ox + 60, oy - 20, oy + 20)
  const p1 = castAt(['LUMINOUS_DRILL'], 0, ox - 10, oy)
  const v0 = Math.hypot(p1[0].vx, p1[0].vy) | 0
  await wait(300)
  res.rock = { v0, dead: p1[0].dead, endX: p1[0].x - ox | 0, vEnd: Math.hypot(p1[0].vx, p1[0].vy) | 0, ...tunnel(ox, ox + 60, oy) }
  // 2. 神殿砖
  wall('templebrick_static', ox, ox + 60, oy - 20, oy + 20)
  const p2 = castAt(['LUMINOUS_DRILL'], 0, ox - 10, oy)
  await wait(300)
  res.temple = { dead: p2[0].dead, endX: p2[0].x - ox | 0, ...tunnel(ox, ox + 60, oy) }
  // 3. 长枪扎岩石
  wall('rock_static', ox, ox + 60, oy - 20, oy + 20)
  const p3 = castAt(['LANCE'], 0, ox - 10, oy)
  await wait(400)
  res.lance = { dead: p3[0].dead, endX: p3[0].x - ox | 0, ...tunnel(ox, ox + 60, oy) }
  // 4. 连发 12 发穿岩(fire_rate_wait −35 → 实际连发),隧道应达 60px 打穿
  wall('rock_static', ox, ox + 60, oy - 20, oy + 20)
  for (let i = 0; i < 12; i++) { castAt(['LUMINOUS_DRILL'], 0, ox - 10, oy); await wait(60) }
  await wait(200)
  res.burst = tunnel(ox, ox + 60, oy)
  res.errors = window.__lastError || null
  return res
})
console.log(JSON.stringify(r, null, 1))
await browser.close()
