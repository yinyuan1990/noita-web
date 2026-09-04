// 临时探针:圣山崩塌(workshop_exit 触发 → 松脱块 → 神山诅咒)+ 存档(刷新后人 / 杖 / 金 / 已崩圣山都在)
// 用法:node scripts/_noita-collapse-shot.mjs [url]
import { chromium } from 'playwright'
const base = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const ctx = await browser.newContext({ viewport: { width: 854, height: 480 } })
async function boot(url) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
  await page.goto(url)
  await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
  await page.waitForTimeout(2000)
  return page
}
const tp = (page, x, y) => page.evaluate(([x, y]) => { const np = window.__np; np.player.x = x; np.player.y = y; np.player.vx = 0; np.player.vy = 0; np.cam.x = x; np.cam.y = y }, [x, y])

let page = await boot(base + '&new=1')
console.log('fresh start loaded?', await page.evaluate(() => window.__np.loaded))
// 先到圣山商店区,让 altar_right 的标记进来
await tp(page, 60, 1440); await page.waitForTimeout(4000)
const exits = await page.evaluate(() => window.__np.temple.exits)
console.log('exits:', JSON.stringify(exits))
const ex = exits[0]
// 记崩塌前:中心 180 圆内圣山砖数 / 刚体数;给点金、买件东西留作存档验证
const before = await page.evaluate(([ex]) => {
  const np = window.__np, cx = ex.x - 144, cy = ex.y + 70
  let brick = 0; for (let y = cy - 180; y <= cy + 180; y += 2) for (let x = cx - 180; x <= cx + 180; x += 2) { const m = np.matAt(x, y); if (m > 0 && /^temple/.test(np.mats.list[m]?.name || '') && np.mats.kind[m] === 'static') brick++ }
  np.player.gold = 777
  return { brick, bodies: np.entities.bodies.filter((b) => !b.dead).length, checks: np.guard.checks.map((c) => c.done) }
}, [ex])
console.log('before:', JSON.stringify(before))
// 踩触发器
await tp(page, ex.x, ex.y + 4); await page.waitForTimeout(300)
console.log('collapse started:', await page.evaluate(() => ({ n: window.__np.collapses.length, collapsed: [...window.__np.collapsed], tip: document.getElementById('tip').textContent })))
// 站到诅咒区里看掉血(商店区 x∈[ex-534, ex-80])
await tp(page, ex.x - 300, ex.y + 60)
await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/collapse-1.png` })
const hp1 = await page.evaluate(() => window.__np.player.hp)
await page.waitForTimeout(3000); await page.screenshot({ path: `${out}/collapse-2.png` })
const mid = await page.evaluate(([ex]) => {
  const np = window.__np, cx = ex.x - 144, cy = ex.y + 70
  let brick = 0, cc = 0; for (let y = cy - 180; y <= cy + 180; y += 2) for (let x = cx - 180; x <= cx + 180; x += 2) { const m = np.matAt(x, y); const n = np.mats.list[m]?.name || ''; if (m > 0 && /^temple/.test(n) && np.mats.kind[m] === 'static') brick++; if (n === 'concrete_collapsed') cc++ }
  const lc = np.entities.bodies.filter((b) => !b.dead && b.name === 'loose_chunk')
  return { brick, concreteSleeping: cc, loose: lc.length, awake: lc.filter((b) => !b.asleep).length, spawned: np.collapses[0]?.spawned, curseT: +(np.collapses[0]?.curseT || 0).toFixed(1), hp: +np.player.hp.toFixed(3), checks: np.guard.checks.map((c) => c.done), shopArea: np.entities.bodies.filter((b) => b.shop).map((b) => !!b.shop.area) }
}, [ex])
console.log('t≈4.8s:', JSON.stringify(mid), 'hp 1.5s→4.5s:', hp1.toFixed(3), '→', mid.hp)
await page.waitForTimeout(6000)
const late = await page.evaluate(([ex]) => {
  const np = window.__np, cx = ex.x - 144, cy = ex.y + 70
  let cc = 0; for (let y = cy - 180; y <= cy + 250; y += 2) for (let x = cx - 180; x <= cx + 180; x += 2) { const m = np.matAt(x, y); if ((np.mats.list[m]?.name || '') === 'concrete_collapsed') cc++ }
  const lc = np.entities.bodies.filter((b) => !b.dead && b.name === 'loose_chunk')
  return { concreteSleeping: cc, loose: lc.length, awake: lc.filter((b) => !b.asleep).length, hp: +np.player.hp.toFixed(3), fps: document.getElementById('panel').textContent.split(' ')[0] }
}, [ex])
console.log('t≈11s:', JSON.stringify(late))
await page.screenshot({ path: `${out}/collapse-3.png` })
// 再踩一次不应重复触发
await tp(page, ex.x, ex.y + 4); await page.waitForTimeout(300)
console.log('re-trigger collapses:', await page.evaluate(() => window.__np.collapses.length), '(should stay ≤1)')
// 存档:手动存,刷新(不带 new=1)
await tp(page, ex.x - 60, ex.y + 60); await page.waitForTimeout(300)
const snap = await page.evaluate(() => { const np = window.__np; np.player.spells.push('LIGHT_BULLET'); np.saveGame('probe'); return { x: np.player.x | 0, y: np.player.y | 0, gold: np.player.gold, hp: +np.player.hp.toFixed(3), wands: np.player.wands.map((w) => w.key + ':' + w.cards.join('/')), spells: np.player.spells, collapsed: [...np.collapsed] } })
console.log('saved snapshot:', JSON.stringify(snap))
await page.close()
page = await boot(base)
const back = await page.evaluate(() => { const np = window.__np; return { loaded: np.loaded, x: np.player.x | 0, y: np.player.y | 0, gold: np.player.gold, hp: +np.player.hp.toFixed(3), wands: np.player.wands.map((w) => w.key + ':' + w.cards.join('/')), spells: np.player.spells, collapsed: [...np.collapsed], tip: document.getElementById('tip').textContent } })
console.log('after reload:', JSON.stringify(back))
console.log('MATCH:', back.loaded && back.gold === snap.gold && back.x === snap.x && back.y === snap.y && JSON.stringify(back.wands) === JSON.stringify(snap.wands) && JSON.stringify(back.spells) === JSON.stringify(snap.spells) && JSON.stringify(back.collapsed) === JSON.stringify(snap.collapsed))
await page.waitForTimeout(4000)
console.log('re-trigger after reload:', await page.evaluate(() => window.__np.collapses.length), 'terrain concrete persisted:', await page.evaluate(([ex]) => { const np = window.__np, cx = ex.x - 144, cy = ex.y + 70; let cc = 0; for (let y = cy - 180; y <= cy + 250; y += 2) for (let x = cx - 180; x <= cx + 180; x += 2) { const m = np.matAt(x, y); if ((np.mats.list[m]?.name || '') === 'concrete_collapsed') cc++ } return cc }, [ex]))
await page.screenshot({ path: `${out}/collapse-4-reload.png` })
// 清档
await page.evaluate(() => window.__np.clearSave())
await browser.close()
