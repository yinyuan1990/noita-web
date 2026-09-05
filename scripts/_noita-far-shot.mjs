// 探针:跳到远处几个位置截图,看远离出生点后的地图有没有问题(手机横屏视口)
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.player.onGround, null, { timeout: 90000 })
await page.waitForTimeout(1500)
const spots = [[600, 0], [1500, 300], [-900, 400], [300, 1200], [0, 2400], [1200, 3000]]
for (const [dx, dy] of spots) {
  const info = await page.evaluate(async ([dx, dy]) => {
    const np = window.__np, pl = np.player, wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const x = 227 + dx, y = -79 + dy
    pl.x = x; pl.y = y; pl.vx = 0; pl.vy = 0; np.cam.x = x; np.cam.y = y; pl.hp = pl.maxHp
    await wait(3500)
    pl.x = x; pl.y = y; pl.vx = 0; pl.vy = 0; pl.hp = pl.maxHp
    await wait(300)
    const s = np.streamer.stats
    return { pos: [x, y], entries: np.streamer.entries.size, ready: [...np.streamer.entries.values()].filter((e) => e.ready).length, holeFrames: s.holeFrames, evicted: s.evicted, simTbl: [np.sim.cw, np.sim.ch], simBound: np.sim.get(Math.floor(x), Math.floor(y)) >= 0, ents: np.entities.list.length, biome: np.streamer.get(Math.floor(x / 512) + 35, Math.floor(y / 512) + 14)?.biome }
  }, [dx, dy])
  console.log(JSON.stringify(info))
  await page.screenshot({ path: `C:/Users/admin/AppData/Local/Temp/far_${dx}_${dy}.png` })
}
await browser.close()
