// 临时探针:出生地放一颗地雷,走过去 → 亮起 → 炸 → 掉血 + 坑
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(1500)
await page.evaluate(() => {
  const np = window.__np
  for (const e of np.entities.list) e.dead = true
  const d = np.entities.defs.mine_scavenger
  np.entities._img(d.sprite.image)
  // 出生地地面在 y≈-84(x 290~310),雷放在地面上
  np.entities.list.push(np.entities._make('mine_scavenger', d, 300, -88))
  np.player.hp = 4; np.player.x = 240; np.player.y = -90
})
await page.waitForTimeout(600)
const before = await page.evaluate(() => ({ hp: window.__np.player.hp, solid: window.__np.sim.get(300, -82) }))
await page.keyboard.down('d'); await page.waitForTimeout(1100); await page.keyboard.up('d')
const log = []
for (let i = 0; i < 6; i++) { await page.waitForTimeout(250); log.push(await page.evaluate(() => { const m = window.__np.entities.list.find((e) => e.name === 'mine_scavenger'); return `p=${window.__np.player.x | 0} hp=${window.__np.player.hp.toFixed(2)} mine=${m ? (m.armT === undefined ? 'idle' : 'armed ' + m.armT.toFixed(2) + ' ' + m.anim) : 'gone'}` })) }
console.log('before', before); console.log(log.join('\n'))
console.log('crater', await page.evaluate(() => ({ solidAfter: window.__np.sim.get(300, -82), fire: [...Array(60)].filter((_, i) => window.__np.sim.get(270 + i, -86) === window.__np.sim.M_FIRE).length })))
await page.screenshot({ path: 'C:/Users/admin/AppData/Local/Temp/mine-0.png' })
await browser.close()
