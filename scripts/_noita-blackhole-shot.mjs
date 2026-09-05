// 探针:黑洞 —— 巨大黑洞(BlackHoleComponent)长到 64px、吞掉圈内格子、拉人拉怪拉弹、圈内按概率掉血;小黑洞穿地吃洞
// 用法:node scripts/_noita-blackhole-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
// 出生点周围 3×2 个区块都到了再开始(线上冷缓存慢,不然玩家还悬在空中、地面还没有)
await page.waitForFunction(() => { const np = window.__np; for (let cx = 34; cx <= 36; cx++) for (let cy = 13; cy <= 14; cy++) if (!np.streamer.get(cx, cy)) return false; return true }, null, { timeout: 120000 })
await page.waitForFunction(() => window.__np.player.onGround, null, { timeout: 30000 })
await page.waitForTimeout(1000)
// 巨大黑洞:放在玩家右侧 90px、脚下 20px(吃地面);旁边 30px 处放一只僵尸,再朝黑洞上方射一发火花弹看被拉弯
const t0 = await page.evaluate(() => {
  const np = window.__np, P = np.projectiles, pl = np.player
  pl.iframe = 0 // 黑洞伤害不吃无敌帧,这里只是确保初始态干净
  const bx = pl.x + 90, by = pl.y + 20
  const bh = P.spawn('black_hole_big', bx, by, 0)
  const z = np.entities.spawnCreature('zombie', bx + 30, by - 10)
  let solid0 = 0; for (let y = by - 64; y <= by + 64; y++) for (let x = bx - 64; x <= bx + 64; x++) if ((x - bx) ** 2 + (y - by) ** 2 <= 64 * 64 && np.sim.get(x, y) > 0) solid0++
  window.__bh = { bh, z, bx, by, solid0, px0: pl.x, py0: pl.y, hp0: pl.hp, zhp0: z?.hp, pullMax: 0, hpLoss: 0 }
  // 玩家别真被吸进去死掉(死了游戏暂停):每 100ms 记一下被拉了多远 / 掉了多少血,然后拉回原地补满
  window.__bhTimer = setInterval(() => { const B = window.__bh; B.pullMax = Math.max(B.pullMax, pl.x - B.px0); B.hpLoss += B.hp0 - pl.hp; pl.x = B.px0; pl.y = B.py0; pl.vx = 0; pl.vy = 0; pl.hp = B.hp0 }, 100)
  // 一发火花弹从玩家位置水平飞向黑洞上方(离中心 40px),记录它的轨迹
  const b = P.spawn('light_bullet', pl.x, by - 40, 0)
  window.__bh.bullet = b; window.__bh.track = []
  return { bx, by, solid0, zombie: !!z, zhp0: z?.hp, hp0: pl.hp }
})
console.log('t0', JSON.stringify(t0))
for (let i = 0; i < 12; i++) { await page.waitForTimeout(50); await page.evaluate(() => { const b = window.__bh.bullet; if (!b.dead && window.__bh.track.length < 30) window.__bh.track.push([b.x | 0, b.y | 0]) }) }
await page.waitForTimeout(3000)
const t1 = await page.evaluate(() => {
  const np = window.__np, B = window.__bh, pl = np.player
  let solid1 = 0; for (let y = B.by - 64; y <= B.by + 64; y++) for (let x = B.bx - 64; x <= B.bx + 64; x++) if ((x - B.bx) ** 2 + (y - B.by) ** 2 <= 60 * 60 && np.sim.get(x, y) > 0) solid1++
  // LooseGround:洞外 64~84px 那一圈里静态地面(rock/soil 静态)应有一部分变成了松散材质(sand/soil/rock_loose 这类会掉的)
  let staticN = 0, looseN = 0
  for (let y = B.by - 84; y <= B.by + 84; y++) for (let x = B.bx - 84; x <= B.bx + 84; x++) { const d2 = (x - B.bx) ** 2 + (y - B.by) ** 2; if (d2 < 64 * 64 || d2 > 84 * 84) continue; const m = np.sim.get(x, y); if (m <= 0) continue; const k = np.mats.kind[m]; if (k === 'static') staticN++; else if (k === 'sand' || k === 'solid') looseN++ }
  return { bhR: B.bh.bhR, attr: B.bh.bhAttr, age: +B.bh.age.toFixed(2), alive: np.projectiles.list.includes(B.bh), solid0: B.solid0, solidLeft: solid1, parts: np.projectiles.bhParts.length, fx: np.projectiles.fx.length, ringStatic: staticN, ringLoose: looseN, zombieHp: B.z?.hp, zombieDead: B.z?.dead, zombieDist: B.z ? Math.hypot(B.z.x - B.bx, B.z.y - B.by) | 0 : null, playerPullPer100ms: +B.pullMax.toFixed(1), playerHpLoss: +B.hpLoss.toFixed(2), bulletTrack: B.track }
})
console.log('t1', JSON.stringify(t1))
await page.screenshot({ path: `${out}/blackhole.png` })
await page.screenshot({ path: `${out}/blackhole-zoom.png`, clip: { x: 427 + 90 * 2 - 170, y: 240 + 20 * 2 - 170, width: 340, height: 340 } })
// 再看 2s:圈内剩多少、粒子多少
await page.waitForTimeout(2000)
const t1b = await page.evaluate(() => { const np = window.__np, B = window.__bh; let s = 0; for (let y = B.by - 64; y <= B.by + 64; y++) for (let x = B.bx - 64; x <= B.bx + 64; x++) if ((x - B.bx) ** 2 + (y - B.by) ** 2 <= 60 * 60 && np.sim.get(x, y) > 0) s++; return { age: +B.bh.age.toFixed(1), solidLeft: s, parts: np.projectiles.bhParts.length, simMs: np.simMs } })
console.log('t1b', JSON.stringify(t1b))
await page.screenshot({ path: `${out}/blackhole-zoom2.png`, clip: { x: 427 + 90 * 2 - 170, y: 240 + 20 * 2 - 170, width: 340, height: 340 } })
// 到寿命(500 帧 ≈ 8.3s)后黑洞消失,留下洞
await page.waitForTimeout(3500)
const t2 = await page.evaluate(() => { clearInterval(window.__bhTimer); const np = window.__np, B = window.__bh; return { alive: np.projectiles.list.includes(B.bh), finalR: B.bh.bhR, playerHpLossTotal: +B.hpLoss.toFixed(2), dead: np.player.dead } })
console.log('t2', JSON.stringify(t2))
// 小黑洞:collide_with_world=0,速度 40、活 2s,一路吃 12px 的洞穿进地里
const s = await page.evaluate(async () => {
  const np = window.__np, P = np.projectiles, pl = np.player
  const x0 = pl.x - 60, y0 = pl.y + 30
  const b = P.spawn('black_hole', x0, y0, Math.PI / 2) // 朝下打进地里
  await new Promise((r) => setTimeout(r, 1500))
  let hole = 0; for (let y = y0; y < y0 + 60; y++) if (np.sim.get(x0, y) === 0) hole++
  return { x: b.x | 0, y: b.y | 0, moved: (b.y - y0) | 0, holeCol: hole }
})
console.log('small', JSON.stringify(s))
await page.screenshot({ path: `${out}/blackhole-small.png` })
await browser.close()
