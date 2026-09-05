// 探针:矿里 spawn_lamp 掷出来的小灯笼是真道具 —— 传送进煤矿,数 lights 表里带 ent 的灯与实际生成的 lantern_small 刚体;
//       挑一只挂着的打:第一发抠像素 → 起火 + 关节断(break_on_body_modified)→ 掉下来 → 砸地 / 血 0.15 碎 → 炸 + 洒油
// 用法:node scripts/_noita-lamp-shot.mjs [url]
import { chromium } from 'playwright'
import fs from 'fs'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, deviceScaleFactor: 2, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.player.onGround, null, { timeout: 90000 })
// 传送到煤矿中部,等周围 chunk 就位
await page.evaluate(() => { const np = window.__np; np.player.x = 300; np.player.y = 400; np.player.vx = 0; np.player.vy = 0; np.cam.x = 300; np.cam.y = 400; np.player.hp = 100; np.flags.god = true })
await page.waitForFunction(() => { const np = window.__np; for (let cx = 34; cx <= 36; cx++) for (let cy = 14; cy <= 15; cy++) if (!np.streamer.get(cx, cy)?.ready) return false; return true }, null, { timeout: 120000 })
await page.waitForTimeout(2500)
const zoom = async (file, wx, wy) => {
  const data = await page.evaluate(([wx, wy]) => {
    const np = window.__np, view = document.querySelector('canvas'), S = view.width / 427
    const cx = (wx - np.cam.x + 427 / 2) * S, cy = (wy - np.cam.y + 240 / 2) * S, w = 80 * S, h = 45 * S
    const cv = document.createElement('canvas'); cv.width = 80 * 8; cv.height = 45 * 8
    const c = cv.getContext('2d'); c.imageSmoothingEnabled = false
    c.drawImage(view, cx - w / 2, cy - h / 2, w, h, 0, 0, cv.width, cv.height)
    return cv.toDataURL('image/png')
  }, [wx, wy])
  fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'))
}
const r = await page.evaluate(async () => {
  const np = window.__np, pl = np.player, sim = np.sim, ent = np.entities, ps = np.projectiles, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const res = {}
  // lights 表里带 ent 的灯(去重)vs 实际的灯笼刚体
  const marks = new Map()
  for (const e of np.streamer.entries.values()) for (const l of e.lights || []) if (l.ent) marks.set(l.x + ',' + l.y, l)
  const lamps = ent.bodies.filter((b) => /lantern/.test(b.name) && !b.dead)
  res.marks = marks.size; res.bodies = lamps.length; res.hanging = lamps.filter((b) => b.ropes?.some((r) => !r.broken)).length
  res.sample = lamps.slice(0, 5).map((b) => ({ name: b.name, x: b.x | 0, y: b.y | 0, asleep: b.asleep, rope: b.ropes?.[0] ? { len: +b.ropes[0].len.toFixed(1), broken: b.ropes[0].broken, anchorSolid: ent._solid(Math.floor(b.ropes[0].ax), Math.floor(b.ropes[0].ay)) } : null, under: b.under?.length, light: b.light?.radius }))
  res.pendingProps = ent.pendingProps.length
  // 挑离玩家最近的一只挂着的灯,把人挪到它左下方 40px 的空位去打
  const hang = lamps.filter((b) => b.ropes?.some((r) => !r.broken)).sort((a, b) => Math.hypot(a.x - pl.x, a.y - pl.y) - Math.hypot(b.x - pl.x, b.y - pl.y))[0]
  if (!hang) return res
  const lx = hang.x, ly = hang.y
  const rock = np.mats.byName.get('rock_static')
  // 打枪的位置:灯正下方 34px 的空位,朝上打(中间清成空气,免得子弹打在石头上);再往下 6px 铺地,灯掉下来砸得着
  const sx = lx + 3, sy = ly + 34
  for (let j = ly + 8; j <= sy + 2; j++) for (let i = lx - 10; i <= lx + 10; i++) if (sim.get(i, j) > 0) sim.set(i, j, 0, 0)
  for (let j = sy + 3; j <= sy + 7; j++) for (let i = lx - 14; i <= lx + 14; i++) sim.set(i, j, rock, 0)
  pl.x = sx; pl.y = sy; pl.vx = 0; pl.vy = 0; np.cam.x = lx; np.cam.y = ly
  await wait(300)
  const F = sim.M_FIRE, OIL = np.mats.byName.get('oil')
  const count = (m, x, y, r) => { let n = 0; for (let j = y - r; j <= y + r; j++) for (let i = x - r; i <= x + r; i++) if (sim.get(i, j) === m) n++; return n }
  res.target = { name: hang.name, x: lx | 0, y: ly | 0, hp: hang.hp, asleep: hang.asleep, ropeLen: +hang.ropes[0].len.toFixed(1), anchor: [hang.ropes[0].ax, hang.ropes[0].ay] }
  let shots = 0, ropeAt = -1, fireAt = -1, deadAt = -1, lostAt = -1
  const ys = []
  for (let i = 0; i < 20 && !hang.dead; i++) {
    const ang = Math.atan2(hang.y - (pl.y - 10), hang.x - pl.x)
    ps.spawn('light_bullet', pl.x, pl.y - 10, ang, { owner: 'player' }); shots++
    await wait(150)
    ys.push(hang.y - ly | 0)
    if (lostAt < 0 && hang.alive < hang.n) lostAt = shots
    if (fireAt < 0 && count(F, lx | 0, ly | 0, 14) > 0) fireAt = shots
    if (ropeAt < 0 && hang.ropes.every((r) => r.broken)) ropeAt = shots
    if (hang.dead) { deadAt = shots; break }
  }
  await wait(1500)
  res.shoot = { shots, firstLostAt: lostAt, fireAt, ropeBrokenAt: ropeAt, deadAt, ys, fell: hang.dead ? 'dead' : (hang.y - ly) | 0, oilNow: count(OIL, lx | 0, (ly + 30) | 0, 40), fireNow: count(F, lx | 0, (ly + 20) | 0, 40) }
  res.lampPos = [lx, ly]
  return res
})
console.log(JSON.stringify(r, null, 1))
if (r.lampPos) await zoom(`${out}/lamp-z.png`, r.lampPos[0], r.lampPos[1] + 10)
await page.screenshot({ path: `${out}/lamp.png` })
await browser.close()
