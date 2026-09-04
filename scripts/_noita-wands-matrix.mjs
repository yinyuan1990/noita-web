// 临时:逐个法杖开火 0.4s,统计 弹/粒子/贴图粒子/挖掉格/新增材质,找异常
import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto('http://localhost:5177/noita-play.html?log=0')
await page.waitForFunction(() => window.__np && window.__np.projectiles && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(1500)
const W = await page.evaluate(() => window.__np.WANDS.map((w) => w.name + '/' + w.proj))
for (let i = 0; i < W.length; i++) {
  await page.evaluate(() => { const n = window.__np; n.player.x = 560; n.player.y = 560; n.player.vy = 0; n.cam.x = 560; n.cam.y = 560 })
  await page.waitForTimeout(400)
  const hist = () => page.evaluate(() => { const s = window.__np.sim; const h = new Map(); for (let y = 490; y <= 640; y++) for (let x = 520; x <= 720; x++) { const m = s.get(x, y); h.set(m, (h.get(m) || 0) + 1) } return [...h.entries()] })
  const before = await hist()
  await page.evaluate((k) => window.__np.setWand(k), i)
  await page.mouse.move(650, 300); await page.mouse.down(); await page.waitForTimeout(400)
  const mid = await page.evaluate(() => { const P = window.__np.projectiles; return { live: P.list.length, fx: P.fx.length, sfx: P.sfx.length, anims: P.anims.length, stuck: P.stuck.length } })
  await page.mouse.up(); await page.waitForTimeout(1200)
  const after = await hist()
  const b = new Map(before), a = new Map(after)
  const names = await page.evaluate((ids) => ids.map((id) => window.__np.mats.name(id)), [...new Set([...b.keys(), ...a.keys()])])
  const idList = [...new Set([...b.keys(), ...a.keys()])]
  const diff = idList.map((id, k) => [names[k], (a.get(id) || 0) - (b.get(id) || 0)]).filter(([, d]) => Math.abs(d) >= 3).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 5)
  console.log(W[i].padEnd(34), `飞行中 ${mid.live}  粒子 ${mid.fx}  贴图粒子 ${mid.sfx}  动画 ${mid.anims}  留痕 ${mid.stuck}  |  材质变化: ${diff.map(([n, d]) => `${n}${d > 0 ? '+' : ''}${d}`).join(' ') || '无'}`)
}
await browser.close()
