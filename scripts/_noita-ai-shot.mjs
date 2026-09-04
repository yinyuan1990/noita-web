// 临时探针:第 4 步 —— 射手远程攻击、虫钻地追人
import { chromium } from 'playwright'
const out = process.argv[2] || 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto('http://localhost:5177/noita-play.html?log=0')
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(2500)
// 放一个矿工 + 一个霰弹手在右边 60px
await page.evaluate(() => {
  const E = window.__np.entities
  for (const [n, x] of [['miner_weak', 300], ['shotgunner_weak', 330]]) { const d = E.defs[n]; E._img(d.sprite.image); E.list.push(E._make(n, d, x, -85)) }
  window.__np.player.iframe = 0
})
let shots = 0
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(500)
  const s = await page.evaluate(() => ({ hp: +window.__np.player.hp.toFixed(2), proj: window.__np.projectiles.list.filter((p) => p.owner === 'enemy').map((p) => p.name), st: window.__np.entities.list.filter((e) => e.y < 0).map((e) => `${e.name}:${e.state}/${e.anim}`) }))
  shots += s.proj.length
  console.log(s)
  if (i === 3) await page.screenshot({ path: `${out}/ai-shoot.png` })
}
// 虫:放在地里(出生点下方 40px)
await page.evaluate(() => { const E = window.__np.entities; const d = E.defs.worm; for (const p of d.parts) E._img(p.image); E.worms.push(E._makeWorm('worm', d, 160, -40)); window.__np.player.iframe = 999 })
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(500)
  console.log('worm', await page.evaluate(() => { const w = window.__np.entities.worms[0]; return w ? { x: w.x | 0, y: w.y | 0, ground: w.inGround, hunting: w.hunting, ang: (w.ang * 57.3) | 0, air: w.airT.toFixed(1) } : 'none' }))
  if (i === 2) await page.screenshot({ path: `${out}/ai-worm.png` })
}
await page.screenshot({ path: `${out}/ai-worm2.png` })
await browser.close()
