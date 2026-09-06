// 探针:走远了刚体会不会回收 —— 出生地 → 传送到矿里 2500px 深 → 再传回来,每步记 bodies 数 / planck body 数 / stats.evicted / 尸块数
// 用法:node scripts/_noita-evict-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, deviceScaleFactor: 2, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(url, { timeout: 120000, waitUntil: 'commit' })
await page.waitForFunction(() => window.__np && window.__np.player.onGround && window.__np.physics, null, { timeout: 90000 })
await page.waitForTimeout(1500)
const r = await page.evaluate(async () => {
  const np = window.__np, pl = np.player, ent = np.entities, ph = np.physics, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const snap = (tag) => { let pb = 0; for (let b = ph.world.getBodyList(); b; b = b.getNext()) pb++; return { tag, bodies: ent.bodies.length, planck: pb, evicted: ent.stats.evicted || 0, ragdoll: ent.bodies.filter((b) => b.isRagdoll && !b.dead).length, items: ent.bodies.filter((b) => b.isItem).length, x: Math.round(pl.x), y: Math.round(pl.y), chunks: ent.liveChunks.size } }
  const out = []
  const X = pl.x, Y = pl.y
  // 出生地杀两只留尸体
  for (let i = 0; i < 2; i++) { const z = ent.spawnCreature('zombie', X - 60 + i * 30, Y - 20); if (z) { await wait(150); ent.hurt(z, 9999, 30, -30, 'melee', z.x, z.y, null) } }
  await wait(3000)
  out.push(snap('home'))
  const go = async (x, y) => { pl.x = x; pl.y = y; pl.vx = pl.vy = 0; np.cam.x = x; np.cam.y = y; await wait(9000) }
  await go(X, Y + 1400); out.push(snap('mine 1400'))
  await go(X, Y + 2800); out.push(snap('mine 2800'))
  await go(X + 1500, Y + 2800); out.push(snap('mine 2800 +1500'))
  await go(X, Y); out.push(snap('back home'))
  return out
})
console.table(r)
await browser.close()
