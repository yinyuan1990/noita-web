// 探针:Kolmisilmä 开打 / 死亡出胜利传送门 / 三宝结局 —— 传到实验室(终),拿三宝(直接调 pickup)看 boss 变可打;打死看传送门;带三宝到胜利室结局点看变金
// 用法:node scripts/_noita-ending-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1&god=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
const tp = (x, y) => page.evaluate(([x, y]) => { const np = window.__np; np.player.x = x; np.player.y = y; np.player.vx = 0; np.player.vy = 0; np.cam.x = x; np.cam.y = y }, [x, y])
await tp(3546, 12949)
await page.waitForTimeout(5000)
const before = await page.evaluate(() => { const E = window.__np.entities, b = E.list.find((e) => e.name === 'boss_centipede'); return { boss: b && { hp: b.hp, mul: b.dmgMul, move: b.bossMove?.mode }, sampo: E.bodies.filter((x) => x.name === 'sampo').length, active: !!E.finalBossActive } })
console.log('before', JSON.stringify(before))
await page.evaluate(() => { const E = window.__np.entities; const s = E.bodies.find((x) => x.name === 'sampo'); if (s) { s.dead = true; E.hooks.pickup(s) } else E.hooks.pickup({ name: 'sampo', d: E.defs.sampo, isItem: true, x: 0, y: 0, dead: true }) })
await page.waitForTimeout(3000)
const fight = await page.evaluate(() => { const E = window.__np.entities, b = E.list.find((e) => e.name === 'boss_centipede'); return { boss: b && { hp: b.hp.toFixed(1), mul: b.dmgMul, move: b.bossMove?.mode, anim: b.anim }, active: !!E.finalBossActive, proj: E.projectiles.list.length, quest: window.__np.player.quest } })
console.log('fight', JSON.stringify(fight))
await page.screenshot({ path: `${out}/ending-fight.png` })
// 打死
await page.evaluate(() => { const E = window.__np.entities, b = E.list.find((e) => e.name === 'boss_centipede'); if (b) { b.dmgMul = 1; E.hurt(b, 9999, 0, 0, 'explosion') } })
await page.waitForTimeout(1500)
const dead = await page.evaluate(() => { const np = window.__np; return { bosses: np.entities.list.filter((e) => e.boss).length, portals: np.temple.portals.map((p) => `${p.name}@${p.x | 0},${p.y | 0} on=${p.on}`), flags: np.player.runFlags } })
console.log('dead', JSON.stringify(dead))
// 结局:胜利室祭坛
await tp(6144 + 254, 14848 + 307 - 20)
await page.waitForTimeout(4000)
const end = await page.evaluate(() => { const np = window.__np; return { spots: np.__endSpots?.length, ending: np.player.ending && { r: np.player.ending.r }, quest: np.player.quest, flags: np.player.runFlags, pos: [np.player.x | 0, np.player.y | 0] } })
console.log('end', JSON.stringify(end))
await page.screenshot({ path: `${out}/ending-gold.png` })
if (errors.length) console.log('ERRORS', [...new Set(errors)].slice(0, 8))
await browser.close()
