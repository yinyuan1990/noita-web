// 探针:分裂弹(SPITTER)—— 贴图 7 帧缩小播一遍不循环、velocity_sets_scale 只拉长不压扁、bounce_always 10 次 ×0.5、寿命 25±7 帧、死亡 r2 不挖洞、粉色枪口 + 暗粉光
// 用法:node scripts/_noita-spitter-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, deviceScaleFactor: 3, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.player.onGround, null, { timeout: 90000 })
await page.waitForTimeout(1500)
const r = await page.evaluate(async () => {
  const np = window.__np, pl = np.player, ps = np.projectiles, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const d = ps.defs.spitter
  const res = { def: { speed: d.speed, lifetime: d.lifetime, bounces: d.bounces, bounceEnergy: d.bounceEnergy, bounceAlways: d.bounceAlways, frames: d.sprite.frames, wait: d.sprite.wait, loop: d.sprite.loop, additive: d.additive, light: d.light, muzzle: d.muzzle?.variants?.length, hole: d.explosion.hole, r: d.explosion.radius } }
  // 朝右上 30° 打一发,记轨迹
  const p = ps.spawn('spitter', pl.x + 6, pl.y - 4, -Math.PI / 6, { owner: 'player' })
  const track = []
  for (let i = 0; i < 40 && !p.dead; i++) { track.push({ t: +(i * 50 / 1000).toFixed(2), x: (p.x - pl.x) | 0, y: (p.y - pl.y) | 0, sp: Math.hypot(p.vx, p.vy) | 0, frame: p.frame, bounces: p.bounces }); await wait(50) }
  res.track = track.filter((_, i) => i % 2 === 0)
  res.died = { dead: p.dead, ageMs: track.length * 50 }
  // 朝正下方地面打:该弹几次、每次减半、地面不挖洞
  const gy = pl.y + 3
  let holes = 0
  const p2 = ps.spawn('spitter', pl.x, pl.y - 4, Math.PI / 2, { owner: 'player' })
  let maxB = p2.bounces, minB = p2.bounces
  for (let i = 0; i < 30 && !p2.dead; i++) { minB = Math.min(minB, p2.bounces); await wait(16) }
  for (let x = pl.x - 4; x <= pl.x + 4; x++) for (let y = gy; y < gy + 4; y++) if (np.sim.get(x, y) === 0) holes++
  res.down = { bouncesLeft0: maxB, bouncesLeftMin: minB, used: maxB - minB, holeCellsUnderFeet: holes }
  return res
})
console.log(JSON.stringify(r, null, 1))
// 连发一串截图看贴图(高倍)
await page.evaluate(async () => { const np = window.__np, pl = np.player, ps = np.projectiles; for (let i = 0; i < 6; i++) { ps.spawn('spitter', pl.x + 6, pl.y - 4, -0.3 + i * 0.05, { owner: 'player' }); await new Promise((r) => setTimeout(r, 60)) } await new Promise((r) => setTimeout(r, 90)) })
await page.screenshot({ path: `${out}/spitter.png`, clip: { x: 380, y: 140, width: 300, height: 140 } })
await browser.close()
