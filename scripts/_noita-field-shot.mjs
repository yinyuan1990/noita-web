// 探针:场类(原地 5)—— 先对雷霆之环:圈内怪定住、圈里的液体被电、电液里的怪 / 玩家被电;截图看圈的样子
// 用法:node scripts/_noita-field-shot.mjs [url]
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
await page.waitForTimeout(800)
// 玩家右侧 70px:挖一个 60×20 的水池(左半在圈里、右半在圈外),圈放在池子左上;僵尸 A 站圈里(干地),僵尸 B 站圈外的水里
const t0 = await page.evaluate(() => {
  const np = window.__np, pl = np.player, water = np.mats.byName.get('water')
  const fx = Math.round(pl.x + 70), fy = Math.round(pl.y - 6)
  for (let y = fy + 4; y < fy + 24; y++) for (let x = fx - 10; x < fx + 70; x++) np.sim.set(x, y, water, 0)
  for (let y = fy - 30; y < fy + 4; y++) for (let x = fx - 40; x < fx + 70; x++) if (np.sim.get(x, y) > 0) np.sim.set(x, y, 0)
  const f = np.projectiles.spawn('electrocution_field', fx, fy, 0)
  const zA = np.entities.spawnCreature('zombie', fx - 20, fy - 2)
  const zB = np.entities.spawnCreature('zombie', fx + 55, fy + 14)
  window.__f = { f, zA, zB, fx, fy, water, hp0: pl.hp, zAhp: zA?.hp, zBhp: zB?.hp }
  return { fx, fy, def: { areaEffect: f.d.areaEffect, emitters: f.d.emitters.length, sprEmitters: (f.d.sprEmitters || []).length, sprite: f.d.sprite?.image || null, lifetime: f.d.lifetime, elec: f.d.electricity || null } }
})
console.log('t0', JSON.stringify(t0))
await page.waitForTimeout(2500)
const t1 = await page.evaluate(() => {
  const np = window.__np, F = window.__f
  let wet = 0, steam = 0
  const st = np.mats.byName.get('steam')
  for (let y = F.fy - 30; y < F.fy + 24; y++) for (let x = F.fx - 10; x < F.fx + 70; x++) { const m = np.sim.get(x, y); if (m === F.water) wet++; else if (m === st) steam++ }
  return { alive: np.projectiles.list.includes(F.f), age: +F.f.age.toFixed(1), zA: { stun: +(F.zA?.stunT || 0).toFixed(2), hp: F.zA?.hp, dead: F.zA?.dead }, zB: { stun: +(F.zB?.stunT || 0).toFixed(2), hp: F.zB?.hp, dead: F.zB?.dead, x: F.zB?.x | 0, y: F.zB?.y | 0 }, waterCells: wet, steam, zaps: np.projectiles.zaps.length, elecCells: np.projectiles.elec.size, loops: [...np.projectiles.loops.keys()], playerHp: np.player.hp, fx: np.projectiles.fx.length, sfx: np.projectiles.sfx.length }
})
console.log('t1', JSON.stringify(t1))
await page.screenshot({ path: `${out}/field-electro.png` })
await page.screenshot({ path: `${out}/field-electro-zoom.png`, clip: { x: 440, y: 140, width: 340, height: 200 } })
// 玩家走进电水里 1.5s
const t2 = await page.evaluate(async () => {
  const np = window.__np, F = window.__f, pl = np.player
  pl.x = F.fx + 30; pl.y = F.fy + 10; pl.vx = 0; pl.vy = 0
  const hp = pl.hp
  let stunMax = 0, shocks = 0, lastShock = 0
  const t0 = performance.now()
  while (performance.now() - t0 < 1500) { await new Promise((r) => setTimeout(r, 16)); stunMax = Math.max(stunMax, pl.stunT || 0); if (pl.shockAt && pl.shockAt !== lastShock) { lastShock = pl.shockAt; shocks++ }; if (pl.dead) break }
  return { hpBefore: hp, hpAfter: +pl.hp.toFixed(3), dead: pl.dead, shocks, stunMax: +stunMax.toFixed(2), x: pl.x | 0, y: pl.y | 0, deathInfo: document.getElementById('deathInfo')?.textContent || '' }
})
console.log('t2', JSON.stringify(t2))
await page.screenshot({ path: `${out}/field-electro-player.png` })
// ── 静止之环:撤掉雷霆之环、重灌水池,把圈放在池子上;1s 后池子应全冻成 ice_static(MagicConvert r72 / 5 环每帧 → 15 帧扫完)
const t3 = await page.evaluate(async () => {
  const np = window.__np, F = window.__f, pl = np.player
  np.projectiles.list.length = 0; np.projectiles.zaps.length = 0
  pl.x = F.fx - 60; pl.y = F.fy - 6; pl.vx = 0; pl.vy = 0; pl.hp = pl.maxHp; pl.stunT = 0
  for (let y = F.fy + 4; y < F.fy + 24; y++) for (let x = F.fx - 10; x < F.fx + 70; x++) np.sim.set(x, y, F.water, 0)
  const z = np.entities.spawnCreature('zombie', F.fx + 10, F.fy - 2)
  const f = np.projectiles.spawn('freeze_field', F.fx, F.fy, 0)
  await new Promise((r) => setTimeout(r, 1000))
  const ice = np.mats.byName.get('ice_static')
  let nIce = 0, nWater = 0, nIceFar = 0
  for (let y = F.fy + 4; y < F.fy + 24; y++) for (let x = F.fx - 10; x < F.fx + 70; x++) { const m = np.sim.get(x, y); const far = Math.hypot(x - F.fx, y - F.fy) > 72; if (m === ice) { if (far) nIceFar++; else nIce++ } else if (m === F.water) nWater++ }
  return { ice72: nIce, iceBeyond72: nIceFar, water: nWater, zStun: +(z?.stunT || 0).toFixed(2), spr: f.spr ? 'next' : 'spawn', frame: f.frame, alpha: f.d.spriteAlpha, additive: f.d.additive, tint: f.d.sprite?.tint, loops: [...np.projectiles.loops.keys()] }
})
console.log('t3 freeze', JSON.stringify(t3))
await page.screenshot({ path: `${out}/field-freeze.png`, clip: { x: 440, y: 140, width: 340, height: 200 } })
// ── 遮蔽之环:圈放在空中,朝圈心射一颗敌方弹;弹进圈应被弹开(EnergyShield r28)
const t4 = await page.evaluate(async () => {
  const np = window.__np, F = window.__f
  np.projectiles.list.length = 0
  const sx = F.fx, sy = F.fy - 60
  for (let y = sy - 40; y < sy + 40; y++) for (let x = sx - 60; x < sx + 60; x++) if (np.sim.get(x, y) > 0) np.sim.set(x, y, 0)
  const f = np.projectiles.spawn('shield_field', sx, sy, 0)
  const b = np.projectiles.spawn('e_machinegun_bullet_slow', sx - 50, sy, 0, { owner: 'enemy' })
  const v0 = { vx: b?.vx, vy: b?.vy }
  await new Promise((r) => setTimeout(r, 400))
  return { shield: f.d.shield, bulletAlive: np.projectiles.list.includes(b), v0, v1: { vx: b?.vx | 0, vy: b?.vy | 0, x: (b?.x - sx) | 0 }, deflected: b ? b.vx < 0 : null }
})
console.log('t4 shield', JSON.stringify(t4))
await page.screenshot({ path: `${out}/field-shield.png`, clip: { x: 440, y: 40, width: 340, height: 200 } })
// ── 雨云:出生点往上挂 40px(cloud_position.lua),每 3 帧下 1~10 格真水;2.5s 后下面应积水
const t5 = await page.evaluate(async () => {
  const np = window.__np, F = window.__f
  np.projectiles.list.length = 0
  const cx = F.fx - 60, cy = F.fy - 10
  for (let y = F.fy + 4; y < F.fy + 24; y++) for (let x = F.fx - 10; x < F.fx + 70; x++) np.sim.set(x, y, 0)
  const c = np.projectiles.spawn('cloud_water', cx, cy, 0)
  const y0 = c?.y
  await new Promise((r) => setTimeout(r, 2500))
  let water = 0
  for (let y = cy; y < cy + 60; y++) for (let x = cx - 40; x < cx + 40; x++) if (np.sim.get(x, y) === F.water) water++
  return { riseTo: c?.d.riseTo, spawnY: cy, y0, y1: c?.y | 0, alive: np.projectiles.list.includes(c), waterBelow: water, emitters: c?.d.emitters.map((e) => [e.mat, e.real, e.image?.file || '']) }
})
console.log('t5 cloud', JSON.stringify(t5))
await page.screenshot({ path: `${out}/field-cloud.png` })
await browser.close()
