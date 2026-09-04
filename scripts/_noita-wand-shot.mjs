// 临时探针:第 5 步 —— 真法杖:开局两根、施法/法力/充能、煤矿祭坛的法杖、捡起
import { chromium } from 'playwright'
const out = process.argv[2] || 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto('http://localhost:5177/noita-play.html?log=0')
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(2500)
const W = () => page.evaluate(() => window.__np.player.wands.map((w) => `${w.name} cards=${w.cards.join(',')} mana=${w.mana | 0}/${w.manaMax} cd=${w.cd.toFixed(2)} reload=${w.reloadT.toFixed(2)} deck=${w.deck.length} fr=${w.fireRateWait} rt=${w.reloadTime}`))
console.log('start', await W())
// 连射 1.2s
await page.mouse.move(700, 240); await page.mouse.down(); await page.waitForTimeout(1200); await page.mouse.up()
console.log('after fire', await W(), await page.evaluate(() => ({ proj: window.__np.projectiles.list.length })))
await page.screenshot({ path: `${out}/wand-0.png` })
// 换炸弹杖打一发
await page.keyboard.press('2'); await page.waitForTimeout(100)
await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up()
console.log('bomb', await W())
await page.keyboard.press('1')
// 下煤矿找祭坛法杖
await page.evaluate(() => { const np = window.__np; np.player.x = 1930; np.player.y = 790; np.cam.x = 1940; np.cam.y = 800; np.player.iframe = 999 })
await page.waitForTimeout(6000)
const items = await page.evaluate(() => window.__np.entities.bodies.filter((b) => b.wand).map((b) => `${b.wand.key}(${b.wand.name}) cards=${b.wand.cards.join(',')} @${b.x | 0},${b.y | 0}`))
console.log('altar wands', items)
const spawnsW = await page.evaluate(() => [...window.__np.streamer.entries.values()].flatMap((c) => (c.spawns || []).filter((s) => /^wand/.test(s.entity)).map((s) => `${s.entity}@${s.x},${s.y}`)))
console.log('wand spawns', spawnsW)
// 捡一根
const first = await page.evaluate(() => { const b = window.__np.entities.bodies.find((b) => b.wand); return b ? { x: b.x, y: b.y } : null })
if (first) {
  await page.evaluate(([x, y]) => { const np = window.__np; np.player.x = x; np.player.y = y - 2; np.player.vx = 0; np.player.vy = 0; np.cam.x = x; np.cam.y = y }, [first.x, first.y])
  await page.waitForTimeout(800)
  console.log('picked', await W())
  await page.screenshot({ path: `${out}/wand-1.png` })
}
await browser.close()
