// 临时探针:像素刚体 —— 出生点放炸药箱/油桶/石头,看落地入睡、推、打漏、炸
import { chromium } from 'playwright'
const out = process.argv[2] || 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto('http://localhost:5177/noita-play.html?log=0')
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(2500)
// 只看出生点附近(y<0)的刚体
const st = () => page.evaluate(() => window.__np.entities.bodies.filter((b) => b.y < 0).map((b) => `${b.name}@${b.x.toFixed(0)},${b.y.toFixed(0)} rot=${(b.rot * 57.3).toFixed(0)} v=${b.vx.toFixed(0)},${b.vy.toFixed(0)} w=${b.w.toFixed(2)} ${b.asleep ? 'ZZ' : 'awake'} hp=${b.hp === Infinity ? 'inf' : b.hp.toFixed(2)} lost=${(b.destroyed * 100).toFixed(0)}%`))
const find = (name) => `window.__np.entities.bodies.find((b) => b.name === '${name}' && b.y < 0)`
await page.evaluate(() => { const E = window.__np.entities; E.spawnProp('physics_box_explosive', 300, -130); E.spawnProp('physics_barrel_oil', 330, -140); E.spawnProp('physics_stone_02', 260, -150); E.spawnProp('physics_crate', 360, -160) })
await page.waitForTimeout(600); console.log('falling', await st())
await page.waitForTimeout(2500); console.log('settled', await st())
await page.screenshot({ path: `${out}/props-0.png` })
// 推箱子:站到炸药箱左边往右顶
const bx = await page.evaluate(`(() => { const b = ${find('physics_box_explosive')}; return b ? b.x : 300 })()`)
await page.evaluate(([x]) => { const np = window.__np; np.player.x = x - 14; np.player.y = -90; np.player.vx = 0; np.player.vy = 0 }, [bx])
await page.keyboard.down('d'); await page.waitForTimeout(1200); await page.keyboard.up('d'); await page.waitForTimeout(1500)
console.log('pushed', await st(), await page.evaluate(() => ({ px: window.__np.player.x | 0 })))
await page.screenshot({ path: `${out}/props-1.png` })
// 打油桶
await page.evaluate(`(() => { const np = window.__np; const b = ${find('physics_barrel_oil')}; if (b) for (let i = 0; i < 3; i++) np.projectiles.spawn('light_bullet', b.x - 18, b.y - 3, 0, {}) })()`)
await page.waitForTimeout(1200)
console.log('barrel shot', await st(), await page.evaluate(() => { const s = window.__np.sim, id = window.__np.mats.byName.get('oil'); let c = 0; for (let y = -200; y < 0; y++) for (let x = 150; x < 450; x++) if (s.get(x, y) === id) c++; return { debris: window.__np.debris.length, oil: c } }))
await page.screenshot({ path: `${out}/props-2.png` })
// 打炸药箱
await page.evaluate(`(() => { const np = window.__np; const b = ${find('physics_box_explosive')}; if (b) for (let i = 0; i < 12; i++) np.projectiles.spawn('light_bullet', b.x - 18, b.y - 4 + (i % 3), 0, {}) })()`)
await page.waitForTimeout(400); await page.screenshot({ path: `${out}/props-3.png` })
await page.waitForTimeout(1500); console.log('box shot', await st(), await page.evaluate(() => ({ broken: window.__np.entities.stats.broken, hp: window.__np.player.hp.toFixed(2) })))
await page.screenshot({ path: `${out}/props-4.png` })
await browser.close()
