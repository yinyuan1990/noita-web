// 探针:实心植被(树 / 蘑菇)—— 像素在材质格里(子弹打得中),脚下被挖空后整株按重力下落、落地重新烙进格子;可视植被(灌木 / 草)不动
// 用法:node scripts/_noita-veg-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.player.onGround, null, { timeout: 90000 })
await page.waitForTimeout(2500)
const r = await page.evaluate(async () => {
  const np = window.__np, pl = np.player, sim = np.sim, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  np.veg.sync()
  const res = { instances: np.veg.inst.size }
  // 找离玩家最近的一棵实心植被(在模拟窗口里)
  const OX = 35 * 512, OY = 14 * 512 // decor 是 chunk 绝对像素
  let best = null, bd = Infinity
  for (const it of np.veg.inst.values()) { const d = it.d; if (!/^tree/.test(d.name)) continue; const dd = Math.hypot(d.x - OX + d.fw / 2 - pl.x, d.y - OY + d.fh - pl.y); if (dd < bd) { bd = dd; best = it } }
  if (!best) for (const it of np.veg.inst.values()) { const d = it.d, dd = Math.hypot(d.x - OX + d.fw / 2 - pl.x, d.y - OY + d.fh - pl.y); if (dd < bd) { bd = dd; best = it } }
  if (!best) return { ...res, err: 'no solid veg near' }
  const d = best.d, wx = d.x - OX
  res.tree = { name: d.name, x: wx, y: d.y - OY, fw: d.fw, fh: d.fh, mat: np.mats.name(d.mat), dist: bd | 0 }
  // 材质格里数一数这棵树的像素
  const count = () => { let n = 0; for (let j = 0; j < d.fh; j++) for (let i = 0; i < d.fw; i++) if (sim.get(wx + i, d.y - OY + j) === d.mat) n++; return n }
  res.cells0 = count()
  { const img = np.veg.images.get(d.name) || await new Promise((r) => { const t = setInterval(() => { const im = np.veg.images.get(d.name); if (im) { clearInterval(t); r(im) } }, 50) }); let own = 0; for (let j = 0; j < d.fh; j++) for (let i = 0; i < d.fw; i++) if (img.data[((j * img.width) + d.sx + i) * 4 + 3] >= 128 && sim.get(d.x - OX + i, d.y - OY + j) === d.mat) own++; res.ownPixels0 = own }
  const wy = d.y - OY
  // 先看子弹打不打得中树:从树左边 40px 水平射一颗火花弹穿过树干中部,应在树里死掉(留下小坑)
  const trunkY = wy + d.fh - 30
  const b = np.projectiles.spawn('light_bullet', wx - 40, trunkY, 0)
  await wait(200)
  res.bullet = { dead: b.dead, stoppedX: (b.x - wx) | 0, cellsAfterHit: count() }
  // 把树脚下 30px 厚的地面挖空(整个树宽 + 两边各 10px)
  // 树可能长在坡上(一侧的土比树根高),把树宽范围内、树顶以下全部非树材质挖空,再往下挖 40px
  for (let y = wy + 10; y < wy + d.fh + 40; y++) for (let x = wx - 10; x < wx + d.fw + 10; x++) { const m = sim.get(x, y); if (m > 0 && m !== d.mat) sim.set(x, y, 0) }
  res.cellsAfterDig = count()
  { const img = np.veg.images.get(d.name); res.dbg = { img: img ? [img.width, img.height, !!img.data] : img, support: img ? np.veg._support(best, img) : null, checkT: best.checkT, belowSample: [0, 20, 40, 60].map((i) => { let low = -1; for (let j = d.fh - 1; j >= 0; j--) if (sim.get(wx + i, wy + j) === d.mat) { low = j; break }; return [i, low, low >= 0 ? np.mats.name(sim.get(wx + i, wy + low + 1)) : null] }) } }
  await wait(40); res.cells40ms = count(); res.falling40 = best.falling
  await wait(210)
  res.falling = best.falling
  const y0 = d.y
  await wait(2500)
  res.after = { falling: best.falling, y: d.y - OY, fell: d.y - y0, vy: +best.vy.toFixed(1), cellsInBox: count(), aliveMask: best.alive, stats: np.veg.stats }
  // 相机 / 玩家挪到树旁看一眼
  pl.x = wx + d.fw / 2 + 40; pl.y = d.y - OY + d.fh - 30; pl.vx = 0; pl.vy = 0; np.cam.x = wx + d.fw / 2; np.cam.y = d.y - OY + d.fh / 2
  await wait(400)
  return res
})
console.log(JSON.stringify(r, null, 1))
await page.screenshot({ path: `${out}/veg.png` })
await browser.close()
