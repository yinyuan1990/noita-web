// 探针:怪物死亡 / 尸体(反 DamageModelSystem::KillMe 的 RAGDOLL_FX 分支)
//   NORMAL:僵尸 12 块用 11 个 pin 关节连成一具,落地后关节误差 <1px、整具包围盒 ≤ 精灵帧大小,3s 内整组入睡变 meat 像素
//   BLOOD_EXPLOSION(霰弹 / 火箭):不建关节,块散开 + 喷血;BLOOD_SPRAY:连着 + 喷血;FROZEN:整帧一块 ice_glass_b2;DISINTEGRATED:每像素一粒尘,无尸体;火烧死:尸体旁起火
// 用法:node scripts/_noita-ragdoll-shot.mjs [url]
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
await page.waitForTimeout(1500)
// 放大截图:以某点为中心的 160×90 世界像素放大 4 倍
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
const setup = await page.evaluate(() => {
  const np = window.__np, pl = np.player, sim = np.sim
  // 出生点左上方空中搭一块石台(160×6),尸体都掉在这上面看
  const rock = np.mats.byName.get('rock_static'), PY = Math.floor(pl.y) - 20, PX0 = Math.floor(pl.x) - 200, PX1 = Math.floor(pl.x) - 40
  for (let y = PY; y < PY + 6; y++) for (let x = PX0; x <= PX1; x++) sim.set(x, y, rock, 0)
  for (let y = PY - 90; y < PY; y++) for (let x = PX0 - 10; x <= PX1 + 10; x++) if (sim.get(x, y) > 0) sim.set(x, y, 0, 0)
  np.cam.x = (PX0 + PX1) / 2; np.cam.y = PY - 30
  return { PX0, PX1, PY }
})
const { PX0, PX1, PY } = setup
const kill = async (name, x, opts) => page.evaluate(async ([name, x, PY, opts]) => {
  const np = window.__np, ent = np.entities, sim = np.sim, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  // 清掉上一只留下的东西
  for (const b of ent.bodies) if (b.isRagdoll) { if (b.asleep) b.wake(sim); b.dead = true }
  for (const g of ent.ragdolls) for (const p of g.parts) p.dead = true
  ent.ragdolls.length = 0
  for (let y = PY - 90; y < PY; y++) for (let xx = x - 60; xx <= x + 60; xx++) if (sim.get(xx, y) > 0) sim.set(xx, y, 0, 0)
  np.debris.length = 0
  const z = ent.spawnCreature(name, x, PY - 8)
  if (!z) return { err: 'no spawn ' + name }
  await wait(250)
  if (opts.face) z.face = opts.face
  if (opts.frozen) z.frozenT = 2
  if (opts.fire) { z.fireT = 3; z.fireTick = 0 }
  const frame = { anim: z.anim, frame: z.frame, face: z.face }
  ent.hurt(z, 9999, opts.ix ?? 90, opts.iy ?? -30, opts.src || 'melee', z.x, z.y, opts.hurt || null)
  await wait(120)
  for (let k = 0; k < 30 && ent.pendingRagdolls.length; k++) await wait(100) // 线上第一次:部件图还在下载
  const early = { debris: np.debris.length, bodies: ent.bodies.filter((b) => b.isRagdoll && !b.dead).length }
  const g0 = ent.ragdolls[ent.ragdolls.length - 1]
  const spreadOf = (parts) => { const xs = parts.map((p) => p.x), ys = parts.map((p) => p.y); return { w: +(Math.max(...xs) - Math.min(...xs)).toFixed(1), h: +(Math.max(...ys) - Math.min(...ys)).toFixed(1) } }
  const jointErr = (g) => { if (!g) return null; let m = 0; const A = [0, 0], B = [0, 0]; for (const j of g.joints) { if (j.broken) continue; const P = g.parts; np.Ragdoll.anchor(P[j.a], j.ax, j.ay, A); np.Ragdoll.anchor(P[j.b], j.bx, j.by, B); m = Math.max(m, Math.hypot(A[0] - B[0], A[1] - B[1])) } return +m.toFixed(2) }
  const spread0 = g0 ? spreadOf(g0.parts) : null
  const maxErr = []
  let fireSeen = 0
  for (let i = 0; i < 30; i++) {
    await wait(100)
    if (g0) maxErr.push(jointErr(g0))
    let f = 0; for (let y = PY - 40; y < PY; y++) for (let xx = x - 30; xx <= x + 30; xx++) if (sim.get(xx, y) === sim.M_FIRE) f++
    fireSeen = Math.max(fireSeen, f)
  }
  await wait(600)
  const parts = g0 ? g0.parts.filter((p) => !p.dead) : []
  let meat = 0, ice = 0
  const meatId = np.mats.byName.get('meat'), iceId = np.mats.byName.get('ice_glass_b2')
  for (let y = PY - 60; y <= PY; y++) for (let xx = x - 60; xx <= x + 60; xx++) { const m = sim.get(xx, y); if (m === meatId) meat++; else if (m === iceId) ice++ }
  const blood = np.debris.filter((d) => np.mats.name(d.m) === 'blood' || np.mats.name(d.m) === 'blood_fading').length
  const res = {
    fx: z.ragdollFx, frame, early, group: g0 ? { parts: g0.parts.length, joints: g0.joints.length, broken: g0.joints.filter((j) => j.broken).length, blood: g0.blood ? g0.blood.left : null, burn: +g0.burn.toFixed(2) } : null,
    spread0, spread: parts.length ? spreadOf(parts) : null, jointErrMax: maxErr.length ? Math.max(...maxErr.filter((v) => v !== null)) : null, jointErrLate: maxErr.slice(-5),
    asleep: parts.filter((p) => p.asleep).length, awake: parts.filter((p) => !p.asleep).length, meatCells: meat, iceCells: ice, bloodDebrisNow: blood, fireSeen,
    parts: parts.slice(0, 12).map((p) => ({ n: p.n, x: +p.x.toFixed(1), y: +p.y.toFixed(1), rot: +p.rot.toFixed(2), asleep: p.asleep, v: [+p.vx.toFixed(1), +p.vy.toFixed(1), +p.w.toFixed(2)] })),
    groupRest: g0 ? { still: !!g0.stillFlag, supported: g0.supported(ent._solidB), stiff: g0.stiff } : null,
    // 姿势保持:各块相对第一块(上躯干)的转角变化(关节有刚度 → 应该都不大,整具一起倒)
    poseDrift: g0 ? +Math.max(0, ...g0.parts.filter((p) => !p.dead && g0.connected(p)).map((p) => { let d = p.rot - g0.parts[0].rot; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; return Math.abs(d) })).toFixed(2) : null,
    rootRot: g0 ? +g0.parts[0].rot.toFixed(2) : null,
  }
  if (g0) res.center = { x: g0.parts.reduce((s, p) => s + p.x, 0) / g0.parts.length, y: g0.parts.reduce((s, p) => s + p.y, 0) / g0.parts.length }
  if (g0?.breakLog) res.breakLog = g0.breakLog
  return res
}, [name, x, PY, opts])

