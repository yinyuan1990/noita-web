// 临时探针:EXTRA_SHOP_ITEM → TEMPLE_SHOP_ITEM_COUNT 传进 Worker:先把 shopCount 设成 7,再传送到第一座圣山,数商店货
// 用法:node scripts/_noita-shopcount-shot.mjs [count] [url]
import { chromium } from 'playwright'
const count = +(process.argv[2] || 7)
const url = process.argv[3] || 'http://localhost:5177/noita-play.html?log=0'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(1000)
await page.evaluate(async (n) => { await window.__np.client.setGlobals({ shopCount: n }) }, count)
await page.evaluate(() => { const np = window.__np; np.player.x = 0; np.player.y = 1400; np.player.vx = 0; np.player.vy = 0; np.cam.x = 0; np.cam.y = 1400; np.player.hp = 4 })
await page.waitForTimeout(7000)
const info = await page.evaluate(() => {
  const np = window.__np, E = np.entities
  const shop = E.bodies.filter((b) => b.shop && !b.dead).map((b) => `${b.wand ? 'wand' : b.shop.spell}@${b.x | 0},${b.y | 0}${b.shop.sale ? ' SALE' : ''}:${b.shop.cost}`)
  const spawns = [...np.streamer.entries.values()].flatMap((c) => (c.spawns || []).filter((s) => s.entity === 'shop_item' || s.entity === 'shop_wand'))
  return { shopBodies: shop.length, shopSpawns: spawns.length, rows: [...new Set(spawns.map((s) => s.y))], xs: [...new Set(spawns.map((s) => s.x | 0))].sort((a, b) => a - b), items: shop }
})
console.log(JSON.stringify(info, null, 1))
await page.screenshot({ path: 'C:/Users/admin/AppData/Local/Temp/shopcount.png' })
await browser.close()
