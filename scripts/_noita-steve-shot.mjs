// Ã¤Â¸Â´Ã¦ÂÂ¶Ã¦ÂÂ¢Ã©ÂÂ:Ã¥ÂÂ£Ã¥Â±Â±Ã¥Â®ÂÃ¥ÂÂ« Stevari Ã¢ÂÂÃ¢Â?Ã¤Â¼Â Ã©ÂÂÃ¥ÂÂ°Ã§Â¬Â¬Ã¤Â¸ÂÃ¥ÂºÂ§Ã¥ÂÂ£Ã¥Â±?Ã¢Â?Ã¦ÂÂ¥Ã¤Â¸Â¤Ã¨Â¡ÂÃ§Â ÂÃ¦Â£ÂÃ¦ÂÂ¥Ã¥ÂÂºÃ¥ÂÂ¨Ã¦ÂÂ¯Ã¥ÂÂ£Ã¥Â±Â±Ã§Â ?Ã¢Â?Ã¦ÂÂÃ¤Â¸ÂÃ¤Â»Â¶Ã¥ÂÂÃ¥ÂºÂÃ¨Â´Â§Ã¦ÂÂªÃ¥ÂÂº shop_hitbox = Ã¥Â?Ã¢Â?Ã¦ÂÂ¹Ã¦Â?Ã¢Â?3s Ã¥Â?Stevari Ã¥ÂÂºÃ§ÂÂ°Ã¨Â¿Â½Ã¤ÂºÂºÃ¥Â¼ÂÃ§Â?
// Ã¢Â?Ã¦ÂÂ°Ã©Â¡Âµ)Ã¦ÂÂÃ§Â©Â¿Ã©Â¡Â¶Ã¤Â¸ÂÃ©ÂÂ£Ã¨Â¡ÂÃ§Â ?Ã¢Â?Ã¦ÂÂ¹Ã¦ÂÂÃ£ÂÂÃ§ÂÂ¨Ã¦Â³?node scripts/_noita-steve-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const open = async () => {
  const page = await browser.newPage({ viewport: { width: 854, height: 480 }, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  await page.goto(url)
  await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
  await page.waitForTimeout(1000)
  await page.evaluate(() => { const np = window.__np; np.player.x = -260; np.player.y = 1380; np.player.vx = 0; np.player.vy = 0; np.cam.x = -260; np.cam.y = 1380; np.player.hp = 4 })
  await page.waitForTimeout(6000)
  return page
}
const status = (page) => page.evaluate(() => {
  const np = window.__np, g = np.guard
  const E = np.entities
  const steve = E.list.filter((e) => e.name === 'necromancer_shop').map((e) => `steve@${e.x | 0},${e.y | 0} v=${e.vx | 0},${e.vy | 0} hp=${e.hp.toFixed(1)} st=${e.state} an=${e.anim} blocked=${E._blocked(e, e.x, e.y)} sees=${E._sees(e, np.player)} rc=${e.rangedCool?.toFixed(1)} rng=${e.ranged}/${e.rangedMin}-${e.rangedMax} melee=${e.melee}`)
  return `angered=${g.angered} pending=${g.pending.length} guards=${g.guards.length} areas=${g.areas.length} checks=${g.checks.map((c) => (c.done ? 'X' : c.checked ? 'ok' : '?')).join('')} ${steve.join(' ')} orbs=${np.projectiles.list.filter((q) => /orb_pink/.test(q.name)).length} php=${np.player.hp.toFixed(2)} tip=${document.getElementById('tip').textContent.slice(0, 8).replace(/[^\u4e00-\u9fa5A-Za-z!]/g, '')}`
})
let page = await open()
// Ã¢Â?Ã¦Â£ÂÃ¦ÂÂ¥Ã¥ÂÂºÃ¦ÂÂÃ¨Â´Â¨Ã§ÂÂ´Ã¦ÂÂ¹Ã¥Â?
console.log(await page.evaluate(() => {
  const np = window.__np
  return np.guard.checks.map((c) => { const h = {}; for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) { const m = np.matAt(x, y); const n = m < 0 ? 'unloaded' : np.mats.list[m]?.name || m; h[n] = (h[n] || 0) + 1 } return `check@${c.x0}..${c.x1},${c.y0}: ${JSON.stringify(h)}` }).join('\n')
}))
console.log(await status(page))
// Ã¢Â?Ã¥Â?Ã¦ÂÂÃ¤Â¸ÂÃ¤Â»Â¶Ã¦Â ÂÃ¤Â»Â·Ã¨Â´Â§Ã¦ÂÂªÃ¥ÂÂ°Ã¦Â¡ÂÃ¥Â¤Â(Ã¦Â¨Â¡Ã¦ÂÂÃ¨Â¢Â«Ã¨Â¸Â¢ / Ã§ÂÂ¸Ã¥ÂÂºÃ¥ÂÂÃ¥ÂºÂ)
console.log('steal:', await page.evaluate(() => {
  const np = window.__np
  const b = np.entities.bodies.find((x) => x.shop && x.shop.area)
  if (!b) return 'no shop body'
  const a = b.shop.area; b.asleep = false; b.nailed = false; b.y = a.y1 + 40; b.x = Math.max(a.x0 + 10, Math.min(a.x1 - 10, b.x))
  return `${b.shop.spell || b.wand?.key} moved to ${b.x | 0},${b.y | 0} (area y1=${a.y1})`
}))
for (let i = 0; i < 22; i++) { await page.waitForTimeout(800); console.log(await status(page)) }
await page.screenshot({ path: `${out}/steve-0.png` })
await page.close()
// Ã¢Â?Ã¦ÂÂÃ§Â©Â¿Ã©Â¡Â¶Ã¤Â¸ÂÃ©ÂÂ£Ã¨Â¡ÂÃ§Â ?
page = await open()
console.log('leak:', await page.evaluate(() => {
  const np = window.__np, c = np.guard.checks.filter((k) => k.checked && !k.done).sort((a, b) => Math.abs(a.x0 + 212 - np.player.x) - Math.abs(b.x0 + 212 - np.player.x))[0] // 最近的(sim 窗口内才挖得�?
  if (!c) return 'no valid check'
  let n = 0; for (let y = c.y0 - 3; y <= c.y1 + 3; y++) for (let x = c.x0 + 200; x < c.x0 + 212; x++) { np.sim.set(x, y, 0, 0); n++ }
  return `cleared ${n} cells at ${c.x0 + 200},${c.y0}`
}))
for (let i = 0; i < 6; i++) { await page.waitForTimeout(700); console.log(await status(page)) }
await page.screenshot({ path: `${out}/steve-1.png` })
await browser.close()
