// 临时探针:药水(捡/扔/碎/洒)、宝箱(开)、心
import { chromium } from 'playwright'
const out = process.argv[2] || 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto('http://localhost:5177/noita-play.html?log=0')
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(2500)
await page.evaluate(() => { const E = window.__np.entities; E.spawnItem('potion', 260, -110); E.spawnItem('potion', 290, -110); E.spawnItem('chest_random', 330, -110); E.spawnItem('heart', 360, -110); window.__np.player.iframe = 999 })
await page.waitForTimeout(2500)
console.log('items', await page.evaluate(() => window.__np.entities.bodies.filter((b) => b.isItem).map((b) => `${b.name}${b.potion ? '(' + b.potion.mat + ')' : ''}@${b.x | 0},${b.y | 0} ${b.asleep ? 'ZZ' : ''}`)))
await page.screenshot({ path: `${out}/items-0.png` })
// 走过去捡药水
await page.evaluate(() => { const np = window.__np; np.player.x = 250; np.player.y = -84; np.player.vx = 0 })
await page.keyboard.down('d'); await page.waitForTimeout(900); await page.keyboard.up('d')
console.log('inv', await page.evaluate(() => ({ items: window.__np.player.items.map((i) => i.name), hp: window.__np.player.hp, maxHp: window.__np.player.maxHp, gold: window.__np.player.gold })))
// 选药水扔出去
const nW = await page.evaluate(() => window.__np.player.wands.length)
await page.keyboard.press(String(nW + 1)); await page.waitForTimeout(100)
await page.mouse.move(750, 200); await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up()
await page.waitForTimeout(1500)
console.log('thrown', await page.evaluate(() => { const s = window.__np.sim; let liq = 0; for (let y = -140; y < -40; y++) for (let x = 250; x < 450; x++) { const m = s.get(x, y); if (m > 0 && window.__np.mats.kind[m] === 'liquid') liq++ } return { items: window.__np.player.items.map((i) => i.name), liquidCells: liq, bodies: window.__np.entities.bodies.filter((b) => b.isItem).map((b) => b.name) } }))
await page.screenshot({ path: `${out}/items-1.png` })
// 继续走去开箱 + 捡心
await page.keyboard.down('d'); await page.waitForTimeout(2200); await page.keyboard.up('d'); await page.waitForTimeout(1500)
console.log('chest', await page.evaluate(() => ({ items: window.__np.player.items.map((i) => i.name), hp: window.__np.player.hp, maxHp: window.__np.player.maxHp, gold: window.__np.player.gold, wands: window.__np.player.wands.map((w) => w.name), bodies: window.__np.entities.bodies.filter((b) => b.isItem).map((b) => b.name + (b.gold ? b.gold : '')) })))
await page.screenshot({ path: `${out}/items-2.png` })
await browser.close()
