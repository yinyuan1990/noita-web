// 探针:① roadblock 群系(cx33,cy11)是空气不是岩石方块 ② 湿身碰火先烤干再着火、着火 2%/s ③ plasma_fading(激光渣)落地后蒸发
//       ④ 金块 / 心互相挤开不叠一点 ⑤ 头顶状态图标截图
// 用法:node scripts/_noita-fix-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.player.onGround, null, { timeout: 90000 })
await page.waitForTimeout(1500)
const r = await page.evaluate(async () => {
  const np = window.__np, pl = np.player, sim = np.sim, mats = np.mats, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const res = {}
  const M = (n) => mats.byName.get(n)
  // ③ 蒸发:在玩家脚边地面上撒一片 plasma_fading_green,1.5s 后应基本没了
  {
    const m = M('plasma_fading_green'); let n0 = 0
    for (let x = pl.x - 30; x < pl.x - 10; x++) for (let y = pl.y - 3; y <= pl.y + 2; y++) if (sim.get(x, y) === 0) { sim.set(x, y, m, 0); n0++ }
    await wait(1500)
    let n1 = 0; for (let x = pl.x - 40; x < pl.x; x++) for (let y = pl.y - 40; y <= pl.y + 20; y++) if (sim.get(x, y) === m) n1++
    res.evaporate = { placed: n0, left: n1 }
  }
  // ② 湿身 → 碰火:先烤沾污,再着火;着火伤害 2%/s
  {
    const water = M('water'), fire = sim.M_FIRE
    // 泡水:头顶上方倒一桶水
    for (let k = 0; k < 8; k++) { for (let x = pl.x - 6; x <= pl.x + 6; x++) for (let y = pl.y - 30; y < pl.y - 24; y++) if (sim.get(x, y) === 0) sim.set(x, y, water, 0); await wait(120) }
    await wait(600)
    res.wet0 = { wet: +pl.wet.toFixed(2), stain: pl.stain }
    // 把水清掉,人脚下 / 身上放火(每帧补火)
    for (let x = pl.x - 40; x <= pl.x + 40; x++) for (let y = pl.y - 60; y <= pl.y + 3; y++) if (sim.get(x, y) === water) sim.set(x, y, 0, 0)
    const hp0 = pl.hp
    const t0 = performance.now(); let ignitedAt = -1, wetAtIgnite = -1
    const iv = setInterval(() => { for (const [dx, dy] of [[0, -2], [0, 2], [-2, -2], [2, -2]]) if (sim.get(Math.floor(pl.x + dx), Math.floor(pl.y + dy)) === 0) sim.set(Math.floor(pl.x + dx), Math.floor(pl.y + dy), fire, 30); if (ignitedAt < 0 && pl.fireT > 0) { ignitedAt = performance.now() - t0; wetAtIgnite = pl.wet } }, 16)
    await wait(1200)
    res.fireOnWet = { after1200ms: { wet: +pl.wet.toFixed(2), fireT: +pl.fireT.toFixed(2), hp: +pl.hp.toFixed(3) }, ignitedAtMs: ignitedAt | 0, wetAtIgnite: +wetAtIgnite.toFixed(2) }
    await wait(2200)
    clearInterval(iv)
    res.fireOnWet.after3400ms = { wet: +pl.wet.toFixed(2), fireT: +pl.fireT.toFixed(2), hpLost: +(hp0 - pl.hp).toFixed(3), expectedPerSec: +(0.02 * pl.maxHp).toFixed(3) }
    res.statuses = np.veg && typeof window.__np.player.fireDur === 'number' ? { fireDur: pl.fireDur } : null
    // 灭火:泡水
    for (let x = pl.x - 6; x <= pl.x + 6; x++) for (let y = pl.y - 14; y < pl.y; y++) if (sim.get(x, y) === 0 || sim.get(x, y) === fire) sim.set(x, y, water, 0)
    await wait(300)
    res.extinguished = pl.fireT <= 0
  }
  // ④ 金块挤开:同一点扔 6 个金块 + 1 颗心,1.5s 后看 x 的分布
  {
    const ent = np.entities, x = pl.x + 40, y = pl.y - 20
    const before = ent.bodies.length
    for (let i = 0; i < 6; i++) ent.spawnItem?.('goldnugget_10', x, y, { vy: -30, pickCool: 99 })
    ent.spawnItem?.('heart', x, y, { vy: -30, pickCool: 99 })
    await wait(1800)
    const its = ent.bodies.filter((b) => b.isItem && b.pickCool > 50)
    const xs = its.map((b) => +(b.x - x).toFixed(1)).sort((a, b) => a - b)
    let minGap = Infinity; for (let i = 1; i < xs.length; i++) minGap = Math.min(minGap, xs[i] - xs[i - 1])
    res.items = { spawned: its.length, added: ent.bodies.length - before, xs, minGap: +minGap.toFixed(1) }
  }
  return res
})
console.log(JSON.stringify(r, null, 1))
// ⑤ 头顶状态图标:再泡一下水截图
await page.evaluate(async () => { const np = window.__np, pl = np.player, sim = np.sim, w = np.mats.byName.get('water'); for (let x = pl.x - 6; x <= pl.x + 6; x++) for (let y = pl.y - 14; y < pl.y; y++) if (sim.get(x, y) === 0) sim.set(x, y, w, 0); await new Promise((r) => setTimeout(r, 400)) })
await page.screenshot({ path: `${out}/fix-status.png` })
// ① roadblock:把人挪到 (cx33,cy11) 中心 = 世界 (-768, -1280),等 chunk 到,这一格应是空气;顺带截图看天上有没有方块
const rb = await page.evaluate(async () => {
  const np = window.__np, pl = np.player
  pl.x = -768; pl.y = -1200; pl.vx = 0; pl.vy = 0; np.cam.x = pl.x; np.cam.y = pl.y
  const t0 = performance.now()
  while (performance.now() - t0 < 15000) { const e = np.streamer.get(33, 11); if (e?.ready && e.mat) break; await new Promise((r) => setTimeout(r, 100)) }
  const e = np.streamer.get(33, 11)
  let solid = 0; if (e?.mat) for (let i = 0; i < e.mat.length; i += 97) if (e.mat[i] > 0) solid++
  return { ready: !!e?.ready, biome: e?.biome, solidSamples: solid, of: e?.mat ? Math.ceil(e.mat.length / 97) : 0 }
})
console.log('roadblock', JSON.stringify(rb))
await page.waitForTimeout(500)
await page.screenshot({ path: `${out}/fix-roadblock.png` })
await browser.close()
