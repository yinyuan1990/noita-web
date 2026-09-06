// 探针:Box2D 第 ④ 步 —— 关节 / 多体。高空石台上放 矿车 / 滑板 / 轮架 / 物理蘑菇 / 桌子 / 钉墙轮:
// 部件数 + 关节数;推矿车 → 轮子转、车身跟着走;轮架的轮按电机转;蘑菇立着(脚钉地);炸蘑菇 → 关节断倒下;整组一起睡进格子、挖脚下整组醒。
// 用法:node scripts/_noita-box2d-joint-shot.mjs [url]
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
  const np = window.__np, ph = np.physics, sim = np.sim, pl = np.player, ent = np.entities, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const res = {}
  const rock = np.mats.byName.get('rock_static')
  // 高空石台 200px 宽
  const PX = Math.floor(pl.x) + 40, PY = Math.floor(pl.y) - 240
  for (let y = PY - 140; y < PY + 10; y++) for (let x = PX - 110; x < PX + 110; x++) if (sim.get(x, y) > 0) sim.set(x, y, 0, 0)
  for (let y = PY; y < PY + 8; y++) for (let x = PX - 100; x < PX + 100; x++) sim.set(x, y, rock, 0)
  // 把相机挪过去看
  np.cam.x = PX; np.cam.y = PY - 40; pl.x = PX - 95; pl.y = PY - 10; pl.vx = pl.vy = 0
  const spawned = {}
  const put = (name, x, y) => { ent.spawnProp(name, x, y); spawned[name] = [x, y] }
  put('minecart', PX - 85, PY - 30) // 重力 60 下车会慢慢滚,别让它滚到滑板上(压在别的物体上算有支撑,挖台面不会醒)
  put('furniture_table', PX - 40, PY - 80)
  put('physics_skateboard', PX, PY - 30)
  put('physics_wheel_stand_01', PX + 45, PY - 60)
  put('physics_fungus', PX + 88, PY - 1) // 标记点放在地面上(lua spawn 就这么放),init_offset_y=40 把整株抬上去,脚落在台面、锚点往下 30px 找地
  await wait(600)
  const near = (b, n) => b.name === n && spawned[n] && Math.abs(b.x - spawned[n][0]) < 80 && Math.abs(b.y - spawned[n][1]) < 200
  const groups = {}
  for (const n of Object.keys(spawned)) {
    const parts = ent.bodies.filter((b) => near(b, n))
    const M = parts[0]?.multi
    groups[n] = { parts: parts.length, multi: !!M, joints: M ? M.joints.length : 0, groundJoints: M ? M.joints.filter((J) => !J.B).length : 0, circles: parts.filter((b) => b.isCircle).length, onPlanck: parts.filter((b) => !!b.pb).length }
  }
  res.groups = groups
  const cartM = ent.bodies.find((b) => near(b, 'minecart'))?.multi
  const jl = []
  for (let i = 0; i < 6; i++) { await wait(500); jl.push(cartM ? cartM.joints.length : -1) }
  res.cartJointTimeline = jl
  // 落定后各组:位置 / 睡眠
  const state = (n) => { const parts = ent.bodies.filter((b) => near(b, n)); return parts.map((b) => ({ id: b.partId, x: +b.x.toFixed(1), y: +b.y.toFixed(1), rot: +b.rot.toFixed(2), asleep: b.asleep, grid: !!b.cells })) }
  res.settled = { minecart: state('minecart'), stand: state('physics_wheel_stand_01'), fungus: state('physics_fungus'), table: state('furniture_table') }
  // 轮架的轮:电机 1.5 rad/s → 醒着时角速度 ≈ 1.5;整组不会睡(电机一直转)
  const standWheel = ent.bodies.find((b) => near(b, 'physics_wheel_stand_01') && b.isCircle) || ent.bodies.filter((b) => near(b, 'physics_wheel_stand_01'))[1]
  res.standWheel = standWheel ? { w: +standWheel.w.toFixed(2), awake: standWheel.pb?.isAwake(), rot: +standWheel.rot.toFixed(2) } : null
  // 推矿车:车身给 90px/s,1s 后车身位移 + 轮子转角
  const cart = ent.bodies.filter((b) => near(b, 'minecart'))
  const body = cart.find((b) => !b.isCircle), wheels = cart.filter((b) => b.isCircle)
  if (body) {
    const x0 = body.x, rot0 = wheels.map((w) => w.rot)
    if (body.asleep) body.wake(sim)
    body.vx = 90; ph.pushToPhysics(body)
    await wait(1000)
    res.push = { moved: +(body.x - x0).toFixed(1), wheelTurn: wheels.map((w, i) => +(w.rot - rot0[i]).toFixed(2)), bodyRot: +body.rot.toFixed(2), joints: body.multi.joints.length }
  }
  // 炸蘑菇:帽子旁边 r14 爆炸 → 断几个关节、帽子飞
  const fungus = ent.bodies.filter((b) => near(b, 'physics_fungus'))
  const M = fungus[0]?.multi
  if (M) {
    const j0 = M.joints.length, cap = fungus.find((b) => b.partId === 100), capY0 = cap?.y
    np.projectiles.explode(spawned.physics_fungus[0] - 14, spawned.physics_fungus[1] + 2, { radius: 14, damage: 0.01, shake: 0, hole: false, holeLiquid: false, rayEnergy: 1e6, maxDurability: 0, power: [1.5, 2.2], knockback: 1 })
    await wait(1500)
    res.fungusBlast = { jointsBefore: j0, jointsAfter: M.joints.length, partsAlive: M.parts.filter((b) => !b.dead).length, capMoved: cap ? +Math.hypot(cap.x - spawned.physics_fungus[0], cap.y - capY0).toFixed(1) : null }
  }
  // 整组睡 → 挖掉矿车脚下 → 整组醒
  await wait(3500)
  const cartSleep = cart.map((b) => b.asleep)
  const cx = Math.round(body?.x ?? PX - 70)
  for (let y = PY; y < PY + 8; y++) for (let x = cx - 16; x < cx + 16; x++) sim.set(x, y, 0, 0)
  await wait(600)
  res.cartDig = { asleepBefore: cartSleep, awakeAfter: cart.map((b) => !b.asleep), fell: body ? +(body.y - (spawned.minecart[1] + 0)).toFixed(1) : null }
  await wait(1500)
  res.cartAfter = cart.map((b) => ({ id: b.partId, y: +b.y.toFixed(1), rot: +b.rot.toFixed(2) }))
  const ms = []; for (let i = 0; i < 60; i++) { await wait(16); ms.push(ph.stats.ms) }
  ms.sort((a, b) => a - b)
  res.perf = { p50: +ms[30].toFixed(2), p95: +ms[57].toFixed(2), bodies: ph.stats.bodies, awake: ph.stats.awake, tiles: ph.stats.tiles }
  return res
})
console.log(JSON.stringify(r, null, 1))
await page.screenshot({ path: `${out}/box2d-joint.png` })
await browser.close()
