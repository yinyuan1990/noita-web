// 探针:HUD 状态区(血条下:图标 + 量条 + 数字)、头顶没有导航箭头、金块闪光 / 捡金火花、怪死掉金块
// 用法:node scripts/_noita-hud-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, deviceScaleFactor: 2, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.player.onGround, null, { timeout: 90000 })
await page.waitForTimeout(1500)
const r = await page.evaluate(async () => {
  const np = window.__np, pl = np.player, sim = np.sim, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const res = {}
  // 泡水 → 状态区应出现 wet 图标 + 百分数
  const w = np.mats.byName.get('water')
  for (let x = pl.x - 6; x <= pl.x + 6; x++) for (let y = pl.y - 14; y < pl.y; y++) if (sim.get(x, y) === 0) sim.set(x, y, w, 0)
  await wait(500)
  res.status = [...document.querySelectorAll('#status .st')].map((el) => ({ icon: el.querySelector('img').getAttribute('src').split('/').pop(), bar: el.querySelector('.sb b').style.width, text: el.querySelector('span').textContent }))
  res.hudHasStatusText = /\[.*(湿|着火).*\]/.test(document.getElementById('hud').textContent)
  // 金块:放 3 个,等 2s 看有没有闪光 anim 出现;然后把人挪过去捡,看火花数
  const ent = np.entities, ps = np.projectiles
  for (let i = 0; i < 3; i++) ent.spawnItem('goldnugget_50', pl.x + 40 + i * 6, pl.y - 20, { vy: -20, pickCool: 1 })
  let glints = 0
  for (let i = 0; i < 40; i++) { await wait(50); glints = Math.max(glints, ps.anims.filter((a) => a.loop).length) }
  res.goldGlintsSeen = glints
  const gold0 = pl.gold
  pl.x += 40; pl.vx = 0
  let burst = 0
  for (let i = 0; i < 20; i++) { await wait(30); burst = Math.max(burst, ps.anims.filter((a) => a.loop).length) }
  res.pickup = { goldGained: pl.gold - gold0, burstAnims: burst }
  // 怪死掉金:找最近的怪直接打死
  const e = ent.list.find((x) => !x.dead && x.maxHp > 0)
  if (e) { const before = ent.bodies.filter((b) => b.gold).length; ent.hurt(e, 9999, 0, 0, 'probe'); await wait(400); res.enemyDrop = { name: e.name, maxHp: e.maxHp, nuggets: ent.bodies.filter((b) => b.gold).length - before, values: ent.bodies.filter((b) => b.gold).slice(-6).map((b) => b.gold) } }
  return res
})
console.log(JSON.stringify(r, null, 1))
await page.screenshot({ path: `${out}/hud.png` })
await browser.close()
