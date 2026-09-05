// 探针:弹丸入水(VelocityComponent.displace_liquid)+ 液体折射 shader —— 挖一池水,火花弹朝水里打:
//   水粒子速度应 ≈ −0.1×弹速 转 ±0.3rad(几十 px/s,往回顶),每帧 ≈ 3×3×75% ≈ 7 粒;弹在水里按 liquid_drag×液体格数减速;refr(WebGL 折射)存在
// 用法:node scripts/_noita-water-entry-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: [...(process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : []), '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, deviceScaleFactor: 2, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.player.onGround, null, { timeout: 180000 })
// 出生点周围一圈 chunk 就位(模拟窗口才 bind,世界才走)
await page.waitForFunction(() => { const np = window.__np; for (let cx = 34; cx <= 36; cx++) for (let cy = 13; cy <= 14; cy++) if (!np.streamer.get(cx, cy)?.ready) return false; return true }, null, { timeout: 180000 })
await page.waitForTimeout(800)
const r = await page.evaluate(async () => {
  const np = window.__np, pl = np.player, sim = np.sim, ps = np.projectiles, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const rock = np.mats.byName.get('rock_static'), water = np.mats.byName.get('water')
  const t0 = np.entities.time; await wait(300); const stepping = np.entities.time - t0 > 0.1
  // 人右边地面下挖个池子,人站着朝右下打
  const px = Math.floor(pl.x) + 60, py = Math.floor(pl.y)
  for (let j = py - 20; j <= py + 30; j++) for (let i = px - 30; i <= px + 30; i++) sim.set(i, j, rock, 0)
  for (let j = py - 16; j <= py + 26; j++) for (let i = px - 26; i <= px + 26; i++) sim.set(i, j, water, 0)
  for (let j = py - 90; j < py - 16; j++) for (let i = px - 30; i <= px + 30; i++) sim.set(i, j, 0, 0)
  // 人站到池子正上方 60px 的小石台上,朝下打
  for (let j = py - 74; j <= py - 70; j++) for (let i = px - 30; i <= px - 18; i++) sim.set(i, j, rock, 0)
  pl.x = px - 24; pl.y = py - 77; pl.vx = 0; pl.vy = 0
  await wait(400); np.debris.length = 0
  const ang = Math.atan2((py - 8) - (pl.y - 4), px - pl.x)
  const q = ps.spawn('light_bullet', pl.x + 6, pl.y - 4, ang, { owner: 'player' })
  const v0 = [q.vx, q.vy]
  let best = 0, smp = [], speeds = []
  for (let i = 0; i < 14; i++) {
    await wait(16)
    const d = np.debris.filter((x) => np.mats.name(x.m) === 'water')
    if (d.length > best) { best = d.length; smp = d.slice(0, 4).map((x) => [+x.vx.toFixed(0), +x.vy.toFixed(0)]) }
    speeds.push(+Math.hypot(q.vx, q.vy).toFixed(0))
  }
  return { stepping, refr: !!np.refr, bulletV0: v0.map((v) => +v.toFixed(0)), expectBack: v0.map((v) => +(-v * 0.1).toFixed(0)), waterDebrisMax: best, sample: smp, bulletSpeeds: speeds }
})
console.log(JSON.stringify(r))
await browser.close()
