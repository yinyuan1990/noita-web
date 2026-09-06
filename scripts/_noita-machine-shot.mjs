// 探针:挖掘场机械 excavationsite_machine_3b / 3c —— 机身 is_static 钉住,电机轮在关节位转(12 / -5 / 10 rad/s;3c 22 rad/s)。相机对着机器截图
// 用法:node scripts/_noita-machine-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1&physDraw=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, deviceScaleFactor: 2, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url, { timeout: 120000, waitUntil: 'commit' })
await page.waitForFunction(() => window.__np && window.__np.player.onGround && window.__np.physics, null, { timeout: 90000 })
await page.waitForTimeout(500)
const r = await page.evaluate(async () => {
  const np = window.__np, sim = np.sim, pl = np.player, ent = np.entities, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const rock = np.mats.byName.get('rock_static')
  const PX = Math.floor(pl.x) + 40, PY = Math.floor(pl.y) - 240
  for (let y = PY - 200; y < PY + 10; y++) for (let x = PX - 200; x < PX + 200; x++) if (sim.get(x, y) > 0) sim.set(x, y, 0, 0)
  for (let y = PY; y < PY + 8; y++) for (let x = PX - 200; x < PX + 200; x++) sim.set(x, y, rock, 0)
  np.cam.x = PX; np.cam.y = PY - 90; pl.x = PX - 190; pl.y = PY - 10; pl.vx = pl.vy = 0
  np.cam.lock = true
  // 3b 左、3c 右;机身 150×125,左上角 = 实体;放得让机身底(y+124)贴台面
  const A = [PX - 170, PY - 125], B = [PX + 20, PY - 125]
  ent.spawnProp('excavationsite_machine_3b', A[0], A[1])
  ent.spawnProp('excavationsite_machine_3c', B[0], B[1])
  await wait(800)
  const info = (name, O) => {
    const parts = ent.bodies.filter((b) => b.name === name)
    const frame = parts.find((b) => b.isStatic), wheels = parts.filter((b) => !b.isStatic)
    return { parts, frame, wheels, O }
  }
  const g3b = info('excavationsite_machine_3b', A), g3c = info('excavationsite_machine_3c', B)
  const rot0 = [...g3b.wheels, ...g3c.wheels].map((w) => w.rot)
  await wait(1000)
  const rot1 = [...g3b.wheels, ...g3c.wheels].map((w) => w.rot)
  const rep = (g, i0) => ({
    parts: g.parts.length, joints: g.frame?.multi.joints.length, frameStatic: g.frame?.pb.isStatic(), frameAt: g.frame ? [+(g.frame.x - g.O[0]).toFixed(1), +(g.frame.y - g.O[1]).toFixed(1)] : null,
    // 轮心 = 关节锚点(bbox 中心):世界 − 实体 应 ≈ 3b (35.5,64.5)(93.5,37.5)(82.5,89.5) / 3c (82.5,76.5)
    wheelCenter: g.wheels.map((w) => { const P = [0, 0]; let sx = 0, sy = 0; for (let k = 0; k < w.n; k++) { w.worldOf(k, P); sx += P[0]; sy += P[1] } return [+(sx / w.n - g.O[0]).toFixed(1), +(sy / w.n - g.O[1]).toFixed(1)] }),
    spin1s: g.wheels.map((w, i) => +(rot1[i0 + i] - rot0[i0 + i]).toFixed(2)), w: g.wheels.map((w) => +w.w.toFixed(2)), pbW: g.wheels.map((w) => +w.pb.getAngularVelocity().toFixed(2)),
    awake: g.parts.map((b) => !!b.pb?.isAwake()), motor: g.frame?.multi.joints.map((J) => [J.j.isMotorEnabled(), J.j.getMotorSpeed(), +J.j.getMaxMotorTorque().toFixed(0), +J.j.getJointSpeed().toFixed(2)]),
    massB: g.wheels.map((w) => +w.pb.getMass().toFixed(2)),
  })
  const res = { m3b: rep(g3b, 0), m3c: rep(g3c, g3b.wheels.length) }
  // 轮子挨着台面吗(3b 机身 125 高,轮子最低 y 100 → 台面在 125:不该碰)
  res.touch3b = g3b.wheels.map((w) => np.physics.touching(w))
  await wait(400)
  const ms = []; for (let i = 0; i < 60; i++) { await wait(16); ms.push(np.physics.stats.ms) }
  ms.sort((a, b) => a - b)
  res.perf = { p50: +ms[30].toFixed(2), p95: +ms[57].toFixed(2), bodies: np.physics.stats.bodies, awake: np.physics.stats.awake }
  return res
})
console.log(JSON.stringify(r, null, 1))
await page.screenshot({ path: `${out}/machine.png` })
await browser.close()
