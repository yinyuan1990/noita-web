// 临时探针:看吊挂刚体(链)是否稳定、能否入睡;打断锚点看它掉下来
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(1500)
const tp = (x, y) => page.evaluate(([x, y]) => { const np = window.__np; np.player.x = x; np.player.y = y; np.player.vx = 0; np.player.vy = 0; np.cam.x = x; np.cam.y = y; np.player.hp = 100 }, [x, y])
await tp(-1180, 1930)
await page.waitForTimeout(4000)
const pick = await page.evaluate(() => { const b = window.__np.entities.bodies.find((b) => b.ropes && b.name === 'suspended_container'); return b ? { x: b.x, y: b.y } : null })
console.log('container', pick)
if (pick) {
  await tp(pick.x - 40, pick.y + 10)
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1000)
    console.log(await page.evaluate(() => { const b = window.__np.entities.bodies.find((b) => b.ropes && b.name === 'suspended_container'); return b ? `${b.asleep ? 'ZZ' : 'awake'} v=${b.vx.toFixed(1)},${b.vy.toFixed(1)} w=${b.w.toFixed(2)} rot=${(b.rot * 57.3).toFixed(0)} rest=${b.restT.toFixed(2)} ropes=${b.ropes.map((r) => (r.broken ? 'X' : r.len)).join('/')}` : 'gone' }))
  }
  await page.screenshot({ path: `${out}/hang-0.png` })
  // 挖掉锚点:链断,罐子掉下来
  await page.evaluate(() => { const np = window.__np; const b = np.entities.bodies.find((b) => b.ropes && b.name === 'suspended_container'); for (const r of b.ropes) np.sim.paintCircle(r.ax, r.ay - 3, 5, 0) })
  await page.waitForTimeout(1500)
  console.log('after cut', await page.evaluate(() => { const b = window.__np.entities.bodies.find((b) => b.ropes && b.name === 'suspended_container'); return b ? `${b.asleep ? 'ZZ' : 'awake'} y=${b.y | 0} v=${b.vx.toFixed(1)},${b.vy.toFixed(1)} ropes=${b.ropes.map((r) => (r.broken ? 'X' : r.len)).join('/')}` : 'gone' }))
  await page.screenshot({ path: `${out}/hang-1.png` })
}
await browser.close()
