// ????:?????�?????�?,??�?/ ?????????�?????
// ??:node scripts/_noita-biome-play-shot.mjs [x,y] [tag] [url]   �?node scripts/_noita-biome-play-shot.mjs 0,1900 excav
//   ????:node scripts/_noita-biome-play-shot.mjs 0,1900 excav-online "https://update.cocoaihj.com/updatesoft/noita/noita-play.html?log=0&v=$(Get-Date -UFormat %s)"
import { chromium } from 'playwright'
const [tx, ty] = (process.argv[2] || '0,1900').split(',').map(Number)
const tag = process.argv[3] || 'biome'
const url = process.argv[4] || 'http://localhost:5177/noita-play.html?log=0'
const out = 'C:/Users/admin/AppData/Local/Temp'
// ORIGIN_IP=8.162.5.160 ? ??????(?? CDN / ??),? http:// URL ?
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const page = await browser.newPage({ viewport: { width: 854, height: 480 }, ignoreHTTPSErrors: process.env.IGNORE_CERT === '1' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(1500)
const tp = (x, y) => page.evaluate(([x, y]) => { const np = window.__np; np.player.x = x; np.player.y = y; np.player.vx = 0; np.player.vy = 0; np.cam.x = x; np.cam.y = y; np.player.hp = 100 }, [x, y])
await tp(tx, ty)
await page.waitForTimeout(7000)
const info = await page.evaluate(() => {
  const np = window.__np, E = np.entities
  const cnt = (arr, f) => arr.reduce((a, e) => ((a[f(e)] = (a[f(e)] || 0) + 1), a), {})
  return {
    biome: np.world?.biomeAtWorld?.(np.player.x, np.player.y) || null,
    creatures: cnt(E.list, (e) => e.name), bodies: cnt(E.bodies || [], (b) => b.name), worms: E.worms?.length, spawned: E.stats.spawned, skipped: E.stats.skipped,
    chunkSpawns: [...np.streamer.entries.values()].filter((c) => c.spawns?.length).map((c) => c.key + ':' + c.spawns.length),
    fps: np.perf?.fps, hp: np.player.hp, panel: document.getElementById('panel').textContent.replace(/\n/g, ' | '),
    hanging: (E.bodies || []).filter((b) => b.ropes).map((b) => `${b.name}@${b.x | 0},${b.y | 0} ${b.asleep ? 'ZZ' : 'awake'} ropes=${b.ropes.map((r) => `${r.broken ? 'X' : ''}${r.len | 0}`).join('/')}`),
  }
})
console.log(JSON.stringify(info, null, 1))
await page.screenshot({ path: `${out}/${tag}-0.png` })
// ??????? 3 �?
const first = await page.evaluate(() => { const e = window.__np.entities.list[0]; return e ? { x: e.x, y: e.y, name: e.name } : null })
if (first) {
  await tp(first.x - 50, first.y - 10)
  await page.waitForTimeout(3000)
  console.log('near', await page.evaluate(() => window.__np.entities.list.slice(0, 8).map((e) => `${e.name}@${e.x | 0},${e.y | 0} hp=${e.hp.toFixed(2)} st=${e.state} an=${e.anim}`)))
  await page.screenshot({ path: `${out}/${tag}-1.png` })
}
await browser.close()
