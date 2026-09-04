// 临时探针:下到煤矿,看敌人生成/行走/受击
import { chromium } from 'playwright'
const out = process.argv[2] || 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto('http://localhost:5177/noita-play.html?log=0')
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(2000)
const tp = (x, y) => page.evaluate(([x, y]) => { const np = window.__np; np.player.x = x; np.player.y = y; np.player.vx = 0; np.player.vy = 0; np.cam.x = x; np.cam.y = y }, [x, y])
// 煤矿第一层
await tp(300, 760)
await page.waitForTimeout(6000)
let info = await page.evaluate(() => { const E = window.__np.entities; return { n: E.list.length, spawned: E.stats.spawned, skipped: E.stats.skipped, names: E.list.slice(0, 40).map((e) => `${e.name}@${e.x | 0},${e.y | 0}:${e.state}/${e.anim}`), chunksWithSpawns: [...window.__np.streamer.entries.values()].filter((c) => c.spawns?.length).map((c) => c.key + ':' + c.spawns.length) } })
console.log(JSON.stringify(info, null, 1))
await page.screenshot({ path: `${out}/ent-0.png` })
// 靠近第一只,盯着看 3 秒
const first = await page.evaluate(() => { const E = window.__np.entities; const e = E.list[0]; return e ? { x: e.x, y: e.y, name: e.name } : null })
if (first) {
  await tp(first.x - 60, first.y - 20)
  await page.waitForTimeout(3000)
  console.log('near', await page.evaluate(() => { const E = window.__np.entities; return E.list.slice(0, 6).map((e) => `${e.name}@${e.x | 0},${e.y | 0} hp=${e.hp.toFixed(2)} st=${e.state} an=${e.anim} g=${e.onGround} vx=${e.vx | 0}`) }))
  await page.screenshot({ path: `${out}/ent-1.png` })
  // 打它
  for (let k = 0; k < 6; k++) { await page.evaluate(() => { const np = window.__np; const e = np.entities.list[0]; if (e && !e.dead) np.projectiles.spawn('light_bullet', e.x - 30, e.y + (e.hit.t + e.hit.b) / 2, 0, {}) }); await page.waitForTimeout(150) }
  await page.waitForTimeout(400)
  console.log('after', await page.evaluate(() => { const E = window.__np.entities; return { killed: E.stats.killed, hp: window.__np.player.hp, list: E.list.slice(0, 6).map((e) => `${e.name} hp=${e.hp.toFixed(2)} st=${e.state}`) } }))
  await page.screenshot({ path: `${out}/ent-2.png` })
}
await browser.close()
