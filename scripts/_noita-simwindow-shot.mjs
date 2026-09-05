// 探针:手机视口(390×844)下屏幕外的世界也在模拟 —— 屏幕外 500px 处的沙柱会落下、炸弹会挖坑、怪会动;区块流把模拟圈也加载了
// 用法:node scripts/_noita-simwindow-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' }) // 手机横屏
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForFunction(() => window.__np.player.onGround, null, { timeout: 90000 })
await page.waitForTimeout(2500) // 让模拟圈的 chunk 也到齐
const r = await page.evaluate(async () => {
  const np = window.__np, pl = np.player, sim = np.sim
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const VW = np.streamer.stats.maxWantedAt?.view ? null : null
  const view = { w: document.getElementById('view')?.width, h: document.getElementById('view')?.height }
  const res = { view, simTbl: [sim.cw, sim.ch], entries: np.streamer.entries.size, ready: [...np.streamer.entries.values()].filter((e) => e.ready).length }
  // 屏幕右边 500px(视口宽约 213 世界 px,肯定在屏幕外)—— 在空中放一根 20 格沙柱,1s 后应该全部落下(沙在动 = 模拟在跑)
  const sx = Math.round(pl.x) + 500, sy = Math.round(pl.y) - 120
  const sand = np.mats.byName.get('sand')
  for (let y = sy - 40; y < sy + 60; y++) for (let x = sx - 30; x < sx + 30; x++) sim.set(x, y, 0)
  let placed = 0; for (let y = sy; y < sy + 20; y++) if (sim.set(sx, y, sand, 0)) placed++
  res.sandPlaced = placed
  await wait(1000)
  let still = 0; for (let y = sy; y < sy + 20; y++) if (sim.get(sx, y) === sand) still++
  let fell = 0; for (let y = sy + 20; y < sy + 60; y++) for (let x = sx - 30; x < sx + 30; x++) if (sim.get(x, y) === sand) fell++
  res.sand = { stillInColumn: still, belowColumn: fell, getAt: sim.get(sx, sy) }
  // 屏幕外 450px 处炸一颗炸弹:坑应该立刻挖出来(不用等走过去)
  const bx = Math.round(pl.x) - 450, by = Math.round(pl.y) + 40
  const cnt = () => { const c = { solid: 0, unloaded: 0, air: 0 }; for (let y = by - 60; y <= by + 60; y++) for (let x = bx - 60; x <= bx + 60; x++) { const m = sim.get(x, y); if (m < 0) c.unloaded++; else if (m === 0) c.air++; else if (np.mats.kind[m] === 'static' || np.mats.kind[m] === 'sand' || np.mats.kind[m] === 'solid') c.solid++ } return c }
  const c0 = cnt()
  np.projectiles.explode(bx, by, np.projectiles.defs.bomb.explosion)
  const c1 = cnt()
  res.bomb = { at: [bx - pl.x | 0, by - pl.y | 0], before: c0, after: c1, dug: c0.solid - c1.solid }
  // 屏幕外的怪在动:右边 400px 放一只僵尸,1s 后位置应变化(AI 走动)或至少 think 在减
  const z = np.entities.spawnCreature('zombie', Math.round(pl.x) + 400, Math.round(pl.y) - 10)
  const zx0 = z?.x, zt0 = z?.think
  await wait(1000)
  res.zombie = { spawned: !!z, moved: z ? +(z.x - zx0).toFixed(1) : null, thinkChanged: z ? z.think !== zt0 : null, dead: z?.dead }
  res.perf = { activeBlocks: sim.activeBlocks, stats: { requested: np.streamer.stats.requested, evicted: np.streamer.stats.evicted, holeFrames: np.streamer.stats.holeFrames } }
  return res
})
console.log(JSON.stringify(r, null, 1))
await page.screenshot({ path: 'C:/Users/admin/AppData/Local/Temp/simwindow-phone.png' })
// 快速向右赶路 1200px(每 100ms 挪 60px),看区块流跟不跟得上(可见空洞帧)、常驻数、模拟表大小
const run = await page.evaluate(async () => {
  const np = window.__np, pl = np.player, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const h0 = np.streamer.stats.holeFrames
  for (let i = 0; i < 20; i++) { pl.x += 60; pl.vx = 0; pl.vy = 0; await wait(100) }
  await wait(1500)
  return { holeFramesDuringRun: np.streamer.stats.holeFrames - h0, entries: np.streamer.entries.size, ready: [...np.streamer.entries.values()].filter((e) => e.ready).length, evicted: np.streamer.stats.evicted, simTbl: [np.sim.cw, np.sim.ch], fpsText: document.getElementById('perf')?.textContent?.slice(0, 80) }
})
console.log('run', JSON.stringify(run))
await page.screenshot({ path: 'C:/Users/admin/AppData/Local/Temp/simwindow-phone2.png' })
await browser.close()
