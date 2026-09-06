// 调试:5 具尸体泡水 8s 后,逐具列出各部件 restT / 速度 / wetF / touching,看谁拖着整具不睡
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(url, { timeout: 120000, waitUntil: 'commit' })
await page.waitForFunction(() => window.__np && window.__np.player.onGround && window.__np.physics, null, { timeout: 90000 })
await page.waitForTimeout(800)
const r = await page.evaluate(async () => {
  const np = window.__np, pl = np.player, sim = np.sim, ent = np.entities, ph = np.physics, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const rock = np.mats.byName.get('rock_static'), water = np.mats.byName.get('water')
  const X0 = Math.floor(pl.x) - 200, X1 = X0 + 120, PY = Math.floor(pl.y) - 20
  for (let y = PY - 120; y < PY + 46; y++) for (let x = X0 - 10; x <= X1 + 10; x++) if (sim.get(x, y) > 0) sim.set(x, y, 0, 0)
  for (let y = PY; y < PY + 46; y++) for (let x = X0 - 6; x <= X1 + 6; x++) if (y >= PY + 40 || x < X0 || x > X1) sim.set(x, y, rock, 0)
  for (let y = PY + 6; y < PY + 40; y++) for (let x = X0; x <= X1; x++) sim.set(x, y, water, 0)
  np.cam.x = (X0 + X1) / 2; np.cam.y = PY - 10; pl.x = X1 + 30; pl.y = PY - 10; pl.vx = pl.vy = 0
  await wait(300)
  for (let i = 0; i < 5; i++) {
    const x = X0 + 20 + (i % 4) * 25
    const z = ent.spawnCreature('zombie', x, PY - 30)
    if (!z) continue
    await wait(150)
    ent.hurt(z, 9999, (X0 + 60 - x) * 2, -40, 'melee', z.x, z.y, null)
    await wait(300)
  }
  await wait(8000)
  const out = []
  const seen = new Set()
  for (const b of ent.bodies) {
    if (!b.isRagdoll || b.dead || !b.multi || seen.has(b.multi)) continue
    const M = b.multi; seen.add(M)
    out.push({ parts: M.parts.filter((q) => !q.dead).length, asleep: M.parts.filter((q) => q.asleep).length, wetT: M.wetT === undefined ? null : +(ent.time - M.wetT).toFixed(2), rows: M.parts.filter((q) => !q.dead && !q.asleep).map((q) => `r${q.restT.toFixed(1)} v${Math.hypot(q.vx, q.vy).toFixed(1)} w${q.w.toFixed(2)} wet${(q.wetF ?? -1).toFixed(2)} ${ph.touching(q) ? 'T' : '-'} ${q.pb.isAwake() ? 'A' : 'z'} n${q.n}`) })
  }
  return out
})
for (const g of r) { console.log(`corpse parts=${g.parts} asleep=${g.asleep} wetT=${g.wetT}`); for (const s of g.rows) console.log('   ', s) }
await browser.close()
