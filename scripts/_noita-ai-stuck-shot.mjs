// 探针:走路怪 AI 两个 bug —— ① 卡在路点(墙 / 台子跳不上去)② 被埋住的怪穿墙冒出来;顺带 ③ 1px 地板不掉穿
// 用法:node scripts/_noita-ai-stuck-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
// 线上加载慢:等出生地周围 3×2 块都就位再开始
await page.waitForFunction(() => { const np = window.__np; for (let cx = 34; cx <= 36; cx++) for (let cy = 13; cy <= 14; cy++) if (!np.streamer.get(cx, cy)) return false; return true }, null, { timeout: 120000 })
await page.waitForTimeout(2000)

// 试验场:出生地上方 (100..420, -270..-150) 清空,画地板 / 台子 / 1px 细地板,放怪
await page.evaluate(() => {
  const np = window.__np, sim = np.sim, rock = np.mats.byName.get('rock_static')
  const fill = (x0, y0, x1, y1, m) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) sim.set(x, y, m, 0) }
  fill(100, -270, 420, -150, 0)
  fill(100, -160, 420, -150, rock)         // 地板(顶面 y=-160)
  fill(300, -192, 420, -161, rock)         // 台子:32px 高,顶面 y=-192
  fill(120, -230, 180, -230, rock)         // 1px 细地板
  fill(100, -270, 104, -150, rock); fill(416, -270, 420, -150, rock) // 两边墙
  np.player.x = 360; np.player.y = -195; np.player.vx = 0; np.player.vy = 0; np.cam.x = 260; np.cam.y = -210; np.player.iframe = 999; np.player.hp = 100
  for (const e of np.entities.list) e.dead = true
  const E = np.entities
  E.spawnCreature('zombie', 220, -164)      // A:要追人跳上 32px 台子
  const b = E.spawnCreature('zombie', 150, -164); b.state = 'idle'; b.stateT = 99; b.sense = false // B:马上被埋
  E.spawnCreature('zombie', 150, -234).sense = false // C:站在 1px 地板上
  fill(140, -180, 160, -161, rock)          // 把 B 整个埋进石头里(它的盒子 -2..2 × -5..3)
})
// 顺带量寻路耗时
await page.evaluate(() => { const E = window.__np.entities, f = E._findPath.bind(E); E._pathN = 0; E._pathMs = 0; E._findPath = (e, p) => { const t = performance.now(); const r = f(e, p); E._pathMs += performance.now() - t; E._pathN++; return r } })
await page.waitForTimeout(300)
const dump = () => page.evaluate(() => window.__np.entities.list.filter((e) => !e.dead && e.y < -100).map((e) => `${e.name}@${e.x.toFixed(1)},${e.y.toFixed(1)} ${e.state}${e.onGround ? '' : ' air'} v=${e.vx | 0},${e.vy | 0} lob=${(e.lobT || 0).toFixed(2)} path=${e.path ? e.path.length : '-'}`))
const t0 = Date.now()
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(500)
  console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', await dump())
  if (i === 2 || i === 8) await page.screenshot({ path: `${out}/ai-stuck-${i}.png` })
}
const res = await page.evaluate(() => {
  const L = window.__np.entities.list.filter((e) => !e.dead && e.y < -100)
  const A = L[0], B = L[1], C = L[2]
  return {
    A_reached_ledge: A.x > 300 && A.y < -190,
    B_stayed_buried: Math.abs(B.x - 150) <= 3 && Math.abs(B.y + 164) <= 3,
    C_on_thin_floor: Math.abs(C.y + 234) <= 1.5,
    A: [A.x | 0, A.y | 0], B: [B.x | 0, B.y | 0], C: [C.x | 0, C.y | 0],
    pathCalls: window.__np.entities._pathN, pathMsAvg: +(window.__np.entities._pathMs / Math.max(1, window.__np.entities._pathN)).toFixed(3),
  }
})
console.log(JSON.stringify(res))
await page.screenshot({ path: `${out}/ai-stuck-end.png` })
await browser.close()
