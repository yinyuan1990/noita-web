// 探针:矿洞"大蜘蛛" Äitinuljaska(animals/giantshooter_weak)—— 飘着追人 / 触手 / 绿光 / 打到 hp<0.3 分裂 3 只 slimeshooter / 打漏酸 / 死了炸出酸池
// 用法:node scripts/_noita-giantshooter-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.player.onGround, null, { timeout: 120000 })
await page.waitForTimeout(800)
const shot = (n) => page.screenshot({ path: `${process.env.TEMP}/gs-${n}.png`, clip: { x: 427 - 60, y: 240 - 160, width: 320, height: 240 } })
const r1 = await page.evaluate(async () => {
  const np = window.__np, pl = np.player, E = np.entities
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const ox = Math.round(pl.x), oy = Math.round(pl.y)
  for (let y = oy - 90; y < oy + 30; y++) for (let x = ox - 120; x < ox + 120; x++) np.sim.set(x, y, 0)
  const rock = np.mats.byName.get('rock_static')
  for (let y = oy + 30; y < oy + 60; y++) for (let x = ox - 120; x < ox + 120; x++) np.sim.set(x, y, rock, 0)
  pl.x = ox - 60; pl.y = oy + 28; pl.vx = 0; pl.vy = 0
  const g = E.spawnCreature('giantshooter_weak', ox + 20, oy - 30)
  await wait(1200)
  return { def: { hp: g.d.damage.hp, fly: g.d.ai.can_fly, light: g.d.light, inv: g.d.inventory, explode: !!g.d.explode, scripts: g.d.scripts, split: g.d.splitBelow, tentacles: g.d.tentacles?.map((t) => t.points) }, state: g.state, pos: [g.x - ox | 0, g.y - oy | 0], vel: [g.vx | 0, g.vy | 0], hp: g.hp, maxHp: g.maxHp, anim: g.anim, tents: g.tents?.map((c) => ({ len: +Math.hypot(c.pts.at(-1).x - c.pts[0].x, c.pts.at(-1).y - c.pts[0].y).toFixed(1), down: c.pts.at(-1).y > c.pts[0].y })), inventory: g.inventory }
})
console.log('spawn', JSON.stringify(r1))
await shot('idle')
const r2 = await page.evaluate(async () => {
  const np = window.__np, E = np.entities
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const g = E.list.find((e) => e.name === 'giantshooter_weak')
  const near = () => E.list.filter((e) => !e.dead && e.name === 'slimeshooter' && Math.hypot(e.x - g.x, e.y - g.y) < 60).length
  const before = near()
  const acid = np.mats.byName.get('acid')
  const count = (m) => { let n = 0; for (let y = g.y - 80; y < g.y + 80; y++) for (let x = g.x - 120; x < g.x + 120; x++) if (np.sim.get(x, y) === m) n++; return n }
  const acid0 = count(acid)
  E.hurt(g, g.hp - 0.2, 30, 0, 'proj', g.x, g.y) // 打到剩 0.2(<0.3)→ 分裂
  await wait(600)
  return { hpAfter: g.hp, slimeshootersNearBefore: before, slimeshootersNearAfter: near(), acidLeaked: count(acid) - acid0, invLeft: g.inventory?.[0]?.left }
})
console.log('split', JSON.stringify(r2))
await shot('split')
const r3 = await page.evaluate(async () => {
  const np = window.__np, E = np.entities
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const g = E.list.find((e) => e.name === 'giantshooter_weak')
  const acid = np.mats.byName.get('acid'), rock = np.mats.byName.get('rock_static')
  const gx = g.x, gy = g.y
  const count = (m) => { let n = 0; for (let y = gy - 80; y < gy + 80; y++) for (let x = gx - 120; x < gx + 120; x++) if (np.sim.get(x, y) === m) n++; return n }
  const rock0 = count(rock)
  const ex0 = np.projectiles.explosions?.length ?? -1
  E.hurt(g, 99, 0, 0, 'proj', g.x, g.y)
  await wait(900)
  return { dead: g.dead, fx: g.ragdollFx, acidCells: count(acid), rockLost: rock0 - count(rock), ragdolls: E.ragdolls.length, bodies: E.bodies.filter((b) => !b.dead).length }
})
console.log('death', JSON.stringify(r3))
await shot('death')
await browser.close()
