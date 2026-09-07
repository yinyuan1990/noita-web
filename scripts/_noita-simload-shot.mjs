// 探针:用户 iPhone 上报的法杖(三重 + 汇聚之光 + 上方向拉帕 + 复制轨迹 + 陨石)对地连开 6 秒,之后 30 秒每 2 秒记一行:
//   fps / 模拟 ms / 活跃块 / 动了几格,以及活跃块里非空格按"材质种类"和"材质名"的直方图 —— 看是什么材质把 1500+ 个块一直撑醒(iPhone 上模拟 25~45ms)
// 用法:node scripts/_noita-simload-shot.mjs [url] [cpuThrottle=1]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const throttle = +(process.argv[3] || 1)
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 390 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
if (throttle > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }) }
await page.goto(url, { timeout: 120000, waitUntil: 'commit' })
await page.waitForFunction(() => window.__np && window.__np.player.onGround && window.__np.physics, null, { timeout: 150000 })
await page.waitForTimeout(500)
await page.evaluate(() => {
  const np = window.__np, w = np.player.wands[0]
  w.cards = ['BURST_3', 'LASER', 'LARPA_UPWARDS', 'LARPA_CHAOS_2', 'LASER', 'METEOR']; w.deck = [...w.cards]; w.uses = {}; w.mana = w.manaMax = 1e6; w.cd = 0; w.reloadT = 0; np.setWand(0)
})
// 对着脚下右前方地面按住开火 6 秒,期间左右挪一挪(用户是边走边打)
const shootP = (async () => {
  await page.mouse.move(560, 330); await page.mouse.down()
  for (let i = 0; i < 12; i++) { await page.keyboard.down(i & 1 ? 'a' : 'd'); await page.waitForTimeout(500); await page.keyboard.up(i & 1 ? 'a' : 'd') }
  await page.mouse.up()
})()
const r = await page.evaluate(async () => {
  const np = window.__np, sim = np.sim, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  let frames = 0; const tick = () => { frames++; requestAnimationFrame(tick) }; tick()
  const rows = []
  const histo = () => {
    // 扫一遍激活窗口里所有 act>0 的 32×32 块,数非空格
    const byKind = {}, byName = {}
    let blocks = 0, cells = 0
    const KN = ['air', 'static', 'sand', 'liquid', 'gas', 'fire']
    for (let j = 0; j < sim.ch; j++) for (let i = 0; i < sim.cw; i++) {
      const e = sim.tbl[j * 4 + i]
      if (!e || !e.act) continue
      for (let b = 0; b < 256; b++) {
        if (!e.act[b]) continue
        blocks++
        const bx = b & 15, by = b >> 4
        for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
          const m = e.mat[((by * 32 + y) * 512) + bx * 32 + x]
          if (!m) continue
          cells++
          const k = KN[sim.kind[m]]
          byKind[k] = (byKind[k] || 0) + 1
          if (k !== 'static') { const n = np.mats.name(m); byName[n] = (byName[n] || 0) + 1 }
        }
      }
    }
    const top = Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `${n}:${c}`).join(' ')
    return { blocks, cells, byKind, top }
  }
  for (let s = 0; s < 18; s++) {
    const f0 = frames, t0 = performance.now()
    await wait(2000)
    const fps = +((frames - f0) / ((performance.now() - t0) / 1000)).toFixed(0)
    const panel = document.getElementById('panel').textContent.split('\n')
    const simMs = +(/模拟 ([\d.]+)ms/.exec(panel[1])?.[1] || 0), renderMs = +(/渲染 ([\d.]+)/.exec(panel[1])?.[1] || 0), logicMs = +(/逻辑 ([\d.]+)/.exec(panel[1])?.[1] || 0)
    rows.push({ t: (s + 1) * 2, fps, simMs, lod: sim.lod, logicMs, renderMs, active: sim.activeBlocks, stepped: sim.stepped, awake: np.physics.stats.awake, proj: np.projectiles.list.length, ...histo() })
  }
  return rows
})
await shootP
for (const o of r) console.log(JSON.stringify(o))
await page.screenshot({ path: process.env.TEMP + '/simload.png' })
await browser.close()
