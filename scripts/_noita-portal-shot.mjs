// 临时探针:圣山入口传送门 —— 掉进 altar_top 漏斗 → 碰到传送门 → 落到 (−677, y+280) 的入口洞;抽掉传送液 → 门灭
// 用法:node scripts/_noita-portal-shot.mjs [url]
import { chromium } from 'playwright'
const url = (process.argv[2] || 'http://localhost:5177/noita-play.html?log=0') + '&new=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(2000)
const tp = (x, y) => page.evaluate(([x, y]) => { const np = window.__np; np.player.x = x; np.player.y = y; np.player.vx = 0; np.player.vy = 0; np.cam.x = x; np.cam.y = y }, [x, y])
// 矿区底部、漏斗正上方(temple_altar 列的 altar_top 是普通款,漏斗里没液体)
await tp(-248, 940); await page.waitForTimeout(4000)
console.log('portals:', await page.evaluate(() => window.__np.temple.portals.map((p) => `${p.x | 0},${p.y | 0} on=${p.on}`)))
console.log('quest above funnel:', await page.evaluate(() => document.getElementById('quest').textContent.split('\n')[0]), await page.evaluate(() => window.__np.quest()))
await page.screenshot({ path: `${out}/portal-0.png` })
// 站在漏斗里(y≈1050,还没进屋)指引应仍是传送门、也不算在圣山里
await tp(-230, 1050); await page.waitForTimeout(700)
console.log('quest in funnel:', await page.evaluate(() => document.getElementById('quest').textContent.split('\n')[0]), '| inTemple hud:', await page.evaluate(() => /圣山:I/.test(document.getElementById('hud').textContent)))
await page.screenshot({ path: `${out}/portal-1.png` })
// 掉到漏斗底 → 传送
await page.waitForTimeout(3000)
const after = await page.evaluate(() => ({ x: window.__np.player.x | 0, y: window.__np.player.y | 0, tip: document.getElementById('tip').textContent, biome: window.__np.streamer.get(Math.floor(window.__np.player.x / 512) + 35, Math.floor(window.__np.player.y / 512) + 14)?.biome }))
console.log('after portal:', JSON.stringify(after), 'expected ≈ (-677, 1350)')
await page.waitForTimeout(3000)
console.log('quest in temple:', await page.evaluate(() => document.getElementById('quest').textContent.split('\n')[0]))
await page.screenshot({ path: `${out}/portal-2.png` })
// 抽干眼睛里的传送液 → 门灭
await tp(-248, 1000); await page.waitForTimeout(1500)
await page.evaluate(() => { const np = window.__np; for (let y = 1190; y <= 1220; y++) for (let x = -280; x <= -220; x++) { const m = np.matAt(x, y); if (m > 0 && /teleport/.test(np.mats.list[m].name)) np.sim.set(x, y, 0, 0) } })
await page.waitForTimeout(2500)
console.log('portal after draining eye:', await page.evaluate(() => window.__np.temple.portals.filter((p) => Math.abs(p.x + 248) < 5).map((p) => `on=${p.on}`)), '| tip:', await page.evaluate(() => document.getElementById('tip').textContent))
await page.waitForTimeout(3000)
console.log('player stayed in funnel:', await page.evaluate(() => ({ x: window.__np.player.x | 0, y: window.__np.player.y | 0 })))
await page.screenshot({ path: `${out}/portal-3-off.png` })
await browser.close()
