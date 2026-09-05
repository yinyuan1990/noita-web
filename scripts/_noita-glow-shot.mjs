// 探针:发光材质(gfx_glow)的画法 —— 在矿里黑处挖一池毒液(radioactive_liquid,Graphics color 44B4FF10 + gfx_glow 60),放大截图 + 池中像素均色
// 用法:node scripts/_noita-glow-shot.mjs [url]
import { chromium } from 'playwright'
import fs from 'fs'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, deviceScaleFactor: 2, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.player.onGround, null, { timeout: 90000 })
await page.evaluate(() => { const np = window.__np; np.player.x = 300; np.player.y = 600; np.player.vx = 0; np.player.vy = 0; np.cam.x = 300; np.cam.y = 600; np.flags.god = true })
await page.waitForTimeout(3000)
const r = await page.evaluate(async () => {
  const np = window.__np, sim = np.sim, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const rock = np.mats.byName.get('rock_static'), rl = np.mats.byName.get('radioactive_liquid'), water = np.mats.byName.get('water')
  const px = 300, py = 600
  for (let j = py - 60; j <= py + 40; j++) for (let i = px - 120; i <= px + 120; i++) sim.set(i, j, rock, 0)
  for (let j = py - 40; j <= py; j++) for (let i = px - 100; i <= px - 10; i++) sim.set(i, j, rl, 0)
  for (let j = py - 40; j <= py; j++) for (let i = px + 10; i <= px + 100; i++) sim.set(i, j, water, 0)
  // 相机跟人:人放在池子上方 100px 的石头里(god),两池离人的灯一样远,水 vs 毒液的差别就是 glow
  np.player.x = px; np.player.y = py - 100; np.player.vx = 0; np.player.vy = 0
  for (let j = py - 108; j <= py - 92; j++) for (let i = px - 6; i <= px + 6; i++) sim.set(i, j, 0, 0)
  await wait(1200)
  const view = document.querySelector('canvas'), S = view.width / 427
  const sample = (wx, wy) => { const c = view.getContext('2d'); const x = Math.round((wx - np.cam.x + 427 / 2) * S), y = Math.round((wy - np.cam.y + 240 / 2) * S); const d = c.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]] }
  const avg = (x0, x1) => { let r = 0, g = 0, b = 0, n = 0; for (let i = x0; i <= x1; i += 6) for (let j = py - 36; j <= py - 4; j += 6) { const c = sample(i, j); r += c[0]; g += c[1]; b += c[2]; n++ } return [r / n | 0, g / n | 0, b / n | 0] }
  const res = { sludge: avg(px - 96, px - 14), water: avg(px + 14, px + 96), rockNear: sample(px - 5, py - 20), glow: sim.glow[rl], alpha: np.mats.alpha[rl], color: np.mats.color[rl].toString(16) }
  const cx = (px - np.cam.x + 427 / 2) * S, cy = (py - 20 - np.cam.y + 240 / 2) * S, w = 240 * S, h = 80 * S
  const cv = document.createElement('canvas'); cv.width = 240 * 3; cv.height = 80 * 3
  const c = cv.getContext('2d'); c.imageSmoothingEnabled = false
  c.drawImage(view, cx - w / 2, cy - h / 2, w, h, 0, 0, cv.width, cv.height)
  res.url = cv.toDataURL('image/png')
  return res
})
fs.writeFileSync(`${out}/glow-z.png`, Buffer.from(r.url.split(',')[1], 'base64'))
delete r.url
console.log(JSON.stringify(r))
await browser.close()
