// 临时探针:寻路 —— 出生地造一段台阶(两级 16px 台子),僵尸从低处追到高处的玩家
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(url)
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(1500)
await page.evaluate(() => {
  const np = window.__np, R = np.mats.byName.get('rock_static')
  // 把出生地右侧铲平再堆两级台子:地面 y=-60;台子 1 在 x 300~340 顶 -78;台子 2 在 x 340~400 顶 -96
  for (let x = 180; x < 420; x++) for (let y = -160; y < -60; y++) np.sim.set(x, y, 0)
  for (let x = 180; x < 420; x++) for (let y = -60; y < -40; y++) np.sim.set(x, y, R)
  for (let x = 300; x < 420; x++) for (let y = -78; y < -60; y++) np.sim.set(x, y, R)
  for (let x = 340; x < 420; x++) for (let y = -96; y < -78; y++) np.sim.set(x, y, R)
  np.player.x = 390; np.player.y = -100; np.player.vx = 0; np.player.vy = 0; np.player.hp = 100; np.cam.x = 300; np.cam.y = -90
  // 清掉附近的怪,放一只僵尸在低处
  for (const e of np.entities.list) e.dead = true
  const d = np.entities.defs.zombie_weak
  np.entities._img(d.sprite.image)
  const z = np.entities._make('zombie_weak', d, 200, -64); z.state = 'chase'; z.sense = true; z.detX = 400; z.detY = 200; z.hp = 999
  np.entities.list.push(z)
})
const log = []
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(800)
  log.push(await page.evaluate(() => { const z = window.__np.entities.list.find((e) => e.name === 'zombie_weak'); return z ? `${(z.x | 0)},${(z.y | 0)} st=${z.state} dir=${z.dir} path=${z.path ? z.path.length : '-'}` : 'gone' }))
}
console.log(log.join('\n'))
await page.screenshot({ path: 'C:/Users/admin/AppData/Local/Temp/path-0.png' })
await browser.close()
