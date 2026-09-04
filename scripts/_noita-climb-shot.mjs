// 临时探针:蜘蛛爬石柱
import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto('http://localhost:5177/noita-play.html?log=0')
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(2500)
// 在出生点右边砌一块 30×50 的石墙,人站墙顶,蜘蛛放墙左脚下
const wall = await page.evaluate(() => {
  const np = window.__np, rock = np.mats.byName.get('rock_static')
  const h = (x) => { let y = -300; while (y < 100 && !np.mats.isSolid(Math.max(0, np.sim.get(x, y)))) y++; return y }
  const g = h(300)
  for (let y = g - 50; y < g + 2; y++) for (let x = 300; x < 330; x++) np.sim.set(x, y, rock, 0)
  return { x: 300, ground: g, top: g - 50 }
})
console.log('wall', wall)
await page.evaluate(([w]) => { const np = window.__np; np.player.x = w.x + 15; np.player.y = w.top - 6; np.player.vx = 0; np.player.vy = 0; np.player.iframe = 999; const E = np.entities; const d = E.defs.longleg; E._img(d.sprite.image); const e = E._make('longleg', d, w.x - 30, w.ground - 12); e.tag = 1; E.list.push(e) }, [wall])
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(400)
  console.log(await page.evaluate(() => { const e = window.__np.entities.list.find((e) => e.tag === 1); return `${e.x | 0},${e.y | 0} surf=${e.surf} ${e.state} v=${e.vx | 0},${e.vy | 0} player=${window.__np.player.x | 0},${window.__np.player.y | 0}` }))
  if (i === 5) await page.screenshot({ path: 'C:/Users/admin/AppData/Local/Temp/ai2-climb-mid.png' })
}
await page.screenshot({ path: 'C:/Users/admin/AppData/Local/Temp/ai2-climb.png' })
await browser.close()
