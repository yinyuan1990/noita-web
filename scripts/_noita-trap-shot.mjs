// 临时探针:出生地放一个朝右的箭陷阱,人站在它右边 80px → 每秒射一箭
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(1500)
await page.evaluate(() => {
  const np = window.__np, E = np.entities
  for (const e of E.list) e.dead = true
  const d = E.defs.arrowtrap_right
  E._img(d.sprite.image)
  E.list.push(E._make('arrowtrap_right', d, 250, -92))
  np.player.x = 330; np.player.y = -90; np.player.hp = 4
})
const log = []
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(900)
  log.push(await page.evaluate(() => { const np = window.__np; const t = np.entities.list.find((e) => e.name === 'arrowtrap_right'); return `trap=${t ? (t.x | 0) + ',' + (t.y | 0) + ' face=' + t.face + ' anim=' + t.anim : 'gone'} arrows=${np.projectiles.list.filter((q) => q.name === 'e_arrow').length} hp=${np.player.hp.toFixed(2)} p=${np.player.x | 0},${np.player.y | 0}` }))
}
console.log(log.join('\n'))
await page.screenshot({ path: 'C:/Users/admin/AppData/Local/Temp/trap-0.png' })
await browser.close()
