// 探针:Box2D(planck)第 ① 步 —— 地形碰撞。`?physTest=1` 在出生点上方丢 6 箱 / 2 圆 / 1 板,3s 后全部应落在真实地形上入睡;
// 再在一个箱子脚下砌一块石台 → 脚下挖空 → 它应醒来掉下去(地形块按 CellSim.tver 重建 + 叫醒压着的刚体);统计地形块数 / 顶点数 / 每帧耗时。
// 用法:node scripts/_noita-box2d-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1&physTest=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, deviceScaleFactor: 2, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url, { timeout: 120000, waitUntil: 'commit' }) // 线上 27MB 冷缓存首屏慢
await page.waitForFunction(() => window.__np && window.__np.player.onGround && window.__np.physics, null, { timeout: 90000 })
await page.waitForTimeout(400)
await page.screenshot({ path: `${out}/box2d-0.png` })
const r = await page.evaluate(async () => {
  const np = window.__np, ph = np.physics, sim = np.sim, pl = np.player, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const res = {}
  const groundY = (x, y0) => { for (let y = Math.floor(y0); y < y0 + 400; y++) if (sim.solidB(Math.floor(x), y)) return y; return null }
  // ① 3.5s 后测试刚体状态:全部睡着、底面贴着地面(箱子中心到脚下第一格实心 ≈ 半高 ± 0.5)
  await wait(3500)
  const st = ph.testState()
  res.bodies = st.map((s, i) => { const b = ph.testBodies[i], ud = b.getUserData(); const half = ud.r || ud.h / 2; const gy = groundY(s.x, s.y); return { ...s, gapToGround: gy === null ? null : +(gy - (s.y + (ud.r ? ud.r : Math.abs(Math.cos(s.rot)) * ud.h / 2 + Math.abs(Math.sin(s.rot)) * ud.w / 2))).toFixed(2), half } })
  res.asleep = st.filter((s) => !s.awake).length
  let verts = 0; for (const t of ph.tiles.values()) verts += t.verts
  res.terrain = { tiles: ph.stats.tiles, built: ph.stats.built, verts, msLast: +ph.stats.ms.toFixed(3) }
  // ② 石台 + 挖空:在玩家左上方空中砌 40×6 石台,丢一个箱子上去,睡着后把石台挖掉 → 箱子应醒来掉到下面
  const rock = np.mats.byName.get('rock_static'), PX = Math.floor(pl.x) - 120, PY = Math.floor(pl.y) - 60
  for (let y = PY - 60; y < PY; y++) for (let x = PX; x < PX + 40; x++) if (sim.get(x, y) > 0) sim.set(x, y, 0, 0)
  for (let y = PY; y < PY + 6; y++) for (let x = PX; x < PX + 40; x++) sim.set(x, y, rock, 0)
  const b = ph.addTestBox(PX + 20, PY - 30, 8, 8)
  await wait(2500)
  const p1 = b.getPosition(), before = { y: +(p1.y * 6).toFixed(2), awake: b.isAwake(), platformTop: PY }
  for (let y = PY; y < PY + 6; y++) for (let x = PX; x < PX + 40; x++) sim.set(x, y, 0, 0)
  await wait(400) // 睡着刚体的地形块每 20 帧查一次(≤333ms)
  const midAwake = b.isAwake()
  await wait(2500)
  const p2 = b.getPosition()
  res.dig = { before, wokeWithin400ms: midAwake, after: { y: +(p2.y * 6).toFixed(2), awake: b.isAwake(), groundBelow: groundY(p2.x * 6, p2.y * 6) } }
  // ③ 真道具(第 ② 步):石台上叠 5 个木箱 + 一张桌子 + 一个油桶
  const ent = np.entities
  // 石台放高空(离土坡 200px,别让流沙 / 滴水搅进来);油桶放到台子另一头(它要是滚下去摔碎,油烧起来会把箱子泡在液体里 —— 泡着的刚体每帧吃浮力永远睡不着)
  const PX2 = Math.floor(pl.x) + 130, PY2 = Math.floor(pl.y) - 240
  for (let y = PY2 - 130; y < PY2 + 8; y++) for (let x = PX2 - 60; x < PX2 + 100; x++) if (sim.get(x, y) > 0) sim.set(x, y, 0, 0)
  for (let y = PY2; y < PY2 + 6; y++) for (let x = PX2 - 50; x < PX2 + 90; x++) sim.set(x, y, rock, 0)
  for (let i = 0; i < 5; i++) ent.spawnProp('physics_box_harmless', PX2, PY2 - 8 - i * 12) // 11px 的木箱(不带 ExplodeOnDamage;physics_crate 被爆炸挖掉像素会连锁炸掉),紧挨着叠
  ent.spawnProp('furniture_table', PX2 + 45, PY2 - 40)
  ent.spawnProp('physics_barrel_oil', PX2 + 75, PY2 - 30)
  await wait(400)
  const near = (b) => Math.abs(b.x - PX2) < 160 && Math.abs(b.y - PY2) < 300 // 只看我们放的(矿里 / 别处的同名道具不算)
  const crates = ent.bodies.filter((b) => b.name === 'physics_box_harmless' && near(b)), table = ent.bodies.find((b) => b.name === 'furniture_table' && near(b)), barrel = ent.bodies.find((b) => b.name === 'physics_barrel_oil' && near(b))
  res.props = { crates: crates.length, onPlanck: crates.filter((b) => !!b.pb).length, fixtures: crates.map((b) => { let n = 0; for (let f = b.pb?.getFixtureList(); f; f = f.getNext()) n++; return n }), tableFixtures: (() => { let n = 0; for (let f = table?.pb?.getFixtureList(); f; f = f.getNext()) n++; return n })(), tableMass: table?.pb ? +table.pb.getMass().toFixed(2) : null }
  await wait(6500) // 最底下那箱落在有一粒土的台面上会歪 3° 带着整摞摇几秒(Box2D 真实行为),给够时间
  const ys = crates.map((b) => +b.y.toFixed(1)).sort((a, b) => a - b)
  const gaps = []; for (let i = 1; i < ys.length; i++) gaps.push(+(ys[i] - ys[i - 1]).toFixed(1))
  res.stack = { ys, gaps, expectedGap: crates[0]?.h0, asleep: crates.filter((b) => b.asleep).length, gridCells: crates.filter((b) => b.cells).length, rots: crates.map((b) => +b.rot.toFixed(2)), vs: crates.map((b) => +Math.hypot(b.vx, b.vy).toFixed(3)), pbAwake: crates.filter((b) => b.pb?.isAwake()).length, platformTop: PY2 }
  res.table = table ? { pb: !!table.pb, ropes: !!table.ropes, y: +table.y.toFixed(1), rot: +table.rot.toFixed(3), asleep: table.asleep, bottomGap: +(PY2 - (table.y + table.h0 / 2)).toFixed(2) } : null
  res.barrel = barrel ? { pb: !!barrel.pb, y: +barrel.y.toFixed(1), rot: +barrel.rot.toFixed(2), asleep: barrel.asleep, bottomGap: +(PY2 - (barrel.y + barrel.h0 / 2)).toFixed(2) } : null
  // ④ 打掉最上面木箱的像素 → 醒 + fixtures 重建;再在旁边炸一下 → 箱子飞散互相弹开
  const top = crates.slice().sort((a, b) => a.y - b.y)[0]
  if (top) {
    const alive0 = top.alive
    if (top.asleep) top.wake(sim)
    top.carve(top.x - top.w0 / 2 + 2, top.y - top.h0 / 2 + 2, 3)
    np.physics.pushToPhysics(top)
    let n = 0; for (let f = top.pb.getFixtureList(); f; f = f.getNext()) n++
    res.carve = { lost: alive0 - top.alive, fixturesAfter: n, awake: top.pb.isAwake(), mass: +top.pb.getMass().toFixed(2) }
  }
  // 抛飞用石头(rock_box2d 没 hp、不炸):爆炸会把半径内刚体像素抠掉(原版同),r14 的爆心离石头 20px 只抠一小角
  const BX = PX2 - 30, BY = PY2 - 8
  for (let i = 0; i < 3; i++) ent.spawnProp('physics_stone_0' + (i + 1), BX + 15 + i * 14, PY2 - 10)
  await wait(1500)
  const stones = ent.bodies.filter((b) => /^physics_stone/.test(b.name) && near(b))
  const pos0 = stones.map((b) => [b.x, b.y])
  np.projectiles.explode(BX, BY, { radius: 18, damage: 0.01, shake: 0, hole: false, holeLiquid: false, rayEnergy: 1e6, maxDurability: 0, power: [1.5, 2.2], knockback: 1 })
  await wait(80)
  const vAfter = stones.map((b) => b.pb ? +Math.hypot(b.vx, b.vy).toFixed(0) : null)
  await wait(1500)
  res.blast = { stones: stones.length, alive: stones.filter((b) => !b.dead).length, vAfter80ms: vAfter, moved: stones.map((b, i) => +Math.hypot(b.x - pos0[i][0], b.y - pos0[i][1]).toFixed(1)), minPairDist: (() => { let m = 999; for (let i = 0; i < stones.length; i++) for (let j = i + 1; j < stones.length; j++) m = Math.min(m, Math.hypot(stones[i].x - stones[j].x, stones[i].y - stones[j].y)); return +m.toFixed(1) })() }
  // ⑤ 帧耗时:采 60 帧
  const ms = []; for (let i = 0; i < 60; i++) { await wait(16); ms.push(ph.stats.ms) }
  ms.sort((a, b) => a - b)
  res.perf = { p50: +ms[30].toFixed(3), p95: +ms[57].toFixed(3), max: +ms[59].toFixed(3), tiles: ph.stats.tiles, bodies: ph.stats.bodies, awake: ph.stats.awake, entBodies: ent.bodies.length }
  return res
})
console.log(JSON.stringify(r, null, 1))
await page.screenshot({ path: `${out}/box2d-1.png` })
await browser.close()
