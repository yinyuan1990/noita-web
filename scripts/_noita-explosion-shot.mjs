// 探针:爆炸(反 exe 后的规则)—— 火球挖不动岩石只挖土;炸弹被钢挡;伤害无衰减但要射线够得到(墙后没伤害);液体被抛飞
// 用法:node scripts/_noita-explosion-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForFunction(() => { const np = window.__np; for (let cx = 34; cx <= 36; cx++) for (let cy = 13; cy <= 14; cy++) if (!np.streamer.get(cx, cy)) return false; return true }, null, { timeout: 120000 })
await page.waitForFunction(() => window.__np.player.onGround, null, { timeout: 30000 })
await page.waitForTimeout(500)
const r = await page.evaluate(() => {
  const np = window.__np, P = np.projectiles, pl = np.player, M = np.mats.byName
  const rock = M.get('rock_static'), soil = M.get('soil'), steel = M.get('steel_static'), water = M.get('water')
  const fill = (x0, y0, w, h, m) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) np.sim.set(x, y, m, 0) }
  const count = (x0, y0, w, h, m) => { let n = 0; for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (np.sim.get(x, y) === m) n++; return n }
  const res = {}
  // 1. 火球炸岩石 vs 炸土(各 60×60 实心块,炸在块中心)
  const bx = Math.round(pl.x) - 330, by = Math.round(pl.y) - 160
  fill(bx - 30, by - 30, 60, 60, rock); fill(bx + 70, by - 30, 60, 60, soil)
  const fb = P.defs.fireball.explosion
  P.explode(bx, by, fb); P.explode(bx + 100, by, fb)
  res.fireball = { rayE: fb.rayEnergy, r: fb.radius, rockDug: 3600 - count(bx - 30, by - 30, 60, 60, rock), soilDug: 3600 - count(bx + 70, by - 30, 60, 60, soil) }
  // 2. 炸弹炸岩石(应挖满 r60 的圆 ≈ 11300 格)vs 钢(durability 12 > 11,应一格不掉)
  const cx = bx + 240
  fill(cx - 70, by - 70, 140, 140, rock)
  const bomb = P.defs.bomb.explosion
  const rock0 = count(cx - 70, by - 70, 140, 140, rock)
  P.explode(cx, by, bomb)
  res.bombRock = { r: bomb.radius, filled: rock0, dug: rock0 - count(cx - 70, by - 70, 140, 140, rock), power: bomb.power, kb: bomb.knockback }
  const sx = cx + 160
  fill(sx - 70, by - 70, 140, 140, steel)
  const steel0 = count(sx - 70, by - 70, 140, 140, steel)
  P.explode(sx, by, bomb)
  res.bombSteel = { filled: steel0, dug: steel0 - count(sx - 70, by - 70, 140, 140, steel) }
  // 3. 伤害遮挡:空地里放炸弹中心,僵尸 A 在右 30px 空地,僵尸 B 在左 30px、中间隔 4px 钢墙
  const dx0 = bx + 100, dy0 = by + 200
  for (let y = dy0 - 80; y < dy0 + 80; y++) for (let x = dx0 - 120; x < dx0 + 120; x++) np.sim.set(x, y, 0)
  fill(dx0 - 120, dy0 + 20, 240, 6, rock) // 地板
  fill(dx0 - 15, dy0 - 40, 4, 60, steel)  // 钢墙
  const zA = np.entities.spawnCreature('zombie', dx0 + 30, dy0 + 10), zB = np.entities.spawnCreature('zombie', dx0 - 30, dy0 + 10)
  const hpA = zA.hp, hpB = zB.hp
  P.explode(dx0, dy0, bomb)
  res.los = { dmg: bomb.damage, A: { hp0: hpA, hp: +zA.hp.toFixed(2), dead: zA.dead, vx: zA.vx | 0 }, B: { hp0: hpB, hp: +zB.hp.toFixed(2), dead: zB.dead } }
  // 4. 液体被抛飞:水池上炸小爆炸,水应该少一截但不是消失(碎屑落回来)
  const wx = dx0 + 300, wy = dy0
  for (let y = wy - 60; y < wy + 30; y++) for (let x = wx - 60; x < wx + 60; x++) np.sim.set(x, y, 0)
  fill(wx - 60, wy + 20, 120, 6, rock); fill(wx - 40, wy, 80, 20, water)
  const w0 = count(wx - 60, wy - 60, 120, 90, water)
  P.explode(wx, wy + 10, P.defs.grenade.explosion)
  res.water = { before: w0, after: count(wx - 60, wy - 60, 120, 90, water), debris: window.__np.debris?.length }
  return res
})
console.log(JSON.stringify(r, null, 1))
await page.waitForTimeout(1500)
const r2 = await page.evaluate(() => { const np = window.__np, M = np.mats.byName, water = M.get('water'); return { debrisLeft: np.debris?.length } })
console.log('after 1.5s', JSON.stringify(r2))
await browser.close()