const R = {}
R.normal = await kill('zombie', PX0 + 40, { src: 'melee', ix: 40 }); await zoom(`${out}/ragdoll-normal.png`, PX0 + 48, PY - 8)
R.normalLeft = await kill('zombie', PX0 + 80, { src: 'melee', face: -1, ix: -40 }); await zoom(`${out}/ragdoll-left.png`, PX0 + 72, PY - 8)
R.explosion = await kill('zombie', PX0 + 80, { src: 'proj', ix: 30, hurt: { ragdollFx: 'BLOOD_EXPLOSION' } }); await zoom(`${out}/ragdoll-explosion.png`, PX0 + 85, PY - 8)
R.spray = await kill('miner', PX0 + 80, { src: 'proj', ix: 30, hurt: { ragdollFx: 'BLOOD_SPRAY' } }); await zoom(`${out}/ragdoll-spray.png`, PX0 + 85, PY - 8)
R.frozen = await kill('zombie', PX0 + 80, { src: 'proj', ix: 30, frozen: true }); await zoom(`${out}/ragdoll-frozen.png`, PX0 + 85, PY - 8)
R.disintegrated = await kill('zombie', PX0 + 80, { src: 'proj', ix: 30, hurt: { effects: ['disintegrated'] } })
R.fire = await kill('zombie', PX0 + 80, { src: 'fire', ix: 0, iy: 0, fire: true }); await zoom(`${out}/ragdoll-fire.png`, PX0 + 80, PY - 8)
// 20% BLOOD_SPRAY 掷骰:弹丸打死 30 只,数一下走了几种 fx
R.roll = await page.evaluate(async ([PX0, PY]) => {
  const np = window.__np, ent = np.entities, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const c = {}
  for (let i = 0; i < 30; i++) { const z = ent.spawnCreature('zombie_weak', PX0 + 20 + (i % 8) * 15, PY - 60); if (!z) continue; ent.hurt(z, 99, 0, 0, 'proj'); c[z.ragdollFx] = (c[z.ragdollFx] || 0) + 1; await wait(10) }
  for (const b of ent.bodies) if (b.isRagdoll) b.dead = true
  ent.ragdolls.length = 0
  return c
}, [PX0, PY])
console.log(JSON.stringify(R, null, 1))
await page.screenshot({ path: `${out}/ragdoll.png` })
await browser.close()
