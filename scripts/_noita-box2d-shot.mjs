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
  await wait(150)
  const midAwake = b.isAwake()
  await wait(2500)
  const p2 = b.getPosition()
  res.dig = { before, wokeWithin150ms: midAwake, after: { y: +(p2.y * 6).toFixed(2), awake: b.isAwake(), groundBelow: groundY(p2.x * 6, p2.y * 6) } }
  // ③ 帧耗时:采 60 帧
  const ms = []; for (let i = 0; i < 60; i++) { await wait(16); ms.push(ph.stats.ms) }
  ms.sort((a, b) => a - b)
  res.perf = { p50: +ms[30].toFixed(3), p95: +ms[57].toFixed(3), max: +ms[59].toFixed(3), tiles: ph.stats.tiles, bodies: ph.stats.bodies, awake: ph.stats.awake }
  return res
})
console.log(JSON.stringify(r, null, 1))
await page.screenshot({ path: `${out}/box2d-1.png` })
await browser.close()
