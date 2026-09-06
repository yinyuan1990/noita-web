// 探针:自由模式无限法力连开陨石(r45)打地 4 秒 —— 用户反馈"手机上物理 80ms 直接像暂停了"。每 0.5s 记 fps / 物理中位 & 峰值 / 模拟 ms & 活跃块 / 爆炸次数 / TOI 开关
// 用法:node scripts/_noita-meteor-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(url, { timeout: 120000, waitUntil: 'commit' })
await page.waitForFunction(() => window.__np && window.__np.player.onGround && window.__np.physics, null, { timeout: 150000 })
await page.waitForTimeout(500)
console.log('cards before', await page.evaluate(() => JSON.stringify(window.__np.player.wands[0].cards)))
await page.evaluate(() => { const np = window.__np, w = np.player.wands[0]; w.cards = ['METEOR']; w.deck = ['METEOR']; w.uses = {}; w.mana = w.manaMax = 1e6; w.cd = 0; w.reloadT = 0; np.setWand(0) })
// 朝脚下偏右的地面按住开火 4 秒(用户:"要打地、疯狂地打")
const shootP = (async () => { await page.mouse.move(520, 400); await page.mouse.down(); await page.waitForTimeout(4000); await page.mouse.up() })()
const r = await page.evaluate(async () => {
  const np = window.__np, pl = np.player, ent = np.entities, ph = np.physics, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const rows = []
  let frames = 0; const tick = () => { frames++; requestAnimationFrame(tick) }; tick()
  // 计 explode 次数
  const ex0 = np.projectiles.explode.bind(np.projectiles); let nEx = 0, exR = []
  np.projectiles.explode = (x, y, ex, back) => { nEx++; exR.push(+(ex.radius ?? -1).toFixed(1)); return ex0(x, y, ex, back) }
  for (let s = 0; s < 16; s++) {
    const f0 = frames, t0 = performance.now(), ms = []
    for (let i = 0; i < 10; i++) { await wait(50); ms.push(ph.stats.ms) }
    const chunks = ent.bodies.filter((b) => !b.dead && b.name === 'concrete_collapsed' || (b.mat === np.mats.byName.get('concrete_collapsed') && !b.dead))
    const names = document.getElementById('panel').textContent.split('\n')[1]
    rows.push({ t: (s + 1) * 0.5, fps: +((frames - f0) / ((performance.now() - t0) / 1000)).toFixed(0), physMax: +Math.max(...ms).toFixed(1), physMed: +ms.sort((a, b) => a - b)[5].toFixed(1), terr: +(ph.stats.msTerrain ?? 0).toFixed(1), step: +(ph.stats.msStep ?? 0).toFixed(1), sync: +(ph.stats.msSync ?? 0).toFixed(1), bodies: ph.stats.bodies, awake: ph.stats.awake, tiles: ph.stats.tiles, built: ph.stats.built, verts: [...ph.tiles.values()].reduce((s, t) => s + t.verts, 0), names, nEx, toiOff: !!ph.stats.toiOff })
  }
  return { rows, exR: exR.slice(0, 40), projectiles: np.projectiles.list.length }
})
await shootP
for (const o of r.rows) console.log(JSON.stringify(o))
console.log('explosion radii', JSON.stringify(r.exR))
await page.screenshot({ path: process.env.TEMP + '/meteor.png' })
await browser.close()
