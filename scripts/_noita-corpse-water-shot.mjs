// 探针:几具尸体挤在一个水坑里 —— 用户反馈"尸体推在一起泡在水里一直动,fps 掉到 20"。
// 石槽 120×40 灌水,杀 N 只僵尸掉进去,12s 内每秒记:物理 ms、醒着的刚体数、实体 update / render ms、fps、尸块速度;
// 然后搅一下(推 10 块)看多久重新睡下;最后放水看浮睡的会不会醒过来掉到底
// 用法:node scripts/_noita-corpse-water-shot.mjs [url] [n=5] [prop]   给道具名(physics_box_harmless)就放道具代替尸体
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const N = +(process.argv[3] || 5)
const PROP = process.argv[4] || ''
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, deviceScaleFactor: 2, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack))
page.on('console', (m) => { if (m.text().startsWith('ERRSTACK')) console.log(m.text()) })
await page.addInitScript(() => { window.addEventListener('error', (e) => console.log('ERRSTACK', e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack)) })
await page.goto(url, { timeout: 120000, waitUntil: 'commit' })
await page.waitForFunction(() => window.__np && window.__np.player.onGround && window.__np.physics, null, { timeout: 90000 })
await page.waitForTimeout(800)
const r = await page.evaluate(async ([N, PROP]) => {
  const np = window.__np, pl = np.player, sim = np.sim, ent = np.entities, ph = np.physics, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const rock = np.mats.byName.get('rock_static'), water = np.mats.byName.get('water')
  // 槽:出生点左边 120 宽 40 深,壁厚 6
  const X0 = Math.floor(pl.x) - 200, X1 = X0 + 120, PY = Math.floor(pl.y) - 20
  for (let y = PY - 120; y < PY + 46; y++) for (let x = X0 - 10; x <= X1 + 10; x++) if (sim.get(x, y) > 0) sim.set(x, y, 0, 0)
  for (let y = PY; y < PY + 46; y++) for (let x = X0 - 6; x <= X1 + 6; x++) if (y >= PY + 40 || x < X0 || x > X1) sim.set(x, y, rock, 0)
  for (let y = PY + 6; y < PY + 40; y++) for (let x = X0; x <= X1; x++) sim.set(x, y, water, 0)
  const isPart = (b) => (PROP ? b.name === PROP : b.isRagdoll) && !b.dead && b.x > X0 - 20 && b.x < X1 + 20 && b.y > PY - 60
  np.cam.x = (X0 + X1) / 2; np.cam.y = PY - 10; pl.x = X1 + 30; pl.y = PY - 10; pl.vx = pl.vy = 0
  await wait(300)
  // 杀 N 只僵尸掉进水里(每只隔 300ms,击退朝槽中心)
  for (let i = 0; i < N; i++) {
    const x = X0 + 20 + (i % 4) * 25
    if (PROP) { ent.spawnProp(PROP, x, PY - 10); await wait(300); continue }
    const z = ent.spawnCreature('zombie', x, PY - 30)
    if (!z) continue
    await wait(150)
    ent.hurt(z, 9999, (X0 + 60 - x) * 2, -40, 'melee', z.x, z.y, null)
    await wait(300)
  }
  for (let k = 0; k < 30 && ent.pendingRagdolls.length; k++) await wait(100)
  // 包一层计时:实体 update / render(每帧累计,采样时取平均)
  const acc = { upd: 0, ren: 0, n: 0 }
  const u0 = ent.update.bind(ent), r0 = ent.render.bind(ent)
  ent.update = (...a) => { const t = performance.now(); const r = u0(...a); acc.upd += performance.now() - t; return r }
  ent.render = (...a) => { const t = performance.now(); const r = r0(...a); acc.ren += performance.now() - t; acc.n++; return r }
  // 12 秒采样
  const rows = []
  let frames = 0, raf = 0
  const tick = () => { frames++; raf = requestAnimationFrame(tick) }; tick()
  for (let s = 0; s < 12; s++) {
    const f0 = frames, t0 = performance.now()
    const ms = [], mst = []
    for (let i = 0; i < 20; i++) { await wait(50); ms.push(ph.stats.ms); mst.push(ph.stats.msStep) }
    const med = (a) => { a = a.slice().sort((x, y) => x - y); return +a[a.length >> 1].toFixed(2) }
    const parts = ent.bodies.filter(isPart)
    const awake = parts.filter((b) => !b.asleep && b.pb?.isAwake())
    const wet = parts.filter((b) => np.entities._liqDensity(Math.floor(b.x), Math.floor(b.y)) > 0).length
    const maxV = awake.reduce((m, b) => Math.max(m, Math.hypot(b.vx, b.vy)), 0)
    rows.push({ t: s + 1, fps: +((frames - f0) / ((performance.now() - t0) / 1000)).toFixed(0), phys: med(ms), step: med(mst), entUpd: +(acc.upd / Math.max(1, acc.n)).toFixed(2), entRen: +(acc.ren / Math.max(1, acc.n)).toFixed(2), parts: parts.length, awake: awake.length, floatS: parts.filter((b) => b.floatSleep === true).length, wet, b0: parts[0] ? [+parts[0].vx.toFixed(1), +parts[0].vy.toFixed(1), +parts[0].w.toFixed(2), +(parts[0].wetF ?? -1).toFixed(2), +parts[0].restT.toFixed(2)].join('/') : '', maxV: +maxV.toFixed(1), tiles: ph.stats.tiles, contacts: ph.world.getContactCount?.() ?? null })
    acc.upd = acc.ren = acc.n = 0
  }
  cancelAnimationFrame(raf)
  // 搅一下(玩家推尸体):挑 10 块给 40px/s 横向速度,每 0.5s 记醒着的数,看多久全部重新睡下
  const poke = ent.bodies.filter(isPart).slice(0, 10)
  for (const b of poke) if (b.pb) { if (b.asleep) b.wake(sim); b.pb.setAwake(true); b.vx = 40; b.vy = -20; ph.pushToPhysics(b) }
  const resettle = []
  for (let s = 0; s < 10; s++) { await wait(500); resettle.push(ent.bodies.filter(isPart).filter((b) => !b.asleep && b.pb?.isAwake()).length) }
  // 放水:槽底开口,水漏光 → 浮睡的尸块该醒过来掉到底、再睡进格子
  const before = ent.bodies.filter(isPart).map((b) => b.y)
  for (let y = PY + 40; y < PY + 46; y++) for (let x = X0 + 40; x <= X0 + 80; x++) sim.set(x, y, 0, 0)
  for (let y = PY + 46; y < PY + 200; y++) for (let x = X0 + 30; x <= X0 + 90; x++) if (sim.get(x, y) > 0) sim.set(x, y, 0, 0)
  await wait(6000)
  const parts = ent.bodies.filter(isPart)
  const wetN = parts.filter((b) => np.entities._liqDensity(Math.floor(b.x), Math.floor(b.y)) > 0).length
  const drain = { parts: parts.length, stillWet: wetN, fellAvg: +(parts.reduce((s, b, i) => s + (b.y - (before[i] ?? b.y)), 0) / Math.max(1, parts.length)).toFixed(1), gridAsleep: parts.filter((b) => b.asleep).length, planckAwake: parts.filter((b) => b.pb?.isAwake()).length, floatSleep: parts.filter((b) => b.floatSleep === true).length, inPit: parts.filter((b) => b.y > PY + 40).length }
  return { N, rows, resettle, drain, totalBodies: ent.bodies.length, ragdollParts: ent.bodies.filter((b) => b.isRagdoll && !b.dead).length }
}, [N, PROP])
console.table(r.rows)
console.log('resettle(awake per 0.5s)', JSON.stringify(r.resettle))
console.log('drain', JSON.stringify(r.drain), 'bodies', r.totalBodies, 'ragdollParts', r.ragdollParts)
await page.screenshot({ path: `${out}/corpse-water.png` })
await browser.close()
