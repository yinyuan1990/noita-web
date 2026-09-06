// 探针:灯笼(physics_lantern_small)—— 子弹打中:抠像素 → physics_lantern_damaged 起火 + 漏油;钉子处像素没了 → 掉下来;砸地 >120 → 碎 → 炸 + 洒油
//       另:怪物不会卡在石头里(生成点实心就不出,埋进石头 3s 撤掉)
// 用法:node scripts/_noita-lantern-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, deviceScaleFactor: 2, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.player.onGround, null, { timeout: 90000 })
await page.waitForTimeout(1500)
const r = await page.evaluate(async () => {
  const np = window.__np, pl = np.player, sim = np.sim, ent = np.entities, ps = np.projectiles, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const res = {}
  const F = sim.M_FIRE, OIL = np.mats.byName.get('oil')
  const count = (m, x, y, r) => { let n = 0; for (let j = y - r; j <= y + r; j++) for (let i = x - r; i <= x + r; i++) if (sim.get(i, j) === m) n++; return n }
  // 挂一只小灯笼在人右前方 40px、高 36px 的空中(钉子锚在生成点)
  const lx = pl.x + 40, ly = pl.y - 36
  const LN = 'physics_lantern' // 大灯笼 hp 0.9:看"打中 → 起火 + 漏油 → 打几下才碎"的过程;小的 0.15 血一发就碎
  // 先搭一块顶(钉子 pos_y=-2 钉在图顶上方 2px 的墙里),不然没墙钉、关节立刻断、掉下去砸碎 —— 那是另一条正确路径
  { const rock = np.mats.byName.get('rock_static'); for (let j = ly - 14; j <= ly - 8; j++) for (let i = lx - 12; i <= lx + 12; i++) sim.set(i, j, rock, 0) }
  ent.spawnProp(LN, lx, ly)
  await wait(400)
  const b = ent.bodies.find((x) => x.name === LN && Math.abs(x.x - lx) < 20 && Math.abs(x.y - ly) < 20)
  if (!b) return { err: 'no lantern body' }
  // Box2D 版:钉子是 planck 的 ground revolute(b.multi.joints),ropes 是旧求解器的
  const hung = () => (b.multi ? b.multi.joints.length > 0 : !!b.ropes?.some((r) => !r.broken))
  res.lantern = { hp: b.hp, planck: !!b.pb, joints: b.multi?.joints.length, ropes: b.ropes?.length, nailed: b.nailed, w0: b.w0, h0: b.h0, alive: b.alive, collision: b.d.collisionDamage, hung: hung() }
  res.fire0 = count(F, lx | 0, ly | 0, 12); res.oil0 = count(OIL, lx | 0, ly | 0, 30)
  // 朝它打火花弹,直到起火 / 掉下来 / 碎(最多 40 发)
  let firstFireAt = -1, broken = -1, dead = -1, shots = 0
  const hps = []
  for (let i = 0; i < 40 && !b.dead; i++) {
    // 瞄准加 ±1.5px 抖动:像素级完全相同的弹道会从前两发抠出的 3px 通道里穿过去(真实玩家 / 原版都不会)
    // 实际弹道比瞄准线低 ~5°(出生点 / 散射),一直擦灯笼底边 → 瞄准点抬 4px 打到框身
    const ang = Math.atan2(b.y - 4 - (pl.y - 4) + (Math.random() - 0.5) * 3, b.x - pl.x + (Math.random() - 0.5) * 3)
    ps.spawn('light_bullet', pl.x + 6, pl.y - 4, ang, { owner: 'player' }); shots++
    await wait(120)
    hps.push(+b.hp.toFixed(2))
    if (firstFireAt < 0 && count(F, b.x | 0, b.y | 0, 14) > 0) firstFireAt = shots
    if (res.firstLostAt === undefined && b.alive < b.n) res.firstLostAt = shots
    if (res.firstOilAt === undefined && count(OIL, b.x | 0, (b.y + 10) | 0, 24) > 0) res.firstOilAt = shots
    if (broken < 0 && !hung()) broken = shots
    if (b.dead) { dead = shots; break }
  }
  await wait(1200)
  res.result = { shots, hps: hps.slice(0, 12), firstFireAtShot: firstFireAt, ropeBrokenAtShot: broken, deadAtShot: dead, alive: b.alive, lostFrac: +(1 - b.alive / b.n).toFixed(2), fellTo: b.dead ? null : (b.y - ly) | 0, oilNow: count(OIL, lx | 0, (ly + 30) | 0, 40), fireNow: count(F, lx | 0, (ly + 20) | 0, 40), burningCells: (() => { let n = 0; for (let j = ly - 10; j < ly + 60; j++) for (let i = lx - 40; i < lx + 40; i++) if (sim.aux(i, j)) n++; return n })() }
  // 怪:把一只怪硬塞进石头里,3s 后应被撤掉;生成点实心 → 不出
  const rock = np.mats.byName.get('rock_static')
  const gx = pl.x - 60, gy = pl.y - 40
  for (let j = gy - 20; j < gy + 20; j++) for (let i = gx - 20; i < gx + 20; i++) sim.set(i, j, rock, 0)
  await wait(100)
  const before = ent.list.length
  const e = ent.spawnCreature('zombie', gx, gy)
  res.spawnInRock = { spawned: !!e, listDelta: ent.list.length - before, skipped: ent.stats.spawnSkipped || 0 }
  // 先正常生成再把石头填上(= 被封进去)
  const e2 = ent.spawnCreature('zombie', pl.x + 80, pl.y - 6)
  if (e2) { for (let j = Math.floor(e2.y) - 12; j < Math.floor(e2.y) + 6; j++) for (let i = Math.floor(e2.x) - 8; i < Math.floor(e2.x) + 8; i++) sim.set(i, j, rock, 0) }
  res.sealed0 = e2 ? { pos: [e2.x | 0, e2.y | 0], box: e2.box, buried: ent._buried(e2, e2.x, e2.y), center: np.mats.name(sim.get(Math.floor(e2.x), Math.floor(e2.y + (e2.box.t + e2.box.b) / 2))) } : null
  await wait(600)
  res.sealed1 = e2 ? { pos: [e2.x | 0, e2.y | 0], buriedT: e2.buriedT, buried: ent._buried(e2, e2.x, e2.y) } : null
  await wait(3000)
  res.sealed = { had: !!e2, stillAlive: e2 ? !e2.dead : null, removed: ent.stats.unstuckRemoved || 0, buriedT: e2?.buriedT, pos: e2 ? [e2.x | 0, e2.y | 0] : null, center: e2 ? np.mats.name(sim.get(Math.floor(e2.x), Math.floor(e2.y + (e2.box.t + e2.box.b) / 2))) : null, state: e2?.state, flyer: e2?.flyer }
  return res
})
console.log(JSON.stringify(r, null, 1))
await page.screenshot({ path: `${out}/lantern.png` })
await browser.close()
