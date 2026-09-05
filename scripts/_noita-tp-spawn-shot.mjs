// 探针:传送后怪物有没有出现(含区块卸载后回来是否重刷)
// 用法:node scripts/_noita-tp-spawn-shot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const out = 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(1500)
const tp = (x, y) => page.evaluate(([x, y]) => { const np = window.__np; np.player.x = x; np.player.y = y; np.player.vx = 0; np.player.vy = 0; np.cam.x = x; np.cam.y = y; np.player.hp = 100 }, [x, y])
const count = (tag) => page.evaluate((tag) => {
  const np = window.__np, E = np.entities, p = np.player
  const near = E.list.filter((e) => !e.dead && Math.abs(e.x - p.x) < 450 && Math.abs(e.y - p.y) < 260)
  const cnt = {}; for (const e of near) cnt[e.name] = (cnt[e.name] || 0) + 1
  return `${tag} @${p.x | 0},${p.y | 0} biome=${np.world?.biomeAtWorld?.(p.x, p.y)} near=${near.length} total=${E.list.length} chunks=${np.streamer.entries.size} evicted=${np.streamer.stats.evicted} spawnedChunks=${E.spawnedChunks.size} ${JSON.stringify(cnt)}`
}, tag)
const stops = [[227, -85, 'spawn'], [0, 1900, 'excav'], [300, 4000, 'snow'], [227, -85, 'back-spawn'], [0, 1900, 'back-excav'], [-3800, 500, 'liquidcave'], [0, 1900, 'excav-3rd']]
for (const [x, y, tag] of stops) {
  await tp(x, y)
  await page.waitForTimeout(5000)
  console.log(await count(tag))
  await page.screenshot({ path: `${out}/tp-${tag}.png` })
}
await browser.close()
