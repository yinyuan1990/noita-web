// 临时探针:第 4 步尾巴 —— 蝙蝠飞、蜘蛛爬墙、走路怪跨坑/卡住放弃
import { chromium } from 'playwright'
const out = process.argv[2] || 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto('http://localhost:5177/noita-play.html?log=0')
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(2500)
await page.evaluate(() => {
  const E = window.__np.entities
  for (const [n, x, y] of [['bat', 300, -140], ['fireskull', 330, -150], ['longleg', 190, -95], ['longleg', 250, -150]]) { const d = E.defs[n]; E._img(d.sprite.image); E.list.push(E._make(n, d, x, y)) }
  window.__np.player.iframe = 999
})
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(500)
  console.log(await page.evaluate(() => window.__np.entities.list.filter((e) => e.y < 0 && !e.dead).map((e) => `${e.name}@${e.x | 0},${e.y | 0} ${e.state}/${e.anim} v=${e.vx | 0},${e.vy | 0}${e.crawler ? ' surf=' + e.surf : ''}${e.flyer ? ' fly' : ''}`)))
  if (i === 3) await page.screenshot({ path: `${out}/ai2-0.png` })
}
await page.screenshot({ path: `${out}/ai2-1.png` })
await browser.close()
