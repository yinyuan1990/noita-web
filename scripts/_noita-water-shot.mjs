// 临时探针:出生点右边挖个水坑,跳进去看入水效果(水花 / 气泡 / 出水滴水 / 染色),连拍几张
import { chromium } from 'playwright'
const out = process.argv[2] || 'C:/Users/admin/AppData/Local/Temp'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 854, height: 480 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto('http://localhost:5177/noita-play.html?log=0')
await page.waitForFunction(() => window.__np && window.__np.streamer.entries.size > 0, null, { timeout: 60000 })
await page.waitForTimeout(2500)
// 挖坑 + 灌水:坑心 (300,-62) r 22,水面到 -70
await page.evaluate(async () => {
  const np = window.__np, water = np.mats.byName.get('water')
  await np.streamer.paintCircle(300, -62, 22, 0)
  for (let y = -70; y < -40; y++) for (let x = 278; x <= 322; x++) if (np.sim.get(x, y) === 0 && (x - 300) ** 2 + (y + 62) ** 2 <= 22 * 22) np.sim.set(x, y, water, 0)
})
await page.waitForTimeout(1200)
// 朝水坑打一发火花弹:弹丸入水也要溅
await page.evaluate(() => window.__np.projectiles.spawn('light_bullet', 300, -95, Math.PI / 2, {}))
await page.waitForTimeout(160)
console.log('弹入水', await page.evaluate(() => ({ debris: window.__np.debris.length })))
await page.screenshot({ path: `${out}/water-0.png` })
await page.waitForTimeout(800)
// 跑过去跳进水里
await page.keyboard.down('d'); await page.waitForTimeout(650); await page.keyboard.press(' '); await page.waitForTimeout(500); await page.keyboard.up('d')
await page.waitForTimeout(120)
await page.screenshot({ path: `${out}/water-1-splash.png` })
console.log('入水', await page.evaluate(() => ({ x: window.__np.player.x | 0, y: window.__np.player.y | 0, wet: +window.__np.player.wet.toFixed(1), head: window.__np.player.headInLiq, bubbles: window.__np.bubbles.length, debris: window.__np.debris.length })))
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}/water-2-in.png` })
console.log('水里', await page.evaluate(() => ({ x: window.__np.player.x | 0, y: window.__np.player.y | 0, head: window.__np.player.headInLiq, bubbles: window.__np.bubbles.length })))
// 出水:按住 W 往上飘 + 往左走
await page.keyboard.down('w'); await page.keyboard.down('a'); await page.waitForTimeout(900); await page.keyboard.up('w'); await page.waitForTimeout(700); await page.keyboard.up('a')
await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/water-3-out.png` })
console.log('出水', await page.evaluate(() => ({ x: window.__np.player.x | 0, y: window.__np.player.y | 0, wet: +window.__np.player.wet.toFixed(1), debris: window.__np.debris.length })))
await browser.close()
