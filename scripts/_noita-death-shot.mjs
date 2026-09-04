// 临时探针:第 3 步 —— 打死怪出尸块 + 金块、捡金、怪着火、玩家沾油着火
import { chromium } from 'playwright'
const out = process.argv[2] || 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto('http://localhost:5177/noita-play.html?log=0')
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(2500)
// 在出生点旁边直接放一只僵尸(手动 make),打死它
await page.evaluate(() => {
  const E = window.__np.entities
  const d = E.defs.zombie_weak
  E._img(d.sprite.image)
  E.list.push(E._make('zombie_weak', d, 290, -85))
  window.__np.player.iframe = 999
})
await page.waitForTimeout(800)
await page.evaluate(() => { const np = window.__np; const e = np.entities.list.find((e) => e.y < 0); for (let i = 0; i < 4; i++) np.projectiles.spawn('light_bullet', e.x - 20, e.y - 2, 0, {}) })
await page.waitForTimeout(500)
console.log('killed', await page.evaluate(() => { const E = window.__np.entities; return { killed: E.stats.killed, bodies: E.bodies.filter((b) => b.y < 0).map((b) => `${b.name}${b.isRagdoll ? '(rag)' : ''}${b.isItem ? '(gold ' + b.gold + ')' : ''}@${b.x | 0},${b.y | 0} ${b.asleep ? 'ZZ' : 'awake'}`) } }))
await page.screenshot({ path: `${out}/death-0.png` })
await page.waitForTimeout(2500)
await page.screenshot({ path: `${out}/death-1.png` })
// 走过去捡金
await page.evaluate(() => { const np = window.__np; np.player.x = 262; np.player.y = -85; np.player.vx = 0 })
await page.keyboard.down('d'); await page.waitForTimeout(1200); await page.keyboard.up('d')
console.log('gold', await page.evaluate(() => ({ gold: window.__np.player.gold, items: window.__np.entities.bodies.filter((b) => b.isItem).length, meat: (() => { const s = window.__np.sim, id = window.__np.mats.byName.get('meat'); let c = 0; for (let y = -120; y < -60; y++) for (let x = 250; x < 340; x++) if (s.get(x, y) === id) c++; return c })() })))
// 再放一只僵尸,给它点火
await page.evaluate(() => { const E = window.__np.entities; const d = E.defs.zombie_weak; const e = E._make('zombie_weak', d, 330, -85); E.list.push(e); E.ignite(e) })
await page.waitForTimeout(1500)
console.log('burning', await page.evaluate(() => { const e = window.__np.entities.list.find((e) => e.y < 0 && !e.dead); return e ? { hp: e.hp.toFixed(2), fireT: e.fireT.toFixed(1), anim: e.anim } : 'dead' }))
await page.screenshot({ path: `${out}/death-2.png` })
// 玩家沾油 → 碰火
await page.evaluate(() => { const np = window.__np; const oil = np.mats.byName.get('oil'); for (let y = -96; y < -82; y++) for (let x = 205; x < 225; x++) if (np.sim.get(x, y) === 0) np.sim.set(x, y, oil, 0); np.player.iframe = 0 })
await page.waitForTimeout(900)
await page.evaluate(() => { const np = window.__np; np.player.x = 215; np.player.y = -84; np.player.vx = 0; np.player.vy = 0 })
await page.waitForTimeout(700)
console.log('oiled', await page.evaluate(() => ({ stain: window.__np.player.stain, wet: window.__np.player.wet.toFixed(1) })))
await page.evaluate(() => { const np = window.__np; np.player.x = 260; np.player.y = -85; np.sim.set(262, -86, np.sim.M_FIRE, 0); np.sim.set(263, -86, np.sim.M_FIRE, 0) })
await page.waitForTimeout(1500)
console.log('fire', await page.evaluate(() => ({ fireT: window.__np.player.fireT.toFixed(1), hp: window.__np.player.hp.toFixed(2) })))
await page.screenshot({ path: `${out}/death-3.png` })
await browser.close()
