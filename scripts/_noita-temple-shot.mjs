// 临时探针:传送到第一座圣山(y≈1350),看商店 / 灯 / 特权 / 传送门;买一件;开编辑器截图
// 用法:node scripts/_noita-temple-shot.mjs [x,y] [url]
import { chromium } from 'playwright'
const [tx, ty] = (process.argv[2] || '150,1440').split(',').map(Number)
const url = process.argv[3] || 'http://localhost:5177/noita-play.html?log=0'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(1500)
const tp = (x, y) => page.evaluate(([x, y]) => { const np = window.__np; np.player.x = x; np.player.y = y; np.player.vx = 0; np.player.vy = 0; np.cam.x = x; np.cam.y = y }, [x, y])
await tp(tx, ty)
await page.waitForTimeout(6000)
const info = await page.evaluate(() => {
  const np = window.__np, E = np.entities
  const shop = E.bodies.filter((b) => b.shop).map((b) => `${b.shop.spell || b.wand?.key}@${b.x | 0},${b.y | 0} $${b.shop.cost}${b.shop.sale ? ' SALE' : ''}`)
  const lights = [...np.streamer.entries.values()].flatMap((c) => c.lights || []).filter((l) => l.y > 1200 && l.y < 1700).map((l) => `${l.kind}@${l.x | 0},${l.y | 0}`)
  const spawns = [...np.streamer.entries.values()].flatMap((c) => c.spawns || []).filter((s) => s.y > 1200 && s.y < 1700).map((s) => `${s.entity}@${s.x | 0},${s.y | 0}`)
  const scenes = [...np.streamer.entries.values()].flatMap((c) => c.scenes || []).filter((s) => s.y > 1000 && s.y < 1700).map((s) => s.name)
  return { biome: np.streamer.get(Math.floor(np.player.x / 512) + 35, Math.floor(np.player.y / 512) + 14)?.biome, shop, lights, spawns, scenes: [...new Set(scenes)], gold: np.player.gold, bodies: E.bodies.length }
})
console.log(JSON.stringify(info, null, 1))
await page.screenshot({ path: `${out}/temple-0.png` })
// 给钱,走到第一件商品上买下
const first = await page.evaluate(() => { const b = window.__np.entities.bodies.find((b) => b.shop); return b ? { x: b.x, y: b.y } : null })
if (first) {
  await page.evaluate(() => { window.__np.player.gold = 2000 })
  await tp(first.x, first.y - 4)
  await page.waitForTimeout(1500)
  console.log('after buy', await page.evaluate(() => ({ gold: window.__np.player.gold, spells: window.__np.player.spells, wands: window.__np.player.wands.map((w) => w.name) })))
  await page.screenshot({ path: `${out}/temple-1.png` })
  await page.keyboard.press('i')
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/temple-2.png` })
  await page.keyboard.press('i')
}
// 重掷机:给钱走过去
const machine = await page.evaluate(() => { const b = window.__np.entities.bodies.find((b) => b.name === 'perk_reroll'); return b ? { x: b.x, y: b.y } : null })
console.log('reroll machine', machine)
if (machine) {
  await page.evaluate(() => { window.__np.player.gold = 1000 })
  await tp(machine.x, machine.y - 4)
  await page.waitForTimeout(1500)
  console.log('after reroll', await page.evaluate(() => ({ gold: window.__np.player.gold, perks: window.__np.entities.bodies.filter((b) => b.perk).map((b) => b.perk), tip: document.getElementById('tip').textContent.slice(0, 60) })))
}
// 特权:走到第一个特权上
const perk = await page.evaluate(() => { const list = window.__np.entities.bodies.filter((b) => b.perk); return list.length ? { x: list[0].x, y: list[0].y, ids: list.map((b) => b.perk) } : null })
console.log('perks on altar', perk)
if (perk) {
  await tp(perk.x, perk.y - 4)
  await page.waitForTimeout(1500)
  console.log('after perk', await page.evaluate(() => ({ perks: window.__np.player.perks, left: window.__np.entities.bodies.filter((b) => b.perk).map((b) => `${b.perk} g=${b.group} dead=${b.dead} @${b.x | 0},${b.y | 0}`), maxHp: window.__np.player.maxHp, tip: document.getElementById('tip').textContent })))
  await page.screenshot({ path: `${out}/temple-3.png` })
}
await browser.close()
